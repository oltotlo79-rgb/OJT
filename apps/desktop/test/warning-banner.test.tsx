import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { WarningBanner } from '../src/renderer/panels/WarningBanner.js';

/**
 * 危険操作の警告バナー（Plan 2B Task 7）。設計仕様 §5.6 / §13 / §16 Phase 2 受入基準④。
 */

beforeEach(() => {
  useStore.setState({ hazardBanner: undefined, hazards: [], restoredHazardCount: 0 });
});

afterEach(() => {
  cleanup();
});

describe('WarningBanner', () => {
  it('危険操作が無ければ何も描かない', () => {
    render(<WarningBanner />);
    expect(screen.queryByTestId('hazard-banner')).toBeNull();
  });

  it('種別の日本語名・補足・ミス回数を出す（§5.6）', () => {
    useStore.setState({
      hazardBanner: {
        kind: 'ohm-on-live',
        detail: 'CHK.13 — CHK.14',
        expiresAt: Date.now() + 1000,
      },
      hazards: [
        { type: 'hazard', kind: 'ohm-on-live', tMs: 10, detail: 'a' },
        { type: 'hazard', kind: 'range-exceeded', tMs: 20, detail: 'b' },
      ],
    });
    render(<WarningBanner />);
    const banner = screen.getByTestId('hazard-banner');
    expect(banner.textContent).toContain('通電中のΩ／導通測定');
    expect(banner.textContent).toContain('CHK.13 — CHK.14');
    expect(screen.getByTestId('mistake-count').textContent).toContain('2');
  });

  it('復元した危険操作もミス回数に足す（§12.3）', () => {
    useStore.setState({
      hazardBanner: {
        kind: 'range-exceeded',
        detail: 'DCV 2.5V レンジ',
        expiresAt: Date.now() + 1000,
      },
      hazards: [{ type: 'hazard', kind: 'range-exceeded', tMs: 20, detail: 'b' }],
      restoredHazardCount: 3,
    });
    render(<WarningBanner />);
    expect(screen.getByTestId('mistake-count').textContent).toContain('4');
  });

  it('閉じるボタンで畳める', () => {
    useStore.setState({
      hazardBanner: { kind: 'ohm-on-live', detail: 'x', expiresAt: Date.now() + 1000 },
      hazards: [{ type: 'hazard', kind: 'ohm-on-live', tMs: 10, detail: 'x' }],
    });
    render(<WarningBanner />);
    fireEvent.click(screen.getByTestId('hazard-dismiss'));
    expect(useStore.getState().hazardBanner).toBeUndefined();
  });
});
