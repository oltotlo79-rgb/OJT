import { type PlcUnitSpec, type TerminalId } from '@ojt/circuit-sim';
import {
  BoardError,
  OUTLET_ID,
  PLC_PART_ID,
  TERMINAL_PICK_RADIUS_MM,
  type BoardDefinition,
  type BoardTerminal,
  type FaceRect,
  type PlcAppearance,
  type PlcFeatureMark,
  type PlcLedMark,
  type PlcModuleDefinition,
  type PlcUnitDefinition,
  type TerminalRole,
} from './board-jipm.js';
import { vec3, type Vec3 } from './geometry.js';

/**
 * 机上に置くPLC本体と壁コンセント。設計仕様 §10.1 / §10.2。
 *
 * Phase 3 の対象は三菱 FX5U-32MR/ES のみである（§16）。Phase 4 で CP1E・PC10G-1SP・JW300 を
 * 足すときは、この形の定義をもう3つ並べて `PLC_UNITS` に登録するだけでよい。
 * 端子の**並び順**は一次資料が未確認のため §10.1 の表の記載順を採る（§17 #11）。
 */

/** PLC本体の端子の列ピッチ[mm]（当たり判定半径4mmが重ならない値）。 */
export const PLC_TERMINAL_PITCH_MM = 9;
/** 千鳥2列の段間[mm]。 */
export const PLC_ROW_GAP_MM = 9;
/** 千鳥のずらし量[mm]。 */
export const PLC_STAGGER_MM = 4.5;
/** 机上のPLC本体の左奥の角（盤座標の延長。盤の右）。§10.1 */
export const PLC_ORIGIN_MM: Vec3 = vec3(390, 18, 0);
/** 壁コンセントの位置[mm]。 */
export const OUTLET_ORIGIN_MM: Vec3 = vec3(395, 190, 0);

/** FX5U の入力回路の抵抗[Ω]。§5.1.3 */
export const FX5U_INPUT_OHMS = 4500;
/** FX5U の入力ON感度[A]（3.5mA）。§5.1.3 */
export const FX5U_ON_AMPS = 0.0035;
/** FX5U の入力OFF感度[A]（1.5mA）。§5.1.3 */
export const FX5U_OFF_AMPS = 0.0015;
/** 1コモンあたりの出力点数（本アプリの前提値。§17.1）。 */
export const FX5U_POINTS_PER_COMMON = 4;

/** 8進表記の端子名を作る（`X0`〜`X7`, `X10`〜`X17`）。§10.1 */
export function octalNames(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, i) => `${prefix}${i.toString(8)}`);
}

/** FX5U-32MR/ES の電気的な仕様。§10.1 / §5.1.3 */
export const FX5U_SPEC: PlcUnitSpec = {
  model: 'FX5U',
  power: ['L', 'PE', 'N'],
  acPower: ['L', 'N'],
  inputCommons: ['SS'],
  service: ['24V', '0V'],
  inputs: octalNames('X', 16).map((name) => ({ name, com: 'SS' })),
  commons: ['COM0', 'COM1', 'COM2', 'COM3'],
  outputs: octalNames('Y', 16).map((name, index) => ({
    name,
    com: `COM${Math.floor(index / FX5U_POINTS_PER_COMMON)}`,
  })),
  inputOhms: FX5U_INPUT_OHMS,
  onAmps: FX5U_ON_AMPS,
  offAmps: FX5U_OFF_AMPS,
};

/** LEDの点灯色（本アプリ既定）。 */
export const PLC_LED_GREEN = '#35C759';
export const PLC_LED_RED = '#FF3B30';
export const PLC_LED_AMBER = '#FFB020';

/** LEDを横1列に並べる。`pitch` は中心間隔[mm]。 */
export function ledRow(
  names: readonly string[],
  group: PlcLedMark['group'],
  at: { x: number; y: number; w: number; h: number; pitch: number },
  color: string,
): PlcLedMark[] {
  return names.map((name, index) => ({
    name,
    group,
    rect: { x: at.x + index * at.pitch, y: at.y, w: at.w, h: at.h },
    color,
  }));
}

