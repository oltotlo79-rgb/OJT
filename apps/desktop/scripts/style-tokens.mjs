/**
 * CSS変数はCSSとReactのstyle属性の両方で定義される。未定義の色を使って
 * 宣言全体が無効になる事故を、描画より前に検出する。明示的なfallbackは許す。
 * @param {Iterable<{ path: string; text: string }>} sources
 * @returns {Array<{ path: string; token: string }>}
 */
export function undefinedStyleTokens(sources) {
  const inputs = [...sources];
  const definitions = new Set();
  for (const { text } of inputs) {
    for (const match of text.matchAll(/["']?(--[a-z][\w-]+)["']?\s*:/g)) definitions.add(match[1]);
    for (const match of text.matchAll(/setProperty\(\s*['"](--[a-z][\w-]+)/g))
      definitions.add(match[1]);
  }
  return inputs.flatMap(({ path, text }) => {
    const missing = new Set(
      [...text.matchAll(/var\(\s*(--[a-z][\w-]+)\s*\)/g)]
        .map((match) => match[1])
        .filter((token) => token !== undefined && !definitions.has(token)),
    );
    return [...missing].map((token) => ({ path, token: String(token) }));
  });
}
