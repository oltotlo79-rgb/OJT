# レビュー対応と v1.1 設計仕様（Phase 7）

本書は、設計仕様 `docs/superpowers/specs/2026-09-13-ojt-electrical-trainer-design.md`（以下「本体仕様」）の §16 Phase 7 の行を実装するための詳細設計である。本体仕様の節番号は「§10.6」のように参照する。

対象アプリ名は **電気教育ツール**（本体仕様 §17.2 #18）。画面に出る文言はすべて日本語のみで、正本は `apps/desktop/src/renderer/i18n/ja.ts`（main 側は `src/shared/messages.ts`）に置く。各社のロゴ・アイコン・画面キャプチャ・マニュアル本文は一切複製しない（§15、§17.1）。

入力は2つある。

1. **プロジェクト評価レポート** `docs/reviews/2026-09-20-project-evaluation.md`（対象 HEAD `f659f51` = v1.0.0）。8軸の採点、指摘 **174件**（Critical 3 / High 24 / Medium 88 / Low 59）、5バッチの修正計画、UI/UX 改善提案 15件（PR-01〜PR-15）、除外・訂正した指摘。付録は `docs/reviews/2026-09-20-evaluation-appendix/`（R1〜R8 ＋ ベースライン）。
2. **利用者の要望**（2026-09-20）。本書 §1.2 に逐語で載せ、すべてに設計上の受け皿を用意する。

---

## 目次

