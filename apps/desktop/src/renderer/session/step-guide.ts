import { JA } from '../i18n/ja.js';

/**
 * モードB/C1/C2の手順帯（UXレビュー 2026-09-19 #3）。
 * モードD（`PlcSession.tsx`）の手順帯と同じ考え方で、「いまここ」「済」を
 * ストアの状態（部品装着・配線・通電・判定）だけから決める純関数群。
 * 配線の中身や合否には一切触れない（決定表#7と同じ理由）。React も three も使わないので
 * Vitest だけで検証できる（§14.2）。
 */

/** 手順の進み方（`PlcSession.tsx` の `StepState` と同じ4値）。 */
export type StepState = 'done' | 'current' | 'todo' | 'anytime';

/** 手順帯に出す1行。 */
export interface GuideStep<K extends string> {
  readonly key: K;
  readonly label: string;
  readonly state: StepState;
}

/**
 * 「済」フラグの並び（手順の順番どおり）から、最初の未完了を「いまここ」に、
 * それより後ろを「これから」にする。一直線の手順を前提とする。
 */
export function sequentialSteps<K extends string>(
  entries: ReadonlyArray<{ key: K; label: string; done: boolean }>,
): ReadonlyArray<GuideStep<K>> {
  let currentAssigned = false;
  return entries.map(({ key, label, done }) => {
    if (done) return { key, label, state: 'done' as const };
    if (!currentAssigned) {
      currentAssigned = true;
      return { key, label, state: 'current' as const };
    }
    return { key, label, state: 'todo' as const };
  });
}

/** モードBの手順キー（部品装着 → 配線 → 通電 → 判定）。 */
export type AssembleStepKey = 'parts' | 'wire' | 'power' | 'judge';

/** まだ載せていない部品（役割と、その役割のソケット）。案内文に使う。 */
export interface MissingPart {
  role: string;
  socket: string;
}

/**
 * モードBの手順帯。
 *
 * 「部品装着 済」は**課題の模範が使う役割（`requiredRoles`）が全部載ったとき**に付ける
 * （v2.0.0 総点検 Task 2）。以前は在庫の残り（`partsRemaining`）で決めていたため、
 * 在庫に予備のタイマがある b-001 では CR1 を載せても永遠に「いまここ」のままで、
 * 在庫を全部載せると今度は「未使用部品」の静的チェックで不合格になる、という行き止まりがあった。
 * 要求する役割が無い課題（自由練習の盤など）は最初から済にする。
 */
export function assembleSteps(input: {
  /** 課題の模範が使う部品の役割（`@ojt/content` の `requiredPartRoles()`）。 */
  requiredRoles: readonly string[];
  /** いま部品が載っているソケットの役割。 */
  mountedRoles: readonly string[];
  /** いまの電線の本数。 */
  wireCount: number;
  /** 固定（訓練者が外せない）電線の本数。 */
  fixedWireCount: number;
  /** 通電しているか。 */
  powered: boolean;
}): ReadonlyArray<GuideStep<AssembleStepKey>> {
  const partsDone = missingParts(input.requiredRoles, input.mountedRoles, {}).length === 0;
  const wireDone = input.wireCount > input.fixedWireCount;
  const powerDone = input.powered;
  return sequentialSteps([
    { key: 'parts', label: JA.stepGuide.assembleParts, done: partsDone },
    { key: 'wire', label: JA.stepGuide.assembleWire, done: wireDone },
    { key: 'power', label: JA.stepGuide.assemblePower, done: powerDone },
    { key: 'judge', label: JA.stepGuide.assembleJudge, done: false },
  ]);
}

/** モードC1の手順キー（部品を挿す → 通電 → 測る → マーク → 判定）。 */
export type InspectPartsStepKey = 'plug' | 'power' | 'measure' | 'mark' | 'judge';

