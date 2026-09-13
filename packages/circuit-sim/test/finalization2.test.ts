import { describe, expect, it } from 'vitest';
import {
  createLamp,
  createNetlist,
  createPowerSupply,
  createRelay4c,
  createTimer4c,
  createWire,
  measureResistance,
  NetlistError,
  Simulation,
  SimulationError,
} from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

/** 電源とリレーだけの最小回路。CR1のコイルは通電するとすぐ励磁される。 */
function coilBench(): Simulation {
  return bench(
    [createPowerSupply('PS'), createRelay4c('CR1')],
    [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
  );
}

describe('reset はメータの重複発行記録も消す（Task8h #1）', () => {
  it('reset 後に同じプローブ配置で測ると ohm-on-live がまた発行される', () => {
    const sim = coilBench();
    powerOn(sim);
    sim.step();

    expect(measureResistance(sim, t('PS.-'), t('PS.+')).live).toBe(true);
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
    measureResistance(sim, t('PS.-'), t('PS.+')); // 同じ配置のままなので2件目は出ない
    expect(sim.events.countOf('ohm-on-live')).toBe(1);

    sim.reset();
    powerOn(sim);
    sim.step();
    measureResistance(sim, t('PS.-'), t('PS.+'));

    // ログ・イベントごと消えているので、新しいインスタンスと同じく1件目として発行される。
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
  });
});

describe('mountPart は生きている同一IDの部品を作り直す（Task8h #2）', () => {
  it('励磁中のリレーを挿し替えると解放状態から始まり、動作に1tickかかる', () => {
    const sim = coilBench();
    powerOn(sim);
    sim.run(100);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);

    sim.mountPart(createRelay4c('CR1')); // unmountPart を挟まずに直接差し替える

    expect(sim.state().relays['CR1']).toEqual({
      coilVolts: 0,
      coilOn: false,
      contactsOn: false,
      pendingTicks: 0,
    });
    sim.step();
    expect(sim.state().relays['CR1']?.coilOn).toBe(true);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false); // 動作は1tick遅れる
    sim.step();
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
  });

  it('挿し替えたタイマの presetMs は前の部品の設定値を引き継がない', () => {
    const sim = bench([createPowerSupply('PS'), createTimer4c('T1', 1000)], []);
    sim.setTimerPreset('T1', 5000);
    expect(sim.state().timers['T1']?.presetMs).toBe(5000);

    sim.mountPart(createTimer4c('T1', 3000));

    expect(sim.state().timers['T1']?.presetMs).toBe(3000);
  });
});

describe('mountPart は端子の食い違う部品を拒む（Task8h #3）', () => {
  it('リレーのソケットにランプは挿せず、ネットリストは変わらない', () => {
    const sim = coilBench();
    const socketBefore = sim.unmountPart('CR1');
    expect(socketBefore?.terminals).toHaveLength(14);
    const placeholder = sim.netlist.parts.find((p) => p.id === 'CR1');

    expect(() => sim.mountPart(createLamp('CR1', '白'))).toThrow(SimulationError);
    expect(() => sim.mountPart(createLamp('CR1', '白'))).toThrow('端子配列が一致しません: CR1');

    expect(sim.netlist.parts.find((p) => p.id === 'CR1')).toBe(placeholder);
    expect(placeholder?.kind).toBe('terminal-block');
    expect(placeholder?.terminals).toHaveLength(14);
    expect(sim.netlist.wires.length).toBe(2);
  });

  it('同じ端子集合なら挿せる（空きソケットへの挿し直し）', () => {
    const sim = coilBench();
    sim.unmountPart('CR1');
    expect(() => sim.mountPart(createRelay4c('CR1'))).not.toThrow();
    expect(sim.netlist.parts.find((p) => p.id === 'CR1')?.kind).toBe('relay-my4n');
  });
});

