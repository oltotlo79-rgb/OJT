import { isAssembleProblem, type SupportedProblem, type VerifyResult } from '@ojt/content';
import {
  applyEdit,
  editLabel,
  emptySchematic,
  type SchematicDocument,
  type SchematicEdit,
} from '@ojt/schematic-core';
import type { StateCreator } from 'zustand';
import { JA } from '../i18n/ja.js';
import {
  clampCursor,
  cursorAfterEdit,
  emptySchematicHistory,
  issueText,
  pushSchematic,
  redoSchematic,
  undoSchematic,
  type EditorCursor,
  type SchematicHistory,
} from '../session/schematic-edit.js';
import type { AppState } from './store.js';

/**
 * 回路図エディタ（下書きと検算）のスライス。設計仕様 §11.4（指摘 DS-3）。
 * モードBの課題を開いたときだけ下書きを持ち、離れるときに `schematicFields()` で手放す。
 */

/**
 * 回路図エディタの状態の初期値（課題を開く・課題を離れるときに必ずここへ戻す）。§11.4
 *
 * `plcFields()` と同じ流儀で1箇所にまとめる。同じ5項目を呼び出し側で書き写すと、
 * どれか1箇所を直し忘れたときに課題をまたいで下書きが残る（MERGE 注意 #2）。
 * モードB以外は下書きを持たない（3Dだけの画面が回路図を持たないのと同じ）。
 * 下書きは**空の文書**で始める（決定表#2: 課題の模範回路は絶対に入れない）。
 */
export function schematicFields(
  problem?: SupportedProblem,
): Pick<
  SchematicSlice,
  | 'schematicDoc'
  | 'schematicHistory'
  | 'schematicCursor'
  | 'verifying'
  | 'verifyResult'
  | 'verifyingDoc'
> {
  return {
    schematicDoc:
      problem !== undefined && isAssembleProblem(problem)
        ? emptySchematic(`draft-${problem.id}`, `${problem.title}（下書き）`)
        : undefined,
    schematicHistory: emptySchematicHistory(),
    schematicCursor: { rungId: 'r1', index: 0 },
    verifying: false,
    verifyResult: undefined,
    verifyingDoc: undefined,
  };
}

/**
 * 図が変わったときの検算まわりの巻き戻し。§11.4 / 決定表#6 / レビュー I2
 *
 * 前の結果を捨て、「検算中…」を下ろす。**依頼の宛先（`verifyingDoc`）は残す**：走っている
 * 検算の結果が後から届いたときに、`setVerifyResult()` が「いまの図と違う＝古い」と見抜くのに
 * 要る（直したあとの図に、直す前の図の判定を出さない）。
 */
function staleVerify(): Pick<SchematicSlice, 'verifying' | 'verifyResult'> {
  return { verifying: false, verifyResult: undefined };
}

/** 検算の往復だけを下ろす（前の結果は残す）。Worker が落ちたときと、古い結果を捨てるとき。 */
function staleVerifying(): Pick<SchematicSlice, 'verifying' | 'verifyingDoc'> {
  return { verifying: false, verifyingDoc: undefined };
}

/** 回路図エディタの状態と操作。 */
export interface SchematicSlice {
  // --- /Plan 5 Task 9 ---

  // --- Plan 5 Task 6 ---
  /** 回路図エディタの下書き（モードBの課題を開くと空の文書で始まる）。§11.4 */
  schematicDoc: SchematicDocument | undefined;
  /** 下書きの元に戻す／やり直し。§11.4 */
  schematicHistory: SchematicHistory;
  /** 編集カーソル。§11.4 */
  schematicCursor: EditorCursor;
  /** 検算の往復中か。§11.4 */
  verifying: boolean;
  /** 直近の検算の結果（課題を開き直すと消える）。§11.4 */
  verifyResult: VerifyResult | undefined;
  /**
   * いま走っている検算が見ている文書（走っていなければ undefined）。§11.4 / レビュー I2
   *
   * 検算は Worker との往復なので、待っているあいだにも図は直せる。何も目印を持たないと
   * 「直したあとの図」に「直す前の図の結果」が出てしまうので、依頼のときの文書そのものを
   * 控えておき、結果が届いたときに**いまの文書と同じものか**を見る（編集は必ず新しい
   * 文書を作るので、参照の同一性でそのまま判別できる）。
   */
  verifyingDoc: SchematicDocument | undefined;

