import type { StateCreator } from 'zustand';
import type { ProblemListPayload } from '../../shared/ipc.js';
import { droppedTicksLog } from '../i18n/ja.js';
import type { CameraPreset, HazardBanner, ListMode, LogLine, Route, Toast } from './store-types.js';
import type { AppState } from './store.js';

/**
 * 画面の見た目・行き先・知らせのスライス。設計仕様 §12.1（指摘 DS-3）。
 *
 * どの画面を出しているか（`route`）・視点・回路図ヒントの開閉・操作ログ・トースト・
 * 警告バナー・致命エラーの表示を持つ。盤の中身（`store-session.ts`）には触れない。
 */

/** トーストを自動で消すまでの時間[ms]。§8.2 */
export const TOAST_TTL_MS = 4000;

/** 同時に出すトーストの上限（超えたら古いものから捨てる）。§8.2 */
export const TOAST_LIMIT = 5;

/** 操作ログに残す行数の上限。§8.1 */
export const LOG_LIMIT = 200;

/**
 * 級ごとの回路図ヒントの扱い。設計仕様 §8.4。
 * 3級は常時表示（開閉させない）、2級は開閉可で初期は閉じる、1級は出さない。
 */
export function schematicPolicy(
  grade: 1 | 2 | 3,
  policy: 'task' | 'always' | 'off' = 'task',
): { shown: boolean; toggleable: boolean } {
  if (policy === 'always') return { shown: true, toggleable: true };
  if (policy === 'off') return { shown: false, toggleable: false };
  if (grade === 3) return { shown: true, toggleable: false };
  if (grade === 2) return { shown: false, toggleable: true };
  return { shown: false, toggleable: false };
}

/** 警告バナーを自動で畳むまでの時間[ms]。§5.6 */
export const HAZARD_BANNER_TTL_MS = 6000;

// --- Plan 5 Task 7 ---
/** モードBのビュー（盤／並べて／回路図）。§11.4 / Plan 5 決定表#1 */
export type AssembleViewMode = 'board' | 'split' | 'schematic';

/**
 * ビューを1つ進める順（盤 → 並べて → 回路図 → 盤）。`F2` の巡回に使う。
 * モードDの `ladderView` と同じ並び（3Dだけ → 両方 → 図だけ）にしてある。§11.4
 */
export const ASSEMBLE_VIEW_ORDER: readonly AssembleViewMode[] = ['board', 'split', 'schematic'];

/** いまのビューの次（`F2` を1回押したときの行き先）。 */
export function nextAssembleView(view: AssembleViewMode): AssembleViewMode {
  const index = ASSEMBLE_VIEW_ORDER.indexOf(view);
  return ASSEMBLE_VIEW_ORDER[(index + 1) % ASSEMBLE_VIEW_ORDER.length] ?? 'board';
}
// --- /Plan 5 Task 7 ---

let sequence = 0;
function nextId(): number {
  sequence += 1;
  return sequence;
}

