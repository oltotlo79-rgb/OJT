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
}

/** 再生結果。 */
export interface RunResult {
  simulation: Simulation;
  log: SignalLog;
  events: EventBus;
  /** 最後の tick の時刻[ms]（= `durationMs - tickMs`）。 */
  lastTickMs: number;
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
 * 各 tick の先頭で「その時刻の操作」を操作列の並び順に適用してから1tick進めるので、
 * `t` 時点の操作の効果は信号ログの `t` の記録に現れる。
 */
export function runOperations(
  netlist: Netlist,
  operations: readonly Operation[],
  options: RunOptions,
): RunResult {
  const tickMs = options.tickMs ?? TICK_MS;
  const simulation = new Simulation(netlist, {
    tickMs,
    ...(options.watch === undefined ? {} : { watch: options.watch }),
  });
  powerUp(simulation);

  const byTick = new Map<number, Operation[]>();
  for (const op of operations) {
    const bucket = byTick.get(op.t);
    if (bucket === undefined) byTick.set(op.t, [op]);
    else bucket.push(op);
  }

  let tMs = 0;
  for (; tMs < options.durationMs; tMs += tickMs) {
    for (const op of byTick.get(tMs) ?? []) {
      if (op.action === 'press') simulation.press(op.target);
      else simulation.release(op.target);
    }
    simulation.step(tickMs);
  }

  return {
    simulation,
    log: simulation.log,
    events: simulation.events,
    lastTickMs: Math.max(0, tMs - tickMs),
  };
}
