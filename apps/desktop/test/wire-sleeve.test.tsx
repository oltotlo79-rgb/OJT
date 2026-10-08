import { JIPM_BOARD, WIRE_DIAMETER_MM, WIRE_LUG_REACH_MM } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS, buildReferenceSession } from '@ojt/content';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { visibleRoutes } from '../src/renderer/session/wire-routes.js';
import {
  SLEEVE_CENTER_OFFSET_MM,
  SLEEVE_LENGTH_MM,
  SLEEVE_RADIUS_MM,
  WireConnections,
} from '../src/renderer/three/WireConnections.js';

/**
 * 圧着端子の絶縁スリーブ（v2.0.0 Task 6・設計 §3.5）。
 *
 * 1.25sq 用の圧着端子には赤い絶縁被覆が付いていて、電線はその中へ入る。接続1つにつき
 * スリーブ1個をバレルの出口（`WIRE_LUG_REACH_MM`）の電線側に置き、電線の直線部
 * （`wire-dressing.ts` の STRAIGHT_LEAD_MM = 10mm）の中に収める。
 * R3F の要素は DOM へ未知のタグとして生えるので、位置・個数はそこから読む。
 */

afterEach(() => {
  cleanup();
});

describe('圧着端子の絶縁スリーブ（v2.0.0 Task 6）', () => {
  it('電線を包む太さで、バレルの出口から直線部の中に収まる', () => {
    expect(SLEEVE_RADIUS_MM).toBeGreaterThan(WIRE_DIAMETER_MM / 2);
    // 出口（REACH）より手前から始まり、直線部 10mm の中で終わる
    const start = SLEEVE_CENTER_OFFSET_MM - SLEEVE_LENGTH_MM / 2;
    const end = SLEEVE_CENTER_OFFSET_MM + SLEEVE_LENGTH_MM / 2;
    expect(start).toBeLessThan(0);
    expect(end).toBeGreaterThan(0);
    expect(end).toBeLessThan(10);
  });

  it('模範配線の接続1つにつきスリーブ1個を、圧着端子と同じ向きの組の中に置く', () => {
    const problem = BUILTIN_ASSEMBLE_PROBLEMS[0];
    if (problem === undefined) throw new Error('組立課題が無い');
    const built = buildReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const visible = visibleRoutes(JIPM_BOARD, built.value.session);
    const route = visible.routes.find((item) => (item.connections?.length ?? 0) > 0);
    if (route?.connections === undefined) throw new Error('接続のある電線が無い');

    const { container } = render(<WireConnections route={route} locked={false} />);
    const sleeves = container.querySelectorAll('mesh[name^="wire-sleeve-"]');
    expect(sleeves).toHaveLength(route.connections.length);
    for (const connection of route.connections) {
      const group = container.querySelector(
        `group[name="wire-connection-${connection.terminalId}-${String(connection.slot)}"]`,
      );
      expect(group, connection.terminalId).not.toBeNull();
      const sleeve = group?.querySelector('mesh[name^="wire-sleeve-"]');
      expect(sleeve, connection.terminalId).not.toBeNull();
      // 組のローカル座標（Y がバレルの向き）で、出口 REACH の少し先が中心
      const [, y] = (sleeve?.getAttribute('position') ?? '').split(',').map(Number);
      expect(y).toBeCloseTo(WIRE_LUG_REACH_MM + SLEEVE_CENTER_OFFSET_MM, 10);
    }
  });
});
