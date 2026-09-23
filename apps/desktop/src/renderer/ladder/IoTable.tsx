import type { PlcUnitDefinition } from '@ojt/board-model';
import type { ResolvedPlcIo } from '@ojt/content';
import { X, Y } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { Fragment, type JSX, type ReactNode } from 'react';
import { JA } from '../i18n/ja.js';
import { useStore } from '../app/store.js';
import { focusIo } from '../session/plc-assignment.js';
import { focusWiring } from '../session/wire-edit.js';
import { IoAssignmentEditor } from './IoAssignmentEditor.js';
import { SidePanel } from './SidePanel.js';
import styles from './ladder.module.css';

/**
 * `PLC.100.02` のような端子名を「.」の直後だけで折り返せるようにする（UI監査バッチF
 * wrap 7件）。狭い列幅では `overflow-wrap: anywhere`（#27。表を列幅に収めるための指定）が
 * 数字の途中（`10` と `0.02` の間など）で折り返していた。`.` の直後に `<wbr>` を挟むと、
 * 折り返しが要る時も意味の区切り（`PLC.` / `100.` / `02`）でだけ割れる。
 */
function terminalNode(name: string): ReactNode {
  const parts = name.split('.');
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? '.' : ''}
      {part}
      {index < parts.length - 1 ? <wbr /> : null}
    </Fragment>
  ));
}

/**
 * I/O割付表。設計仕様 §7.6 / §10.2。
 *
 * 課題の固定割付、または学習者が編集した自由割付を出す。モニタ中は入力・出力の
 * 実測状態を添え、行から現物・ラダーを追跡できる。配線全体の合否は判定時に検査する。
 *
 * 「ラダーのデバイス名」は方言（`profile.formatDevice`）から、「PLC本体の端子名」は機種
 * （`unit.spec`）から引く。三菱では両方とも8進で一致するが、根拠が違う（決定表#16）。
 */
export function IoTable({
  io: specifiedIo,
  profile,
  unit,
}: {
  io: ResolvedPlcIo;
  profile: DialectProfile;
  unit: PlcUnitDefinition;
}): JSX.Element {
  const assignment = useStore((state) => state.session?.plcAssignment);
  const monitor = useStore((state) => state.plcMonitor);
  const supply = useStore((state) => state.snapshot.plcDebug?.supply);
  const io = specifiedIo.mode === 'free' && assignment !== undefined ? assignment : specifiedIo;
  /**
   * PLC本体の端子名。割付が機種の点数を超えて `unit.spec` に無いときは `undefined` を返し、
   * 呼び出し側が「—」＋注記行を出す（`?? ''` で `PLC.` だけを出していたのを直す。M3）。
   */
  const inputTerminal = (x: number): string | undefined => unit.spec.inputs[x]?.name;
  const outputTerminal = (y: number): string | undefined => unit.spec.outputs[y]?.name;
  const unknown =
    io.inputs.some((input) => inputTerminal(input.x) === undefined) ||
    io.outputs.some((output) => outputTerminal(output.y) === undefined);
  return (
    // 配線中はいつでも見たい表なので、折りたたみの既定は「開いた状態」（#27）
    <SidePanel title={JA.ladder.ioTable} testId="io-table" open>
      <p className={styles.sideNote} data-testid="io-mode">
        {io.mode === 'fixed' ? JA.ladder.ioFixed : JA.ladder.ioFree}
      </p>
      <p className={styles.sideNote} data-testid="io-wiring">
        {io.wiring === 'sink' ? JA.ladder.wiringSink : JA.ladder.wiringSource}
      </p>
      <table className={styles.ioTable}>
        {/* 決定表#7の静的な1行（判定データではないので常に出してよい）。Batch 4+5 レビュー B1 */}
        <caption className={styles.sideNote}>
          <span className={styles.ioCaptionLine} data-testid="io-outlet-note">
            {JA.plc.outletNote}
          </span>
          <span className={styles.ioCaptionLine} data-testid="io-common">
            {JA.ladder.ioCommon}: {unit.spec.inputCommons.map((name) => `PLC.${name}`).join('・')}
          </span>
        </caption>
        <thead>
          <tr>
            <th scope="col">{JA.ladder.ioDevice}</th>
            <th scope="col">{JA.ladder.ioTerminal}</th>
            <th scope="col">{JA.ladder.ioTarget}</th>
          </tr>
        </thead>
        <tbody>
          {io.inputs.map((input, index) => {
            const terminal = inputTerminal(input.x);
            return (
              <tr key={`in-${String(index)}`} data-testid={`io-input-${String(index)}`}>
                <td>
                  <button
                    type="button"
                    onClick={() =>
                      focusIo(X(input.x), [`PLC.${terminal ?? ''}`, `TB_PB.${input.pb.slice(2)}a`])
                    }
                  >
                    {profile.formatDevice(X(input.x))}{' '}
                    {monitor === undefined ? '—' : monitor.inputs[input.x] ? '● ON' : '○ OFF'}
                  </button>
                </td>
                <td>
                  {terminal === undefined
                    ? JA.ladder.ioTerminalUnknown
                    : terminalNode(`PLC.${terminal}`)}
                </td>
                <td>{input.pb}</td>
              </tr>
            );
          })}
          {io.outputs.map((output, index) => {
            const terminal = outputTerminal(output.y);
            return (
              <tr key={`out-${String(index)}`} data-testid={`io-output-${String(index)}`}>
                <td>
                  <button
                    type="button"
                    onClick={() =>
                      focusIo(Y(output.y), [
                        `PLC.${terminal ?? ''}`,
                        `${output.cr}.14`,
                        `TB_PL.${output.pl.slice(2)}+`,
                      ])
                    }
                  >
                    {profile.formatDevice(Y(output.y))}{' '}
                    {monitor === undefined ? '—' : monitor.outputs[output.y] ? '● ON' : '○ OFF'}
                  </button>
                </td>
                <td>
                  {terminal === undefined
                    ? JA.ladder.ioTerminalUnknown
                    : terminalNode(`PLC.${terminal}`)}
                </td>
                <td>
                  {output.cr} → {output.pl}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.sideNote}>
        デバイスを押すと端子・接続線・ラダーの使用箇所を表示します。値はモニタ中に更新されます。
      </p>
      {supply !== undefined && (
        <div role="status" data-testid="plc-supply-status" className={styles.sideNote}>
          {supply.ready ? (
            'PLC電源：接続正常'
          ) : (
            <details>
              <summary>電源の確認（{supply.issues.length}件）</summary>
              <p>PLC電源が正しく接続されていません。</p>
              {supply.issues.map((issue, index) => (
                <button type="button" key={index} onClick={() => focusWiring(issue.terminals)}>
                  {issue.message}（端子を表示）
                </button>
              ))}
            </details>
          )}
        </div>
      )}
      <IoAssignmentEditor io={io} profile={profile} unit={unit} />
      {unknown ? (
        <p className={styles.sideNote} data-testid="io-terminal-note">
          {JA.ladder.ioTerminalNote}
        </p>
      ) : null}
    </SidePanel>
  );
}
