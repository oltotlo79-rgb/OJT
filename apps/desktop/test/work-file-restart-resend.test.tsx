// helpers/worker-bridge.js を他の import より前に置く（vi.mock のファクトリから参照するため）。
import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PROBLEMS,
} from '@ojt/content';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';

/**
 * Plan 2B レビュー B2: クラッシュ復帰（`home` ルート、まだどのセッション画面も張られていない）
 * では `WorkerBridge.send()` は `start()` するまで no-op なので、`applyWorkFile()` が送った
 * つまみの再送はまるごと捨てられる。同じことは、課題を切り替えて Worker を作り直す
 * （`[problemId, sessionEpoch]` の効果が張り直る）ときにも起きる。
 *
 * 画面側が Worker を起こして `load` を送った**直後**に、いま持っているつまみの状態を
 * もう一度送り直せば、送信元（`applyWorkFile()` かどうか）を問わず Worker 側と揃う。
 * ここでは「起動直後に Worker が動いていなかった」状況を再現せず、**画面が Worker を
 * 起動する効果自体がつまみを送り直すこと**を、ストアにあらかじめ立てたテスター状態を使って確認する
 * （`work-file-inspect.test.ts` は `applyWorkFile()` 側の再送を確認済み）。
 */

const mocks = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));

vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(mocks));

vi.mock('../src/renderer/three/BoardScene.js', () => ({
  BoardScene: () => <div data-testid="board-canvas" />,
  safeRoutes: () => ({ routes: [], errors: [] }),
}));

const { Session } = await import('../src/renderer/screens/Session.js');
const { InspectPartsSession } = await import('../src/renderer/screens/InspectPartsSession.js');
const { InspectRepairSession } = await import('../src/renderer/screens/InspectRepairSession.js');

const MODE_B = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');
const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);

beforeEach(() => {
  mocks.sent.length = 0;
});

afterEach(() => {
  cleanup();
});

function testerActionsOf(sent: Array<Record<string, unknown>>): unknown[] {
  return sent
    .filter((c) => c['type'] === 'tester')
    .map((c) => (c['action'] as Record<string, unknown>)['type']);
}

describe('画面マウント時のテスター再送（Plan 2B レビュー B2）', () => {
  it('モードBはテスターを触っていなければ何も送り直さない', () => {
    if (MODE_B === undefined) return;
    useStore.getState().openProblem(MODE_B);
    render(<Session />);
    expect(testerActionsOf(mocks.sent)).toEqual([]);
  });

  it('モードC1は load のあとにいまのテスター状態を送り直す', () => {
    if (C1 === undefined) return;
    useStore.getState().openProblem(C1);
    useStore.getState().applyTester({ type: 'set-mode', mode: 'OHM' });
    useStore.getState().applyTester({ type: 'zero-adjust' });
    mocks.sent.length = 0;

    render(<InspectPartsSession />);

    const load = mocks.sent.findIndex((c) => c['type'] === 'load');
    expect(load).toBeGreaterThanOrEqual(0);
    const testerActions = testerActionsOf(mocks.sent);
    expect(testerActions).toEqual([
      'set-kind',
      'set-mode',
      'set-volt-range',
      'set-ohm-range',
      'zero-adjust',
    ]);
    expect(
      mocks.sent.indexOf(mocks.sent.find((c) => c['type'] === 'tester') as never),
    ).toBeGreaterThan(load);
  });

  it('モードC2は load のあとにいまのテスター状態を送り直す', () => {
    if (C2 === undefined) return;
    useStore.getState().openProblem(C2);
    useStore.getState().applyTester({ type: 'set-mode', mode: 'DCV' });
    mocks.sent.length = 0;

    render(<InspectRepairSession />);

    const load = mocks.sent.findIndex((c) => c['type'] === 'load');
    expect(load).toBeGreaterThanOrEqual(0);
    const testerActions = testerActionsOf(mocks.sent);
    expect(testerActions).toEqual(['set-kind', 'set-mode', 'set-volt-range', 'set-ohm-range']);
    expect(
      mocks.sent.indexOf(mocks.sent.find((c) => c['type'] === 'tester') as never),
    ).toBeGreaterThan(load);
  });
});
