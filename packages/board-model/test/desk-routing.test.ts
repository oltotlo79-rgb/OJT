import type { TerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  addWire,
  BOARD_RUN_Y_Z_MM,
  BOARD_WIDTH_MM,
  boardExitRunZ,
  CHANNEL_LANE_COUNT,
  createSession,
  DESK_CORNER_RADIUS_MM,
  DESK_LANE_PITCH_MM,
  DESK_LIP_X_MM,
  DESK_MIN_CLEARANCE_MM,
  DESK_ROW_GAP_MM,
  DESK_ROW_LANE_MAX,
  DESK_RUN_X_Z_MM,
  DESK_RUN_Y_Z_MM,
  DESK_Z_LADDER_MM,
  deskDucts,
  deskObstacles,
  deskRouteIssues,
  deskRoutes,
  deskRowLaneCount,
  deskRunZ,
  deskTrunkLaneCount,
  deskWires,
  JIPM_BOARD,
  PLC_UNIT_CP1E,
  PLC_UNIT_FX5U,
  PLC_UNIT_JW300,
  PLC_UNIT_PC10G,
  plcCoverAt,
  screwStaggerMm,
  TASK1_SOCKET_ROLES,
  withPlcUnit,
  type BoardDefinition,
  type BoardSession,
  type DeskLaneSlot,
  type DeskRoute,
  type PlcUnitDefinition,
  type Vec3,
} from '../src/index.js';

/**
 * 机上の経路生成（設計仕様 §6.6 / §7 / §10.1 / §11.3）。
 * 盤の中の配線と同じように、机上のケーブルも直角に整列して並ぶことを固定する。
 */

const UNITS: readonly PlcUnitDefinition[] = [
  PLC_UNIT_FX5U,
  PLC_UNIT_CP1E,
  PLC_UNIT_PC10G,
  PLC_UNIT_JW300,
];

function t(id: string): TerminalId {
  return id as TerminalId;
}

/**
 * 課題 `d-001`（PLC自己保持回路）の模範配線25本。§10.2
 * `@ojt/content` の `plcWiringPlan()` と同じ並び（入力 → 出力 → 2段目 → P側 → N側 → 電源）を
 * 機種仕様から組み直したもの。`board-model` は `content` に依存できないのでここで作る。
 */
function referenceWiring(unit: PlcUnitDefinition): Array<[string, string]> {
  const plc = (name: string): string => `PLC.${name}`;
  const inputs = [0, 1, 2].map((i) => unit.spec.inputs[i]);
  const outputs = [0, 1, 2].map((i) => unit.spec.outputs[i]);
  const inputName = (i: number): string => inputs[i]?.name ?? '';
  const outputName = (i: number): string => outputs[i]?.name ?? '';
  const inputCommons = [...new Set(inputs.map((input) => input?.com ?? ''))];
  const outputCommons = [...new Set(outputs.map((output) => output?.com ?? ''))];
  const wires: Array<[string, string]> = [];
  const chain = (start: string, targets: readonly string[]): void => {
    let previous = start;
    for (const target of targets) {
      wires.push([previous, target]);
      previous = target;
    }
  };
  for (const i of [0, 1, 2]) wires.push([`TB_PB.${i + 1}a`, plc(inputName(i))]);
  for (const i of [0, 1, 2]) wires.push([plc(outputName(i)), `CR${i + 1}.14`]);
  for (const i of [0, 1, 2]) wires.push([`CR${i + 1}.5`, `TB_PL.${i + 1}+`]);
  chain('P.1', [
    ...inputCommons.map(plc),
    ...outputCommons.map(plc),
    ...[0, 1, 2].map((i) => `CR${i + 1}.9`),
  ]);
  chain('N.1', [
    ...[0, 1, 2].map((i) => `TB_PB.${i + 1}c`),
    ...[0, 1, 2].map((i) => `CR${i + 1}.13`),
    ...[0, 1, 2].map((i) => `TB_PL.${i + 1}-`),
  ]);
  wires.push(['OUTLET.L', plc(unit.spec.acPower[0] ?? 'L')]);
  wires.push(['OUTLET.N', plc(unit.spec.acPower[1] ?? 'N')]);
  return wires;
}

