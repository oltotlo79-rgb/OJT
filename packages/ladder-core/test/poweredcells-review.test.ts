import { describe, expect, it } from 'vitest';
import {
  COIL_COL,
  IR_COLS,
  M,
  X,
  Y,
  cellAt,
  compile,
  createPlcRuntime,
  empty,
  endNetwork,
  hline,
  nc,
  network,
  no,
  out,
  program,
  vline,
  type Cell,
  type LadderProgram,
  type Network,
  type PlcIoPort,
} from '../src/index.js';

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

/**
 * Independent brute-force continuity evaluator (BFS over the node graph), written from §10.3's
 * rules only: every row's left edge is the left rail; a conducting cell shorts its own left and
 * right edges; a `vline` additionally shorts its left edge to the cell below's left edge.
 */
function bruteForcePowered(net: Network, bits: (c: Cell) => boolean): Map<string, boolean> {
  const rows = net.rows;
  const cols = net.cols;
  const key = (r: number, c: number): string => `${r}/${c}`;
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  };
  for (let r = 1; r < rows; r += 1) link(key(0, 0), key(r, 0));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = cellAt(net, r, c);
      const conducts =
        cell.kind === 'hline' || cell.kind === 'vline' || (cell.kind === 'contact' && bits(cell));
      if (conducts) link(key(r, c), key(r, c + 1));
      if (cell.kind === 'vline' && r + 1 < rows) link(key(r, c), key(r + 1, c));
    }
  }
  const seen = new Set<string>([key(0, 0)]);
  const queue = [key(0, 0)];
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const m of adj.get(n) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        queue.push(m);
      }
    }
  }
  const out = new Map<string, boolean>();
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const live = seen.has(key(r, c));
      // recordPoweredCells() reports `false` for an empty column-0 cell even though the rail
      // graph itself ties it to the left rail (M4): match that display-only rule here too.
      const cell = cellAt(net, r, c);
      out.set(`${net.id}:${r}:${c}`, c === 0 && cell.kind === 'empty' ? false : live);
    }
  }
  return out;
}

function pad(cells: Cell[]): Cell[] {
  const row = [...cells];
  while (row.length < IR_COLS) row.push(empty());
  return row;
}

