import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

/**
 * ビューキューブに貼る**絵**を焼く。設計仕様 §12.2 / 2026-09-19 の利用者要望
 * 「3Dのキューブのデザインがシンプルすぎる」。
 *
 * 面の名札・座標軸の球・ボタンの絵記号・ツールチップを、すべて 2D キャンバスへ一度だけ描いて
 * テクスチャにする。焼くのは**マウント時の1回だけ**で、`ViewGizmo` が unmount で解放する
 * （drei の `GizmoViewcube` は親の再描画のたびに焼き直していた。§15）。
 *
 * 1x / 2x どちらの画面でも文字がぼけないよう、**実寸の2倍以上の解像度**で焼いて
 * `LinearFilter` と異方性フィルタを掛ける（`anisotropy` は three が GPU の上限で丸める）。
 * 色は `SRGBColorSpace` を明示する。指定しないと three は線形として扱い、
 * 焼いた色より明るく出る（面と文字のコントラスト比の前提が崩れる。§12.2 の色の検査）。
 *
 * テスト環境（happy-dom）には 2D コンテキストが無いので、描けなくても**必ずテクスチャを返す**
 * （名札が出ないだけで形は出る）。
 */

/** 画面文言と同じ和文フォント。§15（`global.css` の `font-family` に合わせる）。 */
const GIZMO_FONT = "'Noto Sans JP', 'Yu Gothic UI', 'Meiryo', system-ui, sans-serif";

/** 面に焼くキャンバスの1辺[px]。面の実寸（96px の 76%）に対しておよそ3.4倍。 */
export const FACE_TEXTURE_PX = 256;

/** 座標軸の球に焼くキャンバスの1辺[px]（実寸 15px に対して4倍）。 */
export const BALL_TEXTURE_PX = 64;

/** ボタンに焼くキャンバスの1辺[px]（実寸 28px に対して約4.6倍）。 */
export const BUTTON_TEXTURE_PX = 128;

/** ツールチップの文字の高さ[px]（実寸）。焼くときは2倍で描く。 */
export const TOOLTIP_FONT_PX = 12;

/** テクスチャを焼くときの拡大率（1x/2x どちらの画面でもぼけない最低ライン）。 */
export const TEXTURE_SCALE = 2;

/** 2Dコンテキストを取り出す（無い環境では `null`）。 */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** 指定の大きさのキャンバスを作る。 */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** キャンバス → テクスチャ（拡大しても文字が締まる設定を入れる）。 */
function finishTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** 角の丸い矩形の輪郭を引く（`roundRect` が無い環境でも動く）。 */
function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

/** 面の名札の色づかい。 */
export interface GizmoFacePaint {
  /** 名札（`正面` など）。 */
  label: string;
  /** 面の地の色（下側）。 */
  base: string;
  /** 面の地の色（上側。わずかに明るくして曇り空の陰影を作る）。 */
  highlight: string;
  /** 面のふちの細い線。 */
  rim: string;
  /** 文字の色。 */
  text: string;
}

/**
 * 面のテクスチャ（薄いグラデーション＋内側の細いふち＋名札）。
 *
 * 以前は単色の地に黒い太枠で、6面とも同じ平板に見えていた（利用者要望）。
 * 上を明るく下を暗くした縦のグラデーションと、内側に1本だけ通した明るいふちで
 * 「板が嵌まっている」ように見せる。
 */
export function bakeFaceTexture(paint: GizmoFacePaint): CanvasTexture {
  const size = FACE_TEXTURE_PX;
  const canvas = makeCanvas(size, size);
  const context = context2d(canvas);
  if (context !== null) {
    const gradient = context.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, paint.highlight);
    gradient.addColorStop(1, paint.base);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    // 内側の細いふち（面の境目が分かるだけの太さにとどめる）
    const inset = size * 0.045;
    context.lineWidth = Math.max(1, size * 0.016);
    context.strokeStyle = paint.rim;
    roundedRectPath(context, inset, inset, size - inset * 2, size - inset * 2, size * 0.05);
    context.stroke();

    // 名札。1文字（右・左・上・下）は大きく、2文字（正面・背面）は収まる大きさに
    const fontPx = Math.round(size * (paint.label.length > 1 ? 0.28 : 0.42));
    context.font = `600 ${String(fontPx)}px ${GIZMO_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // 文字の下に薄い影を敷くと、明るい盤に重なっても字が沈まない
    context.fillStyle = 'rgba(8, 11, 16, 0.45)';
    context.fillText(paint.label, size / 2, size / 2 + Math.max(1, size * 0.008));
    context.fillStyle = paint.text;
    context.fillText(paint.label, size / 2, size / 2);
  }
  return finishTexture(canvas);
}

/** 座標軸の球の色づかい。 */
export interface GizmoBallPaint {
  /** 軸の文字（X / Y / Z）。負の向きには焼かない。 */
  letter: string;
  /** 軸の色。 */
  color: string;
  /** 正の向きか（負は中を抜いて暗くする＝Blender と同じ）。 */
  positive: boolean;
  /** 文字の色。 */
  text: string;
}

/**
 * 座標軸の球のテクスチャ（正＝塗り＋軸名、負＝輪郭だけの暗い球）。
 * 手前・奥どちらを向いているかが色の濃さで分かる。
 */
export function bakeAxisBallTexture(paint: GizmoBallPaint): CanvasTexture {
  const size = BALL_TEXTURE_PX;
  const canvas = makeCanvas(size, size);
  const context = context2d(canvas);
  if (context !== null) {
    const center = size / 2;
    const radius = size * 0.46;
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    if (paint.positive) {
      const gradient = context.createRadialGradient(
        center - radius * 0.3,
        center - radius * 0.35,
        radius * 0.1,
        center,
        center,
        radius,
      );
      gradient.addColorStop(0, '#FFFFFF');
      gradient.addColorStop(0.35, paint.color);
      gradient.addColorStop(1, paint.color);
      context.fillStyle = gradient;
    } else {
      context.fillStyle = 'rgba(20, 24, 32, 0.78)';
    }
    context.fill();
    context.lineWidth = Math.max(1, size * 0.055);
    context.strokeStyle = paint.color;
    context.stroke();
    if (paint.positive) {
      context.font = `700 ${String(Math.round(size * 0.46))}px ${GIZMO_FONT}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = paint.text;
      context.fillText(paint.letter, center, center + size * 0.02);
    }
  }
  return finishTexture(canvas);
}

