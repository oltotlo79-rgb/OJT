import { describe, expect, it } from 'vitest';
import {
  C,
  COIL_COL,
  IR_COLS,
  LadderError,
  M,
  MAX_ROWS,
  T,
  X,
  Y,
  cellAt,
  clearCell,
  compile,
  ctu,
  deleteNetwork,
  deleteRow,
  device,
  empty,
  endNetwork,
  hline,
  insertNetwork,
  insertRow,
  mc,
  mcr,
  nc,
  network,
  no,
  out,
  program,
  set,
  setCell,
  setVerticalLink,
  ton,
  vline,
  type Cell,
  type LadderProgram,
} from '../src/index.js';

/**
 * Lifted from the Opus review of Plan 3A batches A-C (`ladder-edit-compile.probe.ts`).
 * Two of the review's original "GAP" cases (setVerticalLink into the coil column, MC/MCR paired
 * by depth only) are now fixed (M5 / M3) and are re-pinned here as the new, correct behaviour.
 */

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('need output');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

function base(): LadderProgram {
  return program(
    network('n1', [rung(no(X(0)), out(Y(0))), [no(X(1))]], { comment: 'net one' }),
    network('n2', [rung(no(X(2)), out(Y(1)))]),
    endNetwork(),
  );
}

const snap = (p: LadderProgram): string => JSON.stringify(p);

describe('edit.ts purity', () => {
  it('no editor call mutates its input, and unchanged networks/rows keep identity', () => {
    const p = base();
    const before = snap(p);
    const calls: ((q: LadderProgram) => LadderProgram)[] = [
      (q) => setCell(q, 'n1', 0, 2, no(M(0))),
      (q) => clearCell(q, 'n1', 0, 2),
      (q) => setVerticalLink(q, 'n1', 0, 3, true),
      (q) => insertRow(q, 'n1', 1),
      (q) => deleteRow(q, 'n1', 1),
      (q) => insertNetwork(q, 1, network('nx', [rung(no(X(3)), out(Y(2)))])),
      (q) => deleteNetwork(q, 'n2'),
    ];
    for (const call of calls) {
      const next = call(p);
      expect(snap(p), 'input mutated').toBe(before);
      expect(next).not.toBe(p);
    }
    // structural sharing
    const edited = setCell(p, 'n1', 0, 2, no(M(0)));
    expect(edited.networks[1]).toBe(p.networks[1]); // untouched network is the same object
    expect(edited.networks[2]).toBe(p.networks[2]);
    expect(edited.networks[0]?.cells[1]).toBe(p.networks[0]?.cells[1]); // untouched row
    expect(edited.networks[0]?.cells[0]).not.toBe(p.networks[0]?.cells[0]);
    expect(edited.networks[0]?.comment).toBe('net one'); // comment preserved
  });

  it('rejects out-of-range rows/cols, unknown network ids, duplicate ids', () => {
    const p = base();
    expect(() => setCell(p, 'nope', 0, 0, hline())).toThrow(LadderError);
    expect(() => setCell(p, 'n1', 2, 0, hline())).toThrow(LadderError);
    expect(() => setCell(p, 'n1', -1, 0, hline())).toThrow(LadderError);
    expect(() => setCell(p, 'n1', 0, IR_COLS, hline())).toThrow(LadderError);
    expect(() => setCell(p, 'n1', 0.5, 0, hline())).toThrow(LadderError);
    expect(() => insertNetwork(p, 0, network('n1', [[hline()]]))).toThrow(/重複/u);
    expect(() => insertNetwork(p, 4, network('nz', [[hline()]]))).toThrow(LadderError);
    expect(() => insertNetwork(p, -1, network('nz', [[hline()]]))).toThrow(LadderError);
    expect(() => deleteNetwork(p, 'nope')).toThrow(LadderError);
  });

  it('setVerticalLink refuses contacts, the coil column and the last row, and can erase', () => {
    const p = base();
    expect(() => setVerticalLink(p, 'n1', 0, 0, true)).toThrow(/罫線は空セル/u); // a contact
    expect(() => setVerticalLink(p, 'n1', 0, COIL_COL, true)).toThrow(/コイル列/u); // M5: coil column, checked before cell kind
    expect(() => setVerticalLink(p, 'n1', 1, 3, true)).toThrow(/最終行/u);
    const withLink = setVerticalLink(p, 'n1', 0, 3, true);
    expect(cellAt(withLink.networks[0]!, 0, 3).kind).toBe('vline');
    const erased = setVerticalLink(withLink, 'n1', 0, 3, false);
    expect(cellAt(erased.networks[0]!, 0, 3).kind).toBe('empty');
  });

  it('FIXED (was GAP, M5): setVerticalLink refuses the COIL column even when the cell there is empty', () => {
    const p = program(network('n1', [[no(X(0))], [no(X(1))]]), endNetwork());
    expect(() => setVerticalLink(p, 'n1', 0, COIL_COL, true)).toThrow(LadderError);
    expect(() => setVerticalLink(p, 'n1', 0, COIL_COL, true)).toThrow(/コイル列/u);
  });

  it('insertRow / deleteRow honour MAX_ROWS and the last-row rule', () => {
    let p = program(network('n1', [[no(X(0))]]), endNetwork());
    for (let i = 1; i < MAX_ROWS; i += 1) p = insertRow(p, 'n1', i);
    expect(p.networks[0]?.rows).toBe(MAX_ROWS);
    expect(() => insertRow(p, 'n1', 0)).toThrow(/上限/u);
    expect(() => insertRow(p, 'n1', MAX_ROWS + 1)).toThrow(LadderError);
    const q = program(network('n1', [[no(X(0))]]), endNetwork());
    expect(() => deleteRow(q, 'n1', 0)).toThrow(/最後の行/u);
    expect(() => deleteRow(q, 'n1', 5)).toThrow(LadderError);
    const two = insertRow(q, 'n1', 1);
    expect(deleteRow(two, 'n1', 1).networks[0]?.rows).toBe(1);
  });

  it('GAP: nothing protects the END network — it can be deleted or overwritten', () => {
    const p = base();
    const noEnd = deleteNetwork(p, 'end');
    const r = compile(noEnd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain('missing-end');

    const clobbered = setCell(p, 'end', 0, 0, no(X(0)));
    const r2 = compile(clobbered);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.map((e) => e.code)).toEqual(['no-output', 'missing-end']);

    // a network inserted AFTER the END network compiles to `after-end`
    const afterEnd = insertNetwork(p, 3, network('nz', [rung(no(X(5)), out(Y(5)))]));
    const r3 = compile(afterEnd);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.errors.map((e) => e.code)).toContain('after-end');
  });

  it('the editor can build a legal program end-to-end and it compiles', () => {
    let p = program(network('n1', [[empty()]]), endNetwork());
    p = setCell(p, 'n1', 0, 0, no(X(0)));
    p = insertRow(p, 'n1', 1);
    p = setCell(p, 'n1', 1, 0, no(Y(0)));
    p = setVerticalLink(p, 'n1', 0, 1, true);
    for (let c = 2; c < COIL_COL; c += 1) p = setCell(p, 'n1', 0, c, hline());
    p = setCell(p, 'n1', 0, COIL_COL, out(Y(0)));
    const r = compile(p);
    expect(r.ok).toBe(true);
  });
});

