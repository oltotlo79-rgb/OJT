/** 収録した実操作動画の字幕と検証用メタデータを作る。動画本体は加工しない。 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
  cwd: appRoot,
  encoding: 'utf8',
}).trim();
const root = dirname(commonDir);
const notesDir = process.argv[2] ?? join(root, 'release/verification/v1.7.0/tutorials');
/**
 * 仕上げる動画（既定は全7本）。PLCはメーカーごとに1本ずつある（`plc` が三菱。2026-09-26
 * 利用者指示「他メーカーのPLCでも同様にチュートリアルの動画を作成して」）。
 * 一部だけ撮り直したときは `node finalize-tutorials.mjs <記録の場所> plc-omron` のように
 * 名前を並べる。並べなかった動画の目録（`catalog.json`）の行はそのまま残す。
 */
const ALL_MODES = ['assembly', 'parts', 'repair', 'plc', 'plc-jtekt', 'plc-omron', 'plc-sharp'];
const modes = process.argv.length > 3 ? process.argv.slice(3) : ALL_MODES;
const unknown = modes.filter((mode) => !ALL_MODES.includes(mode));
if (unknown.length > 0) throw new Error(`知らない動画の名前です: ${unknown.join(', ')}`);
const ffmpeg = process.env.OJT_FFMPEG ?? 'ffmpeg';
const assets = join(appRoot, 'src/renderer/public/tutorials');
const framesDir = join(notesDir, 'frames');
mkdirSync(framesDir, { recursive: true });

/** @param {number} seconds */
function timestamp(seconds) {
  const total = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(total / 3600000)).padStart(2, '0')}:${String(Math.floor(total / 60000) % 60).padStart(2, '0')}:${String(Math.floor(total / 1000) % 60).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}

const catalogPath = join(assets, 'catalog.json');
/** @type {Record<string, {durationSec: number; bytes: number; width: number; height: number; captionCount: number}>} */
const previous = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : {};
/** @type {typeof previous} */
const catalog = {};
for (const mode of ALL_MODES) {
  const entry = previous[mode];
  if (entry !== undefined) catalog[mode] = entry;
}
for (const mode of modes) {
  /** @type {{success: boolean; faults: string[]; contentEndSec?: number; playbackSpeed?: number; notes: Array<{at: number; text: string}>; backgroundCapture: {covered: boolean; throttling: boolean}}} */
  const notes = JSON.parse(readFileSync(join(notesDir, `${mode}-notes.json`), 'utf8'));
  if (
    !notes.success ||
    notes.faults.length ||
    !notes.backgroundCapture.covered ||
    notes.backgroundCapture.throttling
  )
    throw new Error(`${mode}: 合格・画面エラーなし・背景録画の条件を満たしていません`);
  const file = join(assets, `${mode}.webm`);
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', file], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (probe.error) throw probe.error;
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr);
  const size = /Video:.*?\b(\d{3,5})x(\d{3,5})\b/.exec(probe.stderr);
  if (!duration || !size)
    throw new Error(`${mode}: 動画の長さ・画面サイズを取得できません: ${probe.stderr}`);
  const durationSec = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  const last = notes.notes.at(-1);
  if (!last) throw new Error(`${mode}: 説明がありません`);
  const contentEndSec = notes.contentEndSec || last.at + 5.5;
  const speed = notes.playbackSpeed ?? 1;
  const offset = durationSec - contentEndSec / speed;
  if (Math.abs(offset) > 5) throw new Error(`${mode}: 字幕の時間差が大きすぎます (${offset}s)`);
  const cues = notes.notes.map((note, index) => {
    const end = notes.notes[index + 1]?.at;
    return `${index + 1}\n${timestamp(note.at / speed + offset)} --> ${timestamp(end === undefined ? durationSec : end / speed + offset)}\n${note.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}\n`;
  });
  writeFileSync(join(assets, `${mode}.vtt`), `WEBVTT\n\n${cues.join('\n')}\n`, 'utf8');
  catalog[mode] = {
    durationSec,
    bytes: statSync(file).size,
    width: Number(size[1]),
    height: Number(size[2]),
    captionCount: cues.length,
  };
  for (const [label, second] of [
    ['operation', Math.min(35, durationSec / 3)],
    ['middle', durationSec / 2],
    ['passed', durationSec - 2],
  ]) {
    const rendered = spawnSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(second),
        '-i',
        file,
        '-frames:v',
        '1',
        join(framesDir, `${mode}-${label}.png`),
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (rendered.status !== 0) throw new Error(rendered.stderr);
  }
}
const missing = ALL_MODES.filter((mode) => catalog[mode] === undefined);
if (missing.length > 0) throw new Error(`目録に無い動画があります: ${missing.join(', ')}`);
// 並びは ALL_MODES の順にそろえる（差分を読みやすくする）
const ordered = Object.fromEntries(ALL_MODES.map((mode) => [mode, catalog[mode]]));
writeFileSync(catalogPath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
writeFileSync(
  join(notesDir, 'video-metadata.json'),
  `${JSON.stringify(ordered, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(ordered, null, 2));