/** 画面の見た目・行き先・知らせの状態と操作。 */
export interface UiSlice {
  route: Route;
  problems: ProblemListPayload | undefined;
  /** 課題一覧の絞り込み（ホームで選んだモード。`undefined` は「すべて」）。§12.1 */
  listMode: ListMode;
  /** 画面上部に出している危険操作の警告（期限切れで畳む）。§5.6 / §13 */
  hazardBanner: HazardBanner | undefined;
  camera: CameraPreset;
  /**
   * `setCamera()` を呼ぶたびに増える番号。§12.2
   *
   * プリセットは3つしかないので、盤をドラッグで回したあとに**いま選ばれているのと同じ**
   * ボタン（例: 正面）を押し直しても `camera` の値は変わらず、`CameraPresets` の効果が
   * 張り直されないため視点が戻らなかった。「押したこと」自体を状態として持たせ、
   * 同じプリセットでも必ず再適用されるようにする。
   */
  cameraNonce: number;
  schematicVisible: boolean;
  /**
   * 回路図ヒントを開いた回数（モードB／C2の2級形式で共用。§8.4 2026-09-18の決定）。
   * `toggleSchematic()` が**閉→開**の遷移だけを数える（開いたまま連打しても増えない）。
   * 3級（常時表示・開閉不可）や1級（非表示）は `toggleSchematic()` を呼べる導線が無いので
   * 常に 0 のまま。結果画面に出し、C2の作業ファイルへ持たせる。
   */
  schematicOpenCount: number;
  // --- Phase 7 Task 25 ---
  /**
   * 「ヒント」を何段まで開いたか（0=まだ押していない）。指摘 PR-02
   * 段の中身は `session/hints.ts` が課題と手順から作る純関数で、ここは**開いた段数だけ**を持つ。
   * 回路図ヒントの開閉回数（`schematicOpenCount`）と同じ扱いで結果画面に出し、
   * 課題を開き直すたびに 0 へ戻る（`sessionFields()`）。
   */
  hintStage: number;
  // --- /Phase 7 Task 25 ---
  // --- Plan 5 Task 7 ---
  /**
   * モードBのビュー（盤／並べて／回路図）。§11.4 / Plan 5 決定表#1
   * モードDの `ladderView` と同じ役割で、値の並びも同じ順（盤 → 並べて → 図）。
   */
  assembleView: AssembleViewMode;
  logLines: LogLine[];
  toasts: Toast[];
  fatalError: string | undefined;
  /** WebGL コンテキストが失われ再初期化中か。§13 #4 */
  webglLost: boolean;
  /** 既に操作ログへ出した「捨てた tick」の累計。§5.2 */
  reportedDroppedTicks: number;
  /**
   * 直前に出した「tick を省略しました」通知（連続する間はここへ積算し、行を増やさず書き換える）。
   * 間に別のログが挟まれば（＝操作ログの最後の行がこの `logId` でなくなれば）次の通知は新しい行にする。§5.2
   */
  droppedTicksNotice: { logId: number; ticks: number; occurrences: number } | undefined;

  setRoute: (route: Route) => void;
  setProblems: (payload: ProblemListPayload) => void;
  /** 課題一覧の絞り込みを変える。§12.1 */
  setListMode: (mode: ListMode) => void;
  setCamera: (preset: CameraPreset) => void;
  toggleSchematic: () => void;
  /** 回路図ヒントを開いた回数をまるごと差し替える（作業ファイルからの復元。§12.3）。 */
  setSchematicOpenCount: (count: number) => void;
  /**
   * ヒントを1段開く（指摘 PR-02）。`max` はその級で開ける段数
   * （`session/hints.ts` の `maxHintStage()`。1級形式は2段まで）で、そこで頭打ちにする。
   */
  revealHint: (max: number) => void;
  // --- Plan 5 Task 7 ---
  /** モードBのビューを切り替える。§11.4 / Plan 5 決定表#1 */
  setAssembleView: (view: AssembleViewMode) => void;
  addLog: (text: string) => void;
  /** 追従ループが捨てた tick を1行だけ操作ログに残す（累計の増分ぶん）。§5.2 */
  noteDroppedTicks: (total: number) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  /** 期限の切れたトーストを落とす（`App` の間引きタイマから呼ぶ）。§8.2 */
  expireToasts: (nowMs?: number) => void;
  setFatalError: (message: string | undefined) => void;
  setWebglLost: (lost: boolean) => void;
  /** 警告バナーを畳む。§5.6 */
  dismissHazard: (nowMs?: number) => void;
}

