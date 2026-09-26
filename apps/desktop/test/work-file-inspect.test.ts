// helpers/worker-bridge.js を他の import より前に置く（vi.mock のファクトリから参照するため）。
import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { toTerminalId, wireId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  replacePart,
  type InspectRepairProblem,
} from '@ojt/content';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * モードC1／C2の作業ファイル（Plan 2B Task 17）。設計仕様 §12.3 / §13 #8。
 *
 * `ojtApi()` と Worker ブリッジは差し替える（`work-file.test.ts` と同じ流儀）。
 * 本物の Worker は happy-dom で動かないので、送ったコマンドだけを見る。
 */

const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
const apiState = vi.hoisted((): { readProblem: Mock } => ({ readProblem: vi.fn() }));

vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

vi.mock('../src/renderer/app/ojt-api.js', () => ({
  ojtApi: () => ({ readProblem: apiState.readProblem }),
}));

const { applyWorkFile, restoreInspectState, toInspectWorkFile } =
  await import('../src/renderer/session/work-file.js');
const { useStore } = await import('../src/renderer/app/store.js');
const { JA } = await import('../src/renderer/i18n/ja.js');

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
if (C1 === undefined) throw new Error('内蔵のC1課題がありません');
const FIRST_PART = C1.parts[0];
if (FIRST_PART === undefined) throw new Error('C1課題に部品がありません');

/** 部品不良を含むC2課題（交換の復元を確かめるため、明示 `faults` の課題を選ぶ）。 */
const C2: InspectRepairProblem = ((): InspectRepairProblem => {
  const found = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === 'c2-002');
  if (found === undefined) throw new Error('c2-002 が見つかりません');
  return found;
})();

beforeEach(() => {
  bridgeMock.sent = [];
  apiState.readProblem.mockReset();
  useStore.getState().abandonSession();
  useStore.setState({ toasts: [], logLines: [] });
});

/** いまのストアの状態から作業ファイルを作る（保存できない状態なら失敗させる）。 */
function saved(): Record<string, unknown> {
  const file = toInspectWorkFile();
  expect(file).toBeDefined();
  return file as unknown as Record<string, unknown>;
}

describe('toInspectWorkFile（§12.3）', () => {
  it('C1はテスター状態・解答・点検中の部品を載せる', () => {
    useStore.getState().openProblem(C1);
    useStore.getState().setCheckPart(FIRST_PART.id);
    useStore.getState().setAnswer(FIRST_PART.id, 'coil-open');
    useStore.getState().applyTester({ type: 'set-mode', mode: 'OHM' });

    const file = saved();
    expect(file['formatVersion']).toBe(1);
    expect(file['mode']).toBe('inspect-parts');
    expect(file['checkPartId']).toBe(FIRST_PART.id);
    expect(file['answers']).toEqual([{ partId: FIRST_PART.id, answer: 'coil-open' }]);
    expect((file['tester'] as { mode: string }).mode).toBe('OHM');
  });

  it('C1はプローブの位置（black/red）も載せる（§12.3 のギャップ修正）', () => {
    useStore.getState().openProblem(C1);
    useStore.getState().setCheckPart(FIRST_PART.id);
    useStore.getState().applyTester({ type: 'set-mode', mode: 'CONT' });
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') });
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'red', terminal: toTerminalId('CHK.14') });

    const file = saved();
    expect(file['tester']).toMatchObject({ black: 'CHK.13', red: 'CHK.14' });
  });

  it('プローブを置いていなければ black/red は載らない', () => {
    useStore.getState().openProblem(C1);
    useStore.getState().setCheckPart(FIRST_PART.id);

    const file = saved();
    expect(file['tester']).not.toHaveProperty('black');
    expect(file['tester']).not.toHaveProperty('red');
  });

  it('C2は指摘・故障の種・解決済みの故障・交換した部品を載せる（§5.2 / Plan 2A I-4）', () => {
    useStore.getState().openProblem(C2);
    useStore.getState().addReport({ target: { wireId: 'sw-002' }, kind: 'wire-misrouted' });
    const circuit = useStore.getState().circuit;
    expect(circuit).toBeDefined();
    if (circuit === undefined) return;
    const partFault = circuit.applied.partFaults[0];
    expect(partFault).toBeDefined();
    if (partFault === undefined || !('partId' in partFault.target)) return;
    useStore.getState().setCircuit(replacePart(circuit, partFault.target.partId));

    const file = saved();
    expect(file['mode']).toBe('inspect-repair');
    expect(file['reports']).toHaveLength(1);
    expect(typeof file['faultSeed']).toBe('number');
    expect(Array.isArray(file['resolvedFaults'])).toBe(true);
    expect((file['resolvedFaults'] as unknown[]).length).toBeGreaterThan(0);
    expect(file['replacedPartIds']).toEqual([partFault.target.partId]);
  });

  it('C2は回路図ヒントを開いた回数を載せる（§8.4）', () => {
    useStore.getState().openProblem(C2);
    useStore.getState().toggleSchematic();
    useStore.getState().toggleSchematic();
    useStore.getState().toggleSchematic();
    expect(useStore.getState().schematicOpenCount).toBe(2);

    const file = saved();
    expect(file['schematicOpenCount']).toBe(2);
  });

  it('課題を開いていなければ保存する状態が無い（undefined）', () => {
    expect(toInspectWorkFile()).toBeUndefined();
  });
});

