import { describe, expect, it } from 'vitest';
import { toTerminalId, type TerminalId } from '@ojt/circuit-sim';
import {
  addWire,
  createSession,
  deskWires,
  isOffBoardTerminal,
  JIPM_BOARD,
  OUTLET_ORIGIN_MM,
  OUTLET_TERMINALS,
  PLC_ORIGIN_MM,
  PLC_UNIT_FX5U,
  routeSession,
  TASK1_SOCKET_ROLES,
  TERMINAL_PICK_RADIUS_MM,
  withPlcUnit,
} from '../src/index.js';

/**
 * Desk-terminal geometry invariants lifted from the Opus review of Plan 3A batches A-C
 * (`board-geometry.probe.ts`).
 */

const BOARD = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
const t = (id: string): TerminalId => toTerminalId(id);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('desk-terminal geometry (PLC + outlet)', () => {
  it('no two desk terminals are closer than two pick radii (>= 8mm, no ambiguous 3D picks)', () => {
    const desk = BOARD.terminals.filter((x) => isOffBoardTerminal(x.id));
    expect(desk.length).toBeGreaterThan(0);
    let min = Infinity;
    let worst = '';
    for (let i = 0; i < desk.length; i += 1) {
      for (let j = i + 1; j < desk.length; j += 1) {
        const d = dist(desk[i]!.pos, desk[j]!.pos);
        if (d < min) {
          min = d;
          worst = `${String(desk[i]!.id)} <-> ${String(desk[j]!.id)}`;
        }
      }
    }
    expect(min, `closest pair: ${worst}`).toBeGreaterThanOrEqual(2 * TERMINAL_PICK_RADIUS_MM);
    expect(2 * TERMINAL_PICK_RADIUS_MM).toBeGreaterThanOrEqual(8);
  });

  it('every PLC terminal sits inside the unit box and every outlet terminal is outside it', () => {
    const box = {
      x0: PLC_ORIGIN_MM.x,
      y0: PLC_ORIGIN_MM.y,
      x1: PLC_ORIGIN_MM.x + PLC_UNIT_FX5U.sizeMm.width,
      y1: PLC_ORIGIN_MM.y + PLC_UNIT_FX5U.sizeMm.height,
    };
    for (const term of PLC_UNIT_FX5U.terminals) {
      expect(term.pos.x, String(term.id)).toBeGreaterThanOrEqual(box.x0);
      expect(term.pos.x, String(term.id)).toBeLessThanOrEqual(box.x1);
      expect(term.pos.y, String(term.id)).toBeGreaterThanOrEqual(box.y0);
      expect(term.pos.y, String(term.id)).toBeLessThanOrEqual(box.y1);
    }
    for (const term of OUTLET_TERMINALS) {
      const inside =
        term.pos.x >= box.x0 &&
        term.pos.x <= box.x1 &&
        term.pos.y >= box.y0 &&
        term.pos.y <= box.y1;
      expect(inside, String(term.id)).toBe(false);
    }
    expect(OUTLET_ORIGIN_MM.y).toBeGreaterThan(box.y1);
  });

  it('all desk terminals (PLC + outlet) are entirely to the right of the board footprint', () => {
    const boardMaxX = Math.max(...JIPM_BOARD.terminals.map((x) => x.pos.x));
    for (const term of BOARD.terminals.filter((x) => isOffBoardTerminal(x.id))) {
      expect(term.pos.x, String(term.id)).toBeGreaterThan(boardMaxX);
    }
  });
});

describe('routeSession() and deskWires() partition the session wires', () => {
  function wired() {
    const s = createSession(BOARD, { roles: TASK1_SOCKET_ROLES });
    for (const [f, to] of [
      ['P.1', 'PLC.SS'],
      ['PLC.X0', 'TB_PB.1a'],
      ['TB_PB.1c', 'N.1'],
      ['PLC.SS', 'PLC.COM0'],
      ['OUTLET.L', 'PLC.L'],
      ['OUTLET.N', 'PLC.N'],
      ['CR1.13', 'TB_PL.1+'],
    ] as [string, string][]) {
      const r = addWire(s, BOARD, t(f), t(to));
      if (!r.ok) throw new Error(`${f} -> ${to}: ${r.code}`);
    }
    return s;
  }

  it('routeSession() and deskWires() are disjoint and their union is exactly session.wires', () => {
    const s = wired();
    const routed = routeSession(BOARD, s).map((r) => r.wireId);
    const desk = deskWires(BOARD, s).map((d) => d.id);
    expect([...routed, ...desk].sort()).toEqual(s.wires.map((w) => w.id).sort());
    expect(routed.filter((id) => desk.includes(id))).toEqual([]);
  });

  it('a PLC-to-PLC wire (SS -> COM0) is a desk wire, not a routed board wire', () => {
    const desk = deskWires(BOARD, wired());
    const ssCom = desk.find((d) => String(d.from) === 'PLC.SS' && String(d.to) === 'PLC.COM0');
    expect(ssCom).toBeDefined();
    expect(ssCom?.fromPos).toEqual(BOARD.terminals.find((x) => String(x.id) === 'PLC.SS')?.pos);
  });
});
