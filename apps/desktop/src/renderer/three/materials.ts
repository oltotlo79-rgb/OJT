import { useMemo } from 'react';
import {
  BoxGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  type Material,
} from 'three';

/**
 * 共有ジオメトリ／マテリアル。設計仕様 §15「電線はチューブジオメトリを共有マテリアルで描く」。
 * 端子は 5 ソケット × 14 ピン ＋ 端子台 20 個 ＋ P/N 12 個で 100 個を超えるため、
 * 形と色が同じものは必ず 1 個を使い回してドローコールとメモリを抑える。
 */

/** ネジ端子の見た目（半径 1.8mm・高さ 1.6mm の円柱）。 */
export const SCREW_GEOMETRY = new CylinderGeometry(1.8, 1.8, 1.6, 12);

/** 端子の当たり判定球（実際の半径は `pickRadiusMm` でスケールする）。§6.5 */
export const PICK_GEOMETRY = new SphereGeometry(1, 10, 8);

/** 1×1×1 の箱（スケールして使い回す）。 */
export const UNIT_BOX = new BoxGeometry(1, 1, 1);

/** Y型圧着端子の輪（外径 5mm・線径 0.9mm）。§6.6 */
export const LUG_GEOMETRY = new CylinderGeometry(2.5, 2.5, 0.9, 10, 1, true);

/** 当たり判定メッシュ用の透明マテリアル（見えないが raycast は拾う）。 */
export const INVISIBLE_MATERIAL: Material = new MeshStandardMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

const materialCache = new Map<string, MeshStandardMaterial>();

/** 色ごとに1個だけ作る標準マテリアル。 */
export function sharedMaterial(
  color: string,
  options: {
    metalness?: number;
    roughness?: number;
    emissive?: string;
    emissiveIntensity?: number;
  } = {},
): MeshStandardMaterial {
  const key = `${color}|${options.metalness ?? 0.1}|${options.roughness ?? 0.7}|${options.emissive ?? ''}|${options.emissiveIntensity ?? 0}`;
  const cached = materialCache.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.1,
    roughness: options.roughness ?? 0.7,
    ...(options.emissive === undefined ? {} : { emissive: options.emissive }),
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  materialCache.set(key, material);
  return material;
}

/** 発光強度だけが変わるマテリアル（ランプ用。色ごとにインスタンスを分ける）。§5.3.4 */
export function useLampMaterial(color: string, intensity: number): MeshStandardMaterial {
  const material = useMemo(
    () =>
      new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.35 }),
    [color],
  );
  material.emissiveIntensity = intensity;
  return material;
}
