import { TICK_MS } from './elements.js';
import type { TerminalId } from './ids.js';
import { continuity, measureAcVolts, measureResistance, measureVoltage } from './meter.js';
import { getRangeExceeded, setRangeExceeded } from './meter-state.js';
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
/** 目標角との差がこれ未満なら目標角へスナップする[度]。指数移動平均は理論上収束しきらないため、
 *  スナップが無いと描画側の差分検知（前回と値が同じなら再描画しない）が働かず、針が止まって
 *  見えても毎tick再描画され続ける（コーディネータ指示#3）。 */
export const NEEDLE_SNAP_DEG = 0.05;
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

/** 値がアナログΩレンジの一覧に含まれるか。§9.3 */
function isAnalogOhmRange(value: number): value is AnalogOhmRange {
  return (ANALOG_OHM_RANGES as readonly number[]).includes(value);
}

/**
 * 操作を適用して**新しい状態**を返す（引数は書き換えない）。§9.3
 * `set-ohm-range` は一覧に無い値なら無視して元の状態を返す（`set-volt-range` が
 * `nearestRange()` で丸めるのに対し、Ωレンジの倍率一覧は離散的で「最も近い」が実機の
 * 操作として意味を持たないため）。想定外の `action.type`（実行時に型をすり抜けた値）が
 * 来たときも同じく元の状態をそのまま返す。
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
      return isAnalogOhmRange(action.range)
        ? { ...state, ...reset, ohmRange: action.range }
        : state;
    case 'place-probe':
      // プローブを動かしても0Ω調整はやり直させない。校正はレンジに対して行うものであり、
      // プローブ位置とは独立なため。振れ角は変わるので range-exceeded の発行済み記録は捨てる。
      return action.probe === 'black'
        ? { ...state, rangeExceededReported: false, black: action.terminal }
        : { ...state, rangeExceededReported: false, red: action.terminal };
    case 'zero-adjust':
      return { ...state, zeroAdjusted: true };
  }
  // 網羅性ガード: 上のどの case にも一致しない action.type が実行時に来た場合
  // （型システムをすり抜けた未知の値）、状態を変えずにそのまま返す。`TesterAction` に
  // 新しい種別を足したら、この代入が型エラーになって対応漏れに気付ける。
  const exhaustive: never = action;
  void exhaustive;
  return state;
}

/**
 * アナログ電圧計の針の角度[度]。目盛に対して線形。§9.3
 * 逆極性（負の測定値）は左端＝0度に張り付き、レンジ上限を超えたらフルスケールで止まる。
 */
export function voltNeedleDeg(volts: number, range: number): number {
  const ratio = volts / range;
  if (!(ratio > 0)) return 0;
  return Math.min(ratio, 1) * NEEDLE_FULL_SCALE_DEG;
}

/**
 * アナログΩ計の針の角度[度]。中央目盛方式（非線形）。§9.3
 * 振れ角 ＝ フルスケール角 × Rin ÷ (Rin + R)。右端（フルスケール）が0Ω、左端（0度）が∞。
 */
export function ohmNeedleDeg(ohms: number, range: AnalogOhmRange): number {
  if (!Number.isFinite(ohms) || ohms < 0) return 0;
  const rin = ANALOG_OHM_INTERNAL_OHMS[range];
  return NEEDLE_FULL_SCALE_DEG * (rin / (rin + ohms));
}

