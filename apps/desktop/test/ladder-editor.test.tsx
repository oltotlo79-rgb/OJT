import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import { cellAt, COIL_COL, X, Y, type Cell } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderEditor } from '../src/renderer/ladder/LadderEditor.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

function editor(props: Partial<Parameters<typeof LadderEditor>[0]> = {}): void {
  render(
    <LadderEditor
      profile={MITSUBISHI_FX5U}
      gridCols={MITSUBISHI_FX5U.gridCols}
      onConvert={props.onConvert ?? ((): void => undefined)}
      onModeChange={props.onModeChange ?? ((): void => undefined)}
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
    const onModeChange = vi.fn();
    editor({ onModeChange });
    fireEvent.keyDown(grid(), { key: 'F3' });
    expect(useStore.getState().ladderMode).toBe('monitor');
    expect(onModeChange).toHaveBeenCalledWith('monitor');
    // モニタ中は編集できない
    fireEvent.keyDown(grid(), { key: 'F9' });
    expect(net1().kind).toBe('empty');
    expect(useStore.getState().toasts.at(-1)?.text).toContain('書込みモード');
  });

  it('explains why F8 does nothing (§17.1)', () => {
    editor();
    fireEvent.keyDown(grid(), { key: 'F8' });
    expect(useStore.getState().toasts.at(-1)?.text).toContain('Phase 4');
  });

  it('owns the keyboard only while focused (決定表#3)', () => {
    editor();
    expect(useStore.getState().ladderFocused).toBe(false);
    fireEvent.focus(grid());
    expect(useStore.getState().ladderFocused).toBe(true);
    fireEvent.blur(grid());
    expect(useStore.getState().ladderFocused).toBe(false);
  });
});
