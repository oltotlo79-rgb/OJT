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
import { monitorStartLabel } from '../session/plc-skin.js';
import { SidePanel } from './SidePanel.js';
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
  const mode = useStore((s) => s.ladderMode);
  const running = useStore((s) => s.plcRunning);
  const converted = useStore((s) => s.converted);
  const terminal = (name: string | undefined): string => `PLC.${name ?? ''}`;
  /** 「変換」のキー。無いスキン（`convertStep: false`）では `undefined`。決定表#3 */
  const convertKey = shortcutKeyOf(profile, 'convert');
  return (
    // RUN/STOP とデバイスの状態は作業中いつでも見たいので、既定は開いた状態（#27）
    <SidePanel title={JA.ladder.monitor} testId="monitor-panel" open>
      <div className={styles.monitorButtons}>
        {/*
          RUN/STOP はここには置かない（UI監査 2026-09-20 Important #9）。ツールバー・
          スキンのツールバー・このパネルの3か所に同じ操作があった。正はスキンの
          ツールバー（実物のPLCソフトの操作系）1つだけにする。RUN 中かどうかは下の
          デバイス一覧の見出し（`monitor-stopped` など）でここでも読める。
        */}
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
          {/*
            「変換」を持たないメーカーでは押す場所が無いので、変換キーを名乗らずに自動で変換される
            旨を出す（`OutputWindow` の `convert-state` と同じ分岐。レビュー B1）。
          */}
          {convertKey === undefined
            ? JA.ladder.notConvertedAuto
            : JA.ladder.monitorNotConverted(convertKey)}
        </p>
      ) : monitor === undefined ? (
        <p className={styles.sideNote} data-testid="monitor-no-snapshot">
          {/*
            変換済みでまだ1枚も届いていない理由は2つある。モニタを始めていない（`plcMonitor` は
            モニタ中しか載らない。決定表#5）か、始めたが PLC が停止しているか。キーは方言から
            渡す（Plan 4B Task 3。前提#22）。
          */}
          {mode === 'monitor'
            ? JA.ladder.monitorNoSnapshot
            : /* 指摘 LE-7: `?? 'F3'` は4方言に無いキーを教えていた。ツールバー項目名へ倒す */
              JA.ladder.monitorOff(monitorStartLabel(profile))}
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
                  <td>{terminal(unit.spec.inputs[index]?.name)}</td>
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
    </SidePanel>
  );
}
