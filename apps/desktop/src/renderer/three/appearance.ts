// `labels.ts` も `FaceRect` を export している（別の形）。読み手が迷わないよう別名で読む（決定表#19）
import type { FaceRect as AppearanceRect, PlcAppearance, PlcLedMark, Vec3 } from '@ojt/board-model';

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

/**
 * LEDが映す状態。決定表#20
 * **配線の情報は持たない**（`plcPowerIndependent` の判定結果を3Dから漏らさないため。
 * 3B 決定表#7）。本アプリのPLCはAC電源を電気的に解かないので、`POWER` は常時点灯である。
 */
export interface PlcLedState {
  /** RUN 中か。 */
  running: boolean;
  /** 直前の変換が失敗したか。 */
  convertFailed: boolean;
  /** モニタ中の入力（モニタでないときは `undefined`）。 */
  inputs: readonly boolean[] | undefined;
  /** モニタ中の出力。 */
  outputs: readonly boolean[] | undefined;
}

/** 本体表示LEDの名前 → 何を映すか。実機の印字は機種で違うので、名前で振り分ける。 */
function statusLit(name: string, state: PlcLedState): boolean {
  const upper = name.toUpperCase();
  if (upper === 'POWER' || upper === 'PWR') return true;
  if (upper === 'RUN' || upper === 'P.RUN') return state.running;
  if (upper === 'ERR' || upper === 'ERROR' || upper === 'FLT') return state.convertFailed;
  return false;
}

/**
 * 点灯しているLEDの鍵（`<group>:<name>`）。§10.1 / 決定表#20
 * 入出力表示灯は**モニタ中だけ**光る（`SimSnapshot.plc` はモニタ中しか載らない。3B 決定表#5）。
 */
export function litLedKeys(appearance: PlcAppearance, state: PlcLedState): Set<string> {
  const lit = new Set<string>();
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

/** 消灯しているLEDの色（点灯色を暗く見せる代わりに、共通の暗色を使う）。 */
export const LED_OFF_COLOR = '#4A4F58';
