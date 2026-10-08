import { JIPM_BOARD, socketStepSections, type SocketDefinition } from '@ojt/board-model';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_DROP_COLOR, SOCKET_SELECTED_COLOR } from '../src/renderer/session/colors.js';

/**
 * ソケットの選択表示は台座の輪郭で示す（v2.0.0 Task 4・総点検 F3）。
 *
 * 以前は選択中のソケット本体を水色に発光させていたので、透明なリレーのケース
 * （`RELAY_SHELL`・opacity 0.2）越しに台座が染まり、部品そのものが光っているように見えた。
 * いまは本体を光らせず、段付きの外形の輪郭（`EdgesGeometry`。5区間それぞれ）を
 * 選択＝水色の太線（3本ずらして重ねる）、ホバー＝白の細線 で描く。
 * 運搬中の「ここに落とせる」だけ弱い発光（0.35）と緑の細線を残す。
 */

/** `Socket` は drei の `Html`（`Canvas` の中でしか使えない）を持つので素通しに差し替える。 */
vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => children,
}));

const {
  Socket,
  socketBodyMaterial,
  socketGlowOf,
  socketOutlineMaterial,
  socketOutlineOf,
  SOCKET_GLOW_INTENSITY,
  SOCKET_HOVER_OUTLINE_COLOR,
} = await import('../src/renderer/three/Socket.js');
const { RELAY_SHELL } = await import('../src/renderer/three/ComponentDetails.js');

afterEach(() => {
  cleanup();
});

function firstSocket(): SocketDefinition {
  const socket = JIPM_BOARD.sockets[0];
  if (socket === undefined) throw new Error('ソケットが無い');
  return socket;
}

function renderSocket(state: {
  selected: boolean;
  hovered: boolean;
  droppable: boolean;
}): ReturnType<typeof render> {
  const socket = firstSocket();
  const terminals = JIPM_BOARD.terminals.filter((t) => t.id.startsWith(`${socket.id}.`));
  return render(
    <Socket
      socket={socket}
      role="CR1"
      occupied={false}
      selected={state.selected}
      hovered={state.hovered}
      droppable={state.droppable}
      terminals={terminals}
      onPickSocket={() => undefined}
      onHoverSocket={() => undefined}
      onReleaseSocket={() => undefined}
    />,
  );
}

describe('ソケットの光り方の優先順（Phase 7 設計 §7.3.4）', () => {
  it('落とせる ＞ 選択 ＞ ホバー ＞ 通常', () => {
    expect(socketGlowOf({ selected: true, hovered: true, droppable: true })).toBe('droppable');
    expect(socketGlowOf({ selected: true, hovered: true, droppable: false })).toBe('selected');
    expect(socketGlowOf({ selected: false, hovered: true, droppable: false })).toBe('hovered');
    expect(socketGlowOf({ selected: false, hovered: false, droppable: false })).toBe('plain');
  });
});

describe('選択表示は輪郭で、本体は光らせない（v2.0.0 Task 4・F3）', () => {
  it('選択・ホバーの本体は通常と同じマテリアル（発光 0）', () => {
    expect(SOCKET_GLOW_INTENSITY.selected).toBe(0);
    expect(SOCKET_GLOW_INTENSITY.hovered).toBe(0);
    expect(SOCKET_GLOW_INTENSITY.plain).toBe(0);
    const plain = socketBodyMaterial('plain');
    expect(socketBodyMaterial('selected')).toBe(plain);
    expect(socketBodyMaterial('hovered')).toBe(plain);
    expect(plain.emissiveIntensity).toBe(0);
    // 透明なケース越しに台座が染まる前提（ケースは半透明のまま）
    expect(RELAY_SHELL.transparent).toBe(true);
    expect(RELAY_SHELL.opacity).toBeLessThan(1);
  });

  it('落とせるソケットだけ弱く（0.35 以下）緑に光る', () => {
    const droppable = socketBodyMaterial('droppable');
    expect(droppable.emissiveIntensity).toBeGreaterThan(0);
    expect(droppable.emissiveIntensity).toBeLessThanOrEqual(0.35);
    expect(`#${droppable.emissive.getHexString()}`.toUpperCase()).toBe(
      SOCKET_DROP_COLOR.toUpperCase(),
    );
  });

  it('輪郭は 選択＝水色3本・ホバー＝白1本・落とせる＝緑1本・通常＝無し', () => {
    expect(socketOutlineOf('selected')).toEqual({ color: SOCKET_SELECTED_COLOR, passes: 3 });
    expect(socketOutlineOf('hovered')).toEqual({ color: SOCKET_HOVER_OUTLINE_COLOR, passes: 1 });
    expect(socketOutlineOf('droppable')).toEqual({ color: SOCKET_DROP_COLOR, passes: 1 });
    expect(socketOutlineOf('plain')).toBeUndefined();
    // 選択の太線はホバーの細線より本数が多い（「太い縁取り」と「細い縁取り」の区別）
    expect(socketOutlineOf('selected')?.passes).toBeGreaterThan(
      socketOutlineOf('hovered')?.passes ?? 0,
    );
  });

  it('輪郭のマテリアルは色ごとに1個で、トーンマッピングを受けない', () => {
    const a = socketOutlineMaterial(SOCKET_SELECTED_COLOR);
    expect(socketOutlineMaterial(SOCKET_SELECTED_COLOR)).toBe(a);
    expect(a.toneMapped).toBe(false);
    expect(socketOutlineMaterial(SOCKET_HOVER_OUTLINE_COLOR)).not.toBe(a);
  });

  it('描画: 輪郭は段付きの外形（5区間）ごとに引き、選択は3本・ホバーは1本・通常は0本', () => {
    const socket = firstSocket();
    const sections = socketStepSections(socket.bodyMm.length).length;
    expect(sections).toBe(5);
    const outlines = (container: HTMLElement): NodeListOf<Element> =>
      container.querySelectorAll(`lineSegments[name^="socket-outline-${socket.id}-"]`);

    const plain = renderSocket({ selected: false, hovered: false, droppable: false });
    expect(outlines(plain.container)).toHaveLength(0);
    cleanup();

    const hovered = renderSocket({ selected: false, hovered: true, droppable: false });
    expect(outlines(hovered.container)).toHaveLength(sections);
    cleanup();

    const selected = renderSocket({ selected: true, hovered: false, droppable: false });
    const lines = outlines(selected.container);
    expect(lines).toHaveLength(3 * sections);
    // 2本目は1本目より外側（ずらして重ねる＝太く見せる）。同じ区間（index 0）どうしで比べる
    const scaleOf = (el: Element): number[] =>
      (el.getAttribute('scale') ?? '')
        .split(',')
        .map((value) => Number(value));
    const pass = (n: number): number[] => {
      const el = selected.container.querySelector(
        `lineSegments[name="socket-outline-${socket.id}-${String(n)}-0"]`,
      );
      return el === null ? [] : scaleOf(el);
    };
    expect(pass(1)[0] ?? 0).toBeGreaterThan(pass(0)[0] ?? 0);
    expect(pass(1)[1] ?? 0).toBeGreaterThan(pass(0)[1] ?? 0);
    expect(pass(2)[0] ?? 0).toBeGreaterThan(pass(1)[0] ?? 0);
    // 本体（段）は選択中も描かれていて、輪郭は当たり判定を持たない飾り
    const body = selected.container.querySelector(`mesh[name="socket-body-${socket.id}"]`);
    expect(body).not.toBeNull();
  });
});
