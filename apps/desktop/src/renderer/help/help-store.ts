import { create } from 'zustand';
import { defaultSectionId, type HelpScreenId } from './help-model.js';

/**
 * ヘルプの状態。取扱説明書 設計 決定表#14。
 *
 * `app/store.ts` に置かないのは、ヘルプが課題ともセッションとも関わらないからである。
 * 向こうへ足すと `openProblem()` / `resetSession()` / `restartSession()` / `abandonSession()`
 * の4箇所すべてに初期値を入れて回る必要があり、入れ忘れが1つあるだけで課題をまたいで
 * 状態が残る（Plan 5 の MERGE 注意#2 が挙げた罠）。ヘルプは課題が変わっても
 * そのままでよいので、分けたほうが正しい。
 */
export interface HelpState {
  /** 引き出しが開いているか。 */
  open: boolean;
  /** いま読んでいる節。 */
  sectionId: string;
  /** 検索欄の中身（空なら本文を出す）。 */
  query: string;
  openHelp: (screen: HelpScreenId) => void;
  toggleHelp: (screen: HelpScreenId) => void;
  closeHelp: () => void;
  showSection: (sectionId: string) => void;
  setQuery: (query: string) => void;
}

export const useHelpStore = create<HelpState>((set, get) => ({
  open: false,
  sectionId: defaultSectionId('home'),
  query: '',
  openHelp: (screen) => {
    // 開くたびに「いまの画面の節」に戻し、前の検索語は消す（§5.2）
    set({ open: true, sectionId: defaultSectionId(screen), query: '' });
  },
  toggleHelp: (screen) => {
    if (get().open) set({ open: false });
    else set({ open: true, sectionId: defaultSectionId(screen), query: '' });
  },
  closeHelp: () => {
    set({ open: false });
  },
  showSection: (sectionId) => {
    // 節へ跳んだら検索の一覧は畳む（§5.3）
    set({ sectionId, query: '' });
  },
  setQuery: (query) => {
    set({ query });
  },
}));
