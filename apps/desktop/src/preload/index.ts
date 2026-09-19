import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AppSettings,
  type AppSettingsResponse,
  type OjtApi,
  type ProblemListPayload,
  type SaveTextRequest,
  type SaveTextResult,
  type WorkFileLoadRequest,
  type WorkFileLoadResult,
  type WorkFileSaveRequest,
  type WorkFileSaveResult,
} from '../shared/ipc.js';

/**
 * preload。設計仕様 §4.3。
 * `contextBridge` で §4.3 の7チャネルだけを `window.ojt` として公開する。
 * `ipcRenderer` そのものは決して露出しない。
 */

const api: OjtApi = {
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
};

contextBridge.exposeInMainWorld('ojt', api);
