import type { Device } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { useState, type JSX } from 'react';
import type { PlcMonitorSnapshot } from '../app/store-types.js';
import { useStore } from '../app/store.js';
import { JA, onOffLabel, secondsLabel } from '../i18n/ja.js';
import { SidePanel } from './SidePanel.js';
import styles from './ladder.module.css';

/**
 * 監視（ウォッチ）欄。設計仕様 §10.6 ／ Phase 7 設計 §5.5。
 *
 * 「デバイス一覧」（`MonitorPanel`。使えるデバイスを**全部**並べる）とは役割が違う。こちらは
 * **利用者が選んだデバイスだけ**を並べる欄で、実機のツールにもウォッチウィンドウ（三菱・
 * オムロン）やモニタ登録（シャープ）という名前で同じものがある。欄の呼び名は方言が持ち
 * （`panels.watch`）、名乗らないメーカー（PCwin風）ではこの欄そのものを出さない。
 *
 * 登録した並びは**この欄が持つ**（課題の答えでも保存対象でもない、見る場所の覚書なので、
 * 保存するものを増やさない）。`plcMonitor` を購読するのは `MonitorPanel` と `LadderGrid` と
 * この欄だけにする（決定表#5。毎秒30枚のスナップショットで盤ごと描き直さないため）。
 */

/** 欄が縦に伸びすぎないための上限。 */
export const WATCH_LIMIT = 16;

/** 監視の1行に出す値（`on` は ■／□ の印に、`text` は数の欄に使う）。 */
interface WatchValue {
  on: boolean | undefined;
  text: string;
}

/** スナップショットからそのデバイスの値を引く。載っていなければ `undefined` の行になる。 */
export function watchValueOf(monitor: PlcMonitorSnapshot | undefined, device: Device): WatchValue {
  if (monitor === undefined) return { on: undefined, text: JA.ladder.watch.noValue };
  switch (device.kind) {
    case 'input': {
      const on = monitor.inputs[device.index];
      return on === undefined
        ? { on: undefined, text: JA.ladder.watch.noValue }
        : { on, text: onOffLabel(on) };
    }
    case 'output': {
      const on = monitor.outputs[device.index];
      return on === undefined
        ? { on: undefined, text: JA.ladder.watch.noValue }
        : { on, text: onOffLabel(on) };
    }
    case 'internal': {
      const on = monitor.internals[device.index];
      return on === undefined
        ? { on: undefined, text: JA.ladder.watch.noValue }
        : { on, text: onOffLabel(on) };
    }
    case 'special': {
      const on = monitor.specials?.[device.index];
      return on === undefined
        ? { on: undefined, text: JA.ladder.watch.noValue }
        : { on, text: onOffLabel(on) };
    }
    case 'timer': {
      const state = monitor.timers[device.index];
      return state === undefined
        ? { on: undefined, text: JA.ladder.watch.noValue }
        : {
            on: state.on,
            text: `${secondsLabel(state.elapsedMs)} / ${secondsLabel(state.presetMs)}`,
          };
    }
    case 'counter': {
      const state = monitor.counters[device.index];
      return state === undefined
        ? { on: undefined, text: JA.ladder.watch.noValue }
        : { on: state.on, text: String(state.value) };
    }
  }
}

/** ON／OFF を色だけでなく形でも示す印（指摘 UX-14 ≡ UI-17）。 */
export function onOffMark(on: boolean | undefined): string {
  if (on === undefined) return JA.ladder.watch.noValue;
  return on ? JA.ladder.onMark : JA.ladder.offMark;
}

export function WatchPanel({
  profile,
  openKey,
}: {
  profile: DialectProfile;
  /** ツールバーの「ウォッチ」を押すたびに変わる値。畳んでいても開く。 */
  openKey?: number;
}): JSX.Element | null {
  const title = profile.panels.watch;
  const monitor = useStore((s) => s.plcMonitor);
  const devices = useStore((s) => s.watchDevices);
  const setDevices = useStore((s) => s.setWatchDevices);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  // 名乗らないメーカーでは欄そのものを出さない（設計 §5.5）
  if (title === undefined) return null;

  const add = (): void => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    const device = profile.parseDevice(trimmed);
    if (device instanceof Error) {
      setError(device.message);
      return;
    }
    if (devices.length >= WATCH_LIMIT) {
      setError(JA.ladder.watch.full(WATCH_LIMIT));
      return;
    }
    if (devices.some((other) => other.kind === device.kind && other.index === device.index)) {
      setError(JA.ladder.watch.duplicate);
      return;
    }
    setDevices([...devices, device]);
    setText('');
    setError(undefined);
  };

  return (
    // 空のウォッチで編集面を塞がない。デバイスがある時か、開く操作をした時だけ展開する。
    <SidePanel
      title={title}
      label={JA.ladder.watch.title}
      testId="watch-panel"
      open={devices.length > 0}
      openKey={openKey}
    >
      <div className={styles.watchAdd}>
        <label className={styles.watchLabel} htmlFor="watch-device">
          {JA.ladder.watch.device}
        </label>
        <input
          id="watch-device"
          data-testid="watch-device"
          value={text}
          // デバイスの綴りはメーカーごとに違うので、例はプロファイルの書き方から作る
          placeholder={profile.formatDevice({ kind: 'input', index: 0 })}
          onChange={(event) => {
            setText(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add();
          }}
        />
        <button type="button" data-testid="watch-add" onClick={add}>
          {JA.ladder.watch.add}
        </button>
      </div>
      {error === undefined ? null : (
        <p className={styles.sideNote} data-testid="watch-error" role="alert">
          {error}
        </p>
      )}
      {devices.length === 0 ? (
        <p className={styles.sideNote} data-testid="watch-empty">
          {JA.ladder.watch.empty}
        </p>
      ) : (
        <table className={styles.ioTable} data-testid="watch-table">
          <tbody>
            {devices.map((device) => {
              const name = profile.formatDevice(device);
              const value = watchValueOf(monitor, device);
              return (
                <tr key={name} data-testid={`watch-row-${name}`} data-on={value.on ?? false}>
                  <td>{name}</td>
                  {/* 色だけに頼らない（UX-14）: ON は ■、OFF は □ */}
                  <td>
                    {onOffMark(value.on)} {value.text}
                  </td>
                  <td>
                    <button
                      type="button"
                      data-testid={`watch-remove-${name}`}
                      onClick={() => {
                        setDevices(devices.filter((other) => other !== device));
                      }}
                    >
                      {JA.ladder.watch.remove}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SidePanel>
  );
}
