import type { BoardSession } from '@ojt/board-model';
import { WORK_FILE_FORMAT_VERSION, type WorkFile } from '../../shared/ipc.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { cloneSession } from './commands.js';
import { bridge } from './worker-bridge.js';

/**
 * 作業ファイルの組み立てと復元。設計仕様 §12.3 / §13 #8。
 * 手動読込（セッション画面）と起動時の一時保存からの復帰（アプリ外枠）で共用する。
 */

/** 現在の状態を作業ファイルの形にする。§12.3 */
export function toWorkFile(
  problemId: string,
  session: BoardSession,
  elapsedMs: number,
  hazardCount: number,
): WorkFile {
  return {
    formatVersion: WORK_FILE_FORMAT_VERSION,
    problemId,
    session,
    elapsedMs,
    hazardCount,
    savedAt: new Date().toISOString(),
  };
}

/**
 * 作業ファイルの `session` を `BoardSession` として読む（形が違えば undefined）。§13 #8
 *
 * 名前が同じでも `@ojt/schematic-core` の `toSession(doc, board, options)`
 * （回路図 → 盤セッション。`{ ok, session, assignment } | { ok: false, errors }` を返す）とは別物。
 * このモジュールは保存した JSON を読み戻すだけで、割当も配線もしない。
 */
export function toSession(raw: unknown): BoardSession | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const source = raw as Partial<BoardSession>;
  if (!Array.isArray(source.wires)) return undefined;
  if (typeof source.socketRoles !== 'object' || source.socketRoles === null) return undefined;
  return source as BoardSession;
}

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 作業ファイルを画面に反映する。§12.3
 * 課題を読み直してからセッションを差し替え、Worker にも同じ盤を読ませる。
 * preload が無い・課題や盤の状態が読めない場合はトーストで理由を出して `false` を返す
 * （§13 #5。呼び出し側は投げられることを気にしなくてよい）。
 */
export async function applyWorkFile(file: WorkFile): Promise<boolean> {
  const store = useStore.getState();
  let api: ReturnType<typeof ojtApi>;
  try {
    api = ojtApi();
  } catch (error) {
    store.toast(reasonOf(error), 'error');
    return false;
  }
  const problem = await api.readProblem(file.problemId);
  if (problem === null) {
    store.toast(`作業ファイルの課題が見つかりません: ${file.problemId}`, 'error');
    return false;
  }
  const session = toSession(file.session);
  if (session === undefined) {
    store.toast('作業ファイルの盤の状態が読めません', 'error');
    return false;
  }
  store.openProblem(problem);
  store.setSession(cloneSession(session));
  bridge.send({ type: 'load', problemId: problem.id, session: cloneSession(session) });
  store.addLog(`作業ファイルを読み込みました（${file.savedAt}）`);
  return true;
}
