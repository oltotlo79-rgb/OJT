import type { AssembleProblem } from '../schema/assemble.js';
import {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  isPlcProblem,
  parseProblem,
  type ProblemIssue,
  type SupportedProblem,
} from '../schema/index.js';
import type { InspectPartsProblem } from '../schema/inspect-parts.js';
import type { InspectRepairProblem } from '../schema/inspect-repair.js';
import type { PlcProblem } from '../schema/plc.js';
import selfHold from './assemble/b-001-self-hold.json' with { type: 'json' };
import interlock from './assemble/b-002-interlock.json' with { type: 'json' };
import onDelay from './assemble/b-003-on-delay.json' with { type: 'json' };
import sequential from './assemble/b-004-sequential.json' with { type: 'json' };
import oneShot from './assemble/b-005-one-shot.json' with { type: 'json' };
import flicker from './assemble/b-006-flicker.json' with { type: 'json' };
import firstPress from './assemble/b-007-first-press.json' with { type: 'json' };
import stopPriority from './assemble/b-008-stop-priority.json' with { type: 'json' };
import relayBasic from './inspect-parts/c1-001-relay-basic.json' with { type: 'json' };
import layerShort from './inspect-parts/c1-002-layer-short.json' with { type: 'json' };
import timerCheck from './inspect-parts/c1-003-timer.json' with { type: 'json' };
import mixedCheck from './inspect-parts/c1-004-mixed.json' with { type: 'json' };
import c2SelfHold from './inspect-repair/c2-001-self-hold.json' with { type: 'json' };
import c2SelfHoldContact from './inspect-repair/c2-002-self-hold-contact.json' with { type: 'json' };
import c2OnDelay from './inspect-repair/c2-003-on-delay.json' with { type: 'json' };
import c2OneShot from './inspect-repair/c2-004-one-shot.json' with { type: 'json' };
import c2Interlock from './inspect-repair/c2-005-interlock.json' with { type: 'json' };
import c2Sequential from './inspect-repair/c2-006-sequential.json' with { type: 'json' };
import c2Flicker from './inspect-repair/c2-007-flicker.json' with { type: 'json' };
import c2StopPriority from './inspect-repair/c2-008-stop-priority.json' with { type: 'json' };
import d001 from './plc/d-001-self-hold.json' with { type: 'json' };
import d002 from './plc/d-002-interlock.json' with { type: 'json' };
import d003 from './plc/d-003-on-delay.json' with { type: 'json' };
import d004 from './plc/d-004-one-shot.json' with { type: 'json' };

/**
 * 内蔵課題。設計仕様 §7.8 / §7.9（モードB 8題・モードC1 4セット・モードC2 8題）。
 * JSONを直接読み、`parseProblem()` を通した結果だけを公開する。
 * 1件でも検証に落ちたら読み込み時に例外を投げるので、壊れた内蔵課題はビルド／テストで必ず落ちる。
 *
 * JSONのimportには **import attributes**（`with { type: 'json' }`）を必ず付ける。
 * Vite / Vitest は属性が無くても読めてしまうが、素の Node ESM（Electronのメインプロセス）は
 * `ERR_IMPORT_ATTRIBUTE_MISSING` で落ちる。`test/builtin-node-esm.test.ts` が見張っている。
 */

/** 内蔵のモードB課題のJSON。 */
const BUILTIN_ASSEMBLE_JSON: readonly unknown[] = [
  selfHold,
  interlock,
  onDelay,
  sequential,
  oneShot,
  flicker,
  firstPress,
  stopPriority,
];

/** 内蔵のモードC1課題のJSON。 */
const BUILTIN_INSPECT_PARTS_JSON: readonly unknown[] = [
  relayBasic,
  layerShort,
  timerCheck,
  mixedCheck,
];

