import { useEffect, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { renderRoute } from './routes.js';
import { useStore } from './store.js';
import styles from './app.module.css';

/**
 * アプリの外枠。設計仕様 §12.1 / §13 #5。
 * 未捕捉例外は上部の例外バナーで知らせ、「セッションをリセット」で復帰できるようにする。
 */

/** トーストを自動で消すまでの時間[ms]。 */
const TOAST_TTL_MS = 4000;

/** アプリ本体。 */
export function App(): JSX.Element {
  const route = useStore((s) => s.route);
  const toasts = useStore((s) => s.toasts);
  const fatalError = useStore((s) => s.fatalError);

  // 未捕捉例外を拾って例外バナーに出す（§13 #5）
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

  // トーストを時間で消す
  useEffect(() => {
    const first = toasts[0];
    if (first === undefined) return;
    const id = setTimeout(() => {
      useStore.getState().dismissToast(first.id);
    }, TOAST_TTL_MS);
    return () => {
      clearTimeout(id);
    };
  }, [toasts]);

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
              const store = useStore.getState();
              store.setFatalError(undefined);
              store.resetSession();
            }}
          >
            {JA.error.reset}
          </button>
        </div>
      )}
      {renderRoute(route)}
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
