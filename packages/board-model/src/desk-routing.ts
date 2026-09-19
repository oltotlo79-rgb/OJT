import type { TerminalId, WireColor } from '@ojt/circuit-sim';
import {
  BOARD_WIDTH_MM,
  CHANNEL_LANE_COUNT,
  CHANNEL_LANE_DIRECTION,
  CHANNEL_LANE_PITCH_MM,
  findBoardTerminal,
  OUTLET_ID,
  PLC_PART_ID,
  runZ,
  type BoardDefinition,
  type BoardTerminal,
  type PlcUnitDefinition,
  type WiringChannel,
} from './board-jipm.js';
import { polylineLength, vec3, type Rect, type Vec3 } from './geometry.js';
import {
  coverOpenReachMm,
  coverOpenRiseMm,
  OUTLET_ORIGIN_MM,
  plcCoverAt,
  plcFaces,
  type PlcFacePlacement,
} from './plc-unit.js';
import {
  deskWires,
  entryChannelFor,
  filletCorners,
  LEAD_OUT_STAGGER_MM,
  WIRE_DIAMETER_MM,
  type WireRoute,
} from './routing.js';
import type { BoardSession } from './session.js';

/**
 * 机上へ渡る電線の経路生成。設計仕様 §6.6 / §7 / §10.1 / §11.3。
 *
 * 盤の中の電線は配線帯（{@link WiringChannel}）を直角に走って整列している（`routing.ts`）。
 * 机上のPLC本体・壁コンセントへ渡る電線も**同じ作法**で整える、というのがこのファイルである。
 * 盤の配線帯は机上まで伸びていないので、机上には机上の「ダクト」（{@link DeskDuct}）を引く。
 *
 * 1本の経路はいつも同じ3つの区間からできている（どちらの端も同じ形なので、盤↔PLC・
 * PLC↔PLC の渡り・コンセント↔PLC のどれも1つの式で書ける）。
 *
 * 1. **引き込み**（端から幹線まで）
 *    - 盤の端子: 端子 → 盤面へ立ち下げ → 最寄りの水平配線帯の行 → その行のまま**盤の右の縁**を
 *      越えて机上へ出る。縁のところで高さを一段持ち上げる（`rise`。ゆるい乗り越え）。
 *    - PLC本体の端子: 端子 → 端子の列の**開いたカバーが空けた側**にある行ダクトまで垂直に立てる。
 *    - 壁コンセント: 端子 → コンセント板の下の行ダクト → 幹線。
 * 2. **幹線**（{@link DESK_TRUNK_GAP_MM} だけPLCの左に置いた縦のダクト）。電線1本に1レーンずつ
 *    割り当てるので、幹線の中で2本が重なることは無い。
 * 3. もう一方の**引き込み**（1と同じ形を逆向きに）。
 *
 * 並走する電線は {@link DESK_LANE_PITCH_MM}（電線の直径＋1mm）ずつ横にずらして並べる。
 * 走る向きで高さを分けてあるので（x方向は {@link DESK_RUN_X_Z_MM}、y方向は
 * {@link DESK_RUN_Y_Z_MM}）、直交する区間どうしは必ず1.8mm離れ、直径1.6mmの管でも食い込まない。
 * 角は半径 {@link DESK_CORNER_RADIUS_MM} で丸める。
 *
 * 純関数・決定論（乱数も時刻も使わない）。並び順は「行ダクト → PLC端子のx → 端子の並び順 →
 * 電線ID」で決まるので、電線を1本足しても先に引いてある電線の絵は変わらない。
 */

