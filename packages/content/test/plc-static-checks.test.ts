import { addWire, JIPM_BOARD, removeWire, toNetlist } from '@ojt/board-model';
import { buildNets, type TerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { runPlcOperations } from '../src/plc-io.js';
import { buildPlcReferenceSession, type PlcReferenceCircuit } from '../src/plc-reference.js';
import {
  checkIoAssignment,
  checkPlcPowerIndependent,
  checkTwoStage,
  detectPlcWiring,
  type PlcCheckContext,
} from '../src/plc-static-checks.js';
import { PlcProblemSchema } from '../src/schema/plc.js';
import type { StaticCheckInput } from '../src/static-check-types.js';
import { runStaticChecks } from '../src/static-checks.js';
import { plcProblemJson } from './helpers/plc.js';

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
function checkInput(circuit: PlcReferenceCircuit, plc: PlcCheckContext): StaticCheckInput {
  const netlist = toNetlist(circuit.session, circuit.board);
  const result = runPlcOperations(netlist, circuit.program, PROBLEM.operations, {
    durationMs: PROBLEM.durationMs,
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
});

describe('detectPlcWiring（§10.2）', () => {
  it('recognises sink wiring on the reference circuit', () => {
    const { circuit } = reference();
    const nets = buildNets(toNetlist(circuit.session, circuit.board));
    expect(detectPlcWiring(nets, circuit.unit)).toBe('sink');
  });

  it('recognises source wiring', () => {
    const problem = PlcProblemSchema.parse(plcProblemJson({ io: { mode: 'fixed', wiring: 'source' } }));
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
