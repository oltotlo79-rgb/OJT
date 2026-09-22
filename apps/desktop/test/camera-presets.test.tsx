import { PLC_UNIT_FX5U, PLC_UNIT_JW300 } from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { Vector3 } from 'three';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 視点プリセットの適用テスト（§12.2）。
 *
 * `CameraPresets` は `useThree` / `useFrame` しか three に触らないので、`@react-three/fiber` を
 * その2つだけ差し替えれば WebGL 無しで検証できる。見たいのは
 * 「**同じプリセットを押し直しても**視点が組み直されるか」という1点で、これは
 * `cameraNonce`（ストア）→ `nonce`（props）→ `useEffect` の依存、という鎖が繋がっているかの問題。
 */

interface FakeCamera {
  up: Vector3;
  position: {
    x: number;
    y: number;
    z: number;
    set: (x: number, y: number, z: number) => void;
    value: [number, number, number];
  };
  lookAt: (x: number, y: number, z: number) => void;
  updateProjectionMatrix: () => void;
}

const harness: {
  camera: unknown;
  invalidate: () => void;
  /** `Canvas`（3Dペイン）の CSS px。`CameraPresets` はここから縦横比を作って `cameraPose()` に
   * 渡す（2026-09-20 の監査指摘 I14）。既定は16:10相当（旧・固定の仮定と同じ形）。 */
  size: { width: number; height: number };
  /** 最後に `useFrame` へ渡されたコールバック（描画のたびに差し替わるので1つだけ持つ）。 */
  frame: (() => void) | null;
} = vi.hoisted(() => ({
  camera: undefined,
  invalidate: (): void => undefined,
  size: { width: 1280, height: 800 },
  frame: null,
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (
    selector: (state: {
      camera: unknown;
      invalidate: () => void;
      size: { width: number; height: number };
    }) => unknown,
  ) => selector({ camera: harness.camera, invalidate: harness.invalidate, size: harness.size }),
  useFrame: (callback: () => void) => {
    harness.frame = callback;
  },
}));

const { CameraPresets } = await import('../src/renderer/three/CameraPresets.js');
const { cameraPose } = await import('../src/renderer/three/camera.js');
const { useStore } = await import('../src/renderer/app/store.js');

/** `CameraPresets` が渡すのと同じ縦横比を添えて `cameraPose()` を呼ぶ（期待値の作成用）。 */
function expectedPose(
  preset: Parameters<typeof cameraPose>[0],
  extra: Parameters<typeof cameraPose>[1] = {},
): ReturnType<typeof cameraPose> {
  return cameraPose(preset, { ...extra, aspect: harness.size.width / harness.size.height });
}

let positions: Array<[number, number, number]>;
let targets: Array<[number, number, number]>;
let controlsTargets: Array<[number, number, number]>;

function makeCamera(): FakeCamera {
  const value: [number, number, number] = [0, 0, 0];
  return {
    up: new Vector3(0, 1, 0),
    position: {
      value,
      get x() {
        return value[0];
      },
      get y() {
        return value[1];
      },
      get z() {
        return value[2];
      },
      set: (x, y, z) => {
        value[0] = x;
        value[1] = y;
        value[2] = z;
        positions.push([x, y, z]);
      },
    },
    lookAt: (x, y, z) => {
      targets.push([x, y, z]);
    },
    updateProjectionMatrix: () => undefined,
  };
}

const controls = {
  enabled: true,
  target: {
    x: 0,
    y: 0,
    z: 0,
    set: (x: number, y: number, z: number) => {
      Object.assign(controls.target, { x, y, z });
      controlsTargets.push([x, y, z]);
    },
  },
  update: () => undefined,
};

/** 補間の時計（`performance.now()` を差し替えて自由に進める）。 */
let nowMs = 0;

/** `useFrame` に登録されたコールバックを1回回す（`stepMs` だけ時計を進めてから）。 */
function runFrame(stepMs = 0): void {
  nowMs += stepMs;
  harness.frame?.();
}

