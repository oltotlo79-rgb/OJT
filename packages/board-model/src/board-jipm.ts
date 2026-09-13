import {
  partId,
  terminalId,
  type LampColor,
  type PartId,
  type TerminalId,
  type WireColor,
} from '@ojt/circuit-sim';
import { vec3, type Rect, type Vec3 } from './geometry.js';

/**
 * 標準盤 `board-jipm-std` の定義データ。設計仕様 §6.1〜§6.6、調査資料 §2.1〜§2.2 / §3.1 / §3.5。
 *
 * 実物の写真（`docs/reference/K96-CS3-board-photo.png`、OMRON「電気系保全作業練習器 形 K96-CS3」）に
 * 合わせて配置を決めている。写真から読めない寸法はすべて**本アプリ既定（写真からの推定）**であり、
 * 根拠は計画書 Task 4 の表に記す。
 *
 * 形状は**傾斜コンソール**（手前が低く奥が高い）。盤面そのものは平面なので座標は従来どおり
 * 「盤面上の (x, y) ＋ 盤面からの高さ z」の 2.5D で持ち、傾斜と立ち上がりは `console` に
 * メタデータとして持たせて3D側が使う。
 */

/** 盤面（傾斜した操作面）の幅[mm]。 */
export const BOARD_WIDTH_MM = 330;
/** 盤面の奥行[mm]（傾斜面に沿った長さ。奥=0、手前=この値）。 */
export const BOARD_HEIGHT_MM = 245;
/** 筐体の厚み[mm]。 */
export const BOARD_DEPTH_MM = 50;
/** 端子の当たり判定半径[mm]。§6.5 */
export const TERMINAL_PICK_RADIUS_MM = 4;
/**
 * P/N供給端子の本数。実物（写真）の DC24V 供給端子台は **P×1・N×1 の2点**しかないので1本ずつ。
 * 仕様 §6.1 の表は6本ずつとしているが、実機に合わせる（§11.3 の母線割当は渡り配線で対応する）。
 */
export const SUPPLY_TERMINAL_COUNT = 1;

/** ソケット本体の幅[mm]（PYF14A相当＋取付の遊び）。 */
export const SOCKET_BODY_WIDTH_MM = 30;
/** ソケット本体の奥行[mm]（奥のネジ端子ティアから手前のティアまでを含む全長）。 */
export const SOCKET_BODY_LENGTH_MM = 76;
/** 14ピンソケットの取付ピッチ[mm]（本体幅＋隣との隙間2mm）。 */
export const SOCKET_PITCH_MM = 32;
/** ソケットのネジ端子の列ピッチ[mm]（4列）。 */
export const SOCKET_COL_PITCH_MM = 9;
/** ソケット本体の端から最初のネジ端子列までの奥行方向の距離[mm]。 */
export const SOCKET_TIER_INSET_MM = 6;
/** 同じティア内のネジ端子の段ピッチ[mm]（当たり判定半径4mmが重ならない最小値）。 */
export const SOCKET_TIER_ROW_PITCH_MM = 8;
/** 本体中央の差込穴領域の、本体端からの奥行方向の距離[mm]。 */
export const SOCKET_SLOT_INSET_MM = 22;
/** 差込穴（14ピン）の列ピッチ[mm]（2列）。本アプリ既定。 */
export const SOCKET_PIN_HOLE_COL_PITCH_MM = 12;
/** 差込穴（14ピン）の段ピッチ[mm]（7段）。本アプリ既定。 */
export const SOCKET_PIN_HOLE_ROW_PITCH_MM = 5;
/** 端子台のネジ端子ピッチ[mm]。 */
export const BLOCK_PITCH_MM = 9;
/** ソケットのネジ端子の盤面からの高さ[mm]。 */
export const SOCKET_TERMINAL_Z_MM = 10;
/** 端子台のネジ端子の盤面からの高さ[mm]。 */
export const BLOCK_TERMINAL_Z_MM = 8;
/** PB／PL本体端子の盤面からの高さ[mm]（盤の裏側にあるため負）。§6.4 */
export const BODY_TERMINAL_Z_MM = -12;
/** 機器の根元（盤面の貫通穴）から機器中心までの距離[mm]（穴は機器の奥側にある）。 */
export const PANEL_HOLE_OFFSET_MM = 11;
/** 貫通穴に入る既設配線どうしの間隔[mm]。 */
export const HARNESS_PITCH_MM = 2;
/** 貫通穴の手前で既設配線が横に寄る位置（穴からの距離[mm]）。 */
export const HARNESS_APPROACH_MM = 7;
/** 電線が盤面上を走る高さ[mm]（配線帯の中の高さ）。 */
export const WIRE_RUN_Z_MM = 3.5;

