import { routeFixedLinks, type BoardDefinition } from '@ojt/board-model';
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
import { PANEL_HOLE_COLOR, WIRE_COLORS } from '../session/colors.js';
import { toScene } from './coords.js';
import { applyInstanceMatrices, PIN_HOLE_GEOMETRY, sharedMaterial } from './materials.js';
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
/** 貫通穴の円柱の高さ[mm]（`PIN_HOLE_GEOMETRY` の 0.5mm に対する倍率で出す）。 */
const PANEL_HOLE_HEIGHT_SCALE = 0.6 / 0.5;
/** 貫通穴の姿勢（横倒しの円柱。`rotation={[Math.PI / 2, 0, 0]}` と同じ）。 */
const PANEL_HOLE_ROTATION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

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
  /*
   * 作り直したら前のものを**必ず解放する**（3D-05）。`TubeGeometry` は GPU バッファを持つので、
   * 解放しないと課題を開き直すたびに20本ぶんが積み上がる。同じファイル群の `Wire.tsx` /
   * `DeskWires.tsx` は `useTubeGeometry()` で厳密に解放しているのに、ここだけ `useMemo` の
   * 作りっぱなしで扱いが割れていた。
   */
  useEffect(
    () => () => {
      for (const entry of geometries) entry.geometry.dispose();
    },
    [geometries],
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
      {/* 貫通穴は共有ジオメトリ1個の `instancedMesh` に畳む（20ドローコール → 1）。3D-02 */}
      <PanelHoles holes={holes} />
    </group>
  );
}

/**
 * 盤面の貫通穴をまとめて描く。3D-02
 * ソケットの差込穴（`Socket.tsx` の `PinHoles`）と同じく、形も色も同じ20個を
 * 共有ジオメトリ＋共有マテリアルの `instancedMesh` 1本で描く。
 */
function PanelHoles({ holes }: { holes: readonly { x: number; y: number }[] }): JSX.Element | null {
  const mesh = useRef<InstancedMesh | null>(null);
  const matrices = useMemo(
    () =>
      holes.map((hole) => {
        const [x, y, z] = toScene({ x: hole.x, y: hole.y, z: 0.3 });
        return new Matrix4().compose(
          new Vector3(x, y, z),
          PANEL_HOLE_ROTATION,
          new Vector3(PANEL_HOLE_RADIUS_MM, PANEL_HOLE_HEIGHT_SCALE, PANEL_HOLE_RADIUS_MM),
        );
      }),
    [holes],
  );
  useEffect(() => {
    applyInstanceMatrices(mesh.current, matrices);
  }, [matrices]);
  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[
        PIN_HOLE_GEOMETRY,
        sharedMaterial(PANEL_HOLE_COLOR, { roughness: 0.9 }),
        matrices.length,
      ]}
      raycast={noPick}
    />
  );
}
