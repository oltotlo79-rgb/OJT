import type { BoardDefinition, BoardTerminal } from './board-jipm.js';
import { plcFaces } from './plc-unit.js';
import {
  distance,
  nearestPointOnSegment,
  polylineLength,
  rectContains,
  segmentIntersectsRect,
  vec3,
  vecEquals,
  wireSegmentDistance,
  type Rect,
  type Vec3,
} from './geometry.js';
import { RoutingError, type WireRoute } from './routing.js';
import { WIRE_SLEEVE_RADIUS_MM, type WireConnection } from './wire-connection.js';

const EPS = 1e-6;

type Occupied = { id: string; a: Vec3; b: Vec3; radius: number };
const CELL_MM = 8;
const CLEARANCE_MM = 2.5;

/** 線の直径を含めた占有索引。既設線・立下がり・曲がり角も避ける。 */
class WireSpace {
  private cells = new Map<string, Occupied[]>();
  private results = new Map<string, boolean>();
  private obstacles: Rect[];
  private deskScrews: BoardTerminal[];
  private plcBody: Rect | undefined;
  private plcBanks: Rect[];
  constructor(
    board: BoardDefinition,
    private holes: Map<string, Vec3>,
    private ports: Map<string, WireConnection[]>,
  ) {
    /*
     * 電線が通れない立体: ソケット・端子台に加えて**ブレーカ・電源スイッチ**（v2.0.0 Task 9・
     * 総点検 F4）。以前はこの2つが無かったので、`shortenBody()` が机上へ出る P の電線を
     * 「盤の上端をまっすぐ右へ」と縮め、ブレーカと電源スイッチの本体（高さ22mm）を貫いていた。
     * DC24V電源（`supply`）は P/N 端子そのものを含むので障害物にしない（出線は左へ出す）。
     */
    this.obstacles = board.footprints
      .filter(
        (fp) =>
          fp.kind === 'socket' ||
          fp.kind === 'block' ||
          fp.kind === 'breaker' ||
          fp.kind === 'switch',
      )
      .map((fp) => ({ x: fp.x - 0.8, y: fp.y - 0.8, w: fp.w + 1.6, h: fp.h + 1.6 }));
    this.deskScrews = board.terminals.filter((terminal) => /^(PLC|OUTLET)\./u.test(terminal.id));
    const unit = board.plcUnit;
    this.plcBody =
      unit === undefined
        ? undefined
        : { x: unit.pos.x, y: unit.pos.y, w: unit.sizeMm.width, h: unit.sizeMm.height };
    this.plcBanks =
      unit === undefined
        ? []
        : plcFaces(unit).flatMap((face) =>
            face.appearance.covers.map((cover) => ({
              x: face.origin.x + cover.rect.x,
              y: face.origin.y + cover.rect.y - 4,
              w: cover.rect.w,
              h: cover.rect.h + 8,
            })),
          );
  }
  private keys(a: Vec3, b: Vec3): string[] {
    const keys: string[] = [];
    for (
      let x = Math.floor((Math.min(a.x, b.x) - CLEARANCE_MM) / CELL_MM);
      x <= Math.floor((Math.max(a.x, b.x) + CLEARANCE_MM) / CELL_MM);
      x++
    )
      for (
        let y = Math.floor((Math.min(a.y, b.y) - CLEARANCE_MM) / CELL_MM);
        y <= Math.floor((Math.max(a.y, b.y) + CLEARANCE_MM) / CELL_MM);
        y++
      )
        for (
          let z = Math.floor((Math.min(a.z, b.z) - CLEARANCE_MM) / CELL_MM);
          z <= Math.floor((Math.max(a.z, b.z) + CLEARANCE_MM) / CELL_MM);
          z++
        )
          keys.push(`${x},${y},${z}`);
    return keys;
  }
  add(id: string, a: Vec3, b: Vec3, radius = 0.8): void {
    this.results.clear();
    const segment = { id, a, b, radius };
    for (const key of this.keys(a, b))
      this.cells.set(key, [...(this.cells.get(key) ?? []), segment]);
  }
  clear(id: string, a: Vec3, b: Vec3): boolean {
    const key = `${id}:${a.x},${a.y},${a.z}:${b.x},${b.y},${b.z}`;
    const cached = this.results.get(key);
    if (cached !== undefined) return cached;
    const clear = this.isClear(id, a, b);
    if (this.results.size >= 20000) this.results.clear();
    this.results.set(key, clear);
    return clear;
  }
  private isClear(id: string, a: Vec3, b: Vec3): boolean {
    if (a.x < 0.85 || b.x < 0.85) return false;
    if (
      Math.min(a.z, b.z) > -0.85 &&
      Math.max(a.z, b.z) < 0.85 &&
      (Math.abs(a.x - b.x) > EPS || Math.abs(a.y - b.y) > EPS)
    )
      return false;
    const owned = this.ports.get(id) ?? [];
    for (const terminal of this.deskScrews) {
      if (owned.some((port) => port.terminalId === terminal.id)) continue;
      if (
        terminal.pos.x < Math.min(a.x, b.x) - 3 ||
        terminal.pos.x > Math.max(a.x, b.x) + 3 ||
        terminal.pos.y < Math.min(a.y, b.y) - 3 ||
        terminal.pos.y > Math.max(a.y, b.y) + 3
      )
        continue;
      if (
        nearestPointOnSegment({ ...terminal.pos, z: 0 }, { ...a, z: 0 }, { ...b, z: 0 }).distance <
        3 - EPS
      )
        return false;
    }
    const body = this.plcBody;
    if (
      body !== undefined &&
      Math.abs(a.y - b.y) < EPS &&
      Math.abs(a.x - b.x) > EPS &&
      a.y > body.y &&
      a.y < body.y + body.h
    ) {
      const lo = Math.max(Math.min(a.x, b.x), body.x),
        hi = Math.min(Math.max(a.x, b.x), body.x + body.w);
      if (
        hi > lo + EPS &&
        !this.plcBanks.some(
          (bank) =>
            a.y >= bank.y && a.y <= bank.y + bank.h && lo >= bank.x && hi <= bank.x + bank.w,
        )
      )
        return false;
    }
    if (a.z > 0.8 && b.z > 0.8) {
      for (const obstacle of this.obstacles) {
        if (
          rectContains(obstacle, a) ||
          rectContains(obstacle, b) ||
          segmentIntersectsRect(a, b, obstacle)
        )
          return false;
      }
    }
    const seen = new Set<Occupied>();
    for (const key of this.keys(a, b))
      for (const segment of this.cells.get(key) ?? []) {
        if (segment.id === id || seen.has(segment)) continue;
        seen.add(segment);
        const ownHole = this.holes.get(id),
          otherHole = this.holes.get(segment.id);
        const nearHole = (p: Vec3, hole: Vec3): boolean =>
          Math.hypot(p.x - hole.x, p.y - hole.y) < 4;
        const nearShaft =
          ownHole !== undefined &&
          otherHole !== undefined &&
          (nearHole(a, ownHole) || nearHole(b, ownHole)) &&
          (nearHole(segment.a, otherHole) || nearHole(segment.b, otherHole));
        const deskPorts = owned.filter((port) => /^(PLC|OUTLET)\./u.test(port.terminalId));
        const otherDeskPorts = (this.ports.get(segment.id) ?? []).filter((port) =>
          /^(PLC|OUTLET)\./u.test(port.terminalId),
        );
        const atDeskPort =
          deskPorts.some(
            (port) => Math.min(distance(a, port.contact), distance(b, port.contact)) < 7,
          ) &&
          otherDeskPorts.some(
            (port) =>
              Math.min(distance(segment.a, port.contact), distance(segment.b, port.contact)) < 7,
          );
        const clearance =
          Math.max(a.z, b.z, segment.a.z, segment.b.z) < 0 || nearShaft || atDeskPort
            ? 1.75
            : 0.8 + segment.radius + 0.6;
        if (wireSegmentDistance(a, b, segment.a, segment.b) < clearance - EPS) return false;
      }
    return true;
  }
  pathClear(id: string, points: Vec3[]): boolean {
    return points.slice(1).every((point, i) => this.clear(id, points[i]!, point));
  }
}

