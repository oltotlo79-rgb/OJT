import { deviceLabel, hline, vline, type Cell } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react';
import { useStore } from '../app/store.js';
import { useHelpStore } from '../help/help-store.js';
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
  removeRuleLine,
  shortcutKeyOf,
  toggleNoNcAt,
  togglePulseAt,
  type LadderCursor,
  type LadderEditResult,
  type LadderEditorMode,
  type PlaceKind,
} from '../session/ladder.js';
import { writeModeLabel } from '../session/plc-skin.js';
import { DeviceInput } from './DeviceInput.js';
import { friendlyLadderErrorMessage } from './ladder-errors.js';
import { LadderGrid, type GridEntry } from './LadderGrid.js';
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
  'pulse-rise': true,
  'pulse-fall': true,
  coil: true,
  application: true,
  hline: false,
  vline: false,
};

/**
 * 置く種別 → 入力欄の初期値（Phase 7 §5.2 のキー表）。
 *
 * 微分接点（`Shift+F7` / `Shift+F8`）は接点欄を `P` / `F` で、応用命令（`F8` / OMRON `I`）は
 * 出力欄を `SET` で開く。「どの記号で開くか」だけを決め、実際に置くのは `DeviceInput` が
 * 組み立てたセルである（欄の中で種別を変えてもよい）。
 */
const FORM_SEED: Readonly<Record<PlaceKind, Partial<CellForm>>> = {
  'contact-no': {},
  'contact-nc': { contact: 'NC' },
  'or-contact-no': {},
  'or-contact-nc': { contact: 'NC' },
  'pulse-rise': { contact: 'P' },
  'pulse-fall': { contact: 'F' },
  coil: {},
  application: { output: 'SET' },
  hline: {},
  vline: {},
};

/** 入力欄を「出力（コイル列）」として開く種別。 */
const OUTPUT_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['coil', 'application']);

/**
 * 記号ボタン・右クリックメニューが扱う操作（Phase 7 設計 §5.3 の入口B・入口C）。
 * 置く記号（`PlaceKind`）に「削除」を足したもので、キーで押せる操作と同じ範囲に収める。
 */
export type EntryKind = PlaceKind | 'delete';

/**
 * 記号ボタン列（入口B）と右クリックメニュー（入口C）に並べる操作。
 *
 * 並びは純正のツールバーと同じく「接点 → 並列接点 → 出力 → 応用命令 → 罫線 → 削除」。
 * **キーは方言表から引く**（`shortcutKeyOf()`）ので、ここには1つも書かない（決定表#12）。
 * `action` はキー表の行の名前で、方言によって名前が違う行（OMRON の `instruction`）は
 * 2つ挙げて先に見つかったほうを使う。
 */
export const ENTRY_ITEMS: ReadonlyArray<{
  kind: EntryKind;
  label: string;
  actions: readonly string[];
}> = [
  { kind: 'contact-no', label: JA.ladder.contactNo, actions: ['contact-no'] },
  { kind: 'contact-nc', label: JA.ladder.contactNc, actions: ['contact-nc'] },
  { kind: 'or-contact-no', label: JA.ladder.entry.orContactNo, actions: ['or-contact-no'] },
  { kind: 'or-contact-nc', label: JA.ladder.entry.orContactNc, actions: ['or-contact-nc'] },
  { kind: 'coil', label: JA.ladder.coilOut, actions: ['coil'] },
  {
    kind: 'application',
    label: JA.ladder.entry.application,
    actions: ['application', 'instruction'],
  },
  { kind: 'hline', label: JA.ladder.entry.hline, actions: ['hline'] },
  { kind: 'vline', label: JA.ladder.entry.vline, actions: ['vline'] },
  { kind: 'delete', label: JA.ladder.entry.delete, actions: ['delete'] },
];

