import { JIPM_BOARD, remainingInventory, mountedKinds } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimCommand } from '../src/worker/protocol.js';
import type { PickHit } from '../src/renderer/session/interaction.js';
import type * as BoardSceneModule from '../src/renderer/three/BoardScene.js';

/**
 * セッション画面の操作テスト（§8.2 / §14.2）。
 *
 * 3Dビューポートは happy-dom では描けないので `BoardScene` を差し替える。差し替えた部品は
 * 受け取った `onPick` / `onHover` をそのまま外へ出すので、**端子をクリックした**という
 * 出来事を本物と同じ経路（`pickToAction` → `commands` → `bridge.send`）に流せる。
 * Worker ブリッジも差し替えて、送られたコマンドを配列に溜める。
 */

const scene = vi.hoisted(() => ({
  pick: undefined as ((hit: PickHit) => void) | undefined,
}));

const workerMock = vi.hoisted(() => ({
  sent: [] as unknown[],
  handlers: undefined as
    | {
        onSnapshot: (snapshot: unknown) => void;
        onJudge: (message: unknown) => void;
        onError: (message: string, fatal: boolean) => void;
      }
    | undefined,
}));

vi.mock('../src/renderer/three/BoardScene.js', async () => {
  const actual = await vi.importActual<typeof BoardSceneModule>(
    '../src/renderer/three/BoardScene.js',
  );
  return {
    safeRoutes: actual.safeRoutes,
    visualSignature: actual.visualSignature,
    BoardScene: ({ onPick }: { onPick: (hit: PickHit) => void }) => {
      scene.pick = onPick;
      return createElement('div', { 'data-testid': 'board-canvas-stub' });
    },
  };
});

vi.mock('../src/renderer/session/worker-bridge.js', () => ({
  bridge: {
    start: (handlers: NonNullable<typeof workerMock.handlers>) => {
      workerMock.handlers = handlers;
    },
    send: (command: unknown) => {
      workerMock.sent.push(command);
    },
    stop: () => {
      workerMock.handlers = undefined;
    },
    running: true,
  },
}));

const { Session } = await import('../src/renderer/screens/Session.js');
const { useStore } = await import('../src/renderer/app/store.js');
const { JA } = await import('../src/renderer/i18n/ja.js');

const PROBLEM = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');

/** 物理端子IDから `PickHit` を作る（3D盤が返すのと同じ形）。 */
function terminalHit(id: string): PickHit {
  const terminal = JIPM_BOARD.terminals.find((t) => t.id === id);
  if (terminal === undefined) throw new Error(`端子が見つかりません: ${id}`);
  return { kind: 'terminal', id: terminal.id, wirable: terminal.wirable, label: terminal.label };
}

/** 送ったコマンドのうち `type` が一致するもの。 */
function sentOf(type: SimCommand['type']): unknown[] {
  return workerMock.sent.filter((c) => (c as { type?: string }).type === type);
}

function openSession(): void {
  if (PROBLEM === undefined) throw new Error('b-001 が見つかりません');
  act(() => {
    useStore.getState().openProblem(PROBLEM);
  });
  render(<Session />);
}

