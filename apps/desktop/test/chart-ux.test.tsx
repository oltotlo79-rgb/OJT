import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_PROBLEMS, buildReferenceSession, judgeAssemble } from '@ojt/content';
import type { TimeChart } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JSX } from 'react';
import { chartEnlargeLabel, chartOpenerLabel, JA } from '../src/renderer/i18n/ja.js';
import {
  chartWidth,
  msToX,
  niceTickStep,
  operationEdgeTimes,
  SMALL_GEOMETRY,
  SNAP_TOLERANCE_PX,
  tickPositions,
  timeReadout,
} from '../src/renderer/panels/chart-scale.js';
import { ChartCanvas, type ChartFigure } from '../src/renderer/panels/TimeChartView.js';
import { TimeChartSvg } from '../src/renderer/panels/TimeChartPanel.js';
import { ChartOverlay } from '../src/renderer/result/ChartOverlay.js';
import { isModalOpen, shouldIgnoreShortcut } from '../src/renderer/session/interaction.js';

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

  it('模範・訓練者・差分の凡例を小さい図と拡大表示の両方に出す（UXレビュー #7）', () => {
    const result = judgeResult();
    render(
      <ChartOverlay
        expected={result.charts.expected}
        actual={result.charts.actual}
        mismatches={result.mismatches}
      />,
    );
    // 小さい図の上に1つ
    expect(screen.getAllByTestId('chart-legend')).toHaveLength(1);
    const before = screen.getAllByTestId('chart-legend')[0];
    expect(before?.textContent).toContain(JA.chartLegend.expected);
    expect(before?.textContent).toContain(JA.chartLegend.actual);
    expect(before?.textContent).toContain(JA.chartLegend.diff);

    // 拡大したモーダルの中にも同じ凡例が出る
    fireEvent.click(screen.getByTestId('chart-enlarge-button'));
    expect(screen.getAllByTestId('chart-legend')).toHaveLength(2);
  });
});

/** 操作の変化点を `count` 個持つチャート（破線の数を作為的に作る）。 */
function chartWithEdges(count: number): TimeChart {
  const segments = [] as TimeChart['signals'][number]['segments'];
  let from = 0;
  let value = false;
  for (let i = 0; i < count; i += 1) {
    const to = from + 100;
    segments.push({ fromMs: from, toMs: to, value });
    from = to;
    value = !value;
  }
  segments.push({ fromMs: from, toMs: from + 200, value });
  return {
    durationMs: from + 200,
    markers: [],
    signals: [{ name: 'PB1', label: 'PB1', kind: 'input', segments }],
  };
}

describe('小さいチャートの破線を絞る（§7.7 レビュー Minor 2）', () => {
  it('操作エッジが多い課題では小さいチャートの破線を省き、拡大表示は全部出す', () => {
    const chart = chartWithEdges(18);
    expect(operationEdgeTimes(chart).length).toBe(18);
    render(<TimeChartSvg chart={chart} title={TITLE} testId="chart-busy" />);
    const small = screen.getByTestId('chart-busy');
    expect(small.querySelectorAll('[data-guide="edge"]')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('chart-enlarge-button'));
    const large = screen.getByTestId('chart-busy-large');
    expect(large.querySelectorAll('[data-guide="edge"]')).toHaveLength(18);
  });

  it('操作エッジが少なければ小さいチャートにも拡大表示にも全部出す', () => {
    const chart = chartWithEdges(4);
    expect(operationEdgeTimes(chart).length).toBe(4);
    render(<TimeChartSvg chart={chart} title={TITLE} testId="chart-light" />);
    const small = screen.getByTestId('chart-light');
    expect(small.querySelectorAll('[data-guide="edge"]')).toHaveLength(4);
    fireEvent.click(screen.getByTestId('chart-enlarge-button'));
    const large = screen.getByTestId('chart-light-large');
    expect(large.querySelectorAll('[data-guide="edge"]')).toHaveLength(4);
  });
});

