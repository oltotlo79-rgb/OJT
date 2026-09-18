import {
  cellAt,
  COIL_COL,
  empty,
  IR_COLS,
  LadderError,
  MAX_ROWS,
  vline,
  type Cell,
  type LadderProgram,
  type Network,
} from './ir.js';

/**
 * ラダーIRの編集API。設計仕様 §10.3 / §10.7。
 *
 * すべて純粋関数である。渡されたプログラムは書き換えず、新しいプログラムを返す。
 * 変更しなかったネットワークと行は同じ参照のまま新しい配列に入れるので、
 * Plan 3B は戻り値をそのまま取り消し／やり直しのスナップショットに積める。
 */

/** ネットワークとその位置を探す（無ければ `LadderError`）。 */
function locate(program: LadderProgram, networkId: string): { index: number; net: Network } {
  const index = program.networks.findIndex((candidate) => candidate.id === networkId);
  const net = program.networks[index];
  if (index < 0 || net === undefined) {
    throw new LadderError(`ネットワークがありません: ${networkId}`);
  }
  return { index, net };
}

/** ネットワークを差し替えた新しいプログラムを返す。 */
function replaceNetwork(program: LadderProgram, index: number, next: Network): LadderProgram {
  const networks = [...program.networks];
  networks[index] = next;
  return { networks };
}

/** 行・列が範囲内か。 */
function assertCellAt(net: Network, row: number, col: number): void {
  if (!Number.isInteger(row) || row < 0 || row >= net.rows) {
    throw new LadderError(`ネットワーク ${net.id} に行 ${row} はありません`);
  }
  if (!Number.isInteger(col) || col < 0 || col >= net.cols) {
    throw new LadderError(`ネットワーク ${net.id} に列 ${col} はありません`);
  }
}

/** 空の1行。 */
function emptyRow(): Cell[] {
  return Array.from({ length: IR_COLS }, () => empty());
}

/** セルを置き換える。§10.3 */
export function setCell(
  program: LadderProgram,
  networkId: string,
  row: number,
  col: number,
  cell: Cell,
): LadderProgram {
  const { index, net } = locate(program, networkId);
  assertCellAt(net, row, col);
  const cells = net.cells.map((line, r) =>
    r === row ? line.map((current, c) => (c === col ? cell : current)) : line,
  );
  return replaceNetwork(program, index, { ...net, cells });
}

/** セルを空にする。 */
export function clearCell(
  program: LadderProgram,
  networkId: string,
  row: number,
  col: number,
): LadderProgram {
  return setCell(program, networkId, row, col, empty());
}

/**
 * 罫線（縦線）を引く／消す。§10.3
 * 縦線はセルそのものなので、接点やコイルの上には引けない（消すと回路が壊れるため）。
 */
export function setVerticalLink(
  program: LadderProgram,
  networkId: string,
  row: number,
  col: number,
  on: boolean,
): LadderProgram {
  const { net } = locate(program, networkId);
  assertCellAt(net, row, col);
  if (col === COIL_COL) {
    throw new LadderError(
      `罫線はコイル列（${COIL_COL}）には引けません: ${net.id} (${row}, ${col})`,
    );
  }
  const current = cellAt(net, row, col);
  if (current.kind !== 'empty' && current.kind !== 'hline' && current.kind !== 'vline') {
    throw new LadderError(
      `罫線は空セル・横線・縦線の上にだけ引けます: ${net.id} (${row}, ${col}) は ${current.kind}`,
    );
  }
  if (on && row + 1 >= net.rows) {
    throw new LadderError(`ネットワーク ${net.id} の最終行（${row}）の下には罫線を引けません`);
  }
  return setCell(program, networkId, row, col, on ? vline() : empty());
}

/** 空の行を挿入する。 */
export function insertRow(program: LadderProgram, networkId: string, atRow: number): LadderProgram {
  const { index, net } = locate(program, networkId);
  if (!Number.isInteger(atRow) || atRow < 0 || atRow > net.rows) {
    throw new LadderError(`ネットワーク ${net.id} の行 ${atRow} には挿入できません`);
  }
  if (net.rows + 1 > MAX_ROWS) {
    throw new LadderError(`ネットワーク ${net.id} の行数が上限（${MAX_ROWS}）を超えます`);
  }
  const cells = [...net.cells.slice(0, atRow), emptyRow(), ...net.cells.slice(atRow)];
  return replaceNetwork(program, index, { ...net, rows: cells.length, cells });
}

/** 行を削除する（最後の1行は残す）。 */
export function deleteRow(program: LadderProgram, networkId: string, atRow: number): LadderProgram {
  const { index, net } = locate(program, networkId);
  assertCellAt(net, atRow, 0);
  if (net.rows <= 1) {
    throw new LadderError(`ネットワーク ${net.id} の最後の行は削除できません`);
  }
  const cells = net.cells.filter((_line, r) => r !== atRow);
  return replaceNetwork(program, index, { ...net, rows: cells.length, cells });
}

/** ネットワークを挿入する（IDの重複は不可）。 */
export function insertNetwork(
  program: LadderProgram,
  atIndex: number,
  net: Network,
): LadderProgram {
  if (!Number.isInteger(atIndex) || atIndex < 0 || atIndex > program.networks.length) {
    throw new LadderError(`ネットワークを位置 ${atIndex} には挿入できません`);
  }
  if (program.networks.some((existing) => existing.id === net.id)) {
    throw new LadderError(`ネットワークIDが重複しています: ${net.id}`);
  }
  return {
    networks: [...program.networks.slice(0, atIndex), net, ...program.networks.slice(atIndex)],
  };
}

/** ネットワークを削除する。 */
export function deleteNetwork(program: LadderProgram, networkId: string): LadderProgram {
  const { index } = locate(program, networkId);
  return { networks: program.networks.filter((_net, i) => i !== index) };
}
