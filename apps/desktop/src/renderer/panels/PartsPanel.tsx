import {
  catalogEntry,
  mountedKinds,
  remainingInventory,
  SOCKET_IDS,
  type BoardSession,
  type MountableKind,
  type MountedPart,
  type SocketId,
} from '@ojt/board-model';
import { useEffect, useState, type JSX } from 'react';
import {
  JA,
  JA_PARTS,
  mountedPartLabel,
  socketCardTitle,
  socketSelectedLabel,
  timerDialLabel,
} from '../i18n/ja.js';
import { SocketPinout } from './SocketPinout.js';
import { TimerDial } from './TimerDial.js';
import styles from './panels.module.css';

/**
 * 部品パネル（在庫と装着状態）。設計仕様 §8.1 / §8.2。
 *
 * 利用者要望 2026-09-19「リレーやタイマはソケットから外して入れ替えたりできるようにすること」
 * 「分かりやすく直感的に操作できるUI、UXにしてね」を受け、**選んだソケット1個のカード**を
 * パネルの先頭に出す形にした（UXレビュー指摘: 取り外しに気付けない／装着ボタンが理由も無く
 * 押せない）。カードが持つ状態は3つだけである。
 *
 * - 何も選んでいない → 何をすればよいかの一文だけ出す（`JA_PARTS.hint`）
 * - 空きソケット     → 在庫の一覧と「装着」
 * - 装着済み         → 「取り外す」と「交換…」。交換を押すと在庫の一覧に変わる
 *
 * 押せないボタンには必ず理由を添え、`aria-describedby` でボタンから指す（キーボードと
 * スクリーンリーダの利用者にも理由が届く）。
 *
 * 通電中の抜き差しは**エンジンが禁じていない**（`board-model` の `unplug()` は空きソケットしか
 * 断らず、`circuit-sim` の `unmountPart()` も危険操作を発行しない）。仕様どおり操作は通し、
 * 実機の手順（§5.3.5）を思い出せる注意書きだけ出す。
 */

/** ボタンを押せない理由（無ければ押せる）。 */
type Reason = string | undefined;

/** 「交換できない」理由を指すID（ボタンの `aria-describedby` と注記の `id` で共有する）。 */
const SWAP_REASON_ID = 'parts-reason-swap';

/** 装着済み部品の種別（空きソケットは undefined）。 */
function kindOf(mounted: MountedPart | undefined): MountableKind | undefined {
  return mounted?.kind;
}

/**
 * 交換先に選べる部品と残数。
 * いま挿さっている部品は抜いた時点で在庫に戻るので、その1個を足して数える
 * （足さないと「リレーを別のリレーに挿し替える」が在庫切れに見えてしまう）。
 */
function swapCandidates(
  session: BoardSession,
  mounted: MountedPart | undefined,
): { kind: MountableKind; count: number }[] {
  const current = kindOf(mounted);
  return remainingInventory(session.inventory, mountedKinds(session)).map((item) => ({
    kind: item.kind,
    count: item.count + (item.kind === current ? 1 : 0),
  }));
}

/** 在庫1行（装着と交換で同じ行を使う）。残数0なら理由を添えて押せなくする。 */
function PartRow({
  kind,
  count,
  actionLabel,
  testId,
  onAction,
}: {
  kind: MountableKind;
  count: number;
  actionLabel: string;
  testId: string;
  onAction: () => void;
}): JSX.Element {
  const entry = catalogEntry(kind);
  const reason: Reason = count <= 0 ? JA_PARTS.noStockReason : undefined;
  const reasonId = `parts-reason-${testId}`;
  return (
    <div className={styles.partRow}>
      <span className={styles.partName}>{entry.displayName}</span>
      <span>
        {JA.session.remaining} {count}
      </span>
      <button
        type="button"
        data-testid={testId}
        disabled={reason !== undefined}
        {...(reason === undefined ? {} : { 'aria-describedby': reasonId })}
        onClick={onAction}
      >
        {actionLabel}
      </button>
      {reason === undefined ? null : (
        <p className={styles.partReason} id={reasonId} data-testid={reasonId}>
          {reason}
        </p>
      )}
    </div>
  );
}

