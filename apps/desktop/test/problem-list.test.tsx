import { BUILTIN_ALL_PROBLEMS, BUILTIN_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OjtApi, ProblemListPayload } from '../src/renderer/../shared/ipc.js';
import { ojtApi } from '../src/renderer/app/ojt-api.js';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { Home } from '../src/renderer/screens/Home.js';
import { ProblemList } from '../src/renderer/screens/ProblemList.js';
import {
  changeProblemFilters,
  useProblemFilters,
} from '../src/renderer/screens/problem-list-state.js';

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
      difficulty: 1,
      tags: ['self-hold'],
      description: '起動と停止をする回路です。押しボタンで点灯を保持します。',
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
      difficulty: 1,
      tags: ['self-hold'],
      description: '起動と停止をする回路です。押しボタンで点灯を保持します。',
      standardMin: 30,
      cutoffMin: 50,
      source: 'builtin',
    },
    {
      id: 'c1-001',
      title: '部品点検セット1',
      mode: 'inspect-parts',
      grade: 2,
      difficulty: 2,
      tags: ['fault-part'],
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
      difficulty: 3,
      tags: ['fault-wire'],
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

/**
 * 級の絞り込みを「すべて」に戻す（指摘 UX-19 で**初めて開いたときの既定が3級**になったので、
 * 級をまたいで数える検査はまずこれを押す）。
 */
function showAllGrades(): void {
  const filter = screen.getByTestId('grade-filter');
  fireEvent.click(within(filter).getByRole('button', { name: JA.problemListExtra.allGrades }));
}

beforeEach(() => {
  useProblemFilters.setState({ modes: {} });
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

  it('出所タグを課題名のセルに添える（§7.8 / UXレビュー #12: 専用の列はやめて詰める）', async () => {
    setApi({
      listProblems: () =>
        Promise.resolve({
          ...PAYLOAD,
          problems: [
            ...PAYLOAD.problems,
            {
              id: 'u-001',
              title: '利用者課題',
              grade: 3,
              difficulty: 2,
              tags: [],
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
    // 専用の列見出しはもう出さない
    expect(screen.queryByText(JA.problemList.columnSource)).toBeNull();
    expect(screen.getByText(JA.problemList.builtin)).toBeTruthy();
    const userTag = screen.getByText(JA.problemList.user);
    expect(userTag.closest('td')?.textContent).toContain('利用者課題');
  });

  it('標準時間・打切時間をどちらも分単位で1列に出す（UXレビュー #12 / #20）', async () => {
    setApi({ listProblems: () => Promise.resolve(PAYLOAD) });
    render(<ProblemList />);
    const table = await screen.findByTestId('problem-table');
    expect(table.textContent).toContain(JA.problemListExtra.columnTime);
    expect(table.textContent).toContain('30分 / 50分');
  });

  it('級の絞り込みチップを並べ、選ぶと一覧が絞られる（UXレビュー #12）', async () => {
    setApi({
      listProblems: () =>
        Promise.resolve({
          ...PAYLOAD,
          problems: [
            ...PAYLOAD.problems,
            {
              id: 'b-002',
              title: '1級課題',
              grade: 1,
              difficulty: 5,
              tags: ['interlock'],
              description: '1級',
              standardMin: 40,
              cutoffMin: 60,
              mode: 'assemble',
              source: 'builtin',
            },
          ],
        }),
    });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    showAllGrades();
    expect(screen.getByTestId('problem-table').querySelectorAll('tbody tr')).toHaveLength(2);

    const filter = screen.getByTestId('grade-filter');
    fireEvent.click(within(filter).getByRole('button', { name: '1級' }));

    const rows = screen.getByTestId('problem-table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(screen.getByTestId('problem-table').textContent).toContain('1級課題');
  });

  /*
   * UI監査 I17: 2段の絞り込み（モード・級）に見出しが無く、2段目が何の絞り込みか
   * 分からなかった。それぞれの行にラベルを添える。
   */
  it('絞り込みの各行に見出しを添える（UI監査 I17）', async () => {
    setApi({ listProblems: () => Promise.resolve(PAYLOAD) });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    expect(screen.getByTestId('mode-filter').textContent).toContain(
      JA.problemListExtra.filterModeLabel,
    );
    expect(screen.getByTestId('grade-filter').textContent).toContain(
      JA.problemListExtra.filterGradeLabel,
    );
  });

  /* UI監査 I17: 絞り込んだあとに何件当たったかが無言だった。 */
  it('絞り込みに一致した件数を出す（UI監査 I17）', async () => {
    setApi({
      listProblems: () =>
        Promise.resolve({
          ...PAYLOAD,
          problems: [
            ...PAYLOAD.problems,
            {
              id: 'b-002',
              title: '2件目',
              grade: 3,
              difficulty: 2,
              tags: ['timer'],
              description: '2件目',
              standardMin: 30,
              cutoffMin: 50,
              mode: 'assemble',
              source: 'builtin',
            },
          ],
        }),
    });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    expect(screen.getByTestId('problem-count').textContent).toContain('2 件');

    const filter = screen.getByTestId('grade-filter');
    fireEvent.click(within(filter).getByRole('button', { name: '1級' }));
    // 1級は無いので0件（表そのものは出ず、絞り込み結果0件の文言に切り替わる）
    expect(screen.queryByTestId('problem-count')).toBeNull();
    expect(screen.getByText(JA.problemList.filterEmpty)).toBeTruthy();
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
 * 内蔵60題すべてが一覧行にできることは `test/content-loader.test.ts`（Task 1）の
 * `BUILTIN_ALL_PROBLEMS` 直接テストで確かめ済みなので、ここでは3モードの絞り込みだけを見る
 * （実際の60題を使うUIテストは `listMode` の組合せごとに遅く壊れやすい）。
 */
describe('モードで絞る（Plan 2B Task 17。§12.1）', () => {
  it('「すべて」なら3モードの3行が並ぶ', async () => {
    setApi({ listProblems: () => Promise.resolve(THREE_MODE_PAYLOAD) });
    useStore.setState({ listMode: undefined });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    showAllGrades();
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
              difficulty: 1,
              tags: ['self-hold'],
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
              difficulty: 3,
              tags: ['self-hold'],
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

/**
 * 216題ぶんの学習導線（指摘 UX-18 / UX-19 / PR-09。Phase 7 Task 25）。
 * 「行のどこを押しても開く」「言葉で探す」「3級が既定」「難しさ・学習テーマで絞る」を縛る。
 */
describe('学習導線（Phase 7 Task 25）', () => {
  it('一覧へ戻ったときに検索・級を保持し、リセットで初期表示へ戻せる', async () => {
    setApi({ listProblems: () => Promise.resolve(builtinPayload()) });
    useStore.setState({ listMode: 'inspect-parts' });
    const first = render(<ProblemList />);
    await screen.findByTestId('problem-table');
    showAllGrades();
    fireEvent.change(screen.getByTestId('problem-search'), { target: { value: 'c1-001' } });
    expect(screen.getByTestId('open-c1-001')).toBeVisible();
    first.unmount();
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    expect(screen.getByTestId('problem-search')).toHaveValue('c1-001');
    expect(screen.getByTestId('open-c1-001')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '絞り込みをリセット' }));
    expect(screen.getByTestId('problem-search')).toHaveValue('');
  });

  it('初心者向けの入口は以前の検索語・難しさを解除して3級を開く', () => {
    changeProblemFilters('assemble', {
      search: 'ない課題',
      difficulty: 5,
      gradePick: { grade: 1 },
    });
    render(<Home />);
    fireEvent.click(screen.getByTestId('start-here-open'));
    expect(useProblemFilters.getState().modes['assemble']).toMatchObject({
      search: '',
      difficulty: undefined,
      gradePick: { grade: 3 },
    });
    expect(useStore.getState().route).toBe('list');
  });
  /** 内蔵課題をそのまま一覧行にした、本番と同じ規模（216題）の一覧。 */
  function builtinPayload(): ProblemListPayload {
    return {
      problems: BUILTIN_ALL_PROBLEMS.map((problem) => ({
        id: problem.id,
        title: problem.title,
        mode: problem.mode,
        grade: problem.grade,
        difficulty: problem.difficulty,
        tags: problem.tags,
        description: problem.description,
        standardMin: problem.timeLimit.standardMin,
        cutoffMin: problem.timeLimit.cutoffMin,
        source: 'builtin' as const,
      })),
      errors: [],
      userDir: 'C:/dummy',
      userDirExists: true,
    };
  }

  it('行のどこを押しても課題が開く（指摘 UX-18）', async () => {
    let asked: string | undefined;
    setApi({
      listProblems: () => Promise.resolve(PAYLOAD),
      readProblem: (id: string) => {
        asked = id;
        return Promise.resolve(null);
      },
    });
    render(<ProblemList />);
    const row = await screen.findByTestId('row-b-001');
    fireEvent.click(row);
    await waitFor(() => {
      expect(asked).toBe('b-001');
    });
  });

  it('キーボードでも行を開ける（Enter / Space。指摘 UX-18）', async () => {
    const asked: string[] = [];
    setApi({
      listProblems: () => Promise.resolve(PAYLOAD),
      readProblem: (id: string) => {
        asked.push(id);
        return Promise.resolve(null);
      },
    });
    render(<ProblemList />);
    const row = await screen.findByTestId('row-b-001');
    expect(row.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    // 関わりのないキーでは開かない
    fireEvent.keyDown(row, { key: 'a' });
    await waitFor(() => {
      expect(asked).toEqual(['b-001', 'b-001']);
    });
  });

  it('ID列は右端の補助列へ移り、課題名が先頭になる（指摘 UX-18）', async () => {
    setApi({ listProblems: () => Promise.resolve(PAYLOAD) });
    render(<ProblemList />);
    const table = await screen.findByTestId('problem-table');
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers[0]).toBe(JA.problemList.columnTitle);
    expect(headers.indexOf(JA.problemList.columnId)).toBeGreaterThan(0);
    const cells = [...(table.querySelector('tbody tr')?.querySelectorAll('td') ?? [])];
    expect(cells[0]?.textContent).toContain('自己保持回路');
    expect(cells.at(-2)?.textContent).toBe('b-001');
  });

  it('行に課題文の先頭1文を薄字で添える（指摘 UX-19）', async () => {
    setApi({ listProblems: () => Promise.resolve(PAYLOAD) });
    render(<ProblemList />);
    const row = await screen.findByTestId('row-b-001');
    expect(row.textContent).toContain('起動と停止をする回路です。');
    // 2文目までは出さない（行の高さを揃える）
    expect(row.textContent).not.toContain('押しボタンで点灯を保持します。');
  });

  it('初めて開いたときは「3級（おすすめ）」が選ばれている（指摘 UX-19）', async () => {
    setApi({ listProblems: () => Promise.resolve(builtinPayload()) });
    useStore.setState({ listMode: 'assemble' });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    const filter = screen.getByTestId('grade-filter');
    const recommended = within(filter).getByRole('button', {
      name: `3級${JA.problemListExtra.recommended}`,
    });
    expect(recommended.getAttribute('aria-pressed')).toBe('true');
    for (const row of screen.getByTestId('problem-table').querySelectorAll('tbody tr')) {
      expect(row.textContent).toContain('3級');
    }
  });

  it('3級形式が無いモード（回路点検・修復／PLC）では既定が「すべて」になる（0件の一覧を見せない）', async () => {
    setApi({ listProblems: () => Promise.resolve(builtinPayload()) });
    useStore.setState({ listMode: 'plc' });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    const filter = screen.getByTestId('grade-filter');
    expect(
      within(filter)
        .getByRole('button', { name: JA.problemListExtra.allGrades })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByTestId('problem-table').querySelectorAll('tbody tr').length).toBeGreaterThan(
      0,
    );
  });

  it('言葉で探すと216題から絞り込める（指摘 PR-09）', async () => {
    setApi({ listProblems: () => Promise.resolve(builtinPayload()) });
    useStore.setState({ listMode: undefined });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    showAllGrades();
    const before = screen.getByTestId('problem-table').querySelectorAll('tbody tr').length;
    expect(before).toBe(BUILTIN_ALL_PROBLEMS.length);

    fireEvent.change(screen.getByTestId('problem-search'), { target: { value: '自己保持' } });
    const rows = [...screen.getByTestId('problem-table').querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(before);
    // 課題名・課題文・IDのどれかに当たった課題だけが残る（`b-001` は課題名で当たる）
    expect(screen.getByTestId('row-b-001')).toBeTruthy();
    const ids = rows.map((row) => row.getAttribute('data-testid'));
    for (const id of ids) {
      const problem = BUILTIN_ALL_PROBLEMS.find((p) => `row-${p.id}` === id);
      expect(`${problem?.title ?? ''}${problem?.description ?? ''}${problem?.id ?? ''}`).toContain(
        '自己保持',
      );
    }
  });

  it('当たらない言葉のときは絞り込み0件と違う文言を出す（指摘 UX-18）', async () => {
    setApi({ listProblems: () => Promise.resolve(builtinPayload()) });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    fireEvent.change(screen.getByTestId('problem-search'), {
      target: { value: 'そのような課題はありません' },
    });
    expect(screen.getByText(JA.problemListExtra.searchEmpty)).toBeTruthy();
    expect(screen.queryByText(JA.problemList.filterEmpty)).toBeNull();
  });

  it('難しさと学習テーマで絞り込める（Task 4 の課題データ）', async () => {
    setApi({ listProblems: () => Promise.resolve(builtinPayload()) });
    useStore.setState({ listMode: 'assemble' });
    render(<ProblemList />);
    await screen.findByTestId('problem-table');
    showAllGrades();

    fireEvent.change(screen.getByTestId('tag-filter'), { target: { value: 'timer' } });
    const tagged = screen.getByTestId('problem-table').querySelectorAll('tbody tr').length;
    expect(tagged).toBeGreaterThan(0);
    expect(tagged).toBeLessThan(BUILTIN_ALL_PROBLEMS.length);

    fireEvent.change(screen.getByTestId('tag-filter'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('difficulty-filter'), { target: { value: '1' } });
    const easy = [...screen.getByTestId('problem-table').querySelectorAll('tbody tr')];
    expect(easy.length).toBeGreaterThan(0);
    for (const row of easy) expect(row.textContent).toContain('難しさ 1');
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

  it('設定ボタンは4モードのカードより前（画面の上）に置く（UXレビュー #19: 右上）', () => {
    render(<Home />);
    const settings = screen.getByTestId('open-settings');
    const firstCard = screen.getByTestId('mode-assemble');
    expect(
      settings.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('preload が無ければ「最近の課題」は出さない', async () => {
    render(<Home />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('recent-problem')).toBeNull();
  });

  it('一時保存があれば「続きから」のカードに出す（UXレビュー #19 / 指摘 UX-05）', async () => {
    setApi({
      loadWorkFile: () =>
        Promise.resolve({
          ok: true,
          path: 'C:/autosave.json',
          file: {
            formatVersion: 1,
            problemId: 'b-001',
            session: {},
            elapsedMs: 90_000,
            hazardCount: 0,
            savedAt: '2026-09-19T09:00:00.000Z',
            mode: 'assemble',
          },
        }),
      readProblem: () => Promise.resolve(BUILTIN_PROBLEMS.find((p) => p.id === 'b-001') ?? null),
    });
    render(<Home />);
    // 「最近の課題」は押せるボタンになり、どの課題かはカードの本文に出る（指摘 UX-05）
    await screen.findByTestId('recent-problem');
    const card = screen.getByTestId('continue-card');
    expect(card.textContent).toContain('自己保持回路');
    expect(card.textContent).toContain(JA.home.assemble);
  });

  it('一時保存が無ければ「続きから」の押しどころは出さない', async () => {
    setApi({
      loadWorkFile: () =>
        Promise.resolve({ ok: false, canceled: false, message: '一時保存がありません' }),
    });
    render(<Home />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('recent-problem')).toBeNull();
  });
});
