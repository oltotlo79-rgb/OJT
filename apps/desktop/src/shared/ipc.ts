import type { AssembleProblem, ProblemLoadError } from '@ojt/content';

/**
 * main ⇄ renderer の IPC 契約。設計仕様 §4.3。
 * チャネルは `content:list` / `content:read` / `workfile:save` / `workfile:load` /
 * `settings:get` / `settings:set` の **6本のみ**。preload はこの6本だけを `window.ojt` に出す。
 */

/** IPCチャネル名（この6本以外を足さない。§4.3）。 */
export const IPC_CHANNELS = {
  contentList: 'content:list',
  contentRead: 'content:read',
  workfileSave: 'workfile:save',
  workfileLoad: 'workfile:load',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
} as const;

/** 課題一覧の1行（一覧画面がそのまま描ける形）。§12.1 */
export interface ProblemSummary {
  id: string;
  title: string;
  grade: 1 | 2 | 3;
  /** 課題文の先頭（一覧の説明）。 */
  description: string;
  standardMin: number;
  cutoffMin: number;
  /** 利用者フォルダ由来か。§7.8 */
  source: 'builtin' | 'user';
}

/** 読込に失敗した課題の1行。§13 #1 */
export interface ProblemErrorRow {
  file: string;
  reason: string;
  message: string;
  details: string[];
}

/** `content:list` の戻り。 */
export interface ProblemListPayload {
  problems: ProblemSummary[];
  errors: ProblemErrorRow[];
  /** 利用者課題フォルダの絶対パス（設定画面の表示用）。§7.8 */
  userDir: string;
  /** 利用者課題フォルダが存在したか。§13 #9 */
  userDirExists: boolean;
}

/** 作業ファイルの形式バージョン。未知のバージョンは読み込まない。§13 #8 */
export const WORK_FILE_FORMAT_VERSION = 1;

/** 作業ファイルの中身。§12.3 */
export interface WorkFile {
  formatVersion: number;
  problemId: string;
  /** `BoardSession` をそのまま JSON にしたもの。 */
  session: unknown;
  elapsedMs: number;
  hazardCount: number;
  savedAt: string;
}

/** 保存要求。`kind: 'autosave'` は既定の一時保存先へ黙って書く（§12.3）。 */
export interface WorkFileSaveRequest {
  kind: 'manual' | 'autosave';
  file: WorkFile;
}

/** 保存結果。§13 #7 */
export type WorkFileSaveResult =
  { ok: true; path: string } | { ok: false; canceled: boolean; message: string };

/**
 * 読込要求。
 * `discard: true` は読まずに一時保存を削除する（§12.3「復元しない選択をした場合は
 * 一時保存を削除する」）。§4.3 の6チャネルを増やさないため、削除もこのチャネルで表す。
 */
export interface WorkFileLoadRequest {
  kind: 'manual' | 'autosave';
  discard?: boolean;
}

/** 読込結果。§13 #8 */
export type WorkFileLoadResult =
  { ok: true; file: WorkFile; path: string } | { ok: false; canceled: boolean; message: string };

/** アプリ設定。§12.1 */
export interface AppSettings {
  /** 利用者課題フォルダ。空文字なら既定（`%APPDATA%/OJT電気保全トレーナー/content`）。§7.8 */
  userContentDir: string;
  /** 効果音のON/OFF。§15 */
  soundEnabled: boolean;
  /** 効果音の音量（0〜1）。§15 */
  soundVolume: number;
  /** 起動時に一時保存から復帰するか確認する。§12.3 */
  restorePrompt: boolean;
}

/**
 * `settings:get` の戻り。§12.1
 * 設定ファイルが壊れていた等の**警告**を添えられるようにする。§4.3 のチャネルを増やさずに
 * 「既定値で起動した理由」を画面へ届けるため、7本目を作らずこの戻り値へ載せる。
 */
export interface AppSettingsResponse extends AppSettings {
  warning?: string;
}

/** 設定の既定値。 */
export const DEFAULT_SETTINGS: AppSettings = {
  userContentDir: '',
  soundEnabled: true,
  soundVolume: 0.5,
  restorePrompt: true,
};

/** preload が `window.ojt` に公開する型付きAPI。§4.3 */
export interface OjtApi {
  listProblems: () => Promise<ProblemListPayload>;
  readProblem: (id: string) => Promise<AssembleProblem | null>;
  saveWorkFile: (request: WorkFileSaveRequest) => Promise<WorkFileSaveResult>;
  loadWorkFile: (request: WorkFileLoadRequest) => Promise<WorkFileLoadResult>;
  getSettings: () => Promise<AppSettingsResponse>;
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}

/** `ProblemLoadError` を一覧行に直す。§13 #1 */
export function toErrorRow(error: ProblemLoadError): ProblemErrorRow {
  return {
    file: error.file,
    reason: error.reason,
    message: error.message,
    details: error.issues.map((i) => `${i.path}: ${i.message}`),
  };
}

/** 課題を一覧行に直す。 */
export function toSummary(problem: AssembleProblem, source: 'builtin' | 'user'): ProblemSummary {
  return {
    id: problem.id,
    title: problem.title,
    grade: problem.grade,
    description: problem.description,
    standardMin: problem.timeLimit.standardMin,
    cutoffMin: problem.timeLimit.cutoffMin,
    source,
  };
}
