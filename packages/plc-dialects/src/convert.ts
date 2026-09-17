import {
  compile,
  type CompiledProgram,
  type CompileWarning,
  type LadderProgram,
} from '@ojt/ladder-core';
import type { DialectProfile } from './profile.js';

/**
 * 「変換」操作。決定事項#15 / §10.6。
 * 構造の検査（`@ojt/ladder-core` の `compile()`）と方言の検査（`DialectProfile.validate()`）を
 * 両方走らせ、結果を1つの一覧にして返す。UIは出力ウィンドウにそのまま並べる。
 */

/** 変換の指摘1件。 */
export interface ConvertError {
  /** 構造（IRの誤り）か方言（機種の制約）か。 */
  source: 'structure' | 'dialect';
  code: string;
  message: string;
  networkId?: string;
  row?: number;
  col?: number;
}

/** 変換結果。 */
export type ConvertResult =
  | {
      ok: true;
      program: CompiledProgram;
      errors: readonly ConvertError[];
      warnings: CompileWarning[];
    }
  | { ok: false; errors: ConvertError[]; warnings: CompileWarning[] };

/**
 * ラダーを変換する。§10.6
 * 構造の検査に落ちても方言の検査は走らせる（出力ウィンドウに一度で全部出すため）。
 */
export function convert(source: LadderProgram, profile: DialectProfile): ConvertResult {
  const compiled = compile(source);
  const errors: ConvertError[] = compiled.ok
    ? []
    : compiled.errors.map((e) => ({
        source: 'structure' as const,
        code: e.code,
        message: e.message,
        ...(e.networkId === '' ? {} : { networkId: e.networkId }),
        ...(e.row === undefined ? {} : { row: e.row }),
        ...(e.col === undefined ? {} : { col: e.col }),
      }));
  for (const issue of profile.validate(source)) {
    errors.push({
      source: 'dialect',
      code: issue.code,
      message: issue.message,
      ...(issue.networkId === undefined ? {} : { networkId: issue.networkId }),
      ...(issue.row === undefined ? {} : { row: issue.row }),
      ...(issue.col === undefined ? {} : { col: issue.col }),
    });
  }
  if (!compiled.ok || errors.length > 0) {
    return { ok: false, errors, warnings: compiled.warnings };
  }
  return { ok: true, program: compiled.program, errors, warnings: compiled.warnings };
}
