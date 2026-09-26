import { JIPM_BOARD } from '@ojt/board-model';
import {
  COIL_OHMS,
  LAMP_OHMS,
  Simulation,
  SOCKET_CONTACT_PINS,
  TICK_MS,
  measureVoltage,
  toTerminalId,
  type Netlist,
} from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '../src/builtin/index.js';
import { applyFaults } from '../src/faults.js';
import { repairNetlist, type RepairCircuit } from '../src/inspect-repair.js';
import { buildReferenceSession } from '../src/reference.js';
import { powerUp } from '../src/runner.js';
import type { FaultSpecData } from '../src/schema/faults.js';
import type { Operation } from '../src/schema/operations.js';

const expandedContactProblems = BUILTIN_INSPECT_REPAIR_PROBLEMS.filter(
  (p) =>
    Number(p.id.split('-')[1]) >= 21 &&
    Array.isArray(p.faults) &&
    p.faults.some((f) => f.kind.startsWith('contact-')),
);

describe('追加した接点故障も盤上の電圧で切り分けられる', () => {
  it('追加した全23件の接点故障を検査対象に含む（v1.7.0 の3件を含む）', () => {
    expect(expandedContactProblems).toHaveLength(23);
  });
  it.each(expandedContactProblems)(
    '$id: 操作列の中で故障接点の両端電圧に有意差がある',
    (problem) => {
      const { netlist: faulty, fault } = faultedNetlist(problem.id, 0);
      if (!('partId' in fault.target)) throw new Error('接点の対象がありません');
      const { com, no } = contactTerminals(fault.target.partId, fault.target.elementIndex);
      const healthySim = new Simulation(healthyNetlist(problem.id));
      const faultySim = new Simulation(faulty);
      powerUp(healthySim);
      powerUp(faultySim);
      let cursor = 0;
      let maximumDifference = 0;
      for (let t = 0; t < problem.durationMs; t += 100) {
        while (problem.operations[cursor] && problem.operations[cursor]!.t <= t) {
          const operation = problem.operations[cursor++]!;
          for (const sim of [healthySim, faultySim]) {
            if (operation.action === 'press') sim.press(operation.target);
            else sim.release(operation.target);
          }
        }
        healthySim.run(t + 100);
        faultySim.run(t + 100);
        const healthy = measureVoltage(healthySim, toTerminalId(no), toTerminalId(com));
        const defective = measureVoltage(faultySim, toTerminalId(no), toTerminalId(com));
        maximumDifference = Math.max(maximumDifference, Math.abs(healthy.volts - defective.volts));
      }
      expect(
        maximumDifference,
        '健康な接点と比べて測定値が変化しない故障を出題しない',
      ).toBeGreaterThan(5);
    },
  );
});

/**
 * 製品判断（2026-09-18、ユーザー）: モードC2では、訓練者は接点の故障
 * （`contact-resistive` / `contact-open` / `contact-welded`）を部品を外して調べるのではなく、
 * **通電したままの盤で押ボタンを操作し、DCVレンジで電圧を測る**ことで指摘する。
 * このテストは、内蔵C2課題のうち接点故障を持つ全題（c2-002・c2-003・c2-005・c2-007・
 * c2-011・c2-014・c2-016・c2-019）について、
 * その方法で実際に指摘できる（健全な回路と明確に違う読みが得られる）ことを回帰で保証する。
 *
 * 各題につき、対象の故障だけを模範回路へ注入した盤と、故障なしの模範回路（`buildReferenceSession`）
 * を用意し、コイルを励磁する押ボタンを操作してから（コイルが実際に励磁されたことを
 * `Simulation` の `<partId>` 信号で確認してから）、接点のCOM／NO端子間電圧を
 * `measureVoltage()` で読む。期待値は実回路（分圧）から計算し、抵抗値は ±10% で判定する。
 */

/**
 * 接点の組（1〜4）の COM 端子と、切り替わる側の端子のID。
 * `socketContactElementIndex(group, 'a') === group * 2`、`'b' === group * 2 - 1`（schema/faults.ts）。
 * a接点（偶数の elementIndex）なら NO 側、b接点（奇数）なら NC 側を返す。
 */
