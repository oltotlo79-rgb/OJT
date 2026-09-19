import type { BoardDefinition } from '@ojt/board-model';
import type { AssembleProblem } from '@ojt/content';
import { validateDocument, type SchematicDocument, type SchematicEdit } from '@ojt/schematic-core';
import { useMemo, useState, type JSX, type KeyboardEvent } from 'react';
import { JA } from '../i18n/ja.js';
import {
  branchDisabledReason,
  branchStepHint,
  cellCount,
  keyToEdit,
  moveCursor,
  paletteFor,
  pickBranchNode,
  type BranchDraft,
  type BranchOutcome,
  type EditorCursor,
  type PaletteItem,
  type SchematicHistory,
} from '../session/schematic-edit.js';
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
 */

/**
 * 指摘の1行。`validateDocument()` の文面は内部ID（`r1` / `c01`）と内部の経路
 * （`rungs[0].cells[1]`）を含むが、**画面に内部IDは出さない**約束なので
 * 「1段目」「1段目の2番目」に読み替える（利用者要求「分かりやすく直感的に」）。
 */
function issueText(doc: SchematicDocument, message: string): string {
  const names: Array<{ id: string; text: string }> = [];
  doc.rungs.forEach((r, ri) => {
    names.push({ id: r.id, text: `${ri + 1}段目` });
    r.cells.forEach((cell, ci) => {
      names.push({ id: cell.id, text: `${ri + 1}段目の${ci + 1}番目` });
    });
  });
  // 長いIDから先に置き換える（`r1` が `r1h` の一部に当たらないようにする）
  names.sort((a, b) => b.id.length - a.id.length);
  let out = message.replace(
    /rungs\[(\d+)\](?:\.cells\[(\d+)\])?(\.from|\.to)?/gu,
    (_match, ri: string, ci: string | undefined, end: string | undefined) =>
      `${Number(ri) + 1}段目` +
      (ci === undefined ? '' : `の${Number(ci) + 1}番目`) +
      (end === '.from' ? 'の始点' : end === '.to' ? 'の終点' : ''),
  );
  for (const { id, text } of names) {
    // `r1#2`（節点の指し方）を先に処理してから、ID単体を置き換える
    out = out.split(`${id}#`).join(`${text}の節点`).split(id).join(text);
  }
  return out;
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
  highlightCellIds,
  onEdit,
  onCursor,
  onUndo,
  onRedo,
  onVerify,
  onPickCell,
  onRefuse,
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
  /** 配線ガイドで光らせる要素（Task 8 が渡す）。 */
  highlightCellIds?: readonly string[];
  onEdit: (edit: SchematicEdit) => void;
  onCursor: (cursor: EditorCursor) => void;
  onUndo: () => void;
  onRedo: () => void;
  onVerify: () => void;
  onPickCell: (cellId: string | undefined) => void;
  /** 断られた操作の理由（画面はトーストに出す）。 */
  onRefuse: (message: string) => void;
}): JSX.Element {
  const palette = useMemo(() => paletteFor(problem, board), [problem, board]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const selected = palette.find((i) => i.id === selectedId);
  const issues = useMemo(() => validateDocument(doc), [doc]);
  const steps = schematicSteps({ cellCount: cellCount(doc), verified, boardWired });
  const currentStep = steps.find((s) => s.state === 'current')?.key;

  /**
   * 分岐の下書き。**ここだけが編集中の一時状態**で、確定した形は `setEnds` として親へ渡る。
   * 文書やカーソルと違って「途中でやめられる」ものなので、ストアには置かない。§11.4 / B1
   */
  const [branch, setBranch] = useState<BranchDraft | undefined>(undefined);
  const branchReason = branchDisabledReason(doc, cursor.rungId);
  const branchHint = branchStepHint(branch);

  /** 分岐の節点を1つ選んだ結果を反映する（クリックでもキーでも同じ道を通る）。 */
  const applyBranchPick = (picked: BranchOutcome): void => {
    if (picked.kind === 'refused') {
      onRefuse(picked.message);
      return;
    }
    if (picked.kind === 'draft') {
      setBranch(picked.branch);
      return;
    }
    setBranch(undefined);
    onEdit(picked.edit);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
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
   */
  const onPickSlot = (rungId: string, index: number, cellId?: string): void => {
    if (branch !== undefined) {
      applyBranchPick(pickBranchNode(doc, branch, { rungId, node: index }));
      return;
    }
    onCursor({ rungId, index });
    if (selected === undefined) {
      onPickCell(cellId);
      return;
    }
    const draft = { kind: selected.kind, device: selected.device };
    onEdit(
      cellId === undefined
        ? { kind: 'insertCell', rungId, index, draft }
        : { kind: 'replaceCell', cellId, draft },
    );
  };

  /** 「検算」を押せない理由（押せるときは検算の但し書き）。完了条件の「画面の品質」 */
  const verifyTitle = verifying
    ? JA.schematic.verifying
    : issues.length === 0
      ? JA.schematic.verifyNote
      : issueText(doc, issues[0]?.message ?? '');

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
          <button
            type="button"
            onClick={() => {
              onEdit({ kind: 'addRung', after: cursor.rungId });
            }}
          >
            {JA.schematic.addRung}
          </button>
          <button
            type="button"
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

      <div className={styles.stepGuide} data-testid="schematic-step-guide">
        <ol className={styles.stepList} aria-label={JA.stepGuide.label}>
          {steps.map((step) => (
            <li
              key={step.key}
              className={styles.step}
              data-state={step.state}
              data-testid={`schematic-step-${step.key}`}
              {...(step.state === 'current' ? { 'aria-current': 'step' as const } : {})}
            >
              {step.label}
            </li>
          ))}
        </ol>
        {/* 分岐のあいだは「いま何をすればよいか」を分岐の案内に差し替える（決定表#24） */}
        {branchHint === undefined ? (
          <p className={styles.stepHint}>{schematicStepHint(currentStep)}</p>
        ) : (
          <p
            className={styles.branchHint}
            data-testid="branch-hint"
            role="status"
            aria-live="polite"
          >
            {branchHint}
          </p>
        )}
      </div>

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
          */}
          <SchematicSvg
            document={doc}
            cursor={cursor}
            {...(highlightCellIds === undefined ? {} : { highlightCellIds })}
            onPickCell={onPickCell}
            onPickSlot={onPickSlot}
          />
          <p className={styles.keyHint}>{JA.schematic.keyHint}</p>
        </div>
      </div>

      <section className={styles.issues} data-testid="schematic-issues">
        <h3 className={styles.issuesTitle}>{JA.schematic.issues}</h3>
        {issues.length === 0 ? (
          <p className={styles.issuesOk}>{JA.schematic.noIssues}</p>
        ) : (
          <ul className={styles.issueList}>
            {issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>{issueText(doc, issue.message)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
