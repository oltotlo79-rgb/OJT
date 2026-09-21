import { setTimeout as delay } from 'node:timers/promises';

/** コンポジタの一時的な撮影失敗だけを最大2回待ち直す。操作や判定は再実行しない。 */
export async function captureReady<T>(
  capture: () => Promise<T>,
  wait: (milliseconds: number) => Promise<unknown> = delay,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await capture();
    } catch (error) {
      if (!(error instanceof Error) || !/\bUnknownVizError\b/u.test(error.message) || attempt === 2)
        throw error;
      await wait(250 * (attempt + 1));
    }
  }
}
