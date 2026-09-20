// helpers/worker-bridge.js を他の import より前に置く（vi.mock のファクトリから参照するため）。
import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { JIPM_BOARD, toPhysicalTerminal } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS, buildReferenceSession } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as BoardSceneModule from '../src/renderer/three/BoardScene.js';

/**
 * 配線ガイド（§16 Phase 5 受入基準② / Plan 5 Task 8）。§11.4 / 決定表#7・#8
 *
 * 3Dビューポートは happy-dom では描けないので `BoardScene` を差し替える（`session.test.tsx`
 * と同じ作りに `onHover` の捕まえを足したもの。3D → 回路図の逆引きを確かめるため）。
 * Worker ブリッジも差し替える（差し替えないと本物の Worker を起こしにいく）。このテストは
 * 送信コマンド・ハンドラのどちらも見ないので、`bridgeMock` は使い捨ての状態でよい。
 */

const scene = vi.hoisted(() => ({
  hover: undefined as ((id: unknown) => void) | undefined,
}));

const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));

vi.mock('../src/renderer/three/BoardScene.js', async () => {
  const actual = await vi.importActual<typeof BoardSceneModule>(
    '../src/renderer/three/BoardScene.js',
  );
  return {
    safeRoutes: actual.safeRoutes,
    visualSignature: actual.visualSignature,
    BoardScene: ({ onHover }: { onHover: (id: unknown) => void }) => {
      scene.hover = onHover;
      return createElement('div', { 'data-testid': 'board-canvas-stub' });
    },
  };
});

vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

const { Session } = await import('../src/renderer/screens/Session.js');
const { useStore } = await import('../src/renderer/app/store.js');

const found = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (found === undefined) throw new Error('b-001 が見つかりません');
/** 巻き上げられる関数宣言の中でも `undefined` を外した型でいるように、別名にしてから使う。 */
const problem = found;

/** 下書きに「PB1 a接点 → CR1 コイル」を置く（割当できる最小の段）。 */
function drawTwoCells(): void {
  act(() => {
    const store = useStore.getState();
    store.applySchematicEdit({
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: { kind: 'pb-a', device: 'PB1' },
    });
    store.applySchematicEdit({
      kind: 'insertCell',
      rungId: 'r1',
      index: 1,
      draft: { kind: 'coil', device: 'CR1' },
    });
  });
}

beforeEach(() => {
  scene.hover = undefined;
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
  });
});

afterEach(() => {
  cleanup();
});

