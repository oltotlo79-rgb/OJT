/**
 * ビューキューブ（`ViewGizmo`）の**寸法と置き場所**だけを決める純粋な層。設計仕様 §12.2。
 *
 * three も React も読み込まないので、単体テストからも E2E からもそのまま読める。
 * `ViewGizmo.tsx` が1,080行まで育って「面の名札・HUD の寸法・塗り分け・ドラッグの状態機械」が
 * 1枚に同居していたのを、2026-09-20 の指摘 3D-16 で3枚に割ったうちの1枚。
 *
 * 依存の向きは **この層 → 何も無し**。`navigation.ts`（面の名札を使う）と
 * `view-gizmo-geometry.ts`（面取りの割合を使う）がここを読む側になるので、
 * ここから他のギズモの層を読んではいけない（`import-x/no-cycle`）。
 */

/**
 * キューブの面ラベル（日本語）。§15 の文言方針にあわせる。
 *
 * **面の名札はここが唯一の源**（2026-09-20 の指摘 3D-19）。以前は `navigation.ts` にも
 * 非公開の `FACE_LABELS` があり、`GIZMO_TARGETS[].label` はそちらを焼いていたので、
 * 本番（キューブに焼く名札）とテスト（当たり判定の `label`）が別の表を見ていた。
 */
export const GIZMO_FACES = {
  right: '右',
  left: '左',
  top: '上',
  bottom: '下',
  front: '正面',
  back: '背面',
} as const;

/**
 * 面取りの深さ（1辺を1とする割合）。角・辺をこの分だけ削る。
 * `view-gizmo-geometry.ts` が面・面取りの形を、この層が外接円の半径をここから求める。
 */
export const GIZMO_CHAMFER = 0.12;

/** 面（正方形）の一辺。 */
export const GIZMO_FACE_SPAN = 1 - 2 * GIZMO_CHAMFER;

/**
 * キューブの1辺の大きさ[px]（キャンバス幅が `GIZMO_WIDE_VIEWPORT_PX` 以上のときの既定値）。
 * §12.2 / 2026-09-19 の利用者要望
 *
 * `GizmoHelper` は HUD 用の正射影カメラを画面と同じ寸法で作る（`margin` がそのまま px で
 * 効くのと同じ空間）ので、**この値はそのまま CSS ピクセル**になる。実際の描画解像度は
 * `Canvas` の `dpr` が面倒を見るため、高DPI環境でも見た目の大きさは変わらない。
 */
export const GIZMO_SIZE = 96;

/**
 * 狭いキャンバス（`GIZMO_MIN_VIEWPORT_PX` 〜 `GIZMO_WIDE_VIEWPORT_PX` 未満）でのキューブの
 * 大きさ[px]。2026-09-20 の利用者指摘「重なってるし」対応。モードD「分割」の3Dペインのように
 * 幅が限られる場面で、キューブが盤の絵を大きく覆わないよう縮める。
 */
export const GIZMO_SIZE_NARROW = 64;

/** これ以上の幅[px]ならキューブを `GIZMO_SIZE`（96px）で出す。 */
export const GIZMO_WIDE_VIEWPORT_PX = 900;

/**
 * これ未満の幅[px]ならキューブごと隠す。視点プリセットはツールバーの「…」とテンキーに
 * 変わらず残るので、機能は失わない（`gizmoLayoutForViewport()` の doc を参照）。
 */
export const GIZMO_MIN_VIEWPORT_PX = 600;

/**
 * ビューポートの上端からキューブの上端までに空ける余白[px]。
 * 状態オーバーレイは右上へ移したので（`screens.module.css` の `.statusOverlay`）、
 * 左上はキューブの場所として空いている。盤の上端の名札と重ならない高さに置く。
 */
export const GIZMO_TOP_MARGIN_PX = 20;

/** レイアウトの基準になる余白の単位[px]（§UX方針の8pxグリッド）。 */
export const GIZMO_GRID_PX = 8;

