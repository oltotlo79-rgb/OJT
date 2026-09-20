import type { SocketId } from '@ojt/board-model';
import { MAX_WIRES_PER_TERMINAL, toTerminalId, type TerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import {
  hoverHintFor,
  intentOf,
  isTerminalFull,
  legalTargets,
  pickToAction,
  REFUSE_REASONS,
  refuseMessage,
  refuseMessageKey,
  type InteractionState,
  type PickHit,
} from '../src/renderer/session/interaction.js';

/**
 * 直接操作の意図（Phase 7 Task 27 / 設計 §7.3.1・§7.5）。
 *
 * 3Dのクリック・3Dのドラッグ・端子リスト・部品パレットと入口は増えたが、「何が起きるか」を
 * 決めるのは `intentOf()` 1箇所だけである。ここが**対象 × 状態**の全分岐を縛る。
 */

const T1 = toTerminalId('CR1.9');
const T2 = toTerminalId('CR1.10');
const T3 = toTerminalId('P.1');
const S1 = 'S1' as SocketId;
/** ホバー予告の文脈（電源はどちらも切）。 */
const POWER_OFF = { breakerOn: false, switchOn: false };
const S2 = 'S2' as SocketId;

/** 既定の状態（配線モード・何も選んでいない・何も運んでいない）。 */
function state(patch: Partial<InteractionState> = {}): InteractionState {
  return {
    mode: 'wire',
    pendingTerminal: undefined,
    selectedWire: undefined,
    wireColor: '青',
    ...patch,
  };
}

function terminalHit(id: TerminalId, wirable = true): PickHit {
  return { kind: 'terminal', id, wirable, label: String(id) };
}

describe('intentOf（対象で決まるモードレス操作。設計 §7.2 案B）', () => {
  it('電源の操作部はどのモードでも入切になる（触ったものが反応する）', () => {
    for (const mode of ['wire', 'delete', 'tester', 'report'] as const) {
      expect(intentOf(state({ mode }), { kind: 'fixture', fixture: 'breaker' })).toEqual({
        type: 'togglePower',
        fixture: 'breaker',
      });
      expect(intentOf(state({ mode }), { kind: 'fixture', fixture: 'switch' })).toEqual({
        type: 'togglePower',
        fixture: 'switch',
      });
    }
  });

  it('端子は1本目 → 2本目で配線になり、同じ端子をもう一度押すと取り消しになる', () => {
    expect(intentOf(state(), terminalHit(T1))).toEqual({ type: 'beginWire', from: T1 });
    expect(intentOf(state({ pendingTerminal: T1 }), terminalHit(T1))).toEqual({
      type: 'cancelWire',
    });
    expect(intentOf(state({ pendingTerminal: T1 }), terminalHit(T2))).toEqual({
      type: 'completeWire',
      from: T1,
      to: T2,
      color: '青',
    });
  });

  it('配線できない端子は理由をつけて断る', () => {
    expect(intentOf(state(), terminalHit(T1, false))).toEqual({
      type: 'refuse',
      reason: 'not-wirable',
    });
  });

  it('2本で一杯の端子でも手は止めない（実機で起こせる操作は危険操作として数える。§5.6 #5）', () => {
    const full = state({
      pendingTerminal: T1,
      terminals: [
        { id: T1, wireCount: 1 },
        { id: T2, wireCount: MAX_WIRES_PER_TERMINAL },
      ],
    });
    // ここで断ると `addWire()` まで届かず `terminal-overload` が計上されなくなる
    expect(intentOf(full, terminalHit(T2))).toEqual({
      type: 'completeWire',
      from: T1,
      to: T2,
      color: '青',
    });
    // 代わりに**押す前に**理由を言う（設計 §7.3.4 のホバー予告）
    expect(hoverHintFor(full, terminalHit(T2), POWER_OFF)).toBe(JA.refuse.terminalFull);
    expect(isTerminalFull(full, T2)).toBe(true);
    expect(isTerminalFull(full, T1)).toBe(false);
  });

  it('端子の本数を渡していなければ従来どおり配線が始まる（端子リストからの入口）', () => {
    expect(intentOf(state(), terminalHit(T2))).toEqual({ type: 'beginWire', from: T2 });
    expect(hoverHintFor(state(), terminalHit(T2), POWER_OFF)).toBe(JA.hoverHint.wireBegin);
  });

  it('ソケットは空なら選択、埋まっていれば装着部品の選択になる', () => {
    expect(intentOf(state(), { kind: 'socket', id: S1, occupied: false })).toEqual({
      type: 'selectSocket',
      socketId: S1,
    });
    expect(intentOf(state(), { kind: 'socket', id: S1, occupied: true })).toEqual({
      type: 'selectMounted',
      socketId: S1,
    });
  });

  it('配線中にソケット・押ボタン・地の部分を押すと配線を取り消す', () => {
    const wiring = state({ pendingTerminal: T1 });
    expect(intentOf(wiring, { kind: 'socket', id: S1, occupied: false })).toEqual({
      type: 'cancelWire',
    });
    expect(intentOf(wiring, { kind: 'pushbutton', id: 'PB1' })).toEqual({ type: 'cancelWire' });
    expect(intentOf(wiring, { kind: 'empty' })).toEqual({ type: 'cancelWire' });
  });

  it('押ボタンは配線中でなければ押せる。地の部分は何も起きない', () => {
    expect(intentOf(state(), { kind: 'pushbutton', id: 'PB1' })).toEqual({
      type: 'pressButton',
      pbId: 'PB1',
    });
    expect(intentOf(state(), { kind: 'empty' })).toEqual({ type: 'none' });
  });

  it('削除モードは電線を選び、既設配線は断り、地の部分で選択を解く', () => {
    const del = state({ mode: 'delete' });
    expect(intentOf(del, { kind: 'wire', id: 'w-1', locked: false })).toEqual({
      type: 'selectWire',
      wireId: 'w-1',
    });
    expect(intentOf(del, { kind: 'wire', id: 'w-1', locked: true })).toEqual({
      type: 'refuse',
      reason: 'locked-wire',
    });
    expect(intentOf(state({ mode: 'delete', selectedWire: 'w-1' }), { kind: 'empty' })).toEqual({
      type: 'selectWire',
      wireId: '',
    });
    expect(intentOf(del, terminalHit(T1))).toEqual({ type: 'none' });
  });

  it('テスター／指摘モードは専用の純関数に任せる（電源の操作部を除く）', () => {
    for (const mode of ['tester', 'report'] as const) {
      expect(intentOf(state({ mode }), terminalHit(T1))).toEqual({ type: 'none' });
      expect(intentOf(state({ mode }), { kind: 'socket', id: S1, occupied: false })).toEqual({
        type: 'none',
      });
    }
  });
});

describe('intentOf（運搬中。設計 §7.3.3）', () => {
  const carryingPalette = state({ dragging: { source: 'palette', kind: 'relay-my4n' } });
  const carryingMounted = state({
    dragging: { source: 'socket', socketId: S1, kind: 'relay-my4n' },
  });

  it('パレットの部品は空きソケットの上で放すと装着になる', () => {
    expect(intentOf(carryingPalette, { kind: 'socket', id: S2, occupied: false })).toEqual({
      type: 'dropPart',
      socketId: S2,
      kind: 'relay-my4n',
    });
  });

  it('埋まっているソケットとソケット以外の場所は理由をつけて断る', () => {
    expect(intentOf(carryingPalette, { kind: 'socket', id: S2, occupied: true })).toEqual({
      type: 'refuse',
      reason: 'socket-occupied',
    });
    expect(intentOf(carryingPalette, { kind: 'empty' })).toEqual({
      type: 'refuse',
      reason: 'not-a-socket',
    });
    expect(intentOf(carryingPalette, terminalHit(T1))).toEqual({
      type: 'refuse',
      reason: 'not-a-socket',
    });
  });

  it('盤の部品はソケットの外へ放すと取り外し、元のソケットへ戻せば何も起きない', () => {
    expect(intentOf(carryingMounted, { kind: 'empty' })).toEqual({
      type: 'unplugPart',
      socketId: S1,
    });
    expect(intentOf(carryingMounted, { kind: 'socket', id: S2, occupied: false })).toEqual({
      type: 'unplugPart',
      socketId: S1,
    });
    expect(intentOf(carryingMounted, { kind: 'socket', id: S1, occupied: true })).toEqual({
      type: 'none',
    });
  });

  it('運搬中は電源の操作部より運搬が優先する（持ったまま入切しない）', () => {
    expect(intentOf(carryingPalette, { kind: 'fixture', fixture: 'breaker' })).toEqual({
      type: 'refuse',
      reason: 'not-a-socket',
    });
  });
});

describe('legalTargets（設計 §7.3.1）', () => {
  const terminals = [
    { id: T1, wireCount: 0 },
    { id: T2, wireCount: MAX_WIRES_PER_TERMINAL },
    { id: T3, wireCount: 1 },
  ];

  it('2本で一杯の端子を外す', () => {
    expect(legalTargets(state({ terminals }))).toEqual([T1, T3]);
  });

  it('1本目に選んでいる端子そのものも外す（同じ端子は取り消しであって接続先ではない）', () => {
    expect(legalTargets(state({ terminals, pendingTerminal: T1 }))).toEqual([T3]);
  });

  it('端子を渡していなければ空（光らせるものが無い）', () => {
    expect(legalTargets(state())).toEqual([]);
  });
});

describe('断る理由の文言（設計 §7.3.1）', () => {
  it('すべての理由が `JA.refuse` の文言を持つ', () => {
    for (const reason of REFUSE_REASONS) {
      const key = refuseMessageKey(reason);
      expect(JA.refuse[key]).toBeTypeOf('string');
      expect(JA.refuse[key].length).toBeGreaterThan(0);
      expect(refuseMessage(reason)).toBe(JA.refuse[key]);
    }
  });

  it('理由は重複しない鍵を持つ（別の断りが同じ文になっていない）', () => {
    const keys = REFUSE_REASONS.map(refuseMessageKey);
    expect(new Set(keys).size).toBe(REFUSE_REASONS.length);
  });
});

describe('pickToAction（`intentOf()` を呼ぶ薄い層）', () => {
  it('断る意図だけが文言つきの `reject` になり、ほかはそのまま通る', () => {
    expect(pickToAction(state(), terminalHit(T1, false))).toEqual({
      type: 'reject',
      message: JA.refuse.notWirable,
    });
    expect(pickToAction(state(), terminalHit(T1))).toEqual({ type: 'beginWire', from: T1 });
    expect(pickToAction(state(), { kind: 'fixture', fixture: 'switch' })).toEqual({
      type: 'togglePower',
      fixture: 'switch',
    });
  });
});