/**
 * ボタンに描く記号（**本アプリが描く線画**。各社の図記号ビットマップ・アイコンは使わない。§17）。
 * 24×14 の枠に、格子の記号と同じ形（接点は縦棒2本・出力は丸・応用命令は角括弧）を小さく描く。
 */
export function SymbolIcon({ kind }: { kind: EntryKind }): JSX.Element {
  const paths: Readonly<Record<EntryKind, string>> = {
    'contact-no': 'M1 7h7M16 7h7M8 2v10M16 2v10',
    'contact-nc': 'M1 7h7M16 7h7M8 2v10M16 2v10M8 3l8 8',
    'or-contact-no': 'M1 3h7M16 3h7M8 1v4M16 1v4M1 3v8h22V3M8 9v4M16 9v4M1 11h7M16 11h7',
    'or-contact-nc': 'M1 3h7M16 3h7M8 1v4M16 1v4M8 1l8 4M1 3v8h22V3M8 9v4M16 9v4M1 11h7M16 11h7',
    // 微分接点（立上り `P` / 立下り `F`）。縦棒の間に矢印を描く（キーは Shift+F7 / Shift+F8）
    'pulse-rise': 'M1 7h7M16 7h7M8 2v10M16 2v10M10 9l2-4 2 4',
    'pulse-fall': 'M1 7h7M16 7h7M8 2v10M16 2v10M10 5l2 4 2-4',
    coil: 'M1 7h6M17 7h6',
    application: 'M1 7h4M19 7h4M8 2h-2v10h2M16 2h2v10h-2',
    hline: 'M1 7h22',
    vline: 'M12 1v12M1 7h22',
    delete: 'M4 3l16 8M20 3L4 11',
  };
  return (
    <svg
      className={styles.symbolIcon}
      width={24}
      height={14}
      viewBox="0 0 24 14"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[kind]} />
      {kind === 'coil' ? <circle cx={12} cy={7} r={5} /> : null}
    </svg>
  );
}

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

/**
 * ツールバーの記号ボタン（入口B）から、キーと同じ入口へ入るための取っ手。
 * 欄の状態（`pending`）はこの部品が持つので、`LadderWorkspace` は `place()` を呼ぶだけにする。
 */
export interface LadderEntryHandle {
  place: (kind: EntryKind) => void;
}

