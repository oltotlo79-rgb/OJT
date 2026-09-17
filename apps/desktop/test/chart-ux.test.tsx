import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_PROBLEMS, buildReferenceSession, judgeAssemble } from '@ojt/content';
import type { TimeChart } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { chartEnlargeLabel, chartOpenerLabel, JA } from '../src/renderer/i18n/ja.js';
import {
  chartWidth,
  msToX,
  operationEdgeTimes,
  SMALL_GEOMETRY,
  tickPositions,
} from '../src/renderer/panels/chart-scale.js';
import { TimeChartSvg } from '../src/renderer/panels/TimeChartPanel.js';
import { ChartOverlay } from '../src/renderer/result/ChartOverlay.js';
import { shouldIgnoreShortcut } from '../src/renderer/session/interaction.js';

/**
 * タイムチャートの拡大表示と縦の補助線（Task CHART-UX）。設計仕様 §7.7 / §8.3。
 * 「クリックで拡大」「縦の補助線」「カーソルの時刻読み」の3点を画面側から確かめる。
 */

afterEach(cleanup);

const TITLE = JA.session.chart;

function chartOf(): TimeChart {
  return {
    durationMs: 5000,
    markers: [{ tMs: 3000, label: 'T1=3秒' }],
    signals: [
      {
        name: 'PB1',
        label: '黒押ボタン（PB1）',
        kind: 'input',
        segments: [
          { fromMs: 0, toMs: 500, value: false },
          { fromMs: 500, toMs: 800, value: true },
          { fromMs: 800, toMs: 5000, value: false },
        ],
      },
      {
        name: 'PL1',
        label: '白ランプ（PL1）',
        kind: 'output',
        segments: [
          { fromMs: 0, toMs: 500, value: false },
          { fromMs: 500, toMs: 2500, value: true },
          { fromMs: 2500, toMs: 5000, value: false },
        ],
      },
    ],
  };
}

/** happy-dom は矩形を返さないので、viewBox と同じ実寸だったことにする。 */
function fakeRect(element: Element): void {
  const width = chartWidth(SMALL_GEOMETRY);
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 200,
    width,
    height: 200,
    toJSON: () => ({}),
  });
}

function judgeResult() {
  const problem = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');
  if (problem === undefined) throw new Error('b-001 が見つかりません');
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路を作れませんでした');
  const judged = judgeAssemble(problem, JIPM_BOARD, built.value.session, { elapsedMs: 1000 });
  if (!judged.ok) throw new Error('判定できませんでした');
  return judged.value;
}

describe('縦の補助線（§7.7）', () => {
  it('目盛線と操作エッジの破線を立てる', () => {
    const chart = chartOf();
    render(<TimeChartSvg chart={chart} title={TITLE} testId="chart-spec" />);
    const svg = screen.getByTestId('chart-spec');
    expect(svg.querySelectorAll('[data-guide="tick"]')).toHaveLength(
      tickPositions(chart.durationMs).length,
    );
    expect(svg.querySelectorAll('[data-guide="edge"]')).toHaveLength(
      operationEdgeTimes(chart).length,
    );
  });

  it('目盛ラベルを秒で出す', () => {
    render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-spec" />);
    expect(screen.getByTestId('chart-spec').textContent).toContain('1.0 s');
  });
});

describe('カーソル線（§7.7）', () => {
  it('エッジの近くにポインタを置くとその時刻に吸い付く', () => {
    const chart = chartOf();
    render(<TimeChartSvg chart={chart} title={TITLE} testId="chart-spec" />);
    const svg = screen.getByTestId('chart-spec');
    fakeRect(svg);
    fireEvent.mouseMove(svg, {
      clientX: msToX(505, chart.durationMs, SMALL_GEOMETRY),
      clientY: 30,
    });
    expect(svg.querySelector('[data-guide="cursor"]')).toBeTruthy();
    expect(svg.textContent).toContain('0.50 s');
  });

  it('ポインタが外れるとカーソルは消える', () => {
    const chart = chartOf();
    render(<TimeChartSvg chart={chart} title={TITLE} testId="chart-spec" />);
    const svg = screen.getByTestId('chart-spec');
    fakeRect(svg);
    fireEvent.mouseMove(svg, {
      clientX: msToX(505, chart.durationMs, SMALL_GEOMETRY),
      clientY: 30,
    });
    fireEvent.mouseLeave(svg);
    expect(svg.querySelector('[data-guide="cursor"]')).toBeNull();
  });
});

