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

## Phase 3 完了（2026-09-19）

Plan 3B「PLC (モードD) デスクトップUI」の Task 1〜18 が全て `main` に着地し、Task 18「全体検証と仕上げ」を完了した。バージョンは**上げていない**（`0.2.0` のまま）。タグも `dist` も実施していない。

### 対象 HEAD

`6304577`（Task 18 のプラン／本ハンドオフ追記コミット直前。着地済みの主なコミット: `ebd87d0` E2E受入基準カバレッジ・`d02f842` 既定11列でラダーが通電しない不具合の修正・`fbe802b` Plan 3B の E2E 追加。この後に `docs(plan-4a)` / `docs(plan-4b)` のドキュメント専用コミットが積まれているが本作業は未変更）。

### per-package テスト件数（`pnpm -r test`、2026-09-19 実測）

| パッケージ | ファイル数 | テスト数 |
|---|---|---|
| `@ojt/circuit-sim` | 28 | 244 |
| `@ojt/board-model` | 16 | 180 |
| `@ojt/schematic-core` | 4 | 64 |
| `@ojt/content` | 44 | 601 |
| `@ojt/ladder-core` | 8 | 115 |
| `@ojt/plc-dialects` | 5 | 46 |
| `@ojt/desktop` | 82 | 1117 |
| **合計** | **187** | **2367** |

`@ojt/desktop` は `--no-file-parallelism` でも同じ 82ファイル/1117テストが全通過。`pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` ＋ `react-hooks`）は無警告。Prettier チェック（`apps/desktop/**/*.{ts,tsx,css}` と `packages/**/*.{ts,json}`）も両方 `All matched files use Prettier code style!`。

### カバレッジ（`pnpm -r test:coverage`、v8、2026-09-19 実測。しきい値は各 `vitest.config.ts` で lines/statements/functions/branches とも90%）

| パッケージ | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `@ojt/circuit-sim` | 99.07% | 93.25% | 100% | 99.9% |
| `@ojt/ladder-core` | 99.56% | 94.77% | 100% | 100% |
| `@ojt/plc-dialects` | 99.15% | 95.19% | 100% | 100% |
| `@ojt/board-model` | 97.19% | 91.36% | 100% | 98.69% |
| `@ojt/schematic-core` | 100% | 98.37% | 100% | 100% |
| `@ojt/content` | 97.67% | 93.64% | 99.23% | 98.87% |

6パッケージすべてが90%しきい値を超過（vitestのcoverageゲートはエラーなしで完走）。**`@ojt/desktop` は `vitest.config.ts` に `coverage` 設定が無く、`test:coverage` スクリプトも定義されていない**ため計測対象外（Phase 1〜2から変わっていない既存の状態。Task 18の完了条件・Plan 3B本文にもdesktopのカバレッジしきい値の記載は無い）。

### ビルドとE2E

- `pnpm --filter @ojt/desktop build`: `out/main` / `out/preload` / `out/renderer` の3つを出力（成功）。
- `pnpm --filter @ojt/desktop e2e`: **1回目 23/23 pass（2.0分）／2回目 23/23 pass（2.2分）**。flakeなし。内訳: `chart.spec.ts` 2・`inspect.spec.ts` 8・`navigation.spec.ts` 5・`plc.spec.ts` 4・`polish.spec.ts` 3・`smoke.spec.ts` 1 = 23本（プラン本文の見積り「既存17＋4」は「既存19＋4＝23」に実測で訂正。`chart.spec.ts` の拡大表示2本が Task 17着手後に追加landしたぶん）。

### PLCスクリーンショット（`apps/desktop/screenshots/`。E2E実行のたびに再生成される生成物。`.gitignore`済みでリポジトリには入れない）

| ファイル | 内容 |
|---|---|
| `30-plc-ladder.png` | ラダーを組んだところ（`F5`/`F7`でX0・Y0を配置） |
| `31-plc-wired.png` | 配線後の3D（PB端子台→X0、Y0→CR1.14など） |
| `32-plc-monitor.png` | モニタ（`F3`）で通電しているセルの表示 |
| `33-plc-result.png` | 合格の結果画面 |
| `34-plc-twostage.png` | ④ `twoStage` エラーの結果画面 |
| `35-plc-power.png` | ⑤ `plcPowerIndependent` エラーの結果画面 |

