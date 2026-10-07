import {
  compareWithExpected,
  createAssembleLabProblem,
  createPlcLabProblem,
  findLabTemplate,
  isLabProblem,
  labCompareSignals,
  labExpectedChart,
  parseProblem,
  type LabJudgeResult,
  type LabMode,
  type LabProblem,
  type PlcLabProblem,
} from '@ojt/content';
import type { DialectId } from '@ojt/plc-dialects';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';

/**
 * 「回路実験」「PLC実験」の操作（2026-10-08 利用者指示）。
 * 設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md §6
 *
 * 実験の課題は**その場で作る**（課題ファイルにしない。利用者の決定 D1）。描いた押し方と正解は
 * 課題そのもの（ストアの `problem`）に持つので、自動保存・作業ファイル（`problemSnapshot`）が
 * そのまま残し、復元する。ここは課題の作成・描き直し・盤の作り直しの入口を1か所にまとめる。
 */

/** 実験を始めるときの選択。 */
export interface LabStartOptions {
  /** PLC実験のメーカー（回路実験では使わない）。 */
  vendor: DialectId;
  /** PLC実験を配線済みの盤で始めるか（回路実験では使わない）。 */
  prewired: boolean;
  /** 例題の名前（省くと空のタイムチャート）。 */
  templateId?: string | undefined;
}

/** 実験の課題を作る（例題を選べばその押し方と正解を入れる）。 */
export function newLabProblem(mode: LabMode, options: LabStartOptions): LabProblem {
  const template =
    options.templateId === undefined ? undefined : findLabTemplate(mode, options.templateId);
  const chart =
    template === undefined
      ? {}
      : {
          operations: template.operations,
          durationMs: template.durationMs,
          expected: template.expected,
        };
  return mode === 'assemble-lab'
    ? createAssembleLabProblem(chart)
    : createPlcLabProblem({ vendor: options.vendor, prewired: options.prewired, ...chart });
}

/** いま開いている実験の課題（実験でなければ `undefined`）。 */
export function currentLabProblem(): LabProblem | undefined {
  const problem = useStore.getState().problem;
  return problem !== undefined && isLabProblem(problem) ? problem : undefined;
}

/**
 * 正解だけを描き直したときに、最後に動かした結果を比べ直す（動かし直さない）。
 * 判定（`judgeAssembleLab` / `judgePlcLab`）と同じ `compareLogs()` を通るので、合否の規則は1つ。
 * ラダーが変換できずに動かなかった結果は、比べるものが無いので違いも無いままにする。
 */
export function recomparedLabRun(problem: LabProblem, run: LabJudgeResult): LabJudgeResult {
  const judged = problem.expected !== undefined;
  const notRun = 'ladderErrors' in run && run.ladderErrors.length > 0;
  const mismatches = notRun ? [] : compareWithExpected(problem, run.charts.actual);
  const expected = judged ? labExpectedChart(problem, run.charts.actual.markers) : undefined;
  const charts = {
    ...(expected === undefined ? {} : { expected }),
    actual: run.charts.actual,
  };
  const passed =
    judged && !notRun && mismatches.length === 0 && run.staticChecks.every((check) => check.ok);
  return { ...run, judged, passed, mismatches, compareSignals: labCompareSignals(problem), charts };
}

/** 押し方（入力）か長さが変わったか（変わったら前の「動かす」の結果は使えない）。 */
function inputsChanged(before: LabProblem, after: LabProblem): boolean {
  return (
    before.durationMs !== after.durationMs ||
    JSON.stringify(before.operations) !== JSON.stringify(after.operations)
  );
}

/**
 * 実験のタイムチャートを描き直す。描き直した課題を検証してからストアへ入れる。
 * 押し方・長さが変わったら最後の「動かす」の結果を捨て、正解だけなら比べ直す。
 * 検証を通らない描き方（あり得ないが、壊れた入力の砦）は理由を出して何も変えない。
 */
export function editLab(update: (problem: LabProblem) => LabProblem): boolean {
  const store = useStore.getState();
  const current = currentLabProblem();
  if (current === undefined) return false;
  const parsed = parseProblem(update(current));
  if (!parsed.ok || !isLabProblem(parsed.problem) || parsed.problem.mode !== current.mode) {
    store.toast(JA.lab.invalidChart, 'error');
    return false;
  }
  const problem = parsed.problem;
  const run = store.labRun;
  useStore.setState({
    problem,
    labRun:
      run === undefined || inputsChanged(current, problem)
        ? undefined
        : recomparedLabRun(problem, run),
  });
  return true;
}

/**
 * 盤を作り直す（「配線をやり直す」）。タイムチャートとラダーは残す。PLC実験は配線済みの盤と
 * 自分で配線する盤を選び直せる（`prewired`。省くといまのまま。利用者の決定 D3）。
 */
export function restartLabBoard(prewired?: boolean): boolean {
  const store = useStore.getState();
  const current = currentLabProblem();
  if (current === undefined) return false;
  const problem: LabProblem =
    current.mode === 'plc-lab' && prewired !== undefined && prewired !== current.prewired
      ? withPrewired(current, prewired)
      : current;
  if (!store.openProblem(problem, { keepLadder: true, vendor: store.dialectId })) return false;
  // 同じ課題IDのままなので、世代番号で Worker の張り直しを促す（`resetSession()` と同じ）
  useStore.setState({ sessionEpoch: useStore.getState().sessionEpoch + 1 });
  useStore.getState().toast(JA.lab.boardRestarted, 'info');
  return true;
}

/** 配線済みかどうかを変えた PLC実験の課題（割付の固定・自由も合わせて変わる）。 */
function withPrewired(problem: PlcLabProblem, prewired: boolean): PlcLabProblem {
  const fresh = createPlcLabProblem({ vendor: problem.plc.vendor, prewired });
  return { ...problem, prewired, io: fresh.io };
}
