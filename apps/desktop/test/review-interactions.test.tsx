import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS, BUILTIN_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { TutorialVideoButton } from '../src/renderer/help/TutorialVideo.js';
import { wireLabel } from '../src/renderer/i18n/ja.js';
import { MeasurementPanel } from '../src/renderer/panels/MeasurementPanel.js';
import { RepairPanel } from '../src/renderer/panels/RepairPanel.js';
import { WireListPanel } from '../src/renderer/panels/WireListPanel.js';
import { cloneSession } from '../src/renderer/session/commands.js';
import { bridge } from '../src/renderer/session/worker-bridge.js';

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ defaultVendor: 'mitsubishi', toasts: [] });
  vi.spyOn(bridge, 'send').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function expand(id: string): void {
  const details = screen.getByTestId<HTMLDetailsElement>(`${id}-details`);
  act(() => {
    details.open = true;
    fireEvent(details, new Event('toggle'));
  });
}

it('チェック済みの線を単独削除した後、残る線を一括削除できる', () => {
  useStore.getState().openProblem(BUILTIN_PROBLEMS[0]!);
  const session = cloneSession(useStore.getState().session!);
  for (const [from, to] of [
    ['P.1', 'TB_PB.1a'],
    ['N.1', 'TB_PB.2a'],
  ])
    expect(addWire(session, JIPM_BOARD, toTerminalId(from!), toTerminalId(to!)).ok).toBe(true);
  useStore.getState().setSession(session);
  const [a, b] = session.wires.filter((wire) => !wire.locked);
  render(<WireListPanel board={JIPM_BOARD} />);
  expand('wire-list');
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`一括削除の対象 ${a!.id} `) }));
  fireEvent.click(screen.getByTestId(`wire-row-${a!.id}`));
  fireEvent.click(screen.getByRole('button', { name: 'この電線を外す（Delete / Backspace）' }));
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`一括削除の対象 ${b!.id} `) }));
  expect(screen.getByTestId('wire-selection-summary')).toHaveTextContent('一括削除の対象：1本');
  fireEvent.click(screen.getByRole('button', { name: 'チェックした電線1本を削除（Undo可）' }));
  expect(useStore.getState().session!.wires.filter((wire) => !wire.locked)).toEqual([]);
  expect(useStore.getState().toasts.some((toast) => toast.text.includes('見つかりません'))).toBe(
    false,
  );
});

it('C2の修復一覧は追加線と削除線をIDで探し、両端子を表示する', () => {
  useStore
    .getState()
    .openProblem(BUILTIN_INSPECT_REPAIR_PROBLEMS.find((problem) => problem.id === 'c2-001')!);
  const session = cloneSession(useStore.getState().session!);
  const removed = session.wires.find((wire) => wire.id === 'sw-005')!;
  expect(removeWire(session, removed.id).ok).toBe(true);
  const added = addWire(session, JIPM_BOARD, toTerminalId('CR1.6'), toTerminalId('TB_PL.1+'), '白');
  if (!added.ok) throw new Error(added.message);
  useStore.getState().setSession(session);
  render(
    <RepairPanel
      onRestoreWire={vi.fn()}
      addedWires={[{ id: added.value.id, label: wireLabel(added.value) }]}
      removedWires={[{ id: removed.id, label: wireLabel(removed) }]}
      mountedParts={[]}
      onReplacePart={() => undefined}
    />,
  );
  fireEvent.click(within(screen.getByTestId('added-wires')).getByRole('button'));
  expect(useStore.getState().highlight.wireIds).toContain(added.value.id);
  expect(useStore.getState().highlight.terminals).toEqual([added.value.from, added.value.to]);
  fireEvent.click(
    within(screen.getByTestId('removed-wires')).getByRole('button', { name: /の元の端子/ }),
  );
  expect(useStore.getState().highlight.terminals).toEqual([removed.from, removed.to]);
  expect(
    useStore.getState().toasts.some((toast) => toast.text.includes('接続先がありません')),
  ).toBe(false);
});

it('診断メモを編集しても同じIDと関連測定を保持し、取消と削除ができる', () => {
  useStore.getState().openProblem(BUILTIN_PROBLEMS[0]!);
  useStore.setState({
    measurements: [
      {
        id: 'm1',
        at: new Date().toISOString(),
        tMs: 10,
        mode: 'DCV',
        kind: 'digital',
        black: 'N.1',
        red: 'P.1',
        range: 50,
        value: 24,
        display: '24',
        powered: true,
        note: '',
      },
    ],
    diagnosisNotes: [
      { id: 'n1', target: '電源', prediction: '24V', conclusion: '修正前', measurementIds: ['m1'] },
    ],
  });
  render(<MeasurementPanel />);
  expand('measurement-panel');
  fireEvent.click(screen.getByRole('button', { name: '電源のメモを編集' }));
  fireEvent.change(screen.getByLabelText('測定から分かったこと・次に調べること'), {
    target: { value: '修正後' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'メモの変更を保存' }));
  expect(useStore.getState().diagnosisNotes).toEqual([
    { id: 'n1', target: '電源', prediction: '24V', conclusion: '修正後', measurementIds: ['m1'] },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '電源のメモを編集' }));
  fireEvent.change(screen.getByLabelText('予測'), { target: { value: '取消する内容' } });
  fireEvent.click(screen.getByRole('button', { name: '編集を取消' }));
  expect(useStore.getState().diagnosisNotes[0]?.prediction).toBe('24V');
  fireEvent.click(screen.getByRole('button', { name: '電源のメモを削除' }));
  expect(useStore.getState().diagnosisNotes).toEqual([]);
  expect(useStore.getState().measurements).toHaveLength(1);
});

it.each([0.5, 0.75, 1, 1.25, 1.5])(
  'PLC動画のメーカーを切り替えても%s倍の再生速度が反映される',
  (rate) => {
    render(<TutorialVideoButton mode="plc" />);
    fireEvent.click(screen.getByTestId('tutorial-plc'));
    fireEvent.change(screen.getByLabelText('動画の再生速度'), { target: { value: String(rate) } });
    fireEvent.click(screen.getByTestId('tutorial-vendor-omron'));
    const video = document.querySelector('video')!;
    fireEvent.loadedMetadata(video);
    expect(screen.getByLabelText('動画の再生速度')).toHaveValue(String(rate));
    expect(video.playbackRate).toBe(rate);
  },
);
