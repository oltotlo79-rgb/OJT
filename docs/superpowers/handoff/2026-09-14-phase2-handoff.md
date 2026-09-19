# Phase 2 引き継ぎ（2026-09-14 シャットダウン時点）

`briefs/` に Task 17 ブリーフ（`brief-2a-g.md`）のほか、D2/E/F14-16/F15 の実装ブリーフ、
停滞監視スクリプト（`longproc.sh`）、待機・監視メモ（`deferred.txt`, `agents.txt`）を同梱。

## 1. 状態

### Plan 2A（`docs/superpowers/plans/2026-09-14-phase2a-fault-content-and-judge.md`）

Task 1〜16 は着地済み（SHA）。

| Task | SHA |
|---|---|
| 1–2 | 52fe00c / 78eaff9 |
| 3, 5, 6, 8 | 1586cdd / 735330e / 7b6ee19 / 936fd96 |
| 4 | 4fc3e59 |
| 7 | 6ae1a3d に混入（共有インデックス競合で巻き込まれた） |
| 9 | b54c927 |
| 10 | 48254b8 |
| 11 | bc0afd0 |
| 12 | ebeb9cb（+ 36e57aa ハザード修正、b9f57d4 ドキュメント） |
| 13 | 46e79c4 |
| 14 | 6c43b88 |
| 15 | 32025e0 |
| 16 | d204a48 |

レビュー修正: e5c9237 / 2bb24d3（テスター）、715f915 / 8635cab（C+D1 項目1・2）。

**Task 17 は未着手**（ブリーフ: `briefs/brief-2a-g.md`）。

### Plan 2B（`docs/superpowers/plans/2026-09-14-phase2b-fault-desktop.md`、rev 8812998）

- Task 2〜3 は着地済み（f8905a2, 28283e8）
- Task 1・4 は Task 17 のバレルエクスポート待ちでブロック中

### その他

- VIEW-NAV: 836942a / 6ae1a3d で着地
- Phase-1 ポリッシュ: b398d5c / 56bb96b / 45f7ae3

### テストベースライン

content 32 files / 409、desktop 28 files / 469、circuit-sim 214、board-model 155、root ≈1300、E2E 9/9。

## 2. 次にやること（順番）

**a) C+D1 レビュー修正の残り項目3〜5**（`briefs/deferred.txt` 記載どおり）
- random-faults の clone 化・fallback 検証・`fellBack`・`maxMillis` 追加
- M3〜M6
- プランドキュメントへの行追加

**b) Task 17（ブリーフ参照）を、D2+E+F+修正の Opus レビュー1本と並行実施**
- レビュー対象: Task 9, 10, 12, 14, 15, 16 ＋ 715f915 / 8635cab ＋ テスター修正
- プローブ一覧は `briefs/deferred.txt` 参照

**c) Task 17 完了後: Plan 2B Task 1→4 を直列（Opus）**
- プランの「実装者への MERGE 注意」と「推奨バッチ」に従う
- その後 Batch 2（5+6 / 9 / 13 を並行 Sonnet、7 は Opus）
- Batch 3（8→10→11）
- Batch 4（12→14→15→16）
- Batch 5（17）
- Batch 6（18 E2E + パッケージアプリ受け入れ §14.3 / §16）

## 3. 運用ルール

- サブエージェント駆動で実装する
- バッチごとに Opus レビュー1本（並行する独立グループはそれぞれ1本）
- コミットは `git commit --only -- <paths>` を使う（共有インデックス競合が2回発生: 6ae1a3d が Task 7 のファイルを巻き込んだ）
- 停滞監視は10分毎の cron + `briefs/longproc.sh`
- 実装完了率は固定の重みで報告する: 1A 8 / 1B 5 / 1C 5 / 1D 12 / P2 15 / P3 20 / P4 15 / P5 15
  （前回報告: 約40%、レビュー確定分は約33%）
- ビジュアルは適宜提示する（scratchpad `view-nav/` のスクリーンショットはユーザーに送付済み）

## 2026-09-17 追記（第2回中断）

- リモート `origin` を追加し `main` を push 済み。
- Plan 2A Task 17 は b12caed として部分着地: バレルが Phase 2A の全面を re-export、
  `mode` の typo に起因するスキーマ問題1件を修正、デスクトップ側
  `content-loader.ts` が `isAssembleProblem` を import。
