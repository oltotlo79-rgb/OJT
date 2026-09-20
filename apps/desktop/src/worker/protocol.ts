import type { BoardSession, SocketId } from '@ojt/board-model';
import type {
  ChatterEvent,
  HazardEvent,
  LampLevel,
  LogEntry,
  TesterAction,
  TesterKind,
  TesterMode,
  Wire,
} from '@ojt/circuit-sim';
import type {
  AssembleProblem,
  FaultReport,
  FaultSpecData,
  InspectPartAnswer,
  InspectPartsProblem,
  InspectRepairProblem,
  JudgeAssembleResult,
  JudgeInspectResult,
  JudgePlcResult,
  PlcProblem,
  ProblemIssue,
  RepairCircuit,
  VerifyResult,
} from '@ojt/content';
import type { LadderProgram } from '@ojt/ladder-core';
import type { SchematicDocument } from '@ojt/schematic-core';
import type { PlcMonitorSnapshot } from '../renderer/app/store-types.js';

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
  /**
   * 課題を開く。ネットリストを作り直し、電源OFF・t=0 から回し始める。
   * `partFaults` があれば `toNetlist()` の直後に注入する（C1/C2。§5.4）。部品の故障は
   * `MountedPart` に持たせる場所が無いので、変換のたびに入れ直す必要がある。
   */
  | {
      type: 'load';
      problemId: string;
      session: BoardSession;
      partFaults?: readonly FaultSpecData[];
      /**
       * モードDのPLC機種（`FX5U`）。§10.1
       * 渡されたときだけ `withPlcUnit()` 済みの派生盤からネットリストを作る。盤の `id` は
       * 変わらないので、`BoardSession` の照合も既存のコマンドもそのまま通る。
       */
      plcModel?: string;
    }
  /** 電線を1本張る（`Simulation` に差分適用するのでリレー／タイマの状態は保たれる）。 */
  | { type: 'addWire'; wire: Wire }
  /** 電線を1本外す。 */
  | { type: 'removeWire'; wireId: string }
  /** 部品を装着した（`Simulation.mountPart()` で差分適用する）。 */
  | { type: 'plug'; socketId: SocketId; session: BoardSession }
  /** 部品を外した（`Simulation.unmountPart()` で差分適用する）。`partId` は役割ID（`CR1` 等）。 */
  | { type: 'unplug'; partId: string; session: BoardSession }
  /**
   * タイマの設定時間を変えた（`Simulation.setTimerPreset()` で差分適用する）。
   * 宛先は**ネットリスト上の部品ID**（`socketPartId()` の戻り）。役割が割り当てられていない
   * ソケットの部品は `S3` のような物理IDで登録されるので、役割IDで指すと届かない（§6.4）。
   */
  | { type: 'setPreset'; partId: string; presetMs: number; session: BoardSession }
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
  | { type: 'judge'; problem: AssembleProblem; session: BoardSession; elapsedMs: number }
  /**
   * テスターを操作する。§9.3
   * つまみ・レンジ・プローブ・0Ω調整をまとめて **1本のコマンド**にし、中身は Plan 2A の
   * `TesterAction` をそのまま運ぶ。renderer も worker も同じ `applyTesterAction()` に通すので、
   * 画面のつまみの位置と worker が測っている状態がずれない（コマンドを種別ごとに分けると、
   * 片方だけ実装し忘れたときに静かにずれる）。
   */
  | { type: 'tester'; action: TesterAction }
  /** モードC1を判定する（マークシートの採点）。§9.1 */
  | {
      type: 'judgeParts';
      problem: InspectPartsProblem;
      answers: readonly InspectPartAnswer[];
      elapsedMs: number;
    }
  /**
   * モードC2を判定する。§9.2
   * `circuit` は開始時の `RepairCircuit` の `session` を**提出時の盤**に差し替えたもの
   * （`circuitForJudge()`）。素のJSONなので構造化複製でそのまま渡せる。
   * 部品を交換していれば `replacePart()` を通した `applied` が載っている（§9.2 部品交換）。
   */
  | {
      type: 'judgeRepair';
      problem: InspectRepairProblem;
      circuit: RepairCircuit;
      reports: readonly FaultReport[];
      elapsedMs: number;
    }
  /**
   * PLCの操作。§10.4 / §10.6
   *
   * テスター（`tester`）と同じく**1本のコマンド**にまとめる。ラダーの載せ替え・RUN/STOP・
   * モニタの開始停止・リセットはどれも「PLC本体に対する操作」で、種別ごとにコマンドを
   * 分けると片方だけ実装し忘れたときに静かにずれる。
   */
  | { type: 'plc'; action: PlcCommandAction }
  /**
   * モードDを判定する。§10.8
   * `ladder` は**変換を通った**ラダー（H-1）。`judgePlc()` は模範と訓練者の2回ぶんを
   * 10ms tick で最後まで回すので 0.3〜1 秒かかる（H-4）。`judgeRepair` と同じく
   * 追従ループを止めてから実行する。
   */
  | {
      type: 'judgePlc';
      problem: PlcProblem;
      session: BoardSession;
      ladder: LadderProgram;
      elapsedMs: number;
    }
  // --- Plan 5 Task 6 ---
  /**
   * 回路図を検算する。§11.4 / Plan 5 決定表#4
   * `document` は**訓練者がエディタで描いた文書**（素のJSONなので構造化複製でそのまま渡る）。
   * `judge` と同じく模範回路と訓練者回路の2回ぶんを回すので、追従ループを止めてから実行する。
   */
  | { type: 'verify'; problem: AssembleProblem; document: SchematicDocument; elapsedMs: number };
