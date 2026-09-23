import { parseWorkFile } from '../../shared/work-file-codec.js';
import type { BoardSession } from '@ojt/board-model';
import {
  ANALOG_OHM_RANGES,
  createTesterState,
  type TerminalId,
  type TesterState,
} from '@ojt/circuit-sim';
import {
  isInspectPartsProblem,
  isInspectRepairProblem,
  isPlcProblem,
  PART_TRUTHS,
  FaultSpecSchema,
  parseProblem,
  replacePart,
  type FaultReport,
  type FaultReportKind,
  type FaultSpecData,
  type InspectPartAnswer,
  type SupportedProblem,
} from '@ojt/content';
import { IMPLEMENTED_DIALECT_IDS, isDialectId } from '@ojt/plc-dialects';
import { WORK_FILE_FORMAT_VERSION, type WorkFile } from '../../shared/ipc.js';
import { reasonOf } from '../app/errors.js';
import { ojtApi } from '../app/ojt-api.js';
import { createAppStore, useStore } from '../app/store.js';
import {
  isRecord,
  toSession,
  toSchematicDoc,
  toLadderProgram,
} from '../../shared/work-file-schema.js';
export {
  MAX_RESTORED_WIRES,
  MAX_RESTORED_RUNGS,
  MAX_RESTORED_NETWORKS,
  toSession,
  toSchematicDoc,
  toLadderProgram,
} from '../../shared/work-file-schema.js';
import { boardForProblem } from './plc-session.js';
import { plcForVendor } from './plc-skin.js';
import {
  JA,
  workFileProblemMissingText,
  workFileRestoredLog,
  workFileSavedText,
} from '../i18n/ja.js';
import { cloneSession } from './commands.js';
import { checkLoadFor } from './inspect-parts.js';
import { circuitForJudge } from './inspect-repair.js';
import { hasLadderContent } from './ladder.js';
import { bridge } from './worker-bridge.js';

/**
 * 作業ファイルの組み立てと復元。設計仕様 §12.3 / §13 #8。
 * 手動読込（セッション画面）と起動時の一時保存からの復帰（アプリ外枠）で共用する。
 */

/**
 * 現在の状態を作業ファイルの形にする。§12.3
 *
 * 保存しようとしている課題が**いまストアで開いている課題そのもの**なら、モード固有の状態
 * （テスター・解答・指摘・故障・交換）も一緒に載せる（{@link inspectFieldsFor}）。3つの
 * セッション画面はどれも「いま開いている課題・盤・経過時間」をそのまま渡してくるので、
 * 画面ごとに保存の呼び方を変えずに C1/C2 の作業ファイルが揃う。
 */
export function toWorkFile(
  problemId: string,
  session: BoardSession,
  elapsedMs: number,
  hazardCount: number,
): WorkFile {
  return {
    formatVersion: WORK_FILE_FORMAT_VERSION,
    problemId,
    session,
    elapsedMs,
    hazardCount,
    savedAt: new Date().toISOString(),
    ...inspectFieldsFor(problemId),
    ...(useStore.getState().problem?.id === problemId
      ? {
          problemSnapshot: useStore.getState().problem!,
          learningProgress: {
            hintStage: useStore.getState().hintStage,
            schematicOpenCount: useStore.getState().schematicOpenCount,
          },
          watchDevices: useStore.getState().watchDevices,
          measurements: useStore.getState().measurements,
          diagnosisNotes: useStore.getState().diagnosisNotes,
        }
      : {}),
  };
}

/**
 * いま開いている課題の作業ファイルを作る（自動保存と「作業を保存」の入口）。§12.3
 * 課題も盤も無ければ `undefined`（保存できる状態にない）。
 */
export function toInspectWorkFile(): WorkFile | undefined {
  const { problem, session, elapsedMs, hazards, replay } = useStore.getState();
  // 判定後の見直しを「未完了の作業」として復元対象へ戻さない。手動保存も同じ入口で止める。
  if (replay !== undefined || problem === undefined || session === undefined) return undefined;
  return toWorkFile(
    problem.id,
    session,
    elapsedMs,
    useStore.getState().restoredHazardCount +
      Math.max(useStore.getState().sessionHazardCount, hazards.length),
  );
}

/** プローブの端子IDとして受け入れる文字数の上限（main の検証と同じ値）。§12.3 */
export const MAX_PROBE_TERMINAL_ID_LENGTH = 32;

