import type { PlcUnitDefinition } from '@ojt/board-model';
import type { ResolvedPlcIo } from '@ojt/content';
import { X, Y } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
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
  return (
    <section className={styles.side} aria-label={JA.ladder.ioTable} data-testid="io-table">
      <h2 className={styles.sideTitle}>{JA.ladder.ioTable}</h2>
      <p className={styles.sideNote} data-testid="io-mode">
        {io.mode === 'fixed' ? JA.ladder.ioFixed : JA.ladder.ioFree}
      </p>
      <p className={styles.sideNote} data-testid="io-wiring">
        {io.wiring === 'sink' ? JA.ladder.wiringSink : JA.ladder.wiringSource}
      </p>
      <table className={styles.ioTable}>
        <thead>
          <tr>
            <th>{JA.ladder.ioDevice}</th>
            <th>{JA.ladder.ioTerminal}</th>
            <th>{JA.ladder.ioTarget}</th>
          </tr>
        </thead>
        <tbody>
          {io.inputs.map((input, index) => (
            <tr key={`in-${String(index)}`} data-testid={`io-input-${String(index)}`}>
              <td>{profile.formatDevice(X(input.x))}</td>
              <td>{`PLC.${unit.spec.inputs[input.x] ?? ''}`}</td>
              <td>{input.pb}</td>
            </tr>
          ))}
          {io.outputs.map((output, index) => (
            <tr key={`out-${String(index)}`} data-testid={`io-output-${String(index)}`}>
              <td>{profile.formatDevice(Y(output.y))}</td>
              <td>{`PLC.${unit.spec.outputs[output.y]?.name ?? ''}`}</td>
              <td>
                {output.cr} → {output.pl}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
