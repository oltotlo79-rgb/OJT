import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  buildReferenceSession,
  judgeAssembleLab,
  type AssembleLabProblem,
} from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { LabChartEditor } from '../src/renderer/lab/LabChartEditor.js';
import { LabChartPanel } from '../src/renderer/lab/LabChartPanel.js';
import { currentLabProblem, newLabProblem } from '../src/renderer/session/lab.js';

/**
 * タイムチャートの編集窓と実験の欄（2026-10-08）。設計 §6.2 / §6.3
 */
const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

/** 編集窓の viewBox の幅（`LabChartEditor.tsx` の寸法と同じ）。 */
const VIEW_WIDTH = 176 + 800 + 26;
const LABEL_WIDTH = 176;
const PLOT_WIDTH = 800;

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ route: 'home', defaultVendor: 'mitsubishi', dialectId: 'mitsubishi' });
  bridgeMock.sent.length = 0;
});

afterEach(() => {
  cleanup();
});

function openLab(templateId?: string): void {
  useStore.getState().openProblem(
    newLabProblem('assemble-lab', {
      vendor: 'mitsubishi',
      prewired: true,
      ...(templateId === undefined ? {} : { templateId }),
    }),
  );
}

function lab(): AssembleLabProblem {
  return currentLabProblem() as AssembleLabProblem;
}

/** 長さ `durationMs` のチャートで時刻 `ms` を指す clientX（viewBox と同じ幅で描いたとき）。 */
function clientXOf(ms: number, durationMs: number): number {
  return LABEL_WIDTH + (ms / durationMs) * PLOT_WIDTH;
}

/** 編集窓の SVG を viewBox と同じ大きさで置いたことにする（happy-dom は配置を計算しない）。 */
function sizeCanvas(): SVGSVGElement {
  const svg = screen.getByTestId('lab-editor-chart') as unknown as SVGSVGElement;
  svg.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: VIEW_WIDTH,
      height: 400,
      right: VIEW_WIDTH,
      bottom: 400,
    }) as DOMRect;
  return svg;
}

describe('編集窓', () => {
  it('押ボタンの行をドラッグすると押している区間になる（0.1秒へ吸着）', () => {
    openLab();
    render(<LabChartEditor onClose={() => {}} />);
    const svg = sizeCanvas();
    const duration = lab().durationMs;
    fireEvent.pointerDown(screen.getByTestId('lab-row-hit-PB1'), {
      button: 0,
      pointerId: 1,
      clientX: clientXOf(1_020, duration),
    });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: clientXOf(2_480, duration) });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: clientXOf(2_480, duration) });
    expect(lab().operations).toEqual([
      { t: 1_000, target: 'PB1', action: 'press' },
      { t: 2_500, target: 'PB1', action: 'release' },
    ]);
    expect(screen.getByTestId('lab-row-PB1').getAttribute('data-intervals')).toBe('1000-2500');
  });

  it('点いている所から引くと消し、クリックだけなら0.1秒ぶんを塗る', () => {
    openLab('self-hold');
    render(<LabChartEditor onClose={() => {}} />);
    const svg = sizeCanvas();
    const duration = lab().durationMs;
    // 正解 PL1 [520, 3020) の中ほどを消す
    fireEvent.pointerDown(screen.getByTestId('lab-row-hit-PL1'), {
      button: 0,
      pointerId: 2,
      clientX: clientXOf(1_000, duration),
    });
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: clientXOf(2_000, duration) });
    fireEvent.pointerUp(svg, { pointerId: 2 });
    expect(lab().expected).toEqual([
      {
        signal: 'PL1',
        on: [
          [520, 1_000],
          [2_000, 3_020],
        ],
      },
    ]);
    // PB3 の 4.25秒あたりをクリック → [4200, 4300)
    fireEvent.pointerDown(screen.getByTestId('lab-row-hit-PB3'), {
      button: 0,
      pointerId: 3,
      clientX: clientXOf(4_250, duration),
    });
    fireEvent.pointerUp(svg, { pointerId: 3 });
    expect(screen.getByTestId('lab-row-PB3').getAttribute('data-intervals')).toBe('4200-4300');
  });

  it('区間の一覧から秒を打ち込んで描ける（キーボードだけで描ける）', () => {
    openLab();
    render(<LabChartEditor onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('lab-interval-PB2-add'));
    expect(screen.getByTestId('lab-row-PB2').getAttribute('data-intervals')).toBe('500-1500');
    const to = screen.getByTestId('lab-interval-PB2-0-to');
    fireEvent.change(to, { target: { value: '2.25' } });
    fireEvent.keyDown(to, { key: 'Enter' });
    expect(screen.getByTestId('lab-row-PB2').getAttribute('data-intervals')).toBe('500-2250');
    // 読めない値は元に戻し、理由を出す
    const from = screen.getByTestId('lab-interval-PB2-0-from');
    fireEvent.change(from, { target: { value: 'あ' } });
    fireEvent.blur(from);
    expect((from as HTMLInputElement).value).toBe('0.5');
    expect(useStore.getState().toasts.at(-1)?.text).toContain('0.01 秒単位');
    fireEvent.click(screen.getByTestId('lab-interval-PB2-0-delete'));
    expect(lab().operations).toEqual([]);
  });

  it('長さ・例題・消す・判定の印', () => {
    openLab();
    render(<LabChartEditor onClose={() => {}} />);
    const duration = screen.getByTestId('lab-duration');
    fireEvent.change(duration, { target: { value: '12.5' } });
    fireEvent.keyDown(duration, { key: 'Enter' });
    expect(lab().durationMs).toBe(12_500);
    fireEvent.change(duration, { target: { value: '0.5' } });
    fireEvent.blur(duration);
    expect(lab().durationMs).toBe(12_500);
    expect((duration as HTMLInputElement).value).toBe('12.5');

    fireEvent.change(screen.getByTestId('lab-template'), { target: { value: 'interlock' } });
    expect(lab().durationMs).toBe(8_000);
    expect(lab().expected?.map((row) => row.signal)).toEqual(['PL1', 'PL2']);

    fireEvent.click(screen.getByTestId('lab-judged-PL3'));
    expect(lab().judge.compareSignals).toEqual(['PL1', 'PL2', 'PL4']);

    fireEvent.click(screen.getByTestId('lab-clear-expected'));
    expect(lab().expected).toBeUndefined();
    expect(screen.getByTestId('lab-clear-expected')).toBeDisabled();
    fireEvent.click(screen.getByTestId('lab-clear-inputs'));
    expect(lab().operations).toEqual([]);
  });

  it('動かした結果を確かめてから正解に取り込む', () => {
    openLab('self-hold');
    const reference = buildReferenceSession(BUILTIN_ASSEMBLE_PROBLEMS[0]!, JIPM_BOARD);
    if (!reference.ok) throw new Error('reference');
    useStore.getState().setSession(reference.value.session);
    render(<LabChartEditor onClose={() => {}} />);
    expect(screen.getByTestId('lab-capture')).toBeDisabled();
    fireEvent.click(screen.getByTestId('lab-run-in-editor'));
    expect(bridgeMock.sent.at(-1)?.['type']).toBe('labRun');
    // 正解を消してから、模範の盤で動かした結果を入れる
    act(() => {
      const problem = { ...lab() };
      delete problem.expected;
      useStore.setState({ problem });
      const outcome = judgeAssembleLab(problem, JIPM_BOARD, reference.value.session);
      if (!outcome.ok) throw new Error('judge');
      useStore.setState({ labRun: outcome.value, labRunning: false });
    });
    expect(screen.getByTestId('lab-editor-status')).toHaveTextContent('判定はしていません');
    fireEvent.click(screen.getByTestId('lab-capture'));
    fireEvent.click(screen.getByTestId('lab-capture-confirm'));
    expect(lab().expected).toEqual([{ signal: 'PL1', on: [[520, 3_020]] }]);
    expect(useStore.getState().labRun?.passed).toBe(true);
    expect(screen.getByTestId('lab-editor-status')).toHaveTextContent('正解どおり');
  });
});

