import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { HelpDrawer } from '../src/renderer/help/HelpDrawer.js';
import {
  anchorIdOf,
  defaultSectionId,
  MAX_HELP_HITS,
  searchManual,
} from '../src/renderer/help/help-model.js';
import { useHelpStore } from '../src/renderer/help/help-store.js';
import { MANUAL_CHAPTERS, MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';
import { useHelpHotkey } from '../src/renderer/help/use-help-hotkey.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { isModalOpen } from '../src/renderer/session/interaction.js';
import type { OjtApi } from '../src/shared/ipc.js';
import { MSG } from '../src/shared/messages.js';
import type * as ManualContent from '../src/renderer/help/manual-content.js';

/** 引き出しの CSS（`:focus-visible` の輪郭が残っていることを見るために本文を読む）。 */
const helpCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/renderer/help/help.module.css'),
  'utf8',
);

/** ヘルプの引き出し。取扱説明書 設計 §5.3 / §5.4。 */

/*
 * 図の置き場所（`MANUAL_IMAGES`）は**生成物のまま**を使う。17枚は撮り終えていて
 * （`docs/manual/images/`）、束ねた URL は Vite が決めるので、ここで本物を見ておかないと
 * この単体試験は figure を1つも本物で見ないまま緑になる（2026-09-20 最終レビュー IM-C）。
 * 「まだ撮っていない図」の見え方（枠ごと畳む・ボタンを押させない）を見る試験のあいだだけ、
 * `IMAGES.instead` で差し替える（本プラン 決定表 P16・P17）。
 */
// `vi.mock` の工場は先頭へ巻き上げられるので、差し込む値も `vi.hoisted` で先に作る
const SHOT = vi.hoisted(() => ({ small: 'small-home.png', full: 'full-home.png' }));
type ManualImages = Readonly<Record<string, { small: string; full: string }>>;
const IMAGES = vi.hoisted(
  (): {
    /** 生成物（`manual-content.ts`）が持っている本物の17件。 */
    real: ManualImages;
    /** 差し替え（入れなければ本物を使う）。 */
    instead?: ManualImages;
  } => ({ real: {} }),
);

