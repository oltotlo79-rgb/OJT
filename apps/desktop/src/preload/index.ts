import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AppSettings,
  type AppSettingsResponse,
  type OjtApi,
  type OpenManualResult,
  type ProblemListPayload,
  type ResultExportRequest,
  type ResultExportResult,
  type SaveTextRequest,
  type SaveTextResult,
  type WorkFileLoadRequest,
  type WorkFileLoadResult,
  type WorkFileSaveRequest,
  type WorkFileSaveResult,
} from '../shared/ipc.js';

/**
 * preload。設計仕様 §4.3。
 * `contextBridge` で §4.3 の9チャネルだけを `window.ojt` として公開する。
 * `ipcRenderer` そのものは決して露出しない。
 */

// ローディング中はまだ編集内容がないため、そのまま閉じられる。Appが自動保存を
// 登録した後は必ず保存の結果を待つ。登録解除後は安全側に倒し、終了を許可しない。
let closeHandler: (() => Promise<boolean>) | undefined;
ipcRenderer.on(IPC_CHANNELS.closeRequest, (_event, token: unknown) => {
  if (typeof token !== 'number' || !Number.isSafeInteger(token) || token <= 0) return;
  const handler = closeHandler;
  void Promise.resolve()
    .then(() => (handler === undefined ? true : handler()))
    .then(
      (ok) => ipcRenderer.send(IPC_CHANNELS.closeReady, token, ok === true),
      () => ipcRenderer.send(IPC_CHANNELS.closeReady, token, false),
    );
});

const api: OjtApi = {
  authorContent: (request) => ipcRenderer.invoke(IPC_CHANNELS.contentAuthor, request),
  onCloseRequest: (handler) => {
    closeHandler = handler;
    return () => {
      if (closeHandler === handler) closeHandler = () => Promise.resolve(false);
    };
  },
  exportResult: (request: ResultExportRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.resultExport, request) as Promise<ResultExportResult>,
  listProblems: () => ipcRenderer.invoke(IPC_CHANNELS.contentList) as Promise<ProblemListPayload>,
  readProblem: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.contentRead, id),
  saveWorkFile: (request: WorkFileSaveRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.workfileSave, request) as Promise<WorkFileSaveResult>,
  loadWorkFile: (request: WorkFileLoadRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.workfileLoad, request) as Promise<WorkFileLoadResult>,
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet) as Promise<AppSettingsResponse>,
  setSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsSet, patch) as Promise<AppSettings>,
  // --- Plan 4B Task 9 ---
  saveTextFile: (request: SaveTextRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.textfileSave, request) as Promise<SaveTextResult>,
  // --- /Plan 4B Task 9 ---
  // --- Plan 6 Task 7 ---
  openManual: () => ipcRenderer.invoke(IPC_CHANNELS.manualOpen) as Promise<OpenManualResult>,
  // --- /Plan 6 Task 7 ---
};

contextBridge.exposeInMainWorld('ojt', api);
