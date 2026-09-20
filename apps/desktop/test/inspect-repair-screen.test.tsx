// helpers/worker-bridge.js を他の import より前に置く（vi.mock のファクトリから参照するため）。
import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { JA, wireLabel } from '../src/renderer/i18n/ja.js';
import { InspectRepairSession } from '../src/renderer/screens/InspectRepairSession.js';
import type * as SpecChartModule from '../src/renderer/session/spec-chart.js';

/**
 * モードC2のセッション画面（Plan 2B Task 14）。設計仕様 §9.2。
 * 3D（`BoardScene`）は WebGL が要るので差し替え、`onPick` だけを取り出して検証する。
 */

const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
const mocks = vi.hoisted(() => ({
  picks: [] as Array<(hit: unknown) => void>,
  hovers: [] as Array<(id: unknown) => void>,
  forceSpecFail: false,
}));

vi.mock('../src/renderer/session/spec-chart.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SpecChartModule>();
  return {
    ...actual,
    buildSpecChart: (problem: Parameters<typeof actual.buildSpecChart>[0]) =>
      mocks.forceSpecFail ? { ok: false, errors: ['boom'] } : actual.buildSpecChart(problem),
  };
});

vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

vi.mock('../src/renderer/three/BoardScene.js', () => ({
  BoardScene: ({
    onPick,
    onHover,
  }: {
    onPick: (hit: unknown) => void;
    onHover: (id: unknown) => void;
  }) => {
    mocks.picks.push(onPick);
    mocks.hovers.push(onHover);
    return <div data-testid="board-canvas" />;
  },
  safeRoutes: () => ({ routes: [], errors: [] }),
}));

const { sent } = bridgeMock;
const { picks, hovers } = mocks;

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);
const C2_GRADE1 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 1);
/** CR1 に部品故障（`contact-resistive`）が入っている課題。部品交換のテスト用。 */
const C2_PART = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === 'c2-002');

/**
 * 白線を張る端子の組（`c2-001` の `wire-missing`（`sw-009`）をそのまま直す1本）。§9.2
 * `CR1.13` / `CR1.14` は既に2本ずつ埋まっていて3本目が盤に断られる（§5.6 #5）ので、
 * 未配線の故障箇所そのもの（`CR1.6` — `TB_PL.1+`）で試す。
 */
const REPAIR_FROM = toTerminalId('S1.6');
const REPAIR_TO = toTerminalId('TB_PL.1+');

beforeEach(() => {
  sent.length = 0;
  picks.length = 0;
  hovers.length = 0;
  if (C2 !== undefined) useStore.getState().openProblem(C2);
});

afterEach(() => {
  cleanup();
});

/** UXレビュー #17: 回路図の開閉は「…」メニューの中に畳んだので、まずそこを開く。 */
function openToolbarOverflow(): void {
  fireEvent.click(screen.getByTestId('toolbar-overflow-toggle'));
}

