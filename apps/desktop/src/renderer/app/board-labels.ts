import { JA } from '../i18n/ja.js';
import { tryOjtApi } from './ojt-api.js';
import { useStore } from './store.js';
import { applyBoardLabels } from './ui-preferences.js';

/**
 * 「3Dの名札を表示」を切り替える（v2.1.0 監査 U3）。画面へすぐ反映してから設定に保存する。
 * 保存に失敗しても画面の切替はそのまま（この起動のあいだは効く）にし、次の起動で戻ることを知らせる。
 */
export function setBoardLabelsVisible(show: boolean): void {
  applyBoardLabels(show);
  const api = tryOjtApi();
  if (api === undefined) return;
  void api.setSettings({ showBoardLabels: show }).catch(() => {
    useStore.getState().toast(JA.toolbarOverflow.boardLabelsSaveFailed, 'error');
  });
}
