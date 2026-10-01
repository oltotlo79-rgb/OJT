import type { BoardDefinition, BoardTerminal } from './board-jipm.js';
import { polylineLength, vec3, vecEquals, type Vec3 } from './geometry.js';
import { filletCorners, RoutingError, type WireRoute } from './routing.js';
import { separateWireBodies } from './wire-clearance.js';
import { WIRE_PORT_PITCH_MM, WIRE_LUG_REACH_MM, type WireConnection } from './wire-connection.js';

const STRAIGHT_LEAD_MM = 10;
const EPS = 1e-6;

type End = { routeIndex: number; reversed: boolean; terminal: BoardTerminal; direction: Vec3 };

function endDirection(
  board: BoardDefinition,
  terminal: BoardTerminal,
  points: readonly Vec3[],
): Vec3 {
  // P/Nは縦並び。左から出せばPの電線がNのネジを横切らない。
  if (/^(P|N)\./u.test(terminal.id)) return vec3(-1, 0, 0);
  if (terminal.id.startsWith('PLC.')) {
    if (board.plcUnit?.form === 'rack') {
      const module = board.plcUnit.modules?.find(
        (item) => terminal.pos.x >= item.pos.x && terminal.pos.x <= item.pos.x + item.sizeMm.width,
      );
      if (module !== undefined)
        return vec3(terminal.pos.x < module.pos.x + module.sizeMm.width / 2 ? -1 : 1, 0, 0);
    }
    const away = points.find((p) => Math.abs(p.y - terminal.pos.y) > EPS);
    return vec3(0, (away?.y ?? terminal.pos.y + 1) < terminal.pos.y ? -1 : 1, 0);
  }
  if (terminal.id.startsWith('OUTLET.')) return vec3(0, 1, 0);
  const socket = board.sockets.find((item) => terminal.id.startsWith(`${item.id}.`));
  if (socket !== undefined) return vec3(0, terminal.exit === 'front' ? 1 : -1, 0);
  const away = points.find((p) => Math.abs(p.y - terminal.pos.y) > EPS);
  return vec3(0, (away?.y ?? terminal.pos.y - 1) < terminal.pos.y ? -1 : 1, 0);
}

function leadEnd(board: BoardDefinition, connection: WireConnection): Vec3 {
  const { contact, direction, terminalId } = connection;
  const socket = board.sockets.find((s) => terminalId.startsWith(`${s.id}.`));
  const length = /^(PLC|OUTLET)\./u.test(terminalId) ? 3 : STRAIGHT_LEAD_MM;
  const x = contact.x + direction.x * length;
  let y = contact.y + direction.y * length;
  if (socket !== undefined)
    y =
      direction.y < 0
        ? Math.min(y, socket.origin.y - 2.6)
        : Math.max(y, socket.origin.y + socket.bodyMm.length + 2.6);
  return vec3(x, y, contact.z);
}

/** 端子に接続した管の始点を、圧着端子のバレル出口へ移す。 */
function dressEnd(
  board: BoardDefinition,
  points: readonly Vec3[],
  end: End,
  slot: number,
  count: number,
  stack: number,
): { points: Vec3[]; cut: number; connection: WireConnection } {
  const { terminal, direction } = end;
  const offBoard = /^(PLC|OUTLET)\./u.test(terminal.id);
  const length = offBoard ? 3 : STRAIGHT_LEAD_MM;
  const offset = (slot - (count - 1) / 2) * (offBoard ? 2 : WIRE_PORT_PITCH_MM);
  const contact = vec3(
    terminal.pos.x + direction.x * WIRE_LUG_REACH_MM + direction.y * offset,
    terminal.pos.y + direction.y * WIRE_LUG_REACH_MM - direction.x * offset,
    terminal.pos.z + (offBoard ? 1.2 : 0.6),
  );
  const lead = vec3(contact.x + direction.x * length, contact.y + direction.y * length, contact.z);
  // ソケットの段・端子台の外へ出るまで線を下げない。内側の段も外側の段から見失わない。
  const socket = board.sockets.find((item) => terminal.id.startsWith(`${item.id}.`));
  let limit = lead.y;
  if (socket !== undefined) {
    limit =
      direction.y < 0
        ? Math.min(lead.y, socket.origin.y - 2.6)
        : Math.max(lead.y, socket.origin.y + socket.bodyMm.length + 2.6);
  }
  let cut = 1;
  if (direction.x !== 0) {
    while (
      cut < points.length - 1 &&
      Math.abs(points[cut]!.x - terminal.pos.x) < WIRE_LUG_REACH_MM + length - EPS
    )
      cut++;
  } else {
    while (cut < points.length - 1 && direction.y * (points[cut]!.y - limit) < -EPS) cut++;
  }
  const join = points[cut] ?? lead;
  const straight =
    direction.x !== 0 ? vec3(lead.x, contact.y, contact.z) : vec3(contact.x, limit, contact.z);
  const next: Vec3[] = [contact, straight];
  // ずらしは本体の外で戻す。端子のすぐ横でS字を作らない。
  next.push(vec3(straight.x, straight.y, join.z), vec3(straight.x, join.y, join.z));
  next.push(direction.y === 0 ? join : vec3(straight.x, join.y, join.z), ...points.slice(cut + 1));
  return {
    points: next.filter((p, i) => i === 0 || !vecEquals(p, next[i - 1]!)),
    cut,
    connection: { terminalId: terminal.id, screw: terminal.pos, contact, direction, slot: stack },
  };
}

