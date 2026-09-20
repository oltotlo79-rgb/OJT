import {
  createSession,
  JIPM_BOARD,
  plug,
  type BoardSession,
  type MountableKind,
  type SocketId,
} from '@ojt/board-model';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * ソケットの部品カード（装着・取り外し・交換）と、3Dの装着部品の当たり判定。
 * 利用者要望 2026-09-19「リレーやタイマはソケットから外して入れ替えたりできるようにすること」
 * 「分かりやすく直感的に操作できるUI、UXにしてね」。設計仕様 §8.2。
 *
 * 3Dの `MountedPart` は drei の `Html`（`Canvas` の中でしか使えない）を持つので、
 * ここでは `Html` だけ素通しに差し替えて DOM へ描く。R3F の要素（`mesh` / `lineSegments`）は
 * React から見れば未知のホスト要素なので、そのままタグとして生えてクリックも拾える。
 */

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => children,
}));

const { PartsPanel } = await import('../src/renderer/panels/PartsPanel.js');
const { MountedPart, mountedBodyBox, sharedBodyEdges } =
  await import('../src/renderer/three/MountedPart.js');
const { sharedMaterial } = await import('../src/renderer/three/materials.js');
const { RELAY_BODY_COLOR, TIMER_BODY_COLOR } = await import('../src/renderer/session/colors.js');
const { socketBodyMaterial } = await import('../src/renderer/three/Socket.js');
const { runSwapPart } = await import('../src/renderer/session/commands.js');
const { JA, JA_PARTS } = await import('../src/renderer/i18n/ja.js');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RELAY_AND_TIMER = [
  { kind: 'relay-my4n' as MountableKind, count: 2 },
  { kind: 'timer-h3y4' as MountableKind, count: 1 },
];

/** 既定の役割（S1=CR1・S5=T1）で盤セッションを作る。 */
function makeSession(inventory = RELAY_AND_TIMER): BoardSession {
  return createSession(JIPM_BOARD, { inventory });
}

interface PanelSpies {
  onSelectSocket: Mock<(socketId: SocketId | undefined) => void>;
  onPlug: Mock<(socketId: SocketId, kind: MountableKind) => void>;
  onUnplug: Mock<(socketId: SocketId) => void>;
  onSwap: Mock<(socketId: SocketId, kind: MountableKind) => void>;
  onPreset: Mock<(socketId: SocketId, presetMs: number) => void>;
}

/** 部品パネルを描く（呼び出しを記録するスパイ付き）。 */
function renderPanel(
  session: BoardSession,
  selectedSocket: SocketId | undefined,
  powered = false,
): PanelSpies {
  const spies: PanelSpies = {
    onSelectSocket: vi.fn<(socketId: SocketId | undefined) => void>(),
    onPlug: vi.fn<(socketId: SocketId, kind: MountableKind) => void>(),
    onUnplug: vi.fn<(socketId: SocketId) => void>(),
    onSwap: vi.fn<(socketId: SocketId, kind: MountableKind) => void>(),
    onPreset: vi.fn<(socketId: SocketId, presetMs: number) => void>(),
  };
  render(
    <PartsPanel
      session={session}
      selectedSocket={selectedSocket}
      powered={powered}
      onSelectSocket={spies.onSelectSocket}
      onPlug={spies.onPlug}
      onUnplug={spies.onUnplug}
      onSwap={spies.onSwap}
      onPreset={spies.onPreset}
    />,
  );
  return spies;
}

describe('部品カード: 何も選んでいないとき（§8.2 / 利用者要望 2026-09-19）', () => {
  it('何をすればよいかの一文だけ出し、装着ボタンは出さない', () => {
    renderPanel(makeSession(), undefined);

    expect(screen.getByTestId('parts-hint')).toHaveTextContent(JA_PARTS.hint);
    expect(screen.queryByTestId('socket-card')).toBeNull();
    // 押せないボタンを並べるのではなく、そもそも出さない（UXレビュー指摘）
    expect(screen.queryByRole('button', { name: JA.session.mount })).toBeNull();
  });
});

