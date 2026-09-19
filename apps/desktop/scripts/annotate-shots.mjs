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
 * どれも満たせないときは組み立てを断る（黙って読めない図を作らない）。
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

/**
 * ラベルを置く候補（近いところから）。枠の外側（右・左・上・下）を先に試し、
 * 1段ずらした位置、最後に枠の中（丸数字のとなり）を試す。
 */
function labelCandidates(box, badge, width) {
  const out = [];
  const midY = badge.y - LABEL_HEIGHT / 2;
  for (let step = 0; step < 3; step += 1) {
    const slide = step * (LABEL_HEIGHT + 6);
    const push = step * (width + 6);
    out.push(
      { x: box.x + box.w + GAP + push, y: midY },
      { x: box.x - GAP - width - push, y: midY },
      // 丸数字は枠の左上にあるので、上下へ出すときは丸数字のぶんだけ右へずらす
      { x: box.x + MARK_SIZE, y: box.y - GAP - LABEL_HEIGHT - slide },
      { x: box.x + MARK_SIZE, y: box.y + box.h + GAP + slide },
      { x: box.x, y: box.y - GAP - LABEL_HEIGHT - slide },
      { x: box.x, y: box.y + box.h + GAP + slide },
      { x: box.x + box.w - width, y: box.y - GAP - LABEL_HEIGHT - slide },
      { x: box.x + box.w - width, y: box.y + box.h + GAP + slide },
    );
  }
  // 逃げ場が無い「欄」向け（枠の中。丸数字のとなり・下・上）
  const side = MARK_SIZE / 2 + 4;
  out.push(
    { x: badge.x + side, y: midY },
    { x: badge.x - side - width, y: midY },
    { x: badge.x + side, y: badge.y + side },
    { x: badge.x + side, y: badge.y - side - LABEL_HEIGHT },
    { x: badge.x - width / 2, y: badge.y + side },
    { x: badge.x - width / 2, y: badge.y - side - LABEL_HEIGHT },
  );
  return out.map((point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
    w: width,
    h: LABEL_HEIGHT,
  }));
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
   * 隣の枠にかからない場所（枠のすぐ左・すぐ上）へ逃がす。どれも駄目なら角へ戻す。
   */
  const half = MARK_SIZE / 2;
  const taken = [];
  const marks = boxes.map((mark, index) => {
    const others = boxes.filter((_other, at) => at !== index).map((other) => other.box);
    const candidates = [
      { x: mark.box.x, y: mark.box.y },
      { x: mark.box.x - half - 4, y: mark.box.y },
      { x: mark.box.x + half, y: mark.box.y - half - 4 },
      { x: mark.box.x - half - 4, y: mark.box.y + mark.box.h / 2 },
    ];
    const boxOf = (point) => ({
      x: clamp(point.x, half, frame.w - half) - half,
      y: clamp(point.y, half, frame.h - half) - half,
      w: MARK_SIZE,
      h: MARK_SIZE,
    });
    // 丸数字どうしは絶対に重ねない。隣の枠は、避けられるときだけ避ける
    const free = (point) => !taken.some((other) => intersects(boxOf(point), other));
    const clear = (point) =>
      inside(boxOf(point), frame) &&
      free(point) &&
      !others.some((other) => intersects(boxOf(point), other));
    const found = candidates.find(clear) ?? candidates.find(free) ?? candidates[0];
    const badgeBox = boxOf(found);
    taken.push(badgeBox);
    return {
      ...mark,
      badge: { x: badgeBox.x + half, y: badgeBox.y + half },
      badgeBox,
    };
  });

  // ②ラベル（指すものの外へ。置けなければ、ほとんど隠さない範囲で中へ）
  const placed = [];
  for (const mark of marks) {
    const width = labelWidth(mark.label);
    const others = marks.filter((other) => other.n !== mark.n);
    let chosen;
    for (const strict of [true, false]) {
      for (const rect of labelCandidates(mark.box, mark.badge, width)) {
        if (!inside(rect, frame)) continue;
        if (marks.some((other) => intersects(rect, other.badgeBox))) continue;
        if (placed.some((other) => intersects(rect, other.labelBox))) continue;
        if (others.some((other) => intersects(rect, other.box))) continue;
        if (strict) {
          if (intersects(rect, mark.box)) continue;
        } else if (overlapArea(rect, mark.box) > mark.box.w * mark.box.h * INSIDE_COVER_RATIO) {
          continue;
        }
        chosen = rect;
        break;
      }
      if (chosen !== undefined) break;
    }
    if (chosen === undefined) {
      throw new Error(
        `吹き出しのラベルを置く場所がありません: ${mark.n}（${shot.caption}／${mark.label}）`,
      );
    }
    placed.push({ ...mark, labelBox: chosen });
  }
  return { crop, frame, marks: placed };
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
