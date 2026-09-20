# Phase 7（v1.1.0）引き継ぎ書 — Codex 向け

**作成**: 2026-09-20 21:45（Claude 側の利用上限が近づいたため作業を Codex へ引き渡す）
**最終更新 2026-09-20 23:00（全タスク着地後）**
**対象リポジトリ**: `C:\Users\oltot\Documents\git-projects\OJT`（製品名 **電気教育ツール**。機械保全技能検定 電気系保全作業の訓練ツール。Electron 44 / React 19 / R3F / three.js、pnpm モノレポ、TypeScript strict）
**現在地**: **修正タスク 28 / 41 完了**（`origin/main` = `4931275` 時点）
**この文書の役割**: Codex（単独エージェント。シェルのみ。サブエージェントなし）が、以降の Phase 7 を最後（v1.1.0 リリース）まで独力で進められるようにするための資料。

---

## いま何が起きているか（3行）

1. **41タスク中 28本が `origin/main`（先端 `4931275`）に着地済み**（Tasks 1〜22・25・27・29・30・32・33・34 ＋ 赤直しコミット `48ebe88`）。**進行中のタスクは1本も無く、`%TEMP%\wt-task*` の作業 worktree はすべて削除済み**。
2. **次にやること（この順）**: §F の **B+C レビュー修正バッチ**（Codex の最初の仕事） → **D+E レビュー（Tasks 13〜22）＋その修正バッチ** → **`origin` に残る E2E の赤4件**を潰して `pnpm e2e` を緑に戻し ui-quality の基準値を測り直す → **README/CONTRIBUTING §6 の嘘の訂正** → Task 23→24→26 / 28 / 31 / 39→40→41 → **F+G レビュー＋修正バッチ** → Task 35→36 → 37 → **38（v1.1.0 リリース）**。
3. **共有ツリー `C:\Users\oltot\Documents\git-projects\OJT` は古い（STALE）**。読むだけに使い、作業は必ず `origin/main` から切った**新しい worktree** で行うこと（§D.3）。

---

## 0. 最初に読むもの（この順）

| # | ファイル | 何が書いてあるか |
|---|---|---|
| 1 | 本書 | 指示・到達点・残りの手順・作法・報告形式 |
| 2 | `docs/superpowers/plans/2026-09-20-phase7-review-fixes.md`（1,880行程度） | **41タスクの実施プラン**。前提A〜E、実装バッチ、各タスクの Files / Steps / 期待、MERGE 注意、完了条件、Task 29 実施メモ、改訂履歴 |
| 3 | `docs/superpowers/specs/2026-09-20-phase7-review-fixes-design.md`（1,038行） | 設計。§2 決定表、§3 指摘174件のトリアージ、§4 課題拡充、§5 純正ツール再現、§6 説明書、§7 3D直接操作、§8 ビューキューブ、§9 版数、§11 受入基準①〜⑧ |
| 4 | `CONTRIBUTING.md` | 規約一式。**§9 がリリース手順**（Task 38 はこれをなぞる） |
| 5 | `docs/superpowers/PROJECT-LOG.md` | Phase 1〜6 の通史（Task 33 で旧 phase2-handoff から改名） |
| 6 | `docs/reviews/2026-09-20-project-evaluation.md` | 外部評価レポート（**未追跡ファイル。絶対に `git add` しない**）。プランはこれに答えるもの |
| 7 | `docs/manual/*.md` + `docs/manual/coverage.json` + `shots.json` | 取扱説明書の正本（バッチHで触る） |

補助: `docs/reference/ladder-skin-sources.md`（方言スキンの出典表）、`docs/releases/v1.0.0.md`（前回リリースの雛形。**編集禁止**）。

---

## A. 利用者の指示（原文）

### A.1 Phase 7 の依頼（2026-09-20、v1.0.0 リリース直後）

利用者の依頼（要旨。逐語は設計 §1.2 に全文がある）:

1. `docs/reviews/` に外部レビュー結果があるので、**妥当なものを評価して対応せよ**。
2. **課題数が少ない**。各モードにもっと多く・より複雑な課題を足せ。
3. 各メーカーの **PLC 入力画面が簡素すぎる**。各社ソフトの画面設計と仕様に忠実に再現せよ（例: F5 = a接点）。
4. **インストーラのライセンス画面が文字化け**している。
5. **説明書 PDF とヘルプ引き出しが読みにくい**。体裁を作り直せ。
6. **PDF のもくじを押したらその節へ飛ぶ**ようにせよ。
7. **機能ごと・課題ごとのチュートリアル章**（手順を1歩ずつ）を足せ。
8. **3D のビューキューブが俯瞰から正面へ回り込めない**。
9. **UI/UX 刷新**。3D 盤の直接操作（ブレーカ/スイッチをクリックで入切、部品をソケットへドラッグ、端子クリックで配線）で、**説明を読まなくても使える**ようにせよ。
10. **説明書の図と本文は全部の修正が終わったあとに最後に撮り直す**こと。
11. 進み具合を残したい（→ PR-14 結果の1枚書き出し）。
12. **終わったら新しいバージョンをリリースして**。

### A.2 引き継ぎの指示（2026-09-20 21:45、逐語）

> 「claudeのリミットが近づいてきたのでここからはCodexに作業を依頼する。今の作業を切りのつくところまで実装し作業を中断して…codex用にmdファイルで引き継ぎ書を作成して。私からの指示や今何を実装しているか、今後どのような実装を進める予定だったか。ここから完了までの詳細なタスクと流れなど具体的で詳細な資料にすること」

### A.3 常設の規則（すべて拘束力がある）

| # | 規則 | 根拠 |
|---|---|---|
| R1 | **製品名は「電気教育ツール」**（画面に出る名前だけ）。内部の `@ojt/*` スコープ、リポジトリ名、`.ojtw` 拡張子、識別子は変えない | 2026-09-19 利用者指示 |
| R2 | **各社のロゴ・アイコン・画面キャプチャ・マニュアル本文を複製しない**（本体仕様 §17）。使ってよいのは**公開資料から読み取った寸法比・キー割当・用語だけ**で、出典は `docs/reference/ladder-skin-sources.md` に記す。スキンの表題は必ず「〜風」で終える。参照画像（`docs/スクリーンショット 2026-09-20 010528.png` など）は**コミットも同梱もしない** | 本体仕様 §17 / 2026-09-20 利用者指示 |
| R3 | **明示の指示なしにタグ付け・GitHub Release・公開物の作成をしない**。ただし **Phase 7 の最後の v1.1.0 リリースは、利用者要望12「終わったら新しいバージョンをリリースして」によって明示的に許可されている**（Task 38 のみ） | 2026-09-19 の誤リリース事故 + 2026-09-20 要望12 |
| R4 | **報告の最後は必ず「修正タスク X / 41 完了」**の1行で締める。X は `origin/main` に着地したタスク数 | 2026-09-20 利用者指示 |
| R5 | **トークン節約**。作業中は影響のあるテストファイルだけを走らせ、全体（`pnpm verify`）は最後に1回。余計な探索読みをしない | 2026-09-20 17:00 利用者指示 |
| R6 | **タスクが1つ終わるたびに `origin/main` へ着地（push）させる**。「完了」＝ origin に載っていること | 2026-09-20 18:50 利用者決定 |
| R7 | **説明書の図と本文の最終更新（Task 36）は全修正の後に1回だけ**。新しいビルドから撮り直す | 利用者要望10 |
| R8 | **UI/UX の質は受入条件**。意味のない装飾を置かない／要素が重ならない／無効なボタンは理由を日本語で言う／内部識別子（`w-003`, `n1` など）を画面に出さない／ボタンは 32px 以上／1280×800 ではみ出さない | 2026-09-20 01:30 利用者指示ほか |
| R9 | 迷ったら**選択肢つきで利用者に質問**する（自由記述で聞かない） | 利用者の運用方針 |

### A.4 2026-09-20 の利用者決定（5件。プラン改訂履歴・設計 決定表 D17）

1. **内蔵課題は 72 題**（モードB 20 / C1 12 / C2 20 / D 20）。→ Task 13・18 で達成済み。
2. **ビューキューブは上下・左右とも反転**＝「**盤が指に付いてくる**」向き。→ Task 19 で達成済み。
3. **`sandbox: true` を有効化**し、配布物でも有効であることを確かめる。→ Task 8 で達成済み。
4. **盤の名札は 12px 相当以上**（本体仕様 §8.2・§12 は改訂済みなので、実装を合わせるだけ）。→ Task 24 Step 2・Task 26。
5. **PR-12 / PR-13 / PR-14 を採用**し **Task 39 / 40 / 41** とする。**N は 38 → 41**。

### A.5 過去の事故から来る禁止事項（共有ツリーでの git 事故が3回起きている）

- `git stash` / `git stash pop`（並行作業を消した）
- `git reset --hard` / `git checkout -- .` / `git clean`
- `git commit --amend`（他人のコミットを付け替えた）
- `git rebase --autostash` / `git pull --rebase --autostash`
- 自分が触っていないファイルの `git add` / `git restore --staged`
- `git add -A` / `git add .` / ディレクトリ単位の `git add`
- blob 注入（`git hash-object` + `git update-index --cacheinfo`）

Codex は単独エージェントなので並行衝突は起きにくいが、禁止事項はそのまま有効である。**共有ツリーには Task 27 の実装が未コミットのまま残っている**（中身は `7f92edb` として origin に着地済みだが、`git clean` や `checkout -- .` で消すと確かめようがなくなる）。また `docs/reviews/`（未追跡）は1文字も変えてはならない。
**唯一の例外**: §D.3 の共有ツリー realign は `git reset --hard origin/main` を使う。**利用者の明示の許可を取ってから**、退避 patch を2本取ったうえで行うこと。