function cleanPoints(points: readonly Vec3[]): Vec3[] {
  const result: Vec3[] = [];
  for (const point of points) {
    if (result.length && vecEquals(result.at(-1)!, point)) continue;
    const earlier = result.findIndex((item) => vecEquals(item, point));
    if (earlier >= 0) {
      result.splice(earlier + 1);
      continue;
    }
    while (result.length > 1) {
      const a = result.at(-2)!,
        b = result.at(-1)!;
      const u = vec3(b.x - a.x, b.y - a.y, b.z - a.z),
        v = vec3(point.x - b.x, point.y - b.y, point.z - b.z);
      if (Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) > EPS)
        break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

function freeCorner(space: WireSpace, id: string, point: Vec3): Vec3 {
  const accessible = (p: Vec3): boolean =>
    space.clear(id, p, p) &&
    space.clear(id, p, vec3(p.x, p.y, p.z + 2.8 * (p.z < 0 ? -1 : 1))) &&
    [
      [2.8, 0, 0],
      [-2.8, 0, 0],
      [0, 2.8, 0],
      [0, -2.8, 0],
    ].some(([x, y, z]) => space.clear(id, p, vec3(p.x + x!, p.y + y!, p.z + z!)));
  if (accessible(point)) return point;
  // 盤の上の走行だけを移す。端子からの平らな直線部は固定する。
  for (let level = 1; level <= 16; level++) {
    for (const [dx, dy, dz] of [
      [0, 0, level * 2.8 * (point.z < 0 ? -1 : 1)],
      [level * 2.8, 0, 0],
      [-level * 2.8, 0, 0],
      [0, level * 2.8, 0],
      [0, -level * 2.8, 0],
    ] as const) {
      const candidate = vec3(point.x + dx, point.y + dy, point.z + dz);
      if (candidate.x < 1 || candidate.y < -5 || (point.z > 0 && candidate.z < 1)) continue;
      if (accessible(candidate)) return candidate;
    }
  }
  return point;
}

function connectFree(space: WireSpace, id: string, a: Vec3, b: Vec3): Vec3[] | undefined {
  if (
    [a.x - b.x, a.y - b.y, a.z - b.z].filter((value) => Math.abs(value) > EPS).length <= 1 &&
    space.clear(id, a, b)
  )
    return [a, b];
  const paths: Vec3[][] = [];
  const xyz = (z: number): Vec3[] => [
    a,
    vec3(a.x, a.y, z),
    vec3(b.x, a.y, z),
    vec3(b.x, b.y, z),
    b,
  ];
  const yxz = (z: number): Vec3[] => [
    a,
    vec3(a.x, a.y, z),
    vec3(a.x, b.y, z),
    vec3(b.x, b.y, z),
    b,
  ];
  for (let level = 0; level <= 12; level++) {
    const z =
      a.z < 0 && b.z < 0 ? Math.min(a.z, b.z) - level * 2.8 : Math.max(a.z, b.z) + level * 2.8;
    paths.push(xyz(z), yxz(z));
    for (const shift of [
      2.8, -2.8, 5.6, -5.6, 8.4, -8.4, 11.2, -11.2, 16.8, -16.8, 22.4, -22.4, 28, -28, 39.2, -39.2,
    ]) {
      paths.push(
        [
          a,
          vec3(a.x + shift, a.y, a.z),
          vec3(a.x + shift, a.y, z),
          vec3(b.x + shift, a.y, z),
          vec3(b.x + shift, b.y, z),
          vec3(b.x + shift, b.y, b.z),
          b,
        ],
        [
          a,
          vec3(a.x, a.y + shift, a.z),
          vec3(a.x, a.y + shift, z),
          vec3(a.x, b.y + shift, z),
          vec3(b.x, b.y + shift, z),
          vec3(b.x, b.y + shift, b.z),
          b,
        ],
      );
    }
  }
  paths.sort((x, y) => polylineLength(x) + x.length * 0.6 - polylineLength(y) - y.length * 0.6);
  for (const path of paths) if (space.pathClear(id, path)) return cleanPoints(path);
  for (let level = 0; level <= 12; level++) {
    const z =
      a.z < 0 && b.z < 0 ? Math.min(a.z, b.z) - level * 2.8 : Math.max(a.z, b.z) + level * 2.8;
    const arms = (p: Vec3): Vec3[][] => {
      const all = [[p, vec3(p.x, p.y, z)]];
      for (const shift of [
        2.8, -2.8, 5.6, -5.6, 11.2, -11.2, 22.4, -22.4, 28, -28, 39.2, -39.2, 56, -56, 78.4, -78.4,
      ])
        all.push(
          [p, vec3(p.x + shift, p.y, p.z), vec3(p.x + shift, p.y, z)],
          [p, vec3(p.x, p.y + shift, p.z), vec3(p.x, p.y + shift, z)],
          [p, vec3(p.x, p.y, z), vec3(p.x + shift, p.y, z)],
          [p, vec3(p.x, p.y, z), vec3(p.x, p.y + shift, z)],
        );
      return all
        .map(cleanPoints)
        .filter((path) => space.pathClear(id, path))
        .sort((x, y) => polylineLength(x) - polylineLength(y));
    };
    const from = arms(a),
      to = arms(b);
    for (const head of from)
      for (const tail of to) {
        const p = head.at(-1)!,
          q = tail.at(-1)!;
        for (const corner of [vec3(p.x, q.y, z), vec3(q.x, p.y, z)]) {
          if (space.pathClear(id, [p, corner, q]))
            return cleanPoints([...head, corner, ...[...tail].reverse()]);
        }
      }
  }
  const searched = searchFreePath(space, id, a, b) ?? searchFreePath(space, id, b, a)?.reverse();
  return searched;
}

/** 混雑した曲がり角では局所探索で空いた位置へ回る。端点と接続部は固定する。 */
function searchFreePath(space: WireSpace, id: string, a: Vec3, b: Vec3): Vec3[] | undefined {
  const step = 2.8;
  type Node = { point: Vec3; key: string; cost: number; priority: number; previous?: Node };
  const heuristic = (p: Vec3): number =>
    Math.abs(p.x - b.x) + Math.abs(p.y - b.y) + Math.abs(p.z - b.z);
  const coordinates = (start: number, end: number, lo: number, hi: number): number[] => {
    const values = new Set([start, end, lo, hi]);
    for (const origin of [start, end])
      for (let i = Math.ceil((lo - origin) / step); i <= Math.floor((hi - origin) / step); i++)
        values.add(Number((origin + i * step).toFixed(6)));
    return [...values]
      .sort((x, y) => x - y)
      .filter((value, i, all) => i === 0 || value - all[i - 1]! > EPS);
  };
  const xs = coordinates(a.x, b.x, Math.max(1.2, Math.min(a.x, b.x) - 80), Math.max(a.x, b.x) + 80);
  const ys = coordinates(a.y, b.y, Math.min(a.y, b.y) - 40, Math.max(a.y, b.y) + 40);
  const zs = coordinates(
    a.z,
    b.z,
    Math.min(a.z, b.z) < 0 ? Math.min(a.z, b.z) - 28 : 0.85,
    Math.max(a.z, b.z) + 28,
  );
  const indexOf = (values: number[], value: number): number =>
    values.findIndex((item) => Math.abs(item - value) < EPS);
  const source: Node = {
    point: a,
    key: `${indexOf(xs, a.x)},${indexOf(ys, a.y)},${indexOf(zs, a.z)}`,
    cost: 0,
    priority: heuristic(a),
  };
  const heap: Node[] = [];
  const push = (node: Node): void => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]!.priority <= node.priority) break;
      heap[i] = heap[parent]!;
      i = parent;
    }
    heap[i] = node;
  };
  const pop = (): Node => {
    const first = heap[0]!,
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1]!.priority < heap[child]!.priority) child++;
        if (heap[child]!.priority >= last.priority) break;
        heap[i] = heap[child]!;
        i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  push(source);
  const costs = new Map<string, number>([[source.key, 0]]);
  // 局所探索で出口の閉塞を延々と探さず、出口を広げる再配置へ移る。
  for (let visited = 0; heap.length && visited < 20000; visited++) {
    const node = pop();
    if (node.cost > (costs.get(node.key) ?? Infinity) + EPS) continue;
    if (vecEquals(node.point, b)) {
      const path: Vec3[] = [];
      let current: Node | undefined = node;
      while (current !== undefined) {
        path.push(current.point);
        current = current.previous;
      }
      return cleanPoints(path.reverse());
    }
    const [ix, iy, iz] = node.key.split(',').map(Number) as [number, number, number];
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      const x = xs[ix + dx],
        y = ys[iy + dy],
        z = zs[iz + dz];
      if (x === undefined || y === undefined || z === undefined) continue;
      const next = vec3(x, y, z);
      const key = `${ix + dx},${iy + dy},${iz + dz}`,
        cost = node.cost + distance(node.point, next);
      if (cost >= (costs.get(key) ?? Infinity) - EPS || !space.clear(id, node.point, next))
        continue;
      costs.set(key, cost);
      push({ point: next, key, cost, priority: cost + heuristic(next) * 1.00001, previous: node });
    }
  }
  return undefined;
}

