import {
  C,
  ctu,
  endNetwork,
  hline,
  network,
  no,
  program,
  ton,
  T,
  X,
  type LadderProgram,
} from '@ojt/ladder-core';
import { JTEKT_PC10G, MITSUBISHI_FX5U, OMRON_CP1E, SHARP_JW300 } from '@ojt/plc-dialects';
import type { DialectProfile } from '@ojt/plc-dialects';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
import { LadderGrid } from '../src/renderer/ladder/LadderGrid.js';
import { skinThemeOf } from '../src/renderer/ladder/skins/index.js';

/**
 * モニタ中のタイマ・カウンタの現在値（v2.1.0 監査 P5）。
 *
 * 実機のソフトはモニタ中、タイマ・カウンタの命令の近くに現在値を出す。本アプリは回路ブロックの
 * 見出しの右に「T0 現在値 12（設定 K30）」の形で並べる。三菱は0から設定値へ数える加算式、
 * オムロン・シャープは設定値から0へ数える減算式（PLC調査資料の命令表）。
 */

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useStore.setState({ plcMonitor: undefined });
});

/** n1: X0 ─ T0（3秒）、n2: X1 ─ C0（5回。X2 でリセット）。 */
function timed(): LadderProgram {
  return program(
    network('n1', [[no(X(0)), ...Array.from({ length: 14 }, () => hline()), ton(T(0), 3000)]]),
    network('n2', [[no(X(1)), ...Array.from({ length: 14 }, () => hline()), ctu(C(0), 5, X(2))]]),
    endNetwork(),
  );
}

/** T0 が 1.2 秒たち、C0 が 2 回数えたところ。 */
function snapshot(): PlcMonitorSnapshot {
  return {
    scanCount: 120,
    tMs: 1200,
    powered: {},
    inputs: [],
    outputs: [],
    internals: {},
    timers: { 0: { elapsedMs: 1200, on: false, presetMs: 3000 } },
    counters: { 0: { value: 2, on: false } },
  };
}

function grid(profile: DialectProfile, mode: 'monitor' | 'write'): void {
  render(
    <LadderGrid
      program={timed()}
      profile={profile}
      theme={skinThemeOf(profile)}
      cursor={{ networkId: 'n1', row: 0, col: 0 }}
      mode={mode}
      comments={{}}
      errorCells={new Set<string>()}
      gridCols={profile.gridCols}
      onPickCell={() => undefined}
    />,
  );
}

describe('モニタ中の現在値', () => {
  it('shows the count up to the preset on Mitsubishi (加算式)', () => {
    useStore.setState({ plcMonitor: snapshot() });
    grid(MITSUBISHI_FX5U, 'monitor');
    expect(screen.getByTestId('present-value-n1:0:15')).toHaveTextContent(
      'T0 現在値 12（設定 K30）',
    );
    expect(screen.getByTestId('present-value-n2:0:15')).toHaveTextContent('C0 現在値 2（設定 K5）');
    expect(screen.getByTestId('present-n1')).toHaveAttribute(
      'title',
      expect.stringContaining('加算式'),
    );
  });

  it('counts down from the preset on OMRON and SHARP (減算式)', () => {
    useStore.setState({ plcMonitor: snapshot() });
    grid(OMRON_CP1E, 'monitor');
    // 3.0秒 − 1.2秒 ＝ 残り 18（0.1秒単位）。カウンタは 5 − 2 ＝ 3
    expect(screen.getByTestId('present-value-n1:0:15')).toHaveTextContent(
      '現在値 0018（設定 #0030）',
    );
    expect(screen.getByTestId('present-value-n2:0:15')).toHaveTextContent(
      '現在値 0003（設定 #0005）',
    );
    expect(screen.getByTestId('present-n1')).toHaveAttribute(
      'title',
      expect.stringContaining('減算式'),
    );
    cleanup();
    grid(SHARP_JW300, 'monitor');
    expect(screen.getByTestId('present-value-n1:0:15')).toHaveTextContent(
      '現在値 0018（設定 0030）',
    );
  });

  it('writes JTEKT values in hexadecimal like the preset (前提)', () => {
    useStore.setState({ plcMonitor: snapshot() });
    grid(JTEKT_PC10G, 'monitor');
    expect(screen.getByTestId('present-value-n1:0:15')).toHaveTextContent(
      '現在値 000C（設定 H001E）',
    );
  });

  it('stops at the preset once the timer is up', () => {
    useStore.setState({
      plcMonitor: { ...snapshot(), timers: { 0: { elapsedMs: 9000, on: true, presetMs: 3000 } } },
    });
    grid(MITSUBISHI_FX5U, 'monitor');
    expect(screen.getByTestId('present-value-n1:0:15')).toHaveTextContent('現在値 30（設定 K30）');
  });

  it('shows nothing outside the monitor, or before the first snapshot', () => {
    useStore.setState({ plcMonitor: snapshot() });
    grid(MITSUBISHI_FX5U, 'write');
    expect(screen.queryByTestId('present-n1')).toBeNull();
    cleanup();
    useStore.setState({ plcMonitor: undefined });
    grid(MITSUBISHI_FX5U, 'monitor');
    expect(screen.queryByTestId('present-n1')).toBeNull();
  });
});
