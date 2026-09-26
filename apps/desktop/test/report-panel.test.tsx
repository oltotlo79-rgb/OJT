import type { FaultReport } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import { RepairPanel } from '../src/renderer/panels/RepairPanel.js';
import { ReportPanel, reportKindText } from '../src/renderer/panels/ReportPanel.js';
import {
  popoverPosition,
  POPOVER_WIDTH_PX,
  ReportPopover,
} from '../src/renderer/panels/ReportPopover.js';

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
    render(<ReportPanel reports={REPORTS} onRemove={onRemove} />);
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

  it('部品不良は選んだ内容を添える（2026-09-26）', () => {
    render(
      <ReportPanel
        reports={[{ target: { partId: 'CR2' }, kind: 'part-defect', detail: 'contact-welded' }]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-kind-text-0').textContent).toBe('部品不良（接点の溶着）');
    expect(
      reportKindText({ target: { partId: 'CR2' }, kind: 'part-defect', detail: 'unknown' }),
    ).toBe('部品不良（内容不明）');
  });

  it('正誤は出さない（答えが漏れない。§9.2）', () => {
    render(<ReportPanel reports={REPORTS} onRemove={vi.fn()} />);
    const text = screen.getByTestId('report-panel').textContent ?? '';
    expect(text).not.toContain('正解');
    expect(text).not.toContain('見逃し');
    expect(text).not.toContain('過剰');
  });

  it('件数を出す', () => {
    render(<ReportPanel reports={REPORTS} onRemove={vi.fn()} />);
    expect(screen.getByTestId('report-count').textContent).toContain('3');
  });
});

describe('3D図の中の指摘の小窓（2026-09-26 利用者指示）', () => {
  const at = { left: 10, top: 20 };

  it('電線を選んだら 断線 と 誤配線 を出す', () => {
    const onPick = vi.fn();
    render(
      <ReportPopover
        pending={{ wireId: 'sw-003' }}
        wires={[]}
        position={at}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-popover-target').textContent).toContain('sw-003');
    fireEvent.click(screen.getByTestId('report-kind-wire-misrouted'));
    expect(onPick).toHaveBeenCalledWith('wire-misrouted');
    expect(screen.queryByTestId('report-kind-part-defect')).toBeNull();
  });

  it('端子を選んだら 未配線 だけを出し、理由を説明する', () => {
    render(
      <ReportPopover
        pending={{ terminalId: 'CR1.13' }}
        wires={[]}
        position={at}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-kind-wire-missing')).toBeTruthy();
    expect(screen.queryByTestId('report-kind-wire-open')).toBeNull();
    expect(screen.getByTestId('pick-kind-hint').textContent).toBe(
      JA.inspectRepair.popoverTerminalHint,
    );
  });

  it('部品を選んだらコイル・接点の故障の内容を選べる（「分からない」も選べる）', () => {
    const onPick = vi.fn();
    render(
      <ReportPopover
        pending={{ partId: 'CR2' }}
        wires={[]}
        position={at}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('report-detail-coil-open'));
    expect(onPick).toHaveBeenLastCalledWith('part-defect', 'coil-open');
    fireEvent.click(screen.getByTestId('report-detail-contact-welded'));
    expect(onPick).toHaveBeenLastCalledWith('part-defect', 'contact-welded');
    fireEvent.click(screen.getByTestId('report-kind-part-defect'));
    expect(onPick).toHaveBeenLastCalledWith('part-defect', 'unknown');
  });

  it('取消・Esc で閉じる', () => {
    const onCancel = vi.fn();
    render(
      <ReportPopover
        pending={{ partId: 'CR2' }}
        wires={[]}
        position={at}
        onPick={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('report-cancel'));
    fireEvent.keyDown(screen.getByTestId('report-popover'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('押した場所の右下に出し、はみ出すときは内側へ寄せる', () => {
    const viewport = { width: 1000, height: 700 };
    expect(popoverPosition({ x: 100, y: 100 }, viewport)).toEqual({ left: 114, top: 114 });
    // 右端・下端の近くで押したら内側へ
    const edge = popoverPosition({ x: 990, y: 690 }, viewport);
    expect(edge.left + POPOVER_WIDTH_PX).toBeLessThanOrEqual(viewport.width);
    expect(edge.top).toBeLessThan(690);
    // 一覧から開いたとき（押した場所が無い）は右上
    expect(popoverPosition(undefined, viewport).top).toBe(56);
  });
});

describe('RepairPanel（§9.2 修復）', () => {
  // `RepairPanel` はもらった文字列をそのまま並べるだけ（呼び出し側が `wireLabel()` で
  // 表示名を組み立ててから渡す。UI監査 I5）。ここでは表示名で渡す。
  it('追加した白線と外した青線を並べる', () => {
    render(
      <RepairPanel
        addedWires={['CR1.9–PB1.2c の白線']}
        removedWires={['CR1.9–PB1.2c の青線']}
        mountedParts={[]}
        onReplacePart={vi.fn()}
      />,
    );
    expect(screen.getByTestId('added-wires').textContent).toContain('CR1.9–PB1.2c の白線');
    expect(screen.getByTestId('removed-wires').textContent).toContain('CR1.9–PB1.2c の青線');
  });

  it('改造かどうかは出さない（判定時に計上する。§9.2）', () => {
    const text =
      render(
        <RepairPanel
          addedWires={[]}
          removedWires={['CR1.9–PB1.2c の青線']}
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
