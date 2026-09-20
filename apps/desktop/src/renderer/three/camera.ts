import {
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  JIPM_BOARD,
  OUTLET_ORIGIN_MM,
  PLC_TERMINAL_PITCH_MM,
  PLC_UNIT_FX5U,
} from '@ojt/board-model';
import type { PlcUnitDefinition } from '@ojt/board-model';
import type { CameraPreset } from '../app/store-types.js';

/**
 * 盤の傾きと視点プリセットの純粋な計算。設計仕様 §6.5 / §12.2。
 * React も three も使わないので、単体テストからも E2E の射影計算からも読める。
 */

/** カメラの垂直視野角[度]。`BoardScene` の `Canvas` に渡す値。 */
export const CAMERA_FOV_DEG = 38;

/** カメラが盤へ寄れる最短距離[mm]（端子の印字が読める程度まで）。§12.2 */
export const MIN_CAMERA_DISTANCE_MM = 90;

/** カメラが離れられる最長距離[mm]。 */
export const MAX_CAMERA_DISTANCE_MM = 1200;

/**
 * 仰角（極角）の上限[rad]。盤の裏側・真下へ回り込ませない。§12.2
 *
 * `OrbitControls` は `update()` のたびに極角をこの値へ丸めるので、**プリセットの視点も
 * この範囲に収まっていなければならない**（超えた視点を置くと、次のフレームで引き戻される）。
 * `cameraPose('bottom')` がちょうどこの角度を使うのはそのため。
 *
 * ちょうど 90°（`Math.PI / 2`）にする。極角は `OrbitControls` が **`camera.up` から**
 * 測る（three-stdlib `OrbitControls.update()` の `quat.setFromUnitVectors(object.up, up)`）
 * ので、面直の視点（`front` / `back` / `socket` / `plc`。`up` は `boardUp()`）はどれも
 * 極角ちょうど 90° に来る。以前の `Math.PI * 0.48`（86.4°）だと**正面視そのものが範囲外**で、
 * `update()` が毎回カメラを 3.6° 引き戻していた。見た目には気づきにくいが、面直でなくなるため
 * 端子の射影が画面の端ほど大きくずれ、盤の左上隅にある DC24V 供給端子 `P.1` では
 * ずれが当たり判定の半径（4mm ≒ 9px）を超えてクリックが当たらなくなっていた
 * （2026-09-19 のスクリーンショット確認で判明）。90° は「盤の水平面より下へ回り込ませない」
 * という本来の意図そのもので、面直の視点を範囲内に収めつつ裏側は禁じたままにできる。
 */
export const MAX_POLAR_ANGLE = Math.PI / 2;

/** ソケット段の中心の盤モデル y[mm]。盤定義のソケット原点と本体寸法から求める（ハードコードしない）。 */
export const SOCKET_ROW_CENTER_MM = ((): number => {
  const sockets = JIPM_BOARD.sockets;
  const first = sockets[0];
  if (first === undefined) return BOARD_HEIGHT_MM / 2;
  const top = Math.min(...sockets.map((socket) => socket.origin.y));
  return top + first.bodyMm.length / 2;
})();

/** 「ソケット拡大」で必ず画角に入れる余白[mm]（機器の外形の外側）。§12.2 */
export const SOCKET_VIEW_MARGIN_MM = 10;

/**
 * 「ソケット拡大」で使うビューポートの想定縦横比。
 * 3D表示領域は「ウィンドウ幅 − 右パネル380px」×「ウィンドウ高 − ツールバー − 下部パネル200px」で、
 * 1280×800 でも 1440×900 でも 1.6 程度になる。狭いほうに倒して 1.5 を想定にしておけば、
 * 実際の縦横比がこれより横長な限り左右が切れない。
 */
export const SOCKET_VIEW_ASPECT = 1.5;

/**
 * 「ソケット拡大」が収める盤の矩形（盤モデル mm）。§12.2
 *
 * ソケット8個の本体に加え、**その手前のランプ用／押ボタン用端子台まで**を含める。
 * 配線はソケットと端子台のあいだを往復するので、寄ったときに端子台が切れていると
 * 「どこへ繋ぐか」が見えず拡大の意味が無い（レビュー指摘: S1/S8 と端子台が画面外）。
 * 数値は盤定義（`sockets` と `footprints`）から求めるのでハードコードしない。
 */
