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
  DifficultySchema,
  MAX_PROBLEM_TAGS,
  PROBLEM_TAG_LABELS,
  PROBLEM_TAGS,
  ProblemTagSchema,
  type Difficulty,
  type ProblemTag,
} from './schema/difficulty.js';

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
  FAULT_KINDS,
  FaultKindSchema,
  FaultSpecSchema,
  FaultsSchema,
  FaultTargetSchema,
  isPartFaultKind,
  isRandomFaults,
  isWireFaultKind,
  LOAD_ELEMENT_INDEX,
  PART_FAULT_KINDS,
  PartFaultTargetSchema,
  RandomFaultsSchema,
  SOCKET_COIL_ELEMENT_INDEX,
  socketContactElementIndex,
  WIRE_FAULT_KINDS,
  WireFaultTargetSchema,
  type FaultSpecData,
  type FaultsData,
  type FaultTargetData,
  type RandomFaultsData,
} from './schema/faults.js';

export {
  CONTACT_TRUTHS,
  InspectPartSchema,
  InspectPartsProblemSchema,
  isContactTruth,
  PART_TRUTHS,
  PartTruthSchema,
  type InspectPartData,
  type InspectPartsProblem,
  type PartTruth,
} from './schema/inspect-parts.js';

export { InspectRepairProblemSchema, type InspectRepairProblem } from './schema/inspect-repair.js';

export {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  isPlcProblem,
  parseProblem,
  problemJsonSchema,
  ProblemSchema,
  toProblemIssues,
  type ParseProblemResult,
  type Problem,
  type ProblemFailureReason,
  type ProblemIssue,
  type SupportedProblem,
} from './schema/index.js';

export {
  CellSchema,
  DeviceCommentsSchema,
  DeviceKindSchema,
  DeviceSchema,
  LADDER_COIL_COL,
  LadderNetworkSchema,
  LadderProgramSchema,
  MAX_DEVICE_COMMENT_LENGTH,
  MAX_DEVICE_COMMENTS,
  type CellData,
  type DeviceCommentsData,
  type DeviceData,
  type LadderProgramData,
} from './schema/ladder.js';

export {
  DEFAULT_PLC_IO,
  MODEL_OF_VENDOR,
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
  SUPPORTED_PLC_MODELS,
  type PlcInputMapData,
  type PlcIoData,
  type PlcOutputMapData,
  type PlcProblem,
  type ResolvedPlcIo,
} from './schema/plc.js';

export { PLC_DEFAULT_STATIC_CHECKS, PlcJudgeSettingsSchema } from './schema/judge.js';

export {
  createPlcCoupling,
  createSimulationIoPort,
  runPlcOperations,
  type PlcCoupling,
  type PlcCouplingOptions,
  type PlcRunOptions,
  type PlcRunResult,
} from './plc-io.js';

export {
  buildPlcReferenceSession,
  PLC_WIRE_COLOR,
  plcBoardFor,
  plcWiringPlan,
  plcWiringPlanIssues,
  type PlcReferenceCircuit,
  type PlcReferenceResult,
  type PlcWireSpec,
} from './plc-reference.js';

export {
  BOARD_POWER_PREFIXES,
  checkIoAssignment,
  checkPlcPowerIndependent,
  checkTwoStage,
  detectPlcWiring,
  usedInputCommons,
  type PlcInputWiring,
} from './plc-static-checks.js';

// `StaticCheckInput` / `StaticCheckResult` は既に `./static-checks.js` 経由で公開されている。
// 重複させない
export type { PlcCheckContext } from './static-check-types.js';

export {
  judgePlc,
  judgePlcReference,
  plcTimerMarkers,
  type JudgePlcOutcome,
  type JudgePlcResult,
} from './judge-plc.js';

export { BUILTIN_PLC_PROBLEMS } from './builtin/index.js';

// `loadProblemsFromDir` / `mergeProblemSets`（`node:fs` を使う）はこのバレルに載せない。
// renderer（ブラウザ相当）がこのバレルの何か1つでも import すると ESM の評価順で
// `./loader.js` の `node:fs` import まで評価されてしまうため、main プロセス専用の
// `@ojt/content/loader` からのみ公開する（Task 1D1-b）。型だけは fs に触れないので、
// IPC の型付け（例: `apps/desktop/src/shared/ipc.ts`）のためにここでも公開する。
export { type ProblemLoadError, type ProblemSet } from './problem-set.js';

