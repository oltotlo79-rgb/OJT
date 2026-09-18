import {
  addWire,
  createSession,
  N_RAIL_ID,
  P_RAIL_ID,
  PB_BLOCK_ID,
  PL_BLOCK_ID,
  plcUnitFor,
  plug,
  toNetlist,
  trySocketOf,
  withPlcUnit,
  type BoardDefinition,
  type BoardSession,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { terminalId, type Netlist, type TerminalId, type WireColor } from '@ojt/circuit-sim';
import { compile, type CompiledProgram } from '@ojt/ladder-core';
import { toSocketRoles } from './schema/common.js';
import type { ProblemIssue } from './schema/index.js';
import { resolvePlcIo, type PlcProblem, type ResolvedPlcIo } from './schema/plc.js';

/**
 * モードDの模範回路。設計仕様 §7.2 / §10.2 / §11.3 / 決定表#10。
 *
 * PLC端子は展開接続図（§11.1）の語彙に無いので、モードDの模範回路は回路図ではなく
 * **I/O割付から生成する**。生成規則は §10.2 の配線ルールそのままで、母線は §11.3 の
 * 渡り配線（鎖状）で分配する（`P.1` / `N.1` はチェック用回路の既設配線で各1本埋まっている。§6.3）。
 */

/** モードDの新規配線に使う線色（青）。§10.2 */
export const PLC_WIRE_COLOR: WireColor = '青';

/** 生成する電線1本。 */
export interface PlcWireSpec {
  from: TerminalId;
  to: TerminalId;
}

/** 模範回路（盤セッション＋ネットリスト＋変換済みラダー）。 */
export interface PlcReferenceCircuit {
  session: BoardSession;
  netlist: Netlist;
  /** PLC本体を載せた派生盤（判定でもこれを使う）。 */
  board: BoardDefinition;
  unit: PlcUnitDefinition;
  io: ResolvedPlcIo;
  program: CompiledProgram;
}

/** 模範回路の構築結果。§13 #2 */
export type PlcReferenceResult =
  { ok: true; value: PlcReferenceCircuit } | { ok: false; errors: ProblemIssue[] };

/** 課題の機種に対応するPLC本体を載せた盤。未対応の機種は undefined。§10.1 */
export function plcBoardFor(
  problem: PlcProblem,
  board: BoardDefinition,
): BoardDefinition | undefined {
  const unit = plcUnitFor(problem.plc.model);
  return unit === undefined ? undefined : withPlcUnit(board, unit);
}

/** 押ボタン端子台のc端子・a端子。§6.4 */
function pbTerminal(pb: string, suffix: 'c' | 'a'): TerminalId {
  return terminalId(PB_BLOCK_ID, `${pb.slice(2)}${suffix}`);
}

/** ランプ端子台の端子。§6.4 */
function plTerminal(pl: string, sign: '+' | '-'): TerminalId {
  return terminalId(PL_BLOCK_ID, `${pl.slice(2)}${sign}`);
}

/** 鎖状の渡り配線を作る（起点 → 対象1 → 対象2 …）。§11.3 */
function chain(start: TerminalId, targets: readonly TerminalId[]): PlcWireSpec[] {
  const wires: PlcWireSpec[] = [];
  let previous = start;
  for (const target of targets) {
    wires.push({ from: previous, to: target });
    previous = target;
  }
  return wires;
}

/**
 * I/O割付から模範配線を生成する。§10.2
 * 並びは「入力 → 出力 → 2段目 → P側の鎖 → N側の鎖 → PLC電源」で決定論的である。
 *
 * 割付の `x` / `y` は**10進の装置番号**（IRの `device.index`）で、端子名は機種の表記
 * （三菱なら8進の `X10` / `Y10`）である。両者の対応は機種仕様（`unit.spec`）だけが知っている
 * ので、端子名は必ずここを通して引く（§10.1 / §17 #11）。
 */
export function plcWiringPlan(
  io: ResolvedPlcIo,
  unit: PlcUnitDefinition | undefined,
): PlcWireSpec[] {
  if (unit === undefined) return [];
  const inputName = (x: number): string => unit.spec.inputs[x] ?? `X${x}`;
  const outputName = (y: number): string => unit.spec.outputs[y]?.name ?? `Y${y}`;
  const comName = (y: number): string => unit.spec.outputs[y]?.com ?? 'COM0';
  const plcTerminal = (name: string): TerminalId => terminalId('PLC', name);

  const wires: PlcWireSpec[] = [];
  // 入力: 押ボタン端子台のa接点 → X
  for (const input of io.inputs) {
    wires.push({ from: pbTerminal(input.pb, 'a'), to: plcTerminal(inputName(input.x)) });
  }
  // 出力: Y → 盤のリレーコイル（2段結線の1段目）。§10.2
  for (const output of io.outputs) {
    wires.push({ from: plcTerminal(outputName(output.y)), to: terminalId(output.cr, '14') });
  }
  // 2段目: リレーのa接点（組1）→ ランプ端子台
  for (const output of io.outputs) {
    wires.push({ from: terminalId(output.cr, '5'), to: plTerminal(output.pl, '+') });
  }
  // P側の鎖: 入力コモン（シンクのみ）→ 出力COM → リレー接点のCOM
  const usedCommons = [...new Set(io.outputs.map((output) => comName(output.y)))];
  // 入力側の端子が必ず鎖の先頭に来る（シンクなら S/S、ソースなら押ボタンのコモン）。
  // N側の鎖と同じ並び方にしておくと、どちらの結線でも「起点 → 入力側 → 出力側」で読める
  const pTargets: TerminalId[] = [
    ...(io.wiring === 'sink' ? [plcTerminal(unit.spec.inputCommon)] : []),
    ...(io.wiring === 'source' ? io.inputs.map((input) => pbTerminal(input.pb, 'c')) : []),
    ...usedCommons.map(plcTerminal),
    ...io.outputs.map((output) => terminalId(output.cr, '9')),
  ];
  wires.push(...chain(terminalId(P_RAIL_ID, '1'), pTargets));
  // N側の鎖: 入力コモン（ソースのみ）→ 押ボタンのコモン（シンクのみ）→ コイル(−) → ランプ(−)
  const nTargets: TerminalId[] = [
    ...(io.wiring === 'source' ? [plcTerminal(unit.spec.inputCommon)] : []),
    ...(io.wiring === 'sink' ? io.inputs.map((input) => pbTerminal(input.pb, 'c')) : []),
    ...io.outputs.map((output) => terminalId(output.cr, '13')),
    ...io.outputs.map((output) => plTerminal(output.pl, '-')),
  ];
  wires.push(...chain(terminalId(N_RAIL_ID, '1'), nTargets));
  // PLC電源は壁コンセントから取る（盤から取ると `plcPowerIndependent` 違反。§10.1）
  wires.push({ from: terminalId('OUTLET', 'L'), to: plcTerminal('L') });
  wires.push({ from: terminalId('OUTLET', 'N'), to: plcTerminal('N') });
  return wires;
}

/**
 * 模範配線を張る前の見張り。§6.3 / §6.6
 *
 * 押ボタンのコモン（`TB_PB.{n}c`）に**既設の固定配線**が来ている押ボタンは、母線の鎖を通すと
 * 端子が2本を超えるか、P と N を短絡してしまうため PLC入力に使えない。既定の盤では
 * `fw-chk-1: P.1 → TB_PB.4c`（チェック用回路）がこれに当たるので `PB4` が弾かれる。
 * `PlcInputMapSchema` も `PB4` を受け付けないが、盤の既設配線が変わってもここで必ず捕まる。
 */
export function plcWiringPlanIssues(io: ResolvedPlcIo, session: BoardSession): ProblemIssue[] {
  const locked = new Set<string>();
  for (const wire of session.wires) {
    if (!wire.locked) continue;
    for (const terminal of [wire.from, wire.to]) locked.add(String(terminal));
  }
  const issues: ProblemIssue[] = [];
  io.inputs.forEach((input, index) => {
    const common = String(pbTerminal(input.pb, 'c'));
    if (!locked.has(common)) return;
    issues.push({
      path: `io.inputs[${index}].pb`,
      message: `${input.pb} は既設の固定配線（${common}）が来ているためPLC入力に使えません（§6.3）`,
    });
  });
  return issues;
}

/** 模範の盤セッションとネットリストを組む。§7.2 / §13 #2 */
export function buildPlcReferenceSession(
  problem: PlcProblem,
  board: BoardDefinition,
): PlcReferenceResult {
  if (problem.board.boardId !== board.id) {
    return {
      ok: false,
      errors: [
        {
          path: 'board.boardId',
          message: `課題が要求する盤（${problem.board.boardId}）と渡された盤（${board.id}）が違います`,
        },
      ],
    };
  }
  const plcBoard = plcBoardFor(problem, board);
  const unit = plcBoard?.plcUnit;
  if (plcBoard === undefined || unit === undefined) {
    return {
      ok: false,
      errors: [{ path: 'plc.model', message: `対応していないPLC機種です: ${problem.plc.model}` }],
    };
  }
  const compiled = compile(problem.referenceLadder);
  if (!compiled.ok) {
    return {
      ok: false,
      errors: compiled.errors.map((error) => ({
        path: 'referenceLadder',
        message: `模範ラダーを変換できません（${error.code}）: ${error.message}`,
      })),
    };
  }

  const roles = toSocketRoles(problem.board.socketRoles);
  const io = resolvePlcIo(problem.io);
  const session = createSession(plcBoard, {
    roles,
    allowedColors: [PLC_WIRE_COLOR],
    inventory: problem.inventory,
  });
  const pbIssues = plcWiringPlanIssues(io, session);
  if (pbIssues.length > 0) return { ok: false, errors: pbIssues };

  const errors: ProblemIssue[] = [];
  io.outputs.forEach((output, index) => {
    const socket = trySocketOf(roles, output.cr);
    if (socket === undefined) {
      errors.push({
        path: `io.outputs[${index}].cr`,
        message: `${output.cr} が盤のソケットに割り当てられていません（board.socketRoles）`,
      });
      return;
    }
    const mounted = plug(session, socket, 'relay-my4n');
    if (!mounted.ok) {
      errors.push({ path: `io.outputs[${index}].cr`, message: mounted.message });
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  for (const [index, spec] of plcWiringPlan(io, unit).entries()) {
    const result = addWire(session, plcBoard, spec.from, spec.to, PLC_WIRE_COLOR);
    if (!result.ok) {
      errors.push({
        path: 'io',
        message: `模範配線を張れません（${index + 1}本目 ${spec.from} – ${spec.to}）: ${result.message}`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      session,
      netlist: toNetlist(session, plcBoard),
      board: plcBoard,
      unit,
      io,
      program: compiled.program,
    },
  };
}
