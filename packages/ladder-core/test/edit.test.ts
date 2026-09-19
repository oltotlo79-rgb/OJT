import { describe, expect, it } from 'vitest';
import {
  cellAt,
  clearCell,
  COIL_COL,
  deleteNetwork,
  deleteRow,
  empty,
  endNetwork,
  fillHlinesToCoil,
  hline,
  insertNetwork,
  insertRow,
  IR_COLS,
  LadderError,
  MAX_ROWS,
  network,
  no,
  out,
  program,
  setCell,
  setVerticalLink,
  X,
  Y,
  type Cell,
  type LadderProgram,
  type Network,
} from '../src/index.js';

/** ネットワークを取り出す（`noUncheckedIndexedAccess` の undefined をここで潰す）。 */
function netAt(source: LadderProgram, index: number): Network {
  const found = source.networks[index];
  if (found === undefined) throw new Error(`ネットワーク ${index} がありません`);
  return found;
}

/** 2行のネットワーク1つと END。 */
function base(): LadderProgram {
  return program(network('n1', [[no(X(0)), hline(), out(Y(0))], [no(X(1))]]), endNetwork());
}

describe('setCell / clearCell', () => {
  it('replaces one cell and leaves the source program untouched', () => {
    const before = base();
    const after = setCell(before, 'n1', 0, 1, no(X(2)));
    expect(cellAt(netAt(after, 0), 0, 1)).toEqual(no(X(2)));
    // 元のプログラムは書き換わらない
    expect(cellAt(netAt(before, 0), 0, 1)).toEqual(hline());
    expect(after).not.toBe(before);
  });

  it('keeps the untouched networks and rows by reference', () => {
    const before = base();
    const after = setCell(before, 'n1', 0, 1, no(X(2)));
    expect(after.networks[1]).toBe(before.networks[1]);
    expect(after.networks[0]?.cells[1]).toBe(before.networks[0]?.cells[1]);
  });

  it('clears a cell back to empty', () => {
    const after = clearCell(base(), 'n1', 0, 0);
    expect(cellAt(netAt(after, 0), 0, 0)).toEqual(empty());
  });

  it('throws for an unknown network id', () => {
    expect(() => setCell(base(), 'nope', 0, 0, hline())).toThrow(LadderError);
  });

  it('throws for a row or column outside the grid', () => {
    expect(() => setCell(base(), 'n1', 2, 0, hline())).toThrow(LadderError);
    expect(() => setCell(base(), 'n1', 0, IR_COLS, hline())).toThrow(LadderError);
  });
});

describe('setVerticalLink（罫線）', () => {
  it('draws a vertical link and removes it again', () => {
    const drawn = setVerticalLink(base(), 'n1', 0, 1, true);
    expect(cellAt(netAt(drawn, 0), 0, 1).kind).toBe('vline');
    const erased = setVerticalLink(drawn, 'n1', 0, 1, false);
    expect(cellAt(netAt(erased, 0), 0, 1)).toEqual(empty());
  });

  it('refuses to draw over a contact or a coil', () => {
    expect(() => setVerticalLink(base(), 'n1', 0, 0, true)).toThrow(LadderError);
    expect(() => setVerticalLink(base(), 'n1', 0, 2, true)).toThrow(LadderError);
  });

  it('refuses to draw below the last row', () => {
    expect(() => setVerticalLink(base(), 'n1', 1, 1, true)).toThrow(LadderError);
  });

  it('refuses the coil column even when the cell there is empty (M5)', () => {
    // n1 row1 のコイル列は空セル（out(Y(0)) は row0 にしかない）なので
    // 「空セル・横線・縦線の上にだけ引ける」規則は満たすが、コイル列には
    // 罫線を引けないという別の規則で弾かれる。
    expect(() => setVerticalLink(base(), 'n1', 1, IR_COLS - 1, true)).toThrow(LadderError);
    expect(() => setVerticalLink(base(), 'n1', 1, IR_COLS - 1, false)).toThrow(LadderError);
  });
});

describe('insertRow / deleteRow', () => {
  it('inserts an empty row at the given index', () => {
    const after = insertRow(base(), 'n1', 1);
    expect(after.networks[0]?.rows).toBe(3);
    expect(after.networks[0]?.cells[1]).toHaveLength(IR_COLS);
    expect(cellAt(netAt(after, 0), 1, 0)).toEqual(empty());
    // 元の2行目は3行目にずれる
    expect(cellAt(netAt(after, 0), 2, 0)).toEqual(no(X(1)));
  });

  it('refuses to grow a network past MAX_ROWS', () => {
    let grown = base();
    while ((grown.networks[0]?.rows ?? 0) < MAX_ROWS) grown = insertRow(grown, 'n1', 1);
    expect(grown.networks[0]?.rows).toBe(MAX_ROWS);
    expect(() => insertRow(grown, 'n1', 1)).toThrow(LadderError);
  });

  it('deletes a row but never the last one', () => {
    const after = deleteRow(base(), 'n1', 1);
    expect(after.networks[0]?.rows).toBe(1);
    expect(() => deleteRow(after, 'n1', 0)).toThrow(LadderError);
  });
});

