import { useEffect, type JSX } from 'react';
import { gradeLabel, JA } from '../i18n/ja.js';
import { useStore } from '../app/store.js';
import styles from './screens.module.css';

/**
 * 課題一覧。設計仕様 §12.1。
 * main の `content:list` が返した一覧をそのまま並べる。
 * 読込エラーの表示と利用者フォルダの合流は Plan 1D2 で足す（§13 #1 / §13 #9）。
 */

/** 課題一覧画面。 */
export function ProblemList(): JSX.Element {
  const problems = useStore((s) => s.problems);
  const setProblems = useStore((s) => s.setProblems);
  const setRoute = useStore((s) => s.setRoute);
  const openProblem = useStore((s) => s.openProblem);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    void window.ojt.listProblems().then(setProblems);
  }, [setProblems]);

  const open = (id: string): void => {
    void window.ojt.readProblem(id).then((problem) => {
      if (problem === null) {
        toast(`課題を読み込めませんでした: ${id}`, 'error');
        return;
      }
      openProblem(problem);
    });
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
      {problems === undefined ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : problems.problems.length === 0 ? (
        <p className={styles.subtitle}>{JA.problemList.empty}</p>
      ) : (
        <table className={styles.problemTable} data-testid="problem-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>課題名</th>
              <th>級</th>
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
                  {problem.standardMin}/{problem.cutoffMin}
                  {JA.problemList.minutes}
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
