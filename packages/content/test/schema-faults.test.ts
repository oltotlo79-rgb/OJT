import { describe, expect, it } from 'vitest';
import {
  FAULT_KINDS,
  FaultSpecSchema,
  FaultsSchema,
  isPartFaultKind,
  isWireFaultKind,
  LOAD_ELEMENT_INDEX,
  PART_FAULT_KINDS,
  RandomFaultsSchema,
  SOCKET_COIL_ELEMENT_INDEX,
  socketContactElementIndex,
  WIRE_FAULT_KINDS,
} from '../src/schema/faults.js';

describe('FAULT_KINDS', () => {
  it('lists the nine kinds of §5.4 and splits them into wire and part faults', () => {
    expect(FAULT_KINDS).toEqual([
      'wire-open',
      'wire-missing',
      'wire-misrouted',
      'contact-open',
      'contact-welded',
      'contact-resistive',
      'coil-open',
      'coil-layer-short',
      'lamp-open',
    ]);
    expect([...WIRE_FAULT_KINDS, ...PART_FAULT_KINDS].sort()).toEqual([...FAULT_KINDS].sort());
    expect(isWireFaultKind('wire-open')).toBe(true);
    expect(isWireFaultKind('coil-open')).toBe(false);
    expect(isPartFaultKind('coil-open')).toBe(true);
    expect(isPartFaultKind('wire-missing')).toBe(false);
  });
});

describe('socketContactElementIndex', () => {
  it('maps the socket element order [coil, b1, a1, b2, a2, ...]', () => {
    expect(SOCKET_COIL_ELEMENT_INDEX).toBe(0);
    expect(LOAD_ELEMENT_INDEX).toBe(0);
    expect(socketContactElementIndex(1, 'b')).toBe(1);
    expect(socketContactElementIndex(1, 'a')).toBe(2);
    expect(socketContactElementIndex(4, 'b')).toBe(7);
    expect(socketContactElementIndex(4, 'a')).toBe(8);
  });

  it('rejects a group outside 1..4', () => {
    expect(() => socketContactElementIndex(0, 'a')).toThrow(RangeError);
    expect(() => socketContactElementIndex(5, 'a')).toThrow(RangeError);
  });
});

describe('FaultSpecSchema', () => {
  it('accepts a plain wire break', () => {
    const parsed = FaultSpecSchema.safeParse({ target: { wireId: 'sw-005' }, kind: 'wire-open' });
    expect(parsed.success).toBe(true);
  });

  it('accepts a part fault addressed by element index', () => {
    const parsed = FaultSpecSchema.safeParse({
      target: { partId: 'CR1', elementIndex: 2 },
      kind: 'contact-welded',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a wire kind aimed at a part', () => {
    const parsed = FaultSpecSchema.safeParse({
      target: { partId: 'CR1', elementIndex: 0 },
      kind: 'wire-open',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain('電線');
  });

  it('rejects a part kind aimed at a wire', () => {
    const parsed = FaultSpecSchema.safeParse({ target: { wireId: 'sw-001' }, kind: 'coil-open' });
    expect(parsed.success).toBe(false);
  });

  it('requires the new terminal for a misrouted wire and forbids it elsewhere', () => {
    expect(
      FaultSpecSchema.safeParse({ target: { wireId: 'sw-002' }, kind: 'wire-misrouted' }).success,
    ).toBe(false);
    expect(
      FaultSpecSchema.safeParse({
        target: { wireId: 'sw-002' },
        kind: 'wire-misrouted',
        to: 'CR1.12',
      }).success,
    ).toBe(true);
    expect(
      FaultSpecSchema.safeParse({ target: { wireId: 'sw-002' }, kind: 'wire-open', to: 'CR1.12' })
        .success,
    ).toBe(false);
  });

  it('allows ohms only on contact-resistive and ratio only on coil-layer-short', () => {
    expect(
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 2 },
        kind: 'contact-resistive',
        ohms: 3000,
      }).success,
    ).toBe(true);
    expect(
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 2 },
        kind: 'contact-open',
        ohms: 3000,
      }).success,
    ).toBe(false);
    expect(
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 0 },
        kind: 'coil-layer-short',
        ratio: 0.65,
      }).success,
    ).toBe(true);
    expect(
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 0 },
        kind: 'coil-open',
        ratio: 0.65,
      }).success,
    ).toBe(false);
  });

  it('keeps the layer short ratio inside 0.4..0.85 (§5.1.3)', () => {
    const at = (ratio: number): boolean =>
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 0 },
        kind: 'coil-layer-short',
        ratio,
      }).success;
    expect(at(0.4)).toBe(true);
    expect(at(0.85)).toBe(true);
    expect(at(0.39)).toBe(false);
    expect(at(0.86)).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      FaultSpecSchema.safeParse({ target: { wireId: 'sw-001' }, kind: 'wire-open', note: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('RandomFaultsSchema', () => {
  it('accepts a count, a type list, an optional seed and a mandatory fallback', () => {
    const parsed = RandomFaultsSchema.safeParse({
      count: 2,
      types: ['wire-open', 'wire-missing'],
      seed: 12345,
      fallback: [
        { target: { wireId: 'sw-001' }, kind: 'wire-open' },
        { target: { wireId: 'sw-002' }, kind: 'wire-missing' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a random block without a fallback list (§7.5)', () => {
    expect(RandomFaultsSchema.safeParse({ count: 2, types: ['wire-open'] }).success).toBe(false);
  });

  it('rejects a fallback whose length differs from count', () => {
    expect(
      RandomFaultsSchema.safeParse({
        count: 2,
        types: ['wire-open'],
        fallback: [{ target: { wireId: 'sw-001' }, kind: 'wire-open' }],
      }).success,
    ).toBe(false);
  });
});

describe('FaultsSchema', () => {
  it('accepts an explicit list', () => {
    const parsed = FaultsSchema.safeParse([
      { target: { wireId: 'sw-005' }, kind: 'wire-open' },
      { target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-welded' },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('accepts the random form', () => {
    const parsed = FaultsSchema.safeParse({
      random: {
        count: 1,
        types: ['wire-open'],
        fallback: [{ target: { wireId: 'sw-001' }, kind: 'wire-open' }],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty explicit list', () => {
    expect(FaultsSchema.safeParse([]).success).toBe(false);
  });
});
