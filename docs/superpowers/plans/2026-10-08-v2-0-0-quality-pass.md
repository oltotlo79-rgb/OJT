# v2.0.0 総点検 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（このリポジトリの AGENTS.md はサブエージェントを禁じているので、同じセッションで順に実行する）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 説明書と実画面の食い違い・不具合を直し、手順帯と分割表示を分かりやすくし、3Dの描画・部品・配線の見た目を上げ、PLCの仕様（タイマの時間単位・デバイス範囲・CP1Eの表示灯と端子配列）を実機に寄せ、動画9本と説明書を作り直して v2.0.0 として公開する。

**Architecture:** 既存の層分け（`@ojt/board-model` の盤・経路、`@ojt/ladder-core` のIR、`@ojt/plc-dialects` の方言、`apps/desktop` の3D・画面）を保ち、各タスクはその層の中で閉じる。タイマの時間単位はIRに `base` を1つ足すだけで、ランタイム（ms）は変えない。3Dは寸法・位置・当たり判定を変えず材質と造作だけを足す。

**Tech Stack:** TypeScript / zod 4 / Vitest / React 19 / zustand / three r17x + @react-three/fiber 9 + drei / Electron 44 / Playwright（SwiftShader）。

設計: `docs/superpowers/specs/2026-10-08-v2-0-0-quality-pass-design.md`

Git運用（利用者決定）: **各タスクが緑になった時点で日本語のコミットメッセージでコミットし、`git push origin HEAD:main` する。** 公開は Task 17 だけ（v2.0.0）。

報告は「タスク X / 17」で行う。

---

## ファイル構成

| 区分 | ファイル | 役割 |
|---|---|---|
| 新規 | `apps/desktop/e2e/manual-walkthrough.spec.ts` | 説明書の記述を実画面で確かめる通し点検（記録を書き出す） |
| 新規 | `packages/content/src/required-parts.ts` | 課題が要求する部品の役割（`requiredPartRoles`） |
| 変更 | `apps/desktop/src/renderer/session/step-guide.ts` / `screens/Session.tsx` / `i18n/ja.ts` | 部品装着の「済」と案内 |
| 変更 | `apps/desktop/src/renderer/screens/screens.module.css` | 分割表示の3D盤の大きさ |
| 変更 | `apps/desktop/src/renderer/three/Socket.tsx` | 選択の輪郭表示 |
| 変更 | `apps/desktop/src/renderer/three/BoardScene.tsx` / `materials.ts` | 環境マップ・トーンマッピング・材質表 |
| 変更 | `apps/desktop/src/renderer/three/{TerminalField,WireConnections,Wire,WireMarker,TerminalBlock,Fixtures,AcFixtures,Lamp,PushButton,MountedPart,ComponentDetails,PartIndicator,Socket,PlcUnit,PlcRack,SupplyUnit,DinRail,BoardPlate}.tsx` | 造作の作り込み |
| 変更 | `packages/board-model/src/{desk-routing,wire-clearance,plc-unit}.ts` | 幹線の経路、不変条件、PLC外観・端子配列 |
| 変更 | `packages/ladder-core/src/{ir,edit,compile}.ts` | タイマの `base` |
| 変更 | `packages/plc-dialects/src/{profile,mitsubishi,omron,jtekt,sharp,instruction-list,convert,device-rules,shortcuts}.ts` | 時間単位の命令・範囲・注記 |
| 変更 | `apps/desktop/src/renderer/ladder/{DeviceInput,LadderGrid,NotationDialog}.tsx` ほか | 時間単位の入力・表示・切替 |
| 変更 | `packages/content/src/schema/plc.ts` / `schema/task.schema.json` / `plc-reference.ts` | `base` の受け入れ、COM群の配線計画 |
| 変更 | `docs/manual/*.md` / `shots.json` / `coverage.json` / `apps/desktop/e2e/manual-shots.spec.ts` | 説明書・図 |
| 変更 | `apps/desktop/scripts/record-tutorials.mjs` / `docs/tutorial-recording.md` / `src/renderer/public/tutorials/*` | 動画 |
| 変更 | `apps/desktop/package.json` / `docs/releases/v2.0.0.md` / `README.md` | 版・リリースノート |

---

### Task 1: 説明書の通し点検（記録づくり）

**Files:**
- Create: `apps/desktop/e2e/manual-walkthrough.spec.ts`（`manual-shots` プロジェクトと同じ起動。記述ごとの観測を JSON に書き出す）
- Create: `OJT/release/verification/v2.0.0/manual-walkthrough.md`（章・節・記述・実画面・判定・対処の表）