describe('insertNetwork / deleteNetwork', () => {
  it('inserts a network at the given position', () => {
    const added = insertNetwork(base(), 1, network('n2', [[no(X(3)), out(Y(1))]]));
    expect(added.networks.map((net) => net.id)).toEqual(['n1', 'n2', 'end']);
  });

  it('refuses a duplicated network id and an impossible position', () => {
    expect(() => insertNetwork(base(), 0, network('n1', [[hline()]]))).toThrow(LadderError);
    expect(() => insertNetwork(base(), 9, network('n2', [[hline()]]))).toThrow(LadderError);
  });

  it('deletes a network and throws for an unknown id', () => {
    const after = deleteNetwork(base(), 'n1');
    expect(after.networks.map((net) => net.id)).toEqual(['end']);
    expect(() => deleteNetwork(after, 'n1')).toThrow(LadderError);
  });
});

describe('連続した編集', () => {
  it('keeps every row rectangular（`rows` × `IR_COLS`）after a series of edits', () => {
    let edited = insertRow(base(), 'n1', 1);
    edited = setCell(edited, 'n1', 1, 0, no(Y(0)));
    edited = setVerticalLink(edited, 'n1', 0, 1, true);
    edited = deleteRow(edited, 'n1', 2);
    for (const net of edited.networks) {
      expect(net.cells).toHaveLength(net.rows);
      for (const line of net.cells) expect(line).toHaveLength(IR_COLS);
      expect(net.cols).toBe(IR_COLS);
    }
    expect(cellAt(netAt(edited, 0), 1, 0)).toEqual(no(Y(0)));
  });
});

describe('fillHlinesToCoil（コイルの自動結線）', () => {
  /** コイル列（15列目）に出力セルを置いた1行のネットワーク。 */
  function withCoil(...left: readonly Cell[]): LadderProgram {
    const row: Cell[] = [...left];
    while (row.length < COIL_COL) row.push(empty());
    row.push(out(Y(0)));
    return program(network('n1', [row]), endNetwork());
  }

  it('fills every empty cell between the rightmost symbol and the coil', () => {
    const filled = fillHlinesToCoil(withCoil(no(X(0))), 'n1', 0);
    const net = netAt(filled, 0);
    for (let col = 1; col < COIL_COL; col += 1) expect(cellAt(net, 0, col)).toEqual(hline());
    expect(cellAt(net, 0, 0)).toEqual(no(X(0)));
    expect(cellAt(net, 0, COIL_COL)).toEqual(out(Y(0)));
  });

  it('starts at column 0 when the row holds nothing but the coil', () => {
    const net = netAt(fillHlinesToCoil(withCoil(), 'n1', 0), 0);
    expect(cellAt(net, 0, 0)).toEqual(hline());
    expect(cellAt(net, 0, COIL_COL - 1)).toEqual(hline());
  });

  it('never touches a cell left of the rightmost symbol', () => {
    const start = withCoil(no(X(0)), empty(), no(X(1)));
    const net = netAt(fillHlinesToCoil(start, 'n1', 0), 0);
    // 記号と記号の間の穴はそのまま（勝手に繋がない）
    expect(cellAt(net, 0, 1)).toEqual(empty());
    expect(cellAt(net, 0, 3)).toEqual(hline());
  });

  it('does nothing when the coil column is not an output cell', () => {
    const start = program(network('n1', [[no(X(0))]]), endNetwork());
    expect(fillHlinesToCoil(start, 'n1', 0)).toBe(start);
  });

  it('returns the same program when there is no gap to fill', () => {
    const start = fillHlinesToCoil(withCoil(no(X(0))), 'n1', 0);
    expect(fillHlinesToCoil(start, 'n1', 0)).toBe(start);
  });

  it('leaves the source program untouched and rejects a row outside the network', () => {
    const start = withCoil(no(X(0)));
    fillHlinesToCoil(start, 'n1', 0);
    expect(cellAt(netAt(start, 0), 0, 1)).toEqual(empty());
    expect(() => fillHlinesToCoil(start, 'n1', 9)).toThrow(LadderError);
    expect(() => fillHlinesToCoil(start, 'nope', 0)).toThrow(LadderError);
  });
});
