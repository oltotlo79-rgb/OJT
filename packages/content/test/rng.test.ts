import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, pickIndex, pickOne } from '../src/rng.js';

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = [a(), a(), a(), a()];
    const second = [b(), b(), b(), b()];
    expect(second).toEqual(first);
  });

  it('gives a different sequence for a different seed', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('stays inside [0, 1)', () => {
    const random = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('pickIndex', () => {
  it('returns an index inside the array', () => {
    const random = mulberry32(99);
    for (let i = 0; i < 200; i += 1) {
      const index = pickIndex(random, 4);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
    }
  });

  it('never runs past the end even when the draw returns almost 1', () => {
    expect(pickIndex(() => 0.999999999, 3)).toBe(2);
    expect(pickIndex(() => 0, 3)).toBe(0);
    expect(pickIndex(() => 0.5, 0)).toBe(0);
  });
});

describe('pickOne', () => {
  it('picks an element and returns undefined for an empty list', () => {
    const random = mulberry32(3);
    expect(['a', 'b', 'c']).toContain(pickOne(random, ['a', 'b', 'c']));
    expect(pickOne(random, [])).toBeUndefined();
  });
});

describe('hashSeed', () => {
  it('maps the same text to the same seed', () => {
    expect(hashSeed('CHK:p1')).toBe(hashSeed('CHK:p1'));
    expect(hashSeed('CHK:p1')).not.toBe(hashSeed('CHK:p2'));
  });

  it('returns a non negative 32 bit integer', () => {
    const seed = hashSeed('any text');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});
