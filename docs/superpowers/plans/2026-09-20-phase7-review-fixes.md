# Plan 7: レビュー対応と v1.1（Phase 7）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計仕様 §16 Phase 7 の行を実装し、受入基準①〜⑧を動作で示す。詳細設計は `docs/superpowers/specs/2026-09-20-phase7-review-fixes-design.md`（以下「本設計」）にある。本プランは本設計の決定を **41タスク**に割る。

**進捗の報告（利用者の要望11）:** タスクは 1〜41 の通し番号を持つ。**進捗は必ず `X/41` の形で報告する**（例:「12/38 完了。次は Task 13（課題の拡充 B・C1）」）。分母は 41 で固定であり、タスクを足すときはこの見出しと §「修正タスク ↔ 指摘ID ↔ 利用者要望」の表を同時に直す。

**受入基準（§16 Phase 7）:**

| # | 文 | 本プランでの担保 |
|---|---|---|
| ① | インストーラのライセンス画面が日本語で正しく読める | Task 1（＋Task 38 の実物確認） |
| ② | 指摘174件のうち171件が対応済みで、残り3件を仕様訂正で閉じたことが記録されている | 本設計 §3 ＋ 本プラン末尾の対応表 ＋ Task 14（仕様訂正） |
| ③ | 内蔵課題が72題あり、すべて模範解が自身の判定に合格する | Task 4・13・18 |
| ④ | 4方言すべてで、キー割当表に有効として載っている全行のキーがそのとおり効く | Task 2・3・20・21 |
| ⑤ | 3D盤でブレーカを押すと通電し、部品を運べ、端子から端子へドラッグで配線できる | Task 27 |
| ⑥ | 俯瞰からビューキューブを下へ引くと正面へ回り込める | Task 19 |
| ⑦ | 説明書PDFのもくじを押すと飛び、しおりに全章が並び、チュートリアル章が全72題を索引している | Task 34・35・36 |
| ⑧ | 初回にモードBを開くと5枚の案内が出て、操作すると進み、設定から出し直せる | Task 28 |

**利用者要望（2026-09-20、全タスク共通の拘束）:**

1. 「内容を確認し妥当だと判断したものは対応して」→ 174件のうち **171件を対応**、3件は仕様訂正で閉じる（本設計 §3）。**レポート `docs/reviews/**` は1文字も書き換えない**。
2. 「各項目の問題量が少ないのでもっと拡充して(もっと複雑なものも)」→ 28題 → **72題**（Task 4・13・18）。
3. 「各メーカのPLC回路入力画面も…もっと忠実に再現すること」→ Task 20・21・22。
4. 「インストール時ライセンス契約書が文字化けしていた」→ **Task 1**（最優先・単独）。
5. 「取扱説明書のPDFのデザインがシンプルすぎる…ヘルプ画面も見にくい」→ Task 32・34。
6. 「取扱説明書の目次を押すとその項目へ飛ぶように」→ Task 34。
7. 「各機能や課題のチュートリアルの項目を取扱説明書に新設」→ Task 35。
8. 「3D図で上から正面にキューブを回そうとすると回らない」→ Task 19。
9. 「3D図をクリックして電源をON/OFFしたり配線したりドラッグして部品を配置したり…UI,UX刷新して」→ Task 23〜28。
10. 「取扱説明書は全ての修正が終わってから必要な画像を取り直し」→ **Task 36 はバッチH（最後から2番目）**。
11. 「修正タスクがいくつに対していくつ終わったか都度報告する」→ `X/41`。
12. 「終わったら新しいバージョンをリリースして」→ **Task 38**（v1.1.0）。

**公開について:** Task 38 だけがタグ付けと GitHub Release を行う。**それ以外のタスクは `git tag` も Release も作らない**（2026-09-19 の利用者決定: 明示の指示があるまでリリースしない。本プランは要望12がその明示の指示にあたる）。

---

## 前提（このプランを始める前に満たしていること）

### 前提A: 出発点

| 事項 | 値 |
|---|---|
| ブランチ / HEAD | `main` / `f659f51`（v1.0.0、2026-09-20） |
| 版 | `apps/desktop/package.json` の `version` は `1.0.0` |
| 内蔵課題 | 28題（B 8 / C1 4 / C2 8 / D 8） |
| テスト | `pnpm -r test` 265ファイル / 3,859件、`pnpm -r typecheck`・`pnpm lint` 無警告 |
| E2E | 12 spec / 66件成功・1スキップ |
| 作業ツリー | **Task 1 の対象ファイルに未コミットの変更がある**（`apps/desktop/build/license.txt` と `apps/desktop/test/release-content.test.ts`）。Task 1 の担当者はこれを**破棄せず**引き継ぐ |

### 前提B: 既存APIの署名（本プランが使う分だけ。実ソースで確認済み）

| モジュール | 署名 |
|---|---|
| `packages/plc-dialects` | `interface ShortcutEntry { action: string; keys: string; label: string; confirmed: boolean; enabled?: boolean; note?: string }` / `type ShortcutTable = readonly ShortcutEntry[]` / `DialectProfile.shortcuts` |
| 〃 | `GX_STYLE_SHORTCUTS`（`src/shortcuts.ts`、19行）、`withoutConvert(table)` |
| 〃 | `PanelLayout { tree: string; editor: string; output: string; toolbar: readonly string[] }` |
| `renderer/session/ladder.ts` | `matchShortcut(table, event)` / `expandKeys(keys)` / `KEY_ALIASES` / `ladderKeyToAction(table, event, state): LadderAction` / `builtinAction(event)` |
| `renderer/session/interaction.ts` | `pickToAction(state, hit): InteractionAction` / `pushModalLayer()` / `isModalOpen()` / `shouldIgnoreShortcut(event)` |
| `renderer/session/commands.ts` | `HISTORY_LIMIT = 50` / `pushCommand(history, command)` / `undo(history)` / `redo(history)` / `runPlug` / `runUnplug` / `runSwapPart` / `runAddWire` / `runRemoveWire` |
| `renderer/three/navigation.ts` | `GIZMO_DRAG_RAD_PER_PX = (2*Math.PI)/1000` / `GIZMO_DRAG_THRESHOLD_PX = 4` / `gizmoDragToSpherical(dx,dy)` / `clamp(v,min,max)` / `gizmoTargetForDirection()` |
| `renderer/three/camera.ts` | `MAX_POLAR_ANGLE = Math.PI/2` / `MIN_POLAR_ANGLE_RAD = 0.02`（未使用） / `poseForDirection()` / `boardUp()` |
| `packages/content/src/schema/common.ts` | `CONTENT_FORMAT_VERSION = 1` / `ProblemHeaderShape` / `GradeSchema = z.literal([1,2,3])` |
| `packages/content/src/timechart.ts` | `PB_LABELS` / `OUTPUT_LABELS` / `buildTimeChart()` / `startsAndEndsLow(chart)` / `timerMarkers(netlist)` |
| `apps/desktop/scripts/manual-build.mjs` | `buildManual(files, builtAt, availableImages)` → `{ chapters, sections, helpModule, printHtml }` / `chapterIdOf()` / `plainText()` / `PRINT_CSS` / `HELP_IMAGE_WIDTH = 400` |
| `apps/desktop/scripts/print-manual.mjs` | `printToPDF({ pageSize:'A4', landscape:false, printBackground:true, margins:MARGINS, generateDocumentOutline:true })` |
| `packages/board-model` | `SOCKET_ROLES = ['CR1','CR2','CR3','CR4','T1','T2','CHK']` / `MOUNTABLE_KINDS = ['relay-my4n','timer-h3y4']` / `DEFAULT_INVENTORY` |

### 前提C: 既存の作法（守ること）

| 作法 | 中身 |
|---|---|
| 文言 | 画面に出る文字はすべて `apps/desktop/src/renderer/i18n/ja.ts`（main 側は `src/shared/messages.ts`）。ヘルプ本文だけは生成物 `manual-content.ts` から来る |
| 型 | TS strict ＋ `exactOptionalPropertyTypes` ＋ `noUncheckedIndexedAccess`。import は `.js` 接尾辞 |
| 試験 | Vitest は `globals: false`。RTL のテストは `afterEach(cleanup)`。zustand への書き込みは `act()` の中 |
| 整形 | ESLint flat ＋ Prettier（`printWidth: 100`、`singleQuote`、`semi`、`trailingComma: 'all'`）。`docs/**` は `.prettierignore` の対象なので整形されない |
| カバレッジ | `packages/*` は行・分岐90%以上。`apps/desktop` に閾値は置かない（Task 29 で可視化だけ入れる） |
| 商標 | 各社のロゴ・アイコン・画面キャプチャ・マニュアル本文は複製しない（§17.1）。スキンの表題は「〜風」で終える |
| 生成物 | `src/renderer/help/manual-content.ts` は生成物。手で直さず `node scripts/build-manual.mjs` で作り直す |
| 課題の複写 | 課題JSONを足したら **`node apps/desktop/scripts/copy-content.mjs` を手で1回**走らせる（`dist` の中でしか走らない） |

### 前提D: git の作法（**違反すると他タスクの作業が消える**）

2026-09-19 に `git stash` で並行タスクの作業が失われた事故があった。以下は**すべてのタスクで禁止**である。

- `git stash` / `git stash pop`
- `git reset --hard` / `git checkout -- <path>` / `git clean`
- `git commit --amend` / `git rebase -i`
- 自分が触っていないファイルの `git add` / `git restore --staged`
- `git pull --rebase`（作業ツリーに他タスクの未コミット変更があるとき）

**やること**: 並行して走るタスクは **worktree**（`git worktree add ../OJT-wt-taskNN`）で作業する。共有ツリーで commit するときは**対象パスを明示**して `git commit --only -- <paths>` を使う。共有ツリーが fast-forward できないときは `git format-patch` で patch を作り、使い捨ての worktree で `git am` してから push する。**ビルド（`pnpm build` / `dist` / `e2e`）は必ず worktree で行う**（`e2e` は追跡対象の図を書き換える。QA-02）。

### 前提E: 本プランが触る共有ファイル（MERGE 注意の対象）

| ファイル | 触るタスク | 調停 |
|---|---|---|
| `src/renderer/i18n/ja.ts` | 3, 7, 20, 21, 22, 23, 24, 25, 26, 27, 28, 32 | **末尾に新ブロックを足す**形にし、既存キーの削除は Task 12 だけが行う |
| `src/renderer/app/store.ts` | 11（分割）、その後は分割後のスライス | **Task 11 が landed するまで store.ts を触らない**。Task 11 は公開面（`useStore` の型）を変えない |
| `src/renderer/screens/Session.tsx` ほか3画面 | 7, 11, 24, 25, 27 | Task 11 の共通シェル切り出しを先に landed させ、以降は抜け殻に対して足す |
| `src/renderer/three/BoardScene.tsx` | 6, 16, 17, 19, 27 | 16 → 17 → 27 の順に直列。19 は `ViewGizmo.tsx` だけを触る |
| `src/renderer/ladder/**` | 2, 3, 15, 20, 21, 22 | 2 → 3 → 15 が先、20 → 21 → 22 が後（バッチEはバッチDのあと） |
| `packages/content/src/builtin/index.ts` | 13, 18 | 13（B・C1）→ 18（C2・D）の直列 |
| `apps/desktop/package.json` | 29, 31, 34, 38 | `scripts` と `devDependencies` だけ。順に直列 |
| `apps/desktop/electron-builder.yml` | 8, 31 | 8 → 31 の順 |
| `docs/manual/*.md` ＋ `coverage.json` | 33, 34, 35, 36 | バッチH内で直列 |
| `docs/superpowers/specs/2026-09-13-…design.md` | 14（§5.2・§13#3）、33（§14.2・§15・§17・改訂履歴）、26（§8.2） | 節が重ならないので並行可。ただし改訂履歴の行は Task 33 が1回だけ足す |

---

## ファイル構成（新規に作るもの）

| ファイル | 責務 | Task |
|---|---|---|
| `packages/content/src/schema/difficulty.ts` | `DifficultySchema` / `ProblemTagSchema` | 4 |
| `packages/content/scripts/validate.ts` | 課題JSONの検証CLI | 4 |
| `packages/content/src/builtin/assemble/b-009…b-020.json` | モードB 新12題 | 13 |
| `packages/content/src/builtin/inspect-parts/c1-005…c1-012.json` | モードC1 新8題 | 13 |
| `packages/content/src/builtin/inspect-repair/c2-009…c2-020.json` | モードC2 新12題 | 18 |
| `packages/content/src/builtin/plc/d-009…d-020.json` | モードD 新12題 | 18 |
| `apps/desktop/src/main/fs-atomic.ts` | 原子的書き込みの1本化 | 9 |
| `apps/desktop/test/hardening.test.ts` / `ipc-surface.test.ts` | ハードニングの固定 | 8 |
| `apps/desktop/src/renderer/app/errors.ts` | `reasonOf()` の1本化 | 11 |
| `apps/desktop/src/renderer/app/focus-trap.ts` | `trapFocus` の1本化 | 11 |
| `apps/desktop/src/renderer/session/use-session-runtime.ts` | 効果音・経過タイマ | 11 |
| `apps/desktop/src/renderer/session/work-file.ts` | 保存・読込 | 11 |
| `apps/desktop/src/renderer/panels/StepGuide.tsx` ＋ `step-guide.module.css` | 手順帯の1本化 | 11 |
| `apps/desktop/src/renderer/screens/NoProblem.tsx` | 空表示 | 11 |
| `apps/desktop/src/renderer/result/ResultShell.tsx` | 結果画面の外殻 | 11 |
| `apps/desktop/src/renderer/app/store-{session,schematic,ladder,ui}.ts` | ストアの4スライス | 11 |
| `apps/desktop/test/helpers/worker-bridge.ts` | 13複写の集約 | 12 |
| `apps/desktop/src/renderer/three/view-gizmo-{layout,paint}.ts` ＋ `use-gizmo-drag.ts` | ビューキューブの分割 | 19 |
| `apps/desktop/src/renderer/three/WirePreview.tsx` | 配線のプレビュー | 27 |
| `apps/desktop/src/renderer/panels/HoverHint.tsx` | ホバー予告の1行 | 27 |
| `apps/desktop/src/renderer/tour/{TourOverlay.tsx,tour-store.ts,tour.module.css}` | 初回ガイド | 28 |
| `apps/desktop/src/renderer/result/verdict-summary.ts` | 「なぜ落ちたか」1行 | 25 |
| `apps/desktop/src/renderer/session/replay.ts` ＋ `panels/ReplayBar.tsx` | 判定の操作列を1歩ずつ再生（PR-12） | 39 |
| `apps/desktop/src/renderer/result/{CompareView.tsx,compare.ts,compare.module.css}` | 模範との並置比較（PR-13） | 40 |
| `apps/desktop/src/renderer/result/report-html.ts` ＋ `apps/desktop/src/main/result-export.ts` | 結果の1枚書き出し（PR-14。IPC 9本目） | 41 |
| `.github/workflows/ci.yml` | CI | 29 |
| `apps/desktop/e2e/app.ts` | E2E の起動定型 | 30 |
| `apps/desktop/e2e/direct-manipulation.spec.ts` | 3D直接操作のE2E | 27 |
| `apps/desktop/e2e/ladder-entry.spec.ts` | 4方言の記号入力のE2E | 21 |
| `apps/desktop/test/check-dist.test.ts` / `copy-content.test.ts` | 配布ゲートの実行 | 31 |
| `CONTRIBUTING.md` / `LICENSE` / `packages/*/README.md` | 規約と条件 | 33 |
| `docs/manual/13-tutorial-modes.md` / `14-tutorial-features.md` | チュートリアル章 | 35 |
| `apps/desktop/test/manual-pdf.test.ts` / `manual-problem-index.test.ts` | PDFのリンクと課題索引 | 34, 35 |
| `docs/releases/v1.1.0.md` | リリースノート | 38 |

---

## 実装バッチ

依存関係にもとづく9バッチ。バッチ内の `／` は並行可、`→` は直列。**並行は3系統まで**。各バッチの終わりに **Opus レビューを1回**かけ、細かい指摘はまとめて1回で直す（所有者の方針 2026-09-19）。

| バッチ | タスク | 系統 | 狙い | モデル |
|---|---|---|---|---|
| **A** | 1 | 1 | インストーラのライセンス文字化け（最優先・単独） | 1=Sonnet |
| **B** | 2 → 3 ／ 5 → 6 ／ 7 | 3 | 学習者が通常操作で踏む欠陥をゼロにする | 2,3,5,7=Sonnet / 6=**Opus** |
| **C** | 8 → 9 ／ 10 → 4 ／ 11 → 12 | 3 | 信頼境界を塞ぎ、以降が乗る土台（共通シェル・ストア）を作る | 8,11,4=**Opus** / 9,10,12=Sonnet |
| **D** | 16 → 17 → 15 ／ 14 ／ 13 → 18 | 3 | まず測れるようにして性能を直し、課題を72題に増やす | 16,17,15,13,18=**Opus** / 14=Sonnet |
| **E** | 19 ／ 20 → 21 → 22 | 2 | ビューキューブの不具合と、純正ツールの忠実な再現 | すべて**Opus** |
| **F** | 27 → 28 ／ 23 → 24 → 26 ／ 25 → **39** → **40** | 3 | 3Dの直接操作と全画面のUI/UX刷新、判定の再生と並置比較 | 23=Sonnet / 他すべて**Opus** |
| **G** | 29 → 30 → 31 ／ 32 → 33 ／ **41** | 3 | 直したことが戻らない仕組み（CI・E2E・配布ゲート・文書）と結果の書き出し | 29,30,31,41=**Opus** / 32,33=Sonnet |
| **H** | 34 → 35 → 36 | 1 | **説明書の体裁・チュートリアル章・図の撮り直し（最後から2番目）** | 34,36=**Opus** / 35=Sonnet-verbatim |
| **I** | 37 → 38 | 1 | 全体検証とリリース | 両方**Opus** |

**進め方**: A → B → C → D → E → F → G → H → I。

**タスク番号の並びについて**: Task **39・40・41** は 2026-09-20 の所有者決定で後から足したもの（PR-12 / PR-13 / PR-14）で、**番号は 38 より大きいが実行はバッチ F・G、つまり Task 37・38 より前**である。既に走り始めた番号を振り直すと進捗報告（`X/41`）と引き継ぎが食い違うので、あえて振り直していない。**Task 37（全体検証）と Task 38（v1.1.0 リリース）は常に最後の2つ**であり、39〜41 が landed していなければ 37 を始めない。

**バッチHを最後から2番目に置く理由**（利用者の要望10）: 図はすべての画面直し（バッチB〜G）が landed してから1回だけ撮る。撮り直しを忘れた古い図が残るほうが害が大きい。

**並行が安全である理由**:

- **B**: 2・3 は `renderer/ladder/**` と `plc-dialects`、5 は `packages/content` と `schematic-core`、6 は `board-model` と `renderer/three`、7 は `screens`/`panels`/`i18n`。`i18n/ja.ts` は 3 と 7 が触るが**どちらも末尾に足すだけ**。
- **C**: 8・9 は `src/main/**`、10 は `packages/{circuit-sim,content}` と `worker/`、11・12 は `renderer/app` と `renderer/screens`。4 は `packages/content/src/schema`（10 と同じパッケージだが別ファイル。10 → 4 の直列にしてある）。
- **D**: 16・17・15 は `renderer/three` と `worker`、14 は `packages/*` の純関数、13・18 は `packages/content/src/builtin`。
- **F**: 27・28 は `renderer/three` と `renderer/tour`、23・24・26 は CSS とパネル、25・39・40 は `screens/Home`・`ProblemList`・`result` と新規の `session/replay.ts`。`i18n/ja.ts` は3系統とも末尾に足す。25 → 39 → 40 を直列にしているのは3本とも `result/ResultView.tsx` に入口を足すため。
- **G**: 29・30・31 はビルドと E2E の足場、32・33 はヘルプと文書、41 は `shared/ipc.ts` ＋ `src/main/` ＋ `result/`。41 が触る `test/ipc-surface.test.ts` は Task 8（バッチC）が作るので、バッチG の時点では landed している。

---

## Task 1: インストーラのライセンス表示の文字化けを直す

**モデル: Sonnet**（原因も直し方も特定済み。判断は要らない）
**指摘: QA-07 ／ 利用者要望4**

**Files:**
- Modify: `apps/desktop/build/license.txt`
- Modify: `.gitattributes`
- Modify: `apps/desktop/test/release-content.test.ts`

**前提:** この2ファイルには**未コミットの変更が既にある**（作業ツリーで確認済み）。**破棄しないこと**。`git diff -- apps/desktop/build/license.txt apps/desktop/test/release-content.test.ts` で現状を読んでから、足りない分だけ足す。

**Steps:**

- [ ] 1. 現状を確かめる。

```bash
git diff --stat -- apps/desktop/build/license.txt apps/desktop/test/release-content.test.ts
od -An -tx1 -N 8 apps/desktop/build/license.txt
# 期待: 先頭が ef bb bf（UTF-8 BOM）。e9 9b bb で始まっていたら BOM 無し＝要修正
```

- [ ] 2. BOM が無ければ付ける（**本文は1文字も変えない**）。

```bash
node -e "const fs=require('fs');const p='apps/desktop/build/license.txt';const b=fs.readFileSync(p);if(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF){console.log('already BOM');process.exit(0)}fs.writeFileSync(p,Buffer.concat([Buffer.from([0xEF,0xBB,0xBF]),b]));console.log('BOM added')"
```

- [x] 3. `.gitattributes` の末尾に1行足す（git の改行正規化で BOM が剥がれるのを止める）。

```
apps/desktop/build/license.txt -text
```

- [ ] 4. `apps/desktop/test/release-content.test.ts` に検査を足す（既にあれば足さない）。

```ts
  it('NSIS のライセンス表示ファイルが UTF-8 BOM 付きである（QA-07。無いと CP932 と誤解されて化ける）', () => {
    const bytes = readFileSync(join(DESKTOP_DIR, 'build', 'license.txt'));
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const text = bytes.toString('utf8').replace(/^\uFEFF/u, '');
    expect(text).toContain('電気教育ツール');
    expect(text).not.toContain('\uFFFD');
  });

  it('.gitattributes が license.txt の改行変換を止めている（BOM 剥がれの再発防止）', () => {
    const attrs = readFileSync(join(REPO_ROOT, '.gitattributes'), 'utf8');
    expect(attrs).toMatch(/apps\/desktop\/build\/license\.txt\s+-text/u);
  });
```

- [ ] 5. 検証。

```bash
pnpm --filter @ojt/desktop test -- release-content
# 期待: 該当2件を含めて全件 pass
pnpm lint && pnpm typecheck
# 期待: どちらも無警告
```

