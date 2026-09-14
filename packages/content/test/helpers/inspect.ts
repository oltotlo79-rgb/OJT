import {
  InspectPartsProblemSchema,
  type InspectPartsProblem,
} from '../../src/schema/inspect-parts.js';

/**
 * C1/C2のテスト用課題JSONの骨組み。呼ぶたびに新しいオブジェクトを返す
 * （共有の定数にすると、1つのテストの書き換えが他のテストの土台まで壊す）。
 */

/** チェック用ソケットだけを割り当てた盤指定。§9.1 */
export function checkOnlyRoles(): Record<string, string> {
  return { S7: 'CHK' };
}

/** モードC1の最小課題（正常1・コイル断線1・レアショート1・a接点溶着1）。 */
export function inspectPartsProblemJson(): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'x-c1',
    mode: 'inspect-parts',
    title: 'テスト用 部品点検',
    grade: 2,
    description: 'テスト用',
    timeLimit: { standardMin: 30, cutoffMin: 50 },
    board: { boardId: 'board-jipm-std', socketRoles: checkOnlyRoles() },
    inventory: [],
    parts: [
      { id: 'p1', kind: 'relay-my4n', truth: 'normal' },
      { id: 'p2', kind: 'relay-my4n', truth: 'coil-open' },
      { id: 'p3', kind: 'relay-my4n', truth: 'coil-layer-short', ratio: 0.65 },
      { id: 'p4', kind: 'timer-h3y4', truth: 'a-weld', group: 1 },
    ],
    seed: 20260914,
  };
}

/** 課題JSONを検証済みのC1課題にする（失敗したら即エラーにする）。 */
export function parseInspectPartsOrThrow(json: unknown): InspectPartsProblem {
  const parsed = InspectPartsProblemSchema.safeParse(json);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
  return parsed.data;
}
