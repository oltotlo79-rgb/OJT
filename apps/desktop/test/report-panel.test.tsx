import type { FaultReport } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import { RepairPanel } from '../src/renderer/panels/RepairPanel.js';
import { ReportPanel, reportKindText } from '../src/renderer/panels/ReportPanel.js';
import {
  popoverAreaOf,
  popoverPosition,
  POPOVER_WIDTH_PX,
  ReportPopover,
} from '../src/renderer/panels/ReportPopover.js';
import { useStore } from '../src/renderer/app/store.js';

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
    render(<ReportPanel onEdit={vi.fn()} reports={REPORTS} onRemove={onRemove} />);
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
        onEdit={vi.fn()}
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
    render(<ReportPanel onEdit={vi.fn()} reports={REPORTS} onRemove={vi.fn()} />);
    const text = screen.getByTestId('report-panel').textContent ?? '';
    expect(text).not.toContain('正解');
    expect(text).not.toContain('見逃し');
    expect(text).not.toContain('過剰');
  });

  it('件数を出す', () => {
    render(<ReportPanel onEdit={vi.fn()} reports={REPORTS} onRemove={vi.fn()} />);
    expect(screen.getByTestId('report-count').textContent).toContain('3');
  });
});

describe('3D図の中の指摘の小窓（2026-09-26 利用者指示）', () => {
  /** 小窓を置ける範囲（ビューポートの中のキャンバスの矩形）。 */
  const AREA = { left: 0, top: 30, right: 1000, bottom: 600 };

  it('電線を選んだら 断線 と 誤配線 を出す', () => {
    const onPick = vi.fn();
    render(
      <ReportPopover
        pending={{ wireId: 'sw-003' }}
        wires={[]}
        anchor={undefined}
        area={AREA}
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
        anchor={undefined}
        area={AREA}
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
        anchor={undefined}
        area={AREA}
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
        anchor={undefined}
        area={AREA}
        onPick={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('report-cancel'));
    fireEvent.keyDown(screen.getByTestId('report-popover'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('押した場所の右下に出し、入らなければ左・上へ回す（実寸で決める。v2.1.0 監査 U7）', () => {
    const size = { width: 340, height: 300 };
    // 右下に入る
    expect(popoverPosition({ x: 100, y: 100 }, AREA, size)).toEqual({ left: 114, top: 114 });
    // 右に入らない → 押した点の左
    expect(popoverPosition({ x: 900, y: 100 }, AREA, size).left).toBe(900 - 14 - 340);
    // 下に入らない → 押した点の上（押した物を隠さない）
    expect(popoverPosition({ x: 100, y: 500 }, AREA, size).top).toBe(500 - 14 - 300);
    // 上下どちらにも入らない高さ → 置き場の中へ寄せる（下の帯へははみ出さない）
    const tall = popoverPosition({ x: 100, y: 300 }, AREA, { width: 340, height: 560 });
    expect(tall.top).toBeGreaterThanOrEqual(AREA.top);
    expect(tall.top + 560).toBeLessThanOrEqual(AREA.bottom);
    // 一覧から開いたとき（押した点が無い）は置き場の右上
    expect(popoverPosition(undefined, AREA, size)).toEqual({ left: 1000 - 340 - 8, top: 38 });
    expect(POPOVER_WIDTH_PX).toBe(340);
  });

  it('置き場は3Dを描くキャンバスの矩形（押しボタンの帯・状態の帯を含めない）', () => {
    const viewport = document.createElement('div');
    const canvas = document.createElement('canvas');
    viewport.append(canvas);
    document.body.append(viewport);
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 900, 700));
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 900, 520));
    expect(popoverAreaOf(viewport)).toEqual({ left: 0, top: 30, right: 900, bottom: 550 });
    viewport.remove();
  });

  it('開いたあとの実寸で置き直す（押した点の上に出す）', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(340);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(420);
    render(
      <ReportPopover
        pending={{ partId: 'CR2' }}
        wires={[]}
        anchor={{ x: 200, y: 560 }}
        area={AREA}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const popover = screen.getByTestId('report-popover');
    // 実寸 420px は押した点の下（560 + 14）に入らないので上へ出す
    expect(popover.style.top).toBe(`${String(560 - 14 - 420)}px`);
    expect(popover.style.left).toBe('214px');
    vi.restoreAllMocks();
  });

  it('置き場を省くと、入れてある3Dの枠のキャンバスを測って置く', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 1000, 700));
    // キャンバスは状態の帯（30px）の下から、押しボタンの帯（下 90px）の上まで
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 130, 1000, 580));
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(340);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
    render(
      <ReportPopover
        pending={{ partId: 'CR2' }}
        wires={[]}
        anchor={{ x: 100, y: 500 }}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
      { container: host },
    );
    const popover = screen.getByTestId('report-popover');
    // 下（500 + 14 + 200 = 714）はキャンバスの下端（610）を越えるので、押した点の上へ
    expect(popover.style.top).toBe(`${String(500 - 14 - 200)}px`);
    expect(popover.style.left).toBe('114px');
    vi.restoreAllMocks();
    host.remove();
  });

  it('端子はソケットの番号でも呼ぶ（3Dの札「S1 端子9」とそろえる。v2.1.0 監査 U7）', () => {
    useStore.setState({
      session: { socketRoles: { S1: 'CR1', S2: 'CR2' } } as unknown as ReturnType<
        typeof useStore.getState
      >['session'],
    });
    render(
      <ReportPopover
        pending={{ terminalId: 'CR1.9' }}
        wires={[]}
        anchor={undefined}
        area={AREA}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('report-popover-target').textContent).toBe('S1 端子9（CR1⑨）');
    useStore.setState({ session: undefined });
  });
});

describe('RepairPanel（§9.2 修復）', () => {
  // `RepairPanel` はもらった文字列をそのまま並べるだけ（呼び出し側が `wireLabel()` で
  // 表示名を組み立ててから渡す。UI監査 I5）。ここでは表示名で渡す。
  it('追加した白線と外した青線を並べる', () => {
    render(
      <RepairPanel
        onRestoreWire={vi.fn()}
        addedWires={[{ id: 'w-001', label: 'CR1.9–PB1.2c の白線' }]}
        removedWires={[{ id: 'sw-001', label: 'CR1.9–PB1.2c の青線' }]}
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
          onRestoreWire={vi.fn()}
          addedWires={[]}
          removedWires={[{ id: 'sw-001', label: 'CR1.9–PB1.2c の青線' }]}
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
        onRestoreWire={vi.fn()}
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
        onRestoreWire={vi.fn()}
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
