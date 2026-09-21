import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from '../src/main/fs-atomic.js';

let root: string;
let target: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ojt-atomic-'));
  target = join(root, 'settings.json');
  writeFileSync(target, '保存済み');
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** 実ファイルを共有削除不可で開く。組込fsのモックで成功を装わない。 */
async function holdFile() {
  const ready = join(root, 'ready');
  const release = join(root, 'release');
  const released = join(root, 'released');
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference = "Stop"; $file = [System.IO.File]::Open($env:OJT_LOCK_TARGET, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); try { [System.IO.File]::WriteAllText($env:OJT_LOCK_READY, "ready"); $deadline = [DateTime]::UtcNow.AddSeconds(20); while (-not [System.IO.File]::Exists($env:OJT_LOCK_RELEASE)) { if ([DateTime]::UtcNow -gt $deadline) { throw "release signal timed out" }; Start-Sleep -Milliseconds 1 } } finally { $file.Dispose(); [System.IO.File]::WriteAllText($env:OJT_LOCK_RELEASED, "released") }',
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        OJT_LOCK_TARGET: target,
        OJT_LOCK_READY: ready,
        OJT_LOCK_RELEASE: release,
        OJT_LOCK_RELEASED: released,
      },
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  // 終了待ち自体にも上限を置く。準備失敗・アサーション失敗でも子を残さない。
  const closed = new Promise<number | null>((done) => child.once('close', done));
  const stop = async () => {
    writeFileSync(release, 'release');
    const timer = setTimeout(() => child.kill(), 10_000);
    try {
      const code = await closed;
      if (spawnError) throw spawnError;
      if (code !== 0)
        throw new Error(`ファイル保持プロセスが異常終了しました (${code}): ${stderr}`);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await expect
      .poll(
        () => {
          if (spawnError) throw spawnError;
          return existsSync(ready);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    expect(() => renameSync(target, join(root, 'must-not-move'))).toThrow();
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    releaseAndWait: () => {
      writeFileSync(release, 'release');
      const deadline = Date.now() + 10_000;
      const originalWait = realWait;
      while (!existsSync(released)) {
        if (Date.now() >= deadline) throw new Error(`ファイルの解放を確認できません: ${stderr}`);
        originalWait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    },
    stop,
  };
}

const realWait = Atomics.wait.bind(Atomics);

describe.runIf(process.platform === 'win32')(
  '実ファイルの保持があっても保存済みの内容を保護する',
  () => {
    it('保持が解消してから一括で置換する', async () => {
      const lock = await holdFile();
      try {
        // 最初のrenameは実ロックで必ず失敗させる。再試行の待機点で解放完了を
        // 確認することで、CIのプロセス起動速度・スケジューリングに依存させない。
        // fsは差し替えず実ファイルを置換し、待機回数と本来の50ms指定も検査する。
        const wait = vi.spyOn(Atomics, 'wait').mockImplementation(() => {
          lock.releaseAndWait();
          return 'timed-out';
        });
        writeFileAtomic(target, '更新済み');
        expect(wait).toHaveBeenCalledTimes(1);
        expect(wait.mock.calls[0]?.[3]).toBe(50);
        expect(readFileSync(target, 'utf8')).toBe('更新済み');
        expect(existsSync(`${target}.tmp`)).toBe(false);
      } finally {
        await lock.stop();
      }
    }, 30_000);

    it('保持が続けば打ち切り、元の内容を残して失敗を通知する', async () => {
      const lock = await holdFile();
      try {
        const wait = vi.spyOn(Atomics, 'wait');
        expect(() => writeFileAtomic(target, '未保存')).toThrow();
        expect(wait.mock.calls.map((call) => call[3])).toEqual([50, 100, 200]);
        expect(readFileSync(target, 'utf8')).toBe('保存済み');
        expect(existsSync(`${target}.tmp`)).toBe(false);
      } finally {
        await lock.stop();
      }
      // 解放後の次の保存は通常どおり成功する。
      writeFileAtomic(target, '再保存');
      expect(readFileSync(target, 'utf8')).toBe('再保存');
    }, 30_000);
  },
);
