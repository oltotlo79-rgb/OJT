import {
  DIALECT_IDS,
  IMPLEMENTED_DIALECT_IDS,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
} from '@ojt/plc-dialects';
import { useEffect, useState, type JSX } from 'react';
import { DEFAULT_SETTINGS, type AppSettings, type AppSettingsResponse } from '../../shared/ipc.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { sounds } from '../audio/sounds.js';
import { JA } from '../i18n/ja.js';
import styles from './screens.module.css';

/** メーカーの表示名（Phase 3 は三菱のみ実装。決定表#13）。 */
const VENDOR_LABELS: Record<string, string> = {
  mitsubishi: '三菱電機',
  jtekt: 'ジェイテクト',
  omron: 'オムロン',
  sharp: 'シャープ',
};

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
  const [settings, setSettings] = useState<AppSettingsResponse | undefined>(undefined);
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

  /**
   * 設定を1キーだけ保存する。
   * `silent` はスライダのように**確定のたびに保存する**ところで使う（1D2-a のレビュー指摘:
   * つまみを動かすたびに「設定を保存しました」が5件並んで画面が埋まっていた）。
   */
  const patch = (next: Partial<AppSettings>, options: { silent?: boolean } = {}): void => {
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
        // 設定画面にいる間もラダーへ即時反映する（§12.1）。起動直後の反映は App.tsx が担う。
        useStore.getState().applyLadderSettings({
          gridCols: saved.ladderGridCols,
          monitorColor: saved.monitorColor,
          vendor: saved.defaultVendor,
        });
        if (options.silent !== true) toast(JA.settings.saved);
      },
      (error: unknown) => {
        toast(reasonOf(error), 'error');
      },
    );
  };

  /**
   * 音量つまみの確定。§15
   * `onChange` は手元の状態だけを動かし（音もその場で反映して聞き比べられるようにする）、
   * 指を離す・キーを離す・欄から外れたときに1回だけ保存する。
   */
  const commitVolume = (): void => {
    if (settings === undefined) return;
    patch({ soundVolume: settings.soundVolume }, { silent: true });
  };

  /** ラダーの表示列数の確定。範囲外はここで丸めてから保存する（§10.6）。 */
  const commitGridCols = (): void => {
    if (settings === undefined) return;
    const clamped = Math.min(
      MAX_GRID_COLS,
      Math.max(MIN_GRID_COLS, Math.round(settings.ladderGridCols)),
    );
    if (clamped !== settings.ladderGridCols) setSettings({ ...settings, ladderGridCols: clamped });
    patch({ ladderGridCols: clamped });
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
          {settings.warning === undefined ? null : (
            <p className={styles.errorBox} data-testid="settings-warning">
              {settings.warning}
            </p>
          )}
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
          <p className={styles.subtitle} data-testid="user-dir-help">
            {JA.settings.userContentHelp}
          </p>

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
                // 動かしている間は保存しない（確定は onPointerUp / onKeyUp / onBlur）
                const soundVolume = Number(event.target.value);
                setSettings({ ...settings, soundVolume });
                sounds.configure({ enabled: settings.soundEnabled, volume: soundVolume });
              }}
              onPointerUp={commitVolume}
              onKeyUp={commitVolume}
              onBlur={commitVolume}
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

          <section data-testid="plc-settings">
            <h2 style={{ fontSize: 14, margin: '16px 0 6px' }}>{JA.settings.plcGroup}</h2>

            <section className={styles.settingRow}>
              <label htmlFor="setting-vendor">{JA.settings.vendor}</label>
              <select
                id="setting-vendor"
                data-testid="setting-vendor"
                value={settings.defaultVendor}
                onChange={(event) => {
                  patch({ defaultVendor: event.target.value });
                }}
              >
                {DIALECT_IDS.map((id) => (
                  <option
                    key={id}
                    value={id}
                    data-testid={`vendor-option-${id}`}
                    disabled={!IMPLEMENTED_DIALECT_IDS.includes(id)}
                  >
                    {VENDOR_LABELS[id] ?? id}
                    {IMPLEMENTED_DIALECT_IDS.includes(id)
                      ? ''
                      : `（${JA.settings.vendorUnimplemented}）`}
                  </option>
                ))}
              </select>
            </section>
            <p className={styles.subtitle} data-testid="vendor-note">
              {JA.settings.vendorHelp} {JA.settings.vendorUnimplemented}
            </p>
            <p className={styles.subtitle} data-testid="vendor-assumption">
              {ASSUMPTION_NOTICE}
            </p>

            <section className={styles.settingRow}>
              <label htmlFor="setting-grid-cols">{JA.settings.gridCols}</label>
              <input
                id="setting-grid-cols"
                type="number"
                min={MIN_GRID_COLS}
                max={MAX_GRID_COLS}
                value={settings.ladderGridCols}
                data-testid="setting-grid-cols"
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setSettings({
                    ...settings,
                    ladderGridCols: Number.isFinite(value) ? value : settings.ladderGridCols,
                  });
                }}
                onBlur={commitGridCols}
              />
            </section>
            <p className={styles.subtitle} data-testid="grid-cols-help">
              {JA.settings.gridColsHelp}
            </p>

            <section className={styles.settingRow}>
              <label htmlFor="setting-monitor-color">{JA.settings.monitorColor}</label>
              <input
                id="setting-monitor-color"
                type="color"
                value={settings.monitorColor}
                data-testid="setting-monitor-color"
                onChange={(event) => {
                  setSettings({ ...settings, monitorColor: event.target.value });
                }}
                onBlur={(event) => {
                  patch({ monitorColor: event.target.value });
                }}
              />
            </section>
            <p className={styles.subtitle} data-testid="monitor-color-help">
              {JA.settings.monitorColorHelp}
            </p>

            <button
              type="button"
              data-testid="setting-plc-reset"
              onClick={() => {
                patch({
                  defaultVendor: DEFAULT_SETTINGS.defaultVendor,
                  ladderGridCols: DEFAULT_SETTINGS.ladderGridCols,
                  monitorColor: DEFAULT_SETTINGS.monitorColor,
                });
              }}
            >
              {JA.settings.resetPlcGroup}
            </button>
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
