import {
  cellAt,
  COIL_COL,
  deviceKey,
  deviceLabel,
  IR_COLS,
  isOutputCell,
  sameDevice,
  type Cell,
  type Device,
  type LadderProgram,
  type Network,
  type OutputCell,
} from './ir.js';

/**
 * ラダーIRの構造検査と実行形式への変換。設計仕様 §10.3 / §10.4 / §10.6（「変換」の方言非依存部分）。
 *
 * デバイス番号の範囲・8進表記・タイマ単位といった**方言に依る検査はここでは行わない**
 * （`@ojt/plc-dialects` の `DialectProfile.validate()` の責務。§10.5）。
 */

/** タイマ設定値の刻み[ms]（＝スキャン周期）。§10.4 */
export const TIMER_STEP_MS = 10;
/** タイマ設定値の上限[ms]（1時間）。 */
export const MAX_TIMER_PRESET_MS = 3_600_000;
/** カウンタ設定値の上限。 */
export const MAX_COUNTER_PRESET = 32_767;

/** 変換エラーの種別。 */
export type CompileErrorCode =
  | 'incomplete-symbol'
  | 'empty-program'
  | 'grid-shape'
  | 'missing-end'
  | 'after-end'
  | 'coil-column'
  | 'contact-in-coil-column'
  | 'no-output'
  | 'dangling-vline'
  | 'timer-preset'
  | 'counter-preset'
  | 'mc-unmatched'
  | 'coil-on-read-only-device';

/** 変換エラー1件。UIは「出力ウィンドウ」に並べる（§10.6）。 */
export interface CompileError {
  code: CompileErrorCode;
  /** 該当ネットワークID（プログラム全体の誤りでは空文字）。 */
  networkId: string;
  row?: number;
  col?: number;
  message: string;
}

/** 変換警告1件（実行はできるが実機なら注意が要る）。§10.4 */
export interface CompileWarning {
  code: 'double-coil';
  networkId: string;
  row: number;
  col: number;
  device: Device;
  message: string;
}

/** 実行時に使う出力セルの索引。 */
export interface CompiledOutput {
  row: number;
  col: number;
  cell: OutputCell;
}

/** 実行形式のネットワーク。 */
export interface CompiledNetwork {
  id: string;
  rows: number;
  cols: number;
  cells: readonly (readonly Cell[])[];
  outputs: readonly CompiledOutput[];
  /** END だけのネットワークか。 */
  isEnd: boolean;
}

/** プログラムが読む／書くデバイス。§10.8 の未使用デバイス検出に使う。 */
export interface DeviceUsage {
  reads: readonly Device[];
  writes: readonly Device[];
}

/** 実行形式のプログラム。 */
export interface CompiledProgram {
  networks: readonly CompiledNetwork[];
  /** END を持つネットワークの位置（ここより後ろは実行しない）。 */
  endNetworkIndex: number;
  usage: DeviceUsage;
  /** 使っている入力点数（最大番号＋1）。 */
  inputCount: number;
  /** 使っている出力点数（最大番号＋1）。 */
  outputCount: number;
  source: LadderProgram;
}

/** 変換結果。 */
export type CompileResult =
  | { ok: true; program: CompiledProgram; warnings: CompileWarning[] }
  | { ok: false; errors: CompileError[]; warnings: CompileWarning[] };

/** 重複を落としつつ順序を保ってデバイスを集める器。 */
class DeviceSet {
  private readonly seen = new Set<string>();
  private readonly list: Device[] = [];

  add(d: Device): void {
    const key = deviceKey(d);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(d);
  }

  values(): Device[] {
    return [...this.list];
  }

  maxIndexOf(kind: Device['kind']): number {
    let max = -1;
    for (const d of this.list) if (d.kind === kind) max = Math.max(max, d.index);
    return max;
  }
}

/** グリッドの形（`rows` / `cols` と `cells` の食い違い）を検査する。 */
function checkShape(net: Network, errors: CompileError[]): boolean {
  if (net.cols !== IR_COLS) {
    errors.push({
      code: 'grid-shape',
      networkId: net.id,
      message: `列数は ${IR_COLS} 固定です: ${net.cols}`,
    });
    return false;
  }
  if (net.cells.length !== net.rows) {
    errors.push({
      code: 'grid-shape',
      networkId: net.id,
      message: `行数（${net.rows}）とセルの行数（${net.cells.length}）が違います`,
    });
    return false;
  }
  for (let row = 0; row < net.rows; row += 1) {
    if ((net.cells[row]?.length ?? -1) !== net.cols) {
      errors.push({
        code: 'grid-shape',
        networkId: net.id,
        row,
        message: `${row} 行目の列数が ${net.cols} ではありません`,
      });
      return false;
    }
  }
  return true;
}

