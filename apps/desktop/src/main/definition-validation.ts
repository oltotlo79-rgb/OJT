import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { DefinitionValidation } from '@ojt/content';

let busy = false;
/** 長い模範再生でmainの終了・ダイアログ応答を止めない。 */
export async function validateInWorker(definition: unknown): Promise<DefinitionValidation> {
  if (busy)
    return {
      id: undefined,
      note: '',
      reasons: ['課題を検証中です。完了してから再試行してください。'],
    };
  busy = true;
  try {
    return await new Promise<DefinitionValidation>((resolve, reject) => {
      const worker = new Worker(join(import.meta.dirname, 'definition-worker.js'));
      let settled = false;
      const finish = (result?: DefinitionValidation, error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void worker.terminate();
        if (error !== undefined) reject(error);
        else resolve(result!);
      };
      const timeout = setTimeout(
        () =>
          finish({
            id: undefined,
            note: '',
            reasons: [
              '検証が60秒を超えました。操作列・判定時間・回路規模を小さくして分割してください。',
            ],
          }),
        60_000,
      );
      worker.once('message', (result: DefinitionValidation) => finish(result));
      worker.once('error', (error) =>
        finish(undefined, error instanceof Error ? error : new Error(String(error))),
      );
      worker.once('exit', (code) => {
        if (!settled) finish(undefined, new Error(`検証処理が終了しました（${code}）`));
      });
      worker.postMessage(definition);
    });
  } finally {
    busy = false;
  }
}