/** 傾斜コンソールの形状メタデータ（3D側が筐体を描くために使う）。 */
export interface ConsoleShape {
  /** 盤面の傾斜角[度]（手前下がり）。 */
  slopeDeg: number;
  /** 手前端の机上高さ[mm]（＝筐体の厚み）。 */
  frontHeightMm: number;
  /** 奥端の机上高さ[mm]。`frontHeightMm + 奥行 × sin(slopeDeg)` と一致する。 */
  rearHeightMm: number;
}

/** 物理ソケットID（盤上の位置で決まる。役割の割当は roles.ts）。左クラスタ S1〜S4／右クラスタ S5〜S8。 */
export type SocketId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8';

/** 物理ソケットIDの並び（左クラスタ4個 → 右クラスタ4個）。 */
export const SOCKET_IDS: readonly SocketId[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];

/** 押ボタンの色。§5.3.3 */
export type PushButtonColor = '黒' | '黄' | '緑' | '赤';

/** 端子の役割。§6.6 の `role` のうち Phase 1 の盤で使うもの。 */
export type TerminalRole =
  'coil+' | 'coil-' | 'com' | 'no' | 'nc' | '+' | '-' | 'c' | 'a' | 'b' | 'ac';

/** 盤上の1端子。 */
export interface BoardTerminal {
  /** 物理端子ID。ソケットは `S1.13` のように**物理**ソケットIDで持つ（役割IDへの変換は roles.ts）。 */
  id: TerminalId;
  /** ツールチップ用の表示名（例: `S1 ⑨ com`）。§8.2 */
  label: string;
  role: TerminalRole;
  pos: Vec3;
  pickRadiusMm: number;
  /** 訓練者が配線してよい端子か。PB／PL本体端子・ブレーカ・スイッチ・電源内部端子は false。§6.4 */
  wirable: boolean;
  /** 既定の盤には無く、課題の `extraParts` で追加したときだけ使える端子（BZ）。§5.3.4 */
  optional: boolean;
  /**
   * 端子から電線を引き出す向き（盤面の奥行方向）。
   * ソケットのネジ端子は本体の上端／下端に寄っているので向きが決まっている（上ティア=`rear`、
   * 下ティア=`front`）。端子台・P/N・本体端子は空いている側へ出せるので `either`。
   */
  exit: 'rear' | 'front' | 'either';
}

/** 14ピンソケットの定義。 */
export interface SocketDefinition {
  id: SocketId;
  kind: 'socket-14pin';
  /** 左右どちらのクラスタか（写真の2つのDINレール群に対応）。 */
  cluster: 'left' | 'right';
  /** 本体の左奥の角（盤面上）。ネジ端子と差込穴はここからの相対位置で決まる。 */
  origin: Vec3;
  /** 本体の外形[mm]（3Dのモデルと、配線が本体上を横切らないことの検査に使う）。 */
  bodyMm: { width: number; length: number };
}

/** 押ボタン本体の定義。 */
export interface PushButtonDefinition {
  id: PartId;
  color: PushButtonColor;
  /** 盤面の銘板表記（写真では `PBS1`〜`PBS4`）。部品IDは §6.4 の `PB1`〜`PB4` を使う。 */
  panelLabel: string;
  pos: Vec3;
  /** 既設配線が盤面を抜ける貫通穴（機器の奥側の根元）。写真ではここに青線が集まる。 */
  panelHole: Vec3;
}

/** 表示灯本体の定義。 */
export interface LampDefinition {
  id: PartId;
  color: LampColor;
  panelLabel: string;
  pos: Vec3;
  /** 既設配線が盤面を抜ける貫通穴（機器の奥側の根元）。 */
  panelHole: Vec3;
}

/** 盤定義内で端子を指す参照。ソケットは役割割当で端子IDが変わるためピン番号で指す。 */
export type BoardEndpoint =
  { kind: 'terminal'; id: TerminalId } | { kind: 'socket'; socket: SocketId; pin: number };