describe('画面の骨格（§9.2）', () => {
  it('指摘パネル・修復パネル・テスターを並べ、線色は白だけを出す', () => {
    render(<InspectRepairSession />);
    expect(screen.getByTestId('report-panel')).toBeTruthy();
    expect(screen.getByTestId('repair-panel')).toBeTruthy();
    expect(screen.getByTestId('tester-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: '白' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '青' })).toBeNull();
  });

  it('2級形式は回路図ヒントを開閉できる。既定は閉じている（§8.4 2026-09-18の決定）', () => {
    render(<InspectRepairSession />);
    openToolbarOverflow();
    expect(screen.queryByTestId('schematic-hint')).toBeNull();
    const toggle = screen.getByTestId('toggle-schematic');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('schematic-hint')).toBeTruthy();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('回路図ヒントを開くたびにストアの開いた回数が増える（§8.4）', () => {
    render(<InspectRepairSession />);
    openToolbarOverflow();
    expect(useStore.getState().schematicOpenCount).toBe(0);
    const toggle = screen.getByTestId('toggle-schematic');
    fireEvent.click(toggle); // 開く: 1
    expect(useStore.getState().schematicOpenCount).toBe(1);
    fireEvent.click(toggle); // 閉じる: 増えない
    expect(useStore.getState().schematicOpenCount).toBe(1);
    fireEvent.click(toggle); // 開く: 2
    expect(useStore.getState().schematicOpenCount).toBe(2);
  });

  it('1級形式は開閉ボタンを出さない（回路図ヒントも常に無い。§8.4）', () => {
    expect(C2_GRADE1).toBeDefined();
    if (C2_GRADE1 === undefined) return;
    useStore.getState().openProblem(C2_GRADE1);
    render(<InspectRepairSession />);
    openToolbarOverflow();
    expect(screen.queryByTestId('toggle-schematic')).toBeNull();
    expect(screen.queryByTestId('schematic-hint')).toBeNull();
  });

  it('閉じている間は端子ホバーで連動ハイライトを引かない（§9.2 I-8）', () => {
    render(<InspectRepairSession />);
    openToolbarOverflow();
    expect(screen.queryByTestId('schematic-hint')).toBeNull();
    // 開く前に何か光らせておき、閉じたままのホバーでは動かないことを確かめる
    useStore.getState().setHighlight({ cellIds: ['c1'], terminals: ['CR1.13'], wireIds: [] });
    const onHover = hovers.at(-1);
    expect(onHover).toBeDefined();
    if (onHover === undefined) return;
    act(() => {
      onHover(toTerminalId('S1.13'));
    });
    // 閉じているので逆引きは走らず、ハイライトは直前のまま変わらない
    expect(useStore.getState().highlight.cellIds).toEqual(['c1']);

    fireEvent.click(screen.getByTestId('toggle-schematic'));
    act(() => {
      onHover(undefined);
    });
    // 開いていれば「端子から外れた」ときに逆引きが走り、光っていたものを消す
    expect(useStore.getState().highlight).toEqual({ cellIds: [], terminals: [], wireIds: [] });
  });

  it('回路図ヒントはテスターより上に出す（M4）', () => {
    render(<InspectRepairSession />);
    openToolbarOverflow();
    fireEvent.click(screen.getByTestId('toggle-schematic'));
    const schematic = screen.getByTestId('schematic-hint');
    const tester = screen.getByTestId('tester-panel');
    expect(schematic.compareDocumentPosition(tester) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('開始時に故障入りの盤を load する', () => {
    render(<InspectRepairSession />);
    const load = sent.filter((c) => c['type'] === 'load').at(-1);
    expect(load).toBeDefined();
    expect(load?.['partFaults']).toBeDefined();
  });

  it('状態オーバーレイは固定を除いた本数と固定の本数を分けて示す（UXレビュー #21）', () => {
    render(<InspectRepairSession />);
    const wires = useStore.getState().session?.wires ?? [];
    const fixed = wires.filter((w) => w.locked).length;
    const overlay = screen.getByTestId('status-overlay');
    expect(overlay.textContent).toContain(
      `自分で張った電線 ${String(wires.length - fixed)} 本（固定 ${String(fixed)} 本）`,
    );
  });
});

describe('指摘（§9.2）', () => {
  it('電線をクリックすると種別ポップオーバーが出て、選ぶと登録される', () => {
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('tool-report'));
    const onPick = picks.at(-1);
    expect(onPick).toBeDefined();
    if (onPick === undefined) return;
    act(() => {
      onPick({ kind: 'wire', id: 'sw-003', locked: false });
    });
    expect(screen.getByTestId('report-popover')).toBeTruthy();
    fireEvent.click(screen.getByTestId('report-kind-wire-open'));
    expect(useStore.getState().reports).toEqual([
      { target: { wireId: 'sw-003' }, kind: 'wire-open' },
    ]);
  });

  it('同じ指摘を2回登録しない（§9.2）', () => {
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('tool-report'));
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    for (let i = 0; i < 2; i += 1) {
      act(() => {
        onPick({ kind: 'wire', id: 'sw-003', locked: false });
      });
      fireEvent.click(screen.getByTestId('report-kind-wire-open'));
    }
    expect(useStore.getState().reports).toHaveLength(1);
  });

  it('端子をクリックすると未配線の指摘になる', () => {
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('tool-report'));
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    act(() => {
      onPick({ kind: 'terminal', id: toTerminalId('S1.13'), wirable: true, label: 'CR1 ⑬ −' });
    });
    fireEvent.click(screen.getByTestId('report-kind-wire-missing'));
    expect(useStore.getState().reports).toEqual([
      { target: { terminalId: 'CR1.13' }, kind: 'wire-missing' },
    ]);
  });

  it('取消で指摘を消せる', () => {
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('tool-report'));
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    act(() => {
      onPick({ kind: 'wire', id: 'sw-003', locked: false });
    });
    fireEvent.click(screen.getByTestId('report-kind-wire-open'));
    fireEvent.click(screen.getByTestId('remove-report-0'));
    expect(useStore.getState().reports).toEqual([]);
  });
});

describe('修復パネルの「外した青線」が答えを漏らす（§9.2）', () => {
  it('故障箇所の青線を外しても一覧に出る（事実として並べる。判定側だけが改造を判断する）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(<InspectRepairSession />);
    const store = useStore.getState();
    const circuit = store.circuit;
    const session = store.session;
    expect(circuit && session).toBeTruthy();
    if (circuit === undefined || session === undefined) return;
    const faultedId = circuit.applied.sites.find((s) => s.kind === 'wire-open')?.wireId;
    expect(faultedId).toBeDefined();
    if (faultedId === undefined) return;
    const faulted = session.wires.find((w) => w.id === faultedId);
    expect(faulted).toBeDefined();
    if (faulted === undefined) return;
    const healthy = session.wires.find((w) => !w.locked && w.id !== faultedId);
    expect(healthy).toBeDefined();
    if (healthy === undefined) return;

    // 削除モードで故障箇所の青線を外す
    fireEvent.click(screen.getByRole('button', { name: JA.session.deleteMode }));
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    act(() => {
      onPick({ kind: 'wire', id: faultedId, locked: false });
    });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(useStore.getState().session?.wires.some((w) => w.id === faultedId)).toBe(false);
    // 故障箇所でも外した事実は出す（判定を漏らさない。Blocking fix）。
    // 内部の電線ID（`sw-003` 等）ではなく、他画面と同じ「端子と色」の表示名で出す（UI監査 I5）。
    expect(screen.getByTestId('removed-wires').textContent).toContain(wireLabel(faulted));
    expect(screen.getByTestId('removed-wires').textContent).not.toContain(faultedId);

    // 健全な青線を外しても同様に出る
    const onPick2 = picks.at(-1);
    if (onPick2 === undefined) return;
    act(() => {
      onPick2({ kind: 'wire', id: healthy.id, locked: false });
    });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getByTestId('removed-wires').textContent).toContain(wireLabel(healthy));
    expect(screen.getByTestId('removed-wires').textContent).not.toContain(healthy.id);
  });
});

