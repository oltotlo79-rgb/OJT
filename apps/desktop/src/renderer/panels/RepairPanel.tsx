import type { SocketId } from '@ojt/board-model';
import type { JSX } from 'react';
import { JA, mountedPartLabel } from '../i18n/ja.js';
import { focusDiagnosticTarget } from '../session/diagnostic-navigation.js';
import styles from './tester.module.css';

/** 装着済み部品1個（交換の対象）。 */
export interface MountedPartRow {
  socketId: SocketId;
  /** 役割ID（`CR1` 等）。指摘と部品交換はこのIDで指す。§6.4 */
  partId: string;
  isTimer: boolean;
  /** すでに交換済みか（§9.2）。交換済みならボタンを無効にし、二度押しで履歴を壊さない。 */
  replaced: boolean;
}

/**
 * モードC2の修復パネル。設計仕様 §9.2。
 *
 * 追加した白線と外した青線を**事実として**並べるだけで、「その削除は改造か」は出さない。
 * §9.2 が「削除の可否をその場で判定すると答えが漏れるため警告は出さず、判定時に
 * 『故障箇所でない青線を削除した本数』を改造として結果に計上する」と定めているためである。
 *
 * `addedWires` / `removedWires` は**表示用に組み立て済みの文言**（`CR1.9–PB1.2c の青線` 形式。
 * `wireLabel()`）を渡すこと。内部の電線ID（`w-001` / `sw-005`）をそのまま渡さない（UI監査 I5）。
 */
export function RepairPanel({
  addedWires,
  removedWires,
  mountedParts,
  onReplacePart,
}: {
  /** 追加した白線の表示名（電線IDではない。呼び出し側で `wireLabel()` を通す）。 */
  addedWires: readonly string[];
  /** 外した青線の表示名（電線IDではない。呼び出し側で `wireLabel()` を通す）。 */
  removedWires: readonly string[];
  mountedParts: readonly MountedPartRow[];
  onReplacePart: (socketId: SocketId, partId: string) => void;
}): JSX.Element {
  return (
    <section className={styles.panel} data-testid="repair-panel">
      <h2 className={styles.title}>{JA.inspectRepair.repair}</h2>
      <p className={styles.label}>{JA.inspectRepair.addedWires}</p>
      <p className={styles.reportTarget} data-testid="added-wires">
        {addedWires.length === 0
          ? JA.inspectRepair.none
          : addedWires.map((wireId) => (
              <button key={wireId} type="button" onClick={() => focusDiagnosticTarget({ wireId })}>
                {wireId}
              </button>
            ))}
      </p>
      <p className={styles.label}>{JA.inspectRepair.removedWires}</p>
      <p className={styles.reportTarget} data-testid="removed-wires">
        {removedWires.length === 0
          ? JA.inspectRepair.none
          : removedWires.map((wireId) => (
              <button key={wireId} type="button" onClick={() => focusDiagnosticTarget({ wireId })}>
                {wireId} の元の端子
              </button>
            ))}
      </p>
      <p className={styles.label}>{JA.inspectRepair.parts}</p>
      {mountedParts.map((part) => (
        <div key={part.partId} className={styles.trayRow}>
          <button
            type="button"
            className={styles.trayName}
            onClick={() => focusDiagnosticTarget({ partId: part.partId })}
          >
            {mountedPartLabel(part.partId, part.isTimer)} を表示
          </button>
          <button
            type="button"
            data-testid={`replace-${part.partId}`}
            disabled={part.replaced}
            onClick={() => {
              onReplacePart(part.socketId, part.partId);
            }}
          >
            {part.replaced ? JA.inspectRepair.replaced : JA.inspectRepair.replace}
          </button>
        </div>
      ))}
    </section>
  );
}
