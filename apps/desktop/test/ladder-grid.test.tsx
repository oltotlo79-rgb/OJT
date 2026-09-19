import {
  COIL_COL,
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
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
import { LadderGrid } from '../src/renderer/ladder/LadderGrid.js';
import { CELL_H, CELL_W, WIRE_Y } from '../src/renderer/ladder/symbols.js';
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
  cursor: { networkId: 'n1', row: 0, col: 0 },
  mode: 'write' as const,
  comments: {},
  errorCells: new Set<string>(),
  gridCols: MITSUBISHI_FX5U.gridCols,
  onPickCell: () => undefined,
};

describe('LadderGrid（§10.7）', () => {
  it('draws every network with its id, comment and END', () => {
    render(<LadderGrid program={sample()} {...base} />);
    expect(screen.getByTestId('network-n1')).toHaveTextContent('n1');
    expect(screen.getByTestId('network-n1')).toHaveTextContent('運転');
    expect(screen.getByTestId('network-end')).toBeInTheDocument();
    expect(screen.getByTestId('cell-end:0:0')).toBeInTheDocument();
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
    render(<LadderGrid program={sample()} {...base} comments={{ X0: '運転押ボタン' }} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveTextContent('運転押ボタン');
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

  it('groups each row under role="row" under the grid (I4)', () => {
    render(<LadderGrid program={sample()} {...base} />);
    const grid = screen.getByRole('grid', { name: /n1/u });
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
    expect(d.startsWith(`M ${String(CELL_W)} ${String(WIRE_Y)} `)).toBe(true);
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
});