describe('回路図の参照エラー（§9.2。モードBと同じ流儀）', () => {
  it('spec チャートの構築に失敗したら reference-error を出す', () => {
    mocks.forceSpecFail = true;
    try {
      render(<InspectRepairSession />);
      expect(screen.getByTestId('reference-error')).toBeTruthy();
    } finally {
      mocks.forceSpecFail = false;
    }
  });
});

describe('部品交換（§9.2）', () => {
  it('交換すると unplug と plug を送り、回路から部品の故障が消える', () => {
    expect(C2_PART).toBeDefined();
    if (C2_PART === undefined) return;
    useStore.getState().openProblem(C2_PART);
    render(<InspectRepairSession />);
    const before = useStore.getState().circuit;
    expect(before).toBeDefined();
    if (before === undefined) return;
    const row = screen.queryByTestId('replace-CR1');
    expect(row).not.toBeNull();
    if (row === null) return;
    fireEvent.click(row);
    expect(sent.some((c) => c['type'] === 'unplug')).toBe(true);
    expect(sent.some((c) => c['type'] === 'plug')).toBe(true);
    const after = useStore.getState().circuit;
    expect(
      after?.applied.partFaults.some((f) => 'partId' in f.target && f.target.partId === 'CR1'),
    ).toBe(false);
    // 指摘の対象（sites）は残る（Plan 2A 差分 #7）
    expect(after?.applied.sites).toHaveLength(before.applied.sites.length);
  });
});

