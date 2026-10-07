// helpers/worker-bridge.js を他の import より前に置く（vi.mock のファクトリから参照するため）
import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { isLabProblem } from '@ojt/content';
import { no, out, program, network, endNetwork, X, Y } from '@ojt/ladder-core';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parseWorkFile } from '../src/shared/work-file-codec.js';
import { useStore } from '../src/renderer/app/store.js';
import { editLab, newLabProblem } from '../src/renderer/session/lab.js';
import { applyWorkFile, toInspectWorkFile } from '../src/renderer/session/work-file.js';

/**
 * 実験の課題は課題ファイルにしない（その場で作る。利用者の決定 D1）ので、自動保存・作業ファイルは
 * `problemSnapshot` に入った課題（描いた押し方・正解・配線済みかどうか）から開き直す。
 */
const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
const apiState = vi.hoisted((): { readProblem: Mock } => ({ readProblem: vi.fn() }));
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));
vi.mock('../src/renderer/app/ojt-api.js', () => ({
  ojtApi: () => ({ readProblem: apiState.readProblem }),
}));

beforeEach(() => {
  bridgeMock.sent.length = 0;
  apiState.readProblem.mockReset();
  // 課題ライブラリには実験の課題が無い
  apiState.readProblem.mockResolvedValue(null);
  useStore.getState().abandonSession();
  useStore.setState({ dialectId: 'mitsubishi', defaultVendor: 'mitsubishi' });
});

describe('実験の作業ファイル', () => {
  it('回路実験: 描いたタイムチャートごと保存し、課題ライブラリに無くても開き直せる', async () => {
    useStore
      .getState()
      .openProblem(newLabProblem('assemble-lab', { vendor: 'mitsubishi', prewired: true }));
    expect(
      editLab((problem) => ({
        ...problem,
        durationMs: 4_000,
        operations: [
          { t: 500, target: 'PB1', action: 'press' },
          { t: 900, target: 'PB1', action: 'release' },
        ],
        expected: [{ signal: 'PL1', on: [[500, 3_000]] }],
      })),
    ).toBe(true);
    const file = toInspectWorkFile();
    expect(file?.mode).toBe('assemble-lab');
    expect(file?.schematic).toBeUndefined();
    const parsed = parseWorkFile(JSON.parse(JSON.stringify(file)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    useStore.getState().abandonSession();
    expect(await applyWorkFile(parsed.file)).toBe(true);
    const problem = useStore.getState().problem;
    expect(problem !== undefined && isLabProblem(problem)).toBe(true);
    if (problem === undefined || !isLabProblem(problem)) return;
    expect(problem.durationMs).toBe(4_000);
    expect(problem.operations).toHaveLength(2);
    expect(problem.expected).toEqual([{ signal: 'PL1', on: [[500, 3_000]] }]);
    expect(useStore.getState().route).toBe('session');
    expect(bridgeMock.sent.some((command) => command['type'] === 'load')).toBe(true);
  });

  it('PLC実験: 配線済みの盤（固定電線）・メーカー・ラダーを保存して開き直せる', async () => {
    useStore
      .getState()
      .openProblem(
        newLabProblem('plc-lab', { vendor: 'jtekt', prewired: true, templateId: 'one-shot' }),
      );
    const ladder = program(network('n1', [[no(X(0)), out(Y(0))]]), endNetwork());
    useStore.setState({ ladder });
    const wires = useStore.getState().session!.wires.length;
    const file = toInspectWorkFile();
    expect(file?.mode).toBe('plc-lab');
    expect(file?.dialectId).toBe('jtekt');
    const parsed = parseWorkFile(JSON.parse(JSON.stringify(file)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    useStore.getState().abandonSession();
    useStore.setState({ defaultVendor: 'mitsubishi' });
    expect(await applyWorkFile(parsed.file)).toBe(true);
    const state = useStore.getState();
    expect(state.problem?.mode).toBe('plc-lab');
    expect(state.dialectId).toBe('jtekt');
    expect(state.session?.wires).toHaveLength(wires);
    expect(state.session?.wires.every((wire) => wire.locked)).toBe(true);
    expect(state.ladder?.networks[0]?.cells[0]?.[0]).toEqual(no(X(0)));
    const load = bridgeMock.sent.find((command) => command['type'] === 'load');
    expect(load?.['allowPlcForcing']).toBe(true);
  });

  it('実験の課題が入っていない作業ファイル（実験のIDだけ）は開かない', async () => {
    useStore
      .getState()
      .openProblem(newLabProblem('assemble-lab', { vendor: 'mitsubishi', prewired: true }));
    const withoutSnapshot = { ...toInspectWorkFile()! };
    delete withoutSnapshot.problemSnapshot;
    useStore.getState().abandonSession();
    expect(await applyWorkFile(withoutSnapshot)).toBe(false);
  });
});
