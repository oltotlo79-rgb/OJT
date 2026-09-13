import type { PartId, TerminalId } from './ids.js';

/** tick長（ms）。設計仕様 §5.2。 */
export const TICK_MS = 10;
/** DC24V電源の公称出力電圧[V]。§5.1.1 */
export const SOURCE_VOLTS = 24;
/** DC24V電源の内部抵抗[Ω]。§5.1.1 */
export const SOURCE_INTERNAL_OHMS = 0.1;
/** 過電流保護のしきい値[A]。§5.1.1 */
export const PROTECTION_AMPS = 1;
/** 閉じた接点の抵抗[Ω]（=1000S）。§5.2 */
export const CLOSED_CONTACT_OHMS = 0.001;
/** CRコイル／Tの電源の抵抗[Ω]。§5.1.3 */
export const COIL_OHMS = 650;
/** PL（DC24V表示灯）の抵抗[Ω]。§5.1.3 */
export const LAMP_OHMS = 2400;
/** BZの抵抗[Ω]。§5.1.3 */
export const BUZZER_OHMS = 1000;
/** PLC入力の既定抵抗[Ω]。§5.1.3 */
export const PLC_INPUT_OHMS = 4700;
/** コイル励磁しきい値[V]（定格の80%）。§5.3.1 */
export const PICKUP_VOLTS = 19.2;
/** コイル復帰しきい値[V]（定格の10%）。§5.3.1 */
export const DROPOUT_VOLTS = 2.4;
/** ランプ点灯しきい値[V]（定格の60%）。 */
export const LAMP_LIT_VOLTS = 14.4;
/** ランプ暗点灯しきい値[V]（定格の30%）。 */
export const LAMP_DIM_VOLTS = 7.2;
/** レアショートの既定 ratio。§5.1.3 */
export const DEFAULT_LAYER_SHORT_RATIO = 0.65;
/** レアショートの ratio 下限。§5.1.3 */
export const MIN_LAYER_SHORT_RATIO = 0.4;
/** レアショートの ratio 上限。§5.1.3 */
export const MAX_LAYER_SHORT_RATIO = 0.85;
/** 接触不良の既定直列抵抗[Ω]。§5.4 */
export const DEFAULT_CONTACT_RESISTIVE_OHMS = 500;

/** 接点種別。a=メーク、b=ブレーク。§5.1.2 */
export type ContactKind = 'a' | 'b';

/** 接点の駆動源。§5.1.2 */
export type ContactDriver = 'manual' | 'relay' | 'timer' | 'external';

/** 接点の故障。§5.1.2 / §5.4 */
export type ContactFault =
  { kind: 'open' } | { kind: 'welded' } | { kind: 'resistive'; ohms: number };

/** 負荷種別。§5.1.3 */
export type LoadKind = 'coil' | 'lamp' | 'buzzer' | 'plcInput';

/** 負荷の故障。§5.1.3 */
export type LoadFault = { kind: 'open' } | { kind: 'layerShort'; ratio: number };

/** 直流電源要素。`from` が P(+24V) 側、`to` が N(0V) 側。§5.1.1 */
export interface SourceElement {
  kind: 'source';
  id: string;
  from: TerminalId;
  to: TerminalId;
  volts: number;
  internalOhms: number;
  protectionAmps: number;
  /** ブレーカ・電源スイッチ・保護動作を反映した通電可否。Simulation が毎tick更新する。 */
  enabled: boolean;
}

/** 接点要素。§5.1.2 */
export interface ContactElement {
  kind: 'contact';
  id: string;
  from: TerminalId;
  to: TerminalId;
  contact: ContactKind;
  driver: ContactDriver;
  /** この接点を駆動する部品のID（PB／CR／T）。 */
  driverId: PartId;
  /** c接点の組番号（0起点、0〜3）。§6.2 */
  group: number;
  /** 駆動源が動作位置にあるか（PB押下中／CR励磁中／Tタイムアップ済み）。 */
  energized: boolean;
  closedOhms: number;
  fault?: ContactFault;
}

/** 負荷要素。`from` が +側、`to` が −側。§5.1.3 */
export interface LoadElement {
  kind: 'load';
  id: string;
  from: TerminalId;
  to: TerminalId;
  load: LoadKind;
  nominalOhms: number;
  /** 極性を持つ（コイル）。true なら電圧の符号を見る。§5.3.1 の極性違反 */
  polarized: boolean;
  fault?: LoadFault;
}

/** 0Ω固定リンク要素（部品本体と端子台の間の既設配線）。§6.4 */
export interface LinkElement {
  kind: 'link';
  id: string;
  from: TerminalId;
  to: TerminalId;
  locked: boolean;
}

/** 部品の内部要素。§5.1 */
export type Element = SourceElement | ContactElement | LoadElement | LinkElement;

/** 接点が現在閉じているか。故障を優先して評価する。§5.1.2 */
export function isContactClosed(el: ContactElement): boolean {
  if (el.fault?.kind === 'open') return false;
  if (el.fault?.kind === 'welded') return true;
  return el.contact === 'a' ? el.energized : !el.energized;
}

/** 閉じている接点の抵抗[Ω]。開いているときは undefined。 */
export function contactOhms(el: ContactElement): number | undefined {
  if (!isContactClosed(el)) return undefined;
  if (el.fault?.kind === 'resistive') return el.fault.ohms;
  return el.closedOhms;
}

/** 負荷の抵抗[Ω]。断線しているときは undefined。§5.1.3 */
export function loadOhms(el: LoadElement): number | undefined {
  if (el.fault?.kind === 'open') return undefined;
  if (el.fault?.kind === 'layerShort') return el.nominalOhms * el.fault.ratio;
  return el.nominalOhms;
}
