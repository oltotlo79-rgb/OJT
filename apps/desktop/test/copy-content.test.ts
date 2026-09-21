import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyContent } from '../scripts/copy-content.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ojt-copy-test-'));
  roots.push(root);
  const source = join(root, 'source');
  const target = join(root, 'target');
  mkdirSync(join(source, 'assemble'), { recursive: true });
  mkdirSync(join(target, 'obsolete'), { recursive: true });
  writeFileSync(join(source, 'assemble/b-001.json'), '{"name":"正本"}');
  writeFileSync(join(target, 'obsolete/stale.json'), '{}');
  return { root, source, target };
}
describe('配布課題の複写', () => {
  it('正本にないモード・課題を除き、内容を毎回正本へ揃える', () => {
    const f = fixture();
    expect(copyContent(f.source, f.target)).toEqual(['assemble']);
    expect(existsSync(join(f.target, 'obsolete'))).toBe(false);
    writeFileSync(join(f.target, 'assemble/stale.json'), '{}');
    writeFileSync(join(f.target, 'assemble/b-001.json'), '{}');
    copyContent(f.source, f.target);
    expect(existsSync(join(f.target, 'assemble/stale.json'))).toBe(false);
    expect(readFileSync(join(f.target, 'assemble/b-001.json'), 'utf8')).toBe('{"name":"正本"}');
  });
  it('同一フォルダや親子関係では正本を削除しない', () => {
    const f = fixture();
    for (const target of [f.source, join(f.source, 'nested'), f.root])
      expect(() => copyContent(f.source, target)).toThrow();
    expect(readFileSync(join(f.source, 'assemble/b-001.json'), 'utf8')).toContain('正本');
  });
  it('対象内のジャンクションを消しても対象外のリンク先を消さない', () => {
    const f = fixture();
    const outside = join(f.root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    symlinkSync(outside, join(f.target, 'linked'), 'junction');
    copyContent(f.source, f.target);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    expect(existsSync(join(f.target, 'linked'))).toBe(false);
  });
});
