import { PLC_UNIT_FX5U } from '@ojt/board-model';
import { BUILTIN_PLC_PROBLEMS, resolvePlcIo } from '@ojt/content';
import {
  endNetwork,
  hline,
  IR_COLS,
  network,
  no,
  out,
  program,
  T,
  ton,
  X,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentPanel } from '../src/renderer/ladder/CommentPanel.js';
import { IoTable } from '../src/renderer/ladder/IoTable.js';

afterEach(cleanup);

function rung(...cells: Cell[]): Cell[] {
  const row = [...cells];
  const output = row.pop();
  if (output === undefined) throw new Error('出力セルが要ります');
  while (row.length < IR_COLS - 1) row.push(hline());
  row.push(output);
  return row;
}

const ladder = program(
  network('n1', [rung(no(X(0)), out(Y(0)))]),
  network('n2', [rung(no({ kind: 'input', index: 8 }), ton(T(0), 3000))]),
  endNetwork(),
);

describe('デバイスコメント欄（§10.7）', () => {
  it('lists every device the ladder uses in the dialect notation', () => {
    render(
      <CommentPanel
        program={ladder}
        profile={MITSUBISHI_FX5U}
        comments={{}}
        onChange={() => undefined}
      />,
    );
    // X8 は三菱表記で X10
    expect(screen.getByTestId('comment-X0')).toBeInTheDocument();
    expect(screen.getByTestId('comment-X8')).toHaveTextContent('X10');
    expect(screen.getByTestId('comment-Y0')).toBeInTheDocument();
    expect(screen.getByTestId('comment-T0')).toBeInTheDocument();
  });

  it('keys the comment on the vendor-neutral label (§10.7)', () => {
    const onChange = vi.fn();
    render(
      <CommentPanel program={ladder} profile={MITSUBISHI_FX5U} comments={{}} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId('comment-input-X8'), { target: { value: '停止' } });
    expect(onChange).toHaveBeenCalledWith('X8', '停止');
  });

  it('shows the comment that is already stored', () => {
    render(
      <CommentPanel
        program={ladder}
        profile={MITSUBISHI_FX5U}
        comments={{ X0: '運転押ボタン' }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('comment-input-X0')).toHaveValue('運転押ボタン');
  });

  it('warns when the comment cap is reached', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 200; i += 1) many[`M${String(i)}`] = 'x';
    render(
      <CommentPanel
        program={ladder}
        profile={MITSUBISHI_FX5U}
        comments={many}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('comment-cap')).toHaveTextContent('200');
  });

  it('disables the input and describes it with the cap note instead of toasting (Batch 3 レビュー M1/M8)', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 200; i += 1) many[`M${String(i)}`] = 'x';
    render(
      <CommentPanel
        program={ladder}
        profile={MITSUBISHI_FX5U}
        comments={many}
        onChange={() => false}
      />,
    );
    const input = screen.getByTestId('comment-input-X0');
    expect(input).toBeDisabled();
    expect(input).toHaveAccessibleDescription(screen.getByTestId('comment-cap').textContent ?? '');
  });
});

describe('I/Oテーブル（§7.6 / 決定表#7 / #16）', () => {
  const problem = BUILTIN_PLC_PROBLEMS[0]!;
  const io = resolvePlcIo(problem.io);
  const unit = PLC_UNIT_FX5U;

  it('lists the assignment the problem gives', () => {
    render(<IoTable io={io} profile={MITSUBISHI_FX5U} unit={unit} />);
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('X0');
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('PB1');
    expect(screen.getByTestId('io-output-0')).toHaveTextContent('Y0');
    expect(screen.getByTestId('io-output-0')).toHaveTextContent('CR1');
    expect(screen.getByTestId('io-output-0')).toHaveTextContent('PL1');
  });

  it('takes the terminal name from the unit spec, not from the decimal index (決定表#16)', () => {
    const wide = {
      ...io,
      inputs: [{ x: 10, pb: 'PB1' as const }],
      outputs: [{ y: 8, cr: 'CR1' as const, pl: 'PL1' as const }],
    };
    render(<IoTable io={wide} profile={MITSUBISHI_FX5U} unit={unit} />);
    // IR の 10 番目の入力は FX5U の端子 X12、8 番目の出力は Y10（どちらも8進）
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('PLC.X12');
    expect(screen.getByTestId('io-output-0')).toHaveTextContent('PLC.Y10');
  });

  it('says whether the assignment is fixed or a suggestion', () => {
    render(<IoTable io={{ ...io, mode: 'fixed' }} profile={MITSUBISHI_FX5U} unit={unit} />);
    expect(screen.getByTestId('io-mode')).toHaveTextContent('この割付どおり');
  });

  it('names the common wiring style (§10.2)', () => {
    render(<IoTable io={{ ...io, wiring: 'sink' }} profile={MITSUBISHI_FX5U} unit={unit} />);
    expect(screen.getByTestId('io-wiring')).toHaveTextContent('シンク');
  });

  it('never says whether the trainee has wired it (決定表#7)', () => {
    const { container } = render(<IoTable io={io} profile={MITSUBISHI_FX5U} unit={unit} />);
    for (const forbidden of ['未配線', '配線済', '直結', '2段']) {
      expect(container.textContent ?? '').not.toContain(forbidden);
    }
  });

  it('names its columns with scope="col" (Batch 3 レビュー M8)', () => {
    render(<IoTable io={io} profile={MITSUBISHI_FX5U} unit={unit} />);
    const headers = screen.getByTestId('io-table').querySelectorAll('thead th[scope="col"]');
    expect(headers.length).toBe(3);
  });

  it('shows a dash and a note instead of a bare "PLC." when the assignment indexes past the unit (M3)', () => {
    const outOfRange = { ...io, inputs: [{ x: 999, pb: 'PB1' as const }] };
    render(<IoTable io={outOfRange} profile={MITSUBISHI_FX5U} unit={unit} />);
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('—');
    expect(screen.getByTestId('io-input-0')).not.toHaveTextContent('PLC.');
    expect(screen.getByTestId('io-terminal-note')).toBeInTheDocument();
  });
});
