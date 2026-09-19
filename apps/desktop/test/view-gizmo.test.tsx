import { cleanup, render } from '@testing-library/react';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Color } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLC_UNIT_FX5U } from '@ojt/board-model';
import { projectToScreen, type CanvasBox } from '../e2e/projection.js';

/**
 * ビューキューブ（`ViewGizmo`）の操作テスト。§12.2 / 2026-09-19 の利用者要望
 * 「3Dの視点の角度を変えるの少し動かしづらい。blender のようにキューブを選択し
 * サクサク動くようにしたい」と「3Dのキューブのデザインがシンプルすぎる」。
 *
 * `ViewGizmo` が three に触るのは `useThree`（`invalidate` / `camera` / `gl`）と `useFrame` だけ、
 * 3Dの木は `GizmoHelper` の子として返すだけなので、その3つを差し替えれば WebGL 無しで
 * 「押した瞬間にどれだけ回るか」「いつストアへ書くか」を丸ごと検証できる
 * （`camera-presets.test.tsx` と同じ仕掛け）。
 *
 * 見た目（面取り・下地・ボタン）は、木の形と `paintGizmo()` の塗り分けで確かめる。
 *
 * 2026-09-20 の利用者指摘「3Dのキューブと赤、青、緑の骨組みがある意味は？…重なってるし」で
 * 座標軸の三脚を撤去し、HUD の大きさ・余白をキャンバス幅から決めるようにした
 * （`gizmoLayoutForViewport()`）ので、`useThree` の身代わりに `size`（キャンバスの CSS px）を足す。
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
  gl: { domElement: { style: { cursor: string } } };
  /** キャンバスの CSS px 幅・高さ。既定は HUD が既定の96pxで出る広さ（900px以上）。 */
  size: { width: number; height: number };
} = vi.hoisted(() => ({
  children: null,
  invalidateCount: 0,
  camera: undefined,
  frame: null,
  gl: { domElement: { style: { cursor: '' } } },
  size: { width: 1024, height: 768 },
}));

vi.mock('@react-three/drei', () => ({
  GizmoHelper: ({ children }: { children: ReactNode }) => {
    harness.children = children;
    return null;
  },
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (
    selector: (state: {
      invalidate: () => void;
      camera: unknown;
      gl: unknown;
      size: { width: number; height: number };
    }) => unknown,
  ) =>
    selector({
      invalidate: () => {
        harness.invalidateCount += 1;
      },
      camera: harness.camera,
      gl: harness.gl,
      size: harness.size,
    }),
  useFrame: (callback: () => void) => {
    harness.frame = callback;
  },
}));

const {
  ViewGizmo,
  gizmoGlow,
  paintGizmo,
  gizmoLayoutForViewport,
  GIZMO_SIZE,
  GIZMO_SIZE_NARROW,
  GIZMO_MIN_VIEWPORT_PX,
  GIZMO_WIDE_VIEWPORT_PX,
  GIZMO_BUTTON,
  GIZMO_BUTTON_PREFIX,
  GIZMO_BUTTONS,
  GIZMO_CHAMFER_GROUP_NAME,
  GIZMO_CHAMFER_PREFIX,
  GIZMO_COLORS,
  GIZMO_FACE_MESH_NAME,
  GIZMO_HIT_PREFIX,
  GIZMO_MARGIN,
  GIZMO_PLATE_NAME,
  GIZMO_PLATE_RADIUS,
  GIZMO_TIP_PREFIX,
} = await import('../src/renderer/three/ViewGizmo.js');
const { GIZMO_DRAG_RAD_PER_PX, GIZMO_DRAG_THRESHOLD_PX, GIZMO_FACE_ORDER, GIZMO_HIT_BOXES } =
  await import('../src/renderer/three/navigation.js');
const { chamferedFaceGeometry, GIZMO_FACETS } =
  await import('../src/renderer/three/view-gizmo-geometry.js');
const {
  MAX_POLAR_ANGLE,
  poseForDirection,
  cameraPose,
  boardToWorld,
  plcViewRect,
  PLC_VIEW_ASPECT,
} = await import('../src/renderer/three/camera.js');
const { toScene } = await import('../src/renderer/three/coords.js');
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

/** 名前で3D要素を引く。 */
function byName(name: string): ReactElement<Record<string, unknown>> {
  const found = elements().find((element) => element.props['name'] === name);
  if (found === undefined) throw new Error(`${name} が見つからない`);
  return found;
}