/** 内蔵のモードC2課題のJSON。 */
const BUILTIN_INSPECT_REPAIR_JSON: readonly unknown[] = [
  c2SelfHold,
  c2SelfHoldContact,
  c2OnDelay,
  c2OneShot,
  c2Interlock,
  c2Sequential,
  c2Flicker,
  c2StopPriority,
];

/** 内蔵のモードD課題のJSON。 */
const BUILTIN_PLC_JSON: readonly unknown[] = [d001, d002, d003, d004];

/** 内蔵課題の検証に失敗したときに投げる。 */
export class BuiltinProblemError extends Error {
  constructor(
    message: string,
    readonly issues: ProblemIssue[],
  ) {
    super(message);
    this.name = 'BuiltinProblemError';
  }
}

/** 内蔵課題のJSONを検証する。1件でも落ちたら `BuiltinProblemError` を投げる。§7.8 */
export function parseBuiltinProblems(sources: readonly unknown[]): SupportedProblem[] {
  return sources.map((source, index) => {
    const parsed = parseProblem(source);
    if (parsed.ok) return parsed.problem;
    throw new BuiltinProblemError(
      `内蔵課題[${index}]（${parsed.id ?? '不明'}）が読めません: ${parsed.message}`,
      parsed.issues,
    );
  });
}

/**
 * 期待したモードの課題だけを取り出す（違うモードが混ざっていたら例外）。
 * テストからも直接呼べるよう export する（誤って混ざったときに例外が飛ぶことを検証するため）。
 */
export function ofMode<T extends SupportedProblem>(
  problems: readonly SupportedProblem[],
  guard: (problem: SupportedProblem) => problem is T,
  label: string,
): T[] {
  return problems.map((problem, index) => {
    if (guard(problem)) return problem;
    throw new BuiltinProblemError(
      `内蔵課題[${index}]（${problem.id}）は${label}ではありません`,
      [],
    );
  });
}

/** 内蔵のモードB課題（8題）。§7.9 */
export const BUILTIN_ASSEMBLE_PROBLEMS: readonly AssembleProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_ASSEMBLE_JSON),
  isAssembleProblem,
  'モードB課題',
);

/** 内蔵のモードC1課題（4セット）。§7.9 */
export const BUILTIN_INSPECT_PARTS_PROBLEMS: readonly InspectPartsProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_INSPECT_PARTS_JSON),
  isInspectPartsProblem,
  'モードC1課題',
);

/** 内蔵のモードC2課題（8題）。§7.9 */
export const BUILTIN_INSPECT_REPAIR_PROBLEMS: readonly InspectRepairProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_INSPECT_REPAIR_JSON),
  isInspectRepairProblem,
  'モードC2課題',
);

/** 内蔵のモードD課題（8題）。§7.9 */
export const BUILTIN_PLC_PROBLEMS: readonly PlcProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_PLC_JSON),
  isPlcProblem,
  'モードD課題',
);

/**
 * 課題一覧に載せる内蔵課題。
 * **Plan 2A ではモードBのままにしてある**（C1/C2を開始できる画面が入るのは Plan 2B のため）。
 * Plan 2B が `BUILTIN_ALL_PROBLEMS` に差し替えると同時に、モード別の課題一覧を入れる。
 */
export const BUILTIN_PROBLEMS: readonly AssembleProblem[] = BUILTIN_ASSEMBLE_PROBLEMS;

/** 内蔵課題すべて（モードB＋C1＋C2＋D）。§7.9 */
export const BUILTIN_ALL_PROBLEMS: readonly SupportedProblem[] = [
  ...BUILTIN_ASSEMBLE_PROBLEMS,
  ...BUILTIN_INSPECT_PARTS_PROBLEMS,
  ...BUILTIN_INSPECT_REPAIR_PROBLEMS,
  ...BUILTIN_PLC_PROBLEMS,
];

/** 内蔵課題をIDで引く（全モードから探す）。 */
export function findBuiltinProblem(id: string): SupportedProblem | undefined {
  return BUILTIN_ALL_PROBLEMS.find((p) => p.id === id);
}