/** 並走する机上ケーブルの横ピッチ[mm]（電線の直径＋1mm）。 */
export const DESK_LANE_PITCH_MM = WIRE_DIAMETER_MM + 1;
/** 机上で守る最小の横間隔[mm]（{@link deskRouteIssues} が検査する）。 */
export const DESK_MIN_CLEARANCE_MM = 2;
/** 机上の曲がり角のフィレット半径[mm]。 */
export const DESK_CORNER_RADIUS_MM = 8;
/** 机上でx方向に走る区間の高さ[mm]（盤の高さのはしご 2.4〜7.8 の上）。 */
export const DESK_RUN_X_Z_MM = 9.6;
/** 机上でy方向に走る区間の高さ[mm]（x方向と1.8mm離す）。 */
export const DESK_RUN_Y_Z_MM = 11.4;
/** 盤の上を走る区間の高さ[mm]（x方向）。盤の電線の第2レイヤと同じ段。 */
export const BOARD_RUN_X_Z_MM = runZ('x', 1);
/** 盤の上を走る区間の高さ[mm]（y方向）。 */
export const BOARD_RUN_Y_Z_MM = runZ('y', 1);
/** 盤の右の縁を乗り越える位置[mm]（ここで高さを机上の段へ上げる）。 */
export const DESK_LIP_X_MM = BOARD_WIDTH_MM + 6;
/** 幹線ダクトの先頭レーンを、PLC本体の左端からどれだけ左に置くか[mm]。 */
export const DESK_TRUNK_GAP_MM = 14;
/** 上の行ダクトを、PLC本体の上端からどれだけ上に置くか[mm]。 */
export const DESK_ROW_GAP_MM = 12;
/** 下ヒンジのカバーの列へ向かう行ダクトを、カバーの上端からどれだけ上に置くか[mm]。 */
export const DESK_MID_GAP_MM = 3;
/** 壁コンセントの行ダクトを、コンセント端子からどれだけ下に置くか[mm]（板の外）。 */
export const DESK_OUTLET_GAP_MM = 16;
/**
 * 同じ列へ降りる電線どうしの横のずらし量[mm]。
 * 端子の列（ラックは2列×9段）は同じ x に何段も並ぶので、そこへ降ろす管が重ならないよう
 * 列の中で {@link DESK_MIN_CLEARANCE_MM} ずつ横にずらす。同じネジに2本載るときも同じ値で分かれる。
 */
export const DESK_SCREW_STAGGER_MM = DESK_MIN_CLEARANCE_MM;
/**
 * 列の中の横位置[mm]（0起点の順番と、その列に降りる本数 → ずらし量）。
 *
 * その列に1本しか降りないなら端子の真上をまっすぐ降ろす（0）。2本以上なら
 * `−2, +2, −4, +4, …` と外へ振り分け、**真ん中は空けておく**。ネジの直前の区間は必ず端子の
 * 真上を通るので、そこに別の電線を重ねると管が食い込むためである。
 */
export function screwStaggerMm(index: number, total: number): number {
  if (total <= 1) return 0;
  const step = Math.floor(index / 2) + 1;
  return (index % 2 === 0 ? -1 : 1) * step * DESK_SCREW_STAGGER_MM;
}
/** ネジの直前でまっすぐ降ろす長さ[mm]（列の中のずらしをここで戻す）。 */
export const DESK_SCREW_APPROACH_MM = 4;
/** 同じネジ端子に集まる区間どうしを間隔の検査から外す半径[mm]。 */
export const DESK_SCREW_MERGE_MM = 5;

const EPS = 1e-6;

/**
 * 机上のダクト（見えないガイド）。盤の {@link WiringChannel} の机上版で、
 * 「どこを通っているか」をUI・テストから読めるようにするために形を持たせてある。
 */
export interface DeskDuct {
  id: string;
  axis: 'x' | 'y';
  /** 走行軸と直交する座標[mm]（`axis: 'x'` なら y、`axis: 'y'` なら x）。 */
  at: number;
  /** 走行軸の始点[mm]。 */
  from: number;
  /** 走行軸の終点[mm]。 */
  to: number;
  /** 走行高さ[mm]。 */
  zMm: number;
}

/**
 * 机上へ渡る電線1本の経路。
 * {@link WireRoute} をそのまま満たすので、3D側は盤の電線と**同じ描画ヘルパ**に渡せる。
 */
export interface DeskRoute extends WireRoute {
  /** 電線の色（3Dはこれで塗る）。 */
  color: WireColor;
  /** 通った机上ダクトのID（通過順）。 */
  ductIds: string[];
}

/** 経路が避けるべき箱（PLCの筐体・開いた端子カバー・盤・コンセント板）。 */
export interface DeskObstacle {
  id: string;
  /** 盤モデル座標の外形（XY）。 */
  rect: Rect;
  /** 箱の下端の高さ[mm]。 */
  zLoMm: number;
  /** 箱の上端の高さ[mm]。 */
  zHiMm: number;
}

/** 直角の折れ点を積む手順。 */
type Step = { kind: 'to'; x: number; y: number; z: number } | { kind: 'rise'; z: number };

function to(x: number, y: number, z: number): Step {
  return { kind: 'to', x, y, z };
}

function rise(z: number): Step {
  return { kind: 'rise', z };
}

