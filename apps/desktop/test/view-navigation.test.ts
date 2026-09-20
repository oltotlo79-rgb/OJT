import { describe, expect, it } from 'vitest';
import {
  boardUp,
  cameraPose,
  MAX_CAMERA_DISTANCE_MM,
  MAX_POLAR_ANGLE,
  MIN_CAMERA_DISTANCE_MM,
  MIN_POLAR_ANGLE_RAD,
  poseForDirection,
} from '../src/renderer/three/camera.js';
import {
  cameraReadoutText,
  clamp,
  createPickDragGuard,
  GIZMO_DRAG_RAD_PER_PX,
  GIZMO_DRAG_THRESHOLD_PX,
  GIZMO_HIT_BOXES,
  GIZMO_HIT_RATIO,
  GIZMO_TARGETS,
  gizmoDragToSpherical,
  gizmoTargetById,
  gizmoTargetForDirection,
  middleButtonActionFor,
  middleButtonAssignmentFor,
  mouseButtonAssignment,
} from '../src/renderer/three/navigation.js';
import { viewKeyAction } from '../src/renderer/session/viewport-keys.js';

/**
 * Blender 風の3Dナビゲーション（設計仕様 §12.2 / 2026-09-14 の利用者要望）の純粋な計算。
 * 「キューブをドラッグして画面を回す」「中ドラッグで回転・Shiftで平行移動・Ctrlでズーム」
 * 「テンキー 1/3/7 で正面・右・上」を、3Dを起動せずに固定する。
 */

describe('middleButtonActionFor（中ボタンの割り当て）', () => {
  it('修飾キーなしは回転（Blender の中ドラッグ）', () => {
    expect(middleButtonActionFor({ shift: false, ctrl: false })).toBe('rotate');
  });

  it('Shift で平行移動、Ctrl でズーム', () => {
    expect(middleButtonActionFor({ shift: true, ctrl: false })).toBe('pan');
    expect(middleButtonActionFor({ shift: false, ctrl: true })).toBe('dolly');
  });

  it('両方押されていたら平行移動（距離が飛ぶより立て直しやすい）', () => {
    expect(middleButtonActionFor({ shift: true, ctrl: true })).toBe('pan');
  });

  it('three が修飾キーで回転と平行移動を入れ替えるぶんを打ち消して入れる', () => {
    // 修飾キーなしはそのまま
    expect(mouseButtonAssignment('rotate', false)).toBe('rotate');
    expect(mouseButtonAssignment('pan', false)).toBe('pan');
    // 修飾キーありは入れ替わるので逆を入れる（ズームは入れ替えの対象外）
    expect(mouseButtonAssignment('rotate', true)).toBe('pan');
    expect(mouseButtonAssignment('pan', true)).toBe('rotate');
    expect(mouseButtonAssignment('dolly', true)).toBe('dolly');
  });

  it('中ボタンに入れる値は 素＝回転 / Shift＝回転（＝平行移動になる）/ Ctrl＝ズーム', () => {
    expect(middleButtonAssignmentFor({ shift: false, ctrl: false })).toBe('rotate');
    expect(middleButtonAssignmentFor({ shift: true, ctrl: false })).toBe('rotate');
    expect(middleButtonAssignmentFor({ shift: false, ctrl: true })).toBe('dolly');
    expect(middleButtonAssignmentFor({ shift: true, ctrl: true })).toBe('rotate');
  });
});

describe('gizmoDragToSpherical（キューブのドラッグ量 → 回転角）', () => {
  it('1000px 引くとちょうど1回転（Blender と同じ感度）', () => {
    expect(GIZMO_DRAG_RAD_PER_PX * 1000).toBeCloseTo(2 * Math.PI, 10);
    expect(gizmoDragToSpherical(1000, 0).azimuth).toBeCloseTo(2 * Math.PI, 10);
    expect(gizmoDragToSpherical(0, 1000).polar).toBeCloseTo(2 * Math.PI, 10);
  });

  /*
   * 2026-09-20 の所有者決定（Task 19 / 3D-15〜19）。上下・左右とも「カメラが指に付いてくる」に
   * 揃えた。以前は両軸とも逆で、俯瞰から下へ引くと極角が減って真上（極）へ張り付き、
   * そこから先はどちらへ引いても画が変わらなかった（利用者の「回らない」）。
   */
  it('右へ引くと方位角が増え、下へ引くと極角が増える（カメラが指に付いてくる）', () => {
    const right = gizmoDragToSpherical(120, 0);
    expect(right.azimuth).toBeGreaterThan(0);
    expect(right.polar).toBe(0);
    const down = gizmoDragToSpherical(0, 120);
    expect(down.polar).toBeGreaterThan(0);
    const up = gizmoDragToSpherical(0, -120);
    expect(up.polar).toBeLessThan(0);
    const left = gizmoDragToSpherical(-120, 0);
    expect(left.azimuth).toBeLessThan(0);
  });

  it('移動量に比例し、感度を差し替えられる', () => {
    expect(gizmoDragToSpherical(200, -100, 0.01)).toEqual({ azimuth: 2, polar: -1 });
    expect(gizmoDragToSpherical(0, 0)).toEqual({ azimuth: 0, polar: 0 });
  });
});

