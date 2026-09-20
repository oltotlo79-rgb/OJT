import { useEffect, useState, type JSX } from 'react';
import type { OjtApi, WorkFile } from '../../shared/ipc.js';
import { sounds } from '../audio/sounds.js';
import { HelpRoot } from '../help/HelpRoot.js';
import { JA, sessionModeLabel } from '../i18n/ja.js';
import { applyWorkFile, toInspectWorkFile } from '../session/work-file.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { tryOjtApi } from './ojt-api.js';
import { renderRoute } from './routes.js';
import { useStore, type Route } from './store.js';
import { formatElapsed, formatSavedAt } from '../../worker/runtime.js';
import styles from './app.module.css';

/**
 * アプリの外枠。設計仕様 §12.1 / §13 #5 / §12.3 / §15。
 * 未捕捉例外は上部の例外バナーで知らせ、「セッションをリセット」で復帰できるようにする。
 * 起動時は設定を読み、効果音に反映したうえで、一時保存が残っていれば復元を確認する。
 * 作業中は30秒ごとに一時保存する。
 *
 * バナーとトーストは `ErrorBoundary` の**外**に置く。中に置くと、描画中に例外が出たときに
 * バナーごと消えてしまい、訓練者には真っ黒な画面しか残らない（§13 #5 の要件が満たせない）。
 */

/** 期限切れトーストを掃除する間隔[ms]。 */
const TOAST_SWEEP_MS = 250;

/** 一時保存の間隔[ms]。§12.3 */
const AUTOSAVE_INTERVAL_MS = 30_000;