// --- /Plan 5 Task 6 ---

/** `plc` コマンドの中身。 */
export type PlcCommandAction =
  /** 変換済みのラダーを載せる（`compile()` は Worker 側で行う）。 */
  | { kind: 'load'; program: LadderProgram }
  /** RUN/STOP。`false` で `runtime.reset()` を呼び、Y接点を開く。 */
  | { kind: 'run'; on: boolean }
  /** モニタ（`F3`）の開始・停止。`true` の間だけスナップショットに `plc` が載る。 */
  | { kind: 'monitor'; on: boolean }
  /** デバイスを初期化する（RUN は保ったまま）。 */
  | { kind: 'reset' };

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

/**
 * テスター1個の表示状態。§9.3
 * `TesterReading`（Plan 2A）に、worker が積分している針の現在角度 `needleDeg` を添えたもの。
 */
export interface TesterSnapshot {
  kind: TesterKind;
  mode: TesterMode;
  /** 読値の生値（DCV/ACVは[V]、Ω／導通は[Ω]）。測定できないときは NaN。 */
  value: number;
  /** 表示文字列（`OFF` / `----` / `OL` / `導通` / `−−−` / 数値）。 */
  display: string;
  /** 針の目標角度[度]。 */
  targetDeg: number;
  /** 針の現在角度[度]（時定数100msで目標へ寄る）。 */
  needleDeg: number;
  /** レンジ上限を超えた（振り切れ）。§5.6 #2 */
  overRange: boolean;
  /** 通電中にΩ／導通を当てた。§5.6 #1 */
  live: boolean;
  /** 導通レンジでブザーが鳴る（50Ω以下）。§5.5 */
  conductive: boolean;
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
  /** テスターの読値と針（約30fpsで送る。tick ごとの更新は worker の中で行う）。§9.3 */
  tester: TesterSnapshot;
  /**
   * モニタ中のPLCの状態。§10.7 / 決定表#5
   * **モニタしていないときは `undefined`**（毎フレームの構造化複製と比較を避ける）。
   */
  plc?: PlcMonitorSnapshot;
  /** 追従上限を超えて捨てた tick 数の累計（ウィンドウ非表示時の詰まり）。 */
  droppedTicks: number;
}

/**
 * C1/C2 の判定結果。§9.1 / §9.2 / §13 #2
 * `ok: false` は「課題データの誤りで判定できなかった」ことを表す（C1では起きないが、
 * C2の模範回路が作れない場合があるので、結果画面へ行かず理由を出せるようにしておく）。
 */
export type InspectOutcome =
  { ok: true; value: JudgeInspectResult } | { ok: false; errors: ProblemIssue[] };

/** モードDの判定結果。§10.8 / §13 #2 */
export type PlcOutcome =
  { ok: true; value: JudgePlcResult } | { ok: false; errors: ProblemIssue[] };

/** worker → renderer のメッセージ。 */
export type SimMessage =
  | { type: 'snapshot'; snapshot: SimSnapshot }
  | { type: 'judgeResult'; result: JudgeAssembleResult }
  | { type: 'inspectResult'; result: InspectOutcome }
  | { type: 'plcResult'; result: PlcOutcome }
  /** 検算の結果。§11.4 / Plan 5 Task 6 */
  | { type: 'verifyResult'; result: VerifyResult }
  /**
   * エラー。§13 #6
   * `fatal: false` はコマンド1件が失敗しただけ（ループは回り続けるのでトーストで足りる）。
   * `fatal: true` は**追従ループが止まった**ことを意味し、renderer は例外バナーを出して
   * 「セッションをリセット」で Worker を立て直せるようにする。
   */
  | { type: 'error'; message: string; fatal: boolean };