describe('unmountPart は空きソケットには何もしない（Task8h #4）', () => {
  it('2回目の unmountPart は undefined で、ソケットはそのまま残る', () => {
    const sim = coilBench();
    expect(sim.unmountPart('CR1')?.id).toBe('CR1');
    const placeholder = sim.netlist.parts.find((p) => p.id === 'CR1');

    expect(sim.unmountPart('CR1')).toBeUndefined();

    expect(sim.netlist.parts.find((p) => p.id === 'CR1')).toBe(placeholder);
    expect(sim.netlist.wires.length).toBe(2);
  });
});

describe('removeWire は空きができた端子だけ記録を消す（Task8h #5）', () => {
  it('上限を超えたままの端子は記録が残り、ハザードは増えない', () => {
    // 上限（2本）を超える3本を手で組み、addWire を通さずに満杯を作る。
    const netlist = createNetlist(
      [createPowerSupply('PS'), createLamp('PL1', '白'), createLamp('PL2', '白')],
      [w('a', 'PS.+', 'PL1.+'), w('b', 'PS.+', 'PL2.+'), w('c', 'PS.+', 'PL1.-')],
      [],
    );
    const sim = new Simulation(netlist);

    expect(sim.addWire(w('x1', 'PS.+', 'PL2.-'))).toBe(false);
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(1);

    expect(sim.removeWire('a')).toBe(true); // 残り2本＝まだ満杯なので記録は残る
    expect(sim.addWire(w('x2', 'PS.+', 'PL2.-'))).toBe(false);
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(1);

    expect(sim.removeWire('b')).toBe(true); // 残り1本＝空きができたので記録を消す
    expect(sim.addWire(w('x3', 'PS.+', 'PL2.-'))).toBe(true); // また満杯になる
    expect(sim.addWire(w('x4', 'PS.+', 'PL2.+'))).toBe(false);
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(2);
  });
});

describe('SimulationError は元の NetlistError を cause に持つ（Task8h #6）', () => {
  it('ロックされた電線の removeWire', () => {
    const sim = bench([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    expect(sim.addWire(createWire('b1', t('PS.+'), t('PL1.+'), '青', true))).toBe(true);

    let caught: unknown;
    try {
      sim.removeWire('b1');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SimulationError);
    const cause = (caught as SimulationError).cause;
    expect(cause).toBeInstanceOf(NetlistError);
    expect((cause as NetlistError).message).toBe('チェック用回路の既設配線（青）は変更できません');
  });
});

describe('コンストラクタは reset と同じ初期化を通る（Task8h #7）', () => {
  it('作った直後に reset しても状態は変わらない', () => {
    const sim = coilBench();
    const afterConstruct = JSON.stringify(sim.state());

    sim.reset();

    expect(JSON.stringify(sim.state())).toBe(afterConstruct);
    expect(sim.log.entries().length).toBe(0);
    expect(sim.events.all().length).toBe(0);
  });
});

describe('over-wires-per-terminal の detail（Task8h #8）', () => {
  it('今回新たに記録した端子だけを重複なく並べる', () => {
    const sim = bench(
      [createPowerSupply('PS'), createLamp('PL1', '白'), createLamp('PL2', '白')],
      [],
    );
    sim.addWire(w('w1', 'PS.+', 'PL1.+'));
    sim.addWire(w('w2', 'PS.+', 'PL2.+')); // PS.+ が満杯
    sim.addWire(w('w3', 'PL1.-', 'PL2.-'));
    sim.addWire(w('w4', 'PL1.-', 'PS.-')); // PL1.- が満杯

    expect(sim.addWire(w('w5', 'PS.+', 'PL1.-'))).toBe(false);

    expect(sim.events.hazards('over-wires-per-terminal')[0]?.detail).toBe('PS.+,PL1.-');

    sim.addWire(w('w6', 'PL2.-', 'PS.-')); // PL2.- が満杯
    expect(sim.addWire(w('w7', 'PL2.-', 'PL2.-'))).toBe(false); // 自己ループ

    expect(sim.events.countOf('over-wires-per-terminal')).toBe(2);
    expect(sim.events.hazards('over-wires-per-terminal')[1]?.detail).toBe('PL2.-');
  });
});
