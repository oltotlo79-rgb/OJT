import { BUILTIN_ASSEMBLE_PROBLEMS, BUILTIN_INSPECT_PARTS_PROBLEMS } from '@ojt/content';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { toSchematicDoc, toWorkFile } from '../src/renderer/session/work-file.js';

/**
 * 検算の状態遷移（§11.4 / Plan 5 Task 6）。**ストアの側**だけを確かめる（Worker は立てない）。
 * Worker の往復そのものは `sim-worker-verify.test.ts` が見ている。
 */

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
const partsProblem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
if (problem === undefined || partsProblem === undefined) throw new Error('内蔵課題がありません');
const pb1 = {
  kind: 'insertCell',
  rungId: 'r1',
  index: 0,
  draft: { kind: 'pb-a', device: 'PB1' },
} as const;

beforeEach(() => {
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
  });
});

describe('検算の状態遷移（§11.4）', () => {
  it('starts every mode-B session with an empty draft (決定表#2)', () => {
    const doc = useStore.getState().schematicDoc;
    expect(doc?.rungs).toHaveLength(1);
    expect(doc?.rungs[0]?.cells).toEqual([]);
    expect(doc?.id).toBe(`draft-${problem.id}`);
    expect(useStore.getState().verifying).toBe(false);
    expect(useStore.getState().verifyResult).toBeUndefined();
  });

  it('keeps no draft for C1 / C2 / D problems', () => {
    act(() => {
      useStore.getState().openProblem(partsProblem);
    });
    expect(useStore.getState().schematicDoc).toBeUndefined();
  });

  it('pushes the previous document on every accepted edit and drops the stale verify result', () => {
    act(() => {
      useStore.getState().setVerifyResult({ ok: false, errors: [] });
      useStore.getState().applySchematicEdit(pb1);
    });
    const state = useStore.getState();
    expect(state.schematicHistory.done).toHaveLength(1);
    expect(state.schematicHistory.done[0]?.rungs[0]?.cells).toEqual([]);
    expect(state.verifyResult).toBeUndefined();
  });

  it('refuses an impossible edit with a toast and leaves the document alone', () => {
    let accepted = true;
    act(() => {
      accepted = useStore.getState().applySchematicEdit({ kind: 'removeCell', cellId: 'c9' });
    });
    expect(accepted).toBe(false);
    expect(useStore.getState().toasts.at(-1)?.text).toContain('要素がありません');
    expect(useStore.getState().schematicHistory.done).toHaveLength(0);
  });

  it('undoes and redoes the draft', () => {
    act(() => {
      useStore.getState().applySchematicEdit(pb1);
      useStore.getState().undoSchematicEdit();
    });
    expect(useStore.getState().schematicDoc?.rungs[0]?.cells).toEqual([]);
    act(() => {
      useStore.getState().redoSchematicEdit();
    });
    expect(useStore.getState().schematicDoc?.rungs[0]?.cells).toHaveLength(1);
  });

  it('clamps the cursor when the rung under it disappears', () => {
    act(() => {
      const store = useStore.getState();
      store.applySchematicEdit({ kind: 'addRung' });
      store.setSchematicCursor({ rungId: 'r2', index: 0 });
      store.applySchematicEdit({ kind: 'removeRung', rungId: 'r2' });
    });
    expect(useStore.getState().schematicCursor).toEqual({ rungId: 'r1', index: 0 });
  });

  it('round-trips the draft through the work file and ignores a broken one', () => {
    act(() => {
      useStore.getState().applySchematicEdit(pb1);
    });
    const state = useStore.getState();
    const session = state.session;
    if (session === undefined) throw new Error('盤がありません');
    const file = toWorkFile(problem.id, session, state.elapsedMs, 0);
    const restored = toSchematicDoc(file.schematic);
    expect(restored?.rungs).toHaveLength(1);
    expect(restored?.rungs[0]?.cells).toHaveLength(1);
    expect(toSchematicDoc({ formatVersion: 9, rungs: [] })).toBeUndefined();
    expect(toSchematicDoc('not a document')).toBeUndefined();
  });

  it('takes a restored draft and forgets everything when the problem is left', () => {
    const doc = useStore.getState().schematicDoc;
    if (doc === undefined) throw new Error('下書きがありません');
    act(() => {
      // 作業ファイルからの復元（`restoreInspectState()` が通る道）
      useStore.getState().setSchematicDoc({ ...doc, title: '復元した下書き' });
      useStore.getState().applySchematicEdit(pb1);
    });
    expect(useStore.getState().schematicDoc?.title).toBe('復元した下書き');
    expect(useStore.getState().schematicDoc?.rungs[0]?.cells).toHaveLength(1);
    act(() => {
      useStore.getState().abandonSession();
    });
    const left = useStore.getState();
    expect(left.schematicDoc).toBeUndefined();
    expect(left.schematicHistory.done).toEqual([]);
    expect(left.verifyResult).toBeUndefined();
  });
});
