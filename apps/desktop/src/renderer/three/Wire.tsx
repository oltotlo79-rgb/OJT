import { WIRE_DIAMETER_MM, type WireRoute } from '@ojt/board-model';
import type { WireColor } from '@ojt/circuit-sim';
import { useEffect, useMemo, useRef, type JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BackSide, CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import {
  LOCKED_RING_COLOR,
  LUG_COLOR,
  WIRE_COLORS,
  WIRE_LANE_OVERFLOW_COLOR,
  WIRE_OUTLINE_COLOR,
  WIRE_SELECTED_COLOR,
} from '../session/colors.js';
import { INVISIBLE_MATERIAL, LUG_GEOMETRY, sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 電線。設計仕様 §6.6 / §8.2。
 * `routeWire()` が返す**直角経路の折れ線**（角はフィレット済み）を `TubeGeometry`（半径0.8mm）で
 * 描き、両端に Y型圧着端子の簡易形状（輪）を付ける。色は青／白／黄の物理色。
 *
 * 高さは経路器が `WIRE_Z_LADDER_MM` の段（x方向は 2.4 / 6.0、y方向は 4.2 / 7.8）で決めてあり、
 * 高さの変わる角には `z` だけ動く点が入っている。**ここで z を足したり丸めたりしない**
 * （直角経路が壊れ、直交する電線どうしが食い込む）。`lanes[i].span` は帯の占有記録なので
 * 描画には使わない。
 *
 * ピックは削除・指摘モードと、配線モードの編集できる電線で受ける。配線モードでは端子より
 * 手前を通る電線が端子のクリックを奪わないよう、同じ点に端子・部品があればそちらへ譲る
 * （`yieldsToParts`。§8.2 の操作性を優先）。
 */

/** チューブの半径[mm]（描画直径 1.6mm の半分。§6.6）。 */
export const WIRE_RADIUS_MM = WIRE_DIAMETER_MM / 2;
/**
 * 当たり判定だけを受け持つ太いチューブの半径[mm]。
 *
 * 見た目の電線は直径 1.6mm しかなく、画面では正面視で 4px 程度にしかならない。
 * 削除モードで経路の真上を狙って押しても 1% 程度しか当たらず「電線が選べない」状態だった
 * （レビュー指摘）。端子の当たり判定（`pickRadiusMm` = 4mm の球）と同じ考え方で、
 * 見えない太いチューブを重ねてそちらでクリックを受ける。
 */
export const WIRE_PICK_RADIUS_MM = 3.5;
/** チューブの分割数（1セグメントあたり）。 */
const SEGMENTS_PER_POINT = 4;
/** 断面の分割数。 */
const RADIAL_SEGMENTS = 6;
/** 当たり判定チューブの断面分割数（見えないので粗くてよい）。 */
const PICK_RADIAL_SEGMENTS = 4;

/** レイキャストを受けない（配線モードで端子のクリックを奪わないため）。 */
function noPick(): void {
  // 交差候補を積まない
}

/**
 * 電線の胴体の色（純粋関数。テストで固定する）。§6.3 / §6.6 / §8.2
 * 優先順位は 選択中 → 既設配線（データ上の色が何であれ実物どおり青）→ レーン重なり → 物理色。
 * `laneOverflow` は「他の電線と同じ配線位置に載った」ことの唯一の手がかりなので、
 * 琥珀色にして訓練者が2本を1本と見誤らないようにする。
 */
export function wireBodyColor(
  route: WireRoute,
  color: WireColor,
  locked: boolean,
  selected: boolean,
): string {
  if (selected) return WIRE_SELECTED_COLOR;
  if (locked) return WIRE_COLORS['青'];
  if (route.laneOverflow) return WIRE_LANE_OVERFLOW_COLOR;
  return WIRE_COLORS[color];
}

/**
 * 経路から `TubeGeometry` を作る（純粋関数。メモ化して使う）。
 * `routeWire()` が角をフィレット済みの折れ線で返すので、ここでは曲線で丸め直さず
 * **点をそのまま通す**（`curveType: 'catmullrom'` の `tension: 0` ＝ 直線補間）。
 * 勝手に丸めると直角配線の「整列して見える」利点が失われるため。
 *
 * 点が2つ未満の経路（空の経路）では**形を作る前に**空の管を返す。`CatmullRomCurve3` は
 * 点が足りないと接線を求めるところで例外を投げ、描画中の例外は3Dシーンごと落とすためである
 * （`safeRoutes()` が壊れた経路を落とす方針と同じ。レビュー指摘 3D-21）。
 */
export function buildTubeGeometry(
  route: WireRoute,
  radiusMm: number = WIRE_RADIUS_MM,
  radialSegments: number = RADIAL_SEGMENTS,
): TubeGeometry {
  const points = route.points.map((p) => {
    const [x, y, z] = toScene(p);
    return new Vector3(x, y, z);
  });
  const first = points[0];
  if (points.length < 2) {
    // 半径0・同じ点2つ＝頂点はすべて同じ場所に潰れるので、何も見えない管になる
    const empty = new CatmullRomCurve3(
      [first ?? new Vector3(), first ?? new Vector3()],
      false,
      'catmullrom',
      0,
    );
    return new TubeGeometry(empty, 1, 0, radialSegments, false);
  }
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0);
  const segments = Math.max(8, points.length * SEGMENTS_PER_POINT);
  return new TubeGeometry(curve, segments, radiusMm, radialSegments, false);
}

/**
 * 経路の同一性を表す文字列。§15
 * `safeRoutes()` はセッションが変わるたびに**全部**の経路を作り直すので、`WireRoute` の
 * オブジェクト同一性でメモ化すると1本足すだけで全電線のチューブが作り直される。
 * 折れ点の座標が同じなら形も同じなので、それを鍵にする。
 */
export function routeSignature(route: WireRoute): string {
  return `${route.wireId}|${route.points.map((p) => `${p.x},${p.y},${p.z}`).join(';')}`;
}

/**
 * 経路からチューブ形状を作り、**作り直したときに前のものを解放する**フック。§15
 * `TubeGeometry` は GPU バッファを持つので、解放しないと配線・元に戻すを繰り返すたびに
 * 積み上がる（レビュー指摘: undo/redo 40往復でヒープ +33MB）。
 */
export function useTubeGeometry(
  route: WireRoute,
  radiusMm: number = WIRE_RADIUS_MM,
  radialSegments: number = RADIAL_SEGMENTS,
): TubeGeometry {
  const signature = routeSignature(route);
  // 署名が同じなら中身も同じなので、最新の `route` をそのまま使ってよい
  const latest = useRef(route);
  latest.current = route;
  const geometry = useMemo(() => {
    // 署名が同じ＝形も同じ。値そのものは使わないが、作り直しの引き金として依存に並べる
    void signature;
    return buildTubeGeometry(latest.current, radiusMm, radialSegments);
  }, [signature, radiusMm, radialSegments]);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  return geometry;
}

/**
 * 胴体色が白線の物理色そのものかどうか（純粋関数。テストで固定する）。§6.6
 * 盤面が明るいベージュなので、白線は縁取りが無いとほぼ同化して見えなくなる
 * （レビュー指摘）。選択中／既設／レーン重なりで胴体色が変わっているときは
 * すでに目立つ色になっているのでアウトラインは付けない。
 */
export function shouldOutlineWireBody(bodyColor: string): boolean {
  return bodyColor === WIRE_COLORS['白'];
}

/**
 * 白線だけに付ける、内側から見た暗い輪郭。§6.6
 * 本体の1.5倍の太さのチューブを `BackSide`（裏面）で描き、本体からわずかにはみ出た分だけが
 * 縁取りとして見える定番のテクニック。別コンポーネントにしてあるのは、白線以外では
 * ジオメトリを**作らない**ためで、外れたときの後始末がそのまま `dispose()` になる
 * （`WirePickBody` と同じ理由）。
 */
function WireOutline({ route }: { route: WireRoute }): JSX.Element {
  const geometry = useTubeGeometry(route, WIRE_RADIUS_MM * 1.5, RADIAL_SEGMENTS);
  return (
    <mesh
      geometry={geometry}
      raycast={noPick}
      renderOrder={-1}
      material={sharedMaterial(WIRE_OUTLINE_COLOR, {
        roughness: 0.9,
        metalness: 0,
        side: BackSide,
      })}
    />
  );
}

/** 電線の当たり判定チューブに付ける目印（`yieldsToParts` の判定に使う）。 */
const WIRE_PICK_MARK = 'wirePick';

/**
 * 当たり判定だけの太いチューブ。削除モード・指摘モードと、配線モードの自分で張った電線に
 * だけ組み込まれる。別のコンポーネントにしてあるのは、要らないときは形を**作らない**ためで、
 * 外れたときにフックの後始末がそのまま `dispose()` になる。
 */
function WirePickBody({
  route,
  locked,
  yieldsToParts,
  onPick,
}: {
  route: WireRoute;
  locked: boolean;
  yieldsToParts: boolean;
  onPick: (wireId: string, locked: boolean) => void;
}): JSX.Element {
  const geometry = useTubeGeometry(route, WIRE_PICK_RADIUS_MM, PICK_RADIAL_SEGMENTS);
  return (
    <mesh
      geometry={geometry}
      material={INVISIBLE_MATERIAL}
      /*
       * `visible={false}` にしても three の `Raycaster` はこのメッシュを辿る（3D-09）。
       * `Raycaster` が見るのは `layers` と `raycast()` だけで `visible` は見ない。
       * 半透明のまま描いていたときは、削除モードの電線1本ごとにドローコールと
       * 深度ソートを払っていた（`TerminalHit` / `TerminalField` の当たり判定球が
       * 同じ形で `visible={false}` のまま拾えているのがその証拠である）。
       */
      visible={false}
      userData={{ [WIRE_PICK_MARK]: true }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        /*
         * 配線モードでは端子・ソケット・押ボタンなどを優先する（§8.2「端子クリックを優先」）。
         * 電線は端子の上で終わるので、端子を押したつもりの点にも当たり判定チューブが重なる。
         * 同じ点に電線以外の操作対象があれば、ここでは拾わずにイベントをそちらへ流す。
         */
        if (
          yieldsToParts &&
          event.intersections.some((hit) => hit.object.userData[WIRE_PICK_MARK] !== true)
        ) {
          return;
        }
        event.stopPropagation();
        onPick(route.wireId, locked);
      }}
    />
  );
}

