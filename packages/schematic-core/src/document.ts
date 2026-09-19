/**
 * 展開接続図の文書モデル。設計仕様 §11.1。
 * 向きは**横書き**固定（左母線が `P(+24V)`、右母線が `N(0V)`）。縦書きは表示だけの切替で、
 * 文書モデルは常に横書きで保持する。
 *
 * 構造はグリッド。**行＝段（ラング）**、**列＝段内の直列位置**。
 * 段は「始点 → 直列に並んだ要素 → 終点」の1本の経路で、始点・終点は母線か他の段の節点を指す。
 * 段どうしを結ぶこの参照が、縦線（分岐）と分岐点そのものになる。
 */

import { TIMER_RANGE_60S } from '@ojt/board-model';
import { TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';

/** 文書形式のバージョン。§13 #8 */
export const SCHEMATIC_FORMAT_VERSION = 1;

/** 接点要素の種別。§11.1 */
export type ContactCellKind = 'pb-a' | 'pb-b' | 'cr-a' | 'cr-b' | 't-a' | 't-b';

/** 負荷要素の種別。§11.1 */
export type LoadCellKind = 'coil' | 'lamp' | 'buzzer';

/** 要素の種別。 */
export type CellKind = ContactCellKind | LoadCellKind;

/** 段の中の1要素。 */
export interface SchematicCell {
  kind: CellKind;
  /** 文書内で一意な要素ID（`physicalOverride` のキーにもなる。§7.2）。 */
  id: string;
  /** 機器名（`PB1`〜`PB4` / `CR1`〜`CR4` / `T1`・`T2` / `PL1`〜`PL4` / `BZ`）。§6.4 */
  device: string;
  /**
   * タイマコイルの設定時間[ms]（`kind: 'coil'` かつ `device` が `Tn` のときだけ持つ）。§5.3.2
   * 明示的な `undefined` も受ける（zodの `.optional()` は `number | undefined` を推論するため、
   * `exactOptionalPropertyTypes` 下でも読み込んだ文書をそのまま載せられるようにする）。
   */
  presetMs?: number | undefined;
}

/** 段の端点。母線か、他の段の節点。 */
export type RungEnd = { bus: 'P' } | { bus: 'N' } | { rung: string; node: number };

/** 1段（ラング）。`cells` の並びがそのまま直列位置（列）になる。 */
export interface Rung {
  id: string;
  from: RungEnd;
  to: RungEnd;
  cells: SchematicCell[];
}

/** 展開接続図の文書。 */
export interface SchematicDocument {
  formatVersion: number;
  id: string;
  title: string;
  /** 既定かつ唯一の保持形式は横書き（左P・右N）。§11.1 */
  orientation: 'horizontal';
  rungs: Rung[];
}

/** 構造エラー1件。 */
export interface DocumentError {
  /** エラー箇所（`rungs[0].cells[2]` など）。 */
  path: string;
  message: string;
}

export const DEVICE_PATTERNS: Readonly<Record<CellKind, RegExp>> = {
  'pb-a': /^PB[1-4]$/,
  'pb-b': /^PB[1-4]$/,
  'cr-a': /^CR[1-4]$/,
  'cr-b': /^CR[1-4]$/,
  't-a': /^T[12]$/,
  't-b': /^T[12]$/,
  coil: /^(CR[1-4]|T[12])$/,
  lamp: /^PL[1-4]$/,
  buzzer: /^BZ$/,
};

/**
 * 種別の日本語名（パレットと操作ログ、構造エラーの文面で使う）。§11.1
 * `edit.ts` の `deviceProblem()` と `checkCell()` の「〜に使えない機器名です」の言い回しを
 * そろえるため、ここに置く（`edit.ts` が document.ts を import する向きは変えない。§import-x/no-cycle）。
 */
export const CELL_KIND_LABELS: Readonly<Record<CellKind, string>> = {
  'pb-a': '押ボタン a接点',
  'pb-b': '押ボタン b接点',
  'cr-a': 'リレー a接点',
  'cr-b': 'リレー b接点',
  't-a': 'タイマ a接点（限時）',
  't-b': 'タイマ b接点（限時）',
  coil: 'コイル',
  lamp: '表示灯',
  buzzer: 'ブザー',
};

/** 負荷（コイル・ランプ・ブザー）の要素か。 */
export function isLoadCell(cell: SchematicCell): boolean {
  return cell.kind === 'coil' || cell.kind === 'lamp' || cell.kind === 'buzzer';
}

/** 接点の要素か。 */
export function isContactCell(cell: SchematicCell): boolean {
  return !isLoadCell(cell);
}

/** 段の節点数（要素数＋1）。節点0が `from`、節点 `cells.length` が `to`。 */
export function rungNodeCount(rung: Rung): number {
  return rung.cells.length + 1;
}

/** 押ボタンのa接点。 */
export function pbA(id: string, device: string): SchematicCell {
  return { kind: 'pb-a', id, device };
}
/** 押ボタンのb接点。 */
export function pbB(id: string, device: string): SchematicCell {
  return { kind: 'pb-b', id, device };
}
/** リレーのa接点。 */
export function crA(id: string, device: string): SchematicCell {
  return { kind: 'cr-a', id, device };
}
/** リレーのb接点。 */
export function crB(id: string, device: string): SchematicCell {
  return { kind: 'cr-b', id, device };
}
/** タイマの限時動作瞬時復帰a接点。§3.4 */
export function tA(id: string, device: string): SchematicCell {
  return { kind: 't-a', id, device };
}
/** タイマの限時動作瞬時復帰b接点。§3.4 */
export function tB(id: string, device: string): SchematicCell {
  return { kind: 't-b', id, device };
}
/** コイル（リレー／タイマ）。タイマは `presetMs` を持つ。 */
export function coil(id: string, device: string, presetMs?: number): SchematicCell {
  return presetMs === undefined
    ? { kind: 'coil', id, device }
    : { kind: 'coil', id, device, presetMs };
}
/** 表示灯。 */
export function lamp(id: string, device: string): SchematicCell {
  return { kind: 'lamp', id, device };
}
/** ブザー。 */
export function buzzer(id: string): SchematicCell {
  return { kind: 'buzzer', id, device: 'BZ' };
}

/** 文書を作る（`formatVersion` と `orientation` を埋める）。 */
export function createDocument(id: string, title: string, rungs: Rung[]): SchematicDocument {
  return { formatVersion: SCHEMATIC_FORMAT_VERSION, id, title, orientation: 'horizontal', rungs };
}

/** 段を作る。 */
export function rung(id: string, from: RungEnd, to: RungEnd, cells: SchematicCell[]): Rung {
  return { id, from, to, cells };
}

/** 左母線（P）。§11.1 */
export const BUS_P: RungEnd = { bus: 'P' };
/** 右母線（N）。§11.1 */
export const BUS_N: RungEnd = { bus: 'N' };

/** 他の段の節点を指す端点（分岐点）。 */
export function at(rungId: string, node: number): RungEnd {
  return { rung: rungId, node };
}

/**
 * 解決済みの端点。`at(r, 0)` は `r.from` を、`at(r, r.cells.length)` は `r.to` を指すだけなので、
 * 「その端点が実際にどの電気的節点か」は参照をたどり切って初めて決まる。
 */
export type ResolvedNode =
  { kind: 'bus'; bus: 'P' | 'N' } | { kind: 'node'; rungId: string; index: number };

type EndResolution = ResolvedNode | { kind: 'cycle' } | { kind: 'unresolved' };

function resolveEnd(doc: SchematicDocument, end: RungEnd, visited: Set<string>): EndResolution {
  if ('bus' in end) return { kind: 'bus', bus: end.bus };
  const key = `${end.rung}#${end.node}`;
  if (visited.has(key)) return { kind: 'cycle' };
  visited.add(key);
  const target = doc.rungs.find((r) => r.id === end.rung);
  if (target === undefined) return { kind: 'unresolved' };
  if (!Number.isInteger(end.node) || end.node < 0 || end.node > target.cells.length) {
    return { kind: 'unresolved' };
  }
  if (end.node === 0) return resolveEnd(doc, target.from, visited);
  if (end.node === target.cells.length) return resolveEnd(doc, target.to, visited);
  return { kind: 'node', rungId: target.id, index: end.node };
}

function resolveAt(doc: SchematicDocument, owner: Rung, index: number): EndResolution {
  const visited = new Set<string>([`${owner.id}#${index}`]);
  if (index === 0) return resolveEnd(doc, owner.from, visited);
  if (index === owner.cells.length) return resolveEnd(doc, owner.to, visited);
  return { kind: 'node', rungId: owner.id, index };
}

/**
 * 段の節点 k（要素kの左側。節点0が `from`、節点 `cells.length` が `to`）を解決する。
 * 参照切れ・循環で解決できないときは undefined（`validateDocument` がその文書を先に弾く）。
 */
export function resolveNode(
  doc: SchematicDocument,
  owner: Rung,
  index: number,
): ResolvedNode | undefined {
  const resolved = resolveAt(doc, owner, index);
  return resolved.kind === 'cycle' || resolved.kind === 'unresolved' ? undefined : resolved;
}

/** 解決済み端点の同一性キー（同じキー＝同じ電気的節点）。 */
export function nodeKey(node: ResolvedNode): string {
  return node.kind === 'bus' ? `BUS:${node.bus}` : `${node.rungId}#${node.index}`;
}

/** 母線の節点キー。 */
const BUS_P_KEY = nodeKey({ kind: 'bus', bus: 'P' });
const BUS_N_KEY = nodeKey({ kind: 'bus', bus: 'N' });
const BUS_KEYS: readonly string[] = [BUS_P_KEY, BUS_N_KEY];

/** 段の節点キーを節点0〜節点 `cells.length` の順に返す。端点が解決できない段は undefined。 */
function rungNodeKeys(doc: SchematicDocument, r: Rung): string[] | undefined {
  const from = resolveNode(doc, r, 0);
  const to = resolveNode(doc, r, r.cells.length);
  if (from === undefined || to === undefined) return undefined;
  const keys = [nodeKey(from)];
  for (let index = 1; index < r.cells.length; index += 1) {
    keys.push(nodeKey({ kind: 'node', rungId: r.id, index }));
  }
  keys.push(nodeKey(to));
  return keys;
}

/**
 * 節点キーの隣接表（回路の網）。要素1つが節点kと節点k+1を結ぶ1本の辺になり、
 * 分岐の端点は解決済みの節点キーになるので、参照先の節点にそのままつながる。
 */
function netEdges(doc: SchematicDocument): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    edges.set(a, (edges.get(a) ?? new Set<string>()).add(b));
    edges.set(b, (edges.get(b) ?? new Set<string>()).add(a));
  };
  for (const r of doc.rungs) {
    const keys = rungNodeKeys(doc, r);
    if (keys === undefined) continue; // 参照切れ・循環は別のエラーで出ている
    let previous: string | undefined;
    for (const key of keys) {
      if (previous !== undefined) link(previous, key);
      previous = key;
    }
  }
  return edges;
}

