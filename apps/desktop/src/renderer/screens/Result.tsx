import {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  isPlcProblem,
} from '@ojt/content';
import { useEffect, type JSX } from 'react';
import { isInspectJudge, isPlcJudge, useStore } from '../app/store.js';
import { tryOjtApi } from '../app/ojt-api.js';
import { JA } from '../i18n/ja.js';
import { InspectPartsResult } from '../result/InspectPartsResult.js';
import { InspectRepairResult } from '../result/InspectRepairResult.js';
import { PlcResult } from '../result/PlcResult.js';
import { ResultView } from '../result/ResultView.js';
import styles from './screens.module.css';

/**
 * 結果画面のルート。設計仕様 §8.3 / §12.1 / §12.3。
 * 判定結果が無いのに開かれた場合は課題一覧へ戻す導線だけを出す。
 */

/**
 * 判定結果が無い（または課題と判定結果のモードが食い違っている）ときの枠。§12.1
 * 同じ枠を4箇所に書かないための切り出し（Plan 3B Task 13）。
 */
function NoResult({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <div className={styles.center}>
      <p>{JA.result.noResult}</p>
      <button type="button" onClick={onBack}>
        {JA.result.toList}
      </button>
    </div>
  );
}

/** 結果画面。 */
export function Result(): JSX.Element {
  const problem = useStore((s) => s.problem);
  const judge = useStore((s) => s.judge);
  const restoredHazardCount = useStore((s) => s.restoredHazardCount);
  const schematicOpenCount = useStore((s) => s.schematicOpenCount);
  const setRoute = useStore((s) => s.setRoute);
  const resetSession = useStore((s) => s.resetSession);
  const hasJudge = judge !== undefined;
  const backToList = (): void => {
    setRoute('list');
  };

  /*
   * 判定まで終わった作業の一時保存は消す（1D2-a のレビュー指摘）。§12.3
   * 残したままだと次の起動で「前回の作業を復元しますか？」が出て、**終わった課題**を
   * 判定直前の状態で開き直すことになる。§4.3 の6チャネルを増やさないよう、削除は
   * `workfile:load` の `discard: true` で表す。preload が無い環境では黙って諦める（§13 #5）。
   */
  useEffect(() => {
    if (!hasJudge) return;
    void tryOjtApi()?.loadWorkFile({ kind: 'autosave', discard: true });
  }, [hasJudge]);

  if (problem === undefined || judge === undefined) {
    return <NoResult onBack={backToList} />;
  }

  /*
   * 判定結果のモードで結果画面を選ぶ。4モードとも `mode` を持つ（Plan 2A I-3 ＋ 3A）ので、
   * `isInspectJudge()` は `inspect-parts` / `inspect-repair` の明示の2値で振り分ける（`store.ts`）。
   * 課題と結果のモードが食い違っている（保存データの取り違え等）ときは、判定が無いのと
   * 同じ扱いにして一覧へ戻せるようにする。
   */
  if (isPlcJudge(judge)) {
    if (!isPlcProblem(problem)) return <NoResult onBack={backToList} />;
    return (
      <PlcResult
        problem={problem}
        result={judge}
        restoredHazardCount={restoredHazardCount}
        onRetry={() => {
          resetSession();
        }}
        onBackToList={backToList}
      />
    );
  }

  if (isInspectJudge(judge)) {
    if (judge.mode === 'inspect-parts' && isInspectPartsProblem(problem)) {
      return (
        <InspectPartsResult
          problem={problem}
          result={judge}
          restoredHazardCount={restoredHazardCount}
          onRetry={() => {
            resetSession();
          }}
          onBackToList={backToList}
        />
      );
    }
    if (judge.mode === 'inspect-repair' && isInspectRepairProblem(problem)) {
      return (
        <InspectRepairResult
          problem={problem}
          result={judge}
          restoredHazardCount={restoredHazardCount}
          schematicOpenCount={schematicOpenCount}
          onRetry={() => {
            resetSession();
          }}
          onBackToList={backToList}
        />
      );
    }
    return <NoResult onBack={backToList} />;
  }

  if (!isAssembleProblem(problem)) {
    return <NoResult onBack={backToList} />;
  }

  return (
    <ResultView
      problem={problem}
      result={judge}
      restoredHazardCount={restoredHazardCount}
      onRetry={() => {
        resetSession();
      }}
      onBackToList={backToList}
    />
  );
}