describe('compile() errors: codes, positions and Japanese messages', () => {
  const codesOf = (
    p: LadderProgram,
  ): { code: string; networkId: string; row?: number; col?: number; message: string }[] => {
    const r = compile(p);
    if (r.ok) throw new Error('expected failure');
    return r.errors;
  };

  it('empty-program', () => {
    const e = codesOf({ networks: [] });
    expect(e).toEqual([
      { code: 'empty-program', networkId: '', message: 'ネットワークがありません' },
    ]);
  });

  it('missing-end has no position', () => {
    const e = codesOf(program(network('n1', [rung(no(X(0)), out(Y(0)))])));
    expect(e).toEqual([
      { code: 'missing-end', networkId: '', message: 'END がありません（§10.3）' },
    ]);
  });

  it('coil-column reports the offending cell, contact-in-coil-column reports COIL_COL', () => {
    const misplaced = program(network('n1', [[no(X(0)), out(Y(0))]]), endNetwork());
    const a = codesOf(misplaced);
    expect(a[0]).toMatchObject({ code: 'coil-column', networkId: 'n1', row: 0, col: 1 });
    expect(a[0]?.message).toContain('最終列');

    const contactAtCoil = program(
      network('n1', [[...Array.from({ length: COIL_COL }, () => hline()), no(X(0))]]),
      endNetwork(),
    );
    const b = codesOf(contactAtCoil);
    expect(b[0]).toMatchObject({ code: 'contact-in-coil-column', row: 0, col: COIL_COL });
  });

  it('dangling-vline on the last row', () => {
    const e = codesOf(program(network('n1', [rung(vline(), out(Y(0)))]), endNetwork()));
    expect(e[0]).toMatchObject({ code: 'dangling-vline', networkId: 'n1', row: 0, col: 0 });
    expect(e[0]?.message).toBe('最終行の縦線は繋ぐ相手がありません');
  });

  it('timer-preset / counter-preset boundaries', () => {
    const bad = (cell: Cell) =>
      codesOf(program(network('n1', [rung(no(X(0)), cell)]), endNetwork()));
    expect(bad(ton(T(0), 0))[0]).toMatchObject({ code: 'timer-preset', row: 0, col: COIL_COL });
    expect(bad(ton(T(0), 5))[0]?.code).toBe('timer-preset');
    expect(bad(ton(T(0), 15))[0]?.code).toBe('timer-preset');
    expect(bad(ton(T(0), 3_600_010))[0]?.code).toBe('timer-preset');
    expect(bad(ton(T(0), 1.5))[0]?.code).toBe('timer-preset');
    expect(bad(ton(T(0), Number.NaN))[0]?.code).toBe('timer-preset');
    expect(compile(program(network('n1', [rung(no(X(0)), ton(T(0), 10))]), endNetwork())).ok).toBe(
      true,
    );
    expect(
      compile(program(network('n1', [rung(no(X(0)), ton(T(0), 3_600_000))]), endNetwork())).ok,
    ).toBe(true);
    expect(bad(ctu(C(0), 0, X(1)))[0]?.code).toBe('counter-preset');
    expect(bad(ctu(C(0), 32_768, X(1)))[0]?.code).toBe('counter-preset');
    expect(bad(ctu(C(0), 1.5, X(1)))[0]?.code).toBe('counter-preset');
    expect(
      compile(program(network('n1', [rung(no(X(0)), ctu(C(0), 1, X(1)))]), endNetwork())).ok,
    ).toBe(true);
  });

  it('mc-unmatched both ways', () => {
    const noMcr = codesOf(program(network('n1', [rung(no(X(0)), mc(M(9)))]), endNetwork()));
    expect(noMcr[0]).toMatchObject({ code: 'mc-unmatched', networkId: '' });
    expect(noMcr[0]?.message).toContain('対応する MCR がありません');
    const noMc = codesOf(program(network('n1', [rung(no(X(0)), mcr(M(9)))]), endNetwork()));
    expect(noMc[0]).toMatchObject({ code: 'mc-unmatched', networkId: 'n1', row: 0, col: COIL_COL });
    expect(noMc[0]?.message).toContain('対応する MC がありません');
  });

  it('FIXED (was GAP, M3): MC/MCR pairing checks the device, not just depth — mismatched numbers fail', () => {
    const e = codesOf(
      program(
        network('n1', [rung(no(X(0)), mc(M(9)))]),
        network('n2', [rung(no(X(1)), mcr(M(3)))]), // different device!
        endNetwork(),
      ),
    );
    expect(e[0]).toMatchObject({ code: 'mc-unmatched', networkId: 'n2' });
  });

  it('no-output only fires for a network with content but no output', () => {
    const e = codesOf(program(network('n1', [[no(X(0)), hline()]]), endNetwork()));
    expect(e[0]).toMatchObject({ code: 'no-output', networkId: 'n1' });
    expect(e[0]?.row).toBeUndefined();
    // an all-empty network is allowed
    expect(compile(program(network('n1', [[empty()]]), endNetwork())).ok).toBe(true);
  });

  it('grid-shape catches a hand-built inconsistent network', () => {
    const net = network('n1', [rung(no(X(0)), out(Y(0)))]);
    const wrongRows = { ...net, rows: 3 };
    const a = codesOf({ networks: [wrongRows, endNetwork()] });
    expect(a[0]).toMatchObject({ code: 'grid-shape', networkId: 'n1' });
    const wrongCols = { ...net, cols: 8 };
    const b = codesOf({ networks: [wrongCols, endNetwork()] });
    expect(b[0]?.message).toContain('列数は 16 固定');
    const shortRow = { ...net, cells: [net.cells[0]!.slice(0, 10)] };
    const c = codesOf({ networks: [shortRow, endNetwork()] });
    expect(c[0]).toMatchObject({ code: 'grid-shape', row: 0 });
  });

  it('usage / inputCount / outputCount', () => {
    const r = compile(
      program(
        network('n1', [rung(no(X(0)), nc(X(3)), out(Y(2)))]),
        network('n2', [rung(no(M(1)), ctu(C(0), 2, X(7)))]),
        network('n3', [rung(no(X(0)), set(M(1)))]),
        endNetwork(),
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.program.inputCount).toBe(8); // X7 -> 8
    expect(r.program.outputCount).toBe(3); // Y2 -> 3
    expect(r.program.usage.reads.map((d) => `${d.kind}${d.index}`)).toEqual([
      'input0',
      'input3',
      'internal1',
      'input7',
    ]);
    expect(r.program.usage.writes.map((d) => `${d.kind}${d.index}`)).toEqual([
      'output2',
      'counter0',
      'internal1',
    ]);
    expect(r.program.endNetworkIndex).toBe(3);
  });

  it('device() guards', () => {
    expect(() => device('input', -1)).toThrow(LadderError);
    expect(() => device('input', 1.5)).toThrow(LadderError);
    expect(() => device('special', 3)).toThrow(/SP0／SP1／SP2/u);
  });

  it('SET/RST are excluded from the double-coil warning but OUT+SET on the same device is not flagged', () => {
    const r = compile(
      program(
        network('n1', [rung(no(X(0)), set(M(0)))]),
        network('n2', [rung(no(X(1)), out(M(0)))]), // OUT after SET on the same M0
        endNetwork(),
      ),
    );
    expect(r.ok).toBe(true);
    // The OUT is the first *tracked* write, so no warning is produced even though the two
    // instructions fight each other every scan.
    expect(r.warnings).toEqual([]);
  });
});
