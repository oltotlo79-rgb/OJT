import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../src/main/fs-atomic.js';

let root: string;
let target: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ojt-atomic-'));
  target = join(root, 'settings.json');
  writeFileSync(target, '保存済み');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 実ファイルを共有削除不可で開く。組込fsのモックで成功を装わない。 */
async function holdFile() {
  const ready = join(root, 'ready');
  const release = join(root, 'release');
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$file = [System.IO.File]::Open($env:OJT_LOCK_TARGET, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); try { [System.IO.File]::WriteAllText($env:OJT_LOCK_READY, "ready"); while (-not [System.IO.File]::Exists($env:OJT_LOCK_RELEASE)) { Start-Sleep -Milliseconds 1 }; Start-Sleep -Milliseconds 100 } finally { $file.Dispose() }',
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        OJT_LOCK_TARGET: target,
        OJT_LOCK_READY: ready,
        OJT_LOCK_RELEASE: release,
      },
    },
  );
  const closed = once(child, 'close');
  try {
    await expect.poll(() => existsSync(ready), { timeout: 3000 }).toBe(true);
    expect(() => renameSync(target, join(root, 'must-not-move'))).toThrow();
  } catch (error) {
    writeFileSync(release, 'release');
    await closed;
    throw error;
  }
  return {
    // 同期保存がイベントループを止める前に、解放指示を必ず相手へ届ける。
    // stdin.endではNode 22のパイプ書込が未完了のままAtomics.waitへ入る場合がある。
    release: () => writeFileSync(release, 'release'),
    closed,
  };
}

describe.runIf(process.platform === 'win32')(
  '実ファイルの保持があっても保存済みの内容を保護する',
  () => {
    it('保持が解消してから一括で置換する', async () => {
      const lock = await holdFile();
      try {
        lock.release();
        writeFileAtomic(target, '更新済み');
        expect(readFileSync(target, 'utf8')).toBe('更新済み');
        expect(existsSync(`${target}.tmp`)).toBe(false);
      } finally {
        await lock.closed;
      }
    });

    it('保持が続けば打ち切り、元の内容を残して失敗を通知する', async () => {
      const lock = await holdFile();
      try {
        expect(() => writeFileAtomic(target, '未保存')).toThrow();
        expect(readFileSync(target, 'utf8')).toBe('保存済み');
        expect(existsSync(`${target}.tmp`)).toBe(false);
      } finally {
        lock.release();
        await lock.closed;
      }
      // 解放後の次の保存は通常どおり成功する。
      writeFileAtomic(target, '再保存');
      expect(readFileSync(target, 'utf8')).toBe('再保存');
    });
  },
);