function contactTerminals(partId: string, elementIndex: number): { com: string; no: string } {
  const group = Math.ceil(elementIndex / 2);
  const pins = SOCKET_CONTACT_PINS[group - 1];
  if (pins === undefined) throw new Error(`不正な接点の組: ${partId} elementIndex=${elementIndex}`);
  const switched = elementIndex % 2 === 0 ? pins.no : pins.nc;
  return { com: `${partId}.${String(pins.com)}`, no: `${partId}.${String(switched)}` };
}

/** 故障なしの模範回路のネットリスト。 */
function healthyNetlist(id: string): Netlist {
  const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === id);
  if (problem === undefined) throw new Error(`no problem ${id}`);
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value.netlist;
}

/** 対象の故障（1件）だけを注入した盤のネットリストと、その故障仕様。 */
function faultedNetlist(
  id: string,
  faultIndex: number,
): { netlist: Netlist; fault: FaultSpecData } {
  const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === id);
  if (problem === undefined) throw new Error(`no problem ${id}`);
  if (!Array.isArray(problem.faults)) throw new Error(`${id}: faults is not an array`);
  const fault = problem.faults[faultIndex];
  if (fault === undefined) throw new Error(`${id}: no fault at index ${String(faultIndex)}`);
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const applied = applyFaults(built.value.session, [fault], JIPM_BOARD);
  if (!applied.ok) throw new Error(JSON.stringify(applied.errors));
  const circuit: RepairCircuit = {
    session: built.value.session,
    applied: applied.value,
    initialWireIds: built.value.session.wires.map((w) => w.id),
    initialWires: built.value.session.wires.map((w) => ({ ...w })),
    cells: built.value.cells,
  };
  const { netlist, errors } = repairNetlist(circuit, JIPM_BOARD);
  expect(errors, id).toEqual([]);
  return { netlist, fault };
}

/**
 * 正しい手順で通電し、操作列を再生しながら `driverPartId` のリレー／タイマ接点が
 * 実際に励磁（`contactsOn`）されるまで進める（＝接点が「閉じるべき」瞬間）。
 * 励磁されたら、その tick の `Simulation` を返す（測定はそこで行う）。
 */
function runUntilEnergized(
  netlist: Netlist,
  operations: readonly Operation[],
  driverPartId: string,
  maxMs: number,
): Simulation {
  const sim = new Simulation(netlist);
  powerUp(sim);
  let cursor = 0;
  for (let tMs = 0; tMs < maxMs; tMs += TICK_MS) {
    for (let op = operations[cursor]; op !== undefined && op.t <= tMs; op = operations[cursor]) {
      if (op.action === 'press') sim.press(op.target);
      else sim.release(op.target);
      cursor += 1;
    }
    sim.step(TICK_MS);
    if (sim.log.valueAt(driverPartId, tMs) === true) return sim;
  }
  throw new Error(`${driverPartId} は ${String(maxMs)}ms 以内に励磁されませんでした`);
}

/** 正しい手順で通電し、操作列を `untilMs` まで再生した `Simulation` を返す。 */
function runUntil(netlist: Netlist, operations: readonly Operation[], untilMs: number): Simulation {
  const sim = new Simulation(netlist);
  powerUp(sim);
  let cursor = 0;
  for (let tMs = 0; tMs <= untilMs; tMs += TICK_MS) {
    for (let op = operations[cursor]; op !== undefined && op.t <= tMs; op = operations[cursor]) {
      if (op.action === 'press') sim.press(op.target);
      else sim.release(op.target);
      cursor += 1;
    }
    sim.step(TICK_MS);
  }
  return sim;
}

/** 接点に直列な負荷（ランプかコイル）との分圧で、接点間に現れるはずの電圧。 */
function dividedVolts(ohms: number, loadOhms: number): number {
  return 24 * (ohms / (ohms + loadOhms));
}

