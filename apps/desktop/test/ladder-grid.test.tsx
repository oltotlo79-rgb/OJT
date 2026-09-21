import {
  C,
  COIL_COL,
  ctu,
  empty,
  endNetwork,
  hline,
  IR_COLS,
  nc,
  network,
  no,
  out,
  program,
  ton,
  T,
  X,
  Y,
  type LadderProgram,
} from '@ojt/ladder-core';
import { MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300 } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
import { LadderGrid } from '../src/renderer/ladder/LadderGrid.js';
import { skinThemeOf } from '../src/renderer/ladder/skins/index.js';
import { CELL_H, CELL_W, symbolMetrics, WIRE_Y } from '../src/renderer/ladder/symbols.js';
import { applyOrContact } from '../src/renderer/session/ladder.js';

// このリポジトリの UI テストの流儀（`globals: false` なので自動クリーンアップは効かない）。
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.setState({ plcMonitor: undefined });
});

/** モニタのスナップショット（`powered` だけ差し替え、他は使わないので固定値）。D1 */
function monitorSnapshot(powered: Record<string, string>): PlcMonitorSnapshot {
  return {
    scanCount: 0,
    tMs: 0,
    powered,
    inputs: [],
    outputs: [],
    internals: {},
    timers: {},
    counters: {},
  };
}

function sample(): LadderProgram {
  return program(
    network('n1', [[no(X(0)), hline(), ...Array.from({ length: 13 }, () => hline()), out(Y(0))]], {
      comment: '運転',
    }),
    // コイル列（15列目）に TON が来るよう、間を横線で埋める（テストが `cell-n2:0:15` を引く）
    network('n2', [[nc(X(1)), ...Array.from({ length: 14 }, () => hline()), ton(T(0), 3000)]]),
    endNetwork(),
  );
}

/** 1ネットワークぶんの通電文字列（全セル非通電）。 */
function offBits(rows: number): string {
  return '0'.repeat(rows * IR_COLS);
}

const base = {
  profile: MITSUBISHI_FX5U,
  // 見た目（セル寸法・コメント行数）はスキンが持つ（Plan 4B Task 4。決定表#6）
  theme: skinThemeOf(MITSUBISHI_FX5U),
  cursor: { networkId: 'n1', row: 0, col: 0 },
  mode: 'write' as const,
  comments: {},
  errorCells: new Set<string>(),
  gridCols: MITSUBISHI_FX5U.gridCols,
  onPickCell: () => undefined,
};

