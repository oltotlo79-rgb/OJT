import { socketPartId, SOCKET_IDS, wireCountAtTerminal } from '@ojt/board-model';
import { MAX_WIRES_PER_TERMINAL, PICKUP_VOLTS, type TerminalId } from '@ojt/circuit-sim';
import { findForbiddenPatterns } from './forbidden.js';
import { checkIoAssignment, checkPlcPowerIndependent, checkTwoStage } from './plc-static-checks.js';
import { STATIC_CHECK_IDS, type StaticCheckId, type StaticChecksData } from './schema/judge.js';
import type { PlcCheckContext, StaticCheckInput, StaticCheckResult } from './static-check-types.js';

/**
 * 静的チェック。設計仕様 §7.4。
 * 通電せずに（＝再生後のログとイベントだけで）判定できる検査をまとめる。
 * 各チェックは `{ id, ok, message, details }` を返し、UIは項目ごとに OK / エラーを並べる（§8.3）。
 */

// 型は `static-check-types.ts` に置いてある（`plc-static-checks.ts` と共有するため）。
// これまでの import 先（`static-checks.js`）をそのまま使えるように再エクスポートする
export type { PlcCheckContext, StaticCheckInput, StaticCheckResult };

function result(id: StaticCheckId, details: string[], okMessage: string, ngMessage: string) {
  return details.length === 0
    ? { id, ok: true, message: okMessage, details }
    : { id, ok: false, message: ngMessage, details };
}

/**
 * 線色ルール。訓練者が引いた電線がパレットの色（モードBは青のみ）かを見る。§7.4 / §4.2 / §8.1
 * 盤に最初から施工されている固定配線（`locked`）は訓練者の責任範囲ではなく、実物でも
 * チェック用回路を含めて**青**で配線されているため、色の検査対象から外す（§6.3）。
 */
export function checkWireColorRule(input: StaticCheckInput): StaticCheckResult {
  const details: string[] = [];
  for (const wire of input.session.wires) {
    if (wire.locked) continue;
    if (input.preexistingWireIds?.has(wire.id) === true) continue;
    if (!input.allowedColors.includes(wire.color)) {
      details.push(
        `${wire.id}: この課題で使えるのは ${input.allowedColors.join('・')} です（${wire.color}）`,
      );
    }
  }
  return result(
    'wireColorRule',
    details,
    '線色は規定どおりです',
    '規定外の線色で配線された箇所があります',
  );
}

/** 1端子2本まで。§7.4 / §6.6 */
export function checkTerminalLimit(input: StaticCheckInput): StaticCheckResult {
  const limit = input.session.boardProfile?.rules.maxWiresPerTerminal ?? MAX_WIRES_PER_TERMINAL;
  const seen = new Set<TerminalId>();
  const details: string[] = [];
  for (const wire of input.session.wires) {
    for (const terminal of [wire.from, wire.to]) {
      if (seen.has(terminal)) continue;
      seen.add(terminal);
      const count = wireCountAtTerminal(input.session, terminal);
      if (count > limit) {
        details.push(`${terminal}: ${count}本（上限は${limit}本）`);
      }
    }
  }
  return result(
    'terminalLimit',
    details,
    '1端子あたりの本数は規定内です',
    `1端子に上限の${limit}本を超えてつながっている箇所があります`,
  );
}

/**
 * 未使用部品。装着したのにどのピンにも電線が1本も来ていない部品を検出する。§7.4
 * （回路への「組み込まれ方」の良否ではなく、盤上で完全に浮いている部品を指摘する。）
 * チェック用ソケットは固定配線で常に励磁できる状態にあるため対象外にする（§6.3）。
 * 役割なしの予備ソケットは物理ソケットIDがそのまま部品IDになる（`socketPartId`。§6.4）。
 */
export function checkUnusedParts(input: StaticCheckInput): StaticCheckResult {
  const wired = new Set<string>();
  for (const wire of input.session.wires) {
    for (const terminal of [wire.from, wire.to]) {
      wired.add(terminal.slice(0, terminal.indexOf('.')));
    }
  }
  const details: string[] = [];
  for (const socket of SOCKET_IDS) {
    const mounted = input.session.mounted[socket];
    if (mounted === undefined) continue;
    if (input.session.socketRoles[socket] === 'CHK') continue;
    const part = socketPartId(input.session.socketRoles, socket);
    if (!wired.has(part)) details.push(`${socket}（${part}）: 装着していますが未接続です`);
  }
  return result(
    'unusedParts',
    details,
    '未接続のまま装着された部品はありません',
    '装着したのに回路に組み込まれていない部品があります',
  );
}

