import { CollapsiblePanel } from './CollapsiblePanel.js';
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
import type { DragPayload } from '../session/interaction.js';
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
 * - 何も選んでいない → **ソケット一覧のボタン**（指摘 UX-08。以前は文章だけだった）
 * - 空きソケット     → 在庫の一覧と「装着」
 * - 装着済み         → 「取り外す」と「交換…」。交換を押すと在庫の一覧に変わる
 *
 * **2026-09-20（Phase 7 Task 27 / 指摘 UX-08 / 利用者要望9）**: パネルの先頭を**パレット**に
 * した。在庫をカードで並べ、`pointerdown` でつまむと3D盤の空きソケットが光り、その上で放すと
 * 装着される（運搬そのものは `BoardScene` と `store.dragging` が受け持つ）。カードを
 * **押すだけ**でも選べるので、キーボードだけの利用者は「カード → ソケット」の2回押しで装着できる
 * （§15 のアクセシビリティ: 既存の経路は1つも消さない）。
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

/**
 * つまんで運んでいる部品のゴースト（半透明の付箋）。Phase 7 設計 §7.3.3。
 * 3Dのキャンバスの上にも出したいので `position: fixed` で画面の最前面に置き、
 * ポインタのイベントは一切受けない（下のソケットのホバーを奪わない）。
 */
export function DragGhost({ dragging }: { dragging: DragPayload | undefined }): JSX.Element | null {
  const [point, setPoint] = useState<{ x: number; y: number } | undefined>(undefined);
  useEffect(() => {
    if (dragging === undefined) {
      setPoint(undefined);
      return undefined;
    }
    const onMove = (event: PointerEvent): void => {
      setPoint({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
    };
  }, [dragging]);
  if (dragging === undefined || point === undefined) return null;
  return (
    <div
      className={styles.dragGhost}
      data-testid="drag-ghost"
      aria-hidden="true"
      style={{ left: `${String(point.x)}px`, top: `${String(point.y)}px` }}
    >
      {catalogEntry(dragging.kind).displayName}
    </div>
  );
}

/**
 * 在庫のパレット（つまんで運べるカード）。指摘 UX-08 / Phase 7 設計 §7.3.3。
 * 残数0のカードは `aria-disabled` にして**理由を添える**（押せないのに理由が無い、を作らない）。
 */
function Palette({
  items,
  carrying,
  onCarry,
}: {
  items: ReadonlyArray<{ kind: MountableKind; count: number }>;
  carrying: MountableKind | undefined;
  onCarry: (kind: MountableKind) => void;
}): JSX.Element {
  return (
    <div className={styles.palette} data-testid="parts-palette">
      <p className={styles.paletteTitle}>{JA_PARTS.paletteTitle}</p>
      <div className={styles.paletteCards}>
        {items.map((item) => {
          const entry = catalogEntry(item.kind);
          const empty = item.count <= 0;
          return (
            <button
              key={item.kind}
              type="button"
              className={styles.paletteCard}
              data-testid={`palette-${item.kind}`}
              aria-disabled={empty}
              aria-pressed={carrying === item.kind}
              title={empty ? JA_PARTS.paletteEmptyReason : entry.displayName}
              onPointerDown={() => {
                if (!empty) onCarry(item.kind);
              }}
              onClick={() => {
                // キーボード（Enter / Space）でも同じ「つまむ」に入れる
                if (!empty) onCarry(item.kind);
              }}
            >
              <span className={styles.partName}>{entry.displayName}</span>
              <span className={styles.paletteCount}>
                {JA.session.remaining} {item.count}
              </span>
              {empty ? (
                <span className={styles.partReason}>{JA_PARTS.paletteEmptyReason}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className={styles.partsHint} data-testid="parts-hint">
        {JA_PARTS.paletteHint}
      </p>
    </div>
  );
}

/**
 * ソケット一覧のボタン（指摘 UX-08）。以前はここが**文章だけ**で、最初の一手の入口が
 * 3Dの当たり判定頼みだった。押すと3Dのクリックと同じ `onSelectSocket` が走る。
 */
function SocketList({
  session,
  selectedSocket,
  onSelectSocket,
}: {
  session: BoardSession;
  selectedSocket: SocketId | undefined;
  onSelectSocket: (socketId: SocketId | undefined) => void;
}): JSX.Element {
  return (
    <div className={styles.socketList} data-testid="socket-list">
      <p className={styles.paletteTitle}>{JA_PARTS.socketListTitle}</p>
      <div className={styles.socketListButtons}>
        {SOCKET_IDS.map((socketId) => {
          const role = session.socketRoles[socketId];
          const part = session.mounted[socketId];
          return (
            <button
              key={socketId}
              type="button"
              className={styles.socketListButton}
              data-testid={`socket-list-${socketId}`}
              aria-pressed={selectedSocket === socketId}
              onClick={() => {
                onSelectSocket(socketId);
              }}
            >
              <span className={styles.socketListName}>
                {socketId}
                {role === undefined ? '' : `（${role}）`}
              </span>
              <span className={styles.socketListState}>
                {part === undefined
                  ? JA_PARTS.socketListEmpty
                  : catalogEntry(part.kind).displayName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 部品パネル。 */
export function PartsPanel({
  session,
  selectedSocket,
  powered,
  carrying,
  onCarry,
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
  /** いまつまんでいる部品（パレットのカードの押下状態に出す）。Phase 7 設計 §7.3.3 */
  carrying?: MountableKind | undefined;
  /**
   * カードをつまんだ（運搬を始める）。**渡さない画面ではパレットを出さない**
   * （運べないのにカードだけ並ぶ「押しても何も起きない」を作らないため）。
   * モードD（`PlcSession`）は盤の部品を入れ替えないので渡していない。
   */
  onCarry?: ((kind: MountableKind) => void) | undefined;
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
    <CollapsiblePanel
      title={JA.session.parts}
      testId="parts-panel"
      summary={JA_PARTS.socketListTitle}
      open
      openKey={selectedSocket}
    >
      {/* 在庫のパレット（つまんで盤へ運ぶ／押して選ぶ）。Phase 7 Task 27 */}
      {onCarry === undefined ? null : (
        <Palette items={remaining} carrying={carrying} onCarry={onCarry} />
      )}

      {selectedSocket === undefined ? (
        <SocketList
          session={session}
          selectedSocket={selectedSocket}
          onSelectSocket={onSelectSocket}
        />
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
              {JA.session.selection}
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
    </CollapsiblePanel>
  );
}