/** セルが読むデバイスを usage に足す。 */
function collectReads(cell: Cell, reads: DeviceSet): void {
  if (cell.kind === 'contact') reads.add(cell.device);
  else if (cell.kind === 'counter') reads.add(cell.resetDevice);
  else if (cell.kind === 'mc' || cell.kind === 'mcr') reads.add(cell.device);
}

/** 出力セルの設定値を検査する。 */
function checkOutputCell(
  net: Network,
  row: number,
  cell: OutputCell,
  errors: CompileError[],
): void {
  if (cell.kind === 'timer') {
    const bad =
      !Number.isInteger(cell.presetMs) ||
      cell.presetMs < TIMER_STEP_MS ||
      cell.presetMs % TIMER_STEP_MS !== 0 ||
      cell.presetMs > MAX_TIMER_PRESET_MS;
    if (bad) {
      errors.push({
        code: 'timer-preset',
        networkId: net.id,
        row,
        col: COIL_COL,
        message: `${deviceLabel(cell.device)} の設定値は 10ms の倍数（${TIMER_STEP_MS}〜${MAX_TIMER_PRESET_MS}ms）にします: ${cell.presetMs}ms`,
      });
    }
  } else if (cell.kind === 'counter') {
    const bad =
      !Number.isInteger(cell.preset) || cell.preset < 1 || cell.preset > MAX_COUNTER_PRESET;
    if (bad) {
      errors.push({
        code: 'counter-preset',
        networkId: net.id,
        row,
        col: COIL_COL,
        message: `${deviceLabel(cell.device)} の設定値は 1〜${MAX_COUNTER_PRESET} の整数にします: ${cell.preset}`,
      });
    }
  }
}

/**
 * 書き込み先デバイスが読み取り専用（入力・特殊）か、あるいは OUT の書き込み先が
 * タイマ／カウンタ（TON/CTU 命令だけが書ける）かを検査する。実機（GX Works3 等）は
 * `OUT X0` や `OUT T0` を変換時に拒否する。
 */
function checkCoilTarget(
  net: Network,
  row: number,
  col: number,
  cell: Extract<Cell, { kind: 'coil' }>,
  errors: CompileError[],
): boolean {
  const kind = cell.device.kind;
  if (kind === 'input' || kind === 'special') {
    errors.push({
      code: 'coil-on-read-only-device',
      networkId: net.id,
      row,
      col,
      message: `${deviceLabel(cell.device)} は読み取り専用のデバイスなのでコイルを書き込めません（${cell.type} ${deviceLabel(cell.device)}）`,
    });
    return false;
  }
  if (cell.type === 'OUT' && (kind === 'timer' || kind === 'counter')) {
    errors.push({
      code: 'coil-on-read-only-device',
      networkId: net.id,
      row,
      col,
      message: `${deviceLabel(cell.device)} は TON／CTU 命令でのみ書き込めます（OUT ${deviceLabel(cell.device)} は使えません）`,
    });
    return false;
  }
  return true;
}

/** 二重コイル（同じデバイスへの OUT／タイマ／カウンタ）を警告する。§10.4 */
function checkDoubleCoil(
  net: Network,
  row: number,
  cell: OutputCell,
  written: Set<string>,
  warnings: CompileWarning[],
): void {
  if (cell.kind === 'mc' || cell.kind === 'mcr') return;
  if (cell.kind === 'coil' && cell.type !== 'OUT') return; // SET/RST は対で使うので対象外
  const key = deviceKey(cell.device);
  if (written.has(key)) {
    warnings.push({
      code: 'double-coil',
      networkId: net.id,
      row,
      col: COIL_COL,
      device: cell.device,
      message: `${deviceLabel(cell.device)} のコイルが2回以上あります（実行は後のものが優先されます）`,
    });
    return;
  }
  written.add(key);
}

/**
 * ラダーIRを実行形式に変換する。§10.3 / §10.4
 * エラーが1件でもあれば `ok: false` を返す。警告（二重コイル）は成功・失敗のどちらでも返す。
 */