describe('部品カード: 空きソケット（§8.2）', () => {
  it('見出しは「空」で、在庫のある部品を装着できる', () => {
    const session = makeSession();
    const spies = renderPanel(session, 'S1');

    expect(screen.getByTestId('socket-card-title')).toHaveTextContent('ソケット S1: 空');
    const mount = screen.getByTestId('mount-relay-my4n');
    expect(mount).toBeEnabled();

    fireEvent.click(mount);
    expect(spies.onPlug).toHaveBeenCalledWith('S1', 'relay-my4n');
  });

  it('在庫切れの部品は理由を添えて押せなくする（aria-describedby で結ぶ）', () => {
    const session = makeSession([
      { kind: 'relay-my4n', count: 1 },
      { kind: 'timer-h3y4', count: 0 },
    ]);
    renderPanel(session, 'S1');

    const timer = screen.getByTestId('mount-timer-h3y4');
    expect(timer).toBeDisabled();
    const reason = screen.getByTestId('parts-reason-mount-timer-h3y4');
    expect(reason).toHaveTextContent(JA_PARTS.noStockReason);
    expect(timer.getAttribute('aria-describedby')).toBe(reason.id);
    // 押せるほうには理由を付けない
    expect(screen.getByTestId('mount-relay-my4n')).not.toHaveAttribute('aria-describedby');
  });
});

describe('部品カード: 装着済みソケット（§8.2）', () => {
  it('見出しに部品名と役割IDを出し、取り外しと交換のボタンを並べる', () => {
    const session = makeSession();
    expect(plug(session, 'S1', 'relay-my4n').ok).toBe(true);
    const spies = renderPanel(session, 'S1');

    expect(screen.getByTestId('socket-card-title')).toHaveTextContent(
      'ソケット S1: リレー MY4N（CR1）',
    );
    const unmount = screen.getByTestId('card-unmount');
    const swap = screen.getByTestId('card-swap');
    // どちらも Tab で辿れる素のボタン（無効化していないので tabIndex も既定のまま）
    expect(unmount.tagName).toBe('BUTTON');
    expect(swap.tagName).toBe('BUTTON');
    expect(swap).toBeEnabled();
    expect(unmount).toHaveTextContent(JA.session.unmount);
    expect(swap).toHaveTextContent(JA_PARTS.swap);

    fireEvent.click(unmount);
    expect(spies.onUnplug).toHaveBeenCalledWith('S1');
  });

  it('「交換…」を押すと部品を選ばせ、選ぶと1回の交換として通知する', () => {
    const session = makeSession();
    expect(plug(session, 'S1', 'relay-my4n').ok).toBe(true);
    const spies = renderPanel(session, 'S1');

    fireEvent.click(screen.getByTestId('card-swap'));
    expect(screen.getByTestId('swap-timer-h3y4')).toBeEnabled();
    // いま挿さっている部品も選べる（抜けば在庫に戻るので残り1個として数える）
    expect(screen.getByTestId('swap-relay-my4n')).toBeEnabled();

    fireEvent.click(screen.getByTestId('swap-timer-h3y4'));
    expect(spies.onSwap).toHaveBeenCalledTimes(1);
    expect(spies.onSwap).toHaveBeenCalledWith('S1', 'timer-h3y4');
    // 取り外しと装着を別々に呼ばない（履歴を2手にしないため）
    expect(spies.onUnplug).not.toHaveBeenCalled();
    expect(spies.onPlug).not.toHaveBeenCalled();
    // 選び終わったら元の2ボタンに戻る
    expect(screen.getByTestId('card-unmount')).toBeInTheDocument();
  });

  it('交換をやめると元の2ボタンに戻る', () => {
    const session = makeSession();
    expect(plug(session, 'S1', 'relay-my4n').ok).toBe(true);
    renderPanel(session, 'S1');

    fireEvent.click(screen.getByTestId('card-swap'));
    fireEvent.click(screen.getByTestId('swap-cancel'));
    expect(screen.getByTestId('card-swap')).toBeInTheDocument();
    expect(screen.queryByTestId('swap-relay-my4n')).toBeNull();
  });

  it('タイマを交換するときは設定時間が戻ることを添える', () => {
    const session = makeSession();
    expect(plug(session, 'S5', 'timer-h3y4').ok).toBe(true);
    renderPanel(session, 'S5');

    fireEvent.click(screen.getByTestId('card-swap'));
    expect(screen.getByText(JA_PARTS.timerResetNote)).toBeInTheDocument();
  });

  it('交換できる部品が在庫に1つも無ければ理由を添えて押せなくする', () => {
    // その課題が配らない種別の部品が載っている（`remainingInventory` は在庫に無い種別を落とす）
    const session = makeSession([{ kind: 'timer-h3y4', count: 0 }]);
    session.mounted['S1'] = { kind: 'relay-my4n' };
    renderPanel(session, 'S1');

    const swap = screen.getByTestId('card-swap');
    expect(swap).toBeDisabled();
    const reason = screen.getByTestId('parts-reason-swap');
    expect(reason).toHaveTextContent(JA_PARTS.noSwapReason);
    expect(swap.getAttribute('aria-describedby')).toBe(reason.id);
    // 取り外しはいつでもできる（エンジンは空きソケット以外を断らない）
    expect(screen.getByTestId('card-unmount')).toBeEnabled();
  });
});

