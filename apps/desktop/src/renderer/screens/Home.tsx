import { useEffect, useState, type JSX } from 'react';
import { JA, sessionModeLabel } from '../i18n/ja.js';
import { useStore, type ListMode } from '../app/store.js';
import { tryOjtApi } from '../app/ojt-api.js';
import { formatElapsed } from '../../worker/runtime.js';
import { HelpButton } from '../help/HelpButton.js';
import styles from './screens.module.css';

/**
 * ホーム（モード選択）。設計仕様 §12.1。
 * モードB（回路組立）・C1（部品点検）・C2（回路点検・修復）・D（PLC）の4つが並ぶ
 * （Plan 3B Task 15 で PLC も押せるようになった）。
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
  {
    key: 'plc',
    mode: 'plc',
    name: JA.home.plc,
    desc: JA.home.plcDesc,
    enabled: true,
  },
];

/** 「最近の課題」の一行に出す情報（UXレビュー #19）。 */
interface RecentProblem {
  title: string;
  mode: 'assemble' | 'inspect-parts' | 'inspect-repair' | 'plc' | undefined;
  elapsedMs: number;
}

/** ホーム画面。 */
export function Home(): JSX.Element {
  const setRoute = useStore((s) => s.setRoute);
  const setListMode = useStore((s) => s.setListMode);
  /**
   * 最近の課題（UXレビュー #19）。§12.3 の一時保存を読まずに覗くだけ（`discard` を
   * 付けないので一時保存は消えない。`App.tsx` の復元プロンプトとは独立に動く）。
   * preload が無い・一時保存が無いときは黙って何も出さない（§13 #5 と同じ流儀）。
   */
  const [recent, setRecent] = useState<RecentProblem | undefined>(undefined);
  useEffect(() => {
    const api = tryOjtApi();
    if (api === undefined) return;
    let cancelled = false;
    void api.loadWorkFile({ kind: 'autosave' }).then((result) => {
      if (cancelled || !result.ok) return;
      void api.readProblem(result.file.problemId).then((problem) => {
        if (cancelled || problem === null) return;
        setRecent({
          title: problem.title,
          mode: result.file.mode,
          elapsedMs: result.file.elapsedMs,
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.center}>
      {/* UXレビュー #19: 設定は右上に置く（モードカードを選ぶ主導線から離す）。 */}
      <div className={styles.homeHeader}>
        <div>
          <h1 className={styles.title}>{JA.app.name}</h1>
          <p className={styles.subtitle}>{JA.app.subtitle}</p>
        </div>
        {/*
          ホームには「もどる」が無いので、上の帯のボタンは右端の設定の隣に並べる
          （Plan 6 Task 9）。`justify-content: space-between` の直下に3つ目を置くと
          ヘルプだけが帯の真ん中へ流れるので、2つを1つの枠にまとめる。
        */}
        <div className={styles.homeActions}>
          <HelpButton />
          <button
            type="button"
            data-testid="open-settings"
            onClick={() => {
              setRoute('settings');
            }}
          >
            {JA.home.settings}
          </button>
        </div>
      </div>
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
      {recent === undefined ? null : (
        <p className={styles.subtitle} data-testid="recent-problem">
          {JA.recentProblem}: {sessionModeLabel(recent.mode)} {recent.title}（
          {formatElapsed(recent.elapsedMs)}）
        </p>
      )}
    </div>
  );
}
