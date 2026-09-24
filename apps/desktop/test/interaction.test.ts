import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  deleteKeyToAction,
  escapeToAction,
  isTypingTarget,
  LOCKED_WIRE_MESSAGE,
  NOT_WIRABLE_MESSAGE,
  pickToAction,
  shouldIgnoreShortcut,
  type InteractionState,
  type PickHit,
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

  it('電線をクリックすると選択する（取扱説明書「電線をつなぐ・外す」。端子との重なりは3D側で端子を優先する）', () => {
    expect(pickToAction(state(), { kind: 'wire', id: 'w-001', locked: false })).toEqual({
      type: 'selectWire',
      wireId: 'w-001',
    });
  });

  it('固定配線をクリックしても配線モードでは何も起きない（削除モードだけが理由を出す）', () => {
    expect(pickToAction(state(), { kind: 'wire', id: 'fw-chk-1', locked: true })).toEqual({
      type: 'none',
    });
  });

  it('配線中に電線をクリックしても配線待ちは取り消されない（キャンセルではない）', () => {
    expect(
      pickToAction(state({ pendingTerminal: CR1_13 }), {
        kind: 'wire',
        id: 'w-001',
        locked: false,
      }),
    ).toEqual({ type: 'none' });
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

  it('配線モードでも空間クリックで電線の選択を外す', () => {
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
  it('電線をクリックすると選択する（実際の削除は Delete キーで行う。§8.2）', () => {
    expect(
      pickToAction(state({ mode: 'delete' }), { kind: 'wire', id: 'w-003', locked: false }),
    ).toEqual({ type: 'selectWire', wireId: 'w-003' });
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

  it('選択中の電線があるとき空間クリックで選択を外す（§8.2）', () => {
    expect(
      pickToAction(state({ mode: 'delete', selectedWire: 'w-001' }), { kind: 'empty' }),
    ).toEqual({ type: 'selectWire', wireId: '' });
  });

  it('何も選んでいないときの空間クリックは何もしない', () => {
    expect(pickToAction(state({ mode: 'delete' }), { kind: 'empty' })).toEqual({ type: 'none' });
  });
});

describe('キーボード', () => {
  it('Esc は配線中なら取り消す', () => {
    expect(escapeToAction(state({ pendingTerminal: CR1_13 }))).toEqual({ type: 'cancelWire' });
    expect(escapeToAction(state())).toEqual({ type: 'none' });
  });

  it('Esc は削除モードで選択中の電線があれば選択を外す（§8.2）', () => {
    expect(escapeToAction(state({ mode: 'delete', selectedWire: 'w-001' }))).toEqual({
      type: 'selectWire',
      wireId: '',
    });
    expect(escapeToAction(state({ mode: 'delete' }))).toEqual({ type: 'none' });
    // 配線モードでも電線を選べるので、Esc で選択を外せる
    expect(escapeToAction(state({ selectedWire: 'w-001' }))).toEqual({
      type: 'selectWire',
      wireId: '',
    });
  });

  it('Delete は削除モードで選択中の電線を削除する', () => {
    expect(deleteKeyToAction(state({ mode: 'delete', selectedWire: 'w-002' }), [])).toEqual({
      type: 'removeWire',
      wireId: 'w-002',
    });
  });

  it('Delete は削除モードでも固定配線を拒否する', () => {
    expect(
      deleteKeyToAction(state({ mode: 'delete', selectedWire: 'fw-chk-2' }), ['fw-chk-2']),
    ).toEqual({
      type: 'reject',
      message: LOCKED_WIRE_MESSAGE,
    });
  });

  it('Delete は未選択なら何もしない', () => {
    expect(deleteKeyToAction(state({ mode: 'delete' }), [])).toEqual({ type: 'none' });
  });

  it('Delete は配線モードでも選択中の電線を削除する（電線一覧・3Dのどちらで選んでも外れる）', () => {
    expect(deleteKeyToAction(state({ selectedWire: 'w-002' }), [])).toEqual({
      type: 'removeWire',
      wireId: 'w-002',
    });
    expect(deleteKeyToAction(state({ selectedWire: 'fw-chk-2' }), ['fw-chk-2'])).toEqual({
      type: 'reject',
      message: LOCKED_WIRE_MESSAGE,
    });
  });

  it('Delete は見直し（再生）中は何もしない', () => {
    expect(deleteKeyToAction(state({ selectedWire: 'w-002', replaying: true }), [])).toEqual({
      type: 'none',
    });
  });
});

describe('shouldIgnoreShortcut（入力中はショートカットを止める。§8.2）', () => {
  /** タグ名だけを持つ最小の「宛先」（DOM が無くても検査できる）。 */
  const tag = (tagName: string): unknown => ({ tagName });

  it('入力欄・テキストエリア・セレクトに宛てたキーは無視する', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea', 'select']) {
      expect(shouldIgnoreShortcut({ target: tag(tagName) }), tagName).toBe(true);
    }
  });

  it('編集可能な要素に宛てたキーも無視する', () => {
    expect(shouldIgnoreShortcut({ target: { tagName: 'DIV', isContentEditable: true } })).toBe(
      true,
    );
  });

  it('IME の変換中はどこに宛てられていても無視する', () => {
    expect(shouldIgnoreShortcut({ target: tag('BODY'), isComposing: true })).toBe(true);
    expect(shouldIgnoreShortcut({ target: null, isComposing: true })).toBe(true);
  });

  it('盤（キャンバス）や本文へのキーは通す', () => {
    expect(shouldIgnoreShortcut({ target: tag('CANVAS') })).toBe(false);
    expect(shouldIgnoreShortcut({ target: tag('BODY') })).toBe(false);
    expect(shouldIgnoreShortcut({ target: tag('BUTTON') })).toBe(false);
    expect(shouldIgnoreShortcut({ target: null })).toBe(false);
  });

  it('チェックボックスなど文字を打たない入力部品に宛てたキーは通す（電線一覧で選んだあとも Delete が効く）', () => {
    for (const type of [
      'checkbox',
      'radio',
      'button',
      'submit',
      'reset',
      'color',
      'file',
      'range',
    ]) {
      expect(shouldIgnoreShortcut({ target: { tagName: 'INPUT', type } }), type).toBe(false);
    }
    for (const type of ['text', 'search', 'number', 'password', '']) {
      expect(shouldIgnoreShortcut({ target: { tagName: 'INPUT', type } }), type).toBe(true);
    }
  });

  it('isTypingTarget は単体でも使える（宛先の判定だけ）', () => {
    expect(isTypingTarget(tag('INPUT'))).toBe(true);
    expect(isTypingTarget(tag('CANVAS'))).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe('新しいツールモード（Plan 2B Task 2）', () => {
  it('テスターモードと指摘モードでは pickToAction は判断しない（専用の純関数が持つ）', () => {
    const hit: PickHit = {
      kind: 'terminal',
      id: toTerminalId('S1.13'),
      wirable: true,
      label: 'CR1 ⑬ −',
    };
    for (const mode of ['tester', 'report'] as const) {
      expect(
        pickToAction(
          { mode, pendingTerminal: undefined, selectedWire: undefined, wireColor: '青' },
          hit,
        ),
      ).toEqual({ type: 'none' });
    }
  });
});
