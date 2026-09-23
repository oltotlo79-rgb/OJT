import {
  isBoardProfile,
  findTimerRange,
  JIPM_BOARD,
  MOUNTABLE_KINDS,
  SOCKET_IDS,
  toPhysicalTerminal,
  validateSocketRoles,
  type BoardDefinition,
  type BoardSession,
} from '@ojt/board-model';
import type { TerminalId, WireColor } from '@ojt/circuit-sim';
import {
  PlcIoSchema,
  MAX_DEVICE_COMMENTS as DEVICE_COMMENT_COUNT_LIMIT,
  MAX_DEVICE_COMMENT_LENGTH as DEVICE_COMMENT_LIMIT,
} from '@ojt/content';
import {
  DRAFT_SYMBOLS,
  IR_COLS,
  MAX_ROWS,
  MAX_NETWORKS,
  SPECIAL_INDEXES,
  type LadderProgram,
} from '@ojt/ladder-core';
import {
  CELL_KIND_LABELS,
  SCHEMATIC_FORMAT_VERSION,
  type SchematicDocument,
} from '@ojt/schematic-core';
export const MAX_RESTORED_WIRES = 200;
const WIRE_COLOR_SET = { 青: true, 白: true, 黄: true } satisfies Record<WireColor, true>;

export function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function isRungEnd(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value['bus'] === 'P' ||
      value['bus'] === 'N' ||
      (typeof value['rung'] === 'string' &&
        finiteNonnegative(value['node']) &&
        Number.isInteger(value['node'])))
  );
}
/** Structural validation only: a valid unfinished exercise remains saveable. */
export function isSessionShape(value: unknown): value is BoardSession {
  if (
    !isRecord(value) ||
    typeof value['boardId'] !== 'string' ||
    !isRecord(value['socketRoles']) ||
    validateSocketRoles(value['socketRoles']).length > 0 ||
    !isRecord(value['mounted'])
  )
    return false;
  if (value['plcAssignment'] !== undefined) {
    const assignment = PlcIoSchema.safeParse(value['plcAssignment']);
    if (
      !assignment.success ||
      assignment.data.mode !== 'free' ||
      assignment.data.inputs === undefined ||
      assignment.data.outputs === undefined
    )
      return false;
  }
  if (!Array.isArray(value['allowedColors']) || !value['allowedColors'].every(isWireColor))
    return false;
  if (
    !Array.isArray(value['extraParts']) ||
    !value['extraParts'].every((v: unknown) => typeof v === 'string')
  )
    return false;
  if (
    !Array.isArray(value['inventory']) ||
    !value['inventory'].every(
      (v: unknown) =>
        isRecord(v) &&
        (MOUNTABLE_KINDS as readonly unknown[]).includes(v['kind']) &&
        finiteNonnegative(v['count']) &&
        Number.isInteger(v['count']),
    )
  )
    return false;
  if (!finiteNonnegative(value['wireSeq']) || !Number.isInteger(value['wireSeq'])) return false;
  if (
    !Object.entries(value['mounted']).every(
      ([key, part]) => (SOCKET_IDS as readonly string[]).includes(key) && isMountedPart(part),
    )
  )
    return false;
  for (const key of ['wireAnnotations', 'wireRoutePreferences'] as const) {
    const metadata = value[key];
    if (metadata === undefined) continue;
    if (!isRecord(metadata) || Object.keys(metadata).length > MAX_RESTORED_WIRES) return false;
    if (
      !Object.values(metadata).every(
        (item) =>
          isRecord(item) &&
          (key === 'wireAnnotations'
            ? typeof item['label'] === 'string' &&
              item['label'].length <= 40 &&
              typeof item['note'] === 'string' &&
              item['note'].length <= 500
            : Array.isArray(item['viaChannelIds']) &&
              item['viaChannelIds'].length <= 8 &&
              item['viaChannelIds'].every(
                (id: unknown) => typeof id === 'string' && id.length <= 100,
              )),
      )
    )
      return false;
  }
  if (value['boardProfile'] !== undefined && !isBoardProfile(value['boardProfile'])) return false;
  const wires = value['wires'];
  if (!Array.isArray(wires) || wires.length > MAX_RESTORED_WIRES) return false;
  const ids = new Set<string>();
  return wires.every((wire: unknown) => {
    if (
      !isRecord(wire) ||
      typeof wire['id'] !== 'string' ||
      !wire['id'] ||
      ids.has(wire['id']) ||
      !isWireColor(wire['color']) ||
      typeof wire['from'] !== 'string' ||
      typeof wire['to'] !== 'string' ||
      !wire['from'] ||
      !wire['to'] ||
      (wire['open'] !== undefined && typeof wire['open'] !== 'boolean') ||
      (wire['locked'] !== undefined && typeof wire['locked'] !== 'boolean')
    )
      return false;
    ids.add(wire['id']);
    return true;
  });
}
export const MAX_RESTORED_RUNGS = 64;

