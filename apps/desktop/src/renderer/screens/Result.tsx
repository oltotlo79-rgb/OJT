import { CompareEntry } from '../result/CompareView.js';
import { ReplayEntry } from '../result/ReplayEntry.js';
import { ExportEntry } from '../result/ExportEntry.js';
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
import { HelpButton } from '../help/HelpButton.js';
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

/**
 * 結果画面。上の帯のヘルプだけを共通の囲みに出し、中身（4つの結果の画面と「結果がありません」）
 * は `ResultBody` がそのまま描く（Plan 6 Task 9 / MERGE 注意#7）。4つの結果部品は1行も変えない。
 */
export function Result(): JSX.Element {
  return (
    <>
      <div className={`${styles.screenHeader} ${styles.resultHeader}`}>
        <ReplayEntry />
        <CompareEntry />
        <ExportEntry />
        <HelpButton />
      </div>
      <ResultBody />
    </>
  );
}

/** 結果画面の中身（判定結果でどの結果の画面を出すかを決める）。 */
function ResultBody(): JSX.Element {
  const problem = useStore((s) => s.problem);
  const judge = useStore((s) => s.judge);
  const session = useStore((s) => s.session);
  const circuit = useStore((s) => s.circuit);
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

  /*
   * モードC2の電線ID→表示名（`CR1.9–PB1.2c の青線`）を組み立てるための一覧。§9.2 / UI監査 I5
   * いま盤にある電線（`session.wires`）＋故障適用直後のスナップショット
   * （`circuit.initialWires`。修復で外した電線は前者に無いのでここから拾う）を合わせて渡す。
   */
  const repairWires = useMemo(
    () => [...(session?.wires ?? []), ...(circuit?.initialWires ?? [])],
    [session, circuit],
  );

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
          wires={repairWires}
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

  /*
   * 合格したら「疑わしい配線」の3 props を**渡さない**（I1: Plan 5 C/D レビュー）。
   * `report.suspects` は合格時 `[]`（`undefined` ではない）なので、そのまま渡すと
   * `ResultView` の `suspects === undefined` ガードを素通りして「疑わしい配線（0）」の
   * カードが合格の結果画面にも出てしまう。`noSuspect` の文言（模範回路との配線の違いは
   * 見つからなかった）は不合格で差が無いときに要るので、`SuspectList` 側は変えない。
   * `exactOptionalPropertyTypes` のもとでは `undefined` を明示できない（コンパイルエラーに
   * なる）ので、prop 自体を条件つきで展開して**渡さない**形にする（`Toolbar.tsx` と同じ型）。
   */
  return (
    <ResultView
      problem={problem}
      result={judge}
      restoredHazardCount={restoredHazardCount}
      {...(judge.passed
        ? {}
        : {
            suspects: report.suspects,
            suspectsTruncated: report.omitted,
            onShowOnBoard: showOnBoard,
          })}
      onRetry={() => {
        resetSession();
      }}
      onBackToList={backToList}
    />
  );
}
