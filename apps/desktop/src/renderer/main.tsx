import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { JA } from './i18n/ja.js';
import './app/global.css';

/**
 * renderer のエントリ。設計仕様 §4.3。
 * `StrictMode` は使わない。開発時の二重実行で `Session` の `useEffect` が Worker を
 * 2回起動してしまい、シミュレーションが二重に走るため（本番ビルドでは起きないが、
 * 開発と本番で挙動が変わるほうが危険と判断した）。
 */

const container = document.getElementById('root');
if (container === null) throw new Error(JA.error.rootMissing);

createRoot(container).render(<App />);
