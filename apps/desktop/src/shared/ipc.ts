import type { ProblemLoadError, SupportedProblem } from '@ojt/content';

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

/**
 * 開始できる課題のモード。§7.1 / §12.1
 * `@ojt/content` の `SupportedProblem` から引くので、モードが増えたら画面側が `tsc` で落ちる。
 * main も renderer も読める `src/shared/` に置く（`i18n/ja.ts` は three 由来の型を引くため
 * main から読み込めない。1D1 の方針）。
 */
export type SessionMode = SupportedProblem['mode'];

/** 課題一覧の1行（一覧画面がそのまま描ける形）。§12.1 */
export interface ProblemSummary {
  id: string;
  title: string;
  /** 課題のモード（一覧をモード別に分けるのに使う）。§12.1 */
  mode: SessionMode;
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

/**
 * 作業ファイルの中身。§12.3
 *
 * `formatVersion` は **1 のまま**にし、C1/C2 の項目はすべて**任意**にする。上げてしまうと
 * Phase 1 に保存した作業ファイルが「新しいバージョン」扱いで読めなくなり（§13 #8）、
 * §13 の「作業保持の原則」に反するためである。読み手（`applyWorkFile()`）は欠けていたら
 * 課題を最初から開く。
 */
export interface WorkFile {
  formatVersion: number;
  problemId: string;
  /** `BoardSession` をそのまま JSON にしたもの。 */
  session: unknown;
  elapsedMs: number;
  hazardCount: number;
  savedAt: string;
  /** 課題のモード（無ければ `assemble` とみなす）。§12.1 */
  mode?: SessionMode;
  /**
   * テスターのつまみとプローブの状態
   * （`{ kind, mode, voltRange, ohmRange, zeroAdjusted, black?, red? }`）。§9.3 / §12.3
   *
   * `black` / `red` は探針を挿した端子ID（役割ベース、例: `CHK.13`）で、**任意**。
   * 復元直後は `place-probe` を送り直すまで読み値が `----` のままになる不具合
   * （§12.3 のギャップ）を避けるため、つまみ・レンジ・0Ω調整を Worker に送り直した**あと**に
   * 探針を挿し直す（`replayTesterToWorker()`）。盤に無い端子（課題や盤の変更で消えた端子）を
   * 指していたら、その探針は外れたまま扱う（黙って無視する）。
   */
  tester?: unknown;
  /** モードC1のマークシートの解答（`InspectPartAnswer[]`）。§9.1 */
  answers?: unknown;
  /** モードC1で点検中の部品ID。§9.1 */
  checkPartId?: string;
  /** モードC2の指摘（`FaultReport[]`）。§9.2 */
  reports?: unknown;
  /**
   * モードC2の故障の種（起動時に決めた・課題が持たない場合は生成した値）。§5.2
   * `resolvedFaults` と対にして残す。デバッグ用の記録であり、復元には使わない
   * （`seed` だけから `resolveFaults()` を呼び直すと、`random.seed` の無い課題は内部で
   * `Date.now()` を使うため初回と別の故障になってしまう）。
   */
  faultSeed?: number;
  /**
   * モードC2の解決済みの故障（`FaultSpecData[]`）。§5.2 / Plan 2A I-4
   * 復元時は `openProblem(problem, { resolvedFaults })` へそのまま渡し、`resolveFaults()` を
   * 呼び直させない。`initialWireIds` / `cells` は同じ入力（課題・盤・この配列）から毎回同じ値に
   * なるので、別項目としては保存しない。
   */
  resolvedFaults?: unknown;
  /**
   * モードC2で良品に交換した部品のID（`string[]`）。§9.2
   * 交換は盤（`BoardSession`）を変えず `applied.partFaults` からその部品を落とすだけなので、
   * 盤の状態からは復元できない。復元時は `replacePart()` を同じ順で当て直す。
   */
  replacedPartIds?: unknown;
  /**
   * 回路図ヒントを開いた回数（モードC2の2級形式）。§8.4 2026-09-18の決定
   * 2級は開閉できて初期は閉じる。訓練者が何回開いたかを結果画面に出し、作業ファイルにも残す。
   * 1級（回路図を出さない）や旧バージョンの作業ファイルには無いので任意項目にする。
   */
  schematicOpenCount?: number;
  /**
   * モードDのラダーIR（`LadderProgramData` をそのまま JSON にしたもの）。§12.3 / 3A H-3
   * `comments`（デバイスコメント）を含む。読み手は `toLadderProgram()` が形を確かめる。
   */
  ladder?: unknown;
  /** モードDで使っている方言ID（Phase 3 は常に `mitsubishi`）。§10.5 */
  dialectId?: string;
  /**
   * 保存時点でラダーが変換を通っていたか。§10.6
   * **復元時は必ず未変換として開く**（Worker には何も載っていないため）。記録としてだけ残す。
   */
  converted?: boolean;
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
  /** 利用者課題フォルダ。空文字なら既定（`%APPDATA%/電気教育ツール/content`）。§7.8 */
  userContentDir: string;
  /** 効果音のON/OFF。§15 */
  soundEnabled: boolean;
  /** 効果音の音量（0〜1）。§15 */
  soundVolume: number;
  /** 起動時に一時保存から復帰するか確認する。§12.3 */
  restorePrompt: boolean;
  /** モードDの既定メーカー（Phase 3 は `mitsubishi` のみ実装）。§10.5 / §12.1 */
  defaultVendor: string;
  /** ラダーの表示列数（接点列。8〜15）。§10.6 */
  ladderGridCols: number;
  /** モニタ中の通電表示色（`#rrggbb`）。§10.6 */
  monitorColor: string;
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
  defaultVendor: 'mitsubishi',
  ladderGridCols: 11,
  monitorColor: '#1E64FF',
};

/** preload が `window.ojt` に公開する型付きAPI。§4.3 */
export interface OjtApi {
  listProblems: () => Promise<ProblemListPayload>;
  readProblem: (id: string) => Promise<SupportedProblem | null>;
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
export function toSummary(problem: SupportedProblem, source: 'builtin' | 'user'): ProblemSummary {
  return {
    id: problem.id,
    title: problem.title,
    mode: problem.mode,
    grade: problem.grade,
    description: problem.description,
    standardMin: problem.timeLimit.standardMin,
    cutoffMin: problem.timeLimit.cutoffMin,
    source,
  };
}
