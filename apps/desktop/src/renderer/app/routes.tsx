import { lazy, Suspense, type JSX } from 'react';
import { Home } from '../screens/Home.js';
import { ProblemList } from '../screens/ProblemList.js';
import { Settings } from '../screens/Settings.js';
import type { Route } from './store.js';

// 3D描画や結果比較は課題を開いてから必要になる。ホームの起動では評価しない。
const SessionRoute = lazy(() =>
  import('../screens/SessionRoute.js').then((m) => ({ default: m.SessionRoute })),
);
const Result = lazy(() => import('../screens/Result.js').then((m) => ({ default: m.Result })));

function LoadingScreen(): JSX.Element {
  return (
    <div role="status" className="screen-loading">
      画面を準備しています…
    </div>
  );
}

/**
 * 画面の切り替え。設計仕様 §12.1。
 * ルータライブラリは使わない（画面が5つしかなく、履歴も戻るボタンも要らないため）。
 */

/** ルート → 画面。 */
export function renderRoute(route: Route): JSX.Element {
  switch (route) {
    case 'home':
      return <Home />;
    case 'list':
      return <ProblemList />;
    case 'session':
      return (
        <Suspense fallback={<LoadingScreen />}>
          <SessionRoute />
        </Suspense>
      );
    case 'result':
      return (
        <Suspense fallback={<LoadingScreen />}>
          <Result />
        </Suspense>
      );
    case 'settings':
      return <Settings />;
  }
}
