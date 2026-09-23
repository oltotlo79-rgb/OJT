import { isMeasurementRecord, MEASUREMENT_LIMIT } from './diagnosis.js';
import { MAX_NETWORKS } from '@ojt/ladder-core';
import { FaultSpecSchema, PART_TRUTHS, parseProblem } from '@ojt/content';
import {
  isRecord,
  isSessionShape,
  finiteNonnegative,
  toSchematicDoc,
  toLadderProgram,
  MAX_RESTORED_WIRES,
} from './work-file-schema.js';
import { WORK_FILE_FORMAT_VERSION, type WorkFile } from './ipc.js';
import { MSG } from './messages.js';
const MAX_WORK_FILE_WIRES = MAX_RESTORED_WIRES;
const MAX_WORK_FILE_NETWORKS = MAX_NETWORKS;
const MAX_WORK_FILE_ENTRIES = 200;
const MAX_SCHEMATIC_OPEN_COUNT = 10_000;
const MAX_PROBE_TERMINAL_ID_LENGTH = 32;
function sanitizedTester(tester: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...tester };
  for (const key of ['black', 'red'] as const) {
    const value = tester[key];
    const ok =
      typeof value === 'string' && value.length > 0 && value.length <= MAX_PROBE_TERMINAL_ID_LENGTH;
    if (!ok) delete out[key];
  }
  return out;
}

