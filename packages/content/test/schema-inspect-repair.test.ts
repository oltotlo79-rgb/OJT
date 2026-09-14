import { describe, expect, it } from 'vitest';
import { InspectRepairProblemSchema } from '../src/schema/inspect-repair.js';
import { inspectRepairProblemJson } from './helpers/inspect.js';

describe('InspectRepairProblemSchema', () => {
  it('accepts the sample problem', () => {
    const parsed = InspectRepairProblemSchema.safeParse(inspectRepairProblemJson());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.mode).toBe('inspect-repair');
    expect(Array.isArray(parsed.data.faults)).toBe(true);
  });

  it('accepts the random fault form', () => {
    const json = inspectRepairProblemJson();
    json['faults'] = {
      random: {
        count: 2,
        types: ['wire-open', 'wire-missing'],
        seed: 1,
        fallback: [
          { target: { wireId: 'sw-005' }, kind: 'wire-open' },
          { target: { wireId: 'sw-009' }, kind: 'wire-missing' },
        ],
      },
    };
    expect(InspectRepairProblemSchema.safeParse(json).success).toBe(true);
  });

  it('rejects a problem without faults', () => {
    const json = inspectRepairProblemJson();
    delete json['faults'];
    expect(InspectRepairProblemSchema.safeParse(json).success).toBe(false);
  });

  it('shows the schematic for grade 2 and hides it for grade 1 (§9.2)', () => {
    const grade2 = { ...inspectRepairProblemJson(), grade: 2, hints: { schematicVisible: true } };
    expect(InspectRepairProblemSchema.safeParse(grade2).success).toBe(true);
    const grade1 = { ...inspectRepairProblemJson(), grade: 1, hints: { schematicVisible: false } };
    expect(InspectRepairProblemSchema.safeParse(grade1).success).toBe(true);
    const wrong = { ...inspectRepairProblemJson(), grade: 1, hints: { schematicVisible: true } };
    const parsed = InspectRepairProblemSchema.safeParse(wrong);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain('2級');
  });

  it('rejects grade 3 (C2 is for grade 1 and 2 only)', () => {
    const json = { ...inspectRepairProblemJson(), grade: 3, hints: { schematicVisible: true } };
    const parsed = InspectRepairProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.message.includes('1級・2級'))).toBe(true);
  });

  it('requires the judged window to outlast the last operation by a tick (§7.3)', () => {
    const json = inspectRepairProblemJson();
    json['operations'] = [{ t: 5000, target: 'PB1', action: 'press' }];
    json['durationMs'] = 5000;
    const parsed = InspectRepairProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['durationMs']);
  });

  it('rejects unknown keys', () => {
    const json = { ...inspectRepairProblemJson(), note: 'x' };
    expect(InspectRepairProblemSchema.safeParse(json).success).toBe(false);
  });
});
