import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isDeepStrictEqual } from 'node:util';
import { extractFile, listPackage, uncache } from '@electron/asar';
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';
import { FuseState } from '@electron/fuses/dist/constants.js';

/** @typedef {{ name: string, size: number, sha256: string }} ArtifactRow */
/** @typedef {{ version: string, errors: string[], rows: ArtifactRow[] }} ReleaseReport */

/** @param {string} version */
export function artifactNames(version) {
  return ['Setup', 'Portable'].map((kind) => `DenkiKyoikuTool-${version}-x64-${kind}.exe`);
}

/** @param {string} path */
async function sha256Of(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex').toUpperCase();
}

/** @param {string} path @param {number} length */
function headOf(path, length) {
  const fd = openSync(path, 'r');
  try {
    const bytes = globalThis.Buffer.alloc(length);
    return bytes.subarray(0, readSync(fd, bytes, 0, length, 0));
  } finally {
    closeSync(fd);
  }
}

/** @param {string} root */
function directories(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** @param {unknown} value */
function versionOf(value) {
  if (
    value &&
    typeof value === 'object' &&
    'version' in value &&
    typeof value.version === 'string' &&
    /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(value.version)
  )
    return value.version;
  throw new Error('package.json の版数が不正です');
}

/** 配布ゲート本体。検査の失敗を集め、呼出側で終了コードと公開可否を決める。
 * @param {string} appRoot
 * @returns {Promise<ReleaseReport>}
 */
export async function inspectRelease(appRoot) {
  /** @type {ReleaseReport} */
  const report = { version: '', errors: [], rows: [] };
  /** @param {string} label @param {() => void | Promise<void>} run */
  const check = async (label, run) => {
    try {
      await run();
    } catch (error) {
      report.errors.push(`${label}: ${String(error)}`);
    }
  };
  await check('版数', () => {
    report.version = versionOf(JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')));
  });
  const release = join(appRoot, 'release');
  const unpacked = join(release, 'win-unpacked');
  const resources = join(unpacked, 'resources');
  const expected = artifactNames(report.version);
  await check('旧版の混入', () => {
    const stale = readdirSync(release).filter(
      (name) =>
        /^(?:DenkiKyoikuTool-|電気教育ツール-)/u.test(name) &&
        !expected.some((want) => name === want || name === `${want}.blockmap`),
    );
    if (stale.length) throw new Error(`旧版または未指定の成果物があります: ${stale.join(', ')}`);
  });
  for (const name of expected) {
    await check(name, async () => {
      const path = join(release, name);
      const size = statSync(path).size;
      if (size < 1024 * 1024) throw new Error('成果物が1MiB未満です');
      if (headOf(path, 2).toString('ascii') !== 'MZ')
        throw new Error('Windows実行ファイルではありません');
      report.rows.push({ name, size, sha256: await sha256Of(path) });
    });
  }
  await check('同梱課題', () => {
    const source = resolve(appRoot, '../../packages/content/src/builtin');
    const shipped = join(resources, 'content');
    const modes = directories(source);
    if (!isDeepStrictEqual(directories(shipped), modes))
      throw new Error('モードフォルダの集合が正本と一致しません');
    for (const mode of modes) {
      const names = readdirSync(join(source, mode))
        .filter((n) => n.endsWith('.json'))
        .sort();
      const actual = readdirSync(join(shipped, mode))
        .filter((n) => n.endsWith('.json'))
        .sort();
      if (!isDeepStrictEqual(actual, names))
        throw new Error(`${mode}: 課題ファイルの集合が一致しません`);
      for (const name of names) {
        /** @type {unknown} */
        const wanted = JSON.parse(readFileSync(join(source, mode, name), 'utf8'));
        /** @type {unknown} */
        const got = JSON.parse(readFileSync(join(shipped, mode, name), 'utf8'));
        if (!isDeepStrictEqual(got, wanted))
          throw new Error(`${mode}/${name}: 課題の内容が一致しません`);
      }
    }
  });
  await check('app.asar', () => {
    const path = join(resources, 'app.asar');
    uncache(path);
    const entries = listPackage(path, { isPack: false }).map((name) =>
      name.replaceAll('\\', '/').replace(/^\//u, ''),
    );
    for (const required of [
      'package.json',
      'out/main/index.js',
      'out/main/definition-worker.js',
      'out/preload/index.cjs',
      'out/renderer/index.html',
      ...['assembly', 'parts', 'repair', 'plc', 'plc-jtekt', 'plc-omron', 'plc-sharp'].flatMap(
        (mode) => [`out/renderer/tutorials/${mode}.webm`, `out/renderer/tutorials/${mode}.vtt`],
      ),
    ]) {
      if (
        !entries.includes(required) ||
        extractFile(path, join(...required.split('/'))).length === 0
      )
        throw new Error(`${required} がありません`);
    }
    if (entries.some((name) => name.split('/').includes('node_modules')))
      throw new Error('node_modules が混入しています');
    if (
      versionOf(JSON.parse(extractFile(path, 'package.json').toString('utf8'))) !== report.version
    )
      throw new Error('app.asar の版数が一致しません');
    const main = extractFile(path, join('out', 'main', 'index.js')).toString('utf8');
    if (/(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]@ojt\//u.test(main))
      throw new Error('ワークスペースの実行時依存が残っています');
  });
  await check('取扱説明書', async () => {
    const path = join(resources, 'manual.pdf');
    if (!existsSync(path)) throw new Error('resources/manual.pdf がありません');
    const size = statSync(path).size;
    if (!size) throw new Error('resources/manual.pdf が空です');
    if (headOf(path, 5).toString('ascii') !== '%PDF-') throw new Error('PDF形式ではありません');
    report.rows.push({
      name: 'win-unpacked/resources/manual.pdf',
      size,
      sha256: await sha256Of(path),
    });
  });
  await check('アイコン', () => {
    const bytes = readFileSync(join(appRoot, 'build', 'icon.ico'));
    const count = bytes.length >= 6 && bytes.readUInt16LE(2) === 1 ? bytes.readUInt16LE(4) : 0;
    if (count < 6 || bytes.length < 6 + count * 16)
      throw new Error('マルチサイズのアイコンではありません');
    if (!Array.from({ length: count }, (_, i) => bytes[6 + i * 16]).includes(0))
      throw new Error('256pxのアイコンがありません');
  });
  await check('実行ファイルの保護', async () => {
    const wire = await getCurrentFuseWire(join(unpacked, '電気教育ツール.exe'));
    if (wire.version !== FuseVersion.V1) throw new Error('未対応のfuse形式です');
    const disabled = [
      FuseV1Options.RunAsNode,
      FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      FuseV1Options.EnableNodeCliInspectArguments,
    ];
    const enabled = [
      FuseV1Options.OnlyLoadAppFromAsar,
      FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
      FuseV1Options.GrantFileProtocolExtraPrivileges,
    ];
    for (const key of disabled)
      if (wire[key] !== FuseState.DISABLE)
        throw new Error(`${FuseV1Options[key]} が無効になっていません`);
    for (const key of enabled)
      if (wire[key] !== FuseState.ENABLE)
        throw new Error(`${FuseV1Options[key]} が有効になっていません`);
  });
  return report;
}

/** @param {ReleaseReport} report */
export function artifactTable(report) {
  if (report.errors.length) throw new Error('不合格の成果物一覧は発行できません');
  return [
    '# 配布物の検査結果',
    '',
    `版: ${report.version}`,
    '',
    '| ファイル | バイト数 | SHA256 |',
    '|---|---:|---|',
    ...report.rows.map((r) => `| ${r.name} | ${r.size} | ${r.sha256} |`),
    '',
  ].join('\n');
}
