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
    expect(coil.leadLeft).toBe(`M 0 ${String(WIRE_Y)} L ${String(24 - 11)} ${String(WIRE_Y)}`);
    expect(coil.leadRight).toBe(
      `M ${String(24 + 11)} ${String(WIRE_Y)} L ${String(CELL_W)} ${String(WIRE_Y)}`,
    );
  });

  /**
   * 利用者要求 2026-09-20「A接点やB接点の縦棒の間隔がやや広い」。
   * 縦棒の間隔はセル幅の 15〜20%。
   */
  it('keeps the contact bars close together (利用者要求 2026-09-20)', () => {
    const metrics = symbolMetrics(GX_CELL);
    expect(metrics.contactGap / CELL_W).toBeGreaterThanOrEqual(0.15);
    expect(metrics.contactGap / CELL_W).toBeLessThanOrEqual(0.2);
    const bars = symbolShape(MITSUBISHI_FX5U.symbols.no).paths;
    const xs = bars.map((path) => Number(/^M ([\d.]+) /u.exec(path)?.[1] ?? '0'));
    expect((xs[1] ?? 0) - (xs[0] ?? 0)).toBe(metrics.contactGap);
  });

  it('draws the NC diagonal across exactly the bars and the gap', () => {
    const nc = symbolShape(MITSUBISHI_FX5U.symbols.nc);
    expect(nc.paths).toHaveLength(3);
    const metrics = symbolMetrics(GX_CELL);
    const left = Math.round((CELL_W - metrics.contactGap) / 2);
    expect(nc.paths[2]).toBe(
      `M ${String(left)} ${String(metrics.barBottom)} L ${String(left + metrics.contactGap)} ${String(metrics.barTop)}`,
    );
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

  /** 縦棒（＝丸コイルの直径）の高さはセル高の 45〜55%（画面品質の基準）。 */
  it('keeps the symbol height between 45 and 55 percent of the cell', () => {
    const metrics = symbolMetrics(GX_CELL);
    const ratio = (metrics.barBottom - metrics.barTop) / CELL_H;
    expect(ratio).toBeGreaterThanOrEqual(0.45);
    expect(ratio).toBeLessThanOrEqual(0.55);
  });
});
