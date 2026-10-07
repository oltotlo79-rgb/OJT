import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { addWire, JIPM_BOARD } from '@ojt/board-model';
import { terminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  buildReferenceSession,
  isLabProblem,
  judgeAssembleLab,
  plcWiringPlan,
  resolvePlcIo,
  type LabProblem,
} from '@ojt/content';
import { no, out, program, network, endNetwork, X, Y } from '@ojt/ladder-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { currentHelpScreen } from '../src/renderer/help/help-model.js';
import {
  currentLabProblem,
  editLab,
  newLabProblem,
  restartLabBoard,
} from '../src/renderer/session/lab.js';
import { boardForProblem } from '../src/renderer/session/plc-session.js';

/**
 * 「回路実験」「PLC実験」の課題を開く・描き直す・盤を作り直す（2026-10-08 利用者指示）。
 * 設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md §4.2 / §6
 */
const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ route: 'home', defaultVendor: 'mitsubishi', dialectId: 'mitsubishi' });
  bridgeMock.sent.length = 0;
});

function open(problem: LabProblem): void {
  expect(useStore.getState().openProblem(problem)).toBe(true);
}

function lab(): LabProblem {
  const problem = currentLabProblem();
  if (problem === undefined) throw new Error('lab problem is not open');
  return problem;
}

describe('実験の課題を作って開く', () => {
  it('例題を選ぶと押し方と正解が入り、選ばなければ空のタイムチャート', () => {
    const blank = newLabProblem('assemble-lab', { vendor: 'mitsubishi', prewired: true });
    expect(blank.operations).toEqual([]);
    expect(blank.expected).toBeUndefined();
    const template = newLabProblem('plc-lab', {
      vendor: 'omron',
      prewired: false,
      templateId: 'on-delay',
    });
    expect(template.mode).toBe('plc-lab');
    expect(template.operations.length).toBeGreaterThan(0);
    expect(template.expected?.length).toBeGreaterThan(0);
    expect(template.mode === 'plc-lab' && template.plc.vendor).toBe('omron');
    expect(template.mode === 'plc-lab' && template.prewired).toBe(false);
  });

  it('回路実験は何も付いていない盤・押ボタン4行とランプ4行のライブチャートで始まる', () => {
    open(newLabProblem('assemble-lab', { vendor: 'mitsubishi', prewired: true }));
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.mode).toBe('wire');
    expect(state.session?.wires).toEqual([]);
    expect(state.session?.mounted).toEqual({});
    expect(state.chartSpecs.map((spec) => spec.name)).toEqual([
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
      'PL2',
      'PL3',
      'PL4',
    ]);
    expect(state.ladder).toBeUndefined();
    expect(state.schematicDoc).toBeUndefined();
    expect(state.camera).toBe('front');
    expect(state.labRun).toBeUndefined();
  });

  it('PLC実験（配線済み）は固定電線とリレー4個の盤で、ラダーは空から始まる', () => {
    open(newLabProblem('plc-lab', { vendor: 'mitsubishi', prewired: true }));
    const state = useStore.getState();
    const problem = lab();
    const unit = boardForProblem(problem).plcUnit;
    expect(problem.mode === 'plc-lab' && unit !== undefined).toBe(true);
    if (problem.mode !== 'plc-lab' || unit === undefined) return;
    expect(state.session?.wires).toHaveLength(plcWiringPlan(resolvePlcIo(problem.io), unit).length);
    expect(state.session?.wires.every((wire) => wire.locked)).toBe(true);
    expect(Object.keys(state.session?.mounted ?? {})).toHaveLength(4);
    expect(state.ladder?.networks.map((n) => n.id)).toEqual(['n1', 'end']);
    expect(state.camera).toBe('plc');
  });

  it('始めるときに選んだメーカーの機種で開く（既定メーカーへ戻さない）', () => {
    useStore.setState({ defaultVendor: 'mitsubishi' });
    open(newLabProblem('plc-lab', { vendor: 'sharp', prewired: true }));
    const problem = lab();
    expect(problem.mode === 'plc-lab' && problem.plc.vendor).toBe('sharp');
    expect(useStore.getState().dialectId).toBe('sharp');
    expect(useStore.getState().session?.wires.some((wire) => wire.from.startsWith('PLC.'))).toBe(
      true,
    );
  });
});

