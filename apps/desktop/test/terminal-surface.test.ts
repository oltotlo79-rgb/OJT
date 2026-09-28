import {
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  addWire,
  createSession,
  deskRoutes,
  findBoardTerminal,
  FREE_TRAINING_RULES,
  JIPM_BOARD,
  PLC_UNIT_CP1E,
  PLC_UNIT_FX5U,
  PLC_UNIT_JW300,
  PLC_UNIT_PC10G,
  routeFixedLinks,
  routeWire,
  socketStepSections,
  terminalBlockFor,
  terminalBlockShape,
  withBoardProfile,
  withPlcUnit,
  type BoardDefinition,
  type BoardTerminal,
  type WireRoute,
} from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { socketPrintGeometry, socketPrintPatches } from '../src/renderer/three/Socket.js';
import { terminalFieldMatrices } from '../src/renderer/three/TerminalField.js';
import { buildTubeGeometry } from '../src/renderer/three/Wire.js';
import { boardToWorld, cameraPose } from '../src/renderer/three/camera.js';
import { toScene } from '../src/renderer/three/coords.js';
import { mountedBodyBox } from '../src/renderer/three/MountedPart.js';
import { projectToScreen } from '../e2e/projection.js';

function terminal(board: BoardDefinition, id: string): BoardTerminal {
  const found = findBoardTerminal(board, id);
  if (found === undefined) throw new Error(id);
  return found;
}

/** 実際に描くチューブの全頂点を台座・カバーの体積と照合する。端点だけの検査にしない。 */
function buriedVertices(board: BoardDefinition, route: WireRoute, block: BoardTerminal): number {
  const shape = terminalBlockFor(board, block);
  if (shape === undefined) throw new Error(`No block: ${block.id}`);
  const geometry = buildTubeGeometry(route);
  const vertices = geometry.getAttribute('position');
  let buried = 0;
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index) + BOARD_WIDTH_MM / 2;
    const y = BOARD_HEIGHT_MM / 2 - vertices.getY(index);
    const z = vertices.getZ(index);
    for (const solid of [{ ...shape, top: shape.bodyTop }, shape.cap]) {
      if (
        x > solid.x + 0.01 &&
        x < solid.x + solid.w - 0.01 &&
        y > solid.y + 0.01 &&
        y < solid.y + solid.h - 0.01 &&
        z > 0 &&
        z < solid.top - 0.01
      )
        buried++;
    }
  }
  geometry.dispose();
  return buried;
}

function buriedSocketVertices(
  board: BoardDefinition,
  route: WireRoute,
  end: BoardTerminal,
): number {
  const socket = board.sockets.find((item) => end.id.startsWith(`${item.id}.`))!;
  const geometry = buildTubeGeometry(route);
  const vertices = geometry.getAttribute('position');
  let buried = 0;
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index) + BOARD_WIDTH_MM / 2 - socket.origin.x;
    const y = BOARD_HEIGHT_MM / 2 - vertices.getY(index) - socket.origin.y;
    const z = vertices.getZ(index);
    if (x <= 0.01 || x >= socket.bodyMm.width - 0.01) continue;
    for (const section of socketStepSections(socket.bodyMm.length)) {
      if (
        y > section.offsetY - section.depth / 2 + 0.01 &&
        y < section.offsetY + section.depth / 2 - 0.01 &&
        z > 0 &&
        z < section.height - 0.01
      )
        buried++;
    }
  }
  geometry.dispose();
  return buried;
}

const blockTerminals = JIPM_BOARD.terminals.filter((item) => /^TB_(PL|PB)\./u.test(item.id));

describe('ランプ・押ボタン端子台の配線が台座に隠れない', () => {
  it.each([PLC_UNIT_FX5U, PLC_UNIT_CP1E, PLC_UNIT_PC10G, PLC_UNIT_JW300])(
    'PLC $model: 端子台・段付きソケットから机上へ引き出す配線も台座に潜らない',
    (unit) => {
      const board = withPlcUnit(JIPM_BOARD, unit);
      const ends = [
        ...blockTerminals,
        ...board.terminals.filter((item) => item.id.startsWith('S1.')),
      ];
      for (const end of ends) {
        for (const reverse of [false, true]) {
          const session = createSession(board, { includeCheckWires: false });
          const plc = toTerminalId(`PLC.${unit.spec.inputs[0]!.name}`);
          expect(addWire(session, board, reverse ? plc : end.id, reverse ? end.id : plc).ok).toBe(
            true,
          );
          const routes = deskRoutes(board, session);
          expect(routes).toHaveLength(1);
          const buried = end.id.startsWith('S1.')
            ? buriedSocketVertices(board, routes[0]!, end)
            : buriedVertices(board, routes[0]!, end);
          expect(buried, `${unit.model} ${end.id} reverse=${reverse}`).toBe(0);
        }
      }
    },
  );

  it.each(blockTerminals.map((item) => item.id))(
    '%s: 出線・入線・2本目とも台座の体積を通らない',
    (id) => {
      const end = terminal(JIPM_BOARD, id);
      for (const reverse of [false, true]) {
        const routes: WireRoute[] = [];
        for (const [index, other] of ['P.1', 'S1.9'].entries()) {
          const route = routeWire(
            JIPM_BOARD,
            {
              id: `surface-${index}`,
              from: toTerminalId(reverse ? id : other),
              to: toTerminalId(reverse ? other : id),
            },
            routes,
          );
          expect(route.points[reverse ? 0 : route.points.length - 1]).toEqual(end.pos);
          expect(buriedVertices(JIPM_BOARD, route, end)).toBe(0);
          routes.push(route);
        }
      }
    },
  );

  it('渡り線と既設の青線も台座内へ降りない', () => {
    for (const part of ['TB_PL', 'TB_PB']) {
      const terminals = blockTerminals.filter((item) => item.id.startsWith(`${part}.`));
      for (const end of terminals.slice(1)) {
        const route = routeWire(
          JIPM_BOARD,
          { id: 'jumper', from: terminals[0]!.id, to: end.id },
          [],
        );
        expect(buriedVertices(JIPM_BOARD, route, end)).toBe(0);
      }
    }
    for (const route of routeFixedLinks(JIPM_BOARD)) {
      const end = blockTerminals.find(
        (item) => item.pos.x === route.points[0]?.x && item.pos.y === route.points[0]?.y,
      );
      if (end !== undefined) expect(buriedVertices(JIPM_BOARD, route, end), route.wireId).toBe(0);
    }
  });

  it('拡張盤の追加端子台も描画と同じ外形から引き出す', () => {
    const board = withBoardProfile(JIPM_BOARD, {
      id: 'expanded',
      terminalPairs: 2,
      extraLamps: 2,
      extraPushButtons: 2,
      rules: FREE_TRAINING_RULES,
    });
    for (const part of ['TB_PL', 'TB_PB']) {
      const extra = board.terminals.filter(
        (item) => item.id.startsWith(`${part}.`) && Number(item.id.split('.')[1]!.slice(0, -1)) > 4,
      );
      expect(extra.length).toBeGreaterThan(0);
      const expected = terminalBlockShape(extra);
      for (const end of extra) {
        expect(terminalBlockFor(board, end)).toEqual(expected);
        const route = routeWire(board, { id: 'extra', from: toTerminalId('P.1'), to: end.id }, []);
        expect(buriedVertices(board, route, end), end.id).toBe(0);
      }
    }
    for (const route of routeFixedLinks(board)) {
      const end = board.terminals.find(
        (item) =>
          /^TB_(PL|PB)\./u.test(item.id) &&
          item.pos.x === route.points[0]?.x &&
          item.pos.y === route.points[0]?.y,
      );
      if (end !== undefined) expect(buriedVertices(board, route, end), route.wireId).toBe(0);
    }
  });
});

