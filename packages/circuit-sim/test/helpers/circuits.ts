import { createNetlist, createWire, parseTerminalId, terminalId } from '../../src/index.js';
import type { Netlist, Part, TerminalId, Wire, WireColor } from '../../src/index.js';

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
