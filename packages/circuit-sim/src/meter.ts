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
  /** 表示文字列。符号付き小数点2桁と単位。例: `'12.34 V'` `'-24.00 V'` `'0.00 V'`。 */
  display: string;
}

/** Ωレンジの読値。 */
export interface OhmReading {
  /** 等価抵抗[Ω]。測定不能・オーバーレンジのときは Infinity。 */
  ohms: number;
  /**
   * OLクランプ前の生の等価抵抗値[Ω]。孤立ノード（開放）は Infinity、
   * 活線で測定を拒否したときは NaN。
   */
  rawOhms: number;
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

/**
 * DC電圧を測る。black が黒プローブ（基準）、red が赤プローブ（赤−黒）。§5.5
 * 直近の接点更新後にその場で解き直すため、遷移が起きたtickではログの `V:` /
 * `*.volts` の値より1tick先行することがある。
 */
export function measureVoltage(sim: Simulation, black: TerminalId, red: TerminalId): VoltReading {
  const nets = buildNets(sim.netlist);
  const result = solve(sim.netlist, nets);
  const volts = voltageAt(result, nets, red) - voltageAt(result, nets, black);
  return { volts, display: formatVolts(volts) };
}

/** ACVレンジ。AC一次側は測定対象外なので常に 0.00V を返す（実機の操作感のためレンジだけ存在する）。§5.5 */
export function measureAcVolts(): VoltReading {
  return { volts: 0, display: formatVolts(0) };
}

/** `VoltReading.display` を作る。符号付き小数点2桁 + 単位。 */
function formatVolts(volts: number): string {
  return `${volts.toFixed(2)} V`;
}

/**
 * 2端子間の等価抵抗[Ω]を求める。全電源を外し、プローブ間に試験電源（1V・内部抵抗1Ω）を入れて
 * 流れる電流から逆算する。回り込み経路を含む値になる。§5.5 / 調査資料 §6.5(A)
 * 無効化（`enabled=false`）した電源は完全にスキップされるため、電源OFFの状態でP−N間を測ると
 * OLになる（電源内部は見えない、という教育上意図した挙動）。
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

function ohmReading(rawOhms: number, live: boolean): OhmReading {
  const overRange = live || !Number.isFinite(rawOhms) || rawOhms > OVER_RANGE_OHMS;
  return {
    ohms: overRange ? Number.POSITIVE_INFINITY : rawOhms,
    rawOhms,
    overRange,
    live,
    display: overRange ? 'OL' : rawOhms.toFixed(1),
  };
}

/** Ω／導通レンジで直前に当てたプローブ配置と活線状態の記録。`ohm-on-live` の連続発行を防ぐ。 */
interface ProbeRecord {
  black: TerminalId;
  red: TerminalId;
  live: boolean;
}

/** `measureResistance` 用の直近プローブ記録。 */
const ohmLiveRecords = new WeakMap<Simulation, ProbeRecord>();
/** `continuity` 用の直近プローブ記録（Ωレンジとは独立に発行判定する）。 */
const continuityLiveRecords = new WeakMap<Simulation, ProbeRecord>();

/**
 * 同じプローブ配置のまま活線状態が変わらない限り再発行しない。§5.6 #1
 * 記録がない・プローブの組が変わった・前回は非活線だった、のいずれかで true。
 */
function isNewLiveExposure(
  records: WeakMap<Simulation, ProbeRecord>,
  sim: Simulation,
  black: TerminalId,
  red: TerminalId,
  live: boolean,
): boolean {
  if (!live) return false;
  const prior = records.get(sim);
  return prior === undefined || prior.black !== black || prior.red !== red || !prior.live;
}

/** Ω／導通共通の測定本体。呼び出し元ごとに別の `records` を渡し、独立に発行判定する。 */
function measureOhms(
  sim: Simulation,
  black: TerminalId,
  red: TerminalId,
  records: WeakMap<Simulation, ProbeRecord>,
): OhmReading {
  const live = Math.abs(measureVoltage(sim, black, red).volts) >= LIVE_OHM_VOLTS;
  if (isNewLiveExposure(records, sim, black, red, live)) {
    sim.events.emit({
      type: 'hazard',
      kind: 'ohm-on-live',
      tMs: sim.tMs,
      detail: `${black}-${red}`,
    });
  }
  records.set(sim, { black, red, live });
  if (live) return ohmReading(Number.NaN, true);
  return ohmReading(equivalentResistance(sim.netlist, black, red), false);
}

/**
 * 抵抗を測る。プローブ間電圧が1V以上なら測定せず OL を返す。同じプローブ配置のまま活線が
 * 続く限り `ohm-on-live` は初回のみ発行する。§5.5 / §5.6 #1
 */
export function measureResistance(sim: Simulation, black: TerminalId, red: TerminalId): OhmReading {
  return measureOhms(sim, black, red, ohmLiveRecords);
}

/** 導通を調べる。Ωレンジと同じ制約を受ける（`ohm-on-live` の発行判定はΩレンジとは独立）。§5.5 */
export function continuity(sim: Simulation, black: TerminalId, red: TerminalId): ContinuityReading {
  const reading = measureOhms(sim, black, red, continuityLiveRecords);
  const conductive = !reading.overRange && reading.ohms <= CONTINUITY_OHMS;
  return {
    ohms: reading.ohms,
    conductive,
    live: reading.live,
    display: reading.overRange ? 'OL' : conductive ? '導通' : '−−−',
  };
}