- [ ] 6. **実物で確かめる**（worktree で）。`pnpm --filter @ojt/desktop dist` を走らせ、`release/` にできたインストーラを起動してライセンス画面を目視する。化けが残る場合は `license.txt` を `license.rtf`（RTF は `\'82\'a0` 形式で日本語を持てる）に置き換え、`electron-builder.yml` の `nsis.license` で明示する。**この確認結果を Task 38 のリリース手順チェックリストに書き写す。**

**期待:** `od` が `ef bb bf` を示し、テスト2件が緑。インストーラのライセンス画面が日本語で読める。

---

## Task 2: モードDのラダー編集の4つの罠を塞ぐ

**モデル: Sonnet**（レポート §5 Batch 1 に修正手順が逐語であり、判断は要らない）
**指摘: LE-1（Critical）／ LE-2（Critical）／ LE-3 ／ LE-5 ／ LC-1**

**Files:**
- Modify: `apps/desktop/src/renderer/session/ladder.ts`
- Modify: `apps/desktop/src/renderer/app/store.ts`（**Task 11 より前なので触ってよい。触るのは `undoLadderEdit`/`redoLadderEdit` の2関数だけ**）
- Modify: `apps/desktop/src/renderer/ladder/LadderEditor.tsx`
- Modify: `packages/ladder-core/src/compile.ts`
- Modify: `apps/desktop/test/ladder-editor.test.tsx` / `ladder-workspace.test.tsx` / `ladder-model.test.ts`
- Modify: `packages/ladder-core/test/compile.test.ts`

**Steps:**

- [x] 1. **LE-1**: `session/ladder.ts` の `keyChord()`／`matchShortcut()` の手前に、末尾1文字のキーを大文字へ畳む関数を入れる。

```ts
/**
 * キー名の畳み込み。`KeyboardEvent.key` は英字キーで `Shift` の有無により大小が変わるが、
 * 方言のキー割当表（`C` / `O` / `I` など）は大文字で書いてある。1文字のキーだけ大文字へ
 * 畳むことで、`c` でも `C` でも同じ行に当たるようにする。機能キー（`F5`）や
 * `Escape` のような複数文字のキーは畳まない（`f5` のような入力は存在しない）。
 * 指摘 LE-1（Critical）。
 */
export function foldKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}
```

`keyChord()` の中で `event.key` を `foldKey(event.key)` に通し、`expandKeys()` の側でも表の末尾キーを `foldKey()` に通す（両端を畳まないと `/` のような記号が壊れる）。

- [x] 2. **LE-2**: `store.ts` の `undoLadderEdit()` / `redoLadderEdit()` で、復元したプログラムに合わせてカーソルを丸める。復元後の `networkId` が無ければ先頭のネットワークへ、`row`/`col` は `Math.min(row, rows-1)` / `Math.min(col, cols-1)` に丸める。あわせて `LadderEditor.tsx:152` 付近の `net.cells[row][col]` を `net.cells[row]?.[col]` にし、`undefined` のときは `edit` アクションを捨てる。
- [x] 3. **LE-3**: `session/ladder.ts` の `applyLadderCell()` / `clearLadderCell()` / `applyRuleLine()` の先頭に「対象セルが `end` なら何もせず `'end-locked'` を返す」を足す。`LadderEditor` はそれを受けてトーストを出す。文言は `i18n/ja.ts` に `JA.ladder.endLocked = 'END は消せません。ネットワークごと消すには「ネットワーク削除」を使います。'`。
- [x] 4. **LC-1**: `packages/ladder-core/src/compile.ts` に「END を含むネットワークに END 以外の中身があれば `after-end`」を足す（いまは `no-output` も抑止されるうえランタイムが `break` するので**一度も実行されない回路が「変換成功」になる**）。
- [x] 5. **LE-5**: `LadderEditor.tsx` の `onCommit` のカーソル送りを `const step = isBranch ? 2 : 1;` にし、OR接点の直後は「閉じ側の縦線の次」へ置く。
- [x] 6. テストを足す。

```
apps/desktop/test/ladder-editor.test.tsx
  - 小文字のキーイベント（{ key: 'c' }）で OMRON の a接点入力欄が開く（LE-1）
  - 4スキン全部で「表の enabled !== false の全行が ladderKeyToAction() で none 以外になる」（LE-1 / LE-8 の網羅）
  - 行を挿入 → 下の行へ移動 → Ctrl+Z → Enter で例外が出ない（LE-2）
apps/desktop/test/ladder-workspace.test.tsx
  - END セルにカーソルを置いて Delete / F5 を押しても END が残り compile() が missing-end にならない（LE-3）
apps/desktop/test/ladder-model.test.ts
  - OR分岐直後のカーソルが「閉じ側の縦線の次」（LE-5）
packages/ladder-core/test/compile.test.ts
  - END と同じネットワークに置いた回路が after-end で弾かれる（LC-1）
```

**期待:** 上記5件が緑。`pnpm --filter @ojt/desktop test` と `pnpm --filter @ojt/ladder-core test` が全件 pass。

---

## Task 3: 方言の誤変換と「嘘の案内」を直す

**モデル: Sonnet**
**指摘: LE-4 ／ LE-6 ／ LE-7 ／ LE-8 ／ LE-9 ／ LE-12 ／ LE-13 ／ LE-14 ／ PD-1 ／ PD-2**

**Files:**
- Modify: `packages/plc-dialects/src/{profile.ts,mitsubishi.ts,omron.ts,jtekt.ts,sharp.ts,device-rules.ts}`
- Modify: `apps/desktop/src/renderer/session/{ladder-cell.ts,plc-skin.ts,ladder.ts}`
- Modify: `apps/desktop/src/renderer/ladder/{DeviceInput.tsx,MonitorPanel.tsx,LadderEditor.tsx}`
- Modify: `apps/desktop/src/renderer/screens/PlcSession.tsx`
- Create: `apps/desktop/src/renderer/ladder/ladder-errors.ts`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（**末尾に足すだけ**）

**Steps:**

- [x] 1. **LE-4**: `ladder-cell.ts` の `timerPresetMs()` の判定順を `parseCounterPreset` と同じ「方言 → 素の数値」に入れ替える。いまは素の数値が先に当たるのでシャープ（4桁10進・0.1s刻み）で `0030` が 30ms と読まれ、往復で 1/100 に化ける。
- [x] 2. **LE-6**: `DialectProfile` に任意メンバ `timerBaseMs?(device: Device): number` を足し、三菱だけが実装する。`ladder-cell.ts` の丸め提示は `profile.timerBaseMs?.(device) ?? profile 既定の刻み` を使う。これで OMRON/JTEKT/シャープに**存在しない1ms刻みの丸め**を提示しなくなる。
- [x] 3. **LE-7**: `plc-skin.ts` に `monitorStartLabel(profile): string` を足す。`profile.shortcuts` に `monitor` 行があればそのキー、無ければ `profile.panels.toolbar` のモニタ項目名を返す。`MonitorPanel.tsx:81-84` の `?? 'F3'` を消す。
- [x] 4. **LE-8**: `omron.ts` の `instruction` は Task 20 で**実際に動かす**。`online-edit` / `transfer` の2行に `enabled: false` と `note`（「本アプリはPLCと通信しないため、この操作はできません」）を足す。
- [x] 5. **PD-1**: `device-rules.ts` に `normalizeDeviceText(text: string): string`（`text.normalize('NFKC').trim().toUpperCase()`）を置き、4方言の `parseDevice` / `parseTimerPreset` / `parseCounterPreset` の先頭から呼ぶ。全角の `Ｘ０` `Ｋ３０` が通るようになる。エラー文言に「全角で入力されています」の助言を足す。
- [x] 6. **PD-2**: `mitsubishi.ts` の `timerPreset()` と `timerErrorCode()` の条件式の二重実装を1本の述語に寄せる。
- [x] 7. **LE-12**: `DeviceInput.tsx` の `onKeyDown` の先頭に `if (event.nativeEvent.isComposing) return;` を足し、設定値欄・リセット欄にも同じハンドラを共有させる。
- [x] 8. **LE-13**: `session/ladder.ts` の `builtinAction()` に `Escape → { type: 'blur' }` を足し、`LadderEditor` が `blur()` する。`ShortcutHelp` に「Esc でエディタから出ます」の1行を足す。
- [x] 9. **LE-9**: `ladder-errors.ts` を作り、`CompileErrorCode` → 平易な日本語の写像を置く。`packages/ladder-core` の `edit.ts` / `compile.ts` が返す `code` を画面の直前でこの写像に通す。`§10.3` のような節番号と `n1 (0, 1)` のような内部識別子を画面に出さない。
- [x] 10. **LE-14**: `PlcSession.tsx:649-676` の `onSave` / `onLoad` / `applyWorkFile` の Promise に `.catch` を足し、トーストに落とす（`LadderWorkspace.exportIl()` と同じ形）。

**期待:**

```bash
pnpm --filter @ojt/plc-dialects test
# 期待: parseDevice('Ｘ０') / parseTimerPreset('Ｋ３０') が4方言で通る（PD-1）
pnpm --filter @ojt/desktop test -- ladder-cell ladder-panels plc-skin
# 期待: 4方言で formForCell → buildCell の往復が元のセルと等しい（LE-4）
#       monitorStartLabel() が存在しないキーを返さない（LE-7）
```

---

## Task 4: 課題スキーマの拡張（難易度・学習テーマ）と検証CLI

**モデル: Opus**（スキーマ設計と既存28題への難易度付与は判断を要する）
**指摘: —（利用者要望2の土台）／ PR-15 の代替**

**Files:**
- Create: `packages/content/src/schema/difficulty.ts`
- Modify: `packages/content/src/schema/common.ts` / `index.ts`
- Create: `packages/content/scripts/validate.ts`
- Modify: `packages/content/package.json`（`"validate": "tsx scripts/validate.ts"`）
- Modify: 既存28題の JSON（`difficulty` と `tags` を足す）
- Modify: `packages/content/test/schema.test.ts`（新規検査）
- Modify: `docs/manual/10-authoring.md`（CLIの説明を1節）

**Steps:**

- [x] 1. `difficulty.ts` に本設計 §4.3 の `DifficultySchema`（`z.int().min(1).max(5)`）と `ProblemTagSchema`（14値の `z.enum`）をそのまま書く。
- [x] 2. `ProblemHeaderShape` に `difficulty: DifficultySchema.default(3)` と `tags: z.array(ProblemTagSchema).max(6).default([])` を足す。**`CONTENT_FORMAT_VERSION` は 1 のまま**。`z.strictObject` なので JSON 側に書いても書かなくても通ることをテストで固定する。
- [x] 3. 既存28題に `difficulty` と `tags` を手で付ける。目安は 3級=1〜2 / 2級=2〜4 / 1級=4〜5。`tags` は本設計 §4.4 の表の「新しく効く軸」に対応させる。
- [x] 4. `packages/content/scripts/validate.ts` を書く。引数はファイルまたはフォルダ。やること: `parseProblem()` → モード別の自己整合検査（B/C2 は `judgeReference`、D は `judgePlcReference`、C1 は `expectedCheckReading` との突き合わせ）→ `startsAndEndsLow()` → 1件1行の日本語出力。終了コードは失敗件数。
- [x] 5. `package.json` に `"validate"` を足し、`docs/manual/10-authoring.md` に「作った課題を確かめる」節を足す（**指導者向けの平易な日本語**。禁止語リスト `style.json` に掛かることに注意）。
- [x] 6. テスト。

```
packages/content/test/schema.test.ts
  - difficulty / tags を書かない JSON がそのまま通り、既定値（3 / []）が入る
  - difficulty: 0 / 6 が弾かれる
  - 未知の tag が弾かれる
  - CONTENT_FORMAT_VERSION が 1 のままである（バージョンを上げていないことの明示）
packages/content/test/validate-cli.test.ts（新規）
  - 壊れた JSON を渡すと終了コードが 1 以上になり、理由が日本語で出る
  - 内蔵28題を全部渡すと終了コード 0
```

**期待:** `pnpm --filter @ojt/content test` 全件 pass。`pnpm --filter @ojt/content validate src/builtin` が `0 件の問題` で終わる。

---

## Task 5: 課題データが黙って別物になる経路を塞ぐ

**モデル: Sonnet**（レポート §5 Batch 1 手順4に逐語の指示がある）
**指摘: CS-01（High）／ CT-01（High）／ SC-01（High）／ SC-02（High）／ CT-02 ／ CT-03 ／ CT-04 ／ CT-05 ／ SC-03 ／ SC-04**

**Files:**
- Modify: `packages/circuit-sim/src/tester.ts`
- Modify: `packages/content/src/schema/judge.ts` / `schema/plc.ts` / `judge-inspect.ts` / `judge.ts` / `judge-plc.ts` / `faults.ts` / `random-faults.ts`
- Modify: `packages/schematic-core/src/assign.ts` / `symbols.ts` / `layout.ts` / `edit.ts` / `document.ts`
- Modify: 対応するテスト

**Steps:**

- [x] 1. **CS-01**: `tester.ts:285-314` の `cachedMeasure` / `ohmCache` を**削除**する。Worker 側の間引きが既に効いているので性能は落ちない。回帰テスト: 同一tickで `readTester(OHM)` → `injectFault(coil-open)` → `readTester` が `OL` になること。
- [x] 2. **CT-01**: `StaticChecksSchema` の各フィールドから個別の `.default()` を外し、`judgeSettings()` 側でモード既定（`DEFAULT_STATIC_CHECKS` / `PLC_DEFAULT_STATIC_CHECKS`）とマージする。回帰テスト: `PlcJudgeSettingsSchema.parse({ staticChecks: { wireColorRule: false } })` が PLC 3チェック（`twoStage` / `plcPowerIndependent` / `ioAssignment`）を `true` のまま返すこと。
- [x] 3. **SC-01 ／ SC-04**: `assign.ts:314` を `Object.hasOwn(override, cell.id) ? … : undefined` にする。`document.ts` の `DEVICE_PATTERNS[cell.kind]` と `CELL_KIND_LABELS` も同じ形にする。**正規表現によるID制限は入れない**（レポートの明示）。
- [x] 4. **SC-02**: `terminalMarks(doc, override?)` が `physicalOverride` を受け取れるようにし、`layout.ts:283` と `LayoutOptions` に受け渡し口を足す。図に刷る端子番号と判定が使う端子を一致させる。
- [x] 5. **SC-03**: `edit.ts` の `presetProblem()` に `snapPresetToStep` 検査を足し、`PRESET_STEP_MS` の源を `schematic-core` に寄せる。
- [x] 6. **CT-02**: `findUnknownCompareSignalIssues()` と `findDeadReferenceIssue()` を共通ヘルパに切り出し、B・C2・D の3判定から呼ぶ（`judge.ts` と `judge-plc.ts` は現在まったく同じ実装）。
- [x] 7. **CT-03**: `applyFaults()` の `targeted` を部品にも広げ、同じ部品に2つの部品故障がある課題を**課題エラー**にする。
- [x] 8. **CT-04**: `random-faults.ts:229-235` で `seed` が明示されているときは壁時計（`Date.now()`）の時間予算を外す。決定論（§5.2）を回復する。
- [x] 9. **CT-05**: `plc.ts:326-335` の検査を `resolveCompareSignals()` の**結果**に対して走らせる。
- [x] 10. テストはレポート §5 Batch 1「追加すべきテスト」の該当行をそのまま入れる（デビエーションは実装報告を参照）。

**期待:** `pnpm --filter @ojt/circuit-sim test` / `@ojt/content` / `@ojt/schematic-core` が全件 pass。カバレッジ90%を維持。

---

## Task 6: 盤の経路と3Dの取り違えを直す

**モデル: Opus**（机上経路のレーン設計は幾何の判断を要する）
**指摘: BM-01（High）／ BM-02（High）／ BM-03 ／ BM-04 ／ 3D-07 ／ 3D-21**

**Files:**
- Modify: `packages/board-model/src/desk-routing.ts`
- Modify: `apps/desktop/src/renderer/three/ProbeMarkers.tsx` / `BoardScene.tsx` / `Wire.tsx`
- Modify: `packages/board-model/test/desk-routing.test.ts`
- Create: `apps/desktop/test/probe-markers.test.ts`

**Steps:**

- [x] 1. **BM-04 を先に**: `deskRouteIssues()` に検査を足し、**先にテストが落ちる状態**にする。検査は4つ。①同じ帯の2本が `MIN_CABLE_GAP_MM` 未満で並走していない ②同じレーンに2本以上載っていない ③幹線の x が `BOARD_WIDTH_MM` 未満に入っていない ④行ダクトの y が 0 以上でない。テストケースは「`P.1 → PLC.SS` と `N.1 → PLC.COM0` の2本」「同じ帯から `CHANNEL_LANE_COUNT + 1` 本」「机上配線19本」。
- [x] 2. **BM-01**: 引き出しのずらしを「その帯に出す机上電線の**実数**で中央そろえ」に変える。2本のときは ±(間隔/2)。
- [x] 3. **BM-02**: レーンが一巡したら走行高さを一段上げる `layer` を導入する（`lane = i % LANE_COUNT`, `layer = Math.floor(i / LANE_COUNT)`、高さ `Z0 + layer * LAYER_STEP_MM`）。
- [x] 4. **BM-03**: 幹線レーンにも上限と高さ段上げを入れる。
- [x] 5. **3D-07**: `ProbeMarkers` に `board: BoardDefinition` を prop で受け取らせ、`BoardScene.tsx:750` で渡す。モードDの `PLC.*` / `OUTLET.*` のハイライトが `catch` で黙って消えるのを止める。
- [x] 6. **3D-21**: `Wire.tsx` の `buildTubeGeometry()` の**冒頭**に `route.points.length < 2` のガードを移す（いまはジオメトリ生成の後にあるので空経路で3Dごと落ちる）。

**期待:**

```bash
pnpm --filter @ojt/board-model test -- desk-routing
# 期待: 新3ケースを含めて deskRouteIssues() が [] を返す
pnpm --filter @ojt/desktop test -- probe-markers
# 期待: モードDの派生盤で PLC.X0 / OUTLET.L のハイライトが座標を返す
```

---

## Task 7: 押せない理由・嘘の案内・内部識別子を直す

**モデル: Sonnet**（レポート §5 Batch 1 手順3・6に逐語の指示がある）
**指摘: UI-01（High）／ DS-1（High）／ UX-01（High）／ UX-03（High）／ UX-04（High）／ UX-06 ／ UX-22 ／ UI-04 ／ UI-14 ／ UX-24 の①②③**

**Files:**
- Modify: `apps/desktop/src/renderer/screens/{InspectPartsSession.tsx,Session.tsx,InspectRepairSession.tsx}`
- Modify: `apps/desktop/src/renderer/app/store.ts`（`switchDialect()` の1行。Task 11 より前）
- Modify: `apps/desktop/src/renderer/app/global.css`
- Modify: `apps/desktop/src/renderer/panels/Toolbar.tsx`
- Modify: `apps/desktop/src/renderer/schematic/SchematicView.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（末尾に足す＋既存2キーの文言訂正）
- Modify: `docs/manual/04-mode-c1.md`（UX-01 の説明文）

**Steps:**

- [x] 1. **UI-01**: `InspectPartsSession.tsx:201` を `const tester = useStore.getState().tester;` に直す（購読値ではなく最新値を読む）。Ωレンジのまま部品を挿し替えるとプローブが Worker に再配置される不具合が止まる。
- [x] 2. **DS-1**: `store.ts:1504` の `switchDialect()` の `set({...})` に `sessionEpoch: get().sessionEpoch + 1,` を足す。表記切替後も Worker が旧機種のネットリストを回すのを止める。
- [x] 3. **UX-01**: `i18n/ja.ts` の `disabledReason.zeroAdjust` を**実際の条件**に直す（「アナログテスターのΩ／導通レンジのときだけ 0Ω 調整ができます」）。`docs/manual/04-mode-c1.md` の該当文も直す。
- [x] 4. **UX-03 ／ UX-06**: 押せないボタンを `disabled` から **`aria-disabled="true"` ＋ `.srOnly` の理由 ＋ 押したときのトースト**に揃える（Chromium は `disabled` な要素に `title` を出さない）。`global.css` に `button[aria-disabled='true'] { opacity: .45; cursor: default; }` を足す。対象は「判定」「元に戻す」「やり直し」。
- [x] 5. **UX-04**: `Session.tsx:664` 付近で `assembleView` を見て手順帯を差し替える（回路図エディタを開いているときに「部品装着 いまここ」を出さない）。
- [x] 6. **UX-22**: C2 の「故障の種別を選ぶ」窓に1行足す（「端子には『未配線』だけを出しています。断線・誤配線は電線を、部品不良は部品をクリックしてください」）。`docs/manual/05-mode-c2.md` にも対応表を足す。
- [x] 7. **UI-04**: `Session.tsx:362, 870` と `routeFailedLog()` を `wireLabel(wire)`（`CR1.9–PB1.2c の青線`）経由にする。状態オーバーレイと操作ログから `w-003` を消す。
- [x] 8. **UI-14**: `SchematicView` の `aria-label` を `onPickCell` の有無で分ける（単クリックで拡大しない画面に「クリックまたは Enter で拡大表示」と読み上げさせない）。
- [x] 9. テスト。`session.test.tsx`: 状態オーバーレイの文言が `w-\d{3}` に一致しないこと。`inspect-parts-flow.test.tsx`: Ωレンジ＋両プローブの状態で `setCheckPart('P2')` を起こしても `bridge.send` に `place-probe` が送られないこと。`store-plc.test.ts`: `switchDialect()` 前後で `sessionEpoch` が増え `problem.id` は変わらないこと。`toolbar.test.tsx`: `aria-disabled` のボタンを押すとトーストが1回出ること。

**期待:** 上記4本のテストが緑。`pnpm --filter @ojt/desktop test` 全件 pass。

---

## Task 8: Electron のハードニングを仕上げる

**モデル: Opus**（`sandbox: true` の可否は preload の出力形式に関わる判断）
**指摘: DM-4 ／ DM-5 ≡ QA-05 ／ DM-7 ／ DM-9 ／ QA-06 ／ QA-18**

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/index.html`（CSP）
- Modify: `apps/desktop/electron.vite.config.ts`（preload を CJS 出力に）
- Modify: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/build/icon.ico`
- Create: `apps/desktop/test/hardening.test.ts` / `apps/desktop/test/ipc-surface.test.ts`
- Modify: `apps/desktop/scripts/check-dist.mjs`

**Steps:**

- [x] 1. **DM-4**（**2026-09-20 の所有者決定: (a) 有効化する。(b) の据え置き案は採らない**）: `electron.vite.config.ts` の preload に `{ format: 'cjs', entryFileNames: 'index.cjs' }` を足し、`main/index.ts` の `webPreferences.sandbox` を `true` にする。`main/index.ts` の `preload` パスを `index.cjs` に合わせる。preload が Node API を使っていないことを確認する（使っていれば IPC 経由へ移す）。**worktree で `pnpm --filter @ojt/desktop dist` まで通し、配布物（`release/win-unpacked`）を起動して全画面が動くことを確かめてから commit する**（開発ビルドだけの確認では不十分。sandbox の効き方が違う）。`hardening.test.ts` に `sandbox: true` の検査を入れる（Step 6）。
- [x] 2. **DM-5 ≡ QA-05**: `app.whenReady()` 内に `session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false))` を足す。`webPreferences` に `webviewTag: false` / `allowRunningInsecureContent: false` / `webSecurity: true` を明示する。`electron-builder.yml` に `electronFuses:` を足す（`runAsNode: false` / `enableNodeOptionsEnvironmentVariable: false` / `enableNodeCliInspectArguments: false` / `onlyLoadAppFromAsar: true` / `enableEmbeddedAsarIntegrityValidation: true` / `grantFileProtocolExtraPrivileges: false`）。
- [x] 3. **DM-9**: `index.html` の CSP に `; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'` を足す。
- [x] 4. **QA-06**: `apps/desktop/build/icon.ico` を1枚置く（16/32/48/64/128/256 のマルチサイズ。**盤とコンセントを想起させる本アプリ独自の図形**。ベンダーのアイコンは使わない）。`electron-builder.yml` の変更は不要。`check-dist.mjs` に存在チェックを足す。
- [x] 5. **QA-18**: `nsis:` に `allowElevation: false` を足す（README とリリースノートの「管理者権限は不要」を設定側で担保する）。
- [x] 6. **DM-7**: テスト2本を新設する。

