import type { RoutingErrorReason } from '@ojt/board-model';
import type { HazardKind, MismatchReason } from '@ojt/circuit-sim';
import type { FaultReportKind, StaticCheckId } from '@ojt/content';
import { MSG } from '../../shared/messages.js';
import type { ProbeSide } from '../app/store-types.js';

/**
 * 日本語文言。設計仕様 §15「全文言を1箇所に集約しハードコードしない」。
 * 画面側は必ずこのモジュール経由で文字列を取る。文言の変更はこのファイルだけで完結する。
 *
 * エンジンの種別（`HazardKind` / `MismatchReason` / `RoutingErrorReason`）で索引する表は
 * `satisfies` で網羅を検査する。
 * エンジンに種別が増えたときに、画面で `undefined` が出るのではなく `tsc` が落ちる。
 *
 * main プロセスが返す文言だけは `src/shared/messages.ts` に置く（main は three / React 由来の
 * 型を引くこのファイルを読み込めないため）。ここから `JA.main` として再輸出して、
 * 画面側から見た入口はこのファイル1つに保つ。
 */

/** アプリ名称（仮称。§17.2 #18）。 */
export const APP_NAME = '電気教育ツール';

export { MSG, readFailedText, saveFailedText } from '../../shared/messages.js';

/** 画面文言。 */
export const JA = {
  /** main プロセスが返す文言（実体は `src/shared/messages.ts`）。§15 */
  main: MSG,
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
    /** モードC1のモードカードの説明。§9.1 */
    inspectPartsDesc: '不良のリレー・タイマをチェック用ソケットで点検する（モードC1）',
    /** モードC2のモードカードの説明。§9.2 */
    inspectRepairDesc: '故障が入った盤を点検し、白線で修復する（モードC2）',
    plc: 'PLC',
    comingSoon: '準備中',
    // --- Plan 3B Task 15 ---
    /** モードDのモードカードの説明。§10 */
    plcDesc: 'PLCでラダーを組み、盤と配線して動かす（モードD）',
    // --- /Plan 3B Task 15 ---
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
    /** モード絞り込みに一致する課題が無いとき（フォルダは空ではない）。Plan 2B レビュー M4 */
    filterEmpty: '絞り込みに一致する課題がありません。',
    /** 絞り込みの「すべて」。§12.1 */
    allModes: 'すべて',
    loading: '読み込み中…',
    columnId: 'ID',
    columnTitle: '課題名',
    /** 出所（内蔵／利用者）の列見出し。§7.8 */
    columnSource: '出所',
    loadFailed: '課題を読み込めませんでした',
    listFailed: '課題一覧を読み込めませんでした',
  },
  /** 設定画面。§12.1 / §15 */
  settings: {
    userContentDir: '利用者課題フォルダ',
    soundEnabled: '効果音',
    soundVolume: '音量',
    restorePrompt: '起動時に前回の作業の復元を確認する',
    about: 'このアプリについて',
    saved: '設定を保存しました',
    loadFailed: '設定を読み込めませんでした',
    /**
     * 利用者課題フォルダの説明。§7.8 / §15
     * 配布版の同梱課題は asar の外の `resources/content/assemble/` から読むので、そこが
     * 「書き換えの雛形」であると同時に「同梱課題そのもの」でもあることを明示する。
     */
    userContentHelp:
      '利用者課題フォルダに置いた課題JSONは同梱課題と合流し、同じIDなら利用者側が優先されます。' +
      'インストール先の resources/content/assemble/ が同梱課題の実体なので、' +
      'そこからコピーして書き換えると雛形として使えます（消してもアプリ内蔵の課題で起動します）。',
    /** 商標注記。§15 */
    trademarkNotice:
      'MELSEC / MELSEC iQ-F / MELSOFT / GX Works3 は三菱電機株式会社、SYSMAC / CP1E / CP1L / ' +
      'CX-Programmer / CX-One はオムロン株式会社、TOYOPUC / PCwin は株式会社ジェイテクト、' +
      'JW / JW300 / JW-300SP はシャープ株式会社の商標または登録商標です。' +
      '各社の製品名は識別を目的としてのみ使用しており、提携・後援関係を示すものではありません。',
    /** 未確認事項の注記。§17.1 */
    assumptionNotice: '一部の命令名・キー割当は実機マニュアル未確認のため本アプリの表記です。',
    // --- Plan 3B Task 16 ---
    /** PLC（ラダー）設定のグループ見出し。§12.1 */
    plcGroup: 'PLC（ラダー）',
    /** 既定メーカーの選択欄。§10.5 / 決定表#13 */
    vendor: '既定メーカー',
    vendorHelp: 'モードDの課題を開いたときに使う機種（メーカー）の初期値です。',
    /** 実装が無いメーカーに添える注記。決定表#13 */
    vendorUnimplemented: 'Phase 4 で対応します',
    /** ラダーの表示列数。§10.6 */
    gridCols: 'ラダーの表示列数',
    gridColsHelp: 'ラダー編集画面の接点列の数。GX Works3 の既定は 11 です。',
    /** 通電色。§10.6 */
    monitorColor: '通電色',
    monitorColorHelp: 'モニタ（F3）で通電しているセルに塗る色です。',
    /** グループを既定値へ戻す。 */
    resetPlcGroup: '既定に戻す',
    // --- /Plan 3B Task 16 ---
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
    /**
     * 3Dビューポートに常時出す操作ヒント（Blender 風の割り当て）。§12.2
     * 2026-09-14 の利用者要望「3D図の回転や拡大などは blender の操作感を目指し、
     * キューブをドラッグすることで画面を回せるように」に合わせた一覧。
     */
    viewHint:
      '左／中ドラッグ＝回転　Shift＋中／右ドラッグ＝平行移動　Ctrl＋中／ホイール＝ズーム　キューブをドラッグ＝回転　テンキー1/3/7＝正面/右/上（Ctrl で反対側）　Home＝全体',
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
    /** 警告バナーを畳む。§5.6 */
    warnDismiss: '閉じる',
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
    /** 手動保存が成功したときの接頭辞（`保存しました: C:\...`）。§12.3 */
    saved: '保存しました',
    restoreTitle: '前回の作業を復元しますか？',
    restoreYes: '復元する',
    restoreNo: '復元しない',
    /** 別の課題の作業ファイルを読むと、いまの作業が失われることの確認。§12.3 */
    discardTitle: 'いまの作業を破棄して別の課題の作業ファイルを開きますか？',
    discardYes: '続行',
    discardNo: '取消',
    /** 作業ファイルの盤の状態が読めなかった（要素まで検査して断った）。§13 #8 */
    badSession: '作業ファイルの盤の状態が読めません',
    /**
     * 作業ファイルのモード固有の中身（モード・故障・交換）がこの課題と合わない。§12.3 / §13 #8
     * 黙って壊れた状態で開かず、最初から開き直してもらう。
     */
    badWorkFileMode: '作業ファイルの内容がこの課題と合いません',
    /**
     * 保存されたテスターのつまみが壊れていて読めなかった（既定のまま開く）。Plan 2B レビュー M5
     * 読込そのものは断らない（§13 #8）が、黙って戻さないと訓練者がテスターの状態を誤解する。
     */
    badTesterBlock: '保存されたテスターの状態が読めなかったため、既定のまま開きました',
    /** 作業ファイルを読み込めたときの操作ログ。§12.3 */
    restoredLog: '作業ファイルを読み込みました',
    /** 復元した危険操作の回数（今回の分とは別に数える）。§5.6 / §8.3 */
    restoredHazards: '復元前の危険操作',
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
  /** テスターUI。§9.3 */
  tester: {
    title: 'テスター',
    kindDigital: 'デジタル',
    kindAnalog: 'アナログ',
    /** 種別切替の行のグループ名（a11y）。 */
    kindGroup: 'テスターの種類',
    modeOff: 'OFF',
    modeDcv: 'DCV',
    modeAcv: 'ACV',
    modeOhm: 'Ω',
    modeCont: '導通',
    /** つまみ（モード）の行のグループ名（a11y）。 */
    modeGroup: '測定モード',
    range: 'レンジ',
    /** レンジ行のグループ名（a11y）。 */
    rangeGroup: 'レンジ',
    /** デジタルはレンジつまみを持たない（§9.3）。 */
    autoRange: 'オートレンジ',
    zeroAdjust: '0Ω ADJ',
    /** 0Ω調整が済んでいるか。§9.3 */
    zeroDone: '調整済',
    zeroTodo: '未調整（+5%）',
    probeBlack: '黒プローブ',
    probeRed: '赤プローブ',
    probeNone: '未配置',
    /** プローブを外す。 */
    lift: '外す',
    /** 次に置くプローブ。§9.3 */
    next: '次に置く',
    /** 3D盤の端子をクリックして置くことの案内。§9.3 */
    placeHint: '3D盤の端子をクリックするとプローブを置きます（黒 → 赤 の順）',
    /** 通電中にΩ／導通を当てたので測れない。§5.6 #1 */
    liveNote: '通電中はΩ／導通を測れません（無通電にしてから測ります）',
    /** 振り切れ。§5.6 #2 */
    overRangeNote: 'レンジを超えています（上のレンジへ切り替えます）',
    /** 導通ブザーが鳴っている。§5.5。表示器の読値が既に「導通」を出すので、ここは重複しない文言にする */
    buzzing: 'ブザー鳴動中',
    /** アナログ計器の読み上げ名。§15 */
    meterLabel: 'アナログテスターの目盛',
    /** テスターモードのツールバー表示。§8.1 */
    toolMode: 'テスター',
  },
  /** モードC1（部品点検）。§9.1 */
  inspectParts: {
    tray: '部品トレイ',
    plug: 'チェック用ソケットに挿す',
    eject: '外す',
    /** いま挿している部品。 */
    mounted: '点検中',
    markSheet: 'マークシート（不良原因を選ぶ）',
    part: '部品',
    cause: '不良原因',
    answered: '解答済み',
    /** 判定表ヘルプの見出し。§9.1 */
    help: '判定表（切り分けの手順）',
    situation: 'チェック状況',
    /** 判定表の補足（レアショートは動作では見分けられない）。§9.1 補足 */
    layerShortNote:
      'レアショートのコイルは通常どおり励磁・復帰し、接点も正常に開閉します。動作を見るだけでは' +
      '正常品と区別できないため、正常に見えた部品も必ずコイル抵抗を測ります。' +
      '判定のしきい値は正常値 650Ω の85%（＝552.5Ω）で、これ以下をレアショートとします。',
    /** 測定手順の要約（パネル上部に出す）。§9.1 切り分け手順 */
    steps:
      '⓪ブレーカと電源スイッチを入れる ①赤PB（PB4）を押して吸引するか見る ' +
      '②励磁ON/OFFで a接点・b接点の導通を測る ' +
      '③正常に見えてもコイル抵抗（CHK.13–CHK.14）を必ず測る',
    /** プローブの置き場所ショートカットの見出し。§9.1 */
    probeShortcut: 'プローブを当てる',
    coil: 'コイル',
    /** 赤PBを押したままΩを当てると危険操作になる、の注意。§9.1 測定1 */
    ohmSafeNote: '赤PB（PB4）を離していれば、通電したままでもコイル抵抗を安全に測れます',
  },
  /** モードC2（回路点検・修復）。§9.2 */
  inspectRepair: {
    reports: '指摘一覧',
    reportCount: '指摘',
    /** 指摘の登録を促す案内。§9.2 */
    pickHint: '3D盤の電線・端子・部品をクリックして故障の種別を選びます',
    /** 接点の不良の見分け方のヒント（2026-09-18 利用者の決定）。§9.2 */
    contactDiagnosisHint: '接点の不良は通電した状態でボタンを操作しながら電圧を測ると判別できます',
    /** 回路図ヒントを開いた回数（結果画面。§8.4）。 */
    schematicOpenCount: '回路図を開いた回数',
    /** 種別ポップオーバーの見出し。 */
    chooseKind: '故障の種別を選ぶ',
    cancel: '取消',
    remove: '取消',
    repair: '修復',
    addedWires: '追加した白線',
    removedWires: '外した青線',
    /** 部品交換。§9.2 */
    replace: '交換',
    replaced: '交換しました',
    parts: '装着部品',
    none: 'なし',
    /** ツールバーのモード。§8.1 */
    toolMode: '指摘',
    /** 指摘が重複したとき。 */
    duplicate: '同じ指摘が既に登録されています',
    /** 結果画面の見出し。§9.2 判定① */
    matched: '言い当てた故障',
    missed: '見逃し',
    extra: '過剰指摘',
    modifications: '改造（故障箇所でない青線の削除）',
    noModification: '改造はありません。',
    terminal: '端子',
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
    /** 危険操作の回数を訓練者向けに言い換えたもの（合否には影響しない。§17.2 #3）。 */
    mistakes: 'ミス',
    /** モードC1の正解数（§9.1 判定の「n/m 正解」）。 */
    correct: '正解',
    /** 訓練者の解答。§9.1 */
    yourAnswer: 'あなたの解答',
    /** 本当の状態。§9.1 */
    truth: '正解',
    /** マークシートの採点表の見出し。§9.1 */
    markSheet: 'マークシート採点',
    /** 未解答。 */
    unanswered: '—',
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
  /** タイムチャートの拡大表示と縦の補助線（Task CHART-UX）。§7.7 / §8.1 / §8.3 */
  timeChart: {
    enlarge: '拡大',
    /** 拡大できることの案内（チャート本体の読み上げ名に添える）。 */
    openHint: 'クリックまたはEnterで拡大表示',
    close: '閉じる',
    /** 拡大表示で積み上げる2段の見出し。 */
    expected: '期待（模範）',
    actual: '実際（訓練者）',
  },
  // --- Plan 3B Task 4 ---
  /** ラダーエディタ（GX Works3風スキン）。§10.6 / §10.7 */
  ladder: {
    title: 'ラダーエディタ',
    network: '回路ブロック',
    /** 表示列数を超えた位置にセルがある。§10.6 */
    hiddenCells: '表示列数の外にセルがあります（設定でラダーの表示列数を増やしてください）',
    // --- Plan 3B Task 5 ---
    inputTitle: 'デバイスの入力',
    contactKind: '接点の種別',
    outputKind: '出力の種別',
    contactNo: 'a接点',
    contactNc: 'b接点',
    contactRise: '立上り',
    contactFall: '立下り',
    coilOut: 'コイル（OUT）',
    coilSet: 'セット（SET）',
    coilRst: 'リセット（RST）',
    timer: 'タイマ（TON）',
    counter: 'カウンタ（CTU）',
    mc: 'マスタコントロール（MC）',
    mcr: 'マスタコントロール解除（MCR）',
    device: 'デバイス',
    preset: '設定値',
    resetDevice: 'リセットデバイス',
    commit: '確定',
    roundYes: 'はい',
    roundNo: 'いいえ',
    /** 読出し・モニタ中に編集しようとした。§10.6 */
    readOnly: '書込みモード（F2）に切り替えると編集できます',
    /** 挿入・上書きの切換（`Ins`）。決定表#12b */
    insertOn: '挿入モードです（入力すると右のセルがずれます）',
    insertOff: '上書きモードです',
    /** `Shift+F3`（モニタ書込み）の注記。セッションで1回だけ出す。決定表#11 */
    monitorWriteSame: 'Phase 3 ではモニタと同じ動作です',
    // 右側のキー割当欄（`ShortcutHelp`）は常に表示されている。ツールバーに専用ボタンは無い（M7）
    helpHint: 'キー割当は右側のキー割当欄に常に表示されています',
    nothingToUndo: 'これ以上は元に戻せません',
    nothingToRedo: 'これ以上はやり直せません',
    // --- /Plan 3B Task 5 ---
    // --- Plan 3B Task 6 ---
    /** 出力ウィンドウ（変換の結果）。§10.6 */
    output: '出力ウィンドウ',
    structureError: '構造エラー',
    dialectError: '機種エラー',
    doubleCoil: '二重コイル',
    noIssues: '指摘はありません。',
    convertOk: '変換に成功しました',
    notConverted: '未変換（F4 で変換します）',
    usageReads: '読み出しているデバイス',
    usageWrites: '書き込んでいるデバイス',
    usageUnused: '使われていないデバイス（表示のみ・合否には影響しません）',
    // --- /Plan 3B Task 6 ---
    // --- Plan 3B Task 7 ---
    comments: 'デバイスコメント',
    comment: 'コメント',
    noDevices: 'まだデバイスを置いていません。',
    ioTable: 'I/O割付',
    ioDevice: 'デバイス',
    /** PLC本体の端子名（機種の8進表記）。決定表#16 */
    ioTerminal: 'PLC端子',
    ioTarget: '割当',
    /** §7.6 `io.mode` */
    ioFixed: 'この割付どおりに配線します。',
    ioFree: '推奨の割付です（変更できます）。',
    /** §10.2 入力コモンの結線 */
    wiringSink: 'シンク結線（P → S/S、PBのa接点 → X、PBのc端子 → N）',
    wiringSource: 'ソース結線（N → S/S、PBのa接点 → X、PBのc端子 → P）',
    // --- /Plan 3B Task 7 ---
    // --- Plan 3B Task 8 ---
    /** ナビゲーションウィンドウ（プロジェクトツリー）。§10.6 */
    treeProgram: 'プログラム',
    treeMain: 'MAIN',
    /** キー割当表。§12.1 / §17.1 */
    shortcuts: 'キー割当',
    shortcutNote: 'キー割当はメーカー（方言プロファイル）ごとに切り替わります。',
    /** ショートカットに無い操作はボタンで出す（決定表#12）。 */
    insertNetwork: '回路ブロック挿入',
    deleteNetwork: '回路ブロック削除',
    insertRow: '行挿入',
    deleteRow: '行削除',
    convertFailed: '変換できませんでした（出力ウィンドウを確認してください）',
    downloaded: 'シーケンサへ書き込みました（変換済みのラダーを反映）',
    // --- /Plan 3B Task 8 ---
    // --- Plan 3B Task 9 ---
    /** モニタ一覧と RUN/STOP。§10.6 / §10.7 */
    monitor: 'モニタ',
    monitorOff: 'モニタ（F3）を開始すると通電状態が表示されます。',
    monitorStopped: 'PLCが停止中です。RUN にすると動きます。',
    scanCount: 'スキャン回数',
    run: 'RUN',
    stop: 'STOP',
    /** ツールバーの RUN/STOP（盤だけを見ているときも押せる）。決定表#9b */
    runStopTitle: 'PLCを RUN／STOP します（盤の表示中も押せます）',
    plcReset: 'デバイス初期化',
    // --- /Plan 3B Task 9 ---
    // --- Plan 3B fix (Batch 3) ---
    /**
     * モニタ表示の空状態を「未変換」と「変換済みだがまだスナップショット無し」に分ける（I3）。
     * 変換キーはメーカー（方言プロファイル）から渡す（Batch 4+5 レビュー M9）。
     */
    monitorNotConverted: (convertKey: string): string => `先に変換（${convertKey}）してください`,
    monitorNoSnapshot: 'RUN にすると動きます',
    /** I/O割付表で機種の端子範囲を超えたとき（M3） */
    ioTerminalUnknown: '—',
    ioTerminalNote: 'この機種の割付範囲を超えています（端子名を表示できません）。',
    /** キー割当表の見出し行（M8: `<thead>` を追加） */
    shortcutKeyHeader: 'キー',
    shortcutLabelHeader: '操作',
    shortcutNoteHeader: '備考',
    // --- /Plan 3B fix (Batch 3) ---
  },
  // --- /Plan 3B Task 4 ---
  // --- Plan 3B Task 10 ---
  /** モードD（PLC）の画面。§10.1 / §10.2 / §12.1 */
  plc: {
    outlet: '壁コンセント（AC100V）',
    /** 盤・PLC本体・壁コンセントを全部入れる視点。決定表#6 */
    viewPlc: '盤＋PLC',
    unit: 'PLC本体',
    /**
     * 決定表#7の静的な1行。セッション中は**常に**出す（判定データではないので漏らしても構わない）。
     * Batch 4+5 レビュー B1: `ProblemPanel` の下と `IoTable` のキャプションの両方に出す。
     */
    outletNote: 'PLC電源は壁コンセント（AC100V）から取ります。',
    // --- Plan 3B Task 12 ---
    /** 画面の分割（ツールバーの3ボタン）。決定表#10 */
    viewLadder: 'ラダー',
    viewSplit: '分割',
    viewBoard: '盤',
    /** 判定ボタンを押せない理由。3A H-1 */
    judgeNoLadder: 'ラダーがありません',
    /**
     * 変換キーはメーカー（方言プロファイル）から渡す（決定表#12）。Batch 4+5 レビュー M9:
     * 画面に「F4」を直書きしない。
     */
    judgeNotConverted: (convertKey: string): string =>
      `変換（${convertKey}）を通してから判定します`,
    /** 未対応の機種を開いたとき（§13 #2）。Batch 4+5 レビュー M13 */
    unknownModel: (model: string): string =>
      `PLC機種「${model}」には対応していません。判定できません。`,
    /**
     * 画面の上段に出す手順の案内（2026-09-19 の利用者決定「分かりやすく直感的に」）。
     * 見出し語は GX Works3 の言い方に合わせる（内部の識別子は画面に出さない）。
     */
    guide: '手順',
    stepWire: '配線（3D盤）',
    stepLadder: 'ラダー作成',
    stepConvert: '変換',
    stepRun: 'モニタ開始・RUN',
    stepJudge: '判定',
    /** 「配線」はいつでも行えるので完了印を出さない（決定表#7 に触れない）。 */
    stepAnytime: 'いつでも',
    stepDone: '済',
    stepCurrent: 'いまここ',
    /** いまの状態（ボタンの見た目だけに頼らず文字でも出す）。 */
    statusLadder: 'ラダー',
    statusPlc: 'PLC',
    statusRunning: '運転中（RUN）',
    statusStopped: '停止中（STOP）',
    modeWrite: '書込モード',
    modeRead: '読出モード',
    modeMonitor: 'モニタ',
    /** 最初に何をすればよいか。キーの文字列は方言プロファイルから足す（決定表#12）。 */
    ladderHint: 'まずラダーを作ります',
    /**
     * 手順ごとの案内（Batch 4+5 レビュー M7: 常に出ていたのをいまの手順だけに絞る）。
     * キーの文字列は方言プロファイルから足す（決定表#12）。
     */
    convertHint: '変換します',
    runHint: 'RUNにして運転を始めます（モニタで確認できます）',
    judgeHint: '判定ボタンで判定します',
    /** 押せないボタンの理由を画面にも出す（`title` だけに頼らない）。 */
    judgeBlocked: '判定できません',
    // --- /Plan 3B Task 12 ---
    // --- Plan 3B Task 13 ---
    /** 結果画面で最初に読ませる「なぜそうなったか」。2026-09-19 の利用者決定 */
    why: 'この判定になった理由',
    whyPassed: '模範回路と同じ動作で、配線の検査もすべて通りました。',
    /** 見比べた信号の見出し（`見比べた信号: PL1・PL2`）。§10.8 */
    compared: '見比べた信号',
    /** H-5: PLCの電源を盤から取っている。内部の節番号は画面に出さない（Batch 4+5 レビュー M10）。 */
    powerFromBoard:
      'PLCの電源は壁コンセント（AC100V）から取ります。試験用盤のAC100V・DC24VをPLCの電源に使うことはできません。',
    /** H-5: 壁コンセントへ未配線。決定表#15c */
    powerUnwired: 'PLCの電源が未配線です。壁コンセントの L と N へ2本配線してください。',
    /** H-5: どちらの場合も添える説明。 */
    powerSimNote:
      '本アプリのPLCは PLC.L / PLC.N が未配線でも動作します（AC電源は電気的に解かないため）。ラダーどおりに動いていても、このチェックは不合格になります。',
    /**
     * 不合格理由の1行に添える短い助言（`plc-power-help` カードの詳しい説明とは別物にする。
     * Batch 4+5 レビュー M11: `explainPowerCheck()[0]` の使い回しをやめる）。
     */
    advicePlcPowerIndependent:
      '壁コンセント（AC100V）からだけ電源を取るように配線し直してください。',
    /** 二段構成（`twoStage`）の直し方。§10.2 */
    adviceTwoStage:
      'PLCの出力はリレーのコイル（13・14番）へ、そのリレーの接点から表示灯へ、の2段で配線してください。',
    /** I/O割付（`ioAssignment`）の直し方。§7.6 */
    adviceIoAssignment:
      'I/O割付表のとおりに、押ボタンのa接点をPLCの入力へ、PLCの出力をリレーのコイルへ配線し直してください。',
    // --- Batch 4+5 レビュー M11: 汎用6件チェックの直し方（判定でPLC課題にも掛かりうる） ---
    adviceWireColorRule: '新規配線は課題で決められた線色に直してください。',
    adviceTerminalLimit:
      '1つの端子に3本以上つないでいる箇所を減らしてください（中継端子台を使う）。',
    adviceUnusedParts: '装着した部品を回路に組み込むか、使わないなら外してください。',
    adviceForbiddenCircuit: 'タイマの接点で自分のコイルを直接切らず、リレーを介してください。',
    adviceCoilPolarity: 'コイルの極性（＋／－）を確かめて配線し直してください。',
    advicePowerSequence:
      '電源はON: ブレーカ→スイッチ、OFF: スイッチ→ブレーカの順で操作してください。',
    /** 直し方を用意していないチェックの汎用フォールバック。 */
    adviceGeneric: '配線の指摘を確認してください。',
    // --- /Batch 4+5 レビュー M11 ---
    /** 変換に落ちたラダーの説明。H-1 */
    ladderNotSimulated:
      '変換に失敗したため、このラダーはシミュレートされていません。出力ウィンドウの指摘を直してから判定してください。',
    ladderErrors: 'ラダーの変換エラー',
    ladderWarnings: 'ラダーの警告',
    // --- /Plan 3B Task 13 ---
  },
  // --- /Plan 3B Task 10 ---
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
    // モードD（PLC）の3件。§7.4 の D 列
    twoStage: '二段構成（PLC出力→中継リレー→表示灯）',
    plcPowerIndependent: 'PLC電源の独立',
    ioAssignment: 'I/O割付',
  } satisfies Record<StaticCheckId, string>,
  mismatchReason: {
    timing: '時刻ずれ',
    value: '値違い',
    missing: '遷移が無い',
    extra: '余分な遷移',
    'unknown-signal': '比較対象の信号が模範回路に無い',
  } satisfies Record<MismatchReason, string>,
  /** 指摘の種別（`FaultReportKind`）。§9.2 */
  reportKind: {
    'wire-open': '断線',
    'wire-missing': '未配線',
    'wire-misrouted': '誤配線',
    'part-defect': '部品不良',
  } satisfies Record<FaultReportKind, string>,
  /** 経路器の失敗理由（`RoutingError.reason`）。§6.6 */
  routeReason: {
    'invalid-terminal': '盤に無い端子です',
    unreachable: '配線帯までたどり着けません',
    'footprint-crossing': '部品の上を避けて通せません',
  } satisfies Record<RoutingErrorReason, string>,
  error: {
    banner: '予期しないエラーが発生しました',
    reset: 'セッションをリセット',
    /**
     * 例外バナーの2つ目の導線。§13 #5
     * 盤そのものが壊れていて「リセット」では抜け出せないときに、課題を捨てて一覧へ戻る。
     */
    toList: '課題一覧へ戻る',
    /** 2回目のリセットで盤を作り直したときの知らせ。§13 #5 */
    boardReset: '作業を初期化して再開しました',
    /**
     * 点検系（C1/C2）で2回目のリセットまで来たときの知らせ。§13 #5
     * 故障入りの盤・点検する部品は作り直せないので、課題を捨てて一覧へ戻ったことを伝える。
     */
    boardAbandoned: '盤を作り直せないため課題一覧へ戻りました',
    webglLost: '描画を復旧しています…',
    workerError: 'シミュレーションでエラーが発生しました',
    /** preload が読み込まれていない（`window.ojt` が無い）。§4.3 */
    preloadMissing: 'プリロードが読み込まれていません',
    /** renderer のマウント先が無い（index.html の破損）。 */
    rootMissing: '#root が見つかりません',
  },
} as const;