/**
 * 作業ファイルに載せるテスターのつまみとプローブ。§9.3 / §12.3
 *
 * `black` / `red` は探針を挿した端子ID（役割ベース、例: `CHK.13`）で、**任意**。以前は
 * 針の角度と一緒に「載せない」扱いにしていたが、復元直後に読み値が `----` のままになる
 * （§12.3 のギャップ）ため、いまは載せる。針の角度（`needleDeg`）は載せない
 * （`replayTesterToWorker()` が `place-probe` を送り直すと Worker 側が自然に追従するため）。
 */
interface SavedTester {
  kind: TesterState['kind'];
  mode: TesterState['mode'];
  voltRange: number;
  ohmRange: TesterState['ohmRange'];
  zeroAdjusted: boolean;
  black?: string;
  red?: string;
}

function savedTester(tester: TesterState): SavedTester {
  return {
    kind: tester.kind,
    mode: tester.mode,
    voltRange: tester.voltRange,
    ohmRange: tester.ohmRange,
    zeroAdjusted: tester.zeroAdjusted,
    ...(tester.black === undefined ? {} : { black: tester.black }),
    ...(tester.red === undefined ? {} : { red: tester.red }),
  };
}

/**
 * モードC2で良品に交換した部品のID。§9.2
 * 交換は `applied.partFaults` からその部品を落とすだけで盤は変わらないので、
 * 「最初に入っていた故障」と「いま残っている故障」の差から取り出す。
 */
function replacedPartIds(
  resolvedFaults: readonly FaultSpecData[],
  remaining: readonly FaultSpecData[],
): string[] {
  const left = new Set(
    remaining.flatMap((fault) => ('partId' in fault.target ? [fault.target.partId] : [])),
  );
  const out = new Set<string>();
  for (const fault of resolvedFaults) {
    if ('partId' in fault.target && !left.has(fault.target.partId)) out.add(fault.target.partId);
  }
  return [...out];
}

/** 作業ファイルのモード固有の部分（いまの課題と合うときだけ載せる）。§12.3 */
function inspectFieldsFor(problemId: string): Partial<WorkFile> {
  const state = useStore.getState();
  const problem = state.problem;
  if (problem === undefined || problem.id !== problemId) return {};
  if (isInspectPartsProblem(problem)) {
    return {
      mode: 'inspect-parts',
      tester: savedTester(state.tester),
      answers: [...state.answers],
      ...(state.checkPartId === undefined ? {} : { checkPartId: state.checkPartId }),
    };
  }
  if (isInspectRepairProblem(problem)) {
    const resolved = state.resolvedFaults ?? [];
    return {
      mode: 'inspect-repair',
      tester: savedTester(state.tester),
      reports: [...state.reports],
      ...(state.faultSeed === undefined ? {} : { faultSeed: state.faultSeed }),
      resolvedFaults: [...resolved],
      replacedPartIds:
        state.circuit === undefined
          ? []
          : replacedPartIds(resolved, state.circuit.applied.partFaults),
      // 回路図ヒントを開いた回数（§8.4）。2級以外は常に0だが、そのまま載せても害はない
      schematicOpenCount: state.schematicOpenCount,
    };
  }
  if (isPlcProblem(problem)) {
    return {
      mode: 'plc',
      tester: savedTester(state.tester),
      dialectId: state.dialectId,
      converted: state.converted,
      /*
       * ラダーとデバイスコメントは `LadderProgramData` と同じ形で残す（3A H-3）。
       * `ladder` が無いときは**キーごと省く**（Batch 4+5 レビュー M14）: 前は
       * `networks: []` を書いていたが、`toLadderProgram()` は空配列を「壊れている」として
       * 拒む（`networks.length === 0` は不可）ので、そのファイルは二度と読み込めなかった。
       */
      ...(state.ladder === undefined
        ? {}
        : {
            ladder: {
              networks: state.ladder.networks,
              ...(Object.keys(state.ladderComments).length === 0
                ? {}
                : { comments: { ...state.ladderComments } }),
            },
          }),
    };
  }
  /*
   * モードB（組立）。回路図エディタの下書きは**あるときだけ**載せる（決定表#23）。
   * 作りかけでも載せる（妥当性は検算だけが要求する。決定表#3）。§11.4 / Plan 5 Task 6
   */
  return {
    mode: 'assemble',
    tester: savedTester(state.tester),
    ...(state.schematicDoc === undefined ? {} : { schematic: state.schematicDoc }),
  };
}

