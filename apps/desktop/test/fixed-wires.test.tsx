import { JIPM_BOARD, routeFixedLinks } from '@ojt/board-model';
import { cleanup, render } from '@testing-library/react';
import { CylinderGeometry, TubeGeometry } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANEL_HOLE_COLOR } from '../src/renderer/session/colors.js';
import { FixedWires } from '../src/renderer/three/FixedWires.js';
import { PIN_HOLE_GEOMETRY, sharedMaterial } from '../src/renderer/three/materials.js';

/**
 * 既設配線の GPU 資源（レビュー指摘 3D-05 / 3D-02）。
 *
 * `FixedWires` は `useTubeGeometry()` を通さず `useMemo` で既設配線の `TubeGeometry` を
 * 作りっぱなしにしていた。`Wire.tsx` / `DeskWires.tsx` は同じ形を厳密に解放しているのに
 * このファイルだけ扱いが割れていて、課題を開き直すたびに積み上がっていた
 * （`desk-wires.test.tsx` が机上側で確かめているのと同じ約束をここでも固定する）。
 * 盤面の貫通穴も、穴1個ずつにジオメトリとマテリアルを作っていた（3D-02）。
 */

afterEach(() => {
  cleanup();
});

/** 既設配線の本数（`routeFixedLinks()` が返す経路の数＝管の数）。 */
const FIXED_ROUTES = routeFixedLinks(JIPM_BOARD);
/** 盤面の貫通穴の数。 */
const HOLE_COUNT = FIXED_ROUTES.filter((route) => route.throughPanelAt !== undefined).length;

describe('FixedWires の資源解放（3D-05）', () => {
  it('盤には20本前後の既設配線がある（解放し忘れると効いてくる量）', () => {
    expect(FIXED_ROUTES.length).toBeGreaterThanOrEqual(20);
    expect(HOLE_COUNT).toBeGreaterThan(0);
  });

  it('アンマウントで管をすべて解放する', () => {
    const disposeSpy = vi.spyOn(TubeGeometry.prototype, 'dispose');
    const { unmount } = render(<FixedWires board={JIPM_BOARD} />);
    expect(disposeSpy).not.toHaveBeenCalled();
    unmount();
    expect(disposeSpy).toHaveBeenCalledTimes(FIXED_ROUTES.length);
    disposeSpy.mockRestore();
  });

  it('開き直しても解放し忘れない（2回マウントしたら2回ぶん解放される）', () => {
    const disposeSpy = vi.spyOn(TubeGeometry.prototype, 'dispose');
    render(<FixedWires board={JIPM_BOARD} />).unmount();
    render(<FixedWires board={JIPM_BOARD} />).unmount();
    expect(disposeSpy).toHaveBeenCalledTimes(FIXED_ROUTES.length * 2);
    disposeSpy.mockRestore();
  });
});

describe('盤面の貫通穴は共有ジオメトリ1個に畳む（3D-02）', () => {
  it('穴は `instancedMesh` 1本で、穴ごとの mesh を生やさない', () => {
    const { container } = render(<FixedWires board={JIPM_BOARD} />);
    expect(container.querySelectorAll('instancedMesh')).toHaveLength(1);
    // 残る `mesh` は電線の管だけ（穴のぶんが増えていない）
    expect(container.querySelectorAll('mesh')).toHaveLength(FIXED_ROUTES.length);
  });

  it('穴ごとに `cylinderGeometry` / `meshStandardMaterial` を作らない', () => {
    const { container } = render(<FixedWires board={JIPM_BOARD} />);
    expect(container.querySelectorAll('cylinderGeometry')).toHaveLength(0);
    expect(container.querySelectorAll('meshStandardMaterial')).toHaveLength(0);
  });

  it('共有ジオメトリは半径1で作られ、マテリアルも使い回される', () => {
    expect(PIN_HOLE_GEOMETRY).toBeInstanceOf(CylinderGeometry);
    expect(PIN_HOLE_GEOMETRY.parameters.radiusTop).toBe(1);
    expect(PIN_HOLE_GEOMETRY.parameters.radiusBottom).toBe(1);
    expect(sharedMaterial(PANEL_HOLE_COLOR, { roughness: 0.9 })).toBe(
      sharedMaterial(PANEL_HOLE_COLOR, { roughness: 0.9 }),
    );
  });
});