/**
 * 手順から直角の折れ点列を組み立てる（`routing.ts` の同名の私関数と同じ約束）。
 * 高さの変わる角には z だけ動く点を差し込むので、折れ点列は常に直角経路になる。
 */
function buildCorners(start: Vec3, steps: readonly Step[]): Vec3[] {
  const out: Vec3[] = [start];
  let x = start.x;
  let y = start.y;
  let z = start.z;
  for (const step of steps) {
    if (step.kind === 'rise') {
      if (Math.abs(step.z - z) <= EPS) continue;
      z = step.z;
      out.push(vec3(x, y, z));
      continue;
    }
    if (Math.abs(step.x - x) <= EPS && Math.abs(step.y - y) <= EPS) continue;
    if (Math.abs(step.z - z) > EPS) {
      z = step.z;
      out.push(vec3(x, y, z));
    }
    x = step.x;
    y = step.y;
    out.push(vec3(x, y, z));
  }
  return out;
}

/** 同じ点が続いたら1つにまとめる。 */
function dedupe(points: readonly Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      Math.abs(last.x - p.x) <= EPS &&
      Math.abs(last.y - p.y) <= EPS &&
      Math.abs(last.z - p.z) <= EPS
    ) {
      continue;
    }
    out.push(p);
  }
  return out;
}

/** 水平の配線帯のレーンを横にずらす量[mm]（部品の無い側へ伸ばす）。 */
function channelLaneShift(channel: WiringChannel, lane: number): number {
  return lane * CHANNEL_LANE_PITCH_MM * (CHANNEL_LANE_DIRECTION[channel.id] ?? 1);
}

/** 盤の端子から引き出す水平の配線帯（帯が無い盤でも落ちないよう、最寄りの帯に逃がす）。 */
function boardExitChannel(
  board: BoardDefinition,
  terminal: BoardTerminal,
): WiringChannel | undefined {
  const found = entryChannelFor(board, terminal);
  if (found !== undefined) return found;
  const horizontal = board.wiringChannels.filter((c) => c.axis === 'x');
  return horizontal.reduce<WiringChannel | undefined>(
    (best, c) =>
      best === undefined || Math.abs(c.at - terminal.pos.y) < Math.abs(best.at - terminal.pos.y)
        ? c
        : best,
    undefined,
  );
}

/** 端子が机上のどの装置に属するか。 */
type EndKind = 'board' | 'plc' | 'outlet';

function endKindOf(id: TerminalId): EndKind {
  if (String(id).startsWith(`${OUTLET_ID}.`)) return 'outlet';
  return String(id).startsWith(`${PLC_PART_ID}.`) ? 'plc' : 'board';
}

/**
 * PLCの端子へ立てる行ダクトの y[mm]。§10.1 / 決定表#16
 *
 * 端子カバーは**開いた状態**で描く（`three/appearance.ts` の `coverOpenPose()`）。
 * 上ヒンジのカバーは盤面より**奥**（z < 0）へ倒れるので、その列は本体の上から降ろして入れる。
 * 下ヒンジのカバーは**手前**（z > 0）へ倒れて本体の下をふさぐので、その列は上（本体の中ほど、
 * カバーの上端のすぐ上）から入れる。どちらも「カバーが空けた側」から端子に入る。
 */
function plcRowBaseY(unit: PlcUnitDefinition, terminal: BoardTerminal): number {
  const hit = plcCoverAt(unit, terminal.pos);
  if (hit !== undefined && hit.cover.hinge === 'bottom') {
    return hit.face.origin.y + hit.cover.rect.y - DESK_MID_GAP_MM;
  }
  return unit.pos.y - DESK_ROW_GAP_MM;
}

/** その端子が使う行ダクトの種類（上ヒンジの列は本体の上、下ヒンジの列は本体の中ほど）。 */
function plcRowKind(unit: PlcUnitDefinition, terminal: BoardTerminal): 'top' | 'mid' {
  return plcCoverAt(unit, terminal.pos)?.cover.hinge === 'bottom' ? 'mid' : 'top';
}

