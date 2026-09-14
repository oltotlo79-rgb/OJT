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
const BUS_TERMINALS: Readonly<Record<string, TerminalId>> = {
  [BUS_P_KEY]: terminalId('P', '1'),
  [BUS_N_KEY]: terminalId('N', '1'),
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
function terminalProblem(roles: SocketRoles, id: TerminalId): string | undefined {
  let found;
  try {
    found = findBoardTerminal(JIPM_BOARD, toPhysicalTerminal(roles, id));
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
      const problem = terminalProblem(roles, id);
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
      const forced = override[cell.id];
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
 */
function chainWires(nets: Nets, roles: SocketRoles, color: WireColor): Outcome<WireSpec[]> {
  const fixedCount = fixedWireCounts(roles);
  const bonds = fixedBondKeys(roles);
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

/** 設定時間が収まる最小のタイマレンジ。§5.3.2 */
function timerRangeFor(presetMs: number): TimerRange | undefined {
  return [...TIMER_RANGES].sort((a, b) => a.maxMs - b.maxMs).find((r) => r.maxMs >= presetMs);
}

/** レンジの表示名（`0〜60s`）。 */
function rangeLabel(range: TimerRange): string {
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
  const overrideErrors = checkOverride(doc, roles, override);
  if (overrideErrors.length > 0) return { ok: false, errors: overrideErrors };

  const built = buildCellAssignments(doc, override);
  if (!built.ok) return built;

  const wires = chainWires(built.value.nets, roles, options.color ?? '青');
  if (!wires.ok) return wires;

  const parts = mountedParts(roles, needed, built.value.presets);
  if (!parts.ok) return parts;

  return { ok: true, roles, parts: parts.value, cells: built.value.cells, wires: wires.value };
}