// --- Plan 5 Task 6 ---
/** 保存時刻・経過時間を除いた永続作業全体を比較し、同じ課題への巻戻しも検出する。 */
export function persistentWorkKey(file: WorkFile): string {
  const content: Partial<WorkFile> = { ...file };
  delete content.savedAt;
  delete content.elapsedMs;
  return JSON.stringify(content);
}

let savedWorkKey: string | undefined;
export function markWorkSaved(file: WorkFile): void {
  savedWorkKey = persistentWorkKey(file);
}
export function needsDiscardConfirm(file: WorkFile): boolean {
  const current = toInspectWorkFile();
  if (current === undefined) return false;
  const key = persistentWorkKey(current);
  if (key === persistentWorkKey(file) || key === savedWorkKey) return false;
  const state = useStore.getState();
  return (
    state.session!.wires.some((w) => !w.locked) ||
    state.history.done.length > 0 ||
    state.answers.length > 0 ||
    state.reports.length > 0 ||
    state.measurements.length > 0 ||
    state.diagnosisNotes.length > 0 ||
    state.hintStage > 0 ||
    state.schematicOpenCount > 0 ||
    state.watchDevices.length > 0 ||
    state.schematicHistory.done.length > 0 ||
    (isPlcProblem(state.problem!) && hasLadderContent(state.ladder))
  );
}

/** 作業ファイルのモード固有の部分（読み手が受け取る形）。§12.3 */
export interface InspectWorkState {
  mode?: WorkFile['mode'];
  tester?: unknown;
  answers?: unknown;
  checkPartId?: string;
  reports?: unknown;
  faultSeed?: number;
  resolvedFaults?: unknown;
  replacedPartIds?: unknown;
  /** 回路図ヒントを開いた回数（モードC2の2級形式。§8.4）。 */
  schematicOpenCount?: number;
  /** モードDのラダーIR（`comments` を含む）。§12.3 / 3A H-3 */
  ladder?: unknown;
  /** モードDで使っている方言ID。§10.5 */
  dialectId?: string;
  /** 保存時点でラダーが変換を通っていたか。§10.6 */
  converted?: boolean;
  /** モードBの回路図エディタの下書き（`SchematicDocument` の形）。§11.4 / 決定表#23 */
  schematic?: unknown;
}

/** 復元できる並びの長さの上限（main の `MAX_WORK_FILE_ENTRIES` と同じ値）。§13 #8 */
export const MAX_RESTORED_ENTRIES = 200;

/**
 * プローブの端子IDとして読めるか（読めなければ「外れている」ものとして黙って無視する。§13 #8）。
 * 形式だけを見る（空でない・上限文字数以内の文字列）。**その端子がいまの盤に実在するか**は
 * ここでは見ない（保存後に課題や交換で端子が消えていることがあるため）。
 * `ProbeMarkers.scenePosOf()` と `readTester()`（`nets.hasTerminal()`）は、盤に無い端子IDを
 * 渡されても例外を投げずに「描かない」「測れない（OL/`----`）」へ落ちる作りなので、存在確認は
 * そちら側に任せ、ここでは壊れた／作為的な値（極端に長い文字列など）だけを弾く。
 */
function toProbeTerminal(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0 || value.length > MAX_PROBE_TERMINAL_ID_LENGTH) return undefined;
  return value;
}

/** 保存されたテスターのつまみとして読めるか（読めなければ既定のまま使う）。§13 #8 */
function toSavedTester(value: unknown): SavedTester | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value['kind'];
  const mode = value['mode'];
  const voltRange = value['voltRange'];
  const ohmRange = value['ohmRange'];
  if (kind !== 'digital' && kind !== 'analog') return undefined;
  if (mode !== 'off' && mode !== 'DCV' && mode !== 'ACV' && mode !== 'OHM' && mode !== 'CONT') {
    return undefined;
  }
  if (typeof voltRange !== 'number' || !Number.isFinite(voltRange) || voltRange <= 0) {
    return undefined;
  }
  if (
    typeof ohmRange !== 'number' ||
    !(ANALOG_OHM_RANGES as readonly number[]).includes(ohmRange)
  ) {
    return undefined;
  }
  const black = toProbeTerminal(value['black']);
  const red = toProbeTerminal(value['red']);
  return {
    kind,
    mode,
    voltRange,
    ohmRange: ohmRange as SavedTester['ohmRange'],
    zeroAdjusted: value['zeroAdjusted'] === true,
    ...(black === undefined ? {} : { black }),
    ...(red === undefined ? {} : { red }),
  };
}