/** 0Ω調整が未実施なら読値に +5% の誤差を乗せる。§9.3 */
export function withZeroAdjustError(ohms: number, zeroAdjusted: boolean): number {
  if (!Number.isFinite(ohms)) return ohms;
  return zeroAdjusted ? ohms : ohms * (1 + ZERO_ADJUST_ERROR_RATIO);
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

/**
 * 電圧の読値を組み立てる。アナログはレンジで振り切れを判定し、針の目標角度を入れる。§9.3
 * 振り切れの判定は絶対値で見る（逆極性で大きく振れた場合も可動コイルには同じ負担がかかるため）。
 */
function voltReading(state: TesterState, volts: number, display: string): TesterReading {
  if (state.kind === 'digital') {
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
  const overRange = Math.abs(volts) > state.voltRange;
  return {
    kind: state.kind,
    mode: state.mode,
    value: volts,
    display: overRange ? 'OL' : display,
    targetDeg: voltNeedleDeg(volts, state.voltRange),
    overRange,
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
    if (state.kind === 'digital') {
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
    const shown = withZeroAdjustError(reading.ohms, state.zeroAdjusted);
    return {
      kind: state.kind,
      mode: state.mode,
      value: shown,
      display: Number.isFinite(shown) ? shown.toFixed(1) : 'OL',
      targetDeg: ohmNeedleDeg(shown, state.ohmRange),
      overRange: false,
      live: false,
      conductive: false,
    };
  }
  const reading = continuity(sim, black, red);
  if (reading.live) return blankReading(state, TESTER_NO_PROBE_DISPLAY, true);
  const shown = withZeroAdjustError(reading.ohms, state.zeroAdjusted);
  return {
    kind: state.kind,
    mode: state.mode,
    value: state.kind === 'analog' ? shown : reading.ohms,
    display: reading.display,
    targetDeg: state.kind === 'analog' ? ohmNeedleDeg(shown, state.ohmRange) : 0,
    overRange: false,
    live: false,
    conductive: reading.conductive,
  };
}

/** 針の追従に使う1tickの既定の長さ[ms]。 */
export const TESTER_TICK_MS = TICK_MS;

/**
 * `range-exceeded` の重複発行記録は `ohm-on-live`（`meter-state.ts` / `isNewLiveExposure()`）と
 * 同じ考え方で、`Simulation` をキーにした `WeakMap`（`meter-state.ts`）に持つ。呼び出し側が
 * `stepTester()` の戻り値をスレッドせず毎回同じ `state` を渡しても（`TesterState.rangeExceededReported`
 * が読まれないまま捨てられても）重複発行を防げるようにするため（コーディネータ指摘）。
 * 記録は `Simulation.reset()` が `clearRangeExceeded()` で消すので、リセット後は同じつまみ・
 * 同じプローブのままでも改めて1件発行される（レビュー I-1）。
 */

/** 今回の振り切れを新規発行すべきか。記録が無い・レンジ／プローブが変わった・
 *  前回は範囲内だった、のいずれかで true。 */
function isNewRangeExceeded(
  sim: Simulation,
  rangeKey: string,
  black: TerminalId | undefined,
  red: TerminalId | undefined,
): boolean {
  const prior = getRangeExceeded(sim);
  return (
    prior === undefined ||
    prior.rangeKey !== rangeKey ||
    prior.black !== black ||
    prior.red !== red ||
    !prior.reported
  );
}

/**
 * 1tickぶん進めて読値と新しい状態を返す。§9.3 / §5.6 #2
 *
 * アナログ針は時定数100msの指数移動平均で目標角度へ寄せる（α ＝ 1 − exp(−dt ÷ 100)。
 * 10ms tick では約0.0952）。目標角との差が `NEEDLE_SNAP_DEG`（0.05度）未満になったら
 * 目標角へスナップする。指数移動平均は理論上いつまでも収束しきらないため、スナップが無いと
 * 針が止まって見えても `needleDeg` が毎tick極小に変化し続け、描画側の差分検知（前回と同じ値
 * なら再描画しない）が効かずに再レンダーが止まらない（コーディネータ指示#3）。デジタルは
 * 針を持たないので常に0度のままにする。`dtMs` が非有限または0以下（`NaN`・負値・呼び出し側の
 * フレーム落ち等）のときは0として扱い、針を動かさない（指数移動平均に負や `NaN` の時間を渡すと
 * `needleDeg` が壊れた値のまま戻らなくなるため）。
 *
 * **この関数の副作用**: アナログでレンジ上限を超えた読値になったとき、`sim.events` に
 * `range-exceeded` を1件発行する（内部で呼ぶ `readTester()` も、活線でΩ／導通を当てると
 * `meter.ts` 経由で `ohm-on-live` を発行し得る。§5.6 #1）。同じ振り切れが続いている間は再発行せず、
 * 読値がレンジ内に戻ったときに再発行できる状態へ戻す（つまみ・レンジ・プローブを動かしたときは
 * `applyTesterAction()` が記録を消す）。重複抑制の考え方は `ohm-on-live`（§5.6 #1）と同じ。
 * 発行済みの記録は `TesterState.rangeExceededReported` にも書き戻すが、判定の正は
 * `meter-state.ts` の振り切れ記録（`Simulation` 単位の `WeakMap`）が持つ。
 * `Simulation.reset()` はその記録も消すので、リセット後の測り直しは1件目として扱われる。
 */
export function stepTester(
  sim: Simulation,
  state: TesterState,
  dtMs: number = TESTER_TICK_MS,
): { state: TesterState; reading: TesterReading } {
  const reading = readTester(sim, state);
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const alpha = 1 - Math.exp(-dt / NEEDLE_TIME_CONSTANT_MS);
  const eased =
    state.kind === 'analog' ? state.needleDeg + alpha * (reading.targetDeg - state.needleDeg) : 0;
  const needleDeg =
    state.kind === 'analog' && Math.abs(reading.targetDeg - eased) < NEEDLE_SNAP_DEG
      ? reading.targetDeg
      : eased;
  const rangeKey = `${state.mode}:${state.voltRange}`;
  if (reading.overRange && isNewRangeExceeded(sim, rangeKey, state.black, state.red)) {
    sim.events.emit({
      type: 'hazard',
      kind: 'range-exceeded',
      tMs: sim.tMs,
      detail: `${state.mode} ${state.voltRange}V レンジ`,
    });
  }
  const rangeExceededReported = reading.overRange;
  setRangeExceeded(sim, {
    rangeKey,
    black: state.black,
    red: state.red,
    reported: rangeExceededReported,
  });
  return { state: { ...state, needleDeg, rangeExceededReported }, reading };
}
