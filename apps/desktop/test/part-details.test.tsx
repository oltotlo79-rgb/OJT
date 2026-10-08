import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { JA_3D } from '../src/renderer/i18n/ja.js';
import { ARMATURE_TRAVEL_MM, ComponentDetails } from '../src/renderer/three/ComponentDetails.js';

/**
 * リレー・タイマの作り込み（v2.0.0 Task 8・設計 §3.5「形の作り込み」）。
 *
 * MY4N 相当のリレーには、透明ケース越しに見える**機械式インジケータ**（励磁で接点ばねと
 * 一緒に沈む白い旗）と、天面の型式印字（`MY4N` / `DC24V`）を足した。タイマ（H3Y-4 相当）は
 * 天面に型式印字を足した。旗は飾り（`raycast={noPick}`）で、当たり判定は変えない。
 * 印字はキャンバスで焼くので happy-dom では確かめられず、文字列の約束だけを縛る。
 */

afterEach(() => {
  cleanup();
});

function positionOf(el: Element | null): number[] {
  return (el?.getAttribute('position') ?? '').split(',').map(Number);
}

describe('リレーの機械式インジケータ（v2.0.0 Task 8）', () => {
  function renderDetails(relay: boolean, energized: boolean): HTMLElement {
    return render(
      <ComponentDetails
        relay={relay}
        energized={energized}
        width={26}
        height={36}
        center={[0, 0, 0]}
      />,
    ).container;
  }

  it('リレーだけが旗を持ち、励磁すると接点と同じ量だけ沈む', () => {
    const idle = renderDetails(true, false);
    const flagIdle = idle.querySelector('mesh[name="relay-flag"]');
    expect(flagIdle).not.toBeNull();
    expect(positionOf(flagIdle)[2]).toBe(0);
    cleanup();

    const energized = renderDetails(true, true);
    const flagOn = energized.querySelector('mesh[name="relay-flag"]');
    expect(positionOf(flagOn)[2]).toBe(-ARMATURE_TRAVEL_MM);
    expect(ARMATURE_TRAVEL_MM).toBeGreaterThan(0);
    cleanup();

    const timer = renderDetails(false, true);
    expect(timer.querySelector('mesh[name="relay-flag"]')).toBeNull();
  });
});

describe('型式印字の文字（v2.0.0 Task 8）', () => {
  it('リレーは MY4N / DC24V、タイマは H3Y-4 DC24V', () => {
    expect(JA_3D.relayModel).toBe('MY4N');
    expect(JA_3D.relayRating).toBe('DC24V');
    expect(JA_3D.timerModel).toBe('H3Y-4 DC24V');
  });
});
