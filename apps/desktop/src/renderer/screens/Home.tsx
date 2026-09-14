import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { useStore } from '../app/store.js';
import styles from './screens.module.css';

/**
 * ホーム（モード選択）。設計仕様 §12.1。
 * Phase 1 で開けるのはモードB（回路組立）だけで、残り3モードは押せない状態で並べる（§16）。
 */

/** モードの並び。§12.1 */
const MODES: ReadonlyArray<{ key: string; name: string; desc: string; enabled: boolean }> = [
  { key: 'assemble', name: JA.home.assemble, desc: JA.home.assembleDesc, enabled: true },
  { key: 'inspect-parts', name: JA.home.inspectParts, desc: JA.home.comingSoon, enabled: false },
  { key: 'inspect-repair', name: JA.home.inspectRepair, desc: JA.home.comingSoon, enabled: false },
  { key: 'plc', name: JA.home.plc, desc: JA.home.comingSoon, enabled: false },
];

/** ホーム画面。 */
export function Home(): JSX.Element {
  const setRoute = useStore((s) => s.setRoute);
  return (
    <div className={styles.center}>
      <h1 className={styles.title}>{JA.app.name}</h1>
      <p className={styles.subtitle}>{JA.app.subtitle}</p>
      <h2 className={styles.title} style={{ fontSize: 18 }}>
        {JA.home.title}
      </h2>
      <div className={styles.modeGrid}>
        {MODES.map((mode) => (
          <button
            key={mode.key}
            type="button"
            className={styles.modeCard}
            disabled={!mode.enabled}
            data-testid={`mode-${mode.key}`}
            onClick={() => {
              setRoute('list');
            }}
          >
            <span className={styles.modeName}>{mode.name}</span>
            <span className={styles.modeDesc}>{mode.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
