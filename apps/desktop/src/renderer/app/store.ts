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
import type { ProblemListPayload } from '../../shared/ipc.js';
import type { SimSnapshot } from '../../worker/protocol.js';
import { emptyHistory, type CommandHistory, type SessionCommand } from '../session/commands.js';
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

/** ストアの形。 */
export interface AppState {
  route: Route;
  problems: ProblemListPayload | undefined;
  problem: AssembleProblem | undefined;
  session: BoardSession | undefined;
  history: CommandHistory;

  mode: ToolMode;
  wireColor: WireColor;
  pendingTerminal: TerminalId | undefined;
  hoveredTerminal: TerminalId | undefined;
  selectedWire: string | undefined;
  selectedSocket: SocketId | undefined;
  camera: CameraPreset;
  schematicVisible: boolean;

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
  judge: JudgeResult | undefined;
  fatalError: string | undefined;
  /** WebGL コンテキストが失われ再初期化中か。§13 #4 */
  webglLost: boolean;

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
  applySnapshot: (snapshot: SimSnapshot) => void;
  clearLive: () => void;
  addLog: (text: string) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  setJudge: (result: JudgeResult | undefined) => void;
  setFatalError: (message: string | undefined) => void;
  setWebglLost: (lost: boolean) => void;
  tickElapsed: () => void;
  resetSession: () => void;
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

  mode: 'wire',
  wireColor: '青',
  pendingTerminal: undefined,
  hoveredTerminal: undefined,
  selectedWire: undefined,
  selectedSocket: undefined,
  camera: 'front',
  schematicVisible: false,

  snapshot: EMPTY_SNAPSHOT,
  hazards: [],
  chatters: [],
  chartSpecs: [],
  liveTransitions: {},
  logLines: [],
  toasts: [],
  startedAtMs: 0,
  elapsedMs: 0,
  judge: undefined,
  fatalError: undefined,
  webglLost: false,

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
      fatalError: undefined,
      schematicVisible: problem.hints.schematicVisible,
      startedAtMs: Date.now(),
      elapsedMs: 0,
    });
  },
  setSession: (session) => {
    set({ session });
  },
  pushHistory: (command) => {
    const history = get().history;
    const done = [...history.done, command];
    set({ history: { done: done.slice(Math.max(0, done.length - 50)), undone: [] } });
  },
  setHistory: (history) => {
    set({ history });
  },
  setMode: (mode) => {
    set({ mode, pendingTerminal: undefined });
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
    set({ camera });
  },
  toggleSchematic: () => {
    set({ schematicVisible: !get().schematicVisible });
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
  },
  clearLive: () => {
    set({ snapshot: EMPTY_SNAPSHOT, liveTransitions: {}, hazards: [], chatters: [] });
  },
  addLog: (text) => {
    const lines = [...get().logLines, { id: nextId(), text }];
    set({ logLines: lines.slice(Math.max(0, lines.length - 200)) });
  },
  toast: (text, tone = 'info') => {
    set({ toasts: [...get().toasts, { id: nextId(), text, tone }] });
  },
  dismissToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
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
  resetSession: () => {
    const problem = get().problem;
    if (problem === undefined) return;
    get().openProblem(problem);
  },
}));
