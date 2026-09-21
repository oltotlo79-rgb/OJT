import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { UI_PREFERENCES_EVENT } from '../app/ui-preferences.js';
import { gizmoLayoutForViewport } from './view-gizmo-layout.js';

/**
 * 3D盤の上に載る名札（drei の `<Html>` で出す `.block-label`）の**重なり取り**。
 * UI監査バッチE（2026-09-20）。設計仕様 §12 / デザイン規則「なにも重ならない」。
 *
 * 名札は盤の機器に貼り付いているので、盤が小さく映るほど画面上の間隔だけが詰まる。
 * `distanceFactor` が掛かるため名札自身も一緒に縮むが、縮み方は距離に反比例、間隔は
 * 「ペインの高さ ÷ `distanceFactor`」に比例するので、**ペインが低いほど相対的に名札が大きく**
 * なり、やがてぶつかる。モードB「並べて」とモードDの3Dペインがちょうどその形で、
 * `span.block-label ∩ span.block-label`／`∩ status-overlay` が致命 100 件超を占めていた。
 *
 * 直し方は「小さくする」ではなく「**入らないものは出さない**」。12px を下回る名札を作ると
 * デザイン規則（画面上 12px 以上）に反するので、大きさは変えずに、重なる名札を
 * `visibility: hidden` で引っ込める。どれを残すかは `data-label-rank`（小さいほど残る）で、
 * 機種名 → 壁コンセント → 固定機器 → 端子台 → 銘板・モジュール名、の順に譲る。
 * 引っ込めた名札も**レイアウトは残る**（`visibility`）ので、次のフレームでも同じ判定になり、
 * 出たり消えたりのちらつきは起きない。
 */

/** 画面座標の矩形（左・上・右・下[px]）。 */
export interface LabelRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** 名札1枚ぶんの入力。`rank` が小さいものから残す。 */
export interface LabelCandidate {
  rank: number;
  rect: LabelRect;
}

/** 名札どうし・名札と状態表示のあいだに必ず空ける隙間[px]。 */
export const LABEL_GAP_PX = 2;

/** `data-label-rank` を持たない名札の優先度（いちばん譲る）。 */
export const DEFAULT_LABEL_RANK = 9;

/** 3Dの上に載る「どかせない」表示（状態オーバーレイ・視点ヘルプ・端子のツールチップ）。 */
const RESERVED_SELECTOR =
  '[data-testid="status-overlay"], [data-testid="view-hint"], .terminal-tooltip';

/** 名札そのもの。 */
export const LABEL_SELECTOR = '.block-label, .socket-label, .part-label';

/** 隙間ぶん膨らませても交わるか。 */
function overlaps(a: LabelRect, b: LabelRect, gapPx: number): boolean {
  return a.l < b.r + gapPx && b.l < a.r + gapPx && a.t < b.b + gapPx && b.t < a.b + gapPx;
}

/** 大きさのある矩形か（0×0 は「見えていない」ので比べない）。 */
function isDrawn(rect: LabelRect): boolean {
  return rect.r > rect.l && rect.b > rect.t;
}

/**
 * どの名札を出すか決める（純関数。`test/label-declutter.test.ts` が縛る）。
 *
 * `rank` の小さい順（同じなら並び順）に見て、すでに残したもの・`reserved`（状態表示など）と
 * 交わらないものだけを残す。戻り値は `labels` と同じ並びの真偽値。
 */
