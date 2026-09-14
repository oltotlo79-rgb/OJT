/**
 * ストアの値型のうち、React にも three にも依存しないもの。設計仕様 §12.1 / §12.2。
 * `store.ts`（zustand）と、three を読み込めない場所（E2E の射影計算など）で共有する。
 */

/** 画面。§12.1 */
export type Route = 'home' | 'list' | 'session' | 'result' | 'settings';

/** 視点プリセット。§12.2 */
export type CameraPreset = 'front' | 'top' | 'socket';

/**
 * 画面に出す短いお知らせ（配線失敗の理由など）。§8.2
 *
 * 期限は**1件ごと**に持つ。先頭の1件だけにタイマを張ると、後から積まれた1件で
 * そのタイマが張り直され、短時間に何件も出たときに誰も消えなくなる。
 */
export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
  /** これを過ぎたら消す時刻（`Date.now()` と同じ基準の[ms]）。 */
  expiresAt: number;
}

/** 操作ログの1行。§8.1 */
export interface LogLine {
  id: number;
  text: string;
}