export const SOCKET_VIEW_RECT = ((): { x: number; y: number; w: number; h: number } => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const socket of JIPM_BOARD.sockets) {
    xs.push(socket.origin.x, socket.origin.x + socket.bodyMm.width);
    ys.push(socket.origin.y, socket.origin.y + socket.bodyMm.length);
  }
  for (const footprint of JIPM_BOARD.footprints) {
    if (footprint.kind !== 'block') continue;
    xs.push(footprint.x, footprint.x + footprint.w);
    ys.push(footprint.y, footprint.y + footprint.h);
  }
  if (xs.length === 0 || ys.length === 0) {
    return { x: 0, y: 0, w: BOARD_WIDTH_MM, h: BOARD_HEIGHT_MM };
  }
  const x = Math.min(...xs) - SOCKET_VIEW_MARGIN_MM;
  const y = Math.min(...ys) - SOCKET_VIEW_MARGIN_MM;
  return {
    x,
    y,
    w: Math.max(...xs) + SOCKET_VIEW_MARGIN_MM - x,
    h: Math.max(...ys) + SOCKET_VIEW_MARGIN_MM - y,
  };
})();

/**
 * 「盤＋PLC」視点で使うビューポートの想定縦横比（幅 ÷ 高さ）。
 * `screens.module.css` の `--plc-aspect` と必ず同じ値にする（`ladder-layout.test.tsx` が縛る）。
 *
 * `plc` が収める矩形（`plcViewRect()`）は **盤＋机上のPLC本体＋壁コンセント**の外接で、
 * 机の上が盤の右へ伸びるぶん**横長**になる（FX5U で 580×285mm ＝ 2.03、CP1E で 560×285mm
 * ＝ 1.97、ラックで 2.2 前後）。ペインの形がこの比から離れるほど、`fitDistanceMm()` が
 * 長いほうの辺に合わせて引くので**余った側が黒くなるだけ**で中身は大きくならない。
 *
 * 2026-09-19 まではここが `0.75`（縦長）で、`.plcLayout` もその箱にペインを丸めていた。
 * すると 420×560px のペインに 580×285mm を width 基準で収めることになり、**中身は上下 3 割弱、
 * 残りは黒**（UI監査 I14「3Dペインが1〜2割しか占めず残りは真っ黒」）。さらに
 * `align-self: center` と `max-height` だけでペインの高さを content 基準に落としてしまい、
 * 実測では 150px まで潰れて盤がほとんど見えなくなっていた（バッチE の実測値）。
 *
 * いまは**中身の比そのもの**を使う。ペインは `--plc-board-w ÷ 2` の横帯になり、盤・PLC本体・
 * 壁コンセントがペインいっぱいに並ぶ（1280×800 で 420×210px、1920×1080 で 614×307px）。
 * 機種ごとの比（1.97〜2.2）との差ぶんだけ上下または左右にわずかな余白が出るが、
 * `fitDistanceMm()` は長いほうの辺で引くのでどの機種でも画角から外れない。
 */
export const PLC_VIEW_ASPECT = 2;

/** 「PLC」視点で必ず画角に入れる余白[mm]。 */
export const PLC_VIEW_MARGIN_MM = 20;

/**
 * 「盤＋PLC」視点が収める矩形（盤モデル mm）。§10.1 / 3B 決定表#6 / 4B 決定表#18
 *
 * **盤・机上のPLC本体・壁コンセントを全部**入れる。機種によって本体の外形が違う
 * （FX5U 150×90 / CP1E 130×90 / ラック 160×140）ので、機種を引数に取る。
 * 数値は盤モデルの定義から求めるのでハードコードしない。
 */
export function plcViewRect(unit: PlcUnitDefinition): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const xs = [
    0,
    BOARD_WIDTH_MM,
    unit.pos.x,
    unit.pos.x + unit.sizeMm.width,
    OUTLET_ORIGIN_MM.x,
    OUTLET_ORIGIN_MM.x + PLC_TERMINAL_PITCH_MM * 2,
  ];
  const ys = [
    0,
    BOARD_HEIGHT_MM,
    unit.pos.y,
    unit.pos.y + unit.sizeMm.height,
    OUTLET_ORIGIN_MM.y - PLC_TERMINAL_PITCH_MM,
    OUTLET_ORIGIN_MM.y + PLC_TERMINAL_PITCH_MM,
  ];
  const x = Math.min(...xs) - PLC_VIEW_MARGIN_MM;
  const y = Math.min(...ys) - PLC_VIEW_MARGIN_MM;
  return {
    x,
    y,
    w: Math.max(...xs) + PLC_VIEW_MARGIN_MM - x,
    h: Math.max(...ys) + PLC_VIEW_MARGIN_MM - y,
  };
}

