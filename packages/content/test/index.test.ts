import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JIPM_BOARD } from '@ojt/board-model';
import { buildNets, Simulation, TICK_MS } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  // schema/common.js
  BoardRefSchema,
  CONTENT_FORMAT_VERSION,
  ExtraPartSchema,
  GradeSchema,
  InventoryItemSchema,
  MountableKindSchema,
  ProblemHeaderSchema,
  ProblemHeaderShape,
  ProblemIdSchema,
  ProblemModeSchema,
  SocketRoleSchema,
  SocketRolesSchema,
  TerminalIdSchema,
  TimeLimitSchema,
  toSocketRoles,
  UNSUPPORTED_MODES,
  // schema/schematic.js
  CellKindSchema,
  hasExactTimerRange,
  RungEndSchema,
  RungSchema,
  SchematicCellSchema,
  SchematicDocumentSchema,
  toZodPath,
  // schema/operations.js
  DurationMsSchema,
  lastOperationMs,
  OperationActionSchema,
  OperationListSchema,
  OperationSchema,
  OperationTargetSchema,
  pressedAt,
  // schema/judge.js
  BOARD_OUTPUT_SIGNALS,
  DEFAULT_STATIC_CHECKS,
  defaultCompareSignals,
  JudgeSettingsSchema,
  resolveCompareSignals,
  STATIC_CHECK_IDS,
  StaticChecksSchema,
  ToleranceSchema,
  // schema/assemble.js
  AssembleProblemSchema,
  HintsSchema,
  // schema/index.js
  parseProblem,
  problemJsonSchema,
  ProblemSchema,
  toProblemIssues,
  // reference.js
  ASSEMBLE_WIRE_COLOR,
  buildReferenceSession,
  toPhysicalOverride,
  toProblemPath,
  // runner.js
  powerUp,
  runOperations,
  // timechart.js
  buildTimeChart,
  defaultChartSignals,
  OUTPUT_LABELS,
  PB_LABELS,
  startsAndEndsLow,
  timerMarkers,
  // schema/faults.js
  FAULT_KINDS,
  FaultSpecSchema,
  socketContactElementIndex,
  // schema/inspect-parts.js
  InspectPartsProblemSchema,
  PART_TRUTHS,
  // schema/inspect-repair.js
  InspectRepairProblemSchema,
  // schema/index.js
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  // rng.js / faults.js / random-faults.js / forbidden.js
  applyFaults,
  findForbiddenPatterns,
  mulberry32,
  RANDOM_FAULT_KINDS,
  resolveFaults,
  // inspect-parts.js / inspect-repair.js / highlight.js
  buildCheckCircuit,
  buildHighlightIndex,
  buildInspectRepairCircuit,
  DIAGNOSIS_TABLE,
  diagnoseCheckReading,
  expectedCheckReading,
  layerShortThresholdOhms,
  PART_TRUTH_LABELS,
  REPAIR_WIRE_COLOR,
  type RepairCircuitOptions,
  // judge-inspect.js
  judgeInspectParts,
  judgeInspectRepair,
  scoreReports,
  // static-checks.js
  checkCoilPolarity,
  checkForbiddenCircuit,
  checkPowerSequence,
  checkTerminalLimit,
  checkUnusedParts,
  checkWireColorRule,
  runStaticChecks,
  // judge.js
  judgeAssemble,
  judgeReference,
  // builtin/index.js
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  BUILTIN_PROBLEMS,
  BuiltinProblemError,
  findBuiltinProblem,
  parseBuiltinProblems,
  // schema/index.js（Phase 3）
  isPlcProblem,
  // schema/ladder.js
  CellSchema,
  DeviceCommentsSchema,
  DeviceKindSchema,
  DeviceSchema,
  LADDER_COIL_COL,
  LadderNetworkSchema,
  LadderProgramSchema,
  MAX_DEVICE_COMMENT_LENGTH,
  MAX_DEVICE_COMMENTS,
  // schema/plc.js
  DEFAULT_PLC_IO,
  PHASE3_MODELS,
  PLC_MODELS,
  PLC_VENDORS,
  PlcInputMapSchema,
  PlcIoModeSchema,
  PlcIoSchema,
  PlcOutputMapSchema,
  PlcProblemSchema,
  PlcRefSchema,
  PlcWiringSchema,
  resolvePlcIo,
  // schema/judge.js（Phase 3）
  PLC_DEFAULT_STATIC_CHECKS,
  PlcJudgeSettingsSchema,
  // plc-io.js
  createPlcCoupling,
  createSimulationIoPort,
  runPlcOperations,
  // plc-reference.js
  buildPlcReferenceSession,
  PLC_WIRE_COLOR,
  plcBoardFor,
  plcWiringPlan,
  plcWiringPlanIssues,
  // plc-static-checks.js
  BOARD_POWER_PREFIXES,
  checkIoAssignment,
  checkPlcPowerIndependent,
  checkTwoStage,
  detectPlcWiring,
  // judge-plc.js
  judgePlc,
  judgePlcReference,
  plcTimerMarkers,
  // runner.js（Phase 3）
  runOperationsOn,
  type AssembleProblem,
  type CellData,
  type DeviceCommentsData,
  type DeviceData,
  type JudgePlcOutcome,
  type JudgePlcResult,
  type JudgeSettings,
  type LadderProgramData,
  type Operation,
  type PlcCoupling,
  type PlcCouplingOptions,
  type PlcInputMapData,
  type PlcIoData,
  type PlcCheckContext,
  type PlcOutputMapData,
  type PlcProblem,
  type PlcReferenceCircuit,
  type PlcReferenceResult,
  type PlcRunOptions,
  type PlcRunResult,
  type PlcWireSpec,
  type ProblemHeader,
  type ReferenceCircuit,
  type ResolvedPlcIo,
  type StaticCheckInput,
  type JudgeResult,
  type TimeChart,
} from '../src/index.js';
import { inspectPartsProblemJson, inspectRepairProblemJson } from './helpers/inspect.js';
import { plcProblemJson } from './helpers/plc.js';
import {
  forbiddenOneShotProblemJson,
  selfHoldProblemJson,
  task2Roles,
} from './helpers/problems.js';

