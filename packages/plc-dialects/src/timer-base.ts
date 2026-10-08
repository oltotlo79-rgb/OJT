import { ton, type LadderProgram, type TimerBase } from '@ojt/ladder-core';
import { unitLabelOf } from './device-rules.js';
import { roundTimerPreset } from './mitsubishi.js';
import type { DialectProfile } from './profile.js';

/**
 * タイマの時間単位を命令で選ぶ（v2.0.0 設計 §3.6）。
 * 画面の「時間単位」の選択肢と、表記切替で切替先に無い単位を既定へ寄せる処理。
 */

/** 「時間単位」の選択肢1つ（命令名と単位名）。 */
export interface TimerBaseChoice {
  base: TimerBase;
  /** その単位のタイマ命令名（`OUT T` / `TIMH` など）。 */
  name: string;
  /** 単位名（`0.1秒` など）。 */
  label: string;
}

/** その機種で選べる時間単位の一覧（先頭が既定）。 */
export function timerBaseChoices(profile: DialectProfile): TimerBaseChoice[] {
  return profile.timerBases.map((base) => ({
    base,
    name: profile.timerInstructionName(base),
    label: unitLabelOf(base),
  }));
}

/** その機種の既定の時間単位。 */
export function defaultTimerBase(profile: DialectProfile): TimerBase {
  return profile.timerBases[0] ?? 100;
}

/** 切替で寄せたタイマ1つ。 */
export interface CoercedTimer {
  networkId: string;
  row: number;
  col: number;
  /** 寄せる前の時間単位[ms]。 */
  fromBase: TimerBase;
  /** 寄せたあとの時間単位[ms]（切替先の既定）。 */
  toBase: TimerBase;
  /** 寄せる前の設定値[ms]。 */
  fromMs: number;
  /** 寄せたあとの設定値[ms]（既定の単位の刻みへ丸めた値）。 */
  toMs: number;
}

/**
 * 切替先の機種に無い時間単位のタイマを、切替先の既定の単位へ寄せる（設定値はその刻みへ丸める）。
 * v2.0.0 設計 §3.6「切替先に無い単位は『表せない項目』に出し、切替後は 100ms に丸めた上で警告する」。
 * プログラムは書き換えず、新しいプログラムと寄せた一覧を返す。寄せるものが無ければ `changed` は空。
 */
export function coerceTimerBases(
  source: LadderProgram,
  to: DialectProfile,
): { program: LadderProgram; changed: CoercedTimer[] } {
  const changed: CoercedTimer[] = [];
  const fallback = defaultTimerBase(to);
  const networks = source.networks.map((net) => ({
    ...net,
    cells: net.cells.map((cells, row) =>
      cells.map((cell, col) => {
        if (cell.kind !== 'timer' || cell.base === undefined || to.timerBases.includes(cell.base))
          return cell;
        const toMs = roundTimerPreset(cell.presetMs, fallback);
        changed.push({
          networkId: net.id,
          row,
          col,
          fromBase: cell.base,
          toBase: fallback,
          fromMs: cell.presetMs,
          toMs,
        });
        return ton(cell.device, toMs, fallback);
      }),
    ),
  }));
  return { program: changed.length === 0 ? source : { ...source, networks }, changed };
}
