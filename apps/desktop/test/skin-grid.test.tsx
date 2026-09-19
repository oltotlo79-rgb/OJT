import {
  empty,
  endNetwork,
  network,
  no,
  out,
  program,
  SP,
  SPECIAL_ALWAYS_ON,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { MITSUBISHI_FX5U, SHARP_JW300, type DialectProfile } from '@ojt/plc-dialects';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LadderGrid } from '../src/renderer/ladder/LadderGrid.js';
import { skinThemeOf, SKIN_THEMES } from '../src/renderer/ladder/skins/index.js';
import { CELL_H, CELL_W, GX_CELL, symbolMetrics } from '../src/renderer/ladder/symbols.js';

// このリポジトリの UI テストの流儀（`globals: false` なので自動クリーンアップは効かない）。
afterEach(() => {
  cleanup();
});

/** 1セルだけ置いたラダーをそのメーカーのスキンで描く。 */
function renderGrid(options: { profile: DialectProfile; cell: Cell }): void {
  const sample = program(
    network('n1', [[options.cell, ...Array.from({ length: 14 }, () => empty()), out(Y(0))]]),
    endNetwork(),
  );
  render(
    <LadderGrid
      program={sample}
      profile={options.profile}
      theme={skinThemeOf(options.profile)}
      cursor={{ networkId: 'n1', row: 0, col: 0 }}
      mode="write"
      comments={{}}
      errorCells={new Set<string>()}
      gridCols={options.profile.gridCols}
      onPickCell={() => undefined}
    />,
  );
}

describe('スキン別の記号の寸法（決定表#6）', () => {
  it('keeps the GX Works3 numbers as the default', () => {
    const gx = symbolMetrics(GX_CELL);
    expect(gx.w).toBe(CELL_W);
    expect(gx.h).toBe(CELL_H);
    expect(gx.wireY).toBe(CELL_H / 2);
    expect(symbolMetrics(SKIN_THEMES['mitsubishi'].cell).w).toBe(48);
  });

  it('follows the theme for every skin', () => {
    expect(symbolMetrics(SKIN_THEMES['omron'].cell).w).toBe(52);
    expect(symbolMetrics(SKIN_THEMES['omron'].cell).h).toBe(40);
    expect(symbolMetrics(SKIN_THEMES['jtekt'].cell).w).toBe(46);
    expect(symbolMetrics(SKIN_THEMES['sharp'].cell).h).toBe(38);
  });

  it('draws the same two bars for an NO contact in every skin, at the skin size', () => {
    for (const theme of Object.values(SKIN_THEMES)) {
      const metrics = symbolMetrics(theme.cell);
      const shape = metrics.shape('contact-no');
      expect(shape.paths, theme.id).toHaveLength(2);
      for (const path of shape.paths) {
        // 縦棒は `M x top L x bottom` の形で、上下の余白はスキンの `barInsetPx`
        expect(path, theme.id).toMatch(
          new RegExp(`^M [\\d.]+ ${String(theme.cell.barInsetPx)} L [\\d.]+ `, 'u'),
        );
      }
      expect(metrics.shape('contact-nc').paths).toHaveLength(3);
      expect(metrics.shape('coil-round').paths).toHaveLength(2);
      expect(metrics.shape('coil-set').text).toBe('S');
      // 知らない識別子は `?` 付きの接点（landed の `symbolShape()` と同じ倒し方。`undefined` にしない）
      expect(metrics.shape('no-such-symbol').text, theme.id).toBe('?');
      // `END_MARK` と同じく**2本の縦棒の配列**である（1本の文字列ではない）
      expect(metrics.endMark, theme.id).toHaveLength(2);
      // 縦リンクはセルの**左辺**（landed の `LINK_DOWN` と同じ `M 0 …`）で、下端は `h + wireY`
      expect(metrics.linkDown, theme.id).toBe(
        `M 0 ${String(metrics.wireY)} L 0 ${String(metrics.h + metrics.wireY)}`,
      );
      // コイルの弧の `rx` はスキンの `coilRxPx`
      expect(metrics.shape('coil-round').paths[0], theme.id).toContain(
        `A ${String(theme.cell.coilRxPx)} `,
      );
    }
  });

  it('returns the same object for the same cell (memoised, so `memo` keeps working)', () => {
    expect(symbolMetrics(SKIN_THEMES['omron'].cell)).toBe(symbolMetrics(SKIN_THEMES['omron'].cell));
  });

  it('bridges the hidden columns from the coil column, at the right row', () => {
    const omron = symbolMetrics(SKIN_THEMES['omron'].cell);
    /*
     * landed の `leadAcrossHidden(lastContactIndex, row)` と**同じ2引数・同じ規則**である
     * （3B 最終修正）。始点は「コイル列の左端」＝ `(lastContactIndex + 1) × セル幅` で、
     * 終点は記号の左端まで。最後の接点セルの絵の上をオーバーレイが横切らない。
     */
    expect(omron.leadAcrossHidden(4, 0)).toBe(`M ${String(5 * 52)} 20 L ${String(5 * 52 + 17)} 20`);
    // 行の `<g>` には移動が掛かっていないので、縦位置はこの線自身が持つ
    expect(omron.leadAcrossHidden(4, 2)).toContain(` ${String(2 * 40 + 20)} `);
  });

  it('draws the SHARP always-on special relay as an NC contact (4A H-4)', () => {
    expect(SHARP_JW300.specialInverted).toContain(SPECIAL_ALWAYS_ON);
    renderGrid({ profile: SHARP_JW300, cell: no(SP(SPECIAL_ALWAYS_ON)) });
    expect(screen.getByTestId('cell-n1:0:0').querySelector('path[data-symbol]')).toHaveAttribute(
      'data-symbol',
      SHARP_JW300.symbols.nc,
    );
    // 他の3方言は a接点のまま
    cleanup();
    renderGrid({ profile: MITSUBISHI_FX5U, cell: no(SP(SPECIAL_ALWAYS_ON)) });
    expect(screen.getByTestId('cell-n1:0:0').querySelector('path[data-symbol]')).toHaveAttribute(
      'data-symbol',
      MITSUBISHI_FX5U.symbols.no,
    );
  });
});
