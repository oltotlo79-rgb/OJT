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
 * `y` は `PlcProblemSchema` が機種仕様の点数内に収まっていることを既に検証済みなので、
 * ここでは三菱形（`Yn`）のフォールバックは持たない — 他機種の課題にまで三菱の表記が
 * 紛れ込む方が、存在しない番号でここに来て例外になるより見つけにくい事故になる（レビュー M3）。
 */
function outputTerminal(unit: PlcUnitDefinition, y: number): TerminalId {
  const output = unit.spec.outputs[y];
  /* c8 ignore next 3 -- PlcProblemSchema が y を機種の出力点数内に検証済みのため到達しない */
  if (output === undefined) {
    throw new RangeError(`${unit.model} に出力 y=${y} がありません（割付は検証済みのはずです）`);
  }
  return plcTerminal(output.name);
}

/** 割付の入力番号 → PLCの入力端子（フォールバックを持たない理由は `outputTerminal` と同じ）。 */
function inputTerminal(unit: PlcUnitDefinition, x: number): TerminalId {
  const input = unit.spec.inputs[x];
  /* c8 ignore next 3 -- PlcProblemSchema が x を機種の入力点数内に検証済みのため到達しない */
  if (input === undefined) {
    throw new RangeError(`${unit.model} に入力 x=${x} がありません（割付は検証済みのはずです）`);
  }
  return plcTerminal(input.name);
}

/**
 * 課題が使う入力点がぶら下がっている入力コモンの一覧（機種仕様の並び順）。§10.2
 *
 * 8点1コモンの機種（ラック形）はコモンが複数あるので、模範配線（`plc-reference.ts`）も
 * 結線方式の判定（`checkIoAssignment` の末尾）も **使う点のコモンだけ** を見る。課題が
 * 使わない群のコモン（`ICOM1` / `COM.B` など）は模範配線でも浮いたままなので、そこまで
 * 数えると「未配線」と見分けがつかない（決定表: 使う点のコモン。plc-reference.ts と
 * plc-static-checks.ts の重複を1箇所にまとめた。レビュー M4）。
 *
 * `io.inputs` は `fixed` / `free` のどちらでも最低1点あるので（`PlcIoSchema.inputs.min(1)` と
 * `resolvePlcIo()` の既定割付）、返り値が空になることはない — 呼び出し側の「空なら機種の全コモン」
 * というフォールバックは到達しないので持たない（レビュー M4）。
 */
export function usedInputCommons(
  unit: PlcUnitDefinition,
  io: Pick<PlcCheckContext['io'], 'inputs'>,
): readonly string[] {
  const used = new Set(
    io.inputs.flatMap((assigned) => {
      const com = unit.spec.inputs[assigned.x]?.com;
      return com === undefined ? [] : [com];
    }),
  );
  return unit.spec.inputCommons.filter((name) => used.has(name));
}

/**
 * 入力コモンの結線方式。`mismatch` は見たコモンの間でP側とN側が混ざっている。§10.2
 */
export type PlcInputWiring = 'sink' | 'source' | 'mismatch';

/**
 * 入力コモンの結線方式を判定する。§10.2
 * 8点1コモンの機種はコモンが複数あるので、**見るべきコモンがすべて同じ側に揃っているか**を見る。
 * 最初に見つかった1本で打ち切ると、`ICOM0`→P・`ICOM1`→N のような誤配線を `sink` と報告してしまう。
 * `commons` を省くと機種の入力コモンをすべて見る（未配線のコモンはどちらにも数えない）。
 */
export function detectPlcWiring(
  nets: Nets,
  unit: PlcUnitDefinition,
  commons: readonly string[] = unit.spec.inputCommons,
): PlcInputWiring | undefined {
  let sink = false;
  let source = false;
  for (const name of commons) {
    const terminals = netTerminals(nets, plcTerminal(name));
    if (terminals.some((id) => id.startsWith('P.'))) sink = true;
    if (terminals.some((id) => id.startsWith('N.'))) source = true;
  }
  if (sink && source) return 'mismatch';
  if (sink) return 'sink';
  if (source) return 'source';
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
  for (const name of plc.unit.spec.acPower) {
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
  // 端子名は機種で違う（三菱 `X0` / CP1E `0.00` / JW300 `A0` / TOYOPUC `Y1A`）ので、正規表現ではなく
  // 機種仕様の端子集合で判定する（前提#19）
  const inputIds = new Set(plc.unit.spec.inputs.map((input) => String(plcTerminal(input.name))));
  const outputIds = new Set(
    plc.unit.spec.outputs.map((output) => String(plcTerminal(output.name))),
  );
  const isPlcX = (id: string): boolean => inputIds.has(id);
  const isPlcY = (id: string): boolean => outputIds.has(id);
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
  // 入力コモンの配線漏れは**コモンごと**に1件で報告する。8点1コモンの機種は同じコモンに複数の
  // 使用点がぶら下がるので、点ごとのループの中で数えると同じコモンの指摘が点の数だけ繰り返し出る
  // （FX5U はコモンが1つしかないので、3点使えば3行同じ指摘が出ていた。レビュー M7）
  for (const com of usedInputCommons(plc.unit, plc.io)) {
    if (netTerminals(nets, plcTerminal(com)).length <= 1) {
      details.push(`入力コモン（${plcTerminal(com)}）が配線されていません（受入基準③⑤）`);
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
    const outputCom = plc.unit.spec.outputs[output.y]?.com;
    if (outputCom !== undefined && netTerminals(nets, plcTerminal(outputCom)).length <= 1) {
      details.push(`${terminal} の出力コモン（${plcTerminal(outputCom)}）が配線されていません`);
    }
  }
  // 結線方式は**使う点のコモン**だけで見る。課題が使わない群のコモン（`ICOM1` など）は
  // 模範配線でも浮いているので、数えると未配線と見分けがつかない
  const commons = usedInputCommons(plc.unit, plc.io);
  // 端子名は機種で違う（`S/S` / `COM` / `ICOM0` / `COM.A`）ので文言に直書きしない（引き渡し注記 H-1）
  const commonLabel = commons.map((name) => String(plcTerminal(name))).join('・');
  const wiring = detectPlcWiring(nets, plc.unit, commons);
  if (wiring === undefined) {
    details.push(`入力コモン（${commonLabel}）が盤のP側・N側のどちらにも配線されていません`);
  } else if (wiring === 'mismatch') {
    // コモンが1つだけの機種（FX5U の S/S、CP1E の COM）で mismatch になるのは、その1本自体が
    // P側とN側を短絡しているということなので「すべて同じ側に揃えます」は意味を成さない。
    // コモンが複数（ラック形）のときだけ、コモン同士の食い違いとして揃えるよう促す（レビュー M7）
    details.push(
      commons.length === 1
        ? `入力コモン（${commonLabel}）でP側とN側を短絡しています`
        : `入力コモン（${commonLabel}）のP側・N側が食い違っています（すべて同じ側に揃えます）`,
    );
  } else if (wiring !== plc.io.wiring) {
    details.push(
      `入力コモン（${commonLabel}）の結線が課題の指定（${plc.io.wiring}）と違います（${wiring} になっています）`,
    );
  }
  return result(
    'ioAssignment',
    details,
    'I/O割付どおりに配線されています',
    'I/O割付と配線が食い違っています',
  );
}
