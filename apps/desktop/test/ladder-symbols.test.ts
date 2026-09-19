import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  CELL_H,
  CELL_W,
  MC_SYMBOL_ID,
  MCR_SYMBOL_ID,
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
      expect(shape.paths.length).toBeGreaterThan(0);
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

  it('draws MC and MCR, which the profile does not name', () => {
    // `SymbolDrawing` に MC / MCR は無いので、本アプリ側の固定IDで引ける必要がある
    for (const id of [MC_SYMBOL_ID, MCR_SYMBOL_ID]) {
      const shape = symbolShape(id);
      expect(shape.paths.length).toBeGreaterThan(0);
      expect(shape.text).not.toBe('?');
    }
    expect(symbolShape(MC_SYMBOL_ID).text).toBe('MC');
    expect(symbolShape(MCR_SYMBOL_ID).text).toBe('MCR');
  });

  it('keeps the rung on the vertical middle of the cell', () => {
    expect(WIRE_Y).toBe(CELL_H / 2);
    expect(CELL_W).toBeGreaterThan(CELL_H);
  });
});
