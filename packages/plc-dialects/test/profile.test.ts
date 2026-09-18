import { describe, expect, it } from 'vitest';
import {
  DIALECT_IDS,
  IMPLEMENTED_DIALECT_IDS,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  UnknownDialectError,
  availableDialects,
  getDialect,
  isDialectId,
} from '../src/index.js';

describe('方言の一覧', () => {
  it('lists the four vendors of 決定事項#14 in release order', () => {
    expect(DIALECT_IDS).toEqual(['mitsubishi', 'jtekt', 'omron', 'sharp']);
    expect(isDialectId('mitsubishi')).toBe(true);
    expect(isDialectId('siemens')).toBe(false);
  });

  it('implements only Mitsubishi in Phase 3 (§16)', () => {
    expect(IMPLEMENTED_DIALECT_IDS).toEqual(['mitsubishi']);
    expect(availableDialects().map((d) => d.id)).toEqual(['mitsubishi']);
  });

  it('keeps availableDialects() consistent with IMPLEMENTED_DIALECT_IDS (レビュー #M6)', () => {
    expect(availableDialects().map((d) => d.id)).toEqual([...IMPLEMENTED_DIALECT_IDS]);
  });

  it('throws a readable error for a dialect that Phase 4 will add', () => {
    expect(() => getDialect('omron')).toThrow(UnknownDialectError);
    expect(() => getDialect('omron')).toThrow(/Phase 4/u);
  });

  it('bounds the display grid the settings screen may choose (§10.6)', () => {
    expect([MIN_GRID_COLS, MAX_GRID_COLS]).toEqual([8, 15]);
  });
});