function referenceSession(unit: PlcUnitDefinition): {
  board: BoardDefinition;
  session: BoardSession;
} {
  const board = withPlcUnit(JIPM_BOARD, unit);
  const session = createSession(board, { roles: TASK1_SOCKET_ROLES });
  for (const [from, to] of referenceWiring(unit)) {
    const result = addWire(session, board, t(from), t(to));
    if (!result.ok) throw new Error(`${from} → ${to}: ${result.message}`);
  }
  return { board, session };
}

/** 折れ点列が直角経路か（隣り合う点で動く軸がちょうど1つか）。 */
function isManhattanPath(corners: readonly Vec3[]): boolean {
  for (let i = 1; i < corners.length; i += 1) {
    const p = corners[i - 1];
    const q = corners[i];
    if (p === undefined || q === undefined) return false;
    const moved = [Math.abs(q.x - p.x), Math.abs(q.y - p.y), Math.abs(q.z - p.z)].filter(
      (d) => d > 1e-6,
    );
    if (moved.length !== 1) return false;
  }
  return true;
}

function routeOf(routes: readonly DeskRoute[], wireId: string): DeskRoute {
  const found = routes.find((r) => r.wireId === wireId);
  if (found === undefined) throw new Error(`経路がありません: ${wireId}`);
  return found;
}