/** `window.ojt` を取り出す。preload が無ければ `undefined`（呼び出し側は黙って諦める）。 */
function tryApi(): OjtApi | undefined {
  return tryOjtApi();
}

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
  const pendingWorkFile = useStore((s) => s.pendingWorkFile);
  const problemId = useStore((s) => s.problem?.id);
  const [pendingRestore, setPendingRestore] = useState<WorkFile | undefined>(undefined);
  /** 復元プロンプトの保存時刻（ローカル日時表記）。整形できなければ空文字（時刻無し表示）。 */
  const restoreSavedAtLabel =
    pendingRestore === undefined ? '' : formatSavedAt(pendingRestore.savedAt);
  /**
   * 復元カードに出す課題名（UXレビュー #15）。§12.3 の一時保存は `problemId`（内部ID）しか
   * 持たないので、`readProblem()` で引き直す。起動直後は一覧をまだ読んでおらず、
   * 引けるまでは `restoreCard.unknownProblem` を出す。preload が古い・テスト用の簡易実装で
   * `readProblem` が無いときは黙って諦める（他の `tryApi()` 呼び出しと同じ流儀。§13 #5）。
   */
  const [restoreProblemTitle, setRestoreProblemTitle] = useState<string | undefined>(undefined);
  useEffect(() => {
    setRestoreProblemTitle(undefined);
    if (pendingRestore === undefined) return undefined;
    const api = tryApi();
    if (api === undefined || typeof api.readProblem !== 'function') return undefined;
    let cancelled = false;
    api.readProblem(pendingRestore.problemId).then(
      (problem) => {
        if (!cancelled && problem !== null) setRestoreProblemTitle(problem.title);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [pendingRestore]);

  /*
   * 課題を開いたら復元の確認欄は引っ込める（1D2-a のレビュー指摘）。
   * 訓練者が先に課題一覧から作業を始めたのに「前回の作業を復元しますか？」が居座り続けると、
   * あとから押したときに、いま組んでいる盤が黙って消えてしまう。
   */
  useEffect(() => {
    if (problemId !== undefined) setPendingRestore(undefined);
  }, [problemId]);

  /*
   * 起動時: 設定を読み、効果音に反映したうえで一時保存が残っていれば復元を確認する（§12.3 / §15）。
   * `restorePrompt` 設定が無効なら一時保存には触れない（読み込みもしない）。
   * preload が無い環境（設定ミス・素のブラウザ）では黙って諦める（§13 #5）。
   */
  useEffect(() => {
    const api = tryApi();
    if (api === undefined) return;
    void api.getSettings().then(
      (settings) => {
        sounds.configure({ enabled: settings.soundEnabled, volume: settings.soundVolume });
        useStore.getState().applyLadderSettings({
          gridCols: settings.ladderGridCols,
          monitorColor: settings.monitorColor,
          vendor: settings.defaultVendor,
        });
        // 設定ファイルが壊れていた（main が控えを取って既定値で起動した）ことを知らせる。§12.1
        if (settings.warning !== undefined) {
          useStore.getState().toast(settings.warning, 'error');
        }
        if (!settings.restorePrompt) return;
        void api.loadWorkFile({ kind: 'autosave' }).then(
          (restored) => {
            if (restored.ok) setPendingRestore(restored.file);
          },
          () => {
            // 一時保存が読めなくても起動は続ける
          },
        );
      },
      () => {
        // 設定が読めなくても起動は続ける（既定＝内蔵課題のみ・復元確認なし・音は既定のまま）
      },
    );
  }, []);

  /*
   * 作業中は30秒ごとに一時保存する（§12.3）。
   * Session 画面が持つ状態（課題・盤・経過時間・危険操作数）はすべてストアにあるので、
   * ここから直接読める。`route === 'session'` の間だけ動かす。
   *
   * 保存結果は `.then` で受け、**連続失敗2回目で1度だけ**トーストを出す（DS-4）。
   * 毎回出すと訓練の邪魔になる一方、黙って失敗し続けるとクラッシュ時に何も残らない。
   * 成功したら連続失敗のカウントを戻す。
   */
  useEffect(() => {
    let consecutiveFailures = 0;
    const id = setInterval(() => {
      const api = tryApi();
      if (api === undefined) return;
      if (useStore.getState().route !== 'session') return;
      // モードC1/C2はテスター・解答・指摘・故障も一緒に残す（§12.3。Plan 2B Task 17）
      const file = toInspectWorkFile();
      if (file === undefined) return;
      const onSettled = (ok: boolean): void => {
        if (ok) {
          consecutiveFailures = 0;
          return;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures === 2) {
          useStore.getState().toast(JA.error.autosaveFailed, 'error');
        }
      };
      void api.saveWorkFile({ kind: 'autosave', file }).then(
        (result) => onSettled(result.ok),
        () => onSettled(false),
      );
    }, AUTOSAVE_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

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
      const store = useStore.getState();
      store.expireToasts();
      // 危険操作の帯も同じ間引きで畳む（§5.6。期限が来ていなければ何もしない）
      store.dismissHazard(Date.now());
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
            data-testid="error-reset"
            onClick={() => {
              useStore.getState().restartSession();
            }}
          >
            {JA.error.reset}
          </button>
          {/*
            盤そのものが描けないときは「リセット」では抜け出せない（レビュー指摘: 詰み）。
            課題ごと捨てて一覧へ戻る導線を必ず添える。§13 #5
          */}
          <button
            type="button"
            data-testid="error-to-list"
            onClick={() => {
              useStore.getState().abandonSession();
            }}
          >
            {JA.error.toList}
          </button>
        </div>
      )}
      {pendingWorkFile === undefined ? null : (
        <div className={styles.restorePrompt} role="dialog" data-testid="discard-confirm">
          <span>{JA.session.discardTitle}</span>
          <button
            type="button"
            onClick={() => {
              const file = pendingWorkFile;
              useStore.getState().setPendingWorkFile(undefined);
              void applyWorkFile(file, { confirmed: true });
            }}
          >
            {JA.session.discardYes}
          </button>
          <button
            type="button"
            onClick={() => {
              useStore.getState().setPendingWorkFile(undefined);
            }}
          >
            {JA.session.discardNo}
          </button>
        </div>
      )}
      {pendingRestore === undefined ? null : (
        <div className={styles.restoreCard} role="dialog" data-testid="restore-prompt">
          <p className={styles.restoreCardTitle}>
            {restoreSavedAtLabel === ''
              ? JA.session.restoreTitle
              : `${JA.session.restoreTitle}（${restoreSavedAtLabel}）`}
          </p>
          {/*
            UXレビュー #15: どの課題のどんな作業を復元するのか（モード・課題名・経過時間）を
            具体的に見せる。「復元する」を押す前に中身が分かるようにする。
          */}
          <dl className={styles.restoreCardDetail} data-testid="restore-detail">
            <dt>{JA.restoreCard.mode}</dt>
            <dd>{sessionModeLabel(pendingRestore.mode)}</dd>
            <dt>{JA.restoreCard.problem}</dt>
            <dd>{restoreProblemTitle ?? JA.restoreCard.unknownProblem}</dd>
            <dt>{JA.restoreCard.elapsed}</dt>
            <dd>{formatElapsed(pendingRestore.elapsedMs)}</dd>
          </dl>
          <div className={styles.restoreCardActions}>
            <button
              type="button"
              onClick={() => {
                const file = pendingRestore;
                setPendingRestore(undefined);
                void applyWorkFile(file);
              }}
            >
              {JA.session.restoreYes}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingRestore(undefined);
                void tryApi()?.loadWorkFile({ kind: 'autosave', discard: true });
              }}
            >
              {JA.session.restoreNo}
            </button>
          </div>
        </div>
      )}
      <ErrorBoundary
        key={sessionEpoch}
        onError={(message) => {
          useStore.getState().setFatalError(message);
        }}
        onRender={() => {
          useStore.getState().noteRenderSuccess();
        }}
      >
        <RouteView route={route} />
      </ErrorBoundary>
      {/*
        ヘルプの引き出しと `F1` の窓口（Plan 6 Task 9）。`ErrorBoundary` の**外**に置く。
        中に置くと、引き出しの中で例外が出たときに引き出しごと消えてバナーまで消える。
      */}
      <HelpRoot />
      <div className={styles.toasts}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${
              toast.tone === 'error'
                ? styles.toastError
                : toast.tone === 'warn'
                  ? styles.toastWarn
                  : ''
            }`}
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
