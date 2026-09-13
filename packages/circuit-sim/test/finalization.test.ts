import { describe, expect, it } from 'vitest';
import {
  compareLogs,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createWire,
  FaultError,
  injectFault,
  SignalLog,
  Simulation,
  SimulationError,
} from '../src/index.js';
import type { Part, Tolerance, Wire } from '../src/index.js';
import { bench, net, powerOn, t, w } from './helpers/circuits.js';

/** 自己保持（停止接点先頭形）＋表示灯。PB1で起動、PB2で停止、CR1のa2接点でPL1を点灯する。 */
function selfHoldParts(): Part[] {
  return [
    createPowerSupply('PS'),
    createPushButton('PB1'),
    createPushButton('PB2'),
    createRelay4c('CR1'),
    createLamp('PL1', '白'),
  ];
}

function selfHoldWires(): Wire[] {
  return [
    w('w1', 'PS.+', 'PB2.c'),
    w('w2', 'PB2.b', 'PB1.c'),
    w('w3', 'PB1.a', 'CR1.14'),
    w('w4', 'PB2.b', 'CR1.9'),
    w('w5', 'CR1.5', 'CR1.14'),
    w('w6', 'CR1.13', 'PS.-'),
    w('w7', 'PS.+', 'CR1.10'),
    w('w8', 'CR1.6', 'PL1.+'),
    w('w9', 'PL1.-', 'PS.-'),
  ];
}

function selfHoldBench(): Simulation {
  return bench(selfHoldParts(), selfHoldWires());
}

/** 通電 → PB1を押して離す → 自己保持でラッチ、という一連の操作。 */
function latchScript(sim: Simulation): void {
  powerOn(sim);
  sim.run(100);
  sim.press('PB1');
  sim.run(250);
  sim.release('PB1');
  sim.run(600);
}

describe('Simulation.reset（Task8g #1）', () => {
  it('ラッチ状態から reset すると t=0・非通電・解放・ログとイベントが空になる', () => {
    const sim = selfHoldBench();
    latchScript(sim);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');

    sim.reset();

    const st = sim.state();
    expect(sim.tMs).toBe(0);
    expect(st.tMs).toBe(0);
    expect(st.powered).toBe(false);
    expect(st.breakerOn).toBe(false);
    expect(st.switchOn).toBe(false);
    expect(st.tripped).toBe(false);
    expect(st.buttons['PB1']).toBe(false);
    expect(st.relays['CR1']).toEqual({
      coilVolts: 0,
      coilOn: false,
      contactsOn: false,
      pendingTicks: 0,
    });
    expect(st.lamps['PL1']).toEqual({ volts: 0, level: 'off' });
    expect(st.sourceAmps).toBe(0);
    expect(st.nodeVoltages).toEqual([]);
    expect(sim.log.entries().length).toBe(0);
    expect(sim.events.all().length).toBe(0);
  });

  it('reset 後にもう一度走らせると新しいインスタンスと同じログになる', () => {
    const reused = selfHoldBench();
    latchScript(reused);
    reused.reset();
    latchScript(reused);

    const fresh = selfHoldBench();
    latchScript(fresh);

    expect(JSON.stringify(reused.log.entries())).toBe(JSON.stringify(fresh.log.entries()));
  });
});

