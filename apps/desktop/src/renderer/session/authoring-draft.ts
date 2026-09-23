import type { DefinitionValidation } from '@ojt/content';
import { create } from 'zustand';
import type { AuthoringDraft } from '../../shared/authoring.js';
import { tryOjtApi } from '../app/ojt-api.js';

interface AuthoringState {
  text: string;
  savedText: string;
  templateId: string;
  savedDirectory: string;
  revision: number;
  validation: DefinitionValidation | undefined;
  message: string;
  busy: boolean;
  referenceInputPending: boolean;
  persistence: 'loading' | 'idle' | 'pending' | 'saving' | 'saved' | 'failed';
  persistenceMessage: string;
  savedAt: string;
}
export const useAuthoringDraft = create<AuthoringState>(() => ({
  text: '',
  savedText: '',
  templateId: '',
  savedDirectory: '',
  revision: 0,
  validation: undefined,
  message: '',
  busy: false,
  referenceInputPending: false,
  persistence: 'idle',
  persistenceMessage: '',
  savedAt: '',
}));

export function editAuthoringText(text: string): void {
  const state = useAuthoringDraft.getState();
  useAuthoringDraft.setState({
    text,
    revision: state.revision + 1,
    validation: undefined,
    message: '編集中の内容は下書きへ保存します。配布前に検証してください。',
  });
}

const durableKeys = ['text', 'savedText', 'templateId', 'savedDirectory'] as const;
let revision = 0;
let savedRevision = 0;
let flight: Promise<boolean> | undefined;
let loading: Promise<void> | undefined;
let readingFailed = false;
let replacingFromDisk = false;

function draftSnapshot(): AuthoringDraft {
  const state = useAuthoringDraft.getState();
  return {
    formatVersion: 1,
    text: state.text,
    savedText: state.savedText,
    templateId: state.templateId,
    savedDirectory: state.savedDirectory,
    savedAt: new Date().toISOString(),
  };
}

/** 単一の書き手。古い応答が新しい編集を保存済みへ変えない。 */
export function flushAuthoringDraft(): Promise<boolean> {
  if (flight !== undefined) return flight;
  flight = (async (): Promise<boolean> => {
    await loading;
    if (readingFailed) return revision === savedRevision;
    while (revision !== savedRevision) {
      const api = tryOjtApi()?.authorContent;
      if (api === undefined) {
        useAuthoringDraft.setState({
          persistence: 'failed',
          persistenceMessage: '課題下書きの保存機能を読み込めません。',
        });
        return false;
      }
      const savingRevision = revision;
      const draft = draftSnapshot();
      useAuthoringDraft.setState({ persistence: 'saving' });
      try {
        const result = await api({ action: 'draft-save', draft });
        if (!result.ok) {
          useAuthoringDraft.setState({ persistence: 'failed', persistenceMessage: result.message });
          return false;
        }
        savedRevision = savingRevision;
        useAuthoringDraft.setState({
          persistence: revision === savedRevision ? 'saved' : 'pending',
          savedAt: draft.savedAt,
          persistenceMessage: result.warning ?? '',
        });
      } catch (error) {
        useAuthoringDraft.setState({ persistence: 'failed', persistenceMessage: String(error) });
        return false;
      }
    }
    return true;
  })().finally(() => {
    flight = undefined;
  });
  return flight;
}

/** 読込中に利用者が編集した場合は、ディスクの内容で上書きしない。 */
async function readDraft(): Promise<void> {
  const api = tryOjtApi()?.authorContent;
  if (api === undefined) return;
  const atRevision = revision;
  const canReplace = revision === savedRevision && useAuthoringDraft.getState().text === '';
  useAuthoringDraft.setState({ persistence: 'loading' });
  try {
    const result = await api({ action: 'draft-load' });
    if (!result.ok) {
      readingFailed = true;
      useAuthoringDraft.setState({ persistence: 'failed', persistenceMessage: result.message });
      return;
    }
    readingFailed = false;
    replacingFromDisk = true;
    try {
      if (result.draft !== undefined && canReplace && revision === atRevision) {
        const { text, savedText, templateId, savedDirectory, savedAt } = result.draft;
        useAuthoringDraft.setState({
          text,
          savedText,
          templateId,
          savedDirectory,
          savedAt,
          revision: useAuthoringDraft.getState().revision + 1,
          validation: undefined,
          message: text ? '前回の課題下書きを復元しました。編集の続きから再開できます。' : '',
        });
        savedRevision = revision;
      }
      useAuthoringDraft.setState({
        persistence: revision === savedRevision ? 'saved' : 'pending',
        persistenceMessage: result.warning ?? '',
      });
    } finally {
      replacingFromDisk = false;
    }
  } catch (error) {
    readingFailed = true;
    useAuthoringDraft.setState({ persistence: 'failed', persistenceMessage: String(error) });
  }
}

export async function retryAuthoringDraft(): Promise<boolean> {
  if (readingFailed) {
    loading = readDraft();
    await loading;
  }
  return flushAuthoringDraft();
}

/** Appで1度だけ開始し、設定画面を閉じても購読を続ける。 */
export function startAuthoringDraft(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = useAuthoringDraft.subscribe((next, previous) => {
    if (replacingFromDisk || !durableKeys.some((key) => next[key] !== previous[key])) return;
    revision += 1;
    useAuthoringDraft.setState({ persistence: 'pending' });
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flushAuthoringDraft();
    }, 1000);
  });
  loading ??= readDraft();
  return () => {
    stop();
    clearTimeout(timer);
  };
}