/** 既設の固定電線（チェック用ソケットの黄色配線）。`locked` で訓練者は変更できない。§6.3 */
export interface FixedWire {
  id: string;
  from: BoardEndpoint;
  to: BoardEndpoint;
  color: WireColor;
}

/**
 * 既設の0Ωリンク（PB／PL本体と端子台の間、P/N供給端子どうし）。§6.4
 * 写真では PB／PL の本体から端子台へ**青線**のハーネスが走っている。電気的には0Ωの内部結線として
 * 扱う（故障注入の対象外・端子の本数制限にも数えない。§6.3 / §6.4）が、3Dで描けるように色を持つ。
 */
export interface FixedLink {
  id: string;
  from: TerminalId;
  to: TerminalId;
  color: WireColor;
}

/**
 * 配線帯（見えないガイド）。電線はここを直角に走る。§6.6
 * `axis: 'x'` なら y = `at` の水平帯で、x が `from`〜`to` の範囲を走る。
 * `axis: 'y'` なら x = `at` の垂直帯で、y が `from`〜`to` の範囲を走る。
 */
export interface WiringChannel {
  id: string;
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  zMm: number;
}

/** 盤上の部品が占める領域（盤面への投影）。配線はこの内側を通ってはならない。§6.6 */
export interface Footprint extends Rect {
  id: string;
  kind: 'socket' | 'block' | 'lamp' | 'button' | 'breaker' | 'switch' | 'supply';
}

/** 盤の定義データ。 */
export interface BoardDefinition {
  id: string;
  displayName: string;
  sizeMm: { width: number; height: number; depth: number };
  /** 傾斜コンソールの形状。 */
  console: ConsoleShape;
  sockets: readonly SocketDefinition[];
  pushButtons: readonly PushButtonDefinition[];
  lamps: readonly LampDefinition[];
  supplyTerminalCount: number;
  terminals: readonly BoardTerminal[];
  /** 部品の占有領域。配線はこの内側を通ってはならない。§6.6 */
  footprints: readonly Footprint[];
  /** 配線の自動経路が走る帯。占有領域と重ならない位置にだけ引く。§6.6 */
  wiringChannels: readonly WiringChannel[];
  fixedWires: readonly FixedWire[];
  fixedLinks: readonly FixedLink[];
}

/** 盤定義の参照に失敗したときに投げる。 */
export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardError';
  }
}

/**
 * ソケットのネジ端子の物理配置（調査資料 §3.1 / 仕様 §6.2）。
 * ```
 * 段1:  [空]  ③  ②  ①
 * 段2:   ⑧   ⑦  ⑥  ⑤
 * 段3:   ⑫   ⑪  ⑩  ⑨
 * 段4:   ④   ⑭  ⑬  [空]
 * ```
 * 段（row）は上（奥）から下（手前）、列（col）は左から右。`undefined` は空きスロット。
 */
export const SOCKET_PIN_GRID: ReadonlyArray<ReadonlyArray<number | undefined>> = [
  [undefined, 3, 2, 1],
  [8, 7, 6, 5],
  [12, 11, 10, 9],
  [4, 14, 13, undefined],
];

/** ピン番号 → 端子の役割。§6.2 */
export function pinRole(pin: number): TerminalRole {
  if (pin === 13) return 'coil-';
  if (pin === 14) return 'coil+';
  if (pin >= 9 && pin <= 12) return 'com';
  if (pin >= 5 && pin <= 8) return 'no';
  return 'nc';
}

/** 丸数字ラベル（①〜⑭）。 */
export function circledNumber(pin: number): string {
  const table = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭'];
  const label = table[pin - 1];
  if (label === undefined) throw new BoardError(`ピン番号が範囲外です: ${pin}`);
  return label;
}

/** 物理ソケットのピン端子ID（例: `S1.13`）。 */
export function socketPinTerminal(socket: SocketId, pin: number): TerminalId {
  if (!Number.isInteger(pin) || pin < 1 || pin > 14) {
    throw new BoardError(`ピン番号が範囲外です: ${pin}`);
  }
  return terminalId(socket, String(pin));
}

/** 端子の役割の印字（ソケットのネジ端子の銘板表記）。 */
export function roleLabel(role: TerminalRole): string {
  switch (role) {
    case 'coil+':
      return '+';
    case 'coil-':
      return '−';
    case 'com':
      return 'COM';
    case 'no':
      return 'a';
    case 'nc':
      return 'b';
    default:
      return role;
  }
}