/** 保存されたつまみとプローブを `TesterState` に戻す。§9.3 / §12.3 */
function testerStateFrom(saved: SavedTester): TesterState {
  return {
    ...createTesterState(saved.kind),
    mode: saved.mode,
    voltRange: saved.voltRange,
    ohmRange: saved.ohmRange,
    zeroAdjusted: saved.zeroAdjusted,
    black: saved.black as TerminalId | undefined,
    red: saved.red as TerminalId | undefined,
  };
}

/**
 * つまみとプローブの状態を Worker へ送り直す。§9.3 / §12.3 / Plan 2B I-3
 *
 * Worker 側の `tester` はストアとは別の複製（Task 3）で、`load` のたびにつまみ・レンジ・
 * 0Ω調整を保ったまま動き続ける（`sim.worker.ts` の `load()`）。それでも保存した作業ファイルは
 * **常にストア側の値で読み直す**ので、`load` のあとに毎回この4操作を送り直して Worker 側を
 * 同じ状態へ揃える。`set-kind` / `set-mode` / `set-volt-range` / `set-ohm-range` はどれも
 * `applyTesterAction()` で校正（`zeroAdjusted`）を落とすため、保存時に 0Ω調整済みだった場合は
 * 最後に `zero-adjust` を送って校正を復元する（Plan 2B レビュー B1）。
 *
 * プローブ（`place-probe`）は**必ずこの後**に送る（§12.3 のギャップ修正）。`set-*` はどれも
 * `applyTesterAction()` の `reset` でレンジ超過の発行済み記録を落とす副作用を持つだけでプローブ
 * 位置には触れないが、送る順序を「つまみ → プローブ」に固定しておけば、将来 `set-*` 側の実装が
 * 変わってプローブを外すようになっても、この関数を直すだけで済む。盤に無い端子を指していても
 * Worker は例外を投げず「測れない」状態になるだけなので、存在確認はせずにそのまま送る
 * （`toProbeTerminal()` / `ProbeMarkers.scenePosOf()` が黙って無視する側を担う）。
 */
export function replayTesterToWorker(tester: TesterState): void {
  bridge.send({ type: 'tester', action: { type: 'set-kind', kind: tester.kind } });
  bridge.send({ type: 'tester', action: { type: 'set-mode', mode: tester.mode } });
  bridge.send({ type: 'tester', action: { type: 'set-volt-range', range: tester.voltRange } });
  bridge.send({ type: 'tester', action: { type: 'set-ohm-range', range: tester.ohmRange } });
  if (tester.zeroAdjusted) {
    bridge.send({ type: 'tester', action: { type: 'zero-adjust' } });
  }
  if (tester.black !== undefined) {
    bridge.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: tester.black },
    });
  }
  if (tester.red !== undefined) {
    bridge.send({
      type: 'tester',
      action: { type: 'place-probe', probe: 'red', terminal: tester.red },
    });
  }
}

/** 故障1件として読めるか（`FaultSpecData` の形だけを見る）。§5.2 / §13 #8 */
function isFaultSpec(value: unknown): value is FaultSpecData {
  return FaultSpecSchema.safeParse(value).success;
}

/**
 * 保存された故障の並びを読む（1件でも壊れていたら復元しない）。§13 #8
 *
 * 空配列は**そのまま受け入れる**（Plan 2B レビュー M2）: ユーザーが作った課題では
 * `faults: []`（故障なし）のC2があり得るので、`resolvedFaults` が空でも「欠けている」
 * ことにはならない。「欠けている」のは `undefined` や配列でない場合だけ。
 */
function toFaultSpecs(value: unknown): readonly FaultSpecData[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length > MAX_RESTORED_ENTRIES) return undefined;
  return value.every(isFaultSpec) ? value : undefined;
}

