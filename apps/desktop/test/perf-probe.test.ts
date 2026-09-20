import { describe, expect, it } from 'vitest';
import {
  configurePerfCounters,
  formatPerf,
  parsePerf,
  PERF_INTERVAL_MS,
  perfSample,
  takeRenderCounters,
  type PerfInfo,
  type PerfReadout,
} from '../src/renderer/three/PerfProbe.js';

describe('perfSample', () => {
  it('turns counters into a readout with fps', () => {
    const sample = perfSample(
      { frames: 30, triangles: 120_000, calls: 84, geometries: 210, textures: 6 },
      500,
    );
    expect(sample).toEqual({
      frames: 30,
      fps: 60,
      triangles: 120_000,
      calls: 84,
      geometries: 210,
      textures: 6,
    });
  });

  it('reports 0 fps when no time has passed (never divides by zero)', () => {
    expect(
      perfSample({ frames: 0, triangles: 0, calls: 0, geometries: 0, textures: 0 }, 0).fps,
    ).toBe(0);
  });

  it('rounds fps to one decimal so the readout is stable to read', () => {
    expect(
      perfSample({ frames: 7, triangles: 0, calls: 0, geometries: 0, textures: 0 }, 250).fps,
    ).toBe(28);
  });

  /*
   * M7（Plan 5 C/D レビュー）: `frames` は呼び出しごとに渡された値をそのまま映す
   * （関数自身は前回を覚えていない）。`PerfProbe` はここへ**窓ぶんの枚数**
   * （`windowFrames`）を渡し、書き出すたびに0へ戻すので、`frames` は累計にならない
   * （累計は別に `data-total-frames` で持つ。`PerfReadout.frames` の doc comment 参照）。
   */
  it('does not accumulate across calls (frames is a window count, not a running total)', () => {
    const first = perfSample(
      { frames: 30, triangles: 0, calls: 0, geometries: 0, textures: 0 },
      500,
    );
    const second = perfSample(
      { frames: 5, triangles: 0, calls: 0, geometries: 0, textures: 0 },
      500,
    );
    expect(first.frames).toBe(30);
    // 2回目は1回目を引き継がない（累計なら 35 になってしまう）
    expect(second.frames).toBe(5);
  });
});

describe('formatPerf / parsePerf', () => {
  it('round-trips through the hidden element text', () => {
    const readout: PerfReadout = {
      frames: 12,
      fps: 48,
      triangles: 1000,
      calls: 10,
      geometries: 5,
      textures: 2,
    };
    expect(parsePerf(formatPerf(readout))).toEqual(readout);
  });

  it('returns undefined for text that is not a readout', () => {
    expect(parsePerf('')).toBeUndefined();
    expect(parsePerf('not json')).toBeUndefined();
    expect(parsePerf('{"frames":1}')).toBeUndefined();
  });
});

describe('PERF_INTERVAL_MS', () => {
  it('is short enough for an E2E to sample and long enough not to cost a frame', () => {
    expect(PERF_INTERVAL_MS).toBeGreaterThanOrEqual(100);
    expect(PERF_INTERVAL_MS).toBeLessThanOrEqual(500);
  });
});

/**
 * 3D-01（2026-09-20 レビュー・Critical）: 性能の門がビューキューブだけを測っていた件。
 *
 * ビューキューブは drei の `Hud` で描いており、`Hud` は1フレームに `gl.render()` を2回呼ぶ。
 * three の `WebGLRenderer.render()` は `autoReset === true` のとき毎回冒頭で `info.reset()` を
 * 呼ぶので、フレームの終わりに残るのは**2回目（ギズモ単体）の値**だけになる。ここでは
 * 「自動リセットを止めること」と「読んだら自分で戻すこと」の2点を固定する。
 */
describe('configurePerfCounters / takeRenderCounters（3D-01）', () => {
  function fakeInfo(): PerfInfo {
    const info: PerfInfo = {
      autoReset: true,
      render: { triangles: 0, calls: 0 },
      reset: () => {
        info.render.triangles = 0;
        info.render.calls = 0;
      },
    };
    return info;
  }

  it('turns off the renderer auto-reset so both render() passes add up', () => {
    const gl = { info: fakeInfo() };
    expect(gl.info.autoReset).toBe(true);
    configurePerfCounters(gl);
    expect(gl.info.autoReset).toBe(false);
  });

  it('reads the frame that was just drawn and clears the counters itself', () => {
    const info = fakeInfo();
    // 盤（1回目の render）＋ ビューキューブ（2回目の render）が足し合わさった状態
    info.render.triangles = 120_280;
    info.render.calls = 114;
    expect(takeRenderCounters(info)).toEqual({ triangles: 120_280, calls: 114 });
    // 自動リセットを止めているので、ここで戻さないと次のフレームに積み上がる
    expect(info.render).toEqual({ triangles: 0, calls: 0 });
  });

  it('does not accumulate across frames (the board is not counted twice)', () => {
    const info = fakeInfo();
    info.render.triangles = 1000;
    info.render.calls = 10;
    takeRenderCounters(info);
    info.render.triangles = 900;
    info.render.calls = 9;
    expect(takeRenderCounters(info)).toEqual({ triangles: 900, calls: 9 });
  });

  /*
   * 自動リセットを止めたまま誰も戻さないと、フレームを重ねるほど数字が増え続け、
   * 予算の門が「時間が経つほど落ちる」という別の偽物になる。その退行をここで捕まえる。
   */
  it('keeps the readout flat while the scene does not change', () => {
    const info = fakeInfo();
    const perFrame = { triangles: 4_200, calls: 61 };
    const seen: number[] = [];
    for (let frame = 0; frame < 5; frame += 1) {
      info.render.triangles += perFrame.triangles;
      info.render.calls += perFrame.calls;
      seen.push(takeRenderCounters(info).calls);
    }
    expect(seen).toEqual([61, 61, 61, 61, 61]);
  });
});
