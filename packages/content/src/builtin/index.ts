import {
  EXTRA_ASSEMBLE,
  EXTRA_INSPECT_PARTS,
  EXTRA_INSPECT_REPAIR,
  EXTRA_PLC,
} from './expanded.js';
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
import momentary from './assemble/b-009-momentary.json' with { type: 'json' };
import andLamp from './assemble/b-010-and-lamp.json' with { type: 'json' };
import orLamp from './assemble/b-011-or-lamp.json' with { type: 'json' };
import selfHoldStop from './assemble/b-012-self-hold-stop.json' with { type: 'json' };
import twoHand from './assemble/b-013-two-hand.json' with { type: 'json' };
import offDelay from './assemble/b-014-off-delay.json' with { type: 'json' };
import mutualInterlock from './assemble/b-015-mutual-interlock.json' with { type: 'json' };
import threeStep from './assemble/b-016-three-step.json' with { type: 'json' };
import lastPress from './assemble/b-017-last-press.json' with { type: 'json' };
import flickerAlarm from './assemble/b-018-flicker-alarm.json' with { type: 'json' };
import conditionalHold from './assemble/b-019-conditional-hold.json' with { type: 'json' };
import twoTimer from './assemble/b-020-two-timer.json' with { type: 'json' };
import relayBasic from './inspect-parts/c1-001-relay-basic.json' with { type: 'json' };
import layerShort from './inspect-parts/c1-002-layer-short.json' with { type: 'json' };
import timerCheck from './inspect-parts/c1-003-timer.json' with { type: 'json' };
import mixedCheck from './inspect-parts/c1-004-mixed.json' with { type: 'json' };
import aOpenCheck from './inspect-parts/c1-005-a-open.json' with { type: 'json' };
import weldOpenCheck from './inspect-parts/c1-006-weld-open.json' with { type: 'json' };
import coilFaultCheck from './inspect-parts/c1-007-coil-fault.json' with { type: 'json' };
import timerContactCheck from './inspect-parts/c1-008-timer-contact.json' with { type: 'json' };
import mostlyNormalCheck from './inspect-parts/c1-009-mostly-normal.json' with { type: 'json' };
import bWeldMixedCheck from './inspect-parts/c1-010-b-weld-mixed.json' with { type: 'json' };
import relayTimerMixedCheck from './inspect-parts/c1-011-relay-timer-mixed.json' with { type: 'json' };
import allTruthsCheck from './inspect-parts/c1-012-all-truths.json' with { type: 'json' };
import c2SelfHold from './inspect-repair/c2-001-self-hold.json' with { type: 'json' };
import c2SelfHoldContact from './inspect-repair/c2-002-self-hold-contact.json' with { type: 'json' };
import c2OnDelay from './inspect-repair/c2-003-on-delay.json' with { type: 'json' };
import c2OneShot from './inspect-repair/c2-004-one-shot.json' with { type: 'json' };
import c2Interlock from './inspect-repair/c2-005-interlock.json' with { type: 'json' };
import c2Sequential from './inspect-repair/c2-006-sequential.json' with { type: 'json' };
import c2Flicker from './inspect-repair/c2-007-flicker.json' with { type: 'json' };
import c2StopPriority from './inspect-repair/c2-008-stop-priority.json' with { type: 'json' };
import c2AndLamp from './inspect-repair/c2-009-and-lamp.json' with { type: 'json' };
import c2OrLamp from './inspect-repair/c2-010-or-lamp.json' with { type: 'json' };
import c2SelfHoldStop from './inspect-repair/c2-011-self-hold-stop.json' with { type: 'json' };
import c2TwoHand from './inspect-repair/c2-012-two-hand.json' with { type: 'json' };
import c2OffDelay from './inspect-repair/c2-013-off-delay.json' with { type: 'json' };
import c2MutualInterlock from './inspect-repair/c2-014-mutual-interlock.json' with { type: 'json' };
import c2ThreeStep from './inspect-repair/c2-015-three-step.json' with { type: 'json' };
import c2LastPress from './inspect-repair/c2-016-last-press.json' with { type: 'json' };
import c2FlickerAlarm from './inspect-repair/c2-017-flicker-alarm.json' with { type: 'json' };
import c2ConditionalHold from './inspect-repair/c2-018-conditional-hold.json' with { type: 'json' };
import c2TwoTimer from './inspect-repair/c2-019-two-timer.json' with { type: 'json' };
import c2Random from './inspect-repair/c2-020-random.json' with { type: 'json' };
import d001 from './plc/d-001-self-hold.json' with { type: 'json' };
import d002 from './plc/d-002-interlock.json' with { type: 'json' };
import d003 from './plc/d-003-on-delay.json' with { type: 'json' };
import d004 from './plc/d-004-one-shot.json' with { type: 'json' };
import d005 from './plc/d-005-sequential.json' with { type: 'json' };
import d006 from './plc/d-006-flicker.json' with { type: 'json' };
import d007 from './plc/d-007-counter.json' with { type: 'json' };
import d008 from './plc/d-008-stop-priority.json' with { type: 'json' };
import d009 from './plc/d-009-momentary.json' with { type: 'json' };
import d010 from './plc/d-010-and-or.json' with { type: 'json' };
import d011 from './plc/d-011-set-reset.json' with { type: 'json' };
import d012 from './plc/d-012-edge-one-shot.json' with { type: 'json' };
import d013 from './plc/d-013-off-delay.json' with { type: 'json' };
import d014 from './plc/d-014-interlock.json' with { type: 'json' };
import d015 from './plc/d-015-three-step.json' with { type: 'json' };
import d016 from './plc/d-016-counter-steps.json' with { type: 'json' };
import d017 from './plc/d-017-counter-alarm.json' with { type: 'json' };
import d018 from './plc/d-018-clock-flicker.json' with { type: 'json' };
import d019 from './plc/d-019-master-control.json' with { type: 'json' };
import d020 from './plc/d-020-comprehensive.json' with { type: 'json' };

