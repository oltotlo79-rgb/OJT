import { BUILTIN_PROBLEMS, BUILTIN_INSPECT_PARTS_PROBLEMS } from '@ojt/content';
import { toTerminalId } from '@ojt/circuit-sim';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/ipc.js';
import { useStore } from '../src/renderer/app/store.js';
import { isModalOpen } from '../src/renderer/session/interaction.js';
import { useHelpStore } from '../src/renderer/help/help-store.js';
import { HelpDrawer } from '../src/renderer/help/HelpDrawer.js';
import { Settings } from '../src/renderer/screens/Settings.js';
import { TourOverlay } from '../src/renderer/tour/TourOverlay.js';
import { tourRotationChanged, useTourStore } from '../src/renderer/tour/tour-store.js';
import { cloneSession, runPlug, runAddWire } from '../src/renderer/session/commands.js';

const saved = vi.fn((patch: object) => Promise.resolve({ ...DEFAULT_SETTINGS, ...patch }));
beforeEach(() => {
  saved.mockClear();
  Object.defineProperty(window, 'ojt', {
    configurable: true,
    value: {
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      setSettings: saved,
    },
  });
  useStore.getState().abandonSession();
  useStore.getState().openProblem(BUILTIN_PROBLEMS[0]!);
  useHelpStore.getState().closeHelp();
  useTourStore.setState({
    loaded: true,
    done: false,
    requested: false,
    step: null,
    canvas: document.createElement('canvas'),
  });
});
afterEach(() => {
  cleanup();
  delete (window as { ojt?: unknown }).ojt;
  useTourStore.setState({ canvas: null, step: null });
});

describe('初回操作ガイド', () => {
  it('初回のモードBだけで表示し、閉じたことを保存して次の課題では再表示しない', async () => {
    render(<TourOverlay />);
    expect(screen.getByTestId('tour-guide')).toHaveAttribute('data-step', 'rotate');
    expect(isModalOpen()).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ tourDone: true }));
    expect(screen.queryByTestId('tour-guide')).toBeNull();
    expect(isModalOpen()).toBe(false);
    await act(() => useStore.getState().openProblem(BUILTIN_PROBLEMS[1]!));
    expect(screen.queryByTestId('tour-guide')).toBeNull();
  });
  it.each(['tour-later', 'tour-never'])('%sも完了状態を保存する', async (id) => {
    render(<TourOverlay />);
    fireEvent.click(screen.getByTestId(id));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ tourDone: true }));
  });
  it('WebGLが準備できない間とコンテキスト喪失中は操作を覆わない', () => {
    useTourStore.setState({ canvas: null });
    render(<TourOverlay />);
    expect(screen.queryByTestId('tour-guide')).toBeNull();
    act(() => useTourStore.getState().setCanvas(document.createElement('canvas')));
    expect(screen.getByTestId('tour-guide')).toBeTruthy();
    act(() => useStore.getState().setWebglLost(true));
    expect(screen.queryByTestId('tour-guide')).toBeNull();
    expect(isModalOpen()).toBe(false);
  });
  it('C1では表示しない', () => {
    useStore.getState().openProblem(BUILTIN_INSPECT_PARTS_PROBLEMS[0]!);
    render(<TourOverlay />);
    expect(screen.queryByTestId('tour-guide')).toBeNull();
  });
  it('読んだだけでは進まず、回転・装着・配線・通電・判定の実操作で進む', () => {
    render(<TourOverlay />);
    const step = () => screen.getByTestId('tour-guide').getAttribute('data-step');
    act(() => useTourStore.getState().advance('wire'));
    expect(step()).toBe('rotate');
    fireEvent.click(screen.getByTestId('tour-rotate'));
    expect(useStore.getState().camera).toBe('top');
    expect(step()).toBe('mount');
    act(() => {
      const next = useStore.getState().session!;
      const result = runPlug(next, 'S1', 'relay-my4n');
      if (!result.ok) throw new Error('装着に失敗');
      useStore.getState().setSession(cloneSession(next));
    });
    expect(step()).toBe('wire');
    act(() => {
      const next = useStore.getState().session!;
      const result = runAddWire(next, toTerminalId('P.1'), toTerminalId('TB_PB.2c'), '青');
      if (!result.ok) throw new Error('配線に失敗');
      useStore.getState().setSession(cloneSession(next));
    });
    expect(step()).toBe('power');
    act(() => useStore.setState((s) => ({ snapshot: { ...s.snapshot, breakerOn: true } })));
    expect(step()).toBe('power');
    act(() =>
      useStore.setState((s) => ({ snapshot: { ...s.snapshot, switchOn: true, powered: true } })),
    );
    expect(step()).toBe('judge');
    act(() => useStore.getState().setJudging(true));
    expect(screen.queryByTestId('tour-guide')).toBeNull();
    expect(saved).toHaveBeenCalledWith({ tourDone: true });
  });
  it('設定から再表示を予約し、回路組立の課題選択へ進む', async () => {
    useTourStore.setState({ done: true });
    useStore.getState().setRoute('settings');
    render(<Settings />);
    fireEvent.click(await screen.findByTestId('setting-restart-tour'));
    expect(useTourStore.getState().requested).toBe(true);
    expect(useStore.getState()).toMatchObject({ route: 'list', listMode: 'assemble' });
    cleanup();
    useStore.getState().openProblem(BUILTIN_PROBLEMS[0]!);
    render(<TourOverlay />);
    expect(screen.getByTestId('tour-guide')).toBeTruthy();
  });
  it('ヘルプの再表示は現在の作業を捨てない', () => {
    useTourStore.setState({ done: true });
    const session = useStore.getState().session;
    const onClose = vi.fn();
    render(<HelpDrawer onClose={onClose} />);
    fireEvent.click(screen.getByTestId('help-restart-tour'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(useTourStore.getState().requested).toBe(true);
    expect(useStore.getState().session).toBe(session);
  });
  it('クリックだけでは回転完了にしない', () => {
    expect(tourRotationChanged([0, 1], [0, 1])).toBe(false);
    expect(tourRotationChanged([0, 1], [0.001, 1])).toBe(false);
    expect(tourRotationChanged([0, 1], [0.2, 1])).toBe(true);
  });
  it('保存失敗を知らせ、現在の起動中は再び表示しない', async () => {
    saved.mockRejectedValueOnce(new Error('write failed'));
    render(<TourOverlay />);
    fireEvent.click(screen.getByTestId('tour-later'));
    await waitFor(() =>
      expect(useStore.getState().toasts.at(-1)?.text).toContain('保存できませんでした'),
    );
    expect(useTourStore.getState().done).toBe(true);
  });
});