/** 指摘1件として読めるか。§9.2 */
function isFaultReport(value: unknown): value is FaultReport {
  if (!isRecord(value)) return false;
  const kind = value['kind'];
  const kinds: readonly FaultReportKind[] = [
    'wire-open',
    'wire-missing',
    'wire-misrouted',
    'part-defect',
  ];
  if (typeof kind !== 'string' || !(kinds as readonly string[]).includes(kind)) return false;
  const target = value['target'];
  if (!isRecord(target)) return false;
  return (
    typeof target['wireId'] === 'string' ||
    typeof target['partId'] === 'string' ||
    typeof target['terminalId'] === 'string'
  );
}

/** マークシートの解答1件として読めるか（課題にある部品・表にある原因だけ）。§9.1 */
function isAnswerFor(value: unknown, partIds: ReadonlySet<string>): value is InspectPartAnswer {
  if (!isRecord(value)) return false;
  const partId = value['partId'];
  const answer = value['answer'];
  if (typeof partId !== 'string' || !partIds.has(partId)) return false;
  return typeof answer === 'string' && (PART_TRUTHS as readonly string[]).includes(answer);
}

/**
 * モード固有の状態を戻す。§12.3 / §13 #8
 *
 * 課題を開き直したうえで、テスター・解答・指摘・交換を載せる。戻せたら `true`、
 * 戻せなかったら `false`（呼び出し側は理由を出して読込そのものを断る）。
 * **黙って壊れた状態で開かない**ことを優先する。とくにC2は故障の在処（`applied`）が無いと
 * 「どこが故障か」を判定できないので、欠けていたら復元しない。
 *
 * C2は保存しておいた解決済みの故障をそのまま `openProblem()` へ渡し、`resolveFaults()` を
 * 呼び直させない（Plan 2A I-4）。種だけを保存して引き直すと、`random.seed` の無い課題は
 * 内部で `Date.now()` を使うため初回と別の故障になってしまう。
 */
