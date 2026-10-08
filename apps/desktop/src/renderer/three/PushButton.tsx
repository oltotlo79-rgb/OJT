import type { PushButtonDefinition } from '@ojt/board-model';
import type { JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { CylinderGeometry, TorusGeometry } from 'three';
import { FACE_COLORS } from '../session/colors.js';
import { noPick, presetMaterial, sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 押ボタン（自動復帰型・φ22）。設計仕様 §5.3.3 / §8.2。
 * 通常は押している間だけ動作。Shift＋クリックは保持／解除する。
 * 領域外で離した場合も、共通入力管理がポインターIDを使って解除する。
 *
 * v2.0.0 Task 7（設計 §3.5「形の作り込み」）: 実物の押ボタンは、黒い樹脂の取付座の上に
 * クロームの化粧リングが載り、頭のまわりをガード（誤って押さないための縁）が囲む。
 * 頭の寸法と沈む動き（`TRAVEL_MM`）は以前のまま。E2E の `pushButtonPoint()` は頭の中心
 * （z = `CAP_CENTER_Z_MM`）を押すので、ガードは頭の中心を覆わない。飾りは `raycast={noPick}`。
 */

/** 取付座（黒い樹脂）の半径[mm]と高さ[mm]。 */
export const PB_BASE_RADIUS_MM = 11;
export const PB_BASE_HEIGHT_MM = 2;
/** 化粧リング（クローム）の半径[mm]と高さ[mm]。 */
export const PB_RING_RADIUS_MM = 11.6;
export const PB_RING_HEIGHT_MM = 1.6;
/** ガード（頭を囲む輪）の中心半径[mm]・管の半径[mm]・高さ[mm]。 */
export const PB_GUARD_RADIUS_MM = 10.2;
export const PB_GUARD_TUBE_MM = 0.9;
export const PB_GUARD_Z_MM = 5.4;
/** 頭の半径[mm]・高さ[mm]・中心の高さ[mm]（E2E が押す高さ）。 */
export const PB_CAP_RADIUS_MM = 9;
export const PB_CAP_HEIGHT_MM = 5;
export const CAP_CENTER_Z_MM = 4.5;
/** 押下時に沈む量[mm]。 */
export const TRAVEL_MM = 2;
/** 取付座の色（黒い樹脂）と化粧リングの色（クローム）。 */
export const PB_BASE_COLOR = '#24272B';
export const PB_RING_COLOR = '#D9DDE1';

const BASE = new CylinderGeometry(PB_BASE_RADIUS_MM, PB_BASE_RADIUS_MM, PB_BASE_HEIGHT_MM, 24);
const RING = new CylinderGeometry(PB_RING_RADIUS_MM, PB_RING_RADIUS_MM, PB_RING_HEIGHT_MM, 32);
/** ガード。`TorusGeometry` は XY 平面の輪（軸が Z）なので、盤の法線に合わせる回転は要らない。 */
const GUARD = new TorusGeometry(PB_GUARD_RADIUS_MM, PB_GUARD_TUBE_MM, 8, 32);
const CAP = new CylinderGeometry(PB_CAP_RADIUS_MM, PB_CAP_RADIUS_MM, PB_CAP_HEIGHT_MM, 24);
/** 円柱の軸（Y）を盤の法線（Z）へ倒す。 */
const UPRIGHT: [number, number, number] = [Math.PI / 2, 0, 0];

/** 押ボタン1個。 */
export function PushButton({
  definition,
  pressed,
  onPress,
  onRelease,
  onToggleHeld,
}: {
  definition: PushButtonDefinition;
  pressed: boolean;
  onPress: (pbId: string, pointerId: number) => void;
  onRelease: (pbId: string, pointerId: number) => void;
  onToggleHeld: (pbId: string) => void;
}): JSX.Element {
  const pos = toScene({ ...definition.pos, z: 0 });
  const color = FACE_COLORS[definition.color];
  return (
    <group position={pos} name={`pb-${definition.id}`}>
      {/* 取付座（黒い樹脂） */}
      <mesh
        name="pb-base"
        geometry={BASE}
        material={presetMaterial('blackResin', PB_BASE_COLOR)}
        rotation={UPRIGHT}
        position={[0, 0, PB_BASE_HEIGHT_MM / 2]}
        raycast={noPick}
      />
      {/* 化粧リング（クローム） */}
      <mesh
        name="pb-ring"
        geometry={RING}
        material={presetMaterial('nickel', PB_RING_COLOR)}
        rotation={UPRIGHT}
        position={[0, 0, PB_BASE_HEIGHT_MM + PB_RING_HEIGHT_MM / 2]}
        raycast={noPick}
      />
      {/* ガード（頭を囲む黒い輪。押し込むと頭がこの中へ沈む） */}
      <mesh
        name="pb-guard"
        geometry={GUARD}
        material={presetMaterial('blackResin', PB_BASE_COLOR)}
        position={[0, 0, PB_GUARD_Z_MM]}
        raycast={noPick}
      />
      {/* 頭。ここだけがクリックを受ける */}
      <mesh
        name="pb-cap"
        geometry={CAP}
        material={sharedMaterial(color, { roughness: 0.4 })}
        rotation={UPRIGHT}
        position={[0, 0, pressed ? CAP_CENTER_Z_MM - TRAVEL_MM : CAP_CENTER_Z_MM]}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          if (event.shiftKey) onToggleHeld(definition.id);
          else onPress(definition.id, event.pointerId);
        }}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onRelease(definition.id, event.pointerId);
        }}
      />
    </group>
  );
}
