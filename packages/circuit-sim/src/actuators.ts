import type { Part } from './parts.js';

/** 電源の開閉器。ブレーカと電源スイッチはAC一次側にあり電気的には解かない。§5.3.5 */
export type PowerDevice = 'breaker' | 'switch';

/** ブレーカ／電源スイッチの状態。§5.3.5 */
export interface PowerSwitches {
  breakerOn: boolean;
  switchOn: boolean;
}

/** 操作の結果。 */
export interface PowerActionResult {
  switches: PowerSwitches;
  /** ON=ブレーカ→スイッチ、OFF=スイッチ→ブレーカ の手順に反したか。§5.3.5 */
  violation: boolean;
}

/**
 * 電源操作を適用する。手順違反でも操作そのものは受理する（練習は中断しない。決定事項#12）。
 * 違反となるのは次の3つ。
 * - スイッチONのときにブレーカON（ブレーカが先でなければならない）
 * - ブレーカOFFのときにスイッチON（ブレーカが先）
 * - スイッチONのままブレーカOFF（スイッチが先）
 */
export function applyPowerAction(
  switches: PowerSwitches,
  device: PowerDevice,
  on: boolean,
): PowerActionResult {
  const current = device === 'breaker' ? switches.breakerOn : switches.switchOn;
  if (current === on) return { switches: { ...switches }, violation: false };
  const next: PowerSwitches = { ...switches };
  let violation = false;
  if (device === 'breaker') {
    if (on && switches.switchOn) violation = true;
    if (!on && switches.switchOn) violation = true;
    next.breakerOn = on;
  } else {
    if (on && !switches.breakerOn) violation = true;
    next.switchOn = on;
  }
  return { switches: next, violation };
}

/** 通電しているか（ブレーカとスイッチが両方ON）。 */
export function isPowerOn(switches: PowerSwitches): boolean {
  return switches.breakerOn && switches.switchOn;
}

/**
 * 押ボタンの押下状態を部品の接点に反映する。
 * a接点は押下で閉、b接点は押下で開（自動復帰型）。§5.3.3
 */
export function setButtonPressed(part: Part, pressed: boolean): void {
  for (const el of part.elements) {
    if (el.kind === 'contact' && el.driver === 'manual') el.energized = pressed;
  }
}

/** 保護動作からの復帰手順（スイッチOFF → ブレーカOFF → ブレーカON → スイッチON）。§5.1.1 */
export const RESET_SEQUENCE: ReadonlyArray<{ device: PowerDevice; on: boolean }> = [
  { device: 'switch', on: false },
  { device: 'breaker', on: false },
  { device: 'breaker', on: true },
  { device: 'switch', on: true },
];
