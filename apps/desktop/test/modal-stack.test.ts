import { afterEach, describe, expect, it } from 'vitest';
import { isModalOpen, pushModalLayer, topModalLayer } from '../src/renderer/session/interaction.js';

const layers: Array<ReturnType<typeof pushModalLayer>> = [];
function open() {
  const layer = pushModalLayer();
  layers.push(layer);
  return layer;
}
afterEach(() => {
  for (const layer of layers.splice(0).reverse()) layer.release();
  document.body.style.overflow = '';
});

describe('異なる画面のモーダルも1つの積み重ねとして扱う', () => {
  it('内側だけ閉じても本文を動かさず、最後に元のスクロール設定を戻す', () => {
    document.body.style.overflow = 'auto';
    const outer = open();
    const inner = open();
    inner.release();
    expect(document.body.style.overflow).toBe('hidden');
    expect(topModalLayer()).toBe(outer.depth);
    outer.release();
    expect(document.body.style.overflow).toBe('auto');
    expect(isModalOpen()).toBe(false);
  });
  it('親が先に消えても残る窓と新しい窓の順番が重複しない', () => {
    const outer = open();
    const inner = open();
    outer.release();
    expect(topModalLayer()).toBe(inner.depth);
    const next = open();
    expect(next.depth).not.toBe(inner.depth);
    expect(topModalLayer()).toBe(next.depth);
    next.release();
    expect(topModalLayer()).toBe(inner.depth);
    expect(document.body.style.overflow).toBe('hidden');
  });
  it('古い窓の後始末が2回走っても、後から開いた窓を消さない', () => {
    const old = open();
    old.release();
    const current = open();
    old.release();
    expect(topModalLayer()).toBe(current.depth);
    expect(isModalOpen()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });
});
