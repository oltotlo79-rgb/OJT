import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { addWire, createSession, JIPM_BOARD, removeWire } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  resolvePlcIo,
  buildPlcReferenceSession,
  judgePlc,
} from '@ojt/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore, EMPTY_SNAPSHOT, useStore } from '../src/renderer/app/store.js';
import { reconnectWire, commitWireEdit } from '../src/renderer/session/wire-edit.js';
import { planPlcAssignment } from '../src/renderer/session/plc-assignment.js';
import { boardForProblem } from '../src/renderer/session/plc-session.js';
import { undo, redo } from '../src/renderer/session/commands.js';
import { flushAutosave, startAutosave } from '../src/renderer/session/autosave.js';

const bridgeState = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
const api = vi.hoisted(() => ({ saveWorkFile: vi.fn(), onCloseRequest: vi.fn() }));
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeState));
vi.mock('../src/renderer/app/ojt-api.js', () => ({ ojtApi: () => api, tryOjtApi: () => api }));

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ defaultVendor: 'mitsubishi' });
  bridgeState.sent = [];
  api.saveWorkFile.mockReset();
  api.onCloseRequest.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('配線の候補編集と自由割付', () => {
  it('自由割付の入力・出力・シンクからソースへの変更後も、合わせたラダーで合格する', () => {
    const original = BUILTIN_PLC_PROBLEMS[0]!;
    const problem = { ...original, io: { ...original.io, mode: 'free' as const } };
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const previous = resolvePlcIo(problem.io);
    const next = {
      ...previous,
      mode: 'free' as const,
      wiring: 'source' as const,
      inputs: previous.inputs.map((input) => ({ ...input, x: input.x + 4 })),
      outputs: previous.outputs.map((output) => ({ ...output, y: output.y + 4 })),
    };
    const changed = planPlcAssignment(built.value.session, built.value.board, previous, next, true);
    expect(changed.ok).toBe(true);
    if (!changed.ok) throw new Error(changed.message);
    const ladder = structuredClone(problem.referenceLadder);
    for (const block of ladder.networks)
      for (const row of block.cells)
        for (const cell of row) {
          if ('device' in cell && (cell.device.kind === 'input' || cell.device.kind === 'output'))
            cell.device = { ...cell.device, index: cell.device.index + 4 };
        }
    const result = judgePlc(problem, JIPM_BOARD, changed.value, ladder);
    expect(result.ok && result.value.passed, JSON.stringify(result)).toBe(true);
  });

  it('接続変更を拒否しても元の線・線番・経路は失わず、成功は1履歴で戻せる', () => {
    useStore.getState().openProblem(BUILTIN_ASSEMBLE_PROBLEMS[0]!);
    const session = useStore.getState().session!;
    const wire = addWire(session, JIPM_BOARD, toTerminalId('P.1'), toTerminalId('TB_PB.1c'), '青');
    if (!wire.ok) throw new Error(wire.message);
    const id = wire.value.id;
    session.wireAnnotations = { [id]: { label: '起動電源', note: '保持回路の給電' } };
    session.wireRoutePreferences = { [id]: { viaChannelIds: [] } };
    const original = structuredClone(session);
    const failed = reconnectWire(
      session,
      JIPM_BOARD,
      id,
      toTerminalId('P.1'),
      toTerminalId('unknown.1'),
      '青',
    );
    expect(failed.ok).toBe(false);
    expect(session).toEqual(original);
    const changed = reconnectWire(
      session,
      JIPM_BOARD,
      id,
      toTerminalId('P.1'),
      toTerminalId('TB_PB.2c'),
      '青',
    );
    expect(commitWireEdit(changed)).toBe(true);
    expect(useStore.getState().session?.wireAnnotations).toEqual(original.wireAnnotations);
    expect(useStore.getState().history.done).toHaveLength(1);
    useStore.setState(undo(useStore.getState().history)!);
    expect(useStore.getState().session).toEqual(original);
    useStore.setState(redo(useStore.getState().history)!);
    expect(useStore.getState().session?.wires[0]?.to).toBe('TB_PB.2c');
    const edited = useStore.getState().session!;
    expect(removeWire(edited, id).ok).toBe(true);
    expect(edited.wireAnnotations).toEqual({});
    expect(edited.wireRoutePreferences).toEqual({});
  });

  it('固定割付の変更と過大I/Oを拒否し、自由割付の失敗でも既存配線を保持する', () => {
    const problem = BUILTIN_PLC_PROBLEMS[0]!;
    const board = boardForProblem(problem),
      session = createSession(board, { includeCheckWires: false });
    const fixed = resolvePlcIo(problem.io),
      free = { ...fixed, mode: 'free' as const };
    expect(planPlcAssignment(session, board, fixed, free, true).ok).toBe(false);
    const invalid = { ...free, inputs: [{ pb: 'PB1' as const, x: 999 }] };
    expect(planPlcAssignment(session, board, free, invalid, true).ok).toBe(false);
    expect(session.wires).toEqual([]);
    const changed = { ...free, inputs: free.inputs.map((value, i) => ({ ...value, x: i + 4 })) };
    const planned = planPlcAssignment(session, board, free, changed, true);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.plcAssignment?.inputs[0]?.x).toBe(4);
    expect(
      planned.value.wires.some(
        (wire) => wire.to === toTerminalId('PLC.X4') || wire.from === toTerminalId('PLC.X4'),
      ),
    ).toBe(true);
    expect(session.wires).toEqual([]);
  });
});