```
apps/desktop/test/hardening.test.ts
  - src/main/index.ts のソース文字列に contextIsolation: true / nodeIntegration: false /
    sandbox: true / setWindowOpenHandler / will-navigate / Menu.setApplicationMenu(null) /
    setPermissionRequestHandler が含まれる
  - src/renderer/index.html の CSP に default-src / script-src / style-src / img-src /
    connect-src / base-uri / form-action / frame-src / frame-ancestors がすべて含まれる
apps/desktop/test/ipc-surface.test.ts
  - ipcMain.handle をスタブして registerIpc() を呼び、登録チャネルの集合が
    Object.values(IPC_CHANNELS) と完全一致する（8本以外が増えたら落ちる）
apps/desktop/test/release-content.test.ts に追記
  - build/icon.ico が存在し 4KB 以上
  - electron-builder.yml に allowElevation: false と electronFuses の6項目
```

**期待:** 上記3本が緑。worktree で `pnpm --filter @ojt/desktop dist` が通り、`ELECTRON_RUN_AS_NODE=1` で配布物を起動しても Node として動かないこと。

---

## Task 9: main の入口検査と書き込みの安全性

**モデル: Sonnet**（レポート §5 Batch 2 手順1・2・4に逐語の指示がある）
**指摘: DM-1 ≡ CT-06（High）／ DM-2 ／ DM-3 ／ DM-6 ／ DM-8 ／ DS-4 ／ CT-11**

**Files:**
- Create: `apps/desktop/src/main/fs-atomic.ts`
- Modify: `apps/desktop/src/main/{work-files.ts,settings.ts,text-files.ts,content-loader.ts}`
- Modify: `apps/desktop/src/shared/messages.ts`
- Modify: `apps/desktop/src/renderer/app/App.tsx`（自動保存の `.then`）
- Modify: `packages/content/src/loader.ts`
- Modify: 対応するテスト

**Steps:**

- [x] 1. **DM-1 ≡ CT-06**: `packages/content/src/loader.ts` の `loadOne()` 冒頭に `statSync(file).size > MAX_PROBLEM_BYTES`（2 MiB）の足切り、`collectJsonFiles()` に件数上限（2,000）。`main/content-loader.ts` の `readContent()` の前に `readdirSync` の件数を数え `MAX_USER_PROBLEM_FILES`（200）で足切りし、§13 #9 の警告行を返す。**同期実行で main を止めないよう `fs/promises` に移す**。
- [x] 2. **CT-11**: `loadOne` の重複ID検査を `problems.some(...)`（O(n²)）から `Set` に変える。
- [x] 3. **DM-2**: `work-files.ts` の `saveWorkFile()` 冒頭に `text-files.ts` と同じ3点（型チェック・`safeFileName()`・`Buffer.byteLength(text) > MAX_WORK_FILE_BYTES`）。`safeFileName()` は `shared/` へ共有化する。
- [x] 4. **DM-3**: `settings.ts:66` を `dir.length === 0 || (isAbsolute(dir) && dir.length <= 260)` の条件付きにする。
- [x] 5. **DM-6**: `src/main/fs-atomic.ts` を新設し、`openSync → writeFileSync → fsyncSync → closeSync → renameSync`、`catch` で `rmSync(temp, { force: true })` にまとめる。`work-files.ts` / `settings.ts` / `text-files.ts` の3重複を置き換える。
- [x] 6. **DM-8**: `shared/messages.ts` に `errno` → 日本語の対応表（`ENOENT` / `EACCES` / `EPERM` / `ENOSPC` / `EBUSY` / `EMFILE` / 既定）を置く。生の `String(cause)` は `console.error` にだけ出す（利用者名入りの絶対パスをトーストに出さない）。
- [x] 7. **DS-4**: `App.tsx:137-140` の自動保存の `void` を `.then` で受け、**連続失敗2回目で1度だけ**トーストを出す。文言は `i18n/ja.ts`。
- [x] 8. テストはレポート §5 Batch 2「追加すべきテスト」の該当行をそのまま入れる（`settings.test.ts` / `work-files.test.ts` / `content-loader.test.ts` / `loader-io-errors.test.ts`）。

**期待:** 利用者課題フォルダに1万件の `.json` を置いても UI が1秒以内に応答し、警告行が出ること。`renameSync` をモックで失敗させても `.tmp` が残らないこと。

---

## Task 10: エンジンとランタイムの防御

**モデル: Sonnet**
**指摘: CS-05 ／ CS-09 ／ CS-12 ／ CS-13 ／ CS-14 ／ CT-13 ／ CT-14 ／ DW-2 ／ PD-3 ／ SC-05**

**Files:**
- Modify: `packages/circuit-sim/src/{netlist.ts,simulation.ts,faults.ts,tester.ts}`
- Modify: `packages/content/src/schema/faults.ts` / `random-faults.ts` / `inspect-repair.ts`
- Modify: `packages/schematic-core/src/assign.ts`（JSDoc）
- Modify: `apps/desktop/src/worker/sim.worker.ts`
- Modify: `apps/desktop/src/renderer/session/work-file.ts`
- Modify: 対応するテスト

**Steps:**

- [x] 1. **CS-05**: `validateNetlist()` に部品ID・要素IDの重複検査を足す（`NetlistIssue.kind` に `duplicate-part-id` / `duplicate-element-id`）。
- [x] 2. **CS-09**: `step()` に `tickMs` と同じ検証（有限・正）、`run()` に有限性検査、コンストラクタで `validateNetlist()` を呼ぶ。
- [x] 3. **CS-12**: `range-exceeded` の重複判定キーに `kind`（digital/analog）と `ohmRange` を入れる。
- [x] 4. **CS-13**: `contact-welded` の注入が同じ組のもう一方の接点の既存故障を無言で上書きするのを止める（`??=` か `FaultError`）。
- [x] 5. **CS-14**: `wire-misrouted` に自己ループ検査と `exceedsWireLimit()` 検査を足す。
- [ ] 6. **CT-13**: `FaultsSchema` の union に親エラー文言を与える（非判別 union で両枝ぶん報告されるのを止める）。**Task 10 では未着手**（`packages/content/src/schema/faults.ts` はスキーマファイルのため対象外。Task 4 へ引き継ぐ）。
- [x] 7. **CT-14**: `ResolveFaultsResult` に `seed` を載せ、作業ファイルが `seed` を保存する形にする（再開のたびに別の故障になる契約を型で強制する）。
- [x] 8. **SC-05**: `assign.ts:542-549` の生成電線ID `sw-NNN` の契約を JSDoc に明記（「回路図を編集したら課題の `faults[].target.wireId` を取り直すこと」）。内蔵C2課題の `wireId` が実際に生成される集合に含まれることをテストで固定する。
- [x] 9. **DW-2**: `sim.worker.ts:446-651` の外側 `switch` の末尾に `default: command satisfies never; throw new Error(...)`。
- [x] 10. **PD-3**: `isDeviceLike()` に `kind === 'special'` のとき `SPECIAL_INDEXES.includes(index)` を足す。

**期待:** レポート §5 Batch 2「追加すべきテスト」の該当行が緑。`pnpm -r test` 全件 pass。

---

## Task 11: 共通シェルの切り出しとストアの分割

**モデル: Opus**（1,683行の god store を公開面を変えずに割る判断が要る）
**指摘: DS-3 ／ UI-05 ／ UI-06 ／ UI-07 ／ UI-13**

**Files:**
- Create: `apps/desktop/src/renderer/app/errors.ts` / `focus-trap.ts`
- Create: `apps/desktop/src/renderer/session/use-session-runtime.ts` / `work-file.ts`
- Create: `apps/desktop/src/renderer/panels/StepGuide.tsx` / `step-guide.module.css`
- Create: `apps/desktop/src/renderer/screens/NoProblem.tsx`
- Create: `apps/desktop/src/renderer/result/ResultShell.tsx`
- Create: `apps/desktop/src/renderer/app/store-{session,schematic,ladder,ui}.ts`
- Modify: `apps/desktop/src/renderer/app/store.ts`（スライスを束ねるだけの薄い入口にする）
- Modify: 4セッション画面・4結果画面・`TimeChartView.tsx` / `HelpDrawer.tsx` / `SchematicView.tsx`

**Steps:**

- [x] 1. **UI-05 を順に**: `errors.ts` に `reasonOf()` を1本化（8箇所の import 置換のみ）→ `use-session-runtime.ts` に `SoundEffects` と `useElapsedTicker()` → `StepGuide.tsx`（`steps` と `hint` を props に取る。3画面の各24行が1行になる）＋ `step-guide.module.css` 1本（**UI-07**。見た目を1種類に統一し、色をトークンへ寄せる）→ `work-file.ts` に `saveCurrentWork()` / `loadWorkFileAndApply()` → `NoProblem.tsx` → `ResultShell.tsx`（4結果画面を `children` だけにする。**UI-13** の `.stickyActions` 付け忘れがここで消える）。
- [x] 2. **UI-06**: `focus-trap.ts` に3実装を1本化する。**上位互換**にすること（`inside` 判定を持ち、`disabled` と `[hidden]` を除外する）。`TimeChartView` / `HelpDrawer` / `SchematicView` から使う。
- [x] 3. **DS-3**: `store.ts` を zustand のスライスパターンで4本に割る。`sessionFields()` を作り、`openProblem` / `restartSession` / `abandonSession` の初期値の源を1本化する。**`useStore` の型と公開面は変えない**（呼び出し側は無改修）。
- [x] 4. テスト。

```
apps/desktop/test/focus-trap.test.ts（新規）
  - フォーカスがパネル外にあるとき Tab で内側へ戻る
  - 先頭が disabled のとき次の有効な要素へ移る
apps/desktop/test/result-shell.test.tsx（新規）
  - 4つの結果画面がいずれも .stickyActions を持つ
apps/desktop/test/store.test.ts に追記
  - openProblem / restartSession / abandonSession が同じ sessionFields() から初期値を得る
  - 4スライスの公開キーの和集合が分割前の AppState のキー集合と一致する
```

- [x] 5. `grep` で複製が消えたことを確かめる。

```bash
grep -rn "function reasonOf" apps/desktop/src | wc -l   # 期待: 1
grep -rn "function trapFocus" apps/desktop/src | wc -l  # 期待: 1
grep -rln "stepGuide\|手順帯" apps/desktop/src/renderer/**/*.module.css  # 期待: step-guide.module.css のみ
```

**期待:** `pnpm --filter @ojt/desktop test` 全件 pass。`store.ts` が4スライスに分かれ、画面側の差分が import の変更だけであること。

---

## Task 12: 死にコード・二重管理・未使用文言の掃除

**モデル: Sonnet**（削除対象と方針がレポートに逐語で列挙されている）
**指摘: CS-06 ／ CS-07（代替）／ CS-10 ／ BM-06 ／ CT-08 ／ CT-09 ／ CT-12 ／ DW-3 ／ DS-5 ／ 3D-13 ／ 3D-14 ／ 3D-18 ／ 3D-20 ／ LE-16 ／ LE-17 ／ UI-11 ≡ LE-15 ／ UI-15 ／ QA-25**

**Files:** 上記IDの場所（レポート §4.3・§4.4 の表に `path:line` がある）
- Create: `apps/desktop/test/helpers/worker-bridge.ts` / `apps/desktop/test/i18n-keys.test.ts`

**Steps:**

> **DW-3 は Task 15 で済み（`9e1e666`）**: `worker/protocol.ts` の `{ type: 'reset' }` と
> `sim.worker.ts` の `case 'reset'`、それを唯一送っていた `test/sim-worker.test.ts` の検査を削除した。
> Task 12 はこの項目を飛ばしてよい（Task 10 の `default: command satisfies never` はそのまま残っている）。

- [x] 1. **死にコード・死にフィールド・非推奨エイリアス**を削る: `LoadElement.polarized`（CS-06。コメントを実装に合わせる）／バレルの export 漏れ2件（CS-10）と取りこぼし2件（CT-08）／`@deprecated` 3定数（BM-06）／`BUILTIN_PROBLEMS` の陳腐化コメント（CT-09）／`reset` コマンド（DW-3。テストごと削る）／`WorkerBridge.handlers`（DS-5）／`presetForDirection()`（3D-18。テスト5ケースを `gizmoTargetForDirection()` へ向け直す）／`receiveShadow`（3D-20）／互換 export 4本（LE-17）。
  - CT-09 done in Task 18 db313e1（`BUILTIN_PROBLEMS` の陳腐化コメントは書き換え済み。ここでは扱わない）。
- [x] 2. **3D-13**: 印字テクスチャのキャッシュ4方針（`AcFixtures` / `labels.ts` / `PartIndicator` / `Fixtures`）を `labels.ts` の実装に**一本化**し、鍵に接頭辞（`fixture:` / `socket:` / `part:`）を付ける。Task 17 が landed 済み（`3bf8015`）なのでチェックのみ。
- [x] 3. **3D-14**: `labels.ts` に `LABEL_FONT` 定数を置き `ctx.font` の5箇所を差し替える（文字幅表は Meiryo 実測なのに焼くときは `sans-serif` になっている）。開発時に `measureText()` と見積りを比べるアサートを足す。Task 17 が landed 済み（`3bf8015`）なのでチェックのみ。

> **3D-13 / 3D-14 / 3D-18 / 3D-20 は Task 17 で済み（`3bf8015`）**: Step 2・3 はまるごと、Step 1 のうち
> `presetForDirection()`（3D-18。`view-navigation.test.ts` の5ケースを `gizmoTargetForDirection()` へ
> 向け直した）と `receiveShadow`（3D-20）も削除済み。印字テクスチャのキャッシュは `labels.ts` の
> `bakeSharedTexture(namespace, key, bake)` 1つに畳んだので、`cachedFaceTexture` / `faceTextureCache`
> を `apps/desktop/src` で探すと `labels.ts` だけに当たる。**BoardScene の `reasonOf` も Task 17 で
> 共有版（`app/errors.js`）へ寄せた**ので、`grep -rn "function reasonOf" apps/desktop/src` は1件になった。
> Task 12 はこれらの項目を飛ばしてよい。
- [x] 4. **LE-16**: `CommentPanel.tsx` の JSDoc と実装の食い違い（3箇所中2箇所が矛盾）を実装に合わせて直す。`LadderWorkspace.tsx:536-538` の同じ誤りも直した。
- [x] 5. **UI-11 ≡ LE-15**: 描画中に ref を読み書きしている6箇所を `useEffect` へ移す（`SchematicEditor.tsx:225-228` が正しい形）。`HelpDrawer.tsx:156-157` は Task 32 の担当ファイルのため対象外（他5箇所は対応済み）。`ladder/LadderGrid.tsx:546-552` 相当は Task 15 の再構成でレンダー回数の観測用カウンタ（`data-render-count`。同一レンダー中に JSX へ出すため意図的に render 中へ書く）に置き換わっており、対象外と判断した。
- [x] 6. **UI-15**: 未使用の日本語キー（現状17件。レポート時点の9件から他タスクの着地で増加）と別名定義（判定手順3件・電源投入手順2件・`select`/`selection`）を整理した。`i18n-keys.test.ts` を新設し、`JA` の全葉キーが `src` / `test` / `e2e` のどこかから参照されていることを検査する（再発防止）。
- [x] 7. **CT-12**: `checkIoAssignment`（93行の一本道）を検査ごとの純関数に割り、`isPbA` / `isPlcX` / `isPlcY` をモジュール直下へ出して単体テストを付けた。
- [x] 8. **CS-07（代替）**: `packages/circuit-sim/test/parts.test.ts` に「`createTimer4c` の要素の並びを**配列全体で**固定する」テストを足し、`parts.ts` の該当箇所の JSDoc に「**この並びは課題JSONの `faults[].target.elementIndex` の契約である。変えると内蔵C2課題と利用者の課題が別の故障になる**」と書いた。**`elementId` への移行は行わない**（本設計 §3.2）。
- [x] 9. **QA-25**: `apps/desktop/test/helpers/worker-bridge.ts` を新設し、12ファイル（残る1件 `plc-session-screen.test.tsx` は `vi.mock` 複写ではなく実体 `bridge` への `vi.spyOn` なので対象外）の10〜14行の複写を畳んだ。`running` は既定 `true`（本番コードはどこも読まないため値自体は無害。明示していた6ファイル中4ファイルがこの値だった）に揃えた。

**期待:**

```bash
pnpm --filter @ojt/desktop test -- i18n-keys
# 期待: 未参照キー 0 件
pnpm -r test && pnpm lint && pnpm typecheck
# 期待: 全件 pass・無警告
grep -rn "cachedFaceTexture\|faceTextureCache" apps/desktop/src | wc -l   # 期待: labels.ts のみ
```

---

## Task 13: 課題の拡充（モードB +12題 ／ モードC1 +8題）

**モデル: Opus**（回路の設計・操作列の設計・故障の見分けやすさはすべて判断）
**指摘: —（利用者要望2）**

**Files:**
- Create: `packages/content/src/builtin/assemble/b-009-*.json` 〜 `b-020-*.json`（12件）
- Create: `packages/content/src/builtin/inspect-parts/c1-005-*.json` 〜 `c1-012-*.json`（8件）
- Modify: `packages/content/src/builtin/index.ts`
- Modify: `packages/content/test/{builtin.test.ts,builtin-inspect-parts.test.ts,builtin-discrimination.test.ts,index.test.ts}`
- Modify: `apps/desktop/test/{content-resources.test.ts,content-loader.test.ts,problem-modes.test.ts}`
- Modify: `apps/desktop/resources/content/**`（`copy-content.mjs` で生成）

**題材は本設計 §4.4 の表のとおり**（`b-009`〜`b-020` の12題、`c1-005`〜`c1-012` の8題）。ID・級・`difficulty`・題材・`tags` は表から逐語で取る。

**Steps:**

- [x] 1. 既存の `b-001-self-hold.json` と `c1-001-relay-basic.json` を雛形として読む。盤の制約（リレー4・タイマ2・PB4・PL4・BZ任意）を超えないこと。
- [x] 2. B の12題を1題ずつ作る。各題で必ず守る不変条件は本設計 §4.5 の7項目。特に:
  - `hints.schematicVisible === (grade === 3)`。
  - 操作列は**必ず全部を落としてから終わる**（`startsAndEndsLow()`）。
  - タイマの `presetMs` は 100ms 以外。
  - `durationMs >= 最後の操作時刻 + 10`。
  - 1題作るごとに `pnpm --filter @ojt/content validate src/builtin/assemble/<file>` で確かめる（Task 4 の CLI）。
- [x] 3. C1 の8題を作る。`PartTruth` 7種の網羅を12セット全体で保ち、**タイマに `coil-layer-short` を置かない**。各セットに `normal` を1つ以上混ぜる。
- [x] 4. `builtin/index.ts` に `import … with { type: 'json' }` を20行と配列への追加。
- [x] 5. テストの期待値を伸ばす。

```
packages/content/test/builtin.test.ts             toHaveLength(8)  → 20、ID一覧 b-001…b-020
packages/content/test/builtin-inspect-parts.test.ts toHaveLength(4) → 12、ID一覧 c1-001…c1-012
packages/content/test/index.test.ts               「内蔵課題は28題」→「内蔵課題は48題（B 20 / C1 12 / C2 8 / D 8）」※ Task 18 で 72 に伸ばす
apps/desktop/test/content-resources.test.ts       WIRED_FILES に20件、総数
apps/desktop/test/content-loader.test.ts / problem-modes.test.ts  件数の文言と期待値
```

- [x] 6. **`builtin-discrimination.test.ts` に新題の判別ケースを足す**。少なくとも「b-013 両手押し」「b-015 相互インタロック」「b-017 後行優先」の3題について、**近いが誤った回路**を組んで不合格になることを確かめる（これが無いと「どんな回路でも通る課題」が混ざる）。
- [x] 7. `node apps/desktop/scripts/copy-content.mjs` を走らせて `apps/desktop/resources/content/` を更新し、**その差分も commit する**。

**期待:**

```bash
pnpm --filter @ojt/content test
# 期待: 全件 pass。BUILTIN_PROBLEMS.length === 20、BUILTIN_INSPECT_PARTS_PROBLEMS.length === 12
pnpm --filter @ojt/content validate src/builtin
# 期待: 0 件の問題
pnpm --filter @ojt/desktop test -- content-resources content-loader problem-modes
# 期待: 全件 pass
```

---

## Task 14: エンジンの無駄を削り、仕様の記述を実装に合わせる

**モデル: Sonnet**（レポート §5 Batch 3 手順5に逐語の指示がある）
**指摘: CS-02（代替）／ CS-03（代替）／ CS-04 ／ CS-08 ／ BM-05 ／ BM-07 ／ CT-07 ／ CT-10 ／ DM-10 ／ SC-06 ／ QA-20 の §5.2**

**Files:**
- Modify: `packages/circuit-sim/src/{solver.ts,meter.ts}`
- Modify: `packages/board-model/src/{routing.ts,plc-unit.ts}`
- Modify: `packages/content/src/{judge-plc.ts,forbidden.ts}`
- Modify: `packages/schematic-core/src/assign.ts`
- Modify: `apps/desktop/src/main/settings.ts`
- Modify: `docs/superpowers/specs/2026-09-13-ojt-electrical-trainer-design.md`（**§5.2 と §13 #3 の2箇所だけ**）

**Steps:**

