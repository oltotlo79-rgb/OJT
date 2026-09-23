import { addWire, JIPM_BOARD, plcUnitFor, removeWire, toNetlist } from '@ojt/board-model';
import { buildNets, type TerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { runPlcOperations } from '../src/plc-io.js';
import { buildPlcReferenceSession, type PlcReferenceCircuit } from '../src/plc-reference.js';
import {
  checkIoAssignment,
  checkPlcPowerIndependent,
  checkTwoStage,
  detectPlcWiring,
  isPbA,
  isPlcX,
  isPlcY,
  usedInputCommons,
  type PlcCheckContext,
} from '../src/plc-static-checks.js';
import { MODEL_OF_VENDOR, PlcProblemSchema } from '../src/schema/plc.js';
import type { StaticCheckInput } from '../src/static-check-types.js';
import { runStaticChecks } from '../src/static-checks.js';
import { noJson, outJson, plcProblemJson, rungJson } from './helpers/plc.js';

function t(id: string): TerminalId {
  return id as TerminalId;
}

/**
 * その電線がこの端子に繋がっているか。
 * `TerminalId` はブランド付きのテンプレートリテラル型なので、リテラルと `===` で比べると
 * `TS2367`（型に重なりが無い）になる。比較は必ず `String()` を挟む。
 */
function at(wire: { from: TerminalId; to: TerminalId }, id: string): boolean {
  return String(wire.from) === id || String(wire.to) === id;
}

const PROBLEM = PlcProblemSchema.parse(plcProblemJson());

/** 模範回路（＝正しく配線された盤）を作る。 */
function reference(): { problem: typeof PROBLEM; circuit: PlcReferenceCircuit } {
  const built = buildPlcReferenceSession(PROBLEM, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem: PROBLEM, circuit: built.value };
}

/**
 * チェックの入力を組む。
 * PLCの3件はログを読まないが、`runStaticChecks` の他の6件（`coilPolarity` / `forbiddenCircuit` /
 * `powerSequence`）はログとイベントを読む。ダミーの空ログを渡すと検査が素通りしてしまうので、
 * **実際に操作列を再生した結果**を渡す。
 */
function checkInput(
  circuit: PlcReferenceCircuit,
  plc: PlcCheckContext,
  problem: typeof PROBLEM = PROBLEM,
): StaticCheckInput {
  const netlist = toNetlist(circuit.session, circuit.board);
  const result = runPlcOperations(netlist, circuit.program, problem.operations, {
    durationMs: problem.durationMs,
  });
  return {
    session: circuit.session,
    netlist,
    log: result.log,
    hazards: result.events.hazards(),
    chatters: result.events.chatters(),
    allowedColors: ['青' as const],
    plc,
  };
}

function context(circuit: PlcReferenceCircuit): PlcCheckContext {
  return { unit: circuit.unit, io: circuit.io };
}

/**
 * 機種 → メーカーの対応（§7.6）。`MODEL_OF_VENDOR`（メーカー → 機種。schema/plc.ts）を
 * 反転して使う。表を書き写すと2箇所が食い違う余地ができるため、バレルの公開シンボルを
 * 1箇所から引く（レビュー M9）。
 */
const VENDOR_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MODEL_OF_VENDOR).map(([vendor, model]) => [model, vendor]),
);

/** 課題から模範回路を組む（組めなければその場で落とす）。 */
function buildOf(problem: typeof PROBLEM): {
  problem: typeof PROBLEM;
  circuit: PlcReferenceCircuit;
} {
  const built = buildPlcReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(`${problem.plc.model}: ${JSON.stringify(built.errors)}`);
  return { problem, circuit: built.value };
}

/**
 * 機種だけを差し替えた模範回路を組む（課題JSON の `plc` 以外は `plcProblemJson()` の既定のまま）。
 * 返した `circuit.session` を書き換えてから `inputOf()` を呼べば「配線を崩した場合」を作れる。
 */
function buildFor(model: string): { problem: typeof PROBLEM; circuit: PlcReferenceCircuit } {
  return buildOf(
    PlcProblemSchema.parse({
      ...plcProblemJson(),
      plc: { vendor: VENDOR_OF[model] ?? 'mitsubishi', model },
    }),
  );
}

