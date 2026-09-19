import { BUILTIN_PLC_PROBLEMS, type PlcProblem } from '@ojt/content';
import {
  C,
  COIL_COL,
  ctu,
  endNetwork,
  hline,
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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { NotationDialog } from '../src/renderer/ladder/NotationDialog.js';

const problem = BUILTIN_PLC_PROBLEMS[0]!;

/** 出力はコイル列（`COIL_COL` = 15）に置く（`compile()` が最終列以外の出力を弾く）。 */
function coilRow(contacts: readonly Cell[], output: Cell): Cell[] {
  const line: Cell[] = [...contacts];
  while (line.length < COIL_COL) line.push(hline());
  line.push(output);
  return line;
}

const selfHold = program(network('n1', [coilRow([no(X(8))], out(Y(1)))]), endNetwork());

/** カウンタ設定値の綴り（三菱 `K5` → OMRON `#0005`）を見るためのラダー。 */
const withCounter = program(network('n1', [coilRow([no(X(0))], ctu(C(0), 5, X(1)))]), endNetwork());

/**
 * 三菱の高速タイマ（`T200`〜。10ms刻み）を使うラダー。§10.7 レビュー #9
 * シャープは 0.1 秒（100ms）刻み固定なので、`10ms` は割り切れず表せない
 * （`device-rules.ts` の `makeTimerPreset()`）。三菱では有効な値なので、切替前は指摘が出ない。
 */
const withFastTimer = program(network('n1', [coilRow([no(X(0))], ton(T(200), 10))]), endNetwork());

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.getState().abandonSession();
  // 既定メーカーは設定なので `abandonSession()` では戻らない。ケース間で漏らさないよう明示に戻す
  useStore.setState({ defaultVendor: 'mitsubishi', dialectId: 'mitsubishi' });
  act(() => {
    useStore.getState().openProblem(problem);
    useStore.getState().setLadder(selfHold);
  });
});

function dialog(onClose = vi.fn()): typeof onClose {
  render(<NotationDialog profile={MITSUBISHI_FX5U} onClose={onClose} />);
  return onClose;
}

describe('表記切替（§10.7 / §16 Phase 4 受入基準②）', () => {
  it('lists every dialect but the current one', () => {
    dialog();
    expect(screen.queryByTestId('notation-to-mitsubishi')).toBeNull();
    for (const id of ['omron', 'jtekt', 'sharp']) {
      expect(screen.getByTestId(`notation-to-${id}`)).toBeInTheDocument();
    }
  });

  it('previews how every device will be spelled (受入基準②)', () => {
    dialog();
    act(() => {
      fireEvent.click(screen.getByTestId('notation-to-omron'));
    });
    const rows = screen.getAllByTestId(/^notation-change-/u).map((row) => row.textContent);
    expect(rows.some((text) => text?.includes('X10') === true && text.includes('0.08'))).toBe(true);
    expect(rows.some((text) => text?.includes('Y1') === true && text.includes('100.01'))).toBe(
      true,
    );
  });

  it('previews the counter preset spelling too (§10.7 / 4A レビュー M2)', () => {
    act(() => {
      useStore.getState().setLadder(withCounter);
    });
    dialog();
    act(() => {
      fireEvent.click(screen.getByTestId('notation-to-omron'));
    });
    const rows = screen.getAllByTestId(/^notation-preset-/u).map((row) => row.textContent);
    expect(rows.some((text) => text?.includes('K5') === true && text.includes('#0005'))).toBe(true);
  });

  it('warns that the wiring will be cleared before switching (決定表#12)', () => {
    dialog();
    act(() => {
      fireEvent.click(screen.getByTestId('notation-to-omron'));
    });
    expect(screen.getByTestId('notation-warning')).toHaveTextContent('配線');
    // 確定するまで方言は変わらない
    expect(useStore.getState().dialectId).toBe('mitsubishi');
  });

  it('switches the dialect and the model but keeps the ladder (4A H-2)', () => {
    const onClose = dialog();
    // 選んでから確定する（同じ `act()` にまとめると、下見が描かれる前に確定を押すことになる）
    act(() => {
      fireEvent.click(screen.getByTestId('notation-to-omron'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('notation-apply'));
    });
    const state = useStore.getState();
    expect(state.dialectId).toBe('omron');
    expect(state.ladder).toEqual(selfHold);
    expect(state.converted).toBe(false);
    expect(onClose).toHaveBeenCalled();
    // 機種（3Dの本体と端子名）も一緒に変わる（決定表#12）
    const swapped = state.problem as PlcProblem;
    expect(swapped.plc.vendor).toBe('omron');
    // 取り消しスタックはそのまま（決定表#11）
    expect(useStore.getState().undoLadderEdit()).toBe(true);
  });

  it('shows what the target dialect cannot spell (レビュー #9)', () => {
    // 三菱の高速タイマ（T200、10ms）はシャープ（0.1秒刻み固定）では表せない
    act(() => {
      useStore.getState().setLadder(withFastTimer);
    });
    dialog();
    act(() => {
      fireEvent.click(screen.getByTestId('notation-to-sharp'));
    });
    expect(screen.getByTestId('notation-errors')).toHaveTextContent('0.1秒');
  });

  it('says why a maker cannot be chosen instead of failing after the fact (決定表#10)', () => {
    // CP1E は出力12点なので `y: 12` の割付は収まらない（4A 前提#23）
    act(() => {
      useStore.setState({
        problem: { ...problem, io: { ...problem.io, outputs: [{ y: 12, cr: 'CR1', pl: 'PL1' }] } },
      });
    });
    dialog();
    const omron = screen.getByTestId('notation-to-omron');
    expect(omron).toBeDisabled();
    expect(screen.getByTestId('notation-reason-omron')).toHaveTextContent('割付');
    expect(screen.getByTestId('notation-to-jtekt')).toBeEnabled();
  });

  // --- レビュー #7: 閉じたときにフォーカスを戻す／パネル内のフォーカストラップ ---
  it('returns focus to the button that opened it once it closes', () => {
    render(<button data-testid="toolbar-notation">{'表記切替'}</button>);
    const opener = screen.getByTestId('toolbar-notation');
    opener.focus();
    expect(document.activeElement).toBe(opener);
    const { unmount } = render(<NotationDialog profile={MITSUBISHI_FX5U} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByTestId('notation-dialog'));
    // 親が条件付きレンダーで畳むのと同じ状況（閉じる＝アンマウント）
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  it('cycles Tab inside the panel instead of letting it escape to the background', () => {
    dialog();
    const panel = screen.getByTestId('notation-dialog');
    const focusables = panel.querySelectorAll<HTMLElement>('button');
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    last?.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
  // --- /レビュー #7 ---
});
