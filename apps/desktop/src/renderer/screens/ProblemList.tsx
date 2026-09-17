import { useEffect, useState, type JSX } from 'react';
import { gradeLabel, JA, minutesLabel } from '../i18n/ja.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore, type ListMode } from '../app/store.js';
import styles from './screens.module.css';

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

  /** ホームで選んだモードで絞った行（`undefined` は「すべて」）。§12.1 */
  const rows = (problems?.problems ?? []).filter(
    (problem) => listMode === undefined || problem.mode === listMode,
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
          {/* モードの絞り込み（ホームで選んだモードが初期値）。§12.1 */}
          <div className={styles.modeFilter} data-testid="mode-filter">
            {(
              [
                [undefined, JA.problemList.allModes],
                ['assemble', JA.home.assemble],
                ['inspect-parts', JA.home.inspectParts],
                ['inspect-repair', JA.home.inspectRepair],
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
          {rows.length === 0 ? (
            <p className={styles.subtitle}>{JA.problemList.empty}</p>
          ) : (
            <table className={styles.problemTable} data-testid="problem-table">
              <thead>
                <tr>
                  <th>{JA.problemList.columnId}</th>
                  <th>{JA.problemList.columnTitle}</th>
                  <th>{JA.problemList.grade}</th>
                  <th>
                    {JA.problemList.standard}/{JA.problemList.cutoff}
                  </th>
                  <th>{JA.problemList.columnSource}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((problem) => (
                  <tr key={problem.id}>
                    <td>{problem.id}</td>
                    <td>{problem.title}</td>
                    <td>{gradeLabel(problem.grade)}</td>
                    <td>
                      {problem.standardMin}/{minutesLabel(problem.cutoffMin)}
                    </td>
                    <td>
                      <span className={styles.tag}>
                        {problem.source === 'builtin'
                          ? JA.problemList.builtin
                          : JA.problemList.user}
                      </span>
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