describe('モーダル層の後始末（§8.1 レビュー Minor 6）', () => {
  it('開いたまま unmount しても isModalOpen() が戻る', () => {
    const view = render(<TimeChartSvg chart={chartOf()} title={TITLE} testId="chart-um" />);
    fireEvent.click(screen.getByTestId('chart-enlarge-button'));
    expect(isModalOpen()).toBe(true);
    view.unmount();
    expect(isModalOpen()).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('2枚重なったとき、Esc は上の1枚だけ閉じる。両方閉じれば overflow も戻る', () => {
    const before = document.body.style.overflow;
    render(
      <div>
        <TimeChartSvg chart={chartOf()} title="A" testId="chart-a" />
        <TimeChartSvg chart={chartOf()} title="B" testId="chart-b" />
      </div>,
    );
    const buttons = screen.getAllByTestId('chart-enlarge-button');
    fireEvent.click(buttons[0] as HTMLElement);
    fireEvent.click(buttons[1] as HTMLElement);
    expect(document.querySelectorAll('[data-testid="chart-modal"]')).toHaveLength(2);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelectorAll('[data-testid="chart-modal"]')).toHaveLength(1);
    expect(isModalOpen()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelectorAll('[data-testid="chart-modal"]')).toHaveLength(0);
    expect(isModalOpen()).toBe(false);
    expect(document.body.style.overflow).toBe(before);
  });
});

describe('カーソルの再描画とチップ（§7.7 レビュー Minor 4）', () => {
  it('ポインタ移動では波形（ChartCanvas の親）は再描画されない', () => {
    let canvasRenders = 0;
    const figure: ChartFigure = {
      durationMs: 5000,
      markers: [],
      edges: [500, 800],
      snaps: [500, 800, 2500],
      rows: [
        {
          key: 'a',
          label: 'PB1',
          waves: [{ key: 'v', className: 'w', segments: chartOf().signals[0]!.segments }],
        },
      ],
    };
    function Counted(): JSX.Element {
      canvasRenders += 1;
      return <ChartCanvas figure={figure} geom={SMALL_GEOMETRY} title="T" testId="chart-cr" />;
    }
    render(<Counted />);
    const svg = screen.getByTestId('chart-cr');
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: chartWidth(SMALL_GEOMETRY),
        bottom: 200,
        width: chartWidth(SMALL_GEOMETRY),
        height: 200,
        toJSON: () => ({}),
      }),
    });
    const before = canvasRenders;
    for (let i = 0; i < 5; i += 1) {
      fireEvent.mouseMove(svg, {
        clientX: msToX(1000 + i * 37, 5000, SMALL_GEOMETRY),
        clientY: 30,
      });
    }
    expect(canvasRenders).toBe(before);
  });

  it('カーソルのチップは t === durationMs でも右へはみ出さない', () => {
    const geom = SMALL_GEOMETRY;
    const t = 5000;
    const x = msToX(t, 5000, geom);
    const text = timeReadout(t);
    const chipWidth = text.length * geom.tickFont * 0.62 + 8;
    const flip = x + chipWidth + 4 > geom.labelWidth + geom.plotWidth;
    const chipX = flip ? x - chipWidth - 3 : x + 3;
    expect(chipX + chipWidth).toBeLessThanOrEqual(chartWidth(geom));
  });
});

describe('吸い付き許容幅のクランプ（§7.7 レビュー Minor 7）', () => {
  it('30秒チャートでは画面上6px換算の許容幅が刻みの1/4を超えないようクランプする', () => {
    const durationMs = 30000;
    const chart: TimeChart = {
      durationMs,
      markers: [],
      signals: [
        {
          name: 'PB1',
          label: 'PB1',
          kind: 'input',
          segments: [
            { fromMs: 0, toMs: 10000, value: false },
            { fromMs: 10000, toMs: durationMs, value: true },
          ],
        },
      ],
    };
    render(<TimeChartSvg chart={chart} title={TITLE} testId="chart-clamp" />);
    const svg = screen.getByTestId('chart-clamp');
    const viewWidth = chartWidth(SMALL_GEOMETRY);
    const scale = 0.3; // ズームアウトして、画面上6pxが時間換算で大きくなる状況を作る
    const rectWidth = viewWidth * scale;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: rectWidth,
        bottom: 200,
        width: rectWidth,
        height: 200,
        toJSON: () => ({}),
      }),
    });

    const tickStep = niceTickStep(durationMs);
    const pxBasedToleranceMs =
      (SNAP_TOLERANCE_PX / Math.max(scale * SMALL_GEOMETRY.plotWidth, 1)) * durationMs;
    const clampedToleranceMs = Math.min(pxBasedToleranceMs, tickStep / 4);
    // このテストが実際にクランプを踏むことを確かめる（前提が崩れたら気づけるように）
    expect(clampedToleranceMs).toBeLessThan(pxBasedToleranceMs);

    const offset = (clampedToleranceMs + pxBasedToleranceMs) / 2; // クランプ内には収まらないがpx基準なら収まる距離
    const t = 10000 + offset;
    const clientX = msToX(t, durationMs, SMALL_GEOMETRY) * scale;
    fireEvent.mouseMove(svg, { clientX, clientY: 30 });
    expect(svg.querySelector('[data-snapped]')?.getAttribute('data-snapped')).toBe('false');

    // クランプ内の距離なら吸い付く
    const near = 10000 + clampedToleranceMs / 2;
    const nearClientX = msToX(near, durationMs, SMALL_GEOMETRY) * scale;
    fireEvent.mouseMove(svg, { clientX: nearClientX, clientY: 30 });
    expect(svg.querySelector('[data-snapped]')?.getAttribute('data-snapped')).toBe('true');
  });
});

/* --- 画面の寸法（CSS）。`test/schematic-quality.test.tsx` と同じ読み方 --- */

function read(rel: string): string {
  for (const base of [process.cwd(), resolve(process.cwd(), 'apps/desktop')]) {
    const path = resolve(base, rel);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(`${rel} が見つからない（cwd: ${process.cwd()}）`);
}

function declarations(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '');
}

function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

const TIMECHART_CSS = declarations(read('src/renderer/panels/timechart.module.css'));

describe('拡大ボタンと凡例の配置（UI監査 I10 / I11）', () => {
  it('「⤢ 拡大」は1行のまま図に被らない（I10: 右パネル380pxで2行に折れていた）', () => {
    const button = block(TIMECHART_CSS, '.enlargeButton');
    expect(button).toContain('white-space: nowrap');
  });

  it('凡例を図の上に横並びで固定する（I11: 図と幅を取り合って左端に縦にバラけていた）', () => {
    const body = block(TIMECHART_CSS, '.modalBody');
    expect(body).toContain('display: flex');
    expect(body).toContain('flex-direction: column');
  });
});
