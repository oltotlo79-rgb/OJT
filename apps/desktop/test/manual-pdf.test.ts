import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 焼き上がった PDF そのものを検査する。Phase 7 設計 §6.2・§6.3（利用者要望5・6）。
 *
 * 見るのは3つ。① もくじの行が **PDF のリンク注釈**になっていること（押すと飛ぶ）、
 * ② 説明書として成り立つ厚み（60ページ以上）、③ 同じ原稿からは**同じバイト列**が
 * 出ること（配布物のチェックサムが走らせるたびに変わらない。QA-16 と対）。
 *
 * Electron を実際に起動して焼くので時間がかかる。焼くのは1回だけにして、
 * 3つの検査はその結果を読み直す（2回目は同一性の確認のためだけに焼く）。
 */

const electronPath = electron as unknown as string;
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(APP_ROOT, 'scripts', 'build-manual.mjs');
const PRINT = join(APP_ROOT, 'scripts', 'print-manual.mjs');
const HTML = join(APP_ROOT, 'resources', 'manual', 'manual.html');

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function bake(dir: string, name: string): Buffer {
  const pdf = join(dir, name);
  const result = spawnSync(electronPath, [PRINT], {
    cwd: APP_ROOT,
    env: { ...globalThis.process.env, OJT_PRINT_MANUAL_PDF: pdf },
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (result.status !== 0) {
    throw new Error(`PDF を焼けませんでした: ${String(result.status)} ${result.stderr ?? ''}`);
  }
  return readFileSync(pdf);
}

describe('焼いた PDF（設計 §6.2・§6.3）', () => {
  let dir = '';
  let first: Buffer = Buffer.alloc(0);
  let second: Buffer = Buffer.alloc(0);

  beforeAll(() => {
    if (!existsSync(HTML)) {
      const built = spawnSync(globalThis.process.execPath, [BUILD], {
        cwd: APP_ROOT,
        encoding: 'utf8',
      });
      if (built.status !== 0)
        throw new Error(`印刷用HTMLを作れませんでした: ${built.stderr ?? ''}`);
    }
    dir = mkdtempSync(join(tmpdir(), 'ojt-manual-pdf-'));
    first = bake(dir, 'first.pdf');
    second = bake(dir, 'second.pdf');
  }, 600_000);

  const text = (): string => first.toString('latin1');

  it('is a pdf', () => {
    expect(first.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('carries the table of contents as real pdf links', () => {
    expect(text()).toContain('/Annots');
    expect(text()).toContain('/Link');
    expect(/\/Dest|\/GoTo/u.test(text())).toBe(true);
    // もくじの行のぶんだけリンク注釈がある（章13 ＋ 節82 ＋ 本文の相互参照）
    const links = (text().match(/\/Subtype\s*\/Link/gu) ?? []).length;
    expect(links).toBeGreaterThanOrEqual(80);
  });

  it('carries every chapter and section in the bookmarks', () => {
    expect(text()).toContain('/Outlines');
    const count = /\/Type\s*\/Outlines\s*\/First[^>]*?\/Count\s+(\d+)/u.exec(
      text().replace(/\n/gu, ' '),
    );
    expect(Number(count?.[1] ?? 0)).toBeGreaterThanOrEqual(90);
  });

  it('is a manual, not a leaflet', () => {
    const pages = (text().match(/\/Type\s*\/Page[^s]/gu) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(60);
  });

  it('comes out byte for byte the same when it is baked again (QA-16)', () => {
    expect(sha256(second)).toBe(sha256(first));
  });

  it('stamps the day, not the second, so the checksum does not move', () => {
    expect(/\/CreationDate\s*\(D:\d{8}000000/u.test(text())).toBe(true);
  });

  it('cleans up', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
  });
});
