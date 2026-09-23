import { BUILTIN_PLC_PROBLEMS, BUILTIN_PROBLEMS, type JudgePlcResult } from '@ojt/content';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { PlcResult } from '../src/renderer/result/PlcResult.js';
import { Result } from '../src/renderer/screens/Result.js';

/**
 * モードDの結果画面（Plan 3B Task 13）。設計仕様 §10.8。
 * 合否を先に大きく、次に「なぜそうなったか」を訓練者の言葉で、その後に波形を並べる
 * （2026-09-19 の利用者決定「分かりやすく直感的に」）。
 */

afterEach(cleanup);

const problem = BUILTIN_PLC_PROBLEMS[0];

function result(overrides: Partial<JudgePlcResult> = {}): JudgePlcResult {
  return {
    mode: 'plc',
    passed: true,
    mismatches: [],
    staticChecks: [
      {
        id: 'twoStage',
        ok: true,
        message: 'PLC出力 → 盤のリレー → 表示灯の2段結線になっています',
        details: [],
      },
      { id: 'plcPowerIndependent', ok: true, message: '壁コンセントから取っています', details: [] },
      { id: 'ioAssignment', ok: true, message: '割付どおりです', details: [] },
    ],
    hazardCount: 0,
    hazardsByKind: {
      'ohm-on-live': 0,
      'range-exceeded': 0,
      'short-circuit-power-on': 0,
      'power-sequence-violation': 0,
      'over-wires-per-terminal': 0,
      overcurrent: 0,
    },
    chatter: [],
    elapsedMs: 600_000,
    charts: {
      expected: { signals: [], durationMs: 6000, markers: [] },
      actual: { signals: [], durationMs: 6000, markers: [] },
    },
    compareSignals: ['PL1'],
    ladderErrors: [],
    ladderWarnings: [],
    ...overrides,
  };
}

describe('モードDの結果画面（§10.8）', () => {
  it('合否・所要時間・モードDの3チェックを出す', () => {
    if (problem === undefined) throw new Error('モードDの課題がありません');
    render(
      <PlcResult
        problem={problem}
        result={result()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('verdict')).toHaveTextContent('合格');
    expect(screen.getByTestId('static-check-twoStage')).toHaveTextContent('二段構成');
    expect(screen.getByTestId('static-checks')).toHaveTextContent('PLC電源の独立');
    expect(screen.getByTestId('static-checks')).toHaveTextContent('I/O割付');
    expect(screen.getByTestId('result-elapsed')).toHaveTextContent('10:00.0');
  });

  it('合格なら理由の欄で一致したことを伝え、見比べた信号を出す', () => {
    if (problem === undefined) throw new Error('モードDの課題がありません');
    render(
      <PlcResult
        problem={problem}
        result={result()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('plc-why-passed')).toHaveTextContent('模範回路と同じ動作');
    expect(screen.getByTestId('compare-signals')).toHaveTextContent('PL1');
  });

  it('不合格の理由を合否のすぐ下に、直し方まで添えて並べる（利用者決定 2026-09-19）', () => {
    if (problem === undefined) throw new Error('モードDの課題がありません');
    render(
      <PlcResult
        problem={problem}
        result={result({
          passed: false,
          staticChecks: [
            {
              id: 'twoStage',
              ok: false,
              message: 'PLCの出力を表示灯へ直結しています',
              details: ['PLC.Y0 がリレー CR1 のコイル（CR1.14）に繋がっていません'],
            },
          ],
          mismatches: [
            { signal: 'PL1', tMs: 1200, expected: true, actual: false, reason: 'value' },
          ],
        })}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    const why = screen.getByTestId('plc-why');
    expect(why).toHaveTextContent('二段構成');
    expect(why).toHaveTextContent('CR1.14');
    expect(why).toHaveTextContent('PL1');
    expect(why).toHaveTextContent('1.20');
  });

  it('PLC電源の独立の2つの落ち方を説明する（H-5）', () => {
    if (problem === undefined) throw new Error('モードDの課題がありません');
    render(
      <PlcResult
        problem={problem}
        result={result({
          passed: false,
          staticChecks: [
            {
              id: 'plcPowerIndependent',
              ok: false,
              message: 'PLCの電源が盤から取られています',
              details: ['PLC.L が P.1 と同じ節点にあります'],
            },
          ],
        })}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    const panel = screen.getByTestId('plc-power-help');
    expect(panel).toHaveTextContent('壁コンセント');
    expect(panel).toHaveTextContent('未配線では運転できません');
  });

  it('変換エラーは何よりも上に出す（H-1）', () => {
    if (problem === undefined) throw new Error('モードDの課題がありません');
    render(
      <PlcResult
        problem={problem}
        result={result({
          passed: false,
          ladderErrors: [{ code: 'missing-end', networkId: '', message: 'END がありません' }],
        })}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('ladder-errors')).toHaveTextContent('END がありません');
    expect(screen.getByTestId('ladder-errors')).toHaveTextContent('シミュレートされていません');
  });

  it('二重コイルは注意として出し、不合格にはしない', () => {
    if (problem === undefined) throw new Error('モードDの課題がありません');
    render(
      <PlcResult
        problem={problem}
        result={result({
          ladderWarnings: [
            {
              code: 'double-coil',
              networkId: 'n2',
              row: 0,
              col: 15,
              device: { kind: 'output', index: 0 },
              message: 'Y0 のコイルが2回以上あります',
            },
          ],
        })}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('verdict')).toHaveTextContent('合格');
    expect(screen.getByTestId('ladder-warnings')).toHaveTextContent('二重コイル');
  });

  it('危険操作は復元した分も足して数える', () => {
    if (problem === undefined) throw new Error('モードDの課題がありません');
    render(
      <PlcResult
        problem={problem}
        result={result({
          hazardCount: 2,
          hazardsByKind: { ...result().hazardsByKind, 'over-wires-per-terminal': 2 },
        })}
        restoredHazardCount={1}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: /危険操作（3）/u })).toBeInTheDocument();
  });
});

/** MERGE 注意 #9: `Result.tsx` の振り分け。 */
describe('結果画面のルート（モードD）', () => {
  afterEach(() => {
    useStore.setState({ problem: undefined, judge: undefined, restoredHazardCount: 0 });
  });

  it('モードDの課題と判定結果ならモードDの結果画面を出す', () => {
    if (problem === undefined) throw new Error('モードDの課題がありません');
    useStore.setState({ problem, judge: result() });
    render(<Result />);
    expect(screen.getByTestId('plc-why')).toBeTruthy();
    expect(screen.getByTestId('verdict')).toHaveTextContent('合格');
  });

  it('課題と判定結果のモードが食い違っていれば一覧へ戻す導線だけを出す', () => {
    const assemble = BUILTIN_PROBLEMS[0];
    if (assemble === undefined) throw new Error('課題がありません');
    useStore.setState({ problem: assemble, judge: result() });
    render(<Result />);
    expect(screen.getByText(JA.result.noResult)).toBeTruthy();
  });
});