/** アナログのΩレンジの表示（`×1` / `×10` / `×1k`）。§9.3 */
export function ohmRangeLabel(range: number): string {
  return range >= 1000 ? `×${String(range / 1000)}k` : `×${String(range)}`;
}

/** アナログの電圧レンジの表示（`2.5V` / `250V`）。§9.3 */
export function voltRangeLabel(range: number): string {
  return `${String(range)}V`;
}

/** プローブの配置状況（`黒プローブ: CHK.13`）。§9.3。M1: `side` は `ProbeSide` で受け取る。 */
export function probeLabel(side: ProbeSide, terminal: string | undefined): string {
  const name = side === 'black' ? JA.tester.probeBlack : JA.tester.probeRed;
  return `${name}: ${terminal ?? JA.tester.probeNone}`;
}

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

/** 作業ファイルを手動保存できたときのトースト（`保存しました: C:\...`）。§12.3 */
export function workFileSavedText(path: string): string {
  return `${JA.session.saved}: ${path}`;
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

/**
 * ウィンドウが隠れていた間に捨てた tick の操作ログ。§5.2
 *
 * 同じ通知が連続すると、ストア側（`noteDroppedTicks`）が行を増やさずここへ積算値を渡し直す。
 * `occurrences` が2以上のときだけ「（n 回）」を添える（初回の1件だけなら今まで通りの文言）。
 */
export function droppedTicksLog(ticks: number, occurrences: number = 1): string {
  const base = `ウィンドウが隠れていた間の ${ticks} tick を省略しました`;
  return occurrences <= 1 ? base : `${base}（${occurrences} 回）`;
}

/** 拡大できるチャート本体の読み上げ名（`タイムチャート（仕様）: クリックまたはEnterで拡大表示`）。§7.7 */
export function chartOpenerLabel(title: string): string {
  return `${title}: ${JA.timeChart.openHint}`;
}

/** 「拡大」ボタンの読み上げ名（`タイムチャート（仕様）を拡大`）。§7.7 */
export function chartEnlargeLabel(title: string): string {
  return `${title}を${JA.timeChart.enlarge}`;
}

/** 作業ファイルの課題が課題一覧に無い。§12.3 */
export function workFileProblemMissingText(problemId: string): string {
  return `作業ファイルの課題が見つかりません: ${problemId}`;
}

/** 作業ファイルを読み込んだときの操作ログ（`作業ファイルを読み込みました（…）`）。§12.3 */
export function workFileRestoredLog(savedAt: string): string {
  return `${JA.session.restoredLog}（${savedAt}）`;
}

/** 復元した危険操作の回数（操作ログ・警告一覧の1行）。§8.3 */
export function restoredHazardsText(count: number): string {
  return `${JA.session.restoredHazards}: ${count} ${JA.result.times}`;
}

/** 回路図ヒントを開いた回数（結果画面の1行。`回路図を開いた回数: 3`）。§8.4 */
export function schematicOpenCountText(count: number): string {
  return `${JA.inspectRepair.schematicOpenCount}: ${count}`;
}

/** 警告バナーのミス回数（`ミス 3 回`）。§5.6 / 利用者の決定「警告表示＋ミス回数記録」 */
export function mistakeCountText(count: number): string {
  return `${JA.result.mistakes} ${count} ${JA.result.times}`;
}

/** 接点の組のプローブ位置の表示（`1組 a接点`）。§9.1 */
export function contactProbeLabel(group: number, contact: 'a' | 'b'): string {
  return `${String(group)}組 ${contact}接点`;
}

/** 解答済みの件数（`3 / 6`）。§9.1 */
export function answeredText(answered: number, total: number): string {
  return `${JA.inspectParts.answered} ${String(answered)} / ${String(total)}`;
}

/** モードC1の正解数（`2 / 6 正解`）。§9.1 判定 */
export function correctCountText(correct: number, total: number): string {
  return `${String(correct)} / ${String(total)} ${JA.result.correct}`;
}

/** 部品トレイの1行（`p1（リレー）`）。§9.1 */
export function trayPartLabel(partId: string, isTimer: boolean): string {
  return `${partId}（${isTimer ? JA.session.timer : JA.session.relay}）`;
}

/** 指摘の対象の表示（`電線 sw-003` / `端子 CR1.13` / `部品 CR2`）。§9.2 */
export function reportTargetLabel(
  target: { wireId: string } | { partId: string } | { terminalId: string },
): string {
  if ('wireId' in target) return `${JA.session.wires} ${target.wireId}`;
  if ('terminalId' in target) return `${JA.inspectRepair.terminal} ${target.terminalId}`;
  return `${JA.session.parts} ${target.partId}`;
}

// --- Plan 3B Task 5 ---
/**
 * タイマ設定値をその番号帯で表せないときの確認文。§10.5
 * 例: 「3050ms は T0 では指定できません。100ms 刻みに丸めますか？」
 */
export function timerRoundPrompt(ms: number, device: string, baseMs: number): string {
  return `${String(ms)}ms は ${device} では指定できません。${String(baseMs)}ms 刻みに丸めますか？`;
}
// --- /Plan 3B Task 5 ---

// --- Plan 3B Task 6 ---
/** 変換エラーの場所（`n1 / 1 行 / 3 列`）。位置を持たない指摘は空文字。§10.6 */
export function ladderIssuePlace(networkId?: string, row?: number, col?: number): string {
  if (networkId === undefined) return '';
  if (row === undefined || col === undefined) return networkId;
  return `${networkId} / ${String(row + 1)} 行 / ${String(col + 1)} 列`;
}
// --- /Plan 3B Task 6 ---

// --- Plan 3B Task 7 ---
/** デバイスコメントの上限に達した注記。§10.7 */
export function commentCapText(limit: number): string {
  return `デバイスコメントは ${String(limit)} 件までです（新しい欄は入力できません）`;
}
// --- /Plan 3B Task 7 ---

// --- Plan 3B Task 9 ---
/** ミリ秒を秒表示にする（`1.2 秒`）。§10.7 */
export function secondsLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1)} ${JA.session.seconds}`;
}

/**
 * PLC入力回路の仕様の注記。§5.1.3
 * 値は**機種（FX5U）側**から渡す（`circuit-sim` の既定値 4.7kΩ/3mA ではない）。
 */
export function plcInputSpecText(ohms: number, onAmps: number, offAmps: number): string {
  const mA = (amps: number): string => (amps * 1000).toFixed(1);
  return `入力回路 ${(ohms / 1000).toFixed(1)}kΩ／ON ${mA(onAmps)}mA 以上／OFF ${mA(offAmps)}mA 以下`;
}
// --- /Plan 3B Task 9 ---

// --- Plan 3B Task 13 ---
/**
 * 差分1件を1文にする（`PL1 が 1.20 s で ON のはずが OFF でした（値違い）`）。§10.8
 * 時刻と値の整形は呼び出し側（`plc-explain.ts`）が済ませて渡す。i18n から描画側の
 * 整形関数（`timeReadout`）へ依存を伸ばさないため。
 */
export function mismatchSentence(
  signal: string,
  time: string,
  expected: string,
  actual: string,
  reason: string,
): string {
  return `${signal} が ${time} で ${expected} のはずが ${actual} でした（${reason}）`;
}

/** 変換エラーで判定が落ちたことの1文。§10.6 / 3A H-1 */
export function ladderErrorSummary(count: number): string {
  return `ラダーの変換に失敗しています（${String(count)} 件）。まず変換の指摘を直してください。`;
}

/** 落ちた静的チェック1件の理由（`二段構成: … → …`）。§10.8 */
export function checkReasonText(title: string, detail: string, advice?: string): string {
  return advice === undefined ? `${title}: ${detail}` : `${title}: ${detail} → ${advice}`;
}

/** 理由欄に並べきらなかった差分の件数。§10.8 */
export function moreMismatchesText(count: number): string {
  return `ほか ${String(count)} 件の差分があります（下の差分一覧を見てください）`;
}

/** 見比べた信号（`見比べた信号: PL1・PL2`）。§10.8 */
export function comparedSignalsText(signals: readonly string[]): string {
  return `${JA.plc.compared}: ${signals.join('・')}`;
}
// --- /Plan 3B Task 13 ---
