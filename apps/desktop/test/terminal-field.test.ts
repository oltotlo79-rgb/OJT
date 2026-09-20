import { JIPM_BOARD, isOffBoardTerminal } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import type { Matrix4 } from 'three';
import { Group, InstancedMesh, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { terminalPoint, type CanvasBox } from '../e2e/projection.js';
import { sessionForProblem } from '../src/renderer/app/store.js';
import {
  BOARD_TILT_RAD,
  CAMERA_FOV_DEG,
  cameraPose,
  type CameraPose,
} from '../src/renderer/three/camera.js';
import { toScene } from '../src/renderer/three/coords.js';
import { INVISIBLE_MATERIAL, PICK_GEOMETRY } from '../src/renderer/three/materials.js';
import {
  boardFieldTerminals,
  terminalColorOf,
  terminalFieldMatrices,
  terminalStateOf,
  PICK_LIFT_MM,
  TERMINAL_STATE_COLORS,
} from '../src/renderer/three/TerminalField.js';

/**
 * 盤の端子をまとめて描く場（Plan 5 Task 12 / 決定表#13・#14）。
 *
 * `TerminalHit` は端子1個につき `<group>` ＋ ネジ ＋ 当たり判定球の3オブジェクトを作る。
 * 盤の端子は134個あるので、ここだけで 268 メッシュ＝ドローコールも同数になっていた。
 * `TerminalField` は `instancedMesh` 2本（ネジ頭／当たり判定球）にまとめる。
 *
 * ここで縛るのは①**描く端子が1個も増減しないこと**、②状態の優先順と色、
 * ③**当たり判定の位置と大きさが `TerminalHit` と同じで、レイキャストが `instanceId` で
 * 端子1個に解決すること**（2026-09-19 の `P.1` の不具合＝`terminal-pick.test.ts` が
 * 守っている挙動を、インスタンス化しても失わないこと）。
 */

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');
/** `BoardScene` が渡すのと同じ値（b-001 は任意部品を足さないので空）。 */
const extraParts = sessionForProblem(problem).extraParts;

describe('boardFieldTerminals', () => {
  it('draws exactly what Socket and TerminalBlock draw today (決定表#13)', () => {
    const field = boardFieldTerminals(JIPM_BOARD, extraParts);
    // 8ソケット×14 ＝112 ＋ TB_PL 8 ＋ TB_PB 12 ＋ P 1 ＋ N 1 ＝ 134
    expect(field).toHaveLength(134);
    expect(field.every((t) => t.wirable)).toBe(true);
    expect(field.some((t) => isOffBoardTerminal(t.id))).toBe(false);
    // `wirable: false` の端子（CB / SW / PS・PB／PL 本体）は `TerminalHit` を持っていなかった
    expect(
      field.some((t) => ['CB', 'SW', 'PS', 'PB1', 'PL1'].includes(t.id.split('.')[0] ?? '')),
    ).toBe(false);
    // ソケットは**物理ID**のまま（この場は盤定義の座標を描くだけ。役割IDは端子リストの語彙）
    expect(field.filter((t) => /^S[1-8]\./u.test(t.id))).toHaveLength(112);
  });

  it('adds the buzzer only when the problem put one on the board (§5.3.4)', () => {
    expect(boardFieldTerminals(JIPM_BOARD, ['BZ'])).toHaveLength(136);
  });

  it('keeps the order stable so the instance ids do not shuffle between renders', () => {
    expect(boardFieldTerminals(JIPM_BOARD, extraParts).map((t) => t.id)).toEqual(
      boardFieldTerminals(JIPM_BOARD, extraParts).map((t) => t.id),
    );
  });
});

describe('terminalStateOf（決定表#14）', () => {
  it('ranks pending over hovered over plain', () => {
    expect(terminalStateOf('CR1.14', { hovered: 'CR1.14', pending: 'CR1.14' })).toBe('pending');
    expect(terminalStateOf('CR1.14', { hovered: 'CR1.14', pending: undefined })).toBe('hovered');
    expect(terminalStateOf('CR1.14', { hovered: undefined, pending: undefined })).toBe('plain');
  });

  it('has a colour for every state and does not reuse one', () => {
    // Phase 7 Task 27 で「繋げる（緑）／繋げない（灰）」の2つが増えて5状態になった
    const colors = Object.values(TERMINAL_STATE_COLORS);
    expect(colors).toHaveLength(5);
    expect(new Set(colors).size).toBe(5);
    expect(terminalColorOf('plain')).toBe(TERMINAL_STATE_COLORS.plain);
  });

  it('配線中はつなげる端子だけが緑、つなげない端子は灰に沈む（Phase 7 設計 §7.3.2）', () => {
    const legal = new Set(['CR1.14']);
    expect(terminalStateOf('CR1.14', { hovered: undefined, pending: undefined, legal })).toBe(
      'legal',
    );
    expect(terminalStateOf('CR1.9', { hovered: undefined, pending: undefined, legal })).toBe(
      'illegal',
    );
    // 配線待ちとホバーは可否より優先する（いま触っているものを見失わない）
    expect(terminalStateOf('CR1.9', { hovered: 'CR1.9', pending: undefined, legal })).toBe(
      'hovered',
    );
    expect(terminalStateOf('CR1.9', { hovered: undefined, pending: 'CR1.9', legal })).toBe(
      'pending',
    );
  });
});

/** E2E（1440×900 のウィンドウ）で実測したキャンバスの矩形（`terminal-pick.test.ts` と同じ）。 */
const CANVAS: CanvasBox = { x: 0, y: 0, width: 1047, height: 574 };

/** `pose` に置いたカメラから、ページ座標 `point` へレイを飛ばす（`terminal-pick.test.ts` と同じ）。 */
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

function matrixAt(list: readonly Matrix4[], index: number): Matrix4 {
  const matrix = list[index];
  if (matrix === undefined) throw new Error(`行列がありません: ${index}`);
  return matrix;
}

/** 当たり判定球を1本の `instancedMesh` にした盤（`BoardScene` と同じ傾斜グループの中）。 */
function pickField(): { mesh: InstancedMesh; ids: readonly string[] } {
  const terminals = boardFieldTerminals(JIPM_BOARD, extraParts);
  const mesh = new InstancedMesh(PICK_GEOMETRY, INVISIBLE_MATERIAL, terminals.length);
  terminalFieldMatrices(terminals).pickMatrices.forEach((matrix, index) => {
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  const tilted = new Group();
  tilted.rotation.set(BOARD_TILT_RAD, 0, 0);
  tilted.add(mesh);
  const scene = new Scene();
  scene.add(tilted);
  scene.updateMatrixWorld(true);
  return { mesh, ids: terminals.map((t) => t.id) };
}

describe('terminalFieldMatrices（当たり判定を `TerminalHit` と同じにする）', () => {
  it('当たり判定球は端子の真上 PICK_LIFT_MM に、半径 pickRadiusMm で置かれる', () => {
    const terminals = boardFieldTerminals(JIPM_BOARD, extraParts);
    const { pickMatrices, screwMatrices } = terminalFieldMatrices(terminals);
    expect(pickMatrices).toHaveLength(terminals.length);
    expect(screwMatrices).toHaveLength(terminals.length);
    // `TerminalHit` は `<group position={toScene(pos)}>` の中に当たり判定球を
    // `position={[0, 0, PICK_LIFT_MM]}` / `scale={pickRadiusMm}` で置いていた
    const index = terminals.findIndex((t) => t.id === toTerminalId('P.1'));
    const terminal = terminals[index];
    if (terminal === undefined) throw new Error('P.1 が場にありません');
    const [x, y, z] = toScene(terminal.pos);
    const position = new Vector3().setFromMatrixPosition(matrixAt(pickMatrices, index));
    const scale = new Vector3().setFromMatrixScale(matrixAt(pickMatrices, index));
    expect([position.x, position.y, position.z]).toEqual([x, y, z + PICK_LIFT_MM]);
    expect(scale.x).toBeCloseTo(terminal.pickRadiusMm, 10);
    expect(PICK_LIFT_MM).toBe(3);
    // ネジ頭は端子の座標そのもの（浮かせない）
    const screw = new Vector3().setFromMatrixPosition(matrixAt(screwMatrices, index));
    expect([screw.x, screw.y, screw.z]).toEqual([x, y, z]);
  });

  it('正面視から P.1 の射影点へ飛ばしたレイは instanceId で P.1 に解決する', () => {
    const { mesh, ids } = pickField();
    const hits = rayTo(
      cameraPose('front'),
      terminalPoint(toTerminalId('P.1'), CANVAS),
    ).intersectObject(mesh, false);
    expect(hits.length).toBeGreaterThan(0);
    expect(ids[hits[0]?.instanceId ?? -1]).toBe('P.1');
  });

  it('N.1 でも、ソケットの端子でも、指した端子だけが当たる', () => {
    const { mesh, ids } = pickField();
    for (const id of ['N.1', 'S1.9', 'TB_PB.1c']) {
      const hits = rayTo(
        cameraPose('front'),
        terminalPoint(toTerminalId(id), CANVAS),
      ).intersectObject(mesh, false);
      expect(ids[hits[0]?.instanceId ?? -1], id).toBe(id);
    }
  });
});