- content の 409 テストおよび `pnpm -r typecheck` はグリーン。
- Task 17 の残項目、および未着手の C+D1 修正項目3〜5は `briefs/deferred.txt` に記載。
- Plan 2B の Task 1・4 はブロック解除済み。
- 次の指示: Task 17 残作業 + 修正項目3〜5 を並行実施 →
  D2+E+F+修正+Task 17 をまとめて Opus レビュー1本 → Plan 2B Task 1→4。
- 各バッチ後に `main` を push する。

## 2026-09-17 追記（第3回中断・Plan 2A 完了）

- Plan 2A 全17タスク着地、Opus レビュー確定（後半レビュー APPROVED WITH MINOR ISSUES →
  修正 f487356 / fb09e13 / cbb288a / f16717b 着地）。
- 検証: `pnpm -r test` 102 ファイル / 1345 テスト、typecheck・lint・prettier 合格、
  coverage circuit-sim 98.91/93.80/100/99.89・content 98.52/96.44/100/99.75。
- 次の作業: Plan 2B Tasks 1→4（Opus 直列、MERGE 注意を厳守、`store.ts` の
  `sessionForProblem` を `SupportedProblem` に広げる、`judgeInspectRepair` は
  0.2〜0.45秒なので Worker 内で実行）→ Batch 2〜6。
- 各バッチ着地ごとに `main` を push する。
- 詳細は `briefs/deferred.txt` 末尾を参照。

## 2026-09-18 追記（第4回中断・Plan 2B Task 1 着地）

- Plan 2B Task 1 着地 3c6a8db（課題一覧に内蔵20題をモード付きで表示、`SessionMode`・
  `ProblemSummary.mode`・`readProblem → SupportedProblem | null`、C1/C2 は一覧に出るが
  開始は未対応トーストで保護）。
- 暫定ガードは `ProblemList.tsx` と `session/work-file.ts` の2か所にあり、
  Task 4 Step 10 で両方外す。
- desktop 29 ファイル / 474 テスト、typecheck・lint・prettier 合格、E2E とビルドは未実行。
- 次の作業: Task 4「ストアを3モードへ広げる」（計画 L1427–2176、Step 1 の
  `apps/desktop/test/store-inspect.test.ts` から）→ Tasks 1–4 の Opus レビュー1本 →
  Batch 2。
- 詳細は `briefs/deferred.txt` 末尾を参照。
- 2026-09-18 00:38 追記: Task 1 着地後の検証（3c6a8db）— desktop build PASS、E2E 9/9 合格。

## 2026-09-18 追記（第5回中断・Plan 2B Batch 1 レビュー確定、CHART-UX 完了）
- Plan 2B Tasks 1〜4 着地: 3c6a8db / f8905a2 / 28283e8 / b00f512。
- Opus レビュー → CHANGES REQUIRED → 修正 098d10e / ad21b19 / 63c9321 / 4bbf54f /
  b78dd54 / 840e85f でレビュー確定。
- Task CHART-UX（タイムチャートのクリック拡大と縦の補助線）: 2aea5d3 / 53d378a。
- Opus レビュー → APPROVED WITH MINOR ISSUES → 修正 ec0aae7 / 4fd6e1c / 572f943 で
  レビュー確定。
- desktop 541 単体テスト、typecheck・lint 合格。最終 E2E（HEAD 572f943）: build
  PASS、11/11 合格（chart.spec.ts の b-007 テストが1回 TimeoutError で flaky、
  Playwright 自動リトライで合格）。
- 次の作業: Plan 2B Batch 2 = Tasks 5+6（テスターパネル デジタル/アナログ）/ 9
  （C1 マークシート）/ 13（C2 指摘パネル）を Sonnet 並列 + Task 7（3D プローブ・
  警告バナー・導通ブザー）を Opus → Opus レビュー1本。
- Task 17（作業ファイル）ではストアの `resolvedFaults` を保存すること。
- フォローアップ: 拡大チャートのキーボード操作（←/→ でスナップ点移動）と背景
  inert、chart E2E のシナリオ分離。
- 完了率: 生点 = 30 + 15×完了タスク/35 …、表示 = 生点 ÷ 0.95（現在 39.0 →
  約41%、レビュー確定分も約41%）。

---

## Phase 2 受入（2026-09-18）

受入担当（別エージェント）が §14.3 / §16 の手順で実施した。対象 HEAD は `a81b8ac`
（機能の最終は `5099709`）。

### 判定: **REJECTED**（ブロッカー1件。受入基準そのものはビルド成果物では全て成立）

