import {
  channelsClearOfFootprints,
  createSession,
  crossesFootprint,
  crossingFootprint,
  isManhattan,
  JIPM_BOARD,
  routeFixedLinks,
  routeSession,
  routeWire,
  RoutingError,
  TASK2_SOCKET_ROLES,
  toPhysicalTerminal,
  validateBoard,
  WIRE_Z_LADDER_MM,
  type WireRoute,
} from '@ojt/board-model';
import { createWire, toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { runAddWire } from '../src/renderer/session/commands.js';
import { wireBodyColor } from '../src/renderer/three/Wire.js';
import { WIRE_COLORS, WIRE_LANE_OVERFLOW_COLOR } from '../src/renderer/session/colors.js';

/**
 * 配線経路の検証（§6.6）。
 * 「電線がリレー／タイマの上を通らないこと」は3Dの見た目の問題ではなく、
 * 実機ではあり得ない配線を訓練者に見せないための要件なので、純粋関数のテストで担保する。
 */

function session() {
  return createSession(JIPM_BOARD, { roles: TASK2_SOCKET_ROLES, allowedColors: ['青'] });
}

/**
 * 折れ点に出てよい高さ[mm]。走行高さは `WIRE_Z_LADDER_MM` の段だけ、
 * それ以外は端子の高さ（ソケット10・端子台8・本体−12・供給6）と盤面0（既設ハーネスの貫通）。
 * 「どこかに 2.4mm の折れ点がある」ではなく**この集合に収まっている**ことを見る
 * （純y方向の渡り線のように 2.4 を1度も通らない経路があるため）。
 */
const ALLOWED_CORNER_Z = new Set<number>([
  ...WIRE_Z_LADDER_MM,
  ...JIPM_BOARD.terminals.map((t) => t.pos.z),
  0,
]);

/** はしごの段から外れた折れ点（足し算のずれもここで落ちる）。 */
function strayCorners(route: WireRoute): string[] {
  return route.corners
    .filter((p) => !ALLOWED_CORNER_Z.has(p.z))
    .map((p) => `${route.wireId} z=${p.z}`);
}

describe('部品の占有矩形（§6.6）', () => {
  it('盤定義がソケット・端子台・機器の占有矩形を持つ', () => {
    expect(JIPM_BOARD.footprints.length).toBeGreaterThanOrEqual(JIPM_BOARD.sockets.length);
    expect(JIPM_BOARD.footprints.some((f) => f.kind === 'socket')).toBe(true);
  });

  it('配線帯は占有矩形と重ならない位置にある', () => {
    expect(JIPM_BOARD.wiringChannels.length).toBeGreaterThan(0);
    // 帯はレーン8本ぶんの幅を持つ（`channelBandRect`）。その帯が部品に被っていたら経路器が破綻する
    expect(channelsClearOfFootprints(JIPM_BOARD)).toEqual([]);
    expect(validateBoard(JIPM_BOARD)).toEqual([]);
  });
});

describe('routeWire（直角配線・部品回避）', () => {
  it('端子から立ち上げて配線帯の高さを走り、折れ点は直角になる', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-1', from: toTerminalId('P.1'), to: toTerminalId('S1.10') },
      [],
    );
    expect(route.kind).toBe('channel');
    // 走行高さは経路器が決める（x方向は 2.4 / 6.0、y方向は 4.2 / 7.8）。描画側は計算しない
    expect(strayCorners(route)).toEqual([]);
    expect(route.corners.some((p) => (WIRE_Z_LADDER_MM as readonly number[]).includes(p.z))).toBe(
      true,
    );
    expect(isManhattan(route.corners)).toBe(true);
    expect(crossesFootprint(JIPM_BOARD, route)).toBe(false);
  });

  it('純粋にy方向だけ渡る経路は x方向の段（2.4mm）を1度も通らない', () => {
    // 「どこかに 2.4mm がある」という決め打ちの検査が成り立たないことの担保（§6.6）
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-0', from: toTerminalId('P.1'), to: toTerminalId('N.1') },
      [],
    );
    expect(route.kind).toBe('direct');
    expect(route.corners.every((p) => p.z !== WIRE_Z_LADDER_MM[0])).toBe(true);
    expect(strayCorners(route)).toEqual([]);
  });

  it('ソケットをまたぐ配線でも部品の上を通らない', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-2', from: toTerminalId('S1.9'), to: toTerminalId('S4.13') },
      [],
    );
    expect(crossesFootprint(JIPM_BOARD, route)).toBe(false);
  });

  it('左クラスタから右クラスタへ渡る配線も部品の上を通らない', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-3', from: toTerminalId('S1.14'), to: toTerminalId('S8.13') },
      [],
    );
    expect(crossesFootprint(JIPM_BOARD, route)).toBe(false);
  });

  it('端子台からソケットへ渡る配線も部品の上を通らない', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-4', from: toTerminalId('TB_PB.1a'), to: toTerminalId('S2.5') },
      [],
    );
    expect(crossesFootprint(JIPM_BOARD, route)).toBe(false);
  });

  it('束になる電線はレーンがずれて並走する', () => {
    const first = routeWire(
      JIPM_BOARD,
      { id: 'w-5', from: toTerminalId('TB_PB.1c'), to: toTerminalId('S1.14') },
      [],
    );
    const second = routeWire(
      JIPM_BOARD,
      { id: 'w-6', from: toTerminalId('TB_PB.1c'), to: toTerminalId('S2.14') },
      [first],
    );
    expect(second.lane).toBeGreaterThan(first.lane);
    expect(isManhattan(second.corners)).toBe(true);
  });

  it('角はフィレットで丸められ、点が増える', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-7', from: toTerminalId('P.1'), to: toTerminalId('TB_PL.1+') },
      [],
    );
    expect(route.points.length).toBeGreaterThan(6);
  });
});

