import { BUILTIN_PLC_PROBLEMS, isPlcProblem } from '@ojt/content';
import { COIL_COL, IR_COLS, no, out, X, Y } from '@ojt/ladder-core';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { applyLadderCell } from '../src/renderer/session/ladder.js';
import {
  applyWorkFile,
  needsDiscardConfirm,
  restoreInspectState,
  toLadderProgram,
  toWorkFile,
} from '../src/renderer/session/work-file.js';

/**
 * `applyWorkFile()` の往復テスト（I6b）だけ、`ojtApi()` と Worker ブリッジを差し替える
 * （`work-file.test.ts` と同じ流儀）。`restoreInspectState()` だけを呼ぶテストには要らない。
 */
const bridgeMock = vi.hoisted(() => ({ sent: [] as unknown[] }));
const apiState = vi.hoisted((): { readProblem: Mock } => ({ readProblem: vi.fn() }));

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
  ojtApi: () => ({ readProblem: apiState.readProblem }),
}));

const problem = BUILTIN_PLC_PROBLEMS[0]!;

beforeEach(() => {
  bridgeMock.sent.length = 0;
  apiState.readProblem.mockReset();
  useStore.getState().abandonSession();
  // I5のテストが `dialectId` を書き換えるので、他のテスト/他ファイルへ漏らさないよう戻す
  // （既定メーカーも設定なので `abandonSession()` では戻らない）
  useStore.setState({ dialectId: 'mitsubishi', defaultVendor: 'mitsubishi' });
  useStore.getState().openProblem(problem);
});