/** ボタンの絵記号の種類（⌂ 全体表示 / ⟳ 傾き戻し）。 */
export type GizmoButtonIcon = 'home' | 'reset';

/** ボタンの色づかい。 */
export interface GizmoButtonPaint {
  icon: GizmoButtonIcon;
  /** 丸い地の色。 */
  base: string;
  /** ふちの色。 */
  rim: string;
  /** 絵記号の色。 */
  ink: string;
}

/**
 * ボタンのテクスチャ（暗い丸＋細いふち＋絵記号）。
 *
 * 絵記号は**線で描く**（`⌂` `⟳` の字体はフォント任せで、環境によっては豆腐になる）。
 * 家＝全体表示、回る矢印＝傾きを戻す。
 */
export function bakeButtonTexture(paint: GizmoButtonPaint): CanvasTexture {
  const size = BUTTON_TEXTURE_PX;
  const canvas = makeCanvas(size, size);
  const context = context2d(canvas);
  if (context !== null) {
    const center = size / 2;
    const radius = size * 0.45;
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fillStyle = paint.base;
    context.fill();
    context.lineWidth = Math.max(1, size * 0.028);
    context.strokeStyle = paint.rim;
    context.stroke();

    context.strokeStyle = paint.ink;
    context.fillStyle = paint.ink;
    context.lineWidth = Math.max(1.5, size * 0.062);
    context.lineJoin = 'round';
    context.lineCap = 'round';
    const unit = size * 0.2;
    if (paint.icon === 'home') {
      // 屋根（三角）と本体（四角）
      context.beginPath();
      context.moveTo(center - unit * 1.15, center - unit * 0.05);
      context.lineTo(center, center - unit * 1.15);
      context.lineTo(center + unit * 1.15, center - unit * 0.05);
      context.stroke();
      context.beginPath();
      context.moveTo(center - unit * 0.8, center + unit * 0.1);
      context.lineTo(center - unit * 0.8, center + unit * 1.05);
      context.lineTo(center + unit * 0.8, center + unit * 1.05);
      context.lineTo(center + unit * 0.8, center + unit * 0.1);
      context.stroke();
    } else {
      // 円弧＋矢じり（時計回りに戻す）
      const r = unit * 1.0;
      context.beginPath();
      context.arc(center, center, r, Math.PI * 0.75, Math.PI * 2.15);
      context.stroke();
      const tip = Math.PI * 0.75;
      const tx = center + r * Math.cos(tip);
      const ty = center + r * Math.sin(tip);
      context.beginPath();
      context.moveTo(tx, ty);
      context.lineTo(tx - unit * 0.1, ty - unit * 0.62);
      context.lineTo(tx + unit * 0.6, ty - unit * 0.2);
      context.closePath();
      context.fill();
    }
  }
  return finishTexture(canvas);
}

/** ツールチップのテクスチャと、画面上で使う実寸。 */
export interface GizmoTooltip {
  texture: CanvasTexture;
  /** 画面上の幅[px]。 */
  width: number;
  /** 画面上の高さ[px]。 */
  height: number;
}

/**
 * ボタンのツールチップ（角の丸い暗い札＋日本語1行）。
 * 文字幅が測れない環境（happy-dom）では和文1文字＝1em として見積もる。
 */
export function bakeTooltipTexture(text: string, ink: string, base: string): GizmoTooltip {
  const fontPx = TOOLTIP_FONT_PX * TEXTURE_SCALE;
  const font = `500 ${String(fontPx)}px ${GIZMO_FONT}`;
  const padding = fontPx * 0.7;
  const probe = context2d(makeCanvas(8, 8));
  let textWidth = text.length * fontPx * 0.95;
  if (probe !== null) {
    probe.font = font;
    const measured = probe.measureText(text).width;
    if (measured > 0) textWidth = measured;
  }
  const width = Math.ceil(textWidth + padding * 2);
  const height = Math.ceil(fontPx + padding);
  const canvas = makeCanvas(width, height);
  const context = context2d(canvas);
  if (context !== null) {
    roundedRectPath(context, 0.5, 0.5, width - 1, height - 1, height * 0.3);
    context.fillStyle = base;
    context.fill();
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = ink;
    context.fillText(text, width / 2, height / 2);
  }
  return {
    texture: finishTexture(canvas),
    width: width / TEXTURE_SCALE,
    height: height / TEXTURE_SCALE,
  };
}
