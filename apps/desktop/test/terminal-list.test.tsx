import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId, wireId } from '@ojt/circuit-sim';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionForProblem } from '../src/renderer/app/store.js';
import { TerminalListPanel } from '../src/renderer/panels/TerminalListPanel.js';
import { terminalRows } from '../src/renderer/session/terminal-list.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

afterEach(() => {
  cleanup();
});

describe('terminalRows', () => {
  const session = sessionForProblem(problem);

  it('lists only wirable board terminals, grouped by device', () => {
    const rows = terminalRows(JIPM_BOARD, session);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.id.includes('.'))).toBe(true);
    // AC一次側（CB / SW / PS）と PB／PL 本体端子は配線できないので出ない（§6.4）
    expect(rows.some((r) => ['CB', 'SW', 'PS', 'PB1', 'PL1'].includes(r.group))).toBe(false);
    expect([...new Set(rows.map((r) => r.group))]).toContain('CR1');
  });

  it('uses the role id for socket terminals (CR1 ⑨ COM, not S1 ⑨ COM)', () => {
    const rows = terminalRows(JIPM_BOARD, session);
    const com = rows.find((r) => r.id === toTerminalId('CR1.9'));
    expect(com).toBeDefined();
    expect(com?.group).toBe('CR1');
    expect(com?.label).toContain('CR1');
    expect(com?.label).toContain('COM');
    // 物理ソケットIDは1つも残っていない（`session.wires` は役割ベースなので混ぜられない）
    expect(rows.some((r) => /^S[1-8]\./u.test(r.id))).toBe(false);
  });

  it('leaves out the spare sockets and the buzzer the problem did not add (B3)', () => {
    const rows = terminalRows(JIPM_BOARD, session);
    // b-001 が役割を割り当てるのは S1(CR1) / S2(CR2) / S5(T1) / S6(T2) / S7(CHK) の5つ
    expect([...new Set(rows.map((r) => r.group))].sort()).toEqual([
      'CHK',
      'CR1',
      'CR2',
      'N',
      'P',
      'T1',
      'T2',
      'TB_PB',
      'TB_PL',
    ]);
    // 5ソケット×14 ＋ TB_PL 8 ＋ TB_PB 12 ＋ P 1 ＋ N 1 ＝ 92
    expect(rows).toHaveLength(92);
  });

  it('counts the wires at each terminal and marks the full ones', () => {
    const rows = terminalRows(JIPM_BOARD, session);
    // チェック用回路の既設配線（`P.1 → TB_PB.4c`）が P.1 を1本使っている（§6.3）
    expect(rows.find((r) => r.id === toTerminalId('P.1'))?.wireCount).toBe(1);
    expect(rows.find((r) => r.id === toTerminalId('P.1'))?.full).toBe(false);
    // 既設配線は役割ベースの端子IDで張られているので、CHK 側も数えられている
    expect(rows.find((r) => r.id === toTerminalId('CHK.14'))?.wireCount).toBe(1);
  });

  it('filters by the search text over both the id and the label', () => {
    const rows = terminalRows(JIPM_BOARD, session, 'PL1');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => `${r.id}${r.label}`.includes('PL1'))).toBe(true);
  });
});

describe('TerminalListPanel（UXレビュー #29）', () => {
  const session = sessionForProblem(problem);

  it('renders every terminal as a focusable button', () => {
    render(
      <TerminalListPanel
        board={JIPM_BOARD}
        session={session}
        pendingTerminal={undefined}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const buttons = screen.getAllByTestId(/^terminal-row-/u);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button.tagName).toBe('BUTTON');
  });

  it('hands a PickHit to the caller on click and on Enter', () => {
    const onPick = vi.fn();
    render(
      <TerminalListPanel
        board={JIPM_BOARD}
        session={session}
        pendingTerminal={undefined}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    const row = screen.getByTestId('terminal-row-CR1.14');
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith({
      kind: 'terminal',
      id: 'CR1.14',
      wirable: true,
      label: expect.any(String) as string,
    });
    onPick.mockClear();
    fireEvent.keyDown(row, { key: 'Enter' });
    // ブラウザは Enter を click に直すので、ここでは二重に呼ばないことを確かめる
    expect(onPick).not.toHaveBeenCalled();
  });

  it('shows which terminal is waiting for its partner and offers a cancel', () => {
    const onCancel = vi.fn();
    render(
      <TerminalListPanel
        board={JIPM_BOARD}
        session={session}
        pendingTerminal={'CR1.14' as never}
        onPick={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByTestId('terminal-pending')).toHaveTextContent('CR1.14');
    fireEvent.click(screen.getByTestId('terminal-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  /*
   * I3（Plan 5 C/D レビュー）: 満杯の端子は `disabled` にしない。`disabled` の要素には
   * Chromium がポインタイベント（`title` のツールチップを含む）を配らず、読み上げも
   * `disabled` の要素は飛ばすため、以前は理由が訓練者に届かなかった。行は
   * フォーカスできるまま残し（`aria-disabled`）、押しても何も起きないだけにする。
   */
  it('marks the terminals that already hold two wires as aria-disabled, not disabled (I3)', () => {
    const full = sessionForProblem(problem);
    // `P.1` は既設配線で1本、ここで1本足して満杯にする
    full.wires.push({
      id: wireId('w-x'),
      from: 'P.1' as never,
      to: 'CR1.14' as never,
      color: '青',
      locked: false,
      open: false,
    });
    render(
      <TerminalListPanel
        board={JIPM_BOARD}
        session={full}
        pendingTerminal={undefined}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const row = screen.getByTestId('terminal-row-P.1');
    // disabled ではない（フォーカスできる。`toBeDisabled()` は false）
    expect(row).not.toBeDisabled();
    expect(row).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not call onPick when a full terminal row is clicked, and keeps the reason reachable (I3)', () => {
    const full = sessionForProblem(problem);
    full.wires.push({
      id: wireId('w-x'),
      from: 'P.1' as never,
      to: 'CR1.14' as never,
      color: '青',
      locked: false,
      open: false,
    });
    const onPick = vi.fn();
    render(
      <TerminalListPanel
        board={JIPM_BOARD}
        session={full}
        pendingTerminal={undefined}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    const row = screen.getByTestId('terminal-row-P.1');
    fireEvent.click(row);
    expect(onPick).not.toHaveBeenCalled();
    // title は disabled ではないので Chromium 上でも表示される
    expect(row).toHaveAttribute('title', 'この端子には既に2本つながっています');
    // 読み上げ用にも `aria-describedby` の先に理由文がある
    const describedBy = row.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(
      'この端子には既に2本つながっています',
    );
  });

  it('still lets the trainee cancel the pending terminal even if it is now full', () => {
    const full = sessionForProblem(problem);
    full.wires.push({
      id: wireId('w-x'),
      from: 'P.1' as never,
      to: 'CR1.14' as never,
      color: '青',
      locked: false,
      open: false,
    });
    const onPick = vi.fn();
    render(
      <TerminalListPanel
        board={JIPM_BOARD}
        session={full}
        pendingTerminal={'P.1' as never}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    const row = screen.getByTestId('terminal-row-P.1');
    expect(row).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalled();
  });

  it('narrows the list as the trainee types', () => {
    render(
      <TerminalListPanel
        board={JIPM_BOARD}
        session={session}
        pendingTerminal={undefined}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('terminal-search'), { target: { value: 'PL1' } });
    const rows = screen.getAllByTestId(/^terminal-row-/u);
    expect(rows.every((r) => (r.textContent ?? '').includes('PL1'))).toBe(true);
  });
});
