import type { FaultSite, InspectRepairProblem, JudgeInspectRepairResult } from '@ojt/content';
import type { JSX } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { elapsedSummaryText, JA, reportTargetLabel, schematicOpenCountText } from '../i18n/ja.js';
import { ChartOverlay } from './ChartOverlay.js';
import { MismatchList } from './MismatchList.js';
import { HazardList, StaticCheckList } from './StaticCheckList.js';
import styles from './result.module.css';

/**
 * モードC2の結果画面。設計仕様 §9.2 判定①〜⑤。
 * 合格条件は「全故障を過不足なく指摘し、修復後の動作が模範と一致し、白線ルール違反と改造が
 * いずれも0」。危険操作の回数と所要時間は**参考表示**で合否には影響しない（§17.2 #3）。
 */

/**
 * 故障の在処を1行の文字列にする（見逃しの一覧に出す）。
 * `wire-missing`（未配線）は取り除かれた電線の `wireId` を持つが、訓練者は盤の上で
 * その電線を一度も見ていない（そもそも配線されていない）ので、`wireId` ではなく
 * 見えている端子（`terminals`）で示す（レビュー指摘 M1）。
 */
function siteLabel(site: FaultSite): string {
  const where =
    site.kind !== 'wire-missing' && site.wireId !== undefined
      ? `${JA.session.wires} ${site.wireId}`
      : site.partId !== undefined
        ? `${JA.session.parts} ${site.partId}`
        : `${JA.inspectRepair.terminal} ${site.terminals.map((t) => String(t)).join(' / ')}`;
  return `${where} — ${JA.reportKind[site.report]}`;
}

/** モードC2の結果。 */
export function InspectRepairResult({
  problem,
  result,
  restoredHazardCount = 0,
  schematicOpenCount = 0,
  onRetry,
  onBackToList,
}: {
  problem: InspectRepairProblem;
  result: JudgeInspectRepairResult;
  restoredHazardCount?: number;
  /** 回路図ヒントを開いた回数（2級形式のみ意味を持つ。§8.4）。 */
  schematicOpenCount?: number;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span
          className={`${styles.verdict} ${result.passed ? styles.passed : styles.failed}`}
          data-testid="verdict"
          role="status"
          aria-live="polite"
        >
          {result.passed ? JA.result.passed : JA.result.failed}
        </span>
        <h1 className={styles.title}>
          {JA.result.title}: {problem.title}
        </h1>
        <span data-testid="result-elapsed">
          {JA.result.elapsed} {formatElapsed(elapsedMs)}（
          {elapsedSummaryText(
            elapsedMs,
            problem.timeLimit.standardMin,
            problem.timeLimit.cutoffMin,
          )}
          ）
        </span>
        {problem.grade === 2 ? (
          <span data-testid="schematic-open-count">
            {schematicOpenCountText(schematicOpenCount)}
          </span>
        ) : null}
      </div>

      {result.chatter.length === 0 ? null : (
        <p className={styles.forbidden} data-testid="forbidden-warning">
          {JA.result.forbidden}
        </p>
      )}

      <div className={styles.grid}>
        <div className={styles.card}>
          <h2>{JA.inspectRepair.reports}</h2>
          <p className={styles.detail}>{JA.inspectRepair.matched}</p>
          <ul data-testid="matched-list">
            {result.reports.matched.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.reports.matched.map((hit, index) => (
                <li key={`m-${String(index)}`}>{siteLabel(hit.site)}</li>
              ))
            )}
          </ul>
          <p className={styles.detail}>{JA.inspectRepair.missed}</p>
          <ul data-testid="missed-list">
            {result.reports.missed.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.reports.missed.map((site, index) => (
                <li key={`x-${String(index)}`}>{siteLabel(site)}</li>
              ))
            )}
          </ul>
          <p className={styles.detail}>{JA.inspectRepair.extra}</p>
          <ul data-testid="extra-list">
            {result.reports.extra.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.reports.extra.map((report, index) => (
                <li key={`e-${String(index)}`}>
                  {reportTargetLabel(report.target)} — {JA.reportKind[report.kind]}
                </li>
              ))
            )}
          </ul>
        </div>

        <ChartOverlay
          expected={result.charts.expected}
          actual={result.charts.actual}
          mismatches={result.mismatches}
        />
        <MismatchList mismatches={result.mismatches} />
        <StaticCheckList checks={result.staticChecks} />

        <div className={styles.card}>
          <h2>{JA.inspectRepair.modifications}</h2>
          <ul data-testid="modification-list">
            {result.modifications.length === 0 ? (
              <li>{JA.inspectRepair.noModification}</li>
            ) : (
              result.modifications.map((wireId) => <li key={wireId}>{wireId}</li>)
            )}
          </ul>
          <p className={styles.detail}>{JA.inspectRepair.addedWires}</p>
          <ul data-testid="added-wire-list">
            {result.addedWires.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.addedWires.map((wireId) => <li key={wireId}>{wireId}</li>)
            )}
          </ul>
        </div>

        <HazardList
          counts={result.hazardsByKind}
          total={result.hazardCount + restoredHazardCount}
        />
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={onRetry}>
          {JA.result.retry}
        </button>
        <button type="button" onClick={onBackToList}>
          {JA.result.toList}
        </button>
      </div>
    </div>
  );
}
