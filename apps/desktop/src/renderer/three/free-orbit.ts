import { Quaternion, Vector3 } from 'three';
import type { CameraPose } from './camera.js';
import { GIZMO_DRAG_RAD_PER_PX } from './navigation.js';

/** 球座標の極角を制限せず、画面の上下左右を軸にカメラと上方向を一緒に回す。 */
export function freeOrbitPose(from: CameraPose, dx: number, dy: number): CameraPose {
  const target = new Vector3(...from.target);
  const offset = new Vector3(...from.position).sub(target);
  const direction = offset.clone().normalize();
  const up = new Vector3(...from.up);
  up.addScaledVector(direction, -up.dot(direction));
  // 真上・真下を向いた外部プリセットでも直交する基底を作る。
  if (up.lengthSq() < 1e-12) {
    up.set(0, 0, Math.abs(direction.z) < 0.9 ? 1 : 0);
    if (up.lengthSq() === 0) up.set(1, 0, 0);
    up.addScaledVector(direction, -up.dot(direction));
  }
  up.normalize();
  const right = up.clone().cross(direction).normalize();
  const pitch = new Quaternion().setFromAxisAngle(right, dy * GIZMO_DRAG_RAD_PER_PX);
  const yaw = new Quaternion().setFromAxisAngle(up, dx * GIZMO_DRAG_RAD_PER_PX);
  const rotation = yaw.multiply(pitch);
  offset.applyQuaternion(rotation);
  up.applyQuaternion(rotation).normalize();
  return {
    position: offset.add(target).toArray(),
    target: [...from.target],
    up: up.toArray(),
  };
}
