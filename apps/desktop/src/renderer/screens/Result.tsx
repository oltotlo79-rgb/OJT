import { JIPM_BOARD } from '@ojt/board-model';
import {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  isPlcProblem,
  wiringSuspects,
} from '@ojt/content';
import type { WiringSuspect, WiringSuspectReport } from '@ojt/content';
import { useCallback, useEffect, useMemo, type JSX } from 'react';
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

/** 空の疑い一覧（モードB以外・合格・模範回路が作れないとき）。 */
const NO_SUSPECTS: WiringSuspectReport = { suspects: [], total: 0, omitted: 0 };

/** 結果画面。 */
export function Result(): JSX.Element {
  const problem = useStore((s) => s.problem);
  const judge = useStore((s) => s.judge);
  const session = useStore((s) => s.session);
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

  // --- Plan 5 Task 9: 疑わしい配線（UXレビュー #28）。§8.3 ---
  /**
   * 疑いは **renderer で** 求める（決定表#10）。節点分割はソルバを回さないグラフ処理
   * （union-find。数百端子で1ms未満）なので Worker へ往復させる必要が無く、`JudgeResult` に
   * 項目を足すと `@ojt/content` の公開型が C1/C2/D と作業ファイルにも波及する。
   * モードB以外と合格したときは出さない（見るところが無い。決定表#9）。
   */
  const report = useMemo((): WiringSuspectReport => {
    if (problem === undefined || session === undefined || !isAssembleProblem(problem)) {
      return NO_SUSPECTS;
    }
    if (judge?.mode === 'assemble' && judge.passed) return NO_SUSPECTS;
    return wiringSuspects(problem, JIPM_BOARD, session);
  }, [problem, session, judge]);

  /**
   * 「盤で見る」（決定表#11）。端子・電線・回路図要素を光らせたうえで、戻る導線として
   * 「結果から」の帯（`boardFocus`）を立ててからセッション画面へ移る。視点は正面に戻す
   * （疑いの端子が画面の外にいると「光らせた」ことが伝わらない）。
   */
  const showOnBoard = useCallback((suspect: WiringSuspect): void => {
    const store = useStore.getState();
    store.setHighlight({
      cellIds: [...suspect.cellIds],
      terminals: [...suspect.terminals],
      wireIds: [...suspect.wireIds],
    });
    store.setBoardFocus({ from: 'result', text: suspect.message });
    store.setCamera('front');
    store.setRoute('session');
  }, []);
  // --- /Plan 5 Task 9 ---

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
      suspects={report.suspects}
      suspectsTruncated={report.omitted}
      onShowOnBoard={showOnBoard}
      onRetry={() => {
        resetSession();
      }}
      onBackToList={backToList}
    />
  );
}
