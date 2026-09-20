import { JIPM_BOARD, type Footprint } from '@ojt/board-model';
import { TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';
import { cleanup, render } from '@testing-library/react';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Breaker,
  BREAKER_HANDLE_MM,
  BREAKER_HANDLE_TILT_RAD,
  breakerHandlePose,
  PowerSwitch,
  SWITCH_ROCKER_MM,
  SWITCH_ROCKER_TILT_RAD,
  switchRockerPose,
  wellColorFor,
} from '../src/renderer/three/AcFixtures.js';
import { boardToWorld, cameraPose } from '../src/renderer/three/camera.js';
import { findFixtureFootprint } from '../src/renderer/three/Fixtures.js';
import { MountedLabelContent, mountedBodyBox } from '../src/renderer/three/MountedPart.js';
import {
  indicatorCenter,
  PartIndicator,
  relayIndicatorMaterial,
  TIMER_DIAL_SWEEP_RAD,
  timerDialAngleRad,
  timerLedCenters,
  timerLedMaterial,
  timerLedStates,
} from '../src/renderer/three/PartIndicator.js';
import { projectToScreen } from '../e2e/projection.js';

/**
 * ブレーカ・電源スイッチ・装着部品の動作表示の3D（利用者要望 2026-09-19）。
 *
 * 3Dの見た目そのものは単体テストから見られないので、**見た目を決めている純粋な値**
 * （ハンドルの姿勢・発光マテリアル・LEDの点灯・表示器の位置）を固定する。
 * さらに「飾りのメッシュが1つもクリックを奪わない」ことを要素木を辿って検査する。
 * ここが崩れると端子のクリック（配線操作そのもの）が効かなくなる。
 */

afterEach(() => {
  cleanup();
});

const HEIGHT_MM = 22;

function footprintOf(kind: Footprint['kind']): Footprint {
  const footprint = findFixtureFootprint(JIPM_BOARD.footprints, kind);
  if (footprint === undefined) throw new Error(`no footprint: ${kind}`);
  return footprint;
}

function terminalsOf(partId: string): typeof JIPM_BOARD.terminals {
  return JIPM_BOARD.terminals.filter((terminal) => terminal.id.startsWith(`${partId}.`));
}

const CB = footprintOf('breaker');
const SW = footprintOf('switch');

/** 要素木を辿ってすべての要素を集める（関数コンポーネントは呼び出して展開する）。 */
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

/** 当たり判定を持ちうる要素（`mesh` など）だけを取り出す。 */
function pickables(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const hitTypes = new Set(['mesh', 'lineSegments', 'points', 'sprite', 'instancedMesh']);
  return collect(node).filter(
    (element): element is ReactElement<Record<string, unknown>> =>
      typeof element.type === 'string' && hitTypes.has(element.type),
  );
}

/** ポインタを受け取るハンドラが1つも付いていないこと。 */
function hasPointerHandler(props: Record<string, unknown>): boolean {
  return Object.keys(props).some((key) => key.startsWith('onPointer') || key === 'onClick');
}

