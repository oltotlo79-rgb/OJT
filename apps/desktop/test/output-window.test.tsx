import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputWindow } from '../src/renderer/ladder/OutputWindow.js';

const issues = {
  errors: [
    {
      source: 'structure' as const,
      code: 'coil-column',
      message: 'コイルは最終列に置きます',
      networkId: 'n1',
      row: 0,
      col: 2,
    },
    {
      source: 'dialect' as const,
      code: 'device-range',
      message: 'X の番号が範囲外です',
      networkId: 'n1',
      row: 0,
      col: 0,
    },
    { source: 'structure' as const, code: 'missing-end', message: 'END がありません' },
  ],
  warnings: [
    {
      code: 'double-coil',
      message: 'Y0 のコイルが2回以上あります',
      networkId: 'n2',
      row: 0,
      col: 15,
    },
  ],
  usage: { reads: ['X0'], writes: ['Y0', 'M1'] },
  unused: { neverRead: ['M1'], neverWritten: [] },
};

afterEach(() => {
  cleanup();
});

describe('出力ウィンドウ（§10.6）', () => {
  it('lists structural errors first, then dialect errors, then warnings', () => {
    render(<OutputWindow issues={issues} converted={false} onJump={() => undefined} />);
    const rows = screen.getAllByTestId(/^output-row-/u);
    expect(rows).toHaveLength(4);
    // 構造エラーは渡された順（coil-column → missing-end）、そのあと機種エラー、最後に警告
    expect(rows[0]).toHaveTextContent('コイルは最終列');
    expect(rows[1]).toHaveTextContent('END がありません');
    expect(rows[2]).toHaveTextContent('X の番号が範囲外');
    expect(rows[3]).toHaveTextContent('二重コイル');
  });

  it('shows where each issue is', () => {
    render(<OutputWindow issues={issues} converted={false} onJump={() => undefined} />);
    expect(screen.getByTestId('output-row-0')).toHaveTextContent('n1');
    expect(screen.getByTestId('output-row-0')).toHaveTextContent('1 行');
    expect(screen.getByTestId('output-row-0')).toHaveTextContent('3 列');
  });

  it('jumps to the cell an issue points at, and does nothing for the rest', () => {
    const onJump = vi.fn();
    render(<OutputWindow issues={issues} converted={false} onJump={onJump} />);
    fireEvent.click(screen.getByTestId('output-row-0'));
    expect(onJump).toHaveBeenCalledWith({ networkId: 'n1', row: 0, col: 2 });
    // `missing-end` はセルを指していないので押しても動かない（決定表#4）
    fireEvent.click(screen.getByTestId('output-row-1'));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('output-row-1')).toBeDisabled();
  });

  it('shows the used devices and marks the unused ones (決定表#15b)', () => {
    render(
      <OutputWindow
        issues={{ errors: [], warnings: [], usage: issues.usage, unused: issues.unused }}
        converted
        onJump={() => undefined}
      />,
    );
    expect(screen.getByTestId('usage-reads')).toHaveTextContent('X0');
    expect(screen.getByTestId('usage-writes')).toHaveTextContent('Y0');
    expect(screen.getByTestId('usage-unused')).toHaveTextContent('M1');
    expect(screen.getByTestId('convert-state')).toHaveTextContent('変換に成功');
  });

  it('says the ladder still needs converting when it does', () => {
    render(
      <OutputWindow
        issues={{ errors: [], warnings: [], usage: undefined, unused: undefined }}
        converted={false}
        onJump={() => undefined}
      />,
    );
    expect(screen.getByTestId('convert-state')).toHaveTextContent('未変換');
  });
});
