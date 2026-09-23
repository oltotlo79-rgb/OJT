import { PLC_UNIT_CP1E, PLC_UNIT_FX5U, PLC_UNIT_JW300 } from '@ojt/board-model';
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
import { JTEKT_PC10G, MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300 } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentPanel } from '../src/renderer/ladder/CommentPanel.js';
import { IoTable } from '../src/renderer/ladder/IoTable.js';
import { ShortcutHelp } from '../src/renderer/ladder/ShortcutHelp.js';
import { WatchPanel } from '../src/renderer/ladder/WatchPanel.js';
import { useStore } from '../src/renderer/app/store.js';

afterEach(cleanup);
beforeEach(() => useStore.setState({ watchDevices: [] }));

// 既存の「I/Oテーブル」describe と同じ課題の割付を、方言・機種をまたいで使う（Task 5）。
const IO = resolvePlcIo(BUILTIN_PLC_PROBLEMS[0]!.io);

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

  it('always shows the wall-outlet note as a table caption (決定表#7 / Batch 4+5 レビュー B1)', () => {
    render(<IoTable io={io} profile={MITSUBISHI_FX5U} unit={unit} />);
    expect(screen.getByTestId('io-outlet-note')).toHaveTextContent('壁コンセント');
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

describe('キー割当表と端子名のスキン差（§10.6 / §10.1）', () => {
  it('drops the 変換 row where the skin has no convert step', () => {
    render(<ShortcutHelp profile={OMRON_CP1E} />);
    expect(screen.getByTestId('shortcut-convert')).toHaveTextContent('プログラムチェック');
    expect(screen.getByTestId('shortcuts-convert-note')).toHaveTextContent('変換');
    cleanup();
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.queryByTestId('shortcuts-convert-note')).toBeNull();
    expect(screen.getByTestId('shortcut-convert')).toHaveTextContent('F4');
  });

  it('marks the assumed key bindings of every skin (§17.1)', () => {
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, JTEKT_PC10G, SHARP_JW300]) {
      cleanup();
      render(<ShortcutHelp profile={profile} />);
      for (const entry of profile.shortcuts.filter((s) => !s.confirmed)) {
        expect(
          screen.getByTestId(`shortcut-${entry.action}`),
          `${profile.id}/${entry.action}`,
        ).toHaveTextContent('本アプリの表記です');
      }
    }
  });

  it('flags the whole key map as borrowed for skins that reuse the GX Works3 table (I7)', () => {
    for (const profile of [JTEKT_PC10G]) {
      cleanup();
      render(<ShortcutHelp profile={profile} />);
      expect(screen.getByTestId('shortcuts-keymap-note'), profile.id).toHaveTextContent(
        '割り当てていません',
      );
    }
    for (const profile of [MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300]) {
      cleanup();
      render(<ShortcutHelp profile={profile} />);
      expect(screen.queryByTestId('shortcuts-keymap-note'), profile.id).toBeNull();
    }
  });

  it('names the terminals of the model, not the Mitsubishi spelling (4A H-1)', () => {
    render(<IoTable io={IO} profile={OMRON_CP1E} unit={PLC_UNIT_CP1E} />);
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('PLC.0.00');
    cleanup();
    render(<IoTable io={IO} profile={SHARP_JW300} unit={PLC_UNIT_JW300} />);
    expect(screen.getByTestId('io-input-0')).toHaveTextContent('PLC.A0');
    expect(screen.getByTestId('io-common')).toHaveTextContent('COM.A');
  });
});

