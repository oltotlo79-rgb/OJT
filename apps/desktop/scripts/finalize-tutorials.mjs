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
const version = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version;
const notesDir = process.argv[2] ?? join(root, `release/verification/v${version}/tutorials`);
/**
 * 仕上げる動画（既定は全9本。v1.10.0 で回路実験・PLC実験の2本を追加）。PLCはメーカーごとに1本ずつある（`plc` が三菱。2026-09-26
 * 利用者指示「他メーカーのPLCでも同様にチュートリアルの動画を作成して」）。
 * 一部だけ撮り直したときは `node finalize-tutorials.mjs <記録の場所> plc-omron` のように
 * 名前を並べる。並べなかった動画の目録（`catalog.json`）の行はそのまま残す。
 */
const ALL_MODES = [
  'assembly',
  'parts',
  'repair',
  'plc',
  'plc-jtekt',
  'plc-omron',
  'plc-sharp',
  'lab-assemble',
  'lab-plc',
];
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

/**
 * 説明枠が最初に映るフレームで字幕を合わせる。動画の末尾には収録停止までの余白が
 * 入るため、動画の長さと操作終了時刻の差を先頭のずれとして扱わない。
 * @param {string} file
 */
function firstExplanationFrame(file) {
  const width = 8;
  const height = 900;
  const fps = 25;
  const decoded = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-threads',
      '1',
      '-i',
      file,
      '-t',
      '5',
      '-vf',
      `fps=${fps},crop=${width}:${height}:26:0`,
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (decoded.error) throw decoded.error;
  if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
  const bytesPerFrame = width * height * 3;
  for (let frame = 0; frame < Math.floor(decoded.stdout.length / bytesPerFrame); frame += 1) {
    const columns = Array.from({ length: width }, () => 0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = frame * bytesPerFrame + (y * width + x) * 3;
        const red = decoded.stdout[pixel] ?? 0;
        const green = decoded.stdout[pixel + 1] ?? 0;
        const blue = decoded.stdout[pixel + 2] ?? 0;
        if (red > 190 && green > 130 && green < 205 && blue < 90)
          columns[x] = (columns[x] ?? 0) + 1;
      }
    }
    // 空の枠や角の丸みを除き、文字が入った説明枠の金色の縦辺を検出する。
    if (Math.max(...columns) > 32) return frame / fps;
  }
  throw new Error(`${file}: 最初の説明枠を確認できません`);
}

const catalogPath = join(assets, 'catalog.json');
/** @type {Record<string, {durationSec: number; bytes: number; width: number; height: number; captionCount: number}>} */
const previous = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : {};
/** @type {typeof previous} */
const catalog = {};
const syncPath = join(notesDir, 'caption-synchronization.json');
/** @type {Record<string, {firstExplanationSec: number; firstNoteSec: number; offsetSec: number; trailingSec: number}>} */
const synchronization = existsSync(syncPath) ? JSON.parse(readFileSync(syncPath, 'utf8')) : {};
for (const mode of ALL_MODES) {
  const entry = previous[mode];
  if (entry !== undefined) catalog[mode] = entry;
}
for (const mode of modes) {
  /** @type {{success: boolean; faults: string[]; contentEndSec?: number; playbackSpeed?: number; notes: Array<{at: number; text: string}>; lessonReview:Array<{stage:string;at:number;highlighted:boolean}>; backgroundCapture: {covered: boolean; throttling: boolean}}} */
  const notes = JSON.parse(readFileSync(join(notesDir, `${mode}-notes.json`), 'utf8'));
  if (
    !notes.success ||
    notes.faults.length ||
    !notes.backgroundCapture.covered ||
    notes.backgroundCapture.throttling
  )
    throw new Error(`${mode}: 合格・画面エラーなし・背景録画の条件を満たしていません`);
  for (const stage of [
    'problem',
    mode === 'parts' ? 'inspection-criteria' : 'chart',
    'first-action',
  ]) {
    const reviewed = notes.lessonReview?.find((entry) => entry.stage === stage);
    if (reviewed === undefined || (stage !== 'first-action' && !reviewed.highlighted))
      throw new Error(`${mode}: 作業前の説明・強調がありません (${stage})`);
  }
  if (mode === 'repair' && !notes.lessonReview.some((entry) => entry.stage === 'mark-tubes'))
    throw new Error('repair: マークチューブの確認がありません');
  if (mode === 'repair') {
    for (const stage of ['report-edit', 'wire-restoration']) {
      if (!notes.lessonReview.some((entry) => entry.stage === stage))
        throw new Error(`repair: 指摘変更・配線復元の説明がありません (${stage})`);
    }
  }
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
  const first = notes.notes[0];
  if (!first || !last) throw new Error(`${mode}: 説明がありません`);
  const contentEndSec = notes.contentEndSec || last.at + 5.5;
  const speed = notes.playbackSpeed ?? 1;
  if (speed !== 1) throw new Error(`${mode}: 収録動画を倍速に加工しないでください`);
  if (durationSec >= 600) throw new Error(`${mode}: 説明を含む動画が10分以上になっています`);
  const firstExplanationSec = firstExplanationFrame(file);
  const offset = firstExplanationSec - first.at;
  if (Math.abs(offset) > 5) throw new Error(`${mode}: 字幕の時間差が大きすぎます (${offset}s)`);
  synchronization[mode] = {
    firstExplanationSec,
    firstNoteSec: first.at,
    offsetSec: offset,
    trailingSec: durationSec - (contentEndSec + offset),
  };
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
    ...notes.lessonReview.map((entry) => [entry.stage, Math.max(0, entry.at + offset - 0.8)]),
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
writeFileSync(syncPath, `${JSON.stringify(synchronization, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(ordered, null, 2));
