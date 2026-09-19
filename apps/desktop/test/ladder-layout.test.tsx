import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { cleanup, render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';
import { CELL_W } from '../src/renderer/ladder/symbols.js';
import { PLC_VIEW_ASPECT } from '../src/renderer/three/camera.js';

/**
 * モードDの分割レイアウト（2026-09-19 UXレビュー #27 Important）。
 *
 * 直したのは3つ:
 *   1. 3Dペインを `PLC_VIEW_ASPECT` の箱ちょうどに収め、余った幅はラダーへ渡す
 *      （1920px でラダーの格子が 425px しか無く横スクロールしていた）
 *   2. 右の4枠（モニタ／I/O割付／デバイスコメント／キー割当）の `max-height: 200px` の
 *      入れ子スクロール4本を `<details>` の折りたたみ1列に置き換える
 *   3. 表を `table-layout: fixed` にして、狭い画面でも横にはみ出さないようにする
 *
 * 幅は CSS（`vw` / `vh`）が決めるので happy-dom では測れない。そこで CSS に書いた式を
 * ここで同じように計算し、**代表的な3つの画面サイズで格子に何 px 残るか**を数で縛る。
 * 実際の見た目はこの後のスクリーンショット確認に回す。
 */

function read(rel: string): string {
  for (const base of [process.cwd(), resolve(process.cwd(), 'apps/desktop')]) {
    const path = resolve(base, rel);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(`${rel} が見つからない（cwd: ${process.cwd()}）`);
}

/** コメントを落とす（「以前は `max-height: 200px` だった」と書いた注釈まで拾わないように）。 */
function declarations(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '');
}

const LADDER_CSS = declarations(read('src/renderer/ladder/ladder.module.css'));
const SCREENS_CSS = declarations(read('src/renderer/screens/screens.module.css'));

/* --- CSS に書いた寸法（変えたら両方を直す） --- */
/** `.plcLayout` の左右パディング＋列間ギャップ2本。 */
const LAYOUT_GUTTERS = 8 * 2 + 8 * 2;
/** 右の縦列（課題・部品・ログ）。 */
const RIGHT_COL = 300;
/** `--plc-chrome`: ツールバー＋手順帯＋上下パディング。 */
const CHROME = 96;
/** `--plc-board-max`（32vw）と 3D の下限幅。 */
const BOARD_MAX_VW = 0.32;
const BOARD_MIN = 420;
/** `--ladder-side-w` / `--ladder-tree-w`（1600px 未満では列を下の帯へ回すので側は 0）。 */
const SIDE_W = 200;
const TREE_W = 140;
const TREE_W_NARROW = 116;
/** 1列に落ちる境界（利用者決定）。 */
const SINGLE_PANE_MAX = 1279;
/** `.gridScroll` の左右パディングと `LadderGrid` の母線・行番号欄。 */
const GRID_PAD = 8 * 2;
/** 左母線（3px）と右母線のぶんの余白（2px）。2026-09-20 2回目の作り直しで細くした。 */
const RAIL_W = 3;
const RIGHT_RAIL_SPAN = 2;
/** GX Works3風の行番号欄（`SkinCell.stepGutterPx`。2026-09-20 2回目で 26 → 24）。 */
const STEP_GUTTER = 24;

/** 既定（11列）の格子が横スクロールせずに収まるのに要る幅。コイル列ぶん1列足す。 */
function gridNeeded(cols: number): number {
  return (
    STEP_GUTTER +
    RAIL_W +
    (Math.min(Math.max(cols, 1), 15) + 1) * CELL_W +
    RIGHT_RAIL_SPAN +
    GRID_PAD
  );
}

/** `--plc-board-w` と同じ式。 */
function boardWidth(vw: number, vh: number): number {
  return Math.max(BOARD_MIN, Math.min(BOARD_MAX_VW * vw, PLC_VIEW_ASPECT * (vh - CHROME)));
}

/** 分割表示で、ラダーの**格子**に残る幅。 */
function gridWidth(vw: number, vh: number): number {
  const narrow = vw <= SINGLE_PANE_MAX;
  const lanes = vw - LAYOUT_GUTTERS + (narrow ? 16 : 0) - (narrow ? 0 : RIGHT_COL);
  // 1列に落ちた画面ではラダーが幅いっぱい（3Dは下の行）
  const workspace = (narrow ? vw - 16 : lanes - boardWidth(vw, vh)) - 1;
  // 1600px 未満は折りたたみ列を編集画面の下の帯へ回すので、横には取られない
  const side = vw < 1600 ? 0 : SIDE_W;
  const tree = vw < 1600 ? TREE_W_NARROW : TREE_W;
  return workspace - tree - side;
}

/** 直す前の式（`minmax(520px, 1fr) minmax(420px, 1fr) 300px` ＋ 固定 148/210px）。 */
function gridWidthBefore(vw: number): number {
  const lanes = vw - LAYOUT_GUTTERS - RIGHT_COL;
  return lanes / 2 - 1 - 148 - 210;
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

describe('折りたたみ列（UXレビュー #27）', () => {
  it('右の4枠が <details> の折りたたみになっている', () => {
    workspace();
    for (const testId of ['monitor-panel', 'io-table', 'comment-panel', 'shortcuts']) {
      const panel = screen.getByTestId(testId);
      expect(panel.querySelectorAll('details').length, testId).toBe(1);
      expect(panel.querySelectorAll('summary').length, testId).toBe(1);
    }
  });

  it('作業中いつでも要る枠だけ開いた状態で始まる', () => {
    workspace();
    // モニタは E2E（`monitor-scan` の表示待ち）も開いている前提。I/O割付は配線の手引き
    for (const testId of ['monitor-panel-details', 'io-table-details']) {
      expect(screen.getByTestId(testId), testId).toHaveAttribute('open');
    }
    // 必要になってから開く枠
    for (const testId of ['comment-panel-details', 'shortcuts-details']) {
      expect(screen.getByTestId(testId), testId).not.toHaveAttribute('open');
    }
  });

  it('出力ウィンドウも畳めるが、既定は開いたまま', () => {
    workspace();
    expect(screen.getByTestId('output-details')).toHaveAttribute('open');
    expect(screen.getByTestId('output-summary')).toBeInTheDocument();
    // 変換の合否は見出しに出たまま（畳んでも見える）
    expect(screen.getByTestId('output-summary')).toContainElement(
      screen.getByTestId('convert-state'),
    );
  });

  it('入れ子のスクロールを消し、列ごと1本にした', () => {
    // 4枠それぞれの `max-height: 200px` を外した
    expect(LADDER_CSS).not.toMatch(/max-height:\s*200px/u);
    // 縦スクロールは列に1本だけ。横には絶対に伸ばさない
    expect(LADDER_CSS).toMatch(/\.workspaceSide\s*\{[^}]*overflow-x:\s*hidden/u);
    expect(LADDER_CSS).toMatch(/\.workspaceSide\s*\{[^}]*overflow-y:\s*auto/u);
  });

  it('表は列の幅に収める（狭い画面で横にはみ出さない）', () => {
    expect(LADDER_CSS).toMatch(/\.ioTable\s*\{[^}]*table-layout:\s*fixed/u);
    expect(LADDER_CSS).toMatch(/overflow-wrap:\s*anywhere/u);
    // 「用途」列はいちばん広い3列目に置き、1・2列目を割合で固定する
    expect(LADDER_CSS).toContain('.ioTable th:first-child');
    expect(LADDER_CSS).toContain('.shortcutTable th:first-child');
  });
});

describe('分割レイアウトの列（UXレビュー #27）', () => {
  it('格子に幅を渡す3列になっている', () => {
    expect(LADDER_CSS).toMatch(
      /\.workspaceBody\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) var\(--ladder-side-w\)/u,
    );
    // ツリーは中身なりの幅だが、長い回路コメントで押し広げられないよう上限を置く
    expect(LADDER_CSS).toMatch(/\.tree\s*\{[^}]*max-width:\s*var\(--ladder-tree-w\)/u);
  });

  it('3Dペインの想定縦横比が camera.ts の PLC_VIEW_ASPECT と一致している', () => {
    expect(SCREENS_CSS).toContain(`--plc-aspect: ${String(PLC_VIEW_ASPECT)}`);
    expect(SCREENS_CSS).toContain(`--plc-chrome: ${String(CHROME)}px`);
    expect(SCREENS_CSS).toContain(`--plc-board-max: ${String(BOARD_MAX_VW * 100)}vw`);
    expect(SCREENS_CSS).toContain(`max(${String(BOARD_MIN)}px, min(var(--plc-board-max)`);
    expect(SCREENS_CSS).toMatch(
      /\.plcLayout\s*\{[^}]*grid-template-columns:\s*var\(--plc-board-w\) minmax\(0, 1fr\) 300px/u,
    );
    // 縦に伸ばしても中身は大きくならないので、比の箱に丸めて縦中央へ置く
    expect(SCREENS_CSS).toMatch(
      /\[data-view='split'\] > \.viewport\s*\{[^}]*max-height:\s*calc\(var\(--plc-board-w\) \/ var\(--plc-aspect\)\)/u,
    );
  });

  it('1列に落ちたときも盤が見える（ラダーが上・3Dが下）', () => {
    const narrow = SCREENS_CSS.slice(
      SCREENS_CSS.indexOf(`@media (max-width: ${SINGLE_PANE_MAX}px)`),
    );
    expect(narrow).not.toMatch(/\[data-view='split'\] > \.viewport\s*\{[^}]*display:\s*none/u);
    // `.viewport` の既定は `grid-row: 1`。ラダーを先に置くため2行目へ動かす
    expect(narrow).toMatch(/\[data-view='split'\] > \.viewport\s*\{[^}]*grid-row:\s*2/u);
    // ラダーと3Dがそれぞれ自分の高さを持つ
    expect(narrow).toMatch(
      /\.plcLayout\[data-view='split'\]\s*\{[^}]*grid-template-rows:\s*clamp\([^)]*\) clamp\([^)]*\) auto/u,
    );
    // 3行ぶんの高さが1列に伸びるので、ここだけ縦スクロールにする
    expect(narrow).toMatch(/overflow-y:\s*auto/u);
  });

  it('代表的な画面サイズで格子に残る幅（スクリーンショット確認の目標値）', () => {
    const need = gridNeeded(11);
    // 12列（接点11＋コイル1）で 621px。1920×1080 の格子 633px に収まる
    expect(need).toBe(621);
    expect(need).toBeLessThanOrEqual(633);

    // 1920×1080: 3D 614px / ラダー枠 974px / 格子 633px → 横スクロールなし
    expect(Math.round(boardWidth(1920, 1080))).toBe(614);
    expect(Math.round(gridWidth(1920, 1080))).toBe(633);
    expect(gridWidth(1920, 1080)).toBeGreaterThanOrEqual(need);

    // 1440×900: 3D 461px / 格子 530px（4列ぶん足りないが、直す前の 195px から 2.7 倍）
    expect(Math.round(boardWidth(1440, 900))).toBe(461);
    expect(Math.round(gridWidth(1440, 900))).toBe(530);

    // 1280×800（分割の下限。1279px 以下は1列）: 3D 420px / 格子 411px
    expect(Math.round(boardWidth(1280, 800))).toBe(420);
    expect(Math.round(gridWidth(1280, 800))).toBe(411);

    // 1279×800（1列。ラダーが幅いっぱい）: 格子 1146px → 横スクロールなし
    expect(Math.round(gridWidth(1279, 800))).toBe(1146);
    expect(gridWidth(1279, 800)).toBeGreaterThanOrEqual(need);

    // どの幅でも直す前より広い（1920 で 435px → 633px、1280 で 66px → 411px）
    for (const [vw, vh] of [
      [1920, 1080],
      [1440, 900],
      [1280, 800],
    ] as const) {
      expect(gridWidth(vw, vh), `${String(vw)}×${String(vh)}`).toBeGreaterThan(gridWidthBefore(vw));
    }
  });
});
