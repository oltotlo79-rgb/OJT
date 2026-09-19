# Plan 6: 取扱説明書とアプリ内ヘルプ（Phase 6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計仕様 §16 Phase 6 の行（取扱説明書とアプリ内ヘルプ）を実装し、受入基準①〜⑥を動作で示す。詳細設計は `docs/superpowers/specs/2026-09-19-help-and-manual-design.md`（以下「本設計」）にある。本プランは本設計の決定を12タスクに割る。

**受入基準（§16 Phase 6）:**

| # | 文 | 本プランでの担保 |
|---|---|---|
| ① | どの画面でも `F1` で「ヘルプ」が開き、その画面の節が最初に表示される | Task 6・8・9／E2E `help.spec.ts`（Task 11） |
| ② | 検索欄に「自己保持」と入れると該当節へ跳べる | Task 6・8／E2E 同上 |
| ③ | 「説明書（PDF）を開く」で同梱の PDF が OS の既定ビューアで開く | Task 7（`manual:open` と `shell.openPath()`）／`manual-ipc.test.ts`／E2E はボタンの有無と PDF の実在まで（意図的な差分#3） |
| ④ | NSIS とポータブルの両方に `manual.pdf` が含まれ、`check-dist.mjs` が検査する | Task 7（`electron-builder.yml` ＋ `check-dist.mjs` ＋ `release-manual.test.ts`） |
| ⑤ | 説明書の見出しが機能一覧表を覆い、禁止語0件 | Task 1・5 |
| ⑥ | アプリ内ヘルプの見出しと本文が同梱 PDF のそれと一字一句一致する | Task 2（1つの正本から2つの生成物）／`manual-sync.test.ts`（Task 2） |
| ⑦ | 図がすべて本アプリの実画面で、丸数字の吹き出しが操作要素を指し、本文がその番号で場所を指す | Task 5（意味の定義と原稿との照合）／Task 12（撮影・吹き出しの描き込み・縮小版・画像の検査） |
| ⑧ | アプリ内ヘルプに PDF と同じ図が縮小版で出て、押すか `Enter` で原寸が覆いで開く | Task 2（図の参照を生成物に載せる）／Task 8（図の描画と拡大の覆い）／Task 12（縮小版の生成） |

**利用者要求（2026-09-19、全タスク共通）:**

1. 「**取扱説明書とヘルプの内容は一致していること**」→ 正本は `docs/manual/*.md` **1つだけ**。`buildManual()` が同じ呼び出しから2つの生成物を書き、`manual-sync.test.ts` が正本から作り直してバイト単位で照合する（Task 2）。`i18n/ja.ts` にはヘルプ**本文**を1文字も置かない（値は40文字以下という機械的な線で縛る）。
2. 「**すべての機能を使用者目線で専門用語なく詳細に解説すること**」→ 機能一覧表（`docs/manual/coverage.json`）が画面の操作要素・キー操作・マウス操作・メッセージの全部を並べ、テストが「抽出した集合と完全一致」を要求する（Task 1・5）。禁止語リストは0件、避けられない専門用語は初出で噛み砕く形を正規表現で縛る（Task 5）。
3. 「**分かりやすく直感的に操作できるUI・UX**」「**各画面のクオリティも可能な限り向上すること**」→ ヘルプは `F1` ひとつでどこからでも開き、**いまの画面の節**が最初に出る。8px 格子・`:focus-visible`・フォーカストラップ・`Esc` は `## 完了条件` の「画面の品質」で縛る。
4. 「**取扱説明書やヘルプで使用する画像は実際の画面で分かりやすく説明すること**」→ 図は**すべてアプリを動かして撮った実画面**。作り絵は1枚も使わない。説明する操作要素の上に**丸数字の吹き出しと枠**を機械で描き込み（`shots.json` ＋ `shot-geometry.json` ＋ `overlayHtml()`）、本文はその番号で場所を指す。`docs/manual/images/` に `shots.json` の定義に無いファイルがあるとテストが落ちる（Task 5・12）。
5. 「**取扱説明書やヘルプの画像撮影は他のすべての実装が終わってからでいい**」→ 撮影と吹き出しは**最後のバッチF（Task 12）だけ**。それまでは原稿が図を参照していても、画像そのものは見ない（`manual-images.test.ts` は Task 12 で初めて入る）。画面を直すたびに撮り直す無駄を避けるためで、全画面のUX直しが landed してから1回だけ撮る。
6. 「**最小のトークンで品質を落とさず、できるだけ早く公開したい**」→ 新しい実行時依存は0。変換は `markdown-it`（devDependency 1つ）、PDF は Electron 自身の `printToPDF`、吹き出しは既にある Playwright の Chromium。

**公開について（利用者の明示の決定）:** 本プランは**説明書とその PDF を配布物に入れるところまで**を行う。`git tag` の作成・GitHub Release の公開・配布ファイルの共有は**利用者の明示の指示があるまで一切行わない**（Plan 5 決定表#22 をそのまま引き継ぐ）。

**Architecture:** 新しい概念を1つだけ増やす——**正本（Markdown）から機械で作る生成物**。それ以外はすべて既にある層をそのまま使う。

| 既にあるもの | Phase 6 での使い方 |
|---|---|
| `pushModalLayer()` / `topModalLayer()` / `isModalOpen()`（`session/interaction.ts`） | ヘルプの引き出しをモーダル1枚として積む。既存の盤・ラダーのショートカットは何も変えずに黙る |
| `ChartModal` / `SchematicModal` / `NotationDialog` の作法（ポータル・`trapFocus()`・焦点の復帰） | `HelpDrawer` がそのまま踏襲する。新しい作法を作らない |
| `panels/Toolbar.tsx`（モードB・C1・C2・D が**共有**） | 「ヘルプ」ボタンを1箇所足すと4画面に出る |
| `DialectProfile.shortcuts` と `session/ladder.ts` の `ladderKeyToAction()` | `F1`（`action: 'help'`）の行き先をトーストからヘルプに変えるだけ。キー割当表そのものは触らない |
| `@ojt/content` の `DIAGNOSIS_TABLE`、`JA.settings.*Help`、`JA.settings.trademarkNotice` | 表と文言の**実体はコード側に残す**。説明書が同じ内容を載せ、テストが1行ずつ照合する |
| `scripts/copy-content.mjs` と `extraResources`（§7.8 の同梱課題） | PDF も同じ流儀で `extraResources` に入れる |
| Plan 5 Task 14 の `scripts/check-dist.mjs` と `release/artifacts.md` | 検査項目を3つ足すだけ。新しい検査の仕組みを作らない |

**Tech Stack:**

| 層 | 使うもの |
|---|---|
| 正本 | Markdown（日本語、`docs/manual/`、`.prettierignore` の対象外なので整形されない） |
| 変換 | `markdown-it`（`apps/desktop` の **devDependencies**。`dependencies` は増やさない） |
| 生成物 | `src/renderer/help/manual-content.ts`（git に入れる）／`resources/manual/manual.html` ＋ `images/` ＋ `manual.pdf`（git に入れない） |
| PDF | Electron の `webContents.printToPDF()`（`electron scripts/print-manual.mjs`） |
| 画面 | React 19 ＋ CSS Modules ＋ 専用の小さな zustand ストア（`app/store.ts` は触らない） |
| 試験 | Vitest（`globals: false`）＋ Playwright（Electron） |

---

## 前提（このプランを始める前に満たしていること）

### 前提A: Plan 5 が landed していること（Task 14 が必須）

本プラン作成時点（2026-09-19、`HEAD` = `0710853`）で **Plan 5 の Task 14 は未着手**である（`apps/desktop/scripts/` に `check-dist.mjs` が無く、`apps/desktop/package.json` の `version` は `0.2.0` のまま）。Phase 6 は次の3つに**追記**するので、Task 14 が landed していないと入れない。

| ファイル | Plan 5 Task 14 が作るもの | Phase 6 が足すもの |
|---|---|---|
| `apps/desktop/scripts/check-dist.mjs` | 成果物2つの検査・同梱課題の件数照合・`release/artifacts.md` の生成 | `manual.pdf` の存在と大きさ、`artifacts.md` への行（Task 10） |
| `apps/desktop/package.json` | `version: 1.0.0`、`dist` に `check-dist.mjs` | `dist` と `build` に説明書の2工程、`devDependencies` に `markdown-it`（Task 2・10） |
| `docs/releases/v1.0.0.md` | リリース手順チェックリスト | 「PDF が OS のビューアで開くこと」を1項目（Task 10） |

バッチAを走らせる前に `git pull --rebase origin main` して Task 14 が landed していることを確かめる。**landed していなければ Phase 6 を始めない**（`dist` の文字列を2つのプランが別々に書き換えると必ず壊れる）。

### 前提B: 既存APIの署名（本プランが使う分だけ。実ソースで確認済み）

| モジュール | 署名（実ソースのまま） |
|---|---|
| `renderer/session/interaction.ts` | `export function pushModalLayer(): { depth: number; release: () => void }` |
| 〃 | `export function isModalOpen(): boolean` / `export function topModalLayer(): number` |
| 〃 | `export function shouldIgnoreShortcut(event: { target: unknown; isComposing?: boolean \| undefined }): boolean` |
| `renderer/app/store.ts` | `useStore` に `route: Route`（`'home' \| 'list' \| 'session' \| 'result' \| 'settings'`）、`problem?: SupportedProblem`、`assembleView: 'board' \| 'split' \| 'schematic'`、`toast(text: string, tone?: 'info' \| 'warn' \| 'error'): void` |
| `renderer/app/ojt-api.ts` | `export function tryOjtApi(): OjtApi \| undefined` |
| `shared/ipc.ts` | `export const IPC_CHANNELS = { contentList, contentRead, workfileSave, workfileLoad, settingsGet, settingsSet, textfileSave } as const`（**7本**） |
| 〃 | `export interface OjtApi { listProblems; readProblem; saveWorkFile; loadWorkFile; getSettings; setSettings; saveTextFile }` |
| `@ojt/content` | `export const DIAGNOSIS_TABLE: readonly DiagnosisRow[]`（7行）、`interface DiagnosisRow { situation: string; cause: string }` 相当（Task 9 で実ソースを読んで確かめる） |
| `@ojt/plc-dialects` | `interface ShortcutEntry { action: string; keys: string; label: string; confirmed: boolean; enabled?: boolean; note?: string }`／`type ShortcutTable = readonly ShortcutEntry[]`／`DialectProfile.shortcuts: ShortcutTable` |
| 〃 | `export const DIALECT_IDS`／`export function profileOf(id: DialectId): DialectProfile`（Task 9 で実ソースの名前を確かめて使う） |
| `renderer/session/ladder.ts` | `export function ladderKeyToAction(table: ShortcutTable, event, state): LadderAction \| undefined`（`action: 'help'` を含む） |
| `renderer/i18n/ja.ts` | `export const APP_NAME = '電気教育ツール'`／`export const JA = { …, settings: { …, userContentHelp, vendorHelp, gridColsHelp(cols), monitorColorHelp, trademarkNotice, assumptionNotice }, ladder: { …, helpHint }, … } as const` |

### 前提C: 既存の作法（守ること）

| 作法 | 中身 |
|---|---|
| 文言 | 画面に出る文字はすべて `src/renderer/i18n/ja.ts`（main 側は `src/shared/messages.ts`）。**ヘルプの本文だけは例外で、生成物 `manual-content.ts` から来る**（正本は Markdown） |
| モーダル | ポータルで `document.body` へ。`pushModalLayer()` で積み、`Esc` は `depth === topModalLayer()` のときだけ効かせ、閉じたら開く前の要素へ焦点を戻す |
| 型 | TS strict ＋ `exactOptionalPropertyTypes` ＋ `noUncheckedIndexedAccess`。import は `.js` 接尾辞 |
| 試験 | Vitest は `globals: false`（`import { describe, expect, it } from 'vitest'`）。RTL のテストは `afterEach(cleanup)`。zustand への書き込みは `act()` の中 |
| 整形 | ESLint flat ＋ Prettier（`printWidth: 100`、`singleQuote`、`semi`、`trailingComma: 'all'`）。`docs/` は `.prettierignore` の対象外**ではない**——`.prettierignore` に `docs/` が入っているので **`docs/**` は整形されない**（正本の行送りは書いたまま残る） |
| カバレッジ | `packages/*` は行・分岐90%以上。`apps/desktop` に閾値は無いが、新規モジュールは全分岐にテストを付ける |

### 前提D: 本プランが触る共有ファイル（MERGE 注意の対象）

| ファイル | 触るタスク | 触る場所 |
|---|---|---|
| `src/renderer/i18n/ja.ts` | Task 8（新ブロック `JA.help`）・Task 9（`JA.ladder.helpHint` の削除） | 末尾に新ブロックを足すのと、既存キー1つを消すだけ |
| `src/renderer/app/App.tsx` | Task 9（`<HelpRoot />` を1行） | `ErrorBoundary` の**外**、トーストの並びの直前 |
| `src/renderer/panels/Toolbar.tsx` | Task 9（`session-back` の隣に1つ） | `.toolbarScroll` の先頭 |
| `src/renderer/screens/Home.tsx` / `ProblemList.tsx` / `Settings.tsx` / `Result.tsx` | Task 9 | 各画面の見出し付近 |
| `src/renderer/screens/screens.module.css` | Task 9（`.screenHeader` を1つ） | 末尾 |
| `apps/desktop/package.json` | Task 2（`markdown-it` と `build`）・Task 7（`dist`） | `scripts` と `devDependencies` |
| `apps/desktop/scripts/check-dist.mjs` | Task 7 | Plan 5 が書いた末尾の表の直前 |
| `.gitignore` / `.prettierignore` / `eslint.config.js` | Task 2（生成物の除外） | 末尾 |

**`src/renderer/app/store.ts` は1行も触らない**（本設計 決定表#14）。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `apps/desktop/scripts/feature-inventory.mjs` | **新規**: `src/renderer/**/*.tsx` から `data-testid` / `testId` を全部拾う（Task 1） |
| `docs/manual/coverage.json` | **新規**: 機能一覧表（`controls` / `keys` / `gestures` / `messages`）（Task 1） |
| `apps/desktop/test/feature-inventory.test.ts` | **新規**: 抽出結果と `coverage.json` の `controls` が完全一致（Task 1） |
| `apps/desktop/scripts/manual-build.mjs` | **新規**: 変換の本体（`buildManual()` / `chapterIdOf()` / `plainText()`）（Task 2） |
| `apps/desktop/scripts/build-manual.mjs` | **新規**: 変換を走らせて生成物を書く（Task 2） |
| `apps/desktop/src/renderer/help/manual-content.ts` | **生成物**: 章・節・本文（Task 2 以降、章を足すたびに作り直す） |
| `apps/desktop/test/manual-build.test.ts` | **新規**: 変換の単体テスト（Task 2） |
| `apps/desktop/test/manual-sync.test.ts` | **新規**: 正本と生成物の一致（Task 2） |
| `docs/manual/00-intro.md` 〜 `05-mode-c2.md` | **新規**: 正本 前半6章（Task 3） |
| `docs/manual/06-mode-d.md` 〜 `12-troubleshooting.md` | **新規**: 正本 後半7章（Task 4） |
| `docs/manual/style.json` / `docs/manual/terms.json` | **新規**: 禁止語と、初出で噛み砕く語（Task 5） |
| `apps/desktop/test/manual-style.test.ts` | **新規**: 禁止語0件・初出の形・用語集の網羅（Task 5） |
| `apps/desktop/test/manual-coverage.test.ts` | **新規**: 機能一覧表の網羅（Task 5） |
| `apps/desktop/src/renderer/help/help-model.ts` | **新規**: 画面→節の対応・節の索引・検索（Task 6） |
| `apps/desktop/test/help-model.test.ts` | **新規**: 同上の単体テスト（Task 6） |
| `apps/desktop/src/renderer/help/help-store.ts` | **新規**: ヘルプ専用の小さなストア（Task 8） |
| `apps/desktop/src/renderer/help/HelpDrawer.tsx` | **新規**: 引き出し本体（もくじ・本文・検索・PDFボタン）（Task 8） |
| `apps/desktop/src/renderer/help/HelpButton.tsx` | **新規**: どの画面にも置く「ヘルプ」ボタン（Task 9） |
| `apps/desktop/src/renderer/help/HelpRoot.tsx` | **新規**: `F1` の窓口と引き出しの出し入れ（Task 9） |
| `apps/desktop/src/renderer/help/help.module.css` | **新規**: 引き出しの CSS（Task 8） |
| `apps/desktop/test/help-drawer.test.tsx` | **新規**: 引き出しの結合テスト（Task 8） |
| `apps/desktop/src/renderer/i18n/ja.ts` | **変更（追記のみ）**: `JA.help`（Task 8）／`JA.ladder.helpHint` の削除（Task 9） |
| `apps/desktop/src/renderer/app/App.tsx` | **変更（追記のみ）**: `<HelpRoot />`（Task 9） |
| `apps/desktop/src/renderer/panels/Toolbar.tsx` | **変更（追記のみ）**: 「ヘルプ」ボタン（Task 9） |
| `apps/desktop/src/renderer/screens/Home.tsx` / `ProblemList.tsx` / `Settings.tsx` / `Result.tsx` | **変更**: 「ヘルプ」ボタン（Task 9） |
| `apps/desktop/src/renderer/screens/screens.module.css` | **変更（追記のみ）**: `.screenHeader`（Task 9） |
| `apps/desktop/src/renderer/ladder/LadderEditor.tsx` | **変更**: `F1` の行き先（Task 9） |
| `apps/desktop/test/help-entry.test.tsx` | **新規**: 導線と `F1` の結合テスト（Task 9） |
| `apps/desktop/test/manual-appdata.test.ts` | **新規**: コードの表と説明書の一致（Task 10） |
| `apps/desktop/src/shared/ipc.ts` | **変更（追記のみ）**: `manualOpen` と `OpenManualResult` と `OjtApi.openManual`（Task 7） |
| `apps/desktop/src/shared/messages.ts` | **変更（追記のみ）**: `MSG.manual`（Task 7） |
| `apps/desktop/src/main/manual.ts` | **新規**: `manualPdfPath()` / `openManual()`（Task 7） |
| `apps/desktop/src/main/ipc.ts` / `src/preload/index.ts` | **変更（追記のみ）**: 8本目の登録と公開（Task 7） |
| `apps/desktop/scripts/print-manual.mjs` | **新規**: HTML から PDF（Task 7） |
| `apps/desktop/electron-builder.yml` | **変更（追記のみ）**: `extraResources` に1項目（Task 7） |
| `apps/desktop/scripts/check-dist.mjs` | **変更（追記のみ）**: PDF の検査3点（Task 7） |
| `apps/desktop/test/manual-ipc.test.ts` / `test/release-manual.test.ts` | **新規**: 8本目と同梱の検査（Task 7） |
| `apps/desktop/e2e/manual-shots.spec.ts` | **新規**: スクリーンショットの撮影と吹き出し（Task 12） |
| `docs/manual/images/*.png` | **新規**: 吹き出し入りのスクリーンショット17枚（Task 12） |
| `apps/desktop/scripts/annotate-shots.mjs` | **新規**: 吹き出しを重ねた HTML を組む純関数（Task 12） |
| `docs/manual/shots.json` | **新規**: 図の意味（Task 5） |
| `docs/manual/shot-geometry.json` | **新規**: 図の場所（Task 12） |
| `apps/desktop/test/manual-shots.test.ts` | **新規**: 図の意味と原稿の対応（Task 5） |
| `apps/desktop/test/annotate-shots.test.ts` | **新規**: 吹き出しの HTML（Task 12） |
| `apps/desktop/test/manual-images.test.ts` | **新規**: 画像の寸法・大きさ・実在（Task 12） |
| `apps/desktop/e2e/help.spec.ts` | **新規**: 受入基準①②③⑥（Task 11） |

---

## 設計判断（レビューで確認する決定表）

設計そのものの決定は**本設計 §3 の決定表#1〜#28** にある。ここには**実装の進め方**についての決定だけを書く。

| # | 決めたこと | 採用した設計 | 理由・却下した案 |
|---|---|---|---|
| P1 | **タスクの割り方** | 「仕組み（Task 1・2）→ 原稿（3・4）と画面（6・7）を並行 → 検査（5）と導線（8）を並行 → 一致検査と配布（9・10）→ 図と E2E（11・12）」の5バッチ | 原稿を書く作業と画面を作る作業は触るファイルが1つも重ならないので並行できる。図（Task 11）を最後にするのは、図に**ヘルプの引き出しそのもの**（`help-drawer.png`）が要るため |
| P2 | **原稿タスクのモデル** | Task 3・4 は **Sonnet-verbatim**。本プランが全章の見出しと各節の書き出しを実文で持ち、残りは `coverage.json` の行と設計仕様の該当節から機械的に埋まる | 原稿は量が多いが判断は少ない（何を書くかは機能一覧表が決めている）。判断が要るのは**規則の設計**（Task 5）であって執筆ではない |
| P3 | **`coverage.json` の `controls` をどう埋めるか** | `node scripts/feature-inventory.mjs` が出す全IDを起点に、本プランの「画面→章」対応表（Task 1 Step 3）で節を決める。`internal` にしてよいのは**2種類だけ**で、理由を1文で書く | 200件を超える行を本プランに書き写すと、実装時にはもう古い（Plan 5 の画面が landed した直後である）。**抽出コマンドと判断規則**を渡すほうが正確で、テストが漏れを必ず捕まえる |
| P4 | **`markdown-it` をいつ入れるか** | Task 2 Step 1 で `pnpm --filter @ojt/desktop add -D -E markdown-it` を実行し、`pnpm-lock.yaml` ごと commit する | 依存を足すのはこの1回きり。先に入れておかないと変換のテストが書けない。版を `-E`（正確な版）で固定するのは `apps/desktop/package.json` の既存の流儀に合わせるため |
| P5 | **pre スクリプトに頼らない** | `build` / `dist` の中に `node scripts/build-manual.mjs` を**明示的に繋ぐ**（`prebuild` を作らない） | pnpm は `enable-pre-post-scripts` が既定で無効で、`prebuild` が走らない。既存の `predist` も `dist` の中で `copy-content.mjs` を呼び直しているのと同じ理由である |
| P6 | **生成物を整形・検査の対象から外す** | `src/renderer/help/manual-content.ts` を `.prettierignore` と `eslint.config.js` の `ignores` に足す | 生成物を人の規則で整形すると、次の生成でまた差分が出て `manual-sync.test.ts` が落ちる。中身の正しさはバイト一致検査が保証している |
| P7 | **生成物の改行コード** | 変換は入力を `\r\n` → `\n` に正規化し、出力も `\n` で綴じる。検査も両辺を正規化してから比べる | Windows で作業しているので、git の改行変換や編集器の設定でバイト一致が壊れる。正規化を両端に置けば OS に依らない |
| P8 | **ヘルプの本文を差し込む方法** | `dangerouslySetInnerHTML` を使う。差し込む文字列は**ビルド時にこのリポジトリの Markdown から作ったもの**だけで、課題JSONも利用者入力も混ざらない。`markdown-it` は `html: false` で走らせるので原稿の生 HTML も escape 済み | React の要素に組み直すには HTML パーサをもう1つ持つことになり、実行時依存が増える（§15）。差し込む値の出どころが1つに固定されていることを、`manual-sync.test.ts`（正本から作り直して照合）が毎回証明する |
| P16 | **図の URL を誰が決めるか**（利用者の決定 2026-09-20） | 生成物の HTML には `src` を**書かない**。`<img data-manual-image="<名前>">` とだけ書き、`manual-content.ts` が `@manual-images` の別名で読み込んだ `MANUAL_IMAGES` を、引き出しが差し込んだあとの DOM を走査して `src` に入れる | 束ねた図の URL（内容ハッシュ付き）は Vite が決めるので、変換スクリプト（素の Node）には分からない。差し込みを画面側に1箇所だけ置けば、生成物は束ね方を知らないままでよく、`manual-sync.test.ts` のバイト一致も壊れない |
| P17 | **原寸をいつ読み込むか**（同上） | 本文には**縮小版**（幅400px）を `loading="lazy"` で出し、**原寸は押されたときだけ**覆いで出す | 引き出しは幅420pxなので、本文で原寸（1280px）を出しても縮まって読めないうえ、節を開くたびに数MBを読むことになる。縮小版だけなら1節あたり 80KB 以下で済み、細かい字を読みたいときだけ原寸を開けばよい |
| P9 | **E2E で PDF のボタンを押さない** | `e2e/help.spec.ts` はボタンが出ていて押せることと、`resources/manual/manual.pdf` が実在することまでを確かめる。`shell.openPath()` の3分岐は `test/manual-ipc.test.ts`（`electron` を差し替え）が縛る | 押すと OS の既定 PDF ビューアが本当に起動し、CI でもレビュー中でも閉じられない。受入基準③の「実際に開くこと」は Plan 5 のリリース手順チェックリストに1項目足して人が確かめる（意図的な差分#3） |
| P10 | **図の撮影を E2E にするか単体にするか** | Playwright（`e2e/manual-shots.spec.ts`）。`pnpm --filter @ojt/desktop e2e manual-shots` で撮り直す | 3D盤は WebGL なので happy-dom では描けない。既存6本の E2E と同じ `capturePage()` の作法をそのまま使う |
| P11 | **図の撮り直しを CI の必須にするか** | しない。`manual-shots.spec.ts` は他の E2E と同じく `pnpm e2e` で走るが、**失敗するのは撮れなかったときだけ**で、中身の比較はしない。画像の寸法・大きさ・参照の実在は `manual-images.test.ts`（Vitest）が git にある PNG を見て縛る | 画面の見た目を1pxでも変えるたびに E2E が落ちると、誰も画面を直さなくなる。守りたいのは「図が実在し、規格どおりで、本アプリのものである」ことだけである |
| P12 | **テストの本数** | packages への変更は**0**。desktop に **123件**足す（Task 1 の 6／2 の 22／5 の 24／6 の 12／7 の 12／8 の 17／9 の 9／10 の 7／12 の 14。Task 3・4・11 は単体テストを足さない） | 各タスクの「期待」に内訳を書く。`pnpm -r test` の総数が合わないときは足し忘れか二重登録である |
| P13 | **図を最後にまわす** | 撮影と吹き出し（Task 12）を**最後のバッチF**にし、それまでは図の実在も寸法も見ない。原稿（Task 3・4）は図を参照してよく、図の**意味**（`shots.json`）は Task 5 で決める | 利用者の決定（2026-09-19）。画面を直すたびに17枚を撮り直すのは無駄で、撮り直しを忘れた図が残るほうが害が大きい。全機能が landed し、全画面のUX直しが終わった状態で1回だけ撮れば、載る図が必ず最新になる |
| P14 | **図の定義を2つのファイルに分ける** | `shots.json`（意味＝説明文・吹き出しの番号とラベル）は Task 5、`shot-geometry.json`（場所＝矩形と切り出し）は Task 12 | 「何を指すか」は原稿と同時に決められるが、「どこを指すか」は撮ってみないと決まらない。1つのファイルにすると、Task 5 の時点で画素の位置を当てずっぽうで書くことになる。分けておけば、どちらのファイルもそれを書く時点で**完全**である |
| P15 | **吹き出しの描き方に新しい依存を足さない** | `scripts/annotate-shots.mjs` の `overlayHtml()` が HTML を組み、**Playwright の Chromium**がそれを開いて撮り直す。`overlayHtml()` は純関数なので Vitest で単体検査できる | 純 JS で PNG に丸数字と日本語ラベルを描くにはフォントのラスタライザが要り、重い依存になる。Chromium は既に devDependency にあり、OS のフォントでアプリと同じ字が出る。描画の正しさは「HTML が正しいか」と「撮れたか」に分けて確かめられる |

---

## 実装バッチ（推奨）

依存関係にもとづく5バッチ。バッチ内の `／` は並行可、`→` は直列。**並行の上限は2系統**。

| バッチ | タスク | 対象 | モデル | 依存 |
|---|---|---|---|---|
| A | 1 → 2 | 機能一覧の抽出と機能一覧表 → Markdown の変換と生成物 | 1=**Opus** / 2=**Opus** | Plan 5 Task 14 が landed |
| B | 3 → 4 ／ 6 → 7 | 正本 前半6章 → 後半7章 ／ ヘルプの純関数層 → PDF・8本目のIPC・同梱 | 3=Sonnet-verbatim / 4=Sonnet-verbatim ／ 6=Sonnet-verbatim / 7=**Opus** | A |
| C | 5 ／ 8 | 文体・用語・機能網羅・図の意味の検査 ／ ヘルプの引き出し | 5=**Opus** ／ 8=**Opus** | B |
| D | 9 → 10 | 全画面の導線と `F1` → コードの表と説明書の一致 | 9=**Opus** / 10=Sonnet-verbatim | C |
| E | 11 | E2E と全体検証（**図は見ない**） | 11=**Opus** | D |
| **F** | 12 | **スクリーンショットの撮影と吹き出し（プラン最後）** | 12=**Opus** | E ＋ 全画面のUX直しが landed |

進め方: **A** → **B（2系統を並行）** → **C（2系統を並行）** → **D** → **E** → **F**。各バッチの終わりに **Opus レビューを1回**かける（レビュー方針: グループごとに1回、細かい指摘はまとめて修正）。

**バッチF は必ず最後に置く**（利用者の決定 2026-09-19、決定表 P13）。Task 1〜11 がすべて landed し、**全画面のUX直しも終わってから**撮る。それまでの段階では:

- 原稿（Task 3・4）は `![…](images/xxx.png)` を書いてよい。画像ファイルはまだ無くてよい。
- 図の**意味**（`shots.json`）は Task 5 で決め、本文が吹き出しの番号とラベルを指していることは Task 5 の `manual-shots.test.ts` が**画像を見ずに**確かめる。
- 図の**実在・寸法・大きさ**を見る `manual-images.test.ts` は **Task 12 で初めて入る**。それより前に入れると、撮っていないあいだじゅう `pnpm -r test` が落ち続ける。
- `build-manual.mjs` は図が無ければ「図はまだありません」と言って通す（Task 2 Step 4 のとおり）。PDF にも図の無いページが出るだけで、工程は止まらない。

並行の組み合わせが安全である理由:

- **バッチB**: Task 3・4 は `docs/manual/*.md` と生成物の作り直しだけ。Task 6・7 は `src/renderer/help/**` と `i18n/ja.ts` の末尾だけ。**重なるのは `manual-content.ts` だけ**で、これは生成物なので「どちらのタスクも最後に `node scripts/build-manual.mjs` を走らせる」で衝突しない（MERGE 注意#2）。
- **バッチC**: Task 5 は `docs/manual/*.json` と `test/manual-*.test.ts` だけ。Task 8 は画面5枚と `ja.ts` と `Toolbar.tsx` だけ。重なりは無い。

「Sonnet-verbatim」と書いたタスクは、本書のコード・原稿・テストをそのまま書き写せば通る。**Opus** は判断の要るタスク（機能一覧表の埋め方、変換の設計、検査規則、引き出しの作り、`F1` の調停、配布への組み込み、図の撮り方、E2E の待ち方）である。**どのタスクも、後のタスクが作るファイルを import しない。**

---

## Task 1: 機能一覧の抽出と機能一覧表

**モデル: Opus**（どの目印が「画面に出る操作要素」でどれが試験用の目印かの判断と、200件を超える行の節への割り当て）

**Files:**
- Create: `apps/desktop/scripts/feature-inventory.mjs`
- Create: `apps/desktop/scripts/feature-inventory.d.mts`
- Create: `docs/manual/coverage.json`
- Test: `apps/desktop/test/feature-inventory.test.ts`

本設計 決定表#22。このタスクは**説明書が何を説明しなければならないかを決める**。以降のタスクはこの表を埋める作業になる。

- [x] **Step 1: 失敗するテストを書く（抽出の規則）**

