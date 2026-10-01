import {
  JIPM_BOARD,
  distance,
  nearestPointOnPolyline,
  wireSegmentDistance,
  addWire,
  createSession,
  TASK2_SOCKET_ROLES,
  type BoardDefinition,
  type WireRoute,
} from '@ojt/board-model';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  buildReferenceSession,
  buildPlcReferenceSession,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { visibleRoutes } from '../src/renderer/session/wire-routes.js';
import { plcForVendor } from '../src/renderer/session/plc-skin.js';

function inspectConnections(board: BoardDefinition, routes: WireRoute[]): void {
  const ports = new Map<string, NonNullable<WireRoute['connections']>>();
  for (const route of routes) {
    expect(
      route.points.every((p) => Number.isFinite(p.x + p.y + p.z)),
      route.wireId,
    ).toBe(true);
    for (const connection of route.connections ?? []) {
      const terminal = board.terminals.find((t) => t.id === connection.terminalId);
      expect(connection.screw).toEqual(terminal?.pos);
      expect(connection.direction.z).toBe(0);
      expect(
        Math.hypot(
          connection.contact.x - connection.screw.x,
          connection.contact.y - connection.screw.y,
        ),
      ).toBeGreaterThan(3);
      const atStart = distance(connection.contact, route.points[0]!) < 1e-6;
      const atEnd = distance(connection.contact, route.points.at(-1)!) < 1e-6;
      expect(atStart || atEnd, `${route.wireId}: 端子の出口から電線が途切れない`).toBe(true);
      const list = ports.get(connection.terminalId) ?? [];
      list.push(connection);
      ports.set(connection.terminalId, list);
    }
    if ('throughPanelAt' in route && route.throughPanelAt !== undefined)
      expect(nearestPointOnPolyline(route.throughPanelAt, route.corners).distance).toBeLessThan(
        1e-6,
      );
  }
  const doublePorts = [...ports.values()].filter((list) => list.length > 1);
  expect(doublePorts.length).toBeGreaterThan(0);
  for (const list of doublePorts)
    expect(new Set(list.map((port) => port.slot)).size).toBe(list.length);
  for (const list of doublePorts)
    for (let i = 0; i < list.length; i++)
      for (const other of list.slice(i + 1))
        expect(distance(list[i]!.contact, other.contact)).toBeGreaterThanOrEqual(2 - 1e-6);
  for (let i = 0; i < routes.length; i++)
    for (const other of routes.slice(i + 1)) {
      let closest = Infinity;
      for (let p = 1; p < routes[i]!.points.length; p++)
        for (let q = 1; q < other.points.length; q++)
          closest = Math.min(
            closest,
            wireSegmentDistance(
              routes[i]!.points[p - 1]!,
              routes[i]!.points[p]!,
              other.points[q - 1]!,
              other.points[q]!,
            ),
          );
      expect(closest, `${routes[i]!.wireId} / ${other.wireId}`).toBeGreaterThanOrEqual(1.6 - 1e-4);
    }
}
describe('実際に表示する電線と端子の接続', () => {
  it('70本の自由配線でも、後の線の出口を先の線で塞がない', () => {
    let state = 14;
    const next = (): number =>
      (state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296;
    const terminals = JIPM_BOARD.terminals.filter((t) => t.wirable);
    const session = createSession(JIPM_BOARD, { roles: TASK2_SOCKET_ROLES, allowedColors: ['青'] });
    for (let attempt = 0; attempt < 360 && session.wires.length < 70; attempt++)
      addWire(
        session,
        JIPM_BOARD,
        terminals[Math.floor(next() * terminals.length)]!.id,
        terminals[Math.floor(next() * terminals.length)]!.id,
        '青',
      );
    expect(session.wires).toHaveLength(70);
    const visible = visibleRoutes(JIPM_BOARD, session);
    expect(visible.errors).toEqual([]);
    expect(visible.routes).toHaveLength(70);
    inspectConnections(JIPM_BOARD, [...visible.fixed, ...visible.routes]);
  });
  it('最も複雑な修復課題でも、接続・穴を保ち、元の配線データを書き換えない', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS.at(-1)!;
    const built = buildReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const original = JSON.stringify(built.value.session);
    const visible = visibleRoutes(JIPM_BOARD, built.value.session);
    expect(visible.errors).toEqual([]);
    inspectConnections(JIPM_BOARD, [...visible.fixed, ...visible.routes]);
    expect(JSON.stringify(built.value.session)).toBe(original);
  });
  it.each(['mitsubishi', 'jtekt', 'omron', 'sharp'] as const)(
    '%sのPLC線も、盤内線と同時に整理する',
    (vendor) => {
      const problem = plcForVendor(BUILTIN_PLC_PROBLEMS.at(-1)!, vendor);
      if (problem === undefined) throw new Error('課題が対応していません');
      const built = buildPlcReferenceSession(problem, JIPM_BOARD);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      const visible = visibleRoutes(built.value.board, built.value.session);
      expect(visible.errors).toEqual([]);
      inspectConnections(built.value.board, [...visible.fixed, ...visible.routes, ...visible.desk]);
    },
  );
});