beforeEach(() => {
  workerMock.sent = [];
  workerMock.handlers = undefined;
  scene.pick = undefined;
  useStore.setState({ camera: 'front', cameraNonce: 0, judging: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('端子 → 端子の配線（§8.2）', () => {
  it('2つめの端子で電線が1本増え、Worker へ addWire を1回だけ送り、履歴も1つだけ積む', () => {
    openSession();
    const before = useStore.getState().session?.wires.length ?? 0;

    act(() => {
      scene.pick?.(terminalHit('P.1'));
      scene.pick?.(terminalHit('TB_PB.2c'));
    });

    const state = useStore.getState();
    expect(state.session?.wires).toHaveLength(before + 1);
    expect(sentOf('addWire')).toHaveLength(1);
    expect(state.history.done).toHaveLength(1);
    expect(state.pendingTerminal).toBeUndefined();
  });

  it('1本目を選んだだけでは何も送らない', () => {
    openSession();
    act(() => {
      scene.pick?.(terminalHit('P.1'));
    });
    expect(useStore.getState().pendingTerminal).toBe(toTerminalId('P.1'));
    expect(sentOf('addWire')).toHaveLength(0);
    expect(useStore.getState().history.done).toHaveLength(0);
  });

  it('1端子3本目（terminal-overload）は盤には入れずに Worker へだけ送り、履歴は積まない', () => {
    openSession();
    // TB_PB.2c に2本繋いで上限に達してから3本目を試す
    act(() => {
      scene.pick?.(terminalHit('P.1'));
      scene.pick?.(terminalHit('TB_PB.2c'));
      scene.pick?.(terminalHit('TB_PB.2c'));
      scene.pick?.(terminalHit('S1.10'));
    });
    const wiresAfterTwo = useStore.getState().session?.wires.length ?? 0;
    const historyAfterTwo = useStore.getState().history.done.length;
    const sentAfterTwo = sentOf('addWire').length;

    act(() => {
      scene.pick?.(terminalHit('TB_PB.2c'));
      scene.pick?.(terminalHit('S1.9'));
    });

    const state = useStore.getState();
    // 盤も履歴も増えないが、危険操作として数えるため Worker へは送る（§5.6 #5）
    expect(state.session?.wires).toHaveLength(wiresAfterTwo);
    expect(state.history.done).toHaveLength(historyAfterTwo);
    expect(sentOf('addWire')).toHaveLength(sentAfterTwo + 1);
    expect(state.toasts.at(-1)?.tone).toBe('error');
  });
});

describe('元に戻す（§8.2）', () => {
  /** いま使えるリレーの残数。 */
  function relaysLeft(): number {
    const session = useStore.getState().session;
    if (session === undefined) return 0;
    return (
      remainingInventory(session.inventory, mountedKinds(session)).find(
        (item) => item.kind === 'relay-my4n',
      )?.count ?? 0
    );
  }

  it('装着を元に戻すと在庫が戻る', () => {
    openSession();
    const stock = relaysLeft();
    expect(stock).toBeGreaterThan(0);

    act(() => {
      scene.pick?.({ kind: 'socket', id: 'S1', occupied: false });
    });
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: JA.session.mount })[0] as HTMLElement);
    });
    expect(useStore.getState().session?.mounted['S1']).toBeDefined();
    expect(relaysLeft()).toBe(stock - 1);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    });

    expect(useStore.getState().session?.mounted['S1']).toBeUndefined();
    expect(relaysLeft()).toBe(stock);
    expect(useStore.getState().history.done).toHaveLength(0);
    // 盤を組み直したので Worker にも load を送り直している（§13 #6）
    expect(sentOf('load').length).toBeGreaterThanOrEqual(2);
  });
});

describe('キーボードのショートカット（§8.2）', () => {
  it('数値入力欄に打った数字では視点が変わらない', () => {
    openSession();
    const input = document.createElement('input');
    input.type = 'number';
    document.body.appendChild(input);
    input.focus();

    const before = useStore.getState().cameraNonce;
    act(() => {
      fireEvent.keyDown(input, { key: '3' });
      fireEvent.keyDown(input, { key: 'Delete' });
      fireEvent.keyDown(input, { key: 'Escape' });
    });

    expect(useStore.getState().camera).toBe('front');
    expect(useStore.getState().cameraNonce).toBe(before);
    input.remove();
  });

  it('IME 変換中のキーも盤へ通さない', () => {
    openSession();
    const before = useStore.getState().cameraNonce;
    act(() => {
      fireEvent.keyDown(document.body, { key: '2', isComposing: true });
    });
    expect(useStore.getState().cameraNonce).toBe(before);
  });

  it('入力欄の外なら 1 / 2 / 3 で視点が変わる', () => {
    openSession();
    act(() => {
      fireEvent.keyDown(document.body, { key: '3' });
    });
    expect(useStore.getState().camera).toBe('socket');
    act(() => {
      fireEvent.keyDown(document.body, { key: '1' });
    });
    expect(useStore.getState().camera).toBe('front');
  });
});

describe('判定（§8.2 / §13 #2）', () => {
  it('判定中はボタンを押せず「判定中…」になる', () => {
    openSession();
    fireEvent.click(screen.getByTestId('judge-button'));
    expect(useStore.getState().judging).toBe(true);
    const button = screen.getByTestId('judge-button');
    expect(button.textContent).toBe(JA.session.judging);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(sentOf('judge')).toHaveLength(1);
  });

  it('模範回路を作れなかったらセッション画面に留まり、トーストで理由を出す', () => {
    openSession();
    fireEvent.click(screen.getByTestId('judge-button'));
    act(() => {
      workerMock.handlers?.onJudge({
        type: 'judgeResult',
        result: { ok: false, errors: [{ path: 'judge', message: '模範回路が組めません' }] },
      });
    });
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.judge).toBeUndefined();
    expect(state.judging).toBe(false);
    expect(state.toasts.at(-1)?.text).toContain('模範回路が組めません');
    expect(screen.getByTestId<HTMLButtonElement>('judge-button').disabled).toBe(false);
  });

  it('Worker が落ちても「判定中…」のまま固まらない', () => {
    openSession();
    fireEvent.click(screen.getByTestId('judge-button'));
    act(() => {
      workerMock.handlers?.onError('worker died', true);
    });
    expect(useStore.getState().judging).toBe(false);
  });
});
