import {
  createSession,
  JIPM_BOARD,
  plcUnitFor,
  type BoardSession,
  type SocketId,
} from '@ojt/board-model';
import {
  applyTesterAction,
  createTesterState,
  partId,
  type ChatterEvent,
  type HazardEvent,
  type TerminalId,
  type TesterAction,
  type TesterState,
  type WireColor,
} from '@ojt/circuit-sim';
import {
  buildInspectRepairCircuit,
  defaultChartSignals,
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  isPlcProblem,
  REPAIR_WIRE_COLOR,
  resolveCompareSignals,
  resolveFaults,
  toSocketRoles,
  type FaultReport,
  type FaultSpecData,
  type InspectPartAnswer,
  type InspectPartsProblem,
  type JudgeInspectResult,
  type JudgePlcResult,
  type JudgeResult,
  type PartTruth,
  type RepairCircuit,
  type SupportedProblem,
  type TimeChartSignalSpec,
  type VerifyResult,
} from '@ojt/content';
import { COIL_COL, type LadderProgram } from '@ojt/ladder-core';
import {
  getDialect,
  IMPLEMENTED_DIALECT_IDS,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  isDialectId,
  type DialectId,
} from '@ojt/plc-dialects';
// --- Plan 5 Task 6 ---
import {
  applyEdit,
  editLabel,
  emptySchematic,
  type SchematicDocument,
  type SchematicEdit,
} from '@ojt/schematic-core';
// --- /Plan 5 Task 6 ---
import { create } from 'zustand';
import { DEFAULT_SETTINGS, type ProblemListPayload, type WorkFile } from '../../shared/ipc.js';
import type { SimSnapshot } from '../../worker/protocol.js';
import { droppedTicksLog, JA, referenceErrorText } from '../i18n/ja.js';
import {
  cloneSession,
  emptyHistory,
  pushCommand,
  type CommandHistory,
  type SessionCommand,
} from '../session/commands.js';
import type { ToolMode } from '../session/interaction.js';
import {
  emptyLadderHistory,
  initialLadder,
  pushLadder,
  redoLadder,
  undoLadder,
  type LadderCursor,
  type LadderEditorMode,
  type LadderHistory,
} from '../session/ladder.js';
import { boardForProblem } from '../session/plc-session.js';
import { plcForVendor, plcUnitForVendor } from '../session/plc-skin.js';
// --- Plan 5 Task 6 ---
import {
  clampCursor,
  cursorAfterEdit,
  emptySchematicHistory,
  issueText,
  pushSchematic,
  redoSchematic,
  undoSchematic,
  type EditorCursor,
  type SchematicHistory,
} from '../session/schematic-edit.js';
// --- /Plan 5 Task 6 ---
import { nextProbeAfter } from '../session/tester.js';
import {
  NO_CONVERT_ISSUES,
  NO_HIGHLIGHT,
  type CameraPreset,
  type ConvertIssues,
  type HazardBanner,
  type HighlightSelection,
  type ListMode,
  type LogLine,
  type PendingReport,
  type PlcMonitorSnapshot,
  type ProbeSide,
  type Route,
  type Toast,
} from './store-types.js';

/**
 * 画面状態。設計仕様 §12.1。
 *
 * 状態管理に **zustand** を選ぶ理由:
 * worker のスナップショットは約30fpsで届き、3Dシーン・タイムチャート・ログの
 * 3箇所が別々の一部分だけを見る。`useReducer` ＋ Context だと1スナップショットごとに
 * 配下が丸ごと再描画されるが、zustand はセレクタ単位で購読でき「ランプの色だけ」を
 * 見ている 3Dシーンがログの増加で再描画されない。さらに worker ブリッジは React の外に
 * いるため、Provider を介さず `useStore.getState()` で読み書きできる点も噛み合う。
 * 依存は 3KB 程度で、§15 の性能目標（内蔵GPUで60fps）に対する影響が小さい。
 */

export {
  NO_CONVERT_ISSUES,
  NO_HIGHLIGHT,
  type CameraPreset,
  type ConvertErrorLine,
  type ConvertIssues,
  type ConvertWarningLine,
  type HazardBanner,
  type HighlightSelection,
  type ListMode,
  type LogLine,
  type PendingReport,
  type PlcMonitorSnapshot,
  type ProbeSide,
  type Route,
  type Toast,
} from './store-types.js';

/** 空のスナップショット（課題を開く前の表示用）。 */
export const EMPTY_SNAPSHOT: SimSnapshot = {
  tMs: 0,
  breakerOn: false,
  switchOn: false,
  powered: false,
  tripped: false,
  sourceAmps: 0,
  buttons: {},
  lamps: {},
  relays: {},
  timers: {},
  logDelta: [],
  hazardDelta: [],
  chatterDelta: [],
  tester: {
    kind: 'digital',
    mode: 'off',
    value: Number.NaN,
    display: 'OFF',
    targetDeg: 0,
    needleDeg: 0,
    overRange: false,
    live: false,
    conductive: false,
  },
  droppedTicks: 0,
};

/** トーストを自動で消すまでの時間[ms]。§8.2 */
export const TOAST_TTL_MS = 4000;

/** 同時に出すトーストの上限（超えたら古いものから捨てる）。§8.2 */
export const TOAST_LIMIT = 5;

/** 操作ログに残す行数の上限。§8.1 */
export const LOG_LIMIT = 200;

/**
 * 例外バナーの「セッションをリセット」を続けて何回試したら盤そのものを作り直すか。§13 #5
 *
 * `restartSession()` は作業保持を優先して盤を残すが、盤の中身（保存データ由来の壊れた電線など）
 * が原因で落ちている場合は何度押しても同じ例外で落ちる（レビュー指摘: 詰み）。
 * 2回目からは課題から盤を作り直し、それでも駄目なら「課題一覧へ戻る」で抜けられるようにする。
 */
export const RESTART_FALLBACK_ATTEMPTS = 2;

/**
 * 級ごとの回路図ヒントの扱い。設計仕様 §8.4。
 * 3級は常時表示（開閉させない）、2級は開閉可で初期は閉じる、1級は出さない。
 */
export function schematicPolicy(grade: 1 | 2 | 3): { shown: boolean; toggleable: boolean } {
  if (grade === 3) return { shown: true, toggleable: false };
  if (grade === 2) return { shown: false, toggleable: true };
  return { shown: false, toggleable: false };
}

/** 警告バナーを自動で畳むまでの時間[ms]。§5.6 */
export const HAZARD_BANNER_TTL_MS = 6000;

/** デバイスコメント1件の長さの上限（`@ojt/content` の `MAX_DEVICE_COMMENT_LENGTH` と同じ値）。§10.7 */
export const DEVICE_COMMENT_LIMIT = 32;

/** デバイスコメントの件数の上限（`@ojt/content` の `MAX_DEVICE_COMMENTS` と同じ値）。§10.7 */
export const DEVICE_COMMENT_COUNT_LIMIT = 200;

/** 画面の分割。決定表#10 */
export type LadderViewMode = 'ladder' | 'split' | 'board';

// --- Plan 5 Task 7 ---
/** モードBのビュー（盤／並べて／回路図）。§11.4 / Plan 5 決定表#1 */
export type AssembleViewMode = 'board' | 'split' | 'schematic';

/**
 * ビューを1つ進める順（盤 → 並べて → 回路図 → 盤）。`F2` の巡回に使う。
 * モードDの `ladderView` と同じ並び（3Dだけ → 両方 → 図だけ）にしてある。§11.4
 */
export const ASSEMBLE_VIEW_ORDER: readonly AssembleViewMode[] = ['board', 'split', 'schematic'];

/** いまのビューの次（`F2` を1回押したときの行き先）。 */
export function nextAssembleView(view: AssembleViewMode): AssembleViewMode {
  const index = ASSEMBLE_VIEW_ORDER.indexOf(view);
  return ASSEMBLE_VIEW_ORDER[(index + 1) % ASSEMBLE_VIEW_ORDER.length] ?? 'board';
}
// --- /Plan 5 Task 7 ---

/** 判定結果（モードB／C1／C2／D）。§8.3 / §9.1 / §9.2 / §10.8 */
export type AnyJudgeResult = JudgeResult | JudgeInspectResult | JudgePlcResult;

/**
 * 点検系（C1/C2）の判定結果か。§9.1 / §9.2
 *
 * 4モードとも `mode` を持つ（Plan 2A I-3 ＋ 3A）。モードDが増えた以上「組立でなければ点検」は
 * 成り立たない（`Result.tsx` が C1/C2 の画面にモードDの結果を流し込んでしまう）ので、
 * **明示の2値判定**にする。
 */
export function isInspectJudge(result: AnyJudgeResult): result is JudgeInspectResult {
  return result.mode === 'inspect-parts' || result.mode === 'inspect-repair';
}

/** モードDの判定結果か。§10.8 */
export function isPlcJudge(result: AnyJudgeResult): result is JudgePlcResult {
  return result.mode === 'plc';
}