export function restoreInspectState(
  problem: SupportedProblem,
  state: InspectWorkState,
  target = useStore,
): boolean {
  const store = target.getState();
  if (state.mode !== undefined && state.mode !== problem.mode) return false;

  if (isPlcProblem(problem)) {
    const parsed = toLadderProgram(state.ladder);
    // ラダーが読めない作業ファイルは**開かない**（黙って空のラダーで開くと作業を失う）。§13 #8
    if (state.ladder !== undefined && parsed === undefined) return false;
    /*
     * 保存されていた方言でそのまま開く（決定表#24）。`openProblem()` が方言 → 機種 → 盤の順に
     * 作り直すので、ここで渡さないと「ラダーは `0.00` 表記なのに盤の端子は `X0`」になる
     * （Batch 4+5 レビュー I5 の `setDialect()` は、機種の差し替えが `openProblem()` の中で
     * 起きるようになった今は後追いになってしまうので置き換える）。
     * 未実装・見覚えの無いIDは黙って無視する（読込そのものは断らない）。
     *
     * 無視したときのフォールバックは**既定メーカーではなく、この課題が保存された機種**
     * （`problem.plc.vendor`）にする（レビュー指摘 #3）。既定メーカーへ逃がすと、
     * 保存後に利用者が設定を変えているだけで機種が入れ替わり、作業ファイルの電線が
     * 参照する端子名がその新しい機種に無い名前になって `safeRoutes()` が黙って落としてしまう。
     * `problem.plc.vendor` は保存した盤がそのまま乗る機種なので、電線を必ず保つ。
     */
    const savedDialect =
      typeof state.dialectId === 'string' &&
      isDialectId(state.dialectId) &&
      IMPLEMENTED_DIALECT_IDS.includes(state.dialectId)
        ? state.dialectId
        : undefined;
    if (!store.openProblem(problem, { vendor: savedDialect ?? problem.plc.vendor })) {
      return false;
    }
    if (parsed !== undefined) store.restoreLadder(parsed.program, parsed.comments);
    const tester = toSavedTester(state.tester);
    if (tester !== undefined) store.setTester(testerStateFrom(tester));
    return true;
  }

  if (isInspectRepairProblem(problem)) {
    const resolvedFaults = toFaultSpecs(state.resolvedFaults);
    if (resolvedFaults === undefined) return false;
    const seed = state.faultSeed;
    const opened = store.openProblem(problem, {
      resolvedFaults,
      ...(typeof seed === 'number' && Number.isFinite(seed) ? { faultSeed: seed } : {}),
    });
    // 課題データの誤りで盤を作れなかった（理由は `openProblem()` がトーストに出している）
    if (!opened) return false;
  } else if (!store.openProblem(problem)) {
    return false;
  }

  const tester = toSavedTester(state.tester);
  if (tester !== undefined) store.setTester(testerStateFrom(tester));
  // 壊れたつまみは既定のまま開く（読込は断らない）が、黙って戻さないと誤解させる（M5）
  else if (state.tester !== undefined) store.toast(JA.session.badTesterBlock, 'error');

  if (isInspectPartsProblem(problem)) {
    const partIds = new Set(problem.parts.map((part) => part.id));
    if (Array.isArray(state.answers)) {
      for (const answer of state.answers.slice(0, MAX_RESTORED_ENTRIES)) {
        if (isAnswerFor(answer, partIds)) store.setAnswer(answer.partId, answer.answer);
      }
    }
    if (state.checkPartId !== undefined && partIds.has(state.checkPartId)) {
      store.setCheckPart(state.checkPartId);
    }
    return true;
  }

  if (isInspectRepairProblem(problem)) {
    /*
     * 交換した部品は盤に跡が残らない（`replacePart()` は `applied.partFaults` からその部品を
     * 落とすだけ）ので、保存した並びを同じ順で当て直す。`sites` は変わらないため、交換しても
     * 指摘しなければ合格しない（Plan 2A 意図的な差分 #7）。
     */
    if (Array.isArray(state.replacedPartIds)) {
      for (const partId of state.replacedPartIds.slice(0, MAX_RESTORED_ENTRIES)) {
        const circuit = target.getState().circuit;
        if (typeof partId !== 'string' || circuit === undefined) continue;
        store.setCircuit(replacePart(circuit, partId));
      }
    }
    if (Array.isArray(state.reports)) {
      for (const report of state.reports.slice(0, MAX_RESTORED_ENTRIES)) {
        if (isFaultReport(report)) store.addReport(report);
      }
    }
    /*
     * 回路図ヒントを開いた回数を戻す（§8.4）。保存データの数値は信用せず、
     * 0以上の有限な数だけを整数へ切り詰めて受け入れる（`restoreProgress()` と同じ流儀）。
     */
    const schematicOpenCount = state.schematicOpenCount;
    if (
      typeof schematicOpenCount === 'number' &&
      Number.isFinite(schematicOpenCount) &&
      schematicOpenCount >= 0
    ) {
      store.setSchematicOpenCount(Math.floor(schematicOpenCount));
    }
    return true;
  }

  /*
   * モードB: 回路図エディタの下書きを戻す（決定表#23）。形が違えば下書き無し（`openProblem()`
   * が入れた空の文書のまま）で開く。読込そのものは断らない（机上の下書きが読めないことを
   * 理由に盤の配線まで捨てさせない）。§11.4 / §13 #8
   */
  const draft = toSchematicDoc(state.schematic);
  if (draft !== undefined) store.setSchematicDoc(draft);
  /*
   * 形が違う下書き（段が {@link MAX_RESTORED_RUNGS} 本を超える・要素の形が壊れている）は
   * 捨てるが、**黙って捨てない**。描いたはずの図が消えて見えるので理由を伝える（レビュー Minor）。
   * 盤の配線はそのまま開く（机上の下書きが読めないことを理由に配線まで捨てさせない）。
   */
  if (draft === undefined && state.schematic !== undefined) {
    store.toast(JA.schematic.draftUnreadable, 'error');
  }
  return true;
}

/**
 * 復元した状態に合わせて「Worker に読ませる盤」と部品の故障を決める。§9.1 / §9.2
 *
 * - C1: 点検中の部品があれば**チェック用回路を組み直す**（保存した盤をそのまま載せると、
 *   ネットリスト変換のたびに入れ直す故障（§5.4）と盤が食い違う）。
 * - C2: 盤は保存したもの（白線の修復を含む）、故障は交換を反映したいまの回路のもの。
 */
function loadPayloadFor(
  problem: SupportedProblem,
  saved: BoardSession,
  target = useStore,
): { session: BoardSession; partFaults?: readonly FaultSpecData[]; plcModel?: string } {
  const state = target.getState();
  if (isInspectPartsProblem(problem)) {
    const partId = state.checkPartId;
    if (partId === undefined) return { session: state.session ?? saved };
    const loaded = checkLoadFor(problem, partId);
    if (loaded.ok) return { session: loaded.session, partFaults: loaded.partFaults };
    // 組めなければ「何も挿していない状態」から続ける（§13 #8）
    state.setCheckPart(undefined);
    return { session: state.session ?? saved };
  }
  if (isInspectRepairProblem(problem)) {
    const circuit = state.circuit;
    if (circuit === undefined) return { session: saved };
    return { session: saved, partFaults: circuit.applied.partFaults };
  }
  if (isPlcProblem(problem)) return { session: saved, plcModel: problem.plc.model };
  return { session: saved };
}

