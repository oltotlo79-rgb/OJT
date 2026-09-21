import { describe, expect, it, vi } from 'vitest';
import { captureReady } from '../e2e/capture.js';

describe('画面撮影の限定的な待機', () => {
  it('コンポジタの準備が整ってから撮影結果を返す', async () => {
    const capture = vi
      .fn()
      .mockRejectedValueOnce(new Error('electronApplication.evaluate: UnknownVizError'))
      .mockResolvedValue('image');
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(await captureReady(capture, wait)).toBe('image');
    expect(capture).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledExactlyOnceWith(250);
  });

  it('準備できないままなら上限で失敗し、成功を装わない', async () => {
    const error = new Error('UnknownVizError');
    const capture = vi.fn().mockRejectedValue(error);
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(captureReady(capture, wait)).rejects.toBe(error);
    expect(capture).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[250], [500]]);
  });

  it.each(['ウィンドウがありません', 'Target closed', 'capture failed'])(
    '撮影準備以外の失敗は即座に通知する: %s',
    async (message) => {
      const error = new Error(message);
      const capture = vi.fn().mockRejectedValue(error);
      const wait = vi.fn();
      await expect(captureReady(capture, wait)).rejects.toBe(error);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    },
  );
});