- [x] 1. **CS-04**: `solve()` の冒頭で `allElements()` を1回だけ作り、`pickReference(elements, nets, override)` に渡す。
- [x] 2. **CS-08**: `equivalentResistance()` の後始末を `pop()` の位置依存から `lastIndexOf` ＋ `splice` の同一性削除に変え、JSDoc に前提を書く。
- [x] 3. **BM-05**: `buildChannelGraph()` を「盤ごとに1回メモ化した交点グラフ ＋ 出入口2点の挿入」に分け、`channelById` は `routeSession()` で1回作る。
- [x] 4. **BM-07**: `plcFaces()` の冗長な `.sort()` を落とす（`rackModules()` が既に昇順）。
- [x] 5. **CT-07**: `judge-plc.ts:118` の `traineeNetlist` を `!compiled.ok` ブロックの後ろへ移す。
- [x] 6. **CT-10**: `findForbiddenPatterns()` の先頭で `buildNets()` を1回だけ作る。
- [x] 7. **SC-06**: `assignToBoard()` で `fixedWireCounts` / `fixedBondKeys` を1回作って渡す。
- [x] 8. **DM-10**: `settings.ts` にモジュール変数のキャッシュを置く（IPC のたびに設定ファイルを読み直さない）。
- [x] 9. **CS-03（代替）**: 本体仕様 **§5.2** の「LU分解を再利用する」を実装に合わせて訂正する。訂正文: 「解法は毎tick 密行列を組み直す素のガウス消去である（節点162で 408 KiB/tick）。LU の再利用は行っていない。性能の実測が必要になった時点で `Solver` クラス化（`fill(0)` での使い回し）を検討する」。
- [x] 10. **CS-02（代替）**: 本体仕様 **§13 #3** を訂正する。訂正文: 「各節点に 1nS の漏れ抵抗を入れているため特異行列は発生しない。したがって `solver-warning` / 直前解での置換 / 10tick 停止は実装しない」。
- [x] 11. `pnpm -r test` のうち性能に触れるテストの期待値を確かめる（件数が変わらないこと）。（circuit-sim 257件・board-model 266件・schematic-core 144件・`apps/desktop/test/settings.test.ts` 27件、すべて変更前と同数で pass。`packages/content` は本タスクが触った `forbidden.test.ts`／`judge-plc.test.ts`／`index.test.ts` で確認。パッケージ全体には Task 13 並行作業による無関係な件数不一致が別途ある）

**期待:** `pnpm -r test` 全件 pass。`docs/superpowers/specs/2026-09-13-…design.md` の §5.2 と §13 #3 が実装と一致する。

---

## Task 15: 描画側の「時間とともに重くなる形」を潰す

**モデル: Opus**（どこまで間引くと教材としての情報が落ちるかの判断がある）
**指摘: DS-2 ≡ UI-02（High）／ DW-1 ≡ LE-11 ／ LE-10 ／ UI-10 ／ DS-6**

**Files:**
- Modify: `apps/desktop/src/renderer/app/store-session.ts`（Task 11 の分割後）
- Modify: `apps/desktop/src/renderer/screens/Session.tsx`
- Modify: `apps/desktop/src/renderer/panels/TimeChartView.tsx`
- Modify: `apps/desktop/src/renderer/ladder/LadderGrid.tsx`
- Modify: `apps/desktop/src/renderer/session/spec-chart.ts`
- Modify: `apps/desktop/src/worker/sim.worker.ts`
- Modify: `packages/ladder-core/src/runtime.ts`

**Steps:**

- [x] 1. **DS-2 ≡ UI-02**: `MAX_LIVE_POINTS = 2000` の切り詰めを入れ、`Session.tsx:122-125` の依存を **500ms 量子化した `durationMs`** にする（いまは毎秒約30回チャート全体を組み直している）。
- [x] 2. **DW-1 ≡ LE-11**: `PlcRuntimeOptions` に `recordPowered?: boolean`（既定 `false`）を足し、Worker の `monitor` コマンドで切り替える。`timerPresetsOf()` の結果を `PlcCoupling` にキャッシュし `plc:load` 時だけ作り直す。`state()` の Map を直接読む。
- [x] 3. **LE-10**: `GridCell` を `memo` で包み、`cursorKey` の代わりに `selected: boolean` を渡す。`NetworkView` も `memo` にする（矢印キー1回で全ネットワーク・全セルが再描画されるのを止める）。
- [x] 4. **UI-10**: `TimeChartView.tsx:164-175` の `mousemove` / `mouseleave` の二重登録を削る（`pointermove` だけにする）。
- [x] 5. **DS-6**: `spec-chart.ts` のキャッシュ鍵に課題の版（`mtimeMs` か内容ハッシュ）を入れる。利用者課題フォルダの JSON を編集したら波形が更新されるようにする。
- [x] 6. テスト。

```
apps/desktop/test/store.test.ts        applySnapshot() に遷移点を数千件流しても liveTransitions[signal].length が上限以内
apps/desktop/test/chart-ux.test.tsx    snapshot.tMs を 33ms 刻みで15回進めたとき liveChart() の呼び出しが15回未満
apps/desktop/test/sim-worker-plc.test.ts plc:load を2回送ったとき2回目の設定値がモニタスナップショットに反映される
packages/ladder-core/test/runtime.test.ts recordPowered: false でも出力・タイマ・カウンタの結果が同一（決定論を落とさない）
apps/desktop/test/ladder-grid.test.tsx カーソルを1マス動かしたとき、選択が変わった2セル以外の GridCell が再描画されない
```

**期待:** 上記5件が緑。モードBの点滅課題を30分回したあともフレーム時間が単調増加しないこと。

---

## Task 16: 性能の門を直す（これを先にやらないと以降が測れない）

**モデル: Opus**
**指摘: 3D-01（Critical）**

**Files:**
- Modify: `apps/desktop/src/renderer/three/BoardScene.tsx`（`onCreated` と `PerfProbe`）
- Modify: `apps/desktop/e2e/perf.spec.ts`
- Modify: `docs/superpowers/plans/2026-09-19-phase5-*.md` の性能記録（該当行に「ビューキューブ単体の値であって達成値ではない」と訂正を追記）

**Steps:**

- [x] 1. `BoardScene.tsx` の `onCreated` で `gl.info.autoReset = false;` を立てる。`PerfProbe` の `useFrame` の**先頭**で `gl.info` を読んでから `gl.info.reset()` を呼ぶ。いまは自動リセットが効いて**ビューキューブだけの値**を測っている（3視点とも `calls` が 30 で同値なのがその証拠）。
- [x] 2. `e2e/perf.spec.ts` の `DRAW_CALL_BUDGET` / `TRIANGLE_BUDGET` を**盤を含む実測値**で取り直す。取り直した値と測り方をこのタスクの Steps に追記する。
  **2026-09-20 Task 16 実測**: worktree `OJT-wt-e2e`（`origin/main` c7eb950 に本タスクの差分だけを当ててビルド、`--use-gl=swiftshader`、1440×900、`playwright test e2e/perf.spec.ts` を foreground で2回）。モードB b-001 を開いた状態で、**2回とも完全に同じ値**:

| 視点 | triangles（修正前 → 修正後） | calls（修正前 → 修正後） |
|---|---|---|
| 正面 | 280 → **50,364** | 30 → **309** |
| 俯瞰 | 280 → **50,364** | 30 → **309** |
| ソケット拡大 | 280 → **45,898** | 30 → **253** |
| `worst` | 280 → **50,364** | 30 → **309** |

  取り直した予算は `TRIANGLE_BUDGET = 200_000`（§15 の受入基準そのものの数を残す。実測 50,364 で4倍の余裕）／`DRAW_CALL_BUDGET = 120 → 340`（§15 に数字は無く Plan 5 決定表#17 が独自に置いた値。ギズモ単体の 30 に対して置かれていたので、実測 309 に約1割の余裕を足して取り直した）。
- [x] 3. 退行検知を足す: 「視点プリセットを `正面` と `ソケット拡大` に切り替えたとき `calls` が**異なる**」ことを assert する。（`perf.spec.ts` の予算ループの直後。実測 309 ≠ 253。ギズモ単体に戻ると3視点とも同値になって落ちる）
- [x] 4. Plan 5 の性能記録に訂正を1行追記する（**レポート本体 `docs/reviews/**` は書き換えない**）。（`docs/superpowers/plans/2026-09-19-phase5-schematic-editor-and-release.md` の性能節 2行に追記）

**期待:** `pnpm --filter @ojt/desktop e2e perf` が盤を含む実測値で緑。3視点の `calls` が同値でないこと。

---

## Task 17: 3D の資源解放とドローコールを畳む

**モデル: Opus**
**指摘: 3D-02（High）／ 3D-03（High）／ 3D-04（High）／ 3D-05 ／ 3D-06 ／ 3D-08 ／ 3D-09 ／ 3D-11 ／ 3D-12 ／ 3D-22**

**Files:** `apps/desktop/src/renderer/three/{materials.ts,Socket.tsx,MountedPart.tsx,FixedWires.tsx,Fixtures.tsx,labels.ts,Wire.tsx,CameraPresets.tsx,PlcUnit.tsx,PlcRack.tsx,Outlet.tsx,TerminalHit.tsx,label-declutter.ts,BoardScene.tsx}`

**Steps:**

- [x] 1. **3D-02**: `materials.ts` に `PIN_HOLE_GEOMETRY` を置き、差込穴112個を共有ジオメトリ1個＋共有マテリアル1個にする。
- [x] 2. **3D-03**: 点光源を**固定本数**にして `intensity` だけ動かす。`three-fidelity.test.tsx:349` の「点灯している LED のぶんだけ点光源が増える」を「**点光源の本数は点灯状態によらず一定で `intensity` だけが変わる**」に書き換える（いまのテストは性能上の問題を仕様として固定している）。
- [x] 3. **3D-04**: `Fixtures.tsx` の `fixtureFaceTexture()` を `labels.ts` の `cachedFaceTexture()` 越しにする（鍵 `fixture:${kind}:${w}x${h}`）。Task 12 の一本化と同じ鍵体系を使う。
- [x] 4. **3D-05**: `FixedWires` の `TubeGeometry` 20本を `useEffect` の cleanup で `dispose()` する。
- [x] 5. **3D-06**: `MountedPart` の `bodyMaterial` を `sharedMaterial(...)` に、`edges` をモジュール定数1個にする。
- [x] 6. **3D-08**: `labels.ts:621-626` の `minFilter` を `LinearMipmapLinearFilter` にする（1行。`view-gizmo-textures.ts:53-59` が正しい前例）。
- [x] 7. **3D-09**: `WirePickBody` の `<mesh>` に `visible={false}` を足し、**2箇所のコメントを訂正**する（`visible={false}` だとレイキャストが辿らない、という記述は事実と異なる。`TerminalHit` が反例）。
- [x] 8. **3D-11**: `CameraPresets.tsx:70` を `problem` 購読 ＋ `useMemo` にする。
- [x] 9. **3D-12**: `TerminalField` を `PlcUnit` / `PlcRack` / `Outlet` からも呼び、机上端子を1ドローコールに畳む。
- [x] 10. **3D-22**: `LabelDeclutter` の `visibility` 書き込みを「前回と違うときだけ」にする（毎フレームの強制同期レイアウトを止める）。
- [x] 11. テストはレポート §5 Batch 3「追加すべきテスト」の該当行をそのまま入れる（`fixed-wires.test.tsx` / `parts-swap.test.tsx` / `label-cache.test.ts` / `materials.test.ts` / `three-fidelity.test.tsx`）。

**期待:** `pnpm --filter @ojt/desktop e2e perf` の `calls` と `triangles` が Task 16 の実測値より**下がっている**こと。課題を10回開き直したあとの `renderer.info.memory` が単調増加しないこと。

**実測（`OJT-wt-e2e`・swiftshader・1440x900・b-001。3回走らせて正面・俯瞰は毎回同値）:**

| 視点 | triangles（前 → 後） | calls（前 → 後） | geometries（前 → 後） |
|---|---|---|---|
| 正面 / 俯瞰 | 50,364 → **50,044** | 309 → **186** | 204 → **73** |
| ソケット拡大 | 45,898 → 約46,540 | 253 → **150〜154** | 204 → **73** |

予算（200,000 / 340）に対する最悪値は 50,044 / 186。ドローコールは**正面で 40% 減**（差込穴112＋貫通穴20＝132個の `mesh` が `instancedMesh` 9本に畳まれたぶん）、ジオメトリは 204 → 73 に減った（3D-02 / 3D-06 のメモリ側の効果）。テクスチャは 18 → 16（3D-04 / 3D-13 で固定機器の印字が共有キャッシュに入ったぶん）。

ソケット拡大の値だけ走るたびに数十ゆれるのは、視点の補間が落ち着く前に測る回があるためで、Task 16 から変わっていない。
三角形は正面・俯瞰では 320 減った（貫通穴の断面分割が 12 → 8 になったぶん。20個 × 16三角形）が、**ソケット拡大では 642 増えた**: 穴が `instancedMesh` 1本になったので視錐台カリングの粒度が「穴1個」から「ソケット1個」に粗くなり、寄りの視点で以前は落ちていた穴も描かれるようになったため。この視点でもドローコールは 102 減っているので差し引きで軽い。穴を `socketFaceTexture()` へ焼き込めば（レビュー 3D-02 の「踏み込む案」）両方 0 にできるが、穴の陰影が無くなって見た目が変わるので Task 27 へ送る。

---

## Task 18: 課題の拡充（モードC2 +12題 ／ モードD +12題）

**モデル: Opus**（故障の組合せと観測可能性、ラダーの設計はすべて判断）
**指摘: —（利用者要望2）**

**Files:**
- Create: `packages/content/src/builtin/inspect-repair/c2-009-*.json` 〜 `c2-020-*.json`（12件）
- Create: `packages/content/src/builtin/plc/d-009-*.json` 〜 `d-020-*.json`（12件）
- Modify: `packages/content/src/builtin/index.ts`
- Modify: `packages/content/test/{builtin-c2-discrimination.test.ts,builtin-inspect-repair.test.ts,builtin-c2-dcv-observability.test.ts,builtin-plc.test.ts,builtin-plc-discrimination.test.ts,plc-cross-validation.test.ts,index.test.ts}`
- Modify: `apps/desktop/test/{content-resources.test.ts,content-loader.test.ts,problem-modes.test.ts}`
- Modify: `apps/desktop/resources/content/**`

**題材は本設計 §4.4 の表のとおり**（`c2-009`〜`c2-020`、`d-009`〜`d-020`）。

**Steps:**

- [x] 1. C2 の12題を作る。元になる回路は Task 13 で作った B の新題を流用する（`schematic` をコピーして `faults` を足す）。**3級は禁止**、`hints.schematicVisible === (grade === 2)`。
- [x] 2. **`builtin-c2-discrimination.test.ts` の `REPAIRS` に新12題ぶんを手で書く**（どの電線・どの要素をどう直せば合格するか）。これが無いと新題は「報告＋修復で合格」「何もしなければ不合格」「1件見落とすと不合格」「2件のうち1件だけ直しても不合格」の4検査を素通りする。
- [x] 3. **`builtin-c2-dcv-observability.test.ts`** に、接触不良・接点不良を含む新題（c2-011 / c2-014 / c2-016 / c2-019）について「コイル励磁中／非励磁中の COM–NO / COM–NC 電圧で切り分けられる」検査を足す（2026-09-18 の利用者決定「C2 の接点故障はライブ DCV で診断する」）。
- [x] 4. D の12題を作る。PLC 側にリレー4・タイマ2の制約は無い。`io.inputs` は PB1〜PB4、`io.outputs` は PL1〜PL4（1級は4出力で最後が `CR4` 経由）。`referenceLadder` は `compile()` を通り、`judgePlcReference` が合格すること。
- [x] 5. **4方言すべてで通ることを確かめる**（`plc-cross-validation.test.ts`）。カウンタ課題（d-016 / d-017 / d-020）は OMRON の `#0005` 形式・JTEKT の `H0005` 形式・シャープの4桁10進で設定値が表現できる範囲に収める。
- [x] 6. `builtin/index.ts` に24行。テストの期待値を最終形に伸ばす。

```
packages/content/test/index.test.ts  「内蔵課題は72題（モードB 20 / C1 12 / C2 20 / D 20）」
builtin-c2-discrimination.test.ts    toHaveLength(8) → 20、ID一覧、級の内訳（2級10 / 1級10）
builtin-plc.test.ts                  ID一覧 d-001…d-020、級の内訳（2級10 / 1級10）
plc-cross-validation.test.ts         toHaveLength(8) → 20
```

- [x] 7. `node apps/desktop/scripts/copy-content.mjs` を走らせ、差分も commit する。

**期待:**

```bash
pnpm --filter @ojt/content test
# 期待: BUILTIN_ALL_PROBLEMS.length === 72、全題の模範解が自身の判定に合格
pnpm --filter @ojt/content validate src/builtin
# 期待: 0 件の問題
pnpm --filter @ojt/desktop test
# 期待: 全件 pass
```

---

## Task 19: ビューキューブが回り込めない不具合を直す

**モデル: Opus**（再現・原因特定・分割・回帰テストの設計）
**指摘: 3D-15 ／ 3D-16 ／ 3D-19 ／ 利用者要望8**

**Files:**
- Modify: `apps/desktop/src/renderer/three/ViewGizmo.tsx`
- Create: `apps/desktop/src/renderer/three/view-gizmo-layout.ts` / `view-gizmo-paint.ts` / `use-gizmo-drag.ts`
- Modify: `apps/desktop/src/renderer/three/navigation.ts` / `camera.ts` / `BoardScene.tsx` / `CameraPresets.tsx`
- Modify: `apps/desktop/test/view-gizmo.test.tsx` / `apps/desktop/e2e/navigation.spec.ts`

**Steps:**

- [x] 1. **まず再現する**。worktree でアプリを起動し、`俯瞰` プリセットにしてからビューキューブを上下左右へ引き、`camera-readout` の値を記録する。本設計 §8.2 の仮説（`top` は極角ちょうど0＝極なので、下向きも水平も動かない）が正しいかを**実測で確かめ**、結果をこの Steps に追記する。
  - **実測（修正前・Electron 実機・モードB b-001・1280×800）**: `俯瞰` の着地点は **az −0.6627 / 極角 0.8897（51°）/ 距離 428**。200px ドラッグの結果は下表。

    | 引いた向き | 極角 before → after | 方位角 before → after |
    |---|---|---|
    | 下へ | 0.8897 → **0.0000**（Δ−0.8897） | 変化なし |
    | 上へ | 0.8897 → 1.5708（Δ+0.6811、上限で丸め） | 変化なし |
    | 右へ | 変化なし | −0.6627 → −1.9194（Δ−1.2567） |
    | 左へ | 変化なし | −0.6627 → +0.5939（Δ+1.2566） |

  - **§8.2 の仮説は一部誤り**。`top` プリセットは極角ちょうど0ではなく **0.8897**（`cameraPose('top')` は真上ではなく左手前からの斜め俯瞰）。**真の原因は「下へ引くと極角が減る」符号**で、利用者が「上から正面へ」と下へ引くと極角0（＝球座標の極）へ**張り付き**、極ではカメラ位置が `target + (0, 距離, 0)` に固定されて方位角を変えても動かないため、そこから先はどちらへ引いても画が変わらない（＝「回らない」）。`minPolarAngle` 既定0がその張り付きを許していた。
  - **もう一つの実測事実**: 盤は13°の傾斜コンソールなので、**面直の `正面` 視はワールドではほぼ真上**（ワールド上方向から測った極角 **0.23rad ＝ 13°**）。つまり「俯瞰（0.89）→ 正面（0.23）」は**極角を減らす**向きであり、所有者決定（カメラが指に付いてくる）では**キューブを上へ引く**動きにあたる。
- [x] 2. **極を踏まないようにする**。`BoardScene.tsx` の `<OrbitControls>` に `minPolarAngle={MIN_POLAR_ANGLE_RAD}` を渡す。`camera.ts` の `poseForDirection()` と `CameraPresets.applyPose()` で、`top` の着地点を `MIN_POLAR_ANGLE_RAD`、面直プリセットの着地点を `MAX_POLAR_ANGLE - MIN_POLAR_ANGLE_RAD` にする。
  - `<OrbitControls minPolarAngle={MIN_POLAR_ANGLE_RAD}>` を入れた（`BoardScene.tsx:783`）。`poseForDirection()` は上限も `MAX_POLAR_ANGLE - MIN_POLAR_ANGLE_RAD` に丸めるようにした（`camera.ts:363`。下限 `MIN_POLAR_ANGLE_RAD` は既存）。
  - **逸脱**: `CameraPresets.applyPose()` で**面直プリセットを 1.1° 内側へずらすのはやめた**（`CameraPresets.tsx:87`）。Step 1 の実測どおり `top` は極角 0.8897 で極に居ないので、張り付きの原因は着地点ではなく符号であり、この項目の効果は「上限ちょうどで下方向のドラッグが 1.1° ぶんだけ動く」だけである。一方で面直視を 1.1° 傾けると `camera.ts:33-42` と `terminal-pick.test.ts`「面直の視点はちょうど極角 90°」が守っている不変条件（2026-09-19 の P.1/N.1 クリック不能の再発防止。当たり判定半径4mm に対し 3.6° のずれで外れていた）を崩す。よって**面直プリセットは極角ちょうど 90° のまま**とし、`view-gizmo.test.tsx` の28ケースでは「面直と `bottom` は下へ引く1方向だけ `MAX_POLAR_ANGLE` で止まる（§12.2 の『盤の水平面より下へ回り込ませない』そのもの）」と明記して固定した。
- [x] 3. **向きを「カメラが指に付いてくる」に統一する**（**2026-09-20 の所有者決定: 上下・左右とも反転する**）。`navigation.ts` の `gizmoDragToSpherical()` を **`{ azimuth: +dx * k, polar: +dy * k }`** にする（下へ引いたらカメラが下へ回り `top` から `front` へ着く／右へ引いたらカメラが右へ回る）。上のコメント（「右へ引けば方位角が減り、下へ引けば極角が減る」）を新しい規則に書き直す。
- [x] 4. **左右の反転に伴う期待値をすべて直す**。`e2e/navigation.spec.ts:228-261`（水平ドラッグ）の期待値を反転させる。`test/view-gizmo.test.tsx` の方位角に関する既存アサーションも同様。本体仕様 §12.2 の「1000px で1回転」の記述はそのままでよいが、向きの説明があれば直す。**実機で「盤が指に付いてくる」ことを確かめ、結果をこの Steps に記録する。**
  - `e2e/navigation.spec.ts` の水平ドラッグは `Math.abs()` をやめて**符号ごと**（右へ引くと方位角が増える）検査するようにした。`test/view-gizmo.test.tsx` の方位角・極角のアサーション、`test/view-navigation.test.ts` の `gizmoDragToSpherical` の符号テストも反転させた。本体仕様 §12.2 に向きの記述は無く（「1000px で1回転」のみ）、直す箇所は無かった。
  - **実測（修正後・同じ手順）**: `俯瞰`（az −0.6627 / 極角 0.8897）から 200px 引くと

    | 引いた向き | 極角 before → after | 方位角 before → after |
    |---|---|---|
    | 下へ | 0.8897 → **1.5708**（Δ+0.6811。カメラが下＝指の向きへ回る） | 変化なし |
    | 上へ | 0.8897 → **0.0200**（Δ−0.8697。極 0 ではなく `MIN_POLAR_ANGLE_RAD` で止まる） | 変化なし |
    | 右へ | 変化なし | −0.6627 → **+0.5939**（Δ+1.2566。修正前と逆） |
    | 左へ | 変化なし | −0.6627 → **−1.9194**（Δ−1.2567。修正前と逆） |

  - `e2e/navigation.spec.ts` の新テストで、俯瞰から**上へ 105px**（0.8897−0.2257 を感度で割った量）引くと極角が `正面` のワールド極角（0.23rad）に収まること、**上へ 200px** 引いて上限まで行ってもそこから横へ引けばカメラ位置が動くこと（＝極に張り付かない）を実機で確認した。
