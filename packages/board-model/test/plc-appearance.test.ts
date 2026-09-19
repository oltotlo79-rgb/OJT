import { describe, expect, it } from 'vitest';
import { PLC_UNITS, type PlcAppearance } from '../src/index.js';

/** 外観記述1件（本体またはモジュール）とその名前。 */
const faces: [string, PlcAppearance][] = Object.values(PLC_UNITS).flatMap((unit) => [
  [unit.model, unit.appearance] as [string, PlcAppearance],
  ...(unit.modules ?? []).map(
    (m) => [`${unit.model}/${m.model}`, m.appearance] as [string, PlcAppearance],
  ),
]);

describe('PlcAppearance（3Dが外観を描くための記述）', () => {
  it('exists for every catalogue unit and every rack module', () => {
    // Task 9 の時点は FX5U と CP1E の2機種だけ。Task 10 で `2 + 4`、Task 11 で `4 + 4 + 4` に上げる
    expect(faces.length).toBe(2);
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
});
