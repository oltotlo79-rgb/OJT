import {
  COIL_COL,
  empty,
  endNetwork,
  network,
  no,
  out,
  program,
  set as setCoil,
  SP,
  SPECIAL_ALWAYS_ON,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import {
  JTEKT_PC10G,
  MITSUBISHI_FX5U,
  OMRON_CP1E,
  SHARP_JW300,
  type DialectProfile,
} from '@ojt/plc-dialects';
import { cleanup, render, screen, within } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LadderGrid } from '../src/renderer/ladder/LadderGrid.js';
import { skinThemeOf, SKIN_THEMES } from '../src/renderer/ladder/skins/index.js';
import { CELL_H, CELL_W, GX_CELL, symbolMetrics } from '../src/renderer/ladder/symbols.js';

// このリポジトリの UI テストの流儀（`globals: false` なので自動クリーンアップは効かない）。
afterEach(() => {
  cleanup();
});

/** テストの作業ディレクトリ（ルートからでも `apps/desktop` からでも動く）。 */
function readSource(rel: string): string {
  for (const base of [process.cwd(), resolve(process.cwd(), 'apps/desktop')]) {
    const path = resolve(base, rel);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(`${rel} が見つからない（cwd: ${process.cwd()}）`);
}

/** 1セルだけ置いたラダーをそのメーカーのスキンで描く。 */
function renderGrid(options: { profile: DialectProfile; cell: Cell; output?: Cell }): void {
  const sample = program(
    network('n1', [
      [options.cell, ...Array.from({ length: 14 }, () => empty()), options.output ?? out(Y(0))],
    ]),
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

describe('スキン別の記号の寸法と形（決定表#6 / 利用者要求 2026-09-20）', () => {
  it('keeps the GX Works3 numbers as the default', () => {
    const gx = symbolMetrics(GX_CELL);
    expect(gx.w).toBe(CELL_W);
    expect(gx.h).toBe(CELL_H);
    expect(gx.wireY).toBe(CELL_H / 2);
    expect(symbolMetrics(SKIN_THEMES['mitsubishi'].cell).w).toBe(48);
  });

  it('follows the theme for every skin', () => {
    expect(symbolMetrics(SKIN_THEMES['omron'].cell).w).toBe(52);
    expect(symbolMetrics(SKIN_THEMES['omron'].cell).h).toBe(60);
    expect(symbolMetrics(SKIN_THEMES['jtekt'].cell).w).toBe(46);
    expect(symbolMetrics(SKIN_THEMES['sharp'].cell).h).toBe(48);
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
      // 知らない識別子は `?` 付きの接点（landed の `symbolShape()` と同じ倒し方。`undefined` にしない）
      expect(metrics.shape('no-such-symbol').text, theme.id).toBe('?');
      // `END_MARK` と同じく**2本の縦棒の配列**である（1本の文字列ではない）
      expect(metrics.endMark, theme.id).toHaveLength(2);
      // 縦リンクはセルの**左辺**（landed の `LINK_DOWN` と同じ `M 0 …`）で、下端は `h + wireY`
      expect(metrics.linkDown, theme.id).toBe(
        `M 0 ${String(metrics.wireY)} L 0 ${String(metrics.h + metrics.wireY)}`,
      );
    }
  });

  /**
   * 利用者要求 2026-09-20「出力が四角や `()` で表されていて丸でないのはおかしい」。
   * **どのスキンでも** OUT コイルは丸で、半径はスキンの `coilRxPx`（＝縦棒の高さの半分）。
   */
  it('draws the OUT coil as a circle in every skin (利用者要求 2026-09-20)', () => {
    for (const theme of Object.values(SKIN_THEMES)) {
      const metrics = symbolMetrics(theme.cell);
      const coil = metrics.shape('coil-round');
      expect(coil.layout, theme.id).toBe('coil');
      expect(coil.paths, theme.id).toHaveLength(0);
      expect(coil.circle?.r, theme.id).toBe(theme.cell.coilRxPx);
      expect(coil.circle?.cy, theme.id).toBe(metrics.wireY);
      // 丸の直径は接点の縦棒の高さと同じ（接点と出力の大きさが揃う）
      expect((coil.circle?.r ?? 0) * 2, theme.id).toBe(metrics.barBottom - metrics.barTop);
    }
  });

  /**
   * 利用者要求 2026-09-20「A接点やB接点の縦棒の間隔がやや広い」。
   * どのスキンでも縦棒の間隔はセル幅の 15〜20% に収める。
   */
  it('keeps the contact gap at 15-20 percent of the cell width in every skin', () => {
    for (const theme of Object.values(SKIN_THEMES)) {
      const metrics = symbolMetrics(theme.cell);
      const ratio = metrics.contactGap / metrics.w;
      expect(ratio, theme.id).toBeGreaterThanOrEqual(0.15);
      expect(ratio, theme.id).toBeLessThanOrEqual(0.2);
      const xs = metrics
        .shape('contact-no')
        .paths.map((path) => Number(/^M ([\d.]+) /u.exec(path)?.[1] ?? '0'));
      expect((xs[1] ?? 0) - (xs[0] ?? 0), theme.id).toBe(metrics.contactGap);
    }
  });

  /** 記号の高さ（＝丸の直径）はセル高の 45〜55%（画面品質の基準）。 */
  it('keeps the symbol height between 45 and 55 percent of the cell in every skin', () => {
    for (const theme of Object.values(SKIN_THEMES)) {
      const metrics = symbolMetrics(theme.cell);
      const ratio = (metrics.barBottom - metrics.barTop) / metrics.h;
      expect(ratio, theme.id).toBeGreaterThanOrEqual(0.45);
      expect(ratio, theme.id).toBeLessThanOrEqual(0.55);
    }
  });

  /**
   * スキンごとの形の選択（Plan 4B 決定表#6 を利用者判断で緩めた結果）。
   * GX Works3風だけ角括弧＋丸コイルのタイマ、ほかの3スキンは命令ボックスである。
   */
  it('picks the instruction shape per skin', () => {
    const gx = symbolMetrics(SKIN_THEMES['mitsubishi'].cell);
    expect(gx.shape('coil-set').layout).toBe('bracket');
    expect(gx.shape('coil-timer').layout).toBe('coil');
    for (const id of ['omron', 'jtekt', 'sharp'] as const) {
      const metrics = symbolMetrics(SKIN_THEMES[id].cell);
      expect(metrics.shape('coil-set').layout, id).toBe('box');
      expect(metrics.shape('coil-timer').layout, id).toBe('box');
      expect(metrics.shape('rung-end').layout, id).toBe('box');
      // 箱は1本の閉じた矩形で、右には繋がない
      expect(metrics.shape('coil-timer').paths, id).toHaveLength(1);
      expect(metrics.shape('coil-timer').paths[0], id).toMatch(/Z$/u);
      expect(metrics.shape('coil-timer').leadRight, id).toBe('');
    }
  });

  /** モニタ中の見せ方もスキンが選ぶ（GX Works3風だけ帯、ほかはパワーフロー）。 */
  it('picks the monitor style per skin', () => {
    expect(SKIN_THEMES['mitsubishi'].monitorStyle).toBe('block');
    for (const id of ['omron', 'jtekt', 'sharp'] as const) {
      expect(SKIN_THEMES[id].monitorStyle, id).toBe('flow');
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
     * 終点は記号の枠の手前（4px）まで。コイル列が命令ボックスでも箱の中を横切らない。
     */
    expect(omron.leadAcrossHidden(4, 0)).toBe(`M ${String(5 * 52)} 30 L ${String(5 * 52 + 4)} 30`);
    // 行の `<g>` には移動が掛かっていないので、縦位置はこの線自身が持つ
    expect(omron.leadAcrossHidden(4, 2)).toContain(` ${String(2 * 60 + 30)} `);
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

/**
 * 画面に本当に出ている形（2026-09-20 の利用者指摘のあと）。`symbolMetrics()` の数だけでなく、
 * `LadderGrid` が描いた DOM でも「出力は丸」「命令は箱・角括弧」「行番号がある」ことを縛る。
 */
describe('描いた DOM（利用者要求 2026-09-20）', () => {
  it('renders the OUT coil as a <circle> in every skin', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      renderGrid({ profile, cell: no(X(0)) });
      const coil = screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`);
      const circle = coil.querySelector('circle[data-symbol]');
      expect(circle, profile.id).not.toBeNull();
      expect(circle?.getAttribute('data-symbol'), profile.id).toBe(profile.symbols.coil);
      // 丸で描くので、コイルのセルには記号のパスが1本も無い
      expect(coil.querySelectorAll('path[data-symbol]'), profile.id).toHaveLength(0);
      cleanup();
    }
  });

  it('writes the instruction word from the dialect inside the bracket or the box', () => {
    // GX Works3風は `[SET Y0]`
    renderGrid({ profile: MITSUBISHI_FX5U, cell: no(X(0)), output: setCoil(Y(0)) });
    expect(screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).toHaveTextContent(
      `${MITSUBISHI_FX5U.instructionNames.set} ${MITSUBISHI_FX5U.formatDevice(Y(0))}`,
    );
    expect(
      within(screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).getByTestId('frame-text'),
    ).toBeInTheDocument();
    cleanup();
    // CX-Programmer風は命令ボックス（1行目が命令語、2行目がデバイス）
    renderGrid({ profile: OMRON_CP1E, cell: no(X(0)), output: setCoil(Y(0)) });
    const box = within(screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`));
    expect(box.getByTestId('box-line-0')).toHaveTextContent(OMRON_CP1E.instructionNames.set);
    expect(box.getByTestId('box-line-1')).toHaveTextContent(OMRON_CP1E.formatDevice(Y(0)));
  });

  it('numbers every row in the left gutter', () => {
    renderGrid({ profile: MITSUBISHI_FX5U, cell: no(X(0)) });
    expect(screen.getByTestId('step-n1:0')).toHaveTextContent('0');
    // END の回路ブロックは n1 の次なので 1
    expect(screen.getByTestId('step-end:0')).toHaveTextContent('1');
  });

  /**
   * 色は**スキンだけ**が持つ（決定表#5）。描画の部品と `symbols.ts` に色は1つも書かない。
   */
  it('keeps every colour in skins/ (no hex in the drawing code)', () => {
    for (const rel of [
      'src/renderer/ladder/LadderGrid.tsx',
      'src/renderer/ladder/symbols.ts',
      'src/renderer/ladder/skins/index.ts',
    ]) {
      expect(readSource(rel), rel).not.toMatch(/#[0-9a-fA-F]{6}\b/u);
    }
    // SVG を描くクラスは `var(--skin-*)` だけを読む（素の色を書かない）
    const css = readSource('src/renderer/ladder/ladder.module.css').replace(
      /\/\*[\s\S]*?\*\//gu,
      '',
    );
    for (const name of ['rail', 'powered', 'poweredBlock', 'junction', 'stepText', 'commentText']) {
      const rule = new RegExp(String.raw`\.${name}[^{]*\{([^}]*)\}`, 'u').exec(css)?.[1] ?? '';
      expect(rule, name).not.toBe('');
      expect(rule.replace(/var\([^()]*\)/gu, ''), name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u);
    }
  });
});
