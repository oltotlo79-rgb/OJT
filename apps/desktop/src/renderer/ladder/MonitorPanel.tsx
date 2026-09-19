import {
  FX5U_INPUT_OHMS,
  FX5U_OFF_AMPS,
  FX5U_ON_AMPS,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { C, M, T, X, Y } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { useStore } from '../app/store.js';
import { JA, onOffLabel, plcInputSpecText, secondsLabel } from '../i18n/ja.js';
import { shortcutKeyOf } from '../session/ladder.js';
import styles from './ladder.module.css';

/**
 * モニタのデバイス一覧と RUN/STOP。設計仕様 §10.6 / §10.7。
 *
 * **`plcMonitor` を購読するのはこの部品と `LadderGrid` だけ**にする（決定表#5）。セッション画面の
 * 本体や3Dがこれを購読すると、毎秒30枚のスナップショットで盤ごと再描画されてしまう（§15）。
 */
export function MonitorPanel({
  profile,
  unit,
  onPlc,
}: {
  profile: DialectProfile;
  unit: PlcUnitDefinition;
  onPlc: (action: PlcCommandAction) => void;
}): JSX.Element {
  const monitor = useStore((s) => s.plcMonitor);
  const running = useStore((s) => s.plcRunning);
  const converted = useStore((s) => s.converted);
  const terminal = (name: string | undefined): string => `PLC.${name ?? ''}`;
  return (
    <section className={styles.side} aria-label={JA.ladder.monitor} data-testid="monitor-panel">
      <h2 className={styles.sideTitle}>{JA.ladder.monitor}</h2>
      <div className={styles.monitorButtons}>
        {/*
          RUN/STOP の正はツールバー（Task 12 の `extraTools`。決定表#9b）。ここは同じ状態を映す
          控えなので `data-testid` を分ける（同じ画面に `plc-run` が2つあると Testing Library も
          Playwright も曖昧になる。レビュー指摘 B5）。
        */}
        <button
          type="button"
          data-testid="monitor-run"
          // ラベルが RUN⇄STOP に切り替わるので `aria-pressed` は不要（Batch 3 レビュー M5）
          onClick={() => {
            const next = !useStore.getState().plcRunning;
            useStore.getState().setPlcRunning(next);
            onPlc({ kind: 'run', on: next });
          }}
        >
          {running ? JA.ladder.stop : JA.ladder.run}
        </button>
        <button
          type="button"
          data-testid="plc-reset"
          onClick={() => {
            onPlc({ kind: 'reset' });
          }}
        >
          {JA.ladder.plcReset}
        </button>
      </div>
      {/*
        「モニタが動いていない」理由を2通りに分ける（Batch 3 レビュー I3）。
        変換前はいつまで待っても Worker から `snapshot.plc` が来ないので、未変換のときは
        その旨を、変換済みでまだ1枚も届いていないときは RUN 待ちである旨を出す。
      */}
      {!converted ? (
        <p className={styles.sideNote} data-testid="monitor-not-converted">
          {JA.ladder.monitorNotConverted(shortcutKeyOf(profile, 'convert') ?? 'F4')}
        </p>
      ) : monitor === undefined ? (
        <p className={styles.sideNote} data-testid="monitor-no-snapshot">
          {JA.ladder.monitorNoSnapshot}
        </p>
      ) : (
        <>
          <p className={styles.sideNote} data-testid="monitor-scan">
            {JA.ladder.scanCount}: {monitor.scanCount}（{secondsLabel(monitor.tMs)}）
          </p>
          {running ? null : (
            <p className={styles.sideNote} data-testid="monitor-stopped">
              {JA.ladder.monitorStopped}
            </p>
          )}
          <table className={styles.ioTable}>
            <tbody>
              {monitor.inputs.map((value, index) => (
                <tr key={`x-${String(index)}`} data-testid={`monitor-input-${String(index)}`}>
                  <td>{profile.formatDevice(X(index))}</td>
                  <td>{terminal(unit.spec.inputs[index])}</td>
                  <td>{onOffLabel(value)}</td>
                </tr>
              ))}
              {monitor.outputs.map((value, index) => (
                <tr key={`y-${String(index)}`} data-testid={`monitor-output-${String(index)}`}>
                  <td>{profile.formatDevice(Y(index))}</td>
                  <td>{terminal(unit.spec.outputs[index]?.name)}</td>
                  <td>{onOffLabel(value)}</td>
                </tr>
              ))}
              {Object.entries(monitor.internals).map(([index, value]) => (
                <tr key={`m-${index}`} data-testid={`monitor-internal-${index}`}>
                  <td>{profile.formatDevice(M(Number(index)))}</td>
                  <td />
                  <td>{onOffLabel(value)}</td>
                </tr>
              ))}
              {Object.entries(monitor.timers).map(([index, state]) => (
                <tr key={`t-${index}`} data-testid={`monitor-timer-${index}`}>
                  <td>{profile.formatDevice(T(Number(index)))}</td>
                  {/* 経過 / 設定（Batch 3 レビュー M4） */}
                  <td>
                    {secondsLabel(state.elapsedMs)} / {secondsLabel(state.presetMs)}
                  </td>
                  <td>{onOffLabel(state.on)}</td>
                </tr>
              ))}
              {Object.entries(monitor.counters).map(([index, state]) => (
                <tr key={`c-${index}`} data-testid={`monitor-counter-${index}`}>
                  <td>{profile.formatDevice(C(Number(index)))}</td>
                  <td>{state.value}</td>
                  <td>{onOffLabel(state.on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.sideNote} data-testid="monitor-spec">
            {plcInputSpecText(FX5U_INPUT_OHMS, FX5U_ON_AMPS, FX5U_OFF_AMPS)}
          </p>
        </>
      )}
    </section>
  );
}
