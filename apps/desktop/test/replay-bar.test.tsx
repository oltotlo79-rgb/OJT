import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReplayBar } from '../src/renderer/panels/ReplayBar.js';
import { replaySteps } from '../src/renderer/session/replay.js';

afterEach(cleanup);
const steps = replaySteps(
  [
    { t: 0, target: 'PB1', action: 'press' },
    { t: 500, target: 'PB1', action: 'release' },
  ],
  1000,
  [{ tMs: 500, signal: 'PL1', expected: true, actual: false, reason: 'missing' }],
);
it('前へ・次へ・最初から・終了と終端の押せない理由', () => {
  const stop = vi.fn();
  function Harness() {
    const [index, setIndex] = useState(0);
    return <ReplayBar step={steps[index]!} busy={false} onStep={setIndex} onStop={stop} />;
  }
  render(<Harness />);
  expect(screen.getByTestId('replay-prev')).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByTestId('replay-prev'));
  fireEvent.click(screen.getByTestId('replay-next'));
  expect(screen.getByTestId('replay-next')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTestId('replay-next')).toHaveAttribute('title', '最後の区間です。');
  expect(screen.getByTestId('replay-mismatch')).toHaveTextContent('▲');
  expect(screen.getByTestId('replay-mismatch')).toHaveTextContent('白ランプ（PL1）');
  fireEvent.click(screen.getByTestId('replay-next'));
  fireEvent.click(screen.getByTestId('replay-restart'));
  expect(screen.queryByTestId('replay-mismatch')).toBeNull();
  fireEvent.click(screen.getByTestId('replay-stop'));
  expect(stop).toHaveBeenCalledOnce();
});
it('計算中は連打を止めるが終了はできる', () => {
  const step = vi.fn();
  const stop = vi.fn();
  render(<ReplayBar step={steps[0]!} busy onStep={step} onStop={stop} />);
  fireEvent.click(screen.getByTestId('replay-next'));
  fireEvent.click(screen.getByTestId('replay-restart'));
  expect(step).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('replay-stop'));
  expect(stop).toHaveBeenCalledOnce();
});
