import {
  JIPM_BOARD,
  MOUNTABLE_KINDS,
  SOCKET_IDS,
  toPhysicalTerminal,
  validateSocketRoles,
  type BoardSession,
} from '@ojt/board-model';
import type { TerminalId, WireColor } from '@ojt/circuit-sim';
import { WORK_FILE_FORMAT_VERSION, type WorkFile } from '../../shared/ipc.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { JA, workFileProblemMissingText, workFileRestoredLog } from '../i18n/ja.js';
import { cloneSession } from './commands.js';
import { bridge } from './worker-bridge.js';

/**
 * 作業ファイルの組み立てと復元。設計仕様 §12.3 / §13 #8。
 * 手動読込（セッション画面）と起動時の一時保存からの復帰（アプリ外枠）で共用する。
 */

/** 作業ファイルに載せてよい電線の本数の上限（main の `parseWorkFile()` と同じ値）。§13 #8 */
export const MAX_RESTORED_WIRES = 200;

/**
 * 線色のパレット。`Record<WireColor, true>` にしておくと、エンジンに色が増えたときに
 * この表を直すまで `tsc` が落ちる（画面に知らない色がすり抜けない）。§6.6
 */
const WIRE_COLOR_SET = { 青: true, 白: true, 黄: true } satisfies Record<WireColor, true>;

/** 盤に実在する端子IDの集合（物理端子ID）。§6.4 */
const BOARD_TERMINALS = new Set<string>(JIPM_BOARD.terminals.map((t) => t.id));

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWireColor(value: unknown): value is WireColor {
  return typeof value === 'string' && Object.hasOwn(WIRE_COLOR_SET, value);
}

/**
 * 端子IDが盤に実在するか。§6.4
 * 保存データは役割ベース（`CR1.13`）で持つので、割当表で物理端子ID（`S1.13`）に直してから照合する。
 * 形式が壊れていれば `toPhysicalTerminal()` が投げるので、その場合も「盤に無い」として扱う。
 */
function isBoardTerminal(roles: BoardSession['socketRoles'], value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  let physical: TerminalId;
  try {
    physical = toPhysicalTerminal(roles, value as TerminalId);
  } catch {
    return false;
  }
  return BOARD_TERMINALS.has(physical);
}

/** 装着状態が読めるか（種別はカタログにあるか、タイマの設定値は有限か）。§7.1 */
function isMountedPart(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const kind = value['kind'];
  if (typeof kind !== 'string') return false;
  if (!(MOUNTABLE_KINDS as readonly string[]).includes(kind)) return false;
  const preset = value['presetMs'];
  if (preset !== undefined && (typeof preset !== 'number' || !Number.isFinite(preset)))
    return false;
  const range = value['rangeMaxMs'];
  if (range !== undefined && (typeof range !== 'number' || !Number.isFinite(range))) return false;
  return true;
}

/**
 * 作業ファイルの `session` を `BoardSession` として読む（形が違えば undefined）。§13 #8
 *
 * 上端の形だけでなく**要素ひとつひとつ**を確かめる（1D2-a のレビュー指摘）。
 * `wires` に文字列が1つ混ざっているだけで経路器・3Dシーンが描画中に `TypeError` で落ち、
 * 例外バナーからも戻れなくなるため、盤に載せる前にここで断る。
 *
 * 名前が同じでも `@ojt/schematic-core` の `toSession(doc, board, options)`
 * （回路図 → 盤セッション。`{ ok, session, assignment } | { ok: false, errors }` を返す）とは別物。
 * このモジュールは保存した JSON を読み戻すだけで、割当も配線もしない。
 */
export function toSession(raw: unknown): BoardSession | undefined {
  if (!isRecord(raw)) return undefined;
  const source = raw;

  // 役割割当（`socketRoles`）は電線の端子IDを物理端子へ直すのに使うので最初に確かめる
  const roles = source['socketRoles'];
  if (!isRecord(roles)) return undefined;
  if (validateSocketRoles(roles).length > 0) return undefined;
  const socketRoles = roles as BoardSession['socketRoles'];

  const wires = source['wires'];
  if (!Array.isArray(wires)) return undefined;
  if (wires.length > MAX_RESTORED_WIRES) return undefined;
  for (const wire of wires) {
    if (!isRecord(wire)) return undefined;
    if (typeof wire['id'] !== 'string' || wire['id'].length === 0) return undefined;
    if (!isWireColor(wire['color'])) return undefined;
    if (!isBoardTerminal(socketRoles, wire['from'])) return undefined;
    if (!isBoardTerminal(socketRoles, wire['to'])) return undefined;
  }

  const mounted = source['mounted'];
  if (mounted !== undefined) {
    if (!isRecord(mounted)) return undefined;
    for (const [socket, part] of Object.entries(mounted)) {
      if (part === undefined) continue;
      if (!(SOCKET_IDS as readonly string[]).includes(socket)) return undefined;
      if (!isMountedPart(part)) return undefined;
    }
  }

  return source as unknown as BoardSession;
}

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * いまの作業を捨ててよいか確認が要るか。§12.3
 * **別の課題**の作業ファイルを開くときで、いまの盤に訓練者が張った電線か操作履歴があるときだけ。
 * 同じ課題の続きを読むぶんには確認しない（元々その課題を作業していたのだから驚きが無い）。
 */
export function needsDiscardConfirm(file: WorkFile): boolean {
  const { problem, session, history } = useStore.getState();
  if (problem === undefined || session === undefined) return false;
  if (problem.id === file.problemId) return false;
  return session.wires.some((wire) => !wire.locked) || history.done.length > 0;
}

/**
 * 作業ファイルを画面に反映する。§12.3
 * 課題を読み直してからセッションを差し替え、Worker にも同じ盤を読ませる。
 * 経過時間と危険操作の回数も戻す（1D2-a のレビュー指摘: 復元しても 00:00.0 から数え直していた）。
 * preload が無い・課題や盤の状態が読めない場合はトーストで理由を出して `false` を返す
 * （§13 #5。呼び出し側は投げられることを気にしなくてよい）。
 *
 * `options.confirmed` が偽で、いまの作業を捨てることになる場合は適用せずに確認欄を出させる
 * （`App` が `pendingWorkFile` を見て「続行／取消」を尋ね、続行なら `confirmed: true` で呼び直す）。
 */
export async function applyWorkFile(
  file: WorkFile,
  options: { confirmed?: boolean } = {},
): Promise<boolean> {
  const store = useStore.getState();
  if (options.confirmed !== true && needsDiscardConfirm(file)) {
    store.setPendingWorkFile(file);
    return false;
  }
  let api: ReturnType<typeof ojtApi>;
  try {
    api = ojtApi();
  } catch (error) {
    store.toast(reasonOf(error), 'error');
    return false;
  }
  const problem = await api.readProblem(file.problemId);
  if (problem === null) {
    store.toast(workFileProblemMissingText(file.problemId), 'error');
    return false;
  }
  const session = toSession(file.session);
  if (session === undefined) {
    store.toast(JA.session.badSession, 'error');
    return false;
  }
  store.openProblem(problem);
  store.setSession(cloneSession(session));
  store.restoreProgress(file.elapsedMs, file.hazardCount);
  bridge.send({ type: 'load', problemId: problem.id, session: cloneSession(session) });
  store.addLog(workFileRestoredLog(file.savedAt));
  return true;
}
