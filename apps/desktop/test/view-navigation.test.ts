import { describe, expect, it } from 'vitest';
import {
  boardUp,
  cameraPose,
  MAX_CAMERA_DISTANCE_MM,
  MAX_POLAR_ANGLE,
  MIN_CAMERA_DISTANCE_MM,
} from '../src/renderer/three/camera.js';
import {
  cameraReadoutText,
  clamp,
  createPickDragGuard,
  GIZMO_DRAG_RAD_PER_PX,
  GIZMO_DRAG_THRESHOLD_PX,
  gizmoDragToSpherical,
  middleButtonActionFor,
  middleButtonAssignmentFor,
  mouseButtonAssignment,
  presetForDirection,
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
    expect(gizmoDragToSpherical(1000, 0).azimuth).toBeCloseTo(-2 * Math.PI, 10);
    expect(gizmoDragToSpherical(0, 1000).polar).toBeCloseTo(-2 * Math.PI, 10);
  });

  it('右へ引くと方位角が減り、下へ引くと極角が減る（OrbitControls の左ドラッグと同じ符号）', () => {
    const right = gizmoDragToSpherical(120, 0);
    expect(right.azimuth).toBeLessThan(0);
    expect(right.polar).toBe(-0);
    const down = gizmoDragToSpherical(0, 120);
    expect(down.polar).toBeLessThan(0);
  });

  it('移動量に比例し、感度を差し替えられる', () => {
    expect(gizmoDragToSpherical(200, -100, 0.01)).toEqual({ azimuth: -2, polar: 1 });
    expect(gizmoDragToSpherical(0, 0)).toEqual({ azimuth: -0, polar: -0 });
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

describe('presetForDirection（ビューキューブの面・辺・角 → 視点）', () => {
  it('6面はその方向のプリセットに素直に対応する', () => {
    expect(presetForDirection([1, 0, 0])).toBe('right');
    expect(presetForDirection([-1, 0, 0])).toBe('left');
    expect(presetForDirection([0, 1, 0])).toBe('top');
    expect(presetForDirection([0, -1, 0])).toBe('bottom');
    expect(presetForDirection([0, 0, 1])).toBe('front');
    expect(presetForDirection([0, 0, -1])).toBe('back');
  });

  it('左手前・上の角は俯瞰プリセット（実物写真と同じ向き）になる', () => {
    expect(presetForDirection([-1, 1, 1])).toBe('top');
  });

  it('辺は近いほうの視点に着く', () => {
    // 右と手前のあいだの辺は、俯瞰でも下でもなく右か正面のどちらか
    expect(['right', 'front']).toContain(presetForDirection([1, 0, 1]));
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