- [x] 5. **3D-15**: `onPointerDown` の先頭に `if (drag.current !== null) return;`（2本目のポインタで `dampingFactor: 1` を保存してしまい、盤の慣性が永久に失われるのを止める）。
- [x] 6. **3D-16**: `ViewGizmo.tsx`（1,080行）を `view-gizmo-layout.ts`（111-274行）／ `view-gizmo-paint.ts`（288-529行）／ `use-gizmo-drag.ts`（状態機械）に割る。JSX と配線だけを `ViewGizmo.tsx` に残す。
- [x] 7. **3D-19**: `navigation.ts` の非公開 `FACE_LABELS` を消し、`ViewGizmo.tsx` の `GIZMO_FACES` を唯一の源にする（本番が使う側がテストされていない状態を解消する）。
- [x] 8. 回帰テストを足す。

```
apps/desktop/test/view-gizmo.test.tsx
  - 7つのプリセットすべてを起点に、上・下・左・右へ 200px 引いたとき
    getPolarAngle() か camera.position のどちらかが必ず変わる（28ケース）
  - makeCamera() の up を boardUp()（13°傾斜）にした版でも同じこと
  - 2本目の pointerdown が来ても dampingFactor の保存値が汚れず、放したら 0.35 に戻る（3D-15）
apps/desktop/e2e/navigation.spec.ts
  - 「俯瞰」にしてからキューブを下へ 200px 引くと camera-readout の極角が増え、
    離したあとの視点が「正面」に近い（利用者の報告そのものの再現）
```

**期待:** 上記が緑。実機で俯瞰 → 下へドラッグ → 正面へ回り込めること。

---

## Task 20: 純正ツールのキー割当を実機の形に揃える

**モデル: Opus**（一次資料の有無で `confirmed` を分ける判断がある）
**指摘: LE-1 の続き ／ LE-8 ／ 利用者要望3**

**Files:**
- Modify: `packages/plc-dialects/src/{profile.ts,shortcuts.ts,omron.ts,mitsubishi.ts,jtekt.ts,sharp.ts}`
- Modify: `apps/desktop/src/renderer/session/ladder.ts`
- Modify: `apps/desktop/src/renderer/ladder/ShortcutHelp.tsx`
- Create/Modify: `docs/reference/ladder-skin-sources.md`（出典 S1〜S8 を追記）
- Modify: `packages/plc-dialects/test/{dialects.test.ts,omron.test.ts,device-rules.test.ts}`
- Modify: `apps/desktop/test/ladder-editor.test.tsx`

**キー表は本設計 §5.2 のとおり**。出典は §5.7 の S1〜S8。

**Steps:**

- [x] 1. `ShortcutEntry` に `source?: string` を足す（出典記号。`ShortcutHelp` が △ の行に添えて出す）。`keys` を**カンマ区切りで複数**受けられるようにし、`expandKeys()` が分解する。
- [x] 2. **GX Works3 系**（三菱・ジェイテクト・シャープ）: `application`（`F8`）の `enabled: false` を外す（行き先は Task 21 の応用命令欄）。`delete-hline`（`Ctrl+F9`）/ `delete-vline`（`Ctrl+F10`）/ `pulse-rise`（`Shift+F7`）/ `pulse-fall`（`Shift+F8`）を足す。`F5`〜`F9`・`Shift+F5/F6/F9`・`F4`・`F2`・`Shift+F2`・`F3` は `confirmed: true` ＋ `source: 'S1'`〜`'S3'` にする。
- [x] 3. **OMRON**: 本設計 §5.2 の表のとおり作り直す。`C` / `/` / `O` / `I` / `Ctrl+E` / `Ctrl+Shift+E` は `confirmed: true` ＋ `source`。`W`（OR a接点）/ `Ctrl+→←`（横線）/ `Ctrl+↓↑`（縦線）は `confirmed: false` ＋ `source: 'S5'`。`Shift+W`（OR b接点）は `confirmed: false` ＋ 本アプリ独自の `note`。**`monitor` の行は作らない**（存在しないキーを教えない。案内は `monitorStartLabel()` がツールバー項目名へ倒す）。`online-edit` / `transfer` は `enabled: false` ＋ `note`。
- [x] 4. **ジェイテクト・シャープ**: GX Works3 風の流用のまま、**全行に `confirmed: false` と `note`**（「実機マニュアル未確認のため本アプリの表記です」）を付ける。`SkinTheme.keyMapAssumed: true` は維持。
- [x] 5. `docs/reference/ladder-skin-sources.md` に S1〜S8 の URL と「何が確認できたか」「確認できなかったもの」を書く（本設計 §5.7 を転記）。**利用者が挙げた `e-sysnet.com/plc-6` はキー割当表ではなかったことも書く。**
- [x] 6. **網羅テスト**（決定 D6）を足す。

```
packages/plc-dialects/test/dialects.test.ts
  - 4方言 × 表の全行について、keys を KeyboardEvent に起こして ladderKeyToAction() に通すと、
    enabled !== false の行は { type: 'none' } にも { type: 'disabled' } にもならない
  - enabled: false の行は { type: 'disabled' } になり、note が空でない
  - confirmed: false の行はすべて note か source のどちらかを持つ
apps/desktop/test/ladder-editor.test.tsx
  - 英字キーは大小文字を問わず当たる（'c' も 'C' も a接点）
```

**期待:** 上記が緑。キー割当表（`ShortcutHelp`）に △ と出典が出て、効かない行が `note` つきで淡色になること。

---

## Task 21: 回路入力（記号とデバイスの入れ方）を純正の形にする

**モデル: Opus**（3つの入口の調停と1行直接入力の文法設計）
**指摘: UX-02（High）／ PR-01 ／ 利用者要望3**

**Files:**
- Modify: `apps/desktop/src/renderer/ladder/{DeviceInput.tsx,LadderGrid.tsx,LadderEditor.tsx,LadderWorkspace.tsx,ladder.module.css}`
- Modify: `apps/desktop/src/renderer/session/{ladder.ts,ladder-cell.ts}`
- Modify: `apps/desktop/src/renderer/ladder/skins/*.ts`（`--skin-unconverted` と記号ボタンの図形）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（`JA.ladder.entry.*`）
- Create: `apps/desktop/e2e/ladder-entry.spec.ts`

**Steps:**

- [x] 1. **入口A（キー）**: Task 20 のキー表から `place` / `application` が来たら回路入力欄を開く（既存の `pending` の仕組みをそのまま使う）。
- [x] 2. **入口B（ツールバー）**: `LadderWorkspace` のツールバーに**記号ボタン列**を足す（a接点・b接点・OR a・OR b・コイル・応用命令・横線・縦線・削除）。**ボタン名には必ずキーを併記**する（「a接点 (F5)」）。アイコンは本アプリが描く図形のみ。シャープ風スキンでは**ボタンを格子へドラッグしても置ける**（本設計 §5.2 の S8）。
- [x] 3. **入口C（格子）**: 空セルの**ダブルクリック**と**右クリックメニュー**で同じ欄を開く。**単クリックはカーソル移動のまま**（視点操作・選択と衝突させない）。
- [x] 4. **1行直接入力**: 回路入力欄の先頭に1行の入力を置き、`LD X0` / `OUT Y0` / `T0 K30` のように「ニーモニック＋デバイス（＋設定値）」を空白区切りで受ける。ニーモニックは `profile.instructionNames` から方言ごとに解釈する（シャープは `STR`）。空白を含まない入力は「デバイスだけ」と解釈し、記号は押したキーのものを使う。既存の記号ドロップダウン・デバイス欄・設定値欄・リセット欄は**残す**。
- [x] 5. **応用命令欄**（`F8` / OMRON `I`）: 本アプリが解釈できる命令（`SET` / `RST` / `MC` / `MCR` / `T`(TON) / `C`(CTU)）をニーモニックで受ける。解釈できない命令は「このアプリでは扱えない命令です（扱えるのは SET / RST / MC / MCR / T / C）」と1行で断る。
- [x] 6. **確定とカーソル**: `Enter` で確定 → 右へ1列（OR接点のあとは閉じ側の縦線の次。LE-5）。`Esc` で取消。IME 変換中の `Enter` は飲み込む（LE-12。Task 3 で入っている）。
- [x] 7. **OMRON 固有**（本設計 §5.2）: デバイス確定後に**コメント欄**が続けて開き、もう一度 `Enter` で確定する。出力の無いネットワークの**右端に赤い縦線**を出す。
- [x] 8. **未変換の見え方**: `convertStep: true` の方言（三菱・シャープ）で、変換していないネットワークの背景を `--skin-unconverted`（灰）にする。`F4` が通ると白へ。`assumed` に「未変換の灰色表示」を足し、設定の注記の対象にする。
- [x] 9. テスト。

```
apps/desktop/test/ladder-editor.test.tsx
  - 空セルのダブルクリックで回路入力欄が開き、単クリックでは開かない
  - 1行入力 'LD X0' が contact NO X0 になる（4方言ぶん。シャープは 'STR 00000'）
  - 応用命令欄に 'MOV' を入れると日本語で断られ、セルは変化しない
  - OMRON でデバイス確定後にコメント欄が開く
apps/desktop/test/ladder-grid.test.tsx
  - 未変換のネットワークに --skin-unconverted が付き、変換後に外れる（三菱・シャープのみ）
  - 出力の無いネットワークの右端に赤線が出る（OMRON）
apps/desktop/e2e/ladder-entry.spec.ts（新規）
  - 4方言それぞれで、課題を開く → F5（OMRON は C）→ デバイスを打つ → Enter で
    格子に a接点が現れる → コイルを置く → 変換（または自動変換）が通る
```

**期待:** 上記が緑。**利用者要望3の中心（「F5でA接点が入力される」）が4方言すべてで実際に起きること。**

---

## Task 22: ウィンドウ構成とモニタ表示を純正に寄せる

**モデル: Opus**
**指摘: LE-18 ／ PR-05 ／ 利用者要望3**

**Files:**
- Modify: `packages/plc-dialects/src/profile.ts`（`PanelLayout` の3項目）と4方言
- Modify: `apps/desktop/src/renderer/ladder/{LadderWorkspace.tsx,MonitorPanel.tsx,SkinFrame.tsx,ProjectTree.tsx,OutputWindow.tsx,SidePanel.tsx}`
- Create: `apps/desktop/src/renderer/ladder/WatchPanel.tsx` / `ShortcutOverlay.tsx`
- Modify: `apps/desktop/src/renderer/ladder/skins/*.ts`

**Steps:**

- [x] 1. `PanelLayout` に `comment?: string` / `watch?: string` / `status?: readonly string[]` を足し、4方言で埋める（`SkinTheme.statusItems` の源をここへ移す）。
- [x] 2. **監視欄**: `MonitorPanel` を「デバイス一覧（全部）」と「監視（利用者が選んだデバイスだけ）」に分け、`WatchPanel.tsx` を作る。三菱系は `Shift+F3`、他はツールバーから開く。
- [x] 3. **モニタ中の見え方**: `SkinTheme.monitorStyle`（`'block'` / `'flow'`）はそのまま。**色だけに頼らない**（UX-14）ため、通電セルに細い実線の枠を重ね、デバイス一覧の ON に `■`／OFF に `□` を添える。
- [x] 4. **モード表示**: 「書込み」「読出し」「モニタ」をステータスバーとタイトルバーの両方に出す。キーは `monitorStartLabel(profile)` / `writeModeLabel(profile)` から引く。
- [x] 5. **PR-05**: `ShortcutOverlay.tsx` を作り、`Shift + ?` で全キー割当を覆いで出す（データ源は `profile.shortcuts`。`ShortcutHelp` と同じ）。`Esc` で閉じ、`pushModalLayer()` の作法に従う。
- [x] 6. **LE-18**: ペイン幅の実測を `window.resize` だけでなく `ResizeObserver` で追う（表示切替や `<details>` の開閉に追従する）。リポジトリ全体で `ResizeObserver` は0件なので、`renderer/app/use-element-size.ts` として共有化する。
- [x] 7. テスト。`skin-workspace.test.tsx`: 4スキンで `panels.comment` / `watch` / `status` に応じて欄が出る／出ないこと。`ladder-panels.test.tsx`: 監視欄にデバイスを足すと表に出ること。`shortcut-overlay.test.tsx`（新規）: `Shift+?` で開き `Esc` で閉じ、フォーカスが戻ること。

**期待:** 4スキンの画面構成が方言の `panels` だけで決まり、スキンを切り替えると欄の並びと呼び名が変わること。

---

## Task 23: 色とトークンを整え、色だけの符号化をやめる

**モデル: Sonnet**（置換対象がレポートに逐語で列挙されている）
**指摘: UI-08 ／ UI-16 ／ UI-20 ／ UX-09 ／ UX-14 ≡ UI-17 ／ UX-26 ／ PR-07**

**Files:**
- Modify: `apps/desktop/src/renderer/app/global.css`（`:root` に紙トークン）
- Modify: `apps/desktop/src/renderer/schematic/{schematic.module.css,schematic-view.module.css,SchematicSvg.tsx}`
- Modify: `apps/desktop/src/renderer/help/help.module.css`
- Modify: `apps/desktop/src/renderer/result/result.module.css`
- Modify: `apps/desktop/src/renderer/panels/{panels.module.css,PowerControls.tsx,Toolbar.tsx}`
- Modify: `apps/desktop/src/renderer/ladder/LadderGrid.tsx`
- Modify: `apps/desktop/src/renderer/screens/{Home.tsx,ProblemList.tsx,Settings.tsx,InspectPartsSession.tsx}`

**Steps:**

- [ ] 1. **UI-08**: `:root` に紙トークン（`--paper` / `--paper-ink` / `--paper-rule` / `--paper-fill`）を足し、`schematic*.module.css`（`var(--` 0 件・hex 58行）と `help.module.css` を**トークンへ置換**する。「紙でない部分」（枠・見出し・注記）は既存トークン（`--panel` / `--muted`）へ寄せる。PDF 側の `PRINT_CSS` の紙パレットとの一致は Task 34 でテストに固定する。
- [ ] 2. **UX-09**: 模範（期待）波形の `rgba(231,235,242,0.38)` の1.5px 実線をやめ、`--muted` ＋ **破線**（`stroke-dasharray: 6 4`）にする。凡例も同じ破線にする。
- [ ] 3. **UX-14 ≡ UI-17 ／ PR-07**: 通電・保護動作・ラダー通電の**色だけの符号化**をやめる。LED の右に文字（`● 通電中` / `○ 無通電` / `▲ 保護動作`）と形の差を添え、素の `<span>` への `aria-label`（ARIA 仕様上 name prohibited）を `role="img"` か `aria-hidden` ＋ `.srOnly` に直す。ラダーの通電セルには細い実線の枠を足す。
- [ ] 4. **UX-26**: 線色ボタンに**色見本**を足す（いまは「青」という文字だけ。線色は採点対象で盤の上では色でしか見分けられない）。
- [ ] 5. **UI-16**: インライン style 8箇所を CSS クラスへ（8px/4px 格子に載せる）。
- [ ] 6. **UI-20**: `SchematicSvg.tsx` の `viewBox` を文字列に組んでから `split(' ').map(Number)` で解析し直すのをやめ、**数値のまま持つ**。
- [ ] 7. テスト。`ladder-contrast.test.tsx` に「通電表示が色以外の手がかり（文字か形）を持つ」検査を足す。`e2e/ui-quality.spec.ts` の色関連の基準値を取り直す。

**期待:** `grep -c "#[0-9a-fA-F]\{6\}" apps/desktop/src/renderer/schematic/schematic.module.css` が **0** になること。`pnpm --filter @ojt/desktop test` 全件 pass。

---

## Task 24: アクセシビリティと画面の一貫性

**モデル: Opus**（畳む既定・並び・しきい値の判断）
**指摘: UI-03 ／ UI-09 ／ UI-12 ／ UI-18 ／ UI-19 ／ UI-21 ／ UX-07 ／ UX-10 ／ UX-15 ／ UX-16 ／ UX-20 ／ UX-23 ／ UX-25 ／ UX-30 ／ 3D-10 ／ 3D-17 ／ PR-08 ／ PR-10**

**Files:** `apps/desktop/src/renderer/{panels/*,screens/Settings.tsx,three/label-declutter.ts,app/global.css}` ほか

**Steps:**

- [x] 1. **PR-08 ／ UX-07**: `panels/CollapsiblePanel.tsx` を作り（モードDの `SidePanel` を共通化）、右の欄を `<details>` に揃える。既定は 課題＝開く／部品＝開く／回路図ヒント＝級の規則どおり／タイムチャート＝開く／**端子リスト＝畳む**／ライブ記録＝畳む。並びは 課題→部品→回路図ヒント→タイムチャート→端子リスト→ライブ記録。畳んだ見出しに要点を添える。
- [x] 2. **UX-10 ／ 3D-10**: `.socket-label` / `.part-label` を **12px** に上げ、`label-declutter` の `LABEL_SELECTOR` / `HUD_SELECTOR` に2クラスを足し `data-label-rank` を付ける。`e2e/ui-quality.spec.ts` の `HUD_SELECTOR` にも足す。**本体仕様 §8.2 と §12 の「画面上10px相当以上」は 2026-09-20 の所有者決定で既に「12px相当以上」に改訂済み**なので、実装をその記述に合わせるだけでよい（新たな仕様変更ではない）。
- [x] 3. **UI-03**: 「⋯」メニューを `Esc` ・外側 `pointerdown` ・項目の `onClick` で閉じる。`aria-haspopup="true"` を足す。
- [x] 4. **UX-25**: 1440px 以上では保存・読込・視点を「⋯」から**出したままにする**。
- [x] 5. **UI-09**: 設定に `patchIfChanged(key, value)` を足し、変わっていないのに保存してトーストを出すのをやめる。`userContentDir` に入力検証（Task 9 の main 側と同じ条件）。
- [x] 6. **UX-16**: 設定のスキン注記7項目を `<details>`「この見た目の根拠（指導員向け）」に畳む（既定は畳む）。
- [x] 7. **UI-12**: `role="toolbar"` に `aria-label` と roving tabindex を足す（または `role` を外す）。
- [x] 8. **UI-18**: `AudioContext` を最初のジェスチャで `resume()` する。死んだ `close()` を削除する。
- [x] 9. **UI-19**: 絞り込みボタンの `key` を表示ラベルから安定値に変える。
- [x] 10. **UI-21**: 指摘種別のポップオーバーに `role="status"` / `aria-live` とフォーカス移動を足す。
- [x] 11. **UX-15**: 視点操作の早見表を `nowrap` ＋ `ellipsis` の1行から、マウス／キーボード／ビューキューブの3段カード（12px）にする。
- [x] 12. **UX-20**: C1 のマークシートを「部品＝行・不良原因＝列」の表にし、列見出しを固定する。狭い幅では部品ごとの `<details>`。
- [x] 13. **UX-23**: 回路図エディタのキー早見表を 11px のベタ1行から `<dl>` にする。
- [x] 14. **UX-30 ／ PR-10**: 判定中に不定進捗を出す。練習タイマーに残り時間と打切りの知らせを足す。
- [x] 15. **3D-17**: WebGL コンテキスト喪失の告知を4画面すべてに出し、`key` を同時に変えて即座にフラグが落ちるのを止める。
- [x] 16. テスト。`toolbar.test.tsx`（Esc・外側・項目で閉じる）／`settings-screen.test.tsx`（変更なしで blur しても IPC が飛ばない）／`label-declutter.test.ts`（2クラスが対象でランク順に譲る）／`marksheet.test.tsx`（表の行列と列見出しの固定）。

**期待:** `e2e/ui-quality.spec.ts` の `blocking` 0件。1280×800 ではみ出し0件。

---

## Task 25: 学習導線と結果画面の「次の一手」

**モデル: Opus**（要約の優先順位とヒントの段の設計）
**指摘: UX-05（High）／ UX-11 ／ UX-12 ／ UX-13 ／ UX-18 ／ UX-19 ／ UX-28 ／ UX-29 ／ PR-02 ／ PR-03 ／ PR-09**

**Files:**
- Create: `apps/desktop/src/renderer/result/verdict-summary.ts`
- Create: `apps/desktop/src/renderer/session/hints.ts`
- Modify: `apps/desktop/src/renderer/result/{ResultView.tsx,MismatchList.tsx,SuspectList.tsx}`
- Modify: `apps/desktop/src/renderer/screens/{Home.tsx,ProblemList.tsx}` / `screens.module.css`
- Modify: `apps/desktop/src/renderer/panels/Toolbar.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`

**Steps:**

- [x] 1. **PR-03 ／ UX-13**: `verdict-summary.ts` に純関数を書く（`JudgeResult` ＋ `WiringSuspect[]` → 1行）。優先順位は (1) 静的チェックのエラー → (2) 疑わしい配線の先頭 → (3) 最初の差分。疑わしい配線が0件なら「配線に違いは見つかりませんでした。部品の設定と操作の順序を見直してください」。合否バッジの隣に出し、画面末に「盤で直す」を置く（`SuspectList` の「盤で見る」を先頭の疑いに対して呼ぶ）。モードDは `session/plc-explain.ts` の既存の説明を同じ書式に揃える。
- [x] 2. **UX-11**: `MismatchList.tsx:40-42` の素の `PL1` を `packages/content/src/timechart.ts` の `OUTPUT_LABELS` 由来の表示名にする。
- [x] 3. **UX-12**: `mismatchReason` を平易な言い回しに置換する（「点く（切れる）はずの変化が起きていません」など）。**`style.json` の禁止語検査に掛けてから入れる。**
- [x] 4. **PR-09 ／ UX-18 ／ UX-19**: 課題一覧に「課題を探す」入力欄、級の絞り込みに「3級（おすすめ）」表記と初回の既定、各行に課題説明の先頭1文（薄字）、**行全体をクリックで開く**（`<tr>` に `onClick` ＋ `tabIndex`）、ID 列を右端へ。**課題が72題になるのでこの導線は必須**。`difficulty` と `tags`（Task 4）で絞り込めるようにする。
- [x] 5. **UX-05 ／ UX-28**: ホームの「最近の課題」を**押せるボタン**にして `applyWorkFile` 経路へ入れる。ホーム下半分（約400px の空白）に「はじめての方はここから」の帯と「続きから」を置く。
- [x] 6. **UX-29**: モード名の副題から内部識別子（モードB／C1／C2／D）を外す。
- [x] 7. **PR-02**: 上の帯に「ヒント」を置き、押すたびに1段ずつ開く（第1段「いまの手順でやること」／第2段「この課題の考え方」／第3段「次に置く（つなぐ）1本」）。**級による制限を守る** —— 1級は回路図が与えられない級なので第3段を出さない。何段まで開いたかを結果画面に「ヒントを使った回数」として出す。`hints.ts` は純関数（課題と手順から段を作る）。課題スキーマに任意の `hints.texts?: string[]` を足してよい（無ければ手順から自動生成。`formatVersion` は 1 のまま）。
- [x] 8. テスト。`verdict-summary.test.ts`（優先順位の全分岐・0件の落とし方）／`problem-list.test.tsx`（行クリック・検索・級の既定・72題の絞り込み）／`home.test.tsx`（最近の課題が押せる）／`hints.test.ts`（1級で第3段が出ない）。

