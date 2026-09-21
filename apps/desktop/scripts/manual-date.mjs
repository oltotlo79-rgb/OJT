import { execFileSync } from 'node:child_process';

/** @param {string} day */
function validDay(day) {
  return (
    /^\d{4}-\d{2}-\d{2}$/u.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day
  );
}

/** 明示指定 → 原稿と同じコミットの日 → Gitの無い配布元だけ当日。
 * @param {string} root
 * @param {string | undefined} [override]
 * @param {Date} [today]
 */
export function manualDate(
  root,
  override = globalThis.process.env['OJT_MANUAL_DATE'],
  today = new Date(),
) {
  if (override !== undefined) {
    if (!validDay(override))
      throw new Error('OJT_MANUAL_DATE は実在する日付 YYYY-MM-DD で指定してください。');
    return override;
  }
  try {
    const day = execFileSync('git', ['log', '-1', '--format=%cs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // 呼び出し元のGitフック等が別リポジトリを指していても原稿の履歴を読む。
      env: Object.fromEntries(
        Object.entries(globalThis.process.env).filter(([key]) => !key.startsWith('GIT_')),
      ),
    }).trim();
    if (validDay(day)) return day;
  } catch {
    /* ソース書庫など、Gitがない場合だけ当日へ落とす。 */
  }
  return today.toISOString().slice(0, 10);
}