/** 既定（FX5U）の矩形。既存の呼び出しと landed テストのために残す。 */
export const PLC_VIEW_RECT = plcViewRect(PLC_UNIT_FX5U);

/** 視野角の半分の tan（画角計算の共通項）。 */
const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEG / 2) * (Math.PI / 180));

/** 幅 `widthMm` × 高さ `heightMm` の矩形が視野 38° に収まる面直距離[mm]。 */
export function fitDistanceMm(widthMm: number, heightMm: number, aspect: number): number {
  return Math.max(widthMm / 2 / (HALF_FOV_TAN * aspect), heightMm / 2 / HALF_FOV_TAN);
}

/**
 * 盤グループの X 軸回転量[rad]。
 * 盤面ローカル（+Z が盤面の法線、+Y が盤の奥方向）を机の上に寝かせ、
 * 筐体の傾斜角ぶんだけ手前を下げる。`-90°` で完全に水平、`slopeDeg` ぶん戻して傾斜コンソールにする。
 *
 * 「+Y が奥」の根拠: この関数や `boardToWorld` 全般が受け取るのは `toScene()` の結果空間で、
 * `toScene()` は盤モデルの y（0 = 奥のソケット側、BOARD_HEIGHT_MM = 手前の PL/PB 側）を
 * `-(v.y - BOARD_HEIGHT_MM / 2)` で反転する。したがってこの空間の +Y は盤モデルの y が
 * 小さくなる向き＝奥へ向かう（盤モデルの y 自体は手前が大きい）。
 * `scene.test.ts`「盤の奥（盤ローカル +Y）は画面の奥へ倒れる」で検証している。
 */
export const BOARD_TILT_RAD = -(Math.PI / 2 - (JIPM_BOARD.console.slopeDeg * Math.PI) / 180);

/** 盤ローカル座標（`toScene()` の結果）→ ワールド座標。盤グループと同じ回転を掛ける。 */
export function boardToWorld(
  [x, y, z]: readonly [number, number, number],
  tiltRad: number = BOARD_TILT_RAD,
): [number, number, number] {
  const cos = Math.cos(tiltRad);
  const sin = Math.sin(tiltRad);
  return [x, y * cos - z * sin, y * sin + z * cos];
}

/** カメラ位置・注視点・上方向（すべてワールド座標）。 */
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

/** 盤面の「上」方向（盤ローカルの +Y を回した向き）。面直視のときのカメラ上方向。 */
export function boardUp(): [number, number, number] {
  return boardToWorld([0, 1, 0]);
}

/** 視点の付帯条件（機種と実際のビューポートの縦横比）。 */
export interface CameraPoseOptions {
  /** モードDで机上に置いている本体。省くと FX5U（決定表#18）。 */
  plcUnit?: PlcUnitDefinition;
  /**
   * 実際のビューポート（3Dペイン）の縦横比（幅[px] ÷ 高さ[px]）。省くと `front` / `back` /
   * `bottom` は「16:10 のビューポート」を仮定した固定距離のまま、`socket` / `plc` は
   * `SOCKET_VIEW_ASPECT` / `PLC_VIEW_ASPECT` の仮定値のまま（＝既存の呼び出し・テストは
   * 数値が変わらない）。
   *
   * 渡すと、盤（または対象の矩形）が**その縦横比のペインいっぱいに**収まる距離を
   * `fitDistanceMm()` で計算し直す。2026-09-20 の監査指摘 I14「3Dペインが1〜2割しか
   * 占めず残りは真っ黒（モードB並べて・モードD）」への対応。モードB「並べて」は
   * 1280px幅だと3Dペインの縦横比が16:10から大きく外れる（横に広く縦が低い）ので、
   * 仮定のままだと盤が小さいまま余白ばかりになる。`CameraPresets.tsx` が
   * `useThree(state => state.size)` から実測して渡す。
   */
  aspect?: number;
}

/** `front` / `back` / `bottom` の面直距離の余白（5%）。`fitDistanceMm()` に掛ける。 */
const FACE_DISTANCE_MARGIN = 1.05;