/**
 * モードC1の初期盤。§9.1
 * チェック用ソケット（`S7` = `CHK`）の既設配線3本だけが載った盤で、部品はまだ挿さっていない。
 * 訓練者は配線しないので線色パレットは空、在庫も空にする（トレイの中身は課題の `parts` が決める。
 * Plan 2A 意図的な差分 #13）。
 */
export function checkSessionFor(problem: InspectPartsProblem): BoardSession {
  return createSession(JIPM_BOARD, {
    roles: toSocketRoles(problem.board.socketRoles),
    allowedColors: [],
    extraParts: [],
    inventory: [],
  });
}

/**
 * 課題を開くときの上書き。§8.3
 * 「もう一度」（{@link AppState.resetSession}）が**同じ故障のまま**盤を作り直すときだけ使う。
 * 省略すると C2 の故障は毎回引き直される（＝新しい課題として開く）。
 */
export interface OpenProblemOptions {
  /** モードC2の故障（解決済み）。渡すと `resolveFaults()` を呼び直さない（Plan 2A I-4）。 */
  resolvedFaults?: readonly FaultSpecData[] | undefined;
  /** モードC2の故障の種（記録用）。渡すと `Date.now()` を引き直さない。§5.2 */
  faultSeed?: number | undefined;
  /**
   * モードDで「もう一度」を押したときにラダーを残す（Batch 4+5 レビュー I4）。
   * 盤・履歴・危険操作は今までどおり作り直すが、ラダー・デバイスコメント・方言は保ち、
   * `converted` だけ `false` に落とす（また変換を通させる。§10.6 H-1）。
   * モードD以外の課題では無視される。
   */
  keepLadder?: boolean | undefined;
  /**
   * この方言（＝機種）で開く。§10.5 / 決定表#24
   * 省くとストアの `defaultVendor`（設定画面の既定メーカー）を使う。作業ファイルの復元だけが
   * 保存されていた方言を渡す（`work-file.ts`）。
   */
  vendor?: DialectId | undefined;
}

/** ストアの形。 */
export interface AppState {
  route: Route;
  problems: ProblemListPayload | undefined;
  /** 課題一覧の絞り込み（ホームで選んだモード。`undefined` は「すべて」）。§12.1 */
  listMode: ListMode;
  problem: SupportedProblem | undefined;
  session: BoardSession | undefined;
  history: CommandHistory;
  /**
   * 同じ課題のまま「やり直す」たびに増える世代番号。§13 #5 / §13 #6
   * セッション画面の Worker 起動は `[problemId, sessionEpoch]` で張り直すので、
   * 同じ課題を開き直したときにも `load` が送り直される。
   */
  sessionEpoch: number;
  /**
   * 最後に画面を描けてから「セッションをリセット」を続けて押した回数。§13 #5
   * `ErrorBoundary` が子を描けたら 0 に戻る。{@link RESTART_FALLBACK_ATTEMPTS} 回目で盤を作り直す。
   */
  restartAttempts: number;
  /**
   * 確認待ちの作業ファイル。§12.3
   * いまの作業を捨てて別の課題の作業ファイルを開いてよいかを外枠（`App`）が尋ねる間だけ入る。
   * `window.confirm()` は Electron ではメインスレッドを止めてしまうので、自前の小さな確認欄にする。
   */
  pendingWorkFile: WorkFile | undefined;
  /** テスターの状態（つまみ・レンジ・プローブ・0Ω調整）。Worker と同じリデューサで動かす。§9.3 */
  tester: TesterState;
  /** 次に置くプローブ（黒 → 赤 の順に巡る）。§9.3 */
  nextProbe: ProbeSide;
  /** 画面上部に出している危険操作の警告（期限切れで畳む）。§5.6 / §13 */
  hazardBanner: HazardBanner | undefined;
  /** モードC1のマークシートの解答。§9.1 */
  answers: InspectPartAnswer[];
  /** モードC1でいまチェック用ソケットに挿している部品のID。§9.1 */
  checkPartId: string | undefined;
  /** モードC2の指摘一覧。§9.2 */
  reports: FaultReport[];
  /** モードC2の故障入り初期盤（判定にそのまま渡す）。§9.2 */
  circuit: RepairCircuit | undefined;
  /**
   * モードC2の故障の種。§5.2
   * 起動時に決め（課題が持たなければ `Date.now()`）、作業ファイルへ残す。復元は種からの
   * 再抽選ではなく `resolvedFaults`（解決済みの故障そのもの）を使うので、判定には使わない
   * デバッグ用の記録である（Plan 2A I-4）。
   */
  faultSeed: number | undefined;
  /**
   * いま盤に入っているモードC2の故障（解決済みの明示リスト）。§5.2 / §9.2
   * `resolveFaults()` を通したあとの**そのもの**で、「もう一度」（{@link AppState.resetSession}）が
   * 同じ故障のまま盤を作り直すのに使う。種を持たない課題は `resolveFaults()` が内部で
   * `Date.now()` を使うため、種からは再現できない（Plan 2A I-4）。
   */
  resolvedFaults: readonly FaultSpecData[] | undefined;
  /** 3Dで選んだ直後の指摘の対象（種別を選ぶ前）。§9.2 */
  pendingReport: PendingReport | undefined;
  /** 回路図 ⇄ 3D盤の連動ハイライト。§9.2 */
  highlight: HighlightSelection;

  // --- Plan 5 Task 6 ---
  /** 回路図エディタの下書き（モードBの課題を開くと空の文書で始まる）。§11.4 */
  schematicDoc: SchematicDocument | undefined;
  /** 下書きの元に戻す／やり直し。§11.4 */
  schematicHistory: SchematicHistory;
  /** 編集カーソル。§11.4 */
  schematicCursor: EditorCursor;
  /** 検算の往復中か。§11.4 */
  verifying: boolean;
  /** 直近の検算の結果（課題を開き直すと消える）。§11.4 */
  verifyResult: VerifyResult | undefined;
  /**
   * いま走っている検算が見ている文書（走っていなければ undefined）。§11.4 / レビュー I2
   *
   * 検算は Worker との往復なので、待っているあいだにも図は直せる。何も目印を持たないと
   * 「直したあとの図」に「直す前の図の結果」が出てしまうので、依頼のときの文書そのものを
   * 控えておき、結果が届いたときに**いまの文書と同じものか**を見る（編集は必ず新しい
   * 文書を作るので、参照の同一性でそのまま判別できる）。
   */
  verifyingDoc: SchematicDocument | undefined;
  // --- /Plan 5 Task 6 ---

  /** 訓練者のラダー（モードDのみ）。§10.3 */
  ladder: LadderProgram | undefined;
  /** デバイスコメント（キーは `deviceLabel()` の形）。§10.7 */
  ladderComments: Record<string, string>;
  /** ラダー専用の取り消しスタック（盤の `history` とは別。決定表#2） */
  ladderHistory: LadderHistory;
  /** セルカーソル。§10.7 */
  ladderCursor: LadderCursor;
  /** 書込み／読出し／モニタ。§10.6 */
  ladderMode: LadderEditorMode;
  /** ラダーエディタにフォーカスがあるか（キーの宛先を決める。決定表#3） */
  ladderFocused: boolean;
  /** 画面の分割。決定表#10 */
  ladderView: LadderViewMode;
  // --- Plan 5 Task 7 ---
  /**
   * モードBのビュー（盤／並べて／回路図）。§11.4 / Plan 5 決定表#1
   * モードDの `ladderView` と同じ役割で、値の並びも同じ順（盤 → 並べて → 図）。
   */
  assembleView: AssembleViewMode;
  // --- /Plan 5 Task 7 ---
  /** セル入力が挿入か上書きか（`Ins` で切り替える）。決定表#12b */
  insertMode: 'insert' | 'overwrite';
  /** `Shift+F3`（モニタ書込み）の注記トーストを既に出したか。決定表#11 */
  monitorWriteNoticeShown: boolean;
  /** いま使っている方言（Phase 3 は常に `mitsubishi`）。§10.5 */
  dialectId: DialectId;
  /**
   * 設定画面の既定メーカー。§12.1 / 決定表#24
   * **課題を開くときの初期値**であって、いまのセッションの方言（`dialectId`）ではない。
   * 設定を保存するたびに `dialectId` を上書きすると、作業ファイルから復元した方言や
   * 表記切替で選んだ方言がセッションの途中で戻ってしまう（前提#31b）。
   */
  defaultVendor: DialectId;
  /** ラダーの表示列数（設定画面。§10.6） */
  ladderGridCols: number;
  /** モニタ中の通電色（設定画面。§10.6） */
  monitorColor: string;
  /** 最後の編集のあと「変換」を通したか。§10.6 / 3A H-1 */
  converted: boolean;
  /** 出力ウィンドウの中身。§10.6 */
  convertIssues: ConvertIssues;
  /** モニタ中の通電状況（モニタでないときは undefined）。決定表#5 */
  plcMonitor: PlcMonitorSnapshot | undefined;
  /** PLCが RUN 中か。§10.6 */
  plcRunning: boolean;