vi.mock('../src/renderer/help/manual-content.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ManualContent>();
  IMAGES.real = actual.MANUAL_IMAGES;
  return {
    ...actual,
    get MANUAL_IMAGES(): ManualImages {
      return IMAGES.instead ?? IMAGES.real;
    },
  };
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
const UNSHOT_SECTION = 'screens/課題を選ぶ';

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
  delete IMAGES.instead;
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

  it('re-opens a chapter the reader folded by hand when a new section in it becomes current (Minor#6)', () => {
    // SHOT_SECTION と UNSHOT_SECTION はどちらも「screens」章の節
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId(`help-section-${SHOT_SECTION}`));
    const details = screen.getByTestId(`help-section-${SHOT_SECTION}`).closest('details');
    expect(details).not.toBeNull();
    // 読者が手で畳む（ブラウザのネイティブ開閉と同じ、React を経ない DOM の直接変化）
    if (details !== null) details.open = false;
    expect(details?.open).toBe(false);
    // 同じ章の別の節へ跳ぶ
    fireEvent.click(screen.getByTestId(`help-section-${UNSHOT_SECTION}`));
    const reopened = screen.getByTestId(`help-section-${UNSHOT_SECTION}`).closest('details');
    expect(reopened?.open).toBe(true);
    expect(screen.getByTestId(`help-section-${UNSHOT_SECTION}`)).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('falls back to the first section of the manual when the id does not resolve (Minor#7)', () => {
    act(() => {
      useHelpStore.setState({ sectionId: 'ありません/ありません' });
    });
    render(<HelpDrawer onClose={() => undefined} />);
    const first = MANUAL_SECTIONS[0];
    expect(first).toBeDefined();
    expect(screen.getByTestId('help-section-title')).toHaveTextContent(first?.title ?? '');
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

  it('says "20件以上" instead of pretending the cap is the real count (IM-12)', () => {
    // 「の」はほとんどの節に出る。93節ある本文では上限（20件）より先にも当たりがある
    expect(MANUAL_SECTIONS.length).toBeGreaterThan(MAX_HELP_HITS);
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: 'の' } });
    expect(screen.getAllByTestId('help-hit')).toHaveLength(MAX_HELP_HITS);
    expect(screen.getByText(`${String(MAX_HELP_HITS)} 件以上見つかりました`)).toBeInTheDocument();
  });

  it('shows the exact count when the hits do not reach the cap', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: '自己保持' } });
    const count = searchManual('自己保持').length;
    expect(count).toBeLessThan(MAX_HELP_HITS);
    expect(screen.getByText(`${String(count)} 件見つかりました`)).toBeInTheDocument();
  });

  it("resets the article's scroll position when the section or the search word changes (IM-12)", () => {
    render(<HelpDrawer onClose={() => undefined} />);
    // `.article`（スクロールする囲み）は `help-section-title` の親。React はこの枠を
    // 作り直さないので、テストは既存の testid から辿るだけで済み、新しい testid を
    // 機能一覧表（`docs/manual/coverage.json`）に足す必要が無い。
    const article = screen.getByTestId('help-section-title').parentElement;
    expect(article).not.toBeNull();
    if (article === null) return;
    article.scrollTop = 120;
    fireEvent.click(screen.getByTestId(`help-section-${SHOT_SECTION}`));
    expect(article.scrollTop).toBe(0);
    article.scrollTop = 80;
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: '自己保持' } });
    expect(article.scrollTop).toBe(0);
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

  it('leaves the drawer open when Escape is pressed while composing (IM-11)', () => {
    const onClose = vi.fn();
    render(<HelpDrawer onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    // 通常の `Esc` はいつもどおり効く（番人載せいで壊れていないこと）
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not steal focus back to the close button when the caller hands in a fresh onClose every render (Minor#13)', () => {
    const { rerender } = render(<HelpDrawer onClose={() => undefined} />);
    const search = screen.getByTestId('help-search');
    search.focus();
    expect(document.activeElement).toBe(search);
    // 呼び出し側が毎回新しい関数を渡してくる状況を再現する（`onClose` の参照が変わる）
    rerender(<HelpDrawer onClose={() => undefined} />);
    expect(document.activeElement).toBe(search);
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

  it('gives every control a visible focus ring (Minor#9: the rule must actually draw one)', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    /*
     * 輪郭を書いた行が残っているだけでは、その中身を `outline: none` に変えても緑のままになる。
     * セレクタから次の `}` までの本体を切り出して、`none` ではない `outline` があることを見る。
     */
    const selectors = [
      '.header button:focus-visible',
      '.contents button:focus-visible',
      '.hits button:focus-visible',
      '.searchRow input:focus-visible',
      '.manual-figure button:focus-visible',
      '.figurePanel button:focus-visible',
    ];
    for (const selector of selectors) {
      const at = helpCss.indexOf(selector);
      expect(at, `${selector} が help.module.css に無い`).toBeGreaterThanOrEqual(0);
      const body = helpCss.slice(at, helpCss.indexOf('}', at));
      expect(body, `${selector} に目に見える outline が無い`).toMatch(/outline:\s*(?!none\b)\S/u);
    }
  });

  it('treats only narrower than 1100px as the small-screen layout (Minor#8)', () => {
    expect(helpCss).toContain('@media (max-width: 1099px)');
    expect(helpCss).not.toContain('@media (max-width: 1100px)');
  });
});

describe('幅と本文の読みやすさ（UX-21: 設計 §6.4）', () => {
  it('reserves a readable paper width while keeping the workspace visible', () => {
    expect(helpCss).toContain('width: min(880px, 72vw)');
  });

  it('folds the contents when the guide uses the full narrow viewport', () => {
    expect(helpCss).toContain('@media (max-width: 1099px)');
    expect(helpCss).not.toContain('@media (max-width: 1280px)');
  });

  it('reads the body text at 15px / 1.95 line height, capped to a readable 40em width', () => {
    const at = helpCss.lastIndexOf('.prose {');
    expect(at).toBeGreaterThanOrEqual(0);
    const body = helpCss.slice(at, helpCss.indexOf('}', at));
    expect(body).toMatch(/font-size:\s*0\.9375rem/u);
    expect(body).toMatch(/line-height:\s*1\.95/u);
    expect(body).toMatch(/max-width:\s*40em/u);
  });

  it('sizes the section heading at 24px, in rem so it follows --ui-scale (Task 26)', () => {
    const at = helpCss.lastIndexOf('.sectionTitle {');
    expect(at).toBeGreaterThanOrEqual(0);
    const body = helpCss.slice(at, helpCss.indexOf('}', at));
    expect(body).toMatch(/font-size:\s*1\.5rem/u);
  });
});

describe('前後の節への導線（UX-21: 設計 §6.4）', () => {
  const flatOrder = MANUAL_CHAPTERS.flatMap((chapter) => chapter.sectionIds);
  const first = flatOrder[0];
  const second = flatOrder[1];
  const last = flatOrder[flatOrder.length - 1];

  it('moves to the next section in the table-of-contents order', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const at = flatOrder.indexOf(HOME_SECTION);
    const nextId = flatOrder[at + 1];
    expect(nextId).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: JA.help.nextSection }));
    expect(screen.getByTestId('help-section-title')).toHaveTextContent(
      MANUAL_SECTIONS.find((section) => section.id === nextId)?.title ?? '(見つからず)',
    );
  });

  it('moves to the previous section in the table-of-contents order', () => {
    expect(second).toBeDefined();
    expect(first).toBeDefined();
    if (second === undefined || first === undefined) return;
    act(() => {
      useHelpStore.getState().showSection(second);
    });
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: JA.help.prevSection }));
    expect(screen.getByTestId('help-section-title')).toHaveTextContent(
      MANUAL_SECTIONS.find((section) => section.id === first)?.title ?? '(見つからず)',
    );
  });

  it('disables the previous button on the very first section and the next button on the very last', () => {
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;
    act(() => {
      useHelpStore.getState().showSection(first);
    });
    const view = render(<HelpDrawer onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: JA.help.prevSection })).toBeDisabled();
    expect(screen.getByRole('button', { name: JA.help.nextSection })).not.toBeDisabled();
    view.unmount();
    act(() => {
      useHelpStore.getState().showSection(last);
    });
    render(<HelpDrawer onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: JA.help.nextSection })).toBeDisabled();
  });
});

