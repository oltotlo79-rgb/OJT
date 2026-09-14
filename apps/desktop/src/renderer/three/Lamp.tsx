import type { LampDefinition } from '@ojt/board-model';
import type { LampLevel } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { CylinderGeometry, SphereGeometry } from 'three';
import { LAMP_COLORS, LAMP_EMISSIVE } from '../session/colors.js';
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

/** 表示灯1個。 */
export function Lamp({
  definition,
  level,
}: {
  definition: LampDefinition;
  level: LampLevel;
}): JSX.Element {
  const pos = toScene({ ...definition.pos, z: 0 });
  const color = LAMP_COLORS[definition.id] ?? '#CCCCCC';
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
      {level === 'off' ? null : (
        <pointLight
          color={color}
          intensity={level === 'lit' ? 900 : 200}
          distance={70}
          position={[0, 0, 14]}
        />
      )}
    </group>
  );
}
