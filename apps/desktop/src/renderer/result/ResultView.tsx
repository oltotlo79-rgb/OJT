import type { AssembleProblem, JudgeResult, WiringSuspect } from '@ojt/content';
import type { JSX } from 'react';
import { elapsedSummaryText, JA } from '../i18n/ja.js';
import { ChartOverlay } from './ChartOverlay.js';
import { MismatchList } from './MismatchList.js';
import { ResultShell } from './ResultShell.js';
import { HazardList, StaticCheckList } from './StaticCheckList.js';
import { SuspectList } from './SuspectList.js';
import { verdictSummary } from './verdict-summary.js';
import styles from './result.module.css';

/**
 * 結果画面。設計仕様 §8.3。
 * 合否／差分一覧／チャート重ね表示／静的チェック／危険操作／所要時間の6点を並べる。
 * チャタリングを検出していたら禁則回路の明示警告を出す。
 *
 * 指摘 UX-13 / PR-03: 不合格のときは合否のすぐ下に「まず何を直すか」の1行を出し、
 * 下端バーに「盤で直す」を置く。押すと**その1件を選んだ状態で**盤へ戻る
 * （`SuspectList` の「盤で見る」を先頭の疑いに対して呼ぶのと同じ道）。
 */

/** 所要時間と標準・打切り時間の対比文。§8.3（文言そのものは `ja.ts` が持つ。§15） */
export const elapsedSummary = elapsedSummaryText;

/** 結果画面の本体。 */
export function ResultView({
  problem,
  result,
  restoredHazardCount = 0,
  suspects,
  suspectsTruncated,
  onShowOnBoard,
  onRetry,
  onBackToList,
}: {
  problem: AssembleProblem;
  result: JudgeResult;
  /**
   * 作業ファイルから復元した危険操作の回数。§12.3 / §5.6
   *
   * 判定は Worker が作り直したネットリストの上で行うので `JudgeResult.hazardCount` は
   * **復元後の分だけ**を数えている。種別ごとの内訳は復元できないため、見出しの合計だけを
   * 「今回の分 ＋ 復元した分」にして、訓練者が実際に踏んだ回数と食い違わないようにする。
   */
  restoredHazardCount?: number;
  /*
   * 疑わしい配線（UXレビュー #28）。3つとも**任意**にして、`ResultView` を使わない
   * C1/C2/D の結果画面と、同じ部品を使う検算パネルの署名を変えないでおく（MERGE 注意 #9）。
   */
  /** 疑わしい配線（モードBのみ）。§8.3 / 決定表#9 */
  suspects?: readonly WiringSuspect[];
  /** 表示上限で切り捨てた件数。決定表#27 */
  suspectsTruncated?: number;
  /** 「盤で見る」。決定表#11 */
  onShowOnBoard?: (suspect: WiringSuspect) => void;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  /*
   * 1行要約（指摘 UX-13 / PR-03）。疑わしい配線を渡されたモード（B）だけ
   * 「まず『疑わしい配線』の1件目を直してください」まで書ける。
   */
  const summary = verdictSummary(result, suspects);
  const fix = summary.fix;
  return (
    <ResultShell
      title={problem.title}
      passed={result.passed}
      elapsedMs={elapsedMs}
      timeLimit={problem.timeLimit}
      forbidden={result.chatter.length > 0}
      summary={summary.text}
      extraAction={
        fix === undefined || onShowOnBoard === undefined ? null : (
          <button
            type="button"
            className={styles.fixButton}
            data-testid="fix-on-board"
            onClick={() => {
              onShowOnBoard(fix);
            }}
          >
            {JA.result.fixOnBoard}
          </button>
        )
      }
      onRetry={onRetry}
      onBackToList={onBackToList}
    >
      <div className={styles.grid}>
        <ChartOverlay
          expected={result.charts.expected}
          actual={result.charts.actual}
          mismatches={result.mismatches}
        />
        <MismatchList mismatches={result.mismatches} />
        {suspects === undefined || onShowOnBoard === undefined ? null : (
          <SuspectList
            suspects={suspects}
            truncated={suspectsTruncated ?? 0}
            onShowOnBoard={onShowOnBoard}
          />
        )}
        <StaticCheckList checks={result.staticChecks} />
        <HazardList
          counts={result.hazardsByKind}
          total={result.hazardCount + restoredHazardCount}
        />
      </div>
    </ResultShell>
  );
}
