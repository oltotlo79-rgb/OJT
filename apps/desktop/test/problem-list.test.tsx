import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OjtApi, ProblemListPayload } from '../src/renderer/../shared/ipc.js';
import { ojtApi } from '../src/renderer/app/ojt-api.js';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { Home } from '../src/renderer/screens/Home.js';
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
      mode: 'assemble',
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

/** 3モードそれぞれ1件ずつのモックデータ（絞り込みの確認用）。§12.1 */
const THREE_MODE_PAYLOAD: ProblemListPayload = {
  problems: [
    {
      id: 'b-001',
      title: '自己保持回路',
      mode: 'assemble',
      grade: 3,
      description: '起動と停止',
      standardMin: 30,
      cutoffMin: 50,
      source: 'builtin',
    },
    {
      id: 'c1-001',
      title: '部品点検セット1',
      mode: 'inspect-parts',
      grade: 2,
      description: 'リレー・タイマの点検',
      standardMin: 20,
      cutoffMin: 30,
      source: 'builtin',
    },
    {
      id: 'c2-001',
      title: '回路点検・修復1',
      mode: 'inspect-repair',
      grade: 2,
      description: '故障の指摘と白線修復',
      standardMin: 40,
      cutoffMin: 60,
      source: 'builtin',
    },
  ],
  errors: [],
  userDir: 'C:/dummy',
  userDirExists: true,
};

beforeEach(() => {
  useStore.setState({ problems: undefined, toasts: [], route: 'list', listMode: undefined });
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

  it('出所タグを列に出す（§7.8）', async () => {
    setApi({
      listProblems: () =>
        Promise.resolve({
          ...PAYLOAD,
          problems: [
            ...PAYLOAD.problems,
            {
              id: 'u-001',
              title: '利用者課題',
              grade: 2,
              description: '利用者フォルダ由来',
              standardMin: 20,
              cutoffMin: 30,
              mode: 'assemble',
              source: 'user',
            },
          ],
        }),
    });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    expect(screen.getByText(JA.problemList.columnSource)).toBeTruthy();
    expect(screen.getByText(JA.problemList.builtin)).toBeTruthy();
    expect(screen.getByText(JA.problemList.user)).toBeTruthy();
  });

  it('利用者課題フォルダが無ければ警告を出す（§13 #9）', async () => {
    setApi({
      listProblems: () => Promise.resolve({ ...PAYLOAD, userDirExists: false, userDir: 'C:/none' }),
    });
    render(<ProblemList />);
    const warning = await screen.findByTestId('user-dir-missing');
    expect(warning.textContent).toContain(JA.problemList.userDirMissing);
    expect(warning.textContent).toContain('C:/none');
  });

  it('利用者課題フォルダがあれば警告を出さない', async () => {
    setApi({ listProblems: () => Promise.resolve(PAYLOAD) });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    expect(screen.queryByTestId('user-dir-missing')).toBeNull();
  });

  it('読込エラーを理由付きで一覧に出す（§13 #1）', async () => {
    setApi({
      listProblems: () =>
        Promise.resolve({
          ...PAYLOAD,
          errors: [
            {
              file: 'C:/content/broken.json',
              reason: 'invalid-json',
              message: 'JSONとして読めませんでした',
              details: ['行3: 予期しないトークン'],
            },
          ],
        }),
    });
    render(<ProblemList />);
    const box = await screen.findByTestId('problem-errors');
    expect(box.textContent).toContain('C:/content/broken.json');
    expect(box.textContent).toContain('JSONとして読めませんでした');
    expect(box.textContent).toContain('行3: 予期しないトークン');
  });

  it('読込エラーが無ければエラー枠を出さない', async () => {
    setApi({ listProblems: () => Promise.resolve(PAYLOAD) });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    expect(screen.queryByTestId('problem-errors')).toBeNull();
  });
});

/**
 * 内蔵20題すべてが一覧行にできることは `test/content-loader.test.ts`（Task 1）の
 * `BUILTIN_ALL_PROBLEMS` 直接テストで確かめ済みなので、ここでは3モードの絞り込みだけを見る
 * （実際の20題を使うUIテストは `listMode` の組合せごとに遅く壊れやすい）。
 */
