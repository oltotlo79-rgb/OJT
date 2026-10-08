import type { Footprint } from '@ojt/board-model';
import type { JSX } from 'react';
import { CylinderGeometry, type MeshStandardMaterial } from 'three';
import { sharedHousing } from './ComponentDetails.js';
import { toScene } from './coords.js';
import { bakeSharedTexture, labelFont, makeCanvasTexture, PX_PER_MM } from './labels.js';
import { noPick, sharedMaterial, UNIT_BOX } from './materials.js';

/** DC出力の表示LED（v2.0.0 Task 7）。通電中は緑に光り、無通電では暗い緑。 */
export const SUPPLY_LED_ON_COLOR = '#37D05A';
export const SUPPLY_LED_OFF_COLOR = '#12301C';
const LED_GEOMETRY = new CylinderGeometry(1.2, 1.2, 1.2, 12);

/** 表示LEDのマテリアル（純関数。点灯で発光する約束を単体テストで縛る）。 */
export function supplyLedMaterial(lit: boolean): MeshStandardMaterial {
  return lit
    ? sharedMaterial(SUPPLY_LED_ON_COLOR, {
        emissive: SUPPLY_LED_ON_COLOR,
        emissiveIntensity: 2.2,
      })
    : sharedMaterial(SUPPLY_LED_OFF_COLOR, { roughness: 0.6 });
}

/**
 * 実物写真のDC24V出力部。P/Nのネジと左向きの出線口を塞がない開放型端子台。
 * `lit` は DC が出ているか（ブレーカと電源スイッチの両方が入）。表示LEDの点灯に使う。
 */
export function SupplyUnit({ footprint, lit }: { footprint: Footprint; lit: boolean }): JSX.Element {
  const x = footprint.x + footprint.w / 2;
  const y = footprint.y + footprint.h / 2;
  const face = bakeSharedTexture('fixture', 'supply-output-v2', () =>
    makeCanvasTexture(10, 30, (ctx) => {
      ctx.fillStyle = '#f1efe4';
      ctx.fillRect(0, 0, 10 * PX_PER_MM, 30 * PX_PER_MM);
      for (const [offset, mark, voltage, color] of [
        [8, 'P +', '24V', '#b52626'],
        [24, 'N −', '0V', '#195cb8'],
      ] as const) {
        ctx.fillStyle = color;
        ctx.font = labelFont(3.5);
        ctx.fillText(mark, 5 * PX_PER_MM, (offset - 1.8) * PX_PER_MM);
        ctx.font = labelFont(2.3);
        ctx.fillText(voltage, 5 * PX_PER_MM, (offset + 2.3) * PX_PER_MM);
      }
    }),
  );
  return (
    <group name="supply-output">
      <mesh
        geometry={sharedHousing(26, 30, 4)}
        position={toScene({ x, y, z: 2 })}
        material={sharedMaterial('#242a2c', { roughness: 0.42 })}
        raycast={noPick}
      />
      {/* 端子の左右を囲う絶縁壁。左側は開け、ネジから出た線を常に見せる。 */}
      {[footprint.y + 1, footprint.y + 16, footprint.y + 29].map((at) => (
        <mesh
          key={at}
          geometry={sharedHousing(24, 1.8, 8)}
          position={toScene({ x, y: at, z: 6 })}
          material={sharedMaterial('#181e20', { roughness: 0.45 })}
          raycast={noPick}
        />
      ))}
      {[14, 30].map((at) => (
        <group key={at}>
          <mesh
            geometry={UNIT_BOX}
            position={toScene({ x: 20, y: at, z: 5.5 })}
            scale={[9, 8, 1.5]}
            material={sharedMaterial('#b4a378', { metalness: 0.72, roughness: 0.34 })}
            raycast={noPick}
          />
          <mesh
            geometry={sharedHousing(7.2, 6.5, 1.2)}
            position={toScene({ x: 20, y: at, z: 6.6 })}
            material={sharedMaterial('#b7bdc0', { metalness: 0.78, roughness: 0.28 })}
            raycast={noPick}
          />
        </group>
      ))}
      <mesh
        geometry={UNIT_BOX}
        position={toScene({ x: 32, y, z: 4.6 })}
        scale={[10, 30, 1.2]}
        material={sharedMaterial('#e9e8df', { roughness: 0.64 })}
        raycast={noPick}
      />
      {face === undefined ? null : (
        <mesh position={toScene({ x: 32, y, z: 5.3 })} raycast={noPick}>
          <planeGeometry args={[10, 30]} />
          <meshBasicMaterial map={face} />
        </mesh>
      )}
      {/* DC出力の表示LED（印字板の上端。「P +」の印字より奥）。v2.0.0 Task 7 */}
      <mesh
        name="supply-led"
        geometry={LED_GEOMETRY}
        material={supplyLedMaterial(lit)}
        rotation={[Math.PI / 2, 0, 0]}
        position={toScene({ x: 32, y: footprint.y + 2.5, z: 5.9 })}
        raycast={noPick}
      />
    </group>
  );
}