describe('poweredCells vs a brute-force continuity evaluator', () => {
  const randomCell = (rng: () => number): Cell => {
    const r = rng();
    if (r < 0.3) return empty();
    if (r < 0.5) return hline();
    if (r < 0.65) return vline();
    if (r < 0.85) return no(X(Math.floor(rng() * 4)));
    return nc(X(Math.floor(rng() * 4)));
  };

  it('agrees on 400 random grids (no coils, states swept)', () => {
    let seed = 12345;
    const rng = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 400; trial += 1) {
      const rows = 1 + Math.floor(rng() * 4);
      const grid: Cell[][] = [];
      for (let r = 0; r < rows; r += 1) {
        const row: Cell[] = [];
        for (let c = 0; c < COIL_COL; c += 1) {
          // the last row may not carry a vline (compile rejects it)
          let cell = randomCell(rng);
          if (r === rows - 1 && cell.kind === 'vline') cell = hline();
          row.push(cell);
        }
        row.push(out(Y(r)));
        grid.push(pad(row));
      }
      const net = network('n1', grid);
      const p = program(net, endNetwork());
      const compiled = compile(p);
      if (!compiled.ok) continue;
      const io = new Io();
      for (let i = 0; i < 4; i += 1) io.inputs[i] = rng() < 0.5;
      const rt = createPlcRuntime(compiled.program, { io, outputCount: 8 });
      rt.scan();
      const got = rt.state().poweredCells;
      const want = bruteForcePowered(net, (cell) => {
        if (cell.kind !== 'contact') return false;
        const on = io.inputs[cell.device.index] ?? false;
        return cell.type === 'NO' ? on : !on;
      });
      for (const [k, v] of want) {
        expect(got[k], `trial ${trial} cell ${k}`).toBe(v);
      }
      // the coil column value must equal the coil's driven state
      for (let r = 0; r < rows; r += 1) {
        expect(rt.bit(Y(r)), `trial ${trial} coil ${r}`).toBe(got[`n1:${r}:${COIL_COL}`]);
      }
    }
  });

  it('hand-checked series network: power stops at the open contact', () => {
    const io = new Io();
    const net = network('n1', [
      pad([no(X(0)), no(X(1)), ...Array.from({ length: COIL_COL - 2 }, () => hline()), out(Y(0))]),
    ]);
    const c = compile(program(net, endNetwork()));
    if (!c.ok) throw new Error('compile');
    const rt = createPlcRuntime(c.program, { io, outputCount: 4 });
    io.inputs[0] = true;
    rt.scan();
    const s = rt.state().poweredCells;
    expect(s['n1:0:0']).toBe(true); // left of X0 = rail
    expect(s['n1:0:1']).toBe(true); // X0 closed -> left of X1 live
    expect(s['n1:0:2']).toBe(false); // X1 open
    expect(s[`n1:0:${COIL_COL}`]).toBe(false);
    io.inputs[1] = true;
    rt.scan();
    expect(rt.state().poweredCells[`n1:0:${COIL_COL}`]).toBe(true);
  });

  it('hand-checked OR branch (self-hold): the lower rung feeds the coil', () => {
    const io = new Io();
    const net = network('n1', [
      pad([
        no(X(0)),
        vline(),
        nc(X(1)),
        ...Array.from({ length: COIL_COL - 3 }, () => hline()),
        out(Y(0)),
      ]),
      pad([no(Y(0))]),
    ]);
    const c = compile(program(net, endNetwork()));
    if (!c.ok) throw new Error('compile');
    const rt = createPlcRuntime(c.program, { io, outputCount: 4 });
    io.inputs[0] = true;
    rt.scan();
    expect(rt.bit(Y(0))).toBe(true);
    io.inputs[0] = false;
    rt.scan();
    expect(rt.bit(Y(0))).toBe(true); // held by the branch
    const s = rt.state().poweredCells;
    expect(s['n1:1:0']).toBe(true); // Y0 contact's left edge is the rail
    expect(s['n1:1:1']).toBe(true); // Y0 closed
    expect(s['n1:0:1']).toBe(true); // the vline node is fed from below
    expect(s['n1:0:0']).toBe(true);
    io.inputs[1] = true; // stop
    rt.scan();
    expect(rt.bit(Y(0))).toBe(false);
  });

  it('FIXED (was KNOWN QUIRK): an EMPTY cell at column 0 of a branch row is no longer reported powered (M4)', () => {
    const io = new Io();
    const net = network('n1', [
      pad([no(X(0)), vline(), ...Array.from({ length: COIL_COL - 2 }, () => hline()), out(Y(0))]),
      pad([empty(), no(X(1))]),
    ]);
    const c = compile(program(net, endNetwork()));
    if (!c.ok) throw new Error('compile');
    const rt = createPlcRuntime(c.program, { io, outputCount: 4 });
    rt.scan(); // both inputs OFF
    const s = rt.state().poweredCells;
    // The branch is dead. Before M4, (1,0) was reported live because every row's column-0
    // node is unioned onto the left rail in the Rails constructor; recordPoweredCells() now
    // reports `false` for an empty column-0 cell for display purposes even though the rail
    // graph itself still ties it to the left rail (conduction is unchanged).
    expect(s['n1:1:0']).toBe(false);
    expect(s['n1:1:1']).toBe(false);
    expect(rt.bit(Y(0))).toBe(false); // conduction itself is still right
  });

  it('a hline at column 0 of a branch row really does tap the left rail', () => {
    const io = new Io();
    const net = network('n1', [
      pad([no(X(0)), vline(), ...Array.from({ length: COIL_COL - 2 }, () => hline()), out(Y(0))]),
      pad([hline(), no(X(1))]),
    ]);
    const c = compile(program(net, endNetwork()));
    if (!c.ok) throw new Error('compile');
    const rt = createPlcRuntime(c.program, { io, outputCount: 4 });
    io.inputs[1] = true;
    rt.scan();
    expect(rt.bit(Y(0))).toBe(true);
  });

  it('documented deviation #14: a back-feeding (reverse current) rung is accepted', () => {
    const io = new Io();
    //  row0: X0 -- vline -- X1 --> coil Y0
    //  row1:  .  -- vline -- X2 --> (feeds back into row0 through the vline)
    const net = network('n1', [
      pad([
        no(X(0)),
        vline(),
        no(X(1)),
        ...Array.from({ length: COIL_COL - 3 }, () => hline()),
        out(Y(0)),
      ]),
      pad([no(X(2)), hline(), no(X(3))]),
    ]);
    const c = compile(program(net, endNetwork()));
    if (!c.ok) throw new Error('compile');
    const rt = createPlcRuntime(c.program, { io, outputCount: 4 });
    io.inputs[2] = true; // X2 only
    io.inputs[1] = true; // X1
    rt.scan();
    // The rail reaches row1 col0 -> X2 -> hline -> node(1,2)?? no: the vline is at (0,1),
    // so row1 col1's left node is tied to row0 col1. X2 closed brings the rail to (1,1),
    // which lifts (0,1) and therefore closes the path X1 -> coil even though X0 is open.
    expect(rt.bit(Y(0))).toBe(true);
  });
});

