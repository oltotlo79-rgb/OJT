import { type PlcUnitSpec, type TerminalId } from '@ojt/circuit-sim';
import {
  OUTLET_ID,
  PLC_PART_ID,
  TERMINAL_PICK_RADIUS_MM,
  type BoardDefinition,
  type BoardTerminal,
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
  sizeMm: { width: 150, height: 90, depth: 83 },
  pos: PLC_ORIGIN_MM,
  spec: FX5U_SPEC,
  terminals: fx5uTerminals(),
  leds: ['PWR', 'ERR', 'P.RUN', 'BAT', 'CARD'],
};

/** 機種名（課題JSONの `plc.model`）→ 本体定義。Phase 4 で3機種増える。§7.6 */
export const PLC_UNITS: Readonly<Record<string, PlcUnitDefinition>> = {
  FX5U: PLC_UNIT_FX5U,
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
