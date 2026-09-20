import { createSession, JIPM_BOARD, type BoardSession, type MountableKind } from '@ojt/board-model';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JA_PARTS } from '../src/renderer/i18n/ja.js';
import { DragGhost, PartsPanel } from '../src/renderer/panels/PartsPanel.js';
import { TerminalListPanel } from '../src/renderer/panels/TerminalListPanel.js';
import { emptyHistory, pushCommand, runPlug } from '../src/renderer/session/commands.js';
import { intentOf, type InteractionState } from '../src/renderer/session/interaction.js';

/**
 * 部品パレット（Phase 7 Task 27 / 指摘 UX-08 / 利用者要望9「ドラッグして部品を配置したり」）。
 * 設計 §7.3.3・§7.5。
 *
 * ここで縛るのは4つ。①カードをつまむと運搬が始まる ②つまんだままソケットへ落とすと
 * 装着1手だけが履歴に積まれる ③空状態がソケット一覧のボタンになっている（UX-08）
 * ④端子リストと盤の相互ハイライト（PR-11）。
 */

afterEach(() => {
  cleanup();
});

/** 既定の在庫（`parts-swap.test.tsx` と同じ組み合わせ）。 */
const INVENTORY: ReadonlyArray<{ kind: MountableKind; count: number }> = [
  { kind: 'relay-my4n', count: 2 },
  { kind: 'timer-h3y4', count: 1 },
];

/** 既定の役割（S1=CR1・S5=T1）で盤セッションを作る。 */
function makeSession(inventory = INVENTORY): BoardSession {
  return createSession(JIPM_BOARD, { inventory: [...inventory] });
}

function renderPanel(
  session: BoardSession,
  extra: Partial<Parameters<typeof PartsPanel>[0]> = {},
): { onCarry: ReturnType<typeof vi.fn>; onSelectSocket: ReturnType<typeof vi.fn> } {
  const onCarry = vi.fn();
  const onSelectSocket = vi.fn();
  render(
    <PartsPanel
      session={session}
      selectedSocket={undefined}
      powered={false}
      carrying={undefined}
      onCarry={onCarry}
      onSelectSocket={onSelectSocket}
      onPlug={vi.fn()}
      onUnplug={vi.fn()}
      onSwap={vi.fn()}
      onPreset={vi.fn()}
      {...extra}
    />,
  );
  return { onCarry, onSelectSocket };
}

