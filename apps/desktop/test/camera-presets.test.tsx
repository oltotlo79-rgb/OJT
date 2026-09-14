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
  up: { set: (x: number, y: number, z: number) => void };
  position: { set: (x: number, y: number, z: number) => void; value: [number, number, number] };
  lookAt: (x: number, y: number, z: number) => void;
  updateProjectionMatrix: () => void;
}

const harness: {
  camera: unknown;
  invalidate: () => void;
  /** 最後に `useFrame` へ渡されたコールバック（描画のたびに差し替わるので1つだけ持つ）。 */
  frame: (() => void) | null;
} = vi.hoisted(() => ({
  camera: undefined,
  invalidate: (): void => undefined,
  frame: null,
}));

vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: { camera: unknown; invalidate: () => void }) => unknown) =>
    selector({ camera: harness.camera, invalidate: harness.invalidate }),
  useFrame: (callback: () => void) => {
    harness.frame = callback;
  },
}));

const { CameraPresets } = await import('../src/renderer/three/CameraPresets.js');
const { cameraPose } = await import('../src/renderer/three/camera.js');
const { useStore } = await import('../src/renderer/app/store.js');

let positions: Array<[number, number, number]>;
let targets: Array<[number, number, number]>;
let controlsTargets: Array<[number, number, number]>;

function makeCamera(): FakeCamera {
  const value: [number, number, number] = [0, 0, 0];
  return {
    up: { set: () => undefined },
    position: {
      value,
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
  target: {
    set: (x: number, y: number, z: number) => {
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
  positions = [];
  targets = [];
  controlsTargets = [];
  harness.frame = null;
  harness.camera = makeCamera();
  nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  useStore.setState({ camera: 'front', cameraNonce: 0 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CameraPresets', () => {
  it('マウント直後はプリセットの視点を補間せずそのまま当てる', () => {
    render(<CameraPresets preset="front" nonce={0} controls={controls} />);
    const pose = cameraPose('front');
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
    expect(positions.at(-1)).not.toEqual(cameraPose('top').position);
    // 遷移時間（300ms）を過ぎたら目標そのもの
    runFrame(400);
    expect(positions.at(-1)).toEqual(cameraPose('top').position);
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
    expect(positions.at(-1)).toEqual(cameraPose('socket').position);
    expect(controlsTargets.at(-1)).toEqual(cameraPose('socket').target);
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
