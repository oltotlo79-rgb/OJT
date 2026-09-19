import { BUILTIN_PLC_PROBLEMS } from '@ojt/content';
import {
  COIL_COL,
  empty,
  endNetwork,
  hline,
  network,
  no,
  out,
  program,
  X,
  Y,
  type Cell,
  type LadderProgram,
} from '@ojt/ladder-core';
import { MITSUBISHI_FX5U, SHARP_JW300 } from '@ojt/plc-dialects';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LadderWorkspace } from '../src/renderer/ladder/LadderWorkspace.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

/**
 * 出力を**コイル列**（`COIL_COL` = 15）に置いた1行。
 * `compile()` は最終列以外の出力を `コイル・タイマ・カウンタ・MC/MCR は最終列（15）に置きます`
 * で弾く（`ladder-core/src/compile.ts` L326-332）ので、素の `[no(X(0)), hline(), out(Y(0))]`
 * は `compile-failed` になって命令語リストが1行も出ない。
 */
function coilRow(contacts: readonly Cell[], output: Cell): Cell[] {
  const line: Cell[] = [...contacts];
  while (line.length < COIL_COL) line.push(hline());
  line.push(output);
  return line;
}

const simple = program(network('n1', [coilRow([no(X(0))], out(Y(0)))]), endNetwork());
const saveTextFile = vi.fn();

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  saveTextFile.mockReset().mockResolvedValue({ ok: true, path: 'C:/tmp/il.txt' });
  (window as unknown as { ojt: unknown }).ojt = {
    listProblems: vi.fn(),
    readProblem: vi.fn(),
    saveWorkFile: vi.fn(),
    loadWorkFile: vi.fn(),
    getSettings: vi.fn(),
    setSettings: vi.fn(),
    saveTextFile,
  };
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
    useStore.getState().setLadder(simple);
  });
});

describe('命令語リストの書き出し（§10.7 / §16 Phase 4 受入基準⑥）', () => {
  it('writes the mnemonics of the current dialect', async () => {
    render(
      <LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    await waitFor(() => {
      expect(saveTextFile).toHaveBeenCalledTimes(1);
    });
    const request = saveTextFile.mock.calls[0]?.[0] as { defaultFileName: string; text: string };
    expect(request.text).toContain('LD');
    expect(request.text).toContain('OUT');
    expect(request.text.endsWith('\r\n')).toBe(true);
    expect(request.defaultFileName).toContain(problem.id);
  });

  it('writes the SHARP mnemonics when that skin is open (受入基準⑥)', async () => {
    render(
      <LadderWorkspace problem={problem} profile={SHARP_JW300} gridCols={11} onPlc={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    await waitFor(() => {
      expect(saveTextFile).toHaveBeenCalled();
    });
    const request = saveTextFile.mock.calls[0]?.[0] as { text: string };
    expect(request.text).toContain('STR');
    expect(request.text).not.toContain('LD ');
  });

  it('explains an output with no path from the left rail, instead of writing a file', async () => {
    // 左母線から辿り着けない出力（`coil-unconnected`。4A `instruction-list.ts` L496-500）
    act(() => {
      useStore.getState().setLadder(unreachableOutputProgram());
    });
    render(
      <LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('il-issues')).toHaveTextContent('左母線');
    });
    expect(saveTextFile).not.toHaveBeenCalled();
    // 回路ブロックの内部ID（`n1`）は画面に出さない
    expect(screen.getByTestId('il-issues').textContent).not.toContain('n1');
  });

  it('tells the trainee where the file went', async () => {
    render(
      <LadderWorkspace problem={problem} profile={MITSUBISHI_FX5U} gridCols={11} onPlc={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('export-il'));
    });
    await waitFor(() => {
      expect(useStore.getState().toasts.at(-1)?.text).toContain('C:/tmp/il.txt');
    });
  });
});

/**
 * 左母線から出力まで辿れる道が1本も無いラダー。§10.7 / 4A `instruction-list.ts` L496-500
 *
 * コイルはコイル列（`COIL_COL`）に置きつつ、その左を空セルのままにすると、左母線から届く枝が
 * 無くなって分解に失敗する（`compile()` はこれを通す——「左母線に繋がっていない回路」の
 * 診断が無いため。申し送り F-1）。
 */
function unreachableOutputProgram(): LadderProgram {
  const isolated: Cell[] = Array.from({ length: COIL_COL }, () => empty());
  return program(network('n1', [[...isolated, out(Y(0))]]), endNetwork());
}
