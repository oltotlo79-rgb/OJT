import { describe, expect, it } from 'vitest';
import {
  applyPowerAction,
  buildNets,
  CLOSED_CONTACT_OHMS,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTimer4c,
  createWire,
  EventBus,
  FaultError,
  findWire,
  injectFault,
  NetlistError,
  partId,
  SignalLog,
  Simulation,
  SimulationError,
  solve,
  SOURCE_INTERNAL_OHMS,
  SOURCE_VOLTS,
  terminalId,
  voltageAt,
} from '../src/index.js';
import type { Netlist, Part, SignalValue, SimEvent } from '../src/index.js';
import { bench, net, powerOn, t, w } from './helpers/circuits.js';

function energize(netlist: Netlist, on: boolean): void {
  for (const part of netlist.parts) {
    for (const el of part.elements) if (el.kind === 'source') el.enabled = on;
  }
}

function values(pairs: Array<[string, SignalValue]>): Map<string, SignalValue> {
  return new Map(pairs);
}

describe('robustness: solver 節点数上限', () => {
  it('406節点（リレー29台・電線なし）は MAX_NODES を超え NetlistError', () => {
    const relays = Array.from({ length: 29 }, (_, i) => createRelay4c(`CR${i + 1}`));
    const netlist = net(relays, []);
    const nets = buildNets(netlist);
    expect(nets.nodeCount).toBe(406);
    expect(() => solve(netlist, nets)).toThrow(NetlistError);
  });

  it('392節点（リレー28台）は上限内で解ける', () => {
    const relays = Array.from({ length: 28 }, (_, i) => createRelay4c(`CR${i + 1}`));
    const netlist = net(relays, []);
    const nets = buildNets(netlist);
    expect(nets.nodeCount).toBe(392);
    expect(() => solve(netlist, nets)).not.toThrow();
  });
});

