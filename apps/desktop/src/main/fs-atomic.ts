import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * アトミックな書込の1本化。設計仕様 §13 #7 / §13 #8 / レビュー DM-6。
 *
 * `work-files.ts` / `settings.ts` / `text-files.ts` がそれぞれ持っていた
 * 「一時ファイル→rename」の3重複をここへまとめる。以前は `writeFileSync(temp, ...)` の直後に
 * `renameSync()` するだけだったが、`writeFileSync` は OS のページキャッシュに書くだけで
 * ディスクへ実際に落ちたとは限らない。電源断・強制終了が `rename` の直前に起きると、
 * 「本体は消え、一時ファイルも中身が飛んだまま」になりうる。
 *
 * `openSync → writeFileSync(fd) → fsyncSync(fd) → closeSync(fd) → renameSync` の順で書き、
 * `fsyncSync()` でディスクへの書込を確定させてから `rename` する。`rename` 自体は1回の
 * ファイルシステム操作なので、置き換えの途中で半端な内容が本体に残ることはない。
 *
 * 失敗したら（`open`/`write`/`fsync`/`close`/`rename` のどこであっても）、残っている
 * 一時ファイルを `rmSync(temp, { force: true })` で片付けてから例外を投げ直す（呼び出し側の
 * `.tmp` 残留テストが緑になる条件。DM-6）。
 */
export function writeFileAtomic(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  try {
    const fd = openSync(temp, 'w');
    try {
      writeFileSync(fd, content, { encoding: 'utf8' });
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
  } catch (cause) {
    try {
      rmSync(temp, { force: true });
    } catch {
      // 消せなくても元の失敗を優先して投げる
    }
    throw cause;
  }
}
