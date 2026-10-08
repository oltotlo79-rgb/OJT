import { JIPM_BOARD, type BoardDefinition, type WireRoute } from '@ojt/board-model';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  buildPlcReferenceSession,
  buildReferenceSession,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { boardForProblem } from '../src/renderer/session/plc-session.js';
import { plcForVendor } from '../src/renderer/session/plc-skin.js';
import { visibleRoutes } from '../src/renderer/session/wire-routes.js';

/**
 * 電線がブレーカ・電源スイッチの本体を貫かない（v2.0.0 Task 9・総点検 F4）。
 *
 * 2026-10-08 の総点検で、PLC課題の P → PLC の電線が盤の上端を y=14mm でまっすぐ横切り、
 * ブレーカと電源スイッチ（高さ22mm）の中を通って見えていた。原因は電線の整形
 * （`separateWireBodies()` の `shortenBody()`）が避ける立体にこの2つが無かったこと。
 * ここでは**実際に描く経路**（整形後の `visibleRoutes()`）を全内蔵課題で調べ、
 * どの区間もブレーカ・電源スイッチの箱（外形＋0.8mm・高さ22.8mm）と交わらないことを縛る。
 */

/** 盤の固定機器（ブレーカ・電源スイッチ）の箱。 */
function fixtureBoxes(
  board: BoardDefinition,
): { id: string; x0: number; y0: number; x1: number; y1: number; zHi: number }[] {
  return board.footprints
    .filter((fp) => fp.kind === 'breaker' || fp.kind === 'switch')
    .map((fp) => ({
      id: fp.id,
      x0: fp.x - 0.8,
      y0: fp.y - 0.8,
      x1: fp.x + fp.w + 0.8,
      y1: fp.y + fp.h + 0.8,
      zHi: 22.8,
    }));
}

/** 経路の区間のうち、機器の箱と交わるものを `電線ID: 機器 (a → b)` の形で集める。 */
function penetrations(board: BoardDefinition, routes: readonly WireRoute[]): string[] {
  const boxes = fixtureBoxes(board);
  const out: string[] = [];
  for (const route of routes) {
    for (let i = 1; i < route.points.length; i += 1) {
      const a = route.points[i - 1];
      const b = route.points[i];
      if (a === undefined || b === undefined) continue;
      const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
      const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
      for (const box of boxes) {
        if (hi.x < box.x0 || lo.x > box.x1 || hi.y < box.y0 || lo.y > box.y1) continue;
        if (lo.z > box.zHi) continue;
        out.push(
          `${route.wireId}: ${box.id} (${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z.toFixed(1)} → ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)})`,
        );
      }
    }
  }
  return out;
}

describe('電線はブレーカ・電源スイッチの本体を貫かない（v2.0.0 Task 9）', () => {
  it('盤の固定機器は2つ（ブレーカ・電源スイッチ）', () => {
    expect(fixtureBoxes(JIPM_BOARD).map((box) => box.id).sort()).toEqual(['CB', 'SW']);
  });

  it.each(['mitsubishi', 'omron', 'jtekt', 'sharp'] as const)(
    '全PLC課題の模範配線（%s）',
    (vendor) => {
      const problems: string[] = [];
      for (const base of BUILTIN_PLC_PROBLEMS) {
        const problem = plcForVendor(base, vendor);
        if (problem === undefined) continue;
        const built = buildPlcReferenceSession(problem, JIPM_BOARD);
        if (!built.ok) throw new Error(JSON.stringify(built.errors));
        const visible = visibleRoutes(built.value.board, built.value.session);
        expect(visible.errors, problem.id).toEqual([]);
        for (const hit of penetrations(built.value.board, [
          ...visible.fixed,
          ...visible.routes,
          ...visible.desk,
        ]))
          problems.push(`${problem.id}: ${hit}`);
      }
      expect(problems).toEqual([]);
    },
  );

  it('全組立課題・全修復課題の模範配線', () => {
    const problems: string[] = [];
    for (const problem of [...BUILTIN_ASSEMBLE_PROBLEMS, ...BUILTIN_INSPECT_REPAIR_PROBLEMS]) {
      // 拡張盤（端子台の増設）を使う課題は、その課題の盤で経路を作る
      const board = boardForProblem(problem);
      const built = buildReferenceSession(problem, board);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      const visible = visibleRoutes(board, built.value.session);
      expect(visible.errors, problem.id).toEqual([]);
      for (const hit of penetrations(board, [...visible.fixed, ...visible.routes]))
        problems.push(`${problem.id}: ${hit}`);
    }
    expect(problems).toEqual([]);
  });
});