/** 濃灰の筐体（FX5U）。 */
const FX5U_BODY_COLOR = '#3A3D42';
/** 明灰のヒンジ式端子カバー（FX5U）。 */
const FX5U_COVER_COLOR = '#C8CBD0';

/**
 * FX5U-32MR/ES の外観。§10.1 / 決定表#15
 * 濃灰の筐体に明灰のヒンジ式端子カバーが上下2枚、中央の帯に本体表示LED・銘板・入出力表示LED・
 * RUN/STOPスイッチ・Ethernetポート・SDカードスロットが並ぶ。色と配置は本アプリの記述である。
 */
export const FX5U_APPEARANCE: PlcAppearance = {
  faceMm: { width: 150, height: 90 },
  bodyColor: FX5U_BODY_COLOR,
  terminalBlockColor: '#1F2226',
  nameplate: 'FX5U-32MR/ES',
  nameplateRect: { x: 54, y: 28, w: 60, h: 6 },
  covers: [
    {
      id: 'input-cover',
      rect: { x: 0, y: 0, w: 150, h: 26 },
      color: FX5U_COVER_COLOR,
      hinge: 'top',
    },
    {
      id: 'output-cover',
      rect: { x: 0, y: 64, w: 150, h: 26 },
      color: FX5U_COVER_COLOR,
      hinge: 'bottom',
    },
  ],
  leds: [
    ...ledRow(
      ['PWR', 'ERR', 'P.RUN', 'BAT', 'CARD'],
      'status',
      { x: 6, y: 28, w: 4, h: 3, pitch: 9 },
      PLC_LED_GREEN,
    ),
    ...ledRow(octalNames('X', 16), 'input', { x: 6, y: 36, w: 3, h: 3, pitch: 8.5 }, PLC_LED_AMBER),
    ...ledRow(
      octalNames('Y', 16),
      'output',
      { x: 6, y: 42, w: 3, h: 3, pitch: 8.5 },
      PLC_LED_AMBER,
    ),
  ],
  features: [
    {
      id: 'run-stop',
      kind: 'switch',
      label: 'RUN/STOP/RESET スイッチ',
      rect: { x: 6, y: 50, w: 24, h: 8 },
      color: '#8A8F96',
    },
    {
      id: 'ethernet',
      kind: 'port',
      label: 'Ethernetポート',
      rect: { x: 36, y: 49, w: 16, h: 11 },
      color: '#1F2226',
    },
    {
      id: 'sd-card',
      kind: 'slot',
      label: 'SDカードスロット',
      rect: { x: 58, y: 49, w: 14, h: 11 },
      color: '#1F2226',
    },
  ],
  assumed: [
    '筐体色・端子カバー色（一般に知られた見え方。実機写真は使っていない）',
    'LED・スイッチ・コネクタの面上の位置（カタログ寸法と一般的な前面構成から作図）',
    '銘板は型式の文字列のみ（ロゴ・ブランド名は描かない）',
  ],
};

/** 端子名 → 役割（§6.6 の `role`）。機種仕様の集合から引く。 */
function plcRole(spec: PlcUnitSpec, name: string): TerminalRole {
  if (name === spec.acPower[0]) return 'ac-l';
  if (name === spec.acPower[1]) return 'ac-n';
  if (spec.power.includes(name)) return 'ac';
  if (spec.inputCommons.includes(name)) return 'ss';
  if (spec.commons.includes(name)) return 'plc-com';
  if ((spec.service ?? []).includes(name)) return name === '0V' || name === '-' ? '-' : '+';
  if (spec.inputs.some((input) => input.name === name)) return 'x';
  return 'y';
}

/** 端子名 → 銘板（実機の印字）。 */
function plcLabel(name: string): string {
  if (name === 'SS') return 'S/S';
  if (name === 'PE') return '⏚';
  if (name === 'L2N') return 'L2/N';
  return name;
}

/** 千鳥2列に並べた端子を作る。偶数番が奥列、奇数番が手前列。 */
function staggeredTerminals(
  spec: PlcUnitSpec,
  names: readonly string[],
  origin: Vec3,
): BoardTerminal[] {
  return names.map((name, index) => ({
    id: `${PLC_PART_ID}.${name}` as TerminalId,
    label: plcLabel(name),
    role: plcRole(spec, name),
    pos: vec3(
      origin.x + Math.floor(index / 2) * PLC_TERMINAL_PITCH_MM + (index % 2) * PLC_STAGGER_MM,
      origin.y + (index % 2) * PLC_ROW_GAP_MM,
      origin.z,
    ),
    pickRadiusMm: TERMINAL_PICK_RADIUS_MM,
    wirable: true,
    optional: false,
    exit: 'either',
  }));
}

