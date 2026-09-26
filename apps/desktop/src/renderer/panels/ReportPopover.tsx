import type { Wire } from '@ojt/circuit-sim';
import { FAULT_DETAILS, type FaultDetail, type FaultReportKind } from '@ojt/content';
import { useEffect, useRef, type JSX } from 'react';
import { JA, reportTargetLabel } from '../i18n/ja.js';
import { reportKindsFor } from '../session/inspect-repair.js';
import type { ReportTarget } from '../session/interaction.js';
import styles from './report-popover.module.css';

/**
 * 3D図の中に出す「故障の指摘」の小窓。設計仕様 §9.2 / 2026-09-26 利用者指示
 * 「どの線に不具合があるのかも3D図内で選択し断線やリレー、接点の不具合などを指定できるようにして」。
 *
 * 以前は右パネルの上端に種別の選択を出していた（3Dから離れていて、押した場所と結び付かなかった）。
 * 押した場所のすぐ横に、ビューポートの上に重ねた**DOMの小窓**として出す。キャンバスの外の要素
 * なので、視点操作（ドラッグ）とクリックを取り合わない。電線一覧・修復パネルから開いたとき
 * （ポインタがビューポートの外）は、ビューポートの右上に出す。
 *
 * 部品不良は内容（コイル断線・接点の溶着など）も選べる。合否は場所と種別で決まり、内容は結果画面で
 * 講評する（同日の決定）。**正誤はここでは出さない**（§9.2）。
 */

/** 小窓の幅[px]（位置の丸めに使う。CSS の幅と同じ値）。 */
export const POPOVER_WIDTH_PX = 340;
/** 小窓のおおよその高さ[px]（位置の丸めに使う）。 */
const POPOVER_HEIGHT_PX = 380;
/** 押した場所からずらす量[px]（押した部品や電線を小窓で隠さない）。 */
const POINTER_GAP_PX = 14;

/** ビューポートの中での小窓の左上（押した場所の右下。はみ出すなら内側へ寄せる）。 */
export function popoverPosition(
  anchor: { x: number; y: number } | undefined,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  if (anchor === undefined) {
    return { left: Math.max(8, viewport.width - POPOVER_WIDTH_PX - 12), top: 56 };
  }
  const left = Math.min(
    Math.max(8, anchor.x + POINTER_GAP_PX),
    Math.max(8, viewport.width - POPOVER_WIDTH_PX - 8),
  );
  const below = anchor.y + POINTER_GAP_PX;
  const top =
    below + POPOVER_HEIGHT_PX <= viewport.height
      ? below
      : Math.max(8, anchor.y - POPOVER_HEIGHT_PX - POINTER_GAP_PX);
  return { left, top };
}

/** 部品不良の内容として出す選択肢（「分からない」はボタンの最後に別に出す）。 */
const DETAIL_CHOICES: readonly FaultDetail[] = FAULT_DETAILS.filter(
  (detail) => detail !== 'unknown' && detail !== 'lamp-open',
);

export function ReportPopover({
  pending,
  wires,
  position,
  onPick,
  onCancel,
}: {
  pending: ReportTarget;
  wires: readonly Wire[];
  position: { left: number; top: number };
  onPick: (kind: FaultReportKind, detail?: FaultDetail) => void;
  onCancel: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [pending]);
  const kinds = reportKindsFor(pending);
  const hint =
    'wireId' in pending
      ? JA.inspectRepair.popoverWireHint
      : 'terminalId' in pending
        ? JA.inspectRepair.popoverTerminalHint
        : JA.inspectRepair.popoverPartHint;
  return (
    <div
      ref={ref}
      className={styles.popover}
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-label={JA.inspectRepair.popoverTitle}
      data-testid="report-popover"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className={styles.title}>{JA.inspectRepair.popoverTitle}</p>
      <p className={styles.target} data-testid="report-popover-target">
        {reportTargetLabel(pending, wires)}
      </p>
      <p className={styles.hint} data-testid="pick-kind-hint">
        {hint}
      </p>
      {kinds.includes('part-defect') ? (
        <div className={styles.details} role="group" aria-label={JA.reportKind['part-defect']}>
          {DETAIL_CHOICES.map((detail) => (
            <button
              key={detail}
              type="button"
              data-testid={`report-detail-${detail}`}
              onClick={() => {
                onPick('part-defect', detail);
              }}
            >
              {JA.faultDetail[detail]}
            </button>
          ))}
          <button
            type="button"
            data-testid="report-kind-part-defect"
            onClick={() => {
              onPick('part-defect', 'unknown');
            }}
          >
            {JA.inspectRepair.partDefectUnknown}
          </button>
        </div>
      ) : (
        <div className={styles.kinds}>
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              className={styles.kind}
              data-testid={`report-kind-${kind}`}
              onClick={() => {
                onPick(kind);
              }}
            >
              {JA.reportKind[kind]}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={styles.cancel}
        data-testid="report-cancel"
        onClick={onCancel}
      >
        {JA.inspectRepair.cancel}
      </button>
    </div>
  );
}
