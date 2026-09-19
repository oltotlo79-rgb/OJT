import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { COIL_COL, IR_COLS, no, out, X, Y } from '@ojt/ladder-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { applyLadderCell } from '../src/renderer/session/ladder.js';
import { toLadderProgram, toWorkFile } from '../src/renderer/session/work-file.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.getState().openProblem(problem);
});

describe('モードDの作業ファイル（§12.3 / 3A H-3）', () => {
  it('carries the ladder, the comments, the dialect and the converted flag', () => {
    const store = useStore.getState();
    const edited = applyLadderCell(store.ladder!, { networkId: 'n1', row: 0, col: 0 }, no(X(0)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    store.setDeviceComment('X0', '運転押ボタン');
    store.setConverted(true, { errors: [], warnings: [], usage: undefined, unused: undefined });
    const file = toWorkFile(problem.id, useStore.getState().session!, 1000, 0);
    expect(file.mode).toBe('plc');
    expect(file.dialectId).toBe('mitsubishi');
    expect(file.converted).toBe(true);
    const ladder = file.ladder as { networks: unknown[]; comments: Record<string, string> };
    expect(ladder.networks).toHaveLength(2);
    expect(ladder.comments['X0']).toBe('運転押ボタン');
  });

  it('round-trips through toLadderProgram', () => {
    const store = useStore.getState();
    const edited = applyLadderCell(
      store.ladder!,
      { networkId: 'n1', row: 0, col: COIL_COL },
      out(Y(0)),
    );
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);
    const parsed = toLadderProgram(file.ladder);
    expect(parsed?.program.networks).toHaveLength(2);
    expect(parsed?.program.networks[0]?.cols).toBe(IR_COLS);
  });

  it('refuses a ladder that is not shaped like the IR', () => {
    expect(toLadderProgram(undefined)).toBeUndefined();
    expect(toLadderProgram({ networks: 'x' })).toBeUndefined();
    expect(toLadderProgram({ networks: [] })).toBeUndefined();
    expect(
      toLadderProgram({ networks: [{ id: '', rows: 1, cols: 16, cells: [[]] }] }),
    ).toBeUndefined();
    expect(
      toLadderProgram({
        networks: [{ id: 'n1', rows: 1, cols: 16, cells: [[{ kind: 'quantum' }]] }],
      }),
    ).toBeUndefined();
    // 行数・列数・本数の上限
    const wide = {
      id: 'n1',
      rows: 1,
      cols: 16,
      cells: [Array.from({ length: 17 }, () => ({ kind: 'empty' }))],
    };
    expect(toLadderProgram({ networks: [wide] })).toBeUndefined();
    expect(
      toLadderProgram({
        networks: Array.from({ length: 65 }, (_u, i) => ({
          id: `n${String(i)}`,
          rows: 1,
          cols: 16,
          cells: [[{ kind: 'empty' }]],
        })),
      }),
    ).toBeUndefined();
  });

  it('refuses comments that break the caps (§10.7)', () => {
    const net = { id: 'n1', rows: 1, cols: 16, cells: [[{ kind: 'empty' }]] };
    expect(toLadderProgram({ networks: [net], comments: { X0: 'あ'.repeat(33) } })).toBeUndefined();
    expect(toLadderProgram({ networks: [net], comments: { 三: 'あ' } })).toBeUndefined();
    const many: Record<string, string> = {};
    for (let i = 0; i < 201; i += 1) many[`M${String(i)}`] = 'x';
    expect(toLadderProgram({ networks: [net], comments: many })).toBeUndefined();
  });

  it('restores a saved ladder with an empty history and an unconverted flag', () => {
    const store = useStore.getState();
    const edited = applyLadderCell(store.ladder!, { networkId: 'n1', row: 0, col: 0 }, no(X(1)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    store.setConverted(true, { errors: [], warnings: [], usage: undefined, unused: undefined });
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);

    useStore.getState().abandonSession();
    useStore.getState().openProblem(problem);
    const parsed = toLadderProgram(file.ladder);
    expect(parsed).toBeDefined();
    if (parsed === undefined) return;
    useStore.getState().restoreLadder(parsed.program, parsed.comments);
    const state = useStore.getState();
    expect(state.ladder?.networks[0]?.cells[0]?.[0]).toMatchObject({ kind: 'contact' });
    expect(state.ladderHistory.done).toEqual([]);
    expect(state.converted).toBe(false);
  });
});