/**
 * `@ojt/content` の公開API（`src/index.ts`）の疎通テスト。設計仕様 §17。
 * 各モジュールの再エクスポートが正しいシンボルを指していることを、バレルファイル
 * （`../src/index.js`）だけを import して確かめる。個々の挙動の網羅は各モジュールの
 * 専用テストが担うので、ここでは「存在し、公開APIとして噛み合わせて使える」ことを見る。
 *
 * 例外は `loadProblemsFromDir()` / `mergeProblemSets()`（`node:fs` を使う）。Task 1D1-b で
 * バレルから外し `@ojt/content/loader` 専用にしたので、下の `loader.js exports` はバレルに
 * **無い**ことと、subpath から取れることの両方を確かめる（動的 import で確認する。バレルの
 * 静的 import 一覧に無いシンボルをここだけ型で要求しないため、また subpath 解決に失敗しても
 * このファイルの他のテストを道連れにしないため）。
 */

/** 自己保持回路の課題（既定は selfHoldProblemJson）を模範回路まで組み立てる。 */
function buildFixtureReference(json: Record<string, unknown> = selfHoldProblemJson()): {
  problem: AssembleProblem;
  reference: ReferenceCircuit;
} {
  const parsed = parseProblem(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
  if (parsed.problem.mode !== 'assemble') throw new Error('モードB課題ではありません');
  const built = buildReferenceSession(parsed.problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors, null, 2));
  return { problem: parsed.problem, reference: built.value };
}

