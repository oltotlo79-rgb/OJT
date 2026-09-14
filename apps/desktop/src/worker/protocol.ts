import type { BoardSession, SocketId, SocketRole } from '@ojt/board-model';
import type { ChatterEvent, HazardEvent, LampLevel, LogEntry, Wire } from '@ojt/circuit-sim';
import type { AssembleProblem, JudgeAssembleResult } from '@ojt/content';

/**
 * renderer ⇄ Simulation Worker のプロトコル。設計仕様 §4.3。
 * 型はこのファイル1箇所で定義し、renderer 側（worker-bridge.ts）と worker 側（sim.worker.ts）が共有する。
 *
 * 役割分担（本アプリの決定）:
 * - `BoardSession` の**所有者は renderer**。board-model の `addWire()` 等が返す `Result` を
 *   その場でトースト表示する必要があり、往復させると1フレーム遅れるため。
 * - worker は**ネットリストと `Simulation` の所有者**。renderer が確定させた変更（電線オブジェクト、
 *   更新後のセッション）を受け取って適用するだけなので、二重バリデーションも ID のずれも起きない。
 * - 装着・取り外し・タイマ設定は `Simulation` の差分API（`mountPart` / `unmountPart` /
 *   `setTimerPreset`）で当てる。作り直すと `tMs`・信号ログ・イベントが切れてしまうため。
 */

/** スナップショットの送出間隔[ms]（約30fpsに間引く）。§4.3 */
export const SNAPSHOT_INTERVAL_MS = 33;

/** 追従ループが1回で取り返す tick 数の上限（= 200ms 相当）。 */
export const MAX_CATCHUP_TICKS = 20;

/** renderer → worker のコマンド。 */
export type SimCommand =
  /** 課題を開く。ネットリストを作り直し、電源OFF・t=0 から回し始める。 */
  | { type: 'load'; problemId: string; session: BoardSession }
  /** 電線を1本張る（`Simulation` に差分適用するのでリレー／タイマの状態は保たれる）。 */
  | { type: 'addWire'; wire: Wire }
  /** 電線を1本外す。 */
  | { type: 'removeWire'; wireId: string }
  /** 部品を装着した（`Simulation.mountPart()` で差分適用する）。 */
  | { type: 'plug'; socketId: SocketId; session: BoardSession }
  /** 部品を外した（`Simulation.unmountPart()` で差分適用する）。`partId` は役割ID（`CR1` 等）。 */
  | { type: 'unplug'; partId: string; session: BoardSession }
  /** タイマの設定時間を変えた（`Simulation.setTimerPreset()` で差分適用する）。 */
  | { type: 'setPreset'; role: SocketRole; presetMs: number; session: BoardSession }
  /** 時刻・ログ・イベント・保護状態を初期化する（課題のやり直し）。 */
  | { type: 'reset' }
  /** 押ボタンを押す。 */
  | { type: 'press'; pbId: string }
  /** 押ボタンを離す。 */
  | { type: 'release'; pbId: string }
  /** ブレーカを入切する。 */
  | { type: 'breaker'; on: boolean }
  /** 電源スイッチを入切する。 */
  | { type: 'switch'; on: boolean }
  /**
   * 過電流保護からの復帰手順を実行する（スイッチOFF → ブレーカOFF → ブレーカON → スイッチON）。
   * §5.1.1 の正規の復帰手順そのものを1ボタンで代行するだけで、手順を飛ばす近道ではない。
   */
  | { type: 'resetTrip' }
  /** 判定する。模範回路と訓練者回路を worker 内で並走させる。§8.3 */
  | { type: 'judge'; problem: AssembleProblem; session: BoardSession; elapsedMs: number };

/** ランプ1個の表示状態。 */
export interface LampSnapshot {
  level: LampLevel;
  volts: number;
}

/** リレー1個の表示状態。 */
export interface RelaySnapshot {
  coilOn: boolean;
  contactsOn: boolean;
  coilVolts: number;
}

/** タイマ1個の表示状態。 */
export interface TimerSnapshot {
  powered: boolean;
  elapsedMs: number;
  presetMs: number;
  timedOut: boolean;
}

/** 約30fpsで送る状態スナップショット。ログ・イベントは前回送出からの差分のみ。§4.3 */
export interface SimSnapshot {
  tMs: number;
  breakerOn: boolean;
  switchOn: boolean;
  powered: boolean;
  tripped: boolean;
  sourceAmps: number;
  buttons: Record<string, boolean>;
  lamps: Record<string, LampSnapshot>;
  relays: Record<string, RelaySnapshot>;
  timers: Record<string, TimerSnapshot>;
  /** 前回送出以降に増えたログ行。§5.7 */
  logDelta: LogEntry[];
  /** 前回送出以降に発行された危険操作。§5.6 */
  hazardDelta: HazardEvent[];
  /** 前回送出以降に検出したチャタリング。§5.3.2 */
  chatterDelta: ChatterEvent[];
  /** 追従上限を超えて捨てた tick 数の累計（ウィンドウ非表示時の詰まり）。 */
  droppedTicks: number;
}

/** worker → renderer のメッセージ。 */
export type SimMessage =
  | { type: 'snapshot'; snapshot: SimSnapshot }
  | { type: 'judgeResult'; result: JudgeAssembleResult }
  | { type: 'error'; message: string };
