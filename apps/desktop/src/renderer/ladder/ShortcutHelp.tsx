import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { SidePanel } from './SidePanel.js';
import styles from './ladder.module.css';

/**
 * キー割当表。設計仕様 §10.6 / §12.1 / §17.1。
 *
 * 表の中身は `DialectProfile.shortcuts` がすべて持っている（決定表#12）。`confirmed: false` は
 * 一次資料が未確認のまま §17.1 の前提方針で採用した割当なので、§12.1 の注記を添える。
 * Phase 4 でメーカーを足すと、この画面は**プロファイルを差し替えるだけ**で追随する。
 */

/**
 * プロファイルには無いが、本アプリの都合で行に添える注記（決定表#11 ①）。
 * `Shift+F3`（モニタ書込み）は Phase 3 では `F3` と同じ動作なので、割当表にそう書く。
 * キー文字列ではなく `action` で引く（キーは方言が決める。決定表#12）。
 */
const APP_NOTES: Readonly<Record<string, string>> = {
  'monitor-write': JA.ladder.monitorWriteSame,
};

export function ShortcutHelp({ profile }: { profile: DialectProfile }): JSX.Element {
  return (
    // 入れ物の `data-testid` は `shortcuts` / `shortcuts-note`。行だけが `shortcut-<action>` に
    // なるようにして、`getAllByTestId(/^shortcut-/u)` が行だけを数えられるようにする（B9）。
    // 割当表は「困ったときに開く」枠なので、折りたたみの既定は畳んだ状態（#27）
    <SidePanel
      title={`${JA.ladder.shortcuts}（${profile.displayName}）`}
      label={JA.ladder.shortcuts}
      testId="shortcuts"
    >
      {/* メーカー名を出す以上、商標の帰属も同じ場所に出す（§17.1） */}
      <p className={styles.sideNote}>{JA.settings.trademarkNotice}</p>
      <p className={styles.sideNote} data-testid="shortcuts-note">
        {JA.ladder.shortcutNote}
      </p>
      <table className={`${styles.ioTable} ${styles.shortcutTable}`}>
        <thead>
          <tr>
            <th scope="col">{JA.ladder.shortcutKeyHeader}</th>
            <th scope="col">{JA.ladder.shortcutLabelHeader}</th>
            <th scope="col">{JA.ladder.shortcutNoteHeader}</th>
          </tr>
        </thead>
        <tbody>
          {profile.shortcuts.map((entry) => {
            const notes = [
              entry.confirmed ? undefined : JA.settings.assumptionNotice,
              entry.note,
              APP_NOTES[entry.action],
            ].filter((note): note is string => note !== undefined);
            return (
              <tr
                key={entry.action}
                data-testid={`shortcut-${entry.action}`}
                data-enabled={entry.enabled !== false}
                className={entry.enabled === false ? styles.shortcutOff : undefined}
              >
                <td>{entry.keys}</td>
                <td>{entry.label}</td>
                <td className={styles.sideNote}>{notes.join(' ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SidePanel>
  );
}
