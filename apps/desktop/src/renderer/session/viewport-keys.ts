import { useEffect } from 'react';
import type { CameraPreset } from '../app/store-types.js';
import { useStore } from '../app/store.js';
import { shouldIgnoreShortcut } from './interaction.js';

/**
 * 3Dビューポートの視点ショートカット。設計仕様 §12.2（2026-09-14 の利用者要望）。
 *
 * Blender と同じテンキー操作（1=正面 / 3=右 / 7=上、Ctrl で反対側、Home で全体）を、
 * モードB（回路組立）だけでなくモードC1/C2（点検・故障探索）の画面からも同じ形で使えるよう
 * **画面に依存しない**フックに切り出す。ここが見るのはストアの `setCamera` だけで、
 * 盤の状態（配線中の端子・選択中の電線など）には触らない。
 */

/** キー入力のうちこの層が見る部分（DOM の型に依存させない）。 */
export interface ViewKeyEvent {
  /** 物理キー（`Numpad7` など）。テンキーは NumLock で `key` が変わるので `code` で見る。 */
  code?: string | undefined;
  key?: string | undefined;
  ctrlKey?: boolean | undefined;
  metaKey?: boolean | undefined;
  altKey?: boolean | undefined;
}

/** テンキー → 視点（Ctrl なし／Ctrl あり）。Blender の 1=正面 3=右 7=上 と同じ並び。 */
const NUMPAD_VIEWS: Readonly<Record<string, readonly [CameraPreset, CameraPreset]>> = {
  Numpad1: ['front', 'back'],
  Numpad3: ['right', 'left'],
  Numpad7: ['top', 'bottom'],
};

/** 上段の数字キー → 視点（従来どおり。ツールバーのボタンと同じ3種）。§12.2 */
const DIGIT_VIEWS: Readonly<Record<string, CameraPreset>> = {
  '1': 'front',
  '2': 'top',
  '3': 'socket',
};

/**
 * キー入力 → 視点プリセット（純粋関数）。§12.2
 *
 * - テンキー `1` / `3` / `7` = 正面 / 右 / 俯瞰、`Ctrl` を足すと反対側（後 / 左 / 下）
 * - `Home` = 盤全体（正面）
 * - 上段の `1` / `2` / `3` = 正面 / 俯瞰 / ソケット拡大（従来どおり）
 *
 * テンキーは `code` で先に見る。NumLock が入っていると `key` が `'3'` になり、
 * 上段の `3`（ソケット拡大）と取り違えるため。`Alt` 付きはアプリのメニュー操作なので通さない。
 * テンキー `5`（Blender の平行投影切替）は割り当てない（§12.2 の注記）。
 */
export function viewKeyAction(event: ViewKeyEvent): CameraPreset | undefined {
  if (event.altKey === true) return undefined;
  const ctrl = event.ctrlKey === true || event.metaKey === true;
  const numpad = event.code === undefined ? undefined : NUMPAD_VIEWS[event.code];
  if (numpad !== undefined) return ctrl ? numpad[1] : numpad[0];
  if (ctrl) return undefined;
  if (event.code === 'Home' || event.key === 'Home') return 'front';
  return event.key === undefined ? undefined : DIGIT_VIEWS[event.key];
}

/**
 * 視点ショートカットを窓口に張る。3Dビューポートを出している画面から呼ぶ。
 * `enabled` が false のあいだは張らない（盤がまだ無い・別の画面を出しているとき）。
 * 入力欄で打鍵中・IME変換中は `shouldIgnoreShortcut()` で弾く（§8.2）。
 */
export function useViewportShortcuts({ enabled = true }: { enabled?: boolean } = {}): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (shouldIgnoreShortcut(event)) return;
      const preset = viewKeyAction(event);
      if (preset === undefined) return;
      useStore.getState().setCamera(preset);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled]);
}
