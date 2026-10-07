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
import type { LadderProgram } from '@ojt/ladder-core';
import { getDialect, type DialectId } from '@ojt/plc-dialects';
import type { SimMessage } from '../../worker/protocol.js';
import { useStore } from '../app/store.js';
import { JA, referenceErrorText } from '../i18n/ja.js';
import { cloneSession } from './commands.js';
import { shortcutKeyOf } from './ladder.js';
import { canJudgePlc } from './plc-session.js';
import { bridge } from './worker-bridge.js';

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

/** 押し方と長さの鍵（「動かす」を頼んだ時点と結果が届いた時点で同じ押し方かを見る）。 */
export function labInputsKey(problem: LabProblem): string {
  return JSON.stringify([problem.durationMs, problem.operations]);
}

/** いま頼んでいる「動かす」の押し方（結果が届いたら照らし合わせる）。 */
let requestedInputs: string | undefined;

/**
 * 「動かす」（`judge=false`）／「判定」（`judge=true`）をワーカーへ頼む。設計 §6.2
 * 判定は正解を描いてあるときだけ、PLC実験は変換を通したラダーがあるときだけ頼める
 * （判定の画面と同じ規則。押せない理由はトーストに出す）。頼めたら `true`。
 */
export function requestLabRun(judge: boolean): boolean {
  const store = useStore.getState();
  const problem = currentLabProblem();
  const session = store.session;
  if (problem === undefined || session === undefined) return false;
  if (store.labRunning || store.judging) return false;
  if (judge && problem.expected === undefined) {
    store.toast(JA.lab.judgeNeedsExpected, 'info');
    return false;
  }
  let ladder: LadderProgram | undefined;
  if (problem.mode === 'plc-lab') {
    const readiness = canJudgePlc({ converted: store.converted, ladder: store.ladder });
    if (!readiness.ok) {
      store.toast(labLadderReason(readiness.reason), 'info');
      return false;
    }
    ladder = store.ladder;
  }
  requestedInputs = labInputsKey(problem);
  store.setLabRunning(true);
  if (judge) store.setJudging(true);
  bridge.send({
    type: 'labRun',
    problem,
    session: cloneSession(session),
    ...(ladder === undefined ? {} : { ladder }),
    elapsedMs: store.elapsedMs,
    judge,
  });
  return true;
}

/** PLC実験でラダーを動かせない理由（判定の画面と同じ言い方）。 */
export function labLadderReason(reason: 'no-ladder' | 'not-converted'): string {
  if (reason === 'no-ladder') return JA.plc.judgeNoLadder;
  const key = shortcutKeyOf(getDialect(useStore.getState().dialectId), 'convert');
  return key === undefined ? JA.plc.judgeAutoConverting : JA.lab.runNotConverted(key);
}

/**
 * ワーカーから届いた「動かす」「判定」の結果を受け取る。頼んだあとにタイムチャートの押し方を
 * 描き直していたら、その結果は今の押し方の結果ではないので使わない。正解だけを描き直していた
 * ときは比べ直してから入れる。判定なら結果画面へ進む。
 */
export function acceptLabResult(message: Extract<SimMessage, { type: 'labResult' }>): void {
  const store = useStore.getState();
  store.setLabRunning(false);
  if (message.judge) store.setJudging(false);
  const requested = requestedInputs;
  requestedInputs = undefined;
  if (!message.result.ok) {
    store.toast(referenceErrorText(message.result.errors.map((error) => error.message)), 'error');
    return;
  }
  const problem = currentLabProblem();
  if (
    problem === undefined ||
    message.result.value.mode !== problem.mode ||
    requested !== labInputsKey(problem)
  ) {
    store.toast(JA.lab.staleRun, 'info');
    return;
  }
  const run = recomparedLabRun(problem, message.result.value);
  store.setLabRun(run);
  if (message.judge) {
    store.setJudge(run);
    store.setRoute('result');
  }
}
