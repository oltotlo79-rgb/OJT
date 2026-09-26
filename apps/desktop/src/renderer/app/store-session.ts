import type { ReplayState } from '../session/replay.js';
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
} from '@ojt/content';
import type { DialectId } from '@ojt/plc-dialects';
import type { StateCreator } from 'zustand';
import type { WorkFile } from '../../shared/ipc.js';
import type { SimSnapshot } from '../../worker/protocol.js';
import { JA, referenceErrorText } from '../i18n/ja.js';
import {
  cloneSession,
  emptyHistory,
  pushCommand,
  type CommandHistory,
  type SessionCommand,
} from '../session/commands.js';
import type { DragPayload, ToolMode } from '../session/interaction.js';
import { boardForProblem } from '../session/plc-session.js';
import { plcForVendor, plcUnitForVendor } from '../session/plc-skin.js';
import { nextProbeAfter } from '../session/tester.js';
import { plcFields } from './store-ladder.js';
import { schematicFields } from './store-schematic.js';
import {
  NO_CONVERT_ISSUES,
  NO_HIGHLIGHT,
  type BoardFocus,
  type HighlightSelection,
  type PendingReport,
  type ProbeSide,
} from './store-types.js';
import { HAZARD_BANNER_TTL_MS, schematicPolicy } from './store-ui.js';
import type { AppState } from './store.js';

/**
 * 課題・盤・シミュレーションのスライス。設計仕様 §12.1（指摘 DS-3）。
 *
 * 「いま何の課題を、どの盤で、どこまで進めているか」を持つ。画面の見た目（`store-ui.ts`）・
 * 回路図の下書き（`store-schematic.ts`）・ラダー（`store-ladder.ts`）とは別に割ってあるが、
 * 課題を開く・やり直す・捨てる3つの入口だけは全スライスの初期値に触れるので、共通部分を
 * {@link sessionFields} に1本化してある（足し忘れを型と1箇所の定義で止める）。
 */

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

/**
 * ライブ記録の変化点を1信号あたり何点まで残すか（指摘 DS-2 ≡ UI-02）。§8.2
 *
 * `logLines` には `LOG_LIMIT`、操作履歴には `HISTORY_LIMIT` があるのに、ここだけ上限が無く
 * 課題を開いている間ずっと伸び続けていた。0.8秒フリッカの課題（b-006系）を30分回すと
 * 1信号あたり数千点になり、チャートを組み直すたびに全点を走ることになる。
 *
 * **間引きではなく切り詰め**にする（古い側を落とす）。間引くと「何回叩いたか」「チャタリングが
 * 何度出たか」という**教材としての情報が消える**ので、残す区間の中身は1点も落とさない。
 * 2,000点はフリッカ0.8秒なら約27分ぶんで、30分の課題でも直近が丸ごと残る。
 */
export const MAX_LIVE_POINTS = 2000;

/**
 * 変化点の列を上限まで切り詰める（古い側を落とす）。
 *
 * `toSegments()` は「最初の変化点の前は false」として描く。変化点は交互に並ぶので、残す先頭が
 * `false`（＝その前が true）だともう1点落として先頭を `true` に揃える。こうすると切り詰めた
 * 境目の直前の状態が実際と食い違わない（食い違うと、切れた先頭で波形が1段ずれて見える）。
 */
function trimLivePoints(
  points: ReadonlyArray<{ tMs: number; value: boolean }>,
): Array<{ tMs: number; value: boolean }> {
  if (points.length <= MAX_LIVE_POINTS) return [...points];
  let start = points.length - MAX_LIVE_POINTS;
  if (points[start]?.value === false) start += 1;
  return points.slice(start);
}

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
    includeCheckWires: true,
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
    includeCheckWires: problem.mode === 'inspect-parts',
    roles: toSocketRoles(problem.board.socketRoles),
    allowedColors: problem.board.profile?.rules.allowedColors ?? ['青'],
    extraParts: (problem.board.extraParts ?? []).map((name) => partId(name)),
    inventory: problem.inventory,
  });
}

