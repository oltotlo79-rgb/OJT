import { routeFixedLinks, type BoardDefinition } from '@ojt/board-model';
import { useMemo, type JSX } from 'react';
import { PANEL_HOLE_COLOR, WIRE_COLORS } from '../session/colors.js';
import { toScene } from './coords.js';
import { sharedMaterial } from './materials.js';
import { buildTubeGeometry } from './Wire.js';

/**
 * 既設配線（端子台 → 各表示灯・押ボタン）。設計仕様 §6.4 / §6.5。
 *
 * 実物の写真では、端子台の各端子から**機器の真上をまっすぐ平行に降りた青い線**が、
 * 機器の奥側の根元にある盤面の貫通穴へ入り、そこから裏側の本体端子へつながっている。
 * 経路は `routeFixedLinks()`（Plan 1B）が返すものをそのまま描き、`throughPanelAt` に
 * 小さな黒い穴を描いて「ここで盤の裏へ抜ける」ことを示す。機器の表面や中心には結ばない。
 * 訓練者は触れないので当たり判定も持たせない。
 */

/** 既設配線の色（実物どおり青。§4.2） */
const FIXED_LINK_COLOR = WIRE_COLORS['青'];
/** 盤面の貫通穴の半径[mm]。 */
const PANEL_HOLE_RADIUS_MM = 2.4;

/** レイキャストを受けない（クリックを下の端子へ通す）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 既設配線と、その行き先の盤面の貫通穴をまとめて描く。 */
export function FixedWires({ board }: { board: BoardDefinition }): JSX.Element {
  const routes = useMemo(() => routeFixedLinks(board), [board]);
  const geometries = useMemo(
    () => routes.map((route) => ({ id: route.wireId, geometry: buildTubeGeometry(route) })),
    [routes],
  );
  const holes = useMemo(
    () =>
      routes
        .map((route) => route.throughPanelAt)
        .filter((hole): hole is NonNullable<typeof hole> => hole !== undefined),
    [routes],
  );
  const material = sharedMaterial(FIXED_LINK_COLOR, { roughness: 0.5, metalness: 0.05 });

  return (
    <group name="fixed-wires">
      {geometries.map((entry) => (
        <mesh key={entry.id} geometry={entry.geometry} material={material} raycast={noPick} />
      ))}
      {holes.map((hole, index) => (
        <mesh
          key={`hole-${index}`}
          raycast={noPick}
          position={toScene({ x: hole.x, y: hole.y, z: 0.3 })}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[PANEL_HOLE_RADIUS_MM, PANEL_HOLE_RADIUS_MM, 0.6, 12]} />
          <meshStandardMaterial color={PANEL_HOLE_COLOR} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
