import { PROBLEM_TAG_LABELS, type Difficulty, type ProblemTag } from '@ojt/content';
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { ResumeWorkCard } from '../app/ProblemNavigation.js';
import { requestOpenProblem } from '../session/problem-navigation.js';
import {
  changeProblemFilters,
  DEFAULT_PROBLEM_FILTERS,
  useProblemFilters,
} from './problem-list-state.js';
import {
  difficultyLabel,
  gradeFilterLabel,
  gradeLabel,
  JA,
  minutesLabel,
  problemCountText,
} from '../i18n/ja.js';
import { reasonOf } from '../app/errors.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore, type ListMode } from '../app/store.js';
import { HelpButton } from '../help/HelpButton.js';
import {
  defaultGrade,
  filterProblems,
  firstSentence,
  tagsInUse,
  type GradeFilter,
} from './problem-filter.js';
import styles from './screens.module.css';

/**
 * 課題一覧。設計仕様 §12.1 / §7.8（利用者フォルダの合流）/ §13 #1（読込エラー） / §13 #9（フォルダ無し）。
 * main の `content:list` が返した一覧をそのまま並べ、出所タグ・読込エラー・フォルダ無しの警告を出す。
 *
 * preload が無い環境でも落ちない。`ojtApi()` が投げる理由をそのまま画面に出す（§13 #5）。
 *
 * Phase 7 Task 25（指摘 UX-18 / UX-19 / PR-09）で**72題ぶんの導線**を足した:
 * 言葉で探す入力欄・難しさ・学習テーマの絞り込み、行に課題文の先頭1文、
 * 「3級（おすすめ）」と初めて開いたときの既定、**行のどこを押しても開く**、ID列は右端へ。
 * 絞り込みと並べ替えの規則そのものは `screens/problem-filter.ts` の純関数が持つ。
 */

/** 難しさの絞り込みの選択肢（1〜5。§16 Phase 7 §4.3）。 */
const DIFFICULTIES: readonly Difficulty[] = [1, 2, 3, 4, 5];

