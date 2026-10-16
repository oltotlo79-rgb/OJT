import type { Wire } from '@ojt/circuit-sim';
import {
  FAULT_DETAILS,
  type FaultDetail,
  type FaultReport,
  type FaultReportKind,
} from '@ojt/content';
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { useStore } from '../app/store.js';
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

/** 小窓の幅[px]（測る前の見積もり。CSS の幅と同じ値）。 */
export const POPOVER_WIDTH_PX = 340;
/** 小窓の高さ[px]（測る前の見積もり。開いたあとは実寸で置き直す）。 */
const POPOVER_HEIGHT_PX = 380;
/** 押した場所からずらす量[px]（押した部品や電線を小窓で隠さない）。 */
const POINTER_GAP_PX = 14;
/** 小窓と置き場の縁のあいだ[px]。 */
const AREA_MARGIN_PX = 8;

/** 小窓を置ける範囲（ビューポートの中の座標。3Dを描くキャンバスの矩形）。 */
export interface PopoverArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * ビューポートの中で、3Dを描くキャンバスが占める矩形。v2.1.0（監査 U7）
 * ビューポートには状態の帯・押し続ける帯・操作のヒントも入っているので、枠の大きさで置くと
 * 小窓が下の押ボタン・経過時間を覆っていた。キャンバスが見つからないときは枠の全体。
 */
export function popoverAreaOf(viewport: HTMLElement | null): PopoverArea {
  if (viewport === null) return { left: 0, top: 0, right: 800, bottom: 600 };
  const frame = viewport.getBoundingClientRect();
  const canvas = viewport.querySelector('canvas')?.getBoundingClientRect();
  if (canvas === undefined || canvas.width <= 0 || canvas.height <= 0) {
    return { left: 0, top: 0, right: frame.width, bottom: frame.height };
  }
  return {
    left: canvas.left - frame.left,
    top: canvas.top - frame.top,
    right: canvas.right - frame.left,
    bottom: canvas.bottom - frame.top,
  };
}

/**
 * 小窓の左上（ビューポートの中の座標）。v2.1.0（監査 U7）
 *
 * 押した点の右下に出し、右に入らなければ左に、下に入らなければ上に出す（押した物を隠さない）。
 * どちらにも入らないときは置き場の中へ寄せる。大きさは**開いたあとの実寸**（`size`）で決める
 * （以前は高さを 380px と見積もっていて、実際の高さと食い違うと下の帯を覆っていた）。
 * 一覧から開いたとき（押した点が無い）は置き場の右上。
 */
export function popoverPosition(
  anchor: { x: number; y: number } | undefined,
  area: PopoverArea,
  size: { width: number; height: number } = { width: POPOVER_WIDTH_PX, height: POPOVER_HEIGHT_PX },
): { left: number; top: number } {
  const minLeft = area.left + AREA_MARGIN_PX;
  const minTop = area.top + AREA_MARGIN_PX;
  const maxLeft = Math.max(minLeft, area.right - size.width - AREA_MARGIN_PX);
  const maxTop = Math.max(minTop, area.bottom - size.height - AREA_MARGIN_PX);
  if (anchor === undefined) return { left: maxLeft, top: minTop };
  const clamp = (value: number, low: number, high: number): number =>
    Math.min(Math.max(value, low), high);
  const toRight = anchor.x + POINTER_GAP_PX;
  const toLeft = anchor.x - POINTER_GAP_PX - size.width;
  const left =
    toRight <= maxLeft ? toRight : toLeft >= minLeft ? toLeft : clamp(toRight, minLeft, maxLeft);
  const below = anchor.y + POINTER_GAP_PX;
  const above = anchor.y - POINTER_GAP_PX - size.height;
  const top = below <= maxTop ? below : above >= minTop ? above : clamp(below, minTop, maxTop);
  return { left, top };
}

/** 部品不良の内容として出す選択肢（「分からない」はボタンの最後に別に出す）。 */
const DETAIL_CHOICES: readonly FaultDetail[] = FAULT_DETAILS.filter(
  (detail) => detail !== 'unknown' && detail !== 'lamp-open',
);

/** 小窓の置き方を決める測り値。 */
interface PopoverLayout {
  /** 小窓の実寸。 */
  size: { width: number; height: number } | undefined;
  /** 置き場（3Dを描くキャンバスの矩形）。 */
  area: PopoverArea | undefined;
  /** 開いたあとで3Dの枠の大きさが変わったか（押した点はもう押した物の上に無い）。 */
  stale: boolean;
}

/** 枠の大きさの見分け（小数は丸める）。 */
function frameKey(element: Element | null): string {
  if (element === null) return '';
  const rect = element.getBoundingClientRect();
  return `${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`;
}

export function ReportPopover({
  pending,
  wires,
  anchor,
  area: fixedArea,
  current,
  onPick,
  onCancel,
}: {
  pending: ReportTarget;
  wires: readonly Wire[];
  /** 押した点（ビューポートの中の座標）。一覧から開いたときは undefined。 */
  anchor: { x: number; y: number } | undefined;
  /**
   * 小窓を置ける範囲。省略すると、小窓を入れている3Dの枠（親要素）の中のキャンバスを測る
   * （`popoverAreaOf()`）。単体テストは固定の範囲を渡す。
   */
  area?: PopoverArea;
  current?: FaultReport;
  onPick: (kind: FaultReportKind, detail?: FaultDetail) => void;
  onCancel: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const roles = useStore((state) => state.session?.socketRoles);
  /*
   * 開いたあとの実寸と置き場（v2.1.0 監査 U7）。中身（部品不良の内容のボタンの数）で高さが
   * 変わるので測ってから置き、窓の大きさが変わったら置き場を測り直す。3Dは窓に合わせて
   * 収め直されるので、開いた後に枠が変わったら押した点は使わず、置き場の右上へ移す。
   */
  const [layout, setLayout] = useState<PopoverLayout>({
    size: undefined,
    area: fixedArea,
    stale: false,
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const host = element.parentElement;
    const openedFrame = frameKey(host);
    const measure = (): void => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const size = width > 0 && height > 0 ? { width, height } : undefined;
      const area = fixedArea ?? (host === null ? undefined : popoverAreaOf(host));
      const stale = host !== null && frameKey(host) !== openedFrame;
      setLayout((previous) =>
        previous.stale === stale &&
        previous.size?.width === size?.width &&
        previous.size?.height === size?.height &&
        previous.area?.left === area?.left &&
        previous.area?.top === area?.top &&
        previous.area?.right === area?.right &&
        previous.area?.bottom === area?.bottom
          ? previous
          : { size, area, stale },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (host !== null) observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, [pending, fixedArea]);
  const position = popoverPosition(
    layout.stale ? undefined : anchor,
    layout.area ?? fixedArea ?? { left: 0, top: 0, right: 800, bottom: 600 },
    layout.size,
  );
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [pending]);
  const kinds = reportKindsFor(pending);
  const title = current === undefined ? JA.inspectRepair.popoverTitle : JA.inspectRepair.editTitle;
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
      aria-label={title}
      data-testid="report-popover"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className={styles.title}>{title}</p>
      <p className={styles.target} data-testid="report-popover-target">
        {reportTargetLabel(pending, wires, roles)}
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
              aria-pressed={current?.kind === 'part-defect' && current.detail === detail}
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
            aria-pressed={
              current?.kind === 'part-defect' &&
              (current.detail === 'unknown' || current.detail === undefined)
            }
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
              aria-pressed={current?.kind === kind}
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
