import { JIPM_BOARD } from '@ojt/board-model';
import { compareLogs, SignalLog } from '@ojt/circuit-sim';
import {
  buildTimeChart,
  defaultChartSignals,
  BUILTIN_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  buildReferenceSession,
  buildInspectRepairCircuit,
  buildPlcReferenceSession,
  judgeAssemble,
  judgeInspectRepair,
  judgePlc,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { compareCharts, mayShowReference } from '../src/renderer/result/compare.js';

const tolerance = { edgeMs: 200, ratio: 0.1 };
function log(points: Array<[number, boolean]>): SignalLog {
  const value = new SignalLog();
  for (const [time, state] of points) value.record(time, new Map([['PL1', state]]));
  return value;
}
function chart(source: SignalLog) {
  return buildTimeChart(source, defaultChartSignals(['PL1']), 5000);
}

describe('採点と同じ波形比較', () => {
  it.each([
    {
      name: '一致',
      want: [
        [0, false],
        [1000, true],
      ],
      got: [
        [0, false],
        [1000, true],
      ],
      different: false,
    },
    {
      name: '許容差の境界',
      want: [
        [0, false],
        [1000, true],
      ],
      got: [
        [0, false],
        [1200, true],
      ],
      different: false,
    },
    {
      name: '許容差を超える',
      want: [
        [0, false],
        [1000, true],
      ],
      got: [
        [0, false],
        [1210, true],
      ],
      different: true,
    },
    { name: '初期値違い', want: [[0, false]], got: [[0, true]], different: true },
    {
      name: '欠けたパルス',
      want: [
        [0, false],
        [1000, true],
        [2000, false],
      ],
      got: [[0, false]],
      different: true,
    },
    {
      name: '余分なパルス',
      want: [[0, false]],
      got: [
        [0, false],
        [1000, true],
        [2000, false],
      ],
      different: true,
    },
  ])('$nameで判定・帯が一致する', ({ want, got, different }) => {
    const expected = log(want as Array<[number, boolean]>);
    const actual = log(got as Array<[number, boolean]>);
    const rows = compareCharts(chart(expected), chart(actual), tolerance);
    expect(rows[0]?.differences).toEqual(compareLogs(expected, actual, ['PL1'], tolerance));
    expect((rows[0]?.diffWindows.length ?? 0) > 0).toBe(different);
    expect(rows[0]?.label).toBe('白ランプ（PL1）');
  });
  it('欠けたパルスの後でOFFが一致する区間は帯に含めない', () => {
    const expected = chart(
      log([
        [0, false],
        [1000, true],
        [2000, false],
      ]),
    );
    const actual = chart(log([[0, false]]));
    const row = compareCharts(expected, actual, tolerance)[0];
    expect(row?.differences).toHaveLength(2);
    expect(row?.diffWindows).toEqual([{ fromMs: 1000, toMs: 2000 }]);
  });
  it('同じ信号に不一致があっても、別の許容済みのずれには帯を付けない', () => {
    const expected = chart(
      log([
        [0, false],
        [1000, true],
        [2000, false],
      ]),
    );
    const actual = chart(
      log([
        [0, false],
        [1190, true],
        [2210, false],
      ]),
    );
    expect(compareCharts(expected, actual, tolerance)[0]?.diffWindows).toEqual([
      { fromMs: 2000, toMs: 2210 },
    ]);
  });
  it('直前の区間に対する比率も採点と同じ値で見る', () => {
    const expected = log([
      [0, false],
      [4000, true],
    ]);
    const actual = log([
      [0, false],
      [4390, true],
    ]);
    expect(compareCharts(chart(expected), chart(actual), tolerance)[0]?.diffWindows).toEqual([]);
  });
  it('入力信号は採点の対象外、重複する出力は1つ、欠測も検出する', () => {
    const expected = chart(log([[0, false]]));
    expected.signals.push(expected.signals[4]!);
    const rows = compareCharts(expected, { durationMs: 5000, signals: [], markers: [] }, tolerance);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.differences[0]?.reason).toBe('missing');
    expect(compareCharts({ ...expected, signals: [] }, expected, tolerance)).toEqual([]);
  });
  it('未知の信号も同じ理由で扱う', () => {
    const expected = chart(log([]));
    expected.signals[4]!.segments = [];
    expect(compareCharts(expected, chart(log([])), tolerance)[0]?.differences[0]?.reason).toBe(
      'unknown-signal',
    );
  });
  it('実際のB・C2・Dの判定結果にある差分と完全一致する', () => {
    const b = BUILTIN_PROBLEMS[0]!;
    const built = buildReferenceSession(b, JIPM_BOARD);
    if (!built.ok) throw new Error('reference');
    built.value.session.wires.pop();
    const bj = judgeAssemble(b, JIPM_BOARD, built.value.session);
    if (!bj.ok) throw new Error('judge');
    const c = BUILTIN_INSPECT_REPAIR_PROBLEMS[0]!;
    const circuit = buildInspectRepairCircuit(c, JIPM_BOARD);
    if (!circuit.ok) throw new Error('circuit');
    const cj = judgeInspectRepair(c, JIPM_BOARD, circuit.value, []);
    if (!cj.ok) throw new Error('judge');
    const d = BUILTIN_PLC_PROBLEMS[2]!;
    const plc = buildPlcReferenceSession(d, JIPM_BOARD);
    if (!plc.ok) throw new Error('plc');
    plc.value.session.wires.pop();
    const dj = judgePlc(d, JIPM_BOARD, plc.value.session, d.referenceLadder);
    if (!dj.ok) throw new Error('judge');
    for (const [problem, result] of [
      [b, bj.value],
      [c, cj.value],
      [d, dj.value],
    ] as const) {
      expect(
        compareCharts(
          result.charts.expected,
          result.charts.actual,
          problem.judge.tolerance,
        ).flatMap((row) => row.differences),
      ).toEqual(result.mismatches);
    }
  });
});

describe('模範の開示範囲', () => {
  it('B3級・C2の2級だけ、公開フラグと級の両方が必要', () => {
    for (const problem of BUILTIN_PROBLEMS)
      expect(mayShowReference(problem)).toBe(problem.grade === 3 && problem.hints.schematicVisible);
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS)
      expect(mayShowReference(problem)).toBe(problem.grade === 2 && problem.hints.schematicVisible);
    const b = BUILTIN_PROBLEMS.find((p) => p.grade === 3)!;
    expect(mayShowReference({ ...b, hints: { ...b.hints, schematicVisible: false } })).toBe(false);
    expect(
      mayShowReference({ ...b, grade: 1, hints: { ...b.hints, schematicVisible: true } }),
    ).toBe(false);
    for (const p of [...BUILTIN_PLC_PROBLEMS, ...BUILTIN_INSPECT_PARTS_PROBLEMS])
      expect(mayShowReference(p)).toBe(false);
  });
});
