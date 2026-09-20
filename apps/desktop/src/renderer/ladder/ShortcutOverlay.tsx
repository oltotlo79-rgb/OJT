import type { DialectProfile, ShortcutEntry } from '@ojt/plc-dialects';
import { useEffect, useRef, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { pushModalLayer, topModalLayer } from '../session/interaction.js';
import { monitorStartLabel } from '../session/plc-skin.js';
import { skinThemeOf } from './skins/index.js';
import styles from './ladder.module.css';

/**
 * キーの早見表の覆い。指摘 PR-05 ／ Phase 7 設計 §5.5。
 *
 * 右の欄の「キー割当」（`ShortcutHelp`）は畳まれていることが多く、格子を見ながら引けない。
 * `Shift + ?` を押すと画面の上に全キーを覆いで出し、`Esc` で閉じる。**データ源は
 * `DialectProfile.shortcuts` で `ShortcutHelp` と同じ**なので、メーカーを切り替えれば
 * 中身もそのまま変わる（キー文字列は1つも直書きしない。決定表#12）。
 *
 * 行の断りの出し方は `ShortcutHelp` に揃える（Task 20 の申し送り）。ただし表そのものを
 * 借りているスキン（PCwin風・JW-300SP風）は**全行が △** なので、行ごとに同じ断りを
 * 22回並べず、表の上に1回だけ出す。
 */

/** 押す場所で覚える操作（キーの無い行）。モニタ開始はどの方言にもキーが無い（指摘 LE-7）。 */
interface ByButtonRow {
  label: string;
  how: string;
}

/** 行に添える断り。`keyMapAssumed` のスキンは表の上に1回出すので行では省く。 */
export function overlayNotesOf(entry: ShortcutEntry, keyMapAssumed: boolean): string[] {
  return [
    entry.confirmed || keyMapAssumed ? undefined : JA.settings.assumptionNotice,
    // 表を丸ごと借りているスキンでは、行の `note` も同じ断りの繰り返しなので出さない
    keyMapAssumed ? undefined : entry.note,
    entry.source === undefined ? undefined : JA.ladder.shortcutSource(entry.source),
  ].filter((note): note is string => note !== undefined);
}

export function ShortcutOverlay({
  profile,
  onClose,
}: {
  profile: DialectProfile;
  onClose: () => void;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const theme = skinThemeOf(profile);
  const keyMapAssumed = theme.keyMapAssumed === true;

  /*
   * 開いているあいだはモーダルを1枚積む（背後の格子へ Esc・矢印キーを通さない。§8.2）。
   * 閉じたら開く前に押していた場所へフォーカスを戻す（`NotationDialog` と同じ作法）。
   */
  useEffect(() => {
    const { depth, release } = pushModalLayer();
    const openedFrom =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (depth !== topModalLayer()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      release();
      openedFrom?.focus();
    };
  }, [onClose]);

  /*
   * どの方言も `shortcuts` に「モニタ開始」の行を持たない（モニタはキーではなくツールバーで
   * 始める設計）。早見表から抜け落ちると「モニタの始め方が画面のどこにも無い」ことになるので、
   * ツールバーの項目名（`monitorStartLabel()`）で1行足す（指摘 LE-7 と同じ倒し方）。
   */
  const byButton: ByButtonRow[] = profile.shortcuts.some((entry) => entry.action === 'monitor')
    ? []
    : [
        {
          label: JA.ladder.monitor,
          how: JA.ladder.overlay.byButton(monitorStartLabel(profile)),
        },
      ];

  return (
    <div className={styles.overlayBackdrop} role="presentation">
      <div
        ref={panelRef}
        className={styles.overlayPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`${JA.ladder.overlay.title}（${profile.displayName}）`}
        data-testid="shortcut-overlay"
        tabIndex={-1}
      >
        <div className={styles.overlayHead}>
          <h2 className={styles.overlayTitle}>
            {JA.ladder.overlay.title}（{profile.displayName}）
          </h2>
          <button type="button" data-testid="shortcut-overlay-close" onClick={onClose}>
            {JA.ladder.overlay.close}
          </button>
        </div>
        {/* メーカー名を出す以上、商標の帰属も同じ場所に出す（§17.1） */}
        <p className={styles.sideNote}>{JA.settings.trademarkNotice}</p>
        {keyMapAssumed ? (
          <p className={styles.sideNote} data-testid="shortcut-overlay-note">
            {JA.ladder.overlay.assumedTable}
          </p>
        ) : null}
        <table className={`${styles.ioTable} ${styles.shortcutTable}`}>
          <thead>
            <tr>
              <th scope="col">{JA.ladder.shortcutKeyHeader}</th>
              <th scope="col">{JA.ladder.shortcutLabelHeader}</th>
              <th scope="col">{JA.ladder.shortcutNoteHeader}</th>
            </tr>
          </thead>
          <tbody>
            {profile.shortcuts.map((entry) => (
              <tr
                key={entry.action}
                data-testid={`overlay-shortcut-${entry.action}`}
                data-enabled={entry.enabled !== false}
                className={entry.enabled === false ? styles.shortcutOff : undefined}
              >
                <td>{entry.keys}</td>
                <td>{entry.label}</td>
                <td className={styles.sideNote}>
                  {overlayNotesOf(entry, keyMapAssumed).join(' ')}
                </td>
              </tr>
            ))}
            {byButton.map((row) => (
              <tr key={row.label} data-testid="overlay-shortcut-monitor">
                <td>—</td>
                <td>{row.label}</td>
                <td className={styles.sideNote}>{row.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