// --- Phase 7 Task 22（監視欄とデバイス一覧。設計 §5.5 / 指摘 UX-14） ---
describe('監視（ウォッチ）欄（設計 §5.5）', () => {
  afterEach(() => {
    useStore.setState({ plcMonitor: undefined });
  });

  it('shows nothing at all for a vendor that does not name a watch pane (PCwin風)', () => {
    expect(JTEKT_PC10G.panels.watch).toBeUndefined();
    const { container } = render(<WatchPanel profile={JTEKT_PC10G} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts empty and says so in words the trainee can act on', () => {
    render(<WatchPanel profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('watch-empty')).toHaveTextContent('まだ何も登録していません');
    expect(screen.queryByTestId('watch-table')).toBeNull();
  });

  it('puts a device into the table when the trainee adds it', () => {
    render(<WatchPanel profile={MITSUBISHI_FX5U} />);
    fireEvent.change(screen.getByTestId('watch-device'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('watch-add'));
    expect(screen.getByTestId('watch-row-X0')).toBeInTheDocument();
    expect(screen.queryByTestId('watch-empty')).toBeNull();
    // 打ち込んだ欄は空に戻る（続けて足せる）
    expect(screen.getByTestId('watch-device')).toHaveValue('');
  });

  it('reads the device in the vendor’s own spelling (三菱の X10 は IR の X8)', () => {
    render(<WatchPanel profile={MITSUBISHI_FX5U} />);
    fireEvent.change(screen.getByTestId('watch-device'), { target: { value: 'X10' } });
    fireEvent.keyDown(screen.getByTestId('watch-device'), { key: 'Enter' });
    expect(screen.getByTestId('watch-row-X10')).toBeInTheDocument();
  });

  it('refuses a name it cannot read, and says why, without adding a row', () => {
    render(<WatchPanel profile={MITSUBISHI_FX5U} />);
    fireEvent.change(screen.getByTestId('watch-device'), { target: { value: 'ほげ' } });
    fireEvent.click(screen.getByTestId('watch-add'));
    expect(screen.getByTestId('watch-error')).toBeInTheDocument();
    expect(screen.getByTestId('watch-empty')).toBeInTheDocument();
  });

  it('refuses the same device twice', () => {
    render(<WatchPanel profile={MITSUBISHI_FX5U} />);
    fireEvent.change(screen.getByTestId('watch-device'), { target: { value: 'Y0' } });
    fireEvent.click(screen.getByTestId('watch-add'));
    fireEvent.change(screen.getByTestId('watch-device'), { target: { value: 'Y0' } });
    fireEvent.click(screen.getByTestId('watch-add'));
    expect(screen.getByTestId('watch-error')).toHaveTextContent('もう登録されています');
    expect(screen.getAllByTestId('watch-row-Y0')).toHaveLength(1);
  });

  it('drops the device again when the trainee takes it off the list', () => {
    render(<WatchPanel profile={MITSUBISHI_FX5U} />);
    fireEvent.change(screen.getByTestId('watch-device'), { target: { value: 'Y0' } });
    fireEvent.click(screen.getByTestId('watch-add'));
    fireEvent.click(screen.getByTestId('watch-remove-Y0'));
    expect(screen.queryByTestId('watch-row-Y0')).toBeNull();
  });

  /** 指摘 UX-14 ≡ UI-17: ON／OFF を色だけでなく形（■／□）でも示す。 */
  it('marks ON with ■ and OFF with □, not colour alone', () => {
    useStore.setState({
      plcMonitor: {
        tMs: 0,
        scanCount: 1,
        inputs: [true],
        outputs: [false],
        internals: {},
        timers: {},
        counters: {},
        powered: {},
      },
    });
    render(<WatchPanel profile={MITSUBISHI_FX5U} />);
    fireEvent.change(screen.getByTestId('watch-device'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('watch-add'));
    fireEvent.change(screen.getByTestId('watch-device'), { target: { value: 'Y0' } });
    fireEvent.click(screen.getByTestId('watch-add'));
    expect(screen.getByTestId('watch-row-X0')).toHaveTextContent('■');
    expect(screen.getByTestId('watch-row-Y0')).toHaveTextContent('□');
  });

  it('says — for a device the current snapshot does not carry', () => {
    render(<WatchPanel profile={MITSUBISHI_FX5U} />);
    fireEvent.change(screen.getByTestId('watch-device'), { target: { value: 'M0' } });
    fireEvent.click(screen.getByTestId('watch-add'));
    expect(screen.getByTestId('watch-row-M0')).toHaveTextContent('—');
  });
});

describe('キーの早見表への案内（指摘 PR-05）', () => {
  it('tells the trainee how to open the overlay from the key table pane', () => {
    render(<ShortcutHelp profile={MITSUBISHI_FX5U} />);
    expect(screen.getByTestId('shortcuts-overlay-hint')).toHaveTextContent('Shift + ?');
  });
});
// --- /Phase 7 Task 22 ---
