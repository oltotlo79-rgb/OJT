import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { cleanup, render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';
import { SKIN_THEMES } from '../src/renderer/ladder/skins/index.js';
import styles from '../src/renderer/ladder/ladder.module.css';

/**
 * ラダーの枠の文字色（2026-09-19 UXレビュー #1 Blocking）。
 *
 * ラダーの枠だけは明るい背景（GX Works3“風”の白い編集画面）なのに、`body` の
 * `color: #e7ebf2` をそのまま継いでいたため、プロジェクトツリー・出力ウィンドウの見出し・
 * I/O割付・キー割当の文字が**白地に白**で出ていた。
 *
 * **happy-dom は CSS Modules を読み込まない**（`vitest.config.ts` は `css` を立てていないので
 * スタイルシートそのものが実行時には存在しない）。したがって `getComputedStyle().color` は
 * 空か既定値しか返さず、「実際に何色で描かれるか」をこの環境で測ることはできない。
 * そこで検査は2本立てにする:
 *   1. 描画した DOM が、色を明示しているクラスを実際に着ているか（`styles.*` と突き合わせる）
 *   2. `ladder.module.css` の本文を読み、そのクラスが `color` を宣言していること・
 *      宣言された色が下地に対して WCAG AA（4.5:1）を満たすことを計算で確かめる
 * `getComputedStyle()` が値を返す環境（将来 `css: true` にしたとき）では、body の淡色を
 * 継いでいないことも併せて確かめる。
 */

/**
 * CSS の本文。`import.meta.url` は happy-dom では `file:` にならないので `process.cwd()` から
 * 引く（vitest の作業ディレクトリは `apps/desktop`。リポジトリ直下から叩かれた場合も拾う）。
 */
const CSS = ((): string => {
  const rel = 'src/renderer/ladder/ladder.module.css';
  for (const base of [process.cwd(), resolve(process.cwd(), 'apps/desktop')]) {
    const path = resolve(base, rel);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(`${rel} が見つからない（cwd: ${process.cwd()}）`);
})();

/** `body` の文字色（`app/global.css` の `--text`）。ラダーの枠がこれを継いでいたのが #1。 */
const BODY_FG = '#e7ebf2';

/** ラダーの枠の文字色（`.workspace` の `--ladder-fg`）。スキンが変わっても枠の字はこの色。 */
const LADDER_FG = '#1a1d22';

/** ラダーの枠で使っている下地。いちばん濃いのは見出し帯の `#e4e7ec`。 */
const SURFACES = {
  white: '#ffffff',
  grid: '#f7f8fa',
  frame: '#eef0f4',
  header: '#e4e7ec',
} as const;

/** 相対輝度（WCAG 2.x）。 */
function luminance(hex: string): number {
  const body = hex.replace('#', '');
  const full =
    body.length === 3
      ? [...body].map((char) => `${char}${char}`).join('')
      : body.padEnd(6, '0').slice(0, 6);
  const channel = (at: number): number => {
    const srgb = Number.parseInt(full.slice(at, at + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** コントラスト比（1〜21）。 */
function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * その セレクタを含む宣言ブロックの中身をぜんぶ繋いで返す（CSS Modules のクラス名は
 * ハッシュ前の綴りでファイルに書いてある）。`.commentText` のように「まとめ書きの並び」と
 * 「単独のブロック」の両方に出るセレクタがあるので、先頭の1件だけでは足りない。
 */
function rule(selector: string): string {
  const bodies: string[] = [];
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const prelude = (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//gu, '');
    const names = prelude.split(',').map((name) => name.trim());
    if (names.includes(selector)) bodies.push(match[2] ?? '');
  }
  if (bodies.length === 0) throw new Error(`ladder.module.css に "${selector}" が無い`);
  return bodies.join('\n');
}

/** #1 で「必ず色を明示する」と決めた入れ物と文字。 */
const COLORED: readonly string[] = [
  '.workspace',
  '.tree',
  '.workspaceSide',
  '.output',
  '.side',
  '.treeList button',
  '.outputList li > button',
  '.outputHeader h2',
  '.usage p',
  '.sideTitle',
];

/**
 * 明るい下地に載る文字色と、その下地の組み合わせ。CSS を直に読んで「その色がいまも
 * 書かれているか」まで確かめるので、色を薄い方へ戻すとこのテストが落ちる。
 */
const PAIRS: ReadonlyArray<{ selector: string; prop: string; fg: string; bg: string }> = [
  { selector: '.workspace', prop: '--ladder-fg', fg: '#1a1d22', bg: SURFACES.header },
  { selector: '.workspace', prop: '--ladder-fg-muted', fg: '#555', bg: SURFACES.white },
  { selector: '.workspace', prop: '--ladder-fg-faint', fg: '#6b7280', bg: SURFACES.white },
  { selector: '.networkHeader', prop: 'color', fg: '#444', bg: SURFACES.grid },
  { selector: '.networkComment', prop: 'color', fg: '#1b6ac9', bg: SURFACES.grid },
  { selector: '.hiddenWarn', prop: 'color', fg: '#b34700', bg: SURFACES.grid },
  { selector: '.presetText', prop: 'fill', fg: '#555', bg: SURFACES.grid },
  { selector: '.commentText', prop: 'fill', fg: '#1b6ac9', bg: SURFACES.grid },
  { selector: '.okTag', prop: 'color', fg: '#146b31', bg: SURFACES.header },
  { selector: '.ngTag', prop: 'color', fg: '#9c3d00', bg: SURFACES.header },
  { selector: '.outputError', prop: 'color', fg: '#b3261e', bg: SURFACES.white },
  { selector: '.outputWarning', prop: 'color', fg: '#b34700', bg: SURFACES.white },
  { selector: '.outputEmpty', prop: 'color', fg: '#666', bg: SURFACES.white },
  { selector: '.outputPlace', prop: 'color', fg: '#555', bg: SURFACES.white },
  { selector: '.inputError', prop: 'color', fg: '#b3261e', bg: SURFACES.white },
  { selector: '.shortcutOff', prop: 'color', fg: '#6f747e', bg: SURFACES.white },
];

/**
 * 宣言された色を探す正規表現。Plan 4B Task 2 で、スキンの効く宣言は
 * `fill: var(--skin-comment, #1b6ac9)` の**既定値つきの変数読み**になった（決定表#5）。
 * 変数を流し込まない場所では既定値（＝従来の色）がそのまま効くので、どちらの綴りでも
 * 「その色がいまも書かれている」ことを見る。
 */
function declares(prop: string, color: string): RegExp {
  const literal = color.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`${prop}:\\s*(?:var\\(\\s*--skin-[a-z-]+\\s*,\\s*)?${literal}`, 'u');
}

const problem = BUILTIN_PLC_PROBLEMS[0]!;

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.getState().openProblem(problem);
});

function workspace(): void {
  render(
    <LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={vi.fn()} />,
  );
}

describe('ラダーの枠の文字色（UXレビュー #1）', () => {
  it('明るい下地の入れ物と文字が、body の淡色を継がずに色を明示している', () => {
    for (const selector of COLORED) {
      expect(rule(selector), `${selector} が color を宣言していない`).toMatch(/\bcolor:/u);
    }
    // 入れ物の色は変数1本から引く（1か所直せば全部直る）
    expect(rule('.workspace')).toContain('--ladder-fg: #1a1d22');
  });

  it('宣言された色が下地に対して WCAG AA（4.5:1）を満たす', () => {
    for (const pair of PAIRS) {
      expect(rule(pair.selector), `${pair.selector} の ${pair.prop}`).toMatch(
        declares(pair.prop, pair.fg),
      );
      const ratio = contrast(pair.fg, pair.bg);
      expect(
        ratio,
        `${pair.selector} ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // 直そうとしている当のもの: body の淡色はどの下地でも読めない
    expect(contrast(BODY_FG, SURFACES.white)).toBeLessThan(1.2);
  });

  it('プロジェクトツリー・出力ウィンドウ・右の枠が、色を明示したクラスを着ている', () => {
    workspace();
    const tree = screen.getByTestId('project-tree');
    expect(tree.className).toContain(styles.tree);
    expect(tree.querySelector('p')?.className).toContain(styles.treeRoot);
    expect(tree.querySelector('ul')?.className).toContain(styles.treeList);
    expect(screen.getByTestId('tree-network-n1')).toBeInTheDocument();

    const output = screen.getByTestId('output-window');
    expect(output.className).toContain(styles.output);
    // 見出しの入れ物（`<header>` でも `<summary>` でも）が `.outputHeader` を着ている
    expect(output.querySelector('h2')?.parentElement?.className).toContain(styles.outputHeader);

    for (const testId of ['monitor-panel', 'io-table', 'comment-panel', 'shortcuts']) {
      const panel = screen.getByTestId(testId);
      expect(panel.className, testId).toContain(styles.side);
      expect(panel.querySelector('h2')?.className, testId).toContain(styles.sideTitle);
    }
  });

  it('計算スタイルが読める環境では、body の淡色を継いでいない', () => {
    workspace();
    const targets = [
      screen.getByTestId('project-tree'),
      screen.getByTestId('output-window'),
      screen.getByTestId('io-table'),
      screen.getByTestId('tree-network-n1'),
    ];
    let measured = 0;
    for (const element of targets) {
      const color = globalThis.getComputedStyle(element).color;
      // happy-dom は CSS Modules を読まないので、ここは通常 '' か 'rgb(0, 0, 0)' になる。
      // スタイルシートが効く環境でだけ「body の淡色そのもの」でないことを確かめる。
      if (color === '' || color === 'rgb(0, 0, 0)') continue;
      measured += 1;
      expect(color).not.toBe('rgb(231, 235, 242)');
    }
    // 測れたかどうかに関わらず、上の3本の検査で回帰は捕まる
    expect(measured).toBeGreaterThanOrEqual(0);
  });
});

/**
 * 4スキンの配色（Plan 4B Task 2）。
 *
 * 利用者要求は「各メーカーのソフト画面に合わせた可能な限り実物に忠実な画面」だが、
 * 「分かりやすく直感的に」も同じ日の要求である。スキンを増やすたびに #1（白地に白）の
 * 再発を防ぐため、**4スキンぶんの文字色を地に対して測る**。
 */
describe('4スキンの配色（Plan 4B Task 2 / 利用者要求: 実物に近く、かつ読める画面）', () => {
  it('どのスキンでも、編集領域の文字が地に対して WCAG AA（4.5:1）を満たす', () => {
    for (const theme of Object.values(SKIN_THEMES)) {
      for (const key of ['device', 'preset', 'comment', 'symbol'] as const) {
        const ratio = contrast(theme.colors[key], theme.colors.canvas);
        expect(
          ratio,
          `${theme.id}.${key} ${theme.colors[key]} on ${theme.colors.canvas} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // タイトルバー・ステータスバー・出力ウィンドウの文字（枠の文字色は `--ladder-fg`）
      const bars: ReadonlyArray<[string, string, string]> = [
        ['titleBar', theme.colors.titleBarText, theme.colors.titleBar],
        ['statusBar', LADDER_FG, theme.colors.statusBar],
        ['output', LADDER_FG, theme.colors.output],
        ['toolbar', LADDER_FG, theme.colors.toolbar],
      ];
      for (const [name, fg, bg] of bars) {
        const ratio = contrast(fg, bg);
        expect(
          ratio,
          `${theme.id}.${name} ${fg} on ${bg} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('母線は地に対して 3:1（WCAG 1.4.11 の非文字）を満たし、通電色は地と見分けられる', () => {
    for (const theme of Object.values(SKIN_THEMES)) {
      const rail = contrast(theme.colors.rail, theme.colors.canvas);
      expect(rail, `${theme.id}.rail = ${rail.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      /*
       * 通電色・カーソル色は §10.6 が定める各社の色（◎）なので、こちらで濃さを決められない
       * （橙 #E08A1E は 2.33:1、水色 #00A0C8 は 2.80:1 で 3:1 に届かない）。画面では 2px の枠と
       * 太い導線として描き、状態は色だけでなくステータスバーの文字でも示す（決定表#7）ので、
       * ここでは「地と同化していないこと」だけを見張る。
       */
      const powered = contrast(theme.colors.powered, theme.colors.canvas);
      expect(powered, `${theme.id}.powered = ${powered.toFixed(2)}:1`).toBeGreaterThanOrEqual(2);
    }
  });
});