/** 静的チェック1件ぶんの入力を、実際に操作列を再生して作る。 */
function staticCheckInputFor(json: Record<string, unknown>): StaticCheckInput {
  const { problem, reference } = buildFixtureReference(json);
  const run = runOperations(reference.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  return {
    session: reference.session,
    netlist: reference.netlist,
    log: run.log,
    hazards: run.events.hazards(),
    chatters: run.events.chatters(),
    allowedColors: [ASSEMBLE_WIRE_COLOR],
  };
}

describe('schema/common.js exports', () => {
  it('cover the common header schema pieces', () => {
    expect(CONTENT_FORMAT_VERSION).toBe(1);
    expect(ProblemIdSchema.safeParse('b-001').success).toBe(true);
    expect(GradeSchema.safeParse(3).success).toBe(true);
    expect(ProblemModeSchema.safeParse('assemble').success).toBe(true);
    expect(UNSUPPORTED_MODES).toEqual([]);
    expect(TimeLimitSchema.safeParse({ standardMin: 30, cutoffMin: 50 }).success).toBe(true);
    expect(SocketRoleSchema.safeParse('CR1').success).toBe(true);
    expect(SocketRolesSchema.safeParse(task2Roles()).success).toBe(true);
    expect(toSocketRoles({ S1: 'CR1', S3: undefined, S7: 'CHK' })).toEqual({
      S1: 'CR1',
      S7: 'CHK',
    });
    expect(ExtraPartSchema.safeParse('BZ').success).toBe(true);
    expect(
      BoardRefSchema.safeParse({ boardId: 'board-jipm-std', socketRoles: task2Roles() }).success,
    ).toBe(true);
    expect(MountableKindSchema.safeParse('relay-my4n').success).toBe(true);
    expect(InventoryItemSchema.safeParse({ kind: 'relay-my4n', count: 2 }).success).toBe(true);
    expect(Object.keys(ProblemHeaderShape)).toEqual([
      'formatVersion',
      'id',
      'title',
      'grade',
      'description',
      'timeLimit',
      'board',
      'inventory',
    ]);
    const header: ProblemHeader = {
      formatVersion: CONTENT_FORMAT_VERSION,
      id: 'b-001',
      title: 'テスト用ヘッダ',
      grade: 3,
      mode: 'assemble',
      description: 'テスト用',
      timeLimit: { standardMin: 30, cutoffMin: 50 },
      board: { boardId: 'board-jipm-std', socketRoles: task2Roles() },
      inventory: [{ kind: 'relay-my4n', count: 2 }],
    };
    expect(ProblemHeaderSchema.safeParse(header).success).toBe(true);
    expect(TerminalIdSchema.safeParse('CR1.14').success).toBe(true);
  });
});

describe('schema/schematic.js exports', () => {
  it('cover the schematic document schema pieces', () => {
    expect(CellKindSchema.safeParse('coil').success).toBe(true);
    expect(hasExactTimerRange(3000)).toBe(true);
    expect(hasExactTimerRange(3001)).toBe(false);
    expect(RungEndSchema.safeParse({ bus: 'P' }).success).toBe(true);
    expect(SchematicCellSchema.safeParse({ kind: 'coil', id: 'c1', device: 'CR1' }).success).toBe(
      true,
    );
    const rung = {
      id: 'r1',
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [{ kind: 'coil', id: 'c1', device: 'CR1' }],
    };
    expect(RungSchema.safeParse(rung).success).toBe(true);
    expect(toZodPath('rungs[0].cells[2]')).toEqual(['rungs', 0, 'cells', 2]);
    expect(SchematicDocumentSchema.safeParse(selfHoldProblemJson().schematic).success).toBe(true);
  });
});

describe('schema/operations.js exports', () => {
  it('cover the operation list schema pieces', () => {
    expect(OperationTargetSchema.safeParse('PB1').success).toBe(true);
    expect(OperationActionSchema.safeParse('press').success).toBe(true);
    const op = { t: 500, target: 'PB1', action: 'press' };
    expect(OperationSchema.safeParse(op).success).toBe(true);
    expect(
      OperationListSchema.safeParse([op, { t: 400, target: 'PB1', action: 'release' }]).success,
    ).toBe(false);
    expect(DurationMsSchema.safeParse(5000).success).toBe(true);
    const ops: Operation[] = [
      { t: 500, target: 'PB1', action: 'press' },
      { t: 800, target: 'PB1', action: 'release' },
    ];
    expect(pressedAt(ops, 'PB1', 600)).toBe(true);
    expect(pressedAt(ops, 'PB1', 900)).toBe(false);
    expect(lastOperationMs(ops)).toBe(800);
    expect(lastOperationMs([])).toBe(0);
  });
});

describe('schema/judge.js exports', () => {
  it('cover the judge settings schema pieces', () => {
    expect(BOARD_OUTPUT_SIGNALS).toEqual(['PL1', 'PL2', 'PL3', 'PL4']);
    expect(defaultCompareSignals([])).toEqual(['PL1', 'PL2', 'PL3', 'PL4']);
    expect(defaultCompareSignals(['BZ'])).toEqual(['PL1', 'PL2', 'PL3', 'PL4', 'BZ']);
    expect(ToleranceSchema.safeParse({}).success).toBe(true);
    expect(STATIC_CHECK_IDS).toEqual([
      'wireColorRule',
      'terminalLimit',
      'unusedParts',
      'forbiddenCircuit',
      'coilPolarity',
      'powerSequence',
      'twoStage',
      'plcPowerIndependent',
      'ioAssignment',
    ]);
    expect(StaticChecksSchema.parse({})).toEqual(DEFAULT_STATIC_CHECKS);
    const settings: JudgeSettings = JudgeSettingsSchema.parse({});
    expect(settings.staticChecks).toEqual(DEFAULT_STATIC_CHECKS);
    expect(resolveCompareSignals(settings, [])).toEqual(BOARD_OUTPUT_SIGNALS);
  });
});

describe('schema/assemble.js exports', () => {
  it('cover the assemble problem schema pieces', () => {
    expect(HintsSchema.safeParse({ schematicVisible: true }).success).toBe(true);
    expect(AssembleProblemSchema.safeParse(selfHoldProblemJson()).success).toBe(true);
  });
});

describe('schema/index.js exports', () => {
  it('parses a valid problem and reports issues for a broken one', () => {
    const ok = parseProblem(selfHoldProblemJson());
    if (!ok.ok) throw new Error(JSON.stringify(ok.issues, null, 2));
    if (ok.problem.mode !== 'assemble') throw new Error('モードB課題ではありません');
    const problem: AssembleProblem = ok.problem;
    expect(problem.id).toBe('x-001');
    expect(ProblemSchema.safeParse(selfHoldProblemJson()).success).toBe(true);

    const plcResult = parseProblem(plcProblemJson());
    expect(plcResult.ok).toBe(true);
    if (plcResult.ok) {
      expect(isPlcProblem(plcResult.problem)).toBe(true);
      expect(PlcProblemSchema.safeParse(plcProblemJson()).success).toBe(true);
    }

    const broken = parseProblem({ mode: 'assemble' });
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.issues.length).toBeGreaterThan(0);

    const emptyResult = AssembleProblemSchema.safeParse({});
    expect(emptyResult.success).toBe(false);
    if (emptyResult.success) return;
    expect(toProblemIssues(emptyResult.error).length).toBeGreaterThan(0);

    const jsonSchema = problemJsonSchema();
    expect(jsonSchema).not.toBeNull();
    expect(Object.keys(jsonSchema).length).toBeGreaterThan(0);
  });
});

