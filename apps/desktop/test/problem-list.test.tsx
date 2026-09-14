import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OjtApi, ProblemListPayload } from '../src/renderer/../shared/ipc.js';
import { ojtApi } from '../src/renderer/app/ojt-api.js';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { ProblemList } from '../src/renderer/screens/ProblemList.js';

/**
 * 課題一覧の表示テスト（§12.1 / §13 #5）。
 * preload が読み込まれていない環境（`window.ojt` が無い）でも落ちないことを担保する。
 */

const PAYLOAD: ProblemListPayload = {
  problems: [
    {
      id: 'b-001',
      title: '自己保持回路',
      grade: 3,
      description: '起動と停止',
      standardMin: 30,
      cutoffMin: 50,
      source: 'builtin',
    },
  ],
  errors: [],
  userDir: 'C:/dummy',
  userDirExists: true,
};

/** preload を差し替える（`delete` で「読み込まれていない」状態に戻せる）。 */
function setApi(api: Partial<OjtApi> | undefined): void {
  if (api === undefined) delete window.ojt;
  else window.ojt = api as OjtApi;
}

beforeEach(() => {
  useStore.setState({ problems: undefined, toasts: [], route: 'list' });
  setApi(undefined);
});

afterEach(() => {
  cleanup();
  setApi(undefined);
});

describe('ojtApi', () => {
  it('preload が無ければ日本語の理由を持つ例外を投げる', () => {
    expect(() => ojtApi()).toThrow(JA.error.preloadMissing);
  });
});

describe('ProblemList', () => {
  it('preload が無くても落ちず、理由を画面に出す（§13 #5）', async () => {
    render(<ProblemList />);
    const box = await screen.findByTestId('problem-list-error');
    expect(box.textContent).toContain(JA.error.preloadMissing);
    // 画面そのものは生きている（一覧へ戻る導線が残る）
    expect(screen.getByRole('button', { name: JA.problemList.back })).toBeTruthy();
  });

  it('preload があれば一覧を並べる', async () => {
    setApi({ listProblems: () => Promise.resolve(PAYLOAD) });
    render(<ProblemList />);
    await waitFor(() => {
      expect(screen.getByTestId('problem-table')).toBeTruthy();
    });
    expect(screen.getByText('自己保持回路')).toBeTruthy();
    expect(screen.getByText(JA.problemList.columnTitle)).toBeTruthy();
    expect(screen.queryByTestId('problem-list-error')).toBeNull();
  });

  it('一覧の取得が失敗しても理由を出すだけで落ちない（§13 #1）', async () => {
    setApi({ listProblems: () => Promise.reject(new Error('課題フォルダを開けません')) });
    render(<ProblemList />);
    const box = await screen.findByTestId('problem-list-error');
    expect(box.textContent).toContain('課題フォルダを開けません');
  });

  it('課題を読めなかったらトーストで知らせる', async () => {
    setApi({
      listProblems: () => Promise.resolve(PAYLOAD),
      readProblem: () => Promise.resolve(null),
    });
    render(<ProblemList />);
    const open = await screen.findByTestId('open-b-001');
    open.click();
    await waitFor(() => {
      expect(useStore.getState().toasts).toHaveLength(1);
    });
    expect(useStore.getState().toasts[0]?.text).toContain(JA.problemList.loadFailed);
  });
});