beforeEach(() => {
  controls.enabled = true;
  positions = [];
  targets = [];
  controlsTargets = [];
  harness.frame = null;
  harness.camera = makeCamera();
  harness.size = { width: 1280, height: 800 };
  nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  useStore.setState({ camera: 'front', cameraNonce: 0 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CameraPresets', () => {
  it('自由回転後のプリセットは実際の位置から始まり、昔の位置へ跳ばない', () => {
    const view = render(<CameraPresets preset="front" nonce={0} controls={controls} />);
    const camera = harness.camera as FakeCamera;
    camera.position.set(60, -300, 40);
    camera.up.set(0, 0, 1);
    controls.target.set(5, 6, 7);
    view.rerender(<CameraPresets preset="front" nonce={1} controls={controls} />);
    runFrame(0);
    expect(positions.at(-1)).toEqual([60, -300, 40]);
    expect(controlsTargets.at(-1)).toEqual([5, 6, 7]);
    runFrame(400);
    expect(positions.at(-1)).toEqual(expectedPose('front').position);
  });

  it('補間中にキューブをつかむと、放した後も古い補間を再開しない', () => {
    const view = render(<CameraPresets preset="front" nonce={0} controls={controls} />);
    view.rerender(<CameraPresets preset="top" nonce={1} controls={controls} />);
    runFrame(50);
    controls.enabled = false;
    const count = positions.length;
    runFrame(50);
    controls.enabled = true;
    runFrame(400);
    expect(positions).toHaveLength(count);
  });

  it('マウント直後はプリセットの視点を補間せずそのまま当てる', () => {
    render(<CameraPresets preset="front" nonce={0} controls={controls} />);
    const pose = expectedPose('front');
    expect(positions.at(-1)).toEqual(pose.position);
    expect(controlsTargets.at(-1)).toEqual(pose.target);
  });

  it('プリセットを変えると新しい視点へ補間して最後は目標に一致する', () => {
    const view = render(<CameraPresets preset="front" nonce={0} controls={controls} />);
    positions = [];
    view.rerender(<CameraPresets preset="top" nonce={1} controls={controls} />);
    // 途中のフレームはまだ目標に届いていない
    runFrame(100);
    expect(positions).toHaveLength(1);
    expect(positions.at(-1)).not.toEqual(expectedPose('top').position);
    // 遷移時間（300ms）を過ぎたら目標そのもの
    runFrame(400);
    expect(positions.at(-1)).toEqual(expectedPose('top').position);
    // 到達したら補間は自己終結する（以後フレームを回しても動かない）
    const settled = positions.length;
    runFrame(100);
    expect(positions).toHaveLength(settled);
  });

  it('同じプリセットのまま `nonce` だけ増やしても視点を組み直す（正面を押し直したら正面に戻る）', () => {
    const view = render(<CameraPresets preset="socket" nonce={0} controls={controls} />);
    positions = [];
    controlsTargets = [];

    // 同じ `preset` / 同じ `nonce` のまま再描画しても何も起こらない
    view.rerender(<CameraPresets preset="socket" nonce={0} controls={controls} />);
    runFrame(16);
    expect(positions).toHaveLength(0);

    // `nonce` が増えたら（＝同じボタンを押し直したら）補間が始まり、そのプリセットに戻る
    view.rerender(<CameraPresets preset="socket" nonce={1} controls={controls} />);
    runFrame(400);
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.at(-1)).toEqual(expectedPose('socket').position);
    expect(controlsTargets.at(-1)).toEqual(expectedPose('socket').target);
  });

  /**
   * 2026-09-20 の監査指摘 I14「3Dペインが1〜2割しか占めず残りは真っ黒」。
   * `size`（3Dペインの実測 px）が変わったら、同じプリセット・同じ `nonce` のままでも
   * 視点を組み直して、そのペインいっぱいに盤を収め直す。
   */
  it('3Dペインの縦横比が変わったら、同じプリセットのままでも視点を組み直す', () => {
    const view = render(<CameraPresets preset="front" nonce={0} controls={controls} />);
    positions = [];
    controlsTargets = [];

    // ウィンドウのリサイズなどでペインの形が変わる
    harness.size = { width: 900, height: 220 };
    view.rerender(<CameraPresets preset="front" nonce={0} controls={controls} />);
    runFrame(400);

    expect(positions.length).toBeGreaterThan(0);
    const pose = expectedPose('front');
    expect(positions.at(-1)).toEqual(pose.position);
    expect(controlsTargets.at(-1)).toEqual(pose.target);
  });

  /**
   * `plc` プリセット（モードD）の画角は、これまで `PLC_VIEW_ASPECT`（0.75。安全側の
   * 保守的な仮定）で固定していた。実際のペインはこれよりずっと横長なことが多く
   * （机上のPLC＋壁コンセントの外接矩形自体が横長。§`plcViewRect()`）、仮定のまま距離を
   * 決めると必要以上に遠ざかって「切手大」になっていた（2026-09-20 の監査指摘 I14）。
   * 実測の縦横比を渡すと、その分だけ寄って盤が大きく映ることを確かめる。
   */
  it('plc プリセットは実測の縦横比が渡ると、仮定の0.75より寄って大きく映る', () => {
    render(<CameraPresets preset="plc" nonce={0} controls={controls} />);
    const assumedDistance = Math.hypot(...cameraPose('plc', { aspect: 0.75 }).position);
    const actualDistance = Math.hypot(...positions.at(-1)!);
    expect(actualDistance).toBeLessThan(assumedDistance);
  });
});

describe('store.setCamera（§12.2）', () => {
  it('プリセットが変わらなくても番号は必ず増える', () => {
    expect(useStore.getState().camera).toBe('front');
    useStore.getState().setCamera('front');
    expect(useStore.getState().cameraNonce).toBe(1);
    useStore.getState().setCamera('front');
    expect(useStore.getState().cameraNonce).toBe(2);
    expect(useStore.getState().camera).toBe('front');
  });

  it('プリセットを変えたときも番号は増える', () => {
    useStore.getState().setCamera('socket');
    expect(useStore.getState().camera).toBe('socket');
    expect(useStore.getState().cameraNonce).toBe(1);
  });
});

/**
 * `plc` プリセットと机上の機種（Plan 4B Task 12 の積み残し）。
 *
 * `camera.ts` の `cameraPose('plc', { plcUnit })` は既に機種ごとの画角を計算できていたが
 * （`plc-camera.test.ts`）、呼び出し側の `CameraPresets` が常に既定（FX5U）を渡していたため
 * 実機では反映されていなかった。ここでは `CameraPresets` がストアの `problem` から機種を
 * 引いて `cameraPose()` へ渡していることを、コンポーネント越しに確かめる。
 */
describe('CameraPresets と机上の機種（決定表#18）', () => {
  afterEach(() => {
    useStore.setState({ problem: undefined });
  });

  it('JW300 の課題を開いていると `plc` プリセットの視点が FX5U と変わる', () => {
    const fx5uProblem = BUILTIN_PLC_PROBLEMS[0]!;
    expect(fx5uProblem.plc.model).toBe('FX5U');

    useStore.setState({ problem: fx5uProblem, camera: 'plc', cameraNonce: 0 });
    render(<CameraPresets preset="plc" nonce={0} controls={controls} />);
    const fx5uPose = expectedPose('plc', { plcUnit: PLC_UNIT_FX5U });
    expect(positions.at(-1)).toEqual(fx5uPose.position);
    expect(targets.at(-1)).toEqual(fx5uPose.target);

    cleanup();
    positions = [];
    targets = [];
    controlsTargets = [];

    const jw300Problem = {
      ...fx5uProblem,
      plc: { vendor: 'sharp' as const, model: 'JW-300' as const },
    };
    useStore.setState({ problem: jw300Problem, camera: 'plc', cameraNonce: 0 });
    render(<CameraPresets preset="plc" nonce={0} controls={controls} />);
    const jw300Pose = expectedPose('plc', { plcUnit: PLC_UNIT_JW300 });
    expect(positions.at(-1)).toEqual(jw300Pose.position);
    expect(targets.at(-1)).toEqual(jw300Pose.target);

    // 機種で画角そのものが変わっている（FX5U と同じ視点のままではない）ことを確かめる
    expect(jw300Pose.target).not.toEqual(fx5uPose.target);
    const distanceOf = (pose: typeof fx5uPose): number =>
      Math.hypot(
        pose.position[0] - pose.target[0],
        pose.position[1] - pose.target[1],
        pose.position[2] - pose.target[2],
      );
    expect(distanceOf(jw300Pose)).not.toBeCloseTo(distanceOf(fx5uPose), 3);
  });
});
