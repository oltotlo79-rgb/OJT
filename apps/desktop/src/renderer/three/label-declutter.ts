import { useFrame, useThree } from '@react-three/fiber';

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
 * 直し方は「小さくする」ではなく「**入らないものは出さない**」。11px を下回る名札を作ると
 * デザイン規則（画面上 11px 以上）に反するので、大きさは変えずに、重なる名札を
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
const LABEL_SELECTOR = '.block-label';

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
): boolean[] {
  const visible = labels.map(() => false);
  const taken: LabelRect[] = reserved.filter(isDrawn).map((rect) => ({ ...rect }));
  const ordered = labels
    .map((label, index) => ({ label, index }))
    .sort((a, b) => a.label.rank - b.label.rank || a.index - b.index);
  for (const { label, index } of ordered) {
    if (!isDrawn(label.rect)) continue;
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
 * 名札の重なり取りを毎フレーム（正確には**視点か名札の顔ぶれが変わったフレームだけ**）行う。
 *
 * `<Canvas>` の**いちばん最後の子**として置くこと。drei の `<Html>` は同じ優先度の
 * `useFrame` で名札の位置を書くので、最後に登録されたこの効果はその**後**に走る
 * （`frameloop="demand"` なので、止まっている間は1度も走らない）。
 */
export function LabelDeclutter(): null {
  const gl = useThree((state) => state.gl);
  useFrame(() => {
    /*
     * 探す範囲は**3Dビューポートそのもの**にする（`e2e/ui-quality.spec.ts` の `HUD_SELECTOR`
     * と同じ範囲）。drei の `<Html>` がどの入れ物へ描き出すかは版で変わる
     * （`gl.domElement.parentNode` の一段上に置かれることがあり、キャンバスの親だけを見ると
     * 名札が1枚も見つからない）ので、キャンバスの親には頼らない。
     */
    const canvas = gl.domElement;
    const scope = canvas.closest('[data-testid="viewport"]') ?? canvas.ownerDocument.body;
    const labels = [...scope.querySelectorAll<HTMLElement>(LABEL_SELECTOR)];
    const reservedEls = [...scope.querySelectorAll<HTMLElement>(RESERVED_SELECTOR)];
    /*
     * 「視点が変わったフレームだけ測る」という近道は取らない。drei の `<Html>` が名札を
     * 最初に置くのは**マウント後の何フレームか先**で、カメラも大きさも変わらないまま位置だけが
     * 決まることがある。視点を鍵にして省くと、その1回を取りこぼしたまま二度と測り直さず、
     * 名札が重なったまま残る（バッチEの実測: TOYOPUC のラックで全部重なったまま）。
     * `frameloop="demand"` なので走るのは**実際に描いたフレームだけ**、測るのは十数枚の
     * `getBoundingClientRect()` なので、毎フレームでも性能目標 §15 に響かない。
     */
    // 測る（読み）をぜんぶ済ませてから `visibility` を書く
    const candidates = labels.map((el) => ({ rank: rankOf(el), rect: rectOf(el) }));
    const reserved = reservedEls.map(rectOf);
    const visible = pickVisibleLabels(candidates, reserved);
    labels.forEach((el, index) => {
      el.style.visibility = (visible[index] ?? true) ? '' : 'hidden';
    });
  });
  return null;
}
