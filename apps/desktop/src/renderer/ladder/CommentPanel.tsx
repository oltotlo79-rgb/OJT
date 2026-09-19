import { deviceLabel, type Cell, type Device, type LadderProgram } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { useMemo, type JSX } from 'react';
import { DEVICE_COMMENT_COUNT_LIMIT, DEVICE_COMMENT_LIMIT } from '../app/store.js';
import { commentCapText, JA } from '../i18n/ja.js';
import styles from './ladder.module.css';

/**
 * デバイスコメント欄。設計仕様 §10.7。
 * キーは**ベンダー中立の表示名**（`deviceLabel()` が返す `X0` / `M1`）で、画面に出すときだけ
 * 方言表記（`profile.formatDevice()`）に直す。作業ファイルにもこの形のまま入る（3A 引渡し表）。
 */

/** セルが参照するデバイスを集める。 */
function devicesOf(program: LadderProgram): Device[] {
  const seen = new Map<string, Device>();
  const add = (device: Device): void => {
    const key = deviceLabel(device);
    if (!seen.has(key)) seen.set(key, device);
  };
  const visit = (cell: Cell): void => {
    if ('device' in cell) add(cell.device);
    if (cell.kind === 'counter') add(cell.resetDevice);
  };
  for (const net of program.networks)
    for (const row of net.cells) for (const cell of row) visit(cell);
  return [...seen.values()];
}

/** デバイスコメント欄。 */
export function CommentPanel({
  program,
  profile,
  comments,
  onChange,
}: {
  program: LadderProgram;
  profile: DialectProfile;
  comments: Record<string, string>;
  /**
   * 呼び出し元が `store.setDeviceComment()` の戻り値をそのまま返す想定。`false`（上限で弾かれた）
   * のときは本パネルがトーストを出す（Batch 1 レビュー M4）。
   */
  onChange: (device: string, text: string) => boolean | void;
}): JSX.Element {
  const capId = 'comment-cap';
  const rows = useMemo(
    () =>
      devicesOf(program)
        .map((device) => ({ key: deviceLabel(device), text: profile.formatDevice(device) }))
        .sort((a, b) => a.text.localeCompare(b.text, 'ja')),
    [program, profile],
  );
  const full = Object.keys(comments).length >= DEVICE_COMMENT_COUNT_LIMIT;
  return (
    <section className={styles.side} aria-label={JA.ladder.comments} data-testid="comment-panel">
      <h2 className={styles.sideTitle}>{JA.ladder.comments}</h2>
      {full ? (
        <p className={styles.sideNote} id={capId} data-testid="comment-cap">
          {commentCapText(DEVICE_COMMENT_COUNT_LIMIT)}
        </p>
      ) : null}
      {rows.length === 0 ? <p className={styles.sideNote}>{JA.ladder.noDevices}</p> : null}
      <ul className={styles.commentList}>
        {rows.map((row) => {
          const disabled = full && comments[row.key] === undefined;
          return (
            <li key={row.key} data-testid={`comment-${row.key}`}>
              <span className={styles.commentDevice}>{row.text}</span>
              <input
                data-testid={`comment-input-${row.key}`}
                aria-label={`${row.text} ${JA.ladder.comment}`}
                // 上限に達して入力欄を disabled にしているときだけ、理由（`comment-cap`）を
                // 読み上げに繋ぐ（M8）。上限のトーストは `full`/`disabled` と同じ判定を重ねても
                // 押せない入力欄には決して届かないので出さない（Batch 3 レビュー M1）
                aria-describedby={disabled ? capId : undefined}
                maxLength={DEVICE_COMMENT_LIMIT}
                value={comments[row.key] ?? ''}
                disabled={disabled}
                onChange={(event) => {
                  onChange(row.key, event.target.value);
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
