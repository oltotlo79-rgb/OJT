import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 自動保存の状態の置き場所（v2.1.0 Task 2・点検 U2）。
 * 以前は `App.tsx` が画面の右下に `position: fixed` で重ね、右の欄の一番下のボタン
 * （C1 のテスターの「導通」など）を覆っていた。いまは練習画面の下の帯の中に置く。
 */
const autosave = vi.hoisted(() => {
  const status: { state: string; at?: string; message?: string } = { state: 'idle' };
  return { status, flush: vi.fn(() => Promise.resolve(true)) };
});
vi.mock('../src/renderer/session/autosave.js', () => ({
  useAutosaveStatus: () => autosave.status,
  flushAutosave: autosave.flush,
}));

const { SessionActivity } = await import('../src/renderer/panels/SessionActivity.js');

function renderBar(): void {
  render(
    <SessionActivity
      limit={{ standardMin: 30, cutoffMin: 50 }}
      lines={[]}
      hazards={[]}
      chatters={[]}
    />,
  );
}

afterEach(() => {
  cleanup();
  autosave.status = { state: 'idle' };
  autosave.flush.mockClear();
});

describe('自動保存の状態は下の帯の中に出る', () => {
  it('帯（操作ログ・経過時間）の右に並び、画面に重ねる固定配置ではない', () => {
    autosave.status = { state: 'saved', at: '2026-10-16T03:04:05.000Z' };
    renderBar();
    const row = screen.getByTestId('session-activity-row');
    const status = within(row).getByTestId('autosave-status');
    // 帯の開閉ボタン（`<summary>`）の子ではない（失敗時のボタンが読み上げから外れないように）
    expect(
      within(screen.getByTestId('activity-toggle')).queryByTestId('autosave-status'),
    ).toBeNull();
    expect(status.textContent).toMatch(/^自動保存済み \d{1,2}:\d{2}:\d{2}$/u);
    expect(status.style.position).toBe('');
  });

  it('保存待ち・保存中・準備中の文言', () => {
    autosave.status = { state: 'pending' };
    renderBar();
    expect(screen.getByTestId('autosave-status')).toHaveTextContent('自動保存待ち');
    cleanup();
    autosave.status = { state: 'saving' };
    renderBar();
    expect(screen.getByTestId('autosave-status')).toHaveTextContent('自動保存中…');
    cleanup();
    autosave.status = { state: 'idle' };
    renderBar();
    expect(screen.getByTestId('autosave-status')).toHaveTextContent('自動保存を準備しています');
  });

  it('失敗のときの「再試行」は保存をやり直し、帯は開閉しない', () => {
    autosave.status = { state: 'failed', message: '書込先が利用できません' };
    renderBar();
    const retry = screen.getByRole('button', { name: '自動保存失敗 — 再試行' });
    expect(retry.title).toBe('書込先が利用できません');
    fireEvent.click(retry);
    expect(autosave.flush).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId<HTMLDetailsElement>('session-activity').open).toBe(false);
  });
});
