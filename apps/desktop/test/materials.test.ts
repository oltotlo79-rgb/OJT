import { BackSide, FrontSide } from 'three';
import { describe, expect, it } from 'vitest';
import { sharedMaterial } from '../src/renderer/three/materials.js';

/**
 * 共有マテリアル（§15）。
 *
 * `opacity` / `transparent` と同じ理由で `side` もキャッシュ鍵に混ぜる必要がある
 * （レビュー指摘: 白線の内側アウトラインは `BackSide` で描くが、同じ色の通常の面は
 * `FrontSide` のまま。混ぜないと先に作られた方を使い回してしまう）。
 */

describe('sharedMaterial の side', () => {
  it('同じ色でも FrontSide と BackSide は別インスタンスを返す', () => {
    const front = sharedMaterial('#23272E', { side: FrontSide });
    const back = sharedMaterial('#23272E', { side: BackSide });
    expect(front).not.toBe(back);
    expect(front.side).toBe(FrontSide);
    expect(back.side).toBe(BackSide);
  });

  it('同じ色・同じ side は同じインスタンスを返す（使い回す）', () => {
    const a = sharedMaterial('#23272E', { side: BackSide });
    const b = sharedMaterial('#23272E', { side: BackSide });
    expect(a).toBe(b);
  });

  it('side を省略すると既定（FrontSide）になる', () => {
    const material = sharedMaterial('#112233');
    expect(material.side).toBe(FrontSide);
  });
});
