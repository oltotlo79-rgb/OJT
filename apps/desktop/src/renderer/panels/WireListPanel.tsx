import { removeWire, isOffBoardTerminal, type BoardDefinition } from '@ojt/board-model';
import { toTerminalId, type WireColor } from '@ojt/circuit-sim';
import { useMemo, useState, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { cloneSession } from '../session/commands.js';
import { commitWireEdit, focusWiring, reconnectWire } from '../session/wire-edit.js';
import { safeRoutes } from '../session/wire-routes.js';
import styles from './panels.module.css';
import { CollapsiblePanel } from './CollapsiblePanel.js';

export function WireListPanel({ board }: { board: BoardDefinition }): JSX.Element | null {
  const session = useStore((state) => state.session);
  const isRepair = useStore((state) => state.problem?.mode === 'inspect-repair');
  const selected = useStore((state) => state.selectedWire);
  const powered = useStore(
    (state) => state.snapshot.powered || state.plcRunning || state.replay !== undefined,
  );
  const [query, setQuery] = useState('');
  const [marked, setMarked] = useState<readonly string[]>([]);
  const [edit, setEdit] = useState<{ id: string; from: string; to: string; color: WireColor }>();
  const [annotationDraft, setAnnotationDraft] = useState<{
    id: string;
    label: string;
    note: string;
  }>();
  const routing = useMemo(() => safeRoutes(board, session), [board, session]);
  if (session === undefined) return null;
  const wire = session.wires.find((candidate) => candidate.id === selected);
  const label =
    annotationDraft !== undefined && annotationDraft.id === selected
      ? annotationDraft.label
      : (session.wireAnnotations?.[selected ?? '']?.label ?? '');
  const note =
    annotationDraft !== undefined && annotationDraft.id === selected
      ? annotationDraft.note
      : (session.wireAnnotations?.[selected ?? '']?.note ?? '');
  const shown = session.wires.filter((candidate) =>
    `${candidate.id} ${candidate.from} ${candidate.to} ${session.wireAnnotations?.[candidate.id]?.label ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const preview =
    edit === undefined
      ? undefined
      : reconnectWire(
          session,
          board,
          edit.id,
          toTerminalId(edit.from),
          toTerminalId(edit.to),
          edit.color,
        );
  const annotation = (id: string, change: { label: string; note: string }): void => {
    const after = cloneSession(session);
    after.wireAnnotations = { ...after.wireAnnotations, [id]: change };
    commitWireEdit({
      ok: true,
      value: after,
      command: {
        kind: 'wireMetadata',
        label: `線番・注記 ${id}`,
        before: cloneSession(session),
        after,
      },
    });
  };
  return (
    <CollapsiblePanel
      title="電線一覧・接続先の変更"
      testId="wire-list"
      summary={`${session.wires.length}本`}
      openKey={selected}
    >
      <label className={styles.formField}>
        電線・端子・線番を検索
        <input
          aria-label="電線・端子・線番を検索"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {powered && <p>盤電源OFF・PLC停止で編集できます。</p>}
      <div style={{ maxHeight: 250, overflow: 'auto' }}>
        {shown.map((item) => (
          <div
            key={item.id}
            style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBlock: 3 }}
          >
            <input
              type="checkbox"
              aria-label={`選択 ${item.id}`}
              disabled={item.locked}
              checked={marked.includes(item.id)}
              onChange={(event) =>
                setMarked(
                  event.target.checked
                    ? [...marked, item.id]
                    : marked.filter((id) => id !== item.id),
                )
              }
            />
            <button
              type="button"
              data-testid={`wire-row-${item.id}`}
              aria-pressed={selected === item.id}
              style={{ flex: 1, textAlign: 'left', overflowWrap: 'anywhere' }}
              onClick={() => {
                focusWiring([item.from, item.to], [item.id]);
                setAnnotationDraft(undefined);
              }}
            >
              {session.wireAnnotations?.[item.id]?.label || item.id}：{item.from} → {item.to}
              <br />
              {item.color}・{item.locked ? '固定' : '編集可'}
              {routing.errors.some((error) => error.wireId === item.id)
                ? '・接続済み／経路要調整'
                : ''}
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={powered || marked.length === 0}
        onClick={() => {
          const after = cloneSession(session);
          for (const id of marked) {
            const result = removeWire(after, id);
            if (!result.ok) {
              useStore.getState().toast(result.message, 'error');
              return;
            }
          }
          if (
            commitWireEdit({
              ok: true,
              value: after,
              command: {
                kind: 'removeWire',
                label: `電線${marked.length}本を削除`,
                before: cloneSession(session),
                after,
              },
            })
          )
            setMarked([]);
        }}
      >
        選択した電線を削除（Undo可）
      </button>
      {isRepair && wire !== undefined && !wire.locked && (
        <button
          type="button"
          onClick={() => {
            const state = useStore.getState();
            state.setMode('report');
            state.setPendingReport({ wireId: wire.id });
          }}
        >
          この電線の故障を指摘
        </button>
      )}
      {wire !== undefined && (
        <fieldset disabled={powered || wire.locked}>
          <legend>{wire.id} の編集</legend>
          <button
            type="button"
            onClick={() =>
              setEdit({ id: wire.id, from: wire.from, to: wire.to, color: wire.color })
            }
          >
            接続先を変更
          </button>
          <label className={styles.formField}>
            線番
            <input
              maxLength={40}
              value={label}
              onChange={(event) =>
                setAnnotationDraft({ id: wire.id, label: event.target.value, note })
              }
            />
          </label>
          <label className={styles.formField}>
            注記
            <input
              maxLength={500}
              value={note}
              onChange={(event) =>
                setAnnotationDraft({ id: wire.id, label, note: event.target.value })
              }
            />
          </label>
          <button type="button" onClick={() => annotation(wire.id, { label, note })}>
            線番・注記を保存
          </button>
          <label className={styles.formField}>
            通す配線帯
            <select
              aria-label="通す配線帯"
              value={session.wireRoutePreferences?.[wire.id]?.viaChannelIds[0] ?? ''}
              disabled={isOffBoardTerminal(wire.from) || isOffBoardTerminal(wire.to)}
              onChange={(event) => {
                const after = cloneSession(session);
                after.wireRoutePreferences = {
                  ...after.wireRoutePreferences,
                  [wire.id]: {
                    viaChannelIds: event.target.value === '' ? [] : [event.target.value],
                  },
                };
                commitWireEdit({
                  ok: true,
                  value: after,
                  command: {
                    kind: 'wireMetadata',
                    label: `配線経路 ${wire.id}`,
                    before: cloneSession(session),
                    after,
                  },
                });
              }}
            >
              <option value="">自動</option>
              {board.wiringChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.id}（{channel.axis === 'x' ? '横' : '縦'}方向）
                </option>
              ))}
            </select>
          </label>
          <p>経路の変更は電気的な接続を変えません。机上のPLCケーブルは自動経路です。</p>
        </fieldset>
      )}
      {edit !== undefined && (
        <fieldset disabled={powered}>
          <legend>変更後の接続を確認</legend>
          {(['from', 'to'] as const).map((end) => (
            <label className={styles.formField} key={end}>
              {end === 'from' ? '始点' : '終点'}
              <select
                value={edit[end]}
                onChange={(event) => setEdit({ ...edit, [end]: event.target.value })}
              >
                <option value={edit[end]}>{edit[end]}</option>
                {board.terminals
                  .filter((terminal) => terminal.wirable)
                  .map((terminal) => (
                    <option key={terminal.id} value={terminal.id}>
                      {terminal.id}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label className={styles.formField}>
            線色
            <select
              value={edit.color}
              onChange={(event) => setEdit({ ...edit, color: event.target.value as WireColor })}
            >
              {session.allowedColors.map((color) => (
                <option key={color}>{color}</option>
              ))}
            </select>
          </label>
          <p role="status">
            {preview?.ok ? `${edit.from} → ${edit.to}（${edit.color}）` : preview?.message}
          </p>
          <button
            type="button"
            disabled={preview?.ok !== true}
            onClick={() => {
              if (preview !== undefined && commitWireEdit(preview)) setEdit(undefined);
            }}
          >
            変更を確定
          </button>
          <button type="button" onClick={() => setEdit(undefined)}>
            取消
          </button>
        </fieldset>
      )}
    </CollapsiblePanel>
  );
}
