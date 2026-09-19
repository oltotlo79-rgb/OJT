import { JIPM_BOARD, remainingInventory, mountedKinds } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_PARTS_PROBLEMS, BUILTIN_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OjtApi, WorkFile } from '../src/shared/ipc.js';
import type { SimCommand } from '../src/worker/protocol.js';
import type { PickHit } from '../src/renderer/session/interaction.js';
import type * as BoardSceneModule from '../src/renderer/three/BoardScene.js';
import type * as WorkFileModule from '../src/renderer/session/work-file.js';

/**
 * セッション画面の操作テスト（§8.2 / §14.2）。
 *
 * 3Dビューポートは happy-dom では描けないので `BoardScene` を差し替える。差し替えた部品は
 * 受け取った `onPick` / `onHover` をそのまま外へ出すので、**端子をクリックした**という
 * 出来事を本物と同じ経路（`pickToAction` → `commands` → `bridge.send`）に流せる。
 * Worker ブリッジも差し替えて、送られたコマンドを配列に溜める。
 *
 * 作業ファイルの読込（`onLoad`）は `applyWorkFile()` を差し替える（`app.test.tsx` と同じ理由。
 * 課題の再読込みまで含めて本物を通すと盤の組み直しまで検証範囲が広がりすぎる）。
 * `toWorkFile()`（保存）は本物のまま使う。
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

const workFileMock = vi.hoisted(() => ({ applyWorkFile: vi.fn(() => Promise.resolve(true)) }));

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

vi.mock('../src/renderer/session/work-file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkFileModule>();
  return { ...actual, applyWorkFile: workFileMock.applyWorkFile };
});

const { Session } = await import('../src/renderer/screens/Session.js');
const { useStore, EMPTY_SNAPSHOT } = await import('../src/renderer/app/store.js');
const { JA } = await import('../src/renderer/i18n/ja.js');
const { sounds } = await import('../src/renderer/audio/sounds.js');

const PROBLEM = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');
/** モードC1課題（この画面はモードB専用なので「課題が選ばれていません」になる）。§12.1 */
const C1_PROBLEM = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
/** 1級課題（回路図ヒントのトグル自体が出ない。§8.4）。 */
const GRADE1_PROBLEM = BUILTIN_PROBLEMS.find((p) => p.grade === 1);
/** 2級課題（回路図ヒントを開閉できる。初期は閉じている。§8.4）。 */
const GRADE2_PROBLEM = BUILTIN_PROBLEMS.find((p) => p.grade === 2);

/** preload を差し替える（`delete` で「読み込まれていない」状態に戻せる）。 */
function setApi(api: Partial<OjtApi> | undefined): void {
  if (api === undefined) delete window.ojt;
  else window.ojt = api as OjtApi;
}

