import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_PARTS_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { InspectPartsSession } from '../src/renderer/screens/InspectPartsSession.js';
import { testerShortcut } from '../src/renderer/session/tester.js';

/**
 * モードC1のセッション画面（Plan 2B Task 10）。設計仕様 §9.1 / §9.3 / §12.1。
 * 3D（`BoardScene`）は WebGL を要るので差し替え、`onPick` だけを取り出して検証する。
 */

const mocks = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  picks: [] as Array<(hit: unknown) => void>,
}));

vi.mock('../src/renderer/session/worker-bridge.js', () => ({
  bridge: {
    start: () => undefined,
    stop: () => undefined,
    send: (command: Record<string, unknown>) => {
      mocks.sent.push(command);
    },
  },
}));

vi.mock('../src/renderer/three/BoardScene.js', () => ({
  BoardScene: ({ onPick }: { onPick: (hit: unknown) => void }) => {
    mocks.picks.push(onPick);
    return <div data-testid="board-canvas" />;
  },
  safeRoutes: () => ({ routes: [], errors: [] }),
}));

const { sent, picks } = mocks;

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

beforeEach(() => {
  sent.length = 0;
  picks.length = 0;
  if (C1 !== undefined) useStore.getState().openProblem(C1);
});

afterEach(() => {
  cleanup();
});

describe('画面の骨格（§9.1）', () => {
  it('トレイ・テスター・マークシート・判定表ヘルプを並べる', () => {
    render(<InspectPartsSession />);
    expect(screen.getByTestId('check-tray')).toBeTruthy();
    expect(screen.getByTestId('tester-panel')).toBeTruthy();
    expect(screen.getByTestId('mark-sheet')).toBeTruthy();
    expect(screen.getByTestId('diagnosis-help')).toBeTruthy();
  });

  it('配線の道具は出さない（C1は配線しない）', () => {
    render(<InspectPartsSession />);
    expect(screen.queryByRole('button', { name: '削除モード' })).toBeNull();
  });
});

describe('部品の挿抜（§9.1）', () => {
  it('「挿す」で load を送り直し、ストアに記録する', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId(`plug-${first.id}`));
    expect(useStore.getState().checkPartId).toBe(first.id);
    const load = sent.filter((c) => c['type'] === 'load').at(-1);
    expect(load).toBeDefined();
    expect((load?.['session'] as { mounted: Record<string, unknown> }).mounted['S7']).toBeDefined();
  });

  it('「外す」で空のチェック用盤に戻る', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId(`plug-${first.id}`));
    fireEvent.click(screen.getByTestId(`eject-${first.id}`));
    expect(useStore.getState().checkPartId).toBeUndefined();
    const load = sent.filter((c) => c['type'] === 'load').at(-1);
    expect((load?.['session'] as { mounted: Record<string, unknown> }).mounted).toEqual({});
  });
});

describe('プローブの配置（§9.3）', () => {
  it('3Dの端子クリックは役割IDに直して Worker へ送る（§6.4）', () => {
    render(<InspectPartsSession />);
    const onPick = picks.at(-1);
    expect(onPick).toBeDefined();
    if (onPick === undefined) return;
    // 3D盤が返すのは物理端子ID（S7.13）。ネットリストは役割ID（CHK.13）で組まれている
    onPick({ kind: 'terminal', id: toTerminalId('S7.13'), wirable: false, label: 'CHK ⑬ −' });
    expect(useStore.getState().tester.black).toBe('CHK.13');
    expect(sent).toContainEqual({
      type: 'tester',
      action: { type: 'place-probe', probe: 'black', terminal: 'CHK.13' },
    });
    expect(useStore.getState().nextProbe).toBe('red');
  });

  it('2本目は赤になり、同じ端子をもう一度押すと外れる', () => {
    render(<InspectPartsSession />);
    const onPick = picks.at(-1);
    if (onPick === undefined) return;
    onPick({ kind: 'terminal', id: toTerminalId('S7.13'), wirable: false, label: 'a' });
    onPick({ kind: 'terminal', id: toTerminalId('S7.14'), wirable: false, label: 'b' });
    expect(useStore.getState().tester.red).toBe('CHK.14');
    onPick({ kind: 'terminal', id: toTerminalId('S7.14'), wirable: false, label: 'b' });
    expect(useStore.getState().tester.red).toBeUndefined();
  });

  it('プローブのショートカットボタンで2本まとめて置ける', () => {
    render(<InspectPartsSession />);
    fireEvent.click(screen.getByTestId('probe-target-coil'));
    expect(useStore.getState().tester.black).toBe('CHK.13');
    expect(useStore.getState().tester.red).toBe('CHK.14');
  });
});

describe('testerShortcut（§8.2 キーボード）', () => {
  it('0 は0Ω調整', () => {
    expect(testerShortcut('0')).toEqual({ type: 'zero-adjust' });
  });

  it('知らないキーは undefined', () => {
    expect(testerShortcut('q')).toBeUndefined();
  });

  it('大文字小文字を問わない', () => {
    expect(testerShortcut('B')).toEqual({ type: 'next-probe', probe: 'black' });
    expect(testerShortcut('r')).toEqual({ type: 'next-probe', probe: 'red' });
  });
});

describe('判定（§9.1）', () => {
  it('判定ボタンで judgeParts を送る', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    render(<InspectPartsSession />);
    const first = C1.parts[0];
    if (first === undefined) return;
    fireEvent.click(screen.getByTestId(`answer-${first.id}-normal`));
    fireEvent.click(screen.getByTestId('judge-button'));
    const judge = sent.find((c) => c['type'] === 'judgeParts');
    expect(judge).toBeDefined();
    expect((judge?.['answers'] as unknown[]).length).toBe(1);
    expect(useStore.getState().judging).toBe(true);
  });
});

describe('手順帯（UXレビュー #3: 部品を挿す → 通電 → 測る → マーク → 判定）', () => {
  it('walks plug → power → measure → mark → judge from real store state', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    if (first === undefined) return;
    render(<InspectPartsSession />);

    expect(screen.getByTestId('step-plug')).toHaveAttribute('data-state', 'current');

    fireEvent.click(screen.getByTestId(`plug-${first.id}`));
    expect(screen.getByTestId('step-plug')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-power')).toHaveAttribute('data-state', 'current');

    // Worker はこのテストでは応答を返さないので、通電はスナップショットを直接更新する
    const snapshot = useStore.getState().snapshot;
    act(() => {
      useStore.setState({ snapshot: { ...snapshot, powered: true } });
    });
    expect(screen.getByTestId('step-power')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-measure')).toHaveAttribute('data-state', 'current');

    fireEvent.click(screen.getByTestId('probe-target-coil'));
    expect(screen.getByTestId('step-measure')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-mark')).toHaveAttribute('data-state', 'current');

    fireEvent.click(screen.getByTestId(`answer-${first.id}-normal`));
    expect(screen.getByTestId('step-mark')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-judge')).toHaveAttribute('data-state', 'current');
  });
});