/** 組んだ回路を静的チェックの入力にする（操作列はその課題のものを再生する）。 */
function inputOf(built: ReturnType<typeof buildFor>): StaticCheckInput {
  return checkInput(built.circuit, context(built.circuit), built.problem);
}

/** 2つの端子を1本の電線でつないで短絡を作る。 */
function shortTogether(built: ReturnType<typeof buildFor>, a: string, b: string): StaticCheckInput {
  expect(addWire(built.circuit.session, built.circuit.board, t(a), t(b)).ok).toBe(true);
  return inputOf(built);
}

/**
 * その端子**だけ**を浮かせる。来ている電線を外し、相手どうしを1本で結び直す。
 * 単に外すと母線の鎖（`chain()` が作る P側・N側の直列）がそこで切れて後続の端子まで浮き、
 * 何を検出したのか分からなくなる。
 */
function unchain(built: ReturnType<typeof buildFor>, id: string): void {
  const { session, board } = built.circuit;
  const touching = session.wires.filter((wire) => at(wire, id));
  const others = touching.map((wire) => (String(wire.from) === id ? wire.to : wire.from));
  for (const wire of [...touching]) expect(removeWire(session, wire.id).ok).toBe(true);
  const [first, second] = others;
  if (first !== undefined && second !== undefined) {
    expect(addWire(session, board, first, second).ok).toBe(true);
  }
}

/** その端子だけを浮かせた盤を静的チェックの入力にする。 */
function withoutWire(built: ReturnType<typeof buildFor>, id: string): StaticCheckInput {
  unchain(built, id);
  return inputOf(built);
}

describe('twoStage（§10.2 / §7.4）', () => {
  it('passes on the reference circuit', () => {
    const { circuit } = reference();
    expect(checkTwoStage(checkInput(circuit, context(circuit))).ok).toBe(true);
  });

  it('fails when Y is wired straight to the lamp (§16 Phase 3 受入基準④)', () => {
    const { circuit } = reference();
    // Y0 → CR1.14 を外し、Y0 → TB_PL.1+ に直結する
    const direct = circuit.session.wires.find((w) => at(w, 'PLC.Y0'));
    expect(removeWire(circuit.session, direct?.id ?? '').ok).toBe(true);
    const lampWire = circuit.session.wires.find((w) => String(w.to) === 'TB_PL.1+');
    expect(removeWire(circuit.session, lampWire?.id ?? '').ok).toBe(true);
    expect(addWire(circuit.session, circuit.board, t('PLC.Y0'), t('TB_PL.1+')).ok).toBe(true);
    const result = checkTwoStage(checkInput(circuit, context(circuit)));
    expect(result.ok).toBe(false);
    expect(result.details.join('')).toContain('直結');
  });

  it('fails when Y drives nothing at all', () => {
    const { circuit } = reference();
    const wire = circuit.session.wires.find((w) => at(w, 'PLC.Y0'));
    removeWire(circuit.session, wire?.id ?? '');
    const result = checkTwoStage(checkInput(circuit, context(circuit)));
    expect(result.ok).toBe(false);
    expect(result.details.join('')).toContain('コイル');
  });

  it('fails when the lamp is not driven by the relay contact (fixed)', () => {
    const { circuit } = reference();
    // CR1の接点（5番）→ ランプ の配線を外し、代わりに未使用のCR2の接点へ繋ぐ（CR1の接点ではない）
    const lampWire = circuit.session.wires.find((w) => String(w.to) === 'TB_PL.1+');
    expect(removeWire(circuit.session, lampWire?.id ?? '').ok).toBe(true);
    expect(addWire(circuit.session, circuit.board, t('CR2.1'), t('TB_PL.1+')).ok).toBe(true);
    const result = checkTwoStage(checkInput(circuit, context(circuit)));
    expect(result.ok).toBe(false);
    expect(result.details.join('')).toContain('接点から駆動されていません');
  });

  describe('io.mode: free（差分 #6）', () => {
    const problem = PlcProblemSchema.parse(
      plcProblemJson({
        io: { mode: 'free', outputs: [{ y: 0, cr: 'CR2', pl: 'PL3' }] },
        judge: { compareSignals: ['PL3'] },
      }),
    );

    function freeReference(): PlcReferenceCircuit {
      const built = buildPlcReferenceSession(problem, JIPM_BOARD);
      if (!built.ok) throw new Error(JSON.stringify(built.errors));
      return built.value;
    }

    it('passes a legal non-default assignment (Y0→CR2→PL3)', () => {
      const circuit = freeReference();
      const result = checkTwoStage(checkInput(circuit, context(circuit)));
      expect(result.ok).toBe(true);
    });

    it('fails when a lamp is driven straight from a Y terminal', () => {
      const circuit = freeReference();
      const coil = circuit.session.wires.find((w) => at(w, 'PLC.Y0'));
      expect(removeWire(circuit.session, coil?.id ?? '').ok).toBe(true);
      const lampWire = circuit.session.wires.find((w) => String(w.to) === 'TB_PL.3+');
      expect(removeWire(circuit.session, lampWire?.id ?? '').ok).toBe(true);
      expect(addWire(circuit.session, circuit.board, t('PLC.Y0'), t('TB_PL.3+')).ok).toBe(true);
      const result = checkTwoStage(checkInput(circuit, context(circuit)));
      expect(result.ok).toBe(false);
      expect(result.details.join('')).toContain('直結');
    });
  });
});