describe('モードで絞る（Plan 2B Task 17。§12.1）', () => {
  it('「すべて」なら3モードの3行が並ぶ', async () => {
    setApi({ listProblems: () => Promise.resolve(THREE_MODE_PAYLOAD) });
    useStore.setState({ listMode: undefined });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    expect(screen.getByTestId('problem-table').querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('ホームで選んだモードだけに絞ると1行になる（3行 → 絞ると1行）', async () => {
    setApi({ listProblems: () => Promise.resolve(THREE_MODE_PAYLOAD) });
    useStore.setState({ listMode: 'inspect-parts' });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    const rows = screen.getByTestId('problem-table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(screen.getByTestId('problem-table').textContent).not.toContain('自己保持回路');
    expect(screen.getByTestId('problem-table').textContent).toContain('部品点検セット1');
  });

  it('絞り込みボタンを押すと一覧が切り替わる（§12.1）', async () => {
    setApi({ listProblems: () => Promise.resolve(THREE_MODE_PAYLOAD) });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    const filter = screen.getByTestId('mode-filter');
    const button = within(filter).getByRole('button', { name: JA.home.inspectRepair });
    button.click();
    await waitFor(() => {
      expect(screen.getByTestId('problem-table').querySelectorAll('tbody tr')).toHaveLength(1);
    });
    expect(useStore.getState().listMode).toBe('inspect-repair');
    expect(screen.getByTestId('problem-table').textContent).toContain('回路点検・修復1');
  });

  /** Plan 3B Task 15: PLC を絞り込みの4件目として足す。 */
  it('filters the list down to the PLC problems', async () => {
    setApi({
      listProblems: () =>
        Promise.resolve({
          problems: [
            {
              id: 'b-001',
              title: '自己保持回路',
              mode: 'assemble',
              grade: 3,
              description: '起動と停止',
              standardMin: 30,
              cutoffMin: 50,
              source: 'builtin',
            },
            {
              id: 'd-001',
              title: 'PLC 自己保持回路（2級形式）',
              mode: 'plc',
              grade: 2,
              description: 'PLCでラダーを組んで動かす',
              standardMin: 50,
              cutoffMin: 60,
              source: 'builtin',
            },
          ],
          errors: [],
          userDir: 'C:/dummy',
          userDirExists: true,
        }),
    });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    fireEvent.click(screen.getByRole('button', { name: 'PLC' }));
    expect(screen.getByTestId('open-d-001')).toBeInTheDocument();
    expect(screen.queryByTestId('open-b-001')).toBeNull();
  });

  /**
   * Plan 2B レビュー M4: 絞り込みに一致する行が無いのと、フォルダそのものが空なのは
   * 別の状況なので別の文言にする（フォルダは空ではない。単に選んだモードの課題が無いだけ）。
   */
  it('絞り込みに一致しないときはフォルダが空のときと違う文言を出す（M4）', async () => {
    setApi({ listProblems: () => Promise.resolve(PAYLOAD) }); // PAYLOAD は assemble のみ
    useStore.setState({ listMode: 'inspect-parts' });
    render(<ProblemList />);
    await waitFor(() => {
      expect(screen.getByText(JA.problemList.filterEmpty)).toBeTruthy();
    });
    expect(screen.queryByTestId('problem-table')).toBeNull();
    expect(screen.queryByText(JA.problemList.empty)).toBeNull();
  });
});

describe('ホームのモードカード（Plan 2B Task 17。§12.1）', () => {
  it('4モードすべてが押せて、押すと一覧の絞り込みが決まる（Plan 3B Task 15）', () => {
    render(<Home />);
    for (const [key, mode] of [
      ['assemble', 'assemble'],
      ['inspect-parts', 'inspect-parts'],
      ['inspect-repair', 'inspect-repair'],
      ['plc', 'plc'],
    ] as const) {
      const card = screen.getByTestId(`mode-${key}`);
      expect(card.hasAttribute('disabled')).toBe(false);
      card.click();
      expect(useStore.getState().listMode).toBe(mode);
      expect(useStore.getState().route).toBe('list');
    }
  });

  /** §16 Phase 3 の完成条件（Plan 3B Task 15）。 */
  it('lists all four modes and lets PLC start (§16 Phase 3)', () => {
    render(<Home />);
    expect(screen.getByTestId('mode-plc')).toBeEnabled();
    fireEvent.click(screen.getByTestId('mode-plc'));
    expect(useStore.getState().listMode).toBe('plc');
    expect(useStore.getState().route).toBe('list');
  });
});