/**
 * 課題を開く・やり直す・捨てるときに**必ず**戻す欄。§8.3 / §13 #5（指摘 DS-3）
 *
 * `openProblem()` / `resetSession()` / `abandonSession()` の3箇所が同じ初期値を逐語で
 * 書き写していたため、欄が増えるたびにどれかへ足し忘れる形だった（レビュー指摘 DS-3）。
 * ここを源にして3箇所とも展開し、違う値にしたい欄だけを後ろで上書きする。
 *
 * テスターの種別（アナログ／デジタル）は訓練者の持ち物なので、いまの種別のまま作り直す。
 */
export function sessionFields(
  current: Pick<AppState, 'tester'>,
): Pick<
  AppState,
  | 'measurements'
  | 'diagnosisNotes'
  | 'replay'
  | 'judge'
  | 'judging'
  | 'fatalError'
  | 'webglLost'
  | 'pendingTerminal'
  | 'wireLimitNotice'
  | 'hoveredTerminal'
  | 'selectedWire'
  | 'selectedSocket'
  | 'dragging'
  | 'hoverHint'
  | 'tester'
  | 'nextProbe'
  | 'circuit'
  | 'faultSeed'
  | 'resolvedFaults'
  | 'answers'
  | 'reports'
  | 'checkPartId'
  | 'pendingReport'
  | 'highlight'
  | 'boardFocus'
  | 'schematicOpenCount'
  | 'hintStage'
  | 'assembleView'
> {
  return {
    measurements: [],
    diagnosisNotes: [],
    replay: undefined,
    judge: undefined,
    judging: false,
    fatalError: undefined,
    webglLost: false,
    pendingTerminal: undefined,
    wireLimitNotice: undefined,
    hoveredTerminal: undefined,
    selectedWire: undefined,
    selectedSocket: undefined,
    // 直接操作の持ち物（Phase 7 Task 27）。課題を開き直したら必ず手放す
    dragging: undefined,
    hoverHint: undefined,
    tester: createTesterState(current.tester.kind),
    nextProbe: 'black',
    // 点検系（C1/C2）の持ち物。課題を開くときだけ `openProblem()` が引き当てた値で上書きする
    circuit: undefined,
    faultSeed: undefined,
    resolvedFaults: undefined,
    answers: [],
    reports: [],
    checkPartId: undefined,
    pendingReport: undefined,
    highlight: NO_HIGHLIGHT,
    // 結果画面から跳んだ注目は持ち越さない（Plan 5 Task 9 / 決定表#11）
    boardFocus: undefined,
    // 回路図ヒントを開いた回数も数え直す（§8.4）
    schematicOpenCount: 0,
    // 段階ヒントも閉じた状態から始める（Phase 7 Task 25 / 指摘 PR-02）
    hintStage: 0,
    // 盤から始める（Plan 5 Task 7 / 決定表#1）
    assembleView: 'board',
  };
}

/** 課題・盤・シミュレーションの状態と操作。 */
export interface SessionSlice {
  replay: ReplayState | undefined;
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
   * `ErrorBoundary` が子を描けたら0に戻る。復旧回数によって永続作業を破棄しない。
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

  // --- Plan 5 Task 9 ---
  /**
   * 結果画面の「盤で見る」で跳んできたときの注目。§8.3 / UXレビュー #28 / 決定表#11
   * 立っているあいだはセッション画面に「結果から」の帯が出て、3Dのホバーは
   * ハイライトを上書きしない（決定表#27 のレビュー指摘）。
   */
  boardFocus: BoardFocus | undefined;

  mode: ToolMode;
  wireColor: WireColor;
  pendingTerminal: TerminalId | undefined;
  /**
   * 3本目を配線しようとした端子の表示名（注意文を出している間だけ）。2026-09-26 利用者指示
   * 「3本目を配線しようとしたら注意文を出して」。閉じるか、次に電線を張るか、課題を開き直すと消える。
   */
  wireLimitNotice: string | undefined;
  hoveredTerminal: TerminalId | undefined;
  selectedWire: string | undefined;
  selectedSocket: SocketId | undefined;
  /**
   * つまんで運んでいるもの（部品パレットのカード／盤に載っている部品）。Phase 7 設計 §7.3.3
   * 立っているあいだは3Dのクリックが「落とす」に変わる（`intentOf()` が最優先で見る）。
   */
  dragging: DragPayload | undefined;
  /**
   * 3Dペインの下端に出す1行の予告（`panels/HoverHint.tsx`）。Phase 7 設計 §7.3.4
   * 「いま指しているものは何で、押すと何が起きるか」だけを持つ。`aria-live` にも同じ文が出る。
   */
  hoverHint: string | undefined;
  /** 判定を Worker へ送って結果待ちか（ツールバーの「判定」を二重に押させない）。§8.2 */
  judging: boolean;

