import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { addWire, plcUnitFor } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  isInspectPartsProblem,
  isInspectRepairProblem,
} from '@ojt/content';
import { empty, insertNetwork, MAX_NETWORKS, network, type LadderProgram } from '@ojt/ladder-core';
import { IMPLEMENTED_DIALECT_IDS } from '@ojt/plc-dialects';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { boardForProblem } from '../src/renderer/session/plc-session.js';
import {
  applyWorkFile,
  needsDiscardConfirm,
  toInspectWorkFile,
} from '../src/renderer/session/work-file.js';
import { parseWorkFile } from '../src/shared/work-file-codec.js';

const bridgeState = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
const readProblem = vi.hoisted(() => vi.fn());
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeState));
vi.mock('../src/renderer/app/ojt-api.js', () => ({ ojtApi: () => ({ readProblem }) }));

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ defaultVendor: 'mitsubishi' });
  bridgeState.sent = [];
  readProblem.mockReset();
});

describe('レビューで確認した保存・復旧の回帰', () => {
  it.each(IMPLEMENTED_DIALECT_IDS)(
    'R01/R21: %s の電源線を復元し同じ機種をWorkerに送る',
    async (vendor) => {
      const source = BUILTIN_PLC_PROBLEMS[0]!;
      expect(useStore.getState().openProblem(source, { vendor })).toBe(true);
      const { problem, session } = useStore.getState();
      const board = boardForProblem(problem);
      const inlet = board.terminals.find((t) => String(t.id) === 'OUTLET.L')!;
      const unit = plcUnitFor(problem!.mode === 'plc' ? problem!.plc.model : '')!;
      const supply = board.terminals.find((t) => String(t.id) === `PLC.${unit.spec.acPower[0]}`)!;
      expect(inlet).toBeDefined();
      expect(supply).toBeDefined();
      expect(addWire(session!, board, inlet.id, supply.id, '青').ok).toBe(true);
      const file = structuredClone(toInspectWorkFile()!);
      const expectedWires = structuredClone(session!.wires);
      useStore.getState().abandonSession();
      readProblem.mockResolvedValue(source);
      expect(await applyWorkFile(file)).toBe(true);
      const restored = useStore.getState();
      expect(restored.session!.wires).toEqual(expectedWires);
      expect(restored.dialectId).toBe(vendor);
      expect(
        [...bridgeState.sent].reverse().find((message) => message['type'] === 'load'),
      ).toMatchObject({
        plcModel: restored.problem!.mode === 'plc' ? restored.problem!.plc.model : '',
      });
    },
  );

  it('R02: 不完全な盤や段の読込失敗で現在の解答を変えない', async () => {
    const problem = BUILTIN_ALL_PROBLEMS.find(isInspectPartsProblem)!;
    useStore.getState().openProblem(problem);
    useStore.getState().setAnswer(problem.parts[0]!.id, 'normal');
    const before = useStore.getState();
    const file = toInspectWorkFile()!;
    const invalid = { ...file, session: { socketRoles: before.session!.socketRoles, wires: [] } };
    expect(parseWorkFile(invalid).ok).toBe(false);
    expect(await applyWorkFile(invalid, { confirmed: true })).toBe(false);
    expect(useStore.getState().problem).toBe(before.problem);
    expect(useStore.getState().answers).toEqual(before.answers);
    expect(
      parseWorkFile({
        ...file,
        schematic: {
          formatVersion: 1,
          id: 'x',
          title: '',
          orientation: 'horizontal',
          rungs: [{ id: 'r', cells: [] }],
        },
      }).ok,
    ).toBe(false);
  });

  it('R04: C1解答、C2故障・修復情報を反復復旧でも保持する', () => {
    const parts = BUILTIN_ALL_PROBLEMS.find(isInspectPartsProblem)!;
    useStore.getState().openProblem(parts);
    useStore.getState().setAnswer(parts.parts[0]!.id, 'normal');
    const answers = useStore.getState().answers;
    for (let n = 0; n < 3; n += 1) useStore.getState().restartSession();
    expect(useStore.getState().answers).toEqual(answers);
    const repair = BUILTIN_ALL_PROBLEMS.find(isInspectRepairProblem)!;
    useStore.getState().openProblem(repair);
    const initial = useStore.getState();
    for (let n = 0; n < 3; n += 1) useStore.getState().restartSession();
    expect(useStore.getState().circuit).toBe(initial.circuit);
    expect(useStore.getState().resolvedFaults).toEqual(initial.resolvedFaults);
    expect(useStore.getState().route).toBe('session');
  });

  it('R05: 編集可能な最大64ブロックは読め、65個目は作らない', () => {
    let program: LadderProgram = { networks: [] };
    for (let n = 0; n < MAX_NETWORKS; n += 1)
      program = insertNetwork(program, n, network(`n${n}`, [[empty()]]));
    expect(() => insertNetwork(program, MAX_NETWORKS, network('overflow', [[empty()]]))).toThrow();
    useStore.getState().openProblem(BUILTIN_PLC_PROBLEMS[0]!);
    useStore.getState().setLadder(program);
    expect(parseWorkFile(toInspectWorkFile()).ok).toBe(true);
  });

  it('R06/R07/R08/R16: 同一課題の巻戻し確認、履歴累計とウォッチの往復', async () => {
    const source = BUILTIN_PLC_PROBLEMS[0]!;
    useStore.getState().openProblem(source);
    const old = toInspectWorkFile()!;
    const state = useStore.getState();
    const board = boardForProblem(state.problem);
    expect(
      addWire(state.session!, board, toTerminalId('OUTLET.L'), toTerminalId('PLC.L'), '青').ok,
    ).toBe(true);
    useStore.setState({
      hintStage: 2,
      schematicOpenCount: 4,
      restoredHazardCount: 3,
      watchDevices: [{ kind: 'input', index: 0 }],
    });
    expect(needsDiscardConfirm(old)).toBe(true);
    const file = toInspectWorkFile()!;
    expect(file.hazardCount).toBe(3);
    readProblem.mockResolvedValue(source);
    expect(await applyWorkFile(file, { confirmed: true })).toBe(true);
    expect(toInspectWorkFile()).toMatchObject({
      hazardCount: 3,
      learningProgress: { hintStage: 2, schematicOpenCount: 4 },
      watchDevices: [{ kind: 'input', index: 0 }],
    });
  });
});