### 既知の逸脱（プラン記載どおりに`packages/`が無変更ではない）

Task 1開始点（`33460bd`）からHEADまでに `packages/` へ15ファイルの変更がある。うち12ファイルは Plan 3A側の並行レビュー修正4コミット（`580981e` / `57e4404` / `9e0a358` / `2e9ea24`。本プランの対象外）。残り3ファイル（`packages/ladder-core/src/edit.ts` / `src/index.ts` / `test/edit.test.ts`）は本プランのバグ修正コミット `d02f842`（既定表示列数11でラダーが決して通電しない不具合。`fillHlinesToCoil()` を純関数として追加し、コイルを置いた時点で左の論理と自動的につなぐ）。詳細はプラン本文の完了条件・改訂履歴を参照。

### 画面文言の集約（§15）に関する既知の例外

`apps/desktop/src/renderer/ladder/` の新規部品はすべて `JA`（`i18n/ja.ts`）経由であることを確認した。一方で次は `JA` を経由しない独立テーブルのまま: `screens/Settings.tsx` の `VENDOR_LABELS`（Task 16で新設、メーカー4社の固有名詞）、および Phase 1/2から既存の3D印字テーブル（`three/ViewGizmo.tsx` の軸ラベル、`three/Fixtures.tsx`/`three/BoardScene.tsx` の端子台名、`three/Socket.tsx` の「予備」、`WIRE_COLORS` のキー名）。いずれもテスト・lint・buildには影響しない（ゲートは全グリーン）。

### 既知のフォローアップ

- Plan 3B/4Aの改訂履歴に記載済みの差分・意図的な仕様逸脱（本プラン「仕様からの意図的な差分」表の10件。§10.1のPLC設置角度、§10.6のオンライン書込み・`Shift+F3`・`Ins`挿入モード、§10.7の表記切替・命令語エクスポート未実装、§10.3の表示列数、§12.2のプリセット8種、§8.2の元に戻すスタック分割、§10.8の未使用デバイス表示のみ、§12.3のテスター状態省略）。
- **UXパス（利用者の必須要望、未着手）**: リレー・タイマの通電を示す可視インジケータ、取り外し/差し替えの発見しやすさ、split-pane幅1280px、課題一覧の「入出力点数」列、M9サイドバーのネストしたスクロール領域の解消。
- 画面文言の集約の既知の例外（上記）を`JA`へ寄せるかどうかの判断（固有名詞・物理銘板の印字は対象外という前例を踏襲するか、`VENDOR_LABELS`だけでも寄せるか）。

### 次のステップ

Plan 4A（`docs/superpowers/plans/2026-09-19-phase4a-dialects-and-plc-models.md`）と Plan 4B（`docs/superpowers/plans/2026-09-19-phase4b-vendor-skins-and-3d.md`）がドキュメント専用セッションで起票済み（他社方言・PLCユニット/ラック機種・ベンダースキン・3D外観）。次のセッションはこの2本のプランのレビュー確定後、実装タスクの着手から始める。

---

## Phase 4〜6 の記録（2026-09-19〜20）

### 1. 概要

Phase 3 完了（`6304577`）から続けて、Phase 4〜6 を無停止で実施した。

