import { JIPM_BOARD, toNetlist } from '@ojt/board-model';
import { findPart, loadOhms } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  applyFaults,
  faultParam,
  injectPartFaults,
  matchesSite,
  withoutPartFaults,
} from '../src/faults.js';
import { buildReferenceSession } from '../src/reference.js';
import type { FaultSpecData } from '../src/schema/faults.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

/** 自己保持回路の模範セッション（`sw-001`〜`sw-009` と既設の青線3本を持つ）。 */
function session() {
  const built = buildReferenceSession(parseOrThrow(selfHoldProblemJson()), JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value.session;
}

describe('applyFaults (wire faults)', () => {
  it('keeps a broken wire on the board but opens it electrically (§5.4)', () => {
    const board = session();
    const applied = applyFaults(board, [{ target: { wireId: 'sw-005' }, kind: 'wire-open' }]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const wire = board.wires.find((w) => w.id === 'sw-005');
    expect(wire?.open).toBe(true);
    expect(applied.value.wireFaults).toHaveLength(1);
    expect(applied.value.partFaults).toHaveLength(0);
  });

  it('removes an unwired connection from the board entirely', () => {
    const board = session();
    const before = board.wires.length;
    const applied = applyFaults(board, [{ target: { wireId: 'sw-009' }, kind: 'wire-missing' }]);
    expect(applied.ok).toBe(true);
    expect(board.wires).toHaveLength(before - 1);
    expect(board.wires.some((w) => w.id === 'sw-009')).toBe(false);
  });

  it('moves one end of a misrouted wire', () => {
    const board = session();
    const applied = applyFaults(board, [
      { target: { wireId: 'sw-002' }, kind: 'wire-misrouted', to: 'CR1.12' },
    ]);
    expect(applied.ok).toBe(true);
    const wire = board.wires.find((w) => w.id === 'sw-002');
    expect(wire?.from).toBe('TB_PB.2c');
    expect(wire?.to).toBe('CR1.12');
  });

  it('records the original endpoints as the fault site even for a missing wire (§9.2)', () => {
    const board = session();
    const applied = applyFaults(board, [{ target: { wireId: 'sw-009' }, kind: 'wire-missing' }]);
    if (!applied.ok) return;
    const site = applied.value.sites[0];
    expect(site?.kind).toBe('wire-missing');
    expect(site?.report).toBe('wire-missing');
    expect(site?.terminals).toEqual(['CR1.6', 'TB_PL.1+']);
  });

  it('reports an unknown wire as a problem issue (§13 #2)', () => {
    const applied = applyFaults(session(), [{ target: { wireId: 'sw-999' }, kind: 'wire-open' }]);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.errors[0]?.path).toBe('faults[0].target.wireId');
    expect(applied.errors[0]?.message).toContain('sw-999');
  });

  it('refuses to fault the pre-installed check circuit wiring (§6.3)', () => {
    const applied = applyFaults(session(), [{ target: { wireId: 'fw-chk-2' }, kind: 'wire-open' }]);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.errors[0]?.message).toContain('既設配線');
  });

  it('refuses a misrouting that would put three wires on one terminal (§6.6)', () => {
    const applied = applyFaults(session(), [
      { target: { wireId: 'sw-002' }, kind: 'wire-misrouted', to: 'CR1.13' },
    ]);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.errors[0]?.message).toContain('2本');
  });

  it('validates every spec before mutating anything: an invalid later spec leaves the session untouched (M-6)', () => {
    const board = session();
    const before = board.wires.map((w) => `${w.id}:${w.from}-${w.to}:${String(w.open)}`);
    const applied = applyFaults(board, [
      { target: { wireId: 'sw-005' }, kind: 'wire-open' },
      { target: { wireId: 'sw-999' }, kind: 'wire-open' },
    ]);
    expect(applied.ok).toBe(false);
    expect(board.wires.map((w) => `${w.id}:${w.from}-${w.to}:${String(w.open)}`)).toEqual(before);
  });
});

