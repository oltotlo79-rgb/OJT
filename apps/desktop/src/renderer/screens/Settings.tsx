import { useEffect, useState, type JSX } from 'react';
import type { AppSettings } from '../../shared/ipc.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { sounds } from '../audio/sounds.js';
import { JA } from '../i18n/ja.js';
import styles from './screens.module.css';

/**
 * 設定画面。設計仕様 §12.1 / §15。
 * Phase 1 で扱うのは「利用者課題フォルダ」「音のON/OFFと音量」「起動時の復元確認」と、
 * 商標注記・前提注記を載せた「このアプリについて」だけ（ラダー関係は Phase 3 以降）。
 *
 * `window.ojt` には他の画面と同じく `ojtApi()` を通してだけ触る。preload が読み込まれていない
 * 環境（設定ミス・素のブラウザ）でも、真っ黒な画面ではなく理由付きの文言を出す（§13 #5）。
 */

/** 商標注記。§15 */
export const TRADEMARK_NOTICE = JA.settings.trademarkNotice;

/** 未確認事項の注記。§17.1 */
export const ASSUMPTION_NOTICE = JA.settings.assumptionNotice;

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 設定画面。 */
export function Settings(): JSX.Element {
  const setRoute = useStore((s) => s.setRoute);
  const toast = useStore((s) => s.toast);
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    try {
      void ojtApi()
        .getSettings()
        .then(setSettings, (error: unknown) => {
          setLoadError(reasonOf(error));
        });
    } catch (error) {
      setLoadError(reasonOf(error));
    }
  }, []);

  const patch = (next: Partial<AppSettings>): void => {
    let api: ReturnType<typeof ojtApi>;
    try {
      api = ojtApi();
    } catch (error) {
      toast(reasonOf(error), 'error');
      return;
    }
    void api.setSettings(next).then(
      (saved) => {
        setSettings(saved);
        sounds.configure({ enabled: saved.soundEnabled, volume: saved.soundVolume });
        toast(JA.settings.saved);
      },
      (error: unknown) => {
        toast(reasonOf(error), 'error');
      },
    );
  };

  return (
    <div className={styles.center}>
      <button
        type="button"
        onClick={() => {
          setRoute('home');
        }}
      >
        {JA.problemList.back}
      </button>
      <h1 className={styles.title} style={{ marginTop: 12 }}>
        {JA.home.settings}
      </h1>
      {loadError !== undefined ? (
        <p className={styles.errorBox} data-testid="settings-error">
          {JA.settings.loadFailed}: {loadError}
        </p>
      ) : settings === undefined ? (
        <p className={styles.subtitle}>{JA.problemList.loading}</p>
      ) : (
        <div style={{ maxWidth: 760 }}>
          <section className={styles.settingRow}>
            <label htmlFor="user-dir">{JA.settings.userContentDir}</label>
            <input
              id="user-dir"
              type="text"
              value={settings.userContentDir}
              data-testid="setting-user-dir"
              onChange={(event) => {
                setSettings({ ...settings, userContentDir: event.target.value });
              }}
              onBlur={(event) => {
                patch({ userContentDir: event.target.value });
              }}
            />
          </section>

          <section className={styles.settingRow}>
            <label htmlFor="sound-enabled">{JA.settings.soundEnabled}</label>
            <input
              id="sound-enabled"
              type="checkbox"
              checked={settings.soundEnabled}
              data-testid="setting-sound-enabled"
              onChange={(event) => {
                patch({ soundEnabled: event.target.checked });
              }}
            />
          </section>

          <section className={styles.settingRow}>
            <label htmlFor="sound-volume">{JA.settings.soundVolume}</label>
            <input
              id="sound-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.soundVolume}
              data-testid="setting-sound-volume"
              onChange={(event) => {
                patch({ soundVolume: Number(event.target.value) });
              }}
            />
            <span>{Math.round(settings.soundVolume * 100)}%</span>
          </section>

          <section className={styles.settingRow}>
            <label htmlFor="restore-prompt">{JA.settings.restorePrompt}</label>
            <input
              id="restore-prompt"
              type="checkbox"
              checked={settings.restorePrompt}
              data-testid="setting-restore-prompt"
              onChange={(event) => {
                patch({ restorePrompt: event.target.checked });
              }}
            />
          </section>

          <section className={styles.about} data-testid="about">
            <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>{JA.settings.about}</h2>
            <p>{TRADEMARK_NOTICE}</p>
            <p>{ASSUMPTION_NOTICE}</p>
          </section>
        </div>
      )}
    </div>
  );
}
