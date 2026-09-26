import { plcUnitFor } from '@ojt/board-model';
import {
  MAX_DEVICE_COMMENTS,
  MAX_DEVICE_COMMENT_LENGTH,
  isPlcProblem,
  type SupportedProblem,
} from '@ojt/content';
import { COIL_COL, type Device, type LadderProgram } from '@ojt/ladder-core';
import {
  getDialect,
  IMPLEMENTED_DIALECT_IDS,
  isDialectId,
  MAX_GRID_COLS,
  MIN_GRID_COLS,
  type DialectId,
} from '@ojt/plc-dialects';
import type { StateCreator } from 'zustand';
import { DEFAULT_SETTINGS } from '../../shared/ipc.js';
import { JA } from '../i18n/ja.js';
import {
  clampLadderCursor,
  emptyLadderHistory,
  initialLadder,
  pushLadder,
  redoLadder,
  undoLadder,
  type LadderCursor,
  type LadderEditorMode,
  type LadderHistory,
} from '../session/ladder.js';
import { carryOverBoard, carrySummary } from '../session/dialect-carry.js';
import { boardForProblem } from '../session/plc-session.js';
import { plcForVendor, plcUnitForVendor } from '../session/plc-skin.js';
import { NO_CONVERT_ISSUES, type ConvertIssues, type PlcMonitorSnapshot } from './store-types.js';
import type { AppState } from './store.js';

/**
 * モードD（ラダーとPLC）のスライス。設計仕様 §10（指摘 DS-3）。
 * ラダー・デバイスコメント・方言（メーカー）・変換とモニタの状態を持つ。
 */

/** デバイスコメント1件の長さの上限（`@ojt/content` の `MAX_DEVICE_COMMENT_LENGTH` と同じ値）。§10.7 */
export const DEVICE_COMMENT_LIMIT = MAX_DEVICE_COMMENT_LENGTH;

/** デバイスコメントの件数の上限（`@ojt/content` の `MAX_DEVICE_COMMENTS` と同じ値）。§10.7 */
export const DEVICE_COMMENT_COUNT_LIMIT = MAX_DEVICE_COMMENTS;

/** 画面の分割。決定表#10 */
export type LadderViewMode = 'ladder' | 'split' | 'board';

/** モードDの状態の初期値（課題を開く・離れるときに必ずここへ戻す）。 */
export function plcFields(
  problem?: SupportedProblem,
): Pick<
  LadderSlice,
  | 'watchDevices'
  | 'ladder'
  | 'ladderComments'
  | 'ladderHistory'
  | 'ladderCursor'
  | 'ladderMode'
  | 'ladderFocused'
  | 'ladderView'
  | 'insertMode'
  | 'monitorWriteNoticeShown'
  | 'converted'
  | 'convertIssues'
  | 'plcMonitor'
  | 'plcRunning'
> {
  const isPlc = problem !== undefined && isPlcProblem(problem);
  return {
    // モードD以外では `undefined`（3Dだけの画面がラダーを持たない）
    ladder: isPlc ? initialLadder() : undefined,
    ladderComments: {},
    watchDevices: [],
    ladderHistory: emptyLadderHistory(),
    ladderCursor: { networkId: 'n1', row: 0, col: 0 },
    ladderMode: 'write',
    ladderFocused: false,
    ladderView: 'split',
    insertMode: 'overwrite',
    monitorWriteNoticeShown: false,
    converted: false,
    convertIssues: NO_CONVERT_ISSUES,
    plcMonitor: undefined,
    plcRunning: false,
  };
}

/** モードDの状態と操作。 */
export interface LadderSlice {
  watchDevices: readonly Device[];
  setWatchDevices: (devices: readonly Device[]) => void;
  // --- /Plan 5 Task 6 ---