/** 作業ファイルの検証。未知の `formatVersion` は読み込まない。§13 #8 */
export function parseWorkFile(
  raw: unknown,
): { ok: true; file: WorkFile } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: MSG.workFile.badShape };
  }
  const source = raw as Record<string, unknown>;
  const version = source['formatVersion'];
  // 正の整数でなければ「形式バージョンが無い」と同じ扱いにする（0・負数・NaN・小数を含む）
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: MSG.workFile.missingVersion };
  }
  if (version > WORK_FILE_FORMAT_VERSION) {
    return { ok: false, message: MSG.workFile.tooNew };
  }
  if (
    typeof source['problemId'] !== 'string' ||
    typeof source['session'] !== 'object' ||
    source['session'] === null
  ) {
    return { ok: false, message: MSG.workFile.missingFields };
  }
  // 共通スキーマで保存時も読込時も同じ構造上限を検証する。
  const wires = (source['session'] as Record<string, unknown>)['wires'];
  if (Array.isArray(wires) && wires.length > MAX_WORK_FILE_WIRES) {
    return { ok: false, message: MSG.workFile.tooManyWires };
  }
  // 省略可能項目は旧形式を受け入れ、存在する項目は置換前に検証する。
  if (!isSessionShape(source['session'])) return { ok: false, message: MSG.workFile.badShape };
  for (const key of ['elapsedMs', 'hazardCount'] as const) {
    if (source[key] !== undefined && !finiteNonnegative(source[key]))
      return { ok: false, message: MSG.workFile.badShape };
  }
  const optional: Partial<WorkFile> = {};
  const measurements = source['measurements'];
  if (measurements !== undefined) {
    if (
      !Array.isArray(measurements) ||
      measurements.length > MEASUREMENT_LIMIT ||
      !measurements.every(isMeasurementRecord)
    )
      return { ok: false, message: MSG.workFile.badShape };
    optional.measurements = measurements;
  }
  const notes = source['diagnosisNotes'];
  if (notes !== undefined) {
    if (
      !Array.isArray(notes) ||
      notes.length > MEASUREMENT_LIMIT ||
      !notes.every(
        (note: unknown) =>
          isRecord(note) &&
          ['id', 'target', 'prediction', 'conclusion'].every(
            (key) => typeof note[key] === 'string' && note[key].length <= 1000,
          ) &&
          Array.isArray(note['measurementIds']) &&
          note['measurementIds'].length <= MEASUREMENT_LIMIT &&
          note['measurementIds'].every((id: unknown) => typeof id === 'string'),
      )
    )
      return { ok: false, message: MSG.workFile.badShape };
    optional.diagnosisNotes = notes as NonNullable<WorkFile['diagnosisNotes']>;
  }
  const snapshot = source['problemSnapshot'];
  if (snapshot !== undefined) {
    const checked = parseProblem(snapshot);
    if (!checked.ok || checked.problem.id !== source['problemId'])
      return { ok: false, message: MSG.workFile.badShape };
    optional.problemSnapshot = checked.problem;
  }
  const learning = source['learningProgress'];
  if (learning !== undefined) {
    if (
      !isRecord(learning) ||
      !finiteNonnegative(learning['hintStage']) ||
      learning['hintStage'] > 3 ||
      !Number.isInteger(learning['hintStage']) ||
      !finiteNonnegative(learning['schematicOpenCount'])
    )
      return { ok: false, message: MSG.workFile.badShape };
    optional.learningProgress = {
      hintStage: learning['hintStage'],
      schematicOpenCount: learning['schematicOpenCount'],
    };
  }
  const watch = source['watchDevices'];
  if (watch !== undefined) {
    if (
      !Array.isArray(watch) ||
      watch.length > 16 ||
      !watch.every(
        (device: unknown) =>
          isRecord(device) &&
          ['input', 'output', 'internal', 'timer', 'counter', 'special'].includes(
            String(device['kind']),
          ) &&
          finiteNonnegative(device['index']) &&
          Number.isInteger(device['index']),
      )
    )
      return { ok: false, message: MSG.workFile.badShape };
    optional.watchDevices = watch as NonNullable<WorkFile['watchDevices']>;
  }
  const mode = source['mode'];
  if (mode !== undefined) {
    if (
      mode !== 'assemble' &&
      mode !== 'inspect-parts' &&
      mode !== 'inspect-repair' &&
      mode !== 'plc'
    ) {
      // 知らないモードは「読める形に見えて中身が別物」なので、黙って落とさず断る（§13 #8）
      return { ok: false, message: MSG.workFile.unknownMode };
    }
    optional.mode = mode;
  }
  if (typeof source['dialectId'] === 'string') optional.dialectId = source['dialectId'];
  if (typeof source['converted'] === 'boolean') optional.converted = source['converted'];
  // ラダーの上限と、セル・行・デバイスを共有IRスキーマで検証する。
  const ladder = source['ladder'];
  if (ladder !== undefined) {
    if (typeof ladder !== 'object' || ladder === null) {
      return { ok: false, message: MSG.workFile.badLadder };
    }
    const networks = (ladder as Record<string, unknown>)['networks'];
    if (!Array.isArray(networks)) return { ok: false, message: MSG.workFile.badLadder };
    if (networks.length > MAX_WORK_FILE_NETWORKS) {
      return { ok: false, message: MSG.workFile.tooManyNetworks };
    }
    if (toLadderProgram(ladder) === undefined)
      return { ok: false, message: MSG.workFile.badLadder };
    optional.ladder = ladder;
  }
  // 下書きは任意だが、存在するときは全体を検証し、破損を黙って捨てない。
  const schematic = source['schematic'];
  if (schematic !== undefined && toSchematicDoc(schematic) === undefined)
    return { ok: false, message: MSG.workFile.badShape };
  if (typeof schematic === 'object' && schematic !== null && !Array.isArray(schematic)) {
    optional.schematic = schematic;
  }
  if (typeof source['checkPartId'] === 'string') optional.checkPartId = source['checkPartId'];
  if (typeof source['faultSeed'] === 'number') optional.faultSeed = source['faultSeed'];
  /*
   * 回路図を開いた回数（§8.4）。負数・NaN・小数・桁違いは「無かった」ことにして戻す
   * （読込そのものは断らない。0以上の整数だけを、上限で切り詰めて受け入れる）。
   */
  const schematicOpenCount = source['schematicOpenCount'];
  if (
    typeof schematicOpenCount === 'number' &&
    Number.isInteger(schematicOpenCount) &&
    schematicOpenCount >= 0
  ) {
    optional.schematicOpenCount = Math.min(schematicOpenCount, MAX_SCHEMATIC_OPEN_COUNT);
  }
  if (
    typeof source['tester'] === 'object' &&
    source['tester'] !== null &&
    !Array.isArray(source['tester'])
  ) {
    optional.tester = sanitizedTester(source['tester'] as Record<string, unknown>);
  }
  for (const key of ['answers', 'reports', 'resolvedFaults', 'replacedPartIds'] as const) {
    const value = source[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) return { ok: false, message: MSG.workFile.badShape };
    if (value.length > MAX_WORK_FILE_ENTRIES) {
      return { ok: false, message: MSG.workFile.tooManyEntries };
    }
    const valid =
      key === 'resolvedFaults'
        ? value.every((v: unknown) => FaultSpecSchema.safeParse(v).success)
        : key === 'replacedPartIds'
          ? value.every((v: unknown) => typeof v === 'string')
          : key === 'answers'
            ? value.every(
                (v: unknown) =>
                  isRecord(v) &&
                  typeof v['partId'] === 'string' &&
                  (PART_TRUTHS as readonly unknown[]).includes(v['answer']),
              )
            : value.every(
                (v: unknown) =>
                  isRecord(v) &&
                  ['wire-open', 'wire-missing', 'wire-misrouted', 'part-defect'].includes(
                    String(v['kind']),
                  ) &&
                  isRecord(v['target']) &&
                  Object.values(v['target']).some((t) => typeof t === 'string'),
              );
    if (!valid) return { ok: false, message: MSG.workFile.badShape };
    optional[key] = value;
  }
  return {
    ok: true,
    file: {
      formatVersion: version,
      problemId: source['problemId'],
      session: source['session'],
      elapsedMs: typeof source['elapsedMs'] === 'number' ? source['elapsedMs'] : 0,
      hazardCount: typeof source['hazardCount'] === 'number' ? source['hazardCount'] : 0,
      savedAt: typeof source['savedAt'] === 'string' ? source['savedAt'] : '',
      ...optional,
    },
  };
}
