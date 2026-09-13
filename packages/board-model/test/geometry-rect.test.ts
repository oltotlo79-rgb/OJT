import { describe, expect, it } from 'vitest';
import {
  nearestPointOnPolyline,
  rectBottom,
  rectContains,
  rectRight,
  rectsOverlap,
  roundVec,
  segmentIntersectsRect,
  vec3,
  type Rect,
} from '../src/index.js';

describe('geometry: 矩形ユーティリティの境界規約', () => {
  it('rectRight / rectBottom', () => {
    const r: Rect = { x: 2, y: 3, w: 10, h: 5 };
    expect(rectRight(r)).toBe(12);
    expect(rectBottom(r)).toBe(8);
  });

  describe('rectContains（境界を含む・inclusive）', () => {
    const r: Rect = { x: 0, y: 0, w: 10, h: 10 };

    it('内側の点', () => {
      expect(rectContains(r, vec3(5, 5))).toBe(true);
    });

    it('辺上・角上の点はちょうど含まれる', () => {
      expect(rectContains(r, vec3(10, 5))).toBe(true); // 右辺
      expect(rectContains(r, vec3(0, 5))).toBe(true); // 左辺
      expect(rectContains(r, vec3(5, 0))).toBe(true); // 上辺
      expect(rectContains(r, vec3(5, 10))).toBe(true); // 下辺
      expect(rectContains(r, vec3(10, 10))).toBe(true); // 角
    });

    it('外側の点は含まない', () => {
      expect(rectContains(r, vec3(10.1, 5))).toBe(false);
      expect(rectContains(r, vec3(-0.1, 5))).toBe(false);
    });

    it('退化した矩形（w=0）は直線として扱われる', () => {
      const line: Rect = { x: 5, y: 0, w: 0, h: 10 };
      expect(rectContains(line, vec3(5, 5))).toBe(true);
      expect(rectContains(line, vec3(5.1, 5))).toBe(false);
    });
  });

  describe('rectsOverlap（境界のみの接触は含まない・exclusive）', () => {
    it('辺で接するだけは重ならない', () => {
      const a: Rect = { x: 0, y: 0, w: 10, h: 10 };
      const b: Rect = { x: 10, y: 0, w: 10, h: 10 };
      expect(rectsOverlap(a, b)).toBe(false);
    });

    it('重なっている', () => {
      const a: Rect = { x: 0, y: 0, w: 10, h: 10 };
      const b: Rect = { x: 5, y: 5, w: 10, h: 10 };
      expect(rectsOverlap(a, b)).toBe(true);
    });

    it('一方がもう一方を包含する', () => {
      const outer: Rect = { x: 0, y: 0, w: 20, h: 20 };
      const inner: Rect = { x: 5, y: 5, w: 5, h: 5 };
      expect(rectsOverlap(outer, inner)).toBe(true);
      expect(rectsOverlap(inner, outer)).toBe(true);
    });

    it('退化した矩形（w=0）が内部を貫く場合は重なりとみなす', () => {
      const line: Rect = { x: 5, y: 0, w: 0, h: 10 };
      const box: Rect = { x: 0, y: 0, w: 10, h: 10 };
      expect(rectsOverlap(line, box)).toBe(true);
    });

    it('退化した矩形（w=0）が境界に接するだけなら重ならない', () => {
      const line: Rect = { x: 10, y: 0, w: 0, h: 10 };
      const box: Rect = { x: 0, y: 0, w: 10, h: 10 };
      expect(rectsOverlap(line, box)).toBe(false);
    });
  });

  describe('segmentIntersectsRect（XY投影・境界のみの接触は通過とみなさない）', () => {
    const r: Rect = { x: 0, y: 0, w: 10, h: 10 };

    it('矩形の内部に完全に収まる線分', () => {
      expect(segmentIntersectsRect(vec3(2, 5), vec3(8, 5), r)).toBe(true);
    });

    it('矩形を横切る線分', () => {
      expect(segmentIntersectsRect(vec3(-5, 5), vec3(15, 5), r)).toBe(true);
    });

    it('辺と重なる（沿う）だけの線分は通過とみなさない', () => {
      expect(segmentIntersectsRect(vec3(0, 0), vec3(10, 0), r)).toBe(false); // 上辺に沿う
      expect(segmentIntersectsRect(vec3(0, 0), vec3(0, 10), r)).toBe(false); // 左辺に沿う
    });

    it('矩形の外側を通る線分', () => {
      expect(segmentIntersectsRect(vec3(-5, -5), vec3(-1, -1), r)).toBe(false);
    });

    it('長さ0の線分は排他的な点内判定に縮退する（内側）', () => {
      expect(segmentIntersectsRect(vec3(5, 5), vec3(5, 5), r)).toBe(true);
    });

    it('長さ0の線分は排他的な点内判定に縮退する（境界・外側）', () => {
      expect(segmentIntersectsRect(vec3(10, 5), vec3(10, 5), r)).toBe(false);
      expect(segmentIntersectsRect(vec3(20, 20), vec3(20, 20), r)).toBe(false);
    });

    it('z は無視される（XY平面への射影）', () => {
      expect(segmentIntersectsRect(vec3(2, 5, 100), vec3(8, 5, -100), r)).toBe(true);
    });
  });
});

describe('geometry: nearestPointOnPolyline の空配列とタイブレーク', () => {
  it('空の折れ線は最寄り区間なし（index: -1, distance: Infinity）を返す', () => {
    const p = vec3(1, 1);
    expect(nearestPointOnPolyline(p, [])).toEqual({
      point: p,
      index: -1,
      t: 0,
      distance: Infinity,
    });
  });

  it('等距離の候補が複数あるときは先に現れた区間が勝つ（決定論）', () => {
    // p=(5,1) は区間0の最寄り点(5,0)からも区間2の最寄り点(5,2)からも距離1で等距離。
    // 区間1（右辺）は距離5で無関係。先に現れる区間0が選ばれるべき。
    const line = [vec3(0, 0), vec3(10, 0), vec3(10, 2), vec3(0, 2)];
    const hit = nearestPointOnPolyline(vec3(5, 1), line);
    expect(hit.index).toBe(0);
    expect(hit.distance).toBe(1);
  });
});

describe('geometry: roundVec の -0 正規化', () => {
  it('丸め結果が -0 になる場合は 0 に正規化する', () => {
    const r = roundVec(vec3(-0.0001, -0.0001, -0.0001));
    expect(Object.is(r.x, 0)).toBe(true);
    expect(Object.is(r.y, 0)).toBe(true);
    expect(Object.is(r.z, 0)).toBe(true);
  });
});
