import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PACKAGE from '../package.json' with { type: 'json' };
import { buildManual } from './manual-build.mjs';
import { manualDate } from './manual-date.mjs';

/**
 * 取扱説明書の正本から生成物を作る。取扱説明書 設計 §4.1 / §7.2。
 *
 *   docs/manual/*.md ──┬─→ src/renderer/help/manual-content.ts（アプリ内ヘルプ。git に入れる）
 *                      └─→ resources/manual/manual.html ＋ images/（PDF の材料。git に入れない）
 *
 * `build` と `dist` の最初に走らせる。pnpm は `prebuild` を既定で走らせないので、
 * `package.json` の `build` / `dist` の中で明示的に繋ぐ（決定表 P5）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const IMAGE_DIR = join(MANUAL_DIR, 'images');
const OUT_DIR = join(APP_ROOT, 'resources', 'manual');
const HELP_FILE = join(APP_ROOT, 'src', 'renderer', 'help', 'manual-content.ts');

/** 表紙に出す版。配布物と同じ版数にするため `package.json` から読む（二重管理をしない）。 */
const EDITION = `v${PACKAGE.version}`;

const out = globalThis.process.stdout;

/** 正本のファイル（`00-intro.md` のような名前だけ。昇順）。 */
function manualFiles() {
  return readdirSync(MANUAL_DIR)
    .filter((name) => /^\d{2}-.+\.md$/u.test(name))
    .sort()
    .map((name) => ({
      name,
      // 改行コードをそろえる（決定表 P7）
      text: readFileSync(join(MANUAL_DIR, name), 'utf8').replace(/\r\n/gu, '\n'),
    }));
}

/**
 * 撮り終わっている図の名前（決定表 P13）。Minor#4: フルサイズ（`images/x.png`）だけを見て
 * 縮小版（`images/small/x.png`）を見ていなかったので、縮小版だけが欠けた図があると
 * `helpModuleOf()` が `@manual-images/small/x.png` を import する生成物を書き出し、
 * Vite の解決に失敗して `pnpm build` がそこで落ちていた（分かりにくい失敗のしかた）。
 * ここで両方そろっている図だけを「撮れている」として渡し、片方しか無い図は
 * まだ無いものとして扱う（他の未撮影の図と同じ、黙って枠を畳む経路に乗せる）。
 */
export function availableImages(imageDir) {
  if (!existsSync(imageDir)) return [];
  const smallDir = join(imageDir, 'small');
  return readdirSync(imageDir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.replace(/\.png$/u, ''))
    .filter((name) => {
      const hasSmall = existsSync(join(smallDir, `${name}.png`));
      if (!hasSmall) {
        globalThis.process.stderr.write(
          `縮小版がありません（まだ撮っていない図として扱います）: images/small/${name}.png\n`,
        );
      }
      return hasSmall;
    })
    .sort();
}

function main() {
  const files = manualFiles();
  if (files.length === 0) {
    globalThis.process.stderr.write(`取扱説明書の原稿がありません: ${MANUAL_DIR}\n`);
    globalThis.process.exitCode = 1;
    return;
  }
  /*
   * 生成日は「日付だけ」にする。時刻まで入れると、同じ原稿から作った PDF が
   * 走らせるたびに違うバイト列になり、配布物のチェックサムが毎回変わる。
   */
  const builtAt = manualDate(APP_ROOT);
  const available = availableImages(IMAGE_DIR);
  const built = buildManual(files, builtAt, available, EDITION);

  mkdirSync(dirname(HELP_FILE), { recursive: true });
  writeFileSync(HELP_FILE, built.helpModule, 'utf8');
  out.write(`アプリ内ヘルプを書き出しました: ${HELP_FILE}（${String(built.sections.length)}節）\n`);

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'manual.html'), built.printHtml, 'utf8');
  if (existsSync(IMAGE_DIR)) {
    // PDF は原寸を使う。縮小版（`small/`）も一緒に来るが、PDF 側は参照しないので害はない
    cpSync(IMAGE_DIR, join(OUT_DIR, 'images'), { recursive: true });
    out.write(`図を複写しました: ${String(available.length)} 枚\n`);
  } else {
    out.write('図はまだありません（Plan 6 Task 12 が撮ります）\n');
  }
  out.write(`印刷用HTMLを書き出しました: ${join(OUT_DIR, 'manual.html')}\n`);
}

// テストからはこのファイルを import して `availableImages()` だけを使う（副作用を起こさない）。
// `node scripts/build-manual.mjs` として直接実行されたときだけ本体を走らせる。
const isMain =
  globalThis.process.argv[1] !== undefined &&
  resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
