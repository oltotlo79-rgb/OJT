import { findBoardTerminal, JIPM_BOARD, type BoardTerminal } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Spherical,
  Vector2,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { terminalPoint, type CanvasBox } from '../e2e/projection.js';
import {
  boardToWorld,
  BOARD_TILT_RAD,
  CAMERA_FOV_DEG,
  cameraPose,
  MAX_POLAR_ANGLE,
  MIN_POLAR_ANGLE_RAD,
  type CameraPose,
} from '../src/renderer/three/camera.js';
import { toScene } from '../src/renderer/three/coords.js';
import { PICK_GEOMETRY } from '../src/renderer/three/materials.js';
import { terminalFieldMatrices } from '../src/renderer/three/TerminalField.js';

/**
 * 端子のクリックが本当に当たるか（2026-09-19 の不具合）。設計仕様 §6.5 / §8.2 / §12.2。
 *
 * 症状: 盤の左上隅にある DC24V 供給端子 `P.1` だけクリックが当たらない（他の端子は当たる）。
 *
 * 原因: `OrbitControls` は極角を **`camera.up` から**測って `maxPolarAngle` に丸める
 * （three-stdlib `OrbitControls.update()` の `quat.setFromUnitVectors(object.up, up)`）。
 * 面直の視点（`front` など）は `up` が `boardUp()` なので極角ちょうど 90° に来るが、
 * `MAX_POLAR_ANGLE` が 86.4°（`Math.PI * 0.48`）だったため、`update()` のたびに
 * カメラが 3.6° 引き戻されて**面直ではなくなっていた**。ずれは画面の端ほど大きく、
 * 盤の左上隅の `P.1` では当たり判定の半径（4mm ≒ 9px）を超えていた。
 *
 * ここでは①プリセットの視点が極角の範囲に収まっている（＝`update()` が動かさない）ことと、
 * ②その視点から `P.1` の射影点へ飛ばしたレイが**いちばん手前で端子の当たり判定球に当たる**
 * ことを、three の `Raycaster` で実際に確かめる。
 */

/** E2E（1440×900 のウィンドウ）で実測したキャンバスの矩形。 */
const CANVAS: CanvasBox = { x: 0, y: 0, width: 1047, height: 574 };

/**
 * そのキャンバスの縦横比。UI監査バッチA（`76a71af`）以降、`CameraPresets.tsx` は
 * `useThree(s => s.size)` の実測値を `cameraPose()` へ渡して「ペインいっぱいに盤を収める」
 * 距離を決める。**アプリと同じ値を渡さないと、ここで組むカメラだけが古い仮定（16:10）の
 * 位置に立ってしまい、射影点とレイが食い違う**（Batch E で E2E の3Dクリックが端子を
 * 外していた原因そのもの。`e2e/projection.ts` も同じ縦横比を渡す）。
 */
const CANVAS_ASPECT = CANVAS.width / CANVAS.height;

/** 面直で見る視点（`up` が盤面の上方向になるもの）。これらが極角の丸めに当たっていた。 */
const FACE_ON_PRESETS = ['front', 'back', 'socket', 'plc'] as const;

/**
 * `OrbitControls.update()` の極角の丸めを再現する（three-stdlib と同じ手順）。
 * 丸めで動かない視点＝`update()` が毎フレーム引き戻さない視点。
 */
function clampPolar(pose: CameraPose, maxPolar: number): CameraPose {
  const target = new Vector3(...pose.target);
  const quat = new Quaternion().setFromUnitVectors(new Vector3(...pose.up), new Vector3(0, 1, 0));
  const offset = new Vector3(...pose.position).sub(target).applyQuaternion(quat);
  const spherical = new Spherical().setFromVector3(offset);
  spherical.phi = Math.max(MIN_POLAR_ANGLE_RAD, Math.min(maxPolar, spherical.phi));
  spherical.makeSafe();
  const moved = new Vector3()
    .setFromSpherical(spherical)
    .applyQuaternion(quat.clone().invert())
    .add(target);
  return { ...pose, position: [moved.x, moved.y, moved.z] };
}

/** 2つの視点の距離[mm]（丸めでどれだけ動かされたか）。 */
function poseShiftMm(a: CameraPose, b: CameraPose): number {
  return Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  );
}

/** 本番で使うインスタンス行列で当たり判定を検証する。 */
function pickMesh(terminal: BoardTerminal): Mesh {
  const matrix = terminalFieldMatrices([terminal]).pickMatrices[0]!;
  const mesh = new Mesh(PICK_GEOMETRY, new MeshBasicMaterial());
  mesh.name = `pick-${terminal.id}`;
  matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  return mesh;
}

/** 板（DC24V電源の印字板など）を1枚置く。実機では `raycast={noPick}` だが、手前判定の検査のため拾わせる。 */
function plate(name: string, center: [number, number, number], w: number, h: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(...center);
  return mesh;
}

/** 箱（端子台の台座・DC24V電源の台）を1個置く。 */
function box(name: string, center: [number, number, number], size: [number, number, number]): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(...center);
  return mesh;
}

