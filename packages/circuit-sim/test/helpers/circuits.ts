import {
  createNetlist,
  createWire,
  parseTerminalId,
  Simulation,
  terminalId,
} from '../../src/index.js';
import type {
  Netlist,
  Part,
  SimulationOptions,
  TerminalId,
  Wire,
  WireColor,
} from '../../src/index.js';

/** `"CR1.13"` 形式の文字列を TerminalId にする。テストを読みやすくするための糖衣。 */
export function t(id: string): TerminalId {
  const parsed = parseTerminalId(id);
  return terminalId(parsed.part, parsed.name);
}

/** 端子ID文字列から電線を作る。 */
export function w(id: string, from: string, to: string, color: WireColor = '青'): Wire {
  return createWire(id, t(from), t(to), color);
}

/** 部品と電線からネットリストを作る。 */
export function net(parts: Part[], wires: Wire[]): Netlist {
  return createNetlist(parts, wires, []);
}

/** 部品と電線からシミュレーションを作る。 */
export function bench(parts: Part[], wires: Wire[], options?: SimulationOptions): Simulation {
  return new Simulation(net(parts, wires), options);
}

/** 正しい手順（ブレーカ → 電源スイッチ）で通電する。§5.3.5 */
export function powerOn(sim: Simulation): void {
  sim.setBreaker(true);
  sim.setSwitch(true);
}

/** 正しい手順（電源スイッチ → ブレーカ）で遮断する。§5.3.5 */
export function powerOff(sim: Simulation): void {
  sim.setSwitch(false);
  sim.setBreaker(false);
}

/** その信号が最初に true になった時刻[ms]。 */
export function firstTrue(sim: Simulation, signal: string): number | undefined {
  return sim.log.transitions(signal).find((e) => e.value === true)?.tMs;
}
