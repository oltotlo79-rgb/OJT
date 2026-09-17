import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { InspectRepairSession } from '../src/renderer/screens/InspectRepairSession.js';

/**
 * モードC2のセッション画面（Plan 2B Task 14）。設計仕様 §9.2。
 * 3D（`BoardScene`）は WebGL が要るので差し替え、`onPick` だけを取り出して検証する。
 */

const mocks = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  picks: [] as Array<(hit: unknown) => void>,
}));

vi.mock('../src/renderer/session/worker-bridge.js', () => ({
  bridge: {
    start: () => undefined,
    stop: () => undefined,
    send: (command: Record<string, unknown>) => {
      mocks.sent.push(command);
    },
  },
}));

vi.mock('../src/renderer/three/BoardScene.js', () => ({
  BoardScene: ({ onPick }: { onPick: (hit: unknown) => void }) => {
    mocks.picks.push(onPick);
    return <div data-testid="board-canvas" />;
  },
  safeRoutes: () => ({ routes: [], errors: [] }),
}));

const { sent, picks } = mocks;

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);

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
  if (C2 !== undefined) useStore.getState().openProblem(C2);
});

afterEach(() => {
  cleanup();
});

describe('画面の骨格（§9.2）', () => {
  it('指摘パネル・修復パネル・テスターを並べ、線色は白だけを出す', () => {
    render(<InspectRepairSession />);
    expect(screen.getByTestId('report-panel')).toBeTruthy();
    expect(screen.getByTestId('repair-panel')).toBeTruthy();
    expect(screen.getByTestId('tester-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: '白' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '青' })).toBeNull();
  });

  it('2級形式は回路図を出す（§9.2 提示情報）', () => {
    render(<InspectRepairSession />);
    expect(screen.getByTestId('schematic-hint')).toBeTruthy();
  });

  it('開始時に故障入りの盤を load する', () => {
    render(<InspectRepairSession />);
    const load = sent.filter((c) => c['type'] === 'load').at(-1);
    expect(load).toBeDefined();
    expect(load?.['partFaults']).toBeDefined();
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
    // 故障箇所でも外した事実は出す（判定を漏らさない。Blocking fix）
    expect(screen.getByTestId('removed-wires').textContent).toContain(faultedId);

    // 健全な青線を外しても同様に出る
    const onPick2 = picks.at(-1);
    if (onPick2 === undefined) return;
    act(() => {
      onPick2({ kind: 'wire', id: healthy.id, locked: false });
    });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getByTestId('removed-wires').textContent).toContain(healthy.id);
  });
});

describe('部品交換（§9.2）', () => {
  it('交換すると unplug と plug を送り、回路から部品の故障が消える', () => {
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
