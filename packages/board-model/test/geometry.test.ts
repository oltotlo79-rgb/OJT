import { describe, expect, it } from 'vitest';
import {
  distance,
  nearestPointOnPolyline,
  nearestPointOnSegment,
  normalXY,
  polylineLength,
  roundVec,
  vec3,
  vecEquals,
} from '../src/index.js';

describe('geometry: 幾何ユーティリティ', () => {
  it('距離・折れ線長・丸め', () => {
    expect(distance(vec3(0, 0), vec3(3, 4))).toBe(5);
    expect(polylineLength([vec3(0, 0), vec3(3, 4), vec3(3, 10)])).toBe(11);
    expect(polylineLength([vec3(1, 1)])).toBe(0);
    expect(roundVec(vec3(1.23456, 2.00004, -0.5))).toEqual({ x: 1.235, y: 2, z: -0.5 });
    expect(vecEquals(vec3(1, 1), vec3(1, 1.0000001))).toBe(true);
  });

  it('線分・折れ線上の最寄り点', () => {
    const seg = nearestPointOnSegment(vec3(5, 5), vec3(0, 0), vec3(10, 0));
    expect(seg.point).toEqual({ x: 5, y: 0, z: 0 });
    expect(seg.t).toBe(0.5);
    expect(seg.distance).toBe(5);
    expect(nearestPointOnSegment(vec3(-5, 0), vec3(0, 0), vec3(10, 0)).t).toBe(0);
    expect(nearestPointOnSegment(vec3(1, 1), vec3(2, 2), vec3(2, 2)).point).toEqual({
      x: 2,
      y: 2,
      z: 0,
    });
    const line = nearestPointOnPolyline(vec3(5, 5), [vec3(0, 0), vec3(10, 0), vec3(10, 10)]);
    expect(line.index).toBe(0);
    expect(line.point).toEqual({ x: 5, y: 0, z: 0 });
    expect(nearestPointOnPolyline(vec3(1, 1), []).distance).toBe(Infinity);
    expect(nearestPointOnPolyline(vec3(1, 1), [vec3(4, 5)]).distance).toBe(5);
  });

  it('法線は進行方向によらず同じ側を向く（並列オフセットの決定論）', () => {
    expect(normalXY(vec3(0, 0), vec3(10, 0))).toEqual({ x: 0, y: 1, z: 0 });
    expect(normalXY(vec3(10, 0), vec3(0, 0))).toEqual({ x: 0, y: 1, z: 0 });
    expect(normalXY(vec3(0, 0), vec3(0, 10))).toEqual({ x: -1, y: 0, z: 0 });
    expect(normalXY(vec3(3, 3), vec3(3, 3))).toEqual({ x: 0, y: 0, z: 0 });
  });
});