/** 机上のダクトの骨組み（UI・テストが「どこを通す設計か」を読むためのもの）。 */
export function deskDucts(board: BoardDefinition, unit: PlcUnitDefinition): DeskDuct[] {
  const rows = new Map<number, string>();
  for (const terminal of unit.terminals) {
    const y = plcRowBaseY(unit, terminal);
    if (!rows.has(y)) rows.set(y, plcRowKind(unit, terminal));
  }
  const ducts: DeskDuct[] = [];
  for (const [at, kind] of [...rows].sort((a, b) => a[0] - b[0])) {
    ducts.push({
      id: kind === 'mid' ? 'desk-row-mid' : 'desk-row-top',
      axis: 'x',
      at,
      from: unit.pos.x - DESK_TRUNK_GAP_MM,
      to: unit.pos.x + unit.sizeMm.width,
      zMm: DESK_RUN_X_Z_MM,
    });
  }
  ducts.push({
    id: 'desk-trunk',
    axis: 'y',
    at: unit.pos.x - DESK_TRUNK_GAP_MM,
    from: unit.pos.y - DESK_ROW_GAP_MM,
    to: OUTLET_ORIGIN_MM.y + DESK_OUTLET_GAP_MM,
    zMm: DESK_RUN_Y_Z_MM,
  });
  ducts.push({
    id: 'desk-outlet-row',
    axis: 'x',
    at: OUTLET_ORIGIN_MM.y + DESK_OUTLET_GAP_MM,
    from: unit.pos.x - DESK_TRUNK_GAP_MM,
    to: OUTLET_ORIGIN_MM.x,
    zMm: DESK_RUN_X_Z_MM,
  });
  for (const channel of board.wiringChannels) {
    if (channel.axis !== 'x') continue;
    ducts.push({
      id: `desk-exit-${channel.id}`,
      axis: 'x',
      at: channel.at,
      from: Math.max(channel.from, channel.to),
      to: DESK_LIP_X_MM,
      zMm: BOARD_RUN_X_Z_MM,
    });
  }
  return ducts;
}

/** 1本の電線の、片端ぶんの引き込み。 */
interface Approach {
  /** 端子から幹線までの折れ点（最後の点は幹線の上）。 */
  corners: Vec3[];
  /** 幹線に乗る y[mm]。 */
  trunkY: number;
  /** 通ったダクト・配線帯のID。 */
  ductIds: string[];
  channelIds: string[];
}

/** 経路を組み立てるのに要る、電線1本ぶんの割り当て。 */
interface Assignment {
  wireId: string;
  color: WireColor;
  from: BoardTerminal;
  to: BoardTerminal;
  fromKind: EndKind;
  toKind: EndKind;
  /** 幹線のレーン（0起点。0がいちばんPLC寄り）。 */
  lane: number;
  /** 盤の配線帯のレーン（帯ごとに数えて、8本で一周する）。 */
  channelLane: number;
  /** 行ダクトのレーン（端ごと）。 */
  fromRowLane: number;
  toRowLane: number;
  /** 同じネジ端子に載る電線どうしのずらし量[mm]（端ごと）。 */
  fromScrew: number;
  toScrew: number;
  /** 配線帯のレーンが一周したか（UIが警告できる）。 */
  laneOverflow: boolean;
}

function trunkXOf(unit: PlcUnitDefinition, lane: number): number {
  return unit.pos.x - DESK_TRUNK_GAP_MM - lane * DESK_LANE_PITCH_MM;
}

/** 盤の端子からの引き込み（配線帯の行に乗って、盤の右の縁を越える）。 */
function boardApproach(
  board: BoardDefinition,
  unit: PlcUnitDefinition,
  terminal: BoardTerminal,
  assignment: Assignment,
): Approach {
  const channel = boardExitChannel(board, terminal);
  const trunkX = trunkXOf(unit, assignment.lane);
  if (channel === undefined) {
    // 配線帯の無い盤（試験用の最小の盤など）。まっすぐ縁まで出て机上の高さへ上げる
    const corners = buildCorners(terminal.pos, [
      to(DESK_LIP_X_MM, terminal.pos.y, BOARD_RUN_X_Z_MM),
      rise(DESK_RUN_X_Z_MM),
      to(trunkX, terminal.pos.y, DESK_RUN_X_Z_MM),
      rise(DESK_RUN_Y_Z_MM),
    ]);
    return { corners, trunkY: terminal.pos.y, ductIds: [], channelIds: [] };
  }
  const rowY = channel.at + channelLaneShift(channel, assignment.channelLane);
  const leadX =
    terminal.pos.x + (assignment.channelLane - (CHANNEL_LANE_COUNT - 1) / 2) * LEAD_OUT_STAGGER_MM;
  const corners = buildCorners(terminal.pos, [
    // 端子 → 盤面へ立ち下げ（レーンごとに横をずらして、同じネジから出る線を重ねない）
    to(leadX, terminal.pos.y, BOARD_RUN_X_Z_MM),
    // 配線帯の行へ引き出す
    to(leadX, rowY, BOARD_RUN_Y_Z_MM),
    // 行のまま盤の右の縁まで走る
    to(DESK_LIP_X_MM, rowY, BOARD_RUN_X_Z_MM),
    // 縁をゆるく乗り越えて机上の高さへ
    rise(DESK_RUN_X_Z_MM),
    to(trunkX, rowY, DESK_RUN_X_Z_MM),
    rise(DESK_RUN_Y_Z_MM),
  ]);
  return {
    corners,
    trunkY: rowY,
    ductIds: [`desk-exit-${channel.id}`],
    channelIds: [channel.id],
  };
}

