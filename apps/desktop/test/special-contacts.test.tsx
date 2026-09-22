import {
  compile,
  createPlcRuntime,
  endNetwork,
  hline,
  IR_COLS,
  M,
  network,
  no,
  out,
  program,
  SP,
  Y,
  type Cell,
} from '@ojt/ladder-core';
import { availableDialects, getDialect, nativeContact, SHARP_JW300 } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceInput } from '../src/renderer/ladder/DeviceInput.js';
import { MonitorPanel } from '../src/renderer/ladder/MonitorPanel.js';
import { PLC_UNIT_FX5U } from '@ojt/board-model';
import { useStore } from '../src/renderer/app/store.js';
import { watchValueOf } from '../src/renderer/ladder/WatchPanel.js';
import { buildCell, emptyCellForm, formForCell } from '../src/renderer/session/ladder-cell.js';
import { specialContactChoices } from '../src/renderer/session/special-contacts.js';

afterEach(cleanup);

function boot(contact: Cell) {
  const compiled = compile(
    program(
      network('n1', [[contact, ...Array.from({ length: IR_COLS - 2 }, hline), out(Y(0))]]),
      endNetwork(),
    ),
  );
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
  return createPlcRuntime(compiled.program, {
    io: { readInputs: () => [], writeOutputs: () => undefined },
    recordPowered: true,
  });
}

describe('メーカーの特殊接点を入力して実行する', () => {
  for (const profile of availableDialects()) {
    it(`${profile.id}: 一覧には特殊接点の実際の値を表示し、JWの反転表記を重複させない`, () => {
      useStore.setState({
        converted: true,
        ladderMode: 'monitor',
        plcMonitor: {
          tMs: 10,
          scanCount: 1,
          inputs: [],
          outputs: [],
          internals: {},
          timers: {},
          counters: {},
          powered: {},
          specials: { 0: true, 1: true, 2: true, 3: false },
        },
      });
      render(<MonitorPanel profile={profile} unit={PLC_UNIT_FX5U} onPlc={vi.fn()} />);
      expect(screen.getByTestId('monitor-special-3')).toHaveTextContent('OFF');
      if (profile.id === 'sharp') expect(screen.queryByTestId('monitor-special-0')).toBeNull();
      else expect(screen.getByTestId('monitor-special-0')).toHaveTextContent('ON');
      useStore.setState({ plcMonitor: undefined });
    });

    for (const choice of specialContactChoices(profile)) {
      it(`${profile.id}/${choice.name}/${choice.title}: 入力・実行・再編集で意味が変わらない`, () => {
        const cell = buildCell(
          { ...emptyCellForm('contact'), deviceText: choice.name, contact: choice.contact },
          profile,
        );
        if (cell instanceof Error) throw cell;
        const reopened = buildCell(formForCell(cell, profile), profile);
        expect(reopened).toEqual(cell);
        const runtime = boot(cell);
        for (let scan = 1; scan <= 101; scan += 1) {
          runtime.scan();
          const expected =
            choice.index === 0 ||
            (choice.index === 1 && scan === 1) ||
            (choice.index === 2 && (scan <= 50 || scan === 101));
          expect(runtime.state().outputs[0], `scan ${scan}`).toBe(expected);
          expect(runtime.poweredCells.get('n1:0:1')).toBe(expected);
        }
        runtime.reset();
        runtime.scan();
        expect(runtime.state().outputs[0]).toBe(choice.index !== 3);
      });
    }
    it(`${profile.id}: 特殊接点をコイルへ書き込めない`, () => {
      for (const output of ['OUT', 'SET', 'RST'] as const) {
        expect(
          buildCell(
            { ...emptyCellForm('output'), output, deviceText: profile.specialDevices[0]! },
            profile,
          ),
        ).toBeInstanceOf(Error);
      }
    });
  }

  it.each(['SM400', 'SM8000', 'M8000', 'ＳＭ４００'])('%sは常時ONとして読める', (name) => {
    expect(getDialect('mitsubishi').parseDevice(name)).toEqual(SP(0));
  });
  it.each(['V4', 'V04', 'V004', '1V004', 'P1-V004', 'Ｖ４'])('%sは常時ONとして読める', (name) => {
    expect(getDialect('jtekt').parseDevice(name)).toEqual(SP(0));
  });

  it.each(['NO', 'NC', 'P', 'F'] as const)(
    'JWの旧常時ON %s は表示・再編集・書き出し用の変換でも動作を保つ',
    (type) => {
      const old: Extract<Cell, { kind: 'contact' }> = { kind: 'contact', type, device: SP(0) };
      const original = boot(old);
      const normalized = nativeContact(old, SHARP_JW300);
      const edited = buildCell(formForCell(old, SHARP_JW300), SHARP_JW300);
      expect(edited).toEqual(normalized);
      const converted = boot(normalized);
      for (let scan = 0; scan < 3; scan += 1) {
        original.scan();
        converted.scan();
        expect(converted.state().outputs).toEqual(original.state().outputs);
      }
    },
  );

  it('初期パルス・クロックの監視値は直前のスキャンと一致し、M0とは混同しない', () => {
    for (const index of [0, 1, 2, 3]) {
      const runtime = boot(no(SP(index)));
      for (let scan = 1; scan <= 101; scan += 1) {
        runtime.scan();
        const state = runtime.state();
        const monitor = { ...state, internals: { 0: false }, timers: {}, powered: {} };
        expect(watchValueOf(monitor, SP(index)).on).toBe(state.outputs[0]);
        expect(watchValueOf(monitor, M(0)).on).toBe(false);
      }
    }
  });

  it('接点入力の用途一覧からSM400を選び、その意味を確認して確定できる', () => {
    const onCommit = vi.fn();
    render(
      <DeviceInput
        initial={emptyCellForm('contact')}
        profile={getDialect('mitsubishi')}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('special-contact-select'), { target: { value: '0' } });
    expect(screen.getByTestId('device-text')).toHaveValue('SM400');
    expect(screen.getByTestId('special-contact-note')).toHaveTextContent('常時ON');
    fireEvent.click(screen.getByTestId('device-commit'));
    expect(onCommit).toHaveBeenCalledWith(no(SP(0)), {});
  });
});