function autosaveFile(problemId: string, overrides: Partial<WorkFile> = {}): WorkFile {
  return {
    formatVersion: 1,
    problemId,
    session: { wires: [], socketRoles: {} },
    elapsedMs: 0,
    hazardCount: 0,
    savedAt: '2026-09-14T09:00:00.000Z',
    ...overrides,
  };
}

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
  workFileMock.applyWorkFile.mockClear();
  setApi(undefined);
  useStore.setState({ camera: 'front', cameraNonce: 0, judging: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setApi(undefined);
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

describe('手順帯（UXレビュー #3: 部品装着 → 配線 → 通電 → 判定）', () => {
  it('starts at the parts step before anything is mounted', () => {
    openSession();
    expect(screen.getByTestId('step-parts')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('step-wire')).toHaveAttribute('data-state', 'todo');
  });

  it('moves to wire once every part is mounted, to power once a wire is drawn, and to judge once powered', () => {
    openSession();
    const session = useStore.getState().session;
    if (session === undefined) throw new Error('セッションがありません');

    // 部品を使い切った体で「配線」がいまここになることを確かめる（装着の中身は問わない）
    act(() => {
      useStore.getState().setSession({ ...session, inventory: [] });
    });
    expect(screen.getByTestId('step-wire')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('step-power')).toHaveAttribute('data-state', 'todo');

    // 固定配線より多く配線したら「通電」がいまここになる
    act(() => {
      scene.pick?.(terminalHit('P.1'));
      scene.pick?.(terminalHit('TB_PB.2c'));
    });
    expect(screen.getByTestId('step-wire')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-power')).toHaveAttribute('data-state', 'current');

    // 通電したら「判定」がいまここになる
    act(() => {
      workerMock.handlers?.onSnapshot({ ...EMPTY_SNAPSHOT, powered: true });
    });
    expect(screen.getByTestId('step-power')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-judge')).toHaveAttribute('data-state', 'current');
  });
});

describe('部品の入れ替え（§8.2 / 利用者要望 2026-09-19）', () => {
  /**
   * 3Dの装着部品を押す → カードが「装着済み」の見た目になる → 「交換…」で別の部品に入れ替える。
   * 盤の上では抜いて挿し直すので Worker へは `unplug` → `plug` の順で送るが、
   * 履歴は1手だけ積む（「元に戻す」1回で元の部品に戻る）。
   */
  it('装着済み部品を押すとカードが開き、交換は unplug → plug の順で1手だけ積む', () => {
    openSession();
    act(() => {
      scene.pick?.({ kind: 'socket', id: 'S1', occupied: false });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('mount-relay-my4n'));
    });
    const historyAfterMount = useStore.getState().history.done.length;
    workerMock.sent = [];

    // 3Dの装着部品の本体を押すと `occupied: true` で返ってくる（`MountedPart` の当たり判定）
    act(() => {
      scene.pick?.({ kind: 'socket', id: 'S1', occupied: true });
    });
    expect(screen.getByTestId('socket-card-title')).toHaveTextContent(
      'ソケット S1: リレー MY4N（CR1）',
    );

    act(() => {
      fireEvent.click(screen.getByTestId('card-swap'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('swap-timer-h3y4'));
    });

    const state = useStore.getState();
    expect(state.session?.mounted['S1']?.kind).toBe('timer-h3y4');
    expect(state.history.done).toHaveLength(historyAfterMount + 1);
    expect(workerMock.sent.map((c) => (c as { type: string }).type)).toEqual(['unplug', 'plug']);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    });
    expect(useStore.getState().session?.mounted['S1']?.kind).toBe('relay-my4n');
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

  it('テンキー 7 で俯瞰、Ctrl＋テンキー 7 で下から（Blender と同じ。§12.2）', () => {
    openSession();
    act(() => {
      fireEvent.keyDown(document.body, { code: 'Numpad7', key: '7' });
    });
    expect(useStore.getState().camera).toBe('top');
    act(() => {
      fireEvent.keyDown(document.body, { code: 'Numpad3', key: '3' });
    });
    expect(useStore.getState().camera).toBe('right');
    act(() => {
      fireEvent.keyDown(document.body, { code: 'Numpad7', key: '7', ctrlKey: true });
    });
    expect(useStore.getState().camera).toBe('bottom');
    act(() => {
      fireEvent.keyDown(document.body, { code: 'Home', key: 'Home' });
    });
    expect(useStore.getState().camera).toBe('front');
  });

  it('入力欄で打ったテンキーでは視点が変わらない', () => {
    openSession();
    const input = document.createElement('input');
    input.type = 'number';
    document.body.appendChild(input);
    input.focus();
    const before = useStore.getState().cameraNonce;
    act(() => {
      fireEvent.keyDown(input, { code: 'Numpad7', key: '7' });
    });
    expect(useStore.getState().camera).toBe('front');
    expect(useStore.getState().cameraNonce).toBe(before);
    input.remove();
  });

  it('操作ヒントに Blender 風の割り当てが出ている（§12.2）', () => {
    openSession();
    expect(screen.getByTestId('view-hint').textContent).toBe(JA.session.viewHint);
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

describe('作業ファイルの保存・読込（§12.3）', () => {
  it('「作業を保存」は manual で保存し、成功したパスをトーストで出す', async () => {
    const saveWorkFile = vi.fn().mockResolvedValue({ ok: true, path: 'C:/work.ojtw' });
    setApi({ saveWorkFile });
    openSession();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.save }));
      await Promise.resolve();
    });

    expect(saveWorkFile).toHaveBeenCalledTimes(1);
    const request = saveWorkFile.mock.calls[0]?.[0] as {
      kind: string;
      file: { problemId: string };
    };
    expect(request.kind).toBe('manual');
    expect(request.file.problemId).toBe('b-001');
    expect(useStore.getState().toasts.at(-1)?.text).toContain('C:/work.ojtw');
    expect(useStore.getState().toasts.at(-1)?.tone).toBe('info');
  });

  it('保存に失敗したら理由をエラートーストで出す', async () => {
    const saveWorkFile = vi
      .fn()
      .mockResolvedValue({ ok: false, canceled: false, message: '保存に失敗しました' });
    setApi({ saveWorkFile });
    openSession();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.save }));
      await Promise.resolve();
    });

    const last = useStore.getState().toasts.at(-1);
    expect(last?.text).toBe('保存に失敗しました');
    expect(last?.tone).toBe('error');
  });

  it('preload が無ければ投げずにトーストで知らせる（保存・読込とも）', () => {
    openSession();
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.save }));
    }).not.toThrow();
    expect(useStore.getState().toasts.at(-1)?.tone).toBe('error');

    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.load }));
    }).not.toThrow();
    expect(useStore.getState().toasts.at(-1)?.tone).toBe('error');
  });

  it('「作業を読込」は manual で読み込み、結果を applyWorkFile へ渡す', async () => {
    const file = autosaveFile('b-001');
    const loadWorkFile = vi.fn().mockResolvedValue({ ok: true, file, path: 'C:/work.ojtw' });
    setApi({ loadWorkFile });
    openSession();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.load }));
      await Promise.resolve();
    });

    expect(loadWorkFile).toHaveBeenCalledWith({ kind: 'manual' });
    expect(workFileMock.applyWorkFile).toHaveBeenCalledWith(file);
  });

  it('読込ダイアログを取り消しても失敗トーストは出さない', async () => {
    const loadWorkFile = vi
      .fn()
      .mockResolvedValue({ ok: false, canceled: true, message: '読込を取り消しました' });
    setApi({ loadWorkFile });
    openSession();
    const before = useStore.getState().toasts.length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: JA.session.load }));
      await Promise.resolve();
    });

    expect(workFileMock.applyWorkFile).not.toHaveBeenCalled();
    expect(useStore.getState().toasts).toHaveLength(before);
  });
});

