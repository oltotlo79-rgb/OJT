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
  /** チェック用回路の既設配線など、訓練者が変更できない電線。§6.3 */
  locked: boolean;
  /** `wire-open` 故障。true のとき導通しない。§5.4 */
  open: boolean;
}

/** 回路エンジンが解く対象のデータ構造。§5.1 */
export interface Netlist {
  maxWiresPerTerminal?: number;
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

/** ネットリストを作る。渡された配列はコピーされるため、呼び出し元がその後配列を変更してもネットリストには影響しない。 */
export function createNetlist(
  parts: Part[] = [],
  wires: Wire[] = [],
  links: LinkElement[] = [],
): Netlist {
  return { parts: [...parts], wires: [...wires], links: [...links] };
}

/**
 * ネットリストを深く複製する。要素の実行時状態（`energized` / `enabled` 等）・故障（`fault`）・
 * 電線（`open` を含む）はすべて複製され、複製後は元のネットリストと完全に独立する。
 * データはすべてプレーンなオブジェクト・配列・プリミティブなので `structuredClone` で複製できる。
 */
export function cloneNetlist(netlist: Netlist): Netlist {
  return structuredClone(netlist);
}

/**
 * ランタイム状態のみをリセットする。
 * - 接点（contact）: `energized` を false に戻す。
 * - 電源（source）: `enabled` を `createPowerSupply` の初期値（false）に戻す。
 * `fault`（接点・負荷の故障）と `wire.open`（断線）はここでは変更しない。
 * 故障のクリアは別タスクの `clearFaults` が担う。
 * これは実行前（pre-run）に部品要素の状態を初期化するためのヘルパーであり、稼働中の
 * `Simulation` が内部に持つリレー／タイマ／押ボタンのランタイム状態は戻さない。
 * それらをリセットするには新しい `Simulation` を作り直すこと。
 */
export function resetNetlist(netlist: Netlist): void {
  for (const el of allElements(netlist)) {
    if (el.kind === 'contact') el.energized = false;
    else if (el.kind === 'source') el.enabled = false;
  }
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
    throw new NetlistError('チェック用回路の既設配線（青）は変更できません');
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
  return wireCountAt(netlist, terminal) > (netlist.maxWiresPerTerminal ?? MAX_WIRES_PER_TERMINAL);
}

/** その端子にこれ以上電線を追加できるか（本数上限未満）。§6.6 */
export function canAddWire(netlist: Netlist, terminal: TerminalId): boolean {
  return wireCountAt(netlist, terminal) < (netlist.maxWiresPerTerminal ?? MAX_WIRES_PER_TERMINAL);
}

/** ネットリストに存在する全端子の集合（全部品の `terminals` の和集合）。`validateNetlist` と故障注入の両方で使う。 */
export function knownTerminals(netlist: Netlist): Set<TerminalId> {
  const known = new Set<TerminalId>();
  for (const part of netlist.parts) {
    for (const terminal of part.terminals) known.add(terminal);
  }
  return known;
}

/** `validateNetlist` が報告する個々の問題。 */
export interface NetlistIssue {
  kind:
    | 'unknown-terminal'
    | 'duplicate-wire-id'
    | 'self-loop-wire'
    | 'duplicate-part-id'
    | 'duplicate-element-id';
  /** 問題の原因が電線か、部品本体と端子台を結ぶ0Ωリンクか、部品か、部品の要素か。§6.4 */
  ownerKind: 'wire' | 'link' | 'part' | 'element';
  ownerId: string;
  terminal?: string;
  message: string;
}

/**
 * ネットリストの整合性を検査する。例外は投げない。検査順序は決定論的。
 * (a) 電線→リンクの順（それぞれ配列順）に、`from`/`to` が全部品の端子集合に存在するか
 * (b) 電線IDの重複（2件目以降を報告）
 * (c) `from === to` の自己ループ電線
 * (d) 部品IDの重複（2件目以降を報告）。CS-05: `findPart` は先勝ち、`Map` を経由する呼び出し元は
 *     後勝ちになりうるため、重複した部品IDは検出時点で読み手によって別の部品を指してしまう。
 * (e) 要素IDの重複（2件目以降を報告、全部品を通して検査）。同じ理由で `findElement` の結果が
 *     壊れた作業ファイルの読み方によって変わりうる。
 */
export function validateNetlist(netlist: Netlist): NetlistIssue[] {
  const issues: NetlistIssue[] = [];

  const known = knownTerminals(netlist);
  const checkTerminal = (
    ownerKind: 'wire' | 'link',
    ownerId: string,
    terminal: TerminalId,
  ): void => {
    if (known.has(terminal)) return;
    const label = ownerKind === 'wire' ? '電線' : 'リンク';
    issues.push({
      kind: 'unknown-terminal',
      ownerKind,
      ownerId,
      terminal,
      message: `${label} ${ownerId} の端子 ${terminal} はどの部品にも存在しません`,
    });
  };
  for (const wire of netlist.wires) {
    checkTerminal('wire', wire.id, wire.from);
    checkTerminal('wire', wire.id, wire.to);
  }
  for (const link of netlist.links) {
    checkTerminal('link', link.id, link.from);
    checkTerminal('link', link.id, link.to);
  }

  const seenWireIds = new Set<WireId>();
  for (const wire of netlist.wires) {
    if (seenWireIds.has(wire.id)) {
      issues.push({
        kind: 'duplicate-wire-id',
        ownerKind: 'wire',
        ownerId: wire.id,
        message: `電線ID ${wire.id} が重複しています`,
      });
    } else {
      seenWireIds.add(wire.id);
    }
  }

  for (const wire of netlist.wires) {
    if (wire.from === wire.to) {
      issues.push({
        kind: 'self-loop-wire',
        ownerKind: 'wire',
        ownerId: wire.id,
        message: `電線 ${wire.id} の両端が同じ端子です（自己ループ）: ${wire.from}`,
      });
    }
  }

  const seenPartIds = new Set<string>();
  for (const part of netlist.parts) {
    if (seenPartIds.has(part.id)) {
      issues.push({
        kind: 'duplicate-part-id',
        ownerKind: 'part',
        ownerId: part.id,
        message: `部品ID ${part.id} が重複しています`,
      });
    } else {
      seenPartIds.add(part.id);
    }
  }

  const seenElementIds = new Set<string>();
  for (const el of allElements(netlist)) {
    if (seenElementIds.has(el.id)) {
      issues.push({
        kind: 'duplicate-element-id',
        ownerKind: 'element',
        ownerId: el.id,
        message: `要素ID ${el.id} が重複しています`,
      });
    } else {
      seenElementIds.add(el.id);
    }
  }

  return issues;
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
const netCache = new WeakMap<Netlist, { signature: string; nets: Nets }>();
export function buildNets(netlist: Netlist): Nets {
  const signature = JSON.stringify([
    netlist.parts.map((part) => [part.terminals, part.elements.map((el) => [el.from, el.to])]),
    netlist.wires.map((wire) => [wire.from, wire.to, wire.open]),
    netlist.links.map((link) => [link.from, link.to]),
  ]);
  const cached = netCache.get(netlist);
  if (cached?.signature === signature) return cached.nets;
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

  const nets: Nets = {
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
  netCache.set(netlist, { signature, nets });
  return nets;
}
