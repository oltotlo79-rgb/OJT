import type { SourceElement } from './elements.js';
import type { TerminalId } from './ids.js';
import { getProbeState, setProbeState } from './meter-state.js';
import type { ProbeRange } from './meter-state.js';
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
   * OLクランプ前の生の等価抵抗値[Ω]。
   * 孤立した端子対（どこにもつながっていない）でも Infinity にはならない：全節点に入れてある
   * 数値安定化用の対地漏れコンダクタンス（`LEAK_SIEMENS`＝1nS）を通って電流が回るため、
   * 1/(k×1nS)（k は小さな整数）＝数百MΩ程度の有限の大きな値になる。10MΩ超なので
   * `overRange` が立ち、表示は `OL` になる。活線で測定を拒否したときは NaN。
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
 *
 * 前提（CS-08）: 一時的に `netlist.parts` へ試験電源を1個 `push()` し、`finally` で
 * `lastIndexOf()` ＋ `splice()` により**同一性**で取り除く。`netlist.parts.pop()` に頼る
 * 実装（配列の末尾＝この関数が足した要素、という**位置**の前提）はやめてある。この関数は
 * 同期的にしか呼ばれず、`try` ブロックの間に他のコードが `netlist.parts` を書き換えることは
 * 無い（JSと `Simulation` はシングルスレッド）が、後始末を位置ではなく同一性に頼ることで、
 * 将来 `solve()` 側の呼び出し順が変わっても壊れない。
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
    // 完全な無電流は実際には起きない（対地漏れ 1nS ぶんの電流が必ず流れるので、孤立した
    // 端子対でも数百MΩ相当の有限値になり OL として表示される）。ゼロ除算に対する保険。
    if (Math.abs(amps) < 1e-15) return Number.POSITIVE_INFINITY;
    return Math.abs(volts / amps);
  } finally {
    // `pop()` は「最後に足した要素」という**位置**に頼った後始末だった（CS-08）。
    // 同一性（`lastIndexOf` ＋ `splice`）で消せば、`solve()`／`buildNets()` の呼び出し順が
    // 将来変わって `netlist.parts` の末尾が別の要素になっても、この一時部品だけを確実に消せる。
    const index = netlist.parts.lastIndexOf(probePart);
    if (index !== -1) netlist.parts.splice(index, 1);
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

/**
 * 同じプローブ配置のまま活線状態が変わらない限り再発行しない。§5.6 #1
 * 記録がない・プローブの組が変わった・前回は非活線だった、のいずれかで true。
 * 記録そのものは `meter-state.ts` が持つ（`Simulation.reset()` から消せるようにするため）。
 */
function isNewLiveExposure(
  range: ProbeRange,
  sim: Simulation,
  black: TerminalId,
  red: TerminalId,
  live: boolean,
): boolean {
  if (!live) return false;
  const prior = getProbeState(sim, range);
  return prior === undefined || prior.black !== black || prior.red !== red || !prior.live;
}

/** Ω／導通共通の測定本体。呼び出し元ごとに別の `range` を渡し、独立に発行判定する。 */
function measureOhms(
  sim: Simulation,
  black: TerminalId,
  red: TerminalId,
  range: ProbeRange,
): OhmReading {
  const live = Math.abs(measureVoltage(sim, black, red).volts) >= LIVE_OHM_VOLTS;
  if (isNewLiveExposure(range, sim, black, red, live)) {
    sim.events.emit({
      type: 'hazard',
      kind: 'ohm-on-live',
      tMs: sim.tMs,
      detail: `${black}-${red}`,
    });
  }
  setProbeState(sim, range, { black, red, live });
  if (live) return ohmReading(Number.NaN, true);
  return ohmReading(equivalentResistance(sim.netlist, black, red), false);
}

/**
 * 抵抗を測る。プローブ間電圧が1V以上なら測定せず OL を返す。同じプローブ配置のまま活線が
 * 続く限り `ohm-on-live` は初回のみ発行する。§5.5 / §5.6 #1
 */
export function measureResistance(sim: Simulation, black: TerminalId, red: TerminalId): OhmReading {
  return measureOhms(sim, black, red, 'ohm');
}

/** 導通を調べる。Ωレンジと同じ制約を受ける（`ohm-on-live` の発行判定はΩレンジとは独立）。§5.5 */
export function continuity(sim: Simulation, black: TerminalId, red: TerminalId): ContinuityReading {
  const reading = measureOhms(sim, black, red, 'continuity');
  const conductive = !reading.overRange && reading.ohms <= CONTINUITY_OHMS;
  return {
    ohms: reading.ohms,
    conductive,
    live: reading.live,
    display: reading.overRange ? 'OL' : conductive ? '導通' : '−−−',
  };
}
