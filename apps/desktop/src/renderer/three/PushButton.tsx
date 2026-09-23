import type { PushButtonDefinition } from '@ojt/board-model';
import type { JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { CylinderGeometry } from 'three';
import { FACE_COLORS } from '../session/colors.js';
import { sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 押ボタン（自動復帰型）。設計仕様 §5.3.3 / §8.2。
 * `mousedown` で `press`、`mouseup`（と領域外れ）で `release` を送る＝押しっぱなしで保持できる。
 */

/** 押ボタンの台座（φ22相当）。 */
const BEZEL = new CylinderGeometry(11, 11, 3, 24);
/** 押ボタンの頭。 */
const CAP = new CylinderGeometry(9, 9, 5, 24);

/** 押下時に沈む量[mm]。 */
const TRAVEL_MM = 2;

/** 押ボタン1個。 */
export function PushButton({
  definition,
  pressed,
  onPress,
  onRelease,
}: {
  definition: PushButtonDefinition;
  pressed: boolean;
  onPress: (pbId: string) => void;
  onRelease: (pbId: string) => void;
}): JSX.Element {
  const pos = toScene({ ...definition.pos, z: 0 });
  const color = FACE_COLORS[definition.color];
  return (
    <group position={pos} name={`pb-${definition.id}`}>
      <mesh
        geometry={BEZEL}
        material={sharedMaterial('#4C5157', { metalness: 0.6, roughness: 0.35 })}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 1.5]}
      />
      <mesh
        geometry={CAP}
        material={sharedMaterial(color, { roughness: 0.4 })}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, pressed ? 4.5 - TRAVEL_MM : 4.5]}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onPress(definition.id);
        }}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onRelease(definition.id);
        }}
        onPointerOut={() => {
          if (pressed) onRelease(definition.id);
        }}
      />
    </group>
  );
}
