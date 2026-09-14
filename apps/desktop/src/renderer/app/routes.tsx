import type { JSX } from 'react';
import { Home } from '../screens/Home.js';
import { ProblemList } from '../screens/ProblemList.js';
import { Result } from '../screens/Result.js';
import { Session } from '../screens/Session.js';
import type { Route } from './store.js';

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
      return <Session />;
    case 'result':
      return <Result />;
    case 'settings':
      // 設定画面は Plan 1D2 で作る。それまではホームを出す。§12.1
      return <Home />;
  }
}
