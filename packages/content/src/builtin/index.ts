import type { AssembleProblem } from '../schema/assemble.js';
import { parseProblem, type ProblemIssue } from '../schema/index.js';
import selfHold from './assemble/b-001-self-hold.json' with { type: 'json' };
import interlock from './assemble/b-002-interlock.json' with { type: 'json' };
import onDelay from './assemble/b-003-on-delay.json' with { type: 'json' };
import sequential from './assemble/b-004-sequential.json' with { type: 'json' };
import oneShot from './assemble/b-005-one-shot.json' with { type: 'json' };
import flicker from './assemble/b-006-flicker.json' with { type: 'json' };
import firstPress from './assemble/b-007-first-press.json' with { type: 'json' };
import stopPriority from './assemble/b-008-stop-priority.json' with { type: 'json' };

/**
 * 内蔵課題。設計仕様 §7.8 / §7.9（モードB = 8題）。
 * JSONを直接読み、`parseProblem()` を通した結果だけを公開する。
 * 1件でも検証に落ちたら読み込み時に例外を投げるので、壊れた内蔵課題はビルド／テストで必ず落ちる。
 *
 * JSONのimportには **import attributes**（`with { type: 'json' }`）を必ず付ける。
 * Vite / Vitest は属性が無くても読めてしまうが、素の Node ESM（Electronのメインプロセス）は
 * `ERR_IMPORT_ATTRIBUTE_MISSING` で落ちる。`test/builtin-node-esm.test.ts` が見張っている。
 */

/** 内蔵課題のJSON（`resources/content/assemble/<id>.json` と同じ内容）。 */
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
export function parseBuiltinProblems(sources: readonly unknown[]): AssembleProblem[] {
  return sources.map((source, index) => {
    const parsed = parseProblem(source);
    if (parsed.ok) return parsed.problem;
    throw new BuiltinProblemError(
      `内蔵課題[${index}]（${parsed.id ?? '不明'}）が読めません: ${parsed.message}`,
      parsed.issues,
    );
  });
}

/** 内蔵のモードB課題（8題）。§7.9 */
export const BUILTIN_ASSEMBLE_PROBLEMS: readonly AssembleProblem[] =
  parseBuiltinProblems(BUILTIN_ASSEMBLE_JSON);

/** 内蔵課題すべて（Phase 1 はモードBのみ）。§16 */
export const BUILTIN_PROBLEMS: readonly AssembleProblem[] = BUILTIN_ASSEMBLE_PROBLEMS;

/** 内蔵課題をIDで引く。 */
export function findBuiltinProblem(id: string): AssembleProblem | undefined {
  return BUILTIN_PROBLEMS.find((p) => p.id === id);
}