describe('robustness: 非有限コンダクタンスの防御', () => {
  it('0Ω抵抗故障の接点と ratio:0 のレアショートを重ねても nodeVoltages は有限', () => {
    const netlist = net(
      [createPowerSupply('PS'), createPushButton('PB1'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'CR1.14'), w('w3', 'CR1.13', 'PS.-')],
    );
    const pbContact = netlist.parts[1]?.elements[0];
    if (pbContact === undefined || pbContact.kind !== 'contact') throw new Error('PB1:a');
    pbContact.energized = true;
    pbContact.fault = { kind: 'resistive', ohms: 0 };

    const coil = netlist.parts[2]?.elements[0];
    if (coil === undefined || coil.kind !== 'load') throw new Error('CR1:coil');
    coil.fault = { kind: 'layerShort', ratio: 0 };

    energize(netlist, true);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);

    expect(result.nodeVoltages.every((v) => Number.isFinite(v))).toBe(true);
    const coilVolts = result.elementVolts.get('CR1:coil');
    expect(coilVolts).toBeDefined();
    if (coilVolts === undefined) throw new Error('CR1:coil volts');
    expect(Number.isFinite(coilVolts)).toBe(true);
    // 直列合成 0.1(内部) + 0.001(接点、クランプ後) + 0.001(コイル、クランプ後) = 0.102Ω。
    // 注: 接点・コイルとも CLOSED_CONTACT_OHMS にクランプされるため、24Vの大部分は
    // 電源の内部抵抗0.1Ωで消費され、コイル電圧は約0.235Vになる（約24Vにはならない）。
    const totalOhms = SOURCE_INTERNAL_OHMS + CLOSED_CONTACT_OHMS + CLOSED_CONTACT_OHMS;
    expect(coilVolts).toBeCloseTo((SOURCE_VOLTS / totalOhms) * CLOSED_CONTACT_OHMS, 3);
  });

  it('負値・非有限の抵抗値は開放として扱われる（電源内部抵抗・接点・負荷いずれも）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createPushButton('PB1'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'CR1.14'), w('w3', 'CR1.13', 'PS.-')],
    );
    const source = netlist.parts[0]?.elements[0];
    if (source === undefined || source.kind !== 'source') throw new Error('PS:source');
    source.enabled = true;
    source.internalOhms = -1; // 負値 → 開放扱い

    const pbContact = netlist.parts[1]?.elements[0];
    if (pbContact === undefined || pbContact.kind !== 'contact') throw new Error('PB1:a');
    pbContact.energized = true;
    pbContact.fault = { kind: 'resistive', ohms: Infinity }; // 非有限 → 開放扱い

    const coil = netlist.parts[2]?.elements[0];
    if (coil === undefined || coil.kind !== 'load') throw new Error('CR1:coil');
    coil.fault = { kind: 'layerShort', ratio: -1 }; // 負の抵抗 → 開放扱い

    const nets = buildNets(netlist);
    const result = solve(netlist, nets);

    expect(result.nodeVoltages.every((v) => Number.isFinite(v))).toBe(true);
    expect(result.elementAmps.get('PS:source')).toBe(0);
    expect(result.elementAmps.get('PB1:a')).toBe(0);
    expect(result.elementAmps.get('CR1:coil')).toBe(0);
    expect(result.sourceAmps).toBe(0);
  });

  it('主電源OFF・プローブ電源ONで、主電源は電流に寄与しない（Task15のプローブ構成）', () => {
    const probe = createPowerSupply('PROBE');
    const probeSource = probe.elements[0];
    if (probeSource === undefined || probeSource.kind !== 'source') throw new Error('PROBE source');
    probeSource.volts = 1;
    probeSource.internalOhms = 1;
    probeSource.enabled = true;

    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1'), probe],
      [
        w('w1', 'PS.+', 'CR1.14'),
        w('w2', 'CR1.13', 'PS.-'),
        w('w3', 'PROBE.+', 'CR1.14'),
        w('w4', 'PROBE.-', 'CR1.13'),
      ],
    );
    // 主電源 PS は初期状態で enabled=false のまま（意図的に通電しない）。
    const nets = buildNets(netlist);
    const result = solve(netlist, nets, { reference: t('PROBE.-') });

    expect(result.elementVolts.get('CR1:coil')).toBeCloseTo(650 / 651, 6);
    expect(result.sourceAmps).toBeCloseTo(1 / 651, 6);
    expect(result.elementAmps.get('PS:source')).toBe(0);
  });

  it('同一P/N節点上の2個の24V電源が並列給電するとほぼ24Vで合計電流が流れる', () => {
    const netlist = net(
      [createPowerSupply('PS1'), createPowerSupply('PS2'), createRelay4c('CR1')],
      [
        w('w1', 'PS1.+', 'CR1.14'),
        w('w2', 'CR1.13', 'PS1.-'),
        w('w3', 'PS2.+', 'CR1.14'),
        w('w4', 'CR1.13', 'PS2.-'),
      ],
    );
    energize(netlist, true);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);

    expect(result.elementVolts.get('CR1:coil')).toBeCloseTo(24, 1);
    expect(result.sourceAmps).toBeCloseTo(24 / 650, 3);
  });

  it('要素の無い浮遊端子の電位はちょうど0', () => {
    const floating: Part = {
      id: partId('FL1'),
      kind: 'terminal-block',
      terminals: [terminalId('FL1', '1')],
      elements: [],
      meta: { kind: 'terminal-block' },
    };
    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1'), floating],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    energize(netlist, true);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);
    expect(voltageAt(result, nets, terminalId('FL1', '1'))).toBe(0);
  });
});