describe('loader.js exports', () => {
  it('is not re-exported from the browser-safe barrel (Task 1D1-b)', async () => {
    const barrel: Record<string, unknown> = await import('../src/index.js');
    expect('loadProblemsFromDir' in barrel).toBe(false);
    expect('mergeProblemSets' in barrel).toBe(false);
  });

  it('resolves from @ojt/content/loader and reports a read error / merges builtin with user problems', async () => {
    const { loadProblemsFromDir, mergeProblemSets } = await import('@ojt/content/loader');
    const missing = loadProblemsFromDir(join(tmpdir(), 'ojt-content-index-test-missing-dir'));
    expect(missing.problems).toEqual([]);
    expect(missing.errors[0]?.reason).toBe('read-error');

    const first = parseProblem(selfHoldProblemJson());
    if (!first.ok) throw new Error(JSON.stringify(first.issues, null, 2));
    const second = parseProblem({ ...selfHoldProblemJson(), id: 'x-002' });
    if (!second.ok) throw new Error(JSON.stringify(second.issues, null, 2));

    const merged = mergeProblemSets(
      { problems: [first.problem], errors: [] },
      { problems: [{ ...first.problem, title: '利用者側の上書き' }, second.problem], errors: [] },
    );
    expect(merged.problems.map((p) => p.id)).toEqual(['x-001', 'x-002']);
    expect(merged.problems[0]?.title).toBe('利用者側の上書き');
  });
});

