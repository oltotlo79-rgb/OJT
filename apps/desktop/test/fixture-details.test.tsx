import { JIPM_BOARD, terminalBlockShape } from '@ojt/board-model';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 端子台・表示灯・押ボタン・DC24V電源の作り込み（v2.0.0 Task 7・設計 §3.5「形の作り込み」）。
 *
 * 見た目を足しても、**端子の座標・配線の経路・当たり判定は変えない**のが約束。
 * ここでは「飾りが当たり判定を奪わない」「寸法の関係（リングが座より大きい、仕切りが印字の
 * 板より低い）」「押ボタンの頭だけがクリックを受け、沈む動きが残る」を縛る。
 * R3F の要素は DOM へ未知のタグとして生えるので、名前・位置・ハンドラはそこから読む。
 */

/** `TerminalBlock` は drei の `Html`（`Canvas` の中でしか使えない）を持つので素通しに差し替える。 */
vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => children,
}));

const {
  Lamp,
  LAMP_BASE_RADIUS_MM,
  LAMP_LENS_BASE_Z_MM,
  LAMP_RING_RADIUS_MM,
  LAMP_BASE_HEIGHT_MM,
  LAMP_RING_HEIGHT_MM,
} = await import('../src/renderer/three/Lamp.js');
const {
  PushButton,
  CAP_CENTER_Z_MM,
  PB_CAP_RADIUS_MM,
  PB_GUARD_RADIUS_MM,
  PB_GUARD_TUBE_MM,
  PB_GUARD_Z_MM,
  PB_CAP_HEIGHT_MM,
  TRAVEL_MM,
} = await import('../src/renderer/three/PushButton.js');
const { TerminalBlock, DIVIDER_RISE_MM, terminalBlockDividers, terminalBlockEndScrews } =
  await import('../src/renderer/three/TerminalBlock.js');
const { supplyLedMaterial } = await import('../src/renderer/three/SupplyUnit.js');

afterEach(() => {
  cleanup();
});

function positionOf(el: Element | null): number[] {
  return (el?.getAttribute('position') ?? '').split(',').map(Number);
}

describe('表示灯（クロームの化粧リング＋ドーム形のレンズ）', () => {
  it('取付座・化粧リング・レンズを持ち、リングは座より一回り大きく、レンズはリングの上から出る', () => {
    const lamp = JIPM_BOARD.lamps[0];
    if (lamp === undefined) throw new Error('表示灯が無い');
    const { container } = render(<Lamp definition={lamp} level="lit" />);
    for (const name of ['lamp-base', 'lamp-ring', 'lamp-lens']) {
      expect(container.querySelector(`mesh[name="${name}"]`), name).not.toBeNull();
    }
    expect(LAMP_RING_RADIUS_MM).toBeGreaterThan(LAMP_BASE_RADIUS_MM);
    expect(LAMP_LENS_BASE_Z_MM).toBe(LAMP_BASE_HEIGHT_MM + LAMP_RING_HEIGHT_MM);
    expect(positionOf(container.querySelector('mesh[name="lamp-lens"]'))[2]).toBe(
      LAMP_LENS_BASE_Z_MM,
    );
    // 点光源は点灯状態によらず1本（3D-03）
    expect(container.querySelectorAll('pointLight')).toHaveLength(1);
  });
});

describe('押ボタン（化粧リング＋ガード＋押し込む頭）', () => {
  function renderButton(pressed: boolean): {
    container: HTMLElement;
    onPress: ReturnType<typeof vi.fn>;
  } {
    const pb = JIPM_BOARD.pushButtons[0];
    if (pb === undefined) throw new Error('押ボタンが無い');
    const onPress = vi.fn();
    const { container } = render(
      <PushButton
        definition={pb}
        pressed={pressed}
        onPress={onPress}
        onRelease={vi.fn()}
        onToggleHeld={vi.fn()}
      />,
    );
    return { container, onPress };
  }

  it('ガードは頭を囲む輪で、頭の中心（E2E が押す z=4.5）は覆わない', () => {
    const { container } = renderButton(false);
    // ガードは取付座と同じ黒い樹脂なので、取付座と1つの形（`pb-base`）に結合して描く（v2.0.0 Task 17）
    expect(container.querySelector('mesh[name="pb-base"]')).not.toBeNull();
    expect(container.querySelector('mesh[name="pb-guard"]')).toBeNull();
    expect(container.querySelector('mesh[name="pb-ring"]')).not.toBeNull();
    expect(CAP_CENTER_Z_MM).toBe(4.5);
    // ガードの内径は頭より大きい（頭が沈める）
    expect(PB_GUARD_RADIUS_MM - PB_GUARD_TUBE_MM).toBeGreaterThan(PB_CAP_RADIUS_MM);
    // ガードは頭の高さの範囲にあり、頭の天面はガードより上に出る
    const capTop = CAP_CENTER_Z_MM + PB_CAP_HEIGHT_MM / 2;
    expect(PB_GUARD_Z_MM + PB_GUARD_TUBE_MM).toBeLessThan(capTop);
    expect(PB_GUARD_Z_MM).toBeGreaterThan(CAP_CENTER_Z_MM - PB_CAP_HEIGHT_MM / 2);
  });

  it('頭だけがクリックを受け、押すと TRAVEL_MM だけ沈む', () => {
    const { container, onPress } = renderButton(false);
    const cap = container.querySelector('mesh[name="pb-cap"]');
    expect(cap).not.toBeNull();
    expect(positionOf(cap)[2]).toBe(CAP_CENTER_Z_MM);
    // 飾りはハンドラを持たない（DOM に onPointerDown が生えない）
    for (const name of ['pb-base', 'pb-ring']) {
      expect(
        container.querySelector(`mesh[name="${name}"]`)?.getAttribute('onPointerDown'),
      ).toBeNull();
    }
    if (cap !== null) fireEvent.pointerDown(cap, { button: 0, pointerId: 7 });
    expect(onPress).toHaveBeenCalledWith(JIPM_BOARD.pushButtons[0]?.id, 7);
    cleanup();
    const pressed = renderButton(true);
    expect(positionOf(pressed.container.querySelector('mesh[name="pb-cap"]'))[2]).toBe(
      CAP_CENTER_Z_MM - TRAVEL_MM,
    );
  });
});

