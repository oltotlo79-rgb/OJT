import {
  Simulation,
  TICK_MS,
  type EventBus,
  type Netlist,
  type SignalLog,
  type TerminalId,
} from '@ojt/circuit-sim';
import type { Operation } from './schema/operations.js';

/**
 * 操作列の再生。設計仕様 §7.3 / §8.3。
 * `t=0` の時点で正しい手順（ブレーカ → 電源スイッチ）により通電済みとし、以降は
 * 操作列を tick に合わせて適用しながら `durationMs` まで進める。乱数を使わないので決定論（§5.2）。
 */

/** 再生オプション。 */
export interface RunOptions {
  /** 判定区間の長さ[ms]。§7.3 */
  durationMs: number;
  /** 1tickの長さ[ms]。既定は `TICK_MS`（10ms）。§5.2 */
  tickMs?: number;
  /** 電位をログに残す端子（信号名は `V:<端子ID>`）。§5.7 */
  watch?: readonly TerminalId[];
  /**
   * 各 tick の先頭（操作の適用の後、`step()` の前）に呼ばれる。§10.4
   * モードDでは PLC のスキャン（入力読込 → ラダー実行 → 出力書込）をここで回す。
   */
  beforeTick?: (simulation: Simulation, tMs: number) => void;
}

/** 再生結果。 */
export interface RunResult {
  simulation: Simulation;
  log: SignalLog;
  events: EventBus;
  /** 最後の tick の時刻[ms]（= `durationMs - tickMs`）。 */
  lastTickMs: number;
}

/** 判定と見直しが共有する、途中で止められる操作列の実行器。 */
export interface OperationPlayback {
  /** 指定時刻の直前まで同じtick順で進む。既に過ぎた時刻へは戻らない。 */
  advanceUntil: (untilMs: number) => RunResult;
}

export interface OperationWindow {
  fromMs: number;
  toMs: number;
  /** 同じtickの操作は、判定と同じくまとめて適用する。空配列は最初の通電区間。 */
  operations: readonly Operation[];
}

/** 最初の操作前の差分も見落とさず、同時操作に架空の中間状態を作らない。 */
export function operationWindows(
  operations: readonly Operation[],
  durationMs: number,
): OperationWindow[] {
  const windows: OperationWindow[] = [{ fromMs: 0, toMs: durationMs, operations: [] }];
  for (const op of operations) {
    const at = Math.ceil(op.t / TICK_MS) * TICK_MS;
    if (at >= durationMs) continue;
    const previous = windows[windows.length - 1]!;
    if (at === previous.fromMs) previous.operations = [...previous.operations, op];
    else {
      previous.toMs = at;
      windows.push({ fromMs: at, toMs: durationMs, operations: [op] });
    }
  }
  return windows;
}

/**
 * 正しい手順で通電する（ブレーカ → 電源スイッチ）。§5.3.5
 * 逆順にすると `power-sequence-violation` が出るため、判定の再生では必ずこの順で呼ぶ。
 */
export function powerUp(simulation: Simulation): void {
  simulation.setBreaker(true);
  simulation.setSwitch(true);
}

/**
 * 操作列を再生する。§7.3
 * 各 tick の先頭で「まだ適用していない `t <= 現在時刻` の操作」を操作列の並び順に適用してから
 * 1tick進めるので、`t` 時点の操作の効果は信号ログの `t` の記録に現れる。
 *
 * 時刻で引く表ではなく先頭からの走査にしてあるのは、tick に載らない `t`（`t: 5`、あるいは
 * 既定と違う `tickMs`）の操作を黙って捨てないため。その操作は直後の tick で適用される。
 *
 * **注意**: `Simulation` は渡されたネットリストの実行時状態（接点の `energized` ／電源の
 * `enabled`）をリセットし、以後も書き換える。同じネットリストを別の判定や表示に使い回すと
 * 互いの状態を壊すので、模範回路と訓練者回路にはそれぞれ別のネットリストを渡すこと。
 */
export function runOperations(
  netlist: Netlist,
  operations: readonly Operation[],
  options: RunOptions,
): RunResult {
  const simulation = new Simulation(netlist, {
    tickMs: options.tickMs ?? TICK_MS,
    ...(options.watch === undefined ? {} : { watch: options.watch }),
  });
  return runOperationsOn(simulation, operations, options);
}

/**
 * 既に作ったシミュレーションで操作列を再生する。§7.3
 * PLCのスキャンのように「シミュレーションを先に作ってから結線したいもの」があるときに使う（§10.4）。
 * `options.watch` はシミュレーション生成時にしか効かないのでここでは無視する。
 */
export function runOperationsOn(
  simulation: Simulation,
  operations: readonly Operation[],
  options: RunOptions,
): RunResult {
  return createOperationPlayback(simulation, operations, options).advanceUntil(options.durationMs);
}

/** 全区間の判定も1歩ずつの再生も、操作→PLCスキャン→回路tickの順序をここだけで定める。 */
export function createOperationPlayback(
  simulation: Simulation,
  operations: readonly Operation[],
  options: RunOptions,
): OperationPlayback {
  const tickMs = options.tickMs ?? TICK_MS;
  if (!Number.isFinite(tickMs) || tickMs <= 0) throw new Error('tickMs は正の有限値にします');
  powerUp(simulation);
  let cursor = 0;
  let tMs = 0;
  return {
    advanceUntil: (untilMs) => {
      if (!Number.isFinite(untilMs) || untilMs < 0)
        throw new Error('再生時刻は0以上の有限値にします');
      const end = Math.min(untilMs, options.durationMs);
      for (; tMs < end; tMs += tickMs) {
        for (
          let op = operations[cursor];
          op !== undefined && op.t <= tMs;
          op = operations[cursor]
        ) {
          if (op.action === 'press') simulation.press(op.target);
          else simulation.release(op.target);
          cursor += 1;
        }
        options.beforeTick?.(simulation, tMs);
        simulation.step(tickMs);
      }
      return {
        simulation,
        log: simulation.log,
        events: simulation.events,
        lastTickMs: Math.max(0, tMs - tickMs),
      };
    },
  };
}
