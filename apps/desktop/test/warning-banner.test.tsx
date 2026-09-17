import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { WarningBanner } from '../src/renderer/panels/WarningBanner.js';

/**
 * Vitest はデフォルトで CSS Modules の内容を実際にDOMへ注入しない（クラス名の対応だけを
 * 解決する）ので `getComputedStyle()` では `position: fixed` を確認できない。
 * かわりに CSS ソース自体を読み、`.warnBanner` がレイアウトに幅を取らないオーバーレイに
 * なっていることを直接検証する（レビュー指摘: 警告バナーがツールバー・3D・パネルを
 * 押し下げ、6秒後の消灯で押し戻す＝R3Fキャンバスの毎回リサイズ）。
 */
const warningCss = readFileSync(
  join(process.cwd(), 'src/renderer/panels/warning.module.css'),
  'utf-8',
);

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

  it('レイアウトに幅を取らないオーバーレイになっている（position: fixed。レビュー指摘）', () => {
    useStore.setState({
      hazardBanner: { kind: 'ohm-on-live', detail: 'x', expiresAt: Date.now() + 1000 },
      hazards: [{ type: 'hazard', kind: 'ohm-on-live', tMs: 10, detail: 'x' }],
    });
    render(<WarningBanner />);
    // クラス名の対応だけは解決されるので、`.warnBanner` に割り振られたクラスが
    // 出ていることは確かめられる（実スタイルの検証はCSSソースそのものを見る）。
    expect(screen.getByTestId('hazard-banner').className).toBeTruthy();
    const rule = /\.warnBanner\s*\{([^}]*)\}/.exec(warningCss)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/left:\s*50%/);
    expect(rule).toMatch(/transform:\s*translateX\(-50%\)/);
    // チャートモーダルの背景(40)より上、トースト(50)より下（§8.2）。
    expect(rule).toMatch(/z-index:\s*45/);
    expect(rule).toMatch(/max-width:\s*min\(720px,\s*90vw\)/);
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