/** PLC本体の端子への引き込み（行ダクトから端子のネジへ垂直に降ろす）。 */
function plcApproach(
  unit: PlcUnitDefinition,
  terminal: BoardTerminal,
  assignment: Assignment,
  rowLane: number,
  screw: number,
): Approach {
  const trunkX = trunkXOf(unit, assignment.lane);
  const kind = plcRowKind(unit, terminal);
  const rowY = plcRowBaseY(unit, terminal) - rowLane * DESK_LANE_PITCH_MM;
  const dropX = terminal.pos.x + screw;
  const corners = buildCorners(terminal.pos, [
    // ネジへは必ずまっすぐ降ろす（最後の数mmは列のずらしを戻した真上から入る）
    to(terminal.pos.x, terminal.pos.y - DESK_SCREW_APPROACH_MM, DESK_RUN_Y_Z_MM),
    // 列の中の自分の位置へ寄る（同じ列に何本降ろしても管が重ならない）
    to(dropX, terminal.pos.y - DESK_SCREW_APPROACH_MM, DESK_RUN_X_Z_MM),
    // 端子の列 → 行ダクト（開いたカバーが空けた側をまっすぐ立てる）
    to(dropX, rowY, DESK_RUN_Y_Z_MM),
    // 行ダクト → 幹線
    to(trunkX, rowY, DESK_RUN_X_Z_MM),
    rise(DESK_RUN_Y_Z_MM),
  ]);
  return {
    corners,
    trunkY: rowY,
    ductIds: [kind === 'mid' ? 'desk-row-mid' : 'desk-row-top'],
    channelIds: [],
  };
}

/** 壁コンセントからの引き込み（コンセント板の下の行ダクトを通って幹線へ）。 */
function outletApproach(
  unit: PlcUnitDefinition,
  terminal: BoardTerminal,
  assignment: Assignment,
  rowLane: number,
): Approach {
  const trunkX = trunkXOf(unit, assignment.lane);
  const rowY = OUTLET_ORIGIN_MM.y + DESK_OUTLET_GAP_MM + rowLane * DESK_LANE_PITCH_MM;
  const corners = buildCorners(terminal.pos, [
    to(terminal.pos.x, rowY, DESK_RUN_Y_Z_MM),
    to(trunkX, rowY, DESK_RUN_X_Z_MM),
    rise(DESK_RUN_Y_Z_MM),
  ]);
  return { corners, trunkY: rowY, ductIds: ['desk-outlet-row'], channelIds: [] };
}

function approachFor(
  board: BoardDefinition,
  unit: PlcUnitDefinition,
  terminal: BoardTerminal,
  kind: EndKind,
  assignment: Assignment,
  rowLane: number,
  screw: number,
): Approach {
  if (kind === 'board') return boardApproach(board, unit, terminal, assignment);
  if (kind === 'outlet') return outletApproach(unit, terminal, assignment, rowLane);
  return plcApproach(unit, terminal, assignment, rowLane, screw);
}

/** 並び順を決める鍵（行ダクト → PLC端子のx → 端子の並び順 → 電線ID）。 */
function sortKeyOf(
  unit: PlcUnitDefinition,
  anchor: BoardTerminal,
  pair: string,
): [number, number, number, string] {
  const index = unit.terminals.findIndex((t) => t.id === anchor.id);
  const duct = plcRowKind(unit, anchor) === 'mid' ? 1 : 0;
  return [duct, anchor.pos.x, index < 0 ? 0 : index, pair];
}

function compareKeys(
  a: [number, number, number, string],
  b: [number, number, number, string],
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (a[2] !== b[2]) return a[2] - b[2];
  return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
}