  mode: ToolMode;
  wireColor: WireColor;
  pendingTerminal: TerminalId | undefined;
  hoveredTerminal: TerminalId | undefined;
  selectedWire: string | undefined;
  selectedSocket: SocketId | undefined;
  camera: CameraPreset;
  /**
   * `setCamera()` を呼ぶたびに増える番号。§12.2
   *
   * プリセットは3つしかないので、盤をドラッグで回したあとに**いま選ばれているのと同じ**
   * ボタン（例: 正面）を押し直しても `camera` の値は変わらず、`CameraPresets` の効果が
   * 張り直されないため視点が戻らなかった。「押したこと」自体を状態として持たせ、
   * 同じプリセットでも必ず再適用されるようにする。
   */
  cameraNonce: number;
  schematicVisible: boolean;
  /**
   * 回路図ヒントを開いた回数（モードB／C2の2級形式で共用。§8.4 2026-09-18の決定）。
   * `toggleSchematic()` が**閉→開**の遷移だけを数える（開いたまま連打しても増えない）。
   * 3級（常時表示・開閉不可）や1級（非表示）は `toggleSchematic()` を呼べる導線が無いので
   * 常に 0 のまま。結果画面に出し、C2の作業ファイルへ持たせる。
   */
  schematicOpenCount: number;
  /** 判定を Worker へ送って結果待ちか（ツールバーの「判定」を二重に押させない）。§8.2 */
  judging: boolean;

  snapshot: SimSnapshot;
  hazards: HazardEvent[];
  chatters: ChatterEvent[];
  /** ライブのタイムチャートに並べる信号。§7.7 */
  chartSpecs: TimeChartSignalSpec[];
  /** ライブのタイムチャート用の遷移点（信号名 → 変化点の列）。§8.2 */
  liveTransitions: Record<string, Array<{ tMs: number; value: boolean }>>;
  logLines: LogLine[];
  toasts: Toast[];
  startedAtMs: number;
  elapsedMs: number;
  /**
   * 作業ファイルから復元した危険操作の回数。§5.6 / §8.3
   *
   * Worker は復元時にネットリストを作り直すので、保存前に数えた危険操作はエンジン側には残らない。
   * 判定結果（`JudgeResult.hazardCount`）は**今回の分だけ**を数えるため、画面に出す合計は
   * 「今回の分 ＋ ここに復元した分」とする（下部の警告一覧と結果画面の危険操作の見出し）。
   */
  restoredHazardCount: number;
  judge: AnyJudgeResult | undefined;
  fatalError: string | undefined;
  /** WebGL コンテキストが失われ再初期化中か。§13 #4 */
  webglLost: boolean;
  /** 既に操作ログへ出した「捨てた tick」の累計。§5.2 */
  reportedDroppedTicks: number;
  /**
   * 直前に出した「tick を省略しました」通知（連続する間はここへ積算し、行を増やさず書き換える）。
   * 間に別のログが挟まれば（＝操作ログの最後の行がこの `logId` でなくなれば）次の通知は新しい行にする。§5.2
   */
  droppedTicksNotice: { logId: number; ticks: number; occurrences: number } | undefined;

  setRoute: (route: Route) => void;
  setProblems: (payload: ProblemListPayload) => void;
  /** 課題一覧の絞り込みを変える。§12.1 */
  setListMode: (mode: ListMode) => void;
  /**
   * 課題を開く。盤を作れなかった（課題データの誤り）ときは `false` を返し、画面も状態も動かさない。
   * §13 #2
   */
  openProblem: (problem: SupportedProblem, options?: OpenProblemOptions) => boolean;
  setSession: (session: BoardSession) => void;
  pushHistory: (command: SessionCommand) => void;
  setHistory: (history: CommandHistory) => void;
  setMode: (mode: ToolMode) => void;
  setWireColor: (color: WireColor) => void;
  setPending: (terminal: TerminalId | undefined) => void;
  setHovered: (terminal: TerminalId | undefined) => void;
  setSelectedWire: (wireId: string | undefined) => void;
  setSelectedSocket: (socketId: SocketId | undefined) => void;
  setCamera: (preset: CameraPreset) => void;
  toggleSchematic: () => void;
  /** 回路図ヒントを開いた回数をまるごと差し替える（作業ファイルからの復元。§12.3）。 */
  setSchematicOpenCount: (count: number) => void;
  setJudging: (judging: boolean) => void;
  applySnapshot: (snapshot: SimSnapshot) => void;
  clearLive: () => void;
  addLog: (text: string) => void;
  /** 追従ループが捨てた tick を1行だけ操作ログに残す（累計の増分ぶん）。§5.2 */
  noteDroppedTicks: (total: number) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  /** 期限の切れたトーストを落とす（`App` の間引きタイマから呼ぶ）。§8.2 */
  expireToasts: (nowMs?: number) => void;
  /**
   * 判定結果を入れる。3モード共通（C1/C2 は `JudgeInspectResult`）。§8.3 / §9.1 / §9.2
   * 保持する `judge` が `AnyJudgeResult` なので、入口も同じ広さにしておく（Plan 2B Task 10）。
   */
  setJudge: (result: AnyJudgeResult | undefined) => void;
  setFatalError: (message: string | undefined) => void;
  setWebglLost: (lost: boolean) => void;
  tickElapsed: () => void;
  /** 作業ファイルから経過時間と危険操作回数を戻す（`startedAtMs` も巻き戻す）。§12.3 */
  restoreProgress: (elapsedMs: number, hazardCount: number) => void;
  /** 確認待ちの作業ファイルを出し入れする。§12.3 */
  setPendingWorkFile: (file: WorkFile | undefined) => void;
  /** テスターを操作する（Worker へ送るのは呼び出し側の責務）。§9.3 */
  applyTester: (action: TesterAction) => void;
  /**
   * テスターの状態をまるごと差し替える（作業ファイルからの復元）。§12.3
   * Worker 側のテスターは別の複製なので、送り直すのは呼び出し側の責務
   * （`session/work-file.ts` が `load` の**あと**に4つの操作を送る）。
   */
  setTester: (tester: TesterState) => void;
  /** 次に置くプローブを選ぶ。§9.3 */
  setNextProbe: (probe: ProbeSide) => void;
  /**
   * プローブを両方外して「次は黒」に戻す。§9.1 / §9.3
   * 盤を作り直したとき（C1の部品の挿し替え）に、Worker 側の `load` と足並みを揃えるために使う。
   */
  clearProbes: () => void;
  /** 警告バナーを畳む。§5.6 */
  dismissHazard: (nowMs?: number) => void;
  /** マークシートの解答を1件入れる（同じ部品は上書き）。§9.1 */
  setAnswer: (partId: string, answer: PartTruth) => void;
  /** チェック用ソケットに挿している部品を記録する。§9.1 */
  setCheckPart: (partId: string | undefined) => void;
  /** 指摘を1件足す。§9.2 */
  addReport: (report: FaultReport) => void;
  /** 指摘を1件取り消す。§9.2 */
  removeReport: (index: number) => void;
  /** モードC2の回路を差し替える（部品交換のとき）。§9.2 */
  setCircuit: (circuit: RepairCircuit) => void;
  /** 指摘の対象を選んだ（種別ポップオーバーを出す）。§9.2 */
  setPendingReport: (target: PendingReport | undefined) => void;
  /** 連動ハイライトを設定する。§9.2 */
  setHighlight: (selection: HighlightSelection) => void;
  // --- Plan 5 Task 6 ---
  /** 下書きをまるごと差し替える（作業ファイルからの復元）。§11.4 / §12.3 */
  setSchematicDoc: (doc: SchematicDocument) => void;
  /** 編集を1つ当てる。断られたら理由をトーストに出して `false` を返す。§11.4 */
  applySchematicEdit: (edit: SchematicEdit) => boolean;
  /** 編集カーソルを動かす。§11.4 */
  setSchematicCursor: (cursor: EditorCursor) => void;
  /** 下書きを1手戻す（戻せたら `true`）。§11.4 */
  undoSchematicEdit: () => boolean;
  /** 下書きを1手やり直す（やり直せたら `true`）。§11.4 */
  redoSchematicEdit: () => boolean;
  /** 検算の往復を始める・終える。§11.4 */
  setVerifying: (verifying: boolean) => void;
  /** 検算の結果を入れる（往復も終わる）。古い文書あての結果は捨てる。§11.4 / レビュー I2 */
  setVerifyResult: (result: VerifyResult | undefined) => void;
  /** 描いた回路図をすべて消す（空の1段に戻す。確認は画面側）。§11.4 */
  clearSchematic: () => boolean;
  // --- /Plan 5 Task 6 ---
  /** ラダーを差し替える（前の状態を履歴に積み、変換済みフラグを落とす）。§10.6 */
  setLadder: (program: LadderProgram) => void;
  /** ラダーを履歴を積まずに差し替える（作業ファイルからの復元）。§12.3 */
  restoreLadder: (program: LadderProgram, comments?: Record<string, string>) => void;
  /** セルカーソルを動かす。 */
  setLadderCursor: (cursor: LadderCursor) => void;
  /** 書込み／読出し／モニタを切り替える。§10.6 */
  setLadderMode: (mode: LadderEditorMode) => void;
  /** ラダーエディタのフォーカス。決定表#3 */
  setLadderFocused: (focused: boolean) => void;
  /** 画面の分割。決定表#10 */
  setLadderView: (view: LadderViewMode) => void;
  // --- Plan 5 Task 7 ---
  /** モードBのビューを切り替える。§11.4 / Plan 5 決定表#1 */
  setAssembleView: (view: AssembleViewMode) => void;
  // --- /Plan 5 Task 7 ---
  /** 挿入・上書きを切り替える（`Ins`）。切り替えた**後**の値を返す。決定表#12b */
  toggleInsert: () => 'insert' | 'overwrite';
  /** `Shift+F3` の注記トーストを「出した」と記録する（初回だけ true を返す）。決定表#11 */
  markMonitorWriteNotice: () => boolean;
  /**
   * デバイスコメントを1件入れる（空文字で削除、32文字で切り詰め、200件まで）。§10.7
   * 件数の上限（`DEVICE_COMMENT_COUNT_LIMIT`）に達していて新規のデバイスなら入れずに
   * `false` を返す（呼び出し側がトーストを出す。レビュー指摘 M4）。
   */
  setDeviceComment: (device: string, text: string) => boolean;
  /** 「変換」の結果を入れる。§10.6 */
  setConverted: (converted: boolean, issues: ConvertIssues) => void;
  /** モニタのスナップショット。決定表#5 */
  setPlcMonitor: (monitor: PlcMonitorSnapshot | undefined) => void;
  /** RUN/STOP。§10.6 */
  setPlcRunning: (running: boolean) => void;
  /** 設定画面の値をラダーへ反映する。§12.1 */
  applyLadderSettings: (settings: {
    gridCols: number;
    monitorColor: string;
    vendor: string;
  }) => void;
  /**
   * 方言（メーカー）だけを差し替える。§10.5
   * 作業ファイルの復元専用（`applyLadderSettings()` と違い、グリッド幅やモニタ色には触れない）。
   * 実装済みかどうかの確認は呼び出し側（`work-file.ts`）が済ませてから呼ぶ。Batch 4+5 レビュー I5
   */
  setDialect: (dialectId: DialectId) => void;
  // --- Plan 4B Task 8 ---
  /**
   * 表記（メーカー）を切り替える。§10.7 / 決定表#12
   * 方言と課題の機種を差し替え、盤と履歴を作り直す。**ラダーとデバイスコメントと取り消し
   * スタックは持ち越す**（IRは書き換えないので、戻せる手もそのまま生きる。4A H-2 / 決定表#11）。
   * 機種が変わると端子名が変わるので、配線だけは残せない（盤に無い端子を指す電線ができる）。
   */
  switchDialect: (dialectId: DialectId) => void;
  // --- /Plan 4B Task 8 ---
  /** ラダーを1手戻す（戻せたら true）。決定表#2 */
  undoLadderEdit: () => boolean;
  /** ラダーを1手やり直す（やり直せたら true）。決定表#2 */
  redoLadderEdit: () => boolean;
  /** 画面を描けた（`ErrorBoundary` から）。連続リセットの数え直し。§13 #5 */
  noteRenderSuccess: () => void;
  /**
   * 同じ課題を頭からやり直す（結果画面の「もう一度」）。盤も履歴も作り直す。§8.3
   * 世代番号を進めるので、同じ課題でもセッション画面が Worker に `load` を送り直す。
   */
  resetSession: () => void;
  /**
   * 例外バナーからの復帰。§13 #5「作業保持の原則」
   * 盤（`session`）と操作履歴は**残したまま**、ライブ記録・判定結果・エラー表示だけを捨てて
   * 世代番号を進める。セッション画面はそれを見て Worker を立て直し、いまの盤を `load` し直す。
   *
   * ただし {@link RESTART_FALLBACK_ATTEMPTS} 回続けて押されたときは、盤そのものが描けない
   * 状態だと判断して課題から作り直す（レビュー指摘: 壊れた盤だと何度押しても同じ例外で落ちる）。
   */
  restartSession: () => void;
  /**
   * 課題を捨てて一覧へ戻る。§13 #5
   * 「セッションをリセット」でも抜け出せないときの最後の逃げ道（例外バナーの2つ目のボタン）。
   */
  abandonSession: () => void;
}

