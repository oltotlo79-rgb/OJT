import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { HelpDrawer } from '../src/renderer/help/HelpDrawer.js';
import { defaultSectionId, searchManual } from '../src/renderer/help/help-model.js';
import { useHelpStore } from '../src/renderer/help/help-store.js';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';
import { useHelpHotkey } from '../src/renderer/help/use-help-hotkey.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { isModalOpen } from '../src/renderer/session/interaction.js';
import type { OjtApi } from '../src/shared/ipc.js';
import type * as ManualContent from '../src/renderer/help/manual-content.js';

/** 引き出しの CSS（`:focus-visible` の輪郭が残っていることを見るために本文を読む）。 */
const helpCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/renderer/help/help.module.css'),
  'utf8',
);

/** ヘルプの引き出し。取扱説明書 設計 §5.3 / §5.4。 */

/*
 * 図の置き場所だけを差し替える（本文・章立ては生成物のまま）。
 * 図は Plan 6 Task 12 で初めて撮るので、いまの `MANUAL_IMAGES` は全部が空文字である。
 * 「撮れている図」と「まだ撮っていない図」の両方の見え方をいま縛っておかないと、
 * 図が入った日に初めて壊れていることが分かる（本プラン 決定表 P16・P17）。
 */
// `vi.mock` の工場は先頭へ巻き上げられるので、差し込む値も `vi.hoisted` で先に作る
const SHOT = vi.hoisted(() => ({ small: 'small-home.png', full: 'full-home.png' }));

vi.mock('../src/renderer/help/manual-content.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ManualContent>();
  // `home` だけ撮れている状態にする。`list` などは空のまま（＝まだ撮っていない図）
  return { ...actual, MANUAL_IMAGES: { home: SHOT } };
});

declare global {
  interface Window {
    ojt?: OjtApi;
  }
}

/** preload を差し替える（`delete` で「読み込まれていない」状態に戻せる）。 */
function setApi(api: Partial<OjtApi> | undefined): void {
  if (api === undefined) delete window.ojt;
  else window.ojt = api as OjtApi;
}

/** 図のある節（縮小版が入る）と、図がまだ無い節。 */
const SHOT_SECTION = 'screens/ホームの画面';
const UNSHOT_SECTION = 'screens/課題をえらぶ';

/** ホーム画面から開いたときに出る節（設計 §5.2 の表）。 */
const HOME_SECTION = defaultSectionId('home');

beforeEach(() => {
  act(() => {
    useHelpStore.getState().openHelp('home');
  });
});

afterEach(() => {
  cleanup();
  setApi(undefined);
  act(() => {
    useHelpStore.getState().closeHelp();
    useStore.setState({ toasts: [] });
    useStore.getState().setRoute('home');
  });
});

/** 本文の中の図のボタン（生成物の HTML の中にあるので DOM から引く）。 */
function figureButton(name: string): HTMLButtonElement | null {
  return screen
    .getByTestId('help-prose')
    .querySelector<HTMLButtonElement>(`button[data-manual-image="${name}"]`);
}

describe('中身（設計 §5.3）', () => {
  it('opens the section of the screen it was opened from', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    expect(screen.getByTestId('help-section-title')).toHaveTextContent('このアプリでできること');
  });

  it('lists every chapter in the table of contents', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const contents = screen.getByTestId('help-contents');
    const chapters = new Set(MANUAL_SECTIONS.map((section) => section.chapterTitle));
    expect(chapters.size).toBeGreaterThan(0);
    // 章の見出しは `summary`（節の見出しと同じ言葉の章があるので、節のボタンとは分けて見る）
    const summaries = [...contents.querySelectorAll('summary')].map((node) => node.textContent);
    for (const title of chapters) expect(summaries).toContain(title);
  });

  it('shows another section when its button in the table of contents is pressed', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId(`help-section-${SHOT_SECTION}`));
    expect(screen.getByTestId('help-section-title')).toHaveTextContent('ホームの画面');
  });

  it('marks the section that is open', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    expect(screen.getByTestId(`help-section-${HOME_SECTION}`)).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

describe('検索（設計 §5.3）', () => {
  it('lists the sections that contain the word', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: '自己保持' } });
    expect(screen.getAllByTestId('help-hit').length).toBeGreaterThan(0);
  });

  it('jumps to the section when a hit is pressed', () => {
    const expected = searchManual('自己保持')[0];
    expect(expected).toBeDefined();
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: '自己保持' } });
    fireEvent.click(screen.getAllByTestId('help-hit')[0] as HTMLElement);
    expect(screen.getByTestId('help-section-title')).toHaveTextContent(expected?.title ?? '');
    // 跳んだら一覧は消えて本文に戻る
    expect(screen.queryAllByTestId('help-hit')).toHaveLength(0);
  });

  it('says so when nothing matches', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('help-search'), {
      target: { value: 'そんな言葉はありません' },
    });
    expect(screen.getByText(JA.help.searchEmpty)).toBeInTheDocument();
  });
});

