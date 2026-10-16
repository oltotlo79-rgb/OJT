import type { Cell, Network } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { PlcMonitorSnapshot } from '../../shared/plc-monitor.js';
import { counterPresetText } from '../session/ladder-cell.js';

/**
 * モニタ中のタイマ・カウンタの現在値（v2.1.0 監査 P5）。
 *
 * 実機のソフト（GX Works3・CX-Programmer・JW-300SP）はモニタ中、タイマ・カウンタの命令の
 * 近くに現在値を出す。本アプリは格子のマスが狭く（46〜52px）、命令の箱やデバイスコメントと
 * 重なるので、**回路ブロックの見出しの右**に「T0 現在値 12（設定 K30）」の形で並べる。
 * 数え方（加算式・減算式）と書き方はメーカーの方言（`profile.presentValue`）が決める。
 */
export interface PresentValue {
  /** 回路ブロックの中の位置（`行:列`）。 */
  key: string;
  /** 方言表記のデバイス名（`T0` / `T0000` / `TMR0000`）。 */
  device: string;
  /** 現在値（三菱 `12`／オムロン `0018`）。 */
  value: string;
  /** 設定値（`K30` / `#0030`）。 */
  preset: string;
}

/** 回路ブロックにタイマ・カウンタがあるか（無ければ購読もしない）。 */
export function hasTimerOrCounter(net: Network): boolean {
  return net.cells.some((row) => row.some((cell) => isTimerOrCounter(cell)));
}

function isTimerOrCounter(cell: Cell): boolean {
  return cell.kind === 'timer' || cell.kind === 'counter';
}

/**
 * 回路ブロックのタイマ・カウンタの現在値を、置いてある順（行・列）に並べる。
 * タイマは「経過時間 ÷ 時間単位」を設定値で頭打ちにした数、カウンタは数えた回数を設定値で
 * 頭打ちにした数。減算式のメーカーは「設定値 − その数」を出す（設定値から0へ数える）。
 * まだ一度も動いていない（スナップショットに載っていない）ものは 0 から数え始めた扱い。
 */
export function presentValuesOf(
  net: Network,
  monitor: PlcMonitorSnapshot,
  profile: DialectProfile,
): PresentValue[] {
  const rule = profile.presentValue;
  const values: PresentValue[] = [];
  net.cells.forEach((cells, row) => {
    cells.forEach((cell, col) => {
      const key = `${String(row)}:${String(col)}`;
      if (cell.kind === 'timer') {
        const baseMs = profile.timerBaseMs(cell.device, cell.base);
        const presetCount = Math.round(cell.presetMs / baseMs);
        const elapsedMs = monitor.timers[cell.device.index]?.elapsedMs ?? 0;
        const counted = Math.min(Math.floor(elapsedMs / baseMs), presetCount);
        const preset = profile.timerPreset(cell.presetMs, cell.device, cell.base);
        values.push({
          key,
          device: profile.formatDevice(cell.device),
          value: rule.format(rule.countsDown ? presetCount - counted : counted),
          preset: preset instanceof Error ? `${String(cell.presetMs)}ms` : preset.text,
        });
      } else if (cell.kind === 'counter') {
        const counted = Math.min(monitor.counters[cell.device.index]?.value ?? 0, cell.preset);
        values.push({
          key,
          device: profile.formatDevice(cell.device),
          value: rule.format(rule.countsDown ? cell.preset - counted : counted),
          preset: counterPresetText(cell.preset, profile),
        });
      }
    });
  });
  return values;
}

/**
 * 購読用の1本の文字列（値が変わったときだけ回路ブロックを描き直すため。`NetworkView` は
 * `memo` で、スナップショットは毎スキャン新しいオブジェクトになる）。
 */
export function presentValuesKey(values: readonly PresentValue[]): string {
  return values
    .map((item) => [item.key, item.device, item.value, item.preset].join('\t'))
    .join('\n');
}

/** {@link presentValuesKey} の逆。 */
export function parsePresentValuesKey(key: string): PresentValue[] {
  if (key === '') return [];
  return key.split('\n').map((line) => {
    const [cell = '', device = '', value = '', preset = ''] = line.split('\t');
    return { key: cell, device, value, preset };
  });
}
