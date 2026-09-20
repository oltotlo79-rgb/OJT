import { C, M, SP, T, X, Y, type Device, type DeviceKind } from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import {
  availableDialects,
  DIALECT_IDS,
  IMPLEMENTED_DIALECT_IDS,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  type DialectProfile,
} from '../src/index.js';

const profiles = availableDialects();
const cases = profiles.map((profile) => [profile.id, profile] as const);

describe('4方言が揃っている（§16 Phase 4）', () => {
  it('implements every vendor of 決定事項#14', () => {
    expect(IMPLEMENTED_DIALECT_IDS).toEqual([...DIALECT_IDS]);
    expect(profiles.map((p) => p.id)).toEqual([...DIALECT_IDS]);
  });

  it('requires the conversion step in the Mitsubishi and Sharp skins only (§10.6)', () => {
    // 変換ありは GX Works3風 と JW-300SP風 の2つ。CX-Programmer風・PCwin風は画面編集で完結する
    const withConvert = profiles.filter((p) => p.convertStep).map((p) => p.id);
    expect(withConvert.sort()).toEqual(['mitsubishi', 'sharp']);
  });

  it('gives every skin its own monitor colour (§10.6 の本アプリ既定)', () => {
    const colours = profiles.map((p) => p.monitorColors.powered);
    expect(colours).toEqual(['#1E64FF', '#E08A1E', '#2FA02C', '#00A0C8']);
    expect(new Set(colours).size).toBe(colours.length);
  });
});