export function pickVisibleLabels(
  labels: readonly LabelCandidate[],
  reserved: readonly LabelRect[] = [],
  gapPx: number = LABEL_GAP_PX,
  bounds?: LabelRect,
): boolean[] {
  const visible = labels.map(() => false);
  const taken: LabelRect[] = reserved.filter(isDrawn).map((rect) => ({ ...rect }));
  const ordered = labels
    .map((label, index) => ({ label, index }))
    .sort((a, b) => a.label.rank - b.label.rank || a.index - b.index);
  for (const { label, index } of ordered) {
    if (!isDrawn(label.rect)) continue;
    if (
      bounds !== undefined &&
      isDrawn(bounds) &&
      (label.rect.l < bounds.l ||
        label.rect.t < bounds.t ||
        label.rect.r > bounds.r ||
        label.rect.b > bounds.b)
    )
      continue;
    if (taken.some((rect) => overlaps(rect, label.rect, gapPx))) continue;
    taken.push(label.rect);
    visible[index] = true;
  }
  return visible;
}

/** 要素の画面座標の矩形。 */
function rectOf(el: Element): LabelRect {
  const box = el.getBoundingClientRect();
  return { l: box.left, t: box.top, r: box.right, b: box.bottom };
}

/** `data-label-rank` を読む（無い・読めないときは既定）。 */
function rankOf(el: HTMLElement): number {
  const raw = el.dataset['labelRank'];
  if (raw === undefined) return DEFAULT_LABEL_RANK;
  const value = Number(raw);
  return Number.isFinite(value) ? value : DEFAULT_LABEL_RANK;
}

/**
 * 選んだ結果を DOM へ書き戻す（**前回と違う名札だけ**）。書き換えた枚数を返す。3D-22
 *
 * 純関数ではないが、`LabelDeclutter` の `useFrame` から切り出して export するのは、
 * 「同じ結果なら2回目は1枚も書かない」ことを単体テストで縛れるようにするため
 * （`LabelDeclutter` 自身は `<Canvas>` の中でしか動かせない）。
 */
export function applyLabelVisibility(
  labels: readonly HTMLElement[],
  visible: readonly boolean[],
): number {
  let written = 0;
  labels.forEach((el, index) => {
    const next = (visible[index] ?? true) ? '' : 'hidden';
    if (el.style.visibility === next) return;
    el.style.visibility = next;
    written += 1;
  });
  return written;
}

/** DOM上の配置が確定したあとに測る。描画が止まっていても名札の追加・文字拡大に追随する。 */
export function observeLabelLayout(scope: Element): () => void {
  let frame = 0;
  const measure = (): void => {
    frame = 0;
    const labels = [...scope.querySelectorAll<HTMLElement>(LABEL_SELECTOR)];
    const candidates = labels.map((el) => ({ rank: rankOf(el), rect: rectOf(el) }));
    const reserved = [...scope.querySelectorAll<HTMLElement>(RESERVED_SELECTOR)].map(rectOf);
    const bounds = rectOf(scope);
    const gizmo = gizmoLayoutForViewport(bounds.r - bounds.l, bounds.b - bounds.t);
    if (gizmo !== null) {
      reserved.push({
        l: bounds.l + gizmo.margin[0] - gizmo.plateRadius,
        r: bounds.l + gizmo.margin[0] + gizmo.plateRadius,
        t: bounds.t + gizmo.margin[1] - gizmo.plateRadius,
        b: bounds.t + gizmo.margin[1] + gizmo.plateRadius,
      });
    }
    applyLabelVisibility(labels, pickVisibleLabels(candidates, reserved, LABEL_GAP_PX, bounds));
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };
  // Htmlのtransformが書かれたあとに計測。自分のvisibility書込による再通知は差分0で止まる。
  const mutation = new MutationObserver(schedule);
  mutation.observe(scope, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
    characterData: true,
  });
  const resize = new ResizeObserver(schedule);
  resize.observe(scope);
  window.addEventListener(UI_PREFERENCES_EVENT, schedule);
  schedule();
  return () => {
    mutation.disconnect();
    resize.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener(UI_PREFERENCES_EVENT, schedule);
  };
}

export function LabelDeclutter(): null {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    return observeLabelLayout(
      canvas.closest('[data-testid="viewport"], [data-testid="replay-viewport"]') ??
        canvas.parentElement ??
        canvas.ownerDocument.body,
    );
  }, [gl]);
  return null;
}
