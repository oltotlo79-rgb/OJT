import { validUserContentDir } from '../../shared/settings-validation.js';
import {
  availableDialects,
  getDialect,
  isDialectId,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
} from '@ojt/plc-dialects';
import { useEffect, useRef, useState, type JSX } from 'react';
import { DEFAULT_SETTINGS, type AppSettings, type AppSettingsResponse } from '../../shared/ipc.js';
import { reasonOf } from '../app/errors.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { sounds } from '../audio/sounds.js';
import { HelpButton } from '../help/HelpButton.js';
import { JA } from '../i18n/ja.js';
import { SKIN_THEMES } from '../ladder/skins/index.js';
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

/** 設定画面。 */
export function Settings(): JSX.Element {
  const setRoute = useStore((s) => s.setRoute);
  const toast = useStore((s) => s.toast);
  const [settings, setSettings] = useState<AppSettingsResponse | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  /**
   * サーバ側で確定した最新の設定（保存の度に更新。onChange の手元の編集では動かさない）。
   * `commitGridCols()` が「変わっていないのに保存」を避けるのに使う（レビュー指摘 #6）。
   * 描画（JSX。300・352行）でも読むので ref ではなく state に置く（UI-11）。
   */
  const [saved, setSaved] = useState<AppSettingsResponse | undefined>(undefined);
  /**
   * 直前に選んでいた上書き値（列数・通電色それぞれ）。§10.6 / レビュー指摘 #2
   * 「メーカーの既定に従う」を外すたびに毎回メーカーの値から上書きを始めると、外す→戻す→
   * 外すを繰り返しただけで訓練者が選んだ値（例: 列数13）が消えてメーカーの既定に化ける。
   * 0 / '' でない値を見るたびに覚えておき、外したときはまずこれを使う（無ければメーカーの値）。
   */
  const gridColsOverrideRef = useRef<number | undefined>(undefined);
  const monitorColorOverrideRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    try {
      void ojtApi()
        .getSettings()
        .then(
          (fetched) => {
            setSettings(fetched);
            setSaved(fetched);
          },
          (error: unknown) => {
            setLoadError(reasonOf(error));
          },
        );
    } catch (error) {
      setLoadError(reasonOf(error));
    }
  }, []);

  useEffect(() => {
    if (settings === undefined) return;
    if (settings.ladderGridCols !== 0) gridColsOverrideRef.current = settings.ladderGridCols;
    if (settings.monitorColor.length > 0) monitorColorOverrideRef.current = settings.monitorColor;
  }, [settings]);

  /**
   * 設定を1キーだけ保存する。
   * `silent` はスライダのように**確定のたびに保存する**ところで使う（1D2-a のレビュー指摘:
   * つまみを動かすたびに「設定を保存しました」が5件並んで画面が埋まっていた）。
   */
  const patch = (next: Partial<AppSettings>, options: { silent?: boolean } = {}): void => {
    if (
      saved !== undefined &&
      Object.entries(next).every(([key, value]) => saved[key as keyof AppSettings] === value)
    )
      return;
    if (next.userContentDir !== undefined && !validUserContentDir(next.userContentDir)) {
      toast(JA.settings.invalidUserDir, 'error');
      return;
    }
    let api: ReturnType<typeof ojtApi>;
    try {
      api = ojtApi();
    } catch (error) {
      toast(reasonOf(error), 'error');
      return;
    }
    // ラダーへ即時反映するのは3キー（メーカー・表示列数・通電色）のどれかが変わったときだけ
    // （レビュー指摘 #4）。他の設定（音量など）を保存するたびに毎回呼ぶ必要はない。
    const changesLadderSettings =
      'defaultVendor' in next || 'ladderGridCols' in next || 'monitorColor' in next;
    void api.setSettings(next).then(
      (response) => {
        setSettings(response);
        setSaved(response);
        sounds.configure({ enabled: response.soundEnabled, volume: response.soundVolume });
        if (changesLadderSettings) {
          // 設定画面にいる間もラダーへ即時反映する（§12.1）。起動直後の反映は App.tsx が担う。
          useStore.getState().applyLadderSettings({
            gridCols: response.ladderGridCols,
            monitorColor: response.monitorColor,
            vendor: response.defaultVendor,
          });
        }
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

  /**
   * ラダーの表示列数の確定。範囲外はここで丸めてから保存する（§10.6）。
   * 保存済みの値と同じなら保存・トーストをしない（触っただけで blur したとき。レビュー指摘 #6）。
   */
  const commitGridCols = (): void => {
    if (settings === undefined) return;
    if (settings.ladderGridCols === 0) return; // メーカーの既定に従う
    const clamped = Math.min(
      MAX_GRID_COLS,
      Math.max(MIN_GRID_COLS, Math.round(settings.ladderGridCols)),
    );
    /*
     * 空欄のまま blur したとき（onChange 側が空欄を無視して手元の値を動かしていない）でも、
     * 表示だけは打鍵で空になっている。ここで確定値を毎回書き戻して表示を揃え直す
     * （レビュー指摘 #1）。値そのものが同じでも新しいオブジェクトを渡して再描画させる。
     */
    setSettings({ ...settings, ladderGridCols: clamped });
    if (clamped === saved?.ladderGridCols) return;
    patch({ ladderGridCols: clamped });
  };

  return (
    <div className={styles.center}>
      {/* 画面の上の帯（Plan 6 Task 9）。「もどる」の隣にヘルプを並べる。 */}
      <div className={styles.screenHeader}>
        <button
          type="button"
          onClick={() => {
            setRoute('home');
          }}
        >
          {JA.problemList.back}
        </button>
        <HelpButton />
      </div>
      <h1 className={`${styles.title} ${styles.pageTitle}`}>{JA.home.settings}</h1>
      {loadError !== undefined ? (
        <p className={styles.errorBox} data-testid="settings-error">
          {JA.settings.loadFailed}: {loadError}
        </p>
      ) : settings === undefined ? (
        <p className={styles.subtitle}>{JA.problemList.loading}</p>
      ) : (
        <div className={styles.settingsBody}>
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
            <h2 className={styles.settingsGroupTitle}>{JA.settings.plcGroup}</h2>

            <section className={styles.settingRow}>
              <label htmlFor="setting-vendor">{JA.settings.vendor}</label>
              <select
                id="setting-vendor"
                data-testid="setting-vendor"
                value={settings.defaultVendor}
                onChange={(event) => {
                  // 値は実装済みプロファイルから作った <option> の value しか来ないが、DOM の
                  // `event.target.value` は素の string なので `isDialectId()` で絞ってから渡す
                  // （`AppSettings.defaultVendor` は `DialectId`。レビュー指摘 #9）。
                  if (isDialectId(event.target.value)) {
                    patch({ defaultVendor: event.target.value });
                  }
                }}
              >
                {/* `availableDialects()` は実装済みのプロファイルだけを返す（Phase 4 で4件） */}
                {availableDialects().map((profile) => (
                  <option
                    key={profile.id}
                    value={profile.id}
                    data-testid={`vendor-option-${profile.id}`}
                  >
                    {profile.displayName}
                  </option>
                ))}
              </select>
            </section>
            <p className={styles.subtitle} data-testid="vendor-note">
              {JA.settings.vendorHelp}
            </p>
            <details className={styles.assumptions}>
              <summary>{JA.settings.skinEvidence}</summary>
              <p className={styles.subtitle} data-testid="vendor-assumption">
                {ASSUMPTION_NOTICE}
              </p>
              {/* いま選んでいるスキンの見た目のうち、何が前提なのかを出す（§17.1 / 4A H-5） */}
              <ul className={styles.subtitle} data-testid="skin-assumed">
                {(isDialectId(settings.defaultVendor)
                  ? SKIN_THEMES[settings.defaultVendor].assumed
                  : []
                ).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>

            <section className={styles.settingRow}>
              {/* レビュー指摘 #8: 列数・通電色のどちらを指すか分かる文言にする（同じ文言だと
                  隣のチェックボックスと取り違えかねない） */}
              <label htmlFor="setting-grid-cols-auto">{JA.settings.followVendorGridCols}</label>
              <input
                id="setting-grid-cols-auto"
                type="checkbox"
                // レビュー指摘 #1: draft（打鍵中の手元の値）ではなく保存済みの値で判定する。
                // 空欄にしている最中の 0 相当の見た目に引きずられてチェックが動かないように。
                checked={saved?.ladderGridCols === 0}
                data-testid="setting-grid-cols-auto"
                onChange={(event) => {
                  // 外したときは、前回の上書き値があればそれを、無ければ「いまのメーカーの
                  // 既定」から上書きを始める（レビュー指摘 #2・#7）
                  const restoreValue =
                    gridColsOverrideRef.current ?? getDialect(settings.defaultVendor).gridCols;
                  patch({ ladderGridCols: event.target.checked ? 0 : restoreValue });
                }}
              />
            </section>
            <p className={styles.subtitle} data-testid="grid-cols-help">
              {JA.settings.gridColsHelp(getDialect(settings.defaultVendor).gridCols)}
            </p>

            <section className={styles.settingRow}>
              <label htmlFor="setting-grid-cols">{JA.settings.gridCols}</label>
              <input
                id="setting-grid-cols"
                type="number"
                min={MIN_GRID_COLS}
                max={MAX_GRID_COLS}
                disabled={settings.ladderGridCols === 0}
                // レビュー指摘 #6: 無効化中は 0（min=8 未満で表示がおかしい）ではなく、
                // 実際に使われるメーカーの既定値を見せる（通電色の見本と同じ扱い）
                value={
                  settings.ladderGridCols > 0
                    ? settings.ladderGridCols
                    : getDialect(settings.defaultVendor).gridCols
                }
                data-testid="setting-grid-cols"
                onChange={(event) => {
                  // 空欄・0以下は無視して前の値を保つ（レビュー指摘 #1: 空欄が 0 になって
                  // 「メーカーの既定に従う」チェックまで動いてしまっていた）。確定は blur で行う。
                  const raw = event.target.value;
                  if (raw.trim().length === 0) return;
                  const value = Number(raw);
                  if (!Number.isFinite(value) || value <= 0) return;
                  setSettings({ ...settings, ladderGridCols: value });
                }}
                onBlur={commitGridCols}
              />
            </section>

            <section className={styles.settingRow}>
              <label htmlFor="setting-monitor-color-auto">
                {JA.settings.followVendorMonitorColor}
              </label>
              <input
                id="setting-monitor-color-auto"
                type="checkbox"
                // レビュー指摘 #1と同じ理由で保存済みの値を見る
                checked={saved?.monitorColor.length === 0}
                data-testid="setting-monitor-color-auto"
                onChange={(event) => {
                  // 外したときは、前回の上書き値があればそれを、無ければ「いま選んでいる
                  // メーカーの通電色」から上書きを始める（B1・レビュー指摘 #2・#7）
                  const restoreValue =
                    monitorColorOverrideRef.current ??
                    getDialect(settings.defaultVendor).monitorColors.powered;
                  patch({ monitorColor: event.target.checked ? '' : restoreValue });
                }}
              />
            </section>
            <p className={styles.subtitle} data-testid="monitor-color-help">
              {JA.settings.monitorColorHelp}
            </p>

            <section className={styles.settingRow}>
              <label htmlFor="setting-monitor-color">{JA.settings.monitorColor}</label>
              <input
                id="setting-monitor-color"
                type="color"
                disabled={settings.monitorColor.length === 0}
                value={
                  settings.monitorColor.length > 0
                    ? settings.monitorColor
                    : // 空＝スキンの既定色。見本にはその色を出す（決定表#8）
                      (isDialectId(settings.defaultVendor)
                        ? getDialect(settings.defaultVendor).monitorColors.powered
                        : '#000000'
                      ).toLowerCase()
                }
                data-testid="setting-monitor-color"
                onChange={(event) => {
                  setSettings({ ...settings, monitorColor: event.target.value });
                }}
                onBlur={(event) => {
                  patch({ monitorColor: event.target.value });
                }}
              />
            </section>

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

          {/*
            UXレビュー #11: 未確認事項の注記（ASSUMPTION_NOTICE）は既に PLC 設定のすぐ下
            （`vendor-assumption`）に出ている。ここでも繰り返すと同じ注記が2回出て冗長だったので、
            この節では商標注記だけにする。
          */}
          <section className={styles.about} data-testid="about">
            <h2 className={styles.groupTitle}>{JA.settings.about}</h2>
            <p>{TRADEMARK_NOTICE}</p>
          </section>
        </div>
      )}
    </div>
  );
}
