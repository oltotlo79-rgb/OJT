import {
  BUZZER_OHMS,
  CLOSED_CONTACT_OHMS,
  COIL_OHMS,
  DROPOUT_VOLTS,
  LAMP_DIM_VOLTS,
  LAMP_LIT_VOLTS,
  LAMP_OHMS,
  PICKUP_VOLTS,
  PROTECTION_AMPS,
  SOURCE_INTERNAL_OHMS,
  SOURCE_VOLTS,
  type ContactElement,
  type Element,
  type LinkElement,
  type LoadElement,
  type SourceElement,
} from './elements.js';
import { partId, terminalId, type PartId, type TerminalId } from './ids.js';

/** タイマの復帰時間[ms]。この長さ未満の通電断では経過時間を保持する。§5.3.2 */
export const TIMER_RESET_GAP_MS = 100;
/** タイマレンジ上限の既定[ms]（0〜10s）。§5.3.2 */
export const TIMER_RANGE_10S_MS = 10_000;
/** タイマレンジ上限（0〜60s）。§5.3.2 */
export const TIMER_RANGE_60S_MS = 60_000;
/** タイマ設定値の下限[ms]。§5.3.2 */
export const TIMER_MIN_PRESET_MS = 100;

/** PLの色。§5.3.4 */
export type LampColor = '白' | '黄' | '緑' | '赤';

/** 部品種別。 */
export type PartKind =
  | 'relay-my4n'
  | 'timer-h3y4'
  | 'pushbutton'
  | 'lamp'
  | 'buzzer'
  | 'power-supply'
  | 'terminal-block'
  | 'plc';

/** PLCの入力1点（端子とその抵抗負荷要素）。§4.4 */
export interface PlcInputChannel {
  /** 機種の端子表記（`X0` / `0.00` など）。 */
  name: string;
  terminal: TerminalId;
  /** `PLC.SS` との間の抵抗負荷要素のID。 */
  elementId: string;
}

/** PLCの出力1点（端子・所属COM・接点要素）。§4.4 */
export interface PlcOutputChannel {
  name: string;
  terminal: TerminalId;
  com: TerminalId;
  /** 端子とCOMの間の接点要素のID。 */
  elementId: string;
}

/** 部品ごとの動作モデル用メタデータ。 */
export type PartMeta =
  | {
      kind: 'relay-my4n';
      coilElementId: string;
      pickupVolts: number;
      dropoutVolts: number;
      operateTicks: number;
      releaseTicks: number;
    }
  | {
      kind: 'timer-h3y4';
      coilElementId: string;
      presetMs: number;
      rangeMaxMs: number;
      pickupVolts: number;
      dropoutVolts: number;
      resetGapMs: number;
    }
  | { kind: 'pushbutton' }
  | { kind: 'lamp'; color: LampColor; loadElementId: string; litVolts: number; dimVolts: number }
  | { kind: 'buzzer'; loadElementId: string; litVolts: number; dimVolts: number }
  | { kind: 'power-supply'; sourceElementId: string }
  | { kind: 'terminal-block' }
  | {
      kind: 'plc';
      /** 機種名（`FX5U` など。表示と課題データの照合に使う）。§7.6 */
      model: string;
      /** 入力コモン端子（8点1コモンの機種は複数）。§10.1 */
      inputCommons: readonly TerminalId[];
      inputs: readonly PlcInputChannel[];
      outputs: readonly PlcOutputChannel[];
      /** 入力ON判定のしきい値[A]。§5.1.3 */
      onAmps: number;
      /** 入力OFF判定のしきい値[A]。§5.1.3 */
      offAmps: number;
      /** 電源端子（電気的には解かない）。§4.4 */
      power: readonly TerminalId[];
    };

/** 部品インスタンス。端子集合と電気的実体（要素集合）からなる。§5.1 */
export interface Part {
  id: PartId;
  kind: PartKind;
  terminals: TerminalId[];
  elements: Element[];
  meta: PartMeta;
}

