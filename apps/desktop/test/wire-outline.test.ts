import { BackSide } from 'three';
import { describe, expect, it } from 'vitest';
import { WIRE_COLORS, WIRE_OUTLINE_COLOR } from '../src/renderer/session/colors.js';
import { sharedMaterial } from '../src/renderer/three/materials.js';
import { shouldOutlineWireBody } from '../src/renderer/three/Wire.js';

/**
 * 白線のアウトライン（§6.6。レビュー指摘: 明るい盤面に白線が同化して見えない）。
 *
 * `Wire` コンポーネント本体は R3F の intrinsic element（`<mesh>` 等）を使うので、DOM の
 * `render()` では検証できない（`wire-geometry.test.ts` と同じ理由）。ここでは
 * 「胴体色が白のときだけアウトラインを付ける」という**純粋関数**の分岐と、
 * アウトライン用マテリアルの設定を R3F 抜きで検証する。
 */

describe('shouldOutlineWireBody', () => {
  it('胴体色が白線の色そのものならアウトラインを付ける', () => {
    expect(shouldOutlineWireBody(WIRE_COLORS['白'])).toBe(true);
  });

  it('選択中でハイライト色に変わった白線はアウトラインを付けない', () => {
    // wireBodyColor() は選択中/既設/レーン重なりを白より優先するので、
    // 「解決後の胴体色」が白のときだけを見る（他の色ならアウトラインは不要）
    expect(shouldOutlineWireBody('#FF4D6D')).toBe(false);
  });

  it('青・黄の物理色はアウトラインを付けない', () => {
    expect(shouldOutlineWireBody(WIRE_COLORS['青'])).toBe(false);
    expect(shouldOutlineWireBody(WIRE_COLORS['黄'])).toBe(false);
  });
});

describe('アウトライン用マテリアル', () => {
  it('BackSide・アウトライン色で、通常の白線マテリアルとは別インスタンスになる', () => {
    const outline = sharedMaterial(WIRE_OUTLINE_COLOR, {
      roughness: 0.9,
      metalness: 0,
      side: BackSide,
    });
    const body = sharedMaterial(WIRE_COLORS['白'], { roughness: 0.55, metalness: 0.05 });
    expect(outline).not.toBe(body);
    expect(outline.side).toBe(BackSide);
  });
});
