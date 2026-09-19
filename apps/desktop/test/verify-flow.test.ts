import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS, BUILTIN_INSPECT_PARTS_PROBLEMS } from '@ojt/content';
import { SCHEMATIC_FORMAT_VERSION } from '@ojt/schematic-core';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { keyToEdit, paletteFor } from '../src/renderer/session/schematic-edit.js';
import {
  MAX_RESTORED_RUNGS,
  restoreInspectState,
  toSchematicDoc,
  toWorkFile,
} from '../src/renderer/session/work-file.js';

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

/** いまの下書き（無ければ落ちる）。 */
function draft() {
  const doc = useStore.getState().schematicDoc;
  if (doc === undefined) throw new Error('下書きがありません');
  return doc;
}

/** 段の要素の機器名。 */
function devices(rungIndex = 0): string[] {
  return (draft().rungs[rungIndex]?.cells ?? []).map((c) => c.device);
}

describe('置いたあとのカーソル（レビュー I1: 打った順に並ぶ）', () => {
  it('advances the cursor so three Enters keep the typed order', () => {
    const palette = paletteFor(problem, JIPM_BOARD);
    const pick = (id: string) => {
      const found = palette.find((item) => item.id === id);
      if (found === undefined) throw new Error(`パレットにありません: ${id}`);
      return found;
    };
    // 画面の `Enter` が作る編集をそのままストアへ渡す（キーボードだけの操作の再現）
    for (const id of ['pb-b:PB2', 'pb-a:PB1', 'coil:CR1']) {
      act(() => {
        const store = useStore.getState();
        const edit = keyToEdit(draft(), store.schematicCursor, 'Enter', pick(id));
        if (edit === undefined) throw new Error('編集になりませんでした');
        store.applySchematicEdit(edit);
      });
    }
    expect(devices()).toEqual(['PB2', 'PB1', 'CR1']);
    expect(useStore.getState().schematicCursor).toEqual({ rungId: 'r1', index: 3 });
  });

  it('keeps the cursor on the element that was replaced', () => {
    act(() => {
      useStore.getState().applySchematicEdit(pb1);
    });
    const cellId = draft().rungs[0]?.cells[0]?.id ?? '';
    act(() => {
      useStore.getState().setSchematicCursor({ rungId: 'r1', index: 1 });
      useStore.getState().applySchematicEdit({
        kind: 'replaceCell',
        cellId,
        draft: { kind: 'lamp', device: 'PL1' },
      });
    });
    expect(useStore.getState().schematicCursor).toEqual({ rungId: 'r1', index: 0 });
  });
});

describe('画面に出す文面（レビュー I3: 内部IDを出さない）', () => {
  /** 段3本（r2 は r1 の分岐、r3 は r2 の分岐）。分岐の分岐と循環を作るための下ごしらえ。 */
  function threeRungs(): void {
    act(() => {
      const store = useStore.getState();
      store.applySchematicEdit(pb1);
      store.applySchematicEdit({ kind: 'addRung' });
      store.applySchematicEdit({
        kind: 'insertCell',
        rungId: 'r2',
        index: 0,
        draft: { kind: 'cr-a', device: 'CR1' },
      });
      store.applySchematicEdit({ kind: 'addRung' });
      store.applySchematicEdit({
        kind: 'insertCell',
        rungId: 'r3',
        index: 0,
        draft: { kind: 'cr-b', device: 'CR1' },
      });
    });
  }

  it('names the rung in Japanese when an edit is refused', () => {
    threeRungs();
    act(() => {
      const store = useStore.getState();
      // r2 を r1 の分岐に、r3 を r2 の分岐にする（分岐の分岐は描ける）
      store.applySchematicEdit({
        kind: 'setEnds',
        rungId: 'r2',
        from: { rung: 'r1', node: 0 },
        to: { rung: 'r1', node: 1 },
      });
      store.applySchematicEdit({
        kind: 'setEnds',
        rungId: 'r3',
        from: { rung: 'r2', node: 0 },
        to: { rung: 'r2', node: 1 },
      });
    });
    expect(draft().rungs[2]?.from).toEqual({ rung: 'r2', node: 0 });
    let accepted = true;
    act(() => {
      // これで r2 → r3 → r2 の輪になる（`applyEdit()` が断る）
      accepted = useStore.getState().applySchematicEdit({
        kind: 'setEnds',
        rungId: 'r2',
        from: { rung: 'r3', node: 0 },
        to: { rung: 'r3', node: 1 },
      });
    });
    expect(accepted).toBe(false);
    const toast = useStore.getState().toasts.at(-1)?.text ?? '';
    expect(toast).toContain('段目');
    expect(toast).not.toMatch(/\b[rc]\d/u);
  });

  it('names the rung in Japanese in the operation log', () => {
    threeRungs();
    act(() => {
      useStore.getState().applySchematicEdit({ kind: 'removeRung', rungId: 'r2' });
    });
    const line = useStore.getState().logLines.at(-1)?.text ?? '';
    expect(line).toContain('2段目');
    expect(line).not.toMatch(/\b[rc]\d/u);
  });
});