---

## B. 現在の到達点

### B.1 41タスクの状態一覧

状態の意味: **着地** = `origin/main` にコミットがある／**未着手**。
**2026-09-20 23:00 時点で「進行中」のタスクは1本も無い**（21:45 時点で走っていた 22・25・27・30・34 はすべて着地し、各タスクの `%TEMP%\wt-task*` worktree は削除済み。§B.3）。

| # | 題名 | バッチ | 状態 | 主な逸脱・申し送り |
|---:|---|---|---|---|
| 1 | インストーラのライセンス表示の文字化け | A | 着地 `18a4917` `2b9bee5` `cfb3815` | 改行コード保持を追加。インストーラのライセンス画面を目視確認済み |
| 2 | モードDのラダー編集の4つの罠 | B | 着地 `fe2cf1e` | — |
| 3 | 方言の誤変換と「嘘の案内」 | B | 着地 `d1c20ba` | — |
| 4 | 課題スキーマ（難易度・タグ）と検証CLI | C | 着地 `c7eb950` | 検証CLIは `node --experimental-transform-types`（tsx を使わない）／`judgeAssemble`・`judgeReference` を `SchematicProblem` に拡張／テストは `schema-common`・`schema-faults` に置いた／validator は約40秒かかる／Task 10 からの CT-13 を取り込み |
| 5 | 課題データが黙って別物になる経路 | B | 着地 `704762f` | — |
| 6 | 盤の経路と3Dの取り違え | B | 着地 `454b31e` | — |
| 7 | 押せない理由・嘘の案内・内部識別子 | B | 着地 `6a3e679` `cfb3815` | — |
| 8 | Electron のハードニング | C | 着地 `9df8ef1` | `sandbox: true` 有効化。**`grantFileProtocolExtraPrivileges: true` は意図的に残す**（理由をコメント済み。Task 31 で消さないこと） |
| 9 | main の入口検査と書き込みの安全性 | C | 着地 `5f62f9b` | `safeFileName` を新規 `src/shared/safe-file-name.ts` に置いた（Task 41 が再利用）／`MAX_USER_PROBLEM_FILES` は全件成功か全件失敗／深い入れ子のテストは `schema|invalid-json` のどちらも許容／DM-6 のテストは実際の EPERM を使う／`coverage.json` に2行追加、`manual-content.ts` 再生成 |
| 10 | エンジンとランタイムの防御 | C | 着地 `834593e` | CT-13 は Task 4 へ移管 |
| 11 | 共通シェルの切り出しとストアの分割 | C | 着地 `8985278` | 公開面（`useStore` の型）は不変。Task 12 への申し送りは当該コミットの本文にある |
| 12 | 死にコード・二重管理・未使用文言の掃除 | C | 着地 `2f73341` | JAキー17件削除＋`i18n-keys` テスト新設／DW-3 は Task 15、CT-09 は Task 18、3D-13/14/18/20 は Task 17 が実施／**未了**: 未使用の `TerminalHit` コンポーネント削除と `camera.ts` の `MIN_POLAR_ANGLE_RAD`（Task 19 が使い始めた）の後始末 → **D+E 修正バッチで回収**／落とし穴: `git commit --only` が作業ツリー版を拾う |
| 13 | 課題の拡充（B +12 / C1 +8） | D | 着地 `d47dae0` | 48題時点。resources 再生成済み |
| 14 | エンジンの無駄と仕様の訂正 | D | 着地 `b67c2d3` | `routeWire()` に任意の `RouteOptions.channelById` と WeakMap メモ化を追加／`buildTraversals` の `channelById` は `ReadonlyMap` |
| 15 | 描画側の性能 | D | 着地 `9e1e666` `a7684bf` | **ライブチャートは間引かず**端点保存の切り詰め（`MAX_LIVE_POINTS = 2000`）／`PlcSnapshot.poweredCells` を廃し `runtime.poweredCells` に／プリセットのキャッシュは worker ローカル／DW-3 完了 |
| 16 | 性能の門（先にこれを直さないと測れない） | D | 着地 `c6ac739` | 実測 50,364 三角形 / 309 ドローコール、予算 200k / 340 |
| 17 | 3D の資源解放とドローコール | D | 着地 `3bf8015` `d44e67a` | ドローコール 309 → **186**／`TerminalHit` コンポーネントが未使用に（削除候補。Task 27 の後に処理） |
| 18 | 課題の拡充（C2 +12 / D +12） | D | 着地 `db313e1` `370edbb` `2fa491d` | **72題完成**（content 900テスト）／`c2-020` は `{random:{count:3}}`（`Array.isArray` 分岐あり。再生は work file の resolved faults を読む）／CT-09 もここで実施 |
| 19 | ビューキューブの回り込み | E | 着地 `b257f03` | 原因は符号と `minPolarAngle`。**俯瞰→正面は「上へ約105px ドラッグ」**／**設計 §8.2 の原因仮説は誤り・§8.3 の判定条件は幾何学的に成立しない → 訂正文を書く必要がある（D+E 修正バッチ）**／面直プリセットは `MIN_POLAR_ANGLE_RAD` ぶん傾けない（P.1/N.1 を拾えるようにするため） |
| 20 | 純正ツールのキー割当 | E | 着地 `f52d449` | plc-dialects 246テスト／**説明書のモードD「F8」記述と `coverage.json` の F8 行の修正は Task 22 へ申し送り** |
| 21 | 回路入力（記号とデバイスの入れ方） | E | 着地 `62c988b` | E2E `ladder-entry` 5/5 を2回／**`manual-appdata.test.ts` が赤 → Task 22 で解消予定** |
| 22 | ウィンドウ構成とモニタ表示 | E | 着地 `cbe9f17` `30a316e` | **`manual-appdata` と `i18n-keys` は緑になった**（Task 21 由来の赤と B+C レビュー I2 を解消）／逸脱: **監視ペインはツールバーから開く**（`Shift + F3` は4方言とも「モニタ（書込）」なので使わなかった）／`SkinTheme.statusItems` を廃し `statusItemsOf(profile)` に／`ResizeObserver` の横に resize リスナを残した／Task 20 からの申し送り（説明書モードDの「F8」本文と `coverage.json` の F8 行）は実施済み ／**Task 36 へ**: `plc-ladder.png`（記号バー＋モードチップ＋灰色の未変換注記）と `plc-monitor.png`（デバイス一覧の見出し・`■`/`□` 列・通電枠・監視ペインとボタン）を撮り直し、`Shift + ?` オーバーレイの図を1枚足す |
| 23 | 色とトークン、色だけの符号化の廃止 | F | 未着手 | C.3 参照 |
| 24 | アクセシビリティと画面の一貫性 | F | 未着手 | C.3 参照 |
| 25 | 学習導線と結果画面の「次の一手」 | F | 着地 `4931275` | desktop 2,710テスト／`verdictSummary(result: VerdictInput, suspects?) -> { source, text, fix }`（`result/verdict-summary.ts`、純関数。**Task 41 がこの形で再利用する**）／ヒントは `store-ui.hintStage`（0〜3、`maxHintStage(grade)`）／逸脱（F+G レビューで見る）: `ProblemSummary` に `difficulty`/`tags` を追加（`shared/ipc.ts`）、`hints.texts?` はスキーマに足さず自動生成（`hintStages()` は与えられれば `texts` を優先）、`mismatchSentence()` を `ja.ts` から削除、`APP_STATE_KEY_COUNT` 148→150 |
| 26 | 文字とUIの大きさ・高コントラスト | F | 未着手 | C.3 参照 |
| 27 | 3D盤の直接操作 | F | 着地 `7f92edb` | E2E `direct-manipulation` 5/5 を2回／性能 50,044三角形 / 186ドローコール／逸脱（F+G レビューで見る）: **`setPointerCapture` は使わない**（OrbitControls が canvas を捕まえるため）、**`Wire.tsx` は触っていない**（配線のピック本体が端子のホバーを奪うため）、**電源入切は `pushCommand()` に載せていない**（復元が無通電で読み直すため）、**満杯の端子は断らない**（terminal-overload ハザードを残すため）、`TerminalHit.tsx` ではなく `TerminalField.tsx` を編集した |
| 28 | 初回ガイド（3分ツアー） | F | 未着手 | C.4 参照 |
| 29 | CI と検査の死角 | G | 着地 `88cf1d4` | `pnpm verify` 新設、CI ワークフロー追加／**カバレッジ実測 Lines 84.24 / Statements 82.59 / Functions 82.50 / Branches 80.36**（プラン末尾「Task 29 実施メモ」。Task 38 が転記する）／v8 計装でまれにテストがタイムアウトするため `coverage.reportOnFailure: true` |
| 30 | E2E の足場としきい値 | G | 着地 `578b1bd`（**5コミット**: `da17516` `b3ab4e7` `50484ca` `92a1ea8` `578b1bd`） | `e2e` = 既定プロジェクト（12 spec / 66 件）、`e2e:shots` を別プロジェクトに分離（`apps/desktop/package.json` の `e2e` は `playwright test --project=default`、`e2e:shots` は `--project=manual-shots`）／**着地時点で E2E の赤が4件ある**（`help.spec` ×3 ＝ Task 32、`plc` ×1 ＝ Task 21。§G16）／**ui-quality の基準値は暫定**（§G17）／申し送り: **README/CONTRIBUTING §6 の QA-02 の注意はこの変更で嘘になった**（§G18・§C.1 の (4)） |
| 31 | 配布ゲートを実際に動かす | G | 未着手 | C.5 参照 |
| 32 | ヘルプ引き出しの読みやすさ | G | 着地 `fe496c7` | help-drawer 43テスト／`anchorIdOf()` を `help-model.ts` に用意（**Task 34 が PDF の見出しIDに再利用**） |
| 33 | リポジトリの文書 | G | 着地 `2bb8455` | `CONTRIBUTING.md` §9 がリリース手順の雛形／`handoff/2026-09-14-phase2-handoff.md` → `docs/superpowers/PROJECT-LOG.md` に改名／**本体仕様 §14.2 の E2E 件数に「Task 37 が数え直す」印を残してある** |
| 34 | 説明書PDFの体裁ともくじのリンク | H | 着地 `817ab45` | PDF 69ページ / 内部リンク 96 / しおり 106／見出しIDは `scripts/anchor-id.mjs` を唯一の源にした（Task 32 の `anchorIdOf()` と同じ規則）／逸脱（F+G レビューで見る）: **ヘッダ右は版数**（Chromium は章題を刷れない）、**もくじにページ番号が無い**、**表紙ともくじにもヘッダ／フッタが出る**、版数は `package.json` から読む（Task 38 が上げるまで v1.0.0）／**Task 41 へ**: `PRINT_CSS` の `:root` パレット（`--ink` `--sub` `--rule` `--hair` `--tint` `--accent`）、`@page` A4 18/16/20mm、本文 10.5pt/1.8 Yu Gothic UI・Meiryo・`max-width: 150mm`、表の罫線、`figure`/`figcaption`、`.notice-*`、`print-manual.mjs` の `HEADER_FOOTER_STYLE`/`FOOTER_TEMPLATE`、`withStableDates()` |
| 35 | チュートリアル章の新設 | H | 未着手 | C.6 参照 |
| 36 | 図の撮り直しと本文の更新 | H | 未着手（**最後**） | C.6 参照 |
| 37 | 全体検証（受入基準①〜⑧） | I | 未着手 | C.8 参照 |
| 38 | v1.1.0 のリリース | I | 未着手（**最後**） | C.9 参照 |
| 39 | 判定の操作列を1歩ずつ再生（PR-12） | F | 未着手 | C.7 参照 |
| 40 | 模範と自分を並べて見る比較ビュー（PR-13） | F | 未着手 | C.7 参照 |
| 41 | 結果の1枚書き出し（PR-14） | G | 未着手 | C.7 参照 |