describe('配線ガイド（§16 Phase 5 受入基準②）', () => {
  it('lights the board terminals when a schematic hint element is clicked', () => {
    render(<Session />);
    // b-001 は3級課題なので回路図ヒントが常時出ている（§8.4）
    const symbol = screen.getByTestId('schematic-hint').querySelector('[data-cell]');
    expect(symbol).not.toBeNull();
    if (symbol === null) return;
    fireEvent.click(symbol);
    const highlight = useStore.getState().highlight;
    expect(highlight.cellIds).toEqual([symbol.getAttribute('data-cell')]);
    expect(highlight.terminals).toHaveLength(2);
    // 端子IDは盤の語彙（`CR1.14` のような `<部品>.<端子>`）
    for (const terminal of highlight.terminals) expect(terminal).toMatch(/^[A-Z_0-9]+\./u);
  });

  it('clears the highlight when the empty area of the schematic is clicked', () => {
    render(<Session />);
    const svg = screen.getByTestId('schematic-hint').querySelector('[data-testid="schematic-svg"]');
    expect(svg).not.toBeNull();
    if (svg === null) return;
    fireEvent.click(svg);
    expect(useStore.getState().highlight.cellIds).toEqual([]);
  });

  it('lights the drawn element when the editor is open (決定表#7)', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    drawTwoCells();
    const symbol = screen.getByTestId('schematic-editor').querySelector('[data-cell]');
    expect(symbol).not.toBeNull();
    if (symbol === null) return;
    fireEvent.click(symbol);
    expect(useStore.getState().highlight.terminals.length).toBeGreaterThan(0);
  });

  it('lights nothing while the drawing cannot be assigned to the board', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    // 要素0個の下書きは割当できない（`validateDocument()` が段の空を弾く）
    const symbol = screen.getByTestId('schematic-editor').querySelector('[data-slot]');
    expect(symbol).not.toBeNull();
    if (symbol === null) return;
    fireEvent.click(symbol);
    expect(useStore.getState().highlight).toEqual({ cellIds: [], terminals: [], wireIds: [] });
  });

  it('keeps the hint on the reference circuit while the editor shows the draft (I4)', () => {
    render(<Session />);
    // 「並べて」は**下書きと模範回路が同時に画面に出る**唯一のビュー
    fireEvent.click(screen.getByTestId('assemble-view-split'));
    drawTwoCells();
    // ヒント側の要素IDは課題JSONのID（`c01`〜）。下書きのID（`c1`〜）とは別物なので、
    // 索引が1つだと引けずに何も光らない
    const hint = screen.getByTestId('schematic-hint').querySelector('[data-cell]');
    expect(hint).not.toBeNull();
    if (hint === null) return;
    fireEvent.click(hint);
    expect(useStore.getState().highlight.cellIds).toEqual([hint.getAttribute('data-cell')]);
    expect(useStore.getState().highlight.terminals).toHaveLength(2);
  });

  it('lights the schematic element when a board terminal is hovered (決定表#8)', () => {
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // ソケットに載る機器（`CR1`）を選ぶと、3Dの物理端子（`S1.13`）→ 役割端子（`CR1.13`）の
    // 読み替え（§6.4）まで通せる
    const cell = built.value.cells.find((c) => c.device === 'CR1');
    expect(cell).toBeDefined();
    if (cell === undefined) return;
    const physical = toPhysicalTerminal(built.value.session.socketRoles, cell.left);
    expect(physical).not.toBe(cell.left);

    render(<Session />);
    expect(scene.hover).toBeDefined();
    act(() => {
      scene.hover?.(physical);
    });
    const highlight = useStore.getState().highlight;
    expect(highlight.cellIds).toContain(cell.cellId);
    expect(highlight.terminals).toEqual([cell.left]);

    // 端子から外れたら消える
    act(() => {
      scene.hover?.(undefined);
    });
    expect(useStore.getState().highlight).toEqual({ cellIds: [], terminals: [], wireIds: [] });
  });

  /*
   * B1（Plan 5 C/D レビュー）: 3D → 回路図の逆引きは回路図ヒントの表示可否
   * （`schematicPolicy` / §8.4）を守る。1級は回路図を一切出さない、2級は開いた回数を
   * 減点として数える（2026-09-18 の利用者決定）ので、出していない・閉じているあいだに
   * 盤の端子をホバーしただけで模範回路が使う端子を光らせてしまうと、答え合わせが
   * 無料になってしまう（C2 の `InspectRepairSession.tsx` が持つガードと同じ規則）。
   */
  it('lights nothing on hover for a grade-1 problem (schematic is never shown, B1)', () => {
    const grade1 = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-007');
    if (grade1 === undefined) throw new Error('b-007 が見つかりません');
    expect(grade1.grade).toBe(1);
    act(() => {
      useStore.getState().openProblem(grade1);
    });
    const built = buildReferenceSession(grade1, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const cell = built.value.cells.find((c) => c.device === 'CR1');
    expect(cell).toBeDefined();
    if (cell === undefined) return;
    const physical = toPhysicalTerminal(built.value.session.socketRoles, cell.left);

    render(<Session />);
    expect(scene.hover).toBeDefined();
    act(() => {
      scene.hover?.(physical);
    });
    expect(useStore.getState().highlight).toEqual({ cellIds: [], terminals: [], wireIds: [] });
  });

  it('lights nothing on hover for a grade-2 problem while the schematic is closed (B1)', () => {
    const grade2 = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-004');
    if (grade2 === undefined) throw new Error('b-004 が見つかりません');
    expect(grade2.grade).toBe(2);
    act(() => {
      useStore.getState().openProblem(grade2);
    });
    // 2級は初期状態で閉じている（§8.4）
    expect(useStore.getState().schematicVisible).toBe(false);
    const built = buildReferenceSession(grade2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const cell = built.value.cells.find((c) => c.device === 'CR1');
    expect(cell).toBeDefined();
    if (cell === undefined) return;
    const physical = toPhysicalTerminal(built.value.session.socketRoles, cell.left);

    render(<Session />);
    act(() => {
      scene.hover?.(physical);
    });
    expect(useStore.getState().highlight).toEqual({ cellIds: [], terminals: [], wireIds: [] });
  });

  it('lights the schematic element on hover for a grade-2 problem once it is opened (B1)', () => {
    const grade2 = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-004');
    if (grade2 === undefined) throw new Error('b-004 が見つかりません');
    act(() => {
      useStore.getState().openProblem(grade2);
    });
    const built = buildReferenceSession(grade2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const cell = built.value.cells.find((c) => c.device === 'CR1');
    expect(cell).toBeDefined();
    if (cell === undefined) return;
    const physical = toPhysicalTerminal(built.value.session.socketRoles, cell.left);

    render(<Session />);
    act(() => {
      useStore.getState().toggleSchematic();
    });
    expect(useStore.getState().schematicVisible).toBe(true);
    act(() => {
      scene.hover?.(physical);
    });
    const highlight = useStore.getState().highlight;
    expect(highlight.cellIds).toContain(cell.cellId);
    expect(highlight.terminals).toEqual([cell.left]);
  });

  /*
   * 結果画面の「盤で見る」で連れてきた光を、盤の上でマウスが動いただけで消さない
   * （Plan 5 Task 9 / 決定表#11・#27）。ホバーの読み替え（物理端子 → 役割端子）は
   * 上の1件が見ているので、ここでは**上書きしないこと**だけを見る。
   */
  it('keeps the highlight from the result screen while boardFocus is set (I3)', () => {
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const cell = built.value.cells.find((c) => c.device === 'CR1');
    expect(cell).toBeDefined();
    if (cell === undefined) return;
    const physical = toPhysicalTerminal(built.value.session.socketRoles, cell.left);

    render(<Session />);
    // 結果画面から跳んできた状態を作る（`setHighlight` → `setBoardFocus` → `setRoute`）
    const focused = { cellIds: ['c99'], terminals: ['CR1.14'], wireIds: ['sw-001'] };
    act(() => {
      useStore.getState().setHighlight(focused);
      useStore
        .getState()
        .setBoardFocus({ from: 'result', text: 'CR1.14 と P.1 がつながっていません' });
    });
    expect(screen.getByTestId('board-focus')).toHaveTextContent('結果から');

    act(() => {
      scene.hover?.(physical);
    });
    expect(useStore.getState().highlight).toEqual(focused);
    // ホバーそのものは止めない（端子のツールチップは帯が出ていても要る）
    expect(useStore.getState().hoveredTerminal).toBe(physical);

    // 「結果へ戻る」で帯も光も畳む
    fireEvent.click(screen.getByTestId('back-to-result'));
    expect(useStore.getState().boardFocus).toBeUndefined();
    expect(useStore.getState().highlight).toEqual({ cellIds: [], terminals: [], wireIds: [] });
    expect(useStore.getState().route).toBe('result');
  });

  /*
   * M1（Plan 5 C/D レビュー）: `onHover` と同じく、結果画面から跳んできている
   * （`boardFocus`）あいだは回路図の要素クリック（ヒント／下書き）もハイライトを触らない。
   * 帯は「結果から: …」のままなのに、要素を押しただけで光が別物へ差し替わると、
   * 帯と光の対応が食い違って見える。
   */
  it('keeps the highlight from the result screen when a schematic hint element is clicked while boardFocus is set (M1)', () => {
    render(<Session />);
    const focused = { cellIds: ['c99'], terminals: ['CR1.14'], wireIds: ['sw-001'] };
    act(() => {
      useStore.getState().setHighlight(focused);
      useStore
        .getState()
        .setBoardFocus({ from: 'result', text: 'CR1.14 と P.1 がつながっていません' });
    });
    const symbol = screen.getByTestId('schematic-hint').querySelector('[data-cell]');
    expect(symbol).not.toBeNull();
    if (symbol === null) return;
    fireEvent.click(symbol);
    expect(useStore.getState().highlight).toEqual(focused);
  });
});