- [ ] **Step 1:** 15章の「操作の記述」（ボタン名・キー・窓の文言・手順の順序・表示される数値や印）を節ごとに抜き出し、確かめ方（どの画面で何を押し、何が出るか）を `WALKTHROUGH` 配列に書く。図のある節は `manual-shots.spec.ts` の手順を再利用する。
- [ ] **Step 2:** spec を書き、`pnpm --filter @ojt/desktop build` → `playwright test --project=manual-shots manual-walkthrough` で実行。観測値を `release/verification/v2.0.0/manual-walkthrough.json` に書く。
- [ ] **Step 3:** JSON を読み、記述と違う箇所を `manual-walkthrough.md` の表にまとめる（画面を直すか説明書を直すかを1件ずつ決める）。F1・F2 は既知として載せる。
- [ ] **Step 4:** 見つかった食い違いのうち画面側の修正は Task 2〜4・13 に振り分け、説明書側の修正は Task 13 で行う。
- [ ] **Step 5:** コミット「説明書と実画面の通し点検の記録を追加する」→ push。

### Task 2: 手順帯の「部品装着」を必要な部品基準にする（F1）

**Files:**
- Create: `packages/content/src/required-parts.ts`、Test: `packages/content/test/required-parts.test.ts`
- Modify: `packages/content/src/index.ts`、`apps/desktop/src/renderer/session/step-guide.ts`、`apps/desktop/src/renderer/screens/Session.tsx`、`apps/desktop/src/renderer/i18n/ja.ts`、`docs/manual/02-screens.md` / `03-mode-b.md`
- Test: `apps/desktop/test/step-guide.test.ts`（既存に追記）、`apps/desktop/e2e/smoke.spec.ts` か `direct-manipulation.spec.ts` に1ケース

- [ ] **Step 1: 失敗するテスト** — `requiredPartRoles(problem)` が b-001 で `['CR1']`、b-004（T1→T2）で `['CR1','T1','T2']` 相当、c1-001 で `[]`、d-001 で `['CR1','CR2','CR3']` を返す。`assembleSteps({ requiredRoles, mountedRoles, … })` が「必要な役割が全部載ったら済」。
- [ ] **Step 2:** `requiredPartRoles()` を実装（回路図の `cr-a`/`cr-b`/`coil`/`timer-*` セルの `device`、PLCの I/O 割付の `cr`、を集合にする）。`assembleSteps` の入力を替える。`Session.tsx` で `mountedRoles` を `session.mounted` から作る。案内文 `JA.stepGuide.assemblePartsHint` を関数にして「CR1 をソケット S1 に載せます」を出す（複数なら「CR1・T1 を載せます（S1・S5）」）。
- [ ] **Step 3:** `pnpm --filter @ojt/content test`、`pnpm --filter @ojt/desktop test -- step-guide`。
- [ ] **Step 4:** E2E: b-001 で CR1 を載せた直後に `step-parts` が `done`。
- [ ] **Step 5:** 説明書 02章「「済」はその操作を行った目印」→「部品装着は課題で使う部品が全部載ったら「済」」、03章の案内文。`pnpm --filter @ojt/desktop test -- manual`。
- [ ] **Step 6:** コミット「手順帯の部品装着を課題で使う部品が載ったら済にする」→ push。

### Task 3: PLCの分割表示で3D盤を見える大きさにする（F2）

**Files:**
- Modify: `apps/desktop/src/renderer/screens/screens.module.css`（`.plcLayout[data-view='split']` 一式）
- Test: `apps/desktop/e2e/ui-quality.spec.ts`（分割表示で `viewport` の実寸 ≥ 560×280、札の重なり0）、`apps/desktop/test/plc-layout.test.ts`（CSS 変数の下限）

- [ ] **Step 1:** `--plc-board-w: max(560px, …)`、分割の行を `minmax(280px, calc(var(--plc-board-w) / var(--plc-aspect)))` と `minmax(0, 1fr)`、`.plcRight` は `overflow: auto` のまま。1279px 以下の縦積みは変えない。
- [ ] **Step 2:** `ui-quality` の分割ケース（4メーカー×1280/1440/1920）で寸法を測り、`label-declutter` の重なり集計 0 を確かめる。
- [ ] **Step 3:** 説明書 06章「分割」の説明に「3D盤は最低限の大きさを保ち、課題・部品の欄がその下でスクロールする」を足す（Task 13 と合わせる）。
- [ ] **Step 4:** コミット「PLCの分割表示で3D盤を見える大きさに保つ」→ push。

