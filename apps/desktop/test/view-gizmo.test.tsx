import { cleanup, render } from '@testing-library/react';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ビューキューブ（`ViewGizmo`）の操作テスト。§12.2 / 2026-09-19 の利用者要望
 * 「3Dの視点の角度を変えるの少し動かしづらい。blender のようにキューブを選択し
 * サクサク動くようにしたい」。
 *
 * `ViewGizmo` が three に触るのは `useThree`（`invalidate` と `camera`）と `useFrame` だけ、
 * 3Dの木は `GizmoHelper` の子として返すだけなので、その3つを差し替えれば WebGL 無しで
 * 「押した瞬間にどれだけ回るか」「いつストアへ書くか」を丸ごと検証できる
 * （`camera-presets.test.tsx` と同じ仕掛け）。
 */

interface Vec {
  x: number;
  y: number;
  z: number;
  set: (x: number, y: number, z: number) => void;
}

const harness: {
  children: ReactNode;
  invalidateCount: number;
  camera: unknown;
  frame: (() => void) | null;
} = vi.hoisted(() => ({
  children: null,
  invalidateCount: 0,
  camera: undefined,
  frame: null,
}));

vi.mock('@react-three/drei', () => ({
  GizmoHelper: ({ children }: { children: ReactNode }) => {
    harness.children = children;
    return null;
  },
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: { invalidate: () => void; camera: unknown }) => unknown) =>
    selector({
      invalidate: () => {
        harness.invalidateCount += 1;
      },
      camera: harness.camera,
    }),
  useFrame: (callback: () => void) => {
    harness.frame = callback;
  },
}));

const { ViewGizmo, GIZMO_SIZE, GIZMO_FACE_MESH_NAME, GIZMO_HIT_PREFIX } =
  await import('../src/renderer/three/ViewGizmo.js');
const { GIZMO_DRAG_RAD_PER_PX, GIZMO_DRAG_THRESHOLD_PX, GIZMO_HIT_BOXES } =
  await import('../src/renderer/three/navigation.js');
const { MAX_POLAR_ANGLE, poseForDirection } = await import('../src/renderer/three/camera.js');
const { useStore } = await import('../src/renderer/app/store.js');

/** 盤の `OrbitControls` の身代わり（ギズモが触る部分だけ）。 */
function makeControls(): {
  enabled: boolean;
  dampingFactor: number;
  target: Vec;
  minPolarAngle: number;
  maxPolarAngle: number;
  mouseButtons: Record<string, number | undefined>;
  update: () => void;
  getAzimuthalAngle: () => number;
  getPolarAngle: () => number;
  setAzimuthalAngle: (value: number) => void;
  setPolarAngle: (value: number) => void;
  getDistance: () => number;
  azimuthCalls: number[];
  polarCalls: number[];
} {
  let azimuth = 0;
  let polar = Math.PI / 2 - 0.1;
  const azimuthCalls: number[] = [];
  const polarCalls: number[] = [];
  return {
    enabled: true,
    dampingFactor: 0.35,
    target: makeVec(0, 0, 0),
    minPolarAngle: 0,
    maxPolarAngle: MAX_POLAR_ANGLE,
    mouseButtons: {},
    update: () => undefined,
    getAzimuthalAngle: () => azimuth,
    getPolarAngle: () => polar,
    setAzimuthalAngle: (value) => {
      azimuthCalls.push(value);
      // 慣性を切ってあるので `update()` 1回で目標へ届く（本物と同じ 1:1）
      azimuth = value;
    },
    setPolarAngle: (value) => {
      polarCalls.push(value);
      polar = value;
    },
    getDistance: () => 380,
    azimuthCalls,
    polarCalls,
  };
}

function makeVec(x: number, y: number, z: number): Vec {
  const vec: Vec = {
    x,
    y,
    z,
    set: (nx, ny, nz) => {
      vec.x = nx;
      vec.y = ny;
      vec.z = nz;
    },
  };
  return vec;
}