describe('部品交換を2回押すと履歴が壊れる（§9.2）', () => {
  it('交換済みの部品にもう一度押しても履歴に積まず、ボタンは無効表示になる', () => {
    expect(C2_PART).toBeDefined();
    if (C2_PART === undefined) return;
    useStore.getState().openProblem(C2_PART);
    render(<InspectRepairSession />);
    const row = screen.getByTestId('replace-CR1');
    fireEvent.click(row);
    expect(useStore.getState().history.done).toHaveLength(1);
    // 交換済みなのでボタンは無効になる（見た目でも二度押しを防ぐ）
    expect(screen.getByTestId<HTMLButtonElement>('replace-CR1').disabled).toBe(true);
    fireEvent.click(screen.getByTestId('replace-CR1'));
    // 2回目は何もしない（disabled のクリックは onClick を呼ばないのでハンドラも防御する）
    expect(useStore.getState().history.done).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    expect(useStore.getState().circuit?.applied.partFaults.length).toBeGreaterThan(0);
  });
});

describe('判定（§9.2）', () => {
  it('判定ボタンで judgeRepair を送る', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('judge-button'));
    const judge = sent.find((c) => c['type'] === 'judgeRepair');
    expect(judge).toBeDefined();
    expect(judge?.['circuit']).toBeDefined();
    expect(useStore.getState().judging).toBe(true);
  });
});

describe('元に戻す・やり直し（§8.2 / §9.2。I-11）', () => {
  it('元に戻すと Worker へ load を送り直すのに合わせ、パネルのプローブも外す（Worker と揃える）', () => {
    render(<InspectRepairSession />);
    fireEvent.click(screen.getByTestId('tool-tester'));
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    act(() => {
      onPick({ kind: 'terminal', id: toTerminalId('S1.13'), wirable: true, label: 'a' });
    });
    act(() => {
      onPick({ kind: 'terminal', id: toTerminalId('S1.14'), wirable: true, label: 'b' });
    });
    expect(useStore.getState().tester.black).toBeDefined();
    expect(useStore.getState().tester.red).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '白' }));
    const onPick2 = picks.at(-1);
    if (onPick2 === undefined) return;
    act(() => {
      onPick2({ kind: 'terminal', id: REPAIR_FROM, wirable: true, label: 'a' });
    });
    act(() => {
      onPick2({ kind: 'terminal', id: REPAIR_TO, wirable: true, label: 'b' });
    });
    sent.length = 0;
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));

    expect(sent.some((c) => c['type'] === 'load')).toBe(true);
    const tester = useStore.getState().tester;
    expect(
      { black: tester.black, red: tester.red },
      'renderer probes should have been cleared to match the worker',
    ).toEqual({ black: undefined, red: undefined });
  });
});

