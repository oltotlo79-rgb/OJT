import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DIN_RAIL_COLOR, SOCKET_BODY_COLOR } from '../src/renderer/session/colors.js';

/**
 * 材質の表（v2.0.0 Task 5・設計 §3.5「描画の土台」）。
 *
 * 盤面・レール・ネジ・樹脂・電線・圧着端子が**名前**で材質を引き、環境マップ
 * （`SceneEnvironment.tsx`）の下で金属は金属らしく、樹脂は樹脂らしく映り込む。
 * 数値そのものより「金属と非金属が分かれている」「同じ名前なら同じ実体」を縛る。
 */

/** `TerminalField` は drei の `Html`（`Canvas` の中でしか使えない）を持つので素通しに差し替える。 */
vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => children,
}));

const { MATERIAL_PRESETS, presetMaterial, sharedMaterial } =
  await import('../src/renderer/three/materials.js');
const { SCREW_MATERIAL } = await import('../src/renderer/three/TerminalField.js');
const { ENVIRONMENT_INTENSITY } = await import('../src/renderer/three/SceneEnvironment.js');

describe('材質の表（v2.0.0 Task 5）', () => {
  it('金属（亜鉛めっき鋼・ニッケルめっき・黄銅）は金属度 0.8 以上、塗装・樹脂・PVC は 0.1 以下', () => {
    for (const name of ['steel', 'nickel', 'brass'] as const) {
      expect(MATERIAL_PRESETS[name].metalness, name).toBeGreaterThanOrEqual(0.8);
    }
    for (const name of ['paint', 'blackResin', 'pvc'] as const) {
      expect(MATERIAL_PRESETS[name].metalness, name).toBeLessThanOrEqual(0.1);
    }
  });

  it('ニッケルめっきのネジ頭がいちばん滑らか（粗さが最小）', () => {
    const roughest = Math.min(
      ...(['steel', 'brass', 'paint', 'blackResin', 'pvc'] as const).map(
        (name) => MATERIAL_PRESETS[name].roughness,
      ),
    );
    expect(MATERIAL_PRESETS.nickel.roughness).toBeLessThan(roughest);
  });

  it('同じ名前・同じ色なら同じ実体（sharedMaterial のキャッシュに載る）', () => {
    const rail = presetMaterial('steel', DIN_RAIL_COLOR);
    expect(presetMaterial('steel', DIN_RAIL_COLOR)).toBe(rail);
    expect(sharedMaterial(DIN_RAIL_COLOR, MATERIAL_PRESETS.steel)).toBe(rail);
    expect(rail.metalness).toBe(MATERIAL_PRESETS.steel.metalness);
    expect(rail.roughness).toBe(MATERIAL_PRESETS.steel.roughness);
    // 色が違えば別の実体
    expect(presetMaterial('steel', '#86929b')).not.toBe(rail);
  });

  it('発光などの追加設定は表の粗さ・金属度を保ったまま別の実体になる', () => {
    const plain = presetMaterial('blackResin', SOCKET_BODY_COLOR);
    const lit = presetMaterial('blackResin', SOCKET_BODY_COLOR, {
      emissive: '#3FBF6F',
      emissiveIntensity: 0.35,
    });
    expect(lit).not.toBe(plain);
    expect(lit.roughness).toBe(plain.roughness);
    expect(lit.metalness).toBe(plain.metalness);
    expect(lit.emissiveIntensity).toBe(0.35);
  });

  it('端子のネジ頭（instanceColor 用の白い1個）も表のニッケルめっきと同じ数値', () => {
    expect(SCREW_MATERIAL.metalness).toBe(MATERIAL_PRESETS.nickel.metalness);
    expect(SCREW_MATERIAL.roughness).toBe(MATERIAL_PRESETS.nickel.roughness);
    expect(`#${SCREW_MATERIAL.color.getHexString()}`).toBe('#ffffff');
  });

  it('環境マップの強さは直射光と足して白飛びしない範囲（0.3〜0.8）', () => {
    expect(ENVIRONMENT_INTENSITY).toBeGreaterThanOrEqual(0.3);
    expect(ENVIRONMENT_INTENSITY).toBeLessThanOrEqual(0.8);
  });
});
