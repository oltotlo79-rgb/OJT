import { BUILTIN_INSPECT_PARTS_PROBLEMS, type JudgeInspectPartsResult } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectPartsResult } from '../src/renderer/result/InspectPartsResult.js';

/**
 * モードC1の結果画面（Plan 2B Task 11）。設計仕様 §9.1 / §8.3。
 */

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

const NO_HAZARDS = {
  'ohm-on-live': 0,
  'range-exceeded': 0,
  'short-circuit-power-on': 0,
  'power-sequence-violation': 0,
  'over-wires-per-terminal': 0,
  overcurrent: 0,
} as const;

function result(overrides: Partial<JudgeInspectPartsResult> = {}): JudgeInspectPartsResult {
  return {
    mode: 'inspect-parts',
    passed: true,
    correctCount: 2,
    total: 2,
    scores: [
      { partId: 'p1', truth: 'normal', answer: 'normal', correct: true },
      { partId: 'p2', truth: 'coil-open', answer: 'coil-open', correct: true },
    ],
    hazardCount: 0,
    hazardsByKind: { ...NO_HAZARDS },
    elapsedMs: 300_000,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('InspectPartsResult（§9.1 判定）', () => {
  it('全問正解なら合格を出す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result()}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('合格');
    expect(screen.getByTestId('correct-count').textContent).toContain('2 / 2');
  });

  it('間違いがあれば不合格で、行に正解と解答を並べる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({
          passed: false,
          correctCount: 1,
          scores: [
            { partId: 'p1', truth: 'coil-layer-short', answer: 'normal', correct: false },
            { partId: 'p2', truth: 'coil-open', answer: 'coil-open', correct: true },
          ],
        })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('不合格');
    const table = screen.getByTestId('mark-result-table');
    expect(table.textContent).toContain('レアショート');
    expect(table.textContent).toContain('正常');
    expect(screen.getByTestId('correct-count').textContent).toContain('1 / 2');
  });

  it('正解ごとに見分け方（期待される読み）を1行添える（UXレビュー #23）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({
          scores: [
            { partId: 'p1', truth: 'a-weld', answer: 'a-weld', correct: true },
            { partId: 'p2', truth: 'coil-open', answer: 'coil-open', correct: true },
          ],
        })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    // `DiagnosisHelp` の判定表と同じ文言（`DIAGNOSIS_TABLE` が唯一の源）
    expect(screen.getByTestId('reading-p1').textContent).toContain('OFF時に a接点 導通あり');
    expect(screen.getByTestId('reading-p2').textContent).toContain('コイルが吸引しない');
  });

  it('未解答は「—」で出す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({
          passed: false,
          correctCount: 1,
          scores: [
            { partId: 'p1', truth: 'normal', answer: undefined, correct: false },
            { partId: 'p2', truth: 'coil-open', answer: 'coil-open', correct: true },
          ],
        })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('answer-p1').textContent).toBe('—');
  });

  it('危険操作の回数を出す（復元分を足す。§5.6 / §12.3）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({
          hazardCount: 2,
          hazardsByKind: { ...NO_HAZARDS, 'ohm-on-live': 2 },
        })}
        restoredHazardCount={1}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('hazard-table').textContent).toContain('通電中のΩ／導通測定');
    expect(screen.getByText(/危険操作（3）/)).toBeTruthy();
  });

  it('標準時間内なら「標準時間内」を出す（C1-001は標準30分・打切50分）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({ elapsedMs: 10 * 60_000 })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('result-elapsed').textContent).toContain('標準時間');
    expect(screen.getByTestId('result-elapsed').textContent).toContain('内');
  });

  it('標準時間を超えたが打切前なら「標準時間を超過」を出す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({ elapsedMs: 40 * 60_000 })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('result-elapsed').textContent).toContain('標準時間');
    expect(screen.getByTestId('result-elapsed').textContent).toContain('超過');
  });

  it('打切時間を超えたら「打切り時間を超過」を出す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({ elapsedMs: 60 * 60_000 })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('result-elapsed').textContent).toContain('打切り時間');
    expect(screen.getByTestId('result-elapsed').textContent).toContain('超過');
  });

  it('problem.parts に無い partId は素の値のまま出す（種別を決め打ちしない。レビュー指摘 M5）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result({
          scores: [{ partId: 'phantom', truth: 'normal', answer: 'normal', correct: true }],
        })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    const table = screen.getByTestId('mark-result-table');
    expect(table.textContent).toContain('phantom');
    expect(table.textContent).not.toContain('（リレー）');
  });

  it('「もう一度」「課題一覧へ」が押せる', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const onRetry = vi.fn();
    const onBackToList = vi.fn();
    render(
      <InspectPartsResult
        problem={C1}
        result={result()}
        restoredHazardCount={0}
        onRetry={onRetry}
        onBackToList={onBackToList}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'もう一度' }));
    fireEvent.click(screen.getByRole('button', { name: '課題一覧へ' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onBackToList).toHaveBeenCalledTimes(1);
  });

  it('「もう一度／課題一覧へ」を画面下端に固定する（UXレビュー #8）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(
      <InspectPartsResult
        problem={C1}
        result={result()}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    const retry = screen.getByRole('button', { name: 'もう一度' });
    expect(retry.parentElement?.className).toMatch(/stickyActions/);
  });
});