describe('Simulation.mountPart / unmountPart（Task8g #2）', () => {
  it('CR1 を抜くと PL1 は2tick以内に消え、時刻とログは続く', () => {
    const sim = selfHoldBench();
    latchScript(sim);
    const tBefore = sim.tMs;
    const entriesBefore = sim.log.entries().length;

    const removed = sim.unmountPart('CR1');

    expect(removed?.id).toBe('CR1');
    expect(removed?.kind).toBe('relay-my4n');
    expect(sim.state().relays['CR1']).toBeUndefined();
    const socket = sim.netlist.parts.find((p) => p.id === 'CR1');
    expect(socket?.kind).toBe('terminal-block');
    expect(socket?.meta).toEqual({ kind: 'terminal-block' });
    expect(socket?.elements).toEqual([]);
    expect(socket?.terminals).toEqual(removed?.terminals);
    expect(sim.netlist.wires.length).toBe(9); // 端子は残るので配線はそのまま

    sim.step();
    sim.step();

    expect(sim.state().lamps['PL1']?.level).toBe('off');
    expect(sim.tMs).toBe(tBefore + 20);
    expect(sim.log.entries().length).toBeGreaterThan(entriesBefore);
    expect(sim.log.transitions('PL1')[0]?.value).toBe(false); // 抜く前の履歴が残っている
  });

  it('同じソケットに挿し直すと回路がまた動く', () => {
    const sim = selfHoldBench();
    latchScript(sim);
    sim.unmountPart('CR1');
    sim.run(sim.tMs + 50);
    expect(sim.state().lamps['PL1']?.level).toBe('off');

    sim.mountPart(createRelay4c('CR1'));

    expect(sim.netlist.parts.filter((p) => p.id === 'CR1')).toHaveLength(1);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
    sim.press('PB1');
    sim.run(sim.tMs + 250);
    sim.release('PB1');
    sim.run(sim.tMs + 600);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
  });

  it('コイルが既に励磁されている配線に挿しても新品同様に次tickから動く', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    powerOn(sim);
    sim.run(100);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);

    sim.unmountPart('CR1');
    sim.mountPart(createRelay4c('CR1'));

    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
    sim.step();
    expect(sim.state().relays['CR1']?.coilOn).toBe(true);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false); // 動作は1tick遅れる
    sim.step();
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
  });

  it('空きソケットが無ければ末尾に足す。無い部品の unmountPart は undefined', () => {
    const sim = bench([createPowerSupply('PS')], []);
    expect(sim.unmountPart('nope')).toBeUndefined();

    sim.mountPart(createLamp('PL9', '赤'));

    expect(sim.netlist.parts.map((p) => String(p.id))).toEqual(['PS', 'PL9']);
    expect(sim.state().lamps['PL9']).toEqual({ volts: 0, level: 'off' });
  });
});

describe('Simulation のエラー型統一（Task8g #3）', () => {
  it('tickMs が正の有限数でなければ SimulationError', () => {
    const parts = [createPowerSupply('PS')];
    expect(() => new Simulation(net(parts, []), { tickMs: 0 })).toThrow(SimulationError);
    expect(() => new Simulation(net(parts, []), { tickMs: -10 })).toThrow(SimulationError);
    expect(() => new Simulation(net(parts, []), { tickMs: Number.NaN })).toThrow(SimulationError);
    expect(() => new Simulation(net(parts, []), { tickMs: Number.POSITIVE_INFINITY })).toThrow(
      SimulationError,
    );
    expect(() => new Simulation(net(parts, []), { tickMs: 10 })).not.toThrow();
  });

  it('節点数上限を超えたネットリストの step() は SimulationError（元のメッセージを保つ）', () => {
    const relays = Array.from({ length: 29 }, (_, i) => createRelay4c(`CR${i + 1}`));
    const sim = new Simulation(net(relays, []));
    expect(() => sim.step()).toThrow(SimulationError);
    expect(() => sim.step()).toThrow('節点数 406 が上限 400 を超えています');
  });
});