**期待:** 不合格の結果画面に1行要約と「盤で直す」が出ること。課題一覧で72題から3秒以内に目的の課題に辿り着けること。

---

## Task 26: 文字とUIの大きさ・高コントラスト

**モデル: Opus**（px → rem の置換範囲の判断）
**指摘: UX-17 ／ PR-06**

**Files:**
- Modify: `apps/desktop/src/renderer/app/global.css`
- Modify: `apps/desktop/src/renderer/screens/Settings.tsx`
- Modify: `apps/desktop/src/shared/ipc.ts`（`AppSettings`）
- Modify: `apps/desktop/src/main/settings.ts`（検証と既定）
- Modify: 主要な `*.module.css`（注記・表・パネル見出しから段階的に `rem` へ）
- Modify: `apps/desktop/src/renderer/three/label-declutter.ts`

> 本体仕様 §8.2 / §12 の名札の大きさ（12px 相当以上）は 2026-09-20 の所有者決定で改訂済み。本タスクは仕様を触らない。

**Steps:**

- [x] 1. `AppSettings` に `uiScale: 0.9 | 1.0 | 1.15 | 1.3`（既定 1.0）と `contrast: 'normal' | 'high'`（既定 `'normal'`）を足す。main 側で値域を検証する。
- [x] 2. `:root` に `--ui-scale` を置き、`html { font-size: calc(16px * var(--ui-scale)) }`。主要パネルの px を `rem` にする（**まず注記・表・パネル見出し**。3Dの名札は `label-declutter` の基準寸法に掛ける）。
- [x] 3. `[data-contrast="high"]` の上書きテーマを足す（`--muted` を明るくし、模範波形・注記・補助線を 4.5:1 以上に上げる）。
- [x] 4. 設定画面に「文字と UI の大きさ: 小（90%）／標準（100%）／大（115%）／特大（130%）」と「見やすさ: 標準／高コントラスト」を足す。
- [x] 5. ヘルプ引き出し（Task 32）にも `--ui-scale` が効くことを確かめる。
- [x] 6. テスト。`settings-ui-scale.test.tsx`（4段階が保存され `--ui-scale` が変わる）／`contrast.test.ts`（高コントラストで `--muted` のコントラスト比が 4.5:1 以上）／`e2e/ui-quality.spec.ts` に**「特大」での1周**を足し、はみ出し0件を担保する。

**期待:** 文字サイズ「特大」で 1280×800 を1周してはみ出し0件。

---

## Task 27: 3D盤の直接操作

**モデル: Opus**（本設計 §7 の中心。当たり判定・しきい値・断り方の判断が多い）
**指摘: UX-08 ／ PR-11 ／ 利用者要望9**

**Files:**
- Modify: `apps/desktop/src/renderer/session/interaction.ts`（`Intent` / `intentOf()` / `legalTargets()` / `refuseMessageKey()`）
- Modify: `apps/desktop/src/renderer/three/{AcFixtures.tsx,Socket.tsx,MountedPart.tsx,Wire.tsx,TerminalHit.tsx,BoardScene.tsx}`
- Create: `apps/desktop/src/renderer/three/WirePreview.tsx`
- Create: `apps/desktop/src/renderer/panels/HoverHint.tsx`
- Modify: `apps/desktop/src/renderer/panels/{PartsPanel.tsx,TerminalListPanel.tsx}`
- Modify: `apps/desktop/src/renderer/app/store-session.ts` / `i18n/ja.ts`
- Create: `apps/desktop/test/{interaction-intent.test.ts,board-pointer.test.tsx,parts-palette.test.tsx,ac-fixtures.test.tsx}` / `apps/desktop/e2e/direct-manipulation.spec.ts`

**設計は本設計 §7.3 のとおり。**

**Steps:**

- [x] 1. **純関数を先に**: `interaction.ts` に `Intent` 型（本設計 §7.3.1 の union をそのまま）、`intentOf(state, hit)`、`legalTargets(state)`、`refuseMessageKey(reason)` を足す。既存の `pickToAction()` は `intentOf()` を呼ぶ薄い層にする。**この段階で `interaction-intent.test.ts` を全分岐ぶん書いて緑にする。**
- [x] 2. **ポインタの作法**: `BoardScene.tsx` に `INTERACT_DRAG_THRESHOLD_PX = 4` のしきい値、`setPointerCapture`、`Escape` の取消を入れる。始点が端子なら配線ドラッグ、盤の地なら視点回転。
- [x] 3. **電源**: `AcFixtures.tsx` のブレーカ・スイッチの**操作部だけ** `raycast={noPick}` を外し、`onClick` で `bridge.send({type:'breaker'|'switch', on})` を送る。レバーの傾きを 150ms で補間する。順序違反は既存の `power-sequence-violation` に載せる。
- [x] 4. **配線**: 始点のクリック／ドラッグ開始で `WirePreview` を出し、指先まで仮の電線を伸ばす。確定できる端子だけを光らせ、できない端子は灰のまま。`refuse` の理由を `HoverHint` に出す（「この端子はすでに2本です」）。クリック→クリックの既存経路は**そのまま残す**。
- [x] 5. **部品**: `PartsPanel` をパレットにする（在庫カード＋残数）。カードを `pointerdown` でつまみ、半透明のゴーストが付いてくる。3D の上でレイキャストしてソケットを求め、光らせる。`pointerup` で `runPlug()`。**クリックで選んでからソケットをクリックする経路も残す**（キーボード利用者のため）。装着部品をソケットの外へ放すと取り外し。
- [x] 6. **ホバー**: `Socket` / `MountedPart` / `Wire` に `hovered` を足し、縁取りで示す。カーソルを対象ごとに変える（`pointer` / `crosshair` / `grab` / `move`）。`HoverHint.tsx` を3Dペインの下端に置き、`aria-live="polite"` にも同じ文を出す。
- [x] 7. **PR-11**: 端子リストの行と3D の端子を**相互にハイライト**する（`setHovered` を両方向へ）。
- [x] 8. **UX-08**: 「部品」パネルの空状態（文章だけ）を、ソケット一覧のボタン（`S1（CR1）`…）に変える。押すと `setSelectedSocket` が走る。
- [x] 9. **undo**: 配線・装着・取り外し・電源の入切を既存の `pushCommand()` に載せる（`HISTORY_LIMIT = 50`）。
- [x] 10. テストは本設計 §7.5 の表のとおり。E2E は `e2e/projection.ts` で3D座標を画面座標に落として `page.mouse` で操作する。

**期待:**

```bash
pnpm --filter @ojt/desktop test -- interaction-intent board-pointer parts-palette ac-fixtures
# 期待: 全件 pass
pnpm --filter @ojt/desktop e2e direct-manipulation
# 期待: ①ブレーカを押すと状態表示が変わる ②パレットからソケットへ運ぶと装着される
#       ③端子から端子へドラッグすると電線が1本増える
```

---

## Task 28: 初回ガイド（3分ツアー）

**モデル: Opus**
**指摘: PR-04 ／ UX-28 ／ 利用者要望9**

**Files:**
- Create: `apps/desktop/src/renderer/tour/{TourOverlay.tsx,tour-store.ts,tour.module.css}`
- Modify: `apps/desktop/src/renderer/app/App.tsx`（1行）
- Modify: `apps/desktop/src/shared/ipc.ts`（`AppSettings.tourDone`）／ `src/main/settings.ts`
- Modify: `apps/desktop/src/renderer/screens/Settings.tsx`（「案内をもう一度見る」）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Create: `apps/desktop/test/tour.test.tsx`

**Steps:**

- [x] 1. `AppSettings` に `tourDone: boolean`（既定 `false`）。main 側で検証する。
- [x] 2. `TourOverlay` は半透明の覆いで**5枚**。①盤を回す ②ソケットに部品を置く ③端子から端子へつなぐ ④電気を流す（ブレーカ→スイッチ）⑤判定する。各枚は**実際に操作すると次へ進む**（読むだけで終わらせない）。対象要素を切り抜いて明るく見せる（`clip-path`）。
- [x] 3. 出るのは**初回にモードBの課題を開いたときだけ**。「あとで」「二度と出さない」「`Esc`」で閉じられる。閉じたら `tourDone: true` を保存する。
- [x] 4. 設定と `F1` ヘルプから**いつでも出し直せる**（`JA.settings.restartTour`）。
- [x] 5. WebGL コンテキストが無い環境では覆いを出さない。
- [x] 6. `pushModalLayer()` の作法に従い、既存のショートカットを黙らせる。フォーカストラップは `app/focus-trap.ts`（Task 11）を使う。
- [x] 7. テスト: 初回だけ出る／`Esc` で閉じる／設定から出し直せる／`tourDone` が保存される／操作すると次の枚へ進む。

**期待:** `pnpm --filter @ojt/desktop test -- tour` 全件 pass。初回起動で5枚が出て、操作しながら1周できること。

---

## Task 29: CI と検査の死角

**モデル: Opus**
**指摘: QA-01（High）／ QA-10 ／ QA-14 ／ QA-23 ／ QA-24**

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`（root に `verify`）／ `apps/desktop/package.json`（`test:coverage`）
- Modify: `apps/desktop/{vitest.config.ts,tsconfig.json,eslint.config.js}`
- Modify: `.nvmrc` / `.npmrc`（新規）
- Delete or fix: root の `vitest.config.ts` / `vitest.workspace.ts`

**Steps:**

- [x] 1. root の `package.json` に `"verify": "pnpm typecheck && pnpm lint && pnpm -r test"` を足す。
- [x] 2. `.github/workflows/ci.yml` を新設する。`windows-latest` で `pnpm/action-setup` ＋ `actions/setup-node`（`node-version-file: .nvmrc`, `cache: pnpm`）→ `pnpm install --frozen-lockfile` → `pnpm verify`。別ジョブ（`needs: verify`）で `build` → `e2e` を回し、`screenshots/` と `test-results/` を artifact に収集する。
- [x] 3. **QA-24**: root の `vitest.config.ts` / `vitest.workspace.ts` はどのスクリプトからも使われず、`--coverage` を付けると閾値なしで走る。**削除する**（残すなら root 経由を正にする）。どちらにしたかを Steps に記録する。
  - **決定: 削除した**（`vitest.config.ts` / `vitest.workspace.ts` とも `git rm`）。root `tsconfig.json` の `include` からもこの2つを外した。副作用: `include` が `eslint.config.js` だけになり `tsc -p tsconfig.json` が `TS18003 No inputs were found` で落ちたため、root `tsconfig.json` に `"allowJs": true` を追加（`eslint.config.js` を実際に入力として数えるため。レビュー §QA-24 反証注記のとおり、この `include` は元々 `eslint.config.js` も指していたが `allowJs` が無く黙って対象外になっていた）。
- [x] 4. **QA-23**: `.nvmrc` は 22 のまま（LTS）、`engines.node` を `">=22 <26"`、`.npmrc` に `engine-strict=true`。`scripts/build.mjs` / `dev.mjs` が Node 25 の不具合回避のために存在することを**その場のコメントに明記**する。
  - `build.mjs` / `dev.mjs` は Task 29 着手前から Node 25 回避のコメントを持っていたため変更なし（確認のみ）。
- [x] 5. **QA-10**: `apps/desktop` に `test:coverage`（v8 provider・**閾値なし**・`text-summary` ＋ `json-summary`）を足す。1度測って、その値をリリースノートに記録する（以降は実測 −3pt でラチェット）。
  - 実測値は本ファイル末尾の「Task 29 実施メモ」に記録（`docs/releases/v1.1.0.md` は Task 38 がまだ作っていないため、Task 38 がそこから転記する）。
- [x] 6. **QA-14**: `apps/desktop/tsconfig.json` に `allowJs` / `checkJs` ＋ `include: ["scripts/**"]`、`eslint.config.js` の型情報ルールを `apps/desktop/scripts/**` に効かせる。`scripts/*.mjs` 8本（約880行）の型エラーを潰す。
  - `include` は `scripts/**` だと `TS5010`（再帰ワイルドカードで終われない）になるため `scripts/**/*.mjs` / `scripts/**/*.mts` の2行にした。型エラー3件（`check-dist.mjs` 2件・`print-manual.mjs` 1件）を JSDoc 注釈で解消。ESLint の型情報ルールは `annotate-shots.mjs` / `build-manual.mjs` / `feature-inventory.mjs` / `manual-build.mjs` の4本には**当てていない**（同名の手書き `*.d.mts` が型の正本で、TS はこの4本の `.mjs` 本体を root file としてプログラムに入れない＝`checkJs` の対象にもならない。型情報つき ESLint を当てると `project service` に見つからず構文エラーになるため、意図してこの4本だけ `disableTypeChecked` のまま残した）。残る5本（`build.mjs` / `check-dist.mjs` / `copy-content.mjs` / `dev.mjs` / `print-manual.mjs`）には型情報つき ESLint を当て、`check-dist.mjs` の `no-unsafe-assignment`/`no-unsafe-member-access` 1件を制御フローでの絞り込み（`versionOf()`）で解消（JSDoc `@type` キャストは checkJs 下のこの ESLint 版では効かないため使わなかった）。
- [x] 7. テスト: `scripts/*.d.mts` の宣言と `scripts/*.mjs` の `export` 名が集合として一致すること。
  - `apps/desktop/test/script-declarations.test.ts` を新設。4本の `.d.mts` すべてで一致を確認。

**期待:** `pnpm verify` が GitHub Actions の必須チェックになり、`main` への push で必ず走ること。`pnpm install --frozen-lockfile` が通ること。

---

## Task 30: E2E の足場としきい値

**モデル: Opus**
**指摘: QA-02（High）／ QA-03（High）／ QA-04（High）／ QA-11 ／ QA-12 ／ QA-13 ／ QA-26 ／ UX-27**

**Files:**
- Create: `apps/desktop/e2e/app.ts`
- Modify: `apps/desktop/playwright.config.ts` ／ `apps/desktop/e2e/*.spec.ts`（12本）
- Modify: `README.md`（`e2e` と `dist` を隣に並べない）

**Steps:**

- [x] 1. **QA-13 ＋ QA-12**: `e2e/app.ts` を新設し、`CHROMIUM_FLAGS` / `launchApp()`（**`--user-data-dir=${mkdtempSync(...)}` 込み**）/ `shot()` / `dismissRestorePrompt()` を export する。12 spec の `beforeAll` を1行に置き換える（複写12箇所と spec 間の状態漏れが同時に消える）。`manual-shots.spec.ts` の `%PUBLIC%` だけは「撮影者のアカウント名が説明書に写り込まない」ためなので**現状維持**。
- [x] 2. **QA-02**: `playwright.config.ts` に `projects` を置き、`manual-shots.spec.ts` を**既定から外す**（`pnpm e2e` が追跡対象の図 約3MB を書き換え、その直後の `dist` が別物の PDF を焼くのを止める）。README とリリース手順チェックリストに注意の正本を移す（Task 33 と調整）。
- [x] 3. **QA-03**: `perf` / `polish` / `schematic` の `test.describe(` を `.serial(` にする（順序依存と `retries: 1` が噛み合っていない）。
- [x] 4. **QA-04**: `use: { trace: 'on-first-retry', screenshot: 'only-on-failure' }` ＋ `forbidOnly` ＋ CI 用 html reporter。
- [x] 5. **QA-26**: `ui-quality.spec.ts:1644` の残骸読み戻しを `OJT_UI_AUDIT_REUSE === '1'` 条件にする（指摘0件の理想的な実行でだけ壊れる不具合）。
- [x] 6. **QA-11**: 集計ループに4行足して `RATCHET:` の警告を実装する（「実測が基準より20%以上少なければ警告」はコメントだけで実装が無い）。
- [x] 7. **UX-27**: `MIN_FONT_PX` を **12**、`MIN_TARGET_PX` を **32** に上げ、上がった件数をそのまま新しい基準値に置く。`small-target` の基準値 126 は実測（0）まで下げる。
- [x] 8. `pnpm --filter @ojt/desktop e2e` を**2回**走らせ、2回とも同じ結果になること（状態漏れが無いこと）を確かめる。

**実施の記録（2026-09-20）:**

- 既定プロジェクトは 12 spec / 66 テスト、`manual-shots` プロジェクトは 1 spec / 7 テスト
  （`playwright test --list --project=…` で確認）。撮り直しは `pnpm --filter @ojt/desktop e2e:shots`。
- Step 7 の新しい基準値（69画面・3サイズの実測。`%TEMP%\ui-audit/summary.json`）:
  `blocking 0` ／ `page-overflow 0` ／ `clip 0` ／ `overlap 27 → 0` ／ `hud-overlap 0` ／
  `duplicate 0` ／ `wrap 30 → 1` ／ `small-text 24 → 1,523` ／ `small-target 126 → 1,505` ／
  `overlap 27 → 14` ／ `focus 0` ／ `canvas 0`（**2回の実測の大きい方**。2回のあいだに
  Task 19・21・33 が landed して画面が変わり、1回目 1,523/899/overlap 0、2回目 1,419/1,505/overlap 14
  だった）。**`small-text` / `small-target` が増えたのはしきい値を
  11px→12px・24px→32px に上げたため**であり、これは「直すべき件数」である（Task 24・26 が下げる）。
  歩けなかった状態は2回目で4件（`modeC1-hazard` と、Task 21 のデバイス入力欄が閉じない不具合で
  歩けなかったモードD（OMRON）の3状態）。**その不具合が直ったら測り直すこと**（Task 37）。
- `launchApp()` は起動ごとに使い捨ての `userData` を作る（QA-12）。`ui-quality.spec.ts` の
  「起動時の復元カード」だけは、2回の起動へ同じフォルダを渡して前回の一時保存を作っている。

**期待:**

```bash
pnpm --filter @ojt/desktop e2e
git status --short
# 期待: 空（QA-02 の構造的対策）
```

---

## Task 31: 配布ゲートを実際に動かす

**モデル: Opus**
**指摘: QA-08 ／ QA-09 ／ QA-15 ／ QA-16 ／ QA-17 ／ QA-19**

**Files:**
- Modify: `apps/desktop/scripts/{check-dist.mjs,copy-content.mjs,build-manual.mjs}`
- Modify: `apps/desktop/electron.vite.config.ts` ／ `electron-builder.yml`
- Create: `apps/desktop/test/{check-dist.test.ts,copy-content.test.ts}`
- Modify: `apps/desktop/test/{release-manual.test.ts,manual-build.test.ts}`

**Steps:**

- [ ] 1. **QA-15 ＋ QA-09**: `check-dist.mjs` を「検査関数を export するモジュール」＋「薄い入口」に割る。検査を足す: asar の目次（`out/main/index.js` の有無・`node_modules` の混入）、PDF の `%PDF-` マジックバイト、同梱 JSON の**内容**比較、成果物のサイズ下限。`check-dist.test.ts` で偽の release ツリーを `mkdtempSync` で組み、5ケース（全部揃う／PDF欠損／PDF 0バイト／課題が1件足りない／旧版が残っている）を実行する。
- [ ] 2. **QA-08**: `electron.vite.config.ts` の `OJT_PACKAGES`（4本）をやめ、`package.json` の `dependencies` から `@ojt/*` を抽出する。`release-manual.test.ts` に「同集合であること」の検査を足す。
- [ ] 3. **QA-19**: `copy-content.mjs` に「ターゲット側の**余分な**モードフォルダを消す」3行を足し、`check-dist.mjs` にモード集合の等号チェックを足す。`copy-content.test.ts` で「正本に無いモードフォルダ」を仕込み、それが消えることを確かめる。
- [ ] 4. **QA-16**: PDF の生成日を `OJT_MANUAL_DATE` 環境変数 → `git log -1 --format=%cs` → 今日 の順に決める。`manual-build.test.ts` に「同じ `files` と同じ `builtAt` を渡した2回の `buildManual()` がバイト単位で同一」「`builtAt` を渡さなければ表紙に日付が出ない」を足す。**同じコミットから同じ SHA256 の PDF が焼けるようにする。**
- [ ] 5. **QA-17**: `artifactName` を ASCII（`DenkiKyoikuTool-${version}-${arch}.${ext}`）にする。インストール後の実行ファイル名（`productName`）は日本語のまま変えない。README とリリースノートの対応表を不要にする。

**期待:**

```bash
pnpm --filter @ojt/desktop test -- check-dist copy-content release-manual manual-build
# 期待: 全件 pass
```
worktree で `pnpm --filter @ojt/desktop dist` を**2回**走らせ、`manual.pdf` の SHA256 が一致すること。

---

## Task 32: ヘルプ引き出しの読みやすさ

**モデル: Sonnet**（本設計 §6.4 に変更後の値が逐語である）
**指摘: UX-21 ／ 利用者要望5**

**Files:**
- Modify: `apps/desktop/src/renderer/help/{help.module.css,HelpDrawer.tsx,help-model.ts}`
- Modify: `apps/desktop/test/help-drawer.test.tsx`

**Steps:**

- [x] 1. `.drawer` の幅を `min(560px, 46vw)` にする。1280px 未満ではもくじ（`.contents`）を畳む（`<details>`）。
- [x] 2. `.prose` を 14px / 1.85、`max-width: 34em`。見出し（`.sectionTitle`）を 17px。`--ui-scale`（Task 26）が効くよう `rem` にする。
- [x] 3. 節の末尾に「← 前の節 ／ 次の節 →」と「この節をPDFで見る」を置く。`MANUAL_CHAPTERS[].sectionIds` の並びをそのまま使う。
- [x] 4. 図の縮小版に「押すと大きくなる」ことが分かる枠と虫めがねの印を出す。
- [x] 5. 検索結果を章ごとにまとめ、一致箇所を太字にする（既存の `EXCERPT_PAD` の窓をそのまま使う）。
- [x] 6. 本文中の `<a href="#sec-…">`（Task 34 で入る）を `onProseClick` で拾い `showSection()` に流す。**外部 URL は開かない**（§15 の外部通信なし）。
- [x] 7. テスト: 幅とフォントの CSS 値／前後の節ボタンが並び順どおり／内部リンクを押すとその節へ移る／外部 URL を押しても何も起きない。

**期待:** `pnpm --filter @ojt/desktop test -- help-drawer` 全件 pass。1行 34 字前後で読めること。

---

## Task 33: リポジトリの文書を実態に合わせる

**モデル: Sonnet**（直す箇所と直す内容がレポートに逐語である）
**指摘: QA-20 ／ QA-21 ／ QA-22 ／ UX-24 の④**

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-…design.md`（§14.2 / §15 / §17 / 改訂履歴）
- Rename: `docs/superpowers/handoff/2026-09-14-phase2-handoff.md` → `docs/superpowers/PROJECT-LOG.md`
- Modify: `README.md`
- Create: `CONTRIBUTING.md` / `LICENSE` / `packages/*/README.md`（6本）
- Modify: `docs/manual/02-screens.md`（UX-24 の④）

**Steps:**

- [x] 1. **QA-20**: 本体仕様の改訂履歴に「Phase 3〜6 の反映」1エントリを足す。§14.2 の E2E 行を「12 spec / 67テスト」に、§15 の文言集約先を `apps/desktop/src/renderer/i18n/ja.ts` に、§17.2 #18 の製品名の出現箇所を「13ファイル（または `PRODUCT_NAME` 定数を経由する規約）」に直す。**§5.2 と §13 #3 は Task 14 が直す**ので触らない。
- [x] 2. **QA-21**: `2026-09-14-phase2-handoff.md` を `PROJECT-LOG.md` に改名し、冒頭に位置づけを書く。**QA-02 の注意書き（`e2e` は追跡対象の図を書き換えるので `dist` の前に走らせない）の正本を README とリリース手順チェックリストへ移す**（いまは「Phase 2 引き継ぎ」という名前の文書の最終行にしかない）。
- [x] 3. **QA-22**: `CONTRIBUTING.md` 1枚に散在する規約を集約する（E2E の文言書き写し・生成物の扱い・`BASELINE` の下げ方・`dist` 前の作業ツリー清浄・コミット前に `pnpm verify`・**前提D の git の作法**）。`packages/*/README.md` を各5〜10行。社内利用条件を明記した `LICENSE`。
- [x] 4. **UX-24 の④**: `docs/manual/02-screens.md` の「状態表示が画面の**左上**」を「**右上**」に直す（左上はビューキューブ）。①②③は実装側が Task 7・21・22 で真になるので本文はそのまま使える。
- [x] 5. README の題数（28題）を **72題** に直す（Task 13・18 のあと）。

**期待:** `CONTRIBUTING.md` / `LICENSE` / `packages/*/README.md` が存在すること。本体仕様の §14.2 / §15 / §17 が実態と一致すること。

---

> **ここから Task 39・40・41**（2026-09-20 の所有者決定で Phase 7 に採用した PR-12・PR-13・PR-14）。番号は 38 より大きいが、**実行はバッチ F・G**であり、Task 34〜36（バッチH）と Task 37・38（バッチI）より**前**に landed させる。番号を振り直していない理由は §「実装バッチ」の注記を参照。

---

## Task 39: 判定の操作列を1歩ずつ再生する（PR-12）

**モデル: Opus**（判定と食い違わない再生経路の設計が中心）
**指摘: PR-12 ／ 利用者要望9（「操作説明がなくても直感的に」）**
**バッチ: F（3系統目。Task 25 のあと）**

**Files:**
- Create: `apps/desktop/src/renderer/session/replay.ts`（純関数）
- Create: `apps/desktop/src/renderer/panels/ReplayBar.tsx` ＋ `panels/replay-bar.module.css`
- Modify: `apps/desktop/src/worker/protocol.ts` / `sim.worker.ts`（`replay` コマンド）
- Modify: `apps/desktop/src/renderer/screens/{Session.tsx,PlcSession.tsx}`
- Modify: `apps/desktop/src/renderer/result/ResultView.tsx`（入口「動きを見直す」）
- Modify: `apps/desktop/src/renderer/app/store-session.ts` / `i18n/ja.ts`
- Create: `apps/desktop/test/replay.test.ts` / `apps/desktop/test/replay-bar.test.tsx`

**設計の要（これを外すと教材として害になる）:** 再生は**判定とまったく同じ操作列（課題の `operations`）と同じ許容差（`judge.tolerance`）**を使う。再生が判定と違う答えを出したら、それは不具合である。再生中は盤の編集（配線・装着・電源）を**すべて止める**（誤って直してしまい、結果と食い違うのを防ぐ）。

**Steps:**

- [ ] 1. **純関数を先に**: `replay.ts` に次を書き、`replay.test.ts` を全分岐ぶん緑にする。

```ts
/** 再生の1歩。課題の operations と判定結果から機械的に作る。 */
export interface ReplayStep {
  readonly index: number;          // 1 から
  readonly total: number;
  readonly atMs: number;           // この歩の操作時刻
  readonly action: string;         // 「黒押ボタン（PB1）を押す」（PB_LABELS 由来）
  readonly expect: string;         // 「白ランプ（PL1）が点くはず」（OUTPUT_LABELS 由来）
  readonly mismatched: boolean;    // この歩の窓（atMs 〜 次の操作時刻）に差分があるか
  readonly mismatchNote?: string;  // 「ここで食い違いました: 白ランプ（PL1）が点きませんでした」
}