describe('パレット: つまんで運ぶ（設計 §7.3.3）', () => {
  it('在庫のカードが残数つきで並ぶ', () => {
    renderPanel(makeSession());
    const relay = screen.getByTestId('palette-relay-my4n');
    expect(relay).toBeInTheDocument();
    expect(relay).toHaveTextContent(/\d/);
    expect(screen.getByTestId('palette-timer-h3y4')).toBeInTheDocument();
  });

  it('カードを `pointerdown` でつまむと運搬が始まる', () => {
    const { onCarry } = renderPanel(makeSession());
    fireEvent.pointerDown(screen.getByTestId('palette-relay-my4n'));
    expect(onCarry).toHaveBeenCalledWith('relay-my4n');
  });

  it('カードを**押すだけ**でも選べる（キーボードだけの利用者の経路を残す）', () => {
    const { onCarry } = renderPanel(makeSession());
    fireEvent.click(screen.getByTestId('palette-timer-h3y4'));
    expect(onCarry).toHaveBeenCalledWith('timer-h3y4');
  });

  it('つまんでいるカードは押下状態で分かる', () => {
    renderPanel(makeSession(), { carrying: 'relay-my4n' });
    expect(screen.getByTestId('palette-relay-my4n')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('palette-timer-h3y4')).toHaveAttribute('aria-pressed', 'false');
  });

  it('在庫切れのカードはつまめず、理由が添えてある', () => {
    const session = makeSession([
      { kind: 'relay-my4n', count: 0 },
      { kind: 'timer-h3y4', count: 1 },
    ]);
    const { onCarry } = renderPanel(session);
    const relay = screen.getByTestId('palette-relay-my4n');
    expect(relay).toHaveAttribute('aria-disabled', 'true');
    expect(relay).toHaveTextContent(JA_PARTS.paletteEmptyReason);
    fireEvent.pointerDown(relay);
    expect(onCarry).not.toHaveBeenCalled();
  });

  it('運べない画面（`onCarry` を渡さない）ではパレットを出さない', () => {
    render(
      <PartsPanel
        session={makeSession()}
        selectedSocket={undefined}
        powered={false}
        onSelectSocket={vi.fn()}
        onPlug={vi.fn()}
        onUnplug={vi.fn()}
        onSwap={vi.fn()}
        onPreset={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('parts-palette')).toBeNull();
  });
});

describe('運搬のゴースト（設計 §7.3.3）', () => {
  it('運んでいるあいだだけ、指の位置に付いてくる', () => {
    const { rerender } = render(<DragGhost dragging={undefined} />);
    expect(screen.queryByTestId('drag-ghost')).toBeNull();

    rerender(<DragGhost dragging={{ source: 'palette', kind: 'relay-my4n' }} />);
    // 指が動くまでは位置が分からないので出さない
    expect(screen.queryByTestId('drag-ghost')).toBeNull();
    fireEvent.pointerMove(window, { clientX: 120, clientY: 80 });
    const ghost = screen.getByTestId('drag-ghost');
    expect(ghost).toHaveStyle({ left: '120px', top: '80px' });
    // 飾りなので読み上げにもポインタにも出さない
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ソケットへ落とす（設計 §7.3.3 / §7.5）', () => {
  const carrying: InteractionState = {
    mode: 'wire',
    pendingTerminal: undefined,
    selectedWire: undefined,
    wireColor: '青',
    dragging: { source: 'palette', kind: 'relay-my4n' },
  };

  it('空きソケットの上で放すと装着1手になり、履歴が1件だけ増える', () => {
    const intent = intentOf(carrying, { kind: 'socket', id: 'S1', occupied: false });
    expect(intent).toEqual({ type: 'dropPart', socketId: 'S1', kind: 'relay-my4n' });
    if (intent.type !== 'dropPart') throw new Error('装着の意図にならなかった');

    const session = makeSession();
    const result = runPlug(session, intent.socketId, intent.kind);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(session.mounted['S1']?.kind).toBe('relay-my4n');

    const history = pushCommand(emptyHistory(), result.command);
    expect(history.done).toHaveLength(1);
    expect(history.done[0]?.kind).toBe('plug');
    // 落とす操作は1手だけ（抜く → 挿すの2手に割れない）
    expect(history.undone).toHaveLength(0);
  });

  it('埋まっているソケットへ落とそうとすると理由をつけて断る', () => {
    expect(intentOf(carrying, { kind: 'socket', id: 'S1', occupied: true })).toEqual({
      type: 'refuse',
      reason: 'socket-occupied',
    });
  });
});

describe('ソケット一覧（指摘 UX-08）', () => {
  it('空状態は文章ではなくソケットのボタンで、押すとそのソケットが選ばれる', () => {
    const { onSelectSocket } = renderPanel(makeSession());
    const button = screen.getByTestId('socket-list-S1');
    expect(button).toHaveTextContent('S1');
    fireEvent.click(button);
    expect(onSelectSocket).toHaveBeenCalledWith('S1');
  });

  it('いま何が載っているか（空き／部品名）も並べて出す', () => {
    const session = makeSession();
    const result = runPlug(session, 'S1', 'relay-my4n');
    expect(result.ok).toBe(true);
    renderPanel(session);
    expect(screen.getByTestId('socket-list-S1')).not.toHaveTextContent(JA_PARTS.socketListEmpty);
    expect(screen.getByTestId('socket-list-S2')).toHaveTextContent(JA_PARTS.socketListEmpty);
  });
});

describe('端子リストと盤の相互ハイライト（指摘 PR-11）', () => {
  function renderList(hoveredTerminal: string | undefined): ReturnType<typeof vi.fn> {
    const onHover = vi.fn();
    render(
      <TerminalListPanel
        board={JIPM_BOARD}
        session={makeSession()}
        pendingTerminal={undefined}
        hoveredTerminal={hoveredTerminal as never}
        onPick={vi.fn()}
        onHover={onHover}
        onCancel={vi.fn()}
      />,
    );
    return onHover;
  }

  it('行を指すと盤の端子へ伝わり、離れると消える', () => {
    const onHover = renderList(undefined);
    const row = screen.getByTestId('terminal-row-CR1.9');
    fireEvent.pointerEnter(row);
    expect(onHover).toHaveBeenLastCalledWith('CR1.9');
    fireEvent.pointerLeave(row);
    expect(onHover).toHaveBeenLastCalledWith(undefined);
  });

  it('キーボードで辿っても同じように伝わる', () => {
    const onHover = renderList(undefined);
    fireEvent.focus(screen.getByTestId('terminal-row-CR1.9'));
    expect(onHover).toHaveBeenLastCalledWith('CR1.9');
  });

  it('盤で指している端子の行が光る（逆向き）', () => {
    renderList('CR1.9');
    expect(screen.getByTestId('terminal-row-CR1.9')).toHaveAttribute('data-hovered', 'true');
    expect(screen.getByTestId('terminal-row-CR1.10')).toHaveAttribute('data-hovered', 'false');
  });
});
