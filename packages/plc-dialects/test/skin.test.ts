import { describe, expect, it } from 'vitest';
import { MAX_GRID_COLS, MIN_GRID_COLS, MITSUBISHI_FX5U, type ShortcutEntry } from '../src/index.js';

const skin = MITSUBISHI_FX5U;

describe('GX Works3風スキン（§10.6）', () => {
  it('requires the conversion step (§10.6 の操作フロー)', () => {
    expect(skin.convertStep).toBe(true);
  });

  it('shows 11 contact columns and the Mitsubishi monitor colour (§10.6 の本アプリ既定)', () => {
    expect(skin.gridCols).toBe(11);
    expect(skin.gridCols).toBeGreaterThanOrEqual(MIN_GRID_COLS);
    expect(skin.gridCols).toBeLessThanOrEqual(MAX_GRID_COLS);
    expect(skin.monitorColors.powered).toBe('#1E64FF');
  });

  it('binds F5 / F7 / F4 as §16 Phase 3 の受入基準① requires', () => {
    const keysOf = (action: string): string | undefined =>
      skin.shortcuts.find((s) => s.action === action)?.keys;
    expect(keysOf('contact-no')).toBe('F5');
    expect(keysOf('coil')).toBe('F7');
    expect(keysOf('convert')).toBe('F4');
    expect(keysOf('contact-nc')).toBe('F6');
    expect(keysOf('or-contact-no')).toBe('Shift+F5');
    expect(keysOf('toggle-no-nc')).toBe('/');
  });

  it('binds the rule-line keys and disables the one instruction Phase 3 cannot place (§10.7)', () => {
    const entry = (action: string): ShortcutEntry | undefined =>
      skin.shortcuts.find((s) => s.action === action);
    expect(entry('rule-line')?.keys).toBe('Ctrl+←↑↓→');
    // 応用命令は IR にセル種別が無いので表には出すが押せない
    expect(entry('application')?.enabled).toBe(false);
    expect(entry('application')?.note).toContain('Phase 4');
    // それ以外は既定（`enabled` を書かない＝使える）
    expect(skin.shortcuts.filter((s) => s.enabled === false)).toHaveLength(1);
  });

  it('marks which shortcuts come from a primary source and which are assumptions (§17.1)', () => {
    const confirmed = skin.shortcuts.filter((s) => s.confirmed).map((s) => s.keys);
    const assumed = skin.shortcuts.filter((s) => !s.confirmed).map((s) => s.keys);
    expect(confirmed).toContain('F5');
    expect(confirmed).toContain('F7');
    expect(assumed).toContain('F4');
    expect(assumed).toContain('F6');
  });

  it('names the instructions of §10.5 / §17 #21', () => {
    expect(skin.instructionNames.ld).toBe('LD');
    expect(skin.instructionNames.ldi).toBe('LDI');
    expect(skin.instructionNames.out).toBe('OUT');
    expect(skin.instructionNames.pulseUp).toBe('PLS');
    expect(skin.instructionNames.pulseDown).toBe('PLF');
    expect(skin.instructionNames.timer).toBe('OUT T');
    expect(skin.instructionNames.counter).toBe('OUT C');
  });

  it('lists the three GX Works3 panels without borrowing any vendor artwork (§17 / PLC調査資料 §6)', () => {
    expect(skin.panels.tree).toContain('ナビゲーション');
    expect(skin.panels.editor).toContain('ラダー');
    expect(skin.panels.output).toContain('出力');
    expect(skin.panels.toolbar).toContain('オンライン');
    expect(skin.panels.toolbar).toContain('シーケンサへの書込み');
    expect(skin.panels.toolbar.length).toBeGreaterThan(0);
    // 記号定義は自前の線画の識別子だけを持つ（画像ファイル名やロゴを含まない）
    for (const value of Object.values(skin.symbols)) {
      expect(value).toMatch(/^[a-z-]+$/u);
    }
  });
});