/** 課題の操作列と判定結果から歩の並びを作る。副作用なし。 */
export function replaySteps(
  operations: readonly Operation[],
  durationMs: number,
  mismatches: readonly Mismatch[],
): readonly ReplayStep[];
```

歩の窓は「その操作の時刻から次の操作の時刻まで（最後は `durationMs` まで）」。`mismatches` の `tMs` がその窓に入る歩を `mismatched: true` にする。信号名は必ず `packages/content/src/timechart.ts` の `PB_LABELS` / `OUTPUT_LABELS` を通す（UX-11 と同じ規則。素の `PL1` を出さない）。

- [ ] 2. **Worker のコマンドを1つ増やす**: `protocol.ts` に `{ type: 'replay'; action: 'start' | 'step' | 'stop' }` を足す。`start` は現在の盤（配線も装着もそのまま）で時刻を 0 に戻し、`step` は次の操作時刻までを進めてスナップショットを返す。`sim.worker.ts` の外側 `switch` に分岐を足す（Task 10 で入れた `default: command satisfies never` があるので、足し忘れると `tsc` が落ちる）。**Task 12 が削除する `reset` コマンドを復活させないこと**（用途が違う）。
- [ ] 3. **`ReplayBar`**: 画面上部に「`1/6 歩: 黒押ボタン（PB1）を押す → 白ランプ（PL1）が点くはず`」と「← 前へ / 次へ →」「最初から」「やめる」を出す。`mismatched` の歩では帯を赤（`--danger`）にし `mismatchNote` を添える。色だけに頼らないよう `▲` と文字を添える（UX-14 の規則）。
- [ ] 4. **入口**: 結果画面（`ResultView`）に「動きを見直す」を置く。押すと盤（モードDはラダーのモニタ）へ戻り、再生モードで開く。モードB・Dが対象（C1 は操作列を持たず、C2 は B と同じ経路で動く）。
- [ ] 5. **編集の凍結**: 再生中は `store.replay !== undefined` とし、`intentOf()`（Task 27）と `pickToAction()` が `{ type: 'none' }` を返すようにする。ツールバーの編集系ボタンを `aria-disabled` にし、押したら「見直し中は盤を触れません。『やめる』を押してください」とトーストを出す（UX-03 と同じ作法）。
- [ ] 6. **やめると元に戻る**: `stop` で再生前の時刻・スナップショットに戻す。**履歴（`pushCommand`）には一切積まない**（再生は編集ではない）。
- [ ] 7. テスト。

```
apps/desktop/test/replay.test.ts
  - 操作6件・差分1件の課題で歩が6つでき、差分のある歩だけ mismatched: true
  - 信号名が PB_LABELS / OUTPUT_LABELS を通っている（素の 'PL1' が文字列に出ない）
  - 差分が0件なら mismatched がすべて false
  - 最後の歩の窓が durationMs まで伸びる
apps/desktop/test/replay-bar.test.tsx
  - 「次へ」で歩が進み、最後の歩で「次へ」が aria-disabled になる
  - mismatched の歩で帯に ▲ と理由が出る
  - 再生中にツールバーの「電線を引く」を押すとトーストが出て bridge.send が飛ばない
```

**期待:** `pnpm --filter @ojt/desktop test -- replay` 全件 pass。結果画面から「動きを見直す」で盤へ戻り、6歩を1歩ずつ進めて食い違った歩が赤く出ること。**再生の判定（どの歩で食い違うか）が結果画面の差分一覧と一致すること。**

---

## Task 40: 模範と自分を並べて見る比較ビュー（PR-13）

**モデル: Opus**（級による開示制限の判断が要る）
**指摘: PR-13 ／ 利用者要望9**
**バッチ: F（3系統目。Task 39 のあと）**

**Files:**
- Create: `apps/desktop/src/renderer/result/compare.ts`（純関数）
- Create: `apps/desktop/src/renderer/result/CompareView.tsx` ＋ `result/compare.module.css`
- Modify: `apps/desktop/src/renderer/result/ResultView.tsx` / `PlcResult.tsx`
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Create: `apps/desktop/test/compare.test.ts` / `apps/desktop/test/compare-view.test.tsx`

**級による開示制限（外すと検定の前提が崩れる）:** 回路図（模範回路）を見せてよいのは、その級で回路図が与えられる課題だけである。`assemble` は `hints.schematicVisible === (grade === 3)`、`inspect-repair` は `=== (grade === 2)`。**`hints.schematicVisible === false` の課題では、比較ビューは波形だけを出し、模範回路図は出さない。** PLC（モードD）は模範ラダーを出さない（`referenceLadder` は答えそのもの）。

**Steps:**

- [ ] 1. **純関数を先に**: `compare.ts` に次を書く。

```ts
/** 1信号ぶんの並置データ。模範と訓練者の区間を同じ時間軸に揃え、食い違う区間を抜き出す。 */
export interface CompareRow {
  readonly signal: string;         // 'PL1'
  readonly label: string;          // '白ランプ（PL1）'（OUTPUT_LABELS 由来）
  readonly expected: readonly Segment[];
  readonly actual: readonly Segment[];
  readonly diffWindows: readonly { fromMs: number; toMs: number }[];
}

/** 模範チャートと訓練者チャートを突き合わせる。許容差は判定と同じ値を渡す。 */
export function compareCharts(
  expected: TimeChart,
  actual: TimeChart,
  tolerance: Tolerance,
): readonly CompareRow[];

/** その課題で模範回路図を見せてよいか。級と mode の規則そのもの。 */
export function mayShowReference(problem: SupportedProblem): boolean;
```

- [ ] 2. **`CompareView`**: 信号ごとに2段（上=模範・破線 `--muted`、下=自分・実線）で並べ、`diffWindows` を薄い帯で塗り、帯の上に `▲` と時刻を出す。**色だけに頼らない**（UX-09 / UX-14 の規則をそのまま適用。既存の `TimeChartView` の描画部品を再利用する）。
- [ ] 3. `mayShowReference(problem) === true` のときだけ、波形の下に「模範の回路図」と「自分の配線」の**差分一覧**（不足している接続・余分な接続）を出す。`packages/schematic-core` の割当結果と盤のネットリストを突き合わせる。`false` のときは「この級では回路図は出しません。波形と『疑わしい配線』から考えてください」と1行で断る。
- [ ] 4. **入口**: 結果画面に「模範と見くらべる」を置く。`pushModalLayer()` の作法で覆いとして開き、`Esc` で閉じ、フォーカスを戻す（`app/focus-trap.ts` を使う）。
- [ ] 5. 拡大と案内線は既存のタイムチャート（2026-09-18 の利用者決定「クリックで拡大＋縦の案内線」）と**同じ操作**にする。新しい操作を作らない。
- [ ] 6. テスト。

```
apps/desktop/test/compare.test.ts
  - 完全一致なら diffWindows が空
  - 許容差 edgeMs 以内のずれは diff にしない（判定と同じ値で同じ答えになる）
  - 遷移が余分／不足のとき窓が出る
  - mayShowReference: assemble 3級=true / 2級・1級=false、inspect-repair 2級=true / 1級=false、plc=false
apps/desktop/test/compare-view.test.tsx
  - 1級の課題で模範回路図が描かれず、断りの1行が出る
  - 差分の帯に時刻と ▲ が出る（色以外の手がかり）
  - Esc で閉じてフォーカスが「模範と見くらべる」に戻る
```

**期待:** `pnpm --filter @ojt/desktop test -- compare` 全件 pass。**`compareCharts()` の差分が結果画面の差分一覧・Task 39 の再生と3つとも一致すること。**

---

## Task 41: 結果の1枚書き出し（PR-14）

**モデル: Opus**（決定#5 の境目にあたるので、書き出す範囲と「貯めない」ことの担保が要る）
**指摘: PR-14 ／ 利用者要望11（進み具合を残したい）**
**バッチ: G（3系統目・単独）**

**決定#5 との関係（2026-09-20 の所有者決定）:** 「進捗・成績の永続記録はしない」は**アプリが貯めないこと**を指す。本タスクは**利用者が選んだ場所へ1回書き出すだけ**であり、アプリ側に履歴・集計・既定の保存先を一切持たない。**自動保存しない／前回の保存先を覚えない／書き出した件数を数えない。**

**Files:**
- Create: `apps/desktop/src/renderer/result/report-html.ts`（純関数）
- Create: `apps/desktop/src/main/result-export.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`（`IPC_CHANNELS` に9本目 `resultExport`、`OjtApi.exportResult`）
- Modify: `apps/desktop/src/shared/messages.ts` / `src/main/ipc.ts` / `src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/result/ResultView.tsx` / `PlcResult.tsx` / `i18n/ja.ts`
- Modify: `apps/desktop/test/ipc-surface.test.ts`（**8本 → 9本**）
- Create: `apps/desktop/test/report-html.test.ts` / `apps/desktop/test/result-export.test.ts`

**Steps:**

- [ ] 1. **純関数を先に**: `report-html.ts` に `resultReportHtml(input: ReportInput): string` を書く。載せるもの: 課題ID・題名・級・難易度／開始と所要時間／合否／「なぜ落ちたか」1行（Task 25 の `verdictSummary()` を再利用）／静的チェックの結果／差分一覧（表示名。`OUTPUT_LABELS` 経由）／疑わしい配線／危険操作の回数／ヒントを使った回数。**利用者名・絶対パス・内部ID（`w-003`）は一切載せない**（DM-8 / UI-04 と同じ規則）。文字列はすべて HTML エスケープする。体裁は Task 34 の `PRINT_CSS` から**紙のトークンだけ**を借りた小さな `<style>` を埋め込む（外部参照0・画像0で1ファイルに閉じる）。
- [ ] 2. **IPC 9本目**: `IPC_CHANNELS` に `resultExport: 'result:export'` を足す。引数は `{ html: string; suggestedName: string }`。main 側 `result-export.ts` は ①`html` の型とサイズ（1 MiB 上限）を検査 ②`safeFileName(suggestedName)` ③`dialog.showSaveDialog`（既定の保存先は OS のドキュメント。**前回の場所は覚えない**）④キャンセルなら `{ ok: true, canceled: true }` ⑤PDF を選んだら**オフスクリーンの `BrowserWindow`**（`nodeIntegration: false` / `contextIsolation: true` / `sandbox: true` / `javascript: false`）で一時ファイルの HTML を読み `printToPDF()`、HTML を選んだらそのまま書く ⑥一時ファイルを必ず消す。書き込みは Task 9 の `fs-atomic.ts` を使う。
- [ ] 3. **入口**: 結果画面の操作バーに「この結果を書き出す」を置く。押すと保存ダイアログが出る。**押す前にアプリは何も書かない。**
- [ ] 4. **文言**: 成功「結果を書き出しました」、キャンセルは無言、失敗は `errno` 対応表（Task 9 の DM-8）経由の日本語。すべて `i18n/ja.ts` と `shared/messages.ts`。
- [ ] 5. **ハードニングの検査を更新**: `ipc-surface.test.ts` の期待を **9本**にする（Task 8 が作った「`IPC_CHANNELS` と完全一致」の検査はそのまま効く）。CSP・`setPermissionRequestHandler` はオフスクリーン窓にも適用されることを `hardening.test.ts` で確かめる。
- [ ] 6. **本体仕様への追記**: §4.3 の IPC 一覧に9本目を足し、決定#5 の解釈（アプリは貯めない／利用者が1回書き出すだけ）を1行で明記する。Task 33 が触る節とは別の節なので競合しない。
- [ ] 7. テスト。

```
apps/desktop/test/report-html.test.ts
  - 利用者名・絶対パス・w-\d{3} 形式の内部IDが出力に出ない
  - <script> を含む課題名を渡してもエスケープされる
  - 合格時と不合格時で節の構成が変わる
  - 外部参照（http: / https: / src=）が1つも無い
apps/desktop/test/result-export.test.ts
  - dialog をスタブしてキャンセルすると何も書かれない
  - 1 MiB を超える html が拒否される
  - safeFileName が '../' を含む名前を弾く
  - 一時ファイルが後始末される（失敗時も）
apps/desktop/test/ipc-surface.test.ts
  - 登録チャネルが 9 本で IPC_CHANNELS と完全一致
