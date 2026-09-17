import { JIPM_BOARD, addWire, removeWire, toNetlistTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildInspectRepairCircuit,
  buildReferenceSession,
  judgeInspectRepair,
  type FaultReport,
  type FaultSite,
  type JudgeInspectRepairResult,
} from '@ojt/content';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloneSession } from '../src/renderer/session/commands.js';
import { circuitForJudge } from '../src/renderer/session/inspect-repair.js';
import { InspectRepairResult } from '../src/renderer/result/InspectRepairResult.js';

/**
 * 結果画面を**本物の判定結果**（`judgeInspectRepair()` を実際に呼んだ値）で描く
 * （Plan 2B Task 16 / レビュー: これまでは手で作った `result` オブジェクトだけで
 * 見ていたので、判定と表示の継ぎ目は見ていなかった）。§9.2 判定①〜⑤
 */

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === 'c2-001');

function correctReport(site: FaultSite): FaultReport {
  if (site.kind === 'wire-missing') {
    return { target: { terminalId: String(site.terminals[0]) }, kind: site.report };
  }
  if (site.wireId !== undefined) return { target: { wireId: site.wireId }, kind: site.report };
  return { target: { partId: site.partId ?? '' }, kind: site.report };
}

function judgeOf(repair: boolean, report: boolean): JudgeInspectRepairResult | undefined {
  if (C2 === undefined) return undefined;
  const built = buildInspectRepairCircuit(C2, JIPM_BOARD, { seed: 7 });
  const ref = buildReferenceSession(C2, JIPM_BOARD);
  if (!built.ok || !ref.ok) return undefined;
  const circuit = built.value;
  const session = circuit.session;
  if (repair) {
    for (const site of circuit.applied.sites) {
      const wireId = site.wireId;
      if (wireId === undefined) continue;
      if (site.kind !== 'wire-missing') removeWire(session, wireId);
      const original = ref.value.session.wires.find((w) => w.id === wireId);
      const from = (original?.from ?? site.terminals[0]) as TerminalId;
      const to = (original?.to ?? site.terminals[1]) as TerminalId;
      addWire(
        session,
        JIPM_BOARD,
        toNetlistTerminal(session.socketRoles, from),
        toNetlistTerminal(session.socketRoles, to),
        '白',
      );
    }
  }
  const outcome = judgeInspectRepair(
    C2,
    JIPM_BOARD,
    circuitForJudge(circuit, cloneSession(session)),
    report ? circuit.applied.sites.map(correctReport) : [],
    { elapsedMs: 600_000 },
  );
  return outcome.ok && outcome.value.mode === 'inspect-repair' ? outcome.value : undefined;
}

afterEach(() => {
  cleanup();
});

describe('InspectRepairResult with a real judge result', () => {
  it('合格のときは見逃し・過剰指摘・改造がすべて「なし」（受入基準③）', () => {
    const value = judgeOf(true, true);
    expect(value).toBeDefined();
    if (value === undefined || C2 === undefined) return;
    expect(value.passed).toBe(true);
    render(
      <InspectRepairResult
        problem={C2}
        result={value}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('合格');
    expect(screen.getByTestId('missed-list').textContent).toContain('なし');
    expect(screen.getByTestId('extra-list').textContent).toContain('なし');
    expect(screen.getByTestId('modification-list').textContent).toContain('改造はありません');
    expect(screen.getByTestId('added-wire-list').textContent).not.toContain('なし');
    expect(screen.getByTestId('result-elapsed').textContent).toContain('10:00.0');
    // タイムチャート（模範 vs 実測）が描かれている
    expect(document.querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  it('不合格のときは見逃しを2件並べ、差分の帯が出る', () => {
    const value = judgeOf(false, false);
    expect(value).toBeDefined();
    if (value === undefined || C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={value}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('不合格');
    const missed = screen.getByTestId('missed-list').textContent ?? '';
    // c2-001 の見逃しは断線（sw-005。wireId で示す）と未配線（sw-009。M1で端子表示に変更 —
    // 訓練者は配線されたことのない電線を見ていないので、その wireId ではなく端子で示す）
    expect(missed).toContain('sw-005');
    expect(missed).toContain('CR1.6');
    expect(missed).not.toContain('sw-009');
    expect(value.mismatches.length).toBeGreaterThan(0);
  });
});