/**
 * 角を落としたキューブの外形（面取り込み）の中心からの最大半径[px] ÷ キューブの1辺[px]。
 * 面の頂点（面中心から局所 `±GIZMO_FACE_SPAN/2` だけ離れた四隅）がいちばん遠く、
 * 中心からの距離は一辺1の局所座標で `√(0.5² + (GIZMO_FACE_SPAN/2)² × 2)` になる
 * （面直の距離0.5・面内の2成分が最大）。検算は `view-gizmo.test.tsx` に置く。
 */
const GIZMO_CUBE_RADIUS_RATIO = Math.sqrt(0.5 ** 2 + 2 * (GIZMO_FACE_SPAN / 2) ** 2);

/** キューブの外形の半径[px]。 */
function gizmoCubeRadiusPx(size: number): number {
  return size * GIZMO_CUBE_RADIUS_RATIO;
}

/** ボタン（⌂ / ⟳）の1辺[px]。押しやすさのため 24px 以上にする（UXレビュー #4）。 */
const GIZMO_BUTTON_SIZE_PX = 28;

/** ボタン（⌂ / ⟳）の置き場所と大きさ[px]。 */
export const GIZMO_BUTTON = {
  size: GIZMO_BUTTON_SIZE_PX,
  /** 中心からの左右の位置（2つのボタンのあいだに `GIZMO_GRID_PX` を空ける）。 */
  x: GIZMO_BUTTON_SIZE_PX / 2 + GIZMO_GRID_PX / 2,
} as const;

/** ボタン（⌂ / ⟳）の並び。 */
export const GIZMO_BUTTONS = [
  { id: 'home', x: -GIZMO_BUTTON.x },
  { id: 'reset', x: GIZMO_BUTTON.x },
] as const;

/** ボタンの名前。 */
export type GizmoButtonId = (typeof GIZMO_BUTTONS)[number]['id'];

/** キューブの外形からボタンの中心までの隙間[px]（8pxグリッド）。 */
const GIZMO_BUTTON_CUBE_GAP_PX = GIZMO_GRID_PX;

/**
 * ボタン行のY位置（キューブ中心からの下方向オフセット）[px]。三脚を撤去したので、
 * キューブの外形のすぐ下（`GIZMO_BUTTON_CUBE_GAP_PX` の隙間だけ空けて）に置ける
 * （2026-09-20 の利用者指摘。以前は三脚の場所ぶん `-108px` まで離れていた）。
 */
function gizmoButtonYPx(size: number): number {
  return -(gizmoCubeRadiusPx(size) + GIZMO_BUTTON_CUBE_GAP_PX + GIZMO_BUTTON.size / 2);
}

/** 下地の丸がキューブ・ボタンの外接円からさらに空ける余白[px]。 */
const GIZMO_PLATE_PAD_PX = GIZMO_GRID_PX;

/**
 * 下地の丸の半径[px]。キューブとボタン2つ、両方の外接円ちょうど（空き地を残さない。
 * 2026-09-20 の利用者指摘「重なってるし」への対応: 三脚が無くなった分、下地は
 * **キューブ＋ボタンだけ**を包む大きさに絞る）。
 */
function gizmoPlateRadiusPx(size: number): number {
  const cubeRadius = gizmoCubeRadiusPx(size);
  const buttonY = gizmoButtonYPx(size);
  const buttonOuterCorner = Math.hypot(
    GIZMO_BUTTON.x + GIZMO_BUTTON.size / 2,
    Math.abs(buttonY) + GIZMO_BUTTON.size / 2,
  );
  return Math.max(cubeRadius, buttonOuterCorner) + GIZMO_PLATE_PAD_PX;
}

/** ビューポートの角から HUD（下地の外形）までの隙間[px]（8pxグリッド2つぶん）。 */
const GIZMO_EDGE_GAP_PX = GIZMO_GRID_PX * 2;

/** HUD（`GizmoHelper` の `margin`）の中心位置[px]。下地の丸の半径＋角の隙間。 */
function gizmoMarginPx(size: number): [number, number] {
  const margin = gizmoPlateRadiusPx(size) + GIZMO_EDGE_GAP_PX;
  return [margin, margin];
}

