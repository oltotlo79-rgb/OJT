import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/app/App.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { EMPTY_SNAPSHOT, TOAST_LIMIT, useStore } from '../src/renderer/app/store.js';

/**
 * 外枠（例外バナー・トースト）のテスト。設計仕様 §13 #5 / §8.2。
 *
 * 画面そのものは差し替える。ここで見たいのは「ルートの描画が落ちたときに外枠が生き残るか」
 * であって、どの画面が出るかではないため（3D を含む本物の画面は happy-dom では描けない）。
 */

const BOOM = '描画で落ちました';
const routeMock = vi.hoisted(() => ({ throwing: false }));

vi.mock('../src/renderer/app/routes.js', () => ({
  renderRoute: () => {
    if (routeMock.throwing) throw new Error(BOOM);
    return createElement('div', { 'data-testid': 'route' });
  },
}));

/** React の偽タイマ。スケジューラを壊さないよう最小限だけ差し替える。 */
const FAKE_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;

beforeEach(() => {
  routeMock.throwing = false;
  useStore.setState({
    route: 'home',
    toasts: [],
    logLines: [],
    fatalError: undefined,
    webglLost: false,
    judge: undefined,
    sessionEpoch: 0,
    snapshot: EMPTY_SNAPSHOT,
    reportedDroppedTicks: 0,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('例外バナー（§13 #5）', () => {
  it('描画中に投げられても外枠は残り、日本語のバナーとリセットボタンが出る', () => {
    // React は境界が拾った例外を console.error に流す。テスト出力を汚さないよう黙らせる
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    routeMock.throwing = true;
    render(<App />);

    const banner = screen.getByTestId('error-banner');
    expect(banner.textContent).toContain(JA.error.banner);
    expect(banner.textContent).toContain(BOOM);
    expect(screen.getByRole('button', { name: JA.error.reset })).toBeTruthy();
    // 落ちた部分木は描かれない（外枠だけが残る）
    expect(screen.queryByTestId('route')).toBeNull();
  });

  it('「セッションをリセット」で世代が進み、直った画面がまた描かれる', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    routeMock.throwing = true;
    render(<App />);
    expect(screen.getByTestId('error-banner')).toBeTruthy();

    routeMock.throwing = false;
    fireEvent.click(screen.getByRole('button', { name: JA.error.reset }));

    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(screen.getByTestId('route')).toBeTruthy();
    expect(useStore.getState().sessionEpoch).toBe(1);
  });

  it('非同期の未捕捉例外もバナーに出る', () => {
    render(<App />);
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'Worker が落ちました' }));
    });
    expect(screen.getByTestId('error-banner').textContent).toContain('Worker が落ちました');
  });
});

describe('トースト（§8.2）', () => {
  it('3秒おきに6件出しても22秒後には1件も残らない', () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
    vi.setSystemTime(0);
    render(<App />);

    for (let i = 0; i < 6; i += 1) {
      act(() => {
        useStore.getState().toast(`失敗 ${i}`, 'error');
        vi.advanceTimersByTime(3000);
      });
    }
    expect(screen.queryAllByTestId('toast').length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryAllByTestId('toast')).toHaveLength(0);
  });

  it('一度に10件出しても画面には新しい5件しか出ない', () => {
    render(<App />);
    act(() => {
      for (let i = 0; i < 10; i += 1) useStore.getState().toast(`失敗 ${i}`, 'error');
    });
    const shown = screen.queryAllByTestId('toast');
    expect(shown).toHaveLength(TOAST_LIMIT);
    expect(shown[0]?.textContent).toBe('失敗 5');
  });
});
