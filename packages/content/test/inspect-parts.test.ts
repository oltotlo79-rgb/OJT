import { JIPM_BOARD, type MountableKind } from '@ojt/board-model';
import { continuity, measureResistance, Simulation } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  buildCheckCircuit,
  CHECK_COIL_MINUS,
  CHECK_COIL_PLUS,
  CHECK_PART_ID,
  CHECK_TIMER_PRESET_MS,
  checkContactTerminals,
  checkSettleMs,
  DIAGNOSIS_TABLE,
  diagnoseCheckReading,
  expectedCheckReading,
  faultGroupOf,
  LAYER_SHORT_JUDGE_RATIO,
  layerShortThresholdOhms,
  PART_TRUTH_LABELS,
  truthFault,
} from '../src/inspect-parts.js';
import type { ExpectedCheckReading } from '../src/inspect-parts.js';
import { BUILTIN_INSPECT_PARTS_PROBLEMS } from '../src/builtin/index.js';
import type { InspectPartsProblem, PartTruth } from '../src/schema/inspect-parts.js';
import { inspectPartsProblemJson, parseInspectPartsOrThrow } from './helpers/inspect.js';

/** `truth` を1つだけ差し替えた課題（2個目は常に正常品）。 */
function truthProblem(
  truth: PartTruth,
  kind: MountableKind = 'relay-my4n',
  extra: Record<string, unknown> = {},
): InspectPartsProblem {
  return parseInspectPartsOrThrow({
    ...inspectPartsProblemJson(),
    parts: [
      { id: 'p1', kind, truth, ...extra },
      { id: 'p2', kind: 'relay-my4n', truth: 'normal' },
    ],
  });
}

/**
 * 判定表の各行を「優先規則抜きで」当てはめ、当たる原因をすべて返す。
 * `diagnoseCheckReading()` が溶着優先規則で1つに絞る前の状態を確かめるためのテスト専用実装。
 */
function tableCandidates(reading: ExpectedCheckReading): PartTruth[] {
  const hits: PartTruth[] = [];
  const normalContacts =
    !reading.aClosedOff && reading.aClosedOn && reading.bClosedOff && !reading.bClosedOn;
  if (!reading.picksUp && reading.coilOhms === null) hits.push('coil-open');
  if (reading.coilOhms !== null) {
    if (!reading.aClosedOn) hits.push('a-open');
    if (reading.aClosedOff) hits.push('a-weld');
    if (reading.bClosedOn) hits.push('b-weld');
    if (!reading.bClosedOff) hits.push('b-open');
    if (reading.picksUp && normalContacts) {
      hits.push(reading.coilOhms > layerShortThresholdOhms() ? 'normal' : 'coil-layer-short');
    }
  }
  return hits;
}

/** チェック用ソケットに挿して §9.1 の手順どおりに測る。 */
function measureCheck(problem: InspectPartsProblem, partId: string) {
  const built = buildCheckCircuit(problem, JIPM_BOARD, partId);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const part = problem.parts.find((p) => p.id === partId);
  if (part === undefined) throw new Error(`no part ${partId}`);
  const pins = checkContactTerminals(built.value.group);
  const sim = new Simulation(built.value.netlist);
  sim.setBreaker(true);
  sim.setSwitch(true);
  sim.run(100);
  const coil = measureResistance(sim, CHECK_COIL_MINUS, CHECK_COIL_PLUS);
  const aClosedOff = continuity(sim, pins.com, pins.no).conductive;
  const bClosedOff = continuity(sim, pins.com, pins.nc).conductive;
  sim.press('PB4');
  sim.run(sim.tMs + checkSettleMs(part.kind));
  const state = sim.state();
  const picksUp =
    part.kind === 'timer-h3y4'
      ? (state.timers[CHECK_PART_ID]?.timedOut ?? false)
      : (state.relays[CHECK_PART_ID]?.contactsOn ?? false);
  return {
    sim,
    picksUp,
    coilDisplay: coil.display,
    coilOhms: coil.overRange ? null : coil.ohms,
    aClosedOff,
    bClosedOff,
    aClosedOn: continuity(sim, pins.com, pins.no).conductive,
    bClosedOn: continuity(sim, pins.com, pins.nc).conductive,
  };
}

