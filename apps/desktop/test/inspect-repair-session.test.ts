import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS, buildInspectRepairCircuit } from '@ojt/content';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import type { PickHit } from '../src/renderer/session/interaction.js';
import {
  circuitForJudge,
  hasReportFor,
  reportKindsFor,
  reportPickToAction,
  registerReport,
} from '../src/renderer/session/inspect-repair.js';

/**
 * モードC2の純関数（Plan 2B Task 12）。設計仕様 §9.2。
 */

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];

/** ソケットID → 役割ID（既定の割当）。 */
function partIdOf(socketId: string): string {
  const table: Record<string, string> = {
    S1: 'CR1',
    S2: 'CR2',
    S3: 'CR3',
    S4: 'T1',
    S5: 'T2',
    S6: 'T3',
    S7: 'CHK',
  };
  return table[socketId] ?? socketId;
}

describe('reportKindsFor（§9.2 指摘の種別）', () => {
  it('電線は 断線 と 誤配線', () => {
    expect(reportKindsFor({ wireId: 'sw-001' })).toEqual(['wire-open', 'wire-misrouted']);
  });

  it('端子は 未配線 だけ（電線が無いので端子で指す。Plan 2A 差分 #6）', () => {
    expect(reportKindsFor({ terminalId: 'CR1.13' })).toEqual(['wire-missing']);
  });

  it('部品は 部品不良 だけ', () => {
    expect(reportKindsFor({ partId: 'CR1' })).toEqual(['part-defect']);
  });
});

describe('reportPickToAction（§9.2）', () => {
  it('電線をクリックすると種別ポップオーバーを開く', () => {
    const hit: PickHit = { kind: 'wire', id: 'sw-003', locked: false };
    expect(reportPickToAction(hit, partIdOf)).toEqual({
      type: 'openReport',
      target: { wireId: 'sw-003' },
    });
  });

  it('既設配線（チェック用回路）は指摘できない', () => {
    const hit: PickHit = { kind: 'wire', id: 'fw-chk-1', locked: true };
    const action = reportPickToAction(hit, partIdOf);
    expect(action.type).toBe('reject');
  });

  it('端子をクリックすると未配線の指摘を開く', () => {
    const hit: PickHit = {
      kind: 'terminal',
      id: toTerminalId('CR1.13'),
      wirable: true,
      label: 'CR1 ⑬ −',
    };
    expect(reportPickToAction(hit, partIdOf)).toEqual({
      type: 'openReport',
      target: { terminalId: 'CR1.13' },
    });
  });

  it('装着済みのソケットをクリックすると部品不良の指摘を開く（役割IDで指す）', () => {
    const hit: PickHit = { kind: 'socket', id: 'S1', occupied: true };
    expect(reportPickToAction(hit, partIdOf)).toEqual({
      type: 'openReport',
      target: { partId: 'CR1' },
    });
  });

  it('空のソケットは指摘できない（部品が無いので不良も無い）', () => {
    const hit: PickHit = { kind: 'socket', id: 'S8', occupied: false };
    expect(reportPickToAction(hit, partIdOf)).toEqual({ type: 'none' });
  });

  it('押ボタンは押せる（動作を確かめながら探す。§9.2）', () => {
    expect(reportPickToAction({ kind: 'pushbutton', id: 'PB1' }, partIdOf)).toEqual({
      type: 'pressButton',
      pbId: 'PB1',
    });
  });

  it('空クリックは何もしない', () => {
    expect(reportPickToAction({ kind: 'empty' }, partIdOf)).toEqual({ type: 'none' });
  });
});

describe('hasReportFor（重複の抑止）', () => {
  it('同じ対象・同じ種別は2件目を弾く', () => {
    const reports = [{ target: { wireId: 'sw-001' }, kind: 'wire-open' as const }];
    expect(hasReportFor(reports, { wireId: 'sw-001' }, 'wire-open')).toBe(true);
    expect(hasReportFor(reports, { wireId: 'sw-001' }, 'wire-misrouted')).toBe(false);
    expect(hasReportFor(reports, { wireId: 'sw-002' }, 'wire-open')).toBe(false);
  });

  it('対象の種類が違えば別物', () => {
    const reports = [{ target: { terminalId: 'CR1.13' }, kind: 'wire-missing' as const }];
    expect(hasReportFor(reports, { partId: 'CR1.13' }, 'wire-missing')).toBe(false);
  });
});

describe('registerReport（2026-09-26 部品不良の内容）', () => {
  it('新しい指摘は足す。部品不良は内容を持たせる', () => {
    expect(registerReport([], { partId: 'CR1' }, 'part-defect', 'coil-open')).toEqual({
      type: 'add',
      report: { target: { partId: 'CR1' }, kind: 'part-defect', detail: 'coil-open' },
    });
    // 電線の指摘には内容を付けない
    expect(registerReport([], { wireId: 'w' }, 'wire-open', 'coil-open')).toEqual({
      type: 'add',
      report: { target: { wireId: 'w' }, kind: 'wire-open' },
    });
  });

  it('同じ部品の内容だけを選び直したら差し替え、同じ内容なら重複として断る', () => {
    const reports = [
      { target: { wireId: 'w' }, kind: 'wire-open' as const },
      { target: { partId: 'CR1' }, kind: 'part-defect' as const, detail: 'coil-open' as const },
    ];
    expect(registerReport(reports, { partId: 'CR1' }, 'part-defect', 'contact-open')).toEqual({
      type: 'replace',
      index: 1,
      report: { target: { partId: 'CR1' }, kind: 'part-defect', detail: 'contact-open' },
    });
    expect(registerReport(reports, { partId: 'CR1' }, 'part-defect', 'coil-open')).toEqual({
      type: 'duplicate',
    });
    expect(registerReport(reports, { wireId: 'w' }, 'wire-open')).toEqual({ type: 'duplicate' });
  });
});

describe('circuitForJudge（§9.2 判定に渡す盤）', () => {
  it('提出時の盤に差し替えた回路を返す（元の回路は変えない）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const built = buildInspectRepairCircuit(C2, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const circuit = built.value;
    const submitted = { ...circuit.session, wires: circuit.session.wires.slice(0, 1) };
    const forJudge = circuitForJudge(circuit, submitted);
    expect(forJudge.session.wires).toHaveLength(1);
    expect(forJudge.applied).toBe(circuit.applied);
    expect(forJudge.initialWireIds).toBe(circuit.initialWireIds);
    // 元の回路は触らない
    expect(circuit.session.wires.length).toBeGreaterThan(1);
  });
});
