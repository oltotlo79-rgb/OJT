import type { LampDefinition } from '@ojt/board-model';
import type { LampLevel } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { CylinderGeometry, SphereGeometry } from 'three';
import { FACE_COLORS, LAMP_EMISSIVE } from '../session/colors.js';
import { sharedMaterial, useLampMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 表示灯。設計仕様 §5.3.4 / §8.2。
 * 点灯は emissive を強く、暗点灯は弱く光らせる（接触不良による分圧を目で見せる。§9.2）。
 */

/** 表示灯の台座（盤面に埋め込まれたリング）。 */
const BEZEL = new CylinderGeometry(11, 11, 4, 24);
/** 表示灯のレンズ（半球）。 */
const LENS = new SphereGeometry(8.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);

/**
 * 点灯状態ごとの点光源の強度。3D-03
 * 消灯は「点光源を外す」のではなく **強度0** にする（本数を変えないため。上のコメント参照）。
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
      <mesh
        geometry={BEZEL}
        material={sharedMaterial('#4C5157', { metalness: 0.6, roughness: 0.35 })}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 1]}
      />
      <mesh
        geometry={LENS}
        material={material}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 3]}
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
