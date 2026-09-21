import type { SchematicDocument } from '@ojt/schematic-core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { trapFocus } from '../app/focus-trap.js';
import { chartEnlargeLabel, chartOpenerLabel, JA, schematicZoomText } from '../i18n/ja.js';
import { pushModalLayer, topModalLayer } from '../session/interaction.js';
import { SchematicSvg } from './SchematicSvg.js';
import styles from './schematic-view.module.css';

/**
 * 回路図ヒントの見せ方（利用者要求 2026-09-19「回路図のクオリティ」）。§8.1 / §11.2
 *
 * 描くのは `SchematicSvg`。ここが足すのは**紙としての体裁**だけ:
 * - 幅いっぱいに収め、縦横比は保つ。段が潰れないよう最低の高さを取る
 * - アプリが暗色テーマでも図の枠は白い紙に見える（`schematic-view.module.css`）
 * - タイムチャート（`EnlargeableChart`）と同じ「クリックで拡大」。拡大表示は倍率を変えられ、
 *   Esc で閉じる
 *
 * モードB・C2・結果画面・エディタの模範欄は**すべてこの部品**を通すので、
 * どの画面でも同じ図が出る（片方だけ直して食い違うことがない）。
 */

/** 拡大表示の倍率の段階（等倍＝紙の幅いっぱい）。 */
const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

/** 拡大表示の枠（`TimeChartView` の `ChartModal` と同じ作法）。§8.1 */
function SchematicModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: JSX.Element;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const { depth, release } = pushModalLayer();
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (depth !== topModalLayer()) return;
      if (event.key === 'Escape') {
        // 上に別のモーダルが乗っているときは、そちらに任せる
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') trapFocus(panelRef.current, event);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      release();
    };
  }, [onClose]);

  return createPortal(
    <div
      className={styles.backdrop}
      data-testid="schematic-backdrop"
      role="presentation"
      onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.modal}
        data-testid="schematic-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeButton}
            aria-label={JA.timeChart.close}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 回路図ヒント1枚。§11.2
 * `highlightCellIds` / `onPickCell` はモードC2の連動ハイライト（§9.2）に素通しする。
 */
export function SchematicView({
  document: doc,
  title,
  highlightCellIds,
  onPickCell,
  testId = 'schematic-svg',
}: {
  document: SchematicDocument;
  /** 見出し（拡大表示の題と読み上げ名に使う）。省略すると文書の題。 */
  title?: string;
  highlightCellIds?: readonly string[];
  onPickCell?: (cellId: string | undefined) => void;
  testId?: string;
}): JSX.Element {
  const label = title ?? doc.title;
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const openerRef = useRef<HTMLDivElement | null>(null);

  const show = useCallback(() => {
    setZoom(1);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus();
  }, []);
  const step = useCallback((direction: 1 | -1) => {
    setZoom((current) => {
      const index = ZOOM_STEPS.indexOf(current as (typeof ZOOM_STEPS)[number]);
      const next = Math.min(Math.max(index + direction, 0), ZOOM_STEPS.length - 1);
      return ZOOM_STEPS[next] ?? current;
    });
  }, []);

  const pass = {
    ...(highlightCellIds === undefined ? {} : { highlightCellIds }),
    ...(onPickCell === undefined ? {} : { onPickCell }),
  };

  return (
    <div className={styles.frame} data-testid="schematic-frame">
      <button
        type="button"
        className={styles.enlargeButton}
        data-testid="schematic-enlarge-button"
        aria-label={chartEnlargeLabel(label)}
        onClick={show}
      >
        <span aria-hidden="true">⤢ </span>
        {JA.timeChart.enlarge}
      </button>
      {/*
        図そのものがボタンでもある（タイムチャートと同じ）。中の記号のクリックは
        `onPickCell` が先に受けるので、拡大は**図の余白**を押したときに起きる。
      */}
      <div
        ref={openerRef}
        className={styles.paper}
        role="button"
        tabIndex={0}
        aria-label={chartOpenerLabel(label, onPickCell !== undefined)}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          show();
        }}
        onClick={() => {
          // C2の連動ハイライト中は、単クリックは「要素を選ぶ」ほうに譲る（拡大は⤢ボタンか2度押し）
          if (onPickCell === undefined) show();
        }}
        onDoubleClick={show}
      >
        <SchematicSvg document={doc} testId={testId} {...pass} />
      </div>
      {open ? (
        <SchematicModal title={label} onClose={close}>
          <div className={styles.modalBody}>
            <div className={styles.zoomBar}>
              <button
                type="button"
                className={styles.zoomButton}
                data-testid="schematic-zoom-out"
                aria-label={JA.schematicView.zoomOut}
                disabled={zoom === ZOOM_STEPS[0]}
                onClick={() => {
                  step(-1);
                }}
              >
                −
              </button>
              <span className={styles.zoomText} data-testid="schematic-zoom-text">
                {schematicZoomText(zoom)}
              </span>
              <button
                type="button"
                className={styles.zoomButton}
                data-testid="schematic-zoom-in"
                aria-label={JA.schematicView.zoomIn}
                disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                onClick={() => {
                  step(1);
                }}
              >
                ＋
              </button>
              <button
                type="button"
                className={styles.zoomButton}
                data-testid="schematic-zoom-reset"
                onClick={() => {
                  setZoom(1);
                }}
              >
                {JA.schematicView.zoomReset}
              </button>
            </div>
            <div className={styles.modalScroll}>
              <div className={styles.modalPaper} style={{ width: `${String(zoom * 100)}%` }}>
                <SchematicSvg document={doc} testId={`${testId}-large`} {...pass} />
              </div>
            </div>
          </div>
        </SchematicModal>
      ) : null}
    </div>
  );
}