function terminal(
  id: TerminalId,
  label: string,
  role: TerminalRole,
  pos: Vec3,
  wirable: boolean,
  exit: BoardTerminal['exit'] = 'either',
  optional = false,
): BoardTerminal {
  return { id, label, role, pos, pickRadiusMm: TERMINAL_PICK_RADIUS_MM, wirable, exit, optional };
}

/** ソケット本体の外形（盤面上の矩形）。配線が本体を横切らないことの検査に使う。 */
export function socketBodyRect(
  board: BoardDefinition,
  socketId: SocketId,
): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const socket = board.sockets.find((s) => s.id === socketId);
  if (socket === undefined) return undefined;
  return {
    x0: socket.origin.x,
    y0: socket.origin.y,
    x1: socket.origin.x + socket.bodyMm.width,
    y1: socket.origin.y + socket.bodyMm.length,
  };
}

/**
 * ソケットのネジ端子の位置。本体の左奥の角からの相対座標[mm]。
 * 段1・段2は本体の**奥端**に、段3・段4は**手前端**に寄っており、中央は差込穴の領域になる。
 */
export function socketPinOffset(rowIndex: number, colIndex: number): { dx: number; dy: number } {
  const dx = (SOCKET_BODY_WIDTH_MM - 3 * SOCKET_COL_PITCH_MM) / 2 + colIndex * SOCKET_COL_PITCH_MM;
  const dy =
    rowIndex <= 1
      ? SOCKET_TIER_INSET_MM + rowIndex * SOCKET_TIER_ROW_PITCH_MM
      : SOCKET_BODY_LENGTH_MM - SOCKET_TIER_INSET_MM - (3 - rowIndex) * SOCKET_TIER_ROW_PITCH_MM;
  return { dx, dy };
}

/** そのネジ端子の段が本体のどちら端にあるか（電線の引き出し向き）。 */
export function socketRowExit(rowIndex: number): 'rear' | 'front' {
  return rowIndex <= 1 ? 'rear' : 'front';
}

/** 差込穴（14ピン、2列×7段）の中心座標。本体の左奥の角からの相対座標[mm]。 */
export function socketPinHoleOffsets(): Array<{ dx: number; dy: number }> {
  const out: Array<{ dx: number; dy: number }> = [];
  const slotLength = SOCKET_BODY_LENGTH_MM - 2 * SOCKET_SLOT_INSET_MM;
  const y0 = SOCKET_SLOT_INSET_MM + (slotLength - 6 * SOCKET_PIN_HOLE_ROW_PITCH_MM) / 2;
  const x0 = (SOCKET_BODY_WIDTH_MM - SOCKET_PIN_HOLE_COL_PITCH_MM) / 2;
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      out.push({
        dx: x0 + col * SOCKET_PIN_HOLE_COL_PITCH_MM,
        dy: y0 + row * SOCKET_PIN_HOLE_ROW_PITCH_MM,
      });
    }
  }
  return out;
}

/** ソケット本体の奥端のY座標[mm]。 */
const SOCKET_Y_MM = 60;
/** 左クラスタ（S1〜S4）の左端X座標[mm]。 */
const LEFT_CLUSTER_X_MM = 28;
/** 右クラスタ（S5〜S8）の左端X座標[mm]。 */
const RIGHT_CLUSTER_X_MM = 180;

/** ソケット8個の本体左奥の角。写真の左右2クラスタ×4個に対応。 */
const SOCKET_ORIGINS: ReadonlyArray<{ id: SocketId; cluster: 'left' | 'right'; origin: Vec3 }> =
  SOCKET_IDS.map((id, index) => {
    const left = index < 4;
    const baseX = left ? LEFT_CLUSTER_X_MM : RIGHT_CLUSTER_X_MM;
    const slot = left ? index : index - 4;
    return {
      id,
      cluster: left ? ('left' as const) : ('right' as const),
      origin: vec3(baseX + slot * SOCKET_PITCH_MM, SOCKET_Y_MM, SOCKET_TERMINAL_Z_MM),
    };
  });