  /** 訓練者のラダー（モードDのみ）。§10.3 */
  ladder: LadderProgram | undefined;
  /** デバイスコメント（キーは `deviceLabel()` の形）。§10.7 */
  ladderComments: Record<string, string>;
  /** ラダー専用の取り消しスタック（盤の `history` とは別。決定表#2） */
  ladderHistory: LadderHistory;
  /** セルカーソル。§10.7 */
  ladderCursor: LadderCursor;
  /** 書込み／読出し／モニタ。§10.6 */
  ladderMode: LadderEditorMode;
  /** ラダーエディタにフォーカスがあるか（キーの宛先を決める。決定表#3） */
  ladderFocused: boolean;
  /** 画面の分割。決定表#10 */
  ladderView: LadderViewMode;
  // --- /Plan 5 Task 7 ---
  /** セル入力が挿入か上書きか（`Ins` で切り替える）。決定表#12b */
  insertMode: 'insert' | 'overwrite';
  /** `Shift+F3`（モニタ書込み）の注記トーストを既に出したか。決定表#11 */
  monitorWriteNoticeShown: boolean;
  /** いま使っている方言（Phase 3 は常に `mitsubishi`）。§10.5 */
  dialectId: DialectId;
  /**
   * 設定画面の既定メーカー。§12.1 / 決定表#24
   * **課題を開くときの初期値**であって、いまのセッションの方言（`dialectId`）ではない。
   * 設定を保存するたびに `dialectId` を上書きすると、作業ファイルから復元した方言や
   * 表記切替で選んだ方言がセッションの途中で戻ってしまう（前提#31b）。
   */
  defaultVendor: DialectId;
  /** ラダーの表示列数（設定画面。§10.6） */
  ladderGridCols: number;
  /** モニタ中の通電色（設定画面。§10.6） */
  monitorColor: string;
  /** 最後の編集のあと「変換」を通したか。§10.6 / 3A H-1 */
  converted: boolean;
  /** 出力ウィンドウの中身。§10.6 */
  convertIssues: ConvertIssues;
  /** モニタ中の通電状況（モニタでないときは undefined）。決定表#5 */
  plcMonitor: PlcMonitorSnapshot | undefined;
  /** PLCが RUN 中か。§10.6 */
  plcRunning: boolean;

  // --- /Plan 5 Task 6 ---
  /** ラダーを差し替える（前の状態を履歴に積み、変換済みフラグを落とす）。§10.6 */
  setLadder: (program: LadderProgram) => void;
  /** ラダーを履歴を積まずに差し替える（作業ファイルからの復元）。§12.3 */
  restoreLadder: (program: LadderProgram, comments?: Record<string, string>) => void;
  /** セルカーソルを動かす。 */
  setLadderCursor: (cursor: LadderCursor) => void;
  /** 書込み／読出し／モニタを切り替える。§10.6 */
  setLadderMode: (mode: LadderEditorMode) => void;
  /** ラダーエディタのフォーカス。決定表#3 */
  setLadderFocused: (focused: boolean) => void;
  /** 画面の分割。決定表#10 */
  setLadderView: (view: LadderViewMode) => void;
  // --- /Plan 5 Task 7 ---
  /** 挿入・上書きを切り替える（`Ins`）。切り替えた**後**の値を返す。決定表#12b */
  toggleInsert: () => 'insert' | 'overwrite';
  /** `Shift+F3` の注記トーストを「出した」と記録する（初回だけ true を返す）。決定表#11 */
  markMonitorWriteNotice: () => boolean;
  /**
   * デバイスコメントを1件入れる（空文字で削除、32文字で切り詰め、200件まで）。§10.7
   * 件数の上限（`DEVICE_COMMENT_COUNT_LIMIT`）に達していて新規のデバイスなら入れずに
   * `false` を返す（呼び出し側がトーストを出す。レビュー指摘 M4）。
   */
  setDeviceComment: (device: string, text: string) => boolean;
  /** 「変換」の結果を入れる。§10.6 */
  setConverted: (converted: boolean, issues: ConvertIssues) => void;
  /** モニタのスナップショット。決定表#5 */
  setPlcMonitor: (monitor: PlcMonitorSnapshot | undefined) => void;
  /** RUN/STOP。§10.6 */
  setPlcRunning: (running: boolean) => void;
  /** 設定画面の値をラダーへ反映する。§12.1 */
  applyLadderSettings: (settings: {
    gridCols: number;
    monitorColor: string;
    vendor: string;
  }) => void;
  /**
   * 方言（メーカー）だけを差し替える。§10.5
   * 作業ファイルの復元専用（`applyLadderSettings()` と違い、グリッド幅やモニタ色には触れない）。
   * 実装済みかどうかの確認は呼び出し側（`work-file.ts`）が済ませてから呼ぶ。Batch 4+5 レビュー I5
   */
  setDialect: (dialectId: DialectId) => void;
  // --- Plan 4B Task 8 ---
  /**
   * 表記（メーカー）を切り替える。§10.7 / 決定表#12
   * 方言と課題の機種を差し替え、盤と履歴を作り直す。**ラダーとデバイスコメントと取り消し
   * スタックは持ち越す**（IRは書き換えないので、戻せる手もそのまま生きる。4A H-2 / 決定表#11）。
   * 機種が変わると端子名が変わるので、配線だけは残せない（盤に無い端子を指す電線ができる）。
   */
  switchDialect: (dialectId: DialectId) => void;
  // --- /Plan 4B Task 8 ---
  /** ラダーを1手戻す（戻せたら true）。決定表#2 */
  undoLadderEdit: () => boolean;
  /** ラダーを1手やり直す（やり直せたら true）。決定表#2 */
  redoLadderEdit: () => boolean;
}

