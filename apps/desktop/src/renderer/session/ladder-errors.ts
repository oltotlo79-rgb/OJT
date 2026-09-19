import { deviceKey, type CompiledProgram, type Device, type LadderProgram } from '@ojt/ladder-core';
import { convert, type DialectProfile } from '@ojt/plc-dialects';
import type { ConvertIssues, ConvertErrorLine } from '../app/store-types.js';

/**
 * 「変換」（F4）と出力ウィンドウの材料。設計仕様 §10.6 / §10.8。決定表#4
 *
 * `@ojt/plc-dialects` の `convert()` を呼び、結果をストアの値型（`ConvertIssues`）に畳む。
 * 位置（ネットワーク・行・列）は**ライブラリが持っているものをそのまま**使い、UI 側で推定しない。
 */

/** 変換の結果（成功なら実行形式も返す）。 */
export interface ConvertRun {
  ok: boolean;
  issues: ConvertIssues;
  program: CompiledProgram | undefined;
}

/** 変換を走らせる。 */
export function runConvert(source: LadderProgram, profile: DialectProfile): ConvertRun {
  const result = convert(source, profile);
  const errors: ConvertErrorLine[] = result.errors.map((error) => ({
    source: error.source,
    code: error.code,
    message: error.message,
    ...(error.networkId === undefined ? {} : { networkId: error.networkId }),
    ...(error.row === undefined ? {} : { row: error.row }),
    ...(error.col === undefined ? {} : { col: error.col }),
  }));
  const warnings = result.warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    networkId: warning.networkId,
    row: warning.row,
    col: warning.col,
  }));
  if (!result.ok) {
    return {
      ok: false,
      issues: { errors, warnings, usage: undefined, unused: undefined },
      program: undefined,
    };
  }
  return {
    ok: true,
    issues: {
      errors,
      warnings,
      usage: {
        // 出力ウィンドウは方言表記で出す（IRの通し番号ではない）。§10.5
        reads: result.program.usage.reads.map((device) => profile.formatDevice(device)),
        writes: result.program.usage.writes.map((device) => profile.formatDevice(device)),
      },
      // `Device[]`（`kind` を持ったまま）のうちに未使用判定を済ませる。レビュー指摘 B2
      unused: unusedDevices(result.program.usage, profile),
    },
    program: result.program,
  };
}

/** 変換エラーのうち、セルを指しているものの鍵（`"net:row:col"`）。 */
export function errorCellKeys(errors: readonly ConvertErrorLine[]): Set<string> {
  const keys = new Set<string>();
  for (const error of errors) {
    if (error.networkId === undefined || error.row === undefined || error.col === undefined) {
      continue;
    }
    keys.add(`${error.networkId}:${String(error.row)}:${String(error.col)}`);
  }
  return keys;
}

/**
 * 使われていないデバイス。§10.8
 * **表示のみ**で合否には効かせない（決定表#15b）。
 *
 * **入力（X）と特殊リレー（SP）は `neverWritten` に入れない**（レビュー指摘 I10）。この2種は
 * 設計上ラダーから書けない（外部入力とシステムが値を入れる。`compile()` も X・SP への
 * OUT/SET/RST を `coil-on-read-only-device` で拒む）。読んだだけで「書かれていません」と
 * 並べると、**正しいラダーほど警告が増える**。判定に効かない一覧だからこそ、嘘を並べない。
 *
 * **`Device.kind` で見る**（レビュー指摘 B2）。以前は方言表記の文字列（`X0` / `SP0`）の
 * 先頭を見ていたが、三菱の特殊デバイスは `formatDevice()` で `M8000` 等のリレー表記になり、
 * 先頭が `SP`/`X` のどちらでもなくなってしまう（正しい `SP(SPECIAL_CLOCK_1S)` の読み出しが
 * 未使用扱いになる）。`kind` はフォーマットより前の IR 段階の値なので方言に左右されない。
 */
export function unusedDevices(
  usage: { reads: readonly Device[]; writes: readonly Device[] },
  profile: DialectProfile,
): { neverRead: string[]; neverWritten: string[] } {
  const readKeys = new Set(usage.reads.map(deviceKey));
  const writeKeys = new Set(usage.writes.map(deviceKey));
  const neverRead = usage.writes.filter((device) => !readKeys.has(deviceKey(device)));
  const neverWritten = usage.reads.filter(
    (device) =>
      !writeKeys.has(deviceKey(device)) && device.kind !== 'input' && device.kind !== 'special',
  );
  return {
    // 表示は方言表記（`formatDevice()`）でする。判定は上の `kind` フィルタで済んでいる
    neverRead: neverRead.map((device) => profile.formatDevice(device)),
    neverWritten: neverWritten.map((device) => profile.formatDevice(device)),
  };
}