describe('deskRoutes（§10.1 / §11.3）', () => {
  it('returns nothing for a board without a PLC unit', () => {
    const session = createSession(JIPM_BOARD, { roles: TASK1_SOCKET_ROLES });
    expect(deskRoutes(JIPM_BOARD, session)).toEqual([]);
  });

  it.each(UNITS.map((unit) => [unit.model, unit] as const))(
    'routes every desk wire of the d-001 reference wiring (%s)',
    (_model, unit) => {
      const { board, session } = referenceSession(unit);
      expect(session.wires.filter((w) => !w.locked)).toHaveLength(25);
      const wires = deskWires(board, session);
      const routes = deskRoutes(board, session);
      // 経路は `deskWires()` が選んだ電線と1対1（盤の中で閉じた電線は含まない）
      expect(routes.map((r) => r.wireId).sort()).toEqual(wires.map((w) => w.id).sort());
      expect(routes.length).toBeGreaterThanOrEqual(10);
      for (const route of routes) {
        expect(route.points.length).toBeGreaterThan(3);
        expect(isManhattanPath(route.corners)).toBe(true);
        expect(route.lengthMm).toBeGreaterThan(0);
        expect(route.ductIds).toContain('desk-trunk');
      }
    },
  );

  it.each(UNITS.map((unit) => [unit.model, unit] as const))(
    'keeps the routes clear of each other and of the bodies and covers (%s)',
    (_model, unit) => {
      const { board, session } = referenceSession(unit);
      expect(deskRouteIssues(deskRoutes(board, session), board, unit)).toEqual([]);
    },
  );

  it.each(UNITS.map((unit) => [unit.model, unit] as const))(
    'ends every desk cable on its own terminal (%s)',
    (_model, unit) => {
      const { board, session } = referenceSession(unit);
      for (const route of deskRoutes(board, session)) {
        const wire = deskWires(board, session).find((w) => w.id === route.wireId);
        const first = route.corners[0];
        const last = route.corners[route.corners.length - 1];
        expect(first).toEqual(wire?.fromPos);
        expect(last).toEqual(wire?.toPos);
      }
    },
  );

  it.each(UNITS.map((unit) => [unit.model, unit] as const))(
    'enters the PLC terminal rows from the side the open cover has vacated (%s)',
    (_model, unit) => {
      const { board, session } = referenceSession(unit);
      let checked = 0;
      for (const route of deskRoutes(board, session)) {
        const n = route.corners.length;
        for (const [end, approach] of [
          [route.corners[0], route.corners[2]],
          [route.corners[n - 1], route.corners[n - 3]],
        ] as const) {
          if (end === undefined || approach === undefined) continue;
          if (plcCoverAt(unit, end) === undefined) continue;
          // 端子に入る最後の区間は必ず真上から降りてくる
          // （下ヒンジのカバーは手前へ倒れて本体の下をふさぐので、下から入れない）
          expect(approach.x).toBeCloseTo(end.x, 6);
          expect(approach.y).toBeLessThan(end.y);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
    },
  );

  it('keeps every cable out of the band the open bottom cover sweeps (FX5U)', () => {
    const { board, session } = referenceSession(PLC_UNIT_FX5U);
    const box = deskObstacles(board, PLC_UNIT_FX5U).find((b) => b.id.includes('output-cover'));
    expect(box).toBeDefined();
    if (box === undefined) return;
    // 開いた出力カバーは手前（z > 0）へ倒れてくるので、その帯には1点も置かない
    for (const route of deskRoutes(board, session)) {
      for (const p of route.corners) {
        const inside =
          p.x > box.rect.x &&
          p.x < box.rect.x + box.rect.w &&
          p.y > box.rect.y &&
          p.y < box.rect.y + box.rect.h &&
          p.z > box.zLoMm;
        expect(inside).toBe(false);
      }
    }
  });

  it('bundles parallel runs at the lane pitch and never below the clearance', () => {
    const { board, session } = referenceSession(PLC_UNIT_FX5U);
    const routes = deskRoutes(board, session);
    expect(DESK_LANE_PITCH_MM).toBeGreaterThanOrEqual(DESK_MIN_CLEARANCE_MM);
    // 幹線は1本1レーン（同じ x を2本が使わない）
    const trunkX = new Set(routes.map((r) => r.lane));
    expect(trunkX.size).toBe(routes.length);
  });

  it('separates the runs by direction so crossings never touch', () => {
    // x方向とy方向で高さを分けてある（どの段の差も 1.8mm ＞ 電線の直径1.6mm）
    expect(Math.abs(DESK_RUN_Y_Z_MM - DESK_RUN_X_Z_MM)).toBeCloseTo(1.8, 6);
    for (let i = 1; i < DESK_Z_LADDER_MM.length; i += 1) {
      expect((DESK_Z_LADDER_MM[i] ?? 0) - (DESK_Z_LADDER_MM[i - 1] ?? 0)).toBeCloseTo(1.8, 6);
    }
    const xSteps = DESK_Z_LADDER_MM.filter((_, i) => i % 2 === 0);
    const { board, session } = referenceSession(PLC_UNIT_FX5U);
    for (const route of deskRoutes(board, session)) {
      for (let i = 1; i < route.corners.length; i += 1) {
        const a = route.corners[i - 1];
        const b = route.corners[i];
        if (a === undefined || b === undefined) continue;
        if (Math.abs(a.x - b.x) > 1e-6 && a.x > DESK_LIP_X_MM && b.x > DESK_LIP_X_MM) {
          // x方向に走る区間は机上のはしごの偶数段にしか載らない（段が上がっても向きは守る）
          expect(xSteps).toContain(a.z);
        }
      }
    }
  });

  it('lifts the cable over the board lip on its way to the desk', () => {
    const { board, session } = referenceSession(PLC_UNIT_FX5U);
    const routes = deskRoutes(board, session);
    const fromBoard = routes.filter((r) => r.channelIds.length > 0);
    expect(fromBoard.length).toBeGreaterThan(0);
    for (const route of fromBoard) {
      const lift = route.corners.find(
        (p) => Math.abs(p.x - DESK_LIP_X_MM) < 1e-6 && Math.abs(p.z - DESK_RUN_X_Z_MM) < 1e-6,
      );
      expect(lift).toBeDefined();
      // 盤の上は盤の電線と同じ高さのはしごを使う（机上の段より低い）。端子そのものは除く
      const ends = [route.corners[0], route.corners[route.corners.length - 1]];
      const onBoard = route.corners.filter((p) => p.x < board.sizeMm.width && !ends.includes(p));
      expect(onBoard.every((p) => p.z <= BOARD_RUN_Y_Z_MM + 1e-6)).toBe(true);
    }
  });

  it('rounds the corners without breaking the right-angle skeleton', () => {
    const { board, session } = referenceSession(PLC_UNIT_FX5U);
    const route = deskRoutes(board, session)[0];
    expect(route).toBeDefined();
    if (route === undefined) return;
    expect(DESK_CORNER_RADIUS_MM).toBe(8);
    // 丸めた線は折れ点より点数が多く、両端は折れ点と同じ
    expect(route.points.length).toBeGreaterThan(route.corners.length);
    expect(route.points[0]).toEqual(route.corners[0]);
    expect(route.points[route.points.length - 1]).toEqual(route.corners[route.corners.length - 1]);
  });

  it('is deterministic and keeps the earlier cables when one is added', () => {
    const { board, session } = referenceSession(PLC_UNIT_FX5U);
    const before = deskRoutes(board, session);
    expect(deskRoutes(board, session)).toEqual(before);
    // 端子の並び順で並べてあるので、末尾の端子へ足しても先の経路は動かない
    const added = addWire(session, board, t('TB_PB.4a'), t('PLC.X7'), '青');
    expect(added.ok).toBe(true);
    const after = deskRoutes(board, session);
    expect(after).toHaveLength(before.length + 1);
    // 足した電線より内側（レーンの小さい側）の経路は1mmも動かない
    const inserted = after.find((r) => !before.some((b) => b.wireId === r.wireId));
    expect(inserted).toBeDefined();
    const moved = before
      .filter((route) => route.lane < (inserted?.lane ?? 0))
      .filter(
        (route) =>
          JSON.stringify(routeOf(after, route.wireId).corners) !== JSON.stringify(route.corners),
      );
    expect(moved).toEqual([]);
  });

  it('sorts the cables by terminal so the picture does not depend on the wiring order', () => {
    const { board, session } = referenceSession(PLC_UNIT_FX5U);
    const forward = deskRoutes(board, session).map((r) => r.wireId);
    const reversed = createSession(board, { roles: TASK1_SOCKET_ROLES });
    for (const [from, to] of [...referenceWiring(PLC_UNIT_FX5U)].reverse()) {
      const result = addWire(reversed, board, t(from), t(to));
      expect(result.ok).toBe(true);
    }
    // 電線IDは張った順に付くので並びは変わるが、レーンの並び方（端子の順）は同じ
    const key = (s: BoardSession, id: string): string => {
      const wire = s.wires.find((w) => w.id === id);
      return `${String(wire?.from)}→${String(wire?.to)}`;
    };
    expect(deskRoutes(board, reversed).map((r) => key(reversed, r.wireId))).toEqual(
      forward.map((id) => key(session, id)),
    );
  });

  it('carries the wire colour through to the drawing', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const session = createSession(board, {
      roles: TASK1_SOCKET_ROLES,
      allowedColors: ['青', '白'],
    });
    expect(addWire(session, board, t('TB_PB.1a'), t('PLC.X0'), '白').ok).toBe(true);
    expect(deskRoutes(board, session)[0]?.color).toBe('白');
  });

  it('routes a jumper between two PLC terminals as well', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const session = createSession(board, { roles: TASK1_SOCKET_ROLES });
    expect(addWire(session, board, t('PLC.SS'), t('PLC.COM0')).ok).toBe(true);
    const route = deskRoutes(board, session)[0];
    expect(route).toBeDefined();
    // 入力側（上ヒンジ）と出力側（下ヒンジ）は別の行ダクトに入る
    expect(route?.ductIds).toEqual(['desk-row-top', 'desk-trunk', 'desk-row-mid']);
    expect(route?.channelIds).toEqual([]);
  });

  it('gives the outlet cable its own duct below the socket plate', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const session = createSession(board, { roles: TASK1_SOCKET_ROLES });
    expect(addWire(session, board, t('OUTLET.L'), t('PLC.L')).ok).toBe(true);
    const route = deskRoutes(board, session)[0];
    expect(route?.ductIds).toContain('desk-outlet-row');
    expect(deskRouteIssues(deskRoutes(board, session), board, PLC_UNIT_FX5U)).toEqual([]);
  });

  it('fits the reference wiring in the wiring-channel lanes without overflow', () => {
    const { board, session } = referenceSession(PLC_UNIT_FX5U);
    // 帯ごとにレーンを数えるので、模範配線25本でも1本も溢れない
    expect(deskRoutes(board, session).every((r) => !r.laneOverflow)).toBe(true);
  });

  it('keeps two cables that leave the same terminal column a full clearance apart (BM-01)', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const session = createSession(board, { roles: TASK1_SOCKET_ROLES });
    // PLCのコモンを取るいちばん自然な2本。`P.1` と `N.1` は同じ列（x=20）に並んでいる
    expect(addWire(session, board, t('P.1'), t('PLC.SS')).ok).toBe(true);
    expect(addWire(session, board, t('N.1'), t('PLC.COM0')).ok).toBe(true);
    const routes = deskRoutes(board, session);
    expect(routes).toHaveLength(2);
    expect(deskRouteIssues(routes, board, PLC_UNIT_FX5U)).toEqual([]);
    // 引き出しの縦走りは、レーン番号のずらし（0.6mm）ではなく実数で中央そろえする
    const leads = routes.map((route) => route.corners[2]?.x ?? Number.NaN).sort((a, b) => a - b);
    expect(leads).toEqual([20 - DESK_MIN_CLEARANCE_MM / 2, 20 + DESK_MIN_CLEARANCE_MM / 2]);
  });

  it('lifts the ninth cable of one wiring channel onto the second layer (BM-02)', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const session = createSession(board, { roles: TASK1_SOCKET_ROLES });
    // `ch-mid` から机上へ出る端子を `CHANNEL_LANE_COUNT + 1` 本ぶん張る
    const sources = [
      'TB_PB.1c',
      'TB_PB.1a',
      'TB_PB.2c',
      'TB_PB.2a',
      'TB_PB.3c',
      'TB_PB.3a',
      'TB_PB.4c',
      'TB_PB.4a',
      'TB_PL.1+',
    ];
    expect(sources).toHaveLength(CHANNEL_LANE_COUNT + 1);
    sources.forEach((source, i) => {
      const input = PLC_UNIT_FX5U.spec.inputs[i]?.name ?? '';
      expect(addWire(session, board, t(source), t(`PLC.${input}`)).ok).toBe(true);
    });
    const routes = deskRoutes(board, session);
    expect(routes).toHaveLength(CHANNEL_LANE_COUNT + 1);
    expect(deskRouteIssues(routes, board, PLC_UNIT_FX5U)).toEqual([]);
    // 帯を走る行（縁を越える点の y と高さ）は9本とも別物で、9本目だけが2段目に載る
    const runs = routes.map((route) => {
      const p = route.corners.find((c) => Math.abs(c.x - DESK_LIP_X_MM) < 1e-6);
      return { y: p?.y ?? Number.NaN, z: p?.z ?? Number.NaN };
    });
    expect(new Set(runs.map((r) => `${String(r.y)}/${String(r.z)}`)).size).toBe(
      CHANNEL_LANE_COUNT + 1,
    );
    expect(new Set(runs.map((r) => r.y)).size).toBe(CHANNEL_LANE_COUNT);
    expect(runs.filter((r) => Math.abs(r.z - boardExitRunZ('x', 1)) < 1e-6)).toHaveLength(1);
    // 2段目に逃がせたので「他の電線と同じ場所に載った」警告は出ない
    expect(routes.every((route) => !route.laneOverflow)).toBe(true);
  });

  it('keeps the trunk off the board and the rows on the desk with 19 cables (BM-03)', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const session = createSession(board, { roles: TASK1_SOCKET_ROLES });
    const wires: Array<[string, string]> = [
      ['TB_PB.1a', 'PLC.X0'],
      ['TB_PB.2a', 'PLC.X1'],
      ['TB_PB.3a', 'PLC.X2'],
      ['TB_PB.4a', 'PLC.X3'],
      ['OUTLET.L', 'PLC.L'],
      ['OUTLET.N', 'PLC.N'],
      ['P.1', 'PLC.SS'],
      ['PLC.SS', 'PLC.COM0'],
      ['PLC.Y0', 'TB_PL.1+'],
      ['PLC.Y1', 'TB_PL.1-'],
      ['PLC.Y2', 'TB_PL.2+'],
      ['PLC.Y3', 'TB_PL.2-'],
      ['PLC.Y4', 'TB_PL.3+'],
      ['PLC.Y5', 'TB_PL.3-'],
      ['PLC.Y6', 'TB_PL.4+'],
      ['PLC.Y7', 'TB_PL.4-'],
      ['PLC.COM0', 'PLC.COM1'],
      ['PLC.COM1', 'PLC.COM2'],
      ['PLC.COM2', 'PLC.COM3'],
    ];
    expect(wires).toHaveLength(19);
    for (const [from, to] of wires) {
      expect(addWire(session, board, t(from), t(to)).ok).toBe(true);
    }
    const routes = deskRoutes(board, session);
    expect(routes).toHaveLength(19);
    expect(deskRouteIssues(routes, board, PLC_UNIT_FX5U)).toEqual([]);
    const trunks = routes.flatMap((route) => route.slots.filter((s) => s.ductId === 'desk-trunk'));
    const rows = routes.flatMap((route) => route.slots.filter((s) => s.ductId !== 'desk-trunk'));
    expect(trunks).toHaveLength(19);
    // 幹線は盤の外にとどまり、行ダクトは机の奥（y < 0）へはみ出さない
    expect(trunks.every((slot) => slot.atMm >= BOARD_WIDTH_MM)).toBe(true);
    expect(rows.every((slot) => slot.atMm >= 0)).toBe(true);
    // 幹線のレーンが一巡したら段を上げるので、19本が別々の場所に載る
    expect(new Set(trunks.map((s) => `${String(s.lane)}/${String(s.layer)}`)).size).toBe(19);
    expect(trunks.some((slot) => slot.layer > 0)).toBe(true);
  });

  it('clamps a run height outside the ladder to the first step of that direction', () => {
    expect(deskRunZ('x', 0)).toBe(DESK_RUN_X_Z_MM);
    expect(deskRunZ('y', 1)).toBe(DESK_Z_LADDER_MM[3]);
    expect(deskRunZ('x', 9)).toBe(DESK_RUN_X_Z_MM);
    expect(boardExitRunZ('y', 9)).toBe(BOARD_RUN_Y_Z_MM);
    // レーンの本数は盤の上・机の奥へはみ出さない範囲で決まる
    expect(deskTrunkLaneCount(PLC_UNIT_FX5U)).toBe(18);
    expect(deskRowLaneCount(13, -1)).toBe(6);
    expect(deskRowLaneCount(0, -1)).toBe(1);
    expect(deskRowLaneCount(206, 1)).toBe(DESK_ROW_LANE_MAX);
  });

  it('spreads several cables in one terminal column and leaves the middle free', () => {
    // 1本だけの列は端子の真上をまっすぐ降ろす
    expect(screwStaggerMm(0, 1)).toBe(0);
    // 2本以上なら真ん中を空けて外へ振り分ける（ネジの直前の区間と食い違わない）
    expect([0, 1, 2, 3].map((i) => screwStaggerMm(i, 4))).toEqual([-2, 2, -4, 4]);
  });
});