**ブロッカー**: `apps/desktop/scripts/copy-content.mjs:23` の `MODES` が Phase 1 のまま
`['assemble']` なので、`predist` が C1（4題）と C2（8題）を `resources/content/` へ複写しない。
配布版の `builtinSet()`（`src/main/content-loader.ts:71-82`）は `app.isPackaged` のとき
`resources/content` を読み、**1題でも読めれば焼き込み `BUILTIN_ALL_PROBLEMS` に落とさない**ため、
パッケージ版の課題一覧は **8題（モードBのみ）** になる。読込エラー欄にも何も出ない（無言の欠落）。

再現: `pnpm --filter @ojt/desktop dist` → `release/win-unpacked/OJT電気保全トレーナー.exe` を起動 →
ホームの「部品点検」/「回路点検・修復」を押すと「絞り込みに一致する課題がありません。」。
`window.ojt.listProblems()` は `{assemble: 8}` を返す。
→ §16 Phase 2 受入基準 ①②③ が配布版では実行できない。

修正: `MODES` に `'inspect-parts'` / `'inspect-repair'` を足す（1行）。あわせて
`apps/desktop/test/content-resources.test.ts`（assemble しか見ていない）を3モードに広げ、
`builtinSet()` に「読めた数が `BUILTIN_ALL_PROBLEMS` より少なければ警告を出す」防御を入れる。

### 実施した検証

| 項目 | 結果 |
|---|---|
| `pnpm --filter @ojt/desktop test` | 60ファイル / 825テスト 合格 |
| `pnpm -r test` | 全プロジェクト合格（**1964テスト**: circuit-sim 244 / ladder-core 109 / plc-dialects 37 / board-model 180 / schematic-core 64 / content 505 / desktop 825）。受入の開始時点では content の `test/plc-reference.test.ts`（当時は未追跡の Phase 3A 作業中ファイル）だけが赤だったが、Phase 3A 側が `src` を着地させて解消した |
| `pnpm typecheck` | 全プロジェクト合格 |
| `pnpm --filter @ojt/desktop dist` | NSIS 106.8MB / zip 146.8MB / `win-unpacked` 371.5MB。`app.asar` 4.09MB、中身は `out/**` と `package.json` のみで `node_modules` 0件（Phase 1 と同じ） |
| リポジトリ E2E（ビルド成果物） | **17/17 合格**（約1.4分） |
| §16 ①〜⑤（受入側の独自スクリプト、ビルド成果物） | **全て合格**。①赤PB（PB4）を押しっぱなしで導通レンジを見ると正常品は `OL`→`導通` に反転（吸引）、コイル断線は押しても `OL` のまま、レアショートは正常に吸引。コイル抵抗 650.0 / `OL` / 422.5。②マークシートで「コイル断線」「レアショート」を選ぶと合格。③c2-001 で2箇所を指摘し白線で修復 → 合格。④通電のままΩ → 警告バナー＋結果に「1 回」。⑤保存 → アプリを閉じる → 再起動 → 読込で指摘2件と白線が復元 |
| 2級C2の回路図トグル | 既定で閉、開ける、結果画面に「回路図を開いた回数: 1」、作業ファイルにも保存される |
| クラッシュ復帰（C1/C2） | 一時保存 → SIGKILL → 再起動で「復元する」が出て復元。「復元しない」で `autosave.json` が消え次回は出ない。確認に答えず課題を開くと確認が引っ込む |
| 設定の往復 | 音 ON/OFF・音量・復元確認 OFF（次回起動で確認が出ない）・利用者フォルダ変更で一覧が読み直される |
| 利用者フォルダ | 無いときはパス付きの案内。壊れた `.json` はファイル名と理由付きで読込エラー欄に出て、内蔵20題はそのまま。利用者が書いた C1・C2 の JSON が読まれ、モード絞り込みから開ける（計22題） |
| 壊れた `.ojtw` | `formatVersion: 2` →「このファイルは新しいバージョンで作成されています」、`mode: "plc"` →「作業ファイルのモードが読めません」、`reports` 201件 →「作業ファイルの項目が多すぎます」、途中で切れた JSON →「ファイルを読めませんでした: …」、5MB超 →「作業ファイルが大きすぎます」。いずれも落ちない |
| 絞り込み・ホーム | 「すべて」「回路組立」「部品点検」「回路点検・修復」が効き、PLC カードは無効。`listMode` は 一覧→ホーム→一覧 で保たれる |
| オフライン | 配布版でモードB b-001 を最後まで（合格）実行するあいだ http(s) 要求は 0 件。`index.html` の CSP は `default-src 'self'`、`electron-builder.yml` は `publish: null` |
| 性能 | C2 判定 **295ms**（10分連用後でも **270ms**。目安の1秒以内）。何も動かさない待機時の CPU は全プロセス合計 **0.8%**。C2 を10分間連続で操作（回路図開閉・中ドラッグ回転・指摘の出し入れを約180周）してもメモリは 803MB → 927MB で、途中で何度も下がる（暴走はしない）。数値は E2E と同じ `--use-gl=swiftshader`（ソフトウェア描画）での測定なので、GPU のある実機より重く出る。60fps／三角形20万以下の達成は Phase 5 の受入事項 |

