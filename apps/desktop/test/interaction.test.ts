import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  deleteKeyToAction,
  escapeToAction,
  LOCKED_WIRE_MESSAGE,
  NOT_WIRABLE_MESSAGE,
  pickToAction,
  type InteractionState,
} from '../src/renderer/session/interaction.js';

const CR1_13 = toTerminalId('CR1.13');
const CR1_14 = toTerminalId('CR1.14');
const PL_BODY = toTerminalId('PL1.+');

function state(patch: Partial<InteractionState> = {}): InteractionState {
  return {
    mode: 'wire',
    pendingTerminal: undefined,
    selectedWire: undefined,
    wireColor: '青',
    ...patch,
  };
}

describe('pickToAction（配線モード）', () => {
  it('端子を1つ目に選ぶと beginWire', () => {
    expect(
      pickToAction(state(), { kind: 'terminal', id: CR1_13, wirable: true, label: 'CR1 ⑬' }),
    ).toEqual({ type: 'beginWire', from: CR1_13 });
  });

  it('端子を2つ目に選ぶと completeWire（線色を持つ）', () => {
    expect(
      pickToAction(state({ pendingTerminal: CR1_13 }), {
        kind: 'terminal',
        id: CR1_14,
        wirable: true,
        label: 'CR1 ⑭',
      }),
    ).toEqual({ type: 'completeWire', from: CR1_13, to: CR1_14, color: '青' });
  });

  it('同じ端子をもう一度押すと取り消し', () => {
    expect(
      pickToAction(state({ pendingTerminal: CR1_13 }), {
        kind: 'terminal',
        id: CR1_13,
        wirable: true,
        label: 'CR1 ⑬',
      }),
    ).toEqual({ type: 'cancelWire' });
  });

  it('配線できない端子（PB/PL本体）は拒否する', () => {
    expect(
      pickToAction(state(), { kind: 'terminal', id: PL_BODY, wirable: false, label: 'PL1 +' }),
    ).toEqual({ type: 'reject', message: NOT_WIRABLE_MESSAGE });
  });

  it('空間クリックで配線を取り消す', () => {
    expect(pickToAction(state({ pendingTerminal: CR1_13 }), { kind: 'empty' })).toEqual({
      type: 'cancelWire',
    });
  });

  it('電線をクリックすると選択する', () => {
    expect(pickToAction(state(), { kind: 'wire', id: 'w-001', locked: false })).toEqual({
      type: 'selectWire',
      wireId: 'w-001',
    });
  });

  it('空きソケットは装着用に選択する', () => {
    expect(pickToAction(state(), { kind: 'socket', id: 'S1', occupied: false })).toEqual({
      type: 'selectSocket',
      socketId: 'S1',
    });
  });

  it('装着済みソケットは取り外し用に選択する', () => {
    expect(pickToAction(state(), { kind: 'socket', id: 'S2', occupied: true })).toEqual({
      type: 'selectMounted',
      socketId: 'S2',
    });
  });

  it('押ボタンは press になる', () => {
    expect(pickToAction(state(), { kind: 'pushbutton', id: 'PB1' })).toEqual({
      type: 'pressButton',
      pbId: 'PB1',
    });
  });

  it('選択中の電線があるとき空間クリックで選択を外す', () => {
    expect(pickToAction(state({ selectedWire: 'w-001' }), { kind: 'empty' })).toEqual({
      type: 'selectWire',
      wireId: '',
    });
  });

  it('何も選んでいないときの空間クリックは何もしない', () => {
    expect(pickToAction(state(), { kind: 'empty' })).toEqual({ type: 'none' });
  });
});

describe('pickToAction（削除モード）', () => {
  it('電線を削除する', () => {
    expect(
      pickToAction(state({ mode: 'delete' }), { kind: 'wire', id: 'w-003', locked: false }),
    ).toEqual({ type: 'removeWire', wireId: 'w-003' });
  });

  it('固定配線は削除できない', () => {
    expect(
      pickToAction(state({ mode: 'delete' }), { kind: 'wire', id: 'fw-chk-1', locked: true }),
    ).toEqual({ type: 'reject', message: LOCKED_WIRE_MESSAGE });
  });

  it('削除モードでも押ボタンは押せる', () => {
    expect(pickToAction(state({ mode: 'delete' }), { kind: 'pushbutton', id: 'PB3' })).toEqual({
      type: 'pressButton',
      pbId: 'PB3',
    });
  });

  it('削除モードで端子を触っても何も起きない', () => {
    expect(
      pickToAction(state({ mode: 'delete' }), {
        kind: 'terminal',
        id: CR1_13,
        wirable: true,
        label: 'CR1 ⑬',
      }),
    ).toEqual({ type: 'none' });
  });
});

describe('キーボード', () => {
  it('Esc は配線中だけ取り消す', () => {
    expect(escapeToAction(state({ pendingTerminal: CR1_13 }))).toEqual({ type: 'cancelWire' });
    expect(escapeToAction(state())).toEqual({ type: 'none' });
  });

  it('Delete は選択中の電線を削除する', () => {
    expect(deleteKeyToAction(state({ selectedWire: 'w-002' }), [])).toEqual({
      type: 'removeWire',
      wireId: 'w-002',
    });
  });

  it('Delete は固定配線を拒否する', () => {
    expect(deleteKeyToAction(state({ selectedWire: 'fw-chk-2' }), ['fw-chk-2'])).toEqual({
      type: 'reject',
      message: LOCKED_WIRE_MESSAGE,
    });
  });

  it('Delete は未選択なら何もしない', () => {
    expect(deleteKeyToAction(state(), [])).toEqual({ type: 'none' });
  });
});