describe('部品カード: 通電中の注意（§5.3.5）', () => {
  it('通電中は注意書きを出すが、取り外しも交換も止めない', () => {
    const session = makeSession();
    expect(plug(session, 'S1', 'relay-my4n').ok).toBe(true);
    renderPanel(session, 'S1', true);

    expect(screen.getByTestId('parts-live-note')).toHaveTextContent(JA_PARTS.liveNote);
    expect(screen.getByTestId('card-unmount')).toBeEnabled();
    expect(screen.getByTestId('card-swap')).toBeEnabled();
  });

  it('無通電なら注意書きは出さない', () => {
    const session = makeSession();
    expect(plug(session, 'S1', 'relay-my4n').ok).toBe(true);
    renderPanel(session, 'S1', false);

    expect(screen.queryByTestId('parts-live-note')).toBeNull();
  });
});

describe('装着済みの索引（§8.2）', () => {
  it('索引のボタンでカードを別のソケットへ移せる', () => {
    const session = makeSession();
    expect(plug(session, 'S2', 'relay-my4n').ok).toBe(true);
    const spies = renderPanel(session, undefined);

    fireEvent.click(screen.getByTestId('select-S2'));
    expect(spies.onSelectSocket).toHaveBeenCalledWith('S2');
  });
});

describe('runSwapPart（§8.2）', () => {
  it('抜いて挿す2操作を履歴1手にまとめる', () => {
    const session = makeSession();
    expect(plug(session, 'S1', 'relay-my4n').ok).toBe(true);

    const result = runSwapPart(session, 'S1', 'timer-h3y4');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(session.mounted['S1']?.kind).toBe('timer-h3y4');
    expect(result.command.before.mounted['S1']?.kind).toBe('relay-my4n');
    expect(result.command.after.mounted['S1']?.kind).toBe('timer-h3y4');
    expect(result.command.label).toContain('交換');
  });

  it('挿すほうが在庫切れなら、抜いた部品をその場に戻す', () => {
    const session = makeSession([
      { kind: 'relay-my4n', count: 1 },
      { kind: 'timer-h3y4', count: 0 },
    ]);
    expect(plug(session, 'S1', 'relay-my4n').ok).toBe(true);

    const result = runSwapPart(session, 'S1', 'timer-h3y4');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('inventory-exhausted');
    expect(session.mounted['S1']?.kind).toBe('relay-my4n');
  });

  it('空きソケットは交換できない', () => {
    const session = makeSession();
    const result = runSwapPart(session, 'S1', 'relay-my4n');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('socket-empty');
  });
});

