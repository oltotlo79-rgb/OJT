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

const bridgeMock = vi.hoisted(() => ({ sent: [] as unknown[] }));
const apiState = vi.hoisted((): ApiState => ({
  readProblem: vi.fn(),
  throwOnAccess: false,
}));

vi.mock('../src/renderer/session/worker-bridge.js', () => ({
  bridge: {
    send: (command: unknown) => {
      bridgeMock.sent.push(command);
    },
    start: () => {},
    stop: () => {},
    running: false,
  },
}));

vi.mock('../src/renderer/app/ojt-api.js', () => ({
  ojtApi: () => {
    if (apiState.throwOnAccess !== false) throw new Error(apiState.throwOnAccess);
    return { readProblem: apiState.readProblem };
  },
}));

const { toWorkFile, toSession, applyWorkFile } =
  await import('../src/renderer/session/work-file.js');
const { useStore, sessionForProblem } = await import('../src/renderer/app/store.js');
const { WORK_FILE_FORMAT_VERSION } = await import('../src/shared/ipc.js');

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
});
