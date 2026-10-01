import {
  routeSession,
  routeFixedLinks,
  deskRoutes,
  dressWireRoutes,
  routeWire,
  RoutingError,
  isOffBoardTerminal,
  toPhysicalTerminal,
  type BoardDefinition,
  type BoardSession,
  type WireRoute,
  type DeskRoute,
} from '@ojt/board-model';
import { reasonOf } from '../app/errors.js';

/** 接続を保持し、描画できない電線だけを理由付きで返す。 */
export function safeRoutes(
  board: BoardDefinition,
  session: BoardSession | undefined,
): { routes: WireRoute[]; errors: RoutingError[] } {
  if (session === undefined) return { routes: [], errors: [] };
  if (!Array.isArray(session.wires)) return { routes: [], errors: [] };
  try {
    return { routes: routeSession(board, session), errors: [] };
  } catch {
    // 1本ずつやり直して、解けた電線だけでも描く（理由は下の loop が集める）
  }
  const routes: WireRoute[] = [];
  const errors: RoutingError[] = [];
  for (const [index, wire] of session.wires.entries()) {
    const wireId = typeof wire?.id === 'string' ? wire.id : `w-?${index}`;
    try {
      if (isOffBoardTerminal(wire.from) || isOffBoardTerminal(wire.to)) continue;
      routes.push(
        routeWire(
          board,
          {
            id: wire.id,
            from: toPhysicalTerminal(session.socketRoles, wire.from),
            to: toPhysicalTerminal(session.socketRoles, wire.to),
          },
          routes,
          session.wireRoutePreferences?.[wire.id] ?? {},
        ),
      );
    } catch (error) {
      errors.push(
        error instanceof RoutingError
          ? error
          : new RoutingError(reasonOf(error), wireId, 'invalid-terminal'),
      );
    }
  }
  return { routes, errors };
}

/** 既設線・盤内線・PLC線を同時に整え、同じ端子で別々の管が重ならないようにする。 */
export function visibleRoutes(
  board: BoardDefinition,
  session: BoardSession | undefined,
): {
  routes: WireRoute[];
  fixed: WireRoute[];
  desk: DeskRoute[];
  errors: RoutingError[];
} {
  const routed = safeRoutes(board, session);
  const fixed = routeFixedLinks(board);
  const desk = session === undefined ? [] : deskRoutes(board, session);
  let remaining = [...fixed, ...routed.routes, ...desk];
  let dressed: WireRoute[] = [];
  const errors = [...routed.errors];
  // 極端に混雑した作業ファイルでも、理由を出して盤と編集操作を残す。
  // 解けない線の接続データは消さず、危険な重なりで代用しない。
  while (remaining.length > 0) {
    try {
      dressed = dressWireRoutes(board, remaining);
      break;
    } catch (error) {
      if (!(error instanceof RoutingError) || !remaining.some((r) => r.wireId === error.wireId))
        throw error;
      errors.push(error);
      remaining = remaining.filter((r) => r.wireId !== error.wireId);
    }
  }
  const fixedIds = new Set(fixed.map((r) => r.wireId));
  const deskIds = new Set(desk.map((r) => r.wireId));
  return {
    fixed: dressed.filter((r) => fixedIds.has(r.wireId)),
    routes: dressed.filter((r) => !fixedIds.has(r.wireId) && !deskIds.has(r.wireId)),
    desk: dressed.filter((r) => deskIds.has(r.wireId)) as DeskRoute[],
    errors,
  };
}