describe.each(cases)('%s プロファイルの不変条件', (_id, profile: DialectProfile) => {
  it('shows 11 contact columns inside the settings bounds (§10.6)', () => {
    expect(profile.gridCols).toBe(11);
    expect(profile.gridCols).toBeGreaterThanOrEqual(MIN_GRID_COLS);
    expect(profile.gridCols).toBeLessThanOrEqual(MAX_GRID_COLS);
  });

  it('maps the three special devices of §10.3', () => {
    expect(Object.keys(profile.specialDevices).sort()).toEqual(['0', '1', '2']);
    for (const index of [0, 1, 2]) {
      expect(profile.formatDevice(SP(index)).length).toBeGreaterThan(0);
    }
    for (const index of profile.specialInverted ?? []) {
      expect(profile.specialDevices[index]).toBeDefined();
    }
  });

  it('round-trips every device kind through formatDevice and parseDevice (§10.7 表記切替)', () => {
    const samples: Device[] = [X(0), X(1), Y(0), Y(1), M(0), T(0), C(0), SP(0), SP(1), SP(2)];
    for (const target of samples) {
      const text = profile.formatDevice(target);
      expect(profile.parseDevice(text), `${profile.id}: ${text}`).toEqual(target);
    }
  });

  it('round-trips every value of every device kind, not just a sample (A-M6)', () => {
    const kinds = (Object.keys(profile.deviceRanges) as DeviceKind[]).filter(
      (kind) => kind !== 'special',
    );
    for (const kind of kinds) {
      const range = profile.deviceRanges[kind];
      for (let index = range.min; index <= range.max; index += 1) {
        const target: Device = { kind, index };
        const text = profile.formatDevice(target);
        expect(profile.parseDevice(text), `${profile.id} ${kind}: ${text}`).toEqual(target);
      }
    }
  });

  it('round-trips a 3 s timer preset', () => {
    const preset = profile.timerPreset(3000, T(0));
    expect(preset, profile.id).not.toBeInstanceOf(Error);
    if (preset instanceof Error) return;
    expect(profile.parseTimerPreset(preset.text, T(0))).toBe(3000);
  });

  it('names all 24 instructions without an empty string', () => {
    const names = Object.values(profile.instructionNames);
    expect(names).toHaveLength(24);
    for (const name of names) expect(name.trim().length).toBeGreaterThan(0);
  });

  it('has a Japanese message for every error code and a unique shortcut table', () => {
    for (const message of Object.values(profile.errorMessages)) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
    const actions = profile.shortcuts.map((s) => s.action);
    const keys = profile.shortcuts.map((s) => s.keys);
    expect(new Set(actions).size).toBe(actions.length);
    expect(new Set(keys).size).toBe(keys.length);
    // 「変換」の行は convertStep のスキンにしか無い（決定表#5）
    expect(profile.shortcuts.some((s) => s.action === 'convert')).toBe(profile.convertStep);
  });

  /*
   * Phase 7 Task 20（決定 D6）: キー割当表そのものの不変条件。
   * 「キーが実際に効くか」は `ladderKeyToAction()` が `apps/desktop` にあるので
   * `apps/desktop/test/ladder-editor.test.tsx` の網羅検査が見る（依存の向きが逆なので、
   * このパッケージからは import できない）。ここは表の書き方だけを縛る。
   */
  it('backs every row with either a source or a note, and explains every disabled row', () => {
    for (const entry of profile.shortcuts) {
      // △（一次資料で裏が取れていない）の行は、出典か理由のどちらかを必ず持つ
      if (!entry.confirmed) {
        expect(
          entry.note !== undefined || entry.source !== undefined,
          `${profile.id}/${entry.action} に note も source もありません`,
        ).toBe(true);
      }
      // ◎ の行の出典は S1〜S8 の記号（`docs/reference/ladder-skin-sources.md`）
      if (entry.source !== undefined) expect(entry.source).toMatch(/^S[1-8]$/u);
      // 押しても効かない行は、なぜ効かないのかを必ず書く（指摘 LE-8）
      if (entry.enabled === false) {
        expect((entry.note ?? '').trim().length, `${profile.id}/${entry.action}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('never claims a primary source for a key map borrowed from another vendor (§17.1)', () => {
    // 流用した表（PCwin風・JW-300SP風）は全行が △ で、借り元の出典を自分の裏づけにしない
    if (profile.id !== 'jtekt' && profile.id !== 'sharp') return;
    for (const entry of profile.shortcuts) {
      expect(entry.confirmed, `${profile.id}/${entry.action}`).toBe(false);
      expect(entry.source, `${profile.id}/${entry.action}`).toBeUndefined();
      expect(entry.note ?? '').toContain('本アプリの表記です');
    }
  });

  it('never offers a monitor key it cannot back (指摘 LE-7)', () => {
    // CX-Programmer風は実機の「モニタ」キーを確認できていないので、行そのものを作らない
    if (profile.id !== 'omron') return;
    expect(profile.shortcuts.some((s) => s.action === 'monitor')).toBe(false);
  });

  it('names the panels and keeps the symbol drawings vendor-neutral (§17 / PLC調査資料 §6)', () => {
    expect(profile.panels.tree.trim().length).toBeGreaterThan(0);
    expect(profile.panels.editor.trim().length).toBeGreaterThan(0);
    expect(profile.panels.output.trim().length).toBeGreaterThan(0);
    expect(profile.panels.toolbar.length).toBeGreaterThan(0);
    for (const value of Object.values(profile.symbols)) expect(value).toMatch(/^[a-z-]+$/u);
    expect(profile.displayName).toContain('風');
  });
});

/** 半角ASCIIの1文字を対応する全角（U+FF01〜U+FF5E）へ変える。テスト用（NFKCの逆方向）。 */
function toFullWidth(ascii: string): string {
  return [...ascii]
    .map((char) => {
      const code = char.codePointAt(0);
      if (code === undefined || code < 0x21 || code > 0x7e) return char;
      return String.fromCodePoint(code + 0xfee0);
    })
    .join('');
}

/**
 * 全角入力を読む（指摘 PD-1）。
 *
 * 4方言とも `trim()` ＋ `toUpperCase()` だけで全角を正規化せず、日本語IMEの既定入力
 * （`Ｘ０`・`Ｋ３０`）を必ず弾いていた。`normalizeDeviceText()`（`NFKC` 正規化）を
 * `parseDevice` / `parseTimerPreset` / `parseCounterPreset` の先頭に通すことで、各方言自身の
 * 表記（三菱 `X0`・OMRON `0.00`・JTEKT `1X000`・シャープ `000000`）の全角版が読めるようになる。
 */
describe.each(cases)('%s: 全角入力（指摘 PD-1）', (_id, profile: DialectProfile) => {
  it('parseDevice() reads the full-width form of the dialect notation', () => {
    const text = profile.formatDevice(X(0));
    expect(profile.parseDevice(toFullWidth(text))).toEqual(profile.parseDevice(text));
  });

  it('parseTimerPreset() reads the full-width form of the dialect notation', () => {
    const preset = profile.timerPreset(3000, T(0));
    expect(preset).not.toBeInstanceOf(Error);
    if (preset instanceof Error) return;
    expect(profile.parseTimerPreset(toFullWidth(preset.text), T(0))).toBe(
      profile.parseTimerPreset(preset.text, T(0)),
    );
  });

  it('parseCounterPreset() reads the full-width form of the dialect notation', () => {
    const text = profile.counterPresetText?.(5);
    if (text === undefined) return;
    expect(profile.parseCounterPreset?.(toFullWidth(text))).toBe(
      profile.parseCounterPreset?.(text),
    );
  });
});