describe('ソケットの各列が実際のネジ・印字・配線を伴って段になる', () => {
  it.each([1, 1.5, 2.2])('拡大表示の縦横比%sで端子と装着部品の四隅が画面内に入る', (aspect) => {
    const viewport = { x: 0, y: 0, width: 1000, height: 1000 / aspect };
    const pose = cameraPose('socket', { aspect });
    for (const socket of JIPM_BOARD.sockets) {
      const terminals = JIPM_BOARD.terminals.filter((item) => item.id.startsWith(`${socket.id}.`));
      const body = mountedBodyBox(socket);
      const corners: Array<[number, number, number]> = [];
      for (const dx of [-1, 1]) {
        for (const dy of [-1, 1]) {
          corners.push([
            body.center[0] + (dx * body.width) / 2,
            body.center[1] + (dy * body.height) / 2,
            body.topZ,
          ]);
          for (const end of terminals) {
            corners.push(
              toScene({ x: end.pos.x + dx * 3, y: end.pos.y + dy * 3, z: end.pos.z + 2 }),
            );
          }
        }
      }
      for (const corner of corners) {
        const screen = projectToScreen(boardToWorld(corner), pose, viewport);
        expect(screen.x, socket.id).toBeGreaterThan(0);
        expect(screen.x, socket.id).toBeLessThan(viewport.width);
        expect(screen.y, socket.id).toBeGreaterThan(0);
        expect(screen.y, socket.id).toBeLessThan(viewport.height);
      }
    }
  });

  it.each(JIPM_BOARD.sockets.map((item) => item.id))(
    '%s: 奥と手前で外側の列より内側の列が高い',
    (id) => {
      const socket = JIPM_BOARD.sockets.find((item) => item.id === id)!;
      const terminals = JIPM_BOARD.terminals.filter((item) => item.id.startsWith(`${id}.`));
      const at = (pin: number): BoardTerminal => terminal(JIPM_BOARD, `${id}.${pin}`);
      expect(at(5).pos.z - at(1).pos.z).toBeGreaterThanOrEqual(8);
      expect(at(9).pos.z - at(13).pos.z).toBeGreaterThanOrEqual(8);
      const matrices = terminalFieldMatrices(terminals);
      const patches = socketPrintPatches(socket, terminals);
      for (const [index, end] of terminals.entries()) {
        expect(matrices.screwMatrices[index]!.elements[14]).toBe(end.pos.z);
        const section = socketStepSections(socket.bodyMm.length).find(
          (item) => Math.abs(end.pos.y - socket.origin.y - item.offsetY) <= item.depth / 2,
        )!;
        expect(end.pos.z - section.height).toBeCloseTo(2);
        const print = patches.filter((item) => item.terminalId === end.id);
        expect(print).toHaveLength(2);
        expect(print.every((item) => item.z > end.pos.z + 0.8 && item.z < end.pos.z + 2)).toBe(
          true,
        );
        const route = routeWire(
          JIPM_BOARD,
          { id: 'socket', from: end.id, to: toTerminalId('TB_PL.1+') },
          [],
        );
        expect(route.points[0]).toEqual(end.pos);
        expect(buriedSocketVertices(JIPM_BOARD, route, end), end.id).toBe(0);
      }
      const geometry = socketPrintGeometry(socket, terminals);
      const vertices = geometry.getAttribute('position');
      const heights = new Set(
        Array.from({ length: vertices.count }, (_, index) => vertices.getZ(index).toFixed(1)),
      );
      expect(heights.has((at(1).pos.z + 1.2).toFixed(1))).toBe(true);
      expect(heights.has((at(5).pos.z + 1.2).toFixed(1))).toBe(true);
      geometry.dispose();
    },
  );
});