- **Plan 4A**（`packages` のみ、14タスク）: OMRON CP1E・JTEKT TOYOPUC PC10G-1SP・シャープ JW300 の3方言プロファイル、表記切替（IR無改変）、命令語リストのエクスポート、`PlcUnitSpec` の点別コモン化、4機種の `PlcAppearance`（外観記述）、ラック形3D の土台、4機種でのモードD開始、静的チェックの機種非依存化。全14タスク**確定**。
- **Plan 4B**（`apps/desktop` のみ、14タスク）: 4社スキン（見た目・操作フロー）、設定でのメーカー選択、表記切替ダイアログ、命令語リスト保存（IPC 7本目）、`PlcAppearance` からの3D描画、ラックの3D、機種追随カメラ、4機種 E2E。**Task 1–12 確定**、Task 13–14 は Plan 5 Batch E レビューにぶら下がり修正中。
- **Plan 5**（回路図エディタ・検算・配線ガイド・性能・配布 v1.0.0、16タスク）: 編集可能な回路図（純関数層＋SVG編集）、`verifySchematic()` による机上検算、疑わしい配線、配線ガイドの相互ハイライト、端子リストによるキーボード配線、性能計測窓・端子インスタンス化・テクスチャ共有、配布パッケージの v1.0.0 化（**タグ付け・公開はしていない**、利用者の明示指示待ち）。**Task 1–13 確定**、Task 14–16（＋ Plan 4B Task 13–14）は合同レビューで CHANGES REQUIRED、修正中。
- **Phase 6**（取扱説明書とアプリ内ヘルプ、12タスク）: 正本を `docs/manual/*.md` の1つにし、`buildManual()` がアプリ内ヘルプ（`manual-content.ts`）と印刷用 HTML/PDF を同じ呼び出しから生成、一致検査をバイト一致で機械的に保証。ヘルプ引き出し（もくじ・検索・`F1`）、PDF 同梱（IPC 8本目 `manual:open`）、文体・用語・機能網羅の検査。**Task 1–8 landed**（A+Bレビューで CHANGES REQUIRED、修正中）、**Task 9 実行中**、Task 10–12 未着手（Task 12 = スクリーンショット撮影は全UX直し後・最新ビルドから最後に行う）。

### 2. 着地一覧

#### Plan 4A（`packages` のみ、全14タスク）

| Task | 主な SHA | レビュー状況 |
|---|---|---|
| 1–2 方言共通土台／OMRON CP1E | `b15a7a8` / `5cf0030` / `780d21f` | 確定（Batch A+B） |
| 3–5 JTEKT／シャープ／4方言登録・横断不変条件 | `77ec4bd` / `1e594ea` / `81c701a` | 確定（Batch A+B） |
| 6 表記切替 | `231cc89` | 確定（Batch A+B） |
| 7 命令語リストのエクスポート | `d721b23` | 確定（Batch A+B） |
| 8–9 `PlcUnitSpec` 点別コモン化／`PlcAppearance`・CP1E本体 | `a43da95`（9は共有ツリー競合で `38d9fe6` に混入） | 確定（Batch C） |
| 10 TOYOPUC ラック | `11e102e` | 確定（Batch C） |
| 11 JW300 ラック・機種横断検査 | `5aac828` | 確定（Batch C） |
| 12 4機種でモードD開始 | `388cef9` | 確定（Batch D） |
| 13 静的チェックの機種非依存化 | `c7d8582` | 確定（Batch D） |
| 14 クロス検証・公開API確定 | `5384a68` | 確定（Batch D） |

レビュー修正: `172253c`/`293bc1d`/`15d1603`（Batch A+B）、`f3855be`（Batch C）、`e6cbdc1`/`964cbc0`（Batch D）。21:02 に「PLAN 4A ALL 14 CONFIRMED」。

#### Plan 4B（`apps/desktop` のみ、全14タスク）

| Task | 主な SHA | レビュー状況 |
|---|---|---|
| 1–5 スキン層・見た目・`LadderWorkspace`・回路入力・方言別欄 | `933ad71`/`d8c61f9`/`399c1e7`/`c624c90`/`51e3b67` | 確定（スキン系、fix `ccc919e`/`9f2ab4b`/`9650fc4`/`96cb8c9`） |
| 6–7 設定で4社選択／既定機種で開く | `50e3a19`/`456d6d9` | 確定（Batch B、fix `31e57dc`/`be2652c`） |
| 8–9 表記切替ダイアログ／命令語リスト保存 | `740b593`/`cc12977` | 確定（Batch C、fix `63f8e35`/`53d948f`＝「Tasks 1-12 all confirmed」） |
| 10–12 `PlcUnit` 描画／`PlcRack`／カメラ機種追随 | `238a47f`/`28af3be`/`46eb5d7`/`7c0e9d7` | 確定（3D系、fix `555796d`/`98a7574`/`5b8368e`） |
| 13 4機種 E2E | `a585055` | Plan 5 Batch E レビュー対象、修正中 |
| 14 全体検証・仕上げ | `fb2e11a` → 再検証 `ed02b86` | 同上。完了条件に但し書き数件（§6参照） |