describe('reference.js exports', () => {
  it('builds a reference session and maps assignment error paths back to the problem JSON', () => {
    expect(ASSEMBLE_WIRE_COLOR).toBe('青');
    expect(toPhysicalOverride(undefined)).toBeUndefined();
    expect(toPhysicalOverride({ c1: ['CR1.13', 'CR1.14'] })).toEqual({ c1: ['CR1.13', 'CR1.14'] });

    const { problem, reference } = buildFixtureReference();
    expect(reference.roles.S1).toBe('CR1');
    expect(reference.netlist.parts.some((p) => p.id === 'CR1')).toBe(true);

    expect(toProblemPath(problem, 'roles')).toBe('board.socketRoles');
    expect(toProblemPath(problem, 'physicalOverride.c1')).toBe('physicalOverride.c1');
    expect(toProblemPath(problem, 'sw-003')).toBe('schematic');
  });
});

describe('runner.js exports', () => {
  it('powers up in the documented order with no hazard', () => {
    const { reference } = buildFixtureReference();
    const simulation = new Simulation(reference.netlist);
    powerUp(simulation);
    expect(simulation.events.countOf('power-sequence-violation')).toBe(0);
  });

  it('replays an operation list deterministically', () => {
    const { problem, reference } = buildFixtureReference();
    const run = runOperations(reference.netlist, problem.operations, {
      durationMs: problem.durationMs,
    });
    expect(run.simulation.state().powered).toBe(true);
    expect(run.lastTickMs).toBe(problem.durationMs - TICK_MS);
  });
});

describe('timechart.js exports', () => {
  it('builds a chart with labeled inputs/outputs from a run log', () => {
    const { problem, reference } = buildFixtureReference();
    const run = runOperations(reference.netlist, problem.operations, {
      durationMs: problem.durationMs,
    });
    const compareSignals = defaultCompareSignals(problem.board.extraParts ?? []);
    const signals = defaultChartSignals(compareSignals);
    expect(signals.find((s) => s.name === 'PB1')?.label).toBe(PB_LABELS.PB1);
    expect(signals.find((s) => s.name === 'PL1')?.label).toBe(OUTPUT_LABELS.PL1);
    expect(timerMarkers(reference.netlist)).toEqual([]);

    const chart: TimeChart = buildTimeChart(run.log, signals, problem.durationMs);
    expect(chart.durationMs).toBe(problem.durationMs);
    expect(startsAndEndsLow(chart)).toBe(true);
  });

  it('labels a timer marker from the reference circuit (§7.7)', () => {
    const { reference } = buildFixtureReference(forbiddenOneShotProblemJson());
    expect(timerMarkers(reference.netlist)).toEqual([{ tMs: 500, label: 'T1=0.5秒' }]);
  });
});

describe('static-checks.js exports', () => {
  it('passes every check on a correct circuit', () => {
    const input = staticCheckInputFor(selfHoldProblemJson());
    expect(checkWireColorRule(input).ok).toBe(true);
    expect(checkTerminalLimit(input).ok).toBe(true);
    expect(checkUnusedParts(input).ok).toBe(true);
    expect(checkCoilPolarity(input).ok).toBe(true);
    expect(checkPowerSequence(input).ok).toBe(true);
    expect(runStaticChecks(input, DEFAULT_STATIC_CHECKS).every((r) => r.ok)).toBe(true);
  });

  it('flags a forbidden one-shot circuit as chattering', () => {
    const result = checkForbiddenCircuit(staticCheckInputFor(forbiddenOneShotProblemJson()));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('リレーを介して');
  });
});