export {
  ASSEMBLE_WIRE_COLOR,
  buildReferenceSession,
  buildSchematicSession,
  toPhysicalOverride,
  toProblemPath,
  type ReferenceCircuit,
  type ReferenceResult,
  type SchematicProblem,
} from './reference.js';

export {
  powerUp,
  runOperations,
  runOperationsOn,
  createOperationPlayback,
  operationWindows,
  type OperationPlayback,
  type OperationWindow,
  type RunOptions,
  type RunResult,
} from './runner.js';

export {
  buildTimeChart,
  defaultChartSignals,
  formatSeconds,
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

export { hashSeed, mulberry32, pickIndex, pickOne } from './rng.js';

export {
  applyFaults,
  detailReview,
  FAULT_DETAILS,
  faultParam,
  injectPartFaults,
  matchesSite,
  reportKindOf,
  withoutPartFaults,
  type AppliedFaults,
  type ApplyFaultsResult,
  type DetailReview,
  type FaultDetail,
  type FaultReport,
  type FaultReportKind,
  type FaultSite,
} from './faults.js';

export {
  MAX_RANDOM_FAULT_ATTEMPTS,
  MAX_RANDOM_FAULT_MILLIS,
  RANDOM_FAULT_KINDS,
  resolveFaults,
  type ResolveFaultsOptions,
  type ResolveFaultsResult,
} from './random-faults.js';

export {
  findForbiddenPatterns,
  type ForbiddenPattern,
  type ForbiddenPatternKind,
} from './forbidden.js';

export {
  buildCheckCircuit,
  CHECK_COIL_MINUS,
  CHECK_COIL_PLUS,
  CHECK_PART_ID,
  CHECK_TIMER_PRESET_MS,
  checkContactTerminals,
  checkSettleMs,
  DIAGNOSIS_TABLE,
  diagnoseCheckReading,
  expectedCheckReading,
  faultGroupOf,
  LAYER_SHORT_JUDGE_RATIO,
  layerShortThresholdOhms,
  PART_TRUTH_LABELS,
  truthFault,
  type CheckCircuit,
  type CheckCircuitResult,
  type DiagnosisRow,
  type ExpectedCheckReading,
} from './inspect-parts.js';

export {
  addedWireIds,
  buildInspectRepairCircuit,
  INITIAL_WIRE_COLOR,
  modificationWireIds,
  repairNetlist,
  replacePart,
  REPAIR_WIRE_COLOR,
  type RepairCircuit,
  type RepairCircuitOptions,
  type RepairCircuitResult,
} from './inspect-repair.js';

export {
  buildHighlightIndex,
  cellIdsAtTerminal,
  cellIdsOfWire,
  highlightFor,
  type HighlightIndex,
  type HighlightTarget,
} from './highlight.js';

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
  countHazards,
  judgeAssemble,
  judgeReference,
  type HazardCounts,
  type JudgeAssembleResult,
  type JudgeOptions,
  type JudgeResult,
} from './judge.js';

export {
  judgeInspectParts,
  judgeInspectRepair,
  scoreReports,
  type InspectPartAnswer,
  type InspectPartScore,
  type InspectReportScore,
  type JudgeInspectPartsResult,
  type JudgeInspectRepairOutcome,
  type JudgeInspectRepairResult,
  type JudgeInspectResult,
} from './judge-inspect.js';

export {
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PROBLEMS,
  BuiltinProblemError,
  findBuiltinProblem,
  parseBuiltinProblems,
} from './builtin/index.js';

export {
  verifySchematic,
  type VerifyIssue,
  type VerifyOptions,
  type VerifyResult,
} from './verify.js';

export {
  MAX_WIRING_SUSPECTS,
  wiringSuspects,
  type SuspectKind,
  type WiringSuspect,
  type WiringSuspectReport,
} from './wiring-diff.js';

export { validateDefinition, type DefinitionValidation } from './definition-validation.js';
