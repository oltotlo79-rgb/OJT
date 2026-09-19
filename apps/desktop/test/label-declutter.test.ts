import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LABEL_RANK,
  LABEL_GAP_PX,
  pickVisibleLabels,
  type LabelCandidate,
  type LabelRect,
} from '../src/renderer/three/label-declutter.js';

/**
 * 3D盤の名札の重なり取り（UI監査バッチE / デザイン規則「なにも重ならない」）。
 *
 * `e2e/ui-quality.spec.ts` の `hud-overlap`（`span.block-label ∩ span.block-label`／
 * `∩ status-overlay`）は致命 100 件超で、モードB「並べて」とモードDの3Dペインに集中していた。
 * 名札は 11px を下回らせられない（画面上 11px 以上がデザイン規則）ので、**入らない名札を
 * 引っ込める**。ここではその選び方を、下の実測値（1440×900 のモードD・OMRON）で縛る。
 */

/** `{x, y, w, h}` を矩形に直す（E2E の findings.json と同じ並びで書けるように）。 */
function box(x: number, y: number, w: number, h: number): LabelRect {
  return { l: x, t: y, r: x + w, b: y + h };
}

describe('名札の重なり取り（`pickVisibleLabels`）', () => {
  it('離れている名札はぜんぶ出す', () => {
    const labels: LabelCandidate[] = [
      { rank: 1, rect: box(0, 0, 40, 16) },
      { rank: 2, rect: box(60, 0, 40, 16) },
      { rank: 3, rect: box(0, 40, 40, 16) },
    ];
    expect(pickVisibleLabels(labels)).toEqual([true, true, true]);
  });

  it('重なったら `rank` の小さいほうを残す（並び順には依らない）', () => {
    const labels: LabelCandidate[] = [
      { rank: 5, rect: box(0, 0, 60, 16) },
      { rank: 1, rect: box(10, 4, 60, 16) },
    ];
    expect(pickVisibleLabels(labels)).toEqual([false, true]);
  });

  it('`rank` が同じときは先に書いたほうを残す（結果が入れ替わらない）', () => {
    const labels: LabelCandidate[] = [
      { rank: 4, rect: box(0, 0, 60, 16) },
      { rank: 4, rect: box(10, 4, 60, 16) },
    ];
    expect(pickVisibleLabels(labels)).toEqual([true, false]);
  });

  it('状態オーバーレイ（`reserved`）とぶつかる名札は引っ込める', () => {
    const overlay = box(8, 8, 200, 20);
    const labels: LabelCandidate[] = [
      { rank: 1, rect: box(20, 12, 60, 16) },
      { rank: 2, rect: box(20, 60, 60, 16) },
    ];
    expect(pickVisibleLabels(labels, [overlay])).toEqual([false, true]);
  });

  it('隙間 `LABEL_GAP_PX` ぶんは必ず空ける', () => {
    const first = box(0, 0, 40, 16);
    const near = box(40 + LABEL_GAP_PX - 1, 0, 40, 16);
    const clear = box(40 + LABEL_GAP_PX, 0, 40, 16);
    expect(
      pickVisibleLabels([
        { rank: 1, rect: first },
        { rank: 2, rect: near },
      ]),
    ).toEqual([true, false]);
    expect(
      pickVisibleLabels([
        { rank: 1, rect: first },
        { rank: 2, rect: clear },
      ]),
    ).toEqual([true, true]);
  });

  it('大きさの無い矩形は出さないし、他の名札の邪魔もしない', () => {
    const labels: LabelCandidate[] = [
      { rank: 1, rect: box(10, 10, 0, 0) },
      { rank: 2, rect: box(0, 0, 40, 16) },
    ];
    expect(pickVisibleLabels(labels)).toEqual([false, true]);
    // 大きさの無い `reserved` も邪魔をしない
    expect(pickVisibleLabels([{ rank: 1, rect: box(0, 0, 40, 16) }], [box(10, 4, 0, 0)])).toEqual([
      true,
    ]);
  });

  it('既定の優先度は「いちばん譲る」', () => {
    expect(DEFAULT_LABEL_RANK).toBeGreaterThan(6);
  });
});

/*
 * 1440×900 のモードD（OMRON・分割）で実測した名札9枚（`getBoundingClientRect()`、
 * バッチEの調査。直す前は 3Dペインが 457×150px まで潰れていて、9枚が団子になっていた）。
 * 優先度は `three/**` の `data-label-rank` と同じ値を書き写す。
 */
const MEASURED: ReadonlyArray<{ text: string; rank: number; rect: LabelRect }> = [
  { text: 'DC24V電源', rank: 3, rect: box(78, 427, 62, 17) },
  { text: 'ブレーカ', rank: 3, rect: box(220, 423, 44, 19) },
  { text: '電源スイッチ', rank: 3, rect: box(241, 431, 75, 21) },
  { text: 'ランプ用端子台', rank: 4, rect: box(102, 488, 80, 18) },
  { text: '押ボタン用端子台', rank: 4, rect: box(182, 488, 101, 19) },
  { text: 'DC24V端子台', rank: 4, rect: box(95, 420, 75, 17) },
  { text: 'CP1E-N30DR-A', rank: 5, rect: box(290, 429, 108, 22) },
  { text: 'OMRON CP1E-N30DR-A', rank: 1, rect: box(254, 465, 169, 23) },
  { text: '壁コンセント（AC100V）', rank: 2, rect: box(239, 515, 141, 20) },
];

describe('実測の名札（1440×900 モードD・OMRON）', () => {
  const visible = pickVisibleLabels(
    MEASURED.map(({ rank, rect }) => ({ rank, rect })),
    [],
  );
  const shown = MEASURED.filter((_unused, index) => visible[index] === true);

  it('残った名札どうしは1枚も重ならない', () => {
    for (let i = 0; i < shown.length; i += 1) {
      for (let j = i + 1; j < shown.length; j += 1) {
        const a = shown[i];
        const b = shown[j];
        if (a === undefined || b === undefined) continue;
        const overlapX = Math.min(a.rect.r, b.rect.r) - Math.max(a.rect.l, b.rect.l);
        const overlapY = Math.min(a.rect.b, b.rect.b) - Math.max(a.rect.t, b.rect.t);
        expect(overlapX > 0 && overlapY > 0, `${a.text} ∩ ${b.text}`).toBe(false);
      }
    }
  });

  it('機種名と壁コンセントは必ず残る（モードDの課題がこの2つを指す）', () => {
    const texts = shown.map((label) => label.text);
    expect(texts).toContain('OMRON CP1E-N30DR-A');
    expect(texts).toContain('壁コンセント（AC100V）');
  });

  it('全部消してしまわない（読めるものは読める状態で残す）', () => {
    expect(shown.length).toBeGreaterThanOrEqual(5);
  });
});