describe('restoreInspectState（§12.3 / §13 #8）', () => {
  it('C1の解答とテスター状態と点検中の部品を戻す', () => {
    const ok = restoreInspectState(C1, {
      mode: 'inspect-parts',
      checkPartId: FIRST_PART.id,
      answers: [{ partId: FIRST_PART.id, answer: 'a-weld' }],
      tester: { kind: 'analog', mode: 'CONT', voltRange: 50, ohmRange: 10, zeroAdjusted: true },
    });
    expect(ok).toBe(true);
    const state = useStore.getState();
    expect(state.answers).toEqual([{ partId: FIRST_PART.id, answer: 'a-weld' }]);
    expect(state.tester.mode).toBe('CONT');
    expect(state.tester.kind).toBe('analog');
    expect(state.tester.zeroAdjusted).toBe(true);
    expect(state.checkPartId).toBe(FIRST_PART.id);
  });

  it('C1のプローブ位置（black/red）もストアへ戻す（§12.3 のギャップ修正）', () => {
    const ok = restoreInspectState(C1, {
      mode: 'inspect-parts',
      checkPartId: FIRST_PART.id,
      tester: {
        kind: 'digital',
        mode: 'CONT',
        voltRange: 50,
        ohmRange: 10,
        zeroAdjusted: false,
        black: 'CHK.13',
        red: 'CHK.14',
      },
    });
    expect(ok).toBe(true);
    const state = useStore.getState();
    expect(state.tester.black).toBe('CHK.13');
    expect(state.tester.red).toBe('CHK.14');
  });

  it('C2は保存した解決済みの故障で同じ盤を組み直す（§5.2 / Plan 2A I-4）', () => {
    useStore.getState().openProblem(C2);
    const before = useStore.getState().circuit;
    const faults = useStore.getState().resolvedFaults;
    expect(before).toBeDefined();
    expect(faults).toBeDefined();
    if (before === undefined || faults === undefined) return;

    useStore.getState().abandonSession();
    const ok = restoreInspectState(C2, {
      mode: 'inspect-repair',
      reports: [{ target: { wireId: 'sw-002' }, kind: 'wire-misrouted' }],
      resolvedFaults: faults,
      faultSeed: 12_345,
    });

    expect(ok).toBe(true);
    const state = useStore.getState();
    expect(state.reports).toHaveLength(1);
    expect(state.faultSeed).toBe(12_345);
    expect(state.circuit?.applied.sites).toEqual(before.applied.sites);
  });

  it('C2は部品不良の内容つきの指摘も戻し、知らない内容の指摘は読まない（2026-09-26）', () => {
    useStore.getState().openProblem(C2);
    const faults = useStore.getState().resolvedFaults;
    if (faults === undefined) return;
    useStore.getState().abandonSession();
    const ok = restoreInspectState(C2, {
      mode: 'inspect-repair',
      reports: [
        { target: { partId: 'CR1' }, kind: 'part-defect', detail: 'coil-open' },
        { target: { partId: 'CR2' }, kind: 'part-defect', detail: 'no-such-detail' },
        { target: { partId: 'CR3' }, kind: 'part-defect' },
      ],
      resolvedFaults: faults,
      faultSeed: 1,
    });
    expect(ok).toBe(true);
    expect(useStore.getState().reports).toEqual([
      { target: { partId: 'CR1' }, kind: 'part-defect', detail: 'coil-open' },
      { target: { partId: 'CR3' }, kind: 'part-defect' },
    ]);
  });

  it('C2は交換した部品の故障を落として戻す（§9.2）', () => {
    useStore.getState().openProblem(C2);
    const faults = useStore.getState().resolvedFaults;
    const partFault = useStore.getState().circuit?.applied.partFaults[0];
    expect(partFault).toBeDefined();
    if (faults === undefined || partFault === undefined || !('partId' in partFault.target)) return;

    const ok = restoreInspectState(C2, {
      mode: 'inspect-repair',
      resolvedFaults: faults,
      replacedPartIds: [partFault.target.partId],
    });

    expect(ok).toBe(true);
    expect(useStore.getState().circuit?.applied.partFaults).toHaveLength(0);
    // 指摘すべき故障（`sites`）は交換しても残る（Plan 2A 意図的な差分 #7）
    expect(useStore.getState().circuit?.applied.sites.length).toBeGreaterThan(0);
  });

  it('C2は回路図ヒントを開いた回数を戻す（§8.4）', () => {
    useStore.getState().openProblem(C2);
    const faults = useStore.getState().resolvedFaults;
    expect(faults).toBeDefined();
    if (faults === undefined) return;

    const ok = restoreInspectState(C2, {
      mode: 'inspect-repair',
      resolvedFaults: faults,
      schematicOpenCount: 4,
    });
    expect(ok).toBe(true);
    expect(useStore.getState().schematicOpenCount).toBe(4);
  });

  it('C2で故障が欠けていたら復元しない（§13 #8）', () => {
    expect(restoreInspectState(C2, { mode: 'inspect-repair', reports: [] })).toBe(false);
  });

  /**
   * Plan 2B レビュー M2: 利用者が作った課題は `faults: []`（故障なし）のC2があり得るので、
   * `resolvedFaults` が空配列でも「欠けている」（`undefined` や配列でない）ことにはならない。
   * 以前は空配列も `undefined` と同じ扱いで復元を断っていた。
   */
  it('C2は resolvedFaults が空配列でも復元する（利用者課題の faults: [] に対応。M2）', () => {
    const ok = restoreInspectState(C2, { mode: 'inspect-repair', resolvedFaults: [] });
    expect(ok).toBe(true);
    expect(useStore.getState().circuit?.applied.partFaults).toEqual([]);
    expect(useStore.getState().circuit?.applied.sites).toEqual([]);
  });

  it('壊れた故障の並びでも落ちずに復元を断る（§13 #8）', () => {
    expect(
      restoreInspectState(C2, {
        mode: 'inspect-repair',
        resolvedFaults: [{ target: { nope: 1 } }, 'x'],
      }),
    ).toBe(false);
  });

  it('モードが課題と食い違っていたら復元しない', () => {
    expect(restoreInspectState(C1, { mode: 'inspect-repair', reports: [] })).toBe(false);
  });

  it('何も無ければ（Phase 1 の作業ファイル）そのまま受け入れる', () => {
    expect(restoreInspectState(C1, {})).toBe(true);
    expect(useStore.getState().problem?.id).toBe(C1.id);
  });

  it('壊れた解答・指摘・テスターは読み飛ばして落ちない（§13 #8）', () => {
    const ok = restoreInspectState(C1, {
      mode: 'inspect-parts',
      tester: { kind: 'plasma', mode: 'XYZ' },
      answers: [
        { partId: 'nope', answer: 'coil-open' },
        { partId: FIRST_PART.id, answer: '壊れた値' },
        'x',
      ],
      checkPartId: 'nope',
    });
    expect(ok).toBe(true);
    const state = useStore.getState();
    expect(state.answers).toEqual([]);
    expect(state.checkPartId).toBeUndefined();
    expect(state.tester.mode).toBe('off');
  });

  /**
   * Plan 2B レビュー M5: 壊れたつまみは既定のまま開く（読込そのものは断らない）が、
   * 黙って戻さないと「保存したときのテスター状態のまま」と訓練者が誤解する。
   */
  it('壊れたテスターの塊はトーストで知らせる（読込そのものは断らない。M5）', () => {
    const ok = restoreInspectState(C1, {
      mode: 'inspect-parts',
      tester: { kind: 'plasma', mode: 'XYZ' },
    });
    expect(ok).toBe(true);
    expect(useStore.getState().toasts.at(-1)?.text).toBe(JA.session.badTesterBlock);
  });

  it('テスターの塊自体が無ければトーストを出さない', () => {
    const ok = restoreInspectState(C1, { mode: 'inspect-parts' });
    expect(ok).toBe(true);
    expect(useStore.getState().toasts).toHaveLength(0);
  });
});

