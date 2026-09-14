import type { BoardTerminal } from '@ojt/board-model';
import type { JSX } from 'react';
import { DIN_RAIL_COLOR } from '../session/colors.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';

/**
 * DINレール。設計仕様 §6.5（実物写真のとおり、ソケットと端子台はレール上に並ぶ）。
 * レールの位置と長さは「その上に載る機器の端子の外接矩形」から求めるので、
 * 盤定義に寸法を足さなくても機器の並びに追随する。
 */

/** レイキャストを受けない（空クリックが必ず「配線の取り消し」になるようにする）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** レールの幅（奥行方向）[mm]。TH35 相当。 */
const RAIL_WIDTH_MM = 35;
/** レールの厚み[mm]。 */
const RAIL_THICKNESS_MM = 2.5;
/** 左右の伸ばし代[mm]。 */
const RAIL_MARGIN_MM = 10;

/** 機器の端子群の下に1本のレールを敷く。端子が無ければ描かない。 */
export function DinRail({
  terminals,
}: {
  terminals: readonly BoardTerminal[];
}): JSX.Element | null {
  if (terminals.length === 0) return null;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const center = toScene({ x: (minX + maxX) / 2, y: centerY, z: RAIL_THICKNESS_MM / 2 });
  return (
    <mesh
      geometry={UNIT_BOX}
      raycast={noPick}
      material={sharedMaterial(DIN_RAIL_COLOR, { metalness: 0.75, roughness: 0.35 })}
      position={center}
      scale={[maxX - minX + RAIL_MARGIN_MM * 2, RAIL_WIDTH_MM, RAIL_THICKNESS_MM]}
    />
  );
}
