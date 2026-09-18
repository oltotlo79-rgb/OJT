import { describe, expect, it } from 'vitest';
import {
  C,
  IR_COLS,
  M,
  SP,
  T,
  X,
  Y,
  compile,
  createPlcRuntime,
  ctu,
  endNetwork,
  hline,
  mc,
  mcr,
  network,
  no,
  out,
  program,
  rise,
  set,
  ton,
  type Cell,
  type LadderProgram,
  type PlcIoPort,
  type PlcRuntime,
} from '../src/index.js';

/**
 * Regression tests lifted from the Opus review of Plan 3A batches A-C
 * (`ladder-scan.probe.ts` / `ladder-gaps.probe.ts`). M2-M6 are covered by the compile.ts /
 * edit.ts / runtime.ts fixes and their own test files; this file characterises the two gaps the
 * review left as accepted behaviour (M7, M8) plus the scan-structure probes that had no existing
 * coverage (edge memory reset, coil visibility across networks within/between scans, nested MC).
 */

class Io implements PlcIoPort {
  inputs: boolean[];
  outputs: boolean[] = [];
  constructor(n = 8) {
    this.inputs = Array.from({ length: n }, () => false);
  }
  readInputs(): readonly boolean[] {
    return this.inputs;
  }
  writeOutputs(v: readonly boolean[]): void {
    this.outputs = [...v];
  }
}

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('need output');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

function boot(p: LadderProgram, io: Io, outputCount = 8): PlcRuntime {
  const r = compile(p);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return createPlcRuntime(r.program, { io, outputCount });
}

describe('§10.4 scan structure (no prior coverage)', () => {
  it('a coil written in network n is visible to network n+1 in the SAME scan', () => {
    const io = new Io();
    io.inputs[0] = true;
    const rt = boot(
      program(
        network('n1', [rung(no(X(0)), out(M(0)))]),
        network('n2', [rung(no(M(0)), out(Y(0)))]),
        endNetwork(),
      ),
      io,
    );
    rt.scan();
    expect(rt.bit(Y(0))).toBe(true); // one scan is enough
  });

  it('a coil written in network n is only visible to network n-1 on the NEXT scan', () => {
    const io = new Io();
    io.inputs[0] = true;
    const rt = boot(
      program(
        network('n1', [rung(no(M(0)), out(Y(0)))]), // reads M0 BEFORE it is written
        network('n2', [rung(no(X(0)), out(M(0)))]),
        endNetwork(),
      ),
      io,
    );
    rt.scan();
    expect(rt.bit(M(0))).toBe(true);
    expect(rt.bit(Y(0))).toBe(false); // one scan of delay
    rt.scan();
    expect(rt.bit(Y(0))).toBe(true);
  });
});

describe('P/F edge contacts', () => {
  it('reset() clears the edge memory so a held-ON input pulses again', () => {
    const io = new Io();
    io.inputs[0] = true;
    const rt = boot(program(network('n1', [rung(rise(X(0)), out(Y(0)))]), endNetwork()), io);
    rt.scan();
    rt.scan();
    expect(rt.bit(Y(0))).toBe(false);
    rt.reset();
    rt.scan();
    expect(rt.bit(Y(0))).toBe(true);
  });
});

describe('MC / MCR', () => {
  it('nested MC: the inner region is off whenever the outer one is', () => {
    const io = new Io();
    const rt = boot(
      program(
        network('n1', [rung(no(X(0)), mc(M(9)))]),
        network('n2', [rung(no(X(1)), mc(M(8)))]),
        network('n3', [rung(no(SP(0)), out(Y(0)))]),
        network('n4', [rung(no(SP(0)), mcr(M(8)))]),
        network('n5', [rung(no(SP(0)), out(Y(1)))]),
        network('n6', [rung(no(SP(0)), mcr(M(9)))]),
        endNetwork(),
      ),
      io,
    );
    io.inputs[0] = true;
    io.inputs[1] = true;
    rt.scan();
    expect([rt.bit(Y(0)), rt.bit(Y(1))]).toEqual([true, true]);
    io.inputs[1] = false;
    rt.scan();
    expect([rt.bit(Y(0)), rt.bit(Y(1))]).toEqual([false, true]);
    io.inputs[0] = false;
    io.inputs[1] = true;
    rt.scan();
    expect([rt.bit(Y(0)), rt.bit(Y(1))]).toEqual([false, false]);
  });

  it('a counter RST inside an inactive MC region STILL resets (FX behaviour: RST is checked before mcActive)', () => {
    const io = new Io();
    const rt = boot(
      program(
        network('n1', [rung(no(X(0)), mc(M(9)))]),
        network('n2', [rung(no(X(3)), ctu(C(0), 2, X(7)))]),
        network('n3', [rung(no(SP(0)), mcr(M(9)))]),
        endNetwork(),
      ),
      io,
    );
    io.inputs[0] = true;
    for (let i = 0; i < 2; i += 1) {
      io.inputs[3] = true;
      rt.scan();
      io.inputs[3] = false;
      rt.scan();
    }
    expect(rt.state().counters[0]?.value).toBe(2);
    io.inputs[0] = false; // region off
    io.inputs[7] = true; // RST device on
    rt.scan();
    expect(rt.state().counters[0]?.value).toBe(0);
  });
});

describe('GAP 3 / M7: OUT and SET on the same device raise no double-coil warning', () => {
  it('is accepted by Mitsubishi rule: SET M0 then OUT M0 in a later network fight every scan with no diagnostic', () => {
    const p = program(
      network('n1', [rung(no(X(0)), set(M(0)))]),
      network('n2', [rung(no(X(1)), out(M(0)))]),
      network('n3', [rung(no(M(0)), out(Y(0)))]),
      endNetwork(),
    );
    const r = compile(p);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]); // accepted: SET/OUT is not "double coil" by Mitsubishi's rule
    if (!r.ok) return;
    const io = new Io();
    const rt = boot(p, io);
    io.inputs[0] = true; // SET M0
    rt.scan();
    expect(rt.bit(M(0))).toBe(false); // the OUT in n2 clears the latch the SET just made
  });
});

describe('GAP 5 / M8: an MC and a coil in the SAME network apply in row order', () => {
  it('a coil ABOVE the MC row is outside the region; below it is inside (documented: accepted, row-order behaviour)', () => {
    const io = new Io();
    const rt = boot(
      program(
        network('n1', [rung(no(SP(0)), out(Y(0))), rung(no(X(0)), mc(M(9)))]),
        network('n2', [rung(no(SP(0)), out(Y(1)))]),
        network('n3', [rung(no(SP(0)), mcr(M(9)))]),
        endNetwork(),
      ),
      io,
    );
    io.inputs[0] = false; // region off
    rt.scan();
    expect(rt.bit(Y(0))).toBe(true); // row 0 ran before the MC row -> unaffected
    expect(rt.bit(Y(1))).toBe(false);
  });
});

describe('TON with a non-default scan period', () => {
  it('with scanMs=20 the same 100ms preset takes 5 scans', () => {
    const io = new Io();
    const r = compile(program(network('n1', [rung(no(X(0)), ton(T(0), 100))]), endNetwork()));
    if (!r.ok) throw new Error('compile');
    const rt = createPlcRuntime(r.program, { io, scanMs: 20 });
    io.inputs[0] = true;
    for (let i = 0; i < 4; i += 1) rt.scan();
    expect(rt.bit(T(0))).toBe(false);
    rt.scan();
    expect(rt.bit(T(0))).toBe(true);
    expect(rt.tMs).toBe(100);
  });
});