/** c接点4組のピン割付（COM, b接点, a接点）。§6.2 */
export const SOCKET_CONTACT_PINS: ReadonlyArray<{ com: number; nc: number; no: number }> = [
  { com: 9, nc: 1, no: 5 },
  { com: 10, nc: 2, no: 6 },
  { com: 11, nc: 3, no: 7 },
  { com: 12, nc: 4, no: 8 },
];
/** コイル(+)側のピン番号。§6.2 */
export const SOCKET_COIL_PLUS_PIN = 14;
/** コイル(−)側のピン番号。§6.2 */
export const SOCKET_COIL_MINUS_PIN = 13;

function socketTerminals(id: PartId): TerminalId[] {
  const out: TerminalId[] = [];
  for (let pin = 1; pin <= 14; pin += 1) out.push(terminalId(id, String(pin)));
  return out;
}

function socketContacts(id: PartId, driver: 'relay' | 'timer'): ContactElement[] {
  const out: ContactElement[] = [];
  SOCKET_CONTACT_PINS.forEach((pins, group) => {
    out.push({
      kind: 'contact',
      id: `${id}:b${group + 1}`,
      from: terminalId(id, String(pins.com)),
      to: terminalId(id, String(pins.nc)),
      contact: 'b',
      driver,
      driverId: id,
      group,
      energized: false,
      closedOhms: CLOSED_CONTACT_OHMS,
    });
    out.push({
      kind: 'contact',
      id: `${id}:a${group + 1}`,
      from: terminalId(id, String(pins.com)),
      to: terminalId(id, String(pins.no)),
      contact: 'a',
      driver,
      driverId: id,
      group,
      energized: false,
      closedOhms: CLOSED_CONTACT_OHMS,
    });
  });
  return out;
}

function coilElement(id: PartId): LoadElement {
  return {
    kind: 'load',
    id: `${id}:coil`,
    from: terminalId(id, String(SOCKET_COIL_PLUS_PIN)),
    to: terminalId(id, String(SOCKET_COIL_MINUS_PIN)),
    load: 'coil',
    nominalOhms: COIL_OHMS,
    polarized: true,
  };
}

/** MY4N相当の4cリレー（14ピン）を作る。§5.3.1 */
export function createRelay4c(id: PartId | string): Part {
  const pid = partId(id);
  const coil = coilElement(pid);
  return {
    id: pid,
    kind: 'relay-my4n',
    terminals: socketTerminals(pid),
    elements: [coil, ...socketContacts(pid, 'relay')],
    meta: {
      kind: 'relay-my4n',
      coilElementId: coil.id,
      pickupVolts: PICKUP_VOLTS,
      dropoutVolts: DROPOUT_VOLTS,
      operateTicks: 1,
      releaseTicks: 1,
    },
  };
}

/**
 * タイマ設定値を [100ms, レンジ上限] に収める。§5.3.2
 * レンジ上限が下限（100ms）未満のときは 100ms を下限として扱う。
 * `presetMs` / `rangeMaxMs` が有限数でない場合は RangeError。
 */
export function clampPreset(presetMs: number, rangeMaxMs: number): number {
  if (!Number.isFinite(presetMs) || !Number.isFinite(rangeMaxMs)) {
    throw new RangeError('timer preset and range must be finite numbers');
  }
  const effectiveRange = Math.max(rangeMaxMs, TIMER_MIN_PRESET_MS);
  return Math.min(Math.max(presetMs, TIMER_MIN_PRESET_MS), effectiveRange);
}

/** H3Y-4相当のパワーオンディレータイマ（限時接点4c、瞬時接点なし）を作る。§5.3.2 */
export function createTimer4c(
  id: PartId | string,
  presetMs: number,
  rangeMaxMs: number = TIMER_RANGE_10S_MS,
): Part {
  const pid = partId(id);
  const coil = coilElement(pid);
  return {
    id: pid,
    kind: 'timer-h3y4',
    terminals: socketTerminals(pid),
    elements: [coil, ...socketContacts(pid, 'timer')],
    meta: {
      kind: 'timer-h3y4',
      coilElementId: coil.id,
      presetMs: clampPreset(presetMs, rangeMaxMs),
      rangeMaxMs,
      pickupVolts: PICKUP_VOLTS,
      dropoutVolts: DROPOUT_VOLTS,
      resetGapMs: TIMER_RESET_GAP_MS,
    },
  };
}

