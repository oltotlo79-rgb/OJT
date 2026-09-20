import type { RoutingErrorReason } from '@ojt/board-model';
import type { HazardKind, MismatchReason } from '@ojt/circuit-sim';
import { OUTPUT_LABELS, PB_LABELS } from '@ojt/content';
import type { FaultReportKind, ProblemTag, StaticCheckId } from '@ojt/content';
import { MSG } from '../../shared/messages.js';
import type { ProbeSide } from '../app/store-types.js';
import type { BusSide, PinGroup } from '../session/socket-pins.js';

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
    assembleDesc: '有接点回路を盤の上で配線して組み立てます',
    inspectParts: '部品点検',
    inspectRepair: '回路点検・修復',
    /** モードC1のモードカードの説明。§9.1 */
    inspectPartsDesc: '不良のリレー・タイマをチェック用ソケットで点検します',
    /** モードC2のモードカードの説明。§9.2 */
    inspectRepairDesc: '故障が入った盤を点検し、白線で修復します',
    plc: 'PLC',
    // --- Plan 3B Task 15 ---
    /** モードDのモードカードの説明。§10 */
    plcDesc: 'PLCでラダーを組み、盤とつないで動かします',
    // --- /Plan 3B Task 15 ---
    settings: '設定',
    // --- Phase 7 Task 25（指摘 UX-05 / UX-19 / UX-28）---
    /** ホーム下段の「はじめての方はここから」の帯。 */
    startHereTitle: 'はじめての方はここから',
    startHereBody: 'まずは3級の「回路組立」から始めます。部品の付け方と配線の基本が身につきます。',
    startHereButton: '3級の回路組立をひらく',
    /** ホーム下段の「続きから」。 */
    continueTitle: '続きから',
    continueBody: '前回の続きを、そのまま開き直せます。',
    continueButton: '続きから始める',
    /** 続きが無いとき。 */
    continueNone: '前回の続きはありません。上のモードから課題を選んでください。',
    // --- /Phase 7 Task 25 ---
  },
  problemList: {
    title: '課題一覧',
    back: 'ホームへ戻る',
    grade: '級',
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
      '利用者課題フォルダに置いた課題ファイルは同梱課題と合流し、同じIDなら利用者側が優先されます。' +
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
    vendorHelp:
      'PLCの課題を開いたときに使う機種（メーカー）です。課題の機種もこのメーカーに合わせて開きます。',
    /** ラダーの表示列数。§10.6 */
    gridCols: 'ラダーの表示列数',
    /**
     * ラダーの表示列数の説明。引数は**いま選んでいるメーカー**の既定列数（レビュー指摘 #6:
     * 以前は「11」に固定していたが、機種によって既定が違うので固定値を出すと誤解させる）。
     */
    gridColsHelp: (vendorCols: number): string =>
      `ラダー編集画面の接点列の数（8〜15）。メーカーの既定は ${String(vendorCols)} です。`,
    /** 通電色。§10.6 */
    monitorColor: '通電色',
    monitorColorHelp:
      'モニタ中に通電しているセルへ塗る色です。「メーカーの既定に従う」のあいだは、選んでいるメーカーの色を使います。',
    /** グループを既定値へ戻す。 */
    resetPlcGroup: '既定に戻す',
    // --- Plan 4B Task 6 ---
    /**
     * 色・列数を方言の既定に任せるチェックボックス。決定表#8
     * レビュー指摘 #8: 以前はどちらも同じ「メーカーの既定に従う」で、何を指すか画面だけでは
     * 分からなかった（隣のチェックボックスと取り違えかねない）ので、対象ごとに文言を分ける。
     */
    followVendorGridCols: '列数はメーカーの既定に従う',
    followVendorMonitorColor: '通電色はメーカーの既定に従う',
    // --- /Plan 4B Task 6 ---
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
    // --- view cube 2026-09-19 ---
    /**
     * 3Dビューポートの操作ヒント（Blender 風の割り当て）。§12.2
     * 2026-09-14 の利用者要望「3D図の回転や拡大などは blender の操作感を目指し、
     * キューブをドラッグすることで画面を回せるように」と、2026-09-19 の
     * 「3Dの視点の角度を変えるの少し動かしづらい。blender のようにキューブを選択し
     * サクサク動くようにしたい」に合わせた一覧。右ドラッグは中ドラッグの別名にした。
     */
    viewHint:
      '左／中／右ドラッグ＝回転　Shift＋中／右ドラッグ＝平行移動　Ctrl＋中／右ドラッグ・ホイール＝ズーム（ポインタの位置へ）　キューブをドラッグ＝回転　キューブの面・辺・角をクリック＝その視点へ　テンキー1/3/7＝正面/右/上（Ctrl で反対側）　Home＝全体',
    // --- view cube 2026-09-19 ---
    // --- view cube design 2026-09-19 ---
    /** ビューキューブの「⌂」ボタン（正面から盤全体を見る既定の視点へ戻す）。§12.2 */
    viewCubeHome: '全体表示',
    /** ビューキューブの「⟳」ボタン（いまの視点プリセットへ着け直して傾きを戻す）。§12.2 */
    viewCubeReset: '傾きを戻す',
    // --- /view cube design 2026-09-19 ---
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
    /** 警告バナーを畳む。§5.6 */
    warnDismiss: '閉じる',
    problem: '課題',
    chart: 'タイムチャート（仕様）',
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
    noTerminal: '端子未選択',
    firstTerminal: '1本目',
    /** UI-15: `select` という別名定義があったが同じ文字列なので統合した。 */
    selection: '選択',
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
    /*
     * レビュー指摘 UX-22: 端子を選ぶと「未配線」しか選べず、訓練者が断線・誤配線・部品不良の
     * 選び方が分からず迷っていた（`reportKindsFor()` は対象の種類で選べる種別を決めている）。
     * 種別ポップオーバーに常時1行添えて先に説明する。
     */
    pickKindHint:
      '端子には『未配線』だけを出しています。断線・誤配線は電線を、部品不良は部品をクリックしてください',
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
    /**
     * 警告バナーの回数表示（UXレビュー #26）。「ミス」だと技能検定の用語（危険操作）と
     * ずれるので言い換えをやめる。実技試験では減点対象になることを添えるが、
     * このアプリの合否には影響しない（§17.2 #3）。
     */
    mistakes: '危険操作',
    mistakesSuffix: '（減点）',
    /** モードC1の正解数（§9.1 判定の「n/m 正解」）。 */
    correct: '正解',
    /** 訓練者の解答。§9.1 */
    yourAnswer: 'あなたの解答',
    /** 本当の状態。§9.1 */
    truth: '正解',
    /**
     * 正解の見分け方（期待される読み）の列見出し。§9.1 / UXレビュー #23
     * UI監査バッチF (wrap): 狭い画面（1280px）で列見出しが「あなたの解答」の列を圧迫し、
     * 語の途中で2行に折れていた。列の中身（`situation` の文）で説明は読めるので、
     * 見出しは短くする。
     */
    truthReading: '見分け方',
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
    // --- Plan 5 Task 9: 疑わしい配線（UXレビュー #28）。§8.3 / 決定表#9・#9b・#11・#27 ---
    suspects: '疑わしい配線',
    noSuspect:
      '模範回路との配線の違いは見つかりませんでした。部品の設定や操作の順序を見直してください。',
    suspectMissing: '不足',
    suspectExtra: '余分',
    suspectNote:
      '同じ機器の接点の組（CR1 の ⑨⑤／⑩⑥／⑪⑦／⑫⑧）は、どれを使っても回路は成立します。組が違うだけのときも、ここに「不足」「余分」として出ます。',
    showOnBoard: '盤で見る',
    backToResult: '結果へ戻る',
    fromResult: '結果から',
    // --- /Plan 5 Task 9 ---
    // --- Phase 7 Task 25（指摘 UX-13 / PR-02 / PR-03）---
    /** 合否バッジの隣の1行要約の呼び名（読み上げ用）。 */
    summary: 'まず直すところ',
    /** 画面末の「盤で直す」（1行要約が指した疑いを選んだ状態で盤へ戻る）。 */
    fixOnBoard: '盤で直す',
    /** 疑わしい配線の先頭に添える印（1行要約が指しているのはこの1件）。 */
    suspectFirst: '最初に直す',
    /** 合格したときの1行要約。 */
    summaryPassed: '動作も配線の決まりも模範回路と一致しました。',
    /** ヒントを何段まで開いたか（回路図ヒントの開閉回数と同じ扱い）。 */
    hintsUsed: 'ヒントを使った回数',
    // --- /Phase 7 Task 25 ---
  },
  /** タイムチャートの拡大表示と縦の補助線（Task CHART-UX）。§7.7 / §8.1 / §8.3 */
  timeChart: {
    enlarge: '拡大',
    /** 拡大できることの案内（チャート本体の読み上げ名に添える）。 */
    openHint: 'クリックまたはEnterで拡大表示',
    /**
     * レビュー指摘 UI-14: `SchematicView` に `onPickCell` があるとき（モードC2の連動
     * ハイライト中）は単クリックが「要素を選ぶ」に取られ拡大しない（Enter とダブルクリックは
     * 変わらず拡大する）。それなのに `openHint` のまま読み上げると「クリックで拡大できる」
     * という嘘の案内になる。
     */
    openHintPicking: 'Enterまたはダブルクリックで拡大表示',
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
    /** 読出し・モニタ中に編集しようとした。§10.6（キーは方言から渡す。決定表#2） */
    readOnly: (writeKey: string): string => `書込みモード（${writeKey}）に切り替えると編集できます`,
    /** 挿入・上書きの切換（`Ins`）。決定表#12b */
    insertOn: '挿入モードです（入力すると右のセルがずれます）',
    insertOff: '上書きモードです',
    /** `Shift+F3`（モニタ書込み）の注記。セッションで1回だけ出す。決定表#11 */
    monitorWriteSame: 'モニタと同じ動作です（本アプリにオンライン変更はありません）',
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
    /** 変換前。「変換」のあるスキンはキーを、無いスキンは自動である旨を出す。決定表#3 */
    notConverted: (convertKey: string): string => `未変換（${convertKey} で変換します）`,
    /** 「変換」操作を持たないメーカー（`convertStep: false`）の未変換。決定表#3 */
    notConvertedAuto: '自動で変換します（このメーカーのツールに「変換」操作はありません）',
    /** 同じく、自動変換が通ったとき（手で押した変換と区別して見せる）。 */
    convertOkAuto: '変換に成功しました（自動で変換されます）',
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
    /**
     * Plan 6 Task 11: 「方言プロファイル」は社内の言葉で、訓練者には通じない。
     * 同じことを普通の言葉で言い直し、前提で決めた割当があるという断りは残す（§17.1）。
     */
    shortcutNote:
      'キー割当はメーカーごとに切り替わります。一部は実機マニュアル未確認のため本アプリの表記です。',
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
    /** モニタの案内（キーは方言から渡す）。前提#22 */
    monitorOff: (monitorKey: string): string =>
      `モニタ（${monitorKey}）を開始すると通電状態が表示されます。`,
    monitorStopped: 'PLCが停止中です。RUN にすると動きます。',
    scanCount: 'スキャン回数',
    run: 'RUN',
    stop: 'STOP',
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
    // --- Plan 4B Task 3 ---
    /** 実機の操作パネルにあるが本アプリでは動かない項目。決定表#4 */
    vendorOnly: 'このボタンは実機の操作パネルの項目で、本アプリでは動作しません',
    /** タイトルバー（スキン名は `SkinTheme.titleBar`）。§15 / §17.1 */
    skinTitleNote: '各社の商標については設定画面の「このアプリについて」をご覧ください',
    /** ステータスバーの項目名。 */
    statusMode: 'モード',
    statusPlcState: 'PLC',
    statusScan: 'スキャン',
    statusNetwork: '回路ブロック',
    statusOverwrite: '入力',
    statusDeviceCount: 'デバイス点数',
    statusInsert: '挿入',
    statusOverwriteMode: '上書き',
    // --- /Plan 4B Task 3 ---
    // --- Plan 4B Task 5 ---
    /** 「変換」操作のないスキンの注記。§10.6 / 決定表#3 */
    noConvertNote:
      'このメーカーのツールには「変換」操作がありません。編集するとそのまま反映されます。',
    /** 入力コモン（機種によって1個とは限らない。4A 前提#17） */
    ioCommon: '入力コモン',
    // --- /Plan 4B Task 5 ---
    // --- Plan 4B review fixes (Batch: skin stream) ---
    /**
     * キー割当表全体が「別メーカーの表を流用した」注記（I7）。行ごとの `assumptionNotice`
     * とは別に、PCwin風・JW-300SP風のように**表そのもの**を GX Works3風から借りているスキンで
     * 一度だけ出す（`SkinTheme.keyMapAssumed`）。
     */
    keyMapAssumedNote: 'キー割当は実機マニュアル未確認のため本アプリの表記です',
    // --- /Plan 4B review fixes (Batch: skin stream) ---
    // --- Plan 4B Task 8 ---
    /** 表記切替（§10.7 / 決定表#11・#12）。 */
    notationTitle: '表記切替',
    notationHelp: '同じラダーを別メーカーの表記で表示します。プログラムは書き換わりません。',
    /** 切替先を選ばせる問いかけ（何をすればよいかを画面に出す）。 */
    notationPick: 'どのメーカーの表記にしますか？',
    notationPickFirst: 'メーカーを選ぶと、切替後の書き方をここに一覧で出します。',
    notationWarning:
      '機種も切り替わるため、盤の配線はやり直しになります（ラダーとデバイスコメントは残ります）。',
    notationFrom: 'いまの表記',
    notationTo: '切替後',
    /** 一覧の見出し。 */
    notationDevices: 'デバイスの書き方',
    notationPresets: 'タイマ・カウンタの設定値の書き方',
    notationIssues: '切替後の表記で表せない項目',
    notationNoChange: '表記が変わるデバイスはありません。',
    notationNoIssue: '表せない項目はありません。',
    notationApply: 'この表記に切り替える',
    notationApplyTo: (name: string): string => `${name} の表記に切り替える`,
    notationClose: '閉じる',
    /** その機種では開けない課題（決定表#10）。押す前に理由を読ませる。 */
    notationNotFit: (model: string): string =>
      `この課題の入出力の割付が ${model} に収まらないため、このメーカーには切り替えられません`,
    // --- /Plan 4B Task 8 ---
    // --- Plan 4B Task 9 ---
    /** 命令語リストの書き出し（§10.7 / 受入基準⑥）。 */
    exportIl: '命令語リスト',
    ilSaved: (path: string): string => `命令語リストを保存しました: ${path}`,
    /**
     * 命令語リストにできなかった指摘のうち、`INSTRUCTION_LIST_MESSAGES` の文言のままでは
     * 直し方が分からないものの言い換え。§10.7
     *
     * 4A の `reduceToExpr()` が分解に失敗するのは「左母線から出力まで辿れる道が無い」ときと
     * 「直並列に分解できない渡り方をしている」ときの2つ。どちらも**どこをどう直すか**まで書く
     * （申し送り F-1 が前者と同じ診断を `compile()` 側へ頼んでいる）。生の `message` は
     * 回路ブロックの内部ID（`n1`）を含むので画面には出さない。
     */
    ilIssueAdvice: {
      'coil-unconnected':
        '左母線につながっていない出力があります。出力の左に接点か横線を置いて、左母線までつないでください。',
      'not-series-parallel':
        'この回路は命令語リストに変換できません（直列と並列の組み合わせに分けられません）。縦線の渡りを減らして組み直してください。',
      // --- Plan 4B Batch C 修正 #3: 保存は止めない指摘（行自体は ? で書き出せている） ---
      'preset-unavailable':
        'この機種では書けない設定値があります。値の代わりに ? を書き出しました。設定値を機種に合わせて直すか、書けるメーカーに切り替えてください。',
      // --- /Plan 4B Batch C 修正 #3 ---
    } as Readonly<Record<string, string>>,
    // --- /Plan 4B Task 9 ---
    // --- Phase 7 Task 2 (LE-3) ---
    /**
     * END セルを消す・上書きしようとしたときの断り。`session/ladder.ts` は文言を持たない層
     * なので合図の `'end-locked'` だけを返し、`LadderEditor` がここで文言を当てる。
     */
    endLocked: 'END は消せません。ネットワークごと消すには「ネットワーク削除」を使います。',
    // --- /Phase 7 Task 2 (LE-3) ---
    // --- Phase 7 Task 20 (キー割当の出典) ---
    /**
     * キー割当表の備考に添える出典。記号（S1〜S8）は
     * `docs/reference/ladder-skin-sources.md` の一覧を指す（§17.1 / Phase 7 設計 §5.7）。
     */
    shortcutSource: (source: string): string => `出典 ${source}`,
    // --- /Phase 7 Task 20 ---
    // --- Phase 7 Task 21（回路入力の3つの入口と1行直接入力。設計 §5.3 / 指摘 UX-02・PR-01） ---
    /**
     * 回路入力欄。見出しの言葉はメーカーごとに違う（`SkinTheme.entryTitle`）ので、ここには
     * どのメーカーでも通じる既定と、入口B（ツールバーの記号ボタン）・入口C（格子の右クリック）
     * の言葉を置く。
     */
    entry: {
      /** 記号とデバイスを1行で書く欄。 */
      direct: '記号とデバイス',
      /** その欄の書き方（入力例はメーカーの綴りから作るので、ここには書式だけ）。 */
      directHelp: '命令とデバイスを空白で区切って書けます（デバイスだけでも置けます）',
      /** 応用命令欄（三菱 `F8` ／ OMRON `I`）。 */
      application: '応用命令',
      applicationHelp: '命令とデバイスを空白で区切って書きます',
      /** 本アプリが解釈できない命令。設計 §5.2 の文言そのまま。 */
      applicationUnsupported:
        'このアプリでは扱えない命令です（扱えるのは SET / RST / MC / MCR / T / C）',
      /** 空白で区切った語が多すぎる。 */
      tooManyWords: '入力が多すぎます（命令・デバイス・設定値の順に空白で区切ってください）',
      /** デバイス確定のあとに続けて開くコメント欄（CX-Programmer 風。設計 §5.2 の S4）。 */
      comment: 'コメント',
      commentHelp: 'そのまま Enter で確定します',
      /** ツールバーの記号ボタン列。 */
      symbols: '記号',
      /** ボタン名にはキーを併記する（「a接点 (F5)」）。 */
      withKey: (label: string, key: string): string => `${label} (${key})`,
      orContactNo: 'OR a接点',
      orContactNc: 'OR b接点',
      hline: '横線',
      vline: '縦線',
      delete: '削除',
      /** 空セルの右クリックで出る記号メニュー。 */
      menu: '記号メニュー',
      /** ドラッグして置けるスキンの案内（JW-300SP 風。設計 §5.2 の S8）。 */
      dragHint: '格子へドラッグしても置けます',
      /** 出力の無い回路ブロックの右端の赤線（CX-Programmer 風。設計 §5.2 の S4）。 */
      noOutput: '出力がありません',
      /** 未変換の回路ブロックの灰色背景（「変換」のあるメーカーだけ）。 */
      unconverted: (convertKey: string): string => `未変換です（${convertKey} で変換します）`,
      /** 灰色背景は一次資料で確認できていない（`SkinTheme.assumed` に載せる）。§17.1 */
      unconvertedAssumed:
        '未変換の回路ブロックを灰色の背景で示す（実機の見え方は一次資料で確認できていない）',
    },
    // --- /Phase 7 Task 21 ---
    // --- Phase 7 Task 22（ウィンドウ構成とモニタ表示。設計 §5.5 / 指摘 LE-18・PR-05・UX-14） ---
    /** タイトルバーのモード表示に添える案内。キーは方言から引く（前提#22）。 */
    modeKeysHint: (writeKey: string, monitorKey: string): string =>
      `書込みは ${writeKey}、モニタは ${monitorKey} で切り替えます`,
    /** モニタの欄の中の「デバイス一覧」（全部を並べるほう）。 */
    deviceList: 'デバイス一覧',
    /**
     * 通電しているかを**色だけで**示さないための印（指摘 UX-14 ≡ UI-17）。
     * ON は塗りつぶし、OFF は白抜きで、色が見えなくても形で読み分けられる。
     */
    onMark: '■',
    offMark: '□',
    /** 監視（ウォッチ）欄。呼び名はメーカーごとに違う（`panels.watch`）。 */
    watch: {
      /** `panels.watch` を名乗らないメーカー向けの既定（そのときは欄そのものを出さない）。 */
      title: '監視',
      /** 監視に足すデバイスを打ち込む欄。 */
      device: '監視するデバイス',
      add: '監視に追加',
      remove: '監視から外す',
      empty: 'まだ何も登録していません。見たいデバイスを足すと、ここだけに並びます。',
      /** 監視に入れたが、いまのモニタには載っていないデバイス。 */
      noValue: '—',
      /** 同じデバイスを二度足したとき。 */
      duplicate: 'そのデバイスはもう登録されています',
      /** 監視の上限（欄が縦に伸びすぎないように）。 */
      full: (limit: number): string => `監視に登録できるのは ${String(limit)} 個までです`,
    },
    /** キー割当の覆い（`Shift + ?` で開く早見表。指摘 PR-05）。 */
    overlay: {
      title: 'キーの早見表',
      /** 開き方の案内（キー割当の欄に出す）。 */
      hint: 'Shift + ? でキーの早見表を開きます',
      close: '閉じる',
      /** モニタ開始のように、キーではなく押す場所で覚える操作（指摘 LE-7）。 */
      byButton: (label: string): string => `上の帯の「${label}」を押します`,
      /** 表そのものを別メーカーから借りているスキン（PCwin風・JW-300SP風。レビュー I7）。 */
      assumedTable:
        'この表はすべて実機マニュアル未確認のため本アプリの表記です（行ごとの断りは省いています）',
    },
    // --- /Phase 7 Task 22 ---
  },
  // --- /Plan 3B Task 4 ---
  // --- Plan 3B Task 10 ---
  /** モードD（PLC）の画面。§10.1 / §10.2 / §12.1 */
  plc: {
    outlet: '壁コンセント（AC100V）',
    /** 盤・PLC本体・壁コンセントを全部入れる視点。決定表#6 */
    viewPlc: '盤＋PLC',
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
     * 見出し（`手順`）と「済」「いまここ」は Phase 7 Task 11 で `JA.stepGuide` へ集約した
     * （`panels/StepGuide.tsx`）。`stepAnytime` だけはモードD専用の3つめの状態なので残す。
     */
    stepWire: '配線（3D盤）',
    stepLadder: 'ラダー作成',
    stepConvert: '変換',
    stepRun: 'モニタ開始・RUN',
    stepJudge: '判定',
    /** 「配線」はいつでも行えるので完了印を出さない（決定表#7 に触れない）。 */
    stepAnytime: 'いつでも',
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
    // --- Plan 4B Task 3 ---
    /** 「変換」のないスキンで、まだ変換が通っていないとき。決定表#3 */
    judgeAutoConverting: 'ラダーに直すところがあります（出力ウィンドウを確認してください）',
    /**
     * 「変換」操作を持たないメーカーの手順帯に添える1行（利用者要求「分かりやすく直感的に」）。
     * 手順から「変換」の段が落ちる理由をその場で読めるようにする。決定表#3
     */
    stepConvertAuto: '「変換」の操作はありません（編集すると自動で変換されます）',
    // --- /Plan 4B Task 3 ---
    // --- Plan 4B Task 7 ---
    /** 既定メーカーの機種では開けない課題（決定表#10）。 */
    modelNotUsable: (wanted: string, used: string): string =>
      `この課題の入出力の割付は ${wanted} に収まらないため、${used} のまま開きました`,
    /** セッション画面に出す機種名（3Dの本体と同じ機種であることを見せる）。 */
    modelLabel: '機種',
    // --- /Plan 4B Task 7 ---
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
    // --- Plan 4B Task 8 ---
    /** 表記切替が終わったことを伝える（§10.7 / 決定表#12）。 */
    notationSwitched: (name: string): string => `${name} の表記に切り替えました`,
    // --- /Plan 4B Task 8 ---
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
  /**
   * 差分の理由（指摘 UX-12）。判定器の語（「遷移が無い」「余分な遷移」「時刻ずれ」）を
   * 訓練者の言葉に置き換えたもの。用語集に無い語を画面に出さないため、
   * 「遷移」「値」のような判定器の言い回しは使わない。
   */
  mismatchReason: {
    timing: '変化する時刻がずれています',
    value: 'その時刻の点灯／消灯が逆です',
    missing: '点く（切れる）はずの変化が起きていません',
    extra: '起きないはずの変化が起きています',
    'unknown-signal': '見比べる信号が模範回路にありません',
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
    webglLost: '表示を作り直しています',
    workerError: 'シミュレーションでエラーが発生しました',
    /** preload が読み込まれていない（`window.ojt` が無い）。§4.3 */
    preloadMissing: 'プリロードが読み込まれていません',
    /** renderer のマウント先が無い（index.html の破損）。 */
    rootMissing: '#root が見つかりません',
    // --- Phase 7 Task 9: DS-4 ---
    /**
     * 30秒ごとの自動保存が連続2回失敗したときの知らせ（1度だけ出す）。§12.3
     * 毎回出すと訓練の邪魔になるため、2回目で気づけるだけの頻度にする（App.tsx）。
     */
    autosaveFailed: '自動保存に失敗しました。作業ファイルを手動で保存することをおすすめします',
    // --- /Phase 7 Task 9: DS-4 ---
  },
  // --- UX pass 2026-09-19 ---
  /**
   * モードB/C1/C2の手順帯（UXレビュー #3）。モードDの `plc.guide` 系と同じ考え方で、
   * 「いまここ」「済」をストアの状態（部品装着・配線・通電・判定）だけから決める。
   * 配線の中身や合否には一切触れない（決定表#7と同じ理由）。`session/step-guide.ts` から使う。
   */
  stepGuide: {
    label: '手順',
    done: '済',
    current: 'いまここ',
    /**
     * 「判定」手順の案内。モードB/C1/C2で別名定義（`assembleJudgeHint` 等）が3つとも
     * 同じ文字列だったので1本にした（UI-15）。
     */
    judgeHint: '判定ボタンで判定します。',
    /**
     * 電源投入手順の案内。モードB/C1の別名定義（`assemblePowerHint` / `inspectPowerHint`）が
     * 同じ文字列だったので1本にした（UI-15）。
     */
    powerHint: 'ブレーカ → 電源スイッチの順に入れます。',
    /** モードB: 部品装着 → 配線 → 通電（ブレーカ→電源スイッチ）→ 判定 */
    assembleParts: '部品装着',
    assembleWire: '配線',
    assemblePower: '通電（ブレーカ→電源スイッチ）',
    assembleJudge: '判定',
    assemblePartsHint: '部品パネルでソケットを選び、「装着」を押します。',
    assembleWireHint: '3D盤の端子を2つクリックして配線します。',
    /** モードC1: 部品を挿す → 通電 → 測る → マーク → 判定 */
    inspectPlug: '部品を挿す',
    inspectPower: '通電',
    inspectMeasure: '測る',
    inspectMark: 'マーク',
    inspectJudge: '判定',
    inspectPlugHint: '部品トレイから部品を選び、チェック用ソケットに挿します。',
    inspectMeasureHint: 'テスターの黒・赤プローブを端子に当てて測ります。',
    inspectMarkHint: 'マークシートで不良原因を選びます。',
    /** モードC2: 指摘 → 修復 → 判定 */
    repairReport: '指摘',
    repairFix: '修復',
    repairJudge: '判定',
    repairReportHint: '3D盤の電線・端子・部品をクリックして故障の種別を選びます。',
    repairFixHint: '白線を張るか部品を交換して修復します。',
    // --- Plan 5 Task 4 ---
    /** モードBの回路図エディタ: 描く → 検算 → 盤に配線（Plan 5 決定表#24） */
    schematicDraw: '回路図を描く',
    schematicVerify: '検算する',
    schematicWire: '盤に配線する',
    schematicDrawHint:
      'パレットで要素を選び、図の桁をクリック（またはカーソルを合わせて Enter）で置きます。',
    schematicVerifyHint:
      '「検算」を押すと、描いた回路を課題の操作列で確かめます。盤の配線はまだ見ません。',
    schematicWireHint: '検算に通りました。回路図の要素をクリックすると、3D盤の対応端子が光ります。',
    // --- /Plan 5 Task 4 ---
  },
  /**
   * 押せないボタンの理由（UXレビュー #5）。`title` と、パネル内に出す一行の説明の両方に使う
   * （ツールチップだけに頼らない）。`panels/Toolbar.tsx` の元に戻す／やり直し、
   * `panels/TesterPanel.tsx` の 0Ω ADJ。
   */
  disabledReason: {
    undo: '元に戻せる操作がありません',
    redo: 'やり直せる操作がありません',
    // レビュー指摘 UX-01: 実際の条件は `kind === 'analog' && isOhmSide`（アナログ かつ Ω／導通）。
    // 旧文言は「デジタルテスター、または…」で条件が実装と逆だった。
    zeroAdjust: 'アナログテスターのΩ／導通レンジのときだけ 0Ω 調整ができます',
  },
  /**
   * 波形の見比べの凡例（UXレビュー #7）。`result/ChartOverlay.tsx` の小さい重ね表示と
   * 拡大表示の両方に出す。線の太さ・色は `result.module.css` の `.overlayExpected` /
   * `.overlayActual` / `.legendBand` と揃える。
   */
  chartLegend: {
    expected: '模範（細い薄色）',
    actual: '訓練者（太い線）',
    diff: '差分（赤い帯）',
  },
  /**
   * ライブ記録の折りたたみ（UXレビュー #9）。最初の変化が起きるまでは空のグラフを
   * 出さず、折りたたんだまま案内だけ出す。`screens/Session.tsx` の `LivePanel`。
   */
  liveCollapse: {
    empty: 'まだ記録がありません（通電して操作すると記録が始まります）',
    expand: '開く',
    collapse: '折りたたむ',
  },
  /** 電源操作の順番（UXレビュー #10）。`panels/PowerControls.tsx`。 */
  powerStep: {
    breaker: '① ブレーカ',
    switch: '② 電源スイッチ',
  },
  /** 視点操作の早見表の開閉ボタン（UXレビュー #14）。`panels/ViewHint.tsx`。 */
  viewHintToggle: '視点操作の早見表',
  /**
   * 課題一覧（UXレビュー #12 / #20）。`screens/ProblemList.tsx`。
   * 標準時間・打切時間はどちらも分単位で単位まで出す（`30分 / 50分`）。
   */
  problemListExtra: {
    allGrades: 'すべて',
    columnTime: '標準時間 / 打切時間',
    /*
     * 絞り込みの見出し（UI監査 I17）。モード・級の2段の絞り込みが見出し無しで並んでいて、
     * 2段目（級）が何の絞り込みか分からなかった。
     */
    filterModeLabel: 'モード',
    filterGradeLabel: '級',
    // --- Phase 7 Task 25（指摘 UX-18 / UX-19 / PR-09）---
    /** 課題名・説明・IDから探す入力欄。72題から目的の課題に辿り着くための導線。 */
    searchLabel: '課題を探す',
    searchPlaceholder: '言葉で探す（例: 自己保持）',
    /** 入力した言葉に当たる課題が無いとき。 */
    searchEmpty: '入力した言葉に当たる課題がありません。別の言葉で探してください。',
    /** 3級に添える案内。初めて開いたときはここが選ばれている。 */
    recommended: '（おすすめ）',
    /** 難しさの絞り込み（同じ級の中での並び）。 */
    filterDifficultyLabel: '難しさ',
    /** 学習テーマの絞り込み。 */
    filterTagLabel: '学習テーマ',
    /** 右端の補助列に移したID列の見出し（読み上げ用の長い名前）。 */
    columnIdNote: '課題ID',
    // --- /Phase 7 Task 25 ---
  },
  /**
   * 起動時の復元カード（UXレビュー #15）。`app/App.tsx`。
   * どの課題のどんな作業を復元するのか（モード・課題名・経過時間）をカードで見せる。
   */
  restoreCard: {
    mode: 'モード',
    problem: '課題',
    elapsed: '経過時間',
    /** 課題名がまだ引けていない（読み込み中）ときの仮の表示。 */
    unknownProblem: '（読み込み中…）',
  },
  /**
   * ツールバーの「…」メニュー（UXレビュー #17）。頻度の低い視点・保存読込・回路図の
   * 開閉をここに畳み、1280px幅でも判定ボタンが1行目に残るようにする。
   */
  toolbarOverflow: {
    label: 'その他の操作',
    view: '視点',
    workFile: '作業ファイル',
  },
  /** ホームの「最近の課題」の一行（UXレビュー #19）。`screens/Home.tsx`。 */
  recentProblem: '最近の課題',
  // --- /UX pass 2026-09-19 ---
  // --- Plan 5 Task 4 ---
  /** 回路図エディタ（§11.4 / Plan 5）。 */
  schematic: {
    title: '回路図エディタ',
    palette: '置ける要素',
    verify: '検算',
    verifying: '検算中…',
    verifyPassed: '検算 合格',
    verifyFailed: '検算 不合格',
    verifyNote: '机上の検算です。盤の配線は「判定」で別に確かめます。',
    issues: '回路図の指摘',
    noIssues: '指摘はありません。検算できます。',
    addRung: '段を追加',
    removeRung: '段を削除',
    clear: '全部消す',
    clearConfirm: '描いた回路図をすべて消します。よろしいですか？',
    undo: '元に戻す',
    redo: 'やり直し',
    cursor: 'カーソル',
    keyHint:
      '矢印＝移動　Enter＝置く　Delete＝消す　Insert＝段を追加　Ctrl+Delete＝段を削除　Ctrl+Z／Ctrl+Y＝元に戻す／やり直し　Esc＝分岐をやめる',
    viewBoard: '盤',
    viewSplit: '並べて',
    viewSchematic: '回路図',
    // 分岐（§11.1 の分岐点。自己保持回路に要る）
    branch: 'この段を分岐にする',
    branchCancel: '分岐をやめる',
    branchHint:
      'いま選んでいる段を、ほかの段の節点どうしをつなぐ「分岐」にします。自己保持回路に使います。',
    branchPickFrom:
      '分岐の始点をクリックしてください（ほかの段の、要素と要素のあいだを選びます）。Esc でやめられます。',
    branchPickTo:
      '分岐の終点をクリックしてください。始点から右側の節点を選ぶと、そのあいだの要素と並列になります。Esc でやめられます。',
    branchSelfRefused: '分岐の始点・終点には、ほかの段の節点を選んでください。',
    branchSameNode: '始点と同じ節点は終点にできません。別の節点を選んでください。',
    branchNoRung: 'その段がありません。',
    branchNoNode: 'その節点がありません。',
    branchNeedsAnotherRung: '分岐先になる段がありません。先に「段を追加」で段を増やしてください。',
    branchHasLoad: 'コイル・表示灯・ブザーのある段は分岐にできません（分岐段に負荷は置けません）。',
    branchDone: 'この段を分岐にしました。',
    branchOf: 'を分岐にしています：',
    branchAborted: '分岐の指定をやめました（画面を切り替えたため）。',
    // --- Plan 5 レビュー B1: タイマコイルの設定時間（§5.3.2 / §17.2 #12） ---
    preset: '設定時間',
    presetHint: '0.1〜10.0秒を0.1秒刻みで指定できます（実機のH3Y-4と同じ）。',
    presetUp: '設定時間を0.1秒ふやす',
    presetDown: '設定時間を0.1秒へらす',
    presetAtMax: 'これ以上は長くできません（10.0秒まで）。',
    presetAtMin: 'これ以上は短くできません（0.1秒から）。',
    // --- Plan 5 レビュー Minor: 押せない理由・「全部消す」・検算パネルの見出し ---
    addRungHint: 'いま選んでいる段のすぐ下に、新しい段を足します。',
    addRungFull: '段はこれ以上ふやせません。',
    removeRungHint: 'いま選んでいる段を消します。',
    removeRungLast: '最後の1段は消せません。',
    clearNothing: 'まだ何も描いていません。',
    clearYes: 'はい、全部消す',
    clearNo: 'やめる',
    cleared: '回路図をすべて消しました。',
    verifiedProblem: '検算した課題',
    draftUnreadable: '作業ファイルの回路図の下書きは読めませんでした（盤の配線だけを開きます）。',
    // --- Plan 5 Task 7: ビュー切替（盤／並べて／回路図） ---
    /** ツールバーの切替の見出し。「何を見るか」を選ぶ道具であることを先に言う。 */
    viewLabel: '表示',
    /** 切替のキー割当（画面にも出す。利用者要求 2026-09-19「キーボードも示す」）。 */
    viewKey: 'F2',
    viewBoardTitle: '3Dの盤だけを見ます（F2 で切替）',
    viewSplitTitle: '3Dの盤と回路図エディタを並べて見ます（F2 で切替）',
    viewSchematicTitle: '回路図エディタだけを見ます（F2 で切替）',
    // --- /Plan 5 Task 7 ---
  },
  // --- /Plan 5 Task 4 ---
  // --- schematic quality 2026-09-19 ---
  /**
   * 回路図ヒントの見せ方（タイムチャートと同じ「クリックで拡大」）。§8.1 / §11.2
   * 文字はタイムチャート（`JA.timeChart`）と揃え、回路図にしか無い倍率の言い方だけ足す。
   */
  schematicView: {
    zoomIn: '拡大',
    zoomOut: '縮小',
    zoomReset: '等倍',
    zoomLabel: '表示倍率',
  },
  // --- /schematic quality 2026-09-19 ---
  // --- Plan 5 Task 10 ---
  /** 端子リスト（キーボードで配線する）。UXレビュー #29 */
  terminalList: {
    title: '端子リスト（キーボード配線）',
    hint: 'Tab で端子を移動し、Enter で選びます。2つ選ぶと電線が1本つながります。',
    search: '端子を探す',
    pending: '1本目',
    cancel: '取り消す',
    // 上限は §6.6（1端子2本まで）。訓練者が読む文字列に節番号は出さない（M4: Plan 5 C/D レビュー）
    full: 'この端子には既に2本つながっています',
  },
  // --- /Plan 5 Task 10 ---
  // --- Plan 6 Task 8 ---
  /**
   * ヘルプの引き出し。**本文はここに書かない**（正本は `docs/manual/*.md`）。
   * ここに置いてよいのは画面の部品の名前だけで、値は40文字以下にする
   * （取扱説明書 設計 決定表#28。`help-drawer.test.tsx` が検査する）。
   */
  help: {
    open: 'ヘルプ',
    title: '取扱説明書',
    close: '閉じる',
    contents: 'もくじ',
    searchLabel: '言葉で探す',
    searchPlaceholder: '例: 自己保持',
    searchEmpty: '見つかりませんでした。別の言葉で探してください。',
    openPdf: '説明書（PDF）を開く',
    // IM-8: 正本は `MSG.manual.missing`（main が返す文言と1語1句そろえる。§9 決定表）
    pdfMissing: MSG.manual.missing,
    shortcutHint: 'F1 でいつでも開けます',
    // 図（利用者の決定 2026-09-20）
    enlarge: '図を大きく見る',
    figureClose: '図を閉じる',
    // UX-21: 節の末尾の導線（ヘルプ引き出し 設計 §6.4）
    prevSection: '← 前の節',
    nextSection: '次の節 →',
    viewSectionPdf: 'この節をPDFで見る',
  },
  // --- /Plan 6 Task 8 ---

  // --- Phase 7 Task 27: 3D盤の直接操作 ---
  /**
   * 断る理由（`session/interaction.ts` の `RefuseReason` と1対1）。Phase 7 設計 §7.3.1
   * 「押しても何も起きない」を無くすための文なので、**理由と次の一手**を必ず書く。
   */
  refuse: {
    terminalFull: 'この端子はすでに2本つながっています。別の端子へつないでください',
    notWirable: 'この端子には配線できません（本体側は既設配線済みです）',
    lockedWire: 'チェック用回路の既設配線（青）は変更できません',
    socketOccupied: 'このソケットにはすでに部品が載っています。先に取り外してください',
    notASocket: 'ここには置けません。盤のソケットの上で放してください',
  },
  /**
   * 3Dペインの下端に出す1行の予告（`panels/HoverHint.tsx`）。Phase 7 設計 §7.3.4
   * 「いま指しているものは何で、押すと何が起きるか」だけを書く。`aria-live="polite"` にも同じ文が出る。
   */
  hoverHint: {
    /** 何も指していないとき（最初の一手が分かるようにする）。 */
    idle: '盤の部品を押すと操作できます。ドラッグで視点が回ります',
    breakerOn: 'ブレーカを入れます（先にブレーカ、次に電源スイッチ）',
    breakerOff: 'ブレーカを切ります',
    switchOn: '電源スイッチを入れます',
    switchOffFirst: '先にブレーカを入れます',
    switchOff: '電源スイッチを切ります',
    socketEmpty: '空きソケットです。部品をここへ運ぶか、押して部品を選びます',
    socketMounted: '押すと部品カードが開きます。つまんで外へ放すと取り外せます',
    wireBegin: '押すと配線の1本目になります',
    wireFinish: 'ここで放すと電線が1本つながります',
    pushButton: '押している間だけ接点が動きます',
    /** 運搬中（パレットの部品を運んでいる）。 */
    carrying: '空きソケットの上で放すと装着します',
    /** 運搬中（盤の部品をつまんでいる）。 */
    carryingMounted: 'ソケットの外で放すと取り外します',
  },
  // --- /Phase 7 Task 27 ---
  // --- Phase 7 Task 25 ---
  /**
   * ヒント（指摘 PR-02）。上の帯の「ヒント」を押すたびに1段ずつ開く。
   * 段の中身を組み立てるのは `session/hints.ts` の純関数で、ここは名前だけを持つ。
   */
  hint: {
    label: 'ヒント',
    /** 2段目以降を開くボタン（まだ開ける段があるとき）。 */
    more: 'つぎのヒント',
    /** これ以上の段が無いとき（1級形式は3段目を出さないので2段で終わる）。 */
    done: 'ヒントはここまでです',
    close: 'ヒントを閉じる',
    stage1: 'いまの手順でやること',
    stage2: 'この課題の考え方',
    stage3: '次につなぐ1本',
    /** 1段目の落としどころ（手順の案内が取れないとき）。 */
    stepFallback: '手順帯の「いまここ」に出ている手順から進めてください。',
    /** 2段目の落としどころ（学習テーマが付いていない課題）。 */
    ideaFallback:
      '課題文の動きを「押したとき」「離したとき」に分けて書き出すと、必要な接点が見えてきます。',
    /** 3段目（回路図が見える級だけ）。答えそのものではなく、見るところまでを示す。 */
    wire: '回路図を見て、まだ盤に張っていない線を1本だけ探し、その両端の端子をつなぎます。',
    /** 1級形式で3段目を出さない理由。 */
    grade1Note: '1級形式では回路図が示されないので、ここまでのヒントで考えます。',
  },
  /**
   * 学習テーマごとの「考え方」（ヒントの2段目）。`@ojt/content` の `PROBLEM_TAGS` と1対1。
   * 課題の答えではなく、その回路の型を思い出すための1行にする。
   */
  hintTag: {
    'self-hold': '自己保持は、コイルのa接点を押ボタンと並列に入れて、離しても電流を保ちます。',
    interlock: 'インタロックは、相手のコイルのb接点を自分の回路に直列に入れて同時動作を防ぎます。',
    timer: 'タイマは、コイルに電流が流れ始めてから設定時間が経つと限時接点が働きます。',
    'multi-timer': '多段タイマは、前のタイマの限時接点で次のタイマを動かして時間をつなぎます。',
    counter: 'カウンタは、数える接点と、数え直すための復帰の2つを分けて考えます。',
    priority: '優先は、先に入れたい側の接点を相手より前に置き、相手をb接点で切ります。',
    sequence: '順次動作は、前の段のコイルのa接点を次の段の条件にして順番を作ります。',
    flicker: '点滅は、2つのタイマで「点いている時間」と「消えている時間」を作って繰り返します。',
    alarm: '警報は、異常の条件でブザーを鳴らし、停止の押ボタンで切れるようにします。',
    'and-or': '接点の直並列は、直列が「かつ」、並列が「または」になります。',
    'fault-wire': '電線の故障は、両端の端子にテスターを当てて導通があるかで見分けます。',
    'fault-part': '部品の故障は、チェック用ソケットに挿し替えて、同じ動きが出るかで見分けます。',
    'fault-contact':
      '接触不良は、通電したまま電圧を測ると、つながっているはずの所に電圧が残ります。',
    measure: '測るときは、電源を切って導通を見るのか、通電して電圧を見るのかを先に決めます。',
  } satisfies Record<ProblemTag, string>,
  // --- /Phase 7 Task 25 ---
} as const;

