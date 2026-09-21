import type { TimeChart } from '@ojt/content';

/**
 * タイムチャートの目盛・補助線の計算（Task CHART-UX）。設計仕様 §7.7 / §8.3。
 *
 * 描画（`TimeChartView.tsx`）から純粋計算だけを切り出す。小さいチャートと拡大表示、
 * セッション画面と結果画面が同じ目盛・同じ吸い付き規則を使うための唯一の出どころ。
 */

/** チャート1枚の寸法（SVG の viewBox 単位）。 */
export interface ChartGeometry {
  /** 左のラベル欄の幅。 */
  labelWidth: number;
  /** 波形を描く幅。 */
  plotWidth: number;
  /** 1信号ぶんの高さ。 */
  rowHeight: number;
  /** 波形の振幅（論理1のときに持ち上げる高さ）。 */
  amplitude: number;
  /** 信号名の文字サイズ。 */
  labelFont: number;
  /** 時間軸の目盛ラベルの文字サイズ。 */
  tickFont: number;
  /** 右の余白（最後の目盛ラベルがはみ出さないぶん）。 */
  rightPad: number;
  /** 上の余白。 */
  topPad: number;
  /** 時間軸ラベルの帯の高さ。 */
  axisHeight: number;
  /**
   * 目盛ラベルを何本おきに出すか（1なら全部）。
   * 小さいチャートは目盛線こそ全部立てるが、ラベルまで全部出すと数字が潰れるので間引く。§7.7
   */
  labelStride: number;
  /**
   * 操作の変化点の破線（`figure.edges`）を立てる本数の上限。指定しなければ無制限。
   * 小さいチャートは幅が狭く、破線だらけの課題（b-007 など）だと読めなくなるので絞る。§7.7
   */
  maxEdgeLines?: number;
}

/** 右パネル・結果画面に埋め込む小さいチャート。従来の寸法をそのまま引き継ぐ。 */
export const SMALL_GEOMETRY: ChartGeometry = {
  labelWidth: 136,
  plotWidth: 300,
  rowHeight: 28,
  amplitude: 14,
  labelFont: 12,
  tickFont: 12,
  rightPad: 26,
  topPad: 6,
  axisHeight: 24,
  labelStride: 1,
  maxEdgeLines: 10,
};

/** 拡大表示（1枚のチャート）。信号名は 17（拡大時の実寸で 14px 以上）。 */
export const LARGE_GEOMETRY: ChartGeometry = {
  labelWidth: 210,
  plotWidth: 900,
  rowHeight: 74,
  amplitude: 46,
  labelFont: 17,
  tickFont: 15,
  rightPad: 40,
  topPad: 8,
  axisHeight: 34,
  labelStride: 1,
};

/** 拡大表示（期待と実際を積む結果画面用）。行数が倍になるので行を詰める。 */
export const LARGE_STACKED_GEOMETRY: ChartGeometry = {
  ...LARGE_GEOMETRY,
  rowHeight: 33,
  amplitude: 16,
};

/** 目盛の刻み候補[ms]（1・2・5 × 10^n）。§7.7 */
export const TICK_STEPS_MS: readonly number[] = [
  10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000,
];

/** 目盛の本数の上限（これ以下で最も細かい刻みを選ぶ）。 */
export const MAX_TICKS = 12;

/** 吸い付きの許容幅[px]（画面上の距離）。 */
export const SNAP_TOLERANCE_PX = 6;

/**
 * 区間長から「きりの良い」目盛の刻みを選ぶ。§7.7
 * 目盛が `maxTicks` 本以下に収まる候補のうち最も細かいものを返すので、
 * 5〜12本くらいの読みやすい密度になる（候補が 1・2・5 刻みなので比は最大2.5倍）。
 */
export function niceTickStep(durationMs: number, maxTicks: number = MAX_TICKS): number {
  const last = TICK_STEPS_MS[TICK_STEPS_MS.length - 1] ?? 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return TICK_STEPS_MS[0] ?? 10;
  const limit = Math.max(2, maxTicks);
  for (const step of TICK_STEPS_MS) {
    if (durationMs / step <= limit - 1) return step;
  }
  return last;
}

