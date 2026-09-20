// helpers/worker-bridge.js を他の import より前に置く（vi.mock のファクトリから参照するため）。
import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { wireId } from '@ojt/circuit-sim';
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WorkFile } from '../src/shared/ipc.js';

/**
 * 作業ファイルの組み立て・復元のテスト（§12.3 / §13 #8）。
 * 手動読込（セッション画面）と起動時の一時保存からの復帰（ホーム）で共用するモジュール。
 *
 * `ojtApi()` と Worker ブリッジは差し替える。`applyWorkFile()` は盤を Worker にも
 * 読ませるが、本物の Worker は happy-dom で動かないため。
 */

/** `ojtApi()` の差し替え状態。`throwOnAccess` は投げる例外の理由（`false` なら投げない＝preload あり）。 */
interface ApiState {
  readProblem: Mock;
  throwOnAccess: false | string;
}

const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
const apiState = vi.hoisted((): ApiState => ({
  readProblem: vi.fn(),
  throwOnAccess: false,
}));

vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

vi.mock('../src/renderer/app/ojt-api.js', () => ({
  ojtApi: () => {
    if (apiState.throwOnAccess !== false) throw new Error(apiState.throwOnAccess);
    return { readProblem: apiState.readProblem };
  },
}));

const { toWorkFile, toSession, applyWorkFile, needsDiscardConfirm, MAX_RESTORED_WIRES } =
  await import('../src/renderer/session/work-file.js');
const { useStore, sessionForProblem } = await import('../src/renderer/app/store.js');
const { WORK_FILE_FORMAT_VERSION } = await import('../src/shared/ipc.js');
const { JA } = await import('../src/renderer/i18n/ja.js');

const PROBLEM = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');
if (PROBLEM === undefined) throw new Error('b-001 が見つかりません');
const SESSION = sessionForProblem(PROBLEM);

