import {
  DEFAULT_CONTACT_RESISTIVE_OHMS,
  DEFAULT_LAYER_SHORT_RATIO,
  MAX_LAYER_SHORT_RATIO,
  MIN_LAYER_SHORT_RATIO,
} from './elements.js';
import type { ContactElement, Element, LoadElement } from './elements.js';
import type { TerminalId } from './ids.js';
import { findPart, findWire } from './netlist.js';
import type { Netlist } from './netlist.js';

/** 故障の種別。§5.4 */
export type FaultKind =
  | 'wire-open'
  | 'wire-missing'
  | 'wire-misrouted'
  | 'contact-open'
  | 'contact-welded'
  | 'contact-resistive'
  | 'coil-open'
  | 'coil-layer-short'
  | 'lamp-open';

/** 故障の注入先。§5.4 */
export type FaultTarget = { wireId: string } | { partId: string; elementIndex: number };

/** 故障注入の失敗。 */
export class FaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultError';
  }
}

function resolveElement(netlist: Netlist, target: FaultTarget): Element {
  if (!('partId' in target)) throw new FaultError('部品の故障には partId が必要です');
  const part = findPart(netlist, target.partId);
  if (part === undefined) throw new FaultError(`部品が見つかりません: ${target.partId}`);
  const el = part.elements[target.elementIndex];
  if (el === undefined) {
    throw new FaultError(`要素が見つかりません: ${target.partId}[${target.elementIndex}]`);
  }
  return el;
}

function asContact(el: Element): ContactElement {
  if (el.kind !== 'contact') throw new FaultError(`接点ではありません: ${el.id}`);
  return el;
}

function asLoad(el: Element, ...kinds: LoadElement['load'][]): LoadElement {
  if (el.kind !== 'load' || !kinds.includes(el.load)) {
    throw new FaultError(`対象外の負荷です: ${el.id}`);
  }
  return el;
}

/**
 * 溶着した接点と同じ組のもう一方の接点を機械的に開く。§7.5 / ゴールデンケース#19
 * （鉄片が吸着したまま固まるため、a接点が溶着すると同じ組のb接点は開いたままになる）
 */
function openPairedContact(netlist: Netlist, welded: ContactElement): void {
  const part = findPart(netlist, welded.driverId);
  if (part === undefined) return;
  for (const el of part.elements) {
    if (el.kind !== 'contact') continue;
    if (el.group !== welded.group || el.contact === welded.contact) continue;
    el.fault = { kind: 'open' };
  }
}

/**
 * 故障を注入する。§5.4
 * @param param kind ごとに意味が決まる。
 *   - `contact-resistive`: 直列抵抗[Ω]（既定500）
 *   - `coil-layer-short`: ratio（0.4〜0.85、既定0.65）
 *   - `wire-misrouted`: 付け替え先の端子ID
 *   - それ以外: 省略する
 */
export function injectFault(
  netlist: Netlist,
  target: FaultTarget,
  kind: FaultKind,
  param?: number | TerminalId,
): void {
  switch (kind) {
    case 'wire-open':
    case 'wire-missing':
    case 'wire-misrouted': {
      if (!('wireId' in target)) throw new FaultError('電線の故障には wireId が必要です');
      const wire = findWire(netlist, target.wireId);
      if (wire === undefined) throw new FaultError(`電線が見つかりません: ${target.wireId}`);
      if (kind === 'wire-open') {
        wire.open = true;
      } else if (kind === 'wire-missing') {
        const index = netlist.wires.indexOf(wire);
        netlist.wires.splice(index, 1);
      } else {
        if (typeof param !== 'string') {
          throw new FaultError('wire-misrouted には付け替え先の端子IDが必要です');
        }
        wire.to = param;
      }
      return;
    }
    case 'contact-open': {
      asContact(resolveElement(netlist, target)).fault = { kind: 'open' };
      return;
    }
    case 'contact-welded': {
      const contact = asContact(resolveElement(netlist, target));
      contact.fault = { kind: 'welded' };
      openPairedContact(netlist, contact);
      return;
    }
    case 'contact-resistive': {
      const ohms = typeof param === 'number' ? param : DEFAULT_CONTACT_RESISTIVE_OHMS;
      if (!(ohms > 0)) throw new FaultError(`接触抵抗は正の値が必要です: ${String(param)}`);
      asContact(resolveElement(netlist, target)).fault = { kind: 'resistive', ohms };
      return;
    }
    case 'coil-open': {
      asLoad(resolveElement(netlist, target), 'coil').fault = { kind: 'open' };
      return;
    }
    case 'coil-layer-short': {
      const ratio = typeof param === 'number' ? param : DEFAULT_LAYER_SHORT_RATIO;
      if (ratio < MIN_LAYER_SHORT_RATIO || ratio > MAX_LAYER_SHORT_RATIO) {
        throw new FaultError(
          `レアショートの ratio は ${MIN_LAYER_SHORT_RATIO}〜${MAX_LAYER_SHORT_RATIO} です: ${ratio}`,
        );
      }
      asLoad(resolveElement(netlist, target), 'coil').fault = { kind: 'layerShort', ratio };
      return;
    }
    case 'lamp-open': {
      asLoad(resolveElement(netlist, target), 'lamp', 'buzzer').fault = { kind: 'open' };
      return;
    }
  }
}

/** 注入済みの故障をすべて取り消す（`wire-missing` と `wire-misrouted` は元に戻せない）。 */
export function clearFaults(netlist: Netlist): void {
  for (const wire of netlist.wires) wire.open = false;
  for (const part of netlist.parts) {
    for (const el of part.elements) {
      if (el.kind === 'contact' || el.kind === 'load') delete el.fault;
    }
  }
}
