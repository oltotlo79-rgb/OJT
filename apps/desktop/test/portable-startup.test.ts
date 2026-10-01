// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { notifyPortableReady } from '../src/main/portable-startup.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function launchFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'ojt-ready-test-'));
  folders.push(folder);
  mkdirSync(join(folder, 'app'));
  return folder;
}
describe('ポータブル版の起動画面', () => {
  it('今回の展開先へ、本体が表示された通知を書ける', () => {
    const folder = launchFolder();
    const ready = join(folder, 'ojt-ready');
    expect(notifyPortableReady(join(folder, 'app', 'OJT.exe'), ready, true)).toBe(true);
    expect(readFileSync(ready, 'utf8')).toBe('ready');
  });
  it('開発起動・通知未指定・別起動の通知先では書かない', () => {
    const current = launchFolder();
    const other = launchFolder();
    const executable = join(current, 'app', 'OJT.exe');
    expect(notifyPortableReady(executable, join(current, 'ojt-ready'), false)).toBe(false);
    expect(notifyPortableReady(executable, undefined, true)).toBe(false);
    expect(notifyPortableReady(executable, join(other, 'ojt-ready'), true)).toBe(false);
    expect(existsSync(join(current, 'ojt-ready'))).toBe(false);
    expect(existsSync(join(other, 'ojt-ready'))).toBe(false);
  });
  it('起動途中で展開先がなくなっても本体を落とさない', () => {
    const folder = launchFolder();
    rmSync(folder, { recursive: true });
    expect(
      notifyPortableReady(join(folder, 'app', 'OJT.exe'), join(folder, 'ojt-ready'), true),
    ).toBe(false);
  });
});
