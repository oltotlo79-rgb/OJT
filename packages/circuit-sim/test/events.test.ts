import { describe, expect, it } from 'vitest';
import { CHATTER_MIN_TRANSITIONS, CHATTER_WINDOW_MS, EventBus } from '../src/index.js';
import type { SimEvent } from '../src/index.js';

describe('events', () => {
  it('しきい値は1秒窓・10回（§5.3.2）', () => {
    expect(CHATTER_WINDOW_MS).toBe(1000);
    expect(CHATTER_MIN_TRANSITIONS).toBe(10);
  });

  it('購読・解除・記録', () => {
    const bus = new EventBus();
    const seen: SimEvent[] = [];
    const off = bus.on((e) => seen.push(e));
    bus.emit({ type: 'hazard', kind: 'ohm-on-live', tMs: 10, detail: 'CR1.13-CR1.14' });
    off();
    off();
    bus.emit({ type: 'chatter', signal: 'T1', tMs: 20, count: 12 });
    expect(seen).toHaveLength(1);
    expect(bus.all()).toHaveLength(2);
  });

  it('種別ごとに数えられる（§7.4 の危険操作回数）', () => {
    const bus = new EventBus();
    bus.emit({ type: 'hazard', kind: 'ohm-on-live', tMs: 0, detail: 'a' });
    bus.emit({ type: 'hazard', kind: 'ohm-on-live', tMs: 10, detail: 'b' });
    bus.emit({ type: 'hazard', kind: 'power-sequence-violation', tMs: 20, detail: 'c' });
    bus.emit({ type: 'chatter', signal: 'T1', tMs: 30, count: 11 });
    expect(bus.countOf('ohm-on-live')).toBe(2);
    expect(bus.countOf('power-sequence-violation')).toBe(1);
    expect(bus.countOf('short-circuit-power-on')).toBe(0);
    expect(bus.hazards()).toHaveLength(3);
    expect(bus.chatters('T1')).toHaveLength(1);
    expect(bus.chatters('T2')).toHaveLength(0);
    bus.clear();
    expect(bus.all()).toHaveLength(0);
  });
});