**実物のOSダイアログ（保存／読込）は自動化できない**ため、`dialog.showSaveDialog` /
`showOpenDialog` を固定パスへ差し替えて IPC の往復だけを確かめた（リポジトリ E2E と同じ流儀）。

### Phase 3 で拾う所見（ブロッカー以外）

1. **テスターのプローブ位置が作業ファイルに入らない**。`session/work-file.ts:101` の
   `savedTester()` は `kind` / `mode` / `voltRange` / `ohmRange` / `zeroAdjusted` だけを保存する。
   §12.3 は「テスター状態」を保存すると書いており、§9.3 のプローブ配置もその一部。復元直後の
   読値が `----` になり、訓練者はプローブを置き直す必要がある（つまみと 0Ω調整は正しく戻る。
   置き直せば 650.0Ω で、未調整の 682.5Ω にはならない）。
2. `builtinSet()` が配布版の同梱課題を「1題でも読めたら採用」する設計なので、今回のような欠落が
   無言で通る。件数の食い違いを §13 #1 の読込エラー欄に出すこと。
3. 受入は `apps/desktop` に一切手を入れずに行った。§16 の文言を**パッケージ版へ**当てる
   受入スクリプト（`_electron.launch({ executablePath })` で `win-unpacked` の exe を起こす）は
   受入担当の作業フォルダにしか無い。ブロッカーを直したら、赤PBの吸引（①）と2級C2の回路図
   トグルは `apps/desktop/e2e/` 側にも取り込むとよい（いまのリポジトリE2Eは赤PBを押していない）。
4. スクリーンショット（1280×800、DPI 2倍で 2534×1530）は受入担当の作業フォルダ
   `scratchpad/phase2-acceptance/shots/` に15枚。

---

## Phase 2 再受入と v0.2.0 リリース検証（2026-09-19）

別エージェントが `packages/content` を編集中だったため、受入は専用ワークツリー
`C:\Users\oltot\Documents\git-projects\OJT-wt-release`（ブランチ `release/v0.2.0`）で実施した。

### 判定: **ACCEPTED**

2026-09-18 のブロッカー（`copy-content.mjs` の `MODES` 固定）は解消済みで、配布版の課題一覧は
**28題すべて**（B8 / C1 4 / C2 8 / D8）を読込エラー0件で読む。§16 Phase 2 受入基準 ①〜⑤ は
**パッケージ版（`win-unpacked` の exe）に対して**全て成立した。

### 対象 HEAD

`3fb0724`。内訳は main の `b2c292c` に以下を積んだもの:

| コミット | 内容 |
|---|---|
| `780d928` | `chore(desktop): bump version to 0.2.0`（受入担当が作成） |
| `268b3f6` | main の `63c89ec` を取り込み（内蔵課題数 20→28、`resources/content/plc/` 8件を追跡）。予め `predist` が同内容のファイルを生成していたため cherry-pick ではなくパス指定で適用した（生成物と commit の8ファイルはバイト一致を確認済み） |
| `3fb0724` | main の `33460bd` を cherry-pick（`LadderNetworkSchema` が派生キー `rows`/`cols` を許容し、PLC課題がJSON往復で壊れなくなる） |

### 実施した検証

