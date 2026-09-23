import {
  CHECK_SOCKET_ROLE,
  DEFAULT_SOCKET_ROLES,
  DEFAULT_TIMER_PRESET_MS,
  findBoardTerminal,
  JIPM_BOARD,
  resolveEndpoint,
  snapPresetToStep,
  SOCKET_IDS,
  SOCKET_ROLES,
  terminalIdFor,
  TIMER_RANGES,
  toNetlistTerminal,
  toPhysicalTerminal,
  validateSocketRoles,
  type MountableKind,
  type BoardDefinition,
  type SocketId,
  type SocketRole,
  type SocketRoles,
  type TimerRange,
} from '@ojt/board-model';
import {
  MAX_WIRES_PER_TERMINAL,
  parseTerminalId,
  terminalId,
  type TerminalId,
  type WireColor,
} from '@ojt/circuit-sim';
import {
  isLoadCell,
  nodeKey,
  resolveNode,
  validateDocument,
  type Rung,
  type SchematicCell,
  type SchematicDocument,
} from './document.js';

/**
 * 回路図 → 物理割当（設計仕様 §11.3）。
 * 各 `CRn`／`Tn` の接点を出現順に組1〜組4へ1つずつ割り当てる。
 * 母線は実機どおり供給端子が `P.1` / `N.1` の1点ずつしかないので、**渡り配線**（鎖状）で分配する。
 */

/** 生成すべき電線1本。 */
export interface WireSpec {
  id: string;
  from: TerminalId;
  to: TerminalId;
  color: WireColor;
}

/** 装着すべき部品1個。 */
export interface PartAssignment {
  socket: SocketId;
  role: SocketRole;
  kind: MountableKind;
  /** タイマのときの設定時間[ms]。 */
  presetMs?: number;
  /** タイマのときのレンジ上限[ms]。 */
  rangeMaxMs?: number;
}

/** 回路図要素 → 物理端子の対応（1要素につき左右2端子）。 */
export interface CellAssignment {
  cellId: string;
  device: string;
  /** 接点のときの組番号（1〜4）。接点以外は0。§11.3 */
  group: number;
  /** P側（左）の端子。 */
  left: TerminalId;
  /** N側（右）の端子。 */
  right: TerminalId;
}

/** 割当エラー1件。 */
export interface AssignError {
  path: string;
  message: string;
}

/** 割当オプション。 */
export interface AssignOptions {
  board?: BoardDefinition;
  /** チェック回路付きの既存盤を扱う場合だけ指定。通常の回路図は配線ゼロから構成する。 */
  includeCheckWires?: boolean;
  /** ソケットの役割割当。省略すると既定の割当（8ソケットに7役割）。§6.1 */
  roles?: SocketRoles;
  /** 生成する電線の色。既定は青（モードB・D）、モードC2は白。§8.1 / §11.3 */
  color?: '青' | '白';
  /** 回路図要素IDごとの物理端子の上書き（`[左, 右]`）。§7.2 / §11.3 */
  physicalOverride?: Readonly<Record<string, readonly [TerminalId, TerminalId]>>;
}

/** 割当が成功したときの結果。 */
export interface Assignment {
  ok: true;
  roles: SocketRoles;
  parts: readonly PartAssignment[];
  cells: readonly CellAssignment[];
  wires: readonly WireSpec[];
}

/** 割当の結果。 */
export type AssignResult = Assignment | { ok: false; errors: readonly AssignError[] };

/** 内部処理の成否（失敗はすべて AssignError で返し、例外は投げない）。 */
type Outcome<T> = { ok: true; value: T } | { ok: false; errors: AssignError[] };

/** ソケットに載せられる役割の正準順（チェック用は課題側で使えない）。§6.1 */
const ASSIGNABLE_ROLES: readonly SocketRole[] = SOCKET_ROLES.filter(
  (role) => role !== CHECK_SOCKET_ROLE,
);

/** 接点1組ぶんのピン番号。 */
export interface ContactPins {
  /** COM（⑨〜⑫）。 */
  com: number;
  /** NO＝a接点側（⑤〜⑧）。 */
  no: number;
  /** NC＝b接点側（①〜④）。 */
  nc: number;
}

function pinsOfGroup(group: number): ContactPins {
  return { com: 8 + group, no: 4 + group, nc: group };
}

