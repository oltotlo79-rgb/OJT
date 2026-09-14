import {
  catalogEntry,
  mountedKinds,
  remainingInventory,
  SOCKET_IDS,
  type BoardSession,
  type MountableKind,
  type SocketId,
} from '@ojt/board-model';
import type { JSX } from 'react';
import { JA, mountedPartLabel, socketSelectedLabel, timerDialLabel } from '../i18n/ja.js';
import { TimerDial } from './TimerDial.js';
import styles from './panels.module.css';

/**
 * 部品パネル（在庫と装着状態）。設計仕様 §8.1 / §8.2。
 * ソケットを選んでから部品を押すと装着する（ドラッグの代替。§8.2 が「クリック → 部品選択」も認める）。
 */

/** 部品パネル。 */
export function PartsPanel({
  session,
  selectedSocket,
  onSelectSocket,
  onPlug,
  onUnplug,
  onPreset,
}: {
  session: BoardSession;
  selectedSocket: SocketId | undefined;
  onSelectSocket: (socketId: SocketId | undefined) => void;
  onPlug: (socketId: SocketId, kind: MountableKind) => void;
  onUnplug: (socketId: SocketId) => void;
  onPreset: (socketId: SocketId, presetMs: number) => void;
}): JSX.Element {
  const remaining = remainingInventory(session.inventory, mountedKinds(session));
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{JA.session.parts}</h2>
      {remaining.map((item) => {
        const entry = catalogEntry(item.kind);
        return (
          <div key={item.kind} className={styles.partRow}>
            <span className={styles.partName}>{entry.displayName}</span>
            <span>
              {JA.session.remaining} {item.count}
            </span>
            <button
              type="button"
              disabled={selectedSocket === undefined || item.count <= 0}
              onClick={() => {
                if (selectedSocket !== undefined) onPlug(selectedSocket, item.kind);
              }}
            >
              {JA.session.mount}
            </button>
          </div>
        );
      })}
      <p className={styles.problemText}>
        {selectedSocket === undefined
          ? JA.session.pickSocket
          : socketSelectedLabel(selectedSocket, session.socketRoles[selectedSocket])}
      </p>
      {SOCKET_IDS.map((socketId) => {
        const mounted = session.mounted[socketId];
        if (mounted === undefined) return null;
        const role = session.socketRoles[socketId];
        return (
          <div key={socketId} className={styles.mountedRow}>
            <span className={styles.partName}>
              {mountedPartLabel(role, mounted.kind === 'timer-h3y4')}
            </span>
            <button
              type="button"
              onClick={() => {
                onSelectSocket(socketId);
              }}
            >
              {JA.session.select}
            </button>
            <button
              type="button"
              onClick={() => {
                onUnplug(socketId);
              }}
            >
              {JA.session.unmount}
            </button>
          </div>
        );
      })}
      {SOCKET_IDS.map((socketId) => {
        const mounted = session.mounted[socketId];
        if (mounted === undefined || mounted.kind !== 'timer-h3y4') return null;
        return (
          <TimerDial
            key={`dial-${socketId}`}
            label={timerDialLabel(session.socketRoles[socketId])}
            presetMs={mounted.presetMs}
            rangeMaxMs={mounted.rangeMaxMs}
            onChange={(presetMs) => {
              onPreset(socketId, presetMs);
            }}
          />
        );
      })}
    </section>
  );
}