describe('元に戻す・やり直し：配線と部品交換（§8.2 / §9.2。I-11）', () => {
  it('白線を張ってから元に戻すと配線前の本数に戻る', () => {
    render(<InspectRepairSession />);
    const before = useStore.getState().session?.wires.length ?? 0;
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    fireEvent.click(screen.getByRole('button', { name: '白' }));
    act(() => {
      onPick({ kind: 'terminal', id: REPAIR_FROM, wirable: true, label: 'a' });
    });
    act(() => {
      onPick({ kind: 'terminal', id: REPAIR_TO, wirable: true, label: 'b' });
    });
    expect(useStore.getState().session?.wires.length).toBe(before + 1);
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    expect(useStore.getState().session?.wires.length).toBe(before);
  });

  it('元に戻したあとやり直すと配線後の本数に戻る', () => {
    render(<InspectRepairSession />);
    const before = useStore.getState().session?.wires.length ?? 0;
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    fireEvent.click(screen.getByRole('button', { name: '白' }));
    act(() => {
      onPick({ kind: 'terminal', id: REPAIR_FROM, wirable: true, label: 'a' });
    });
    act(() => {
      onPick({ kind: 'terminal', id: REPAIR_TO, wirable: true, label: 'b' });
    });
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    fireEvent.click(screen.getByRole('button', { name: JA.session.redo }));
    expect(useStore.getState().session?.wires.length).toBe(before + 1);
  });

  it('部品交換を元に戻すと故障が復活する（sites は変わらない。§9.2）', () => {
    expect(C2_PART).toBeDefined();
    if (C2_PART === undefined) return;
    useStore.getState().openProblem(C2_PART);
    render(<InspectRepairSession />);
    const before = useStore.getState().circuit;
    if (before === undefined) return;
    const row = screen.queryByTestId('replace-CR1');
    if (row === null) return;
    fireEvent.click(row);
    const replaced = useStore.getState().circuit;
    fireEvent.click(screen.getByRole('button', { name: JA.session.undo }));
    const restored = useStore.getState().circuit;
    expect(restored?.applied.partFaults).toEqual(before.applied.partFaults);
    expect(restored?.applied.sites).toEqual(replaced?.applied.sites);
    // 元に戻したら故障入りの盤を読み直す（`plug` は良品を作るので差分では戻せない。§9.2）
    const load = sent.filter((c) => c['type'] === 'load').at(-1);
    expect(load?.['partFaults']).toEqual(before.applied.partFaults);
  });
});

describe('手順帯（UXレビュー #3: 指摘 → 修復 → 判定）', () => {
  it('walks report → fix → judge from real store state', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(<InspectRepairSession />);
    expect(screen.getByTestId('step-report')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('step-fix')).toHaveAttribute('data-state', 'todo');
    // c2-001 は故障が2箇所（§9.2）。指摘すべき件数ぶん揃うまでは「済」にしない（UI監査 I19）。
    expect(useStore.getState().circuit?.applied.sites.length).toBe(2);

    fireEvent.click(screen.getByTestId('tool-report'));
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    act(() => {
      onPick({ kind: 'wire', id: 'sw-003', locked: false });
    });
    fireEvent.click(screen.getByTestId('report-kind-wire-open'));
    // 1件目だけでは、まだ「いまここ」のまま（UI監査 I19）
    expect(screen.getByTestId('step-report')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('step-fix')).toHaveAttribute('data-state', 'todo');

    act(() => {
      onPick({ kind: 'wire', id: 'sw-004', locked: false });
    });
    fireEvent.click(screen.getByTestId('report-kind-wire-open'));
    // 2件目で指摘すべき件数に達し、ようやく「済」になる
    expect(screen.getByTestId('step-report')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-fix')).toHaveAttribute('data-state', 'current');

    fireEvent.click(screen.getByRole('button', { name: '白' }));
    act(() => {
      onPick({ kind: 'terminal', id: REPAIR_FROM, wirable: true, label: 'a' });
    });
    act(() => {
      onPick({ kind: 'terminal', id: REPAIR_TO, wirable: true, label: 'b' });
    });
    expect(screen.getByTestId('step-fix')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-judge')).toHaveAttribute('data-state', 'current');
  });
});
