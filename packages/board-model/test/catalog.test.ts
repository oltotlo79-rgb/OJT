import { describe, expect, it } from 'vitest';
import {
  catalogEntry,
  CatalogError,
  DEFAULT_TIMER_RANGE,
  findTimerRange,
  inventoryCount,
  isMountableKind,
  PART_CATALOG,
  remainingInventory,
  snapPresetToStep,
  TIMER_RANGES,
  type MountableKind,
} from '../src/index.js';

describe('catalog: 部品カタログと在庫', () => {
  it('装着できるのはリレーとタイマの2種（§6.6）', () => {
    expect(Object.keys(PART_CATALOG)).toEqual(['relay-my4n', 'timer-h3y4']);
    expect(catalogEntry('relay-my4n').ranges).toEqual([]);
    expect(catalogEntry('timer-h3y4').ranges).toHaveLength(2);
    expect(catalogEntry('timer-h3y4').mountableOn).toBe('socket-14pin');
    expect(isMountableKind('relay-my4n')).toBe(true);
    expect(isMountableKind('plc')).toBe(false);
    expect(() => catalogEntry('plc' as MountableKind)).toThrow(CatalogError);
  });

  it('タイマのレンジは 0〜10s（0.1s刻み）と 0〜60s（0.5s刻み）（§5.3.2）', () => {
    expect(TIMER_RANGES.map((r) => `${r.id}:${r.maxMs}:${r.stepMs}`)).toEqual([
      '0-10s:10000:100',
      '0-60s:60000:500',
    ]);
    expect(DEFAULT_TIMER_RANGE.id).toBe('0-10s');
    expect(findTimerRange(60_000)?.stepMs).toBe(500);
    expect(findTimerRange(123)).toBeUndefined();
  });

  it('設定値は分解能に丸め、下限100ms・上限レンジに収める（§5.3.2）', () => {
    expect(snapPresetToStep(3040, DEFAULT_TIMER_RANGE)).toBe(3000);
    expect(snapPresetToStep(3060, DEFAULT_TIMER_RANGE)).toBe(3100);
    expect(snapPresetToStep(10, DEFAULT_TIMER_RANGE)).toBe(100);
    expect(snapPresetToStep(99_999, DEFAULT_TIMER_RANGE)).toBe(10_000);
  });

  it('在庫の計算', () => {
    const inventory = [
      { kind: 'relay-my4n' as const, count: 4 },
      { kind: 'timer-h3y4' as const, count: 2 },
    ];
    expect(inventoryCount(inventory, 'relay-my4n')).toBe(4);
    expect(inventoryCount([], 'relay-my4n')).toBe(0);
    expect(remainingInventory(inventory, ['relay-my4n', 'relay-my4n', 'timer-h3y4'])).toEqual([
      { kind: 'relay-my4n', count: 2 },
      { kind: 'timer-h3y4', count: 1 },
    ]);
  });
});
