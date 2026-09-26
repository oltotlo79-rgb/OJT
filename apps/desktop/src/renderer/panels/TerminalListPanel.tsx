import { CollapsiblePanel } from './CollapsiblePanel.js';
import { effectiveWireLimit, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { useMemo, useState, type JSX } from 'react';
import { JA, terminalNoMatchText, terminalFullText } from '../i18n/ja.js';
import type { PickHit } from '../session/interaction.js';
import { terminalRows, type TerminalRow } from '../session/terminal-list.js';
import styles from './panels.module.css';

/**
 * 端子リスト（キーボードで配線する）。UXレビュー #29 / Plan 5 決定表#12。
 * 選ぶと `PickHit`（`kind: 'terminal'`）を親へ渡すだけで、**配線の規則は
 * `pickToAction()`（`session/interaction.ts`）がそのまま受け持つ**。
 *
 * **2026-09-20（Phase 7 Task 27 / 指摘 PR-11）**: 行と3D盤の端子を**相互に**光らせる。
 * 行にカーソル（またはフォーカス）を置くと盤のネジが光り、盤の端子を指すと行が光る。
 * どちらの向きも `store.hoveredTerminal` 1つで表すので、光が2箇所で食い違うことがない。
 * 端子IDの語彙の差（役割 `CR1.9` と物理 `S1.9`）は呼び出し側（`Session`）が吸収する。
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
  measuring = false,
  hoveredTerminal,
  onPick,
  onHover,
  onCancel,
}: {
  board: BoardDefinition;
  session: BoardSession;
  /** 測定では電線2本の端子も選べる。 */
  measuring?: boolean;
  /** 配線1本目に選んだ端子（`store.pendingTerminal`）。 */
  pendingTerminal: TerminalId | undefined;
  /** いま盤で指している端子（**役割ID**に直したもの）。指摘 PR-11 */
  hoveredTerminal: TerminalId | undefined;
  onPick: (hit: PickHit) => void;
  /** 行を指した／離れた（盤のネジを光らせる）。指摘 PR-11 */
  onHover: (id: TerminalId | undefined) => void;
  onCancel: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => terminalRows(board, session, query), [board, session, query]);
  return (
    <CollapsiblePanel
      title={JA.terminalList.title}
      testId="terminal-list"
      summary={JA.terminalList.search}
    >
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
      {/*
        検索して1件も無いとき、以前は無言で空欄になっていた（UI監査 I9）。盤の印字（`S1`）でも
        役割名（`CR1`）でも探せることを添えて、打ち間違いだと訓練者が気づけるようにする。
      */}
      {query.trim().length > 0 && rows.length === 0 ? (
        <p className={styles.terminalHint} data-testid="terminal-no-match">
          {terminalNoMatchText(query.trim())}
        </p>
      ) : null}
      <div className={styles.terminalGroups}>
        {byGroup(rows).map((group) => (
          <div key={group.group} className={styles.terminalGroup}>
            <span className={styles.terminalGroupName}>{group.group}</span>
            {group.rows.map((row) => {
              /*
               * 満杯（2本つながっている）の端子は「押せない」のではなく「押しても何も
               * 起きない」にする（I3: Plan 5 C/D レビュー）。`disabled` の要素には
               * Chromium がポインタイベント（`title` のツールチップを含む）を配らず、
               * 読み上げも `disabled` の要素は飛ばすため、理由が訓練者に届かなかった。
               * `aria-disabled` はフォーカス・読み上げの対象のまま残るので、`title` の
               * ツールチップも `aria-describedby` の隠し文字も効く。
               * いま1本目として選んでいる端子自身（`pendingTerminal === row.id`）は
               * 取り消せるよう、満杯でも押せるままにする（既存の挙動）。
               */
              const unavailable = !measuring && row.full && pendingTerminal !== row.id;
              const reasonId = `terminal-full-reason-${row.id}`;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={styles.terminalRow}
                  data-testid={`terminal-row-${row.id}`}
                  aria-pressed={pendingTerminal === row.id}
                  aria-disabled={unavailable}
                  // 盤の端子を指しているあいだ、その行も光らせる（指摘 PR-11）
                  data-hovered={hoveredTerminal === row.id}
                  {...(unavailable ? { 'aria-describedby': reasonId } : {})}
                  title={
                    unavailable
                      ? terminalFullText(effectiveWireLimit(session.boardProfile?.rules))
                      : row.label
                  }
                  onClick={() => {
                    if (unavailable) return;
                    onPick({ kind: 'terminal', id: row.id, wirable: true, label: row.label });
                  }}
                  onPointerEnter={() => {
                    onHover(row.id);
                  }}
                  onPointerLeave={() => {
                    onHover(undefined);
                  }}
                  /* キーボードだけで辿るときも同じ光り方にする（Tab で盤の端子が光る） */
                  onFocus={() => {
                    onHover(row.id);
                  }}
                  onBlur={() => {
                    onHover(undefined);
                  }}
                >
                  <span className={styles.terminalName}>{row.label}</span>
                  <span className={styles.terminalCount}>
                    {row.wireCount}/{effectiveWireLimit(session.boardProfile?.rules)}
                  </span>
                  {unavailable ? (
                    <span className={styles.srOnly} id={reasonId} data-testid={reasonId}>
                      {terminalFullText(effectiveWireLimit(session.boardProfile?.rules))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </CollapsiblePanel>
  );
}
