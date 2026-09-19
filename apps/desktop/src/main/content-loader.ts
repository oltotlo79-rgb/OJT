import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_ALL_PROBLEMS, type SupportedProblem } from '@ojt/content';
import { loadProblemsFromDir, mergeProblemSets, type ProblemSet } from '@ojt/content/loader';
import { app } from 'electron';
import { toErrorRow, toSummary, type ProblemListPayload } from '../shared/ipc.js';
import { MSG } from '../shared/messages.js';

/**
 * 課題の供給。設計仕様 §7.8 / §13 #1 / §13 #9。
 * Node の `fs` を使う `loadProblemsFromDir()` は main プロセスでしか動かないため、ここに置く。
 * 内蔵課題と利用者フォルダを `mergeProblemSets()` で合流し、同一IDは利用者側を優先する。
 *
 * フォルダの有無は `fs.promises.stat()` に**時間制限付き**で聞く（1D2-a のレビュー指摘）。
 * 到達できない共有フォルダ（`\\\\server\\share`）を指していると `existsSync()` は数十秒
 * 返ってこず、その間 main プロセスが丸ごと止まってウィンドウが無反応になる。
 * 制限時間を過ぎたら「フォルダが無い」として扱い、一覧に §13 #9 の警告行を出す。
 *
 * 読み込んだ結果は `(フォルダ, フォルダの更新時刻)` を鍵に1件だけ覚えておく。
 * `content:read`（課題を開く）は `content:list` の直後に必ず呼ばれるので、そのたびに
 * 8題＋利用者フォルダを読み直して zod で検証するのは無駄が大きい。
 */

/** 合流済みの課題（IDで引けるようにした一覧）。 */
export interface LoadedContent {
  payload: ProblemListPayload;
  byId: Map<string, SupportedProblem>;
}

/** 利用者フォルダの有無を調べるのに待てる時間[ms]（超えたら「無い」とみなす）。§13 #9 */
export const DIR_PROBE_TIMEOUT_MS = 1000;

/**
 * 覚えた読込結果を使い回してよい時間[ms]。
 *
 * 鍵はフォルダと更新時刻だが、**Windows のフォルダ更新時刻は当てにならない**
 * （同じ秒のうちにファイルを足しても `mtimeMs` が動かないことがある。実測で確認）。
 * そこで「更新時刻が同じ」かつ「覚えてから短時間」の両方が成り立つときだけ使い回す。
 * 狙いは `content:list` の直後に来る `content:read` を読み直しにしないことなので、
 * 数秒あれば足りるし、課題を差し替えた人が一覧を開き直せば必ず読み直される。
 */
export const CONTENT_CACHE_TTL_MS = 3000;

/** 直近の読込結果（鍵はフォルダと更新時刻、有効期限つき）。 */
let cached: { dir: string; mtimeMs: number; atMs: number; content: LoadedContent } | undefined;

/** 覚えている読込結果を捨てる（テストと設定変更の後始末用）。 */
export function clearContentCache(): void {
  cached = undefined;
}

/**
 * 同梱課題の置き場所。§7.8
 * 配布版では asar の外（`resources/content`）に置き、訓練担当者が中身を差し替えられるようにする。
 */
export function builtinContentDir(): string {
  return join(process.resourcesPath, 'content');
}

/**
 * 同梱課題を `ProblemSet` の形にする。§7.8
 *
 * 配布版（`app.isPackaged`）では **`resources/content` から読む**。§7.8 が
 * 「同梱課題も `resources/content/<mode>/<id>.json` を読む」と定めており、そこを差し替えれば
 * 内蔵課題そのものを入れ替えられることが利用者向けの約束になっているため。
 * フォルダが無い・1題も読めない（丸ごと消された／壊された）ときは、パッケージに焼き込んだ
 * `BUILTIN_ALL_PROBLEMS` に落として起動は続け、理由を一覧の読込エラー欄に出す（§13 #1）。
 *
 * 開発中（`!app.isPackaged`）は `resources/` がビルド成果物ではないので焼き込みをそのまま使う。
 */
