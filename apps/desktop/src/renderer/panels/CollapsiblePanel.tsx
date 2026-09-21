import { useEffect, useState, type JSX, type ReactNode } from 'react';
import styles from './panels.module.css';

/** 課題・道具・PLC補助欄で共通の、キーボードでも開閉できるパネル。 */
export function CollapsiblePanel({
  title,
  testId,
  label,
  summary,
  open = false,
  openKey,
  children,
  skin = 'app',
  collapsible = true,
}: {
  title: string;
  testId: string;
  label?: string | undefined;
  summary?: ReactNode;
  open?: boolean;
  openKey?: string | number | undefined;
  skin?: 'app' | 'plc';
  collapsible?: boolean;
  children: ReactNode;
}): JSX.Element {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (openKey !== undefined) setExpanded(true);
  }, [openKey]);
  return (
    <section
      className={styles.disclosure}
      data-skin={skin}
      aria-label={label ?? title}
      data-testid={testId}
    >
      {!collapsible ? (
        <>
          <header className={styles.disclosureSummary}>
            <h2>{title}</h2>
          </header>
          <div className={styles.disclosureBody}>{children}</div>
        </>
      ) : (
        <details
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
          data-testid={`${testId}-details`}
        >
          <summary className={styles.disclosureSummary} data-testid={`${testId}-summary`}>
            <h2>{title}</h2>
            {summary === undefined ? null : (
              <span className={styles.disclosureMeta}>{summary}</span>
            )}
          </summary>
          <div className={styles.disclosureBody}>{children}</div>
        </details>
      )}
    </section>
  );
}