describe('viewKeyAction（キー → 視点）', () => {
  it('テンキー 1/3/7 が 正面・右・俯瞰', () => {
    expect(viewKeyAction({ code: 'Numpad1', key: '1' })).toBe('front');
    expect(viewKeyAction({ code: 'Numpad3', key: '3' })).toBe('right');
    expect(viewKeyAction({ code: 'Numpad7', key: '7' })).toBe('top');
  });

  it('Ctrl を足すと反対側（後・左・下）', () => {
    expect(viewKeyAction({ code: 'Numpad1', key: '1', ctrlKey: true })).toBe('back');
    expect(viewKeyAction({ code: 'Numpad3', key: '3', ctrlKey: true })).toBe('left');
    expect(viewKeyAction({ code: 'Numpad7', key: '7', ctrlKey: true })).toBe('bottom');
  });

  it('NumLock が切れていてもテンキーは効く（`code` で見る）', () => {
    expect(viewKeyAction({ code: 'Numpad1', key: 'End' })).toBe('front');
    expect(viewKeyAction({ code: 'Numpad7', key: 'Home' })).toBe('top');
  });

  it('上段の 1/2/3 は従来どおり 正面・俯瞰・ソケット拡大', () => {
    expect(viewKeyAction({ code: 'Digit1', key: '1' })).toBe('front');
    expect(viewKeyAction({ code: 'Digit2', key: '2' })).toBe('top');
    expect(viewKeyAction({ code: 'Digit3', key: '3' })).toBe('socket');
    // `code` が無いイベント（テストの `fireEvent.keyDown({ key: '3' })` など）でも効く
    expect(viewKeyAction({ key: '3' })).toBe('socket');
  });

  it('Home は盤全体（正面）', () => {
    expect(viewKeyAction({ code: 'Home', key: 'Home' })).toBe('front');
  });

  it('Ctrl 付きの上段数字・Alt 付き・関係ないキーは何も起こさない', () => {
    expect(viewKeyAction({ code: 'Digit1', key: '1', ctrlKey: true })).toBeUndefined();
    expect(viewKeyAction({ code: 'Numpad1', key: '1', altKey: true })).toBeUndefined();
    expect(viewKeyAction({ code: 'Numpad5', key: '5' })).toBeUndefined();
    expect(viewKeyAction({ code: 'KeyA', key: 'a' })).toBeUndefined();
    expect(viewKeyAction({})).toBeUndefined();
  });
});

/*
 * 死んだ関数 `presetForDirection()` を削除し（3D-18）、その5ケースを後継の
 * `gizmoTargetForDirection()` へ向け直したもの。面は**プリセットに素直に対応**し、
 * 辺・角は**面へ丸めず**その辺・角そのものに着く（これが置き換えの目的だった）。
 */
describe('gizmoTargetForDirection（ビューキューブの面・辺・角 → 視点）', () => {
  it('6面はその方向のプリセットに素直に対応する', () => {
    expect(gizmoTargetForDirection([1, 0, 0]).preset).toBe('right');
    expect(gizmoTargetForDirection([-1, 0, 0]).preset).toBe('left');
    expect(gizmoTargetForDirection([0, 1, 0]).preset).toBe('top');
    expect(gizmoTargetForDirection([0, -1, 0]).preset).toBe('bottom');
    expect(gizmoTargetForDirection([0, 0, 1]).preset).toBe('front');
    expect(gizmoTargetForDirection([0, 0, -1]).preset).toBe('back');
  });

  it('左手前・上の角は面へ丸めず、その角そのものに着く', () => {
    const corner = gizmoTargetForDirection([-1, 1, 1]);
    expect(corner.id).toBe('front-top-left');
    expect(corner.kind).toBe('corner');
    // 削除した旧実装はここを俯瞰（top）へ丸めていて、斜め45°には着けなかった
    expect(corner.preset).toBeUndefined();
  });

  it('辺は近いほうの面ではなく、その辺に着く', () => {
    // 右と手前のあいだの辺は right でも front でもなく front-right
    const edge = gizmoTargetForDirection([1, 0, 1]);
    expect(edge.id).toBe('front-right');
    expect(edge.kind).toBe('edge');
    expect(edge.preset).toBeUndefined();
  });
});

