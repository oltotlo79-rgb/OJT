import {
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  JIPM_BOARD,
  roleLabel,
  SOCKET_PIN_GRID,
  socketPinHoleOffsets,
  socketPinTerminal,
  socketRowExit,
  vec3,
} from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { scenePos, toScene } from '../src/renderer/three/coords.js';
import {
  BOARD_TILT_RAD,
  boardToWorld,
  boardUp,
  cameraPose,
  SOCKET_ROW_CENTER_MM,
} from '../src/renderer/three/camera.js';
import { socketTerminalLabel } from '../src/renderer/three/Socket.js';
import { mountedLabel } from '../src/renderer/three/MountedPart.js';

describe('toScene', () => {
  it('盤の中心が原点になる', () => {
    const [x, y, z] = toScene(vec3(BOARD_WIDTH_MM / 2, BOARD_HEIGHT_MM / 2, 0));
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(0, 10);
  });

  it('盤モデルの y（下向き）はシーンの −Y になる', () => {
    const [, y] = toScene(vec3(0, BOARD_HEIGHT_MM, 0));
    expect(y).toBe(-BOARD_HEIGHT_MM / 2);
  });

  it('scenePos は toScene と同じ結果になる', () => {
    expect(scenePos(10, 20, 5)).toEqual(toScene(vec3(10, 20, 5)));
  });
});

describe('盤の傾き（§6.5 傾斜コンソール）', () => {
  it('盤面の法線はほぼ真上を向き、少しだけ手前に倒れる', () => {
    const normal = boardToWorld([0, 0, 1]);
    expect(normal[1]).toBeGreaterThan(0.9);
    expect(normal[2]).toBeGreaterThan(0);
    expect(normal[2]).toBeLessThan(0.3);
  });

  it('盤の奥（盤ローカル +Y）は画面の奥へ倒れる', () => {
    const up = boardUp();
    expect(up[2]).toBeLessThan(-0.9);
  });

  it('傾斜角は盤定義の筐体形状（console.slopeDeg）から決まる', () => {
    expect(BOARD_TILT_RAD).toBeLessThan(0);
    expect(BOARD_TILT_RAD).toBeGreaterThan(-Math.PI / 2);
  });
});

describe('cameraPose', () => {
  it('正面視は盤面の法線方向から、盤の高さが視野38°に収まる距離で見る（§12.2）', () => {
    const pose = cameraPose('front');
    const distance = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    const halfHeightAtDistance = distance * Math.tan((38 / 2) * (Math.PI / 180));
    expect(halfHeightAtDistance).toBeGreaterThan(BOARD_HEIGHT_MM / 2);
    // 視線は盤面の法線と平行（面直）
    expect(pose.position[1]).toBeGreaterThan(pose.target[1]);
  });

  it('俯瞰は実物写真と同じ左手前・上からの斜め視点になる', () => {
    const pose = cameraPose('top');
    expect(pose.position[0]).toBeLessThan(0);
    expect(pose.position[1]).toBeGreaterThan(0);
    expect(pose.position[2]).toBeGreaterThan(0);
    expect(pose.up).toEqual([0, 1, 0]);
  });

  it('ソケット拡大は面直のままソケット段に寄る', () => {
    const front = cameraPose('front');
    const socket = cameraPose('socket');
    const frontDistance = Math.hypot(
      front.position[0] - front.target[0],
      front.position[1] - front.target[1],
      front.position[2] - front.target[2],
    );
    const socketDistance = Math.hypot(
      socket.position[0] - socket.target[0],
      socket.position[1] - socket.target[1],
      socket.position[2] - socket.target[2],
    );
    expect(socketDistance).toBeLessThan(frontDistance);
    expect(socket.target).toEqual(boardToWorld([0, BOARD_HEIGHT_MM / 2 - SOCKET_ROW_CENTER_MM, 0]));
  });
});

describe('端子ラベル', () => {
  it('役割の印字は極性・接点種別の記号になる（§6.2）', () => {
    expect(roleLabel('coil+')).toBe('+');
    expect(roleLabel('coil-')).toBe('−');
    expect(roleLabel('com')).toBe('COM');
    expect(roleLabel('no')).toBe('a');
    expect(roleLabel('nc')).toBe('b');
  });

  it('ツールチップは役割IDを足して `CR1 ⑨ COM` にする（§8.2）', () => {
    const terminal = JIPM_BOARD.terminals.find((t) => t.id === socketPinTerminal('S1', 9));
    expect(terminal).toBeDefined();
    if (terminal === undefined) return;
    expect(socketTerminalLabel('CR1', terminal)).toBe('CR1 ⑨ COM');
  });

  it('役割が割り当てられていない予備ソケットでも表示できる', () => {
    const terminal = JIPM_BOARD.terminals.find((t) => t.id === socketPinTerminal('S8', 13));
    expect(terminal).toBeDefined();
    if (terminal === undefined) return;
    expect(socketTerminalLabel(undefined, terminal)).toBe('予備 ⑬ −');
  });

  it('ネジ端子は奥端・手前端の段付きティアに分かれる（§6.2）', () => {
    expect(socketRowExit(0)).toBe('rear');
    expect(socketRowExit(1)).toBe('rear');
    expect(socketRowExit(2)).toBe('front');
    expect(socketRowExit(3)).toBe('front');
  });

  it('差込穴は2列×7段で中央に並ぶ（§6.2）', () => {
    expect(socketPinHoleOffsets()).toHaveLength(14);
  });
});

describe('装着部品のラベル', () => {
  it('リレーは役割ID、タイマは設定秒を添える', () => {
    expect(mountedLabel('CR1', { kind: 'relay-my4n' })).toBe('CR1');
    expect(mountedLabel('T1', { kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 })).toBe(
      'T1 3.0s',
    );
  });
});

describe('盤の定義から描くこと', () => {
  it('ソケット・PL・PB・既設配線はすべて盤定義から取れる（数をハードコードしない根拠）', () => {
    expect(JIPM_BOARD.sockets.length).toBeGreaterThan(0);
    expect(JIPM_BOARD.lamps).toHaveLength(4);
    expect(JIPM_BOARD.pushButtons).toHaveLength(4);
    expect(JIPM_BOARD.fixedLinks.length).toBeGreaterThan(0);
    expect(JIPM_BOARD.console.rearHeightMm).toBeGreaterThan(JIPM_BOARD.console.frontHeightMm);
    expect(JIPM_BOARD.sockets.filter((s) => s.cluster === 'left')).toHaveLength(4);
    expect(JIPM_BOARD.sockets.filter((s) => s.cluster === 'right')).toHaveLength(4);
  });

  it('ソケットのピン配置は4段・各段4列で ④ が段4に混ざる（§6.2）', () => {
    expect(SOCKET_PIN_GRID).toHaveLength(4);
    expect(SOCKET_PIN_GRID[3]?.[0]).toBe(4);
  });
});