describe('本文中のリンク（Task 34 で入る想定。設計 §6.3 の表・§6.4）', () => {
  it('jumps to the target section when an internal #sec- link inside the prose is pressed', () => {
    const target = MANUAL_SECTIONS[2];
    expect(target).toBeDefined();
    if (target === undefined) return;
    render(<HelpDrawer onClose={() => undefined} />);
    const anchor = document.createElement('a');
    anchor.setAttribute('href', `#${anchorIdOf(target.id)}`);
    anchor.textContent = 'リンク';
    screen.getByTestId('help-prose').append(anchor);
    fireEvent.click(anchor);
    expect(screen.getByTestId('help-section-title')).toHaveTextContent(target.title);
  });

  it('does nothing (and never navigates) when an outside URL inside the prose is pressed (§15: no outside communication)', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const before = screen.getByTestId('help-section-title').textContent;
    const anchor = document.createElement('a');
    anchor.setAttribute('href', 'https://example.com/');
    anchor.textContent = 'そと';
    screen.getByTestId('help-prose').append(anchor);
    const notCancelled = fireEvent.click(anchor);
    expect(notCancelled).toBe(false);
    expect(screen.getByTestId('help-section-title')).toHaveTextContent(before ?? '');
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

  it('has a real picture, in both sizes, for every figure the manual defines (IM-C)', () => {
    const shots = JSON.parse(
      readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/manual/shots.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(Object.keys(IMAGES.real).sort()).toEqual(Object.keys(shots).sort());
    for (const [name, image] of Object.entries(IMAGES.real)) {
      expect(image.small, `${name} の縮小版がありません`).not.toBe('');
      expect(image.full, `${name} の原寸がありません`).not.toBe('');
    }
  });

  it('fills in the reduced copy of every figure in the section', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const image = screen.getByTestId('help-prose').querySelector('img[data-manual-image="home"]');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('width')).toBe('400');
    // 本物の図（`docs/manual/images/small/home.png` を束ねた URL）が入る
    expect(image?.getAttribute('src')).toBe(IMAGES.real['home']?.small);
    expect(image?.getAttribute('src')).not.toBe('');
  });

  it('opens the full size in an overlay when the figure is pressed', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const button = figureButton('home');
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    expect(screen.getByTestId('help-figure-modal')).toBeInTheDocument();
    // 原寸も本物（縮小版とは別の URL）
    expect(screen.getByTestId('help-figure-full')).toHaveAttribute(
      'src',
      IMAGES.real['home']?.full ?? '',
    );
    expect(IMAGES.real['home']?.full).not.toBe(IMAGES.real['home']?.small);
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

  it('leaves the figure overlay open when Escape is pressed while composing (IM-11)', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const button = figureButton('home');
    fireEvent.click(button as HTMLButtonElement);
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(screen.getByTestId('help-figure-modal')).toBeInTheDocument();
  });

  it('draws nothing for a figure that has not been taken yet', () => {
    // まだ撮っていない図は無いので、`home` だけ撮れている状態を作って見る
    IMAGES.instead = { home: SHOT };
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
    expect(keys).toHaveLength(15);
    for (const [key, value] of Object.entries(JA.help)) {
      expect(typeof value, `${key} は文字列であること`).toBe('string');
      expect((value as string).length, `JA.help.${key} が長すぎます`).toBeLessThanOrEqual(40);
    }
  });

  it('says the same thing as main when the PDF is missing (IM-8: one source of truth)', () => {
    // main（`src/main/manual.ts`）が返す文言と、preload の無い環境で出す文言を1つにそろえる
    expect(JA.help.pdfMissing).toBe(MSG.manual.missing);
  });
});
