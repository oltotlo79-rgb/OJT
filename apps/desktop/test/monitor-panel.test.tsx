import { PLC_UNIT_CP1E, PLC_UNIT_FX5U } from '@ojt/board-model';
import { MITSUBISHI_FX5U, OMRON_CP1E } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
import { MonitorPanel } from '../src/renderer/ladder/MonitorPanel.js';

function snapshot(overrides: Partial<PlcMonitorSnapshot> = {}): PlcMonitorSnapshot {
  return {
    scanCount: 12,
    tMs: 120,
    powered: {},
    inputs: [true, false, false],
    outputs: [false, true],
    internals: { 0: true },
    timers: { 0: { elapsedMs: 1200, on: false, presetMs: 3000 } },
    counters: { 0: { value: 2, on: false } },
    ...overrides,
  };
}

function panel(onPlc = vi.fn()): ReturnType<typeof vi.fn> {
  render(<MonitorPanel profile={MITSUBISHI_FX5U} unit={PLC_UNIT_FX5U} onPlc={onPlc} />);
  return onPlc;
}

beforeEach(() => {
  useStore.setState({
    plcMonitor: undefined,
    plcRunning: false,
    ladderMode: 'write',
    converted: false,
  });
});

afterEach(cleanup);

describe('モニタ一覧（§10.7）', () => {
  it('asks to convert first while the ladder is not converted (I3)', () => {
    panel();
    expect(screen.getByTestId('monitor-not-converted')).toHaveTextContent('F4');
  });

  /** レビュー B1: OMRON（`convertStep: false`）は押す場所が無いので変換キーを名乗らない。 */
  it('says conversion happens automatically under a skin with no 変換 key (B1)', () => {
    render(<MonitorPanel profile={OMRON_CP1E} unit={PLC_UNIT_CP1E} onPlc={vi.fn()} />);
    const note = screen.getByTestId('monitor-not-converted');
    expect(note).not.toHaveTextContent('先に変換');
    expect(note).not.toHaveTextContent('F4');
    expect(note).toHaveTextContent('自動で変換します');
  });

  it('asks to start monitoring, then to RUN, once converted (I3 / Plan 4B Task 3)', () => {
    useStore.setState({ converted: true });
    panel();
    // モニタを始めていないうちはスナップショットが来ないのが当たり前なので、そう案内する
    // （キーは方言プロファイルから。`JA.ladder.monitorOff` の関数化。前提#22）
    expect(screen.getByTestId('monitor-no-snapshot')).toHaveTextContent('モニタ（F3）');
    cleanup();
    useStore.setState({ converted: true, ladderMode: 'monitor' });
    panel();
    expect(screen.getByTestId('monitor-no-snapshot')).toHaveTextContent('RUN');
  });

  /**
   * 指摘 LE-7: OMRON の `shortcuts` は `monitor` 行を持たない。以前は `?? 'F3'` で埋めていた
   * ため、存在しないキーを教えていた。`monitorStartLabel()` はツールバー項目名へ倒す。
   */
  it('names the OMRON toolbar label, not the invented F3 (LE-7)', () => {
    useStore.setState({ converted: true });
    render(<MonitorPanel profile={OMRON_CP1E} unit={PLC_UNIT_CP1E} onPlc={vi.fn()} />);
    const note = screen.getByTestId('monitor-no-snapshot');
    expect(note).not.toHaveTextContent('F3');
    expect(note).toHaveTextContent('モニタ開始');
  });

  it('lists the devices with the dialect name and the unit terminal name (決定表#16)', () => {
    useStore.setState({
      plcMonitor: snapshot(),
      ladderMode: 'monitor',
      plcRunning: true,
      converted: true,
    });
    panel();
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('X0');
    // 端子名は機種仕様（`unit.spec.inputs[i].name`）から引く。FX5U の入力0は `X0`（Task 8 で型だけ変えた）
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('PLC.X0');
    expect(screen.getByTestId('monitor-input-0')).toHaveTextContent('ON');
    expect(screen.getByTestId('monitor-output-1')).toHaveTextContent('Y1');
    expect(screen.getByTestId('monitor-output-1')).toHaveTextContent('ON');
    expect(screen.getByTestId('monitor-internal-0')).toHaveTextContent('M0');
    // 経過 / 設定（Batch 3 レビュー M4）
    expect(screen.getByTestId('monitor-timer-0')).toHaveTextContent('1.2');
    expect(screen.getByTestId('monitor-timer-0')).toHaveTextContent('3.0');
    expect(screen.getByTestId('monitor-counter-0')).toHaveTextContent('2');
    expect(screen.getByTestId('monitor-scan')).toHaveTextContent('12');
  });

  it('names the FX5U input spec, not the engine defaults (3A レビュー指摘)', () => {
    useStore.setState({ plcMonitor: snapshot(), ladderMode: 'monitor', converted: true });
    panel();
    const note = screen.getByTestId('monitor-spec');
    expect(note).toHaveTextContent('4.5');
    expect(note).toHaveTextContent('3.5');
    expect(note).not.toHaveTextContent('4.7');
  });

  /** UI監査 2026-09-20 Important #9: RUN/STOP の重複を消した。正はスキンのツールバー1つだけ。 */
  it('has no RUN/STOP button of its own any more (UI監査 Important #9)', () => {
    panel();
    expect(screen.queryByTestId('monitor-run')).toBeNull();
  });

  it('explains why nothing moves while the PLC is stopped', () => {
    useStore.setState({
      plcMonitor: snapshot(),
      ladderMode: 'monitor',
      plcRunning: false,
      converted: true,
    });
    panel();
    expect(screen.getByTestId('monitor-stopped')).toHaveTextContent('RUN');
  });

  it('resets the devices from the panel', () => {
    const onPlc = panel();
    fireEvent.click(screen.getByTestId('plc-reset'));
    expect(onPlc).toHaveBeenCalledWith({ kind: 'reset' });
  });
});