describe('3Dの装着部品のクリック（§8.2 / 利用者要望 2026-09-19）', () => {
  const socket = JIPM_BOARD.sockets[0];

  /** 装着部品を1個描く。 */
  function renderMounted(selected: boolean): {
    container: HTMLElement;
    onPickSocket: Mock<(socketId: SocketId, occupied: boolean) => void>;
  } {
    if (socket === undefined) throw new Error('ソケットが無い');
    const onPickSocket = vi.fn<(socketId: SocketId, occupied: boolean) => void>();
    const { container } = render(
      <MountedPart
        socket={socket}
        role="CR1"
        part={{ kind: 'relay-my4n' }}
        energized={false}
        timedOut={false}
        selected={selected}
        onPickSocket={onPickSocket}
      />,
    );
    return { container, onPickSocket };
  }

  it('本体の箱を押すとそのソケットが「装着済み」として選ばれる', () => {
    const { container, onPickSocket } = renderMounted(false);
    const meshes = [...container.querySelectorAll('mesh')];
    expect(meshes.length).toBeGreaterThan(0);

    for (const mesh of meshes) fireEvent.click(mesh);

    // 受けるのは本体の箱ただ1つ（飾りは `raycast` を空実装にしてクリックを通す）
    expect(onPickSocket).toHaveBeenCalledTimes(1);
    expect(onPickSocket).toHaveBeenCalledWith(socket?.id, true);
  });

  it('稜線は押しても何も起こさず、選択中だけ色が変わる', () => {
    const dark = renderMounted(false);
    const darkEdge = dark.container.querySelector('lineSegments > lineBasicMaterial');
    const darkColor = darkEdge?.getAttribute('color');
    fireEvent.click(dark.container.querySelectorAll('lineSegments')[0] as Element);
    expect(dark.onPickSocket).not.toHaveBeenCalled();
    cleanup();

    const lit = renderMounted(true);
    const litColor = lit.container
      .querySelector('lineSegments > lineBasicMaterial')
      ?.getAttribute('color');

    expect(darkColor).toBeTruthy();
    expect(litColor).toBeTruthy();
    expect(litColor).not.toBe(darkColor);
  });

  /**
   * 本体のマテリアルと稜線は共有する（レビュー指摘 3D-06）。
   * `useMemo` で作って props で渡していたので R3F の自動解放（JSX の子だけが対象）から漏れ、
   * 部品を付け外しするたびに `MeshStandardMaterial` と `EdgesGeometry` が積み上がっていた。
   */
  it('本体のマテリアルは色ごとに1個を使い回す（3D-06）', () => {
    if (socket === undefined) throw new Error('ソケットが無い');
    const options = { transparent: true, opacity: 0.85, roughness: 0.5, metalness: 0.2 };
    const relay = sharedMaterial(RELAY_BODY_COLOR, options);
    expect(sharedMaterial(RELAY_BODY_COLOR, options)).toBe(relay);
    // リレーとタイマは色が違うので別インスタンス（＝2個で足りる）
    expect(sharedMaterial(TIMER_BODY_COLOR, options)).not.toBe(relay);
  });

  it('稜線は寸法ごとに1個を使い回す（3D-06）', () => {
    const boxes = JIPM_BOARD.sockets.map((s) => mountedBodyBox(s));
    const edges = boxes.map((box) => sharedBodyEdges(box.width, box.height));
    // 盤の8ソケットは寸法が同じなので、稜線の実体は1個
    expect(new Set(edges).size).toBe(1);
    const first = boxes[0];
    if (first === undefined) throw new Error('ソケットが無い');
    expect(sharedBodyEdges(first.width, first.height)).toBe(edges[0]);
  });

  it('付け外しを繰り返しても稜線のインスタンスが増えない（3D-06）', () => {
    if (socket === undefined) throw new Error('ソケットが無い');
    const box = mountedBodyBox(socket);
    const before = sharedBodyEdges(box.width, box.height);
    renderMounted(false);
    cleanup();
    renderMounted(true);
    cleanup();
    expect(sharedBodyEdges(box.width, box.height)).toBe(before);
  });

  it('選択中のソケット本体は発光し、同じ状態なら同じマテリアルを使い回す', () => {
    const lit = socketBodyMaterial(true);
    const dark = socketBodyMaterial(false);

    expect(lit.emissiveIntensity).toBeGreaterThan(0);
    expect(dark.emissiveIntensity).toBe(0);
    expect(lit).not.toBe(dark);
    expect(socketBodyMaterial(true)).toBe(lit);
  });
});
