/** 課題JSONに書くセル（`schema/ladder.ts` の入力形式）。 */
export type CellJson = Record<string, unknown>;

/** a接点。 */
export const noJson = (kind: string, index: number): CellJson => ({
  kind: 'contact',
  type: 'NO',
  device: { kind, index },
});
/** b接点。 */
export const ncJson = (kind: string, index: number): CellJson => ({
  kind: 'contact',
  type: 'NC',
  device: { kind, index },
});
/** OUTコイル。 */
export const outJson = (index: number): CellJson => ({
  kind: 'coil',
  type: 'OUT',
  device: { kind: 'output', index },
});
/**
 * 1行ぶんのセル。コイル列への送りと横線の穴埋めは `LadderProgramSchema` が行うので、
 * ここでは使うセルを並べるだけでよい（§10.3 / Task 11 の詰め方の規則）。
 */
export function rungJson(...cells: CellJson[]): CellJson[] {
  return [...cells];
}

/** X0 が入ると Y0 が出るだけの最小ラダー。 */
export function simpleLadderJson(): Record<string, unknown> {
  return {
    networks: [
      { id: 'n1', cells: [rungJson(noJson('input', 0), outJson(0))] },
      { id: 'end', cells: [[{ kind: 'end' }]] },
    ],
  };
}

/** モードD課題JSONの骨組み（値は上書きして使う）。§7.6 */
export function plcProblemJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'd-test',
    mode: 'plc',
    title: 'テスト用PLC課題',
    grade: 2,
    description: 'X0 で Y0 を出す',
    timeLimit: { standardMin: 50, cutoffMin: 60 },
    board: {
      boardId: 'board-jipm-std',
      socketRoles: { S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S7: 'CHK' },
    },
    inventory: [{ kind: 'relay-my4n', count: 4 }],
    plc: { vendor: 'mitsubishi', model: 'FX5U' },
    io: { mode: 'fixed', inputs: [{ x: 0, pb: 'PB1' }], outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }] },
    referenceLadder: simpleLadderJson(),
    wiringRequired: true,
    operations: [
      { t: 0, target: 'PB1', action: 'press' },
      { t: 300, target: 'PB1', action: 'release' },
    ],
    durationMs: 3000,
    judge: { compareSignals: ['PL1'] },
    ...overrides,
  };
}