/**
 * 作業ファイルを画面に反映する。§12.3
 * 課題を読み直してからセッションを差し替え、Worker にも同じ盤を読ませる。
 * 経過時間と危険操作の回数も戻す（1D2-a のレビュー指摘: 復元しても 00:00.0 から数え直していた）。
 * preload が無い・課題や盤の状態が読めない場合はトーストで理由を出して `false` を返す
 * （§13 #5。呼び出し側は投げられることを気にしなくてよい）。
 *
 * `options.confirmed` が偽で、いまの作業を捨てることになる場合は適用せずに確認欄を出させる
 * （`App` が `pendingWorkFile` を見て「続行／取消」を尋ね、続行なら `confirmed: true` で呼び直す）。
 */
export async function applyWorkFile(
  file: WorkFile,
  options: { confirmed?: boolean } = {},
): Promise<boolean> {
  const store = useStore.getState();
  const checked = parseWorkFile(file);
  if (!checked.ok) {
    store.toast(checked.message, 'error');
    return false;
  }
  file = checked.file;
  if (options.confirmed !== true && needsDiscardConfirm(file)) {
    store.setPendingWorkFile(file);
    return false;
  }
  let api: ReturnType<typeof ojtApi>;
  try {
    api = ojtApi();
  } catch (error) {
    store.toast(reasonOf(error), 'error');
    return false;
  }
  let problem = await api.readProblem(file.problemId);
  if (file.problemSnapshot !== undefined) {
    const checked = parseProblem(file.problemSnapshot);
    if (!checked.ok || checked.problem.id !== file.problemId) {
      store.toast(JA.session.badSession, 'error');
      return false;
    }
    if (problem !== null && JSON.stringify(problem) !== JSON.stringify(checked.problem))
      store.toast('課題の定義が更新されています。保存時の課題条件で復元します。', 'info');
    problem = checked.problem;
  }
  if (problem !== null && isPlcProblem(problem) && file.dialectId !== undefined) {
    if (!isDialectId(file.dialectId) || !IMPLEMENTED_DIALECT_IDS.includes(file.dialectId)) {
      store.toast(
        '保存された表記には対応していないため、課題に記録された機種で復元します。',
        'info',
      );
      file = { ...file, dialectId: problem.plc.vendor };
    }
    const effective = plcForVendor(problem, file.dialectId as typeof problem.plc.vendor);
    if (effective === undefined) {
      store.toast(JA.session.badWorkFileMode, 'error');
      return false;
    }
    problem = effective;
  }
  if (problem === null) {
    store.toast(workFileProblemMissingText(file.problemId), 'error');
    return false;
  }
  const session = problem === null ? undefined : toSession(file.session, boardForProblem(problem));
  if (
    session === undefined ||
    (session.plcAssignment !== undefined && (!isPlcProblem(problem) || problem.io.mode !== 'free'))
  ) {
    store.toast(JA.session.badSession, 'error');
    return false;
  }
  /*
   * 課題を開き直し、モード固有の状態（テスター・解答・指摘・故障・交換）を戻す。
   * 戻せないファイル（モード違い・C2の故障欠け）は**開かずに**断る（§13 #8）。
   */
  if (
    (file.schematic !== undefined && toSchematicDoc(file.schematic) === undefined) ||
    (file.ladder !== undefined && toLadderProgram(file.ladder) === undefined)
  ) {
    store.toast(JA.session.badSession, 'error');
    return false;
  }
  const candidate = createAppStore();
  candidate.setState(
    Object.fromEntries(
      Object.entries(useStore.getState()).filter(([, value]) => typeof value !== 'function'),
    ),
  );
  if (!restoreInspectState(problem, file, candidate)) {
    store.toast(JA.session.badWorkFileMode, 'error');
    return false;
  }
  const payload = loadPayloadFor(problem, session, candidate);
  candidate.getState().setSession(cloneSession(payload.session));
  /*
   * C2は回路が持つ盤も復元後のものに差し替える。セッション画面は張り直しのたびに
   * `circuit.session` を Worker へ読ませるので、ここを開始時の盤のままにすると、
   * 画面の3D（訓練者の白線あり）と Worker の盤（白線なし）が食い違う。
   * `applied` / `initialWireIds` / `cells` は開始時のまま（`circuitForJudge()` と同じ差し替え）。
   */
  const restored = candidate.getState().circuit;
  if (isInspectRepairProblem(problem) && restored !== undefined) {
    candidate.getState().setCircuit(circuitForJudge(restored, cloneSession(payload.session)));
  }
  candidate.getState().restoreProgress(file.elapsedMs, file.hazardCount);
  if (file.learningProgress !== undefined) candidate.setState(file.learningProgress);
  candidate.setState({
    measurements: file.measurements ?? [],
    diagnosisNotes: file.diagnosisNotes ?? [],
  });
  if (file.watchDevices !== undefined) candidate.setState({ watchDevices: file.watchDevices });
  useStore.setState(
    Object.fromEntries(
      Object.entries(candidate.getState()).filter(([, value]) => typeof value !== 'function'),
    ),
  );
  bridge.send({
    type: 'load',
    problemId: problem.id,
    session: cloneSession(payload.session),
    ...(payload.partFaults === undefined ? {} : { partFaults: payload.partFaults }),
    ...(payload.plcModel === undefined
      ? {}
      : {
          plcModel: payload.plcModel,
          allowPlcForcing: isPlcProblem(problem) && problem.io.mode === 'free',
        }),
  });
  // つまみは `load` のあとに送り直す（`load` が Worker 側のテスターを既定へ戻すため）。I-3
  if (file.tester !== undefined) replayTesterToWorker(useStore.getState().tester);
  store.addLog(workFileRestoredLog(file.savedAt));
  const restoredFile = toInspectWorkFile();
  if (restoredFile !== undefined) markWorkSaved(restoredFile);
  return true;
}