/** 組1〜組4のピン表。§6.2 の COM/NO/NC はそのまま組番号に対応する。 */
export const CONTACT_PINS: readonly ContactPins[] = [1, 2, 3, 4].map(pinsOfGroup);

/** コイルのピン（⑭＝+、⑬＝−）。§6.2 */
const COIL_PINS = { plus: 14, minus: 13 } as const;

/** 母線の節点キー。 */
const BUS_P_KEY = nodeKey({ kind: 'bus', bus: 'P' });
const BUS_N_KEY = nodeKey({ kind: 'bus', bus: 'N' });

/** 母線の供給端子（実機どおり1点ずつ）。§6.1 */
const BUS_P_TERMINAL = terminalId('P', '1');
const BUS_N_TERMINAL = terminalId('N', '1');
const BUS_TERMINALS: Readonly<Record<string, TerminalId>> = {
  [BUS_P_KEY]: BUS_P_TERMINAL,
  [BUS_N_KEY]: BUS_N_TERMINAL,
};

function isSocketDevice(device: string): device is SocketRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(device);
}

/** 機器名の末尾の番号（`PB3` → 3）。 */
function deviceIndex(device: string): number {
  return Number(/\d+$/.exec(device)?.[0] ?? '0');
}

/** 回路図に現れるソケット機器を正準順に返す。 */
export function requiredRoles(doc: SchematicDocument): SocketRole[] {
  const used = new Set<string>();
  for (const r of doc.rungs) {
    for (const cell of r.cells) {
      if (isSocketDevice(cell.device)) used.add(cell.device);
    }
  }
  return ASSIGNABLE_ROLES.filter((role) => used.has(role));
}

/**
 * 既定の役割割当を返す（文書の内容には依らない。必要な役割の有無は `requiredRoles` で検査する）。
 * 実物の盤はソケットを8個持ち、§6.1 の7役割（`CR1`〜`CR4` / `T1` / `T2` / `CHK`）を
 * すべて同時に載せられるので、既定の割当（`DEFAULT_SOCKET_ROLES`）で足りる。
 * 課題側で `options.roles` を渡せば §6.1 の課題1形式・課題2形式に絞ることもできる。
 * 呼び出し側が書き換えても既定値が壊れないよう、毎回新しいオブジェクトを返す。
 */
export function deriveSocketRoles(): SocketRoles {
  return { ...DEFAULT_SOCKET_ROLES };
}

/** 接点として組を消費する要素か（PBは端子台の固定端子なので組を持たない）。 */
function usesContactGroup(cell: SchematicCell): boolean {
  return !isLoadCell(cell) && cell.kind !== 'pb-a' && cell.kind !== 'pb-b';
}

/** 既定規則での左右端子。§11.3 */
function autoTerminalPair(
  cell: SchematicCell,
  group: number,
): { left: TerminalId; right: TerminalId } {
  const n = deviceIndex(cell.device);
  const role = cell.device as SocketRole;
  const pins = pinsOfGroup(group);
  switch (cell.kind) {
    case 'pb-a':
      return { left: terminalId('TB_PB', `${n}c`), right: terminalId('TB_PB', `${n}a`) };
    case 'pb-b':
      return { left: terminalId('TB_PB', `${n}c`), right: terminalId('TB_PB', `${n}b`) };
    case 'cr-a':
    case 't-a':
      return { left: terminalIdFor(role, pins.com), right: terminalIdFor(role, pins.no) };
    case 'cr-b':
    case 't-b':
      return { left: terminalIdFor(role, pins.com), right: terminalIdFor(role, pins.nc) };
    case 'coil':
      return {
        left: terminalIdFor(role, COIL_PINS.plus),
        right: terminalIdFor(role, COIL_PINS.minus),
      };
    case 'lamp':
      return { left: terminalId('TB_PL', `${n}+`), right: terminalId('TB_PL', `${n}-`) };
    case 'buzzer':
      return { left: terminalId('BZ', '+'), right: terminalId('BZ', '-') };
  }
}

/**
 * 上書きされた接点の組番号。左端子が自分の機器のCOMピン（⑨〜⑫）なら、その組を使っている。
 * §11.3 のc接点（同じ組のCOMにa接点とb接点を重ねる）を組を消費せずに表せる。
 */
function overrideGroup(cell: SchematicCell, left: TerminalId): number {
  const parsed = parseTerminalId(left);
  if (parsed.part !== cell.device) return 0;
  const pin = Number(parsed.name);
  return CONTACT_PINS.findIndex((pins) => pins.com === pin) + 1;
}