/**
 * 机上へ渡る電線の経路をまとめて求める。§10.1 / §11.3
 *
 * `deskWires()` が選んだ電線（盤の経路器が受け持たないもの）だけを扱う。盤にもPLCにも無い
 * 端子（未割当の役割など）の電線は `deskWires()` の時点で落ちているので、ここでは必ず引ける。
 *
 * @param board `withPlcUnit()` 済みの盤定義。
 * @param session 盤セッション。
 * @param unit 机上のPLC本体（省略時は `board.plcUnit`）。PLCの載っていない盤では空配列を返す。
 */
export function deskRoutes(
  board: BoardDefinition,
  session: BoardSession,
  unit: PlcUnitDefinition | undefined = board.plcUnit,
): DeskRoute[] {
  if (unit === undefined) return [];
  const colors = new Map<string, WireColor>(session.wires.map((w) => [w.id, w.color]));
  const fallbackColor = session.allowedColors[0] ?? '青';

  // 1. 電線を集め、PLC側の端子（無ければコンセント側）を並び順の錨にする
  const entries = deskWires(board, session).flatMap((wire) => {
    const from = findBoardTerminal(board, wire.from);
    const to = findBoardTerminal(board, wire.to);
    /* c8 ignore next -- `deskWires()` が盤に無い端子の電線を既に落としている */
    if (from === undefined || to === undefined) return [];
    const fromKind = endKindOf(wire.from);
    const toKind = endKindOf(wire.to);
    const anchor = toKind === 'plc' ? to : fromKind === 'plc' ? from : to;
    return [
      {
        wireId: wire.id,
        color: colors.get(wire.id) ?? fallbackColor,
        from,
        to,
        fromKind,
        toKind,
        key: sortKeyOf(unit, anchor, [String(wire.from), String(wire.to)].sort().join('|')),
      },
    ];
  });
  entries.sort((a, b) => compareKeys(a.key, b.key));

  // 2. レーンを配る。幹線は1本1レーン、行ダクトはダクトごとに詰める
  const rowLanes = new Map<string, number>();
  const channelLanes = new Map<string, number>();
  const columnSeen = new Map<string, number>();
  const columnTotal = new Map<string, number>();
  /**
   * 端子が降りてくる「列」の鍵。同じ x に何段も並ぶ端子（ラックの2列×9段）をまとめる。
   * 行ダクトも鍵に入れる — 一体形は入力側と出力側で**同じ x** の端子が向かい合うが、
   * 別々の行ダクトから降りてくるので、列としては別物である（重ならない）。
   */
  const columnKey = (terminal: BoardTerminal, kind: EndKind): string =>
    `${kind === 'outlet' ? 'outlet' : plcRowKind(unit, terminal)}:${Math.round(terminal.pos.x * 10)}`;
  for (const entry of entries) {
    for (const [terminal, kind] of [
      [entry.from, entry.fromKind],
      [entry.to, entry.toKind],
    ] as const) {
      if (kind === 'board') continue;
      const key = columnKey(terminal, kind);
      columnTotal.set(key, (columnTotal.get(key) ?? 0) + 1);
    }
  }
  const rowLaneOf = (terminal: BoardTerminal, kind: EndKind): number => {
    const duct = kind === 'outlet' ? 'outlet' : plcRowKind(unit, terminal);
    const next = rowLanes.get(duct) ?? 0;
    rowLanes.set(duct, next + 1);
    return next;
  };
  const screwOf = (terminal: BoardTerminal, kind: EndKind): number => {
    if (kind === 'board') return 0;
    const key = columnKey(terminal, kind);
    const total = columnTotal.get(key) ?? 1;
    const index = columnSeen.get(key) ?? 0;
    columnSeen.set(key, index + 1);
    return screwStaggerMm(index, total);
  };
  /** 盤の配線帯のレーン。帯ごとに数えるので、帯が違えば同じ番号を使い回してよい。 */
  const channelLaneOf = (terminal: BoardTerminal): { lane: number; overflow: boolean } => {
    const channel = boardExitChannel(board, terminal);
    const id = channel?.id ?? '';
    const index = channelLanes.get(id) ?? 0;
    channelLanes.set(id, index + 1);
    return { lane: index % CHANNEL_LANE_COUNT, overflow: index >= CHANNEL_LANE_COUNT };
  };

  // 3. 経路を組み立てる
  const routes: DeskRoute[] = [];
  entries.forEach((entry, lane) => {
    const boardEnd =
      entry.fromKind === 'board' ? entry.from : entry.toKind === 'board' ? entry.to : undefined;
    const channel = boardEnd === undefined ? undefined : channelLaneOf(boardEnd);
    const assignment: Assignment = {
      wireId: entry.wireId,
      color: entry.color,
      from: entry.from,
      to: entry.to,
      fromKind: entry.fromKind,
      toKind: entry.toKind,
      lane,
      channelLane: channel?.lane ?? 0,
      fromRowLane: 0,
      toRowLane: 0,
      fromScrew: 0,
      toScrew: 0,
      laneOverflow: channel?.overflow ?? false,
    };
    const fromRowLane = entry.fromKind === 'board' ? 0 : rowLaneOf(entry.from, entry.fromKind);
    const toRowLane = entry.toKind === 'board' ? 0 : rowLaneOf(entry.to, entry.toKind);
    const head = approachFor(
      board,
      unit,
      entry.from,
      entry.fromKind,
      assignment,
      fromRowLane,
      screwOf(entry.from, entry.fromKind),
    );
    const tail = approachFor(
      board,
      unit,
      entry.to,
      entry.toKind,
      assignment,
      toRowLane,
      screwOf(entry.to, entry.toKind),
    );
    const corners = dedupe([...head.corners, ...[...tail.corners].reverse()]);
    const points = filletCorners(corners, DESK_CORNER_RADIUS_MM);
    routes.push({
      wireId: entry.wireId,
      kind: 'channel',
      color: entry.color,
      points,
      corners,
      channelIds: [...new Set([...head.channelIds, ...tail.channelIds])],
      ductIds: [...new Set([...head.ductIds, 'desk-trunk', ...tail.ductIds])],
      lanes: [],
      lane,
      laneOverflow: assignment.laneOverflow,
      lengthMm: polylineLength(points),
    });
  });
  return routes;
}