  snapshot: SimSnapshot;
  hazards: HazardEvent[];
  sessionHazardCount: number;
  chatters: ChatterEvent[];
  /** ライブのタイムチャートに並べる信号。§7.7 */
  chartSpecs: TimeChartSignalSpec[];
  /** ライブのタイムチャート用の遷移点（信号名 → 変化点の列）。§8.2 */
  liveTransitions: Record<string, Array<{ tMs: number; value: boolean }>>;
  /** 今回課題を開いた実日時。所要時間の計算には使わない。 */
  sessionOpenedAtMs: number;
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
  /** 3本目の注意文を出す（端子の表示名）／消す（`undefined`）。 */
  setWireLimitNotice: (label: string | undefined) => void;
  setHovered: (terminal: TerminalId | undefined) => void;
  setSelectedWire: (wireId: string | undefined) => void;
  setSelectedSocket: (socketId: SocketId | undefined) => void;
  /** つまんだ／放した（Phase 7 Task 27）。放すときは `undefined` を渡す。 */
  setDragging: (dragging: DragPayload | undefined) => void;
  /** ホバー予告の1行を差し替える（同じ文なら書かない）。 */
  setHoverHint: (hint: string | undefined) => void;
  setJudging: (judging: boolean) => void;
  applySnapshot: (snapshot: SimSnapshot) => void;
  clearLive: () => void;
  /**
   * 判定結果を入れる。3モード共通（C1/C2 は `JudgeInspectResult`）。§8.3 / §9.1 / §9.2
   * 保持する `judge` が `AnyJudgeResult` なので、入口も同じ広さにしておく（Plan 2B Task 10）。
   */
  setJudge: (result: AnyJudgeResult | undefined) => void;
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
  /** マークシートの解答を1件入れる（同じ部品は上書き）。§9.1 */
  setAnswer: (partId: string, answer: PartTruth) => void;
  /** チェック用ソケットに挿している部品を記録する。§9.1 */
  setCheckPart: (partId: string | undefined) => void;
  /** 指摘を1件足す。§9.2 */
  addReport: (report: FaultReport) => void;
  /** 指摘を1件取り消す。§9.2 */
  removeReport: (index: number) => void;
  /** 指摘を1件差し替える（部品不良の内容を選び直したとき。2026-09-26）。 */
  replaceReport: (index: number, report: FaultReport) => void;
  /** モードC2の回路を差し替える（部品交換のとき）。§9.2 */
  setCircuit: (circuit: RepairCircuit) => void;
  /** 指摘の対象を選んだ（種別ポップオーバーを出す）。§9.2 */
  setPendingReport: (target: PendingReport | undefined) => void;
  /** 連動ハイライトを設定する。§9.2 */
  setHighlight: (selection: HighlightSelection) => void;
  // --- Plan 5 Task 9 ---
  /** 結果画面から盤へ跳んだ注目を立てる／畳む。§8.3 / 決定表#11 */
  setBoardFocus: (focus: BoardFocus | undefined) => void;
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
   * 繰り返しても盤・故障情報・解答は保持する。作業の破棄は明示的なやり直し操作だけで行う。
   */
  restartSession: () => void;
  /**
   * 課題を捨てて一覧へ戻る。§13 #5
   * 「セッションをリセット」でも抜け出せないときの最後の逃げ道（例外バナーの2つ目のボタン）。
   */
  abandonSession: () => void;
}

