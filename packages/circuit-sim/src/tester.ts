import { TICK_MS } from './elements.js';
import type { TerminalId } from './ids.js';
import { continuity, measureAcVolts, measureResistance, measureVoltage } from './meter.js';
import type { Simulation } from './simulation.js';

/**
 * テスター（回路計）の状態機械。設計仕様 §9.3 / §5.5 / §5.6 #2。
 *
 * `meter.ts` が「2端子に何Vかかっているか・何Ωか」という**測定そのもの**を担うのに対し、
 * ここは「つまみがどこにあるか・プローブをどこに置いたか・アナログの針が今どこを指しているか」
 * という**計器の状態**を担う。UI（React・DOM・3D）には一切依存せず、数値と整形済みの
 * 文字列（`display`）・針の角度（`targetDeg`）だけを返す。描画は `apps/desktop`（Plan 2B）の責務。
 *
 * 副作用は2つある。①`readTester()` が通電中の回路にΩ／導通レンジを当てると、内部で使う
 * `meter.ts` の `measureResistance()` / `continuity()` が `ohm-on-live` を `sim.events` に
 * 発行する（§5.6 #1）。②`stepTester()` はアナログの針がレンジ上限を超えて振り切れたときに
 * `range-exceeded` を `sim.events` に発行する（§5.6 #2）。UIは `snapshot.hazardDelta` から
 * 両方を同じ形で受け取れる。
 */

/** テスターの種別。切替可能（決定事項#10）。§9.3 */
export type TesterKind = 'digital' | 'analog';

/** つまみの位置。§9.3 */
export type TesterMode = 'off' | 'DCV' | 'ACV' | 'OHM' | 'CONT';

/** アナログのDCVレンジ[V]。§9.3 */
export const ANALOG_DCV_RANGES: readonly number[] = [2.5, 10, 50, 250];
/** アナログのACVレンジ[V]。§9.3 */
export const ANALOG_ACV_RANGES: readonly number[] = [10, 50, 250];
/** アナログのΩレンジ（倍率）。§9.3 */
export const ANALOG_OHM_RANGES = [1, 10, 1000] as const;

/** アナログのΩレンジ（倍率）。 */
export type AnalogOhmRange = (typeof ANALOG_OHM_RANGES)[number];

/** Ωレンジごとの内部抵抗[Ω]（中央目盛方式の針の式に使う）。§9.3 */
export const ANALOG_OHM_INTERNAL_OHMS: Readonly<Record<AnalogOhmRange, number>> = {
  1: 12,
  10: 120,
  1000: 12_000,
};

/** 針のフルスケール角[度]。実機の可動範囲は資料に無いため本アプリの前提（§17 の扱い）。 */
export const NEEDLE_FULL_SCALE_DEG = 90;
/** 針の追従の時定数[ms]。実機の慣性を模す。§9.3 */
export const NEEDLE_TIME_CONSTANT_MS = 100;
/** 0Ω調整をせずにΩを測ったときに読値へ乗る誤差の割合（+5%）。§9.3 */
export const ZERO_ADJUST_ERROR_RATIO = 0.05;

/** つまみが `off` のときの表示。 */
export const TESTER_OFF_DISPLAY = 'OFF';
/** 測定できないときの表示（プローブ未配置・活線でのΩ／導通）。§5.5 */
export const TESTER_NO_PROBE_DISPLAY = '----';

/** アナログの電圧レンジの初期値[V]。 */
export const DEFAULT_ANALOG_VOLT_RANGE = 50;
/** アナログのΩレンジの初期値（×10）。 */
export const DEFAULT_ANALOG_OHM_RANGE: AnalogOhmRange = 10;

/** テスターの状態。UIはこの1オブジェクトだけを持てばよい。§9.3 */
export interface TesterState {
  kind: TesterKind;
  mode: TesterMode;
  /** アナログの電圧レンジ[V]（DCV/ACV 共用のつまみ）。 */
  voltRange: number;
  /** アナログのΩレンジ（倍率）。 */
  ohmRange: AnalogOhmRange;
  /** 黒プローブを置いた端子（未配置は undefined）。 */
  black: TerminalId | undefined;
  /** 赤プローブを置いた端子（未配置は undefined）。 */
  red: TerminalId | undefined;
  /** 0Ω調整済みか。レンジを変えるたびに false に戻る。§9.3 */
  zeroAdjusted: boolean;
  /** アナログ針の現在角度[度]（指数移動平均で追従する）。 */
  needleDeg: number;
  /** `range-exceeded` を発行済みか。レンジ内に戻る／つまみ・レンジ・プローブが変わるまで再発行しない。§5.6 */
  rangeExceededReported: boolean;
}

/** テスターへの操作。§9.3 */
export type TesterAction =
  | { type: 'set-kind'; kind: TesterKind }
  | { type: 'set-mode'; mode: TesterMode }
  | { type: 'set-volt-range'; range: number }
  | { type: 'set-ohm-range'; range: AnalogOhmRange }
  | { type: 'place-probe'; probe: 'black' | 'red'; terminal: TerminalId | undefined }
  | { type: 'zero-adjust' };

/** 1回の読取結果。 */
export interface TesterReading {
  kind: TesterKind;
  mode: TesterMode;
  /** 読値の生値（DCV/ACVは[V]、Ω／導通は[Ω]）。測定できないときは NaN。 */
  value: number;
  /** 表示文字列。`OFF` / `----` / `OL` / `導通` / `−−−` / 数値。 */
  display: string;
  /** 針の目標角度[度]（デジタルは常に0）。 */
  targetDeg: number;
  /** アナログでレンジ上限を超えた（振り切れ）。§5.6 #2 */
  overRange: boolean;
  /** 通電中にΩ／導通を当てた。§5.6 #1 */
  live: boolean;
  /** 導通レンジでブザーが鳴る（50Ω以下）。§5.5 */
  conductive: boolean;
}

