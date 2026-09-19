import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  CELL_H,
  CELL_W,
  END_SYMBOL_ID,
  GX_CELL,
  MC_SYMBOL_ID,
  MCR_SYMBOL_ID,
  symbolMetrics,
  symbolShape,
  WIRE_Y,
} from '../src/renderer/ladder/symbols.js';

/**
 * プロファイルが名指す記号の識別子。`SymbolDrawing` は索引を持たない interface なので、
 * `Object.values()` をそのまま呼ぶと `any[]` になる（`no-unsafe-argument`）。一度展開してから回す。
 */
const PROFILE_SYMBOL_IDS: readonly string[] = Object.values<string>({
  ...MITSUBISHI_FX5U.symbols,
});

/** `M x y L x y …` から座標を取り出す。 */
function points(path: string): number[] {
  return [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)/gu)].flatMap((m) => [Number(m[1]), Number(m[2])]);
}

describe('記号の線画（§10.6 / §17: ベンダーの画像は持たない）', () => {
  it('draws every symbol the Mitsubishi profile names', () => {
    for (const id of PROFILE_SYMBOL_IDS) {
      const shape = symbolShape(id);
      // 丸コイルは `paths` を持たず `circle` で描く（利用者要求 2026-09-20）
      expect(shape.paths.length + (shape.circle === undefined ? 0 : 1), id).toBeGreaterThan(0);
    }
  });

  it('keeps the drawings local (no urls, no image references)', () => {
    for (const id of PROFILE_SYMBOL_IDS) {
      for (const path of symbolShape(id).paths) {
        expect(path).not.toMatch(/https?:|url\(|\.png|\.svg/iu);
        expect(path).toMatch(/^[MLAmlazZ0-9\s,.-]+$/u);
      }
    }
  });

  it('falls back to a question mark for an unknown identifier', () => {
    const shape = symbolShape('contact-quantum');
    expect(shape.text).toBe('?');
    expect(shape.paths.length).toBeGreaterThan(0);
  });

  /**
   * 利用者要求 2026-09-20「出力が四角や `()` で表されていて丸でないのはおかしい」。
   * OUT コイルは**丸**で、桟の上に中心があり、直径は接点の縦棒の高さと同じである。
   */
  it('draws the OUT coil as a circle centred on the rung (利用者要求 2026-09-20)', () => {
    const coil = symbolShape(MITSUBISHI_FX5U.symbols.coil);
    expect(coil.layout).toBe('coil');
    expect(coil.paths).toHaveLength(0);
    expect(coil.circle).toBeDefined();
    expect(coil.circle?.cy).toBe(WIRE_Y);
    const metrics = symbolMetrics(GX_CELL);
    expect((coil.circle?.r ?? 0) * 2).toBe(metrics.barBottom - metrics.barTop);
    // 導線は円の縁で止まる（円の中を線が横切らない）
    expect(coil.leadLeft).toBe(`M 0 ${String(WIRE_Y)} L ${String(24 - 6)} ${String(WIRE_Y)}`);
    expect(coil.leadRight).toBe(
      `M ${String(24 + 6)} ${String(WIRE_Y)} L ${String(CELL_W)} ${String(WIRE_Y)}`,
    );
  });

  /**
   * 利用者要求 2026-09-20（2回目）「2本の縦線の間隔がまだ広い」と、そのあと利用者が示した
   * 三菱の命令記号表。表の比は**間隔＝縦棒の高さの約半分**（表の実測は 10 : 16）。
   */
  it('keeps the contact gap at about half the bar height (利用者の記号表)', () => {
    const metrics = symbolMetrics(GX_CELL);
    const barH = metrics.barBottom - metrics.barTop;
    expect(metrics.contactGap).toBe(6);
    expect(metrics.contactGap / barH).toBeGreaterThanOrEqual(0.45);
    expect(metrics.contactGap / barH).toBeLessThanOrEqual(0.6);
    const bars = symbolShape(MITSUBISHI_FX5U.symbols.no).paths;
    expect(bars).toHaveLength(2);
    const xs = bars.map((path) => Number(/^M ([\d.]+) /u.exec(path)?.[1] ?? '0'));
    expect((xs[1] ?? 0) - (xs[0] ?? 0)).toBe(metrics.contactGap);
  });

  /** 線は 1.2px（利用者要求 2026-09-20 2回目「縦線がやや太い」）。 */
  it('draws the symbols and the wires with a 1.2px stroke', () => {
    expect(GX_CELL.strokeWidth).toBe(1.2);
  });

  /**
   * 利用者要求 2026-09-20「B接点シンボルの斜め線の位置おかしいんだけど」＋利用者が示した
   * 三菱の命令記号表（LDI / ANI）。斜線は1本で、**縦棒2本の x の範囲を左右に貫き**
   * （左の縦棒の足の左下から右の縦棒の頭の右上へ）、縦は縦棒の上端・下端の内側に収まる。
   */
  it('runs one NC diagonal across both bars, inside the bar height', () => {
    const nc = symbolShape(MITSUBISHI_FX5U.symbols.nc);
    expect(nc.paths).toHaveLength(3);
    const metrics = symbolMetrics(GX_CELL);
    const barX = symbolShape(MITSUBISHI_FX5U.symbols.no).paths.map((path) =>
      Number(/^M ([\d.]+) /u.exec(path)?.[1] ?? '0'),
    );
    const [x1, y1, x2, y2] = points(nc.paths[2] ?? '');
    // 左下 → 右上で、両端は縦棒より外（縦棒の高さの 10〜30% ぶん）
    expect(x1).toBeLessThan(barX[0] ?? 0);
    expect(x2).toBeGreaterThan(barX[1] ?? 0);
    expect(y1).toBeGreaterThan(y2 ?? 0);
    // 中心はセルの中央・桟の上
    expect(((x1 ?? 0) + (x2 ?? 0)) / 2).toBeCloseTo(CELL_W / 2, 1);
    expect(((y1 ?? 0) + (y2 ?? 0)) / 2).toBeCloseTo(WIRE_Y, 1);
    // 縦は縦棒の上端・下端を越えない（デバイス名にもコメントにも触れない）
    expect(y2).toBeGreaterThanOrEqual(metrics.barTop);
    expect(y1).toBeLessThanOrEqual(metrics.barBottom);
  });

  /**
   * 利用者要求 2026-09-20 2回目「立上がり・立下がりのデザイン」と記号表（LDP / LDF）。
   * 矢印は**線画**（フォントの `↑` / `↓` ではない）で、軸の高さは縦棒と同じ。矢じりが
   * 読めるよう、微分接点だけ間隔を広げてよい。
   */
  it('draws the pulse arrow as lines, as tall as the bars', () => {
    const metrics = symbolMetrics(GX_CELL);
    expect(metrics.pulseGap).toBeGreaterThanOrEqual(metrics.contactGap);
    // 軸は縦棒と同じ高さ（記号表の比）
    const shaft = points(symbolShape(MITSUBISHI_FX5U.symbols.rise).paths[2] ?? '');
    expect(Math.abs((shaft[1] ?? 0) - (shaft[3] ?? 0))).toBe(metrics.barBottom - metrics.barTop);
    for (const id of [MITSUBISHI_FX5U.symbols.rise, MITSUBISHI_FX5U.symbols.fall]) {
      const shape = symbolShape(id);
      // 縦棒2本＋矢印の軸＋矢じり
      expect(shape.paths, id).toHaveLength(4);
      expect(shape.text, id).toBeUndefined();
      const xs = shape.paths
        .slice(0, 2)
        .map((path) => Number(/^M ([\d.]+) /u.exec(path)?.[1] ?? '0'));
      expect((xs[1] ?? 0) - (xs[0] ?? 0), id).toBe(metrics.pulseGap);
      // 矢印は縦棒の高さの中に収まる
      for (const y of [...points(shape.paths[2] ?? ''), ...points(shape.paths[3] ?? '')].filter(
        (_unused, index) => index % 2 === 1,
      )) {
        expect(y, id).toBeGreaterThanOrEqual(metrics.barTop);
        expect(y, id).toBeLessThanOrEqual(metrics.barBottom);
      }
    }
    // 立上がりの矢じりは上端、立下がりは下端
    const riseHead = points(symbolShape(MITSUBISHI_FX5U.symbols.rise).paths[3] ?? '');
    const fallHead = points(symbolShape(MITSUBISHI_FX5U.symbols.fall).paths[3] ?? '');
    expect(riseHead[3]).toBeLessThan(WIRE_Y);
    expect(fallHead[3]).toBeGreaterThan(WIRE_Y);
  });

  /** GX Works3風は SET / RST / MC / MCR / END を角括弧 `[SET Y0]` で出す。 */
  it('draws the Mitsubishi instructions in square brackets', () => {
    for (const id of [
      MITSUBISHI_FX5U.symbols.set,
      MITSUBISHI_FX5U.symbols.rst,
      MC_SYMBOL_ID,
      MCR_SYMBOL_ID,
      END_SYMBOL_ID,
    ]) {
      const shape = symbolShape(id);
      expect(shape.layout, id).toBe('bracket');
      expect(shape.paths, id).toHaveLength(2);
      // 角括弧と箱は右に繋がない（回路の終わりなので）
      expect(shape.leadRight, id).toBe('');
    }
  });

  /** タイマ・カウンタは GX Works3風だけ丸コイル（`OUT T0 K30`）。 */
  it('draws the Mitsubishi timer and counter as the circle coil', () => {
    for (const id of [MITSUBISHI_FX5U.symbols.timer, MITSUBISHI_FX5U.symbols.counter]) {
      expect(symbolShape(id).layout, id).toBe('coil');
      expect(symbolShape(id).circle, id).toBeDefined();
    }
  });

  it('keeps the rung on the vertical middle of the cell', () => {
    expect(WIRE_Y).toBe(CELL_H / 2);
    expect(CELL_W).toBeGreaterThan(CELL_H / 2);
  });

  /**
   * 縦棒（＝丸コイルの直径）の高さは**セル高の 35〜40%**（利用者要求 2026-09-20 2回目。
   * 1回目は 45〜55% だったが「実画面ではもっと小さい」との指摘で詰めた）。
   */
  it('keeps the symbol height between 35 and 40 percent of the cell', () => {
    const metrics = symbolMetrics(GX_CELL);
    expect(metrics.barBottom - metrics.barTop).toBe(12);
    const ratio = (metrics.barBottom - metrics.barTop) / CELL_H;
    expect(ratio).toBeGreaterThanOrEqual(0.35);
    expect(ratio).toBeLessThanOrEqual(0.4);
  });

  /** 行は詰める（利用者要求 2026-09-20 2回目「各社ソフトの実画面にもっと寄せる」）。 */
  it('keeps the row tight and the step gutter narrow', () => {
    expect(CELL_H).toBeGreaterThanOrEqual(32);
    expect(CELL_H).toBeLessThanOrEqual(36);
    expect(symbolMetrics(GX_CELL).stepGutter).toBe(24);
    // 分岐の接合点は ⌀4px
    expect(symbolMetrics(GX_CELL).junctionR * 2).toBe(4);
  });
});
