import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeWebGlContext } from '../src/renderer/three/webgl-context.js';
afterEach(() => document.body.replaceChildren());
describe('WebGLの回復通知', () => {
  it('描画中の障害は回復まで保持し、同じCanvasの再発も通知する', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const changed = vi.fn();
    const stop = observeWebGlContext(canvas, changed);
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(changed.mock.calls).toEqual([[true]]);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(changed.mock.calls).toEqual([[true], [false], [true]]);
    stop();
  });
  it('画面遷移で廃棄されたCanvasから次の画面へ障害を持ち越さない', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const changed = vi.fn();
    const stop = observeWebGlContext(canvas, changed);
    canvas.remove();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(changed).not.toHaveBeenCalled();
    document.body.append(canvas);
    stop();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(changed).not.toHaveBeenCalled();
  });
});