/** 上書き端子が盤にあって配線できるか。 */
function terminalProblem(
  roles: SocketRoles,
  id: TerminalId,
  board: BoardDefinition,
): string | undefined {
  let found;
  try {
    found = findBoardTerminal(board, toPhysicalTerminal(roles, id));
  } catch {
    return `盤に無い端子です: ${id}`;
  }
  if (found === undefined) return `盤に無い端子です: ${id}`;
  if (!found.wirable) return `この端子には配線できません: ${id}`;
  return undefined;
}

/** `physicalOverride` の指定そのものを検査する。§7.2 */
function checkOverride(
  doc: SchematicDocument,
  roles: SocketRoles,
  override: Readonly<Record<string, readonly [TerminalId, TerminalId]>>,
  board: BoardDefinition,
): AssignError[] {
  const errors: AssignError[] = [];
  const cellIds = new Set(doc.rungs.flatMap((r) => r.cells.map((c) => c.id)));
  for (const [cellId, pair] of Object.entries(override)) {
    if (!cellIds.has(cellId)) {
      errors.push({
        path: `physicalOverride.${cellId}`,
        message: `physicalOverride の要素IDが見つかりません: ${cellId}`,
      });
      continue;
    }
    const terminals: readonly TerminalId[] = pair;
    if (terminals.length !== 2) {
      errors.push({ path: cellId, message: `physicalOverride は端子2つを指定します: ${cellId}` });
      continue;
    }
    for (const id of terminals) {
      const problem = terminalProblem(roles, id, board);
      if (problem !== undefined) errors.push({ path: cellId, message: problem });
    }
  }
  return errors;
}

/** 1つの端子が2つの節点に現れたときの理由。 */
function sharedTerminalMessage(id: TerminalId, device: string): string {
  const reason = device.startsWith('PB')
    ? `${device} の a接点と b接点は COM を共有します`
    : `${device} の端子は1つの節点にしか置けません`;
  return `端子 ${id} が2つの節点に現れます（${reason}）`;
}

/** 節点キー → その節点に集まる端子（文書順）。 */
type Nets = Map<string, TerminalId[]>;

interface CellBuild {
  cells: CellAssignment[];
  nets: Nets;
  /** 機器名 → タイマ設定（エラー箇所を指せるよう要素IDも持つ）。 */
  presets: Map<string, { presetMs: number; cellId: string }>;
}

/** 段の節点kの節点キー。参照が解決できることは `validateDocument` が先に保証している。 */
function keyOfNode(doc: SchematicDocument, owner: Rung, index: number): string {
  const resolved = resolveNode(doc, owner, index);
  /* c8 ignore next -- 解決できない端点（参照切れ・循環）は validateDocument が先に弾く */
  if (resolved === undefined) return `${owner.id}#${index}`;
  return nodeKey(resolved);
}

/** 要素を物理端子へ割り当て、節点ごとの端子集合を作る。§11.3 */
function buildCellAssignments(
  doc: SchematicDocument,
  override: Readonly<Record<string, readonly [TerminalId, TerminalId]>>,
): Outcome<CellBuild> {
  const errors: AssignError[] = [];
  const groupUsed = new Map<string, number>();
  const build: CellBuild = { cells: [], nets: new Map(), presets: new Map() };
  const netOfTerminal = new Map<TerminalId, string>();

  const attach = (key: string, id: TerminalId, cell: SchematicCell): void => {
    const held = netOfTerminal.get(id);
    if (held !== undefined && held !== key) {
      errors.push({ path: cell.id, message: sharedTerminalMessage(id, cell.device) });
      return;
    }
    netOfTerminal.set(id, key);
    const list = build.nets.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    build.nets.set(key, list);
  };

  for (const r of doc.rungs) {
    r.cells.forEach((cell, index) => {
      // `cell.id` が `constructor` / `toString` / `__proto__` などだと素のオブジェクト参照
      // `override[cell.id]` はプロトタイプ由来の値を返してしまう（SC-01）。自前キーの
      // 有無で判定する。正規表現による ID 制限は `constructor` 等をすべて通すため無効。
      const forced = Object.hasOwn(override, cell.id) ? override[cell.id] : undefined;
      let group = 0;
      if (forced !== undefined) {
        group = overrideGroup(cell, forced[0]);
      } else if (usesContactGroup(cell)) {
        const used = groupUsed.get(cell.device) ?? 0;
        if (used >= CONTACT_PINS.length) {
          errors.push({
            path: cell.id,
            message: `${cell.device} の接点が5個目です（1つの部品の接点は${CONTACT_PINS.length}組までです）`,
          });
          return;
        }
        group = used + 1;
        groupUsed.set(cell.device, group);
      }
      const pair =
        forced === undefined
          ? autoTerminalPair(cell, group)
          : { left: forced[0], right: forced[1] };
      if (cell.kind === 'coil' && cell.presetMs !== undefined) {
        build.presets.set(cell.device, { presetMs: cell.presetMs, cellId: cell.id });
      }
      build.cells.push({ cellId: cell.id, device: cell.device, group, ...pair });
      attach(keyOfNode(doc, r, index), pair.left, cell);
      attach(keyOfNode(doc, r, index + 1), pair.right, cell);
    });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: build };
}