export function builtinSet(): ProblemSet {
  // Plan 2B: モードB 8題 ＋ C1 4セット ＋ C2 8題 の計20題すべてを一覧に載せる（§7.9）
  const bundled: ProblemSet = { problems: [...BUILTIN_ALL_PROBLEMS], errors: [] };
  if (!app.isPackaged) return bundled;
  const dir = builtinContentDir();
  if (!existsSync(dir)) return withFallbackNotice(bundled, dir, '同梱課題フォルダがありません');
  const fromDisk = loadProblemsFromDir(dir);
  if (fromDisk.problems.length === 0) {
    return withFallbackNotice(bundled, dir, '同梱課題フォルダから1題も読めませんでした');
  }
  // BLOCKER: `dist` の複写漏れ（例: `MODES` に一部モードしか無い）や配布後の手作業による
  // 破損で、フォルダから読めた件数がアプリに焼き込んだ件数と食い違うことがある。
  // 無警告のまま一部の課題だけを一覧に出すと利用者が気付けないため、焼き込みへ確実に落とし、
  // 理由を読込エラー欄に出す（黙って欠けた一覧を出さない）。
  if (fromDisk.problems.length !== bundled.problems.length) {
    return withFallbackNotice(
      bundled,
      dir,
      MSG.content.countMismatch(fromDisk.problems.length, bundled.problems.length),
    );
  }
  return fromDisk;
}

/** 同梱課題を焼き込みに落としたことを一覧の読込エラー欄に残す。§13 #1 */
function withFallbackNotice(bundled: ProblemSet, dir: string, reason: string): ProblemSet {
  return {
    problems: bundled.problems,
    errors: [
      {
        file: dir,
        reason: 'read-error',
        message: `${reason}。アプリに内蔵した課題で起動します`,
        issues: [],
      },
    ],
  };
}

/** 約束が時間内に片付かなければ `fallback` を返す（待ち続けない）。 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      resolve(fallback);
    }, ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** 利用者フォルダの状態。 */
export interface UserDirState {
  exists: boolean;
  /** 覚えた結果を使い回せるかの鍵。フォルダが無いときは -1。 */
  mtimeMs: number;
}

/** 「フォルダが無い」ときの答え。 */
const MISSING: UserDirState = { exists: false, mtimeMs: -1 };

/**
 * 利用者フォルダの状態を調べる。存在しない・辿り着けない・フォルダでない（ファイルを指している）
 * のいずれも `exists: false` にまとめる。
 */
export async function probeUserDir(
  userDir: string,
  timeoutMs = DIR_PROBE_TIMEOUT_MS,
): Promise<UserDirState> {
  if (userDir.length === 0) return MISSING;
  const probe: Promise<UserDirState> = stat(userDir).then(
    (info) => (info.isDirectory() ? { exists: true, mtimeMs: info.mtimeMs } : MISSING),
    () => MISSING,
  );
  return withTimeout(probe, timeoutMs, MISSING);
}

/** 内蔵課題と利用者フォルダを実際に読んで合流する（覚えている結果は見ない）。 */
function readContent(userDir: string, exists: boolean): LoadedContent {
  const builtin = builtinSet();
  const builtinIds = new Set(builtin.problems.map((p) => p.id));
  const user: ProblemSet = exists ? loadProblemsFromDir(userDir) : { problems: [], errors: [] };
  const merged = mergeProblemSets(builtin, user);
  const userIds = new Set(user.problems.map((p) => p.id));
  const byId = new Map(merged.problems.map((p) => [p.id, p] as const));
  return {
    payload: {
      problems: merged.problems.map((p) =>
        toSummary(p, userIds.has(p.id) || !builtinIds.has(p.id) ? 'user' : 'builtin'),
      ),
      errors: merged.errors.map(toErrorRow),
      userDir,
      userDirExists: exists,
    },
    byId,
  };
}

/**
 * 内蔵課題と利用者フォルダを合流する。§7.8
 * フォルダが無い（または時間内に応答しない）ときは読込を試みず、`userDirExists: false` だけを
 * 返す（§13 #9）。同じフォルダが同じ更新時刻のままなら前回の結果をそのまま返す。
 */
export async function loadContent(userDir: string): Promise<LoadedContent> {
  const { exists, mtimeMs } = await probeUserDir(userDir);
  const now = Date.now();
  const hit = cached;
  if (
    hit !== undefined &&
    hit.dir === userDir &&
    hit.mtimeMs === mtimeMs &&
    now - hit.atMs < CONTENT_CACHE_TTL_MS
  ) {
    return hit.content;
  }
  const content = readContent(userDir, exists);
  cached = { dir: userDir, mtimeMs, atMs: now, content };
  return content;
}
