import type { Wire } from '@ojt/circuit-sim';
import type { FaultReport, FaultReportKind } from '@ojt/content';
import { useEffect, useRef, type JSX } from 'react';
import { JA, reportTargetLabel } from '../i18n/ja.js';
import { reportKindsFor } from '../session/inspect-repair.js';
import type { ReportTarget } from '../session/interaction.js';
import { focusDiagnosticTarget } from '../session/diagnostic-navigation.js';
import styles from './tester.module.css';

/**
 * モードC2の指摘一覧と種別ポップオーバー。設計仕様 §9.2。
 *
 * **正誤は決して出さない。** §9.2 は「削除の可否をその場で判定すると答えが漏れる」と定めて
 * おり、指摘についても同じである。過不足（見逃し・過剰指摘）は判定を押したあとの結果画面で
 * 初めて出す（§9.2 判定①）。
 *
 * 種別の選択は3Dの上に浮かせず**右パネルの上端**に出す。3Dの上だと `OrbitControls` の
 * ドラッグとクリックが取り合いになり、内蔵GPUの環境では押しづらい。
 */
export function ReportPanel({
  reports,
  pending,
  wires = [],
  onPick,
  onCancel,
  onRemove,
}: {
  reports: readonly FaultReport[];
  /** 3Dで選んだ直後の対象（種別を選ぶ前）。 */
  pending: ReportTarget | undefined;
  /**
   * いまの盤の電線（UXレビュー #6b）。指摘対象が電線のとき、内部の電線IDではなく
   * 両端の端子と色で示すための参照。渡さない・見つからないときは電線IDへ後退する。
   */
  wires?: readonly Wire[];
  onPick: (kind: FaultReportKind) => void;
  onCancel: () => void;
  onRemove: (index: number) => void;
}): JSX.Element {
  const pendingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pending !== undefined)
      pendingRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [pending]);
  return (
    <section className={styles.panel} data-testid="report-panel">
      <h2 className={styles.title}>
        {JA.inspectRepair.reports}（<span data-testid="report-count">{reports.length}</span>）
      </h2>
      {pending === undefined ? null : (
        <div
          className={styles.popover}
          data-testid="report-popover"
          ref={pendingRef}
          role="status"
          aria-live="polite"
        >
          <span className={styles.popoverTitle}>
            {JA.inspectRepair.chooseKind}: {reportTargetLabel(pending, wires)}
          </span>
          {/* レビュー指摘 UX-22: 端子では「未配線」しか選べない理由を先に説明する */}
          <p className={styles.hint} data-testid="pick-kind-hint">
            {JA.inspectRepair.pickKindHint}
          </p>
          {reportKindsFor(pending).map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`report-kind-${kind}`}
              onClick={() => {
                onPick(kind);
              }}
            >
              {JA.reportKind[kind]}
            </button>
          ))}
          <button type="button" data-testid="report-cancel" onClick={onCancel}>
            {JA.inspectRepair.cancel}
          </button>
        </div>
      )}
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
              <span>{JA.reportKind[report.kind]}</span>
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
