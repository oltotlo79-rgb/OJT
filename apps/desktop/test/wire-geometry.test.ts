import { createSession, JIPM_BOARD, routeSession, TASK2_SOCKET_ROLES } from '@ojt/board-model';
import type { WireRoute } from '@ojt/board-model';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTubeGeometry,
  routeSignature,
  useTubeGeometry,
  WIRE_RADIUS_MM,
} from '../src/renderer/three/Wire.js';

/**
 * 電線のチューブ形状の作り直しと解放（§15）。
 *
 * `safeRoutes()` はセッションが変わるたびに**全部**の経路を作り直すので、
 * 経路オブジェクトの同一性でメモ化すると1本足すだけで全電線の `TubeGeometry` が作り直され、
 * 古いものは GPU バッファを抱えたまま残る（レビュー計測: undo/redo 40往復でヒープ +33MB）。
 */

const ROUTES = routeSession(
  JIPM_BOARD,
  createSession(JIPM_BOARD, { roles: TASK2_SOCKET_ROLES, allowedColors: ['青'] }),
);

function routeAt(index: number): WireRoute {
  const route = ROUTES[index];
  if (route === undefined) throw new Error('経路がありません');
  return route;
}

/** 同じ形の別オブジェクト（`safeRoutes()` が作り直したときと同じ状況）。 */
function cloneRoute(route: WireRoute): WireRoute {
  return { ...route, points: route.points.map((p) => ({ ...p })) };
}

afterEach(cleanup);

describe('routeSignature', () => {
  it('折れ点が同じなら別オブジェクトでも同じ署名になる', () => {
    const route = routeAt(0);
    expect(routeSignature(cloneRoute(route))).toBe(routeSignature(route));
  });

  it('電線IDか折れ点が違えば署名も違う', () => {
    expect(routeSignature(routeAt(0))).not.toBe(routeSignature(routeAt(1)));
    const moved = cloneRoute(routeAt(0));
    const first = moved.points[0];
    if (first === undefined) throw new Error('折れ点がありません');
    moved.points = [{ ...first, x: first.x + 1 }, ...moved.points.slice(1)];
    expect(routeSignature(moved)).not.toBe(routeSignature(routeAt(0)));
  });
});

describe('buildTubeGeometry', () => {
  it('点の足りない経路では例外を投げず、何も見えない管を返す（3Dを落とさない）', () => {
    for (const points of [[], [{ x: 10, y: 20, z: 0 }]]) {
      const empty = buildTubeGeometry({ ...routeAt(0), points });
      expect(empty.attributes['position']?.count ?? 0).toBeGreaterThan(0);
      empty.computeBoundingSphere();
      expect(empty.boundingSphere?.radius ?? -1).toBe(0);
      empty.dispose();
    }
  });
});

describe('useTubeGeometry', () => {
  it('経路の中身が同じなら作り直さない（オブジェクトが差し替わっても解放しない）', () => {
    const route = routeAt(0);
    const view = renderHook(({ r }: { r: WireRoute }) => useTubeGeometry(r), {
      initialProps: { r: route },
    });
    const first = view.result.current;
    const dispose = vi.spyOn(first, 'dispose');

    view.rerender({ r: cloneRoute(route) });

    expect(view.result.current).toBe(first);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('経路が変わったら作り直し、前の形は解放する', () => {
    const view = renderHook(({ r }: { r: WireRoute }) => useTubeGeometry(r), {
      initialProps: { r: routeAt(0) },
    });
    const first = view.result.current;
    const dispose = vi.spyOn(first, 'dispose');

    view.rerender({ r: routeAt(1) });

    expect(view.result.current).not.toBe(first);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('外れたときも解放する', () => {
    const view = renderHook(() => useTubeGeometry(routeAt(0)));
    const dispose = vi.spyOn(view.result.current, 'dispose');
    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('半径を指定すると太さの違う形になる（当たり判定用の太いチューブ）', () => {
    const thin = renderHook(() => useTubeGeometry(routeAt(0))).result.current;
    const thick = renderHook(() => useTubeGeometry(routeAt(0), WIRE_RADIUS_MM * 4, 4)).result
      .current;
    expect(thick).not.toBe(thin);
    thin.computeBoundingSphere();
    thick.computeBoundingSphere();
    expect(thick.boundingSphere?.radius ?? 0).toBeGreaterThan(thin.boundingSphere?.radius ?? 0);
  });
});