/** FX5U の端子（入力側の列 → 出力側の列）。§10.1 の記載順。 */
function fx5uTerminals(): BoardTerminal[] {
  const inputSide = [
    ...FX5U_SPEC.power,
    ...FX5U_SPEC.inputCommons,
    ...(FX5U_SPEC.service ?? []),
    ...FX5U_SPEC.inputs.map((input) => input.name),
  ];
  const outputSide: string[] = [];
  FX5U_SPEC.outputs.forEach((output, index) => {
    if (index % FX5U_POINTS_PER_COMMON === 0) outputSide.push(output.com);
    outputSide.push(output.name);
  });
  return [
    ...staggeredTerminals(FX5U_SPEC, inputSide, vec3(PLC_ORIGIN_MM.x + 6, PLC_ORIGIN_MM.y + 6, 0)),
    ...staggeredTerminals(
      FX5U_SPEC,
      outputSide,
      vec3(PLC_ORIGIN_MM.x + 6, PLC_ORIGIN_MM.y + 72, 0),
    ),
  ];
}

/** 三菱 FX5U-32MR/ES。§10.1 */
export const PLC_UNIT_FX5U: PlcUnitDefinition = {
  id: 'fx5u',
  model: 'FX5U',
  vendor: 'mitsubishi',
  displayName: '三菱 MELSEC iQ-F FX5U-32MR/ES',
  form: 'unit',
  appearance: FX5U_APPEARANCE,
  sizeMm: { width: 150, height: 90, depth: 83 },
  pos: PLC_ORIGIN_MM,
  spec: FX5U_SPEC,
  terminals: fx5uTerminals(),
  leds: ['PWR', 'ERR', 'P.RUN', 'BAT', 'CARD'],
};

/** CP1E の入力抵抗[Ω]（`0.00`〜`0.07`）。§5.1.3 */
export const CP1E_INPUT_OHMS_LOW = 3300;
/** CP1E の入力抵抗[Ω]（`0.08` 以降）。§5.1.3 */
export const CP1E_INPUT_OHMS_HIGH = 4800;
/** CP1E の出力COMごとの点数（§17.1 の前提値 3/3/2/2/2）。 */
export const CP1E_COMMON_SIZES: readonly number[] = [3, 3, 2, 2, 2];

/** `ch.bit` 形式の端子名を作る（`0.00`〜`0.11`）。§10.1 */
export function channelNames(ch: number, count: number): string[] {
  return Array.from({ length: count }, (_unused, i) => `${ch}.${String(i).padStart(2, '0')}`);
}

/** 出力の並びから所属COMを決める（先頭から `sizes` 点ずつ）。 */
function commonOf(index: number, sizes: readonly number[]): string {
  let start = 0;
  for (const [group, size] of sizes.entries()) {
    if (index < start + size) return `COM${group}`;
    start += size;
  }
  return `COM${sizes.length - 1}`;
}

/** CP1E-N30DR-A の電気的な仕様。§10.1 / §5.1.3 / §17.1 */
export const CP1E_SPEC: PlcUnitSpec = {
  model: 'CP1E',
  power: ['L1', 'L2N'],
  acPower: ['L1', 'L2N'],
  inputCommons: ['COM'],
  service: ['+', '-'],
  inputs: [...channelNames(0, 12), ...channelNames(1, 6)].map((name, index) => ({
    name,
    com: 'COM',
    ohms: index < 8 ? CP1E_INPUT_OHMS_LOW : CP1E_INPUT_OHMS_HIGH,
  })),
  commons: CP1E_COMMON_SIZES.map((_unused, group) => `COM${group}`),
  outputs: [...channelNames(100, 8), ...channelNames(101, 4)].map((name, index) => ({
    name,
    com: commonOf(index, CP1E_COMMON_SIZES),
  })),
};