/** ランプ用端子台（8P）の左端端子のX座標[mm]。 */
const TB_PL_X_MM = 40;
/** ランプ用端子台の段のY座標[mm]。 */
const TB_PL_Y_MM = 168;
/** 押ボタン用端子台（12P）の左端端子のX座標[mm]。 */
const TB_PB_X_MM = 186;
/** 押ボタン用端子台の段のY座標[mm]（写真では PL 用より少し手前にある）。 */
const TB_PB_Y_MM = 184;
/** PL／PB本体の段のY座標[mm]。 */
const BODY_Y_MM = 225;
/** PL本体の取付ピッチ[mm]。 */
const LAMP_PITCH_MM = 24;
/** PB本体の取付ピッチ[mm]。 */
const PB_PITCH_MM = 21;
/** P/N供給端子の左端X座標[mm]。 */
const SUPPLY_X_MM = 20;
/** P（+24V）端子のY座標[mm]。 */
const P_Y_MM = 14;
/** N（0V）端子のY座標[mm]。 */
const N_Y_MM = 30;

/** PL本体4個（白・黄・緑・赤）。写真の銘板は `PL1`〜`PL4`。 */
const LAMP_DEFS: readonly LampDefinition[] = (['白', '黄', '緑', '赤'] as const).map(
  (color, index) => {
    const x = 49 + index * LAMP_PITCH_MM;
    return {
      id: partId(`PL${index + 1}`),
      color,
      panelLabel: `PL${index + 1}`,
      pos: vec3(x, BODY_Y_MM, 0),
      panelHole: vec3(x, BODY_Y_MM - PANEL_HOLE_OFFSET_MM, 0),
    };
  },
);

/** PB本体4個（黒・黄・緑・赤）。写真の銘板は `PBS1`〜`PBS4`、部品IDは §6.4 の `PB1`〜`PB4`。 */
const PUSH_BUTTON_DEFS: readonly PushButtonDefinition[] = (['黒', '黄', '緑', '赤'] as const).map(
  (color, index) => {
    const x = 212 + index * PB_PITCH_MM;
    return {
      id: partId(`PB${index + 1}`),
      color,
      panelLabel: `PBS${index + 1}`,
      pos: vec3(x, BODY_Y_MM, 0),
      panelHole: vec3(x, BODY_Y_MM - PANEL_HOLE_OFFSET_MM, 0),
    };
  },
);

