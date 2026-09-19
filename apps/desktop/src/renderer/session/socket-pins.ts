import { SOCKET_PIN_COUNT, type TerminalRole } from '@ojt/board-model';

/**
 * 14ピンソケットの「どの番号が何か」。利用者要望 2026-09-20
 * 「リレーソケットの各番号はどこが何かわからないから分かるようにしてね」。設計仕様 §6.2 / §8.2。
 *
 * 新人は ①〜⑭ の番号だけを見ても、そのネジが b接点なのか a接点なのか COM なのかコイルなのかが
 * 分からない。番号の意味は**3か所で同じ言葉・同じ色**で示す（利用者の設計方針「統一された見た目」）。
 *
 * 1. 3Dソケットの面の印字（`three/socket-face.ts`）— 段見出し＋色帯
 * 2. 端子のホバーのツールチップ（`three/Socket.tsx` → `i18n/ja.ts`）
 * 3. 部品カードのピン配列の図（`panels/SocketPinout.tsx`）
 *
 * このモジュールは**言葉も描画も持たない**（言葉は `i18n/ja.ts`、描画は上の3か所）。
 * ここにあるのは「ピン番号 → 役割の大分類」「ピン番号 → 組になる相手」という盤の事実だけで、
 * 3か所が同じ事実を引くための1つの出どころになる。
 */

/**
 * ピンの役割の大分類。盤定義の `TerminalRole` は極性まで分ける（`coil+` / `coil-`）が、
 * 見出しと色はコイルを1つにまとめる（実物の銘板も「コイル」とだけ書く）。
 */
export type PinGroup = 'nc' | 'no' | 'com' | 'coil';

/** 見出しに出す順（番号の小さい側から）。 */
export const PIN_GROUPS: readonly PinGroup[] = ['nc', 'no', 'com', 'coil'];

/**
 * 接点の組（`b接点 - a接点 - COM` が1組）。§6.2
 * 1-5-9 / 2-6-10 / 3-7-11 / 4-8-12 の4組で、どの組も「COM を真ん中に b接点と a接点」である。
 */
export const CONTACT_SETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 5, 9],
  [2, 6, 10],
  [3, 7, 11],
  [4, 8, 12],
];

/** コイル（タイマなら動作電源）のピン。 */
export const COIL_PINS: readonly [number, number] = [13, 14];

/** ピン番号が範囲外のときに投げる。 */
export class PinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinError';
  }
}

/** ピン番号 → 役割の大分類。`board-jipm` の `pinRole()` と同じ境目で切る。 */
export function pinGroup(pin: number): PinGroup {
  if (!Number.isInteger(pin) || pin < 1 || pin > SOCKET_PIN_COUNT) {
    throw new PinError(`ピン番号が範囲外です: ${String(pin)}`);
  }
  if (pin >= 13) return 'coil';
  if (pin >= 9) return 'com';
  if (pin >= 5) return 'no';
  return 'nc';
}

/** 端子の役割（`coil+` / `coil-` まで分かれている）→ 大分類。ソケット以外の役割は undefined。 */
export function groupOfRole(role: TerminalRole): PinGroup | undefined {
  if (role === 'coil+' || role === 'coil-') return 'coil';
  if (role === 'com' || role === 'no' || role === 'nc') return role;
  return undefined;
}

/**
 * そのピンと**組になる**ピン。
 * - b接点（1〜4）・a接点（5〜8） → 同じ組の COM 1本
 * - COM（9〜12） → 同じ組の b接点と a接点の2本
 * - コイル（13・14） → もう片方
 */
export function pinPartners(pin: number): number[] {
  const group = pinGroup(pin);
  if (group === 'coil') return COIL_PINS.filter((p) => p !== pin);
  const set = CONTACT_SETS.find((s) => s.includes(pin));
  if (set === undefined) throw new PinError(`組の無いピンです: ${String(pin)}`);
  return group === 'com' ? [set[0], set[1]] : [set[2]];
}

/**
 * 大分類ごとの色。利用者指定「NC 橙 / NO 緑 / COM 青 / コイル 赤」。
 *
 * **色は補助**である。4色を色だけで見分けるのは第1色覚・第2色覚の人には難しく（橙と赤、緑と橙が
 * 近づく）、色だけに意味を載せてはいけない。だから3か所とも**必ず日本語の見出しを添える**形にした
 * （3Dの面は段見出し、ツールチップは文、カードは行見出し）。そのうえで、
 * - 4色の色相はどの2つも 35° 以上離す（橙と赤がいちばん近い ≒ 39°）
 * - 橙と赤は明るさでも離す（見分けの主な手掛かりを色相だけにしない）
 * - どの色も黒いソケット本体（`SOCKET_BODY_COLOR` = `#23262B`）に対して 3:1 以上の明暗差を持つ
 * という条件を `test/socket-face-print.test.ts` が数値で縛る。
 *
 * 回路図ヒント（`schematic/`）はピン番号に色を付けていない（線の色＝電線色だけを使う）ので、
 * ここは**3Dソケット・ツールチップ・部品カードの3か所だけで共有する配色**である。
 */
export const PIN_GROUP_COLOR: Readonly<Record<PinGroup, string>> = {
  nc: '#FFB020',
  no: '#3DD68C',
  com: '#57A6FF',
  coil: '#FF7070',
};