/**
 * プリセット → 視点。§12.2
 * - `front`（正面）: 盤面の法線方向から見る。面直なので端子が重ならずいちばん操作しやすい
 * - `top`（俯瞰）: 実物写真と同じ左手前・上からの斜め俯瞰。盤の立体感を見せる
 * - `socket`（ソケット拡大）: 面直のままソケット段へ寄る
 * - `plc`（盤＋PLC）: 面直のまま、机上のPLC本体と壁コンセントまで画角に入れる（モードD）。§10.1
 * - `back`（後）: 盤の裏側から。盤面の裏（板の背面）を見る
 * - `left` / `right`（左・右）: 盤の側面から。傾斜角と機器の高さが分かる
 * - `bottom`（下）: 盤を下から見上げる。ただし `MAX_POLAR_ANGLE` より下へは回り込めないので
 *   「許される範囲でいちばん低い位置から見上げる」視点になる（2026-09-14 の利用者要望の注記）
 */
export function cameraPose(preset: CameraPreset, options: CameraPoseOptions = {}): CameraPose {
  const w = BOARD_WIDTH_MM;
  const h = BOARD_HEIGHT_MM;
  // 視野角38°・横基準。盤の幅330mmが収まるには距離 ≥ 165/(tan(19°)×aspect) 必要で、
  // 16:10 のビューポート（aspect 1.6）なら 305mm。1割の余白を足した w × 1.05 を面直視の距離にする。
  // `options.aspect` が渡されたときは、その実測の縦横比で盤いっぱいに収まる距離へ計算し直す
  // （`fitDistanceMm()` は幅・高さ両方の充足条件の大きいほうを返すので、狭いペインでも切れない）。
  const faceDistance =
    options.aspect === undefined
      ? Math.max(w * 1.05, h * 1.55)
      : fitDistanceMm(w, h, options.aspect) * FACE_DISTANCE_MARGIN;
  switch (preset) {
    case 'front':
      return {
        position: boardToWorld([0, 0, faceDistance]),
        target: boardToWorld([0, 0, 0]),
        up: boardUp(),
      };
    case 'back':
      return {
        position: boardToWorld([0, 0, -faceDistance]),
        target: boardToWorld([0, 0, 0]),
        up: boardUp(),
      };
    case 'right':
      return { position: [faceDistance, 0, 0], target: [0, 0, 0], up: boardUp() };
    case 'left':
      return { position: [-faceDistance, 0, 0], target: [0, 0, 0], up: boardUp() };
    case 'bottom':
      // 極角の上限ちょうど（＝許される範囲でいちばん低い位置）に置く。これより下は
      // `OrbitControls` が `update()` で引き戻すので、視点が落ち着かない。§12.2
      return {
        position: [
          0,
          faceDistance * Math.cos(MAX_POLAR_ANGLE),
          faceDistance * Math.sin(MAX_POLAR_ANGLE),
        ],
        target: [0, 0, 0],
        up: [0, 1, 0],
      };
    case 'top':
      return {
        position: [-w * 0.62, h * 1.1, h * 1.05],
        target: [0, 0, -h * 0.02],
        up: [0, 1, 0],
      };
    case 'plc': {
      // 机上のPLC本体と壁コンセントが収まるまで寄る（盤面の延長なので面直で見る）。§10.1
      const rect = plcViewRect(options.plcUnit ?? PLC_UNIT_FX5U);
      const distance = fitDistanceMm(rect.w, rect.h, options.aspect ?? PLC_VIEW_ASPECT);
      const center: [number, number, number] = [
        rect.x + rect.w / 2 - w / 2,
        h / 2 - (rect.y + rect.h / 2),
        0,
      ];
      return {
        position: boardToWorld([center[0], center[1], distance]),
        target: boardToWorld(center),
        up: boardUp(),
      };
    }
    case 'socket': {
      // ソケット段＋端子台の外接矩形がちょうど収まる距離まで寄る（固定倍率で寄せない）
      const rect = SOCKET_VIEW_RECT;
      const distance = fitDistanceMm(rect.w, rect.h, options.aspect ?? SOCKET_VIEW_ASPECT);
      const center: [number, number, number] = [
        rect.x + rect.w / 2 - w / 2,
        h / 2 - (rect.y + rect.h / 2),
        0,
      ];
      return {
        position: boardToWorld([center[0], center[1], distance]),
        target: boardToWorld(center),
        up: boardUp(),
      };
    }
  }
}

/**
 * 視点の遷移時間[ms]。§12.2「視点プリセットとギズモのスナップは同じ短い補間で遷移」。
 * `CameraPresets`（プリセット）と `ViewGizmo`（キューブの辺・角へのスナップ）が共有する。
 */