/** 既設の固定配線（青）が端子を使っている本数。§6.3 */
function fixedWireCounts(roles: SocketRoles): Map<TerminalId, number> {
  const used = new Map<TerminalId, number>();
  for (const fw of JIPM_BOARD.fixedWires) {
    for (const endpoint of [fw.from, fw.to]) {
      const id = toNetlistTerminal(roles, resolveEndpoint(endpoint));
      used.set(id, (used.get(id) ?? 0) + 1);
    }
  }
  return used;
}

/**
 * 既設の固定配線で直結された端子の組（`P.1`＋`TB_PB.4c` など）。§6.3
 * 同じ組の端子は電気的に同じ点なので、間に電線を張ってはいけない（張れば既設配線の重複になる）。
 */
function fixedBondKeys(roles: SocketRoles): Map<TerminalId, string> {
  const neighbors = new Map<TerminalId, TerminalId[]>();
  const link = (a: TerminalId, b: TerminalId): void => {
    neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
  };
  for (const fw of JIPM_BOARD.fixedWires) {
    const a = toNetlistTerminal(roles, resolveEndpoint(fw.from));
    const b = toNetlistTerminal(roles, resolveEndpoint(fw.to));
    link(a, b);
    link(b, a);
  }
  const keys = new Map<TerminalId, string>();
  for (const start of neighbors.keys()) {
    if (keys.has(start)) continue;
    const stack: TerminalId[] = [start];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || keys.has(current)) continue;
      keys.set(current, `bond:${start}`);
      stack.push(...(neighbors.get(current) ?? []));
    }
  }
  return keys;
}

/**
 * 既設配線の組ごとの端子（`bond:P.1` → `[P.1, TB_PB.4c]`）。§6.3
 * `bonds` は呼び出し側が `fixedBondKeys()` で1回だけ作ったものを渡すこと（SC-06）。
 */
