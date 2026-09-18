import { describe, expect, it } from 'vitest';
import {
  C,
  compile,
  ctu,
  end,
  endNetwork,
  hline,
  IR_COLS,
  M,
  mc,
  mcr,
  nc,
  network,
  no,
  out,
  program,
  rst,
  set,
  T,
  ton,
  vline,
  X,
  Y,
  type Cell,
  type CompileError,
  type LadderProgram,
} from '../src/index.js';

/** 最後のセルをコイル列（15列目）に置き、手前を横線で埋めた1行を作る。 */
function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const coil = row.pop();
  if (coil === undefined) throw new Error('コイルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(coil);
  return row;
}

/**
 * 自己保持（X0で入り、X1で切れ、Y0が自分を保持する）。
 * 0列目の分岐点に縦線を置き、下の行に自己保持接点 Y0 を並べる（縦線は横にも導通する）。
 * ```
 * row0: [X0(NO)][│＋横線][X1(NC)][横線 ×12][Y0(OUT)]
 * row1: [Y0(NO)]
 * ```
 */
function selfHold(): LadderProgram {
  return program(
    network('n1', [
      [
        no(X(0)),
        vline(),
        nc(X(1)),
        ...Array.from({ length: IR_COLS - 4 }, () => hline()),
        out(Y(0)),
      ],
      [no(Y(0))],
    ]),
    endNetwork(),
  );
}

function codes(errors: readonly CompileError[]): string[] {
  return errors.map((e) => e.code);
}

describe('compile', () => {
  it('accepts a self-hold program and indexes its output cells', () => {
    const result = compile(selfHold());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.program.networks).toHaveLength(2);
    expect(result.program.networks[0]?.outputs).toEqual([{ row: 0, col: 15, cell: out(Y(0)) }]);
    // END のネットワークは出力を持たない
    expect(result.program.networks[1]?.outputs).toEqual([]);
    expect(result.program.endNetworkIndex).toBe(1);
  });

  it('collects the devices the program reads and writes (§10.8 の未使用デバイス検出に使う)', () => {
    const result = compile(selfHold());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.usage.reads).toEqual([X(0), X(1), Y(0)]);
    expect(result.program.usage.writes).toEqual([Y(0)]);
    expect(result.program.inputCount).toBe(2);
    expect(result.program.outputCount).toBe(1);
  });

  it('rejects a program without END and one with cells after END (§10.3)', () => {
    const missing = compile(program(network('n1', [rung(no(X(0)), out(Y(0)))])));
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(codes(missing.errors)).toEqual(['missing-end']);

    const afterEnd = program(endNetwork(), network('n2', [rung(no(X(0)), out(Y(0)))]));
    const result = compile(afterEnd);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.errors)).toContain('after-end');
  });

  it('requires output cells in the coil column and forbids contacts there', () => {
    const wrongColumn = program(network('n1', [[no(X(0)), out(Y(0))]]), endNetwork());
    const a = compile(wrongColumn);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toContain('coil-column');

    const contactInCoilColumn = program(
      network('n1', [[...Array.from({ length: IR_COLS }, () => no(X(0)))]]),
      endNetwork(),
    );
    const b = compile(contactInCoilColumn);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(codes(b.errors)).toContain('contact-in-coil-column');
  });

  it('rejects a network with no output and a vertical line on the last row', () => {
    const noOutput = program(network('n1', [[no(X(0)), hline()]]), endNetwork());
    const a = compile(noOutput);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toContain('no-output');

    // 最終行の縦線は繋ぐ相手が無い（下の行が存在しない）
    const b = compile(program(network('n1', [rung(no(X(0)), vline(), out(Y(0)))]), endNetwork()));
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(codes(b.errors)).toContain('dangling-vline');
    // 下に行があれば正しい分岐として通る
    expect(compile(selfHold()).ok).toBe(true);
  });

  it('rejects timer and counter presets that the runtime cannot honour (§10.4)', () => {
    const badTimer = program(network('n1', [rung(no(X(0)), ton(T(0), 15))]), endNetwork());
    const a = compile(badTimer);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toEqual(['timer-preset']);
    expect(a.errors[0]?.message).toContain('10ms');

    const badCounter = program(network('n1', [rung(no(X(0)), ctu(C(0), 0, X(1)))]), endNetwork());
    const b = compile(badCounter);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(codes(b.errors)).toEqual(['counter-preset']);
  });

  it('rejects MC without MCR and MCR without MC (§10.3)', () => {
    const open = program(network('n1', [rung(no(X(0)), mc(M(0)))]), endNetwork());
    const a = compile(open);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toEqual(['mc-unmatched']);

    const stray = program(network('n1', [rung(no(X(0)), mcr(M(0)))]), endNetwork());
    const b = compile(stray);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(codes(b.errors)).toEqual(['mc-unmatched']);
  });

  it('rejects a coil that writes an input or special device (coil-on-read-only-device)', () => {
    const onInput = program(network('n1', [rung(no(X(0)), out(X(1)))]), endNetwork());
    const a = compile(onInput);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toContain('coil-on-read-only-device');

    const onInternal = program(network('n1', [rung(no(X(0)), set(M(0)))]), endNetwork());
    expect(compile(onInternal).ok).toBe(true); // internal device is writable — sanity check
  });

  it('rejects an OUT coil that writes a timer or counter device (only TON/CTU may write them)', () => {
    const onTimer = program(network('n1', [rung(no(X(0)), out(T(0)))]), endNetwork());
    const a = compile(onTimer);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(codes(a.errors)).toContain('coil-on-read-only-device');

    const onCounter = program(network('n1', [rung(no(X(0)), out(C(0)))]), endNetwork());
    const b = compile(onCounter);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(codes(b.errors)).toContain('coil-on-read-only-device');
  });

  it('rejects MC/MCR pairs whose devices differ even though depth matches (MC M9 ... MCR M3)', () => {
    const p = program(
      network('n1', [rung(no(X(0)), mc(M(9)))]),
      network('n2', [rung(no(X(1)), mcr(M(3)))]),
      endNetwork(),
    );
    const r = compile(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codes(r.errors)).toEqual(['mc-unmatched']);
  });

  it('accepts a matched MC/MCR pair', () => {
    const p = program(
      network('n1', [rung(no(X(0)), mc(M(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      network('n3', [rung(no(X(0)), mcr(M(0)))]),
      endNetwork(),
    );
    expect(compile(p).ok).toBe(true);
  });

  it('warns about a double coil instead of failing (§10.4 は後勝ちで実行する)', () => {
    const p = program(
      network('n1', [rung(no(X(0)), out(Y(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      endNetwork(),
    );
    const result = compile(p);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('double-coil');
    expect(result.warnings[0]?.device).toEqual(Y(0));
    expect(result.warnings[0]?.networkId).toBe('n2');
  });

  it('does not warn when SET and RST share a device (保持命令は二重コイルではない)', () => {
    const result = compile(
      program(
        network('n1', [rung(no(X(0)), set(M(0)))]),
        network('n2', [rung(no(X(1)), rst(M(0)))]),
        network('n3', [rung(no(M(0)), out(Y(0)))]),
        endNetwork(),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it('rejects an empty program and a broken grid', () => {
    const emptyProgram = compile({ networks: [] });
    expect(emptyProgram.ok).toBe(false);
    if (emptyProgram.ok) return;
    expect(codes(emptyProgram.errors)).toEqual(['empty-program']);

    const broken = compile({
      networks: [{ id: 'n1', rows: 2, cols: IR_COLS, cells: [[end()]] }],
    });
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(codes(broken.errors)).toContain('grid-shape');
  });
});
