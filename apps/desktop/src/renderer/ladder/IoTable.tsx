import type { PlcUnitDefinition } from '@ojt/board-model';
import type { ResolvedPlcIo } from '@ojt/content';
import { X, Y } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { SidePanel } from './SidePanel.js';
import styles from './ladder.module.css';

/**
 * I/O割付表。設計仕様 §7.6 / §10.2。
 *
 * **課題が与えた割付だけ**を出す。いまの配線がその割付どおりかどうかは**出さない**
 * （`ioAssignment` / `twoStage` は判定時の静的チェックで、セッション中に漏らすと
 *  §16 Phase 3 の受入基準④⑤が体験として成立しない。決定表#7）。
 *
 * 「ラダーのデバイス名」は方言（`profile.formatDevice`）から、「PLC本体の端子名」は機種
 * （`unit.spec`）から引く。三菱では両方とも8進で一致するが、根拠が違う（決定表#16）。
 */
export function IoTable({
  io,
  profile,
  unit,
}: {
  io: ResolvedPlcIo;
  profile: DialectProfile;
  unit: PlcUnitDefinition;
}): JSX.Element {
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
        <caption className={styles.sideNote} data-testid="io-outlet-note">
          {JA.plc.outletNote}
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
                <td>{profile.formatDevice(X(input.x))}</td>
                <td>{terminal === undefined ? JA.ladder.ioTerminalUnknown : `PLC.${terminal}`}</td>
                <td>{input.pb}</td>
              </tr>
            );
          })}
          {io.outputs.map((output, index) => {
            const terminal = outputTerminal(output.y);
            return (
              <tr key={`out-${String(index)}`} data-testid={`io-output-${String(index)}`}>
                <td>{profile.formatDevice(Y(output.y))}</td>
                <td>{terminal === undefined ? JA.ladder.ioTerminalUnknown : `PLC.${terminal}`}</td>
                <td>
                  {output.cr} → {output.pl}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {unknown ? (
        <p className={styles.sideNote} data-testid="io-terminal-note">
          {JA.ladder.ioTerminalNote}
        </p>
      ) : null}
    </SidePanel>
  );
}