describe('内蔵C2課題：接点故障は通電した盤の電圧測定で指摘できる（製品判断 2026-09-18）', () => {
  it('c2-002: CR1 の a接点抵抗劣化（3000Ω）を、CR1励磁中のCOM-NO間電圧で見つけられる', () => {
    const { netlist: faulty, fault } = faultedNetlist('c2-002', 1);
    expect(fault.kind).toBe('contact-resistive');
    if (fault.kind !== 'contact-resistive' || !('partId' in fault.target))
      throw new Error('unreachable');
    const ohms = fault.ohms ?? 500;
    const { com, no } = contactTerminals(fault.target.partId, fault.target.elementIndex);

    const ops: Operation[] = [
      { t: 100, target: 'PB1', action: 'press' },
      { t: 300, target: 'PB1', action: 'release' },
    ];

    // 健全な盤: CR1が閉じればランプ(2400Ω)に24Vがほぼそのまま掛かり、接点間はほぼ0V。
    const healthySim = runUntilEnergized(healthyNetlist('c2-002'), ops, 'CR1', 2000);
    const healthyReading = measureVoltage(healthySim, toTerminalId(no), toTerminalId(com));
    expect(Math.abs(healthyReading.volts), 'healthy').toBeLessThan(1);

    // 故障した盤: 3000Ωの接点とランプ(2400Ω)の分圧で、接点間に有意な電圧が現れる。
    const faultySim = runUntilEnergized(faulty, ops, 'CR1', 2000);
    const faultyReading = measureVoltage(faultySim, toTerminalId(no), toTerminalId(com));
    const expectedVolts = 24 * (ohms / (ohms + LAMP_OHMS));
    expect(Math.abs(faultyReading.volts)).toBeGreaterThan(5);
    expect(Math.abs(faultyReading.volts)).toBeCloseTo(expectedVolts, 0);
    expect(Math.abs(Math.abs(faultyReading.volts) - expectedVolts) / expectedVolts).toBeLessThan(
      0.1,
    );
  });

  it('c2-005: CR2 の a接点抵抗劣化（3000Ω）を、CR2励磁中のCOM-NO間電圧で見つけられる', () => {
    const { netlist: faulty, fault } = faultedNetlist('c2-005', 1);
    expect(fault.kind).toBe('contact-resistive');
    if (fault.kind !== 'contact-resistive' || !('partId' in fault.target))
      throw new Error('unreachable');
    const ohms = fault.ohms ?? 500;
    const { com, no } = contactTerminals(fault.target.partId, fault.target.elementIndex);

    // PB2だけでCR2を励磁できる（CR1のb接点経由。CR1は未励磁のまま=閉のb接点）。
    const ops: Operation[] = [
      { t: 100, target: 'PB2', action: 'press' },
      { t: 300, target: 'PB2', action: 'release' },
    ];

    const healthySim = runUntilEnergized(healthyNetlist('c2-005'), ops, 'CR2', 2000);
    const healthyReading = measureVoltage(healthySim, toTerminalId(no), toTerminalId(com));
    expect(Math.abs(healthyReading.volts), 'healthy').toBeLessThan(1);

    const faultySim = runUntilEnergized(faulty, ops, 'CR2', 2000);
    const faultyReading = measureVoltage(faultySim, toTerminalId(no), toTerminalId(com));
    const expectedVolts = 24 * (ohms / (ohms + LAMP_OHMS));
    expect(Math.abs(faultyReading.volts)).toBeGreaterThan(5);
    expect(Math.abs(Math.abs(faultyReading.volts) - expectedVolts) / expectedVolts).toBeLessThan(
      0.1,
    );
  });

  it('c2-007: CR2 の a接点断線を、CR2励磁中のCOM-NO間電圧（≈24V）で見つけられる', () => {
    const { netlist: faulty, fault } = faultedNetlist('c2-007', 1);
    expect(fault.kind).toBe('contact-open');
    if (!('partId' in fault.target)) throw new Error('unreachable');
    const { com, no } = contactTerminals(fault.target.partId, fault.target.elementIndex);

    // PB1を押して離せばCR1が自己保持し、T1のプリセット(0.8s)後にT2経由でCR2が励磁される。
    const ops: Operation[] = [
      { t: 100, target: 'PB1', action: 'press' },
      { t: 300, target: 'PB1', action: 'release' },
    ];

    const healthySim = runUntilEnergized(healthyNetlist('c2-007'), ops, 'CR2', 3000);
    const healthyReading = measureVoltage(healthySim, toTerminalId(no), toTerminalId(com));
    expect(Math.abs(healthyReading.volts), 'healthy(closed)').toBeLessThan(1);

    const faultySim = runUntilEnergized(faulty, ops, 'CR2', 3000);
    const faultyReading = measureVoltage(faultySim, toTerminalId(no), toTerminalId(com));
    expect(Math.abs(faultyReading.volts)).toBeGreaterThan(21.6); // 24V ±10%
  });

  it('c2-011: CR1 の a接点抵抗劣化（3000Ω）を、CR1励磁中のCOM-NO間電圧で見つけられる', () => {
    const { netlist: faulty, fault } = faultedNetlist('c2-011', 0);
    expect(fault.kind).toBe('contact-resistive');
    if (fault.kind !== 'contact-resistive' || !('partId' in fault.target))
      throw new Error('unreachable');
    const ohms = fault.ohms ?? 500;
    const { com, no } = contactTerminals(fault.target.partId, fault.target.elementIndex);

    // PB1 で CR1 が自己保持し、その a接点（組2）が PL1 を点ける。
    const ops: Operation[] = [
      { t: 100, target: 'PB1', action: 'press' },
      { t: 300, target: 'PB1', action: 'release' },
    ];

    const healthySim = runUntilEnergized(healthyNetlist('c2-011'), ops, 'CR1', 2000);
    expect(
      Math.abs(measureVoltage(healthySim, toTerminalId(no), toTerminalId(com)).volts),
      'healthy',
    ).toBeLessThan(1);

    const faultySim = runUntilEnergized(faulty, ops, 'CR1', 2000);
    const reading = Math.abs(measureVoltage(faultySim, toTerminalId(no), toTerminalId(com)).volts);
    const expectedVolts = dividedVolts(ohms, LAMP_OHMS);
    expect(reading).toBeGreaterThan(5);
    expect(Math.abs(reading - expectedVolts) / expectedVolts).toBeLessThan(0.1);
  });

  it('c2-014: CR2 の b接点溶着を、CR2励磁中のCOM-NC間電圧（≈0V）で見つけられる', () => {
    const { netlist: faulty, fault } = faultedNetlist('c2-014', 0);
    expect(fault.kind).toBe('contact-welded');
    if (!('partId' in fault.target)) throw new Error('unreachable');
    const { com, no } = contactTerminals(fault.target.partId, fault.target.elementIndex);

    // PB2 で逆転（CR2）を自己保持させてから PB1 を押し続ける。健全ならインタロックの
    // b接点が開いて CR1 のコイルに電流が流れず、接点間に電源電圧がそのまま現れる。
    const ops: Operation[] = [
      { t: 100, target: 'PB2', action: 'press' },
      { t: 300, target: 'PB2', action: 'release' },
      { t: 500, target: 'PB1', action: 'press' },
    ];

    const healthySim = runUntil(healthyNetlist('c2-014'), ops, 1000);
    expect(healthySim.log.valueAt('CR2', 1000), 'CR2 energized').toBe(true);
    expect(
      Math.abs(measureVoltage(healthySim, toTerminalId(no), toTerminalId(com)).volts),
      'healthy(open, energized)',
    ).toBeGreaterThan(21.6); // 24V ±10%

    const faultySim = runUntil(faulty, ops, 1000);
    expect(
      Math.abs(measureVoltage(faultySim, toTerminalId(no), toTerminalId(com)).volts),
      'welded reads closed while energized',
    ).toBeLessThan(1);
  });

  it('c2-016: CR3 の a接点抵抗劣化（1000Ω）を、CR3励磁中のCOM-NO間電圧で見つけられる', () => {
    const { netlist: faulty, fault } = faultedNetlist('c2-016', 0);
    expect(fault.kind).toBe('contact-resistive');
    if (fault.kind !== 'contact-resistive' || !('partId' in fault.target))
      throw new Error('unreachable');
    const ohms = fault.ohms ?? 500;
    const { com, no } = contactTerminals(fault.target.partId, fault.target.elementIndex);

    // PB1 で CR3（後着優先の受け）が励磁される。その a接点は CR1 のコイルと直列なので、
    // 分圧はランプ（2400Ω）ではなくコイル（650Ω）との比になる。
    const ops: Operation[] = [
      { t: 100, target: 'PB1', action: 'press' },
      { t: 900, target: 'PB1', action: 'release' },
    ];

    const healthySim = runUntilEnergized(healthyNetlist('c2-016'), ops, 'CR3', 2000);
    expect(
      Math.abs(measureVoltage(healthySim, toTerminalId(no), toTerminalId(com)).volts),
      'healthy',
    ).toBeLessThan(1);

    const faultySim = runUntilEnergized(faulty, ops, 'CR3', 2000);
    const reading = Math.abs(measureVoltage(faultySim, toTerminalId(no), toTerminalId(com)).volts);
    const expectedVolts = dividedVolts(ohms, COIL_OHMS);
    expect(reading).toBeGreaterThan(5);
    expect(Math.abs(reading - expectedVolts) / expectedVolts).toBeLessThan(0.1);
  });

  it('c2-019: T1 の a接点抵抗劣化（3000Ω）を、T1タイムアップ後のCOM-NO間電圧で見つけられる', () => {
    const { netlist: faulty, fault } = faultedNetlist('c2-019', 0);
    expect(fault.kind).toBe('contact-resistive');
    if (fault.kind !== 'contact-resistive' || !('partId' in fault.target))
      throw new Error('unreachable');
    const ohms = fault.ohms ?? 500;
    const { com, no } = contactTerminals(fault.target.partId, fault.target.elementIndex);

    // PB1 で運転を始めると T1 が1.5秒計時し、その a接点（組2）が PL1 を点ける。
    const ops: Operation[] = [
      { t: 100, target: 'PB1', action: 'press' },
      { t: 300, target: 'PB1', action: 'release' },
    ];

    const healthySim = runUntilEnergized(healthyNetlist('c2-019'), ops, 'T1', 4000);
    expect(
      Math.abs(measureVoltage(healthySim, toTerminalId(no), toTerminalId(com)).volts),
      'healthy',
    ).toBeLessThan(1);

    const faultySim = runUntilEnergized(faulty, ops, 'T1', 4000);
    const reading = Math.abs(measureVoltage(faultySim, toTerminalId(no), toTerminalId(com)).volts);
    const expectedVolts = dividedVolts(ohms, LAMP_OHMS);
    // ランプ側に残る電圧が点灯しきい値（14.4V）に届かない＝暗点灯であることも押さえる。
    expect(reading).toBeGreaterThan(5);
    expect(Math.abs(reading - expectedVolts) / expectedVolts).toBeLessThan(0.1);
    expect(24 - reading).toBeLessThan(14.4);
  });

  it('c2-003: T1 の a接点溶着を、T1が未励磁のうちからCOM-NO間電圧（≈0V）で見つけられる', () => {
    const { netlist: faulty, fault } = faultedNetlist('c2-003', 1);
    expect(fault.kind).toBe('contact-welded');
    if (!('partId' in fault.target)) throw new Error('unreachable');
    const { com, no } = contactTerminals(fault.target.partId, fault.target.elementIndex);

    // 何も操作しない。T1のCOM側は独立したランプ回路(r3)としてブレーカ・電源スイッチだけで
    // 常時活線になっているため、T1が一度も励磁されていない状態でも判定できる（製品判断の要点）。
    const healthySim = new Simulation(healthyNetlist('c2-003'));
    powerUp(healthySim);
    healthySim.step(TICK_MS);
    const healthyReading = measureVoltage(healthySim, toTerminalId(no), toTerminalId(com));
    // 健全なら未励磁のa接点は開いたまま: ランプ側は電流が流れずほぼ0V、COM側はほぼ24V。
    expect(Math.abs(healthyReading.volts), 'healthy(open, not energized)').toBeGreaterThan(21.6);

    const faultySim = new Simulation(faulty);
    powerUp(faultySim);
    faultySim.step(TICK_MS);
    expect(faultySim.log.valueAt('T1', TICK_MS), 'T1 still not energized').toBe(false);
    const faultyReading = measureVoltage(faultySim, toTerminalId(no), toTerminalId(com));
    // 溶着なら未励磁でも接点は閉じたまま: ほぼ0V（本来「開」であるべきところが「閉」に見える）。
    expect(Math.abs(faultyReading.volts), 'welded reads closed while not energized').toBeLessThan(
      1,
    );
  });
});