/** 電線1本。 */
export function Wire({
  route,
  color,
  locked,
  selected,
  pickable,
  yieldsToParts = false,
  onPick,
}: {
  route: WireRoute;
  color: WireColor;
  locked: boolean;
  selected: boolean;
  /** 削除・指摘モードと、配線モードの編集できる電線で true。§8.2 */
  pickable: boolean;
  /** 配線モード: 同じ点にある端子・部品へクリックを譲る。 */
  yieldsToParts?: boolean;
  onPick: (wireId: string, locked: boolean) => void;
}): JSX.Element | null {
  const geometry = useTubeGeometry(route);
  const signature = routeSignature(route);
  const ends = useMemo(() => {
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    return first === undefined || last === undefined ? [] : [toScene(first), toScene(last)];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 折れ点が同じなら端点も同じ（署名で十分）
  }, [signature]);
  if (route.points.length < 2) return null;
  const bodyColor = wireBodyColor(route, color, locked, selected);
  const material = sharedMaterial(bodyColor, {
    roughness: locked ? 0.35 : 0.55,
    metalness: 0.05,
  });
  return (
    <group
      name={`wire-${route.wireId}`}
      userData={{ kind: route.kind, laneOverflow: route.laneOverflow }}
    >
      {/* 白線は盤面に同化して見えなくなるので、内側から暗い輪郭を付ける（§6.6） */}
      {shouldOutlineWireBody(bodyColor) ? <WireOutline route={route} /> : null}
      {/* 見た目の電線。クリックは常に下の当たり判定チューブに任せる */}
      <mesh geometry={geometry} material={material} raycast={noPick} />
      {/*
        当たり判定だけの太いチューブ。`visible={false}` なので**描かれないが**、three の
        `Raycaster` は `visible` を見ないのでクリックは拾える（`TerminalHit` /
        `TerminalField` の当たり判定球と同じ手）。3D-09
      */}
      {pickable ? (
        <WirePickBody route={route} locked={locked} yieldsToParts={yieldsToParts} onPick={onPick} />
      ) : null}
      {ends.map((pos, index) => (
        <mesh
          key={`${route.wireId}-lug-${index}`}
          geometry={LUG_GEOMETRY}
          material={sharedMaterial(locked ? LOCKED_RING_COLOR : LUG_COLOR, {
            metalness: 0.8,
            roughness: 0.3,
          })}
          raycast={noPick}
          position={pos}
          rotation={[Math.PI / 2, 0, 0]}
          scale={locked ? 1.25 : 1}
        />
      ))}
    </group>
  );
}