describe('robustness: SignalLog の索引', () => {
  it('valueAt は記録前は undefined、記録後は時刻に応じた値を返す', () => {
    const log = new SignalLog();
    expect(log.valueAt('X', 5)).toBeUndefined();
    log.record(0, values([['X', false]]));
    log.record(100, values([['X', true]]));
    expect(log.valueAt('X', 50)).toBe(false);
    expect(log.valueAt('X', 100)).toBe(true);
    expect(log.valueAt('X', 1000)).toBe(true);
  });

  it('1000tick分の記録でも transitions は entries のフィルタ結果と一致する', () => {
    const log = new SignalLog();
    for (let tMs = 0; tMs < 1000; tMs += 1) {
      log.record(
        tMs,
        values([
          ['X', tMs % 2 === 0],
          ['Y', Math.floor(tMs / 3) % 2 === 0],
        ]),
      );
    }
    const x = log.transitions('X');
    expect(x.length).toBeGreaterThan(0);
    expect(x).toEqual(log.entries().filter((e) => e.signal === 'X'));
  });

  it('clear 後は valueAt と transitions も空に戻る', () => {
    const log = new SignalLog();
    log.record(0, values([['X', true]]));
    log.clear();
    expect(log.transitions('X')).toEqual([]);
    expect(log.valueAt('X', 0)).toBeUndefined();
  });
});

describe('robustness: EventBus.all() の独立性', () => {
  it('all() はコピーを返し、戻り値への変更は内部状態に影響しない', () => {
    const bus = new EventBus();
    bus.emit({ type: 'chatter', signal: 'T1', tMs: 0, count: 1 });
    const snapshot = bus.all();
    (snapshot as SimEvent[]).push({ type: 'chatter', signal: 'T2', tMs: 1, count: 2 });
    expect(bus.all()).toHaveLength(1);
  });
});

describe('robustness: 電源操作の再押下', () => {
  it('既に要求状態と同じ操作はno-op（violation:false・状態不変）', () => {
    const result = applyPowerAction({ breakerOn: true, switchOn: true }, 'breaker', true);
    expect(result.violation).toBe(false);
    expect(result.switches).toEqual({ breakerOn: true, switchOn: true });
  });

  it('状態が異なる操作は引き続き手順違反を検出する', () => {
    const result = applyPowerAction({ breakerOn: false, switchOn: true }, 'breaker', true);
    expect(result.violation).toBe(true);
  });
});

describe('robustness: Simulation.setTimerPreset のエラー型', () => {
  it('非有限の設定値は SimulationError になる（clampPreset の RangeError を包む）', () => {
    const sim = bench([createPowerSupply('PS'), createTimer4c('T1', 3000)], []);
    expect(() => sim.setTimerPreset('T1', NaN)).toThrow(SimulationError);
  });
});

