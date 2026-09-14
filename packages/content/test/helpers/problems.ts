import { AssembleProblemSchema, type AssembleProblem } from '../../src/schema/assemble.js';

/** 課題JSONの骨組み(テストごとに必要な部分だけ差し替える)。 */
export const TASK2_ROLES = { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' } as const;

/** 自己保持回路の最小課題(テストの土台)。 */
export function selfHoldProblemJson(): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'x-001',
    mode: 'assemble',
    title: 'テスト用 自己保持回路',
    grade: 3,
    description: 'テスト用',
    timeLimit: { standardMin: 30, cutoffMin: 50 },
    board: { boardId: 'board-jipm-std', socketRoles: TASK2_ROLES },
    inventory: [
      { kind: 'relay-my4n', count: 2 },
      { kind: 'timer-h3y4', count: 2 },
    ],
    schematic: {
      formatVersion: 1,
      id: 'sch-x-001',
      title: 'テスト用 自己保持回路',
      orientation: 'horizontal',
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 'pb-b', id: 'c01', device: 'PB2' },
            { kind: 'pb-a', id: 'c02', device: 'PB1' },
            { kind: 'coil', id: 'c03', device: 'CR1' },
          ],
        },
        {
          id: 'r1h',
          from: { rung: 'r1', node: 1 },
          to: { rung: 'r1', node: 2 },
          cells: [{ kind: 'cr-a', id: 'c04', device: 'CR1' }],
        },
        {
          id: 'r2',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 'cr-a', id: 'c05', device: 'CR1' },
            { kind: 'lamp', id: 'c06', device: 'PL1' },
          ],
        },
      ],
    },
    operations: [
      { t: 500, target: 'PB1', action: 'press' },
      { t: 800, target: 'PB1', action: 'release' },
      { t: 3000, target: 'PB2', action: 'press' },
      { t: 3300, target: 'PB2', action: 'release' },
    ],
    durationMs: 5000,
    judge: {
      tolerance: { edgeMs: 200, ratio: 0.1 },
      staticChecks: {
        wireColorRule: true,
        terminalLimit: true,
        unusedParts: true,
        forbiddenCircuit: true,
        coilPolarity: true,
        powerSequence: true,
      },
    },
    hints: { schematicVisible: true },
  };
}

/** 禁則回路(タイマ自身の限時b接点で自コイルを切るワンショット)の課題。調査資料 §5.5 */
export function forbiddenOneShotProblemJson(): Record<string, unknown> {
  return {
    ...selfHoldProblemJson(),
    id: 'x-002',
    title: 'テスト用 禁則ワンショット',
    schematic: {
      formatVersion: 1,
      id: 'sch-x-002',
      title: 'テスト用 禁則ワンショット',
      orientation: 'horizontal',
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-b', id: 'c01', device: 'T1' },
            { kind: 'coil', id: 'c02', device: 'T1', presetMs: 500 },
          ],
        },
        {
          id: 'r2',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-a', id: 'c03', device: 'T1' },
            { kind: 'lamp', id: 'c04', device: 'PL1' },
          ],
        },
      ],
    },
    operations: [],
    durationMs: 3000,
  };
}

/** 課題JSONを検証済みの課題にする(テスト側で失敗したら即エラーにする)。 */
export function parseOrThrow(json: unknown): AssembleProblem {
  const parsed = AssembleProblemSchema.safeParse(json);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
  return parsed.data;
}