describe('PART_TRUTH_LABELS / DIAGNOSIS_TABLE', () => {
  it('labels the seven answer-sheet options in Japanese (§9.1)', () => {
    expect(PART_TRUTH_LABELS.normal).toBe('正常');
    expect(PART_TRUTH_LABELS['coil-open']).toBe('コイル断線');
    expect(PART_TRUTH_LABELS['coil-layer-short']).toBe('レアショート');
    expect(PART_TRUTH_LABELS['a-open']).toBe('a接点 導通不良');
    expect(PART_TRUTH_LABELS['a-weld']).toBe('a接点 溶着');
    expect(PART_TRUTH_LABELS['b-open']).toBe('b接点 導通不良');
    expect(PART_TRUTH_LABELS['b-weld']).toBe('b接点 溶着');
  });

  it('covers every cause of the help table exactly once (§9.1)', () => {
    expect(DIAGNOSIS_TABLE).toHaveLength(7);
    expect(new Set(DIAGNOSIS_TABLE.map((r) => r.cause)).size).toBe(7);
    const layerShort = DIAGNOSIS_TABLE.find((r) => r.cause === 'coil-layer-short');
    expect(layerShort?.situation).toContain('85%');
  });
});

describe('layerShortThresholdOhms', () => {
  it('is 85 percent of the nominal 650 ohms (§9.1 補足)', () => {
    expect(LAYER_SHORT_JUDGE_RATIO).toBe(0.85);
    expect(layerShortThresholdOhms()).toBeCloseTo(552.5, 6);
  });
});

describe('checkContactTerminals', () => {
  it('follows the socket pin map of §6.2', () => {
    expect(checkContactTerminals(1)).toEqual({ com: 'CHK.9', no: 'CHK.5', nc: 'CHK.1' });
    expect(checkContactTerminals(4)).toEqual({ com: 'CHK.12', no: 'CHK.8', nc: 'CHK.4' });
    expect(() => checkContactTerminals(5)).toThrow(RangeError);
  });

  it('names the coil terminals of the check socket (§9.1 測定1)', () => {
    expect(CHECK_COIL_MINUS).toBe('CHK.13');
    expect(CHECK_COIL_PLUS).toBe('CHK.14');
  });
});

describe('faultGroupOf', () => {
  it('uses the explicit group when the problem gives one', () => {
    const problem = truthProblem('a-open', 'relay-my4n', { group: 3 });
    const part = problem.parts[0];
    if (part === undefined) return;
    expect(faultGroupOf(problem, part)).toBe(3);
  });

  it('derives a stable group from the seed and the part id (§7.5 組の選択)', () => {
    const problem = truthProblem('a-open');
    const part = problem.parts[0];
    if (part === undefined) return;
    const group = faultGroupOf(problem, part);
    expect(group).toBeGreaterThanOrEqual(1);
    expect(group).toBeLessThanOrEqual(4);
    expect(faultGroupOf(problem, part)).toBe(group);
  });
});

describe('truthFault', () => {
  it('maps the truths onto the §5.4 fault kinds', () => {
    const relay = truthProblem('coil-open');
    const coilPart = relay.parts[0];
    if (coilPart === undefined) return;
    expect(truthFault(relay, coilPart)).toEqual({
      target: { partId: 'CHK', elementIndex: 0 },
      kind: 'coil-open',
    });

    const layer = truthProblem('coil-layer-short', 'relay-my4n', { ratio: 0.5 });
    const layerPart = layer.parts[0];
    if (layerPart === undefined) return;
    expect(truthFault(layer, layerPart)).toEqual({
      target: { partId: 'CHK', elementIndex: 0 },
      kind: 'coil-layer-short',
      ratio: 0.5,
    });

    const weld = truthProblem('a-weld', 'relay-my4n', { group: 2 });
    const weldPart = weld.parts[0];
    if (weldPart === undefined) return;
    expect(truthFault(weld, weldPart)).toEqual({
      target: { partId: 'CHK', elementIndex: 4 },
      kind: 'contact-welded',
    });
  });

  it('returns nothing for a healthy part', () => {
    const problem = truthProblem('normal');
    const part = problem.parts[0];
    if (part === undefined) return;
    expect(truthFault(problem, part)).toBeUndefined();
  });
});

describe('buildCheckCircuit', () => {
  it('reports an unknown part id', () => {
    const built = buildCheckCircuit(truthProblem('normal'), JIPM_BOARD, 'nope');
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('parts');
  });

  it('reports a board mismatch', () => {
    const problem = parseInspectPartsOrThrow({
      ...inspectPartsProblemJson(),
      board: { boardId: 'board-other', socketRoles: { S7: 'CHK' } },
    });
    const built = buildCheckCircuit(problem, JIPM_BOARD, 'p1');
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('board.boardId');
  });

  it('sets a short timer preset so the check is quick', () => {
    expect(CHECK_TIMER_PRESET_MS).toBe(1000);
    expect(checkSettleMs('relay-my4n')).toBe(100);
    expect(checkSettleMs('timer-h3y4')).toBe(1100);
  });
});

