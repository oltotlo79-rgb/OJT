import { toTerminalId, wireId, type Wire } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS, type JudgeInspectRepairResult } from '@ojt/content';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectRepairResult } from '../src/renderer/result/InspectRepairResult.js';

/** テスト用の電線1本（`wireId` から表示名を組み立てるための一覧に渡す）。UI監査 I5 */
function wire(id: string, from: string, to: string, color: Wire['color'] = '青'): Wire {
  return {
    id: wireId(id),
    from: toTerminalId(from),
    to: toTerminalId(to),
    color,
    locked: false,
    open: false,
  };
}

/**
 * モードC2の結果画面（Plan 2B Task 16）。設計仕様 §9.2 判定。
 */

const C2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];

const NO_HAZARDS = {
  'ohm-on-live': 0,
  'range-exceeded': 0,
  'short-circuit-power-on': 0,
  'power-sequence-violation': 0,
  'over-wires-per-terminal': 0,
  overcurrent: 0,
} as const;

const EMPTY_CHART: JudgeInspectRepairResult['charts']['expected'] = {
  durationMs: 1000,
  signals: [],
  markers: [],
};

function result(overrides: Partial<JudgeInspectRepairResult> = {}): JudgeInspectRepairResult {
  return {
    mode: 'inspect-repair',
    passed: true,
    reports: { matched: [], missed: [], extra: [] },
    mismatches: [],
    staticChecks: [],
    modifications: [],
    addedWires: ['w-101'],
    hazardCount: 0,
    hazardsByKind: { ...NO_HAZARDS },
    chatter: [],
    elapsedMs: 600_000,
    charts: {
      expected: EMPTY_CHART,
      actual: EMPTY_CHART,
    },
    compareSignals: ['PL1'],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('InspectRepairResult（§9.2 判定）', () => {
  it('過不足なく指摘して修復すれば合格を出す', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result()}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('合格');
    expect(screen.getByTestId('missed-list').textContent).toContain('なし');
    expect(screen.getByTestId('extra-list').textContent).toContain('なし');
  });

  it('見逃しと過剰指摘を並べる（§9.2 判定①）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const wires = [wire('sw-004', 'CR1.5', 'TB_PB.1a', '青'), wire('sw-009', 'CR1.9', 'N.1', '青')];
    render(
      <InspectRepairResult
        problem={C2}
        result={result({
          passed: false,
          reports: {
            matched: [],
            missed: [
              {
                kind: 'wire-open',
                report: 'wire-open',
                wireId: 'sw-004',
                partId: undefined,
                terminals: [toTerminalId('CR1.5'), toTerminalId('TB_PB.1a')],
              },
            ],
            extra: [{ target: { wireId: 'sw-009' }, kind: 'wire-misrouted' }],
          },
        })}
        restoredHazardCount={0}
        wires={wires}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('不合格');
    // 内部の電線ID（`sw-004` / `sw-009`）ではなく、他画面と同じ表示名で出す（UI監査 I5）
    expect(screen.getByTestId('missed-list').textContent).toContain('CR1.5–TB_PB.1a の青線');
    expect(screen.getByTestId('missed-list').textContent).not.toContain('sw-004');
    expect(screen.getByTestId('extra-list').textContent).toContain('CR1.9–N.1 の青線');
    expect(screen.getByTestId('extra-list').textContent).not.toContain('sw-009');
  });

  it('未配線の見逃しは訓練者が見ていない wireId ではなく端子で示す（M1）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result({
          passed: false,
          reports: {
            matched: [],
            missed: [
              {
                kind: 'wire-missing',
                report: 'wire-missing',
                wireId: 'sw-999',
                partId: undefined,
                terminals: ['CR1.6' as never],
              },
            ],
            extra: [],
          },
        })}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    const text = screen.getByTestId('missed-list').textContent ?? '';
    expect(text).toContain('CR1.6');
    expect(text).not.toContain('sw-999');
  });

  it('改造した電線を並べる（§9.2 判定③）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    const wires = [
      wire('sw-002', 'CR1.1', 'TB_PL.1+', '青'),
      wire('sw-006', 'CR1.6', 'TB_PL.1-', '青'),
    ];
    render(
      <InspectRepairResult
        problem={C2}
        result={result({ passed: false, modifications: ['sw-002', 'sw-006'] })}
        restoredHazardCount={0}
        wires={wires}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    const list = screen.getByTestId('modification-list');
    // 内部の電線ID（`sw-002` / `sw-006`）ではなく、他画面と同じ表示名で出す（UI監査 I5）
    expect(list.textContent).toContain('CR1.1–TB_PL.1+ の青線');
    expect(list.textContent).toContain('CR1.6–TB_PL.1- の青線');
    expect(list.textContent).not.toContain('sw-002');
    expect(list.textContent).not.toContain('sw-006');
  });

  it('危険操作の回数に復元分を足す（§5.6 / §12.3）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result({ hazardCount: 1, hazardsByKind: { ...NO_HAZARDS, 'range-exceeded': 1 } })}
        restoredHazardCount={2}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByText(/危険操作（3）/)).toBeTruthy();
  });

  it('所要時間を出す（§9.2 判定⑤）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result()}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('result-elapsed').textContent).toContain('10:00.0');
  });

  it('2級形式は回路図を開いた回数を出す（§8.4 2026-09-18の決定）', () => {
    const grade2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);
    expect(grade2).toBeDefined();
    if (grade2 === undefined) return;
    render(
      <InspectRepairResult
        problem={grade2}
        result={result()}
        restoredHazardCount={0}
        schematicOpenCount={3}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.getByTestId('schematic-open-count').textContent).toContain('3');
  });

  it('1級形式は回路図を開いた回数を出さない（§8.4）', () => {
    const grade1 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 1);
    expect(grade1).toBeDefined();
    if (grade1 === undefined) return;
    render(
      <InspectRepairResult
        problem={grade1}
        result={result()}
        restoredHazardCount={0}
        schematicOpenCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('schematic-open-count')).toBeNull();
  });

  it('「もう一度／課題一覧へ」を画面下端に固定する（UXレビュー #8）', () => {
    expect(C2).toBeDefined();
    if (C2 === undefined) return;
    render(
      <InspectRepairResult
        problem={C2}
        result={result()}
        restoredHazardCount={0}
        onRetry={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );
    const retry = screen.getByRole('button', { name: 'もう一度' });
    expect(retry.parentElement?.className).toMatch(/stickyActions/);
  });
});
