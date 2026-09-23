import { describe, expect, it } from 'vitest';
import { roundSignal, SignalLog } from '../src/index.js';
import type { SignalValue } from '../src/index.js';

function values(pairs: Array<[string, SignalValue]>): Map<string, SignalValue> {
  return new Map(pairs);
}

describe('log', () => {
  it('ライブ配信で10万回変化しても送信済み詳細を保持せず、変化前の現在値は失わない', () => {
    const log = new SignalLog();
    let received = 0;
    for (let i = 0; i < 100_000; i++) {
      log.record(
        i * 10,
        values([
          ['PL1', i % 2 === 0],
          ['PL2', i % 3 === 0],
        ]),
      );
      if (i % 100 === 99) {
        const delta = log.drain();
        received += delta.length;
        expect(delta.length).toBeLessThanOrEqual(200);
        expect(log.entries()).toHaveLength(0);
        expect(log.transitions('PL1')).toHaveLength(0);
        expect(
          log.record(
            i * 10,
            values([
              ['PL1', i % 2 === 0],
              ['PL2', i % 3 === 0],
            ]),
          ),
        ).toEqual([]);
      }
    }
    expect(received).toBeGreaterThan(100_000);
    expect(log.signals().sort()).toEqual(['PL1', 'PL2']);
  });
  it('変化点だけを記録する（ランレングス、§5.7）', () => {
    const log = new SignalLog();
    expect(log.record(0, values([['PL1', false]]))).toEqual(['PL1']);
    expect(log.record(10, values([['PL1', false]]))).toEqual([]);
    expect(log.record(20, values([['PL1', true]]))).toEqual(['PL1']);
    expect(log.entries()).toEqual([
      { tMs: 0, signal: 'PL1', value: false },
      { tMs: 20, signal: 'PL1', value: true },
    ]);
    expect(log.signals()).toEqual(['PL1']);
  });

  it('数値信号は3桁に丸めてから比較する', () => {
    expect(roundSignal(23.9963094)).toBe(23.996);
    const log = new SignalLog();
    log.record(0, values([['CR1.coilV', 23.99630941]]));
    log.record(10, values([['CR1.coilV', 23.99630977]]));
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]?.value).toBe(23.996);
  });

  it('遷移列と時刻指定の値を取り出せる', () => {
    const log = new SignalLog();
    log.record(0, values([['PL1', false]]));
    log.record(100, values([['PL1', true]]));
    log.record(300, values([['PL1', false]]));
    expect(log.transitions('PL1').map((e) => e.tMs)).toEqual([0, 100, 300]);
    expect(log.valueAt('PL1', 50)).toBe(false);
    expect(log.valueAt('PL1', 100)).toBe(true);
    expect(log.valueAt('PL1', 299)).toBe(true);
    expect(log.valueAt('PL1', 1000)).toBe(false);
    expect(log.valueAt('PL2', 0)).toBeUndefined();
    log.clear();
    expect(log.entries()).toHaveLength(0);
    expect(log.signals()).toHaveLength(0);
  });
});
