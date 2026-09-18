import { PLC_PART_ID } from '@ojt/board-model';
import { Simulation, TICK_MS, type Netlist } from '@ojt/circuit-sim';
import {
  createPlcRuntime,
  type CompiledProgram,
  type PlcIoPort,
  type PlcRuntime,
} from '@ojt/ladder-core';
import { runOperationsOn, type RunOptions, type RunResult } from './runner.js';
import type { Operation } from './schema/operations.js';

/**
 * PLCランタイムと回路エンジンの結合。設計仕様 §10.4 / §4.2 / 決定表#4。
 *
 * `@ojt/ladder-core` は回路エンジンを知らず、`@ojt/circuit-sim` はラダーを知らない。両方を知って
 * いるのはこのパッケージだけなので、結合点はここ1か所である。1 tick の順序は
 * 「①入力読込 ②ネットワーク実行 ③出力書込 → ④回路を解く」。入力は直前の tick の解に基づく値
 * なので、実機のスキャンと同じく1スキャンぶん遅れる。
 */

/** `Simulation` を `PlcIoPort` として見せる。§4.2 */
export function createSimulationIoPort(sim: Simulation, partId: string = PLC_PART_ID): PlcIoPort {
  return {
    readInputs: () => sim.plcInputs(partId),
    writeOutputs: (values) => {
      sim.setPlcOutputs(partId, values);
    },
  };
}

/** 結合オプション。 */
export interface PlcCouplingOptions {
  /** PLC本体の部品ID。既定 `PLC`。 */
  partId?: string;
  /** 出力配列の長さ。既定はラダーが使う最大番号＋1。 */
  outputCount?: number;
  /** スキャン周期[ms]。既定は `TICK_MS`（10）。§10.4 */
  scanMs?: number;
}

/** スキャンと tick の結合。 */
export interface PlcCoupling {
  runtime: PlcRuntime;
  /** `runOperations` の `beforeTick` にそのまま渡せる関数。 */
  beforeTick: (simulation: Simulation, tMs: number) => void;
}

/** シミュレーションとラダーを結ぶ。§10.4 */
export function createPlcCoupling(
  sim: Simulation,
  program: CompiledProgram,
  options: PlcCouplingOptions = {},
): PlcCoupling {
  const runtime = createPlcRuntime(program, {
    io: createSimulationIoPort(sim, options.partId ?? PLC_PART_ID),
    scanMs: options.scanMs ?? TICK_MS,
    ...(options.outputCount === undefined ? {} : { outputCount: options.outputCount }),
  });
  return {
    runtime,
    beforeTick: () => {
      runtime.scan();
    },
  };
}

/** モードDの再生オプション。 */
export interface PlcRunOptions extends RunOptions, PlcCouplingOptions {}

/** 再生結果（ランタイムの最終状態つき）。 */
export interface PlcRunResult extends RunResult {
  runtime: PlcRuntime;
}

/**
 * ラダー＋配線を操作列で再生する。§10.4 / §7.3
 * `runOperations()` と同じ規則（`t=0` で通電済み・10ms tick・決定論）で走り、
 * 各 tick の先頭で1スキャンずつラダーを実行する。
 */
export function runPlcOperations(
  netlist: Netlist,
  program: CompiledProgram,
  operations: readonly Operation[],
  options: PlcRunOptions,
): PlcRunResult {
  const simulation = new Simulation(netlist, {
    tickMs: options.tickMs ?? TICK_MS,
    ...(options.watch === undefined ? {} : { watch: options.watch }),
  });
  const coupling = createPlcCoupling(simulation, program, options);
  const result = runOperationsOn(simulation, operations, {
    ...options,
    beforeTick: coupling.beforeTick,
  });
  return { ...result, runtime: coupling.runtime };
}