`apps/desktop/test/feature-inventory.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectTestIds, testIdsIn } from '../scripts/feature-inventory.mjs';

/**
 * 機能一覧表の網羅。取扱説明書 設計 §6.3 / 決定表#22。
 *
 * 画面に操作要素を1つ足すと、このテストが「機能一覧表に無い」と言って落ちる。
 * 説明書に書くか、画面に出ない内部用である理由を書くかしないと通らない。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COVERAGE = JSON.parse(
  readFileSync(resolve(APP_ROOT, '../../docs/manual/coverage.json'), 'utf8'),
) as {
  controls: ReadonlyArray<{ testid: string; screen?: string; label?: string; section?: string; internal?: string }>;
  keys: ReadonlyArray<{ key: string; screen: string; action: string; section: string }>;
  gestures: ReadonlyArray<{ name: string; screen: string; action: string; section: string }>;
  messages: ReadonlyArray<{ key: string; section: string }>;
};

describe('目印の拾い方', () => {
  it('reads a plain data-testid', () => {
    expect([...testIdsIn('<button data-testid="judge-button">判定</button>')]).toEqual([
      'judge-button',
    ]);
  });

  it('folds a template into {}', () => {
    expect([...testIdsIn('<tr data-testid={`open-${problem.id}`}>')]).toEqual(['open-{}']);
  });

  it('reads the testId prop that SidePanel takes', () => {
    expect([...testIdsIn('<SidePanel testId="shortcuts-note" />')]).toEqual(['shortcuts-note']);
  });

  it('finds nothing in a file without markers', () => {
    expect([...testIdsIn('export const x = 1;')]).toEqual([]);
  });
});

describe('機能一覧表', () => {
  it('covers exactly the controls the screens have', () => {
    const found = collectTestIds();
    const listed = COVERAGE.controls.map((row) => row.testid).sort();
    // 不足＝説明していない操作要素、余分＝画面から消えたのに表に残っている行
    expect(listed).toEqual(found);
  });

  it('gives every listed control either a section or a reason for being internal', () => {
    for (const row of COVERAGE.controls) {
      const documented = typeof row.section === 'string' && row.section.length > 0;
      const internal = typeof row.internal === 'string' && row.internal.length >= 6;
      expect(documented !== internal, `${row.testid} は節か内部用の理由のどちらか一方を持つ`).toBe(
        true,
      );
      if (documented) {
        expect(typeof row.screen, `${row.testid} に画面名がない`).toBe('string');
        expect((row.label ?? '').length, `${row.testid} に画面の文言がない`).toBeGreaterThan(0);
      }
    }
  });
});
```

期待（Step 3 のあと）: **6件通る**。

```
pnpm --filter @ojt/desktop test feature-inventory
# 期待: FAIL（`../scripts/feature-inventory.mjs` も coverage.json も無い）
```

- [x] **Step 2: 抽出器を作る**

`apps/desktop/scripts/feature-inventory.mjs`:

```js
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 画面の操作要素を数え上げる。取扱説明書 設計 §6.3 / 決定表#22。
 *
 * `src/renderer/**\/*.tsx` に書かれた目印（`data-testid` と、`SidePanel` などが取る
 * `testId` プロパティ）を全部拾って並べる。`docs/manual/coverage.json` はこの集合と
 * **完全に一致**していなければならない（`test/feature-inventory.test.ts`）。
 *
 * 単独で走らせると JSON を標準出力に出すので、機能一覧表を作り直すときに使える:
 *   node scripts/feature-inventory.mjs
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');

/** 走査するフォルダ。 */
export const RENDERER_DIR = join(APP_ROOT, 'src', 'renderer');

/**
 * 差し込み（`${…}`）を `{}` に畳む。
 * `open-${problem.id}` は課題の数だけ実体があるが、説明書から見れば1つの機能なので
 * `open-{}` という1行にまとめる。
 */
function foldTemplate(raw) {
  return raw.replace(/\$\{[^}]*\}/gu, '{}');
}

/** 目印の書き方4通り。 */
const PATTERNS = [
  /data-testid="([^"]+)"/gu,
  /data-testid=\{`([^`]+)`\}/gu,
  /\btestId="([^"]+)"/gu,
  /\btestId=\{`([^`]+)`\}/gu,
];

/** 1ファイル分の目印。 */
export function testIdsIn(source) {
  const found = new Set();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const raw = match[1];
      if (raw !== undefined) found.add(foldTemplate(raw));
      match = pattern.exec(source);
    }
  }
  return found;
}

/** フォルダの `.tsx` を名前順に並べる。 */
function tsxFiles(dir) {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(path));
    else if (entry.name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** 画面ぜんぶの目印（重複を除いて並べ替えたもの）。 */
export function collectTestIds(dir = RENDERER_DIR) {
  const found = new Set();
  for (const file of tsxFiles(dir)) {
    for (const id of testIdsIn(readFileSync(file, 'utf8'))) found.add(id);
  }
  return [...found].sort();
}

// `globalThis.` を付けるのは、素のJS向け lint 設定に Node のグローバルが入っていないため
const entry = globalThis.process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  globalThis.process.stdout.write(`${JSON.stringify(collectTestIds(), null, 2)}\n`);
}
```

`apps/desktop/scripts/feature-inventory.d.mts`（TypeScript から読めるようにする型宣言。本体は素の JS のままにしたいので、宣言だけ別に置く）:

```ts
export declare const RENDERER_DIR: string;
export declare function testIdsIn(source: string): Set<string>;
export declare function collectTestIds(dir?: string): string[];
```

- [x] **Step 3: 機能一覧表を作る**

```
cd apps/desktop && node scripts/feature-inventory.mjs > "$TEMP/testids.json"
```

出てきた ID を1行ずつ `docs/manual/coverage.json` の `controls` に写し、次の規則で `screen` / `label` / `section` を決める。

**画面 → 章の対応**（節の名前は本設計 §6.1 の一覧から選ぶ）:

| 目印の出どころ | `screen` | 説明する章 |
|---|---|---|
| `app/App.tsx` | 全画面 | `troubleshooting`（例外の帯・復元の確認）／`workfile`（復元カード） |
| `screens/Home.tsx` | ホーム | `intro` / `screens` |
| `screens/ProblemList.tsx` | 課題一覧 | `screens` |
| `screens/Settings.tsx` | 設定 | `settings` |
| `panels/Toolbar.tsx` | 練習中 | `screens`（上の帯） |
| `screens/Session.tsx`・`three/**` | 練習中（モードB） | `mode-b` / `screens` |
| `screens/InspectPartsSession.tsx`・`panels/{CheckTray,MarkSheet,Diagnosis}*` | 練習中（モードC1） | `mode-c1` |
| `screens/InspectRepairSession.tsx`・`panels/{Repair,Report}*` | 練習中（モードC2） | `mode-c2` |
| `screens/PlcSession.tsx`・`ladder/**` | 練習中（モードD） | `mode-d` |
| `schematic/**` | 回路図 | `schematic` |
| `result/**`・`screens/Result.tsx` | 結果 | `screens/結果の画面` ＋ 各モードの章 |
| `panels/{Tester,AnalogMeter}*` | テスター | `mode-c1/テスターの使い方` |
| `panels/{TimeChart,Chart}*` | 結果・練習中 | `screens/タイムチャートの読み方` |
| `panels/{Power,Parts,Log,Warning,ElapsedTimer,ViewHint,Problem}*` | 練習中 | `screens` / `mode-b` |
| `help/**`（Task 7 で増える） | 全画面 | `screens/画面の上の帯` |

**`internal` にしてよいのは次の2つだけ**。理由を6文字以上で書く。

1. 画面に文字も枠も出さない、試験のためだけの目印（例: `camera-readout`、`board-canvas`、`cursor-inner`）。
2. すでに説明した親要素の内側にある入れ子の目印で、利用者から見て別の機能ではないもの（例: `mark-result-table` の中の `reading-{}`）。

**迷ったら `internal` にしない**。説明を1行足すほうが安い。

`keys`（手で書く。全部そのまま写す）:

```json
"keys": [
  { "key": "F1", "screen": "全画面", "action": "ヘルプを開く・閉じる", "section": "screens/画面の上の帯" },
  { "key": "Esc", "screen": "全画面", "action": "開いている窓を閉じる・配線をやめる", "section": "screens/画面の上の帯" },
  { "key": "1", "screen": "練習中", "action": "正面から見る", "section": "screens/3Dの見かたと動かしかた" },
  { "key": "2", "screen": "練習中", "action": "上から見る", "section": "screens/3Dの見かたと動かしかた" },
  { "key": "3", "screen": "練習中", "action": "ソケットを大きく見る", "section": "screens/3Dの見かたと動かしかた" },
  { "key": "Home", "screen": "練習中", "action": "盤ぜんたいを見る", "section": "screens/3Dの見かたと動かしかた" },
  { "key": "テンキーの1・3・7", "screen": "練習中", "action": "正面・右・上から見る（Ctrl を足すと反対側）", "section": "screens/3Dの見かたと動かしかた" },
  { "key": "Delete", "screen": "練習中", "action": "えらんだ電線を外す", "section": "mode-b/電線をつなぐ・外す" },
  { "key": "F2", "screen": "練習中（モードB）", "action": "盤・並べて・回路図を切り替える", "section": "schematic/この機能でやること" },
  { "key": "b", "screen": "テスター", "action": "黒い棒を次の端子へ", "section": "mode-c1/テスターの使い方" },
  { "key": "r", "screen": "テスター", "action": "赤い棒を次の端子へ", "section": "mode-c1/テスターの使い方" },
  { "key": "0", "screen": "テスター", "action": "0オーム調整をする", "section": "mode-c1/テスターの使い方" },
  { "key": "矢印", "screen": "回路図・ラダー", "action": "書き込む場所を動かす", "section": "schematic/回路図を描く" },
  { "key": "Enter", "screen": "回路図", "action": "えらんだ部品を置く", "section": "schematic/回路図を描く" },
  { "key": "Insert", "screen": "回路図", "action": "段を1本ふやす", "section": "schematic/回路図を描く" },
  { "key": "Ctrl+Z", "screen": "回路図・ラダー", "action": "ひとつ前に戻す", "section": "schematic/回路図を描く" },
  { "key": "Ctrl+Y", "screen": "回路図・ラダー", "action": "戻したものをやり直す", "section": "schematic/回路図を描く" },
  { "key": "F5", "screen": "ラダー（三菱の書き方）", "action": "a接点を置く", "section": "mode-d/キーの割り当て" },
  { "key": "F7", "screen": "ラダー（三菱の書き方）", "action": "コイルを置く", "section": "mode-d/キーの割り当て" },
  { "key": "F4", "screen": "ラダー（三菱の書き方）", "action": "変換する", "section": "mode-d/キーの割り当て" },
  { "key": "F3", "screen": "ラダー（三菱の書き方）", "action": "動きを見る", "section": "mode-d/キーの割り当て" },
  { "key": "Tab", "screen": "全画面", "action": "次の操作先へ進む（マウスなしで操作できます）", "section": "screens/画面の上の帯" }
]
```

`gestures`（手で書く。全部そのまま写す）:

```json
"gestures": [
  { "name": "左ボタンでドラッグ", "screen": "3Dビュー", "action": "盤を回す", "section": "screens/3Dの見かたと動かしかた" },
  { "name": "右ボタンでドラッグ", "screen": "3Dビュー", "action": "盤を平行に動かす", "section": "screens/3Dの見かたと動かしかた" },
  { "name": "ホイールを回す", "screen": "3Dビュー", "action": "近づく・遠ざかる", "section": "screens/3Dの見かたと動かしかた" },
  { "name": "ビューキューブをドラッグする", "screen": "3Dビュー", "action": "指についてくるように盤を回す", "section": "screens/3Dの見かたと動かしかた" },
  { "name": "ビューキューブの面をクリックする", "screen": "3Dビュー", "action": "その向きから見る", "section": "screens/3Dの見かたと動かしかた" },
  { "name": "ビューキューブの辺や角をクリックする", "screen": "3Dビュー", "action": "ななめから見る", "section": "screens/3Dの見かたと動かしかた" },
  { "name": "XYZの玉をクリックする", "screen": "3Dビュー", "action": "その軸の向きから見る", "section": "screens/3Dの見かたと動かしかた" },
  { "name": "端子にマウスを乗せる", "screen": "3Dビュー", "action": "端子の名前と役割の札が出る", "section": "screens/端子にさわると出る札" },
  { "name": "端子をクリックしてから別の端子をクリックする", "screen": "3Dビュー", "action": "電線を1本つなぐ", "section": "mode-b/電線をつなぐ・外す" },
  { "name": "ソケットをクリックする", "screen": "3Dビュー", "action": "部品をのせる・外す・入れかえるカードが出る", "section": "screens/部品を入れかえる" },
  { "name": "タイマのつまみをドラッグする", "screen": "3Dビュー", "action": "時間を決める", "section": "mode-b/タイマの時間を決める" },
  { "name": "回路図の記号をクリックする", "screen": "回路図", "action": "盤の対応する端子が光る", "section": "schematic/図のとおりに盤へつなぐ" }
]
```

`messages` は Step 4 のテスト（Task 5）が実物のキーから作った集合と照合するので、**キー名をそのまま**並べる。すべて `troubleshooting/こう表示されたら` を指す。Task 5 Step 3 に書き出し方を示す。ここでは空の配列 `[]` ではなく、次の7群の全キーを `JA.error.banner` のような完全な名前で並べること。

```
JA.error.* / JA.hazard.* / JA.staticCheck.* / JA.disabledReason.* /
JA.routeReason.* / JA.mismatchReason.* / MSG.workFile.* / MSG.content.* / MSG.textFile.*
```

- [x] **Step 4: テストを通す**

```
pnpm --filter @ojt/desktop test feature-inventory
# 期待: Test Files 1 passed / Tests 6 passed
pnpm --filter @ojt/desktop typecheck && pnpm lint
# 期待: どちらも無警告
```

- [x] **Step 5: commit**

```
git add apps/desktop/scripts/feature-inventory.mjs apps/desktop/scripts/feature-inventory.d.mts apps/desktop/test/feature-inventory.test.ts docs/manual/coverage.json
git diff --cached --stat
git commit -m "feat(desktop): list every on-screen control so the manual cannot miss one (Plan 6 Task 1)"
git show --stat HEAD
```

---

## Task 2: Markdown の変換と生成物

**モデル: Opus**（節の切り出し・図の二重出力・生成物をバイト一致で縛る設計）

**Files:**
- Modify: `apps/desktop/package.json`（`devDependencies` に `markdown-it`、`build` と `dev` に変換の工程）
- Create: `apps/desktop/scripts/manual-build.mjs`
- Create: `apps/desktop/scripts/manual-build.d.mts`
- Create: `apps/desktop/scripts/build-manual.mjs`
- Create: `docs/manual/00-intro.md`（この段階では「はじめに」の1章だけ。本文は Task 3 が書き足す）
- Create: `apps/desktop/src/renderer/help/manual-content.ts`（**生成物**）
- Modify: `.prettierignore` / `eslint.config.js` / `.gitignore`
- Modify: `apps/desktop/electron.vite.config.ts`（`@manual-images` の別名と `server.fs.allow`。取扱説明書 設計 §7.2b）
- Test: `apps/desktop/test/manual-build.test.ts`（新規）
- Test: `apps/desktop/test/manual-sync.test.ts`（新規）

本設計 §4 と 決定表#2・#3・#9・#12・#13、本プラン 決定表 P4〜P8。

- [x] **Step 1: `markdown-it` を入れる**

```
pnpm --filter @ojt/desktop add -D -E markdown-it
git diff --stat -- apps/desktop/package.json pnpm-lock.yaml
# 期待: apps/desktop/package.json の devDependencies に "markdown-it": "14.1.0"（版は入った実物に合わせる）
#       dependencies は1つも増えていない
```

- [x] **Step 2: 失敗するテストを書く（変換の規則）**

`apps/desktop/test/manual-build.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildManual, chapterIdOf, plainText } from '../scripts/manual-build.mjs';

/**
 * 正本（Markdown）の変換。取扱説明書 設計 §4.2。
 * ここで縛るのは「節の切り出し」「素の文」「図の二重出力」「壊れた原稿を黙って通さないこと」。
 */

const INTRO = [
  '# はじめに',
  '',
  '## このアプリでできること',
  '',
  'このアプリは、電気の練習盤をパソコンの画面の中で動かせるようにしたものです。',
  '',
  '![ホームの画面。4つの練習が並んでいます。](images/home.png)',
  '',
  '## 画面の呼び名',
  '',
  'いちばん上の帯を「上の帯」と呼びます。',
  '',
  '| 名前 | 場所 |',
  '|---|---|',
  '| 上の帯 | 画面のいちばん上 |',
  '',
].join('\n');

function build() {
  return buildManual([{ name: '00-intro.md', text: INTRO }]);
}

describe('章とファイル名', () => {
  it('takes the chapter id from the file name', () => {
    expect(chapterIdOf('04-mode-c1.md')).toBe('mode-c1');
  });

  it('refuses a file name without the two-digit prefix', () => {
    expect(() => chapterIdOf('intro.md')).toThrow('章のファイル名が規則に合いません');
  });
});

describe('節の切り出し', () => {
  it('names the chapter from the first heading', () => {
    expect(build().chapters).toEqual([
      {
        id: 'intro',
        title: 'はじめに',
        sectionIds: ['intro/このアプリでできること', 'intro/画面の呼び名'],
      },
    ]);
  });

  it('keeps the heading out of the section html', () => {
    const section = build().sections[0];
    expect(section?.title).toBe('このアプリでできること');
    expect(section?.html).not.toContain('<h2');
  });

  it('renders a table', () => {
    expect(build().sections[1]?.html).toContain('<table>');
  });

  it('refuses a chapter whose first line is not a heading', () => {
    expect(() => buildManual([{ name: '00-intro.md', text: 'ここに本文\n' }])).toThrow(
      '章の1行目が',
    );
  });

  it('refuses two sections with the same heading in one chapter', () => {
    const text = '# はじめに\n\n## 同じ\n\nあ\n\n## 同じ\n\nい\n';
    expect(() => buildManual([{ name: '00-intro.md', text }])).toThrow('同じ見出しが2つ');
  });

  it('refuses a chapter with no section', () => {
    expect(() => buildManual([{ name: '00-intro.md', text: '# はじめに\n' }])).toThrow(
      '節がありません',
    );
  });
});

describe('図の扱い（決定表#9。利用者の決定 2026-09-20）', () => {
  it('gives the in-app help a figure it can fill in later', () => {
    const section = build().sections[0];
    expect(section?.hasFigure).toBe(true);
    expect(section?.imageNames).toEqual(['home']);
    // 束ねた図の URL は Vite が決めるので、生成物には `src` を書かない（決定表 P16）
    expect(section?.html).toContain('data-manual-image="home"');
    expect(section?.html).toContain('loading="lazy"');
    expect(section?.html).toContain('width="400"');
    expect(section?.html).toContain('<button type="button"');
    expect(section?.html).not.toContain('src=');
  });

  it('keeps the figure for the printed manual', () => {
    const section = build().sections[0];
    expect(section?.printHtml).toContain('<img src="images/home.png"');
    expect(section?.printHtml).toContain('<figcaption>');
  });

  it('shows the same figures in the same order on both sides', () => {
    const section = build().sections[0];
    const printed = [...(section?.printHtml ?? '').matchAll(/<img src="images\/([^."]+)\.png"/gu)].map(
      (match) => match[1],
    );
    expect(printed).toEqual(section?.imageNames);
  });

  it('keeps the figure out of the plain text', () => {
    const section = build().sections[0];
    expect(section?.text).not.toContain('ホームの画面');
    expect(section?.text).toContain('練習盤をパソコンの画面の中で動かせる');
  });
});

describe('素の文', () => {
  it('drops tags and unescapes entities', () => {
    expect(plainText('<p>a &amp; b</p><p>c</p>')).toBe('a & b c');
  });
});

describe('生成物', () => {
  it('writes a TypeScript module the app can import', () => {
    const { helpModule } = build();
    expect(helpModule).toContain('export const MANUAL_SECTIONS');
    expect(helpModule).toContain('export const MANUAL_CHAPTERS');
    expect(helpModule).toContain('export const MANUAL_SOURCES');
    expect(helpModule).toContain('export const MANUAL_IMAGES');
    // 図は Vite の別名で読み込む（取扱説明書 設計 §7.2b）
    expect(helpModule).toContain("from '@manual-images/small/home.png'");
    expect(helpModule).toContain("from '@manual-images/home.png'");
    expect(helpModule).toContain('"00-intro.md"');
    // 生成物にはアプリ用の本文だけを入れる（印刷用の本文は PDF 側にしかない）
    expect(helpModule).not.toContain('printHtml');
    expect(helpModule.endsWith('\n')).toBe(true);
  });

  it('writes one printable html with a cover, a table of contents and every section', () => {
    const { printHtml } = build();
    expect(printHtml).toContain('<!doctype html>');
    expect(printHtml).toContain('電気教育ツール');
    expect(printHtml).toContain('id="toc"');
    expect(printHtml).toContain('data-section-id="intro/このアプリでできること"');
    expect(printHtml).toContain('<img src="images/home.png"');
  });
});
```

期待（Step 3 のあと）: **16件通る**。

`apps/desktop/test/manual-sync.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildManual } from '../scripts/manual-build.mjs';
import { MANUAL_CHAPTERS, MANUAL_SECTIONS, MANUAL_SOURCES } from '../src/renderer/help/manual-content.js';

/**
 * 正本と生成物の一致。取扱説明書 設計 §4.3 / 決定表#2・#12。
 * **利用者要求「取扱説明書とヘルプの内容は一致していること」を機械で保証するテスト。**
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const GENERATED = join(APP_ROOT, 'src', 'renderer', 'help', 'manual-content.ts');

/** 改行コードをそろえる（Windows と Linux で生成物が違って見えないように。決定表 P7）。 */
function lf(text: string): string {
  return text.replace(/\r\n/gu, '\n');
}

function manualFiles(): Array<{ name: string; text: string }> {
  return readdirSync(MANUAL_DIR)
    .filter((name) => /^\d{2}-.+\.md$/u.test(name))
    .sort()
    .map((name) => ({ name, text: lf(readFileSync(join(MANUAL_DIR, name), 'utf8')) }));
}

/** 印刷用 HTML から節ID・見出し・素の文を取り出す（生成物と同じ3つ）。 */
function sectionsOfPrintHtml(html: string): Array<{ id: string; title: string; text: string }> {
  const out: Array<{ id: string; title: string; text: string }> = [];
  const pattern =
    /<section class="manual-section" data-section-id="([^"]+)">\s*<h2>([\s\S]*?)<\/h2>([\s\S]*?)<\/section>/gu;
  let match = pattern.exec(html);
  while (match !== null) {
    const [, id, title, body] = match;
    if (id !== undefined && title !== undefined && body !== undefined) {
      out.push({ id, title, text: plainOf(body) });
    }
    match = pattern.exec(html);
  }
  return out;
}

/** `manual-build.mjs` の `plainText()` と同じ規則（図を落としてタグを剥がす）。 */
function plainOf(html: string): string {
  return html
    .replace(/<figure[\s\S]*?<\/figure>/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

describe('正本と生成物', () => {
  const built = buildManual(manualFiles());

  it('has a generated module identical to a fresh build of the manual', () => {
    expect(lf(readFileSync(GENERATED, 'utf8'))).toBe(built.helpModule);
  });

  it('remembers exactly the chapters that exist today', () => {
    expect([...MANUAL_SOURCES]).toEqual(manualFiles().map((file) => file.name));
    expect(MANUAL_CHAPTERS.map((c) => c.id)).toEqual(built.chapters.map((c) => c.id));
  });

  it('gives the in-app help and the printed manual the same headings and the same words', () => {
    const printed = sectionsOfPrintHtml(built.printHtml);
    const inApp = MANUAL_SECTIONS.map((s) => ({ id: s.id, title: s.title, text: s.text }));
    expect(printed).toEqual(inApp);
  });

  it('shows the same figures, in the same order, in the help and in the pdf', () => {
    // 利用者の決定（2026-09-20）: 図もヘルプに出すので、図の一致も検査する（決定表#12 ③）
    const printed = built.sections.map((section) => ({ id: section.id, images: section.imageNames }));
    const inApp = MANUAL_SECTIONS.map((section) => ({ id: section.id, images: [...section.imageNames] }));
    expect(inApp).toEqual(printed);
  });

  it('gives every section a unique id', () => {
    const ids = MANUAL_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists every section of every chapter exactly once', () => {
    const fromChapters = MANUAL_CHAPTERS.flatMap((c) => [...c.sectionIds]);
    expect(fromChapters).toEqual(MANUAL_SECTIONS.map((s) => s.id));
  });
});
```

期待（Step 5 のあと）: **6件通る**。

```
pnpm --filter @ojt/desktop test manual-
# 期待: FAIL（`../scripts/manual-build.mjs` が無い）
```

- [x] **Step 3: 変換の本体を作る**

`apps/desktop/scripts/manual-build.mjs`:

```js
import MarkdownIt from 'markdown-it';

/**
 * 取扱説明書の正本（Markdown）を、アプリ内ヘルプ用の TypeScript と
 * 印刷用の HTML に変換する。取扱説明書 設計 §4.2。
 *
 * **入口はこの1本だけ**にする。アプリ内ヘルプと PDF が同じ呼び出しから出てくるので、
 * 「片方だけ古い」が起こりえない（利用者要求: 説明書とヘルプの内容は一致していること）。
 */

/** アプリ内ヘルプが出す縮小版の幅[px]。決定表#9（利用者の決定 2026-09-20） */
export const HELP_IMAGE_WIDTH = 400;

/** 製品名。`i18n/ja.ts` の `APP_NAME` と同じ値だが、素の JS からは読めないのでここにも置く。 */
export const PRODUCT_NAME = '電気教育ツール';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

/*
 * 図の書き出し方を決め打ちにする。既定の書き出しは属性の順番が版によって変わりうるので、
 * あとで正規表現で拾えるように `<img src="…" alt="…">` の形に固定する。
 */
md.renderer.rules['image'] = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token === undefined) return '';
  const src = token.attrGet('src') ?? '';
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  return `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}">`;
};

/** ファイル名から章ID（`04-mode-c1.md` → `mode-c1`）。 */
export function chapterIdOf(fileName) {
  const match = /^\d{2}-(.+)\.md$/u.exec(fileName);
  const id = match?.[1];
  if (id === undefined) throw new Error(`章のファイル名が規則に合いません: ${fileName}`);
  return id;
}