**着地済み 28 / 41**（Task 1〜22・25・27・29・30・32・33・34）。上記に加えて、赤を直した単独コミット **`48ebe88`**（plc-dialects の課題数 8→20、`session.test` の `RelaySnapshot` フィクスチャ）が `origin/main` に載っている。`origin/main` の先端は **`4931275`**（Task 25）。

**未着手は 13 本**: 23・24・26・28・31・35・36・37・38・39・40・41 ＋ **レビュー系**（§F の B+C 修正バッチ／D+E レビュー＋修正／F+G レビュー＋修正）。

### B.2 21:45 時点で走っていた5本はすべて着地した（申し送りは §B.1 の表に転記済み）

**拾う作業は何も残っていない。**

| タスク | 着地 SHA | 21:45 時点 | いま |
|---|---|---|---|
| 27 3D盤の直接操作 | `7f92edb` | 共有ツリーに未コミット | **着地**。E2E `direct-manipulation` 5/5 ×2、性能 50,044三角形 / 186ドローコール。PNG は `%TEMP%\shots-p7-27` |
| 34 説明書PDFの体裁 | `817ab45` | `%TEMP%\wt-task34` に未push | **着地**。PDF 69p / リンク96 / しおり106。PNG は `%TEMP%\shots-p7-34` |
| 30 E2E の足場としきい値 | `578b1bd`（5コミット） | `%TEMP%\wt-task30` に未push | **着地**。ただし **E2E の赤4件**と **暫定の ui-quality 基準値**を残している（§G16・§G17） |
| 22 ウィンドウ構成とモニタ | `cbe9f17` `30a316e` | `%TEMP%\wt-task22` に未コミット | **着地**。`manual-appdata` と `i18n-keys` が緑に |
| 25 学習導線と結果画面 | `4931275` | `%TEMP%\wt-task25` に未コミット | **着地**。desktop 2,710テスト |

**`%TEMP%\wt-task22` / `wt-task25` / `wt-task30` / `wt-task34` はすべて削除済み**（`git worktree list` に出ない）。

Opus による **B+C レビュー（Tasks 2〜12）も完了**した。所見は本書 **§F** に逐語で入っている。**その修正バッチが Codex の最初の仕事**である。

### B.3 リポジトリの状態（2026-09-20 23:00 実測）

```
origin/main                                   4931275   feat(desktop): show the trainee what to do next on every screen (Phase 7 Task 25)

C:\Users\oltot\Documents\git-projects\OJT     5e938ab [main]  ahead 17 / behind 38  ← STALE。読むだけ（§D.3）
C:\Users\oltot\Documents\git-projects\OJT-wt-e2e      7f92edb (detached)  ← origin より 1 タスク古い
C:\Users\oltot\Documents\git-projects\OJT-wt-release  9df8ef1 (detached)  ← かなり古い
C:\Users\oltot\Documents\git-projects\OJT-wt-shots    70bebce (detached)  ← v1.0.0 時代。かなり古い
```

- **`%TEMP%\wt-task*` の作業 worktree はもう存在しない**（`git worktree list` で確認済み）。
- 残る3つの常設 worktree（`OJT-wt-e2e` / `OJT-wt-release` / `OJT-wt-shots`）は**どれも origin より古い**。使う前に、清浄であることを確かめてから
  `git -C <worktree> fetch && git -C <worktree> checkout --detach origin/main`
  で最新にすること（§D.4）。
- **共有ツリーは古い**。詳細と realign の手順は §D.3。

---

## C. ここから完了までの手順（順序と依存）

### C.0 全体の流れ（2026-09-20 23:00 現在。**依存の門はすべて開いている**）

```
[1] B+C 修正バッチ（§F）                    I1〜I4 → M1〜M7          ← Codex の最初の仕事
        ↓
[2] D+E レビュー（Tasks 13〜22）→ その修正バッチ
        ↓
[3] origin に残る E2E の赤4件を潰す → pnpm e2e が緑 → ui-quality 基準値を測り直す
        ↓
[4] README / CONTRIBUTING §6 の訂正（Task 30 の文言ファイル）
        ↓
[5] 残りの実装        23 → 24 → 26
                      28                      （Task 27 のアンカーを使う）
                      31                      （Task 30 の足場を使う）
                      39 → 40                 （Task 25 の面を使う）
                      41                      （Task 25 と 34 の成果を使う）
                      35 → 36                 （36 が最後の実装タスク）
        ↓
[6] F+G レビュー（Tasks 23〜28・39〜41・29〜33）→ その修正バッチ
        ↓
[7] Task 37（全体検証）
        ↓
[8] Task 38（v1.1.0 リリース。利用者が明示的に許可）
```

**不変条件**: Task 37 と 38 は常に最後の2つ。39・40・41 は番号が大きいが **37 より前**に着地させる。Task 36 は**すべての実装が着地してから**。

### C.1 ここからの順序（具体）

#### (1) B+C レビューの修正バッチ — **最優先。Codex の最初の仕事**

§F の所見を **I1 → I2 → I3 → I4 を先に**、そのあと **M1 → M7** の順で直す。I2 は Task 22 の着地（`cbe9f17`）で既に緑になっているので**再確認だけ**でよい（`npx vitest run i18n-keys`）。触るファイルは §F の各行に `file:line` で書いてある。

- 確認: `npx vitest run i18n-keys ladder-workspace content-loader compile`（`apps/desktop` / `packages/ladder-core` の中で）
- M7 は `apps/desktop/vitest.config.ts` の当該ファイルの `testTimeout` を伸ばす（`--no-file-parallelism` で 72題を回すと既定を超える。`--testTimeout=120000` なら通る）

#### (2) D+E レビュー（Tasks 13〜22）→ その修正バッチ

**必ず天秤にかける既知の逸脱**（レビューのプロンプトにそのまま載せる）:

- **Task 14**: `routeWire()` に任意の `RouteOptions.channelById` と WeakMap メモ化を足した（`buildTraversals` の `channelById` は `ReadonlyMap`）
- **Task 15**: **ライブチャートを間引かない**（端点保存の切り詰め `MAX_LIVE_POINTS = 2000`）／`PlcSnapshot.poweredCells` を廃して `runtime.poweredCells` へ移した／プリセットのキャッシュは worker ローカル
- **Task 19**: **面直プリセットを `MIN_POLAR_ANGLE_RAD` ぶん傾けない**（P.1 / N.1 を拾えるようにするため）／**設計 §8.2 の原因仮説は誤り・§8.3 の判定条件は幾何学的に成立しない → 訂正文を書く**
- **Task 22**: **監視ペインはツールバーから開く**（`Shift + F3` は4方言とも「モニタ（書込）」）／**`SkinTheme.statusItems` を削除**して `statusItemsOf(profile)` にした
- **Task 12 の後始末**（Task 27 が着地したので今やれる）: 未使用の `TerminalHit` コンポーネントを消す（ヘルパは残す）／`camera.ts` の `MIN_POLAR_ANGLE_RAD` は Task 19 が使い始めた
- Task 9 の逸脱（`shared/safe-file-name.ts` ほか §B.1）、Task 4 の逸脱（validate CLI の実行方法ほか）
- `d-009` / `b-009` の `tags` が空（§G12）、C2 の欠陥数が 1〜3 になった（§G13）

#### (3) E2E の赤4件を潰す → `pnpm e2e` を緑にして ui-quality の基準値を測り直す

**Task 30 が着地した時点で `origin/main` の E2E は赤が4件ある**（Task 30 が作った赤ではなく、既にあった赤が足場の整備で見えるようになったもの）:

| spec | 件数 | 原因 |
|---|---|---|
| `help.spec.ts` | 3 | **Task 32** がヘルプ引き出しを `<details>` / `<summary>` にした。`summary` が 14 個あるのに期待は 13、節が既定で畳まれている |
| `plc.spec.ts` | 1 | **Task 21** のデバイス入力パネルが閉じないため、デバイス入力のあとカーソルが `cell-n1:0:3` から外れる。**同じ原因で `plc-vendors.spec.ts` の ⑥ が不安定（flaky）** |

- **`pnpm --filter @ojt/desktop e2e` が緑になるまでは Task 37 に進まない**。
- 緑にしたら **ui-quality の基準値を測り直す**。いま記録されている値は**暫定**（Task 30 が赤のまま測った）: **小さすぎる文字 1,523 / 小さすぎる的 1,505 / 重なり 14 / 折り返し 1**。Task 23・24・26 が入ると大きく下がるので、**Task 26 の着地後にもう一度**測るのが良い。

#### (4) README / CONTRIBUTING §6 の訂正 — **Task 31 か F+G 修正バッチに割り当てる**

Task 30 が `playwright.config.ts` の `projects` と `apps/desktop/package.json` の `e2e` / `e2e:shots` を分けた結果、**Task 33 が `2bb8455` で書いた `README.md:70-91` と `CONTRIBUTING.md` §6 は嘘になった**（`pnpm --filter @ojt/desktop e2e` はもう `docs/manual/images/` を撮り直さない。撮り直すのは `e2e:shots` だけ）。

**差し替える文言は Task 30 が用意してある**: `scratchpad/task30-readme-wording.md`。要点は次の4つ。

1. **コマンド表（`README.md:74-81`）**に `e2e:shots` を足す:
   ```
   pnpm --filter @ojt/desktop e2e          # E2E（取扱説明書の図の撮り直しは含まない）
   pnpm --filter @ojt/desktop e2e:shots    # 取扱説明書の図を撮り直す（追跡下のPNGを書き換える）
   ```
2. **注意書き（`README.md:83-91`）を丸ごと差し替える**: 撮り直すのは `e2e:shots`（`manual-shots.spec.ts`、追跡下の `docs/manual/images/` PNG 52枚・約3MB ＋ `docs/manual/shot-geometry.json`）。**`dist` の前に `git status --short` が空であることを必ず確認**（空でなければ `git checkout -- docs/manual`）。**既定の `e2e` は撮り直しを含まないので作業ツリーは汚れない**（`apps/desktop/playwright.config.ts` の `projects`。レビュー指摘 QA-02）。`e2e:shots` と `dist` は使い捨ての worktree で。
3. **`CONTRIBUTING.md` §6「`dist` の前に作業ツリーを清浄にする」**も同じ理由で直す。「`e2e` の撮り直しが残っている可能性がある」→「**`e2e:shots` の撮り直しが残っている可能性がある**」。手順の順番は「①ソース確定 → ②`e2e` で検証（既定では撮り直しは走らない） → ③図を撮り直した（`e2e:shots`）ときだけ作業ツリーを戻す → ④`dist`」。
4. **`docs/releases/v1.1.0.md` のリリース手順チェックリスト**（項番5の直前）に 4a を足す: 「`pnpm --filter @ojt/desktop e2e` の**あと**に `git status --short` が空であること（図を撮り直していた場合は `git checkout -- docs/manual` で戻してから `dist` に進む。レビュー指摘 QA-02）」。

#### (5) 残りの実装（門はすべて開いている）

| 順 | タスク | 節 | 前提 |
|---|---|---|---|
| a | **23 → 24 → 26** | §C.3 | 22・25 とも着地済み → **いつでも開始可** |
| b | **28**（3分ツアー） | §C.4 | 27 着地済み。**アンカーは Task 27 から**（§C.4 に列挙） |
| c | **31**（配布ゲート） | §C.5 | 30 着地済み。**追加項目**: `release-manual.test.ts` に「既定の Playwright プロジェクトが `manual-shots.spec.ts` を含まないこと」の検査を足す／既存の `versionOf()` をそのまま再利用する／`electron-builder.yml` の `grantFileProtocolExtraPrivileges: true` とコメントを消さない |
| d | **39 → 40** | §C.7 | 25 着地済み。`verdictSummary()` ほかの受け渡しは §C.7 |
| e | **41**（結果の1枚書き出し） | §C.7 | 25・34 とも着地済み。`verdictSummary(result, suspects?)` の**確定した形**を使い、体裁は Task 34 の `PRINT_CSS` トークンから借り、**IPC は 8本 → 9本** |
| f | **35 → 36** | §C.6 | 34 着地済み。**36 は必ず最後**。新しいビルドから撮り直す |

#### (6) F+G レビュー（Tasks 23〜28・39〜41・29〜33）→ その修正バッチ

バッチ F・G が全部着地してから1回。**必ず天秤にかける既知の逸脱**: Task 27 の5件・Task 34 の4件・Task 25 の4件（いずれも §B.1 の表に書いてある）。(4) の README/CONTRIBUTING 訂正をここに載せてもよい。

#### (7) Task 37（全体検証）— §C.9

**今回の版で変わった数え直し2件**:
- **本体仕様 §14.2 の E2E 件数を数え直す**（Task 33 が印を残した。Task 30 で既定プロジェクトは **12 spec / 66 件**になった）。
- **機械点検（`ui-quality.spec.ts`）の残件**は、v1.0.0 の「25件」ではなく **2,938件・blocking 0** と比べて記録する（Task 30 の再測定による。23・24・26 の着地後の実測で置き換えること）。

#### (8) Task 38（v1.1.0 のリリース）— §C.10。**利用者要望12で明示的に許可されている**

### C.2 各タスク共通の進め方

- **判断の要るタスク（Opus 想定）**: 24・26・27・28・31・39・40・41・36・37・38 → プランの Steps は方針で、実装の細部は自分で決める。
- **逐語タスク（Sonnet 想定）**: 23・35 → **プラン／設計に書いてある値をそのまま実装する**（自分の判断で変えない）。
- どのタスクでも: プランの当該 Task の **Files** に挙がっているファイルだけを触る／Steps のチェックボックスを埋める／逸脱は `file:line` と理由を残す。

### C.3 Task 23 → 24 → 26（UI の土台。直列）

**Task 23（逐語）— 色とトークン**（22・25 の着地後に開始）
- Files: `app/global.css`、`schematic/{schematic.module.css,schematic-view.module.css,SchematicSvg.tsx}`、`help/help.module.css`、`result/result.module.css`、`panels/{panels.module.css,PowerControls.tsx,Toolbar.tsx}`、`ladder/LadderGrid.tsx`、`screens/{Home,ProblemList,Settings,InspectPartsSession}.tsx`
- Steps はプラン Task 23 の 1〜7 をそのまま。要点: 紙トークン（`--paper` / `--paper-ink` / `--paper-rule` / `--paper-fill`）／模範波形を `--muted` の**破線**に／通電表示に文字と形（`● 通電中` `○ 無通電` `▲ 保護動作`）／線色ボタンに色見本／インライン style 8箇所をクラスへ／`SchematicSvg` の `viewBox` を数値のまま持つ
- **申し送り（必ず入れる）**:
  - **`help.module.css` の明色パレットもこの1回でまとめてトークン化する**（Task 32 からの引き継ぎ）
  - **Task 22 が入れたモニタの通電セル枠と `■`／`□` の色もトークンへ寄せる**
- 期待: `grep -c "#[0-9a-fA-F]\{6\}" apps/desktop/src/renderer/schematic/schematic.module.css` が **0**
- テスト: `npx vitest run ladder-contrast` ＋ `e2e/ui-quality.spec.ts` の色基準値を取り直す

**Task 24（判断）— アクセシビリティと一貫性**: プラン Task 24 の Steps 1〜16。`CollapsiblePanel.tsx` 新設と右欄の畳み方・並び、名札 **12px**（`label-declutter` の `LABEL_SELECTOR`/`HUD_SELECTOR` に2クラス追加）、「⋯」メニューの閉じ方、1440px 以上では保存・読込・視点を出したまま、設定の `patchIfChanged`、`role="toolbar"` の roving tabindex、`AudioContext` の resume、C1 マークシートの表化、判定中の不定進捗、WebGL コンテキスト喪失の告知。
テスト: `npx vitest run toolbar settings-screen label-declutter marksheet` ／ `e2e/ui-quality.spec.ts` の blocking 0件

**Task 26（判断）— 文字とUIの大きさ・高コントラスト**: `AppSettings` に `uiScale`（0.9/1.0/1.15/1.3）と `contrast`（normal/high）、`--ui-scale` と `rem` 化、`[data-contrast="high"]`、設定画面の2項目、ヘルプ引き出しにも効くこと。
テスト: `npx vitest run settings-ui-scale contrast` ／ `e2e/ui-quality.spec.ts` に「特大」の1周を足してはみ出し0件

### C.4 Task 28（27 は着地済み）— 初回ガイド（3分ツアー）

5枚（①盤を回す ②ソケットに部品を置く ③端子から端子へつなぐ ④電気を流す ⑤判定する）。**読むだけでなく実際に操作すると次へ進む**。初回にモードBの課題を開いたときだけ。`AppSettings.tourDone`、設定と `F1` から出し直し、`pushModalLayer()` と `app/focus-trap.ts`（Task 11 が用意済み）を使う。WebGL が無い環境では出さない。

**各枚のアンカーと「進んだ」判定（Task 27 からの申し送り。そのまま使う）**:

| 枚 | アンカー（`data-testid` / mesh 名） | 進んだ判定 |
|---|---|---|
| ① 盤を回す | `viewport` / `board-canvas` | カメラが動いた |
| ② 部品を置く | `parts-palette` ＋ `palette-{kind}`、`socket-body-{S1..}` | `store.dragging` → `session.mounted` が増える |
| ③ 端子をつなぐ | `terminal-field` / `terminal-row-{id}` | `session.wires.length` が増える |
| ④ 電気を流す | `power-breaker` / `power-switch`（3Dメッシュは `breaker-well` `breaker-handle` `switch-well` `switch-rocker`） | `snapshot.breakerOn` / `snapshot.switchOn` |
| ⑤ 判定する | 判定ボタン | 判定が走った |

**`store.hoverHint` が「いまポインタの下に何があるか」を教える**ので、ツアーの当たり判定に使える。

テスト: `npx vitest run tour`

### C.5 Task 31（30 は着地済み）— 配布ゲートを実際に動かす

プラン Task 31 の Steps 1〜5。**注意点3つ**:
- **`electron-builder.yml` の `grantFileProtocolExtraPrivileges: true` とそのコメントを消さない**（Task 8 が理由つきで残した）
- `check-dist.mjs` を検査関数モジュールと薄い入口に割るとき、**既存の `versionOf()` をそのまま再利用する**
- **Task 30 からの申し送り**: `test/release-manual.test.ts` に「**既定の Playwright プロジェクトが `manual-shots.spec.ts` を含まないこと**」を確かめる検査を足す（`apps/desktop/playwright.config.ts` の `projects` を読む）。`dist` の前に作業ツリーの清浄を確かめる必要があるのは **`e2e:shots` を走らせたときだけ**になった

成果物名は ASCII（`DenkiKyoikuTool-${version}-${arch}.${ext}`）に、`productName`（インストール後の実行ファイル名）は日本語のまま。PDF の生成日は `OJT_MANUAL_DATE` → `git log -1 --format=%cs` → 今日 の順。
テスト: `npx vitest run check-dist copy-content release-manual manual-build` ＋ worktree で `dist` を2回走らせて `manual.pdf` の SHA256 一致

### C.6 Task 35 → 36（バッチH。34 の着地後。**36 が最後の実装タスク**）

**Task 35（逐語）— チュートリアル章**: `docs/manual/13-tutorial-modes.md`（6節）と `14-tutorial-features.md`（1機能1節・15項目・「何ができるか→どこにあるか→操作の順→よくある間違い」の4段固定）を新設。最終節に**全72題の索引表**（ID／モード／級／難／題名／学ぶこと／つまずきやすい所）。`shots.json` に図の**意味**、`coverage.json` の節付け替え。`style.json` の禁止語0件。`manual-problem-index.test.ts` 新設。最後に `node apps/desktop/scripts/build-manual.mjs`。
テスト: `npx vitest run manual-style manual-coverage manual-sync manual-problem-index manual-shots`

**Task 36（判断）— 図の撮り直しと本文の更新**: **Task 1〜35 と 39〜41 がすべて着地してから**着手する。
1. 先に本文を直す。`node apps/desktop/scripts/feature-inventory.mjs` で `coverage.json` との差分（増減した `data-testid`）を出し、Task 21・25・26・27・28・39・40・41 と72題の影響節を書き直す。
2. **ビューキューブの図と本文は「カメラが指に付いてくる」向きで書く**。**俯瞰→正面は「上へ約105px ドラッグ」**（Task 19 の実測）。`navigation.spec.ts` が `screenshots/30-nav-top-before-drag.png` と `31-nav-top-to-front.png` を吐く。
3. `manual-shots.spec.ts` に新しい図（約20枚）を足し、既存17枚も全部撮り直す。**Task 30 以降、`manual-shots.spec.ts` は Playwright の既定プロジェクトから外れている**ので、明示的に指定して走らせる。
4. 撮影は**新しいビルドから**、worktree `OJT-wt-shots` で（共有ツリーでは追跡対象の図を書き換えるので走らせない）。
5. `manual-images.test.ts`（原寸300KB以下・縮小版 幅400px/80KB以下・吹き出しがアプリの文字を覆わない）
6. `build-manual.mjs` → worktree で `electron apps/desktop/scripts/print-manual.mjs` → **PDF を目で見る**
7. `manual-content.ts` を再生成してコミット

テスト: `npx vitest run manual-`（manual-build / manual-sync / manual-style / manual-coverage / manual-shots / manual-images / manual-appdata / manual-pdf / manual-problem-index が全部 pass）

### C.7 Task 39 → 40 / Task 41（25・34 はどちらも着地済み）

**Task 25 からの受け渡し（39・40・41 共通。そのまま使う）**:

- **再生のデータ** = `JudgeResult.charts.{expected, actual}` ＋ `mismatches`（文言は `mismatchLine()` / `mismatchKind()`）
- **ヒント段** = `store-ui.hintStage`（0〜3）、上限は `maxHintStage(grade)`（1級は第3段を出さない）
- **結果画面からの入口** = `ResultShell` の `extraAction` スロット（`ResultShell` は `summary` / `extraAction` / `headerExtra` を取る）
- **並置ビューに埋める部品** = `result/ChartOverlay.tsx`、`MismatchList.tsx`、`StaticCheckList.tsx`（`HazardList`）、`SuspectList.tsx`
- **`verdictSummary(result: VerdictInput, suspects?) -> { source, text, fix }`**（`result/verdict-summary.ts`。純関数。**この形は確定**）

**Task 39（判断）— 判定の操作列を1歩ずつ再生（PR-12）**
- 要: **再生は判定とまったく同じ操作列（課題の `operations`）と同じ許容差（`judge.tolerance`）を使う**。再生が判定と違う答えを出したらそれは不具合。再生中は盤の編集を全部止める。
- `session/replay.ts`（純関数 `replaySteps(operations, durationMs, mismatches)`）→ `panels/ReplayBar.tsx` → worker の `replay` コマンド（`start`/`step`/`stop`）→ 結果画面の入口「動きを見直す」
- **MERGE #14**: `worker/protocol.ts` から Task 12 が消した `reset` コマンドを**復活させない**。`replay` を新設する。`sim.worker.ts` の外側 `switch` には Task 10 の `default: command satisfies never` があるので、分岐を足し忘れると `tsc` が落ちる
- 信号名は必ず `packages/content/src/timechart.ts` の `PB_LABELS` / `OUTPUT_LABELS` 経由（素の `PL1` を出さない）
- 再生の凍結は Task 27 の `intentOf()` と `pickToAction()` が `{ type: 'none' }` を返すことで実現する
- テスト: `npx vitest run replay replay-bar`

**Task 40（判断）— 模範と自分を並べて見る比較ビュー（PR-13）**
- **級による開示制限を外さない**: `assemble` は `hints.schematicVisible === (grade === 3)`、`inspect-repair` は `=== (grade === 2)`、モードD は模範ラダーを出さない。`false` の課題では波形だけを出し、断りを1行出す
- `result/compare.ts`（`compareCharts()` / `mayShowReference()`）→ `CompareView.tsx`。拡大と案内線は既存タイムチャートと**同じ操作**にする（新しい操作を作らない）
- **`compareCharts()` の差分が、結果画面の差分一覧・Task 39 の再生と3つとも一致すること**
- テスト: `npx vitest run compare compare-view`

**Task 41（判断）— 結果の1枚書き出し（PR-14）**
- 決定#5（進捗・成績の永続記録はしない）との関係: **アプリは貯めない。利用者が選んだ場所へ1回書き出すだけ**。自動保存しない／前回の保存先を覚えない／件数を数えない
- `result/report-html.ts`（純関数。利用者名・絶対パス・`w-\d{3}` 形式の内部IDを載せない／全文 HTML エスケープ／外部参照0・画像0）
- **Task 25 の `verdictSummary(result, suspects?) -> { source, text, fix }` を再利用**して「なぜ落ちたか」1行を載せる（署名は `4931275` で確定済み）
- **体裁は Task 34（`817ab45`）の `PRINT_CSS` から紙のトークンだけを借りる**: `:root` の `--ink` / `--sub` / `--rule` / `--hair` / `--tint` / `--accent`、本文 10.5pt / 行間 1.8 / Yu Gothic UI・Meiryo / `max-width: 150mm`、表の罫線、`figure`・`figcaption`、`.notice-*`。**ページ設定（`@page` A4 18/16/20mm）やヘッダ・フッタは借りない**（1枚の HTML であって PDF 本文ではない）
- **IPC は 8本 → 9本**（`resultExport: 'result:export'`）。`test/ipc-surface.test.ts` の期待本数を 9 に伸ばす（Task 8 が作った「`IPC_CHANNELS` と完全一致」の形は変えない）
- main 側 `result-export.ts`: 1 MiB 上限 → `safeFileName()`（Task 9 の `shared/safe-file-name.ts`）→ `dialog.showSaveDialog` → PDF はオフスクリーン `BrowserWindow`（`sandbox: true` / `javascript: false`）で `printToPDF()` → 一時ファイルは必ず消す。書き込みは Task 9 の `fs-atomic.ts`
- 本体仕様 §4.3 の IPC 一覧に9本目を足す（Task 33 が触った節とは別なので競合しない）
- テスト: `npx vitest run report-html result-export ipc-surface hardening`。`%APPDATA%/電気教育ツール` に差分が出ないこと

### C.8 レビュー（2バッチに1回、その都度 修正バッチ1回）

利用者の方針（速度優先）: **2バッチにつきレビュー1回**、指摘は Blocking / Important を1回の修正バッチでまとめて直し、Minor はさらにまとめる。

| レビュー | 対象 | 状態 |
|---|---|---|
| **B+C** | Tasks 2〜12 | **完了**（2026-09-20 21:30〜22:00、Opus、基準 `2f73341`）。所見は **§F** に逐語。**修正バッチが Codex の最初の仕事** |
| **D+E** | Tasks 13〜22 | **未実施。Task 22 が着地したのでいつでも開始できる** |
| **F+G** | Tasks 23〜28・39〜41・29〜33 | バッチ F・G が全部着地したら |

