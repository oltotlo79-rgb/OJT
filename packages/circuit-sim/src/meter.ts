import type { SourceElement } from './elements.js';
import type { TerminalId } from './ids.js';
import { buildNets } from './netlist.js';
import type { Netlist } from './netlist.js';
import type { Part } from './parts.js';
import { solve, voltageAt } from './solver.js';
import type { Simulation } from './simulation.js';

/** Ω／導通レンジを当ててよいプローブ間電圧の上限[V]。これ以上なら活線。§5.5 / §5.6 #1 */
export const LIVE_OHM_VOLTS = 1;
/** 抵抗測定に使う試験電源の電圧[V]。§5.5 */
export const PROBE_VOLTS = 1;
/** 試験電源の内部抵抗[Ω]。分圧から等価抵抗を逆算するために有限値を持たせる。 */
export const PROBE_OHMS = 1;
/** これを超えた抵抗は OL（オーバーレンジ）扱い。§5.5 */
export const OVER_RANGE_OHMS = 10_000_000;
/** 導通ブザーが鳴る抵抗の上限[Ω]。§5.5 */
export const CONTINUITY_OHMS = 50;
/** 測定用に一時追加する部品のID。 */
const PROBE_PART_ID = '__probe__';

/** 電圧レンジの読値。 */
export interface VoltReading {
  /** 赤プローブ電位 − 黒プローブ電位[V]。§5.5 */
  volts: number;
}

/** Ωレンジの読値。 */
export interface OhmReading {
  /** 等価抵抗[Ω]。測定不能・オーバーレンジのときは Infinity。 */
  ohms: number;
  /** オーバーレンジ（10MΩ超）または活線で測れなかった。 */
  overRange: boolean;
  /** 通電中に当てたため測定できなかった（`ohm-on-live` を発行済み）。§5.6 #1 */
  live: boolean;
  /** 表示文字列。オーバーレンジ・活線は `OL`。 */
  display: string;
}

/** 導通レンジの読値。 */
export interface ContinuityReading {
  ohms: number;
  /** 50Ω以下で導通。§5.5 */
  conductive: boolean;
  live: boolean;
  display: string;
}

/** DC電圧を測る。t1 が黒プローブ（基準）、t2 が赤プローブ。§5.5 */
export function measureVoltage(sim: Simulation, t1: TerminalId, t2: TerminalId): VoltReading {
  const nets = buildNets(sim.netlist);
  const result = solve(sim.netlist, nets);
  return { volts: voltageAt(result, nets, t2) - voltageAt(result, nets, t1) };
}

/** ACVレンジ。AC一次側は測定対象外なので常に 0.00V を返す（実機の操作感のためレンジだけ存在する）。§5.5 */
export function measureAcVolts(): VoltReading {
  return { volts: 0 };
}

/**
 * 2端子間の等価抵抗[Ω]を求める。全電源を外し、プローブ間に試験電源（1V・内部抵抗1Ω）を入れて
 * 流れる電流から逆算する。回り込み経路を含む値になる。§5.5 / 調査資料 §6.5(A)
 */
export function equivalentResistance(netlist: Netlist, t1: TerminalId, t2: TerminalId): number {
  const saved: Array<{ el: SourceElement; enabled: boolean }> = [];
  for (const part of netlist.parts) {
    for (const el of part.elements) {
      if (el.kind !== 'source') continue;
      saved.push({ el, enabled: el.enabled });
      el.enabled = false;
    }
  }
  const probeSource: SourceElement = {
    kind: 'source',
    id: `${PROBE_PART_ID}:source`,
    from: t1,
    to: t2,
    volts: PROBE_VOLTS,
    internalOhms: PROBE_OHMS,
    protectionAmps: Number.POSITIVE_INFINITY,
    enabled: true,
  };
  const probePart: Part = {
    id: PROBE_PART_ID as Part['id'],
    kind: 'power-supply',
    terminals: [t1, t2],
    elements: [probeSource],
    meta: { kind: 'power-supply', sourceElementId: probeSource.id },
  };
  netlist.parts.push(probePart);
  try {
    const nets = buildNets(netlist);
    const result = solve(netlist, nets, { reference: t2 });
    const volts = result.elementVolts.get(probeSource.id) ?? 0;
    const amps = result.elementAmps.get(probeSource.id) ?? 0;
    if (Math.abs(amps) < 1e-15) return Number.POSITIVE_INFINITY;
    return Math.abs(volts / amps);
  } finally {
    netlist.parts.pop();
    for (const entry of saved) entry.el.enabled = entry.enabled;
  }
}

function ohmReading(ohms: number, live: boolean): OhmReading {
  const overRange = live || !Number.isFinite(ohms) || ohms > OVER_RANGE_OHMS;
  return {
    ohms: overRange ? Number.POSITIVE_INFINITY : ohms,
    overRange,
    live,
    display: overRange ? 'OL' : ohms.toFixed(1),
  };
}

/**
 * 抵抗を測る。プローブ間電圧が1V以上なら測定せず `ohm-on-live` を発行して OL を返す。§5.5 / §5.6 #1
 */
export function measureResistance(sim: Simulation, t1: TerminalId, t2: TerminalId): OhmReading {
  const live = Math.abs(measureVoltage(sim, t1, t2).volts) >= LIVE_OHM_VOLTS;
  if (live) {
    sim.events.emit({
      type: 'hazard',
      kind: 'ohm-on-live',
      tMs: sim.tMs,
      detail: `${t1}-${t2}`,
    });
    return ohmReading(Number.POSITIVE_INFINITY, true);
  }
  return ohmReading(equivalentResistance(sim.netlist, t1, t2), false);
}

/** 導通を調べる。Ωレンジと同じ制約を受ける。§5.5 */
export function continuity(sim: Simulation, t1: TerminalId, t2: TerminalId): ContinuityReading {
  const reading = measureResistance(sim, t1, t2);
  const conductive = !reading.overRange && reading.ohms <= CONTINUITY_OHMS;
  return {
    ohms: reading.ohms,
    conductive,
    live: reading.live,
    display: reading.overRange ? 'OL' : conductive ? '導通' : '−−−',
  };
}
