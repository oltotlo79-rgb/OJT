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

/** デバイス1つ・設定値1つの表記の変化。 */
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
  /**
   * 表記が変わるタイマ・カウンタの設定値（`K30` → `#0030` のような綴りの変化。変わらないもの
   * 載せない）。グリッドの順。§10.7 / レビュー M2
   */
  presetChanges: readonly NotationChange[];
  /** 切替先の方言のバリデータの指摘（デバイス範囲・設定値）。切替元で既に出ていた指摘は除く（M1）。 */
  errors: readonly DialectError[];
}

/** 指摘の同一性を見るキー（コード＋デバイス）。切替元・切替先で共通の指摘を見分けるのに使う。 */
function issueKey(issue: DialectError): string {
  const device = issue.device === undefined ? '' : `${issue.device.kind}:${issue.device.index}`;
  return `${issue.code}:${device}`;
}

/**
 * タイマ・カウンタの設定値の綴りが切替でどう変わるかを調べる。§10.7 / レビュー M2
 * プログラムのグリッドの順（ネットワーク → 行 → 列）で、重複なく集める。
 */
function presetChanges(
  source: LadderProgram,
  from: DialectProfile,
  to: DialectProfile,
): NotationChange[] {
  const changes: NotationChange[] = [];
  const seen = new Set<string>();
  for (const net of source.networks) {
    for (const row of net.cells) {
      for (const cell of row) {
        if (cell.kind !== 'timer' && cell.kind !== 'counter') continue;
        const key = `${cell.device.kind}:${cell.device.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const before =
          cell.kind === 'timer'
            ? formatTimerPreset(from, cell.presetMs, cell.device)
            : formatCounterPreset(from, cell.preset);
        const after =
          cell.kind === 'timer'
            ? formatTimerPreset(to, cell.presetMs, cell.device)
            : formatCounterPreset(to, cell.preset);
        if (before === after) continue;
        changes.push({ device: cell.device, from: before, to: after });
      }
    }
  }
  return changes;
}

/** タイマ設定値を方言表記にする。表せない値は `?`。 */
function formatTimerPreset(profile: DialectProfile, ms: number, device: Device): string {
  const preset = profile.timerPreset(ms, device);
  return preset instanceof Error ? '?' : preset.text;
}

/** カウンタ設定値を方言表記にする（`counterPresetText` を持たない方言は10進の数値のまま）。 */
function formatCounterPreset(profile: DialectProfile, preset: number): string {
  return profile.counterPresetText?.(preset) ?? String(preset);
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
  // 切替元の方言で既に出ていた指摘（例: 切替前から範囲外だったデバイス）は
  // 「切替先の制約」ではないので除く（M1）
  const alreadyReported = new Set(from.validate(source).map(issueKey));
  const errors = to.validate(source).filter((issue) => !alreadyReported.has(issueKey(issue)));
  return {
    ok: errors.length === 0,
    from: from.id,
    to: to.id,
    changes,
    presetChanges: presetChanges(source, from, to),
    errors,
  };
}
