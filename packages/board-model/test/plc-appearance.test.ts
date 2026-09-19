import { describe, expect, it } from 'vitest';
import { PLC_LED_GREEN, PLC_LED_RED, PLC_UNITS, type PlcAppearance } from '../src/index.js';

/** 外観記述1件（本体またはモジュール）とその名前。 */
const faces: [string, PlcAppearance][] = Object.values(PLC_UNITS).flatMap((unit) => [
  [unit.model, unit.appearance] as [string, PlcAppearance],
  ...(unit.modules ?? []).map(
    (m) => [`${unit.model}/${m.model}`, m.appearance] as [string, PlcAppearance],
  ),
]);

describe('PlcAppearance（3Dが外観を描くための記述）', () => {
  it('exists for every catalogue unit and every rack module', () => {
    // 本体4機種＋TOYOPUC 4枚＋JW300 4枚
    expect(faces.length).toBe(4 + 4 + 4);
    for (const [name, face] of faces) {
      expect(face.faceMm.width, name).toBeGreaterThan(0);
      expect(face.faceMm.height, name).toBeGreaterThan(0);
      expect(face.bodyColor, name).toMatch(/^#[0-9A-F]{6}$/u);
      expect(face.terminalBlockColor, name).toMatch(/^#[0-9A-F]{6}$/u);
      expect(face.nameplate.trim().length, name).toBeGreaterThan(0);
    }
  });

  it('keeps every rect inside the face', () => {
    for (const [name, face] of faces) {
      const rects = [
        face.nameplateRect,
        ...face.covers.map((c) => c.rect),
        ...face.leds.map((l) => l.rect),
        ...face.features.map((f) => f.rect),
      ];
      for (const rect of rects) {
        expect(rect.x, name).toBeGreaterThanOrEqual(0);
        expect(rect.y, name).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, name).toBeLessThanOrEqual(face.faceMm.width);
        expect(rect.y + rect.h, name).toBeLessThanOrEqual(face.faceMm.height);
      }
    }
  });

  it('matches the unit face to the unit size (§10.1 のカタログ寸法)', () => {
    for (const unit of Object.values(PLC_UNITS)) {
      expect(unit.appearance.faceMm, unit.model).toEqual({
        width: unit.sizeMm.width,
        height: unit.sizeMm.height,
      });
      for (const module of unit.modules ?? []) {
        expect(module.appearance.faceMm, module.model).toEqual({
          width: module.sizeMm.width,
          height: module.sizeMm.height,
        });
      }
    }
  });

  it('puts only the model string on the nameplate — no logo, no brand (§17 / PLC調査資料 §6)', () => {
    for (const [name, face] of faces) {
      expect(face.nameplate, name).not.toMatch(
        /三菱|MITSUBISHI|MELSEC|OMRON|オムロン|JTEKT|ジェイテクト|TOYOPUC|SHARP|シャープ/iu,
      );
      expect(face.nameplate, name).toMatch(/^[0-9A-Z][0-9A-Z./-]*$/u);
    }
  });

  it('marks which appearance values are assumptions (§17.1)', () => {
    for (const [name, face] of faces) {
      expect(face.assumed.length, name).toBeGreaterThan(0);
      for (const item of face.assumed) expect(item.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives FX5U its status LEDs, hinged covers and front features (§10.1)', () => {
    const fx5u = PLC_UNITS['FX5U']?.appearance;
    expect(fx5u?.nameplate).toBe('FX5U-32MR/ES');
    expect(fx5u?.leds.filter((l) => l.group === 'status').map((l) => l.name)).toEqual([
      'PWR',
      'ERR',
      'P.RUN',
      'BAT',
      'CARD',
    ]);
    expect(fx5u?.leds.filter((l) => l.group === 'input')).toHaveLength(16);
    expect(fx5u?.leds.filter((l) => l.group === 'output')).toHaveLength(16);
    expect(fx5u?.covers.map((c) => c.hinge)).toEqual(['top', 'bottom']);
    expect(fx5u?.features.map((f) => f.id)).toEqual(['run-stop', 'ethernet', 'sd-card']);
  });

  it('colours the confirmed FX5U status LEDs and the assumed CP1E/JW300 fault LEDs red (§10.1 / B1)', () => {
    const colorOf = (appearance: PlcAppearance | undefined, name: string): string | undefined =>
      appearance?.leds.find((l) => l.name === name)?.color;
    // §10.1 で確定: PWR(緑) / ERR(赤) / P.RUN(緑) / BAT(赤) / CARD(緑)
    expect(colorOf(PLC_UNITS['FX5U']?.appearance, 'PWR')).toBe(PLC_LED_GREEN);
    expect(colorOf(PLC_UNITS['FX5U']?.appearance, 'ERR')).toBe(PLC_LED_RED);
    expect(colorOf(PLC_UNITS['FX5U']?.appearance, 'P.RUN')).toBe(PLC_LED_GREEN);
    expect(colorOf(PLC_UNITS['FX5U']?.appearance, 'BAT')).toBe(PLC_LED_RED);
    expect(colorOf(PLC_UNITS['FX5U']?.appearance, 'CARD')).toBe(PLC_LED_GREEN);
    // 【本アプリの前提】CP1E の ERR/ALM と JW300 の FLT を赤とした
    expect(colorOf(PLC_UNITS['CP1E']?.appearance, 'ERR')).toBe(PLC_LED_RED);
    expect(colorOf(PLC_UNITS['CP1E']?.appearance, 'ALM')).toBe(PLC_LED_RED);
    const jw312cu = PLC_UNITS['JW-300']?.modules?.find((m) => m.model === 'JW-312CU')?.appearance;
    expect(colorOf(jw312cu, 'FLT')).toBe(PLC_LED_RED);
    expect(colorOf(jw312cu, 'RUN')).toBe(PLC_LED_GREEN);
  });

  it('derives unit.leds from the status LEDs in the appearances instead of a hand-written list (I1)', () => {
    for (const unit of Object.values(PLC_UNITS)) {
      const derived = [unit.appearance, ...(unit.modules ?? []).map((m) => m.appearance)]
        .flatMap((a) => a.leds)
        .filter((l) => l.group === 'status')
        .map((l) => l.name);
      expect(unit.leds, unit.model).toEqual(derived);
    }
    // 以前の手書き値のバグをピン留めする: PC10G は無い `IN` を含み、JW300 は `POWER` を落としていた
    expect(PLC_UNITS['PC10G-1SP']?.leds).toEqual(['POWER', 'RUN', 'ERR']);
    expect(PLC_UNITS['JW-300']?.leds).toEqual(['POWER', 'RUN', 'FLT', 'MW']);
  });

  it('gives the rack bases their own assumed list without the false terminal-cover claim (§17.1 / M2)', () => {
    for (const model of ['PC10G-1SP', 'JW-300']) {
      const unit = PLC_UNITS[model];
      expect(unit?.appearance.covers, model).toEqual([]);
      expect(
        unit?.appearance.assumed.some((s) => s.includes('端子台カバー')),
        model,
      ).toBe(false);
    }
  });

  it('shrinks the rack base slot-rail features to the two rails, not the whole face (§17.1 / M1)', () => {
    for (const model of ['PC10G-1SP', 'JW-300']) {
      const unit = PLC_UNITS[model];
      const rails = unit?.appearance.features.filter((f) => f.kind === 'slot') ?? [];
      expect(
        rails.map((r) => r.id),
        model,
      ).toEqual(['slot-rail-top', 'slot-rail-bottom']);
      expect(rails[0]?.rect, model).toMatchObject({ y: 0, h: 5 });
      expect(rails[1]?.rect, model).toMatchObject({ y: 135, h: 5 });
    }
  });
});