describe('測定記録の取得時点', () => {
  it('プローブ移動中の古い測定値を記録せず、記録後はライブ値の変化から独立する', () => {
    const store = createAppStore();
    store.getState().openProblem(BUILTIN_ASSEMBLE_PROBLEMS[0]!);
    const tester = {
      ...store.getState().tester,
      mode: 'DCV' as const,
      black: toTerminalId('N.1'),
      red: toTerminalId('P.1'),
    };
    const reading = {
      ...EMPTY_SNAPSHOT.tester,
      ...tester,
      value: 24,
      display: '24.00',
      live: false,
    };
    store.setState({
      tester,
      snapshot: {
        ...EMPTY_SNAPSHOT,
        powered: true,
        tester: { ...reading, red: toTerminalId('TB_PB.1c') },
      },
    });
    expect(store.getState().recordMeasurement('電源を確認')).toBe(false);
    store.setState({ snapshot: { ...EMPTY_SNAPSHOT, powered: true, tester: reading } });
    expect(store.getState().recordMeasurement('電源を確認')).toBe(true);
    store.setState({
      snapshot: { ...EMPTY_SNAPSHOT, tester: { ...reading, value: 0, display: '0.00' } },
    });
    expect(store.getState().measurements[0]).toMatchObject({
      value: 24,
      powered: true,
      black: 'N.1',
      red: 'P.1',
      note: '電源を確認',
    });
  });
});

describe('自動保存の順序と終了通知', () => {
  it('保存中に進んだ編集を必ず後続保存し、終了は最新保存の成功を待つ', async () => {
    vi.useFakeTimers();
    let finish: ((value: { ok: true }) => void) | undefined;
    api.saveWorkFile
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ ok: true });
    let close: (() => Promise<boolean>) | undefined;
    api.onCloseRequest.mockImplementation((listener: () => Promise<boolean>) => {
      close = listener;
      return () => undefined;
    });
    const stop = startAutosave();
    try {
      useStore.getState().openProblem(BUILTIN_ASSEMBLE_PROBLEMS[0]!);
      const saving = flushAutosave();
      expect(api.saveWorkFile).toHaveBeenCalledTimes(1);
      useStore.setState({ hintStage: 2 });
      const closing = close!();
      expect(api.saveWorkFile).toHaveBeenCalledTimes(1);
      finish!({ ok: true });
      expect(await closing).toBe(true);
      expect(await saving).toBe(true);
      expect(api.saveWorkFile).toHaveBeenCalledTimes(2);
      expect(api.saveWorkFile.mock.calls[1]?.[0]).toMatchObject({
        file: { learningProgress: { hintStage: 2 } },
      });
    } finally {
      stop();
    }
  });

  it('終了前の書込が失敗したら閉じず、再試行で保存できる', async () => {
    vi.useFakeTimers();
    api.saveWorkFile
      .mockResolvedValueOnce({ ok: false, message: '容量不足' })
      .mockResolvedValue({ ok: true });
    let close: (() => Promise<boolean>) | undefined;
    api.onCloseRequest.mockImplementation((listener: () => Promise<boolean>) => {
      close = listener;
      return () => undefined;
    });
    const stop = startAutosave();
    try {
      useStore.getState().openProblem(BUILTIN_ASSEMBLE_PROBLEMS[0]!);
      expect(await close!()).toBe(false);
      expect(useStore.getState().session).toBeDefined();
      expect(await flushAutosave()).toBe(true);
    } finally {
      stop();
    }
  });
});
