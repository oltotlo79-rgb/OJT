import { JIPM_BOARD } from '@ojt/board-model';
import { cleanup, render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { Texture } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bakeSharedTexture,
  blockFaceTexture,
  cachedFaceTexture,
  clearFaceTextureCache,
  faceKey,
  faceRect,
  faceTextureCacheSize,
  isSharedFaceTexture,
  PX_PER_MM,
  socketFaceTexture,
  SOCKET_PLATE_MARGIN_MM,
} from '../src/renderer/three/labels.js';

/** `Fixture` は drei の `Html`（`Canvas` の中でしか使えない）を持つので素通しに差し替える。 */
vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children?: ReactNode }) => children,
}));

const { Fixture } = await import('../src/renderer/three/Fixtures.js');

/** §15 の上限。 */
const MAX_TEXTURE_PX = 2048;

/** ソケット1個ぶんの引数（`Socket.tsx` と同じ作り方）。 */
function socketArgs(index: number) {
  const socket = JIPM_BOARD.sockets[index];
  if (socket === undefined) throw new Error(`ソケット ${index} がありません`);
  const terminals = JIPM_BOARD.terminals.filter((t) => t.id.startsWith(`${socket.id}.`));
  return {
    terminals,
    originX: socket.origin.x - SOCKET_PLATE_MARGIN_MM,
    originY: socket.origin.y - SOCKET_PLATE_MARGIN_MM,
    w: socket.bodyMm.width + SOCKET_PLATE_MARGIN_MM * 2,
    h: socket.bodyMm.length + SOCKET_PLATE_MARGIN_MM * 2,
  };
}

function socketKey(index: number): string {
  const a = socketArgs(index);
  return faceKey('socket', a.terminals, a.originX, a.originY, a.w, a.h);
}

/** 端子台1個ぶんの板（`blockFaceTexture()` と同じ作り方）。 */
function blockPlate(prefix: string) {
  const terminals = JIPM_BOARD.terminals.filter((t) => t.id.startsWith(`${prefix}.`));
  const rect = faceRect(terminals, 6);
  if (rect === undefined) throw new Error(`端子台 ${prefix} がありません`);
  return { terminals, rect };
}

beforeEach(() => {
  clearFaceTextureCache();
});

describe('faceKey（決定表#15 の共有の鍵）', () => {
  it('gives every socket of the board the same key', () => {
    expect(new Set(JIPM_BOARD.sockets.map((_, i) => socketKey(i))).size).toBe(1);
  });

  it('separates two plates of different size', () => {
    const a = socketArgs(0);
    expect(faceKey('socket', a.terminals, a.originX, a.originY, a.w, a.h)).not.toBe(
      faceKey('socket', a.terminals, a.originX, a.originY, a.w + 10, a.h),
    );
  });

  it('keeps the three terminal blocks apart (their prints differ)', () => {
    const keys = ['TB_PL', 'TB_PB', 'P'].map((prefix) => {
      const { terminals, rect } = blockPlate(prefix);
      return faceKey('block', terminals, rect.minX, rect.minY, rect.w, rect.h);
    });
    expect(new Set(keys).size).toBe(3);
  });

  it('never mixes a socket plate with a block plate of the same size', () => {
    const a = socketArgs(0);
    expect(faceKey('socket', a.terminals, a.originX, a.originY, a.w, a.h)).not.toBe(
      faceKey('block', a.terminals, a.originX, a.originY, a.w, a.h),
    );
  });
});

describe('cachedFaceTexture（8枚 → 1枚）', () => {
  it('bakes once and hands the same texture to every socket', () => {
    let bakes = 0;
    const bake = (): Texture => {
      bakes += 1;
      return new Texture();
    };
    const first = cachedFaceTexture(socketKey(0), bake);
    const rest = JIPM_BOARD.sockets.map((_, i) => cachedFaceTexture(socketKey(i), bake));
    expect(bakes).toBe(1);
    expect(rest.every((texture) => texture === first)).toBe(true);
    expect(faceTextureCacheSize()).toBe(1);
  });

  it('stores nothing when the canvas is not available', () => {
    expect(cachedFaceTexture(socketKey(0), () => undefined)).toBeUndefined();
    expect(faceTextureCacheSize()).toBe(0);
  });
});

describe('印字の焼き関数（キャンバスが無い環境でも落ちない）', () => {
  it('returns undefined for an empty terminal list without touching the cache', () => {
    expect(socketFaceTexture([], 0, 0, 10, 10)).toBeUndefined();
    expect(blockFaceTexture([], 6)).toBeUndefined();
    expect(faceTextureCacheSize()).toBe(0);
  });
});

