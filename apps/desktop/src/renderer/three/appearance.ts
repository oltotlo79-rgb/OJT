// `labels.ts` も `FaceRect` を export している（別の形）。読み手が迷わないよう別名で読む（決定表#19）
import type {
  FaceRect as AppearanceRect,
  PlcAppearance,
  PlcCoverMark,
  PlcLedMark,
  Vec3,
} from '@ojt/board-model';

/**
 * PLC本体の外観（`PlcAppearance`）を3Dへ写す純関数。設計仕様 §10.1 / §17.1。決定表#15
 *
 * 色・寸法・面上の配置は**すべて `@ojt/board-model` の `PlcAppearance` が持つ**（4A 決定表#15）。
 * このファイルには hex も mm も書かない（厚みだけは 3D 固有の都合なのでここに置く）。
 * three を import しないので、`happy-dom` でも Node でも単体テストできる。
 *
 * 座標系: `PlcAppearance` は**正面の左上が原点・x が右・y が下・mm**。盤モデルも机上の面を
 * 同じ向きで見るので、本体の設置位置（`unit.pos` / `module.pos`）に足すだけで写る。
 */

/**
 * 筐体の厚み[mm]。
 * 実寸の奥行（FX5U は 83mm）まで出すと端子が谷底になってクリックしづらく、正面視でも端子列が
 * 見えなくなるので、薄い台として描く（Plan 3B 意図的な差分 #1 を踏襲）。
 */
export const PLC_BODY_Z_MM = 6;
/** ラックのモジュールの厚み[mm]（ベースより手前に出す）。 */
export const RACK_BODY_Z_MM = 8;
/** 端子カバー・造作を筐体から浮かせる高さ[mm]（Zファイティング避け）。 */
export const FACE_LIFT_MM = 0.4;
/** 端子の印字テクスチャの高さ[mm]。カバーより**手前**に置く（決定表#16）。 */
export const FACE_LABEL_LIFT_MM = 1.2;
/** LEDの高さ[mm]（印字よりさらに手前）。 */
export const FACE_LED_LIFT_MM = 1.6;

/** 盤モデル座標での箱（中心と大きさ）。 */
export interface FaceBox {
  cx: number;
  cy: number;
  z: number;
  w: number;
  h: number;
}

/**
 * 正面の矩形（左上原点・mm）を盤モデル座標の箱に直す。
 * @param origin 本体（ラックはモジュール）の左奥の角＝`unit.pos` / `module.pos`
 * @param rect 正面の矩形（`PlcAppearance` の `FaceRect`）
 * @param zMm 盤面からの高さ[mm]
 */
export function faceRectToBoard(origin: Vec3, rect: AppearanceRect, zMm: number): FaceBox {
  return {
    cx: origin.x + rect.x + rect.w / 2,
    cy: origin.y + rect.y + rect.h / 2,
    z: zMm,
    w: rect.w,
    h: rect.h,
  };
}

/** 銘板の既定位置からのずらし量[mm]（盤モデル座標）。既定は動かさない。 */
export interface NameplateOffsetMm {
  x: number;
  y: number;
}
/** ずらさない（既定値）。 */
export const NO_NAMEPLATE_OFFSET: NameplateOffsetMm = { x: 0, y: 0 };

/**
 * 銘板の外接矩形（盤モデル mm・絶対座標）。`faceRectToBoard()` と同じ左上原点の式に `offset` を
 * 足しただけだが、中心ではなく矩形そのもの（x0/y0/x1/y1）を返す。
 *
 * ラック形（`PlcRack.tsx`）はベースの銘板（`PC10G-1SP` / `JW-300`）を既定位置から下へずらして
 * 描く（先頭モジュールの銘板 `POWER1` / `JW-301PU` と重なっていた。レビュー指摘・項目2）。
 * 単体テストが「ずらした後の2枚が重ならない」ことを数値で確かめられるよう、位置決めの式を
 * ここへ1つにまとめて公開する。
 */
export function nameplateRectMm(
  origin: Vec3,
  rect: AppearanceRect,
  offset: NameplateOffsetMm = NO_NAMEPLATE_OFFSET,
): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = origin.x + rect.x + offset.x;
  const y0 = origin.y + rect.y + offset.y;
  return { x0, y0, x1: x0 + rect.w, y1: y0 + rect.h };
}

/**
 * 銘板の下地の色。v2.1.0（監査 U3）
 *
 * 銘板は型式を本体の面へ直に印字する（`labels.ts` の `nameplateTexture()`）。字の色は下地の
 * 明るさで選ぶので、銘板の中心の下にある造作（FX5U の黒い前面パネルなど）の色を、無ければ
 * 筐体の色を返す。造作は後に書いたものほど手前に載る（`PlcFace` の描く順）ので後ろから探す。
 */
export function nameplateBackgroundColor(appearance: PlcAppearance): string {
  const { x, y, w, h } = appearance.nameplateRect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let index = appearance.features.length - 1; index >= 0; index -= 1) {
    const feature = appearance.features[index];
    if (feature === undefined) continue;
    const r = feature.rect;
    if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return feature.color;
  }
  return appearance.bodyColor;
}

