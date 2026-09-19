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
  PLC_UNITS,
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

describe.each(Object.values(PLC_UNITS).map((unit) => [unit.model, unit] as const))(
  'desk-terminal geometry (%s + outlet)',
  (_model, unit) => {
    const board = withPlcUnit(JIPM_BOARD, unit);

    it('no two desk terminals are closer than two pick radii (>= 8mm)', () => {
      const desk = board.terminals.filter((x) => isOffBoardTerminal(x.id));
      expect(desk.length).toBeGreaterThan(0);
      for (let i = 0; i < desk.length; i += 1) {
        for (let j = i + 1; j < desk.length; j += 1) {
          const a = desk[i];
          const b = desk[j];
          if (a === undefined || b === undefined) continue;
          expect(dist(a.pos, b.pos), `${String(a.id)} <-> ${String(b.id)}`).toBeGreaterThanOrEqual(
            2 * TERMINAL_PICK_RADIUS_MM,
          );
        }
      }
      expect(2 * TERMINAL_PICK_RADIUS_MM).toBeGreaterThanOrEqual(8);
    });

    it('every PLC terminal sits inside the unit box and every outlet terminal is outside it', () => {
      const box = {
        x0: PLC_ORIGIN_MM.x,
        y0: PLC_ORIGIN_MM.y,
        x1: PLC_ORIGIN_MM.x + unit.sizeMm.width,
        y1: PLC_ORIGIN_MM.y + unit.sizeMm.height,
      };
      for (const term of unit.terminals) {
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

    it('all desk terminals are entirely to the right of the board footprint', () => {
      const boardMaxX = Math.max(...JIPM_BOARD.terminals.map((x) => x.pos.x));
      for (const term of board.terminals.filter((x) => isOffBoardTerminal(x.id))) {
        expect(term.pos.x, String(term.id)).toBeGreaterThan(boardMaxX);
      }
    });

    it('every rack terminal sits inside one of its modules', () => {
      if (unit.form !== 'rack') return;
      for (const term of unit.terminals) {
        const inside = (unit.modules ?? []).some(
          (module) =>
            term.pos.x >= module.pos.x &&
            term.pos.x <= module.pos.x + module.sizeMm.width &&
            term.pos.y >= module.pos.y &&
            term.pos.y <= module.pos.y + module.sizeMm.height,
        );
        expect(inside, String(term.id)).toBe(true);
      }
    });
  },
);

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