describe('isSharedFaceTexture（I2: 共有キャッシュの持ち物は消費側が dispose() してはいけない）', () => {
  /**
   * `PlcUnit.tsx` / `PlcRack.tsx` のアンマウント時の後始末と同じ形（I2: Plan 5 C/D レビュー）。
   * キャッシュの持ち物（`isSharedFaceTexture()`）でなければ、これまでどおり消費側が破棄する。
   */
  function unmountCleanup(texture: Texture | undefined): void {
    if (!isSharedFaceTexture(texture)) texture?.dispose();
  }

  it('does not dispose a texture handed out by the shared cache', () => {
    const texture = cachedFaceTexture(socketKey(0), () => new Texture());
    if (texture === undefined) throw new Error('テクスチャが焼けませんでした');
    expect(isSharedFaceTexture(texture)).toBe(true);
    const dispose = vi.spyOn(texture, 'dispose');
    unmountCleanup(texture);
    expect(dispose).not.toHaveBeenCalled();
    // 破棄していないので、同じ鍵の再取得（＝もう1つの消費先）も同じ参照のまま使える
    expect(cachedFaceTexture(socketKey(0), () => new Texture())).toBe(texture);
  });

  it('still disposes a texture that never went through the cache (the guard is not a no-op)', () => {
    const standalone = new Texture();
    expect(isSharedFaceTexture(standalone)).toBe(false);
    const dispose = vi.spyOn(standalone, 'dispose');
    unmountCleanup(standalone);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('tolerates an unbaked (undefined) texture', () => {
    expect(isSharedFaceTexture(undefined)).toBe(false);
    expect(() => {
      unmountCleanup(undefined);
    }).not.toThrow();
  });
});

describe('印字テクスチャの解像度（§15: 2048px 以下）', () => {
  it('keeps every plate of the board under the cap (計算だけで確かめる)', () => {
    const plates = [
      ...JIPM_BOARD.sockets.map((socket) => ({
        w: socket.bodyMm.width + SOCKET_PLATE_MARGIN_MM * 2,
        h: socket.bodyMm.length + SOCKET_PLATE_MARGIN_MM * 2,
      })),
      ...['TB_PL', 'TB_PB', 'P'].map((prefix) => blockPlate(prefix).rect),
    ];
    for (const plate of plates) {
      expect(Math.round(plate.w * PX_PER_MM)).toBeLessThanOrEqual(MAX_TEXTURE_PX);
      expect(Math.round(plate.h * PX_PER_MM)).toBeLessThanOrEqual(MAX_TEXTURE_PX);
    }
    // ソケットの板は 38mm × 84mm ＝ 608 × 1344px（決定表#15）
    const first = socketArgs(0);
    expect(Math.round(first.w * PX_PER_MM)).toBe(608);
    expect(Math.round(first.h * PX_PER_MM)).toBe(1344);
  });
});

/**
 * 固定機器（PS / CB / SW）の印字も共有キャッシュを通る（レビュー指摘 3D-04 / 3D-13）。
 *
 * 以前は `Fixtures.tsx` の `fixtureFaceTexture()` だけが `cachedFaceTexture()` を通さず
 * マウントのたびに焼き、解放の `useEffect` も無かった（3枚で約5.6MB、ミップ込み約7.4MB）。
 * 「課題を開く → 結果 → 別の課題」を10回で 50MB 以上が積み上がる形だった。
 * あわせて、印字テクスチャのキャッシュが4方針あった状態（3D-13）を1つに畳んだことを、
 * 「鍵に名前空間が付く」「テスト用のクリアで全部片付く」という2点で縛る。
 */
describe('固定機器の印字も共有キャッシュを通る（3D-04 / 3D-13）', () => {
  afterEach(() => {
    cleanup();
  });

  /** happy-dom は 2D コンテキストを返さないので、焼けるように偽物を挿す。 */
  function stubCanvas2d(): void {
    const ctx = {
      clearRect: () => undefined,
      fillRect: () => undefined,
      fillText: () => undefined,
      measureText: () => ({ width: 0 }),
      fillStyle: '',
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
  }

  function renderSupply(): ReturnType<typeof render> {
    return render(
      createElement(Fixture, {
        name: 'PS',
        label: 'DC24V電源',
        color: '#2A2F36',
        kind: 'supply',
        terminals: JIPM_BOARD.terminals.filter((t) => t.id.startsWith('PS.')),
        footprints: JIPM_BOARD.footprints,
        on: true,
      }),
    );
  }

  it('2回目のマウントで焼き直さない（アプリの寿命ぶん1枚で足りる）', () => {
    stubCanvas2d();
    renderSupply().unmount();
    const afterFirst = faceTextureCacheSize();
    expect(afterFirst).toBeGreaterThan(0);
    renderSupply().unmount();
    expect(faceTextureCacheSize()).toBe(afterFirst);
    vi.restoreAllMocks();
  });

  it('焼いたものは共有キャッシュの持ち物になる（消費側が dispose() してはいけない）', () => {
    const texture = bakeSharedTexture('fixture', 'supply:42x46', () => new Texture());
    expect(isSharedFaceTexture(texture)).toBe(true);
  });

  it('名前空間が違えば別の絵として覚える（`socket` / `fixture` / `part`）', () => {
    const namespaces = ['socket', 'block', 'fixture', 'part'] as const;
    const made = namespaces.map((namespace) =>
      bakeSharedTexture(namespace, 'same-key', () => new Texture()),
    );
    expect(new Set(made).size).toBe(namespaces.length);
    expect(faceTextureCacheSize()).toBe(namespaces.length);
  });
});
