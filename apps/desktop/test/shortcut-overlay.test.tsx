import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { JTEKT_PC10G, MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300 } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';
import { isModalOpen } from '../src/renderer/session/interaction.js';
import { monitorStartLabel } from '../src/renderer/session/plc-skin.js';

/**
 * キーの早見表の覆い。指摘 PR-05 ／ Phase 7 設計 §5.5 ／ Plan Task 22 Step 5。
 *
 * 右の欄の「キー割当」は既定で畳まれていて、格子を見ながらキーを引けなかった。
 * `Shift + ?` で全キーを覆いで出し、`Esc` で閉じ、押していた場所へフォーカスが戻ること。
 */

const problem = BUILTIN_PLC_PROBLEMS[0]!;

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ monitorColor: '' });
  act(() => {
    useStore.getState().openProblem(problem);
  });
});

function workspace(profile = MITSUBISHI_FX5U): void {
  render(<LadderWorkspace problem={problem} profile={profile} gridCols={11} onPlc={vi.fn()} />);
}

/** `Shift + ?` を打つ（`?` は Shift を押さないと出ない文字なので `shiftKey` も立てる）。 */
function pressHelpKey(): void {
  act(() => {
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
  });
}

describe('Shift + ? の早見表（指摘 PR-05）', () => {
  it('opens on Shift + ? and closes on Esc', () => {
    workspace();
    expect(screen.queryByTestId('shortcut-overlay')).toBeNull();
    pressHelpKey();
    expect(screen.getByTestId('shortcut-overlay')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByTestId('shortcut-overlay')).toBeNull();
  });

  it('closes with the close button too, and gives the focus back to where it came from', () => {
    workspace();
    const notation = screen.getByTestId('toolbar-notation');
    act(() => {
      notation.focus();
    });
    pressHelpKey();
    // 開いた直後の読み上げ位置は覆いの先頭
    expect(document.activeElement).toBe(screen.getByTestId('shortcut-overlay'));
    act(() => {
      fireEvent.click(screen.getByTestId('shortcut-overlay-close'));
    });
    expect(screen.queryByTestId('shortcut-overlay')).toBeNull();
    expect(document.activeElement).toBe(notation);
  });

  it('counts itself as a modal layer while it is open, and lets it go when it closes (§8.2)', () => {
    workspace();
    expect(isModalOpen()).toBe(false);
    pressHelpKey();
    expect(isModalOpen()).toBe(true);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(isModalOpen()).toBe(false);
  });

  it('does not steal the ? the trainee is typing into a device box', () => {
    workspace();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    act(() => {
      fireEvent.keyDown(input, { key: '?', shiftKey: true });
    });
    expect(screen.queryByTestId('shortcut-overlay')).toBeNull();
    input.remove();
  });

  it('takes every row from profile.shortcuts, so switching the vendor changes the table', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      pressHelpKey();
      for (const entry of profile.shortcuts) {
        const row = screen.getByTestId(`overlay-shortcut-${entry.action}`);
        expect(row, `${profile.id}/${entry.action}`).toHaveTextContent(entry.label);
      }
    }
  });

  /**
   * Task 20 の申し送り: どの方言も `shortcuts` に `monitor` の行を持たない場合がある
   * （OMRON）。キーではなくツールバーの項目名で「どこを押すか」を出す（指摘 LE-7）。
   */
  it('names the toolbar item for モニタ where the vendor has no monitor key (OMRON)', () => {
    expect(OMRON_CP1E.shortcuts.some((entry) => entry.action === 'monitor')).toBe(false);
    workspace(OMRON_CP1E);
    pressHelpKey();
    const row = screen.getByTestId('overlay-shortcut-monitor');
    expect(row).toHaveTextContent(monitorStartLabel(OMRON_CP1E));
    expect(row).not.toHaveTextContent('F3');
  });

  it('keeps the 出典 marks the key table carries (Task 20)', () => {
    workspace(MITSUBISHI_FX5U);
    pressHelpKey();
    expect(screen.getByTestId('overlay-shortcut-contact-no')).toHaveTextContent('出典 S1');
  });

  /**
   * Task 20 の申し送り: PCwin風・JW-300SP風は表そのものを借りていて**全行が △** なので、
   * 行ごとに同じ断りを22回並べず、表の上に1回だけ出す。
   */
  it('says the borrowed table is assumed once, not on all 22 rows (JTEKT / SHARP)', () => {
    for (const profile of [JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      workspace(profile);
      pressHelpKey();
      expect(screen.getByTestId('shortcut-overlay-note'), profile.id).toHaveTextContent(
        '本アプリの表記です',
      );
      expect(screen.getByTestId('overlay-shortcut-contact-no'), profile.id).not.toHaveTextContent(
        '本アプリの表記です',
      );
    }
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E]) {
      cleanup();
      workspace(profile);
      pressHelpKey();
      expect(screen.queryByTestId('shortcut-overlay-note'), profile.id).toBeNull();
    }
  });

  it('marks the assumed rows one by one where the table is the vendor’s own (三菱)', () => {
    workspace(MITSUBISHI_FX5U);
    pressHelpKey();
    // 三菱の微分接点は △（一次資料で確認できていない）
    expect(screen.getByTestId('overlay-shortcut-pulse-rise')).toHaveTextContent(
      '本アプリの表記です',
    );
    expect(screen.getByTestId('overlay-shortcut-contact-no')).not.toHaveTextContent(
      '本アプリの表記です',
    );
  });
});
