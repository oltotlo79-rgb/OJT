import { BUILTIN_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OjtApi, WorkFile } from '../src/renderer/../shared/ipc.js';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { Home } from '../src/renderer/screens/Home.js';
import type * as WorkFileModuleType from '../src/renderer/session/work-file.js';

type WorkFileModule = typeof WorkFileModuleType;

/**
 * ホーム下段の学習導線（指摘 UX-05 / UX-19 / UX-28 / UX-29。Phase 7 Task 25）。
 *
 * `applyWorkFile()` は `work-file.ts` 側で個別にテスト済みなので、ここでは
 * 「最近の課題を押すとその作業ファイルで復元の道に入る」ことだけを見る（`app.test.tsx` と同じ流儀）。
 */

const workFileMock = vi.hoisted(() => ({ applyWorkFile: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../src/renderer/session/work-file.js', async () => {
  const actual = await vi.importActual<WorkFileModule>('../src/renderer/session/work-file.js');
  return { ...actual, applyWorkFile: workFileMock.applyWorkFile };
});

const AUTOSAVE: WorkFile = {
  formatVersion: 1,
  problemId: 'b-001',
  session: {},
  elapsedMs: 90_000,
  hazardCount: 0,
  savedAt: '2026-09-19T09:00:00.000Z',
  mode: 'assemble',
};

function setApi(api: Partial<OjtApi> | undefined): void {
  if (api === undefined) delete window.ojt;
  else window.ojt = api as OjtApi;
}

/** 一時保存がある状態の preload。 */
function setApiWithAutosave(): void {
  setApi({
    loadWorkFile: () => Promise.resolve({ ok: true, path: 'C:/autosave.json', file: AUTOSAVE }),
    readProblem: () => Promise.resolve(BUILTIN_PROBLEMS.find((p) => p.id === 'b-001') ?? null),
  });
}

beforeEach(() => {
  useStore.setState({ route: 'home', listMode: undefined, toasts: [] });
  workFileMock.applyWorkFile.mockClear();
  setApi(undefined);
});

afterEach(() => {
  cleanup();
  setApi(undefined);
});

describe('ホーム下段（指摘 UX-28）', () => {
  it('「はじめての方はここから」の帯から回路組立の一覧へ入れる（指摘 UX-19）', () => {
    render(<Home />);
    const band = screen.getByTestId('start-here');
    expect(band.textContent).toContain(JA.home.startHereTitle);
    expect(band.textContent).toContain('3級');
    fireEvent.click(screen.getByTestId('start-here-open'));
    expect(useStore.getState().listMode).toBe('assemble');
    expect(useStore.getState().route).toBe('list');
  });

  it('続きが無ければ「続きから」はその旨を出す（押せるものを空振りさせない）', async () => {
    setApi({
      loadWorkFile: () =>
        Promise.resolve({ ok: false, canceled: false, message: '一時保存がありません' }),
    });
    render(<Home />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('continue-card').textContent).toContain(JA.home.continueNone);
    expect(screen.queryByTestId('recent-problem')).toBeNull();
  });

  it('最近の課題が押せて、その作業ファイルで開き直す（指摘 UX-05）', async () => {
    setApiWithAutosave();
    render(<Home />);
    const button = await screen.findByTestId('recent-problem');
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toContain(JA.home.continueButton);
    // どの課題の続きなのかはカードの本文に出す（モード・課題名・経過時間）
    const card = screen.getByTestId('continue-card');
    expect(card.textContent).toContain(JA.recentProblem);
    expect(card.textContent).toContain('自己保持回路');
    fireEvent.click(button);
    expect(workFileMock.applyWorkFile).toHaveBeenCalledWith(AUTOSAVE);
  });
});

describe('モード名（指摘 UX-29）', () => {
  it('モードカードの説明に内部識別子（モードB／C1／C2／D）を出さない', () => {
    render(<Home />);
    const grid = screen.getByTestId('mode-assemble').parentElement;
    expect(grid?.textContent ?? '').not.toMatch(/モード[BCD]/u);
    for (const desc of [
      JA.home.assembleDesc,
      JA.home.inspectPartsDesc,
      JA.home.inspectRepairDesc,
      JA.home.plcDesc,
    ]) {
      expect(desc).not.toMatch(/モード[BCD]/u);
    }
  });
});