describe('cameraPose（Blender 風に増えた視点）', () => {
  const distance = (preset: Parameters<typeof cameraPose>[0]): number => {
    const pose = cameraPose(preset);
    return Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
  };

  it('後ろ視点は正面の真裏（注視点をはさんで反対側・同じ距離）', () => {
    const front = cameraPose('front');
    const back = cameraPose('back');
    expect(back.position[0]).toBeCloseTo(-front.position[0], 10);
    expect(back.position[1]).toBeCloseTo(-front.position[1], 10);
    expect(back.position[2]).toBeCloseTo(-front.position[2], 10);
    expect(back.up).toEqual(boardUp());
  });

  it('左右の視点は盤の真横で、互いに鏡（上方向は盤の上）', () => {
    const right = cameraPose('right');
    const left = cameraPose('left');
    expect(right.position[0]).toBeGreaterThan(0);
    expect(left.position[0]).toBeCloseTo(-right.position[0], 10);
    expect(right.position[1]).toBeCloseTo(0, 10);
    expect(right.position[2]).toBeCloseTo(0, 10);
    expect(right.up).toEqual(boardUp());
  });

  it('下からの視点は極角の上限ちょうど（OrbitControls に引き戻されない）', () => {
    const bottom = cameraPose('bottom');
    const radius = Math.hypot(bottom.position[0], bottom.position[1], bottom.position[2]);
    // 極角は上方向 (0,1,0) からの角。上限を超えると `update()` で丸められてしまう
    expect(Math.acos(bottom.position[1] / radius)).toBeCloseTo(MAX_POLAR_ANGLE, 10);
    expect(bottom.up).toEqual([0, 1, 0]);
  });

  it('どの視点も距離制限の内側にある（寄りすぎ・離れすぎで丸められない）', () => {
    for (const preset of ['front', 'back', 'left', 'right', 'top', 'bottom', 'socket'] as const) {
      expect(distance(preset)).toBeGreaterThanOrEqual(MIN_CAMERA_DISTANCE_MM);
      expect(distance(preset)).toBeLessThanOrEqual(MAX_CAMERA_DISTANCE_MM);
    }
  });
});

describe('ビューキューブの26箇所（面6・辺12・角8）。2026-09-19 の利用者要望', () => {
  it('面6・辺12・角8 のちょうど26箇所があり、名前は重ならない', () => {
    expect(GIZMO_TARGETS).toHaveLength(26);
    expect(GIZMO_TARGETS.filter((target) => target.kind === 'face')).toHaveLength(6);
    expect(GIZMO_TARGETS.filter((target) => target.kind === 'edge')).toHaveLength(12);
    expect(GIZMO_TARGETS.filter((target) => target.kind === 'corner')).toHaveLength(8);
    expect(new Set(GIZMO_TARGETS.map((target) => target.id)).size).toBe(26);
  });

  it('面だけが視点プリセットを持ち、6面が front/back/left/right/top/bottom に対応する', () => {
    const presets = GIZMO_TARGETS.filter((target) => target.preset !== undefined);
    expect(presets.map((target) => target.preset).sort()).toEqual([
      'back',
      'bottom',
      'front',
      'left',
      'right',
      'top',
    ]);
    for (const target of presets) expect(target.kind).toBe('face');
    // 名札は日本語（§15）
    expect(gizmoTargetById('front')?.label).toBe('正面');
    expect(gizmoTargetById('back')?.label).toBe('背面');
    expect(gizmoTargetById('top')?.label).toBe('上');
  });

  it('指した向きからいちばん近い箇所を引ける（面の法線・辺・角）', () => {
    expect(gizmoTargetForDirection([0, 0, 1]).id).toBe('front');
    expect(gizmoTargetForDirection([0, 0, 1]).preset).toBe('front');
    expect(gizmoTargetForDirection([-1, 0, 0]).id).toBe('left');
    // 辺と角は45°の向きそのもの（以前のように6面へ丸めない）
    expect(gizmoTargetForDirection([0, 1, 1]).id).toBe('front-top');
    expect(gizmoTargetForDirection([1, 1, 1]).id).toBe('front-top-right');
    expect(gizmoTargetForDirection([-1, -1, -1]).id).toBe('back-bottom-left');
    expect(gizmoTargetForDirection([1, 1, 1]).preset).toBeUndefined();
  });

  it('辺・角の当たり判定の箱は面の外周にあり、面の中央は空いている', () => {
    expect(GIZMO_HIT_BOXES).toHaveLength(20);
    const offset = 0.5 - GIZMO_HIT_RATIO / 2;
    for (const box of GIZMO_HIT_BOXES) {
      const target = gizmoTargetById(box.id);
      expect(target).toBeDefined();
      for (const axis of [0, 1, 2] as const) {
        const component = target?.direction[axis] ?? 0;
        // 向きのある軸はキューブの表面ぎわ、無い軸は中央（面の中央は空く）
        expect(box.position[axis]).toBeCloseTo(component * offset, 10);
        expect(box.size[axis]).toBeCloseTo(
          component === 0 ? 1 - 2 * GIZMO_HIT_RATIO : GIZMO_HIT_RATIO,
          10,
        );
      }
    }
    // 96px のキューブなら角は 26px 角以上（以前の drei 既定は 60px キューブの 15px 角）
    expect(GIZMO_HIT_RATIO * 96).toBeGreaterThanOrEqual(26);
  });
});