/** CP1E の端子（入力側の列 → 出力側の列）。§10.1 の記載順 / §17 #11 */
function cp1eTerminals(): BoardTerminal[] {
  const inputSide = [
    ...CP1E_SPEC.power,
    ...CP1E_SPEC.inputCommons,
    ...CP1E_SPEC.inputs.map((input) => input.name),
  ];
  const outputSide: string[] = [];
  let previous = '';
  for (const output of CP1E_SPEC.outputs) {
    if (output.com !== previous) outputSide.push(output.com);
    previous = output.com;
    outputSide.push(output.name);
  }
  outputSide.push(...(CP1E_SPEC.service ?? []));
  return [
    ...staggeredTerminals(CP1E_SPEC, inputSide, vec3(PLC_ORIGIN_MM.x + 6, PLC_ORIGIN_MM.y + 6, 0)),
    ...staggeredTerminals(
      CP1E_SPEC,
      outputSide,
      vec3(PLC_ORIGIN_MM.x + 6, PLC_ORIGIN_MM.y + 72, 0),
    ),
  ];
}

/** 明灰（アイボリー）の筐体（CP1E）。 */
const CP1E_BODY_COLOR = '#D8D5CC';

/**
 * CP1E-N30DR-A の外観。§10.1 / 決定表#15
 * 明灰の筐体に黒の端子台が上下2段、上段（入力側）に電源端子 `L1` / `L2/N` が同居する。
 * 中央の帯に本体表示LED・銘板・入出力表示LED・周辺USBポート・オプションボードスロット。
 */
export const CP1E_APPEARANCE: PlcAppearance = {
  faceMm: { width: 130, height: 90 },
  bodyColor: CP1E_BODY_COLOR,
  terminalBlockColor: '#2A2A2A',
  nameplate: 'CP1E-N30DR-A',
  nameplateRect: { x: 46, y: 27, w: 56, h: 6 },
  covers: [
    { id: 'input-cover', rect: { x: 0, y: 0, w: 130, h: 24 }, color: '#C0BEB6', hinge: 'top' },
    { id: 'output-cover', rect: { x: 0, y: 66, w: 130, h: 24 }, color: '#C0BEB6', hinge: 'bottom' },
  ],
  leds: [
    ...ledRow(
      ['POWER', 'RUN', 'ERR', 'ALM'],
      'status',
      { x: 6, y: 27, w: 4, h: 3, pitch: 9 },
      PLC_LED_GREEN,
    ),
    ...ledRow(
      CP1E_SPEC.inputs.map((input) => input.name),
      'input',
      { x: 5, y: 35, w: 3, h: 3, pitch: 6.8 },
      PLC_LED_AMBER,
    ),
    ...ledRow(
      CP1E_SPEC.outputs.map((output) => output.name),
      'output',
      { x: 5, y: 41, w: 3, h: 3, pitch: 6.8 },
      PLC_LED_AMBER,
    ),
  ],
  features: [
    {
      id: 'usb',
      kind: 'port',
      label: '周辺USBポート',
      rect: { x: 6, y: 48, w: 14, h: 10 },
      color: '#2A2A2A',
    },
    {
      id: 'option-slot',
      kind: 'slot',
      label: 'オプションボードスロット',
      rect: { x: 26, y: 47, w: 26, h: 12 },
      color: '#B3B0A8',
    },
  ],
  assumed: [
    '筐体色・端子台色（一般に知られた見え方。実機写真は使っていない）',
    'LED・USBポート・オプションボードスロットの面上の位置',
    '本体表示LEDの種類は §10.1 の【本アプリの前提】（PLC調査資料 O-3 が未確認）',
    '銘板は型式の文字列のみ（ロゴ・ブランド名は描かない）',
  ],
};

/** OMRON CP1E-N30DR-A（一体形）。§10.1 */
export const PLC_UNIT_CP1E: PlcUnitDefinition = {
  id: 'cp1e',
  model: 'CP1E',
  vendor: 'omron',
  displayName: 'OMRON CP1E-N30DR-A',
  form: 'unit',
  sizeMm: { width: 130, height: 90, depth: 85 },
  pos: PLC_ORIGIN_MM,
  spec: CP1E_SPEC,
  terminals: cp1eTerminals(),
  appearance: CP1E_APPEARANCE,
  // 【本アプリの前提】PLC調査資料 O-3 が未確認のため §10.1 の記載どおり
  leds: ['POWER', 'RUN', 'ERR', 'ALM'],
};