/** 目盛の時刻[ms]を0から区間長まで並べる。§7.7 */
export function tickPositions(durationMs: number, maxTicks: number = MAX_TICKS): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  const step = niceTickStep(durationMs, maxTicks);
  const out: number[] = [];
  // 浮動小数の誤差で最後の目盛が落ちないよう、本数で回して掛け算で作る
  const count = Math.floor(durationMs / step + 1e-9);
  for (let i = 0; i <= count; i += 1) out.push(i * step);
  return out;
}

/** 時刻の読み（`1.23 s`）。カーソルのチップと差分一覧で同じ形にする。§8.3 */
export function timeReadout(tMs: number): string {
  return `${(tMs / 1000).toFixed(2)} s`;
}

/** 目盛ラベル（`1.0 s`）。刻みが0.1秒未満なら小数2桁にする。 */
export function tickLabel(tMs: number, stepMs: number): string {
  const digits = stepMs < 100 ? 2 : 1;
  return `${(tMs / 1000).toFixed(digits)} s`;
}

/**
 * いちばん近い候補に吸い付かせる。許容幅の外なら `undefined`。
 * 同じ距離なら先に来る候補（＝候補列の順）を選ぶ（決定論）。
 */
export function nearestSnap(
  tMs: number,
  candidatesMs: readonly number[],
  toleranceMs: number,
): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidatesMs) {
    const distance = Math.abs(candidate - tMs);
    if (distance <= toleranceMs && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** 変化時刻を集める（区間の先頭0と終端は変化点ではないので除く）。 */
function transitionsOf(chart: TimeChart, inputsOnly: boolean): number[] {
  const out: number[] = [];
  for (const signal of chart.signals) {
    if (inputsOnly && signal.kind !== 'input') continue;
    for (const segment of signal.segments) {
      if (segment.fromMs > 0 && segment.fromMs < chart.durationMs) out.push(segment.fromMs);
    }
  }
  for (const marker of chart.markers) {
    if (marker.tMs > 0 && marker.tMs <= chart.durationMs) out.push(marker.tMs);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * チャート上の変化時刻（全信号の立ち上がり・立ち下がりと印）。§7.7
 * カーソルの吸い付き候補に使う。
 */
export function edgeTimes(chart: TimeChart): number[] {
  return transitionsOf(chart, false);
}

/**
 * 操作の変化時刻（押ボタンなど入力信号の押す・離すと印）。§7.7
 * ここに縦の破線を立てる。出力（ランプ）の変化まで破線にすると線だらけになるので入れない。
 */
export function operationEdgeTimes(chart: TimeChart): number[] {
  return transitionsOf(chart, true);
}

/** 時刻[ms] → SVG の x 座標。 */
export function msToX(tMs: number, durationMs: number, geom: ChartGeometry): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return geom.labelWidth;
  const clamped = Math.min(Math.max(tMs, 0), durationMs);
  return geom.labelWidth + (clamped / durationMs) * geom.plotWidth;
}

/** SVG の x 座標 → 時刻[ms]（描画域の外は端で止める）。 */
export function xToMs(x: number, durationMs: number, geom: ChartGeometry): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || geom.plotWidth <= 0) return 0;
  const ratio = (x - geom.labelWidth) / geom.plotWidth;
  return Math.min(Math.max(ratio, 0), 1) * durationMs;
}

/** チャート1枚の viewBox 幅。 */
export function chartWidth(geom: ChartGeometry): number {
  return geom.labelWidth + geom.plotWidth + geom.rightPad;
}

/** 字を縮めず波形の幅を合わせる。幅の小さい欄では目盛の本数を描画側で減らす。 */
export function fitChartGeometry(base: ChartGeometry, width?: number, scale = 1): ChartGeometry {
  const labelWidth = base.labelWidth * scale;
  const rightPad = base.rightPad * scale;
  return {
    ...base,
    labelWidth,
    rightPad,
    plotWidth: Math.max(80, (width ?? chartWidth(base) * scale) - labelWidth - rightPad),
    labelFont: Math.max(12, base.labelFont * scale),
    tickFont: Math.max(12, base.tickFont * scale),
    rowHeight: Math.max(24, base.rowHeight * scale),
    amplitude: base.amplitude * scale,
    axisHeight: base.axisHeight * scale,
    topPad: base.topPad * scale,
  };
}

/** 行数から viewBox の高さを求める（時間軸の帯を含む）。 */
export function chartHeight(rowCount: number, geom: ChartGeometry): number {
  return geom.topPad + rowCount * geom.rowHeight + geom.axisHeight;
}
