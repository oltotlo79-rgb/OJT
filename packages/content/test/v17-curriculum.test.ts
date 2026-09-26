import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  BUILTIN_PROBLEMS,
} from '../src/builtin/index.js';
import { judgeReference } from '../src/judge.js';
import { judgePlcReference } from '../src/judge-plc.js';
import type { TimeChart } from '../src/timechart.js';

/**
 * v1.7.0 の追加教材（B-091〜100 / D-091〜100 / C1-055〜064）が、課題文どおりに動くことの検査。
 *
 * 模範回路が「自分の操作列で合格する」だけでは、課題文と違う動きの回路でも通ってしまう
 * （生成中に、寸動回路が離した瞬間に自己保持を掛け直してしまう例を実際に見つけた）。
 * ここでは模範の波形の点灯区間を、課題文から読める期待値と突き合わせる。
 */

/** 点灯区間（[開始, 終了] ms）。 */
function onIntervals(chart: TimeChart, name: string): [number, number][] {
  const signal = chart.signals.find((s) => s.name === name);
  if (signal === undefined) throw new Error(`信号 ${name} がありません`);
  return signal.segments.filter((s) => s.value).map((s) => [s.fromMs, s.toMs]);
}

/** 期待の区間と ±60ms で一致するか。 */
function expectIntervals(actual: [number, number][], expected: [number, number][]): void {
  expect(actual.length, JSON.stringify(actual)).toBe(expected.length);
  actual.forEach(([from, to], i) => {
    const [ef, et] = expected[i] ?? [0, 0];
    expect(
      Math.abs(from - ef),
      `${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`,
    ).toBeLessThan(60);
    expect(
      Math.abs(to - et),
      `${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`,
    ).toBeLessThan(60);
  });
}

function assembleChart(id: string): TimeChart {
  const problem = BUILTIN_PROBLEMS.find((p) => p.id === id);
  if (problem === undefined) throw new Error(`${id} がありません`);
  const judged = judgeReference(problem, JIPM_BOARD);
  if (!judged.ok) throw new Error(JSON.stringify(judged.errors));
  expect(judged.value.passed).toBe(true);
  return judged.value.charts.expected;
}

function plcChart(id: string): TimeChart {
  const problem = BUILTIN_PLC_PROBLEMS.find((p) => p.id === id);
  if (problem === undefined) throw new Error(`${id} がありません`);
  const judged = judgePlcReference(problem, JIPM_BOARD);
  if (!judged.ok) throw new Error(JSON.stringify(judged.errors));
  expect(judged.value.passed).toBe(true);
  return judged.value.charts.expected;
}

/** 課題文から読める期待の点灯区間（組立）。 */
const ASSEMBLE: Record<string, Record<string, [number, number][]>> = {
  // 非常停止中（PB3 1500〜）は起動（PB1 2500）を受け付けず、PB2 で復帰
  'b-091': {
    PL1: [
      [500, 1500],
      [4500, 5500],
    ],
    PL4: [[1500, 3500]],
  },
  // 2秒で自動停止して終了表示、手動停止（5500）では終了表示なし
  'b-092': {
    PL1: [
      [500, 2500],
      [4500, 5500],
    ],
    PL2: [[2500, 3500]],
  },
  // 1.5秒の起動待ち、待ちの途中（4800）で止めたら点灯しない
  'b-093': {
    PL1: [[2000, 3000]],
    PL2: [
      [500, 2000],
      [4000, 4800],
    ],
  },
  // 確認（1700）でブザーだけ止まり、復帰（3500）で表示も消える。再警報でまた鳴る
  'b-094': {
    PL4: [
      [500, 3500],
      [4500, 5500],
    ],
    BZ: [
      [500, 1700],
      [4500, 5500],
    ],
  },
  // 1号機停止中の PB3（500 / 4500）は無視
  'b-095': { PL1: [[1500, 3500]], PL2: [[2500, 3500]] },
  // 0.4秒の短押しでは始動せず、1.3秒の長押しで 1秒後に始動
  'b-096': { PL1: [[3000, 4500]] },
  // 一時停止中は PL1 を消して PL2、運転していないときの PB3 は無視
  'b-097': {
    PL1: [
      [500, 1500],
      [2500, 3500],
    ],
    PL2: [[1500, 2500]],
  },
  // 片手ずつ（500 / 1500）では始動しない
  'b-098': { PL1: [[2600, 4000]] },
  // 停止（1500）から3秒は再起動（2500）を受け付けない
  'b-099': {
    PL1: [
      [500, 1500],
      [5000, 6000],
    ],
    PL2: [
      [1500, 4550],
      [6000, 9050],
    ],
  },
  // 1秒の準備のあと2秒運転して自動停止、再起動後は PB2（6000）で停止
  'b-100': {
    PL1: [
      [1500, 3500],
      [5500, 6000],
    ],
    PL2: [
      [500, 1500],
      [4500, 5500],
    ],
  },
};

