import { findTimerRange, DEFAULT_TIMER_RANGE, snapPresetToStep } from '@ojt/board-model';
import { useState, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './panels.module.css';

/**
 * タイマ設定ダイヤル。設計仕様 §5.3.2 / §8.2。
 * ドラッグ（`range`）と数値入力の両方を受ける。刻みはレンジの分解能
 * （0〜10sレンジは0.1s、0〜60sレンジは0.5s）をそのまま使う。
 */

/** 秒 → ms（浮動小数の誤差を避けるため 10ms 単位に丸める）。 */
export function secondsToMs(seconds: number): number {
  return Math.round(seconds * 100) * 10;
}

/** タイマ設定ダイヤル1個。 */
export function TimerDial({
  label,
  presetMs,
  rangeMaxMs,
  onChange,
}: {
  label: string;
  presetMs: number;
  rangeMaxMs: number;
  onChange: (presetMs: number) => void;
}): JSX.Element {
  const range = findTimerRange(rangeMaxMs) ?? DEFAULT_TIMER_RANGE;
  const stepSeconds = range.stepMs / 1000;
  const [draft, setDraft] = useState<string | undefined>();
  const commit = (): void => {
    if (draft !== undefined && draft.trim() !== '' && Number.isFinite(Number(draft))) {
      onChange(
        snapPresetToStep(
          Math.min(range.maxMs, Math.max(range.stepMs, secondsToMs(Number(draft)))),
          range,
        ),
      );
    }
    setDraft(undefined);
  };
  return (
    <div className={styles.dial}>
      <span className={styles.toolLabel}>{label}</span>
      <input
        type="range"
        aria-label={`${label} ${JA.session.slider}`}
        min={stepSeconds}
        max={range.maxMs / 1000}
        step={stepSeconds}
        value={presetMs / 1000}
        onChange={(event) => {
          onChange(secondsToMs(Number(event.target.value)));
        }}
      />
      <input
        type="number"
        aria-label={`${label} ${JA.session.numberInput}`}
        min={stepSeconds}
        max={range.maxMs / 1000}
        step={stepSeconds}
        value={draft ?? String(presetMs / 1000)}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(undefined);
        }}
      />
      <span>{JA.session.seconds}</span>
    </div>
  );
}
