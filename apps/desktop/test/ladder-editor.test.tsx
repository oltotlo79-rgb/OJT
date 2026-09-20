import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { cellAt, COIL_COL, insertRow, X, Y, type Cell } from '@ojt/ladder-core';
import {
  JTEKT_PC10G,
  MITSUBISHI_FX5U,
  OMRON_CP1E,
  SHARP_JW300,
  type DialectProfile,
} from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderEditor } from '../src/renderer/ladder/LadderEditor.js';
import {
  expandKeys,
  ladderKeyToAction,
  type LadderAction,
  type LadderEditorMode,
} from '../src/renderer/session/ladder.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

/**
 * 既定の `onModeChange` は `LadderWorkspace.changeMode` と同じくストアへ書き込む
 * （M6: `setMode` のストア書込みは `onModeChange` 側だけが持つようになったので、モックが
 * 何もしないと `ladderMode` が変わらない）。
 */
function editor(props: Partial<Parameters<typeof LadderEditor>[0]> = {}): void {
  render(
    <LadderEditor
      profile={props.profile ?? MITSUBISHI_FX5U}
      gridCols={props.gridCols ?? MITSUBISHI_FX5U.gridCols}
      errorCells={props.errorCells ?? new Set<string>()}
      onConvert={props.onConvert ?? ((): void => undefined)}
      onModeChange={
        props.onModeChange ??
        ((mode: LadderEditorMode): void => {
          useStore.getState().setLadderMode(mode);
        })
      }
    />,
  );
}

function grid(): HTMLElement {
  return screen.getByTestId('ladder-editor');
}

function net1(): Cell {
  const program = useStore.getState().ladder!;
  const net = program.networks.find((n) => n.id === 'n1')!;
  return cellAt(net, 0, 0);
}

// このリポジトリの UI テストの流儀（`globals: false` なので自動クリーンアップは効かない）。
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.getState().openProblem(problem);
});

