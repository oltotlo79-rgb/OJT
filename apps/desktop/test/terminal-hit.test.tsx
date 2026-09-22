import { cleanup, render } from '@testing-library/react';
import { TerminalField } from '../src/renderer/three/TerminalField.js';
import { JIPM_BOARD, type BoardTerminal } from '@ojt/board-model';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TERMINAL_HOVER_COLOR,
  TERMINAL_PENDING_COLOR,
  TERMINAL_SCREW_COLOR,
} from '../src/renderer/session/colors.js';
import { SCREW_GEOMETRY } from '../src/renderer/three/materials.js';
import {
  HOVER_RING_GEOMETRY,
  HOVER_RING_INNER_MM,
  HOVER_RING_OUTER_MM,
  TERMINAL_HOVER_EMISSIVE_INTENSITY,
  terminalScrewAppearance,
} from '../src/renderer/three/TerminalHit.js';

vi.mock('@react-three/fiber', () => ({
  useThree: (select: (state: { invalidate: () => void }) => unknown) =>
    select({ invalidate: () => undefined }),
}));
vi.mock('@react-three/drei', () => ({ Html: () => null }));
afterEach(cleanup);

/**
 * 端子のホバー表示（項目3）。
 *
 * 今日のスクリーンショット確認 08: ネジの色替えだけでは `plc` プリセット（機種によっては
 * 1m以上離れる。§12.2）まで引くとホバーに気づけなかった。ネジの発光と、周りの光る輪の
 * 2つを数値で確かめる。
 */

/** 要素木を辿ってすべての要素を集める（関数コンポーネントは呼び出して展開する）。
 * `three-fidelity.test.tsx` の `collect()` と同じ最小実装。 */
function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) collect(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === 'function') {
    const renderFn = element.type as (props: unknown) => ReactNode;
    return collect(renderFn(element.props), out);
  }
  out.push(element);
  collect(element.props.children, out);
  return out;
}

const firstTerminal = JIPM_BOARD.terminals[0];
if (firstTerminal === undefined) throw new Error('no terminal');
const terminal: BoardTerminal = firstTerminal;

const noop = (): void => undefined;

function meshesOf(hovered: boolean, pending: boolean): ReactElement<Record<string, unknown>>[] {
  let meshes: ReactElement<Record<string, unknown>>[] = [];
  function Capture(): null {
    const node = TerminalField({
      terminals: [terminal],
      tooltipOf: () => 'CR1 ⑨ COM',
      hovered: hovered ? terminal.id : undefined,
      pending: pending ? terminal.id : undefined,
      onHover: noop,
      onPick: noop,
    });
    meshes = collect(node).filter(
      (element): element is ReactElement<Record<string, unknown>> => element.type === 'mesh',
    );
    return null;
  }
  render(<Capture />);
  return meshes;
}

describe('端子のホバー表示（項目3: 通常ズームでも気づける見た目にする）', () => {
  it('ネジの色は保留中・ホバー中・通常で変わり、発光はホバー中だけ付く', () => {
    const idle = terminalScrewAppearance(false, false);
    const hovered = terminalScrewAppearance(true, false);
    const pending = terminalScrewAppearance(false, true);

    expect(idle.color).toBe(TERMINAL_SCREW_COLOR);
    expect(idle.emissive).toBeUndefined();
    expect(idle.emissiveIntensity).toBe(0);

    expect(hovered.color).toBe(TERMINAL_HOVER_COLOR);
    expect(hovered.emissive).toBe(TERMINAL_HOVER_COLOR);
    expect(hovered.emissiveIntensity).toBe(TERMINAL_HOVER_EMISSIVE_INTENSITY);
    expect(hovered.emissiveIntensity).toBeGreaterThan(0);

    // 保留中（配線1本目に選択済み）は色は変わるが、発光は付けない（ホバーだけの演出）
    expect(pending.color).toBe(TERMINAL_PENDING_COLOR);
    expect(pending.emissive).toBeUndefined();
    expect(pending.emissiveIntensity).toBe(0);
  });

  it('輪はホバー中だけ描かれ、当たり判定は奪わない', () => {
    const idleMeshes = meshesOf(false, false);
    const hoveredMeshes = meshesOf(true, false);

    expect(idleMeshes.some((mesh) => mesh.props['geometry'] === HOVER_RING_GEOMETRY)).toBe(false);
    // ホバー中は発光ネジと輪を重ねる（通常のネジはインスタンス描画）
    expect(hoveredMeshes.length).toBe(idleMeshes.length + 2);

    const ring = hoveredMeshes.find((mesh) => mesh.props['geometry'] === HOVER_RING_GEOMETRY);
    expect(ring).toBeDefined();
    expect(typeof ring?.props['raycast']).toBe('function');
    const intersects: unknown[] = [];
    (ring?.props['raycast'] as (a: unknown, b: unknown[]) => void)({}, intersects);
    expect(intersects).toEqual([]);
  });

  it('輪はネジよりはっきり大きい', () => {
    SCREW_GEOMETRY.computeBoundingBox();
    const screwRadius = SCREW_GEOMETRY.boundingBox!.max.x;
    expect(HOVER_RING_INNER_MM).toBeGreaterThan(screwRadius);
    // ネジの直径（3.6mm）よりも輪の外径のほうが大きい＝ネジを一回り超えて包む
    expect(HOVER_RING_OUTER_MM).toBeGreaterThan(screwRadius * 2);
  });

  it('ホバー中のネジのマテリアルは実際に発光する', () => {
    const screw = meshesOf(true, false).find((mesh) => mesh.props['geometry'] === SCREW_GEOMETRY);
    expect(screw).toBeDefined();
    const material = screw?.props['material'] as {
      emissiveIntensity: number;
      emissive: { getHexString: () => string };
    };
    expect(material.emissiveIntensity).toBe(TERMINAL_HOVER_EMISSIVE_INTENSITY);
    expect(`#${material.emissive.getHexString()}`).toBe(TERMINAL_HOVER_COLOR.toLowerCase());
  });
});