/**
 * 経路が避ける箱（PLCの筐体・開いた端子カバー・盤・コンセント板）。§10.1 / 決定表#16
 *
 * 筐体・コンセント板・盤は端子の面（z = 0）より**奥**にあるので、机上の電線（z ≥ 6mm）は
 * 素通りできる。気をつけるのは**下ヒンジの端子カバー**だけで、これは開くと手前（z > 0）へ
 * 倒れて本体の下をふさぐ。そこでその列へは本体の中ほどから入れる（{@link plcRowBaseY}）。
 */
export function deskObstacles(board: BoardDefinition, unit: PlcUnitDefinition): DeskObstacle[] {
  const out: DeskObstacle[] = [
    {
      id: 'board-plate',
      rect: { x: 0, y: 0, w: board.sizeMm.width, h: board.sizeMm.height },
      zLoMm: -board.sizeMm.depth,
      zHiMm: 0,
    },
  ];
  const faces: PlcFacePlacement[] = plcFaces(unit);
  for (const face of faces) {
    out.push({
      id: `body-${face.id}`,
      rect: {
        x: face.origin.x,
        y: face.origin.y,
        w: face.appearance.faceMm.width,
        h: face.appearance.faceMm.height,
      },
      zLoMm: -face.depthMm,
      zHiMm: 0,
    });
    for (const cover of face.appearance.covers) {
      const reach = coverOpenReachMm(cover);
      const riseMm = coverOpenRiseMm(cover);
      const left = face.origin.x + cover.rect.x;
      const top = face.origin.y + cover.rect.y;
      const rect: Rect =
        cover.hinge === 'top'
          ? { x: left, y: top - reach, w: cover.rect.w, h: reach }
          : cover.hinge === 'bottom'
            ? { x: left, y: top + cover.rect.h, w: cover.rect.w, h: reach }
            : cover.hinge === 'left'
              ? { x: left - reach, y: top, w: reach, h: cover.rect.h }
              : { x: left + cover.rect.w, y: top, w: reach, h: cover.rect.h };
      // 上・左ヒンジは奥へ、下・右ヒンジは手前へ倒れる（`coverOpenPose()` と同じ向き）
      const forward = cover.hinge === 'bottom' || cover.hinge === 'right';
      out.push({
        id: `cover-${face.id}-${cover.id}`,
        rect,
        zLoMm: forward ? 0 : -riseMm,
        zHiMm: forward ? riseMm : 0,
      });
    }
  }
  out.push({
    id: 'outlet-plate',
    rect: { x: OUTLET_ORIGIN_MM.x - 20, y: OUTLET_ORIGIN_MM.y - 14, w: 44, h: 28 },
    zLoMm: -8,
    zHiMm: 0,
  });
  return out;
}