// --- Plan 6 Task 8 ---
/**
 * 検索で当たった件数。
 * IM-12: `searchManual()` は `MAX_HELP_HITS`（20件）で打ち切るので、それより先にも
 * 当たりがあったとき（`capped`）は実際の件数のふりをせず「20件以上」と出す。
 */
export function helpHitCountText(count: number, capped: boolean = false): string {
  return capped ? `${String(count)} 件以上見つかりました` : `${String(count)} 件見つかりました`;
}
// --- /Plan 6 Task 8 ---

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

/**
 * モードの表示名（UXレビュー #15）。作業ファイルの `mode` は無ければ `assemble` とみなす
 * （`WorkFile.mode` の既定と同じ約束。§12.1）。
 */
export function sessionModeLabel(
  mode: 'assemble' | 'inspect-parts' | 'inspect-repair' | 'plc' | undefined,
): string {
  if (mode === 'inspect-parts') return JA.home.inspectParts;
  if (mode === 'inspect-repair') return JA.home.inspectRepair;
  if (mode === 'plc') return JA.home.plc;
  return JA.home.assemble;
}

/** 分の表示（`30分`）。 */
export function minutesLabel(minutes: number): string {
  return `${minutes}${JA.problemList.minutes}`;
}

/**
 * 電線の本数の表示（UXレビュー #21）。総数だけだと固定配線（チェック用回路の既設配線など）と
 * 見分けが付かないので、訓練者が張った本数と固定の本数を分けて示す
 * （`自分で張った電線 2 本（固定 3 本）`）。
 */