/** 初期状態。既定はデジタル・つまみOFF・プローブ未配置。 */
export function createTesterState(kind: TesterKind = 'digital'): TesterState {
  return {
    kind,
    mode: 'off',
    voltRange: DEFAULT_ANALOG_VOLT_RANGE,
    ohmRange: DEFAULT_ANALOG_OHM_RANGE,
    black: undefined,
    red: undefined,
    zeroAdjusted: false,
    needleDeg: 0,
    rangeExceededReported: false,
  };
}

/** そのつまみ位置で選べる電圧レンジ。Ω／導通／OFFのときは DCV と同じ一覧を返す（つまみは1つのため）。 */
export function voltRangesFor(mode: TesterMode): readonly number[] {
  return mode === 'ACV' ? ANALOG_ACV_RANGES : ANALOG_DCV_RANGES;
}

/** 一覧の中で `range` に最も近い値（同着は小さい方）。つまみを回したときにレンジを追従させる。 */
function nearestRange(ranges: readonly number[], range: number): number {
  let best = ranges[0] ?? DEFAULT_ANALOG_VOLT_RANGE;
  for (const candidate of ranges) {
    if (Math.abs(candidate - range) < Math.abs(best - range)) best = candidate;
  }
  return best;
}

/**
 * 操作を適用して**新しい状態**を返す（引数は書き換えない）。§9.3
 * つまみ・レンジ・種別が変わったら0Ω調整と `range-exceeded` の発行済み記録を両方捨てる
 * （レンジを変えるたびに0Ω調整をやり直す実機の作法をそのまま写す）。プローブを動かしたときは
 * `range-exceeded` の発行済み記録だけを捨て、0Ω調整は保持する（0Ω調整はレンジに対する校正で
 * あり、プローブ位置とは独立なため）。
 */
export function applyTesterAction(state: TesterState, action: TesterAction): TesterState {
  const reset = { zeroAdjusted: false, rangeExceededReported: false };
  switch (action.type) {
    case 'set-kind':
      return { ...state, ...reset, kind: action.kind };
    case 'set-mode':
      return {
        ...state,
        ...reset,
        mode: action.mode,
        voltRange: nearestRange(voltRangesFor(action.mode), state.voltRange),
      };
    case 'set-volt-range':
      return {
        ...state,
        ...reset,
        voltRange: nearestRange(voltRangesFor(state.mode), action.range),
      };
    case 'set-ohm-range':
      return { ...state, ...reset, ohmRange: action.range };
    case 'place-probe':
      // プローブを動かしても0Ω調整はやり直させない。校正はレンジに対して行うものであり、
      // プローブ位置とは独立なため。振れ角は変わるので range-exceeded の発行済み記録は捨てる。
      return action.probe === 'black'
        ? { ...state, rangeExceededReported: false, black: action.terminal }
        : { ...state, rangeExceededReported: false, red: action.terminal };
    case 'zero-adjust':
      return { ...state, zeroAdjusted: true };
  }
}

/** 測定できないときの読値。 */
function blankReading(state: TesterState, display: string, live = false): TesterReading {
  return {
    kind: state.kind,
    mode: state.mode,
    value: Number.NaN,
    display,
    targetDeg: 0,
    overRange: false,
    live,
    conductive: false,
  };
}

/** 電圧の読値を組み立てる。アナログはレンジで振り切れを判定する（Task 2 で角度を足す）。 */
function voltReading(state: TesterState, volts: number, display: string): TesterReading {
  return {
    kind: state.kind,
    mode: state.mode,
    value: volts,
    display,
    targetDeg: 0,
    overRange: false,
    live: false,
    conductive: false,
  };
}

/**
 * いまの状態で1回測る。§9.3
 * プローブが両方置かれていなければ測定しない（`----`）。Ω／導通は `meter.ts` の制約
 * （プローブ間1V以上なら測定拒否＋`ohm-on-live`）をそのまま受ける（§5.5 / §5.6 #1）。
 */
export function readTester(sim: Simulation, state: TesterState): TesterReading {
  if (state.mode === 'off') return blankReading(state, TESTER_OFF_DISPLAY);
  const { black, red } = state;
  if (black === undefined || red === undefined) {
    return blankReading(state, TESTER_NO_PROBE_DISPLAY);
  }
  if (state.mode === 'DCV') {
    const reading = measureVoltage(sim, black, red);
    return voltReading(state, reading.volts, reading.display);
  }
  if (state.mode === 'ACV') {
    const reading = measureAcVolts();
    return voltReading(state, reading.volts, reading.display);
  }
  if (state.mode === 'OHM') {
    const reading = measureResistance(sim, black, red);
    if (reading.live) return blankReading(state, TESTER_NO_PROBE_DISPLAY, true);
    return {
      kind: state.kind,
      mode: state.mode,
      value: reading.ohms,
      display: reading.display,
      targetDeg: 0,
      overRange: false,
      live: false,
      conductive: false,
    };
  }
  const reading = continuity(sim, black, red);
  if (reading.live) return blankReading(state, TESTER_NO_PROBE_DISPLAY, true);
  return {
    kind: state.kind,
    mode: state.mode,
    value: reading.ohms,
    display: reading.display,
    targetDeg: 0,
    overRange: false,
    live: false,
    conductive: reading.conductive,
  };
}

/** 針の追従に使う1tickの既定の長さ[ms]。 */
export const TESTER_TICK_MS = TICK_MS;
