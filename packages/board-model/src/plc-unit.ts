import { type PlcUnitSpec, type TerminalId } from '@ojt/circuit-sim';
import {
  OUTLET_ID,
  PLC_PART_ID,
  TERMINAL_PICK_RADIUS_MM,
  type BoardDefinition,
  type BoardTerminal,
  type PlcAppearance,
  type PlcLedMark,
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

/** 機種名（課題JSONの `plc.model`）→ 本体定義。Phase 4 で3機種増える。§7.6 */
export const PLC_UNITS: Readonly<Record<string, PlcUnitDefinition>> = {
  FX5U: PLC_UNIT_FX5U,
  CP1E: PLC_UNIT_CP1E,
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
