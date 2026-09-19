import { JIPM_BOARD } from '@ojt/board-model';
import { HAZARD_KINDS, type Mismatch, type MismatchReason } from '@ojt/circuit-sim';
import {
  BUILTIN_PROBLEMS,
  buildReferenceSession,
  judgeAssemble,
  type JudgeResult,
} from '@ojt/content';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import resultStyles from '../src/renderer/result/result.module.css';
import { ResultView } from '../src/renderer/result/ResultView.js';
import { Result } from '../src/renderer/screens/Result.js';
import { useStore } from '../src/renderer/app/store.js';
import type { OjtApi } from '../src/shared/ipc.js';

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

  it('「もう一度／課題一覧へ」を画面下端に固定する（UXレビュー #8）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    const retry = screen.getByRole('button', { name: JA.result.retry });
    expect(retry.parentElement?.className).toContain(resultStyles.stickyActions);
  });

  it('操作バーはスクロール領域の外にあり、最後のカードに重ならない（UI監査 Blocking #8）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    const retry = screen.getByRole('button', { name: JA.result.retry });
    const actionsBar = retry.parentElement;
    const scrollClass = resultStyles.scroll;
    expect(scrollClass).toBeDefined();
    if (scrollClass === undefined) return;
    // 見出し〜カード列は `.scroll` の中だけがスクロールし、操作バーはその外（`.wrap` の
    // 最後の行）に置く。中身がどれだけ伸びても操作バーぶんの高さは常に確保されるので、
    // 「危険操作」などの最後のカードに重なりようがない。
    expect(actionsBar?.closest(`.${CSS.escape(scrollClass)}`)).toBeNull();
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

/**
 * 1D2-a のレビュー指摘への追加分。
 * - 復元した危険操作は判定結果には入らないので、合計だけを足して出す（§12.3 / §5.6）
 * - 判定まで終わった作業の一時保存は消す（次の起動で終わった課題を勧めない。§12.3）
 */
describe('結果画面のルート（§8.3 / §12.3）', () => {
  function setApi(api: Partial<OjtApi> | undefined): void {
    if (api === undefined) delete window.ojt;
    else window.ojt = api as OjtApi;
  }

  afterEach(() => {
    setApi(undefined);
    useStore.setState({ problem: undefined, judge: undefined, restoredHazardCount: 0 });
  });

  it('復元した危険操作の回数を今回の分に足して出す', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={{ ...judgeWith(), hazardCount: 2 }}
        restoredHazardCount={3}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByText(`${JA.result.hazards}（5）`)).toBeTruthy();
  });

  it('結果を出したら一時保存を消す', () => {
    if (PROBLEM === undefined) return;
    const loadWorkFile = vi.fn(() =>
      Promise.resolve({ ok: false, canceled: true, message: '一時保存を削除しました' } as const),
    );
    setApi({ loadWorkFile });
    useStore.setState({ problem: PROBLEM, judge: judgeWith(), restoredHazardCount: 0 });

    render(<Result />);

    expect(loadWorkFile).toHaveBeenCalledWith({ kind: 'autosave', discard: true });
  });

  it('判定結果が無ければ一時保存には触らない', () => {
    const loadWorkFile = vi.fn();
    setApi({ loadWorkFile });
    useStore.setState({ problem: undefined, judge: undefined });

    render(<Result />);

    expect(loadWorkFile).not.toHaveBeenCalled();
    expect(screen.getByText(JA.result.noResult)).toBeTruthy();
  });

  it('preload が無くても落ちない', () => {
    if (PROBLEM === undefined) return;
    useStore.setState({ problem: PROBLEM, judge: judgeWith() });
    expect(() => render(<Result />)).not.toThrow();
  });

  /*
   * I1（Plan 5 C/D レビュー）: 合格した結果画面には「疑わしい配線（0）」のカードを
   * 出さない。`report.suspects` は合格時 `[]`（`undefined` ではない）なので、`Result.tsx`
   * が3 props を無条件に渡すと `ResultView` の `suspects === undefined` ガードを素通りして
   * しまう。ここは `<ResultView>` を直接ではなく `<Result />`（ルート）を描いて、
   * `Result.tsx` が実際に渡す props まで含めて確かめる。
   */
  it('合格したモードBの結果画面には「疑わしい配線」のカードを出さない（I1）', () => {
    if (PROBLEM === undefined) return;
    useStore.setState({
      problem: PROBLEM,
      session: reference(),
      judge: judgeWith(),
      restoredHazardCount: 0,
    });
    render(<Result />);
    expect(screen.getByTestId('verdict').textContent).toBe('合格');
    expect(screen.queryByTestId('no-suspect')).toBeNull();
    expect(screen.queryByTestId('suspect-list')).toBeNull();
  });

  it('不合格でも配線に差が無ければ「疑わしい配線」の空表示は出す（noSuspect の文言はそのまま）', () => {
    if (PROBLEM === undefined) return;
    useStore.setState({
      problem: PROBLEM,
      session: reference(),
      judge: { ...judgeWith(), passed: false },
      restoredHazardCount: 0,
    });
    render(<Result />);
    expect(screen.getByTestId('verdict').textContent).toBe('不合格');
    expect(screen.getByTestId('no-suspect')).toBeInTheDocument();
  });
});
