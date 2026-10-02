// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { confirmStartupFrame, hasStartupContent } from '../src/main/startup-frame.js';

function image(content = true) {
  const bytes = new Uint8Array(256).fill(255);
  if (content) bytes[128] = 20;
  return { isEmpty: () => false, toBitmap: () => bytes };
}

describe('本体の描画を確認してからローディングを閉じる', () => {
  it('空・透明・背景色だけのフレームは準備完了にしない', () => {
    expect(hasStartupContent({ ...image(), isEmpty: () => true })).toBe(false);
    expect(hasStartupContent({ ...image(), toBitmap: () => new Uint8Array(256) })).toBe(false);
    expect(hasStartupContent(image(false))).toBe(false);
    expect(hasStartupContent(image())).toBe(true);
  });

  it('表示フラグだけでは完了せず、コンポジタの結果を待つ', async () => {
    let painted: ((frame: ReturnType<typeof image>) => void) | undefined;
    const capturePage = vi.fn(
      () =>
        new Promise<ReturnType<typeof image>>((resolve) => {
          painted = resolve;
        }),
    );
    const window = {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      webContents: { capturePage },
    };
    let done = false;
    const result = confirmStartupFrame(window).then((ready) => {
      done = true;
      return ready;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    painted?.(image());
    expect(await result).toBe(true);
  });

  it('描画待ちの間に隠れた本体・最小化した本体は完了にしない', async () => {
    let visible = true;
    const window = {
      isDestroyed: () => false,
      isVisible: () => visible,
      isMinimized: () => false,
      webContents: {
        capturePage: () => {
          visible = false;
          return Promise.resolve(image());
        },
      },
    };
    expect(await confirmStartupFrame(window)).toBe(false);
    expect(
      await confirmStartupFrame({ ...window, isVisible: () => true, isMinimized: () => true }),
    ).toBe(false);
  });

  it('描画の一時的な失敗では起動画面を残し、本体を落とさない', async () => {
    const window = {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      webContents: { capturePage: () => Promise.reject(new Error('UnknownVizError')) },
    };
    expect(await confirmStartupFrame(window)).toBe(false);
  });
});