### Task 4: ソケットの選択表示を輪郭にする（F3）

**Files:**
- Modify: `apps/desktop/src/renderer/three/Socket.tsx`（`socketBodyMaterial` の emissive を落とし、`EdgesGeometry` の輪郭を足す）、`apps/desktop/test/socket-glow.test.tsx`（既存の `socketGlowOf` テストに輪郭の色・太さを追加）

- [ ] **Step 1:** 選択＝水色・線幅2（`Line2` は使わず `lineSegments` を2本ずらして太く見せる）、ホバー＝白、落とせる＝emissive 0.35 のみ。
- [ ] **Step 2:** `pnpm --filter @ojt/desktop test -- socket` → 実画面で `b-zoom-socket-s1` 相当を撮って確認（`audit-shots.ts` を再利用）。
- [ ] **Step 3:** コミット「選んだソケットを輪郭で示し、透明なリレー越しに台座が染まらないようにする」→ push。

### Task 5: 3D描画の土台（環境光・トーンマッピング・材質表）

**Files:**
- Modify: `apps/desktop/src/renderer/three/BoardScene.tsx`（`<Environment>` 相当を `RoomEnvironment` + `PMREMGenerator` で自前生成、`gl.toneMapping = ACESFilmicToneMapping`、`shadow-mapSize` 2048）、`materials.ts`（`MATERIALS` 名前付き材質: paint / steel / nickel / blackResin / pvc / brass / clearCover）
- Test: `apps/desktop/test/materials.test.ts`（材質表の値と共有性）、`apps/desktop/e2e/perf.spec.ts` の描画予算が変わらないこと

- [ ] **Step 1:** 材質表を書き、既存の `sharedMaterial(color, …)` の呼び出しのうち盤面・レール・ネジ・ソケット・電線・圧着端子を表へ置き換える。
- [ ] **Step 2:** 環境マップを `onCreated` で1回作って `scene.environment` に入れる（WebGLロスト再構築時も作り直す）。SwiftShader で E2E が落ちないことを確かめる（`smoke.spec.ts`）。
- [ ] **Step 3:** 撮影して前後比較（`release/verification/v2.0.0/3d-before-after/`）。
- [ ] **Step 4:** コミット「3Dに環境光とトーンマッピングを入れ、材質を実物に寄せる」→ push。

### Task 6: 端子・圧着端子・電線の作り込み

**Files:**
- Modify: `apps/desktop/src/renderer/three/TerminalField.tsx`（座金・角座の instancedMesh）、`WireConnections.tsx`（赤い絶縁スリーブ）、`Wire.tsx`（PVC材質）、`WireMarker.tsx`（チューブを電線より一回り太く・白地に黒字）
- Test: `apps/desktop/test/wire-connections.test.tsx`（スリーブの位置がバレルと同じ軸）、`test/three-fidelity.test.tsx`

- [ ] **Step 1〜3:** 形状を足し、ドローコールが instancedMesh に畳まれていることを `PerfProbe` の値で確かめる。拡大撮影で確認。
- [ ] **Step 4:** コミット「ネジ座金・絶縁スリーブ・マークチューブを描き、電線の接続を見やすくする」→ push。

### Task 7: 端子台・ランプ・押ボタン・ブレーカ・電源スイッチ・DC24V電源の作り込み

**Files:**
- Modify: `TerminalBlock.tsx`、`Lamp.tsx`、`PushButton.tsx`、`AcFixtures.tsx`、`SupplyUnit.tsx`、`Fixtures.tsx`、`DinRail.tsx`、`BoardPlate.tsx`
- Test: `apps/desktop/test/three-fidelity.test.tsx`（寸法・当たり判定が変わらない）、E2E `direct-manipulation.spec.ts`（押ボタン・ブレーカ・スイッチのクリック）

- [ ] **Step 1〜4:** 化粧リング・ドーム・ガード・ハンドル窓・定格ラベル・端子カバーを足す。クリック面は既存のメッシュのまま。
- [ ] **Step 5:** コミット「端子台・ランプ・押ボタン・ブレーカ・スイッチ・電源の見た目を作り込む」→ push。

### Task 8: リレー・タイマ・ソケットの作り込み

**Files:**
- Modify: `MountedPart.tsx`、`ComponentDetails.tsx`、`PartIndicator.tsx`、`Socket.tsx`
- Test: `apps/desktop/test/mounted-part.test.tsx`、`test/part-indicator.test.tsx`