/**
 * 内蔵課題。設計仕様 §7.8 / §7.9（モードB 20題・モードC1 12セット・モードC2 20題・モードD 20題）。
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
  momentary,
  andLamp,
  orLamp,
  selfHoldStop,
  twoHand,
  offDelay,
  mutualInterlock,
  threeStep,
  lastPress,
  flickerAlarm,
  conditionalHold,
  twoTimer,
  ...EXTRA_ASSEMBLE,
];

/** 内蔵のモードC1課題のJSON。 */
const BUILTIN_INSPECT_PARTS_JSON: readonly unknown[] = [
  relayBasic,
  layerShort,
  timerCheck,
  mixedCheck,
  aOpenCheck,
  weldOpenCheck,
  coilFaultCheck,
  timerContactCheck,
  mostlyNormalCheck,
  bWeldMixedCheck,
  relayTimerMixedCheck,
  allTruthsCheck,
  ...EXTRA_INSPECT_PARTS,
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
  c2AndLamp,
  c2OrLamp,
  c2SelfHoldStop,
  c2TwoHand,
  c2OffDelay,
  c2MutualInterlock,
  c2ThreeStep,
  c2LastPress,
  c2FlickerAlarm,
  c2ConditionalHold,
  c2TwoTimer,
  c2Random,
  ...EXTRA_INSPECT_REPAIR,
];

/** 内蔵のモードD課題のJSON。 */
const BUILTIN_PLC_JSON: readonly unknown[] = [
  d001,
  d002,
  d003,
  d004,
  d005,
  d006,
  d007,
  d008,
  d009,
  d010,
  d011,
  d012,
  d013,
  d014,
  d015,
  d016,
  d017,
  d018,
  d019,
  d020,
  ...EXTRA_PLC,
];

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

/** 内蔵のモードB課題（60題）。§7.9 */
export const BUILTIN_ASSEMBLE_PROBLEMS: readonly AssembleProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_ASSEMBLE_JSON),
  isAssembleProblem,
  'モードB課題',
);

/** 内蔵のモードC1課題（36セット）。§7.9 */
export const BUILTIN_INSPECT_PARTS_PROBLEMS: readonly InspectPartsProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_INSPECT_PARTS_JSON),
  isInspectPartsProblem,
  'モードC1課題',
);

/** 内蔵のモードC2課題（60題）。§7.9 */
export const BUILTIN_INSPECT_REPAIR_PROBLEMS: readonly InspectRepairProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_INSPECT_REPAIR_JSON),
  isInspectRepairProblem,
  'モードC2課題',
);

/** 内蔵のモードD課題（60題）。§7.9 */
export const BUILTIN_PLC_PROBLEMS: readonly PlcProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_PLC_JSON),
  isPlcProblem,
  'モードD課題',
);

/**
 * モードB課題だけの別名（CT-09）。
 * 課題一覧に載せるのは `BUILTIN_ALL_PROBLEMS`（Plan 2B でモード別の一覧が入った）であり、
 * この名前は「モードBの1題が要る」テストと `apps/desktop` の複写枚数の検査が使っている。
 * 中身は `BUILTIN_ASSEMBLE_PROBLEMS` と同じ配列で、増えるのもモードB課題だけである。
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