describe('タイムチャートを描き直す', () => {
  function runOnReference(): void {
    // 自己保持の模範回路の盤で「動かした」結果を入れておく
    const reference = buildReferenceSession(BUILTIN_ASSEMBLE_PROBLEMS[0]!, JIPM_BOARD);
    if (!reference.ok) throw new Error('reference');
    useStore.getState().setSession(reference.value.session);
    const outcome = judgeAssembleLab(
      lab() as Extract<LabProblem, { mode: 'assemble-lab' }>,
      JIPM_BOARD,
      reference.value.session,
    );
    if (!outcome.ok) throw new Error('judge');
    useStore.getState().setLabRun(outcome.value);
  }

  it('正解だけを描き直すと、最後に動かした結果を比べ直す（動かし直さない）', () => {
    open(
      newLabProblem('assemble-lab', {
        vendor: 'mitsubishi',
        prewired: true,
        templateId: 'self-hold',
      }),
    );
    runOnReference();
    expect(useStore.getState().labRun?.passed).toBe(true);
    expect(
      editLab((problem) => ({ ...problem, expected: [{ signal: 'PL2', on: [[1_000, 2_000]] }] })),
    ).toBe(true);
    const run = useStore.getState().labRun;
    expect(run).toBeDefined();
    expect(run?.passed).toBe(false);
    expect(run?.mismatches.map((m) => m.signal)).toEqual(expect.arrayContaining(['PL1', 'PL2']));
    expect(run?.charts.expected?.signals.find((s) => s.name === 'PL2')?.segments).toEqual([
      { fromMs: 0, toMs: 1_000, value: false },
      { fromMs: 1_000, toMs: 2_000, value: true },
      { fromMs: 2_000, toMs: 5_000, value: false },
    ]);
    // 正解を消すと、判定はしない（動かした結果だけ）
    expect(
      editLab((problem) => {
        const next = { ...problem };
        delete next.expected;
        return next;
      }),
    ).toBe(true);
    expect(useStore.getState().labRun?.judged).toBe(false);
    expect(useStore.getState().labRun?.charts.expected).toBeUndefined();
  });

  it('押し方か長さを描き直すと、最後に動かした結果は捨てる', () => {
    open(
      newLabProblem('assemble-lab', {
        vendor: 'mitsubishi',
        prewired: true,
        templateId: 'self-hold',
      }),
    );
    runOnReference();
    expect(editLab((problem) => ({ ...problem, durationMs: 6_000 }))).toBe(true);
    expect(useStore.getState().labRun).toBeUndefined();
    expect(lab().durationMs).toBe(6_000);
  });

  it('課題の形にならない描き方は受け付けない', () => {
    open(newLabProblem('assemble-lab', { vendor: 'mitsubishi', prewired: true }));
    expect(
      editLab((problem) => ({
        ...problem,
        operations: [{ t: 100, target: 'PB1', action: 'release' }],
      })),
    ).toBe(false);
    expect(lab().operations).toEqual([]);
    expect(useStore.getState().toasts.at(-1)?.text).toContain('タイムチャート');
  });
});

describe('盤を作り直す（配線をやり直す）', () => {
  it('PLC実験を自分で配線する盤に変えても、タイムチャートとラダーは残る', () => {
    open(
      newLabProblem('plc-lab', { vendor: 'mitsubishi', prewired: true, templateId: 'self-hold' }),
    );
    const ladder = program(network('n1', [[no(X(0)), out(Y(0))]]), endNetwork());
    useStore.setState({ ladder });
    const epoch = useStore.getState().sessionEpoch;
    expect(restartLabBoard(false)).toBe(true);
    const state = useStore.getState();
    const problem = lab();
    expect(problem.mode === 'plc-lab' && problem.prewired).toBe(false);
    expect(problem.mode === 'plc-lab' && problem.io.mode).toBe('free');
    expect(problem.operations.length).toBeGreaterThan(0);
    expect(problem.expected?.length).toBeGreaterThan(0);
    expect(state.session?.wires).toEqual([]);
    expect(state.session?.mounted).toEqual({});
    expect(state.ladder).toEqual(ladder);
    expect(state.sessionEpoch).toBe(epoch + 1);
    // 配線済みへ戻す
    expect(restartLabBoard(true)).toBe(true);
    expect(useStore.getState().session?.wires.every((wire) => wire.locked)).toBe(true);
    expect(useStore.getState().session?.wires.length).toBeGreaterThan(0);
  });

  it('回路実験で配線した電線は、盤を作り直すと消える', () => {
    open(newLabProblem('assemble-lab', { vendor: 'mitsubishi', prewired: true }));
    const session = structuredClone(useStore.getState().session!);
    expect(
      addWire(
        session,
        boardForProblem(lab()),
        terminalId('P', '1'),
        terminalId('TB_PB', '1c'),
        '青',
      ).ok,
    ).toBe(true);
    useStore.getState().setSession(session);
    expect(restartLabBoard()).toBe(true);
    expect(useStore.getState().session?.wires).toEqual([]);
  });
});

describe('メーカーを切り替える（PLC実験）', () => {
  it('配線済みの盤は新しい機種の端子名で張り直し、タイムチャートは残す', () => {
    open(
      newLabProblem('plc-lab', { vendor: 'mitsubishi', prewired: true, templateId: 'self-hold' }),
    );
    const before = lab();
    useStore.getState().switchDialect('omron');
    const after = lab();
    expect(isLabProblem(after)).toBe(true);
    expect(after.mode === 'plc-lab' && after.plc.vendor).toBe('omron');
    expect(after.operations).toEqual(before.operations);
    expect(after.expected).toEqual(before.expected);
    const wires = useStore.getState().session?.wires ?? [];
    expect(wires.length).toBeGreaterThan(0);
    expect(wires.every((wire) => wire.locked)).toBe(true);
    // 三菱の端子名（X0）は残っていない
    expect(wires.some((wire) => [wire.from, wire.to].map(String).includes('PLC.X0'))).toBe(false);
  });
});

describe('ヘルプの画面', () => {
  it('回路実験・PLC実験はそれぞれの画面として扱う', () => {
    expect(currentHelpScreen('session', 'assemble-lab', 'board')).toBe('lab-assemble');
    expect(currentHelpScreen('session', 'plc-lab', 'board')).toBe('lab-plc');
    expect(currentHelpScreen('result', 'plc-lab', 'board')).toBe('result');
  });
});
