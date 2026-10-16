import {
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  JIPM_BOARD,
  OUTLET_ORIGIN_MM,
  PLC_TERMINAL_PITCH_MM,
  PLC_UNIT_FX5U,
  SOCKET_STEP_HEIGHTS_MM,
  MOUNTED_PART_HEIGHT_MM,
} from '@ojt/board-model';
import type { PlcUnitDefinition } from '@ojt/board-model';
import type { CameraPreset } from '../app/store-types.js';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { toScene } from './coords.js';
import { GIZMO_GRID_PX, gizmoLayoutForViewport } from './view-gizmo-layout.js';

/**
 * 盤の傾きと視点プリセットの純粋な計算。設計仕様 §6.5 / §12.2。
 * Reactに依存せず、単体テストからもE2Eの射影計算からも読める。
 */

/**
 * カメラの垂直視野角[度]。`BoardScene` の `Canvas` に渡す値。
 *
 * v2.1.0（点検 U4）で 38° → 24° にした。38° では盤へ近づいて見るぶん透視の視差が大きく、
 * 高さ約60mmのリレー・タイマが画面の外側へずれて、隣のソケットや盤の縁（PLCの視点では盤の外）へ
 * はみ出して見えていた。24° なら同じ枠に収める距離が約1.6倍になり、ずれは約4割減る。
 */
export const CAMERA_FOV_DEG = 24;

/**
 * カメラが盤へ寄れる最短距離[mm]（端子の印字が読める程度まで）。§12.2
 * 視野角を 24° にしたので、寄せ切ったときに見える幅が以前（38°・90mm）と同じになる距離にする。
 */
export const MIN_CAMERA_DISTANCE_MM = 145;

/** カメラが離れられる最長距離[mm]（以前の 38°・1200mm と同じ見える幅）。 */
export const MAX_CAMERA_DISTANCE_MM = 1900;

