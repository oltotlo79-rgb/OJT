import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import {
  WORK_FILE_FORMAT_VERSION,
  type WorkFile,
  type WorkFileLoadRequest,
  type WorkFileLoadResult,
  type WorkFileSaveRequest,
  type WorkFileSaveResult,
} from '../shared/ipc.js';
import { errnoText, MSG, readFailedText, saveFailedText } from '../shared/messages.js';
import { safeFileName } from '../shared/safe-file-name.js';
import { writeFileAtomic } from './fs-atomic.js';

/**
 * 作業ファイルの保存／読込と一時保存。設計仕様 §12.3 / §13 #7 / §13 #8。
 * 拡張子は `.ojtw`。一時保存は `app.getPath('userData')/autosave.json` に固定で書く。
 *
 * 保存は**一時ファイル→rename**で書く（1D1 のレビュー指摘: 直接 `writeFileSync(target, ...)`
 * だと書込の途中でアプリが落ちる／電源が切れたときに本体が壊れた内容で残る。同じフォルダの
 * 一時ファイルに書いてから `renameSync()` で置き換えると、置き換え自体は1回のファイル
 * システム操作なので本体が半端な内容のまま残ることが無い）。
 *
 * 読み込む前に**大きさと本数の上限**で断る（1D2-a のレビュー指摘: 10MB・10万本の作業ファイルを
 * そのまま `JSON.parse()` して盤に載せようとすると、main も renderer も固まる）。
 */

/** 読み込める作業ファイルの最大バイト数。§13 #8 */
export const MAX_WORK_FILE_BYTES = 5 * 1024 * 1024;

/** 読み込める電線の本数の上限（renderer の `toSession()` と同じ値）。§13 #8 */
export const MAX_WORK_FILE_WIRES = 200;

/**
 * C1/C2 の並び（解答・指摘・故障・交換した部品）に載せられる要素数の上限。§13 #8
 *
 * 内蔵課題の実際の上限は解答12件・故障3件ほどなので、桁で余裕を持たせた値にする。
 * ここで断るのは「そもそも桁が違う」ファイルだけで、中身の妥当性（その部品が課題にあるか等）は
 * 課題を知っている renderer が確かめる。
 */
export const MAX_WORK_FILE_ENTRIES = 200;

/**
 * 回路図ヒントを開いた回数の上限（§8.4）。実際に何百回も開くことは無いが、
 * 壊れた／悪意ある作業ファイルの数値をそのまま結果画面に出さないよう桁で断る。
 */
export const MAX_SCHEMATIC_OPEN_COUNT = 10_000;

/**
 * プローブの端子IDとして受け入れる文字数の上限（renderer の `toProbeTerminal()` と同じ値）。
 * §12.3
 */
export const MAX_PROBE_TERMINAL_ID_LENGTH = 32;

/** 作業ファイルに載せられるネットワーク数の上限（`LadderProgramSchema` と同じ値）。§10.3 */
export const MAX_WORK_FILE_NETWORKS = 64;

/** 一時保存のパス。§12.3 */
export function autosavePath(): string {
  return join(app.getPath('userData'), 'autosave.json');
}

/**
 * `tester.black` / `tester.red`（探針を挿した端子ID）を、壊れた／作為的な値から守る。§12.3 / §13 #8
 *
 * main は盤の定義を知らないので「その端子が盤に実在するか」までは確かめない（renderer の
 * `toSession()` / `ProbeMarkers.scenePosOf()` が黙って落とす）。ここで見るのは形だけ:
 * 文字列で、空でなく、上限文字数以内であること。それ以外（他の型・空文字・長すぎる文字列）は
 * その項目だけ落とす（`tester` オブジェクト自体は残す。壊れているのは探針の位置だけなので、
 * つまみ・レンジ・0Ω調整まで道連れにして読込を断る理由はない）。
 */
function sanitizedTester(tester: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...tester };
  for (const key of ['black', 'red'] as const) {
    const value = tester[key];
    const ok =
      typeof value === 'string' && value.length > 0 && value.length <= MAX_PROBE_TERMINAL_ID_LENGTH;
    if (!ok) delete out[key];
  }
  return out;
}