/** モードDのスライス。 */
export const createLadderSlice: StateCreator<AppState, [], [], LadderSlice> = (set, get) => ({
  ...plcFields(),
  dialectId: 'mitsubishi',
  defaultVendor: DEFAULT_SETTINGS.defaultVendor,
  ladderGridCols: DEFAULT_SETTINGS.ladderGridCols,
  monitorColor: DEFAULT_SETTINGS.monitorColor,

  // --- /Plan 5 Task 6 ---
  setLadder: (program) => {
    const current = get().ladder;
    set({
      ladder: program,
      // 編集したら変換済みではなくなる（H-1: 判定は変換を通ったものだけ）
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
      ...(current === undefined ? {} : { ladderHistory: pushLadder(get().ladderHistory, current) }),
    });
  },
  setWatchDevices: (devices) => set({ watchDevices: devices }),
  restoreLadder: (program, comments) => {
    set({
      ladder: program,
      ladderHistory: emptyLadderHistory(),
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
      ...(comments === undefined ? {} : { ladderComments: { ...comments } }),
    });
  },
  setLadderCursor: (ladderCursor) => {
    set({ ladderCursor });
  },
  setLadderMode: (ladderMode) => {
    set({ ladderMode });
  },
  setLadderFocused: (ladderFocused) => {
    set({ ladderFocused });
  },
  setLadderView: (ladderView) => {
    set({ ladderView });
  },
  // --- /Plan 5 Task 7 ---
  toggleInsert: () => {
    const insertMode = get().insertMode === 'insert' ? 'overwrite' : 'insert';
    set({ insertMode });
    return insertMode;
  },
  markMonitorWriteNotice: () => {
    // 初回だけ true（`Shift+F3` のトーストを1回しか出さない。決定表#11）
    if (get().monitorWriteNoticeShown) return false;
    set({ monitorWriteNoticeShown: true });
    return true;
  },
  setDeviceComment: (device, text) => {
    const comments = { ...get().ladderComments };
    // 空白だけの入力を消去とみなすかどうかは `trim()` で判定するが、保存する文字列そのものは
    // 打鍵どおり（先頭・末尾の空白も含む）に残す。そうしないと「運転 押ボタン」のような
    // デバイス名に含まれる空白が入力のたびに消えてしまう（Batch 3 レビュー I2）
    if (text.trim().length === 0) {
      delete comments[device];
      set({ ladderComments: comments });
      return true;
    }
    if (
      !Object.hasOwn(comments, device) &&
      Object.keys(comments).length >= DEVICE_COMMENT_COUNT_LIMIT
    ) {
      return false;
    }
    comments[device] = text.slice(0, DEVICE_COMMENT_LIMIT);
    set({ ladderComments: comments });
    return true;
  },
  setConverted: (converted, convertIssues) => {
    set({ converted, convertIssues });
  },
  setPlcMonitor: (plcMonitor) => {
    set({ plcMonitor });
  },
  setPlcRunning: (plcRunning) => {
    set({ plcRunning });
  },
  applyLadderSettings: ({ gridCols, monitorColor, vendor }) => {
    // 0 は「スキンの既定列数」の印なのでそのまま持つ（丸めない。決定表#8）
    const clampedGridCols =
      gridCols === 0 ? 0 : Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Math.round(gridCols)));
    /*
     * 表示列数が縮んで、カーソルがいま見えない接点列を指していたら、見える最後の接点列へ詰める
     * （レビュー指摘 #7）。**この詰めは残す**（4B レビュー I3）——落とすと 15列から8列へ狭めた
     * 直後にカーソルが画面外を指し、`Enter` が見えないセルを編集する。
     * `0`（＝メーカーの既定に従う）のときは、いまの方言の既定列数で詰める。
     */
    const visibleCols =
      clampedGridCols === 0 ? getDialect(get().dialectId).gridCols : clampedGridCols;
    const cursor = get().ladderCursor;
    // コイル列（`COIL_COL`）はどの表示列数でも必ず見えているので動かさない
    const clampedCursor =
      cursor.col === COIL_COL || cursor.col < visibleCols
        ? cursor
        : { ...cursor, col: visibleCols - 1 };
    set({
      ladderGridCols: clampedGridCols,
      monitorColor,
      ladderCursor: clampedCursor,
      // **`dialectId` には触らない**（決定表#24）。効くのは次に課題を開くときである
      ...(isDialectId(vendor) && IMPLEMENTED_DIALECT_IDS.includes(vendor)
        ? { defaultVendor: vendor }
        : {}),
    });
  },
  setDialect: (dialectId) => {
    set({ dialectId });
  },
  // --- Plan 4B Task 8 ---
  switchDialect: (dialectId) => {
    const { problem, ladder, ladderComments, ladderHistory } = get();
    // 課題を開いていないとき（ホームや設定）は方言を入れ替えるだけでよい
    if (problem === undefined || !isPlcProblem(problem)) {
      set({ dialectId });
      return;
    }
    const swapped = plcForVendor(problem, dialectId);
    if (swapped === undefined) {
      /*
       * 割付がその機種に収まらない（CP1E の出力は12点。決定表#10）。**方言も変えない**——
       * ラダーだけ別メーカーの表記にすると、机上のPLC本体の端子名と食い違う（4A H-1）。
       * 画面（`NotationDialog`）は押す前にこの理由を出して押させないので、ここは念のための砦。
       */
      const model = plcUnitForVendor(dialectId)?.model ?? dialectId;
      const wanted = plcUnitFor(model)?.displayName ?? model;
      const used = plcUnitFor(problem.plc.model)?.displayName ?? problem.plc.model;
      get().toast(JA.plc.modelNotUsable(wanted, used), 'error');
      return;
    }
    /*
     * `openProblem()` が方言 → 機種 → 盤・履歴・ログ・計時を作り直す。**`vendor` を必ず渡す**
     * （渡さないと `defaultVendor` に戻され、切り替えたはずの方言が元へ戻る。決定表#24）。
     * ラダー・デバイスコメント・取り消しスタックを持ち越す（決定表#11・#12）。
     *
     * 盤の作業も持ち越す（2026-09-26 利用者報告「3D図の画面の時に各メーカーのシーケンサーを
     * 切り替えることができない」への対応で、3D画面からも切り替えられるようにした）。PLC本体と
     * 壁コンセントの端子は機種で名前が変わるので、そこへつながる電線だけ外し、盤の中の電線と
     * 装着した部品は新しい機種の盤へ載せ直す（`carryOverBoard()`）。
     */
    const previousSession = get().session;
    const summary = previousSession === undefined ? undefined : carrySummary(previousSession);
    if (!get().openProblem(swapped, { vendor: dialectId })) return;
    const fresh = get().session;
    const session =
      previousSession === undefined || fresh === undefined
        ? fresh
        : carryOverBoard(previousSession, fresh, boardForProblem(swapped));
    set({
      ...(session === undefined ? {} : { session }),
      ladder,
      ladderComments,
      ladderHistory,
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
      /*
       * `openProblem()` は `problem.id` が変わらないので `sessionEpoch` を進めない。
       * ここで進めないと、`[problemId, sessionEpoch]` で張り直す Session の Worker が
       * 表記切替後も旧機種のネットリストのまま動き続ける（レビュー指摘 DS-1）。
       */
      sessionEpoch: get().sessionEpoch + 1,
    });
    get().toast(
      summary === undefined
        ? JA.plc.notationSwitched(getDialect(dialectId).displayName)
        : JA.plc.vendorSwitched(getDialect(dialectId).displayName, summary),
    );
  },
  // --- /Plan 4B Task 8 ---
  undoLadderEdit: () => {
    const { ladder, ladderHistory, ladderCursor } = get();
    if (ladder === undefined) return false;
    const step = undoLadder(ladderHistory, ladder);
    if (step === undefined) return false;
    set({
      ladder: step.program,
      ladderHistory: step.history,
      // 指摘 LE-2: 復元後のプログラムに合わせてカーソルを丸める（さもないと次の `Enter` で例外）
      ladderCursor: clampLadderCursor(step.program, ladderCursor),
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
    });
    return true;
  },
  redoLadderEdit: () => {
    const { ladder, ladderHistory, ladderCursor } = get();
    if (ladder === undefined) return false;
    const step = redoLadder(ladderHistory, ladder);
    if (step === undefined) return false;
    set({
      ladder: step.program,
      ladderHistory: step.history,
      // 指摘 LE-2: 同上（やり直しでも行数・ネットワーク数が変わりうる）
      ladderCursor: clampLadderCursor(step.program, ladderCursor),
      converted: false,
      convertIssues: NO_CONVERT_ISSUES,
    });
    return true;
  },
});