/** 接続とマークチューブの位置を固定し、胴体だけを空いた並走位置へ整える。 */
export function separateWireBodies(
  board: BoardDefinition,
  routes: (WireRoute & { connections: WireConnection[] })[],
  wideEscapes: ReadonlySet<string> = new Set(),
): void {
  const holes = new Map(
    routes.filter((r) => r.throughPanelAt !== undefined).map((r) => [r.wireId, r.throughPanelAt!]),
  );
  const space = new WireSpace(
    board,
    holes,
    new Map(routes.map((route) => [route.wireId, route.connections])),
  );
  for (const route of routes) {
    route.points = cleanPoints(route.points);
    if (route.throughPanelAt !== undefined) {
      const hole = route.throughPanelAt;
      for (let i = 1; i < route.points.length; i++) {
        if (
          !vecEquals(route.points[i - 1]!, hole) &&
          !vecEquals(route.points[i]!, hole) &&
          nearestPointOnSegment(hole, route.points[i - 1]!, route.points[i]!).distance < EPS
        ) {
          route.points.splice(i, 0, hole);
          break;
        }
      }
      space.add(route.wireId, vec3(hole.x, hole.y, 4.2), vec3(hole.x, hole.y, -12));
    }
    if (route.connections.length === 0 || route.points.length < 3) continue;
    if (route.connections.some((c) => vecEquals(c.contact, route.points[0]!)))
      space.add(
        route.wireId,
        route.points[0]!,
        route.points[1]!,
        /^(PLC|OUTLET)\./u.test(
          route.connections.find((c) => vecEquals(c.contact, route.points[0]!))!.terminalId,
        )
          ? 0.8
          : WIRE_SLEEVE_RADIUS_MM,
      );
    if (route.connections.some((c) => vecEquals(c.contact, route.points.at(-1)!)))
      space.add(
        route.wireId,
        route.points.at(-2)!,
        route.points.at(-1)!,
        /^(PLC|OUTLET)\./u.test(
          route.connections.find((c) => vecEquals(c.contact, route.points.at(-1)!))!.terminalId,
        )
          ? 0.8
          : WIRE_SLEEVE_RADIUS_MM,
      );
    for (const connection of route.connections) {
      const anchor = vecEquals(connection.contact, route.points[0]!)
        ? route.points[1]!
        : route.points.at(-2)!;
      // 後から整える線の立上がりを、先に描く線の曲がり角で塞がない。
      space.add(
        route.wireId,
        anchor,
        vec3(anchor.x, anchor.y, anchor.z + (wideEscapes.has(route.wireId) ? 8.4 : 2.8)),
      );
      space.add(
        route.wireId,
        anchor,
        vec3(
          anchor.x + connection.direction.x * 2.8,
          anchor.y + connection.direction.y * 2.8,
          anchor.z,
        ),
      );
    }
  }
  for (const route of routes) {
    if (route.points.length < 3) continue;
    const firstFixed = route.connections.some((c) => vecEquals(c.contact, route.points[0]!))
      ? 1
      : 0;
    const lastFixed = route.connections.some((c) => vecEquals(c.contact, route.points.at(-1)!))
      ? route.points.length - 2
      : route.points.length - 1;
    const raw = route.points.map((p, i) =>
      i <= firstFixed ||
      i >= lastFixed ||
      (route.throughPanelAt !== undefined && vecEquals(p, route.throughPanelAt))
        ? p
        : freeCorner(space, route.wireId, p),
    );
    const points = raw.slice(0, firstFixed + 1);
    for (let i = firstFixed + 1; i <= lastFixed; i++) {
      const path = connectFree(space, route.wireId, points.at(-1)!, raw[i]!);
      if (path !== undefined) points.push(...path.slice(1));
      else if (i === lastFixed) {
        const direct = connectFree(space, route.wireId, raw[firstFixed]!, raw[lastFixed]!);
        if (direct === undefined)
          throw new RoutingError(
            '端子の出口から重ならずに通せる電線経路がありません',
            route.wireId,
            'unreachable',
          );
        points.splice(firstFixed + 1, points.length, ...direct.slice(1));
      } else if (route.throughPanelAt !== undefined && vecEquals(raw[i]!, route.throughPanelAt))
        throw new RoutingError('既設線の貫通位置に到達できません', route.wireId, 'unreachable');
    }
    points.push(...raw.slice(lastFixed + 1));
    route.points = shortenBody(space, route.wireId, points, firstFixed, route.throughPanelAt);
    for (let i = 1; i < route.points.length; i++)
      space.add(route.wireId, route.points[i - 1]!, route.points[i]!);
  }
}

