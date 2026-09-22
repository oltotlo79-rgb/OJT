import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  assignToBoard,
  BUS_N,
  BUS_P,
  coil,
  createDocument,
  pbA,
  rung,
  toSession,
} from '../src/index.js';

describe('配線ゼロの盤への回路図変換', () => {
  const doc = createDocument('pb4', 'PB4でリレーを励磁', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB4'), coil('c2', 'CR1')]),
  ]);
  it('PからPB4への電線も明示して生成し、隠れた既設配線を前提にしない', () => {
    const assigned = assignToBoard(doc);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    expect(assigned.wires.map((wire) => [wire.from, wire.to])).toEqual([
      ['P.1', 'TB_PB.4c'],
      ['TB_PB.4a', 'CR1.14'],
      ['N.1', 'CR1.13'],
    ]);
    const built = toSession(doc, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.session.wires).toHaveLength(3);
    expect(built.session.wires.every((wire) => !wire.locked)).toBe(true);
  });
});