#### Plan 5（回路図エディタ・検算・配線ガイド・性能・配布 v1.0.0、全16タスク）

| Task | 主な SHA | レビュー状況 |
|---|---|---|
| 1–3 編集操作・スロット矩形／検算／疑わしい配線 | `f6c40ec`/`fbe4251`/`eb57bae` | 確定（Batch A、fix `973c662`/`19bd5e6`） |
| 4–7 純関数層＋手順帯／編集できる回路図／検算往復／モードB組込 | `1edd04c`/`1e714c9`/`be4b284`→`36a0034`（復元）/`5662cb7` | 確定（Batch B、fix `450f907`/`16f328e`/`0710853`） |
| 8–10 配線ガイド／結果の疑わしい配線／端子リスト配線 | `4821098`/`9abc0a8`/`63ae00a` | 確定（Batch C+D、fix `57519f7`/`c975d75`） |
| 11–13 `PerfProbe`／端子インスタンス化／印字テクスチャ・机上ケーブル共有 | `5fac4a5`/`6127870`/`34a785f` | 確定（Batch C+D、同上） |
| 14 配布パッケージ固め（v1.0.0） | `9dcfb8c` | Batch E: CHANGES REQUIRED、修正中 |
| 15 E2E（受入基準①〜④＋#28/#29＋オフライン） | `4ca3726`/`40de7d9` | 同上 |
| 16 全体検証 | `ed02b86` | 同上 |

Batch E（Task 14–16 ＋ Plan 4B Task 13–14 合同）レビュー: **CHANGES REQUIRED**（Blocking 3・Important 5・Minor 8）。修正エージェント（Opus、`OJT-wt-e2e` の唯一のビルド担当）が対応中。

#### Phase 6（取扱説明書とアプリ内ヘルプ、全12タスク）

| Task | 主な SHA | レビュー状況 |
|---|---|---|
| 1 機能一覧の抽出 | `e8bb4b6` | landed、A+Bレビュー対象 |
| 2 Markdown変換・生成物 | `de5676b` | 同上 |
| 3 説明書 前半6章 | `7d20da5` | 同上（文言はIM項目、Task5で修正済み） |
| 4 説明書 後半7章 | `1f93421`（`80f0750` は amend事故で混入。§5参照） | 同上 |
| 5 文体・用語・機能網羅の検査 | `491a483` + `cfcf506` | 確定（`cfcf506` で A+Bレビュー IM-1〜7 反映） |
| 6 ヘルプの純関数層 | `cc02ba3` | 確定 |
| 7 PDF生成・8本目のIPC・配布同梱 | `c0a47ea` | landed、BL-1（`print-manual.mjs` 終了コード）修正待ち |
| 8 ヘルプの引き出し | `2e15052` | landed、IM-11/IM-12（IME・スクロール）修正待ち |
| 9 全画面からの導線と `F1` | （作業中。git status に未コミット差分あり） | **実行中** |
| 10 コードの表と説明書の一致 | 未着手 | 未着手 |
| 11 E2E と全体検証 | 未着手 | 未着手 |
| 12 スクリーンショット撮影・吹き出し（**プラン最後**） | 未着手 | 未着手 |

Phase 6 A+B 統合レビュー（Task 1–4・6–8 対象）: **CHANGES REQUIRED**（Blocking 1・Important 12・Minor 14）。文言系の指摘は Task 5（`cfcf506`）へ反映済み。コード系の指摘（BL-1・IM-9〜12・Minor）は修正エージェントが対応中（未コミット、`git status` の `HelpDrawer.tsx` / `help-model.ts` / `ja.ts` / `print-manual.mjs` / `manual-build.mjs` 等がこれ）。

### 3. 利用者の決定と規則（2026-09-19/20）

