import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_PROBLEMS, buildReferenceSession, judgeAssemble } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { CompareEntry } from '../src/renderer/result/CompareView.js';

afterEach(() => {
  cleanup();
  useStore.getState().abandonSession();
});
function show(grade: 1 | 3): void {
  const problem = BUILTIN_PROBLEMS.find((p) => p.grade === grade)!;
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error('reference');
  built.value.session.wires = [];
  const judged = judgeAssemble(problem, JIPM_BOARD, built.value.session);
  if (!judged.ok) throw new Error('judge');
  useStore.getState().openProblem(problem);
  useStore.setState({ judge: judged.value, session: built.value.session });
  render(<CompareEntry />);
  const opener = screen.getByTestId('compare-open');
  opener.focus();
  fireEvent.click(opener);
}

it('1級では回路図をマウントせず、時刻と▲で差を示す', () => {
  show(1);
  expect(screen.queryByTestId('compare-reference')).toBeNull();
  expect(screen.getByTestId('compare-reference-hidden')).toHaveTextContent(
    '模範ラダーを表示しません',
  );
  expect(screen.getByTestId('compare-differences')).toHaveTextContent('▲');
  expect(screen.getByTestId('compare-differences')).toHaveTextContent('秒');
  expect(
    screen.getByTestId('compare-chart').querySelectorAll('[data-role=mismatch]').length,
  ).toBeGreaterThan(0);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByTestId('compare-dialog')).toBeNull();
  expect(screen.getByTestId('compare-open')).toHaveFocus();
});
it('3級では模範図と接続の差が読め、拡大からEscで比較へ戻る', () => {
  show(3);
  expect(screen.getByTestId('compare-reference')).toBeTruthy();
  fireEvent.click(screen.getByTestId('chart-enlarge-button'));
  expect(screen.getByTestId('chart-modal')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByTestId('chart-modal')).toBeNull();
  expect(screen.getByTestId('compare-dialog')).toBeTruthy();
  fireEvent.click(screen.getByTestId('compare-close'));
  expect(screen.getByTestId('compare-open')).toHaveFocus();
});
