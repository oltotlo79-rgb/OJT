/**
 * 素のスクリーンショットに吹き出し（丸数字・枠・引き出し線・ラベル）を重ねた HTML を組む。
 * 取扱説明書 設計 §6.4 / 決定表#24c、Plan 6 Task 12 Step 2。
 *
 * ここでは HTML を組むだけで、絵にするのは Playwright の Chromium である
 * （`e2e/manual-shots.spec.ts`）。分けてあるので、Playwright を起動せずに
 * 「正しい HTML を組めたか」を Vitest で確かめられる。
 *
 * 新しい依存は1つも足していない。純 JS で PNG に丸数字と日本語のラベルを描くには
 * フォントのラスタライザが要り、重い依存になるためである。
 *
 * **置き方の約束**（2026-09-20 のレビュー指摘）:
 * 丸数字は指すものの左上の角に置き、**ラベルは指すものの外**へ出して引き出し線で結ぶ。
 * ラベルどうし・ラベルと丸数字は重ねない。画面いっぱいの「欄」を指す吹き出しだけは
 * 外へ出す場所が無いので中に置くが、その場合でも**指すものの面積の1割**までしか隠さない。
 *
 * **アプリの文字の上には置かない**（2026-09-20 最終レビュー BL-1）:
 * 撮影のときに画面へ出ている文字の矩形をぜんぶ実測して、`shot-geometry.json` の
 * `avoid` に入れてある。丸数字もラベルも、その矩形にかかる置き場所は落とす。
 * 置き場所は「枠のすぐ外」から順に、最後は**図ぜんぶの格子**まで探すので、
 * 文字の無いところ（3Dの画面・欄の余白・帯の空き）へ逃げられる。どうしても
 * 置けないときだけ「隠す面積がいちばん小さいところ」へ置き、そのときは
 * `manual-images.test.ts` が赤くなる（黙って読めない図を作らない）。
 */

/** 丸数字。20個あれば足りる（1枚あたりの吹き出しは多くて6個）。 */
const CIRCLED = [
  '①',
  '②',
  '③',
  '④',
  '⑤',
  '⑥',
  '⑦',
  '⑧',
  '⑨',
  '⑩',
  '⑪',
  '⑫',
  '⑬',
  '⑭',
  '⑮',
  '⑯',
  '⑰',
  '⑱',
  '⑲',
  '⑳',
];

/** 吹き出しの色（アプリの通電色とぶつからない朱色）。 */
export const MARK_COLOR = '#d8341f';

/** 丸数字の直径[px]。 */
export const MARK_SIZE = 28;

/** ラベルの高さ[px]（`font: 700 13px` ＋ 上下の余白）。 */
const LABEL_HEIGHT = 22;

/** ラベルの左右の余白の合計[px]。 */
const LABEL_PAD = 18;

/** 枠とラベルのあいだに空ける隙間[px]。 */
const GAP = 10;

/** 中に置いてよい割合（指すものの面積のうち、ラベルが隠してよい上限）。 */
const INSIDE_COVER_RATIO = 0.1;

/** 置き場所を探す格子の刻み[px]（細かくするほど遅くなるだけで、絵はほとんど変わらない）。 */
const GRID_STEP = 8;

/** 最後の逃げ道で見る候補の数（近い順。全部見ると遅いだけで役に立たない）。 */
const LAST_RESORT_LIMIT = 4000;

/**
 * アプリの文字との隙間[px]。丸数字とラベルには 2px の白い縁があるので、
 * 矩形が触れていないだけでは字にかぶって見える。
 */
const TEXT_MARGIN = 3;

/** 他の吹き出しの丸数字との隙間[px]。近すぎると、その番号のラベルに見える。 */
const BADGE_MARGIN = 24;

/** ラベルどうしの隙間[px]（縁どうしがくっつくと1枚の札に見える）。 */
const LABEL_MARGIN = 6;