export function wireCountText(totalWires: number, fixedWires: number): string {
  return `自分で張った電線 ${String(Math.max(0, totalWires - fixedWires))} 本（固定 ${String(fixedWires)} 本）`;
}

/** 真偽値の信号表示（`ON` / `OFF`）。 */
export function signalLabel(value: unknown): string {
  if (typeof value === 'boolean') return value ? JA.session.on : JA.session.off;
  if (typeof value === 'number') return value.toFixed(2);
  return '—';
}

// --- Phase 7 Task 25 ---
/**
 * 信号名の表示名（指摘 UX-11）。`PL1` のような内部の名前ではなく、盤の色に合わせた
 * 呼び名（`白ランプ（PL1）`）にする。`@ojt/content` の表（チャートの信号名と同じ源）を引き、
 * 表に無い名前はそのまま返す。
 */
export function outputSignalLabel(signal: string): string {
  return OUTPUT_LABELS[signal] ?? PB_LABELS[signal] ?? signal;
}

/** 1行要約の差分の言い回し（`verdictMismatchText()` の型）。指摘 PR-03 */
export type VerdictMismatchKind = 'on' | 'off' | 'timing' | 'extra' | 'unknown';

/**
 * 1行要約のうち「何が起きたか」の1文（指摘 UX-13 / PR-03）。
 * `白ランプ（PL1）が 0.52 s に点きませんでした。` の形にする。
 */
