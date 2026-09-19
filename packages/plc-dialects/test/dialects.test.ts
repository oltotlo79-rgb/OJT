import { C, M, SP, T, X, Y, type Device } from '@ojt/ladder-core';
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

  it('names the panels and keeps the symbol drawings vendor-neutral (§17 / PLC調査資料 §6)', () => {
    expect(profile.panels.tree.trim().length).toBeGreaterThan(0);
    expect(profile.panels.editor.trim().length).toBeGreaterThan(0);
    expect(profile.panels.output.trim().length).toBeGreaterThan(0);
    expect(profile.panels.toolbar.length).toBeGreaterThan(0);
    for (const value of Object.values(profile.symbols)) expect(value).toMatch(/^[a-z-]+$/u);
    expect(profile.displayName).toContain('風');
  });
});