/** カメラの身代わり。 */
function makeCamera(): {
  position: Vec;
  up: Vec;
  lookAt: () => void;
  updateProjectionMatrix: () => void;
} {
  return {
    position: makeVec(0, 0, 380),
    up: makeVec(0, 1, 0),
    lookAt: () => undefined,
    updateProjectionMatrix: () => undefined,
  };
}

/** 要素木をすべて集める（`ViewGizmo` の子は素の three 要素だけなので展開はいらない）。 */
function collect(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) collect(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const element = node as ReactElement<{ children?: ReactNode }>;
  out.push(element);
  collect(element.props.children, out);
  return out;
}

function elements(): ReactElement<Record<string, unknown>>[] {
  return collect(harness.children) as ReactElement<Record<string, unknown>>[];
}

function cubeGroup(): ReactElement<Record<string, unknown>> {
  const group = elements().find((element) => element.type === 'group');
  if (group === undefined) throw new Error('キューブの group が見つからない');
  return group;
}

/** ポインタイベント（happy-dom の `PointerEvent` に頼らず素の `Event` に値を載せる）。 */
function firePointer(
  type: string,
  init: { pointerId: number; clientX: number; clientY: number },
): void {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, init);
  window.dispatchEvent(event);
}

/** 3Dの `onPointerDown` に渡ってくる形（当たった物体と面の法線だけ使う）。 */
function pointerDown(
  name: string,
  normal: { x: number; y: number; z: number } | null,
  at: { x: number; y: number } = { x: 200, y: 200 },
): void {
  const handler = cubeGroup().props['onPointerDown'] as ((event: unknown) => void) | undefined;
  if (handler === undefined) throw new Error('onPointerDown が無い');
  handler({
    nativeEvent: { pointerId: 7, clientX: at.x, clientY: at.y, button: 0, target: null },
    stopPropagation: () => undefined,
    object: { name },
    face: normal === null ? null : { normal },
  });
}

let controls: ReturnType<typeof makeControls>;
let storeWrites: number;
let unsubscribe: () => void;

beforeEach(() => {
  harness.children = null;
  harness.invalidateCount = 0;
  harness.frame = null;
  harness.camera = makeCamera();
  controls = makeControls();
  useStore.setState({ camera: 'front', cameraNonce: 0 });
  storeWrites = 0;
  unsubscribe = useStore.subscribe(() => {
    storeWrites += 1;
  });
  render(<ViewGizmo controls={controls} />);
});

afterEach(() => {
  unsubscribe();
  cleanup();
  vi.restoreAllMocks();
});

describe('ビューキューブの形と当たり判定（§12.2）', () => {
  it('キューブは 96px で、面のメッシュ1つと辺・角20個の当たり判定を持つ（計26箇所）', () => {
    expect(GIZMO_SIZE).toBe(96);
    expect(cubeGroup().props['scale']).toEqual([GIZMO_SIZE, GIZMO_SIZE, GIZMO_SIZE]);

    const meshes = elements().filter((element) => element.type === 'mesh');
    const faces = meshes.filter((mesh) => mesh.props['name'] === GIZMO_FACE_MESH_NAME);
    const hits = meshes.filter((mesh) => {
      const name = mesh.props['name'];
      return typeof name === 'string' && name.startsWith(GIZMO_HIT_PREFIX);
    });
    expect(faces).toHaveLength(1);
    expect(hits).toHaveLength(20);
    expect(hits).toHaveLength(GIZMO_HIT_BOXES.length);
    // 面は1つのキューブに6枚の名札マテリアルを貼る（面6 + 辺12 + 角8 = 26箇所）
    const faceMesh = faces[0];
    if (faceMesh === undefined) throw new Error('面のメッシュが無い');
    const materials = (collect(faceMesh) as ReactElement<Record<string, unknown>>[]).filter(
      (element) => element.type === 'meshBasicMaterial',
    );
    expect(materials).toHaveLength(6);
    expect(materials.map((material) => material.props['attach'])).toEqual([
      'material-0',
      'material-1',
      'material-2',
      'material-3',
      'material-4',
      'material-5',
    ]);
  });

  it('辺・角の箱はふだん見えない（指したときだけ光る）', () => {
    const hitMaterials = elements().filter(
      (element) => element.type === 'meshBasicMaterial' && element.props['visible'] === false,
    );
    expect(hitMaterials).toHaveLength(20);
  });
});