describe('applyFaults (part faults)', () => {
  it('leaves the board untouched and collects the fault for the netlist', () => {
    const board = session();
    const before = board.wires.map((w) => `${w.id}:${w.from}-${w.to}:${String(w.open)}`);
    const applied = applyFaults(board, [
      { target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-welded' },
    ]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(board.wires.map((w) => `${w.id}:${w.from}-${w.to}:${String(w.open)}`)).toEqual(before);
    expect(applied.value.partFaults).toHaveLength(1);
    expect(applied.value.sites[0]?.report).toBe('part-defect');
    expect(applied.value.sites[0]?.partId).toBe('CR1');
  });
});

describe('faultParam', () => {
  it('fills in the engine defaults for ohms and ratio (§5.4)', () => {
    expect(
      faultParam({ target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-resistive' }),
    ).toBe(500);
    expect(
      faultParam({
        target: { partId: 'CR1', elementIndex: 2 },
        kind: 'contact-resistive',
        ohms: 3000,
      }),
    ).toBe(3000);
    expect(
      faultParam({ target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-layer-short' }),
    ).toBe(0.65);
    expect(faultParam({ target: { wireId: 'sw-002' }, kind: 'wire-misrouted', to: 'CR1.12' })).toBe(
      'CR1.12',
    );
    expect(faultParam({ target: { wireId: 'sw-002' }, kind: 'wire-open' })).toBeUndefined();
  });

  it('returns undefined for wire-misrouted without a `to` (defensive branch)', () => {
    expect(faultParam({ target: { wireId: 'sw-002' }, kind: 'wire-misrouted' })).toBeUndefined();
  });
});

describe('injectPartFaults', () => {
  it('drops the coil resistance of a layer short to 422.5 ohms (§5.1.3)', () => {
    const board = session();
    const netlist = toNetlist(board, JIPM_BOARD);
    const faults: FaultSpecData[] = [
      { target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-layer-short', ratio: 0.65 },
    ];
    expect(injectPartFaults(netlist, faults)).toEqual([]);
    const coil = findPart(netlist, 'CR1')?.elements[0];
    expect(coil?.kind).toBe('load');
    expect(coil !== undefined && coil.kind === 'load' ? loadOhms(coil) : 0).toBeCloseTo(422.5, 3);
  });

  it('turns an engine FaultError into a problem issue', () => {
    const netlist = toNetlist(session(), JIPM_BOARD);
    const issues = injectPartFaults(netlist, [
      { target: { partId: 'CR9', elementIndex: 0 }, kind: 'coil-open' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('faults[0].target');
    expect(issues[0]?.message).toContain('CR9');
  });
});

describe('withoutPartFaults', () => {
  it('drops the faults of the replaced part only (§9.2 部品交換)', () => {
    const board = session();
    const applied = applyFaults(board, [
      { target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-open' },
      { target: { partId: 'CR2', elementIndex: 0 }, kind: 'coil-open' },
    ]);
    if (!applied.ok) return;
    const replaced = withoutPartFaults(applied.value, 'CR1');
    expect(replaced.partFaults).toHaveLength(1);
    expect(replaced.partFaults[0]?.target).toEqual({ partId: 'CR2', elementIndex: 0 });
    // 交換しても「その部品が不良だった」事実は残す（指摘の対象からは消さない。§9.2 判定①）
    expect(replaced.sites).toHaveLength(2);
    expect(replaced.sites.map((s) => s.partId)).toEqual(['CR1', 'CR2']);
  });
});

describe('matchesSite', () => {
  it('matches a broken wire only when the wire and the kind both agree (§9.2)', () => {
    const board = session();
    const applied = applyFaults(board, [{ target: { wireId: 'sw-005' }, kind: 'wire-open' }]);
    if (!applied.ok) return;
    const site = applied.value.sites[0];
    if (site === undefined) return;
    expect(matchesSite(site, { target: { wireId: 'sw-005' }, kind: 'wire-open' })).toBe(true);
    expect(matchesSite(site, { target: { wireId: 'sw-005' }, kind: 'wire-missing' })).toBe(false);
    expect(matchesSite(site, { target: { wireId: 'sw-004' }, kind: 'wire-open' })).toBe(false);
  });

  it('matches a missing wire by either of its terminals', () => {
    const board = session();
    const applied = applyFaults(board, [{ target: { wireId: 'sw-009' }, kind: 'wire-missing' }]);
    if (!applied.ok) return;
    const site = applied.value.sites[0];
    if (site === undefined) return;
    expect(matchesSite(site, { target: { terminalId: 'CR1.6' }, kind: 'wire-missing' })).toBe(true);
    expect(matchesSite(site, { target: { terminalId: 'TB_PL.1+' }, kind: 'wire-missing' })).toBe(
      true,
    );
    expect(matchesSite(site, { target: { terminalId: 'CR1.5' }, kind: 'wire-missing' })).toBe(
      false,
    );
  });

  it('matches a part fault by the part and the 部品不良 kind', () => {
    const board = session();
    const applied = applyFaults(board, [
      { target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-welded' },
    ]);
    if (!applied.ok) return;
    const site = applied.value.sites[0];
    if (site === undefined) return;
    expect(matchesSite(site, { target: { partId: 'CR1' }, kind: 'part-defect' })).toBe(true);
    expect(matchesSite(site, { target: { partId: 'CR2' }, kind: 'part-defect' })).toBe(false);
    expect(matchesSite(site, { target: { partId: 'CR1' }, kind: 'wire-open' })).toBe(false);
  });
});
