/**
 * 決定論的な擬似乱数。設計仕様 §5.2 / §7.5。
 * 「故障のランダム選択は課題開始前に seed から決め、以降のシミュレーションは決定論的」という
 * 方針を満たすため、`Math.random()` は使わず seed から列を作る（同じ seed からは必ず同じ列）。
 * 採用したのは mulberry32（32bit状態・高速・分布が十分）である。
 */

/** seed から [0,1) の擬似乱数列を作る（mulberry32）。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 0以上 `length` 未満の整数を1つ引く。`length` が0以下なら0を返す。 */
export function pickIndex(random: () => number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.floor(random() * length));
}

/** 配列から1つ引く（空配列は undefined）。 */
export function pickOne<T>(random: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[pickIndex(random, items.length)];
}

/**
 * 文字列から seed を作る（FNV-1a 32bit）。同じ文字列からは必ず同じ値になる。
 * C1で「どの接点組に故障を入れるか」を課題の seed と部品IDから決めるのに使う（§7.5 組の選択）。
 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
