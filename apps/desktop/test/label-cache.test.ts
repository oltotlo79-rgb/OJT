import { JIPM_BOARD } from '@ojt/board-model';
import { Texture } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  blockFaceTexture,
  cachedFaceTexture,
  clearFaceTextureCache,
  faceKey,
  faceRect,
  faceTextureCacheSize,
  PX_PER_MM,
  socketFaceTexture,
  SOCKET_PLATE_MARGIN_MM,
} from '../src/renderer/three/labels.js';

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
