import { describe, expect, it } from 'vitest';
import { isSoftwareRenderer, SHADOW_MAP_SIZE } from '../src/renderer/three/gpu.js';

/**
 * 描画装置の種類に応じた影の解像度（v2.0.0 Task 17）。CI・E2E のソフトウェア描画では
 * 影を 1024 に落とし、GPU があるときは 2048 のまま。
 */
describe('ソフトウェア描画の判定', () => {
  it('Chromium の SwiftShader と Mesa の llvmpipe をソフトウェア描画と判定する', () => {
    expect(
      isSoftwareRenderer(
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      ),
    ).toBe(true);
    expect(isSoftwareRenderer('Mesa/X.org, llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
  });

  it('GPU の名前はソフトウェア描画と判定しない（読めないときも GPU あり扱い）', () => {
    expect(
      isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'),
    ).toBe(false);
    expect(isSoftwareRenderer('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)')).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
  });

  it('Vitest（jsdom）では調べずに GPU あり（影 2048）として扱う', () => {
    expect(SHADOW_MAP_SIZE).toBe(2048);
  });
});
