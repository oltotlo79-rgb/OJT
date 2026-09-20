import { create } from 'zustand';
import { createLadderSlice, type LadderSlice } from './store-ladder.js';
import { createSchematicSlice, type SchematicSlice } from './store-schematic.js';
import { createSessionSlice, type SessionSlice } from './store-session.js';
import { createUiSlice, type UiSlice } from './store-ui.js';

/**
 * 画面状態。設計仕様 §12.1。
 *
 * 状態管理に **zustand** を選ぶ理由:
 * worker のスナップショットは約30fpsで届き、3Dシーン・タイムチャート・ログの
 * 3箇所が別々の一部分だけを見る。`useReducer` ＋ Context だと1スナップショットごとに
 * 配下が丸ごと再描画されるが、zustand はセレクタ単位で購読でき「ランプの色だけ」を
 * 見ている 3Dシーンがログの増加で再描画されない。さらに worker ブリッジは React の外に
 * いるため、Provider を介さず `useStore.getState()` で読み書きできる点も噛み合う。
 * 依存は 3KB 程度で、§15 の性能目標（内蔵GPUで60fps）に対する影響が小さい。
 *
 * **4スライスに割ってある（指摘 DS-3）**。このファイルは束ねる入口だけで、中身は
 * `store-session.ts`（課題・盤・シミュレーション）／`store-schematic.ts`（回路図の下書き）／
 * `store-ladder.ts`（ラダーとPLC）／`store-ui.ts`（画面・知らせ）にある。
 * 公開面（`useStore` の型と、このファイルから出ている名前）は割る前と同じなので、
 * 呼び出し側は `useStore` を今までどおり使えばよい。
 */

export {
  NO_CONVERT_ISSUES,
  NO_HIGHLIGHT,
  type BoardFocus,
  type CameraPreset,
  type ConvertErrorLine,
  type ConvertIssues,
  type ConvertWarningLine,
  type HazardBanner,
  type HighlightSelection,
  type ListMode,
  type LogLine,
  type PendingReport,
  type PlcMonitorSnapshot,
  type ProbeSide,
  type Route,
  type Toast,
} from './store-types.js';

export {
  EMPTY_SNAPSHOT,
  RESTART_FALLBACK_ATTEMPTS,
  checkSessionFor,
  isInspectJudge,
  isPlcJudge,
  sessionFields,
  sessionForProblem,
  type AnyJudgeResult,
  type OpenProblemOptions,
  type SessionSlice,
} from './store-session.js';
export {
  DEVICE_COMMENT_COUNT_LIMIT,
  DEVICE_COMMENT_LIMIT,
  type LadderSlice,
  type LadderViewMode,
} from './store-ladder.js';
export { type SchematicSlice } from './store-schematic.js';
export {
  ASSEMBLE_VIEW_ORDER,
  HAZARD_BANNER_TTL_MS,
  LOG_LIMIT,
  TOAST_LIMIT,
  TOAST_TTL_MS,
  nextAssembleView,
  schematicPolicy,
  type AssembleViewMode,
  type UiSlice,
} from './store-ui.js';

/**
 * 画面状態のすべて。4スライスの和である（指摘 DS-3）。
 * 割る前の `AppState` と同じ形で、欄も操作も1つも増減していない。
 */
export interface AppState extends SessionSlice, SchematicSlice, LadderSlice, UiSlice {}

/** アプリ全体のストア（4スライスを束ねるだけ）。 */
export const useStore = create<AppState>((...args) => ({
  ...createSessionSlice(...args),
  ...createSchematicSlice(...args),
  ...createLadderSlice(...args),
  ...createUiSlice(...args),
}));