/**
 * `P.1` のまわりだけを再現した盤（傾斜グループの中に置く。`BoardScene` と同じ）。
 * 端子の当たり判定球・P/N端子台の台座と印字板・DC24V電源の台と印字板を、
 * すべて**拾える**メッシュとして置く。いちばん手前に来るのが端子でなければならない。
 */
function supplyScene(): Scene {
  const scene = new Scene();
  const tilted = new Group();
  tilted.rotation.set(BOARD_TILT_RAD, 0, 0);
  for (const id of ['P.1', 'N.1']) {
    const terminal = findBoardTerminal(JIPM_BOARD, id);
    if (terminal === undefined) throw new Error(`端子がありません: ${id}`);
    tilted.add(pickMesh(terminal));
  }
  // P/N端子台（端子 z=8mm）の台座と印字板
  tilted.add(box('block-PN', toScene({ x: 20, y: 22, z: 4 }), [16, 28, 8]));
  tilted.add(plate('block-PN-label', toScene({ x: 20, y: 22, z: 9.4 }), 16, 28));
  // DC24V電源（外形 x12..38 / y6..36、高さ5mm）の台と、端子台の印字より上に出す印字板（z=11mm）
  tilted.add(box('fixture-PS', toScene({ x: 25, y: 21, z: 2.5 }), [26, 30, 5]));
  tilted.add(plate('fixture-PS-label', toScene({ x: 25, y: 21, z: 11 }), 42, 46));
  scene.add(tilted);
  scene.updateMatrixWorld(true);
  return scene;
}

/** `pose` に置いたカメラから、ページ座標 `point` へレイを飛ばす。 */
function rayTo(pose: CameraPose, point: { x: number; y: number }): Raycaster {
  const camera = new PerspectiveCamera(CAMERA_FOV_DEG, CANVAS.width / CANVAS.height, 1, 5000);
  camera.up.set(...pose.up);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const ndc = new Vector2(
    ((point.x - CANVAS.x) / CANVAS.width) * 2 - 1,
    -(((point.y - CANVAS.y) / CANVAS.height) * 2 - 1),
  );
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, camera);
  return raycaster;
}

/** レイと点の距離[mm]（射影のずれをそのまま mm で測る）。 */
function rayDistanceMm(raycaster: Raycaster, world: Vector3): number {
  const relative = world.clone().sub(raycaster.ray.origin);
  const along = relative.dot(raycaster.ray.direction);
  return relative.sub(raycaster.ray.direction.clone().multiplyScalar(along)).length();
}

describe('視点プリセットは極角の丸めで動かない（§12.2）', () => {
  it.each(FACE_ON_PRESETS)('%s は OrbitControls の maxPolarAngle の内側にある', (preset) => {
    const pose = cameraPose(preset);
    expect(poseShiftMm(pose, clampPolar(pose, MAX_POLAR_ANGLE))).toBeLessThan(0.01);
  });

  it('面直の視点はちょうど極角 90°（盤面の上方向から測るため）', () => {
    const pose = cameraPose('front');
    const up = new Vector3(...pose.up);
    const direction = new Vector3(...pose.position).sub(new Vector3(...pose.target)).normalize();
    expect(Math.acos(direction.dot(up))).toBeCloseTo(Math.PI / 2, 10);
    expect(MAX_POLAR_ANGLE).toBeGreaterThanOrEqual(Math.PI / 2);
  });
});

describe('DC24V供給端子のクリック（2026-09-19 の不具合）', () => {
  it('正面視から P.1 の射影点へ飛ばしたレイは、まず端子の当たり判定球に当たる', () => {
    const pose = clampPolar(cameraPose('front', { aspect: CANVAS_ASPECT }), MAX_POLAR_ANGLE);
    const raycaster = rayTo(pose, terminalPoint(toTerminalId('P.1'), CANVAS));
    const hits = raycaster.intersectObjects(supplyScene().children, true);
    expect(hits[0]?.object.name).toBe('pick-P.1');
  });

  it('P.1 の射影点は当たり判定の中心の近くを通る（端ほど効く視点のずれを防ぐ）', () => {
    const terminal = findBoardTerminal(JIPM_BOARD, 'P.1');
    if (terminal === undefined) throw new Error('P.1 がありません');
    const pose = clampPolar(cameraPose('front', { aspect: CANVAS_ASPECT }), MAX_POLAR_ANGLE);
    const raycaster = rayTo(pose, terminalPoint(toTerminalId('P.1'), CANVAS));
    const center = new Vector3(...boardToWorld(toScene(terminal.pos)));
    // 3.6° の丸めが残っていると 4mm 以上ずれて、当たり判定（半径4mm）の縁から外れる
    expect(rayDistanceMm(raycaster, center)).toBeLessThan(terminal.pickRadiusMm * 0.5);
  });

  it('N.1 でも同じように当たる', () => {
    const pose = clampPolar(cameraPose('front', { aspect: CANVAS_ASPECT }), MAX_POLAR_ANGLE);
    const raycaster = rayTo(pose, terminalPoint(toTerminalId('N.1'), CANVAS));
    const hits = raycaster.intersectObjects(supplyScene().children, true);
    expect(hits[0]?.object.name).toBe('pick-N.1');
  });
});
