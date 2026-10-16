import { PLC_UNIT_CP1E, PLC_UNIT_FX5U } from '@ojt/board-model';
import { MITSUBISHI_FX5U, OMRON_CP1E } from '@ojt/plc-dialects';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import type { PlcMonitorSnapshot } from '../src/renderer/app/store-types.js';
import { MonitorPanel } from '../src/renderer/ladder/MonitorPanel.js';
import { endNetwork, network, no, out, program, X, Y } from '@ojt/ladder-core';

/** PLC に書き込んだまま（エディタと同じ）のプログラム。モニタはこのプログラムの値を映す（v2.1.0 監査 P1）。 */
const WRITTEN_PROGRAM = program(network('n1', [[no(X(0)), out(Y(0))]]), endNetwork());
const WRITTEN = {
  converted: true,
  ladder: WRITTEN_PROGRAM,
  plcProgram: WRITTEN_PROGRAM,
  plcProgramSource: WRITTEN_PROGRAM,
} as const;

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
    plcProgram: undefined,
    plcProgramSource: undefined,
  });
});

afterEach(cleanup);

describe('モニタ一覧（§10.7）', () => {
  it('asks to convert and write a program first while the PLC has none (v2.1.0 監査 P1)', () => {
    panel();
    const note = screen.getByTestId('monitor-no-program');
    expect(note).toHaveTextContent('先に変換（F4）して');
    expect(note).toHaveTextContent('シーケンサへの書込み');
    cleanup();
    // 変換済みなら書込みだけを案内する
    useStore.setState({ converted: true });
    panel();
    expect(screen.getByTestId('monitor-no-program')).not.toHaveTextContent('先に変換');
  });

  /** OMRON は書込みの操作の名前（転送［PC → PLC］）で案内する（レビュー B1 を引き継ぐ）。 */
  it('names the vendor write operation under each skin (B1 / v2.1.0)', () => {
    render(<MonitorPanel profile={OMRON_CP1E} unit={PLC_UNIT_CP1E} onPlc={vi.fn()} />);
    const note = screen.getByTestId('monitor-no-program');
    expect(note).toHaveTextContent('転送［PC → PLC］');
    expect(note).not.toHaveTextContent('F4');
  });

  it('says the monitor shows the PLC program when the editor has unwritten changes', () => {
    useStore.setState({
      ...WRITTEN,
      ladder: program(network('n1', [[no(X(1))]]), endNetwork()),
      plcMonitor: snapshot(),
    });
    panel();
    expect(screen.getByTestId('monitor-stale')).toBeInTheDocument();
  });

  it('asks to start monitoring, then to RUN, once converted (I3 / Plan 4B Task 3)', () => {
    useStore.setState({ ...WRITTEN });
    panel();
    // モニタを始めていないうちはスナップショットが来ないのが当たり前なので、そう案内する
    // （キーは方言プロファイルから。`JA.ladder.monitorOff` の関数化。前提#22）
    expect(screen.getByTestId('monitor-no-snapshot')).toHaveTextContent('モニタ（F3）');
    cleanup();
    useStore.setState({ ...WRITTEN, ladderMode: 'monitor' });
    panel();
    expect(screen.getByTestId('monitor-no-snapshot')).toHaveTextContent('RUN');
  });

  /**
   * 指摘 LE-7: OMRON の `shortcuts` は `monitor` 行を持たない。以前は `?? 'F3'` で埋めていた
   * ため、存在しないキーを教えていた。`monitorStartLabel()` はツールバー項目名へ倒す。
   */
  it('names the OMRON toolbar label, not the invented F3 (LE-7)', () => {
    useStore.setState({ ...WRITTEN });
    render(<MonitorPanel profile={OMRON_CP1E} unit={PLC_UNIT_CP1E} onPlc={vi.fn()} />);
    const note = screen.getByTestId('monitor-no-snapshot');
    expect(note).not.toHaveTextContent('F3');
    expect(note).toHaveTextContent('Ctrl+M');
  });

  it('lists the devices with the dialect name and the unit terminal name (決定表#16)', () => {
    useStore.setState({
      plcMonitor: snapshot(),
      ladderMode: 'monitor',
      plcRunning: true,
      ...WRITTEN,
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
    useStore.setState({ plcMonitor: snapshot(), ladderMode: 'monitor', ...WRITTEN });
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
      ...WRITTEN,
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