describe('state().nodeVoltages はコピー（Task8g #4）', () => {
  it('2回呼ぶと別インスタンスだが内容は等しい', () => {
    const sim = bench(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+'), w('w2', 'PL1.-', 'PS.-')],
    );
    powerOn(sim);
    sim.step();

    const first = sim.state().nodeVoltages;
    const second = sim.state().nodeVoltages;

    expect(first.length).toBeGreaterThan(0);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe('coil-layer-short の ratio 検証（Task8g #5）', () => {
  it('NaN・Infinity は FaultError、レンジ内の値は通る', () => {
    const netlist = net([createRelay4c('CR1')], []);
    const target = { partId: 'CR1', elementIndex: 0 };
    expect(() => injectFault(netlist, target, 'coil-layer-short', Number.NaN)).toThrow(FaultError);
    expect(() =>
      injectFault(netlist, target, 'coil-layer-short', Number.POSITIVE_INFINITY),
    ).toThrow(FaultError);
    expect(() => injectFault(netlist, target, 'coil-layer-short', 0.65)).not.toThrow();
  });
});

describe('over-wires-per-terminal の重複発行防止（Task8g #6）', () => {
  it('同じ満杯端子への連続した拒否は1件だけ、電線を1本外すとまた発行できる', () => {
    const sim = bench(
      [createPowerSupply('PS'), createLamp('PL1', '白'), createLamp('PL2', '白')],
      [],
    );
    expect(sim.addWire(w('w1', 'PS.+', 'PL1.+'))).toBe(true);
    expect(sim.addWire(w('w2', 'PS.+', 'PL2.+'))).toBe(true);

    expect(sim.addWire(w('w3', 'PS.+', 'PL1.-'))).toBe(false);
    expect(sim.addWire(w('w4', 'PS.+', 'PL2.-'))).toBe(false);
    expect(sim.addWire(w('w5', 'PS.+', 'PS.-'))).toBe(false);
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(1);

    expect(sim.removeWire('w2')).toBe(true);
    expect(sim.addWire(w('w6', 'PS.+', 'PL2.+'))).toBe(true); // 空きができたので張れる
    expect(sim.addWire(w('w7', 'PS.+', 'PL1.-'))).toBe(false);
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(2);
    expect(sim.netlist.wires.length).toBe(2);
  });
});

/** `X` の変化点列からログを組み立てる（tMs は昇順）。 */
function logOf(points: Array<[number, boolean]>): SignalLog {
  const log = new SignalLog();
  for (const [tMs, value] of points) log.record(tMs, new Map([['X', value]]));
  return log;
}

describe('compare: 1エッジだけ多い／少ないときの再同期（Task8g #7）', () => {
  const want: Array<[number, boolean]> = [
    [0, false],
    [1000, true],
    [2000, false],
    [3000, true],
  ];
  /** 先頭に余分な立ち上がりが1つ入った訓練者側のログ。 */
  const gotWithExtraEdge: Array<[number, boolean]> = [
    [0, true],
    [500, false],
    [1000, true],
    [2000, false],
    [3000, true],
  ];

  it('余分な先頭エッジは value 1件＋extra 1件で、以降は再同期する', () => {
    const diffs = compareLogs(logOf(want), logOf(gotWithExtraEdge), ['X']);

    expect(diffs.map((d) => d.reason)).toEqual(['value', 'extra']);
    expect(diffs[0]).toMatchObject({ tMs: 0, expected: false, actual: true, actualTMs: 0 });
    expect(diffs[1]).toMatchObject({ tMs: 500, expected: undefined, actual: false });
  });

  it('欠落した先頭エッジは value 1件＋missing 1件で、以降は再同期する', () => {
    const diffs = compareLogs(logOf(gotWithExtraEdge), logOf(want), ['X']);

    expect(diffs.map((d) => d.reason)).toEqual(['value', 'missing']);
    expect(diffs[0]).toMatchObject({ tMs: 0, expected: true, actual: false, actualTMs: 0 });
    expect(diffs[1]).toMatchObject({ tMs: 500, expected: false, actual: undefined });
  });

  it('余分な先頭エッジが許容差内なら extra 1件だけで再同期する', () => {
    const diffs = compareLogs(
      logOf(want),
      logOf([
        [0, true],
        [100, false],
        [1000, true],
        [2000, false],
        [3000, true],
      ]),
      ['X'],
    );

    expect(diffs.map((d) => d.reason)).toEqual(['extra']);
    expect(diffs[0]).toMatchObject({ tMs: 0, expected: undefined, actual: true });
  });

  it('許容差を広げれば 500ms ずれた余分な先頭エッジも extra 1件で済む', () => {
    const tolerance: Tolerance = { edgeMs: 600, ratio: 0.1 };
    const diffs = compareLogs(logOf(want), logOf(gotWithExtraEdge), ['X'], tolerance);

    expect(diffs.map((d) => d.reason)).toEqual(['extra']);
    expect(diffs[0]).toMatchObject({ tMs: 0, expected: undefined, actual: true });
  });
});

describe('メッセージ文言の修正（Task8g #8）', () => {
  it('ロックされた既設配線の removeWire のメッセージ', () => {
    const sim = bench([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    expect(sim.addWire(createWire('b1', t('PS.+'), t('PL1.+'), '青', true))).toBe(true);
    expect(() => sim.removeWire('b1')).toThrow('チェック用回路の既設配線（青）は変更できません');
  });
});
