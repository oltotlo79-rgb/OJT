import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createPackage } from '@electron/asar';
import { afterEach, describe, expect, it } from 'vitest';
import { artifactNames, inspectRelease } from '../scripts/inspect-dist.mjs';
import { checkDist } from '../scripts/check-dist.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function put(path: string, body: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ojt-release-test-'));
  roots.push(root);
  const app = join(root, 'apps/desktop');
  const release = join(app, 'release');
  const resources = join(release, 'win-unpacked/resources');
  const src = join(root, 'asar-source');
  put(join(app, 'package.json'), '{"version":"1.1.0"}');
  put(
    join(root, 'packages/content/src/builtin/assemble/b-001.json'),
    '{"id":"b-001","name":"課題"}',
  );
  put(join(resources, 'content/assemble/b-001.json'), '{"name":"課題","id":"b-001"}');
  const exe = Buffer.alloc(1024 * 1024);
  exe.write('MZ');
  for (const name of artifactNames('1.1.0')) put(join(release, name), exe);
  put(join(resources, 'manual.pdf'), '%PDF-1.7\n%%EOF');
  put(
    join(release, 'win-unpacked/電気教育ツール.exe'),
    Buffer.concat([
      Buffer.from('MZdL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),
      Buffer.from([1, 8]),
      Buffer.from('01001101'),
    ]),
  );
  mkdirSync(join(app, 'build'), { recursive: true });
  copyFileSync(resolve(import.meta.dirname, '../build/icon.ico'), join(app, 'build/icon.ico'));
  put(join(src, 'package.json'), '{"version":"1.1.0"}');
  put(join(src, 'out/main/index.js'), 'console.log("app");');
  put(join(src, 'out/main/definition-worker.js'), 'export {};');
  put(join(src, 'out/preload/index.cjs'), 'module.exports = {};');
  put(join(src, 'out/renderer/index.html'), '<html lang="ja"></html>');
  for (const mode of [
    'assembly',
    'parts',
    'repair',
    'plc',
    'plc-jtekt',
    'plc-omron',
    'plc-sharp',
  ]) {
    put(join(src, `out/renderer/tutorials/${mode}.webm`), 'fixture-video');
    put(join(src, `out/renderer/tutorials/${mode}.vtt`), 'WEBVTT\n');
  }
  const pack = () => createPackage(src, join(resources, 'app.asar'));
  await pack();
  return { app, release, resources, src, pack };
}
describe('配布物を実際に検査するゲート', () => {
  it('整った配布物を受け入れ、実バイトから計算したPDFハッシュを一覧に書く', async () => {
    const f = await fixture();
    const report = await inspectRelease(f.app);
    expect(report.errors).toEqual([]);
    expect(report.rows).toHaveLength(3);
    const hash = createHash('sha256')
      .update(readFileSync(join(f.resources, 'manual.pdf')))
      .digest('hex')
      .toUpperCase();
    const table = readFileSync(await checkDist(f.app), 'utf8');
    expect(table).toContain(hash);
    expect(table).toContain('Portable.exe');
  });
  it.each(['missing', 'empty', 'wrong-format'])(
    'PDFの%sを拒否し、成功済みの古い一覧も残さない',
    async (kind) => {
      const f = await fixture();
      await checkDist(f.app);
      const pdf = join(f.resources, 'manual.pdf');
      if (kind === 'missing') rmSync(pdf);
      else writeFileSync(pdf, kind === 'empty' ? '' : '<html>not PDF</html>');
      await expect(checkDist(f.app)).rejects.toThrow(/取扱説明書/);
      expect(existsSync(join(f.release, 'artifacts.md'))).toBe(false);
    },
  );
  it.each(['missing', 'changed', 'extra-mode'])('課題の%sを拒否する', async (kind) => {
    const f = await fixture();
    const path = join(f.resources, 'content/assemble/b-001.json');
    if (kind === 'missing') rmSync(path);
    else if (kind === 'changed') writeFileSync(path, '{"id":"b-001","name":"別の課題"}');
    else put(join(f.resources, 'content/obsolete/old.json'), '{}');
    expect((await inspectRelease(f.app)).errors.join('\n')).toMatch(/同梱課題/);
  });
  it.each(['DenkiKyoikuTool-1.0.0-x64-Portable.exe', '電気教育ツール-1.0.0-x64.zip'])(
    '旧成果物 %s を拒否する',
    async (name) => {
      const f = await fixture();
      put(join(f.release, name), 'old');
      expect((await inspectRelease(f.app)).errors.join('\n')).toMatch(/旧版/);
    },
  );
  it.each([
    'missing-main',
    'missing-definition-worker',
    'missing-video',
    'missing-caption',
    'node_modules',
    'old-version',
    'external-dependency',
  ])('asarの%sを拒否する', async (kind) => {
    const f = await fixture();
    if (kind === 'missing-main') rmSync(join(f.src, 'out/main/index.js'));
    else if (kind === 'missing-definition-worker')
      rmSync(join(f.src, 'out/main/definition-worker.js'));
    else if (kind === 'missing-video') rmSync(join(f.src, 'out/renderer/tutorials/assembly.webm'));
    else if (kind === 'missing-caption')
      rmSync(join(f.src, 'out/renderer/tutorials/plc-sharp.vtt'));
    else if (kind === 'node_modules') put(join(f.src, 'node_modules/zod/index.js'), 'test');
    else if (kind === 'old-version') put(join(f.src, 'package.json'), '{"version":"1.0.0"}');
    else put(join(f.src, 'out/main/index.js'), 'const plc = require("@ojt/ladder-core");');
    await f.pack();
    expect((await inspectRelease(f.app)).errors.join('\n')).toMatch(/app.asar/);
  });
  it('小さいEXEと壊れたアイコンを例外で打ち切らず両方報告する', async () => {
    const f = await fixture();
    put(join(f.release, artifactNames('1.1.0')[0]!), 'MZ');
    put(join(f.app, 'build/icon.ico'), Buffer.from([0, 0, 1, 0, 6, 0]));
    const errors = (await inspectRelease(f.app)).errors.join('\n');
    expect(errors).toMatch(/1MiB/);
    expect(errors).toMatch(/アイコン/);
  });
  it.each([0, 2, 3, 4, 5, 7])('実行ファイルのfuse %s の逆転を拒否する', async (key) => {
    const f = await fixture();
    const path = join(f.release, 'win-unpacked/電気教育ツール.exe');
    const bytes = readFileSync(path);
    const at = bytes.length - 8 + key;
    bytes[at] = bytes[at] === 48 ? 49 : 48;
    writeFileSync(path, bytes);
    expect((await inspectRelease(f.app)).errors.join('\n')).toMatch(/実行ファイルの保護/);
  });
});
