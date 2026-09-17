import type { InspectPartsProblem } from '@ojt/content';
import type { JSX } from 'react';
import { JA, trayPartLabel } from '../i18n/ja.js';
import styles from './tester.module.css';

/**
 * モードC1の部品トレイ。設計仕様 §9.1。
 * トレイに並ぶのは課題の `parts`。**本当の状態（`truth`）は決して描かない**（答えが漏れる）。
 * 挿す・外すは1個ずつで、挿すたびに盤とシミュレーションを作り直す（§9.1「部品を外して次へ」）。
 */
export function CheckTrayPanel({
  problem,
  checkPartId,
  onSelect,
  onEject,
}: {
  problem: InspectPartsProblem;
  /** いまチェック用ソケットに挿している部品のID。 */
  checkPartId: string | undefined;
  onSelect: (partId: string) => void;
  onEject: () => void;
}): JSX.Element {
  return (
    <section className={styles.panel} data-testid="check-tray">
      <h2 className={styles.title}>{JA.inspectParts.tray}</h2>
      <p className={styles.hint}>{JA.inspectParts.steps}</p>
      {problem.parts.map((part) => {
        const active = part.id === checkPartId;
        return (
          <div
            key={part.id}
            className={`${styles.trayRow} ${active ? styles.trayActive : ''}`}
            data-testid={`tray-${part.id}`}
          >
            <span className={styles.trayName}>
              {trayPartLabel(part.id, part.kind === 'timer-h3y4')}
            </span>
            {active ? (
              <>
                <span className={styles.label}>{JA.inspectParts.mounted}</span>
                <button type="button" data-testid={`eject-${part.id}`} onClick={onEject}>
                  {JA.inspectParts.eject}
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid={`plug-${part.id}`}
                onClick={() => {
                  onSelect(part.id);
                }}
              >
                {JA.inspectParts.plug}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