export function verdictMismatchText(
  label: string,
  time: string,
  kind: VerdictMismatchKind,
): string {
  if (kind === 'on') return `${label}が ${time} に点きませんでした。`;
  if (kind === 'off') return `${label}が ${time} に消えませんでした。`;
  if (kind === 'timing') return `${label}が変わる時刻が ${time} からずれました。`;
  if (kind === 'extra') return `${label}に、模範回路には無い変化が ${time} に出ました。`;
  return `${label}は模範回路に無い信号です。`;
}

/** 1行要約のうち「静的チェックで止まっている」ことの1文。指摘 PR-03 */
export function verdictCheckText(title: string, detail: string): string {
  return `${title}が守れていません（${detail}）。`;
}

/** 1行要約のうち「最初にどこを直すか」の1文。指摘 PR-03 */
export function verdictFixFirstText(message: string): string {
  return `まず「${JA.result.suspects}」の1件目（${message}）を直してください。`;
}

/** ヒントを何段まで開いたか（`ヒントを使った回数: 2`）。指摘 PR-02 */
export function hintCountText(count: number): string {
  return `${JA.result.hintsUsed}: ${String(count)}`;
}

/** 同じ級の中での難しさ（`難しさ 3`）。§16 Phase 7 §4.3 */
export function difficultyLabel(level: number): string {
  return `${JA.problemListExtra.filterDifficultyLabel} ${String(level)}`;
}

