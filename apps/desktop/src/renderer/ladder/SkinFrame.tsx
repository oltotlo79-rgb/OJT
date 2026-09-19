import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import type { LadderEditorMode } from '../session/ladder.js';
import type { SkinStatusItem, SkinTheme } from './skins/index.js';
import styles from './ladder.module.css';

/**
 * スキンの枠（タイトルバーとステータスバー）。設計仕様 §10.6 / §12.1 / §17.1。決定表#7
 *
 * 利用者要求（2026-09-19）「各メーカーのソフト画面に合わせた可能な限り実物に忠実な画面」に
 * 対する部分である。**各社のロゴ・アイコン・画面キャプチャは持たない**（§17）。出すのは
 * 「`<ツール名> 風`」という文字と、実機のステータスバーが見せている種類の値だけである。
 */

/** ステータスバーの1項目。値はストアから引くので、新しい状態は増えない。 */
function StatusItem({ item }: { item: SkinStatusItem }): JSX.Element {
  const mode = useStore((s) => s.ladderMode);
  const running = useStore((s) => s.plcRunning);
  const scan = useStore((s) => s.plcMonitor?.scanCount);
  const networkId = useStore((s) => s.ladderCursor.networkId);
  const insertMode = useStore((s) => s.insertMode);
  const usage = useStore((s) => s.convertIssues.usage);
  const text = ((): string => {
    switch (item) {
      case 'mode':
        return `${JA.ladder.statusMode}: ${modeLabel(mode)}`;
      case 'plc-state':
        return `${JA.ladder.statusPlcState}: ${running ? JA.ladder.run : JA.ladder.stop}`;
      case 'scan':
        return `${JA.ladder.statusScan}: ${scan === undefined ? '—' : String(scan)}`;
      case 'network':
        return `${JA.ladder.statusNetwork}: ${networkId}`;
      case 'overwrite':
        return `${JA.ladder.statusOverwrite}: ${
          insertMode === 'insert' ? JA.ladder.statusInsert : JA.ladder.statusOverwriteMode
        }`;
      case 'device-count':
        return `${JA.ladder.statusDeviceCount}: ${String(
          (usage?.reads.length ?? 0) + (usage?.writes.length ?? 0),
        )}`;
    }
  })();
  return (
    <span className={styles.statusItem} data-testid={`status-${item}`}>
      {text}
    </span>
  );
}

/** 書込み／読出し／モニタの表示名（GX Works3 の言い方に揃える）。§10.6 */
function modeLabel(mode: LadderEditorMode): string {
  if (mode === 'write') return JA.plc.modeWrite;
  if (mode === 'read') return JA.plc.modeRead;
  return JA.plc.modeMonitor;
}

/** タイトルバー。スキン名（「風」つき）と商標の案内だけを出す。§15 / §17.1 */
export function SkinTitleBar({
  theme,
  profile,
}: {
  theme: SkinTheme;
  profile: DialectProfile;
}): JSX.Element {
  return (
    <div className={styles.titleBar} data-testid="skin-title">
      <span className={styles.titleBarName}>{theme.titleBar}</span>
      <span>{profile.displayName}</span>
      <span className={styles.titleBarNote}>{JA.ladder.skinTitleNote}</span>
    </div>
  );
}

/** ステータスバー。項目はスキンが決める（決定表#7）。 */
export function SkinStatusBar({ theme }: { theme: SkinTheme }): JSX.Element {
  return (
    <div className={styles.statusBar} data-testid="skin-status" role="status">
      {theme.statusItems.map((item) => (
        <StatusItem key={item} item={item} />
      ))}
    </div>
  );
}
