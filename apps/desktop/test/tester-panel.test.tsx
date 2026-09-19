import { toTerminalId, voltRangesFor } from '@ojt/circuit-sim';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
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

  it('アナログのACVのレンジ一覧は voltRangesFor(ACV) と一致する', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ACV' }));
    const ranges = screen.getByTestId('tester-ranges');
    for (const range of voltRangesFor('ACV')) {
      expect(ranges.textContent).toContain(String(range));
    }
  });

  it('アナログの OFF ではレンジ欄を出さない（M13）', () => {
    useStore.setState({ tester: { ...useStore.getState().tester, kind: 'analog', mode: 'off' } });
    render(<TesterPanel />);
    expect(screen.queryByTestId('tester-ranges')).toBeNull();
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

  it('押せない理由を title と一行の説明の両方で出す（UXレビュー #5）', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'DCV' }));
    const zero = screen.getByRole('button', { name: '0Ω ADJ' });
    expect(zero).toHaveAttribute('title', JA.disabledReason.zeroAdjust);
    expect(screen.getByTestId('zero-disabled-reason')).toHaveTextContent(
      JA.disabledReason.zeroAdjust,
    );
  });

  it('押せるときは title も一行の説明も出さない（UXレビュー #5）', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ω' }));
    const zero = screen.getByRole('button', { name: '0Ω ADJ' });
    expect(zero).not.toHaveAttribute('title');
    expect(screen.queryByTestId('zero-disabled-reason')).toBeNull();
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

  it('導通ブザー鳴動中の文言は読値の「導通」と重複しない（レビュー指摘）', () => {
    useStore.setState({
      snapshot: {
        ...useStore.getState().snapshot,
        tester: {
          kind: 'digital',
          mode: 'CONT',
          value: 0,
          display: '導通',
          targetDeg: 0,
          needleDeg: 0,
          overRange: false,
          live: false,
          conductive: true,
        },
      },
    });
    render(<TesterPanel />);
    expect(screen.getByTestId('tester-readout').textContent).toBe('導通');
    expect(screen.getByTestId('tester-buzz').textContent).toBe('ブザー鳴動中');
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

describe('読値の単位（レビュー指摘）', () => {
  function setTester(
    overrides: Partial<ReturnType<typeof useStore.getState>['snapshot']['tester']>,
  ) {
    useStore.setState({
      snapshot: {
        ...useStore.getState().snapshot,
        tester: {
          kind: 'digital',
          mode: 'off',
          value: Number.NaN,
          display: 'OFF',
          targetDeg: 0,
          needleDeg: 0,
          overRange: false,
          live: false,
          conductive: false,
          ...overrides,
        },
      },
    });
  }

  it('Ω測定は単位「Ω」を別要素に出す（生の display は変えない）', () => {
    setTester({ mode: 'OHM', value: 650, display: '650.0' });
    render(<TesterPanel />);
    expect(screen.getByTestId('tester-readout').textContent).toBe('650.0');
    expect(screen.getByTestId('tester-unit').textContent).toBe('Ω');
  });

  it('DCV測定は単位「V」を出す', () => {
    setTester({ mode: 'DCV', value: 12, display: '12.0' });
    render(<TesterPanel />);
    expect(screen.getByTestId('tester-unit').textContent).toBe('V');
  });

  it('ACV測定は単位「V」を出す', () => {
    setTester({ mode: 'ACV', value: 100, display: '100.0' });
    render(<TesterPanel />);
    expect(screen.getByTestId('tester-unit').textContent).toBe('V');
  });

  it('導通レンジは単位を出さない', () => {
    setTester({ mode: 'CONT', value: 0, display: '導通', conductive: true });
    render(<TesterPanel />);
    expect(screen.queryByTestId('tester-unit')).toBeNull();
  });

  it('OL（振り切れ）のΩは単位を出さない', () => {
    setTester({ mode: 'OHM', value: Number.NaN, display: 'OL', overRange: true });
    render(<TesterPanel />);
    expect(screen.queryByTestId('tester-unit')).toBeNull();
  });

  it('プローブ未配置（----）のΩは単位を出さない', () => {
    setTester({ mode: 'OHM', value: Number.NaN, display: '----' });
    render(<TesterPanel />);
    expect(screen.queryByTestId('tester-unit')).toBeNull();
  });

  it('OFF は単位を出さない', () => {
    setTester({ mode: 'off', display: 'OFF' });
    render(<TesterPanel />);
    expect(screen.queryByTestId('tester-unit')).toBeNull();
  });
});

describe('a11y（種別・つまみ・レンジのグループ化）', () => {
  it('種別の行に role=group と aria-label が付く', () => {
    render(<TesterPanel />);
    expect(screen.getByRole('group', { name: JA.tester.kindGroup })).toBeTruthy();
  });

  it('つまみの行に role=group と aria-label が付く', () => {
    render(<TesterPanel />);
    expect(screen.getByRole('group', { name: JA.tester.modeGroup })).toBeTruthy();
  });

  it('レンジの行に role=group が付き、レンジ見出しで名付けられる（アナログ選択時）', () => {
    render(<TesterPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'アナログ' }));
    fireEvent.click(screen.getByRole('button', { name: 'DCV' }));
    expect(screen.getByRole('group', { name: JA.tester.range })).toBeTruthy();
  });
});