/** ラダーエディタ。 */
export function LadderEditor({
  profile,
  gridCols,
  errorCells,
  onConvert,
  onModeChange,
  ref,
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
  /** 記号ボタン列（入口B）から呼ぶ取っ手。React 19 は `ref` をただの props として受ける。 */
  ref?: Ref<LadderEntryHandle>;
}): JSX.Element {
  const program = useStore((s) => s.ladder);
  const cursor = useStore((s) => s.ladderCursor);
  const mode = useStore((s) => s.ladderMode);
  const comments = useStore((s) => s.ladderComments);
  const converted = useStore((s) => s.converted);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  /** 右クリックで出す記号メニュー（入口C）。画面座標に浮かせる。設計 §5.3 */
  const [menu, setMenu] = useState<{ cursor: LadderCursor; x: number; y: number } | undefined>(
    undefined,
  );
  /** 指摘 LE-13: `Escape` でここへフォーカスを手放す（`Tab` は罫線送りに使っており脱出口が無かった）。 */
  const editorRef = useRef<HTMLDivElement | null>(null);

  /**
   * セルをクリックしてカーソルを動かす。`memo(LadderGrid)` を効かせるため、毎レンダーで
   * 新しい関数を渡さない（Batch 2 レビュー）。
   */
  const onPickCell = useCallback((next: LadderCursor): void => {
    useStore.getState().setLadderCursor(next);
  }, []);

  /** 編集結果をストアへ入れる（失敗は理由をトーストに出す）。 */
  const commit = useCallback((result: LadderEditResult): boolean => {
    const store = useStore.getState();
    if (!result.ok) {
      /*
       * 指摘 LE-3: `session/ladder.ts` は END セルを保護したとき、文言を持たない層のまま
       * 合図の `'end-locked'` を返す（session 層は i18n を知らない）。文言はここで当てる。
       */
      store.toast(
        result.message === 'end-locked'
          ? JA.ladder.endLocked
          : friendlyLadderErrorMessage(result.message),
        'error',
      );
      return false;
    }
    store.setLadder(result.program);
    return true;
  }, []);

  const closeInput = (): void => {
    setPending(undefined);
    editorRef.current?.focus({ preventScroll: true });
  };

  /**
   * 記号を置く（3つの入口の合流点。設計 §5.3）。
   *
   * キー（入口A）・ツールバーの記号ボタン（入口B）・格子のダブルクリックと右クリック
   * （入口C）はすべてここへ来る。デバイスが要る種別は回路入力欄を開き、要らない種別
   * （罫線・削除）はその場で置く。書込みモード以外は断る（キー操作と同じ規則。決定表#11）。
   */
  const runPlace = useCallback(
    (kind: EntryKind, at?: LadderCursor): void => {
      const store = useStore.getState();
      const current = store.ladder;
      if (current === undefined) return;
      if (store.ladderMode !== 'write') {
        store.toast(JA.ladder.readOnly(writeModeLabel(profile)), 'error');
        return;
      }
      const cursor = at ?? store.ladderCursor;
      if (at !== undefined) store.setLadderCursor(at);
      if (kind === 'delete') {
        commit(clearLadderCell(current, cursor));
        return;
      }
      if (!NEEDS_DEVICE[kind]) {
        const cell: Cell = kind === 'hline' ? hline() : vline();
        commit(applyLadderCell(current, cursor, cell, store.insertMode === 'insert'));
        return;
      }
      const target = OUTPUT_KINDS.has(kind) ? 'output' : 'contact';
      setPending({
        kind,
        form: { ...emptyCellForm(target), ...FORM_SEED[kind] },
        replace: false,
      });
    },
    [commit, profile],
  );

  /**
   * 格子のダブルクリック（入口C）。空セルなら新しく置く欄を、置いてあるセルならその編集を開く
   * （`Enter` と同じ）。**単クリックはカーソル移動のまま**である（設計 §5.3）。
   */
  const openAt = useCallback(
    (cursor: LadderCursor): void => {
      const store = useStore.getState();
      const current = store.ladder;
      if (current === undefined) return;
      store.setLadderCursor(cursor);
      const cell = current.networks.find((net) => net.id === cursor.networkId)?.cells[cursor.row]?.[
        cursor.col
      ];
      if (
        cell === undefined ||
        cell.kind === 'empty' ||
        cell.kind === 'hline' ||
        cell.kind === 'vline'
      ) {
        runPlace('contact-no', cursor);
        return;
      }
      if (store.ladderMode !== 'write') {
        store.toast(JA.ladder.readOnly(writeModeLabel(profile)), 'error');
        return;
      }
      setPending({ kind: 'contact-no', form: formForCell(cell, profile), replace: true });
    },
    [profile, runPlace],
  );

  /** 入口C の入口一式（`memo(LadderGrid)` を効かせるため参照を固定する）。 */
  const gridEntry = useMemo<GridEntry>(
    () => ({
      onOpen: openAt,
      onMenu: (cursor, x, y) => {
        useStore.getState().setLadderCursor(cursor);
        setMenu({ cursor, x, y });
      },
      onDropSymbol: (cursor, kind) => {
        const item = ENTRY_ITEMS.find((entry) => entry.kind === kind);
        if (item !== undefined) runPlace(item.kind, cursor);
      },
    }),
    [openAt, runPlace],
  );

  /** 記号ボタン列（入口B）は `place()` を呼ぶだけ（欄の状態はこの部品が持つ）。 */
  useImperativeHandle(
    ref,
    () => ({
      place: (kind: EntryKind) => {
        runPlace(kind);
      },
    }),
    [runPlace],
  );

  /** メニューは次のクリックで閉じる（項目を押したときは押した側が先に閉じる）。 */
  useEffect(() => {
    if (menu === undefined) return undefined;
    const close = (): void => {
      setMenu(undefined);
    };
    window.addEventListener('click', close);
    return () => {
      window.removeEventListener('click', close);
    };
  }, [menu]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      // 入力欄に打ち込んでいる間は盤・ラダーのショートカットを動かさない（§8.2 と同じ規則）
      if (isTypingTarget(event.target) || event.nativeEvent.isComposing) return;
      const store = useStore.getState();
      const current = store.ladder;
      if (current === undefined) return;
      const atCursor = current.networks.find((n) => n.id === store.ladderCursor.networkId)?.cells[
        store.ladderCursor.row
      ]?.[store.ladderCursor.col];
      const action = ladderKeyToAction(profile.shortcuts, event, {
        cursor: store.ladderCursor,
        mode: store.ladderMode,
        // Phase 7 §5.2: a↔b の切換の行を持たない方言では、b接点キーが接点の上で切換になる
        cellIsContact: atCursor?.kind === 'contact',
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
        case 'place':
          // 入口A。入口B・Cと同じ合流点（`runPlace`）へ倒す（設計 §5.3）
          runPlace(action.kind);
          break;
        case 'edit': {
          const net = current.networks.find((n) => n.id === store.ladderCursor.networkId);
          if (net === undefined) break;
          // 指摘 LE-2: undo 直後はカーソルが範囲外を指すことがある。`cellAt()` は範囲外で
          // 例外を投げるので、ここは undefined を許して黙って諦める（丸めは store 側で行う）
          const cell = net.cells[store.ladderCursor.row]?.[store.ladderCursor.col];
          if (cell === undefined) break;
          if (cell.kind === 'empty' || cell.kind === 'hline' || cell.kind === 'vline') break;
          setPending({ kind: 'contact-no', form: formForCell(cell, profile), replace: true });
          break;
        }
        case 'ruleLine':
          commit(applyRuleLine(current, store.ladderCursor, action.direction));
          break;
        case 'deleteLine':
          commit(removeRuleLine(current, store.ladderCursor, action.line));
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
          // §10.6 の「F1 ヘルプ」。取扱説明書の引き出しをモードDの節で開く（取扱説明書 設計 決定表#16）。
          // 止めておかないと、窓口（`HelpRoot`）の `F1` も走って開いた直後に閉じる。
          // `event` はここでは React の合成イベントなので、`stopPropagation()` は下の本物の
          // イベントにも伝わって `window` の listener には届かない。`preventDefault()`（switch の
          // 手前で既に呼んである）と併せて、伝播の経路が変わっても `defaultPrevented` で弾ける。
          event.preventDefault();
          event.stopPropagation();
          useHelpStore.getState().openHelp('plc');
          break;
        case 'disabled':
          store.toast(action.entry.note ?? action.entry.label, 'error');
          break;
        case 'readOnly':
          // キー、無ければツールバーの項目名を方言から引く（Plan 4B Task 3 / レビュー I8）
          store.toast(JA.ladder.readOnly(writeModeLabel(profile)), 'error');
          break;
        case 'blur':
          // 指摘 LE-13: `Tab` を飲み込んだままにしない唯一の脱出口
          editorRef.current?.blur();
          break;
        default:
          break;
      }
    },
    [commit, gridCols, onConvert, onModeChange, profile, runPlace],
  );

  /** 見た目（セル寸法・コメント行数）はスキンが持つ（Plan 4B 決定表#6）。 */
  const theme = useMemo(() => skinThemeOf(profile), [profile]);

  if (program === undefined) return <div className={styles.editor} data-testid="ladder-editor" />;

  return (
    <div
      ref={editorRef}
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
        entry={gridEntry}
        dragPlace={theme.dragPlace === true}
        /*
         * 「変換」を持つメーカー（三菱・シャープ）だけ、変換していない回路ブロックの背景を
         * 灰色にする（設計 §5.4）。`F4` が通ると `converted` が真になって白へ戻る。
         */
        unconverted={profile.convertStep && !converted}
      />
      {menu === undefined ? null : (
        /*
         * 入口C の記号メニュー。押された場所（`clientX` / `clientY`）に浮かべる。
         * 並びとキーの併記はツールバーの記号ボタンと同じ（`ENTRY_ITEMS`）。
         */
        <div
          className={styles.cellMenu}
          data-testid="cell-menu"
          role="menu"
          aria-label={JA.ladder.entry.menu}
          style={{ left: menu.x, top: menu.y }}
        >
          {ENTRY_ITEMS.map((item) => {
            const key = item.actions
              .map((action) => shortcutKeyOf(profile, action))
              .find((found) => found !== undefined);
            return (
              <button
                key={item.kind}
                type="button"
                role="menuitem"
                data-testid={`cell-menu-${item.kind}`}
                onClick={() => {
                  setMenu(undefined);
                  runPlace(item.kind, menu.cursor);
                }}
              >
                <SymbolIcon kind={item.kind} />
                {key === undefined ? item.label : JA.ladder.entry.withKey(item.label, key)}
              </button>
            );
          })}
        </div>
      )}
      {pending === undefined ? null : (
        <DeviceInput
          initial={pending.form}
          profile={profile}
          title={theme.entryTitle}
          // 応用命令欄（三菱 `F8` ／ OMRON `I`）。設計 §5.2
          application={pending.kind === 'application'}
          // CX-Programmer 風はデバイスのあとにコメント欄が続く（設計 §5.2 の S4）
          commentStep={theme.entryCommentStep === true}
          onCancel={closeInput}
          onCommit={(cell, extra) => {
            const store = useStore.getState();
            const current = store.ladder;
            if (current === undefined) return;
            if (store.ladderMode !== 'write') {
              store.toast(JA.ladder.readOnly(writeModeLabel(profile)), 'error');
              return;
            }
            /*
             * OR接点として置くか。押したキー（`or-*`）だけでなく、1行入力に並列の命令
             * （`OR X1`）を書いたときも分岐にする（設計 §5.3）。
             */
            const isBranch =
              extra.branch === true ||
              pending.kind === 'or-contact-no' ||
              pending.kind === 'or-contact-nc';
            // `Enter` での編集は挿入モードでも置き換える（右のセルをずらさない。D2）
            const insert = !pending.replace && store.insertMode === 'insert';
            const committed = commit(
              isBranch
                ? applyOrContact(current, store.ladderCursor, cell)
                : applyLadderCell(current, store.ladderCursor, cell, insert),
            );
            if (!committed) return;
            /*
             * 確定したらカーソルを右へ送る（GX Works3 と同じ。続けて接点を並べられる）。
             * 指摘 LE-5: OR接点は `applyOrContact()` が「閉じ側の縦線」を `cursor.col + 1` に
             * 引くので、常に+1だと縦線の上に乗ってしまい、続けて記号を置くとその縦線を
             * 上書きして下の行の分岐が孤立する。OR接点のときだけ2列（縦線の次）へ送る。
             */
            const step = isBranch ? 2 : 1;
            /*
             * CX-Programmer 風の2段目で書かれたデバイスコメント（設計 §5.2 の S4）。
             * 既存の `CommentPanel` と同じ置き場所（`ladderComments`）へ入れる。
             */
            if (extra.comment !== undefined && 'device' in cell) {
              useStore.getState().setDeviceComment(deviceLabel(cell.device), extra.comment);
            }
            const after = useStore.getState();
            if (after.ladder !== undefined) {
              after.setLadderCursor(
                moveCursor(after.ladder, after.ladderCursor, 0, step, gridCols),
              );
            }
            closeInput();
          }}
        />
      )}
    </div>
  );
}