/** モードC1の手順帯。 */
export function inspectPartsSteps(input: {
  /** チェック用ソケットに部品が挿さっているか。 */
  plugged: boolean;
  /** 通電しているか。 */
  powered: boolean;
  /** テスターの黒・赤の両プローブが端子に置かれているか。 */
  probed: boolean;
  /** マークシートに解答が1件以上あるか。 */
  answered: boolean;
}): ReadonlyArray<GuideStep<InspectPartsStepKey>> {
  const plugDone = input.plugged;
  const powerDone = input.powered;
  const measureDone = input.probed;
  const markDone = input.answered;
  return sequentialSteps([
    { key: 'plug', label: JA.stepGuide.inspectPlug, done: plugDone },
    { key: 'power', label: JA.stepGuide.inspectPower, done: powerDone },
    { key: 'measure', label: JA.stepGuide.inspectMeasure, done: measureDone },
    { key: 'mark', label: JA.stepGuide.inspectMark, done: markDone },
    { key: 'judge', label: JA.stepGuide.inspectJudge, done: false },
  ]);
}

/** モードC2の手順キー（指摘 → 修復 → 判定）。 */
export type InspectRepairStepKey = 'report' | 'fix' | 'judge';

/** モードC2の手順帯。 */
export function inspectRepairSteps(input: {
  /**
   * 登録済みの指摘の件数。§9.2
   * 以前は1件以上で「指摘 済」にしていたが、故障が2箇所ある課題で1件だけ指摘した時点でも
   * 「済」になっていた（UI監査 I19）。指摘すべき件数（`requiredReportCount`）ぶん揃うまでは
   * 「いまここ」のままにする。
   */
  reportCount: number;
  /** 指摘すべき件数（故障箇所の数）。§9.2 */
  requiredReportCount: number;
  /** 白線を張ったか、部品を交換したか（=修復の作業をしたか）。 */
  repaired: boolean;
}): ReadonlyArray<GuideStep<InspectRepairStepKey>> {
  const reportDone = input.reportCount >= Math.max(1, input.requiredReportCount);
  const fixDone = input.repaired;
  return sequentialSteps([
    { key: 'report', label: JA.stepGuide.repairReport, done: reportDone },
    { key: 'fix', label: JA.stepGuide.repairFix, done: fixDone },
    { key: 'judge', label: JA.stepGuide.repairJudge, done: false },
  ]);
}

/**
 * まだ載せていない役割を、要求の並び（CR1〜CR4・T1・T2）のまま返す。
 * `socketsByRole` に無い役割はソケット名を空にする（案内文は役割だけを言う）。
 */
export function missingParts(
  requiredRoles: readonly string[],
  mountedRoles: readonly string[],
  socketsByRole: Readonly<Record<string, string | undefined>>,
): MissingPart[] {
  return requiredRoles
    .filter((role) => !mountedRoles.includes(role))
    .map((role) => ({ role, socket: socketsByRole[role] ?? '' }));
}

/**
 * いまの手順にだけ効く1行の案内（`PlcSession.tsx` の `stepHintText` と同じ方針）。
 * 「部品装着」の案内は**次に載せる役割とソケット**を言う（「CR1 をソケット S1 に載せます」）。
 */
export function assembleStepHint(
  key: AssembleStepKey | undefined,
  missing: readonly MissingPart[] = [],
): string | undefined {
  if (key === 'parts') {
    return missing.length === 0
      ? JA.stepGuide.assemblePartsHint
      : JA.stepGuide.assemblePartsHintFor(missing);
  }
  if (key === 'wire') return JA.stepGuide.assembleWireHint;
  if (key === 'power') return JA.stepGuide.powerHint;
  if (key === 'judge') return JA.stepGuide.judgeHint;
  return undefined;
}

/** いまの手順にだけ効く1行の案内（モードC1）。 */
export function inspectPartsStepHint(key: InspectPartsStepKey | undefined): string | undefined {
  if (key === 'plug') return JA.stepGuide.inspectPlugHint;
  if (key === 'power') return JA.stepGuide.powerHint;
  if (key === 'measure') return JA.stepGuide.inspectMeasureHint;
  if (key === 'mark') return JA.stepGuide.inspectMarkHint;
  if (key === 'judge') return JA.stepGuide.judgeHint;
  return undefined;
}

/** いまの手順にだけ効く1行の案内（モードC2）。 */
export function inspectRepairStepHint(key: InspectRepairStepKey | undefined): string | undefined {
  if (key === 'report') return JA.stepGuide.repairReportHint;
  if (key === 'fix') return JA.stepGuide.repairFixHint;
  if (key === 'judge') return JA.stepGuide.judgeHint;
  return undefined;
}

