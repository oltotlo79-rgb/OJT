import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync('src/renderer/app/global.css', 'utf8');
const high = css.match(/:root\[data-contrast='high'\]\s*\{([^}]+)\}/)?.[1] ?? '';
const colors = new Map(
  [...high.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map((match) => [match[1], match[2]]),
);
function luminance(hex: string): number {
  const values = [1, 3, 5].map((start) => {
    const c = parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
}
function ratio(a: string, b: string): number {
  const la = luminance(a),
    lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
describe('高コントラストの実際の配色', () => {
  it.each(['--bg', '--panel', '--panel-2'])('補助文が%s上で4.5:1以上', (background) => {
    const foreground = colors.get('--muted'),
      back = colors.get(background);
    expect(foreground).toBeDefined();
    expect(back).toBeDefined();
    expect(ratio(foreground ?? '', back ?? '')).toBeGreaterThanOrEqual(4.5);
  });
  it('紙面の補助文も4.5:1以上', () => {
    expect(ratio(colors.get('--paper-muted') ?? '', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