describe('回路図ヒント（§8.4: 3級=常時／2級=開閉可・初期は閉／1級=非表示）', () => {
  /** 課題を1つ開いてセッション画面を描く。 */
  function openProblemScreen(problem: typeof PROBLEM): void {
    if (problem === undefined) throw new Error('課題が見つかりません');
    act(() => {
      useStore.getState().openProblem(problem);
    });
    render(<Session />);
  }

  it('3級課題（b-001）は常時表示で、開閉ボタンを出さない', () => {
    openSession();
    expect(screen.getByTestId('schematic-hint')).toBeTruthy();
    // 常時表示なので訓練者が閉じる手段は無い（1D2-a: §8.4 の「常時表示」に合わせた）
    expect(screen.queryByTestId('toggle-schematic')).toBeNull();
  });

  it('2級課題は閉じた状態で始まり、ボタンで開閉できる', () => {
    expect(GRADE2_PROBLEM).toBeDefined();
    if (GRADE2_PROBLEM === undefined) return;
    openProblemScreen(GRADE2_PROBLEM);

    expect(screen.queryByTestId('schematic-hint')).toBeNull();
    const toggle = screen.getByTestId('toggle-schematic');
    expect(toggle.textContent).toBe(JA.session.showSchematic);

    fireEvent.click(toggle);
    expect(screen.getByTestId('schematic-hint')).toBeTruthy();
    expect(screen.getByTestId('toggle-schematic').textContent).toBe(JA.session.hideSchematic);

    fireEvent.click(screen.getByTestId('toggle-schematic'));
    expect(screen.queryByTestId('schematic-hint')).toBeNull();
  });

  it('1級課題はトグルボタン自体が無く、ヒントも出ない', () => {
    expect(GRADE1_PROBLEM).toBeDefined();
    if (GRADE1_PROBLEM === undefined) return;
    openProblemScreen(GRADE1_PROBLEM);

    expect(screen.queryByTestId('toggle-schematic')).toBeNull();
    expect(screen.queryByTestId('schematic-hint')).toBeNull();
  });

  /**
   * 1D2-a のレビュー指摘: 常時表示の3級で回路図が「部品」より前にあると、縦長の回路図に
   * 押し出されて部品パネルが画面外へ行き、右パネルを一番下まで繰らないと部品を装着できなかった。
   */
  it('3級で常時表示になるヒントは、部品パネルより後ろに描く', () => {
    openSession();
    const parts = screen.getByTestId('parts-panel');
    const hint = screen.getByTestId('schematic-hint');
    expect(parts.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('効果音（§15）', () => {
  /**
   * `SoundEffects` はマウント時の `snapshot`（`openProblem()` が入れる `EMPTY_SNAPSHOT`。
   * `relays: {}` でキー自体が無い）をすでに1枚目の基準として消費している。そのため
   * 「`CR1` を初めて含む1枚」はキーの有無だけで差分と見なされ鳴ってしまう
   * （`soundsForSnapshot()` は未知キーを `undefined` として比較するため）。ここでは
   * その1枚で基準を揃えてから、値が変わらない2枚目・変わる3枚目で挙動を確かめる。
   */
  it('リレーの接点が動いたスナップショットで relay 音を鳴らし、変わらなければ鳴らさない', () => {
    const play = vi.spyOn(sounds, 'play').mockImplementation(() => undefined);
    openSession();

    act(() => {
      workerMock.handlers?.onSnapshot({
        ...EMPTY_SNAPSHOT,
        relays: { CR1: { contactsOn: false } },
      });
    });
    play.mockClear();

    act(() => {
      workerMock.handlers?.onSnapshot({
        ...EMPTY_SNAPSHOT,
        relays: { CR1: { contactsOn: false } },
      });
    });
    expect(play).not.toHaveBeenCalled();

    act(() => {
      workerMock.handlers?.onSnapshot({
        ...EMPTY_SNAPSHOT,
        relays: { CR1: { contactsOn: true } },
      });
    });
    expect(play).toHaveBeenCalledWith('relay');
  });

  it('危険操作を含むスナップショットは warning を鳴らす', () => {
    const play = vi.spyOn(sounds, 'play').mockImplementation(() => undefined);
    openSession();

    act(() => {
      workerMock.handlers?.onSnapshot({
        ...EMPTY_SNAPSHOT,
        hazardDelta: [{ type: 'hazard', kind: 'ohm-on-live', tMs: 0, detail: '' }],
      });
    });

    expect(play).toHaveBeenCalledWith('warning');
  });
});

describe('モードB以外の課題（§12.1 / Plan 2B Batch 1 レビュー）', () => {
  /**
   * `ProblemList` は20題すべてを開けるので、C1/C2 の課題もこの画面に届きうる（振り分けの
   * `SessionRoute` は Task 10）。絞り込みから漏れた課題で行き止まりにならないこと、
   * その間 Worker を起動しないことを固定する。
   */
  it('C1課題では一覧へ戻る導線を出し、Worker を起動しない', () => {
    expect(C1_PROBLEM).toBeDefined();
    if (C1_PROBLEM === undefined) return;
    act(() => {
      useStore.getState().openProblem(C1_PROBLEM);
    });
    render(<Session />);

    // 追従ループを回す相手（モードBの盤）がいないので Worker は起こさない
    expect(workerMock.handlers).toBeUndefined();
    expect(workerMock.sent).toEqual([]);

    const back = screen.getByRole('button', { name: JA.result.toList });
    act(() => {
      fireEvent.click(back);
    });

    expect(useStore.getState().route).toBe('list');
    expect(useStore.getState().problem).toBeUndefined();
  });
});
