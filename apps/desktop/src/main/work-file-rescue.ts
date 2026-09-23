import { MAX_NETWORKS } from '@ojt/ladder-core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dialog,
  type BrowserWindow,
  type MessageBoxOptions,
  type OpenDialogOptions,
} from 'electron';
import { parseWorkFile } from '../shared/work-file-codec.js';
import { isRecord } from '../shared/work-file-schema.js';
import type { WorkFile } from '../shared/ipc.js';
import { errnoText, MSG, saveFailedText } from '../shared/messages.js';

/** 旧版の上限超過データを、全情報を残した原本と、内容を確認できる分割作業へ救出する。 */
export async function rescueOversizedWorkFile(
  window: BrowserWindow | undefined,
  raw: unknown,
  originalText: string,
): Promise<string> {
  if (!isRecord(raw) || !isRecord(raw['ladder']) || !Array.isArray(raw['ladder']['networks']))
    return MSG.workFile.tooManyNetworks;
  const networks: unknown[] = raw['ladder']['networks'];
  const parts: WorkFile[] = [];
  for (let first = 0; first < networks.length; first += MAX_NETWORKS) {
    const parsed = parseWorkFile({
      ...raw,
      converted: false,
      ladder: { ...raw['ladder'], networks: networks.slice(first, first + MAX_NETWORKS) },
    });
    if (!parsed.ok) return `${MSG.workFile.tooManyNetworks}。分割後の検証: ${parsed.message}`;
    parts.push(parsed.file);
  }
  const options: MessageBoxOptions = {
    type: 'warning',
    title: '上限を超えた旧作業の救出',
    message: `この作業には${networks.length}回路ブロックあります（編集上限${MAX_NETWORKS}）。`,
    detail:
      '元データを残したまま、全内容の原本コピーと64ブロックずつの確認用作業ファイルを書き出せます。分割した回路は元と同じ動作・採点を保証しません。必要なブロックを整理してから使用してください。現在の画面の作業は変わりません。',
    buttons: ['救出用ファイルを書き出す', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const picked =
    window === undefined
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options);
  if (picked.response !== 0) return MSG.workFile.tooManyNetworks;
  const directoryOptions: OpenDialogOptions = {
    title: '救出用フォルダを作る場所',
    properties: ['openDirectory', 'createDirectory'],
  };
  const directory =
    window === undefined
      ? await dialog.showOpenDialog(directoryOptions)
      : await dialog.showOpenDialog(window, directoryOptions);
  const parent = directory.filePaths[0];
  if (directory.canceled || parent === undefined) return MSG.workFile.tooManyNetworks;
  let destination: string | undefined;
  try {
    destination = mkdtempSync(join(parent, 'ojt-recovery-'));
    // 原本は再整形せず、未知のキーやBOMも含めて読み取った内容を保持する。
    writeFileSync(join(destination, 'original.ojtw'), originalText, {
      encoding: 'utf8',
      flag: 'wx',
    });
    for (const [index, part] of parts.entries()) {
      writeFileSync(
        join(destination, `part-${String(index + 1).padStart(3, '0')}.ojtw`),
        `${JSON.stringify(part, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
    }
    const ranges = parts
      .map(
        (_, index) =>
          `- part-${String(index + 1).padStart(3, '0')}.ojtw: 元の${index * MAX_NETWORKS + 1}〜${Math.min((index + 1) * MAX_NETWORKS, networks.length)}番目のブロック`,
      )
      .join('\n');
    writeFileSync(
      join(destination, 'README.txt'),
      `旧作業の救出\n\noriginal.ojtw は全内容の原本コピーです。元のファイルも変更していません。\n${ranges}\n\n分割ファイルは「作業を読込」で開き、各ブロックの内容を確認できます。\n前後のブロックの依存関係が分かれるため、元と同じ動作・採点を保証しません。\n必要なブロックを整理し、64個以内の回路として変換・動作確認後、別名で保存してください。\n原本コピーは整理が終わるまで保管してください。\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    return `作業は開いていません。救出用の原本と分割作業を保存しました: ${destination}`;
  } catch (cause) {
    return `${saveFailedText(errnoText(cause))}${destination === undefined ? '' : `（途中までの保存先: ${destination}）`}`;
  }
}