/** 課題一覧画面。 */
export function ProblemList(): JSX.Element {
  const problems = useStore((s) => s.problems);
  const listMode = useStore((s) => s.listMode);
  const setListMode = useStore((s) => s.setListMode);
  const setProblems = useStore((s) => s.setProblems);
  const setRoute = useStore((s) => s.setRoute);
  const currentProblemId = useStore((s) => s.problem?.id);
  const opening = useRef(0);
  useEffect(
    () => () => {
      opening.current += 1;
    },
    [],
  );
  const toast = useStore((s) => s.toast);
  const [listError, setListError] = useState<string | undefined>(undefined);
  const { gradePick, difficulty, tag, search } = useProblemFilters(
    (s) => s.modes[listMode ?? 'all'] ?? DEFAULT_PROBLEM_FILTERS,
  );
  const setGradePick = (gradePick: { grade: GradeFilter }): void =>
    changeProblemFilters(listMode, { gradePick });
  const setDifficulty = (difficulty: Difficulty | undefined): void =>
    changeProblemFilters(listMode, { difficulty });
  const setTag = (tag: ProblemTag | undefined): void => changeProblemFilters(listMode, { tag });
  const setSearch = (search: string): void => changeProblemFilters(listMode, { search });

  useEffect(() => {
    try {
      void ojtApi()
        .listProblems()
        .then(setProblems, (error: unknown) => {
          setListError(reasonOf(error));
        });
    } catch (error) {
      setListError(reasonOf(error));
    }
  }, [setProblems]);

  const open = (id: string): void => {
    const request = ++opening.current;
    try {
      void ojtApi()
        .readProblem(id)
        .then(
          (problem) => {
            if (request !== opening.current) return;
            if (problem === null) {
              toast(`${JA.problemList.loadFailed}: ${id}`, 'error');
              return;
            }
            requestOpenProblem(problem);
          },
          (error: unknown) => {
            toast(`${JA.problemList.loadFailed}: ${reasonOf(error)}`, 'error');
          },
        );
    } catch (error) {
      toast(`${JA.problemList.loadFailed}: ${reasonOf(error)}`, 'error');
    }
  };

  const all = useMemo(() => problems?.problems ?? [], [problems]);
  /*
   * まだ級を選んでいないあいだの既定（指摘 UX-19）。そのモードに3級があれば3級、
   * 無ければ「すべて」。モードを切り替えたときも選び直しになる（3級形式の無いモードで
   * 空の一覧を見せない）。
   */
  const grade = gradePick === undefined ? defaultGrade(all, listMode) : gradePick.grade;
  const rows = filterProblems(all, { mode: listMode, grade, difficulty, tag, search });
  const tagChoices = tagsInUse(all);
  /** 探す言葉に当たらないのか、絞り込みで0件なのかを言い分ける（指摘 UX-18）。 */
  const emptyText =
    search.trim() === '' ? JA.problemList.filterEmpty : JA.problemListExtra.searchEmpty;

  return (
    <div className={styles.center}>
      {/* 画面の上の帯（Plan 6 Task 9）。「もどる」の隣にヘルプを並べる。 */}
      <div className={styles.screenHeader}>
        <button
          type="button"
          onClick={() => {
            setRoute('home');
          }}
        >
          {JA.problemList.back}
        </button>
        <HelpButton />
      </div>
      <h1 className={`${styles.title} ${styles.pageTitle}`}>{JA.problemList.title}</h1>
      <ResumeWorkCard />
      {listError !== undefined ? (
        <p className={styles.errorBox} data-testid="problem-list-error">
          {JA.problemList.listFailed}: {listError}
        </p>
      ) : problems === undefined ? (
        <p className={styles.subtitle}>{JA.problemList.loading}</p>
      ) : problems.problems.length === 0 ? (
        <p className={styles.subtitle}>{JA.problemList.empty}</p>
      ) : (
        <>
          {/*
            UI監査 I17: 2段の絞り込み（モード・級）に見出しが無く、2段目が何の絞り込みか
            分からなかった。それぞれの行の先頭にラベルを添える。
          */}
          <div className={styles.modeFilter} data-testid="mode-filter">
            <span className={styles.filterLabel}>{JA.problemListExtra.filterModeLabel}:</span>
            {(
              [
                [undefined, JA.problemList.allModes],
                ['assemble', JA.home.assemble],
                ['inspect-parts', JA.home.inspectParts],
                ['inspect-repair', JA.home.inspectRepair],
                ['plc', JA.home.plc],
              ] as ReadonlyArray<readonly [ListMode, string]>
            ).map(([mode, label]) => (
              <button
                key={mode ?? 'all'}
                type="button"
                aria-pressed={listMode === mode}
                onClick={() => {
                  setListMode(mode);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {/* 級の絞り込み（UXレビュー #12 / 指摘 UX-19: 3級に「おすすめ」を添える）。 */}
          <div className={styles.modeFilter} data-testid="grade-filter">
            <span className={styles.filterLabel}>{JA.problemListExtra.filterGradeLabel}:</span>
            {(
              [
                [undefined, JA.problemListExtra.allGrades],
                [3, gradeFilterLabel(3)],
                [2, gradeLabel(2)],
                [1, gradeLabel(1)],
              ] as ReadonlyArray<readonly [GradeFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value ?? 'all'}
                type="button"
                aria-pressed={grade === value}
                onClick={() => {
                  setGradePick({ grade: value });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {/*
            72題から目的の課題へ辿り着くための3つ目の段（指摘 PR-09）。
            言葉で探す・難しさ・学習テーマを1行にまとめ、絞り込みの段が縦に伸びないようにする。
          */}
          <div className={styles.modeFilter} data-testid="search-filter">
            <button
              type="button"
              onClick={() => changeProblemFilters(listMode, DEFAULT_PROBLEM_FILTERS)}
            >
              絞り込みをリセット
            </button>
            <label className={styles.filterLabel} htmlFor="problem-search">
              {JA.problemListExtra.searchLabel}:
            </label>
            <input
              id="problem-search"
              type="search"
              className={styles.searchInput}
              data-testid="problem-search"
              placeholder={JA.problemListExtra.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
            <label className={styles.filterLabel} htmlFor="difficulty-filter">
              {JA.problemListExtra.filterDifficultyLabel}:
            </label>
            <select
              id="difficulty-filter"
              data-testid="difficulty-filter"
              value={difficulty === undefined ? '' : String(difficulty)}
              onChange={(event) => {
                const value = event.target.value;
                // 選択肢は `DIFFICULTIES`（1〜5）だけなので、当たった段をそのまま使う
                setDifficulty(DIFFICULTIES.find((level) => String(level) === value));
              }}
            >
              <option value="">{JA.problemListExtra.allGrades}</option>
              {DIFFICULTIES.map((level) => (
                <option key={level} value={String(level)}>
                  {difficultyLabel(level)}
                </option>
              ))}
            </select>
            <label className={styles.filterLabel} htmlFor="tag-filter">
              {JA.problemListExtra.filterTagLabel}:
            </label>
            <select
              id="tag-filter"
              data-testid="tag-filter"
              value={tag ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setTag(value === '' ? undefined : (value as ProblemTag));
              }}
            >
              <option value="">{JA.problemListExtra.allGrades}</option>
              {tagChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {PROBLEM_TAG_LABELS[choice]}
                </option>
              ))}
            </select>
          </div>
          {rows.length === 0 ? (
            <p className={styles.subtitle}>{emptyText}</p>
          ) : (
            <>
              {/* 絞り込みに何件当たったか（UI監査 I17）。 */}
              <p className={styles.subtitle} data-testid="problem-count">
                {problemCountText(rows.length)}
              </p>
              <table className={styles.problemTable} data-testid="problem-table">
                {/*
                UXレビュー #12: 見出し行を固定する（縦に長い一覧でも列の意味を見失わない）。
                出所（内蔵／利用者）は専用の列をやめ、課題名のセルにタグとして添える
                （列を1つ減らして表を詰める）。
                指摘 UX-18: 先頭列だった内部ID（`b-001`）は右端の補助列へ移し、
                いちばん目立つ位置を課題名に譲る。
              */}
                <thead className={styles.stickyThead}>
                  <tr>
                    <th>{JA.problemList.columnTitle}</th>
                    <th>{JA.problemList.grade}</th>
                    <th>{JA.problemListExtra.filterDifficultyLabel}</th>
                    <th>{JA.problemListExtra.columnTime}</th>
                    <th>{JA.problemList.columnId}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((problem) => {
                    /*
                     * 指摘 UX-18: 「開く」は課題名から約700px 離れた右端にあり、行そのものは
                     * 押せなかった。行のどこを押しても開くようにし、キーボードでも同じ道を通す
                     * （`tabIndex` ＋ Enter / Space）。右端の「開く」は押しどころを示す印として残す。
                     */
                    const openThis = (): void => {
                      open(problem.id);
                    };
                    const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>): void => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      openThis();
                    };
                    return (
                      <tr
                        key={problem.id}
                        className={styles.problemRow}
                        data-testid={`row-${problem.id}`}
                        tabIndex={0}
                        aria-label={`${problem.title}（${gradeLabel(problem.grade)}）`}
                        onClick={openThis}
                        onKeyDown={onKeyDown}
                      >
                        <td>
                          {problem.title}{' '}
                          <span className={styles.tag}>
                            {problem.source === 'builtin'
                              ? JA.problemList.builtin
                              : JA.problemList.user}
                          </span>
                          {/* 課題文の先頭1文（指摘 UX-19: 題名だけでは中身が分からない）。 */}
                          <span className={styles.problemDesc}>
                            {firstSentence(problem.description)}
                          </span>
                        </td>
                        <td>{gradeLabel(problem.grade)}</td>
                        <td>{difficultyLabel(problem.difficulty)}</td>
                        <td>
                          {minutesLabel(problem.standardMin)} / {minutesLabel(problem.cutoffMin)}
                        </td>
                        <td className={styles.problemId} title={JA.problemListExtra.columnIdNote}>
                          {problem.id}
                        </td>
                        <td>
                          <button
                            type="button"
                            data-testid={`open-${problem.id}`}
                            onClick={(event) => {
                              // 行のクリックと二重に開かない
                              event.stopPropagation();
                              openThis();
                            }}
                          >
                            {currentProblemId === problem.id ? '再開' : JA.problemList.open}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {listError !== undefined || problems === undefined || problems.userDirExists ? null : (
        <p className={styles.subtitle} data-testid="user-dir-missing">
          {JA.problemList.userDirMissing}（{problems.userDir}）
        </p>
      )}

      {listError !== undefined || problems === undefined || problems.errors.length === 0 ? null : (
        <div className={styles.errorBox} data-testid="problem-errors">
          <h2 className={styles.groupTitle}>{JA.problemList.errorsTitle}</h2>
          <ul>
            {problems.errors.map((error) => (
              <li key={error.file}>
                <strong>{error.file}</strong>: {error.message}
                {error.details.length === 0 ? null : (
                  <ul>
                    {error.details.map((detail, index) => (
                      <li key={index}>{detail}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
