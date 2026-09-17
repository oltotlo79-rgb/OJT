import {
  buildNets,
  MAX_NODES,
  plcMetaOf,
  validateNetlist,
  type TerminalId,
} from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  addWire,
  createSession,
  deskWires,
  JIPM_BOARD,
  PLC_UNIT_FX5U,
  routeSession,
  TASK1_SOCKET_ROLES,
  toNetlist,
  withPlcUnit,
  type BoardSession,
} from '../src/index.js';

const BOARD = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

function t(id: string): TerminalId {
  return id as TerminalId;
}

/** 盤 → PLC のシンク結線を最小限だけ張ったセッション。§10.2 */
function wired(): BoardSession {
  const session = createSession(BOARD, { roles: TASK1_SOCKET_ROLES });
  const link = (from: string, to: string): void => {
    const result = addWire(session, BOARD, t(from), t(to));
    if (!result.ok) throw new Error(`${from} → ${to}: ${result.message}`);
  };
  link('P.1', 'PLC.SS');
  link('TB_PB.1a', 'PLC.X0');
  link('TB_PB.1c', 'N.1');
  link('PLC.SS', 'PLC.COM0');
  link('PLC.Y0', 'CR1.14');
  link('OUTLET.L', 'PLC.L');
  link('OUTLET.N', 'PLC.N');
  return session;
}

describe('PLCを載せた盤のセッション', () => {
  it('lets the trainee wire board terminals to the PLC (§10.2)', () => {
    const session = wired();
    expect(session.wires.map((w) => w.id)).toContain('w-001');
    expect(session.wires.filter((w) => !w.locked)).toHaveLength(7);
  });

  it('refuses a third wire on a PLC terminal as well (§6.6)', () => {
    const session = wired();
    const first = addWire(session, BOARD, t('PLC.SS'), t('CR2.14'));
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.code).toBe('terminal-overload');
  });

  it('refuses PLC wiring on a board without the unit', () => {
    const session = createSession(JIPM_BOARD, { roles: TASK1_SOCKET_ROLES });
    const result = addWire(session, JIPM_BOARD, t('P.1'), t('PLC.SS'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unknown-terminal');
  });
});

describe('toNetlist（PLCつき）', () => {
  it('adds the PLC unit and the outlet at the end of the part list', () => {
    const netlist = toNetlist(wired(), BOARD);
    const ids = netlist.parts.map((p) => p.id);
    expect(ids.at(-2)).toBe('PLC');
    expect(ids.at(-1)).toBe('OUTLET');
    const plc = netlist.parts.find((p) => p.id === 'PLC');
    expect(plc === undefined ? undefined : plcMetaOf(plc)?.model).toBe('FX5U');
    expect(validateNetlist(netlist)).toEqual([]);
  });

  it('leaves the netlist unchanged for a board without a PLC', () => {
    const plain = toNetlist(createSession(JIPM_BOARD, { roles: TASK1_SOCKET_ROLES }), JIPM_BOARD);
    expect(plain.parts.some((p) => p.id === 'PLC')).toBe(false);
  });

  it('stays under the solver node limit with the PLC on the board (§5.2)', () => {
    const netlist = toNetlist(wired(), BOARD);
    const nets = buildNets(netlist);
    expect(nets.nodeCount).toBeLessThan(MAX_NODES);
  });

  it('puts the PLC input terminals and the board rails in the expected nets (§10.2)', () => {
    const netlist = toNetlist(wired(), BOARD);
    const nets = buildNets(netlist);
    const ssNode = nets.nodeOf(t('PLC.SS'));
    expect(nets.terminalsOf(ssNode)).toContain('P.1');
    expect(nets.terminalsOf(ssNode)).toContain('PLC.COM0');
  });
});

describe('机上配線の経路', () => {
  it('keeps desk wires out of the board routing (§6.6 の不変条件を壊さない)', () => {
    const session = wired();
    const routes = routeSession(BOARD, session);
    const routed = new Set(routes.map((r) => r.wireId));
    const desk = deskWires(BOARD, session);
    expect(desk.map((d) => d.id).sort()).toEqual(
      session.wires
        .filter(
          (w) =>
            w.from.startsWith('PLC.') ||
            w.to.startsWith('PLC.') ||
            w.from.startsWith('OUTLET.') ||
            w.to.startsWith('OUTLET.'),
        )
        .map((w) => w.id)
        .sort(),
    );
    for (const wire of desk) expect(routed.has(wire.id)).toBe(false);
    // 盤の中だけで閉じた電線はこれまでどおり経路が出る
    expect(routed.has('w-003')).toBe(true);
  });

  it('gives both endpoints of a desk wire a position for the 3D cable (Plan 3B)', () => {
    const desk = deskWires(BOARD, wired());
    const outlet = desk.find((d) => String(d.from) === 'OUTLET.L' || String(d.to) === 'OUTLET.L');
    expect(outlet?.fromPos).toBeDefined();
    expect(outlet?.toPos).toBeDefined();
  });
});