let sequence = 0;
function nextId(): number {
  sequence += 1;
  return sequence;
}

/**
 * 課題から盤セッションを作る。§7.1 / §8.1（モードBの新規配線は青のみ）
 *
 * 3モードに共通のヘッダ（`board` / `inventory`）だけを見るので `SupportedProblem` を受ける。
 * ただし作るのは**素の盤**（青の新規配線・故障なし）なので、C1は `checkSessionFor()`、
 * C2は `buildInspectRepairCircuit()` が作る盤を使う（`openProblem()` の分岐）。ここへ C1/C2 が
 * 来るのは `restartSession()` の最後の手段（盤そのものが描けないときの作り直し）だけで、
 * そのときは故障入りの回路も一緒に手放している（§13 #5）。
 */
export function sessionForProblem(problem: SupportedProblem): BoardSession {
  /*
   * モードDは机上のPLC本体と壁コンセントを持つ派生盤で作る（3A 引渡し表）。`id` は同じなので
   * `boardId` の照合も作業ファイルの読み戻しもそのまま通る。モードB/C1/C2 では
   * `boardForProblem()` が `JIPM_BOARD` をそのまま返すので挙動は変わらない。
   */
  return createSession(boardForProblem(problem), {
    roles: toSocketRoles(problem.board.socketRoles),
    allowedColors: ['青'],
    extraParts: (problem.board.extraParts ?? []).map((name) => partId(name)),
    inventory: problem.inventory,
  });
}

/** モードDの状態の初期値（課題を開く・離れるときに必ずここへ戻す）。 */
function plcFields(
  problem?: SupportedProblem,
): Pick<
  AppState,
  | 'ladder'
  | 'ladderComments'
  | 'ladderHistory'
  | 'ladderCursor'
  | 'ladderMode'
  | 'ladderFocused'
  | 'ladderView'
  | 'insertMode'
  | 'monitorWriteNoticeShown'
  | 'converted'
  | 'convertIssues'
  | 'plcMonitor'
  | 'plcRunning'
> {
  const isPlc = problem !== undefined && isPlcProblem(problem);
  return {
    // モードD以外では `undefined`（3Dだけの画面がラダーを持たない）
    ladder: isPlc ? initialLadder() : undefined,
    ladderComments: {},
    ladderHistory: emptyLadderHistory(),
    ladderCursor: { networkId: 'n1', row: 0, col: 0 },
    ladderMode: 'write',
    ladderFocused: false,
    ladderView: 'split',
    insertMode: 'overwrite',
    monitorWriteNoticeShown: false,
    converted: false,
    convertIssues: NO_CONVERT_ISSUES,
    plcMonitor: undefined,
    plcRunning: false,
  };
}

// --- Plan 5 Task 6 ---
/**
 * 回路図エディタの状態の初期値（課題を開く・課題を離れるときに必ずここへ戻す）。§11.4
 *
 * `plcFields()` と同じ流儀で1箇所にまとめる。同じ5項目を呼び出し側で書き写すと、
 * どれか1箇所を直し忘れたときに課題をまたいで下書きが残る（MERGE 注意 #2）。
 * モードB以外は下書きを持たない（3Dだけの画面が回路図を持たないのと同じ）。
 * 下書きは**空の文書**で始める（決定表#2: 課題の模範回路は絶対に入れない）。
 */
function schematicFields(
  problem?: SupportedProblem,
): Pick<
  AppState,
  | 'schematicDoc'
  | 'schematicHistory'
  | 'schematicCursor'
  | 'verifying'
  | 'verifyResult'
  | 'verifyingDoc'
> {
  return {
    schematicDoc:
      problem !== undefined && isAssembleProblem(problem)
        ? emptySchematic(`draft-${problem.id}`, `${problem.title}（下書き）`)
        : undefined,
    schematicHistory: emptySchematicHistory(),
    schematicCursor: { rungId: 'r1', index: 0 },
    verifying: false,
    verifyResult: undefined,
    verifyingDoc: undefined,
  };
}

/**
 * 図が変わったときの検算まわりの巻き戻し。§11.4 / 決定表#6 / レビュー I2
 *
 * 前の結果を捨て、「検算中…」を下ろす。**依頼の宛先（`verifyingDoc`）は残す**：走っている
 * 検算の結果が後から届いたときに、`setVerifyResult()` が「いまの図と違う＝古い」と見抜くのに
 * 要る（直したあとの図に、直す前の図の判定を出さない）。
 */
function staleVerify(): Pick<AppState, 'verifying' | 'verifyResult'> {
  return { verifying: false, verifyResult: undefined };
}

