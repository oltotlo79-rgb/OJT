import { toTerminalId } from '@ojt/circuit-sim';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { TesterPanel } from '../src/renderer/panels/TesterPanel.js';

/**
 * テスターパネル（Plan 2B Task 5）。設計仕様 §9.3。
 */

const sent: unknown[] = [];

vi.mock('../src/renderer/session/worker-bridge.js', () => ({
  bridge: {
    send: (command: unknown) => {
      sent.push(command);
    },
  },
}));

beforeEach(() => {
  sent.length = 0;
  useStore.setState({
    tester: {
      kind: 'digital',
      mode: 'off',
      voltRange: 50,
      ohmRange: 10,
      black: undefined,
      red: undefined,
      zeroAdjusted: false,
      needleDeg: 0,
      rangeExceededReported: false,
    },
    nextProbe: 'black',
    snapshot: { ...useStore.getState().snapshot },
  });
});

afterEach(() => {
  cleanup();
});

describe('つまみ（§9.3）', () => {
  it('5位置を並べ、押すとストアと Worker の両方へ届く', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'DCV' }));
    expect(useStore.getState().tester.mode).toBe('DCV');
    expect(sent).toContainEqual({ type: 'tester', action: { type: 'set-mode', mode: 'DCV' } });
    for (const label of ['OFF', 'DCV', 'ACV', 'Ω', '導通']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('選んでいるつまみに aria-pressed が付く', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Ω' }));
    expect(screen.getByRole('button', { name: 'Ω' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'DCV' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('種別とレンジ（§9.3）', () => {
  it('デジタルはオートレンジなのでレンジ欄を出さない', () => {
    render(<TesterPanel />);
    expect(screen.queryByTestId('tester-ranges')).toBeNull();
    expect(screen.getByTestId('tester-autorange')).toBeTruthy();
  });

  it('アナログのDCVは 2.5 / 10 / 50 / 250 を出す', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'DCV' }));
    const ranges = screen.getByTestId('tester-ranges');
    expect(ranges.textContent).toContain('2.5');
    expect(ranges.textContent).toContain('250');
  });

  it('アナログのΩは ×1 / ×10 / ×1k を出し、0Ω調整が押せる', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ω' }));
    expect(screen.getByTestId('tester-ranges').textContent).toContain('×1k');
    const zero = screen.getByRole('button', { name: '0Ω ADJ' });
    expect(zero.hasAttribute('disabled')).toBe(false);
    fireEvent.click(zero);
    expect(useStore.getState().tester.zeroAdjusted).toBe(true);
    expect(sent).toContainEqual({ type: 'tester', action: { type: 'zero-adjust' } });
  });

  it('0Ω調整はレンジを変えるとやり直しになる（§9.3）', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ω' }));
    fireEvent.click(screen.getByRole('button', { name: '0Ω ADJ' }));
    fireEvent.click(screen.getByRole('button', { name: '×1k' }));
    expect(useStore.getState().tester.zeroAdjusted).toBe(false);
  });

  it('DCVでは0Ω調整を押せない', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'DCV' }));
    expect(screen.getByRole('button', { name: '0Ω ADJ' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('プローブ（§9.3）', () => {
  it('未配置なら「未配置」と出し、押すと次に置く側になる', () => {
    render(<TesterPanel />);
    expect(screen.getByTestId('probe-red').textContent).toContain('未配置');
    fireEvent.click(screen.getByTestId('probe-red'));
    expect(useStore.getState().nextProbe).toBe('red');
  });

  it('配置済みなら端子IDを出し、「外す」で外せる', () => {
    useStore.setState({
      tester: { ...useStore.getState().tester, black: toTerminalId('CHK.13') },
    });
    render(<TesterPanel />);
    expect(screen.getByTestId('probe-black').textContent).toContain('CHK.13');
    fireEvent.click(screen.getByTestId('lift-black'));
    expect(useStore.getState().tester.black).toBeUndefined();
    expect(sent).toContainEqual({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: undefined },
    });
  });
});

describe('表示器（§9.3）', () => {
  it('Worker の読値をそのまま出す', () => {
    useStore.setState({
      snapshot: {
        ...useStore.getState().snapshot,
        tester: {
          kind: 'digital',
          mode: 'OHM',
          value: 650,
          display: '650.0 Ω',
          targetDeg: 0,
          needleDeg: 0,
          overRange: false,
          live: false,
          conductive: false,
        },
      },
    });
    render(<TesterPanel />);
    expect(screen.getByTestId('tester-readout').textContent).toBe('650.0 Ω');
  });

  it('通電中のΩ測定は測定不能の理由を添える（§5.6 #1）', () => {
    useStore.setState({
      snapshot: {
        ...useStore.getState().snapshot,
        tester: {
          kind: 'digital',
          mode: 'OHM',
          value: Number.NaN,
          display: '----',
          targetDeg: 0,
          needleDeg: 0,
          overRange: false,
          live: true,
          conductive: false,
        },
      },
    });
    render(<TesterPanel />);
    expect(screen.getByTestId('tester-readout').textContent).toBe('----');
    expect(screen.getByTestId('tester-live-note')).toBeTruthy();
  });
});