  // --- /Plan 5 Task 9 ---
  // --- Plan 5 Task 6 ---
  /** 下書きをまるごと差し替える（作業ファイルからの復元）。§11.4 / §12.3 */
  setSchematicDoc: (doc: SchematicDocument) => void;
  /** 編集を1つ当てる。断られたら理由をトーストに出して `false` を返す。§11.4 */
  applySchematicEdit: (edit: SchematicEdit) => boolean;
  /** 編集カーソルを動かす。§11.4 */
  setSchematicCursor: (cursor: EditorCursor) => void;
  /** 下書きを1手戻す（戻せたら `true`）。§11.4 */
  undoSchematicEdit: () => boolean;
  /** 下書きを1手やり直す（やり直せたら `true`）。§11.4 */
  redoSchematicEdit: () => boolean;
  /** 検算の往復を始める・終える。§11.4 */
  setVerifying: (verifying: boolean) => void;
  /** 検算の結果を入れる（往復も終わる）。古い文書あての結果は捨てる。§11.4 / レビュー I2 */
  setVerifyResult: (result: VerifyResult | undefined) => void;
  /** 描いた回路図をすべて消す（空の1段に戻す。確認は画面側）。§11.4 */
  clearSchematic: () => boolean;
}

/** 回路図エディタのスライス。 */
export const createSchematicSlice: StateCreator<AppState, [], [], SchematicSlice> = (set, get) => ({
  ...schematicFields(),

  // --- /Plan 5 Task 9 ---
  // --- Plan 5 Task 6 ---
  setSchematicDoc: (schematicDoc) => {
    set({
      schematicDoc,
      schematicCursor: clampCursor(schematicDoc, get().schematicCursor),
      ...staleVerify(),
    });
  },
  /**
   * 編集を1つ当てる。断られたらトーストに理由を出して `false` を返す（盤のコマンドと同じ流儀）。
   * 成功したら**編集前の文書**を履歴に積み、カーソルを文書の中へ収め直す。§11.4
   */
  applySchematicEdit: (edit) => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const outcome = applyEdit(doc, edit);
    if (!outcome.ok) {
      // 断りの文面にも内部ID（`r3` / `c01`）は出さない（レビュー I3）
      get().toast(issueText(doc, outcome.message), 'error');
      return false;
    }
    set({
      schematicDoc: outcome.doc,
      schematicHistory: pushSchematic(get().schematicHistory, doc),
      // 置いたら次の桁へ進める（Enter を3回で PB1 → PB2 → CR1 の順に並ぶ）。レビュー I1
      schematicCursor: cursorAfterEdit(outcome.doc, get().schematicCursor, edit),
      // 文書が変わったら前回の検算結果は古い（決定表#6 / レビュー I2）
      ...staleVerify(),
    });
    // 操作ログにも内部IDは出さない（レビュー I3）
    get().addLog(issueText(doc, editLabel(edit)));
    return true;
  },
  setSchematicCursor: (schematicCursor) => {
    const doc = get().schematicDoc;
    set({
      schematicCursor: doc === undefined ? schematicCursor : clampCursor(doc, schematicCursor),
    });
  },
  undoSchematicEdit: () => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const step = undoSchematic(get().schematicHistory, doc);
    if (step === undefined) return false;
    set({
      schematicDoc: step.doc,
      schematicHistory: step.history,
      schematicCursor: clampCursor(step.doc, get().schematicCursor),
      ...staleVerify(),
    });
    return true;
  },
  redoSchematicEdit: () => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const step = redoSchematic(get().schematicHistory, doc);
    if (step === undefined) return false;
    set({
      schematicDoc: step.doc,
      schematicHistory: step.history,
      schematicCursor: clampCursor(step.doc, get().schematicCursor),
      ...staleVerify(),
    });
    return true;
  },
  setVerifying: (verifying) => {
    // 依頼の宛先（いまの文書）を控える。結果が届いたときに古いかどうかを見る（レビュー I2）
    set(verifying ? { verifying: true, verifyingDoc: get().schematicDoc } : staleVerifying());
  },
  setVerifyResult: (verifyResult) => {
    const asked = get().verifyingDoc;
    /*
     * 依頼したときの図といまの図が違えば、この結果は**古い図の答え**なので捨てる
     * （レビュー I2）。依頼を控えていない場合（作業ファイルの復元や試験の直接投入）は
     * 比べようが無いのでそのまま受ける。
     */
    if (asked !== undefined && asked !== get().schematicDoc) {
      set(staleVerifying());
      return;
    }
    set({ verifyResult, verifying: false, verifyingDoc: undefined });
  },
  /** 描いた回路図をすべて消す（1手で元に戻せる）。確認は画面側が取る。§11.4 */
  clearSchematic: () => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const empty = emptySchematic(doc.id, doc.title);
    set({
      schematicDoc: empty,
      schematicHistory: pushSchematic(get().schematicHistory, doc),
      schematicCursor: clampCursor(empty, get().schematicCursor),
      ...staleVerify(),
    });
    get().addLog(JA.schematic.cleared);
    get().toast(JA.schematic.cleared, 'info');
    return true;
  },
});
