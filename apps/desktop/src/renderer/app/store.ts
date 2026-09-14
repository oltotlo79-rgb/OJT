import { createSession, JIPM_BOARD, type BoardSession, type SocketId } from '@ojt/board-model';
import {
  partId,
  type ChatterEvent,
  type HazardEvent,
  type TerminalId,
  type WireColor,
} from '@ojt/circuit-sim';
import {
  defaultChartSignals,
  resolveCompareSignals,
  toSocketRoles,
  type AssembleProblem,
  type JudgeResult,
  type TimeChartSignalSpec,
} from '@ojt/content';
import { create } from 'zustand';
import type { ProblemListPayload, WorkFile } from '../../shared/ipc.js';
import type { SimSnapshot } from '../../worker/protocol.js';
import { droppedTicksLog, JA } from '../i18n/ja.js';
import {
  emptyHistory,
  pushCommand,
  type CommandHistory,
  type SessionCommand,
} from '../session/commands.js';
import type { ToolMode } from '../session/interaction.js';
import type { CameraPreset, LogLine, Route, Toast } from './store-types.js';

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

export type { CameraPreset, LogLine, Route, Toast } from './store-types.js';

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

/** ストアの形。 */
export interface AppState {
  route: Route;
  problems: ProblemListPayload | undefined;
  problem: AssembleProblem | undefined;
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
  judge: JudgeResult | undefined;
  fatalError: string | undefined;
  /** WebGL コンテキストが失われ再初期化中か。§13 #4 */
  webglLost: boolean;
  /** 既に操作ログへ出した「捨てた tick」の累計。§5.2 */
  reportedDroppedTicks: number;

  setRoute: (route: Route) => void;
  setProblems: (payload: ProblemListPayload) => void;
  openProblem: (problem: AssembleProblem) => void;
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
  setJudge: (result: JudgeResult | undefined) => void;
  setFatalError: (message: string | undefined) => void;
  setWebglLost: (lost: boolean) => void;
  tickElapsed: () => void;
  /** 作業ファイルから経過時間と危険操作回数を戻す（`startedAtMs` も巻き戻す）。§12.3 */
  restoreProgress: (elapsedMs: number, hazardCount: number) => void;
  /** 確認待ちの作業ファイルを出し入れする。§12.3 */
  setPendingWorkFile: (file: WorkFile | undefined) => void;
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

/** 課題から盤セッションを作る。§7.1 / §8.1（モードBの新規配線は青のみ） */
export function sessionForProblem(problem: AssembleProblem): BoardSession {
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
  problem: undefined,
  session: undefined,
  history: emptyHistory(),
  sessionEpoch: 0,
  restartAttempts: 0,
  pendingWorkFile: undefined,

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

  setRoute: (route) => {
    set({ route });
  },
  setProblems: (problems) => {
    set({ problems });
  },
  openProblem: (problem) => {
    set({
      problem,
      session: sessionForProblem(problem),
      history: emptyHistory(),
      route: 'session',
      mode: 'wire',
      wireColor: '青',
      pendingTerminal: undefined,
      hoveredTerminal: undefined,
      selectedWire: undefined,
      selectedSocket: undefined,
      snapshot: EMPTY_SNAPSHOT,
      hazards: [],
      chatters: [],
      chartSpecs: defaultChartSignals(
        resolveCompareSignals(problem.judge, problem.board.extraParts ?? []),
      ),
      liveTransitions: {},
      logLines: [],
      judge: undefined,
      judging: false,
      fatalError: undefined,
      webglLost: false,
      reportedDroppedTicks: 0,
      // 回路図ヒントの出し方は級だけで決まる（§8.4）。課題JSONの `hints` は Phase 2 の C2 用
      schematicVisible: schematicPolicy(problem.grade).shown,
      startedAtMs: Date.now(),
      elapsedMs: 0,
      restoredHazardCount: 0,
      restartAttempts: 0,
      pendingWorkFile: undefined,
    });
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
    });
  },
  addLog: (text) => {
    const lines = [...get().logLines, { id: nextId(), text }];
    set({ logLines: lines.slice(Math.max(0, lines.length - LOG_LIMIT)) });
  },
  noteDroppedTicks: (total) => {
    const reported = get().reportedDroppedTicks;
    if (total <= reported) return;
    get().addLog(droppedTicksLog(total - reported));
    set({ reportedDroppedTicks: total });
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
  noteRenderSuccess: () => {
    if (get().restartAttempts !== 0) set({ restartAttempts: 0 });
  },
  resetSession: () => {
    const problem = get().problem;
    if (problem === undefined) return;
    get().openProblem(problem);
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
    });
    // 1回目は作業保持を優先して盤を残す。2回目は盤そのものが描けないとみて作り直す（§13 #5）
    if (attempts < RESTART_FALLBACK_ATTEMPTS || problem === undefined) return;
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
    });
  },
}));