/** 課題・盤・シミュレーションのスライス。 */
export const createSessionSlice: StateCreator<AppState, [], [], SessionSlice> = (set, get) => ({
  problem: undefined,
  session: undefined,
  history: emptyHistory(),
  sessionEpoch: 0,
  restartAttempts: 0,
  pendingWorkFile: undefined,
  tester: createTesterState(),
  nextProbe: 'black',
  answers: [],
  checkPartId: undefined,
  reports: [],
  circuit: undefined,
  faultSeed: undefined,
  resolvedFaults: undefined,
  pendingReport: undefined,
  highlight: NO_HIGHLIGHT,
  // 結果画面から跳んできたときだけ立つ（Plan 5 Task 9 / 決定表#11）
  boardFocus: undefined,

  mode: 'wire',
  wireColor: '青',
  pendingTerminal: undefined,
  wireLimitNotice: undefined,
  hoveredTerminal: undefined,
  selectedWire: undefined,
  selectedSocket: undefined,
  dragging: undefined,
  hoverHint: undefined,
  judging: false,

  replay: undefined,
  snapshot: EMPTY_SNAPSHOT,
  hazards: [],
  sessionHazardCount: 0,
  chatters: [],
  chartSpecs: [],
  liveTransitions: {},
  sessionOpenedAtMs: 0,
  startedAtMs: 0,
  elapsedMs: 0,
  restoredHazardCount: 0,
  judge: undefined,

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
      schematicVisible = schematicPolicy(
        problem.grade,
        problem.board.profile?.rules.hintPolicy,
      ).shown;
    } else if (isInspectPartsProblem(problem)) {
      // C1は配線しないので線色パレットは空（`checkSessionFor()` が決める）。§9.1
      session = checkSessionFor(problem);
    } else {
      session = sessionForProblem(problem);
      // 回路図ヒントの出し方は級だけで決まる（§8.4）
      schematicVisible = schematicPolicy(
        problem.grade,
        problem.board.profile?.rules.hintPolicy,
      ).shown;
    }
    /*
     * モードDの「もう一度」はラダーを残す（Batch 4+5 レビュー I4）。`plcFields()` が書き込む
     * 前のいまの値をここで捕まえておく（下の `set()` で上書きされてしまうため）。
     */
    const keepLadder = options.keepLadder === true && isPlcProblem(problem);
    const previousLadder = keepLadder ? get().ladder : undefined;
    const previousLadderComments = keepLadder ? get().ladderComments : undefined;
    set({
      // 課題を開く・やり直す・捨てるで共通の初期値（指摘 DS-3。足し忘れをここで止める）
      ...sessionFields(get()),
      problem,
      session,
      // 引き当てた故障は共通の初期値（undefined）の上から入れる
      circuit,
      faultSeed,
      resolvedFaults,
      history: emptyHistory(),
      route: 'session',
      // 配線する2モード（B と D）は電線ツール、点検系（C1/C2）はテスターから始める
      mode: isAssembleProblem(problem) || isPlcProblem(problem) ? 'wire' : 'tester',
      wireColor,
      snapshot: EMPTY_SNAPSHOT,
      hazards: [],
      sessionHazardCount: 0,
      chatters: [],
      // C1は波形を比べないのでライブチャートも要らない。モードBとC2は同じ式で信号を決める
      chartSpecs: isInspectPartsProblem(problem)
        ? []
        : defaultChartSignals(
            resolveCompareSignals(problem.judge, problem.board.extraParts ?? []),
            problem.operations.map((operation) => operation.target),
          ),
      liveTransitions: {},
      logLines: [],
      reportedDroppedTicks: 0,
      droppedTicksNotice: undefined,
      schematicVisible,
      sessionOpenedAtMs: Date.now(),
      startedAtMs: Date.now(),
      elapsedMs: 0,
      restoredHazardCount: 0,
      restartAttempts: 0,
      pendingWorkFile: undefined,
      hazardBanner: undefined,
      // 回路図エディタの下書きは課題ごとに作り直す（モードB以外は持たない）。§11.4
      ...schematicFields(problem),
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
  setWireLimitNotice: (wireLimitNotice) => {
    set({ wireLimitNotice });
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
  setDragging: (dragging) => {
    set({ dragging });
  },
  setHoverHint: (hoverHint) => {
    // ホバーは毎秒何度も走るので、同じ文なら書かない（購読者の再描画を増やさない。§15）
    if (get().hoverHint === hoverHint) return;
    set({ hoverHint });
  },
  setJudging: (judging) => {
    set({ judging });
  },
  applySnapshot: (snapshot) => {
    const state = get();
    const names = new Set(state.chartSpecs.map((spec) => spec.name));
    let liveTransitions = state.liveTransitions;
    const touched = new Set<string>();
    for (const entry of snapshot.logDelta) {
      if (!names.has(entry.signal) || typeof entry.value !== 'boolean') continue;
      if (liveTransitions === state.liveTransitions) liveTransitions = { ...liveTransitions };
      const points = liveTransitions[entry.signal] ?? [];
      liveTransitions[entry.signal] = [...points, { tMs: entry.tMs, value: entry.value }];
      touched.add(entry.signal);
    }
    // 伸ばした信号だけ上限まで切り詰める（指摘 DS-2 ≡ UI-02）
    for (const signal of touched) {
      const points = liveTransitions[signal];
      if (points !== undefined && points.length > MAX_LIVE_POINTS) {
        liveTransitions[signal] = trimLivePoints(points);
      }
    }
    const lastHazard = snapshot.hazardDelta.at(-1);
    set({
      snapshot,
      liveTransitions,
      sessionHazardCount: Math.max(
        state.sessionHazardCount,
        snapshot.hazardTotal ?? state.sessionHazardCount + snapshot.hazardDelta.length,
      ),
      hazards:
        snapshot.hazardDelta.length === 0
          ? state.hazards
          : [...state.hazards, ...snapshot.hazardDelta].slice(-200),
      chatters:
        snapshot.chatterDelta.length === 0
          ? state.chatters
          : [...state.chatters, ...snapshot.chatterDelta].slice(-200),
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
      sessionHazardCount: 0,
      chatters: [],
      reportedDroppedTicks: 0,
      droppedTicksNotice: undefined,
    });
  },
  setJudge: (judge) => {
    set({ judge });
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
  replaceReport: (index, report) => {
    set({ reports: get().reports.map((current, i) => (i === index ? report : current)) });
  },
  setCircuit: (circuit) => {
    set({ circuit });
  },
  setPendingReport: (pendingReport) => {
    set({ pendingReport });
  },
  setHighlight: (highlight) => {
    set({ highlight });
    /*
     * E2E からストアの中身を読む窓（Plan 5 Task 15 / MERGE 注意 #2）。`camera-readout` と
     * 同じ「E2E のための窓」で、画面には何も出ない。旗で切り替えると E2E が配布版と
     * 違う道を通ることになるので、開発・配布とも常に書く（決定表#16 と同じ理由）。
     */
    (globalThis as unknown as { __ojtHighlight?: readonly string[] }).__ojtHighlight =
      highlight.terminals;
  },
  // --- Plan 5 Task 9 ---
  setBoardFocus: (boardFocus) => {
    set({ boardFocus });
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
    const current = get();
    current.clearLive();
    set({
      replay: undefined,
      judge: undefined,
      judging: false,
      fatalError: undefined,
      webglLost: false,
      pendingTerminal: undefined,
      wireLimitNotice: undefined,
      hoveredTerminal: undefined,
      dragging: undefined,
      hoverHint: undefined,
      pendingReport: undefined,
      verifying: false,
      verifyResult: undefined,
      verifyingDoc: undefined,
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
      plcMonitor: undefined,
      plcRunning: false,
      ladderMode: 'write',
      sessionEpoch: current.sessionEpoch + 1,
      restartAttempts: current.restartAttempts + 1,
      restoredHazardCount:
        current.restoredHazardCount + Math.max(current.sessionHazardCount, current.hazards.length),
    });
  },
  abandonSession: () => {
    get().clearLive();
    set({
      /*
       * 課題を開く・やり直す・捨てるで共通の初期値（指摘 DS-3）。C1/C2 の持ち物も
       * テスターも選択もここで戻るので、欄が増えてもこの3箇所へ書き足す必要は無い。
       */
      ...sessionFields(get()),
      route: 'list',
      problem: undefined,
      session: undefined,
      history: emptyHistory(),
      sessionEpoch: get().sessionEpoch + 1,
      restartAttempts: 0,
      pendingWorkFile: undefined,
      logLines: [],
      sessionOpenedAtMs: 0,
      startedAtMs: 0,
      elapsedMs: 0,
      restoredHazardCount: 0,
      // 課題を離れるので回路図エディタの下書きと検算の結果も手放す（§11.4）
      ...schematicFields(),
      // 課題を離れるのでモードDの状態も丸ごと手放す（Plan 2B Task 4 Step 8）
      ...plcFields(),
    });
  },
});
