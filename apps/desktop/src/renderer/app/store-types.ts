import type { HazardKind } from '@ojt/circuit-sim';
import type { SessionMode } from '../../shared/ipc.js';

/**
 * ストアの値型のうち、React にも three にも依存しないもの。設計仕様 §12.1 / §12.2。
 * `store.ts`（zustand）と、three を読み込めない場所（E2E の射影計算など）で共有する。
 */

/** 画面。§12.1 */
export type Route = 'home' | 'list' | 'session' | 'result' | 'settings';

/**
 * 課題一覧の絞り込み（`undefined` は「すべて」）。§12.1
 * モードの3値は `shared/ipc.ts` の `SessionMode`（`SupportedProblem['mode']` そのもの）を
 * 借りる。同じユニオンを2箇所に書くと、モードが増えたときに片方だけ直してしまう。
 */
export type ListMode = SessionMode | undefined;

/**
 * 視点プリセット。§12.2
 *
 * `front`（正面）／`top`（俯瞰）／`socket`（ソケット拡大）はツールバーの3ボタンと同じ。
 * `back` / `left` / `right` / `bottom` は Blender 風のテンキー操作とビューキューブの面から
 * 使う方向プリセット（2026-09-14 の利用者要望）。
 * `plc` は机上のPLC本体と壁コンセントを画角に収める視点で、**モードDだけ**ツールバーに出る
 * （テンキーとビューキューブの割当は変えない。決定表#6）。
 */
export type CameraPreset =
  'front' | 'top' | 'socket' | 'back' | 'left' | 'right' | 'bottom' | 'plc';

/**
 * 画面に出す短いお知らせ（配線失敗の理由など）。§8.2
 *
 * 期限は**1件ごと**に持つ。先頭の1件だけにタイマを張ると、後から積まれた1件で
 * そのタイマが張り直され、短時間に何件も出たときに誰も消えなくなる。
 */
export interface Toast {
  id: number;
  text: string;
  // --- Plan 4B Batch C 修正 #3: 保存は続けるが直したほうがよい指摘（設定値が `?` で書き出された等） ---
  tone: 'info' | 'error' | 'warn';
  // --- /Plan 4B Batch C 修正 #3 ---
  /** これを過ぎたら消す時刻（`Date.now()` と同じ基準の[ms]）。 */
  expiresAt: number;
}

/** 操作ログの1行。§8.1 */
export interface LogLine {
  id: number;
  text: string;
}

/** テスターのプローブの側。§9.3 */
export type ProbeSide = 'black' | 'red';

/**
 * 警告バナーに出す危険操作1件。§5.6 / §13
 *
 * トースト（§8.2）とは別に**画面上部の帯**で出す。危険操作は「やってしまったこと」であり、
 * 右下に4秒出て消えるだけでは気づかないまま回数だけが増える（§16 Phase 2 受入基準④は
 * 「警告が出て結果に回数が記録される」ことを求める）。
 */
export interface HazardBanner {
  kind: HazardKind;
  detail: string;
  /** これを過ぎたら自動で畳む時刻（`Date.now()` と同じ基準の[ms]）。 */
  expiresAt: number;
}

/**
 * 3Dで選んだ直後の指摘の対象（種別を選ぶ前）。§9.2
 * `session/interaction.ts` の `ReportTarget` と同じ形だが、ストアの値型は three にも React にも
 * 依存しないこのファイルに置く（`interaction.ts` からはこの型を再エクスポートする）。
 */
export type PendingReport = { wireId: string } | { partId: string } | { terminalId: string };

/** 回路図 ⇄ 3D盤の連動ハイライト。§9.2 / §11.4 */
export interface HighlightSelection {
  /** 光らせる回路図要素のID。 */
  cellIds: readonly string[];
  /** 光らせる盤の端子（役割ID）。 */
  terminals: readonly string[];
  /** 光らせる電線のID。 */
  wireIds: readonly string[];
}

/** 何も光っていない状態。 */
export const NO_HIGHLIGHT: HighlightSelection = { cellIds: [], terminals: [], wireIds: [] };

/**
 * モニタ（`F3`）の通電状況。§10.7 / 決定表#5
 *
 * `PlcSnapshot.poweredCells` の `Record<string, boolean>` をそのまま運ぶと、33ms ごとに
 * 千数百個の真偽値が新しいオブジェクトで届き、セレクタの比較も毎回その数だけ走る。
 * ネットワーク1本＝行を連ねた `'0110…'` の**文字列1本**に畳むと、比較も購読も文字列1本で済む。
 */
export interface PlcMonitorSnapshot {
  scanCount: number;
  tMs: number;
  /** ネットワークID → 「行 × 16列」を連ねた `'0'`/`'1'` の文字列。ENDネットワークは入らない。 */
  powered: Record<string, string>;
  inputs: boolean[];
  outputs: boolean[];
  internals: Record<number, boolean>;
  /**
   * `presetMs` はコンパイル済みラダーのタイマセルから取る（Batch 3 レビュー M4）。
   * ランタイムの `PlcTimerState` 自体は設定値を持たないので、Worker 側で合成する。
   */
  timers: Record<number, { elapsedMs: number; on: boolean; presetMs: number }>;
  counters: Record<number, { value: number; on: boolean }>;
}

/**
 * 出力ウィンドウの1行（`ConvertError` を画面の語彙に直したもの）。
 *
 * `@ojt/plc-dialects` の `ConvertError` / `@ojt/ladder-core` の `CompileError` を**構造的に写した**
 * 型である。`store-types.ts` は「React にも three にも依存しない値型」を置く場所で、`Device` の
 * ようなライブラリの型を持ち込むとストアの値が構造化複製できるかどうかが読めなくなる
 * （Worker と作業ファイルの両方を通る）。写像は Task 6 の `session/ladder-errors.ts` が1箇所で持つ。
 */
export interface ConvertErrorLine {
  source: 'structure' | 'dialect';
  code: string;
  message: string;
  networkId?: string;
  row?: number;
  col?: number;
}

/** 変換警告の1行（二重コイル）。 */
export interface ConvertWarningLine {
  code: string;
  message: string;
  networkId: string;
  row: number;
  col: number;
}

/** 出力ウィンドウに並べるもの。§10.6 */
export interface ConvertIssues {
  errors: ConvertErrorLine[];
  warnings: ConvertWarningLine[];
  /** 変換が通ったときの使用デバイス一覧（`CompiledProgram.usage`）。§10.8 */
  usage: { reads: string[]; writes: string[] } | undefined;
  /**
   * 使われていないデバイス（表示のみ。決定表#15b）。§10.8
   * `Device.kind` がまだ分かる段階（`runConvert`）で判定を済ませ、ここには方言表記の
   * 文字列だけを渡す（レビュー指摘 B2。`OutputWindow` は文字列の表示に専念できる）。
   */
  unused: { neverRead: string[]; neverWritten: string[] } | undefined;
}

/** 空の変換結果（課題を開いた直後・編集した直後）。 */
export const NO_CONVERT_ISSUES: ConvertIssues = {
  errors: [],
  warnings: [],
  usage: undefined,
  unused: undefined,
};