- 製品名は**電気教育ツール**（Phase 3 で改名済み、継続）。
- **タグ付け・`gh release create` は利用者の明示の指示があるまで実行しない**（v0.2.0 は誤読で公開してしまったため pre-release のまま維持。v1.0.0 は成果物とリリース手順チェックリストまでを用意し、公開はしていない）。
- **トークン節約で週次上限までに完了させる**方針を継続（モデル選択: 機械的作業= Haiku、逐語プラン実行・指定済み修正= Sonnet、レビュー・計画・判断= Opus）。
- **画面の品質は受入基準そのもの**: 装飾的・冗長な要素を作らない、要素どうしの重なりを作らない、平易な日本語（専門用語なし）、デザイン品質そのものを完了条件に含める（Plan 4B/5 の「画面の品質」節、UI監査の5点満点評価）。
- **図記号の参照元**: 三菱は e-sysnet「PLC入門」第6回（利用者指定、`https://e-sysnet.com/plc-6/`）ほか計7件を `docs/reference/ladder-skin-sources.md` に一覧化（画像・図記号ビットマップは複製せず、記述だけを取った）。§17 により**ベンダー画像は1つも持たない**（renderer に画像ファイル・base64・外部URLが無いことをgrepで確認）。
- **説明書とアプリ内ヘルプは同一の正本から生成**（`buildManual()` が両方を書き出し、`manual-sync.test.ts` がバイト一致で保証）。**画像は実際の画面を撮った実写のみ**で、**全実装・全UX直しが終わったあとに最新ビルドから最後に撮影**する（Phase 6 Task 12、決定表 P13）。2026-09-20 追記でヘルプ本文にも図（幅400px縮小版→押すと原寸）を出すことに決定。
- **完了率の計算式を改訂**: 従来の raw 重み合計95（1A8/1B5/1C5/1D12/P2 15/P3 20/P4 15/P5 15）÷0.95 に、**Phase 6 の重み8を追加し合計103、÷1.03** に変更。個別タスクの分母は Phase4=28（4A14+4B14）・Phase5=16・Phase6=12。本記録時点の確定タスク数は本節の着地一覧のとおりで、最終的な表示%の算出は次回セッションの担当に委ねる（**前回報告した数値を下回らないこと**が既存ルール）。

### 4. UI 監査

`apps/desktop/e2e/ui-quality.spec.ts` が窓 1280×800 / 1440×900 / 1920×1080 の3サイズで **68状態 × 3 = 204枚**を撮り、機械点検（重なり・小さすぎる文字/当たり判定・変な改行・3D上の重なり・同名操作の重複）と目視を行った（対象 `origin/main` = `e13195b`）。

- **1424件検出、うち致命133件**。overlap 521・small-text 268・small-target 234・wrap 220・hud-overlap 103・duplicate 78。clip/page-overflow/focus/canvas は0件。overlap・wrap・small-text の約8割がモードDに集中。デザイン評価は**総合2.8/5**（モードD 1280×800 は1点＝格子が潰れて編集不能）。
- 4本の修正バッチに分割し並行実施:
  - **バッチA（3Dビューポート）**: `76a71af`。ビューキューブとラベルの重なり解消。
  - **バッチB（回路図エディタ）**: 本来は独立コミットの予定だったが、Phase 6 Task 4 の amend事故で **`80f0750`**（表面上は「docs(manual): write chapters 7-13」）に混入して着地（§5参照）。
  - **バッチC（パネル・結果・一覧・設定）**: `46b4972`。
  - **バッチD（モードD＋日本語改行）**: `340b2d9`。`plc-run`/`monitor-run`/`plc-auto-convert` の testid を削除したため、参照していた E2E 3本が赤くなった（Plan 5 Batch E レビュー B2、§6参照）。
- **再ベースライン（`BASELINE`/`BLOCKING_BASELINE=133`の再測定）は未実施**。4バッチ後の実測が `ui-quality.spec.ts` の基準値に書き戻されておらず、Plan 5 Batch E の修正エージェントが再実行・書き戻しを担当する。

### 5. 共有ツリーの事故と規則

Phase 4〜6 は作業ツリーを複数エージェントで共有しており、次の3件の事故が起きた。