/** 図だけの段落（`![説明](images/x.png)` が1行だけの段落）。 */
const FIGURE_PARAGRAPH = /<p><img src="([^"]*)" alt="([^"]*)"><\/p>/gu;

/** 印刷用: 図を `<figure>` にする（説明文を図の下に出す）。 */
function toPrintHtml(html) {
  return html.replace(
    FIGURE_PARAGRAPH,
    (_all, src, alt) => `<figure><img src="${src}" alt="${alt}"><figcaption>${alt}</figcaption></figure>`,
  );
}

/**
 * アプリ内ヘルプ用: 図を「押すと原寸が開くボタン」にする。
 * **`src` は書かない**——束ねた図の URL は Vite が決めるので、画面側が `MANUAL_IMAGES` から
 * 差し込む（取扱説明書 設計 §4.2 の規則5／本プラン 決定表 P16）。
 */
function toHelpHtml(html) {
  return html.replace(FIGURE_PARAGRAPH, (_all, src, alt) => {
    const name = imageNameOf(src);
    return (
      `<figure class="manual-figure">` +
      `<button type="button" data-manual-image="${name}">` +
      `<img data-manual-image="${name}" alt="${alt}" loading="lazy" width="${String(HELP_IMAGE_WIDTH)}">` +
      `</button><figcaption>${alt}</figcaption></figure>`
    );
  });
}

/** `images/home.png` → `home`。 */
function imageNameOf(src) {
  const match = /^images\/([A-Za-z0-9-]+)\.png$/u.exec(src);
  const name = match?.[1];
  if (name === undefined) throw new Error(`図の名前が規則に合いません: ${src}`);
  return name;
}

/** その節に出る図の名前を、出てくる順に並べる。 */
function imageNamesOf(html) {
  return [...html.matchAll(/<img src="images\/([A-Za-z0-9-]+)\.png"/gu)].map((match) => match[1]);
}

/** HTML から素の文を作る（図は落とす）。検索と一致検査はこれを見る。 */
export function plainText(html) {
  return html
    .replace(/<figure[\s\S]*?<\/figure>/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** 1章を「章題」と「節の並び」に割る。 */
function splitChapter(fileName, source) {
  const lines = source.replace(/\r\n/gu, '\n').split('\n');
  const first = lines[0] ?? '';
  if (!first.startsWith('# ')) {
    throw new Error(`章の1行目が「# 章題」ではありません: ${fileName}`);
  }
  const title = first.slice(2).trim();
  const sections = [];
  let current;
  for (const line of lines.slice(1)) {
    if (line.startsWith('## ')) {
      if (current !== undefined) sections.push(current);
      current = { title: line.slice(3).trim(), body: [] };
      continue;
    }
    if (current === undefined) {
      if (line.trim() !== '') {
        throw new Error(`章題と最初の見出しの間に本文があります: ${fileName}`);
      }
      continue;
    }
    current.body.push(line);
  }
  if (current !== undefined) sections.push(current);
  if (sections.length === 0) throw new Error(`節がありません: ${fileName}`);
  return { title, sections };
}

/** アプリ内ヘルプ用の TypeScript を組む。 */
function helpModuleOf(chapters, sections, files, availableImages) {
  const s = (value) => JSON.stringify(value);
  // その説明書に出る図を、名前の順に1回ずつ（決定表 P16）
  const imageNames = [...new Set(sections.flatMap((section) => section.imageNames))].sort();
  /*
   * まだ撮っていない図は読み込まない（決定表 P13）。`availableImages` を渡さなければ
   * 全部あるものとして扱う（単体テスト用）。撮るまでは `{ small: '', full: '' }` が入り、
   * 引き出しは `src` が空の図を描かない。
   */
  const has = (name) => availableImages === undefined || availableImages.includes(name);
  const loaded = imageNames.filter((name) => has(name));
  const imports = loaded.flatMap((name) => [
    `import full_${name.replace(/-/gu, '_')} from '@manual-images/${name}.png';`,
    `import small_${name.replace(/-/gu, '_')} from '@manual-images/small/${name}.png';`,
  ]);
  const lines = [
    '/**',
    ' * 取扱説明書の本文。**このファイルは生成物である。手で直さない。**',
    ' *',
    ' * 正本は `docs/manual/*.md`。`node scripts/build-manual.mjs` が作り直す。',
    ' * 正本との一致は `test/manual-sync.test.ts` がバイト単位で検査する（取扱説明書 設計 §4.3）。',
    ' */',
    '',
    '/** 章（正本のファイル1つ）。 */',
    'export interface ManualChapter {',
    '  id: string;',
    '  title: string;',
    '  sectionIds: readonly string[];',
    '}',
    '',
    '/** 節（章の中の見出し1つ）。ヘルプが開く単位。 */',
    'export interface ManualSection {',
    '  id: string;',
    '  chapterId: string;',
    '  chapterTitle: string;',
    '  title: string;',
    '  html: string;',
    '  text: string;',
    '  hasFigure: boolean;',
    '  /** この節に出る図の名前（出てくる順）。 */',
    '  imageNames: readonly string[];',
    '}',
    '',
    '/** 元にした正本のファイル名（並び順）。 */',
    `export const MANUAL_SOURCES: readonly string[] = [${files.map((f) => s(f.name)).join(', ')}];`,
    '',
    '/** 図の置き場所。`small` は幅400pxの縮小版、`full` は原寸。取扱説明書 設計 §7.2b */',
    'export interface ManualImage {',
    '  small: string;',
    '  full: string;',
    '}',
    '',
    '/** 図の名前 → 置き場所。 */',
    'export const MANUAL_IMAGES: Readonly<Record<string, ManualImage>> = {',
    ...imageNames.map((name) =>
      has(name)
        ? `  ${s(name)}: { small: small_${name.replace(/-/gu, '_')}, full: full_${name.replace(/-/gu, '_')} },`
        : `  ${s(name)}: { small: '', full: '' },`,
    ),
    '};',
    '',
    '/** 章の並び。 */',
    'export const MANUAL_CHAPTERS: readonly ManualChapter[] = [',
  ];
  for (const chapter of chapters) {
    lines.push('  {');
    lines.push(`    id: ${s(chapter.id)},`);
    lines.push(`    title: ${s(chapter.title)},`);
    lines.push(`    sectionIds: [${chapter.sectionIds.map((id) => s(id)).join(', ')}],`);
    lines.push('  },');
  }
  lines.push('];', '', '/** 節の並び（章の順）。 */', 'export const MANUAL_SECTIONS: readonly ManualSection[] = [');
  for (const section of sections) {
    lines.push('  {');
    lines.push(`    id: ${s(section.id)},`);
    lines.push(`    chapterId: ${s(section.chapterId)},`);
    lines.push(`    chapterTitle: ${s(section.chapterTitle)},`);
    lines.push(`    title: ${s(section.title)},`);
    lines.push(`    html: ${s(section.html)},`);
    lines.push(`    text: ${s(section.text)},`);
    lines.push(`    hasFigure: ${section.hasFigure ? 'true' : 'false'},`);
    lines.push(`    imageNames: [${section.imageNames.map((name) => s(name)).join(', ')}],`);
    lines.push('  },');
  }
  lines.push('];', '');
  // 図の読み込みは冒頭（説明の囲みの直後）に置く
  const head = lines.indexOf('') + 1;
  return [
    ...lines.slice(0, head),
    ...imports,
    ...(imports.length > 0 ? [''] : []),
    ...lines.slice(head),
  ].join('\n');
}

/** 印刷用の CSS（PDF の見た目）。決定表#26 */
const PRINT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Yu Gothic UI', 'Meiryo', sans-serif; font-size: 10.5pt; line-height: 1.8; color: #14181f; }
.cover { height: 240mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
.cover h1 { font-size: 28pt; margin: 0 0 16px; }
.cover p { margin: 4px 0; font-size: 12pt; color: #3c4654; }
#toc { page-break-after: always; }
#toc h2 { font-size: 16pt; border-bottom: 2px solid #14181f; padding-bottom: 8px; }
#toc ol { padding-left: 24px; }
#toc ol ol { padding-left: 20px; color: #3c4654; }
.manual-chapter { page-break-before: always; }
.manual-chapter > h1 { font-size: 20pt; border-bottom: 2px solid #14181f; padding-bottom: 8px; margin-bottom: 16px; }
.manual-section { page-break-inside: auto; margin-bottom: 20px; }
.manual-section > h2 { font-size: 14pt; background: #eef2f7; padding: 8px 12px; margin: 20px 0 12px; }
h3 { font-size: 12pt; margin: 16px 0 8px; }
p { margin: 8px 0; }
ul, ol { margin: 8px 0; padding-left: 24px; }
li { margin: 4px 0; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: avoid; }
th, td { border: 1px solid #9aa5b4; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #eef2f7; }
code { background: #eef2f7; padding: 1px 4px; border-radius: 3px; font-family: 'Consolas', monospace; }
pre { background: #eef2f7; padding: 12px; overflow-wrap: anywhere; white-space: pre-wrap; }
figure { margin: 12px 0; page-break-inside: avoid; text-align: center; }
figure img { max-width: 100%; border: 1px solid #9aa5b4; }
figcaption { font-size: 9pt; color: #3c4654; margin-top: 4px; }
blockquote { margin: 8px 0; padding: 8px 12px; border-left: 4px solid #9aa5b4; background: #f6f8fb; }
`.trim();

/** 印刷用の HTML（表紙 ＋ 目次 ＋ 全章）。 */
function printHtmlOf(chapters, sections, builtAt) {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const escape = (text) => md.utils.escapeHtml(text);
  const parts = [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escape(PRODUCT_NAME)} 取扱説明書</title>`,
    `<style>${PRINT_CSS}</style>`,
    '</head>',
    '<body>',
    '<div class="cover">',
    `<h1>${escape(PRODUCT_NAME)}</h1>`,
    '<p>取扱説明書</p>',
    `<p>${escape(builtAt)}</p>`,
    '</div>',
    '<nav id="toc">',
    '<h2>もくじ</h2>',
    '<ol>',
  ];
  for (const chapter of chapters) {
    parts.push(`<li>${escape(chapter.title)}`);
    parts.push('<ol>');
    for (const id of chapter.sectionIds) {
      parts.push(`<li>${escape(byId.get(id)?.title ?? '')}</li>`);
    }
    parts.push('</ol></li>');
  }
  parts.push('</ol>', '</nav>');
  for (const chapter of chapters) {
    parts.push(`<div class="manual-chapter" data-chapter-id="${escape(chapter.id)}">`);
    parts.push(`<h1>${escape(chapter.title)}</h1>`);
    for (const id of chapter.sectionIds) {
      const section = byId.get(id);
      if (section === undefined) continue;
      parts.push(`<section class="manual-section" data-section-id="${escape(section.id)}">`);
      parts.push(`<h2>${escape(section.title)}</h2>`);
      parts.push(section.printHtml);
      parts.push('</section>');
    }
    parts.push('</div>');
  }
  parts.push('</body>', '</html>', '');
  return parts.join('\n');
}

/**
 * 正本ぜんぶを変換する。
 * `files` は `{ name, text }` をファイル名の昇順に並べたもの。
 */
export function buildManual(files, builtAt = '', availableImages = undefined) {
  const chapters = [];
  const sections = [];
  for (const file of files) {
    const chapterId = chapterIdOf(file.name);
    const chapter = splitChapter(file.name, file.text);
    const sectionIds = [];
    const seen = new Set();
    for (const raw of chapter.sections) {
      if (seen.has(raw.title)) {
        throw new Error(`同じ章に同じ見出しが2つあります: ${file.name} / ${raw.title}`);
      }
      seen.add(raw.title);
      const rendered = md.render(raw.body.join('\n'));
      const helpHtml = toHelpHtml(rendered);
      const id = `${chapterId}/${raw.title}`;
      sections.push({
        id,
        chapterId,
        chapterTitle: chapter.title,
        title: raw.title,
        html: helpHtml,
        printHtml: toPrintHtml(rendered),
        text: plainText(rendered),
        hasFigure: helpHtml !== rendered,
        imageNames: imageNamesOf(rendered),
      });
      sectionIds.push(id);
    }
    chapters.push({ id: chapterId, title: chapter.title, sectionIds });
  }
  return {
    chapters,
    sections,
    helpModule: helpModuleOf(chapters, sections, files, availableImages),
    printHtml: printHtmlOf(chapters, sections, builtAt),
  };
}
```

`apps/desktop/scripts/manual-build.d.mts`:

```ts
export interface ManualFile {
  name: string;
  text: string;
}

export interface BuiltChapter {
  id: string;
  title: string;
  sectionIds: string[];
}

export interface BuiltSection {
  id: string;
  chapterId: string;
  chapterTitle: string;
  title: string;
  html: string;
  printHtml: string;
  text: string;
  hasFigure: boolean;
  imageNames: string[];
}

export interface BuiltManual {
  chapters: BuiltChapter[];
  sections: BuiltSection[];
  helpModule: string;
  printHtml: string;
}

export declare const HELP_IMAGE_WIDTH: number;
export declare const PRODUCT_NAME: string;
export declare function chapterIdOf(fileName: string): string;
export declare function plainText(html: string): string;
export declare function buildManual(
  files: readonly ManualFile[],
  builtAt?: string,
  availableImages?: readonly string[],
): BuiltManual;
```

- [x] **Step 4: 生成を走らせるスクリプトを作る**

`apps/desktop/scripts/build-manual.mjs`:

```js
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManual } from './manual-build.mjs';

/**
 * 取扱説明書の正本から生成物を作る。取扱説明書 設計 §4.1 / §7.2。
 *
 *   docs/manual/*.md ──┬─→ src/renderer/help/manual-content.ts（アプリ内ヘルプ。git に入れる）
 *                      └─→ resources/manual/manual.html ＋ images/（PDF の材料。git に入れない）
 *
 * `build` と `dist` の最初に走らせる。pnpm は `prebuild` を既定で走らせないので、
 * `package.json` の `build` / `dist` の中で明示的に繋ぐ（決定表 P5）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const IMAGE_DIR = join(MANUAL_DIR, 'images');
const OUT_DIR = join(APP_ROOT, 'resources', 'manual');
const HELP_FILE = join(APP_ROOT, 'src', 'renderer', 'help', 'manual-content.ts');

const out = globalThis.process.stdout;

/** 正本のファイル（`00-intro.md` のような名前だけ。昇順）。 */
function manualFiles() {
  return readdirSync(MANUAL_DIR)
    .filter((name) => /^\d{2}-.+\.md$/u.test(name))
    .sort()
    .map((name) => ({
      name,
      // 改行コードをそろえる（決定表 P7）
      text: readFileSync(join(MANUAL_DIR, name), 'utf8').replace(/\r\n/gu, '\n'),
    }));
}

const files = manualFiles();
if (files.length === 0) {
  globalThis.process.stderr.write(`取扱説明書の原稿がありません: ${MANUAL_DIR}\n`);
  globalThis.process.exitCode = 1;
} else {
  /*
   * 生成日は「日付だけ」にする。時刻まで入れると、同じ原稿から作った PDF が
   * 走らせるたびに違うバイト列になり、配布物のチェックサムが毎回変わる。
   */
  const builtAt = new Date().toISOString().slice(0, 10);
  // 撮り終わっている図だけを生成物に読み込ませる（決定表 P13）
  const available = existsSync(IMAGE_DIR)
    ? readdirSync(IMAGE_DIR)
        .filter((name) => name.endsWith('.png'))
        .map((name) => name.replace(/\.png$/u, ''))
        .sort()
    : [];
  const built = buildManual(files, builtAt, available);

  mkdirSync(dirname(HELP_FILE), { recursive: true });
  writeFileSync(HELP_FILE, built.helpModule, 'utf8');
  out.write(`アプリ内ヘルプを書き出しました: ${HELP_FILE}（${String(built.sections.length)}節）\n`);

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'manual.html'), built.printHtml, 'utf8');
  if (existsSync(IMAGE_DIR)) {
    // PDF は原寸を使う。縮小版（`small/`）も一緒に来るが、PDF 側は参照しないので害はない
    cpSync(IMAGE_DIR, join(OUT_DIR, 'images'), { recursive: true });
    out.write(`図を複写しました: ${String(available.length)} 枚\n`);
  } else {
    out.write('図はまだありません（Plan 6 Task 12 が撮ります）\n');
  }
  out.write(`印刷用HTMLを書き出しました: ${join(OUT_DIR, 'manual.html')}\n`);
}
```

- [x] **Step 5: 最初の1章を書き、生成物を作る**

`docs/manual/00-intro.md`（この段階は2節だけ。Task 3 が残りの節を書き足す）:

```markdown
# はじめに

## このアプリでできること

電気教育ツールは、機械保全技能検定の電気系保全作業でつかう練習盤を、パソコンの画面の中にそのまま作ったものです。実際の盤と同じように、部品をのせて、電線をつないで、電気を流して、思ったとおりに動くかどうかを確かめられます。うまく動かないときは、どこがちがうのかを画面が教えてくれます。

## 商標と表記について

このアプリは、三菱電機・オムロン・ジェイテクト・シャープの各社が作っている機器やソフトの「書き方」をまねた練習ができます。各社の名前は、どの書き方のことかを示すためだけに使っていて、各社との提携や後援をあらわすものではありません。
```

```
cd apps/desktop && node scripts/build-manual.mjs
# 期待:
#   アプリ内ヘルプを書き出しました: …/src/renderer/help/manual-content.ts（2節）
#   図はまだありません（Plan 6 Task 12 が撮ります）
#   印刷用HTMLを書き出しました: …/resources/manual/manual.html
```

**注記（図がまだ無いあいだ）**: 生成物は**実在する図の読み込みだけ**を書く（`buildManual()` の第3引数 `availableImages`）。原稿が図を参照していても、その PNG がまだ無ければ `MANUAL_IMAGES` にはその名前で `{ small: '', full: '' }` が入る。こうしておくと、**Task 12 で図を撮るまで `pnpm build` も `pnpm -r test` も通り続ける**（利用者の決定「画像撮影は最後でよい」。決定表 P13）。図が揃ったら Task 12 が生成物を作り直し、読み込みが出そろう。引き出しは `src` が空の図を**描かない**（Task 8）。

- [x] **Step 6: 生成物を整形・検査・追跡の対象から外す**

`.prettierignore` の末尾に足す:

```
apps/desktop/src/renderer/help/manual-content.ts
```

`.gitignore` の末尾に足す:

```
apps/desktop/resources/manual/
```

`eslint.config.js` の `ignores` の配列に足す（既存の並びの末尾に1行）:

```js
    'apps/desktop/src/renderer/help/manual-content.ts',
```

`apps/desktop/electron.vite.config.ts` の `renderer` に、図を読むための別名と読み取り許可を足す（取扱説明書 設計 §7.2b）。既存の `@shared` の別名と `worker` / `build` は1文字も変えない。

```ts
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(import.meta.dirname, 'src/shared'),
        // 取扱説明書の図（生成物 `manual-content.ts` が読み込む）。取扱説明書 設計 §7.2b
        '@manual-images': resolve(import.meta.dirname, '../../docs/manual/images'),
      },
    },
    // `docs/` は `apps/desktop` の外にあるので、開発サーバに読んでよい根を明示する
    server: { fs: { allow: [resolve(import.meta.dirname, '../..')] } },
    worker: { format: 'es' },
    …
  },
```

TypeScript にも同じ別名を教える。`apps/desktop/tsconfig.json` の `compilerOptions` に足す:

```json
    "paths": { "@manual-images/*": ["../../docs/manual/images/*"] },
```

図の `*.png` を読み込める型は `vite/client`（`types` に入っている）が持っているので、宣言ファイルは要らない。

`apps/desktop/package.json` の `scripts` を直す（`dist` は Task 7 が直す）:

```json
    "dev": "node scripts/build-manual.mjs && node scripts/dev.mjs",
    "build": "node scripts/build-manual.mjs && node scripts/build.mjs",
```

- [x] **Step 7: テストを通す**

```
pnpm --filter @ojt/desktop test manual-
# 期待: Test Files 2 passed / Tests 22 passed（manual-build 16 ＋ manual-sync 6）
pnpm --filter @ojt/desktop typecheck && pnpm lint
# 期待: どちらも無警告
pnpm --filter @ojt/desktop build
# 期待: 変換が先に走ってから electron-vite のビルドが通る
```

- [x] **Step 8: commit**

```
git add apps/desktop/scripts/manual-build.mjs apps/desktop/scripts/manual-build.d.mts apps/desktop/scripts/build-manual.mjs apps/desktop/src/renderer/help/manual-content.ts apps/desktop/test/manual-build.test.ts apps/desktop/test/manual-sync.test.ts apps/desktop/package.json docs/manual/00-intro.md .prettierignore .gitignore eslint.config.js pnpm-lock.yaml
git diff --cached --stat
git commit -m "feat(desktop): build the in-app help and the printable manual from one markdown source (Plan 6 Task 2)"
git show --stat HEAD
```

---

## Task 3: 取扱説明書 前半6章（はじめに・導入・画面の見方・モードB・モードC1・モードC2）

**モデル: Sonnet-verbatim**（本書が全節の見出しと書き出しを実文で持ち、残りは機能一覧表と設計仕様の該当節から埋まる。判断は要らない）

**Files:**
- Modify: `docs/manual/00-intro.md`（Task 2 が2節だけ作った。4節にする）
- Create: `docs/manual/01-setup.md` / `02-screens.md` / `03-mode-b.md` / `04-mode-c1.md` / `05-mode-c2.md`
- Modify: `apps/desktop/src/renderer/help/manual-content.ts`（生成物。作り直すだけ）

本設計 §6.1・§6.2。**書き方の規則を必ず守ること**（Task 5 のテストが落とす）:

1. 入ったばかりの人に向けて、短く、やさしい日本語で書く。
2. **禁止語を書かない**（`store` / `zustand` / `IPC` / `Worker` / `props` / `React` / `TypeScript` / `Vitest` / `Playwright` / `testid` / `frameloop` / `asar` / `renderer` / `ネットリスト` / `コンポーネント` / `レンダラ` / `シリアライズ` / `バリデーション` / `パース` / `インスタンス`）。
3. 専門用語の**初出**は `**用語**（やさしい説明15文字以上）` の形で書く。対象は Task 5 の `terms.json` にある語。
4. ボタンや欄の名前は**画面に出ている文字そのまま**を `「判定」` のようにかぎ括弧で書く。`docs/manual/coverage.json` の `label` の値がその節に出ていなければテストが落ちる。
5. 手順は `1.` から始まる番号付きリストで、最初から最後まで通す。
6. 図は `![図の中身を説明する文](images/xxx.png)` を段落として1行で置く。画像は Task 12 が撮る（この時点ではファイルが無くてよい。存在検査は Task 12 が入れる）。

- [x] **Step 1: `00-intro.md` を4節にする**

Task 2 が書いた2節はそのまま残し、あいだに2節を足して**この順**にする。

```markdown
# はじめに

## このアプリでできること

（Task 2 が書いた段落をそのまま残す）

このあとに書くこと:
- 実際の盤とちがうところ（電気は本物ではなく計算で出しています／盤をこわす心配はありません）
- 何を練習できるかの箇条書き4つ（回路を組み立てる／部品を点検する／回路を点検して直す／PLCでプログラムを作る）
- `![ホームの画面。4つの練習が並んでいます。](images/home.png)`

## 4つの練習の選び方

はじめての人は「回路を組み立てる」から始めてください。押しボタンを押すとランプが点いたままになる **自己保持**（押しボタンから指を離しても、そのままの状態が続くつなぎ方）という回路が、電気の仕事のいちばん基本になります。

このあとに書くこと:
- 4つの練習を「どんな力がつくか」「どれくらい時間がかかるか」で並べた表（回路を組み立てる／部品を点検する／回路を点検して直す／PLCでプログラムを作る）
- 級（1級・2級・3級）で課題が分かれていること、3級がいちばんやさしいこと

## 画面の呼び名

この説明書では、画面の場所をいつも同じ言葉で呼びます。いちばん上に横に長く並んだボタンの列を「上の帯」、画面の右側にたてに並ぶ欄を「右の欄」、画面の下に出る細長い欄を「下の欄」と呼びます。

このあとに書くこと:
- 呼び名の表（上の帯／右の欄／下の欄／3Dの画面／手順の案内／状態の表示）
- `![練習中の画面。上の帯・3Dの画面・右の欄・下の欄の場所。](images/session-board.png)`

## 商標と表記について

（Task 2 が書いた段落をそのまま残す）

このあとに書くこと:
- `JA.settings.trademarkNotice` の文を**一字一句そのまま**引用する（Task 9 のテストが照合する）
- `JA.settings.assumptionNotice` の文も**一字一句そのまま**引用する
- 「各社のロゴや画面の写真はこのアプリに入っていません」の1文
```

- [x] **Step 2: `01-setup.md` を書く**

```markdown
# パソコンに入れる

## 動かすのに必要なもの

Windows 10 または Windows 11 の 64ビット版が動くパソコンなら使えます。特別な部品は要りません。画面は横 1280 点・たて 800 点より広ければ、全部の欄がきちんと並びます。

このあとに書くこと:
- 表（OS／画面の広さ／空き容量／インターネット＝不要）
- 3Dがなめらかに動かないときは画面を小さくすると軽くなること

## インストーラで入れる

配られたファイルのうち、名前が `.exe` で終わるほうがインストーラです。ダブルクリックすると入れ方をたずねる画面が出るので、案内にしたがって進めてください。管理者のパスワードは要りません。

このあとに書くこと:
- 番号付きの手順（1. ファイルをダブルクリック 2. 説明の画面を読んで「次へ」 3. 入れる場所を確かめる 4. 「インストール」 5. 終わったらデスクトップのアイコンから起動）
- 入れる場所を変えられること、デスクトップとスタートメニューにアイコンができること

## 持ち運び版を使う

名前が `.zip` で終わるほうが持ち運び版です。パソコンに入れずに使えるので、共用のパソコンや、インストールが許されていないパソコンで使えます。

このあとに書くこと:
- 番号付きの手順（1. `.zip` を右クリックして「すべて展開」 2. 出てきたフォルダを開く 3. `電気教育ツール.exe` をダブルクリック）
- USBメモリに入れて持ち歩けること
- 設定と一時保存はパソコンの利用者フォルダに残るので、別のパソコンでは引き継がれないこと

## 初回に出る青い画面

はじめて起動すると「Windows によって PC が保護されました」という青い画面が出ることがあります。これはこのアプリに署名が付いていないためで、こわれているという意味ではありません。

このあとに書くこと:
- 番号付きの手順（1. 「詳細情報」を押す 2. 下に出る「実行」を押す）
- 2回目からは出ないこと

## インターネットにつながなくても使えます

このアプリは、起動するときも使っているときも、インターネットに一切つなぎません。工場の中のネットワークにつながっていないパソコンでも、そのまま全部の機能が使えます。

このあとに書くこと:
- 自動更新が無いこと、新しい版は新しいインストーラで入れ替えること

## 消すとき

このあとに書くこと:
- インストーラで入れた場合: Windows の「アプリと機能」から消す
- 持ち運び版: フォルダごと削除する
- 設定と一時保存の置き場所（`%APPDATA%\電気教育ツール`）と、消したいときはそのフォルダも消すこと
```

- [x] **Step 3: `02-screens.md` を書く**

```markdown
# 画面の見方

## ホームの画面

アプリを起動すると最初に出るのがホームの画面です。まん中に4つの大きなカードが並んでいて、どの練習をするかをここで選びます。右上の「設定」で、音や自分で作った課題の読み込みを変えられます。

このあとに書くこと:
- カード4枚の名前と説明（`JA.home.*` の文言そのまま）
- 「最近の課題」の欄（前に開いた課題をすぐ開ける）
- 右上の「ヘルプ」ボタン（いつでも `F1` でも開けること）
- `![ホームの画面。4つの練習が並んでいます。](images/home.png)`

## 課題をえらぶ

カードを押すと、その練習の課題が表に並びます。表には題名・級・だいたいの時間が出ます。行を押すとその課題が始まります。

このあとに書くこと:
- 「もどる」ボタン、級で絞り込む欄、練習の種類で絞り込む欄
- 自分で作った課題は「利用者」と出ること
- 読めなかった課題ファイルがあると、その理由が下に出ること
- `![課題一覧。題名・級・目安の時間が並んでいます。](images/list.png)`

## 練習中の画面の並び

課題が始まると、画面は4つに分かれます。いちばん上が「上の帯」、そのすぐ下に「次に何をすればよいか」を1行で出す案内、まん中の広いところが3Dの画面、右が部品や道具の欄、下がタイムチャートなどの欄です。

このあとに書くこと:
- 4つの場所の表と、モードごとに右の欄の中身が変わること
- 左上に出る「いま何本つないだか」の表示
- `![モードBの練習中の画面。](images/session-board.png)`

## 画面の上の帯

上の帯には、いまの課題ですぐ使うボタンだけが並びます。左端の「もどる」で課題一覧へ帰れます。右端の「判定」で、組んだ回路が正しいかどうかを見てもらえます。「ヘルプ」はこの説明書を画面の右から開きます。`F1` を押しても同じように開き、もう一度押すと閉じます。`Esc` を押すと、開いている窓を閉じたり、つなぎかけの電線をやめたりできます。`Tab` を押していくと、マウスを使わなくても順番に操作先が移ります。

このあとに書くこと:
- 上の帯のボタンを左から順に説明する表（`coverage.json` の `panels/Toolbar.tsx` の行を全部）
- 「⋯」を押すと出るもの（視点の切り替え・保存・読み込み・回路図の表示）
- 押せないボタンにマウスを乗せると、押せない理由が出ること

## 3Dの見かたと動かしかた

まん中の3Dの画面では、練習盤を好きな向きから見られます。左ボタンでドラッグすると盤が回り、右ボタンでドラッグすると盤が平行に動き、ホイールを回すと近づいたり遠ざかったりします。左上にある立方体（ビューキューブ）をドラッグすると、指についてくるように盤が回ります。ビューキューブの面をクリックするとその向きから、辺や角をクリックするとななめから見られます。立方体の下にある赤・緑・青の玉（XYZの玉）をクリックすると、その軸の向きから見られます。立方体の左の丸ボタンは盤ぜんたいが見える位置へ戻し、右の丸ボタンは傾きだけをまっすぐに戻します。キーボードでは `1` で正面から、`2` で上から、`3` でソケットを大きく、`Home` で盤ぜんたいを見られます。テンキーの `1`・`3`・`7` でも正面・右・上から見られ、`Ctrl` を足すと反対側から見られます。

このあとに書くこと:
- 操作の表（マウス／ビューキューブ／キー）を `coverage.json` の `gestures` と `keys` の行から作る
- 盤の裏側や真下には回り込めないこと（そういう作りにしてあること）
- `![ビューキューブと2つの丸ボタン。](images/view-cube.png)`

## 端子にさわると出る札

ねじ端子にマウスを乗せると、その端子の名前と役割が小さな札で出ます。札には「CR1 の ⑨（COM）」のように、どの部品のどの番号で、何のための端子かが書いてあります。

このあとに書くこと:
- 端子の番号と役割の読み方（①〜④がb接点、⑤〜⑧がa接点、⑨〜⑫がCOM、⑬が「−」、⑭が「+」）
- **a接点**（ふだんは切れていて、動くとつながる接点）と **b接点**（ふだんつながっていて、動くと切れる接点）を初出の形で説明する
- もとからつないである電線は外せないこと（マウスを乗せると「既設配線（削除不可）」と出る）
- `![端子にマウスを乗せたときの札。](images/session-terminal.png)`

## 部品を入れかえる

ソケットをクリックすると、そのソケットのカードが出ます。カードから部品をのせたり、外したり、別の部品と入れかえたりできます。

このあとに書くこと:
- カードのボタン（のせる／外す／入れかえる／やめる）を `coverage.json` の `panels/PartsPanel.tsx` の行から
- リレーとタイマのちがい
- `![ソケットのカード。のせる・外す・入れかえるが並びます。](images/socket-card.png)`

## 結果の画面

「判定」を押すと結果の画面に変わります。いちばん上に合格か不合格かが大きく出て、その下に、思ったとおりに動いたかどうかの比べ方、自動で見つかった間違い、あぶない操作をした回数、かかった時間が並びます。

このあとに書くこと:
- 欄ごとの読み方（食い違いの表／自動で見つかった間違い／あぶない操作／かかった時間）
- 不合格のときに出る「あやしい電線」の欄と「盤で見る」ボタン、接点の組がちがうだけでもここに出るという断り
- 「もう一度」「課題一覧へ」のボタン
- `![結果の画面。合格と出ています。](images/judge-result.png)`

## タイムチャートの読み方

下の欄には **タイムチャート**（どの信号がいつオンになったかを横に並べた図）が出ます。左に信号の名前、右に時間が流れていき、色が濃くなっているところがオンになっている時間です。

このあとに書くこと:
- 図を押すと大きく出ること、大きくした図では縦の線でどの時刻かを合わせられること
- 判定のあとは、お手本の波形と自分の波形が重なって出ること
- `![タイムチャートを大きく出したところ。](images/timechart.png)`
```

- [x] **Step 4: `03-mode-b.md` を書く**

```markdown
# 回路を組み立てる（モードB）

## このモードでやること

課題の文を読んで、そのとおりに動く回路を練習盤の上に作ります。部品をのせて、電線をつないで、電気を流して、押しボタンを押して、思ったとおりに動いたら「判定」を押します。

このあとに書くこと:
- 進め方の全体像（番号付き6段階）と、上の帯のすぐ下に出る案内がこの順番を1行ずつ教えてくれること
- 級による違い（3級は回路図が最初から見える、2級は回路図を開いた回数が結果に出る、1級は回路図が出ない）

## 回路を組み立てる

1. 課題の文を読みます。画面の右の欄のいちばん上に出ています。
2. 使う部品をソケットにのせます。
3. 電線をつなぎます。
4. 「ブレーカ」と「電源スイッチ」を順番に入れて電気を流します。
5. 押しボタンを押して、思ったとおりに動くか見ます。
6. 上の帯の右端の「判定」を押します。

このあとに書くこと:
- 各段階を、この章のあとの節のどこで詳しく説明しているかの対応
- `![モードBの練習中の画面。](images/session-board.png)`

## 電線をつなぐ・外す

電線は、つなぎたい端子を1つクリックしてから、もう1つの端子をクリックするとつながります。やめたいときは `Esc` を押します。外すときは、上の帯の「削除」を押してから電線をクリックし、`Delete` を押します。

このあとに書くこと:
- 電線の色の選び方（上の帯の色ボタン）と、色には決まりがあること
- 1つの端子には電線を2本までしか差せないこと。3本目は差せず、あぶない操作として数えられること
- **母線**（電源の＋と−から全部の部品へ電気を配るおおもとの線）は、端子から端子へ渡してつないでいくこと
- 「ひとつ前に戻す」「やり直す」が上の帯にあること
- マウスを使わずに、右の欄の端子の一覧から `Tab` と `Enter` だけでもつなげること

## 部品をのせる

ソケットをクリックするとカードが出るので、のせたい部品を選びます。課題で決まっている役割（CR1、T1 など）はソケットの上に書いてあります。

このあとに書くこと:
- リレー（**コイル**＝電気を流すと磁石になって接点を動かす部品）とタイマのちがいを初出の形で
- のせられる数が課題で決まっていること
- `![ソケットのカード。](images/socket-card.png)`

## タイマの時間を決める

タイマをのせると、つまみが出ます。つまみをドラッグすると時間が変わります。数字の欄に打ち込んでも決められます。

このあとに書くこと:
- 設定できる範囲（0〜10秒は0.1秒きざみ、0〜60秒は0.5秒きざみ）
- 決めた時間は結果の画面でも確かめられること

## 電気を流す

右の欄の「ブレーカ」を入れてから「電源スイッチ」を入れます。この順番が大切で、逆にするとあぶない操作として数えられます。

このあとに書くこと:
- 切るときは逆の順番（電源スイッチ → ブレーカ）
- つないでいる途中で電気を流したままにしないこと
- 短絡（ショート）したまま電気を流すと警告の帯が出ること

## 押しボタンを押す

3Dの画面の押しボタンをクリックすると押せます。押している間だけオンになり、マウスのボタンを離すと戻ります。

このあとに書くこと:
- 黒（PB1）・黄（PB2）・緑（PB3）・赤（PB4）の役割
- ランプが点いたか、リレーが動いたかは3Dの画面と下の欄のタイムチャートの両方で見られること

## 「判定」を押す

上の帯の右端の「判定」を押すと、課題が決めた順番で押しボタンが自動で押され、お手本の回路と同じ動きになったかどうかが比べられます。

このあとに書くこと:
- 合格の条件（動きが同じ ＋ 自動で見つかる間違いが無いこと）
- 判定には数秒かかること、その間はボタンが押せないこと
- 結果の画面の読み方は「画面の見方」の章にあること

## うまくいかないとき

このあとに書くこと:
- よくある間違いの表（電線が1本足りない／b接点とa接点を取り違えた／コイルの向き（＋と−）が逆／1つの端子に3本差そうとした／電源を入れる順番が逆）
- 結果の「あやしい電線」から「盤で見る」を押すと、その端子が3Dの画面で光ること
```

- [x] **Step 5: `04-mode-c1.md` を書く**

```markdown
# 部品を点検する（モードC1）

## このモードでやること

トレイに並んだリレーとタイマの中から、こわれているものを見つけて、どうこわれているかを答えます。見た目では分からないので、実際に動かして、テスターで測って調べます。

このあとに書くこと:
- こわれ方が7種類あること（正常を含む）の一覧
- 「動かしてみるだけでは見つからないこわれ方がある」ことを先に伝える

## 部品を点検する

1. トレイから部品を1つ選び、「チェック用ソケット」に差します。
2. 赤い押しボタン（PB4）を押して、部品が動くか（カチッと **励磁**（電気を流して磁石にすること）するか）を見ます。
3. テスターで接点がつながるかを測ります。
4. 赤い押しボタンから指を離して、コイルの抵抗を測ります。
5. 部品を外して、次の部品へ進みます。

このあとに書くこと:
- チェック用ソケットの場所と、どの端子を測るか（コイルは ⑬–⑭、a接点は ⑨–⑤ など）
- 全部の部品について、最後の「コイルの抵抗を測る」まで必ずやること
- `![チェック用ソケットとテスター。](images/c1-tester.png)`

## テスターの使い方

右の欄にテスターがあります。つまみで測り方（電圧・抵抗・導通）を選び、赤と黒の棒を測りたい端子に当てると、数字が出ます。

このあとに書くこと:
- デジタルとアナログの切り替え、レンジの選び方、自動レンジ
- 0オーム調整のやり方と、抵抗を測る前に必ずやること
- キーだけで操作する方法（`b` と `r` で棒を進める、`0` で0オーム調整、`Esc` で棒を離す）
- 電気が流れているところに抵抗のレンジを当てるとあぶない操作になること
- `![テスターの欄。](images/c1-tester.png)`

## 不良の見分け方

測った結果とこわれ方の対応は次の表のとおりです。この表は画面の中でも「判定表（切り分けの手順）」として開けます。

このあとに書くこと:
- `@ojt/content` の `DIAGNOSIS_TABLE` の**7行をそのまま**表にする（Task 9 のテストが1行ずつ照合する）
- **レアショート**（コイルの中で電線どうしが少しだけ触れてしまい、抵抗が下がったこわれ方）を初出の形で説明し、動きも接点もふつうに見えるので抵抗を測らないと見つからないことを強調する
- **溶着**（接点がくっついたまま離れなくなったこわれ方）と **コイル断線**（コイルの中の電線が切れてしまったこわれ方）も初出の形で

## 答えを書き込む

右の欄のマークシートに、部品ごとに1つだけ丸を付けます。正常だと思ったら「正常」を選びます。

このあとに書くこと:
- 選べる7つの名前
- いくつ答えたかが上に出ること
- 全部答えなくても「判定」は押せるが、答えていないものは不正解になること
- `![マークシート。部品ごとに1つ選びます。](images/c1-marksheet.png)`

## 「判定」を押す

全部の部品に答えを付けたら「判定」を押します。結果の画面に、部品ごとの正解・不正解と、何問正解だったかが出ます。

このあとに書くこと:
- 部分正解が「n/m 正解」と出ること
- 実際に測れた値も結果に並ぶので、どこで取り違えたかを見直せること
```

- [x] **Step 6: `05-mode-c2.md` を書く**

```markdown
# 回路を点検して直す（モードC2）

## このモードでやること

できあがった回路のどこかに、わざと間違いが入れてあります。思ったとおりに動かない理由を探して、見つけたところを書き出し、正しくつなぎ直します。

このあとに書くこと:
- 間違いは電線のつなぎ間違い・部品のこわれ・接触不良の3種類あること
- 内蔵の課題はふつう2か所こわれていること

## 回路を点検して直す

1. 課題の文と回路図を読んで、どう動くはずかをつかみます。
2. 電気を流して、実際の動きを見ます。
3. 思ったとおりに動かないところから、あやしいところをしぼります。
4. テスターで測って確かめます。
5. 見つけたところを「指摘」として書き出します。
6. 白い電線でつなぎ直す、または部品を良品と取りかえます。
7. 「判定」を押します。

このあとに書くこと:
- 上の帯のすぐ下の案内がこの順番を1行ずつ出すこと
- `![モードC2の指摘の欄と光っている端子。](images/c2-repair.png)`

## 回路図と盤を行き来する

画面には回路図も出せます。回路図の記号をクリックすると、盤の対応する端子が光ります。逆に、盤の端子にマウスを乗せると、回路図のどの記号かが光ります。

このあとに書くこと:
- 回路図の出し方（上の帯の「⋯」から）
- 2級の課題では回路図を開いた回数が結果に出ること

## あやしい電線の見つけ方

このあとに書くこと:
- ランプがうすく点いている（暗点灯）ときは、どこかで接触が悪くなっていること
- 動くはずのリレーが動かないときは、コイルまで電気が来ているかを電圧で測ること
- 測る手順の番号付きリスト
- 電気が流れているところに抵抗のレンジを当ててはいけないこと

## 見つけたところを書き出す

上の帯の「指摘」を押してから、あやしい電線・部品・端子をクリックすると、何がおかしいかを選ぶ小さな窓が出ます。選ぶと右の欄の一覧に積まれます。

このあとに書くこと:
- 選べる種類（`JA.reportKind.*` の4つ）
- 一覧から消す方法
- 指摘した数が上に出ること

## 直す

つなぎ間違いは、白い電線でつなぎ直します。こわれた部品は、ソケットのカードから良品と取りかえます。

このあとに書くこと:
- 直した内容が右の欄に「足した電線」「外した電線」「取りかえた部品」として残ること
- もとからつないである電線は外せないこと

## 「判定」を押す

指摘と修理が終わったら「判定」を押します。指摘したところが合っているか、直したあとに思ったとおり動くかの両方が見られます。

このあとに書くこと:
- 合格の条件（全部の間違いを指摘し、直したあとの動きがお手本と同じ）
- 結果の画面に出る「当たった指摘」「見落とし」「余分な指摘」の読み方
```

- [x] **Step 7: 生成物を作り直してテストを通す**

```
cd apps/desktop && node scripts/build-manual.mjs
# 期待: アプリ内ヘルプを書き出しました: …（38節）
pnpm --filter @ojt/desktop test manual-
# 期待: Test Files 2 passed / Tests 22 passed
```

- [x] **Step 8: commit**

```
git add docs/manual/00-intro.md docs/manual/01-setup.md docs/manual/02-screens.md docs/manual/03-mode-b.md docs/manual/04-mode-c1.md docs/manual/05-mode-c2.md apps/desktop/src/renderer/help/manual-content.ts
git diff --cached --stat
git commit -m "docs(manual): explain getting started, the screens and modes B, C1 and C2 in plain Japanese (Plan 6 Task 3)"
git show --stat HEAD
```

---

## Task 4: 取扱説明書 後半7章（モードD・回路図・作業ファイル・設定・指導者向け・用語集・困ったときは）

**モデル: Sonnet-verbatim**（Task 3 と同じ。見出しと書き出しは本書が持つ）

**Files:**
- Create: `docs/manual/06-mode-d.md` / `07-schematic.md` / `08-workfile.md` / `09-settings.md` / `10-authoring.md` / `11-glossary.md` / `12-troubleshooting.md`
- Modify: `apps/desktop/src/renderer/help/manual-content.ts`（生成物）

Task 3 と同じ書き方の規則に従う。**`10-authoring.md` だけ**は `JSON` と課題ファイルの項目名を書いてよい（本設計 §6.2 の規則3）。

- [x] **Step 1: `06-mode-d.md` を書く**

```markdown
# PLCでプログラムを作る（モードD）

## このモードでやること

机の上に置いた PLC（プログラムで動く小さな制御装置）に **ラダー図**（電気の回路図に似た形で書くプログラム）を書き、盤の押しボタンやランプとつないで、思ったとおりに動くようにします。

このあとに書くこと:
- 使えるメーカーが4つあること（三菱・オムロン・ジェイテクト・シャープ）と、画面の見た目と操作の言葉がメーカーごとに変わること
- 有接点の回路（モードB）とのちがい

## PLCの課題を進める

1. 課題の文を読みます。
2. 画面の左半分でラダー図を書きます。
3. 盤の押しボタンを PLC の入力へ、PLC の出力をリレーへ、3Dの画面でつなぎます。
4. PLC の電源をかべのコンセントからとります。
5. 「変換」を押します（メーカーによっては要りません）。
6. 「書込み」を押して PLC に入れます。
7. 「モニタ開始」で動きを見ます。
8. 「判定」を押します。

このあとに書くこと:
- 上の帯のすぐ下に出る案内がこの8段階を1つずつ教えてくれること
- 表示を「ラダーだけ」「並べて」「盤だけ」に切り替えられること
- `![モードDのラダー編集。](images/plc-ladder.png)`

## ラダー図を描く

左半分の格子の上で、矢印キーで書き込む場所を動かし、キーで記号を置きます。置いた記号には、どのスイッチやランプかを表す名前（デバイス）を打ち込みます。

このあとに書くこと:
- 置ける記号（a接点・b接点・コイル・横線・縦線）
- 名前の打ち込み方と、まちがった名前を打つと理由が出ること
- 名前に説明を付けられること（デバイスコメント）
- 段を足す・消す、行を足す・消す

## キーの割り当て

キーの割り当てはメーカーごとにちがいます。いま選んでいるメーカーの割り当ては、画面の右の「キー割当」の欄にいつも出ています。三菱の書き方では `F5` で a接点、`F7` でコイル、`F4` で変換、`F3` で動きを見る、`F1` でこの説明書が開きます。

このあとに書くこと:
- 4メーカーの表を `DialectProfile.shortcuts` の `keys` と `label` から**そのまま**作る（Task 9 のテストが全組を照合する）
- ◎（確かめた割り当て）と △（このアプリで決めた割り当て）の印の意味

## 入出力の割り付け

右の欄に、どの押しボタンが PLC のどの入力になり、どのランプがどの出力になるかの表が出ます。課題によっては決まっていて変えられません。

このあとに書くこと:
- 表の読み方と、決まっている課題・自由な課題のちがい
- コモン端子のこと

## 変換する

三菱とシャープの書き方では、書いたラダー図をそのままでは PLC に入れられません。「変換」を押して、まちがいが無いかを調べてもらいます。まちがいがあると、下の欄に場所と理由が出ます。

このあとに書くこと:
- オムロンとジェイテクトの書き方では「変換」が要らないこと（ボタンも出ないこと）
- 下の欄に出るまちがいの読み方（どの回路の何行目何列目か）
- 自動で変換する設定のこと

## PLCに書き込む

「書込み」を押すと、変換したプログラムが机の上の PLC に入ります。入ったら「運転」にして動かします。

このあとに書くこと:
- ボタンの名前がメーカーごとにちがうこと（`profile.panels.toolbar` の表）
- 書き込む前に盤の配線を終えておくこと

## 動きを見る

「モニタ開始」を押すと、いま電気が通っているところに色が付きます。色はメーカーごとにちがい、設定で変えられます。

このあとに書くこと:
- 右の欄に出る値の一覧（入力・出力・内部・タイマ・カウンタ）
- スキャンの時間が出ること
- `![モニタ中のラダー図。](images/plc-monitor.png)`

## 別のメーカーの書き方に変える

上の帯の「表記切替」を押すと、いま書いたプログラムを別のメーカーの書き方で表示できます。プログラムそのものは書き換わりません。

このあとに書くこと:
- 切り替えると名前がどう変わるかの例（`X0` が `0.00` になるなど）
- 切り替えられないものがあるときは、その一覧が先に出ること
- `![表記切替の窓。](images/plc-notation.png)`

## 命令の一覧を書き出す

書いたラダー図を、文字で並べた一覧（命令語リスト）として保存できます。下の欄の「命令語リスト書き出し」を押すと、保存する場所を選ぶ窓が出ます。

このあとに書くこと:
- どんな形で出るか（1行1命令）
- 印刷に使えること

## 機種を変える

設定でメーカーを変えると、机の上の PLC の見た目と端子の並びも変わります。ラックの形の機種では、電源・CPU・入出力のモジュールが並びます。

このあとに書くこと:
- 4メーカーの機種名と見た目のちがい
- 端子の名前が機種で変わるので、配線もやり直しになること
```

- [x] **Step 2: `07-schematic.md` を書く**

```markdown
# 回路図を描いて確かめる

## この機能でやること

盤に電線をつなぐ前に、机の上で回路図を描いて、その回路が正しいかどうかを確かめられます。実際につなぐ前に間違いに気づけるので、やり直しが減ります。

このあとに書くこと:
- モードBの練習中に使えること、`F2` で「盤」「並べて」「回路図」を切り替えられること
- 描いた図は作業ファイルに一緒に残ること

## 回路図を描く

左に電源の＋、右に電源の−があり、そのあいだに横向きの段を並べていきます。矢印キーで置く場所を動かし、左のパレットから置きたい記号を選んで `Enter` を押すと置けます。`Delete` で消し、`Insert` で段を1本ふやし、`Ctrl+Z` でひとつ前に戻し、`Ctrl+Y` でやり直せます。

このあとに書くこと:
- パレットに出る記号（押しボタンのa接点・b接点、リレーのa接点・b接点、タイマのa接点・b接点、コイル、ランプ、ブザー）
- 盤に無い部品はパレットに出ないこと
- 描いている途中のまま置いておけること、足りないところは下に指摘として出続けること
- `![回路図エディタと検算の結果。](images/schematic-editor.png)`

## 分岐を作る

自己保持の回路のように、段のとちゅうから枝分かれさせたいときは「分岐にする」を押します。押したあと、枝の始まりと終わりを順にクリックします。やめたいときは `Esc` を押します。

このあとに書くこと:
- 押せないときは理由が出ること（その段に負荷がある／段が1本しかない）
- キーだけでも分岐が作れること

## 設定時間を決める

タイマの接点を置くと、その下に時間の欄が出ます。上下のボタンか数字の打ち込みで時間を決めます。

このあとに書くこと:
- 決めた時間が検算にも使われること

## 「検算」で確かめる

「検算」を押すと、描いた回路図をそのまま盤につないだものとみなして、課題の順番で押しボタンを押したときの動きを確かめます。合格・不合格は「判定」と同じ基準です。

このあとに書くこと:
- 「机の上の確認です。盤の配線は別に判定します」という断りが出ること
- 押せないときは理由が出ること（まだ指摘が残っている／検算の最中）
- 結果に食い違いの表と波形が出ること

## 図のとおりに盤へつなぐ

回路図の記号をクリックすると、盤のどの端子につなげばよいかが3Dの画面で光ります。光ったところを順につないでいけば、図のとおりの回路ができます。

このあとに書くこと:
- 自動ではつながないこと（つなぐ練習そのものが大事なため）
- 逆に、盤の端子にマウスを乗せると回路図のどの記号かが光ること
- `![回路図の記号をクリックして盤の端子が光ったところ。](images/schematic-editor.png)`
```

- [x] **Step 3: `08-workfile.md` を書く**

```markdown
# 作業を保存する・続きからやる

## 作業ファイルに保存する

とちゅうでやめたいときは、上の帯の「⋯」から「作業を保存」を選びます。保存する場所と名前をたずねる窓が出るので、好きなところに保存してください。

このあとに書くこと:
- 保存されるもの（のせた部品・つないだ電線・タイマの時間・ラダー図・回路図の下書き・テスターの状態・かかった時間・あぶない操作の回数）
- ファイルの拡張子が `.ojtw` であること

## 保存した作業を読み込む

「⋯」から「作業を読み込み」を選び、保存したファイルを選びます。いま開いている課題がある場合は、捨ててよいかを先にたずねます。

このあとに書くこと:
- 読めないファイルのときに出るメッセージと、そのときどうすればよいか
- 古い版で保存したファイルも読めること

## 前回の作業を復元する

アプリは30秒ごとに、いまの作業をこっそり控えています。前に閉じたときの作業が残っていると、次に起動したときに「前回の作業を復元しますか？」とたずねます。

このあとに書くこと:
- たずねる画面に出る内容（いつの作業か・どの練習か・どの課題か・どれくらい進んでいたか）
- 「復元しない」を選ぶと控えが消えること
- 設定でこのたずねを出さなくできること
```

- [x] **Step 4: `09-settings.md` を書く**

```markdown
# 設定

## 設定の画面

ホームの右上の「設定」から開きます。変えた内容はすぐに保存され、次に起動したときも残ります。

このあとに書くこと:
- 設定の行を全部並べた表（`coverage.json` の `screens/Settings.tsx` の行から）
- 各行の下に出ている説明文を**一字一句そのまま**引用する（`JA.settings.userContentHelp` / `vendorHelp` / `gridColsHelp` / `monitorColorHelp`。Task 9 のテストが照合する）
- `![設定の画面。](images/settings.png)`

## 自分で作った課題を読み込む

「利用者課題フォルダ」に場所を入れておくと、そのフォルダの中の課題ファイルが課題一覧に並びます。内蔵の課題と一緒に出て、「利用者」という印が付きます。

このあとに書くこと:
- 何も入れないときの既定の場所
- フォルダが無いときに出る知らせ
- 課題の作り方は「指導者向け」の章にあること

## 音

リレーが動く音、テスターのブザー、警告の音が鳴ります。音を止めたいときや、大きさを変えたいときはここで変えます。

このあとに書くこと:
- 音は合成音で、音のファイルは入っていないこと

## PLCの既定のメーカー

PLCの課題を開くときに、最初に選ばれているメーカーを決めます。開いたあとでも表記切替で変えられます。

このあとに書くこと:
- 4メーカーの名前
- 「一部の命令名・キー割当は実機マニュアル未確認のため本アプリの表記です」という断りが画面に出ていること

## ラダーの見た目

ラダー図の横に並ぶ列の数と、動きを見ているときに電気が通っているところに付く色を変えられます。どちらも「メーカーの既定に従う」にしておけば、選んだメーカーらしい見た目になります。

このあとに書くこと:
- 列の数は8〜15のあいだ
- 「既定に戻す」ボタン
```

- [x] **Step 5: `10-authoring.md` を書く**

```markdown
# 指導者向け: 課題の作り方と配り方

## 課題ファイルの置き場所

課題は1題につき1つのファイルです。設定の「利用者課題フォルダ」に指定したフォルダの下に、練習の種類ごとのフォルダ（`assemble` / `inspect-parts` / `inspect-repair` / `plc`）を作り、その中に置きます。

このあとに書くこと:
- 既定の置き場所（`%APPDATA%\電気教育ツール\content`）
- ファイル名は自由だが、拡張子は `.json` にすること
- 置いたら課題一覧を開き直すと読み込まれること

## 課題ファイルの中身

課題ファイルは JSON という形式のテキストです。メモ帳でも書けますが、かっこの対応を間違えやすいので、対応を色で見せてくれる編集ソフトを使うと楽です。

このあとに書くこと:
- 共通の項目の表（`formatVersion` / `id` / `mode` / `title` / `grade` / `description` / `timeLimit` / `board` / `inventory` / `schematic` / `operations` / `durationMs` / `judge` / `hints`）を、設計仕様 §7.1 と `packages/content/src/schema/` の内容どおりに書く
- 間違っていると課題一覧の下に理由が日本語で出ること

## モードBの課題を1つ作ってみる

次の内容をそのまま保存すると、自己保持回路の課題ができます。内蔵の `b-001` と同じ内容です。

このあとに書くこと:
- `packages/content/src/builtin/assemble/b-001-self-hold.json` の中身を**そのまま**コード欄に載せる
- 各項目が何を意味するかを、上から順に短く説明する
- お手本の回路図（`schematic`）を書くと、それが正解の基準になり、回路図ヒントにもなること
- `operations` が「判定のときに自動で押す順番」であること

## ほかのモードの課題

このあとに書くこと:
- 部品点検（`inspect-parts`）: トレイに並べる部品と、それぞれの本当のこわれ方（`truth`）を書くこと。タイマにレアショートは指定できないこと
- 回路点検・修復（`inspect-repair`）: どこをどうこわすか（`faults`）を並べるか、数だけ決めて毎回変えるか
- PLC（`plc`）: メーカーと機種、入出力の割り付け、お手本のラダー図
- どのモードでも `packages/content/src/builtin/` の中に手本があること

## 採点のしくみ

合格になるのは、お手本と同じ動きになっていて、なおかつ自動で見つかる間違いが1つも無いときです。かかった時間とあぶない操作の回数は、点数には入れず、参考として出します。

このあとに書くこと:
- 自動で見つかる間違いの一覧（`JA.staticCheck.*` の9つ）と、課題ごとに入り切りできること
- 時間のずれをどこまで許すか（`tolerance`）
- 部分点は出ないこと（部品点検だけ「n/m 正解」が出ること）

## 配り方と更新のしかた

このあとに書くこと:
- 課題ファイルだけを配ればよいこと（アプリを入れ直す必要はないこと）
- 共有フォルダを「利用者課題フォルダ」に指定すれば、全員に同じ課題が配れること
- アプリそのものの更新は新しいインストーラで入れ替えること（自動更新はありません）
```

- [x] **Step 6: `11-glossary.md` を書く**

```markdown
# 用語集

## この章の使い方

この説明書では、電気の仕事でよく使う言葉をできるだけやさしい言い方に直して書いています。それでも出てくる言葉は、はじめて出てきたところで短く説明し、この章にまとめてあります。分からない言葉が出てきたら、ここを見てください。

このあとに書くこと:
- ヘルプの検索欄に言葉を入れると、その言葉が出てくる節へ跳べること

## 用語集

このあとに書くこと:
- `| 言葉 | やさしい言い方 | 説明 |` の3列の表
- `docs/manual/terms.json` に並べた語を**もれなく**載せる。説明は20文字以上
- 五十音順に並べる
```

- [x] **Step 7: `12-troubleshooting.md` を書く**

```markdown
# 困ったときは

## こう表示されたら

画面に出た言葉をそのまま探してください。左の列がアプリの出す言葉、右の列がそのときにすることです。

このあとに書くこと:
- `| 画面に出る言葉 | こうしてください |` の2列の表
- `docs/manual/coverage.json` の `messages` に並べたキーの**文言そのもの**をもれなく左の列に書く（Task 5 のテストが照合する）
- 文言が引数で変わるもの（`gridColsHelp(cols)` のような関数）は、変わらない部分をそのまま書く

## 画面が真っ黒になった

いちばん上に赤い帯が出て、その中に理由が書かれていることがあります。帯の「セッションをリセット」を押すと、いまの課題を作り直して続けられます。それでも直らないときは「課題一覧へ」を押してください。

このあとに書くこと:
- 作業が消えてしまう場合と残る場合
- 前もってこまめに保存しておくとよいこと

## 3Dが出なくなった

「WebGL」という3Dのしくみがパソコン側で止まると、盤が描けなくなります。アプリを閉じてもう一度起動してください。

このあとに書くこと:
- ほかの重いソフトを閉じてから起動すると直りやすいこと
- 画面のサイズを小さくすると軽くなること

## 作業ファイルが読めない

保存したファイルが壊れていたり、新しい版で保存したファイルを古い版で開こうとしたりすると読めません。理由が画面に出ます。

このあとに書くこと:
- 読めないファイルは上書きされないので、別のパソコンで開き直せること
- 一時保存（自動で残る控え）は1つだけで、古いものは残らないこと

## 説明書（PDF）が開かない

「説明書（PDF）が見つかりません。この画面の目次から同じ内容を読めます。」と出たときは、同じ内容をこの画面の目次から読めます。

このあとに書くこと:
- PDF を見る道具が入っていないパソコンでは開けないこと
- PDF は入れたフォルダの `resources` の中にあるので、そこから直接開いてもよいこと

## 命令名やキーの割り当てについてのお断り

PLC の一部の命令の名前とキーの割り当ては、実際の機器の説明書を確かめられていないため、このアプリで決めた書き方です。実機とちがう場合があります。

このあとに書くこと:
- `JA.settings.assumptionNotice` の文を**一字一句そのまま**引用する
- 設定の「このアプリについて」にも同じ断りがあること
- ちがいが分かったときは、その機種の設定だけを直せばよい作りになっていること
```

- [x] **Step 8: 生成物を作り直してテストを通す**

```
cd apps/desktop && node scripts/build-manual.mjs
# 期待: アプリ内ヘルプを書き出しました: …（78節）
pnpm --filter @ojt/desktop test manual-
# 期待: Test Files 2 passed / Tests 22 passed
```

- [x] **Step 9: commit**

```
git add docs/manual/06-mode-d.md docs/manual/07-schematic.md docs/manual/08-workfile.md docs/manual/09-settings.md docs/manual/10-authoring.md docs/manual/11-glossary.md docs/manual/12-troubleshooting.md apps/desktop/src/renderer/help/manual-content.ts
git diff --cached --stat
git commit -m "docs(manual): explain mode D, the schematic editor, saving, settings, authoring and troubleshooting (Plan 6 Task 4)"
git show --stat HEAD
```

---

## Task 5: 文体・用語・機能網羅の検査

**モデル: Opus**（「専門用語を使わない」「全機能を説明した」を機械で数えられる形に落とす設計。誤検知と見逃しの線引き）

**Files:**
- Create: `docs/manual/style.json`
- Create: `docs/manual/terms.json`
- Create: `docs/manual/shots.json`（図の**意味**。場所は Task 12。決定表 P14）
- Test: `apps/desktop/test/manual-style.test.ts`（新規）
- Test: `apps/desktop/test/manual-coverage.test.ts`（新規）
- Test: `apps/desktop/test/manual-shots.test.ts`（新規。**画像そのものは見ない**）
- Modify: `docs/manual/*.md`（テストが落ちた箇所の直しと、吹き出しの番号への言い換え）
- Modify: `docs/manual/coverage.json`（`messages` の埋め）

本設計 決定表#21〜#23、§6.2・§6.3。**利用者要求「すべての機能を使用者目線で専門用語なく詳細に解説すること」を機械で保証するタスク。**

- [x] **Step 1: 禁止語と専門用語の一覧を作る**

`docs/manual/style.json`:

```json
{
  "banned": [
    "store",
    "zustand",
    "IPC",
    "Worker",
    "props",
    "React",
    "TypeScript",
    "Vitest",
    "Playwright",
    "testid",
    "frameloop",
    "asar",
    "renderer",
    "JSON",
    "ネットリスト",
    "コンポーネント",
    "レンダラ",
    "シリアライズ",
    "バリデーション",
    "パース",
    "インスタンス",
    "ハンドラ",
    "コールバック",
    "プロパティ",
    "ステート",
    "デバッグ",
    "リファクタ",
    "スキーマ"
  ],
  "exempt": {
    "authoring": ["JSON", "スキーマ"]
  }
}
```

`docs/manual/terms.json`:

```json
{
  "terms": [
    "自己保持",
    "a接点",
    "b接点",
    "タイムチャート",
    "コイル",
    "母線",
    "励磁",
    "レアショート",
    "溶着",
    "コイル断線",
    "ラダー図"
  ]
}
```

**注記**: `terms` に挙げた語は「本文で最初に出るところ」が `**用語**（やさしい説明）` の形でなければならない。Task 3・4 の原稿で、初出が表や箇条書きのほうに先に来てしまっていたら、**説明の段落を前へ動かす**（規則を変えるのではなく原稿を直す）。テストは落ちた語と前後60文字を出すので、どこを動かせばよいか分かる。

- [x] **Step 2: 失敗するテストを書く（文体）**

`apps/desktop/test/manual-style.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chapterIdOf } from '../scripts/manual-build.mjs';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';

/**
 * 説明書の文体。取扱説明書 設計 §6.2 / 決定表#21。
 * **利用者要求「専門用語なく詳細に解説すること」を機械で数えるテスト。**
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const STYLE = JSON.parse(readFileSync(join(MANUAL_DIR, 'style.json'), 'utf8')) as {
  banned: string[];
  exempt: Record<string, string[]>;
};
const TERMS = JSON.parse(readFileSync(join(MANUAL_DIR, 'terms.json'), 'utf8')) as {
  terms: string[];
};

interface Chapter {
  id: string;
  /** 囲み（```）の中を落とした本文。禁止語はここで数える。 */
  prose: string;
}

function chapters(): Chapter[] {
  return readdirSync(MANUAL_DIR)
    .filter((name) => /^\d{2}-.+\.md$/u.test(name))
    .sort()
    .map((name) => ({
      id: chapterIdOf(name),
      prose: readFileSync(join(MANUAL_DIR, name), 'utf8')
        .replace(/\r\n/gu, '\n')
        // 囲みの中（指導者向けの課題ファイルの例など）は文体の対象外
        .replace(/```[\s\S]*?```/gu, ' '),
    }));
}

/** 全章の本文を章の順につないだもの（初出の位置を見るのに使う）。 */
function wholeProse(): string {
  return chapters()
    .map((chapter) => chapter.prose)
    .join('\n');
}

describe('禁止語（決定表#21）', () => {
  const all = chapters();

  it.each(STYLE.banned)('never writes %s outside the chapters that are exempt', (word) => {
    const offenders: string[] = [];
    for (const chapter of all) {
      if ((STYLE.exempt[chapter.id] ?? []).includes(word)) continue;
      const index = chapter.prose.toLowerCase().indexOf(word.toLowerCase());
      if (index >= 0) {
        offenders.push(`${chapter.id}: …${chapter.prose.slice(Math.max(0, index - 30), index + 30)}…`);
      }
    }
    expect(offenders, `禁止語「${word}」が残っています`).toEqual([]);
  });

  it('keeps the banned list and the exempt chapters honest', () => {
    expect(STYLE.banned.length).toBeGreaterThanOrEqual(20);
    for (const [chapterId, words] of Object.entries(STYLE.exempt)) {
      expect(all.some((chapter) => chapter.id === chapterId)).toBe(true);
      for (const word of words) expect(STYLE.banned).toContain(word);
    }
  });
});

describe('専門用語の初出（決定表#21）', () => {
  const prose = wholeProse();

  it.each(TERMS.terms)('introduces %s in bold with a plain explanation', (term) => {
    const first = prose.indexOf(term);
    expect(first, `「${term}」が本文に1度も出ていません`).toBeGreaterThanOrEqual(0);
    const context = prose.slice(Math.max(0, first - 30), first + 90);
    expect(prose.slice(first - 2, first), `初出が太字ではありません: …${context}…`).toBe('**');
    const after = prose.slice(first + term.length);
    expect(after.startsWith('**（'), `初出の直後に説明の括弧がありません: …${context}…`).toBe(true);
    const close = after.indexOf('）');
    expect(close - 3, `初出の説明が短すぎます: …${context}…`).toBeGreaterThanOrEqual(15);
  });
});

describe('用語集', () => {
  const glossary = MANUAL_SECTIONS.find((section) => section.id === 'glossary/用語集');

  it('exists', () => {
    expect(glossary).toBeDefined();
  });

  it.each(TERMS.terms)('explains %s with at least twenty characters', (term) => {
    const rows = (glossary?.html ?? '').split('<tr>');
    const row = rows.find((cells) => cells.includes(term));
    expect(row, `用語集に「${term}」の行がありません`).toBeDefined();
    const cells = (row ?? '').match(/<td>([\s\S]*?)<\/td>/gu) ?? [];
    const explanation = (cells[cells.length - 1] ?? '').replace(/<[^>]+>/gu, '').trim();
    expect(explanation.length, `用語集の「${term}」の説明が短すぎます`).toBeGreaterThanOrEqual(20);
  });
});
```

期待: `it.each` が展開されるので **禁止語28件 ＋ 一覧の健全性1件 ＋ 初出11件 ＋ 用語集1件 ＋ 用語集11件** になるが、本プランは**節の数ではなくファイル単位**で数える。`pnpm test manual-style` の合計が **52件**（28＋1＋11＋1＋11）になることを確かめる。`## 完了条件` では `manual-style` を **1ファイル**として数え、本プラン 決定表 P12 の「19件」は `manual-style`（10件相当の検査項目）と `manual-coverage`（9件）の**検査項目**の数である。

- [x] **Step 3: 失敗するテストを書く（機能網羅）**

まず `docs/manual/coverage.json` の `messages` を埋める。次の一行で実物のキーを書き出せる:

```
cd apps/desktop && node -e "0" # 実際のキーは下のテストが列挙して落ちるので、落ちた出力をそのまま写す
pnpm --filter @ojt/desktop test manual-coverage
```

`apps/desktop/test/manual-coverage.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectTestIds } from '../scripts/feature-inventory.mjs';
import { JA } from '../src/renderer/i18n/ja.js';
import { MSG } from '../src/shared/messages.js';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';

/**
 * 機能の網羅。取扱説明書 設計 §6.3 / 決定表#22・#23。
 * **利用者要求「すべての機能を使用者目線で詳細に解説すること」を機械で数えるテスト。**
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COVERAGE = JSON.parse(
  readFileSync(join(resolve(APP_ROOT, '../../docs/manual'), 'coverage.json'), 'utf8'),
) as {
  controls: ReadonlyArray<{ testid: string; screen?: string; label?: string; section?: string; internal?: string }>;
  keys: ReadonlyArray<{ key: string; screen: string; action: string; section: string }>;
  gestures: ReadonlyArray<{ name: string; screen: string; action: string; section: string }>;
  messages: ReadonlyArray<{ key: string; section: string }>;
};

const TEXT_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.text]));
const HTML_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.html]));

/** 手順として番号付きで書くことを求める節。設計 §6.2 の規則7。 */
const PROCEDURE_SECTIONS = [
  'setup/インストーラで入れる',
  'setup/持ち運び版を使う',
  'setup/初回に出る青い画面',
  'mode-b/回路を組み立てる',
  'mode-c1/部品を点検する',
  'mode-c2/回路を点検して直す',
  'mode-d/PLCの課題を進める',
];

/**
 * メッセージの葉を `JA.error.banner` のような名前で集める。
 * 値が文字列のものだけ本文との一致を求める（関数は引数で文が変わるため名前だけ見る）。
 */
function messageLeaves(): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const walk = (prefix: string, value: unknown): void => {
    if (typeof value === 'string') {
      out.set(prefix, value);
      return;
    }
    if (typeof value === 'function') {
      out.set(prefix, undefined);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(`${prefix}.${key}`, child);
    }
  };
  walk('JA.error', JA.error);
  walk('JA.hazard', JA.hazard);
  walk('JA.staticCheck', JA.staticCheck);
  walk('JA.disabledReason', JA.disabledReason);
  walk('JA.routeReason', JA.routeReason);
  walk('JA.mismatchReason', JA.mismatchReason);
  walk('MSG', MSG);
  return out;
}

describe('操作要素（決定表#22）', () => {
  it('covers exactly the controls the screens have', () => {
    expect(COVERAGE.controls.map((row) => row.testid).sort()).toEqual(collectTestIds());
  });

  it('points every documented control at a section that exists', () => {
    for (const row of COVERAGE.controls) {
      if (row.section === undefined) continue;
      expect(TEXT_BY_ID.has(row.section), `${row.testid} の節 ${row.section} がありません`).toBe(true);
    }
  });

  it('writes the on-screen label of every documented control into its section', () => {
    const missing: string[] = [];
    for (const row of COVERAGE.controls) {
      if (row.section === undefined || row.label === undefined) continue;
      const text = TEXT_BY_ID.get(row.section) ?? '';
      if (!text.includes(row.label)) missing.push(`${row.section} に「${row.label}」が出ていません`);
    }
    expect(missing).toEqual([]);
  });
});

describe('キー操作とマウス操作（決定表#22）', () => {
  it('explains every listed key in the section it points at', () => {
    const missing: string[] = [];
    for (const row of COVERAGE.keys) {
      const text = TEXT_BY_ID.get(row.section);
      if (text === undefined) missing.push(`節 ${row.section} がありません`);
      else if (!text.includes(row.key)) missing.push(`${row.section} に「${row.key}」が出ていません`);
    }
    expect(missing).toEqual([]);
  });

  it('explains every listed mouse move in the section it points at', () => {
    const missing: string[] = [];
    for (const row of COVERAGE.gestures) {
      const text = TEXT_BY_ID.get(row.section);
      if (text === undefined) missing.push(`節 ${row.section} がありません`);
      else if (!text.includes(row.name)) missing.push(`${row.section} に「${row.name}」が出ていません`);
    }
    expect(missing).toEqual([]);
  });
});

describe('メッセージ（決定表#23）', () => {
  it('lists exactly the messages the app can show', () => {
    expect(COVERAGE.messages.map((row) => row.key).sort()).toEqual([...messageLeaves().keys()].sort());
  });

  it('quotes every fixed message in the section it points at', () => {
    const leaves = messageLeaves();
    const missing: string[] = [];
    for (const row of COVERAGE.messages) {
      const text = leaves.get(row.key);
      if (text === undefined) continue; // 引数で文が変わるものは名前だけ見る
      const section = TEXT_BY_ID.get(row.section);
      if (section === undefined) missing.push(`節 ${row.section} がありません`);
      else if (!section.includes(text)) missing.push(`${row.section} に「${text}」が出ていません`);
    }
    expect(missing).toEqual([]);
  });
});

describe('手順の書き方（設計 §6.2 の規則7）', () => {
  it.each(PROCEDURE_SECTIONS)('writes %s as a numbered procedure', (id) => {
    expect(HTML_BY_ID.get(id), `節 ${id} がありません`).toBeDefined();
    expect(HTML_BY_ID.get(id) ?? '').toContain('<ol>');
  });
});
```

- [x] **Step 3b: 図の意味を決め、本文を吹き出しの番号で書き直す**

`docs/manual/shots.json` を作る。鍵は画像のファイル名（拡張子を除く）。本設計 §6.4 の表の17枚をすべて書く。`label` は**画面に出ている言葉そのまま**にする。

```json
{
  "home": {
    "caption": "ホームの画面",
    "callouts": [
      { "n": 1, "label": "回路組立" },
      { "n": 2, "label": "設定" },
      { "n": 3, "label": "ヘルプ" }
    ]
  },
  "session-board": {
    "caption": "モードBの練習中の画面",
    "callouts": [
      { "n": 1, "label": "もどる" },
      { "n": 2, "label": "次にすること" },
      { "n": 3, "label": "3Dの画面" },
      { "n": 4, "label": "右の欄" },
      { "n": 5, "label": "判定" }
    ]
  }
}
```

（残り15枚も同じ形で、本設計 §6.4 の「吹き出しが指すもの」の列をそのまま `label` にする。）

そのうえで、**図を載せた節の本文を吹き出しの番号で書き直す**。例:

> ①の「回路組立」を押すと、回路を組み立てる課題が並びます。②の「設定」では音や課題の置き場所を変えられます。③の「ヘルプ」を押すと、この説明書が画面の右から開きます。

`apps/desktop/test/manual-shots.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';

/**
 * 図の意味と原稿の対応。取扱説明書 設計 §6.2 の規則10 / §6.4。
 * **画像そのものは見ない**ので、撮影（Plan 6 Task 12）より前に走る。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const SHOTS = JSON.parse(readFileSync(join(MANUAL_DIR, 'shots.json'), 'utf8')) as Record<
  string,
  { caption: string; callouts: Array<{ n: number; label: string }> }
>;

/** 丸数字（①〜⑳）。 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** 原稿が参照している図（`![alt](images/x.png)` の x と alt と、その節）。 */
function references(): Array<{ name: string; alt: string; sectionId: string }> {
  const out: Array<{ name: string; alt: string; sectionId: string }> = [];
  for (const name of readdirSync(MANUAL_DIR).filter((n) => /^\d{2}-.+\.md$/u.test(n)).sort()) {
    const chapterId = name.replace(/^\d{2}-/u, '').replace(/\.md$/u, '');
    let sectionTitle = '';
    for (const line of readFileSync(join(MANUAL_DIR, name), 'utf8').replace(/\r\n/gu, '\n').split('\n')) {
      if (line.startsWith('## ')) {
        sectionTitle = line.slice(3).trim();
        continue;
      }
      const match = /^!\[([^\]]*)\]\(images\/([A-Za-z0-9-]+)\.png\)\s*$/u.exec(line.trim());
      if (match?.[1] !== undefined && match[2] !== undefined) {
        out.push({ name: match[2], alt: match[1], sectionId: `${chapterId}/${sectionTitle}` });
      }
    }
  }
  return out;
}

const TEXT_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.text]));

describe('図の定義（設計 §6.4）', () => {
  it('defines every figure the manual refers to', () => {
    const referred = [...new Set(references().map((row) => row.name))].sort();
    expect(Object.keys(SHOTS).sort()).toEqual(referred);
  });

  it('gives every figure a caption and at least two callouts', () => {
    for (const [name, shot] of Object.entries(SHOTS)) {
      expect(shot.caption.length, `${name} の説明文がありません`).toBeGreaterThan(0);
      expect(shot.callouts.length, `${name} の吹き出しが少なすぎます`).toBeGreaterThanOrEqual(2);
    }
  });

  it('numbers the callouts from one without a gap', () => {
    for (const [name, shot] of Object.entries(SHOTS)) {
      expect(
        shot.callouts.map((callout) => callout.n),
        `${name} の吹き出しの番号が 1 から続いていません`,
      ).toEqual(shot.callouts.map((_callout, index) => index + 1));
    }
  });
});

describe('原稿と図の対応（設計 §6.2 の規則9・10）', () => {
  it('writes the caption into the alt text of every figure', () => {
    const missing: string[] = [];
    for (const row of references()) {
      const caption = SHOTS[row.name]?.caption ?? '';
      if (!row.alt.includes(caption)) missing.push(`${row.name} の説明が alt にありません`);
    }
    expect(missing).toEqual([]);
  });

  it('points at every callout by its circled number and its on-screen label', () => {
    const missing: string[] = [];
    for (const row of references()) {
      const text = TEXT_BY_ID.get(row.sectionId);
      if (text === undefined) {
        missing.push(`節 ${row.sectionId} がありません`);
        continue;
      }
      for (const callout of SHOTS[row.name]?.callouts ?? []) {
        const mark = CIRCLED[callout.n - 1] ?? '';
        if (!text.includes(mark)) missing.push(`${row.sectionId} に ${mark} が出ていません`);
        if (!text.includes(callout.label)) {
          missing.push(`${row.sectionId} に「${callout.label}」が出ていません`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
```

期待（Step 5 のあと）: **6件通る**。

- [x] **Step 4: テストが指したところを直す**

```
pnpm --filter @ojt/desktop test manual-style manual-coverage manual-shots
```

落ちた項目を次の順に直す。**規則のほうは変えない。**

1. `messages` の集合が合わない → 落ちた出力の差分をそのまま `coverage.json` の `messages` に写す（すべて `troubleshooting/こう表示されたら` を指す）。
2. 「…に『…』が出ていません」→ その節にその文言を書き足す。
3. 「初出が太字ではありません」→ 説明の段落を、その語が最初に出る場所より**前**へ動かす。
4. 「禁止語が残っています」→ やさしい言い方に書き換える（例: 「バリデーション」→「書き方の確かめ」）。
5. 「… に ① が出ていません」→ その節の本文を吹き出しの番号で書き直す（Step 3b の例の形）。

- [x] **Step 5: 生成物を作り直してテストを通す**

```
cd apps/desktop && node scripts/build-manual.mjs
pnpm --filter @ojt/desktop test manual-
# 期待: Test Files 5 passed（manual-build / manual-sync / manual-style / manual-coverage / manual-shots）
pnpm --filter @ojt/desktop typecheck && pnpm lint
# 期待: どちらも無警告
```

- [x] **Step 6: commit**

```
git add docs/manual/style.json docs/manual/terms.json docs/manual/shots.json docs/manual/coverage.json docs/manual apps/desktop/test/manual-style.test.ts apps/desktop/test/manual-coverage.test.ts apps/desktop/test/manual-shots.test.ts apps/desktop/src/renderer/help/manual-content.ts
git diff --cached --stat
git commit -m "test(desktop): prove the manual covers every control, uses no jargon and points at its figures (Plan 6 Task 5)"
git show --stat HEAD
```

**注記**: `git add docs/manual` はこのタスクが `docs/manual/*.md` を直したぶんを入れるためで、**他のエージェントのファイルは `docs/manual/` の下に無い**ので安全である（MERGE 注意#6）。

---

## Task 6: ヘルプの純関数層

**モデル: Sonnet-verbatim**（本書のコードとテストをそのまま書き写せば通る）

**Files:**
- Create: `apps/desktop/src/renderer/help/help-model.ts`
- Test: `apps/desktop/test/help-model.test.ts`（新規）

本設計 §5.2・決定表#18・#19。3D もストアも触らない純関数だけを置く。

- [x] **Step 1: 失敗するテストを書く**

`apps/desktop/test/help-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  currentHelpScreen,
  defaultSectionId,
  HELP_SECTION_BY_SCREEN,
  MAX_HELP_HITS,
  searchManual,
  sectionById,
} from '../src/renderer/help/help-model.js';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';

/** ヘルプの引き出しが使う純関数。取扱説明書 設計 §5.2 / 決定表#18・#19。 */

describe('いまの画面（決定表#18）', () => {
  it('maps the home screen', () => {
    expect(currentHelpScreen('home', undefined, 'board')).toBe('home');
  });

  it('maps the list and the settings screens', () => {
    expect(currentHelpScreen('list', undefined, 'board')).toBe('list');
    expect(currentHelpScreen('settings', undefined, 'board')).toBe('settings');
  });

  it('maps the result screen', () => {
    expect(currentHelpScreen('result', 'assemble', 'board')).toBe('result');
  });

  it('tells the three modes of a session apart', () => {
    expect(currentHelpScreen('session', 'inspect-parts', 'board')).toBe('inspect-parts');
    expect(currentHelpScreen('session', 'inspect-repair', 'board')).toBe('inspect-repair');
    expect(currentHelpScreen('session', 'plc', 'board')).toBe('plc');
  });

  it('switches to the schematic when mode B shows the drawing', () => {
    expect(currentHelpScreen('session', 'assemble', 'board')).toBe('assemble');
    expect(currentHelpScreen('session', 'assemble', 'split')).toBe('assemble');
    expect(currentHelpScreen('session', 'assemble', 'schematic')).toBe('schematic');
  });

  it('falls back to the home screen when no problem is open', () => {
    expect(currentHelpScreen('session', undefined, 'board')).toBe('home');
  });
});

describe('画面と節の対応', () => {
  it('points every screen at a section that exists', () => {
    for (const [screen, id] of Object.entries(HELP_SECTION_BY_SCREEN)) {
      expect(sectionById(id), `${screen} の節 ${id} がありません`).toBeDefined();
    }
  });

  it('falls back to the first section when the id is unknown', () => {
    expect(defaultSectionId('home')).toBe(HELP_SECTION_BY_SCREEN.home);
    expect(sectionById('ありません/ありません')).toBeUndefined();
  });
});

describe('検索（決定表#19）', () => {
  it('finds a section by a word in its body', () => {
    const hits = searchManual('自己保持');
    expect(hits.length).toBeGreaterThan(0);
    expect(sectionById(hits[0]?.sectionId ?? '')).toBeDefined();
    expect(hits[0]?.excerpt).toContain('自己保持');
  });

  it('finds a section by its heading', () => {
    const hits = searchManual('用語集');
    expect(hits.some((hit) => hit.sectionId === 'glossary/用語集')).toBe(true);
  });

  it('ignores case, width and spaces', () => {
    const wide = searchManual('ＰＬＣ');
    const narrow = searchManual('plc');
    expect(wide.map((h) => h.sectionId)).toEqual(narrow.map((h) => h.sectionId));
  });

  it('returns nothing for an empty query or a word that is not there', () => {
    expect(searchManual('')).toEqual([]);
    expect(searchManual('   ')).toEqual([]);
    expect(searchManual('そんな言葉はありません')).toEqual([]);
  });

  it('never returns more hits than the cap', () => {
    // 「の」はほとんどの節に出るので、上限の働きを確かめられる
    expect(searchManual('の').length).toBeLessThanOrEqual(MAX_HELP_HITS);
    expect(MANUAL_SECTIONS.length).toBeGreaterThan(MAX_HELP_HITS);
  });
});
```

期待（Step 2 のあと）: **12件通る**。

```
pnpm --filter @ojt/desktop test help-model
# 期待: FAIL（`help-model.js` が無い）
```

- [x] **Step 2: 純関数層を作る**

`apps/desktop/src/renderer/help/help-model.ts`:

```ts
import type { SessionMode } from '../../shared/ipc.js';
import type { AssembleView } from '../app/store-types.js';
import { MANUAL_SECTIONS, type ManualSection } from './manual-content.js';

/**
 * ヘルプの引き出しが使う純関数。取扱説明書 設計 §5.2 / 決定表#18・#19。
 *
 * 3D にもストアにも触らない。「いまどの画面か」も「どの節を探し当てたか」も
 * ここで決めるので、画面を描かずに単体テストできる（§12.2 の純粋関数化と同じ趣旨）。
 */

/** ヘルプから見た画面の種類。 */
export type HelpScreenId =
  | 'home'
  | 'list'
  | 'settings'
  | 'assemble'
  | 'schematic'
  | 'inspect-parts'
  | 'inspect-repair'
  | 'plc'
  | 'result';

/** 画面ごとに最初に開く節。取扱説明書 設計 §5.2 の表。 */
export const HELP_SECTION_BY_SCREEN: Readonly<Record<HelpScreenId, string>> = {
  home: 'intro/このアプリでできること',
  list: 'screens/課題をえらぶ',
  settings: 'settings/設定の画面',
  assemble: 'mode-b/回路を組み立てる',
  schematic: 'schematic/回路図を描く',
  'inspect-parts': 'mode-c1/部品を点検する',
  'inspect-repair': 'mode-c2/回路を点検して直す',
  plc: 'mode-d/PLCの課題を進める',
  result: 'screens/結果の画面',
};

/** 検索で返す件数の上限。決定表#19 */
export const MAX_HELP_HITS = 20;

/** 当たったところの前後に付ける文字数。 */
const EXCERPT_PAD = 30;

/**
 * いまどの画面を見ているか。
 * `route` だけでは決まらない（`session` は4モードあり、モードBは回路図ビューに切り替わる）。
 */
export function currentHelpScreen(
  route: 'home' | 'list' | 'session' | 'result' | 'settings',
  mode: SessionMode | undefined,
  assembleView: AssembleView,
): HelpScreenId {
  if (route === 'home') return 'home';
  if (route === 'list') return 'list';
  if (route === 'settings') return 'settings';
  if (route === 'result') return 'result';
  switch (mode) {
    case 'assemble':
      return assembleView === 'schematic' ? 'schematic' : 'assemble';
    case 'inspect-parts':
      return 'inspect-parts';
    case 'inspect-repair':
      return 'inspect-repair';
    case 'plc':
      return 'plc';
    default:
      // 課題を開かずにセッション画面へ来た（あり得ないが、黙って落ちないようにする）
      return 'home';
  }
}

const BY_ID = new Map<string, ManualSection>(MANUAL_SECTIONS.map((section) => [section.id, section]));

/** 節ID から節を引く。 */
export function sectionById(id: string): ManualSection | undefined {
  return BY_ID.get(id);
}

/** 画面に対応する節ID（無ければ目次の最初の節。§9 のエラー処理）。 */
export function defaultSectionId(screen: HelpScreenId): string {
  const id = HELP_SECTION_BY_SCREEN[screen];
  if (BY_ID.has(id)) return id;
  return MANUAL_SECTIONS[0]?.id ?? '';
}

/**
 * 比べる前にそろえる。全角と半角、大文字と小文字、空白のあるなしで
 * 見つからないことがないようにする（決定表#19）。
 */
function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

/** 検索で当たった1件。 */
export interface HelpHit {
  sectionId: string;
  title: string;
  chapterTitle: string;
  excerpt: string;
}

/**
 * 見出しと本文の素の文に対する部分一致。
 * 当たった位置の前後を切り出して一覧に出す。
 */
export function searchManual(query: string, limit: number = MAX_HELP_HITS): HelpHit[] {
  const needle = normalize(query);
  if (needle === '') return [];
  const hits: HelpHit[] = [];
  for (const section of MANUAL_SECTIONS) {
    if (hits.length >= limit) break;
    const haystack = normalize(`${section.title} ${section.text}`);
    if (!haystack.includes(needle)) continue;
    hits.push({
      sectionId: section.id,
      title: section.title,
      chapterTitle: section.chapterTitle,
      excerpt: excerptOf(section, query),
    });
  }
  return hits;
}

/**
 * 当たったところの前後を切り出す。
 * 正規化した文字列では元の位置がずれるので、**元の文**の上で素直に探し直す。
 * 元の文で見つからない（全角・半角の違いなどで正規化したときだけ当たった）ときは
 * 節の書き出しを返す。
 */
function excerptOf(section: ManualSection, query: string): string {
  const trimmed = query.trim();
  const at = trimmed === '' ? -1 : section.text.indexOf(trimmed);
  if (at < 0) return section.text.slice(0, EXCERPT_PAD * 2);
  const from = Math.max(0, at - EXCERPT_PAD);
  const to = Math.min(section.text.length, at + trimmed.length + EXCERPT_PAD);
  return `${from > 0 ? '…' : ''}${section.text.slice(from, to)}${to < section.text.length ? '…' : ''}`;
}
```

**注記**: `AssembleView` は Plan 5 Task 7 が `app/store-types.ts` に置いた型である。実ソースで名前を確かめ、違っていたらその名前を使う（`'board' | 'split' | 'schematic'` の共用体であることは変わらない）。

- [x] **Step 3: テストを通す**

```
pnpm --filter @ojt/desktop test help-model
# 期待: Test Files 1 passed / Tests 12 passed
pnpm --filter @ojt/desktop typecheck && pnpm lint
# 期待: どちらも無警告
```

- [x] **Step 4: commit**

```
git add apps/desktop/src/renderer/help/help-model.ts apps/desktop/test/help-model.test.ts
git diff --cached --stat
git commit -m "feat(desktop): decide which manual section each screen opens and search the manual (Plan 6 Task 6)"
git show --stat HEAD
```

---

## Task 7: PDF の生成・8本目のIPC・配布物への同梱

**モデル: Opus**（§4.3 のチャネルを1本増やす判断、配布の工程への差し込み、Plan 5 Task 14 への追記）

**Files:**
- Create: `apps/desktop/scripts/print-manual.mjs`
- Create: `apps/desktop/src/main/manual.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`（**7本 → 8本**）
- Modify: `apps/desktop/src/shared/messages.ts`（`MSG.manual`）
- Modify: `apps/desktop/src/main/ipc.ts` / `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/package.json`（`dist`）
- Modify: `apps/desktop/electron-builder.yml`（`extraResources` に1項目）
- Modify: `apps/desktop/scripts/check-dist.mjs`（Plan 5 Task 14 が作ったもの。3点だけ足す）
- Modify: `docs/releases/v1.0.0.md`（リリース手順チェックリストに2項目）
- Modify: `docs/manual/coverage.json`（`MSG.manual` の2行）
- Test: `apps/desktop/test/manual-ipc.test.ts`（新規）
- Test: `apps/desktop/test/release-manual.test.ts`（新規）

本設計 §7・§8、決定表#4〜#8・#26・#27。

- [x] **Step 1: 失敗するテストを書く（8本目のチャネル）**

`apps/desktop/test/manual-ipc.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 説明書（PDF）を開く。取扱説明書 設計 §8 / §9。
 * `electron` を差し替えて3つの分かれ道（PDFが無い／開けた／開けなかった）を確かめる。
 */

const state = {
  isPackaged: false,
  appPath: 'C:\\app',
  resourcesPath: 'C:\\app\\resources',
  exists: new Set<string>(),
  openPathResult: '',
  openedPaths: [] as string[],
};

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.isPackaged;
    },
    getAppPath: () => state.appPath,
  },
  shell: {
    openPath: (path: string) => {
      state.openedPaths.push(path);
      return Promise.resolve(state.openPathResult);
    },
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return { ...real, existsSync: (path: string) => state.exists.has(path) };
});

const { manualPdfPath, openManual } = await import('../src/main/manual.js');
const { MSG } = await import('../src/shared/messages.js');
const { IPC_CHANNELS } = await import('../src/shared/ipc.js');

afterEach(() => {
  state.isPackaged = false;
  state.exists.clear();
  state.openPathResult = '';
  state.openedPaths = [];
  Object.defineProperty(globalThis.process, 'resourcesPath', {
    value: state.resourcesPath,
    configurable: true,
  });
});

describe('PDF の置き場所（設計 §8）', () => {
  it('reads it from the app folder while developing', () => {
    expect(manualPdfPath()).toBe('C:\\app\\resources\\manual\\manual.pdf');
  });

  it('reads it from the resources folder in a packaged build', () => {
    state.isPackaged = true;
    Object.defineProperty(globalThis.process, 'resourcesPath', {
      value: 'C:\\installed\\resources',
      configurable: true,
    });
    expect(manualPdfPath()).toBe('C:\\installed\\resources\\manual.pdf');
  });
});

describe('PDF を開く（設計 §9）', () => {
  it('says so when the file is not there, and does not call the shell', async () => {
    const result = await openManual();
    expect(result).toEqual({ ok: false, message: MSG.manual.missing });
    expect(state.openedPaths).toEqual([]);
  });

  it('hands the file to the operating system when it is there', async () => {
    state.exists.add(manualPdfPath());
    const result = await openManual();
    expect(result).toEqual({ ok: true, path: manualPdfPath() });
    expect(state.openedPaths).toEqual([manualPdfPath()]);
  });

  it('reports why the operating system refused', async () => {
    state.exists.add(manualPdfPath());
    state.openPathResult = '関連付けられたアプリがありません';
    const result = await openManual();
    expect(result).toEqual({
      ok: false,
      message: MSG.manual.openFailed('関連付けられたアプリがありません'),
    });
  });
});

describe('チャネル（§4.3 からの意図的な差分）', () => {
  it('has exactly eight channels and the eighth is the manual', () => {
    expect(Object.keys(IPC_CHANNELS)).toHaveLength(8);
    expect(IPC_CHANNELS.manualOpen).toBe('manual:open');
  });

  it('keeps the seven channels that were there before', () => {
    expect(Object.values(IPC_CHANNELS)).toEqual([
      'content:list',
      'content:read',
      'workfile:save',
      'workfile:load',
      'settings:get',
      'settings:set',
      'file:saveText',
      'manual:open',
    ]);
  });
});
```

期待（Step 4 のあと）: **7件通る**。

- [x] **Step 2: 失敗するテストを書く（同梱と工程）**

`apps/desktop/test/release-manual.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** 説明書 PDF が配布物に入ること。取扱説明書 設計 §7.2 / §7.3 / 決定表#6・#27。 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const builderYml = readFileSync(join(APP_ROOT, 'electron-builder.yml'), 'utf8');
const checkDist = readFileSync(join(APP_ROOT, 'scripts', 'check-dist.mjs'), 'utf8');

describe('ビルドの順番（設計 §7.2）', () => {
  it('builds the manual, then the pdf, then the app, then checks the artefacts', () => {
    const dist = pkg.scripts['dist'] ?? '';
    const order = ['build-manual.mjs', 'print-manual.mjs', 'scripts/build.mjs', 'electron-builder', 'check-dist.mjs'];
    let at = -1;
    for (const step of order) {
      const next = dist.indexOf(step);
      expect(next, `dist に ${step} がありません`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('builds the manual before the app in the plain build too', () => {
    expect(pkg.scripts['build']).toContain('build-manual.mjs');
  });
});

describe('同梱（設計 §7.3 / 決定表#6）', () => {
  it('ships the pdf next to the bundled problems, for both the installer and the zip', () => {
    expect(builderYml).toContain('from: resources/manual/manual.pdf');
    expect(builderYml).toContain('to: manual.pdf');
    // 既存の同梱物と配布形態は変えない
    expect(builderYml).toContain('from: resources/content');
    expect(builderYml).toContain('target: nsis');
    expect(builderYml).toContain('target: zip');
  });

  it('checks the pdf in the packaged build', () => {
    expect(checkDist).toContain('manual.pdf');
  });
});

describe('依存（設計 §12 の差分#6）', () => {
  it('adds the markdown reader for the build only', () => {
    expect(pkg.devDependencies['markdown-it']).toBeDefined();
    expect(pkg.dependencies['markdown-it']).toBeUndefined();
    // 実行時依存はワークスペースの6つだけのまま
    expect(Object.keys(pkg.dependencies).every((name) => name.startsWith('@ojt/'))).toBe(true);
  });
});
```

期待（Step 6 のあと）: **5件通る**。

- [x] **Step 3: `shared/ipc.ts` を8本にする**

先頭のコメントを直す（**「7本」を全部「8本」にする**。3箇所）:

```ts
/**
 * main ⇄ renderer の IPC 契約。設計仕様 §4.3。
 * チャネルは `content:list` / `content:read` / `workfile:save` / `workfile:load` /
 * `settings:get` / `settings:set` / `file:saveText` / `manual:open` の **8本のみ**。
 * preload はこの8本だけを `window.ojt` に出す。
 */

/**
 * IPCチャネル名（この8本以外を足さない。§4.3）。
 * Phase 4 で `file:saveText` を足して7本、Phase 6 で `manual:open` を足して**8本**になった
 * （取扱説明書 設計 §8）。`manual:open` は**引数を1つも取らない**——開く対象は main が
 * 組み立てた固定の1ファイルだけで、renderer から任意のパスを開かせる余地を型の上で持たない。
 */
export const IPC_CHANNELS = {
  contentList: 'content:list',
  contentRead: 'content:read',
  workfileSave: 'workfile:save',
  workfileLoad: 'workfile:load',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  textfileSave: 'file:saveText',
  // --- Plan 6 Task 7 ---
  manualOpen: 'manual:open',
  // --- /Plan 6 Task 7 ---
} as const;
```

`AppSettingsResponse` のコメントにある「7本目を作らずこの戻り値へ載せる」はそのままでよい（当時の判断の記録なので書き換えない）。

`OjtApi` に1つ足す:

```ts
  // --- Plan 6 Task 7 ---
  /** 同梱の取扱説明書（PDF）を OS の既定ビューアで開く。取扱説明書 設計 §8 */
  openManual: () => Promise<OpenManualResult>;
  // --- /Plan 6 Task 7 ---
```

ファイルの末尾（`SaveTextResult` の下）に型を足す:

```ts
// --- Plan 6 Task 7 ---
/** 説明書（PDF）を開いた結果。取扱説明書 設計 §8 / §9 */
export type OpenManualResult = { ok: true; path: string } | { ok: false; message: string };
// --- /Plan 6 Task 7 ---
```

- [x] **Step 4: main 側を作る**

`apps/desktop/src/shared/messages.ts` の `MSG` に足す:

```ts
  // --- Plan 6 Task 7 ---
  manual: {
    missing: '説明書（PDF）が見つかりません。この画面のもくじから同じ内容を読めます。',
    openFailed: (detail: string): string => `説明書（PDF）を開けませんでした: ${detail}`,
  },
  // --- /Plan 6 Task 7 ---
```

`apps/desktop/src/main/manual.ts`:

```ts
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, shell } from 'electron';
import type { OpenManualResult } from '../shared/ipc.js';
import { MSG } from '../shared/messages.js';

/**
 * 同梱の取扱説明書（PDF）を OS の既定ビューアで開く。取扱説明書 設計 §8 / §9。
 *
 * **renderer からは何も受け取らない。** 開くファイルはここで組み立てた1つだけで、
 * renderer が指したパスを開くことはない（`file:saveText` は保存ダイアログを通すので
 * 利用者が行き先を決めるが、こちらは行き先がアプリの中に固定されている）。
 */

/**
 * PDF の置き場所。課題JSON（`content-loader.ts` の `builtinContentDir()`）と同じ流儀で、
 * 配布版は asar の外（`resources/manual.pdf`）、開発中はリポジトリの
 * `apps/desktop/resources/manual/manual.pdf` を見る。
 */
export function manualPdfPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'manual.pdf');
  return resolve(app.getAppPath(), 'resources', 'manual', 'manual.pdf');
}

/** PDF を開く。開けなければ理由を返す（例外にしない。§13）。 */
export async function openManual(): Promise<OpenManualResult> {
  const path = manualPdfPath();
  if (!existsSync(path)) return { ok: false, message: MSG.manual.missing };
  // `shell.openPath()` は成功すると空文字、失敗すると理由の文字列を返す
  const failure = await shell.openPath(path);
  if (failure === '') return { ok: true, path };
  return { ok: false, message: MSG.manual.openFailed(failure) };
}
```

`apps/desktop/src/main/ipc.ts` のコメントを「8チャネル」に直し、末尾に足す:

```ts
  // --- Plan 6 Task 7 ---
  // 取扱説明書（PDF）を OS の既定ビューアで開く（取扱説明書 設計 §8）。引数は取らない
  ipcMain.handle(IPC_CHANNELS.manualOpen, () => openManual());
  // --- /Plan 6 Task 7 ---
```

`import { openManual } from './manual.js';` を足す。

`apps/desktop/src/preload/index.ts` のコメントを「8チャネル」に直し、`api` に足す:

```ts
  // --- Plan 6 Task 7 ---
  openManual: () => ipcRenderer.invoke(IPC_CHANNELS.manualOpen) as Promise<OpenManualResult>,
  // --- /Plan 6 Task 7 ---
```

`OpenManualResult` を型 import に足す。

```
pnpm --filter @ojt/desktop test manual-ipc
# 期待: Test Files 1 passed / Tests 7 passed
```

- [x] **Step 5: PDF を焼くスクリプトを作る**

`apps/desktop/scripts/print-manual.mjs`:

```js
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

/**
 * 印刷用 HTML を PDF にする。取扱説明書 設計 §7.1 / 決定表#4・#26。
 *
 *   electron scripts/print-manual.mjs
 *
 * puppeteer も wkhtmltopdf も使わない。配布に使うのと**同じ Chromium**（Electron 本体）で
 * 組むので、画面で見たとおりの体裁になり、Chromium をもう1つ取りに行かない（§15 のオフライン方針）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');
const HTML = join(APP_ROOT, 'resources', 'manual', 'manual.html');
const PDF = join(APP_ROOT, 'resources', 'manual', 'manual.pdf');

/** A4・上下18mm・左右16mm（`printToPDF` の単位はインチ）。決定表#26 */
const MARGINS = { marginType: 'custom', top: 0.71, bottom: 0.71, left: 0.63, right: 0.63 };

async function main() {
  if (!existsSync(HTML)) {
    globalThis.process.stderr.write(
      `印刷用HTMLがありません: ${HTML}（先に node scripts/build-manual.mjs を走らせてください）\n`,
    );
    globalThis.process.exitCode = 1;
    app.quit();
    return;
  }
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // 原稿には動く仕掛けが1つも無いので、実行を止めておく（読み込むのは自分で書いた HTML だけ）
      javascript: false,
    },
  });
  await window.loadFile(HTML);
  const pdf = await window.webContents.printToPDF({
    pageSize: 'A4',
    landscape: false,
    printBackground: true,
    margins: MARGINS,
    // 見出しから しおり を作る（長い説明書を紙でも画面でも引けるようにする）
    generateDocumentOutline: true,
  });
  writeFileSync(PDF, pdf);
  globalThis.process.stdout.write(
    `取扱説明書を書き出しました: ${PDF}（${String(Math.round(pdf.length / 1024))} KB）\n`,
  );
  window.destroy();
  app.quit();
}

app.whenReady().then(main, (error) => {
  globalThis.process.stderr.write(`PDFの生成に失敗しました: ${String(error)}\n`);
  globalThis.process.exitCode = 1;
  app.quit();
});
```

```
cd apps/desktop && node scripts/build-manual.mjs && npx electron scripts/print-manual.mjs
# 期待: 取扱説明書を書き出しました: …/resources/manual/manual.pdf（数百 KB）
```

- [x] **Step 6: 配布の工程に差し込む**

`apps/desktop/package.json` の `dist`（Plan 5 Task 14 が書いたものに**2工程だけ**足す）:

```json
    "dist": "node scripts/copy-content.mjs && node scripts/build-manual.mjs && electron scripts/print-manual.mjs && node scripts/build.mjs && electron-builder --config electron-builder.yml && node scripts/check-dist.mjs"
```

`apps/desktop/electron-builder.yml` の `extraResources` に1項目足す（既存の項目は1文字も変えない）:

```yaml
extraResources:
  - from: resources/content
    to: content
  # 取扱説明書（PDF）。asar の中に入れると OS のビューアが読めないので、実体で置く。
  # NSIS とポータブルは `extraResources` を共有するので、この1項目で両方に入る。
  - from: resources/manual/manual.pdf
    to: manual.pdf
```

`apps/desktop/scripts/check-dist.mjs`（Plan 5 Task 14 が書いたもの）の、`if (!existsSync(join(UNPACKED, 'resources', 'app.asar')))` の**直後**に足す:

```js
  // 取扱説明書（PDF）。取扱説明書 設計 §7.3 / 決定表#27
  const manual = join(UNPACKED, 'resources', 'manual.pdf');
  if (!existsSync(manual)) {
    fail('resources/manual.pdf がありません（extraResources に入っていません）');
  } else {
    const bytes = statSync(manual).size;
    if (bytes === 0) fail('resources/manual.pdf が空です');
    else {
      rows.push({ name: 'resources/manual.pdf', size: bytes, sha256: await sha256Of(manual) });
      out.write(`取扱説明書 OK: ${bytes.toLocaleString('en-US')} バイト\n`);
    }
  }
```

`rows` は Plan 5 Task 14 が `release/artifacts.md` の表を組むために持っている配列なので、ここへ足すと表に PDF の行（バイト数と SHA256）が載る。

`docs/releases/v1.0.0.md` のリリース手順チェックリストに2項目足す（Plan 5 Task 14 が書いた 1〜8 の後ろ、9 の前）:

```markdown
- [ ] 8a. 取扱説明書の図が**いまの画面**であること（画面を直したら
      `pnpm --filter @ojt/desktop e2e manual-shots` で撮り直し、差分を commit する）
- [ ] 8b. インストールした環境で「ヘルプ」→「説明書（PDF）を開く」を押し、
      **OS の既定ビューアで PDF が開く**こと（§16 Phase 6 受入基準③。E2E は押さない）
```

`docs/manual/coverage.json` の `messages` に2行足す:

```json
  { "key": "MSG.manual.missing", "section": "troubleshooting/説明書（PDF）が開かない" },
  { "key": "MSG.manual.openFailed", "section": "troubleshooting/説明書（PDF）が開かない" }
```

`12-troubleshooting.md` の「説明書（PDF）が開かない」に `MSG.manual.missing` の文言をそのまま書く（`manual-coverage.test.ts` が照合する）。

- [x] **Step 7: テストを通す**

```
cd apps/desktop && node scripts/build-manual.mjs
pnpm --filter @ojt/desktop test manual-ipc release-manual manual-coverage
# 期待: Test Files 3 passed / Tests 7 + 5 + 8 passed
pnpm --filter @ojt/desktop typecheck && pnpm lint
# 期待: どちらも無警告
```

- [x] **Step 8: commit**

```
git add apps/desktop/scripts/print-manual.mjs apps/desktop/src/main/manual.ts apps/desktop/src/main/ipc.ts apps/desktop/src/preload/index.ts apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/messages.ts apps/desktop/package.json apps/desktop/electron-builder.yml apps/desktop/scripts/check-dist.mjs apps/desktop/test/manual-ipc.test.ts apps/desktop/test/release-manual.test.ts docs/releases/v1.0.0.md docs/manual/coverage.json docs/manual/12-troubleshooting.md apps/desktop/src/renderer/help/manual-content.ts
git diff --cached --stat
git commit -m "feat(desktop): print the manual to pdf, ship it with both builds and open it from the app (Plan 6 Task 7)"
git show --stat HEAD
```

---

## Task 8: ヘルプの引き出し

**モデル: Opus**（フォーカストラップ・`Esc` の重なり順・8px 格子・本文の差し込み）

**Files:**
- Create: `apps/desktop/src/renderer/help/help-store.ts`
- Create: `apps/desktop/src/renderer/help/HelpDrawer.tsx`
- Create: `apps/desktop/src/renderer/help/help.module.css`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（新ブロック `JA.help` ＋ 関数1つ）
- Test: `apps/desktop/test/help-drawer.test.tsx`（新規）

本設計 §5.3・§5.4、決定表#14・#15・#28、本プラン 決定表 P8。

- [x] **Step 1: 失敗するテストを書く**

`apps/desktop/test/help-drawer.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpDrawer } from '../src/renderer/help/HelpDrawer.js';
import { useHelpStore } from '../src/renderer/help/help-store.js';
import { isModalOpen } from '../src/renderer/session/interaction.js';
import { JA } from '../src/renderer/i18n/ja.js';
import { MANUAL_IMAGES, MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';
import type { OjtApi } from '../src/shared/ipc.js';

/** ヘルプの引き出し。取扱説明書 設計 §5.3 / §5.4。 */

declare global {
  interface Window {
    ojt?: OjtApi;
  }
}

function setApi(api: Partial<OjtApi> | undefined): void {
  if (api === undefined) delete window.ojt;
  else window.ojt = api as OjtApi;
}

beforeEach(() => {
  act(() => {
    useHelpStore.getState().openHelp('home');
  });
});

afterEach(() => {
  cleanup();
  setApi(undefined);
  act(() => {
    useHelpStore.getState().closeHelp();
  });
});

describe('中身（設計 §5.3）', () => {
  it('opens the section of the screen it was opened from', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    expect(screen.getByTestId('help-section-title')).toHaveTextContent('このアプリでできること');
  });

  it('lists every chapter in the table of contents', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const contents = screen.getByTestId('help-contents');
    const chapters = new Set(MANUAL_SECTIONS.map((section) => section.chapterTitle));
    for (const title of chapters) expect(within(contents).getByText(title)).toBeInTheDocument();
  });

  it('shows another section when its button in the table of contents is pressed', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId('help-section-glossary/用語集'));
    expect(screen.getByTestId('help-section-title')).toHaveTextContent('用語集');
  });

  it('marks the section that is open', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    expect(screen.getByTestId('help-section-intro/このアプリでできること')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

describe('検索（設計 §5.3）', () => {
  it('lists the sections that contain the word', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: '自己保持' } });
    expect(screen.getAllByTestId('help-hit').length).toBeGreaterThan(0);
  });

  it('jumps to the section when a hit is pressed', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('help-search'), { target: { value: '用語集' } });
    fireEvent.click(screen.getAllByTestId('help-hit')[0] as HTMLElement);
    expect(screen.getByTestId('help-section-title')).toHaveTextContent('用語集');
    // 跳んだら一覧は消えて本文に戻る
    expect(screen.queryAllByTestId('help-hit')).toHaveLength(0);
  });

  it('says so when nothing matches', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('help-search'), {
      target: { value: 'そんな言葉はありません' },
    });
    expect(screen.getByText(JA.help.searchEmpty)).toBeInTheDocument();
  });
});

describe('閉じ方とキーボード（設計 §5.4）', () => {
  it('closes with the button, with Escape and with the backdrop', () => {
    const onClose = vi.fn();
    render(<HelpDrawer onClose={onClose} />);
    fireEvent.click(screen.getByTestId('help-close'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('help-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('counts as one modal layer while it is open', () => {
    const view = render(<HelpDrawer onClose={() => undefined} />);
    expect(isModalOpen()).toBe(true);
    view.unmount();
    expect(isModalOpen()).toBe(false);
  });

  it('puts the focus on the close button and gives it back afterwards', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const view = render(<HelpDrawer onClose={() => undefined} />);
    expect(document.activeElement).toBe(screen.getByTestId('help-close'));
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab inside the drawer', () => {
    render(<HelpDrawer onClose={() => undefined} />);
    const panel = screen.getByTestId('help-drawer');
    const focusable = panel.querySelectorAll<HTMLElement>('button, input');
    const last = focusable[focusable.length - 1];
    last?.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(panel.contains(document.activeElement)).toBe(true);
  });
});

describe('説明書（PDF）を開く（設計 §9）', () => {
  it('asks the main process to open it', async () => {
    const openManual = vi.fn().mockResolvedValue({ ok: true, path: 'C:\\manual.pdf' });
    setApi({ openManual });
    render(<HelpDrawer onClose={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('help-open-pdf'));
    });
    expect(openManual).toHaveBeenCalledTimes(1);
  });

  it('says so when the app cannot open it', async () => {
    setApi({ openManual: vi.fn().mockResolvedValue({ ok: false, message: 'だめでした' }) });
    render(<HelpDrawer onClose={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('help-open-pdf'));
    });
    expect(await screen.findByText('だめでした')).toBeInTheDocument();
  });
});

describe('図（利用者の決定 2026-09-20）', () => {
  it('fills in the reduced copy of every figure in the section', () => {
    act(() => {
      useHelpStore.getState().showSection('screens/ホームの画面');
    });
    render(<HelpDrawer onClose={() => undefined} />);
    const image = screen.getByTestId('help-prose').querySelector('img[data-manual-image="home"]');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('width')).toBe('400');
    expect(image?.getAttribute('src')).toBe(MANUAL_IMAGES['home']?.small);
  });

  it('opens the full size in an overlay when the figure is pressed', () => {
    act(() => {
      useHelpStore.getState().showSection('screens/ホームの画面');
    });
    render(<HelpDrawer onClose={() => undefined} />);
    const button = screen
      .getByTestId('help-prose')
      .querySelector<HTMLButtonElement>('button[data-manual-image="home"]');
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    expect(screen.getByTestId('help-figure-modal')).toBeInTheDocument();
    expect(screen.getByTestId('help-figure-full')).toHaveAttribute('src', MANUAL_IMAGES['home']?.full);
  });

  it('closes the overlay with Escape and gives the focus back to the figure', () => {
    act(() => {
      useHelpStore.getState().showSection('screens/ホームの画面');
    });
    render(<HelpDrawer onClose={() => undefined} />);
    const button = screen
      .getByTestId('help-prose')
      .querySelector<HTMLButtonElement>('button[data-manual-image="home"]');
    button?.focus();
    fireEvent.click(button as HTMLButtonElement);
    expect(document.activeElement).toBe(screen.getByTestId('help-figure-close'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('help-figure-modal')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe('文言（決定表#28）', () => {
  it('keeps every help string short enough to be chrome, never prose', () => {
    for (const [key, value] of Object.entries(JA.help)) {
      expect(typeof value, `${key} は文字列であること`).toBe('string');
      expect((value as string).length, `JA.help.${key} が長すぎます`).toBeLessThanOrEqual(40);
    }
  });
});
```

**注記**: 最後の2つのテストはトーストを `screen.findByText` で探す。トーストは `App.tsx` が描くので、この結合テストでは `HelpDrawer` がトーストを積んだことを**ストア経由で**確かめる形に読み替えてよい（`useStore.getState().toasts` に文言が入ったことを見る）。どちらでもよいが、**片方に決めて両方のテストで同じにする**こと。

期待（Step 4 のあと）: **17件通る**。

- [x] **Step 2: 文言を足す**

`apps/desktop/src/renderer/i18n/ja.ts` の `JA` の末尾（`schematicView` の後ろ）に足す:

```ts
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
    pdfMissing: '説明書（PDF）が見つかりません。もくじから同じ内容を読めます。',
    shortcutHint: 'F1 でいつでも開けます',
    // 図（利用者の決定 2026-09-20）
    enlarge: '図を大きく見る',
    figureClose: '図を閉じる',
  },
  // --- /Plan 6 Task 8 ---
```

`JA` の閉じ括弧の後ろ（関数が並ぶところ）に足す:

```ts
// --- Plan 6 Task 8 ---
/** 検索で当たった件数。 */
export function helpHitCountText(count: number): string {
  return `${String(count)} 件見つかりました`;
}
// --- /Plan 6 Task 8 ---
```

- [x] **Step 3: ストアを作る**

`apps/desktop/src/renderer/help/help-store.ts`:

```ts
import { create } from 'zustand';
import { defaultSectionId, type HelpScreenId } from './help-model.js';

/**
 * ヘルプの状態。取扱説明書 設計 決定表#14。
 *
 * `app/store.ts` に置かないのは、ヘルプが課題ともセッションとも関わらないからである。
 * 向こうへ足すと `openProblem()` / `resetSession()` / `restartSession()` / `abandonSession()`
 * の4箇所すべてに初期値を入れて回る必要があり、入れ忘れが1つあるだけで課題をまたいで
 * 状態が残る（Plan 5 の MERGE 注意#2 が挙げた罠）。ヘルプは課題が変わっても
 * そのままでよいので、分けたほうが正しい。
 */
export interface HelpState {
  /** 引き出しが開いているか。 */
  open: boolean;
  /** いま読んでいる節。 */
  sectionId: string;
  /** 検索欄の中身（空なら本文を出す）。 */
  query: string;
  openHelp: (screen: HelpScreenId) => void;
  toggleHelp: (screen: HelpScreenId) => void;
  closeHelp: () => void;
  showSection: (sectionId: string) => void;
  setQuery: (query: string) => void;
}

export const useHelpStore = create<HelpState>((set, get) => ({
  open: false,
  sectionId: defaultSectionId('home'),
  query: '',
  openHelp: (screen) => {
    // 開くたびに「いまの画面の節」に戻し、前の検索語は消す（§5.2）
    set({ open: true, sectionId: defaultSectionId(screen), query: '' });
  },
  toggleHelp: (screen) => {
    if (get().open) set({ open: false });
    else set({ open: true, sectionId: defaultSectionId(screen), query: '' });
  },
  closeHelp: () => {
    set({ open: false });
  },
  showSection: (sectionId) => {
    // 節へ跳んだら検索の一覧は畳む（§5.3）
    set({ sectionId, query: '' });
  },
  setQuery: (query) => {
    set({ query });
  },
}));
```

- [x] **Step 4: 引き出しを作る**

`apps/desktop/src/renderer/help/HelpDrawer.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { tryOjtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { helpHitCountText, JA } from '../i18n/ja.js';
import { pushModalLayer, topModalLayer } from '../session/interaction.js';
import { searchManual, sectionById } from './help-model.js';
import { useHelpStore } from './help-store.js';
import { MANUAL_CHAPTERS, MANUAL_IMAGES } from './manual-content.js';
import styles from './help.module.css';

/**
 * 取扱説明書の引き出し。取扱説明書 設計 §5.3 / §5.4。
 *
 * 本文は `manual-content.ts`（生成物）から来る。差し込む文字列は**ビルド時に
 * このリポジトリの Markdown から作ったもの**だけで、課題JSONも利用者の入力も混ざらない。
 * 変換は `html: false` で走らせているので、原稿に生の HTML を書いても escape されている
 * （本プラン 決定表 P8）。正本と生成物の一致は `manual-sync.test.ts` が毎回証明する。
 */

/** 引き出しの中だけで `Tab` を回す（`ChartModal` と同じ作法）。 */
function trapFocus(panel: HTMLElement | null, event: KeyboardEvent): void {
  if (panel === null) return;
  const focusable = [
    ...panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hasAttribute('disabled'));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** ヘルプの引き出し。 */
export function HelpDrawer({ onClose }: { onClose: () => void }): JSX.Element {
  const sectionId = useHelpStore((s) => s.sectionId);
  const query = useHelpStore((s) => s.query);
  const showSection = useHelpStore((s) => s.showSection);
  const setQuery = useHelpStore((s) => s.setQuery);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const section = sectionById(sectionId);
  const hits = useMemo(() => searchManual(query), [query]);
  const proseRef = useRef<HTMLDivElement>(null);
  /** 覆いで開いている図の名前（利用者の決定 2026-09-20）。 */
  const [enlarged, setEnlarged] = useState<string | undefined>(undefined);

  /*
   * 本文を差し込んだあとに図の `src` を入れる（決定表 P16）。
   * 束ねた図の URL（内容ハッシュ付き）は Vite が決めるので、生成物には書けない。
   * まだ撮っていない図は `MANUAL_IMAGES` の項目が空文字なので、`src` を入れず CSS が隠す。
   */
  useEffect(() => {
    const root = proseRef.current;
    if (root === null) return;
    for (const image of root.querySelectorAll<HTMLImageElement>('img[data-manual-image]')) {
      const name = image.dataset['manualImage'] ?? '';
      const small = MANUAL_IMAGES[name]?.small ?? '';
      if (small === '') image.removeAttribute('src');
      else image.src = small;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-manual-image]')) {
      const name = button.dataset['manualImage'] ?? '';
      const full = MANUAL_IMAGES[name]?.full ?? '';
      // 撮っていない図のボタンは押させない（押しても何も出ないボタンを残さない）
      button.disabled = full === '';
      button.title = full === '' ? '' : JA.help.enlarge;
    }
  }, [sectionId, query]);

  /*
   * 図のボタンは生成物の HTML の中にあるので React の `onClick` を付けられない。
   * 本文の囲みで1回だけ受けて、押された図の名前を拾う（`Enter` / `Space` も
   * `<button>` なのでブラウザが `click` に直してくれる）。
   */
  const onProseClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button[data-manual-image]');
    const name = button?.dataset['manualImage'];
    if (name === undefined) return;
    if ((MANUAL_IMAGES[name]?.full ?? '') === '') return;
    setEnlarged(name);
  };

  /*
   * モーダル1枚として積む。積んでおかないと、盤やラダーのショートカット
   * （`Delete` で電線が消える、`3` で視点が飛ぶ）が引き出しの上から効いてしまう。
   */
  useEffect(() => {
    const layer = pushModalLayer();
    const openedFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (layer.depth !== topModalLayer()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') trapFocus(panelRef.current, event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      layer.release();
      openedFrom?.focus();
    };
  }, [onClose]);

  const openPdf = (): void => {
    const toast = useStore.getState().toast;
    const api = tryOjtApi();
    if (api === undefined || typeof api.openManual !== 'function') {
      toast(JA.help.pdfMissing, 'warn');
      return;
    }
    void api.openManual().then(
      (result) => {
        if (!result.ok) toast(result.message, 'warn');
      },
      () => {
        toast(JA.help.pdfMissing, 'warn');
      },
    );
  };

  return createPortal(
    <div className={styles.backdrop} role="presentation" data-testid="help-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={JA.help.title}
        data-testid="help-drawer"
        onClick={(event) => {
          // 背面を押したときだけ閉じる
          event.stopPropagation();
        }}
      >
        <div className={styles.header}>
          <span className={styles.title}>{JA.help.title}</span>
          <button type="button" data-testid="help-open-pdf" onClick={openPdf}>
            {JA.help.openPdf}
          </button>
          <button type="button" ref={closeRef} data-testid="help-close" onClick={onClose}>
            {JA.help.close}
          </button>
        </div>
        <div className={styles.searchRow}>
          <label className={styles.searchLabel} htmlFor="help-search">
            {JA.help.searchLabel}
          </label>
          <input
            id="help-search"
            type="search"
            data-testid="help-search"
            placeholder={JA.help.searchPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <div className={styles.body}>
          <nav className={styles.contents} data-testid="help-contents" aria-label={JA.help.contents}>
            {MANUAL_CHAPTERS.map((chapter) => (
              <details key={chapter.id} open={chapter.sectionIds.includes(sectionId)}>
                <summary>{chapter.title}</summary>
                <ul>
                  {chapter.sectionIds.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        data-testid={`help-section-${id}`}
                        aria-current={id === sectionId ? 'true' : undefined}
                        onClick={() => {
                          showSection(id);
                        }}
                      >
                        {sectionById(id)?.title ?? id}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </nav>
          <div className={styles.article}>
            {query.trim() === '' ? (
              <>
                <h2 className={styles.sectionTitle} data-testid="help-section-title">
                  {section?.title ?? ''}
                </h2>
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 図のボタンは生成物の中にある */}
                <div
                  ref={proseRef}
                  className={styles.prose}
                  data-testid="help-prose"
                  onClick={onProseClick}
                  dangerouslySetInnerHTML={{ __html: section?.html ?? '' }}
                />
              </>
            ) : hits.length === 0 ? (
              <p className={styles.empty}>{JA.help.searchEmpty}</p>
            ) : (
              <>
                <p className={styles.hitCount}>{helpHitCountText(hits.length)}</p>
                <ul className={styles.hits}>
                  {hits.map((hit) => (
                    <li key={hit.sectionId}>
                      <button
                        type="button"
                        data-testid="help-hit"
                        onClick={() => {
                          showSection(hit.sectionId);
                        }}
                      >
                        <span className={styles.hitChapter}>{hit.chapterTitle}</span>
                        <span className={styles.hitTitle}>{hit.title}</span>
                        <span className={styles.hitExcerpt}>{hit.excerpt}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
        <p className={styles.footer}>{JA.help.shortcutHint}</p>
        {enlarged === undefined ? null : (
          <FigureOverlay
            name={enlarged}
            onClose={() => {
              setEnlarged(undefined);
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 図の原寸を覆いで出す（利用者の決定 2026-09-20）。
 * 引き出しの上にもう1枚積むので、`Esc` は**この覆いだけ**を閉じる（`topModalLayer()` で見分ける）。
 * 閉じると、開くのに押した図のボタンへ焦点が戻る。
 */
function FigureOverlay({ name, onClose }: { name: string; onClose: () => void }): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const caption = MANUAL_IMAGES[name]?.full ?? '';

  useEffect(() => {
    const layer = pushModalLayer();
    const openedFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (layer.depth !== topModalLayer()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'Tab') trapFocus(panelRef.current, event);
    };
    // 引き出し側の listener より先に受けるため、捕まえ段階で登録する
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      layer.release();
      openedFrom?.focus();
    };
  }, [onClose]);

  return (
    <div
      className={styles.figureBackdrop}
      role="presentation"
      data-testid="help-figure-backdrop"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={styles.figurePanel}
        role="dialog"
        aria-modal="true"
        aria-label={JA.help.enlarge}
        data-testid="help-figure-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <img src={caption} alt={name} data-testid="help-figure-full" />
        <button type="button" ref={closeRef} data-testid="help-figure-close" onClick={onClose}>
          {JA.help.figureClose}
        </button>
      </div>
    </div>
  );
}
```

`apps/desktop/src/renderer/help/help.module.css`（余白はすべて4の倍数）:

```css
/* ヘルプの引き出し。取扱説明書 設計 §5.3 / §5.4。余白は 8px 格子（4の倍数）。 */

.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(20 24 31 / 32%);
  display: flex;
  justify-content: flex-end;
  z-index: 40;
}

.drawer {
  width: 420px;
  max-width: 100vw;
  height: 100%;
  background: #ffffff;
  border-left: 1px solid #9aa5b4;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 24px rgb(20 24 31 / 16%);
}

@media (max-width: 1100px) {
  .drawer {
    width: 100vw;
    border-left: none;
  }
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #9aa5b4;
}

.title {
  flex: 1;
  font-weight: 700;
  font-size: 16px;
}

.searchRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #cdd5e0;
}

.searchLabel {
  font-size: 12px;
  color: #3c4654;
  white-space: nowrap;
}

.searchRow input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
}

.body {
  flex: 1;
  display: grid;
  grid-template-columns: 148px 1fr;
  min-height: 0;
}

.contents {
  overflow: auto;
  padding: 8px;
  border-right: 1px solid #cdd5e0;
  font-size: 12px;
}

.contents summary {
  cursor: pointer;
  padding: 4px;
  font-weight: 700;
}

.contents ul {
  list-style: none;
  margin: 0;
  padding: 0 0 0 8px;
}

.contents button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px;
  border: none;
  background: none;
  cursor: pointer;
  color: #14181f;
}

.contents button[aria-current='true'] {
  background: #eef2f7;
  font-weight: 700;
}

.article {
  overflow: auto;
  padding: 16px;
  min-width: 0;
}

.sectionTitle {
  margin: 0 0 12px;
  font-size: 16px;
}

.prose {
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.prose table {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
}

.prose th,
.prose td {
  border: 1px solid #9aa5b4;
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
}

.prose th {
  background: #eef2f7;
}

.prose code {
  background: #eef2f7;
  padding: 0 4px;
}

/* 図（利用者の決定 2026-09-20）。本文には幅400pxの縮小版を出し、押すと原寸が覆いで開く。 */
.prose :global(.manual-figure) {
  margin: 12px 0;
}

.prose :global(.manual-figure button) {
  display: block;
  padding: 0;
  border: 1px solid #9aa5b4;
  background: none;
  cursor: zoom-in;
  max-width: 100%;
}

.prose :global(.manual-figure button:focus-visible) {
  outline: 2px solid #1e64ff;
  outline-offset: 2px;
}

.prose :global(.manual-figure img) {
  display: block;
  width: 100%;
  height: auto;
}

/* `src` が空の図（まだ撮っていない）は枠ごと出さない */
.prose :global(.manual-figure img:not([src])),
.prose :global(.manual-figure img[src='']) {
  display: none;
}

.prose :global(.manual-figure figcaption) {
  font-size: 11px;
  color: #3c4654;
  margin-top: 4px;
}

.figureBackdrop {
  position: fixed;
  inset: 0;
  background: rgb(20 24 31 / 72%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  z-index: 60;
}

.figurePanel {
  max-width: 96vw;
  max-height: 88vh;
  background: #ffffff;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.figurePanel img {
  max-width: 100%;
  max-height: 76vh;
  object-fit: contain;
}

.figurePanel figcaption {
  font-size: 12px;
  color: #3c4654;
}

.figurePanel button:focus-visible {
  outline: 2px solid #1e64ff;
  outline-offset: 2px;
}

.hits {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hits button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px;
  margin-bottom: 8px;
  border: 1px solid #cdd5e0;
  background: #ffffff;
  cursor: pointer;
}

.hitChapter {
  display: block;
  font-size: 11px;
  color: #3c4654;
}

.hitTitle {
  display: block;
  font-weight: 700;
  font-size: 13px;
}

.hitExcerpt {
  display: block;
  font-size: 12px;
  color: #3c4654;
}

.hitCount,
.empty {
  font-size: 12px;
  color: #3c4654;
  margin: 0 0 8px;
}

.footer {
  margin: 0;
  padding: 8px 16px;
  border-top: 1px solid #cdd5e0;
  font-size: 11px;
  color: #3c4654;
}

.header button:focus-visible,
.contents button:focus-visible,
.hits button:focus-visible,
.searchRow input:focus-visible {
  outline: 2px solid #1e64ff;
  outline-offset: 2px;
}
```

- [x] **Step 5: 機能一覧表に引き出しの操作要素を足す**

引き出しを作ると `data-testid` が11個増えるので、`docs/manual/coverage.json` の `controls` に足す。足さないと Task 1 の `feature-inventory.test.ts` が「機能一覧表に無い」と言って落ちる（それが狙いの仕組みである）。

```json
  { "testid": "help-drawer", "screen": "全画面", "label": "取扱説明書", "section": "screens/画面の上の帯" },
  { "testid": "help-close", "screen": "全画面", "label": "閉じる", "section": "screens/画面の上の帯" },
  { "testid": "help-open-pdf", "screen": "全画面", "label": "説明書（PDF）を開く", "section": "screens/画面の上の帯" },
  { "testid": "help-search", "screen": "全画面", "label": "言葉で探す", "section": "screens/画面の上の帯" },
  { "testid": "help-contents", "screen": "全画面", "label": "もくじ", "section": "screens/画面の上の帯" },
  { "testid": "help-hit", "screen": "全画面", "label": "件見つかりました", "section": "screens/画面の上の帯" },
  { "testid": "help-section-{}", "internal": "もくじの1行ずつの目印。もくじそのものを説明済み" },
  { "testid": "help-section-title", "internal": "本文の見出しの目印。画面に別の操作は無い" },
  { "testid": "help-prose", "internal": "本文そのものの目印。画面に別の操作は無い" },
  { "testid": "help-backdrop", "internal": "引き出しの外側。押すと閉じることは「閉じる」で説明済み" },
  { "testid": "help-figure-modal", "screen": "全画面", "label": "図を大きく見る", "section": "screens/画面の上の帯" },
  { "testid": "help-figure-close", "screen": "全画面", "label": "図を閉じる", "section": "screens/画面の上の帯" },
  { "testid": "help-figure-full", "internal": "大きくした図そのもの。押す操作は無い" },
  { "testid": "help-figure-backdrop", "internal": "大きくした図の外側。「図を閉じる」で説明済み" }
```

`screens/画面の上の帯` の本文に、これらの言葉（「取扱説明書」「もくじ」「言葉で探す」「説明書（PDF）を開く」「閉じる」「件見つかりました」「図を大きく見る」「図を閉じる」）が出るように書き足す。あわせて「**ヘルプの中の図を押すか `Enter` を押すと大きく出せます。`Esc` でもとに戻ります。**」の1文を入れる（利用者の決定 2026-09-20）。

- [x] **Step 6: テストを通す**

```
pnpm --filter @ojt/desktop test help-drawer feature-inventory manual-coverage
# 期待: Test Files 3 passed / Tests 17 + 6 + 8 passed
pnpm --filter @ojt/desktop typecheck && pnpm lint
# 期待: どちらも無警告
```

- [x] **Step 7: commit**

```
git add apps/desktop/src/renderer/help/help-store.ts apps/desktop/src/renderer/help/HelpDrawer.tsx apps/desktop/src/renderer/help/help.module.css apps/desktop/test/help-drawer.test.tsx docs/manual/coverage.json docs/manual/02-screens.md apps/desktop/src/renderer/help/manual-content.ts
git diff --cached --stat
# `i18n/ja.ts` は共有ファイルなので、自分の差分だけを当て直す（MERGE 注意#1）
git diff -- apps/desktop/src/renderer/i18n/ja.ts > "$TEMP/plan6-task8-ja.patch"
git apply --cached "$TEMP/plan6-task8-ja.patch"
git diff --cached --stat
git commit -m "feat(desktop): open the manual in a drawer with a table of contents and a search box (Plan 6 Task 8)"
git show --stat HEAD
```

---

## Task 9: 全画面からの導線と `F1`

**モデル: Opus**（窓口の `F1` とモードDの `F1` の調停、5画面への差し込み）

**Files:**
- Create: `apps/desktop/src/renderer/help/HelpRoot.tsx`
- Create: `apps/desktop/src/renderer/help/HelpButton.tsx`
- Modify: `apps/desktop/src/renderer/app/App.tsx`
- Modify: `apps/desktop/src/renderer/panels/Toolbar.tsx`
- Modify: `apps/desktop/src/renderer/screens/Home.tsx` / `ProblemList.tsx` / `Settings.tsx` / `Result.tsx`
- Modify: `apps/desktop/src/renderer/screens/screens.module.css`
- Modify: `apps/desktop/src/renderer/ladder/LadderEditor.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（`JA.ladder.helpHint` を消す）
- Modify: `docs/manual/coverage.json`（`open-help` の1行）
- Test: `apps/desktop/test/help-entry.test.tsx`（新規）

本設計 §5.1、決定表#16・#17。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/help-entry.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpRoot } from '../src/renderer/help/HelpRoot.js';
import { useHelpStore } from '../src/renderer/help/help-store.js';
import { useStore } from '../src/renderer/app/store.js';
import { JA } from '../src/renderer/i18n/ja.js';

/** どの画面からもヘルプへ行けること。取扱説明書 設計 §5.1 / 決定表#16・#17。 */

afterEach(() => {
  cleanup();
  act(() => {
    useHelpStore.getState().closeHelp();
    useStore.getState().setRoute('home');
  });
});

describe('F1（決定表#17）', () => {
  it('opens the drawer from anywhere', () => {
    render(<HelpRoot />);
    expect(screen.queryByTestId('help-drawer')).toBeNull();
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByTestId('help-drawer')).toBeInTheDocument();
  });

  it('closes it when pressed again', () => {
    render(<HelpRoot />);
    fireEvent.keyDown(window, { key: 'F1' });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.queryByTestId('help-drawer')).toBeNull();
  });

  it('opens even while typing in a text box', () => {
    render(<HelpRoot />);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'F1', bubbles: true });
    expect(screen.getByTestId('help-drawer')).toBeInTheDocument();
    input.remove();
  });

  it('leaves F1 alone when something else already handled it (決定表#16)', () => {
    render(<HelpRoot />);
    const event = new KeyboardEvent('keydown', { key: 'F1', cancelable: true, bubbles: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(screen.queryByTestId('help-drawer')).toBeNull();
  });

  it('opens the section of the screen it was pressed on', () => {
    render(<HelpRoot />);
    act(() => {
      useStore.getState().setRoute('settings');
    });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByTestId('help-section-title')).toHaveTextContent('設定の画面');
  });

  it('opens the list section from the problem list', () => {
    render(<HelpRoot />);
    act(() => {
      useStore.getState().setRoute('list');
    });
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByTestId('help-section-title')).toHaveTextContent('課題をえらぶ');
  });
});

describe('ヘルプのボタン（設計 §5.1）', () => {
  it('opens the drawer', () => {
    render(<HelpRoot />);
    render(<HelpButtonHarness />);
    fireEvent.click(screen.getByTestId('open-help'));
    expect(screen.getByTestId('help-drawer')).toBeInTheDocument();
  });

  it('is labelled with the word the manual uses', () => {
    render(<HelpButtonHarness />);
    expect(screen.getByTestId('open-help')).toHaveTextContent(JA.help.open);
  });

  it('closes the drawer with Escape', () => {
    render(<HelpRoot />);
    fireEvent.keyDown(window, { key: 'F1' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('help-drawer')).toBeNull();
  });
});

/** ボタン単体を置くための小さな枠（画面ごとの差し込みは E2E が見る）。 */
function HelpButtonHarness(): JSX.Element {
  return <HelpButton />;
}
```

`import { HelpButton } from '../src/renderer/help/HelpButton.js';` と `import type { JSX } from 'react';` を足す。

期待（Step 4 のあと）: **9件通る**。

- [ ] **Step 2: ボタンと窓口を作る**

`apps/desktop/src/renderer/help/HelpButton.tsx`:

```tsx
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { useHelpStore } from './help-store.js';
import { useStore } from '../app/store.js';
import { currentHelpScreen } from './help-model.js';

/**
 * どの画面にも置く「ヘルプ」ボタン。取扱説明書 設計 §5.1。
 * どの節を開くかはボタンが決めず、**いまの画面**から決める（決定表#18）ので、
 * 置く側は `<HelpButton />` と書くだけでよい。
 */
export function HelpButton({ className }: { className?: string }): JSX.Element {
  const openHelp = useHelpStore((s) => s.openHelp);
  const route = useStore((s) => s.route);
  const mode = useStore((s) => s.problem?.mode);
  const assembleView = useStore((s) => s.assembleView);
  return (
    <button
      type="button"
      className={className}
      data-testid="open-help"
      title={JA.help.shortcutHint}
      onClick={() => {
        openHelp(currentHelpScreen(route, mode, assembleView));
      }}
    >
      {JA.help.open}
    </button>
  );
}
```

`apps/desktop/src/renderer/help/HelpRoot.tsx`:

```tsx
import { useEffect, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { currentHelpScreen } from './help-model.js';
import { useHelpStore } from './help-store.js';
import { HelpDrawer } from './HelpDrawer.js';

/**
 * `F1` の窓口と引き出しの出し入れ。取扱説明書 設計 §5.1 / 決定表#16・#17。
 *
 * `App.tsx` に1つだけ置く。`shouldIgnoreShortcut()` は**通さない**——`F1` は文字入力に
 * 使わないキーなので取り違えが起きず、「デバイス名を打ち込んでいる最中に書き方が
 * 分からない」ときこそ開きたいからである（決定表#17）。
 *
 * モードDのラダー編集も `F1` を持っている（スキンのキー割当表の `help`）。あちらは
 * React の `onKeyDown` で、窓口の listener より**先に**走る。あちらが処理したら
 * `preventDefault()` するので、ここは `defaultPrevented` を見て何もしない（決定表#16）。
 */
export function HelpRoot(): JSX.Element | null {
  const open = useHelpStore((s) => s.open);
  const closeHelp = useHelpStore((s) => s.closeHelp);
  const route = useStore((s) => s.route);
  const mode = useStore((s) => s.problem?.mode);
  const assembleView = useStore((s) => s.assembleView);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'F1') return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      useHelpStore.getState().toggleHelp(currentHelpScreen(route, mode, assembleView));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [route, mode, assembleView]);

  if (!open) return null;
  return <HelpDrawer onClose={closeHelp} />;
}
```

- [ ] **Step 3: 5つの画面に差し込む**

`App.tsx`: `<div className={styles.toasts}>` の**直前**に1行（`ErrorBoundary` の外に置く。引き出しの中で例外が出ても、引き出しごと消えてバナーまで消えることがないようにする）。

```tsx
      <HelpRoot />
```

`panels/Toolbar.tsx`: `.toolbarScroll` の中、`session-back` のボタンの**直後**に1つ。これで4つのセッション画面（モードB・C1・C2・D）すべてに同じ位置で出る。

```tsx
        <HelpButton />
```

`screens/Home.tsx`: `styles.homeHeader` の中、`open-settings` のボタンの**直前**に1つ。

```tsx
        <HelpButton className={styles.homeSettings} />
```

`screens/ProblemList.tsx` と `screens/Settings.tsx`: 「もどる」のボタンと `<h1>` のあいだに囲みを1つ作り、「もどる」を中へ移してボタンを並べる。

```tsx
      <div className={styles.screenHeader}>
        {/* 既存の「もどる」ボタンをそのままここへ移す */}
        <HelpButton />
      </div>
```

`screens/Result.tsx`: 4つの結果の画面（`ResultView` / `InspectPartsResult` / `InspectRepairResult` / `PlcResult`）のどれを描くかを決めている `return` の直前で、共通の囲みに包む。4つの部品そのものは1行も変えない。

```tsx
  return (
    <>
      <div className={styles.screenHeader}>
        <HelpButton />
      </div>
      {/* 既存の分岐をそのまま中へ入れる */}
    </>
  );
```

`screens/screens.module.css` の末尾に足す:

```css
/* 画面の見出しの横に置くボタンの列（Plan 6 Task 9）。余白は 8px 格子。 */
.screenHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
```

- [ ] **Step 4: モードDの `F1` を調停する**

`ladder/LadderEditor.tsx` の `action === 'help'` の分岐を差し替える。いまは `store.toast(JA.ladder.helpHint)` を出しているだけなので、**引き出しを開いて `preventDefault()` する**。

```tsx
      case 'help':
        // §10.6 の「F1 ヘルプ」。取扱説明書の引き出しをモードDの節で開く（取扱説明書 設計 決定表#16）。
        // 止めておかないと、窓口（`HelpRoot`）の F1 も走って開いた直後に閉じる
        event.preventDefault();
        event.stopPropagation();
        useHelpStore.getState().openHelp('plc');
        break;
```

`import { useHelpStore } from '../help/help-store.js';` を足し、`JA.ladder.helpHint` の参照を消す。

`i18n/ja.ts` の `JA.ladder` から `helpHint` の行（とその上のコメント）を消す。使われなくなるので残すと lint と「文言の出どころ」の規律に反する。

**注記**: `event` はここでは React の合成イベントである。`stopPropagation()` は下の本物のイベントにも伝わるので、`window` の listener には届かない。`preventDefault()` も併せて呼ぶのは、万一伝播の経路が変わっても `defaultPrevented` で弾けるようにするためである（二重の守り）。

- [ ] **Step 5: 機能一覧表に1行足す**

```json
  { "testid": "open-help", "screen": "全画面", "label": "ヘルプ", "section": "screens/画面の上の帯" }
```

- [ ] **Step 6: テストを通す**

```
cd apps/desktop && node scripts/build-manual.mjs
pnpm --filter @ojt/desktop test help-entry feature-inventory manual-coverage ladder-editor
# 期待: すべて通る（`ladder-editor.test.tsx` は `helpHint` のトーストを見ていた箇所を直す）
pnpm --filter @ojt/desktop test
# 期待: すべて通る
pnpm --filter @ojt/desktop typecheck && pnpm lint
# 期待: どちらも無警告
```

- [ ] **Step 7: commit**

```
git add apps/desktop/src/renderer/help/HelpRoot.tsx apps/desktop/src/renderer/help/HelpButton.tsx apps/desktop/src/renderer/app/App.tsx apps/desktop/src/renderer/panels/Toolbar.tsx apps/desktop/src/renderer/screens/Home.tsx apps/desktop/src/renderer/screens/ProblemList.tsx apps/desktop/src/renderer/screens/Settings.tsx apps/desktop/src/renderer/screens/Result.tsx apps/desktop/src/renderer/screens/screens.module.css apps/desktop/src/renderer/ladder/LadderEditor.tsx apps/desktop/test/help-entry.test.tsx docs/manual/coverage.json
git diff -- apps/desktop/src/renderer/i18n/ja.ts > "$TEMP/plan6-task9-ja.patch"
git apply --cached "$TEMP/plan6-task9-ja.patch"
git diff --cached --stat
git commit -m "feat(desktop): reach the manual with F1 and a help button on every screen (Plan 6 Task 9)"
git show --stat HEAD
```

---

## Task 10: コードが持つ表と説明書の一致

**モデル: Sonnet-verbatim**（本書のテストをそのまま書き写し、落ちた行を説明書に足す）

**Files:**
- Test: `apps/desktop/test/manual-appdata.test.ts`（新規）
- Modify: `docs/manual/04-mode-c1.md` / `06-mode-d.md` / `09-settings.md` / `00-intro.md` / `12-troubleshooting.md`

本設計 §5.5、決定表#10・#11。**利用者要求「説明書とヘルプの内容は一致していること」の、場所別ヘルプ側の担保。**

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/manual-appdata.test.ts`:

```ts
import { DIAGNOSIS_TABLE } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { MANUAL_SECTIONS } from '../src/renderer/help/manual-content.js';
import { JA } from '../src/renderer/i18n/ja.js';

/**
 * コードが持っている表・文言と、説明書の一致。取扱説明書 設計 §5.5 / 決定表#10・#11。
 *
 * 判定表もキー割当も設定の説明文も、**実体はコード側にある**（アプリの動作そのものが
 * 使っているデータだから）。説明書はそれを写して載せ、このテストが1行ずつ照らす。
 * どちらを直しても、直していないほうが落ちる。
 */

const TEXT_BY_ID = new Map(MANUAL_SECTIONS.map((section) => [section.id, section.text]));

function textOf(id: string): string {
  const text = TEXT_BY_ID.get(id);
  expect(text, `節 ${id} がありません`).toBeDefined();
  return text ?? '';
}

describe('C1 の判定表（§9.1）', () => {
  const section = () => textOf('mode-c1/不良の見分け方');

  it('has as many rows as the app shows', () => {
    expect(DIAGNOSIS_TABLE.length).toBe(7);
  });

  it.each(DIAGNOSIS_TABLE.map((row) => [row.situation, row.cause] as const))(
    'writes the row "%s" into the manual',
    (situation, cause) => {
      expect(section()).toContain(situation);
      expect(section()).toContain(cause);
    },
  );
});

describe('モードD のキー割当（§10.6）', () => {
  const section = () => textOf('mode-d/キーの割り当て');

  it('writes every key of every vendor into the manual', async () => {
    const dialects = await import('@ojt/plc-dialects');
    const missing: string[] = [];
    for (const id of dialects.DIALECT_IDS) {
      for (const entry of dialects.profileOf(id).shortcuts) {
        if (!section().includes(entry.keys)) missing.push(`${id}: ${entry.keys}`);
        if (!section().includes(entry.label)) missing.push(`${id}: ${entry.label}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('設定の説明文（§12.1）', () => {
  const section = () => textOf('settings/設定の画面');

  it.each([
    ['userContentHelp', JA.settings.userContentHelp],
    ['vendorHelp', JA.settings.vendorHelp],
    ['monitorColorHelp', JA.settings.monitorColorHelp],
  ])('writes %s into the manual word for word', (_name, text) => {
    expect(section()).toContain(text);
  });

  it('writes the ladder column hint too', () => {
    // 引数で数が変わるので、変わらない部分だけを見る
    const sample = JA.settings.gridColsHelp(11);
    const fixed = sample.replace(/\d+/gu, '');
    for (const piece of fixed.split(/\s+/u).filter((part) => part.length >= 4)) {
      expect(section()).toContain(piece);
    }
  });
});

describe('商標と表記の断り（§15 / §17.1）', () => {
  it('writes the trademark notice word for word', () => {
    expect(textOf('intro/商標と表記について')).toContain(JA.settings.trademarkNotice);
  });

  it('writes the assumption notice word for word', () => {
    expect(textOf('troubleshooting/命令名やキーの割り当てについてのお断り')).toContain(
      JA.settings.assumptionNotice,
    );
  });
});
```

**注記**: `DIALECT_IDS` と `profileOf` の名前は `@ojt/plc-dialects` の実ソースで確かめる。違っていたら、**そのパッケージが実際に輸出している名前**を使う（4方言のプロファイルを1つずつ取れれば、書き方は何でもよい）。`DiagnosisRow` の欄の名前（`situation` / `cause`）も同じく `packages/content/src/inspect-parts.ts` で確かめる。

期待: `it.each` を含めて **7つの検査項目**。

- [ ] **Step 2: 落ちた行を説明書に足す**

```
pnpm --filter @ojt/desktop test manual-appdata
```

落ちたものを、それぞれの節に**そのまま**書き足す。

1. 判定表の7行 → `04-mode-c1.md` の「不良の見分け方」に3列の表として（`| チェックしたこと | こわれ方 |` に `situation` と `cause` を写す）。
2. キー割当 → `06-mode-d.md` の「キーの割り当て」にメーカー別4表（`| キー | できること |` に `keys` と `label` を写す）。
3. 設定の説明文 → `09-settings.md` の「設定の画面」に、各行の説明として引用。
4. 商標注記 → `00-intro.md` の「商標と表記について」に引用。
5. 表記の断り → `12-troubleshooting.md` の「命令名やキーの割り当てについてのお断り」に引用。

**注意**: 引用した文に禁止語が入っていると `manual-style.test.ts` が落ちる。`JA.settings.*Help` と商標注記は日常語で書かれているので入らないはずだが、落ちたら `style.json` の `exempt` にその章を足すのではなく、**引用をやめずに `banned` からその語を外す**かどうかをレビューで決める（黙って例外を増やさない）。

- [ ] **Step 3: テストを通す**

```
cd apps/desktop && node scripts/build-manual.mjs
pnpm --filter @ojt/desktop test manual-
# 期待: Test Files 6 passed（build / sync / style / coverage / shots / appdata）
pnpm --filter @ojt/desktop typecheck && pnpm lint
```

- [ ] **Step 4: commit**

```
git add apps/desktop/test/manual-appdata.test.ts docs/manual apps/desktop/src/renderer/help/manual-content.ts
git diff --cached --stat
git commit -m "test(desktop): keep the manual and the in-place helps saying the same thing (Plan 6 Task 10)"
git show --stat HEAD
```

---

## Task 11: E2E と全体検証

**モデル: Opus**（E2E の待ち方と、フェーズ全体の見直し）

**Files:**
- Create: `apps/desktop/e2e/help.spec.ts`
- Modify: 検証で見つかった細かい直し

本設計 §11 の受入基準①②③⑥。**図は見ない**（Task 12 の仕事）。

- [ ] **Step 1: E2E を書く**

`apps/desktop/e2e/help.spec.ts`:

```ts
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * ヘルプと取扱説明書の E2E。§16 Phase 6 受入基準①②③⑥。
 *
 * **「説明書（PDF）を開く」は押さない**（本プラン 決定表 P9）。押すと OS の既定の
 * PDF ビューアが本当に起動し、CI でもレビュー中でも閉じられない。ここが確かめるのは
 * 「ボタンが出ていて押せること」と「渡す PDF が実在すること」までで、`shell.openPath()`
 * の3分岐は `test/manual-ipc.test.ts` が縛っている。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROMIUM_FLAGS = ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

test.describe('ヘルプ', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      window.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
      window.show();
      window.focus();
    });
    await page.waitForTimeout(1500);
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) await page.getByRole('button', { name: '復元しない' }).click();
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('受入基準①: F1 でどの画面でもヘルプが開き、その画面の節が出る', async () => {
    // ホーム
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-drawer')).toBeVisible();
    await expect(page.getByTestId('help-section-title')).toHaveText('このアプリでできること');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-drawer')).toBeHidden();

    // 設定
    await page.getByTestId('open-settings').click();
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-section-title')).toHaveText('設定の画面');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'もどる' }).click();

    // モードB のセッション
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-assemble' as string).first().click().catch(async () => {
      // 一覧の行の目印は `open-<課題ID>` なので、最初の行を押す
      await page.locator('[data-testid^="open-"]').first().click();
    });
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.getByTestId('open-help').click();
    await expect(page.getByTestId('help-section-title')).toHaveText('回路を組み立てる');
    await page.keyboard.press('Escape');
  });

  test('受入基準②: 検索欄に「自己保持」と入れると該当節へ跳べる', async () => {
    await page.keyboard.press('F1');
    await page.getByTestId('help-search').fill('自己保持');
    const hits = page.getByTestId('help-hit');
    await expect(hits.first()).toBeVisible();
    const title = await hits.first().locator('span').nth(1).innerText();
    await hits.first().click();
    await expect(page.getByTestId('help-section-title')).toHaveText(title);
    await expect(page.getByTestId('help-prose')).toContainText('自己保持');
    await page.keyboard.press('Escape');
  });

  test('受入基準③: 「説明書（PDF）を開く」が押せて、渡す PDF が実在する', async () => {
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-open-pdf')).toBeEnabled();
    await page.keyboard.press('Escape');
    expect(existsSync(join(APP_ROOT, 'resources', 'manual', 'manual.pdf'))).toBe(true);
  });

  test('受入基準⑥: 引き出しの本文が生成物のとおりに出る', async () => {
    await page.keyboard.press('F1');
    const shown = (await page.getByTestId('help-prose').innerText()).replace(/\s+/gu, '');
    const expected = await page.evaluate(() => {
      // 生成物は renderer に取り込まれているので、画面に出ている本文と付き合わせる
      return document.querySelector('[data-testid="help-prose"]')?.textContent ?? '';
    });
    expect(shown).toBe(expected.replace(/\s+/gu, ''));
    expect(shown.length).toBeGreaterThan(40);
    await page.keyboard.press('Escape');
  });

  test('モードD のラダー編集で F1 を押しても同じ引き出しが開き、トーストは出ない', async () => {
    await page.getByTestId('session-back').click();
    await page.getByRole('button', { name: 'もどる' }).click();
    await page.getByTestId('mode-plc').click();
    await page.locator('[data-testid^="open-"]').first().click();
    await page.getByTestId('ladder-editor').click();
    await page.keyboard.press('F1');
    await expect(page.getByTestId('help-drawer')).toBeVisible();
    await expect(page.getByTestId('help-section-title')).toHaveText('PLCの課題を進める');
    await expect(page.getByTestId('toast')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});
```

**注記**: 課題一覧の行の目印は `open-<課題ID>` なので、`[data-testid^="open-"]` の最初を押す。既存6本の E2E も同じ拾い方をしているところがあるので、実ソースに合わせて書き直してよい（**受入基準を確かめることが目的で、拾い方は手段**）。`受入基準⑥` は E2E では「本文が空でなく、生成物のとおりに出ている」までを見る。一字一句の一致は `manual-sync.test.ts` が正本から作り直して証明している。

- [ ] **Step 2: ビルドして E2E を通す**

```
pnpm --filter @ojt/desktop build
npx electron apps/desktop/scripts/print-manual.mjs
pnpm --filter @ojt/desktop e2e help
# 期待: 5 passed
pnpm --filter @ojt/desktop e2e
# 期待: 既存の E2E も含めてすべて通る。**2回連続で通ること**
```

- [ ] **Step 3: 全体を見直す**

```
pnpm -r test
# 期待: 7プロジェクトすべて通る
pnpm -r typecheck && pnpm lint
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}" "packages/**/*.ts" "README.md"
# 期待: All matched files use Prettier code style!
pnpm --filter @ojt/desktop dist
# 期待: NSIS とポータブルが出て、`release/artifacts.md` に manual.pdf の行がある
grep -c "TODO\|TBD\|FIXME\|適宜" docs/manual/*.md docs/superpowers/plans/2026-09-19-phase6-help-and-manual.md
# 期待: 0
```

- [ ] **Step 4: commit**

```
git add apps/desktop/e2e/help.spec.ts
git diff --cached --stat
git commit -m "test(desktop): drive the help drawer end to end for the Phase 6 acceptance criteria (Plan 6 Task 11)"
git show --stat HEAD
```

---

## Task 12: スクリーンショットの撮影と吹き出し（**プランの最後**）

**モデル: Opus**（撮る手順の設計、吹き出しの位置決め、切り出しで 300KB に収める判断）

**Files:**
- Create: `apps/desktop/scripts/annotate-shots.mjs`
- Create: `apps/desktop/scripts/annotate-shots.d.mts`
- Create: `apps/desktop/e2e/manual-shots.spec.ts`
- Create: `docs/manual/shot-geometry.json`
- Create: `docs/manual/images/*.png`（原寸17枚）
- Create: `docs/manual/images/small/*.png`（幅400pxの縮小版17枚。利用者の決定 2026-09-20）
- Modify: `.gitignore`（`apps/desktop/.manual-raw/`）
- Test: `apps/desktop/test/annotate-shots.test.ts`（新規）
- Test: `apps/desktop/test/manual-images.test.ts`（新規）

本設計 §6.4、決定表#24・#24b・#24c・#25、本プラン 決定表 P13〜P15。

**このタスクは Task 1〜11 がすべて landed し、全画面のUX直しが終わってから始める**（利用者の決定 2026-09-19）。画面を直すたびに17枚を撮り直すのは無駄で、撮り直しを忘れた図が残るほうが害が大きい。

- [ ] **Step 1: 失敗するテストを書く（吹き出しの HTML）**

`apps/desktop/test/annotate-shots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { overlayHtml } from '../scripts/annotate-shots.mjs';

/** 吹き出しを重ねた HTML。取扱説明書 設計 決定表#24c。Playwright は起動しない。 */

const SHOT = {
  caption: 'ホームの画面',
  callouts: [
    { n: 1, label: '設定' },
    { n: 2, label: 'ヘルプ' },
  ],
};

const GEOMETRY = {
  callouts: { '1': { x: 10, y: 20, w: 100, h: 40 }, '2': { x: 120, y: 20, w: 100, h: 40 } },
};

describe('吹き出しの HTML', () => {
  it('puts the raw screenshot behind everything', () => {
    const html = overlayHtml('file:///C:/raw/home.png', SHOT, GEOMETRY, { width: 1280, height: 800 });
    expect(html).toContain('file:///C:/raw/home.png');
    expect(html).toContain('width:1280px');
    expect(html).toContain('height:800px');
  });

  it('draws a box and a circled number for every callout', () => {
    const html = overlayHtml('file:///raw.png', SHOT, GEOMETRY, { width: 1280, height: 800 });
    expect(html).toContain('left:10px');
    expect(html).toContain('width:100px');
    expect(html).toContain('①');
    expect(html).toContain('②');
    expect(html).toContain('設定');
    expect(html).toContain('ヘルプ');
  });

  it('moves the picture when the figure is cropped', () => {
    const cropped = { ...GEOMETRY, crop: { x: 40, y: 60, w: 800, h: 500 } };
    const html = overlayHtml('file:///raw.png', SHOT, cropped, { width: 1280, height: 800 });
    // 切り出しは「窓を 800x500 にして、中の絵を左上へずらす」で表す
    expect(html).toContain('width:800px');
    expect(html).toContain('height:500px');
    expect(html).toContain('left:-40px');
    expect(html).toContain('top:-60px');
  });

  it('refuses a callout that has no place', () => {
    expect(() => overlayHtml('file:///raw.png', SHOT, { callouts: {} }, { width: 1280, height: 800 })).toThrow(
      '吹き出しの位置がありません',
    );
  });

  it('refuses a place that falls outside the picture', () => {
    const bad = { callouts: { '1': { x: 1240, y: 20, w: 100, h: 40 }, '2': GEOMETRY.callouts['2'] } };
    expect(() => overlayHtml('file:///raw.png', SHOT, bad, { width: 1280, height: 800 })).toThrow(
      '画面の外',
    );
  });

  it('escapes the label so a quote cannot break the page', () => {
    const shot = { caption: 'x', callouts: [{ n: 1, label: '「判定」' }, { n: 2, label: '<b>' }] };
    const html = overlayHtml('file:///raw.png', shot, GEOMETRY, { width: 1280, height: 800 });
    expect(html).toContain('&lt;b&gt;');
  });
});
```

期待（Step 2 のあと）: **6件通る**。

- [ ] **Step 2: 吹き出しの HTML を組む純関数を作る**

`apps/desktop/scripts/annotate-shots.mjs`:

```js
/**
 * 素のスクリーンショットに吹き出し（丸数字と枠）を重ねた HTML を組む。
 * 取扱説明書 設計 §6.4 / 決定表#24c。
 *
 * ここでは HTML を組むだけで、絵にするのは Playwright の Chromium である
 * （`e2e/manual-shots.spec.ts`）。分けてあるので、Playwright を起動せずに
 * 「正しい HTML を組めたか」を Vitest で確かめられる。
 *
 * 新しい依存は1つも足していない。純 JS で PNG に丸数字と日本語のラベルを描くには
 * フォントのラスタライザが要り、重い依存になるためである。
 */

/** 丸数字。20個あれば足りる（1枚あたりの吹き出しは多くて6個）。 */
const CIRCLED = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];

/** 吹き出しの色（アプリの通電色とぶつからない朱色）。 */
const MARK_COLOR = '#d8341f';

function escapeHtml(text) {
  return String(text)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/**
 * 重ねた HTML を組む。
 *
 * @param imageUrl 素のPNGの URL（`file:///…`）
 * @param shot     `shots.json` の1件（`caption` と `callouts[{n,label}]`）
 * @param geometry `shot-geometry.json` の1件（`crop?` と `callouts{ "1": {x,y,w,h} }`）
 * @param size     素のPNGの寸法
 */
export function overlayHtml(imageUrl, shot, geometry, size) {
  const crop = geometry.crop ?? { x: 0, y: 0, w: size.width, h: size.height };
  const marks = [];
  for (const callout of shot.callouts) {
    const place = geometry.callouts[String(callout.n)];
    if (place === undefined) {
      throw new Error(`吹き出しの位置がありません: ${callout.n}（${shot.caption}）`);
    }
    if (
      place.x < 0 ||
      place.y < 0 ||
      place.x + place.w > size.width ||
      place.y + place.h > size.height
    ) {
      throw new Error(`吹き出しが画面の外にあります: ${callout.n}（${shot.caption}）`);
    }
    const mark = CIRCLED[callout.n - 1] ?? String(callout.n);
    marks.push(
      `<div class="box" style="left:${place.x}px;top:${place.y}px;width:${place.w}px;height:${place.h}px"></div>`,
      `<div class="mark" style="left:${place.x}px;top:${place.y}px" title="${escapeHtml(callout.label)}">` +
        `<span class="num">${mark}</span><span class="label">${escapeHtml(callout.label)}</span></div>`,
    );
  }
  return [
    '<!doctype html>',
    '<html lang="ja"><head><meta charset="utf-8"><style>',
    'html,body{margin:0;padding:0;background:#ffffff}',
    `.frame{position:relative;overflow:hidden;width:${crop.w}px;height:${crop.h}px}`,
    `.shot{position:absolute;left:${-crop.x}px;top:${-crop.y}px;width:${size.width}px;height:${size.height}px}`,
    `.box{position:absolute;border:3px solid ${MARK_COLOR};border-radius:4px;box-sizing:border-box}`,
    '.mark{position:absolute;transform:translate(-14px,-14px);display:flex;align-items:center;gap:4px}',
    `.num{display:inline-block;min-width:28px;height:28px;line-height:28px;text-align:center;border-radius:14px;background:${MARK_COLOR};color:#ffffff;font:700 18px "Yu Gothic UI","Meiryo",sans-serif}`,
    `.label{background:${MARK_COLOR};color:#ffffff;padding:2px 8px;border-radius:4px;font:700 13px "Yu Gothic UI","Meiryo",sans-serif;white-space:nowrap}`,
    '</style></head><body>',
    '<div class="frame">',
    `<img class="shot" src="${imageUrl}" alt="">`,
    ...marks,
    '</div></body></html>',
    '',
  ].join('\n');
}

/** 仕上げの寸法（切り出しがあればその寸法）。 */
export function finishedSize(geometry, size) {
  const crop = geometry.crop;
  return crop === undefined ? { width: size.width, height: size.height } : { width: crop.w, height: crop.h };
}
```

`apps/desktop/scripts/annotate-shots.d.mts`:

```ts
export interface ShotCallout {
  n: number;
  label: string;
}

export interface Shot {
  caption: string;
  callouts: ShotCallout[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShotGeometry {
  crop?: Rect;
  callouts: Record<string, Rect>;
}

export interface Size {
  width: number;
  height: number;
}

export declare function overlayHtml(
  imageUrl: string,
  shot: Shot,
  geometry: ShotGeometry,
  size: Size,
): string;
export declare function finishedSize(geometry: ShotGeometry, size: Size): Size;
```

- [ ] **Step 3: 撮る E2E を書く**

`apps/desktop/e2e/manual-shots.spec.ts` は次の形にする。**17枚ぶんの「その画面まで動かす手順」は既存6本の E2E（`smoke` / `inspect` / `plc` / `chart` / `polish` / `schematic`）から写す**——同じ課題・同じ操作で同じ画面まで行けるので、新しい動かし方を考える必要はない。

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { finishedSize, overlayHtml } from '../scripts/annotate-shots.mjs';
import { HELP_IMAGE_WIDTH } from '../scripts/manual-build.mjs';

/**
 * 取扱説明書の図を撮る。取扱説明書 設計 §6.4 / 決定表#24・#24c。
 *
 *   pnpm --filter @ojt/desktop e2e manual-shots
 *
 * ①アプリをその画面まで動かし、`capturePage()` で素のPNGを `.manual-raw/` へ
 * ②`overlayHtml()` が組んだ HTML を Chromium で開いて撮り直し、`docs/manual/images/` へ
 *
 * **画面を直したら撮り直す**（`docs/releases/v1.0.0.md` のチェックリスト 8a）。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const RAW_DIR = join(APP_ROOT, '.manual-raw');
const OUT_DIR = join(MANUAL_DIR, 'images');
const SHOTS = JSON.parse(readFileSync(join(MANUAL_DIR, 'shots.json'), 'utf8')) as Record<
  string,
  { caption: string; callouts: Array<{ n: number; label: string }> }
>;
const GEOMETRY = JSON.parse(readFileSync(join(MANUAL_DIR, 'shot-geometry.json'), 'utf8')) as Record<
  string,
  { crop?: { x: number; y: number; w: number; h: number }; callouts: Record<string, { x: number; y: number; w: number; h: number }> }
>;

/** 撮る大きさ。枠を除いた**中身**を 1280×800 にする（決定表#24）。 */
const SHOT_SIZE = { width: 1280, height: 800 };

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  // 画面の倍率が 100% でないパソコンでも 1280×800 ちょうどで撮れるようにする
  '--force-device-scale-factor=1',
];

/** 素のPNGを撮る。 */
async function capture(app: ElectronApplication, name: string): Promise<void> {
  mkdirSync(RAW_DIR, { recursive: true });
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    const image = await window.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(RAW_DIR, `${name}.png`), Buffer.from(base64, 'base64'));
}

/** 吹き出しを描き込んで仕上げる。 */
async function annotate(page: Page, name: string): Promise<void> {
  const shot = SHOTS[name];
  const geometry = GEOMETRY[name];
  expect(shot, `${name} が shots.json にありません`).toBeDefined();
  expect(geometry, `${name} が shot-geometry.json にありません`).toBeDefined();
  if (shot === undefined || geometry === undefined) return;
  const url = pathToFileURL(join(RAW_DIR, `${name}.png`)).href;
  await page.setContent(overlayHtml(url, shot, geometry, SHOT_SIZE));
  const size = finishedSize(geometry, SHOT_SIZE);
  await page.setViewportSize(size);
  mkdirSync(OUT_DIR, { recursive: true });
  await page.locator('.frame').screenshot({ path: join(OUT_DIR, `${name}.png`), type: 'png' });

  /*
   * 縮小版（幅400px）。アプリ内ヘルプが本文に出すのはこちらで、原寸は押されたときだけ開く
   * （利用者の決定 2026-09-20／取扱説明書 設計 決定表#9）。
   * 同じ覆いをそのまま幅400pxの窓で撮り直すだけなので、別の道具は要らない。
   */
  const ratio = HELP_IMAGE_WIDTH / size.width;
  const small = { width: HELP_IMAGE_WIDTH, height: Math.ceil(size.height * ratio) };
  await page.setViewportSize(small);
  await page.evaluate((scale) => {
    const frame = document.querySelector('.frame');
    if (frame instanceof HTMLElement) {
      frame.style.transformOrigin = 'top left';
      frame.style.transform = `scale(${String(scale)})`;
    }
  }, ratio);
  mkdirSync(join(OUT_DIR, 'small'), { recursive: true });
  await page.screenshot({ path: join(OUT_DIR, 'small', `${name}.png`), type: 'png' });
}

test.describe('取扱説明書の図', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    rmSync(RAW_DIR, { recursive: true, force: true });
    app = await electron.launch({
      args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      // 枠を除いた中身を 1280×800 にする（`setBounds` は枠を含むので使わない）
      window.setContentSize(1280, 800);
      window.show();
      window.focus();
    });
    await page.waitForTimeout(1500);
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) await page.getByRole('button', { name: '復元しない' }).click();
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('ホームと課題一覧', async () => {
    await capture(app, 'home');
    await page.getByTestId('mode-assemble').click();
    await page.waitForTimeout(400);
    await capture(app, 'list');
  });

  // 以降、`session-board` / `session-terminal` / `view-cube` / `socket-card` /
  // `judge-result` / `timechart` / `c1-tester` / `c1-marksheet` / `c2-repair` /
  // `plc-ladder` / `plc-monitor` / `plc-notation` / `schematic-editor` / `settings` /
  // `help-drawer` を、既存の E2E と同じ操作でその画面まで行って `capture()` する。

  test('吹き出しを描き込んで仕上げる', async () => {
    const annotator = await app.firstWindow().then((w) => w.context().newPage());
    for (const name of Object.keys(SHOTS)) await annotate(annotator, name);
    await annotator.close();
  });
});
```

**注記**: 仕上げ用のページは、Electron の `BrowserWindow` ではなく Playwright が開く**別のページ**である。`app.firstWindow()` の `context()` から `newPage()` を取れないときは、`test.use({ browserName: 'chromium' })` の別ファイルに分けるか、Electron 側で隠しウィンドウを1枚作って `loadURL('data:text/html,…')` で同じことをする。**どちらでもよいが、素のPNGと仕上げのPNGが別物として残ることは変えない**（素のPNGは git に入れない）。

- [ ] **Step 4: 位置を決めて撮る**

```
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop e2e manual-shots
# 1回目: `.manual-raw/` に素のPNGが17枚できる（仕上げは shot-geometry.json が無いので落ちる）
```

`.manual-raw/*.png` を画像ビューアで開き、吹き出しを置きたいところの矩形を読み取って `docs/manual/shot-geometry.json` を書く。`shots.json` の吹き出しの番号すべてに位置を与える。

```json
{
  "home": {
    "callouts": {
      "1": { "x": 328, "y": 176, "w": 300, "h": 120 },
      "2": { "x": 1084, "y": 24, "w": 120, "h": 40 },
      "3": { "x": 948, "y": 24, "w": 120, "h": 40 }
    }
  }
}
```

もう一度走らせて仕上げる。

```
pnpm --filter @ojt/desktop e2e manual-shots
# 期待: docs/manual/images/ に17枚できる
```

- [ ] **Step 5: 失敗するテストを書く（画像）**

`apps/desktop/test/manual-images.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { finishedSize } from '../scripts/annotate-shots.mjs';

/**
 * 図そのものの検査。取扱説明書 設計 §6.4 / 決定表#24b・#25。
 * **撮影（Plan 6 Task 12）で初めて入れる**——それより前に入れると、撮るまで落ち続ける。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = resolve(APP_ROOT, '../../docs/manual');
const IMAGE_DIR = join(MANUAL_DIR, 'images');
const SHOTS = JSON.parse(readFileSync(join(MANUAL_DIR, 'shots.json'), 'utf8')) as Record<string, unknown>;
const GEOMETRY = JSON.parse(readFileSync(join(MANUAL_DIR, 'shot-geometry.json'), 'utf8')) as Record<
  string,
  { crop?: { x: number; y: number; w: number; h: number }; callouts: Record<string, unknown> }
>;

/** 原寸1枚あたりの上限。決定表#25 */
const MAX_BYTES = 300 * 1024;
/** 縮小版1枚あたりの上限（利用者の決定 2026-09-20）。 */
const MAX_SMALL_BYTES = 80 * 1024;
/** 原寸フォルダ合計の上限。 */
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
/** 縮小版フォルダ合計の上限。 */
const MAX_SMALL_TOTAL_BYTES = 1.5 * 1024 * 1024;
/** アプリ内ヘルプが本文に出す幅。 */
const HELP_IMAGE_WIDTH = 400;
/** 撮った大きさ。 */
const SHOT_SIZE = { width: 1280, height: 800 };

/** PNG のヘッダ（IHDR）から寸法を読む。画像ライブラリは要らない。 */
function pngSize(path: string): { width: number; height: number } {
  const head = readFileSync(path).subarray(0, 24);
  expect(head.subarray(0, 8).toString('hex'), `${path} は PNG ではありません`).toBe(
    '89504e470d0a1a0a',
  );
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const files = readdirSync(IMAGE_DIR).filter((name) => name.endsWith('.png')).sort();
const SMALL_DIR = join(IMAGE_DIR, 'small');
const smallFiles = readdirSync(SMALL_DIR).filter((name) => name.endsWith('.png')).sort();

describe('図はすべて本アプリの実画面（決定表#24b）', () => {
  it('has exactly the files the manual defines', () => {
    expect(files.map((name) => name.replace(/\.png$/u, ''))).toEqual(Object.keys(SHOTS).sort());
  });

  it('gives every figure a place for its callouts', () => {
    expect(Object.keys(GEOMETRY).sort()).toEqual(Object.keys(SHOTS).sort());
  });
});

describe('大きさと寸法（決定表#25）', () => {
  it.each(files)('%s is small enough to ship', (name) => {
    const bytes = statSync(join(IMAGE_DIR, name)).size;
    expect(
      bytes,
      `${name} が ${String(MAX_BYTES)} バイトを超えています。shot-geometry.json の crop を狭めてください（縮小はしない）`,
    ).toBeLessThanOrEqual(MAX_BYTES);
  });

  it.each(files)('%s has the size its definition says', (name) => {
    const id = name.replace(/\.png$/u, '');
    const geometry = GEOMETRY[id];
    expect(geometry, `${id} の定義がありません`).toBeDefined();
    if (geometry === undefined) return;
    expect(pngSize(join(IMAGE_DIR, name))).toEqual(finishedSize(geometry, SHOT_SIZE));
  });

  it('keeps the whole folder under the budget', () => {
    const total = files.reduce((sum, name) => sum + statSync(join(IMAGE_DIR, name)).size, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });
});

describe('縮小版（利用者の決定 2026-09-20）', () => {
  it('has one reduced copy for every figure, under the same name', () => {
    expect(smallFiles).toEqual(files);
  });

  it.each(smallFiles)('%s is 400px wide and light enough for the drawer', (name) => {
    const size = pngSize(join(SMALL_DIR, name));
    expect(size.width, `${name} の縮小版の幅が違います`).toBe(HELP_IMAGE_WIDTH);
    const full = pngSize(join(IMAGE_DIR, name));
    // 縦横の比は原寸と同じ（切り上げの1pxまで）
    expect(Math.abs(size.height - (full.height * HELP_IMAGE_WIDTH) / full.width)).toBeLessThanOrEqual(1);
    expect(
      statSync(join(SMALL_DIR, name)).size,
      `${name} の縮小版が ${String(MAX_SMALL_BYTES)} バイトを超えています`,
    ).toBeLessThanOrEqual(MAX_SMALL_BYTES);
  });

  it('keeps the reduced copies under their own budget', () => {
    const total = smallFiles.reduce((sum, name) => sum + statSync(join(SMALL_DIR, name)).size, 0);
    expect(total).toBeLessThanOrEqual(MAX_SMALL_TOTAL_BYTES);
  });
});
```

期待: **8つの検査項目**（`it.each` を含めると17×3＋5）。

- [ ] **Step 6: 300KB を超えた図を直す**

```
pnpm --filter @ojt/desktop test manual-images
```

超えた図は `shot-geometry.json` の `crop` を狭めて撮り直す。**原寸は縮小しない**（端子の番号が読めなくなって図の意味が消える。決定表#25）。3D盤の写る図は、盤のうち説明に要る部分だけを切り出せばよい。縮小版（幅400px）が 80KB を超えるのも同じ直し方で、`crop` を狭めれば縮小版も軽くなる。

```
pnpm --filter @ojt/desktop e2e manual-shots
pnpm --filter @ojt/desktop test manual-images
# 期待: すべて通る
```

- [ ] **Step 7: 生成物を作り直して通しで確かめる**

`.gitignore` に足す:

```
apps/desktop/.manual-raw/
```

```
cd apps/desktop && node scripts/build-manual.mjs
# 期待: 図を複写しました: 17 枚（生成物に `@manual-images` の読み込みが17×2本出る）
pnpm --filter @ojt/desktop build
# 期待: Vite が図を束ねて通る（`@manual-images` の別名は Task 2 Step 6 で入れてある）
npx electron scripts/print-manual.mjs
# 期待: 図の入った PDF ができる
pnpm -r test
# 期待: すべて通る
pnpm --filter @ojt/desktop e2e
# 期待: すべて通る（2回連続）
```

- [ ] **Step 8: commit**

```
git add apps/desktop/scripts/annotate-shots.mjs apps/desktop/scripts/annotate-shots.d.mts apps/desktop/e2e/manual-shots.spec.ts apps/desktop/test/annotate-shots.test.ts apps/desktop/test/manual-images.test.ts docs/manual/shot-geometry.json docs/manual/images .gitignore apps/desktop/src/renderer/help/manual-content.ts
# `docs/manual/images` には原寸17枚と `small/` の縮小版17枚の両方が入る
git diff --cached --stat
git commit -m "docs(manual): photograph every screen and mark the controls the text talks about (Plan 6 Task 12)"
git show --stat HEAD
```

---

## タスクと仕様節の対応

| Task | 仕様節 | 受入基準・利用者要求 |
|---|---|---|
| 1 | 取扱説明書 設計 §6.3／決定表#22 | ⑤／利用者要求2（全機能を解説） |
| 2 | 取扱説明書 設計 §4／決定表#2・#3・#9・#12・#13 | ⑥／利用者要求1（内容の一致） |
| 3 | 取扱説明書 設計 §6.1・§6.2／本体仕様 §8・§9・§12 | ⑤／利用者要求2 |
| 4 | 取扱説明書 設計 §6.1・§6.2／本体仕様 §10・§11・§12.3・§7 | ⑤／利用者要求2 |
| 5 | 取扱説明書 設計 §6.2・§6.3・§6.4／決定表#21〜#23 | ⑤⑦／利用者要求2・4 |
| 6 | 取扱説明書 設計 §5.2／決定表#18・#19／本体仕様 §12.2（純粋関数化） | ①② |
| 7 | 取扱説明書 設計 §7・§8・§9／本体仕様 §4.3・§7.8・§15 | ③④ |
| 8 | 取扱説明書 設計 §5.3・§5.4／本体仕様 §15（アクセシビリティ） | ①②③／利用者要求3 |
| 9 | 取扱説明書 設計 §5.1／決定表#16・#17／本体仕様 §10.6（`F1` ヘルプ） | ①／利用者要求3 |
| 10 | 取扱説明書 設計 §5.5／決定表#10・#11／本体仕様 §9.1・§10.6・§12.1・§15 | ⑥／利用者要求1 |
| 11 | 本体仕様 §14.2（E2E）／取扱説明書 設計 §11 | ①②③⑥ |
| 12 | 取扱説明書 設計 §6.4／決定表#24・#24b・#24c・#25 | ⑦／利用者要求4・5 |

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本プランの実装 | 理由 |
|---|---|---|---|
| 1 | 本体仕様 §4.3「チャネルは6本のみ」（Phase 4 で7本） | **8本**にする（`manual:open`） | renderer からは OS のビューアを起動できず、既存7本のどれにも意味の上で載せられない。**引数を1つも取らない**ので、renderer から任意のパスを開かせる余地が型の上で無い（取扱説明書 設計 §8） |
| 2 | Plan 5 決定表#18「`electron-builder.yml` と `copy-content.mjs` は触らない」／完了条件「依存が1つも増えていない」 | `electron-builder.yml` に `extraResources` を**1項目**、`devDependencies` に `markdown-it` を**1つ** | PDF を配布物に入れる方法が他に無い。`dependencies`（実行時依存）・asar の中身・オフライン方針には影響しない |
| 3 | §16 Phase 6 受入基準③「PDF が OS の既定ビューアで開く」 | **E2E はボタンを押さない**。押せることと PDF の実在まで自動で確かめ、`shell.openPath()` の3分岐は `manual-ipc.test.ts` が縛る。実際にビューアが開くことはリリース手順チェックリスト 8b で人が確かめる | 押すと OS の既定 PDF ビューアが本当に起動し、CI でもレビュー中でも閉じられない。Plan 5 が「NSIS のインストールは人が確かめる」としたのと同じ線引き |
| 4 | 本体仕様 §10.6「GX Works3風 `F1` ヘルプ」 | `F1` は**このアプリのヘルプ**を開く（純正ツールのヘルプは模さない）。いまのトーストは廃止する | 純正ツールのヘルプ内容は複製できない（§17.1）。§10.6 が求めるのは「`F1` でヘルプが出ること」であり、中身は本アプリのものでよい |
| 5 | 本体仕様 §15「文言をすべて `resources/i18n/ja.json` に集約し、ハードコードしない」 | **ヘルプの本文だけ**は `i18n` に置かず、生成物 `manual-content.ts` から来る。`JA.help` に置くのは画面の部品の名前だけで、値は40文字以下 | 本文を `ja.ts` に入れると正本が2つになり、利用者要求1（内容の一致）が守れない。40文字という機械的な線を引けば、うっかり段落を書き足せない（取扱説明書 設計 決定表#28） |
| 6 | 本体仕様 §15「起動時・実行時に外部通信を行わない」 | 守る。ヘルプも PDF も同梱物だけを読む | 図も本文も配布物の中にある。`http://` / `https://` の文字列を renderer に1つも置かない |
| 7 | 取扱説明書 設計 §6.4 は図を17枚と定める | 図は**プランの最後（バッチF）**でまとめて撮る。それまでは原稿が図を参照していても画像を見ない | 利用者の決定（2026-09-19）。画面を直すたびに撮り直すのは無駄で、撮り直しを忘れた図が残るほうが害が大きい（決定表 P13） |

---

## 実装者への MERGE 注意

複数のタスクが同じファイルへ別々の箇所から手を入れる。「実装バッチ」で並行させるときは次の10点を守ること。

1. **`i18n/ja.ts` への挿入は、挿入のたびにファイルを読み直してから行う。** Phase 6 が触るのは **Task 8（末尾に新ブロック `JA.help` ＋ 関数 `helpHitCountText()`）** と **Task 9（`JA.ladder.helpHint` の1行を消す）**の2箇所だけ。どちらも `// --- Plan 6 Task N ---` で挟む（消すほうは挟めないので、commit のメッセージに理由を書く）。**共有ファイルは `git add <パス>` でまとめて入れず、自分の差分だけを patch にして `git apply --cached` する**（Task 8・9 の commit 手順のとおり）。
2. **`src/renderer/help/manual-content.ts` は生成物である。手で直さない。** Task 3・4・5・8・9・10・12 が `docs/manual/` を触るたびに、**そのタスクの最後で** `node scripts/build-manual.mjs` を走らせて作り直し、一緒に commit する。バッチB で Task 3・4 と Task 6・7 を並行させたときにこのファイルが両方の差分に出るが、**中身は正本から一意に決まる**ので、rebase で衝突したら「`docs/manual/` をマージしてから作り直す」で必ず解ける。
3. **`app/store.ts` は1行も触らない。** ヘルプの状態は `help/help-store.ts` に独立して置く（取扱説明書 設計 決定表#14）。`useStore` からは `route` / `problem?.mode` / `assembleView` / `toast` を**読むだけ**にする。
4. **`docs/manual/coverage.json` は Task 1 が作り、Task 5（`messages`）・Task 7（`MSG.manual` の2行）・Task 8（引き出しの11行）・Task 9（`open-help` の1行）が足す。** 足すだけで、既存の行を消さない。消してよいのは、画面から本当に消えた操作要素の行だけである。
5. **`scripts/check-dist.mjs` と `package.json` の `dist` は Plan 5 Task 14 が作ったものである。** Task 7 は**追記だけ**する。Plan 5 の検査（成果物2つ・同梱課題の件数・`artifacts.md`）を1行も消さない。`dist` の文字列は、既存の工程の**あいだに2つ挟む**だけで、順番を入れ替えない。
6. **`docs/` の下で Phase 6 が触ってよいのは `docs/manual/**`、`docs/superpowers/specs/2026-09-19-help-and-manual-design.md`、`docs/superpowers/plans/2026-09-19-phase6-help-and-manual.md`、`docs/releases/v1.0.0.md` のリリース手順チェックリストだけ。** 他のプランの文書（`docs/superpowers/plans/2026-09-19-phase4b-*.md` など）は別のエージェントが編集中なので、**絶対に stage しない**。
7. **`screens/Result.tsx` は Plan 5 Task 9 が「結果から盤へ」の導線を足したファイルである。** Task 9 は**その `return` を囲むだけ**で、中の分岐も4つの結果部品（`ResultView` / `InspectPartsResult` / `InspectRepairResult` / `PlcResult`）も1行も変えない。
8. **`panels/Toolbar.tsx` は4つのセッション画面が共有している。** Task 9 が足すのは `.toolbarScroll` の中の1つのボタンだけで、`viewSwitch` の差し込み口・「⋯」の中身・`judgeButton` の位置は触らない。1箇所の追加が4画面に効くので、**画面ごとに足さない**。
9. **`e2e/` は追加のみ。** 既存の E2E（`smoke` / `navigation` / `chart` / `inspect` / `plc` / `polish` ＋ Plan 5 の `schematic` / `perf`）と `projection.ts` は**1行も変えない**。新しい2本（`help.spec.ts` / `manual-shots.spec.ts`）は起動の定型を `polish.spec.ts` から写す。`manual-shots.spec.ts` だけは `setContentSize(1280, 800)` と `--force-device-scale-factor=1` を使う（他は 1440×900 のまま）。
10. **共有ツリーの git の規律（全タスク共通）。** `git stash` / `git reset --hard` / `git checkout -- .` / `git clean` / `git add -A` / `git add <ディレクトリ>` を**使わない**（`docs/manual` と `docs/manual/images` だけは Phase 6 専用のフォルダなので例外として許す）。自分のファイルは**パスを1つずつ指定して** stage する。共有ファイル（`ja.ts` / `Toolbar.tsx` / `App.tsx` / `package.json` / `check-dist.mjs`）は、**いまの HEAD に対する自分の hunk だけ**の patch を作って `git apply --cached` する。commit はパス引数なしで行う。stage の前に `git diff --cached --stat`、commit のあとに `git show --stat HEAD` を必ず見る。`git hash-object` ＋ `update-index` は使わない。

---

## 完了条件

**機能:**

- [ ] `pnpm -r test` が7プロジェクトすべて通る（Phase 6 で足した単体テストは **packages 0件 ＋ desktop 123件**）。内訳は各タスクの「期待」のとおり: Task 1 の 6／Task 2 の 22（`manual-build` 16 ＋ `manual-sync` 6）／Task 5 の 24（`manual-style` 10 ＋ `manual-coverage` 9 ＋ `manual-shots` 5）／Task 6 の 12／Task 7 の 12（`manual-ipc` 7 ＋ `release-manual` 5）／Task 8 の 17／Task 9 の 9／Task 10 の 7／Task 12 の 14（`annotate-shots` 6 ＋ `manual-images` 8）。
- [ ] `pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` ＋ `react-hooks` 込み）が無警告で通る。
- [ ] `npx prettier --check "apps/desktop/**/*.{ts,tsx,css}" "packages/**/*.ts" "README.md"` が `All matched files use Prettier code style!` を出す（`docs/` と生成物 `manual-content.ts` は `.prettierignore` の対象）。
- [ ] `pnpm --filter @ojt/desktop e2e` が既存＋新規のすべて通る。**2回連続で通ること。**
- [ ] **受入基準①**: ホーム・課題一覧・設定・モードB・C1・C2・D・回路図・結果の**9画面すべて**で `F1` を押すとヘルプが開き、その画面の節が最初に出る。もう一度 `F1` で閉じる。モードDのラダー編集で押しても同じ引き出しが開き、**トーストは出ない**。
- [ ] **受入基準②**: 検索欄に「自己保持」と入れると該当節が一覧に出て、押すとその節へ跳ぶ。0件のときは「見つかりませんでした。別の言葉で探してください。」が出る。
- [ ] **受入基準③**: 「説明書（PDF）を開く」が全画面のヘルプにあり、押すと同梱の PDF が OS の既定ビューアで開く（リリース手順チェックリスト 8b で人が確かめる）。PDF が無いときは「説明書（PDF）が見つかりません。もくじから同じ内容を読めます。」が出る。
- [ ] **受入基準④**: `pnpm --filter @ojt/desktop dist` が NSIS とポータブルを出し、両方の `resources/manual.pdf` が 0 バイトでなく、`release/artifacts.md` に PDF の行（バイト数と SHA256）が載る。
- [ ] **受入基準⑤**: `manual-coverage.test.ts` が通る（機能一覧表の `controls` が画面の目印と完全一致し、すべての行が節か内部用の理由を持ち、`keys` / `gestures` / `messages` が本文に出ている）。`manual-style.test.ts` の禁止語が **0件**。
- [ ] **受入基準⑥**: `manual-sync.test.ts` が通る（正本から作り直した `manual-content.ts` がいまのファイルとバイト一致し、印刷用 HTML から取り出した節ID・見出し・素の文がアプリ内ヘルプのそれと完全一致）。
- [ ] **受入基準⑦**: `docs/manual/images/` のファイル名の集合が `shots.json` の鍵と完全一致（作り絵が1枚も紛れていない）。原寸は **300KB 以下**で寸法が `shot-geometry.json` の指定どおり、フォルダ合計 6MB 以下。`images/small/` に同じ名前の縮小版が揃い、**幅400px・80KB 以下**、合計 1.5MB 以下。図を載せた節の本文が吹き出しの番号（①②③）と `label` を指している。
- [ ] **受入基準⑧**: アプリ内ヘルプの本文に**同梱 PDF と同じ図**が縮小版で出る（`manual-sync.test.ts` が節ごとに図の名前の並びを照合）。図を押すか `Enter` で原寸が覆いで開き、`Esc`・「図を閉じる」・背面で戻って**元の図のボタンに焦点が返る**。まだ撮っていない図は描かれず、そのボタンも押せない。

**利用者要求（2026-09-19）:**

- [ ] **内容の一致**: 説明書の本文が `i18n/ja.ts` に1文字も無い（`JA.help` の値はすべて40文字以下で、キーは決めた12個だけ）。C1の判定表・モードDのキー割当・設定の説明文・商標注記が、コード側の実体と**1行ずつ一致**している（`manual-appdata.test.ts`）。
- [ ] **全機能の解説**: 画面の `data-testid` を1つでも足すと `feature-inventory.test.ts` が落ち、説明書に書くか内部用の理由を書くまで通らない。
- [ ] **専門用語なし**: `style.json` の禁止語が本文に0件。`terms.json` の専門用語はすべて初出が `**用語**（15文字以上の説明）` の形で、用語集に20文字以上の説明がある。
- [ ] **実画面の図**: 図はすべてアプリを動かして撮ったもので、説明する操作要素の上に丸数字と枠がある。
- [ ] **図もヘルプに出る**（利用者の決定 2026-09-20）: 説明書とヘルプの一致が本文だけでなく**図**にも及ぶ（どの節にどの図が何番目に出るかまで一致）。asar の増加が **3MB 以下**（`release/artifacts.md` のバイト数で前の版と比べる）。
- [ ] **図は最後**: Task 12 より前のどの commit でも `pnpm -r test` が通る（`manual-images.test.ts` が Task 12 で初めて入るため、図が無いあいだも赤にならない）。

**画面の品質:**

- [ ] 引き出しが **1280×800 と 1920×1080** のどちらでも横スクロールを出さない（`scrollWidth <= clientWidth`）。1100px 未満では全幅になる。
- [ ] 引き出しの日本語が切れていない（もくじ・検索欄・本文・脚注）。
- [ ] Task 8 で足した CSS の `padding` / `gap` / `margin` がすべて **4の倍数**（8px 格子）。
- [ ] 引き出しのすべての操作要素（閉じる・PDF・検索欄・もくじの節・検索結果・**図のボタン**・**図を閉じる**）が `:focus-visible` で見える枠を持つ。
- [ ] 図の覆いが開いているあいだ、`Esc` は**覆いだけ**を閉じる（引き出しは開いたまま）。
- [ ] `Tab` が引き出しの中だけを回り、`Esc` で閉じ、閉じたあと**開く前の要素に焦点が戻る**。
- [ ] ヘルプが開いているあいだ、盤のショートカット（`Delete` / `1` / `2` / `3`）もラダーのキーも効かない（`pushModalLayer()` が積まれている）。
- [ ] 「ヘルプ」ボタンが9画面すべてで同じ言葉・同じ見た目で出る（部品は `HelpButton` 1つだけ）。

**規律:**

- [ ] `packages/**` への変更が**1行も無い**（`git diff --stat origin/main -- packages` が空）。
- [ ] `apps/desktop/src/renderer/app/store.ts` への変更が**1行も無い**。
- [ ] `apps/desktop/package.json` の `dependencies` が Phase 5 から**1つも増えていない**（増えるのは `devDependencies` の `markdown-it` 1つだけ）。
- [ ] IPCチャネルが **8本**で、8本目は `manual:open`（引数なし）である。9本目を作っていない。
- [ ] `apps/desktop/src/renderer` に `http://` / `https://` の文字列が無い（§15 のオフライン）。
- [ ] `TODO` / `TBD` / `FIXME` / `後で` / `適宜` が本プランで足したコード・原稿・文書に**1つも無い**。
- [ ] 他社のロゴ・アイコン・画面キャプチャ・マニュアル本文を1つも複製していない（§15・§17.1）。
- [ ] `git tag` も `gh release create` も**実行していない**（Plan 5 決定表#22 を引き継ぐ）。
- [ ] 他のプランの文書（`docs/superpowers/plans/2026-09-19-phase4b-*.md` など）を1つも stage していない。

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-20 | 利用者の決定により**アプリ内ヘルプにも図を出す**ことにした（決定表#9 を「出さない」から「幅400pxの縮小版を出し、押すと原寸を覆いで開く」へ）。Task 2（生成物が図の参照と `MANUAL_IMAGES` を持ち、まだ撮っていない図は読み込まない）、Task 8（図の差し込みと拡大の覆い・キーボード操作・遅延読み込み）、Task 12（縮小版の生成と検査）を直し、決定表に P16・P17 を足した。一致検査に「図のファイル名の並び」を加え、受入基準⑧と asar の増加（実測 2〜3MB）を完了条件に入れた。**バッチの順序（F が最後）は変えていない。タスク数も12のまま。** |
| 2026-09-19 | 初版。§16 Phase 6（取扱説明書とアプリ内ヘルプ）を12タスクに分けた。**正本は `docs/manual/*.md` の1つだけ**とし、`buildManual()` が同じ呼び出しからアプリ用の `manual-content.ts` と PDF 用の `manual.html` を書き出す設計にして、利用者要求「説明書とヘルプの内容は一致していること」を `manual-sync.test.ts` のバイト一致検査で機械的に保証した。利用者要求「すべての機能を使用者目線で専門用語なく詳細に解説すること」は、①画面の `data-testid` を全部拾って `coverage.json` と完全一致を求める検査、②禁止語リスト0件と専門用語の初出の形を縛る検査、③アプリが出すメッセージの全キーが「こう表示されたら」に出ていることの検査、の3本に落とした。コードが持つ表（C1の判定表・モードDのキー割当・設定の説明文・商標注記）は**実体をコード側に残し**、説明書が写した内容を `manual-appdata.test.ts` が1行ずつ照らす。PDF は Electron 自身の `printToPDF` で焼き、`extraResources` の1項目で NSIS とポータブルの両方に入れ、開くための IPC を**8本目**（`manual:open`、引数なし）として足した。利用者要求「画像は実際の画面で分かりやすく」に対しては、Playwright が撮った素のPNGに `overlayHtml()` が組んだ吹き出し（丸数字と枠）を Chromium で描き込む工程を置き、`shots.json`（意味）と `shot-geometry.json`（場所）を分けて、新しい依存を1つも足さずに再現できるようにした。利用者の決定「画像撮影は他のすべての実装が終わってからでよい」に従い、撮影と画像の検査を**最後のバッチF（Task 12）**に隔離し、それまでは図が無くても `pnpm -r test` が通るようにした |

