import { useEffect, useState, type JSX } from 'react';
import { gradeLabel, JA, minutesLabel, problemCountText } from '../i18n/ja.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore, type ListMode } from '../app/store.js';
import styles from './screens.module.css';

/** 級の絞り込み（`undefined` は「すべて」）。UXレビュー #12 */
type GradeFilter = 1 | 2 | 3 | undefined;

/**
 * 課題一覧。設計仕様 §12.1 / §7.8（利用者フォルダの合流）/ §13 #1（読込エラー） / §13 #9（フォルダ無し）。
 * main の `content:list` が返した一覧をそのまま並べ、出所タグ・読込エラー・フォルダ無しの警告を出す。
 *
 * preload が無い環境でも落ちない。`ojtApi()` が投げる理由をそのまま画面に出す（§13 #5）。
 */

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 課題一覧画面。 */
export function ProblemList(): JSX.Element {
  const problems = useStore((s) => s.problems);
  const listMode = useStore((s) => s.listMode);
  const setListMode = useStore((s) => s.setListMode);
  const setProblems = useStore((s) => s.setProblems);
  const setRoute = useStore((s) => s.setRoute);
  const openProblem = useStore((s) => s.openProblem);
  const toast = useStore((s) => s.toast);
  const [listError, setListError] = useState<string | undefined>(undefined);
  /** 級の絞り込み（UXレビュー #12）。モードの絞り込みと同じくホーム由来ではないので画面内だけで持つ。 */
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>(undefined);

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
    try {
      void ojtApi()
        .readProblem(id)
        .then(
          (problem) => {
            if (problem === null) {
              toast(`${JA.problemList.loadFailed}: ${id}`, 'error');
              return;
            }
            openProblem(problem);
          },
          (error: unknown) => {
            toast(`${JA.problemList.loadFailed}: ${reasonOf(error)}`, 'error');
          },
        );
    } catch (error) {
      toast(`${JA.problemList.loadFailed}: ${reasonOf(error)}`, 'error');
    }
  };

  /**
   * ホームで選んだモードと、画面内で選んだ級で絞った行（どちらも `undefined` は「すべて」）。
   * §12.1 / UXレビュー #12
   */
  const rows = (problems?.problems ?? []).filter(
    (problem) =>
      (listMode === undefined || problem.mode === listMode) &&
      (gradeFilter === undefined || problem.grade === gradeFilter),
  );

  return (
    <div className={styles.center}>
      <button
        type="button"
        onClick={() => {
          setRoute('home');
        }}
      >
        {JA.problemList.back}
      </button>
      <h1 className={styles.title} style={{ marginTop: 12 }}>
        {JA.problemList.title}
      </h1>
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
                key={label}
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
          {/* 級の絞り込み（UXレビュー #12: モードの絞り込みと並べて出す）。 */}
          <div className={styles.modeFilter} data-testid="grade-filter">
            <span className={styles.filterLabel}>{JA.problemListExtra.filterGradeLabel}:</span>
            {(
              [
                [undefined, JA.problemListExtra.allGrades],
                [3, gradeLabel(3)],
                [2, gradeLabel(2)],
                [1, gradeLabel(1)],
              ] as ReadonlyArray<readonly [GradeFilter, string]>
            ).map(([grade, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={gradeFilter === grade}
                onClick={() => {
                  setGradeFilter(grade);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className={styles.subtitle}>{JA.problemList.filterEmpty}</p>
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
              */}
                <thead className={styles.stickyThead}>
                  <tr>
                    <th>{JA.problemList.columnId}</th>
                    <th>{JA.problemList.columnTitle}</th>
                    <th>{JA.problemList.grade}</th>
                    <th>{JA.problemListExtra.columnTime}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((problem) => (
                    <tr key={problem.id}>
                      <td>{problem.id}</td>
                      <td>
                        {problem.title}{' '}
                        <span className={styles.tag}>
                          {problem.source === 'builtin'
                            ? JA.problemList.builtin
                            : JA.problemList.user}
                        </span>
                      </td>
                      <td>{gradeLabel(problem.grade)}</td>
                      <td>
                        {minutesLabel(problem.standardMin)} / {minutesLabel(problem.cutoffMin)}
                      </td>
                      <td>
                        <button
                          type="button"
                          data-testid={`open-${problem.id}`}
                          onClick={() => {
                            open(problem.id);
                          }}
                        >
                          {JA.problemList.open}
                        </button>
                      </td>
                    </tr>
                  ))}
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
          <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>{JA.problemList.errorsTitle}</h2>
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
