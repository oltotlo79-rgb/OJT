import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/events.js';

describe('ライブイベントの累計と保持量', () => {
  it('詳細を送信後に捨てても危険操作の累計と種類別の例を採点用に保持する', () => {
    const bus = new EventBus();
    for (let i = 0; i < 10_000; i++) {
      bus.emit({
        type: 'hazard',
        kind: i % 2 ? 'ohm-on-live' : 'power-sequence-violation',
        tMs: i * 10,
        detail: String(i),
      });
      if (i % 200 === 199) {
        expect(bus.drain()).toHaveLength(200);
        expect(bus.all()).toHaveLength(0);
      }
    }
    expect(bus.hazardTotals()['ohm-on-live']).toBe(5000);
    expect(bus.hazardTotals()['power-sequence-violation']).toBe(5000);
    expect(bus.representativeHazards()).toHaveLength(2);
    bus.clear();
    expect(bus.countOf('ohm-on-live')).toBe(0);
    expect(bus.representativeHazards()).toHaveLength(0);
  });
});
