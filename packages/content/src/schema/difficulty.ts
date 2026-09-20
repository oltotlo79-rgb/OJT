import { z } from 'zod';

/**
 * 課題の「難しさ」と「学習テーマ」。設計仕様 §16 Phase 7 §4.3。
 *
 * **級（`grade`）と難しさ（`difficulty`）は役割が違う。** `grade` は検定の形式
 * （3級形式・2級形式・1級形式。ヒントの出し方や回路図の提示が変わる）であり、
 * `difficulty` は**同じ級の中での並び順**である。3級の中にもやさしい題とそうでない題があり、
 * 級だけでは並べられないため、指導者が課題を出す順を決められるように段を別に持つ。
 *
 * どちらも既定値があるので `CONTENT_FORMAT_VERSION` は **1 のまま**でよい（決定 D3）。
 * 既存の課題ファイルは書き換えなくてもそのまま読め、書いていなければ `3` と `[]` が入る。
 */

/** 同じ級の中での難しさ。1=いちばんやさしい 〜 5=いちばん難しい。§16 Phase 7 */
export const DifficultySchema = z.int().min(1).max(5);

/** 同じ級の中での難しさ。 */
export type Difficulty = z.infer<typeof DifficultySchema>;

/**
 * 学習テーマの語彙。課題一覧の絞り込みと説明書の索引が使う。
 * **この配列が唯一の源**で、課題データも画面もここに無い語は使えない（`z.enum` が弾く）。
 */
export const PROBLEM_TAGS = [
  'self-hold', // 自己保持
  'interlock', // インタロック
  'timer', // タイマ
  'multi-timer', // 多段タイマ
  'counter', // カウンタ
  'priority', // 優先（先行・後行・停止）
  'sequence', // 順次動作
  'flicker', // 点滅
  'alarm', // 警報・ブザー
  'and-or', // 接点の直並列
  'fault-wire', // 電線の故障
  'fault-part', // 部品の故障
  'fault-contact', // 接触不良
  'measure', // 測定で切り分ける
] as const;

/** 学習テーマ。課題一覧の絞り込みと説明書の索引が使う。 */
export const ProblemTagSchema = z.enum(PROBLEM_TAGS);

/** 学習テーマ。 */
export type ProblemTag = z.infer<typeof ProblemTagSchema>;

/** 1つの課題に付けられる学習テーマの上限（多すぎると絞り込みの役に立たない）。 */
export const MAX_PROBLEM_TAGS = 6;

/** 学習テーマの日本語表示名。課題一覧の絞り込みと説明書が使う。 */
export const PROBLEM_TAG_LABELS: Readonly<Record<ProblemTag, string>> = {
  'self-hold': '自己保持',
  interlock: 'インタロック',
  timer: 'タイマ',
  'multi-timer': '多段タイマ',
  counter: 'カウンタ',
  priority: '優先',
  sequence: '順次動作',
  flicker: '点滅',
  alarm: '警報・ブザー',
  'and-or': '接点の直並列',
  'fault-wire': '電線の故障',
  'fault-part': '部品の故障',
  'fault-contact': '接触不良',
  measure: '測定で切り分ける',
};
