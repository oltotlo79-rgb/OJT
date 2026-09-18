/**
 * main プロセスが返す日本語文言。設計仕様 §15「全文言を1箇所に集約しハードコードしない」。
 *
 * `src/renderer/i18n/ja.ts` は renderer の文言だけを持つが、main（`work-files.ts` /
 * `settings.ts`）が返すメッセージはそのまま画面のトーストになる。main は renderer の
 * モジュール（`ja.ts` は three / React 由来の型を引く）を読み込めないので、
 * **両方から読める `src/shared/`** に置き、`ja.ts` からは `JA.main` として再輸出する。
 * これで「文言の変更箇所は1つ」という §15 の約束が main 側にも及ぶ。
 */

/** main プロセスの文言。 */
export const MSG = {
  workFile: {
    /** 作業ファイルの中身がオブジェクトでない。§13 #8 */
    badShape: '作業ファイルの形式が不正です',
    missingVersion: '作業ファイルに形式バージョンがありません',
    tooNew: 'このファイルは新しいバージョンで作成されています',
    missingFields: '作業ファイルに課題IDまたは盤の状態がありません',
    /** 電線の本数が上限を超えている（壊れた／作為的なファイル）。§13 #8 */
    tooManyWires: '作業ファイルの電線が多すぎます',
    /** 知らないモードの作業ファイル（将来のモードや壊れた値）。§12.1 / §13 #8 */
    unknownMode: '作業ファイルのモードが読めません',
    /** 解答・指摘・故障の並びが長すぎる（壊れた／作為的なファイル）。§13 #8 */
    tooManyEntries: '作業ファイルの項目が多すぎます',
    /** ファイルが大きすぎる（読む前に断る）。§13 #8 */
    tooLarge: '作業ファイルが大きすぎます',
    saveTitle: '作業ファイルを保存',
    loadTitle: '作業ファイルを読み込む',
    filterName: 'OJT作業ファイル',
    saveCanceled: '保存を取り消しました',
    loadCanceled: '読込を取り消しました',
    autosaveCleared: '一時保存を削除しました',
  },
  content: {
    /**
     * 配布物に置いた同梱課題フォルダから読めた件数が、アプリに焼き込んだ内蔵課題の件数と
     * 食い違う（configure/複写漏れ・破損）。§13 #1 / Phase 2 acceptance BLOCKER。
     */
    countMismatch: (diskCount: number, builtinCount: number): string =>
      `同梱課題フォルダから読めた課題数（${String(diskCount)}件）が想定（${String(builtinCount)}件）と一致しません`,
  },
  settings: {
    /** 設定ファイルが読めなかった（既定値で動く）。§12.1 */
    corrupt: '設定ファイルを読めませんでした。既定値で起動し、壊れた設定は控えを残しました',
  },
} as const;

/** 保存に失敗したときの理由付きメッセージ。§13 #7 */
export function saveFailedText(reason: string): string {
  return `保存に失敗しました: ${reason}`;
}

/** ファイルを読めなかったときの理由付きメッセージ。§13 #8 */
export function readFailedText(reason: string): string {
  return `ファイルを読めませんでした: ${reason}`;
}