/** 自動復帰型の押ボタン（c/a/b端子）を作る。§5.3.3 */
export function createPushButton(id: PartId | string): Part {
  const pid = partId(id);
  const c = terminalId(pid, 'c');
  const a = terminalId(pid, 'a');
  const b = terminalId(pid, 'b');
  return {
    id: pid,
    kind: 'pushbutton',
    terminals: [c, a, b],
    elements: [
      {
        kind: 'contact',
        id: `${pid}:a`,
        from: c,
        to: a,
        contact: 'a',
        driver: 'manual',
        driverId: pid,
        group: 0,
        energized: false,
        closedOhms: CLOSED_CONTACT_OHMS,
      },
      {
        kind: 'contact',
        id: `${pid}:b`,
        from: c,
        to: b,
        contact: 'b',
        driver: 'manual',
        driverId: pid,
        group: 0,
        energized: false,
        closedOhms: CLOSED_CONTACT_OHMS,
      },
    ],
    meta: { kind: 'pushbutton' },
  };
}

/** DC24V表示灯を作る。§5.3.4 */
export function createLamp(id: PartId | string, color: LampColor): Part {
  const pid = partId(id);
  const plus = terminalId(pid, '+');
  const minus = terminalId(pid, '-');
  const load: LoadElement = {
    kind: 'load',
    id: `${pid}:load`,
    from: plus,
    to: minus,
    load: 'lamp',
    nominalOhms: LAMP_OHMS,
    polarized: false,
  };
  return {
    id: pid,
    kind: 'lamp',
    terminals: [plus, minus],
    elements: [load],
    meta: {
      kind: 'lamp',
      color,
      loadElementId: load.id,
      litVolts: LAMP_LIT_VOLTS,
      dimVolts: LAMP_DIM_VOLTS,
    },
  };
}

/** ブザー（任意部品）を作る。§5.3.4 */
export function createBuzzer(id: PartId | string): Part {
  const pid = partId(id);
  const plus = terminalId(pid, '+');
  const minus = terminalId(pid, '-');
  const load: LoadElement = {
    kind: 'load',
    id: `${pid}:load`,
    from: plus,
    to: minus,
    load: 'buzzer',
    nominalOhms: BUZZER_OHMS,
    polarized: false,
  };
  return {
    id: pid,
    kind: 'buzzer',
    terminals: [plus, minus],
    elements: [load],
    meta: {
      kind: 'buzzer',
      loadElementId: load.id,
      litVolts: LAMP_LIT_VOLTS,
      dimVolts: LAMP_DIM_VOLTS,
    },
  };
}

/**
 * DC24V電源を作る。端子は `<id>.+`（P側 +24V）と `<id>.-`（N側 0V）。§6.4
 * ブレーカと電源スイッチはAC一次側であり電気的には解かないため、
 * Simulation の `setBreaker()` / `setSwitch()` が `SourceElement.enabled` を制御する。§5.3.5
 */
export function createPowerSupply(id: PartId | string): Part {
  const pid = partId(id);
  const plus = terminalId(pid, '+');
  const minus = terminalId(pid, '-');
  const source: SourceElement = {
    kind: 'source',
    id: `${pid}:source`,
    from: plus,
    to: minus,
    volts: SOURCE_VOLTS,
    internalOhms: SOURCE_INTERNAL_OHMS,
    protectionAmps: PROTECTION_AMPS,
    enabled: false,
  };
  return {
    id: pid,
    kind: 'power-supply',
    terminals: [plus, minus],
    elements: [source],
    meta: { kind: 'power-supply', sourceElementId: source.id },
  };
}

/** 端子台と部品本体の間の0Ω固定リンクを作る。§6.4 */
export function createTerminalBlockLink(
  id: string,
  from: TerminalId,
  to: TerminalId,
  locked = true,
): LinkElement {
  return { kind: 'link', id, from, to, locked };
}
