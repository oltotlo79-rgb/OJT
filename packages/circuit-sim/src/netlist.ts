import type { Element, LinkElement } from './elements.js';
import { wireId, type TerminalId, type WireId } from './ids.js';
import type { Part } from './parts.js';

/** 電線の色。§6.6 */
export type WireColor = '青' | '白' | '黄';

/** 1端子に接続できる電線の本数上限。§6.6（上限の強制はUI／コンテンツ側の責務） */
export const MAX_WIRES_PER_TERMINAL = 2;

/** 電線。抵抗は理想導体として扱い、節点併合で表現する。§5.1 */
export interface Wire {
  id: WireId;
  from: TerminalId;
  to: TerminalId;
  color: WireColor;
  /** チェック用回路の黄色配線など、変更不可の電線。§6.3 */
  locked: boolean;
  /** `wire-open` 故障。true のとき導通しない。§5.4 */
  open: boolean;
}

/** 回路エンジンが解く対象のデータ構造。§5.1 */
export interface Netlist {
  parts: Part[];
  wires: Wire[];
  /** 部品本体と端子台の間の既設0Ωリンク。§6.4 */
  links: LinkElement[];
}

/** ネットリスト操作の失敗。 */
export class NetlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetlistError';
  }
}

/** 電線を作る。 */
export function createWire(
  id: string,
  from: TerminalId,
  to: TerminalId,
  color: WireColor = '青',
  locked = false,
): Wire {
  return { id: wireId(id), from, to, color, locked, open: false };
}

/** ネットリストを作る。 */
export function createNetlist(
  parts: Part[] = [],
  wires: Wire[] = [],
  links: LinkElement[] = [],
): Netlist {
  return { parts, wires, links };
}

/** 全部品の全要素を順に返す。並び順は parts の並び順・elements の並び順で決まる（決定論）。 */
export function allElements(netlist: Netlist): Element[] {
  const out: Element[] = [];
  for (const part of netlist.parts) out.push(...part.elements);
  return out;
}

/** 部品を探す。 */
export function findPart(netlist: Netlist, id: string): Part | undefined {
  return netlist.parts.find((p) => p.id === id);
}

/** 要素IDで要素を探す。 */
export function findElement(netlist: Netlist, elementId: string): Element | undefined {
  for (const part of netlist.parts) {
    const hit = part.elements.find((e) => e.id === elementId);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** 電線を探す。 */
export function findWire(netlist: Netlist, id: string): Wire | undefined {
  return netlist.wires.find((w) => w.id === id);
}

/** 電線を追加する。同じIDが既にあれば NetlistError。 */
export function addWire(netlist: Netlist, wire: Wire): void {
  if (findWire(netlist, wire.id) !== undefined) {
    throw new NetlistError(`電線IDが重複しています: ${wire.id}`);
  }
  netlist.wires.push(wire);
}

/** 電線を削除する。削除できたら true。locked の電線は NetlistError。§6.3 */
export function removeWire(netlist: Netlist, id: string): boolean {
  const index = netlist.wires.findIndex((w) => w.id === id);
  if (index < 0) return false;
  const wire = netlist.wires[index];
  if (wire !== undefined && wire.locked) {
    throw new NetlistError('チェック用回路の黄色配線は変更できません');
  }
  netlist.wires.splice(index, 1);
  return true;
}

/** その端子に接続されている電線の本数を返す（`wire-open` の電線も本数には数える）。§6.6 */
export function wireCountAt(netlist: Netlist, terminal: TerminalId): number {
  let n = 0;
  for (const w of netlist.wires) {
    if (w.from === terminal) n += 1;
    if (w.to === terminal) n += 1;
  }
  return n;
}

/** その端子が本数上限（2本）を超えているか。§6.6 */
export function exceedsWireLimit(netlist: Netlist, terminal: TerminalId): boolean {
  return wireCountAt(netlist, terminal) > MAX_WIRES_PER_TERMINAL;
}

/** 端子から節点への写像。 */
export interface Nets {
  readonly nodeCount: number;
  readonly terminals: readonly TerminalId[];
  hasTerminal(terminal: TerminalId): boolean;
  /** 端子の節点番号。未知の端子は NetlistError。 */
  nodeOf(terminal: TerminalId): number;
  /** その節点に属する端子一覧。 */
  terminalsOf(node: number): readonly TerminalId[];
}

/**
 * 電線と0Ωリンクで端子を併合し、節点を作る（union-find）。
 * `wire-open` の電線は併合しない（断線）。§5.1 / §5.4
 */
export function buildNets(netlist: Netlist): Nets {
  const index = new Map<string, number>();
  const parent: number[] = [];
  const order: TerminalId[] = [];

  const idx = (t: TerminalId): number => {
    const found = index.get(t);
    if (found !== undefined) return found;
    const next = parent.length;
    index.set(t, next);
    parent.push(next);
    order.push(t);
    return next;
  };
  const parentOf = (i: number): number => parent[i] ?? i;
  const find = (start: number): number => {
    let root = start;
    while (parentOf(root) !== root) root = parentOf(root);
    let cursor = start;
    while (parentOf(cursor) !== cursor) {
      const next = parentOf(cursor);
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (a: TerminalId, b: TerminalId): void => {
    const ra = find(idx(a));
    const rb = find(idx(b));
    if (ra !== rb) parent[rb] = ra;
  };

  for (const part of netlist.parts) {
    for (const t of part.terminals) idx(t);
    for (const el of part.elements) {
      idx(el.from);
      idx(el.to);
    }
  }
  for (const w of netlist.wires) {
    idx(w.from);
    idx(w.to);
  }
  for (const l of netlist.links) {
    idx(l.from);
    idx(l.to);
  }
  for (const w of netlist.wires) if (!w.open) union(w.from, w.to);
  for (const l of netlist.links) union(l.from, l.to);

  const dense = new Map<number, number>();
  const nodeOfTerminal = new Map<string, number>();
  const members = new Map<number, TerminalId[]>();
  order.forEach((t, i) => {
    const root = find(i);
    const known = dense.get(root);
    const node = known ?? dense.size;
    if (known === undefined) dense.set(root, node);
    nodeOfTerminal.set(t, node);
    const bucket = members.get(node);
    if (bucket === undefined) members.set(node, [t]);
    else bucket.push(t);
  });

  return {
    nodeCount: members.size,
    terminals: order,
    hasTerminal: (t) => nodeOfTerminal.has(t),
    nodeOf: (t) => {
      const n = nodeOfTerminal.get(t);
      if (n === undefined) throw new NetlistError(`ネットリストに無い端子です: ${t}`);
      return n;
    },
    terminalsOf: (node) => members.get(node) ?? [],
  };
}
