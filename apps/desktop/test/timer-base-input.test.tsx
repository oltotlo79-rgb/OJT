import { T, ton } from '@ojt/ladder-core';
import { MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300 } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceInput } from '../src/renderer/ladder/DeviceInput.js';
import {
  buildCell,
  emptyCellForm,
  formForCell,
  parseDirectEntry,
} from '../src/renderer/session/ladder-cell.js';

/**
 * タイマの時間単位を命令で選ぶ（v2.0.0 設計 §3.6）: 入力欄とセルの往復。
 * 「デバイスの入力」窓のタイマには「時間単位」の選択があり、機種の命令名と単位で選ぶ。
 * 1行入力の `OUTH T0 K50` も同じ単位になる。
 */

afterEach(() => {
  cleanup();
});

describe('入力欄 ⇄ セル（時間単位）', () => {
  it('欄で選んだ単位がセルに書かれ、設定値はその単位で読む（OUTH T0 K50 = 500ms）', () => {
    const cell = buildCell(
      { ...emptyCellForm('output'), output: 'TON', deviceText: 'T0', presetText: 'K50', base: 10 },
      MITSUBISHI_FX5U,
    );
    expect(cell).toMatchObject({ kind: 'timer', device: T(0), presetMs: 500, base: 10 });
  });

  it('単位を選ばなければ機種の既定（100ms）がセルに書かれる', () => {
    const cell = buildCell(
      { ...emptyCellForm('output'), output: 'TON', deviceText: 'T0', presetText: 'K5' },
      MITSUBISHI_FX5U,
    );
    expect(cell).toMatchObject({ kind: 'timer', presetMs: 500, base: 100 });
  });

  it('既存のセルを編集するとき、単位と設定値の綴りが欄に戻る', () => {
    const form = formForCell(ton(T(0), 500, 10), OMRON_CP1E);
    expect(form).toMatchObject({ output: 'TON', deviceText: 'T0', presetText: '#0050', base: 10 });
    // base の無い旧来のセルは欄の単位も空（既定で読む）
    expect(formForCell(ton(T(0), 500), OMRON_CP1E).base).toBeUndefined();
  });

  it('1行入力の OUTH T0 K50 は 10ms 単位のタイマになる', () => {
    const entry = parseDirectEntry('OUTH T0 K50', emptyCellForm('output'), MITSUBISHI_FX5U);
    expect(entry).not.toBeInstanceOf(Error);
    if (entry instanceof Error) return;
    expect(entry.form).toMatchObject({
      output: 'TON',
      deviceText: 'T0',
      presetText: 'K50',
      base: 10,
    });
    const omron = parseDirectEntry('TMHH T0 #0020', emptyCellForm('output'), OMRON_CP1E);
    if (omron instanceof Error) throw omron;
    expect(omron.form).toMatchObject({ output: 'TON', base: 1 });
  });
});

describe('「デバイスの入力」窓の時間単位', () => {
  function renderTimer(profile: typeof MITSUBISHI_FX5U): ReturnType<typeof vi.fn> {
    const onCommit = vi.fn();
    render(
      <DeviceInput
        initial={{ ...emptyCellForm('output'), output: 'TON', deviceText: 'T0', presetText: 'K50' }}
        profile={profile}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    return onCommit;
  }

  it('機種の単位の数だけ選択肢があり、命令名と単位が読める', () => {
    renderTimer(MITSUBISHI_FX5U);
    const select = screen.getByTestId('timer-base');
    const options = [...select.querySelectorAll('option')].map((option) => option.textContent);
    expect(options).toEqual(['OUT T（0.1秒）', 'OUTH T（0.01秒）', 'OUTHS T（0.001秒）']);
    cleanup();
    renderTimer(SHARP_JW300);
    expect(screen.getByTestId('timer-base').querySelectorAll('option')).toHaveLength(1);
  });

  it('単位を OUTH に変えて確定すると、10ms 単位のセルになる', () => {
    const onCommit = renderTimer(MITSUBISHI_FX5U);
    fireEvent.change(screen.getByTestId('timer-base'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({ kind: 'timer', presetMs: 500, base: 10 });
  });
});
