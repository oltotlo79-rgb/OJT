import { describe, expect, it } from 'vitest';
import {
  CLOSED_CONTACT_OHMS,
  COIL_OHMS,
  contactOhms,
  createRelay4c,
  isContactClosed,
  loadOhms,
} from '../src/index.js';
import type { ContactElement, LoadElement } from '../src/index.js';

function pick(elementId: string): ContactElement {
  const el = createRelay4c('CR1').elements.find((e) => e.id === elementId);
  if (el === undefined || el.kind !== 'contact') throw new Error(elementId);
  return el;
}

function coil(): LoadElement {
  const el = createRelay4c('CR1').elements.find((e) => e.id === 'CR1:coil');
  if (el === undefined || el.kind !== 'load') throw new Error('CR1:coil');
  return el;
}

describe('elements', () => {
  it('a接点は励磁で閉じ、b接点は励磁で開く（§5.1.2）', () => {
    const a = pick('CR1:a1');
    const b = pick('CR1:b1');
    expect(isContactClosed(a)).toBe(false);
    expect(isContactClosed(b)).toBe(true);
    a.energized = true;
    b.energized = true;
    expect(isContactClosed(a)).toBe(true);
    expect(isContactClosed(b)).toBe(false);
  });

  it('不導通・溶着は駆動状態より優先される（§5.4）', () => {
    const open = pick('CR1:a1');
    open.energized = true;
    open.fault = { kind: 'open' };
    expect(isContactClosed(open)).toBe(false);
    expect(contactOhms(open)).toBeUndefined();

    const welded = pick('CR1:a1');
    welded.fault = { kind: 'welded' };
    expect(isContactClosed(welded)).toBe(true);
    expect(contactOhms(welded)).toBe(CLOSED_CONTACT_OHMS);
  });

  it('接触不良は直列抵抗になる（§5.4）', () => {
    const el = pick('CR1:a1');
    el.energized = true;
    expect(contactOhms(el)).toBe(CLOSED_CONTACT_OHMS);
    el.fault = { kind: 'resistive', ohms: 500 };
    expect(contactOhms(el)).toBe(500);
  });

  it('コイル抵抗は 650Ω、レアショートで公称値×ratio になる（§5.1.3）', () => {
    const normal = coil();
    expect(loadOhms(normal)).toBe(COIL_OHMS);
    const layer = coil();
    layer.fault = { kind: 'layerShort', ratio: 0.65 };
    expect(loadOhms(layer)).toBeCloseTo(422.5, 6);
    const broken = coil();
    broken.fault = { kind: 'open' };
    expect(loadOhms(broken)).toBeUndefined();
  });
});