/** ラック形モジュール1枚の幅[mm]。§10.1 / §17.1 の前提値 */
export const RACK_MODULE_WIDTH_MM = 35;
/** ラック形モジュールの高さ[mm]。 */
export const RACK_MODULE_HEIGHT_MM = 130;
/** ベースの左右の余白[mm]。 */
export const RACK_BASE_MARGIN_MM = 10;
/** ベースの高さ[mm]（モジュール高さ＋上下の縁）。 */
export const RACK_BASE_HEIGHT_MM = 140;
/** モジュール左端から端子2列までの距離[mm]。 */
export const RACK_TERMINAL_COLS_MM: readonly [number, number] = [9, 26];
/** モジュール内の端子の段ピッチ[mm]。 */
export const RACK_TERMINAL_ROW_PITCH_MM = 13;
/** モジュール上端から最初の段までの距離[mm]（上の帯は入出力表示灯に空ける）。 */
export const RACK_TERMINAL_TOP_MM = 14;
/** 1モジュールに並べられる端子数の上限（2列×9段）。 */
export const RACK_TERMINALS_PER_MODULE = 18;

/** スロット番号 → モジュールの左奥の角。 */
export function rackModulePos(slot: number): Vec3 {
  return vec3(
    PLC_ORIGIN_MM.x + RACK_BASE_MARGIN_MM + slot * RACK_MODULE_WIDTH_MM,
    PLC_ORIGIN_MM.y + 5,
    PLC_ORIGIN_MM.z,
  );
}

/** ベースの外形（モジュール幅の合計＋左右の余白）。§10.1 の前提 */
export function rackSizeMm(
  slots: number,
  depthMm: number,
): {
  width: number;
  height: number;
  depth: number;
} {
  return {
    width: slots * RACK_MODULE_WIDTH_MM + 2 * RACK_BASE_MARGIN_MM,
    height: RACK_BASE_HEIGHT_MM,
    depth: depthMm,
  };
}

/**
 * モジュール1枚の端子を2列×最大9段で並べる。§17 #11 / 決定表#12
 * 実機の着脱式端子台は1列だが、当たり判定半径4mm（＝8mm離す必要）が高さ130mmに18点は入らない
 * ため、本アプリは2列に配置する。実機の並びが判明したらここだけを差し替える。
 */
function rackTerminals(spec: PlcUnitSpec, names: readonly string[], slot: number): BoardTerminal[] {
  if (names.length > RACK_TERMINALS_PER_MODULE) {
    throw new BoardError(
      `1モジュールの端子は${RACK_TERMINALS_PER_MODULE}点までです: ${names.length}点`,
    );
  }
  const origin = rackModulePos(slot);
  return names.map((name, index) => ({
    id: `${PLC_PART_ID}.${name}` as TerminalId,
    label: plcLabel(name),
    role: plcRole(spec, name),
    pos: vec3(
      origin.x + (RACK_TERMINAL_COLS_MM[index % 2] ?? 0),
      origin.y + RACK_TERMINAL_TOP_MM + Math.floor(index / 2) * RACK_TERMINAL_ROW_PITCH_MM,
      origin.z,
    ),
    pickRadiusMm: TERMINAL_PICK_RADIUS_MM,
    wirable: true,
    optional: false,
    exit: 'either',
  }));
}

/** 16進表記の端子名を作る（`X0`〜`XF`、`start` を与えると `Y10`〜`Y1F`）。§10.1 */
export function hexNames(prefix: string, count: number, start = 0): string[] {
  return Array.from(
    { length: count },
    (_unused, i) => `${prefix}${(start + i).toString(16).toUpperCase()}`,
  );
}

/**
 * `OUT-12` の先頭アドレス。`@ojt/plc-dialects` の `jtekt.ts` の `OUTPUT_BASE` と同じ値で、
 * 端子の印字（`Y10`）と方言表記（`1Y010`）を揃えるためにある（決定表#16）。
 * 片方だけ変えると `plcWiringPlan()` が引く端子名とラダーの表記がずれるので、必ず両方直す。
 */