describe('ブレーカの3D（§6.1 / 利用者要望 2026-09-19）', () => {
  it('ハンドルは ON と OFF で角度も位置も変わる', () => {
    const on = breakerHandlePose(CB, true, HEIGHT_MM);
    const off = breakerHandlePose(CB, false, HEIGHT_MM);

    expect(on.rotationX).toBeCloseTo(-BREAKER_HANDLE_TILT_RAD, 10);
    expect(off.rotationX).toBeCloseTo(BREAKER_HANDLE_TILT_RAD, 10);
    expect(on.rotationX).not.toBeCloseTo(off.rotationX, 3);
    // ON は盤の奥（シーンの +Y）側へ倒れる＝実物の「上」を向く
    expect(on.position[1]).toBeGreaterThan(off.position[1]);
    // 支点まわりに倒れるだけなので高さは同じ（沈み込まない）
    expect(on.position[2]).toBeCloseTo(off.position[2] ?? 0, 10);
    expect(on.position[2]).toBeGreaterThan(HEIGHT_MM - 1.5);
  });

  it('ハンドルは機器の外形からはみ出さない', () => {
    for (const on of [true, false]) {
      const pose = breakerHandlePose(CB, on, HEIGHT_MM);
      const centerY = -(CB.y + CB.h / 2 - 245 / 2);
      const halfDepth = BREAKER_HANDLE_MM.depth / 2 + BREAKER_HANDLE_MM.height / 2;
      expect(Math.abs(pose.position[1] - centerY)).toBeLessThanOrEqual(CB.h / 2 - halfDepth);
    }
  });

  it('ハンドルの傾きは通常ズームでも見分けられる角度まで広げてある（項目4）', () => {
    // 今日のスクリーンショット確認 10/11: 20°では ON/OFF の姿勢の違いにほとんど気づけなかった
    const clearlyVisibleRad = (25 * Math.PI) / 180;
    expect(BREAKER_HANDLE_TILT_RAD).toBeGreaterThanOrEqual(clearlyVisibleRad);
  });

  it('ハンドル窓の色は ON で緑、OFF で既定の暗い色に変わる（項目4）', () => {
    expect(wellColorFor(true)).not.toBe(wellColorFor(false));
    expect(wellColorFor(true)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(wellColorFor(false)).toMatch(/^#[0-9A-Fa-f]{6}$/);

    for (const on of [true, false]) {
      const meshes = pickables(
        <Breaker
          footprint={CB}
          terminals={terminalsOf('CB')}
          color="#DCDCD6"
          heightMm={HEIGHT_MM}
          on={on}
        />,
      );
      const well = meshes.find((mesh) => mesh.props['name'] === 'breaker-well');
      expect(well, `on=${on}`).toBeDefined();
      const material = well?.props['material'] as { color: { getHexString: () => string } };
      expect(`#${material.color.getHexString()}`, `on=${on}`).toBe(wellColorFor(on).toLowerCase());
    }
  });

  it('飾りのメッシュは1つもクリックを奪わない', () => {
    const meshes = pickables(
      <Breaker
        footprint={CB}
        terminals={terminalsOf('CB')}
        color="#DCDCD6"
        heightMm={HEIGHT_MM}
        on
      />,
    );
    expect(meshes.length).toBeGreaterThan(5);
    for (const mesh of meshes) {
      const intersects: unknown[] = [];
      const raycast = mesh.props['raycast'];
      expect(typeof raycast).toBe('function');
      (raycast as (a: unknown, b: unknown[]) => void)({}, intersects);
      expect(intersects).toEqual([]);
      expect(hasPointerHandler(mesh.props)).toBe(false);
    }
  });
});

describe('電源スイッチの3D（§6.1 / 利用者要望 2026-09-19）', () => {
  it('ロッカーは ON と OFF で角度も位置も変わる', () => {
    const on = switchRockerPose(SW, true, HEIGHT_MM);
    const off = switchRockerPose(SW, false, HEIGHT_MM);

    expect(on.rotationX).toBeCloseTo(-SWITCH_ROCKER_TILT_RAD, 10);
    expect(off.rotationX).toBeCloseTo(SWITCH_ROCKER_TILT_RAD, 10);
    expect(on.position[1]).toBeGreaterThan(off.position[1]);
    expect(SWITCH_ROCKER_MM.depth).toBeLessThan(SW.h);
  });

  it('ロッカーの傾きは通常ズームでも見分けられる角度まで広げてある（項目4）', () => {
    const clearlyVisibleRad = (25 * Math.PI) / 180;
    expect(SWITCH_ROCKER_TILT_RAD).toBeGreaterThanOrEqual(clearlyVisibleRad);
  });

  it('ロッカー窓の色は ON で緑、OFF で既定の暗い色に変わる（項目4）', () => {
    for (const on of [true, false]) {
      const meshes = pickables(
        <PowerSwitch
          footprint={SW}
          terminals={terminalsOf('SW')}
          color="#DCDCD6"
          heightMm={HEIGHT_MM}
          on={on}
        />,
      );
      const well = meshes.find((mesh) => mesh.props['name'] === 'switch-well');
      expect(well, `on=${on}`).toBeDefined();
      const material = well?.props['material'] as { color: { getHexString: () => string } };
      expect(`#${material.color.getHexString()}`, `on=${on}`).toBe(wellColorFor(on).toLowerCase());
    }
  });

  it('飾りのメッシュは1つもクリックを奪わない', () => {
    const meshes = pickables(
      <PowerSwitch
        footprint={SW}
        terminals={terminalsOf('SW')}
        color="#DCDCD6"
        heightMm={HEIGHT_MM}
        on={false}
      />,
    );
    expect(meshes.length).toBeGreaterThan(4);
    for (const mesh of meshes) {
      expect(typeof mesh.props['raycast']).toBe('function');
      expect(hasPointerHandler(mesh.props)).toBe(false);
    }
  });
});

describe('リレーの動作表示（§5.3.1 / 利用者要望 2026-09-19）', () => {
  it('励磁中だけ発光する', () => {
    const lit = relayIndicatorMaterial(true);
    const dark = relayIndicatorMaterial(false);

    expect(lit.emissiveIntensity).toBeGreaterThan(1);
    expect(dark.emissiveIntensity).toBe(0);
    expect(lit.color.getHexString()).not.toBe(dark.color.getHexString());
    // 同じ状態なら同じマテリアルを使い回す（§15 ドローコールとメモリ）
    expect(relayIndicatorMaterial(true)).toBe(lit);
  });

  it('点光源の本数は励磁状態によらず一定で、強度だけが変わる（3D-03）', () => {
    const socket = JIPM_BOARD.sockets[0];
    if (socket === undefined) throw new Error('no socket');
    const box = mountedBodyBox(socket);
    const lit = collect(
      <PartIndicator
        kind="relay-my4n"
        box={box}
        energized
        timedOut={false}
        presetMs={0}
        rangeMaxMs={0}
      />,
    );
    const dark = collect(
      <PartIndicator
        kind="relay-my4n"
        box={box}
        energized={false}
        timedOut={false}
        presetMs={0}
        rangeMaxMs={0}
      />,
    );

    /*
     * three の `WebGLPrograms` はプログラムのキャッシュ鍵に `numPointLights` を含むので、
     * 点いたり消えたりで**本数**が変わると盤の全マテリアルが再コンパイルされる（3D-03）。
     * 以前のテストはその性能上の問題（`lights(dark) === 0`）を仕様として固定していた。
     */
    const lights = (elements: ReactElement[]): ReactElement<{ intensity?: number }>[] =>
      elements.filter(
        (element): element is ReactElement<{ intensity?: number }> => element.type === 'pointLight',
      );
    expect(lights(lit)).toHaveLength(1);
    expect(lights(dark)).toHaveLength(lights(lit).length);
    expect(lights(lit)[0]?.props.intensity).toBeGreaterThan(0);
    expect(lights(dark)[0]?.props.intensity).toBe(0);
    /*
     * 窓そのものの発光マテリアルは励磁で入れ替わる（`relayIndicatorMaterial()`）。
     * ハローの板は焼いたテクスチャが要るので `happy-dom` では出ない（消灯中に描かないこと
     * 自体は `Glow` の `lit` が受け持つ）。ここでは要素の数ではなくマテリアルの差で縛る。
     */
    expect(relayIndicatorMaterial(true)).not.toBe(relayIndicatorMaterial(false));
    expect(lit.length).toBe(dark.length);
  });

  it('表示窓は本体の天面より上にあり、既定（正面）と俯瞰の視点から画角に入る', () => {
    const socket = JIPM_BOARD.sockets[0];
    if (socket === undefined) throw new Error('no socket');
    const box = mountedBodyBox(socket);
    expect(indicatorCenter(box)[2]).toBeGreaterThan(box.topZ);

    const viewport = { x: 0, y: 0, width: 900, height: 600 };
    for (const preset of ['front', 'top'] as const) {
      const pose = cameraPose(preset);
      for (const socket of JIPM_BOARD.sockets) {
        const center = indicatorCenter(mountedBodyBox(socket));
        const point = projectToScreen(boardToWorld(center), pose, viewport);
        expect(point.x, `${preset} ${socket.id}`).toBeGreaterThan(viewport.x);
        expect(point.x, `${preset} ${socket.id}`).toBeLessThan(viewport.x + viewport.width);
        expect(point.y, `${preset} ${socket.id}`).toBeGreaterThan(viewport.y);
        expect(point.y, `${preset} ${socket.id}`).toBeLessThan(viewport.y + viewport.height);
      }
    }
  });

  it('飾りのメッシュは1つもクリックを奪わない', () => {
    const socket = JIPM_BOARD.sockets[0];
    if (socket === undefined) throw new Error('no socket');
    const meshes = pickables(
      <PartIndicator
        kind="relay-my4n"
        box={mountedBodyBox(socket)}
        energized
        timedOut={false}
        presetMs={0}
        rangeMaxMs={0}
      />,
    );
    expect(meshes.length).toBeGreaterThan(1);
    for (const mesh of meshes) {
      expect(typeof mesh.props['raycast']).toBe('function');
      expect(hasPointerHandler(mesh.props)).toBe(false);
    }
  });
});

describe('タイマの動作表示（§5.3.2 / 利用者要望 2026-09-19）', () => {
  it('POWER は通電中、UP はタイムアップ後に点く', () => {
    expect(timerLedStates(false, false).map((s) => s.lit)).toEqual([false, false]);
    expect(timerLedStates(true, false).map((s) => s.lit)).toEqual([true, false]);
    expect(timerLedStates(true, true).map((s) => s.lit)).toEqual([true, true]);
    expect(timerLedStates(true, true).map((s) => s.led)).toEqual(['power', 'out']);
  });

  it('2灯は色も発光も別（POWER は緑、UP は橙）', () => {
    const power = timerLedMaterial('power', true);
    const out = timerLedMaterial('out', true);

    expect(power.emissiveIntensity).toBeGreaterThan(1);
    expect(out.emissiveIntensity).toBeGreaterThan(1);
    expect(power.color.getHexString()).not.toBe(out.color.getHexString());
    expect(timerLedMaterial('power', false).emissiveIntensity).toBe(0);
    expect(timerLedMaterial('out', false).emissiveIntensity).toBe(0);
  });

  it('2灯は横に並び、どちらも本体の天面の上にある', () => {
    const socket = JIPM_BOARD.sockets[0];
    if (socket === undefined) throw new Error('no socket');
    const box = mountedBodyBox(socket);
    const [power, out] = timerLedCenters(box);
    if (power === undefined || out === undefined) throw new Error('no led');

    expect(power[0]).toBeLessThan(out[0]);
    expect(power[1]).toBeCloseTo(out[1], 10);
    expect(power[2]).toBeGreaterThan(box.topZ);
    // 2灯とも本体の外形に収まる
    expect(Math.abs(power[0] - box.center[0])).toBeLessThan(box.width / 2);
    expect(Math.abs(out[0] - box.center[0])).toBeLessThan(box.width / 2);
  });

  it('設定ダイヤルの指針は設定秒に従って振れる', () => {
    const range = 10_000;
    expect(timerDialAngleRad(TIMER_MIN_PRESET_MS, range)).toBeCloseTo(
      -TIMER_DIAL_SWEEP_RAD / 2,
      10,
    );
    expect(timerDialAngleRad(range, range)).toBeCloseTo(TIMER_DIAL_SWEEP_RAD / 2, 10);
    expect(timerDialAngleRad(5_000, range)).toBeGreaterThan(timerDialAngleRad(3_000, range));
    // 範囲外は振り切れたまま（`clampPreset` と同じ扱い）
    expect(timerDialAngleRad(range * 2, range)).toBeCloseTo(TIMER_DIAL_SWEEP_RAD / 2, 10);
    expect(timerDialAngleRad(0, range)).toBeCloseTo(-TIMER_DIAL_SWEEP_RAD / 2, 10);
  });

  it('点光源の本数は点灯状態によらず一定で、強度だけが変わる（3D-03）', () => {
    const socket = JIPM_BOARD.sockets[0];
    if (socket === undefined) throw new Error('no socket');
    const box = mountedBodyBox(socket);
    const lights = (powered: boolean, timedOut: boolean): number[] =>
      collect(
        <PartIndicator
          kind="timer-h3y4"
          box={box}
          energized={powered}
          timedOut={timedOut}
          presetMs={3_000}
          rangeMaxMs={10_000}
        />,
      )
        .filter(
          (element): element is ReactElement<{ intensity?: number }> =>
            element.type === 'pointLight',
        )
        .map((element) => element.props.intensity ?? 0);

    // LED は2灯。どの状態でも点光源は2個のまま（本数が変わるとシェーダが再コンパイルされる）
    expect(lights(false, false)).toHaveLength(2);
    expect(lights(true, false)).toHaveLength(2);
    expect(lights(true, true)).toHaveLength(2);
    // 変わるのは強度だけ。POWER → UP の順に点いていく
    expect(lights(false, false)).toEqual([0, 0]);
    expect(lights(true, false)[0]).toBeGreaterThan(0);
    expect(lights(true, false)[1]).toBe(0);
    expect(lights(true, true).every((value) => value > 0)).toBe(true);
  });
});

describe('装着部品の札（§8.2）', () => {
  it('励磁中だけ「動作中」の札とツールチップが付く', () => {
    const dark = render(
      <MountedLabelContent role="CR1" part={{ kind: 'relay-my4n' }} energized={false} />,
    );
    expect(dark.container.textContent).toBe('CR1');
    expect(dark.container.querySelector('span')?.title).toBe('');
    cleanup();

    const lit = render(
      <MountedLabelContent
        role="T1"
        part={{ kind: 'timer-h3y4', presetMs: 3_000, rangeMaxMs: 10_000 }}
        energized
      />,
    );
    expect(lit.container.textContent).toContain('T1 3.0s');
    expect(lit.container.textContent).toContain('動作中');
    expect(lit.container.querySelector('span')?.title).toBe('動作中');
  });
});