/** 盤の裏側も含む全方向。キューブは上方向も回すため極で止まらない。 */
export const MAX_POLAR_ANGLE = Math.PI;

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
 * 壁コンセントがペインいっぱいに並ぶ（1280×800・1440×900 で 560×280px、1920×1080 で 614×307px。
 * v2.0.0 Task 3 で `--plc-board-w` の下限を 420 → 560px に上げ、比の箱をキャンバス自身に持たせた）。
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
  boardWidth?: number;
  /** モードDで机上に置いている本体。省くと FX5U（決定表#18）。 */
  plcUnit?: PlcUnitDefinition;
  /**
   * 3Dペインの実寸[px]（`useThree(state => state.size)`）。渡すと、左上のビューキューブ
   * （`ViewGizmo`。下地の丸とボタン）の場所を避けて中身を収める（v2.1.0 点検 U1）。
   * 省くと避けない（単体テストの既存の数値のまま）。E2E の射影（`e2e/projection.ts`）は
   * アプリと同じ値を渡す。
   */
  viewportPx?: { width: number; height: number };
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
function baseCameraPose(preset: CameraPreset, options: CameraPoseOptions): CameraPose {
  const w = options.boardWidth ?? BOARD_WIDTH_MM;
  const h = BOARD_HEIGHT_MM;
  // 盤の幅・高さが視野（`CAMERA_FOV_DEG`）に収まる面直の距離に 5% の余白を足す。
  // `options.aspect` が渡されないときは 16:10 のビューポートを仮定する（v2.1.0 で視野角を
  // 38° → 24° にしたので、以前の固定式 `max(w × 1.05, h × 1.55)` は使えない）。渡されたときは
  // その実測の縦横比で盤いっぱいに収まる距離へ計算し直す（`fitDistanceMm()` は幅・高さ両方の
  // 充足条件の大きいほうを返すので、狭いペインでも切れない）。
  const faceDistance = fitDistanceMm(w, h, options.aspect ?? DEFAULT_ASPECT) * FACE_DISTANCE_MARGIN;
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
      return { position: [0, -faceDistance, 0], target: [0, 0, 0], up: [0, 0, 1] };
    case 'top':
      // 実物写真と同じ左手前・上からの斜め俯瞰。向きだけを決め、距離と注視点は盤の箱
      // （部品の高さまで）の8隅が枠に収まるよう合わせる（v2.1.0 点検 U10。以前は固定の位置で、
      // 横長でないペインでは手前のランプが切れていた）
      return fitInto(
        {
          position: [-w * 0.62, h * 1.1, h * 1.05],
          target: [0, 0, -h * 0.02],
          up: [0, 1, 0],
        },
        boardContentPoints(w),
        options.aspect ?? DEFAULT_ASPECT,
        FULL_NDC,
        FACE_DISTANCE_MARGIN,
      );
    case 'plc': {
      // 机上のPLC本体と壁コンセントが収まるまで寄る（盤面の延長なので面直で見る）。§10.1
      const rect = plcViewRect(options.plcUnit ?? PLC_UNIT_FX5U);
      const distance = fitDistanceMm(rect.w, rect.h, options.aspect ?? PLC_VIEW_ASPECT);
      const center: [number, number, number] = [
        rect.x + rect.w / 2 - BOARD_WIDTH_MM / 2,
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
      // 盤面の矩形だけでは、手前へ張り出した立体が透視投影で拡大されて左右が切れる。
      // 装着部品の天面高さを距離へ足し、段付きソケットとリレーの両方に余白を確保する。
      const rect = SOCKET_VIEW_RECT;
      const distance =
        fitDistanceMm(rect.w, rect.h, options.aspect ?? SOCKET_VIEW_ASPECT) +
        SOCKET_STEP_HEIGHTS_MM[2] +
        MOUNTED_PART_HEIGHT_MM;
      const center: [number, number, number] = [
        rect.x + rect.w / 2 - BOARD_WIDTH_MM / 2,
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

/** 盤面の通常ドラッグ用の極角下限。キューブは姿勢全体を回すためこの制限を受けない。 */
export const MIN_POLAR_ANGLE_RAD = 0.02;

/**
 * 任意の向き → 視点。ビューキューブの**辺・角**（45°の斜め視点）のスナップ先。§12.2
 *
 * 面の6方向はツールバーと同じ `cameraPose()` のプリセットを使うが、辺12・角8には
 * 対応するプリセットが無い（プリセットを20個増やすのは筋が悪い）。距離と注視点は
 * 「いまの視点のまま」にして**向きだけ**その方向へ向け直す。
 *
 * 真下を含む全26方向にそのまま置く。上方向を視線と直交させ、極でも姿勢を定める。
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
  const reference = Math.abs(y) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const dot = x * reference[0]! + y * reference[1]! + z * reference[2]!;
  const up = [reference[0]! - dot * x, reference[1]! - dot * y, reference[2]! - dot * z];
  const upLength = Math.hypot(...up);
  return {
    position: [target[0] + distance * x, target[1] + distance * y, target[2] + distance * z],
    target: [...target],
    up: [up[0]! / upLength, up[1]! / upLength, up[2]! / upLength],
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
 * 同じ短い補間で遷移」。`t = 0` で `from` に、`t = 1` で `to` に一致し、その間は姿勢が球面上を滑らかに変化する（イージングは内部で完結するので、呼び出し側は経過時間から求めた
 * 線形の `t`（0→1）を渡すだけでよい）。`CameraPresets` が `useFrame` から毎フレーム呼ぶ。
 */
export function interpolatePose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const eased = easeOutCubic(t);
  if (eased === 0) return from;
  if (eased === 1) return to;
  // 位置の直線補間は反対側へ移る途中で盤の中心を横切り、upもゼロになる。
  // 姿勢は球面補間、距離と注視点は線形補間にして、真下から戻るときも連続させる。
  const orientation = (pose: CameraPose): Quaternion =>
    new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(
        new Vector3(...pose.position),
        new Vector3(...pose.target),
        new Vector3(...pose.up),
      ),
    );
  const rotation = orientation(from).slerp(orientation(to), eased);
  const distance = (pose: CameraPose): number =>
    Math.hypot(...pose.position.map((value, i) => value - pose.target[i]!));
  const radius = distance(from) + (distance(to) - distance(from)) * eased;
  const target = lerp3(from.target, to.target, eased);
  const position = new Vector3(0, 0, radius).applyQuaternion(rotation).add(new Vector3(...target));
  const up = new Vector3(0, 1, 0).applyQuaternion(rotation);
  return {
    position: position.toArray(),
    target,
    up: up.toArray(),
  };
}

/** 追加盤も標準盤と同じ座標原点で配置し、全体表示の中心だけ広がった盤へ移す。 */
export function cameraPose(preset: CameraPreset, options: CameraPoseOptions = {}): CameraPose {
  const base = baseCameraPose(preset, options);
  const dx = ((options.boardWidth ?? BOARD_WIDTH_MM) - BOARD_WIDTH_MM) / 2;
  const pose: CameraPose =
    preset === 'socket' || preset === 'plc' || preset === 'top'
      ? base
      : {
          ...base,
          position: [base.position[0] + dx, base.position[1], base.position[2]],
          target: [base.target[0] + dx, base.target[1], base.target[2]],
        };
  if (options.viewportPx === undefined) return pose;
  return avoidGizmo(pose, contentPoints(preset, options), options.viewportPx);
}

/* ------------------------------------------------------------------------- *
 * 中身を枠に収める・ビューキューブを避ける（v2.1.0 点検 U1・U10）
 * ------------------------------------------------------------------------- */

type Vec = [number, number, number];

function sub3(a: readonly number[], b: readonly number[]): Vec {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}
function add3(a: readonly number[], b: readonly number[]): Vec {
  return [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
}
function scale3(a: readonly number[], k: number): Vec {
  return [a[0]! * k, a[1]! * k, a[2]! * k];
}
function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}
function cross3(a: readonly number[], b: readonly number[]): Vec {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}
function unit3(a: readonly number[]): Vec {
  const length = Math.hypot(a[0]!, a[1]!, a[2]!);
  return length === 0 ? [0, 0, 0] : [a[0]! / length, a[1]! / length, a[2]! / length];
}

/** 縦横比を渡されなかったときの想定（16:10）。 */
const DEFAULT_ASPECT = 1.6;

/** 正規化デバイス座標（NDC）の矩形。x は右、y は上が正で、画面全体は ±1。 */
interface NdcRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 画面全体。 */
const FULL_NDC: NdcRect = { x0: -1, x1: 1, y0: -1, y1: 1 };

/** 盤に載る部品の天面の高さ[mm]（ソケットの最上段＋リレー・タイマ）。立体の外形に使う。 */
const PART_TOP_MM = SOCKET_STEP_HEIGHTS_MM[2] + MOUNTED_PART_HEIGHT_MM;

/** 盤モデルの矩形（mm）の4隅を、高さ `z` で（ワールド座標）。 */
function rectCorners(rect: { x: number; y: number; w: number; h: number }, z: number): Vec[] {
  return (
    [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ] as const
  ).map(([x, y]) => boardToWorld(toScene({ x, y, z })));
}

/**
 * 背の高い物（ソケットと、その上のリレー・タイマ）が並ぶ範囲（盤モデル mm）。
 * 中身の外形は「盤面（高さ0）」と「この範囲の部品の天面」の2段で取る（盤の縁に高い物は無い）。
 */
export const TALL_PARTS_RECT = ((): { x: number; y: number; w: number; h: number } => {
  const sockets = JIPM_BOARD.sockets;
  const xs = sockets.flatMap((socket) => [socket.origin.x, socket.origin.x + socket.bodyMm.width]);
  const ys = sockets.flatMap((socket) => [socket.origin.y, socket.origin.y + socket.bodyMm.length]);
  if (xs.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
})();

/** 盤面の矩形と、その中の背の高い物の天面の8点。 */
function withTallParts(rect: { x: number; y: number; w: number; h: number }): Vec[] {
  return [...rectCorners(rect, 0), ...rectCorners(TALL_PARTS_RECT, PART_TOP_MM)];
}

/** 盤全体（幅 `w`）の中身。 */
function boardContentPoints(w: number): Vec[] {
  return withTallParts({ x: 0, y: 0, w, h: BOARD_HEIGHT_MM });
}

/** プリセットが収める中身（盤・ソケット段・盤＋PLC）の点。 */
function contentPoints(preset: CameraPreset, options: CameraPoseOptions): Vec[] {
  if (preset === 'socket') return withTallParts(SOCKET_VIEW_RECT);
  if (preset === 'plc') return withTallParts(plcViewRect(options.plcUnit ?? PLC_UNIT_FX5U));
  return boardContentPoints(options.boardWidth ?? BOARD_WIDTH_MM);
}

/** 点群をいまの視点で射影したときの NDC の外接矩形。 */
function ndcBounds(points: readonly Vec[], pose: CameraPose, aspect: number): NdcRect {
  const forward = unit3(sub3(pose.target, pose.position));
  const right = unit3(cross3(forward, pose.up));
  const up = cross3(right, forward);
  const bounds = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const point of points) {
    const relative = sub3(point, pose.position);
    const depth = dot3(relative, forward);
    const x = dot3(relative, right) / (depth * HALF_FOV_TAN * aspect);
    const y = dot3(relative, up) / (depth * HALF_FOV_TAN);
    bounds.x0 = Math.min(bounds.x0, x);
    bounds.x1 = Math.max(bounds.x1, x);
    bounds.y0 = Math.min(bounds.y0, y);
    bounds.y1 = Math.max(bounds.y1, y);
  }
  return bounds;
}

/**
 * 視線の向きと上方向を保ったまま、点群が `region`（NDC）の中に `margin` 倍の余白つきで収まる
 * 距離と注視点に合わせ直す。透視なので、距離を変えると点の NDC は「前の距離 ÷ 新しい距離」倍に
 * 縮むとみなして数回くり返して詰める（奥行きの差が小さい盤では2〜3回で十分に収束する）。
 */
function fitInto(
  pose: CameraPose,
  points: readonly Vec[],
  aspect: number,
  region: NdcRect,
  margin: number,
): CameraPose {
  let current = pose;
  for (let step = 0; step < 6; step += 1) {
    const bounds = ndcBounds(points, current, aspect);
    const forward = unit3(sub3(current.target, current.position));
    const right = unit3(cross3(forward, current.up));
    const up = cross3(right, forward);
    const distance = Math.hypot(...sub3(current.target, current.position));
    const ratio = Math.max(
      ((bounds.x1 - bounds.x0) * margin) / (region.x1 - region.x0),
      ((bounds.y1 - bounds.y0) * margin) / (region.y1 - region.y0),
    );
    const next = distance * ratio;
    const shrink = distance / next;
    const centerX = ((bounds.x0 + bounds.x1) / 2) * shrink;
    const centerY = ((bounds.y0 + bounds.y1) / 2) * shrink;
    // カメラを右へ動かすと中身は画面の左へ寄る（NDC で −移動量 ÷（距離 × tan × 縦横比））
    const moveRight = (centerX - (region.x0 + region.x1) / 2) * next * HALF_FOV_TAN * aspect;
    const moveUp = (centerY - (region.y0 + region.y1) / 2) * next * HALF_FOV_TAN;
    const target = add3(current.target, add3(scale3(right, moveRight), scale3(up, moveUp)));
    current = { position: add3(target, scale3(forward, -next)), target, up: current.up };
  }
  return current;
}

/** 2つの NDC 矩形が交わるか。 */
function overlapsNdc(a: NdcRect, b: NdcRect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** ビューキューブ（下地の丸とボタン）が左上の角から占める正方形の一辺[px]。出ないときは 0。 */
export function gizmoReservePx(viewport: { width: number; height: number }): number {
  const layout = gizmoLayoutForViewport(viewport.width, viewport.height);
  if (layout === null) return 0;
  return layout.margin[0] + layout.plateRadius + GIZMO_GRID_PX;
}

/**
 * 中身がビューキューブ（左上）に重なるなら、キューブの右（左の列を空ける）か下（上の帯を空ける）の
 * 残りへ収め直す。2案のうち中身が大きく映る（カメラが近い）ほうを選ぶ。重ならないなら動かさない。
 */
function avoidGizmo(
  pose: CameraPose,
  points: readonly Vec[],
  viewport: { width: number; height: number },
): CameraPose {
  if (viewport.width <= 0 || viewport.height <= 0) return pose;
  const reserve = gizmoReservePx(viewport);
  if (reserve === 0) return pose;
  const aspect = viewport.width / viewport.height;
  const gizmo: NdcRect = {
    x0: -1,
    x1: -1 + (2 * reserve) / viewport.width,
    y0: 1 - (2 * reserve) / viewport.height,
    y1: 1,
  };
  if (!overlapsNdc(ndcBounds(points, pose, aspect), gizmo)) return pose;
  const candidates = [
    fitInto(pose, points, aspect, { ...FULL_NDC, x0: gizmo.x1 }, FACE_DISTANCE_MARGIN),
    fitInto(pose, points, aspect, { ...FULL_NDC, y1: gizmo.y0 }, FACE_DISTANCE_MARGIN),
  ];
  const distance = (candidate: CameraPose): number =>
    Math.hypot(...sub3(candidate.target, candidate.position));
  return candidates.reduce((best, candidate) =>
    distance(candidate) < distance(best) ? candidate : best,
  );
}