describe('judge.js exports', () => {
  it('judges a problem against its own reference session and passes (§14.1 #30)', () => {
    const { problem, reference } = buildFixtureReference();

    const result = judgeAssemble(problem, JIPM_BOARD, reference.session);
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
    const judged: JudgeResult = result.value;
    expect(judged.passed).toBe(true);
    expect(judged.mismatches).toEqual([]);
    expect(judged.hazardCount).toBe(0);
    expect(judged.charts.expected.durationMs).toBe(problem.durationMs);

    const viaReference = judgeReference(problem, JIPM_BOARD);
    if (!viaReference.ok) throw new Error(JSON.stringify(viaReference.errors, null, 2));
    expect(viaReference.value.passed).toBe(true);
  });
});

describe('builtin/index.js exports', () => {
  it('exposes exactly the eight locked builtin assemble problems (§7.9)', () => {
    expect(BUILTIN_PROBLEMS).toBe(BUILTIN_ASSEMBLE_PROBLEMS);
    expect(BUILTIN_PROBLEMS).toHaveLength(8);
    expect(findBuiltinProblem('b-001')?.id).toBe('b-001');
    expect(findBuiltinProblem('nope')).toBeUndefined();
    expect(() => parseBuiltinProblems([{ mode: 'assemble' }])).toThrow(BuiltinProblemError);
  });
});

describe('Phase 2A の公開API（バレル経由）', () => {
  it('exposes the fault schema and the socket element helper', () => {
    expect(FAULT_KINDS).toHaveLength(9);
    expect(socketContactElementIndex(2, 'a')).toBe(4);
    expect(
      FaultSpecSchema.safeParse({ target: { wireId: 'sw-001' }, kind: 'wire-open' }).success,
    ).toBe(true);
  });

  it('exposes the C1 and C2 schemas and their type guards', () => {
    expect(PART_TRUTHS).toHaveLength(7);
    const c1 = InspectPartsProblemSchema.safeParse(inspectPartsProblemJson());
    expect(c1.success).toBe(true);
    const c2 = InspectRepairProblemSchema.safeParse(inspectRepairProblemJson());
    expect(c2.success).toBe(true);
    if (!c1.success || !c2.success) return;
    expect(isInspectPartsProblem(c1.data)).toBe(true);
    expect(isInspectRepairProblem(c2.data)).toBe(true);
    expect(isAssembleProblem(c1.data)).toBe(false);
  });

  it('exposes the built-in C1 and C2 problems (§7.9)', () => {
    expect(BUILTIN_INSPECT_PARTS_PROBLEMS).toHaveLength(4);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS).toHaveLength(8);
    // モードB 8 ＋ C1 4 ＋ C2 8 ＋ D 8
    expect(BUILTIN_ALL_PROBLEMS).toHaveLength(28);
  });

  it('exposes the C1 domain: check circuit, diagnosis table and thresholds (§9.1)', () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    const part = problem.parts[0];
    if (part === undefined) return;
    expect(buildCheckCircuit(problem, JIPM_BOARD, part.id).ok).toBe(true);
    expect(expectedCheckReading(part).coilOhms).toBeCloseTo(650, 3);
    expect(layerShortThresholdOhms()).toBeCloseTo(552.5, 3);
    expect(DIAGNOSIS_TABLE).toHaveLength(7);
    expect(PART_TRUTH_LABELS['coil-layer-short']).toBe('レアショート');
    // 溶着の優先規則はヘルプの注意書きと `diagnoseCheckReading()` の両方で公開する。§9.1 なお書き
    expect(DIAGNOSIS_TABLE.filter((row) => row.note !== undefined).length).toBe(6);
    expect(diagnoseCheckReading(expectedCheckReading(part))).toBe(part.truth);
  });

  it('exposes the C2 domain: faulted board, highlight index and judging (§9.2)', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    expect(REPAIR_WIRE_COLOR).toBe('白');
    const options: RepairCircuitOptions = {};
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD, options);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const index = buildHighlightIndex(built.value.cells, built.value.session);
    expect(index.size).toBeGreaterThan(0);
    const scored = scoreReports(built.value.applied.sites, []);
    expect(scored.missed).toHaveLength(2);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, built.value, []);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.mode).toBe('inspect-repair');
    expect(judged.value.passed).toBe(false);
    expect(judged.value.hazardsByKind['range-exceeded']).toBe(0);
  });

  it('exposes the C1 judge and the deterministic helpers', () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const result = judgeInspectParts(
      problem,
      problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
    );
    expect(result.passed).toBe(true);
    const random = mulberry32(1);
    expect(random()).toBe(mulberry32(1)());
  });

  it('exposes the fault application, random faults and forbidden circuit helpers', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
    if (problem === undefined) return;
    expect(RANDOM_FAULT_KINDS).not.toContain('lamp-open');
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(findForbiddenPatterns(built.value.netlist)).toEqual([]);
    expect(applyFaults(built.value.session, []).ok).toBe(true);
  });
});

