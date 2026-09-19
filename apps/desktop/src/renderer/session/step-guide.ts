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

/** モードBの手順帯。 */
export function assembleSteps(input: {
  /** 未装着の部品の種類数（0で全部装着済み）。 */
  partsRemaining: number;
  /** いまの電線の本数。 */
  wireCount: number;
  /** 固定（訓練者が外せない）電線の本数。 */
  fixedWireCount: number;
  /** 通電しているか。 */
  powered: boolean;
}): ReadonlyArray<GuideStep<AssembleStepKey>> {
  const partsDone = input.partsRemaining <= 0;
  const wireDone = partsDone && input.wireCount > input.fixedWireCount;
  const powerDone = wireDone && input.powered;
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
  const powerDone = plugDone && input.powered;
  const measureDone = powerDone && input.probed;
  const markDone = measureDone && input.answered;
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
  /** 指摘が1件以上登録されているか。 */
  reported: boolean;
  /** 白線を張ったか、部品を交換したか（=修復の作業をしたか）。 */
  repaired: boolean;
}): ReadonlyArray<GuideStep<InspectRepairStepKey>> {
  const reportDone = input.reported;
  const fixDone = reportDone && input.repaired;
  return sequentialSteps([
    { key: 'report', label: JA.stepGuide.repairReport, done: reportDone },
    { key: 'fix', label: JA.stepGuide.repairFix, done: fixDone },
    { key: 'judge', label: JA.stepGuide.repairJudge, done: false },
  ]);
}

/** いまの手順にだけ効く1行の案内（`PlcSession.tsx` の `stepHintText` と同じ方針）。 */
export function assembleStepHint(key: AssembleStepKey | undefined): string | undefined {
  if (key === 'parts') return JA.stepGuide.assemblePartsHint;
  if (key === 'wire') return JA.stepGuide.assembleWireHint;
  if (key === 'power') return JA.stepGuide.assemblePowerHint;
  if (key === 'judge') return JA.stepGuide.assembleJudgeHint;
  return undefined;
}

/** いまの手順にだけ効く1行の案内（モードC1）。 */
export function inspectPartsStepHint(key: InspectPartsStepKey | undefined): string | undefined {
  if (key === 'plug') return JA.stepGuide.inspectPlugHint;
  if (key === 'power') return JA.stepGuide.inspectPowerHint;
  if (key === 'measure') return JA.stepGuide.inspectMeasureHint;
  if (key === 'mark') return JA.stepGuide.inspectMarkHint;
  if (key === 'judge') return JA.stepGuide.inspectJudgeHint;
  return undefined;
}

/** いまの手順にだけ効く1行の案内（モードC2）。 */
export function inspectRepairStepHint(key: InspectRepairStepKey | undefined): string | undefined {
  if (key === 'report') return JA.stepGuide.repairReportHint;
  if (key === 'fix') return JA.stepGuide.repairFixHint;
  if (key === 'judge') return JA.stepGuide.repairJudgeHint;
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
