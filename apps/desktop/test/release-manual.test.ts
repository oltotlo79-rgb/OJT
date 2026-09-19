import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** 説明書 PDF が配布物に入ること。取扱説明書 設計 §7.2 / §7.3 / 決定表#6・#27。 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const builderYml = readFileSync(join(APP_ROOT, 'electron-builder.yml'), 'utf8');
const checkDist = readFileSync(join(APP_ROOT, 'scripts', 'check-dist.mjs'), 'utf8');

describe('ビルドの順番（設計 §7.2）', () => {
  it('builds the manual, then the pdf, then the app, then checks the artefacts', () => {
    const dist = pkg.scripts['dist'] ?? '';
    const order = [
      'build-manual.mjs',
      'print-manual.mjs',
      'scripts/build.mjs',
      'electron-builder',
      'check-dist.mjs',
    ];
    let at = -1;
    for (const step of order) {
      const next = dist.indexOf(step);
      expect(next, `dist に ${step} がありません`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('builds the manual before the app in the plain build too', () => {
    expect(pkg.scripts['build']).toContain('build-manual.mjs');
  });
});

describe('同梱（設計 §7.3 / 決定表#6）', () => {
  it('ships the pdf next to the bundled problems, for both the installer and the zip', () => {
    expect(builderYml).toContain('from: resources/manual/manual.pdf');
    expect(builderYml).toContain('to: manual.pdf');
    // 既存の同梱物と配布形態は変えない
    expect(builderYml).toContain('from: resources/content');
    expect(builderYml).toContain('target: nsis');
    expect(builderYml).toContain('target: zip');
  });

  it('checks the pdf in the packaged build', () => {
    expect(checkDist).toContain('manual.pdf');
  });
});

describe('依存（設計 §12 の差分#6）', () => {
  it('adds the markdown reader for the build only', () => {
    expect(pkg.devDependencies['markdown-it']).toBeDefined();
    expect(pkg.dependencies['markdown-it']).toBeUndefined();
    // 実行時依存はワークスペースの6つだけのまま
    expect(Object.keys(pkg.dependencies).every((name) => name.startsWith('@ojt/'))).toBe(true);
  });
});