**D+E レビューに必ず含める積み残し**（§C.1 の (2) と同じ。ここは一覧）:
- Task 12 の後始末: 未使用 `TerminalHit` コンポーネントの削除（ヘルパは残す）と `camera.ts` の `MIN_POLAR_ANGLE_RAD`（Task 19 が使い始めた）— **Task 27 が着地したので今できる**
- **設計 §8.2（原因の仮説）と §8.3（判定条件）の訂正文**を書く（Task 19 の実測で仮説が誤りと分かった）。あわせて **Task 19 の逸脱: 面直プリセットを `MIN_POLAR_ANGLE_RAD` ぶん傾けない**（P.1 / N.1 のピックを保つため）
- Task 14 の逸脱（`RouteOptions.channelById` と WeakMap メモ）
- Task 15 の逸脱（ライブチャートを間引かない／`poweredCells` の移動／プリセットキャッシュ worker ローカル）
- **Task 22 の逸脱**（監視ペインはツールバーから／`SkinTheme.statusItems` を削除して `statusItemsOf(profile)` に／`ResizeObserver` の横に resize リスナを残した）
- Task 9 の逸脱（`safe-file-name.ts` ほか §B.1 参照）、Task 4 の逸脱（validate CLI の実行方法ほか）
- **E2E の赤4件**（§G16）— D+E か F+G のどちらかの修正バッチで必ず潰す

### C.9 Task 37（全体検証）

**Files: 変更なし（記録のみ。軽微な直しは別コミット）**。清浄な worktree で通す:

```bash
pnpm install --frozen-lockfile
pnpm verify                                        # typecheck / lint / -r test
pnpm --filter @ojt/content validate src/builtin    # 0件
pnpm --filter @ojt/desktop test:coverage           # 実測値を記録
pnpm --filter @ojt/desktop e2e                     # 2回連続で同じ結果
git status --short                                 # e2e の後でも空
pnpm --filter @ojt/desktop dist                    # check-dist が成功し release/artifacts.md が出る
```

- **受入基準①〜⑧（設計 §11）を人が実行して確かめ**、結果を `docs/releases/v1.1.0.md` の下書きに書く
  ①ライセンス画面 ②指摘171件対応 ③72題が全部自判定に合格 ④4方言のキー全行 ⑤3Dの直接操作 ⑥ビューキューブの回り込み ⑦PDFのもくじリンク＋しおり＋72題索引 ⑧初回ガイド5枚
- 2026-09-20 の決定5件が実装に載っていることを確かめる（12px 名札／`sandbox: true` が配布物で有効／ビューキューブ両軸反転／成果物名 ASCII／PR-12〜14 が動く）
- **本体仕様 §14.2 の E2E 件数を数え直す**（Task 33 が「Task 37 が数え直す」印を残してある）。Task 30 の足場で**既定プロジェクトは 12 spec / 66 件**になっている（`e2e:shots` は別勘定）
- 機械点検（`ui-quality.spec.ts`）の残件を数えて記録する。**比較の相手は v1.0.0 の「25件」ではなく、Task 30 が測り直した 2,938件・blocking 0**（小さすぎる文字 1,523 / 小さすぎる的 1,505 / 重なり 14 / 折り返し 1 は**赤4件を抱えたままの暫定値**なので、23・24・26 の着地後に測り直した実測で置き換えること）
- 残る積み残し（**PR-15 のみ**、ほかに CS-02・CS-03・CS-07 の代替対応）を「積み残し」に書く

### C.10 Task 38（v1.1.0 のリリース）— **利用者要望12で明示的に許可されている**

**前提**: Task 1〜37 と 39〜41 がすべて着地し、Task 37 の検証がすべて緑であること。

1. `apps/desktop/package.json` の `version` を **`1.1.0`** に（設計 §9.1 の推奨。利用者が v2.0.0 を選んだらここと成果物名だけ差し替え）
2. `docs/releases/v1.1.0.md` を書く。**`CONTRIBUTING.md` §9 のリリース手順チェックリストを本文へ写す**。載せるもの:
   - 何が変わったか（利用者の言葉で12項目）
   - **「内蔵課題は合計 72題（モード B 20 / C1 12 / C2 20 / D 20）」**（この文をそのまま使う）
   - 指摘171件の対応と3件の代替
   - 性能の新しい予算（Task 16・17 の実測: 50,364三角形 / 186ドローコール、予算 200k / 340）
   - **`apps/desktop` のカバレッジ実測**（プラン末尾「Task 29 実施メモ」から: Lines 84.24% / Statements 82.59% / Functions 82.50% / Branches 80.36%）
   - 成果物の SHA256（`release/artifacts.md` から）
   - **未実施の確認**の一覧（v1.0.0 では 実機60fps／オフライン導入／OS 既定ビューアでの PDF が未実施だった。設計 §9.3）
   - 積み残し（PR-15 ほか）
   - **`docs/releases/v1.0.0.md` は絶対に編集しない**（雛形として読むだけ）
3. worktree `OJT-wt-release` で `pnpm --filter @ojt/desktop dist`（NSIS とポータブルの両方）。`check-dist.mjs` が成功し `release/artifacts.md` が出ること。**`dist` の前に `git status --short` が空であること**を必ず確認する
4. **配布物を実際に入れて確かめる**: ①インストーラのライセンス画面が化けていない ②起動してモードBの課題を1つ完走 ③「説明書（PDF）を開く」で PDF が開き**もくじを押すと飛ぶ** ④初回ガイドが出る
5. コミット → push → `git tag v1.1.0`（注釈つき） → GitHub Release
   - `gh` の実体は `"C:/Program Files/GitHub CLI/gh.exe"`
   - リポジトリ: `https://github.com/oltotlo79-rgb/OJT`
   - 添付（Task 31 で ASCII 名になっているので手作業のリネームは不要）:
     `DenkiKyoikuTool-1.1.0-x64.exe` / `DenkiKyoikuTool-1.1.0-x64.zip` /
     `DenkiKyoikuTool-manual-v1.1.0.pdf` / `artifacts.md`
   - latest にする（v0.2.0 は pre-release のまま、v1.0.0 は据え置き）
6. `docs/releases/v1.1.0.md` に公開 URL と実際に添付されたファイル名を追記してコミット
7. 完了条件（プラン末尾）を最後にもう一度コマンドで確認する。特に `docs/reviews/**` が **1文字も変わっていない**こと

---

## D. 作業の作法（Codex 向け。前任者の共通規則を単独エージェント向けに書き直したもの）

### D.1 1タスクの型（毎回これを回す）

```bash
# 1) 出発点を最新にする
git -C C:/Users/oltot/Documents/git-projects/OJT fetch origin

# 2) タスク専用の worktree を origin/main から切る（detached）
git -C C:/Users/oltot/Documents/git-projects/OJT worktree add --detach %TEMP%\wt-task23 origin/main
cd %TEMP%\wt-task23
pnpm install --prefer-offline

# 3) プランの Steps どおりに実装（失敗するテストを書く → 直す → 通す → コミット）
#    作業中は影響のあるテストだけを走らせる
cd apps/desktop && npx vitest run ladder-contrast && cd ../..

# 4) 最後に一度だけ全体
pnpm -r typecheck
pnpm lint
npx prettier --check <触ったファイル>
pnpm --filter @ojt/desktop test --no-file-parallelism

# 5) コミット（パスを明示してステージ → パス指定なしでコミット）
git add <触ったファイルを1つずつ>
git diff --cached --stat        # 自分のファイルだけか確認
git commit                      # メッセージは英語のタスク題名 + " (Phase 7 Task 23)"

# 6) 着地
git fetch origin && git rebase origin/main
git push origin HEAD:main
git -C C:/Users/oltot/Documents/git-projects/OJT worktree remove %TEMP%\wt-task23 --force
```

- **コミットメッセージ**: 英語のタスク題名 ＋ `(Phase 7 Task N)`。本文に逸脱と申し送りを書く。
- **タスクは push されるまで完了ではない**（R6）。報告する SHA は **origin 上の SHA**。
- **落とし穴①（git）**: `git commit --only -- <path>` は、そのパスの**作業ツリー版**をコミットすることがある（Task 12 で実際に起きた）。**必ず明示的にステージ（`git add` または `git apply --cached`）してから、パス指定なしで `git commit` する。**
- **落とし穴②（pnpm）**: `pnpm --filter @ojt/desktop test -- <filter>` は pnpm の引数処理のせいで**意図どおりに絞れないことがある**（全件走ったり、フィルタが無視されたりする）。**`cd apps/desktop` して `npx vitest run <テスト名の一部>` を使う**こと。全件を走らせるときは `pnpm --filter @ojt/desktop test --no-file-parallelism`。

### D.2 禁止事項

§A.5 のとおり。`git stash` / `reset --hard` / `checkout -- .` / `clean` / `commit --amend` / `rebase --autostash` / `add -A` / blob 注入 は**すべて禁止**。

### D.3 共有ツリーは**古い（STALE）**。読むだけに使う

**実測（2026-09-20 23:00、`git fetch origin` 後）**:

```
git rev-list --left-right --count origin/main...main   → 38  17     （main は ahead 17 / behind 38）
git cherry origin/main main                            → '-' 15本 / '+' 2本
git diff --name-only origin/main main | wc -l          → 254 ファイルが違う
ls vitest.config.ts vitest.workspace.ts                → 両方ある（origin では削除済み）
git status --short | wc -l                             → 58（Task 27 の実装が未コミットのまま残っている。中身は 7f92edb として origin に載っている）
```

