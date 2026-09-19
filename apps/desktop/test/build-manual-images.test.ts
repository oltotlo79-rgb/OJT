import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { availableImages } from '../scripts/build-manual.mjs';

/**
 * 撮り終わっている図の判定。Minor#4（Phase 6 A/B レビュー）。
 *
 * `images/<name>.png`（原寸）だけでなく `images/small/<name>.png`（縮小版）も
 * そろっていて初めて「撮れている」として扱う。縮小版だけが欠けた図を「撮れている」と
 * 誤判定すると、生成物が無い縮小版を import しようとして `pnpm build` が Vite の解決で落ちる。
 */

let dir: string | undefined;

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  vi.restoreAllMocks();
});

describe('縮小版がそろっている図だけを撮れている扱いにする', () => {
  it('excludes a figure whose reduced copy (images/small/) is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'ojt-manual-images-'));
    mkdirSync(join(dir, 'small'));
    writeFileSync(join(dir, 'both.png'), '');
    writeFileSync(join(dir, 'small', 'both.png'), '');
    // フルサイズだけあって縮小版が無い（このケースを弾く）
    writeFileSync(join(dir, 'full-only.png'), '');
    const warn = vi.spyOn(globalThis.process.stderr, 'write').mockReturnValue(true);

    expect(availableImages(dir)).toEqual(['both']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('images/small/full-only.png'));
  });

  it('excludes a figure whose full-size copy is missing but a reduced copy exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'ojt-manual-images-'));
    mkdirSync(join(dir, 'small'));
    writeFileSync(join(dir, 'small', 'orphan-small.png'), '');
    expect(availableImages(dir)).toEqual([]);
  });

  it('returns an empty list when the image directory does not exist yet', () => {
    expect(availableImages(join(tmpdir(), 'ojt-manual-images-does-not-exist'))).toEqual([]);
  });

  it('returns an empty list when nothing has both copies', () => {
    dir = mkdtempSync(join(tmpdir(), 'ojt-manual-images-'));
    writeFileSync(join(dir, 'no-small.png'), '');
    expect(availableImages(dir)).toEqual([]);
  });
});