/** 作業ファイルの検証。未知の `formatVersion` は読み込まない。§13 #8 */
export function parseWorkFile(
  raw: unknown,
): { ok: true; file: WorkFile } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: MSG.workFile.badShape };
  }
  const source = raw as Record<string, unknown>;
  const version = source['formatVersion'];
  // 正の整数でなければ「形式バージョンが無い」と同じ扱いにする（0・負数・NaN・小数を含む）
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: MSG.workFile.missingVersion };
  }
  if (version > WORK_FILE_FORMAT_VERSION) {
    return { ok: false, message: MSG.workFile.tooNew };
  }
  if (
    typeof source['problemId'] !== 'string' ||
    typeof source['session'] !== 'object' ||
    source['session'] === null
  ) {
    return { ok: false, message: MSG.workFile.missingFields };
  }
  /*
   * 本数の上限はここでも見る。中身の妥当性（端子が盤にあるか等）は renderer の `toSession()` が
   * 盤の定義を見て確かめるが、「そもそも桁が違う」ものは盤に渡す前に main で断る。
   */
  const wires = (source['session'] as Record<string, unknown>)['wires'];
  if (Array.isArray(wires) && wires.length > MAX_WORK_FILE_WIRES) {
    return { ok: false, message: MSG.workFile.tooManyWires };
  }
  /*
   * C1/C2 の項目（Plan 2B Task 17）は**任意**なので、あれば写し、無ければ付けない
   * （`exactOptionalPropertyTypes` の下では `undefined` を代入できない）。
   * main は盤も課題も知らないので、ここで見るのは「モードが知っている3つか」と
   * 「並びの長さが桁違いでないか」だけにする。中身は renderer が課題と突き合わせて確かめる。
   */
  const optional: Partial<WorkFile> = {};
  const mode = source['mode'];
  if (mode !== undefined) {
    if (
      mode !== 'assemble' &&
      mode !== 'inspect-parts' &&
      mode !== 'inspect-repair' &&
      mode !== 'plc'
    ) {
      // 知らないモードは「読める形に見えて中身が別物」なので、黙って落とさず断る（§13 #8）
      return { ok: false, message: MSG.workFile.unknownMode };
    }
    optional.mode = mode;
  }
  if (typeof source['dialectId'] === 'string') optional.dialectId = source['dialectId'];
  if (typeof source['converted'] === 'boolean') optional.converted = source['converted'];
  /*
   * ラダーは「オブジェクトで `networks` が配列、64本以下」だけ見る。中身（セルの語彙・行数）は
   * IR を知っている renderer の `toLadderProgram()` が確かめる（`session` と同じ分担）。§13 #8
   */
  const ladder = source['ladder'];
  if (ladder !== undefined) {
    if (typeof ladder !== 'object' || ladder === null) {
      return { ok: false, message: MSG.workFile.badLadder };
    }
    const networks = (ladder as Record<string, unknown>)['networks'];
    if (!Array.isArray(networks)) return { ok: false, message: MSG.workFile.badLadder };
    if (networks.length > MAX_WORK_FILE_NETWORKS) {
      return { ok: false, message: MSG.workFile.tooManyNetworks };
    }
    optional.ladder = ladder;
  }
  /*
   * モードBの回路図エディタの下書き（Plan 5 決定表#23）。main は回路図の文法を知らないので
   * 「オブジェクトであること」だけを見て素通しする（`session` / `ladder` と同じ分担で、
   * 段と要素の形は renderer の `toSchematicDoc()` が確かめる）。形が違えば**黙って落とす**
   * ＝下書き無しで開く（読込そのものは断らない）。§11.4 / §13 #8
   */
  const schematic = source['schematic'];
  if (typeof schematic === 'object' && schematic !== null && !Array.isArray(schematic)) {
    optional.schematic = schematic;
  }
  if (typeof source['checkPartId'] === 'string') optional.checkPartId = source['checkPartId'];
  if (typeof source['faultSeed'] === 'number') optional.faultSeed = source['faultSeed'];
  /*
   * 回路図を開いた回数（§8.4）。負数・NaN・小数・桁違いは「無かった」ことにして戻す
   * （読込そのものは断らない。0以上の整数だけを、上限で切り詰めて受け入れる）。
   */
  const schematicOpenCount = source['schematicOpenCount'];
  if (
    typeof schematicOpenCount === 'number' &&
    Number.isInteger(schematicOpenCount) &&
    schematicOpenCount >= 0
  ) {
    optional.schematicOpenCount = Math.min(schematicOpenCount, MAX_SCHEMATIC_OPEN_COUNT);
  }
  if (
    typeof source['tester'] === 'object' &&
    source['tester'] !== null &&
    !Array.isArray(source['tester'])
  ) {
    optional.tester = sanitizedTester(source['tester'] as Record<string, unknown>);
  }
  for (const key of ['answers', 'reports', 'resolvedFaults', 'replacedPartIds'] as const) {
    const value = source[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) continue;
    if (value.length > MAX_WORK_FILE_ENTRIES) {
      return { ok: false, message: MSG.workFile.tooManyEntries };
    }
    optional[key] = value;
  }
  return {
    ok: true,
    file: {
      formatVersion: version,
      problemId: source['problemId'],
      session: source['session'],
      elapsedMs: typeof source['elapsedMs'] === 'number' ? source['elapsedMs'] : 0,
      hazardCount: typeof source['hazardCount'] === 'number' ? source['hazardCount'] : 0,
      savedAt: typeof source['savedAt'] === 'string' ? source['savedAt'] : '',
      ...optional,
    },
  };
}