/**
 * 母線 `start` から辿り着ける節点キー。**母線は通り抜けない**（もう一方の母線に着いたらそこで止める）。
 * 通り抜けを許すと、N母線にだけぶら下がった島が、健全な段の負荷を経由してP母線につながって見える。
 */
function reachableNodes(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
): Set<string> {
  const seen = new Set<string>([start]);
  let frontier = [start];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const current of frontier) {
      if (current !== start && BUS_KEYS.includes(current)) continue;
      for (const neighbor of edges.get(current) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * すべての段がP母線とN母線の両方につながっているか見る。§11.1
 *
 * 端点を解決しただけでは、内部節点を指し合う段（`r1.from = at(r2,1)` と `r2.from = at(r1,1)`）や、
 * N母線にしかぶら下がっていない島を見逃す。これらは循環参照ではないので今までの検査を通り抜け、
 * 割当も配線も成功するのに1つも動かない回路になる（Plan 1C の採点が「何も配線していない訓練者」と
 * 同じ扱いになってしまう）。そこで解決後の節点でつないだ網を辿り、両母線からの到達性を要求する。
 */
function checkBusReachability(doc: SchematicDocument, errors: DocumentError[]): void {
  const edges = netEdges(doc);
  const reached: readonly (readonly [string, ReadonlySet<string>])[] = [
    ['P', reachableNodes(edges, BUS_P_KEY)],
    ['N', reachableNodes(edges, BUS_N_KEY)],
  ];
  doc.rungs.forEach((r, ri) => {
    if (r.cells.length === 0) return; // 空の段は別のエラーで出ている
    const keys = rungNodeKeys(doc, r);
    if (keys === undefined) return; // 参照切れ・循環も同様
    for (const [bus, nodes] of reached) {
      // 段の要素は節点を数珠つなぎにするので、両端が届いていれば途中の節点も届いている
      if (keys.every((key) => nodes.has(key))) continue;
      errors.push({
        path: `rungs[${ri}]`,
        message: `段が ${bus} 母線につながっていません: ${r.id}`,
      });
    }
  });
}

function checkEnd(
  doc: SchematicDocument,
  owner: Rung,
  end: RungEnd,
  path: string,
  errors: DocumentError[],
): void {
  if ('bus' in end) return;
  if (end.rung === owner.id) {
    errors.push({ path, message: `段が自分自身を参照しています: ${owner.id}` });
    return;
  }
  const target = doc.rungs.find((r) => r.id === end.rung);
  if (target === undefined) {
    errors.push({ path, message: `参照先の段がありません: ${end.rung}` });
    return;
  }
  if (!Number.isInteger(end.node) || end.node < 0 || end.node >= rungNodeCount(target)) {
    errors.push({
      path,
      message: `参照先の節点番号が範囲外です: ${end.rung}#${end.node}（0〜${rungNodeCount(target) - 1}）`,
    });
  }
}

function resolvedOrError(
  doc: SchematicDocument,
  owner: Rung,
  index: number,
  path: string,
  errors: DocumentError[],
): ResolvedNode | undefined {
  const resolved = resolveAt(doc, owner, index);
  if (resolved.kind === 'cycle') {
    errors.push({ path, message: `段の端点が循環参照しています: ${path}` });
    return undefined;
  }
  if (resolved.kind === 'unresolved') return undefined; // checkEnd が理由を出している
  return resolved;
}

/**
 * 両端を**解決してから**向きを見る。書かれたとおりの端点（`at(r, 0)` など）で判定すると、
 * 参照の先がP母線／N母線でもそれが分からず、母線間の短絡を通してしまう。
 */
function checkResolvedEnds(
  doc: SchematicDocument,
  r: Rung,
  rungPath: string,
  errors: DocumentError[],
): { from: ResolvedNode; to: ResolvedNode } | undefined {
  const from = resolvedOrError(doc, r, 0, `${rungPath}.from`, errors);
  const to = resolvedOrError(doc, r, r.cells.length, `${rungPath}.to`, errors);
  if (from === undefined || to === undefined) return undefined;
  if (from.kind === 'bus' && from.bus === 'N') {
    errors.push({ path: `${rungPath}.from`, message: '段の始点が N 母線です' });
  }
  if (to.kind === 'bus' && to.bus === 'P') {
    errors.push({ path: `${rungPath}.to`, message: '段の終点が P 母線です' });
  }
  if (nodeKey(from) === nodeKey(to)) {
    errors.push({ path: rungPath, message: `段の始点と終点が同じ節点です: ${r.id}` });
  }
  return { from, to };
}

function checkCell(cell: SchematicCell, cellPath: string, errors: DocumentError[]): void {
  const pattern = DEVICE_PATTERNS[cell.kind];
  if (pattern === undefined) {
    errors.push({ path: cellPath, message: `未知の要素種別です: ${String(cell.kind)}` });
  } else if (!pattern.test(cell.device)) {
    errors.push({
      path: cellPath,
      message: `${CELL_KIND_LABELS[cell.kind]} に使えない機器名です: ${cell.device}`,
    });
  }
  if (cell.kind === 'coil' && cell.device.startsWith('T')) {
    if (cell.presetMs === undefined) {
      errors.push({
        path: cellPath,
        message: `タイマコイルには presetMs が必要です: ${cell.device}`,
      });
    } else if (
      !Number.isInteger(cell.presetMs) ||
      cell.presetMs < TIMER_MIN_PRESET_MS ||
      cell.presetMs > TIMER_RANGE_60S.maxMs
    ) {
      errors.push({
        path: `${cellPath}.presetMs`,
        message: `タイマの設定時間は ${TIMER_MIN_PRESET_MS}〜${TIMER_RANGE_60S.maxMs}ms の整数です: ${cell.presetMs}`,
      });
    }
  } else if (cell.presetMs !== undefined) {
    errors.push({
      path: cellPath,
      message: `presetMs を持てるのはタイマコイルだけです: ${cell.id}`,
    });
  }
}

function checkRung(
  doc: SchematicDocument,
  r: Rung,
  rungPath: string,
  cellIds: Set<string>,
  errors: DocumentError[],
): void {
  if (r.cells.length === 0) {
    errors.push({ path: rungPath, message: `段に要素がありません: ${r.id}` });
  }
  const before = errors.length;
  checkEnd(doc, r, r.from, `${rungPath}.from`, errors);
  checkEnd(doc, r, r.to, `${rungPath}.to`, errors);
  const ends = errors.length === before ? checkResolvedEnds(doc, r, rungPath, errors) : undefined;

  let loadCount = 0;
  r.cells.forEach((cell, ci) => {
    const cellPath = `${rungPath}.cells[${ci}]`;
    if (cellIds.has(cell.id)) {
      errors.push({ path: cellPath, message: `要素IDが重複しています: ${cell.id}` });
    }
    cellIds.add(cell.id);
    checkCell(cell, cellPath, errors);
    if (isLoadCell(cell)) loadCount += 1;
  });

  if (loadCount > 1) {
    errors.push({ path: rungPath, message: `1つの段に負荷は1つだけです: ${r.id}` });
  }
  if (ends === undefined) return;
  // 負荷の規則も**解決後**の終点で見る（参照でP-N間に届く段は普通の段と同じ扱い）
  const endsAtN = ends.to.kind === 'bus' && ends.to.bus === 'N';
  const last = r.cells[r.cells.length - 1];
  if (endsAtN && (last === undefined || !isLoadCell(last))) {
    errors.push({
      path: rungPath,
      message: `右母線(N)に至る段は負荷（コイル／ランプ／ブザー）で終わる必要があります: ${r.id}`,
    });
  }
  if (!endsAtN && loadCount > 0) {
    errors.push({
      path: rungPath,
      message: `分岐段（右母線に至らない段）に負荷は置けません: ${r.id}`,
    });
  }
}

/**
 * 文書の構造エラーを列挙する（zodは使わない。§11.1 の範囲で十分なため）。
 * 空配列なら妥当。
 */
export function validateDocument(doc: SchematicDocument): DocumentError[] {
  const errors: DocumentError[] = [];
  if (doc.formatVersion !== SCHEMATIC_FORMAT_VERSION) {
    errors.push({
      path: 'formatVersion',
      message: `未知の文書バージョンです: ${doc.formatVersion}（対応は ${SCHEMATIC_FORMAT_VERSION}）`,
    });
  }
  if (doc.orientation !== 'horizontal') {
    errors.push({ path: 'orientation', message: '文書モデルは常に横書き（左P・右N）で保持します' });
  }
  if (doc.rungs.length === 0) {
    errors.push({ path: 'rungs', message: '段が1つもありません' });
  }

  const rungIds = new Set<string>();
  const cellIds = new Set<string>();
  doc.rungs.forEach((r, ri) => {
    const rungPath = `rungs[${ri}]`;
    if (rungIds.has(r.id)) {
      errors.push({ path: rungPath, message: `段IDが重複しています: ${r.id}` });
    }
    rungIds.add(r.id);
    checkRung(doc, r, rungPath, cellIds, errors);
  });
  checkBusReachability(doc, errors);

  return errors;
}

/** 文書に現れる機器名を初出順に返す。 */
export function documentDevices(doc: SchematicDocument): string[] {
  const out: string[] = [];
  for (const r of doc.rungs) {
    for (const cell of r.cells) {
      if (!out.includes(cell.device)) out.push(cell.device);
    }
  }
  return out;
}