/** 級の絞り込みの表示（3級には「おすすめ」を添える）。指摘 UX-19 */
export function gradeFilterLabel(grade: 1 | 2 | 3): string {
  return grade === 3 ? `${gradeLabel(3)}${JA.problemListExtra.recommended}` : gradeLabel(grade);
}
// --- /Phase 7 Task 25 ---

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

/**
 * 拡大できるチャート本体の読み上げ名（`タイムチャート（仕様）: クリックまたはEnterで拡大表示`）。§7.7
 *
 * `pickable` は `SchematicView` の `onPickCell` の有無（レビュー指摘 UI-14）。単クリックが
 * 「要素を選ぶ」に取られ拡大しない画面では、拡大の手段が違う旨を読み上げる。
 */
export function chartOpenerLabel(title: string, pickable: boolean = false): string {
  return `${title}: ${pickable ? JA.timeChart.openHintPicking : JA.timeChart.openHint}`;
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

/**
 * 端子リストの検索で1件も無いときの1行。UI監査 I9
 * 盤に印字された物理ID（`S1`）でも役割ID（`CR1`）でも探せることを添えて、
 * 「無言で0件」にしない（検索語をそのまま画面に出すので前後のかっこ以外はエスケープしない）。
 */
export function terminalNoMatchText(query: string): string {
  return `「${query}」に一致する端子がありません（盤の印字「S1」でも役割名「CR1」でも探せます）`;
}

/**
 * 表示しきれなかった疑いの件数（`ほかに 3 件あります。…`）。UXレビュー #28 / 決定表#27
 * `JA` の各ブロックは**値だけ**を持つ流儀なので、件数を埋める文だけを関数として外に置く。
 */
export function suspectMoreText(count: number): string {
  return `ほかに ${count} 件あります。まず上の指摘から直してください。`;
}

/**
 * 警告バナーの危険操作回数（`危険操作 3 回（減点）`）。§5.6 / 利用者の決定「警告表示＋回数記録」
 * UXレビュー #26: 「ミス」ではなく技能検定の用語「危険操作」に揃え、実技試験では
 * 減点対象になることを添える（このアプリの合否には影響しない。§17.2 #3）。
 */
export function mistakeCountText(count: number): string {
  return `${JA.result.mistakes} ${count} ${JA.result.times}${JA.result.mistakesSuffix}`;
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

/** 課題一覧の絞り込み後の件数（`12 件`）。UI監査 I17: 絞り込みに何件当たったかが無言だった。 */
export function problemCountText(count: number): string {
  return `${String(count)} 件`;
}

/** 丸数字（①〜⑳）。範囲外は `(21)` のようにかっこ書きに落とす。UXレビュー #6 */
function circledNumber(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${String(n)})`;
}

/**
 * 部品トレイ・マークシート・結果画面の部品表示。UXレビュー #6: 内部ID（`p1`）を
 * そのまま画面に出さず、`①リレー MY4N` のように番号＋型番で示す。番号はIDの末尾の連番
 * （`p1` → 1）から出す（`problem.parts` は常にこの並びで、番号は課題内で安定する）。
 * IDに連番が無い（`problem.parts` に無い部品IDなど）ときは番号を付けない。
 */
export function trayPartLabel(partId: string, isTimer: boolean): string {
  const match = /(\d+)$/.exec(partId);
  const name = isTimer ? `${JA.session.timer} H3Y-4` : `${JA.session.relay} MY4N`;
  if (match === null) return name;
  return `${circledNumber(Number(match[1]))}${name}`;
}

/** 部品種別の表示名（UXレビュー #6c）。操作ログに `relay-my4n` のような内部種別を出さない。 */
export function partKindLabel(kind: 'relay-my4n' | 'timer-h3y4'): string {
  return kind === 'timer-h3y4' ? `${JA.session.timer} H3Y-4` : `${JA.session.relay} MY4N`;
}

/**
 * 電線の表示名（UXレビュー #6b）。内部の電線ID（`sw-005` / `w-001`）をそのまま出さず、
 * 両端の端子と色から組み立てる（`CR1.9–PB1.2c の青線`）。
 */
export function wireLabel(wire: { from: string; to: string; color: string }): string {
  return `${wire.from}–${wire.to} の${wire.color}線`;
}

/**
 * 指摘の対象の表示（`端子 CR1.13` / `部品 CR2`、電線は `wires` が渡っていれば
 * `CR1.9–PB1.2c の青線`。渡っていない・見つからないときは電線IDへ後退する）。§9.2 / UXレビュー #6b
 */
export function reportTargetLabel(
  target: { wireId: string } | { partId: string } | { terminalId: string },
  wires?: readonly { id: string; from: string; to: string; color: string }[],
): string {
  if ('wireId' in target) {
    const wire = wires?.find((w) => w.id === target.wireId);
    return wire === undefined ? `${JA.session.wires} ${target.wireId}` : wireLabel(wire);
  }
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

// --- 3D fidelity 2026-09-19 ---
/**
 * 3Dの機器表示の文言（§6.1 / §6.5 / §8.2。利用者要望 2026-09-19）。
 *
 * ブレーカ・電源スイッチの ON/OFF 印字と銘板、リレー／タイマの動作表示に添える札。
 * 3Dの部品モジュール（`three/AcFixtures.tsx` / `three/PartIndicator.tsx` /
 * `three/MountedPart.tsx`）からだけ使う。
 */
export const JA_3D = {
  /** 励磁中（動作表示灯が点いている）ことを示す札。 */
  running: '動作中',
  /** 投入（ON）側の印字。 */
  on: 'ON',
  /** 開放（OFF）側の印字。 */
  off: 'OFF',
  /**
   * ブレーカの銘板。写真（654×552px）では銘板の文字が判読できないため、
   * §6.1 の「ブレーカ 1個・1A・AC一次側」と2極である点から起こした定格を印字する。
   */
  breakerRating: '2P 1A',
  /** タイマの電源表示灯（H3Y-4 相当）。 */
  timerPower: 'POWER',
  /** タイマの限時接点の動作表示灯（タイムアップ）。 */
  timerOut: 'UP',
} as const;
// --- /3D fidelity 2026-09-19 ---

// --- parts swap 2026-09-19 ---
/**
 * ソケットの部品カード（装着・取り外し・交換）の文言。§8.2
 * 利用者要望 2026-09-19「リレーやタイマはソケットから外して入れ替えたりできるようにすること」
 * 「分かりやすく直感的に操作できるUI、UXにしてね」に対応する。
 *
 * 押せないボタンには**必ず理由を日本語で添える**（UXレビュー指摘: 装着ボタンが理由も無く
 * 押せなかった）。`partsPanel.*Reason` がその文面で、ボタンの `aria-describedby` から指す。
 */
export const JA_PARTS = {
  /** 何も選んでいないときの案内（パネルの空状態）。 */
  hint: '3D 盤のソケット（または装着済みの部品）をクリックすると、装着・取り外し・交換ができます',
  /** カード見出しの接頭辞。 */
  socket: 'ソケット',
  /** 空きソケットの見出し。 */
  empty: '空',
  /** 装着部品の呼び名（見出し用。型番まで出して実機と結び付けやすくする）。 */
  relayName: 'リレー MY4N',
  timerName: 'タイマ H3Y-4',
  /** 交換を始めるボタン。 */
  swap: '交換…',
  /** 交換をやめるボタン。 */
  swapCancel: '交換をやめる',
  /** 交換する部品を選ばせる見出し。 */
  swapPrompt: '入れ替える部品を選んでください',
  /** 交換先を決めるボタン。 */
  swapTo: 'これに交換',
  /** 在庫切れで装着できない理由。 */
  noStockReason: 'この部品の在庫がありません。他のソケットから取り外すと戻ります',
  /** 交換できる部品が1つも無い理由。 */
  noSwapReason: '交換できる部品が在庫にありません。他のソケットから取り外すと戻ります',
  /**
   * 通電中の抜き差しについての注意。
   * エンジン（`board-model` の `unplug()` / `circuit-sim` の `unmountPart()`）は通電中の
   * 取り外しを**禁止しておらず、危険操作としても数えない**（`HAZARD_KINDS` に該当種別が無い）。
   * 仕様どおり操作は通すが、実機の手順（§5.3.5）を思い出せるよう注意書きだけ出す。
   */
  liveNote: '通電中です。実機ではブレーカを切ってから部品を抜き差しします',
  /** タイマを入れ替えると設定時間が初期値に戻ること。 */
  timerResetNote: 'タイマを入れ替えると設定時間は初期値に戻ります',

  // --- Phase 7 Task 27（指摘 UX-08 / 利用者要望9）: 部品パレット ---
  /** パレットの見出し。 */
  paletteTitle: '部品の在庫（つまんで盤のソケットへ運べます）',
  /** 在庫カードの操作説明（キーボード利用者の経路も残していることを書く）。 */
  paletteHint: 'カードを押してから盤のソケットを押しても装着できます',
  /** 運搬中のゴーストに添える文。 */
  paletteCarrying: '運んでいます',
  /** つまめない（在庫0）理由。 */
  paletteEmptyReason: '在庫がありません',
  /**
   * UX-08: 空状態を文章からソケット一覧のボタンに変える。押すと3Dのクリックと同じ
   * `setSelectedSocket` が走る。
   */
  socketListTitle: 'ソケットを選ぶ',
  /** 空きソケットの補足（ボタンの中に出す）。 */
  socketListEmpty: '空き',
} as const;

/** 部品カードの見出し（`ソケット S3: リレー MY4N（CR1）` / `ソケット S3: 空`）。§8.2 */
export function socketCardTitle(
  socketId: string,
  role: string | undefined,
  kind: 'relay-my4n' | 'timer-h3y4' | undefined,
): string {
  if (kind === undefined) return `${JA_PARTS.socket} ${socketId}: ${JA_PARTS.empty}`;
  const name = kind === 'relay-my4n' ? JA_PARTS.relayName : JA_PARTS.timerName;
  return role === undefined
    ? `${JA_PARTS.socket} ${socketId}: ${name}`
    : `${JA_PARTS.socket} ${socketId}: ${name}（${role}）`;
}
// --- /parts swap 2026-09-19 ---

// --- schematic quality 2026-09-19 ---
/** 回路図の拡大表示の倍率の読み上げ（`表示倍率 150%`）。§11.2 */
export function schematicZoomText(zoom: number): string {
  return `${JA.schematicView.zoomLabel} ${String(Math.round(zoom * 100))}%`;
}
// --- /schematic quality 2026-09-19 ---

// --- socket pin roles 2026-09-20 ---
/**
 * ソケットのピンの役割の言葉。設計仕様 §6.2 / §8.2。
 * 利用者要望 2026-09-20「リレーソケットの各番号はどこが何かわからないから分かるようにしてね」。
 *
 * 3Dソケットの面の印字（`three/labels.ts`）・端子のツールチップ（`three/Socket.tsx`）・
 * 部品カードのピン配列の図（`panels/SocketPinout.tsx`）の**3か所が同じ4語**を使う。
 * `NC` / `NO` / `接点a` のような言い換えは作らない（利用者の設計方針「統一された見た目」）。
 */
const PIN_GROUP_NAME: Readonly<Record<PinGroup, string>> = {
  nc: 'b接点',
  no: 'a接点',
  com: 'COM',
  coil: 'コイル',
};

/** ピンの役割まわりの文言。 */
export const JA_PIN = {
  /** 役割の大分類の呼び名。3か所で共有する。 */
  group: PIN_GROUP_NAME,
  /** 部品カードの図の見出し。 */
  legendTitle: 'ピン配列',
  /** 図の読み上げ（`role="img"` の代替テキスト）。 */
  legendAria:
    'ソケットのピン配列。番号ごとに b接点・a接点・COM・コイルのどれかを示し、コイルは 14 が P(+) 側、13 が N(−) 側',
  /** 「接点の組」の呼び名。 */
  pairs: '接点の組',
  /** ツールチップでの端子の呼び方（`端子5`）。 */
  pin: '端子',
  /** ツールチップの「組になる」。 */
  pairedWith: 'と組',
  /** 役割が割り当てられていないソケット。 */
  spare: '予備',
  /**
   * 母線の側の書き方。利用者指摘 2026-09-20
   * 「リレーソケットの13、14番の端子にコイルとしか書いてないがこれではどちらがPかNか分からない。
   * ランプも同様」。
   *
   * `+` / `−` だけでは**どちらの母線から来た線か**が伝わらないので、盤の母線の名前（`P` / `N`）と
   * 極性（`(+)` / `(−)`）を必ずセットで出す。この2語を、3Dソケットの面の印字・ランプ端子台の印字・
   * 端子のツールチップ・部品カードのピン配列の**4か所すべてで同じ形**で使う
   * （`session/socket-pins.ts` の `BusSide` が向きそのものを持つ）。
   */
  bus: { P: 'P(+)', N: 'N(−)' } as Readonly<Record<BusSide, string>>,
  /** 「P(+)側」の「側」。 */
  side: '側',
} as const;

/**
 * ピン番号の並びの書き方。連番が3本以上なら `1-4`、そうでなければ `13・14` のように並べる。
 * 番号そのものは盤定義（`SOCKET_PIN_GRID`）から来るので、ここで数を決め打ちしない。
 */
export function pinRangeText(pins: readonly number[]): string {
  const first = pins.at(0);
  const last = pins.at(-1);
  if (first === undefined || last === undefined) return '';
  const contiguous = pins.every((pin, index) => pin === first + index);
  return contiguous && pins.length > 2
    ? `${String(first)}-${String(last)}`
    : pins.map(String).join('・');
}

/** 部品カードの段見出し（`b接点 1-4` / `コイル 13・14`）。§8.2 */
export function pinGroupLabel(group: PinGroup, pins: readonly number[]): string {
  const range = pinRangeText(pins);
  return range === '' ? JA_PIN.group[group] : `${JA_PIN.group[group]} ${range}`;
}

/** 接点の組の一行（`接点の組: 1-5-9 / 2-6-10 / 3-7-11 / 4-8-12`）。§6.2 */
export function contactSetsText(sets: ReadonlyArray<readonly number[]>): string {
  return `${JA_PIN.pairs}: ${sets.map((set) => set.map(String).join('-')).join(' / ')}`;
}

/** 母線の側の印（`P(+)` / `N(−)`）。極性が無い端子は空文字。 */
export function busSideMark(side: BusSide | undefined): string {
  return side === undefined ? '' : JA_PIN.bus[side];
}

/** 「P(+)側」。文の中で母線の向きを言うときはいつもこの形。 */
export function busSideText(side: BusSide): string {
  return `${JA_PIN.bus[side]}${JA_PIN.side}`;
}

/**
 * 部品カードのコイルの一行（`コイル: 14 = P(+) / 13 = N(−)`）。利用者指摘 2026-09-20。
 * 番号は `session/socket-pins.ts` の `COIL_P_PIN` / `COIL_N_PIN` から渡す（ここで決め打ちしない）。
 */
export function coilPolarityText(pPin: number, nPin: number): string {
  return `${JA_PIN.group.coil}: ${String(pPin)} = ${JA_PIN.bus.P} / ${String(nPin)} = ${JA_PIN.bus.N}`;
}

/**
 * 端子のツールチップ（`S1 端子5: CR1 リレー MY4N の a接点（COM 9 と組）`）。§8.2
 *
 * 出すのは5つだけ: ソケットID・端子番号・挿さっている部品・役割・組になる相手。
 * 相手が**同じ仲間**（コイルの13と14）のときは役割名を繰り返さず番号だけにする
 * （`コイル（コイル 14 と組）` は同じ言葉が2回出て読みにくい）。
 *
 * コイル（⑬・⑭）だけは役割名のうしろに母線の側（`P(+)側` / `N(−)側`）を足す。利用者指摘
 * 2026-09-20「コイルとしか書いてないがこれではどちらがPかNか分からない」。
 */
export function socketPinTooltip(args: {
  socketId: string;
  pin: number;
  /** 役割ID（`CR1` / `T1` / `CHK`）。予備ソケットは undefined。 */
  role: string | undefined;
  /** 挿さっている部品の呼び名（`リレー MY4N`）。空きソケットは undefined。 */
  partName: string | undefined;
  group: PinGroup;
  /** 組になるピン（`session/socket-pins.ts` の `pinPartners()`）。 */
  partners: ReadonlyArray<{ pin: number; group: PinGroup }>;
  /** 母線の側（`session/socket-pins.ts` の `coilBusSide()`）。極性を持たないピンは undefined。 */
  busSide?: BusSide | undefined;
}): string {
  const owner = [args.role ?? JA_PIN.spare, args.partName]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  const pairs = args.partners
    .map((partner) =>
      partner.group === args.group
        ? String(partner.pin)
        : `${JA_PIN.group[partner.group]} ${String(partner.pin)}`,
    )
    .join('・');
  const tail = pairs === '' ? '' : `（${pairs} ${JA_PIN.pairedWith}）`;
  const side = args.busSide === undefined ? '' : ` ${busSideText(args.busSide)}`;
  return `${args.socketId} ${JA_PIN.pin}${String(args.pin)}: ${owner} の ${JA_PIN.group[args.group]}${side}${tail}`;
}

/**
 * 極性を持つ端子台のツールチップ（`TB_PL PL1+: 白ランプ PL1 の P(+)側`）。利用者指摘 2026-09-20
 * 「ランプも同様」。
 *
 * ランプ端子台（`TB_PL`）・ブザー（`BZ`）・DC24V供給端子（`P` / `N`）のように、
 * `+` と `−` しか書かれていない端子に「どちらの母線か」を添える。
 * ソケットのコイル（`socketPinTooltip()`）と**同じ語**（`P(+)側` / `N(−)側`）で終える。
 */
export function polarityTerminalTooltip(args: {
  /** 端子IDの部品側（`TB_PL` / `BZ` / `P`）。 */
  part: string;
  /** 端子台の印字の名前（`PL1+`）。 */
  mark: string;
  /** つながっている機器の呼び名（`白ランプ PL1`）。分からなければ undefined（印字で代える）。 */
  deviceName: string | undefined;
  side: BusSide;
}): string {
  const owner =
    args.deviceName === undefined || args.deviceName === '' ? args.mark : args.deviceName;
  // 機器そのものの端子（`PL1.+` → 印字 `PL1+`）は部品名が印字に含まれるので繰り返さない
  const head = args.mark.startsWith(args.part) ? args.mark : `${args.part} ${args.mark}`;
  return `${head}: ${owner} の ${busSideText(args.side)}`;
}

/** 極性を持つ機器の呼び名に使う言葉。 */
const JA_POLARITY_DEVICE = { lamp: 'ランプ', buzzer: 'ブザー' } as const;

/** ランプの呼び名（`白ランプ PL1`）。色も銘板も盤定義から来る。 */
export function lampDeviceName(color: string, panelLabel: string): string {
  return `${color}${JA_POLARITY_DEVICE.lamp} ${panelLabel}`;
}

/** ブザーの呼び名（`ブザー BZ`）。§5.3.4 の任意部品。 */
export function buzzerDeviceName(partLabel: string): string {
  return `${JA_POLARITY_DEVICE.buzzer} ${partLabel}`;
}
// --- /socket pin roles 2026-09-20 ---
