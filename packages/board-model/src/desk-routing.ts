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
  plcFaces,
  type PlcFacePlacement,
} from './plc-unit.js';
import {
  deskWires,
  entryChannelFor,
  filletCorners,
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
 *    - PLC本体の端子: 端子 → 本体の上か下の行ダクトまで垂直に立てる（一体形は上半分の端子を上、
 *      下半分の端子を下から。ラック形はすべて下から）。本体の前面（表示灯の帯）は横切らず、
 *      縦走りは他の端子のネジから {@link DESK_SCREW_CLEAR_MM} 以上離す（{@link planPlcDrops}）。
 *    - 壁コンセント: 端子 → コンセント板の下の行ダクト → 幹線。
 * 2. **幹線**（{@link DESK_TRUNK_GAP_MM} だけPLCの左に置いた縦のダクト）。電線1本に1レーンずつ
 *    割り当て、レーンを使い切ったら段を上げるので、幹線の中で2本が重なることは無い。
 * 3. もう一方の**引き込み**（1と同じ形を逆向きに）。
 *
 * 並走する電線は {@link DESK_LANE_PITCH_MM}（電線の直径＋1mm）ずつ横にずらして並べる。
 * 走る向きで高さを分けてあるので（x方向は {@link DESK_RUN_X_Z_MM}、y方向は
 * {@link DESK_RUN_Y_Z_MM}）、直交する区間どうしは必ず1.8mm離れ、直径1.6mmの管でも食い込まない。
 * 角は半径 {@link DESK_CORNER_RADIUS_MM} で丸める。
 *
 * どのダクトも**レーンは有限**である（幹線は盤に載らない範囲、行ダクトは机の奥（y<0）へ
 * はみ出さない範囲、盤の配線帯は帯の幅）。レーンを使い切ったら走行高さを一段上げて
 * （{@link deskRunZ} / {@link boardExitRunZ} の「レイヤ」）2段目に載せる。盤の中の経路器
 * （`routing.ts` の `pickLane()`）と同じ考え方で、2本が同じ線上に重なることを防ぐ。§6.6
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
/**
 * 机上を走る区間の高さの段[mm]（低いほうから）。盤のはしご（`WIRE_Z_LADDER_MM`、2.4〜7.8）の
 * **上**に積んであり、x方向に走る区間は段0・2、y方向に走る区間は段1・3を使う。
 * こうすると直交する区間どうしは必ず1.8mm以上離れるので、直径1.6mmの管でも食い込まない。
 */
export const DESK_Z_LADDER_MM = [9.6, 11.4, 13.2, 15.0] as const;
/** 1本の机上ダクトが持つ高さのレイヤ数（レイヤ0＝はしごの下段、レイヤ1＝その2段上）。 */
export const DESK_LAYER_COUNT = 2;
/**
 * 走る向きとレイヤから机上の走行高さ[mm]を求める（`board-jipm.ts` の `runZ()` の机上版）。
 * はしごの段を**直に引く**ので、返る値は必ず {@link DESK_Z_LADDER_MM} の値そのものになる
 * （足し算だと 9.6 + 3.6 が 13.200000000000001 になり、段の値からずれる）。
 * レイヤがはしごの外なら、その向きのレイヤ0の高さに丸める。
 */
export function deskRunZ(axis: 'x' | 'y', layer: number): number {
  const base = axis === 'x' ? 0 : 1;
  return DESK_Z_LADDER_MM[base + layer * 2] ?? DESK_Z_LADDER_MM[base];
}
/** 机上でx方向に走る区間の高さ[mm]（レイヤ0）。 */
export const DESK_RUN_X_Z_MM = DESK_Z_LADDER_MM[0];
/** 机上でy方向に走る区間の高さ[mm]（レイヤ0。x方向と1.8mm離す）。 */
export const DESK_RUN_Y_Z_MM = DESK_Z_LADDER_MM[1];
/**
 * 盤の上を走る（＝端子から盤の縁まで出る）区間の高さの段[mm]。
 * レイヤ0は盤の電線の第2レイヤ（`runZ(軸, 1)`）、レイヤ1は机上のレイヤ0と同じ段で、
 * 盤の中の電線（レイヤ0・1）の上を通る。
 */
export const BOARD_EXIT_Z_LADDER_MM = [
  runZ('x', 1),
  runZ('y', 1),
  DESK_RUN_X_Z_MM,
  DESK_RUN_Y_Z_MM,
] as const;
/** 盤の上を走る区間が持つ高さのレイヤ数。 */
export const BOARD_EXIT_LAYER_COUNT = 2;
/** 走る向きとレイヤから盤の上の走行高さ[mm]を求める。 */
export function boardExitRunZ(axis: 'x' | 'y', layer: number): number {
  const base = axis === 'x' ? 0 : 1;
  return BOARD_EXIT_Z_LADDER_MM[base + layer * 2] ?? BOARD_EXIT_Z_LADDER_MM[base];
}
/** 盤の上を走る区間の高さ[mm]（x方向。レイヤ0）。盤の電線の第2レイヤと同じ段。 */
export const BOARD_RUN_X_Z_MM = BOARD_EXIT_Z_LADDER_MM[0];
/** 盤の上を走る区間の高さ[mm]（y方向。レイヤ0）。 */
export const BOARD_RUN_Y_Z_MM = BOARD_EXIT_Z_LADDER_MM[1];
/** 盤の右の縁を乗り越える位置[mm]（ここで高さを机上の段へ上げる）。 */
export const DESK_LIP_X_MM = BOARD_WIDTH_MM + 6;
/** 幹線ダクトの先頭レーンを、PLC本体の左端からどれだけ左に置くか[mm]。 */
export const DESK_TRUNK_GAP_MM = 14;
/**
 * 上の行ダクトを、PLC本体の上端からどれだけ上に置くか[mm]。
 *
 * この行ダクトのレーンは本体から**遠ざかる向き**（机の奥。y の小さいほう）へ増えるので、
 * ダクトの線と机の奥端（y = 0）のあいだがレーンの置き場になる。既定の本体位置（y = 18mm）で
 * {@link DESK_ROW_LANE_MAX} の半分以上のレーンが入るよう、本体のすぐ上に寄せてある。
 */
export const DESK_ROW_GAP_MM = 5;
/** 壁コンセントの行ダクトを、コンセント端子からどれだけ下に置くか[mm]（板の外）。 */
export const DESK_OUTLET_GAP_MM = 16;
/**
 * 同じネジへ降りる電線どうしの横のずらし量[mm]（{@link DESK_MIN_CLEARANCE_MM} と同じ）。
 * 同じネジに2本載るときは、この間隔で中央そろえにして降ろす。
 */
export const DESK_SCREW_STAGGER_MM = DESK_MIN_CLEARANCE_MM;
/**
 * 電線の中心線と、その電線が載らない端子のネジの中心との最小距離[mm]。
 * これより近いと、正面から見て電線が他の端子に重なって見える（2026-09-26 利用者報告
 * 「Pからの配線がNの端子と重なって表示する」）。一体形の千鳥配置（ピッチ9mm・半ピッチ4.5mm）の
 * 内側の列へ2本降ろしても（±1mm）守れる値にしてある。
 */
export const DESK_SCREW_CLEAR_MM = 3;
/** ネジの直前でまっすぐ降ろす長さ[mm]（列の中のずらしをここで戻す）。 */
export const DESK_SCREW_APPROACH_MM = 4;
/** 同じネジ端子に集まる区間どうしを間隔の検査から外す半径[mm]。 */
export const DESK_SCREW_MERGE_MM = 5;
/** 1本の行ダクトに並べるレーンの本数の上限（盤の配線帯と同じ本数にそろえる）。 */
export const DESK_ROW_LANE_MAX = CHANNEL_LANE_COUNT;

const EPS = 1e-6;

/** 開いた端子カバーの板厚の半分[mm]（3Dの `COVER_THICKNESS_MM` 1mm の半分）。 */
const COVER_PLATE_HALF_MM = 0.5;

/** リレーソケットの物理端子（`S1.5` など）。 */
const SOCKET_TERMINAL_RE = /^S\d+\./u;

/** 電源のP・N端子（縦に並ぶので横へ逃がしてから下ろす）。 */
const SUPPLY_TERMINAL_RE = /^(P|N)\./u;
/** P・N端子から横へ逃がす距離[mm]（盤の中の経路器 `routing.ts` と同じ12mm）。 */
export const SUPPLY_EXIT_MM = 12;
/** 横へ逃がすときの高さ[mm]（盤の中の経路器と同じ。ネジ頭の上を越える）。 */
export const SUPPLY_EXIT_Z_MM = 10;

/**
 * 幹線に並べられるレーンの本数。
 * レーンはPLC本体から左へ伸びていくので、**盤の上**（x < {@link BOARD_WIDTH_MM}）に載らない
 * 本数で打ち切る（載せると机上のケーブルが盤の中の配線と重なって見える）。
 */
export function deskTrunkLaneCount(unit: PlcUnitDefinition): number {
  const room = unit.pos.x - DESK_TRUNK_GAP_MM - BOARD_WIDTH_MM;
  return Math.max(1, Math.floor(room / DESK_LANE_PITCH_MM) + 1);
}

/**
 * 1本の行ダクトに並べられるレーンの本数。
 * @param baseY ダクトの線の y[mm]（レーン0の位置）。
 * @param direction レーンが増える向き（−1: 机の奥へ、+1: 机の手前へ）。
 *
 * 奥へ増えるダクトは机の奥端（y = 0）を越えない本数に収める。手前へ増えるダクト
 * （コンセントの行）は盤の外へ出ないので上限だけを掛ける。
 */
export function deskRowLaneCount(baseY: number, direction: 1 | -1): number {
  if (direction > 0) return DESK_ROW_LANE_MAX;
  return Math.max(1, Math.min(DESK_ROW_LANE_MAX, Math.floor(baseY / DESK_LANE_PITCH_MM) + 1));
}

/**
 * 引き出し・レーンの割当（レーンを使い切ったら走行高さを一段上げる）。§6.6
 * `routing.ts` の `slotAt()` と同じ考え方で、レーン → レイヤの順に埋める。
 */
function slotAt(
  index: number,
  laneCount: number,
  layerCount: number,
): { lane: number; layer: number; overflow: boolean } {
  const cycle = Math.floor(index / laneCount);
  return {
    lane: index % laneCount,
    layer: cycle % layerCount,
    overflow: cycle >= layerCount,
  };
}

/**
 * 端子から机上へ引き出すときの横のずらし量[mm]。§6.6 / BM-01
 *
 * 引き出しの縦走りは端子から配線帯の行まで（最大28mm）続くので、**同じ列から机上へ出る
 * 電線の実数**で中央そろえする（1本なら0、2本なら ±{@link DESK_MIN_CLEARANCE_MM}/2）。
 * レーン番号（0〜7）でずらすと、2本しか出ていなくても隣り合うレーンの差（0.6mm）しか
 * 開かず、直径1.6mmの管が食い込んで2本が1本に見えてしまう。
 */
export function leadOutStaggerMm(index: number, total: number): number {
  if (total <= 1) return 0;
  return (index - (total - 1) / 2) * DESK_MIN_CLEARANCE_MM;
}

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
 * 机上のダクトの中で1本の電線が占めた場所（{@link deskRouteIssues} が検査する）。
 * 幹線は `desk-trunk` の1つ、行ダクトは端ごとに1つ持つ。
 */
export interface DeskLaneSlot {
  /** ダクトのID。 */
  ductId: string;
  /** ダクトの中の横位置（0起点。ダクトの線から離れる向きへ {@link DESK_LANE_PITCH_MM} ずつ）。 */
  lane: number;
  /** 走行高さの段（0起点。高さは {@link deskRunZ}）。 */
  layer: number;
  /** ダクトの走行軸と直交する実際の座標[mm]（幹線は x、行ダクトは y）。 */
  atMm: number;
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
  /** 机上のダクトの中で占めた場所（通過順。幹線を含む）。 */
  slots: DeskLaneSlot[];
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

/** PLC本体のどちら側の行ダクトから端子へ入るか。 */
type PlcSide = 'top' | 'bottom';

/**
 * その端子へ入る側。§10.1 / 決定表#16（2026-09-26 改訂）
 *
 * - 一体形（FX5U・CP1E）は本体の**上半分**の端子を上の行ダクトから、**下半分**の端子を下の
 *   行ダクトから入れる（実機でも入力の列は上のダクト、出力の列は下のダクトへ配線する）。
 *   以前は下段へ本体の中ほど（表示灯の帯）を横切って入れていたため、電線が本体を貫いて見えた
 *   （2026-09-26 利用者報告「配線がシーケンサの部分を貫通する」）。
 * - ラック形は端子台が縦に長く、上から入れると上端の表示灯の帯を電線が覆う。実機と同じく
 *   入出力モジュールは**下の行ダクト**から入れる（表示灯の無い電源部だけ上から）。
 */
function plcSideOf(unit: PlcUnitDefinition, terminal: BoardTerminal): PlcSide {
  if (unit.form === 'rack') {
    // 入出力の表示灯を持たないモジュール（電源部）の端子だけは上から入れる（上端の帯に表示灯が
    // 無いので覆うものが無い）。下の行ダクトは盤から出てくる電線の行に挟まれて本数に限りがある
    const module = unit.modules?.find(
      (m) => terminal.pos.x >= m.pos.x && terminal.pos.x <= m.pos.x + m.sizeMm.width,
    );
    const hasPointLeds =
      module?.appearance.leds.some((led) => led.group === 'input' || led.group === 'output') ??
      true;
    return hasPointLeds ? 'bottom' : 'top';
  }
  return terminal.pos.y < unit.pos.y + unit.sizeMm.height / 2 ? 'top' : 'bottom';
}

/** 下の行ダクトに最低限ほしいレーンの本数（これより狭い隙間は使わない）。 */
const DESK_BOTTOM_MIN_LANES = 5;

/**
 * 行ダクトの線の y[mm]（レーン0の位置）と、手前へ並べられるレーンの本数。
 *
 * 上は本体のすぐ上（レーンは机の奥へ増える）。下は本体のすぐ下から探し始め、
 * **盤から机上へ出てくる電線の行**（盤の水平配線帯の y ＋ そのレーン）と重ならない隙間に置く。
 * 盤から出た電線は幹線まで横へ走るので、同じ y に下の行ダクトを置くと、幹線の手前で2本が
 * 重なって1本に見えてしまう。
 */
function plcSideBand(
  board: BoardDefinition,
  unit: PlcUnitDefinition,
  side: PlcSide,
): { baseY: number; lanes: number } {
  if (side === 'top') {
    const baseY = unit.pos.y - DESK_ROW_GAP_MM;
    return { baseY, lanes: deskRowLaneCount(baseY, -1) };
  }
  // 寝かせた下のカバーの上（z 0.5mm以下）を机上の高さ（9.6mm以上）で越えるので、板は避けなくてよい
  const start = unit.pos.y + unit.sizeMm.height + DESK_ROW_GAP_MM;
  const exits = board.wiringChannels
    .filter((channel) => channel.axis === 'x')
    .map((channel) => {
      const end = channel.at + channelLaneShift(channel, CHANNEL_LANE_COUNT - 1);
      return {
        lo: Math.min(channel.at, end) - DESK_MIN_CLEARANCE_MM,
        hi: Math.max(channel.at, end) + DESK_MIN_CLEARANCE_MM,
      };
    })
    .sort((a, b) => a.lo - b.lo);
  const need = (DESK_BOTTOM_MIN_LANES - 1) * DESK_LANE_PITCH_MM;
  let baseY = start;
  for (const band of exits) {
    if (band.hi <= baseY) continue;
    if (band.lo >= baseY + need) break;
    baseY = Math.max(baseY, band.hi);
  }
  const next = exits.find((band) => band.lo >= baseY);
  const room = next === undefined ? Number.POSITIVE_INFINITY : next.lo - baseY;
  const lanes = Math.max(
    1,
    Math.min(DESK_ROW_LANE_MAX, Math.floor(room / DESK_LANE_PITCH_MM + EPS) + 1),
  );
  return { baseY, lanes };
}

/** 行ダクトの線の y[mm]（レーン0の位置）。 */
function plcSideBaseY(board: BoardDefinition, unit: PlcUnitDefinition, side: PlcSide): number {
  return plcSideBand(board, unit, side).baseY;
}

/** 行ダクトのID。 */
function plcSideDuctId(side: PlcSide): string {
  return side === 'top' ? 'desk-row-top' : 'desk-row-bottom';
}

/** 机上のダクトの骨組み（UI・テストが「どこを通す設計か」を読むためのもの）。 */
export function deskDucts(board: BoardDefinition, unit: PlcUnitDefinition): DeskDuct[] {
  const sides = new Set(unit.terminals.map((terminal) => plcSideOf(unit, terminal)));
  const ducts: DeskDuct[] = [];
  for (const side of (['top', 'bottom'] as const).filter((s) => sides.has(s))) {
    const at = plcSideBaseY(board, unit, side);
    ducts.push({
      id: plcSideDuctId(side),
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
  /** この端が行ダクトで占めた場所（盤側の端は持たない）。 */
  slots: DeskLaneSlot[];
}

/** 幹線のレーン割当（電線1本につき1つ）。 */
interface TrunkSlot {
  lane: number;
  layer: number;
  /** レーンの x[mm]。 */
  xMm: number;
  /** 幹線を走る高さ[mm]。 */
  zMm: number;
  overflow: boolean;
}

/** 行ダクトのレーン割当（端1つにつき1つ）。 */
interface RowSlot {
  ductId: string;
  lane: number;
  layer: number;
  /** レーンの y[mm]。 */
  yMm: number;
  /** 行ダクトを走る高さ[mm]。 */
  zMm: number;
  /** 行ダクトのある向き（−1: 本体の上、+1: 本体の下・コンセントの下）。 */
  side: -1 | 1;
  overflow: boolean;
}

/** 盤の配線帯のレーン割当（盤側の端を持つ電線だけ）。 */
interface ChannelSlot {
  lane: number;
  layer: number;
  /** 端子から引き出すときの横のずらし量[mm]。 */
  leadMm: number;
  overflow: boolean;
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
  trunk: TrunkSlot;
  /** 盤の配線帯のレーン（盤側の端がある電線だけ）。 */
  channel: ChannelSlot | undefined;
  /** どこかのダクトでレーンを使い切り、他の電線と同じ場所に載った（UIが警告できる）。 */
  laneOverflow: boolean;
}

/** 幹線のレーンを割り当てる（盤の上に載らない本数で一巡し、一巡したら高さを一段上げる）。 */
function trunkSlotAt(unit: PlcUnitDefinition, index: number): TrunkSlot {
  const slot = slotAt(index, deskTrunkLaneCount(unit), DESK_LAYER_COUNT);
  return {
    ...slot,
    xMm: unit.pos.x - DESK_TRUNK_GAP_MM - slot.lane * DESK_LANE_PITCH_MM,
    zMm: deskRunZ('y', slot.layer),
  };
}

/** 盤の端子からの引き込み（配線帯の行に乗って、盤の右の縁を越える）。 */
function boardApproach(
  board: BoardDefinition,
  terminal: BoardTerminal,
  assignment: Assignment,
): Approach {
  const channel = boardExitChannel(board, terminal);
  const trunkX = assignment.trunk.xMm;
  const slot = assignment.channel;
  const layer = slot?.layer ?? 0;
  const runX = boardExitRunZ('x', layer);
  const runY = boardExitRunZ('y', layer);
  // 盤を出てからの走行高さ。帯のレーンが一巡した電線は机上でも一段上を走る
  const deskX = deskRunZ('x', layer);
  if (channel === undefined || slot === undefined) {
    // 配線帯の無い盤（試験用の最小の盤など）。まっすぐ縁まで出て机上の高さへ上げる
    const corners = buildCorners(terminal.pos, [
      to(DESK_LIP_X_MM, terminal.pos.y, runX),
      rise(deskX),
      to(trunkX, terminal.pos.y, deskX),
      rise(assignment.trunk.zMm),
    ]);
    return { corners, trunkY: terminal.pos.y, ductIds: [], channelIds: [], slots: [] };
  }
  const rowY = channel.at + channelLaneShift(channel, slot.lane);
  /*
   * 電源のP・N端子は縦に並んでいる（Pの真下にN）。真下へ下ろすとPの電線がNのネジの上を
   * 通るので、盤の中の経路器（`routing.ts` の `supplyExit`）と同じく左へ逃がしてから下ろす
   * （2026-09-26 利用者報告「Pからの配線がNの端子と重なって表示する」）。
   */
  const supply = SUPPLY_TERMINAL_RE.test(String(terminal.id));
  const leadX = terminal.pos.x + slot.leadMm - (supply ? SUPPLY_EXIT_MM : 0);
  const corners = buildCorners(terminal.pos, [
    ...(supply ? [to(leadX, terminal.pos.y, SUPPLY_EXIT_Z_MM)] : []),
    // 端子 → 盤面へ立ち下げ（同じ列から出る電線どうしは中央そろえで横にずらす）
    to(leadX, terminal.pos.y, runX),
    // 配線帯の行へ引き出す
    to(leadX, rowY, runY),
    // 行のまま盤の右の縁まで走る
    to(DESK_LIP_X_MM, rowY, runX),
    // 縁をゆるく乗り越えて机上の高さへ（帯の段は机上の段へそのまま引き継ぐ）
    rise(deskX),
    to(trunkX, rowY, deskX),
    rise(assignment.trunk.zMm),
  ]);
  return {
    corners,
    trunkY: rowY,
    ductIds: [`desk-exit-${channel.id}`],
    channelIds: [channel.id],
    slots: [],
  };
}

/**
 * PLC本体の端子への引き込み（行ダクトから端子のネジへ垂直に降ろす）。
 * @param dropX 行ダクトから降ろす縦走りの x[mm]（{@link planPlcDrops} が他のネジを避けて決める）。
 */
function plcApproach(
  terminal: BoardTerminal,
  assignment: Assignment,
  row: RowSlot,
  dropX: number,
): Approach {
  const trunkX = assignment.trunk.xMm;
  const approachY = terminal.pos.y + row.side * DESK_SCREW_APPROACH_MM;
  const corners = buildCorners(terminal.pos, [
    // ネジへは必ずまっすぐ降ろす（最後の数mmは縦走りのずらしを戻した真上から入る）
    to(terminal.pos.x, approachY, DESK_RUN_Y_Z_MM),
    // 縦走りの位置へ寄る（他のネジの上を通らず、同じ列の電線どうしも重ならない）
    to(dropX, approachY, DESK_RUN_X_Z_MM),
    // 端子の列 → 行ダクト（上半分は本体の上へ、下半分は本体の下へ立てる）
    to(dropX, row.yMm, DESK_RUN_Y_Z_MM),
    // 行ダクト → 幹線
    to(trunkX, row.yMm, row.zMm),
    rise(assignment.trunk.zMm),
  ]);
  return {
    corners,
    trunkY: row.yMm,
    ductIds: [row.ductId],
    channelIds: [],
    slots: [{ ductId: row.ductId, lane: row.lane, layer: row.layer, atMm: row.yMm }],
  };
}

/** 壁コンセントからの引き込み（コンセント板の下の行ダクトを通って幹線へ）。 */
function outletApproach(terminal: BoardTerminal, assignment: Assignment, row: RowSlot): Approach {
  const trunkX = assignment.trunk.xMm;
  const corners = buildCorners(terminal.pos, [
    to(terminal.pos.x, row.yMm, DESK_RUN_Y_Z_MM),
    to(trunkX, row.yMm, row.zMm),
    rise(assignment.trunk.zMm),
  ]);
  return {
    corners,
    trunkY: row.yMm,
    ductIds: [row.ductId],
    channelIds: [],
    slots: [{ ductId: row.ductId, lane: row.lane, layer: row.layer, atMm: row.yMm }],
  };
}

function approachFor(
  board: BoardDefinition,
  terminal: BoardTerminal,
  kind: EndKind,
  assignment: Assignment,
  row: RowSlot,
  dropX: number,
): Approach {
  if (kind === 'board') return boardApproach(board, terminal, assignment);
  if (kind === 'outlet') return outletApproach(terminal, assignment, row);
  return plcApproach(terminal, assignment, row, dropX);
}

/** 並び順を決める鍵（行ダクト → PLC端子のx → 端子の並び順 → 電線ID）。 */
function sortKeyOf(
  unit: PlcUnitDefinition,
  anchor: BoardTerminal,
  pair: string,
): [number, number, number, string] {
  const index = unit.terminals.findIndex((t) => t.id === anchor.id);
  const duct = plcSideOf(unit, anchor) === 'bottom' ? 1 : 0;
  return [duct, anchor.pos.x, index < 0 ? 0 : index, pair];
}

/** 縦走りを決めるPLC側の端1つ。 */
interface PlcDropEnd {
  /** `${電線の並び順}:${from|to}`。 */
  key: string;
  terminal: BoardTerminal;
  /** 行ダクトのレーンの y[mm]（縦走りの始まり）。 */
  rowY: number;
  /** 行ダクトのある向き（−1: 本体の上、+1: 本体の下）。 */
  side: -1 | 1;
}

/** 決まった縦走り1本（他の縦走りとの間隔の検査に使う）。 */
interface PlacedRun {
  x: number;
  yLo: number;
  yHi: number;
}

/** 点と区間（平面）の距離[mm]。 */
function pointSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = Math.max(Math.min(a.x, b.x) - p.x, 0, p.x - Math.max(a.x, b.x));
  const dy = Math.max(Math.min(a.y, b.y) - p.y, 0, p.y - Math.max(a.y, b.y));
  return Math.hypot(dx, dy);
}

/** 縦走りの横位置の候補[mm]（0, −0.5, +0.5, −1, +1, … ±12）。小さいずらしから試す。 */
const DROP_OFFSETS_MM: readonly number[] = [
  0,
  ...Array.from({ length: 24 }, (_unused, i) => (i + 1) * 0.5).flatMap((d) => [-d, d]),
];

/**
 * PLC端子へ降ろす縦走りの x を決める。§6.6 / 2026-09-26 利用者報告
 *
 * 縦走りは**自分の端子以外のネジから {@link DESK_SCREW_CLEAR_MM} 以上**離し（電線が他の端子に
 * 重なって見えない）、**ほかの縦走りから {@link DESK_MIN_CLEARANCE_MM} 以上**離す（管が食い込まない）。
 * 行ダクトに近い端子から順に決めるので、ダクトに近い端子ほど真上（ずらし0）から入り、遠い端子は
 * 手前の端子のネジを避けて外側を通る（ラックの縦長の端子台で、同じ列の他のネジを踏まない）。
 * 同じネジへ2本降ろすときは、2本を {@link DESK_MIN_CLEARANCE_MM} 離して中央そろえにする。
 * どの候補も条件を満たさないときは、ネジからの離れがいちばん大きい候補にして `overflow` を立てる。
 */
function planPlcDrops(
  unit: PlcUnitDefinition,
  ends: readonly PlcDropEnd[],
): { dropX: Map<string, number>; overflow: Set<string> } {
  const dropX = new Map<string, number>();
  const overflow = new Set<string>();
  const bundles = new Map<string, PlcDropEnd[]>();
  for (const end of ends) {
    const id = String(end.terminal.id);
    bundles.set(id, [...(bundles.get(id) ?? []), end]);
  }
  const reachOf = (bundle: readonly PlcDropEnd[]): number => {
    const head = bundle[0];
    /* c8 ignore next -- 束は必ず1本以上を持つ */
    if (head === undefined) return 0;
    return Math.abs(head.terminal.pos.y - head.rowY);
  };
  const ordered = [...bundles.values()].sort((a, b) => {
    const d = reachOf(a) - reachOf(b);
    if (Math.abs(d) > EPS) return d;
    return (a[0]?.terminal.pos.x ?? 0) - (b[0]?.terminal.pos.x ?? 0);
  });
  const runs: PlacedRun[] = [];
  const jogs: Array<{ y: number; xLo: number; xHi: number }> = [];
  for (const bundle of ordered) {
    const first = bundle[0];
    /* c8 ignore next -- 束は必ず1本以上を持つ */
    if (first === undefined) continue;
    const terminal = first.terminal;
    const approachY = terminal.pos.y + first.side * DESK_SCREW_APPROACH_MM;
    const others = unit.terminals.filter((u) => u.id !== terminal.id);
    const xOf = (base: number, i: number): number =>
      terminal.pos.x + base + (i - (bundle.length - 1) / 2) * DESK_MIN_CLEARANCE_MM;
    let best: { base: number; clearance: number } | undefined;
    let chosen: number | undefined;
    for (const base of DROP_OFFSETS_MM) {
      let ok = true;
      let clearance = Number.POSITIVE_INFINITY;
      bundle.forEach((end, i) => {
        const x = xOf(base, i);
        const runA = { x, y: end.rowY };
        const runB = { x, y: approachY };
        const jogB = { x: terminal.pos.x, y: approachY };
        for (const u of others) {
          const d = Math.min(
            pointSegmentDistance(u.pos, runA, runB),
            pointSegmentDistance(u.pos, runB, jogB),
          );
          clearance = Math.min(clearance, d);
          if (d < DESK_SCREW_CLEAR_MM - EPS) ok = false;
        }
        const yLo = Math.min(end.rowY, approachY);
        const yHi = Math.max(end.rowY, approachY);
        for (const r of runs) {
          if (r.yHi < yLo - EPS || yHi < r.yLo - EPS) continue;
          if (Math.abs(r.x - x) < DESK_MIN_CLEARANCE_MM - EPS) ok = false;
        }
        const xLo = Math.min(x, terminal.pos.x);
        const xHi = Math.max(x, terminal.pos.x);
        for (const j of jogs) {
          if (Math.abs(j.y - approachY) >= DESK_MIN_CLEARANCE_MM - EPS) continue;
          if (j.xHi - j.xLo < EPS || xHi - xLo < EPS) continue;
          if (j.xHi < xLo + EPS || xHi < j.xLo + EPS) continue;
          ok = false;
        }
      });
      if (ok) {
        chosen = base;
        break;
      }
      if (best === undefined || clearance > best.clearance + EPS) best = { base, clearance };
    }
    const base = chosen ?? best?.base ?? 0;
    bundle.forEach((end, i) => {
      const x = xOf(base, i);
      dropX.set(end.key, x);
      if (chosen === undefined) overflow.add(end.key);
      runs.push({ x, yLo: Math.min(end.rowY, approachY), yHi: Math.max(end.rowY, approachY) });
      jogs.push({
        y: approachY,
        xLo: Math.min(x, terminal.pos.x),
        xHi: Math.max(x, terminal.pos.x),
      });
    });
  }
  return { dropX, overflow };
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
  const leadSeen = new Map<string, number>();
  const leadTotal = new Map<string, number>();
  /**
   * 盤の端子が机上へ引き出す「列」の鍵（帯 ＋ 端子の x）。
   * 引き出しの縦走りは同じ帯・同じ x の端子どうしでしか並走しないので、ずらし量は
   * この列の実数で決める（{@link leadOutStaggerMm}）。
   */
  const leadKey = (terminal: BoardTerminal): string =>
    `${boardExitChannel(board, terminal)?.id ?? ''}:${Math.round(terminal.pos.x * 10)}`;
  for (const entry of entries) {
    for (const [terminal, kind] of [
      [entry.from, entry.fromKind],
      [entry.to, entry.toKind],
    ] as const) {
      if (kind !== 'board') continue;
      const key = leadKey(terminal);
      leadTotal.set(key, (leadTotal.get(key) ?? 0) + 1);
    }
  }
  const rowSlotOf = (terminal: BoardTerminal, kind: EndKind): RowSlot => {
    const outlet = kind === 'outlet';
    const plcSide = plcSideOf(unit, terminal);
    const duct = outlet ? 'outlet' : plcSide;
    const ductId = outlet ? 'desk-outlet-row' : plcSideDuctId(plcSide);
    // コンセントの行と本体の下の行は机の手前（y の大きいほう）へ、上の行は机の奥へレーンが増える
    const direction: -1 | 1 = outlet || plcSide === 'bottom' ? 1 : -1;
    const band = outlet
      ? {
          baseY: OUTLET_ORIGIN_MM.y + DESK_OUTLET_GAP_MM,
          lanes: deskRowLaneCount(OUTLET_ORIGIN_MM.y + DESK_OUTLET_GAP_MM, 1),
        }
      : plcSideBand(board, unit, plcSide);
    const baseY = band.baseY;
    const index = rowLanes.get(duct) ?? 0;
    rowLanes.set(duct, index + 1);
    const slot = slotAt(index, band.lanes, DESK_LAYER_COUNT);
    return {
      ...slot,
      ductId,
      yMm: baseY + direction * slot.lane * DESK_LANE_PITCH_MM,
      zMm: deskRunZ('x', slot.layer),
      side: direction,
    };
  };
  /** 盤の配線帯のレーン。帯ごとに数えるので、帯が違えば同じ番号を使い回してよい。 */
  const channelSlotOf = (terminal: BoardTerminal): ChannelSlot => {
    const id = boardExitChannel(board, terminal)?.id ?? '';
    const index = channelLanes.get(id) ?? 0;
    channelLanes.set(id, index + 1);
    const slot = slotAt(index, CHANNEL_LANE_COUNT, BOARD_EXIT_LAYER_COUNT);
    const key = leadKey(terminal);
    const leadIndex = leadSeen.get(key) ?? 0;
    leadSeen.set(key, leadIndex + 1);
    return { ...slot, leadMm: leadOutStaggerMm(leadIndex, leadTotal.get(key) ?? 1) };
  };

  // 3. 行ダクトのレーンを配り、PLC端子へ降ろす縦走りの位置を決める
  const emptyRow: RowSlot = {
    ductId: '',
    lane: 0,
    layer: 0,
    yMm: 0,
    zMm: DESK_RUN_X_Z_MM,
    side: -1,
    overflow: false,
  };
  const rows = entries.map((entry) => ({
    from: entry.fromKind === 'board' ? emptyRow : rowSlotOf(entry.from, entry.fromKind),
    to: entry.toKind === 'board' ? emptyRow : rowSlotOf(entry.to, entry.toKind),
  }));
  const dropEnds: PlcDropEnd[] = [];
  entries.forEach((entry, index) => {
    for (const end of ['from', 'to'] as const) {
      const kind = end === 'from' ? entry.fromKind : entry.toKind;
      const row = rows[index]?.[end];
      if (kind !== 'plc' || row === undefined) continue;
      dropEnds.push({
        key: `${String(index)}:${end}`,
        terminal: end === 'from' ? entry.from : entry.to,
        rowY: row.yMm,
        side: row.side,
      });
    }
  });
  const drops = planPlcDrops(unit, dropEnds);

  // 4. 経路を組み立てる
  const routes: DeskRoute[] = [];
  entries.forEach((entry, index) => {
    const boardEnd =
      entry.fromKind === 'board' ? entry.from : entry.toKind === 'board' ? entry.to : undefined;
    const channel = boardEnd === undefined ? undefined : channelSlotOf(boardEnd);
    const trunk = trunkSlotAt(unit, index);
    const fromRow = rows[index]?.from ?? emptyRow;
    const toRow = rows[index]?.to ?? emptyRow;
    const fromKey = `${String(index)}:from`;
    const toKey = `${String(index)}:to`;
    const assignment: Assignment = {
      wireId: entry.wireId,
      color: entry.color,
      from: entry.from,
      to: entry.to,
      fromKind: entry.fromKind,
      toKind: entry.toKind,
      trunk,
      channel,
      laneOverflow:
        (channel?.overflow ?? false) ||
        trunk.overflow ||
        fromRow.overflow ||
        toRow.overflow ||
        drops.overflow.has(fromKey) ||
        drops.overflow.has(toKey),
    };
    const head = approachFor(
      board,
      entry.from,
      entry.fromKind,
      assignment,
      fromRow,
      drops.dropX.get(fromKey) ?? entry.from.pos.x,
    );
    const tail = approachFor(
      board,
      entry.to,
      entry.toKind,
      assignment,
      toRow,
      drops.dropX.get(toKey) ?? entry.to.pos.x,
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
      slots: [
        ...head.slots,
        { ductId: 'desk-trunk', lane: trunk.lane, layer: trunk.layer, atMm: trunk.xMm },
        ...tail.slots,
      ],
      lanes: [],
      lane: trunk.lane,
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
 * 素通りできる。端子カバーは180°まで開いて本体の外に板厚ぶんで寝る（ラックは取り外し）ので、
 * 机上の電線の高さには届かない（決定表#16 の改訂 2026-09-26）。
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
      // 取り外した状態のカバー（ラックのモジュール）は3Dに描かないので、避ける箱も無い
      if (cover.open === 'removed') continue;
      const reach = coverOpenReachMm(cover);
      // 180°で寝かせた板は蝶番の高さ（z = 0）に板厚ぶん載るだけ。`sin` の丸め誤差で
      // 0 にならないので、板厚の半分（`COVER_PLATE_HALF_MM`）を下限にする
      const riseMm = Math.max(coverOpenRiseMm(cover), COVER_PLATE_HALF_MM);
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
      // どの蝶番も手前（z > 0）へ倒して開く（`coverOpenPose()` と同じ向き）。180°まで開いた板は
      // 蝶番の高さを中心に板厚ぶんの厚みを持って寝る
      out.push({
        id: `cover-${face.id}-${cover.id}`,
        rect,
        zLoMm: -COVER_PLATE_HALF_MM,
        zHiMm: riseMm,
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
 * - 1つのダクトの同じレーン・同じ段に2本が載っていない。
 * - 幹線のレーンが盤の上（x < {@link BOARD_WIDTH_MM}）に載っていない。
 * - 行ダクトのレーンが机の奥（y < 0）へはみ出していない。
 * 破れていれば人に読める理由を返す（空配列なら合格）。
 */
export function deskRouteIssues(
  routes: readonly DeskRoute[],
  board: BoardDefinition,
  unit: PlcUnitDefinition,
): string[] {
  const issues: string[] = [];
  const obstacles = deskObstacles(board, unit);
  const taken = new Map<string, string>();
  for (const route of routes) {
    for (const slot of route.slots) {
      const key = `${slot.ductId}/${String(slot.lane)}/${String(slot.layer)}`;
      const owner = taken.get(key);
      if (owner !== undefined && owner !== route.wireId) {
        issues.push(
          `同じレーンに2本載っています（${slot.ductId} レーン${String(slot.lane)}・段${String(slot.layer)}）: ${owner} / ${route.wireId}`,
        );
      } else {
        taken.set(key, route.wireId);
      }
      if (slot.ductId === 'desk-trunk' && slot.atMm < BOARD_WIDTH_MM - EPS) {
        issues.push(`幹線が盤の上に載っています（x=${slot.atMm.toFixed(1)}mm）: ${route.wireId}`);
      }
      if (slot.ductId !== 'desk-trunk' && slot.atMm < -EPS) {
        issues.push(
          `行ダクトが机の奥へはみ出しています（y=${slot.atMm.toFixed(1)}mm）: ${route.wireId}`,
        );
      }
    }
  }
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
  issues.push(...screwOverlapIssues(routes, board), ...faceCrossingIssues(all, unit));
  return issues;
}

/**
 * 電線が、自分の載らない端子のネジの上を通っていないか（2026-09-26 利用者報告
 * 「Pからの配線がNの端子と重なって表示する」）。高さに関係なく平面上の距離で見る
 * （正面から見ると高さの差は分からないため）。
 */
function screwOverlapIssues(routes: readonly DeskRoute[], board: BoardDefinition): string[] {
  const issues: string[] = [];
  for (const route of routes) {
    const first = route.corners[0];
    const last = route.corners[route.corners.length - 1];
    const own = (p: Vec3): boolean =>
      [first, last].some(
        (end) => end !== undefined && Math.abs(end.x - p.x) <= EPS && Math.abs(end.y - p.y) <= EPS,
      );
    for (const segment of segmentsOf(route)) {
      if (segment.axis === 'z') continue;
      for (const terminal of board.terminals) {
        // 配線できない端子（電源の内部端子・押ボタン本体など）は盤の中に隠れていて見えない。
        // リレーソケットは内側の段（⑤〜⑧・⑨〜⑫）の電線が外側の段のネジの間を抜ける作りで、
        // 盤の中の経路器と同じ引き出し方をしているので、ここでは数えない
        if (
          !terminal.wirable ||
          own(terminal.pos) ||
          SOCKET_TERMINAL_RE.test(String(terminal.id))
        ) {
          continue;
        }
        const d = pointSegmentDistance(terminal.pos, segment.a, segment.b);
        if (d >= DESK_SCREW_CLEAR_MM - EPS) continue;
        issues.push(
          `電線が端子${String(terminal.id)}のネジの上を通ります（${d.toFixed(2)}mm）: ${route.wireId}`,
        );
      }
    }
  }
  return issues;
}

/**
 * 横へ走る区間が、PLC本体の前面のうち端子台以外（表示灯の帯・銘板・造作）を横切っていないか
 * （2026-09-26 利用者報告「配線がシーケンサの部分を貫通する」）。端子台の範囲はカバーの矩形
 * （取り外したカバーも含む）で表す。
 */
function faceCrossingIssues(segments: readonly Segment[], unit: PlcUnitDefinition): string[] {
  const blocks = plcFaces(unit).flatMap((face) =>
    face.appearance.covers.map((cover) => ({
      x: face.origin.x + cover.rect.x,
      y: face.origin.y + cover.rect.y,
      w: cover.rect.w,
      h: cover.rect.h,
    })),
  );
  const body = { x: unit.pos.x, y: unit.pos.y, w: unit.sizeMm.width, h: unit.sizeMm.height };
  const issues: string[] = [];
  for (const segment of segments) {
    if (segment.axis !== 'x') continue;
    const y = segment.a.y;
    if (y <= body.y + EPS || y >= body.y + body.h - EPS) continue;
    const lo = Math.max(Math.min(segment.a.x, segment.b.x), body.x);
    const hi = Math.min(Math.max(segment.a.x, segment.b.x), body.x + body.w);
    if (hi - lo <= EPS) continue;
    // 端子台の上下の縁から {@link DESK_SCREW_APPROACH_MM} 以内は、ネジへまっすぐ入る直前の寄せ
    const margin = DESK_SCREW_APPROACH_MM + EPS;
    const inBlock = blocks.some(
      (r) =>
        y >= r.y - margin && y <= r.y + r.h + margin && lo >= r.x - EPS && hi <= r.x + r.w + EPS,
    );
    if (inBlock) continue;
    issues.push(
      `横へ走る電線がPLC本体の前面を横切ります（y=${y.toFixed(1)}mm）: ${segment.routeId}`,
    );
  }
  return issues;
}