/** 画面の見た目・行き先・知らせのスライス。 */
export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  route: 'home',
  problems: undefined,
  listMode: undefined,
  hazardBanner: undefined,
  camera: 'front',
  cameraNonce: 0,
  schematicVisible: false,
  schematicOpenCount: 0,
  hintStage: 0,
  // モードBは必ず盤から始まる（Plan 5 Task 7 / 決定表#1）
  assembleView: 'board',
  logLines: [],
  toasts: [],
  fatalError: undefined,
  webglLost: false,
  reportedDroppedTicks: 0,
  droppedTicksNotice: undefined,

  setRoute: (route) => {
    set({ route });
  },
  setProblems: (problems) => {
    set({ problems });
  },
  setListMode: (listMode) => {
    set({ listMode });
  },
  setCamera: (camera) => {
    // プリセットが同じでも番号は必ず進める（同じボタンを押し直したら視点を組み直す）。§12.2
    set({ camera, cameraNonce: get().cameraNonce + 1 });
  },
  toggleSchematic: () => {
    const opening = !get().schematicVisible;
    // 開いた回数は**閉→開**の遷移だけを数える（閉じる操作や既に開いた状態は増やさない）。§8.4
    set({
      schematicVisible: opening,
      ...(opening ? { schematicOpenCount: get().schematicOpenCount + 1 } : {}),
    });
  },
  setSchematicOpenCount: (schematicOpenCount) => {
    set({ schematicOpenCount });
  },
  revealHint: (max) => {
    // 上限まで開いたあとに押しても増やさない（結果画面の回数が実際より多く出ないため）
    set({ hintStage: Math.min(get().hintStage + 1, Math.max(0, max)) });
  },
  // --- Plan 5 Task 7 ---
  setAssembleView: (assembleView) => {
    set({ assembleView });
  },
  addLog: (text) => {
    const lines = [...get().logLines, { id: nextId(), text }];
    set({ logLines: lines.slice(Math.max(0, lines.length - LOG_LIMIT)) });
  },
  noteDroppedTicks: (total) => {
    const reported = get().reportedDroppedTicks;
    if (total <= reported) return;
    const delta = total - reported;
    const notice = get().droppedTicksNotice;
    const lastLine = get().logLines.at(-1);
    // 直前の操作ログが同じ「tick を省略しました」通知なら、行を増やさず積算して書き換える
    // （間に別のログが挟まれば最後の行のidが一致しなくなるので、そのときは新しい行にする）。§5.2
    if (notice !== undefined && lastLine !== undefined && lastLine.id === notice.logId) {
      const merged = {
        logId: notice.logId,
        ticks: notice.ticks + delta,
        occurrences: notice.occurrences + 1,
      };
      set({
        logLines: get().logLines.map((line) =>
          line.id === merged.logId
            ? { id: line.id, text: droppedTicksLog(merged.ticks, merged.occurrences) }
            : line,
        ),
        droppedTicksNotice: merged,
        reportedDroppedTicks: total,
      });
      return;
    }
    get().addLog(droppedTicksLog(delta));
    const added = get().logLines.at(-1);
    /* c8 ignore next -- addLog は必ず1行追加するので、直前に取った行は必ず存在する */
    const logId = added?.id ?? nextId();
    set({
      droppedTicksNotice: { logId, ticks: delta, occurrences: 1 },
      reportedDroppedTicks: total,
    });
  },
  toast: (text, tone = 'info') => {
    // 1件ごとに期限を持たせ、新しい5件だけ残す（連続して失敗しても画面が埋まらない）。§8.2
    const next = [
      ...get().toasts,
      { id: nextId(), text, tone, expiresAt: Date.now() + TOAST_TTL_MS },
    ];
    set({ toasts: next.slice(Math.max(0, next.length - TOAST_LIMIT)) });
  },
  dismissToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  expireToasts: (nowMs = Date.now()) => {
    const toasts = get().toasts;
    const left = toasts.filter((t) => t.expiresAt > nowMs);
    if (left.length !== toasts.length) set({ toasts: left });
  },
  setFatalError: (fatalError) => {
    set({ fatalError });
  },
  setWebglLost: (webglLost) => {
    set({ webglLost });
  },
  dismissHazard: (nowMs) => {
    const banner = get().hazardBanner;
    if (banner === undefined) return;
    // 引数なしなら無条件に畳む。時刻を渡されたら期限切れのときだけ畳む（間引きタイマ用）
    if (nowMs !== undefined && banner.expiresAt > nowMs) return;
    set({ hazardBanner: undefined });
  },
});
