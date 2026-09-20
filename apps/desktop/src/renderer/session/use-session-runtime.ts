import { useEffect, useRef } from 'react';
import { useStore } from '../app/store.js';
import { sounds, soundsForSnapshot } from '../audio/sounds.js';

/**
 * 4つのセッション画面に共通の「動いている部分」。設計仕様 §8.1 / §15（指摘 UI-05）。
 * 効果音と経過時間の刻みは4画面とも同じものを逐語で写していたので、ここに1本化する。
 */

/** 経過時間の更新間隔[ms]。 */
export const ELAPSED_INTERVAL_MS = 200;

/**
 * スナップショットの差分から効果音を鳴らす（§15: WebAudio の合成音のみ）。
 *
 * 何も描かない専用の小さな部品にしてあるのは、毎秒約30回変わる `snapshot` の購読を
 * セッション画面本体（＝3Dビューポートを含む部分木）から切り離すためである。画面本体で
 * 購読すると、音のためだけに3Dごと毎秒約30回描き直されてしまう（§15）。
 * 盤を組み直す（＝再マウントする）たびに「直前の音」の記憶も一緒に消える。
 */
export function SoundEffects(): null {
  const snapshot = useStore((s) => s.snapshot);
  const previous = useRef<typeof snapshot | undefined>(undefined);
  useEffect(() => {
    for (const kind of soundsForSnapshot(previous.current, snapshot)) sounds.play(kind);
    previous.current = snapshot;
  }, [snapshot]);
  return null;
}

/**
 * 経過時間を定期更新する。§8.1
 * 止めるのは画面を離れるときだけで、`tickElapsed()` は始点（`startedAtMs`）との差を
 * 取り直すだけなので、間引かれても時刻がずれない。
 */
export function useElapsedTicker(): void {
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().tickElapsed();
    }, ELAPSED_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);
}