describe('検算の往復（レビュー I2: 古い図の結果を出さない）', () => {
  const someResult = { ok: false, errors: [] } as const;

  it('drops a result for a document the trainee has already changed', () => {
    act(() => {
      useStore.getState().setVerifying(true);
    });
    expect(useStore.getState().verifying).toBe(true);
    act(() => {
      useStore.getState().applySchematicEdit(pb1);
    });
    // 編集したら「検算中…」は下ろす（ボタンが戻らないままにしない）
    expect(useStore.getState().verifying).toBe(false);
    act(() => {
      useStore.getState().setVerifyResult(someResult);
    });
    expect(useStore.getState().verifyResult).toBeUndefined();
    expect(useStore.getState().verifying).toBe(false);
  });

  it('takes the result of the document that was actually sent', () => {
    act(() => {
      useStore.getState().setVerifying(true);
      useStore.getState().setVerifyResult(someResult);
    });
    expect(useStore.getState().verifyResult).toEqual(someResult);
    expect(useStore.getState().verifying).toBe(false);
  });
});

describe('分岐と「全部消す」（レビュー Minor）', () => {
  it('undoes and redoes a branch (setEnds)', () => {
    act(() => {
      const store = useStore.getState();
      store.applySchematicEdit(pb1);
      store.applySchematicEdit({ kind: 'addRung' });
      store.applySchematicEdit({
        kind: 'setEnds',
        rungId: 'r2',
        from: { rung: 'r1', node: 0 },
        to: { rung: 'r1', node: 1 },
      });
    });
    expect(draft().rungs[1]?.from).toEqual({ rung: 'r1', node: 0 });
    act(() => {
      useStore.getState().undoSchematicEdit();
    });
    expect(draft().rungs[1]?.from).toEqual({ bus: 'P' });
    act(() => {
      useStore.getState().redoSchematicEdit();
    });
    expect(draft().rungs[1]?.to).toEqual({ rung: 'r1', node: 1 });
  });

  it('clears the whole drawing and can be undone', () => {
    act(() => {
      const store = useStore.getState();
      store.applySchematicEdit(pb1);
      store.applySchematicEdit({ kind: 'addRung' });
    });
    act(() => {
      useStore.getState().clearSchematic();
    });
    expect(draft().rungs).toHaveLength(1);
    expect(devices()).toEqual([]);
    expect(useStore.getState().toasts.at(-1)?.text).toBe(JA.schematic.cleared);
    act(() => {
      useStore.getState().undoSchematicEdit();
    });
    expect(draft().rungs).toHaveLength(2);
    expect(devices()).toEqual(['PB1']);
  });
});

describe('作業ファイルの下書き（§13 #8 / レビュー Minor）', () => {
  it('drops a draft with more rungs than the cap and says why', () => {
    const rungs = Array.from({ length: MAX_RESTORED_RUNGS + 1 }, (_, i) => ({
      id: `r${String(i + 1)}`,
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [],
    }));
    const big = {
      formatVersion: SCHEMATIC_FORMAT_VERSION,
      id: 'draft-big',
      title: '大きすぎる下書き',
      orientation: 'horizontal',
      rungs,
    };
    expect(toSchematicDoc(big)).toBeUndefined();
    let ok = false;
    act(() => {
      ok = restoreInspectState(problem, { mode: 'assemble', schematic: big });
    });
    // 盤の配線は開く。下書きだけを捨て、捨てたことは必ず知らせる
    expect(ok).toBe(true);
    expect(draft().rungs).toHaveLength(1);
    expect(useStore.getState().toasts.at(-1)?.text).toBe(JA.schematic.draftUnreadable);
  });
});