describe('poweredCells refresh', () => {
  it('is rebuilt every scan (stale keys from a previous scan do not linger)', () => {
    const io = new Io();
    const net = network('n1', [
      pad([no(X(0)), ...Array.from({ length: COIL_COL - 1 }, () => hline()), out(Y(0))]),
    ]);
    const c = compile(program(net, endNetwork()));
    if (!c.ok) throw new Error('compile');
    const rt = createPlcRuntime(c.program, { io, outputCount: 4 });
    io.inputs[0] = true;
    rt.scan();
    expect(rt.state().poweredCells[`n1:0:${COIL_COL}`]).toBe(true);
    io.inputs[0] = false;
    rt.scan();
    expect(rt.state().poweredCells[`n1:0:${COIL_COL}`]).toBe(false);
    expect(Object.keys(rt.state().poweredCells)).toHaveLength(IR_COLS);
  });

  it('the snapshot is a copy (mutating it does not affect the runtime)', () => {
    const io = new Io();
    const c = compile(
      program(
        network('n1', [
          pad([no(X(0)), ...Array.from({ length: COIL_COL - 1 }, () => hline()), out(Y(0))]),
        ]),
        endNetwork(),
      ),
    );
    if (!c.ok) throw new Error('compile');
    const rt = createPlcRuntime(c.program, { io, outputCount: 4 });
    rt.scan();
    const s = rt.state();
    s.poweredCells['n1:0:0'] = false;
    s.outputs[0] = true;
    s.inputs[0] = true;
    expect(rt.state().poweredCells['n1:0:0']).toBe(true);
    expect(rt.state().outputs[0]).toBe(false);
  });
});

describe('performance', () => {
  it('10 000 scans of the largest built-in ladder', () => {
    const io = new Io();
    // the counter ladder: 6 networks + END
    const p: LadderProgram = program(
      network(
        'n1',
        [pad([no(X(0)), ...Array.from({ length: COIL_COL - 1 }, () => hline())])].map((r) => {
          const row = [...r];
          row[COIL_COL] = out(M(0));
          return row;
        }),
      ),
      ...Array.from({ length: 5 }, (_u, i) =>
        network(`n${i + 2}`, [
          (() => {
            const row: Cell[] = [no(M(0))];
            while (row.length < COIL_COL) row.push(hline());
            row.push(out(Y(i)));
            return row;
          })(),
          pad([no(X(1)), vline(), nc(X(2))]),
          pad([no(Y(i))]),
        ]),
      ),
      endNetwork(),
    );
    const c = compile(p);
    if (!c.ok) throw new Error(JSON.stringify(c.errors));
    const rt = createPlcRuntime(c.program, { io, outputCount: 16 });
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i += 1) {
      if (i % 100 === 0) io.inputs[0] = !io.inputs[0];
      rt.scan();
    }
    const ms = performance.now() - t0;
    // 10 000 scans == 100 s of simulated time. A 6 s built-in problem is 600 scans.
    console.log(
      `10 000 scans of 6 networks: ${ms.toFixed(1)} ms (${(ms / 10).toFixed(3)} ms/scan)`,
    );
    expect(ms).toBeLessThan(5000);
  });
});
