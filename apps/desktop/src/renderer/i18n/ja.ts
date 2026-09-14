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
  },
  session: {
    back: '課題一覧へ戻る',
    judge: '判定',
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
  },
} as const;

/** 級の表示（`3級` など）。 */
export function gradeLabel(grade: number): string {
  return `${grade}${JA.problemList.grade}`;
}

/** 真偽値の信号表示（`ON` / `OFF`）。 */
export function signalLabel(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  if (typeof value === 'number') return value.toFixed(2);
  return '—';
}