- **254 ファイルが origin と違い、その中身は origin より古い**。ルートの `vitest.config.ts` / `vitest.workspace.ts` は **origin では削除されている**のにここには残っている。
- `git cherry` の `'+' 2本` は **`09cc84b`（Task 13）** と **`5e938ab`（Task 12）**。どちらのタスクも `d47dae0` / `2f73341` として **origin に着地済み**で、`+` は patch-id が一致しないだけ（別の土台の上で作られたため）。**失われた作業ではないが、捨てる前に必ず自分の目で差分を見ること。**

**したがって**:

> **共有ツリーは読み取り専用として扱う。ビルド・テスト・実装は、`origin/main` から切った新しい worktree でのみ行う（§D.1）。**

**揃え直したくなったら（`git reset --hard` を使うので、実行前に必ず利用者の許可を取る）**:

```bash
cd C:/Users/oltot/Documents/git-projects/OJT
git fetch origin

# 1) 先に退避（この2本は必ず取る）
git diff HEAD            > %TEMP%\ojt-shared-worktree.patch     # 未コミットの変更
git diff origin/main     > %TEMP%\ojt-shared-vs-origin.patch    # ローカル main と origin の差

# 2) ローカルにしか無い中身が本当に無いか確かめる
git cherry -v origin/main main        # すべて '-' なら安全。'+' が出たらその2本を diff で確認する

# 3) 利用者の許可を得てから
git reset --hard origin/main
```

- **未追跡（untracked）の `docs/reviews/`、`.scratch-store/`、本引き継ぎ書は `reset --hard` でも消えない**ので、そのまま残る。
- `git clean` は**絶対に使わない**（§A.5）。`docs/reviews/**` は1文字も変えてはならない（§G10・完了条件6）。
- 許可が取れないうちは、**§D.1 のとおり worktree で作業すれば共有ツリーが古いままでも一切困らない**。

### D.4 既存 worktree の使い分けと更新

| worktree | いまの HEAD | 用途 |
|---|---|---|
| `C:\Users\oltot\Documents\git-projects\OJT-wt-e2e` | `7f92edb`（古い） | E2E 実行用 |
| `C:\Users\oltot\Documents\git-projects\OJT-wt-shots` | `70bebce`（かなり古い） | 説明書の図の撮影用（Task 36） |
| `C:\Users\oltot\Documents\git-projects\OJT-wt-release` | `9df8ef1`（かなり古い） | `dist` / リリース用（Task 31・37・38） |

**3つとも `origin/main`（`4931275`）より古い。使う前に必ず最新にすること。**

```bash
git -C <worktree> status --short                      # 空であること
git -C <worktree> fetch
git -C <worktree> checkout --detach origin/main
```

`%TEMP%\wt-task*` の作業用 worktree は**すべて削除済み**（残っていない）。新しいタスクには §D.1 のとおり毎回 `origin/main` から新しく切ること。

### D.5 ビルド・E2E の作法

- **E2E とビルドは必ず worktree で、必ず前景で**走らせる（タイムアウトは 600,000 ms を目安に）。背景に回して出力ファイルを待たない。結果は `test-results/.last-run.json` を読む。
- **追跡対象の図（`docs/manual/images/` PNG 52枚・約3MB ＋ `shot-geometry.json`）を書き換えるのは `pnpm --filter @ojt/desktop e2e:shots` だけ**になった（Task 30 が `manual-shots.spec.ts` を既定プロジェクトから外した。既定の `e2e` では作業ツリーは汚れない）。それでも **`dist` の前には必ず `git status --short` が空であることを確かめる**（空でなければ `git checkout -- docs/manual`。**このパスに限る**）。`e2e:shots` と `dist` は使い捨ての worktree で。
- **`origin/main` の E2E はいま4件赤い**（§G16）。緑を期待しないこと。まずそれを潰す。
- **Node は 25 が入っているが `.nvmrc` は 22**（LTS）、`.npmrc` に `engine-strict=true`。`scripts/build.mjs` / `dev.mjs` は Node 25 の不具合回避のために存在する（その旨のコメントあり）。

### D.6 コード規約（前提C）

- 画面に出る文字はすべて `apps/desktop/src/renderer/i18n/ja.ts`（main 側は `src/shared/messages.ts`）。**該当ブロックの末尾に足す**。**編集直前に読み直す**。
- ヘルプ本文だけは生成物 `src/renderer/help/manual-content.ts` から来る（手で直さない）。
- TS strict ＋ `exactOptionalPropertyTypes` ＋ `noUncheckedIndexedAccess`。import は `.js` 接尾辞。
- Vitest は `globals: false`。RTL のテストは `afterEach(cleanup)`。zustand への書き込みは `act()` の中。
- ESLint flat ＋ Prettier（`printWidth: 100`、`singleQuote`、`semi`、`trailingComma: 'all'`）。`docs/**` は `.prettierignore` 対象。
- `packages/*` のカバレッジは行・分岐 90% 以上。`apps/desktop` に閾値は置かない（実測 −3pt をラチェット基準にする）。

### D.7 生成物のパイプライン（触ったら必ず回す）

| 生成物 | 作り直し方 | 縛っているテスト |
|---|---|---|
| `apps/desktop/src/renderer/help/manual-content.ts` | `node apps/desktop/scripts/build-manual.mjs` | `manual-sync.test.ts`（正本とバイト一致） |
| `docs/manual/coverage.json` | `node apps/desktop/scripts/feature-inventory.mjs` の出力が唯一の源 | `manual-coverage.test.ts`（行が揃っていないと落ちる） |
| 禁止語 | `docs/manual/style.json` | `manual-style.test.ts` |
| `apps/desktop/resources/content/**` | `node apps/desktop/scripts/copy-content.mjs`（課題JSONを足したら手で1回） | `release-content.test.ts` ほか |
| 課題JSONの検証 | `pnpm --filter @ojt/content validate src/builtin`（約40秒） | — |
| PDF | `node apps/desktop/scripts/build-manual.mjs` → worktree で `electron apps/desktop/scripts/print-manual.mjs` | `manual-pdf.test.ts` |

---

## E. 報告の形式

タスクが1つ着地するたびに、利用者へ次の形で報告する（**15行以内**）。

```
STATUS: Task 23「色とトークンを整え、色だけの符号化をやめる」DONE
SHA（origin/main）: <7桁>
やったこと:
  - 紙トークンを :root に追加し schematic*.module.css の hex 58行を置換（ladder-contrast 6件）
  - 模範波形を破線に（chart-scale 4件）
  - …（項目ごとに「何を・どのテストで確かめたか」）
テスト: desktop <n>ファイル / <m>件 pass、typecheck・lint・prettier 無警告
逸脱: <file:line> と理由（無ければ「なし」）
申し送り: 次のタスクへ渡す事実（無ければ「なし」）

修正タスク 29 / 41 完了
```

- **最後の行は必ず「修正タスク X / 41 完了」**（R4）。X は origin に着地したタスク数。**前回より減らさない／勝手に増やさない**。
- レビューを走らせたときは「Blocking n件 / Important m件 / Minor k件」と、修正バッチで何を直したかを1行ずつ。
- **利用者への質問は必ず選択肢つき**（「A: …／B: …／C: …」）。自由記述で聞かない。
- 画面が変わるタスク（22・23・24・25・26・27・28・34・36・39・40・41）は、**スクリーンショットを撮って利用者に見せる**（利用者の常設の要望）。

---

## F. B+C レビューの所見（Tasks 2〜12）

Opus による読み取り専用レビュー。**2026-09-20 21:30〜22:00、基準は `origin/main` = `2f73341`**。以下は所見の**逐語**である。

```
# B+C review (Opus, 2026-09-20 21:30–22:00) — VERDICT: APPROVED WITH MINOR ISSUES (base origin/main 2f73341)
Blocking: none.
Important
[I1] Task 3 — apps/desktop/src/renderer/ladder/LadderWorkspace.tsx:271 — edit() toasts the raw LadderError.message, so LE-9's internal ids still reach the screen from 行挿入/行削除/ネットワーク挿入 (e.g. 「ネットワーク n1 の行数が上限（20）を超えます」; edit.ts has 8 more id-bearing messages) — route through friendlyLadderErrorMessage() and add those patterns (only the 罫線 message and missing-end are covered).
[I2] Task 12/21 — apps/desktop/test/i18n-keys.test.ts:91 — RED on origin: `ladder.entry.unconverted` (added by Task 21 62c988b) is unreferenced; use or drop the key (asked Task 22 to fix while landing).
[I3] Task 2 — packages/ladder-core/src/compile.ts:323 — LC-1 narrowed to "content after the END cell in iteration order"; content placed before END in the END network still reports 変換成功 although runtime breaks on net.isEnd. Make it "any non-empty non-END cell in that network".
[I4] Task 9 — apps/desktop/src/main/content-loader.ts (MAX_USER_PROBLEM_FILES) — the gate counts all top-level readdir entries (subdirs, README, .txt) while loadProblemsFromDir recurses: 10 subfolders × 100 JSON slip past; 201 entries → user set loads as ZERO problems. Count .json (or recurse) and/or truncate instead of all-or-nothing.
Minor
[M1] Task 2 — fe2cf1e still carries Task 7's i18n hunks (pickKindHint, openHintPicking, zeroAdjust, chartOpenerLabel(pickable)); bookkeeping only.
[M2] Task 7 — apps/desktop/src/renderer/panels/ReportPanel.tsx:50 — styles.hint does not exist in panels.module.css; UX-22 hint renders unstyled. Add .hint or reuse a class.
[M3] Task 4 — docs/manual/10-authoring.md (+ manual-content.ts) says tags filter the 課題一覧, but nothing reads tags/difficulty yet — reword until Task 25 lands the filter (then it becomes true).
[M4] Task 3 — apps/desktop/src/renderer/session/ladder-cell.ts DEFAULT_TIMER_BASE_MS = 100 hardcodes what TimerRule.baseMs already carries; expose the rule's baseMs.
[M5] Task 10 — CT-14: seed added to ResolveFaultsResult but the work file never persists it (reproduction rides on the saved resolved list); undeclared deviation — declare or persist.
[M6] Task 10 — CS-12 (stepTester rangeKey with kind/ohmRange) untested; add a one-line stepTester test.
[M7] Cross-task — apps/desktop/test/{spec-chart,work-file-real-judge}.test.ts exceed vitest default timeouts under --no-file-parallelism (72 problems); pass at --testTimeout=120000 — raise the per-file timeout.
Per-task spec compliance: Tasks 4,5,6,7,8,9,10,11,12 compliant; Task 2 compliant with reservations (I3, M1); Task 3 LE-9 half-closed (I1). grantFileProtocolExtraPrivileges: true pin judged justified.
Numbers (2f73341): lint clean; typecheck 3 errors in test/session.test.tsx (fixed by 48ebe88); tests 273 files / 3,950, 5 failing = builtin-problems count (fixed 48ebe88), manual-appdata (Task 22), i18n-keys (I2), 2 timeouts (M7).
```