describe('plcPowerIndependent（§10.1 / §7.4）', () => {
  it('passes when the PLC takes its power from the wall outlet', () => {
    const { circuit } = reference();
    expect(checkPlcPowerIndependent(checkInput(circuit, context(circuit))).ok).toBe(true);
  });

  it('fails when the PLC power comes from the board (§16 Phase 3 受入基準⑤)', () => {
    const { circuit } = reference();
    const wire = circuit.session.wires.find((w) => String(w.to) === 'PLC.L');
    removeWire(circuit.session, wire?.id ?? '');
    // 盤の P.1 は既設配線＋鎖の1本で埋まっている。鎖の途中の端子も2本埋まっているので、
    // 空きがあるのは鎖の**末端**（最後の出力リレーの 9番ピン）だけである（§6.6）
    const lastRelay = circuit.io.outputs.at(-1)?.cr ?? 'CR3';
    expect(addWire(circuit.session, circuit.board, t(`${lastRelay}.9`), t('PLC.L')).ok).toBe(true);
    const result = checkPlcPowerIndependent(checkInput(circuit, context(circuit)));
    expect(result.ok).toBe(false);
    expect(result.details.join('')).toContain('盤');
    expect(result.details.join('')).toContain('P.1');
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.code).toBe('plc-power-board-power');
  });

  it('fails when the PLC power is not wired at all', () => {
    const { circuit } = reference();
    for (const wire of [...circuit.session.wires]) {
      if (at(wire, 'PLC.L') || at(wire, 'PLC.N')) removeWire(circuit.session, wire.id);
    }
    expect(checkPlcPowerIndependent(checkInput(circuit, context(circuit))).ok).toBe(false);
  });
});

