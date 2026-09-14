import { describe, expect, it } from 'vitest';
import {
  CONTACT_TRUTHS,
  InspectPartSchema,
  InspectPartsProblemSchema,
  isContactTruth,
  PART_TRUTHS,
} from '../src/schema/inspect-parts.js';
import { inspectPartsProblemJson } from './helpers/inspect.js';

describe('PART_TRUTHS', () => {
  it('lists normal plus the six defects of the answer sheet', () => {
    expect(PART_TRUTHS).toEqual([
      'normal',
      'coil-open',
      'coil-layer-short',
      'a-open',
      'a-weld',
      'b-open',
      'b-weld',
    ]);
    expect(CONTACT_TRUTHS).toEqual(['a-open', 'a-weld', 'b-open', 'b-weld']);
    expect(isContactTruth('a-weld')).toBe(true);
    expect(isContactTruth('coil-open')).toBe(false);
  });
});

describe('InspectPartSchema', () => {
  it('accepts a healthy relay', () => {
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'normal' }).success,
    ).toBe(true);
  });

  it('allows ratio only on a layer short', () => {
    expect(
      InspectPartSchema.safeParse({
        id: 'p1',
        kind: 'relay-my4n',
        truth: 'coil-layer-short',
        ratio: 0.5,
      }).success,
    ).toBe(true);
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'coil-open', ratio: 0.5 })
        .success,
    ).toBe(false);
  });

  it('refuses a layer short on a timer', () => {
    const parsed = InspectPartSchema.safeParse({
      id: 'p1',
      kind: 'timer-h3y4',
      truth: 'coil-layer-short',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain('タイマ');
  });

  it('allows group only on a contact defect and keeps it inside 1..4', () => {
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'a-open', group: 3 })
        .success,
    ).toBe(true);
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'normal', group: 3 })
        .success,
    ).toBe(false);
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'a-open', group: 5 })
        .success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'normal', note: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('InspectPartsProblemSchema', () => {
  it('accepts the sample set', () => {
    const parsed = InspectPartsProblemSchema.safeParse(inspectPartsProblemJson());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.mode).toBe('inspect-parts');
    expect(parsed.data.parts).toHaveLength(4);
    expect(parsed.data.seed).toBe(20260914);
  });

  it('defaults the seed to 0', () => {
    const json = inspectPartsProblemJson();
    delete json['seed'];
    const parsed = InspectPartsProblemSchema.safeParse(json);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.seed).toBe(0);
  });

  it('rejects duplicate part ids', () => {
    const json = inspectPartsProblemJson();
    json['parts'] = [
      { id: 'p1', kind: 'relay-my4n', truth: 'normal' },
      { id: 'p1', kind: 'relay-my4n', truth: 'coil-open' },
    ];
    const parsed = InspectPartsProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.message.includes('p1'))).toBe(true);
  });

  it('needs at least two parts', () => {
    const json = inspectPartsProblemJson();
    json['parts'] = [{ id: 'p1', kind: 'relay-my4n', truth: 'normal' }];
    expect(InspectPartsProblemSchema.safeParse(json).success).toBe(false);
  });

  it('requires the check socket in the board roles', () => {
    const json = inspectPartsProblemJson();
    json['board'] = { boardId: 'board-jipm-std', socketRoles: { S1: 'CR1' } };
    const parsed = InspectPartsProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.message.includes('CHK'))).toBe(true);
  });
});
