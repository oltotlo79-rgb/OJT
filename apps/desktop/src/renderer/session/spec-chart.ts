import { JIPM_BOARD } from '@ojt/board-model';
import {
  buildReferenceSession,
  buildTimeChart,
  defaultChartSignals,
  resolveCompareSignals,
  runOperations,
  timerMarkers,
  type SchematicProblem,
  type TimeChart,
} from '@ojt/content';

/**
 * 課題の仕様タイムチャート。設計仕様 §7.7 / §8.1。
 * 波形は課題JSONに書かれていないので、**模範回路をその場でシミュレートして**作る（決定事項#8）。
 * 5000ms の課題でも 500 tick なので renderer の同期計算で足りる（§5.2 の 1tick 1ms 未満目標）。
 */

/** 仕様チャートの構築結果。模範回路が変換できなければ理由を返す（§13 #2）。 */
export type SpecChartResult = { ok: true; chart: TimeChart } | { ok: false; errors: string[] };

/**
 * 課題IDごとの結果のキャッシュ。
 *
 * 中身は模範回路を丸ごと1回シミュレートした結果で、内蔵課題でも 175〜260ms かかる
 * （レビュー計測）。課題は開いている間ずっと同じものなので、セッション画面を開くたびに
 * 作り直す必要はない。
 * 結果は読み取り専用として扱う（呼び出し側は `chart` を書き換えない）。
 */
const CACHE = new Map<string, SpecChartResult>();

/**
 * 内容の指紋（FNV-1a 32bit）。指摘 DS-6。
 *
 * 利用者課題フォルダの JSON は 3 秒の TTL で読み直される（`main/content-loader.ts`）のに、
 * 鍵が `id@formatVersion` だけだと、JSON を直して課題一覧を開き直しても**アプリを再起動する
 * まで古い波形が出続けた**。ID も版も変えずに模範回路や操作列だけ直すのが普通の直し方なので、
 * 中身そのものを鍵に混ぜる。課題1件の JSON は数KBで、走らせるのは課題を開いた瞬間だけ。
 */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** キャッシュの鍵（ID・版・中身の指紋）。 */
function cacheKey(problem: SchematicProblem): string {
  return `${problem.id}@${problem.formatVersion}#${fingerprint(JSON.stringify(problem))}`;
}

/** キャッシュを空にする（テスト用）。 */
export function clearSpecChartCache(): void {
  CACHE.clear();
}

/** その課題の仕様チャートがもうキャッシュにあるか（テスト用）。 */
export function isSpecChartCached(problem: SchematicProblem): boolean {
  return CACHE.has(cacheKey(problem));
}

/** 課題の仕様タイムチャートを作る（同じ課題の2度目以降はキャッシュを返す）。 */
export function buildSpecChart(problem: SchematicProblem): SpecChartResult {
  const key = cacheKey(problem);
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;
  const result = computeSpecChart(problem);
  CACHE.set(key, result);
  return result;
}

/** 模範回路をその場で走らせて仕様チャートを作る（キャッシュの中身）。 */
function computeSpecChart(problem: SchematicProblem): SpecChartResult {
  const reference = buildReferenceSession(problem, JIPM_BOARD);
  if (!reference.ok) {
    return { ok: false, errors: reference.errors.map((e) => `${e.path}: ${e.message}`) };
  }
  const run = runOperations(reference.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  const specs = defaultChartSignals(
    resolveCompareSignals(problem.judge, problem.board.extraParts ?? []),
  );
  return {
    ok: true,
    chart: buildTimeChart(
      run.log,
      specs,
      problem.durationMs,
      timerMarkers(reference.value.netlist),
    ),
  };
}