describe('v1.7.0 の追加教材（組立）', () => {
  it.each(Object.entries(ASSEMBLE))('%s は課題文どおりに点灯する', (id, lamps) => {
    const chart = assembleChart(id);
    for (const [name, expected] of Object.entries(lamps)) {
      expectIntervals(onIntervals(chart, name), expected);
    }
  });
});

describe('v1.7.0 の追加教材（PLC。4メーカーを順に使う）', () => {
  it('D-091〜100 は4メーカーの機種を順に使う', () => {
    const models = BUILTIN_PLC_PROBLEMS.slice(90).map((p) => p.plc.model);
    expect(models).toEqual([
      'FX5U',
      'PC10G-1SP',
      'CP1E',
      'JW-300',
      'FX5U',
      'PC10G-1SP',
      'CP1E',
      'JW-300',
      'FX5U',
      'PC10G-1SP',
    ]);
  });

  it.each([
    [
      'd-091',
      {
        PL1: [
          [500, 1500],
          [4500, 5500],
        ],
        PL2: [[1500, 3500]],
      },
    ],
    [
      'd-092',
      {
        PL1: [
          [500, 2500],
          [4500, 5500],
        ],
        PL2: [[2500, 3500]],
      },
    ],
    ['d-095', { PL1: [[1500, 3500]], PL2: [[2500, 3500]] }],
    [
      'd-096',
      {
        PL1: [[3000, 4500]],
        PL2: [
          [500, 900],
          [2000, 3000],
        ],
      },
    ],
    [
      'd-099',
      {
        PL1: [
          [500, 1500],
          [5000, 6000],
        ],
        PL2: [
          [1500, 4500],
          [6000, 9000],
        ],
      },
    ],
  ] satisfies [string, Record<string, [number, number][]>][])(
    '%s は課題文どおりに点灯する',
    (id, lamps) => {
      const chart = plcChart(id);
      for (const [name, expected] of Object.entries(lamps)) {
        expectIntervals(onIntervals(chart, name), expected);
      }
    },
  );

  it('d-094 は確認までは点滅し、確認後は点滅しない（一瞬の点灯を残さない）', () => {
    const blink = onIntervals(plcChart('d-094'), 'PL2');
    expect(blink.length).toBeGreaterThan(0);
    for (const [from, to] of blink) {
      expect(to - from, JSON.stringify(blink)).toBeGreaterThan(300);
      // 確認（1700）から復帰・再警報（4500）までは点滅しない
      expect(from < 1700 || from >= 4500, JSON.stringify(blink)).toBe(true);
    }
  });
});

describe('v1.7.0 の追加教材（部品点検）', () => {
  it('C1-055〜064 は正常品と故障品を混ぜ、接点の故障には接点組を指定する', () => {
    const added = BUILTIN_INSPECT_PARTS_PROBLEMS.slice(54);
    expect(added.map((p) => p.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `c1-${String(55 + i).padStart(3, '0')}`),
    );
    for (const problem of added) {
      const truths = problem.parts.map((part) => part.truth);
      expect(truths).toContain('normal');
      expect(truths.some((t) => t !== 'normal')).toBe(true);
      for (const part of problem.parts) {
        const contact = part.truth.startsWith('a-') || part.truth.startsWith('b-');
        if (contact) expect(part.group, `${problem.id} ${part.id}`).toBeTypeOf('number');
        else expect(part.group, `${problem.id} ${part.id}`).toBeUndefined();
      }
    }
  });
});
