import {
  CLOSED_CONTACT_OHMS,
  PLC_INPUT_OHMS,
  type ContactElement,
  type Element,
  type LoadElement,
} from './elements.js';
import { partId, terminalId, type PartId, type TerminalId } from './ids.js';
import type { Part, PartMeta, PlcInputChannel, PlcOutputChannel } from './parts.js';

/**
 * PLC本体の部品。設計仕様 §4.4 の表をそのまま実装する。
 *
 * | PLC要素 | ネットリスト上の表現 |
 * |---|---|
 * | 入力 Xn | `PLC.SS` と `PLC.Xn` の間の抵抗負荷（機種別。既定 4.7kΩ） |
 * | 出力 Yn | `PLC.Yn` と所属COMの間の接点（`driver: 'external'`。ランタイムが開閉する） |
 * | 電源 L/N | 要素を持たない端子（AC は解かない。§5.2） |
 *
 * 機種ごとの値（端子名・抵抗値・COM分け・外形）は `@ojt/board-model` が持ち、ここには書かない
 * （エンジンは特定の機種に依存しない。§4.2 と同じ考え方）。
 */

/** 入力ON判定の既定しきい値[A]（3mA）。§5.1.3 */
export const PLC_INPUT_ON_AMPS = 0.003;
/** 入力OFF判定の既定しきい値[A]（1.5mA）。§5.1.3 */
export const PLC_INPUT_OFF_AMPS = 0.0015;

/** 出力1点の仕様（端子名と所属COM）。 */
export interface PlcOutputSpec {
  name: string;
  com: string;
}

/** PLC本体1機種の仕様。§10.1 */
export interface PlcUnitSpec {
  /** 機種名（`FX5U` など）。 */
  model: string;
  /** 電源端子名（`L` / `N` / `PE`）。電気的には解かない。 */
  power: readonly string[];
  /** 入力コモン端子名（`S/S` 相当。端子IDに使うので `/` は入れない）。 */
  inputCommon: string;
  /** 本体のサービス電源など、要素を持たない付随端子（`24V` / `0V`）。 */
  service?: readonly string[];
  /** 入力端子名（機種の表記どおり。並び順が入力番号）。 */
  inputs: readonly string[];
  /** 出力コモン端子名。 */
  commons: readonly string[];
  /** 出力端子（並び順が出力番号）。 */
  outputs: readonly PlcOutputSpec[];
  /** 入力回路の抵抗[Ω]。§5.1.3 */
  inputOhms?: number;
  /** ON判定のしきい値[A]。既定 `PLC_INPUT_ON_AMPS`。 */
  onAmps?: number;
  /** OFF判定のしきい値[A]。既定 `PLC_INPUT_OFF_AMPS`。 */
  offAmps?: number;
}

/** PLC部品の組み立てに失敗したときに投げる。 */
export class PlcUnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlcUnitError';
  }
}

/** 部品がPLCならそのメタデータを返す。 */
export function plcMetaOf(part: Part): Extract<PartMeta, { kind: 'plc' }> | undefined {
  return part.meta.kind === 'plc' ? part.meta : undefined;
}

/** PLC本体の部品を作る。§4.4 */
export function createPlcUnit(id: PartId | string, spec: PlcUnitSpec): Part {
  const pid = partId(id);
  const term = (name: string): TerminalId => terminalId(pid, name);
  const commons = new Set(spec.commons);
  for (const output of spec.outputs) {
    if (!commons.has(output.com)) {
      throw new PlcUnitError(`出力 ${output.name} のCOM端子が機種にありません: ${output.com}`);
    }
  }
  const inputOhms = spec.inputOhms ?? PLC_INPUT_OHMS;
  const onAmps = spec.onAmps ?? PLC_INPUT_ON_AMPS;
  const offAmps = spec.offAmps ?? PLC_INPUT_OFF_AMPS;
  if (!(onAmps > offAmps)) {
    throw new PlcUnitError(`ON判定はOFF判定より大きい必要があります: ${onAmps} / ${offAmps}`);
  }

  const inputCommon = term(spec.inputCommon);
  const elements: Element[] = [];
  const inputs: PlcInputChannel[] = spec.inputs.map((name, index) => {
    const terminal = term(name);
    const elementId = `${pid}:in${index}`;
    const load: LoadElement = {
      kind: 'load',
      id: elementId,
      from: inputCommon,
      to: terminal,
      load: 'plcInput',
      nominalOhms: inputOhms,
      polarized: false,
    };
    elements.push(load);
    return { name, terminal, elementId };
  });
  const outputs: PlcOutputChannel[] = spec.outputs.map((output, index) => {
    const terminal = term(output.name);
    const com = term(output.com);
    const elementId = `${pid}:out${index}`;
    const contact: ContactElement = {
      kind: 'contact',
      id: elementId,
      from: terminal,
      to: com,
      contact: 'a',
      driver: 'external',
      driverId: pid,
      group: index,
      energized: false,
      closedOhms: CLOSED_CONTACT_OHMS,
    };
    elements.push(contact);
    return { name: output.name, terminal, com, elementId };
  });

  const terminals: TerminalId[] = [
    ...spec.power.map(term),
    inputCommon,
    ...(spec.service ?? []).map(term),
    ...inputs.map((channel) => channel.terminal),
    ...spec.commons.map(term),
    ...outputs.map((channel) => channel.terminal),
  ];

  return {
    id: pid,
    kind: 'plc',
    terminals,
    elements,
    meta: {
      kind: 'plc',
      model: spec.model,
      inputCommon,
      inputs,
      outputs,
      onAmps,
      offAmps,
      power: spec.power.map(term),
    },
  };
}