describe('キューブのドラッグ（1:1・慣性なし）', () => {
  it('押した瞬間に慣性を切り、盤側の操作を止める', () => {
    expect(controls.dampingFactor).toBe(0.35);
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: 1 });
    // ドラッグ中だけ慣性ゼロ（＝`update()` 1回で目標へ届く）にして指に付いてこさせる
    expect(controls.dampingFactor).toBe(1);
    expect(controls.enabled).toBe(false);
  });

  it('100px 引いたぶんがその場で全部入る（1000px で1回転 ≒ 0.36°/px）', () => {
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: 1 });
    const before = controls.getAzimuthalAngle();
    firePointer('pointermove', { pointerId: 7, clientX: 300, clientY: 200 });

    // 1回の pointermove で 100px ぶんが**丸ごと**入る（遅れて追い付くのではない）
    expect(controls.azimuthCalls).toHaveLength(1);
    expect(controls.getAzimuthalAngle()).toBeCloseTo(before - 100 * GIZMO_DRAG_RAD_PER_PX, 12);
    expect(100 * GIZMO_DRAG_RAD_PER_PX * (180 / Math.PI)).toBeCloseTo(36, 6);
  });

  it('縦に引くと極角が動き、回り込めない範囲には丸める', () => {
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: 1 });
    const before = controls.getPolarAngle();
    // 上へ5px（極角が増える向き。`maxPolarAngle` の内側に収まる範囲で見る）
    firePointer('pointermove', { pointerId: 7, clientX: 200, clientY: 195 });
    expect(controls.getPolarAngle()).toBeCloseTo(before + 5 * GIZMO_DRAG_RAD_PER_PX, 12);

    // 下へ大きく引いても `maxPolarAngle` を超えない
    firePointer('pointermove', { pointerId: 7, clientX: 200, clientY: 2000 });
    expect(controls.getPolarAngle()).toBeLessThanOrEqual(MAX_POLAR_ANGLE);
  });

  it('しきい値未満の震えでは回さない', () => {
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: 1 });
    firePointer('pointermove', {
      pointerId: 7,
      clientX: 200 + GIZMO_DRAG_THRESHOLD_PX - 1,
      clientY: 200,
    });
    expect(controls.azimuthCalls).toHaveLength(0);
  });

  it('放したら慣性と盤側の操作が戻る', () => {
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: 1 });
    firePointer('pointermove', { pointerId: 7, clientX: 300, clientY: 200 });
    firePointer('pointerup', { pointerId: 7, clientX: 300, clientY: 200 });
    expect(controls.dampingFactor).toBe(0.35);
    expect(controls.enabled).toBe(true);
  });

  it('別のポインタの動きは無視する', () => {
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: 1 });
    firePointer('pointermove', { pointerId: 99, clientX: 400, clientY: 200 });
    expect(controls.azimuthCalls).toHaveLength(0);
  });
});