function buildTerminals(): BoardTerminal[] {
  const out: BoardTerminal[] = [];

  // DC24V電源の内部端子（測定のみ。訓練者は配線しない）
  out.push(terminal(terminalId('PS', '+'), 'PS +24V', '+', vec3(12, P_Y_MM, 6), false));
  out.push(terminal(terminalId('PS', '-'), 'PS 0V', '-', vec3(12, N_Y_MM, 6), false));

  // P/N供給端子（DC24V供給端子台。内部で同電位。§6.1）
  for (let i = 1; i <= SUPPLY_TERMINAL_COUNT; i += 1) {
    const x = SUPPLY_X_MM + (i - 1) * BLOCK_PITCH_MM;
    out.push(
      terminal(
        terminalId('P', String(i)),
        `P${i}`,
        '+',
        vec3(x, P_Y_MM, BLOCK_TERMINAL_Z_MM),
        true,
        'front',
      ),
    );
  }
  for (let i = 1; i <= SUPPLY_TERMINAL_COUNT; i += 1) {
    const x = SUPPLY_X_MM + (i - 1) * BLOCK_PITCH_MM;
    out.push(
      terminal(
        terminalId('N', String(i)),
        `N${i}`,
        '-',
        vec3(x, N_Y_MM, BLOCK_TERMINAL_Z_MM),
        true,
        'front',
      ),
    );
  }

  // ブレーカ（写真右上の2極MCB）・電源スイッチ。AC一次側なので配線も測定もしない。§5.3.5
  out.push(terminal(terminalId('CB', '1'), 'CB 1', 'ac', vec3(286, P_Y_MM, 6), false));
  out.push(terminal(terminalId('CB', '2'), 'CB 2', 'ac', vec3(286, N_Y_MM, 6), false));
  out.push(terminal(terminalId('SW', '1'), 'SW 1', 'ac', vec3(310, P_Y_MM, 6), false));
  out.push(terminal(terminalId('SW', '2'), 'SW 2', 'ac', vec3(310, N_Y_MM, 6), false));

  // 14ピンソケット×8。ネジ端子は本体の奥端（段1・段2）と手前端（段3・段4）に2列ずつ。§6.2
  for (const socket of SOCKET_ORIGINS) {
    SOCKET_PIN_GRID.forEach((row, rowIndex) => {
      row.forEach((pin, colIndex) => {
        if (pin === undefined) return;
        const { dx, dy } = socketPinOffset(rowIndex, colIndex);
        const role = pinRole(pin);
        out.push(
          terminal(
            socketPinTerminal(socket.id, pin),
            `${circledNumber(pin)} ${roleLabel(role)}`,
            role,
            vec3(socket.origin.x + dx, socket.origin.y + dy, socket.origin.z),
            true,
            socketRowExit(rowIndex),
          ),
        );
      });
    });
  }

  // ランプ用端子台（8P: +/− × 4）
  for (let n = 1; n <= 4; n += 1) {
    for (const [offset, sign] of [
      [0, '+'],
      [1, '-'],
    ] as const) {
      const index = (n - 1) * 2 + offset;
      const x = TB_PL_X_MM + index * BLOCK_PITCH_MM;
      out.push(
        terminal(
          terminalId('TB_PL', `${n}${sign}`),
          `PL${n}${sign === '-' ? '−' : '+'}`,
          sign,
          vec3(x, TB_PL_Y_MM, BLOCK_TERMINAL_Z_MM),
          true,
          'rear',
        ),
      );
    }
  }

  // 押ボタン用端子台（12P: c/a/b × 4）
  for (let n = 1; n <= 4; n += 1) {
    for (const [offset, sign] of [
      [0, 'c'],
      [1, 'a'],
      [2, 'b'],
    ] as const) {
      const index = (n - 1) * 3 + offset;
      const x = TB_PB_X_MM + index * BLOCK_PITCH_MM;
      out.push(
        terminal(
          terminalId('TB_PB', `${n}${sign}`),
          `PB${n} ${sign}`,
          sign,
          vec3(x, TB_PB_Y_MM, BLOCK_TERMINAL_Z_MM),
          true,
          'rear',
        ),
      );
    }
  }

  // PL本体（端子は機器の根元・盤面のすぐ裏。測定と3D表示のためだけに存在する。§6.4）
  LAMP_DEFS.forEach((lamp) => {
    (['+', '-'] as const).forEach((sign, index) => {
      out.push(
        terminal(
          terminalId(lamp.id, sign),
          `${lamp.panelLabel} ${sign === '-' ? '−' : '+'}`,
          sign,
          vec3(lamp.panelHole.x + (index - 0.5) * HARNESS_PITCH_MM, lamp.pos.y, BODY_TERMINAL_Z_MM),
          false,
          'rear',
        ),
      );
    });
  });

  // PB本体（端子は機器の根元・盤面のすぐ裏。§6.4）
  PUSH_BUTTON_DEFS.forEach((pb) => {
    (['c', 'a', 'b'] as const).forEach((sign, index) => {
      out.push(
        terminal(
          terminalId(pb.id, sign),
          `${pb.panelLabel} ${sign}`,
          sign,
          vec3(pb.panelHole.x + (index - 1) * HARNESS_PITCH_MM, pb.pos.y, BODY_TERMINAL_Z_MM),
          false,
          'rear',
        ),
      );
    });
  });

  // BZ（任意部品。課題の extraParts で追加したときだけ使える。§5.3.4）
  out.push(
    terminal(
      terminalId('BZ', '+'),
      'BZ +',
      '+',
      vec3(120, TB_PL_Y_MM, BLOCK_TERMINAL_Z_MM),
      true,
      'either',
      true,
    ),
  );
  out.push(
    terminal(
      terminalId('BZ', '-'),
      'BZ −',
      '-',
      vec3(130, TB_PL_Y_MM, BLOCK_TERMINAL_Z_MM),
      true,
      'either',
      true,
    ),
  );

  return out;
}

/**
 * 配線帯（§6.6）。写真の盤にはダクトが無く電線は盤面を直接走るので、
 * 機器の列と列の**あいだ**に見えないガイドを引き、電線はここを直角に走る。
 * 水平帯は「P/N列とソケット列の間」「ソケット列と端子台列の間」「端子台列とPL/PB列の間」、
 * 垂直帯は「左右の余白」と「左右ソケットクラスタの間」。
 */