describe('ioAssignment（§7.4 / §7.6）', () => {
  it('passes on the reference circuit when the map is fixed', () => {
    const { circuit } = reference();
    expect(checkIoAssignment(checkInput(circuit, context(circuit))).ok).toBe(true);
  });

  it('is skipped (always OK) when the map is free', () => {
    const { circuit } = reference();
    const free = { ...context(circuit), io: { ...circuit.io, mode: 'free' as const } };
    const result = checkIoAssignment(checkInput(circuit, free));
    expect(result.ok).toBe(true);
    expect(result.message).toContain('自由');
  });

  it('fails when an input is wired to the wrong push button', () => {
    const { circuit } = reference();
    const wire = circuit.session.wires.find((w) => String(w.to) === 'PLC.X0');
    removeWire(circuit.session, wire?.id ?? '');
    expect(addWire(circuit.session, circuit.board, t('TB_PB.2a'), t('PLC.X0')).ok).toBe(true);
    expect(checkIoAssignment(checkInput(circuit, context(circuit))).ok).toBe(false);
  });

  it('fails when X0 and X1 are shorted together (§10.2)', () => {
    const { circuit } = reference();
    expect(addWire(circuit.session, circuit.board, t('PLC.X0'), t('PLC.X1')).ok).toBe(true);
    const result = checkIoAssignment(checkInput(circuit, context(circuit)));
    expect(result.ok).toBe(false);
    expect(result.details.join('')).toContain('短絡');
  });

  it('fails when the problem declares source wiring but the session is wired sink (§10.2)', () => {
    // `reference()` は既定の sink 結線で組む。課題側だけ source と偽って渡すと、
    // 「結線が課題の指定（sink/source）と違います」の枝（レビュー I2）を通る
    const { circuit } = reference();
    const mismatched: PlcCheckContext = {
      ...context(circuit),
      io: { ...circuit.io, wiring: 'source' },
    };
    const result = checkIoAssignment(checkInput(circuit, mismatched));
    expect(result.ok).toBe(false);
    expect(result.details.join('|')).toContain(
      '結線が課題の指定（source）と違います（sink になっています）',
    );
  });

  it('reports one line per common, not one per point, when several points share it (FX5U レビュー M7)', () => {
    const threeInputs = PlcProblemSchema.parse(
      plcProblemJson({
        io: {
          mode: 'fixed',
          inputs: [
            { x: 0, pb: 'PB1' },
            { x: 1, pb: 'PB2' },
            { x: 2, pb: 'PB3' },
          ],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
      }),
    );
    const built = buildOf(threeInputs);
    const result = checkIoAssignment(withoutWire(built, 'PLC.SS'));
    expect(result.ok).toBe(false);
    // 「が配線されていません（受入基準③⑤）」はコモンごとの検査（点ごとなら3点で3行出ていた）。
    // 末尾の結線方式の判定（P側・N側のどちらにも無い、という別の検査）も「入力コモン」を含む
    // 文言なので、そちらと混ざらないようメッセージの末尾側で絞る
    const commonLines = result.details.filter((d) => d.includes('が配線されていません'));
    expect(commonLines).toHaveLength(1);
    expect(commonLines[0]).toContain('PLC.SS');
  });

  it('reads naturally when a single common shorts P and N together (commons.length === 1, レビュー M7)', () => {
    const { circuit } = reference();
    // SS→COM0 のP側の鎖を切り、代わりにSS自身をN側の鎖（TB_PL.1-）へ繋いで
    // SS一本がP側とN側を短絡している状態を作る
    const bridge = circuit.session.wires.find((w) => at(w, 'PLC.SS') && at(w, 'PLC.COM0'));
    expect(bridge).toBeDefined();
    expect(removeWire(circuit.session, bridge?.id ?? '').ok).toBe(true);
    expect(addWire(circuit.session, circuit.board, t('PLC.SS'), t('TB_PL.1-')).ok).toBe(true);
    const result = checkIoAssignment(checkInput(circuit, context(circuit)));
    expect(result.ok).toBe(false);
    expect(result.details.join('|')).toContain('でP側とN側を短絡しています');
    expect(result.details.join('|')).not.toContain('すべて同じ側に揃えます');
  });
});

describe('detectPlcWiring（§10.2）', () => {
  it('recognises sink wiring on the reference circuit', () => {
    const { circuit } = reference();
    const nets = buildNets(toNetlist(circuit.session, circuit.board));
    expect(detectPlcWiring(nets, circuit.unit)).toBe('sink');
  });

  it('recognises source wiring', () => {
    const problem = PlcProblemSchema.parse(
      plcProblemJson({ io: { mode: 'fixed', wiring: 'source' } }),
    );
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const nets = buildNets(toNetlist(built.value.session, built.value.board));
    expect(detectPlcWiring(nets, built.value.unit)).toBe('source');
  });

  it('returns undefined when S/S is wired to neither the P side nor the N side', () => {
    const { circuit } = reference();
    const wire = circuit.session.wires.find((w) => at(w, 'PLC.SS'));
    expect(removeWire(circuit.session, wire?.id ?? '').ok).toBe(true);
    const nets = buildNets(toNetlist(circuit.session, circuit.board));
    expect(detectPlcWiring(nets, circuit.unit)).toBeUndefined();
  });
});

describe('usedInputCommons（§10.2 決定表: 使う点のコモン。レビュー M4）', () => {
  it('FX5U: 一体形（コモンは S/S 1つだけ）はどの点を使っても同じ1件を返す', () => {
    const unit = plcUnitFor('FX5U');
    if (unit === undefined) throw new Error('FX5U が見つかりません');
    expect(usedInputCommons(unit, { inputs: [{ x: 0, pb: 'PB1' }] })).toEqual(['SS']);
    expect(usedInputCommons(unit, { inputs: [{ x: 3, pb: 'PB1' }] })).toEqual(['SS']);
  });

  it('CP1E: 一体形（コモンは COM 1つだけ）も同じ形になる', () => {
    const unit = plcUnitFor('CP1E');
    if (unit === undefined) throw new Error('CP1E が見つかりません');
    expect(usedInputCommons(unit, { inputs: [{ x: 0, pb: 'PB1' }] })).toEqual(['COM']);
  });

  it('ラック形（PC10G-1SP）: 使う点のコモンだけを機種仕様の並び順で返す', () => {
    const unit = plcUnitFor('PC10G-1SP');
    if (unit === undefined) throw new Error('PC10G-1SP が見つかりません');
    expect(usedInputCommons(unit, { inputs: [{ x: 0, pb: 'PB1' }] })).toEqual(['ICOM0']);
    expect(usedInputCommons(unit, { inputs: [{ x: 8, pb: 'PB1' }] })).toEqual(['ICOM1']);
    // 並び順は io.inputs の指定順（x:8 が先）ではなく機種仕様（unit.spec.inputCommons）の順になる
    expect(
      usedInputCommons(unit, {
        inputs: [
          { x: 8, pb: 'PB2' },
          { x: 0, pb: 'PB1' },
        ],
      }),
    ).toEqual(['ICOM0', 'ICOM1']);
  });
});

describe('isPbA / isPlcX / isPlcY（CT-12: checkIoAssignment から出した述語の単体試験）', () => {
  it('isPbA recognises only a push-button a-contact terminal id', () => {
    expect(isPbA('TB_PB.1a')).toBe(true);
    expect(isPbA('TB_PB.12a')).toBe(true);
    expect(isPbA('TB_PB.1b')).toBe(false);
    expect(isPbA('CR1.14')).toBe(false);
  });

  it('isPlcX / isPlcY recognise only that unit’s own input / output terminal ids', () => {
    const unit = plcUnitFor('FX5U');
    if (unit === undefined) throw new Error('FX5U が見つかりません');
    const inputName = unit.spec.inputs[0]?.name;
    const outputName = unit.spec.outputs[0]?.name;
    if (inputName === undefined || outputName === undefined) {
      throw new Error('FX5U の入出力が空です');
    }
    expect(isPlcX(unit, `PLC.${inputName}`)).toBe(true);
    expect(isPlcX(unit, `PLC.${outputName}`)).toBe(false);
    expect(isPlcY(unit, `PLC.${outputName}`)).toBe(true);
    expect(isPlcY(unit, `PLC.${inputName}`)).toBe(false);
    expect(isPlcX(unit, 'TB_PB.1a')).toBe(false);
    expect(isPlcY(unit, 'TB_PB.1a')).toBe(false);
  });
});

describe('runStaticChecks（PLCの3件を含む）', () => {
  it('runs the nine checks in the fixed order when they are all enabled (§7.4)', () => {
    const { problem, circuit } = reference();
    const results = runStaticChecks(
      checkInput(circuit, context(circuit)),
      problem.judge.staticChecks,
    );
    expect(results.map((r) => r.id)).toEqual([
      'wireColorRule',
      'terminalLimit',
      'unusedParts',
      'forbiddenCircuit',
      'coilPolarity',
      'powerSequence',
      'twoStage',
      'plcPowerIndependent',
      'ioAssignment',
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('reports the PLC checks as errors when the mode D context is missing', () => {
    const { problem, circuit } = reference();
    const withoutPlc: StaticCheckInput = checkInput(circuit, context(circuit));
    delete withoutPlc.plc;
    const results = runStaticChecks(withoutPlc, problem.judge.staticChecks);
    expect(results.find((r) => r.id === 'twoStage')?.ok).toBe(false);
  });
});

describe('ioAssignment は機種の端子名で判定する（Phase 4）', () => {
  it('detects a short between two inputs on a model whose terminals are not Xn', () => {
    // CP1E の入力端子は `PLC.0.00` / `PLC.0.01`。三菱の正規表現では拾えなかった（前提#19）
    const result = checkIoAssignment(shortTogether(buildFor('CP1E'), 'PLC.0.00', 'PLC.0.01'));
    expect(result.ok).toBe(false);
    expect(result.details.join('|')).toContain('短絡');
  });

  it('detects a short between two outputs whose names are not decimal (PC10G の `Y1A`)', () => {
    // TOYOPUC の出力端子は `Y10`〜`Y1F`。`/^PLC\.Y\d+$/` は `Y1A` を拾えない
    const result = checkIoAssignment(shortTogether(buildFor('PC10G-1SP'), 'PLC.Y10', 'PLC.Y1A'));
    expect(result.ok).toBe(false);
    expect(result.details.join('|')).toContain('短絡');
  });

  it('reports an unwired common on an 8-point-per-common model (受入基準③⑤)', () => {
    // JW300 の入力コモンは `PLC.COM.A` / `PLC.COM.B`。使う点のコモンが浮いていたら落とす
    const result = checkIoAssignment(withoutWire(buildFor('JW-300'), 'PLC.COM.A'));
    expect(result.ok).toBe(false);
    expect(result.details.join('|')).toContain('COM.A');
  });

  it('reports an unwired output common as well', () => {
    const result = checkIoAssignment(withoutWire(buildFor('JW-300'), 'PLC.COM.C'));
    expect(result.ok).toBe(false);
    expect(result.details.join('|')).toContain('出力コモン');
  });

  it('reports a mismatch when two used input commons sit on opposite rails', () => {
    // `detectPlcWiring()` は最初に見つかったコモンで打ち切っていたので、
    // `ICOM0`→P・`ICOM1`→N が `sink` と報告されていた（レビュー指摘）
    const built = buildOf(
      PlcProblemSchema.parse({
        ...plcProblemJson(),
        plc: { vendor: 'jtekt', model: 'PC10G-1SP' },
        io: {
          mode: 'fixed',
          inputs: [
            { x: 0, pb: 'PB1' },
            { x: 8, pb: 'PB2' },
          ],
          outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
        },
        referenceLadder: {
          networks: [
            { id: 'n1', cells: [rungJson(noJson('input', 0), noJson('input', 8), outJson(0))] },
            { id: 'end', cells: [[{ kind: 'end' }]] },
          ],
        },
      }),
    );
    unchain(built, 'PLC.ICOM1');
    expect(
      addWire(built.circuit.session, built.circuit.board, t('PLC.ICOM1'), t('TB_PL.1-')).ok,
    ).toBe(true);
    const result = checkIoAssignment(inputOf(built));
    expect(result.ok).toBe(false);
    expect(result.details.join('|')).toContain('食い違');
    // 端子名は機種の実表記（PLC.ICOM0）で出す。三菱の `Xn` 表記を文言に書かないため（引き渡し注記 H-1）
    expect(result.details.join('|')).toContain('PLC.ICOM0');
  });

  it('passes on the reference wiring of every model', () => {
    for (const model of ['FX5U', 'CP1E', 'PC10G-1SP', 'JW-300']) {
      const input = inputOf(buildFor(model));
      expect(checkIoAssignment(input).ok, model).toBe(true);
      expect(checkTwoStage(input).ok, model).toBe(true);
      expect(checkPlcPowerIndependent(input).ok, model).toBe(true);
    }
  });
});