/** 線分の外形（管の太さぶん広げた箱）。 */
interface Segment {
  routeId: string;
  a: Vec3;
  b: Vec3;
  /** 動いた軸（`z` は高さだけ変える区間）。 */
  axis: 'x' | 'y' | 'z';
}

function segmentsOf(route: DeskRoute): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < route.corners.length; i += 1) {
    const a = route.corners[i - 1];
    const b = route.corners[i];
    if (a === undefined || b === undefined) continue;
    const axis = Math.abs(b.x - a.x) > EPS ? 'x' : Math.abs(b.y - a.y) > EPS ? 'y' : ('z' as const);
    out.push({ routeId: route.wireId, a, b, axis });
  }
  return out;
}

function span(a: number, b: number): { lo: number; hi: number } {
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

function overlaps(a: { lo: number; hi: number }, b: { lo: number; hi: number }): boolean {
  return a.lo <= b.hi - EPS && b.lo <= a.hi - EPS;
}

/** 区間の中点が、どれかの共有端子のそばか（ネジに集まる部分は間隔の検査から外す）。 */
function nearShared(segment: Segment, shared: readonly Vec3[]): boolean {
  const mid = vec3((segment.a.x + segment.b.x) / 2, (segment.a.y + segment.b.y) / 2, 0);
  return shared.some(
    (p) => Math.hypot(mid.x - p.x, mid.y - p.y) <= DESK_SCREW_MERGE_MM + DESK_SCREW_STAGGER_MM,
  );
}

/**
 * 机上の経路の検査。§6.6 の不変条件の机上版。
 * - 並走する区間（同じ向き・同じ高さ）は {@link DESK_MIN_CLEARANCE_MM} 以上離れている。
 * - どの区間も {@link deskObstacles} の箱の中を通らない。
 * 破れていれば人に読める理由を返す（空配列なら合格）。
 */
export function deskRouteIssues(
  routes: readonly DeskRoute[],
  board: BoardDefinition,
  unit: PlcUnitDefinition,
): string[] {
  const issues: string[] = [];
  const obstacles = deskObstacles(board, unit);
  const ends = new Map<string, Vec3[]>();
  for (const route of routes) {
    const first = route.corners[0];
    const last = route.corners[route.corners.length - 1];
    ends.set(
      route.wireId,
      [first, last].filter((p): p is Vec3 => p !== undefined),
    );
  }

  const all = routes.flatMap(segmentsOf);
  for (const segment of all) {
    for (const box of obstacles) {
      const z = span(segment.a.z, segment.b.z);
      if (!overlaps(z, { lo: box.zLoMm, hi: box.zHiMm })) continue;
      const sx = span(segment.a.x, segment.b.x);
      const sy = span(segment.a.y, segment.b.y);
      if (!overlaps(sx, { lo: box.rect.x, hi: box.rect.x + box.rect.w })) continue;
      if (!overlaps(sy, { lo: box.rect.y, hi: box.rect.y + box.rect.h })) continue;
      issues.push(`経路が${box.id}の中を通ります: ${segment.routeId}`);
    }
  }
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      if (a === undefined || b === undefined) continue;
      if (a.routeId === b.routeId) continue;
      if (a.axis !== b.axis || a.axis === 'z') continue;
      if (Math.abs(a.a.z - b.a.z) > EPS) continue;
      const along = a.axis === 'x' ? 'x' : 'y';
      const across = a.axis === 'x' ? 'y' : 'x';
      if (!overlaps(span(a.a[along], a.b[along]), span(b.a[along], b.b[along]))) continue;
      const gap = Math.abs(a.a[across] - b.a[across]);
      if (gap >= DESK_MIN_CLEARANCE_MM - EPS) continue;
      const shared = (ends.get(a.routeId) ?? []).filter((p) =>
        (ends.get(b.routeId) ?? []).some(
          (q) => Math.abs(p.x - q.x) <= EPS && Math.abs(p.y - q.y) <= EPS,
        ),
      );
      if (shared.length > 0 && nearShared(a, shared) && nearShared(b, shared)) continue;
      issues.push(`並走する区間が近すぎます（${gap.toFixed(2)}mm）: ${a.routeId} / ${b.routeId}`);
    }
  }
  return issues;
}
