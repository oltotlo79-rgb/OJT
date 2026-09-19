import { cellAt, hline, vline, type Cell } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import {
  useCallback,
  useMemo,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { isTypingTarget } from '../session/interaction.js';
import { emptyCellForm, formForCell, type CellForm } from '../session/ladder-cell.js';
import {
  applyLadderCell,
  applyOrContact,
  applyRuleLine,
  clearLadderCell,
  ladderKeyToAction,
  moveCursor,
  shortcutKeyOf,
  toggleNoNcAt,
  togglePulseAt,
  type LadderCursor,
  type LadderEditResult,
  type LadderEditorMode,
  type PlaceKind,
} from '../session/ladder.js';
import { DeviceInput } from './DeviceInput.js';
import { LadderGrid } from './LadderGrid.js';
import { skinThemeOf } from './skins/index.js';
import styles from './ladder.module.css';

/**
 * ラダーエディタ。設計仕様 §10.6 / §10.7。
 *
 * キーの意味は `DialectProfile.shortcuts` が決める（決定表#12）。この部品はキーの文字列を
 * 1つも持たず、`ladderKeyToAction()` が返した `action` に対して振る舞いを選ぶだけである。
 */

/** デバイス入力欄を開く必要があるセル種別。 */
const NEEDS_DEVICE: Readonly<Record<PlaceKind, boolean>> = {
  'contact-no': true,
  'contact-nc': true,
  'or-contact-no': true,
  'or-contact-nc': true,
  coil: true,
  hline: false,
  vline: false,
};

/** 入力欄を開いたときに待っている置き場所。 */
interface Pending {
  kind: PlaceKind;
  form: CellForm;
  /**
   * `Enter`（既存セルの編集）で開いたか。真なら挿入モードの列ずらしを無視して**置き換える**
   * （GX Works3 の挙動。決定表#12 / Batch 2 レビュー D2）。新規に置くとき（`false`）だけ
   * `insertMode` に従って右のセルをずらす。
   */
  replace: boolean;
}

/** ラダーエディタ。 */
export function LadderEditor({
  profile,
  gridCols,
  errorCells,
  onConvert,
  onModeChange,
}: {
  profile: DialectProfile;
  gridCols: number;
  /**
   * 変換エラーが指しているセルの鍵（`"net:row:col"`）。`LadderGrid` の `memo` を効かせるため、
   * `Set` は `LadderWorkspace` の `useMemo` が持つ（毎レンダーで作り直さない）。§10.6
   */
  errorCells: ReadonlySet<string>;
  /** `F4`（変換）。実体は `LadderWorkspace` が持つ。§10.6 */
  onConvert: () => void;
  /** 書込み／読出し／モニタが変わった（Worker へモニタの開始停止を伝える）。§10.6 */
  onModeChange: (mode: LadderEditorMode) => void;
}): JSX.Element {
  const program = useStore((s) => s.ladder);
  const cursor = useStore((s) => s.ladderCursor);
  const mode = useStore((s) => s.ladderMode);
  const comments = useStore((s) => s.ladderComments);
  const [pending, setPending] = useState<Pending | undefined>(undefined);

  /**
   * セルをクリックしてカーソルを動かす。`memo(LadderGrid)` を効かせるため、毎レンダーで
   * 新しい関数を渡さない（Batch 2 レビュー）。
   */
  const onPickCell = useCallback((next: LadderCursor): void => {
    useStore.getState().setLadderCursor(next);
  }, []);

  /** 編集結果をストアへ入れる（失敗は理由をトーストに出す）。 */
  const commit = useCallback((result: LadderEditResult): void => {
    const store = useStore.getState();
    if (!result.ok) {
      store.toast(result.message, 'error');
      return;
    }
    store.setLadder(result.program);
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      // 入力欄に打ち込んでいる間は盤・ラダーのショートカットを動かさない（§8.2 と同じ規則）
      if (isTypingTarget(event.target) || event.nativeEvent.isComposing) return;
      const store = useStore.getState();
      const current = store.ladder;
      if (current === undefined) return;
      const action = ladderKeyToAction(profile.shortcuts, event, {
        cursor: store.ladderCursor,
        mode: store.ladderMode,
      });
      if (action.type === 'none') return;
      event.preventDefault();
      switch (action.type) {
        case 'move':
          store.setLadderCursor(
            // 表示していない接点列を飛ばしてコイル列へ移る（レビュー指摘 I1）
            moveCursor(current, store.ladderCursor, action.dRow, action.dCol, gridCols),
          );
          break;
        case 'place': {
          if (!NEEDS_DEVICE[action.kind]) {
            const cell: Cell = action.kind === 'hline' ? hline() : vline();
            commit(
              applyLadderCell(current, store.ladderCursor, cell, store.insertMode === 'insert'),
            );
            break;
          }
          const target = action.kind === 'coil' ? 'output' : 'contact';
          const form = emptyCellForm(target);
          setPending({
            kind: action.kind,
            form:
              action.kind === 'contact-nc' || action.kind === 'or-contact-nc'
                ? { ...form, contact: 'NC' }
                : form,
            replace: false,
          });
          break;
        }
        case 'edit': {
          const net = current.networks.find((n) => n.id === store.ladderCursor.networkId);
          if (net === undefined) break;
          const cell = cellAt(net, store.ladderCursor.row, store.ladderCursor.col);
          if (cell.kind === 'empty' || cell.kind === 'hline' || cell.kind === 'vline') break;
          setPending({ kind: 'contact-no', form: formForCell(cell, profile), replace: true });
          break;
        }
        case 'ruleLine':
          commit(applyRuleLine(current, store.ladderCursor, action.direction));
          break;
        case 'toggleNoNc':
          commit(toggleNoNcAt(current, store.ladderCursor));
          break;
        case 'togglePulse':
          commit(togglePulseAt(current, store.ladderCursor));
          break;
        case 'delete':
          commit(clearLadderCell(current, store.ladderCursor));
          break;
        case 'undo':
          if (!store.undoLadderEdit()) store.toast(JA.ladder.nothingToUndo);
          break;
        case 'redo':
          if (!store.redoLadderEdit()) store.toast(JA.ladder.nothingToRedo);
          break;
        case 'convert':
          onConvert();
          break;
        case 'setMode':
          // ストアへの書込みは `onModeChange`（実体は `LadderWorkspace.changeMode`）が持つ。
          // ここでも `setLadderMode()` していたのは二重書き（Batch 3 レビュー M6）
          onModeChange(action.mode);
          // `Shift+F3`（モニタ書込み）は `F3` と同じ動作。**そのセッションで最初の1回だけ**
          // 理由をトーストで出す（毎回出すと `F3` と往復するたびに邪魔になる。決定表#11）
          if (action.monitorWrite === true && store.markMonitorWriteNotice()) {
            store.toast(JA.ladder.monitorWriteSame);
          }
          break;
        case 'toggleInsert':
          // 挿入・上書きの切換（決定表#12b）。どちらになったかをトーストで知らせる
          store.toast(store.toggleInsert() === 'insert' ? JA.ladder.insertOn : JA.ladder.insertOff);
          break;
        case 'help':
          store.toast(JA.ladder.helpHint);
          break;
        case 'disabled':
          store.toast(action.entry.note ?? action.entry.label, 'error');
          break;
        case 'readOnly':
          // キーの文字列は方言から引く（Plan 4B Task 3。前提#22）
          store.toast(JA.ladder.readOnly(shortcutKeyOf(profile, 'write-mode') ?? 'F2'), 'error');
          break;
        default:
          break;
      }
    },
    [commit, gridCols, onConvert, onModeChange, profile],
  );

  /** 見た目（セル寸法・コメント行数）はスキンが持つ（Plan 4B 決定表#6）。 */
  const theme = useMemo(() => skinThemeOf(profile), [profile]);

  if (program === undefined) return <div className={styles.editor} data-testid="ladder-editor" />;

  return (
    <div
      className={styles.editor}
      data-testid="ladder-editor"
      data-mode={mode}
      role="application"
      aria-label={profile.panels.editor}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => {
        useStore.getState().setLadderFocused(true);
      }}
      onBlur={(event) => {
        // 入力欄（子要素）へフォーカスが移っただけならエディタは手放さない
        if (event.currentTarget.contains(event.relatedTarget)) return;
        useStore.getState().setLadderFocused(false);
      }}
    >
      <LadderGrid
        program={program}
        profile={profile}
        theme={theme}
        cursor={cursor}
        mode={mode}
        comments={comments}
        errorCells={errorCells}
        gridCols={gridCols}
        onPickCell={onPickCell}
      />
      {pending === undefined ? null : (
        <DeviceInput
          initial={pending.form}
          profile={profile}
          onCancel={() => {
            setPending(undefined);
          }}
          onCommit={(cell) => {
            const store = useStore.getState();
            const current = store.ladder;
            if (current === undefined) return;
            const isBranch = pending.kind === 'or-contact-no' || pending.kind === 'or-contact-nc';
            // `Enter` での編集は挿入モードでも置き換える（右のセルをずらさない。D2）
            const insert = !pending.replace && store.insertMode === 'insert';
            commit(
              isBranch
                ? applyOrContact(current, store.ladderCursor, cell)
                : applyLadderCell(current, store.ladderCursor, cell, insert),
            );
            // 確定したらカーソルを1つ右へ送る（GX Works3 と同じ。続けて接点を並べられる）
            const after = useStore.getState();
            if (after.ladder !== undefined) {
              after.setLadderCursor(moveCursor(after.ladder, after.ladderCursor, 0, 1, gridCols));
            }
            setPending(undefined);
          }}
        />
      )}
    </div>
  );
}