describe('クリックで拡大（§8.1）', () => {
  it('チャートをクリックすると拡大モーダルが開く', () => {
    render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-spec" />);
    expect(screen.queryByTestId('chart-modal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: chartOpenerLabel(TITLE) }));
    const modal = screen.getByTestId('chart-modal');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain(TITLE);
  });

  it('Enter でも Space でも開く', () => {
    render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-spec" />);
    const opener = screen.getByRole('button', { name: chartOpenerLabel(TITLE) });
    fireEvent.keyDown(opener, { key: 'Enter' });
    expect(screen.getByTestId('chart-modal')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(opener, { key: ' ' });
    expect(screen.getByTestId('chart-modal')).toBeTruthy();
  });

  it('見出しの「拡大」ボタンからも開く', () => {
    render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-spec" />);
    fireEvent.click(screen.getByRole('button', { name: chartEnlargeLabel(TITLE) }));
    expect(screen.getByTestId('chart-modal')).toBeTruthy();
  });

  it('Esc で閉じてフォーカスが元のチャートへ戻る', () => {
    render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-spec" />);
    const opener = screen.getByRole('button', { name: chartOpenerLabel(TITLE) });
    fireEvent.click(opener);
    expect(document.activeElement).not.toBe(opener);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('chart-modal')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('× ボタンで閉じる', () => {
    render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-spec" />);
    fireEvent.click(screen.getByTestId('chart-enlarge-button'));
    fireEvent.click(screen.getByRole('button', { name: JA.timeChart.close }));
    expect(screen.queryByTestId('chart-modal')).toBeNull();
  });

  it('背景クリックで閉じる（中身のクリックでは閉じない）', () => {
    render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-spec" />);
    fireEvent.click(screen.getByTestId('chart-enlarge-button'));
    fireEvent.click(screen.getByTestId('chart-modal'));
    expect(screen.getByTestId('chart-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chart-backdrop'));
    expect(screen.queryByTestId('chart-modal')).toBeNull();
  });

  it('開いているあいだは盤のショートカットを通さない（§8.2）', () => {
    render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-spec" />);
    expect(shouldIgnoreShortcut({ target: document.body })).toBe(false);
    fireEvent.click(screen.getByTestId('chart-enlarge-button'));
    expect(shouldIgnoreShortcut({ target: document.body })).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(shouldIgnoreShortcut({ target: document.body })).toBe(false);
  });

  it('拡大表示は信号名を14px以上で描く', () => {
    render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-spec" />);
    fireEvent.click(screen.getByTestId('chart-enlarge-button'));
    const label = screen
      .getByTestId('chart-modal')
      .querySelector<SVGTextElement>('[data-role="row-label"]');
    expect(label).toBeTruthy();
    expect(Number.parseFloat(label?.style.fontSize ?? '0')).toBeGreaterThanOrEqual(14);
  });
});

describe('結果画面の拡大（§8.3）', () => {
  it('期待と実際を1つの時間軸に積んで出す', () => {
    const result = judgeResult();
    render(
      <ChartOverlay
        expected={result.charts.expected}
        actual={result.charts.actual}
        mismatches={result.mismatches}
      />,
    );
    fireEvent.click(screen.getByTestId('chart-enlarge-button'));
    const modal = screen.getByTestId('chart-modal');
    // 期待と実際は同じ1枚のSVG（＝同じ時間軸）に並ぶ
    expect(modal.querySelectorAll('svg')).toHaveLength(1);
    expect(modal.textContent).toContain(JA.timeChart.expected);
    expect(modal.textContent).toContain(JA.timeChart.actual);
    const rows = modal.querySelectorAll('[data-role="row-label"]');
    expect(rows.length).toBe(result.charts.expected.signals.length * 2 + 2);
  });

  it('差分のある区間を強調する', () => {
    const result = judgeResult();
    const mismatches = [
      { signal: 'PL1', tMs: 500, expected: true, actual: false, reason: 'missing' as const },
    ];
    render(
      <ChartOverlay
        expected={result.charts.expected}
        actual={result.charts.actual}
        mismatches={mismatches}
      />,
    );
    expect(
      screen.getByTestId('chart-overlay').querySelectorAll('[data-role="mismatch"]').length,
    ).toBeGreaterThan(0);
  });
});