/**
 * 回路実験・PLC実験の手順キー（2026-10-08）。
 * 入力を描く → 正解を作る（任意）→（PLCはラダー）→ 配線 → 動かす → 判定
 */
export type LabStepKey = 'inputs' | 'expected' | 'ladder' | 'wire' | 'run' | 'judge';

/**
 * 実験の手順帯。正解を作るのは任意なので「いつでも」（描いたら「済」）にし、ほかは
 * 一直線に「いまここ」を進める。`ladder` を渡したとき（PLC実験）だけラダーの段を入れる。
 */
export function labSteps(input: {
  /** 押し方を1区間でも描いたか。 */
  inputs: boolean;
  /** 正解を描いたか。 */
  expected: boolean;
  /** PLC実験: ラダーを書いて変換を通したか（回路実験では渡さない）。 */
  ladder?: boolean | undefined;
  /** 配線したか（配線済みの盤なら真）。 */
  wired: boolean;
  /** 「動かす」をしたか。 */
  ran: boolean;
}): ReadonlyArray<GuideStep<LabStepKey>> {
  const steps = sequentialSteps<LabStepKey>([
    { key: 'inputs', label: JA.stepGuide.labInputs, done: input.inputs },
    ...(input.ladder === undefined
      ? []
      : [{ key: 'ladder' as const, label: JA.stepGuide.labLadder, done: input.ladder }]),
    { key: 'wire', label: JA.stepGuide.labWire, done: input.wired },
    { key: 'run', label: JA.stepGuide.labRun, done: input.ran },
    { key: 'judge', label: JA.stepGuide.labJudge, done: false },
  ]);
  const expected: GuideStep<LabStepKey> = {
    key: 'expected',
    label: JA.stepGuide.labExpected,
    state: input.expected ? 'done' : 'anytime',
  };
  return [steps[0]!, expected, ...steps.slice(1)];
}

/** いまの手順にだけ効く1行の案内（実験）。 */
export function labStepHint(
  key: LabStepKey | undefined,
  context: { expected: boolean; plc: boolean },
): string | undefined {
  if (key === 'inputs') return JA.stepGuide.labInputsHint;
  if (key === 'ladder') return JA.stepGuide.labLadderHint;
  if (key === 'wire') return context.plc ? JA.stepGuide.labWirePlcHint : JA.stepGuide.labWireHint;
  if (key === 'run') return JA.stepGuide.labRunHint;
  if (key === 'judge')
    return context.expected ? JA.stepGuide.labJudgeHint : JA.stepGuide.labNeedsExpectedHint;
  return undefined;
}

// --- Plan 5 Task 4 ---

/** 回路図エディタの手順キー（描く → 検算 → 盤に配線）。Plan 5 決定表#24 */
export type SchematicStepKey = 'draw' | 'verify' | 'wire';

/** 回路図エディタの手順帯。 */
export function schematicSteps(input: {
  /** 回路図に置かれている要素の数。 */
  cellCount: number;
  /** 検算に合格したか。 */
  verified: boolean;
  /** 盤に電線を1本でも張ったか（固定配線は数えない）。 */
  boardWired: boolean;
}): ReadonlyArray<GuideStep<SchematicStepKey>> {
  const drawDone = input.cellCount > 0;
  const verifyDone = drawDone && input.verified;
  const wireDone = verifyDone && input.boardWired;
  return sequentialSteps([
    { key: 'draw', label: JA.stepGuide.schematicDraw, done: drawDone },
    { key: 'verify', label: JA.stepGuide.schematicVerify, done: verifyDone },
    { key: 'wire', label: JA.stepGuide.schematicWire, done: wireDone },
  ]);
}

/** いまの手順にだけ効く1行の案内（回路図エディタ）。 */
export function schematicStepHint(key: SchematicStepKey | undefined): string | undefined {
  if (key === 'draw') return JA.stepGuide.schematicDrawHint;
  if (key === 'verify') return JA.stepGuide.schematicVerifyHint;
  if (key === 'wire') return JA.stepGuide.schematicWireHint;
  return undefined;
}

// --- /Plan 5 Task 4 ---
