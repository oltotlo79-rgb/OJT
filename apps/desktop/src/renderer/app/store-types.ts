import type { HazardKind } from '@ojt/circuit-sim';

/**
 * ストアの値型のうち、React にも three にも依存しないもの。設計仕様 §12.1 / §12.2。
 * `store.ts`（zustand）と、three を読み込めない場所（E2E の射影計算など）で共有する。
 */

/** 画面。§12.1 */
export type Route = 'home' | 'list' | 'session' | 'result' | 'settings';

/**
 * 視点プリセット。§12.2
 *
 * `front`（正面）／`top`（俯瞰）／`socket`（ソケット拡大）はツールバーの3ボタンと同じ。
 * `back` / `left` / `right` / `bottom` は Blender 風のテンキー操作とビューキューブの面から
 * 使う方向プリセット（2026-09-14 の利用者要望）。
 */
export type CameraPreset = 'front' | 'top' | 'socket' | 'back' | 'left' | 'right' | 'bottom';

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

/** テスターのプローブの側。§9.3 */
export type ProbeSide = 'black' | 'red';

/**
 * 警告バナーに出す危険操作1件。§5.6 / §13
 *
 * トースト（§8.2）とは別に**画面上部の帯**で出す。危険操作は「やってしまったこと」であり、
 * 右下に4秒出て消えるだけでは気づかないまま回数だけが増える（§16 Phase 2 受入基準④は
 * 「警告が出て結果に回数が記録される」ことを求める）。
 */
export interface HazardBanner {
  kind: HazardKind;
  detail: string;
  /** これを過ぎたら自動で畳む時刻（`Date.now()` と同じ基準の[ms]）。 */
  expiresAt: number;
}

/** 回路図 ⇄ 3D盤の連動ハイライト。§9.2 / §11.4 */
export interface HighlightSelection {
  /** 光らせる回路図要素のID。 */
  cellIds: readonly string[];
  /** 光らせる盤の端子（役割ID）。 */
  terminals: readonly string[];
  /** 光らせる電線のID。 */
  wireIds: readonly string[];
}

/** 何も光っていない状態。 */
export const NO_HIGHLIGHT: HighlightSelection = { cellIds: [], terminals: [], wireIds: [] };