/** 無駄な折り返しを取り除く。端子の直線部と盤の貫通位置は維持する。 */
function shortenBody(
  space: WireSpace,
  id: string,
  input: Vec3[],
  firstFixed: number,
  hole: Vec3 | undefined,
): Vec3[] {
  let points = cleanPoints(input);
  for (let pass = 0; pass < points.length; pass++) {
    let changed = false;
    for (let i = firstFixed; i < points.length - 3 && !changed; i++)
      for (let j = points.length - 2; j > i + 1; j--) {
        if (
          hole !== undefined &&
          points
            .slice(i + 1, j)
            .some(
              (p) =>
                vecEquals(p, hole) || nearestPointOnSegment(hole, points[i]!, p).distance < EPS,
            )
        )
          continue;
        const a = points[i]!,
          b = points[j]!;
        const oldLength = polylineLength(points.slice(i, j + 1));
        for (const axes of ['xyz', 'xzy', 'yxz', 'yzx', 'zxy', 'zyx']) {
          const path = [a];
          let current = a;
          for (const axis of axes as Iterable<'x' | 'y' | 'z'>) {
            current = { ...current, [axis]: b[axis] };
            path.push(current);
          }
          const clean = cleanPoints(path);
          if (polylineLength(clean) >= oldLength - EPS || !space.pathClear(id, clean)) continue;
          points = cleanPoints([...points.slice(0, i), ...clean, ...points.slice(j + 1)]);
          changed = true;
          break;
        }
        if (changed) break;
      }
    if (!changed) break;
  }
  return points;
}
