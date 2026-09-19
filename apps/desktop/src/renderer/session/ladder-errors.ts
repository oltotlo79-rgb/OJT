import { deviceLabel, type CompiledProgram, type LadderProgram } from '@ojt/ladder-core';
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
    return { ok: false, issues: { errors, warnings, usage: undefined }, program: undefined };
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
 */
const READ_ONLY_PREFIXES = ['SP', 'X'] as const;

function isReadOnlyDevice(device: string): boolean {
  // 方言表記（`X0` / `SP0`）の先頭で見る。`SP` を先に見ないと `S` 始まりの別デバイスと混ざらない
  return READ_ONLY_PREFIXES.some(
    (prefix) => device.startsWith(prefix) && /^[0-9A-F]+$/iu.test(device.slice(prefix.length)),
  );
}

export function unusedDevices(usage: { reads: readonly string[]; writes: readonly string[] }): {
  neverRead: string[];
  neverWritten: string[];
} {
  const reads = new Set(usage.reads);
  const writes = new Set(usage.writes);
  return {
    neverRead: usage.writes.filter((device) => !reads.has(device)),
    neverWritten: usage.reads.filter((device) => !writes.has(device) && !isReadOnlyDevice(device)),
  };
}

/** IR の `deviceLabel()` をそのまま使いたいとき（デバイスコメントの鍵）。§10.7 */
export { deviceLabel };