describe('配線操作の結果の経路（§6.6 / §8.2）', () => {
  it('模範回路ぶんの配線をすべて張っても、どの経路も部品の上を通らない', () => {
    const board = session();
    // P/N は各1点しかないので母線は渡り配線で分配する（§6.1）
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['P.1', 'TB_PB.2c'],
      ['TB_PB.2c', 'CR1.10'],
      ['TB_PB.2b', 'TB_PB.1c'],
      ['TB_PB.1c', 'CR1.9'],
      ['TB_PB.1a', 'CR1.14'],
      ['CR1.14', 'CR1.5'],
      ['N.1', 'CR1.13'],
      ['CR1.13', 'TB_PL.1-'],
      ['CR1.6', 'TB_PL.1+'],
    ];
    for (const [from, to] of pairs) {
      const result = runAddWire(board, toTerminalId(from), toTerminalId(to), '青');
      expect(result.ok, `${from} — ${to}`).toBe(true);
    }
    const routes = routeSession(JIPM_BOARD, board);
    expect(routes.length).toBe(board.wires.length);
    for (const route of routes) {
      expect(crossingFootprint(JIPM_BOARD, route)?.id, route.wireId).toBeUndefined();
      expect(isManhattan(route.corners), route.wireId).toBe(true);
      expect(strayCorners(route)).toEqual([]);
      // 模範回路ぶんではスロットが余るので重なりは起きない（§6.6）
      expect(route.laneOverflow, route.wireId).toBe(false);
    }
  });

  it('既設配線（端子台 → 機器の根元の穴）の経路も部品の上を通らない', () => {
    const routes = routeFixedLinks(JIPM_BOARD);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(crossesFootprint(JIPM_BOARD, route), route.wireId).toBe(false);
      // 盤面を貫通する位置（機器の根元の穴）を持つ
      expect(route.throughPanelAt, route.wireId).toBeDefined();
    }
  });

  it('役割IDの端子でも物理IDに直してから経路を求める', () => {
    const board = session();
    const physical = toPhysicalTerminal(board.socketRoles, toTerminalId('CR1.13'));
    expect(physical).toBe('S1.13');
  });
});

describe('経路器の失敗と重なりの扱い（§6.6）', () => {
  it('盤に無い端子は RoutingError（電線IDと理由が付く）', () => {
    let caught: RoutingError | undefined;
    try {
      routeWire(
        JIPM_BOARD,
        { id: 'w-bad', from: toTerminalId('ZZ.1'), to: toTerminalId('P.1') },
        [],
      );
    } catch (error) {
      caught = error instanceof RoutingError ? error : undefined;
    }
    expect(caught?.wireId).toBe('w-bad');
    expect(caught?.reason).toBe('invalid-terminal');
  });

  it('routeSession は全か無かで、1本でも失敗すれば投げる', () => {
    const board = session();
    board.wires.push(createWire('w-bad', toTerminalId('ZZ.1'), toTerminalId('P.1'), '青', false));
    expect(() => routeSession(JIPM_BOARD, board)).toThrow(RoutingError);
  });

  it('レーンが重なった電線は琥珀色で描く（重なりを知る唯一の手がかり）', () => {
    const normal = routeWire(
      JIPM_BOARD,
      { id: 'w-9', from: toTerminalId('TB_PB.1c'), to: toTerminalId('S1.14') },
      [],
    );
    expect(normal.laneOverflow).toBe(false);
    expect(wireBodyColor(normal, '青', false, false)).toBe(WIRE_COLORS['青']);
    const crowded: WireRoute = { ...normal, laneOverflow: true };
    expect(wireBodyColor(crowded, '青', false, false)).toBe(WIRE_LANE_OVERFLOW_COLOR);
    // 既設配線と選択中は重なりより優先する
    expect(wireBodyColor(crowded, '黄', true, false)).toBe(WIRE_COLORS['青']);
  });
});