- [ ] **Step 1〜3:** MY4N の透明ケースに橙のLED窓・機械式インジケータ・型式印字、H3Y-4 の黒筐体、PYF14A のネジ座の立体感。
- [ ] **Step 4:** コミット「リレー・タイマ・ソケットの見た目を実物に寄せる」→ push。

### Task 9: 机上幹線とブレーカの見た目の重なり（F4）と配線の不変条件の拡充

**Files:**
- Modify: `packages/board-model/src/desk-routing.ts`（`desk-exit-ch-top` の位置とブレーカ・スイッチの障害物）、`wire-clearance.ts`（立体の障害物・両端の位置・管どうしの距離）
- Test: `packages/board-model/test/desk-routing.test.ts`、`test/wire-clearance.test.ts`（全PLC課題×4メーカー＋実験の配線済み盤）、`apps/desktop/test/desk-projection.test.ts`（3視点の射影でブレーカ・スイッチの前面矩形と交わらない）

- [ ] **Step 1: 失敗するテスト**（射影の交差）。
- [ ] **Step 2:** 経路を直し、検査を通す。全内蔵課題で経路エラー0。
- [ ] **Step 3:** コミット「机上へ出る電線がブレーカ・電源スイッチの前を横切らないようにし、配線の検査を増やす」→ push。

### Task 10: タイマの時間単位を命令で選ぶ（IR・方言・入力・書き出し・互換）

**Files:**
- Modify: `packages/ladder-core/src/{ir,edit}.ts`、`packages/plc-dialects/src/{profile,mitsubishi,omron,jtekt,sharp,instruction-list,convert,device-rules}.ts`、`packages/content/src/schema/plc.ts`・`schema/task.schema.json`（`schema:write`）、`apps/desktop/src/shared/work-file-codec.ts`（互換補正）、`apps/desktop/src/renderer/ladder/{DeviceInput,LadderGrid,NotationDialog}.tsx`、`i18n/ja.ts`、`ProblemAuthoring`（模範ラダー編集）
- Test: `packages/ladder-core/test/ir.test.ts`、`packages/plc-dialects/test/timer-base.test.ts`（4社の命令名・設定値・往復）、`apps/desktop/test/{device-input,work-file-timer-base,notation-dialog}.test.tsx`、`e2e/plc.spec.ts`（単位を選んで変換・RUN）

- [ ] **Step 1: 失敗するテスト** — `ton(d, 500, 10)` → 三菱 `OUTH T0 K50`、オムロン `TIMH T0 #0050`、ジェイテクト `TMRH 1T000 H0032`、シャープは 10ms を受けない。
- [ ] **Step 2:** IR に `base?: 100|10|1`。方言に `timerInstructionName(base)` と `supportedTimerBases`。三菱の番号帯を廃止し、旧データの補正を codec に入れる。
- [ ] **Step 3:** 入力窓に「時間単位」の選択、格子のセルに命令名（`OUTH`）を表示、命令語リストに反映、表記切替の非対応項目。
- [ ] **Step 4:** `pnpm verify` の該当パッケージ、E2E plc。
- [ ] **Step 5:** コミット「タイマの時間単位を機種の命令（OUT/OUTH/OUTHS など）で選べるようにする」→ push。

### Task 11: 三菱のデバイス範囲・キー注記、オムロン/ジェイテクトの資料反映

**Files:**
- Modify: `packages/plc-dialects/src/mitsubishi.ts`（範囲）、`shortcuts.ts`（Shift+F7/F8 の注記）、`docs/reference/ladder-skin-sources.md`（S9）、`docs/manual/06-mode-d.md`、`apps/desktop/src/renderer/screens/Settings.tsx` の根拠表示

- [ ] **Step 1〜3:** 範囲を仕様表に合わせ、テスト（`device-range`）を更新。説明書のキー表の備考を直す。
- [ ] **Step 4:** コミット「三菱のデバイス範囲とキー割当の注記を仕様表・資料に合わせる」→ push。

### Task 12: PLC本体の外観（FX5Uの色、CP1Eの表示灯・端子配列・COM群）