1. **`git commit --amend` が他エージェントの staged 内容を飲み込んだ**: Phase 6 Task 4（`docs(manual): write chapters 7-13`）のエージェントが amend した際、並行していた UI監査バッチBの回路図エディタ修正がその commit に混入した。結果として `80f0750` は**マニュアル原稿だけでなくスキーマ/コード修正も含む誤ラベルのコミット**になっている（内容自体は失われていない）。以後の `git log` 読み取りではこの点に注意。
2. **`git commit -- <paths>` が working tree の内容を巻き込む**: パスを指定した `git commit` は、指定パスに**未ステージの他エージェントの変更**が乗っていると、それも一緒に取り込んでしまう（"foreign hunks" を sweep する）。
3. **autostash 付き rebase が着地済みの変更を消した**: Plan 4B Batch B の修正エージェントが `git pull --rebase`（autostash）を実行した際、直前に着地していた Plan 5 Task 6（`be4b284`「回路図の机上検算を Worker で実行」）が古い内容に巻き戻され、`be2652c` として着地してしまった。`36a0034`「回路図の机上検算を復元」で復旧を確認済み（Git reconciler エージェントが origin 上の両バッチの無事を再確認済み）。

**現在の規律**:
- `git stash` / `git commit --amend` / autostash 付き rebase / 他人の変更の unstage は使わない。
- index に自分以外のパスが混じっているときは `git commit --only -- <paths>` を使う（`--only` を落とすと事故2と同じことが起きる）。
- ステージ前に `origin/main` と比較し、自分の差分だけかを確認する（`git diff --cached --stat`）。
- 作業ツリーが fast-forward できない（他エージェントが同じファイルを大きく書き換え中）ときは、`git format-patch` でパッチ化 → 使い捨ての worktree で `origin/main` を checkout → 適用 → commit → push する。
- ビルド・E2E・dist は汚染されていない専用 worktree（`OJT-wt-shots` / `OJT-wt-release` / `OJT-wt-e2e`）でのみ行う。共有ツリー（main tree）では `pnpm -r test` 等の再実行結果が他エージェントの未コミット編集で時々刻々変わるため、正としない。

### 6. 未了・申し送り

- **Plan 5 Batch E レビュー**（Blocking 3・Important 5・Minor 8）: B1 性能予算が「俯瞰」1視点でしか測られていない（正面・ソケット拡大も回す）／B2 消えた testid 3箇所（`plc-vendors.spec.ts:244` の `plc-auto-convert`→`plc-hint`、`plc.spec.ts:357-358` と `ui-quality.spec.ts:1502` の `plc-run`→`toolbar-plc-run`）／B3 `ui-quality.spec.ts` の `BASELINE` 未再測定（§4の再ベースラインと同一）。Important: `docs/releases/v1.0.0.md` が Phase 6 の同梱（ヘルプ/PDF）と food違う（I1）、README にヘルプ/PDFの言及が無い（I2）、オフライン検査が renderer のリクエストしか見ていない（I3）、同梱課題数が下限のみで等号縛りでない（I4）、`plc-vendors.spec.ts` の `finally` が例外を握り潰す（I5）。現在 `OJT-wt-e2e` で修正中（唯一のビルド許可エージェント）。
- **Plan 4B Task 14 の完了条件の未チェック**: `apps/desktop/package.json` の依存が「1つも増えていない」の文字どおり未達（`markdown-it` 1件、Phase 6 Task 2 由来。意図的な追加）／画面文言の網羅監査が未実施／`packages/` 無変更の確認は監査当時のみ有効（直後に他エージェントが `schematic-core` を編集開始）。
- **Plan 5 Task 16 の未チェック箱**: typecheck/lint は worktree 再確認で緑（`i18n/ja.ts` が未コミット `socket-pins.ts` を import していたのが原因、Phase 5 側で解消済み）だが、**`dist`・実機60fps・実機オフライン確認は未実施**（ハードウェアが必要で委任範囲外、リリース手順チェックリスト 5〜8 待ち）。8px格子から外れたCSS 7宣言（`schematic/**` / `panels/view-hint.module.css`）と、JSDoc内のURL参照7件（`ladder/skins/*.ts`）は `docs/reference/ladder-skin-sources.md` へ移設済みなので後者は解消済みのはず（要再grep）。
- **Phase 6 Task 10（コードの表と説明書の一致）で踏みそうな既知の食い違い**: `apps/desktop/src/renderer/i18n/ja.ts` の `JA.ladder.shortcutNote`「キー割当はメーカー（**方言プロファイル**）ごとに切り替わります。」が内部設計語（`DialectProfile`）を利用者向け文言に露出させている。Task 5 の禁止語検査は原稿側しか見ないため、Task 10 の `manual-appdata.test.ts` で初めて表面化する可能性が高い。
- **`80f0750` は誤ラベルのコミット**（§5事故1）。表題は「docs(manual): write chapters 7-13」だが、実際には UI監査バッチBの回路図エディタのコード修正も含む。`git log --stat` で中身を確認してから扱うこと。
- **`docs/スクリーンショット*.png` は `.gitignore`（ルート `.gitignore:14`）済み**。Phase 6 Task 12 が撮る `docs/manual/images/` はこのパターンに当たらない別ディレクトリなので、gitignoreの対象外であることを撮影前に確認する（`apps/desktop/screenshots/` は別途 `apps/desktop/.gitignore:3` で無視）。
- その他、`deferred.txt` 末尾（2026-09-18 16:00 以降の項目）に残る細目: instruction-list.ts の印刷用レイアウト未実装（§10.7）、3D分割ビューでのボード縮小、SwiftShader初回フレーム遅延、47-instruction-listショットのグリッドずれ、suspect-noteが5件表示時に折り返し外、いずれも致命ではなく次の画面品質パスで拾う。