describe('スキンの寸法（利用者要求: 実物に近い画面）', () => {
  it('sizes the cells from the skin', () => {
    render(
      <LadderGrid
        program={sample()}
        {...base}
        profile={OMRON_CP1E}
        theme={skinThemeOf(OMRON_CP1E)}
        gridCols={OMRON_CP1E.gridCols}
      />,
    );
    const svg = screen.getByRole('grid', { name: '回路 1' });
    // OMRON は 52×48（I/Oコメント2行ぶん背が高い）。接点11列＋コイル列1
    // ＋左母線3px＋右母線2px＋行番号欄24px（利用者要求 2026-09-20 2回目で母線と欄を細くした）
    expect(svg.getAttribute('height')).toBe('48');
    expect(Number(svg.getAttribute('width'))).toBe(24 + 3 + 12 * 52 + 2);
  });

  it('shows two comment lines in the CX-Programmer style and one elsewhere', () => {
    const comments = { X0: 'とても長いデバイスコメントの例です' };
    render(
      <LadderGrid
        program={sample()}
        {...base}
        profile={OMRON_CP1E}
        theme={skinThemeOf(OMRON_CP1E)}
        gridCols={OMRON_CP1E.gridCols}
        comments={comments}
      />,
    );
    const lines = screen.getAllByTestId(/^comment-line-/u);
    expect(lines).toHaveLength(2);
    // 「テストが不足」レビュー指摘: 2行目そのもの（`comment-line-1`）が実在すること
    expect(screen.getByTestId('comment-line-0')).toBeInTheDocument();
    expect(screen.getByTestId('comment-line-1')).toBeInTheDocument();
    cleanup();
    render(<LadderGrid program={sample()} {...base} comments={comments} />);
    expect(screen.getAllByTestId(/^comment-line-/u)).toHaveLength(1);
  });

  /** レビュー I3: `K5` のような三菱綴りを固定で出していたので、OMRON の `#0005` を確かめる。 */
  it('spells the counter preset in the dialect notation (I3)', () => {
    const withCounter = program(
      network('n1', [[no(X(0)), ...Array.from({ length: 14 }, () => hline()), ctu(C(0), 5, X(1))]]),
      endNetwork(),
    );
    render(
      <LadderGrid
        program={withCounter}
        {...base}
        profile={OMRON_CP1E}
        theme={skinThemeOf(OMRON_CP1E)}
        gridCols={OMRON_CP1E.gridCols}
      />,
    );
    expect(screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).toHaveTextContent('#0005');
  });

  /**
   * レビュー I5 の書き直し（2026-09-20）。OMRON のタイマは**命令ボックス**になったので、
   * 設定値は箱の中の3行目に入り、コメントとぶつかりようがない（箱のセルはコメントを出さない）。
   */
  it('puts the OMRON timer preset inside the instruction box, with no comment to collide with', () => {
    render(
      <LadderGrid
        program={sample()}
        {...base}
        profile={OMRON_CP1E}
        theme={skinThemeOf(OMRON_CP1E)}
        gridCols={OMRON_CP1E.gridCols}
        comments={{ T0: 'タイマの説明コメントです' }}
      />,
    );
    const cell = screen.getByTestId(`cell-n2:0:${String(COIL_COL)}`);
    // 1行目＝命令語（`TIM`）、2行目＝デバイス、3行目＝設定値
    expect(within(cell).getByTestId('box-line-0')).toHaveTextContent(
      OMRON_CP1E.instructionNames.timer,
    );
    const boxTop = Number(within(cell).getByTestId('box-line-0').getAttribute('y'));
    const presetY = Number(within(cell).getByTestId('preset-text').getAttribute('y'));
    expect(presetY).toBeGreaterThan(boxTop);
    expect(within(cell).queryByTestId('comment-line-0')).toBeNull();
  });
});

