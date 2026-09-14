import { JIPM_BOARD, plug, toNetlist, type BoardSession } from '@ojt/board-model';
import {
  createWire,
  SignalLog,
  terminalId,
  type HazardEvent,
  type WireColor,
} from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { buildReferenceSession, ASSEMBLE_WIRE_COLOR } from '../src/reference.js';
import { runOperations } from '../src/runner.js';
import { DEFAULT_STATIC_CHECKS } from '../src/schema/judge.js';
import {
  checkCoilPolarity,
  checkForbiddenCircuit,
  checkPowerSequence,
  checkTerminalLimit,
  checkUnusedParts,
  checkWireColorRule,
  runStaticChecks,
  type StaticCheckInput,
} from '../src/static-checks.js';
import {
  forbiddenOneShotProblemJson,
  parseOrThrow,
  selfHoldProblemJson,
} from './helpers/problems.js';

/**
 * モードC2の修復に使う線色（白）。§8.1
 * 本来は `src/inspect-repair.ts` の `REPAIR_WIRE_COLOR` を使うが、そのモジュールは
 * Task 10 で作られる。ここでは同じ値を置いて `preexistingWireIds` の検査だけを先に固める。
 */
const REPAIR_WIRE_COLOR: WireColor = '白';

function inputFor(json: Record<string, unknown>): StaticCheckInput & { session: BoardSession } {
  const problem = parseOrThrow(json);
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const run = runOperations(built.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  return {
    session: built.value.session,
    netlist: built.value.netlist,
    log: run.log,
    hazards: run.events.hazards(),
    chatters: run.events.chatters(),
    allowedColors: [ASSEMBLE_WIRE_COLOR],
  };
}

describe('runStaticChecks', () => {
  it('passes every check on a correct circuit', () => {
    const results = runStaticChecks(inputFor(selfHoldProblemJson()), DEFAULT_STATIC_CHECKS);
    expect(results.map((r) => r.id)).toEqual([
      'wireColorRule',
      'terminalLimit',
      'unusedParts',
      'forbiddenCircuit',
      'coilPolarity',
      'powerSequence',
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('runs only the enabled checks', () => {
    const results = runStaticChecks(inputFor(selfHoldProblemJson()), {
      ...DEFAULT_STATIC_CHECKS,
      unusedParts: false,
      powerSequence: false,
    });
    expect(results.map((r) => r.id)).toEqual([
      'wireColorRule',
      'terminalLimit',
      'forbiddenCircuit',
      'coilPolarity',
    ]);
  });
});

describe('checkWireColorRule', () => {
  it('fails on a wire that is not in the palette', () => {
    const input = inputFor(selfHoldProblemJson());
    const wire = input.session.wires.find((w) => !w.locked);
    if (wire === undefined) throw new Error('no editable wire');
    wire.color = '白';
    const result = checkWireColorRule(input);
    expect(result.ok).toBe(false);
    expect(result.details[0]).toContain(wire.id);
  });

  it('ignores the pre-installed fixed wiring whatever colour it has (§6.3)', () => {
    const input = inputFor(selfHoldProblemJson());
    const locked = input.session.wires.find((w) => w.locked);
    if (locked === undefined) throw new Error('no locked wire');
    expect(locked.color).toBe('青');
    locked.color = '黄';
    expect(checkWireColorRule(input).ok).toBe(true);
  });

  it('exempts the wires that were already on the board (§9.2 の修復)', () => {
    const input = inputFor(selfHoldProblemJson());
    const blue = input.session.wires.find((w) => !w.locked);
    if (blue === undefined) throw new Error('no editable wire');
    const repaired: StaticCheckInput = {
      ...input,
      allowedColors: [REPAIR_WIRE_COLOR],
      preexistingWireIds: new Set(input.session.wires.map((w) => w.id)),
    };
    expect(checkWireColorRule(repaired).ok).toBe(true);
    const withNewBlue: StaticCheckInput = {
      ...repaired,
      preexistingWireIds: new Set(
        input.session.wires.filter((w) => w.id !== blue.id).map((w) => w.id),
      ),
    };
    const result = checkWireColorRule(withNewBlue);
    expect(result.ok).toBe(false);
    expect(result.details[0]).toContain(blue.id);
  });
});

describe('checkTerminalLimit', () => {
  it('fails when a terminal carries three wires', () => {
    const input = inputFor(selfHoldProblemJson());
    input.session.wires.push(
      createWire('w-extra', terminalId('CR1', '14'), terminalId('CR2', '14'), ASSEMBLE_WIRE_COLOR),
    );
    input.session.wires.push(
      createWire('w-extra2', terminalId('CR1', '14'), terminalId('T1', '14'), ASSEMBLE_WIRE_COLOR),
    );
    const result = checkTerminalLimit(input);
    expect(result.ok).toBe(false);
    expect(result.details.some((d) => d.startsWith('CR1.14'))).toBe(true);
  });
});

describe('checkUnusedParts', () => {
  it('fails when a mounted part has no wire at all', () => {
    const input = inputFor(selfHoldProblemJson());
    const plugged = plug(input.session, 'S2', 'relay-my4n');
    expect(plugged.ok).toBe(true);
    const result = checkUnusedParts({
      ...input,
      netlist: toNetlist(input.session, JIPM_BOARD),
    });
    expect(result.ok).toBe(false);
    expect(result.details[0]).toContain('S2');
  });

  it('ignores a part in the check socket', () => {
    const input = inputFor(selfHoldProblemJson());
    plug(input.session, 'S7', 'relay-my4n');
    expect(checkUnusedParts(input).ok).toBe(true);
  });
});

describe('checkForbiddenCircuit', () => {
  it('fails when the timer breaks its own coil (chattering)', () => {
    const input = inputFor(forbiddenOneShotProblemJson());
    expect(input.chatters.length).toBeGreaterThan(0);
    const result = checkForbiddenCircuit(input);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('リレーを介して');
  });

  it('reports one line per user-visible signal plus the structural finding', () => {
    const input = inputFor(forbiddenOneShotProblemJson());
    expect(input.chatters.length).toBeGreaterThan(10);
    const details = checkForbiddenCircuit(input).details;
    const signals = details.map((d) => d.slice(0, d.indexOf(':')));
    expect(signals).toEqual(['T1', 'PL1', 'T1.coil', '構造']);
    expect(new Set(signals).size).toBe(signals.length);
    expect(details[0]).toContain('回反転しました');
    expect(details[3]).toContain('自分のコイルを切っています');
  });

  it('folds a contact element back onto the part the trainee can see', () => {
    const input = inputFor(selfHoldProblemJson());
    const result = checkForbiddenCircuit({
      ...input,
      chatters: [
        { type: 'chatter', signal: 'CR1:b3.closed', tMs: 500, count: 21 },
        { type: 'chatter', signal: 'CR1:a1.closed', tMs: 600, count: 22 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.details).toEqual(['CR1: 500ms 付近で1秒間に21回反転しました']);
  });

  it('reports the structural pattern even without chattering (§7.4 Phase 2)', () => {
    const input = inputFor(forbiddenOneShotProblemJson());
    const result = checkForbiddenCircuit({ ...input, chatters: [] });
    expect(result.ok).toBe(false);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toContain('構造');
  });
});

describe('checkCoilPolarity', () => {
  it('fails when the coil is wired 13 = + / 14 = −', () => {
    const input = inputFor({
      ...selfHoldProblemJson(),
      physicalOverride: { c03: ['CR1.13', 'CR1.14'] },
    });
    const result = checkCoilPolarity(input);
    expect(result.ok).toBe(false);
    expect(result.details[0]).toContain('CR1');
  });

  it('passes when nothing has been energised at all', () => {
    const input = inputFor(selfHoldProblemJson());
    expect(checkCoilPolarity({ ...input, log: new SignalLog() }).ok).toBe(true);
  });
});

describe('checkPowerSequence', () => {
  it('counts the violations recorded during the session', () => {
    const input = inputFor(selfHoldProblemJson());
    const hazard: HazardEvent = {
      type: 'hazard',
      kind: 'power-sequence-violation',
      tMs: 0,
      detail: 'breaker:off',
    };
    const result = checkPowerSequence({ ...input, hazards: [hazard] });
    expect(result.ok).toBe(false);
    expect(result.details).toEqual(['0ms: breaker:off']);
  });

  it('passes when the judging run powered up correctly', () => {
    expect(checkPowerSequence(inputFor(selfHoldProblemJson())).ok).toBe(true);
  });
});