/**
 * LEDが映す状態。決定表#20（v2.1.0 監査 P2 で改訂）
 *
 * 以前は「配線の情報は持たない」（`plcPowerIndependent` の判定結果を3Dから漏らさないため。
 * 3B 決定表#7）として POWER を常時点灯にしていたが、PLC の給電の可否は I/O割付の欄の
 * 「PLC電源：接続正常／電源の確認」ですでに出している。実機と同じく、給電されていなければ
 * どの表示灯も点かないようにする（`powered` は Worker の `plcPowerStatus().ready`）。
 */
export interface PlcLedState {
  /** PLC本体に給電されているか（壁コンセントの L・N から正しく）。 */
  powered: boolean;
  /** RUN 中か。 */
  running: boolean;
  /** 直前の変換が失敗したか。 */
  convertFailed: boolean;
  /** プログラムの無い PLC を RUN しようとしたか（ERR。v2.1.0 監査 P1）。 */
  noProgram: boolean;
  /** 実際の入力（給電されていないときは空。モニタの有無は問わない）。 */
  inputs: readonly boolean[] | undefined;
  /** 実際の出力。 */
  outputs: readonly boolean[] | undefined;
}

/** 本体表示LEDの名前 → 何を映すか。実機の印字は機種で違うので、名前で振り分ける。 */
function statusLit(name: string, state: PlcLedState): boolean {
  const upper = name.toUpperCase();
  if (upper === 'POWER' || upper === 'PWR') return true;
  if (upper === 'RUN' || upper === 'P.RUN') return state.running;
  if (upper === 'ERR' || upper === 'ERR/ALM' || upper === 'ERROR' || upper === 'FLT') {
    return state.convertFailed || state.noProgram;
  }
  // INH / PRPHL / BKUP（CP1E）は本アプリでは点灯しない（出力禁止・周辺通信・バックアップは扱わない）
  return false;
}

/**
 * 点灯しているLEDの鍵（`<group>:<name>`）。§10.1 / 決定表#20
 * 給電されていなければ何も点かない。給電中は POWER が点き、RUN は運転中、ERR は変換の失敗、
 * 入出力表示灯は**実際の入出力**を映す（モニタ中だけではない。v2.1.0 監査 P2）。
 */
export function litLedKeys(appearance: PlcAppearance, state: PlcLedState): Set<string> {
  const lit = new Set<string>();
  if (!state.powered) return lit;
  const counters: Record<PlcLedMark['group'], number> = { status: 0, input: 0, output: 0 };
  for (const led of appearance.leds) {
    const index = counters[led.group];
    counters[led.group] += 1;
    const on =
      led.group === 'status'
        ? statusLit(led.name, state)
        : led.group === 'input'
          ? (state.inputs?.[index] ?? false)
          : (state.outputs?.[index] ?? false);
    if (on) lit.add(`${led.group}:${led.name}`);
  }
  return lit;
}

/*
 * 消灯色は `@ojt/board-model` の `PLC_LED_OFF` が持つ（`three/**` に色を書かない。決定表#15。
 * 4B レビュー M7 で `LED_OFF_COLOR` をこのファイルから移した）。
 */

/**
 * 端子カバーを開く角度[°]。決定表#16（2026-09-26 改訂: 100° → 180°）
 * 本体の外側に平らに寝かせ、机上の電線（z ≥ 9.6mm）の通り道に板を立てない。100°で手前へ
 * 立てていたころは上から入る電線がカバーを突き抜けて見えた（2026-09-26 利用者報告）。
 * `@ojt/board-model` の `PLC_COVER_OPEN_DEG` と必ず同じ値にする（経路が避ける箱と揃える）。
 */
export const COVER_OPEN_DEG = 180;
/** 同じ角度[rad]。 */
export const COVER_OPEN_RAD = (COVER_OPEN_DEG * Math.PI) / 180;
/** 端子カバーの板厚[mm]。 */
export const COVER_THICKNESS_MM = 1;

/**
 * 開いた端子カバー1枚の姿勢。
 * 3Dは「蝶番の位置に置いた `group` を回し、その中に板を置く」形で描くので、
 * 回転の軸（＝蝶番）と、蝶番から見た板の中心をそれぞれ返す。
 */
export interface CoverPose {
  /** 蝶番の辺の中点（盤モデル mm）。 */
  hinge: Vec3;
  /** 蝶番まわりの回転[rad]（**シーン座標**の XYZ。`toScene()` 後の軸）。 */
  rotation: [number, number, number];
  /** 蝶番から見た板の中心（**シーン座標** mm・回転前）。 */
  offset: [number, number, number];
  /** 板の幅・高さ[mm]。 */
  w: number;
  h: number;
}