describe('ストアへ書くのは放した瞬間の1回だけ（§15）', () => {
  it('ドラッグ中は1回も書かず、回し終えても書かない', () => {
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: 1 });
    for (let step = 1; step <= 20; step += 1) {
      firePointer('pointermove', { pointerId: 7, clientX: 200 + step * 10, clientY: 200 });
    }
    expect(controls.azimuthCalls).toHaveLength(20);
    expect(storeWrites).toBe(0);

    firePointer('pointerup', { pointerId: 7, clientX: 400, clientY: 200 });
    // 自由に回した視点はプリセットではないので、ここでも視点プリセットは書き換えない
    expect(storeWrites).toBe(0);
    expect(useStore.getState().camera).toBe('front');
  });

  it('面をクリックすると、放した瞬間にちょうど1回だけ書く', () => {
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: -1 });
    expect(storeWrites).toBe(0);
    firePointer('pointermove', { pointerId: 7, clientX: 201, clientY: 200 });
    expect(storeWrites).toBe(0);
    firePointer('pointerup', { pointerId: 7, clientX: 201, clientY: 200 });
    expect(storeWrites).toBe(1);
    expect(useStore.getState().camera).toBe('back');
  });
});

describe('面・辺・角のクリックでその視点へ着く', () => {
  it('6面はツールバー・テンキーと同じ視点プリセットへ着く', () => {
    const cases = [
      [{ x: 0, y: 0, z: 1 }, 'front'],
      [{ x: 0, y: 0, z: -1 }, 'back'],
      [{ x: 1, y: 0, z: 0 }, 'right'],
      [{ x: -1, y: 0, z: 0 }, 'left'],
      [{ x: 0, y: 1, z: 0 }, 'top'],
      [{ x: 0, y: -1, z: 0 }, 'bottom'],
    ] as const;
    for (const [normal, preset] of cases) {
      pointerDown(GIZMO_FACE_MESH_NAME, normal);
      firePointer('pointerup', { pointerId: 7, clientX: 200, clientY: 200 });
      expect(useStore.getState().camera).toBe(preset);
    }
  });

  it('角はプリセットに無い45°の視点へ、ストアを触らずに動く', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(0);
    pointerDown(`${GIZMO_HIT_PREFIX}front-top-right`, null);
    firePointer('pointerup', { pointerId: 7, clientX: 200, clientY: 200 });
    expect(storeWrites).toBe(0);

    // 補間が終わるまで時間を進めて1フレーム回す
    now.mockReturnValue(10_000);
    harness.frame?.();
    const expected = poseForDirection([1, 1, 1], { distance: 380, target: [0, 0, 0] });
    const camera = harness.camera as ReturnType<typeof makeCamera>;
    expect(camera.position.x).toBeCloseTo(expected.position[0], 6);
    expect(camera.position.y).toBeCloseTo(expected.position[1], 6);
    expect(camera.position.z).toBeCloseTo(expected.position[2], 6);
    expect(camera.position.x).toBeGreaterThan(0);
    expect(camera.position.y).toBeGreaterThan(0);
    expect(camera.position.z).toBeGreaterThan(0);
  });

  it('26箇所すべてが「面＝プリセット／辺・角＝45°の視点」のどちらかに着く', () => {
    const now = vi.spyOn(performance, 'now');
    for (const box of GIZMO_HIT_BOXES) {
      now.mockReturnValue(0);
      pointerDown(`${GIZMO_HIT_PREFIX}${box.id}`, null);
      firePointer('pointerup', { pointerId: 7, clientX: 200, clientY: 200 });
      now.mockReturnValue(10_000);
      harness.frame?.();
      const camera = harness.camera as ReturnType<typeof makeCamera>;
      const expected = poseForDirection([box.position[0], box.position[1], box.position[2]], {
        distance: 380,
        target: [0, 0, 0],
      });
      expect(camera.position.x).toBeCloseTo(expected.position[0], 6);
      expect(camera.position.y).toBeCloseTo(expected.position[1], 6);
      expect(camera.position.z).toBeCloseTo(expected.position[2], 6);
    }
    // 辺・角はプリセットが無いので視点プリセットは動かない
    expect(useStore.getState().camera).toBe('front');
  });

  it('ドラッグして放したときはスナップしない', () => {
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: -1 });
    firePointer('pointermove', { pointerId: 7, clientX: 320, clientY: 200 });
    firePointer('pointerup', { pointerId: 7, clientX: 320, clientY: 200 });
    expect(useStore.getState().camera).toBe('front');
  });
});