describe('poseForDirection（辺・角の45°視点。2026-09-19 の利用者要望）', () => {
  const at = (direction: readonly [number, number, number]): [number, number, number] =>
    poseForDirection(direction, { distance: 380, target: [0, 0, 0] }).position;

  it('26箇所すべてが、注視点から見てその向きの視点になる（距離は変えない）', () => {
    for (const target of GIZMO_TARGETS) {
      const position = at(target.direction);
      expect(Math.hypot(position[0], position[1], position[2])).toBeCloseTo(380, 6);
      const horizontal = target.direction[0] !== 0 || target.direction[2] !== 0;
      if (horizontal) {
        // 水平成分の向きは必ず一致する（上下は極角の上限・下限で丸めることがある）
        expect(Math.sign(Math.round(position[0] * 1e6))).toBe(Math.sign(target.direction[0]));
        expect(Math.sign(Math.round(position[2] * 1e6))).toBe(Math.sign(target.direction[2]));
      }
      // 上向きの箇所は必ず注視点より上から見る
      if (target.direction[1] > 0) expect(position[1]).toBeGreaterThan(0);
    }
  });

  it('真上の面は注視点のほぼ真上（極の直前まで）に着く', () => {
    const top = at([0, 1, 0]);
    expect(top[1]).toBeGreaterThan(379);
    expect(Math.hypot(top[0], top[2])).toBeLessThan(10);
  });

  it('角の視点は3軸とも45°の側にある', () => {
    const corner = at([1, 1, 1]);
    expect(corner[0]).toBeGreaterThan(0);
    expect(corner[1]).toBeGreaterThan(0);
    expect(corner[2]).toBeGreaterThan(0);
    expect(corner[0]).toBeCloseTo(corner[2], 6);
  });

  it('下向きは極角の上限で丸める（OrbitControls に引き戻されない）', () => {
    for (const direction of [
      [0, -1, 0],
      [0, -1, 1],
      [-1, -1, -1],
    ] as const) {
      const position = at(direction);
      const polar = Math.acos(position[1] / Math.hypot(...position));
      expect(polar).toBeLessThanOrEqual(MAX_POLAR_ANGLE + 1e-9);
      expect(polar).toBeGreaterThanOrEqual(MIN_POLAR_ANGLE_RAD - 1e-9);
    }
  });

  it('注視点をずらしても向きは変わらず、注視点はそのまま保たれる', () => {
    const pose = poseForDirection([0, 1, 1], { distance: 200, target: [10, -20, 30] });
    expect(pose.target).toEqual([10, -20, 30]);
    expect(
      Math.hypot(pose.position[0] - 10, pose.position[1] + 20, pose.position[2] - 30),
    ).toBeCloseTo(200, 6);
    expect(pose.position[1]).toBeGreaterThan(-20);
    expect(pose.position[2]).toBeGreaterThan(30);
    expect(pose.up).toEqual([0, 1, 0]);
  });
});

describe('cameraReadoutText（E2E へ出すカメラの状態）', () => {
  it('角度と距離と注視点を JSON で書き出す', () => {
    const text = cameraReadoutText({
      azimuth: 0.123456,
      polar: 1.234567,
      distance: 346.789,
      target: [1.234, -2.345, 0],
    });
    expect(JSON.parse(text)).toEqual({
      az: 0.1235,
      polar: 1.2346,
      dist: 346.79,
      tx: 1.23,
      ty: -2.35,
      tz: 0,
    });
  });
});

describe('createPickDragGuard（回したあとのクリックで盤を拾わない）', () => {
  it('しきい値未満の動きはクリックのまま', () => {
    const guard = createPickDragGuard();
    guard.down(100, 100);
    guard.move(101, 102);
    expect(guard.dragged()).toBe(false);
  });

  it('しきい値以上動いたらドラッグ扱いで、次に押すまで続く', () => {
    const guard = createPickDragGuard();
    guard.down(100, 100);
    guard.move(100 + GIZMO_DRAG_THRESHOLD_PX, 100);
    expect(guard.dragged()).toBe(true);
    // 戻ってきてもドラッグだったことは変わらない
    guard.move(100, 100);
    expect(guard.dragged()).toBe(true);
    guard.down(100, 100);
    expect(guard.dragged()).toBe(false);
  });
});

describe('clamp', () => {
  it('範囲に収める', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(1, 0, 3)).toBe(1);
  });
});
