import { DEFAULT_SOCKET_ROLES, JIPM_BOARD, PLC_UNIT_FX5U, withPlcUnit } from '@ojt/board-model';
import type { SocketRoles } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  highlightPositions,
  ProbeMarkers,
  ProbePen,
  probePositions,
} from '../src/renderer/three/ProbeMarkers.js';
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
/** モードDの盤（机上のPLC本体・壁コンセントの端子を持つ派生盤）。§10.1 */
const PLC_BOARD = withPlcUnit(JIPM_BOARD, PLC_UNIT_FX5U);

describe('probePositions（§6.4 役割ID → 物理端子）', () => {
  it('役割IDのプローブを物理端子の座標へ写す', () => {
    const positions = probePositions(
      { black: toTerminalId('CHK.13'), red: toTerminalId('CHK.14') },
      ROLES,
      JIPM_BOARD,
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
    expect(probePositions({ black: undefined, red: undefined }, ROLES, JIPM_BOARD)).toEqual([]);
  });

  it('盤に無い端子は黙って落とす（壊れた作業ファイルでも3Dが落ちない。§13 #8）', () => {
    expect(
      probePositions({ black: toTerminalId('NOPE.99'), red: undefined }, ROLES, JIPM_BOARD),
    ).toEqual([]);
  });

  it('端子ブロック（TB_PB.1a、役割を介さない物理端子）でも座標を出す', () => {
    const positions = probePositions(
      { black: toTerminalId('TB_PB.1a'), red: undefined },
      ROLES,
      JIPM_BOARD,
    );
    expect(positions).toHaveLength(1);
    expect(positions[0]?.side).toBe('black');
  });

  it('本体端子（CHK.13、役割IDから物理端子へ写す）でも座標を出す', () => {
    const positions = probePositions(
      { black: undefined, red: toTerminalId('CHK.13') },
      ROLES,
      JIPM_BOARD,
    );
    expect(positions).toHaveLength(1);
    expect(positions[0]?.side).toBe('red');
  });
});

describe('ProbeMarkers（§9.3: レイキャストを受けない）', () => {
  it('プローブのメッシュは no-op の raycast を持つ（下の端子のクリックを奪わない）', () => {
    const placements = probePositions(
      { black: toTerminalId('TB_PB.1a'), red: toTerminalId('CHK.13') },
      ROLES,
      JIPM_BOARD,
    );
    expect(placements).toHaveLength(2);
    for (const placement of placements) {
      const meshes = meshesOf(ProbePen({ placement }));
      // 輪・先端・つば・握り・帯の5つ（どれも下の端子のクリックを奪わない）
      expect(meshes).toHaveLength(5);
      for (const raycast of meshes) {
        expect(typeof raycast).toBe('function');
        // no-op: 何も積まず、何も返さない
        expect((raycast as () => unknown)()).toBeUndefined();
      }
    }
  });

  it('テスター棒に当て先の名札を付ける（2026-09-26 利用者報告「当てている個所が分かりにくい」）', () => {
    const placements = probePositions(
      { black: toTerminalId('N.1'), red: toTerminalId('CR1.14') },
      ROLES,
      JIPM_BOARD,
    );
    expect(placements.map((p) => p.label)).toEqual(['黒 N1', '赤 CR1 ⑭ +']);
    const plc = probePositions(
      { black: toTerminalId('OUTLET.N'), red: toTerminalId('PLC.X0') },
      ROLES,
      PLC_BOARD,
    );
    expect(plc.map((p) => p.label)).toEqual(['黒 コンセント N', '赤 PLC X0']);
  });
});

/** 要素の木から `mesh` の `raycast` を集める（描画せずに props だけを見る）。 */
function meshesOf(element: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const el = node as { type?: unknown; props?: { raycast?: unknown; children?: unknown } };
    if (el.type === 'mesh') out.push(el.props?.raycast);
    walk(el.props?.children);
  };
  walk(element);
  return out;
}

describe('モードDの盤の端子（§10.1 / 指摘 3D-07）', () => {
  it('机上のPLC・壁コンセントの端子でもハイライトの座標を返す', () => {
    const terminals = ['PLC.X0', 'OUTLET.L'];
    // 既定の盤には机上の端子が無いので、盤を決め打ちすると黙って消える
    expect(highlightPositions(terminals, ROLES, JIPM_BOARD)).toEqual([]);
    const positions = highlightPositions(terminals, ROLES, PLC_BOARD);
    expect(positions).toHaveLength(2);
    // 机上（盤の右）の端子なので、盤の中の端子より右にある
    const board = highlightPositions(['TB_PB.1a'], ROLES, PLC_BOARD)[0];
    for (const pos of positions) expect(pos[0]).toBeGreaterThan(board?.[0] ?? 0);
  });

  it('プローブも描いている盤から座標を引く', () => {
    expect(
      probePositions({ black: toTerminalId('PLC.X0'), red: undefined }, ROLES, JIPM_BOARD),
    ).toEqual([]);
    expect(
      probePositions({ black: toTerminalId('PLC.X0'), red: undefined }, ROLES, PLC_BOARD),
    ).toHaveLength(1);
  });

  it('派生盤でもハイライトのメッシュが出る', () => {
    const element = ProbeMarkers({
      probes: { black: undefined, red: undefined },
      highlightTerminals: ['PLC.X0', 'OUTLET.L'],
      roles: ROLES,
      board: PLC_BOARD,
    }) as unknown as { props: { children: unknown[] } };
    const children = element.props.children.flat() as { props?: { name?: string } }[];
    expect(children.filter((child) => child?.props?.name === 'highlight-terminal')).toHaveLength(2);
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
