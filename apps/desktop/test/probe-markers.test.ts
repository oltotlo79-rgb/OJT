import { DEFAULT_SOCKET_ROLES } from '@ojt/board-model';
import type { SocketRoles } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { probePositions } from '../src/renderer/three/ProbeMarkers.js';
import { visualSignature } from '../src/renderer/three/BoardScene.js';
import { useStore } from '../src/renderer/app/store.js';
import { NO_HIGHLIGHT } from '../src/renderer/app/store-types.js';

/**
 * 3Dのプローブ表示（Plan 2B Task 7）。設計仕様 §9.3 / §6.4 / §15。
 */

/**
 * 既定の役割割当（`CHK` は `S7`。§6.3）。
 * プランの仮の表は `T3` という役割を置いていたが、実際の `SocketRole` は
 * `CR1〜CR4 / T1 / T2 / CHK` の7つ（`packages/board-model/src/roles.ts`）なので
 * 出荷している既定表（`DEFAULT_SOCKET_ROLES`）をそのまま使う。
 */
const ROLES: SocketRoles = DEFAULT_SOCKET_ROLES;

describe('probePositions（§6.4 役割ID → 物理端子）', () => {
  it('役割IDのプローブを物理端子の座標へ写す', () => {
    const positions = probePositions(
      { black: toTerminalId('CHK.13'), red: toTerminalId('CHK.14') },
      ROLES,
    );
    expect(positions).toHaveLength(2);
    expect(positions[0]?.side).toBe('black');
    expect(positions[1]?.side).toBe('red');
    // 隣り合うピン（⑬と⑭）なので近い
    const [a, b] = positions;
    if (a === undefined || b === undefined) return;
    expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])).toBeLessThan(40);
  });

  it('未配置のプローブは出さない', () => {
    expect(probePositions({ black: undefined, red: undefined }, ROLES)).toEqual([]);
  });

  it('盤に無い端子は黙って落とす（壊れた作業ファイルでも3Dが落ちない。§13 #8）', () => {
    expect(probePositions({ black: toTerminalId('NOPE.99'), red: undefined }, ROLES)).toEqual([]);
  });
});

describe('visualSignature（§15 再描画の引き金）', () => {
  it('プローブが動いたら署名が変わる', () => {
    const base = useStore.getState();
    const before = visualSignature(base);
    const after = visualSignature({
      ...base,
      tester: { ...base.tester, black: toTerminalId('CHK.13') },
    });
    expect(after).not.toBe(before);
  });

  it('ハイライトが変わったら署名が変わる', () => {
    const base = useStore.getState();
    const before = visualSignature({ ...base, highlight: NO_HIGHLIGHT });
    const after = visualSignature({
      ...base,
      highlight: { cellIds: ['c1'], terminals: ['CR1.13'], wireIds: ['sw-001'] },
    });
    expect(after).not.toBe(before);
  });

  it('読値の小数だけが動いても署名は変わらない（アイドル中に描き続けない）', () => {
    const base = useStore.getState();
    const before = visualSignature(base);
    const after = visualSignature({
      ...base,
      snapshot: {
        ...base.snapshot,
        tester: { ...base.snapshot.tester, value: 23.99, display: '23.99 V' },
      },
    });
    expect(after).toBe(before);
  });
});
