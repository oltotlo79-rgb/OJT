import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { tryOjtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { helpHitCountText, JA } from '../i18n/ja.js';
import { pushModalLayer, topModalLayer } from '../session/interaction.js';
import { MAX_HELP_HITS, searchManual, sectionById } from './help-model.js';
import { useHelpStore } from './help-store.js';
import { MANUAL_CHAPTERS, MANUAL_IMAGES, MANUAL_SECTIONS } from './manual-content.js';
import styles from './help.module.css';

/**
 * 取扱説明書の引き出し。取扱説明書 設計 §5.3 / §5.4。
 *
 * 本文は `manual-content.ts`（生成物）から来る。差し込む文字列は**ビルド時に
 * このリポジトリの Markdown から作ったもの**だけで、課題JSONも利用者の入力も混ざらない。
 * 変換は `html: false` で走らせているので、原稿に生の HTML を書いても escape されている
 * （本プラン 決定表 P8）。正本と生成物の一致は `manual-sync.test.ts` が毎回証明する。
 */

/** 大きくして見ている図（名前と、読み上げにも使う説明文）。 */
interface EnlargedFigure {
  name: string;
  alt: string;
}

/** 引き出しの中だけで `Tab` を回す（`SchematicModal` と同じ作法）。 */
function trapFocus(panel: HTMLElement | null, event: KeyboardEvent): void {
  if (panel === null) return;
  const focusable = [
    ...panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hasAttribute('disabled'));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** ヘルプの引き出し。 */
export function HelpDrawer({ onClose }: { onClose: () => void }): JSX.Element {
  const sectionId = useHelpStore((s) => s.sectionId);
  const query = useHelpStore((s) => s.query);
  const showSection = useHelpStore((s) => s.showSection);
  const setQuery = useHelpStore((s) => s.setQuery);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  // Minor#7: 節IDが目次と噛み合わないとき（§9 のフォールバック）は目次の最初の節を出す
  const section = sectionById(sectionId) ?? MANUAL_SECTIONS[0];
  /*
   * IM-12: 上限（`MAX_HELP_HITS`）ちょうどで打ち切られたのか、まだ先に当たりが
   * あったのに丸められたのかを見分けるため、上限より1件多く取ってから切り詰める。
   */
  const searchResult = useMemo(() => searchManual(query, MAX_HELP_HITS + 1), [query]);
  const hitsCapped = searchResult.length > MAX_HELP_HITS;
  const hits = hitsCapped ? searchResult.slice(0, MAX_HELP_HITS) : searchResult;
  /** 覆いで開いている図（利用者の決定 2026-09-20）。 */
  const [enlarged, setEnlarged] = useState<EnlargedFigure | undefined>(undefined);

  // IM-12: 節や検索語を切り替えたら、前の節でどこまで読んでいたかに関係なく本文の先頭を見せる
  useEffect(() => {
    const article = articleRef.current;
    if (article === null) return;
    article.scrollTop = 0;
  }, [sectionId, query]);

  /*
   * 本文を差し込んだあとに図の `src` を入れる（決定表 P16）。
   * 束ねた図の URL（内容ハッシュ付き）は Vite が決めるので、生成物には書けない。
   * まだ撮っていない図は `MANUAL_IMAGES` の項目が空文字なので、`src` を入れず枠ごと畳む。
   *
   * 依存を書かず**毎回**走らせる。やることは節の中の図（多くて数枚）に属性を入れ直すだけで、
   * 何度やっても同じ結果になる。節と検索語だけに絞ると、本文の DOM が作り直されたときに
   * 図が白いままになる。
   */
  useEffect(() => {
    const root = proseRef.current;
    if (root === null) return;
    for (const image of root.querySelectorAll<HTMLImageElement>('img[data-manual-image]')) {
      const name = image.dataset['manualImage'] ?? '';
      const small = MANUAL_IMAGES[name]?.small ?? '';
      if (small === '') image.removeAttribute('src');
      else image.src = small;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-manual-image]')) {
      const name = button.dataset['manualImage'] ?? '';
      const full = MANUAL_IMAGES[name]?.full ?? '';
      // 撮っていない図のボタンは押させない（押しても何も出ないボタンを残さない）
      button.disabled = full === '';
      button.title = full === '' ? '' : JA.help.enlarge;
      /*
       * 撮っていない図は説明文（`figcaption`）ごと出さない。
       * 絵の無い枠と「〜の画面です」という説明文だけが残ると、読み手は
       * 「図が読み込めていない」のか「もともと無い」のか分からない。
       */
      const figure = button.closest('figure');
      if (figure instanceof HTMLElement) figure.hidden = full === '';
    }
  });

  /*
   * 図のボタンは生成物の HTML の中にあるので React の `onClick` を付けられない。
   * 本文の囲みで1回だけ受けて、押された図の名前を拾う（`Enter` / `Space` も
   * `<button>` なのでブラウザが `click` に直してくれる）。
   */
  const onProseClick = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button[data-manual-image]');
    if (button === null) return;
    const name = button.dataset['manualImage'];
    if (name === undefined) return;
    if ((MANUAL_IMAGES[name]?.full ?? '') === '') return;
    setEnlarged({ name, alt: button.querySelector('img')?.alt ?? name });
  }, []);

  /*
   * 本文の囲みは**同じ要素を使い回す**（`useMemo`）。作り直すと React が `innerHTML` を
   * 入れ直すので、図を大きくしたときに中のボタンが別物になり、覆いを閉じても焦点が
   * 戻らなくなる（長い節では本文の組み直しも毎回走る）。
   */
  const prose = useMemo(
    () => (
      <div
        ref={proseRef}
        className={styles.prose}
        data-testid="help-prose"
        onClick={onProseClick}
        dangerouslySetInnerHTML={{ __html: section?.html ?? '' }}
      />
    ),
    [section?.html, onProseClick],
  );

  /*
   * Minor#13: 呼び出し側が毎回新しい関数を渡してくると（不安定な `onClose`）、依存に
   * 書いたままでは打鍵のたびに effect が張り直され、そのたびに閉じるボタンへ焦点が
   * 奪われる。最新の関数は ref に控えておき、effect 自体はマウント時に1回だけ張る。
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /*
   * モーダル1枚として積む。積んでおかないと、盤やラダーのショートカット
   * （`Delete` で電線が消える、`3` で視点が飛ぶ）が引き出しの上から効いてしまう。
   */
  useEffect(() => {
    const layer = pushModalLayer();
    const openedFrom =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (layer.depth !== topModalLayer()) return;
      // IM-11: IME 変換の取り消しの `Esc` は検索欄の中だけで効かせ、引き出しを閉じない
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === 'Tab') trapFocus(panelRef.current, event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      layer.release();
      openedFrom?.focus();
    };
    // `onCloseRef` で最新値を読むので、マウント時に1回だけ張ればよい（Minor#13）
  }, []);

  /**
   * 同梱の PDF を OS の既定ビューアで開く（§9）。
   * 開けない理由は main が日本語で返す（`MSG.manual.*`）ので、そのままトーストに出す。
   * preload が無い環境（素のブラウザ・設定の誤り）では PDF そのものが無いので、
   * 「もくじから同じ内容を読める」ことを添えて知らせる。
   */
  const openPdf = (): void => {
    const toast = useStore.getState().toast;
    const api = tryOjtApi();
    if (api === undefined || typeof api.openManual !== 'function') {
      toast(JA.help.pdfMissing, 'warn');
      return;
    }
    void api.openManual().then(
      (result) => {
        if (!result.ok) toast(result.message, 'warn');
      },
      () => {
        toast(JA.help.pdfMissing, 'warn');
      },
    );
  };

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      data-testid="help-backdrop"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={JA.help.title}
        data-testid="help-drawer"
        onClick={(event) => {
          // 背面を押したときだけ閉じる
          event.stopPropagation();
        }}
      >
        <div className={styles.header}>
          <span className={styles.title}>{JA.help.title}</span>
          <button type="button" data-testid="help-open-pdf" onClick={openPdf}>
            {JA.help.openPdf}
          </button>
          <button type="button" ref={closeRef} data-testid="help-close" onClick={onClose}>
            {JA.help.close}
          </button>
        </div>
        <div className={styles.searchRow}>
          <label className={styles.searchLabel} htmlFor="help-search">
            {JA.help.searchLabel}
          </label>
          <input
            id="help-search"
            type="search"
            data-testid="help-search"
            placeholder={JA.help.searchPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <div className={styles.body}>
          <nav
            className={styles.contents}
            data-testid="help-contents"
            aria-label={JA.help.contents}
          >
            {MANUAL_CHAPTERS.map((chapter) => (
              // Minor#6: 章を手で畳んだあと、同じ章の別の節へ跳んでも `open` の計算結果が
              // 変わらないと React は DOM をそのままにする（畳んだままで aria-current が隠れる）。
              // 節が変わるたびに key を変えて作り直し、毎回いまの節に合わせて開閉し直す。
              <details
                key={`${chapter.id}::${sectionId}`}
                open={chapter.sectionIds.includes(sectionId)}
              >
                <summary>{chapter.title}</summary>
                <ul>
                  {chapter.sectionIds.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        data-testid={`help-section-${id}`}
                        aria-current={id === sectionId ? 'true' : undefined}
                        onClick={() => {
                          showSection(id);
                        }}
                      >
                        {sectionById(id)?.title ?? id}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </nav>
          <div className={styles.article} ref={articleRef}>
            {query.trim() === '' ? (
              <>
                <h2 className={styles.sectionTitle} data-testid="help-section-title">
                  {section?.title ?? ''}
                </h2>
                {prose}
              </>
            ) : hits.length === 0 ? (
              <p className={styles.empty}>{JA.help.searchEmpty}</p>
            ) : (
              <>
                <p className={styles.hitCount}>{helpHitCountText(hits.length, hitsCapped)}</p>
                <ul className={styles.hits}>
                  {hits.map((hit) => (
                    <li key={hit.sectionId}>
                      <button
                        type="button"
                        data-testid="help-hit"
                        onClick={() => {
                          showSection(hit.sectionId);
                        }}
                      >
                        <span className={styles.hitChapter}>{hit.chapterTitle}</span>
                        <span className={styles.hitTitle}>{hit.title}</span>
                        <span className={styles.hitExcerpt}>{hit.excerpt}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
        <p className={styles.footer}>{JA.help.shortcutHint}</p>
        {enlarged === undefined ? null : (
          <FigureOverlay
            figure={enlarged}
            onClose={() => {
              setEnlarged(undefined);
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 図の原寸を覆いで出す（利用者の決定 2026-09-20）。
 * 引き出しの上にもう1枚積むので、`Esc` は**この覆いだけ**を閉じる（`topModalLayer()` で見分ける）。
 * 閉じると、開くのに押した図のボタンへ焦点が戻る。
 */
function FigureOverlay({
  figure,
  onClose,
}: {
  figure: EnlargedFigure;
  onClose: () => void;
}): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const full = MANUAL_IMAGES[figure.name]?.full ?? '';
  // Minor#13: 呼び出し元（`HelpDrawer`）は毎回新しい関数を渡してくる。ref で最新値を読む。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const layer = pushModalLayer();
    const openedFrom =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (layer.depth !== topModalLayer()) return;
      // IM-11: 同上（この覆いには入力欄は無いが、引き出しの検索欄と同じ番人をそろえる）
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === 'Tab') trapFocus(panelRef.current, event);
    };
    // 引き出し側の listener より先に受けるため、捕まえ段階で登録する
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      layer.release();
      openedFrom?.focus();
    };
    // `onCloseRef` で最新値を読むので、マウント時に1回だけ張ればよい（Minor#13）
  }, []);

  return (
    <div
      className={styles.figureBackdrop}
      role="presentation"
      data-testid="help-figure-backdrop"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={styles.figurePanel}
        role="dialog"
        aria-modal="true"
        aria-label={JA.help.enlarge}
        data-testid="help-figure-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <img src={full} alt={figure.alt} data-testid="help-figure-full" />
        <button type="button" ref={closeRef} data-testid="help-figure-close" onClick={onClose}>
          {JA.help.figureClose}
        </button>
      </div>
    </div>
  );
}