export const PC10G_OUTPUT_BASE = 0x010;

/** TOYOPUC `IN-12` の入力抵抗[Ω]（10mA/点）。§5.1.3 */
export const PC10G_INPUT_OHMS = 2400;
/** ラック形の入出力モジュールの1コモンあたりの点数。§10.1（`IN-12` は8点/COM） */
export const RACK_POINTS_PER_COMMON = 8;

/** TOYOPUC PC10G-1SP ラックの電気的な仕様。§10.1 / §5.1.3 / §17 #21 */
export const PC10G_SPEC: PlcUnitSpec = {
  model: 'PC10G-1SP',
  power: ['L', 'N', 'PE'],
  acPower: ['L', 'N'],
  inputCommons: ['ICOM0', 'ICOM1'],
  inputs: hexNames('X', 16).map((name, index) => ({
    name,
    com: `ICOM${Math.floor(index / RACK_POINTS_PER_COMMON)}`,
    ohms: PC10G_INPUT_OHMS,
  })),
  commons: ['COM0', 'COM1'],
  outputs: hexNames('Y', 16, PC10G_OUTPUT_BASE).map((name, index) => ({
    name,
    com: `COM${Math.floor(index / RACK_POINTS_PER_COMMON)}`,
  })),
};

/** TOYOPUC ラックの端子（`POWER1` → `IN-12` → `OUT-12` の順）。§10.1 の記載順 */
function pc10gTerminals(): BoardTerminal[] {
  const inputNames = [
    'ICOM0',
    ...PC10G_SPEC.inputs.slice(0, RACK_POINTS_PER_COMMON).map((i) => i.name),
    'ICOM1',
    ...PC10G_SPEC.inputs.slice(RACK_POINTS_PER_COMMON).map((i) => i.name),
  ];
  const outputNames = [
    'COM0',
    ...PC10G_SPEC.outputs.slice(0, RACK_POINTS_PER_COMMON).map((o) => o.name),
    'COM1',
    ...PC10G_SPEC.outputs.slice(RACK_POINTS_PER_COMMON).map((o) => o.name),
  ];
  return [
    ...rackTerminals(PC10G_SPEC, [...PC10G_SPEC.power], 0),
    ...rackTerminals(PC10G_SPEC, inputNames, 2),
    ...rackTerminals(PC10G_SPEC, outputNames, 3),
  ];
}

/**
 * ラックのモジュール1枚ぶんの外観を組み立てる。§10.1 / 決定表#15
 * 上端の帯（y 0〜12mm）が入出力表示灯、その下が端子台カバー、最下段が銘板と固定ラッチである。
 * 色と配置は一般に知られた見え方から作図した本アプリの記述で、実機写真は使っていない（§17.1）。
 */
function rackFace(options: {
  model: string;
  bodyColor: string;
  terminalColor: string;
  /** 端子台カバーの矩形（端子を持たないモジュールは省略）。 */
  cover?: FaceRect;
  /** 本体表示LED（列の上端 y）。 */
  statusLeds?: { names: readonly string[]; y: number };
  /** 入出力表示灯。上端の帯に `perRow` 点ずつ並べる（`JW-212NA` は A/B 各8点2段）。 */
  pointLeds?: { names: readonly string[]; group: 'input' | 'output'; perRow: number };
  features?: readonly PlcFeatureMark[];
  assumed: readonly string[];
}): PlcAppearance {
  const leds: PlcLedMark[] = [];
  if (options.statusLeds !== undefined) {
    leds.push(
      ...ledRow(
        options.statusLeds.names,
        'status',
        { x: 4, y: options.statusLeds.y, w: 4, h: 3, pitch: 9 },
        PLC_LED_GREEN,
      ),
    );
  }
  const points = options.pointLeds;
  if (points !== undefined) {
    for (let row = 0; row * points.perRow < points.names.length; row += 1) {
      leds.push(
        ...ledRow(
          points.names.slice(row * points.perRow, (row + 1) * points.perRow),
          points.group,
          { x: 3, y: 3 + row * 5, w: 2.5, h: 2.5, pitch: 3.8 },
          PLC_LED_AMBER,
        ),
      );
    }
  }
  return {
    faceMm: { width: RACK_MODULE_WIDTH_MM, height: RACK_MODULE_HEIGHT_MM },
    bodyColor: options.bodyColor,
    terminalBlockColor: options.terminalColor,
    nameplate: options.model,
    nameplateRect: { x: 2, y: 123, w: 22, h: 5 },
    covers:
      options.cover === undefined
        ? []
        : [
            {
              id: 'terminal-cover',
              rect: options.cover,
              color: options.terminalColor,
              hinge: 'top' as const,
            },
          ],
    leds,
    features: [
      ...(options.features ?? []),
      {
        id: 'latch',
        kind: 'latch',
        label: 'モジュール固定ラッチ',
        rect: { x: 27, y: 123, w: 6, h: 5 },
        color: '#7A7F86',
      },
    ],
    assumed: options.assumed,
  };
}

