import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import type { LadderProgram } from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PLC_PROBLEMS } from '../src/builtin/index.js';
import { judgePlc } from '../src/judge-plc.js';
import { buildPlcReferenceSession } from '../src/plc-reference.js';

function t(id: string): TerminalId {
  return id as TerminalId;
}

/** 模範ラダーの最初の接点をa接点⇔b接点に入れ替えた「惜しい」ラダーを作る。 */
function flipFirstContact(ladder: LadderProgram): LadderProgram {
  const copy = structuredClone(ladder);
  for (const net of copy.networks) {
    for (const row of net.cells) {
      for (const cell of row) {
        if (cell.kind !== 'contact') continue;
        cell.type = cell.type === 'NO' ? 'NC' : 'NO';
        return copy;
      }
    }
  }
  throw new Error('接点が1つもありません');
}

/** 最初に見つかったタイマの設定値を書き換えた「惜しい」ラダーを作る（tolerance の弁別確認用）。 */
function retimeFirstTimer(ladder: LadderProgram, from: number, to: number): LadderProgram {
  const copy = structuredClone(ladder);
  for (const net of copy.networks) {
    for (const row of net.cells) {
      for (const cell of row) {
        if (cell.kind === 'timer' && cell.presetMs === from) {
          cell.presetMs = to;
          return copy;
        }
      }
    }
  }
  throw new Error(`presetMs=${from} のタイマが見つかりません`);
}

/** 出力コイルの2点（`Y{a}` と `Y{b}`）を入れ替えた「惜しい」ラダーを作る。 */
function swapOutputs(ladder: LadderProgram, a: number, b: number): LadderProgram {
  const copy = structuredClone(ladder);
  for (const net of copy.networks) {
    for (const row of net.cells) {
      for (const cell of row) {
        if (cell.kind !== 'coil' || cell.device.kind !== 'output') continue;
        if (cell.device.index === a) cell.device.index = b;
        else if (cell.device.index === b) cell.device.index = a;
      }
    }
  }
  return copy;
}

const CASES = BUILTIN_PLC_PROBLEMS.map((problem) => [problem.id, problem] as const);

describe('内蔵モードD課題の弁別（§16 Phase 3 の受入基準）', () => {
  it.each(CASES)('%s: 正しいラダーと正しい配線なら合格する', (_id, problem) => {
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const judged = judgePlc(problem, JIPM_BOARD, built.value.session, problem.referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(true);
  });

  it.each(CASES)('%s: 接点を1つ裏返したラダーでは不合格になる', (_id, problem) => {
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const judged = judgePlc(
      problem,
      JIPM_BOARD,
      built.value.session,
      flipFirstContact(problem.referenceLadder),
    );
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
  });

  it.each(CASES)(
    '%s: 割付出力をランプへ直結すると twoStage で落ちる（受入基準④）',
    (_id, problem) => {
      const built = buildPlcReferenceSession(problem, JIPM_BOARD);
      if (!built.ok) throw new Error('模範回路を組めません');
      const { session, board, io, unit } = built.value;
      const y = `PLC.${unit.spec.outputs[io.outputs[0]!.y]!.name}`;
      const coil = session.wires.find((w) => String(w.from) === y);
      expect(removeWire(session, coil?.id ?? '').ok).toBe(true);
      const lamp = session.wires.find((w) => String(w.to) === 'TB_PL.1+');
      expect(removeWire(session, lamp?.id ?? '').ok).toBe(true);
      expect(addWire(session, board, t(y), t('TB_PL.1+')).ok).toBe(true);
      const judged = judgePlc(problem, JIPM_BOARD, session, problem.referenceLadder);
      expect(judged.ok).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.staticChecks.find((c) => c.id === 'twoStage')?.ok).toBe(false);
      expect(judged.value.passed).toBe(false);
    },
  );

  it.each(CASES)(
    '%s: PLC電源を盤から取ると plcPowerIndependent で落ちる（受入基準⑤）',
    (_id, problem) => {
      const built = buildPlcReferenceSession(problem, JIPM_BOARD);
      if (!built.ok) throw new Error('模範回路を組めません');
      const { session, board, io, unit } = built.value;
      const l = `PLC.${unit.spec.acPower[0]}`;
      const wire = session.wires.find((w) => String(w.to) === l);
      expect(removeWire(session, wire?.id ?? '').ok).toBe(true);
      // 鎖の末端（3点課題なら CR3.9、1級の4点課題なら CR4.9）だけが1本空いている（§6.6）
      expect(addWire(session, board, t(`${io.outputs.at(-1)?.cr ?? 'CR3'}.9`), t(l)).ok).toBe(true);
      const judged = judgePlc(problem, JIPM_BOARD, session, problem.referenceLadder);
      expect(judged.ok).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.staticChecks.find((c) => c.id === 'plcPowerIndependent')?.ok).toBe(false);
    },
  );

  it('d-003: TONの設定値を3000→5000にずらすと tolerance で不合格になる（§7.4 の弁別）', () => {
    const problem = BUILTIN_PLC_PROBLEMS.find((p) => p.id === 'd-003');
    if (problem === undefined) throw new Error('d-003 が見つかりません');
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const judged = judgePlc(
      problem,
      JIPM_BOARD,
      built.value.session,
      retimeFirstTimer(problem.referenceLadder, 3000, 5000),
    );
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
  });

  it('出力を入れ替えたラダー（Y0⇔Y1）では不合格になる', () => {
    const problem = BUILTIN_PLC_PROBLEMS[0];
    if (problem === undefined) throw new Error('課題がありません');
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const judged = judgePlc(
      problem,
      JIPM_BOARD,
      built.value.session,
      swapOutputs(problem.referenceLadder, 0, 1),
    );
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
  });

  it('入力を別の押ボタンへ配線すると ioAssignment で落ちる（§7.4）', () => {
    const problem = BUILTIN_PLC_PROBLEMS[0];
    if (problem === undefined) throw new Error('課題がありません');
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めません');
    const { session, board } = built.value;
    const wire = session.wires.find((w) => String(w.to) === 'PLC.X0');
    expect(removeWire(session, wire?.id ?? '').ok).toBe(true);
    // PB1 のa接点ではなく PB4（チェック用回路の押ボタン。§6.3）のa接点へ繋ぐ
    expect(addWire(session, board, t('TB_PB.4a'), t('PLC.X0')).ok).toBe(true);
    const judged = judgePlc(problem, JIPM_BOARD, session, problem.referenceLadder);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'ioAssignment')?.ok).toBe(false);
  });
});