function escapeHtml(text) {
  return String(text)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/** 13px 太字での1文字の幅[px]（和文は全角、ラテン文字は半角ぶん）。 */
function charWidth(char) {
  return /[ -ÿ]/u.test(char) ? 7.8 : 13.5;
}

/** ラベルの箱の幅[px]。HTML 側にもこの値をそのまま入れるので、見込みではなく実寸になる。 */
export function labelWidth(text) {
  let sum = 0;
  for (const char of String(text)) sum += charWidth(char);
  return Math.ceil(sum) + LABEL_PAD;
}

function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlapArea(a, b) {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return width <= 0 || height <= 0 ? 0 : width * height;
}

function inside(rect, frame) {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= frame.w && rect.y + rect.h <= frame.h;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** どれか1つにでもかかるか。 */
function hits(rect, list) {
  return list.some((other) => intersects(rect, other));
}

/** 矩形を周りへ `by` px 広げる（触れているだけの置き方を落とすため）。 */
function grow(rect, by) {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

/** その矩形が隠してしまう面積の合計（重なった `avoid` を二重に数えるが、比べるには足りる）。 */
function coveredArea(rect, avoid) {
  let sum = 0;
  for (const other of avoid) sum += overlapArea(rect, other);
  return sum;
}

/** 点から矩形までの距離（中に入っていれば0）。 */
function distanceTo(rect, point) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/** 切り出した窓の中の座標へ直し、窓の外のものは捨てる。 */
function shiftRects(rects, crop, frame) {
  const out = [];
  for (const rect of rects) {
    const moved = { x: rect.x - crop.x, y: rect.y - crop.y, w: rect.w, h: rect.h };
    if (moved.x + moved.w <= 0 || moved.y + moved.h <= 0) continue;
    if (moved.x >= frame.w || moved.y >= frame.h) continue;
    out.push(moved);
  }
  return out;
}

/**
 * 丸数字を置く候補（枠の左上の角から近い順）。角・枠のすぐ外（上の辺・左の辺）・
 * 枠のすぐ内側を並べる。どれも図の中に収まるよう丸めてある。
 */
function badgeCandidates(box, frame) {
  const half = MARK_SIZE / 2;
  const points = [
    // 既定は角（これまでと同じ）
    { x: box.x, y: box.y },
    { x: box.x - half - 4, y: box.y },
    { x: box.x + half, y: box.y - half - 4 },
    { x: box.x - half - 4, y: box.y + box.h / 2 },
  ];
  const span = (from, to) => {
    const out = [];
    for (let at = from; at < to; at += 4) out.push(at);
    out.push(to);
    return out;
  };
  /*
   * 4つの辺それぞれに沿って滑らせ、辺をまたぐ向きにも 4px きざみで動かす
   * （外へ最大 `半径+16`px、内へ `半径+4`px）。辺の外も中も文字だらけでも、
   * **行と行のあいだ**のような細い隙間なら、この細かさで見つけられる。
   */
  const offsets = [];
  for (let at = -half - 16; at <= half + 4; at += 4) offsets.push(at);
  for (const at of offsets) {
    for (const x of span(box.x, box.x + box.w)) {
      points.push({ x, y: box.y + at }, { x, y: box.y + box.h - at });
    }
    for (const y of span(box.y, box.y + box.h)) {
      points.push({ x: box.x + at, y }, { x: box.x + box.w - at, y });
    }
  }
  const corner = { x: box.x, y: box.y };
  const seen = new Set();
  const out = [];
  for (const point of points) {
    const rect = {
      x: Math.round(clamp(point.x, half, frame.w - half) - half),
      y: Math.round(clamp(point.y, half, frame.h - half) - half),
      w: MARK_SIZE,
      h: MARK_SIZE,
    };
    const key = `${String(rect.x)},${String(rect.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rect);
  }
  // 近い順（同じ距離なら先に作った順＝角・辺の順が残る。`sort` は安定）
  return out.sort((a, b) => distanceTo(a, corner) - distanceTo(b, corner));
}

/**
 * ラベルを置く候補（丸数字から近い順）。枠の外側（右・左・上・下）を先に並べ、
 * そのあと**図ぜんぶの格子**を並べる。格子まで見るので、枠のまわりが文字で
 * 埋まっていても「文字の無いところ」へ逃がせる。
 */
function labelCandidates(box, badge, width, frame) {
  const seen = new Set();
  const out = [];
  const add = (x, y) => {
    const rect = {
      x: Math.round(clamp(x, 0, Math.max(0, frame.w - width))),
      y: Math.round(clamp(y, 0, Math.max(0, frame.h - LABEL_HEIGHT))),
      w: width,
      h: LABEL_HEIGHT,
    };
    const key = `${String(rect.x)},${String(rect.y)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(rect);
  };
  const midY = badge.y - LABEL_HEIGHT / 2;
  for (let step = 0; step < 3; step += 1) {
    const slide = step * (LABEL_HEIGHT + 6);
    const push = step * (width + 6);
    add(box.x + box.w + GAP + push, midY);
    add(box.x - GAP - width - push, midY);
    // 丸数字は枠の左上にあるので、上下へ出すときは丸数字のぶんだけ右へずらす
    add(box.x + MARK_SIZE, box.y - GAP - LABEL_HEIGHT - slide);
    add(box.x + MARK_SIZE, box.y + box.h + GAP + slide);
    add(box.x, box.y - GAP - LABEL_HEIGHT - slide);
    add(box.x, box.y + box.h + GAP + slide);
    add(box.x + box.w - width, box.y - GAP - LABEL_HEIGHT - slide);
    add(box.x + box.w - width, box.y + box.h + GAP + slide);
  }
  // 逃げ場が無い「欄」向け（枠の中。丸数字のとなり・下・上）
  const side = MARK_SIZE / 2 + 4;
  add(badge.x + side, midY);
  add(badge.x - side - width, midY);
  add(badge.x + side, badge.y + side);
  add(badge.x + side, badge.y - side - LABEL_HEIGHT);
  add(badge.x - width / 2, badge.y + side);
  add(badge.x - width / 2, badge.y - side - LABEL_HEIGHT);
  // 図ぜんぶの格子（アプリの文字を避けるための受け皿）
  for (let y = 0; y + LABEL_HEIGHT <= frame.h; y += GRID_STEP) {
    for (let x = 0; x + width <= frame.w; x += GRID_STEP) add(x, y);
  }
  return out.sort((a, b) => distanceTo(a, badge) - distanceTo(b, badge));
}

/** 条件を満たす候補のうち、アプリの文字を隠す面積がいちばん小さいもの。 */
function leastCovered(candidates, avoid, accept) {
  let best;
  let bestCovered = Number.POSITIVE_INFINITY;
  for (const rect of candidates.slice(0, LAST_RESORT_LIMIT)) {
    if (!accept(rect)) continue;
    const covered = coveredArea(rect, avoid);
    if (covered < bestCovered) {
      best = rect;
      bestCovered = covered;
      if (covered === 0) break;
    }
  }
  return best;
}

/**
 * 吹き出しの置き方を決める（純粋な計算。HTML は組まない）。
 * テストはこの結果を見て「ラベルが指すものを隠していないか」を確かめられる。
 *
 * @param shot     `shots.json` の1件
 * @param geometry `shot-geometry.json` の1件
 * @param size     素のPNGの寸法
 */
export function planCallouts(shot, geometry, size) {
  const crop = geometry.crop ?? { x: 0, y: 0, w: size.width, h: size.height };
  const frame = { w: crop.w, h: crop.h };
  // アプリの文字（撮影のときに実測した矩形）。古い `shot-geometry.json` には無い
  const avoid = shiftRects(geometry.avoid ?? [], crop, frame);

  // ①枠（丸数字は次の段で置く）
  const boxes = shot.callouts.map((callout) => {
    const place = geometry.callouts[String(callout.n)];
    if (place === undefined) {
      throw new Error(`吹き出しの位置がありません: ${callout.n}（${shot.caption}）`);
    }
    if (
      place.x < 0 ||
      place.y < 0 ||
      place.x + place.w > size.width ||
      place.y + place.h > size.height
    ) {
      throw new Error(`吹き出しが画面の外にあります: ${callout.n}（${shot.caption}）`);
    }
    /*
     * 位置は**切り出す前の**画面の座標で書く（設計 §6.4）ので、切り出した窓の中では
     * 左上へ `crop` のぶんだけ寄る。枠を素の座標のまま置くと、`crop` を入れた図だけ
     * 枠が指すものからずれる（絵は `-crop.x` だけ動かしているため）。
     */
    return {
      n: callout.n,
      label: callout.label,
      mark: CIRCLED[callout.n - 1] ?? String(callout.n),
      box: { x: place.x - crop.x, y: place.y - crop.y, w: place.w, h: place.h },
    };
  });

  /*
   * ②丸数字。既定は枠の左上の角。上下に重なった行（マークシートの見出し・解答済み・
   * 「不良原因」の列など）では、角に置くと**隣の行の文字**を隠してしまうので、
   * 隣の枠にかからない場所（枠のすぐ左・すぐ上・辺に沿った位置）へ逃がす。
   * 順に「アプリの文字も隣の枠も避ける」→「文字だけ避ける」→「隣の枠だけ避ける」と
   * 緩めていき、どれも駄目なら角へ戻す（丸数字どうしは最後まで重ねない）。
   */
  const half = MARK_SIZE / 2;
  const taken = [];
  const marks = boxes.map((mark, index) => {
    const others = boxes.filter((_other, at) => at !== index).map((other) => other.box);
    const candidates = badgeCandidates(mark.box, frame);
    const free = (rect) => !hits(grow(rect, 4), taken);
    let badgeBox;
    // 文字との隙間は空けたいが、帯のボタンが詰まっている図では隙間が取れない。
    // 「隙間を空けて置く」→「触れない範囲まで詰めて置く」の順に緩める
    for (const margin of [TEXT_MARGIN, 0]) {
      const clearOfText = (rect) => !hits(grow(rect, margin), avoid);
      const rules = [
        (rect) => free(rect) && !hits(rect, others) && clearOfText(rect),
        (rect) => free(rect) && clearOfText(rect),
      ];
      for (const rule of rules) {
        badgeBox = candidates.find(rule);
        if (badgeBox !== undefined) break;
      }
      if (badgeBox !== undefined) break;
    }
    badgeBox ??= candidates.find((rect) => free(rect) && !hits(rect, others));
    badgeBox ??= candidates.find(free);
    badgeBox ??= candidates.find((rect) => !hits(rect, taken));
    badgeBox ??= candidates[0];
    taken.push(badgeBox);
    return {
      ...mark,
      badge: { x: badgeBox.x + half, y: badgeBox.y + half },
      badgeBox,
      badgeCovers: coveredArea(badgeBox, avoid),
    };
  });

  /*
   * ③ラベル。順に緩めていく:
   *   1. 指すものの外・他の枠にかからない・アプリの文字にかからない
   *   2. 指すものの中（面積の1割まで）・他の枠にかからない・文字にかからない
   *   3. 他の枠は諦める（画面いっぱいの欄が並ぶ図は、どこへ置いても隣の枠にかかる）
   *   4. それでも駄目なら、文字を隠す面積がいちばん小さいところ（検査が赤くなる）
   */
  const placed = [];
  for (const mark of marks) {
    const width = labelWidth(mark.label);
    const others = marks.filter((other) => other.n !== mark.n).map((other) => other.box);
    const candidates = labelCandidates(mark.box, mark.badge, width, frame);
    const space = (rect) =>
      inside(rect, frame) &&
      !marks.some(
        (other) => other.n !== mark.n && intersects(grow(rect, BADGE_MARGIN), other.badgeBox),
      ) &&
      !intersects(rect, mark.badgeBox) &&
      !placed.some((other) => intersects(grow(rect, LABEL_MARGIN), other.labelBox));
    /*
     * **自分の丸数字がいちばん近いこと**。他の番号のすぐ横に置くと、引き出し線を
     * 目で追う前に「その番号のラベル」と読まれてしまう（`timechart` の①と③）。
     */
    const mine = (rect) =>
      marks.every(
        (other) =>
          other.n === mark.n || distanceTo(rect, mark.badge) <= distanceTo(rect, other.badge),
      );
    const room = (rect) => space(rect) && mine(rect);
    const spare = (rect) =>
      overlapArea(rect, mark.box) <= mark.box.w * mark.box.h * INSIDE_COVER_RATIO;
    const rulesFor = (margin) => {
      const clear = (rect) => !hits(grow(rect, margin), avoid);
      return [
        (rect) => room(rect) && !hits(rect, others) && clear(rect) && !intersects(rect, mark.box),
        (rect) => room(rect) && !hits(rect, others) && clear(rect) && spare(rect),
        (rect) => room(rect) && clear(rect) && spare(rect),
      ];
    };
    /*
     * 近さを先に見る。「他の枠にかからない」を図ぜんぶで探すと、画面いっぱいの欄が
     * 並ぶ図（`session-board`）でラベルが反対の端まで飛び、引き出し線が図を横切る。
     * まず丸数字の近くで探し、近くに無いときだけ遠くまで広げる。
     * 同じ近さなら「文字との隙間を空けた置き方」を先に選ぶ。
     */
    let chosen;
    for (const reach of [100, 200, 400, Number.POSITIVE_INFINITY]) {
      const near = candidates.filter((rect) => distanceTo(rect, mark.badge) <= reach);
      for (const margin of [TEXT_MARGIN, 0]) {
        for (const rule of rulesFor(margin)) {
          chosen = near.find(rule);
          if (chosen !== undefined) break;
        }
        if (chosen !== undefined) break;
      }
      if (chosen !== undefined) break;
    }
    chosen ??=
      leastCovered(candidates, avoid, (rect) => space(rect) && spare(rect)) ??
      leastCovered(candidates, avoid, space);
    if (chosen === undefined) {
      throw new Error(
        `吹き出しのラベルを置く場所がありません: ${mark.n}（${shot.caption}／${mark.label}）`,
      );
    }
    placed.push({ ...mark, labelBox: chosen, labelCovers: coveredArea(chosen, avoid) });
  }
  return { crop, frame, avoid, marks: placed };
}

/**
 * 重ねた HTML を組む。
 *
 * @param imageUrl 素のPNGの URL（`file:///…` や `data:image/png;base64,…`）
 * @param shot     `shots.json` の1件（`caption` と `callouts[{n,label}]`）
 * @param geometry `shot-geometry.json` の1件（`crop?` と `callouts{ "1": {x,y,w,h} }`）
 * @param size     素のPNGの寸法
 */
export function overlayHtml(imageUrl, shot, geometry, size) {
  const plan = planCallouts(shot, geometry, size);
  const { crop, frame } = plan;
  const leaders = [];
  const parts = [];
  for (const mark of plan.marks) {
    const to = {
      x: clamp(mark.badge.x, mark.labelBox.x, mark.labelBox.x + mark.labelBox.w),
      y: clamp(mark.badge.y, mark.labelBox.y, mark.labelBox.y + mark.labelBox.h),
    };
    leaders.push(
      `<line x1="${mark.badge.x}" y1="${mark.badge.y}" x2="${to.x}" y2="${to.y}"></line>`,
    );
    parts.push(
      `<div class="box" style="left:${mark.box.x}px;top:${mark.box.y}px;width:${mark.box.w}px;height:${mark.box.h}px"></div>`,
      `<div class="num" style="left:${mark.badgeBox.x}px;top:${mark.badgeBox.y}px">${mark.mark}</div>`,
      `<div class="label" style="left:${mark.labelBox.x}px;top:${mark.labelBox.y}px;width:${mark.labelBox.w}px">${escapeHtml(mark.label)}</div>`,
    );
  }
  return [
    '<!doctype html>',
    '<html lang="ja"><head><meta charset="utf-8"><style>',
    'html,body{margin:0;padding:0;background:#ffffff}',
    `.frame{position:relative;overflow:hidden;width:${crop.w}px;height:${crop.h}px}`,
    `.shot{position:absolute;left:${-crop.x}px;top:${-crop.y}px;width:${size.width}px;height:${size.height}px}`,
    '.leaders{position:absolute;left:0;top:0}',
    `.leaders line{stroke:${MARK_COLOR};stroke-width:2}`,
    `.box{position:absolute;border:3px solid ${MARK_COLOR};border-radius:4px;box-sizing:border-box;box-shadow:0 0 0 1px rgba(255,255,255,0.9)}`,
    `.num{position:absolute;width:${MARK_SIZE}px;height:${MARK_SIZE}px;line-height:${MARK_SIZE}px;text-align:center;border-radius:${MARK_SIZE / 2}px;background:${MARK_COLOR};color:#ffffff;font:700 18px "Yu Gothic UI","Meiryo",sans-serif;box-shadow:0 0 0 2px #ffffff}`,
    `.label{position:absolute;height:${LABEL_HEIGHT}px;line-height:${LABEL_HEIGHT}px;text-align:center;box-sizing:border-box;background:${MARK_COLOR};color:#ffffff;border-radius:4px;font:700 13px "Yu Gothic UI","Meiryo",sans-serif;white-space:nowrap;box-shadow:0 0 0 2px #ffffff}`,
    '</style></head><body>',
    '<div class="frame">',
    `<img class="shot" src="${imageUrl}" alt="">`,
    `<svg class="leaders" width="${frame.w}" height="${frame.h}">${leaders.join('')}</svg>`,
    ...parts,
    '</div></body></html>',
    '',
  ].join('\n');
}

/** 仕上げの寸法（切り出しがあればその寸法）。 */
export function finishedSize(geometry, size) {
  const crop = geometry.crop;
  return crop === undefined
    ? { width: size.width, height: size.height }
    : { width: crop.w, height: crop.h };
}