/** ラックのモジュール一覧を作る。 */
function rackModules(
  entries: readonly {
    model: string;
    displayName: string;
    depthMm: number;
    appearance: PlcAppearance;
  }[],
): PlcModuleDefinition[] {
  return entries.map((entry, slot) => ({
    slot,
    model: entry.model,
    displayName: entry.displayName,
    sizeMm: { width: RACK_MODULE_WIDTH_MM, height: RACK_MODULE_HEIGHT_MM, depth: entry.depthMm },
    pos: rackModulePos(slot),
    appearance: entry.appearance,
  }));
}

/** TOYOPUC モジュールの筐体色（明灰）。 */
const PC10G_BODY_COLOR = '#B9BCC1';
/** TOYOPUC の端子台色（黒）。 */
const PC10G_TERMINAL_COLOR = '#22262B';
/** ラック形の外観が前提値である旨（4スロット共通）。§17.1 */
const RACK_ASSUMED: readonly string[] = [
  'モジュールの筐体色・端子台色（一般に知られた見え方。実機写真は使っていない）',
  '表示灯・スイッチ・コネクタ・固定ラッチの面上の位置（カタログ寸法から作図）',
  '端子台カバーの範囲（端子を2列に並べた本アプリの配置に合わせてある。決定表#12）',
  '銘板は型式の文字列のみ（ロゴ・ブランド名は描かない）',
];

