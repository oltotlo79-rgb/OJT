import { BUILTIN_ALL_PROBLEMS } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderEditor } from '../src/renderer/ladder/LadderEditor.js';
import {
  createReferenceStore,
  editReferenceNetwork,
  readAuthoringReference,
} from '../src/renderer/session/authoring-reference.js';
import { pushModalLayer, shouldIgnoreShortcut } from '../src/renderer/session/interaction.js';

afterEach(cleanup);
const problem = (id: string) => structuredClone(BUILTIN_ALL_PROBLEMS.find((p) => p.id === id)!);

describe('N04: 模範編集の独立性と未完成回路の再編集', () => {
  it.each(['b-001', 'c2-001'])('%s: 要素がない段も編集し直せ、練習の履歴には触れない', (id) => {
    const p = problem(id);
    if (p.mode !== 'assemble' && p.mode !== 'inspect-repair') throw new Error('fixture');
    p.schematic.rungs[0]!.cells = [];
    const reference = readAuthoringReference(p);
    if (typeof reference === 'string' || reference.kind !== 'schematic')
      throw new Error(typeof reference === 'string' ? reference : 'unexpected reference kind');
    const training = useStore.getState();
    const local = createReferenceStore(reference);
    const before = structuredClone(local.getState().schematicDoc);
    expect(
      local.getState().applySchematicEdit({
        kind: 'insertCell',
        rungId: p.schematic.rungs[0]!.id,
        index: 0,
        draft: { kind: 'pb-a', device: 'PB1' },
      }),
    ).toBe(true);
    expect(local.getState().schematicDoc).not.toEqual(before);
    expect(local.getState().undoSchematicEdit()).toBe(true);
    expect(local.getState().schematicDoc).toEqual(before);
    expect(local.getState().redoSchematicEdit()).toBe(true);
    expect(useStore.getState()).toBe(training);
  });

  it('未接続のラダーも再編集でき、回路ブロック追加とUndoは専用ストアだけに効く', () => {
    const p = problem('d-001');
    if (p.mode !== 'plc') throw new Error('fixture');
    p.referenceLadder.networks[0]!.cells[0]![0] = { kind: 'empty' };
    const reference = readAuthoringReference(p);
    if (typeof reference === 'string' || reference.kind !== 'ladder')
      throw new Error(typeof reference === 'string' ? reference : 'unexpected reference kind');
    const training = useStore.getState();
    const local = createReferenceStore(reference);
    const before = structuredClone(local.getState().ladder);
    editReferenceNetwork(local, 'insert-network');
    expect(local.getState().ladder?.networks.length).toBe(before!.networks.length + 1);
    expect(local.getState().undoLadderEdit()).toBe(true);
    expect(local.getState().ladder).toEqual(before);
    expect(useStore.getState()).toBe(training);
  });

  it('ラダーのセル操作とキー入力が専用ストアを更新する', () => {
    const reference = readAuthoringReference(problem('d-001'));
    if (typeof reference === 'string' || reference.kind !== 'ladder')
      throw new Error(typeof reference === 'string' ? reference : 'unexpected reference kind');
    const local = createReferenceStore(reference);
    const training = useStore.getState();
    const before = structuredClone(local.getState().ladder);
    render(
      <LadderEditor
        editorStore={local}
        profile={reference.profile}
        gridCols={reference.profile.gridCols}
        errorCells={new Set()}
        onConvert={() => undefined}
        onModeChange={() => undefined}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('ladder-editor'), { key: 'Delete' });
    expect(local.getState().ladder).not.toEqual(before);
    fireEvent.keyDown(screen.getByTestId('ladder-editor'), { key: 'z', ctrlKey: true });
    expect(local.getState().ladder).toEqual(before);
    expect(useStore.getState()).toBe(training);
  });

  it('ENDの削除や行追加を止めて説明する', () => {
    const reference = readAuthoringReference(problem('d-001'));
    if (typeof reference === 'string' || reference.kind !== 'ladder')
      throw new Error(typeof reference === 'string' ? reference : 'unexpected reference kind');
    const local = createReferenceStore(reference);
    const end = local.getState().ladder!.networks.find((net) => net.cells[0]?.[0]?.kind === 'end')!;
    local.getState().setLadderCursor({ networkId: end.id, row: 0, col: 0 });
    const before = local.getState().ladder;
    editReferenceNetwork(local, 'delete-network');
    editReferenceNetwork(local, 'insert-row');
    expect(local.getState().ladder).toBe(before);
    expect(local.getState().toasts.at(-1)?.text).toContain('END');
  });

  it('最上段の作図画面だけキー操作を許し、別モーダルとIME入力を遮断する', () => {
    const first = pushModalLayer();
    try {
      expect(shouldIgnoreShortcut({ target: null })).toBe(true);
      expect(shouldIgnoreShortcut({ target: null }, first.depth)).toBe(false);
      expect(shouldIgnoreShortcut({ target: null, isComposing: true }, first.depth)).toBe(true);
      const second = pushModalLayer();
      try {
        expect(shouldIgnoreShortcut({ target: null }, first.depth)).toBe(true);
      } finally {
        second.release();
      }
    } finally {
      first.release();
    }
  });
});
