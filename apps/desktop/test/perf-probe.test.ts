import { describe, expect, it } from 'vitest';
import {
  formatPerf,
  parsePerf,
  PERF_INTERVAL_MS,
  perfSample,
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
