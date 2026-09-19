import {
  COIL_COL,
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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LadderGrid } from '../src/renderer/ladder/LadderGrid.js';

// このリポジトリの UI テストの流儀（`globals: false` なので自動クリーンアップは効かない）。
afterEach(() => {
  cleanup();
});

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
  powered: undefined,
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
    render(
      <LadderGrid
        program={sample()}
        {...base}
        mode="monitor"
        powered={{ n1: bits.join(''), n2: offBits(1) }}
      />,
    );
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-powered', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('data-powered', 'true');
    expect(screen.getByTestId('cell-n2:0:0')).toHaveAttribute('data-powered', 'false');
  });

  it('never paints an empty cell even though column 0 reports powered (3A レビュー指摘)', () => {
    const blank = program(network('n1', [[no(X(0))]]), endNetwork());
    // すべてのセルが通電しているという最悪の入力を渡す
    render(
      <LadderGrid program={blank} {...base} mode="monitor" powered={{ n1: '1'.repeat(IR_COLS) }} />,
    );
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-powered', 'true');
    expect(screen.getByTestId('cell-n1:0:1')).toHaveAttribute('data-powered', 'false');
    expect(screen.getByTestId(`cell-n1:0:${String(COIL_COL)}`)).toHaveAttribute(
      'data-powered',
      'false',
    );
  });

  it('does not paint anything while not monitoring', () => {
    render(<LadderGrid program={sample()} {...base} powered={{ n1: '1'.repeat(IR_COLS) }} />);
    expect(screen.getByTestId('cell-n1:0:0')).toHaveAttribute('data-powered', 'false');
  });
});
