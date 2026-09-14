import { useEffect, useState, type JSX } from 'react';
import { gradeLabel, JA, minutesLabel } from '../i18n/ja.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import styles from './screens.module.css';

/**
 * 課題一覧。設計仕様 §12.1。
 * main の `content:list` が返した一覧をそのまま並べる。
 * 利用者フォルダの合流は Plan 1D2 で足す（§13 #9）。
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
        <table className={styles.problemTable} data-testid="problem-table">
          <thead>
            <tr>
              <th>{JA.problemList.columnId}</th>
              <th>{JA.problemList.columnTitle}</th>
              <th>{JA.problemList.grade}</th>
              <th>
                {JA.problemList.standard}/{JA.problemList.cutoff}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {problems.problems.map((problem) => (
              <tr key={problem.id}>
                <td>{problem.id}</td>
                <td>{problem.title}</td>
                <td>{gradeLabel(problem.grade)}</td>
                <td>
                  {problem.standardMin}/{minutesLabel(problem.cutoffMin)}
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
    </div>
  );
}