describe('robustness: contact-resistive の抵抗値検証', () => {
  it('Infinity は FaultError、有限の正の値（500）は通る', () => {
    const netlist = net([createPushButton('PB1')], []);
    expect(() =>
      injectFault(netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', Infinity),
    ).toThrow(FaultError);
    expect(() =>
      injectFault(netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 500),
    ).not.toThrow();
  });
});

describe('robustness: Simulation.addWire の上限超過時の挙動（§6.6 / Task8e #1）', () => {
  it('3本目の電線は追加されず false を返し、ハザードは1件だけ発行される', () => {
    const sim = bench(
      [createPowerSupply('PS'), createLamp('PL1', '白'), createLamp('PL2', '白')],
      [],
    );
    expect(sim.addWire(w('w1', 'PS.+', 'PL1.+'))).toBe(true);
    expect(sim.addWire(w('w2', 'PS.+', 'PL2.+'))).toBe(true);

    const added = sim.addWire(w('w3', 'PS.+', 'PL1.-'));

    expect(added).toBe(false);
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(1);
    expect(sim.netlist.wires.length).toBe(2);
  });

  it('両端がすでに上限のとき電線を追加しようとしても、ハザードは1件だけ発行される', () => {
    const sim = bench(
      [createPowerSupply('PS'), createLamp('PL1', '白'), createLamp('PL2', '白')],
      [],
    );
    sim.addWire(w('w1', 'PS.+', 'PL1.+'));
    sim.addWire(w('w2', 'PS.+', 'PL2.+'));
    sim.addWire(w('w3', 'PS.-', 'PL1.-'));
    sim.addWire(w('w4', 'PS.-', 'PL2.-'));
    expect(sim.netlist.wires.length).toBe(4);

    const added = sim.addWire(w('w5', 'PS.+', 'PS.-'));

    expect(added).toBe(false);
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(1);
    expect(sim.netlist.wires.length).toBe(4);
  });

  it('電線IDの重複は SimulationError（NetlistError からの変換）', () => {
    const sim = bench([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    expect(sim.addWire(w('w1', 'PS.+', 'PL1.+'))).toBe(true);
    expect(() => sim.addWire(w('w1', 'PS.-', 'PL1.-'))).toThrow(SimulationError);
  });

  it('ロックされた電線の removeWire は SimulationError（NetlistError からの変換）', () => {
    const sim = bench([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    expect(sim.addWire(createWire('y1', t('PS.+'), t('PL1.+'), '黄', true))).toBe(true);
    expect(() => sim.removeWire('y1')).toThrow(SimulationError);
  });
});

describe('robustness: wire-misrouted の付け替え先端子の検証（Task8e #2）', () => {
  function misroutedFixture(): Netlist {
    return net(
      [createPowerSupply('PS'), createPushButton('PB1'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'CR1.14'), w('w3', 'CR1.13', 'PS.-')],
    );
  }

  it('未知の端子への付け替えは FaultError', () => {
    const netlist = misroutedFixture();
    expect(() =>
      injectFault(netlist, { wireId: 'w2' }, 'wire-misrouted', terminalId('ZZ', '1')),
    ).toThrow(FaultError);
  });

  it('既知の端子への付け替えは通る', () => {
    const netlist = misroutedFixture();
    injectFault(netlist, { wireId: 'w2' }, 'wire-misrouted', terminalId('CR1', '9'));
    expect(findWire(netlist, 'w2')?.to).toBe('CR1.9');
  });

  it('付け替え先が反対側の端子と同じ（自己ループ）だと FaultError（CS-14）', () => {
    const netlist = misroutedFixture();
    // w2 は PB1.a → CR1.14。反対側の端子（PB1.a）への付け替えは自己ループになる。
    expect(() =>
      injectFault(netlist, { wireId: 'w2' }, 'wire-misrouted', terminalId('PB1', 'a')),
    ).toThrow(FaultError);
    // 拒否されたら電線はそのまま（付け替え未反映）。
    expect(findWire(netlist, 'w2')?.to).toBe('CR1.14');
  });

  it('付け替え先が既に本数上限（2本）まで配線されていると FaultError（CS-14）', () => {
    const netlist = misroutedFixture();
    // CR1.9 に電線を2本張って上限まで埋める。
    netlist.wires.push(w('w4', 'CR1.9', 'PS.+'), w('w5', 'CR1.9', 'PS.-'));
    expect(() =>
      injectFault(netlist, { wireId: 'w2' }, 'wire-misrouted', terminalId('CR1', '9')),
    ).toThrow(FaultError);
    // 拒否されたら電線はそのまま（付け替え未反映）で、CR1.9 の本数も増えていない。
    expect(findWire(netlist, 'w2')?.to).toBe('CR1.14');
    const cr19 = t('CR1.9');
    expect(netlist.wires.filter((wire) => wire.from === cr19 || wire.to === cr19)).toHaveLength(2);
  });
});

describe('robustness: 数値faultへの非数値paramの拒否（Task8e #3）', () => {
  it('contact-resistive に非数値の param を渡すと FaultError', () => {
    const netlist = net([createPushButton('PB1')], []);
    expect(() =>
      injectFault(
        netlist,
        { partId: 'PB1', elementIndex: 0 },
        'contact-resistive',
        terminalId('PB1', 'a'),
      ),
    ).toThrow(FaultError);
  });

  it('coil-layer-short に非数値の param を渡すと FaultError', () => {
    const netlist = net([createRelay4c('CR1')], []);
    expect(() =>
      injectFault(
        netlist,
        { partId: 'CR1', elementIndex: 0 },
        'coil-layer-short',
        terminalId('CR1', '9'),
      ),
    ).toThrow(FaultError);
  });
});

describe('robustness: チャタリング閾値は20回/秒（Task8e #4）', () => {
  it('100ms周期（10回/秒）のフリッカはチャタリングとして検出されない', () => {
    const sim = bench([createPowerSupply('PS'), createPushButton('PB1')], []);
    let pressed = false;
    for (let target = 100; target <= 2000; target += 100) {
      pressed = !pressed;
      if (pressed) sim.press('PB1');
      else sim.release('PB1');
      sim.run(target);
    }
    expect(sim.events.chatters('PB1')).toHaveLength(0);
  });

  it('10ms周期（100回/秒）の反転はチャタリングとして検出される', () => {
    const sim = bench([createPowerSupply('PS'), createPushButton('PB1')], []);
    let pressed = false;
    for (let i = 0; i < 200; i += 1) {
      pressed = !pressed;
      if (pressed) sim.press('PB1');
      else sim.release('PB1');
      sim.step();
    }
    expect(sim.events.chatters('PB1').length).toBeGreaterThan(0);
  });
});

describe('robustness: Simulation コンストラクタによるネットリストのリセット（Task8e #5）', () => {
  function selfHoldParts(): Part[] {
    return [createPowerSupply('PS'), createPushButton('PB1'), createRelay4c('CR1')];
  }
  // PB1 の a接点と CR1 自身の a接点（COM9-NO5）を並列にして自己保持させる。
  function selfHoldWires() {
    return [
      w('w1', 'PS.+', 'PB1.c'),
      w('w2', 'PB1.a', 'CR1.14'),
      w('w3', 'CR1.5', 'CR1.14'),
      w('w4', 'PS.+', 'CR1.9'),
      w('w5', 'CR1.13', 'PS.-'),
    ];
  }

  it('ラッチ済みネットリストで新しい Simulation を作ると最初の state() は解放・非通電', () => {
    const sim1 = bench(selfHoldParts(), selfHoldWires());
    powerOn(sim1);
    sim1.press('PB1');
    sim1.run(50);
    sim1.release('PB1');
    sim1.run(100);
    expect(sim1.state().relays['CR1']?.contactsOn).toBe(true); // 自己保持でラッチ済み

    const sim2 = new Simulation(sim1.netlist);
    const initial = sim2.state();

    expect(initial.relays['CR1']?.contactsOn).toBe(false);
    expect(initial.powered).toBe(false);
  });

  it('リセットにより、ボタンを押さずに投入しても以前のラッチを引き継がない', () => {
    const sim1 = bench(selfHoldParts(), selfHoldWires());
    powerOn(sim1);
    sim1.press('PB1');
    sim1.run(50);
    sim1.release('PB1');
    sim1.run(100);

    const sim2 = new Simulation(sim1.netlist);
    powerOn(sim2); // PB1 は押さない
    sim2.run(50);

    expect(sim2.state().relays['CR1']?.contactsOn).toBe(false);
  });
});

describe('robustness: overcurrent と short-circuit-power-on の切り分け（Task8e #6）', () => {
  it('通電直後から短絡している回路は short-circuit-power-on（overcurrentは0）', () => {
    const sim = bench([createPowerSupply('PS')], [w('w1', 'PS.+', 'PS.-')]);
    powerOn(sim);
    sim.run(50);

    expect(sim.state().tripped).toBe(true);
    expect(sim.events.countOf('short-circuit-power-on')).toBe(1);
    expect(sim.events.countOf('overcurrent')).toBe(0);
  });

  it('稼働中にボタン操作で短絡が発生したときは overcurrent（short-circuit-power-onは0）', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [
        w('w1', 'PS.+', 'PL1.+'),
        w('w2', 'PL1.-', 'PS.-'),
        w('w3', 'PS.+', 'PB1.c'),
        w('w4', 'PB1.a', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.run(500);
    expect(sim.state().tripped).toBe(false);

    sim.press('PB1'); // PB1.a が PS.+ と PS.- を直結し短絡させる
    sim.run(550);

    expect(sim.state().tripped).toBe(true);
    expect(sim.events.countOf('overcurrent')).toBe(1);
    expect(sim.events.countOf('short-circuit-power-on')).toBe(0);
  });
});