describe('deskDucts / deskObstacles', () => {
  it('draws the trunk left of the unit and the top row above it', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const ducts = deskDucts(board, PLC_UNIT_FX5U);
    const trunk = ducts.find((d) => d.id === 'desk-trunk');
    expect(trunk?.axis).toBe('y');
    expect(trunk?.at).toBeLessThan(PLC_UNIT_FX5U.pos.x);
    const top = ducts.find((d) => d.id === 'desk-row-top');
    expect(top?.at).toBe(PLC_UNIT_FX5U.pos.y - DESK_ROW_GAP_MM);
    // 一体形は上（入力側）と中ほど（出力側）の2本、ラックは上の1本だけ
    expect(ducts.filter((d) => d.id.startsWith('desk-row-')).map((d) => d.id)).toEqual([
      'desk-row-top',
      'desk-row-mid',
    ]);
    expect(
      deskDucts(board, PLC_UNIT_PC10G)
        .filter((d) => d.id.startsWith('desk-row-'))
        .map((d) => d.id),
    ).toEqual(['desk-row-top']);
  });

  it('puts the bodies and the board behind the terminal face', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_PC10G);
    const boxes = deskObstacles(board, PLC_UNIT_PC10G);
    expect(boxes.some((b) => b.id === 'board-plate')).toBe(true);
    expect(boxes.filter((b) => b.id.startsWith('body-'))).toHaveLength(5);
    for (const box of boxes.filter((b) => b.id.startsWith('body-'))) {
      expect(box.zHiMm).toBeLessThanOrEqual(0);
    }
    // ラックのモジュールのカバーは上ヒンジ＝奥へ倒れる（手前の空間を空ける）
    const covers = boxes.filter((b) => b.id.includes('cover-'));
    expect(covers.length).toBeGreaterThan(0);
    expect(covers.every((b) => b.zHiMm <= 0)).toBe(true);
  });

  it('sweeps the bottom-hinged cover forward, below the unit', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const box = deskObstacles(board, PLC_UNIT_FX5U).find((b) => b.id.includes('output-cover'));
    expect(box).toBeDefined();
    expect(box?.zLoMm).toBe(0);
    expect(box?.zHiMm).toBeGreaterThan(20);
    expect(box?.rect.y).toBe(PLC_UNIT_FX5U.pos.y + PLC_UNIT_FX5U.appearance.faceMm.height);
  });

  it('reports a cable that runs through an obstacle', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const fake: DeskRoute = {
      wireId: 'w-fake',
      kind: 'channel',
      color: '青',
      corners: [
        { x: 400, y: 110, z: 10 },
        { x: 420, y: 110, z: 10 },
      ],
      points: [
        { x: 400, y: 110, z: 10 },
        { x: 420, y: 110, z: 10 },
      ],
      channelIds: [],
      ductIds: [],
      slots: [],
      lanes: [],
      lane: 0,
      laneOverflow: false,
      lengthMm: 20,
    };
    const issues = deskRouteIssues([fake], board, PLC_UNIT_FX5U);
    expect(issues.join(' ')).toContain('output-cover');
  });

  it('still reaches the desk from a board that has no wiring channels', () => {
    const plain = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const board: BoardDefinition = { ...plain, wiringChannels: [] };
    const session = createSession(board, { roles: TASK1_SOCKET_ROLES });
    expect(addWire(session, board, t('TB_PB.1a'), t('PLC.X0')).ok).toBe(true);
    const route = deskRoutes(board, session)[0];
    expect(route?.channelIds).toEqual([]);
    // 帯が無くても盤の縁は同じところで越える
    expect(route?.corners.some((p) => Math.abs(p.x - DESK_LIP_X_MM) < 1e-6)).toBe(true);
  });

  it('sweeps a side-hinged cover sideways', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const sideways: PlcUnitDefinition = {
      ...PLC_UNIT_FX5U,
      appearance: {
        ...PLC_UNIT_FX5U.appearance,
        covers: [
          { id: 'left-cover', rect: { x: 0, y: 0, w: 20, h: 40 }, color: '#fff', hinge: 'left' },
          { id: 'right-cover', rect: { x: 60, y: 0, w: 20, h: 40 }, color: '#fff', hinge: 'right' },
        ],
      },
    };
    const boxes = deskObstacles(board, sideways);
    const left = boxes.find((b) => b.id.includes('left-cover'));
    const right = boxes.find((b) => b.id.includes('right-cover'));
    // 左ヒンジは奥へ、右ヒンジは手前へ倒れる（`coverOpenPose()` と同じ向き）
    expect(left?.rect.x).toBeLessThan(sideways.pos.x);
    expect(left?.zHiMm).toBe(0);
    expect(right?.rect.x).toBeGreaterThan(sideways.pos.x + 60);
    expect(right?.zLoMm).toBe(0);
  });

  it('reports a lane that two cables share, a trunk on the board and a row off the desk', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const withSlots = (id: string, slots: DeskLaneSlot[]): DeskRoute => ({
      wireId: id,
      kind: 'channel',
      color: '青',
      corners: [],
      points: [],
      channelIds: [],
      ductIds: [],
      slots,
      lanes: [],
      lane: 0,
      laneOverflow: false,
      lengthMm: 0,
    });
    const good: DeskLaneSlot = { ductId: 'desk-trunk', lane: 0, layer: 0, atMm: 376 };
    // 同じダクトの同じレーン・同じ段に2本
    expect(
      deskRouteIssues([withSlots('a', [good]), withSlots('b', [good])], board, PLC_UNIT_FX5U).join(
        ' ',
      ),
    ).toContain('同じレーンに2本');
    // 段が違えば重ならない
    expect(
      deskRouteIssues(
        [withSlots('a', [good]), withSlots('b', [{ ...good, layer: 1 }])],
        board,
        PLC_UNIT_FX5U,
      ),
    ).toEqual([]);
    // 幹線が盤の上（x < 盤幅）に載った
    expect(
      deskRouteIssues(
        [withSlots('a', [{ ...good, atMm: BOARD_WIDTH_MM - 1 }])],
        board,
        PLC_UNIT_FX5U,
      ).join(' '),
    ).toContain('幹線が盤の上');
    // 行ダクトが机の奥（y < 0）へはみ出した
    expect(
      deskRouteIssues(
        [withSlots('a', [{ ductId: 'desk-row-top', lane: 9, layer: 0, atMm: -17.4 }])],
        board,
        PLC_UNIT_FX5U,
      ).join(' '),
    ).toContain('机の奥へはみ出して');
  });

  it('reports two cables that run side by side too closely', () => {
    const board = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);
    const line = (id: string, y: number): DeskRoute => ({
      wireId: id,
      kind: 'channel',
      color: '青',
      corners: [
        { x: 350, y, z: DESK_RUN_X_Z_MM },
        { x: 380, y, z: DESK_RUN_X_Z_MM },
      ],
      points: [],
      channelIds: [],
      ductIds: [],
      slots: [],
      lanes: [],
      lane: 0,
      laneOverflow: false,
      lengthMm: 30,
    });
    expect(deskRouteIssues([line('a', 150), line('b', 150.5)], board, PLC_UNIT_FX5U)).toHaveLength(
      1,
    );
    expect(deskRouteIssues([line('a', 150), line('b', 153)], board, PLC_UNIT_FX5U)).toEqual([]);
  });
});
