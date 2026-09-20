import type { BoardDefinition } from '@ojt/board-model';
import type { AssembleProblem } from '@ojt/content';
import {
  DEFAULT_EDIT_PRESET_MS,
  MAX_RUNGS,
  validateDocument,
  type SchematicDocument,
  type SchematicEdit,
} from '@ojt/schematic-core';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { JA, secondsLabel } from '../i18n/ja.js';
import { shouldIgnoreShortcut } from '../session/interaction.js';
import {
  branchDisabledReason,
  branchStepHint,
  cellCount,
  cursorText,
  issueText,
  keyToEdit,
  moveCursor,
  paletteFor,
  pickBranchNode,
  presetFromText,
  presetSecondsText,
  stepPreset,
  timerCoilUnder,
  PRESET_MAX_MS,
  PRESET_MIN_MS,
  PRESET_STEP_MS,
  type BranchDraft,
  type BranchOutcome,
  type EditorCursor,
  type PaletteItem,
  type SchematicHistory,
} from '../session/schematic-edit.js';
import { StepGuide } from '../panels/StepGuide.js';
import { schematicStepHint, schematicSteps } from '../session/step-guide.js';
import { SchematicPalette } from './SchematicPalette.js';
import { SchematicSvg } from './SchematicSvg.js';
import styles from './schematic.module.css';

/**
 * 回路図エディタ。設計仕様 §11.4。
 *
 * 状態（文書・カーソル・履歴）は**すべて親（ストア）が持つ**（`LadderEditor` と同じ流儀）。
 * ここは「描く・選ぶ・キーを編集操作に直す」だけで、編集そのものは `onEdit` に投げる。
 * 作りかけの文書は許し（決定表#3）、`validateDocument()` の指摘は下の欄に出し続ける。
 *
 * 画面に出す文面（指摘・案内・カーソル位置）は `session/schematic-edit.ts` の `issueText()` /
 * `cursorText()` を通す。**内部ID（`r1` / `c01`）は1文字も画面に出さない**（レビュー I3）。
 */

/**
 * 設定時間の欄（タイマコイルにカーソルがあるときだけ出る）。§5.3.2 / §17.2 #12 / レビュー B1
 *
 * 打ち込みの途中（`0.` や空欄）は `presetFromText()` が `undefined` を返すので**送らない**。
 * 打ち込んでいるあいだは外からの値で書き戻さない（値が飛んでカーソルが跳ねるのを防ぐ）。
 * ＋／− は実機（H3Y-4 の0〜10秒レンジ）と同じ 0.1 秒刻みで、押し代は32px以上。
 */
function PresetField({
  cellId,
  device,
  presetMs,
  onChange,
}: {
  /** どの要素の設定時間か（要素が変わったら欄を作り直す）。 */
  cellId: string;
  device: string;
  presetMs: number;
  onChange: (presetMs: number) => void;
}): JSX.Element {
  const inputId = useId();
  const [text, setText] = useState(() => presetSecondsText(presetMs));
  /** 打ち込んでいる最中か（外からの値で書き戻してよいかの判断）。 */
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(presetSecondsText(presetMs));
  }, [cellId, presetMs]);

  const atMin = presetMs <= PRESET_MIN_MS;
  const atMax = presetMs >= PRESET_MAX_MS;
  return (
    <div className={styles.presetBar} data-testid="schematic-preset">
      <label className={styles.presetLabel} htmlFor={inputId}>
        {`${JA.schematic.preset}（${device}）`}
      </label>
      <button
        type="button"
        className={styles.presetStep}
        data-testid="preset-down"
        disabled={atMin}
        aria-label={JA.schematic.presetDown}
        title={atMin ? JA.schematic.presetAtMin : JA.schematic.presetDown}
        onClick={() => {
          onChange(stepPreset(presetMs, -1));
        }}
      >
        −
      </button>
      <input
        id={inputId}
        className={styles.presetInput}
        data-testid="preset-input"
        type="number"
        inputMode="decimal"
        min={PRESET_MIN_MS / 1000}
        max={PRESET_MAX_MS / 1000}
        step={PRESET_STEP_MS / 1000}
        value={text}
        onFocus={() => {
          typing.current = true;
        }}
        onBlur={() => {
          typing.current = false;
          setText(presetSecondsText(presetMs));
        }}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const ms = presetFromText(next);
          if (ms !== undefined && ms !== presetMs) onChange(ms);
        }}
      />
      <button
        type="button"
        className={styles.presetStep}
        data-testid="preset-up"
        disabled={atMax}
        aria-label={JA.schematic.presetUp}
        title={atMax ? JA.schematic.presetAtMax : JA.schematic.presetUp}
        onClick={() => {
          onChange(stepPreset(presetMs, 1));
        }}
      >
        ＋
      </button>
      <span className={styles.presetValue} data-testid="preset-value">
        {secondsLabel(presetMs)}
      </span>
      <span className={styles.presetHint}>{JA.schematic.presetHint}</span>
    </div>
  );
}