describe('端子台（仕切り板と両端の固定ねじ）', () => {
  const blockTerminals = (prefix: string): typeof JIPM_BOARD.terminals =>
    JIPM_BOARD.terminals.filter((t) => t.id.startsWith(prefix));

  it('ランプ用8P は横一列で仕切り7枚、P/N は縦2個で仕切り1枚', () => {
    const pl = blockTerminals('TB_PL.');
    const shapePl = terminalBlockShape(pl);
    if (shapePl === undefined) throw new Error('TB_PL の外形が無い');
    const dividers = terminalBlockDividers(pl, shapePl);
    expect(dividers).toHaveLength(pl.length - 1);
    expect(dividers.every((d) => d.along === 'x')).toBe(true);
    // 仕切りは隣り合う端子の中点にあり、端子そのものの上には無い
    for (const divider of dividers) {
      expect(pl.some((t) => Math.abs(t.pos.x - divider.x) < 1)).toBe(false);
    }
    // 仕切りの天面は印字の板より下
    expect(shapePl.bodyTop + DIVIDER_RISE_MM).toBeLessThan(shapePl.printZ);

    const supply = [...blockTerminals('P.'), ...blockTerminals('N.')];
    const shapePn = terminalBlockShape(supply);
    if (shapePn === undefined) throw new Error('P/N の外形が無い');
    const pn = terminalBlockDividers(supply, shapePn);
    expect(pn).toHaveLength(1);
    expect(pn[0]?.along).toBe('y');
  });

  it('固定ねじは台座の両端にあり、端の端子から離れている', () => {
    const pb = blockTerminals('TB_PB.');
    const shape = terminalBlockShape(pb);
    if (shape === undefined) throw new Error('TB_PB の外形が無い');
    const screws = terminalBlockEndScrews(pb, shape);
    expect(screws).toHaveLength(2);
    const xs = pb.map((t) => t.pos.x);
    expect(screws[0]!.x).toBeLessThan(Math.min(...xs));
    expect(screws[1]!.x).toBeGreaterThan(Math.max(...xs));
    // ネジ頭（半径 1.8×0.75）と端の端子の座金（半径 2.7）が重ならない
    const clearance = Math.min(...xs) - screws[0]!.x;
    expect(clearance).toBeGreaterThan(1.8 * 0.75 + 2.7);
  });

  it('描画: 仕切りも固定ねじ（2個）も instancedMesh 1本ずつで、どれも当たり判定を持たない', () => {
    const pl = blockTerminals('TB_PL.');
    const { container } = render(
      <TerminalBlock name="TB_PL" label="ランプ用端子台" terminals={pl} />,
    );
    expect(container.querySelectorAll('instancedMesh[name="block-dividers"]')).toHaveLength(1);
    // v2.0.0 Task 17: 固定ねじ2個は `mesh` 2個ではなく `instancedMesh` 1本（端子台1個につき −1 ドローコール）
    expect(container.querySelectorAll('instancedMesh[name="block-end-screws-TB_PL"]')).toHaveLength(
      1,
    );
    expect(container.querySelectorAll('mesh[name^="block-end-screw-"]')).toHaveLength(0);
  });
});

describe('DC24V電源の表示LED', () => {
  it('通電中だけ発光し、同じ状態なら同じマテリアル', () => {
    expect(supplyLedMaterial(true).emissiveIntensity).toBeGreaterThan(1);
    expect(supplyLedMaterial(false).emissiveIntensity).toBe(0);
    expect(supplyLedMaterial(true)).toBe(supplyLedMaterial(true));
    expect(supplyLedMaterial(true)).not.toBe(supplyLedMaterial(false));
  });
});
