import type { ProblemTag } from '@ojt/content';
import { JA } from '../i18n/ja.js';

/**
 * 段階的に開くヒント。指摘 PR-02（Phase 7 Task 25）。
 *
 * 上の帯の「ヒント」を押すたびに1段ずつ開く。段は3つまで:
 *
 * 1. **いまの手順でやること** —— 手順帯（`session/step-guide.ts`）がいま出している案内そのもの。
 * 2. **この課題の考え方** —— 課題の学習テーマ（`tags`）から引く回路の型。答えは書かない。
 * 3. **次につなぐ1本** —— 回路図を見て1本だけ探す、という見るところの案内。
 *
 * **級による制限を守る。** 1級形式は回路図が与えられない級（`store-ui.ts` の
 * `schematicPolicy()`）なので、回路図を前提にする第3段は**出さない**。代わりに
 * その理由（`JA.hint.grade1Note`）を第2段に添えて、ヒントが尽きたことを訓練者に伝える。
 *
 * 課題データに手書きのヒント（`texts`）があればそれを優先し、無ければここで組み立てる。
 * React も three も使わない純関数なので Vitest だけで全分岐を確かめられる（§14.2）。
 */

/** ヒント1段。 */
export interface HintStage {
  /** 何段目か（1始まり）。 */
  readonly stage: 1 | 2 | 3;
  /** 段の名前（`いまの手順でやること` など）。 */
  readonly title: string;
  /** 段の中身。 */
  readonly text: string;
}

/** ヒントを組み立てるのに要るもの。 */
export interface HintInput {
  /** 想定級（ヒントの出し方が変わる。§8.4）。 */
  readonly grade: 1 | 2 | 3;
  /** 手順帯がいま出している案内（無ければ落としどころの1行にする）。 */
  readonly stepHint?: string | undefined;
  /** 課題の学習テーマ（`PROBLEM_TAGS`。空でもよい —— `b-009` / `d-009` は空）。 */
  readonly tags?: readonly ProblemTag[] | undefined;
  /**
   * 課題データが持つ手書きのヒント（`texts[0]` が第2段、`texts[1]` が第3段）。
   * 課題スキーマは任意項目なので、無い課題（いまは全72題）はここが `undefined` になる。
   */
  readonly texts?: readonly string[] | undefined;
}

/** 学習テーマから「この課題の考え方」を組み立てる（複数あれば最大2つまで並べる）。 */
export function ideaText(tags: readonly ProblemTag[] | undefined): string {
  const lines = (tags ?? []).slice(0, 2).map((tag) => JA.hintTag[tag]);
  return lines.length === 0 ? JA.hint.ideaFallback : lines.join(' ');
}

/**
 * ヒントの段を組み立てる。段の数は級で変わる（1級形式は2段まで）。
 * 返す並びがそのまま「1段目・2段目・3段目」で、画面は開いた段数ぶんだけ先頭から出す。
 */
export function hintStages(input: HintInput): readonly HintStage[] {
  const stages: HintStage[] = [
    { stage: 1, title: JA.hint.stage1, text: input.stepHint ?? JA.hint.stepFallback },
  ];
  const idea = input.texts?.[0] ?? ideaText(input.tags);
  /*
   * 1級形式は回路図が出ないので第3段が作れない。第2段の末尾でそのことを言い切り、
   * 「押しても何も起きない」ボタンを残さないようにする（押せない理由を必ず文字で出す。UX-05）。
   */
  stages.push({
    stage: 2,
    title: JA.hint.stage2,
    text: input.grade === 1 ? `${idea} ${JA.hint.grade1Note}` : idea,
  });
  if (input.grade !== 1) {
    stages.push({ stage: 3, title: JA.hint.stage3, text: input.texts?.[1] ?? JA.hint.wire });
  }
  return stages;
}

/** その級で開ける段の数（結果画面の「ヒントを使った回数」の上限でもある）。 */
export function maxHintStage(grade: 1 | 2 | 3): number {
  return grade === 1 ? 2 : 3;
}
