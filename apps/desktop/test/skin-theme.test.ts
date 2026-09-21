import { availableDialects, DIALECT_IDS, getDialect } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import {
  SKIN_THEMES,
  skinCssVars,
  skinThemeOf,
  statusItemsOf,
} from '../src/renderer/ladder/skins/index.js';

describe('SkinTheme（利用者要求: 実物に近い回路入力画面 / §10.6 / §17.1）', () => {
  it('has one theme per dialect', () => {
    expect(Object.keys(SKIN_THEMES).sort()).toEqual([...DIALECT_IDS].sort());
    for (const profile of availableDialects()) {
      expect(skinThemeOf(profile).id, profile.id).toBe(profile.id);
    }
  });

  it('keeps the 風 suffix and no vendor product screenshot in the title bar (§17.1)', () => {
    for (const profile of availableDialects()) {
      const theme = skinThemeOf(profile);
      expect(theme.titleBar, profile.id).toMatch(/風$/u);
      expect(theme.titleBar.length).toBeLessThanOrEqual(24);
    }
    expect(skinThemeOf(getDialect('mitsubishi')).titleBar).toBe('MELSOFT GX Works3 風');
    expect(skinThemeOf(getDialect('omron')).titleBar).toBe('CX-Programmer 風');
    expect(skinThemeOf(getDialect('jtekt')).titleBar).toBe('PCwin 風');
    expect(skinThemeOf(getDialect('sharp')).titleBar).toBe('JW-300SP 風');
  });

  it('gives every theme a full, distinct colour set', () => {
    for (const theme of Object.values(SKIN_THEMES)) {
      for (const [key, value] of Object.entries(theme.colors)) {
        expect(value, `${theme.id}.${key}`).toMatch(/^#[0-9A-F]{6}$/u);
      }
      expect(theme.cell.widthPx).toBeGreaterThanOrEqual(40);
      expect(theme.cell.heightPx).toBeGreaterThanOrEqual(30);
      expect(theme.assumed.length).toBeGreaterThan(0);
    }
    // 公式画面が同じ白地なら、差別化のために色を変えない。
    expect(SKIN_THEMES.omron.colors.canvas).toBe('#FFFFFF');
    expect(SKIN_THEMES.sharp.colors.canvas).toBe('#FFFFFF');
  });

  it('matches the powered colour to the dialect (§10.6)', () => {
    for (const profile of availableDialects()) {
      expect(skinThemeOf(profile).colors.powered, profile.id).toBe(profile.monitorColors.powered);
    }
  });

  it('shows the output pane as a status bar only in the PCwin style (§10.6)', () => {
    expect(skinThemeOf(getDialect('jtekt')).layout.outputPane).toBe('status-bar');
    for (const id of ['mitsubishi', 'omron', 'sharp'] as const) {
      expect(skinThemeOf(getDialect(id)).layout.outputPane, id).toBe('window');
    }
  });

  /**
   * Phase 7 設計 §5.5: ステータスバーの項目の源は `SkinTheme.statusItems`（見た目）から
   * `DialectProfile.panels.status`（そのメーカーのツールの画面構成）へ移した。画面は
   * `statusItemsOf()` を通して引くので、ここもそれで確かめる。
   */
  it('lists the status bar items each tool shows', () => {
    expect(statusItemsOf(getDialect('mitsubishi'))).toEqual(['mode', 'network', 'overwrite']);
    expect(statusItemsOf(getDialect('omron'))).toEqual(['mode', 'plc-state', 'scan']);
    expect(statusItemsOf(getDialect('jtekt'))).toEqual([
      'mode',
      'plc-state',
      'scan',
      'device-count',
    ]);
    expect(statusItemsOf(getDialect('sharp'))).toEqual(['mode', 'network', 'plc-state']);
  });
});

describe('CSS 変数への変換（決定表#5）', () => {
  it('turns every colour and size into a --skin-* custom property', () => {
    const omron = getDialect('omron');
    const vars = skinCssVars(omron, skinThemeOf(omron), '#FF00AA');
    expect(vars['--skin-canvas']).toBe('#FFFFFF');
    expect(vars['--skin-rail']).toBe('#1F1F1F');
    expect(vars['--skin-cell-w']).toBe('52px');
    expect(vars['--skin-cell-h']).toBe('48px');
    expect(vars['--skin-stroke']).toBe('1.2');
    // `--skin-coil-rx` は**丸コイルの半径**（利用者要求 2026-09-20 で丸括弧をやめた）
    expect(vars['--skin-coil-rx']).toBe('9');
    // コメントの字の大きさもスキンが決める（CX-Programmer風だけ2行なので 8px）
    expect(vars['--skin-comment-size']).toBe('8px');
    expect(vars['--skin-step-gutter']).toBe('24px');
    // 出力ウィンドウの高さもスキンが決める（`window` でも `status-bar` でも同じ変数。I11）
    expect(vars['--skin-output-h']).toBe('140px');
    // 設定画面の通電色は方言の色を上書きする（決定表#8）
    expect(vars['--skin-powered']).toBe('#FF00AA');
    expect(Object.keys(vars).every((key) => key.startsWith('--skin-'))).toBe(true);
  });

  it('falls back to the dialect colour when the setting is empty', () => {
    const jtekt = getDialect('jtekt');
    const vars = skinCssVars(jtekt, skinThemeOf(jtekt), '');
    expect(vars['--skin-powered']).toBe('#E08A1E');
  });
});
