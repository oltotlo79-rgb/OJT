import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as BoardSceneModule from '../src/renderer/three/BoardScene.js';

/**
 * 回路実験の練習画面（2026-10-08）。組立の画面を使い、回路図・模範回路の代わりに
 * 「タイムチャート実験」の欄と実験の手順帯を出す。設計 §6.2
 */
const workerMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));

vi.mock('../src/renderer/three/BoardScene.js', async () => {
  const actual = await vi.importActual<typeof BoardSceneModule>(
    '../src/renderer/three/BoardScene.js',
  );
  return {
    safeRoutes: actual.safeRoutes,
    visualSignature: actual.visualSignature,
    BoardScene: () => createElement('div', { 'data-testid': 'board-canvas-stub' }),
  };
});
vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(workerMock));

const { SessionRoute } = await import('../src/renderer/screens/SessionRoute.js');
const { useStore } = await import('../src/renderer/app/store.js');
const { newLabProblem } = await import('../src/renderer/session/lab.js');

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ route: 'home', defaultVendor: 'mitsubishi', dialectId: 'mitsubishi' });
  workerMock.sent.length = 0;
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

describe('回路実験の練習画面', () => {
  it('組立の画面に実験の欄を出し、回路図ヒント・回路図エディタ・仕様のチャートは出さない', () => {
    openLab();
    render(<SessionRoute />);
    expect(screen.getByTestId('lab-panel')).toBeInTheDocument();
    expect(screen.getByTestId('board-canvas-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('schematic-hint')).toBeNull();
    expect(screen.queryByTestId('chart-panel')).toBeNull();
    expect(screen.queryByTestId('view-switch')).toBeNull();
    // ライブのチャートと部品パネルは組立と同じ
    expect(screen.getByTestId('live-panel')).toBeInTheDocument();
    expect(screen.getByTestId('parts-panel')).toBeInTheDocument();
    // ワーカーに盤を読ませる
    expect(workerMock.sent.some((command) => command['type'] === 'load')).toBe(true);
  });

  it('手順帯は「押し方を描く → 正解（任意）→ 配線 → 動かす → 判定」', () => {
    openLab();
    render(<SessionRoute />);
    expect(screen.getByTestId('step-guide')).toHaveTextContent('押し方を描く');
    expect(screen.getByTestId('step-guide')).toHaveTextContent('正解を描く（任意）');
    expect(screen.getByTestId('step-inputs')).toHaveTextContent('いまここ');
    expect(screen.getByTestId('step-hint')).toHaveTextContent('大きく開いて編集');
  });

  it('判定ボタンは正解が無いと押せず、理由を出す。正解があれば実験の判定を頼む', () => {
    openLab();
    const { unmount } = render(<SessionRoute />);
    const judge = screen.getByTestId('judge-button');
    expect(judge).toHaveAttribute('aria-disabled', 'true');
    expect(judge.getAttribute('title')).toBe('正解のランプの動きを描くと判定できます');
    fireEvent.click(judge);
    expect(workerMock.sent.some((command) => command['type'] === 'labRun')).toBe(false);
    unmount();

    openLab('self-hold');
    render(<SessionRoute />);
    fireEvent.click(screen.getByTestId('judge-button'));
    const sent = workerMock.sent.at(-1);
    expect(sent?.['type']).toBe('labRun');
    expect(sent?.['judge']).toBe(true);
  });

  it('F2 で回路図の表示へ切り替わらない（回路実験に回路図エディタは無い）', () => {
    openLab();
    render(<SessionRoute />);
    fireEvent.keyDown(window, { key: 'F2' });
    expect(useStore.getState().assembleView).toBe('board');
  });

  it('戻るとホームへ（実験は課題一覧に無い）', () => {
    openLab();
    render(<SessionRoute />);
    expect(screen.getByTestId('session-back')).toHaveTextContent('ホームへ戻る');
    fireEvent.click(screen.getByTestId('session-back'));
    expect(useStore.getState().route).toBe('home');
  });
});