export const VIEW_TRANSITION_MS = 300;

/**
 * 極角の下限[rad]。真上（極）ちょうどに置くとカメラの上方向（0,1,0）と視線が平行になり
 * 画が定まらないので、わずかに外す。
 *
 * **`BoardScene` の `<OrbitControls minPolarAngle={...}>` にも渡す**（Task 19 / 3D-15〜19）。
 * three-stdlib の既定は 0（＝極そのもの）で、極ではカメラ位置が
 * `target + (0, 距離, 0)` に固定され、方位角をいくら変えても動かない。ビューキューブを
 * 引いてそこへ張り付くと、そのあとどちらへ引いても画が変わらなくなる
 * （2026-09-20 の利用者報告「上から正面にキューブを回そうとすると回らない」。
 * 実測は Task 19 Step 1: 俯瞰の極角 0.8897 → 下へ200px で 0.0000 に張り付く）。
 */
export const MIN_POLAR_ANGLE_RAD = 0.02;

/**
 * 任意の向き → 視点。ビューキューブの**辺・角**（45°の斜め視点）のスナップ先。§12.2
 *
 * 面の6方向はツールバーと同じ `cameraPose()` のプリセットを使うが、辺12・角8には
 * 対応するプリセットが無い（プリセットを20個増やすのは筋が悪い）。距離と注視点は
 * 「いまの視点のまま」にして**向きだけ**その方向へ向け直す。
 *
 * 極角は `[MIN_POLAR_ANGLE_RAD, MAX_POLAR_ANGLE - MIN_POLAR_ANGLE_RAD]` に丸める。盤の裏側・
 * 真下へは回り込めないので、丸めずに置くと `OrbitControls.update()` が次のフレームで引き戻して
 * 視点が落ち着かない（`cameraPose('bottom')` と同じ理由）。下向きの辺・角は「許される範囲で
 * いちばん低い位置から見上げる」視点になる。
 *
 * 上下とも**下限・上限ちょうどには置かない**（Task 19 / 3D-15〜19）。真上（極角0）は球座標の
 * 極で、そこでは方位角を変えてもカメラ位置が動かない（＝どちらへ引いても画が変わらない）。
 * 上限ちょうども同じく片側のドラッグが死ぬので、`MIN_POLAR_ANGLE_RAD`（0.02rad ≒ 1.1°）だけ
 * 内側に置いて、辺・角へスナップしたあとも**どちらの向きにも引ける**ようにする。
 */
export function poseForDirection(
  direction: readonly [number, number, number],
  { distance, target }: { distance: number; target: readonly [number, number, number] },
): CameraPose {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  const [x, y, z] =
    length === 0
      ? [0, 0, 1]
      : ([direction[0] / length, direction[1] / length, direction[2] / length] as const);
  // three の `Spherical` と同じ取り方（+Y が極、方位角は +Z から +X へ）
  const azimuth = Math.atan2(x, z);
  const polar = Math.min(
    MAX_POLAR_ANGLE - MIN_POLAR_ANGLE_RAD,
    Math.max(MIN_POLAR_ANGLE_RAD, Math.acos(y)),
  );
  const sin = Math.sin(polar);
  return {
    position: [
      target[0] + distance * sin * Math.sin(azimuth),
      target[1] + distance * Math.cos(polar),
      target[2] + distance * sin * Math.cos(azimuth),
    ],
    target: [target[0], target[1], target[2]],
    up: [0, 1, 0],
  };
}

/** `t`∈[0,1] を ease-out（3次）に変換する。速く動き出し、減速しながら止まる。 */
function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/** 3要素タプルの線形補間。 */
function lerp3(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/**
 * 2つの視点を ease-out で補間する純粋関数。§12.2「視点プリセットとギズモのスナップは
 * 同じ短い補間で遷移」。`t = 0` で `from` に、`t = 1` で `to` に一致し、その間は各成分が
 * 単調に変化する（イージングは内部で完結するので、呼び出し側は経過時間から求めた
 * 線形の `t`（0→1）を渡すだけでよい）。`CameraPresets` が `useFrame` から毎フレーム呼ぶ。
 */
export function interpolatePose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const eased = easeOutCubic(t);
  return {
    position: lerp3(from.position, to.position, eased),
    target: lerp3(from.target, to.target, eased),
    up: lerp3(from.up, to.up, eased),
  };
}
