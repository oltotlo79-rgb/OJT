import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  compile,
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  T,
  ton,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { judgePlc, judgePlcReference, plcTimerMarkers } from '../src/judge-plc.js';
import { buildPlcReferenceSession, type PlcReferenceCircuit } from '../src/plc-reference.js';
import { PlcProblemSchema, type PlcProblem } from '../src/schema/plc.js';
import { plcProblemJson } from './helpers/plc.js';

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

function t(id: string): TerminalId {
  return id as TerminalId;
}

function problem(): PlcProblem {
  return PlcProblemSchema.parse(plcProblemJson());
}

/** 模範どおりに配線した訓練者の盤。 */
function traineeSession(): PlcReferenceCircuit {
  const built = buildPlcReferenceSession(problem(), JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value;
}

describe('judgePlcReference（自己整合。§7.8 / §14.1 #30）', () => {
  it('passes the reference ladder against its own reference wiring', () => {
    const judged = judgePlcReference(problem(), JIPM_BOARD);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(true);
    expect(judged.value.mismatches).toEqual([]);
    expect(judged.value.staticChecks.every((c) => c.ok)).toBe(true);
    expect(judged.value.ladderErrors).toEqual([]);
    expect(judged.value.mode).toBe('plc');
  });
});

describe('judgePlc（§10.8）', () => {
  it('fails when the trainee ladder drives the wrong output', () => {
    const circuit = traineeSession();
    const wrong = program(network('n1', [rung(no(X(0)), out(Y(1)))]), endNetwork());
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, wrong);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
    expect(judged.value.mismatches[0]?.signal).toBe('PL1');
  });

  it('fails without simulating when the trainee ladder does not convert (§10.6)', () => {
    const circuit = traineeSession();
    const broken = { networks: [network('n1', [rung(no(X(0)), out(Y(0)))])] };
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, broken);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.ladderErrors.map((e) => e.code)).toContain('missing-end');
    expect(judged.value.mismatches).toEqual([]);
  });

  it('keeps the double-coil warning on the result (§10.4)', () => {
    const circuit = traineeSession();
    const doubled = program(
      network('n1', [rung(no(X(0)), out(Y(0)))]),
      network('n2', [rung(no(X(1)), out(Y(0)))]),
      endNetwork(),
    );
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, doubled);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.ladderWarnings.map((w) => w.code)).toEqual(['double-coil']);
  });

  it('fails the twoStage check when the lamp is wired straight to Y (§16 Phase 3 受入基準④)', () => {
    const circuit = traineeSession();
    const coil = circuit.session.wires.find((w) => String(w.from) === 'PLC.Y0');
    removeWire(circuit.session, coil?.id ?? '');
    const lamp = circuit.session.wires.find((w) => String(w.to) === 'TB_PL.1+');
    removeWire(circuit.session, lamp?.id ?? '');
    addWire(circuit.session, circuit.board, t('PLC.Y0'), t('TB_PL.1+'));
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, problem().referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'twoStage')?.ok).toBe(false);
    expect(judged.value.passed).toBe(false);
  });

  it('fails the plcPowerIndependent check when the PLC is fed from the board (§16 Phase 3 受入基準⑤)', () => {
    const circuit = traineeSession();
    const wire = circuit.session.wires.find((w) => String(w.to) === 'PLC.L');
    removeWire(circuit.session, wire?.id ?? '');
    // 鎖の末端（最後の出力リレーの 9番ピン）だけが1本空いている（§6.6）
    const lastRelay = circuit.io.outputs.at(-1)?.cr ?? 'CR3';
    expect(addWire(circuit.session, circuit.board, t(`${lastRelay}.9`), t('PLC.L')).ok).toBe(true);
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, problem().referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'plcPowerIndependent')?.ok).toBe(false);
  });

  it('builds both charts with the PB inputs and the compared outputs (§7.7)', () => {
    const circuit = traineeSession();
    const judged = judgePlc(problem(), JIPM_BOARD, circuit.session, problem().referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.charts.expected.signals.map((s) => s.name)).toEqual([
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
    ]);
    expect(judged.value.charts.actual.durationMs).toBe(problem().durationMs);
  });

  it('returns a problem error when the reference circuit cannot be built (§13 #2)', () => {
    const broken = PlcProblemSchema.parse(
      plcProblemJson({ board: { boardId: 'other', socketRoles: { S7: 'CHK' } } }),
    );
    const circuit = traineeSession();
    const judged = judgePlc(broken, JIPM_BOARD, circuit.session, broken.referenceLadder);
    expect(judged.ok).toBe(false);
  });
});

describe('plcTimerMarkers（§7.7 / レビュー反映: formatSeconds/deviceLabel の再利用と重複除去）', () => {
  it('dedupes a timer device that appears as an output in two networks (§10.4 の二重コイル)', () => {
    const compiled = compile(
      program(
        network('n1', [rung(no(X(0)), ton(T(0), 3000))]),
        // 同じ T0 がもう一つのネットワークにも出力として現れる（実行は後勝ちだが印は1個でよい）
        network('n2', [rung(no(X(1)), ton(T(0), 3000))]),
        endNetwork(),
      ),
    );
    if (!compiled.ok) throw new Error('変換に失敗しました');
    const markers = plcTimerMarkers(compiled.program);
    expect(markers).toEqual([{ tMs: 3000, label: 'T0=3秒' }]);
  });

  it('formats a non-integer preset like timerMarkers() (§7.7)', () => {
    const compiled = compile(program(network('n1', [rung(no(X(0)), ton(T(1), 800))]), endNetwork()));
    if (!compiled.ok) throw new Error('変換に失敗しました');
    expect(plcTimerMarkers(compiled.program)).toEqual([{ tMs: 800, label: 'T1=0.8秒' }]);
  });
});
