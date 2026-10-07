import type { SupportedProblem } from '@ojt/content';
import { create } from 'zustand';
import { useStore } from '../app/store.js';
import { ojtApi } from '../app/ojt-api.js';
import { markWorkSaved, persistentWorkKey, toInspectWorkFile } from './work-file.js';
import { stopReplay } from './replay.js';

interface PendingChange {
  problem: SupportedProblem;
  from: SupportedProblem;
  restart: boolean;
}
interface NavigationState {
  pending: PendingChange | undefined;
  busy: boolean;
  message: string;
}
export const useProblemNavigation = create<NavigationState>(() => ({
  pending: undefined,
  busy: false,
  message: '',
}));

// 新規に開いた直後の状態だけを識別する。復元した作業は、この基準へ登録しない。
// 復元元が唯一のautosaveでも、新課題による上書き前に必ず保存を選べるようにする。
let baseline: { problem: SupportedProblem; key: string } | undefined;
function openFresh(problem: SupportedProblem): boolean {
  if (!useStore.getState().openProblem(problem)) return false;
  const state = useStore.getState();
  const file = toInspectWorkFile();
  baseline =
    file === undefined ? undefined : { problem: state.problem!, key: persistentWorkKey(file) };
  return true;
}

/** 一覧・ホームへ移っただけなら、盤・履歴・解答をそのまま再開する。 */
export function resumeCurrentProblem(): void {
  const state = useStore.getState();
  if (state.problem === undefined || state.session === undefined) return;
  if (state.replay !== undefined) stopReplay();
  useStore.setState({ route: 'session', replay: undefined, judging: false });
}

/**
 * 利用者が課題を選ぶ入口。復元/採点の内部openProblemにはUI確認を混ぜない。
 * `fresh` は「新しく始める」（回路実験・PLC実験の開始。2026-10-08）で、同じIDの課題を
 * いま開いていても続きを再開せず、作業を置き換える（必要なら確認を出す）。
 */
export function requestOpenProblem(
  problem: SupportedProblem,
  options: { fresh?: boolean } = {},
): void {
  if (useProblemNavigation.getState().pending !== undefined) return;
  const state = useStore.getState();
  if (options.fresh !== true && state.problem?.id === problem.id && state.session !== undefined) {
    resumeCurrentProblem();
    return;
  }
  const file = toInspectWorkFile();
  const pristine =
    file !== undefined &&
    baseline !== undefined &&
    baseline.problem === state.problem &&
    baseline.key === persistentWorkKey(file);
  if (state.problem === undefined || state.session === undefined || pristine) {
    openFresh(problem);
    return;
  }
  useProblemNavigation.setState({
    pending: { problem, from: state.problem, restart: false },
    busy: false,
    message: '',
  });
}

export function requestRestartProblem(): void {
  const state = useStore.getState();
  if (state.problem === undefined || useProblemNavigation.getState().pending !== undefined) return;
  useProblemNavigation.setState({
    pending: { problem: state.problem, from: state.problem, restart: true },
    busy: false,
    message: '',
  });
}

export function cancelProblemChange(): void {
  if (!useProblemNavigation.getState().busy)
    useProblemNavigation.setState({ pending: undefined, message: '' });
}

/** 保存取消/失敗/保存中の追加編集では、元の作業も確認欄も残す。 */
export async function confirmProblemChange(save: boolean): Promise<void> {
  const { pending, busy } = useProblemNavigation.getState();
  if (pending === undefined || busy) return;
  useProblemNavigation.setState({ busy: true, message: '' });
  try {
    if (useStore.getState().problem !== pending.from) {
      useProblemNavigation.setState({ pending: undefined });
      return;
    }
    if (save) {
      const current = toInspectWorkFile();
      if (current === undefined) {
        useProblemNavigation.setState({
          message: '作業を保存できません。見直しを終了してから再試行してください。',
        });
        return;
      }
      const file = structuredClone(current);
      const result = await ojtApi().saveWorkFile({ kind: 'manual', file });
      if (!result.ok) {
        useProblemNavigation.setState({
          message: result.canceled
            ? '保存を取り消しました。現在の作業はそのままです。'
            : result.message,
        });
        return;
      }
      markWorkSaved(file);
      const latest = toInspectWorkFile();
      if (latest === undefined || persistentWorkKey(latest) !== persistentWorkKey(file)) {
        useProblemNavigation.setState({
          message: '保存中に作業が変わりました。最新の内容を保存してから進んでください。',
        });
        return;
      }
    }
    if (
      useProblemNavigation.getState().pending !== pending ||
      useStore.getState().problem !== pending.from
    )
      return;
    if (openFresh(pending.problem)) useProblemNavigation.setState({ pending: undefined });
    else
      useProblemNavigation.setState({
        message: '課題を開けませんでした。現在の作業を保持しています。',
      });
  } catch (error) {
    useProblemNavigation.setState({ message: `保存できませんでした：${String(error)}` });
  } finally {
    useProblemNavigation.setState({ busy: false });
  }
}