/**
 * 端子カバーを `hinge` の辺で開いた姿勢を求める。決定表#16
 *
 * `toScene()` は盤モデルの y を反転する（盤の手前 = シーンの −Y）ので、
 * 「上ヒンジのカバーは上へ、下ヒンジのカバーは下へ、いずれも手前（+Z）へ倒す」を
 * シーン座標の回転で書くとこうなる。左右ヒンジ（ラックのモジュール用）も同じ理屈である。
 *
 * @param origin 本体（ラックはモジュール）の左奥の角
 * @param cover `PlcAppearance.covers` の1枚
 * @param faceZMm 筐体の前面の高さ[mm]（ラックのベースだけ奥へ下げる）
 */
export function coverOpenPose(
  origin: Vec3,
  cover: PlcCoverMark,
  faceZMm = 0,
  openRad: number = COVER_OPEN_RAD,
): CoverPose {
  const { x, y, w, h } = cover.rect;
  const left = origin.x + x;
  const top = origin.y + y;
  const cx = left + w / 2;
  const cy = top + h / 2;
  switch (cover.hinge) {
    case 'top':
      return {
        hinge: { x: cx, y: top, z: faceZMm },
        rotation: [-openRad, 0, 0],
        offset: [0, -h / 2, 0],
        w,
        h,
      };
    case 'bottom':
      return {
        hinge: { x: cx, y: top + h, z: faceZMm },
        rotation: [openRad, 0, 0],
        offset: [0, h / 2, 0],
        w,
        h,
      };
    case 'left':
      return {
        hinge: { x: left, y: cy, z: faceZMm },
        rotation: [0, -openRad, 0],
        offset: [w / 2, 0, 0],
        w,
        h,
      };
    case 'right':
      return {
        hinge: { x: left + w, y: cy, z: faceZMm },
        rotation: [0, openRad, 0],
        offset: [-w / 2, 0, 0],
        w,
        h,
      };
  }
}

/** 盤モデル mm の矩形（左上 x0/y0・右下 x1/y1）。 */
export interface BoardRectMm {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 本体（ラックはモジュール1枚）が正面から見て占める矩形（盤モデル mm）。v2.1.0（監査 U3）
 *
 * 筐体の正面に、**開いた端子カバー**（蝶番から自由端まで）を足した外接矩形。FX5U・CP1E の
 * 下ヒンジのカバーは本体の下へ平らに寝るので、機種名の名札を本体の下端（`sizeMm.height`）の
 * すぐ下に置くと、開いたカバーと下段の出力端子の上に乗っていた。名札はこの矩形の外に置く。
 * 取り外したカバー（`open: 'removed'`）は描かないので数えない。
 */
export function plcVisualRectMm(origin: Vec3, appearance: PlcAppearance, faceZMm = 0): BoardRectMm {
  let x0 = origin.x;
  let y0 = origin.y;
  let x1 = origin.x + appearance.faceMm.width;
  let y1 = origin.y + appearance.faceMm.height;
  for (const cover of appearance.covers) {
    if (cover.open === 'removed') continue;
    const pose = coverOpenPose(origin, cover, faceZMm);
    const tip = coverOpenTip(pose);
    const left = origin.x + cover.rect.x;
    const top = origin.y + cover.rect.y;
    const horizontalHinge = cover.hinge === 'top' || cover.hinge === 'bottom';
    x0 = Math.min(x0, horizontalHinge ? left : Math.min(pose.hinge.x, tip.x));
    x1 = Math.max(x1, horizontalHinge ? left + cover.rect.w : Math.max(pose.hinge.x, tip.x));
    y0 = Math.min(y0, horizontalHinge ? Math.min(pose.hinge.y, tip.y) : top);
    y1 = Math.max(y1, horizontalHinge ? Math.max(pose.hinge.y, tip.y) : top + cover.rect.h);
  }
  return { x0, y0, x1, y1 };
}

/**
 * 開いたカバーの**自由端**（蝶番の反対側の辺の中点）の位置（盤モデル mm）。
 * 「カバーが端子の列や机上ケーブルの引き込みを塞いでいないこと」を単体テストで確かめるために、
 * 3Dの描画と同じ式からこの点を出す。
 */
export function coverOpenTip(pose: CoverPose): Vec3 {
  const [rx, ry] = pose.rotation;
  // 板の中心までの2倍＝自由端まで
  const [ox, oy, oz] = [pose.offset[0] * 2, pose.offset[1] * 2, pose.offset[2] * 2];
  // X軸まわり
  const y1 = oy * Math.cos(rx) - oz * Math.sin(rx);
  const z1 = oy * Math.sin(rx) + oz * Math.cos(rx);
  // Y軸まわり
  const x2 = ox * Math.cos(ry) + z1 * Math.sin(ry);
  const z2 = -ox * Math.sin(ry) + z1 * Math.cos(ry);
  // シーン座標の差分 → 盤モデルの差分（y だけ向きが逆）
  return { x: pose.hinge.x + x2, y: pose.hinge.y - y1, z: pose.hinge.z + z2 };
}
