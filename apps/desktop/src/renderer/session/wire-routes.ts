import {
  routeSession,
  routeWire,
  RoutingError,
  toPhysicalTerminal,
  type BoardDefinition,
  type BoardSession,
  type WireRoute,
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