/**
 * チャタリングを訓練者に見える単位の信号名に直す。§5.7
 * エンジンは接点要素ごとに `CR1:a1.closed` という信号も記録するので、リレー1個が震えるだけで
 * 接点8本ぶんのイベントが出る。盤の上で見えるのは**部品**（`CR1` / `PL1` / `T1.coil`）なので、
 * `<部品ID>:<要素>.closed` は部品IDに畳む。
 */
function visibleChatterSignal(signal: string): string {
  const colon = signal.indexOf(':');
  return colon < 0 ? signal : signal.slice(0, colon);
}

/**
 * 禁則回路。§7.4 / §5.3.2 / 調査資料 §5.5
 * 判定は2本立てである。
 * ①判定区間でチャタリングを検出したか（Phase 1 から。復帰時間モデルにより禁則回路は
 *   必ず tick 周期で反転するので取りこぼさない）
 * ②ネットリストの構造がタイマ自己遮断／タイマ2個フリッカのパターンに一致するか（Phase 2 で追加）
 *
 * 1つの震えは（接点要素ごと・1秒窓ごとに）何十件ものイベントになるため、そのまま並べると
 * 結果画面が同じ内容で埋まる。信号ごとに最初の1件だけを出す（§8.3）。
 * 構造照合の行は「構造:」で始め、チャタリングの行（信号名で始まる）と混ざらないようにする。
 */
export function checkForbiddenCircuit(input: StaticCheckInput): StaticCheckResult {
  const seen = new Set<string>();
  const details: string[] = [];
  for (const e of input.chatters) {
    const signal = visibleChatterSignal(e.signal);
    if (seen.has(signal)) continue;
    seen.add(signal);
    details.push(`${signal}: ${e.tMs}ms 付近で1秒間に${e.count}回反転しました`);
  }
  for (const pattern of findForbiddenPatterns(input.netlist)) {
    details.push(`構造: ${pattern.message}`);
  }
  return result(
    'forbiddenCircuit',
    details,
    '禁則回路は検出されませんでした',
    'タイマの接点で自分のコイルを切る回路は実機では動作が不安定になります（リレーを介してください）',
  );
}

/**
 * コイル極性。14 = (+)、13 = (−)。§7.4 / §5.3.1
 * 通電中のコイル電圧（`<部品ID>.coilV` として記録される）が励磁しきい値ぶん**負**に振れていれば、
 * 13 に + を、14 に − を繋いでいる（逆極性）と判定する。
 */
export function checkCoilPolarity(input: StaticCheckInput): StaticCheckResult {
  const details: string[] = [];
  for (const part of input.netlist.parts) {
    if (part.meta.kind !== 'relay-my4n' && part.meta.kind !== 'timer-h3y4') continue;
    let worst = 0;
    for (const entry of input.log.transitions(`${part.id}.coilV`)) {
      if (typeof entry.value === 'number' && entry.value < worst) worst = entry.value;
    }
    if (worst <= -PICKUP_VOLTS) {
      details.push(
        `${part.id}: コイル電圧が ${worst.toFixed(1)}V です（14 に +、13 に − を接続します）`,
      );
    }
  }
  return result(
    'coilPolarity',
    details,
    'コイルの極性は正しく接続されています',
    'コイルの極性が逆の部品があります',
  );
}

/** 電源投入・遮断の手順違反。§7.4 / §5.3.5 */
export function checkPowerSequence(input: StaticCheckInput): StaticCheckResult {
  const violations = input.hazards.filter((e) => e.kind === 'power-sequence-violation');
  const details = violations.map((e) => `${e.tMs}ms: ${e.detail}`);
  return result(
    'powerSequence',
    details,
    '電源の入切手順は守られています',
    '電源の入切手順に違反があります（ON: ブレーカ→スイッチ／OFF: スイッチ→ブレーカ）',
  );
}

/** IDごとのチェック関数。 */
const CHECKS: Readonly<Record<StaticCheckId, (input: StaticCheckInput) => StaticCheckResult>> = {
  wireColorRule: checkWireColorRule,
  terminalLimit: checkTerminalLimit,
  unusedParts: checkUnusedParts,
  forbiddenCircuit: checkForbiddenCircuit,
  coilPolarity: checkCoilPolarity,
  powerSequence: checkPowerSequence,
  twoStage: checkTwoStage,
  plcPowerIndependent: checkPlcPowerIndependent,
  ioAssignment: checkIoAssignment,
};