/** エディタ。 */
export function SchematicEditor({
  problem,
  board,
  document: doc,
  cursor,
  history,
  verifying,
  verified = false,
  boardWired = false,
  showStepGuide = true,
  highlightCellIds,
  onEdit,
  onCursor,
  onUndo,
  onRedo,
  onVerify,
  onClear,
  onPickCell,
  onRefuse,
  onNotice,
}: {
  problem: AssembleProblem;
  board: BoardDefinition;
  document: SchematicDocument;
  cursor: EditorCursor;
  history: SchematicHistory;
  /** 検算の往復中（ボタンを止める）。 */
  verifying: boolean;
  /** 直近の検算に合格しているか（手順帯に出す）。 */
  verified?: boolean;
  /** 盤に電線を張ったか（手順帯に出す）。 */
  boardWired?: boolean;
  /**
   * このエディタ自身の手順帯（描く／検算／盤に配線）を出すか。既定は出す。
   * `Session.tsx` が `assembleView === 'schematic'`（エディタだけを表示）のときは
   * 上の帯を同じ3段に差し替えるので、ここでは出さずに二重表示を避ける（レビュー指摘 UX-04）。
   * `並べて`（盤とエディタを両方表示）は上の帯が盤の4段のままなので、ここは出したままにする。
   */
  showStepGuide?: boolean;
  /** 配線ガイドで光らせる要素（Task 8 が渡す）。 */
  highlightCellIds?: readonly string[];
  /** 編集を1つ当てる。**受け入れられたら `true`**（断られたら分岐の指定は続ける）。 */
  onEdit: (edit: SchematicEdit) => boolean;
  onCursor: (cursor: EditorCursor) => void;
  onUndo: () => void;
  onRedo: () => void;
  onVerify: () => void;
  /** 「全部消す」（確認のうえで空の1段に戻す）。省略するとボタンを出さない。 */
  onClear?: () => void;
  onPickCell: (cellId: string | undefined) => void;
  /** 断られた操作の理由（画面はトーストに出す）。 */
  onRefuse: (message: string) => void;
  /** 済んだことの知らせ（画面はトーストに出す）。 */
  onNotice?: (message: string) => void;
}): JSX.Element {
  const palette = useMemo(() => paletteFor(problem, board), [problem, board]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const selected = palette.find((i) => i.id === selectedId);
  const issues = useMemo(() => validateDocument(doc), [doc]);
  const steps = schematicSteps({ cellCount: cellCount(doc), verified, boardWired });
  const currentStep = steps.find((s) => s.state === 'current')?.key;
  const timerCoil = timerCoilUnder(doc, cursor);

  /**
   * 分岐の下書き。**ここだけが編集中の一時状態**で、確定した形は `setEnds` として親へ渡る。
   * 文書やカーソルと違って「途中でやめられる」ものなので、ストアには置かない。§11.4 / B1
   */
  const [branch, setBranch] = useState<BranchDraft | undefined>(undefined);
  /** 「全部消す」の確認待ち（Electron では `window.confirm()` を使わない。§12.3 と同じ流儀）。 */
  const [clearAsk, setClearAsk] = useState(false);
  const branchReason = branchDisabledReason(doc, cursor.rungId);
  const branchHint = branchStepHint(doc, branch);

  /**
   * 親から渡される関数は**描き直すたびに別物**になる（`Session.tsx` はその場で作った関数を渡す）。
   * `useCallback` の依存に入れると `onPickSlot` も毎回作り直され、`SchematicSvg` の当たり矩形の
   * `useMemo`（`slotRects()`）が毎回捨てられる（レビュー I7）。呼ぶときに最新のものを読めば
   * 足りるので、ref に置いて依存から外す。
   */
  const handlers = useRef({ onCursor, onEdit, onPickCell, onRefuse, onNotice });
  useEffect(() => {
    handlers.current = { onCursor, onEdit, onPickCell, onRefuse, onNotice };
  });

  /*
   * 画面を切り替える（F2）とこの部品ごと消えるので、指定しかけの分岐は残せない。
   * 黙って消えると「始点を選んだのに効かない」と見えるので、**やめたことを必ず知らせる**。
   * 後始末の中では最新の state を読めないので ref に写しておく。
   */
  const branchRef = useRef<BranchDraft | undefined>(undefined);
  useEffect(() => {
    branchRef.current = branch;
  }, [branch]);
  useEffect(
    () => () => {
      if (branchRef.current !== undefined) handlers.current.onNotice?.(JA.schematic.branchAborted);
    },
    [],
  );

  /** 分岐の節点を1つ選んだ結果を反映する（クリックでもキーでも同じ道を通る）。 */
  const applyBranchPick = useCallback((picked: BranchOutcome): void => {
    if (picked.kind === 'refused') {
      handlers.current.onRefuse(picked.message);
      return;
    }
    if (picked.kind === 'draft') {
      setBranch(picked.branch);
      return;
    }
    /*
     * 断られる形（参照の循環など）もあるので、**受け入れられたときだけ**分岐モードを抜ける。
     * 断られたときは始点から選び直せるようにする（理由はストアがトーストに出す）。
     */
    if (handlers.current.onEdit(picked.edit)) {
      setBranch(undefined);
      handlers.current.onNotice?.(JA.schematic.branchDone);
      return;
    }
    setBranch({ rungId: picked.edit.rungId });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    /*
     * 設定時間の数値欄に打ち込んだキーは格子へ通さない（決定表#25）。
     * 通すと `3` の打鍵で要素が置かれ、`Delete` で要素が消える（盤と同じ取り違え。§8.2）。
     */
    const ignore = shouldIgnoreShortcut({
      target: event.target,
      isComposing: event.nativeEvent.isComposing,
    });
    if (ignore) return;
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      onCursor(moveCursor(doc, cursor, event.key));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'y')) {
      event.preventDefault();
      if (event.key === 'z') onUndo();
      else onRedo();
      return;
    }
    if (branch !== undefined && event.key === 'Escape') {
      event.preventDefault();
      setBranch(undefined);
      return;
    }
    if (branch !== undefined && event.key === 'Enter') {
      event.preventDefault();
      applyBranchPick(pickBranchNode(doc, branch, { rungId: cursor.rungId, node: cursor.index }));
      return;
    }
    // 分岐中は `keyToEdit()` が（Enter 以外を）必ず `undefined` にするので、誤って要素が消えない
    const edit = keyToEdit(doc, cursor, event.key, selected, { ctrl: event.ctrlKey }, branch);
    if (edit === undefined) return;
    event.preventDefault();
    onEdit(edit);
  };

  const pickPalette = (item: PaletteItem): void => {
    setSelectedId(item.id === selectedId ? undefined : item.id);
  };

  /**
   * 桁をクリックしたとき。**順に3通り**（B2）:
   * ①分岐中なら節点を選ぶ、②パレットを選んでいなければその要素を光らせる（配線ガイド）、
   * ③パレットを選んでいれば置く（空き桁）か置き換える（要素のある桁）。
   *
   * `useCallback` で包むのは `SchematicSvg` の当たり矩形（`slotRects()`）の `useMemo` を
   * 毎回捨てさせないため（レビュー I7）。③ではカーソルを別に送らない：置いた／置き換えた
   * 結果からストアが決めるので、書き込みは1回で済む（レビュー I1 / Minor）。
   */
  const onPickSlot = useCallback(
    (rungId: string, index: number, cellId?: string): void => {
      if (branch !== undefined) {
        applyBranchPick(pickBranchNode(doc, branch, { rungId, node: index }));
        return;
      }
      if (selected === undefined) {
        handlers.current.onCursor({ rungId, index });
        handlers.current.onPickCell(cellId);
        return;
      }
      const draft = { kind: selected.kind, device: selected.device };
      handlers.current.onEdit(
        cellId === undefined
          ? { kind: 'insertCell', rungId, index, draft }
          : { kind: 'replaceCell', cellId, draft },
      );
    },
    [applyBranchPick, branch, doc, selected],
  );

  /** 「検算」を押せない理由（押せるときは検算の但し書き）。完了条件の「画面の品質」 */
  const verifyTitle = verifying
    ? JA.schematic.verifying
    : issues.length === 0
      ? JA.schematic.verifyNote
      : issueText(doc, issues[0]?.message ?? '');
  const rungFull = doc.rungs.length >= MAX_RUNGS;
  const lastRung = doc.rungs.length <= 1;
  const nothingDrawn = cellCount(doc) === 0 && lastRung;
  /**
   * まだ何も編集していない（開いた直後の下書き）か。§11.4 / I8 / 2026-09-20
   * 決定表#3どおり指摘は出し続けるが、**編集を1つもしていないうちは赤で驚かせない**
   * （利用者要求 2026-09-20「回路図のクオリティ」：未編集の回路図に赤い指摘が出ている）。
   * 1つでも編集すれば（取り消して元に戻っても）以降は通常の赤で示す。
   */
  const touched = history.done.length > 0;

  return (
    <div className={styles.editor} data-testid="schematic-editor">
      <div className={styles.editorHead}>
        <h2 className={styles.editorTitle}>{JA.schematic.title}</h2>
        <div className={styles.editorTools}>
          <button
            type="button"
            disabled={history.done.length === 0}
            title={history.done.length === 0 ? JA.disabledReason.undo : JA.schematic.undo}
            onClick={onUndo}
          >
            {JA.schematic.undo}
          </button>
          <button
            type="button"
            disabled={history.undone.length === 0}
            title={history.undone.length === 0 ? JA.disabledReason.redo : JA.schematic.redo}
            onClick={onRedo}
          >
            {JA.schematic.redo}
          </button>
          {/* 押せない理由は必ず `title` に出す（完了条件の「画面の品質」。レビュー Minor） */}
          <button
            type="button"
            data-testid="add-rung-button"
            disabled={rungFull}
            title={rungFull ? JA.schematic.addRungFull : JA.schematic.addRungHint}
            onClick={() => {
              onEdit({ kind: 'addRung', after: cursor.rungId });
            }}
          >
            {JA.schematic.addRung}
          </button>
          <button
            type="button"
            data-testid="remove-rung-button"
            disabled={lastRung}
            title={lastRung ? JA.schematic.removeRungLast : JA.schematic.removeRungHint}
            onClick={() => {
              onEdit({ kind: 'removeRung', rungId: cursor.rungId });
            }}
          >
            {JA.schematic.removeRung}
          </button>
          {/*
            分岐（§11.1 の分岐点）。自己保持回路は「両端が別の段の節点にある段」を1本引かないと
            描けない（受入基準①）。押せないときは `title` に理由を出す（完了条件の「画面の品質」）。
            分岐中は「やめる」になるので、`branchReason` があっても**押せるままにする**。
          */}
          <button
            type="button"
            data-testid="branch-button"
            aria-pressed={branch !== undefined}
            disabled={branch === undefined && branchReason !== undefined}
            title={
              branch === undefined
                ? (branchReason ?? JA.schematic.branchHint)
                : JA.schematic.branchCancel
            }
            onClick={() => {
              setBranch(branch === undefined ? { rungId: cursor.rungId } : undefined);
            }}
          >
            {branch === undefined ? JA.schematic.branch : JA.schematic.branchCancel}
          </button>
          {onClear === undefined ? null : (
            <button
              type="button"
              data-testid="clear-button"
              aria-pressed={clearAsk}
              disabled={nothingDrawn}
              title={nothingDrawn ? JA.schematic.clearNothing : JA.schematic.clearConfirm}
              onClick={() => {
                setClearAsk(!clearAsk);
              }}
            >
              {JA.schematic.clear}
            </button>
          )}
          <button
            type="button"
            className={styles.verifyButton}
            data-testid="verify-button"
            disabled={verifying || issues.length > 0}
            title={verifyTitle}
            onClick={onVerify}
          >
            {verifying ? JA.schematic.verifying : JA.schematic.verify}
          </button>
        </div>
      </div>

      {showStepGuide ? (
        <StepGuide
          steps={steps}
          hint={branchHint === undefined ? schematicStepHint(currentStep) : undefined}
          testId={{ band: `schematic-step-guide`, step: (key) => `schematic-step-${key}` }}
          notes={false}
        >
          {/* 分岐のあいだは「いま何をすればよいか」を分岐の案内に差し替える（決定表#24） */}
          {branchHint === undefined ? null : (
            <p
              className={styles.branchHint}
              data-testid="branch-hint"
              role="status"
              aria-live="polite"
            >
              {branchHint}
            </p>
          )}
        </StepGuide>
      ) : /*
       * レビュー指摘 UX-04: `showStepGuide=false`（Session.tsx が上の帯を回路図の3段に
       * 差し替え済み）のときは「済／いまここ」の帯を二重に出さない。ただし分岐の案内
       * （`branchHint`）は「いまここ」の状態表示ではなく直後の操作を促す一時的な案内なので、
       * 上の帯には無い情報として出し続ける。
       */
      branchHint === undefined ? null : (
        <p className={styles.branchHint} data-testid="branch-hint" role="status" aria-live="polite">
          {branchHint}
        </p>
      )}

      {/* 「全部消す」の確認（取り返しのつかない操作は必ず一度尋ねる）。§8.2 */}
      {clearAsk && onClear !== undefined ? (
        <p className={styles.clearAsk} data-testid="clear-confirm" role="status" aria-live="polite">
          {JA.schematic.clearConfirm}
          <button
            type="button"
            className={styles.clearYes}
            data-testid="clear-yes"
            onClick={() => {
              setClearAsk(false);
              onClear();
            }}
          >
            {JA.schematic.clearYes}
          </button>
          <button
            type="button"
            className={styles.clearNo}
            data-testid="clear-no"
            onClick={() => {
              setClearAsk(false);
            }}
          >
            {JA.schematic.clearNo}
          </button>
        </p>
      ) : null}

      <div className={styles.editorBody}>
        <SchematicPalette items={palette} selectedId={selectedId} onSelect={pickPalette} />
        {/*
          グリッドはキーボードの受け口。`tabIndex={0}` で Tab から入れるようにし、
          `aria-label` に操作の早見表を載せる（§15 のアクセシビリティ）。
        */}
        <div
          className={styles.grid}
          data-testid="schematic-grid"
          tabIndex={0}
          role="application"
          aria-label={`${JA.schematic.title}: ${JA.schematic.keyHint}`}
          onKeyDown={onKeyDown}
        >
          {/*
            `onPickCell` も渡す: 母線・銘板など**当たり矩形の外**を押したときの「選択解除」を
            従来どおり効かせるため（矩形に当たったクリックは `onPickSlot` が受ける。B2）。

            図は `gridSvgHost`（残り高さいっぱいの箱）に入れ、`fit` で箱の中に収める
            （B1 / 2026-09-20 追加報告：空の下書きで極端に拡大しない。段が増えても
            既定では全体が見えるよう縮む。読めないほど縮む場合だけ `.grid` のスクロールに任せる）。
          */}
          <div className={styles.gridSvgHost}>
            <SchematicSvg
              document={doc}
              cursor={cursor}
              {...(highlightCellIds === undefined ? {} : { highlightCellIds })}
              onPickCell={onPickCell}
              onPickSlot={onPickSlot}
              fit
            />
          </div>
          {/* タイマコイルの上にカーソルがあるときだけ出す（無関係な課題に欄を出さない）。B1 */}
          {timerCoil === undefined ? null : (
            <PresetField
              key={timerCoil.id}
              cellId={timerCoil.id}
              device={timerCoil.device}
              presetMs={timerCoil.presetMs ?? DEFAULT_EDIT_PRESET_MS}
              onChange={(presetMs) => {
                onEdit({ kind: 'setPreset', cellId: timerCoil.id, presetMs });
              }}
            />
          )}
          <p className={styles.cursorLine} data-testid="schematic-cursor">
            {`${JA.schematic.cursor}: ${cursorText(doc, cursor)}`}
          </p>
          <p className={styles.keyHint}>{JA.schematic.keyHint}</p>
        </div>
      </div>

      <section className={styles.issues} data-testid="schematic-issues">
        <h3 className={styles.issuesTitle}>{JA.schematic.issues}</h3>
        {issues.length === 0 ? (
          <p className={styles.issuesOk}>{JA.schematic.noIssues}</p>
        ) : (
          <ul
            className={touched ? styles.issueList : styles.issueListNeutral}
            data-touched={touched}
          >
            {issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>{issueText(doc, issue.message)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
