import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { addWire } from '@ojt/board-model';
import { terminalId } from '@ojt/circuit-sim';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemChangeDialog } from '../src/renderer/app/ProblemNavigation.js';
import { useStore } from '../src/renderer/app/store.js';
import { Home } from '../src/renderer/screens/Home.js';
import { currentLabProblem, newLabProblem } from '../src/renderer/session/lab.js';
import { boardForProblem } from '../src/renderer/session/plc-session.js';
import { useProblemNavigation } from '../src/renderer/session/problem-navigation.js';

/**
 * ホームの回路実験・PLC実験のカードと開始の窓（2026-10-08）。設計 §6.1
 */
const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({
    route: 'home',
    listMode: undefined,
    toasts: [],
    defaultVendor: 'jtekt',
    dialectId: 'mitsubishi',
  });
  useProblemNavigation.setState({ pending: undefined, busy: false, message: '' });
});

afterEach(() => {
  cleanup();
});

describe('ホームのカード', () => {
  it('6つのモードが並び、実験のカードは課題一覧ではなく開始の窓を開く', () => {
    render(<Home />);
    const cards = screen.getByTestId('mode-assemble').parentElement!.querySelectorAll('button');
    expect([...cards].map((card) => card.getAttribute('data-testid'))).toEqual([
      'mode-assemble',
      'mode-inspect-parts',
      'mode-inspect-repair',
      'mode-plc',
      'mode-assemble-lab',
      'mode-plc-lab',
    ]);
    expect(screen.getByTestId('mode-assemble-lab')).toHaveTextContent('回路実験');
    expect(screen.getByTestId('mode-plc-lab')).toHaveTextContent('配線済みの盤から始められます');
    fireEvent.click(screen.getByTestId('mode-assemble-lab'));
    expect(useStore.getState().route).toBe('home');
    expect(screen.getByTestId('lab-start')).toHaveTextContent('回路実験を始める');
    fireEvent.click(screen.getByTestId('lab-start-cancel'));
    expect(screen.queryByTestId('lab-start')).toBeNull();
  });
});

describe('開始の窓', () => {
  it('回路実験: 例題を選んで始めると、その押し方と正解で練習の画面へ進む', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('mode-assemble-lab'));
    expect(screen.queryByTestId('lab-start-prewired')).toBeNull();
    fireEvent.change(screen.getByTestId('lab-start-template'), { target: { value: 'on-delay' } });
    expect(screen.getByTestId('lab-start-template-note')).toHaveTextContent('3秒後');
    fireEvent.click(screen.getByTestId('lab-start-go'));
    const problem = currentLabProblem();
    expect(problem?.mode).toBe('assemble-lab');
    expect(problem?.durationMs).toBe(8_000);
    expect(problem?.expected?.length).toBeGreaterThan(0);
    expect(useStore.getState().route).toBe('session');
  });

  it('PLC実験: 既定メーカーの機種で、自分で配線する盤から始められる', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('mode-plc-lab'));
    expect(screen.getByTestId('lab-start')).toHaveTextContent('PC10G');
    expect(screen.getByTestId('lab-start-prewired')).toBeChecked();
    fireEvent.click(screen.getByTestId('lab-start-self-wire'));
    fireEvent.click(screen.getByTestId('lab-start-go'));
    const problem = currentLabProblem();
    expect(problem?.mode === 'plc-lab' && problem.plc.vendor).toBe('jtekt');
    expect(problem?.mode === 'plc-lab' && problem.prewired).toBe(false);
    expect(problem?.operations).toEqual([]);
    expect(useStore.getState().session?.wires).toEqual([]);
  });

  it('同じ実験の途中なら「いまの実験を続ける」で戻り、作業は置き換えない', () => {
    useStore
      .getState()
      .openProblem(newLabProblem('assemble-lab', { vendor: 'mitsubishi', prewired: true }));
    const session = useStore.getState().session;
    useStore.setState({ route: 'home' });
    render(<Home />);
    fireEvent.click(screen.getByTestId('mode-assemble-lab'));
    fireEvent.click(screen.getByTestId('lab-start-resume'));
    expect(useStore.getState().route).toBe('session');
    expect(useStore.getState().session).toBe(session);
  });

  it('途中の作業があれば、新しく始める前に確認する', () => {
    useStore
      .getState()
      .openProblem(newLabProblem('assemble-lab', { vendor: 'mitsubishi', prewired: true }));
    const session = structuredClone(useStore.getState().session!);
    expect(
      addWire(
        session,
        boardForProblem(useStore.getState().problem),
        terminalId('P', '1'),
        terminalId('TB_PB', '1c'),
        '青',
      ).ok,
    ).toBe(true);
    useStore.getState().setSession(session);
    useStore.setState({ route: 'home' });
    render(
      <>
        <Home />
        <ProblemChangeDialog />
      </>,
    );
    fireEvent.click(screen.getByTestId('mode-assemble-lab'));
    fireEvent.click(screen.getByTestId('lab-start-go'));
    expect(screen.getByTestId('problem-change-confirm')).toHaveTextContent(
      'いまの実験を置き換えて、新しく始めますか？',
    );
    // まだ置き換えていない
    expect(useStore.getState().session?.wires).toHaveLength(1);
  });
});
