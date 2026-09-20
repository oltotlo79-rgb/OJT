import type { Wire } from '@ojt/circuit-sim';
import type { FaultSite, InspectRepairProblem, JudgeInspectRepairResult } from '@ojt/content';
import type { JSX } from 'react';
import { JA, reportTargetLabel, schematicOpenCountText, wireLabel } from '../i18n/ja.js';
import { ChartOverlay } from './ChartOverlay.js';
import { MismatchList } from './MismatchList.js';
import { ResultShell } from './ResultShell.js';
import { HazardList, StaticCheckList } from './StaticCheckList.js';
import styles from './result.module.css';

/**
 * モードC2の結果画面。設計仕様 §9.2 判定①〜⑤。
 * 合格条件は「全故障を過不足なく指摘し、修復後の動作が模範と一致し、白線ルール違反と改造が
 * いずれも0」。危険操作の回数と所要時間は**参考表示**で合否には影響しない（§17.2 #3）。
 */

/**
 * 故障の在処を1行の文字列にする（見逃しの一覧に出す）。
 * 内部の電線ID（`sw-005` 等）はそのまま出さない（UI監査 I5）。電線の故障は `wires` に
 * まだ載っていれば `wireLabel()`（`CR1.9–PB1.2c の青線` 形式）、`wire-missing` のように
 * すでに盤から無い（`wires` に見つからない）ときは見えている端子（`terminals`）で示す
 * （レビュー指摘 M1）。
 */
function siteLabel(site: FaultSite, wires: readonly Wire[]): string {
  const where = (() => {
    if (site.wireId !== undefined) {
      const wire = wires.find((w) => w.id === site.wireId);
      if (wire !== undefined) return wireLabel(wire);
      return `${JA.inspectRepair.terminal} ${site.terminals.map((t) => String(t)).join(' / ')}`;
    }
    if (site.partId !== undefined) return `${JA.session.parts} ${site.partId}`;
    return `${JA.inspectRepair.terminal} ${site.terminals.map((t) => String(t)).join(' / ')}`;
  })();
  return `${where} — ${JA.reportKind[site.report]}`;
}

/** `wireId` を表示名にする（`wires` に見つからなければやむを得ずIDへ後退する）。UI監査 I5 */
function wireIdLabel(id: string, wires: readonly Wire[]): string {
  const wire = wires.find((w) => w.id === id);
  return wire === undefined ? id : wireLabel(wire);
}

/** モードC2の結果。 */
export function InspectRepairResult({
  problem,
  result,
  restoredHazardCount = 0,
  schematicOpenCount = 0,
  wires = [],
  onRetry,
  onBackToList,
}: {
  problem: InspectRepairProblem;
  result: JudgeInspectRepairResult;
  restoredHazardCount?: number;
  /** 回路図ヒントを開いた回数（2級形式のみ意味を持つ。§8.4）。 */
  schematicOpenCount?: number;
  /**
   * 電線IDから表示名（`CR1.9–PB1.2c の青線`）を組み立てるための電線一覧。§9.2 / UI監査 I5
   * いま盤にある電線（`session.wires`）と、故障適用直後のスナップショット
   * （`circuit.initialWires`。修復で外した電線は前者に無いのでここから拾う）を
   * 呼び出し側で合わせて渡すこと。省略時は内部IDへ後退する（テストの都合。実運用では渡す）。
   */
  wires?: readonly Wire[];
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  return (
    <ResultShell
      title={problem.title}
      passed={result.passed}
      elapsedMs={elapsedMs}
      timeLimit={problem.timeLimit}
      forbidden={result.chatter.length > 0}
      headerExtra={
        problem.grade === 2 ? (
          <span data-testid="schematic-open-count">
            {schematicOpenCountText(schematicOpenCount)}
          </span>
        ) : null
      }
      onRetry={onRetry}
      onBackToList={onBackToList}
    >
      <div className={styles.grid}>
        <div className={styles.card}>
          <h2>{JA.inspectRepair.reports}</h2>
          <p className={styles.detail}>{JA.inspectRepair.matched}</p>
          <ul data-testid="matched-list">
            {result.reports.matched.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.reports.matched.map((hit, index) => (
                <li key={`m-${String(index)}`}>{siteLabel(hit.site, wires)}</li>
              ))
            )}
          </ul>
          <p className={styles.detail}>{JA.inspectRepair.missed}</p>
          <ul data-testid="missed-list">
            {result.reports.missed.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.reports.missed.map((site, index) => (
                <li key={`x-${String(index)}`}>{siteLabel(site, wires)}</li>
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
                  {reportTargetLabel(report.target, wires)} — {JA.reportKind[report.kind]}
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
              result.modifications.map((wireId) => (
                <li key={wireId}>{wireIdLabel(wireId, wires)}</li>
              ))
            )}
          </ul>
          <p className={styles.detail}>{JA.inspectRepair.addedWires}</p>
          <ul data-testid="added-wire-list">
            {result.addedWires.length === 0 ? (
              <li>{JA.inspectRepair.none}</li>
            ) : (
              result.addedWires.map((wireId) => <li key={wireId}>{wireIdLabel(wireId, wires)}</li>)
            )}
          </ul>
        </div>

        <HazardList
          counts={result.hazardsByKind}
          total={result.hazardCount + restoredHazardCount}
        />
      </div>
    </ResultShell>
  );
}
