import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { SessionRoute } from '../src/renderer/screens/SessionRoute.js';
import { newLabProblem } from '../src/renderer/session/lab.js';
import { bridge } from '../src/renderer/session/worker-bridge.js';
import type * as BoardSceneModule from '../src/renderer/three/BoardScene.js';
import type { SimCommand } from '../src/worker/protocol.js';

/**
 * PLC実験の練習画面（2026-10-08）。PLCの画面を使い、仕様のチャートの代わりに
 * 「タイムチャート実験」の欄と、配線済みかどうかの表示を出す。設計 §6.2 / D3
 */
vi.mock('../src/renderer/three/BoardScene.js', async (importOriginal) => {
  const actual = await importOriginal<typeof BoardSceneModule>();
  return { ...actual, BoardScene: () => <div data-testid="board-canvas" /> };
});

const sent: SimCommand[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.spyOn(bridge, 'start').mockImplementation(() => undefined);
  vi.spyOn(bridge, 'stop').mockImplementation(() => undefined);
  vi.spyOn(bridge, 'send').mockImplementation((command) => {
    sent.push(command);
  });
  useStore.getState().abandonSession();
  useStore.setState({ defaultVendor: 'mitsubishi', dialectId: 'mitsubishi' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openPlcLab(prewired: boolean, templateId?: string): void {
  useStore.getState().openProblem(
    newLabProblem('plc-lab', {
      vendor: 'mitsubishi',
      prewired,
      ...(templateId === undefined ? {} : { templateId }),
    }),
  );
}

describe('PLC実験の練習画面', () => {
  it('PLCの画面で開き、実験の欄と盤の種類を出す（仕様のチャートは出さない）', () => {
    openPlcLab(true);
    render(<SessionRoute />);
    expect(screen.getByTestId('plc-session')).toBeInTheDocument();
    expect(screen.getByTestId('lab-panel')).toBeInTheDocument();
    expect(screen.getByTestId('lab-wiring-mode')).toHaveTextContent('配線済み');
    expect(screen.queryByTestId('chart-panel')).toBeNull();
    expect(screen.queryByTestId('plc-show-chart')).toBeNull();
    expect(screen.getByTestId('ladder-workspace')).toBeInTheDocument();
    const load = sent.find((command) => command.type === 'load');
    expect(load?.type === 'load' && load.plcModel).toBe('FX5U');
    // 実験では入力の強制（診断用）を使ってよい
    expect(load?.type === 'load' && load.allowPlcForcing).toBe(true);
  });

  it('手順帯: 配線済みの盤なら配線は済み、ラダーを作る段が「いまここ」に来る', () => {
    openPlcLab(true, 'self-hold');
    render(<SessionRoute />);
    expect(screen.getByTestId('plc-step-inputs')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('plc-step-expected')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('plc-step-ladder')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('plc-step-wire')).toHaveAttribute('data-state', 'done');
    // ラダーの段の案内はメーカーのキーを出す
    expect(screen.getByTestId('plc-hint').textContent).toMatch(/F5|F7|＝/u);
  });

  it('自分で配線する盤は配線の段が残り、盤の種類も「自分で配線」', () => {
    openPlcLab(false);
    render(<SessionRoute />);
    expect(screen.getByTestId('lab-wiring-mode')).toHaveTextContent('自分で配線');
    expect(screen.getByTestId('plc-step-wire')).not.toHaveAttribute('data-state', 'done');
  });

  it('判定ボタンは正解が無いと押せない。正解があって変換済みなら実験の判定を頼む', () => {
    openPlcLab(true);
    const view = render(<SessionRoute />);
    expect(screen.getByTestId('judge-button')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('judge-button').getAttribute('title')).toBe(
      '正解のランプの動きを描くと判定できます',
    );
    view.unmount();

    openPlcLab(true, 'self-hold');
    useStore.setState({ converted: true });
    render(<SessionRoute />);
    fireEvent.click(screen.getByTestId('judge-button'));
    const last = sent.at(-1);
    expect(last?.type).toBe('labRun');
    expect(last?.type === 'labRun' && last.judge).toBe(true);
    expect(last?.type === 'labRun' && last.ladder).toEqual(useStore.getState().ladder);
  });

  it('戻るとホームへ', () => {
    openPlcLab(true);
    render(<SessionRoute />);
    fireEvent.click(screen.getByTestId('session-back'));
    expect(useStore.getState().route).toBe('home');
  });
});
