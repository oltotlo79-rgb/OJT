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

  it('binds the rule-line and line-delete keys, and leaves no key inert (Phase 7 §5.2)', () => {
    const entry = (action: string): ShortcutEntry | undefined =>
      skin.shortcuts.find((s) => s.action === action);
    expect(entry('rule-line')?.keys).toBe('Ctrl+←↑↓→');
    // Phase 7 Task 20: 罫線の削除を足した（出典 S1）
    expect(entry('delete-hline')?.keys).toBe('Ctrl+F9');
    expect(entry('delete-vline')?.keys).toBe('Ctrl+F10');
    // 微分接点（出典 S2。一次資料が個人の記事なので △）
    expect(entry('pulse-rise')?.keys).toBe('Shift+F7');
    expect(entry('pulse-fall')?.keys).toBe('Shift+F8');
    expect(entry('pulse-rise')?.confirmed).toBe(false);
    // 指摘 LE-8: 応用命令（`F8`）は「応用命令」欄へつながったので、効かない行はもう無い
    expect(entry('application')?.enabled).toBeUndefined();
    expect(skin.shortcuts.filter((s) => s.enabled === false)).toHaveLength(0);
  });

  it('marks which shortcuts come from a primary source and which are assumptions (§17.1)', () => {
    const entry = (action: string): ShortcutEntry | undefined =>
      skin.shortcuts.find((s) => s.action === action);
    // 記号のキーは S1、モードのキーは S3 で裏が取れている（Phase 7 設計 §5.7）
    for (const action of ['contact-no', 'contact-nc', 'coil', 'application', 'hline', 'vline']) {
      expect(entry(action)?.confirmed, action).toBe(true);
      expect(entry(action)?.source, action).toBe('S1');
    }
    for (const action of ['convert', 'write-mode', 'read-mode', 'monitor']) {
      expect(entry(action)?.confirmed, action).toBe(true);
      expect(entry(action)?.source, action).toBe('S3');
    }
    // 裏が取れていないのは微分接点の2行だけ（記事1本しか無いので △ のまま）
    const assumed = skin.shortcuts.filter((s) => !s.confirmed).map((s) => s.action);
    expect(assumed).toEqual(['pulse-rise', 'pulse-fall']);
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

  it('shortcut table invariants: unique actions/keys, exactly one enabled:false, no vendor strings outside displayName', () => {
    const actions = skin.shortcuts.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
    const keys = skin.shortcuts.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(skin.shortcuts.filter((s) => s.enabled === false)).toHaveLength(0);
    const skinText = [
      skin.panels.tree,
      skin.panels.editor,
      skin.panels.output,
      ...skin.panels.toolbar,
      ...skin.shortcuts.map((s) => s.label),
      ...Object.values(skin.errorMessages),
    ].join('|');
    expect(skinText).not.toMatch(/GX|MELSEC|三菱|Mitsubishi/iu);
    expect(skin.displayName).toContain('風');
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