function sampleFile(overrides: Partial<WorkFile> = {}): WorkFile {
  return {
    formatVersion: WORK_FILE_FORMAT_VERSION,
    problemId: 'b-001',
    session: SESSION,
    elapsedMs: 5000,
    hazardCount: 1,
    savedAt: '2026-09-14T01:02:03.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  bridgeMock.sent = [];
  apiState.readProblem.mockReset();
  apiState.throwOnAccess = false;
  useStore.setState({
    problem: undefined,
    session: undefined,
    route: 'home',
    toasts: [],
    logLines: [],
    elapsedMs: 0,
    startedAtMs: 0,
    restoredHazardCount: 0,
    pendingWorkFile: undefined,
    history: { done: [], undone: [] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toWorkFile（§12.3）', () => {
  it('現在の状態を作業ファイルの形にする', () => {
    const before = Date.now();
    const file = toWorkFile('b-001', SESSION, 12_345, 3);
    expect(file.formatVersion).toBe(WORK_FILE_FORMAT_VERSION);
    expect(file.problemId).toBe('b-001');
    expect(file.session).toBe(SESSION);
    expect(file.elapsedMs).toBe(12_345);
    expect(file.hazardCount).toBe(3);
    expect(new Date(file.savedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('toSession（§13 #8: 形が違えば undefined）', () => {
  it('妥当な形ならそのまま返す', () => {
    expect(toSession(SESSION)).toEqual(SESSION);
  });

  it.each([undefined, null, 'x', 42, true])('%s はセッションとして読めない', (raw) => {
    expect(toSession(raw)).toBeUndefined();
  });

  it('wires が配列でなければ読めない', () => {
    expect(toSession({ ...SESSION, wires: 'x' })).toBeUndefined();
  });

  it('socketRoles が無ければ読めない', () => {
    const { socketRoles: _drop, ...rest } = SESSION;
    void _drop;
    expect(toSession(rest)).toBeUndefined();
  });

  it('socketRoles が null なら読めない（null 誤判定の修正）', () => {
    expect(toSession({ ...SESSION, socketRoles: null })).toBeUndefined();
  });
});

/**
 * 1D2-a のレビュー指摘: 以前は上端の形（`wires` が配列・`socketRoles` がオブジェクト）しか
 * 見ていなかったので、要素が壊れた作業ファイルをそのまま盤に載せてしまい、
 * 3Dシーンが描画のたびに `TypeError` を投げて例外バナーからも戻れなくなっていた。
 */
describe('toSession の要素検査（1D2-a）', () => {
  /** 妥当な電線を1本持つセッション（差し替えの土台）。 */
  function withWire(overrides: Record<string, unknown>): unknown {
    return {
      ...SESSION,
      wires: [
        {
          id: 'w-001',
          from: 'CR1.13',
          to: 'CR1.14',
          color: '青',
          locked: false,
          open: false,
          ...overrides,
        },
      ],
    };
  }

  it('土台そのものは読める（検査が厳しすぎないことの確認）', () => {
    expect(toSession(withWire({}))).toBeDefined();
  });

  it('物理ソケットIDの端子（S1.13）も読める（役割ベースへ直して照合する）', () => {
    expect(toSession(withWire({ from: 'S1.13', to: 'S1.14' }))).toBeDefined();
  });

  it.each([
    ['電線が文字列', { wires: ['not-a-wire'] }],
    ['電線が null', { wires: [null] }],
    ['id が無い', { wires: [{ from: 'CR1.13', to: 'CR1.14', color: '青' }] }],
  ])('%s なら読めない', (_label, patch) => {
    expect(toSession({ ...SESSION, ...patch })).toBeUndefined();
  });

  it.each([
    ['from が盤に無い端子', { from: 'NOPE.1' }],
    ['to が盤に無い端子', { to: 'NOPE.1' }],
    ['from が未割当の役割', { from: 'CR9.13' }],
    ['from の形式が壊れている', { from: 'CR1.09' }],
    ['from が数値', { from: 42 }],
    ['色がパレットに無い', { color: '赤' }],
    ['色が数値', { color: 1 }],
    ['id が空文字', { id: '' }],
  ])('%s なら読めない', (_label, patch) => {
    expect(toSession(withWire(patch))).toBeUndefined();
  });

  it('電線が上限を超えたら読めない', () => {
    const wires = Array.from({ length: MAX_RESTORED_WIRES + 1 }, (_, i) => ({
      id: `w-${i}`,
      from: 'CR1.13',
      to: 'CR1.14',
      color: '青',
      locked: false,
      open: false,
    }));
    expect(toSession({ ...SESSION, wires })).toBeUndefined();
  });

  it('装着が読めれば通る', () => {
    expect(toSession({ ...SESSION, mounted: { S1: { kind: 'relay-my4n' } } })).toBeDefined();
    expect(
      toSession({
        ...SESSION,
        mounted: { S5: { kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 } },
      }),
    ).toBeDefined();
  });

  it.each([
    ['カタログに無い部品', { S1: { kind: 'relay-unknown' } }],
    ['盤に無いソケット', { S9: { kind: 'relay-my4n' } }],
    ['装着が文字列', { S1: 'relay' }],
    ['タイマ設定が NaN', { S5: { kind: 'timer-h3y4', presetMs: Number.NaN } }],
    ['タイマ設定が文字列', { S5: { kind: 'timer-h3y4', presetMs: '3000' } }],
  ])('装着が壊れている（%s）なら読めない', (_label, mounted) => {
    expect(toSession({ ...SESSION, mounted })).toBeUndefined();
  });

  it('役割割当が不正なら読めない（CHK が無い）', () => {
    expect(toSession({ ...SESSION, socketRoles: { S1: 'CR1' } })).toBeUndefined();
  });

  it('役割割当に盤の無いソケットIDがあれば読めない', () => {
    expect(
      toSession({ ...SESSION, socketRoles: { ...SESSION.socketRoles, S9: 'CR3' } }),
    ).toBeUndefined();
  });
});

describe('applyWorkFile（§12.3）', () => {
  it('課題が読めなければトーストで知らせて false を返す', async () => {
    apiState.readProblem.mockResolvedValue(null);
    const ok = await applyWorkFile(sampleFile());
    expect(ok).toBe(false);
    expect(useStore.getState().toasts).toHaveLength(1);
    expect(useStore.getState().toasts[0]?.text).toContain('b-001');
    expect(useStore.getState().problem).toBeUndefined();
  });

  it('盤の状態が読めなければトーストで知らせて false を返す', async () => {
    apiState.readProblem.mockResolvedValue(PROBLEM);
    const ok = await applyWorkFile(sampleFile({ session: 'bad' }));
    expect(ok).toBe(false);
    expect(useStore.getState().toasts).toHaveLength(1);
  });

  it('preload が無ければ投げずにトーストで知らせて false を返す', async () => {
    apiState.throwOnAccess = 'プリロードが読み込まれていません';
    const ok = await applyWorkFile(sampleFile());
    expect(ok).toBe(false);
    expect(useStore.getState().toasts[0]?.text).toContain('プリロード');
  });

  it('妥当な作業ファイルなら盤に反映し、Worker にも load を送って true を返す', async () => {
    apiState.readProblem.mockResolvedValue(PROBLEM);
    const file = sampleFile({ elapsedMs: 7777 });
    const ok = await applyWorkFile(file);

    expect(ok).toBe(true);
    expect(useStore.getState().problem?.id).toBe('b-001');
    expect(useStore.getState().route).toBe('session');
    expect(useStore.getState().session?.wires).toEqual(SESSION.wires);

    expect(bridgeMock.sent).toHaveLength(1);
    expect(bridgeMock.sent[0]).toMatchObject({ type: 'load', problemId: 'b-001' });

    expect(useStore.getState().logLines.at(-1)?.text).toContain(file.savedAt);
  });

  /**
   * 1D2-a のレビュー指摘: 復元しても経過時間が 00:00.0 に戻り、危険操作の回数も消えていた。
   * `openProblem()` が時計を今に引き直すので、そのあとで巻き戻す必要がある。
   */
  it('経過時間と危険操作の回数を復元する', async () => {
    apiState.readProblem.mockResolvedValue(PROBLEM);
    const before = Date.now();

    await applyWorkFile(sampleFile({ elapsedMs: 754_000, hazardCount: 3 }));

    const state = useStore.getState();
    expect(state.elapsedMs).toBe(754_000);
    expect(state.restoredHazardCount).toBe(3);
    // 続きから計時されるよう、始点は「いま − 経過時間」になっている
    expect(state.startedAtMs).toBeGreaterThanOrEqual(before - 754_000);
    expect(state.startedAtMs).toBeLessThanOrEqual(Date.now() - 754_000);
  });

  it.each([
    [Number.NaN, -5],
    [Number.POSITIVE_INFINITY, Number.NaN],
    [-1000, -1],
  ])('壊れた数値（%s / %s）は 0 として扱う', async (elapsedMs, hazardCount) => {
    apiState.readProblem.mockResolvedValue(PROBLEM);
    await applyWorkFile(sampleFile({ elapsedMs, hazardCount }));
    expect(useStore.getState().elapsedMs).toBe(0);
    expect(useStore.getState().restoredHazardCount).toBe(0);
  });
});

/**
 * 1D2-a のレビュー指摘: 別の課題の作業ファイルを読むと、いまの盤が確認なしで消えていた。
 * `window.confirm()` は Electron の描画を止めてしまうので、確認はストア経由で外枠に出させる。
 */
describe('別の課題を読むときの確認（§12.3）', () => {
  /** 訓練者が1本配線した状態にする（固定配線は `locked` なので、そうでない1本を足す）。 */
  function workingOn(problemId: string): void {
    if (PROBLEM === undefined) throw new Error('b-001 が見つかりません');
    const session = sessionForProblem(PROBLEM);
    const fixed = session.wires[0];
    if (fixed === undefined) throw new Error('既設配線がありません');
    session.wires.push({ ...fixed, id: wireId('w-001'), locked: false });
    useStore.setState({ problem: { ...PROBLEM, id: problemId }, session });
  }

  it('作業中に別の課題の作業ファイルを読むと、確認するまで適用しない', async () => {
    workingOn('b-001');
    apiState.readProblem.mockResolvedValue(PROBLEM);

    const file = sampleFile({ problemId: 'b-002' });
    expect(needsDiscardConfirm(file)).toBe(true);
    expect(await applyWorkFile(file)).toBe(false);

    expect(useStore.getState().pendingWorkFile).toBe(file);
    expect(useStore.getState().problem?.id).toBe('b-001');
    expect(apiState.readProblem).not.toHaveBeenCalled();
  });

  it('確認済みなら適用する', async () => {
    workingOn('b-001');
    apiState.readProblem.mockResolvedValue(PROBLEM);

    const ok = await applyWorkFile(sampleFile({ problemId: 'b-002' }), { confirmed: true });

    expect(ok).toBe(true);
    expect(useStore.getState().problem?.id).toBe('b-001');
    expect(bridgeMock.sent).toHaveLength(1);
  });

  it('同じ課題の続きなら確認しない', async () => {
    workingOn('b-001');
    apiState.readProblem.mockResolvedValue(PROBLEM);
    expect(needsDiscardConfirm(sampleFile({ problemId: 'b-001' }))).toBe(false);
    expect(await applyWorkFile(sampleFile({ problemId: 'b-001' }))).toBe(true);
  });

  it('まだ何も配線していなければ確認しない', () => {
    if (PROBLEM === undefined) return;
    useStore.setState({ problem: PROBLEM, session: sessionForProblem(PROBLEM) });
    expect(needsDiscardConfirm(sampleFile({ problemId: 'b-002' }))).toBe(false);
  });

  it('課題を開いていなければ確認しない（起動直後の復元）', () => {
    expect(needsDiscardConfirm(sampleFile({ problemId: 'b-002' }))).toBe(false);
  });
});

describe('壊れた盤の状態（1D2-a）', () => {
  it('要素の壊れた作業ファイルは盤に載せず、理由をトーストで出す', async () => {
    apiState.readProblem.mockResolvedValue(PROBLEM);
    const ok = await applyWorkFile(sampleFile({ session: { ...SESSION, wires: ['not-a-wire'] } }));
    expect(ok).toBe(false);
    expect(useStore.getState().toasts[0]?.text).toBe(JA.session.badSession);
    expect(useStore.getState().problem).toBeUndefined();
  });
});
