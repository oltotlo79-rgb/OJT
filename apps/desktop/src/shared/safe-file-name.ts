import { basename } from 'node:path';

/**
 * 既定のファイル名を安全にする（renderer からの生入力を信用しない）。§13 #7 / レビュー DM-2
 * `main/work-files.ts` と `main/text-files.ts` の両方が使うため `shared/` に共有化する。
 *
 * **順番が肝**（レビュー B4）: 先に区切りを `_` へ置換してから `basename()` を通すと、
 * `'../../evil/name.txt'` が `'.._.._evil_name.txt'` になって `..` が残り、
 * `defaultPath` に `..` が出たままになる（テストが落ちる）。`basename()` を**先**に通して
 * ディレクトリ部を捨て、残った名前から Windows で使えない文字と先頭の `.` を落とす。
 *
 *   `'../../evil/name.txt'` → basename `'name.txt'` → `'name.txt'`
 *   `'..'`                  → basename `'..'`       → 先頭の `.` が消えて空 → 既定名
 */
export function safeFileName(name: string, fallback = 'export.txt'): string {
  const base = withoutControlChars(basename(name))
    // Windows のファイル名に使えない文字（`/` `\` は `basename()` が既に落としている）
    .replace(/[<>:"/\\|?*]/gu, '_')
    // 先頭の `.` は隠しファイル・`.`／`..` になるので落とす
    .replace(/^\.+/u, '')
    .trim();
  return base.length === 0 ? fallback : base;
}

/**
 * 制御文字（`\u0000`〜`\u001f`）を `_` にする。
 * 正規表現に直接書くと `no-control-regex` に触れるので、1文字ずつコードで見る。
 */
function withoutControlChars(text: string): string {
  return Array.from(text, (ch) => (ch.charCodeAt(0) < 0x20 ? '_' : ch)).join('');
}