describe('キー操作（§10.6 の割当表から引く）', () => {
  it('opens the device input on F5 and places an a-contact', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    expect(screen.getByTestId('device-input')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(net1()).toMatchObject({ kind: 'contact', type: 'NO', device: X(0) });
    expect(screen.queryByTestId('device-input')).toBeNull();
  });

  it('places a coil on F7 at the coil column', () => {
    editor();
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: COIL_COL });
    fireEvent.keyDown(grid(), { key: 'F7' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'Y0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    const net = useStore.getState().ladder!.networks[0]!;
    expect(cellAt(net, 0, COIL_COL)).toMatchObject({ kind: 'coil', type: 'OUT', device: Y(0) });
  });

  it('places a horizontal line on F9 without opening the input', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F9' });
    expect(screen.queryByTestId('device-input')).toBeNull();
    expect(net1().kind).toBe('hline');
  });

  it('refuses a device the dialect cannot read and keeps the input open', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X9' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(screen.getByTestId('device-error')).toHaveTextContent('8進');
    expect(screen.getByTestId('device-input')).toBeInTheDocument();
  });

  it('offers the 100ms rounding for a timer preset the band cannot express (§10.5)', () => {
    editor();
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: COIL_COL });
    fireEvent.keyDown(grid(), { key: 'F7' });
    fireEvent.change(screen.getByTestId('output-kind'), { target: { value: 'TON' } });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'T0' } });
    fireEvent.change(screen.getByTestId('preset-text'), { target: { value: '3050' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(screen.getByTestId('round-prompt')).toHaveTextContent('100ms');
    fireEvent.click(screen.getByTestId('round-yes'));
    const net = useStore.getState().ladder!.networks[0]!;
    // 四捨五入なので 3050 → 3100（`roundTimerPreset(3050, 100)`）
    expect(cellAt(net, 0, COIL_COL)).toMatchObject({ kind: 'timer', presetMs: 3100 });
  });

  it('moves the cursor one column right after a device is confirmed (I12)', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    // 続けて接点を並べられるよう、確定したら1つ右へ送る（GX Works3 と同じ）
    expect(useStore.getState().ladderCursor).toEqual({ networkId: 'n1', row: 0, col: 1 });
  });

  it('shifts the row right while the Ins mode is 挿入 (決定表#12b)', () => {
    editor();
    // X0 を置いてから先頭へ戻り、挿入モードで X1 を入れる
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: 0 });
    fireEvent.keyDown(grid(), { key: 'Insert' });
    expect(useStore.getState().insertMode).toBe('insert');
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X1' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    const net = useStore.getState().ladder!.networks[0]!;
    expect(cellAt(net, 0, 0)).toMatchObject({ device: X(1) });
    expect(cellAt(net, 0, 1)).toMatchObject({ device: X(0) });
  });

  it('replaces the cell on Enter even while the Ins mode is 挿入 (Batch 2 レビュー D2)', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: 0 });
    fireEvent.keyDown(grid(), { key: 'Insert' });
    expect(useStore.getState().insertMode).toBe('insert');
    // `Enter` は既存セルの編集なので、挿入モードでも右へずらさず置き換える
    fireEvent.keyDown(grid(), { key: 'Enter' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X1' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    const net = useStore.getState().ladder!.networks[0]!;
    expect(cellAt(net, 0, 0)).toMatchObject({ device: X(1) });
    expect(cellAt(net, 0, 1).kind).toBe('empty');
  });

  it('shows the Shift+F3 notice once and not again (決定表#11)', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F3', shiftKey: true });
    expect(useStore.getState().ladderMode).toBe('monitor');
    expect(useStore.getState().toasts.at(-1)?.text).toContain('モニタと同じ');
    const count = useStore.getState().toasts.length;
    fireEvent.keyDown(grid(), { key: 'F2' });
    fireEvent.keyDown(grid(), { key: 'F3', shiftKey: true });
    // 2回目は注記を出さない
    expect(useStore.getState().toasts).toHaveLength(count);
  });

  it('toggles a/b with / and the pulse form with Alt+/', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    // 確定でカーソルが右へ動くので、切換の前に戻す（I12）
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: 0 });
    fireEvent.keyDown(grid(), { key: '/' });
    expect(net1()).toMatchObject({ type: 'NC' });
    fireEvent.keyDown(grid(), { key: '/', altKey: true });
    expect(net1()).toMatchObject({ type: 'F' });
  });

  it('branches with Shift+F5 (OR contact)', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: 0 });
    fireEvent.keyDown(grid(), { key: 'F5', shiftKey: true });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'Y0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    const net = useStore.getState().ladder!.networks[0]!;
    expect(net.rows).toBe(2);
    expect(cellAt(net, 1, 0)).toMatchObject({ device: Y(0) });
    expect(cellAt(net, 0, 1).kind).toBe('vline');
    /*
     * 指摘 LE-5: 確定後のカーソルは「閉じ側の縦線の次」（col 2）に置く。col 1（縦線の上）の
     * ままだと、続けて記号を置いたときに縦線を上書きして下の行の分岐が孤立する。
     */
    expect(useStore.getState().ladderCursor).toEqual({ networkId: 'n1', row: 0, col: 2 });
  });

  it('does not throw on Enter after Ctrl+Z following a row insert and cursor move (LE-2)', () => {
    editor();
    const store = useStore.getState();
    // 「行挿入」ボタン（`LadderWorkspace`）と同じ操作: n1 を2行にする
    store.setLadder(insertRow(store.ladder!, 'n1', 1));
    store.setLadderCursor({ networkId: 'n1', row: 1, col: 0 });
    // `Ctrl+Z` で n1 は1行に戻るが、undo 前は `ladderCursor` が row:1 を指したままだった
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    expect(useStore.getState().ladder!.networks[0]!.rows).toBe(1);
    expect(() => {
      fireEvent.keyDown(grid(), { key: 'Enter' });
    }).not.toThrow();
  });

  it('clears the cell on Delete and walks the history with Ctrl+Z / Ctrl+Y', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F9' });
    expect(net1().kind).toBe('hline');
    fireEvent.keyDown(grid(), { key: 'Delete' });
    expect(net1().kind).toBe('empty');
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    expect(net1().kind).toBe('hline');
    fireEvent.keyDown(grid(), { key: 'y', ctrlKey: true });
    expect(net1().kind).toBe('empty');
  });

  it('asks the parent to convert on F4', () => {
    const onConvert = vi.fn();
    editor({ onConvert });
    fireEvent.keyDown(grid(), { key: 'F4' });
    expect(onConvert).toHaveBeenCalledTimes(1);
  });

  it('switches to monitor on F3 and tells the parent (決定表#11)', () => {
    const onModeChange = vi.fn((mode: LadderEditorMode) => {
      useStore.getState().setLadderMode(mode);
    });
    editor({ onModeChange });
    fireEvent.keyDown(grid(), { key: 'F3' });
    expect(useStore.getState().ladderMode).toBe('monitor');
    expect(onModeChange).toHaveBeenCalledWith('monitor');
    // モニタ中は編集できない
    fireEvent.keyDown(grid(), { key: 'F9' });
    expect(net1().kind).toBe('empty');
    expect(useStore.getState().toasts.at(-1)?.text).toContain('書込みモード');
  });

  /** Phase 7 Task 20 / 指摘 LE-8: `F8` は「応用命令」欄（SET/RST/MC/MCR/T/C）へつながった。 */
  it('opens the application-instruction entry on F8 and places a SET coil', () => {
    editor();
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: COIL_COL });
    fireEvent.keyDown(grid(), { key: 'F8' });
    // 出力欄が SET で開く（欄の中で RST などへ変えられる）
    expect(screen.getByTestId('output-kind')).toHaveValue('SET');
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'Y0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    const net = useStore.getState().ladder!.networks[0]!;
    expect(cellAt(net, 0, COIL_COL)).toMatchObject({ kind: 'coil', type: 'SET', device: Y(0) });
  });

  /** Phase 7 §5.2: OMRON の `I`（命令入力）も同じ欄へ倒す（以前は何も起きなかった）。 */
  it('opens the same entry on the OMRON instruction key (LE-8)', () => {
    editor({ profile: OMRON_CP1E, gridCols: OMRON_CP1E.gridCols });
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: COIL_COL });
    fireEvent.keyDown(grid(), { key: 'i' });
    expect(screen.getByTestId('device-input')).toBeInTheDocument();
    expect(screen.getByTestId('output-kind')).toHaveValue('SET');
  });

  /** Phase 7 §5.2: 立上り・立下りの微分接点（出典 S2）。 */
  it('places a rising-edge contact on Shift+F7 and a falling-edge one on Shift+F8', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F7', shiftKey: true });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(net1()).toMatchObject({ kind: 'contact', type: 'P', device: X(0) });
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: 1 });
    fireEvent.keyDown(grid(), { key: 'F8', shiftKey: true });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X1' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    const net = useStore.getState().ladder!.networks[0]!;
    expect(cellAt(net, 0, 1)).toMatchObject({ kind: 'contact', type: 'F', device: X(1) });
  });

  /** Phase 7 §5.2: 罫線の削除（三菱 `Ctrl+F9` / `Ctrl+F10`、出典 S1）。 */
  it('deletes a horizontal line on Ctrl+F9 and a vertical one on Ctrl+F10', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F9' });
    expect(net1().kind).toBe('hline');
    fireEvent.keyDown(grid(), { key: 'F9', ctrlKey: true });
    expect(net1().kind).toBe('empty');
    // 縦線は下の行と繋ぐので、2行にしてから引いて消す
    const store = useStore.getState();
    store.setLadder(insertRow(store.ladder!, 'n1', 1));
    fireEvent.keyDown(grid(), { key: 'ArrowDown', ctrlKey: true });
    expect(net1().kind).toBe('vline');
    fireEvent.keyDown(grid(), { key: 'F10', ctrlKey: true });
    expect(net1().kind).toBe('empty');
  });

  it('refuses to delete a line where there is none, without touching the cell', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F5' });
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: 'X0' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: 0 });
    fireEvent.keyDown(grid(), { key: 'F9', ctrlKey: true });
    // 記号は罫線削除では消えない（消すのは `Delete` の仕事）
    expect(net1()).toMatchObject({ kind: 'contact', device: X(0) });
    expect(useStore.getState().toasts.at(-1)?.text).toContain('横線');
  });

  /** Phase 7 §5.2: CX-Programmer風の罫線は `Ctrl` ＋矢印（出典 S5）。 */
  it('draws and deletes lines with Ctrl+arrows under the OMRON skin', () => {
    editor({ profile: OMRON_CP1E, gridCols: OMRON_CP1E.gridCols });
    fireEvent.keyDown(grid(), { key: 'ArrowRight', ctrlKey: true });
    expect(net1().kind).toBe('hline');
    fireEvent.keyDown(grid(), { key: 'ArrowLeft', ctrlKey: true });
    expect(net1().kind).toBe('empty');
  });

  /**
   * Phase 7 §5.2（出典 S4）: CX-Programmer風には a↔b の切換の行が無く、b接点キーの `/` が
   * **接点の上ではその場で入れ替える**。三菱系は `/` が切換の行そのものなので変わらない。
   */
  it('flips an existing contact with the OMRON b-contact key, but opens the entry on an empty cell', () => {
    editor({ profile: OMRON_CP1E, gridCols: OMRON_CP1E.gridCols });
    fireEvent.keyDown(grid(), { key: '/' });
    expect(screen.getByTestId('device-input')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('device-text'), { target: { value: '0.00' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(net1()).toMatchObject({ kind: 'contact', type: 'NC' });
    useStore.getState().setLadderCursor({ networkId: 'n1', row: 0, col: 0 });
    fireEvent.keyDown(grid(), { key: '/' });
    expect(net1()).toMatchObject({ kind: 'contact', type: 'NO' });
    expect(screen.queryByTestId('device-input')).toBeNull();
  });

  /**
   * レビュー I8: OMRON は `write-mode` のキー割当を持たない（決定表#12。実機はツールバーの
   * 「オンライン編集」）。以前の `?? 'F2'` は OMRON に無いキーを教えていた。
   *
   * 指摘 LE-1: このテストはもともと `{ key: 'C' }`（大文字）を送っていた。実ブラウザで `C`
   * キーを押すと `KeyboardEvent.key` は小文字 `'c'` で来るので、大文字のイベントは実際には
   * 起き得ない。大文字のままだと `matchShortcut()` の大小文字不一致（LE-1 本体）を覆い隠して
   * しまうので、実ブラウザと同じ小文字に直す。
   */
  it('names the toolbar label, not the invented F2, under a skin with no write-mode key (I8)', () => {
    useStore.getState().setLadderMode('monitor');
    editor({ profile: OMRON_CP1E, gridCols: OMRON_CP1E.gridCols });
    // OMRON の a接点キーは `C`（モニタ中なので置けず、readOnly になる）
    fireEvent.keyDown(grid(), { key: 'c' });
    const message = useStore.getState().toasts.at(-1)?.text ?? '';
    expect(message).not.toContain('F2');
    expect(message).toContain('オンライン編集');
  });

  it('opens the a-contact input on a lowercase key event under OMRON (LE-1)', () => {
    editor({ profile: OMRON_CP1E, gridCols: OMRON_CP1E.gridCols });
    // OMRON の a接点キーは表では 'C' だが、実ブラウザは小文字 'c' を送る
    fireEvent.keyDown(grid(), { key: 'c' });
    expect(screen.getByTestId('device-input')).toBeInTheDocument();
  });

  it('owns the keyboard only while focused (決定表#3)', () => {
    editor();
    expect(useStore.getState().ladderFocused).toBe(false);
    fireEvent.focus(grid());
    expect(useStore.getState().ladderFocused).toBe(true);
    fireEvent.blur(grid());
    expect(useStore.getState().ladderFocused).toBe(false);
  });

  /**
   * 指摘 LE-13: `Tab`/`Shift+Tab` は罫線送りに使っており常に飲み込む。`role="application"` の
   * このエディタは `Escape` だけがキーボードだけでの唯一の脱出口。
   */
  it('blurs the editor on Escape, the only keyboard way out (LE-13)', () => {
    editor();
    // `fireEvent.focus()` だけでは `document.activeElement` が動かず、後続の `blur()` が
    // 何もしない（実 DOM の焦点が無い）ので、実際にフォーカスを移す
    grid().focus();
    expect(useStore.getState().ladderFocused).toBe(true);
    fireEvent.keyDown(grid(), { key: 'Escape' });
    expect(useStore.getState().ladderFocused).toBe(false);
    expect(document.activeElement).not.toBe(grid());
  });
});

/**
 * 網羅検査（指摘 LE-1 / LE-8）: 4方言すべてで、キー割当表に `enabled !== false` として載っている
 * 全行のキーが実際に `ladderKeyToAction()` で `none` 以外の操作へ写ること。表と実装がテストで
 * 結ばれていなかったのが LE-1（OMRON のキーが1つも一致しない）の根本原因なので、二度と空けない。
 */
describe('4方言のキー割当が実際に効く（網羅。LE-1 / LE-8）', () => {
  const profiles: readonly DialectProfile[] = [
    MITSUBISHI_FX5U,
    OMRON_CP1E,
    JTEKT_PC10G,
    SHARP_JW300,
  ];

  /** 表の1行のキーを実イベントの形へ起こして `ladderKeyToAction()` に通す。 */
  function actionsOf(profile: DialectProfile, keys: string): Array<[string, LadderAction]> {
    return expandKeys(keys).map((chord) => {
      const parts = chord.split('+');
      const key = parts.pop() ?? '';
      return [
        chord,
        ladderKeyToAction(
          profile.shortcuts,
          {
            key,
            ctrlKey: parts.includes('Ctrl'),
            shiftKey: parts.includes('Shift'),
            altKey: parts.includes('Alt'),
          },
          { cursor: { networkId: 'n1', row: 0, col: 0 }, mode: 'write' },
        ),
      ];
    });
  }

  /*
   * Phase 7 Task 20（決定 D6）: 除外はもう1つも無い。表に `enabled !== false` で載っている行は
   * 全部が実際に効く（OMRON の `instruction` も Task 20 で応用命令欄へつないだ）。
   */
  it.each(profiles)('every enabled shortcut row of $id actually does something', (profile) => {
    for (const entry of profile.shortcuts) {
      if (entry.enabled === false) continue;
      for (const [chord, action] of actionsOf(profile, entry.keys)) {
        const where = `${profile.id} ${entry.action} (${chord})`;
        expect(action.type, where).not.toBe('none');
        expect(action.type, where).not.toBe('disabled');
      }
    }
  });

  it.each(profiles)('says why each disabled row of $id does nothing', (profile) => {
    for (const entry of profile.shortcuts) {
      if (entry.enabled !== false) continue;
      for (const [chord, action] of actionsOf(profile, entry.keys)) {
        const where = `${profile.id} ${entry.action} (${chord})`;
        expect(action.type, where).toBe('disabled');
        if (action.type === 'disabled') {
          expect((action.entry.note ?? '').trim().length, where).toBeGreaterThan(0);
        }
      }
    }
  });

  /** 指摘 LE-1: 英字キーは大小文字を問わず当たる（実ブラウザは `c` を送る）。 */
  it.each(profiles)('matches letter keys of $id in either case', (profile) => {
    for (const entry of profile.shortcuts) {
      for (const chord of expandKeys(entry.keys)) {
        const parts = chord.split('+');
        const key = parts.pop() ?? '';
        if (!/^[A-Z]$/u.test(key)) continue;
        const state = { cursor: { networkId: 'n1', row: 0, col: 0 }, mode: 'write' as const };
        const modifiers = {
          ctrlKey: parts.includes('Ctrl'),
          shiftKey: parts.includes('Shift'),
          altKey: parts.includes('Alt'),
        };
        const upper = ladderKeyToAction(profile.shortcuts, { key, ...modifiers }, state);
        const lower = ladderKeyToAction(
          profile.shortcuts,
          { key: key.toLowerCase(), ...modifiers },
          state,
        );
        expect(lower, `${profile.id} ${entry.action} (${chord})`).toEqual(upper);
      }
    }
  });

  /** Phase 7 Task 20 step 1: 1行に複数のキーをカンマ区切りで書ける。 */
  it('expands a comma-separated key row into every chord it lists', () => {
    expect(expandKeys('Ctrl+F9,Ctrl+←')).toEqual(['Ctrl+F9', 'Ctrl+ArrowLeft']);
    expect(expandKeys('F5')).toEqual(['F5']);
    expect(expandKeys('Ctrl+←↑↓→')).toHaveLength(4);
  });
});