describe('§9.1 判定表どおりの読値', () => {
  const TRUTHS: PartTruth[] = [
    'normal',
    'coil-open',
    'coil-layer-short',
    'a-open',
    'a-weld',
    'b-open',
    'b-weld',
  ];

  for (const truth of TRUTHS) {
    it(`matches expectedCheckReading for ${truth}`, () => {
      const extra = truth.startsWith('a-') || truth.startsWith('b-') ? { group: 1 } : {};
      const problem = truthProblem(truth, 'relay-my4n', extra);
      const part = problem.parts[0];
      if (part === undefined) return;
      const expected = expectedCheckReading(part);
      const actual = measureCheck(problem, 'p1');
      expect(actual.picksUp).toBe(expected.picksUp);
      expect(actual.aClosedOff).toBe(expected.aClosedOff);
      expect(actual.aClosedOn).toBe(expected.aClosedOn);
      expect(actual.bClosedOff).toBe(expected.bClosedOff);
      expect(actual.bClosedOn).toBe(expected.bClosedOn);
      if (expected.coilOhms === null) expect(actual.coilOhms).toBeNull();
      else expect(actual.coilOhms ?? 0).toBeCloseTo(expected.coilOhms, 1);
    });
  }

  it('内蔵のC1課題すべてで、読値から溶着優先規則どおり唯一の原因が導ける（レビュー I-2）', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      for (const part of problem.parts) {
        const reading = measureCheck(problem, part.id);
        // 判定表の行だけでは絞り切れないことがある（a溶着は「OFF時に b接点 導通なし」の行にも当たる）。
        expect(tableCandidates(reading).length).toBeGreaterThanOrEqual(1);
        // 溶着優先規則を当てはめると唯一に決まり、しかも課題の `truth` と一致する。
        expect(diagnoseCheckReading(reading)).toBe(part.truth);
      }
    }
  });

  it('溶着は同じ組のもう一方の接点の導通不良より優先される（§9.1 なお書き）', () => {
    const aWeld = expectedCheckReading({ id: 'x', kind: 'relay-my4n', truth: 'a-weld' });
    // a溶着の読値は「a接点の溶着」と「b接点の導通不良」の2行に当たる。
    expect(tableCandidates(aWeld).sort()).toEqual(['a-weld', 'b-open']);
    expect(diagnoseCheckReading(aWeld)).toBe('a-weld');
    const bWeld = expectedCheckReading({ id: 'x', kind: 'relay-my4n', truth: 'b-weld' });
    expect(tableCandidates(bWeld).sort()).toEqual(['a-open', 'b-weld']);
    expect(diagnoseCheckReading(bWeld)).toBe('b-weld');
  });

  it('受入基準②: コイル断線は吸引せずコイル抵抗が OL になる', () => {
    const actual = measureCheck(truthProblem('coil-open'), 'p1');
    expect(actual.picksUp).toBe(false);
    expect(actual.coilDisplay).toBe('OL');
  });

  it('受入基準②: レアショートは正常に吸引するのにコイル抵抗が約420Ωになる', () => {
    const problem = truthProblem('coil-layer-short', 'relay-my4n', { ratio: 0.65 });
    const actual = measureCheck(problem, 'p1');
    expect(actual.picksUp).toBe(true);
    expect(actual.coilDisplay).toBe('422.5');
    expect(actual.coilOhms ?? 0).toBeLessThanOrEqual(layerShortThresholdOhms());
  });

  it('正常品のコイル抵抗はしきい値を超える', () => {
    const actual = measureCheck(truthProblem('normal'), 'p1');
    expect(actual.coilDisplay).toBe('650.0');
    expect(actual.coilOhms ?? 0).toBeGreaterThan(layerShortThresholdOhms());
  });

  it('タイマも同じ手順で点検できる（タイムアップで接点が反転する）', () => {
    const actual = measureCheck(truthProblem('normal', 'timer-h3y4'), 'p1');
    expect(actual.picksUp).toBe(true);
    expect(actual.coilDisplay).toBe('650.0');
    expect(actual.aClosedOff).toBe(false);
    expect(actual.aClosedOn).toBe(true);
  });

  it('赤PBを離していればコイル抵抗を測っても危険操作にならない（§9.1 測定1）', () => {
    const actual = measureCheck(truthProblem('normal'), 'p1');
    expect(actual.sim.events.countOf('ohm-on-live')).toBe(0);
  });

  it('赤PBを押したままΩレンジを当てると ohm-on-live になる（§5.6 #1）', () => {
    const built = buildCheckCircuit(truthProblem('normal'), JIPM_BOARD, 'p1');
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const sim = new Simulation(built.value.netlist);
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.press('PB4');
    sim.run(100);
    const reading = measureResistance(sim, CHECK_COIL_MINUS, CHECK_COIL_PLUS);
    expect(reading.live).toBe(true);
    expect(reading.display).toBe('OL');
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
  });
});