const WIRING_CHANNELS: readonly WiringChannel[] = [
  { id: 'ch-top', axis: 'x', at: 42, from: 10, to: 322, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-mid', axis: 'x', at: 142, from: 10, to: 322, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-low', axis: 'x', at: 198, from: 10, to: 322, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-left', axis: 'y', at: 10, from: 42, to: 198, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-gap', axis: 'y', at: 159, from: 42, to: 198, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-right', axis: 'y', at: 322, from: 42, to: 198, zMm: WIRE_RUN_Z_MM },
];

/**
 * レーンを伸ばす向き（`+1` は x/y の増える側）。占有領域のない側へ伸ばす。§6.6
 * 帯ごとに固定なので、レーン割当は決定論になる。
 */
export const CHANNEL_LANE_DIRECTION: Readonly<Record<string, 1 | -1>> = {
  'ch-top': 1,
  'ch-mid': 1,
  'ch-low': 1,
  'ch-left': 1,
  'ch-gap': 1,
  'ch-right': -1,
};

/** 部品の占有領域。配線帯はこれらと重ならない位置に置いてある。§6.6 */
function buildFootprints(): Footprint[] {
  const out: Footprint[] = [];
  out.push({ id: 'supply', kind: 'supply', x: 12, y: 6, w: 26, h: 30 });
  out.push({ id: 'CB', kind: 'breaker', x: 276, y: 6, w: 26, h: 30 });
  out.push({ id: 'SW', kind: 'switch', x: 302, y: 6, w: 20, h: 30 });
  for (const socket of SOCKET_ORIGINS) {
    out.push({
      id: socket.id,
      kind: 'socket',
      x: socket.origin.x,
      y: socket.origin.y,
      w: SOCKET_BODY_WIDTH_MM,
      h: SOCKET_BODY_LENGTH_MM,
    });
  }
  out.push({
    id: 'TB_PL',
    kind: 'block',
    x: TB_PL_X_MM - 5,
    y: TB_PL_Y_MM - 10,
    w: 7 * BLOCK_PITCH_MM + 10,
    h: 20,
  });
  out.push({
    id: 'TB_PB',
    kind: 'block',
    x: TB_PB_X_MM - 5,
    y: TB_PB_Y_MM - 8,
    w: 11 * BLOCK_PITCH_MM + 10,
    h: 16,
  });
  out.push({ id: 'BZ', kind: 'block', x: 114, y: TB_PL_Y_MM - 10, w: 22, h: 20 });
  for (const lamp of LAMP_DEFS) {
    out.push({ id: lamp.id, kind: 'lamp', x: lamp.pos.x - 10, y: lamp.pos.y - 10, w: 20, h: 20 });
  }
  for (const pb of PUSH_BUTTON_DEFS) {
    out.push({ id: pb.id, kind: 'button', x: pb.pos.x - 9, y: pb.pos.y - 9, w: 18, h: 18 });
  }
  return out;
}

/**
 * チェック用ソケットの既設固定配線（§6.3）。
 * `P.1 → TB_PB.4c` / `TB_PB.4a → CHK.14` / `CHK.13 → N.1` の3本。
 * PB4本体ではなく押ボタン用端子台側に接続する（盤上で配線できる端子は端子台側のため）。
 * チェック用ソケットは既定の役割割当（roles.ts）で `S7` に割り当てられる。
 */
const CHECK_SOCKET: SocketId = 'S7';

const FIXED_WIRES: readonly FixedWire[] = [
  {
    id: 'fw-chk-1',
    from: { kind: 'terminal', id: terminalId('P', '1') },
    to: { kind: 'terminal', id: terminalId('TB_PB', '4c') },
    color: '青',
  },
  {
    id: 'fw-chk-2',
    from: { kind: 'terminal', id: terminalId('TB_PB', '4a') },
    to: { kind: 'socket', socket: CHECK_SOCKET, pin: 14 },
    color: '青',
  },
  {
    id: 'fw-chk-3',
    from: { kind: 'socket', socket: CHECK_SOCKET, pin: 13 },
    to: { kind: 'terminal', id: terminalId('N', '1') },
    color: '青',
  },
];

function buildFixedLinks(): FixedLink[] {
  const out: FixedLink[] = [];
  // DC24V電源 → P/N供給端子（供給端子は実機どおり P.1 / N.1 の1点ずつ）
  out.push({ id: 'lk-ps-p', from: terminalId('PS', '+'), to: terminalId('P', '1'), color: '青' });
  for (let i = 1; i < SUPPLY_TERMINAL_COUNT; i += 1) {
    out.push({
      id: `lk-p-${i}`,
      from: terminalId('P', String(i)),
      to: terminalId('P', String(i + 1)),
      color: '青',
    });
  }
  out.push({ id: 'lk-ps-n', from: terminalId('PS', '-'), to: terminalId('N', '1'), color: '青' });
  for (let i = 1; i < SUPPLY_TERMINAL_COUNT; i += 1) {
    out.push({
      id: `lk-n-${i}`,
      from: terminalId('N', String(i)),
      to: terminalId('N', String(i + 1)),
      color: '青',
    });
  }
  // PB本体 ↔ 押ボタン用端子台（12本の青線ハーネス）。§6.4
  PUSH_BUTTON_DEFS.forEach((pb, index) => {
    for (const sign of ['c', 'a', 'b'] as const) {
      out.push({
        id: `lk-pb-${index + 1}${sign}`,
        from: terminalId(pb.id, sign),
        to: terminalId('TB_PB', `${index + 1}${sign}`),
        color: '青',
      });
    }
  });
  // PL本体 ↔ ランプ用端子台（8本の青線ハーネス）。§6.4
  LAMP_DEFS.forEach((lamp, index) => {
    for (const sign of ['+', '-'] as const) {
      out.push({
        id: `lk-pl-${index + 1}${sign}`,
        from: terminalId(lamp.id, sign),
        to: terminalId('TB_PL', `${index + 1}${sign}`),
        color: '青',
      });
    }
  });
  return out;
}

/** 盤面の傾斜（本アプリ既定・写真からの推定）。 */
const CONSOLE_SHAPE: ConsoleShape = {
  slopeDeg: 13,
  frontHeightMm: BOARD_DEPTH_MM,
  rearHeightMm:
    Math.round((BOARD_DEPTH_MM + BOARD_HEIGHT_MM * Math.sin((13 * Math.PI) / 180)) * 10) / 10,
};

/** 標準盤（OMRON K96-CS3 相当）。 */
export const JIPM_BOARD: BoardDefinition = {
  id: 'board-jipm-std',
  displayName: '電気系保全作業練習器（K96-CS3 相当）',
  sizeMm: { width: BOARD_WIDTH_MM, height: BOARD_HEIGHT_MM, depth: BOARD_DEPTH_MM },
  console: CONSOLE_SHAPE,
  sockets: SOCKET_ORIGINS.map((s) => ({
    id: s.id,
    kind: 'socket-14pin',
    cluster: s.cluster,
    origin: s.origin,
    bodyMm: { width: SOCKET_BODY_WIDTH_MM, length: SOCKET_BODY_LENGTH_MM },
  })),
  pushButtons: PUSH_BUTTON_DEFS,
  lamps: LAMP_DEFS,
  supplyTerminalCount: SUPPLY_TERMINAL_COUNT,
  terminals: buildTerminals(),
  footprints: buildFootprints(),
  wiringChannels: WIRING_CHANNELS,
  fixedWires: FIXED_WIRES,
  fixedLinks: buildFixedLinks(),
};

/** 盤IDから盤定義を引く。未知のIDは BoardError。 */
export function loadBoard(boardId: string): BoardDefinition {
  if (boardId !== JIPM_BOARD.id) throw new BoardError(`未知の盤IDです: ${boardId}`);
  return JIPM_BOARD;
}

/** 物理端子IDで端子を探す。 */
export function findBoardTerminal(
  board: BoardDefinition,
  id: TerminalId | string,
): BoardTerminal | undefined {
  return board.terminals.find((t) => t.id === id);
}

/** 物理端子IDの座標。未知の端子は BoardError。 */
export function boardTerminalPos(board: BoardDefinition, id: TerminalId | string): Vec3 {
  const found = findBoardTerminal(board, id);
  if (found === undefined) throw new BoardError(`盤に無い端子です: ${id}`);
  return found.pos;
}

/** 盤定義内の端子参照を物理端子IDに解決する。 */
export function resolveEndpoint(endpoint: BoardEndpoint): TerminalId {
  return endpoint.kind === 'terminal'
    ? endpoint.id
    : socketPinTerminal(endpoint.socket, endpoint.pin);
}
