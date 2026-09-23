import { bench } from './circuits.js';
import {
  partId,
  terminalId,
  createWire,
  type Part,
  type Wire,
  type Simulation,
  type PlcUnitSpec,
} from '../../src/index.js';

/** 入力2点・出力2点の最小PLC（FX5U と同じ 4.5kΩ／3.5mA／1.5mA）。 */
export function tinySpec(): PlcUnitSpec {
  return {
    model: 'TEST-2',
    power: ['L', 'N', 'PE'],
    acPower: ['L', 'N'],
    inputCommons: ['SS'],
    service: ['24V', '0V'],
    inputs: ['X0', 'X1'].map((name) => ({ name, com: 'SS' })),
    commons: ['COM0'],
    outputs: [
      { name: 'Y0', com: 'COM0' },
      { name: 'Y1', com: 'COM0' },
    ],
    inputOhms: 4500,
    onAmps: 0.0035,
    offAmps: 0.0015,
  };
}

export function poweredPlcBench(parts: Part[], wires: Wire[]): Simulation {
  const outlet: Part = {
    id: partId('OUTLET'),
    kind: 'terminal-block',
    terminals: [terminalId('OUTLET', 'L'), terminalId('OUTLET', 'N')],
    elements: [],
    meta: { kind: 'terminal-block' },
  };
  const supplied = parts
    .filter((part) => part.meta.kind === 'plc')
    .flatMap((part) =>
      part.meta.kind === 'plc'
        ? part.meta.acPower.map((terminal, index) =>
            createWire(
              `ac-${part.id}-${index}`,
              terminalId('OUTLET', index === 0 ? 'L' : 'N'),
              terminal,
            ),
          )
        : [],
    );
  return bench([...parts, outlet], [...wires, ...supplied]);
}
