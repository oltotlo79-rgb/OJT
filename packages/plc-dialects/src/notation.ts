import type { Device, LadderProgram } from '@ojt/ladder-core';
import { collectDevices } from './device-rules.js';
import type { DialectError, DialectId, DialectProfile } from './profile.js';

/**
 * 表記切替。設計仕様 §10.7。
 *
 * IRはベンダー中立（§10.3 / 3A 決定表#5）なので、方言を切り替えてもプログラムは**変換しない**。
 * 変わるのは画面に出るデバイス名と設定値の書き方だけである。この関数は
 * 「切替後にどう書かれるか」の一覧と「切替先の方言で表せない項目」を返し、4B の切替ダイアログが
 * そのまま並べる。プログラム自体は呼び出し側が持ったままでよい。
 */

/** デバイス1つの表記の変化。 */
export interface NotationChange {
  device: Device;
  from: string;
  to: string;
}

/** 表記切替の下見の結果。 */
export interface NotationSwitchResult {
  /** 切替先の方言で表せるか（`errors` が空か）。 */
  ok: boolean;
  from: DialectId;
  to: DialectId;
  /** 表記が変わるデバイス（変わらないものは載せない）。グリッドの順。 */
  changes: readonly NotationChange[];
  /** 切替先の方言のバリデータの指摘（デバイス範囲・設定値）。 */
  errors: readonly DialectError[];
}

/**
 * 方言を切り替えたときの表記の変化と、切替先で表せない項目を調べる。§10.7
 * プログラムは書き換えない（引数も戻り値も IR を含まない）。
 */
export function switchNotation(
  source: LadderProgram,
  from: DialectProfile,
  to: DialectProfile,
): NotationSwitchResult {
  const changes: NotationChange[] = [];
  for (const use of collectDevices(source)) {
    const before = from.formatDevice(use.device);
    const after = to.formatDevice(use.device);
    if (before === after) continue;
    changes.push({ device: use.device, from: before, to: after });
  }
  const errors = to.validate(source);
  return { ok: errors.length === 0, from: from.id, to: to.id, changes, errors };
}
