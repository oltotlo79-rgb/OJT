import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { SaveTextRequest, SaveTextResult } from '../shared/ipc.js';
import { MSG, saveFailedText } from '../shared/messages.js';

/**
 * テキストファイルの保存（命令語リスト）。設計仕様 §10.7 / §13 #7。
 * `work-files.ts` と同じ流儀で、**保存先は利用者が選ぶ**（`dialog.showSaveDialog`）。
 * 中身は呼び出し側（renderer）が作った文字列をそのまま UTF-8 で書く。BOM は付けない。
 */

/**
 * 書き出せるテキストの最大バイト数（命令語リストは大きくても数十KB）。
 * §13 #7（ファイルI/Oは main 側で大きさを確かめる）＋本プランの決定。§13 #8 は
 * 「黙って壊れた状態で開かない」の項で、上限の話ではない。
 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * 既定のファイル名を安全にする（renderer からの生入力を信用しない）。§13 #7
 *
 * **順番が肝**（レビュー B4）: 先に区切りを `_` へ置換してから `basename()` を通すと、
 * `'../../evil/name.txt'` が `'.._.._evil_name.txt'` になって `..` が残り、
 * `defaultPath` に `..` が出たままになる（テストが落ちる）。`basename()` を**先**に通して
 * ディレクトリ部を捨て、残った名前から Windows で使えない文字と先頭の `.` を落とす。
 *
 *   `'../../evil/name.txt'` → basename `'name.txt'` → `'name.txt'`
 *   `'..'`                  → basename `'..'`       → 先頭の `.` が消えて空 → `'export.txt'`
 */
function safeFileName(name: string): string {
  const base = withoutControlChars(basename(name))
    // Windows のファイル名に使えない文字（`/` `\` は `basename()` が既に落としている）
    .replace(/[<>:"/\\|?*]/gu, '_')
    // 先頭の `.` は隠しファイル・`.`／`..` になるので落とす
    .replace(/^\.+/u, '')
    .trim();
  return base.length === 0 ? 'export.txt' : base;
}

/**
 * 制御文字（`\u0000`〜`\u001f`）を `_` にする。
 * 正規表現に直接書くと `no-control-regex` に触れるので、1文字ずつコードで見る。
 */
function withoutControlChars(text: string): string {
  return Array.from(text, (ch) => (ch.charCodeAt(0) < 0x20 ? '_' : ch)).join('');
}

/** テキストを保存する。 */
export async function saveTextFile(
  window: BrowserWindow | undefined,
  request: SaveTextRequest,
): Promise<SaveTextResult> {
  if (
    typeof request.text !== 'string' ||
    Buffer.byteLength(request.text, 'utf8') > MAX_TEXT_BYTES
  ) {
    return { ok: false, canceled: false, message: MSG.textFile.tooLarge };
  }
  const defaultPath = join(app.getPath('documents'), safeFileName(request.defaultFileName));
  const options = {
    title: MSG.textFile.saveTitle,
    defaultPath,
    filters: [{ name: MSG.textFile.filterName, extensions: ['txt'] }],
  };
  /*
   * ウィンドウが無ければ**引数1つ**の形で呼ぶ（`work-files.ts` の `showSave()` と同じ理由。
   * 嘘の `BrowserWindow` を渡さない）。
   */
  const picked =
    window === undefined
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(window, options);
  if (picked.canceled || picked.filePath === undefined) {
    return { ok: false, canceled: true, message: MSG.textFile.saveCanceled };
  }
  try {
    writeFileSync(picked.filePath, request.text, 'utf8');
    return { ok: true, path: picked.filePath };
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: saveFailedText(error instanceof Error ? error.message : String(error)),
    };
  }
}