describe('LadderGrid（§10.7）', () => {
  it('draws every network with its id, comment and END', () => {
    render(<LadderGrid program={sample()} {...base} />);
    expect(screen.getByTestId('network-n1')).toHaveTextContent('回路 1');
    expect(screen.getByTestId('network-n1')).toHaveTextContent('運転');
    expect(screen.getByTestId('network-end')).toBeInTheDocument();
    expect(screen.getByTestId('cell-end:0:0')).toBeInTheDocument();
    // END はふつうの回路と同じく**出力列**に出る（利用者要求 2026-09-20「END行の縦線2本は何？」）
    expect(screen.getByTestId(`cell-end:0:${String(COIL_COL)}`)).toHaveTextContent(
      MITSUBISHI_FX5U.instructionNames.end,
    );
  });

  it('shows the contact columns of the skin plus one coil column (§10.6)', () => {
    render(<LadderGrid program={sample()} {...base} />);
    expect(
      screen.getByTestId(`cell-n1:0:${String(MITSUBISHI_FX5U.gridCols - 1)}`),
    ).toBeInTheDocument();
    // 表示しない中間列（11〜14）は描かない
    expect(screen.queryByTestId(`cell-n1:0:${String(MITSUBISHI_FX5U.gridCols)}`)).toBeNull();
    // コイル列は必ず最後に出る
    expect(screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).toBeInTheDocument();
  });

  it('warns when a cell sits in a column the skin does not show', () => {
    const wide = program(
      network('n1', [
        [
          no(X(0)),
          ...Array.from({ length: 11 }, () => hline()),
          no(X(1)),
          hline(),
          hline(),
          out(Y(0)),
        ],
      ]),
      endNetwork(),
    );
    render(<LadderGrid program={wide} {...base} />);
    expect(screen.getByTestId('hidden-cells-n1')).toHaveTextContent('表示列数');
  });

  it('writes the dialect device name and the preset', () => {
    render(<LadderGrid program={sample()} {...base} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveTextContent('X0');
    expect(screen.getByTestId(`cell-n2:0:${String(COIL_COL)}`)).toHaveTextContent('T0');
    // 三菱の T0 帯は 100ms 単位なので 3000ms は K30
    expect(screen.getByTestId(`cell-n2:0:${String(COIL_COL)}`)).toHaveTextContent('K30');
  });

  it('writes the device comment under the symbol (§10.7)', () => {
    render(<LadderGrid program={sample()} {...base} comments={{ X0: '運転' }} />);
    const cell = screen.getByTestId('cell-n1:0:0');
    expect(cell).toHaveTextContent('運転');
    // コメントは記号（縦棒の下端）より下に出る
    const metrics = symbolMetrics(skinThemeOf(MITSUBISHI_FX5U).cell);
    expect(Number(within(cell).getByTestId('comment-line-0').getAttribute('y'))).toBeGreaterThan(
      metrics.barBottom,
    );
  });

  /** セル幅に入りきらないコメントは末尾を `…` にして、隣のセルへはみ出さない。 */
  it('truncates a comment that does not fit the cell width', () => {
    render(<LadderGrid program={sample()} {...base} comments={{ X0: '運転押ボタン' }} />);
    const line = within(screen.getByTestId('cell-n1:0:0')).getByTestId('comment-line-0');
    expect(line.textContent).toHaveLength(
      symbolMetrics(skinThemeOf(MITSUBISHI_FX5U).cell).commentChars,
    );
    expect(line.textContent?.endsWith('…')).toBe(true);
  });

  it('marks the cursor cell and moves it on click', () => {
    const onPickCell = vi.fn();
    render(<LadderGrid program={sample()} {...base} onPickCell={onPickCell} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByTestId('cell-n1:0:1'));
    expect(onPickCell).toHaveBeenCalledWith({ networkId: 'n1', row: 0, col: 1 });
  });

  it('outlines the cells a conversion error points at', () => {
    render(<LadderGrid program={sample()} {...base} errorCells={new Set(['n1:0:0'])} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-error', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('data-error', 'false');
  });

  it('paints the energised leads while monitoring (決定表#5)', () => {
    const bits = offBits(1).split('');
    bits[0] = '1'; // X0 の左（左母線）は常に通電
    bits[1] = '1'; // X0 が閉じているので右も通電
    useStore.setState({ plcMonitor: monitorSnapshot({ n1: bits.join(''), n2: offBits(1) }) });
    render(<LadderGrid program={sample()} {...base} mode="monitor" />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-powered', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('data-powered', 'true');
    expect(screen.getByTestId('cell-n2:0:0')).toHaveAttribute('data-powered', 'false');
  });

  /** Batch 4+5 レビュー M15: 設定画面のモニタ色が方言の既定色を上書きする。 */
  it('uses the store monitorColor setting to recolour a powered cell (M15)', () => {
    const bits = offBits(1).split('');
    bits[0] = '1';
    bits[1] = '1';
    useStore.setState({
      plcMonitor: monitorSnapshot({ n1: bits.join(''), n2: offBits(1) }),
      monitorColor: '#FF00AA',
    });
    render(<LadderGrid program={sample()} {...base} mode="monitor" />);
    const path = screen.getByTestId('cell-n1:0:0').querySelector('path');
    expect(path).toHaveAttribute('stroke', '#FF00AA');
    useStore.setState({ monitorColor: MITSUBISHI_FX5U.monitorColors.powered });
  });

  it('never paints an empty cell even though column 0 reports powered (3A レビュー指摘)', () => {
    const blank = program(network('n1', [[no(X(0))]]), endNetwork());
    // すべてのセルが通電しているという最悪の入力を渡す
    useStore.setState({ plcMonitor: monitorSnapshot({ n1: '1'.repeat(IR_COLS) }) });
    render(<LadderGrid program={blank} {...base} mode="monitor" />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-powered', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('data-powered', 'false');
    expect(screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).toHaveAttribute(
      'data-powered',
      'false',
    );
  });

  it('does not paint anything while not monitoring', () => {
    useStore.setState({ plcMonitor: monitorSnapshot({ n1: '1'.repeat(IR_COLS) }) });
    render(<LadderGrid program={sample()} {...base} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-powered', 'false');
  });

  it('re-renders only the network whose powered string changed (Batch 2 レビュー D1 / 決定表#5)', () => {
    useStore.setState({ plcMonitor: monitorSnapshot({ n1: offBits(1), n2: offBits(1) }) });
    render(<LadderGrid program={sample()} {...base} mode="monitor" />);
    const n1Before = screen.getByTestId('network-n1').getAttribute('data-render-count');
    const n2Before = screen.getByTestId('network-n2').getAttribute('data-render-count');
    // n2 だけ通電を変える。n1 は変わっていないので再描画されない（`memo` は無関係。
    // `NetworkView` 自身がネットワークごとに `plcMonitor.powered[net.id]` を購読するため）
    act(() => {
      useStore.setState({
        plcMonitor: monitorSnapshot({ n1: offBits(1), n2: '1'.repeat(IR_COLS) }),
      });
    });
    expect(screen.getByTestId('network-n1').getAttribute('data-render-count')).toBe(n1Before);
    expect(screen.getByTestId('network-n2').getAttribute('data-render-count')).not.toBe(n2Before);
  });

  it('カーソルを1マス動かしても、選択が変わった2セル以外は再描画されない（指摘 LE-10）', () => {
    const counts = (): Record<string, string | null> =>
      Object.fromEntries(
        screen
          .getAllByRole('gridcell')
          .map((el) => [
            el.getAttribute('data-testid') ?? '',
            el.getAttribute('data-render-count'),
          ]),
      );
    // 同じプログラム・同じスキンのまま**カーソルだけ**動かす（実機の矢印キー1回ぶん）
    const p = sample();
    const view = render(
      <LadderGrid program={p} {...base} cursor={{ networkId: 'n1', row: 0, col: 0 }} />,
    );
    const before = counts();
    expect(Object.keys(before).length).toBeGreaterThan(20);
    view.rerender(
      <LadderGrid program={p} {...base} cursor={{ networkId: 'n1', row: 0, col: 1 }} />,
    );
    const after = counts();
    const changed = Object.keys(after).filter((key) => after[key] !== before[key]);
    expect(changed.sort()).toEqual(['cell-n1:0:0', 'cell-n1:0:1']);
    // 選択そのものは動いている
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('aria-selected', 'false');
  });

  it('カーソルが別ネットワークへ移っても、無関係なネットワークは再描画されない（指摘 LE-10）', () => {
    const p = sample();
    const view = render(
      <LadderGrid program={p} {...base} cursor={{ networkId: 'n1', row: 0, col: 0 }} />,
    );
    const endBefore = screen.getByTestId('network-end').getAttribute('data-render-count');
    const n1Before = screen.getByTestId('network-n1').getAttribute('data-render-count');
    view.rerender(
      <LadderGrid program={p} {...base} cursor={{ networkId: 'n2', row: 0, col: 0 }} />,
    );
    expect(screen.getByTestId('network-end').getAttribute('data-render-count')).toBe(endBefore);
    expect(screen.getByTestId('network-n1').getAttribute('data-render-count')).not.toBe(n1Before);
  });

  it('groups each row under role="row" under the grid (I4)', () => {
    render(<LadderGrid program={sample()} {...base} />);
    const grid = screen.getByRole('grid', { name: '回路 1' });
    const rows = within(grid).getAllByRole('row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getByTestId('cell-n1:0:0')).toBeInTheDocument();
  });

  it('draws the OR-branch link all the way down to the next row (B1)', () => {
    const start = sample();
    const applied = applyOrContact(start, { networkId: 'n1', row: 0, col: 0 }, no(X(1)));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    render(<LadderGrid program={applied.program} {...base} />);
    // 0列目のOR分岐は1列目に縦線（vline）を作る。§10.3 の `applyOrContact` の規則
    const vlineCell = screen.getByTestId('cell-n1:0:1');
    const paths = [...vlineCell.querySelectorAll('path')];
    const linkDown = paths.find((path) => path.getAttribute('d')?.endsWith(`0 ${CELL_H + WIRE_Y}`));
    expect(linkDown).toBeDefined();
  });

  it('does not warn when only rule lines (hline/vline) sit in a hidden column (I9 negative case)', () => {
    const narrow = program(
      network('n1', [[no(X(0)), hline(), ...Array.from({ length: 13 }, () => hline()), out(Y(0))]]),
      endNetwork(),
    );
    render(<LadderGrid program={narrow} {...base} gridCols={2} />);
    expect(screen.queryByTestId('hidden-cells-n1')).toBeNull();
  });

  /**
   * コイルの自動結線（`applyLadderCell()`）で 11〜14 列目が横線になった行は、画面には出ない。
   * 最後の接点列からコイルの記号まで桟を1本重ねて、回路が切れていないことを見せる。§10.6
   */
  it('draws the rung across the hidden columns and into the coil column', () => {
    const filled = program(
      network('n1', [[no(X(0)), ...Array.from({ length: 14 }, () => hline()), out(Y(0))]]),
      endNetwork(),
    );
    render(<LadderGrid program={filled} {...base} gridCols={2} />);
    const d = screen.getByTestId('rung-to-coil-n1:0').getAttribute('d') ?? '';
    const endX = Number(/L ([\d.]+) /u.exec(d)?.[1] ?? '0');
    // 表示は「接点2列＋コイル列」。コイル列の左端は 2 × CELL_W なので、そこを越えて届いている
    expect(endX).toBeGreaterThan(2 * CELL_W);
    // 始点はコイル列の左端（2 × CELL_W）。最後の接点セル（1列目）の中を通らない（レビュー指摘 #1）
    expect(d.startsWith(`M ${String(2 * CELL_W)} ${String(WIRE_Y)} `)).toBe(true);
  });

  it('draws no continuation when a hidden column is empty or nothing is hidden', () => {
    const broken = program(
      network('n1', [[no(X(0)), hline(), hline(), ...Array.from({ length: 12 }, () => empty())]]),
      endNetwork(),
    );
    render(<LadderGrid program={broken} {...base} gridCols={2} />);
    expect(screen.queryByTestId('rung-to-coil-n1:0')).toBeNull();
    cleanup();
    render(<LadderGrid program={sample()} {...base} gridCols={COIL_COL} />);
    expect(screen.queryByTestId('rung-to-coil-n1:0')).toBeNull();
  });

  /** レビュー指摘 #1: オーバーレイの始点はコイル列の左端（col8 の x）で、col7 のセルを横切らない。 */
  it('starts the hidden-column overlay at the coil column, not inside the last visible contact cell', () => {
    const filled = program(
      network('n1', [
        [
          no(X(0)),
          ...Array.from({ length: 6 }, () => hline()),
          no(X(1)), // col7: 最後に表示される接点
          ...Array.from({ length: 7 }, () => hline()), // col8〜14: 隠れる列
          out(Y(0)), // col15: コイル列
        ],
      ]),
      endNetwork(),
    );
    render(<LadderGrid program={filled} {...base} gridCols={8} />);
    const d = screen.getByTestId('rung-to-coil-n1:0').getAttribute('d') ?? '';
    // col8 の x（= (col7 + 1) × CELL_W）から始まり、col7 の範囲 [7*CELL_W, 8*CELL_W) には入らない
    expect(d.startsWith(`M ${String(8 * CELL_W)} ${String(WIRE_Y)} `)).toBe(true);
  });

  /** レビュー指摘 #1: 最後に見えるセルが空なら、隠れた列が罫線でも「切れている」まま重ねない。 */
  it('draws no overlay when the last visible cell is empty', () => {
    const gapped = program(
      network('n1', [[no(X(0)), empty(), ...Array.from({ length: 13 }, () => hline()), out(Y(0))]]),
      endNetwork(),
    );
    render(<LadderGrid program={gapped} {...base} gridCols={2} />);
    expect(screen.queryByTestId('rung-to-coil-n1:0')).toBeNull();
  });
});

/**
 * Phase 7 Task 21: 未変換の見え方（設計 §5.4）と、出力の無い回路ブロックの印（§5.2 の S4）。
 * どちらも**方言IDでは分岐せず**、「変換」の段を持つか（`convertStep`）だけで決まる。
 */
describe('未変換と未完成の見え方（Phase 7 設計 §5.2 / §5.4）', () => {
  /** 接点だけを置いた（出力の無い）回路ブロック。 */
  function unfinished(): LadderProgram {
    return program(network('n1', [[no(X(0))]]), endNetwork());
  }

  it('greys the unconverted networks in the dialects that have a convert step (三菱・シャープ)', () => {
    for (const profile of [MITSUBISHI_FX5U, SHARP_JW300]) {
      cleanup();
      render(
        <LadderGrid
          {...base}
          program={sample()}
          profile={profile}
          theme={skinThemeOf(profile)}
          gridCols={profile.gridCols}
          unconverted
        />,
      );
      const net = screen.getByTestId('network-n1');
      expect(net, profile.id).toHaveAttribute('data-unconverted', 'true');
      // 灰色はスキンの `--skin-unconverted`（地の色だけを差し替え、格子線は残す）
      expect(net.getAttribute('style') ?? '', profile.id).toContain('var(--skin-unconverted)');
    }
  });

  it('drops the grey once the convert step has passed', () => {
    render(<LadderGrid {...base} program={sample()} unconverted={false} />);
    const net = screen.getByTestId('network-n1');
    expect(net).not.toHaveAttribute('data-unconverted');
    expect(net.getAttribute('style') ?? '').not.toContain('--skin-unconverted');
  });

  it('draws the red line at the right edge of a network with no output (OMRON)', () => {
    render(
      <LadderGrid
        {...base}
        program={unfinished()}
        profile={OMRON_CP1E}
        theme={skinThemeOf(OMRON_CP1E)}
        gridCols={OMRON_CP1E.gridCols}
      />,
    );
    expect(screen.getByTestId('no-output-n1')).toBeInTheDocument();
    expect(screen.getByTestId('no-output-n1')).toHaveAccessibleName('出力がありません');
    // END の回路ブロックは END そのものが出力なので出ない
    expect(screen.queryByTestId('no-output-end')).toBeNull();
  });

  it('drops the red line as soon as the network has an output (OMRON)', () => {
    render(
      <LadderGrid
        {...base}
        program={sample()}
        profile={OMRON_CP1E}
        theme={skinThemeOf(OMRON_CP1E)}
        gridCols={OMRON_CP1E.gridCols}
      />,
    );
    expect(screen.queryByTestId('no-output-n1')).toBeNull();
  });

  it('never draws the red line in the dialects that have a convert step (三菱)', () => {
    render(<LadderGrid {...base} program={unfinished()} />);
    expect(screen.queryByTestId('no-output-n1')).toBeNull();
  });
});

// --- Phase 7 Task 22（色だけに頼らない通電表示。設計 §5.5 / 指摘 UX-14 ≡ UI-17） ---
describe('通電の手がかりは色だけではない（指摘 UX-14 ≡ UI-17）', () => {
  /** 1行目の X0 が閉じて左右とも通電している状態。 */
  function energised(): void {
    const bits = offBits(1).split('');
    bits[0] = '1';
    bits[1] = '1';
    useStore.setState({ plcMonitor: monitorSnapshot({ n1: bits.join(''), n2: offBits(1) }) });
  }

  it('draws a thin solid outline over the energised cell in every skin', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300]) {
      cleanup();
      energised();
      render(
        <LadderGrid
          program={sample()}
          {...base}
          profile={profile}
          theme={skinThemeOf(profile)}
          mode="monitor"
        />,
      );
      const outline = within(screen.getByTestId('cell-n1:0:0')).getByTestId('powered-outline');
      // 枠は「ある／無い」で読める手がかりなので、塗りではなく線で描く
      expect(outline.tagName.toLowerCase(), profile.id).toBe('rect');
      expect(outline.getAttribute('width'), profile.id).not.toBe('0');
    }
  });

  it('puts no outline on a cell that is not energised, and none at all outside monitor mode', () => {
    energised();
    render(<LadderGrid program={sample()} {...base} mode="monitor" />);
    expect(within(screen.getByTestId('cell-n2:0:0')).queryByTestId('powered-outline')).toBeNull();
    cleanup();
    energised();
    render(<LadderGrid program={sample()} {...base} />);
    expect(screen.queryAllByTestId('powered-outline')).toHaveLength(0);
  });

  /**
   * GX Works3 風は帯（`block`）、ほかはパワーフロー（`flow`）だが、**枠はどちらにも付く**。
   * 帯を持たないスキンでも色以外の手がかりが残ることを確かめる。
   */
  it('keeps the outline on skins that have no powered block (flow style)', () => {
    energised();
    render(
      <LadderGrid
        program={sample()}
        {...base}
        profile={OMRON_CP1E}
        theme={skinThemeOf(OMRON_CP1E)}
        mode="monitor"
      />,
    );
    const cell = within(screen.getByTestId('cell-n1:0:0'));
    expect(cell.queryByTestId('powered-block')).toBeNull();
    expect(cell.getByTestId('powered-outline')).toBeInTheDocument();
  });
});
// --- /Phase 7 Task 22 ---