/**
 * いまの作業を作業ファイルへ保存する（ツールバーの「保存」）。§12.3（指摘 UI-05）
 *
 * 4つのセッション画面が同じ20行を写していた。IPC が使えない（`ojtApi()` が投げる）場合も、
 * main が応答しない場合（指摘 LE-14: `.catch` が無く `unhandledrejection` から致命バナーに
 * 化けていた）も、ここで1行のトーストに落とす。
 */
export function saveCurrentWork(problemId: string, session: BoardSession): void {
  const store = useStore.getState();
  let api: ReturnType<typeof ojtApi>;
  try {
    api = ojtApi();
  } catch (error) {
    store.toast(reasonOf(error), 'error');
    return;
  }
  const file = toWorkFile(
    problemId,
    session,
    store.elapsedMs,
    store.restoredHazardCount + Math.max(store.sessionHazardCount, store.hazards.length),
  );
  void api
    .saveWorkFile({
      kind: 'manual',
      file,
    })
    .then((result) => {
      if (result.ok) markWorkSaved(file);
      store.toast(
        result.ok ? workFileSavedText(result.path) : result.message,
        result.ok ? 'info' : 'error',
      );
    })
    .catch((error: unknown) => {
      useStore.getState().toast(reasonOf(error), 'error');
    });
}

/**
 * 作業ファイルを選ばせて、いまの画面へ当てる（ツールバーの「読込」）。§12.3（指摘 UI-05）
 *
 * 取り消し（`canceled`）は失敗ではないので何も出さない。読み込んだ中身を当てる
 * `applyWorkFile()` も約束を返すので、こちらにも受け皿を付ける（指摘 LE-14）。
 */
export function loadWorkFileAndApply(): void {
  let api: ReturnType<typeof ojtApi>;
  try {
    api = ojtApi();
  } catch (error) {
    useStore.getState().toast(reasonOf(error), 'error');
    return;
  }
  void api
    .loadWorkFile({ kind: 'manual' })
    .then((result) => {
      if (!result.ok) {
        if (!result.canceled) useStore.getState().toast(result.message, 'error');
        return;
      }
      void applyWorkFile(result.file).catch((error: unknown) => {
        useStore.getState().toast(reasonOf(error), 'error');
      });
    })
    .catch((error: unknown) => {
      useStore.getState().toast(reasonOf(error), 'error');
    });
}