/**
 * 作業ファイルの下書きを文書として読む。形が違えば `undefined`（下書き無しで開く）。§13 #8
 * 中身の妥当性は見ない（作りかけの下書きも復元する。決定表#3）。段と要素の形だけを確かめ、
 * 壊れていれば黙って下書き無しで開く（読込そのものは断らない）。
 */
export function toSchematicDoc(raw: unknown): SchematicDocument | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw['formatVersion'] !== SCHEMATIC_FORMAT_VERSION) return undefined;
  if (raw['orientation'] !== 'horizontal') return undefined;
  if (typeof raw['id'] !== 'string' || typeof raw['title'] !== 'string') return undefined;
  const rungs = raw['rungs'];
  if (!Array.isArray(rungs) || rungs.length > MAX_RESTORED_RUNGS) return undefined;
  for (const rung of rungs as readonly unknown[]) {
    if (
      !isRecord(rung) ||
      typeof rung['id'] !== 'string' ||
      !isRungEnd(rung['from']) ||
      !isRungEnd(rung['to'])
    )
      return undefined;
    const cells = rung['cells'];
    if (!Array.isArray(cells) || cells.length > 200) return undefined;
    for (const cell of cells as readonly unknown[]) {
      if (
        !isRecord(cell) ||
        typeof cell['id'] !== 'string' ||
        typeof cell['device'] !== 'string' ||
        typeof cell['kind'] !== 'string' ||
        !Object.hasOwn(CELL_KIND_LABELS, cell['kind']) ||
        (cell['presetMs'] !== undefined && !finiteNonnegative(cell['presetMs']))
      ) {
        return undefined;
      }
    }
  }
  return raw as unknown as SchematicDocument;
}
// --- /Plan 5 Task 6 ---

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWireColor(value: unknown): value is WireColor {
  return typeof value === 'string' && Object.hasOwn(WIRE_COLOR_SET, value);
}

/**
 * 端子IDが盤に実在するか。§6.4
 * 保存データは役割ベース（`CR1.13`）で持つので、割当表で物理端子ID（`S1.13`）に直してから照合する。
 * 形式が壊れていれば `toPhysicalTerminal()` が投げるので、その場合も「盤に無い」として扱う。
 */
function isBoardTerminal(
  roles: BoardSession['socketRoles'],
  value: unknown,
  board: BoardDefinition,
): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  let physical: TerminalId;
  try {
    physical = toPhysicalTerminal(roles, value as TerminalId);
  } catch {
    return false;
  }
  return board.terminals.some((terminal) => terminal.id === physical);
}

/** 装着状態が読めるか（種別はカタログにあるか、タイマの設定値は有限か）。§7.1 */
function isMountedPart(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const kind = value['kind'];
  if (typeof kind !== 'string') return false;
  if (!(MOUNTABLE_KINDS as readonly string[]).includes(kind)) return false;
  if (kind === 'timer-h3y4') {
    const preset = value['presetMs'],
      range = value['rangeMaxMs'];
    if (typeof preset !== 'number' || !Number.isFinite(preset) || typeof range !== 'number')
      return false;
    const timerRange = findTimerRange(range);
    if (
      timerRange === undefined ||
      preset < timerRange.stepMs ||
      preset > range ||
      preset % timerRange.stepMs !== 0
    )
      return false;
  }
  return true;
}

