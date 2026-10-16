import {
  FX5U_INPUT_OHMS,
  FX5U_OFF_AMPS,
  FX5U_ON_AMPS,
  type PlcUnitDefinition,
} from '@ojt/board-model';
import { C, M, SP, T, X, Y } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { useStore } from '../app/store.js';
import { plcProgramState } from '../session/plc-session.js';
import { writeLabel } from '../session/plc-write.js';
import { JA, onOffLabel, plcInputSpecText, secondsLabel } from '../i18n/ja.js';
import { shortcutKeyOf } from '../session/ladder.js';
import { monitorStartLabel } from '../session/plc-skin.js';
import { SidePanel } from './SidePanel.js';
import { onOffMark } from './WatchPanel.js';
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
  /** PLC に書き込んだプログラムとエディタの関係（v2.1.0 監査 P1）。 */
  const programState = useStore((s) => plcProgramState(s));
  const converted = useStore((s) => s.converted);
  /**
   * まだ変換していないときに添える「変換」のキー。「変換」を持たないスキン（`convertStep: false`）は
   * 編集すると自動で変換されるので添えない（決定表#3 / レビュー B1）。
   */
  const convertKey =
    profile.convertStep && !converted ? shortcutKeyOf(profile, 'convert') : undefined;
  const terminal = (name: string | undefined): string => `PLC.${name ?? ''}`;
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
        モニタが映すのは **PLC に書き込んだプログラム**の値（v2.1.0 監査 P1）。プログラムが無い
        うちはいつまで待っても Worker から `snapshot.plc` が来ないので、その旨と書込みの操作の
        名前（未変換なら変換のキーも）を出す。書込み済みでまだ1枚も届いていないときは
        RUN 待ちである旨を出す。
      */}
      {programState === 'none' ? (
        <p className={styles.sideNote} data-testid="monitor-no-program">
          {JA.ladder.monitorNoProgram(writeLabel(profile), convertKey)}
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
          {programState === 'stale' ? (
            <p className={styles.sideNote} data-testid="monitor-stale">
              {JA.ladder.monitorStale}
            </p>
          ) : null}
          <p className={styles.sideNote} data-testid="monitor-scan">
            {JA.ladder.scanCount}: {monitor.scanCount}（{secondsLabel(monitor.tMs)}）
          </p>
          {running ? null : (
            <p className={styles.sideNote} data-testid="monitor-stopped">
              {JA.ladder.monitorStopped}
            </p>
          )}
          {/*
            この表は**使えるデバイスを全部**並べる「デバイス一覧」である。利用者が選んだ
            デバイスだけを見たいときは、別の「監視」の欄を使う（Phase 7 設計 §5.5）。
            ON／OFF は色だけに頼らず ■／□ の形でも示す（指摘 UX-14 ≡ UI-17）。
          */}
          <table className={styles.ioTable} data-testid="device-list">
            <caption className={styles.sideNote}>{JA.ladder.deviceList}</caption>
            <tbody>
              {monitor.inputs.map((value, index) => (
                <tr key={`x-${String(index)}`} data-testid={`monitor-input-${String(index)}`}>
                  <td>{profile.formatDevice(X(index))}</td>
                  <td>{terminal(unit.spec.inputs[index]?.name)}</td>
                  <td>
                    {onOffMark(value)} {onOffLabel(value)}
                  </td>
                </tr>
              ))}
              {monitor.outputs.map((value, index) => (
                <tr key={`y-${String(index)}`} data-testid={`monitor-output-${String(index)}`}>
                  <td>{profile.formatDevice(Y(index))}</td>
                  <td>{terminal(unit.spec.outputs[index]?.name)}</td>
                  <td>
                    {onOffMark(value)} {onOffLabel(value)}
                  </td>
                </tr>
              ))}
              {Object.entries(monitor.internals).map(([index, value]) => (
                <tr key={`m-${index}`} data-testid={`monitor-internal-${index}`}>
                  <td>{profile.formatDevice(M(Number(index)))}</td>
                  <td />
                  <td>
                    {onOffMark(value)} {onOffLabel(value)}
                  </td>
                </tr>
              ))}
              {Object.entries(monitor.specials ?? {})
                .filter(([index]) => !profile.specialInverted?.includes(Number(index)))
                .map(([index, value]) => (
                  <tr key={`sp-${index}`} data-testid={`monitor-special-${index}`}>
                    <td>{profile.formatDevice(SP(Number(index)))}</td>
                    <td>特殊接点</td>
                    <td>
                      {onOffMark(value)} {onOffLabel(value)}
                    </td>
                  </tr>
                ))}
              {Object.entries(monitor.timers).map(([index, state]) => (
                <tr key={`t-${index}`} data-testid={`monitor-timer-${index}`}>
                  <td>{profile.formatDevice(T(Number(index)))}</td>
                  {/* 経過 / 設定（Batch 3 レビュー M4） */}
                  <td>
                    {secondsLabel(state.elapsedMs)} / {secondsLabel(state.presetMs)}
                  </td>
                  <td>
                    {onOffMark(state.on)} {onOffLabel(state.on)}
                  </td>
                </tr>
              ))}
              {Object.entries(monitor.counters).map(([index, state]) => (
                <tr key={`c-${index}`} data-testid={`monitor-counter-${index}`}>
                  <td>{profile.formatDevice(C(Number(index)))}</td>
                  <td>{state.value}</td>
                  <td>
                    {onOffMark(state.on)} {onOffLabel(state.on)}
                  </td>
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
