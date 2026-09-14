export {
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
  type BoardRef,
  type Grade,
  type InventoryItemData,
  type ProblemHeader,
  type ProblemMode,
  type SocketRolesData,
  type TimeLimit,
} from './schema/common.js';

export {
  CellKindSchema,
  hasExactTimerRange,
  RungEndSchema,
  RungSchema,
  SchematicCellSchema,
  SchematicDocumentSchema,
  toZodPath,
  type SchematicDocumentData,
} from './schema/schematic.js';

export {
  DurationMsSchema,
  lastOperationMs,
  OperationActionSchema,
  OperationListSchema,
  OperationSchema,
  OperationTargetSchema,
  pressedAt,
  type Operation,
  type OperationAction,
  type OperationTarget,
} from './schema/operations.js';

export {
  BOARD_OUTPUT_SIGNALS,
  DEFAULT_STATIC_CHECKS,
  defaultCompareSignals,
  JudgeSettingsSchema,
  resolveCompareSignals,
  STATIC_CHECK_IDS,
  StaticChecksSchema,
  ToleranceSchema,
  type JudgeSettings,
  type StaticCheckId,
  type StaticChecksData,
  type ToleranceData,
} from './schema/judge.js';

export {
  AssembleProblemSchema,
  HintsSchema,
  type AssembleProblem,
  type Hints,
} from './schema/assemble.js';

export {
  parseProblem,
  problemJsonSchema,
  ProblemSchema,
  toProblemIssues,
  UnsupportedProblemSchema,
  type ParseProblemResult,
  type Problem,
  type ProblemFailureReason,
  type ProblemIssue,
  type UnsupportedProblem,
} from './schema/index.js';

export {
  loadProblemsFromDir,
  mergeProblemSets,
  type ProblemLoadError,
  type ProblemSet,
} from './loader.js';

export {
  ASSEMBLE_WIRE_COLOR,
  buildReferenceSession,
  toPhysicalOverride,
  toProblemPath,
  type ReferenceCircuit,
  type ReferenceResult,
} from './reference.js';

export { powerUp, runOperations, type RunOptions, type RunResult } from './runner.js';

export {
  buildTimeChart,
  defaultChartSignals,
  OUTPUT_LABELS,
  PB_LABELS,
  startsAndEndsLow,
  timerMarkers,
  type TimeChart,
  type TimeChartMarker,
  type TimeChartSegment,
  type TimeChartSignal,
  type TimeChartSignalKind,
  type TimeChartSignalSpec,
} from './timechart.js';

export {
  checkCoilPolarity,
  checkForbiddenCircuit,
  checkPowerSequence,
  checkTerminalLimit,
  checkUnusedParts,
  checkWireColorRule,
  runStaticChecks,
  type StaticCheckInput,
  type StaticCheckResult,
} from './static-checks.js';

export {
  judgeAssemble,
  judgeReference,
  type HazardCounts,
  type JudgeAssembleResult,
  type JudgeOptions,
  type JudgeResult,
} from './judge.js';

export {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_PROBLEMS,
  BuiltinProblemError,
  findBuiltinProblem,
  parseBuiltinProblems,
} from './builtin/index.js';