describe('Phase 3 の公開API（バレル経由。Task 20）', () => {
  it('内蔵課題は28題（モードB 8 / C1 4 / C2 8 / D 8）', () => {
    expect(BUILTIN_ALL_PROBLEMS).toHaveLength(28);
    expect(BUILTIN_PLC_PROBLEMS).toHaveLength(8);
  });

  it('exposes the ladder schema pieces (schema/ladder.js)', () => {
    expect(LADDER_COIL_COL).toBe(15);
    expect(MAX_DEVICE_COMMENT_LENGTH).toBe(32);
    expect(MAX_DEVICE_COMMENTS).toBe(200);
    expect(DeviceKindSchema.safeParse('input').success).toBe(true);
    const device: DeviceData = { kind: 'input', index: 0 };
    expect(DeviceSchema.safeParse(device).success).toBe(true);
    const cell: CellData = { kind: 'contact', type: 'NO', device };
    expect(CellSchema.safeParse(cell).success).toBe(true);
    expect(LadderNetworkSchema.safeParse({ id: 'n1', cells: [[cell]] }).success).toBe(true);
    const comments: DeviceCommentsData = { X0: 'PB1' };
    expect(DeviceCommentsSchema.safeParse(comments).success).toBe(true);
    const ladder: LadderProgramData = simpleLadderJsonAsProgram();
    expect(LadderProgramSchema.safeParse(ladder).success).toBe(true);
  });

  it('exposes the PLC problem schema pieces and resolvePlcIo (schema/plc.js, schema/judge.js)', () => {
    expect(PLC_VENDORS).toContain('mitsubishi');
    expect(PLC_MODELS).toContain('FX5U');
    expect(PHASE3_MODELS).toEqual(['FX5U']);
    expect(PlcRefSchema.safeParse({ vendor: 'mitsubishi', model: 'FX5U' }).success).toBe(true);
    expect(PlcIoModeSchema.safeParse('fixed').success).toBe(true);
    expect(PlcWiringSchema.safeParse('sink').success).toBe(true);
    const inputMap: PlcInputMapData = { x: 0, pb: 'PB1' };
    expect(PlcInputMapSchema.safeParse(inputMap).success).toBe(true);
    const outputMap: PlcOutputMapData = { y: 0, cr: 'CR1', pl: 'PL1' };
    expect(PlcOutputMapSchema.safeParse(outputMap).success).toBe(true);
    const io: PlcIoData = {
      mode: 'fixed',
      wiring: 'sink',
      inputs: [inputMap],
      outputs: [outputMap],
    };
    expect(PlcIoSchema.safeParse(io).success).toBe(true);
    expect(DEFAULT_PLC_IO.inputs).toHaveLength(3);
    expect(DEFAULT_PLC_IO.outputs).toHaveLength(4);
    const resolved: ResolvedPlcIo = resolvePlcIo(io);
    expect(resolved.inputs).toHaveLength(1);

    const plc: PlcProblem = PlcProblemSchema.parse(plcProblemJson());
    expect(isPlcProblem(plc)).toBe(true);

    expect(PLC_DEFAULT_STATIC_CHECKS.twoStage).toBe(true);
    expect(PlcJudgeSettingsSchema.parse({}).staticChecks).toEqual(PLC_DEFAULT_STATIC_CHECKS);
  });

  it('builds a reference PLC session and judges it against itself (plc-reference.js, judge-plc.js)', () => {
    expect(PLC_WIRE_COLOR).toBe('青');
    const plc: PlcProblem = PlcProblemSchema.parse(plcProblemJson());
    const built: PlcReferenceResult = buildPlcReferenceSession(plc, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors, null, 2));
    const circuit: PlcReferenceCircuit = built.value;
    expect(plcBoardFor(plc, JIPM_BOARD)).toBeDefined();
    const wires: PlcWireSpec[] = plcWiringPlan(resolvePlcIo(plc.io), circuit.unit);
    expect(wires.length).toBeGreaterThan(0);
    expect(plcWiringPlanIssues(resolvePlcIo(plc.io), circuit.session)).toEqual([]);

    const judged: JudgePlcOutcome = judgePlcReference(plc, JIPM_BOARD);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    const result: JudgePlcResult = judged.value;
    expect(result.mode).toBe('plc');
    expect(result.passed).toBe(true);
    expect(plcTimerMarkers(circuit.program)).toEqual([]);

    const traineeJudged = judgePlc(plc, JIPM_BOARD, circuit.session, plc.referenceLadder);
    expect(traineeJudged.ok && traineeJudged.value.passed).toBe(true);
  });

  it('couples the PLC scan into a simulation and replays it deterministically (plc-io.js, runner.js)', () => {
    const plc: PlcProblem = PlcProblemSchema.parse(plcProblemJson());
    const built = buildPlcReferenceSession(plc, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors, null, 2));

    const run: PlcRunResult = runPlcOperations(
      built.value.netlist,
      built.value.program,
      plc.operations,
      { durationMs: plc.durationMs },
    );
    expect(run.lastTickMs).toBe(plc.durationMs - TICK_MS);

    const simulation = new Simulation(built.value.netlist);
    const port = createSimulationIoPort(simulation);
    expect(port).toBeDefined();
    const coupling: PlcCoupling = createPlcCoupling(simulation, built.value.program, {});
    expect(coupling.runtime).toBeDefined();

    const replayed = runOperationsOn(simulation, plc.operations, {
      durationMs: plc.durationMs,
      beforeTick: coupling.beforeTick,
    });
    expect(replayed.lastTickMs).toBe(plc.durationMs - TICK_MS);
    const options: PlcCouplingOptions = {};
    const runOptions: PlcRunOptions = { durationMs: plc.durationMs, ...options };
    expect(runOptions.durationMs).toBe(plc.durationMs);
  });

  it('exposes the PLC static checks (plc-static-checks.js)', () => {
    expect(BOARD_POWER_PREFIXES).toContain('P.');
    const plc: PlcProblem = PlcProblemSchema.parse(plcProblemJson());
    const built = buildPlcReferenceSession(plc, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors, null, 2));
    const run = runPlcOperations(built.value.netlist, built.value.program, plc.operations, {
      durationMs: plc.durationMs,
    });
    const context: PlcCheckContext = {
      unit: built.value.unit,
      io: built.value.io,
    };
    const input: StaticCheckInput = {
      session: built.value.session,
      netlist: built.value.netlist,
      log: run.log,
      hazards: run.events.hazards(),
      chatters: run.events.chatters(),
      allowedColors: [PLC_WIRE_COLOR],
      plc: context,
    };
    expect(checkTwoStage(input).ok).toBe(true);
    expect(checkPlcPowerIndependent(input).ok).toBe(true);
    expect(checkIoAssignment(input).ok).toBe(true);
    expect(detectPlcWiring(buildNets(built.value.netlist), built.value.unit)).toBeDefined();
  });
});

/** `plcProblemJson().referenceLadder` を `LadderProgramData` として使う。 */
function simpleLadderJsonAsProgram(): LadderProgramData {
  const problem = plcProblemJson();
  return problem.referenceLadder as LadderProgramData;
}
