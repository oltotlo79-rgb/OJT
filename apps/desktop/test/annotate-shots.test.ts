import { describe, expect, it } from 'vitest';
import { finishedSize, overlayHtml, planCallouts } from '../scripts/annotate-shots.mjs';

/** 吹き出しを重ねた HTML。取扱説明書 設計 決定表#24c。Playwright は起動しない。 */

const SHOT = {
  caption: 'ホームの画面',
  callouts: [
    { n: 1, label: '設定' },
    { n: 2, label: 'ヘルプ' },
  ],
};

const GEOMETRY = {
  callouts: { '1': { x: 10, y: 20, w: 100, h: 40 }, '2': { x: 120, y: 20, w: 100, h: 40 } },
};

const SIZE = { width: 1280, height: 800 };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('吹き出しの HTML', () => {
  it('puts the raw screenshot behind everything', () => {
    const html = overlayHtml('file:///C:/raw/home.png', SHOT, GEOMETRY, SIZE);
    expect(html).toContain('file:///C:/raw/home.png');
    expect(html).toContain('width:1280px');
    expect(html).toContain('height:800px');
  });

  it('draws a box and a circled number for every callout', () => {
    const html = overlayHtml('file:///raw.png', SHOT, GEOMETRY, SIZE);
    expect(html).toContain('left:10px');
    expect(html).toContain('width:100px');
    expect(html).toContain('①');
    expect(html).toContain('②');
    expect(html).toContain('設定');
    expect(html).toContain('ヘルプ');
  });

  it('joins every circled number to its label with a leader', () => {
    const html = overlayHtml('file:///raw.png', SHOT, GEOMETRY, SIZE);
    expect([...html.matchAll(/<line /gu)]).toHaveLength(2);
  });

  it('moves the picture when the figure is cropped', () => {
    const cropped = { ...GEOMETRY, crop: { x: 40, y: 60, w: 800, h: 500 } };
    const html = overlayHtml('file:///raw.png', SHOT, cropped, SIZE);
    // 切り出しは「窓を 800x500 にして、中の絵を左上へずらす」で表す
    expect(html).toContain('width:800px');
    expect(html).toContain('height:500px');
    expect(html).toContain('left:-40px');
    expect(html).toContain('top:-60px');
  });

  it('moves the boxes with the picture when the figure is cropped', () => {
    const cropped = { ...GEOMETRY, crop: { x: 40, y: 60, w: 800, h: 500 } };
    const html = overlayHtml('file:///raw.png', SHOT, cropped, SIZE);
    // ②は素の座標で x=120 / y=20 なので、切り出した窓の中では x=80 / y=-40 に来る
    expect(html).toContain('left:80px;top:-40px;width:100px;height:40px');
  });

  it('refuses a callout that has no place', () => {
    expect(() => overlayHtml('file:///raw.png', SHOT, { callouts: {} }, SIZE)).toThrow(
      '吹き出しの位置がありません',
    );
  });

  it('refuses a place that falls outside the picture', () => {
    const bad = {
      callouts: { '1': { x: 1240, y: 20, w: 100, h: 40 }, '2': GEOMETRY.callouts['2'] },
    };
    expect(() => overlayHtml('file:///raw.png', SHOT, bad, SIZE)).toThrow('画面の外');
  });

  it('escapes the label so a quote cannot break the page', () => {
    const shot = {
      caption: 'x',
      callouts: [
        { n: 1, label: '「判定」' },
        { n: 2, label: '<b>' },
      ],
    };
    const html = overlayHtml('file:///raw.png', shot, GEOMETRY, SIZE);
    expect(html).toContain('&lt;b&gt;');
  });
});

/**
 * 置き方の約束（2026-09-20 のレビュー指摘）。
 * ラベルは**指すものを隠さない**・**ほかの吹き出しとぶつからない**・**窓からはみ出さない**。
 */