describe('applyWorkFile（C1/C2。§12.3）', () => {
  it('C1はチェック用回路を組み直して load し、そのあとテスターを送り直す', async () => {
    useStore.getState().openProblem(C1);
    useStore.getState().setCheckPart(FIRST_PART.id);
    useStore.getState().applyTester({ type: 'set-mode', mode: 'OHM' });
    const file = saved();
    useStore.getState().abandonSession();
    bridgeMock.sent = [];
    apiState.readProblem.mockResolvedValue(C1);

    expect(await applyWorkFile(file as never)).toBe(true);
    expect(useStore.getState().checkPartId).toBe(FIRST_PART.id);
    expect(useStore.getState().tester.mode).toBe('OHM');

    const load = bridgeMock.sent.findIndex((c) => c['type'] === 'load');
    expect(load).toBe(0);
    // 点検中の部品の故障を載せて読ませる（§5.4。故障はネットリスト変換のたびに入れ直す）
    expect(Array.isArray(bridgeMock.sent[0]?.['partFaults'])).toBe(true);
    // `load` はWorker側のつまみを既定へ戻すので、そのあとに送り直す（Task 3 / I-3）
    const testerCommands = bridgeMock.sent.filter((c) => c['type'] === 'tester');
    expect(testerCommands).toHaveLength(4);
    expect(bridgeMock.sent.indexOf(testerCommands[0] as Record<string, unknown>)).toBeGreaterThan(
      load,
    );
  });

  /**
   * Plan 2B レビュー B1: `set-kind` / `set-mode` / `set-volt-range` / `set-ohm-range` は
   * どれも `applyTesterAction()` で `zeroAdjusted` を落とすので、保存時に 0Ω調整済みだった
   * 場合はこの4本を送り直すだけでは Worker 側が「未調整」に戻ってしまう（650.0 → 682.5 Ω）。
   * `zero-adjust` を最後に送り直して校正を復元する。
   */
  it('0Ω調整済みで保存した C1 は、つまみの再送の最後に zero-adjust を送り直す', async () => {
    useStore.getState().openProblem(C1);
    useStore.getState().applyTester({ type: 'set-kind', kind: 'analog' });
    useStore.getState().applyTester({ type: 'set-mode', mode: 'OHM' });
    useStore.getState().applyTester({ type: 'set-ohm-range', range: 10 });
    useStore.getState().applyTester({ type: 'zero-adjust' });
    expect(useStore.getState().tester.zeroAdjusted).toBe(true);

    const file = saved();
    useStore.getState().abandonSession();
    bridgeMock.sent = [];
    apiState.readProblem.mockResolvedValue(C1);

    expect(await applyWorkFile(file as never)).toBe(true);
    expect(useStore.getState().tester.zeroAdjusted).toBe(true);

    const testerActions = bridgeMock.sent
      .filter((c) => c['type'] === 'tester')
      .map((c) => (c['action'] as Record<string, unknown>)['type']);
    expect(testerActions).toEqual([
      'set-kind',
      'set-mode',
      'set-volt-range',
      'set-ohm-range',
      'zero-adjust',
    ]);
  });

  /**
   * §12.3 のギャップ修正: 復元直後は探針を挿し直すまで読み値が `----` のままだった。
   * つまみ・レンジ・0Ω調整の再送（`replayTesterToWorker()`）の**あとに** `place-probe` を
   * 送ることを確かめ、ストア側の `tester.black/red` も戻っていることを確かめる。
   */
  it('C1は保存したプローブ位置をストアへ戻し、Workerへはつまみの再送の最後に送る（§12.3）', async () => {
    useStore.getState().openProblem(C1);
    useStore.getState().setCheckPart(FIRST_PART.id);
    useStore.getState().applyTester({ type: 'set-mode', mode: 'CONT' });
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') });
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'red', terminal: toTerminalId('CHK.14') });
    const file = saved();
    useStore.getState().abandonSession();
    bridgeMock.sent = [];
    apiState.readProblem.mockResolvedValue(C1);

    expect(await applyWorkFile(file as never)).toBe(true);

    // ストア側にも戻っている（3Dのプローブ表示・追加操作が続けられる）
    const state = useStore.getState();
    expect(state.tester.black).toBe('CHK.13');
    expect(state.tester.red).toBe('CHK.14');

    // Worker へは「つまみ（4本）→ place-probe（黒→赤）」の順で送る
    const testerActions = bridgeMock.sent
      .filter((c) => c['type'] === 'tester')
      .map((c) => c['action'] as Record<string, unknown>);
    expect(testerActions.map((a) => a['type'])).toEqual([
      'set-kind',
      'set-mode',
      'set-volt-range',
      'set-ohm-range',
      'place-probe',
      'place-probe',
    ]);
    expect(testerActions.at(-2)).toMatchObject({ probe: 'black', terminal: 'CHK.13' });
    expect(testerActions.at(-1)).toMatchObject({ probe: 'red', terminal: 'CHK.14' });
  });

  it('プローブを置かずに保存した C1 は place-probe を送り直さない', async () => {
    useStore.getState().openProblem(C1);
    useStore.getState().setCheckPart(FIRST_PART.id);
    useStore.getState().applyTester({ type: 'set-mode', mode: 'CONT' });
    const file = saved();
    useStore.getState().abandonSession();
    bridgeMock.sent = [];
    apiState.readProblem.mockResolvedValue(C1);

    expect(await applyWorkFile(file as never)).toBe(true);
    expect(useStore.getState().tester.black).toBeUndefined();
    expect(useStore.getState().tester.red).toBeUndefined();
    const testerActions = bridgeMock.sent
      .filter((c) => c['type'] === 'tester')
      .map((c) => (c['action'] as Record<string, unknown>)['type']);
    expect(testerActions).not.toContain('place-probe');
  });

  it('C2は白線と指摘と交換を戻し、故障入りの盤を load する', async () => {
    useStore.getState().openProblem(C2);
    const circuit = useStore.getState().circuit;
    const session = useStore.getState().session;
    expect(circuit).toBeDefined();
    if (circuit === undefined || session === undefined) return;
    const first = session.wires[0];
    if (first === undefined) return;
    // 訓練者が張った白線（修復）を1本足す
    useStore.getState().setSession({
      ...session,
      wires: [...session.wires, { ...first, id: wireId('w-white-1'), color: '白', locked: false }],
    });
    useStore.getState().addReport({ target: { wireId: 'sw-002' }, kind: 'wire-misrouted' });
    const partFault = circuit.applied.partFaults[0];
    if (partFault === undefined || !('partId' in partFault.target)) return;
    const withCurrentBoard = useStore.getState().circuit;
    if (withCurrentBoard === undefined) return;
    useStore.getState().setCircuit(replacePart(withCurrentBoard, partFault.target.partId));

    const file = saved();
    useStore.getState().abandonSession();
    bridgeMock.sent = [];
    apiState.readProblem.mockResolvedValue(C2);

    expect(await applyWorkFile(file as never)).toBe(true);
    const state = useStore.getState();
    expect(state.session?.wires.some((w) => w.id === 'w-white-1')).toBe(true);
    expect(state.reports).toHaveLength(1);
    expect(state.circuit?.applied.partFaults).toHaveLength(0);
    expect(state.circuit?.applied.sites).toEqual(circuit.applied.sites);
    // 画面が張り直したときに同じ盤を読ませるため、回路の盤も復元後のものにしておく
    expect(state.circuit?.session.wires.some((w) => w.id === 'w-white-1')).toBe(true);
    const load = bridgeMock.sent.find((c) => c['type'] === 'load');
    expect(load).toBeDefined();
    expect(load?.['partFaults']).toEqual([]);
  });

  it('C2は保存・読込の往復で回路図ヒントを開いた回数を保つ（§8.4）', async () => {
    useStore.getState().openProblem(C2);
    useStore.getState().toggleSchematic();
    useStore.getState().toggleSchematic();
    useStore.getState().toggleSchematic();
    expect(useStore.getState().schematicOpenCount).toBe(2);

    const file = saved();
    useStore.getState().abandonSession();
    bridgeMock.sent = [];
    apiState.readProblem.mockResolvedValue(C2);

    expect(await applyWorkFile(file as never)).toBe(true);
    expect(useStore.getState().schematicOpenCount).toBe(2);
  });

  it('課題とモードが食い違う作業ファイルは日本語の理由を出して断る（§13 #8）', async () => {
    useStore.getState().openProblem(C1);
    const session = useStore.getState().session;
    useStore.getState().abandonSession();
    apiState.readProblem.mockResolvedValue(C1);
    const ok = await applyWorkFile({
      formatVersion: 1,
      problemId: C1.id,
      session,
      elapsedMs: 0,
      hazardCount: 0,
      savedAt: '2026-09-14T00:00:00.000Z',
      mode: 'inspect-repair',
    } as never);
    expect(ok).toBe(false);
    expect(useStore.getState().toasts.at(-1)?.text).toBe(JA.session.badWorkFileMode);
  });
});
