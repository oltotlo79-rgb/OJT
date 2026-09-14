import type { RoutingErrorReason } from '@ojt/board-model';
import type { HazardKind, MismatchReason } from '@ojt/circuit-sim';

/**
 * 日本語文言。設計仕様 §15「全文言を1箇所に集約しハードコードしない」。
 * 画面側は必ずこのモジュール経由で文字列を取る。文言の変更はこのファイルだけで完結する。
 *
 * エンジンの種別（`HazardKind` / `MismatchReason` / `RoutingErrorReason`）で索引する表は
 * `satisfies` で網羅を検査する。
 * エンジンに種別が増えたときに、画面で `undefined` が出るのではなく `tsc` が落ちる。
 */

/** アプリ名称（仮称。§17.2 #18）。 */
export const APP_NAME = 'OJT電気保全トレーナー';

/** 画面文言。 */
export const JA = {
  app: {
    name: APP_NAME,
    subtitle: '機械保全技能検定 電気系保全作業の練習',
  },
  home: {
    title: 'モードを選ぶ',
    assemble: '回路組立',
    assembleDesc: '有接点回路を盤上で配線して組み立てる（モードB）',
    inspectParts: '部品点検',
    inspectRepair: '回路点検・修復',
    plc: 'PLC',
    comingSoon: '準備中',
    settings: '設定',
  },
  problemList: {
    title: '課題一覧',
    back: 'ホームへ戻る',
    grade: '級',
    standard: '標準',
    cutoff: '打切',
    minutes: '分',
    open: '開く',
    builtin: '内蔵',
    user: '利用者',
    errorsTitle: '読み込めなかった課題',
    userDirMissing: '利用者課題フォルダが見つかりません。内蔵課題のみで動作します。',
    empty: '課題がありません。',
    loading: '読み込み中…',
    columnId: 'ID',
    columnTitle: '課題名',
    /** 出所（内蔵／利用者）の列見出し。§7.8 */
    columnSource: '出所',
    loadFailed: '課題を読み込めませんでした',
    listFailed: '課題一覧を読み込めませんでした',
  },
  session: {
    back: '課題一覧へ戻る',
    judge: '判定',
    /** 判定を Worker へ送って結果を待っているあいだのボタン文言。§8.2 */
    judging: '判定中…',
    undo: '元に戻す',
    redo: 'やり直し',
    deleteMode: '削除モード',
    wireColor: '線色',
    viewFront: '正面',
    viewTop: '俯瞰',
    viewSocket: 'ソケット拡大',
    breaker: 'ブレーカ',
    switch: '電源スイッチ',
    resetTrip: '保護復帰（SW切→CB切→CB入→SW入）',
    tripped: '過電流保護が動作しました。復帰手順を実行してください。',
    parts: '部品',
    remaining: '残り',
    mount: '装着',
    unmount: '取り外す',
    timerPreset: 'タイマ設定',
    elapsed: '経過時間',
    log: '操作ログ',
    warnings: '警告',
    problem: '課題',
    chart: 'タイムチャート（仕様）',
    pickSocket: 'ソケットを選んでください',
    cancelWire: '配線を取り消しました',
    /** 経路器が経路を作れなかった（`RoutingError`）。盤とセッションはそのまま保つ。§6.6 */
    routeFailed: '配線の経路を作れませんでした',
    /** 同じ帯の同じスロットに載せざるを得なかった電線がある（`laneOverflow`）。§6.6 */
    laneOverflow:
      '他の電線と同じ配線位置に重なっています（見た目だけの重なりで、回路は正しく組めています）',
    schematicHint: '回路図ヒント',
    save: '作業を保存',
    load: '作業を読込',
    restoreTitle: '前回の作業を復元しますか？',
    restoreYes: '復元する',
    restoreNo: '復元しない',
    showSchematic: '回路図を表示',
    hideSchematic: '回路図を隠す',
    /** 課題が選ばれていないままセッション画面が開かれたとき。§12.1 */
    noProblem: '課題が選ばれていません。',
    powered: '通電中',
    unpowered: '無通電',
    wires: '電線',
    wiresUnit: '本',
    noTerminal: '端子未選択',
    firstTerminal: '1本目',
    selection: '選択',
    select: '選択',
    /** 模範回路（仕様チャート・判定）を作れなかった。§7.7 / §8.3 */
    referenceError: '模範回路エラー',
    liveChart: 'ライブ記録',
    /** 操作が失敗したときのログ接頭辞。§8.2 */
    failed: '失敗',
    on: 'ON',
    off: 'OFF',
    resetTripLog: '保護復帰の手順を実行',
    relay: 'リレー',
    timer: 'タイマ',
    seconds: '秒',
    slider: 'スライダ',
    numberInput: '数値',
  },
  result: {
    title: '判定結果',
    passed: '合格',
    failed: '不合格',
    mismatches: '差分一覧',
    noMismatch: '動作は模範回路と一致しました。',
    time: '時刻',
    signal: '信号',
    expected: '期待',
    actual: '実際',
    reason: '理由',
    staticChecks: '静的チェック',
    hazards: '危険操作',
    hazardNone: '危険操作はありませんでした。',
    elapsed: '所要時間',
    standardMark: '標準時間',
    cutoffMark: '打切り時間',
    chartOverlay: 'チャート重ね表示（薄色＝模範／濃色＝訓練者）',
    retry: 'もう一度',
    toList: '課題一覧へ',
    /** 判定結果が無いのに結果画面が開かれたとき。§12.1 */
    noResult: '判定結果がありません。',
    ok: 'OK',
    ng: 'エラー',
    times: '回',
    within: '以内',
    exceeded: '超過',
    forbidden:
      'タイマの接点で自分のコイルを切る回路は実機では動作が不安定になります（リレーを介してください）。',
  },
  hazard: {
    'ohm-on-live': '通電中のΩ／導通測定',
    'range-exceeded': 'レンジ超過',
    'short-circuit-power-on': '短絡状態での通電（電源保護動作）',
    'power-sequence-violation': '電源操作の手順違反',
    'over-wires-per-terminal': '1端子に3本目を接続',
    overcurrent: '運転中の過電流（電源保護動作）',
  } satisfies Record<HazardKind, string>,
  staticCheck: {
    wireColorRule: '線色ルール',
    terminalLimit: '1端子の本数',
    unusedParts: '未使用部品',
    forbiddenCircuit: '禁則回路',
    coilPolarity: 'コイル極性',
    powerSequence: '電源操作手順',
  },
  mismatchReason: {
    timing: '時刻ずれ',
    value: '値違い',
    missing: '遷移が無い',
    extra: '余分な遷移',
    'unknown-signal': '比較対象の信号が模範回路に無い',
  } satisfies Record<MismatchReason, string>,
  /** 経路器の失敗理由（`RoutingError.reason`）。§6.6 */
  routeReason: {
    'invalid-terminal': '盤に無い端子です',
    unreachable: '配線帯までたどり着けません',
    'footprint-crossing': '部品の上を避けて通せません',
  } satisfies Record<RoutingErrorReason, string>,
  error: {
    banner: '予期しないエラーが発生しました',
    reset: 'セッションをリセット',
    webglLost: '描画を復旧しています…',
    workerError: 'シミュレーションでエラーが発生しました',
    /** preload が読み込まれていない（`window.ojt` が無い）。§4.3 */
    preloadMissing: 'プリロードが読み込まれていません',
    /** renderer のマウント先が無い（index.html の破損）。 */
    rootMissing: '#root が見つかりません',
  },
} as const;