describe('実験の欄', () => {
  it('正解が無ければ判定を押せず、理由を出す', () => {
    openLab();
    render(<LabChartPanel />);
    expect(screen.getByTestId('lab-judge')).toBeDisabled();
    expect(screen.getByTestId('lab-judge-reason')).toHaveTextContent(
      '正解のランプの動きを描くと判定できます',
    );
    expect(screen.getByTestId('lab-replay')).toBeDisabled();
    expect(screen.getByTestId('lab-status')).toHaveTextContent('まだ動かしていません');
  });

  it('動かす・判定をワーカーへ頼む', () => {
    openLab('self-hold');
    render(<LabChartPanel />);
    fireEvent.click(screen.getByTestId('lab-run'));
    expect(bridgeMock.sent.at(-1)?.['judge']).toBe(false);
    act(() => {
      useStore.setState({ labRunning: false });
    });
    fireEvent.click(screen.getByTestId('lab-judge'));
    expect(bridgeMock.sent.at(-1)?.['judge']).toBe(true);
  });

  it('大きく開いて編集し、閉じる', () => {
    openLab();
    render(<LabChartPanel />);
    fireEvent.click(screen.getByTestId('lab-open-editor'));
    expect(screen.getByTestId('lab-editor')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('lab-close'));
    expect(screen.queryByTestId('lab-editor')).toBeNull();
  });

  it('PLC実験は「配線をやり直す」で配線済みと自分で配線する盤を選び直せる', () => {
    useStore
      .getState()
      .openProblem(newLabProblem('plc-lab', { vendor: 'mitsubishi', prewired: true }));
    render(<LabChartPanel />);
    fireEvent.click(screen.getByTestId('lab-restart-board'));
    expect(screen.getByTestId('lab-restart-prewired')).toBeChecked();
    fireEvent.click(screen.getByTestId('lab-restart-self-wire'));
    fireEvent.click(screen.getByTestId('lab-restart-go'));
    const problem = currentLabProblem();
    expect(problem?.mode === 'plc-lab' && problem.prewired).toBe(false);
    expect(useStore.getState().session?.wires).toEqual([]);
    expect(screen.queryByTestId('lab-restart')).toBeNull();
  });
});
