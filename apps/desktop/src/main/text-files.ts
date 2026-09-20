import { join } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { SaveTextRequest, SaveTextResult } from '../shared/ipc.js';
import { errnoText, MSG, saveFailedText } from '../shared/messages.js';
import { safeFileName } from '../shared/safe-file-name.js';
import { writeFileAtomic } from './fs-atomic.js';

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
  /*
   * `request.defaultFileName` も型（`SaveTextRequest.defaultFileName: string`）は信用しない
   * （renderer からの生入力。IPC は実行時に型を強制しない。レビュー #8）。`.text` と同じ流儀で
   * ここで確かめ、文字列でなければ既定名に倒す（`safeFileName()` に非文字列を渡すと
   * `basename()` が例外を投げる）。
   */
  const defaultFileName =
    typeof request.defaultFileName === 'string' ? request.defaultFileName : 'export.txt';
  const defaultPath = join(app.getPath('documents'), safeFileName(defaultFileName));
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
    writeFileAtomic(picked.filePath, request.text);
    return { ok: true, path: picked.filePath };
  } catch (cause) {
    return { ok: false, canceled: false, message: saveFailedText(errnoText(cause)) };
  }
}