**この修正バッチ（I1〜I4 を先に、そのあと M1〜M7）が Codex の最初の仕事である。**

補足（レビュー後に着地したぶん）:
- `builtin-problems` の件数と `session.test.tsx` の型エラーは **`48ebe88`** で解消済み。
- `manual-appdata` と **I2（`i18n-keys`）** は **Task 22（`cbe9f17`）** で解消済み → **再確認だけでよい**（`npx vitest run i18n-keys manual-appdata`）。
- M3 の「tags で課題一覧を絞れる」は **Task 25（`4931275`）が着地したので真になった** → 文言を直す必要があるか、現物を読んで判断すること。

---

## G. 既知の赤・注意点

| # | 事象 | 対処 |
|---|---|---|
| G1 | ~~`manual-appdata.test.ts` が赤~~ **解消済み** | **Task 22（`cbe9f17`）で `manual-appdata` と `i18n-keys` の両方が緑になった**。単体テストは `origin/main` = `4931275` で全部通る（赤が残っているのは **E2E だけ**。→ G16） |
| G2 | **`pnpm --filter @ojt/desktop test -- <filter>` は pnpm の引数処理で意図どおり絞れないことがある** | `apps/desktop` に入って **`npx vitest run <name>`** を使う |
| G3 | desktop の全件実行は並列で不安定になることがある | **`pnpm --filter @ojt/desktop test --no-file-parallelism`** |
| G4 | **v8 カバレッジ計装でテストがまれにタイムアウトする**（既定の `testTimeout` にぎりぎりで通っていたもの） | `apps/desktop/vitest.config.ts` の `coverage.reportOnFailure: true` でレポートは出る。計装なしでは全件 pass |
| G5 | **`grantFileProtocolExtraPrivileges: true` を false にしない** | Task 8 が理由つきで残した。Task 31 で `electron-builder.yml` を触るときに消さないこと |
| G6 | **Playwright の `_electron.launch` は fuse を焼いた配布物を起動できない** | Task 8 と同じやり方で検証する: `--remote-debugging-port` を付けて起動し **CDP 経由**で確かめる |
| G7 | **OMRON（CX-Programmer風）にはモニタ開始のショートカット行が無い** | `monitorStartLabel(profile)` で出し分ける。4方言で一律に行を出さない |
| G8 | **JTEKT / SHARP のキー割当表は `assumedTable()`（推定）** | 「確認済み」と書かない。出典は `docs/reference/ladder-skin-sources.md` に記し、`confirmed: false` のままにする |
| G9 | **共有ツリー `C:\Users\oltot\Documents\git-projects\OJT` が古い（STALE）** — ahead 17 / behind 38、254ファイルが origin と違い中身は origin より古い、ルート `vitest.config.ts`/`vitest.workspace.ts` が origin では削除済みなのに残っている、Task 27 の実装が未コミットのまま残っている（中身は `7f92edb` として origin に載っている） | **読み取り専用として扱い、作業は `origin/main` から切った新しい worktree でのみ行う**（§D.1）。揃え直すには `git reset --hard` が要るので**利用者の許可が必要**。手順は §D.3（先に `git diff HEAD` と `git diff origin/main` を patch に退避 → `git cherry -v origin/main main` を確認 → reset）。`git clean` は禁止 |
| G10 | `docs/reviews/2026-09-20-project-evaluation.md` は**未追跡**のまま | **絶対に `git add` しない**。完了条件6に「`docs/reviews/**` が1文字も変わっていないこと」がある |
| G11 | `e2e` が追跡対象の図（約3MB）を書き換える | `dist` の前に `git status --short` が空であることを確認。汚れていたら `git checkout -- docs/manual`（**このパスに限る**） |
| G12 | `d-009` と `b-009` の `tags` が空 | 課題一覧の絞り込み（Task 25）と索引（Task 35）で「タグ無し」を正しく扱う。必要なら D+E 修正バッチでタグを補う |
| G13 | **C2 の欠陥数が 1〜3 箇所になった** | 画面・説明書に残っている「2箇所」という言い回しを直す（Task 25・35・36） |
| G14 | `instruction-list.ts` の `render()` が内部ID（`n1`）を含むヘッダを出す／§10.7 の印刷用レイアウトが未実装 | Phase 4 からの積み残し。v1.1.0 の「積み残し」に記録する（Task 37・38） |
| G15 | `screens.module.css` の `.schematicBox` の `max-height: 320px` で回路図ヒントが内部スクロールすることがある | Task 23 または 24 で上限を上げるか、図を収める |
| G16 | **`origin/main`（Task 30 `578b1bd` 以降）で E2E が4件赤い** — `help.spec.ts` ×3（**Task 32** が `<details>`/`<summary>` にしたため。`summary` が14個あるのに期待は13、節が既定で畳まれている）／`plc.spec.ts` ×1（**Task 21** のデバイス入力パネルが閉じないため、デバイス入力のあとカーソルが `cell-n1:0:3` から外れる）。**同じ原因で `plc-vendors.spec.ts` の ⑥ が不安定（flaky）** | **D+E か F+G の修正バッチで必ず潰す。`pnpm --filter @ojt/desktop e2e` が緑になるまで Task 37 に進まない。**Task 30 が作った赤ではなく、足場の整備で見えるようになった既存の赤である |
| G17 | **ui-quality の基準値は暫定** — Task 30 が赤4件を抱えたまま測った値: **小さすぎる文字 1,523 / 小さすぎる的 1,505 / 重なり 14 / 折り返し 1**（合計 2,938件・blocking 0） | G16 を潰したあと**もう一度測る**。Task 23・24・26 が着地するとさらに大きく変わるので、**Task 26 の着地後の実測**を正とする（Task 37 はその値を記録する） |
| G18 | **README と CONTRIBUTING §6 の QA-02 の注意が嘘になった** — Task 33（`2bb8455`）が「`pnpm --filter @ojt/desktop e2e` が `docs/manual/images/` を撮り直す」と書いたが、Task 30 以降**撮り直すのは `e2e:shots` だけ** | **差し替える文言は `scratchpad/task30-readme-wording.md` にある**（要点は §C.1 の (4) に転記済み）。`README.md:70-91` と `CONTRIBUTING.md` §6、`docs/releases/v1.1.0.md` のチェックリスト 4a。**Task 31 か F+G 修正バッチに割り当てる** |
| G19 | `apps/desktop/package.json` の E2E スクリプトが2本に分かれた | `"e2e": "playwright test --project=default"`（12 spec / 66件。**図の撮り直しを含まない**）／`"e2e:shots": "playwright test --project=manual-shots"`（追跡下の PNG を書き換える）。Task 36 は `e2e:shots` を明示的に走らせること |

---

## 付録: よく使うコマンド

```bash
# 全体
pnpm verify                                          # typecheck + lint + -r test
pnpm -r typecheck
pnpm lint
pnpm --filter @ojt/desktop test --no-file-parallelism
pnpm --filter @ojt/desktop test:coverage
pnpm --filter @ojt/content validate src/builtin

# 絞って走らせる（apps/desktop の中で）
npx vitest run <テスト名の一部>

# E2E（worktree で・前景で）
pnpm --filter @ojt/desktop e2e              # = playwright test --project=default（12 spec / 66件。図の撮り直しは含まない）
pnpm --filter @ojt/desktop e2e <spec名>
pnpm --filter @ojt/desktop e2e:shots        # = playwright test --project=manual-shots（追跡下のPNGを書き換える。Task 36）

# ビルド・配布
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop dist                      # check-dist.mjs が走り release/artifacts.md が出る

# 生成物
node apps/desktop/scripts/build-manual.mjs           # manual-content.ts
node apps/desktop/scripts/copy-content.mjs           # resources/content
node apps/desktop/scripts/feature-inventory.mjs      # coverage.json の源

# 課題数の確認（完了条件2）
ls packages/content/src/builtin/assemble/*.json | wc -l        # 20
ls packages/content/src/builtin/inspect-parts/*.json | wc -l   # 12
ls packages/content/src/builtin/inspect-repair/*.json | wc -l  # 20
ls packages/content/src/builtin/plc/*.json | wc -l             # 20
```

---

**最後に**: 迷ったら、まず `docs/superpowers/plans/2026-09-20-phase7-review-fixes.md` の当該 Task 節を読む。そこに書いていない判断が必要になったら、**選択肢つきで利用者に聞く**。勝手にタグを打たない（Task 38 だけが許可されている）。報告は必ず「修正タスク X / 41 完了」で締める。
