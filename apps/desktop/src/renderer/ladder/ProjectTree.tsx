import type { LadderProgram } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { CSSProperties, JSX } from 'react';
import { JA } from '../i18n/ja.js';
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
  return (
    <nav
      className={styles.tree}
      data-testid="project-tree"
      aria-label={profile.panels.tree}
      // 選択中のネットワークの色は方言から引く（CSS に直書きしない。レビュー Minor）
      style={{ '--tree-current': profile.monitorColors.powered } as CSSProperties}
    >
      <p className={styles.treeRoot}>{JA.ladder.treeProgram}</p>
      {/* a11y: ネットワーク一覧は木構造として読み上げる（Batch 3 レビュー M8） */}
      <ul className={styles.treeList} role="tree" aria-label={JA.ladder.treeProgram}>
        <li role="treeitem" aria-expanded="true">
          {JA.ladder.treeMain}
          <ul role="group">
            {program.networks.map((net) => (
              <li key={net.id} role="treeitem">
                <button
                  type="button"
                  data-testid={`tree-network-${net.id}`}
                  aria-current={net.id === currentNetworkId}
                  onClick={() => {
                    onPick(net.id);
                  }}
                >
                  {net.id}
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