/** JTEKT TOYOPUC PC10G-1SP（ラック形）。§10.1 / §17 #21 */
export const PLC_UNIT_PC10G: PlcUnitDefinition = {
  id: 'pc10g',
  model: 'PC10G-1SP',
  vendor: 'jtekt',
  displayName: 'JTEKT TOYOPUC PC10G-1SP（基本ベース＋POWER1＋CPU＋IN-12＋OUT-12）',
  form: 'rack',
  sizeMm: rackSizeMm(4, 120),
  pos: PLC_ORIGIN_MM,
  spec: PC10G_SPEC,
  terminals: pc10gTerminals(),
  appearance: {
    faceMm: { width: rackSizeMm(4, 120).width, height: RACK_BASE_HEIGHT_MM },
    bodyColor: '#9AA0A6',
    terminalBlockColor: PC10G_TERMINAL_COLOR,
    nameplate: 'PC10G-1SP',
    nameplateRect: { x: 4, y: 132, w: 40, h: 6 },
    covers: [],
    leds: [],
    // ベース側の造作はモジュールを並べるスロットのレールだけ（モジュールはこの上に載る）
    features: [
      {
        id: 'slot-rail',
        kind: 'slot',
        label: '基本ベース（電源部＋3スロット）',
        rect: { x: 0, y: 0, w: rackSizeMm(4, 120).width, h: RACK_BASE_HEIGHT_MM },
        color: '#7E848B',
      },
    ],
    assumed: RACK_ASSUMED,
  },
  modules: rackModules([
    {
      model: 'POWER1',
      displayName: '電源モジュール',
      depthMm: 120,
      appearance: rackFace({
        model: 'POWER1',
        bodyColor: PC10G_BODY_COLOR,
        terminalColor: PC10G_TERMINAL_COLOR,
        cover: { x: 0, y: 12, w: 35, h: 28 },
        statusLeds: { names: ['POWER'], y: 46 },
        assumed: RACK_ASSUMED,
      }),
    },
    {
      model: 'PC10G-1SP',
      displayName: 'CPUモジュール',
      depthMm: 120,
      appearance: rackFace({
        model: 'PC10G-1SP',
        bodyColor: PC10G_BODY_COLOR,
        terminalColor: PC10G_TERMINAL_COLOR,
        statusLeds: { names: ['RUN', 'ERR'], y: 20 },
        features: [
          {
            id: 'run-stop',
            kind: 'switch',
            label: 'RUN/STOPスイッチ',
            rect: { x: 6, y: 34, w: 23, h: 8 },
            color: '#8A8F96',
          },
          {
            id: 'peripheral',
            kind: 'port',
            label: 'ツールポート',
            rect: { x: 8, y: 50, w: 19, h: 12 },
            color: PC10G_TERMINAL_COLOR,
          },
        ],
        assumed: RACK_ASSUMED,
      }),
    },
    {
      model: 'IN-12',
      displayName: 'DC入力16点（THK-2750）',
      depthMm: 120,
      appearance: rackFace({
        model: 'IN-12',
        bodyColor: PC10G_BODY_COLOR,
        terminalColor: PC10G_TERMINAL_COLOR,
        cover: { x: 0, y: 12, w: 35, h: 110 },
        pointLeds: { names: hexNames('X', 16), group: 'input', perRow: 8 },
        assumed: RACK_ASSUMED,
      }),
    },
    {
      model: 'OUT-12',
      displayName: 'リレー出力16点（THK-2752）',
      depthMm: 120,
      appearance: rackFace({
        model: 'OUT-12',
        bodyColor: PC10G_BODY_COLOR,
        terminalColor: PC10G_TERMINAL_COLOR,
        cover: { x: 0, y: 12, w: 35, h: 110 },
        pointLeds: { names: hexNames('Y', 16, PC10G_OUTPUT_BASE), group: 'output', perRow: 8 },
        assumed: RACK_ASSUMED,
      }),
    },
  ]),
  // 【本アプリの前提】PLC調査資料 J-3 が未確認のため §10.1 の記載どおり
  leds: ['POWER', 'RUN', 'ERR', 'IN'],
};

/** 機種名（課題JSONの `plc.model`）→ 本体定義。Phase 4 で3機種増える。§7.6 */
export const PLC_UNITS: Readonly<Record<string, PlcUnitDefinition>> = {
  FX5U: PLC_UNIT_FX5U,
  CP1E: PLC_UNIT_CP1E,
  'PC10G-1SP': PLC_UNIT_PC10G,
};

/** 機種名から本体定義を引く。未対応の機種は undefined（課題エラーにするのは content の責務）。 */
export function plcUnitFor(model: string): PlcUnitDefinition | undefined {
  return PLC_UNITS[model];
}

/** 壁コンセント（AC100V）の端子。§10.1 */
export const OUTLET_TERMINALS: readonly BoardTerminal[] = (['L', 'N'] as const).map(
  (name, index) => ({
    id: `${OUTLET_ID}.${name}` as TerminalId,
    label: name,
    role: name === 'L' ? ('ac-l' as const) : ('ac-n' as const),
    pos: vec3(OUTLET_ORIGIN_MM.x + index * PLC_TERMINAL_PITCH_MM, OUTLET_ORIGIN_MM.y, 0),
    pickRadiusMm: TERMINAL_PICK_RADIUS_MM,
    wirable: true,
    optional: false,
    exit: 'either' as const,
  }),
);

/**
 * 盤にPLC本体と壁コンセントを載せた**派生盤**を返す。§10.1 / 決定表#8
 * `id` は変えない（セッションは `boardId` で盤と照合するため）。占有矩形・配線帯は
 * 机上の装置を含まないので、盤の経路生成の不変条件（§6.6）はそのまま保たれる。
 */
export function withPlcUnit(board: BoardDefinition, unit: PlcUnitDefinition): BoardDefinition {
  return {
    ...board,
    plcUnit: unit,
    terminals: [...board.terminals, ...unit.terminals, ...OUTLET_TERMINALS],
  };
}