```

**期待:** `pnpm --filter @ojt/desktop test -- report-html result-export ipc-surface hardening` 全件 pass。結果画面から1枚の PDF を書き出せ、**アプリ側には何も残らない**こと（`%APPDATA%/電気教育ツール` に差分が出ない）。

---

## Task 34: 説明書PDFの体裁ともくじのリンク

**モデル: Opus**（版面設計と PDF のリンク・しおりの検査方法）
**指摘: 利用者要望5・6**

**Files:**
- Modify: `apps/desktop/scripts/manual-build.mjs`（`PRINT_CSS` の全面書き直し、`anchorIdOf()`、章番号・図番号、注意箱）
- Modify: `apps/desktop/scripts/print-manual.mjs`（`displayHeaderFooter` / `headerTemplate` / `footerTemplate` / `preferCSSPageSize` / `generateTaggedPDF`）
- Create: `apps/desktop/test/manual-pdf.test.ts`
- Modify: `apps/desktop/test/manual-build.test.ts` / `manual-sync.test.ts`
- Modify: `docs/manual/*.md`（注意箱の記法を `> **注意**` / `> **ヒント**` / `> **やってはいけない**` に揃える）

**設計は本設計 §6.2・§6.3 のとおり。**

**Steps:**

- [x] 1. `anchorIdOf(id: string): string` を書く（章ID・節IDを URL に安全な形へ写す純関数。ASCII 化ではなく `encodeURIComponent` 可能な形で一意性を保つ）。`<h1 id="ch-…">` / `<h2 id="sec-…">` を出す。
- [x] 2. `<nav id="toc">` の各行を `<a href="#…">` にする。章は 11pt 太字、節は 10pt、行末にリーダ（点線）。
- [x] 3. 章番号（`第1章`〜`第15章`）と節番号（`1.1`）を**変換時に機械で振る**（正本の Markdown には書かない）。図番号（`図 3-2`）も同様にし、`figcaption` を「図 3-2 盤の画面」の形にする。
- [x] 4. `PRINT_CSS` を本設計 §6.2 の表のとおり書き直す。`@page { size: A4; margin: 18mm 16mm 20mm; }`、本文 `max-width: 150mm`、見出しに `page-break-after: avoid`、表の `thead` 繰り返し、注意箱3種、手順の `counter`。
- [x] 5. 表紙を作り直す（製品名28pt・版・発行日・「この説明書の読み方」3行・「困ったら `F1`」）。
- [x] 6. `print-manual.mjs` に `preferCSSPageSize: true`、`displayHeaderFooter: true`、`headerTemplate`（左に製品名、右に章題。`font-size: 9pt`、`margin: 0 16mm`）、`footerTemplate`（中央にノンブル）、`generateTaggedPDF: true` を足す。`generateDocumentOutline: true` は維持。
- [x] 7. 本文中の相互参照（`[→ 3.2 電線をつなぐ](#sec-…)`）を書けるようにし、**存在しないアンカーを指していたらテストで落とす**。
- [x] 8. テスト。

```
apps/desktop/test/manual-build.test.ts
  - すべての <a href="#…"> の行き先 id が同じ文書に実在する
  - id が重複しない（anchorIdOf の一意性）
  - 章番号・節番号・図番号が連番になっている
apps/desktop/test/manual-pdf.test.ts（新規）
  - 焼いた PDF に %PDF- / /Annots / /Link / (/Dest または /GoTo) のバイト列がある
  - ページ数が 60 以上
  - 同じ builtAt で2回焼くと SHA256 が一致する（QA-16 と対）
apps/desktop/test/manual-sync.test.ts
  - 既存のバイト一致検査が通る（生成物を作り直すこと）
```

**期待:** PDF のもくじを押すとその章・節へ飛び、しおりに全章が並ぶこと。柱とノンブルが出ること。

---

## Task 35: チュートリアル章の新設

**モデル: Sonnet-verbatim**（章立て・節名・各節の4段構成・索引の要件が本設計 §6.5 に逐語である）
**指摘: 利用者要望7**

**Files:**
- Create: `docs/manual/13-tutorial-modes.md` / `docs/manual/14-tutorial-features.md`
- Modify: `docs/manual/coverage.json`（新しい節への参照）／ `shots.json`（新しい図の**意味**）
- Create: `apps/desktop/test/manual-problem-index.test.ts`
- Modify: `apps/desktop/test/manual-coverage.test.ts`（`PROCEDURE_SECTIONS` にチュートリアル章の全節）

**Steps:**

- [ ] 1. `13-tutorial-modes.md` を書く。節は本設計 §6.5 の表のとおり6節。各モードの通しは**番号つきの `<ol>`**（`manual-coverage.test.ts` の `PROCEDURE_SECTIONS` がこれを要求する）。各手順に図の参照（`![…](images/tut-b-03.png)`）を1枚。**画像ファイルはまだ無くてよい**（Task 36 で撮る）。
- [ ] 2. `14-tutorial-features.md` を書く。1機能1節、各節は「何ができるか（1文）→ どこにあるか（図）→ 操作の順（番号つき）→ よくある間違い」の4段で固定する。対象は本設計 §6.5 の15項目。
- [ ] 3. 最終節「課題の索引」に**全72題**の表を書く（ID ／ モード ／ 級 ／ 難 ／ 題名 ／ 学ぶこと ／ つまずきやすい所）。
- [ ] 4. `shots.json` に新しい図の**意味**（`caption` と `callouts` の番号・ラベル）を書く。**場所（`shot-geometry.json`）は Task 36 が書く。**
- [ ] 5. `coverage.json` の `controls` / `keys` / `gestures` の `section` を、より適切なチュートリアル節へ付け替える（新しい操作要素＝ドラッグ配線・パレット・初回ガイドの `data-testid` はここで拾う）。
- [ ] 6. **文体の規則を守る**: `style.json` の禁止語0件、`terms.json` の語は初出で太字＋噛み砕く。
- [ ] 7. `manual-problem-index.test.ts` を新設する。

```ts
it('チュートリアル章の課題索引が内蔵課題を1つ残らず載せている', () => {
  const text = readFileSync(join(MANUAL_DIR, '14-tutorial-features.md'), 'utf8');
  for (const problem of BUILTIN_ALL_PROBLEMS) {
    expect(text, `${problem.id} が索引に無い`).toContain(problem.id);
    expect(text, `${problem.id} の題名が索引に無い`).toContain(problem.title);
  }
  const ids = [...text.matchAll(/\b([bcd]\d?-\d{3})\b/gu)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(BUILTIN_ALL_PROBLEMS.length);
});
```

- [ ] 8. `node apps/desktop/scripts/build-manual.mjs` を走らせ、`manual-content.ts` を作り直して commit する。

**期待:**

```bash
pnpm --filter @ojt/desktop test -- manual-style manual-coverage manual-sync manual-problem-index manual-shots
# 期待: 全件 pass（禁止語0件・機能網羅・正本と生成物の一致・72題の索引・図の意味）
```

---

## Task 36: 図の撮り直しと本文の更新（**バッチHの最後**）

**モデル: Opus**（撮影と吹き出しの配置、本文と実装の突き合わせ）
**指摘: UX-24 ／ 利用者要望10**

**前提:** Task 1〜35 が**すべて landed している**こと。ここより前で撮ると、直した画面が図に反映されない。

**Files:**
- Modify: `apps/desktop/e2e/manual-shots.spec.ts`（新しい図の撮影手順）
- Modify: `docs/manual/shot-geometry.json`（機械が書く）
- Modify: `docs/manual/images/**`（既存17枚の撮り直し ＋ 新規約20枚）
- Modify: `docs/manual/*.md`（実装に合わせた本文の更新）
- Modify: `apps/desktop/test/manual-images.test.ts`

**Steps:**

- [ ] 1. **本文を先に直す**。`node apps/desktop/scripts/feature-inventory.mjs` を走らせ、v1.0.0 時点の `coverage.json` との差分（増えた／消えた `data-testid`）を出す。差分のある画面の節を読み直し、実装に合わせて書き換える。特に: 3Dの直接操作（Task 27）、初回ガイド（Task 28）、回路入力（Task 21）、課題一覧の導線（Task 25）、文字サイズの設定（Task 26）、72題（Task 13・18）、**判定の再生（Task 39）・模範との比較（Task 40）・結果の書き出し（Task 41）**。
- [ ] 2. **UX-24**: ①最近の課題が押せる ②格子クリック（ダブルクリック）で欄が出る ③キー割当がいつも出ている は実装側が真になったので本文はそのまま。④「左上」→「右上」は Task 33 で直っている。再確認する。
- [ ] 3. `manual-shots.spec.ts` に新しい図の撮影を足す（チュートリアル章の手順図 約20枚）。既存17枚も**全部撮り直す**。
- [ ] 4. `pnpm --filter @ojt/desktop e2e manual-shots` を**worktree で**走らせる（共有ツリーでは追跡対象の図を書き換えるので走らせない）。`shot-geometry.json` が更新される。
- [ ] 5. `manual-images.test.ts` を走らせ、原寸 300KB 以下・縮小版 幅400px / 80KB 以下・吹き出しがアプリの文字を覆わない（`avoid`）ことを確かめる。
- [ ] 6. `node apps/desktop/scripts/build-manual.mjs` → worktree で `electron apps/desktop/scripts/print-manual.mjs` を走らせ、**PDF を目で見る**（表紙・柱・もくじのリンク・しおり・図の番号・注意箱）。
- [ ] 7. `manual-content.ts` を作り直して commit する。

**期待:**

```bash
pnpm --filter @ojt/desktop test -- manual-
# 期待: manual-build / manual-sync / manual-style / manual-coverage / manual-shots /
#       manual-images / manual-appdata / manual-pdf / manual-problem-index がすべて pass
```
PDF を開いてもくじの任意の行を押すとその節へ飛ぶこと。図がすべて v1.1.0 の実画面であること。

---

## Task 37: 全体検証（受入基準①〜⑧の通し）

**モデル: Opus**
**指摘: —**

**Files:** 変更なし（記録のみ。必要なら軽微な直しを別 commit）

**Steps:**

- [ ] 1. clean な worktree で通す。

```bash
pnpm install --frozen-lockfile
pnpm verify
# 期待: typecheck / lint / -r test がすべて無警告・全件 pass
pnpm --filter @ojt/content validate src/builtin
# 期待: 0 件の問題
pnpm --filter @ojt/desktop test:coverage
# 期待: 実測値が出る（閾値なし）。値を記録する
pnpm --filter @ojt/desktop e2e
# 期待: 2回連続で同じ結果。git status --short が空
pnpm --filter @ojt/desktop dist
# 期待: check-dist.mjs が成功し release/artifacts.md が出る
```

- [ ] 2. **受入基準①〜⑧を人が実行して確かめる**（本設計 §11 の表）。それぞれの確認結果を `docs/releases/v1.1.0.md` の下書きに書く。
- [ ] 3. **2026-09-20 の所有者決定が実装に反映されていることを確かめる**: (a) 本体仕様 §8.2・§12 が「12px 相当以上」で、名札が実際に 12px（Task 24・26）、(b) `sandbox: true` が配布物で有効（Task 8）、(c) ビューキューブが上下・左右とも「盤が指に付いてくる」向き（Task 19）、(d) 成果物名が ASCII（Task 31）、(e) PR-12・PR-13・PR-14 が動く（Task 39・40・41）。
- [ ] 4. 残った既知の課題（**PR-15 のみ**。ほかに CS-02・CS-03・CS-07 の代替対応）を `docs/releases/v1.1.0.md` の「積み残し」に書く。
- [ ] 5. 機械点検（`ui-quality.spec.ts`）の残件を数え、v1.0.0 の 25件（小さすぎる文字24・折り返し1・blocking 0）と比べて記録する。

**期待:** すべて緑。受入基準①〜⑧が動作で示されている。

---

## Task 38: v1.1.0 のリリース

**モデル: Opus**
**指摘: 利用者要望12**

**前提:** Task 1〜37 がすべて landed し、Task 37 の検証がすべて緑であること。**利用者の要望12（「終わったら新しいバージョンをリリースして」）が、このタスクに限ってリリースを許可している。**

**Files:**
- Modify: `apps/desktop/package.json`（`version: 1.1.0`）
- Create: `docs/releases/v1.1.0.md`
- Modify: `README.md`（版と題数）

**Steps:**

- [ ] 1. `apps/desktop/package.json` の `version` を `1.1.0` にする。**版数の判断は本設計 §9**（v1.1.0 を推奨。所有者が v2.0.0 を選んだ場合はここと以下のファイル名だけを差し替える）。
- [ ] 2. `docs/releases/v1.1.0.md` を書く。載せるもの: 何が変わったか（利用者の言葉で12項目）／内蔵課題72題の内訳表／指摘171件の対応と3件の代替／性能の新しい予算（Task 16・17 の実測）／`apps/desktop` のカバレッジ実測／成果物の SHA256（`release/artifacts.md` から）／**未実施の確認**があればその一覧／積み残し（PR-12〜15）／リリース手順チェックリスト（**ライセンス画面の目視**と **PDF のもくじリンク**を含む）。
- [ ] 3. worktree で `pnpm --filter @ojt/desktop dist` を走らせ、NSIS とポータブルの両方を作る。`check-dist.mjs` が成功し `release/artifacts.md` が出ること。
- [ ] 4. **配布物を実際に入れて確かめる**: ①インストーラのライセンス画面が化けていない ②起動してモードBの課題を1つ完走できる ③「説明書（PDF）を開く」で PDF が開き**もくじを押すと飛ぶ** ④初回ガイドが出る。
- [ ] 5. commit → push → `git tag v1.1.0` → `gh release create`（`gh` は `"C:/Program Files/GitHub CLI/gh.exe"`）。成果物は ASCII 名（Task 31）なので手作業のリネームは要らない。
- [ ] 6. `docs/releases/v1.1.0.md` に公開した URL と実際に添付されたファイル名を追記して commit する。

**期待:** `gh release view v1.1.0` が公開済みを示し、NSIS とポータブルの2つが添付されていること。

---

## MERGE 注意

| # | 事象 | 対処 |
|---|---|---|
| 1 | `i18n/ja.ts` を複数タスクが触る | **末尾に新ブロックを足す**形に統一する。既存キーの削除は Task 12 だけ。衝突したら両方のブロックを残す |
| 2 | `store.ts` を Task 2・7 が触り、Task 11 が割る | **Task 11 はバッチCなので 2・7（バッチB）より後**。Task 11 の担当者は 2・7 の変更を取り込んでから割る |
| 3 | `BoardScene.tsx` を Task 6・16・17・27 が触る | 6（バッチB）→ 16 → 17（バッチD）→ 27（バッチF）の順に必ず直列。並行させない |
| 4 | `renderer/ladder/**` を Task 2・3・15・20・21・22 が触る | 2 → 3（バッチB）→ 15（バッチD）→ 20 → 21 → 22（バッチE）の順 |
| 5 | `packages/content/src/builtin/index.ts` を Task 13・18 が触る | 13 → 18 の直列。18 の担当者は 13 の追加行を消さない |
| 6 | `manual-content.ts` は生成物 | 触ったタスクは**最後に必ず** `node apps/desktop/scripts/build-manual.mjs` を走らせてから commit する。手で直さない |
| 7 | `apps/desktop/resources/content/**` は複写 | 課題を足したら `node apps/desktop/scripts/copy-content.mjs` を走らせ、その差分も同じ commit に入れる |
| 8 | `docs/manual/coverage.json` を Task 33・35・36 が触る | バッチH内で直列。`feature-inventory.mjs` の出力が唯一の源 |
| 9 | 本体仕様を Task 14・24/26・33 が触る | §5.2 と §13 #3 = Task 14 ／ §8.2 = Task 24 と 26（どちらか一方が直し、他方は確認のみ）／ §14.2・§15・§17・改訂履歴 = Task 33 |
| 10 | `electron-builder.yml` を Task 8・31 が触る | 8（バッチC）→ 31（バッチG）の順 |
| 11 | E2E は追跡対象の図を書き換える | `pnpm e2e` は **worktree でのみ**走らせる。Task 30 で `manual-shots` を既定から外したあとも、`dist` の前には必ず `git status --short` が空であることを確かめる |
| 12 | Task 1 の対象ファイルに未コミットの変更がある | **破棄しない**。`git diff` で読んでから足りない分だけ足す（前提D） |
| 13 | `test/ipc-surface.test.ts` を Task 8 が作り Task 41 が 8本→9本に伸ばす | 8（バッチC）→ 41（バッチG）の順。41 の担当者は Task 8 の検査の形（`IPC_CHANNELS` と完全一致）を変えず、期待の本数だけ伸ばす |
| 14 | `worker/protocol.ts` を Task 12（`reset` を削除）と Task 39（`replay` を追加）が触る | 12（バッチC）→ 39（バッチF）の順。**削除した `reset` を再生のために復活させない**（用途が違う。`replay` を新設する） |
| 15 | `result/ResultView.tsx` を Task 25・39・40・41 が触る | 25 → 39 → 40（バッチF の3系統目で直列）→ 41（バッチG）。いずれも**操作バーにボタンを1つ足すだけ**にし、外殻は Task 11 の `ResultShell.tsx` に任せる |

---

## 修正タスク番号 ↔ レビュー指摘ID ↔ 利用者要望

進捗は **`X/41`** の形で報告する。

| Task | バッチ | モデル | 見出し | レビュー指摘ID | 利用者要望 |
|---:|---|---|---|---|---|
| 1 | A | Sonnet | インストーラのライセンス表示 | QA-07 | 4 |
| 2 | B | Sonnet | ラダー編集の4つの罠 | LE-1, LE-2, LE-3, LE-5, LC-1 | 1, 3 |
| 3 | B | Sonnet | 方言の誤変換と嘘の案内 | LE-4, LE-6, LE-7, LE-8, LE-9, LE-12, LE-13, LE-14, PD-1, PD-2 | 1, 3 |
| 4 | C | Opus | 課題スキーマと検証CLI | PR-15 の代替 | 2 |
| 5 | B | Sonnet | 課題データが別物になる経路 | CS-01, CT-01, CT-02, CT-03, CT-04, CT-05, SC-01, SC-02, SC-03, SC-04 | 1 |
| 6 | B | Opus | 盤の経路と3Dの取り違え | BM-01, BM-02, BM-03, BM-04, 3D-07, 3D-21 | 1 |
| 7 | B | Sonnet | 押せない理由・嘘の案内・内部ID | UI-01, UI-04, UI-14, DS-1, UX-01, UX-03, UX-04, UX-06, UX-22, UX-24①②③ | 1, 9 |
| 8 | C | Opus | Electron ハードニング | DM-4, DM-5≡QA-05, DM-7, DM-9, QA-06, QA-18 | 1 |
| 9 | C | Sonnet | main の入口と書き込み | DM-1≡CT-06, DM-2, DM-3, DM-6, DM-8, DS-4, CT-11 | 1 |
| 10 | C | Sonnet | エンジンとランタイムの防御 | CS-05, CS-09, CS-12, CS-13, CS-14, CT-13, CT-14, DW-2, PD-3, SC-05 | 1 |
| 11 | C | Opus | 共通シェルとストア分割 | DS-3, UI-05, UI-06, UI-07, UI-13 | 1, 9 |
| 12 | C | Sonnet | 死にコード・二重管理の掃除 | CS-06, CS-07(代替), CS-10, BM-06, CT-08, CT-09, CT-12, DW-3, DS-5, 3D-13, 3D-14, 3D-18, 3D-20, LE-16, LE-17, UI-11≡LE-15, UI-15, QA-25 | 1 |
| 13 | D | Opus | 課題の拡充 B+12 / C1+8 | — | 2 |
| 14 | D | Sonnet | エンジンの無駄と仕様の訂正 | CS-02(代替), CS-03(代替), CS-04, CS-08, BM-05, BM-07, CT-07, CT-10, DM-10, SC-06, QA-20(§5.2) | 1 |
| 15 | D | Opus | 描画側の性能 | DS-2≡UI-02, DW-1≡LE-11, LE-10, UI-10, DS-6 | 1 |
| 16 | D | Opus | 性能の門 | 3D-01 | 1 |
| 17 | D | Opus | 3D の資源解放とドローコール | 3D-02, 3D-03, 3D-04, 3D-05, 3D-06, 3D-08, 3D-09, 3D-11, 3D-12, 3D-22 | 1 |
| 18 | D | Opus | 課題の拡充 C2+12 / D+12 | — | 2 |
| 19 | E | Opus | ビューキューブの回り込み | 3D-15, 3D-16, 3D-19 | 8 |
| 20 | E | Opus | 純正: キー割当 | LE-1(続), LE-8 | 3 |
| 21 | E | Opus | 純正: 回路入力 | UX-02, PR-01 | 3, 9 |
| 22 | E | Opus | 純正: ウィンドウ構成とモニタ | LE-18, PR-05 | 3 |
| 23 | F | Sonnet | 色とトークン | UI-08, UI-16, UI-20, UX-09, UX-14≡UI-17, UX-26, PR-07 | 9 |
| 24 | F | Opus | アクセシビリティと一貫性 | UI-03, UI-09, UI-12, UI-18, UI-19, UI-21, UX-07, UX-10, UX-15, UX-16, UX-20, UX-23, UX-25, UX-30, 3D-10, 3D-17, PR-08, PR-10 | 9 |
| 25 | F | Opus | 学習導線と結果の次の一手 | UX-05, UX-11, UX-12, UX-13, UX-18, UX-19, UX-28, UX-29, PR-02, PR-03, PR-09 | 2, 9 |
| 26 | F | Opus | 文字と UI の大きさ・高コントラスト | UX-17, PR-06 | 9 |
| 27 | F | Opus | 3D盤の直接操作 | UX-08, PR-11 | 9 |
| 28 | F | Opus | 初回ガイド | PR-04, UX-28 | 9 |
| 29 | G | Opus | CI と検査の死角 | QA-01, QA-10, QA-14, QA-23, QA-24 | 1 |
| 30 | G | Opus | E2E の足場としきい値 | QA-02, QA-03, QA-04, QA-11, QA-12, QA-13, QA-26, UX-27 | 1 |
| 31 | G | Opus | 配布ゲート | QA-08, QA-09, QA-15, QA-16, QA-17, QA-19 | 1 |
| 32 | G | Sonnet | ヘルプ引き出しの読みやすさ | UX-21 | 5 |
| 33 | G | Sonnet | リポジトリの文書 | QA-20, QA-21, QA-22, UX-24④ | 1 |
| 34 | H | Opus | PDFの体裁ともくじのリンク | — | 5, 6 |
| 35 | H | Sonnet | チュートリアル章の新設 | — | 7 |
| 36 | H | Opus | 図の撮り直しと本文の更新 | UX-24 | 10 |
| **39** | **F** | Opus | 判定の操作列を1歩ずつ再生（PR-12） | PR-12 | 9 |
| **40** | **F** | Opus | 模範との並置比較（PR-13） | PR-13 | 9 |
| **41** | **G** | Opus | 結果の1枚書き出し（PR-14） | PR-14 | 11 |
| 37 | I | Opus | 全体検証 | — | 11 |
| 38 | I | Opus | v1.1.0 のリリース | — | 12 |

**カバレッジ確認**: 上表に出る指摘IDの集合は、本設計 §3.3 の171件と**一致する**（§3.2 の3件 CS-02 / CS-03 / CS-07 は「代替」として Task 12・14 に載っている）。UI/UX 改善提案は **PR-01〜PR-14 の14件を採用**し、PR-15 だけを代替（課題検証 CLI。Task 4）で閉じている。利用者要望は 1〜12 すべてが少なくとも1つのタスクに現れる。**行の並びは実行順**（バッチ A→I）であり、Task 39・40・41 の番号が 37・38 より大きいのは後から足したためである（§「実装バッチ」の注記）。

---

## 完了条件

すべてコマンドで確かめられること。

1. **測定**

```bash
pnpm install --frozen-lockfile        # lockfile が package.json と同期している
pnpm verify                           # typecheck / lint / -r test が無警告・全件 pass
pnpm --filter @ojt/content validate src/builtin   # 0 件の問題
pnpm --filter @ojt/desktop test:coverage          # 実測値が出る
pnpm --filter @ojt/desktop e2e                    # 全件 pass、2回連続で同じ結果
git status --short                                # e2e の後でも空
pnpm --filter @ojt/desktop dist                   # check-dist.mjs が成功
```

2. **件数**

```bash
node -e "const {BUILTIN_ALL_PROBLEMS}=require('@ojt/content');console.log(BUILTIN_ALL_PROBLEMS.length)"
# 期待: 72
ls packages/content/src/builtin/assemble/*.json | wc -l        # 期待: 20
ls packages/content/src/builtin/inspect-parts/*.json | wc -l   # 期待: 12
ls packages/content/src/builtin/inspect-repair/*.json | wc -l  # 期待: 20
ls packages/content/src/builtin/plc/*.json | wc -l             # 期待: 20
```

3. **受入基準**（本設計 §11 の①〜⑧）が人の操作で示され、`docs/releases/v1.1.0.md` に記録されていること。あわせて 2026-09-20 の所有者決定5件が反映されていること。

```bash
grep -c "12px相当以上" docs/superpowers/specs/2026-09-13-ojt-electrical-trainer-design.md   # 期待: 2（§8.2 と §12）
node -e "const {IPC_CHANNELS}=require('./apps/desktop/out/main/index.js');" 2>/dev/null || true
pnpm --filter @ojt/desktop test -- ipc-surface   # 期待: 登録チャネル 9 本で完全一致（PR-14）
pnpm --filter @ojt/desktop test -- replay compare report-html result-export
# 期待: Task 39・40・41 のテストが全件 pass
```

4. **文書**

```bash
test -f CONTRIBUTING.md && test -f LICENSE && ls packages/*/README.md | wc -l   # 期待: 6
test -f docs/superpowers/PROJECT-LOG.md
grep -c "72題" README.md docs/releases/v1.1.0.md                                 # 期待: 各1以上
```

5. **リリース**

```bash
gh release view v1.1.0
# 期待: 公開済み。NSIS（.exe）とポータブル（.zip）の2つが ASCII 名で添付されている
```

6. `docs/reviews/**` が**1文字も変わっていない**こと（`git log --oneline -- docs/reviews` が評価レポートを足した commit だけを示す）。

---

## Task 29 実施メモ（QA-10 の実測値・Task 38 が `docs/releases/v1.1.0.md` へ転記すること）

`pnpm --filter @ojt/desktop test:coverage`（v8 provider、`apps/desktop/vitest.config.ts` の `coverage.include: ['src/**/*.ts','src/**/*.tsx']`）の初回実測値（2026-09-20、`reportOnFailure: true` を足した状態で測定）:

| 指標 | 値 |
|---|---:|
| Lines | 84.24%（5,610 / 6,659） |
| Statements | 82.59%（6,459 / 7,820） |
| Functions | 82.5%（1,707 / 2,069） |
| Branches | 80.36%（3,930 / 4,890） |

測定メモ: v8 計装のオーバーヘッドで一部テスト（デフォルトの `testTimeout` に対して元々ぎりぎりの時間で通っていたもの）がまれにタイムアウトする（計装なしでは既知の禁止語1件（Task 12）以外すべて pass）。`coverage.reportOnFailure: true`（`apps/desktop/vitest.config.ts`）で、そのタイムアウトがあってもレポート自体は出るようにしてある。

以降はこの実測値から **−3pt** をラチェット基準にする（本設計 §14.2）。

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-20 | 初版。評価レポートの指摘171件、課題の拡充（28→72題）、純正ツールの忠実化、3Dの直接操作とUI/UX刷新、ビューキューブの不具合、説明書とヘルプの体裁刷新、チュートリアル章、CIと配布ゲート、v1.1.0 のリリースを38タスク・9バッチに割った |
| 2026-09-20 | 所有者の決定5件を反映（本設計 決定表 D17）。①課題は72題のまま（変更なし） ②ビューキューブは上下・左右とも反転（Task 19 Step 3・4） ③`sandbox: true` を有効化し配布物で確認（Task 8 Step 1） ④名札12px は本体仕様が改訂済みなので実装を合わせるだけ（Task 24 Step 2・Task 26） ⑤**PR-12・PR-13・PR-14 を Task 39・40・41 として追加**（バッチ F・G）。**N は 38 → 41**。Task 37・38 は引き続き最後の2つで、39〜41 はその前に landed させる。MERGE 注意 #13〜#15 を追加 |
