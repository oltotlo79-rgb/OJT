import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import type { PickHit } from '../src/renderer/session/interaction.js';
import {
  nextProbeAfter,
  probeSideAt,
  testerPickToAction,
  type TesterPickState,
} from '../src/renderer/session/tester.js';

/**
 * プローブ配置の純関数（Plan 2B Task 2）。設計仕様 §9.3 / §12.2。
 * 黒 → 赤 の順に置き、同じ端子をもう一度押したら外す。
 */

const S7_13 = toTerminalId('S7.13');
const S7_14 = toTerminalId('S7.14');
const S7_9 = toTerminalId('S7.9');

function state(overrides: Partial<TesterPickState> = {}): TesterPickState {
  return { black: undefined, red: undefined, next: 'black', ...overrides };
}

function terminal(id: string): PickHit {
  return { kind: 'terminal', id: toTerminalId(id), wirable: false, label: id };
}

describe('nextProbeAfter（§9.3 黒 → 赤）', () => {
  it('黒の次は赤', () => {
    expect(nextProbeAfter('black')).toBe('red');
  });

  it('赤の次は黒（巡回する）', () => {
    expect(nextProbeAfter('red')).toBe('black');
  });
});

describe('probeSideAt', () => {
  it('その端子にプローブが載っていれば側を返す', () => {
    const s = state({ black: S7_13, red: S7_14 });
    expect(probeSideAt(s, S7_13)).toBe('black');
    expect(probeSideAt(s, S7_14)).toBe('red');
  });

  it('載っていなければ undefined', () => {
    expect(probeSideAt(state(), S7_9)).toBeUndefined();
  });
});

describe('testerPickToAction（§9.3）', () => {
  it('最初の端子クリックは黒を置く', () => {
    expect(testerPickToAction(state(), terminal('S7.13'))).toEqual({
      type: 'placeProbe',
      probe: 'black',
      terminal: S7_13,
    });
  });

  it('2つ目の端子クリックは赤を置く', () => {
    const s = state({ black: S7_13, next: 'red' });
    expect(testerPickToAction(s, terminal('S7.14'))).toEqual({
      type: 'placeProbe',
      probe: 'red',
      terminal: S7_14,
    });
  });

  it('3つ目は黒に戻る（付け替え）', () => {
    const s = state({ black: S7_13, red: S7_14, next: 'black' });
    expect(testerPickToAction(s, terminal('S7.9'))).toEqual({
      type: 'placeProbe',
      probe: 'black',
      terminal: S7_9,
    });
  });

  it('載っているプローブの端子をもう一度押すと外す', () => {
    const s = state({ black: S7_13, red: S7_14, next: 'black' });
    expect(testerPickToAction(s, terminal('S7.14'))).toEqual({ type: 'liftProbe', probe: 'red' });
  });

  it('配線できない端子にも当てられる（本体側の既設配線済み端子を測る。§9.1 測定2）', () => {
    const hit: PickHit = { kind: 'terminal', id: S7_9, wirable: false, label: 'CHK ⑨ COM' };
    expect(testerPickToAction(state(), hit)).toEqual({
      type: 'placeProbe',
      probe: 'black',
      terminal: S7_9,
    });
  });

  it('押ボタンは押せる（赤PBで励磁しながら測る。§9.1）', () => {
    expect(testerPickToAction(state(), { kind: 'pushbutton', id: 'PB4' })).toEqual({
      type: 'pressButton',
      pbId: 'PB4',
    });
  });

  it('電線とソケットは無視する', () => {
    expect(testerPickToAction(state(), { kind: 'wire', id: 'w-1', locked: false })).toEqual({
      type: 'none',
    });
    expect(testerPickToAction(state(), { kind: 'socket', id: 'S1', occupied: false })).toEqual({
      type: 'none',
    });
  });

  it('空クリックでは配置したプローブを保持する', () => {
    const s = state({ black: S7_13, red: S7_14 });
    expect(testerPickToAction(s, { kind: 'empty' })).toEqual({ type: 'none' });
  });

  it('プローブが1本も載っていなければ空クリックは何もしない', () => {
    expect(testerPickToAction(state(), { kind: 'empty' })).toEqual({ type: 'none' });
  });
});