/**
 * 自動経路の接続部分を整える。既設・盤内・机上の全線を同時に扱い、同じ端子の2本へ
 * 共通の出線間隔を割り当てる。ネットリスト・占有レーン・採点には影響しない。
 */
export function dressWireRoutes<T extends WireRoute>(
  board: BoardDefinition,
  routes: readonly T[],
): T[] {
  const terminals = new Map(board.terminals.map((t) => [`${t.pos.x},${t.pos.y},${t.pos.z}`, t]));
  const groups = new Map<string, End[]>();
  routes.forEach((route, routeIndex) => {
    for (const reversed of [false, true]) {
      const points = reversed ? [...route.corners].reverse() : route.corners;
      const first = points[0];
      const terminal =
        first === undefined ? undefined : terminals.get(`${first.x},${first.y},${first.z}`);
      if (terminal === undefined || !terminal.wirable) continue;
      const direction = endDirection(board, terminal, points);
      const key = `${terminal.id}:${direction.x},${direction.y}`;
      groups.set(key, [...(groups.get(key) ?? []), { routeIndex, reversed, terminal, direction }]);
    }
  });
  const result = routes.map((route) => ({
    ...route,
    points: [...route.corners],
    connections: [] as WireConnection[],
  }));
  const ends = new Map<number, { end: End; slot: number; count: number; stack: number }[]>();
  const stacks = new Map<string, number>();
  for (const group of groups.values()) {
    group.forEach((end, slot) => {
      const stack = stacks.get(end.terminal.id) ?? 0;
      stacks.set(end.terminal.id, stack + 1);
      ends.set(end.routeIndex, [
        ...(ends.get(end.routeIndex) ?? []),
        { end, slot, count: group.length, stack },
      ]);
    });
  }
  for (const [index, route] of result.entries()) {
    const assigned = ends.get(index) ?? [];
    const head = assigned.find(({ end }) => !end.reversed);
    const tail = assigned.find(({ end }) => end.reversed);
    const a =
      head === undefined
        ? undefined
        : dressEnd(board, route.corners, head.end, head.slot, head.count, head.stack);
    const b =
      tail === undefined
        ? undefined
        : dressEnd(
            board,
            [...route.corners].reverse(),
            tail.end,
            tail.slot,
            tail.count,
            tail.stack,
          );
    route.connections = [a?.connection, b?.connection].filter(
      (connection): connection is WireConnection => connection !== undefined,
    );
    const cutA = a?.cut ?? 0,
      cutB = b?.cut ?? 0;
    if (cutA + cutB < route.corners.length - 1) {
      route.points = [
        ...(a?.points.slice(0, a.points.length - (route.corners.length - cutA - 1)) ?? [
          route.corners[0]!,
        ]),
        ...route.corners.slice(cutA + 1, route.corners.length - cutB - 1),
        ...(b?.points.slice(0, b.points.length - (route.corners.length - cutB - 1)).reverse() ?? [
          route.corners.at(-1)!,
        ]),
      ];
    } else if (a !== undefined && b !== undefined) {
      const c = a.connection,
        d = b.connection;
      const leadA = leadEnd(board, c);
      const leadB = leadEnd(board, d);
      route.points = [
        c.contact,
        leadA,
        vec3(leadA.x, leadA.y, Math.max(leadA.z, leadB.z) + 2.8),
        vec3(leadB.x, leadA.y, Math.max(leadA.z, leadB.z) + 2.8),
        vec3(leadB.x, leadB.y, Math.max(leadA.z, leadB.z) + 2.8),
        leadB,
        d.contact,
      ];
    } else route.points = a?.points ?? b?.points.reverse() ?? route.points;
    if (route.kind === 'direct' && route.connections.length === 2) {
      const a = route.connections[0]!,
        b = route.connections[1]!;
      if (Math.abs(a.screw.y - b.screw.y) < EPS && a.direction.y === b.direction.y) {
        const leadA = leadEnd(board, a),
          leadB = leadEnd(board, b);
        const y =
          (a.direction.y < 0 ? Math.min(leadA.y, leadB.y) : Math.max(leadA.y, leadB.y)) +
          a.direction.y * route.lane * WIRE_PORT_PITCH_MM;
        const z = Math.max(a.contact.z, b.contact.z);
        route.points = [
          a.contact,
          vec3(a.contact.x, y, a.contact.z),
          vec3(a.contact.x, y, z),
          vec3(b.contact.x, y, z),
          vec3(b.contact.x, y, b.contact.z),
          b.contact,
        ].filter((p, i, all) => i === 0 || !vecEquals(p, all[i - 1]!));
      }
    }
  }
  const originalPoints = result.map((route) => [...route.points]);
  const wideEscapes = new Set<string>();
  while (true) {
    try {
      separateWireBodies(board, result, wideEscapes);
      break;
    } catch (error) {
      if (!(error instanceof RoutingError) || wideEscapes.has(error.wireId)) throw error;
      // 通れない線の出口だけを広げて再配置する。ほかの端子の空間を一律に塞がない。
      wideEscapes.add(error.wireId);
      result.forEach((route, i) => {
        route.points = [...originalPoints[i]!];
      });
    }
  }
  for (const route of result) {
    // 先頭の直線はマークチューブ用に残す。端子直後の短い線までフィレットで削らない。
    route.corners = [...route.points];
    const first = route.points[0];
    const last = route.points.at(-1);
    route.points = filletCorners(route.points, 0.8);
    if (first !== undefined && !vecEquals(first, route.points[0]!)) route.points.unshift(first);
    if (last !== undefined && !vecEquals(last, route.points.at(-1)!)) route.points.push(last);
    route.lengthMm = polylineLength(route.points);
  }
  return result;
}