export function compile(source: LadderProgram): CompileResult {
  const errors: CompileError[] = [];
  const warnings: CompileWarning[] = [];
  const reads = new DeviceSet();
  const writes = new DeviceSet();
  const written = new Set<string>();
  const mcStack: Device[] = [];
  const networks: CompiledNetwork[] = [];
  let endNetworkIndex = -1;

  if (source.networks.length === 0) {
    return {
      ok: false,
      errors: [{ code: 'empty-program', networkId: '', message: 'ネットワークがありません' }],
      warnings,
    };
  }

  source.networks.forEach((net, netIndex) => {
    if (!checkShape(net, errors)) {
      networks.push({
        id: net.id,
        rows: net.rows,
        cols: net.cols,
        cells: net.cells,
        outputs: [],
        isEnd: false,
      });
      return;
    }
    const outputs: CompiledOutput[] = [];
    const hasEnd = net.cells.some((line) => line.some((cell) => cell.kind === 'end'));
    if (hasEnd && endNetworkIndex < 0) endNetworkIndex = netIndex;
    let hasContent = false;

    for (let row = 0; row < net.rows; row += 1) {
      for (let col = 0; col < net.cols; col += 1) {
        const cell = cellAt(net, row, col);
        if (cell.kind === 'empty') continue;
        if (cell.kind === 'draft') {
          errors.push({
            code: 'incomplete-symbol',
            networkId: net.id,
            row,
            col,
            message: 'アドレスが未入力です。記号を選んで Enter で入力してください。',
          });
          continue;
        }
        hasContent = true;
        if (cell.kind === 'end') {
          continue;
        }
        /*
         * ランタイムは END を含むネットワーク全体を実行しない。
         * セルの走査順に関係なく、同居する回路と後続ネットワークを拒む（LC-1 / B+C I3）。
         */
        if (endNetworkIndex >= 0) {
          errors.push({
            code: 'after-end',
            networkId: net.id,
            row,
            col,
            message: 'END と同じ回路ブロックや、その後ろにはプログラムを書けません',
          });
          continue;
        }
        if (isOutputCell(cell)) {
          if (col !== COIL_COL) {
            errors.push({
              code: 'coil-column',
              networkId: net.id,
              row,
              col,
              message: `コイル・タイマ・カウンタ・MC/MCR は最終列（${COIL_COL}）に置きます`,
            });
            continue;
          }
          if (cell.kind === 'coil' && !checkCoilTarget(net, row, col, cell, errors)) {
            continue;
          }
          outputs.push({ row, col, cell });
          collectReads(cell, reads);
          checkOutputCell(net, row, cell, errors);
          checkDoubleCoil(net, row, cell, written, warnings);
          if (cell.kind === 'mc') mcStack.push(cell.device);
          else if (cell.kind === 'mcr') {
            const opened = mcStack.pop();
            if (opened === undefined) {
              errors.push({
                code: 'mc-unmatched',
                networkId: net.id,
                row,
                col,
                message: `対応する MC がありません: ${deviceLabel(cell.device)}`,
              });
            } else if (!sameDevice(opened, cell.device)) {
              errors.push({
                code: 'mc-unmatched',
                networkId: net.id,
                row,
                col,
                message: `MC ${deviceLabel(opened)} に対応する MCR が ${deviceLabel(cell.device)} になっています`,
              });
            }
          } else writes.add(cell.device);
          continue;
        }
        if (col === COIL_COL) {
          errors.push({
            code: 'contact-in-coil-column',
            networkId: net.id,
            row,
            col,
            message: `最終列（${COIL_COL}）にはコイルだけを置きます`,
          });
          continue;
        }
        if (cell.kind === 'vline' && row + 1 >= net.rows) {
          errors.push({
            code: 'dangling-vline',
            networkId: net.id,
            row,
            col,
            message: '最終行の縦線は繋ぐ相手がありません',
          });
          continue;
        }
        collectReads(cell, reads);
      }
    }

    if (!hasEnd && hasContent && outputs.length === 0) {
      errors.push({
        code: 'no-output',
        networkId: net.id,
        message: 'コイル・タイマ・カウンタのいずれも置かれていません',
      });
    }
    networks.push({
      id: net.id,
      rows: net.rows,
      cols: net.cols,
      cells: net.cells,
      outputs,
      isEnd: hasEnd,
    });
  });

  if (endNetworkIndex < 0) {
    errors.push({ code: 'missing-end', networkId: '', message: 'END がありません（§10.3）' });
  }
  for (const device of mcStack) {
    errors.push({
      code: 'mc-unmatched',
      networkId: '',
      message: `対応する MCR がありません: ${deviceLabel(device)}`,
    });
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    warnings,
    program: {
      networks,
      endNetworkIndex,
      usage: { reads: reads.values(), writes: writes.values() },
      inputCount: reads.maxIndexOf('input') + 1,
      outputCount: writes.maxIndexOf('output') + 1,
      source,
    },
  };
}
