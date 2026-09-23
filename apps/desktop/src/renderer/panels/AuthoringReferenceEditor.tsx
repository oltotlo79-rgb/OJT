import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { SchematicDocument } from '@ojt/schematic-core';
import type { LadderProgram } from '@ojt/ladder-core';
import { useElementWidth } from '../app/use-element-size.js';
import { SchematicEditor } from '../schematic/SchematicEditor.js';
import {
  ENTRY_ITEMS,
  LadderEditor,
  SymbolIcon,
  type LadderEntryHandle,
} from '../ladder/LadderEditor.js';
import { fitGridCols } from '../ladder/LadderGrid.js';
import { skinCssVars, skinThemeOf } from '../ladder/skins/index.js';
import {
  createReferenceStore,
  editReferenceNetwork,
  type AuthoringReference,
} from '../session/authoring-reference.js';
import { errorCellKeys, runConvert } from '../session/ladder-errors.js';
import { pushModalLayer, topModalLayer } from '../session/interaction.js';
import { useAuthoringDraft } from '../session/authoring-draft.js';
import styles from './authoring-reference.module.css';

export function AuthoringReferenceEditor({
  reference,
  onChange,
  onClose,
  onCancel,
  onVerify,
}: {
  reference: AuthoringReference;
  onChange: (
    patch:
      | { schematic: SchematicDocument }
      | { referenceLadder: LadderProgram & { comments: Record<string, string> } },
  ) => void;
  onClose: () => void;
  onCancel: () => void;
  onVerify: () => void;
}): JSX.Element {
  const [useReference] = useState(() => createReferenceStore(reference));
  const doc = useReference((s) => s.schematicDoc);
  const schematicHistory = useReference((s) => s.schematicHistory);
  const schematicCursor = useReference((s) => s.schematicCursor);
  const ladderHistory = useReference((s) => s.ladderHistory);
  const issues = useReference((s) => s.convertIssues);
  const converted = useReference((s) => s.converted);
  const toasts = useReference((s) => s.toasts);
  const busy = useAuthoringDraft((s) => s.busy);
  const validation = useAuthoringDraft((s) => s.validation);
  const message = useAuthoringDraft((s) => s.message);
  const persistence = useAuthoringDraft((s) => s.persistence);
  const persistenceMessage = useAuthoringDraft((s) => s.persistenceMessage);
  const [cancelAsk, setCancelAsk] = useState(false);
  const [entryActive, setEntryActive] = useState(false);
  useEffect(() => {
    useAuthoringDraft.setState({ referenceInputPending: entryActive });
    return () => {
      useAuthoringDraft.setState({ referenceInputPending: false });
    };
  }, [entryActive]);
  const dialog = useRef<HTMLDialogElement>(null);
  const depth = useRef(0);
  const entry = useRef<LadderEntryHandle>(null);
  const area = useRef<HTMLDivElement>(null);
  const width = useElementWidth(area);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useEffect(
    () =>
      useReference.subscribe((next, previous) => {
        if (
          reference.kind === 'schematic' &&
          next.schematicDoc !== previous.schematicDoc &&
          next.schematicDoc !== undefined
        )
          change.current({ schematic: next.schematicDoc });
        if (
          reference.kind === 'ladder' &&
          next.ladder !== undefined &&
          (next.ladder !== previous.ladder || next.ladderComments !== previous.ladderComments)
        )
          change.current({ referenceLadder: { ...next.ladder, comments: next.ladderComments } });
      }),
    [reference.kind, useReference],
  );
  useEffect(() => {
    const previous = document.activeElement;
    const layer = pushModalLayer();
    depth.current = layer.depth;
    dialog.current?.showModal();
    return () => {
      layer.release();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const errorCells = useMemo(() => errorCellKeys(issues.errors), [issues.errors]);
  const state = useReference.getState();
  const convert = (): void => {
    if (entryActive) {
      state.toast('入力欄を「確定」または「取消」で閉じてから変換してください。');
      return;
    }
    const program = useReference.getState().ladder;
    if (reference.kind !== 'ladder' || program === undefined) return;
    const result = runConvert(program, reference.profile);
    state.setConverted(result.ok, result.issues);
  };
  const theme = reference.kind === 'ladder' ? skinThemeOf(reference.profile) : undefined;
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="author-reference-title"
      data-testid="author-reference-editor"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (depth.current === topModalLayer() && !busy && !entryActive) onClose();
      }}
    >
      <h2 id="author-reference-title">
        {reference.kind === 'schematic' ? '模範回路図を編集' : '模範ラダーを編集'}
      </h2>
      <p>
        変更は下書きに随時保存します。「検証」で課題全体の模範動作を確認し、編集を終えて配布用JSONを保存してください。
      </p>
      <p aria-live="polite">
        {persistence === 'failed'
          ? `下書きの保存に失敗：${persistenceMessage}`
          : persistence === 'saved'
            ? '下書き保存済み'
            : '下書きの変更を保存しています…'}
      </p>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
        {reference.kind === 'schematic' && doc !== undefined ? (
          <div className={styles.editor}>
            <SchematicEditor
              problem={{ board: reference.board }}
              board={reference.definition}
              document={doc}
              cursor={schematicCursor}
              history={schematicHistory}
              verifying={busy}
              showStepGuide={false}
              verifyLabel="課題全体を検証"
              keyboardModalDepth={() => depth.current}
              onEdit={state.applySchematicEdit}
              onCursor={state.setSchematicCursor}
              onUndo={state.undoSchematicEdit}
              onRedo={state.redoSchematicEdit}
              onClear={state.clearSchematic}
              onVerify={onVerify}
              onPickCell={() => undefined}
              onRefuse={(text) => state.toast(text, 'error')}
              onNotice={(text) => state.toast(text)}
            />
          </div>
        ) : reference.kind === 'ladder' && theme !== undefined ? (
          <>
            <p>
              {reference.profile.displayName}
              。セルを選び、記号ボタンまたはダブルクリックで入力します。
            </p>
            <div className={styles.toolbar}>
              <button
                type="button"
                disabled={ladderHistory.done.length === 0}
                onClick={state.undoLadderEdit}
              >
                元に戻す
              </button>
              <button
                type="button"
                disabled={ladderHistory.undone.length === 0}
                onClick={state.redoLadderEdit}
              >
                やり直す
              </button>
              {[
                ['insert-network', '回路ブロックを追加'],
                ['delete-network', '回路ブロックを削除'],
                ['insert-row', '並列行を追加'],
                ['delete-row', '選択行を削除'],
              ].map(([command, label]) => (
                <button
                  key={command}
                  type="button"
                  onClick={() => editReferenceNetwork(useReference, command ?? '')}
                >
                  {label}
                </button>
              ))}
              <button type="button" disabled={entryActive} onClick={convert}>
                ラダーを変換
              </button>
            </div>
            <div className={styles.toolbar} aria-label="ラダーの記号">
              {ENTRY_ITEMS.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => entry.current?.place(item.kind)}
                >
                  <SymbolIcon kind={item.kind} /> {item.label}
                </button>
              ))}
            </div>
            <div
              ref={area}
              className={styles.editor}
              style={skinCssVars(reference.profile, theme, 'green')}
            >
              <LadderEditor
                ref={entry}
                editorStore={useReference}
                profile={reference.profile}
                onEntryActiveChange={setEntryActive}
                gridCols={fitGridCols(reference.profile.gridCols, width, theme.cell)}
                errorCells={errorCells}
                onConvert={convert}
                onCommand={(command) => editReferenceNetwork(useReference, command)}
                onHelp={() =>
                  state.toast(
                    'セルを選択 → 記号ボタンで入力 → ラダーを変換 → 課題全体を検証。矢印キーで移動し、Deleteで記号を削除、Ctrl+Zで元に戻せます。',
                  )
                }
                onModeChange={() =>
                  state.toast(
                    'ここでは模範ラダーを編集します。動作確認は「課題全体を検証」を押してください。',
                  )
                }
              />
            </div>
            <p aria-live="polite">
              {converted
                ? 'ラダーの変換に成功しました。課題全体の検証も実行してください。'
                : issues.errors.length > 0
                  ? 'ラダーの変換に指摘があります。項目を押すと該当セルを選択します。'
                  : '編集中：ラダーを変換して接続と命令を確認できます。'}
            </p>
            <ul className={styles.issues}>
              {issues.errors.map((issue, index) => (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => {
                      if (issue.networkId !== undefined)
                        state.setLadderCursor({
                          networkId: issue.networkId,
                          row: issue.row ?? 0,
                          col: issue.col ?? 0,
                        });
                    }}
                  >
                    {issue.message}
                  </button>
                </li>
              ))}
              {issues.warnings.map((issue, index) => (
                <li key={`warning-${index}`}>{issue.message}</li>
              ))}
            </ul>
            <button type="button" disabled={entryActive} onClick={onVerify}>
              課題全体を検証
            </button>
          </>
        ) : null}
      </fieldset>
      {toasts.at(-1) !== undefined && (
        <p className={styles.status} role="status">
          {toasts.at(-1)?.text}
        </p>
      )}
      {entryActive && (
        <p role="note">
          回路入力欄の内容はまだ確定していません。「確定」または「取消」で入力欄を閉じてから、検証や編集の終了へ進んでください。
        </p>
      )}
      <p className={styles.status} aria-live="polite">
        {message}
      </p>
      {validation !== undefined && validation.reasons.length > 0 && (
        <ul className={styles.issues}>
          {validation.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}
      <div className={styles.footer}>
        <button type="button" disabled={busy || entryActive} onClick={onClose} autoFocus>
          編集を終える
        </button>
        <button type="button" disabled={busy} onClick={() => setCancelAsk(!cancelAsk)}>
          この画面の変更を取り消す…
        </button>
      </div>
      {cancelAsk && (
        <div role="alert">
          <p>この編集画面を開いた時点の下書きに戻します。</p>
          <button type="button" disabled={busy} onClick={onCancel}>
            変更を取り消して閉じる
          </button>
          <button type="button" onClick={() => setCancelAsk(false)}>
            編集を続ける
          </button>
        </div>
      )}
    </dialog>
  );
}