/** 検算の往復だけを下ろす（前の結果は残す）。Worker が落ちたときと、古い結果を捨てるとき。 */
function staleVerifying(): Pick<AppState, 'verifying' | 'verifyingDoc'> {
  return { verifying: false, verifyingDoc: undefined };
}
// --- /Plan 5 Task 6 ---

/** アプリ全体のストア。 */
export const useStore = create<AppState>((set, get) => ({
  route: 'home',
  problems: undefined,
  listMode: undefined,
  problem: undefined,
  session: undefined,
  history: emptyHistory(),
  sessionEpoch: 0,
  restartAttempts: 0,
  pendingWorkFile: undefined,
  tester: createTesterState(),
  nextProbe: 'black',
  hazardBanner: undefined,
  answers: [],
  checkPartId: undefined,
  reports: [],
  circuit: undefined,
  faultSeed: undefined,
  resolvedFaults: undefined,
  pendingReport: undefined,
  highlight: NO_HIGHLIGHT,
  ...schematicFields(),
  // モードBは必ず盤から始まる（Plan 5 Task 7 / 決定表#1）
  assembleView: 'board',

  ...plcFields(),
  dialectId: 'mitsubishi',
  defaultVendor: DEFAULT_SETTINGS.defaultVendor,
  ladderGridCols: DEFAULT_SETTINGS.ladderGridCols,
  monitorColor: DEFAULT_SETTINGS.monitorColor,

  mode: 'wire',
  wireColor: '青',
  pendingTerminal: undefined,
  hoveredTerminal: undefined,
  selectedWire: undefined,
  selectedSocket: undefined,
  camera: 'front',
  cameraNonce: 0,
  schematicVisible: false,
  schematicOpenCount: 0,
  judging: false,

  snapshot: EMPTY_SNAPSHOT,
  hazards: [],
  chatters: [],
  chartSpecs: [],
  liveTransitions: {},
  logLines: [],
  toasts: [],
  startedAtMs: 0,
  elapsedMs: 0,
  restoredHazardCount: 0,
  judge: undefined,
  fatalError: undefined,
  webglLost: false,
  reportedDroppedTicks: 0,
  droppedTicksNotice: undefined,

  setRoute: (route) => {
    set({ route });
  },
  setProblems: (problems) => {
    set({ problems });
  },
  setListMode: (listMode) => {
    set({ listMode });
  },
  openProblem: (problem, options = {}) => {
    /*
     * モードごとに違うのは「初期の盤」「線色パレット」「回路図ヒントの初期状態」の3つだけ。
     * それ以外（ライブ記録・ログ・計時・履歴の初期化）は3モードで共通なので、
     * 先に盤を作れるか確かめてから1回の `set()` でまとめて入れる。
     *
     * C2は故障を注入した盤を作る（`buildInspectRepairCircuit`。Plan 2A）。課題データの誤りで
     * 作れないことがあるので、その場合は**画面を移らずに**理由を出す（§13 #2）。
     */
    /*
     * モードDは**既定メーカーの機種**で開く（決定表#9）。内蔵8題は `mitsubishi` / `FX5U` だが、
     * 4A Task 14 が「`plc` だけ差し替えれば4機種すべてで成立する」ことを確かめているので、
     * ここで差し替えれば課題JSONを1文字も変えずに CP1E・TOYOPUC・JW300 の課題になる。
     * 差し替えた課題がそのまま盤・Worker・判定・作業ファイルへ流れるので、3Dの端子名と
     * ラダーのデバイス名が食い違わない（4A H-1）。
     *
     * **方言（`dialectId`）を決めるのはここだけ**である（決定表#24）。設定を保存するたびに
     * 上書きすると、復元した方言や表記切替で選んだ方言がセッションの途中で戻る（前提#31b）。
     */
    let vendor = options.vendor ?? get().defaultVendor;
    if (isPlcProblem(problem)) {
      const swapped = plcForVendor(problem, vendor);
      if (swapped === undefined) {
        // 割付がその機種に収まらない（CP1E の出力は12点。決定表#10）。元の機種のまま開く
        // レビュー指摘 #9: 生のID（機種コード・メーカーID）ではなく表示名を出す
        // （`PlcSession.tsx` の `plc-model` 表示と同じ流儀）
        const wantedModel = plcUnitForVendor(vendor)?.model ?? vendor;
        const wanted = plcUnitFor(wantedModel)?.displayName ?? wantedModel;
        const used = plcUnitFor(problem.plc.model)?.displayName ?? problem.plc.model;
        get().toast(JA.plc.modelNotUsable(wanted, used), 'error');
        vendor = problem.plc.vendor;
      } else {
        problem = swapped;
      }
    }
    let session: BoardSession;
    let circuit: RepairCircuit | undefined;
    let faultSeed: number | undefined;
    let resolvedFaults: readonly FaultSpecData[] | undefined;
    let wireColor: WireColor = '青';
    let schematicVisible = false;
    if (isInspectRepairProblem(problem)) {
      /*
       * ランダム故障の課題は起動時に種を決め、あとで作業ファイルへ残す（§5.2）。
       * 明示 `faults` 配列の課題（内蔵C2 8題）には使われない（`resolveFaults()` が無視する）。
       *
       * 故障は**ここで一度だけ**解決し、解決済みリストをストアへ残す（`resolvedFaults`）。
       * 「もう一度」は種ではなくこのリストから盤を作り直すので、種を持たない課題
       * （`resolveFaults()` が内部で `Date.now()` を使う）でも同じ故障で再挑戦できる（2A I-4）。
       */
      faultSeed = options.faultSeed ?? Date.now();
      let faults = options.resolvedFaults;
      if (faults === undefined) {
        const drawn = resolveFaults(problem, JIPM_BOARD, { seed: faultSeed });
        if (!drawn.ok) {
          get().toast(
            referenceErrorText(drawn.errors.map((e) => `${e.path}: ${e.message}`)),
            'error',
          );
          return false;
        }
        faults = drawn.value;
      }
      const built = buildInspectRepairCircuit(problem, JIPM_BOARD, { resolvedFaults: faults });
      if (!built.ok) {
        get().toast(
          referenceErrorText(built.errors.map((e) => `${e.path}: ${e.message}`)),
          'error',
        );
        return false;
      }
      resolvedFaults = faults;
      circuit = built.value;
      /*
       * `session`（訓練者が触る盤）を `circuit.session` と同じオブジェクトのまま渡すと、
       * 盤の操作が `circuit.session` も書き換えてしまう（レビュー指摘 M8。2A ハンドオフ
       * 注記 M-12 が「書き換わる」前提で回避していた挙動そのもの）。複製して切り離す。
       */
      session = cloneSession(built.value.session);
      wireColor = REPAIR_WIRE_COLOR;
      /*
       * C2の回路図ヒントは級で決まる（§9.2 / §8.4 2026-09-18の決定）。`hints.schematicVisible`
       * は「2級形式か」を表すだけの旗（バリデーションで grade===2 と常に一致する）で、
       * 初期表示は決めない。2級は**開閉できて初期は閉じる**、1級はそもそも出さない
       * （`schematicPolicy()` はモードBと同じ規則。C2に3級は無いので shown は常に false）。
       */
      schematicVisible = schematicPolicy(problem.grade).shown;
    } else if (isInspectPartsProblem(problem)) {
      // C1は配線しないので線色パレットは空（`checkSessionFor()` が決める）。§9.1
      session = checkSessionFor(problem);
    } else {
      session = sessionForProblem(problem);
      // 回路図ヒントの出し方は級だけで決まる（§8.4）
      schematicVisible = schematicPolicy(problem.grade).shown;
    }
    /*
     * モードDの「もう一度」はラダーを残す（Batch 4+5 レビュー I4）。`plcFields()` が書き込む
     * 前のいまの値をここで捕まえておく（下の `set()` で上書きされてしまうため）。
     */
    const keepLadder = options.keepLadder === true && isPlcProblem(problem);
    const previousLadder = keepLadder ? get().ladder : undefined;
    const previousLadderComments = keepLadder ? get().ladderComments : undefined;
    set({
      problem,
      session,
      circuit,
      history: emptyHistory(),
      route: 'session',
      // 配線する2モード（B と D）は電線ツール、点検系（C1/C2）はテスターから始める
      mode: isAssembleProblem(problem) || isPlcProblem(problem) ? 'wire' : 'tester',
      wireColor,
      pendingTerminal: undefined,
      hoveredTerminal: undefined,
      selectedWire: undefined,
      selectedSocket: undefined,
      snapshot: EMPTY_SNAPSHOT,
      hazards: [],
      chatters: [],
      // C1は波形を比べないのでライブチャートも要らない。モードBとC2は同じ式で信号を決める
      chartSpecs: isInspectPartsProblem(problem)
        ? []
        : defaultChartSignals(resolveCompareSignals(problem.judge, problem.board.extraParts ?? [])),
      liveTransitions: {},
      logLines: [],
      judge: undefined,
      judging: false,
      fatalError: undefined,
      webglLost: false,
      reportedDroppedTicks: 0,
      droppedTicksNotice: undefined,
      schematicVisible,
      schematicOpenCount: 0,
      startedAtMs: Date.now(),
      elapsedMs: 0,
      restoredHazardCount: 0,
      restartAttempts: 0,
      pendingWorkFile: undefined,
      tester: createTesterState(get().tester.kind),
      nextProbe: 'black',
      hazardBanner: undefined,
      answers: [],
      checkPartId: undefined,
      reports: [],
      faultSeed,
      resolvedFaults,
      pendingReport: undefined,
      highlight: NO_HIGHLIGHT,
      // 回路図エディタの下書きは課題ごとに作り直す（モードB以外は持たない）。§11.4
      ...schematicFields(problem),
      // 課題を開いたら必ず盤から始める（Plan 5 Task 7 / 決定表#1）
      assembleView: 'board' as const,
      /*
       * 視点は課題を開くたびに既定へ戻す（UXレビュー #2）。モードDは「盤＋PLC」視点
       * （決定表#6。机上のPLC本体と壁コンセントは既存の7プリセットのどれにも入らない）、
       * それ以外は正面。前の課題（特にモードD）の視点を持ち越すと、配線の相手が
       * 最初から画面の外にいることがある。`cameraNonce` も進めて必ず適用させる。
       */
      camera: isPlcProblem(problem) ? ('plc' as const) : ('front' as const),
      cameraNonce: get().cameraNonce + 1,
      ...plcFields(problem),
      // 方言を決めるのはこの1箇所だけ（決定表#24）。モードD以外でも入れてよい
      dialectId: vendor,
      ...(keepLadder && previousLadder !== undefined
        ? { ladder: previousLadder, ladderComments: previousLadderComments ?? {} }
        : {}),
    });
    return true;
  },
  setSession: (session) => {
    set({ session });
  },
  pushHistory: (command) => {
    // 上限と「やり直し列を捨てる」規則の持ち主は `commands.ts` の1箇所だけにする（§8.2）
    set({ history: pushCommand(get().history, command) });
  },
  setHistory: (history) => {
    set({ history });
  },
  setMode: (mode) => {
    set({ mode, pendingTerminal: undefined, selectedWire: undefined });
  },
  setWireColor: (wireColor) => {
    set({ wireColor });
  },
  setPending: (pendingTerminal) => {
    set({ pendingTerminal });
  },
  setHovered: (hoveredTerminal) => {
    set({ hoveredTerminal });
  },
  setSelectedWire: (selectedWire) => {
    set({
      selectedWire:
        selectedWire === undefined || selectedWire.length === 0 ? undefined : selectedWire,
    });
  },
  setSelectedSocket: (selectedSocket) => {
    set({ selectedSocket });
  },
  setCamera: (camera) => {
    // プリセットが同じでも番号は必ず進める（同じボタンを押し直したら視点を組み直す）。§12.2
    set({ camera, cameraNonce: get().cameraNonce + 1 });
  },
  toggleSchematic: () => {
    const opening = !get().schematicVisible;
    // 開いた回数は**閉→開**の遷移だけを数える（閉じる操作や既に開いた状態は増やさない）。§8.4
    set({
      schematicVisible: opening,
      ...(opening ? { schematicOpenCount: get().schematicOpenCount + 1 } : {}),
    });
  },
  setSchematicOpenCount: (schematicOpenCount) => {
    set({ schematicOpenCount });
  },
  setJudging: (judging) => {
    set({ judging });
  },
  applySnapshot: (snapshot) => {
    const state = get();
    const names = new Set(state.chartSpecs.map((spec) => spec.name));
    let liveTransitions = state.liveTransitions;
    for (const entry of snapshot.logDelta) {
      if (!names.has(entry.signal) || typeof entry.value !== 'boolean') continue;
      if (liveTransitions === state.liveTransitions) liveTransitions = { ...liveTransitions };
      const points = liveTransitions[entry.signal] ?? [];
      liveTransitions[entry.signal] = [...points, { tMs: entry.tMs, value: entry.value }];
    }
    const lastHazard = snapshot.hazardDelta.at(-1);
    set({
      snapshot,
      liveTransitions,
      hazards:
        snapshot.hazardDelta.length === 0
          ? state.hazards
          : [...state.hazards, ...snapshot.hazardDelta],
      chatters:
        snapshot.chatterDelta.length === 0
          ? state.chatters
          : [...state.chatters, ...snapshot.chatterDelta],
      // 危険操作は帯で知らせる（§5.6 / §13）。同じtickに複数出たら最後の1件を出す
      ...(lastHazard === undefined
        ? {}
        : {
            hazardBanner: {
              kind: lastHazard.kind,
              detail: lastHazard.detail,
              expiresAt: Date.now() + HAZARD_BANNER_TTL_MS,
            },
          }),
    });
    if (snapshot.droppedTicks > 0) get().noteDroppedTicks(snapshot.droppedTicks);
  },
  clearLive: () => {
    set({
      snapshot: EMPTY_SNAPSHOT,
      liveTransitions: {},
      hazards: [],
      chatters: [],
      reportedDroppedTicks: 0,
      droppedTicksNotice: undefined,
    });
  },
  addLog: (text) => {
    const lines = [...get().logLines, { id: nextId(), text }];
    set({ logLines: lines.slice(Math.max(0, lines.length - LOG_LIMIT)) });
  },
  noteDroppedTicks: (total) => {
    const reported = get().reportedDroppedTicks;
    if (total <= reported) return;
    const delta = total - reported;
    const notice = get().droppedTicksNotice;
    const lastLine = get().logLines.at(-1);
    // 直前の操作ログが同じ「tick を省略しました」通知なら、行を増やさず積算して書き換える
    // （間に別のログが挟まれば最後の行のidが一致しなくなるので、そのときは新しい行にする）。§5.2
    if (notice !== undefined && lastLine !== undefined && lastLine.id === notice.logId) {
      const merged = {
        logId: notice.logId,
        ticks: notice.ticks + delta,
        occurrences: notice.occurrences + 1,
      };
      set({
        logLines: get().logLines.map((line) =>
          line.id === merged.logId
            ? { id: line.id, text: droppedTicksLog(merged.ticks, merged.occurrences) }
            : line,
        ),
        droppedTicksNotice: merged,
        reportedDroppedTicks: total,
      });
      return;
    }
    get().addLog(droppedTicksLog(delta));
    const added = get().logLines.at(-1);
    /* c8 ignore next -- addLog は必ず1行追加するので、直前に取った行は必ず存在する */
    const logId = added?.id ?? nextId();
    set({
      droppedTicksNotice: { logId, ticks: delta, occurrences: 1 },
      reportedDroppedTicks: total,
    });
  },
  toast: (text, tone = 'info') => {
    // 1件ごとに期限を持たせ、新しい5件だけ残す（連続して失敗しても画面が埋まらない）。§8.2
    const next = [
      ...get().toasts,
      { id: nextId(), text, tone, expiresAt: Date.now() + TOAST_TTL_MS },
    ];
    set({ toasts: next.slice(Math.max(0, next.length - TOAST_LIMIT)) });
  },
  dismissToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  expireToasts: (nowMs = Date.now()) => {
    const toasts = get().toasts;
    const left = toasts.filter((t) => t.expiresAt > nowMs);
    if (left.length !== toasts.length) set({ toasts: left });
  },
  setJudge: (judge) => {
    set({ judge });
  },
  setFatalError: (fatalError) => {
    set({ fatalError });
  },
  setWebglLost: (webglLost) => {
    set({ webglLost });
  },
  tickElapsed: () => {
    const { startedAtMs } = get();
    if (startedAtMs === 0) return;
    set({ elapsedMs: Date.now() - startedAtMs });
  },
  restoreProgress: (elapsedMs, hazardCount) => {
    // 保存データの数値は信用しない（NaN・Infinity・負数は 0 として扱う）
    const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.floor(elapsedMs) : 0;
    const hazards = Number.isFinite(hazardCount) && hazardCount > 0 ? Math.floor(hazardCount) : 0;
    // 経過時間は「いつ始めたか」で持っているので、始点を巻き戻すことで計時が続きから進む
    set({ elapsedMs: elapsed, startedAtMs: Date.now() - elapsed, restoredHazardCount: hazards });
  },
  setPendingWorkFile: (pendingWorkFile) => {
    set({ pendingWorkFile });
  },
  applyTester: (action) => {
    // 状態の更新は Plan 2A のリデューサ1本に任せる（Worker 側も同じ関数を通る）
    const tester = applyTesterAction(get().tester, action);
    set({
      tester,
      // 置いたら次の側へ巡る（§9.3 黒 → 赤）。外したときはその側を次にする
      ...(action.type === 'place-probe'
        ? {
            nextProbe: action.terminal === undefined ? action.probe : nextProbeAfter(action.probe),
          }
        : {}),
    });
  },
  setTester: (tester) => {
    set({ tester });
  },
  setNextProbe: (nextProbe) => {
    set({ nextProbe });
  },
  clearProbes: () => {
    const tester = get().tester;
    /*
     * 外すのはプローブだけ。**0Ω調整は残す**（`applyTesterAction` の `place-probe` と揃える）。
     * 校正はレンジに対して行うものでプローブ位置とは独立なので、盤を作り直すたびに
     * Ω調整をやり直させると実機の手順と食い違う（§9.3 / Plan 2A）。Worker 側の `load` も同じ。
     */
    set({
      tester: { ...tester, black: undefined, red: undefined },
      nextProbe: 'black',
    });
  },
  dismissHazard: (nowMs) => {
    const banner = get().hazardBanner;
    if (banner === undefined) return;
    // 引数なしなら無条件に畳む。時刻を渡されたら期限切れのときだけ畳む（間引きタイマ用）
    if (nowMs !== undefined && banner.expiresAt > nowMs) return;
    set({ hazardBanner: undefined });
  },
  setAnswer: (partId, answer) => {
    const answers = get().answers;
    const index = answers.findIndex((a) => a.partId === partId);
    // 排他選択なので同じ部品の行は上書きする（§17.2 #5）。並びは最初に答えた順のまま
    set({
      answers:
        index < 0
          ? [...answers, { partId, answer }]
          : answers.map((a, i) => (i === index ? { partId, answer } : a)),
    });
  },
  setCheckPart: (checkPartId) => {
    set({ checkPartId });
  },
  addReport: (report) => {
    set({ reports: [...get().reports, report] });
  },
  removeReport: (index) => {
    set({ reports: get().reports.filter((_, i) => i !== index) });
  },
  setCircuit: (circuit) => {
    set({ circuit });
  },
  setPendingReport: (pendingReport) => {
    set({ pendingReport });
  },
  setHighlight: (highlight) => {
    set({ highlight });
  },
  // --- Plan 5 Task 6 ---
  setSchematicDoc: (schematicDoc) => {
    set({
      schematicDoc,
      schematicCursor: clampCursor(schematicDoc, get().schematicCursor),
      ...staleVerify(),
    });
  },
  /**
   * 編集を1つ当てる。断られたらトーストに理由を出して `false` を返す（盤のコマンドと同じ流儀）。
   * 成功したら**編集前の文書**を履歴に積み、カーソルを文書の中へ収め直す。§11.4
   */
  applySchematicEdit: (edit) => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const outcome = applyEdit(doc, edit);
    if (!outcome.ok) {
      // 断りの文面にも内部ID（`r3` / `c01`）は出さない（レビュー I3）
      get().toast(issueText(doc, outcome.message), 'error');
      return false;
    }
    set({
      schematicDoc: outcome.doc,
      schematicHistory: pushSchematic(get().schematicHistory, doc),
      // 置いたら次の桁へ進める（Enter を3回で PB1 → PB2 → CR1 の順に並ぶ）。レビュー I1
      schematicCursor: cursorAfterEdit(outcome.doc, get().schematicCursor, edit),
      // 文書が変わったら前回の検算結果は古い（決定表#6 / レビュー I2）
      ...staleVerify(),
    });
    // 操作ログにも内部IDは出さない（レビュー I3）
    get().addLog(issueText(doc, editLabel(edit)));
    return true;
  },
  setSchematicCursor: (schematicCursor) => {
    const doc = get().schematicDoc;
    set({
      schematicCursor: doc === undefined ? schematicCursor : clampCursor(doc, schematicCursor),
    });
  },
  undoSchematicEdit: () => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const step = undoSchematic(get().schematicHistory, doc);
    if (step === undefined) return false;
    set({
      schematicDoc: step.doc,
      schematicHistory: step.history,
      schematicCursor: clampCursor(step.doc, get().schematicCursor),
      ...staleVerify(),
    });
    return true;
  },
  redoSchematicEdit: () => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const step = redoSchematic(get().schematicHistory, doc);
    if (step === undefined) return false;
    set({
      schematicDoc: step.doc,
      schematicHistory: step.history,
      schematicCursor: clampCursor(step.doc, get().schematicCursor),
      ...staleVerify(),
    });
    return true;
  },
  /** 描いた回路図をすべて消す（1手で元に戻せる）。確認は画面側が取る。§11.4 */
  clearSchematic: () => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const empty = emptySchematic(doc.id, doc.title);
    set({
      schematicDoc: empty,
      schematicHistory: pushSchematic(get().schematicHistory, doc),
      schematicCursor: clampCursor(empty, get().schematicCursor),
      ...staleVerify(),
    });
    get().addLog(JA.schematic.cleared);
    get().toast(JA.schematic.cleared, 'info');
    return true;
  },
  setVerifying: (verifying) => {
    // 依頼の宛先（いまの文書）を控える。結果が届いたときに古いかどうかを見る（レビュー I2）
    set(verifying ? { verifying: true, verifyingDoc: get().schematicDoc } : staleVerifying());
  },
  setVerifyResult: (verifyResult) => {
    const asked = get().verifyingDoc;
    /*
     * 依頼したときの図といまの図が違えば、この結果は**古い図の答え**なので捨てる
     * （レビュー I2）。依頼を控えていない場合（作業ファイルの復元や試験の直接投入）は
     * 比べようが無いのでそのまま受ける。
     */
    if (asked !== undefined && asked !== get().schematicDoc) {
      set(staleVerifying());
      return;
    }
    set({ verifyResult, verifying: false, verifyingDoc: undefined });
  },
  // --- /Plan 5 Task 6 ---
  setLadder: (program) => {
    const current = get().ladder;
    set({
      ladder: program,
      // 編集したら変換済みではなくなる（H-1: 判定は変換を通ったものだけ）
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
      ...(current === undefined ? {} : { ladderHistory: pushLadder(get().ladderHistory, current) }),
    });
  },
  restoreLadder: (program, comments) => {
    set({
      ladder: program,
      ladderHistory: emptyLadderHistory(),
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
      ...(comments === undefined ? {} : { ladderComments: { ...comments } }),
    });
  },
  setLadderCursor: (ladderCursor) => {
    set({ ladderCursor });
  },
  setLadderMode: (ladderMode) => {
    set({ ladderMode });
  },
  setLadderFocused: (ladderFocused) => {
    set({ ladderFocused });
  },
  setLadderView: (ladderView) => {
    set({ ladderView });
  },
  // --- Plan 5 Task 7 ---
  setAssembleView: (assembleView) => {
    set({ assembleView });
  },
  // --- /Plan 5 Task 7 ---
  toggleInsert: () => {
    const insertMode = get().insertMode === 'insert' ? 'overwrite' : 'insert';
    set({ insertMode });
    return insertMode;
  },
  markMonitorWriteNotice: () => {
    // 初回だけ true（`Shift+F3` のトーストを1回しか出さない。決定表#11）
    if (get().monitorWriteNoticeShown) return false;
    set({ monitorWriteNoticeShown: true });
    return true;
  },
  setDeviceComment: (device, text) => {
    const comments = { ...get().ladderComments };
    // 空白だけの入力を消去とみなすかどうかは `trim()` で判定するが、保存する文字列そのものは
    // 打鍵どおり（先頭・末尾の空白も含む）に残す。そうしないと「運転 押ボタン」のような
    // デバイス名に含まれる空白が入力のたびに消えてしまう（Batch 3 レビュー I2）
    if (text.trim().length === 0) {
      delete comments[device];
      set({ ladderComments: comments });
      return true;
    }
    if (
      !Object.hasOwn(comments, device) &&
      Object.keys(comments).length >= DEVICE_COMMENT_COUNT_LIMIT
    ) {
      return false;
    }
    comments[device] = text.slice(0, DEVICE_COMMENT_LIMIT);
    set({ ladderComments: comments });
    return true;
  },
  setConverted: (converted, convertIssues) => {
    set({ converted, convertIssues });
  },
  setPlcMonitor: (plcMonitor) => {
    set({ plcMonitor });
  },
  setPlcRunning: (plcRunning) => {
    set({ plcRunning });
  },
  applyLadderSettings: ({ gridCols, monitorColor, vendor }) => {
    // 0 は「スキンの既定列数」の印なのでそのまま持つ（丸めない。決定表#8）
    const clampedGridCols =
      gridCols === 0 ? 0 : Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Math.round(gridCols)));
    /*
     * 表示列数が縮んで、カーソルがいま見えない接点列を指していたら、見える最後の接点列へ詰める
     * （レビュー指摘 #7）。**この詰めは残す**（4B レビュー I3）——落とすと 15列から8列へ狭めた
     * 直後にカーソルが画面外を指し、`Enter` が見えないセルを編集する。
     * `0`（＝メーカーの既定に従う）のときは、いまの方言の既定列数で詰める。
     */
    const visibleCols =
      clampedGridCols === 0 ? getDialect(get().dialectId).gridCols : clampedGridCols;
    const cursor = get().ladderCursor;
    // コイル列（`COIL_COL`）はどの表示列数でも必ず見えているので動かさない
    const clampedCursor =
      cursor.col === COIL_COL || cursor.col < visibleCols
        ? cursor
        : { ...cursor, col: visibleCols - 1 };
    set({
      ladderGridCols: clampedGridCols,
      monitorColor,
      ladderCursor: clampedCursor,
      // **`dialectId` には触らない**（決定表#24）。効くのは次に課題を開くときである
      ...(isDialectId(vendor) && IMPLEMENTED_DIALECT_IDS.includes(vendor)
        ? { defaultVendor: vendor }
        : {}),
    });
  },
  setDialect: (dialectId) => {
    set({ dialectId });
  },
  // --- Plan 4B Task 8 ---
  switchDialect: (dialectId) => {
    const { problem, ladder, ladderComments, ladderHistory } = get();
    // 課題を開いていないとき（ホームや設定）は方言を入れ替えるだけでよい
    if (problem === undefined || !isPlcProblem(problem)) {
      set({ dialectId });
      return;
    }
    const swapped = plcForVendor(problem, dialectId);
    if (swapped === undefined) {
      /*
       * 割付がその機種に収まらない（CP1E の出力は12点。決定表#10）。**方言も変えない**——
       * ラダーだけ別メーカーの表記にすると、机上のPLC本体の端子名と食い違う（4A H-1）。
       * 画面（`NotationDialog`）は押す前にこの理由を出して押させないので、ここは念のための砦。
       */
      const model = plcUnitForVendor(dialectId)?.model ?? dialectId;
      const wanted = plcUnitFor(model)?.displayName ?? model;
      const used = plcUnitFor(problem.plc.model)?.displayName ?? problem.plc.model;
      get().toast(JA.plc.modelNotUsable(wanted, used), 'error');
      return;
    }
    /*
     * `openProblem()` が方言 → 機種 → 盤・履歴・ログ・計時を作り直す。**`vendor` を必ず渡す**
     * （渡さないと `defaultVendor` に戻され、切り替えたはずの方言が元へ戻る。決定表#24）。
     * ラダー・デバイスコメント・取り消しスタックだけ持ち越す（決定表#11・#12）。
     */
    if (!get().openProblem(swapped, { vendor: dialectId })) return;
    set({
      ladder,
      ladderComments,
      ladderHistory,
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
    });
    get().toast(JA.plc.notationSwitched(getDialect(dialectId).displayName));
  },
  // --- /Plan 4B Task 8 ---
  undoLadderEdit: () => {
    const { ladder, ladderHistory } = get();
    if (ladder === undefined) return false;
    const step = undoLadder(ladderHistory, ladder);
    if (step === undefined) return false;
    set({
      ladder: step.program,
      ladderHistory: step.history,
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
    });
    return true;
  },
  redoLadderEdit: () => {
    const { ladder, ladderHistory } = get();
    if (ladder === undefined) return false;
    const step = redoLadder(ladderHistory, ladder);
    if (step === undefined) return false;
    set({
      ladder: step.program,
      ladderHistory: step.history,
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
    });
    return true;
  },
  noteRenderSuccess: () => {
    if (get().restartAttempts !== 0) set({ restartAttempts: 0 });
  },
  resetSession: () => {
    const state = get();
    const problem = state.problem;
    if (problem === undefined) return;
    /*
     * 盤も履歴もテスターもマークシートも `openProblem()` が作り直すので、C1/C2 の欄を
     * ここで個別に消す必要はない（Plan 2B Task 4 Step 8 が求める「持ち越さない」を満たす）。
     *
     * C2は**同じ故障のまま**新品の故障入り盤で再挑戦する（Plan 2B Task 4 Step 8）。そのため
     * 種も故障も引き直さず、いま入っている解決済みリストから作り直す。
     *
     * モードDは訓練者のラダーを残す（Batch 4+5 レビュー I4。結果画面「もう一度」）。盤・履歴・
     * 危険操作は今までどおり作り直し、ラダーだけ持ち越す（`openProblem()` の `keepLadder`）。
     */
    const reopened = get().openProblem(problem, {
      resolvedFaults: state.resolvedFaults,
      faultSeed: state.faultSeed,
      keepLadder: isPlcProblem(problem),
      // いまのセッションの方言のまま作り直す（既定メーカーへ戻さない。MERGE 注意 #5 / 決定表#24）
      vendor: state.dialectId,
    });
    // 作り直せなかったら理由はトーストに出ている。画面も世代番号も動かさない（§13 #2）
    if (!reopened) return;
    // 同じ課題なら `problemId` は変わらないので、世代番号で Worker の張り直しを促す
    set({ sessionEpoch: get().sessionEpoch + 1 });
  },
  restartSession: () => {
    const attempts = get().restartAttempts + 1;
    const problem = get().problem;
    get().clearLive();
    set({
      sessionEpoch: get().sessionEpoch + 1,
      restartAttempts: attempts,
      fatalError: undefined,
      webglLost: false,
      judge: undefined,
      judging: false,
      pendingTerminal: undefined,
      hoveredTerminal: undefined,
      selectedWire: undefined,
      // 課題を作り直す操作なので C1/C2 の状態も手放す（Plan 2B Task 4 Step 8）
      circuit: undefined,
      faultSeed: undefined,
      resolvedFaults: undefined,
      answers: [],
      reports: [],
      checkPartId: undefined,
      pendingReport: undefined,
      highlight: NO_HIGHLIGHT,
      /*
       * 検算の結果は盤を作り直したら古いので落とす。**下書きそのものは残す**（§11.4）。
       * `restartSession()` は課題から離れるわけではなく、描画の立て直しでラダーを残すのと
       * 同じ理由（§13 #5。ここで消すと机上の作業だけが元に戻せずに失われる）。
       */
      verifying: false,
      verifyResult: undefined,
      verifyingDoc: undefined,
      // 盤を描き直すので盤のビューへ戻す（Plan 5 Task 7 / 決定表#1）
      assembleView: 'board' as const,
      tester: createTesterState(get().tester.kind),
      nextProbe: 'black',
      // 課題を作り直す操作なので回路図ヒントを開いた回数も数え直す（§8.4）
      schematicOpenCount: 0,
      /*
       * 盤は作り直すがラダーは残す（§13 #5。レビュー指摘 B3）。`restartSession()` は課題から
       * 離れるわけではないので `plcFields()` は混ぜない（混ぜると訓練者が組んだラダーが
       * 最初のやり直しで消える）。Worker は `load` で作り直されるので、「変換済み」「モニタ」
       * 「RUN」の3つだけを落として画面と Worker を揃える
       */
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
      plcMonitor: undefined,
      plcRunning: false,
      ladderMode: 'write',
    });
    // 1回目は作業保持を優先して盤を残す。2回目は盤そのものが描けないとみて作り直す（§13 #5）
    if (attempts < RESTART_FALLBACK_ATTEMPTS || problem === undefined) return;
    /*
     * 最後の手段は**モードBにしか効かない**。`sessionForProblem()` が作るのは素の盤
     * （青の新規配線・故障なし・在庫つき）で、C1なら点検すべき部品が消え、C2なら故障の無い盤に
     * なってしまう（＝課題として成立しないまま「再開しました」と言うことになる）。上の `set()` で
     * 故障（`circuit` / `resolvedFaults`）は既に手放しているので、点検系は課題を捨てて一覧へ戻す。
     * §13 #5 / Plan 2B Batch 1 レビューの Minor
     */
    if (!isAssembleProblem(problem)) {
      get().abandonSession();
      get().toast(JA.error.boardAbandoned, 'info');
      return;
    }
    set({ session: sessionForProblem(problem), history: emptyHistory(), restartAttempts: 0 });
    get().toast(JA.error.boardReset, 'info');
  },
  abandonSession: () => {
    get().clearLive();
    set({
      route: 'list',
      problem: undefined,
      session: undefined,
      history: emptyHistory(),
      sessionEpoch: get().sessionEpoch + 1,
      restartAttempts: 0,
      pendingWorkFile: undefined,
      judge: undefined,
      judging: false,
      fatalError: undefined,
      webglLost: false,
      pendingTerminal: undefined,
      hoveredTerminal: undefined,
      selectedWire: undefined,
      selectedSocket: undefined,
      logLines: [],
      startedAtMs: 0,
      elapsedMs: 0,
      restoredHazardCount: 0,
      // 課題を離れるので C1/C2 の状態も手放す（Plan 2B Task 4 Step 8）
      circuit: undefined,
      faultSeed: undefined,
      resolvedFaults: undefined,
      answers: [],
      reports: [],
      checkPartId: undefined,
      pendingReport: undefined,
      highlight: NO_HIGHLIGHT,
      // 課題を離れるので回路図エディタの下書きと検算の結果も手放す（§11.4）
      ...schematicFields(),
      // 次に開く課題は盤から始まる（Plan 5 Task 7 / 決定表#1）
      assembleView: 'board' as const,
      tester: createTesterState(get().tester.kind),
      nextProbe: 'black',
      // 課題を離れるので回路図ヒントを開いた回数も手放す（§8.4）
      schematicOpenCount: 0,
      // 課題を離れるのでモードDの状態も丸ごと手放す（Plan 2B Task 4 Step 8）
      ...plcFields(),
    });
  },
}));