/** 一時保存を消す（「復元しない」を選んだとき）。§12.3 */
export function clearAutosave(): void {
  try {
    rmSync(autosavePath(), { force: true });
  } catch {
    // 消せなくても起動を妨げない
  }
}

/**
 * ダイアログを出す。ウィンドウが無ければ**引数1つ**の形で呼ぶ（1D2-a のレビュー指摘）。
 * 以前は `{} as BrowserWindow` を渡していたが、Electron 側は本物の `BrowserWindow` を期待して
 * いるので、実装が変われば型を誤魔化した嘘の値で落ちる。Electron は親ウィンドウ無しの
 * 単一引数オーバーロードを備えているので、そちらを使う。
 */
async function showSave(
  window: BrowserWindow | undefined,
  options: SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
  return window === undefined
    ? dialog.showSaveDialog(options)
    : dialog.showSaveDialog(window, options);
}

async function showOpen(
  window: BrowserWindow | undefined,
  options: OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  return window === undefined
    ? dialog.showOpenDialog(options)
    : dialog.showOpenDialog(window, options);
}

/**
 * 作業ファイルを保存する。`manual` はダイアログで保存先を選ばせる。§12.3 / §13 #7
 *
 * `request` は renderer からの生入力（IPC は実行時に型を強制しない）なので、`text-files.ts` の
 * `saveTextFile()` と同じ3点を冒頭で確かめる（レビュー DM-2）:
 * ①型（`problemId` が文字列か）②既定ファイル名を `safeFileName()` で無害化 ③大きさの上限。
 */
export async function saveWorkFile(
  window: BrowserWindow | undefined,
  request: WorkFileSaveRequest,
): Promise<WorkFileSaveResult> {
  if (typeof request.file?.problemId !== 'string') {
    return { ok: false, canceled: false, message: MSG.workFile.badShape };
  }
  const content = `${JSON.stringify(request.file, null, 2)}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_WORK_FILE_BYTES) {
    return { ok: false, canceled: false, message: MSG.workFile.tooLarge };
  }
  let target = autosavePath();
  if (request.kind === 'manual') {
    const picked = await showSave(window, {
      title: MSG.workFile.saveTitle,
      // `problemId` は renderer からの生入力（例: `../../evil`）をそのまま使わない（DM-2）
      defaultPath: join(
        app.getPath('documents'),
        safeFileName(`${request.file.problemId}.ojtw`, 'work-file.ojtw'),
      ),
      filters: [{ name: MSG.workFile.filterName, extensions: ['ojtw'] }],
    });
    if (picked.canceled || picked.filePath === undefined) {
      return { ok: false, canceled: true, message: MSG.workFile.saveCanceled };
    }
    target = picked.filePath;
  }
  try {
    writeFileAtomic(target, content);
    return { ok: true, path: target };
  } catch (cause) {
    return { ok: false, canceled: false, message: saveFailedText(errnoText(cause)) };
  }
}

/** 作業ファイルを読み込む。`manual` はダイアログで選ばせる。§12.3 / §13 #8 */
export async function loadWorkFile(
  window: BrowserWindow | undefined,
  request: WorkFileLoadRequest,
): Promise<WorkFileLoadResult> {
  if (request.discard === true) {
    clearAutosave();
    return { ok: false, canceled: true, message: MSG.workFile.autosaveCleared };
  }
  let target = autosavePath();
  if (request.kind === 'manual') {
    const picked = await showOpen(window, {
      title: MSG.workFile.loadTitle,
      properties: ['openFile'],
      filters: [{ name: MSG.workFile.filterName, extensions: ['ojtw'] }],
    });
    const first = picked.filePaths[0];
    if (picked.canceled || first === undefined) {
      return { ok: false, canceled: true, message: MSG.workFile.loadCanceled };
    }
    target = first;
  }
  // 大きすぎるファイルは読む前に断る（`JSON.parse()` に何十MBも渡さない）。§13 #8
  try {
    if (statSync(target).size > MAX_WORK_FILE_BYTES) {
      return { ok: false, canceled: false, message: MSG.workFile.tooLarge };
    }
  } catch (cause) {
    return { ok: false, canceled: false, message: readFailedText(errnoText(cause)) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(target, 'utf8'));
  } catch (cause) {
    return { ok: false, canceled: false, message: readFailedText(errnoText(cause)) };
  }
  const parsed = parseWorkFile(raw);
  if (!parsed.ok) return { ok: false, canceled: false, message: parsed.message };
  return { ok: true, file: parsed.file, path: target };
}
