// helpers/worker-bridge.js を他の import より前に置く（vi.mock のファクトリから参照するため）。
import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimCommand } from '../src/worker/protocol.js';
import type * as BoardSceneModule from '../src/renderer/three/BoardScene.js';

/**
 * モードBのビュー切替（盤／並べて／回路図）。§11.4 / Plan 5 決定表#1 / Task 7。
 *
 * 3Dビューポートは happy-dom では描けないので `BoardScene` を差し替える（`session.test.tsx`
 * と同じ理由・同じ作り）。Worker ブリッジも差し替え、検算コマンドと `onError` の配線を
 * この画面の側から確かめられるようにする。
 */

const workerMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));

vi.mock('../src/renderer/three/BoardScene.js', async () => {
  const actual = await vi.importActual<typeof BoardSceneModule>(
    '../src/renderer/three/BoardScene.js',
  );
  return {
    safeRoutes: actual.safeRoutes,
    visualSignature: actual.visualSignature,
    BoardScene: () => createElement('div', { 'data-testid': 'board-canvas-stub' }),
  };
});

vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(workerMock));

const { Session } = await import('../src/renderer/screens/Session.js');
const { useStore } = await import('../src/renderer/app/store.js');

const found = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (found === undefined) throw new Error('b-001 が見つかりません');
/** 巻き上げられる関数宣言の中でも `undefined` を外した型でいるように、別名にしてから使う。 */
const problem = found;

/** 送ったコマンドのうち `type` が一致するもの。 */
function sentOf(type: SimCommand['type']): unknown[] {
  return workerMock.sent.filter((c) => (c as { type?: string }).type === type);
}

beforeEach(() => {
  workerMock.sent = [];
  workerMock.handlers = undefined;
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('モードBのビュー切替（Plan 5 決定表#1）', () => {
  it('opens on the board view (Phase 1〜4 のふるまいを変えない)', () => {
    render(<Session />);
    expect(screen.getByTestId('viewport')).toBeVisible();
    expect(screen.queryByTestId('schematic-editor')).toBeNull();
    expect(useStore.getState().assembleView).toBe('board');
  });

  it('switches to 並べて and shows both the board and the editor', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-split'));
    expect(screen.getByTestId('viewport')).toBeVisible();
    expect(screen.getByTestId('schematic-editor')).toBeVisible();
  });

  it('switches to 回路図 and hides the 3D viewport', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    expect(screen.getByTestId('schematic-editor')).toBeVisible();
    expect(screen.queryByTestId('viewport')).toBeNull();
  });

  it('marks the current view with aria-pressed', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    expect(screen.getByTestId('assemble-view-schematic')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('assemble-view-board')).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the keyboard shortcut next to the switch (利用者要求 2026-09-19)', () => {
    render(<Session />);
    expect(screen.getByTestId('assemble-view-key')).toHaveTextContent('F2');
    expect(screen.getByTestId('assemble-view-split')).toHaveAttribute('title');
  });

  it('cycles 盤 → 並べて → 回路図 → 盤 with F2', () => {
    render(<Session />);
    for (const expected of ['split', 'schematic', 'board'] as const) {
      fireEvent.keyDown(window, { key: 'F2' });
      expect(useStore.getState().assembleView).toBe(expected);
    }
  });

  it('keeps the draft when the view changes back and forth', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    act(() => {
      useStore.getState().applySchematicEdit({
        kind: 'insertCell',
        rungId: 'r1',
        index: 0,
        draft: { kind: 'pb-a', device: 'PB1' },
      });
    });
    fireEvent.click(screen.getByTestId('assemble-view-board'));
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    expect(useStore.getState().schematicDoc?.rungs[0]?.cells).toHaveLength(1);
  });

  it('shows the verify panel once a result arrives', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    act(() => {
      useStore.getState().setVerifyResult({
        ok: false,
        errors: [{ source: 'document', path: 'rungs[0]', message: '段に要素がありません: r1' }],
      });
    });
    expect(screen.getByTestId('verify-panel')).toHaveTextContent('段に要素がありません');
    expect(useStore.getState().verifying).toBe(false);
  });

  it('sends the verify command to the Worker and stops the button until it answers', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    // 妥当な文書でないと「検算」は押せない（決定表#3）。課題の模範回路を下書きに入れて試す
    act(() => {
      useStore.getState().setSchematicDoc(problem.schematic);
    });
    fireEvent.click(screen.getByTestId('verify-button'));
    expect(sentOf('verify')).toHaveLength(1);
    expect(useStore.getState().verifying).toBe(true);
    // 往復中は押し直せない（判定ボタンと同じ流儀。§8.2）
    expect(screen.getByTestId('verify-button')).toBeDisabled();
  });

  it('puts the verify button back when the Worker falls over (レビュー I5)', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    act(() => {
      useStore.getState().setVerifying(true);
    });
    act(() => {
      workerMock.handlers?.onError('落ちました', false);
    });
    expect(useStore.getState().verifying).toBe(false);
    expect(useStore.getState().judging).toBe(false);
  });

  it('leaves the board shortcuts alone while the editor has the focus', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    const wire = useStore.getState().session?.wires.find((w) => !w.locked);
    // 固定でない電線が無い課題なら、この確認は意味を持たない（b-001 は固定配線のみ）
    act(() => {
      useStore.getState().setSelectedWire(wire?.id ?? 'w-none');
    });
    fireEvent.keyDown(screen.getByTestId('schematic-grid'), { key: 'Delete' });
    expect(useStore.getState().selectedWire).toBe(wire?.id ?? 'w-none');
  });

  it('offers exactly the three views (他の画面には出さない)', () => {
    render(<Session />);
    expect(screen.queryAllByTestId(/^assemble-view-(board|split|schematic)$/u)).toHaveLength(3);
  });
});

/*
 * レビュー指摘 UX-04: 回路図エディタだけを出しているあいだ、上の帯が「部品装着 いまここ」の
 * ままだと、新人は存在しない部品パネルを探すことになる。`schematic` のときだけ上の帯を
 * 回路図の3段に差し替え、エディタ自身の帯（二重表示）は消す。`split` は両方出す。
 */
describe('回路図エディタの手順帯との二重表示（レビュー指摘 UX-04）', () => {
  it('盤だけのときは上の帯が盤の4段（部品装着 いまここ）', () => {
    render(<Session />);
    expect(screen.getByTestId('step-guide')).toHaveTextContent('部品装着');
    expect(screen.getByTestId('step-parts')).toHaveAttribute('data-state', 'current');
  });

  it('回路図エディタだけのときは上の帯を回路図の3段に差し替え、エディタ自身の帯は出さない', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    const topBand = screen.getByTestId('step-guide');
    expect(topBand).toHaveTextContent('回路図を描く');
    expect(topBand).not.toHaveTextContent('部品装着');
    expect(screen.queryByTestId('schematic-step-guide')).toBeNull();
  });

  it('並べてのときは上の帯が盤の4段のまま、エディタ自身の帯も出す', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-split'));
    const topBand = screen.getByTestId('step-guide');
    expect(topBand).toHaveTextContent('部品装着');
    expect(screen.getByTestId('schematic-step-guide')).toHaveTextContent('回路図を描く');
  });
});