- [1. 目的と範囲](#1-目的と範囲)
- [2. 決定表](#2-決定表)
- [3. 指摘174件のトリアージ](#3-指摘174件のトリアージ)
- [4. 課題の拡充](#4-課題の拡充)
- [5. 純正ツールの忠実な再現](#5-純正ツールの忠実な再現)
- [6. 取扱説明書・PDF・ヘルプの体裁刷新](#6-取扱説明書pdfヘルプの体裁刷新)
- [7. 3D盤の直接操作と UI/UX 刷新](#7-3d盤の直接操作と-uiux-刷新)
- [8. ビューキューブの不具合](#8-ビューキューブの不具合)
- [9. リリース版数](#9-リリース版数)
- [10. テスト戦略](#10-テスト戦略)
- [11. §16 Phase 7 の受入基準](#11-16-phase-7-の受入基準)
- [12. 改訂履歴](#12-改訂履歴)

---

## 1. 目的と範囲

### 1.1 目的

| # | 目的 | 満たし方 |
|---|---|---|
| 1 | v1.0.0 の評価で見つかった欠陥を、訓練者が踏む順に潰す | 174件のうち **171件を対応**し、3件は代替（仕様訂正）で閉じる（§3） |
| 2 | 練習の量と深さを増やす | 内蔵課題を **28題 → 72題**に増やし、各モードに難易度の段（1〜5）を入れる（§4） |
| 3 | モードDを「純正ツールを触ったことがある人が違和感を覚えない」水準にする | キー割当で記号が**実際に入る**こと、回路入力ダイアログ、カーソル意味論、未変換の見え方、ウィンドウ構成、モニタ表示を方言ごとに設計する（§5） |
| 4 | 取扱説明書とヘルプを「読める」ものにする | 表紙・柱・章番号・図番号・注意箱・本文幅を設計し、**もくじを押すと飛ぶ**ようにし、**チュートリアル章**を新設する（§6） |
| 5 | 説明を読まなくても操作が分かるようにする | 3D盤を**直接触れる**ようにする（電源のクリック、部品のドラッグ配置、端子から端子への配線、ホバー予告、初回ガイド）（§7） |
| 6 | 進み具合が常に分かるようにする | 実装プラン `docs/superpowers/plans/2026-09-20-phase7-review-fixes.md` の全タスクに番号を振り、報告は必ず `X/N` の形にする |

### 1.2 利用者の要望（2026-09-20、逐語。すべて拘束力がある）

| # | 要望（逐語） | 本書での受け皿 |
|---|---|---|
| 1 | 「docs\reviewsにこのプロジェクトをレビューさせた結果を出力した。内容を確認し妥当だと判断したものは対応して」 | §3 トリアージ（171件対応 / 3件は代替で閉じる） |
| 2 | 「各項目の問題量が少ないのでもっと拡充して(もっと複雑なものも)」 | §4 課題の拡充（28→72題、難易度の段と「難しさの作り方」） |
| 3 | 「各メーカのPLC回路入力画面も簡易なものになっているのでF5でA接点が入力されるなど各メーカーのソフトに実装されているデザインと仕様をもっと忠実に再現すること」 | §5 純正ツールの忠実な再現 |
| 4 | 「インストール時ライセンス契約書が文字化けしていた」 | §6.6（プラン **Task 1**。最優先で単独） |
| 5 | 「取扱説明書のPDFのデザインがシンプルすぎる。デザイン性向上すること。非常に読みにくい。ヘルプ画面も見にくい」 | §6.2（PDF の体裁）・§6.4（ヘルプ引き出し） |
| 6 | 「取扱説明書の目次を押すとその項目へ飛ぶようにすること」 | §6.3（PDF のもくじリンクとしおり、ヘルプのもくじ） |
| 7 | 「各機能や課題のチュートリアルの項目を取扱説明書に新設のこと。どこをどう操作するのか一連の操作の流れが分かるようにすること」 | §6.5（チュートリアル章 2本の新設） |
| 8 | 「3D図で上から正面にキューブを回そうとすると回らない」 | §8 ビューキューブの不具合 |
| 9 | 「操作が非常に分かりにくい。3D図をクリックして電源をON/OFFしたり配線したりドラッグして部品を配置したりできないし、操作説明がなくても直感的にこのツールを使用できるUI,UXに全くなっていない。UI,UX刷新して」 | §7 3D盤の直接操作と UI/UX 刷新（案A〜Cと採用理由、操作仕様、発見しやすさ、アクセシビリティ、テスト） |
| 10 | 「取扱説明書は全ての修正が終わってから必要な画像を取り直し、修正内容を反映した内容に編集すること」 | §6.7（撮り直しはプランの**最後から2番目のバッチ**。Phase 6 決定表 P13 の継承） |
| 11 | 「修正タスクがいくつに対していくつ終わったか都度報告すること」 | プランの全タスクに 1〜N の番号。`修正タスク番号 ↔ レビュー指摘ID ↔ 利用者要望` の対応表を持つ |
| 12 | 「終わったら新しいバージョンをリリースして」 | §9 リリース版数（**v1.1.0** を推奨）。プランの最終タスク |

### 1.3 範囲に含まないもの

| 含まない | 理由 |
|---|---|
| 新しい練習モード（E以降） | 要望に無い。既存4モードの質と量を上げることが Phase 7 の目的 |
| 多言語化 | 本体仕様 §1.2「UI 言語は日本語のみ」 |
| 進捗・成績の永続記録、結果の1枚印刷（PR-14） | 決定#5「進捗・成績の永続記録はしない」。PR-14 は境目にあたるので**所有者の判断待ち**として送る（§3.4） |
| 課題エディタ GUI、課題JSONの書き出し（PR-15） | 決定#9「GUI の課題エディタは対象外」。代わりに**課題データの検証 CLI**（`pnpm --filter @ojt/content validate`）を入れる（§4.6） |
| 判定の操作列の再生（PR-12）、模範との並置比較（PR-13） | 工数 M〜L／L。要望12項目を優先し Phase 8 へ送る（§3.4） |
| リリースの公開以外の配布（ストア登録・コード署名） | 署名証明書が無い。SmartScreen の回避手順は README とインストーラ説明画面のまま |

---

## 2. 決定表

| # | 決めたこと | 採用した設計 | 理由・却下した案 |
|---|---|---|---|
| D1 | **レポートの扱い** | `docs/reviews/` は**その時点の記録**として一切書き換えず、対応の記録は本書 §3 のトリアージ表とプランの対応表に持つ | レポート自身の「更新の作法」に従う。直したかどうかはコードとテストが示すのであって、レポートを塗り替えることではない |
| D2 | **174件をどう割るか** | レポート §5 の5バッチ（不具合／堅牢性／性能／構造とUI／プロセス）を**そのまま骨格として採用**し、利用者要望の4本（課題拡充・純正忠実・3D直接操作・説明書）を独立したバッチとして足す | レポートのバッチは依存関係（3D-01 が先、UI-05 が StepGuide の土台）を根拠にしており、作り直す理由が無い |
| D3 | **課題データの形式バージョン** | `CONTENT_FORMAT_VERSION` は **1 のまま**。`difficulty` と `tags` は既定値つきの任意フィールドとして足す | 既存の28題と利用者が作った課題JSONがそのまま読める。`z.strictObject` なのでスキーマ側の追加が先に要るが、ファイル側は書かなくてよい |
| D4 | **課題の増やし方** | B 8→20 / C1 4→12 / C2 8→20 / D 8→20（計 **72題**）。盤の物理制約（リレー4・タイマ2・PB4・PL4・BZ任意）を超えない範囲で回路を設計し、モードDだけは PLC 側のタイマ・カウンタ・内部リレーを使って更に複雑にする | 盤は `SOCKET_ROLES = CR1〜CR4 / T1 / T2 / CHK` で固定（`packages/board-model/src/roles.ts`）。B/C2 の「難しさ」は素子数ではなく**組合せと順序**で作る。D は `ladder-core` に制約が無いので段数・カウンタ・MC/MCR で伸ばせる |
| D5 | **純正ツールの情報の扱い** | §17.1 の前提方針を継続する。**一次資料で確認できたものは `confirmed: true`、慣例・本アプリ独自は `confirmed: false` ＋ `note`** を必ず付け、キー割当表と設定画面の注記に出す | 実機マニュアルは会員限定で入手できない。前提であることを隠さずに出すのが §17.1 の決定 |
| D6 | **キー割当が「効く」ことの保証** | 方言ごとに「表に `enabled !== false` で載っている行は、その通りのキーを押すと**必ず**対応する操作が起きる」ことを**網羅テスト**で縛る（4方言 × 全行） | LE-1（OMRON で英字キーが1つも一致せず記号を置けない）は、表と実装がテストで結ばれていなかったから起きた。同じ穴を二度と空けない |
| D7 | **PDF の体裁をどう作るか** | `PRINT_CSS` を全面的に書き直し、`@page` で版面と柱を定め、**見出しに `id` を振って `<a href="#…">` のもくじを出す**。しおりは既に入っている `generateDocumentOutline: true` に任せ、柱とノンブルは `displayHeaderFooter` ＋ `headerTemplate` / `footerTemplate` で出す | 生成系（`markdown-it` → HTML → `printToPDF`）を替えずに体裁だけ替えられる。新しい依存は0のまま |
| D8 | **PDF のもくじリンク** | `<a href="#ch-03">` のような**同一文書内リンク**を出す。Chromium の `printToPDF` は同一文書内アンカーを PDF のリンク注釈として出力する | 外部ツール（`pdf-lib` など）を足さずに済む。リンクが出ているかは `%PDF-` バイト列の `/Annots` と `/Dest` の存在で機械検査できる（§10） |
| D9 | **書体を同梱するか** | しない。`'Yu Gothic UI', 'Meiryo', sans-serif` のままとし、見出しだけ `font-feature-settings` と字間で締める | 日本語書体の同梱はライセンスと配布サイズ（1書体 5〜10MB）の両方に効く。対象は Windows 11 の社内PCで、両書体とも標準で入っている |
| D10 | **チュートリアル章の単位** | 章を2本足す。`13-tutorial-modes.md`（モード別に1題を最初から最後まで）と `14-tutorial-features.md`（機能別の操作の流れ）。**全72題は「課題の索引」節に表として載せ**、テストが「全課題IDが載っていること」を縛る | 72題ぶんの手順書は誰も読まない。読まれるのは「代表1題の通し」と「機能ごとの手順」。索引があれば「この課題は何を学ぶのか」は必ず引ける |
| D11 | **3D の直接操作の方式** | **案B: 対象で決まるモードレス操作**（§7.2）。既存のキーボード・端子リスト経路は**残す**（追加であって置換ではない） | 「操作説明がなくてもわかる」ことが要求なので、モード切替（案A）は要求と正面から衝突する。既存経路を消すと §15 のアクセシビリティ（キーボードのみで判定まで到達）が壊れる |
| D12 | **ストアの分割をいつやるか** | DS-3（1,683行の god store を4スライスへ）を **Phase 7 の前半**（バッチB）に置く。`useStore` の公開面は変えない | 3D直接操作・ヒント・ツアーはいずれもストアに状態を足す。足してから割ると衝突が大きい。公開面を変えないので後続タスクは無改修 |
| D13 | **図の撮り直しの位置** | プランの**最後から2番目のバッチ**。すべての画面直しが landed してから1回だけ撮る | 利用者の要望10。Phase 6 決定表 P13 の継続 |
| D14 | **リリース版数** | **v1.1.0**（§9）。課題JSON・作業ファイルの形式が変わらず、既存の操作経路を1つも消さないため | 完全な破壊的変更が無いので 2.0.0 は過大。ただし体感の変化は大きいので、所有者が 2.0.0 を選ぶ余地は残す（§9） |
| D15 | **レビューの回し方** | バッチごとに **Opus レビュー1回**。細かい指摘はまとめて1回で直す | 所有者の方針（2026-09-19「速度を採る」）。並行は2〜3系統まで |
| D16 | **共有ツリーの安全** | 並行するタスクは **worktree** で作業する。共有ツリーでは `git stash` / `git reset --hard` / `git clean` / `git commit --amend` を一切使わない。対象パスを明示した `git commit --only -- <paths>` で commit する | 2026-09-19 に stash で他タスクの作業が消えた事故の再発防止 |

---

## 3. 指摘174件のトリアージ

### 3.1 方針

- レポート自身が **INCORRECT として除外した 1件（CS-11）** は本書でも扱わない（174件には含まれていない）。
- **PARTIAL の12件**（CS-07 / DM-6 / 3D-06 / 3D-16 / LE-2 / LE-15 / UI-16 / UX-09 / UX-12 / UX-27 / QA-08 / QA-19 / QA-24）は、レポート §7.2 の**訂正後の内容**を正とする。原報告の数値・出典・機構の誤りは採らない。
- 判定は3つ。**対応する**（171件）／**代替で閉じる**（3件。実装ではなく仕様訂正やテスト固定で目的を達する）／**対応しない**（0件）。
- 表の「Task」はプラン `docs/superpowers/plans/2026-09-20-phase7-review-fixes.md` のタスク番号。

### 3.2 対応しない・代替で閉じるもの（3件）

| ID | 重要度 | 判定 | 理由（1行） | 代わりにやること |
|---|---|---|---|---|
| CS-02 | Medium | **代替** | `solver-warning`／直前解での置換／10tick停止は、1nS の漏れ抵抗により特異行列が発生しない設計なので実装しても到達しない。レポート自身が「後者推奨」と書いている | 本体仕様 §13 #3 を「1nS 漏れにより特異行列は発生しない前提」に書き換える（Task 14） |
| CS-03 | Medium | **代替** | 「LU分解を再利用する」は仕様の記述が実装より先走っただけで、実測で性能問題が出ていない（節点162・100Hz で 39.8 MiB/s は Chromium の若い世代GCの範囲） | 本体仕様 §5.2 を実装（毎tick 密行列のガウス消去）に合わせて訂正する。`Solver` クラス化は測ってから判断（Task 14） |
| CS-07 | Medium | **代替** | `elementIndex` → `elementId` への移行は、内蔵C2課題8題と利用者が作った課題JSONの `faults[].target.elementIndex` を**すべて書き換える**破壊的変更にあたる | `createTimer4c` の要素の並びを配列全体で固定するテストを足し、JSDoc に「この並びは課題JSONの契約である」と明記する（Task 12）。移行は Phase 8 の課題形式更新とまとめる |

### 3.3 対応する 171件（エリア別）

表記: **Task** はプランのタスク番号。`≡` は重複統合された別ID。

#### R1 エンジン（`circuit-sim` / `board-model`）— CS / BM

| ID | 重要度 | 対応 | Task |
|---|---|---|---|
| CS-01 | High | Ωキャッシュを削除し同一tickの回路変更を反映する | 5 |
| CS-04 | Medium | `solve()` の `allElements()` を1回にする | 14 |
| CS-05 | Medium | `validateNetlist()` に部品ID・要素IDの重複検査 | 10 |
| CS-06 | Medium | 死にフィールド `LoadElement.polarized` を削除しコメントを実装に合わせる | 12 |
| CS-08 | Medium | `equivalentResistance()` の後始末を `lastIndexOf`＋`splice` に | 14 |
| CS-09 | Medium | `step()`／`run()` に有限性・正値の検査、コンストラクタで `validateNetlist()` | 10 |
| CS-10 | Low | バレルの export 漏れ2件 | 12 |
| CS-12 | Low | `range-exceeded` の重複判定キーに `kind` と `ohmRange` | 10 |
| CS-13 | Low | `contact-welded` の無言上書きを止める | 10 |
| CS-14 | Low | `wire-misrouted` に自己ループ・本数上限の検査 | 10 |
| BM-01 | High | 机上ケーブルの引き出しを「その帯の実数で中央そろえ」に | 6 |
| BM-02 | High | レーン一巡時に走行高さを一段上げる `layer` を導入 | 6 |
| BM-03 | Medium | 幹線レーンの上限と高さ段上げ、`deskRouteIssues()` に検査2件 | 6 |
| BM-04 | Medium | `deskRouteIssues()` をテストから実際に呼ぶ（2ケース追加） | 6 |
| BM-05 | Low | 配線帯グラフを盤ごとに1回メモ化 | 14 |
| BM-06 | Low | `@deprecated` 3定数をバレルから外す | 12 |
| BM-07 | Low | `plcFaces()` の冗長な `.sort()` を落とす | 14 |

#### R2 コンテンツ（`content` / `schematic-core`）— CT / SC

| ID | 重要度 | 対応 | Task |
|---|---|---|---|
| CT-01 | High | `StaticChecksSchema` の個別 `.default()` を外しモード既定とマージ | 5 |
| CT-02 | Medium | 課題エラー検査を共通化して C2 でも呼ぶ | 5 |
| CT-03 | Medium | `targeted` を部品にも広げ重複を課題エラーに | 5 |
| CT-04 | Medium | `seed` 明示時は壁時計の時間予算を外す（決定論の回復） | 5 |
| CT-05 | Medium | `compareSignals` の既定を `resolveCompareSignals()` の結果に対して検査 | 5 |
| CT-07 | Low | `judgePlc` の `traineeNetlist` を変換失敗判定の後ろへ | 14 |
| CT-08 | Low | バレルの取りこぼし2件と `exports` 経路 | 12 |
| CT-09 | Low | `BUILTIN_PROBLEMS` の陳腐化コメントを直す | 12 |
| CT-10 | Low | `findForbiddenPatterns()` の `buildNets()` を1回に | 14 |
| CT-11 | Low | `loadOne` の重複ID検査を `Set` に | 9 |
| CT-12 | Low | `checkIoAssignment` を検査ごとの純関数に割る | 12 |
| CT-13 | Low | `faults` の union に親エラー文言を与える | 10 |
| CT-14 | Low | `ResolveFaultsResult` に `seed` を載せ作業ファイルへ保存 | 10 |
| SC-01 | High | 要素IDが `Object.prototype` のキー名でも落ちないよう `Object.hasOwn` に | 5 |
| SC-02 | High | `terminalMarks(doc, override?)` にして図と判定の端子番号を一致させる | 5 |
| SC-03 | Medium | `presetProblem()` に `snapPresetToStep` 検査 | 5 |
| SC-04 | Low | `DEVICE_PATTERNS` / `CELL_KIND_LABELS` も `Object.hasOwn` 経由に | 5 |
| SC-05 | Low | 生成電線ID `sw-NNN` の契約を文書化しテストで固定 | 10 |
| SC-06 | Low | 既設配線の索引を1回だけ作る | 14 |

#### R3 デスクトップ中核（main / worker / store）— DM / DW / DS

| ID | 重要度 | 対応 | Task |
|---|---|---|---|
| DM-1 ≡ CT-06 | High | 課題フォルダの件数・サイズ上限と非同期化 | 9 |
| DM-2 | Medium | `workfile:save` の入口検査（型・`safeFileName()`・サイズ上限） | 9 |
| DM-3 | Medium | `userContentDir` の長さ・絶対パス検証 | 9 |
| DM-4 | Medium | `sandbox: true` 化（preload を CJS 出力に） | 8 |
| DM-5 ≡ QA-05 | Medium | 権限ハンドラ・3フラグ明示・`electronFuses` 6項目 | 8 |
| DM-6 | Medium | `src/main/fs-atomic.ts` に1本化し `fsync`＋失敗時 `.tmp` 削除 | 9 |
| DM-7 | Medium | `hardening.test.ts` / `ipc-surface.test.ts` を新設 | 8 |
| DM-8 | Medium | `errno` → 日本語の対応表、生エラーは `console.error` だけ | 9 |
| DM-9 | Low | CSP に `base-uri` / `form-action` / `frame-src` / `frame-ancestors` | 8 |
| DM-10 | Low | 設定ファイル読み直しのキャッシュ | 14 |
| DW-1 ≡ LE-11 | Medium | `recordPowered?` の切替、設定値表のキャッシュ、Map の直読み | 15 |
| DW-2 | Medium | 外側 `switch` に `default: command satisfies never` | 10 |
| DW-3 | Low | 死にコマンド `reset` の扱いを決める（削除） | 12 |
| DS-1 | High | 表記切替で `sessionEpoch` を進め Worker の旧ネットリストを捨てる | 7 |
| DS-2 ≡ UI-02 | High | ライブ波形の点数上限と 500ms 量子化 | 15 |
| DS-3 | Medium | `store.ts` を4スライスへ、`sessionFields()` で初期値を1本化 | 11 |
| DS-4 | Medium | 自動保存の失敗を受けて2回目にトースト | 9 |
| DS-5 | Low | 書くだけで読まれない `WorkerBridge.handlers` を削除 | 12 |
| DS-6 | Low | 仕様チャートのキャッシュ鍵に課題の版を入れる | 15 |

#### R4 3D（`renderer/three`）— 3D

| ID | 重要度 | 対応 | Task |
|---|---|---|---|
| 3D-01 | **Critical** | `gl.info.autoReset = false` ＋ `PerfProbe` での `reset()`、予算の測り直し | 16 |
| 3D-02 | High | 差込穴112個を共有ジオメトリ1個に | 17 |
| 3D-03 | High | 点光源を固定本数にし `intensity` だけ動かす | 17 |
| 3D-04 | High | 固定機器の印字テクスチャを共有キャッシュへ | 17 |
| 3D-05 | Medium | `FixedWires` の `TubeGeometry` 20本を解放 | 17 |
| 3D-06 | Medium | `MountedPart` のマテリアルと `EdgesGeometry` を共有に | 17 |
| 3D-07 | Medium | `ProbeMarkers` に `board` prop を渡す | 6 |
| 3D-08 | Medium | 印字テクスチャの `minFilter` をミップ有効に | 17 |
| 3D-09 | Medium | 当たり判定チューブを `visible={false}` に、コメント2箇所を訂正 | 17 |
| 3D-10 | Medium | 名札の重なり取りに `.socket-label` / `.part-label` を足す | 24 |
| 3D-11 | Medium | `CameraPresets` の派生盤を `useMemo` に | 17 |
| 3D-12 | Medium | 机上端子を `TerminalField` に畳む | 17 |
| 3D-13 | Medium | 印字テクスチャのキャッシュを `labels.ts` に一本化 | 12 |
| 3D-14 | Medium | `LABEL_FONT` 定数を作り実測表と焼き込みの書体を一致させる | 12 |
| 3D-15 | Medium | ビューキューブのドラッグ中の2本目のポインタを無視 | 19 |
| 3D-16 | Medium | `ViewGizmo.tsx` を layout / paint / drag の3本に割る | 19 |
| 3D-17 | Low | WebGL コンテキスト喪失の告知を4画面に出す | 24 |
| 3D-18 | Low | 死んだ `presetForDirection()` を削除しテストを本番経路へ向ける | 12 |
| 3D-19 | Low | 面ラベルの情報源を1本化し本番側をテストする | 19 |
| 3D-20 | Low | 使っていない `receiveShadow` を外す | 12 |
| 3D-21 | Low | `buildTubeGeometry()` の点数ガードを生成の前へ | 6 |
| 3D-22 | Low | `LabelDeclutter` の書き込みを「前回と違うときだけ」に | 17 |

#### R5 PLC（`ladder-core` / `plc-dialects` / `renderer/ladder`）— LC / PD / LE

| ID | 重要度 | 対応 | Task |
|---|---|---|---|
| LE-1 | **Critical** | キー照合の大小文字畳み込み。**さらに §5 でキー表そのものを純正に合わせる** | 2, 20 |
| LE-2 | **Critical** | undo で行が減ったあとのカーソル丸めと `cells[row]?.[col]` | 2 |
| LE-3 | Medium | END セルの上書き・削除を拒否する | 2 |
| LE-4 | Medium | シャープ方言のタイマ設定値が往復で 1/100 に化けるのを直す | 3 |
| LE-5 | Medium | OR接点直後のカーソルを「閉じ側の縦線の次」へ | 2 |
| LE-6 | Medium | `DialectProfile.timerBaseMs(device)` を足し三菱固有の丸めを方言へ戻す | 3 |
| LE-7 | Medium | `monitorStartLabel(profile)` を足し `?? 'F3'` の嘘を消す | 3 |
| LE-8 | Medium | OMRON の効かない3行に `enabled:false` と `note`（**§5 で実際に動かす方へ倒す**） | 3, 20 |
| LE-9 | Medium | 利用者向けエラー文言から内部識別子を追い出す | 3 |
| LE-10 | Medium | `GridCell` / `NetworkView` を `memo` にし `selected: boolean` を渡す | 15 |
| LE-12 | Medium | `DeviceInput` の `Enter` に `isComposing` ガード | 3 |
| LE-13 | Medium | `Escape` でラダーエディタから抜けられるようにする | 3 |
| LE-14 | Medium | モードDの保存・読込の Promise に `.catch` | 3 |
| LE-16 | Low | `CommentPanel` の JSDoc と実装の食い違いを直す | 12 |
| LE-17 | Low | 使われていない互換 export 4本を削除 | 12 |
| LE-18 | Low | ペイン幅を `ResizeObserver` で追う | 22 |
| LC-1 | Medium | END と同じネットワークに置いた回路を `after-end` にする | 2 |
| PD-1 | Medium | 4方言の `parse*` 先頭で `NFKC` 正規化（全角入力を通す） | 3 |
| PD-2 | Low | `timerPreset()` と `timerErrorCode()` の二重実装を1本に | 3 |
| PD-3 | Low | `special` デバイス番号を `SPECIAL_INDEXES` に制限 | 10 |

#### R6 UI コード（screens / panels / result / schematic / help / i18n / CSS）— UI

| ID | 重要度 | 対応 | Task |
|---|---|---|---|
| UI-01 | High | Ωレンジのまま部品を挿し替えるとプローブが再配置される不具合 | 7 |
| UI-03 | Medium | 「⋯」メニューを Esc・外側クリック・項目選択で閉じる | 24 |
| UI-04 | Medium | 内部の電線ID（`w-003`）を表示名に | 7 |
| UI-05 | Medium | 4セッション画面の外殻を共通化（`errors.ts` / `use-session-runtime.ts` / `StepGuide` / `work-file.ts` / `NoProblem`） | 11 |
| UI-06 | Medium | `trapFocus` を `app/focus-trap.ts` に1本化 | 11 |
| UI-07 | Medium | 手順帯を1実装・1CSSに統合 | 11 |
| UI-08 | Medium | 紙のパレットを `:root` のトークンへ寄せる | 23 |
| UI-09 | Medium | 設定の `patchIfChanged()`（変わっていないのに保存しない） | 24 |
| UI-10 | Low | チャートのカーソル線の二重登録を解消 | 15 |
| UI-11 ≡ LE-15 | Low | 描画中の ref 読み書き6箇所を `useEffect` へ | 12 |
| UI-12 | Low | `role="toolbar"` に `aria-label` と roving tabindex | 24 |
| UI-13 | Low | 4つの結果画面を `ResultShell` に畳む | 11 |
| UI-14 | Low | 回路図ヒントの `aria-label` を `onPickCell` の有無で分ける | 7 |
| UI-15 | Low | 未使用の日本語キー9件と別名定義8組を整理し、`i18n-keys.test.ts` で再発を止める | 12 |
| UI-16 | Low | インライン style 8箇所を CSS クラスへ | 23 |
| UI-18 | Low | `AudioContext` を最初のジェスチャで resume、死んだ `close()` を削除 | 24 |
| UI-19 | Low | 絞り込みボタンの `key` を安定値に | 24 |
| UI-20 | Low | `viewBox` を数値のまま持つ | 23 |
| UI-21 | Low | 指摘ポップオーバーに `aria-live` とフォーカス移動 | 24 |

#### R7 UX（使いやすさ・直感性）— UX

| ID | 重要度 | 対応 | Task |
|---|---|---|---|
| UX-01 | High | 0Ω調整の「押せない理由」が逆。文言と説明書を直す | 7 |
| UX-02 | High | ラダー記号をマウスで置けない。**§5 の回路入力ダイアログで解決**（PR-01 を包含） | 21 |
| UX-03 | High | 判定が押せない理由を `aria-disabled` ＋ `.srOnly` ＋ 押下時トーストで読めるように | 7 |
| UX-04 | High | 回路図エディタで「いまここ」が2つ出る | 7 |
| UX-05 | High | ホームの「最近の課題」を押せるようにする | 25 |
| UX-06 | Medium | 押せないボタンの見た目と無反応を直す | 7 |
| UX-07 | Medium | 端子リストを `<details>` にし右の欄の並びを変える（PR-08） | 24 |
| UX-08 | Medium | 「部品」パネルにソケット一覧を出す。**§7 でパレット化**する | 27 |
| UX-09 | Medium | 模範波形を `--muted` ＋ 破線に | 23 |
| UX-10 | Medium | `.socket-label` / `.part-label` を 12px に上げる（**本体仕様 §8.2 の改訂を伴う**） | 24 |
| UX-11 | Medium | 差分一覧の信号名を表示名に | 25 |
| UX-12 | Medium | 差分の理由を平易な言い回しに | 25 |
| UX-13 | Medium | 結果に「なぜ落ちたか」1行要約と「最初に直す1件」（PR-03） | 25 |
| UX-14 ≡ UI-17 | Medium | 通電・保護動作を色だけで表さない（文字と形を足す。PR-07） | 23 |
| UX-15 | Medium | 視点操作の早見表をカードにして 12px に | 24 |
| UX-16 | Medium | 設定のスキン注記を `<details>` に畳む | 24 |
| UX-17 | Medium | 文字サイズ・UI倍率・高コントラストの設定（PR-06） | 26 |
| UX-18 | Medium | 課題一覧の行クリックと ID 列の移動（PR-09） | 25 |
| UX-19 | Medium | 「はじめての方はここから」と級のおすすめ（PR-09） | 25 |
| UX-20 | Medium | C1 マークシートを表にする | 24 |
| UX-21 | Medium | ヘルプ引き出しの幅と本文幅 | 32 |
| UX-22 | Medium | C2 の「故障の種別」に選択肢が1つしか出ない理由を書く | 7 |
| UX-23 | Low | 回路図エディタのキー早見表を `<dl>` に | 24 |
| UX-24 | Medium | 説明書と実装の食い違い4箇所（①②③は実装を直し④は説明書を直す） | 7, 33 |
| UX-25 | Low | 保存・読込・視点を「⋯」から出す（広い幅では開いたまま） | 24 |
| UX-26 | Low | 線色ボタンに色見本（PR-07） | 23 |
| UX-27 | Low | 機械点検のしきい値を 12px / 32px に上げ基準値を実測に合わせる | 30 |
| UX-28 | Low | ホーム下半分に「続きから」「はじめての方へ」（PR-04 の入口） | 25 |
| UX-29 | Low | モード名の副題から内部識別子を外す | 25 |
| UX-30 | Low | 判定中の不定進捗 | 24 |

#### R8 ツール・テスト・ビルド・文書 — QA

| ID | 重要度 | 対応 | Task |
|---|---|---|---|
| QA-01 | High | `pnpm verify` と GitHub Actions の CI | 29 |
| QA-02 | High | `manual-shots.spec.ts` を既定プロジェクトから外す | 30 |
| QA-03 | High | 順序依存の spec を `.serial(` にする | 30 |
| QA-04 | High | `trace` / `screenshot` / `forbidOnly` / html reporter | 30 |
| QA-06 | Medium | `build/icon.ico` を追加し `check-dist.mjs` で存在検査 | 8 |
| QA-07 | Medium | **ライセンス表示の文字化け**（利用者要望4）。BOM 付きで保存し `.gitattributes` に `-text` | **1** |
| QA-08 | Medium | `OJT_PACKAGES` を `dependencies` 由来にし同集合テスト | 31 |
| QA-09 | Medium | 配布ゲートに asar 目次・`%PDF-`・JSON内容・サイズ下限 | 31 |
| QA-10 | Medium | `apps/desktop` に `test:coverage`（閾値なし・可視化のみ） | 29 |
| QA-11 | Medium | `ui-quality.spec.ts` にラチェット警告を実装 | 30 |
| QA-12 | Medium | E2E を一時 `--user-data-dir` に隔離 | 30 |
| QA-13 | Medium | `e2e/app.ts` に起動定型を集約 | 30 |
| QA-14 | Medium | `scripts/*.mjs` を `tsc` と型情報 ESLint に掛ける | 29 |
| QA-15 | Medium | `check-dist.mjs` を検査関数に割り実際に実行するテスト | 31 |
| QA-16 | Medium | PDF の生成日を `OJT_MANUAL_DATE` → `git log` → 今日 の順に | 31 |
| QA-17 | Low | 成果物名を ASCII（`DenkiKyoikuTool-${version}-${arch}.${ext}`）に | 31 |
| QA-18 | Low | `nsis.allowElevation: false` | 8 |
| QA-19 | Low | `copy-content.mjs` が正本に無いモードフォルダを消す | 31 |
| QA-20 | Medium | 本体仕様の改訂履歴・§14.2・§15・§17 を実態に直す | 14, 33 |
| QA-21 | Medium | 引き継ぎ文書を `PROJECT-LOG.md` に改名し QA-02 の注意の正本を README へ | 33 |
| QA-22 | Medium | `CONTRIBUTING.md` / `LICENSE` / `packages/*/README.md` | 33 |
| QA-23 | Low | `.nvmrc` と `engines.node` と `.npmrc` を実態に合わせる | 29 |
| QA-24 | Low | root の vitest デッドコンフィグを整理 | 29 |
| QA-25 | Low | `test/helpers/worker-bridge.ts` に13複写を畳む | 12 |
| QA-26 | Low | 集計テストの残骸読み込みを環境変数条件に | 30 |

### 3.4 UI/UX 改善提案（PR-01〜PR-15）の扱い

| 提案 | 判定 | Task / 理由 |
|---|---|---|
| PR-01 ラダー記号をクリックで置く | 対応する | Task 21（§5 の回路入力ダイアログに統合。純正にもツールバーの記号入力があるので決定#15 に触れない） |
| PR-02 ヒントボタン（段階的に開く） | 対応する | Task 25 |
| PR-03 結果の「なぜ落ちたか」1行要約 | 対応する | Task 25 |
| PR-04 はじめての人向けの3分ツアー | 対応する | Task 28（初回ガイドに統合） |
| PR-05 ショートカット早見表のオーバーレイ | 対応する | Task 22（`Shift + ?`。§5 のキー割当と同じデータ源） |
| PR-06 文字とUIの大きさ・高コントラスト | 対応する | Task 26 |
| PR-07 色に頼らない線色表現と凡例 | 対応する | Task 23 |
| PR-08 右の欄を畳めるようにする | 対応する | Task 24 |
| PR-09 課題一覧の学習導線 | 対応する | Task 25（課題が72題に増えるので必須になった） |
| PR-10 練習タイマーの残り時間表示 | 対応する | Task 24 |
| PR-11 端子リストと3D盤の相互ハイライト | 対応する | Task 27（§7 のホバー予告と同じ仕組みで出る） |
| PR-12 判定の操作列を1歩ずつ再生する | **対応しない** | 工数 M〜L。判定が Worker の並走で行われるため再生は別経路になり、判定と食い違えば害になる。Phase 8 へ |
| PR-13 模範と自分を並べて見る比較ビュー | **対応しない** | 工数 L。PR-03 の「なぜ落ちたか」で当面の目的（次の一手）は満たせる。Phase 8 へ |
| PR-14 結果の1枚印刷 | **対応しない（所有者判断待ち）** | 決定#5「進捗・成績の永続記録はしない」の境目。§9 の確認事項として送る |
| PR-15 課題JSONを回路図エディタから書き出す | **対応しない（代替あり）** | 決定#9「GUI の課題エディタは対象外」。代わりに検証 CLI（§4.6）を入れる |

---

## 4. 課題の拡充

### 4.1 いまの数と、増やしたあとの数

| モード | フォルダ | いま | 増やす | あと | 級の内訳（あと） |
|---|---|---:|---:|---:|---|
| B 回路組立 | `packages/content/src/builtin/assemble/` | 8 | +12 | **20** | 3級 8 / 2級 7 / 1級 5 |
| C1 部品点検 | `.../inspect-parts/` | 4 | +8 | **12** | 2級 7 / 1級 5 |
| C2 点検・修復 | `.../inspect-repair/` | 8 | +12 | **20** | 2級 10 / 1級 10 |
| D PLC | `.../plc/` | 8 | +12 | **20** | 2級 10 / 1級 10 |
| **合計** | | **28** | **+44** | **72** | |

級の制約は既存スキーマのまま守る。`assemble` は `hints.schematicVisible === (grade === 3)`、`inspect-repair` は 3級禁止かつ `hints.schematicVisible === (grade === 2)`、`plc` は 3級禁止。したがって **3級はモードBだけ**にある。

### 4.2 難しさをどう作るか（盤の物理制約の中で）

盤は `SOCKET_ROLES = ['CR1','CR2','CR3','CR4','T1','T2','CHK']` で固定されており、**リレー4個・タイマ2個・押ボタン4個・ランプ4個（＋任意のブザー1個）**が上限である（`packages/board-model/src/roles.ts` / `catalog.ts`）。素子を増やすことはできないので、難しさは次の6つの軸で作る。

| 軸 | 難しくする手 | 効く範囲 |
|---|---|---|
| 1. 接点の直列・並列の段数 | AND 3段・OR 3並列・AND-OR の混在。`schematic` の `rungs` が増える | B / C2 |
| 2. インタロック | 相互インタロック（2方向）、先行優先／後行優先、三者択一（早押し） | B / C2 / D |
| 3. タイマの多段 | T1 → T2 の順次、T1 と T2 の同時起動で時間差、オフディレー（自己保持＋タイマ）、ワンショット（タイマ b接点で自分を切る） | B / C2 / D |
| 4. カウンタ | 押した回数で段が進む、規定回数で警報、リセット条件つき | **D のみ**（盤にカウンタ部品は無い） |
| 5. 故障の組合せ | 2箇所 → 3箇所、種別を混ぜる（断線＋接触不良、誤配線＋部品不良）、「動くのに遅い」接触抵抗、レアショート | C1 / C2 |
| 6. 観測のしにくさ | 「症状が出るのが数秒後」「特定の順序でしか出ない」「暗点灯でしか分からない」 | C2 |

### 4.3 難易度の段（スキーマの追加）

`packages/content/src/schema/common.ts` の `ProblemHeaderShape` に**任意フィールドを2つ**足す。`CONTENT_FORMAT_VERSION` は **1 のまま**（既定値があるので既存ファイルはそのまま読める。決定 D3）。

```ts
/** 同じ級の中での難しさ。1=いちばんやさしい 〜 5=いちばん難しい。§16 Phase 7 */
export const DifficultySchema = z.int().min(1).max(5);

/** 学習テーマ。課題一覧の絞り込みと説明書の索引が使う。 */
export const ProblemTagSchema = z.enum([
  'self-hold',      // 自己保持
  'interlock',      // インタロック
  'timer',          // タイマ
  'multi-timer',    // 多段タイマ
  'counter',        // カウンタ
  'priority',       // 優先（先行・後行・停止）
  'sequence',       // 順次動作
  'flicker',        // 点滅
  'alarm',          // 警報・ブザー
  'and-or',         // 接点の直並列
  'fault-wire',     // 電線の故障
  'fault-part',     // 部品の故障
  'fault-contact',  // 接触不良
  'measure',        // 測定で切り分ける
]);
```

`ProblemHeaderShape` への追加（既定値つきなので JSON 側は省略可）:

```ts
  difficulty: DifficultySchema.default(3),
  tags: z.array(ProblemTagSchema).max(6).default([]),
```

既定値の決め方: 既存28題は `difficulty` を手で付け直す（3級=1〜2、2級=2〜4、1級=4〜5）。**級は検定の形式**、**`difficulty` は同じ級の中の並び**という役割分担にする。

### 4.4 新しい課題の題材（モード別）

数と ID の採番規則は `b-009`〜`b-020` のように既存の続きにする。

**モードB（+12。`b-009`〜`b-020`）**

| ID | 級 | 難 | 題材 | 新しく効く軸 |
|---|---:|---:|---|---|
| b-009 | 3 | 1 | 押している間だけ点く（自己保持なし。最初の1題） | — |
| b-010 | 3 | 2 | AND 条件の点灯（2つ押している間だけ） | 1 |
| b-011 | 3 | 2 | OR 条件の点灯（どちらかで点く） | 1 |
| b-012 | 3 | 2 | 自己保持＋停止優先（`b-001` の一段上） | 2 |
| b-013 | 2 | 3 | 両手押し（2つ同時でないと動かない）＋表示灯 | 1, 2 |
| b-014 | 2 | 3 | オフディレー消灯（離してから数秒点いている） | 3 |
| b-015 | 2 | 3 | 相互インタロック（正転・逆転を同時に入れない） | 2 |
| b-016 | 2 | 4 | 3段順次点灯（T1→T2 で PL1→PL2→PL3） | 3 |
| b-017 | 1 | 4 | 後行優先（あとから押したほうが勝つ） | 2 |
| b-018 | 1 | 4 | 点滅＋警報ブザー（`extraParts: ['BZ']`） | 3, — |
| b-019 | 1 | 5 | 条件付き自己保持（タイマが上がるまで切れない） | 2, 3 |
| b-020 | 1 | 5 | 2タイマの重ね合わせ（起動遅れ＋動作時間の両方） | 3 |

**モードC1（+8。`c1-005`〜`c1-012`）** — `PartTruth` は `normal / coil-open / coil-layer-short / a-open / a-weld / b-open / b-weld` の7種。新しい8セットで「1セット内の似た症状の見分け」を作る。

| ID | 級 | 難 | ねらい |
|---|---:|---:|---|
| c1-005 | 2 | 2 | a接点断線だけを2個の中から見つける（最小の1題） |
| c1-006 | 2 | 3 | a接点溶着と b接点断線の見分け（どちらも「動いているように見える」） |
| c1-007 | 2 | 3 | コイル断線とレアショートの見分け（動作するかどうかで切る） |
| c1-008 | 2 | 3 | タイマの接点不良（時間は合っているのに出ない） |
| c1-009 | 2 | 4 | 4個中3個が正常（「全部壊れているわけではない」を体験する） |
| c1-010 | 1 | 4 | b接点溶着（切れない）を含む混合4個 |
| c1-011 | 1 | 5 | リレー2＋タイマ2の混合で、症状が2個に分かれる |
| c1-012 | 1 | 5 | 全種類が1個ずつ出る総合（6種＋正常2） |

**モードC2（+12。`c2-009`〜`c2-020`）** — 既存8題は B の回路に対応している。新しい12題は B の新題材に対応させ、故障の**数と種別の混合**で段を作る。

| ID | 級 | 難 | 元の回路 | 故障 |
|---|---:|---:|---|---|
| c2-009 | 2 | 2 | b-010（AND） | 電線1本の断線だけ |
| c2-010 | 2 | 2 | b-011（OR） | 誤配線1箇所だけ |
| c2-011 | 2 | 3 | b-012（停止優先） | 接触不良1＋断線1 |
| c2-012 | 2 | 3 | b-013（両手押し） | 部品不良1＋誤配線1 |
| c2-013 | 2 | 3 | b-014（オフディレー） | タイマ接点の断線（時間だけ合っている） |
| c2-014 | 2 | 4 | b-015（相互インタロック） | インタロック側の b接点が溶着（同時に入ってしまう） |
| c2-015 | 1 | 4 | b-016（3段順次） | 2段目だけ出ない（2箇所） |
| c2-016 | 1 | 4 | b-017（後行優先） | 接触抵抗で「遅れて動く」 |
| c2-017 | 1 | 5 | b-018（点滅＋ブザー） | ランプ断線＋電線断線（ブザーは鳴る） |
| c2-018 | 1 | 5 | b-019（条件付き自己保持） | 3箇所（断線・接触不良・誤配線） |
| c2-019 | 1 | 5 | b-020（2タイマ） | コイルのレアショートで片方だけ暗点灯 |
| c2-020 | 1 | 5 | b-008（停止優先＋警報） | ランダム故障（`random.count: 3`、`fallback` 3件） |

**モードD（+12。`d-009`〜`d-020`）** — PLC 側にはリレー4・タイマ2の制約が無い。`ladder-core` は `TON` / `CTU` / `SET` / `RST` / `P` / `F` / `MC` / `MCR` / 特殊リレー（常時ON・初期パルス・1秒クロック）を持つ。

| ID | 級 | 難 | 題材 | 使う仕掛け |
|---|---:|---:|---|---|
| d-009 | 2 | 2 | 押している間だけ出力（最小の1題） | `LD`/`OUT` |
| d-010 | 2 | 2 | AND・OR の組合せ | 直並列 |
| d-011 | 2 | 3 | SET / RST による自己保持 | `SET`/`RST` |
| d-012 | 2 | 3 | 立上り微分でワンショット | `P` 接点 |
| d-013 | 2 | 3 | オフディレー（タイマ＋自己保持） | `TON` |
| d-014 | 2 | 4 | 相互インタロック（2出力） | 直並列＋`NC` |
| d-015 | 1 | 4 | 3段順次（T1→T2→T3） | 多段 `TON` |
| d-016 | 1 | 4 | 押した回数で段が進む（3段） | `CTU` |
| d-017 | 1 | 5 | 規定回数で警報＋リセット | `CTU`＋`RST` |
| d-018 | 1 | 5 | 1秒クロックで点滅、押している間だけ | 特殊リレー |
| d-019 | 1 | 5 | `MC`/`MCR` で運転条件をまとめる | `MC`/`MCR` |
| d-020 | 1 | 5 | 総合（カウンタ＋タイマ＋インタロック＋警報） | 全部 |

### 4.5 課題を足すときに必ず直るもの（機械で縛る）

新しい課題を足すと**必ず**落ちる場所が既にある。プランはこれをタスクの Steps に逐語で持つ。

| 直す場所 | 何が要るか |
|---|---|
| `packages/content/src/builtin/index.ts` | JSON 1件につき `import … with { type: 'json' }` 1行＋配列への追加 |
| `packages/content/test/builtin.test.ts` | `toHaveLength(8)` → `20`、ID 一覧の伸長 |
| `packages/content/test/builtin-inspect-parts.test.ts` | `toHaveLength(4)` → `12`、ID 一覧 |
| `packages/content/test/builtin-c2-discrimination.test.ts` | `toHaveLength(8)` → `20`、ID 一覧、級の内訳、**`REPAIRS` に新12題の修復手順**（手書き。これが無いと新題は黙って未検証） |
| `packages/content/test/builtin-plc.test.ts` | ID 一覧と級の内訳、`plc-cross-validation.test.ts` の `toHaveLength(8)` → `20` |
| `packages/content/test/index.test.ts` | 「内蔵課題は28題」→「72題（B 20 / C1 12 / C2 20 / D 20）」 |
| `apps/desktop/test/content-resources.test.ts` | `WIRED_FILES` に新ファイル、総数 |
| `apps/desktop/test/content-loader.test.ts` / `problem-modes.test.ts` | 「28題」の文言と期待値 |
| `apps/desktop/scripts/copy-content.mjs` | **手で1回実行**して `apps/desktop/resources/content/` を更新する（`dist` の中でしか走らない） |
| `docs/releases/*.md` / `README.md` | 題数の記述 |

**自動で新題を検証してくれるもの**（loop 形式のテスト。新題は足すだけで検査される）: `builtin-inspect-repair.test.ts`（各故障が単独で差分を出すこと・故障0で差分0）、`builtin-plc-discrimination.test.ts`、`builtin-timer-preset.test.ts`、`coil-lamp-polarity.test.ts`、`sim-worker-repair-matrix.test.ts`、`spec-chart-repair.test.ts`。

**新題が満たさなければならない不変条件**（`timechart.ts` / スキーマ由来）:

1. `startsAndEndsLow()` — 比較する全信号が `0ms` と `durationMs` で OFF。つまり**操作列は必ず全部を落としてから終わる**。
2. `durationMs >= 最後の操作時刻 + TICK_MS`、`durationMs` は 10ms の倍数で 10〜600000ms。
3. 操作の `t` は 10ms の倍数で非減少、`target` は `PB1`〜`PB4`。
4. タイマの `presetMs` は `DEFAULT_TIMER_PRESET_MS`（100ms）と**異なる**こと（既定のつまみのまま合格させない）。
5. B/C2: 模範 `schematic` が `validateDocument()` を通り、`judgeReference` が合格すること。
6. D: `referenceLadder` が `compile()` を通り、`io` と使用デバイスが一致し、`judgePlcReference` が合格すること。4方言すべてで `plc-cross-validation` を通ること。
7. C1: 1セットに `normal` と不良を混ぜ、タイマに `coil-layer-short` を置かないこと。

### 4.6 課題データの検証 CLI（PR-15 の代替）

`packages/content` に `validate` スクリプトを足す。GUI エディタ（決定#9 で対象外）ではなく、**手書きした JSON が正しいかを確かめる道具**である。

```
pnpm --filter @ojt/content validate <ファイルまたはフォルダ>
```

やること: `parseProblem()` に通す → モード別の自己整合検査（B/C2 は模範回路で `judgeReference` が合格するか、D は `judgePlcReference`、C1 は `expectedCheckReading` との突き合わせ）→ `startsAndEndsLow()` → 結果を日本語で1件1行。終了コードは失敗件数。説明書の「指導者向け」章（`10-authoring.md`）にこのコマンドを足す。

---

## 5. 純正ツールの忠実な再現

### 5.1 いまの姿と、足りないもの

いまの実装は「方言プロファイル（`packages/plc-dialects`）＋スキンテーマ（`apps/desktop/src/renderer/ladder/skins/*`）＋ラダー画面（`renderer/ladder/**`）」の3層で、4方言ぶんの色・寸法・ツールバー名・ステータスバー項目・キー割当表を既に持っている。足りないのは次の5つである。

| # | 足りないもの | 具体 |
|---|---|---|
| 1 | **キーが実際に効かない**（Critical） | OMRON の `C` / `O` / `I` は `event.key` が小文字で来ると一致しない（LE-1）。`F8`（応用命令）は全方言で `enabled:false` |
| 2 | **記号をマウスで置けない**（High） | 格子をクリックするとカーソルが動くだけ。純正にはツールバーの記号ボタンと右クリックメニューがある（UX-02） |
| 3 | **入力ダイアログが純正の形でない** | 自前の `DeviceInput`。純正は「回路入力」欄（記号のドロップダウン＋デバイス欄＋OK/キャンセル）で、**記号とデバイスを1行で書ける**（`LD X0` のような直接入力） |
| 4 | **未変換の見え方が無い** | GX Works3 は未変換の回路を**灰色の背景**で示し、`F4`（変換）で白に戻る。本アプリは変換の有無が文字でしか分からない |
| 5 | **ウィンドウ構成が薄い** | プロジェクトツリー・ラダー・アウトプットはあるが、デバイスコメント表示の切替、ウォッチ（監視）欄、ステータスバーの項目、ツールバーの記号ボタン列が無い |

### 5.2 方言ごとのキー割当表（設計）

本体仕様 §17.1 の方針を継続する。**一次資料で裏が取れた行は `confirmed: true`、慣例・本アプリ独自は `confirmed: false` ＋ `note`**。`enabled: false` は「表に出すが効かない」であり、Phase 7 の方針は **`enabled: false` を可能な限り 0 にする**ことである。

`ShortcutEntry` に1フィールド足す。

```ts
/** この行の割当が実機で確認できたかどうかの出典。表の△に添える。§17.1 */
source?: string;
```

#### 共通（GX Works3 系: 三菱・ジェイテクト・シャープ）

現行の `GX_STYLE_SHORTCUTS`（`packages/plc-dialects/src/shortcuts.ts`）を土台に、次を変える。

| action | キー | いま | Phase 7 |
|---|---|---|---|
| `contact-no` | `F5` | 有効 | 変更なし |
| `contact-nc` | `F6` | 有効 | 変更なし |
| `or-contact-no` | `Shift+F5` | 有効 | 変更なし |
| `or-contact-nc` | `Shift+F6` | 有効 | 変更なし |
| `coil` | `F7` | 有効 | 変更なし |
| `application` | `F8` | **`enabled:false`** | **有効にする**。`F8` を押すと「応用命令」欄が開き、本アプリが解釈できる命令（`SET` / `RST` / `MC` / `MCR` / `TON`(T) / `CTU`(C)）を**ニーモニックで直接入力**できる。解釈できない命令は「このアプリでは扱えない命令です（扱えるのは SET / RST / MC / MCR / T / C）」と1行で断る |
| `hline` | `F9` | 有効 | 変更なし |
| `vline` | `Shift+F9` | 有効 | 変更なし |
| `convert` | `F4` | 有効 | 変更なし。**未変換の灰色背景**と対にする |
| `delete-hline` | `Ctrl+F9` | 無し | **追加**（横線の削除）。出典 S1 |
| `delete-vline` | `Ctrl+F10` | 無し | **追加**（縦線の削除）。出典 S1 |
| `pulse-rise` | `Shift+F7` | 無し | **追加**（立上り微分接点 `P`）。出典 S2（GX Works2 の記事）。`confirmed: false` |
| `pulse-fall` | `Shift+F8` | 無し | **追加**（立下り微分接点 `F`）。出典 S2。`confirmed: false` |
| `direct-input` | `Enter`（空セル上） | 実質あり | 回路入力欄を「記号＋デバイス」1行入力にする（§5.3） |

`F2`（書込み）/ `Shift+F2`（読出し）/ `F3`（モニタ）は現行のまま（出典 S3 で裏づけ）。

#### OMRON（CX-Programmer 風）

CX-Programmer は三菱と**構造からして違う**（ファンクションキーではなく1文字のニーモニックキー、罫線は `Ctrl` ＋矢印、変換の段が無い）。ここを三菱風に寄せてしまうと「忠実に再現」から遠ざかるので、**1文字キーを正とし、ファンクションキーは足さない**。

| action | キー（設計） | `confirmed` | 備考 |
|---|---|---|---|
| `contact-no` | `C` | true（S4・S5・S6） | 英字は**大小文字を問わない**（LE-1 の修正） |
| `contact-nc` | `/` | true（S4・S5） | 既存セル上で押すと a↔b を反転する |
| `or-contact-no` | `W` | false（S5） | 並列接点。`note` に出典を書く |
| `or-contact-nc` | `Shift+W` | false | 本アプリの割当（一次資料に記載なし）。`note` |
| `coil` | `O` | true（S4・S6） | |
| `instruction` | `I` | true（S4） | 命令入力。§5.3 の応用命令欄へ（**`{type:'none'}` をやめる**） |
| `hline` | `Ctrl+→` | false（S5） | 挿入。`Ctrl+←` で削除 |
| `vline` | `Ctrl+↓` | false（S5） | 挿入。`Ctrl+↑` で削除 |
| `online-edit` | `Ctrl+E` | true（S4・S5） | 本アプリはオンライン編集を持たないので `enabled:false` ＋ `note`（LE-8） |
| `transfer` | `Ctrl+Shift+E` | true（S4） | 同上 |
| `monitor` | —（キー無し） | — | **キーを作らない**。案内は `monitorStartLabel(profile)` がツールバー項目名へ倒す（LE-7。存在しないキーを教えない） |

`convertStep: false` は維持する（S4 が「オムロンのラダーソフトは変換の必要がない」と明記）。

**OMRON 固有の挙動として再現するもの**（出典 S4）:

- デバイス欄で `Enter` を押すと、続けて**コメント欄**が開き、もう一度 `Enter` で確定する（三菱は開かない）。本アプリは既に `CommentPanel` でデバイスコメントを持っているので、この2段目はそこへ書き込む。
- **出力の無いネットワークの右端に赤い縦線**を出し続ける（変換の段が無いぶん、その場で未完成を示す）。本アプリの `compile()` は `no-output` を既に持っているので、`LadderGrid` が同じ条件で赤線を描く。

#### ジェイテクト PCwin 風・シャープ JW-300SP 風

**公開資料でキー割当を確認できなかった**（§5.7 の「確認できなかったもの」）。本体仕様 §17.1 の方針どおり、**GX Works3 風の割当を流用し、`confirmed: false` ＋ `note`（「実機マニュアル未確認のため本アプリの表記です」）** を全行に付ける。`SkinTheme.keyMapAssumed: true` は現行のまま維持し、キー割当表の先頭に注記を出す。

確認できた事実だけは反映する。

| 方言 | 確認できたこと | 設計への反映 | 出典 |
|---|---|---|---|
| PCwin | LD（ラダー）のほかに SFC・FBD も扱える | プロジェクトツリーの言語ノードを「ラダー」1本に絞っている理由を `note` に書く（本アプリはラダーのみ） | S7 |
| JW-300SP | シンボル名とアドレスの**2つのプログラミングモードを切り替えられる**／行間ステートメント／マウスのドラッグ＆ドロップでも回路要素を入れられる | ①**表記の切替**（デバイス番号／シンボル名）を `NotationDialog` の隣に足す（`enabled:false` で入口だけ出し、`note` で断るのではなく、**デバイスコメントを名前として出す表示切替**として実装する） ②**ドラッグ＆ドロップでの記号配置**を §5.3 の入口Bに足す（ツールバーの記号を格子へドラッグ） | S8 |

#### 決定と検査

- **キー照合は `foldKey()` で末尾1文字を大文字に畳む**（LE-1）。`F5` などの機能キーはそのまま。
- **網羅テスト**（決定 D6）: 4方言 × 表の全行について、`keys` を `KeyboardEvent` に起こして `ladderKeyToAction()` に通し、`enabled !== false` の行が `{type:'none'}` にも `{type:'disabled'}` にもならないことを確かめる。`enabled: false` の行は `{type:'disabled'}` になり、`note` が空でないことを確かめる。
- キー割当表（`ShortcutHelp`）は `confirmed: false` の行に △ と `note`（と新設の `source`）を出す。設定画面の注記はそのまま。

### 5.3 回路入力（記号とデバイスの入れ方）

純正の3つの入口を**すべて**用意する。いずれも既存の `buildCell()` へ合流するので、内部モデルは1つのままである。

| 入口 | 操作 | 出るもの |
|---|---|---|
| A. キー | `F5` などを押す | 回路入力欄がカーソル位置に開き、記号は押したキーで決まる |
| B. ツールバー | 記号ボタン列（a接点・b接点・OR a・OR b・コイル・応用命令・横線・縦線・削除）を押す | 同上。**ボタンには必ずキーを併記**する（「a接点 (F5)」） |
| C. 格子のクリック | 空セルを**ダブルクリック**、または右クリック → 記号メニュー | 同上。単クリックはいままで通りカーソル移動だけ（回転や選択と衝突させない） |

**回路入力欄（`DeviceInput` の作り直し）**

- 見出しは方言の言葉にする（三菱系「回路入力」／OMRON「新規接点」）。`i18n/ja.ts` の `JA.ladder.entry.*` に置き、方言ごとの見出しは `DialectProfile.panels` に足す。
- **1行直接入力**を主にする。`LD X0` / `OUT Y0` / `T0 K30` のように**ニーモニック＋デバイス（＋設定値）**を空白区切りで書ける。ニーモニックは `instructionNames` から方言ごとに解釈する（シャープなら `STR`）。空白を含まない入力は「デバイスだけ」と解釈し、記号は押したキーのものを使う。
- 記号のドロップダウン・デバイス欄・設定値欄・リセット欄は**そのまま残す**（1行入力が分からない人の逃げ道）。
- `Enter` で確定 → **カーソルは右へ1つ**（OR接点のときは「閉じ側の縦線の次」へ。LE-5）。`Esc` で取消。IME 変換中の `Enter` は飲み込む（LE-12）。
- 入力例のプレースホルダは `profile.formatDevice()` 由来のまま（`X0` / `0.00` / `00000`）。
- 全角入力は `NFKC` 正規化で通す（PD-1）。

### 5.4 カーソルと編集の意味論

| 事項 | 設計 |
|---|---|
| 上書き／挿入 | `Ins` で切替。ステータスバーに「上書き」「挿入」を出す（既存の `statusItems` に `overwrite` がある） |
| 確定後の送り | 右へ1列。コイル列に達したら次の行の先頭へ。OR接点のあとは閉じ側の縦線の次（LE-5） |
| END セル | 上書き・削除を拒否し、「END は消せません（ネットワークを消すには『ネットワーク削除』を使います）」と1行で断る（LE-3） |
| END と同居 | END を含むネットワークに他の回路を置いたら `after-end` で変換エラー（LC-1） |
| undo / redo | `Ctrl+Z` / `Ctrl+Y`。**復元後のプログラムに合わせてカーソルを丸める**（LE-2） |
| 抜け出し | `Escape` でエディタから blur（`Tab` を飲み込んだままにしない。LE-13） |
| 未変換の表示 | **変換していない回路は背景を灰（`--skin-unconverted`）にする**。`F4`（変換）が通ると白へ。`convertStep: false` の方言（OMRON・ジェイテクト）はこの表現を使わず、代わりに未完成ネットワークの右端に赤い縦線を出す（§5.2 の OMRON 固有）。**灰色背景は一次資料で確認できていない**ので `assumed` に載せ、設定の注記の対象にする（§17.1） |

### 5.5 ウィンドウ構成とモニタ

`DialectProfile.panels` を拡張する。

```ts
export interface PanelLayout {
  tree: string;      // 例: 'ナビゲーション'（三菱） / 'プロジェクト'（OMRON）
  editor: string;    // 例: 'プログラム'
  output: string;    // 例: 'アウトプット'
  toolbar: readonly string[];
  /** 追加: デバイスコメント欄の呼び名。無ければ欄を出さない */
  comment?: string;
  /** 追加: 監視（ウォッチ）欄の呼び名。無ければ欄を出さない */
  watch?: string;
  /** 追加: ステータスバーに出す項目の並び（`SkinTheme.statusItems` の源をここへ移す） */
  status?: readonly string[];
}
```

- **ツールバー**: 既存の `TOOLBAR_ACTIONS_BY_DIALECT` に**記号ボタン列**を足す（§5.3 の入口B）。アイコンは本アプリが描く図形のみ（ベンダーのアイコンは使わない。§17.1）。
- **アウトプット**: ジェイテクトは `outputPane: 'status-bar'`、他は `'window'`（既存の `SkinTheme.layout` のまま）。
- **監視欄**: `MonitorPanel` を「デバイス一覧」と「監視（利用者が選んだデバイスだけ）」の2つに分ける。監視は `Shift+F3`（三菱系）／ツールバーで開く。
- **モニタ中の見え方**: `SkinTheme.monitorStyle` は既に `'block'`（三菱＝通電セルを面で塗る）と `'flow'`（OMRON など＝通電線を太くする）を持つ。Phase 7 では **色だけに頼らない**（UX-14）ため、通電セルに**細い実線の枠**を重ね、ON のデバイスに `■`／OFF に `□` を添える。
- **モード表示**: 「書込み」「読出し」「モニタ」をステータスバーとタイトルバーの両方に出す。キーは方言の表から引く（`monitorStartLabel(profile)`。LE-7）。

### 5.6 触るファイル

| ファイル | 変えること |
|---|---|
| `packages/plc-dialects/src/shortcuts.ts` | `GX_STYLE_SHORTCUTS` の `application` を有効化、`delete-line` 追加、`keys` の複数指定 |
| `packages/plc-dialects/src/omron.ts` | キー表の作り直し（英字＋ファンクションキーの併記） |
| `packages/plc-dialects/src/profile.ts` | `ShortcutEntry.source`、`PanelLayout` の3項目 |
| `packages/plc-dialects/src/{mitsubishi,jtekt,sharp}.ts` | `panels` の追加項目、`timerBaseMs` の移管（LE-6） |
| `packages/plc-dialects/src/device-rules.ts` | `NFKC` 正規化ヘルパ（PD-1） |
| `apps/desktop/src/renderer/session/ladder.ts` | `foldKey()`、`application` / `instruction` の行き先、`delete-line` |
| `apps/desktop/src/renderer/ladder/DeviceInput.tsx` | 1行直接入力、見出しの方言化、`isComposing` |
| `apps/desktop/src/renderer/ladder/LadderGrid.tsx` | ダブルクリック・右クリックメニュー、未変換の灰背景、`memo`（LE-10） |
| `apps/desktop/src/renderer/ladder/LadderWorkspace.tsx` | 記号ボタン列、監視欄、ステータスバー項目 |
| `apps/desktop/src/renderer/ladder/skins/*.ts` | `--skin-unconverted`、記号ボタンの図形 |
| `apps/desktop/src/renderer/i18n/ja.ts` | `JA.ladder.entry.*`、応用命令の断り文言 |

### 5.7 出典（2026-09-20 に確認）

本節の「確認できた」行の出典。`docs/reference/ladder-skin-sources.md` に追記し、`ShortcutEntry.source` からこの記号で参照する。

| 記号 | 出典 | 何が確認できたか |
|---|---|---|
| S1 | `https://ecdtejun.work/archives/972` | 三菱: `F5`/`F6`/`Shift+F5`/`Shift+F6`/`F7`/`F8`/`F9`/`Shift+F9`/`Ctrl+F9`/`Ctrl+F10` |
| S2 | `https://denkisekkeijin.com/software/gxworks2/gxworks2_base_ladder/` | 三菱: 同じ表（独立した記述）、`Shift+F7`/`Shift+F8` のパルス、回路入力ウィンドウにデバイス名を半角で打って `Enter` |
| S3 | `https://plckouza.com/st2/st2_3.html` / `st2_5.html` | 三菱: `F4`＝変換、`F2`＝書込み、`Shift+F2`＝読出し、`F3`＝モニタ、モニタ中は通電部が塗りつぶし |
| S4 | `https://plckouza.com/st2/st2_8.html` | OMRON: `C`/`/`/`O`/`I`、`Ctrl+E`、アドレス欄 `Enter` → コメント欄 `Enter`、出力の無いブロックの右端に赤線、変換の段が無い |
| S5 | `https://scrapbox.io/backman2225626-02655577/CX-Programmer` ほか個人の早見表 | OMRON: `W`（並列接点）、`Ctrl+←→`（横線）、`Ctrl+↑↓`（縦線） |
| S6 | `https://www.softech.co.jp/mm_140903_plc.htm` | 各社比較: 直列接点は三菱 `F5` / OMRON `C`、コイルは三菱 `F7` / OMRON `O` |
| S7 | `https://www.jtekt.co.jp/data/Tp/Catalog/CAT-M2067-1_PCwin.pdf` | PCwin が LD・SFC・FBD を扱うこと（画像PDFのため本文は読めない） |
| S8 | `https://jp.sharp/sms/plc/jw-300sp/jw-300sp.html` | JW-300SP: シンボル名／アドレスの2モード、行間ステートメント、マウスのドラッグ＆ドロップでの回路要素挿入、トラブルシューティング画面 |

**確認できなかったもの**（`confirmed: false` のまま `note` を付けて出す。§17.1 の方針どおり実装は止めない）:

- 三菱・OMRON の**モニタ中の通電色の具体値**（「塗りつぶし」という記述までは取れたが色名は取れない）。本アプリの既定（三菱=青 `#1E64FF` / OMRON=緑 `#2FA02C` / ジェイテクト=橙 / シャープ=水色）は**本アプリ独自**のままとする。
- 三菱の**未変換回路の灰色背景**。
- 三菱・OMRON の**既定の背景色・格子色・カーソル色・書体**（三菱は「表示→色およびフォント」で利用者が変えられることまでは確認できた）。
- **PCwin と JW-300SP のキー割当・入力ダイアログ・ウィンドウ構成・モニタ色は一切確認できない**。PCwin の公式マニュアル（`T-A35` / `T-A50`）は**ログイン必須**であることを実地で確認した。JW-300SP のマニュアル PDF は公開されているが 10.5MB の画像PDFで本文を機械抽出できない。
- 利用者が挙げた `e-sysnet.com/plc-6` は**キー割当表ではなく「ラダー図の表現方法（図記号）」の解説ページ**だった。キー割当の出典としては使えない。

---

## 6. 取扱説明書・PDF・ヘルプの体裁刷新

### 6.1 いまの姿

正本は `docs/manual/*.md`（13章）。`apps/desktop/scripts/manual-build.mjs` の `buildManual()` が `markdown-it` で1回変換し、**アプリ内ヘルプ用の `manual-content.ts`** と **PDF用の `manual.html`** を同時に書き出す。PDF は `electron scripts/print-manual.mjs` が `printToPDF({ pageSize:'A4', margins:{…}, printBackground:true, generateDocumentOutline:true })` で焼く。`manual-sync.test.ts` が正本から作り直してバイト一致を検査する。**この骨格は変えない。**

### 6.2 PDF の体裁（`PRINT_CSS` の全面書き直し）

いまの `PRINT_CSS` は 29 行で、`@page` が無く、柱もノンブルも章番号も図番号も注意箱も無い。次のように作り直す。

| 要素 | 設計 |
|---|---|
| 版面 | `@page { size: A4; margin: 18mm 16mm 20mm; }`。`printToPDF` の `margins` は `marginType:'default'` にせず、`preferCSSPageSize: true` にして**CSS を正とする** |
| 柱（ランニングヘッダ） | `displayHeaderFooter: true` ＋ `headerTemplate`（左に製品名、右に章題）／`footerTemplate`（中央にノンブル `<span class="pageNumber"></span> / <span class="totalPages"></span>`）。Chromium の既定は 8px で読めないので `font-size: 9pt` と `margin: 0 16mm` を明示する |
| 表紙 | 1ページ目。製品名（28pt）・版（`v1.1.0`）・発行日・「この説明書の読み方」3行・「困ったら `F1`」の一文。背景は薄い帯1本だけ（インクを使わない） |
| もくじ | 2ページ目以降。章は 11pt 太字、節は 10pt。**行末にリーダ（点線）とページ番号**を出す（`@page` のカウンタは使えないので、リーダのみ出し、**リンクで飛ばす**。§6.3） |
| 章番号 | `第1章` 〜 `第15章` を `<h1>` の前に小さく出す。節は `1.1` 形式。番号は変換時に**機械で振る**（正本の Markdown には書かない） |
| 見出し | `h1` 20pt／`h2` 14pt（薄い地色の帯のまま、左に4pxの色罫）／`h3` 12pt（色罫のみ、地色なし）。`page-break-after: avoid` を全見出しに付ける |
| 本文 | 10.5pt・行送り 1.8・1行 **38〜42字**（`max-width: 150mm`）。段落間 8px |
| 図 | `figure` に**図番号**（`図 3-2`）を機械で振り、`figcaption` を「図 3-2 盤の画面」の形にする。枠は 1px、影なし、`page-break-inside: avoid` |
| 表 | 見出し行の地色は現状維持。`page-break-inside: avoid` のまま、長い表は `thead` 繰り返し（`display: table-header-group`） |
| 注意箱 | `blockquote` を3種に分ける。正本の記法は `> **注意** …` / `> **ヒント** …` / `> **やってはいけない** …` の先頭語で判別し、左罫の色と見出しアイコン（文字の `!` `i` `×`）を変える |
| 手順 | `<ol>` に丸数字風の連番（`counter`）を付け、手順の図は手順の中に入れる |
| 書体 | `'Yu Gothic UI', 'Meiryo', sans-serif` のまま（決定 D9）。見出しだけ `letter-spacing: .02em` |

### 6.3 もくじを押すと飛ぶ（利用者要望6）

| 仕組み | 設計 |
|---|---|
| 見出しに `id` を振る | `printHtmlOf()` が `<h1 id="ch-mode-b">` / `<h2 id="sec-mode-b--電線をつなぐ外す">` を出す。ID は既にある `chapterId` / `sectionId` から**URL に安全な形へ写す**純関数 `anchorIdOf()` を作り、`manual-build.test.ts` で一意性を検査する |
| もくじをリンクにする | `<nav id="toc">` の各行を `<a href="#ch-…">` / `<a href="#sec-…">` にする。**PDF では Chromium が同一文書内リンクを PDF のリンク注釈として出す** |
| しおり（PDF outline） | 既に `generateDocumentOutline: true` が入っているので、`h1`/`h2` の階層がそのまましおりになる。章番号を `h1` のテキストに入れるとしおりにも番号が出る |
| 本文からの相互参照 | 正本に `[→ 3.2 電線をつなぐ](#sec-mode-b--電線をつなぐ外す)` のようなリンクを書けるようにする。`markdown-it` は `linkify: false` だが Markdown のリンク記法はそのまま通る。**存在しないアンカーを指していたらテストで落とす** |
| アプリ内ヘルプ | もくじは既にボタンで節へ飛ぶ。本文中のリンク（`#sec-…`）は `HelpDrawer` の `onProseClick` で拾い、`showSection()` に流す（外部 URL は `shell.openExternal` ではなく**開かない**。§15 の外部通信なしを守る） |
| 検査 | `manual-build.test.ts`: すべての `<a href="#…">` の行き先 `id` が同じ文書に実在すること／`id` が重複しないこと。`manual-pdf.test.ts`（新規）: 焼いた PDF に `/Annots` と `/Link` と `/Dest`（または `/GoTo`）のバイト列が存在し、**ページ数が 60 以上**であること |

### 6.4 ヘルプ引き出しの読みやすさ（利用者要望5）

| いま | 変える |
|---|---|
| 幅 420px 固定、もくじ 148px、本文の実幅 約 240px（1行16〜18字） | 幅 `min(560px, 46vw)`、1280px 未満ではもくじを畳む。本文に `max-width: 34em` |
| 本文 13px / 1.8 | 14px / 1.85。見出し 17px。`--ui-scale`（UX-17 / PR-06）が掛かるようにする |
| 章末に次への導線が無い | 節の末尾に「← 前の節 ／ 次の節 →」と「この節をPDFで見る」 |
| 図が本文幅いっぱいで潰れる | 縮小版は現状どおり幅400px。`max-width: 100%` に加えて**押せることが分かる枠と虫めがねの印**を出す |
| 検索結果が20件のリストだけ | 章ごとにまとめ、一致箇所を太字にする（既存の `EXCERPT_PAD` の窓をそのまま使う） |

### 6.5 チュートリアル章の新設（利用者要望7）

章を2本足す。章IDは `tutorial-modes` / `tutorial-features`。

**`docs/manual/13-tutorial-modes.md`「はじめてのれんしゅう（モード別の通し）」**

| 節 | 中身 |
|---|---|
| この章の使い方 | 「1つの課題を最初から最後まで、画面のどこを押すかまで書いてあります」 |
| 回路を組み立てる（モードB）— `b-001` を通しで | ①課題を開く ②盤を回して見る ③ソケットに部品を置く ④電線をつなぐ ⑤タイマを合わせる ⑥電気を流す ⑦押しボタンを押す ⑧判定する ⑨結果を読む。**各手順に図を1枚**、図の丸数字で押す場所を指す |
| 部品を点検する（モードC1）— `c1-001` を通しで | 同様に9手順 |
| 回路を点検して直す（モードC2）— `c2-001` を通しで | 同様に10手順 |
| PLCでプログラムを作る（モードD）— `d-001` を通しで | 同様に12手順（記号を置く・変換・配線・モニタ・判定） |
| うまくいかないときの戻り道 | 「元に戻す」「やり直し」「最初から」「保存して中断」 |

**`docs/manual/14-tutorial-features.md`「機能べつの操作」**

1つの機能につき1節。各節は「**何ができるか（1文）→ どこにあるか（図）→ 操作の順（番号つき）→ よくある間違い**」の4段で固定する。

対象（`docs/manual/coverage.json` の画面と突き合わせて決める）: 3Dの見かた／端子をつなぐ（3D・端子リスト・キーボードの3通り）／部品を置く・外す・交換する／タイマの設定／電源の入れ方と順序／テスターの使い方／回路図ヒントの読み方／タイムチャートの読み方／ラダーの記号を置く／変換とモニタ／表記（メーカー）の切替／作業ファイルの保存と読込／設定／ヘルプと説明書／初回ガイドの出し直し。

**課題の索引**（`14-tutorial-features.md` の最終節）: 全72題を「ID ／ モード ／ 級 ／ 難 ／ 題名 ／ 学ぶこと（`tags` から）／ つまずきやすい所」の表で並べる。`manual-problem-index.test.ts`（新規）が **`BUILTIN_ALL_PROBLEMS` の全 ID がこの表に1回ずつ出ること**を検査する。

**機械検査への影響**: 章が2本増えるので `coverage.json` の `section` 参照先、`style.json` の禁止語、`terms.json` の初出規則がそのまま効く。`manual-coverage.test.ts` の `PROCEDURE_SECTIONS`（番号つき手順で書くべき節）に**チュートリアル章の全節**を足す。

### 6.6 インストーラのライセンス表示（利用者要望4・QA-07）

**事実**: `apps/desktop/build/license.txt` は git の blob が **BOM 無し UTF-8**（先頭 `E9 9B BB`）。`electron-builder.yml` に `nsis.license` の指定は無く、electron-builder が `build/` 直下の `license.txt` を自動で拾って NSIS の `LicenseData` に渡す。`oneClick: false` なのでこの画面は**必ず出る**。NSIS はファイル先頭の BOM で符号化を判断するため、BOM が無い UTF-8 は ANSI（CP932）として解釈され、日本語が化ける。

**直し方**（プラン Task 1）:

1. `apps/desktop/build/license.txt` を **UTF-8 BOM 付き**（`EF BB BF` で始まる）で保存し直す。
2. `.gitattributes` に `apps/desktop/build/license.txt -text` を足し、git の改行正規化と将来の BOM 剥がれを止める。
3. `apps/desktop/test/release-content.test.ts` に「`build/license.txt` の先頭3バイトが `EF BB BF` であること」「本文に `電気教育ツール` が含まれること」を足す。
4. **実物で確かめる**: `pnpm --filter @ojt/desktop dist` を worktree で走らせ、`release/電気教育ツール Setup 1.1.0.exe`（QA-17 のあとは ASCII 名）を起動してライセンス画面を目視し、化けていないことを確認する。化けが残るなら `.rtf` に置き換える（NSIS の `LicenseData` は RTF も受ける）。

> この作業は **2026-09-20 の時点で作業ツリーに着手済みの変更がある**（`build/license.txt` と `test/release-content.test.ts` が未コミットで修正されている）。Task 1 の担当者は**その変更を破棄せず**、上の4項目が満たされているかを確認して足りない分だけ足すこと。`git stash` / `git reset --hard` / `git checkout --` は使わない（決定 D16）。

### 6.7 図の撮り直しと本文の更新（利用者要望10）

- 撮り直しは**プランの最後から2番目のバッチ**。すべての画面直しが landed してから1回だけ走らせる。
- 既存17枚は**全部撮り直す**（UI/UX 刷新でどの画面も変わる）。新しい図は概算で **+20枚**（チュートリアル章の手順図）。`shots.json`（意味）は本文を書くときに決め、`shot-geometry.json`（場所）は撮影時に機械が書く。
- 本文の更新は「実装が変わったところ」を機械で拾えないので、**`coverage.json` の差分**（`feature-inventory.mjs` の出力が変わった `data-testid`）を突き合わせて漏れを防ぐ。
- UX-24 の4箇所（①最近の課題が押せる ②格子クリックで欄が出る ③キー割当がいつも出ている ④状態表示が「左上」）は、①②③が**実装側で真になる**ので本文はそのまま使え、④だけ「右上」に直す。

---

## 7. 3D盤の直接操作と UI/UX 刷新

### 7.1 いまの姿（調査で確かめた事実）

| 対象 | いまできること |
|---|---|
| ソケット・装着部品 | `onClick` で**選ぶ**だけ。装着・取り外し・交換は右の「部品」パネルのボタン |
| 端子 | `onPointerOver` でネジが光り札が出る。`onClick` で**配線の始点／終点**（クリック→クリックの2回） |
| 電線 | 削除モードのときだけ `onClick` で選べる |
| ブレーカ・電源スイッチ | 3Dに**描いてあるが押せない**。`AcFixtures.tsx` の全メッシュが `raycast={noPick}`。電源は2Dの `PowerControls` のボタンだけ |
| ドラッグ | レンダラ全体で `setPointerCapture` を使っているのは `ViewGizmo.tsx` **だけ**。HTML5 の drag&drop は0件 |
| カーソル | 3D キャンバス上でカーソルが変わるのは**ビューキューブの上だけ** |
| 初回ガイド | **無い**（`ViewHint` の「?」と `F1` ヘルプがあるだけ） |

つまり「クリックして電源を入れる」「ドラッグして部品を置く」「端子から端子へドラッグして配線する」は**どれも存在しない**。利用者の指摘はそのとおりである。

### 7.2 設計案の比較

| 案 | 中身 | 良い点 | 悪い点 |
|---|---|---|---|
| **A. 操作モードを切り替える** | ツールバーに「選ぶ／配線／部品」の3モードを置き、3Dのクリックの意味をモードで変える | 実装が単純。誤操作が起きにくい。既存の `pickToAction()` に `mode` を1つ足すだけ | **モードの存在自体を説明しないと分からない**。利用者の要求（説明なしで直感的に）と正面から衝突する。モードの取り違えは「押しても何も起きない」という最悪の失敗に化ける |
| **B. 対象で決まるモードレス操作（採用）** | クリックした**対象の種類**で操作が決まる。ブレーカ／スイッチ＝入切、ソケット＝部品カード、端子＝配線の始点、電線＝選択、部品＝取り外し。ドラッグは「端子→端子」で配線、「パレットの部品→ソケット」で装着 | 覚えることが0。現実の盤と同じ（触ったものが反応する）。既存の `pickToAction()` をそのまま拡張できる | 端子が小さいので誤爆しやすい／視点の回転ドラッグと取り合いになる。→ ヒット半径の拡大と 4px のデッドゾーンで解く |
| **C. 3Dの上に2Dの操作レイヤを重ねる** | SVG のオーバーレイで端子・ソケットの当たり判定を取る | 当たり判定が正確でテストも書きやすい | **視点を回すと破綻する**（投影を毎フレーム作り直す必要があり、§15 の性能予算に効く）。3Dを触っている感じが無くなる |

**採用: 案B**（決定 D11）。理由は3つ。(1) 要求が「操作説明がなくても直感的」であること。(2) 既存のキーボード・端子リスト経路を**消さずに足せる**ので §15 のアクセシビリティ（キーボードのみで判定まで到達）が保てる。(3) `pickToAction()` という**純粋な決定関数**が既にあり、入口（3Dクリック／端子リスト／新設のドラッグ）が増えても判断は1箇所のままにできる。

### 7.3 操作仕様

#### 7.3.1 共通の土台

- **意図の決定を純関数に集める**。`renderer/session/interaction.ts` に次を足す。

```ts
/** ポインタが指しているものと、いまの状態から「何が起きるか」を決める。描画も副作用も持たない。 */
export type Intent =
  | { type: 'none' }
  | { type: 'togglePower'; fixture: 'breaker' | 'switch' }
  | { type: 'selectSocket'; socketId: SocketId }
  | { type: 'unplugPart'; socketId: SocketId }
  | { type: 'beginWire'; from: TerminalId }
  | { type: 'completeWire'; from: TerminalId; to: TerminalId; color: WireColor }
  | { type: 'cancelWire' }
  | { type: 'selectWire'; wireId: string }
  | { type: 'dropPart'; socketId: SocketId; kind: MountableKind }
  | { type: 'refuse'; reason: RefuseReason };   // 断る理由（端子が2本で一杯・同じ端子・別の盤…）

export function intentOf(state: InteractionState, hit: PickHit): Intent;
/** いまの状態でつなげられる端子の集合。配線中のハイライトに使う。 */
export function legalTargets(state: InteractionState): readonly TerminalId[];
/** 断る理由の日本語（`i18n/ja.ts` のキーを返すだけ。文言は持たない）。 */
export function refuseMessageKey(reason: RefuseReason): string;
```

- **ポインタの作法**（回転と取り合わない）:
  - `pointerdown` で対象を覚え、`setPointerCapture`。
  - 移動が `INTERACT_DRAG_THRESHOLD_PX = 4` 未満のまま `pointerup` したら **クリック**扱い。
  - 4px を超えたら**ドラッグ**。始点が端子なら配線、パレットの部品なら運搬、それ以外（盤の地の部分）なら**いままでどおり視点の回転**。
  - `Escape` でいつでも取り消し。

#### 7.3.2 対象ごとの振る舞い

| 対象 | クリック | ドラッグ | ホバー |
|---|---|---|---|
| ブレーカ `CB` | 入／切。`bridge.send({type:'breaker', on})`。レバーが倒れる（150ms） | — | レバーが少し浮く。カーソル `pointer`。予告「ブレーカを入れます（先にブレーカ、次にスイッチ）」 |
| 電源スイッチ `SW` | 入／切。`bridge.send({type:'switch', on})` | — | 同上。ブレーカが切のときは予告が「先にブレーカを入れます」に変わる |
| 端子 | 始点／終点（現行どおり） | 始点から離して終点で放す。**指先まで電線のプレビューが伸びる** | ネジが光る（現行）。配線中は**つなげる端子だけ**が光り、つなげない端子は灰のまま。予告に理由 |
| ソケット（空） | 部品カードを開く（現行） | パレットから部品を落とせる（受け側） | 枠が光る。カーソル `pointer` |
| 装着部品 | 部品カードを開く（現行） | **つまんでソケットの外へ放すと取り外し**（ゴミ箱は作らない） | 枠が光る |
| 電線 | 選択（削除モードでなくても選べるようにする）。`Delete` で外す | — | 太さが 1.2 倍になり、端点が光る。予告「CR1.9–PB1.2c の青線。Delete で外せます」 |
| 盤の地・机 | 選択解除 | 視点の回転（現行） | — |

#### 7.3.3 部品のドラッグ配置

- 右の「部品」パネルを**パレット**にする（UX-08 の解決を兼ねる）。在庫（リレー4・タイマ2）をカードで並べ、残数を出す。
- カードを `pointerdown` でつまむ → `setPointerCapture` → 画面に**半透明のゴースト**が付いてくる → 3D の上に来るとレイキャストで下にあるソケットを求め、**そのソケットが光る** → `pointerup` で `runPlug()`。
- HTML5 の drag&drop は使わない（Electron/WebGL の上で座標が取りにくく、テストも書きにくい）。`pointerdown`/`pointermove`/`pointerup` ＋ `setPointerCapture` で統一する。
- カードを**クリック**しても選べる（クリック → ソケットをクリック）。キーボードのみの利用者はこの経路を使う。

#### 7.3.4 発見しやすさ（discoverability）

| 仕掛け | 中身 |
|---|---|
| ホバー予告 | 3D ペインの下端に1行（`data-testid="hover-hint"`）。「いま指しているものは何で、押すと何が起きるか」だけを書く。`aria-live="polite"` にも同じ文を出す |
| カーソル | 端子＝`crosshair`、押せるもの＝`pointer`、つまめるもの＝`grab`／`grabbing`、回転できる地＝`move` |
| 光り方 | ホバー＝白の細い縁取り、選択＝太い縁取り、配線の可否＝緑／灰。**色だけに頼らず**太さと点線で区別する（UX-14） |
| 最初の一手 | 手順帯の「いまここ」に、その手順で**3Dのどこを触るか**を書く（「盤の S1 ソケットを押します」）。押すと該当ソケットが2回点滅する |
| 端子リストとの相互ハイライト | 端子リストの行にカーソルを置くと盤の端子が光り、盤の端子にカーソルを置くとリストの行が光る（PR-11） |
| 初回ガイド | §7.3.5 |

#### 7.3.5 初回ガイド（PR-04）

- `AppSettings` に `tourDone: boolean`（既定 `false`）を足す。初回にモードBの課題を開いたときだけ、半透明の覆いで **5枚**出す。①盤を回す（ドラッグしてみてください／ビューキューブ）②ソケットに部品を置く ③端子から端子へつなぐ ④電気を流す（ブレーカ→スイッチ）⑤判定する。
- 各枚は**実際に操作すると次へ進む**（読むだけでなく手が動く）。「あとで」「二度と出さない」「`Esc`」で閉じられる。
- 設定と `F1` ヘルプから**いつでも出し直せる**（`JA.settings.restartTour`）。
- 3D を使えない環境（WebGL 喪失）では覆いを出さない。

### 7.4 アクセシビリティ

- 3D の直接操作は**追加**であり、既存の「端子リスト＋キーボード」「部品パネルのボタン」「`PowerControls` のボタン」は**すべて残す**。本体仕様 §15「キーボードのみで課題選択・判定・結果確認まで到達できること。3D操作はマウス必須」はそのまま満たす。
- ホバー予告と「断る理由」は `role="status"` / `aria-live="polite"` にも出す。
- 色だけの符号化をやめる（UX-14 ≡ UI-17）: 通電は `● 通電中` / `○ 無通電` / `▲ 保護動作` の文字と形を添える。配線の可否は緑＝実線の縁、不可＝点線の灰。
- `--ui-scale` と `[data-contrast="high"]`（UX-17 / PR-06）は 3D の名札にも掛ける（`label-declutter` の基準寸法に乗せる）。

### 7.5 触るファイルとテスト

| ファイル | 変えること |
|---|---|
| `renderer/session/interaction.ts` | `Intent` / `intentOf()` / `legalTargets()` / `refuseMessageKey()`（純関数。ここが試験の主戦場） |
| `renderer/three/AcFixtures.tsx` | `raycast={noPick}` をブレーカ・スイッチの**操作部だけ**外し、`onClick` を足す。レバーの動きを `useFrame` で補間 |
| `renderer/three/Socket.tsx` / `MountedPart.tsx` / `Wire.tsx` / `TerminalHit.tsx` | `hovered` を受けて見た目を変える。`onPointerOver`/`Out` を足す |
| `renderer/three/BoardScene.tsx` | ポインタの作法（しきい値・capture・カーソル）、配線プレビュー、ドロップ先の判定 |
| `renderer/three/WirePreview.tsx` | **新規**。始点から指先までの仮の電線 |
| `renderer/panels/PartsPanel.tsx` | パレット化（在庫カード＋つまんで運ぶ） |
| `renderer/panels/HoverHint.tsx` | **新規**。下端の1行 |
| `renderer/tour/*.tsx` | **新規**。初回ガイド（`TourOverlay` / `tour-store.ts`） |
| `renderer/app/store.ts`（分割後のスライス） | `hoveredIntent`、`dragging`（運搬中の部品）、`tourStep` |
| `shared/ipc.ts` | `AppSettings.tourDone` |

| テスト | 何を縛るか |
|---|---|
| `test/interaction-intent.test.ts`（新規） | `intentOf()` の全分岐（対象 × 状態）。`legalTargets()` が2本で一杯の端子を外すこと。`refuse` の理由がすべて文言キーを持つこと |
| `test/board-pointer.test.tsx`（新規） | 4px 未満はクリック、超えたらドラッグ。端子の上から始めたドラッグは視点を回さないこと（`navigation.spec.ts:364-378` の単体版） |
| `test/parts-palette.test.tsx`（新規） | つまんでソケットに落とすと `runPlug()` が1回だけ呼ばれ、履歴が1件増えること |
| `test/ac-fixtures.test.tsx`（新規） | ブレーカのクリックで `bridge.send({type:'breaker'})` が飛び、切→入の順序違反が既存の危険操作に載ること |
| `test/tour.test.tsx`（新規） | 初回だけ出る、`Esc` で閉じる、設定から出し直せる、`tourDone` が保存される |
| `e2e/direct-manipulation.spec.ts`（新規） | 3D キャンバスの座標を `projection.ts` で求めて、①ブレーカを押すと状態表示が変わる ②パレットからソケットへ運ぶと装着される ③端子から端子へドラッグすると電線が1本増える |

---

## 8. ビューキューブの不具合

### 8.1 症状（利用者要望8）

「3D図で上から正面にキューブを回そうとすると回らない」。

### 8.2 原因（調査で確かめた事実に基づく）

| # | 事実 | 出どころ |
|---|---|---|
| 1 | `<OrbitControls>` に **`minPolarAngle` を渡していない**ので、three-stdlib の既定 **0** のまま | `three/BoardScene.tsx:775-790` |
| 2 | `maxPolarAngle = MAX_POLAR_ANGLE = Math.PI/2` | `three/camera.ts:43` |
| 3 | `top` プリセットは `up:[0,1,0]` で真上から見るので**極角がちょうど 0**、`front` ほか面直プリセットは `up: boardUp()` で**極角がちょうど π/2** | `three/camera.ts` の `poseForDirection()` |
| 4 | キューブのドラッグは `polar = clamp(押した時の極角 + (-dy × 2π/1000), min, max)` で、**巻き戻しも遊びも無い素の clamp** | `three/ViewGizmo.tsx:806-811`、`three/navigation.ts:119-130` |
| 5 | `MIN_POLAR_ANGLE_RAD = 0.02` という定数は**存在するが `poseForDirection()` の中だけ**で使われ、ライブの `OrbitControls` には繋がっていない | `three/camera.ts:331` |

**結論**: `top` 視点は**極角の下限ちょうど（0）**に置かれている。極角0は球座標の極であり、そこでは

- 下向きのドラッグ（`-dy` で極角が減る向き）は `clamp` で 0 に張り付き、**1ピクセルも動かない**。
- 水平のドラッグで方位角を変えても、極角0ではカメラ位置が `(0, r, 0)` のまま変わらないので、**やはり見た目が動かない**。

つまり「上から見ている状態では、上へ引く以外のどの方向に引いても何も起きない」。利用者の言う「上から正面に回そうとすると回らない」はこれである。同じことが `front` 側でも起きている（`front` は上限ちょうどなので、下へ引く方向が死んでいる）。

### 8.3 直し方

1. **極を踏まないようにする**。`<OrbitControls minPolarAngle={MIN_POLAR_ANGLE_RAD}>`（0.02rad ≒ 1.1°）を渡し、`top` プリセットの着地点を `MIN_POLAR_ANGLE_RAD` に、面直プリセットの着地点を `MAX_POLAR_ANGLE - MIN_POLAR_ANGLE_RAD` にする。見た目の差は 1.1° で判別できないが、**どちらの向きにもドラッグの余地が残る**。
2. **上下の向きを利用者の言葉に合わせる**。本体仕様 §12.2 は「blender の操作感を目指す」と書いており、利用者の要望は「**上から正面に**キューブを回す」である。したがって **`top` から下へ引くと `front` に着く**ことを受入基準にする。いまの `gizmoDragToSpherical()` は `polar: -dy × k`（下へ引くと極角が減る＝さらに真上へ行こうとする）なので、**符号を `+dy × k` に改める**。
3. **左右の向きは変えない**（`azimuth: -dx × k` のまま）。いまの水平ドラッグは `e2e/navigation.spec.ts:228-261` が緑で、利用者からの指摘も無い。ただし上下だけ符号を変えると2軸の比喩が食い違うので、**実装者は上下を直したあとに左右も手で確かめ**、違和感があれば左右も反転して E2E の期待値ごと直す（§9 の確認事項#4）。
4. **`ViewGizmo.tsx` を3本に割る**（3D-16）: `view-gizmo-layout.ts` / `view-gizmo-paint.ts` / `use-gizmo-drag.ts`。ドラッグの状態機械が独立すると、下の回帰テストが書けるようになる。
5. **2本目のポインタを無視する**（3D-15）: `onPointerDown` の先頭に `if (drag.current !== null) return;`。
6. **面ラベルの二重管理を潰す**（3D-19）: `navigation.ts` の非公開 `FACE_LABELS` を消し、`ViewGizmo.tsx` の `GIZMO_FACES` を唯一の源にする。

### 8.4 回帰テスト（これが無かったから見つからなかった）

| テスト | 内容 |
|---|---|
| `test/view-gizmo.test.tsx` に追加 | **7つのプリセットすべて**を起点に、上・下・左・右へ 200px 引いたとき `getPolarAngle()` か**カメラ位置**のどちらかが必ず変わること（28ケース）。いまのテストは `π/2 − 0.1` から始めて上限に丸められることしか見ていない |
| 〃 | `makeCamera()` の `up` を `boardUp()`（13°傾斜）にした版を足す。いまは常に `[0,1,0]` なので傾斜の絡みが一度も走っていない |
| `e2e/navigation.spec.ts` に追加 | `俯瞰` プリセットにしてから、キューブを**下へ 200px** 引き、`camera-readout` の極角が増え、離したあとの視点が `正面` に近いこと。**これが利用者の報告そのものの再現である** |

---

## 9. リリース版数

### 9.1 推奨: **v1.1.0**

| 判断材料 | 中身 |
|---|---|
| 課題JSONの形式 | `CONTENT_FORMAT_VERSION` は **1 のまま**。追加する `difficulty` / `tags` は既定値つきの任意フィールドで、v1.0.0 の課題ファイルはそのまま読める |
| 作業ファイル | 形式は変えない。v1.0.0 で保存した作業ファイルは読める（`resolvedFaults` に `seed` を足すが任意フィールド） |
| 操作の互換 | 既存の操作経路（端子リスト・キーボード・部品パネルのボタン・`PowerControls`）を**1つも消さない**。3Dの直接操作は追加 |
| 設定 | `tourDone` / `uiScale` / `contrast` を足すだけ。既存の設定は保たれる |
| 削除するもの | 死にコード・未使用 i18n キー・非推奨エイリアスのみ（いずれも公開APIではない） |

セマンティックバージョニングの意味でも、利用者から見た意味でも「**機能追加と不具合修正であって、作ったものが読めなくなる変更は無い**」ので **v1.1.0** が正しい。

### 9.2 v2.0.0 を選ぶ余地

体感の変化は大きい（3Dが触れるようになる、説明書が別物になる、課題が2.5倍）。「1.1 では小さく見える」という判断は十分あり得るので、**所有者が 2.0.0 を選ぶ道は残す**。その場合でも本書の設計は1文字も変わらない（変わるのは `apps/desktop/package.json` の `version` とリリースノートのファイル名だけ）。

### 9.3 リリース前に人が確かめること（v1.0.0 で未実施だったもの）

1. 内蔵GPUの実機で 60fps（Batch 3 の完了条件2）。
2. オフラインの Windows 11 に NSIS で入れて課題を1つ完走。
3. **インストーラのライセンス画面が化けていないこと**（Task 1）。
4. 「説明書（PDF）を開く」が OS の既定ビューアで開き、**もくじを押すと飛ぶこと**。

---

## 10. テスト戦略

| 層 | 方針 |
|---|---|
| `packages/*` | 行・分岐 **90%** の閾値は維持。新しい純関数（`intentOf` / `anchorIdOf` / `legalTargets`）は全分岐にテストを付ける |
| `apps/desktop` | 閾値は置かず、`test:coverage` で**可視化だけ**入れる（QA-10）。1度測ってから実測 −3pt でラチェットする |
| 回帰の焦点 | レポートの各指摘に対応するテストは、**レポート §5 の「追加すべきテスト」をそのまま採用**する（Batch 1〜5 ぶんで約 60 本） |
| E2E | `e2e/app.ts` に起動定型を集約（QA-13）、一時 `--user-data-dir`（QA-12）、`manual-shots` を既定から外す（QA-02）、順序依存を `.serial(`（QA-03）、`trace`/`screenshot`（QA-04） |
| 新規 E2E | `direct-manipulation.spec.ts`（§7.5）、`navigation.spec.ts` への俯瞰→正面ドラッグ（§8.4）、`ladder-entry.spec.ts`（4方言でキーを押すと記号が入る） |
| 機械点検 | `ui-quality.spec.ts` のしきい値を **文字 12px・ボタン 32px** に上げ（UX-27）、ラチェット警告を実装（QA-11）。上がった件数をそのまま新しい基準値に置く |
| CI | `pnpm verify`（`typecheck && lint && -r test`）を GitHub Actions の必須チェックに（QA-01） |
| 課題の検証 | §4.5 の不変条件7つ。新題は loop 形式のテストが自動で拾い、件数・ID・`REPAIRS` は手で伸ばす |

---

## 11. §16 Phase 7 の受入基準

本体仕様 §16 に足す行の受入基準（①〜⑧）と、本書での担保。

| # | 文 | 担保 |
|---|---|---|
| ① | インストーラのライセンス画面が日本語で正しく読める | §6.6（Task 1）＋ `release-content.test.ts` の BOM 検査＋実物の目視 |
| ② | 評価レポートの指摘 174 件のうち 171 件が対応済みで、残り3件は仕様訂正で閉じたことが本書に記録されている | §3 のトリアージ表＋プランの対応表 |
| ③ | 内蔵課題が 72 題（B 20 / C1 12 / C2 20 / D 20）あり、すべて模範解が自身の判定に合格する | §4＋`packages/content/test/builtin*.test.ts` |
| ④ | 4方言すべてで、キー割当表に `enabled` で載っている全行のキーを押すと、そのとおりの操作が起きる | §5.2 の網羅テスト＋`e2e/ladder-entry.spec.ts` |
| ⑤ | 3D盤でブレーカを押すと通電し、部品をパレットからソケットへ運べ、端子から端子へドラッグで配線できる | §7＋`e2e/direct-manipulation.spec.ts` |
| ⑥ | 俯瞰の視点からビューキューブを下へ引くと正面へ回り込める | §8＋`e2e/navigation.spec.ts` |
| ⑦ | 説明書 PDF のもくじを押すとその章・節へ飛び、PDF のしおりに全章が並び、チュートリアル章が全72題を索引している | §6.3・§6.5＋`manual-pdf.test.ts`／`manual-problem-index.test.ts` |
| ⑧ | 初回にモードBを開くと5枚の案内が出て、操作すると進み、設定から出し直せる | §7.3.5＋`test/tour.test.tsx` |

---

## 12. 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-20 | 初版。評価レポート（HEAD `f659f51`）の174件のトリアージ、課題拡充（28→72題）、純正ツールの忠実化、説明書とPDFとヘルプの体裁刷新、3Dの直接操作とUI/UX刷新、ビューキューブの不具合、リリース版数の決定を記した |
