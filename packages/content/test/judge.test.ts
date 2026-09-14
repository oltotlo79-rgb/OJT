import { JIPM_BOARD, plug, removeWire, type BoardSession } from '@ojt/board-model';
import { createWire, terminalId, toTerminalId, type HazardEvent } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { judgeAssemble, judgeReference } from '../src/judge.js';
import { buildReferenceSession, ASSEMBLE_WIRE_COLOR } from '../src/reference.js';
import {
  forbiddenOneShotProblemJson,
  parseOrThrow,
  selfHoldProblemJson,
} from './helpers/problems.js';

function sessionFor(json: Record<string, unknown> = selfHoldProblemJson()): BoardSession {
  const problem = parseOrThrow(json);
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value.session;
}

const PROBLEM = parseOrThrow(selfHoldProblemJson());

describe('judgeAssemble', () => {
  it('passes when the trainee wired the reference circuit', () => {
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, sessionFor());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(true);
    expect(result.value.mismatches).toEqual([]);
    expect(result.value.staticChecks.every((c) => c.ok)).toBe(true);
    expect(result.value.compareSignals).toEqual(['PL1', 'PL2', 'PL3', 'PL4']);
    expect(result.value.charts.expected.signals).toHaveLength(8);
    expect(result.value.charts.actual.durationMs).toBe(PROBLEM.durationMs);
    expect(result.value.hazardCount).toBe(0);
    expect(result.value.elapsedMs).toBeUndefined();
  });

  it('records the elapsed time and the session hazards without changing the verdict', () => {
    const hazard: HazardEvent = {
      type: 'hazard',
      kind: 'over-wires-per-terminal',
      tMs: 0,
      detail: 'CR1.14',
    };
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, sessionFor(), {
      elapsedMs: 12_000,
      sessionHazards: [hazard],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(true);
    expect(result.value.elapsedMs).toBe(12_000);
    expect(result.value.hazardCount).toBe(1);
    expect(result.value.hazardsByKind['over-wires-per-terminal']).toBe(1);
    expect(result.value.hazardsByKind['ohm-on-live']).toBe(0);
  });

  it('fails with a waveform difference when one wire is missing', () => {
    const session = sessionFor();
    const lampPlus = toTerminalId('TB_PL.1+');
    const lampWire = session.wires.find((w) => w.from === lampPlus || w.to === lampPlus);
    if (lampWire === undefined) throw new Error('lamp wire not found');
    expect(removeWire(session, lampWire.id).ok).toBe(true);
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.mismatches.length).toBeGreaterThan(0);
    expect(result.value.mismatches[0]?.signal).toBe('PL1');
    expect(result.value.mismatches[0]?.expected).toBe(true);
    expect(result.value.mismatches[0]?.reason).toBe('missing');
  });

  it('fails the wire colour check when a wire has the wrong colour', () => {
    const session = sessionFor();
    const wire = session.wires.find((w) => !w.locked);
    if (wire === undefined) throw new Error('no editable wire');
    wire.color = '白';
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.mismatches).toEqual([]);
    const check = result.value.staticChecks.find((c) => c.id === 'wireColorRule');
    expect(check?.ok).toBe(false);
  });

  it('fails the terminal limit check when a third wire is present', () => {
    const session = sessionFor();
    session.wires.push(
      createWire('w-901', terminalId('CR1', '14'), terminalId('CR2', '14'), ASSEMBLE_WIRE_COLOR),
    );
    session.wires.push(
      createWire('w-902', terminalId('CR1', '14'), terminalId('T1', '14'), ASSEMBLE_WIRE_COLOR),
    );
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    const check = result.value.staticChecks.find((c) => c.id === 'terminalLimit');
    expect(check?.ok).toBe(false);
    expect(check?.details.some((d) => d.startsWith('CR1.14'))).toBe(true);
  });

  it('fails the unused parts check when a spare relay is left unwired', () => {
    const session = sessionFor();
    expect(plug(session, 'S2', 'relay-my4n').ok).toBe(true);
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.staticChecks.find((c) => c.id === 'unusedParts')?.ok).toBe(false);
  });

  it('fails the forbidden circuit check on a self-breaking one shot', () => {
    const forbidden = parseOrThrow(forbiddenOneShotProblemJson());
    const result = judgeReference(forbidden, JIPM_BOARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.mismatches).toEqual([]);
    expect(result.value.chatter.length).toBeGreaterThan(0);
    expect(result.value.staticChecks.find((c) => c.id === 'forbiddenCircuit')?.ok).toBe(false);
  });

  it('fails the coil polarity check when 13 and 14 are swapped', () => {
    const session = sessionFor({
      ...selfHoldProblemJson(),
      physicalOverride: { c03: ['CR1.13', 'CR1.14'] },
    });
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.staticChecks.find((c) => c.id === 'coilPolarity')?.ok).toBe(false);
  });

  it('reports a reference circuit error instead of a verdict', () => {
    const broken = parseOrThrow({
      ...selfHoldProblemJson(),
      board: {
        boardId: 'board-other',
        socketRoles: { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' },
      },
    });
    const result = judgeAssemble(broken, JIPM_BOARD, sessionFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toBe('board.boardId');
  });

  it('surfaces the reference error from judgeReference too', () => {
    const broken = parseOrThrow({
      ...selfHoldProblemJson(),
      board: {
        boardId: 'board-other',
        socketRoles: { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' },
      },
    });
    expect(judgeReference(broken, JIPM_BOARD).ok).toBe(false);
  });

  it('reports an unknown compare signal as a content error, not a failed trainee (§13 #2)', () => {
    const json = selfHoldProblemJson();
    const problem = parseOrThrow({
      ...json,
      judge: { ...(json.judge as Record<string, unknown>), compareSignals: ['PL1', 'PL9'] },
    });
    const result = judgeAssemble(problem, JIPM_BOARD, sessionFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { path: 'judge.compareSignals[1]', message: '比較信号 PL9 は模範回路の記録にありません' },
    ]);
  });

  it('compares the signals the problem asks for when they all exist', () => {
    const json = selfHoldProblemJson();
    const problem = parseOrThrow({
      ...json,
      judge: { ...(json.judge as Record<string, unknown>), compareSignals: ['PL1'] },
    });
    const result = judgeAssemble(problem, JIPM_BOARD, sessionFor());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compareSignals).toEqual(['PL1']);
    expect(result.value.passed).toBe(true);
  });

  it('reports a dead reference circuit instead of a verdict (§13 #2)', () => {
    // コイルの左（CR1.14）はそのまま、右をN母線へ直結し、実機のコイル端子（CR1.13）を宙に浮かせる
    const dead = parseOrThrow({
      ...selfHoldProblemJson(),
      physicalOverride: { c03: ['CR1.14', 'N.1'] },
    });
    const result = judgeReference(dead, JIPM_BOARD);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toBe(
      '模範回路が動作しません（ランプ・コイルの変化がありません）',
    );
  });
});
