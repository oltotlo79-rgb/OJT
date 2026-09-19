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
import { counterPresetText } from '../session/ladder-cell.js';
import type { LadderCursor, LadderEditorMode } from '../session/ladder.js';
import { skinMonitorColor } from '../session/plc-skin.js';
import type { SkinTheme } from './skins/index.js';
import {
  END_SYMBOL_ID,
  MC_SYMBOL_ID,
  MCR_SYMBOL_ID,
  symbolMetrics,
  type SymbolMetrics,
  type SymbolShape,
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

/** コメントを `lines` 行に折り返す（入りきらない分は最後の行の末尾を `…` にする）。 */
export function commentLines(text: string, lines: number, perLine: number): string[] {
  if (lines <= 0 || text.length === 0) return [];
  const out: string[] = [];
  for (let index = 0; index < lines; index += 1) {
    const slice = text.slice(index * perLine, (index + 1) * perLine);
    if (slice.length === 0) break;
    const last = index === lines - 1 && text.length > (index + 1) * perLine;
    out.push(last ? `${slice.slice(0, Math.max(0, perLine - 1))}…` : slice);
  }
  return out;
}

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

/**
 * セルに書く文字。**綴りはすべて方言（`DialectProfile`）から引く**ので、命令語も設定値も
 * この部品には1つも直書きしない（§10.5 / 決定表#1）。
 *
 * - `device`: 方言表記のデバイス名（`X10` / `0.00` / `1X000` / `007366`）
 * - `preset`: タイマ・カウンタの設定値（`K30` / `#0030` / `H0005` / `0005`）。レビュー I3
 * - `mnemonic`: 命令語（`SET` / `TIM` / `TMR` / `F-40`）。角括弧と命令ボックスが使う
 */
function cellLabels(
  cell: Cell,
  profile: DialectProfile,
): { device: string; preset: string; mnemonic: string } {
  const names = profile.instructionNames;
  if (cell.kind === 'contact') {
    return { device: profile.formatDevice(cell.device), preset: '', mnemonic: '' };
  }
  if (cell.kind === 'coil') {
    return {
      device: profile.formatDevice(cell.device),
      preset: '',
      mnemonic: cell.type === 'OUT' ? '' : cell.type === 'SET' ? names.set : names.rst,
    };
  }
  if (cell.kind === 'timer') {
    const preset = profile.timerPreset(cell.presetMs, cell.device);
    return {
      device: profile.formatDevice(cell.device),
      preset: preset instanceof Error ? `${String(cell.presetMs)}ms` : preset.text,
      mnemonic: names.timer,
    };
  }
  if (cell.kind === 'counter') {
    return {
      device: profile.formatDevice(cell.device),
      preset: counterPresetText(cell.preset, profile),
      mnemonic: names.counter,
    };
  }
  if (cell.kind === 'mc' || cell.kind === 'mcr') {
    return {
      device: profile.formatDevice(cell.device),
      preset: '',
      mnemonic: cell.kind === 'mc' ? names.mc : names.mcr,
    };
  }
  if (cell.kind === 'end') return { device: '', preset: '', mnemonic: names.end };
  return { device: '', preset: '', mnemonic: '' };
}

/** セルの記号（`SymbolDrawing` の識別子）。線画を持たないセルは `undefined`。 */
function symbolIdOf(cell: Cell, profile: DialectProfile): string | undefined {
  const symbols = profile.symbols;
  switch (cell.kind) {
    case 'contact': {
      /*
       * 実機ではb接点で使う特殊デバイス（シャープの `007366`＝常時ON。4A H-4 / §17 #22）。
       * IRの `SP0` は「常時ON」という意味そのもので、a接点で描くと実機の見た目と食い違う。
       * 判定・ランタイムには一切効かない**表示だけ**の話である。
       */
      const inverted =
        cell.device.kind === 'special' &&
        (profile.specialInverted ?? []).includes(cell.device.index);
      if (cell.type === 'NO') return inverted ? symbols.nc : symbols.no;
      if (cell.type === 'NC') return inverted ? symbols.no : symbols.nc;
      // 微分接点（`P` / `F`）は反転しない（立上り／立下りそのものが向きを持つ）
      return cell.type === 'P' ? symbols.rise : symbols.fall;
    }
    case 'coil':
      return cell.type === 'OUT' ? symbols.coil : cell.type === 'SET' ? symbols.set : symbols.rst;
    case 'timer':
      return symbols.timer;
    case 'counter':
      return symbols.counter;
    // MC / MCR / END は `SymbolDrawing` に無いので本アプリ側の固定IDを使う（`symbols.ts`）
    case 'mc':
      return MC_SYMBOL_ID;
    case 'mcr':
      return MCR_SYMBOL_ID;
    case 'end':
      return END_SYMBOL_ID;
    default:
      return undefined;
  }
}

/**
 * 記号の中・脇に置く文字。`SymbolShape.layout` が置き方を決める（`symbols.ts`）。
 *
 * - `contact` / `coil`: デバイス名は記号の**上**。丸コイルに設定値があるときは同じ行に
 *   「デバイス名 設定値」と左右に分けて並べる（GX Works3風の `OUT T0 K30`）
 * - `bracket`: `[SET Y0]` のように命令語とデバイスを括弧の中に1行で
 * - `box`: 命令語・デバイス・設定値を箱の中に3行で（CX-Programmer風の命令ボックス）
 */
function SymbolLabels({
  shape,
  labels,
  metrics,
}: {
  shape: SymbolShape;
  labels: { device: string; preset: string; mnemonic: string };
  metrics: SymbolMetrics;
}): JSX.Element | null {
  const mid = metrics.w / 2;
  if (shape.layout === 'bracket') {
    const line = [labels.mnemonic, labels.device].filter((part) => part !== '').join(' ');
    return line === '' ? null : (
      <text x={mid} y={metrics.bracketTextY} className={styles.frameText} data-testid="frame-text">
        {line}
      </text>
    );
  }
  if (shape.layout === 'box') {
    return (
      <>
        {[labels.mnemonic, labels.device, labels.preset].map((line, index) =>
          line === '' ? null : (
            <text
              key={`${String(index)}:${line}`}
              x={mid}
              y={metrics.boxTextY[index] ?? metrics.bracketTextY}
              className={index === 0 ? styles.frameText : styles.boxOperandText}
              data-testid={index === 2 ? 'preset-text' : `box-line-${String(index)}`}
            >
              {line}
            </text>
          ),
        )}
      </>
    );
  }
  if (labels.device === '') return null;
  // 設定値があるときだけ、デバイス名と設定値を桟の中心で左右に分けて同じ行に置く
  const paired = labels.preset !== '';
  return (
    <>
      <text
        x={paired ? mid - 2 : mid}
        y={metrics.labelY}
        className={paired ? `${styles.deviceText} ${styles.deviceTextEnd}` : styles.deviceText}
      >
        {labels.device}
      </text>
      {paired ? (
        <text
          x={mid + 2}
          y={metrics.labelY}
          className={`${styles.presetText} ${styles.presetTextStart}`}
          data-testid="preset-text"
        >
          {labels.preset}
        </text>
      ) : null}
    </>
  );
}

/** 1セルぶんの描画。 */
function GridCell({
  cell,
  cursorKey,
  cellKey,
  cell9,
  profile,
  theme,
  metrics,
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
  theme: SkinTheme;
  metrics: SymbolMetrics;
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
  const shape = symbolId === undefined ? undefined : metrics.shape(symbolId);
  const labels = cellLabels(cell, profile);
  const conducting = cell.kind === 'hline' || cell.kind === 'vline';
  /*
   * その記号が「通っている」か（左右とも通電）。GX Works3風は裏に帯を敷き（`block`）、
   * ほかのスキンは線を太くする「パワーフロー」（`flow`）。「実物との対応」表
   */
  const energised = leftOn && rightOn;
  const flowing = energised && theme.monitorStyle === 'flow';
  const wireClass = flowing ? `${styles.wire} ${styles.powered}` : styles.wire;
  const symbolClass = flowing ? `${styles.symbol} ${styles.powered}` : styles.symbol;
  /*
   * 命令ボックスは箱がセルの高さをほぼ使い切るので、デバイスコメントを置く場所が無い
   * （`SkinTheme.commentLines` の注記）。接点・丸コイル・角括弧の下にだけ出す。
   */
  const commentRows = shape?.layout === 'box' ? 0 : theme.commentLines;
  return (
    <g
      data-testid={`cell-${cellKey}`}
      role="gridcell"
      aria-selected={selected}
      data-error={error}
      data-powered={leftOn}
      className={styles.cell}
      transform={`translate(${String(cell9.col * metrics.w)} ${String(cell9.row * metrics.h)})`}
      onClick={() => {
        onPick({ networkId: cell9.networkId, row: cell9.row, col: cell9.col });
      }}
    >
      {/* 当たり判定（透明の矩形。線だけだとクリックしづらい） */}
      <rect width={metrics.w} height={metrics.h} className={styles.cellHit} />
      {/*
        GX Works3風の通電表示: 通っている記号の**裏**に色の帯を敷く（`monitorStyle: 'block'`）。
        線より先に描いて、記号と文字がその上に乗るようにする。「実物との対応」表
      */}
      {energised && theme.monitorStyle === 'block' ? (
        <rect
          data-testid="powered-block"
          x={metrics.poweredBlock.x}
          y={metrics.poweredBlock.y}
          width={metrics.poweredBlock.w}
          height={metrics.poweredBlock.h}
          fill={colors.powered}
          className={styles.poweredBlock}
        />
      ) : null}
      {conducting ? (
        <path d={metrics.leadFull} stroke={leftColor} className={wireClass} />
      ) : shape === undefined ? null : (
        <>
          {shape.leadLeft === '' ? null : (
            <path d={shape.leadLeft} stroke={leftColor} className={wireClass} />
          )}
          {shape.leadRight === '' ? null : (
            <path d={shape.leadRight} stroke={rightColor} className={wireClass} />
          )}
        </>
      )}
      {cell.kind === 'vline' && hasLinkBelow ? (
        <>
          <path d={metrics.linkDown} stroke={leftColor} className={wireClass} />
          {/* 分岐の接合点（T字）。縦線が桟から降りる場所にだけ打つ */}
          <circle
            data-testid="junction"
            cx={0}
            cy={metrics.wireY}
            r={metrics.junctionR}
            fill={leftColor}
            className={styles.junction}
          />
        </>
      ) : null}
      {shape?.paths.map((d) => (
        // `data-symbol` は「どの記号で描いたか」をテストから引くための印（Plan 4B Task 4）
        <path key={d} d={d} data-symbol={symbolId} stroke={rightColor} className={symbolClass} />
      ))}
      {shape?.circle === undefined ? null : (
        // 出力は**丸**（利用者要求 2026-09-20）
        <circle
          data-symbol={symbolId}
          cx={shape.circle.cx}
          cy={shape.circle.cy}
          r={shape.circle.r}
          stroke={rightColor}
          className={symbolClass}
        />
      )}
      {shape?.text === undefined ? null : (
        <text x={metrics.w / 2} y={metrics.wireY + 4} className={styles.symbolText}>
          {shape.text}
        </text>
      )}
      {shape === undefined ? null : (
        <SymbolLabels shape={shape} labels={labels} metrics={metrics} />
      )}
      {/*
        デバイスコメントは記号の**下**に `theme.commentLines` 行で出す
        （CX-Programmer風は2行。「実物との対応」表）。長い文字は行ごとに切る。
      */}
      {comment === undefined
        ? null
        : commentLines(comment, commentRows, metrics.commentChars).map((line, index) => (
            <text
              key={line + String(index)}
              className={styles.commentText}
              data-testid={`comment-line-${String(index)}`}
              x={metrics.w / 2}
              y={metrics.commentY - (commentRows - 1 - index) * metrics.commentLineH}
            >
              {line}
            </text>
          ))}
      {selected ? (
        <>
          <rect width={metrics.w} height={metrics.h} className={styles.cursor} />
          {/*
            色だけに頼らない手がかり（内側の破線）。JTEKT風・SHARP風はカーソル色と背景の
            コントラストが低いので、色を判別できなくても選択セルだと分かるようにする（レビュー M11）
          */}
          <rect
            x={2}
            y={2}
            width={Math.max(0, metrics.w - 4)}
            height={Math.max(0, metrics.h - 4)}
            data-testid="cursor-inner"
            className={styles.cursorInner}
          />
        </>
      ) : null}
      {error ? <rect width={metrics.w} height={metrics.h} className={styles.errorCell} /> : null}
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
  theme,
  metrics,
  mode,
  comments,
  errorCells,
  gridCols,
  columns,
  width,
  startStep,
  cursorKey,
  onPickCell,
}: {
  net: Network;
  profile: DialectProfile;
  theme: SkinTheme;
  metrics: SymbolMetrics;
  mode: LadderEditorMode;
  comments: Record<string, string>;
  errorCells: ReadonlySet<string>;
  gridCols: number;
  columns: number[];
  width: number;
  /** この回路ブロックの先頭行の番号（左の行番号欄に出す。§10.6 の画面構成） */
  startStep: number;
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
  // 通電色の決め方は3箇所に散っていた（`skins/index.ts` / `ProjectTree.tsx` とここ）ので
  // `skinMonitorColor()` の1本に集める（レビュー M13）
  const colors = { ...profile.monitorColors, powered: skinMonitorColor(profile, monitorColor) };
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
        height={net.rows * metrics.h}
        viewBox={`0 0 ${String(width)} ${String(net.rows * metrics.h)}`}
        role="grid"
        aria-label={`${JA.ladder.network} ${net.id}`}
      >
        {/*
          左の行番号欄（4社とも回路の左に番号が並ぶ。§10.6 の画面構成）。
          実機のステップ番号は命令の数で進むが、本アプリの中間表現は命令の並びを持たないので
          **回路ブロックの通し行数**を出す（`SKIN_ASSUMED` の △）。
        */}
        {Array.from({ length: net.rows }, (_unused, row) => (
          <text
            key={`step-${net.id}:${String(row)}`}
            data-testid={`step-${net.id}:${String(row)}`}
            className={styles.stepText}
            x={metrics.stepGutter - 5}
            y={row * metrics.h + metrics.wireY + 3}
          >
            {startStep + row}
          </text>
        ))}
        {/* 左母線（全行を繋ぐ。§10.3） */}
        <rect
          x={metrics.stepGutter}
          width={RAIL_W}
          height={net.rows * metrics.h}
          className={styles.rail}
          data-testid={`rail-${net.id}`}
        />
        <g transform={`translate(${String(metrics.stepGutter + RAIL_W)} 0)`}>
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
                    theme={theme}
                    metrics={metrics}
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
                  d={metrics.leadAcrossHidden(columns.length - 2, row)}
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
  theme,
  cursor,
  mode,
  comments,
  errorCells,
  gridCols,
  onPickCell,
}: {
  program: LadderProgram;
  profile: DialectProfile;
  /** 見た目（セル寸法・線幅・コメント行数）。決定表#5 / #6 */
  theme: SkinTheme;
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
  const metrics = symbolMetrics(theme.cell);
  const columns = displayColumns(gridCols);
  const width = metrics.stepGutter + RAIL_W + columns.length * metrics.w;
  const cursorKey = `${cursor.networkId}:${String(cursor.row)}:${String(cursor.col)}`;
  // 行番号は回路ブロックをまたいで通しで数える（実機のステップ番号の見え方に寄せる）
  let step = 0;
  return (
    <div className={styles.gridScroll} data-testid="ladder-grid">
      {program.networks.map((net) => {
        const startStep = step;
        step += net.rows;
        return (
          <NetworkView
            key={net.id}
            net={net}
            profile={profile}
            theme={theme}
            metrics={metrics}
            mode={mode}
            comments={comments}
            errorCells={errorCells}
            gridCols={gridCols}
            columns={columns}
            width={width}
            startStep={startStep}
            cursorKey={cursorKey}
            onPickCell={onPickCell}
          />
        );
      })}
    </div>
  );
}

/**
 * ラダーのセルグリッド。親（`LadderEditor`）はキー入力のたびに再描画されるので `memo` する。§15
 */
export const LadderGrid = memo(LadderGridImpl);