describe('吹き出しの置き方', () => {
  it('keeps the circled number on the corner of what it points at', () => {
    const plan = planCallouts(SHOT, GEOMETRY, { width: 1280, height: 200 });
    // ①は枠の左上の角（左へはみ出すぶんだけ図の中へ寄せる）
    expect(plan.marks[0]?.badge).toEqual({ x: 14, y: 20 });
  });

  it('moves the circled number off the neighbour it would sit on', () => {
    const plan = planCallouts(SHOT, GEOMETRY, SIZE);
    // ②の角（x=120）は①の枠（x=10〜110）に14pxかかるので、角のすぐ上へ逃げる
    expect(plan.marks[1]?.badge).toEqual({ x: 134, y: 14 });
    const [first, second] = plan.marks;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(intersects(first.badgeBox, second.badgeBox)).toBe(false);
  });

  it('never lets a label cover what it points at', () => {
    const plan = planCallouts(SHOT, GEOMETRY, SIZE);
    for (const mark of plan.marks) {
      expect(intersects(mark.labelBox, mark.box), `${mark.mark} が指すものを隠しています`).toBe(
        false,
      );
    }
  });

  it('never lets two labels touch each other', () => {
    const plan = planCallouts(SHOT, GEOMETRY, SIZE);
    const [first, second] = plan.marks;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(intersects(first.labelBox, second.labelBox)).toBe(false);
    expect(intersects(first.labelBox, second.badgeBox)).toBe(false);
  });

  it('keeps every label inside the finished picture', () => {
    const tight = {
      crop: { x: 0, y: 0, w: 240, h: 120 },
      callouts: GEOMETRY.callouts,
    };
    const plan = planCallouts(SHOT, tight, SIZE);
    for (const mark of plan.marks) {
      expect(mark.labelBox.x).toBeGreaterThanOrEqual(0);
      expect(mark.labelBox.y).toBeGreaterThanOrEqual(0);
      expect(mark.labelBox.x + mark.labelBox.w).toBeLessThanOrEqual(240);
      expect(mark.labelBox.y + mark.labelBox.h).toBeLessThanOrEqual(120);
    }
  });

  it('puts the label inside a full-width band, because there is no outside', () => {
    // 画面いっぱいの「欄」を指す吹き出しは外へ出せない。隠してよいのは面積の1割まで
    const band = {
      caption: '練習の画面',
      callouts: [
        { n: 1, label: '上の帯' },
        { n: 2, label: '下の欄' },
      ],
    };
    const geometry = {
      callouts: {
        '1': { x: 0, y: 0, w: 1280, h: 51 },
        '2': { x: 0, y: 51, w: 1280, h: 749 },
      },
    };
    const plan = planCallouts(band, geometry, SIZE);
    const first = plan.marks[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(intersects(first.labelBox, first.box)).toBe(true);
    expect(first.labelBox.w * first.labelBox.h).toBeLessThan(1280 * 51 * 0.1);
  });

  it('refuses to draw when a label has nowhere to go', () => {
    // ラベル（「ヘルプ」は 59px）より狭い窓。どこにも収まらないので組み立てを断る
    const tiny = { crop: { x: 0, y: 0, w: 40, h: 70 }, callouts: GEOMETRY.callouts };
    expect(() => planCallouts(SHOT, tiny, SIZE)).toThrow('置く場所がありません');
  });
});

/**
 * アプリの文字を隠さない置き方（2026-09-20 最終レビュー BL-1）。
 * `shot-geometry.json` の `avoid`（撮影のときに実測した文字の矩形）を避ける。
 */
describe('アプリの文字を避ける', () => {
  it('moves the label off the app text', () => {
    const plain = planCallouts(SHOT, GEOMETRY, SIZE);
    const before = plain.marks[0];
    expect(before).toBeDefined();
    if (before === undefined) return;
    // いま置いた場所を「アプリの文字」にすると、そこは使えなくなる
    const avoid = [{ ...before.labelBox }];
    const after = planCallouts(SHOT, { ...GEOMETRY, avoid }, SIZE).marks[0];
    expect(after).toBeDefined();
    if (after === undefined) return;
    expect(after.labelBox).not.toEqual(before.labelBox);
    expect(intersects(after.labelBox, avoid[0] as Rect)).toBe(false);
    expect(after.labelCovers).toBe(0);
  });

  it('moves the circled number off the app text', () => {
    const plain = planCallouts(SHOT, GEOMETRY, SIZE);
    const before = plain.marks[0];
    expect(before).toBeDefined();
    if (before === undefined) return;
    const avoid = [{ ...before.badgeBox }];
    const after = planCallouts(SHOT, { ...GEOMETRY, avoid }, SIZE).marks[0];
    expect(after).toBeDefined();
    if (after === undefined) return;
    expect(intersects(after.badgeBox, avoid[0] as Rect)).toBe(false);
    expect(after.badgeCovers).toBe(0);
  });

  it('keeps the label away from another callout number', () => {
    // ①のラベルは①の丸数字のほうが②の丸数字より近いこと（番号の取り違えを防ぐ）
    const plan = planCallouts(SHOT, GEOMETRY, SIZE);
    const [first, second] = plan.marks;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    const reach = (from: { x: number; y: number }): number =>
      Math.hypot(
        Math.max(first.labelBox.x - from.x, 0, from.x - (first.labelBox.x + first.labelBox.w)),
        Math.max(first.labelBox.y - from.y, 0, from.y - (first.labelBox.y + first.labelBox.h)),
      );
    expect(reach(first.badge)).toBeLessThanOrEqual(reach(second.badge));
  });

  it('says how much text it had to cover when the whole picture is text', () => {
    // 逃げ場が1つも無い図。黙って読めない図を作らず、隠した面積を残す
    // （`manual-images.test.ts` の検査がこれを見て赤くなる）
    const avoid = [{ x: 0, y: 0, w: 1280, h: 800 }];
    const plan = planCallouts(SHOT, { ...GEOMETRY, avoid }, SIZE);
    for (const mark of plan.marks) {
      expect(mark.labelCovers, `${mark.mark} の被害が記録されていません`).toBeGreaterThan(0);
    }
  });
});

describe('仕上げの寸法', () => {
  it('is the whole screen when there is no crop', () => {
    expect(finishedSize(GEOMETRY, SIZE)).toEqual({ width: 1280, height: 800 });
  });

  it('is the crop when there is one', () => {
    expect(finishedSize({ ...GEOMETRY, crop: { x: 40, y: 60, w: 800, h: 500 } }, SIZE)).toEqual({
      width: 800,
      height: 500,
    });
  });
});
