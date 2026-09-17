import type { FaultReport } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import { RepairPanel } from '../src/renderer/panels/RepairPanel.js';
import { ReportPanel } from '../src/renderer/panels/ReportPanel.js';

/**
 * モードC2の指摘・修復パネル（Plan 2B Task 13）。設計仕様 §9.2。
 */

afterEach(() => {
  cleanup();
});

const REPORTS: FaultReport[] = [
  { target: { wireId: 'sw-003' }, kind: 'wire-open' },
  { target: { terminalId: 'CR1.13' }, kind: 'wire-missing' },
  { target: { partId: 'CR2' }, kind: 'part-defect' },
];

describe('ReportPanel（§9.2 指摘一覧）', () => {
  it('登録した指摘を並べ、取消せる', () => {
    const onRemove = vi.fn();
    render(
      <ReportPanel
        reports={REPORTS}
        pending={undefined}
        onPick={vi.fn()}
        onCancel={vi.fn()}
        onRemove={onRemove}
      />,
    );
    const list = screen.getByTestId('report-list');
    expect(list.textContent).toContain('sw-003');
    expect(list.textContent).toContain('CR1.13');
    expect(list.textContent).toContain('CR2');
    expect(list.textContent).toContain('断線');
    expect(list.textContent).toContain('未配線');
    expect(list.textContent).toContain('部品不良');
    fireEvent.click(screen.getByTestId('remove-report-1'));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('正誤は出さない（答えが漏れない。§9.2）', () => {
    render(
      <ReportPanel
        reports={REPORTS}
        pending={undefined}
        onPick={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const text = screen.getByTestId('report-panel').textContent ?? '';
    expect(text).not.toContain('正解');
    expect(text).not.toContain('見逃し');
    expect(text).not.toContain('過剰');
  });

  it('件数を出す', () => {
    render(
      <ReportPanel
        reports={REPORTS}
        pending={undefined}
        onPick={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-count').textContent).toContain('3');
  });
});

describe('種別ポップオーバー（§9.2）', () => {
  it('電線を選んだら 断線 と 誤配線 を出す', () => {
    const onPick = vi.fn();
    render(
      <ReportPanel
        reports={[]}
        pending={{ wireId: 'sw-003' }}
        onPick={onPick}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-popover').textContent).toContain('sw-003');
    fireEvent.click(screen.getByTestId('report-kind-wire-misrouted'));
    expect(onPick).toHaveBeenCalledWith('wire-misrouted');
    expect(screen.queryByTestId('report-kind-part-defect')).toBeNull();
  });

  it('端子を選んだら 未配線 だけを出す', () => {
    render(
      <ReportPanel
        reports={[]}
        pending={{ terminalId: 'CR1.13' }}
        onPick={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-kind-wire-missing')).toBeTruthy();
    expect(screen.queryByTestId('report-kind-wire-open')).toBeNull();
  });

  it('取消でポップオーバーを閉じる', () => {
    const onCancel = vi.fn();
    render(
      <ReportPanel
        reports={[]}
        pending={{ partId: 'CR2' }}
        onPick={vi.fn()}
        onCancel={onCancel}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('report-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('RepairPanel（§9.2 修復）', () => {
  it('追加した白線と外した青線を並べる', () => {
    render(
      <RepairPanel
        addedWires={['w-101']}
        removedWires={['sw-002']}
        mountedParts={[]}
        onReplacePart={vi.fn()}
      />,
    );
    expect(screen.getByTestId('added-wires').textContent).toContain('w-101');
    expect(screen.getByTestId('removed-wires').textContent).toContain('sw-002');
  });

  it('改造かどうかは出さない（判定時に計上する。§9.2）', () => {
    const text =
      render(
        <RepairPanel
          addedWires={[]}
          removedWires={['sw-002']}
          mountedParts={[]}
          onReplacePart={vi.fn()}
        />,
      ).container.textContent ?? '';
    expect(text).not.toContain('改造');
  });

  it('装着済み部品を交換できる', () => {
    const onReplacePart = vi.fn();
    render(
      <RepairPanel
        addedWires={[]}
        removedWires={[]}
        mountedParts={[{ socketId: 'S1', partId: 'CR1', isTimer: false, replaced: false }]}
        onReplacePart={onReplacePart}
      />,
    );
    fireEvent.click(screen.getByTestId('replace-CR1'));
    expect(onReplacePart).toHaveBeenCalledWith('S1', 'CR1');
  });

  it('交換済みの部品はボタンを無効にして「交換しました」と出す', () => {
    render(
      <RepairPanel
        addedWires={[]}
        removedWires={[]}
        mountedParts={[{ socketId: 'S1', partId: 'CR1', isTimer: false, replaced: true }]}
        onReplacePart={vi.fn()}
      />,
    );
    const button = screen.getByTestId<HTMLButtonElement>('replace-CR1');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(JA.inspectRepair.replaced);
  });
});
