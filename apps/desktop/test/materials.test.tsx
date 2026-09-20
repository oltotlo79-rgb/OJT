import { socketPinHoleOffsets, JIPM_BOARD, type SocketDefinition } from '@ojt/board-model';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BackSide, CylinderGeometry, FrontSide } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIN_HOLE_GEOMETRY, sharedMaterial } from '../src/renderer/three/materials.js';

/** `Socket` は drei の `Html`（`Canvas` の中でしか使えない）を持つので素通しに差し替える。 */
vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => children,
}));

const { Socket } = await import('../src/renderer/three/Socket.js');

afterEach(() => {
  cleanup();
});

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

/**
 * 差込穴の共有（レビュー指摘 3D-02）。
 *
 * `materials.ts` 冒頭の「形と色が同じものは必ず1個を使い回す」という明文の方針を、
 * ここで初めて実行可能にする。以前は穴1個につき `<cylinderGeometry>` と
 * `<meshStandardMaterial>` を JSX の子として書いていたので、盤の8ソケットで
 * **112個のジオメトリ・112個のマテリアル・112ドローコール**になっていた。
 */
/** 盤の1個目のソケット（無ければテストの前提が崩れている）。 */
function firstSocket(): SocketDefinition {
  const socket = JIPM_BOARD.sockets[0];
  if (socket === undefined) throw new Error('ソケットが無い');
  return socket;
}

describe('ソケットの差込穴は共有ジオメトリ1個・共有マテリアル1個（3D-02）', () => {
  const socket = firstSocket();
  const terminals = JIPM_BOARD.terminals.filter((t) => t.id.startsWith(`${socket.id}.`));

  function renderSocket(): ReturnType<typeof render> {
    return render(
      <Socket
        socket={socket}
        role="CR1"
        occupied={false}
        selected={false}
        terminals={terminals}
        onPickSocket={() => undefined}
      />,
    );
  }

  it('穴ごとに CylinderGeometry も MeshStandardMaterial も作らない', () => {
    const { container } = renderSocket();
    expect(socketPinHoleOffsets().length).toBeGreaterThan(1);
    expect(container.querySelectorAll('cylinderGeometry')).toHaveLength(0);
    expect(container.querySelectorAll('meshStandardMaterial')).toHaveLength(0);
  });

  it('穴は `instancedMesh` 1本に畳まれる', () => {
    const { container } = renderSocket();
    expect(container.querySelectorAll('instancedMesh')).toHaveLength(1);
  });

  it('共有ジオメトリは半径1で作られ、マテリアルも使い回される', () => {
    expect(PIN_HOLE_GEOMETRY).toBeInstanceOf(CylinderGeometry);
    expect(PIN_HOLE_GEOMETRY.parameters.radiusTop).toBe(1);
    expect(PIN_HOLE_GEOMETRY.parameters.radialSegments).toBe(8);
    expect(sharedMaterial('#0B0D10', { roughness: 0.9 })).toBe(
      sharedMaterial('#0B0D10', { roughness: 0.9 }),
    );
  });
});
