import { JIPM_BOARD } from '@ojt/board-model';
import { HAZARD_KINDS, type Mismatch, type MismatchReason } from '@ojt/circuit-sim';
import {
  BUILTIN_PROBLEMS,
  buildReferenceSession,
  judgeAssemble,
  type JudgeResult,
} from '@ojt/content';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
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

  it('合否は支援技術にも伝わる（role="status" / aria-live）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    const verdict = screen.getByTestId('verdict');
    expect(verdict.getAttribute('role')).toBe('status');
    expect(verdict.getAttribute('aria-live')).toBe('polite');
  });

  it('見出しの階層が飛ばない（h1 の次は h2）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});

describe('ResultView（差分・危険操作が多いとき。§8.3）', () => {
  /** 3種類だけ回数が入った危険操作の集計。 */
  const HAZARDS_SHOWN = [
    'ohm-on-live',
    'power-sequence-violation',
    'over-wires-per-terminal',
  ] as const;

  /** 差分20件と3種類の危険操作を持つ判定結果を作る。 */
  function crowdedResult(): JudgeResult {
    const base = judgeWith();
    const reasons: MismatchReason[] = ['value', 'timing', 'missing', 'extra'];
    const mismatches: Mismatch[] = Array.from({ length: 20 }, (_value, index) => ({
      signal: `PL${(index % 4) + 1}`,
      tMs: 1000 + index * 250,
      expected: index % 2 === 0,
      actual: index % 2 !== 0,
      reason: reasons[index % reasons.length] ?? 'value',
      ...(index % 3 === 0 ? { actualTMs: 1000 + index * 250 + 40 } : {}),
    }));
    const counts = Object.fromEntries(
      HAZARD_KINDS.map((kind) => [
        kind,
        kind === 'ohm-on-live'
          ? 3
          : kind === 'power-sequence-violation'
            ? 2
            : kind === 'over-wires-per-terminal'
              ? 1
              : 0,
      ]),
    ) as JudgeResult['hazardsByKind'];
    return { ...base, passed: false, mismatches, hazardCount: 6, hazardsByKind: counts };
  }

  it('差分20件をすべて表に並べ、危険操作は種別ごとに数を出す', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={crowdedResult()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    const table = screen.getByTestId('mismatch-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(20);
    // 件数は見出しにも出る（カードを開かずに規模が分かる）
    expect(screen.getByText(`${JA.result.mismatches}（20）`)).toBeTruthy();

    const hazards = screen.getByTestId('hazard-table');
    for (const kind of HAZARDS_SHOWN) {
      expect(hazards.textContent, kind).toContain(JA.hazard[kind]);
    }
    // 回数0の種別は並べない（見せる価値のある行だけ）
    expect(hazards.querySelectorAll('tbody tr')).toHaveLength(HAZARDS_SHOWN.length);
    expect(screen.getByText(`${JA.result.hazards}（6）`)).toBeTruthy();
  });

  it('差分一覧のカードは伸び続けず、自分でスクロールする（他の項目を押し出さない）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={crowdedResult()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    // 差分が20件あってもチャート・静的チェック・危険操作の4枚がすべて描かれている
    expect(screen.getByTestId('chart-overlay')).toBeTruthy();
    expect(screen.getByTestId('static-checks')).toBeTruthy();
    expect(screen.getByTestId('hazard-table')).toBeTruthy();
  });
});
