import { describe, expect, it } from 'vitest';
import { hasExactTimerRange, SchematicDocumentSchema, toZodPath } from '../src/schema/schematic.js';

const DOC = {
  formatVersion: 1,
  id: 'sch-x',
  title: 'a接点',
  orientation: 'horizontal',
  rungs: [
    {
      id: 'r1',
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [
        { kind: 'pb-a', id: 'c01', device: 'PB1' },
        { kind: 'lamp', id: 'c02', device: 'PL1' },
      ],
    },
  ],
};

describe('SchematicDocumentSchema', () => {
  it('accepts a valid document', () => {
    expect(SchematicDocumentSchema.safeParse(DOC).success).toBe(true);
  });

  it('rejects a wrong orientation (§11.1)', () => {
    expect(SchematicDocumentSchema.safeParse({ ...DOC, orientation: 'vertical' }).success).toBe(
      false,
    );
  });

  it('rejects a device name that does not fit the cell kind', () => {
    const parsed = SchematicDocumentSchema.safeParse({
      ...DOC,
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 'cr-a', id: 'c01', device: 'PB1' },
            { kind: 'lamp', id: 'c02', device: 'PL1' },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['rungs', 0, 'cells', 0]);
  });

  it('surfaces validateDocument errors with their path (§11.1)', () => {
    const parsed = SchematicDocumentSchema.safeParse({
      ...DOC,
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [{ kind: 'pb-a', id: 'c01', device: 'PB1' }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['rungs', 0]);
    expect(parsed.error.issues[0]?.message).toContain('負荷');
  });

  it('requires presetMs on a timer coil and forbids it elsewhere (§5.3.2)', () => {
    const withoutPreset = SchematicDocumentSchema.safeParse({
      ...DOC,
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [{ kind: 'coil', id: 'c01', device: 'T1' }],
        },
      ],
    });
    expect(withoutPreset.success).toBe(false);
    const strayPreset = SchematicDocumentSchema.safeParse({
      ...DOC,
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [{ kind: 'coil', id: 'c01', device: 'CR1', presetMs: 1000 }],
        },
      ],
    });
    expect(strayPreset.success).toBe(false);
  });

  it('accepts only presets that a catalog timer range can hold exactly (§5.3.2)', () => {
    const withPreset = (presetMs: number) =>
      SchematicDocumentSchema.safeParse({
        ...DOC,
        rungs: [
          {
            id: 'r1',
            from: { bus: 'P' },
            to: { bus: 'N' },
            cells: [
              { kind: 'pb-a', id: 'c01', device: 'PB1' },
              { kind: 'coil', id: 'c02', device: 'T1', presetMs },
            ],
          },
        ],
      });
    // 0〜10秒レンジは0.1秒刻み
    expect(withPreset(100).success).toBe(true);
    expect(withPreset(3000).success).toBe(true);
    expect(withPreset(150).success).toBe(false);
    // 0〜10秒を超えると0〜60秒レンジ(0.5秒刻み・下限500ms)でしか表せない
    expect(withPreset(20_000).success).toBe(true);
    expect(withPreset(20_100).success).toBe(false);
    expect(hasExactTimerRange(500)).toBe(true);
    expect(hasExactTimerRange(60_001)).toBe(false);
  });
});

describe('toZodPath', () => {
  it('converts validateDocument paths to zod paths', () => {
    expect(toZodPath('rungs[0].cells[2]')).toEqual(['rungs', 0, 'cells', 2]);
    expect(toZodPath('formatVersion')).toEqual(['formatVersion']);
    expect(toZodPath('[0]')).toEqual(['[0]']);
  });
});
