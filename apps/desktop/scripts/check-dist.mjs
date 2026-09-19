import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/**
 * 配布物の検査とチェックサム表の生成。設計仕様 §15 / Plan 5 決定表#21。
 *
 * `electron-builder` の直後に走り、
 * ①NSISインストーラとポータブル版の2つが出ていること
 * ②`win-unpacked/resources/content/<mode>/*.json` が正本と同じ件数あること（§7.8）
 * ③`resources/app.asar` があること
 * ④`resources/manual.pdf` があって空でないこと（取扱説明書 設計 §7.3 / 決定表#27）
 * を確かめ、`release/artifacts.md`（ファイル名・バイト数・SHA256）を書き出す。
 *
 * **公開はしない**（タグ付けも GitHub Release もこのスクリプトの仕事ではない。決定表#22）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');
const RELEASE = join(APP_ROOT, 'release');
const UNPACKED = join(RELEASE, 'win-unpacked');
const SOURCE_CONTENT = resolve(APP_ROOT, '../../packages/content/src/builtin');

const out = globalThis.process.stdout;
const fail = (message) => {
  globalThis.process.stderr.write(`配布物の検査に失敗しました: ${message}\n`);
  globalThis.process.exitCode = 1;
};

/**
 * ファイルの SHA256。**読み切らずに流す**。
 * NSIS インストーラは約107MB、ポータブルの zip は約147MB ある。`readFileSync()` で
 * 丸ごと Buffer に載せると、この検査のためだけに数百MBのヒープを掴む（`dist` は
 * electron-builder の直後に走るので、いちばんメモリが厳しい瞬間である）。
 */
async function sha256Of(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex').toUpperCase();
}

if (!existsSync(RELEASE)) {
  fail(`${RELEASE} がありません（先に electron-builder を走らせてください）`);
} else {
  const version = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).version;
  const expected = [`電気教育ツール-${version}-x64.exe`, `電気教育ツール-${version}-x64.zip`];
  const rows = [];

  /*
   * 旧版の成果物が `release/` に残っていても気づけないと、配布のときに古い exe / zip を
   * 掴みかねない（Batch E レビュー Minor 3）。`electron-builder` は古い名前のファイルを
   * 消さないので、**いまの版以外の `電気教育ツール-*` があれば警告を出す**。
   * 検査そのものは落とさない（消すかどうかは人が決める）。
   */
  const stale = readdirSync(RELEASE, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name.startsWith('電気教育ツール-') &&
        // いまの版の本体と、その `.blockmap` のような付属ファイルは残っていてよい
        !expected.some((want) => name === want || name.startsWith(`${want}.`)),
    )
    .sort();
  if (stale.length > 0) {
    out.write(
      `警告: 旧版らしい成果物が ${RELEASE} に残っています（配布前に消してください）: ` +
        `${stale.join(' / ')}\n`,
    );
  }
  for (const name of expected) {
    const path = join(RELEASE, name);
    if (!existsSync(path)) {
      fail(`成果物がありません: ${name}`);
      continue;
    }
    rows.push({ name, size: statSync(path).size, sha256: await sha256Of(path) });
  }

  // 同梱課題（asar の外）。§7.8
  const shipped = join(UNPACKED, 'resources', 'content');
  if (!existsSync(shipped)) {
    fail(`同梱課題のフォルダがありません: ${shipped}`);
  } else {
    const modes = readdirSync(SOURCE_CONTENT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const mode of modes) {
      const want = readdirSync(join(SOURCE_CONTENT, mode)).filter((n) =>
        n.endsWith('.json'),
      ).length;
      const got = existsSync(join(shipped, mode))
        ? readdirSync(join(shipped, mode)).filter((n) => n.endsWith('.json')).length
        : 0;
      if (got !== want) fail(`同梱課題の件数が違います: ${mode} は ${want} 件のはずが ${got} 件`);
      else out.write(`同梱課題 OK: ${mode} ${got} 件\n`);
    }
  }

  if (!existsSync(join(UNPACKED, 'resources', 'app.asar'))) {
    fail('resources/app.asar がありません（asar: true のはずです）');
  }

  // 取扱説明書（PDF）。取扱説明書 設計 §7.3 / 決定表#27
  const manual = join(UNPACKED, 'resources', 'manual.pdf');
  if (!existsSync(manual)) {
    fail('resources/manual.pdf がありません（extraResources に入っていません）');
  } else {
    const bytes = statSync(manual).size;
    if (bytes === 0) fail('resources/manual.pdf が空です');
    else {
      rows.push({ name: 'resources/manual.pdf', size: bytes, sha256: await sha256Of(manual) });
      out.write(`取扱説明書 OK: ${bytes.toLocaleString('en-US')} バイト\n`);
    }
  }

  const table = [
    '# 成果物一覧（`pnpm --filter @ojt/desktop dist` が生成）',
    '',
    `- 版: ${version}`,
    `- 生成: ${new Date().toISOString()}`,
    '',
    '| ファイル | バイト数 | SHA256 |',
    '|---|---:|---|',
    ...rows.map((r) => `| \`${r.name}\` | ${r.size.toLocaleString('en-US')} | \`${r.sha256}\` |`),
    '',
  ].join('\n');
  writeFileSync(join(RELEASE, 'artifacts.md'), table, 'utf8');
  out.write(`成果物一覧を書き出しました: ${join(RELEASE, 'artifacts.md')}\n`);
}