**Files:**
- Modify: `packages/board-model/src/plc-unit.ts`（`FX5U_APPEARANCE` の色、`CP1E_APPEARANCE` のLED6灯・IN/OUT印字、`cp1eTerminals()` の配列、`CP1E_COMMON_SIZES = [1,1,3,3,4]`）、`apps/desktop/src/renderer/three/{PlcUnit,labels}.ts(x)`（前面パネル・印字）
- Test: `packages/board-model/test/plc-unit.test.ts`（配列・COM群）、`packages/content/test/builtin-plc.test.ts`（全PLC課題の模範配線の自己判定）、`apps/desktop/test/plc-appearance-view.test.ts`、`e2e/plc-vendors.spec.ts`

- [ ] **Step 1: 失敗するテスト**（CP1E の端子の並びとCOMの受け持ち）。
- [ ] **Step 2:** 実装し、`plcWiringPlan` の結果が変わる課題の自己判定・経路検査・実験の配線済み盤（固定本数）を更新。
- [ ] **Step 3:** 説明書 06章の端子名の表（オムロン: COM0〜）と15章の固定本数を直す。
- [ ] **Step 4:** コミット「FX5Uの筐体色とCP1Eの表示灯・端子配列・出力COMを実機の資料に合わせる」→ push。

### Task 13: 説明書・ヘルプの本文改訂と新しい図の定義

**Files:**
- Modify: `docs/manual/{02-screens,03-mode-b,06-mode-d,13-tutorial-modes,14-tutorial-features,15-lab}.md`、`docs/manual/shots.json`（新しい図: `step-parts-done`、`plc-split-view`、`plc-unit-mitsubishi` / `-omron` / `-jtekt` / `-sharp`、`plc-timer-unit`、`wire-lug-sleeve`、`power-fixtures-closeup`）、`docs/manual/coverage.json`、`apps/desktop/e2e/manual-shots.spec.ts`（撮影手順の追加）
- Test: `manual-sync` / `manual-coverage` / `feature-inventory` / `manual-shots.test.ts`

- [ ] **Step 1〜3:** 本文を直し、図の定義と撮影手順を足す。Task 1 の食い違い（説明書側）もここで直す。
- [ ] **Step 4:** コミット「説明書・ヘルプを新しい画面と仕様に合わせ、図を足す」→ push。

### Task 14: 動画の台本（失敗→観察→考え方→修正）

**Files:**
- Modify: `apps/desktop/scripts/record-tutorials.mjs`（9シナリオの台本）、`docs/tutorial-recording.md`、`apps/desktop/e2e/tutorial-checks.ts`（失敗場面の強調が収録ログにあることを検査）

- [ ] **Step 1:** 設計 §3.7 の表どおりに各シナリオへ失敗の場面と吹き出しを足す。`OJT_TUTORIAL_DRY=1` で全9本を通す。
- [ ] **Step 2:** コミット「動画の台本に失敗と修正の場面を足す」→ push。

### Task 15: 動画9本の収録と仕上げ

- [ ] **Step 1:** `pnpm --filter @ojt/desktop build` の後、9本を順に収録（`record-tutorials.mjs`）。
- [ ] **Step 2:** `OJT_FFMPEG=… node scripts/finalize-tutorials.mjs` で字幕・目録・代表フレーム。各本10分未満。
- [ ] **Step 3:** `review-tools.spec.ts`（動画の再生検査）。
- [ ] **Step 4:** コミット「動画9本を撮り直す（失敗と修正の場面つき）」→ push。

### Task 16: 説明書の全図の撮り直し・PDF・ヘルプ再生成

- [ ] **Step 1:** 最新をビルドし `pnpm --filter @ojt/desktop e2e:shots` で全図（80＋追加）を撮る。`manual-walkthrough` を再実行して記録を更新。
- [ ] **Step 2:** PDF を生成し全ページを描画確認（`pdftoppm`）。
- [ ] **Step 3:** コミット「説明書の図を新しい画面で撮り直す」→ push。

### Task 17: v2.0.0 の検証・配布・公開

- [ ] **Step 1:** `apps/desktop/package.json` を `2.0.0`、`docs/releases/v2.0.0.md`、`README.md`。
- [ ] **Step 2:** `pnpm install --frozen-lockfile` → `pnpm verify` → `validate src/builtin` → E2E 2回 → `dist` → `check-dist` → `e2e:packaged` → 同梱物の照合 → PDF → 配布EXEで4モード＋実験の通し。
- [ ] **Step 3:** コミット・push → main CI 成功 → 注釈付きタグ `v2.0.0` → タグ CI → `pnpm release:publish` → 匿名ダウンロード照合 → `OJT/release/v2.0.0` に Portable EXE 1個。
- [ ] **Step 4:** 記録 `OJT/release/verification/v2.0.0/README.md`。最終報告。
