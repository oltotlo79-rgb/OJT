import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { finishedSize, planCallouts } from '../scripts/annotate-shots.mjs';

/**
 * 図そのものの検査。取扱説明書 設計 §6.4 / 決定表#24b・#25、受入基準⑦。
 * **撮影（Plan 6 Task 12）で初めて入れる**——それより前に入れると、撮るまで落ち続ける。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const IMAGE_DIR = join(MANUAL_DIR, 'images');
const SMALL_DIR = join(IMAGE_DIR, 'small');

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Shot {
  caption: string;
  callouts: Array<{ n: number; label: string }>;
}

interface Geometry {
  crop?: Rect;
  callouts: Record<string, Rect>;
  /** 撮影のときに実測した「アプリの文字」の矩形（吹き出しを置いてはいけないところ）。 */
  avoid?: Rect[];
}

const SHOTS = JSON.parse(readFileSync(join(MANUAL_DIR, 'shots.json'), 'utf8')) as Record<
  string,
  Shot
>;
const GEOMETRY = JSON.parse(readFileSync(join(MANUAL_DIR, 'shot-geometry.json'), 'utf8')) as Record<
  string,
  Geometry
>;

/** 原寸1枚あたりの上限。決定表#25 */
const MAX_BYTES = 300 * 1024;
/** 縮小版1枚あたりの上限（利用者の決定 2026-09-20）。 */
const MAX_SMALL_BYTES = 80 * 1024;
/**
 * 原寸フォルダ合計の上限。v1.7.0 で図を42枚から72枚へ増やした（2026-09-26 利用者指示
 * 「取扱説明書とヘルプの内容ももっと画像を増やして」）ため、6MB から 10MB へ広げた。
 * 1枚あたりの上限（300KB）はそのまま。
 */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
/** 縮小版フォルダ合計の上限（同じ理由で 1.5MB から 3MB へ）。 */
const MAX_SMALL_TOTAL_BYTES = 3 * 1024 * 1024;
/** アプリ内ヘルプが本文に出す幅。 */
const HELP_IMAGE_WIDTH = 400;
/** 撮った大きさ。 */
const SHOT_SIZE = { width: 1280, height: 800 };
/** 「欄」を指す吹き出しのラベルが、その欄を隠してよい割合（`annotate-shots.mjs` と同じ）。 */
const INSIDE_COVER_RATIO = 0.1;

/** PNG のヘッダ（IHDR）から寸法を読む。画像ライブラリは要らない。 */
function pngSize(path: string): { width: number; height: number } {
  const head = readFileSync(path).subarray(0, 24);
  expect(head.subarray(0, 8).toString('hex'), `${path} は PNG ではありません`).toBe(
    '89504e470d0a1a0a',
  );
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return width <= 0 || height <= 0 ? 0 : width * height;
}

/** 全図の置き方（`overlayHtml()` が描くのと同じ計算）。 */
function planOf(name: string): ReturnType<typeof planCallouts> {
  const shot = SHOTS[name];
  const geometry = GEOMETRY[name];
  if (shot === undefined || geometry === undefined) throw new Error(`${name} の定義がありません`);
  return planCallouts(shot, geometry, SHOT_SIZE);
}

const files = readdirSync(IMAGE_DIR)
  .filter((name) => name.endsWith('.png'))
  .sort();
const smallFiles = readdirSync(SMALL_DIR)
  .filter((name) => name.endsWith('.png'))
  .sort();
const names = Object.keys(SHOTS).sort();

