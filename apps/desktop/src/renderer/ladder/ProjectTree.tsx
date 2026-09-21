import type { LadderProgram } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { CSSProperties, JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { skinMonitorColor } from '../session/plc-skin.js';
import { documentName } from './native-layout.js';
import styles from './ladder.module.css';

/**
 * ナビゲーションウィンドウ（プロジェクトツリー）。設計仕様 §10.6。
 * 名称はスキン（`profile.panels.tree`）から引く。**ベンダーのアイコンは使わない**（§17）。
 */
export function ProjectTree({
  program,
  profile,
  currentNetworkId,
  onPick,
}: {
  program: LadderProgram;
  profile: DialectProfile;
  currentNetworkId: string;
  onPick: (networkId: string) => void;
}): JSX.Element {
  // 設定画面のモニタ色が方言の既定色を上書きする（Batch 4+5 レビュー M15 / M13）
  const monitorColor = useStore((s) => s.monitorColor);
  const currentColor = skinMonitorColor(profile, monitorColor);
  return (
    <nav
      className={styles.tree}
      data-testid="project-tree"
      aria-label={profile.panels.tree}
      // 選択中のネットワークの色は方言（＋設定の上書き）から引く（CSS に直書きしない。レビュー Minor）
      style={{ '--tree-current': currentColor } as CSSProperties}
    >
      <p className={styles.treeRoot} title={profile.panels.tree}>
        {profile.panels.tree}
      </p>
      {/* a11y: ネットワーク一覧は木構造として読み上げる（Batch 3 レビュー M8） */}
      <ul className={styles.treeList} role="tree" aria-label={JA.ladder.treeProgram}>
        <li role="treeitem" aria-expanded="true">
          <span className={styles.treeDocument} title={documentName(profile.id)}>
            {documentName(profile.id)}
          </span>
          <ul role="group">
            {program.networks.map((net, index) => (
              <li key={net.id} role="treeitem">
                <button
                  type="button"
                  data-testid={`tree-network-${net.id}`}
                  aria-current={net.id === currentNetworkId}
                  onClick={() => {
                    onPick(net.id);
                  }}
                >
                  {net.cells.some((row) => row.some((cell) => cell.kind === 'end'))
                    ? profile.instructionNames.end
                    : JA.ladder.circuitNumber(index)}
                  {net.comment === undefined ? '' : `（${net.comment}）`}
                </button>
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </nav>
  );
}
