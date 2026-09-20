import { afterEach, describe, expect, it } from 'vitest';
import { focusablesIn, trapFocus } from '../src/renderer/app/focus-trap.js';

/**
 * モーダルのフォーカス閉じ込め（指摘 UI-06）。設計仕様 §8.1。
 *
 * 以前は `TimeChartView` / `HelpDrawer` / `SchematicView` に3実装あり、3つとも仕様が違って
 * いた（外へ逃げたフォーカスを戻すのは1つだけ、`disabled` を除くのも1つだけ）。
 * ここで固定するのは**上位互換の2点**である。
 */

let panel: HTMLElement | undefined;

afterEach(() => {
  panel?.remove();
  panel = undefined;
  document.body.innerHTML = '';
});

/** パネル（モーダルの中身）と、その外にあるボタンを1つ置く。 */
function mount(inner: string): { outside: HTMLButtonElement; panel: HTMLElement } {
  const outside = document.createElement('button');
  outside.textContent = '外のボタン';
  document.body.append(outside);
  const host = document.createElement('div');
  host.innerHTML = inner;
  document.body.append(host);
  panel = host;
  return { outside, panel: host };
}

/** `Tab`（`shift` 付きも選べる）の `keydown` を作る。 */
function tab(shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
}

describe('trapFocus（UI-06）', () => {
  it('フォーカスがパネルの外にあるとき Tab で内側の先頭へ戻る', () => {
    const { outside, panel: host } = mount('<button id="a">A</button><button id="b">B</button>');
    outside.focus();
    expect(document.activeElement).toBe(outside);

    const event = tab();
    trapFocus(host, event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('フォーカスが外にあるとき Shift+Tab では内側の末尾へ戻る', () => {
    const { outside, panel: host } = mount('<button id="a">A</button><button id="b">B</button>');
    outside.focus();

    const event = tab(true);
    trapFocus(host, event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('先頭が disabled のとき次の有効な要素へ移る', () => {
    const { panel: host } = mount(
      '<button id="a" disabled>A</button><button id="b">B</button><button id="c">C</button>',
    );
    const last = host.querySelector<HTMLElement>('#c');
    last?.focus();
    expect(document.activeElement?.id).toBe('c');

    // 末尾から1つ進むと先頭へ回るが、押せない `A` は飛び先にしない
    const event = tab();
    trapFocus(host, event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('隠れている要素（[hidden]）も飛び先にしない', () => {
    const { panel: host } = mount(
      '<button id="a" hidden>A</button><button id="b">B</button><button id="c">C</button>',
    );
    host.querySelector<HTMLElement>('#c')?.focus();

    trapFocus(host, tab());

    expect(document.activeElement?.id).toBe('b');
    expect(focusablesIn(host).map((element) => element.id)).toEqual(['b', 'c']);
  });

  it('中ほどにフォーカスがあるときは何もしない（ブラウザの巡回に任せる）', () => {
    const { panel: host } = mount(
      '<button id="a">A</button><button id="b">B</button><button id="c">C</button>',
    );
    host.querySelector<HTMLElement>('#b')?.focus();

    const event = tab();
    trapFocus(host, event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe('b');
  });

  it('飛び先が1つも無いパネルでは何もしない', () => {
    const { outside, panel: host } = mount('<p>本文だけ</p>');
    outside.focus();

    const event = tab();
    trapFocus(host, event);
    trapFocus(null, tab());

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside);
  });
});
