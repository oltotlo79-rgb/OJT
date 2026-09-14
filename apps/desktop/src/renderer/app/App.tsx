import { useEffect, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { renderRoute } from './routes.js';
import { useStore, type Route } from './store.js';
import styles from './app.module.css';

/**
 * アプリの外枠。設計仕様 §12.1 / §13 #5。
 * 未捕捉例外は上部の例外バナーで知らせ、「セッションをリセット」で復帰できるようにする。
 *
 * バナーとトーストは `ErrorBoundary` の**外**に置く。中に置くと、描画中に例外が出たときに
 * バナーごと消えてしまい、訓練者には真っ黒な画面しか残らない（§13 #5 の要件が満たせない）。
 */

/** 期限切れトーストを掃除する間隔[ms]。 */
const TOAST_SWEEP_MS = 250;

/**
 * 画面1枚。**必ず境界の子コンポーネントとして**描く。
 * `<ErrorBoundary>{renderRoute(route)}</ErrorBoundary>` と書くと `renderRoute()` は
 * `App` の描画中に評価されるので、そこで投げられた例外は境界より外で起きたことになり
 * 受け止められない（`App` ごと落ちてバナーも消える）。
 */
function RouteView({ route }: { route: Route }): JSX.Element {
  return renderRoute(route);
}

/** アプリ本体。 */
export function App(): JSX.Element {
  const route = useStore((s) => s.route);
  const toasts = useStore((s) => s.toasts);
  const fatalError = useStore((s) => s.fatalError);
  const sessionEpoch = useStore((s) => s.sessionEpoch);

  // 未捕捉例外を拾って例外バナーに出す（§13 #5）。描画中の例外は `ErrorBoundary` が拾う
  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      useStore.getState().setFatalError(event.message);
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      useStore.getState().setFatalError(String(event.reason));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  /**
   * トーストを時間で消す。§8.2
   * 期限は1件ごとに `Toast.expiresAt` が持ち、ここは一定間隔で掃除するだけにする。
   * 「先頭の1件にタイマを張る」方式だと、後から積まれるたびにタイマが張り直されて
   * 連続して失敗したときに1件も消えなくなる。
   */
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().expireToasts();
    }, TOAST_SWEEP_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  return (
    <div className={styles.shell}>
      {fatalError === undefined ? null : (
        <div className={styles.banner} role="alert" data-testid="error-banner">
          <span>
            {JA.error.banner}: {fatalError}
          </span>
          <button
            type="button"
            onClick={() => {
              useStore.getState().restartSession();
            }}
          >
            {JA.error.reset}
          </button>
        </div>
      )}
      <ErrorBoundary
        key={sessionEpoch}
        onError={(message) => {
          useStore.getState().setFatalError(message);
        }}
      >
        <RouteView route={route} />
      </ErrorBoundary>
      <div className={styles.toasts}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${toast.tone === 'error' ? styles.toastError : ''}`}
            data-testid="toast"
            role="status"
          >
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}
