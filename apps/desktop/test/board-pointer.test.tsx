import { describe, expect, it } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import { hintForIntent, type Intent } from '../src/renderer/session/interaction.js';
import {
  CURSOR_FOR,
  cursorFor,
  dragKindOf,
  INTERACT_DRAG_THRESHOLD_PX,
} from '../src/renderer/three/BoardScene.js';
import { createPickDragGuard } from '../src/renderer/three/navigation.js';
import { segmentTransform } from '../src/renderer/three/WirePreview.js';

/**
 * 3D盤のポインタの作法（Phase 7 Task 27 / 設計 §7.3.1・§7.3.4）。
 *
 * `navigation.spec.ts` の「視点を回したドラッグでは端子を拾わない」の**単体版**にあたる。
 * 3Dのイベントそのものは `Canvas` の中でしか流れないので、振り分けを決めている
 * 純粋な値（しきい値・ドラッグの種類・カーソル・予告の文）だけを縛る。
 */

describe('クリックとドラッグの振り分け（設計 §7.3.1）', () => {
  it('しきい値は 4px', () => {
    expect(INTERACT_DRAG_THRESHOLD_PX).toBe(4);
  });

  it('4px 未満のまま放せばクリック、超えたらドラッグ', () => {
    const guard = createPickDragGuard(INTERACT_DRAG_THRESHOLD_PX);
    guard.down(100, 100);
    guard.move(102, 101);
    expect(guard.dragged()).toBe(false);
    guard.move(104, 100);
    expect(guard.dragged()).toBe(true);
  });

  it('斜めの移動も直線距離で見る（縦横それぞれは 4px 未満でも合計で超える）', () => {
    const guard = createPickDragGuard(INTERACT_DRAG_THRESHOLD_PX);
    guard.down(0, 0);
    guard.move(3, 3);
    expect(guard.dragged()).toBe(true);
  });

  it('一度ドラッグと決まったら、戻ってきてもクリックには戻らない', () => {
    const guard = createPickDragGuard(INTERACT_DRAG_THRESHOLD_PX);
    guard.down(0, 0);
    guard.move(40, 0);
    guard.move(0, 0);
    expect(guard.dragged()).toBe(true);
  });
});

describe('ドラッグの種類（端子から始めたドラッグは視点を回さない）', () => {
  it('端子＝配線、盤の部品＝運搬、それ以外＝視点の回転', () => {
    expect(dragKindOf({ terminal: { id: 'S1.9' }, part: undefined })).toBe('wire');
    expect(dragKindOf({ terminal: undefined, part: { socketId: 'S1' } })).toBe('carry');
    expect(dragKindOf({ terminal: undefined, part: undefined })).toBe('view');
  });

  it('端子と部品の両方が立っていれば配線を優先する（端子のほうが細かい対象）', () => {
    expect(dragKindOf({ terminal: { id: 'S1.9' }, part: { socketId: 'S1' } })).toBe('wire');
  });
});

describe('カーソル（設計 §7.3.4）', () => {
  it('対象ごとに変わる', () => {
    expect(cursorFor('terminal', false)).toBe('crosshair');
    expect(cursorFor('press', false)).toBe('pointer');
    expect(cursorFor('grab', false)).toBe('grab');
    expect(cursorFor('ground', false)).toBe('move');
  });

  it('運搬中は指しているものに関わらず `grabbing`', () => {
    for (const subject of Object.keys(CURSOR_FOR) as Array<keyof typeof CURSOR_FOR>) {
      expect(cursorFor(subject, true)).toBe('grabbing');
    }
  });

  it('4種類の対象がそれぞれ別のカーソルを持つ（取り違えない）', () => {
    const shapes = [CURSOR_FOR.terminal, CURSOR_FOR.press, CURSOR_FOR.grab, CURSOR_FOR.ground];
    expect(new Set(shapes).size).toBe(4);
  });
});

describe('ホバー予告は意図から作る（設計 §7.3.4）', () => {
  const off = { breakerOn: false, switchOn: false };
  const on = { breakerOn: true, switchOn: false };

  it('ブレーカは入切の向きで文が変わる', () => {
    expect(hintForIntent({ type: 'togglePower', fixture: 'breaker' }, off)).toBe(
      JA.hoverHint.breakerOn,
    );
    expect(
      hintForIntent({ type: 'togglePower', fixture: 'breaker' }, { ...off, breakerOn: true }),
    ).toBe(JA.hoverHint.breakerOff);
  });

  it('電源スイッチはブレーカが切のとき「先にブレーカを入れます」に変わる', () => {
    expect(hintForIntent({ type: 'togglePower', fixture: 'switch' }, off)).toBe(
      JA.hoverHint.switchOffFirst,
    );
    expect(hintForIntent({ type: 'togglePower', fixture: 'switch' }, on)).toBe(
      JA.hoverHint.switchOn,
    );
    // 入っていれば「切ります」に変わる
    expect(
      hintForIntent({ type: 'togglePower', fixture: 'switch' }, { ...on, switchOn: true }),
    ).toBe(JA.hoverHint.switchOff);
  });

  it('断る理由はそのまま予告に出る（押す前に理由が分かる）', () => {
    expect(hintForIntent({ type: 'refuse', reason: 'terminal-full' }, off)).toBe(
      JA.refuse.terminalFull,
    );
  });

  it('配線・ソケット・運搬にもそれぞれ文がある', () => {
    const cases: Array<[Intent, string]> = [
      [{ type: 'beginWire', from: 'CR1.9' as never }, JA.hoverHint.wireBegin],
      [
        { type: 'completeWire', from: 'CR1.9' as never, to: 'CR1.10' as never, color: '青' },
        JA.hoverHint.wireFinish,
      ],
      [{ type: 'selectSocket', socketId: 'S1' as never }, JA.hoverHint.socketEmpty],
      [{ type: 'selectMounted', socketId: 'S1' as never }, JA.hoverHint.socketMounted],
      [{ type: 'dropPart', socketId: 'S1' as never, kind: 'relay-my4n' }, JA.hoverHint.carrying],
      [{ type: 'unplugPart', socketId: 'S1' as never }, JA.hoverHint.carryingMounted],
      [{ type: 'pressButton', pbId: 'PB1' }, JA.hoverHint.pushButton],
    ];
    for (const [intent, text] of cases) {
      expect(hintForIntent(intent, off), intent.type).toBe(text);
    }
  });

  it('予告するものが無ければ `undefined`（呼び出し側が最初の一手を出す）', () => {
    expect(hintForIntent({ type: 'none' }, off)).toBeUndefined();
    expect(hintForIntent({ type: 'cancelWire' }, off)).toBeUndefined();
  });
});

describe('仮の電線（`WirePreview`。設計 §7.3.2）', () => {
  it('2点の中点に置き、長さは2点の距離になる', () => {
    const { position, length } = segmentTransform([0, 0, 0], [0, 10, 0]);
    expect(position).toEqual([0, 5, 0]);
    expect(length).toBeCloseTo(10, 10);
  });

  it('同じ点どうしなら長さ0（描かない）', () => {
    expect(segmentTransform([3, 4, 5], [3, 4, 5]).length).toBe(0);
  });

  it('斜めでも長さは直線距離', () => {
    expect(segmentTransform([0, 0, 0], [3, 4, 0]).length).toBeCloseTo(5, 10);
  });
});
