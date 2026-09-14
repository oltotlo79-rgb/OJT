import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JIPM_BOARD } from '@ojt/board-model';
import { Simulation, TICK_MS } from '@ojt/circuit-sim';
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
  UnsupportedProblemSchema,
  // loader.js
  loadProblemsFromDir,
  mergeProblemSets,
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
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_PROBLEMS,
  BuiltinProblemError,
  findBuiltinProblem,
  parseBuiltinProblems,
  type AssembleProblem,
  type JudgeSettings,
  type Operation,
  type ProblemHeader,
  type ReferenceCircuit,
  type StaticCheckInput,
  type JudgeResult,
  type TimeChart,
} from '../src/index.js';
import {
  forbiddenOneShotProblemJson,
  selfHoldProblemJson,
  TASK2_ROLES,
} from './helpers/problems.js';

/**
 * `@ojt/content` の公開API（`src/index.ts`）の疎通テスト。設計仕様 §17。
 * 各モジュールの再エクスポートが正しいシンボルを指していることを、バレルファイル
 * （`../src/index.js`）だけを import して確かめる。個々の挙動の網羅は各モジュールの
 * 専用テストが担うので、ここでは「存在し、公開APIとして噛み合わせて使える」ことを見る。
 */

/** 自己保持回路の課題（既定は selfHoldProblemJson）を模範回路まで組み立てる。 */
function buildFixtureReference(json: Record<string, unknown> = selfHoldProblemJson()): {
  problem: AssembleProblem;
  reference: ReferenceCircuit;
} {
  const parsed = parseProblem(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
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
    expect(UNSUPPORTED_MODES).toEqual(['inspect-parts', 'inspect-repair', 'plc']);
    expect(TimeLimitSchema.safeParse({ standardMin: 30, cutoffMin: 50 }).success).toBe(true);
    expect(SocketRoleSchema.safeParse('CR1').success).toBe(true);
    expect(SocketRolesSchema.safeParse(TASK2_ROLES).success).toBe(true);
    expect(toSocketRoles({ S1: 'CR1', S3: undefined, S7: 'CHK' })).toEqual({
      S1: 'CR1',
      S7: 'CHK',
    });
    expect(ExtraPartSchema.safeParse('BZ').success).toBe(true);
    expect(
      BoardRefSchema.safeParse({ boardId: 'board-jipm-std', socketRoles: TASK2_ROLES }).success,
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
      board: { boardId: 'board-jipm-std', socketRoles: TASK2_ROLES },
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
    const problem: AssembleProblem = ok.problem;
    expect(problem.id).toBe('x-001');
    expect(ProblemSchema.safeParse(selfHoldProblemJson()).success).toBe(true);
    expect(
      UnsupportedProblemSchema.safeParse({
        formatVersion: 1,
        id: 'p-001',
        title: 't',
        grade: 3,
        mode: 'plc',
        description: 'd',
        timeLimit: { standardMin: 30, cutoffMin: 50 },
        board: { boardId: 'board-jipm-std', socketRoles: TASK2_ROLES },
        inventory: [],
      }).success,
    ).toBe(true);

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
  it('reports a read error for a missing folder and merges builtin with user problems', () => {
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
    expect(toProblemPath(problem, 'sw-003')).toBe('schematic.sw-003');
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
