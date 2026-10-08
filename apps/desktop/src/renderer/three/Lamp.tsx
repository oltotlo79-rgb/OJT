import type { LampDefinition } from '@ojt/board-model';
import type { LampLevel } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { CylinderGeometry, SphereGeometry } from 'three';
import { FACE_COLORS, LAMP_EMISSIVE } from '../session/colors.js';
import { noPick, presetMaterial, useLampMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 表示灯（φ22 のドーム形）。設計仕様 §5.3.4 / §8.2。
 * 点灯は emissive を強く、暗点灯は弱く光らせる（接触不良による分圧を目で見せる。§9.2）。
 *
 * v2.0.0 Task 7（設計 §3.5「形の作り込み」）: 実物の表示灯は、黒い樹脂の取付座の上に
 * クロームの化粧リングが載り、その内側からドーム形のレンズが出ている。以前は灰色の座1個に
 * 半球を載せただけだった。中心位置と φ22 は盤定義のまま変えない（配線の経路・当たり判定に
 * 影響しない）。飾りのメッシュは `raycast={noPick}`。
 */

/** 取付座（黒い樹脂のリング）の半径[mm]と高さ[mm]。 */
export const LAMP_BASE_RADIUS_MM = 11;
export const LAMP_BASE_HEIGHT_MM = 3;
/** 化粧リング（クローム）の半径[mm]と高さ[mm]。取付座より一回り大きく、縁が光る。 */
export const LAMP_RING_RADIUS_MM = 11.6;
export const LAMP_RING_HEIGHT_MM = 1.6;
/** レンズ（半球）の半径[mm]。 */
export const LAMP_LENS_RADIUS_MM = 8.5;
/** レンズの付け根の高さ[mm]（化粧リングの天面）。 */
export const LAMP_LENS_BASE_Z_MM = LAMP_BASE_HEIGHT_MM + LAMP_RING_HEIGHT_MM;
/** 取付座・レンズ受けの色（黒い樹脂）と化粧リングの色（クローム）。 */
export const LAMP_BASE_COLOR = '#24272B';
export const LAMP_RING_COLOR = '#D9DDE1';

const BASE = new CylinderGeometry(LAMP_BASE_RADIUS_MM, LAMP_BASE_RADIUS_MM, LAMP_BASE_HEIGHT_MM, 24);
const RING = new CylinderGeometry(LAMP_RING_RADIUS_MM, LAMP_RING_RADIUS_MM, LAMP_RING_HEIGHT_MM, 32);
/** レンズの根元を受ける黒い座（化粧リングの内側に見える）。 */
const LENS_SEAT = new CylinderGeometry(
  LAMP_LENS_RADIUS_MM + 0.6,
  LAMP_LENS_RADIUS_MM + 0.6,
  0.6,
  24,
);
const LENS = new SphereGeometry(LAMP_LENS_RADIUS_MM, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
/** 円柱の軸（Y）を盤の法線（Z）へ倒す。 */
const UPRIGHT: [number, number, number] = [Math.PI / 2, 0, 0];

/**
 * 点灯状態ごとの点光源の強度。3D-03
 * 消灯は「点光源を外す」のではなく **強度0** にする（本数を変えないため。下のコメント参照）。
 */
const LAMP_LIGHT_INTENSITY: Readonly<Record<LampLevel, number>> = { off: 0, dim: 200, lit: 900 };

/** 表示灯1個。 */
export function Lamp({
  definition,
  level,
}: {
  definition: LampDefinition;
  level: LampLevel;
}): JSX.Element {
  const pos = toScene({ ...definition.pos, z: 0 });
  const color = FACE_COLORS[definition.color];
  const material = useLampMaterial(color, LAMP_EMISSIVE[level] ?? 0);
  return (
    <group position={pos} name={`pl-${definition.id}`}>
      {/* 取付座（黒い樹脂） */}
      <mesh
        name="lamp-base"
        geometry={BASE}
        material={presetMaterial('blackResin', LAMP_BASE_COLOR)}
        rotation={UPRIGHT}
        position={[0, 0, LAMP_BASE_HEIGHT_MM / 2]}
        raycast={noPick}
      />
      {/* 化粧リング（クローム） */}
      <mesh
        name="lamp-ring"
        geometry={RING}
        material={presetMaterial('nickel', LAMP_RING_COLOR)}
        rotation={UPRIGHT}
        position={[0, 0, LAMP_BASE_HEIGHT_MM + LAMP_RING_HEIGHT_MM / 2]}
        raycast={noPick}
      />
      {/* レンズ受け（リングの内側の黒い座） */}
      <mesh
        name="lamp-lens-seat"
        geometry={LENS_SEAT}
        material={presetMaterial('blackResin', LAMP_BASE_COLOR)}
        rotation={UPRIGHT}
        position={[0, 0, LAMP_LENS_BASE_Z_MM + 0.3]}
        raycast={noPick}
      />
      {/* ドーム形のレンズ。点灯時は内側から光る（`useLampMaterial` の emissive） */}
      <mesh
        name="lamp-lens"
        geometry={LENS}
        material={material}
        rotation={UPRIGHT}
        position={[0, 0, LAMP_LENS_BASE_Z_MM]}
      />
      {/*
        点光源は**常に置き、強度だけ動かす**（3D-03）。three の `WebGLPrograms` はプログラムの
        キャッシュ鍵に `numPointLights` を含むので、消灯・点灯で点光源が増減すると
        **盤のすべての `MeshStandardMaterial` が再コンパイル**される。モードBの点滅回路では
        本数が毎秒往復し、その組み合わせが初出のあいだコマ落ちする（§15）。
        本数を固定すれば鍵は変わらず、見た目は `intensity` で同じように出る。
      */}
      <pointLight
        color={color}
        intensity={LAMP_LIGHT_INTENSITY[level] ?? 0}
        distance={70}
        position={[0, 0, 14]}
      />
    </group>
  );
}
