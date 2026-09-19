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

/** 端子が中継リレーの接点ピン（COM・a・b。13/14のコイルは除く）か。§6.4 */
function isRelayContactId(id: string): boolean {
  const match = /^(CR\d+)\.(\d+)$/.exec(id);
  if (match === null) return false;
  const pin = Number(match[2]);
  return pin >= 1 && pin <= CONTACT_PIN_MAX;
}

/** 端子が中継リレーのコイル（`CRn.14`）か。§6.4 */
function isRelayCoilId(id: string): boolean {
  return /^CR\d+\.14$/.test(id);
}

/**
 * 2段結線（`io.mode: 'fixed'`）。割付どおりの Y/CR/PL の組で検査する。
 * Y → ランプの直結（`twoStage` 違反）と、Y がどのコイルにも繋がっていない場合を検出する。
 */
function checkTwoStageFixed(
  nets: Nets,
  unit: PlcUnitDefinition,
  outputs: PlcCheckContext['io']['outputs'],
): string[] {
  const details: string[] = [];
  for (const output of outputs) {
    const yTerminal = outputTerminal(unit, output.y);
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
    const drivenByContact = lampNet.some(
      (id) => id.startsWith(`${output.cr}.`) && isRelayContactId(id),
    );
    if (!drivenByContact) {
      details.push(`${output.pl} が ${output.cr} の接点から駆動されていません`);
    }
  }
  return details;
}

/**
 * 2段結線（`io.mode: 'free'`）。割付を強制しないので、機種仕様の全Y端子・全PL端子について
 * 「配線されているなら正しく2段になっているか」を見る（未配線の端子は課題が使っていないので無視）。
 * 割付表（`plc.io.outputs`）は既定割付のままのことがあるため使わない（§17.2 #9 / 差分 #6）。
 */
function checkTwoStageFree(nets: Nets, unit: PlcUnitDefinition): string[] {
  const details: string[] = [];
  for (const output of unit.spec.outputs) {
    const yTerminal = plcTerminal(output.name);
    const yNet = netTerminals(nets, yTerminal);
    if (yNet.length <= 1) continue; // 未配線（自分自身しかいない節点）
    const directLamp = yNet.find((id) => id.startsWith(`${PL_BLOCK_ID}.`));
    if (directLamp !== undefined) {
      const plName = `PL${directLamp.slice(PL_BLOCK_ID.length + 1, -1)}`;
      details.push(`${yTerminal} が ${plName} に直結しています（盤のリレーを介します）`);
      continue;
    }
    if (!yNet.some(isRelayCoilId)) {
      details.push(`${yTerminal} がリレーのコイル（CRn.14）に繋がっていません`);
    }
  }
  for (let n = 1; n <= 4; n += 1) {
    const lampTerminal = terminalId(PL_BLOCK_ID, `${n}+`);
    const lampNet = netTerminals(nets, lampTerminal);
    // 端子台とランプ本体は固定ハーネスで常時リンク済みなので、未配線でも節点には2端子いる（§6.4）。
    // それを超えて何か（リレー接点など）が繋がっていなければ、この課題では使っていないランプ。
    if (lampNet.length <= 2) continue;
    if (!lampNet.some(isRelayContactId)) {
      details.push(`PL${n} がリレーの接点から駆動されていません`);
    }
  }
  return details;
}

/**
 * 2段結線。§10.2 / §7.4
 * Y出力は盤のリレーのコイルへ、リレーの接点がランプへ、という2段でなければならない。
 * `io.mode: 'fixed'` は割付どおりの組で検査し、`'free'` は配線そのものから検査する（差分 #6）。
 */
export function checkTwoStage(input: StaticCheckInput): StaticCheckResult {
  const plc = input.plc;
  if (plc === undefined) return missingContext('twoStage');
  const nets = buildNets(input.netlist);
  const details =
    plc.io.mode === 'free'
      ? checkTwoStageFree(nets, plc.unit)
      : checkTwoStageFixed(nets, plc.unit, plc.io.outputs);
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
  const isPbA = (id: string): boolean => /^TB_PB\.\d+a$/.test(id);
  const isPlcX = (id: string): boolean => /^PLC\.X\d+$/.test(id);
  const isPlcY = (id: string): boolean => /^PLC\.Y\d+$/.test(id);
  for (const assigned of plc.io.inputs) {
    const terminal = inputTerminal(plc.unit, assigned.x);
    const expected = terminalId(PB_BLOCK_ID, `${assigned.pb.slice(2)}a`);
    const net = netTerminals(nets, terminal);
    if (!net.includes(expected)) {
      details.push(`${terminal} は ${assigned.pb} のa接点（${expected}）に割り付けます`);
      continue;
    }
    // 他の押ボタンのa接点・他のPLC入力端子が同じ節点に短絡していないか（例: X0とX1の短絡）
    const pbCount = net.filter((id) => isPbA(String(id))).length;
    const xCount = net.filter((id) => isPlcX(String(id))).length;
    if (pbCount !== 1 || xCount !== 1) {
      details.push(`${terminal} が別の押ボタンまたはPLC入力端子と短絡しています`);
    }
  }
  for (const output of plc.io.outputs) {
    const terminal = outputTerminal(plc.unit, output.y);
    const expected = terminalId(output.cr, '14');
    const net = netTerminals(nets, terminal);
    if (!net.includes(expected)) {
      details.push(`${terminal} は ${output.cr} のコイル（${expected}）に割り付けます`);
      continue;
    }
    // 他の出力リレーのコイル・他のPLC出力端子が同じ節点に短絡していないか
    const coilCount = net.filter((id) => isRelayCoilId(String(id))).length;
    const yCount = net.filter((id) => isPlcY(String(id))).length;
    if (coilCount !== 1 || yCount !== 1) {
      details.push(`${terminal} が別のリレーコイルまたはPLC出力端子と短絡しています`);
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
