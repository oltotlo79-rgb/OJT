import type { BoardDefinition, BoardSession } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { useMemo, useState, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import type { PickHit } from '../session/interaction.js';
import { terminalRows, type TerminalRow } from '../session/terminal-list.js';
import styles from './panels.module.css';

/**
 * 端子リスト（キーボードで配線する）。UXレビュー #29 / Plan 5 決定表#12。
 * 選ぶと `PickHit`（`kind: 'terminal'`）を親へ渡すだけで、**配線の規則は
 * `pickToAction()`（`session/interaction.ts`）がそのまま受け持つ**。
 */

/** まとまりごとに並べ替える（部品IDの出現順）。 */
function byGroup(rows: readonly TerminalRow[]): Array<{ group: string; rows: TerminalRow[] }> {
  const out: Array<{ group: string; rows: TerminalRow[] }> = [];
  for (const row of rows) {
    const found = out.find((g) => g.group === row.group);
    if (found === undefined) out.push({ group: row.group, rows: [row] });
    else found.rows.push(row);
  }
  return out;
}

/** 端子リストのパネル。 */
export function TerminalListPanel({
  board,
  session,
  pendingTerminal,
  onPick,
  onCancel,
}: {
  board: BoardDefinition;
  session: BoardSession;
  /** 配線1本目に選んだ端子（`store.pendingTerminal`）。 */
  pendingTerminal: TerminalId | undefined;
  onPick: (hit: PickHit) => void;
  onCancel: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => terminalRows(board, session, query), [board, session, query]);
  return (
    <section className={styles.terminalList} data-testid="terminal-list">
      <h2 className={styles.panelTitle}>{JA.terminalList.title}</h2>
      <p className={styles.terminalHint}>{JA.terminalList.hint}</p>
      <input
        type="search"
        className={styles.terminalSearch}
        data-testid="terminal-search"
        aria-label={JA.terminalList.search}
        placeholder={JA.terminalList.search}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {pendingTerminal === undefined ? null : (
        <p className={styles.terminalPending} data-testid="terminal-pending">
          {JA.terminalList.pending}: {pendingTerminal}
          <button type="button" data-testid="terminal-cancel" onClick={onCancel}>
            {JA.terminalList.cancel}
          </button>
        </p>
      )}
      <div className={styles.terminalGroups}>
        {byGroup(rows).map((group) => (
          <div key={group.group} className={styles.terminalGroup}>
            <span className={styles.terminalGroupName}>{group.group}</span>
            {group.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={styles.terminalRow}
                data-testid={`terminal-row-${row.id}`}
                aria-pressed={pendingTerminal === row.id}
                disabled={row.full && pendingTerminal !== row.id}
                title={row.full ? JA.terminalList.full : row.label}
                onClick={() => {
                  onPick({ kind: 'terminal', id: row.id, wirable: true, label: row.label });
                }}
              >
                <span className={styles.terminalName}>{row.label}</span>
                <span className={styles.terminalCount}>{row.wireCount}/2</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
