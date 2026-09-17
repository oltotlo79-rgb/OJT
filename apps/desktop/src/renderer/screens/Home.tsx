import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { useStore, type ListMode } from '../app/store.js';
import styles from './screens.module.css';

/**
 * ホーム（モード選択）。設計仕様 §12.1。
 * Phase 2 で開けるのはモードB（回路組立）・C1（部品点検）・C2（回路点検・修復）の3つで、
 * PLC だけが押せない状態で並ぶ（§16 Phase 2「モードB・C1・C2 が動くアプリ」）。
 * 押したモードは `listMode` に残り、課題一覧はそれで絞り込まれる。
 */

/** モードの並び。§12.1 / §16 Phase 2（B・C1・C2 が動く） */
const MODES: ReadonlyArray<{
  key: string;
  mode: ListMode;
  name: string;
  desc: string;
  enabled: boolean;
}> = [
  {
    key: 'assemble',
    mode: 'assemble',
    name: JA.home.assemble,
    desc: JA.home.assembleDesc,
    enabled: true,
  },
  {
    key: 'inspect-parts',
    mode: 'inspect-parts',
    name: JA.home.inspectParts,
    desc: JA.home.inspectPartsDesc,
    enabled: true,
  },
  {
    key: 'inspect-repair',
    mode: 'inspect-repair',
    name: JA.home.inspectRepair,
    desc: JA.home.inspectRepairDesc,
    enabled: true,
  },
  { key: 'plc', mode: undefined, name: JA.home.plc, desc: JA.home.comingSoon, enabled: false },
];

/** ホーム画面。 */
export function Home(): JSX.Element {
  const setRoute = useStore((s) => s.setRoute);
  const setListMode = useStore((s) => s.setListMode);
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
              setListMode(mode.mode);
              setRoute('list');
            }}
          >
            <span className={styles.modeName}>{mode.name}</span>
            <span className={styles.modeDesc}>{mode.desc}</span>
          </button>
        ))}
      </div>
      <p style={{ marginTop: 24 }}>
        <button
          type="button"
          data-testid="open-settings"
          onClick={() => {
            setRoute('settings');
          }}
        >
          {JA.home.settings}
        </button>
      </p>
    </div>
  );
}