describe('モードDの作業ファイル（§12.3 / 3A H-3）', () => {
  it('carries the ladder, the comments, the dialect and the converted flag', () => {
    const store = useStore.getState();
    const edited = applyLadderCell(store.ladder!, { networkId: 'n1', row: 0, col: 0 }, no(X(0)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    store.setDeviceComment('X0', '運転押ボタン');
    store.setConverted(true, { errors: [], warnings: [], usage: undefined, unused: undefined });
    const file = toWorkFile(problem.id, useStore.getState().session!, 1000, 0);
    expect(file.mode).toBe('plc');
    expect(file.dialectId).toBe('mitsubishi');
    expect(file.converted).toBe(true);
    const ladder = file.ladder as { networks: unknown[]; comments: Record<string, string> };
    expect(ladder.networks).toHaveLength(2);
    expect(ladder.comments['X0']).toBe('運転押ボタン');
  });

  /*
   * Batch 4+5 レビュー M14: `ladder` が無いときは `networks: []` を書かず、キーごと省く。
   * `networks: []` は `toLadderProgram()` が「壊れている」として拒むため、
   * 前の書き方だとそのファイルは二度と読み込めなかった。
   */
  it('omits the ladder key entirely instead of writing an empty (unloadable) one (M14)', () => {
    useStore.setState({ ladder: undefined });
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);
    expect(file.mode).toBe('plc');
    expect('ladder' in file).toBe(false);
  });

  it('round-trips through toLadderProgram', () => {
    const store = useStore.getState();
    const edited = applyLadderCell(
      store.ladder!,
      { networkId: 'n1', row: 0, col: COIL_COL },
      out(Y(0)),
    );
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);
    const parsed = toLadderProgram(file.ladder);
    expect(parsed?.program.networks).toHaveLength(2);
    expect(parsed?.program.networks[0]?.cols).toBe(IR_COLS);
  });

  it('refuses a ladder that is not shaped like the IR', () => {
    expect(toLadderProgram(undefined)).toBeUndefined();
    expect(toLadderProgram({ networks: 'x' })).toBeUndefined();
    expect(toLadderProgram({ networks: [] })).toBeUndefined();
    expect(
      toLadderProgram({ networks: [{ id: '', rows: 1, cols: 16, cells: [[]] }] }),
    ).toBeUndefined();
    expect(
      toLadderProgram({
        networks: [{ id: 'n1', rows: 1, cols: 16, cells: [[{ kind: 'quantum' }]] }],
      }),
    ).toBeUndefined();
    // 行数・列数・本数の上限
    const wide = {
      id: 'n1',
      rows: 1,
      cols: 16,
      cells: [Array.from({ length: 17 }, () => ({ kind: 'empty' }))],
    };
    expect(toLadderProgram({ networks: [wide] })).toBeUndefined();
    expect(
      toLadderProgram({
        networks: Array.from({ length: 65 }, (_u, i) => ({
          id: `n${String(i)}`,
          rows: 1,
          cols: 16,
          cells: [[{ kind: 'empty' }]],
        })),
      }),
    ).toBeUndefined();
  });

  it('refuses comments that break the caps (§10.7)', () => {
    const net = { id: 'n1', rows: 1, cols: 16, cells: [[{ kind: 'empty' }]] };
    expect(toLadderProgram({ networks: [net], comments: { X0: 'あ'.repeat(33) } })).toBeUndefined();
    expect(toLadderProgram({ networks: [net], comments: { 三: 'あ' } })).toBeUndefined();
    const many: Record<string, string> = {};
    for (let i = 0; i < 201; i += 1) many[`M${String(i)}`] = 'x';
    expect(toLadderProgram({ networks: [net], comments: many })).toBeUndefined();
  });

  it('restores a saved ladder with an empty history and an unconverted flag', () => {
    const store = useStore.getState();
    const edited = applyLadderCell(store.ladder!, { networkId: 'n1', row: 0, col: 0 }, no(X(1)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    store.setConverted(true, { errors: [], warnings: [], usage: undefined, unused: undefined });
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);

    useStore.getState().abandonSession();
    useStore.getState().openProblem(problem);
    const parsed = toLadderProgram(file.ladder);
    expect(parsed).toBeDefined();
    if (parsed === undefined) return;
    useStore.getState().restoreLadder(parsed.program, parsed.comments);
    const state = useStore.getState();
    expect(state.ladder?.networks[0]?.cells[0]?.[0]).toMatchObject({ kind: 'contact' });
    expect(state.ladderHistory.done).toEqual([]);
    expect(state.converted).toBe(false);
  });
});

/**
 * Batch 4+5 レビュー B2: `needsDiscardConfirm()` は前は盤（`session.wires` / `history.done`）
 * しか見ておらず、盤に何も配線していなくてもラダーを組んでいれば作業ファイルの読込で
 * 黙って捨てていた。
 */
describe('needsDiscardConfirm（モードD。§12.3 / Batch 4+5 レビュー B2）', () => {
  it('asks before discarding when the ladder has history, even with an empty board', () => {
    const store = useStore.getState();
    const edited = applyLadderCell(store.ladder!, { networkId: 'n1', row: 0, col: 0 }, no(X(4)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    expect(useStore.getState().ladderHistory.done.length).toBeGreaterThan(0);
    // 盤には初期配線（ロック済み）しかない＝訓練者はまだ何も配線していない
    expect(useStore.getState().session?.wires.some((w) => !w.locked)).toBe(false);
    expect(
      needsDiscardConfirm({
        formatVersion: 1,
        problemId: 'unrelated-problem-id',
        session: useStore.getState().session!,
        elapsedMs: 0,
        hazardCount: 0,
        savedAt: '2026-09-19T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('asks before discarding when the ladder has real content but no undo history yet', () => {
    // `restoreLadder()` の直後のように、履歴は空だが中身はある状態を作る
    const store = useStore.getState();
    const edited = applyLadderCell(store.ladder!, { networkId: 'n1', row: 0, col: 0 }, no(X(4)));
    if (!edited.ok) throw new Error(edited.message);
    useStore.getState().restoreLadder(edited.program, {});
    expect(useStore.getState().ladderHistory.done).toEqual([]);
    expect(
      needsDiscardConfirm({
        formatVersion: 1,
        problemId: 'unrelated-problem-id',
        session: useStore.getState().session!,
        elapsedMs: 0,
        hazardCount: 0,
        savedAt: '2026-09-19T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('does not ask when the ladder is still the empty starting one', () => {
    expect(
      needsDiscardConfirm({
        formatVersion: 1,
        problemId: 'unrelated-problem-id',
        session: useStore.getState().session!,
        elapsedMs: 0,
        hazardCount: 0,
        savedAt: '2026-09-19T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});

/** Batch 4+5 レビュー I6a: `restoreInspectState()` のモードD分岐だけを見る。 */
describe('restoreInspectState（モードD分岐。§13 #8 / Batch 4+5 レビュー I6a）', () => {
  it('refuses a work file whose ladder is not shaped like the IR, and does not open the problem', () => {
    useStore.getState().abandonSession();
    const ok = restoreInspectState(problem, { mode: 'plc', ladder: { networks: 'not-an-array' } });
    expect(ok).toBe(false);
    // 開かずに断る: `problem` は `undefined` のまま（§13 #8「黙って壊れた状態で開かない」）
    expect(useStore.getState().problem).toBeUndefined();
  });

  it('opens the problem and restores the ladder + comments for a valid work file', () => {
    const store = useStore.getState();
    const edited = applyLadderCell(store.ladder!, { networkId: 'n1', row: 0, col: 0 }, no(X(2)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    store.setDeviceComment('X2', '起動ボタン');
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);

    useStore.getState().abandonSession();
    const ok = restoreInspectState(problem, file);
    expect(ok).toBe(true);
    const state = useStore.getState();
    expect(state.problem?.id).toBe(problem.id);
    expect(state.ladder?.networks[0]?.cells[0]?.[0]).toMatchObject({ kind: 'contact' });
    expect(state.ladderComments['X2']).toBe('起動ボタン');
  });

  /** Batch 4+5 レビュー I5: `dialectId` は保存するだけで読み戻していなかった。 */
  it('restores a valid, implemented dialect id from the work file (I5)', () => {
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);
    expect(file.dialectId).toBe('mitsubishi');

    useStore.getState().abandonSession();
    // わざと別の方言にしておく（`openProblem()` は `dialectId` に触れない）
    useStore.setState({ dialectId: 'jtekt' });
    const ok = restoreInspectState(problem, file);
    expect(ok).toBe(true);
    expect(useStore.getState().dialectId).toBe('mitsubishi');
  });

  it('ignores an unknown dialect id and keeps the current one (I5)', () => {
    useStore.getState().abandonSession();
    useStore.setState({ dialectId: 'mitsubishi' });
    // スキーマの形（string）はしていても方言IDとして見覚えの無い文字列は黙って無視する
    // （読込そのものは断らない）
    expect(restoreInspectState(problem, { mode: 'plc', dialectId: 'not-a-real-dialect' })).toBe(
      true,
    );
    expect(useStore.getState().dialectId).toBe('mitsubishi');
  });

  /**
   * Plan 4A Task 5（81c701a）で4方言すべてが `IMPLEMENTED_DIALECT_IDS` に登録された
   * （以前は `jtekt` は未実装として弾かれ、現在の方言のまま保たれていた）。
   */
  it('restores a valid, implemented, non-Mitsubishi dialect id (I5)', () => {
    useStore.getState().abandonSession();
    useStore.setState({ dialectId: 'mitsubishi' });
    expect(restoreInspectState(problem, { mode: 'plc', dialectId: 'jtekt' })).toBe(true);
    expect(useStore.getState().dialectId).toBe('jtekt');
  });
});

/** Batch 4+5 レビュー I6b: `loadPayloadFor()` は非公開なので `applyWorkFile()` 経由で見る。 */
describe('applyWorkFile（モードDの往復。§12.3 / Batch 4+5 レビュー I6b）', () => {
  it('sends plcModel with the worker load command and preserves the ladder round-trip', async () => {
    apiState.readProblem.mockResolvedValue(problem);
    const store = useStore.getState();
    const edited = applyLadderCell(store.ladder!, { networkId: 'n1', row: 0, col: 0 }, no(X(3)));
    if (!edited.ok) throw new Error(edited.message);
    store.setLadder(edited.program);
    const file = toWorkFile(problem.id, useStore.getState().session!, 500, 0);

    useStore.getState().abandonSession();
    const ok = await applyWorkFile(file);
    expect(ok).toBe(true);

    const loadCommand = bridgeMock.sent.find((c) => (c as { type: string }).type === 'load');
    expect(loadCommand).toMatchObject({
      type: 'load',
      problemId: problem.id,
      plcModel: problem.plc.model,
    });
    expect(useStore.getState().ladder?.networks[0]?.cells[0]?.[0]).toMatchObject({
      kind: 'contact',
    });
  });
});

describe('4方言の作業ファイル往復（§12.3 / 4A H-2）', () => {
  it.each(['mitsubishi', 'jtekt', 'omron', 'sharp'] as const)(
    'round-trips the dialect id %s',
    async (vendor) => {
      useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor });
      useStore.getState().openProblem(problem);
      const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);
      expect(file.dialectId).toBe(vendor);
      useStore.getState().abandonSession();
      // 既定メーカーが違っていても、保存された方言で戻る（決定表#24）
      useStore
        .getState()
        .applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'mitsubishi' });
      apiState.readProblem.mockResolvedValue(problem);
      expect(await applyWorkFile(file)).toBe(true);
      expect(useStore.getState().dialectId).toBe(vendor);
      // 機種も戻る（作業ファイルには課題IDしか無いので、方言 → 機種の規則で引き直す）
      const opened = useStore.getState().problem;
      expect(opened !== undefined && isPlcProblem(opened) ? opened.plc.vendor : undefined).toBe(
        vendor,
      );
    },
  );

  it('keeps the restored dialect when an unrelated setting is saved afterwards (前提#31b)', async () => {
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'sharp' });
    useStore.getState().openProblem(problem);
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);
    useStore.getState().abandonSession();
    apiState.readProblem.mockResolvedValue(problem);
    expect(await applyWorkFile(file)).toBe(true);
    // セッションの途中で既定メーカーを変えても、いまの方言は動かない
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    expect(useStore.getState().dialectId).toBe('sharp');
    expect(useStore.getState().defaultVendor).toBe('omron');
  });
});

/**
 * レビュー指摘 #3: `dialectId` が無い（または未実装の値の）作業ファイルは、既定メーカーへ
 * 逃げてはいけない。既定メーカーへ逃げると、保存後に利用者が設定を変えただけで機種が
 * すり替わり、保存されていた電線が新しい機種に無い端子名を参照して失われる
 * （`safeRoutes()` が黙って落とす）。フォールバック先は「この課題が保存された機種」
 * （`problem.plc.vendor`）でなければならない。
 */
describe('復元時の機種フォールバック（§7.6 / 決定表#9・#24 / レビュー指摘 #3）', () => {
  it('falls back to the problem’s own vendor, not the current default, when dialectId is missing', async () => {
    useStore
      .getState()
      .applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'mitsubishi' });
    useStore.getState().openProblem(problem);
    const file = toWorkFile(problem.id, useStore.getState().session!, 0, 0);
    const { dialectId: _drop, ...withoutDialect } = file;
    void _drop;
    useStore.getState().abandonSession();
    // バグの再現条件: 既定メーカーを課題の機種と別のメーカーへ変えておく
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    apiState.readProblem.mockResolvedValue(problem);
    expect(await applyWorkFile(withoutDialect)).toBe(true);
    // 既定メーカー（オムロン）ではなく、保存されていた課題自身の機種（三菱 FX5U）で開く
    expect(useStore.getState().dialectId).toBe('mitsubishi');
    const opened = useStore.getState().problem;
    expect(opened !== undefined && isPlcProblem(opened) ? opened.plc : undefined).toEqual({
      vendor: 'mitsubishi',
      model: 'FX5U',
    });
    // 設定（既定メーカー）そのものは変わっていない
    expect(useStore.getState().defaultVendor).toBe('omron');
  });

  it('also falls back to the problem’s own vendor when the saved dialectId is an unimplemented one', async () => {
    useStore
      .getState()
      .applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'mitsubishi' });
    useStore.getState().openProblem(problem);
    const file = {
      ...toWorkFile(problem.id, useStore.getState().session!, 0, 0),
      dialectId: 'not-a-real-dialect',
    };
    useStore.getState().abandonSession();
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'jtekt' });
    apiState.readProblem.mockResolvedValue(problem);
    expect(await applyWorkFile(file)).toBe(true);
    expect(useStore.getState().dialectId).toBe('mitsubishi');
    const opened = useStore.getState().problem;
    expect(opened !== undefined && isPlcProblem(opened) ? opened.plc.model : undefined).toBe(
      'FX5U',
    );
    expect(useStore.getState().defaultVendor).toBe('jtekt');
  });

  /**
   * レビュー指摘 #11: 既定メーカーでは収まらない課題（決定表#10）でも、保存・復元が壊れない。
   * `openProblem()` 自身の「収まらなければ元の機種のまま開く」フォールバックと、
   * このファイルのフォールバックの両方を通した往復になる。
   */
  it('round-trips a work file for a problem only its own vendor can host, even when the default vendor cannot host it', async () => {
    const unhostable = {
      ...problem,
      io: {
        ...problem.io,
        mode: 'fixed' as const,
        inputs: [{ x: 0, pb: 'PB1' as const }],
        outputs: [{ y: 12, cr: 'CR1' as const, pl: 'PL1' as const }],
      },
    };
    useStore
      .getState()
      .applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'mitsubishi' });
    useStore.getState().openProblem(unhostable);
    const file = toWorkFile(unhostable.id, useStore.getState().session!, 0, 0);
    const savedWireCount = useStore.getState().session!.wires.length;

    useStore.getState().abandonSession();
    // 既定メーカーを、この課題を収められないメーカーへ変えておく
    useStore.getState().applyLadderSettings({ gridCols: 0, monitorColor: '', vendor: 'omron' });
    apiState.readProblem.mockResolvedValue(unhostable);
    expect(await applyWorkFile(file)).toBe(true);

    const opened = useStore.getState().problem;
    expect(opened !== undefined && isPlcProblem(opened) ? opened.plc.model : undefined).toBe(
      'FX5U',
    );
    expect(useStore.getState().dialectId).toBe('mitsubishi');
    // 保存されていた電線の本数がそのまま戻る（端子名の食い違いで失われていない）
    expect(useStore.getState().session?.wires).toHaveLength(savedWireCount);
  });
});
