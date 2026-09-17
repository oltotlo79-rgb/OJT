import { createSession, JIPM_BOARD, type BoardSession, type SocketId } from '@ojt/board-model';
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
  REPAIR_WIRE_COLOR,
  resolveCompareSignals,
  resolveFaults,
  toSocketRoles,
  type FaultReport,
  type FaultSpecData,
  type InspectPartAnswer,
  type InspectPartsProblem,
  type JudgeInspectResult,
  type JudgeResult,
  type PartTruth,
  type RepairCircuit,
  type SupportedProblem,
  type TimeChartSignalSpec,
} from '@ojt/content';
import { create } from 'zustand';
import type { ProblemListPayload, WorkFile } from '../../shared/ipc.js';
import type { SimSnapshot } from '../../worker/protocol.js';
import { droppedTicksLog, JA, referenceErrorText } from '../i18n/ja.js';
import {
  emptyHistory,
  pushCommand,
  type CommandHistory,
  type SessionCommand,
} from '../session/commands.js';
import type { ToolMode } from '../session/interaction.js';
import { nextProbeAfter } from '../session/tester.js';
import {
  NO_HIGHLIGHT,
  type CameraPreset,
  type HazardBanner,
  type HighlightSelection,
  type ListMode,
  type LogLine,
  type PendingReport,
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
  NO_HIGHLIGHT,
  type CameraPreset,
  type HazardBanner,
  type HighlightSelection,
  type ListMode,
  type LogLine,
  type PendingReport,
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

/** 判定結果（モードB／C1／C2）。§8.3 / §9.1 / §9.2 */
export type AnyJudgeResult = JudgeResult | JudgeInspectResult;

/**
 * 点検系（C1/C2）の判定結果か。§9.1 / §9.2
 * 3モードとも `mode` を持つ（Plan 2A I-3）ので、`'assemble'` かどうかで判別する。
 */
export function isInspectJudge(result: AnyJudgeResult): result is JudgeInspectResult {
  return result.mode !== 'assemble';
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
  return createSession(JIPM_BOARD, {
    roles: toSocketRoles(problem.board.socketRoles),
    allowedColors: ['青'],
    extraParts: (problem.board.extraParts ?? []).map((name) => partId(name)),
    inventory: problem.inventory,
  });
}

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

  mode: 'wire',
  wireColor: '青',
  pendingTerminal: undefined,
  hoveredTerminal: undefined,
  selectedWire: undefined,
  selectedSocket: undefined,
  camera: 'front',
  cameraNonce: 0,
  schematicVisible: false,
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
      session = built.value.session;
      wireColor = REPAIR_WIRE_COLOR;
      // C2の回路図の出し方は課題の hints が決める（2級は出す・1級は出さない）。§9.2
      schematicVisible = problem.hints.schematicVisible;
    } else if (isInspectPartsProblem(problem)) {
      // C1は配線しないので線色パレットは空（`checkSessionFor()` が決める）。§9.1
      session = checkSessionFor(problem);
    } else {
      session = sessionForProblem(problem);
      // 回路図ヒントの出し方は級だけで決まる（§8.4）
      schematicVisible = schematicPolicy(problem.grade).shown;
    }
    set({
      problem,
      session,
      circuit,
      history: emptyHistory(),
      route: 'session',
      mode: isAssembleProblem(problem) ? 'wire' : 'tester',
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
    set({ schematicVisible: !get().schematicVisible });
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
     * 種も故障も引き直さず、いま入っている解決済みリストから作り直す。いまの `circuit.session`
     * は訓練者の修復で書き換わっている（2A ハンドオフ注記 M-12）ので使い回さない。
     */
    const reopened = get().openProblem(problem, {
      resolvedFaults: state.resolvedFaults,
      faultSeed: state.faultSeed,
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
      tester: createTesterState(get().tester.kind),
      nextProbe: 'black',
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
      tester: createTesterState(get().tester.kind),
      nextProbe: 'black',
    });
  },
}));