### 7. 再開手順

1. 共有ツリー（main tree）は現在 `origin/main`（`46b4972`）と同じだが、**未コミットの Phase 6 差分**（Task 9 の導線工事、A+Bレビューのコード修正）が乗っている。これらを完成・commit してから次に進む。
2. ビルド・E2E・dist は専用 worktree で行う: `OJT-wt-shots`（スクリーンショット用）／`OJT-wt-release`（配布検証用）／`OJT-wt-e2e`（Plan 5 Batch E の唯一のビルド担当が使用中）。新規に worktree を切るときは `git worktree add ../OJT-wt-<用途> origin/main --detach` を基本形にする。
3. 基本コマンド: `pnpm --filter @ojt/desktop build`（main/preload/renderer）、`pnpm --filter @ojt/desktop e2e`（Playwright、2回連続グリーンを確認）、`pnpm --filter @ojt/desktop dist`（NSIS＋ポータブル、`release/artifacts.md` を確認）。
4. レビュー・監査の記録は `%TEMP%\plan5-cd-review\REVIEW.md`／`%TEMP%\plan5-e-review\REVIEW.md`／`%TEMP%\phase6-ab-review\REVIEW.md`／`%TEMP%\ui-audit\REPORT.md`（+ `findings.json`/`summary.json`）にある。コーディネータの監視メモは `scratchpad\monitor\agents.txt`（全エージェントの結果表）と `deferred.txt`（積み残し）。
5. **次の着手順序**（本記録時点）:
   1. Phase 6 Task 9（全画面導線＋`F1`）を完了させる（実行中）。
   2. Phase 6 A+Bレビューのコード修正（BL-1・IM-9〜12・Minor）を完了させる（実行中）。
   3. Plan 5 Batch E の修正（B1〜B3・I1〜I5）を完了させ、`ui-quality.spec.ts` の `BASELINE` を書き戻す。
   4. Phase 6 Task 10（コードの表と説明書の一致）→ Task 11（E2E・全体検証）。
   5. Plan 5 Batch E ＋ Phase 6 A+B の**合同再レビュー**（C/Dレビューと同じ1本化方針）。
   6. 全画面のUX直しが揃った状態で Phase 6 Task 12（スクリーンショット撮影・吹き出し。**最新ビルドから最後に**）。
   7. Phase 4〜6 全体の受入（§14.3 相当）→ 実装完了率の再計算・報告。
