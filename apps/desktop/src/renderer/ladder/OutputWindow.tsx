import { useEffect, useRef, type JSX } from 'react';
import type { ConvertIssues } from '../app/store-types.js';
import { useStore } from '../app/store.js';
import { JA, ladderIssuePlace } from '../i18n/ja.js';
import type { LadderCursor } from '../session/ladder.js';
import { friendlyCompileMessage } from './ladder-errors.js';
import styles from './ladder.module.css';

/**
 * 出力ウィンドウ。設計仕様 §10.6 / §10.8。
 * 変換エラー（構造 → 方言）・警告・使用デバイスをこの順で1つの一覧に並べる。
 */

/** 1行の形（エラーも警告も同じ形に畳んでから描く）。 */
interface Row {
  key: string;
  severity: 'error' | 'warning';
  label: string;
  message: string;
  cursor: LadderCursor | undefined;
  place: string;
}

/** 出力ウィンドウ。 */
export function OutputWindow({
  issues,
  converted,
  convertKey,
  open,
  openKey = 0,
  onJump,
  onExport,
  exportIssues,
  title,
}: {
  issues: ConvertIssues;
  converted: boolean;
  /** 「変換」のキー。無いスキン（`convertStep: false`）では `undefined`。決定表#3 */
  convertKey: string | undefined;
  /**
   * 折りたたみの既定の開閉。スキンごとの出力ペインの形（`SkinLayout.outputPane`）に従う
   * （レビュー B2）。`window` のスキンは開いたまま、`status-bar`（PCwin風）は
   * ステータスバーの1行だけを見せて畳んでおく。
   */
  open: boolean;
  openKey?: number;
  onJump: (cursor: LadderCursor) => void;
  // --- Plan 4B Task 9 ---
  /** 命令語リストの書き出し（§10.7 / 決定表#14）。 */
  onExport: () => void;
  /** 書き出せなかった理由（`INSTRUCTION_LIST_MESSAGES` の文言＋平易な説明）。 */
  exportIssues: readonly string[];
  // --- /Plan 4B Task 9 ---
  /**
   * この欄の呼び名（Phase 7 設計 §5.5）。メーカーの言葉（`panels.output`。PCwin風は
   * 「ステータスバー」）を呼び出し側から渡す。省略すると本アプリの既定の呼び名になる。
   */
  title?: string;
}): JSX.Element {
  const networks = useStore((state) => state.ladder?.networks);
  const displayNetwork = (id?: string): string | undefined => {
    if (id === undefined) return undefined;
    const index = networks?.findIndex((network) => network.id === id) ?? -1;
    return index < 0 ? '' : JA.ladder.circuitNumber(index);
  };
  const details = useRef<HTMLDetailsElement>(null);
  const previousKey = useRef(openKey);
  useEffect(() => {
    if (previousKey.current !== openKey && details.current) details.current.open = true;
    previousKey.current = openKey;
  }, [openKey]);
  const paneTitle = title ?? JA.ladder.output;
  const rows: Row[] = [
    ...issues.errors
      .filter((issue) => issue.source === 'structure')
      .map((issue, index) => toRow(issue, 'structure', index, displayNetwork(issue.networkId))),
    ...issues.errors
      .filter((issue) => issue.source === 'dialect')
      .map((issue, index) => toRow(issue, 'dialect', index, displayNetwork(issue.networkId))),
    ...issues.warnings.map((warning, index) => ({
      key: `w-${String(index)}`,
      severity: 'warning' as const,
      label: JA.ladder.doubleCoil,
      message: warning.message,
      cursor: { networkId: warning.networkId, row: warning.row, col: warning.col },
      place: ladderIssuePlace(displayNetwork(warning.networkId), warning.row, warning.col),
    })),
  ];
  const unused = issues.unused;
  return (
    <section className={styles.output} data-testid="output-window" aria-label={paneTitle}>
      {/*
        命令語リストの書き出し（§10.7 / Task 9）。`<summary>` の中に置くと押すたびに出力
        ウィンドウが畳まれる（押しボタンの click が `<details>` の開閉に食われる）ので、
        畳んでいるあいだも押せるよう**見出しの上**に独立した並びとして置く。
      */}
      <div className={styles.outputTools}>
        <button type="button" data-testid="export-il" onClick={onExport}>
          {JA.ladder.exportIl}
        </button>
      </div>
      {/*
        命令語リストにできなかった理由（§10.7 / Task 9。直し方まで書く）。**`<details>` の外**に
        置く（レビュー #1）: PCwin風（`outputPane: 'status-bar'`）は `open` が常に `false` で
        中身が畳まれているため、`<details>` の中に置くと「命令語リスト」を押しても何も出ず、
        保存もされない（未接続コイルなど）ように見えてしまう。畳んでいるスキンでも読める位置。
      */}
      {exportIssues.length === 0 ? null : (
        <ul className={styles.notationErrors} data-testid="il-issues">
          {exportIssues.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
      {/*
        畳めるようにする（2026-09-19 UXレビュー #27）。既定の開閉はスキンが持つ `open` に従う
        （`window` のスキンは開いたまま。変換の結果はいちばん見せたい情報。PCwin風だけは
        ステータスバー1行に畳んでおく。レビュー B2）。畳めばその高さがそのまま格子に戻る。
      */}
      <details ref={details} open={open} data-testid="output-details">
        <summary className={styles.outputHeader} data-testid="output-summary">
          <h2>{paneTitle}</h2>
          <span data-testid="convert-state" className={converted ? styles.okTag : styles.ngTag}>
            {/*
              「変換」を持たないメーカーでは、成功したときも「自動で変換されます」と添える
              （手で押した変換と区別が付かないと、押し忘れたのかと迷う。決定表#3）
            */}
            {convertKey === undefined
              ? converted
                ? JA.ladder.convertOkAuto
                : JA.ladder.notConvertedAuto
              : converted
                ? JA.ladder.convertOk
                : JA.ladder.notConverted(convertKey)}
          </span>
        </summary>
        <div className={styles.outputBody}>
          <ul className={styles.outputList}>
            {rows.length === 0 ? (
              <li className={styles.outputEmpty}>{JA.ladder.noIssues}</li>
            ) : null}
            {rows.map((row, index) => (
              // 行は**ボタン**にする（`<li onClick>` はキーボードから押せず、読み上げにも出ない。I11）。
              // セルを指していない行（`missing-end` など）は `disabled` にして「押せない」ことを見せる。
              <li key={row.key}>
                <button
                  type="button"
                  data-testid={`output-row-${String(index)}`}
                  data-severity={row.severity}
                  disabled={row.cursor === undefined}
                  className={row.severity === 'error' ? styles.outputError : styles.outputWarning}
                  onClick={() => {
                    if (row.cursor !== undefined) onJump(row.cursor);
                  }}
                >
                  <span className={styles.outputLabel}>{row.label}</span>
                  <span className={styles.outputPlace}>{row.place}</span>
                  <span>{row.message}</span>
                </button>
              </li>
            ))}
          </ul>
          {issues.usage === undefined || unused === undefined ? null : (
            <div className={styles.usage}>
              <p data-testid="usage-reads">
                {JA.ladder.usageReads}: {issues.usage.reads.join(' ') || JA.inspectRepair.none}
              </p>
              <p data-testid="usage-writes">
                {JA.ladder.usageWrites}: {issues.usage.writes.join(' ') || JA.inspectRepair.none}
              </p>
              <p data-testid="usage-unused" className={styles.usageUnused}>
                {JA.ladder.usageUnused}:{' '}
                {[...unused.neverRead, ...unused.neverWritten].join(' ') || JA.inspectRepair.none}
              </p>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

/** 変換エラー1件を行に畳む。 */
function toRow(
  issue: ConvertIssues['errors'][number],
  source: 'structure' | 'dialect',
  index: number,
  networkLabel: string | undefined,
): Row {
  return {
    key: `${source}-${String(index)}`,
    severity: 'error',
    label: source === 'structure' ? JA.ladder.structureError : JA.ladder.dialectError,
    // 指摘 LE-9: 生の message が内部識別子（仕様節番号）を含むことがあるので読み替える
    message: friendlyCompileMessage(issue.code, issue.message),
    cursor:
      issue.networkId === undefined || issue.row === undefined || issue.col === undefined
        ? undefined
        : { networkId: issue.networkId, row: issue.row, col: issue.col },
    place: ladderIssuePlace(networkLabel, issue.row, issue.col),
  };
}
