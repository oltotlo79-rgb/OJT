import {
  cellAt,
  COIL_COL,
  deviceLabel,
  hline,
  IR_COLS,
  type Cell,
  type LadderProgram,
  type Network,
} from '@ojt/ladder-core';
import { MIN_GRID_COLS, type DialectProfile } from '@ojt/plc-dialects';
import { memo, useMemo, useRef, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { counterPresetText } from '../session/ladder-cell.js';
import { shortcutKeyOf, type LadderCursor, type LadderEditorMode } from '../session/ladder.js';
import { skinMonitorColor } from '../session/plc-skin.js';
import type { SkinCell, SkinTheme } from './skins/index.js';
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

/**
 * 左母線の幅[px]（利用者要求 2026-09-20 2回目「各社ソフトの実画面にもっと寄せる」）。
 * 実機の画面と同じく左は太く（3px）、右は導線と同じ細さ（1.2px）にする。
 */
const RAIL_W = 3;
/** 右母線の幅[px]（`RIGHT_RAIL_SPAN` はそのぶん svg を広げる量）。 */
const RIGHT_RAIL_W = 1.2;
const RIGHT_RAIL_SPAN = 2;

/**
 * 行番号を出す行（回路ブロックの**先頭行**だけ。利用者要求 2026-09-20 2回目）。
 * 目印（`step-<net>:<row>`）の綴りは機能一覧表（`docs/manual/coverage.json`）が持っているので、
 * 行番号を1つに減らしても綴りの形は変えない。
 */
const STEP_LABEL_ROW = 0;

/**
 * END の行に敷く導線（利用者要求 2026-09-20「END行の縦線2本は何？」）。
 *
 * IR では END は0列目にある（`endNetwork()`）が、どの社のソフトも END 行は**ふつうの回路**
 * ——左母線から右へ桟が1本走り、出力列に `[END]`（角括弧）か `END` の命令ボックスが載る——
 * として描く。裸の縦棒2本（旧 `END_MARK`）は実機のどの画面にも無いので消した。
 */
const END_ROW_WIRE: Cell = hline();

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

/** `.gridScroll` の左右パディング（`ladder.module.css` の `padding: 6px 8px 24px`）。 */
const GRID_SCROLL_PAD_X = 16;

/**
 * ペインの実測幅に収まる接点列数（UI監査 2026-09-20 Blocking #6 / B6）。
 *
 * 1440px 幅では、スキンの既定列数（11）ぶんの格子（母線・行番号欄・コイル列を含む）が
 * ラダーのペインより広く、横スクロールに出したコイル列が画面外に出ていた。ここでは
 * `LadderWorkspace` が実測したペイン幅（`.workspaceMain` の幅。`.gridScroll` 自身と同じ
 * 内寸を持つ）に収まる列数まで**接点列だけ**を削り、コイル列は常に画面内に収める。
 *
 * 実測できない（`availableWidthPx` が未測定・0以下）ときは元の列数をそのまま返す
 * （jsdom で `getBoundingClientRect()` が全て0を返すテストでも、既存の見た目を変えない）。
 * `MIN_GRID_COLS`（8列）より狭くはしない——それでも足りない幅は、1280px の1列レイアウトが
 * 十分な幅を渡すので実際には起きない（`ladder-layout.test.tsx` の `gridWidth()` 参照）。
 */
export function fitGridCols(
  requestedCols: number,
  availableWidthPx: number | undefined,
  cell: Pick<SkinCell, 'stepGutterPx' | 'widthPx'>,
): number {
  if (availableWidthPx === undefined || availableWidthPx <= 0) return requestedCols;
  const chrome = cell.stepGutterPx + RAIL_W + RIGHT_RAIL_SPAN + GRID_SCROLL_PAD_X;
  const maxCols = Math.floor((availableWidthPx - chrome) / cell.widthPx) - 1; // コイル列ぶんを引く
  if (maxCols >= requestedCols) return requestedCols;
  return Math.max(MIN_GRID_COLS, maxCols);
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
 * 出力（コイル・タイマ・カウンタ・MC/MCR・END）を持つセルの種別。
 * CX-Programmer 風の「出力の無いネットワークに赤線」（Phase 7 設計 §5.2 の S4）が使う。
 */
const OUTPUT_CELL_KINDS: ReadonlySet<Cell['kind']> = new Set([
  'coil',
  'timer',
  'counter',
  'mc',
  'mcr',
  'end',
]);

/**
 * その回路ブロックが**未完成**か（中身はあるのに出力が無い）。Phase 7 設計 §5.2 / §5.4
 *
 * 「変換」の段を持たないメーカー（`convertStep: false`）は、変換の指摘を待たずにその場で
 * 未完成を示す（右端の赤い縦線）。まだ何も置いていない回路ブロックは「未完成」ではない
 * （課題を開いた直後に全ブロックが赤くなると、赤が意味を失う）。
 */
export function networkNeedsOutput(net: Network): boolean {
  let hasContent = false;
  for (let row = 0; row < net.rows; row += 1) {
    for (let col = 0; col <= COIL_COL; col += 1) {
      const kind = cellAt(net, row, col).kind;
      if (OUTPUT_CELL_KINDS.has(kind)) return false;
      if (kind !== 'empty') hasContent = true;
    }
  }
  return hasContent;
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
  if (cell.kind === 'draft') {
    const mnemonic = {
      NO: '',
      NC: '',
      P: '',
      F: '',
      OUT: '',
      SET: names.set,
      RST: names.rst,
      TON: names.timer,
      CTU: names.counter,
      MC: names.mc,
      MCR: names.mcr,
    }[cell.symbol];
    return { device: '', preset: '', mnemonic };
  }
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
    case 'draft': {
      const map = {
        NO: symbols.no,
        NC: symbols.nc,
        P: symbols.rise,
        F: symbols.fall,
        OUT: symbols.coil,
        SET: symbols.set,
        RST: symbols.rst,
        TON: symbols.timer,
        CTU: symbols.counter,
        MC: MC_SYMBOL_ID,
        MCR: MCR_SYMBOL_ID,
      };
      return map[cell.symbol];
    }
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
    // 被演算子を持たない命令（END）は仕切り線の無い箱なので、命令語を箱の中央に1行で置く
    if (labels.device === '' && labels.preset === '') {
      return labels.mnemonic === '' ? null : (
        <text
          x={mid}
          y={metrics.bracketTextY}
          className={styles.frameText}
          data-testid="frame-text"
        >
          {labels.mnemonic}
        </text>
      );
    }
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
  /*
   * デバイス名は記号（縦棒・丸）の**真上**に中央揃えで置く。設定値（`K30`）があるときは
   * 丸の**右**の桟の上に右詰めで添える（GX Works3風の `OUT T0 K30`）。右母線に触れないよう
   * `presetX` はセルの右端の内側で、地の色の縁取り（`presetText` の `paint-order`）で
   * 下を通る桟から浮かせる。利用者要求 2026-09-20 2回目
   */
  return (
    <>
      <text x={mid} y={metrics.labelY} className={styles.deviceText}>
        {labels.device}
      </text>
      {labels.preset === '' ? null : (
        <text
          x={metrics.presetX}
          y={metrics.presetY}
          className={`${styles.presetText} ${styles.presetTextEnd}`}
          data-testid="preset-text"
        >
          {labels.preset}
        </text>
      )}
    </>
  );
}

/**
 * 格子から回路入力欄を開く入口（入口C。Phase 7 設計 §5.3）。
 *
 * **単クリックはカーソル移動のまま**にして（視点操作・選択と衝突させない）、空セルの
 * **ダブルクリック**と**右クリックメニュー**を入口にする。`memo(GridCell)` を効かせるため、
 * ここに入れる関数は呼び出し側で安定させること（毎レンダー作り直さない）。
 */
export interface GridEntry {
  /** ダブルクリック（空セルなら記号を選ぶ欄、置いてあるセルならその編集）。 */
  onOpen: (cursor: LadderCursor) => void;
  /** 右クリック。画面座標（`clientX` / `clientY`）にメニューを出す。 */
  onMenu: (cursor: LadderCursor, x: number, y: number) => void;
  /** ツールバーの記号ボタンから格子へドロップした（JW-300SP 風。設計 §5.2 の S8）。 */
  onDropSymbol: (cursor: LadderCursor, kind: string) => void;
}

/** 入口Cを渡されなかったとき（格子だけを描くとき）の何もしない入口。参照は固定。 */
const NO_ENTRY: GridEntry = {
  onOpen: () => undefined,
  onMenu: () => undefined,
  onDropSymbol: () => undefined,
};

/**
 * 1セルぶんの描画。
 *
 * **`memo` で包む（指摘 LE-10）**。以前はカーソル位置を `cursorKey`（文字列）として全セルに
 * 配っていたので、矢印キーを1回押すだけで全ネットワーク・全セルが再描画され、
 * `profile.timerPreset()` と SVG のパス生成が毎回走っていた。受け取るのは「自分が選択されて
 * いるか」の真偽値だけにしてあるので、カーソルが動いても**選択が変わった2セル**しか描き直さない。
 * そのために props は真偽値・数値・安定した参照だけで組んである（`cell9` のような
 * 毎レンダー新しくなるオブジェクトを渡さない）。
 */
const GridCell = memo(function GridCell({
  cell,
  selected,
  networkId,
  row,
  col,
  colIndex,
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
  entry,
  dragPlace,
}: {
  cell: Cell;
  /** このセルにカーソルがあるか。 */
  selected: boolean;
  networkId: string;
  row: number;
  /** 中間表現の列番号（カーソルが指すのはこちら）。 */
  col: number;
  /** 画面上の列位置（省略列があるので中間表現の列番号とは一致しない）。 */
  colIndex: number;
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
  /** 入口C（ダブルクリック・右クリック・ドロップ）。参照は安定していること。 */
  entry: GridEntry;
  /** 記号ボタンを格子へドラッグして置けるスキンか（JW-300SP 風）。 */
  dragPlace: boolean;
}): JSX.Element {
  const cellKey = `${networkId}:${String(row)}:${String(col)}`;
  // 再描画回数を DOM に出す（LE-10 のテストが「選択が変わっていないセルは描き直さない」
  // ことを確かめるための、副作用の無い観測用カウンタ。`NetworkView` と同じ形）。
  const renderCount = useRef(0);
  renderCount.current += 1;
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
  const commentRows =
    shape?.layout === 'box' || shape?.layout === 'bracket' ? 0 : theme.commentLines;
  return (
    <g
      data-testid={`cell-${cellKey}`}
      role="gridcell"
      aria-selected={selected}
      data-error={error}
      aria-label={cell.kind === 'draft' ? JA.ladder.incompleteSymbol : undefined}
      data-incomplete={cell.kind === 'draft' || undefined}
      data-powered={leftOn}
      data-render-count={renderCount.current}
      className={styles.cell}
      transform={`translate(${String(colIndex * metrics.w)} ${String(row * metrics.h)})`}
      onClick={() => {
        onPick({ networkId, row, col });
      }}
      /*
       * 入口C（設計 §5.3）。単クリックはカーソル移動のままにして、ダブルクリックと
       * 右クリックで回路入力欄へ入る。右クリックは OS のメニューを止めて自前の記号
       * メニューを出す（`LadderEditor` が描く）。
       */
      onDoubleClick={() => {
        entry.onOpen({ networkId, row, col });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        entry.onMenu({ networkId, row, col }, event.clientX, event.clientY);
      }}
      onDragOver={
        dragPlace
          ? (event) => {
              // 既定では要素はドロップを受けないので、`preventDefault()` で受け口にする
              event.preventDefault();
            }
          : undefined
      }
      onDrop={
        dragPlace
          ? (event) => {
              event.preventDefault();
              entry.onDropSymbol({ networkId, row, col }, event.dataTransfer.getData('text/plain'));
            }
          : undefined
      }
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
      {/*
        指摘 UX-14 ≡ UI-17: 通電しているかが**色だけ**で示されていた（色覚に依らず読めない／
        通電色を淡い色に設定すると誰にも読めない）。どのスキンでも、通っている記号に
        **細い実線の枠**を重ねる。枠は色ではなく「ある／無い」で読めるので、色を変えても、
        白黒で印刷しても残る。色は通電色のトークン（`--skin-powered`）から引く。
      */}
      {energised ? (
        <rect
          data-testid="powered-outline"
          x={metrics.poweredBlock.x + 0.5}
          y={metrics.poweredBlock.y + 0.5}
          width={Math.max(0, metrics.poweredBlock.w - 1)}
          height={Math.max(0, metrics.poweredBlock.h - 1)}
          className={styles.poweredOutline}
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
              y={metrics.commentY + index * metrics.commentLineH}
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
});

/**
 * 1ネットワークぶんの描画。**`plcMonitor.powered[net.id]` をここで直接購読する**（決定表#5）。
 *
 * 以前は `LadderEditor` がスナップショット全体（`plcMonitor.powered`。全ネットワーク分の
 * `Record`）を購読して `LadderGrid` に丸ごと渡していたため、モニタ中は毎スキャン（約33ms毎）に
 * 新しいオブジェクトが届き、`memo(LadderGrid)` が効かずネットワークが何本あっても全部
 * 再描画されていた（Batch 2 レビュー D1）。ここでは文字列1本（`net.id` の分だけ）を購読するので、
 * 通電が変わったネットワークだけが再描画される。
 *
 * **`memo` で包む（指摘 LE-10）**。カーソルは「自分のネットワークにあるときだけ」受け取るので、
 * 矢印キーで動かしても描き直すのは**カーソルが出ていったネットワークと入ってきたネットワーク
 * の2本まで**になる（以前は `cursorKey` を全ネットワークに配っていたので全部描き直していた）。
 */
const NetworkView = memo(function NetworkView({
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
  rungIndex,
  cursor,
  onPickCell,
  entry,
  dragPlace,
  unconverted,
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
  /** この回路ブロックの通し番号（CX-Programmer風の「ラング番号」）。 */
  rungIndex: number;
  /** カーソル（**このネットワークにあるときだけ**渡る。無ければ `undefined`）。指摘 LE-10 */
  cursor: LadderCursor | undefined;
  onPickCell: (cursor: LadderCursor) => void;
  /** 入口C（ダブルクリック・右クリック・ドロップ）。設計 §5.3 */
  entry: GridEntry;
  dragPlace: boolean;
  /** まだ変換していない（`F4` が通っていない）。設計 §5.4 */
  unconverted: boolean;
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
  // `GridCell` は `memo` なので、渡す参照は毎レンダー作り直さない（指摘 LE-10）
  const colors = useMemo(
    () => ({ ...profile.monitorColors, powered: skinMonitorColor(profile, monitorColor) }),
    [profile, monitorColor],
  );
  // レンダー回数を DOM に出す（D1 のテストが「他ネットワークの通電が変わっても再描画されない」
  // ことを確かめるための、副作用の無い観測用カウンタ）。
  const renderCount = useRef(0);
  renderCount.current += 1;
  /*
   * 未変換であることを**灰色だけ**で示さない（指摘 UX-14 と同じ理由）。灰色の地の意味と
   * 直し方（どのキーで変換するか）を言葉でも出す。キーは方言から引く（前提#22）。
   */
  const convertKey = shortcutKeyOf(profile, 'convert');
  const unconvertedNote =
    unconverted && convertKey !== undefined ? JA.ladder.entry.unconverted(convertKey) : undefined;
  return (
    <section
      className={styles.network}
      data-testid={`network-${net.id}`}
      data-render-count={renderCount.current}
      /*
       * 未変換の回路ブロックは背景を灰にする（GX Works3 と同じ見せ方。設計 §5.4）。
       * `F4`（変換）が通ると外れる。色は `--skin-unconverted`（スキンが決める）。
       * 格子線は `.grid` の `background-image` なので、**地の色だけ**を差し替える。
       */
      data-unconverted={unconverted ? 'true' : undefined}
      style={unconverted ? { backgroundColor: 'var(--skin-unconverted)' } : undefined}
    >
      <header className={styles.networkHeader}>
        <span className={styles.networkId}>{JA.ladder.circuitNumber(rungIndex)}</span>
        {net.comment === undefined ? null : (
          <span className={styles.networkComment}>{net.comment}</span>
        )}
        {hasHiddenCells(net, gridCols) ? (
          <span className={styles.hiddenWarn} data-testid={`hidden-cells-${net.id}`}>
            {JA.ladder.hiddenCells}
          </span>
        ) : null}
        {/* 灰色の地が何を意味するかを言葉でも出す（色だけの符号化をやめる。指摘 UX-14） */}
        {unconvertedNote === undefined ? null : (
          <span className={styles.sideNote} data-testid={`unconverted-${net.id}`}>
            {unconvertedNote}
          </span>
        )}
      </header>
      <svg
        className={styles.grid}
        width={width}
        height={net.rows * metrics.h}
        viewBox={`0 0 ${String(width)} ${String(net.rows * metrics.h)}`}
        role="grid"
        aria-label={JA.ladder.circuitNumber(rungIndex)}
      >
        {/*
          左の行番号欄（4社とも回路の左に番号が並ぶ。§10.6 の画面構成）。番号は**回路ブロックの
          先頭行にだけ**出す（実機のソフトも1行ごとには振らない。利用者要求 2026-09-20 2回目）。
          実機のステップ番号は命令の数で進むが、本アプリの中間表現は命令の並びを持たないので
          **回路ブロックの通し行数**を出す。CX-Programmer風だけ「ラング番号」＝回路の通し番号
          （`SkinTheme.stepNumbering`。`SKIN_ASSUMED` の △）。
        */}
        <text
          data-testid={`step-${net.id}:${String(STEP_LABEL_ROW)}`}
          className={styles.stepText}
          x={metrics.stepGutter - 4}
          y={metrics.wireY + 3}
        >
          {theme.stepNumbering === 'rung' ? rungIndex : startStep}
        </text>
        {/* 左母線（全行を繋ぐ。§10.3） */}
        <rect
          x={metrics.stepGutter}
          width={RAIL_W}
          height={net.rows * metrics.h}
          className={styles.rail}
          data-testid={`rail-${net.id}`}
        />
        {/* 右母線（実機の画面と同じく導線と同じ細さ。桟はここにぴったり届く） */}
        <rect
          x={metrics.stepGutter + RAIL_W + columns.length * metrics.w}
          width={RIGHT_RAIL_W}
          height={net.rows * metrics.h}
          className={styles.rail}
          aria-hidden="true"
        />
        <g transform={`translate(${String(metrics.stepGutter + RAIL_W)} 0)`}>
          {Array.from({ length: net.rows }, (_unused, row) => {
            const first = cellAt(net, row, 0);
            const endRow = first.kind === 'end' ? first : undefined;
            return (
              // `role="grid"` の直下は `role="row"` を挟んでから `gridcell` にする（レビュー指摘 I4）
              <g role="row" key={`${net.id}:${String(row)}`}>
                {columns.map((col, index) => {
                  /*
                   * END の行はふつうの回路として描く（利用者要求 2026-09-20「END行の縦線2本は何？」）。
                   * IR では END は0列目だが、画面では**左母線から出力列まで桟を1本**引き、
                   * 出力列に `[END]`／`END` の箱を置く。編集できないのは今までどおり。
                   */
                  const endCell =
                    endRow === undefined ? undefined : col === COIL_COL ? endRow : END_ROW_WIRE;
                  const cell = endCell ?? cellAt(net, row, col);
                  const key = `${net.id}:${String(row)}:${String(col)}`;
                  const deviceComment =
                    'device' in cell ? comments[deviceLabel(cell.device)] : undefined;
                  return (
                    <GridCell
                      key={key}
                      selected={cursor?.row === row && cursor.col === col}
                      cell={cell}
                      networkId={net.id}
                      row={row}
                      col={col}
                      colIndex={index}
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
                      onPick={onPickCell}
                      entry={entry}
                      dragPlace={dragPlace}
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
            );
          })}
        </g>
        {/*
          出力の無い回路ブロックの**右端に赤い縦線**（CX-Programmer 風。設計 §5.2 の S4）。
          「変換」の段を持たないメーカーは、変換の指摘を待たずにその場で未完成を示す。
        */}
        {profile.convertStep || !networkNeedsOutput(net) ? null : (
          <rect
            data-testid={`no-output-${net.id}`}
            role="img"
            aria-label={JA.ladder.entry.noOutput}
            x={metrics.stepGutter + RAIL_W + columns.length * metrics.w}
            width={RIGHT_RAIL_W * 2}
            height={net.rows * metrics.h}
            className={styles.noOutputMark}
          />
        )}
      </svg>
    </section>
  );
});

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
  entry = NO_ENTRY,
  dragPlace = false,
  unconverted = false,
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
  /**
   * 入口C（ダブルクリック・右クリック・ドロップ）。設計 §5.3
   * 省略すると何も起きない（格子だけを描くテストのため）。
   */
  entry?: GridEntry;
  /** 記号ボタンを格子へドラッグして置けるスキンか（JW-300SP 風。設計 §5.2 の S8）。 */
  dragPlace?: boolean;
  /** まだ変換していない（「変換」を持つメーカーだけ灰色の背景にする。設計 §5.4）。 */
  unconverted?: boolean;
}): JSX.Element {
  // `NetworkView` は `memo` なので、寸法表と列の並びは毎レンダー作り直さない（指摘 LE-10）
  const metrics = useMemo(() => symbolMetrics(theme.cell), [theme.cell]);
  const columns = useMemo(() => displayColumns(gridCols), [gridCols]);
  const width = metrics.stepGutter + RAIL_W + columns.length * metrics.w + RIGHT_RAIL_SPAN;
  // 行番号は回路ブロックをまたいで通しで数える（実機のステップ番号の見え方に寄せる）
  let step = 0;
  return (
    // 表示中の接点列数を DOM に出す（指摘 LE-18 のテストが「欄が細くなったら列が減る」ことを
    // 見るための、副作用の無い観測用の値）
    <div className={styles.gridScroll} data-testid="ladder-grid" data-cols={gridCols}>
      {program.networks.map((net, rungIndex) => {
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
            rungIndex={rungIndex}
            cursor={cursor.networkId === net.id ? cursor : undefined}
            onPickCell={onPickCell}
            entry={entry}
            dragPlace={dragPlace}
            unconverted={unconverted}
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
