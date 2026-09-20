import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  BUILTIN_PROBLEMS,
  buildReferenceSession,
  judgeAssemble,
  type JudgeInspectPartsResult,
  type JudgeInspectRepairResult,
  type JudgePlcResult,
} from '@ojt/content';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InspectPartsResult } from '../src/renderer/result/InspectPartsResult.js';
import { InspectRepairResult } from '../src/renderer/result/InspectRepairResult.js';
import { PlcResult } from '../src/renderer/result/PlcResult.js';
import { ResultView } from '../src/renderer/result/ResultView.js';
import { JA } from '../src/renderer/i18n/ja.js';

/**
 * 4つの結果画面の外殻（`ResultShell`）。設計仕様 §8.3（指摘 UI-13）。
 *
 * モードDだけ `.stickyActions` を付け忘れて下端バーの境目が消えていた。外殻を1本にした
 * いま、4画面とも同じ下端バーになっていることをここで固定する（次に画面が増えても外れない）。
 */

afterEach(cleanup);

const NO_HAZARDS = {
  'ohm-on-live': 0,
  'range-exceeded': 0,
  'short-circuit-power-on': 0,
  'power-sequence-violation': 0,
  'over-wires-per-terminal': 0,
  overcurrent: 0,
} as const;

const EMPTY_CHART = (): JudgeInspectRepairResult['charts']['expected'] => ({
  durationMs: 1000,
  signals: [],
  markers: [],
});

const B = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');
const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
const D = BUILTIN_PLC_PROBLEMS[0];

/** モードBの判定結果（模範回路そのまま＝合格）。 */
function assembleResult() {
  if (B === undefined) throw new Error('b-001 が見つかりません');
  const built = buildReferenceSession(B, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路を作れませんでした');
  const judged = judgeAssemble(B, JIPM_BOARD, built.value.session, { elapsedMs: 90_000 });
  if (!judged.ok) throw new Error('判定できませんでした');
  return judged.value;
}

const partsResult: JudgeInspectPartsResult = {
  mode: 'inspect-parts',
  passed: true,
  correctCount: 1,
  total: 1,
  scores: [{ partId: 'p1', truth: 'normal', answer: 'normal', correct: true }],
  hazardCount: 0,
  hazardsByKind: { ...NO_HAZARDS },
  elapsedMs: 300_000,
};

const repairResult: JudgeInspectRepairResult = {
  mode: 'inspect-repair',
  passed: true,
  reports: { matched: [], missed: [], extra: [] },
  mismatches: [],
  staticChecks: [],
  modifications: [],
  addedWires: [],
  hazardCount: 0,
  hazardsByKind: { ...NO_HAZARDS },
  chatter: [],
  elapsedMs: 600_000,
  charts: { expected: EMPTY_CHART(), actual: EMPTY_CHART() },
  compareSignals: ['PL1'],
};

const plcResult: JudgePlcResult = {
  mode: 'plc',
  passed: true,
  mismatches: [],
  staticChecks: [],
  hazardCount: 0,
  hazardsByKind: { ...NO_HAZARDS },
  chatter: [],
  elapsedMs: 600_000,
  charts: { expected: EMPTY_CHART(), actual: EMPTY_CHART() },
  compareSignals: ['PL1'],
  ladderErrors: [],
  ladderWarnings: [],
};

/** 4画面ぶんの描画（`children` 以外は同じ形で呼べる）。 */
function screens(): ReadonlyArray<readonly [string, () => void]> {
  return [
    [
      'モードB',
      () => {
        if (B === undefined) throw new Error('b-001 が見つかりません');
        render(
          <ResultView
            problem={B}
            result={assembleResult()}
            onRetry={() => undefined}
            onBackToList={() => undefined}
          />,
        );
      },
    ],
    [
      'モードC1',
      () => {
        if (C1 === undefined) throw new Error('C1の課題がありません');
        render(
          <InspectPartsResult
            problem={C1}
            result={partsResult}
            onRetry={() => undefined}
            onBackToList={() => undefined}
          />,
        );
      },
    ],
    [
      'モードC2',
      () => {
        if (C2 === undefined) throw new Error('C2の課題がありません');
        render(
          <InspectRepairResult
            problem={C2}
            result={repairResult}
            onRetry={() => undefined}
            onBackToList={() => undefined}
          />,
        );
      },
    ],
    [
      'モードD',
      () => {
        if (D === undefined) throw new Error('モードDの課題がありません');
        render(
          <PlcResult
            problem={D}
            result={plcResult}
            onRetry={() => undefined}
            onBackToList={() => undefined}
          />,
        );
      },
    ],
  ];
}

describe('結果画面の外殻（UI-13）', () => {
  for (const [name, mount] of screens()) {
    it(`${name}: 下端の操作バーが .stickyActions を持つ`, () => {
      mount();
      const retry = screen.getByRole('button', { name: JA.result.retry });
      const bar = retry.parentElement;
      expect(bar?.className).toMatch(/stickyActions/);
      expect(bar?.className).toMatch(/actions/);
      cleanup();
    });

    it(`${name}: 合否と所要時間を同じ目印で出す`, () => {
      mount();
      expect(screen.getByTestId('verdict').textContent).toBe(JA.result.passed);
      expect(screen.getByTestId('result-elapsed').textContent).toContain(JA.result.elapsed);
      expect(screen.getByRole('button', { name: JA.result.toList })).toBeTruthy();
      cleanup();
    });
  }
});
