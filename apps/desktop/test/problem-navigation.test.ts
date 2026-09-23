import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { addWire } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_ALL_PROBLEMS, type SupportedProblem } from '@ojt/content';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import type { OjtApi } from '../src/shared/ipc.js';
import { boardForProblem } from '../src/renderer/session/plc-session.js';
import {
  cancelProblemChange,
  confirmProblemChange,
  requestOpenProblem,
  requestRestartProblem,
  useProblemNavigation,
} from '../src/renderer/session/problem-navigation.js';
import {
  applyWorkFile,
  persistentWorkKey,
  toInspectWorkFile,
} from '../src/renderer/session/work-file.js';

const bridgeState = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
const api = vi.hoisted(() => ({
  saveWorkFile: vi.fn<OjtApi['saveWorkFile']>(),
  readProblem: vi.fn(),
}));
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeState));
vi.mock('../src/renderer/app/ojt-api.js', () => ({ ojtApi: () => api }));
const problem = (id: string): SupportedProblem => BUILTIN_ALL_PROBLEMS.find((p) => p.id === id)!;
const key = (): string => persistentWorkKey(toInspectWorkFile()!);
function edit(): void {
  const state = useStore.getState();
  const current = state.problem!;
  if (current.mode === 'inspect-parts') state.setAnswer(current.parts[0]!.id, 'normal');
  else if (current.mode === 'inspect-repair')
    state.addReport({ kind: 'wire-open', target: { wireId: state.session!.wires[0]!.id } });
  else {
    const session = structuredClone(state.session!);
    expect(
      addWire(
        session,
        boardForProblem(current),
        toTerminalId('P.1'),
        toTerminalId('TB_PB.2c'),
        '青',
      ).ok,
    ).toBe(true);
    state.setSession(session);
  }
  useStore.setState({
    diagnosisNotes: [
      {
        id: 'note-1',
        target: 'CR1',
        prediction: '入力を確認',
        conclusion: '次に電圧を測る',
        measurementIds: [],
      },
    ],
  });
}
beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ defaultVendor: 'mitsubishi' });
  useProblemNavigation.setState({ pending: undefined, busy: false, message: '' });
  api.saveWorkFile.mockReset().mockResolvedValue({ ok: true, path: 'test.ojtw' });
  api.readProblem.mockReset();
  bridgeState.sent = [];
});

describe('N01: 課題の選択・再開・やり直しで作業を保護する', () => {
  it.each(['b-001', 'c1-001', 'c2-001', 'd-001'])(
    '%s: 一覧から同じ課題を選んでも作業・履歴・故障を作り直さない',
    (id) => {
      requestOpenProblem(problem(id));
      edit();
      useStore.setState({ elapsedMs: 12500 });
      const before = key();
      const history = useStore.getState().history;
      const circuit = useStore.getState().circuit;
      useStore.getState().setRoute('list');
      requestOpenProblem(problem(id));
      expect(key()).toBe(before);
      expect(useStore.getState()).toMatchObject({ route: 'session', elapsedMs: 12500 });
      expect(useStore.getState().history).toBe(history);
      expect(useStore.getState().circuit).toBe(circuit);
      expect(useProblemNavigation.getState().pending).toBeUndefined();
    },
  );

  it.each(['b-001', 'c1-001', 'c2-001', 'd-001'])(
    '%s: 別課題への移動を取り消すと編集を保持する',
    (id) => {
      requestOpenProblem(problem(id));
      edit();
      const before = key();
      useStore.getState().setRoute('list');
      requestOpenProblem(problem('b-002'));
      expect(useProblemNavigation.getState().pending).toBeDefined();
      expect(key()).toBe(before);
      cancelProblemChange();
      expect(useStore.getState().problem!.id).toBe(id);
      expect(key()).toBe(before);
    },
  );

  it('編集していない新規課題は保存確認を増やさず切り替える', () => {
    requestOpenProblem(problem('c2-001'));
    requestOpenProblem(problem('b-002'));
    expect(useStore.getState().problem!.id).toBe('b-002');
    expect(useProblemNavigation.getState().pending).toBeUndefined();
  });

  it.each([
    { ok: false, canceled: true, message: '取消' },
    { ok: false, message: '容量不足' },
  ])('保存が完了しなければ元の作業を保持する: %j', async (result) => {
    requestOpenProblem(problem('b-001'));
    edit();
    const before = key();
    requestOpenProblem(problem('b-002'));
    api.saveWorkFile.mockResolvedValue({
      ok: false,
      canceled: result.canceled ?? false,
      message: result.message,
    });
    await confirmProblemChange(true);
    expect(key()).toBe(before);
    expect(useProblemNavigation.getState()).toMatchObject({ busy: false });
    expect(useProblemNavigation.getState().pending).toBeDefined();
  });

  it('手動保存の成功後に別課題を開く', async () => {
    requestOpenProblem(problem('b-001'));
    edit();
    const before = key();
    requestOpenProblem(problem('b-002'));
    await confirmProblemChange(true);
    expect(api.saveWorkFile.mock.calls[0]![0].kind).toBe('manual');
    expect(persistentWorkKey(api.saveWorkFile.mock.calls[0]![0].file)).toBe(before);
    expect(useStore.getState().problem!.id).toBe('b-002');
    expect(useProblemNavigation.getState().pending).toBeUndefined();
  });

  it('保存中に変更された内容を古い保存の成功で破棄しない', async () => {
    requestOpenProblem(problem('b-001'));
    edit();
    requestOpenProblem(problem('b-002'));
    let finish: ((value: { ok: true; path: string }) => void) | undefined;
    api.saveWorkFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = confirmProblemChange(true);
    cancelProblemChange();
    expect(useProblemNavigation.getState().pending).toBeDefined();
    useStore.setState({ hintStage: 3 });
    finish!({ ok: true, path: 'test.ojtw' });
    await pending;
    expect(useStore.getState()).toMatchObject({ hintStage: 3, problem: { id: 'b-001' } });
    expect(useProblemNavigation.getState().message).toContain('保存中に作業が変わりました');
  });

  it('自動保存から復元しただけの作業も上書き前に確認する', async () => {
    requestOpenProblem(problem('b-001'));
    edit();
    const file = structuredClone(toInspectWorkFile()!);
    useStore.getState().abandonSession();
    api.readProblem.mockResolvedValue(problem('b-001'));
    expect(await applyWorkFile(file)).toBe(true);
    requestOpenProblem(problem('b-002'));
    expect(useProblemNavigation.getState().pending).toBeDefined();
    expect(key()).toBe(persistentWorkKey(file));
  });

  it('最初からのやり直しは明示的な破棄を選んだ後だけ初期化する', async () => {
    requestOpenProblem(problem('b-001'));
    edit();
    const before = key();
    requestRestartProblem();
    expect(key()).toBe(before);
    await confirmProblemChange(false);
    expect(useStore.getState().session!.wires).toHaveLength(0);
    expect(useStore.getState().diagnosisNotes).toHaveLength(0);
    expect(api.saveWorkFile).not.toHaveBeenCalled();
  });
});