describe('閉じ方とキーボード（設計 §5.4）', () => {
  it('closes with the button, with Escape and with the backdrop', () => {
    const onClose = vi.fn();
    render(<HelpDrawer onClose={onClose} />);
    fireEvent.click(screen.getByTestId('help-close'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('help-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('counts as one modal layer while it is open', () => {
    const view = render(<HelpDrawer onClose={() => undefined} />);
    expect(isModalOpen()).toBe(true);
    view.unmount();
    expect(isModalOpen()).toBe(false);
  });

  it('puts the focus on the close button and gives it back afterwards', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const view = render(<HelpDrawer onClose={() => undefined} />);
    expect(document.activeElement).toBe(screen.getByTestId('help-close'));
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab inside the drawer', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const panel = screen.getByTestId('help-drawer');
    const focusable = [...panel.querySelectorAll<HTMLElement>('button, input')].filter(
      (element) => !element.hasAttribute('disabled'),
    );
    const last = focusable[focusable.length - 1];
    last?.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('gives every control a visible focus ring', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    // `:focus-visible` の輪郭は CSS モジュールが持つ。ここでは輪郭を書いた行が残っていることを見る
    expect(helpCss).toContain('.header button:focus-visible');
    expect(helpCss).toContain('.contents button:focus-visible');
    expect(helpCss).toContain('.hits button:focus-visible');
    expect(helpCss).toContain('.searchRow input:focus-visible');
    expect(helpCss).toContain('.manual-figure button:focus-visible');
    expect(helpCss).toContain('.figurePanel button:focus-visible');
  });
});

describe('説明書（PDF）を開く（設計 §9）', () => {
  it('asks the main process to open it', async () => {
    const openManual = vi.fn().mockResolvedValue({ ok: true, path: 'C:\\manual.pdf' });
    setApi({ openManual });
    render(<HelpDrawer onClose={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('help-open-pdf'));
      await Promise.resolve();
    });
    expect(openManual).toHaveBeenCalledTimes(1);
  });

  it('says so when the app cannot open it', async () => {
    setApi({ openManual: vi.fn().mockResolvedValue({ ok: false, message: 'だめでした' }) });
    render(<HelpDrawer onClose={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('help-open-pdf'));
      await Promise.resolve();
    });
    expect(useStore.getState().toasts.map((toast) => toast.text)).toContain('だめでした');
  });

  it('says so when the app has no way to open it at all', async () => {
    setApi(undefined);
    render(<HelpDrawer onClose={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('help-open-pdf'));
      await Promise.resolve();
    });
    expect(useStore.getState().toasts.map((toast) => toast.text)).toContain(JA.help.pdfMissing);
  });
});

describe('図（利用者の決定 2026-09-20）', () => {
  beforeEach(() => {
    act(() => {
      useHelpStore.getState().showSection(SHOT_SECTION);
    });
  });

  it('fills in the reduced copy of every figure in the section', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const image = screen.getByTestId('help-prose').querySelector('img[data-manual-image="home"]');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('width')).toBe('400');
    expect(image?.getAttribute('src')).toBe(SHOT.small);
  });

  it('opens the full size in an overlay when the figure is pressed', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const button = figureButton('home');
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    expect(screen.getByTestId('help-figure-modal')).toBeInTheDocument();
    expect(screen.getByTestId('help-figure-full')).toHaveAttribute('src', SHOT.full);
  });

  it('closes the overlay with Escape, leaves the drawer open and gives the focus back', () => {
    const onClose = vi.fn();
    render(<HelpDrawer onClose={onClose} />);
    const button = figureButton('home');
    button?.focus();
    fireEvent.click(button as HTMLButtonElement);
    expect(document.activeElement).toBe(screen.getByTestId('help-figure-close'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('help-figure-modal')).toBeNull();
    // 引き出しは開いたまま（`Esc` は覆いだけを閉じる）
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('help-drawer')).toBeInTheDocument();
    expect(document.activeElement).toBe(button);
  });

  it('draws nothing for a figure that has not been taken yet', () => {
    act(() => {
      useHelpStore.getState().showSection(UNSHOT_SECTION);
    });
    render(<HelpDrawer onClose={() => undefined} />);
    const image = screen.getByTestId('help-prose').querySelector('img[data-manual-image="list"]');
    expect(image?.hasAttribute('src')).toBe(false);
    const button = figureButton('list');
    expect(button?.disabled).toBe(true);
    expect(button?.closest('figure')?.hasAttribute('hidden')).toBe(true);
  });
});

describe('F1（決定表#16・#17）', () => {
  /** 窓口の hook だけを置く枠（画面ごとの差し込みは Plan 6 Task 9）。 */
  function Hotkey(): JSX.Element {
    useHelpHotkey();
    return <span data-testid="hotkey-harness" />;
  }

  /** ヘルプを閉じた状態から始める。 */
  function renderClosed(): void {
    act(() => {
      useHelpStore.getState().closeHelp();
    });
    render(<Hotkey />);
  }

  it('opens and closes the drawer from anywhere', () => {
    renderClosed();
    fireEvent.keyDown(window, { key: 'F1' });
    expect(useHelpStore.getState().open).toBe(true);
    fireEvent.keyDown(window, { key: 'F1' });
    expect(useHelpStore.getState().open).toBe(false);
  });

  it('opens the section of the screen it was pressed on', () => {
    renderClosed();
    act(() => {
      useStore.getState().setRoute('settings');
    });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(useHelpStore.getState().sectionId).toBe(defaultSectionId('settings'));
  });

  it('leaves F1 alone when something else already handled it', () => {
    renderClosed();
    const event = new KeyboardEvent('keydown', { key: 'F1', cancelable: true, bubbles: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(useHelpStore.getState().open).toBe(false);
  });
});

describe('文言（決定表#28）', () => {
  it('keeps every help string short enough to be chrome, never prose', () => {
    const keys = Object.keys(JA.help);
    expect(keys).toHaveLength(12);
    for (const [key, value] of Object.entries(JA.help)) {
      expect(typeof value, `${key} は文字列であること`).toBe('string');
      expect((value as string).length, `JA.help.${key} が長すぎます`).toBeLessThanOrEqual(40);
    }
  });
});
