import {
  OUTLET_ID,
  PB_BLOCK_ID,
  PL_BLOCK_ID,
  PLC_PART_ID,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { buildNets, terminalId, type Nets, type TerminalId } from '@ojt/circuit-sim';
import type { PlcCheckContext, StaticCheckInput, StaticCheckResult } from './static-check-types.js';

// 型は `static-check-types.ts` に置いてある。呼び出し側の import 先を増やさないため再エクスポートする
export type { PlcCheckContext };

/**
 * モードDの静的チェック。設計仕様 §7.4 / §10.2 / §10.8。
 *
 * 通電せずに構造だけで判定する（§2 用語「静的チェック」）ので、見るのは `buildNets()` が返す
 * 「同じ節点に居る端子の一覧」だけである。電線・0Ωリンクで繋がっている端子は同じ節点になるため、
 * 渡り配線を何段重ねても正しく追える。
 */

/** 盤の電源系端子の接頭辞（ここから PLC の電源を取ってはならない）。§10.1 */
export const BOARD_POWER_PREFIXES: readonly string[] = ['P.', 'N.', 'PS.', 'CB.', 'SW.'];

/** リレーの接点ピンの最大番号（13/14 はコイル）。§6.4 */
const CONTACT_PIN_MAX = 12;

function result(
  id: StaticCheckResult['id'],
  details: string[],
  okMessage: string,
  ngMessage: string,
): StaticCheckResult {
  return details.length === 0
    ? { id, ok: true, message: okMessage, details }
    : { id, ok: false, message: ngMessage, details };
}

/** モードDの文脈が無いまま有効にされたときの結果。 */
function missingContext(id: StaticCheckResult['id']): StaticCheckResult {
  return {
    id,
    ok: false,
    message: 'PLC課題ではないためこの検査は実行できません',
    details: ['この静的チェックはモードDの課題でのみ有効にできます（§7.4）'],
  };
}

/** その端子と同じ節点にいる端子の一覧（端子が無ければ空）。 */
function netTerminals(nets: Nets, terminal: TerminalId): readonly TerminalId[] {
  if (!nets.hasTerminal(terminal)) return [];
  return nets.terminalsOf(nets.nodeOf(terminal));
}

/** PLCの端子ID。 */
function plcTerminal(name: string): TerminalId {
  return terminalId(PLC_PART_ID, name);
}

/**
 * 割付の出力番号 → PLCの出力端子。
 * 割付の `y` は10進の装置番号なので、端子名（三菱なら8進）は必ず機種仕様から引く。§10.1
 */
function outputTerminal(unit: PlcUnitDefinition, y: number): TerminalId {
  return plcTerminal(unit.spec.outputs[y]?.name ?? `Y${y}`);
}

/** 割付の入力番号 → PLCの入力端子。 */
function inputTerminal(unit: PlcUnitDefinition, x: number): TerminalId {
  return plcTerminal(unit.spec.inputs[x] ?? `X${x}`);
}

/** 入力コモンの結線方式を判定する。§10.2 */
export function detectPlcWiring(
  nets: Nets,
  unit: PlcUnitDefinition,
): 'sink' | 'source' | undefined {
  const terminals = netTerminals(nets, plcTerminal(unit.spec.inputCommon));
  if (terminals.some((id) => id.startsWith('P.'))) return 'sink';
  if (terminals.some((id) => id.startsWith('N.'))) return 'source';
  return undefined;
}

/**
 * 2段結線。§10.2 / §7.4
 * Y出力は盤のリレーのコイルへ、リレーの接点がランプへ、という2段でなければならない。
 * Y → ランプの直結（`twoStage` 違反）と、Y がどのコイルにも繋がっていない場合を検出する。
 */
export function checkTwoStage(input: StaticCheckInput): StaticCheckResult {
  const plc = input.plc;
  if (plc === undefined) return missingContext('twoStage');
  const nets = buildNets(input.netlist);
  const details: string[] = [];
  for (const output of plc.io.outputs) {
    const yTerminal = outputTerminal(plc.unit, output.y);
    const yNet = netTerminals(nets, yTerminal);
    if (yNet.some((id) => id.startsWith(`${PL_BLOCK_ID}.`))) {
      details.push(`${yTerminal} が ${output.pl} に直結しています（盤のリレーを介します）`);
      continue;
    }
    if (!yNet.includes(terminalId(output.cr, '14'))) {
      details.push(
        `${yTerminal} がリレー ${output.cr} のコイル（${output.cr}.14）に繋がっていません`,
      );
      continue;
    }
    const lampNet = netTerminals(nets, terminalId(PL_BLOCK_ID, `${output.pl.slice(2)}+`));
    const drivenByContact = lampNet.some((id) => {
      if (!id.startsWith(`${output.cr}.`)) return false;
      const pin = Number(id.slice(output.cr.length + 1));
      return pin >= 1 && pin <= CONTACT_PIN_MAX; // 接点（COM・a・b）のピン。コイル（13/14）は除く
    });
    if (!drivenByContact) {
      details.push(`${output.pl} が ${output.cr} の接点から駆動されていません`);
    }
  }
  return result(
    'twoStage',
    details,
    'PLC出力 → 盤のリレー → 表示灯の2段結線になっています',
    'PLCの出力を表示灯へ直結しています（盤のリレーを介してください）',
  );
}

/**
 * PLC電源の独立。§10.1 / §7.4
 * 盤の AC100V / DC24V から PLC本体の電源を取ってはならない（調査資料 §1.5）。
 * 入力回路（`S/S` と `Xn`）に盤のDC24Vを使うのは違反ではない（§10.2）。
 */
export function checkPlcPowerIndependent(input: StaticCheckInput): StaticCheckResult {
  const plc = input.plc;
  if (plc === undefined) return missingContext('plcPowerIndependent');
  const nets = buildNets(input.netlist);
  const details: string[] = [];
  for (const name of ['L', 'N']) {
    const terminal = plcTerminal(name);
    const terminals = netTerminals(nets, terminal);
    const fromBoard = terminals.filter((id) =>
      BOARD_POWER_PREFIXES.some((prefix) => id.startsWith(prefix)),
    );
    if (fromBoard.length > 0) {
      details.push(`${terminal} が盤の電源（${fromBoard.join('・')}）に繋がっています`);
      continue;
    }
    if (!terminals.some((id) => id.startsWith(`${OUTLET_ID}.`))) {
      details.push(`${terminal} が壁コンセントに配線されていません`);
    }
  }
  return result(
    'plcPowerIndependent',
    details,
    'PLCの電源は盤から独立しています',
    'PLCの電源を盤から取っています（壁コンセントに配線してください）',
  );
}

/** I/O割付の遵守。§7.4 / §7.6 */
export function checkIoAssignment(input: StaticCheckInput): StaticCheckResult {
  const plc = input.plc;
  if (plc === undefined) return missingContext('ioAssignment');
  if (plc.io.mode === 'free') {
    return {
      id: 'ioAssignment',
      ok: true,
      message: 'I/O割付は自由です（課題が固定していません）',
      details: [],
    };
  }
  const nets = buildNets(input.netlist);
  const details: string[] = [];
  for (const assigned of plc.io.inputs) {
    const terminal = inputTerminal(plc.unit, assigned.x);
    const expected = terminalId(PB_BLOCK_ID, `${assigned.pb.slice(2)}a`);
    if (!netTerminals(nets, terminal).includes(expected)) {
      details.push(`${terminal} は ${assigned.pb} のa接点（${expected}）に割り付けます`);
    }
  }
  for (const output of plc.io.outputs) {
    const terminal = outputTerminal(plc.unit, output.y);
    const expected = terminalId(output.cr, '14');
    if (!netTerminals(nets, terminal).includes(expected)) {
      details.push(`${terminal} は ${output.cr} のコイル（${expected}）に割り付けます`);
    }
  }
  const wiring = detectPlcWiring(nets, plc.unit);
  if (wiring === undefined) {
    details.push('入力コモン（S/S）が盤のP側・N側のどちらにも配線されていません');
  } else if (wiring !== plc.io.wiring) {
    details.push(
      `入力コモン（S/S）の結線が課題の指定（${plc.io.wiring}）と違います（${wiring} になっています）`,
    );
  }
  return result(
    'ioAssignment',
    details,
    'I/O割付どおりに配線されています',
    'I/O割付と配線が食い違っています',
  );
}
