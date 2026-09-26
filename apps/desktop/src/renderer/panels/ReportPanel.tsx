import type { Wire } from '@ojt/circuit-sim';
import type { FaultReport } from '@ojt/content';
import type { JSX } from 'react';
import { JA, reportTargetLabel } from '../i18n/ja.js';
import { focusDiagnosticTarget } from '../session/diagnostic-navigation.js';
import styles from './tester.module.css';

/**
 * モードC2の指摘一覧。設計仕様 §9.2。
 *
 * **正誤は決して出さない。** §9.2 は「削除の可否をその場で判定すると答えが漏れる」と定めて
 * おり、指摘についても同じである。過不足（見逃し・過剰指摘）は判定を押したあとの結果画面で
 * 初めて出す（§9.2 判定①）。
 *
 * 種別の選択は、押した場所のすぐ横に出す小窓（`ReportPopover`。2026-09-26）へ移した。
 * ここには登録した指摘の一覧だけを置く。
 */

/** 指摘1件の種別の表示（部品不良は選んだ内容を添える）。 */
export function reportKindText(report: FaultReport): string {
  const kind = JA.reportKind[report.kind];
  if (report.kind !== 'part-defect' || report.detail === undefined) return kind;
  return `${kind}（${JA.faultDetailShort[report.detail]}）`;
}

export function ReportPanel({
  reports,
  wires = [],
  onRemove,
}: {
  reports: readonly FaultReport[];
  /**
   * いまの盤の電線（UXレビュー #6b）。指摘対象が電線のとき、内部の電線IDではなく
   * 両端の端子と色で示すための参照。渡さない・見つからないときは電線IDへ後退する。
   */
  wires?: readonly Wire[];
  onRemove: (index: number) => void;
}): JSX.Element {
  return (
    <section className={styles.panel} data-testid="report-panel">
      <h2 className={styles.title}>
        {JA.inspectRepair.reports}（<span data-testid="report-count">{reports.length}</span>）
      </h2>
      <div data-testid="report-list">
        {reports.length === 0 ? (
          <>
            <p className={styles.hint}>{JA.inspectRepair.pickHint}</p>
            <p className={styles.hint} data-testid="contact-diagnosis-hint">
              {JA.inspectRepair.contactDiagnosisHint}
            </p>
          </>
        ) : (
          reports.map((report, index) => (
            <div key={`${String(index)}-${report.kind}`} className={styles.reportRow}>
              <button
                type="button"
                className={styles.reportTarget}
                onClick={() => focusDiagnosticTarget(report.target)}
              >
                {reportTargetLabel(report.target, wires)} を表示
              </button>
              <span data-testid={`report-kind-text-${String(index)}`}>
                {reportKindText(report)}
              </span>
              <button
                type="button"
                data-testid={`remove-report-${String(index)}`}
                onClick={() => {
                  onRemove(index);
                }}
              >
                {JA.inspectRepair.remove}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