/** 有効にした静的チェックだけを `STATIC_CHECK_IDS` の順に実行する。§7.4 */
export function runStaticChecks(
  input: StaticCheckInput,
  enabled: StaticChecksData,
): StaticCheckResult[] {
  const out: StaticCheckResult[] = [];
  const checks: StaticChecksData = {
    ...enabled,
    ...input.session.boardProfile?.rules.staticChecks,
  };
  for (const id of STATIC_CHECK_IDS) {
    if (!checks[id]) continue;
    const checked = CHECKS[id](input);
    if (!checked.ok && checked.issues === undefined) {
      const terminals = checkTargets(id, input);
      checked.issues = [
        {
          code: id,
          terminals,
          wireIds: input.session.wires
            .filter((wire) => terminals.includes(wire.from) || terminals.includes(wire.to))
            .map((wire) => wire.id),
          expected:
            id === 'terminalLimit'
              ? `1端子${input.session.boardProfile?.rules.maxWiresPerTerminal ?? 2}本まで`
              : expectedFor(id),
          observed: checked.details.join(' / '),
        },
      ];
    }
    out.push(checked);
  }
  return out;
}

function expectedFor(id: StaticCheckId): string {
  const expectations: Record<StaticCheckId, string> = {
    wireColorRule: '課題に指定された線色',
    terminalLimit: '1端子2本まで',
    unusedParts: '使用する部品だけを装着',
    forbiddenCircuit: 'リレーを介して安定した動作にする',
    coilPolarity: 'コイル14番が＋、13番が−',
    powerSequence: 'ONはブレーカ→スイッチ、OFFはスイッチ→ブレーカ',
    twoStage: 'PLC出力→リレーコイル→接点→表示灯',
    plcPowerIndependent: '独立したL・Nへの配線',
    ioAssignment: '指定I/O端子・入力COM・出力COMへの接続',
  };
  return expectations[id];
}

/** 表示文を解析せず、検査で使った構造データから案内先を作る。 */
function checkTargets(id: StaticCheckId, input: StaticCheckInput): string[] {
  const wires = input.session.wires;
  if (id === 'wireColorRule')
    return [
      ...new Set(
        wires
          .filter(
            (wire) =>
              !wire.locked &&
              !input.preexistingWireIds?.has(wire.id) &&
              !input.allowedColors.includes(wire.color),
          )
          .flatMap((wire) => [wire.from, wire.to]),
      ),
    ];
  if (id === 'terminalLimit')
    return [...new Set(wires.flatMap((wire) => [wire.from, wire.to]))].filter(
      (terminal) =>
        wireCountAtTerminal(input.session, terminal) >
        (input.session.boardProfile?.rules.maxWiresPerTerminal ?? MAX_WIRES_PER_TERMINAL),
    );
  if (id === 'powerSequence') return ['CB.1', 'SW.1'];
  if (id === 'coilPolarity')
    return input.netlist.parts
      .filter((part) =>
        input.log
          .transitions(`${part.id}.coilV`)
          .some((entry) => typeof entry.value === 'number' && entry.value <= -PICKUP_VOLTS),
      )
      .flatMap((part) => [`${part.id}.13`, `${part.id}.14`]);
  if (id === 'unusedParts')
    return SOCKET_IDS.flatMap((socket) => {
      const part = socketPartId(input.session.socketRoles, socket);
      return input.session.mounted[socket] !== undefined &&
        input.session.socketRoles[socket] !== 'CHK' &&
        !wires.some((wire) => wire.from.startsWith(`${part}.`) || wire.to.startsWith(`${part}.`))
        ? [`${part}.13`, `${part}.14`]
        : [];
    });
  if (id === 'forbiddenCircuit')
    return [...new Set(input.chatters.map((event) => visibleChatterSignal(event.signal)))].flatMap(
      (part) => [`${part}.13`, `${part}.14`],
    );
  const plc = input.plc;
  if (plc === undefined) return [];
  return [
    ...new Set([
      ...plc.io.inputs.flatMap((input) => [
        `PLC.${plc.unit.spec.inputs[input.x]?.name ?? ''}`,
        `TB_PB.${input.pb.slice(2)}a`,
      ]),
      ...plc.unit.spec.inputCommons.map((name) => `PLC.${name}`),
      ...plc.io.outputs.flatMap((output) => [
        `PLC.${plc.unit.spec.outputs[output.y]?.name ?? ''}`,
        `PLC.${plc.unit.spec.outputs[output.y]?.com ?? ''}`,
        `${output.cr}.14`,
        `${output.cr}.13`,
        `${output.cr}.5`,
        `TB_PL.${output.pl.slice(2)}+`,
      ]),
    ]),
  ];
}
