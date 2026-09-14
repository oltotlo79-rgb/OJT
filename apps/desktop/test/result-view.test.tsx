import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_PROBLEMS, buildReferenceSession, judgeAssemble } from '@ojt/content';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ResultView } from '../src/renderer/result/ResultView.js';

/**
 * 結果画面の表示テスト（§14.2 の「UI: Vitest ＋ Testing Library」）。
 * 判定結果は実物の `judgeAssemble()` から作り、画面がその中身をそのまま出すことを確かめる。
 */

afterEach(cleanup);

const PROBLEM = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');

function judgeWith(mutate: (session: ReturnType<typeof reference>) => void = () => undefined) {
  const session = reference();
  mutate(session);
  if (PROBLEM === undefined) throw new Error('b-001 が見つかりません');
  const result = judgeAssemble(PROBLEM, JIPM_BOARD, session, { elapsedMs: 90_000 });
  if (!result.ok) throw new Error('模範回路を作れませんでした');
  return result.value;
}

function reference() {
  if (PROBLEM === undefined) throw new Error('b-001 が見つかりません');
  const built = buildReferenceSession(PROBLEM, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路を作れませんでした');
  return built.value.session;
}

describe('ResultView', () => {
  it('模範回路そのままなら合格を出し、差分一覧は空になる（§8.3）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('合格');
    expect(screen.getByTestId('no-mismatch')).toBeTruthy();
    expect(screen.getByTestId('chart-overlay')).toBeTruthy();
    expect(screen.getByTestId('static-checks')).toBeTruthy();
  });

  it('電線を1本外すと不合格になり差分表が出る（§16 Phase 1 受入基準③）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith((session) => {
          const target = session.wires.find((w) => !w.locked);
          session.wires = session.wires.filter((w) => w.id !== target?.id);
        })}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('不合格');
    expect(screen.getByTestId('mismatch-table')).toBeTruthy();
  });

  it('所要時間を標準時間との対比付きで出す（§8.3）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('result-elapsed').textContent).toContain('01:30.0');
    expect(screen.getByTestId('result-elapsed').textContent).toContain('標準時間');
  });
});
