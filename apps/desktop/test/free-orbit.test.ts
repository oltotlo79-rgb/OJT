import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { freeOrbitPose } from '../src/renderer/three/free-orbit.js';
import { cameraPose, poseForDirection } from '../src/renderer/three/camera.js';
import { GIZMO_TARGETS } from '../src/renderer/three/navigation.js';

describe('キューブを上下左右に360°以上回す', () => {
  for (const target of GIZMO_TARGETS) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      it(`${target.id} / ${dx},${dy}: 極・裏面を通過しても一度も止まらず2周できる`, () => {
        const start = poseForDirection(target.direction, { distance: 380, target: [13, -9, 21] });
        let previous = new Vector3(...start.position);
        for (let pixel = 10; pixel <= 2000; pixel += 10) {
          const pose = freeOrbitPose(start, pixel * dx, pixel * dy);
          const position = new Vector3(...pose.position);
          const offset = position.clone().sub(new Vector3(...pose.target));
          expect(position.distanceTo(previous)).toBeCloseTo(2 * 380 * Math.sin(Math.PI / 100), 8);
          expect(offset.length()).toBeCloseTo(380, 9);
          expect(offset.normalize().dot(new Vector3(...pose.up))).toBeCloseTo(0, 9);
          expect(pose.target).toEqual(start.target);
          previous = position;
        }
        expect(previous.distanceTo(new Vector3(...start.position))).toBeLessThan(1e-8);
      });
    }
  }
  it('上下回転の途中で放してつかみ直しても同じ方向に回り続ける', () => {
    let pose = cameraPose('front');
    const start = pose;
    for (let i = 0; i < 10; i += 1) pose = freeOrbitPose(pose, 0, 100);
    expect(new Vector3(...pose.position).distanceTo(new Vector3(...start.position))).toBeLessThan(
      1e-8,
    );
  });
});