/** 級の表示（`3級` など）。 */
export function gradeLabel(grade: number): string {
  return `${grade}${JA.problemList.grade}`;
}

/** 分の表示（`30分`）。 */
export function minutesLabel(minutes: number): string {
  return `${minutes}${JA.problemList.minutes}`;
}

/** 真偽値の信号表示（`ON` / `OFF`）。 */
export function signalLabel(value: unknown): string {
  if (typeof value === 'boolean') return value ? JA.session.on : JA.session.off;
  if (typeof value === 'number') return value.toFixed(2);
  return '—';
}

/** 入切の表示（`ON` / `OFF`）。§8.2 */
export function onOffLabel(on: boolean): string {
  return on ? JA.session.on : JA.session.off;
}

/** 課題を開いたときの操作ログ。§8.1 */
export function openedProblemLog(title: string): string {
  return `課題「${title}」を開きました`;
}

/** 操作が失敗したときの操作ログ。§8.2 */
export function failedLog(message: string): string {
  return `${JA.session.failed}: ${message}`;
}

/** 電源操作の操作ログ（`ブレーカ ON`）。§8.2 */
export function powerLog(label: string, on: boolean): string {
  return `${label} ${onOffLabel(on)}`;
}

/** 元に戻す／やり直しの操作ログ（`元に戻す: 配線 …`）。§8.2 */
export function historyLog(verb: string, label: string): string {
  return `${verb}: ${label}`;
}

/** 模範回路を作れなかったときの表示（理由付き）。§7.7 / §8.3 */
export function referenceErrorText(reasons: readonly string[]): string {
  return `${JA.session.referenceError}: ${reasons.join(' / ')}`;
}

/** 経路を作れなかった電線の操作ログ。§6.6 */
export function routeFailedLog(wireId: string, reason: string): string {
  return `${JA.session.routeFailed}: ${wireId} — ${reason}`;
}

/** 部品パネルで選択中のソケットの表示（`S1（CR1）を選択中`）。§8.2 */
export function socketSelectedLabel(socketId: string, role: string | undefined): string {
  return role === undefined
    ? `${socketId} ${JA.session.selection}中`
    : `${socketId}（${role}）を${JA.session.selection}中`;
}

/** 装着済み部品の表示（`CR1: リレー`）。§8.2 */
export function mountedPartLabel(role: string | undefined, isTimer: boolean): string {
  return `${role ?? ''}: ${isTimer ? JA.session.timer : JA.session.relay}`;
}

/** タイマ設定ダイヤルの見出し（`T1 タイマ設定`）。§8.2 */
export function timerDialLabel(role: string | undefined): string {
  return `${role ?? ''} ${JA.session.timerPreset}`;
}

/** 所要時間と標準・打切り時間の対比文。§8.3 */
export function elapsedSummaryText(
  elapsedMs: number,
  standardMin: number,
  cutoffMin: number,
): string {
  const standardMs = standardMin * 60_000;
  const cutoffMs = cutoffMin * 60_000;
  if (elapsedMs > cutoffMs) {
    return `${JA.result.cutoffMark}（${minutesLabel(cutoffMin)}）を${JA.result.exceeded}`;
  }
  if (elapsedMs > standardMs) {
    return `${JA.result.standardMark}（${minutesLabel(standardMin)}）を${JA.result.exceeded}`;
  }
  return `${JA.result.standardMark}（${minutesLabel(standardMin)}）${JA.result.within}`;
}

/** ウィンドウが隠れていた間に捨てた tick の操作ログ。§5.2 */
export function droppedTicksLog(ticks: number): string {
  return `ウィンドウが隠れていた間の ${ticks} tick を省略しました`;
}
