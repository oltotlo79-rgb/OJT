import {
  cellAt,
  COIL_COL,
  deviceLabel,
  IR_COLS,
  type Cell,
  type LadderProgram,
  type Network,
} from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { memo, useRef, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import type { LadderCursor, LadderEditorMode } from '../session/ladder.js';
import {
  CELL_H,
  CELL_W,
  END_MARK,
  LEAD_FULL,
  LEAD_LEFT,
  LEAD_RIGHT,
  leadAcrossHidden,
  LINK_DOWN,
  MC_SYMBOL_ID,
  MCR_SYMBOL_ID,
  symbolShape,
  WIRE_Y,
} from './symbols.js';
import styles from './ladder.module.css';

/**
 * ラダーのセルグリッド（SVG）。設計仕様 §10.3 / §10.6 / §10.7。決定表#1
 *
 * 表示するのは「スキンの接点列数（`profile.gridCols`）＋ コイル列1」だけで、IR の中間列
 * （11〜14）は描かない。そこに中身がある場合は見出しに警告を出し、設定画面の
 * 「ラダーの表示列数」で広げてもらう（§10.6 が 8〜15 の範囲で変更できると定めている）。
 *
 * この部品は**描くだけ**で、キー入力も編集も持たない（`LadderEditor` の役目）。
 */

/** 左母線の幅[px]。 */
const RAIL_W = 6;

/** 表示する列（IRの列番号）の並び。最後は必ずコイル列。 */
export function displayColumns(gridCols: number): number[] {
  const contacts = Math.min(Math.max(gridCols, 1), COIL_COL);
  return [...Array.from({ length: contacts }, (_unused, i) => i), COIL_COL];
}

/**
 * 表示しない列に**中身**があるか。
 *
 * 罫線（`hline` / `vline`）は「中身」ではない。`applyLadderCell()` が接点とコイルの間を横線で
 * 埋めるので、正しく組んだラダーでも 11〜14 列目には必ず `hline` が並ぶ。それを中身と数えると
 * **どの課題でも常に警告が出て**、警告が意味を失う（レビュー指摘 I9）。接点・コイル・タイマ・
 * カウンタ・MC/MCR・END が隠れているときだけ警告する。
 */
const HIDDEN_IGNORED: ReadonlySet<Cell['kind']> = new Set(['empty', 'hline', 'vline']);

export function hasHiddenCells(net: Network, gridCols: number): boolean {
  for (let row = 0; row < net.rows; row += 1) {
    for (let col = gridCols; col < COIL_COL; col += 1) {
      if (!HIDDEN_IGNORED.has(cellAt(net, row, col).kind)) return true;
    }
  }
  return false;
}

/**
 * その行の**見えない列が罫線だけで繋がっている**か（`applyLadderCell()` の自動の横線）。
 *
 * 真なら最後の接点列とコイルの間に導線を重ねて描き、回路が繋がっていることを見せる。
 * 見えない列に空セルがあれば（＝本当に切れている）描かないし、記号があれば
 * `hasHiddenCells()` の警告の役目なので、ここでは描かない。
 */
function hiddenSpanIsWire(net: Network, gridCols: number, row: number): boolean {
  if (gridCols >= COIL_COL) return false;
  if (cellAt(net, row, COIL_COL).kind === 'empty') return false;
  // 最後に**見えている**セルが空なら、そこで本当に切れている（レビュー指摘 #1）。
  if (cellAt(net, row, gridCols - 1).kind === 'empty') return false;
  let wires = 0;
  for (let col = gridCols; col < COIL_COL; col += 1) {
    const kind = cellAt(net, row, col).kind;
    if (kind !== 'hline' && kind !== 'vline') return false;
    wires += 1;
  }
  return wires > 0;
}

/** セルの見出し文字（デバイス名）と副文字（設定値）。 */
function cellText(cell: Cell, profile: DialectProfile): { top: string; bottom: string } {
  if (
    cell.kind === 'contact' ||
    cell.kind === 'coil' ||
    cell.kind === 'mc' ||
    cell.kind === 'mcr'
  ) {
    return { top: profile.formatDevice(cell.device), bottom: '' };
  }
  if (cell.kind === 'timer') {
    const preset = profile.timerPreset(cell.presetMs, cell.device);
    return {
      top: profile.formatDevice(cell.device),
      bottom: preset instanceof Error ? `${String(cell.presetMs)}ms` : preset.text,
    };
  }
  if (cell.kind === 'counter') {
    return { top: profile.formatDevice(cell.device), bottom: `K${String(cell.preset)}` };
  }
  return { top: '', bottom: '' };
}

/** セルの記号（`SymbolDrawing` の識別子）。線画を持たないセルは `undefined`。 */
function symbolIdOf(cell: Cell, profile: DialectProfile): string | undefined {
  const symbols = profile.symbols;
  switch (cell.kind) {
    case 'contact':
      return cell.type === 'NO'
        ? symbols.no
        : cell.type === 'NC'
          ? symbols.nc
          : cell.type === 'P'
            ? symbols.rise
            : symbols.fall;
    case 'coil':
      return cell.type === 'OUT' ? symbols.coil : cell.type === 'SET' ? symbols.set : symbols.rst;
    case 'timer':
      return symbols.timer;
    case 'counter':
      return symbols.counter;
    // MC / MCR は `SymbolDrawing` に無いので本アプリ側の固定IDを使う（`symbols.ts`）
    case 'mc':
      return MC_SYMBOL_ID;
    case 'mcr':
      return MCR_SYMBOL_ID;
    default:
      return undefined;
  }
}

/** 1セルぶんの描画。 */
function GridCell({
  cell,
  cursorKey,
  cellKey,
  cell9,
  profile,
  comment,
  leftOn,
  rightOn,
  colors,
  error,
  hasLinkBelow,
  onPick,
}: {
  cell: Cell;
  cellKey: string;
  cursorKey: string;
  cell9: { row: number; col: number; networkId: string };
  profile: DialectProfile;
  comment: string | undefined;
  leftOn: boolean;
  rightOn: boolean;
  colors: { powered: string; idle: string };
  error: boolean;
  hasLinkBelow: boolean;
  onPick: (cursor: LadderCursor) => void;
}): JSX.Element {
  const selected = cellKey === cursorKey;
  const leftColor = leftOn ? colors.powered : colors.idle;
  const rightColor = rightOn ? colors.powered : colors.idle;
  const symbolId = symbolIdOf(cell, profile);
  const shape = symbolId === undefined ? undefined : symbolShape(symbolId);
  const text = cellText(cell, profile);
  const conducting = cell.kind === 'hline' || cell.kind === 'vline';
  return (
    <g
      data-testid={`cell-${cellKey}`}
      role="gridcell"
      aria-selected={selected}
      data-error={error}
      data-powered={leftOn}
      className={styles.cell}
      transform={`translate(${String(cell9.col * CELL_W)} ${String(cell9.row * CELL_H)})`}
      onClick={() => {
        onPick({ networkId: cell9.networkId, row: cell9.row, col: cell9.col });
      }}
    >
      {/* 当たり判定（透明の矩形。線だけだとクリックしづらい） */}
      <rect width={CELL_W} height={CELL_H} className={styles.cellHit} />
      {conducting ? (
        <path d={LEAD_FULL} stroke={leftColor} className={styles.wire} />
      ) : shape === undefined ? null : (
        <>
          <path d={LEAD_LEFT} stroke={leftColor} className={styles.wire} />
          <path d={LEAD_RIGHT} stroke={rightColor} className={styles.wire} />
        </>
      )}
      {cell.kind === 'vline' && hasLinkBelow ? (
        <path d={LINK_DOWN} stroke={leftColor} className={styles.wire} />
      ) : null}
      {cell.kind === 'end'
        ? END_MARK.map((d) => <path key={d} d={d} stroke={colors.idle} className={styles.wire} />)
        : null}
      {shape?.paths.map((d) => (
        <path key={d} d={d} stroke={rightColor} className={styles.symbol} />
      ))}
      {shape?.text === undefined ? null : (
        <text x={CELL_W / 2} y={WIRE_Y + 4} className={styles.symbolText}>
          {shape.text}
        </text>
      )}
      {text.top === '' ? null : (
        <text x={CELL_W / 2} y={9} className={styles.deviceText}>
          {text.top}
        </text>
      )}
      {text.bottom === '' ? null : (
        <text x={CELL_W / 2} y={CELL_H - 9} className={styles.presetText}>
          {text.bottom}
        </text>
      )}
      {comment === undefined ? null : (
        <text x={CELL_W / 2} y={CELL_H - 1} className={styles.commentText}>
          {comment}
        </text>
      )}
      {selected ? <rect width={CELL_W} height={CELL_H} className={styles.cursor} /> : null}
      {error ? <rect width={CELL_W} height={CELL_H} className={styles.errorCell} /> : null}
    </g>
  );
}

/**
 * 1ネットワークぶんの描画。**`plcMonitor.powered[net.id]` をここで直接購読する**（決定表#5）。
 *
 * 以前は `LadderEditor` がスナップショット全体（`plcMonitor.powered`。全ネットワーク分の
 * `Record`）を購読して `LadderGrid` に丸ごと渡していたため、モニタ中は毎スキャン（約33ms毎）に
 * 新しいオブジェクトが届き、`memo(LadderGrid)` が効かずネットワークが何本あっても全部
 * 再描画されていた（Batch 2 レビュー D1）。ここでは文字列1本（`net.id` の分だけ）を購読するので、
 * 通電が変わったネットワークだけが再描画される。
 */
function NetworkView({
  net,
  profile,
  mode,
  comments,
  errorCells,
  gridCols,
  columns,
  width,
  cursorKey,
  onPickCell,
}: {
  net: Network;
  profile: DialectProfile;
  mode: LadderEditorMode;
  comments: Record<string, string>;
  errorCells: ReadonlySet<string>;
  gridCols: number;
  columns: number[];
  width: number;
  cursorKey: string;
  onPickCell: (cursor: LadderCursor) => void;
}): JSX.Element {
  const bits = useStore((s) => (mode === 'monitor' ? (s.plcMonitor?.powered[net.id] ?? '') : ''));
  const on = (row: number, col: number): boolean => bits.charAt(row * IR_COLS + col) === '1';
  /*
   * 設定画面のモニタ色（`monitorColor`）が方言の既定色（`profile.monitorColors.powered`）を
   * 上書きする（Task 16 で設定を追加したが配線されていなかった。Batch 4+5 レビュー M15）。
   * 未設定（空文字）なら方言の既定へ戻す。`idle`（非通電）色は方言のまま。
   */
  const monitorColor = useStore((s) => s.monitorColor);
  const colors = {
    ...profile.monitorColors,
    powered: monitorColor.length > 0 ? monitorColor : profile.monitorColors.powered,
  };
  // レンダー回数を DOM に出す（D1 のテストが「他ネットワークの通電が変わっても再描画されない」
  // ことを確かめるための、副作用の無い観測用カウンタ）。
  const renderCount = useRef(0);
  renderCount.current += 1;
  return (
    <section
      className={styles.network}
      data-testid={`network-${net.id}`}
      data-render-count={renderCount.current}
    >
      <header className={styles.networkHeader}>
        <span className={styles.networkId}>{net.id}</span>
        {net.comment === undefined ? null : (
          <span className={styles.networkComment}>{net.comment}</span>
        )}
        {hasHiddenCells(net, gridCols) ? (
          <span className={styles.hiddenWarn} data-testid={`hidden-cells-${net.id}`}>
            {JA.ladder.hiddenCells}
          </span>
        ) : null}
      </header>
      <svg
        className={styles.grid}
        width={width}
        height={net.rows * CELL_H}
        viewBox={`0 0 ${String(width)} ${String(net.rows * CELL_H)}`}
        role="grid"
        aria-label={`${JA.ladder.network} ${net.id}`}
      >
        {/* 左母線（全行を繋ぐ。§10.3） */}
        <rect
          width={RAIL_W}
          height={net.rows * CELL_H}
          className={styles.rail}
          data-testid={`rail-${net.id}`}
        />
        <g transform={`translate(${String(RAIL_W)} 0)`}>
          {Array.from({ length: net.rows }, (_unused, row) => (
            // `role="grid"` の直下は `role="row"` を挟んでから `gridcell` にする（レビュー指摘 I4）
            <g role="row" key={`${net.id}:${String(row)}`}>
              {columns.map((col, index) => {
                const cell = cellAt(net, row, col);
                const key = `${net.id}:${String(row)}:${String(col)}`;
                const deviceComment =
                  'device' in cell ? comments[deviceLabel(cell.device)] : undefined;
                return (
                  <GridCell
                    key={key}
                    cellKey={key}
                    cursorKey={cursorKey}
                    cell={cell}
                    cell9={{ networkId: net.id, row, col: index }}
                    profile={profile}
                    comment={deviceComment}
                    /*
                     * 空セルは塗らない。`poweredCells` は「どの行でも0列目は左母線と
                     * 繋がっている」ので真になり（3A `Rails` の構築）、何も書いていない
                     * 行の先頭まで青く光ってしまう。3A 側で `false` を返すよう直っても
                     * この判定はそのまま正しい。
                     */
                    leftOn={cell.kind !== 'empty' && on(row, col)}
                    rightOn={
                      cell.kind !== 'empty' && (col < COIL_COL ? on(row, col + 1) : on(row, col))
                    }
                    colors={colors}
                    error={errorCells.has(key)}
                    hasLinkBelow={row + 1 < net.rows}
                    onPick={(picked) => {
                      onPickCell({ ...picked, col });
                    }}
                  />
                );
              })}
              {/* 省略された列が横線で埋まっている行は、コイルまで桟を延ばして「繋がって見える」ようにする */}
              {hiddenSpanIsWire(net, gridCols, row) ? (
                <path
                  data-testid={`rung-to-coil-${net.id}:${String(row)}`}
                  d={leadAcrossHidden(columns.length - 2, row)}
                  stroke={on(row, COIL_COL) ? colors.powered : colors.idle}
                  className={styles.wire}
                  aria-hidden="true"
                />
              ) : null}
            </g>
          ))}
        </g>
      </svg>
    </section>
  );
}

/** ラダーのセルグリッド。 */
function LadderGridImpl({
  program,
  profile,
  cursor,
  mode,
  comments,
  errorCells,
  gridCols,
  onPickCell,
}: {
  program: LadderProgram;
  profile: DialectProfile;
  cursor: LadderCursor;
  mode: LadderEditorMode;
  /** デバイスコメント（キーは `deviceLabel()` の形）。§10.7 */
  comments: Record<string, string>;
  /** 変換エラーが指すセル（`"net:row:col"`）。 */
  errorCells: ReadonlySet<string>;
  /** 表示する接点列数（設定で変えられる。§10.6） */
  gridCols: number;
  onPickCell: (cursor: LadderCursor) => void;
}): JSX.Element {
  const columns = displayColumns(gridCols);
  const width = RAIL_W + columns.length * CELL_W;
  const cursorKey = `${cursor.networkId}:${String(cursor.row)}:${String(cursor.col)}`;
  return (
    <div className={styles.gridScroll} data-testid="ladder-grid">
      {program.networks.map((net) => (
        <NetworkView
          key={net.id}
          net={net}
          profile={profile}
          mode={mode}
          comments={comments}
          errorCells={errorCells}
          gridCols={gridCols}
          columns={columns}
          width={width}
          cursorKey={cursorKey}
          onPickCell={onPickCell}
        />
      ))}
    </div>
  );
}

/**
 * ラダーのセルグリッド。親（`LadderEditor`）はキー入力のたびに再描画されるので `memo` する。§15
 */
export const LadderGrid = memo(LadderGridImpl);