| 項目 | 結果 |
|---|---|
| `pnpm -r test` | **2082テスト 全合格**（circuit-sim 244 / ladder-core 109 / plc-dialects 46 / board-model 180 / schematic-core 64 / content 584 / desktop 855） |
| `pnpm -r typecheck` | 全プロジェクト合格 |
| `pnpm lint` | 合格（指摘0件） |
| リポジトリ E2E（`out/` のビルド成果物）×2回 | 1回目 19/19（1件 flaky＝`capturePage()` の既知 `UnknownVizError`、再試行で合格）／2回目 19/19 一発合格。各 約1.5分 |
| `pnpm --filter @ojt/desktop dist` | 成功。NSIS `電気教育ツール-0.2.0-x64.exe` 112,098,745バイト（約106.9MB）、ポータブル `電気教育ツール-0.2.0-x64.zip` 153,960,503バイト（約146.8MB）、`win-unpacked` 372MB |
| `win-unpacked/電気教育ツール.exe` | 存在する（246,070,272バイト） |
| `resources/content/` | `assemble` 8 / `inspect-parts` 4 / `inspect-repair` 8 / `plc` 8 = **28件**（`predist` が正本のフォルダを走査して複写） |
| `app.asar` | 4,348,582バイト。中身は `out/**`（main・preload・renderer）と `package.json` の**12エントリのみ**で `node_modules` は**0件** |
| **配布版に対する §16 ①〜⑤** | **全て合格**（`e2e/*.spec.ts` を `executablePath` だけ差し替えて `win-unpacked` の exe に当てた）。19/19（1件 flaky＝同じ `UnknownVizError`、再試行で合格）。①赤PB（PB4）押下中だけa接点が導通、正常品 650.0Ω／コイル断線 `OL` ②レアショート 422.5Ω＋マークシートで「レアショート」を選んで正解 ③C2 故障2箇所を指摘し白線で修復して合格 ④通電中のΩで警告バナー＋結果に「1 回」 ⑤白線を張って保存→閉じて起動し直して読込むと復元 |
| 配布版スモーク（受入担当の独自スクリプト） | 5/5 合格。ウィンドウ題名・ホームとも **電気教育ツール**。`window.ojt.listProblems()` は `{assemble:8, inspect-parts:4, inspect-repair:8, plc:8}` で **`errors: []`**。利用者フォルダの既定は `C:\Users\oltot\AppData\Roaming\電気教育ツール\content`。b-001 / c1-001 / c2-001 はいずれも3D盤を描画 |
| console エラー | **0件**（起動〜一覧〜3課題の描画まで） |
| オフライン | http(s) 要求 **0件** |
| プローブ位置の復元 | `01c4dea` で実装済み。`work-file-inspect.test.ts` / `work-files.test.ts` の単体テストで往復を確認（855テストに含まれる） |

### v0.2.0 の既知の制限

1. **モードD（PLC）にデスクトップUIがない**（Plan 3B で実装予定）。配布版での見え方は次のとおりで、
   **クラッシュも真っ白も起きない**:
   - ホームの「PLC」カードは**無効（押せない）**まま。
   - ただし課題一覧の絞り込みを「**すべて**」にすると **d-001〜d-008 の8行が出て、「開く」ボタンが
     押せてしまう**。押すと「**課題が選ばれていません。**」と「**課題一覧へ**」ボタンだけの画面に
     行き止まる（`readProblem` は返るが、セッション画面がモードDを描けないため）。戻る導線はある。
   - 本受入ではこれを**許容できる行き止まり**として扱い、v0.2.0 の既知の制限として記録する。
     Plan 3B でモードDのUIを入れるか、それまで一覧からモードDを隠すかのどちらかで解消すること。
2. 実物のOSダイアログ（保存／読込）は自動化できないため、`dialog.showSaveDialog` /
   `showOpenDialog` を固定パスへ差し替えてIPCの往復だけを確かめた（前回の受入と同じ流儀）。
3. コード署名はしていない（§15 の方針どおり）。SmartScreen の回避手順は配布時に案内すること。

### 配布成果物

| ファイル | サイズ（バイト） | SHA256 |
|---|---|---|
| `電気教育ツール-0.2.0-x64.exe`（NSIS） | 112,098,745 | `EBE4B3F28ECA0B64D7CF89B9C9F704473AF25784EFC8483154A99D79A91B388F` |
| `電気教育ツール-0.2.0-x64.zip`（ポータブル） | 153,960,503 | `67E11E364427DFFCF66EE0EA63425D424116E0C8787615F693898B0168553E4C` |

複写先: `C:\Users\oltot\Documents\git-projects\OJT-release\v0.2.0\`
（複写元 `apps/desktop/release/` とSHA256一致を確認済み）

スクリーンショット（1280×800、DPI2倍で 2534×1530）は受入担当の作業フォルダ
`%TEMP%\p2-reaccept\shots\` に50枚。配布版スモークのぶんは `p01-home.png` /
`p02-home-modes.png` / `p03-problem-list-all.png`（モードDの8行が見える） /
`p04-mode-d-opened.png`（行き止まりの画面） / `p05-b-001.png` / `p06-c1-001.png` /
`p07-c2-001.png` の7枚。
