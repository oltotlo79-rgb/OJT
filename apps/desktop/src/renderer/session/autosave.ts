import { useSyncExternalStore } from 'react';
import { useStore, type AppState } from '../app/store.js';
import { ojtApi, tryOjtApi } from '../app/ojt-api.js';
import { toInspectWorkFile } from './work-file.js';

type SaveStatus = {
  state: 'idle' | 'pending' | 'saving' | 'saved' | 'failed';
  at?: string;
  message?: string;
};
let status: SaveStatus = { state: 'idle' };
const listeners = new Set<() => void>();
function publish(next: SaveStatus): void {
  status = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useAutosaveStatus(): SaveStatus {
  return useSyncExternalStore(subscribe, () => status);
}

/** A single writer; a newer revision can never be overwritten by an older request. */
let revision = 0;
let savedRevision = -1;
let flight: Promise<boolean> | undefined;
export function flushAutosave(): Promise<boolean> {
  if (flight !== undefined) return flight;
  flight = (async (): Promise<boolean> => {
    while (revision !== savedRevision) {
      const file = toInspectWorkFile();
      if (file === undefined) return true;
      const savingRevision = revision;
      publish({ state: 'saving' });
      try {
        const result = await ojtApi().saveWorkFile({ kind: 'autosave', file });
        if (!result.ok) {
          publish({ state: 'failed', message: result.message });
          return false;
        }
        savedRevision = savingRevision;
        publish(
          revision === savedRevision ? { state: 'saved', at: file.savedAt } : { state: 'pending' },
        );
      } catch (error) {
        publish({ state: 'failed', message: String(error) });
        return false;
      }
    }
    return true;
  })().finally(() => {
    flight = undefined;
  });
  return flight;
}

const durableKeys = [
  'measurements',
  'diagnosisNotes',
  'problem',
  'session',
  'ladder',
  'ladderComments',
  'answers',
  'reports',
  'circuit',
  'schematicDoc',
  'hintStage',
  'schematicOpenCount',
  'watchDevices',
  'restoredHazardCount',
  'hazards',
  'checkPartId',
  'tester',
] as const satisfies readonly (keyof AppState)[];
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = (): void => {
    revision += 1;
    publish({ state: 'pending' });
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      void flushAutosave();
    }, 1200);
  };
  const stop = useStore.subscribe((next, previous) => {
    if (durableKeys.some((key) => next[key] !== previous[key])) changed();
  });
  // Checkpoints also retain elapsed time for exercises without further edits.
  const interval = setInterval(() => {
    if (useStore.getState().route === 'session') changed();
  }, 30_000);
  const stopClosing = tryOjtApi()?.onCloseRequest?.(async () => {
    revision += 1;
    const ok = await flushAutosave();
    if (!ok)
      useStore
        .getState()
        .toast(
          '自動保存に失敗したため終了を中止しました。保存表示から再試行するか、作業ファイルを保存してください。',
          'error',
        );
    return ok;
  });
  return () => {
    stop();
    stopClosing?.();
    clearInterval(interval);
    if (timer !== undefined) clearTimeout(timer);
  };
}