function fixedBondGroups(bonds: ReadonlyMap<TerminalId, string>): Map<string, TerminalId[]> {
  const groups = new Map<string, TerminalId[]>();
  for (const [id, key] of bonds) {
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return groups;
}

function isBusTerminal(id: TerminalId): boolean {
  return id === BUS_P_TERMINAL || id === BUS_N_TERMINAL;
}

/** 組に母線の供給端子が入っていれば、その母線（`P` / `N`）。 */
function busOfBond(members: readonly TerminalId[]): 'P' | 'N' | undefined {
  if (members.includes(BUS_P_TERMINAL)) return 'P';
  if (members.includes(BUS_N_TERMINAL)) return 'N';
  return undefined;
}

function bondMessage(id: TerminalId, mate: TerminalId, members: readonly TerminalId[]): string {
  const bus = busOfBond(members);
  const where =
    bus === undefined ? '同じ節点にしか置けません' : `${bus} 母線以外の節点には置けません`;
  return `端子 ${id} は既設配線で ${mate} と接続されているため、${where}`;
}

/** 端子 → その端子を置いた要素ID（初出優先。エラー箇所を指すために持つ）。 */
function terminalOwners(cells: readonly CellAssignment[]): Map<TerminalId, string> {
  const owners = new Map<TerminalId, string>();
  for (const cell of cells) {
    for (const id of [cell.left, cell.right]) {
      if (!owners.has(id)) owners.set(id, cell.cellId);
    }
  }
  return owners;
}

/**
 * 端子 → その端子が居る節点キー。母線の供給端子は `chainWires` と同じく母線の節点へ差し込む。
 * 要素が供給端子そのものを指しているとき（`physicalOverride`）は要素側の節点を採る。
 * その指定は母線の鎖と要素の節点の両方に電線を呼ぶので、1端子2本の規則が別に弾く。§6.6
 */
function terminalNets(nets: Nets): Map<TerminalId, string> {
  const netOf = new Map<TerminalId, string>();
  for (const [key, terminals] of nets) {
    for (const id of terminals) netOf.set(id, key);
  }
  for (const [key, id] of Object.entries(BUS_TERMINALS)) {
    if (nets.has(key) && !netOf.has(id)) netOf.set(id, key);
  }
  return netOf;
}

/**
 * 既設配線で直結された端子の組が2つの節点に分かれていないか検査する。§6.3
 *
 * 既設配線は訓練者が外せない（`locked`）ので、組の端子はどの課題でも電気的に同じ1点のままになる。
 * たとえば `TB_PB.4c`（PB4のCOM）は `P.1` と直結なので、PB4の接点はCOMがP母線の節点にある段でしか
 * 使えない。内部節点に置くと、その節点が既設配線でP母線に短絡し、手前の接点を素通りしてしまう。
 *
 * 逆に `TB_PB.4a` の組（相方はチェック用コイルの `CHK.14`）は、相方が回路図に現れない限りどの節点にも
 * 置ける。その節点にチェック用コイルが**並列にぶら下がる**が、実機どおりの姿なので許す。§6.3
 *
 * `bonds` は呼び出し側が `fixedBondKeys()` で1回だけ作ったものを渡すこと（SC-06）。
 */
function checkFixedBonds(build: CellBuild, bonds: ReadonlyMap<TerminalId, string>): AssignError[] {
  const netOf = terminalNets(build.nets);
  const owners = terminalOwners(build.cells);
  const errors: AssignError[] = [];
  for (const members of fixedBondGroups(bonds).values()) {
    const placed = members.filter((id) => netOf.has(id));
    // 基準は母線の供給端子（動かせるのは要素の側）。母線を含まない組は最初の端子を基準にする
    const anchor = placed.find(isBusTerminal) ?? placed[0];
    if (anchor === undefined) continue;
    for (const id of placed) {
      if (netOf.get(id) === netOf.get(anchor)) continue;
      errors.push({ path: owners.get(id) ?? id, message: bondMessage(id, anchor, members) });
    }
  }
  return errors;
}

/** 鎖の1区間（既設配線で結ばれた端子は1つの区間にまとまる）。 */
interface ChainGroup {
  key: string;
  head: TerminalId;
  members: TerminalId[];
  /** その節点で受けられる残り本数（既設配線で埋まったぶんを引く）。 */
  capacity: number;
}

function groupTerminals(
  terminals: readonly TerminalId[],
  keyOf: (id: TerminalId) => string,
  freeAt: (id: TerminalId) => number,
): ChainGroup[] {
  const groups: ChainGroup[] = [];
  for (const id of terminals) {
    const key = keyOf(id);
    const found = groups.find((g) => g.key === key);
    if (found === undefined) {
      groups.push({ key, head: id, members: [id], capacity: freeAt(id) });
    } else {
      found.members.push(id);
      found.capacity += freeAt(id);
    }
  }
  return groups;
}

/** 残り1本の区間は鎖の端にしか置けない（中継点は2本使うため）。 */
function orderGroups(groups: readonly ChainGroup[]): ChainGroup[] | undefined {
  const tight = groups.filter((g) => g.capacity <= 1);
  if (tight.length > 2) return undefined;
  const [head, tail] = tight;
  if (head === undefined) return [...groups];
  const middle = groups.filter((g) => g !== head && g !== tail);
  return tail === undefined ? [head, ...middle] : [head, ...middle, tail];
}

/**
 * 節点ごとに**渡り配線**（鎖状）を作る。§11.3 / 調査資料 §4.5
 * 供給端子は実機どおり `P.1` / `N.1` の1点ずつなので、母線の節点もその端子を先頭にした鎖になる。
 *
 * 既設配線で直結された端子（`P.1`＋`TB_PB.4c` など）は1つの区間にまとめる。§6.3
 * - 区間の中には電線を張らない（既設配線の重複になる）。
 * - 区間の残り容量は**端子ごとの残り本数の合計**なので、両方が同じ節点に居れば2本ぶんの中継に使える
 *   （`X–P.1` と `TB_PB.4c–Y` のように、入る電線と出る電線で別の端子を使う）。
 * - 残り1本の区間は鎖の端にしか置けない。
 *
 * 同じ組の端子が2つの節点に分かれていないことは `checkFixedBonds` が先に保証している。
 *
 * **電線IDの契約（SC-05）**: 生成する電線の `id` は `sw-NNN`（`wires.length + 1` から作る
 * 生成順の通し番号。下の `wires.push` を参照）で、回路図の節点の並び・各節点内の端子の並びが
 * 変わればNNNも変わる。課題JSON（モードC2）の `faults[].target.wireId` はこの `sw-NNN` を
 * そのまま書いているので、**回路図（`schematic.rungs`）を1要素でも足す・消す・並び替えると、
 * 既存の `wireId` が別の電線を指すようになりうる**（IDが存在しなくなるわけではないので
 * エラーにはならず、静かに別の箇所へ故障が付け替わる）。回路図を編集したら、課題の
 * `faults[].target.wireId` を実際に生成される集合（`buildReferenceSession()` が返す
 * `session.wires` の `id`）から取り直すこと。内蔵C2課題はこの対応が壊れていないことを
 * `packages/content/test/builtin-inspect-repair.test.ts` の固定テストで縛っている。
 *
 * `fixedCount` / `bonds` は呼び出し側が `fixedWireCounts()` / `fixedBondKeys()` で1回だけ
 * 作ったものを渡すこと（SC-06。以前は `checkFixedBonds` 経由と合わせて1回の割当で3回
 * 組み直されていた）。
 */
function chainWires(
  nets: Nets,
  fixedCount: ReadonlyMap<TerminalId, number>,
  bonds: ReadonlyMap<TerminalId, string>,
  color: WireColor,
): Outcome<WireSpec[]> {
  const used = new Map<TerminalId, number>(fixedCount);
  const errors: AssignError[] = [];
  const wires: WireSpec[] = [];
  const freeAt = (id: TerminalId): number => MAX_WIRES_PER_TERMINAL - (fixedCount.get(id) ?? 0);
  const pick = (group: ChainGroup): TerminalId =>
    group.members.find((m) => (used.get(m) ?? 0) < MAX_WIRES_PER_TERMINAL) ?? group.head;

  for (const [key, terminals] of nets) {
    const bus = BUS_TERMINALS[key];
    const chain = [...new Set(bus === undefined ? terminals : [bus, ...terminals])];
    const groups = groupTerminals(chain, (id) => bonds.get(id) ?? id, freeAt);
    const ordered = orderGroups(groups);
    if (ordered === undefined) {
      const tight = groups.filter((g) => g.capacity <= 1).map((g) => g.head);
      errors.push({
        path: key,
        message: `節点に3本目の配線が要ります（既設配線で埋まった端子が3つあります）: ${tight.join(' / ')}`,
      });
      continue;
    }
    let previous: ChainGroup | undefined;
    for (const group of ordered) {
      if (previous !== undefined) {
        const from = pick(previous);
        const to = pick(group);
        wires.push({ id: `sw-${String(wires.length + 1).padStart(3, '0')}`, from, to, color });
        used.set(from, (used.get(from) ?? 0) + 1);
        used.set(to, (used.get(to) ?? 0) + 1);
      }
      previous = group;
    }
  }

  for (const [id, count] of used) {
    if (count > MAX_WIRES_PER_TERMINAL) {
      errors.push({
        path: id,
        message: `1つの端子に接続できるのは${MAX_WIRES_PER_TERMINAL}本までです: ${id}`,
      });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: wires };
}

/**
 * 設定時間が収まる最小のタイマレンジ。§5.3.2
 * `edit.ts` の `presetProblem()` も同じ規則で刻み違反を検算前に弾く（SC-03。「PRESET_STEP_MS の
 * 源を schematic-core に寄せる」の一環で、レンジ選択とレンジ表示名は1箇所からしか出さない）。
 */
export function timerRangeFor(presetMs: number): TimerRange | undefined {
  return [...TIMER_RANGES].sort((a, b) => a.maxMs - b.maxMs).find((r) => r.maxMs >= presetMs);
}

/** レンジの表示名（`0〜60s`）。 */
export function rangeLabel(range: TimerRange): string {
  return range.id.replace('-', '〜');
}

/** 装着すべき部品。タイマは設定時間からレンジを選ぶ。§5.3.2 / §11.3 */
function mountedParts(
  roles: SocketRoles,
  needed: readonly SocketRole[],
  presets: ReadonlyMap<string, { presetMs: number; cellId: string }>,
): Outcome<PartAssignment[]> {
  const parts: PartAssignment[] = [];
  const errors: AssignError[] = [];
  for (const socket of SOCKET_IDS) {
    const role = roles[socket];
    if (role === undefined || !needed.includes(role)) continue;
    if (!role.startsWith('T')) {
      parts.push({ socket, role, kind: 'relay-my4n' });
      continue;
    }
    const source = presets.get(role);
    const presetMs = source?.presetMs ?? DEFAULT_TIMER_PRESET_MS;
    const path = source?.cellId ?? role;
    const range = timerRangeFor(presetMs);
    /* c8 ignore next 4 -- validateDocument が presetMs をレンジ上限までに絞っている */
    if (range === undefined) {
      errors.push({
        path,
        message: `${role} の設定 ${presetMs}ms はどのタイマレンジにも収まりません`,
      });
      continue;
    }
    if (snapPresetToStep(presetMs, range) !== presetMs) {
      errors.push({
        path,
        message: `${role} の設定 ${presetMs}ms はレンジ ${rangeLabel(range)} の刻み ${range.stepMs}ms に合いません`,
      });
      continue;
    }
    parts.push({ socket, role, kind: 'timer-h3y4', presetMs, rangeMaxMs: range.maxMs });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: parts };
}

/**
 * 回路図を物理端子へ割り当て、生成すべき電線と装着すべき部品を返す。§11.3
 * 同じ組を2つの接点に割り当てず、5個目の接点が現れたらエラーにする。
 *
 * 割当のあと、**既設配線で直結された端子の組**が2つの節点に分かれていないかを検査する（§6.3）。
 * 既設配線は外せないので、たとえばPB4はCOM（`TB_PB.4c`）が `P.1` と直結しており、その接点は
 * COMがP母線の節点にある段でしか使えない。チェック用コイル側の `TB_PB.4a` はどの節点にも置ける
 * （チェック用コイルがその節点に並列にぶら下がるだけで、実機どおりの姿）。
 */
export function assignToBoard(doc: SchematicDocument, options: AssignOptions = {}): AssignResult {
  const structural = validateDocument(doc);
  if (structural.length > 0) return { ok: false, errors: structural };

  const roles = options.roles ?? deriveSocketRoles();
  const roleErrors = validateSocketRoles(roles).map((message) => ({ path: 'roles', message }));
  if (roleErrors.length > 0) return { ok: false, errors: roleErrors };

  const needed = requiredRoles(doc);
  const missing = needed.filter((role) => !SOCKET_IDS.some((socket) => roles[socket] === role));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: missing.map((role) => ({
        path: 'roles',
        message: `役割が盤に割り当てられていません: ${role}`,
      })),
    };
  }

  const override = options.physicalOverride ?? {};
  const board = options.board ?? JIPM_BOARD;
  const overrideErrors = checkOverride(doc, roles, override, board);
  if (overrideErrors.length > 0) return { ok: false, errors: overrideErrors };

  const built = buildCellAssignments(doc, override);
  if (!built.ok) return built;
  const missingTerminals = built.value.cells.flatMap((cell) =>
    [cell.left, cell.right].flatMap((terminal) => {
      const message = terminalProblem(roles, terminal, board);
      return message === undefined ? [] : [{ path: cell.cellId, message }];
    }),
  );
  if (missingTerminals.length > 0) return { ok: false, errors: missingTerminals };

  // SC-06: 既設配線の索引は1回の割当で使い回す（以前は checkFixedBonds／chainWires が
  // それぞれ作り直しており、正味3回組み直していた）。
  const fixedCount =
    options.includeCheckWires === true ? fixedWireCounts(roles) : new Map<TerminalId, number>();
  const bonds =
    options.includeCheckWires === true ? fixedBondKeys(roles) : new Map<TerminalId, string>();

  const bondErrors = checkFixedBonds(built.value, bonds);
  if (bondErrors.length > 0) return { ok: false, errors: bondErrors };

  const wires = chainWires(built.value.nets, fixedCount, bonds, options.color ?? '青');
  if (!wires.ok) return wires;

  const parts = mountedParts(roles, needed, built.value.presets);
  if (!parts.ok) return parts;

  return { ok: true, roles, parts: parts.value, cells: built.value.cells, wires: wires.value };
}