/**
 * 作業ファイルの `session` を `BoardSession` として読む（形が違えば undefined）。§13 #8
 *
 * 上端の形だけでなく**要素ひとつひとつ**を確かめる（1D2-a のレビュー指摘）。
 * `wires` に文字列が1つ混ざっているだけで経路器・3Dシーンが描画中に `TypeError` で落ち、
 * 例外バナーからも戻れなくなるため、盤に載せる前にここで断る。
 *
 * 名前が同じでも `@ojt/schematic-core` の `toSession(doc, board, options)`
 * （回路図 → 盤セッション。`{ ok, session, assignment } | { ok: false, errors }` を返す）とは別物。
 * このモジュールは保存した JSON を読み戻すだけで、割当も配線もしない。
 */
export function toSession(
  raw: unknown,
  board: BoardDefinition = JIPM_BOARD,
): BoardSession | undefined {
  if (!isSessionShape(raw)) return undefined;
  const source = raw;
  if (JSON.stringify(source.boardProfile) !== JSON.stringify(board.profile)) return undefined;
  if (source['boardId'] !== board.id) return undefined;
  if (source.plcAssignment !== undefined) {
    const spec = board.plcUnit?.spec;
    if (
      spec === undefined ||
      source.plcAssignment.inputs.some((input) => input.x >= spec.inputs.length) ||
      source.plcAssignment.outputs.some((output) => output.y >= spec.outputs.length)
    )
      return undefined;
  }
  if (
    Object.values(source.wireRoutePreferences ?? {}).some((route) =>
      route.viaChannelIds.some((id) => !board.wiringChannels.some((channel) => channel.id === id)),
    )
  )
    return undefined;

  // 役割割当（`socketRoles`）は電線の端子IDを物理端子へ直すのに使うので最初に確かめる
  const roles = source['socketRoles'];
  if (!isRecord(roles)) return undefined;
  if (validateSocketRoles(roles).length > 0) return undefined;
  const socketRoles = roles;

  const wires = source['wires'];
  if (!Array.isArray(wires)) return undefined;
  if (wires.length > MAX_RESTORED_WIRES) return undefined;
  for (const wire of wires) {
    if (!isRecord(wire)) return undefined;
    if (typeof wire['id'] !== 'string' || wire['id'].length === 0) return undefined;
    if (!isWireColor(wire['color'])) return undefined;
    if (!isBoardTerminal(socketRoles, wire['from'], board)) return undefined;
    if (!isBoardTerminal(socketRoles, wire['to'], board)) return undefined;
  }

  const mounted = source['mounted'];
  if (mounted !== undefined) {
    if (!isRecord(mounted)) return undefined;
    for (const [socket, part] of Object.entries(mounted)) {
      if (part === undefined) continue;
      if (!(SOCKET_IDS as readonly string[]).includes(socket)) return undefined;
      if (!isMountedPart(part)) return undefined;
    }
  }

  return source;
}

/** 作業ファイルに載せられるネットワーク数の上限（main の `MAX_WORK_FILE_NETWORKS` と同じ値）。 */
export const MAX_RESTORED_NETWORKS = MAX_NETWORKS;

/** IR のセル種別（この語彙以外は読み込まない）。§10.3 */
const CELL_KINDS = new Set([
  'contact',
  'coil',
  'timer',
  'counter',
  'mc',
  'mcr',
  'end',
  'hline',
  'vline',
  'empty',
  'draft',
]);

/**
 * デバイスとして読めるか。§10.3
 * PD-3: `kind === 'special'` のときは `SPECIAL_INDEXES`（常時ON／初期パルス／1秒クロックの3つ）
 * だけを受け入れる。`ladder-core` の `device()` はこの制約を作る側で守っているが、作業ファイルは
 * 信頼境界の外から来るので、ここで確かめずに通すと `SPECIAL_INDEXES.includes(index)` を前提に
 * 「到達しない」とコメントされたランタイムの分岐へ壊れた番号のまま届いてしまう。
 */
function isDeviceLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const kind = value['kind'];
  const index = value['index'];
  const kinds = ['input', 'output', 'internal', 'timer', 'counter', 'special'];
  if (typeof kind !== 'string' || !kinds.includes(kind)) return false;
  if (!(typeof index === 'number' && Number.isInteger(index) && index >= 0)) return false;
  if (kind === 'special' && !SPECIAL_INDEXES.includes(index)) return false;
  return true;
}

/** セルとして読めるか（`kind` ごとに要る項目だけ見る）。 */
function isCellLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const kind = value['kind'];
  if (typeof kind !== 'string' || !CELL_KINDS.has(kind)) return false;
  if (kind === 'draft')
    return (
      typeof value['symbol'] === 'string' &&
      (DRAFT_SYMBOLS as readonly string[]).includes(value['symbol'])
    );
  if (kind === 'end' || kind === 'hline' || kind === 'vline' || kind === 'empty') return true;
  if (!isDeviceLike(value['device'])) return false;
  if (kind === 'timer') {
    const preset = value['presetMs'];
    return typeof preset === 'number' && Number.isInteger(preset) && preset > 0;
  }
  if (kind === 'counter') {
    const preset = value['preset'];
    if (!(typeof preset === 'number' && Number.isInteger(preset) && preset > 0)) return false;
    return isDeviceLike(value['resetDevice']);
  }
  if (kind === 'contact') return ['NO', 'NC', 'P', 'F'].includes(String(value['type']));
  if (kind === 'coil') return ['OUT', 'SET', 'RST'].includes(String(value['type']));
  return true;
}

/** デバイスコメントとして読めるか（§10.7 の上限を守る）。 */
function isCommentsLike(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > DEVICE_COMMENT_COUNT_LIMIT) return false;
  return entries.every(
    ([key, text]) =>
      /^(X|Y|M|T|C|SP)\d+$/u.test(key) &&
      typeof text === 'string' &&
      text.length > 0 &&
      text.length <= DEVICE_COMMENT_LIMIT,
  );
}

/**
 * 作業ファイルの `ladder` を IR として読む（形が違えば undefined）。§13 #8 / 3A H-3
 *
 * `toSession()` と同じ流儀で**要素ひとつひとつ**を確かめる。壊れたセルが1つ混ざっているだけで
 * ラダーエディタも `compile()` も描画中に落ち、例外バナーからも戻れなくなるため。
 */
export function toLadderProgram(
  raw: unknown,
): { program: LadderProgram; comments: Record<string, string> } | undefined {
  if (!isRecord(raw)) return undefined;
  const networks = raw['networks'];
  if (!Array.isArray(networks)) return undefined;
  if (networks.length === 0 || networks.length > MAX_RESTORED_NETWORKS) return undefined;
  const seen = new Set<string>();
  for (const net of networks) {
    if (!isRecord(net)) return undefined;
    const id = net['id'];
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) return undefined;
    seen.add(id);
    const cells = net['cells'];
    if (!Array.isArray(cells)) return undefined;
    if (cells.length === 0 || cells.length > MAX_ROWS) return undefined;
    if (net['rows'] !== cells.length) return undefined;
    if (net['cols'] !== IR_COLS) return undefined;
    for (const row of cells) {
      if (!Array.isArray(row) || row.length !== IR_COLS) return undefined;
      if (!row.every(isCellLike)) return undefined;
    }
    const comment = net['comment'];
    if (comment !== undefined && typeof comment !== 'string') return undefined;
  }
  const comments = raw['comments'];
  if (comments !== undefined && !isCommentsLike(comments)) return undefined;
  return {
    program: { networks: networks as LadderProgram['networks'] },
    comments: comments === undefined ? {} : { ...comments },
  };
}