/** 部品パネル。 */
export function PartsPanel({
  session,
  selectedSocket,
  powered,
  onSelectSocket,
  onPlug,
  onUnplug,
  onSwap,
  onPreset,
}: {
  session: BoardSession;
  selectedSocket: SocketId | undefined;
  /** 通電中か（注意書きを出すためだけに使う。操作は止めない）。§5.3.5 */
  powered: boolean;
  onSelectSocket: (socketId: SocketId | undefined) => void;
  onPlug: (socketId: SocketId, kind: MountableKind) => void;
  onUnplug: (socketId: SocketId) => void;
  /** 取り外して別の部品を挿し直す（履歴は1手）。§8.2 */
  onSwap: (socketId: SocketId, kind: MountableKind) => void;
  onPreset: (socketId: SocketId, presetMs: number) => void;
}): JSX.Element {
  /** 「交換…」を押して交換先を選んでいる最中か。別のソケットへ移ったら畳む。 */
  const [swapping, setSwapping] = useState(false);
  useEffect(() => {
    setSwapping(false);
  }, [selectedSocket]);

  const mounted = selectedSocket === undefined ? undefined : session.mounted[selectedSocket];
  const remaining = remainingInventory(session.inventory, mountedKinds(session));
  const candidates = swapCandidates(session, mounted);
  const swapReason: Reason = candidates.every((item) => item.count <= 0)
    ? JA_PARTS.noSwapReason
    : undefined;

  return (
    <section className={styles.panel} data-testid="parts-panel">
      <h2 className={styles.panelTitle}>{JA.session.parts}</h2>

      {selectedSocket === undefined ? (
        <p className={styles.partsHint} data-testid="parts-hint">
          {JA_PARTS.hint}
        </p>
      ) : (
        <div className={styles.socketCard} data-testid="socket-card">
          <h3 className={styles.socketCardTitle} data-testid="socket-card-title">
            {socketCardTitle(selectedSocket, session.socketRoles[selectedSocket], kindOf(mounted))}
          </h3>
          {/* どのソケットを触っているかの控え（E2E もこの一文で選択を確かめている） */}
          <p className={styles.socketCardStatus} data-testid="socket-card-status">
            {socketSelectedLabel(selectedSocket, session.socketRoles[selectedSocket])}
          </p>

          {/*
           * ピン配列の凡例（利用者要望 2026-09-20「各番号はどこが何かわからない」）。
           * ソケット名のすぐ下に置く。どのソケットも同じ14ピンなので図は共通で、
           * 装着・取り外し・交換のボタンとは縦に並ぶだけで重ならない。
           */}
          <SocketPinout />

          {mounted === undefined ? (
            remaining.map((item) => (
              <PartRow
                key={item.kind}
                kind={item.kind}
                count={item.count}
                actionLabel={JA.session.mount}
                testId={`mount-${item.kind}`}
                onAction={() => {
                  onPlug(selectedSocket, item.kind);
                }}
              />
            ))
          ) : swapping ? (
            <>
              <p className={styles.socketCardStatus}>{JA_PARTS.swapPrompt}</p>
              {candidates.map((item) => (
                <PartRow
                  key={item.kind}
                  kind={item.kind}
                  count={item.count}
                  actionLabel={JA_PARTS.swapTo}
                  testId={`swap-${item.kind}`}
                  onAction={() => {
                    setSwapping(false);
                    onSwap(selectedSocket, item.kind);
                  }}
                />
              ))}
              {mounted.kind === 'timer-h3y4' ? (
                <p className={styles.partReason}>{JA_PARTS.timerResetNote}</p>
              ) : null}
              <div className={styles.cardActions}>
                <button
                  type="button"
                  data-testid="swap-cancel"
                  onClick={() => {
                    setSwapping(false);
                  }}
                >
                  {JA_PARTS.swapCancel}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  data-testid="card-unmount"
                  onClick={() => {
                    onUnplug(selectedSocket);
                  }}
                >
                  {JA.session.unmount}
                </button>
                <button
                  type="button"
                  data-testid="card-swap"
                  disabled={swapReason !== undefined}
                  {...(swapReason === undefined ? {} : { 'aria-describedby': SWAP_REASON_ID })}
                  onClick={() => {
                    setSwapping(true);
                  }}
                >
                  {JA_PARTS.swap}
                </button>
              </div>
              {swapReason === undefined ? null : (
                <p className={styles.partReason} id={SWAP_REASON_ID} data-testid={SWAP_REASON_ID}>
                  {swapReason}
                </p>
              )}
            </>
          )}

          {powered ? (
            <p className={styles.partReason} data-testid="parts-live-note">
              {JA_PARTS.liveNote}
            </p>
          ) : null}
        </div>
      )}

      {/* 装着済みの索引（どのソケットに何が載っているか。押すとカードがそのソケットへ移る） */}
      {SOCKET_IDS.map((socketId) => {
        const part = session.mounted[socketId];
        if (part === undefined) return null;
        const role = session.socketRoles[socketId];
        return (
          <div key={socketId} className={styles.mountedRow}>
            <span className={styles.partName}>
              {mountedPartLabel(role, part.kind === 'timer-h3y4')}
            </span>
            <button
              type="button"
              data-testid={`select-${socketId}`}
              aria-pressed={selectedSocket === socketId}
              onClick={() => {
                onSelectSocket(socketId);
              }}
            >
              {JA.session.select}
            </button>
          </div>
        );
      })}

      {SOCKET_IDS.map((socketId) => {
        const part = session.mounted[socketId];
        if (part === undefined || part.kind !== 'timer-h3y4') return null;
        return (
          <TimerDial
            key={`dial-${socketId}`}
            label={timerDialLabel(session.socketRoles[socketId])}
            presetMs={part.presetMs}
            rangeMaxMs={part.rangeMaxMs}
            onChange={(presetMs) => {
              onPreset(socketId, presetMs);
            }}
          />
        );
      })}
    </section>
  );
}