describe('図はすべて本アプリの実画面（決定表#24b）', () => {
  it('has exactly the files the manual defines', () => {
    expect(files.map((name) => name.replace(/\.png$/u, '')).sort()).toEqual(names);
  });

  it('gives every figure a place for its callouts', () => {
    expect(Object.keys(GEOMETRY).sort()).toEqual(names);
  });

  it('measures every callout the manual points at', () => {
    const missing: string[] = [];
    for (const name of names) {
      for (const callout of SHOTS[name]?.callouts ?? []) {
        if (GEOMETRY[name]?.callouts[String(callout.n)] === undefined) {
          missing.push(`${name} の吹き出し ${String(callout.n)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('大きさと寸法（決定表#25）', () => {
  it.each(files)('%s is small enough to ship', (name) => {
    const bytes = statSync(join(IMAGE_DIR, name)).size;
    expect(
      bytes,
      `${name} が ${String(MAX_BYTES)} バイトを超えています。shot-geometry.json の crop を狭めてください（縮小はしない）`,
    ).toBeLessThanOrEqual(MAX_BYTES);
  });

  it.each(files)('%s has the size its definition says', (name) => {
    const id = name.replace(/\.png$/u, '');
    const geometry = GEOMETRY[id];
    expect(geometry, `${id} の定義がありません`).toBeDefined();
    if (geometry === undefined) return;
    expect(pngSize(join(IMAGE_DIR, name))).toEqual(finishedSize(geometry, SHOT_SIZE));
  });

  it('keeps the whole folder under the budget', () => {
    const total = files.reduce((sum, name) => sum + statSync(join(IMAGE_DIR, name)).size, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });
});

describe('縮小版（利用者の決定 2026-09-20）', () => {
  it('has one reduced copy for every figure, under the same name', () => {
    expect(smallFiles).toEqual(files);
  });

  it.each(smallFiles)('%s is 400px wide and light enough for the drawer', (name) => {
    const size = pngSize(join(SMALL_DIR, name));
    expect(size.width, `${name} の縮小版の幅が違います`).toBe(HELP_IMAGE_WIDTH);
    const full = pngSize(join(IMAGE_DIR, name));
    // 縦横の比は原寸と同じ（切り上げの1pxまで）
    expect(
      Math.abs(size.height - (full.height * HELP_IMAGE_WIDTH) / full.width),
    ).toBeLessThanOrEqual(1);
    expect(
      statSync(join(SMALL_DIR, name)).size,
      `${name} の縮小版が ${String(MAX_SMALL_BYTES)} バイトを超えています`,
    ).toBeLessThanOrEqual(MAX_SMALL_BYTES);
  });

  it('keeps the reduced copies under their own budget', () => {
    const total = smallFiles.reduce((sum, name) => sum + statSync(join(SMALL_DIR, name)).size, 0);
    expect(total).toBeLessThanOrEqual(MAX_SMALL_TOTAL_BYTES);
  });
});

/**
 * 吹き出しの置き方（2026-09-20 のレビュー指摘）。図そのものを見なくても、
 * `shot-geometry.json` と `overlayHtml()` の置き方から同じことが確かめられる。
 */
describe('吹き出しが読める置き方になっている', () => {
  const plans = names.map((name) => ({ name, plan: planOf(name) }));

  it.each(plans.map((row) => row.name))('%s never hides what a callout points at', (name) => {
    const found = plans.find((row) => row.name === name);
    expect(found).toBeDefined();
    if (found === undefined) return;
    for (const mark of found.plan.marks) {
      const covered = overlapArea(mark.labelBox, mark.box);
      expect(
        covered,
        `${name} の ${mark.mark}（${mark.label}）が指すものを隠しています`,
      ).toBeLessThanOrEqual(mark.box.w * mark.box.h * INSIDE_COVER_RATIO);
    }
  });

  /*
   * ラベルが**隣の枠の中**に入るのは許す（2026-09-20 最終レビュー BL-1 の直し）。
   * 画面いっぱいの欄が並ぶ図（`session-board`・`plc-ladder`）では、枠の外に出ると
   * かならず隣の枠に入る。「隣の枠を避ける」を優先すると、ラベルが図の反対の端まで
   * 飛んで引き出し線が画面を横切った（①のラベルが 932px 先にあった）。
   * 読めることを支えるのは、①アプリの文字に乗らない（次の describe）②他の吹き出しの
   * 番号・ラベルに重ならない ③自分の番号のそばにある（引き出し線で結べる長さ）、の3つ。
   */
  it('never lets a label cover another number or another label', () => {
    const problems: string[] = [];
    for (const { name, plan } of plans) {
      for (const mark of plan.marks) {
        for (const other of plan.marks) {
          if (other.n === mark.n) continue;
          if (intersects(mark.labelBox, other.labelBox)) {
            problems.push(`${name}: ${mark.mark} と ${other.mark} のラベルが重なっています`);
          }
          if (intersects(mark.labelBox, other.badgeBox)) {
            problems.push(`${name}: ${mark.mark} のラベルが ${other.mark} に重なっています`);
          }
          /*
           * 丸数字どうしは重ねない。丸数字が**隣の枠の線**にかかるのは許す:
           * 画面いっぱいの欄が縦に並ぶ図（`session-board`）やビューキューブの
           * ⌂/⟳ のように、隣の枠から 14px 離せない置き場所しか無いことがある。
           * 枠は細い線なので、かかっても中の文字は読める（`planCallouts()` は
           * 先に「隣の枠にかからない置き場所」を探し、無いときだけ角へ戻す）。
           */
          if (intersects(mark.badgeBox, other.badgeBox)) {
            problems.push(`${name}: ${mark.mark} と ${other.mark} が重なっています`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps every label within reach of its own number', () => {
    /*
     * 引き出し線の長さの上限[px]。これより遠いと、どの番号のラベルか目で追えない。
     * 長めにしてあるのは、`planCallouts()` が「自分の丸数字がいちばん近いこと」を
     * 先に満たすためで、近くが他の番号のそばしか空いていない図では少し離れる。
     */
    const LEADER_MAX = 200;
    const problems: string[] = [];
    for (const { name, plan } of plans) {
      for (const mark of plan.marks) {
        const dx = Math.max(
          mark.labelBox.x - mark.badge.x,
          0,
          mark.badge.x - (mark.labelBox.x + mark.labelBox.w),
        );
        const dy = Math.max(
          mark.labelBox.y - mark.badge.y,
          0,
          mark.badge.y - (mark.labelBox.y + mark.labelBox.h),
        );
        const reach = Math.round(Math.hypot(dx, dy));
        if (reach > LEADER_MAX) {
          problems.push(`${name}: ${mark.mark} のラベルが ${String(reach)}px 離れています`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps every number and label inside the finished picture', () => {
    const problems: string[] = [];
    for (const { name, plan } of plans) {
      for (const mark of plan.marks) {
        for (const [what, rect] of [
          ['番号', mark.badgeBox],
          ['ラベル', mark.labelBox],
        ] as const) {
          if (
            rect.x < 0 ||
            rect.y < 0 ||
            rect.x + rect.w > plan.frame.w ||
            rect.y + rect.h > plan.frame.h
          ) {
            problems.push(`${name}: ${mark.mark} の${what}が図の外にはみ出しています`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/**
 * ラベルと丸数字が**アプリの文字**の上に乗っていないこと（2026-09-20 最終レビュー BL-1）。
 * 避けたい矩形は撮影のときに実測して `shot-geometry.json` の `avoid` に入っている。
 * ここは「置き方の規則」ではなく**その図の実物**（測った文字の場所）と突き合わせるので、
 * 画面を直して文字が動いたのに撮り直していない、という取りこぼしも赤くなる。
 */
describe('吹き出しがアプリの文字を隠していない（最終レビュー BL-1）', () => {
  it('measures the app text of every figure', () => {
    const empty = names.filter((name) => (GEOMETRY[name]?.avoid ?? []).length === 0);
    expect(empty, '文字の矩形を測れていない図があります（撮り直してください）').toEqual([]);
  });

  it.each(names)('%s never puts a number or a label on the app text', (name) => {
    const geometry = GEOMETRY[name];
    expect(geometry, `${name} の定義がありません`).toBeDefined();
    if (geometry === undefined) return;
    const crop = geometry.crop ?? { x: 0, y: 0, w: SHOT_SIZE.width, h: SHOT_SIZE.height };
    // `avoid` は切り出す前の画面の座標なので、図の中の座標へ直してから見る
    const avoid = (geometry.avoid ?? []).map((rect) => ({
      x: rect.x - crop.x,
      y: rect.y - crop.y,
      w: rect.w,
      h: rect.h,
    }));
    const problems = new Set<string>();
    for (const mark of planOf(name).marks) {
      for (const rect of avoid) {
        if (intersects(mark.labelBox, rect)) {
          problems.add(`${mark.mark}「${mark.label}」のラベルがアプリの文字に乗っています`);
        }
        if (intersects(mark.badgeBox, rect)) {
          problems.add(`${mark.mark} の番号がアプリの文字に乗っています`);
        }
      }
    }
    expect([...problems], `${name} が読めません`).toEqual([]);
  });
});