/**
 * 下地の丸の外周のふちの厚み ÷ 半径。以前の固定サイズ（半径80px・ふち1.4px）と同じ見た目の
 * 比率にする（`gizmoLayoutForViewport()` でキューブの大きさが変わっても、ふちの太さの
 * 見た目の比率は変わらない）。
 */
export const GIZMO_PLATE_RING_THICKNESS_RATIO = 1.4 / 80;

/** HUD の置き方（キューブの大きさ・余白・下地の半径・ボタン行のY位置）。 */
export interface GizmoLayout {
  size: number;
  margin: [number, number];
  plateRadius: number;
  buttonY: number;
}

/**
 * キャンバス幅・高さから HUD の置き方を決める。`null` なら隠す。§12.2 / 2026-09-20 の利用者指摘
 * 「3Dのキューブと赤、青、緑の骨組みがある意味は？…重なってるし」への対応の一環で、
 * モードD「分割」のような狭い3Dペインでキューブが盤の絵に重ならないようにする。
 *
 * - `GIZMO_WIDE_VIEWPORT_PX`（900px）以上: 既定の `GIZMO_SIZE`（96px）
 * - `GIZMO_MIN_VIEWPORT_PX`（600px）〜900px未満: `GIZMO_SIZE_NARROW`（64px）
 * - 600px未満: `null`（隠す）。視点プリセットはツールバー・テンキーからそのまま押せる
 *
 * `heightPx` は 2026-09-20 の監査指摘 B4 で足した引数（省略可・幅だけの既存呼び出しは
 * そのまま動く）。モードB「並べて」を1280px幅で見ると、3Dペインは横こそ900px前後あるが
 * 縦は盤・エディタの2段に割られて約200px台まで潰れる。幅だけで判定すると、その高さでは
 * 下地の丸（縦の占有が `margin[1] + plateRadius`）がペインの下端を越え、`panels/ViewHint.tsx`
 * の「?」（ペイン自身の下端基準の `bottom` 指定）と重なりかねない。高さも渡されたときは、
 * 選ばれた大きさの下地の丸がペインの高さに収まるか確かめ、収まらなければ幅の判定にかかわらず
 * 隠す（視点プリセットの機能はツールバー・テンキーに残るので失われない）。
 */
export function gizmoLayoutForViewport(widthPx: number, heightPx?: number): GizmoLayout | null {
  if (widthPx < GIZMO_MIN_VIEWPORT_PX) return null;
  const size = widthPx < GIZMO_WIDE_VIEWPORT_PX ? GIZMO_SIZE_NARROW : GIZMO_SIZE;
  const margin = gizmoMarginPx(size);
  const plateRadius = gizmoPlateRadiusPx(size);
  if (heightPx !== undefined && margin[1] + plateRadius > heightPx) return null;
  return {
    size,
    margin,
    plateRadius,
    buttonY: gizmoButtonYPx(size),
  };
}

/** 既定（キャンバス幅900px以上・96px）のときの下地の丸の半径[px]。 */
export const GIZMO_PLATE_RADIUS = gizmoPlateRadiusPx(GIZMO_SIZE);

/**
 * 既定（キャンバス幅900px以上・96px）のときのビューポートの角から**キューブ中心**までの
 * 余白[px]。`margin` は中心の位置なので、下地の上端は `margin[1] - GIZMO_PLATE_RADIUS`。
 */
export const GIZMO_MARGIN: [number, number] = gizmoMarginPx(GIZMO_SIZE);

/**
 * 下地の丸（キューブ＋⌂/⟳ボタン一式）がビューポートの**左上から**占める最大の半径[px]
 * （既定・キャンバス幅900px以上の場合）。`panels/ViewHint.tsx` の「?」を安全に離す位置の
 * 根拠として使う（2026-09-20 の監査指摘 B4）。実際の位置合わせは `ViewHint` 側で
 * 「対角のコーナー（右下）に置く」という単純な方法を取るため、この値は
 * `view-gizmo.test.tsx` の検算にのみ使う（ここより狭い／低いキャンバスではキューブ自体が
 * 縮む・消えるので、左上の占有はこの値を超えない）。
 */
export const GIZMO_MAX_FOOTPRINT_PX = GIZMO_MARGIN[0] + GIZMO_PLATE_RADIUS;
