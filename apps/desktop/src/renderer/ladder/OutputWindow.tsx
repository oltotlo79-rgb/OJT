import type { JSX } from 'react';
import type { ConvertIssues } from '../app/store-types.js';
import { JA, ladderIssuePlace } from '../i18n/ja.js';
import type { LadderCursor } from '../session/ladder.js';
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
  onJump,
}: {
  issues: ConvertIssues;
  converted: boolean;
  /** 「変換」のキー。無いスキン（`convertStep: false`）では `undefined`。決定表#3 */
  convertKey: string | undefined;
  onJump: (cursor: LadderCursor) => void;
}): JSX.Element {
  const rows: Row[] = [
    ...issues.errors
      .filter((issue) => issue.source === 'structure')
      .map((issue, index) => toRow(issue, 'structure', index)),
    ...issues.errors
      .filter((issue) => issue.source === 'dialect')
      .map((issue, index) => toRow(issue, 'dialect', index)),
    ...issues.warnings.map((warning, index) => ({
      key: `w-${String(index)}`,
      severity: 'warning' as const,
      label: JA.ladder.doubleCoil,
      message: warning.message,
      cursor: { networkId: warning.networkId, row: warning.row, col: warning.col },
      place: ladderIssuePlace(warning.networkId, warning.row, warning.col),
    })),
  ];
  const unused = issues.unused;
  return (
    <section className={styles.output} data-testid="output-window" aria-label={JA.ladder.output}>
      {/*
        畳めるようにする（2026-09-19 UXレビュー #27）。既定は開いたまま（変換の結果は
        いちばん見せたい情報）だが、畳めばその高さがそのまま格子に戻る。
      */}
      <details open data-testid="output-details">
        <summary className={styles.outputHeader} data-testid="output-summary">
          <h2>{JA.ladder.output}</h2>
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
): Row {
  return {
    key: `${source}-${String(index)}`,
    severity: 'error',
    label: source === 'structure' ? JA.ladder.structureError : JA.ladder.dialectError,
    message: issue.message,
    cursor:
      issue.networkId === undefined || issue.row === undefined || issue.col === undefined
        ? undefined
        : { networkId: issue.networkId, row: issue.row, col: issue.col },
    place: ladderIssuePlace(issue.networkId, issue.row, issue.col),
  };
}