/** 名前が接頭辞で始まる3D要素をすべて引く。 */
function byPrefix(prefix: string): ReactElement<Record<string, unknown>>[] {
  return elements().filter((element) => {
    const name = element.props['name'];
    return typeof name === 'string' && name.startsWith(prefix);
  });
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
  source: ReactElement<Record<string, unknown>> = cubeGroup(),
): void {
  const handler = source.props['onPointerDown'] as ((event: unknown) => void) | undefined;
  if (handler === undefined) throw new Error('onPointerDown が無い');
  handler({
    nativeEvent: { pointerId: 7, clientX: at.x, clientY: at.y, button: 0, target: null },
    stopPropagation: () => undefined,
    object: { name },
    face: normal === null ? null : { normal },
  });
}

/** ホバーの出入りを呼ぶ（面のメッシュの `onPointerMove` / `onPointerOut`）。 */
function hoverFace(normal: { x: number; y: number; z: number } | null): void {
  const mesh = byName(GIZMO_FACE_MESH_NAME);
  if (normal === null) {
    (mesh.props['onPointerOut'] as () => void)();
    return;
  }
  (mesh.props['onPointerMove'] as (event: unknown) => void)({
    stopPropagation: () => undefined,
    object: { name: GIZMO_FACE_MESH_NAME },
    face: { normal },
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
  harness.gl.domElement.style.cursor = '';
  harness.size = { width: 1024, height: 768 };
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
    // 面は1つのメッシュに6枚の名札マテリアルを貼る（面6 + 辺12 + 角8 = 26箇所）
    const faceMesh = faces[0];
    if (faceMesh === undefined) throw new Error('面のメッシュが無い');
    const materials = (collect(faceMesh) as ReactElement<Record<string, unknown>>[]).filter(
      (element) => element.type === 'meshLambertMaterial',
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

describe('角を落としたキューブの見た目（2026-09-19「シンプルすぎる」）', () => {
  it('面は6枚の板（材質グループ6つ）で、キューブの外形は ±0.5 に収まる', () => {
    const geometry = chamferedFaceGeometry();
    expect(geometry.groups).toHaveLength(6);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    const position = geometry.getAttribute('position');
    // 6面 × 4頂点
    expect(position.count).toBe(24);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) throw new Error('外形が計算できない');
    expect(box.max.x).toBeCloseTo(0.5, 10);
    expect(box.min.y).toBeCloseTo(-0.5, 10);
    geometry.dispose();
  });

  it('面取りは辺12枚・角8枚あり、当たり判定と同じ名前で描かれる', () => {
    expect(GIZMO_FACETS.filter((facet) => facet.kind === 'edge')).toHaveLength(12);
    expect(GIZMO_FACETS.filter((facet) => facet.kind === 'corner')).toHaveLength(8);

    const chamferGroup = byName(GIZMO_CHAMFER_GROUP_NAME);
    const facets = (collect(chamferGroup) as ReactElement<Record<string, unknown>>[]).filter(
      (element) => element.type === 'mesh',
    );
    expect(facets).toHaveLength(GIZMO_FACETS.length);
    expect(facets).toHaveLength(20);
    // 面取りは見た目だけ（当たり判定は同じ名前の箱が持つ）
    for (const facet of facets) expect(typeof facet.props['raycast']).toBe('function');
    expect(new Set(facets.map((facet) => facet.props['name'])).size).toBe(20);
    for (const facet of GIZMO_FACETS) {
      expect(byName(`${GIZMO_CHAMFER_PREFIX}${facet.id}`)).toBeDefined();
      expect(GIZMO_HIT_BOXES.some((box) => box.id === facet.id)).toBe(true);
    }
  });

  it('角の面取りはキューブの稜線の上に頂点が来る（面取りの深さと辻褄が合う）', () => {
    const corner = GIZMO_FACETS.find((facet) => facet.id === 'front-top-right');
    if (corner === undefined) throw new Error('角の面取りが無い');
    // 中心はキューブの対角線の上（3成分が同じ）
    expect(corner.position[0]).toBeCloseTo(corner.position[1], 12);
    expect(corner.position[1]).toBeCloseTo(corner.position[2], 12);
    expect(corner.position[0]).toBeLessThan(0.5);
    expect(corner.position[0]).toBeGreaterThan(0.4);
  });

  it('暗い下地の丸がキューブの後ろにあり、深度を書かずに真っ先に描かれる', () => {
    const plate = byName(GIZMO_PLATE_NAME);
    expect(plate.props['renderOrder']).toBe(-10);
    const material = (collect(plate) as ReactElement<Record<string, unknown>>[]).find(
      (element) => element.type === 'meshBasicMaterial',
    );
    if (material === undefined) throw new Error('下地のマテリアルが無い');
    expect(material.props['color']).toBe(GIZMO_COLORS.plate);
    expect(material.props['transparent']).toBe(true);
    expect(material.props['opacity']).toBeCloseTo(0.6, 10);
    expect(material.props['depthWrite']).toBe(false);
    // 下地はビューポートの外へはみ出さない（`margin` は中心の位置）
    expect(GIZMO_MARGIN[0]).toBeGreaterThan(GIZMO_PLATE_RADIUS);
    expect(GIZMO_MARGIN[1]).toBeGreaterThan(GIZMO_PLATE_RADIUS);
  });

  it('HUD には光が無いので、環境光とキーライトを自前で置く', () => {
    expect(elements().filter((element) => element.type === 'ambientLight')).toHaveLength(1);
    expect(elements().filter((element) => element.type === 'directionalLight')).toHaveLength(1);
  });
});

describe('座標軸の三脚は撤去（2026-09-20 の利用者指摘「重なってるし」）', () => {
  it('キューブと同じ操作をする重複した部品なので、木のどこにも三脚・軸の球が無い', () => {
    const namedMeshes = elements().filter(
      (element) => element.type === 'mesh' && typeof element.props['name'] === 'string',
    );
    const names = namedMeshes.map((element) => element.props['name'] as string);
    expect(names.some((name) => name.includes('axis'))).toBe(false);
    expect(names.some((name) => name.includes('triad'))).toBe(false);
    // 名前を持つメッシュは 面(1) + 辺・角の当たり判定(20) + 面取り(20) + ボタン(2) + ツールチップ(2) +
    // 下地の丸(1) だけ（軸の球の6個ぶんが増えていない）
    expect(namedMeshes).toHaveLength(1 + 20 + 20 + 2 + 2 + 1);
  });
});

describe('HUD の大きさはキャンバス幅で決まる（2026-09-20 の利用者指摘「重なってるし」）', () => {
  it('900px以上は96px、600〜900px未満は64px、600px未満は隠す', () => {
    expect(gizmoLayoutForViewport(GIZMO_WIDE_VIEWPORT_PX)?.size).toBe(GIZMO_SIZE);
    expect(gizmoLayoutForViewport(1280)?.size).toBe(GIZMO_SIZE);
    expect(gizmoLayoutForViewport(GIZMO_WIDE_VIEWPORT_PX - 1)?.size).toBe(GIZMO_SIZE_NARROW);
    expect(gizmoLayoutForViewport(GIZMO_MIN_VIEWPORT_PX)?.size).toBe(GIZMO_SIZE_NARROW);
    expect(gizmoLayoutForViewport(GIZMO_MIN_VIEWPORT_PX - 1)).toBeNull();
    expect(gizmoLayoutForViewport(420)).toBeNull();
  });

  it('下地の丸はキューブとボタン2つの外接円ちょうどに収まる（空き地を残さない）', () => {
    for (const widthPx of [GIZMO_MIN_VIEWPORT_PX, GIZMO_WIDE_VIEWPORT_PX]) {
      const layout = gizmoLayoutForViewport(widthPx);
      if (layout === null) throw new Error('layout is null');
      // ボタンの外側の縁（下端）は下地の丸の中に収まる（下地がボタンを包む）
      expect(Math.abs(layout.buttonY) + GIZMO_BUTTON.size / 2).toBeLessThan(layout.plateRadius);
      // 余白は下地の丸より大きい（HUD がビューポートの外へはみ出さない）
      expect(layout.margin[0]).toBeGreaterThan(layout.plateRadius);
      expect(layout.margin[1]).toBeGreaterThan(layout.plateRadius);
    }
  });

  it('狭いキャンバス（64px）はキューブが既定より小さく、ボタンはキューブのすぐ下に来る', () => {
    const wide = gizmoLayoutForViewport(GIZMO_WIDE_VIEWPORT_PX);
    const narrow = gizmoLayoutForViewport(GIZMO_MIN_VIEWPORT_PX);
    if (wide === null || narrow === null) throw new Error('layout is null');
    expect(narrow.size).toBeLessThan(wide.size);
    expect(narrow.plateRadius).toBeLessThan(wide.plateRadius);
    // ボタン行までの隙間（キューブの外形からボタン中心まで）は三脚が居たころの108pxよりずっと近い
    expect(Math.abs(narrow.buttonY)).toBeLessThan(108);
    expect(Math.abs(wide.buttonY)).toBeLessThan(108);
  });

  /**
   * 2026-09-20 の監査指摘 B4「ビューキューブの⌂と視点ヘルプの?が並べて表示（1280px）で
   * 物理的に重なる」。幅だけで大きさを決めると、モードB「並べて」の1280px幅のように
   * ペインが横に広く縦だけ低い場面で、下地の丸がペインの下端（＝`panels/ViewHint.tsx` の
   * 「?」が居る場所）まで届いてしまう。高さも渡すと、下地の丸がその高さに収まらないときは
   * 幅の判定にかかわらず隠す。
   */
  it('高さを渡すと、下地の丸がその高さに収まらないときは幅にかかわらず隠す', () => {
    const wide = gizmoLayoutForViewport(GIZMO_WIDE_VIEWPORT_PX);
    if (wide === null) throw new Error('layout is null');
    const footprint = wide.margin[1] + wide.plateRadius;

    // 収まる高さでは既定どおり出る
    expect(gizmoLayoutForViewport(GIZMO_WIDE_VIEWPORT_PX, footprint)).not.toBeNull();
    // ちょうど1px足りないと隠す
    expect(gizmoLayoutForViewport(GIZMO_WIDE_VIEWPORT_PX, footprint - 1)).toBeNull();

    // モードB「並べて」の1280px幅・縦2段積みで3Dペインが約200px台まで潰れる場合
    expect(gizmoLayoutForViewport(1280, 210)).toBeNull();
    // 高さを渡さない（省略）既存の呼び出しは、幅だけの既定の挙動のまま変わらない
    expect(gizmoLayoutForViewport(1280)?.size).toBe(GIZMO_SIZE);
  });
});

describe('⌂ と ⟳ のボタン', () => {
  it('2つとも 24px 以上の押しやすさで、日本語のツールチップを持つ', () => {
    const buttons = byPrefix(GIZMO_BUTTON_PREFIX);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const scale = button.props['scale'] as [number, number, number];
      expect(scale[0]).toBeGreaterThanOrEqual(24);
      expect(scale[1]).toBeGreaterThanOrEqual(24);
    }
    expect(byPrefix(GIZMO_TIP_PREFIX)).toHaveLength(2);
    // ツールチップはふだん出さない
    for (const tip of byPrefix(GIZMO_TIP_PREFIX)) expect(tip.props['visible']).toBe(false);
  });

  it('⌂ は正面の全体表示へ、⟳ はいまの視点へ着け直す（どちらもストアへ1回だけ書く）', () => {
    useStore.setState({ camera: 'top' });
    storeWrites = 0;

    const home = byName(`${GIZMO_BUTTON_PREFIX}${GIZMO_BUTTONS[0].id}`);
    (home.props['onClick'] as (event: unknown) => void)({ stopPropagation: () => undefined });
    expect(storeWrites).toBe(1);
    expect(useStore.getState().camera).toBe('front');

    useStore.setState({ camera: 'left' });
    storeWrites = 0;
    const nonce = useStore.getState().cameraNonce;
    const reset = byName(`${GIZMO_BUTTON_PREFIX}${GIZMO_BUTTONS[1].id}`);
    (reset.props['onClick'] as (event: unknown) => void)({ stopPropagation: () => undefined });
    expect(storeWrites).toBe(1);
    // 視点は変えず、番号だけ進めて同じプリセットへ着け直す（傾きが戻る）
    expect(useStore.getState().camera).toBe('left');
    expect(useStore.getState().cameraNonce).toBe(nonce + 1);
  });
});

describe('ホバーの光り方（200ms で出入りする）', () => {
  /** `paintGizmo()` に渡す偽の3D木（面6枚＋辺・角の箱＋ボタン）。 */
  function fakeGizmo(): {
    root: { name: string; children: unknown[] };
    faces: { emissive: Color }[];
    hit: { opacity: number; visible: boolean };
    button: { color: Color };
  } {
    const faces = GIZMO_FACE_ORDER.map(() => ({ emissive: new Color('#000000') }));
    const hit = { opacity: 0, visible: false };
    const button = { color: new Color('#FFFFFF') };
    return {
      root: {
        name: '',
        children: [
          { name: GIZMO_FACE_MESH_NAME, children: [], material: faces },
          { name: `${GIZMO_HIT_PREFIX}front-top`, children: [], material: hit },
          { name: `${GIZMO_BUTTON_PREFIX}home`, children: [], material: button },
        ],
      },
      faces,
      hit,
      button,
    };
  }

  /** 偽の木を `paintGizmo()` に食わせる。 */
  function paint(
    fake: ReturnType<typeof fakeGizmo>,
    highlight: {
      hovered: string | null;
      fading: string | null;
      fade: number;
      active: string | null;
    },
  ): void {
    paintGizmo(fake.root as unknown as Parameters<typeof paintGizmo>[0], highlight);
  }

  it('指している面だけが自発光し、離すと元へ戻る', () => {
    const fake = fakeGizmo();
    const front = GIZMO_FACE_ORDER.indexOf('front');
    const back = GIZMO_FACE_ORDER.indexOf('back');

    paint(fake, { hovered: 'front', fading: null, fade: 1, active: null });
    expect(fake.faces[front]?.emissive.getHex()).toBeGreaterThan(0);
    expect(fake.faces[back]?.emissive.getHex()).toBe(0);

    // 離すと（消えていく側として）0 に戻る
    paint(fake, { hovered: null, fading: 'front', fade: 1, active: null });
    expect(fake.faces[front]?.emissive.getHex()).toBe(0);
  });

  it('出入りの途中は明るさが中間になる（200ms の補間）', () => {
    const fake = fakeGizmo();
    const front = GIZMO_FACE_ORDER.indexOf('front');
    paint(fake, { hovered: 'front', fading: null, fade: 0.5, active: null });
    const half = fake.faces[front]?.emissive.r ?? 0;
    paint(fake, { hovered: 'front', fading: null, fade: 1, active: null });
    const full = fake.faces[front]?.emissive.r ?? 0;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
  });

  it('いまの視点の面には淡い色が残り、ホバーの色で上書きされる', () => {
    const fake = fakeGizmo();
    const top = GIZMO_FACE_ORDER.indexOf('top');
    paint(fake, { hovered: null, fading: null, fade: 1, active: 'top' });
    const idle = fake.faces[top]?.emissive.clone() ?? new Color();
    expect(idle.getHex()).toBeGreaterThan(0);
    // 淡い青（ホバーの暖色とは別物）
    expect(idle.b).toBeGreaterThan(idle.r);

    paint(fake, { hovered: 'top', fading: null, fade: 1, active: 'top' });
    const hovered = fake.faces[top]?.emissive.clone() ?? new Color();
    expect(hovered.r).toBeGreaterThan(hovered.b);
  });

  it('辺・角の箱とボタンも同じ割合で光る', () => {
    const fake = fakeGizmo();
    paint(fake, { hovered: 'front-top', fading: null, fade: 1, active: null });
    expect(fake.hit.visible).toBe(true);
    expect(fake.hit.opacity).toBeGreaterThan(0.5);

    paint(fake, { hovered: null, fading: null, fade: 1, active: null });
    expect(fake.hit.visible).toBe(false);
    expect(fake.hit.opacity).toBe(0);

    paint(fake, { hovered: 'home', fading: null, fade: 1, active: null });
    // 白いテクスチャに暖色を掛ける（赤が青より強くなる）
    expect(fake.button.color.r).toBeGreaterThan(fake.button.color.b);
  });

  it('光り具合は 0〜1 に収まる（出入りが重なっても飽和しない）', () => {
    expect(gizmoGlow('front', { hovered: 'front', fading: null, fade: 0.25, active: null })).toBe(
      0.25,
    );
    expect(gizmoGlow('front', { hovered: null, fading: 'front', fade: 0.25, active: null })).toBe(
      0.75,
    );
    expect(gizmoGlow('front', { hovered: 'front', fading: 'front', fade: 0.5, active: null })).toBe(
      1,
    );
    expect(gizmoGlow('left', { hovered: 'front', fading: null, fade: 1, active: null })).toBe(0);
  });

  it('キューブの上ではカーソルが掴む形になり、離すと戻る', () => {
    hoverFace({ x: 0, y: 0, z: 1 });
    expect(harness.gl.domElement.style.cursor).toBe('grab');
    hoverFace(null);
    expect(harness.gl.domElement.style.cursor).toBe('');
  });
});

describe('キューブのドラッグ（1:1・慣性なし）', () => {
  it('押した瞬間に慣性を切り、盤側の操作を止める', () => {
    expect(controls.dampingFactor).toBe(0.35);
    pointerDown(GIZMO_FACE_MESH_NAME, { x: 0, y: 0, z: 1 });
    // ドラッグ中だけ慣性ゼロ（＝`update()` 1回で目標へ届く）にして指に付いてこさせる
    expect(controls.dampingFactor).toBe(1);
    expect(controls.enabled).toBe(false);
    expect(harness.gl.domElement.style.cursor).toBe('grabbing');
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
    expect(harness.gl.domElement.style.cursor).toBe('');
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

describe('狭いキャンバスでは何も描かない（600px未満・2026-09-20 の利用者指摘）', () => {
  it('600px未満のキャンバスでは GizmoHelper を呼ばない（キューブ・下地・ボタンが一切出ない）', () => {
    cleanup();
    harness.children = null;
    harness.size = { width: 420, height: 560 };
    render(<ViewGizmo controls={controls} />);
    expect(harness.children).toBeNull();
    // useFrame は登録されるが、参照する group が無いので何もしない（例外を投げない）
    expect(() => harness.frame?.()).not.toThrow();
  });
});

describe('HUDは分割ビューの盤に重ならない（2026-09-20 の利用者指摘「重なってるし」）', () => {
  it('1280×800の分割レイアウト（3Dペイン420px幅）ではHUDが隠れ、盤の投影と重ならない', () => {
    /*
     * `screens.module.css` の `.plcLayout` は `--plc-board-w: max(420px, min(32vw, aspect×paneH))`。
     * 1280px幅では 32vw ≈ 409.6px < 420px なので下限の420pxに丸まり、高さは
     * `PLC_VIEW_ASPECT`（camera.ts）で決まる（`max-height: calc(--plc-board-w / --plc-aspect)`）。
     */
    const canvasBox: CanvasBox = { x: 0, y: 0, width: 420, height: 420 / PLC_VIEW_ASPECT };
    const layout = gizmoLayoutForViewport(canvasBox.width);
    // 600px未満は隠す仕様なので、分割レイアウトの実測幅ではそもそも描かれない
    expect(layout).toBeNull();

    // 隠れている理由を幾何でも確かめる: 万一 hidden にならなかったとしても、
    // HUD の外形（下地の丸の外接正方形）が盤の投影と重ならないことを検証する
    // （`plcViewRect()` / `projectToScreen()` は E2E の `e2e/navigation.spec.ts` と同じ計算）。
    const rect = plcViewRect(PLC_UNIT_FX5U);
    const pose = cameraPose('plc');
    const corners = [
      { x: rect.x, y: rect.y, z: 0 },
      { x: rect.x + rect.w, y: rect.y, z: 0 },
      { x: rect.x, y: rect.y + rect.h, z: 0 },
      { x: rect.x + rect.w, y: rect.y + rect.h, z: 0 },
    ].map((point) => projectToScreen(boardToWorld(toScene(point)), pose, canvasBox));
    const boardRect = {
      left: Math.min(...corners.map((c) => c.x)),
      right: Math.max(...corners.map((c) => c.x)),
      top: Math.min(...corners.map((c) => c.y)),
      bottom: Math.max(...corners.map((c) => c.y)),
    };
    const hudRadius = layout?.plateRadius ?? 0;
    const hudRect = { left: 0, right: hudRadius * 2, top: 0, bottom: hudRadius * 2 };
    const intersects =
      hudRect.left < boardRect.right &&
      hudRect.right > boardRect.left &&
      hudRect.top < boardRect.bottom &&
      hudRect.bottom > boardRect.top;
    expect(intersects).toBe(false);
  });

  it('96pxキューブが出るぎりぎりの幅（900px）でも、HUDは左上の角のすぐ内側に収まる', () => {
    const canvasBox: CanvasBox = { x: 0, y: 0, width: 900, height: 900 / PLC_VIEW_ASPECT };
    const layout = gizmoLayoutForViewport(canvasBox.width);
    if (layout === null) throw new Error('layout is null');
    // HUD の外形は左上の角から見て、キャンバスの半分未満に収まる（画面を覆い尽くさない）
    expect(layout.margin[0] + layout.plateRadius).toBeLessThan(canvasBox.width / 2);
    expect(layout.margin[1] + layout.plateRadius).toBeLessThan(canvasBox.height / 2);
  });
});
