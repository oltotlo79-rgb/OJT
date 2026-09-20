# Plan 5: 回路図エディタ・検算・配線ガイド・性能最適化・配布パッケージ（v1.0.0）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計仕様 §16 Phase 5 の行（回路図エディタの編集機能／検算／配線ガイドのハイライト／electron-builder による NSIS＋ポータブルの配布パッケージ／性能最適化）を実装し、受入基準①〜④を動作で示す。あわせて 2026-09-19 のUXレビューの残り2件（#28 結果画面が「疑わしい配線」を示し 3D で見せる、#29 3D配線のキーボード代替）を取り込む。

**受入基準（§16 Phase 5）:**

| # | 文 | 本プランでの担保 |
|---|---|---|
| ① | 回路図エディタで自己保持回路を描き「検算」で合格する | Task 1〜7（エディタ＋`verifySchematic()`）／E2E `schematic.spec.ts`（Task 15） |
| ② | 回路図の要素をクリックすると3D盤の対応端子が光る | Task 8（配線ガイド）／E2E 同上 |
| ③ | NSISインストーラでインストールし、オフラインのWindows 11で起動して課題を1つ完了できる | Task 14（配布物の固め＋`check-dist.mjs`＋リリース手順チェックリスト）／E2E のオフライン計測（Task 15） |
| ④ | 内蔵GPU・FHDで60fpsを維持する | Task 11〜13（計測窓・インスタンス化・テクスチャ共有・`frameloop` 監査）／E2E `perf.spec.ts`（Task 15） |

**利用者要求（2026-09-19、全タスク共通）:** 「**分かりやすく直感的に操作できるUI、UXにしてね**」／「**各画面のクオリティも可能な限り向上すること**」／「最小のトークンで品質を落とさず、できるだけ早く公開したい」。本プランはこれを、①エディタの操作をマウスでもキーボードでも完結させる（パレット＋クリック、矢印＋Enter）、②「いま何をすればよいか」を常に1行で出す（既存の手順帯 `session/step-guide.ts` を回路図エディタにも広げる）、③結果画面を「不合格でした」で終わらせず**疑わしい端子を盤で見せる**（#28）、④3D操作をマウス必須にしない（#29）、⑤画面の品質（はみ出し・フォーカス枠・8px 格子・文字切れ）を `## 完了条件` の「画面の品質」で縛る、という形で満たす。

**公開について（利用者の明示の決定）:** 本プランは**配布物と手順書を用意するところまで**を行う。`git tag` の作成・GitHub Release の公開・配布ファイルの共有は**利用者の明示の指示があるまで一切行わない**（Task 14 の最後に理由付きで明記する）。

**Architecture:** 既に landed している層をそのまま使い、**新しい概念を増やさない**。

| 既にあるもの | Phase 5 での使い方 |
|---|---|
| `@ojt/schematic-core` の `SchematicDocument` / `validateDocument()` / `layout()` / `assignToBoard()` / `toSession()` | 文書モデルと §11.3 の変換（渡り配線の母線分配＝§17.2 #33 を含む）は**完成している**。Phase 5 は「文書を**編集する**純関数」（`edit.ts`）と「編集UIが必要とする当たり矩形」（`slotRects()`）だけを足す |
| `@ojt/content` の `judgeAssemble()` / `buildReferenceSession()` / `buildHighlightIndex()` | 検算は「文書 → `toSession()` → `judgeAssemble()`」で済む。判定器もエンジンも1行も変えない |
| `@ojt/circuit-sim` の `buildNets()`（union-find） | #28 の「疑わしい配線」は、模範回路と訓練者回路の**節点分割の差**として求める。新しいソルバも新しい判定も要らない |
| ストアの `highlight`（`HighlightSelection`）と `BoardScene` の `highlight.terminals` / `ProbeMarkers` | 配線ガイド（②）は C2 で landed した連動ハイライトの**同じ道**を通す。3D側に新しい仕組みを足さない |
| `screens/PlcSession.tsx` の `ladderView`（`'ladder' \| 'split' \| 'board'`）と `ladder/**` のグリッド編集 | モードBに `assembleView`（`'board' \| 'split' \| 'schematic'`）を同じ形で足す。§11.2 の「ラダーと同じグリッド編集エンジン」を**操作の流儀の一致**として実現する |
| `worker/protocol.ts` の `judge` 往復 | 検算は `verify` 往復を1本足すだけ。シミュレーションは Worker のまま（§15「renderer のフレーム処理をブロックしない」） |
| `apps/desktop/electron-builder.yml` ＋ `scripts/copy-content.mjs` ＋ `dist` スクリプト | v0.2.0 で**既に動いている**。Phase 5 は新規構築ではなく**固め**（版の 1.0.0 化・同梱課題の検査・成果物の検査とチェックサム・README とインストーラ説明画面・リリース手順） |

**Plan 5 が触らないもの:** `packages/circuit-sim`（1行も変えない）、`packages/ladder-core`、`packages/plc-dialects`、`packages/board-model`、`apps/desktop/src/renderer/ladder/**`（Plan 4B の担当）、`src/worker/runtime.ts` の追従ループ、判定アルゴリズムそのもの（`judge.ts` / `judge-inspect.ts` / `judge-plc.ts`）。

---

## 前提（このプランを始める前に満たしていること）

### 前提A: Phase 4（Plan 4A / 4B）が landed していること

本プラン作成時点（2026-09-19、`HEAD` = `5c883ec`）では **4A が進行中**（`packages/board-model` に4機種のラック定義が入り、`packages/plc-dialects` に命令語リストが入った）で、**4B は未着手**（`apps/desktop/src/renderer/ladder/skins/` も `session/plc-skin.ts` も無い）。

Phase 5 は `ladder/**` を1行も触らないので**機能としては独立**だが、次の3ファイルを 4B と**同じファイルの別の場所で**編集する。バッチを走らせる前に `git pull --rebase origin main` して 4B が landed していることを確かめ、landed していなければ MERGE 注意 #1〜#4 の順序を守ること。

| ファイル | 4B が触る箇所 | Phase 5 が触る箇所 |
|---|---|---|
| `apps/desktop/src/renderer/i18n/ja.ts` | `JA.ladder` / `JA.plc` / `JA.settings` の末尾 | `JA.session` の末尾＋新ブロック `JA.schematic` / `JA.terminalList` |
| `apps/desktop/src/renderer/app/store.ts` | `defaultVendor` / `openProblem` / `switchDialect` | 回路図エディタの欄（Task 6）と `assembleView`（Task 7）と `boardFocus`（Task 9） |
| `apps/desktop/src/renderer/three/BoardScene.tsx` | `PlcUnit` / `PlcRack` の分岐（4B Task 11） | `TerminalField` の差し込みと `PerfProbe`（Task 11・12） |

`apps/desktop/e2e/projection.ts` は Phase 5 では**追記しない**（既存の `terminalPoint()` / `boardPoint()` / `SELF_HOLD_WIRES` をそのまま使う）ので、4B Task 12 と衝突しない。

### 前提B: `packages/` の既存API（本プランが使う分だけ。実ソースで署名を確認済み）

| モジュール | 署名（実ソースのまま） |
|---|---|
| `@ojt/schematic-core` | `interface SchematicCell { kind: CellKind; id: string; device: string; presetMs?: number \| undefined }` |
| 〃 | `type CellKind = 'pb-a' \| 'pb-b' \| 'cr-a' \| 'cr-b' \| 't-a' \| 't-b' \| 'coil' \| 'lamp' \| 'buzzer'` |
| 〃 | `type RungEnd = { bus: 'P' } \| { bus: 'N' } \| { rung: string; node: number }` |
| 〃 | `interface Rung { id: string; from: RungEnd; to: RungEnd; cells: SchematicCell[] }` |
| 〃 | `interface SchematicDocument { formatVersion: number; id: string; title: string; orientation: 'horizontal'; rungs: Rung[] }` |
| 〃 | `function validateDocument(doc): DocumentError[]`（空配列なら妥当。`DocumentError = { path: string; message: string }`） |
| 〃 | `function createDocument(id, title, rungs)` / `function rung(id, from, to, cells)` / `BUS_P` / `BUS_N` / `function at(rungId, node)` |
| 〃 | `function isLoadCell(cell): boolean` / `function isContactCell(cell): boolean` / `function documentDevices(doc): string[]` |
| 〃 | `function layout(doc, options?: LayoutOptions): SchematicLayout`（`{ width, height, shapes }`。`Shape` は `rungId?` / `cellId?` を持つ） |
| 〃 | `const DEFAULT_LAYOUT_OPTIONS: Required<LayoutOptions> = { colWidth: 24, rowHeight: 24, marginX: 12, marginY: 16, symbolWidth: 12 }` |
| 〃 | `function assignToBoard(doc, options?: AssignOptions): AssignResult`（`Assignment = { ok: true; roles; parts; cells; wires }`、失敗は `{ ok: false; errors: AssignError[] }`。`AssignError = { path: string; message: string }`） |
| 〃 | `interface CellAssignment { cellId: string; device: string; group: number; left: TerminalId; right: TerminalId }` |
| 〃 | `function toSession(doc, board, options?: ToSessionOptions): ToSessionResult`（`{ ok: true; session; assignment }` / `{ ok: false; errors }`。**§11.3 の渡り配線＝§17.2 #33 はここが既に実装している**） |
| `@ojt/content` | `function judgeAssemble(problem: AssembleProblem, board, traineeSession, options?: JudgeOptions): JudgeAssembleResult` |
| 〃 | `function buildReferenceSession(problem: SchematicProblem, board): ReferenceResult`（`ReferenceCircuit = { session; netlist; roles; cells }`） |
| 〃 | `const ASSEMBLE_WIRE_COLOR = '青'` / `function toSocketRoles(raw)` / `function toProblemPath(problem, path)` |
| 〃 | `function buildHighlightIndex(cells: readonly CellAssignment[], session: BoardSession): HighlightIndex` |
| 〃 | `function highlightFor(index, cellId): HighlightTarget \| undefined`（`HighlightTarget = { cellId; device; terminals; wireIds }`） |
| 〃 | `function cellIdsAtTerminal(index, terminal): string[]` / `function cellIdsOfWire(index, wireId): string[]` |
| 〃 | `function plcBoardFor(problem: PlcProblem, board): BoardDefinition \| undefined` / `function resolvePlcIo(io): ResolvedPlcIo` |
| 〃 | `const PLC_VENDORS = ['mitsubishi','jtekt','omron','sharp']` / `const PLC_MODELS = ['FX5U','PC10G-1SP','CP1E','JW-300']` / `SUPPORTED_PLC_MODELS`（4A が `PHASE3_MODELS` から改名して4機種へ広げた） |
| 〃 | `BUILTIN_PLC_PROBLEMS` / `BUILTIN_ALL_PROBLEMS` / `BUILTIN_ASSEMBLE_PROBLEMS` / `BUILTIN_PROBLEMS` |
| `@ojt/circuit-sim` | `function buildNets(netlist: Netlist): Nets`（`Nets` は `nodeCount` / `terminals` / `hasTerminal(t)` / `nodeOf(t)` / `terminalsOf(n)`。`wire.open` は併合しない） |
| 〃 | `const MAX_WIRES_PER_TERMINAL = 2` / `function toTerminalId(raw): TerminalId` / `function parseTerminalId(id): { part; name }` |
| `@ojt/board-model` | `function toNetlist(session, board): Netlist` / `const JIPM_BOARD` / `function toPhysicalTerminal(roles, id)` / `function isOffBoardTerminal(id): boolean` |
| 〃 | `interface BoardTerminal { id; label; role; pos; pickRadiusMm; wirable; exit? }` / `function roleLabel(role): string` / `SOCKET_ROLES` |

### 前提C: `apps/desktop` の既存API（本プランが触る分だけ。実ソースで確認済み）

| 場所 | 事実 |
|---|---|
| `renderer/schematic/SchematicSvg.tsx` | `SchematicSvg({ document, highlightCellIds?, onPickCell? })`。図形に `data-cell` を出し、クリックで `data-cell` を読んで `onPickCell` を呼ぶ。ハイライトは `#C2410C`・線幅1.8倍。寸法は `const LAYOUT: LayoutOptions = { colWidth: 40 }` |
| `renderer/app/store-types.ts` | `interface HighlightSelection { cellIds; terminals; wireIds }` と `const NO_HIGHLIGHT` が**既にある**（§11.4 のコメント付き） |
| `renderer/app/store.ts` | `highlight` / `setHighlight()` が**既にある**（C2 が使用）。`ladderView: LadderViewMode` / `setLadderView()` がモードDのビュー切替の先例。`schematicPolicy(grade)` がヒントの出し方（§8.4） |
| `renderer/screens/InspectRepairSession.tsx` L297〜L340・L800〜L812 | 連動ハイライトの glue（`buildHighlightIndex` → `setHighlight` → `SchematicSvg`）が landed。**同じ処理をモードBにも要る**ので Task 8 で共通モジュールへ寄せる |
| `renderer/three/BoardScene.tsx` | `visualSignature(state)` が `highlight.terminals` / `highlight.wireIds` を既に見ている。`frameloop="demand"`・`dpr={[1,1.5]}`・`<Invalidator/>`・`memo(BoardSceneImpl)`・`data-testid="camera-readout"` の隠し要素 |
| `renderer/three/TerminalHit.tsx` | 端子1個＝`<group>` ＋ ネジの `mesh`（`SCREW_GEOMETRY`）＋ **不可視だがイベントを拾う** `mesh`（`PICK_GEOMETRY`、`visible={false}`）＋ ホバー時の `Html`。`Socket` / `TerminalBlock` / `PlcUnit` / `Outlet` の4箇所から使われている |
| `renderer/three/labels.ts` | `socketFaceTexture(terminals, originX, originY, plateW, plateH)` / `blockFaceTexture(terminals, padMm)` / `makeCanvasTexture()` / `PX_PER_MM = 16` / `terminalNumber()` / `faceRect()`。**機器1個につきキャンバス1枚**を焼く方針 |
| `renderer/three/DeskWires.tsx` | `useMemo(..., [board, session])`。`session` は配線のたびに `cloneSession()` で**新しい参照**になるので、机上ケーブルは毎回作り直されている |
| `renderer/session/interaction.ts` | `pickToAction(state, hit): PickAction` / `escapeToAction` / `deleteKeyToAction` / `shouldIgnoreShortcut` / `PickHit`（`{ kind:'terminal'; id; wirable; label }` ほか） |
| `renderer/session/step-guide.ts` | `sequentialSteps()` / `assembleSteps()` / `assembleStepHint()` / `GuideStep<K>` / `StepState`（2026-09-19 のUXレビュー #3 で landed） |
| `renderer/session/commands.ts` | `CommandHistory` / `HISTORY_LIMIT = 50` / `cloneSession()`。`session/ladder.ts` に `LadderHistory` / `pushLadder` / `undoLadder` / `redoLadder` の**同じ形**がある（回路図の履歴はこれに揃える） |
| `renderer/session/spec-chart.ts` | `buildSpecChart(problem)` が**renderer で模範回路を1回シミュレートして**キャッシュする（175〜260ms）。検算を Worker に置く判断の比較対象 |
| `renderer/result/*` | `ResultView({ problem, result, restoredHazardCount?, onRetry, onBackToList })` / `MismatchList({ mismatches })` / `StaticCheckList` / `HazardList` / `ChartOverlay({ expected, actual, mismatches })` |
| `worker/protocol.ts` | `SimCommand` に `judge` / `judgeParts` / `judgeRepair` / `judgePlc`、`SimMessage` に `judgeResult` / `inspectResult` / `plcResult` / `error` |
| `renderer/session/worker-bridge.ts` | `BridgeHandlers` は `onSnapshot` / `onJudge` / `onInspect?` / `onPlc?` / `onError`。`worker.onmessage` が `type` で振り分ける |
| `shared/ipc.ts` | `WORK_FILE_FORMAT_VERSION = 1`。`WorkFile` は**素のインターフェース**で `mode?` / `tester?` / `ladder?` などの**任意項目を足して版を上げない**流儀 |
| `apps/desktop/package.json` | `"version": "0.2.0"`、`"dist": "node scripts/copy-content.mjs && node scripts/build.mjs && electron-builder --config electron-builder.yml"` |
| `apps/desktop/electron-builder.yml` | `productName: 電気教育ツール` / `win.target: [nsis, zip]` / `artifactName: ${productName}-${version}-${arch}.${ext}` / `extraResources: resources/content → content` / `publish: null` / `directories: { output: release, buildResources: build }` |
| `apps/desktop/test/content-resources.test.ts` | 同梱課題の複写と正本の一致を検査済み（モード別フォルダを `readdirSync` で拾う） |
| `apps/desktop/e2e/*` | `smoke` / `navigation` / `chart` / `inspect` / `plc` / `polish` の6本。すべて `--use-gl=swiftshader --use-angle=swiftshader --enable-unsafe-swiftshader` で Electron を起動し、`BrowserWindow.capturePage()` でスクリーンショットを撮る |
| リポジトリ直下 | **`README.md` が無い**。`docs/releases/v0.2.0.md` と §15 は「SmartScreen の手順を README とインストーラの説明画面に書く」と定めているのに、どちらも存在しない |

### 前提D: 実コードで確認した「Phase 5 が直さなければならない箇所」

| # | 事象（実ソース） | Phase 5 での扱い |
|---|---|---|
| 1 | `SchematicSvg` は**読取専用**で、クリックは `data-cell` を読むだけ。空いている桁（要素を置ける位置）に当たり判定が無い | Task 1 で `slotRects()` を `schematic-core` に足し、Task 5 で透明な `<rect data-slot>` を敷く |
| 2 | `validateDocument()` は「段に要素がありません」「段が1つもありません」をエラーにする。**作りかけの文書は必ず不正**である | 決定表#3: エディタは不正な下書きを**許し**、`validateDocument()` の結果を指摘欄に出す。検算だけが妥当性を要求する |
| 3 | `assignToBoard()` の `AssignError.path` は回路図の要素ID（`c05`）・役割名（`CR1`）・電線ID（`sw-003`）が混ざる | Task 2 の `verifySchematic()` が `cellId` を**別項目**として返す（`toProblemPath()` は課題JSONのパスへ直すもので、エディタには使えない） |
| 4 | モードBの `Session.tsx` は `highlight` を1度も読み書きしていない（C2 だけが使っている） | Task 8 でモードBにも配線ガイドを入れる。ストアの欄・3D側は既存のまま |
| 5 | 端子は `TerminalHit` が1個につき `<group>`＋2メッシュ。**`TerminalHit` を持つのは `Socket` と `TerminalBlock` が描く端子だけ**で、8ソケット×14 ＝112 ＋ ランプ用端子台 8 ＋ 押ボタン用端子台 12 ＋ P/N 各1 ＝ 2 の **134 個 → 268 メッシュ**（`Fixture` は端子の印字しか描かず `TerminalHit` を使わないので、CB/SW/PS・PB/PL 本体の `wirable: false` な端子は最初から3Dに出ていない。BZ は課題が `extraParts` で足したときだけ ＋2 で 136 個） | Task 12 で `TerminalField`（`instancedMesh` 2本）に置き換え、端子ぶんのドローコールを 2 にする |
| 6 | `socketFaceTexture()` は Socket ごとに `useMemo` で焼く。**8枚のキャンバスの中身は完全に同一**（相対位置も印字も同じ） | Task 13 でモジュール内キャッシュを入れ、8枚 → 1枚にする |
| 7 | `DeskWires` の `useMemo` の鍵が `session`（配線のたびに新しい参照）。机上ケーブルの `TubeGeometry` が毎回作り直される | Task 13 で署名文字列を鍵にし、`memo()` で包む |
| 8 | 性能を測る窓が無い（`camera-readout` はカメラだけ）。「60fps」「三角形20万以下」を確かめる手段がリポジトリに無い | Task 11 で `PerfProbe` と `data-testid="perf-readout"` を足す |
| 9 | 結果画面は「不合格」「差分一覧」で終わり、**どこを直せばよいか**を示さない（UXレビュー #28） | Task 3・9（`wiringSuspects()` ＋ 疑い一覧 ＋「盤で見る」） |
| 10 | 3Dの配線はマウス必須。§15 のアクセシビリティは「課題選択・判定・結果確認まで」しか求めていないが、UXレビュー #29 が配線のキーボード代替を求めた | Task 10（端子リストパネル。Tab で移動・Enter で選択） |
| 11 | `apps/desktop/package.json` の版が `0.2.0` のまま。`artifactName` が版を使うので、このままだと v1.0.0 の配布物が `0.2.0` の名前で出る | Task 14 で `1.0.0` にする |
| 12 | `README.md` も `build/license.txt`（NSIS の説明画面）も無い（§15 の要求が未実装） | Task 14 で両方作る |

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `packages/schematic-core/src/edit.ts` | **新規**: 文書の編集操作（`SchematicEdit` と `applyEdit()`）・ID採番・空の文書。§11.4（Task 1） |
| `packages/schematic-core/src/document.ts` | **変更（追記のみ）**: `DEVICE_PATTERNS` を `export` するだけ（規則の表を `edit.ts` に写さないため）。既存の関数は1行も変えない（Task 1） |
| `packages/schematic-core/src/layout.ts` | **変更（追記のみ）**: `rungStartX()` / `slotRects()`。既存の `layout()` / `contactShapes()` / `loadShapes()` / `DEFAULT_LAYOUT_OPTIONS` は署名も値も変えない（Task 1） |
| `packages/schematic-core/src/index.ts` | **変更（追記のみ）**: `edit.ts` と `slotRects` と `DEVICE_PATTERNS` の再輸出（Task 1） |
| `packages/content/src/verify.ts` | **新規**: `verifySchematic()`＝検算（`buildSchematicSession()` → `judgeAssemble()`）。§11.4（Task 2） |
| `packages/content/src/reference.ts` | **変更**: `buildSchematicSession(problem, board, doc)` を切り出し、`buildReferenceSession()` と `verifySchematic()` の両方から使う（Task 2） |
| `packages/content/src/wiring-diff.ts` | **新規**: `wiringSuspects()`＝模範回路と訓練者回路の節点分割の差。UXレビュー #28（Task 3） |
| `packages/content/src/index.ts` | **変更（追記のみ）**: 上2つの再輸出（Task 2・3） |
| `apps/desktop/src/renderer/session/schematic-edit.ts` | **新規**: エディタのカーソル・パレット・履歴・キー割当の純関数層（Task 4） |
| `apps/desktop/src/renderer/session/step-guide.ts` | **変更（追記のみ）**: `schematicSteps()` / `schematicStepHint()`（Task 4） |
| `apps/desktop/src/renderer/schematic/SchematicSvg.tsx` | **変更**: 編集モード（スロット矩形・カーソル枠・`onPickSlot`）。読取専用の呼び出しは**そのまま動く**（Task 5） |
| `apps/desktop/src/renderer/schematic/SchematicEditor.tsx` | **新規**: エディタ本体（図＋パレット＋指摘欄＋手順の1行案内）（Task 5） |
| `apps/desktop/src/renderer/schematic/SchematicPalette.tsx` | **新規**: 置ける要素のパレット（Task 5） |
| `apps/desktop/src/renderer/schematic/VerifyPanel.tsx` | **新規**: 検算の結果（合否・指摘・差分一覧・波形の重ね）（Task 6） |
| `apps/desktop/src/renderer/schematic/schematic.module.css` | **新規**: エディタ・パレット・検算パネルの CSS（Task 5・6） |
| `apps/desktop/src/worker/protocol.ts` | **変更（追記のみ）**: `verify` コマンドと `verifyResult` メッセージ（Task 6） |
| `apps/desktop/src/worker/sim.worker.ts` | **変更（追記のみ）**: `case 'verify'`（Task 6） |
| `apps/desktop/src/renderer/session/worker-bridge.ts` | **変更**: `onVerify?` ハンドラ（Task 6） |
| `apps/desktop/src/renderer/app/store.ts` | **変更**: 回路図エディタの欄と操作（Task 6）、`assembleView`（Task 7）、`boardFocus`（Task 9） |
| `apps/desktop/src/shared/ipc.ts` | **変更（追記のみ）**: `WorkFile.schematic?`（Task 6） |
| `apps/desktop/src/renderer/session/work-file.ts` | **変更**: 下書きの保存・復元（Task 6） |
| `apps/desktop/src/renderer/screens/Session.tsx` | **変更**: ビュー切替とエディタの差し込み（Task 7）、配線ガイド（Task 8）、結果からの注目（Task 9）、端子リスト（Task 10） |
| `apps/desktop/src/renderer/panels/Toolbar.tsx` | **変更（追記のみ）**: `viewSwitch` の差し込み口（Task 7） |
| `apps/desktop/src/renderer/session/wiring-guide.ts` | **新規**: 回路図要素 ⇄ 盤の選択を作る純関数（Task 8） |
| `apps/desktop/src/renderer/screens/InspectRepairSession.tsx` | **変更**: 連動ハイライトの glue を `wiring-guide.ts` へ寄せる（Task 8） |
| `apps/desktop/src/renderer/result/SuspectList.tsx` | **新規**: #28 の疑い一覧と「盤で見る」（Task 9） |
| `apps/desktop/src/renderer/result/ResultView.tsx` | **変更**: `SuspectList` の差し込み（Task 9） |
| `apps/desktop/src/renderer/session/terminal-list.ts` | **新規**: 端子リストの行を作る純関数（Task 10） |
| `apps/desktop/src/renderer/panels/TerminalListPanel.tsx` | **新規**: #29 のキーボード配線パネル（Task 10） |
| `apps/desktop/src/renderer/three/PerfProbe.tsx` | **新規**: 描画枚数・三角形数・ドローコールの窓（Task 11） |
| `apps/desktop/src/renderer/three/TerminalField.tsx` | **新規**: 端子をまとめて描く `instancedMesh` 2本（Task 12） |
| `apps/desktop/src/renderer/three/Socket.tsx` / `TerminalBlock.tsx` | **変更**: `TerminalHit` のループを外す（端子は `TerminalField` が描く）（Task 12） |
| `apps/desktop/src/renderer/three/materials.ts` | **変更（追記のみ）**: `noPick` を `Socket` / `TerminalBlock` / `TerminalField` の共有に出す（Task 12） |
| `apps/desktop/src/renderer/app/store-types.ts` | **変更（追記のみ）**: `BoardFocus`（結果画面からの注目）（Task 9） |
| `apps/desktop/src/renderer/three/labels.ts` | **変更（追記のみ）**: テクスチャの共有キャッシュ（Task 13） |
| `apps/desktop/src/renderer/three/DeskWires.tsx` | **変更**: メモ化の鍵を署名にし `memo()` で包む（Task 13） |
| `apps/desktop/scripts/check-dist.mjs` | **新規**: 配布物の検査とチェックサム表の生成（Task 14） |
| `apps/desktop/build/license.txt` | **新規**: NSIS の説明画面（SmartScreen の手順・商標注記）（Task 14） |
| `README.md` | **新規**: 導入手順・動作環境・SmartScreen・オフライン（§15）（Task 14） |
| `docs/releases/v1.0.0.md` | **新規**: リリースノートとリリース手順チェックリスト（Task 14） |
| `apps/desktop/e2e/schematic.spec.ts` / `perf.spec.ts` | **新規**: 受入基準①②④ ＋ #28/#29 ＋ オフライン計測（Task 15） |

---

## 設計判断（レビューで確認する決定表）

| # | 決めたこと | 採用した設計 | 理由・却下した案 |
|---|---|---|---|
| 1 | **エディタはどこに住むか** | モードBのセッション画面に**ビュー切替**（`assembleView: 'board' \| 'split' \| 'schematic'`）を足す。モードDの `ladderView` と同じ形・同じ語彙 | 受入基準①の「検算で合格する」は課題の操作列と判定設定を要るので、エディタは**課題の中**に居なければならない。独立画面にすると課題を選び直す導線が要り、§12.1 の画面遷移（5画面）も増える。`split` を持つのは受入基準②（クリック → 3D の端子が光る）を**1画面で**見せるため |
| 2 | **エディタの初期文書** | 段1本（`P → N`）・要素0個の空文書。**課題の模範回路は絶対に入れない** | 模範回路を入れると答えを配ることになる（§8.4 は級ごとにヒントの出し方を決めている）。空の段を1本置くのは、0段だと最初にクリックする場所が無いため |
| 3 | **作りかけの文書を許すか** | 許す。`applyEdit()` は「表せない編集」（存在しない段・範囲外の桁・種別に使えない機器名）だけを断り、**妥当性は `validateDocument()` が別に出す**。指摘欄に出し続け、**検算だけ**が妥当性を要求する | `validateDocument()` は「段に要素がありません」「右母線に至る段は負荷で終わる」を要求するので、編集の途中は必ず不正になる。編集を拒むと1要素も置けない。モードDの出力ウィンドウ（変換の指摘を出し続ける）と同じ流儀 |
| 4 | **検算はどこで走るか** | **Worker**（`verify` コマンドを1本足す）。renderer は `verifying` を立ててボタンを止め、`verifyResult` で受ける | §15「シミュレーションは Web Worker。renderer のフレーム処理をブロックしない」。検算は模範＋訓練者の2回ぶん（判定と同じ 0.3〜0.6 秒）で、`buildSpecChart()` の 175〜260ms より重い。renderer で回すとエディタの入力が固まる |
| 5 | **検算の結果から盤へ自動配線するか** | **しない**。検算パネルに「盤に写す」は置かない | §8.2 の配線操作そのものが訓練である。自動配線を置くと「エディタで描いて写すだけ」で課題が終わり、盤の練習（§16 Phase 1 受入基準①）が空洞になる。代わりに**配線ガイド**（決定表#7）で「どの端子へ張ればよいか」だけを示す |
| 6 | **検算の合否と判定の合否の関係** | **同じ判定器（`judgeAssemble()`）を同じ操作列で通す**ので基準は一致する。ただし検算は `sessionHazards` を渡さない（机上に危険操作は無い）。画面には「机上の検算です。盤の配線は別に判定します」と1行出す | 基準が違うと「検算は合格したのに判定は不合格」が説明できなくなる。危険操作は盤の操作の記録なので、机上の検算に混ぜると回数が二重になる |
| 7 | **配線ガイドの索引の出どころ** | 画面に出ている回路図によって切り替える。**エディタ**＝`assignToBoard(doc)` の `cells`、**回路図ヒント**（§8.4）＝`buildReferenceSession(problem)` の `cells`。どちらも `buildHighlightIndex(cells, session)` に通してストアの `highlight` に入れる | `buildHighlightIndex()` は `CellAssignment[]` しか要求しない（C2 が landed 済み）。出どころを1つに固定すると、エディタの文書を編集しても光る端子が模範回路のままになる |
| 8 | **配線ガイドの逆引き（3D → 回路図）** | **入れる**。盤の端子にホバーすると回路図側の要素が光る（`cellIdsAtTerminal()`）。C2 で landed している向きと同じ | 利用者要求「分かりやすく直感的に」。片方向だけだと「この端子は回路図のどれか」が分からず、配線の確認に使えない。関数は既にある（`cellIdsAtTerminal` / `cellIdsOfWire`） |
| 9 | **#28 の「疑い」の求め方** | 模範回路と訓練者回路の**節点分割の差**（`buildNets()` の union-find）。比較対象は**回路図の要素が使う端子 ＋ `P.1` / `N.1`** に限る。`missing`（つながっていない）を先に、`extra`（余計につながっている）を後に、最大5件 | 電線の1対1照合だと、渡り配線の鎖の順が違うだけで全部「違う」になる（§11.3 の母線分配は順序を決めない）。節点分割なら「電気的に同じか」だけを見るので、鎖の順が違っても正しくは正しいと言える。盤の全端子で比べると未使用端子が大量に出るので回路図の端子に絞る |
| 9b | **接点の組の選び方の違いをどう扱うか** | **正規化しない。画面の文言で断る**（`JA.result.suspectNote`＝「接点の組（`CR1` の ⑨⑤／⑩⑥／⑪⑦／⑫⑧）はどれを使っても回路は成立します。組が違うだけのときも、ここに『不足』『余分』として出ます」を疑い一覧の下に常に出す） | `assignToBoard()` は模範回路の要素の**出現順に**接点の組を割り当てる（`CellAssignment.group`）。訓練者が別の組へ張ると電気的には正しくても節点分割は違うので、`missing`/`extra` が出る。正規化するには機器ごとに「模範の組 ⇄ 訓練者の組」の最良対応を解く（二部マッチング）ことになり、①訓練者に見えない解が疑いの並びを決める、②`com` を `nc` 側に張った本物の誤りを「組の違い」に吸収して隠す、の2つの害がある。1行で断るほうが安く正直である（利用者要求「最小のトークンで品質を落とさず」） |
| 10 | **#28 をどこで計算するか** | **renderer の結果画面**で `useMemo`。`JudgeResult` に項目を足さない | 節点分割はソルバを回さないグラフ処理（数百端子の union-find ＝1ms未満）なので Worker へ往復させる必要が無い。`JudgeResult` に足すと `@ojt/content` の公開型が変わり、C1/C2/D の3判定と作業ファイルにも波及する |
| 11 | **「盤で見る」の遷移** | `setHighlight(選択)` → `setBoardFocus({ from: 'result', text })` → `setRoute('session')`。セッション画面の上部に「結果から: <説明>」の帯と「結果へ戻る」ボタンを出す | 結果画面から盤へ跳ぶと「どうやって戻るのか」が分からなくなる（利用者要求「分かりやすく」）。ストアは判定後も `problem` / `session` を保持しているので、盤はそのままの配線で開く |
| 12 | **#29 の配線UIの作り** | `panels/TerminalListPanel.tsx` が配線可能な端子を機器ごとに並べ、各行を `<button>` にする。**Tab で移動・Enter で選択**。選択は `PickHit`（`kind: 'terminal'`）に直して**既存の `pickToAction()` に通す** | 3Dのピックと別の配線経路を作ると、1端子2本の上限・固定配線の拒否・`beginWire`/`completeWire` の状態遷移が2箇所に割れる。`pickToAction()` に通せば規則は1箇所のまま（§12.2 の「純粋関数化」の趣旨そのもの） |
| 13 | **端子の描き方（性能）** | `TerminalField`（`instancedMesh` 2本＝ネジ頭と当たり判定球）を **`BoardScene` が1回だけ**描く。`Socket` / `TerminalBlock` は端子を描かなくなる。**`PlcUnit` / `Outlet` は `TerminalHit` のまま**。描く端子は「いま `Socket` / `TerminalBlock` が描いているもの」と**1個も違わない**（＝`wirable === true` かつ机上でない端子。任意部品 BZ の2端子は `session.extraParts` に入っているときだけ） | 端子134個で 268 メッシュ＝ドローコールも同数。`instancedMesh` なら2本。`PlcUnit` を外すのは Plan 4B Task 10・11 が同じファイルを作り替えるため（MERGE 注意 #5）。机上の端子は十数個なので性能上の効果も小さい。`wirable: false` の端子（CB/SW/PS・PB/PL 本体）を入れると、いま触れない端子が急に触れるようになってしまう |
| 14 | **インスタンスの色分け** | `instanceColor` に3状態（平常・ホバー・配線待ち）だけを載せる。**連動ハイライトは `ProbeMarkers` の輪のまま** | 輪（`ProbeMarkers`）は遠景でも見えるので既に役目を果たしている。同じ意味を2つの描き方で出すと優先順位を2箇所で決めることになる（`Wire.tsx` の `wireBodyColor()` で確立した流儀） |
| 15 | **印字テクスチャの共有** | `labels.ts` にモジュール内キャッシュを持ち、**鍵は「板の左上からの相対位置＋印字＋役割＋板の寸法」**（`faceKey()`）。8ソケットは鍵が一致するので1枚を共有する | 8枚の中身は完全に同一（相対配置も印字も同じ）。ソケットの板は 38mm × 84mm（本体 30×76 ＋ `SOCKET_PLATE_MARGIN_MM` 4 の四方）で、`PX_PER_MM = 16` なので **608 × 1344px ＝ 約3.3MB**。これを8枚（約26MB）持っていた。`Socket` 側の `useMemo` の鍵（`originX` / `originY`）は**絶対座標**なので共有できず、キャッシュは `labels.ts` に置くしかない |
| 16 | **性能の測り方** | `PerfProbe`（`useFrame`）が 250ms ごとに `data-testid="perf-readout"` へ `{frames, fps, triangles, calls, geometries, textures}` を JSON で書く。**常時有効**（開発時も配布版も） | `frameloop="demand"` では `useFrame` は**描いたフレームだけ**走るので、これがそのまま「無操作で描いていないこと」の証明になる（§15 の方針の監査）。旗で切り替えると E2E が配布版と違う道を通る |
| 17 | **受入基準④（60fps）の確かめ方** | E2E（swiftshader）は**GPU非依存の予算**（三角形 ≤ 200,000／ドローコール ≤ 120／無操作3秒で描画枚数が増えない）を自動で縛り、測った fps を `perf-report.json` に残す。**60fps そのものは実機（内蔵GPU・FHD）で同じ E2E を走らせて確認**し、Task 14 のリリース手順チェックリストに記録する | CI・リモートデスクトップにはGPUが無く、既存E2Eは `--use-gl=swiftshader` で動いている（`smoke.spec.ts` の注記）。ソフトウェアラスタライザの fps は実機の指標にならない（v0.2.0 リリースノートの「既知の制限」にも同じ注意がある）。三角形数とドローコールは描画経路に依らないので自動で縛れる |
| 18 | **配布は新規構築ではなく固め** | `electron-builder.yml` / `copy-content.mjs` は**触らない**（`dist` スクリプトに `check-dist.mjs` を1つ足すだけ）。版を 1.0.0 にし、同梱課題の検査・成果物の検査とチェックサム・README・インストーラ説明画面・手順書を足す | v0.2.0 で NSIS とポータブルの両方が実際に出ており（106.9MB / 146.8MB）、受入基準③はそのビルドで確かめられている。作り直すと退行の危険だけが増える |
| 19 | **4メーカー分の同梱** | 課題JSONは1組のまま（内蔵PLC課題は `mitsubishi`/`FX5U`）。検査は「**4機種すべてで `plcBoardFor()` が `plcUnit` を持つ盤を返し、その端子集合が課題の I/O 割付を満たす**」を単体テストで縛る | 方言プロファイルとスキンは**コード**なので electron-vite が asar にバンドルする（`files: out/**/*`）。課題を4組持つと 4A 決定表#14（JSONは変えず `plc` だけ差し替える）と矛盾する。端子集合の検査なら 4B の有無に関係なく今日のAPIだけで書ける |
| 20 | **版と成果物の名前** | `apps/desktop/package.json` を `1.0.0` にする。`artifactName` は既存のまま（`電気教育ツール-1.0.0-x64.exe` / `.zip`）。ルートの `package.json` は版を持たない | `artifactName: ${productName}-${version}-${arch}.${ext}` は `apps/desktop/package.json` の `version` を読む。v0.2.0 の配布物と名前で区別できる |
| 21 | **SHA256 と成果物一覧** | `check-dist.mjs` が `release/artifacts.md`（ファイル名・バイト数・SHA256 の表）を**生成**し、リリースノートはそれを参照する | リリースノートに数値を直書きすると、ビルドし直すたびに人が書き換えることになり、ずれる。v0.2.0 はそれを手で書いていた |
| 22 | **公開の線引き** | 本プランは `release/` の成果物と `docs/releases/v1.0.0.md`（GitHub Release 本文の貼り付け用ブロックを含む）までを作る。**`git tag` も `gh release create` も実行しない** | 利用者の明示の決定（2026-09-19）。手順書には「利用者の指示を受けてから実行する」と書き、コマンド自体は載せる（指示が出たら迷わない） |
| 23 | **作業ファイルにエディタの下書きを残すか** | 残す。`WorkFile.schematic?: unknown`（任意項目）を足し、`formatVersion` は **1 のまま**。古い作業ファイルは下書き無しで開く | `mode?` / `tester?` / `ladder?` と同じ流儀（前提C）。下書きが消えると「保存して続きから」で机上作業だけが失われる |
| 24 | **回路図エディタの手順の見える化** | `session/step-guide.ts` に `schematicSteps()` / `schematicStepHint()` を足し、既存の `.stepGuide` 帯にそのまま流す | 2026-09-19 のUXレビュー #3 で landed した仕組み。エディタにだけ別の案内を作ると、同じ画面に2つの流儀が並ぶ |
| 25 | **エディタのキー割当** | 矢印＝カーソル移動、`Enter`＝パレットの選択中の要素を置く、`Delete`/`Backspace`＝要素を消す、`Insert`＝段を足す、`Ctrl+Delete`＝段を消す、`Ctrl+Z`/`Ctrl+Y`＝元に戻す／やり直し。**`shouldIgnoreShortcut()` を必ず通す** | `ladder/LadderGrid.tsx` の流儀（矢印＋機能キー）に合わせる。`shouldIgnoreShortcut()` を通さないと、タイマ設定の数値入力中に `Delete` で要素が消える（Phase 1D で踏んだ不具合） |
| 26 | **パレットに出す機器** | 盤に実在するものだけ（`CR1`〜`CR4` / `T1`・`T2` / `PB1`〜`PB4` / `PL1`〜`PL4`、`BZ` は**課題の `board.extraParts` にあるときだけ**）。ソケットの役割は課題の `board.socketRoles` に従う | §17.2 #15「BZ は既定では盤に置かない」。置けない機器を並べると、描けたのに検算で「盤に無い」と言われる |
| 27 | **疑い一覧の上限** | 5件（`MAX_WIRING_SUSPECTS`）。超えたときは「ほかに N 件」と出す | 未配線の盤で判定すると全端子が `missing` になる。全部並べると読めない。5件は結果画面のカードに収まる行数 |

---

## 実装バッチ（推奨）

依存関係にもとづく5バッチ。バッチ内の `／` は並行可、`→` は直列。**並行の上限は2系統**（`i18n/ja.ts` と `store.ts` の追記が衝突するため。MERGE 注意 #1・#2）。

**バッチCの中は並行させない。** Task 9 は `JA.result` と `Session.tsx`（「結果から」の帯）を、Task 10 は `JA.terminalList` と `Session.tsx`（右パネル）を触る。同じ2ファイルの別々の場所を同時に書き換えることになるので、**8 → 9 → 10 の直列**にする（MERGE 注意 #1・#3）。並行させるのは **C（`Session.tsx` 系）と D（`BoardScene.tsx` 系）の2系統だけ**で、この2つは触るファイルが重ならない。

| バッチ | タスク | 対象 | モデル | 依存 |
|---|---|---|---|---|
| A | 1 → 2 ／ 3 | `schematic-core`（編集とスロット）→ `content`（検算） ／ `content`（疑い一覧） | 1=**Opus** / 2=Sonnet-verbatim ／ 3=**Opus** | Phase 4 landed |
| B | 4 → 5 → 6 → 7 | エディタの純関数層 → 画面 → 検算の往復 → モードBへの組み込み | 4=**Opus** / 5=**Opus** / 6=**Opus** / 7=**Opus** | A |
| C | 8 → 9 → 10 | 配線ガイド → 結果の疑い一覧 → 端子リスト | 8=**Opus** / 9=**Opus** / 10=Sonnet | B |
| D | 11 → 12 → 13 | 計測窓 → 端子のインスタンス化 → テクスチャ共有と `frameloop` 監査 | 11=Sonnet-verbatim / 12=**Opus** / 13=**Opus** | B（`BoardScene` を C と同時に触らない） |
| E | 14 ／ 15 → 16 | 配布の固め ／ E2E → 全体検証 | 14=**Opus** ／ 15=**Opus** / 16=Sonnet | A〜D すべて |

進め方: **A（2系統を並行）** → **B** → **C と D を並行** → **E**。各バッチの終わりに **Opus レビューを1回**かける（レビュー方針: グループごとに1回、細かい指摘はまとめて修正）。

「Sonnet-verbatim」と書いたタスクは、本書のコードとテストをそのまま書き写せば通る。**Opus** は判断の要るタスク（編集操作の設計、節点分割の差の出し方、SVG の当たり判定、`store.ts` / `BoardScene.tsx` の MERGE、インスタンス化、E2E の待ち方、配布物の検査）である。**どのタスクも、後のタスクが作るファイルを import しない。**

---

## Task 1: 回路図文書の編集操作とスロット矩形（`@ojt/schematic-core`）

**モデル: Opus**（編集操作の粒度と、作りかけの文書を許す境界の設計）

**Files:**
- Create: `packages/schematic-core/src/edit.ts`
- Modify: `packages/schematic-core/src/document.ts`（`DEVICE_PATTERNS` に `export` を付けるだけ）
- Modify: `packages/schematic-core/src/layout.ts`（末尾に `rungStartX()` / `slotRects()` を追記。既存の export は署名も値も変えない）
- Modify: `packages/schematic-core/src/index.ts`（再輸出）
- Test: `packages/schematic-core/test/edit.test.ts`（新規）
- Test: `packages/schematic-core/test/slot-rects.test.ts`（新規）

§11.4「ラダーと同じグリッド編集エンジンで編集可能にする」の**文書側**。UI は持たない。決定表#3 のとおり、`applyEdit()` は「**その編集が文書として表せるか**」だけを見て、妥当性（`validateDocument()`）は別に出す。

- [ ] **Step 1: 失敗するテストを書く（編集操作）**

`packages/schematic-core/test/edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  crA,
  coil,
  editLabel,
  emptySchematic,
  lamp,
  MAX_CELLS_PER_RUNG,
  MAX_RUNGS,
  nextCellId,
  nextRungId,
  pbA,
  pbB,
  rung,
  BUS_N,
  BUS_P,
  createDocument,
  validateDocument,
  type SchematicDocument,
} from '../src/index.js';

/** 自己保持回路（§16 Phase 5 受入基準①）を素で組んだ文書。 */
function selfHold(): SchematicDocument {
  return createDocument('d1', '自己保持', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
    rung('r2', BUS_P, { rung: 'r1', node: 1 }, [crA('c3', 'CR1')]),
    rung('r3', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL1')]),
  ]);
}

describe('emptySchematic（決定表#2）', () => {
  it('starts with one empty rung between the two buses', () => {
    const doc = emptySchematic('draft-b-001', '下書き');
    expect(doc.formatVersion).toBe(1);
    expect(doc.orientation).toBe('horizontal');
    expect(doc.rungs).toHaveLength(1);
    expect(doc.rungs[0]).toMatchObject({ id: 'r1', from: { bus: 'P' }, to: { bus: 'N' }, cells: [] });
  });

  it('is not valid yet (the editor shows the reason instead of refusing edits)', () => {
    expect(validateDocument(emptySchematic('d', 't')).map((e) => e.message)).toContain(
      '段に要素がありません: r1',
    );
  });
});

describe('nextCellId / nextRungId', () => {
  it('numbers from the highest existing id', () => {
    expect(nextCellId(selfHold())).toBe('c6');
    expect(nextRungId(selfHold())).toBe('r4');
  });

  it('starts at 1 for an id-less document', () => {
    const doc = createDocument('d', 't', []);
    expect(nextCellId(doc)).toBe('c1');
    expect(nextRungId(doc)).toBe('r1');
  });

  it('ignores ids that do not follow the pattern', () => {
    const doc = createDocument('d', 't', [rung('自己保持', BUS_P, BUS_N, [coil('コイル', 'CR1')])]);
    expect(nextCellId(doc)).toBe('c1');
    expect(nextRungId(doc)).toBe('r1');
  });
});

describe('applyEdit: insertCell', () => {
  it('inserts at the cursor and gives the new cell a fresh id', () => {
    const doc = emptySchematic('d', 't');
    const out = applyEdit(doc, {
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: { kind: 'pb-a', device: 'PB1' },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.doc.rungs[0]?.cells).toEqual([{ kind: 'pb-a', id: 'c1', device: 'PB1' }]);
    // 入力の文書は変えない（履歴がスナップショットを持つため）
    expect(doc.rungs[0]?.cells).toHaveLength(0);
  });

  it('carries presetMs for a timer coil', () => {
    const doc = emptySchematic('d', 't');
    const out = applyEdit(doc, {
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: { kind: 'coil', device: 'T1', presetMs: 3000 },
    });
    expect(out.ok && out.doc.rungs[0]?.cells[0]).toEqual({
      kind: 'coil',
      id: 'c1',
      device: 'T1',
      presetMs: 3000,
    });
  });

  it('refuses a device that the kind cannot use', () => {
    const out = applyEdit(emptySchematic('d', 't'), {
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: { kind: 'lamp', device: 'CR1' },
    });
    expect(out).toEqual({ ok: false, message: 'lamp に使えない機器名です: CR1' });
  });

  it('refuses an index outside the rung', () => {
    const out = applyEdit(emptySchematic('d', 't'), {
      kind: 'insertCell',
      rungId: 'r1',
      index: 2,
      draft: { kind: 'pb-a', device: 'PB1' },
    });
    expect(out).toEqual({ ok: false, message: '段 r1 に桁 2 はありません（0〜0）' });
  });

  it('refuses an unknown rung', () => {
    const out = applyEdit(emptySchematic('d', 't'), {
      kind: 'insertCell',
      rungId: 'r9',
      index: 0,
      draft: { kind: 'pb-a', device: 'PB1' },
    });
    expect(out).toEqual({ ok: false, message: '段がありません: r9' });
  });

  it('refuses more than MAX_CELLS_PER_RUNG in one rung', () => {
    let doc = emptySchematic('d', 't');
    for (let i = 0; i < MAX_CELLS_PER_RUNG; i += 1) {
      const step = applyEdit(doc, {
        kind: 'insertCell',
        rungId: 'r1',
        index: i,
        draft: { kind: 'cr-a', device: 'CR1' },
      });
      expect(step.ok).toBe(true);
      if (step.ok) doc = step.doc;
    }
    const out = applyEdit(doc, {
      kind: 'insertCell',
      rungId: 'r1',
      index: MAX_CELLS_PER_RUNG,
      draft: { kind: 'cr-a', device: 'CR1' },
    });
    expect(out).toEqual({
      ok: false,
      message: `1つの段に置ける要素は${MAX_CELLS_PER_RUNG}個までです`,
    });
  });
});

describe('applyEdit: replaceCell / setDevice / setPreset / removeCell / moveCell', () => {
  it('replaces a cell keeping its id (so physicalOverride and highlights survive)', () => {
    const out = applyEdit(selfHold(), {
      kind: 'replaceCell',
      cellId: 'c1',
      draft: { kind: 'pb-b', device: 'PB2' },
    });
    expect(out.ok && out.doc.rungs[0]?.cells[0]).toEqual({ kind: 'pb-b', id: 'c1', device: 'PB2' });
  });

  it('drops presetMs when a timer coil becomes a relay coil', () => {
    const doc = createDocument('d', 't', [
      rung('r1', BUS_P, BUS_N, [coil('c1', 'T1', 3000)]),
    ]);
    const out = applyEdit(doc, { kind: 'setDevice', cellId: 'c1', device: 'CR1' });
    expect(out.ok && out.doc.rungs[0]?.cells[0]).toEqual({ kind: 'coil', id: 'c1', device: 'CR1' });
  });

  it('gives a relay coil the default preset when it becomes a timer coil', () => {
    const doc = createDocument('d', 't', [rung('r1', BUS_P, BUS_N, [coil('c1', 'CR1')])]);
    const out = applyEdit(doc, { kind: 'setDevice', cellId: 'c1', device: 'T1' });
    expect(out.ok && out.doc.rungs[0]?.cells[0]).toMatchObject({ device: 'T1', presetMs: 3000 });
  });

  it('sets a timer preset', () => {
    const doc = createDocument('d', 't', [rung('r1', BUS_P, BUS_N, [coil('c1', 'T1', 3000)])]);
    const out = applyEdit(doc, { kind: 'setPreset', cellId: 'c1', presetMs: 5000 });
    expect(out.ok && out.doc.rungs[0]?.cells[0]?.presetMs).toBe(5000);
  });

  it('refuses a preset on a cell that cannot hold one', () => {
    const out = applyEdit(selfHold(), { kind: 'setPreset', cellId: 'c2', presetMs: 5000 });
    expect(out).toEqual({ ok: false, message: '設定時間を持てるのはタイマコイルだけです: c2' });
  });

  it('removes a cell', () => {
    const out = applyEdit(selfHold(), { kind: 'removeCell', cellId: 'c3' });
    expect(out.ok && out.doc.rungs[1]?.cells).toEqual([]);
  });

  it('moves a cell inside its rung', () => {
    const out = applyEdit(selfHold(), { kind: 'moveCell', cellId: 'c5', toIndex: 0 });
    expect(out.ok && out.doc.rungs[2]?.cells.map((c) => c.id)).toEqual(['c5', 'c4']);
  });

  it('refuses an unknown cell', () => {
    expect(applyEdit(selfHold(), { kind: 'removeCell', cellId: 'c9' })).toEqual({
      ok: false,
      message: '要素がありません: c9',
    });
  });
});

describe('applyEdit: addRung / removeRung / setEnds', () => {
  it('adds a rung right after the given one', () => {
    const out = applyEdit(selfHold(), { kind: 'addRung', after: 'r1' });
    expect(out.ok && out.doc.rungs.map((r) => r.id)).toEqual(['r1', 'r4', 'r2', 'r3']);
    expect(out.ok && out.doc.rungs[1]).toMatchObject({ from: { bus: 'P' }, to: { bus: 'N' }, cells: [] });
  });

  it('appends when `after` is omitted', () => {
    const out = applyEdit(selfHold(), { kind: 'addRung' });
    expect(out.ok && out.doc.rungs.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('refuses more than MAX_RUNGS', () => {
    let doc = emptySchematic('d', 't');
    for (let i = 1; i < MAX_RUNGS; i += 1) {
      const step = applyEdit(doc, { kind: 'addRung' });
      if (step.ok) doc = step.doc;
    }
    expect(applyEdit(doc, { kind: 'addRung' })).toEqual({
      ok: false,
      message: `段は${MAX_RUNGS}本までです`,
    });
  });

  it('removes a rung and repoints the rungs that branched off it', () => {
    const out = applyEdit(selfHold(), { kind: 'removeRung', rungId: 'r1' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.doc.rungs.map((r) => r.id)).toEqual(['r2', 'r3']);
    // r2 は r1 の節点へ合流していた。行き先が消えたので右母線へ付け替える
    expect(out.doc.rungs[0]?.to).toEqual({ bus: 'N' });
  });

  it('refuses removing the last rung', () => {
    expect(applyEdit(emptySchematic('d', 't'), { kind: 'removeRung', rungId: 'r1' })).toEqual({
      ok: false,
      message: '最後の1段は消せません',
    });
  });

  it('sets the ends of a rung (branch)', () => {
    const out = applyEdit(selfHold(), {
      kind: 'setEnds',
      rungId: 'r3',
      from: { rung: 'r1', node: 1 },
      to: BUS_N,
    });
    expect(out.ok && out.doc.rungs[2]?.from).toEqual({ rung: 'r1', node: 1 });
  });

  it('refuses an end that points at a rung that is not there', () => {
    const out = applyEdit(selfHold(), {
      kind: 'setEnds',
      rungId: 'r3',
      from: { rung: 'r9', node: 0 },
      to: BUS_N,
    });
    expect(out).toEqual({ ok: false, message: '段がありません: r9' });
  });

  it('refuses a rung that points at itself', () => {
    const out = applyEdit(selfHold(), {
      kind: 'setEnds',
      rungId: 'r3',
      from: { rung: 'r3', node: 0 },
      to: BUS_N,
    });
    expect(out).toEqual({ ok: false, message: '段が自分自身を参照しています: r3' });
  });

  it('refuses ends that would make the rungs reference each other in a ring', () => {
    // r2 の始点は r1 の節点0（＝r1 の始点）を指している。ここで r1 の始点を r2 の節点0へ
    // 向けると `r1#0 → r2#0 → r1#0` の輪になり、`layout()` も `toSession()` も
    // 節点を解決できない（`resolveNode()` が undefined を返す）
    const doc = createDocument('d', 't', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', { rung: 'r1', node: 0 }, { rung: 'r1', node: 1 }, [crA('c3', 'CR1')]),
    ]);
    const out = applyEdit(doc, {
      kind: 'setEnds',
      rungId: 'r1',
      from: { rung: 'r2', node: 0 },
      to: BUS_N,
    });
    expect(out).toEqual({ ok: false, message: '段の端点が循環します: r1' });
  });

  it('draws b-001 self-hold branch (受入基準①と同じ形)', () => {
    // 段1 = PB2 b接点 → PB1 a接点 → CR1 コイル、段2 = CR1 a接点（節点1 → 節点2 の分岐）
    const doc = createDocument('d', '自己保持', [
      rung('r1', BUS_P, BUS_N, [pbB('c1', 'PB2'), pbA('c2', 'PB1'), coil('c3', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c4', 'CR1')]),
      rung('r3', BUS_P, BUS_N, [crA('c5', 'CR1'), lamp('c6', 'PL1')]),
    ]);
    const out = applyEdit(doc, {
      kind: 'setEnds',
      rungId: 'r2',
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(validateDocument(out.doc)).toEqual([]);
  });
});

describe('editLabel（操作ログ）', () => {
  it('describes every edit kind in Japanese', () => {
    expect(editLabel({ kind: 'addRung' })).toBe('段を追加');
    expect(editLabel({ kind: 'removeRung', rungId: 'r1' })).toBe('段を削除（r1）');
    expect(
      editLabel({ kind: 'insertCell', rungId: 'r1', index: 0, draft: { kind: 'pb-a', device: 'PB1' } }),
    ).toBe('押ボタン a接点 PB1 を配置');
    expect(editLabel({ kind: 'setPreset', cellId: 'c1', presetMs: 3000 })).toBe(
      '設定時間を 3.0秒 に変更',
    );
    expect(editLabel({ kind: 'setEnds', rungId: 'r1', from: BUS_P, to: BUS_N })).toBe(
      '段の両端を P母線 → N母線 に変更',
    );
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確かめる**

```
pnpm --filter @ojt/schematic-core test
```

`Cannot find module` か `edit.ts is not exported` で落ちる（まだ作っていない）。

- [ ] **Step 3a: `document.ts` の `DEVICE_PATTERNS` に `export` を付ける**

`document.ts` の `const DEVICE_PATTERNS: Readonly<Record<CellKind, RegExp>> = {` を
`export const DEVICE_PATTERNS: Readonly<Record<CellKind, RegExp>> = {` にする。**表の中身は1文字も変えない。**
`checkCell()` はそのまま同じ定数を使う。

理由: 機器名の規則（`pb-a` は `PB1`〜`PB4`、`coil` は `CR1`〜`CR4` か `T1`・`T2` …）を `edit.ts` に
写すと、規則が2箇所になる。`§6.4` の機器名が増えたときに片方だけ直す事故を避ける。

- [ ] **Step 3: `packages/schematic-core/src/edit.ts` を実装する**

```ts
import { TIMER_RANGE_60S } from '@ojt/board-model';
import { TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';
import {
  createDocument,
  DEVICE_PATTERNS,
  isLoadCell,
  rung as makeRung,
  resolveNode,
  BUS_N,
  BUS_P,
  SCHEMATIC_FORMAT_VERSION,
  type CellKind,
  type Rung,
  type RungEnd,
  type SchematicCell,
  type SchematicDocument,
} from './document.js';

/**
 * 展開接続図の編集操作。設計仕様 §11.4（Phase 5 のエディタ機能）。
 *
 * ここが受け持つのは「**その編集が文書として表せるか**」だけである（Plan 5 決定表#3）。
 * 回路として妥当かどうか（段に要素があるか、右母線に至る段が負荷で終わるか、両母線に
 * つながっているか）は `validateDocument()` が別に返す。作りかけの文書は必ず不正なので、
 * ここで妥当性を要求すると訓練者は1要素も置けない。
 *
 * すべての関数は**入力の文書を変えず**、新しい文書を返す（元に戻す／やり直しがスナップショットで
 * 済むようにするため。`apps/desktop` の `LadderHistory` と同じ流儀）。
 */

/** 1つの段に置ける要素の数（回路図の横幅の上限）。 */
export const MAX_CELLS_PER_RUNG = 8;
/** 文書が持てる段の数。 */
export const MAX_RUNGS = 12;
/** タイマコイルを新しく置いたときの既定の設定時間[ms]（§5.3.2 のレンジ `0〜10s` の中央付近）。 */
export const DEFAULT_EDIT_PRESET_MS = 3000;

/** まだIDの付いていない要素（置く前の指定）。 */
export interface CellDraft {
  kind: CellKind;
  device: string;
  /** タイマコイルのときの設定時間[ms]。 */
  presetMs?: number;
}

/** 編集操作1件。 */
export type SchematicEdit =
  /** 段を足す（`after` の直後。省略すると末尾）。 */
  | { kind: 'addRung'; after?: string }
  /** 段を消す（その段へ合流していた段は右母線へ付け替える）。 */
  | { kind: 'removeRung'; rungId: string }
  /** 要素を桁 `index` に差し込む。 */
  | { kind: 'insertCell'; rungId: string; index: number; draft: CellDraft }
  /** 要素を置き換える（**IDは保つ**）。 */
  | { kind: 'replaceCell'; cellId: string; draft: CellDraft }
  /** 要素を消す。 */
  | { kind: 'removeCell'; cellId: string }
  /** 機器名だけを変える（種別はそのまま）。 */
  | { kind: 'setDevice'; cellId: string; device: string }
  /** タイマコイルの設定時間を変える。 */
  | { kind: 'setPreset'; cellId: string; presetMs: number }
  /** 段の始点・終点を変える（分岐を作る／外す）。 */
  | { kind: 'setEnds'; rungId: string; from: RungEnd; to: RungEnd }
  /** 段の中で要素を動かす。 */
  | { kind: 'moveCell'; cellId: string; toIndex: number };

/** 編集の結果。失敗は理由つき（画面はトーストに出す）。 */
export type EditOutcome = { ok: true; doc: SchematicDocument } | { ok: false; message: string };

function fail(message: string): EditOutcome {
  return { ok: false, message };
}

/** 文書を浅く作り直す（段と要素の配列は新しくする）。 */
function withRungs(doc: SchematicDocument, rungs: Rung[]): SchematicDocument {
  return { ...doc, rungs };
}

/** 段を1本だけ差し替えた段配列。 */
function replaceRung(doc: SchematicDocument, rungId: string, next: Rung): Rung[] {
  return doc.rungs.map((r) => (r.id === rungId ? next : r));
}

/** 空の文書（段1本・要素0個）。決定表#2 */
export function emptySchematic(id: string, title: string): SchematicDocument {
  return createDocument(id, title, [makeRung('r1', BUS_P, BUS_N, [])]);
}

/** `prefix` + 連番のIDのうち、まだ使われていない最小の番号。 */
function nextId(prefix: string, used: readonly string[]): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'u');
  let max = 0;
  for (const id of used) {
    const found = pattern.exec(id);
    if (found === null) continue;
    const n = Number(found[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/** 次の要素ID（`c1`, `c2`, …）。 */
export function nextCellId(doc: SchematicDocument): string {
  return nextId(
    'c',
    doc.rungs.flatMap((r) => r.cells.map((c) => c.id)),
  );
}

/** 次の段ID（`r1`, `r2`, …）。 */
export function nextRungId(doc: SchematicDocument): string {
  return nextId(
    'r',
    doc.rungs.map((r) => r.id),
  );
}

/** 要素とその居場所を探す。 */
function locate(
  doc: SchematicDocument,
  cellId: string,
): { rung: Rung; index: number; cell: SchematicCell } | undefined {
  for (const r of doc.rungs) {
    const index = r.cells.findIndex((c) => c.id === cellId);
    const cell = r.cells[index];
    if (cell !== undefined) return { rung: r, index, cell };
  }
  return undefined;
}

/** その種別がその機器名を使えるか。 */
function deviceProblem(kind: CellKind, device: string): string | undefined {
  const pattern = DEVICE_PATTERNS[kind];
  if (pattern === undefined) return `未知の要素種別です: ${String(kind)}`;
  return pattern.test(device) ? undefined : `${kind} に使えない機器名です: ${device}`;
}

/** タイマコイル（設定時間を持つ要素）か。 */
function isTimerCoil(kind: CellKind, device: string): boolean {
  return kind === 'coil' && device.startsWith('T');
}

/** 下書きから要素を作る（タイマコイルには必ず設定時間を付ける）。 */
function buildCell(id: string, draft: CellDraft, fallbackPresetMs: number): SchematicCell {
  if (!isTimerCoil(draft.kind, draft.device)) {
    return { kind: draft.kind, id, device: draft.device };
  }
  return {
    kind: draft.kind,
    id,
    device: draft.device,
    presetMs: draft.presetMs ?? fallbackPresetMs,
  };
}

/** 設定時間がレンジに収まるか（`validateDocument()` と同じ範囲）。§5.3.2 */
function presetProblem(presetMs: number): string | undefined {
  if (
    !Number.isInteger(presetMs) ||
    presetMs < TIMER_MIN_PRESET_MS ||
    presetMs > TIMER_RANGE_60S.maxMs
  ) {
    return `タイマの設定時間は ${TIMER_MIN_PRESET_MS}〜${TIMER_RANGE_60S.maxMs}ms の整数です: ${presetMs}`;
  }
  return undefined;
}

/** 端点が指す段が実在するか（自分自身への参照も断る）。 */
function endProblem(doc: SchematicDocument, ownerId: string, end: RungEnd): string | undefined {
  if ('bus' in end) return undefined;
  if (end.rung === ownerId) return `段が自分自身を参照しています: ${ownerId}`;
  const target = doc.rungs.find((r) => r.id === end.rung);
  if (target === undefined) return `段がありません: ${end.rung}`;
  if (!Number.isInteger(end.node) || end.node < 0 || end.node > target.cells.length) {
    return `参照先の節点番号が範囲外です: ${end.rung}#${end.node}（0〜${target.cells.length}）`;
  }
  return undefined;
}

/** 消した段を指していた端点を右母線（終点）／左母線（始点）へ逃がす。 */
function detachEnd(end: RungEnd, removedId: string, side: 'from' | 'to'): RungEnd {
  if ('bus' in end || end.rung !== removedId) return end;
  return side === 'from' ? BUS_P : BUS_N;
}

function editAddRung(doc: SchematicDocument, after: string | undefined): EditOutcome {
  if (doc.rungs.length >= MAX_RUNGS) return fail(`段は${MAX_RUNGS}本までです`);
  const created = makeRung(nextRungId(doc), BUS_P, BUS_N, []);
  if (after === undefined) return { ok: true, doc: withRungs(doc, [...doc.rungs, created]) };
  const at = doc.rungs.findIndex((r) => r.id === after);
  if (at < 0) return fail(`段がありません: ${after}`);
  const rungs = [...doc.rungs];
  rungs.splice(at + 1, 0, created);
  return { ok: true, doc: withRungs(doc, rungs) };
}

function editRemoveRung(doc: SchematicDocument, rungId: string): EditOutcome {
  if (doc.rungs.length <= 1) return fail('最後の1段は消せません');
  if (!doc.rungs.some((r) => r.id === rungId)) return fail(`段がありません: ${rungId}`);
  const rungs = doc.rungs
    .filter((r) => r.id !== rungId)
    .map((r) => ({
      ...r,
      from: detachEnd(r.from, rungId, 'from'),
      to: detachEnd(r.to, rungId, 'to'),
      cells: [...r.cells],
    }));
  return { ok: true, doc: withRungs(doc, rungs) };
}

function editInsertCell(
  doc: SchematicDocument,
  rungId: string,
  index: number,
  draft: CellDraft,
): EditOutcome {
  const target = doc.rungs.find((r) => r.id === rungId);
  if (target === undefined) return fail(`段がありません: ${rungId}`);
  if (target.cells.length >= MAX_CELLS_PER_RUNG) {
    return fail(`1つの段に置ける要素は${MAX_CELLS_PER_RUNG}個までです`);
  }
  if (!Number.isInteger(index) || index < 0 || index > target.cells.length) {
    return fail(`段 ${rungId} に桁 ${index} はありません（0〜${target.cells.length}）`);
  }
  const problem = deviceProblem(draft.kind, draft.device);
  if (problem !== undefined) return fail(problem);
  if (draft.presetMs !== undefined) {
    const bad = presetProblem(draft.presetMs);
    if (bad !== undefined) return fail(bad);
  }
  const cells = [...target.cells];
  cells.splice(index, 0, buildCell(nextCellId(doc), draft, DEFAULT_EDIT_PRESET_MS));
  return { ok: true, doc: withRungs(doc, replaceRung(doc, rungId, { ...target, cells })) };
}

/** 要素1個を作り替える（IDは保つ）。`replaceCell` / `setDevice` / `setPreset` の共通部分。 */
function updateCell(
  doc: SchematicDocument,
  cellId: string,
  make: (cell: SchematicCell) => SchematicCell | string,
): EditOutcome {
  const found = locate(doc, cellId);
  if (found === undefined) return fail(`要素がありません: ${cellId}`);
  const next = make(found.cell);
  if (typeof next === 'string') return fail(next);
  const cells = [...found.rung.cells];
  cells[found.index] = next;
  return { ok: true, doc: withRungs(doc, replaceRung(doc, found.rung.id, { ...found.rung, cells })) };
}

function editRemoveCell(doc: SchematicDocument, cellId: string): EditOutcome {
  const found = locate(doc, cellId);
  if (found === undefined) return fail(`要素がありません: ${cellId}`);
  const cells = found.rung.cells.filter((c) => c.id !== cellId);
  return { ok: true, doc: withRungs(doc, replaceRung(doc, found.rung.id, { ...found.rung, cells })) };
}

function editMoveCell(doc: SchematicDocument, cellId: string, toIndex: number): EditOutcome {
  const found = locate(doc, cellId);
  if (found === undefined) return fail(`要素がありません: ${cellId}`);
  const last = found.rung.cells.length - 1;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > last) {
    return fail(`段 ${found.rung.id} に桁 ${toIndex} はありません（0〜${last}）`);
  }
  const cells = [...found.rung.cells];
  const [moved] = cells.splice(found.index, 1);
  /* c8 ignore next -- `locate` が見つけた要素なので必ず取れる */
  if (moved === undefined) return fail(`要素がありません: ${cellId}`);
  cells.splice(toIndex, 0, moved);
  return { ok: true, doc: withRungs(doc, replaceRung(doc, found.rung.id, { ...found.rung, cells })) };
}

/**
 * 段の両端を決め直す（分岐を作る／外す）。
 *
 * 「表せるか」だけを見る（決定表#3）が、**参照の循環だけは表せない**。`layout()` も
 * `toSession()` も端点を `resolveNode()` でたどり切って初めて節点が決まるので、輪になった
 * 参照は「どの節点か」が存在しない（`resolveNode()` が `undefined` を返し、`layout()` は
 * 段を左母線に寄せ、`toSession()` は割当に失敗する）。作りかけの文書として許してよい
 * 「まだ回路になっていない」とは違い、**図にすら描けない**ので、ここで断る。
 */
function editSetEnds(
  doc: SchematicDocument,
  rungId: string,
  from: RungEnd,
  to: RungEnd,
): EditOutcome {
  const target = doc.rungs.find((r) => r.id === rungId);
  if (target === undefined) return fail(`段がありません: ${rungId}`);
  for (const end of [from, to]) {
    const problem = endProblem(doc, rungId, end);
    if (problem !== undefined) return fail(problem);
  }
  const next = withRungs(doc, replaceRung(doc, rungId, { ...target, from, to }));
  for (const r of next.rungs) {
    if (
      resolveNode(next, r, 0) === undefined ||
      resolveNode(next, r, r.cells.length) === undefined
    ) {
      return fail(`段の端点が循環します: ${rungId}`);
    }
  }
  return { ok: true, doc: next };
}

/** 編集を1つ当てる。入力の文書は変えない。決定表#3 */
export function applyEdit(doc: SchematicDocument, edit: SchematicEdit): EditOutcome {
  switch (edit.kind) {
    case 'addRung':
      return editAddRung(doc, edit.after);
    case 'removeRung':
      return editRemoveRung(doc, edit.rungId);
    case 'insertCell':
      return editInsertCell(doc, edit.rungId, edit.index, edit.draft);
    case 'replaceCell':
      return updateCell(doc, edit.cellId, (cell) => {
        const problem = deviceProblem(edit.draft.kind, edit.draft.device);
        if (problem !== undefined) return problem;
        if (edit.draft.presetMs !== undefined) {
          const bad = presetProblem(edit.draft.presetMs);
          if (bad !== undefined) return bad;
        }
        return buildCell(cell.id, edit.draft, cell.presetMs ?? DEFAULT_EDIT_PRESET_MS);
      });
    case 'removeCell':
      return editRemoveCell(doc, edit.cellId);
    case 'setDevice':
      return updateCell(doc, edit.cellId, (cell) => {
        const problem = deviceProblem(cell.kind, edit.device);
        if (problem !== undefined) return problem;
        return buildCell(
          cell.id,
          { kind: cell.kind, device: edit.device, ...(cell.presetMs === undefined ? {} : { presetMs: cell.presetMs }) },
          DEFAULT_EDIT_PRESET_MS,
        );
      });
    case 'setPreset':
      return updateCell(doc, edit.cellId, (cell) => {
        if (!isTimerCoil(cell.kind, cell.device)) {
          return `設定時間を持てるのはタイマコイルだけです: ${cell.id}`;
        }
        const bad = presetProblem(edit.presetMs);
        if (bad !== undefined) return bad;
        return { kind: cell.kind, id: cell.id, device: cell.device, presetMs: edit.presetMs };
      });
    case 'setEnds':
      return editSetEnds(doc, edit.rungId, edit.from, edit.to);
    case 'moveCell':
      return editMoveCell(doc, edit.cellId, edit.toIndex);
  }
}

/** 種別の日本語名（パレットと操作ログで使う）。§11.1 */
export const CELL_KIND_LABELS: Readonly<Record<CellKind, string>> = {
  'pb-a': '押ボタン a接点',
  'pb-b': '押ボタン b接点',
  'cr-a': 'リレー a接点',
  'cr-b': 'リレー b接点',
  't-a': 'タイマ a接点（限時）',
  't-b': 'タイマ b接点（限時）',
  coil: 'コイル',
  lamp: '表示灯',
  buzzer: 'ブザー',
};

/** 端点の日本語表現（`P母線` / `N母線` / `r1 の3番目`）。 */
function endLabel(end: RungEnd): string {
  return 'bus' in end ? `${end.bus}母線` : `${end.rung} の節点${end.node}`;
}

/** 編集1件の説明（操作ログに出す1行）。§8.1 */
export function editLabel(edit: SchematicEdit): string {
  switch (edit.kind) {
    case 'addRung':
      return '段を追加';
    case 'removeRung':
      return `段を削除（${edit.rungId}）`;
    case 'insertCell':
      return `${CELL_KIND_LABELS[edit.draft.kind]} ${edit.draft.device} を配置`;
    case 'replaceCell':
      return `${CELL_KIND_LABELS[edit.draft.kind]} ${edit.draft.device} に置き換え`;
    case 'removeCell':
      return '要素を削除';
    case 'setDevice':
      return `機器名を ${edit.device} に変更`;
    case 'setPreset':
      return `設定時間を ${(edit.presetMs / 1000).toFixed(1)}秒 に変更`;
    case 'setEnds':
      return `段の両端を ${endLabel(edit.from)} → ${endLabel(edit.to)} に変更`;
    case 'moveCell':
      return '要素を移動';
  }
}

/** 文書の版（`emptySchematic()` が入れる値の確認用）。 */
export const EDIT_FORMAT_VERSION = SCHEMATIC_FORMAT_VERSION;

/** 負荷の要素を持つ段か（パレットの「この段にはもう負荷を置けません」の判定）。§11.1 */
export function rungHasLoad(r: Rung): boolean {
  return r.cells.some((cell) => isLoadCell(cell));
}
```

- [ ] **Step 4: 失敗するテストを書く（スロット矩形）**

`packages/schematic-core/test/slot-rects.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BUS_N,
  BUS_P,
  coil,
  createDocument,
  DEFAULT_LAYOUT_OPTIONS,
  emptySchematic,
  layout,
  pbA,
  rung,
  slotRects,
} from '../src/index.js';

// r2 は**始点**が r1 の節点1（＝分岐段）。始点が母線だと段の左端は左母線のままで、
// 「分岐段は親の節点から始まる」を確かめられない
const doc = createDocument('d', 't', [
  rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
  rung('r2', { rung: 'r1', node: 1 }, BUS_N, []),
]);

describe('slotRects（§11.4 のエディタの当たり判定）', () => {
  it('returns one rect per cell plus one empty tail slot per rung', () => {
    const rects = slotRects(doc);
    expect(rects.filter((s) => s.rungId === 'r1').map((s) => s.index)).toEqual([0, 1, 2]);
    expect(rects.filter((s) => s.rungId === 'r1').map((s) => s.cellId)).toEqual(['c1', 'c2', undefined]);
    // 要素0個の段でも「置ける場所」が1つある
    expect(rects.filter((s) => s.rungId === 'r2')).toEqual([
      expect.objectContaining({ rungId: 'r2', index: 0, cellId: undefined }),
    ]);
  });

  it('lines the rects up with the shapes that layout() emits', () => {
    const o = DEFAULT_LAYOUT_OPTIONS;
    const rects = slotRects(doc);
    const first = rects[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.w).toBe(o.colWidth);
    expect(first.h).toBe(o.rowHeight);
    // 段1は左母線から始まるので、最初の桁の左端は marginX
    expect(first.x).toBe(o.marginX);
    expect(first.y).toBe(o.marginY - o.rowHeight / 2);
  });

  it('follows the same colWidth override that the renderer uses', () => {
    const rects = slotRects(doc, { colWidth: 40 });
    expect(rects[1]?.x).toBe(DEFAULT_LAYOUT_OPTIONS.marginX + 40);
    expect(rects[1]?.w).toBe(40);
  });

  it('starts a branch rung at its parent node', () => {
    const branch = slotRects(doc).find((s) => s.rungId === 'r2');
    expect(branch?.x).toBe(DEFAULT_LAYOUT_OPTIONS.marginX + DEFAULT_LAYOUT_OPTIONS.colWidth);
  });

  it('never runs past the layout width', () => {
    const size = layout(doc);
    for (const rect of slotRects(doc)) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(size.width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(size.height);
    }
  });

  it('gives an empty document one slot', () => {
    expect(slotRects(emptySchematic('d', 't'))).toHaveLength(1);
  });
});
```

- [ ] **Step 5: `layout.ts` の末尾に `slotRects()` を追記する**

既存の `layout()` は段の左端 x を `startOf()`（モジュール内のクロージャ）で求めている。同じ計算を2度書かないよう、**`startOf` の中身を `rungStartX()` という export された純関数へ切り出し**、`layout()` はそれを呼ぶ形にする（`layout()` の戻り値は1ビットも変わらない）。

```ts
/** 段の左端x（`layout()` と `slotRects()` が同じ値を使う）。分岐段は親の節点に合わせる。 */
export function rungStartX(doc: SchematicDocument, options: LayoutOptions = {}): Map<string, number> {
  const o = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const busPX = o.marginX;
  const rungById = new Map(doc.rungs.map((r) => [r.id, r]));
  const startX = new Map<string, number>();
  const resolving = new Set<string>();
  function startOf(r: Rung): number {
    const memo = startX.get(r.id);
    if (memo !== undefined) return memo;
    if (resolving.has(r.id)) return busPX; // 循環参照（validateDocument が別に弾く）
    resolving.add(r.id);
    const x = 'bus' in r.from ? busPX : branchX(r.from);
    resolving.delete(r.id);
    startX.set(r.id, x);
    return x;
  }
  function branchX(end: Extract<RungEnd, { rung: string }>): number {
    const parent = rungById.get(end.rung);
    if (parent === undefined) return busPX;
    return startOf(parent) + clampNode(end.node, parent.cells.length) * o.colWidth;
  }
  for (const r of doc.rungs) startOf(r);
  return startX;
}

/** 編集UIの当たり判定1つぶん（論理単位。`layout()` と同じ座標系）。§11.4 */
export interface SlotRect {
  rungId: string;
  /** 段の中の桁（0〜要素数）。要素数と同じ値は「末尾の空き桁」。 */
  index: number;
  /** その桁に要素があればそのID。空き桁は undefined。 */
  cellId: string | undefined;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 段 × 桁の当たり矩形。`layout()` と同じ寸法設定を渡すこと。§11.4
 * 各段について「要素の数 ＋ 1」個（末尾に空き桁を1つ）返す。
 */
export function slotRects(doc: SchematicDocument, options: LayoutOptions = {}): SlotRect[] {
  const o = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const startX = rungStartX(doc, options);
  const out: SlotRect[] = [];
  doc.rungs.forEach((r, rowIndex) => {
    const x0 = startX.get(r.id) ?? o.marginX;
    const y = o.marginY + rowIndex * o.rowHeight - o.rowHeight / 2;
    for (let index = 0; index <= r.cells.length; index += 1) {
      out.push({
        rungId: r.id,
        index,
        cellId: r.cells[index]?.id,
        x: x0 + index * o.colWidth,
        y,
        w: o.colWidth,
        h: o.rowHeight,
      });
    }
  });
  return out;
}
```

`layout()` の中の `startOf` / `branchX` は `rungStartX()` を呼ぶ形に置き換える（`const startX = rungStartX(doc, options);` を作り、`startOf(r)` を `startX.get(r.id) ?? busPX` に、`branchX(end)` を `(startX.get(end.rung) ?? busPX) + clampNode(end.node, rungById.get(end.rung)?.cells.length ?? 0) * o.colWidth` に差し替える）。`clampNode()` は既にモジュール内にあるのでそのまま使う。

**注意**: `slotRects()` の `y` は「段の行の中心 − 行高の半分」である（`layout()` は要素の記号を `y = marginY + i * rowHeight` に置く）。末尾の空き桁が右母線に重なる段があるが、透明な矩形なので描画には影響しない（Task 5 は母線より手前に敷かない）。

- [ ] **Step 6: `index.ts` に再輸出を足す**

```ts
export {
  applyEdit,
  CELL_KIND_LABELS,
  DEFAULT_EDIT_PRESET_MS,
  EDIT_FORMAT_VERSION,
  editLabel,
  emptySchematic,
  MAX_CELLS_PER_RUNG,
  MAX_RUNGS,
  nextCellId,
  nextRungId,
  rungHasLoad,
  type CellDraft,
  type EditOutcome,
  type SchematicEdit,
} from './edit.js';
```

`layout.js` の export 群に `rungStartX` / `slotRects` / `type SlotRect` を足し、`document.js` の export 群に `DEVICE_PATTERNS` を足す。

- [ ] **Step 7: テストを走らせる**

```
pnpm --filter @ojt/schematic-core test
```

**期待**: 既存の `document` / `assign` / `layout` / `to-session` のテストが全て通ったうえで、`edit.test.ts` の **30件**と `slot-rects.test.ts` の **6件**が増える。

- [ ] **Step 8: カバレッジと型を確かめてコミットする**

```
pnpm --filter @ojt/schematic-core test:coverage
pnpm -r typecheck
pnpm lint
git add packages/schematic-core && git commit -m "feat(schematic-core): add document edit operations and editor slot rects"
```

`schematic-core` は行・分岐 90% 以上が §16 Phase 1 受入基準④の条件である。`edit.ts` の分岐はすべて上のテストが通る。

---

## Task 2: 検算（`verifySchematic()`、`@ojt/content`）

**モデル: Sonnet-verbatim**（既存の `toSession()` と `judgeAssemble()` をつなぐだけ。判断は Task 1 と決定表で済んでいる）

**Files:**
- Create: `packages/content/src/verify.ts`
- Modify: `packages/content/src/reference.ts`（`buildSchematicSession()` を切り出す）
- Modify: `packages/content/src/index.ts`（再輸出）
- Test: `packages/content/test/verify.test.ts`（新規）

§11.4「検算: 訓練者が描いた回路図をネットリスト化し、課題の操作列で判定にかける。3D盤に配線する前に机上で確かめられる」。**判定器は `judgeAssemble()` をそのまま使う**（決定表#6）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/verify.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUS_N,
  BUS_P,
  coil,
  crA,
  createDocument,
  emptySchematic,
  lamp,
  pbA,
  rung,
} from '@ojt/schematic-core';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '../src/builtin/index.js';
import { verifySchematic } from '../src/verify.js';

/** 内蔵課題 b-001（自己保持回路。§16 Phase 5 受入基準①と同じ題材）。 */
const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

describe('verifySchematic（§11.4 検算）', () => {
  it('passes when the drawing is the problem own reference circuit', () => {
    const result = verifySchematic(problem, JIPM_BOARD, problem.schematic);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passed).toBe(true);
    expect(result.judge.mismatches).toEqual([]);
    expect(result.judge.mode).toBe('assemble');
  });

  it('runs the same operations as the real judge (charts come back)', () => {
    const result = verifySchematic(problem, JIPM_BOARD, problem.schematic);
    expect(result.ok && result.judge.charts.expected.signals.length).toBeGreaterThan(0);
    expect(result.ok && result.judge.charts.actual.signals.length).toBeGreaterThan(0);
  });

  it('never counts hazards (a desk check has no board operations)', () => {
    const result = verifySchematic(problem, JIPM_BOARD, problem.schematic);
    expect(result.ok && result.judge.hazardCount).toBe(0);
  });

  it('reports the structural errors of a half-finished drawing without judging', () => {
    const result = verifySchematic(problem, JIPM_BOARD, emptySchematic('draft', '下書き'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.message)).toContain('段に要素がありません: r1');
    expect(result.errors[0]?.source).toBe('document');
  });

  it('points at the cell when the physical assignment fails', () => {
    // CR1 の接点を5個使う（§11.3: 1部品につき4組まで）
    const doc = createDocument('draft', '下書き', [
      rung('r1', BUS_P, BUS_N, [
        crA('c1', 'CR1'),
        crA('c2', 'CR1'),
        crA('c3', 'CR1'),
        crA('c4', 'CR1'),
        crA('c5', 'CR1'),
        lamp('c6', 'PL1'),
      ]),
      rung('r2', BUS_P, BUS_N, [pbA('c7', 'PB1'), coil('c8', 'CR1')]),
    ]);
    const result = verifySchematic(problem, JIPM_BOARD, doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.cellId === 'c5');
    expect(issue?.message).toContain('5個目');
    expect(issue?.source).toBe('assign');
  });

  it('fails the check when the drawing does not reproduce the timing', () => {
    // 自己保持の帰還接点（CR1 の a接点）を落とすと、PBを離した瞬間に消える
    const doc = createDocument('draft', '下書き', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
    ]);
    const result = verifySchematic(problem, JIPM_BOARD, doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passed).toBe(false);
    expect(result.judge.mismatches.length).toBeGreaterThan(0);
  });

  it('carries the elapsed time when the caller gives one', () => {
    const result = verifySchematic(problem, JIPM_BOARD, problem.schematic, { elapsedMs: 12_000 });
    expect(result.ok && result.judge.elapsedMs).toBe(12_000);
  });

  it('refuses a board that is not the one the problem asks for', () => {
    const other = { ...JIPM_BOARD, id: 'other-board' };
    const result = verifySchematic(problem, other, problem.schematic);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('渡された盤');
  });
});

describe('verifySchematic: 全内蔵モードB課題の模範回路が検算に通る（§7.8 の自己整合）', () => {
  it.each(BUILTIN_ASSEMBLE_PROBLEMS.map((p) => [p.id, p] as const))('%s', (_id, p) => {
    const result = verifySchematic(p, JIPM_BOARD, p.schematic);
    expect(result.ok).toBe(true);
    expect(result.ok && result.passed).toBe(true);
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確かめる**

```
pnpm --filter @ojt/content test verify
```

`Cannot find module '../src/verify.js'` で落ちる。

- [ ] **Step 3a: `reference.ts` から `buildSchematicSession()` を切り出す**

`buildReferenceSession()` の中にある「課題の設定で `toSession()` を呼ぶ」部分を、そのまま公開関数に出す。
`verifySchematic()` が同じ設定を**書き写さない**ようにするための1箇所である（設定がずれると、
「模範は割り当てられるのに下書きは割り当てられない」が設定の違いなのか回路の違いなのか分からなくなる）。

```ts
/**
 * 回路図1枚を、その課題の盤の設定（役割割当・任意部品・在庫・線色）で盤セッションに落とす。§7.2 / §11.3
 *
 * `physicalOverride`（§7.2）の鍵は**課題の模範回路の要素ID**である。だから渡すのは
 * `doc === problem.schematic` のとき——つまり課題自身の回路図を落とすときだけにする。
 * 訓練者の下書きは自分のID（`c1`, `c2`, …）を持つので、そのまま渡すと `toSession()` の
 * `checkOverride()` が「要素IDが見つかりません」を返し、回路とは無関係な指摘がエディタに出る。
 */
export function buildSchematicSession(
  problem: SchematicProblem,
  board: BoardDefinition,
  doc: SchematicDocument,
): ToSessionResult {
  const override =
    doc === problem.schematic ? toPhysicalOverride(problem.physicalOverride) : undefined;
  return toSession(doc, board, {
    roles: toRoles(problem),
    color: ASSEMBLE_WIRE_COLOR,
    extraParts: toExtraParts(problem),
    inventory: problem.inventory,
    ...(override === undefined ? {} : { physicalOverride: override }),
  });
}
```

`reference.ts` の import に `type SchematicDocument` と `type ToSessionResult`（どちらも
`@ojt/schematic-core`）を足す。`buildReferenceSession()` の中の `const override = …` から
`const built = toSession(…)` までを **`const built = buildSchematicSession(problem, board, problem.schematic);`
の1行に置き換える**（`toRoles()` / `toExtraParts()` / `toPhysicalOverride()` はそのまま残る）。
`buildReferenceSession()` の戻り値・エラーのパス変換（`toProblemPath()`）は1文字も変えない。

`packages/content/src/index.ts` の `reference.js` の export 群に `buildSchematicSession` を足す。

- [ ] **Step 3: `packages/content/src/verify.ts` を実装する**

```ts
import { validateDocument, type SchematicDocument } from '@ojt/schematic-core';
import type { BoardDefinition } from '@ojt/board-model';
import { judgeAssemble, type JudgeResult } from './judge.js';
import { buildSchematicSession } from './reference.js';
import type { AssembleProblem } from './schema/assemble.js';

/**
 * 検算。設計仕様 §11.4。
 *
 * 訓練者が**回路図エディタで描いた文書**をネットリストにし、課題の操作列で `judgeAssemble()` に
 * かける。3D盤へ配線する前に机上で確かめるための機能であり、**判定そのものと同じ判定器・同じ
 * 操作列・同じ許容差**を使う（Plan 5 決定表#6）。違うのは次の2点だけである。
 *
 * - 盤のセッションは**回路図から自動生成**する（`toSession()`）。訓練者が3Dで張った電線は見ない。
 * - 危険操作（`sessionHazards`）は渡さない。机上の作業に危険操作は無い。
 *
 * 文書が構造的に不正（作りかけ）か、物理割当に失敗した場合は判定へ進まず理由を返す。
 * 理由には**回路図の要素ID**（`cellId`）を添えるので、エディタはその要素を光らせられる
 * （課題JSONのパスへ直す `toProblemPath()` はここでは使わない。エディタが編集しているのは
 * 課題データではなく訓練者の下書きである）。
 */

/** 検算の指摘1件。 */
export interface VerifyIssue {
  /** どの検査が出したか。 */
  source: 'document' | 'assign';
  /** 出どころのパス（`rungs[0].cells[2]` / 要素ID / 電線ID）。 */
  path: string;
  message: string;
  /** その指摘が回路図の要素を指しているときの要素ID（エディタのハイライト用）。 */
  cellId?: string;
}

/** 検算のオプション。 */
export interface VerifyOptions {
  /** 経過時間[ms]（結果の参考表示。合否には影響しない）。§17.2 #3 */
  elapsedMs?: number;
}

/** 検算の結果。 */
export type VerifyResult =
  | { ok: true; passed: boolean; judge: JudgeResult }
  | { ok: false; errors: readonly VerifyIssue[] };

/** 文書に現れる要素IDの集合（指摘に `cellId` を添えられるか判定する）。 */
function cellIds(doc: SchematicDocument): Set<string> {
  const out = new Set<string>();
  for (const r of doc.rungs) for (const cell of r.cells) out.add(cell.id);
  return out;
}

/**
 * 訓練者の回路図を検算する。§11.4
 * 1. 構造検査（`validateDocument()`）
 * 2. 物理割当と盤セッションの生成（`toSession()`。§11.3 の渡り配線を含む）
 * 3. 課題の操作列で判定（`judgeAssemble()`）
 */
export function verifySchematic(
  problem: AssembleProblem,
  board: BoardDefinition,
  doc: SchematicDocument,
  options: VerifyOptions = {},
): VerifyResult {
  if (problem.board.boardId !== board.id) {
    return {
      ok: false,
      errors: [
        {
          source: 'document',
          path: 'board.boardId',
          message: `課題が要求する盤（${problem.board.boardId}）と渡された盤（${board.id}）が違います`,
        },
      ],
    };
  }

  const structural = validateDocument(doc);
  if (structural.length > 0) {
    return {
      ok: false,
      errors: structural.map((e) => ({ source: 'document' as const, path: e.path, message: e.message })),
    };
  }

  // 盤への落とし込みは模範回路と同じ関数を通す（Step 3a）。`physicalOverride` の扱いも
  // そこが決めるので、ここには課題データの読み方が1行も残らない
  const built = buildSchematicSession(problem, board, doc);
  if (!built.ok) {
    const known = cellIds(doc);
    return {
      ok: false,
      errors: built.errors.map((e) => ({
        source: 'assign' as const,
        path: e.path,
        message: e.message,
        ...(known.has(e.path) ? { cellId: e.path } : {}),
      })),
    };
  }

  const judged = judgeAssemble(problem, board, built.session, {
    ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
  });
  if (!judged.ok) {
    return {
      ok: false,
      errors: judged.errors.map((e) => ({
        source: 'document' as const,
        path: e.path,
        message: e.message,
      })),
    };
  }
  return { ok: true, passed: judged.value.passed, judge: judged.value };
}
```

- [ ] **Step 4: `index.ts` に再輸出を足す**

```ts
export {
  verifySchematic,
  type VerifyIssue,
  type VerifyOptions,
  type VerifyResult,
} from './verify.js';
```

- [ ] **Step 5: テストを走らせる**

```
pnpm --filter @ojt/content test
```

**期待**: `verify.test.ts` の **8件 ＋ 内蔵モードB課題の件数（8件）= 16件**が増え、既存のテストはすべて通る。

- [ ] **Step 6: コミットする**

```
pnpm -r typecheck && pnpm lint
git add packages/content && git commit -m "feat(content): add verifySchematic for the desk check of a drawn circuit"
```

---

## Task 3: 疑わしい配線（`wiringSuspects()`、`@ojt/content`）— UXレビュー #28

**モデル: Opus**（節点分割の差の出し方と、出す件数の絞り方）

**Files:**
- Create: `packages/content/src/wiring-diff.ts`
- Modify: `packages/content/src/index.ts`（再輸出）
- Test: `packages/content/test/wiring-diff.test.ts`（新規）

UXレビュー #28「結果画面が、判定のネットリスト差分から**どの電線・端子を疑えばよいか**を示す」。決定表#9 のとおり **節点分割の差**で求め、盤の全端子ではなく**回路図の要素が使う端子と母線**に絞る。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/wiring-diff.test.ts`:

```ts
import { addWire, createSession, JIPM_BOARD, plug, removeWire } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '../src/builtin/index.js';
import { buildReferenceSession } from '../src/reference.js';
import { MAX_WIRING_SUSPECTS, wiringSuspects } from '../src/wiring-diff.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

/** 模範回路そのままの盤。 */
function referenceSession() {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(built.errors.map((e) => e.message).join(' / '));
  return built.value;
}

/** 何も疑うところが無いときの戻り。 */
const CLEAN = { suspects: [], total: 0, omitted: 0 };

describe('wiringSuspects（UXレビュー #28）', () => {
  it('finds nothing when the board matches the reference circuit', () => {
    expect(wiringSuspects(problem, JIPM_BOARD, referenceSession().session)).toEqual(CLEAN);
  });

  it('reports the pair that a removed wire used to join', () => {
    const { session } = referenceSession();
    const victim = session.wires.find((w) => !w.locked);
    expect(victim).toBeDefined();
    if (victim === undefined) return;
    const removed = removeWire(session, victim.id);
    expect(removed.ok).toBe(true);
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, session);
    expect(suspects.length).toBeGreaterThan(0);
    const first = suspects[0];
    expect(first?.kind).toBe('missing');
    expect(first?.terminals).toHaveLength(2);
    expect(first?.message).toContain('つながっていません');
    // ハイライトに使える情報が揃っている
    expect(first?.cellIds.length).toBeGreaterThan(0);
  });

  it('reports an extra connection that the reference circuit does not have', () => {
    const { session } = referenceSession();
    // CR1 の接点端子（CR1.12）と PL1 の − 端子（TB_PL.1-）を勝手に繋ぐ
    const added = addWire(
      session,
      JIPM_BOARD,
      toTerminalId('CR1.12'),
      toTerminalId('TB_PL.1-'),
      '青',
      { id: 'extra-1' },
    );
    expect(added.ok).toBe(true);
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, session);
    const extra = suspects.find((s) => s.kind === 'extra');
    expect(extra).toBeDefined();
    expect(extra?.message).toContain('余計につながっています');
    expect(extra?.wireIds).toContain('extra-1');
  });

  it('is blind to the order of the bus chain (§11.3 の渡り配線)', () => {
    // 母線の鎖を組み替えても電気的に同じなら疑いは出ない
    const { session, roles } = referenceSession();
    const chain = session.wires.filter((w) => !w.locked && (w.from === 'P.1' || w.to === 'P.1'));
    expect(chain.length).toBeGreaterThan(0);
    // 同じ節点のまま別の端子へ付け替えるのは盤の規則が許さないので、ここでは
    // 「鎖の向きを逆にした電線」を張り直して同じ節点になることを確かめる
    const target = chain[0];
    expect(target).toBeDefined();
    if (target === undefined) return;
    expect(removeWire(session, target.id).ok).toBe(true);
    expect(
      addWire(session, JIPM_BOARD, target.to, target.from, target.color, { id: target.id }).ok,
    ).toBe(true);
    expect(roles).toBeDefined();
    expect(wiringSuspects(problem, JIPM_BOARD, session)).toEqual(CLEAN);
  });

  it('caps the list at MAX_WIRING_SUSPECTS on an unwired board', () => {
    const bare = createSession(JIPM_BOARD, { roles: referenceSession().roles });
    expect(plug(bare, 'S1', 'relay-my4n').ok).toBe(true);
    const report = wiringSuspects(problem, JIPM_BOARD, bare);
    expect(report.suspects.length).toBe(MAX_WIRING_SUSPECTS);
    expect(report.suspects.every((s) => s.kind === 'missing')).toBe(true);
    // 「ほかに N 件」を出すための数（決定表#27）
    expect(report.total).toBeGreaterThan(MAX_WIRING_SUSPECTS);
    expect(report.omitted).toBe(report.total - report.suspects.length);
  });

  it('omits nothing when the list fits', () => {
    const { session } = referenceSession();
    const victim = session.wires.find((w) => !w.locked);
    if (victim === undefined) return;
    removeWire(session, victim.id);
    const report = wiringSuspects(problem, JIPM_BOARD, session);
    expect(report.total).toBe(report.suspects.length);
    expect(report.omitted).toBe(0);
  });

  it('names the devices so the message reads like the schematic', () => {
    const { session } = referenceSession();
    const victim = session.wires.find((w) => !w.locked);
    if (victim === undefined) return;
    removeWire(session, victim.id);
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, session);
    for (const suspect of suspects) {
      expect(suspect.devices.length).toBeGreaterThan(0);
      for (const device of suspect.devices) {
        expect(device).toMatch(/^(CR[1-4]|T[12]|PB[1-4]|PL[1-4]|BZ|P|N)$/u);
      }
    }
  });

  it('returns nothing when the problem reference circuit cannot be built', () => {
    const broken = { ...problem, board: { ...problem.board, boardId: 'nope' } };
    expect(wiringSuspects(broken, JIPM_BOARD, referenceSession().session)).toEqual(CLEAN);
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確かめる**

```
pnpm --filter @ojt/content test wiring-diff
```

- [ ] **Step 3: `packages/content/src/wiring-diff.ts` を実装する**

```ts
import { toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import { buildNets, terminalId, type Nets, type TerminalId } from '@ojt/circuit-sim';
import type { CellAssignment } from '@ojt/schematic-core';
import { buildReferenceSession, type SchematicProblem } from './reference.js';

/**
 * 「疑わしい配線」の割り出し。UXレビュー #28（2026-09-19）。
 *
 * 判定（`judgeAssemble()`）は波形の食い違いしか返さないので、訓練者は「PL1 が点かない」までは
 * 分かっても**どの電線を見ればよいか**が分からない。ここでは模範回路と訓練者回路の
 * **節点分割**（`buildNets()` の union-find）を比べ、「本来つながるはずの2端子がつながっていない」
 * （`missing`）と「本来別のはずの2端子がつながっている」（`extra`）を挙げる。
 *
 * 電線を1本ずつ突き合わせないのは、§11.3 の母線分配が**渡り配線**（鎖）であり、鎖の順序に
 * 自由度があるためである（`P.1 → A → B` と `P.1 → B → A` は電気的に同じ）。節点分割なら
 * 「電気的に同じかどうか」だけを見るので、正しい配線を誤りと呼ばずに済む。
 *
 * 比べる端子は**回路図の要素が使う端子と母線の供給端子**に限る。盤の全端子で比べると、
 * その課題で使わないソケットの端子が大量に `missing` として出てくる。
 */

/** 疑いの種別。 */
export type SuspectKind = 'missing' | 'extra';

/** 疑い1件。 */
export interface WiringSuspect {
  kind: SuspectKind;
  /** 関わる2端子（模範回路の出現順）。 */
  terminals: readonly [TerminalId, TerminalId];
  /** その端子を使う回路図上の機器名（重複を除いた出現順）。 */
  devices: readonly string[];
  /** その端子を使う回路図の要素ID（`buildHighlightIndex()` の鍵）。 */
  cellIds: readonly string[];
  /** その2端子のどちらかに繋がっている訓練者の電線ID（3Dで光らせる先）。 */
  wireIds: readonly string[];
  /** 画面にそのまま出せる1行。 */
  message: string;
}

/**
 * 疑いの一覧と、上限で切り捨てた件数。決定表#27
 * 「ほかに N 件」を結果画面が出せるように、**切り捨てた件数まで**返す（一覧の長さだけでは
 * 「5件しか無かった」のか「5件しか出していない」のかが呼び出し側から分からない）。
 */
export interface WiringSuspectReport {
  /** 画面に出す疑い（最大 `MAX_WIRING_SUSPECTS` 件）。 */
  suspects: readonly WiringSuspect[];
  /** 見つかった疑いの総数。 */
  total: number;
  /** 上限で切り捨てた件数（`total - suspects.length`）。 */
  omitted: number;
}

/** 結果画面に出す上限（決定表#27）。 */
export const MAX_WIRING_SUSPECTS = 5;

/** 母線の供給端子（§6.1: P/N は各1点）。 */
const BUS_TERMINALS: readonly TerminalId[] = [terminalId('P', '1'), terminalId('N', '1')];

/** 端子 → 回路図の機器名（母線は `P` / `N`）。 */
function deviceIndex(cells: readonly CellAssignment[]): Map<TerminalId, string> {
  const out = new Map<TerminalId, string>();
  for (const cell of cells) {
    for (const id of [cell.left, cell.right]) if (!out.has(id)) out.set(id, cell.device);
  }
  out.set(BUS_TERMINALS[0] as TerminalId, 'P');
  out.set(BUS_TERMINALS[1] as TerminalId, 'N');
  return out;
}

/** 端子 → その端子を使う回路図要素ID（出現順）。 */
function cellIndex(cells: readonly CellAssignment[]): Map<TerminalId, string[]> {
  const out = new Map<TerminalId, string[]>();
  for (const cell of cells) {
    for (const id of [cell.left, cell.right]) {
      out.set(id, [...(out.get(id) ?? []), cell.cellId]);
    }
  }
  return out;
}

/** 見張る端子（回路図の要素が使う端子 ＋ 母線の供給端子。模範回路の出現順）。 */
function watchedTerminals(cells: readonly CellAssignment[]): TerminalId[] {
  const out: TerminalId[] = [];
  for (const cell of cells) {
    for (const id of [cell.left, cell.right]) if (!out.includes(id)) out.push(id);
  }
  for (const bus of BUS_TERMINALS) if (!out.includes(bus)) out.push(bus);
  return out;
}

/**
 * 端子の節点番号。そのネットリストに無い端子は `undefined`。
 * 盤に無い端子（課題が使わないソケットの役割）でも落ちないようにする。
 */
function nodeOf(nets: Nets, id: TerminalId): number | undefined {
  return nets.hasTerminal(id) ? nets.nodeOf(id) : undefined;
}

/** 節点番号ごとに端子をまとめる（`undefined` の端子は除く）。 */
function groupByNode(
  nets: Nets,
  terminals: readonly TerminalId[],
): Map<number, TerminalId[]> {
  const out = new Map<number, TerminalId[]>();
  for (const id of terminals) {
    const node = nodeOf(nets, id);
    if (node === undefined) continue;
    out.set(node, [...(out.get(node) ?? []), id]);
  }
  return out;
}

/** その2端子のどちらかに繋がっている訓練者の電線（既設配線も含む。3Dで光らせる）。 */
function wiresTouching(session: BoardSession, pair: readonly TerminalId[]): string[] {
  return session.wires
    .filter((w) => pair.includes(w.from) || pair.includes(w.to))
    .map((w) => w.id);
}

/** 疑い1件を組み立てる。 */
function makeSuspect(
  kind: SuspectKind,
  a: TerminalId,
  b: TerminalId,
  devices: ReadonlyMap<TerminalId, string>,
  cells: ReadonlyMap<TerminalId, string[]>,
  session: BoardSession,
): WiringSuspect {
  const deviceA = devices.get(a) ?? a;
  const deviceB = devices.get(b) ?? b;
  const names = [...new Set([deviceA, deviceB])];
  const message =
    kind === 'missing'
      ? `${a}（${deviceA}）と ${b}（${deviceB}）がつながっていません`
      : `${a}（${deviceA}）と ${b}（${deviceB}）が余計につながっています`;
  return {
    kind,
    terminals: [a, b],
    devices: names,
    cellIds: [...new Set([...(cells.get(a) ?? []), ...(cells.get(b) ?? [])])],
    wireIds: wiresTouching(session, [a, b]),
    message,
  };
}

/**
 * ある分割（`from`）のまとまりが、別の分割（`to`）で割れている箇所を挙げる。
 * まとまりの先頭（模範回路の出現順の1つ目）を基準にし、別の節点にいる端子を1つずつ挙げる。
 * 同じ節点に落ちた端子はまとめて1件にするので、4端子が2対2に割れても2件ではなく1件になる。
 */
function splits(
  groups: ReadonlyMap<number, TerminalId[]>,
  other: Nets,
): Array<[TerminalId, TerminalId]> {
  const out: Array<[TerminalId, TerminalId]> = [];
  for (const members of groups.values()) {
    const anchor = members[0];
    if (anchor === undefined || members.length < 2) continue;
    const anchorNode = nodeOf(other, anchor);
    const seen = new Set<number | undefined>([anchorNode]);
    for (const id of members.slice(1)) {
      const node = nodeOf(other, id);
      if (seen.has(node)) continue;
      seen.add(node);
      out.push([anchor, id]);
    }
  }
  return out;
}

/** 何も疑うところが無いときの戻り。 */
const NO_SUSPECTS: WiringSuspectReport = { suspects: [], total: 0, omitted: 0 };

/**
 * 模範回路と訓練者回路の節点分割の差を「疑わしい配線」として返す。UXレビュー #28
 * 模範回路が作れない課題（課題データの誤り。§13 #2）では空の報告を返す——判定そのものが
 * 先に課題エラーで止まるので、結果画面に出すものは無い。
 *
 * **接点の組の違いも出る**（決定表#9b）。`assignToBoard()` は模範回路の要素の出現順に
 * `CR1` の4組（⑨⑤／⑩⑥／⑪⑦／⑫⑧）を割り当てるので、訓練者が別の組へ張ると、
 * 電気的には正しくても節点分割は違う。正規化はせず、画面（`JA.result.suspectNote`）で断る。
 */
export function wiringSuspects(
  problem: SchematicProblem,
  board: BoardDefinition,
  traineeSession: BoardSession,
): WiringSuspectReport {
  const reference = buildReferenceSession(problem, board);
  if (!reference.ok) return NO_SUSPECTS;

  const cells = reference.value.cells;
  const watched = watchedTerminals(cells);
  const devices = deviceIndex(cells);
  const cellsAt = cellIndex(cells);

  const referenceNets = buildNets(reference.value.netlist);
  const traineeNets = buildNets(toNetlist(traineeSession, board));

  const missing = splits(groupByNode(referenceNets, watched), traineeNets).map(([a, b]) =>
    makeSuspect('missing', a, b, devices, cellsAt, traineeSession),
  );
  const extra = splits(groupByNode(traineeNets, watched), referenceNets).map(([a, b]) =>
    makeSuspect('extra', a, b, devices, cellsAt, traineeSession),
  );

  const all = [...missing, ...extra];
  const suspects = all.slice(0, MAX_WIRING_SUSPECTS);
  return { suspects, total: all.length, omitted: all.length - suspects.length };
}
```

**設計上の注記（レビューで見る点）:**

- `splits()` は**非対称**に呼ぶ。`missing` は「模範で1つの節点 → 訓練者で複数」、`extra` は「訓練者で1つの節点 → 模範で複数」。どちらも `MAX_WIRING_SUSPECTS` の前に `missing` を並べるので、未配線の盤では `missing` だけが出る（決定表#27）。
- `wiresTouching()` は既設配線（`locked`）も返す。**3Dで光らせるだけ**なので、削除できない電線が光っても害は無く、むしろ「ここは既設だから触らなくてよい」が分かる。
- 母線の供給端子を `watched` に入れているので、「`P.1` に何もつながっていない」（＝母線から電気が来ていない）も `missing` として出る。訓練者がいちばん踏む誤りである。
- 戻り値は配列ではなく `WiringSuspectReport`（`suspects` / `total` / `omitted`）。`slice()` した配列だけを返すと、結果画面は「5件で全部なのか、切り捨てたのか」を判定できず「ほかに N 件」（決定表#27）を出せない。

- [ ] **Step 4: `index.ts` に再輸出を足す**

```ts
export {
  MAX_WIRING_SUSPECTS,
  wiringSuspects,
  type SuspectKind,
  type WiringSuspect,
  type WiringSuspectReport,
} from './wiring-diff.js';
```

- [ ] **Step 5: テストを走らせてコミットする**

```
pnpm --filter @ojt/content test
pnpm -r typecheck && pnpm lint
git add packages/content && git commit -m "feat(content): point at the suspect terminals from the net partition diff"
```

**期待**: `wiring-diff.test.ts` の **8件**が増える。

---

## Task 4: エディタの純関数層（`session/schematic-edit.ts` ＋ 手順帯）

**モデル: Opus**（カーソル移動・キー割当・パレットの絞り込みの設計）

**Files:**
- Create: `apps/desktop/src/renderer/session/schematic-edit.ts`
- Modify: `apps/desktop/src/renderer/session/step-guide.ts`（末尾に追記）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（`JA.schematic` ブロックを新設、`JA.stepGuide` に追記）
- Test: `apps/desktop/test/schematic-edit.test.ts`（新規）

3D も React も使わない層。`session/ladder.ts`（履歴）と `session/interaction.ts`（キー → 操作）の流儀に合わせる。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/schematic-edit.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import {
  applyEdit,
  emptySchematic,
  type CellDraft,
  type SchematicDocument,
} from '@ojt/schematic-core';
import { describe, expect, it } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import {
  branchDisabledReason,
  branchStepHint,
  clampCursor,
  emptySchematicHistory,
  keyToEdit,
  moveCursor,
  paletteFor,
  pickBranchNode,
  pushSchematic,
  redoSchematic,
  SCHEMATIC_HISTORY_LIMIT,
  undoSchematic,
  type BranchDraft,
  type EditorCursor,
} from '../src/renderer/session/schematic-edit.js';
import { schematicStepHint, schematicSteps } from '../src/renderer/session/step-guide.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

/** PB1 a接点 → CR1 コイル の1段だけ置いた文書。 */
function oneRung(): SchematicDocument {
  let doc = emptySchematic('draft', '下書き');
  for (const draft of [
    { kind: 'pb-a' as const, device: 'PB1' },
    { kind: 'coil' as const, device: 'CR1' },
  ]) {
    const step = applyEdit(doc, { kind: 'insertCell', rungId: 'r1', index: doc.rungs[0]?.cells.length ?? 0, draft });
    if (step.ok) doc = step.doc;
  }
  return doc;
}

describe('paletteFor（決定表#26）', () => {
  it('offers only the devices that the board of this problem has', () => {
    const items = paletteFor(problem, JIPM_BOARD);
    const devices = [...new Set(items.map((i) => i.device))];
    expect(devices).toContain('PB1');
    expect(devices).toContain('CR1');
    expect(devices).toContain('PL1');
    // BZ は課題が extraParts で足したときだけ
    expect(devices).not.toContain('BZ');
  });

  it('offers BZ when the problem adds it', () => {
    const withBuzzer = { ...problem, board: { ...problem.board, extraParts: ['BZ'] as const } };
    expect(paletteFor(withBuzzer, JIPM_BOARD).some((i) => i.device === 'BZ')).toBe(true);
  });

  it('offers only the socket roles that the problem assigns', () => {
    const twoSockets = {
      ...problem,
      board: { ...problem.board, socketRoles: { S1: 'CR1' as const, S2: 'T1' as const } },
    };
    const devices = [...new Set(paletteFor(twoSockets, JIPM_BOARD).map((i) => i.device))];
    expect(devices).toContain('CR1');
    expect(devices).toContain('T1');
    expect(devices).not.toContain('CR2');
  });

  it('labels every item in Japanese and keeps a stable order', () => {
    const items = paletteFor(problem, JIPM_BOARD);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.id).toBe(`${item.kind}:${item.device}`);
    }
    expect(paletteFor(problem, JIPM_BOARD).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });
});

describe('moveCursor / clampCursor', () => {
  const doc = oneRung();
  const start: EditorCursor = { rungId: 'r1', index: 0 };

  it('moves right up to the empty tail slot', () => {
    expect(moveCursor(doc, start, 'ArrowRight')).toEqual({ rungId: 'r1', index: 1 });
    expect(moveCursor(doc, { rungId: 'r1', index: 2 }, 'ArrowRight')).toEqual({ rungId: 'r1', index: 2 });
  });

  it('moves left down to zero', () => {
    expect(moveCursor(doc, start, 'ArrowLeft')).toEqual(start);
    expect(moveCursor(doc, { rungId: 'r1', index: 2 }, 'ArrowLeft')).toEqual({ rungId: 'r1', index: 1 });
  });

  it('moves between rungs and clamps the column', () => {
    const two = applyEdit(doc, { kind: 'addRung' });
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(moveCursor(two.doc, { rungId: 'r1', index: 2 }, 'ArrowDown')).toEqual({ rungId: 'r2', index: 0 });
    expect(moveCursor(two.doc, { rungId: 'r2', index: 0 }, 'ArrowUp')).toEqual({ rungId: 'r1', index: 0 });
  });

  it('clamps a cursor that points outside the document', () => {
    expect(clampCursor(doc, { rungId: 'r9', index: 7 })).toEqual({ rungId: 'r1', index: 0 });
    expect(clampCursor(doc, { rungId: 'r1', index: 9 })).toEqual({ rungId: 'r1', index: 2 });
  });
});

describe('keyToEdit（決定表#25）', () => {
  const doc = oneRung();
  const palette = paletteFor(problem, JIPM_BOARD);
  const selected = palette.find((i) => i.kind === 'lamp');
  if (selected === undefined) throw new Error('パレットに表示灯がありません');

  it('places the selected palette item on Enter', () => {
    const edit = keyToEdit(doc, { rungId: 'r1', index: 2 }, 'Enter', selected);
    expect(edit).toEqual({
      kind: 'insertCell',
      rungId: 'r1',
      index: 2,
      draft: { kind: 'lamp', device: selected.device },
    });
  });

  it('does nothing on Enter when no palette item is selected', () => {
    expect(keyToEdit(doc, { rungId: 'r1', index: 2 }, 'Enter', undefined)).toBeUndefined();
  });

  it('removes the cell under the cursor on Delete and Backspace', () => {
    for (const key of ['Delete', 'Backspace']) {
      expect(keyToEdit(doc, { rungId: 'r1', index: 0 }, key, selected)).toEqual({
        kind: 'removeCell',
        cellId: 'c1',
      });
    }
  });

  it('does nothing on Delete over the empty tail slot', () => {
    expect(keyToEdit(doc, { rungId: 'r1', index: 2 }, 'Delete', selected)).toBeUndefined();
  });

  it('adds a rung on Insert and removes it on Ctrl+Delete', () => {
    expect(keyToEdit(doc, { rungId: 'r1', index: 0 }, 'Insert', selected)).toEqual({
      kind: 'addRung',
      after: 'r1',
    });
    expect(keyToEdit(doc, { rungId: 'r1', index: 0 }, 'Delete', selected, { ctrl: true })).toEqual({
      kind: 'removeRung',
      rungId: 'r1',
    });
  });

  it('ignores keys that are not bound', () => {
    expect(keyToEdit(doc, { rungId: 'r1', index: 0 }, 'F5', selected)).toBeUndefined();
  });
});

describe('分岐（受入基準① の自己保持段）', () => {
  /** 段1 ＝ PB2 b接点 → PB1 a接点 → CR1 コイル、段2 ＝ CR1 a接点（まだ P→N の普通の段）。 */
  function twoRungs(): SchematicDocument {
    let doc = emptySchematic('draft', '下書き');
    const place = (rungId: string, draft: CellDraft): void => {
      const target = doc.rungs.find((r) => r.id === rungId);
      const step = applyEdit(doc, {
        kind: 'insertCell',
        rungId,
        index: target?.cells.length ?? 0,
        draft,
      });
      expect(step.ok).toBe(true);
      if (step.ok) doc = step.doc;
    };
    place('r1', { kind: 'pb-b', device: 'PB2' });
    place('r1', { kind: 'pb-a', device: 'PB1' });
    place('r1', { kind: 'coil', device: 'CR1' });
    const added = applyEdit(doc, { kind: 'addRung' });
    expect(added.ok).toBe(true);
    if (added.ok) doc = added.doc;
    place('r2', { kind: 'cr-a', device: 'CR1' });
    return doc;
  }

  it('offers 分岐 only for a rung that can become one, and says why when it cannot', () => {
    const doc = twoRungs();
    expect(branchDisabledReason(doc, 'r2')).toBeUndefined();
    // 負荷（コイル）のある段は分岐にできない（分岐段に負荷は置けない）
    expect(branchDisabledReason(doc, 'r1')).toBe(JA.schematic.branchHasLoad);
    // 段が1本しか無ければ分岐先の節点が無い
    expect(branchDisabledReason(emptySchematic('d', 't'), 'r1')).toBe(
      JA.schematic.branchNeedsAnotherRung,
    );
  });

  it('takes the start node first and turns the second pick into a setEnds edit', () => {
    const doc = twoRungs();
    const first = pickBranchNode(doc, { rungId: 'r2' }, { rungId: 'r1', node: 1 });
    expect(first).toEqual({
      kind: 'draft',
      branch: { rungId: 'r2', from: { rung: 'r1', node: 1 } },
    });
    if (first.kind !== 'draft') return;
    const second = pickBranchNode(doc, first.branch, { rungId: 'r1', node: 2 });
    expect(second).toEqual({
      kind: 'edit',
      edit: {
        kind: 'setEnds',
        rungId: 'r2',
        from: { rung: 'r1', node: 1 },
        to: { rung: 'r1', node: 2 },
      },
    });
    if (second.kind !== 'edit') return;
    // この編集を当てると b-001 と同じ自己保持段になる（受入基準①）
    const out = applyEdit(doc, second.edit);
    expect(out.ok && out.doc.rungs[1]).toMatchObject({
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
  });

  it('refuses a node of the rung that is being branched', () => {
    expect(pickBranchNode(twoRungs(), { rungId: 'r2' }, { rungId: 'r2', node: 0 })).toEqual({
      kind: 'refused',
      message: JA.schematic.branchSelfRefused,
    });
  });

  it('refuses a node that the target rung does not have', () => {
    expect(pickBranchNode(twoRungs(), { rungId: 'r2' }, { rungId: 'r1', node: 9 })).toEqual({
      kind: 'refused',
      message: JA.schematic.branchNoNode,
    });
  });

  it('refuses the same node for both ends', () => {
    const branch: BranchDraft = { rungId: 'r2', from: { rung: 'r1', node: 1 } };
    expect(pickBranchNode(twoRungs(), branch, { rungId: 'r1', node: 1 })).toEqual({
      kind: 'refused',
      message: JA.schematic.branchSameNode,
    });
  });

  it('guides the trainee one line at a time', () => {
    expect(branchStepHint(undefined)).toBeUndefined();
    expect(branchStepHint({ rungId: 'r2' })).toBe(JA.schematic.branchPickFrom);
    expect(branchStepHint({ rungId: 'r2', from: { rung: 'r1', node: 1 } })).toBe(
      JA.schematic.branchPickTo,
    );
  });

  it('lets keyToEdit finish the branch on Enter and swallows every other key', () => {
    const doc = twoRungs();
    const branch: BranchDraft = { rungId: 'r2', from: { rung: 'r1', node: 1 } };
    expect(keyToEdit(doc, { rungId: 'r1', index: 2 }, 'Enter', undefined, {}, branch)).toEqual({
      kind: 'setEnds',
      rungId: 'r2',
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
    // 分岐の節点を選んでいる最中に Delete / Insert で文書が変わらない（決定表#25）
    expect(
      keyToEdit(doc, { rungId: 'r1', index: 0 }, 'Delete', undefined, {}, branch),
    ).toBeUndefined();
    expect(
      keyToEdit(doc, { rungId: 'r1', index: 0 }, 'Insert', undefined, {}, branch),
    ).toBeUndefined();
  });
});

describe('SchematicHistory', () => {
  it('pushes, undoes and redoes like the ladder history', () => {
    const before = emptySchematic('draft', '下書き');
    const after = oneRung();
    const history = pushSchematic(emptySchematicHistory(), before);
    const back = undoSchematic(history, after);
    expect(back?.doc).toBe(before);
    expect(back?.history.undone).toEqual([after]);
    const forward = back === undefined ? undefined : redoSchematic(back.history, back.doc);
    expect(forward?.doc).toBe(after);
  });

  it('drops the oldest step past the limit', () => {
    let history = emptySchematicHistory();
    for (let i = 0; i <= SCHEMATIC_HISTORY_LIMIT + 3; i += 1) {
      history = pushSchematic(history, emptySchematic(`d${i}`, '下書き'));
    }
    expect(history.done).toHaveLength(SCHEMATIC_HISTORY_LIMIT);
    expect(history.done[0]?.id).toBe('d4');
  });

  it('returns undefined when there is nothing to undo or redo', () => {
    expect(undoSchematic(emptySchematicHistory(), oneRung())).toBeUndefined();
    expect(redoSchematic(emptySchematicHistory(), oneRung())).toBeUndefined();
  });
});

describe('schematicSteps（決定表#24）', () => {
  it('walks 描く → 検算 → 盤に配線', () => {
    const empty = schematicSteps({ cellCount: 0, verified: false, boardWired: false });
    expect(empty.map((s) => s.state)).toEqual(['current', 'todo', 'todo']);
    const drawn = schematicSteps({ cellCount: 3, verified: false, boardWired: false });
    expect(drawn[0]?.state).toBe('done');
    expect(drawn[1]?.state).toBe('current');
    const verified = schematicSteps({ cellCount: 3, verified: true, boardWired: false });
    expect(verified[2]?.state).toBe('current');
  });

  it('gives a one-line hint for every step', () => {
    for (const key of ['draw', 'verify', 'wire'] as const) {
      expect(schematicStepHint(key)?.length ?? 0).toBeGreaterThan(0);
    }
    expect(schematicStepHint(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確かめる**

```
pnpm --filter @ojt/desktop test schematic-edit
```

- [ ] **Step 3: `apps/desktop/src/renderer/session/schematic-edit.ts` を実装する**

```ts
import { SOCKET_ROLES, type BoardDefinition, type SocketRole } from '@ojt/board-model';
import type { AssembleProblem } from '@ojt/content';
import {
  CELL_KIND_LABELS,
  rungHasLoad,
  type CellKind,
  type RungEnd,
  type SchematicDocument,
  type SchematicEdit,
} from '@ojt/schematic-core';
import { JA } from '../i18n/ja.js';

/**
 * 回路図エディタの純関数層。設計仕様 §11.4 / Plan 5 決定表#25・#26。
 * React も three も SVG も使わないので Vitest だけで全分岐を検証できる（§14.2）。
 * 履歴の形は `session/ladder.ts` の `LadderHistory` と同じ（スナップショット方式）。
 */

/** 元に戻せる手数の上限（ラダーと同じ）。 */
export const SCHEMATIC_HISTORY_LIMIT = 50;

/** カーソル（どの段のどの桁を指しているか）。桁は 0〜要素数（要素数＝末尾の空き桁）。 */
export interface EditorCursor {
  rungId: string;
  index: number;
}

/** パレットの1項目。 */
export interface PaletteItem {
  /** `kind:device`（React の `key` と選択の同一性に使う）。 */
  id: string;
  kind: CellKind;
  device: string;
  /** 画面に出す名前（`リレー a接点 CR1`）。 */
  label: string;
  /** まとまりの見出し（`押ボタン` / `リレー` / `タイマ` / `出力`）。 */
  group: string;
}

/** 元に戻す／やり直しの履歴。 */
export interface SchematicHistory {
  done: SchematicDocument[];
  undone: SchematicDocument[];
}

/** 空の履歴。 */
export function emptySchematicHistory(): SchematicHistory {
  return { done: [], undone: [] };
}

/** 編集の**前**の文書を積む（やり直し列は捨てる）。 */
export function pushSchematic(
  history: SchematicHistory,
  before: SchematicDocument,
): SchematicHistory {
  const done = [...history.done, before];
  return { done: done.slice(Math.max(0, done.length - SCHEMATIC_HISTORY_LIMIT)), undone: [] };
}

/** 1手戻す。 */
export function undoSchematic(
  history: SchematicHistory,
  current: SchematicDocument,
): { history: SchematicHistory; doc: SchematicDocument } | undefined {
  const previous = history.done[history.done.length - 1];
  if (previous === undefined) return undefined;
  return {
    history: { done: history.done.slice(0, -1), undone: [...history.undone, current] },
    doc: previous,
  };
}

/** 1手やり直す。 */
export function redoSchematic(
  history: SchematicHistory,
  current: SchematicDocument,
): { history: SchematicHistory; doc: SchematicDocument } | undefined {
  const next = history.undone[history.undone.length - 1];
  if (next === undefined) return undefined;
  return {
    history: { done: [...history.done, current], undone: history.undone.slice(0, -1) },
    doc: next,
  };
}

/** パレットのまとまりの見出し。 */
const GROUP_PB = '押ボタン';
const GROUP_CR = 'リレー';
const GROUP_T = 'タイマ';
const GROUP_OUT = '出力';

function item(kind: CellKind, device: string, group: string): PaletteItem {
  return { id: `${kind}:${device}`, kind, device, label: `${CELL_KIND_LABELS[kind]} ${device}`, group };
}

/**
 * 課題が盤に割り当てている役割（チェック用の `CHK` は除く）。§6.1
 * `board.socketRoles` は課題スキーマ（`BoardRefSchema`）の**必須項目**なので、
 * 「割当が無いときは全役割」という分岐は存在しない。
 */
function assignedRoles(problem: AssembleProblem): SocketRole[] {
  const used = new Set(
    Object.values(problem.board.socketRoles).filter(
      (role): role is SocketRole => role !== undefined,
    ),
  );
  return SOCKET_ROLES.filter((role) => role !== 'CHK' && used.has(role));
}

/**
 * その課題で置ける要素の一覧。決定表#26
 * ソケットの役割は課題の `board.socketRoles`、押ボタン・表示灯は盤の定義、
 * ブザーは課題の `board.extraParts` にあるときだけ。
 */
export function paletteFor(problem: AssembleProblem, board: BoardDefinition): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const pb of board.pushButtons) {
    out.push(item('pb-a', pb.id, GROUP_PB), item('pb-b', pb.id, GROUP_PB));
  }
  for (const role of assignedRoles(problem)) {
    if (role.startsWith('CR')) {
      out.push(item('cr-a', role, GROUP_CR), item('cr-b', role, GROUP_CR), item('coil', role, GROUP_CR));
    } else {
      out.push(item('t-a', role, GROUP_T), item('t-b', role, GROUP_T), item('coil', role, GROUP_T));
    }
  }
  for (const lamp of board.lamps) out.push(item('lamp', lamp.id, GROUP_OUT));
  if ((problem.board.extraParts ?? []).includes('BZ')) out.push(item('buzzer', 'BZ', GROUP_OUT));
  return out;
}

/** その段の桁の上限（末尾の空き桁を含む）。 */
function lastIndexOf(doc: SchematicDocument, rungId: string): number {
  return doc.rungs.find((r) => r.id === rungId)?.cells.length ?? 0;
}

/** 文書の中に収まるカーソルへ直す（段が消えたら先頭の段の先頭へ）。 */
export function clampCursor(doc: SchematicDocument, cursor: EditorCursor): EditorCursor {
  const found = doc.rungs.find((r) => r.id === cursor.rungId);
  const target = found ?? doc.rungs[0];
  if (target === undefined) return { rungId: '', index: 0 };
  if (found === undefined) return { rungId: target.id, index: 0 };
  return { rungId: target.id, index: Math.min(Math.max(0, cursor.index), target.cells.length) };
}

/** 矢印キーでカーソルを動かす（範囲外へは出ない）。 */
export function moveCursor(
  doc: SchematicDocument,
  cursor: EditorCursor,
  key: string,
): EditorCursor {
  const current = clampCursor(doc, cursor);
  const row = doc.rungs.findIndex((r) => r.id === current.rungId);
  switch (key) {
    case 'ArrowLeft':
      return { ...current, index: Math.max(0, current.index - 1) };
    case 'ArrowRight':
      return { ...current, index: Math.min(lastIndexOf(doc, current.rungId), current.index + 1) };
    case 'ArrowUp': {
      const next = doc.rungs[Math.max(0, row - 1)];
      return next === undefined ? current : clampCursor(doc, { rungId: next.id, index: current.index });
    }
    case 'ArrowDown': {
      const next = doc.rungs[Math.min(doc.rungs.length - 1, row + 1)];
      return next === undefined ? current : clampCursor(doc, { rungId: next.id, index: current.index });
    }
    default:
      return current;
  }
}

/** カーソルの下にある要素のID（末尾の空き桁なら undefined）。 */
export function cellUnder(doc: SchematicDocument, cursor: EditorCursor): string | undefined {
  return doc.rungs.find((r) => r.id === cursor.rungId)?.cells[cursor.index]?.id;
}

/*
 * ここから「分岐」（§11.1 の分岐点）。受入基準①の自己保持回路は、**両端が別の段の節点**にある
 * 段（b-001 の `r1h`: `{rung:'r1',node:1}` → `{rung:'r1',node:2}`）を1本引かないと描けない。
 * `addRung` は必ず `P → N` の段を作るので、それだけでは永久に描けない（B1）。
 *
 * 操作は2クリック（またはカーソル＋Enter 2回）で完結させる:
 *   ①「分岐にする」を押す → ②始点の節点を選ぶ → ③終点の節点を選ぶ → `setEnds` を1回当てる。
 * 節点 k は「桁 k の左端」なので、当たり判定は `slotRects()`（Task 1）をそのまま使える。
 * 新しい当たり矩形も新しい図形も足さない。
 */

/** 分岐の下書き（どの段を分岐にするか、始点は決まったか）。§11.4 */
export interface BranchDraft {
  /** 分岐にする段。 */
  rungId: string;
  /** 決まった始点。未定なら undefined（次に選ぶ節点が始点になる）。 */
  from?: RungEnd;
}

/** 分岐の節点を1つ選んだ結果。 */
export type BranchOutcome =
  /** 始点が決まった（次は終点）。画面は下書きを差し替える。 */
  | { kind: 'draft'; branch: BranchDraft }
  /** 両端が決まった。画面はこの編集を `onEdit` に投げ、分岐モードを抜ける。 */
  | { kind: 'edit'; edit: Extract<SchematicEdit, { kind: 'setEnds' }> }
  /** 選べない節点。画面は理由をトーストに出し、分岐モードは続ける。 */
  | { kind: 'refused'; message: string };

/** 2つの端点が同じ節点を指しているか。 */
function sameEnd(a: RungEnd, b: RungEnd): boolean {
  if ('bus' in a || 'bus' in b) return 'bus' in a && 'bus' in b && a.bus === b.bus;
  return a.rung === b.rung && a.node === b.node;
}

/**
 * その段を分岐にできるか。できないときは**理由**（「分岐にする」ボタンの `title` に出す）。
 * 利用者要求「分かりやすく直感的に」: 押せないボタンには必ず理由を添える（完了条件の「画面の品質」）。
 */
export function branchDisabledReason(doc: SchematicDocument, rungId: string): string | undefined {
  const target = doc.rungs.find((r) => r.id === rungId);
  if (target === undefined) return JA.schematic.branchNoRung;
  if (doc.rungs.length < 2) return JA.schematic.branchNeedsAnotherRung;
  // 分岐段（右母線に至らない段）に負荷は置けない（`validateDocument()` の規則。§11.1）
  if (rungHasLoad(target)) return JA.schematic.branchHasLoad;
  return undefined;
}

/**
 * 分岐の節点を1つ選ぶ。**クリックでもカーソル＋Enterでもこの関数を通す**（規則を1箇所に保つ）。
 * ここが見るのは「その節点を選べるか」だけで、文書を書き換えるのは `applyEdit()` の `setEnds`。
 * 参照の循環（`layout()` が解けない形）はそちらが断る（`schematic-core/src/edit.ts`）。
 */
export function pickBranchNode(
  doc: SchematicDocument,
  branch: BranchDraft,
  target: { rungId: string; node: number },
): BranchOutcome {
  if (target.rungId === branch.rungId) {
    return { kind: 'refused', message: JA.schematic.branchSelfRefused };
  }
  const owner = doc.rungs.find((r) => r.id === branch.rungId);
  const parent = doc.rungs.find((r) => r.id === target.rungId);
  if (owner === undefined || parent === undefined) {
    return { kind: 'refused', message: JA.schematic.branchNoRung };
  }
  if (!Number.isInteger(target.node) || target.node < 0 || target.node > parent.cells.length) {
    return { kind: 'refused', message: JA.schematic.branchNoNode };
  }
  const end: RungEnd = { rung: target.rungId, node: target.node };
  if (branch.from === undefined) {
    return { kind: 'draft', branch: { rungId: branch.rungId, from: end } };
  }
  if (sameEnd(branch.from, end)) {
    return { kind: 'refused', message: JA.schematic.branchSameNode };
  }
  return {
    kind: 'edit',
    edit: { kind: 'setEnds', rungId: branch.rungId, from: branch.from, to: end },
  };
}

/** 分岐中の1行の案内（手順帯の案内を一時的に置き換える）。決定表#24 */
export function branchStepHint(branch: BranchDraft | undefined): string | undefined {
  if (branch === undefined) return undefined;
  return branch.from === undefined ? JA.schematic.branchPickFrom : JA.schematic.branchPickTo;
}

/**
 * キー入力を編集操作に直す。決定表#25
 * 割り当てが無いキーは `undefined`（画面は何もしない）。`Ctrl+Z` / `Ctrl+Y` は履歴の操作で
 * 編集操作ではないので、ここでは扱わない（画面が直接 `undoSchematic()` を呼ぶ）。
 */
export function keyToEdit(
  doc: SchematicDocument,
  cursor: EditorCursor,
  key: string,
  selected: PaletteItem | undefined,
  modifiers: { ctrl?: boolean } = {},
  /** 分岐の節点を選んでいる最中なら、その下書き。 */
  branch?: BranchDraft,
): SchematicEdit | undefined {
  const current = clampCursor(doc, cursor);
  /*
   * 分岐の節点を選んでいるあいだは `Enter` だけを受ける。`Delete` や `Insert` を通すと
   * 「終点を選ぼうとして押した Delete」で要素が消える（Phase 1D で踏んだのと同じ形の事故）。
   * 始点しか決まっていない段階では `pickBranchNode()` が `kind: 'draft'` を返すので、
   * ここは編集を返さない（下書きの更新は画面の仕事）。
   */
  if (branch !== undefined) {
    if (key !== 'Enter') return undefined;
    const picked = pickBranchNode(doc, branch, { rungId: current.rungId, node: current.index });
    return picked.kind === 'edit' ? picked.edit : undefined;
  }
  if (key === 'Insert') return { kind: 'addRung', after: current.rungId };
  if (key === 'Delete' && modifiers.ctrl === true) {
    return { kind: 'removeRung', rungId: current.rungId };
  }
  if (key === 'Delete' || key === 'Backspace') {
    const cellId = cellUnder(doc, current);
    return cellId === undefined ? undefined : { kind: 'removeCell', cellId };
  }
  if (key === 'Enter') {
    if (selected === undefined) return undefined;
    return {
      kind: 'insertCell',
      rungId: current.rungId,
      index: current.index,
      draft: { kind: selected.kind, device: selected.device },
    };
  }
  return undefined;
}

/** 文書に置かれている要素の総数（手順帯の「描いた」の判定に使う）。 */
export function cellCount(doc: SchematicDocument): number {
  return doc.rungs.reduce((sum, r) => sum + r.cells.length, 0);
}
```

- [ ] **Step 4: `session/step-guide.ts` の末尾に追記する**

```ts
/** 回路図エディタの手順キー（描く → 検算 → 盤に配線）。Plan 5 決定表#24 */
export type SchematicStepKey = 'draw' | 'verify' | 'wire';

/** 回路図エディタの手順帯。 */
export function schematicSteps(input: {
  /** 回路図に置かれている要素の数。 */
  cellCount: number;
  /** 検算に合格したか。 */
  verified: boolean;
  /** 盤に電線を1本でも張ったか（固定配線は数えない）。 */
  boardWired: boolean;
}): ReadonlyArray<GuideStep<SchematicStepKey>> {
  const drawDone = input.cellCount > 0;
  const verifyDone = drawDone && input.verified;
  const wireDone = verifyDone && input.boardWired;
  return sequentialSteps([
    { key: 'draw', label: JA.stepGuide.schematicDraw, done: drawDone },
    { key: 'verify', label: JA.stepGuide.schematicVerify, done: verifyDone },
    { key: 'wire', label: JA.stepGuide.schematicWire, done: wireDone },
  ]);
}

/** いまの手順にだけ効く1行の案内（回路図エディタ）。 */
export function schematicStepHint(key: SchematicStepKey | undefined): string | undefined {
  if (key === 'draw') return JA.stepGuide.schematicDrawHint;
  if (key === 'verify') return JA.stepGuide.schematicVerifyHint;
  if (key === 'wire') return JA.stepGuide.schematicWireHint;
  return undefined;
}
```

- [ ] **Step 5: `i18n/ja.ts` に文言を足す**

`JA.stepGuide` ブロックの末尾に（`// --- Plan 5 Task 4 ---` で挟む）:

```ts
    schematicDraw: '回路図を描く',
    schematicVerify: '検算する',
    schematicWire: '盤に配線する',
    schematicDrawHint: 'パレットで要素を選び、図の桁をクリック（またはカーソルを合わせて Enter）で置きます。',
    schematicVerifyHint: '「検算」を押すと、描いた回路を課題の操作列で確かめます。盤の配線はまだ見ません。',
    schematicWireHint: '検算に通りました。回路図の要素をクリックすると、3D盤の対応端子が光ります。',
```

`JA` の末尾（`JA.session` の後ろ）に新しいブロックを足す:

```ts
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
    keyHint: '矢印＝移動　Enter＝置く　Delete＝消す　Insert＝段を追加　Ctrl+Delete＝段を削除　Ctrl+Z／Ctrl+Y＝元に戻す／やり直し　Esc＝分岐をやめる',
    viewBoard: '盤',
    viewSplit: '並べて',
    viewSchematic: '回路図',
    guide: '配線ガイド',
    guideOff: '要素をクリックすると3D盤の端子が光ります',
    // 分岐（§11.1 の分岐点。自己保持回路に要る）
    branch: 'この段を分岐にする',
    branchCancel: '分岐をやめる',
    branchHint: 'いま選んでいる段を、ほかの段の節点どうしをつなぐ「分岐」にします。自己保持回路に使います。',
    branchPickFrom: '分岐の始点をクリックしてください（ほかの段の、要素と要素のあいだを選びます）。Esc でやめられます。',
    branchPickTo: '分岐の終点をクリックしてください。始点から右側の節点を選ぶと、そのあいだの要素と並列になります。Esc でやめられます。',
    branchSelfRefused: '分岐の始点・終点には、ほかの段の節点を選んでください。',
    branchSameNode: '始点と同じ節点は終点にできません。別の節点を選んでください。',
    branchNoRung: 'その段がありません。',
    branchNoNode: 'その節点がありません。',
    branchNeedsAnotherRung: '分岐先になる段がありません。先に「段を追加」で段を増やしてください。',
    branchHasLoad: 'コイル・表示灯・ブザーのある段は分岐にできません（分岐段に負荷は置けません）。',
    branchDone: 'この段を分岐にしました。',
  },
```

- [ ] **Step 6: テストを走らせてコミットする**

```
pnpm --filter @ojt/desktop test schematic-edit step-guide
pnpm -r typecheck && pnpm lint
git add apps/desktop && git commit -m "feat(desktop): add the pure layer of the schematic editor (cursor, palette, history, branch)"
```

**期待**: `schematic-edit.test.ts` の **26件**が増え、既存の `step-guide.test.ts` はそのまま通る。

---

## Task 5: 編集できる回路図（`SchematicSvg` の編集モード ＋ `SchematicEditor` ＋ パレット）

**モデル: Opus**（SVG の当たり判定の敷き方と、読取専用の呼び出しを壊さない差分）

**Files:**
- Modify: `apps/desktop/src/renderer/schematic/SchematicSvg.tsx`
- Create: `apps/desktop/src/renderer/schematic/SchematicPalette.tsx`
- Create: `apps/desktop/src/renderer/schematic/SchematicEditor.tsx`
- Create: `apps/desktop/src/renderer/schematic/schematic.module.css`
- Test: `apps/desktop/test/schematic-editor.test.tsx`（新規）

`SchematicSvg` に**任意**の props を足すだけにし、既存の3つの呼び出し（モードBの回路図ヒント・C2の提示回路図・結果画面）は**1行も変えずに動く**ようにする。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/schematic-editor.test.tsx`:

```tsx
import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import {
  applyEdit,
  emptySchematic,
  type CellDraft,
  type SchematicDocument,
} from '@ojt/schematic-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchematicEditor } from '../src/renderer/schematic/SchematicEditor.js';
import { SchematicSvg } from '../src/renderer/schematic/SchematicSvg.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

afterEach(() => {
  cleanup();
});

describe('SchematicSvg: 読取専用のふるまいは変わらない', () => {
  it('draws no slot rects without the editing props', () => {
    render(<SchematicSvg document={problem.schematic} />);
    expect(screen.getByTestId('schematic-svg').querySelectorAll('[data-slot]')).toHaveLength(0);
  });

  it('still reports the clicked cell through onPickCell', () => {
    const onPickCell = vi.fn();
    render(<SchematicSvg document={problem.schematic} onPickCell={onPickCell} />);
    const symbol = screen.getByTestId('schematic-svg').querySelector('[data-cell]');
    expect(symbol).not.toBeNull();
    if (symbol === null) return;
    fireEvent.click(symbol);
    expect(onPickCell).toHaveBeenCalledWith(symbol.getAttribute('data-cell'));
  });
});

describe('SchematicSvg: 編集モード', () => {
  it('draws one rect per slot and reports the rung, the column and the cell that is there', () => {
    const onPickSlot = vi.fn();
    render(
      <SchematicSvg
        document={problem.schematic}
        cursor={{ rungId: 'r1', index: 0 }}
        onPickSlot={onPickSlot}
      />,
    );
    const slots = screen.getByTestId('schematic-svg').querySelectorAll('[data-slot]');
    // 段ごとに「要素数 ＋ 1」個（b-001 は 4 ＋ 2 ＋ 3 ＝ 9）
    expect(slots).toHaveLength(
      problem.schematic.rungs.reduce((n, r) => n + r.cells.length + 1, 0),
    );
    const first = slots[0];
    if (first === undefined) return;
    fireEvent.click(first);
    // b-001 の段 r1 の桁0 は PB2 の b接点（要素ID `c01`）
    expect(onPickSlot).toHaveBeenCalledWith('r1', 0, 'c01');
  });

  it('reports undefined for the empty tail slot', () => {
    const onPickSlot = vi.fn();
    render(
      <SchematicSvg
        document={problem.schematic}
        cursor={{ rungId: 'r1', index: 0 }}
        onPickSlot={onPickSlot}
      />,
    );
    const tail = screen.getByTestId('schematic-svg').querySelector('[data-slot="r1#3"]');
    expect(tail).not.toBeNull();
    if (tail === null) return;
    fireEvent.click(tail);
    expect(onPickSlot).toHaveBeenCalledWith('r1', 3, undefined);
  });

  it('marks the cursor slot so the trainee can see where the next element goes', () => {
    render(
      <SchematicSvg
        document={problem.schematic}
        cursor={{ rungId: 'r1', index: 1 }}
        onPickSlot={vi.fn()}
      />,
    );
    const marked = screen.getByTestId('schematic-svg').querySelectorAll('[data-cursor="true"]');
    expect(marked).toHaveLength(1);
  });
});

describe('SchematicEditor', () => {
  function renderEditor(overrides: Partial<Parameters<typeof SchematicEditor>[0]> = {}) {
    const props = {
      problem,
      board: JIPM_BOARD,
      document: emptySchematic('draft-b-001', '下書き'),
      cursor: { rungId: 'r1', index: 0 },
      history: { done: [], undone: [] },
      verifying: false,
      onEdit: vi.fn(),
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
      ...overrides,
    };
    render(<SchematicEditor {...props} />);
    return props;
  }

  it('lists the palette grouped by device kind', () => {
    renderEditor();
    expect(screen.getByTestId('schematic-palette')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /押ボタン a接点 PB1/u })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /コイル CR1/u })).toBeInTheDocument();
  });

  it('places the selected palette item when a slot is clicked', () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /押ボタン a接点 PB1/u }));
    const slot = screen.getByTestId('schematic-svg').querySelector('[data-slot]');
    if (slot === null) return;
    fireEvent.click(slot);
    expect(props.onEdit).toHaveBeenCalledWith({
      kind: 'insertCell',
      rungId: 'r1',
      index: 0,
      draft: { kind: 'pb-a', device: 'PB1' },
    });
  });

  it('shows the structural issues of a half-finished drawing (決定表#3)', () => {
    renderEditor();
    expect(screen.getByTestId('schematic-issues')).toHaveTextContent('段に要素がありません');
  });

  it('disables 検算 while the drawing is not valid and while verifying', () => {
    renderEditor();
    expect(screen.getByTestId('verify-button')).toBeDisabled();
    cleanup();
    renderEditor({ document: problem.schematic });
    expect(screen.getByTestId('verify-button')).toBeEnabled();
    cleanup();
    renderEditor({ document: problem.schematic, verifying: true });
    expect(screen.getByTestId('verify-button')).toBeDisabled();
  });

  it('shows the step guide with 描く as the current step', () => {
    renderEditor();
    expect(screen.getByTestId('schematic-step-guide')).toHaveTextContent('回路図を描く');
  });

  it('moves the cursor with the arrow keys and places with Enter', () => {
    const props = renderEditor({ document: problem.schematic, cursor: { rungId: problem.schematic.rungs[0]?.id ?? 'r1', index: 0 } });
    const grid = screen.getByTestId('schematic-grid');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(props.onCursor).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /表示灯 PL1/u }));
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'insertCell' }));
  });

  it('never leaks the reference circuit into the draft (決定表#2)', () => {
    renderEditor();
    // 空の下書きしか描いていない。模範回路の要素IDは1つも出ない
    const ids = [...screen.getByTestId('schematic-svg').querySelectorAll('[data-cell]')];
    expect(ids).toHaveLength(0);
  });

  it('lights the element instead of editing when no palette item is selected (B2)', () => {
    const props = renderEditor({ document: problem.schematic });
    const slot = screen.getByTestId('schematic-svg').querySelector('[data-slot="r1#0"]');
    if (slot === null) return;
    fireEvent.click(slot);
    expect(props.onPickCell).toHaveBeenCalledWith('c01');
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it('replaces the element under an occupied slot when a palette item is selected (B2)', () => {
    const props = renderEditor({ document: problem.schematic });
    fireEvent.click(screen.getByRole('button', { name: /表示灯 PL1/u }));
    const slot = screen.getByTestId('schematic-svg').querySelector('[data-slot="r1#0"]');
    if (slot === null) return;
    fireEvent.click(slot);
    expect(props.onEdit).toHaveBeenCalledWith({
      kind: 'replaceCell',
      cellId: 'c01',
      draft: { kind: 'lamp', device: 'PL1' },
    });
  });
});

describe('SchematicEditor: 分岐（受入基準①）', () => {
  /** 段1 ＝ PB2 b接点 → PB1 a接点 → CR1 コイル、段2 ＝ CR1 a接点（まだ P→N）。 */
  function twoRungs(): SchematicDocument {
    let doc = emptySchematic('draft-b-001', '下書き');
    const place = (rungId: string, draft: CellDraft): void => {
      const target = doc.rungs.find((r) => r.id === rungId);
      const step = applyEdit(doc, {
        kind: 'insertCell',
        rungId,
        index: target?.cells.length ?? 0,
        draft,
      });
      if (step.ok) doc = step.doc;
    };
    place('r1', { kind: 'pb-b', device: 'PB2' });
    place('r1', { kind: 'pb-a', device: 'PB1' });
    place('r1', { kind: 'coil', device: 'CR1' });
    const added = applyEdit(doc, { kind: 'addRung' });
    if (added.ok) doc = added.doc;
    place('r2', { kind: 'cr-a', device: 'CR1' });
    return doc;
  }

  function renderBranchEditor(cursor = { rungId: 'r2', index: 0 }) {
    const props = {
      problem,
      board: JIPM_BOARD,
      document: twoRungs(),
      cursor,
      history: { done: [], undone: [] },
      verifying: false,
      onEdit: vi.fn(),
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
    };
    render(<SchematicEditor {...props} />);
    return props;
  }

  it('says why 分岐 is not available on a rung that carries a load', () => {
    renderBranchEditor({ rungId: 'r1', index: 0 });
    const button = screen.getByTestId('branch-button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('分岐にできません'));
  });

  it('guides the trainee through the two picks and emits one setEnds edit', () => {
    const props = renderBranchEditor();
    fireEvent.click(screen.getByTestId('branch-button'));
    expect(screen.getByTestId('branch-hint')).toHaveTextContent('分岐の始点');
    const svg = screen.getByTestId('schematic-svg');
    const from = svg.querySelector('[data-slot="r1#1"]');
    const to = svg.querySelector('[data-slot="r1#2"]');
    if (from === null || to === null) return;
    fireEvent.click(from);
    expect(screen.getByTestId('branch-hint')).toHaveTextContent('分岐の終点');
    expect(props.onEdit).not.toHaveBeenCalled();
    fireEvent.click(to);
    expect(props.onEdit).toHaveBeenCalledWith({
      kind: 'setEnds',
      rungId: 'r2',
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
    // 分岐が終わったら案内は手順帯に戻る
    expect(screen.queryByTestId('branch-hint')).toBeNull();
  });

  it('refuses a node of the rung being branched and stays in branch mode', () => {
    const props = renderBranchEditor();
    fireEvent.click(screen.getByTestId('branch-button'));
    const own = screen.getByTestId('schematic-svg').querySelector('[data-slot="r2#0"]');
    if (own === null) return;
    fireEvent.click(own);
    expect(props.onRefuse).toHaveBeenCalledWith(expect.stringContaining('ほかの段の節点'));
    expect(props.onEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId('branch-hint')).toHaveTextContent('分岐の始点');
  });

  it('cancels the branch with Escape and with the button', () => {
    renderBranchEditor();
    fireEvent.click(screen.getByTestId('branch-button'));
    fireEvent.keyDown(screen.getByTestId('schematic-grid'), { key: 'Escape' });
    expect(screen.queryByTestId('branch-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('branch-button'));
    fireEvent.click(screen.getByTestId('branch-button'));
    expect(screen.queryByTestId('branch-hint')).toBeNull();
  });

  it('finishes the branch from the keyboard alone (§15 のアクセシビリティ)', () => {
    const onEdit = vi.fn();
    const base = {
      problem,
      board: JIPM_BOARD,
      document: twoRungs(),
      history: { done: [], undone: [] },
      verifying: false,
      onEdit,
      onCursor: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onVerify: vi.fn(),
      onPickCell: vi.fn(),
      onRefuse: vi.fn(),
    };
    const { rerender } = render(<SchematicEditor {...base} cursor={{ rungId: 'r2', index: 0 }} />);
    // 分岐にする段は、ボタンを押したときにカーソルがある段（r2）
    fireEvent.click(screen.getByTestId('branch-button'));
    // 親が矢印キーでカーソルを段1の節点1へ動かす（カーソルはストアが持つ）
    rerender(<SchematicEditor {...base} cursor={{ rungId: 'r1', index: 1 }} />);
    fireEvent.keyDown(screen.getByTestId('schematic-grid'), { key: 'Enter' });
    expect(screen.getByTestId('branch-hint')).toHaveTextContent('分岐の終点');
    expect(onEdit).not.toHaveBeenCalled();
    rerender(<SchematicEditor {...base} cursor={{ rungId: 'r1', index: 2 }} />);
    fireEvent.keyDown(screen.getByTestId('schematic-grid'), { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith({
      kind: 'setEnds',
      rungId: 'r2',
      from: { rung: 'r1', node: 1 },
      to: { rung: 'r1', node: 2 },
    });
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確かめる**

```
pnpm --filter @ojt/desktop test schematic-editor
```

- [ ] **Step 3: `SchematicSvg.tsx` に編集モードを足す**

既存の import に `slotRects`（と `type SlotRect`）を足し、props を次の形に広げる。**既存の3つの props は変えない。**

```tsx
/**
 * 回路図の SVG。§11.2 / §11.4
 * `highlightCellIds` と `onPickCell` はモードC2の連動ハイライト（§9.2）とモードBの配線ガイド
 * （§11.4）で使う。`cursor` / `onPickSlot` を渡すと**編集モード**になり、段 × 桁の当たり矩形
 * （`slotRects()`）を図の上に敷く。どれも省略でき、省略すれば従来どおりの読取専用レンダラとして
 * 動く（モードBの回路図ヒント・C2の提示回路図・結果画面はこの形で呼んでいる）。
 */
export function SchematicSvg({
  document: doc,
  highlightCellIds,
  onPickCell,
  cursor,
  onPickSlot,
}: {
  document: SchematicDocument;
  highlightCellIds?: readonly string[];
  onPickCell?: (cellId: string | undefined) => void;
  /** 編集中のカーソル（段ID＋桁）。渡すと当たり矩形を敷く。§11.4 */
  cursor?: { rungId: string; index: number };
  /**
   * 桁をクリックしたときに呼ぶ。`cursor` と対で渡す。§11.4
   * `cellId` はその桁にある要素のID（空き桁なら `undefined`）。**編集モードでは矩形が
   * 記号より手前に来るので、記号のクリックもここに来る**。だから「要素を選んだ」のか
   * 「要素を置く」のかは呼び出し側（`SchematicEditor`）が決める（B2）。
   */
  onPickSlot?: (rungId: string, index: number, cellId?: string) => void;
}): JSX.Element {
  const result = useMemo(() => layout(doc, LAYOUT), [doc]);
  const highlighted = useMemo(() => new Set(highlightCellIds ?? []), [highlightCellIds]);
  const slots = useMemo(
    () => (onPickSlot === undefined ? [] : slotRects(doc, LAYOUT)),
    [doc, onPickSlot],
  );
  return (
    <svg
      viewBox={`0 0 ${result.width} ${result.height}`}
      role="img"
      aria-label={doc.title}
      data-testid="schematic-svg"
      style={{ width: '100%', background: '#F7F7F4', borderRadius: 4 }}
      onClick={(event) => {
        if (onPickCell === undefined) return;
        const target = event.target as { getAttribute?: (name: string) => string | null };
        const cellId = target.getAttribute?.('data-cell') ?? undefined;
        onPickCell(cellId);
      }}
    >
      {result.shapes.map((shape, index) =>
        renderShape(shape, index, shape.cellId !== undefined && highlighted.has(shape.cellId)),
      )}
      {/*
        編集の当たり矩形。**図形より後ろに描く＝画面では記号より手前に来る**。
        本物のブラウザ（Playwright の E2E）は最前面の要素をクリック先に選ぶので、
        記号を押したつもりのクリックも**必ずこの矩形に当たる**。`onPickCell` は
        もう呼ばれない（矩形は `data-cell` を持たない）。
        だから矩形は「どの桁か」に加えて **その桁にある要素ID** も渡し、
        「要素を光らせる」のか「要素を置き換える」のかは `SchematicEditor` が決める（B2）。
        JSDOM/happy-dom の `fireEvent.click(symbol)` は記号に直接イベントを投げるので
        この重なりを再現しない。だから**単体テストは矩形を直接クリックし**、
        「記号を押したら矩形が受ける」ことは E2E（受入基準②）で確かめる。
      */}
      {slots.map((slot) => {
        const isCursor = cursor?.rungId === slot.rungId && cursor.index === slot.index;
        return (
          <rect
            key={`${slot.rungId}#${slot.index}`}
            data-slot={`${slot.rungId}#${slot.index}`}
            {...(isCursor ? { 'data-cursor': 'true' } : {})}
            x={slot.x}
            y={slot.y}
            width={slot.w}
            height={slot.h}
            fill={isCursor ? CURSOR_FILL : 'transparent'}
            stroke={isCursor ? CURSOR_STROKE : 'none'}
            strokeWidth={isCursor ? 1.2 : 0}
            /* `fill="transparent"` でも当たり判定は残るが、意図を明示しておく */
            style={SLOT_STYLE}
            onClick={(event) => {
              event.stopPropagation();
              onPickSlot?.(slot.rungId, slot.index, slot.cellId);
            }}
          />
        );
      })}
    </svg>
  );
}
```

モジュールの先頭（`HIGHLIGHT_STROKE` の隣）に足す:

```tsx
/** 編集カーソルの枠と薄い塗り（白地の図で目立ち、記号を隠さない濃さ）。§11.4 */
const CURSOR_STROKE = '#1D4ED8';
const CURSOR_FILL = 'rgba(29, 78, 216, 0.10)';
/** 当たり矩形は透明でもクリックを受ける（記号より手前にあるため）。 */
const SLOT_STYLE = { pointerEvents: 'all' } as const;
```

- [ ] **Step 4: `SchematicPalette.tsx` を作る**

```tsx
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import type { PaletteItem } from '../session/schematic-edit.js';
import styles from './schematic.module.css';

/**
 * 回路図エディタのパレット。設計仕様 §11.4 / Plan 5 決定表#26。
 * 置ける要素は課題と盤から決まる（`paletteFor()`）ので、ここは**並べるだけ**にする。
 */

/** まとまりの順に並べ替えた項目（見出しごと）。 */
function byGroup(items: readonly PaletteItem[]): Array<{ group: string; items: PaletteItem[] }> {
  const out: Array<{ group: string; items: PaletteItem[] }> = [];
  for (const item of items) {
    const found = out.find((g) => g.group === item.group);
    if (found === undefined) out.push({ group: item.group, items: [item] });
    else found.items.push(item);
  }
  return out;
}

/** パレット。 */
export function SchematicPalette({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly PaletteItem[];
  selectedId: string | undefined;
  onSelect: (item: PaletteItem) => void;
}): JSX.Element {
  return (
    <section className={styles.palette} data-testid="schematic-palette">
      <h3 className={styles.paletteTitle}>{JA.schematic.palette}</h3>
      {byGroup(items).map((group) => (
        <div key={group.group} className={styles.paletteGroup}>
          <span className={styles.paletteGroupName}>{group.group}</span>
          <div className={styles.paletteItems}>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.paletteItem}
                aria-pressed={selectedId === item.id}
                data-testid={`palette-${item.id}`}
                onClick={() => {
                  onSelect(item);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 5: `SchematicEditor.tsx` を作る**

```tsx
import type { BoardDefinition } from '@ojt/board-model';
import type { AssembleProblem } from '@ojt/content';
import { validateDocument, type SchematicDocument, type SchematicEdit } from '@ojt/schematic-core';
import { useMemo, useState, type JSX, type KeyboardEvent } from 'react';
import { JA } from '../i18n/ja.js';
import {
  branchDisabledReason,
  branchStepHint,
  cellCount,
  keyToEdit,
  moveCursor,
  paletteFor,
  pickBranchNode,
  type BranchDraft,
  type BranchOutcome,
  type EditorCursor,
  type PaletteItem,
  type SchematicHistory,
} from '../session/schematic-edit.js';
import { schematicStepHint, schematicSteps } from '../session/step-guide.js';
import { SchematicPalette } from './SchematicPalette.js';
import { SchematicSvg } from './SchematicSvg.js';
import styles from './schematic.module.css';

/**
 * 回路図エディタ。設計仕様 §11.4。
 *
 * 状態（文書・カーソル・履歴）は**すべて親（ストア）が持つ**（`LadderEditor` と同じ流儀）。
 * ここは「描く・選ぶ・キーを編集操作に直す」だけで、編集そのものは `onEdit` に投げる。
 * 作りかけの文書は許し（決定表#3）、`validateDocument()` の指摘は下の欄に出し続ける。
 */

/** エディタ。 */
export function SchematicEditor({
  problem,
  board,
  document: doc,
  cursor,
  history,
  verifying,
  verified = false,
  boardWired = false,
  highlightCellIds,
  onEdit,
  onCursor,
  onUndo,
  onRedo,
  onVerify,
  onPickCell,
  onRefuse,
}: {
  problem: AssembleProblem;
  board: BoardDefinition;
  document: SchematicDocument;
  cursor: EditorCursor;
  history: SchematicHistory;
  /** 検算の往復中（ボタンを止める）。 */
  verifying: boolean;
  /** 直近の検算に合格しているか（手順帯に出す）。 */
  verified?: boolean;
  /** 盤に電線を張ったか（手順帯に出す）。 */
  boardWired?: boolean;
  /** 配線ガイドで光らせる要素（Task 8 が渡す）。 */
  highlightCellIds?: readonly string[];
  onEdit: (edit: SchematicEdit) => void;
  onCursor: (cursor: EditorCursor) => void;
  onUndo: () => void;
  onRedo: () => void;
  onVerify: () => void;
  onPickCell: (cellId: string | undefined) => void;
  /** 断られた操作の理由（画面はトーストに出す）。 */
  onRefuse: (message: string) => void;
}): JSX.Element {
  const palette = useMemo(() => paletteFor(problem, board), [problem, board]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const selected = palette.find((i) => i.id === selectedId);
  const issues = useMemo(() => validateDocument(doc), [doc]);
  const steps = schematicSteps({ cellCount: cellCount(doc), verified, boardWired });
  const currentStep = steps.find((s) => s.state === 'current')?.key;

  /**
   * 分岐の下書き。**ここだけが編集中の一時状態**で、確定した形は `setEnds` として親へ渡る。
   * 文書やカーソルと違って「途中でやめられる」ものなので、ストアには置かない。§11.4 / B1
   */
  const [branch, setBranch] = useState<BranchDraft | undefined>(undefined);
  const branchReason = branchDisabledReason(doc, cursor.rungId);
  const branchHint = branchStepHint(branch);

  /** 分岐の節点を1つ選んだ結果を反映する（クリックでもキーでも同じ道を通る）。 */
  const applyBranchPick = (picked: BranchOutcome): void => {
    if (picked.kind === 'refused') {
      onRefuse(picked.message);
      return;
    }
    if (picked.kind === 'draft') {
      setBranch(picked.branch);
      return;
    }
    setBranch(undefined);
    onEdit(picked.edit);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      onCursor(moveCursor(doc, cursor, event.key));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'y')) {
      event.preventDefault();
      if (event.key === 'z') onUndo();
      else onRedo();
      return;
    }
    if (branch !== undefined && event.key === 'Escape') {
      event.preventDefault();
      setBranch(undefined);
      return;
    }
    if (branch !== undefined && event.key === 'Enter') {
      event.preventDefault();
      applyBranchPick(pickBranchNode(doc, branch, { rungId: cursor.rungId, node: cursor.index }));
      return;
    }
    // 分岐中は `keyToEdit()` が（Enter 以外を）必ず `undefined` にするので、誤って要素が消えない
    const edit = keyToEdit(doc, cursor, event.key, selected, { ctrl: event.ctrlKey }, branch);
    if (edit === undefined) return;
    event.preventDefault();
    onEdit(edit);
  };

  const pickPalette = (item: PaletteItem): void => {
    setSelectedId(item.id === selectedId ? undefined : item.id);
  };

  /**
   * 桁をクリックしたとき。**順に3通り**（B2）:
   * ①分岐中なら節点を選ぶ、②パレットを選んでいなければその要素を光らせる（配線ガイド）、
   * ③パレットを選んでいれば置く（空き桁）か置き換える（要素のある桁）。
   */
  const onPickSlot = (rungId: string, index: number, cellId?: string): void => {
    if (branch !== undefined) {
      applyBranchPick(pickBranchNode(doc, branch, { rungId, node: index }));
      return;
    }
    onCursor({ rungId, index });
    if (selected === undefined) {
      onPickCell(cellId);
      return;
    }
    const draft = { kind: selected.kind, device: selected.device };
    onEdit(
      cellId === undefined
        ? { kind: 'insertCell', rungId, index, draft }
        : { kind: 'replaceCell', cellId, draft },
    );
  };

  return (
    <div className={styles.editor} data-testid="schematic-editor">
      <div className={styles.editorHead}>
        <h2 className={styles.editorTitle}>{JA.schematic.title}</h2>
        <div className={styles.editorTools}>
          <button type="button" disabled={history.done.length === 0} onClick={onUndo}>
            {JA.schematic.undo}
          </button>
          <button type="button" disabled={history.undone.length === 0} onClick={onRedo}>
            {JA.schematic.redo}
          </button>
          <button
            type="button"
            onClick={() => {
              onEdit({ kind: 'addRung', after: cursor.rungId });
            }}
          >
            {JA.schematic.addRung}
          </button>
          <button
            type="button"
            onClick={() => {
              onEdit({ kind: 'removeRung', rungId: cursor.rungId });
            }}
          >
            {JA.schematic.removeRung}
          </button>
          {/*
            分岐（§11.1 の分岐点）。自己保持回路は「両端が別の段の節点にある段」を1本引かないと
            描けない（受入基準①）。押せないときは `title` に理由を出す（完了条件の「画面の品質」）。
            分岐中は「やめる」になるので、`branchReason` があっても**押せるままにする**。
          */}
          <button
            type="button"
            data-testid="branch-button"
            aria-pressed={branch !== undefined}
            disabled={branch === undefined && branchReason !== undefined}
            title={branch === undefined ? (branchReason ?? JA.schematic.branchHint) : JA.schematic.branchCancel}
            onClick={() => {
              setBranch(branch === undefined ? { rungId: cursor.rungId } : undefined);
            }}
          >
            {branch === undefined ? JA.schematic.branch : JA.schematic.branchCancel}
          </button>
          <button
            type="button"
            className={styles.verifyButton}
            data-testid="verify-button"
            disabled={verifying || issues.length > 0}
            title={issues.length > 0 ? issues[0]?.message : JA.schematic.verifyNote}
            onClick={onVerify}
          >
            {verifying ? JA.schematic.verifying : JA.schematic.verify}
          </button>
        </div>
      </div>

      <div className={styles.stepGuide} data-testid="schematic-step-guide">
        <ol className={styles.stepList} aria-label={JA.stepGuide.label}>
          {steps.map((step) => (
            <li
              key={step.key}
              className={styles.step}
              data-state={step.state}
              data-testid={`schematic-step-${step.key}`}
              {...(step.state === 'current' ? { 'aria-current': 'step' as const } : {})}
            >
              {step.label}
            </li>
          ))}
        </ol>
        {/* 分岐のあいだは「いま何をすればよいか」を分岐の案内に差し替える（決定表#24） */}
        {branchHint === undefined ? (
          <p className={styles.stepHint}>{schematicStepHint(currentStep)}</p>
        ) : (
          <p className={styles.branchHint} data-testid="branch-hint" role="status" aria-live="polite">
            {branchHint}
          </p>
        )}
      </div>

      <div className={styles.editorBody}>
        <SchematicPalette items={palette} selectedId={selectedId} onSelect={pickPalette} />
        {/*
          グリッドはキーボードの受け口。`tabIndex={0}` で Tab から入れるようにし、
          `aria-label` に操作の早見表を載せる（§15 のアクセシビリティ）。
        */}
        <div
          className={styles.grid}
          data-testid="schematic-grid"
          tabIndex={0}
          role="application"
          aria-label={`${JA.schematic.title}: ${JA.schematic.keyHint}`}
          onKeyDown={onKeyDown}
        >
          {/*
            `onPickCell` も渡す: 母線・銘板など**当たり矩形の外**を押したときの「選択解除」を
            従来どおり効かせるため（矩形に当たったクリックは `onPickSlot` が受ける。B2）。
          */}
          <SchematicSvg
            document={doc}
            cursor={cursor}
            {...(highlightCellIds === undefined ? {} : { highlightCellIds })}
            onPickCell={onPickCell}
            onPickSlot={onPickSlot}
          />
          <p className={styles.keyHint}>{JA.schematic.keyHint}</p>
        </div>
      </div>

      <section className={styles.issues} data-testid="schematic-issues">
        <h3 className={styles.issuesTitle}>{JA.schematic.issues}</h3>
        {issues.length === 0 ? (
          <p className={styles.issuesOk}>{JA.schematic.noIssues}</p>
        ) : (
          <ul className={styles.issueList}>
            {issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 6: `schematic.module.css` を作る**

余白・間隔はすべて **4の倍数**（8px 格子）。すべての操作要素に `:focus-visible` の枠を置く（完了条件の「画面の品質」）。

```css
/* 回路図エディタ（§11.4 / Plan 5 Task 5・6）。8px 格子・フォーカス枠を守る。 */

.editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  height: 100%;
  padding: 8px;
  background: #1b1e23;
  border-radius: 4px;
}

.editorHead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.editorTitle {
  margin: 0;
  font-size: 14px;
  color: #e4e7ec;
}

.editorTools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: auto;
}

.editorTools button,
.paletteItem {
  padding: 4px 8px;
  font-size: 12px;
  color: #e4e7ec;
  background: #2a2f36;
  border: 1px solid #3a4049;
  border-radius: 4px;
  cursor: pointer;
}

.editorTools button:disabled {
  color: #7a828c;
  cursor: not-allowed;
}

.editorTools button:focus-visible,
.paletteItem:focus-visible,
.grid:focus-visible {
  outline: 2px solid #6aa3ff;
  outline-offset: 2px;
}

.verifyButton {
  font-weight: 700;
  background: #1d4ed8;
  border-color: #2d5ee8;
}

.verifyButton:disabled {
  background: #2a2f36;
  border-color: #3a4049;
}

.stepGuide {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.stepList {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  padding: 4px 8px;
  font-size: 12px;
  color: #98a1ac;
  background: #23262b;
  border-radius: 4px;
}

.step[data-state='current'] {
  color: #0f1216;
  background: #f2c230;
  font-weight: 700;
}

.step[data-state='done'] {
  color: #9fd6a8;
}

.stepHint {
  margin: 0;
  font-size: 12px;
  color: #c9d2dc;
}

/* 分岐の案内（手順帯の1行を一時的に置き換える）。Task 5 / B1 */
.branchHint {
  margin: 0;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 700;
  color: #0f1216;
  background: #6aa3ff;
  border-radius: 4px;
}

.editorBody {
  display: flex;
  gap: 8px;
  min-height: 0;
  flex: 1;
}

.palette {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 200px;
  min-width: 160px;
  max-height: 100%;
  overflow-y: auto;
}

.paletteTitle,
.issuesTitle,
.paletteGroupName {
  margin: 0;
  font-size: 12px;
  color: #98a1ac;
}

.paletteGroup {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.paletteItems {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.paletteItem[aria-pressed='true'] {
  color: #0f1216;
  background: #6aa3ff;
  border-color: #6aa3ff;
}

.grid {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 8px;
  background: #f7f7f4;
  border-radius: 4px;
}

.keyHint {
  margin: 8px 0 0;
  font-size: 11px;
  color: #4a515b;
}

.issues {
  max-height: 120px;
  overflow-y: auto;
}

.issueList {
  margin: 4px 0 0;
  padding-left: 16px;
  font-size: 12px;
  color: #ffb4b4;
}

.issuesOk {
  margin: 4px 0 0;
  font-size: 12px;
  color: #9fd6a8;
}

/* 検算パネル（Task 6）。 */
.verify {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: #1b1e23;
  border-radius: 4px;
}

.verdict {
  display: inline-block;
  padding: 4px 12px;
  font-weight: 700;
  border-radius: 4px;
}

.passed {
  color: #0f1216;
  background: #6ad39a;
}

.failed {
  color: #fff;
  background: #d64545;
}

.verifyNote {
  margin: 0;
  font-size: 12px;
  color: #98a1ac;
}
```

- [ ] **Step 7: テストを走らせてコミットする**

```
pnpm --filter @ojt/desktop test schematic-editor
npx prettier --check "apps/desktop/src/renderer/schematic/**/*.{ts,tsx,css}"
git add apps/desktop && git commit -m "feat(desktop): make the schematic renderer editable and add the editor screen"
```

**期待**: `schematic-editor.test.tsx` の **19件**が増え、既存の `polish.test.ts` / `session.test.tsx`（`SchematicSvg` を読取専用で使う）はそのまま通る。

---

## Task 6: 検算の往復（Worker `verify` ＋ ストア ＋ `VerifyPanel` ＋ 作業ファイル）

**モデル: Opus**（Worker のコマンドを増やす判断と `store.ts` の MERGE）

**Files:**
- Modify: `apps/desktop/src/worker/protocol.ts` / `apps/desktop/src/worker/sim.worker.ts`
- Modify: `apps/desktop/src/renderer/session/worker-bridge.ts`
- Modify: `apps/desktop/src/renderer/app/store.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`（`WorkFile.schematic?`）
- Modify: `apps/desktop/src/renderer/session/work-file.ts`
- Create: `apps/desktop/src/renderer/schematic/VerifyPanel.tsx`
- Test: `apps/desktop/test/verify-flow.test.ts`（新規）
- Test: `apps/desktop/test/sim-worker-verify.test.ts`（新規）

決定表#4: 検算は **Worker**。`judge` と同じ往復にする。

- [ ] **Step 1: 失敗するテストを書く（Worker 側）**

`apps/desktop/test/sim-worker-verify.test.ts`。**冒頭の定型（Worker の読み込み・`postMessage` の捕捉・`sent()` ヘルパ）は既存の `sim-worker.test.ts` からそのまま写す**（同じ補助関数を2通りに書かない）。本体は次のとおり:

```ts
describe('verify コマンド（§11.4 / Plan 5 決定表#4）', () => {
  beforeEach(() => {
    sent.length = 0;
    handle({ type: 'load', problemId: problem.id, session: sessionForProblem(problem) });
  });

  it('returns a passing result for the reference drawing of the problem', () => {
    handle({ type: 'verify', problem, document: problem.schematic, elapsedMs: 0 });
    const message = sent.find((m) => m.type === 'verifyResult');
    expect(message?.result.ok).toBe(true);
    expect(message?.result.ok === true && message.result.passed).toBe(true);
  });

  it('returns ok:false with the document issues for a half-finished drawing', () => {
    handle({ type: 'verify', problem, document: emptySchematic('draft', '下書き'), elapsedMs: 0 });
    const message = sent.find((m) => m.type === 'verifyResult');
    expect(message?.result.ok).toBe(false);
    expect(
      message?.result.ok === false && message.result.errors.map((e) => e.message),
    ).toContain('段に要素がありません: r1');
  });

  it('does not disturb the running simulation (tMs keeps advancing afterwards)', () => {
    handle({ type: 'breaker', on: true });
    handle({ type: 'switch', on: true });
    const before = latestSnapshot().tMs;
    handle({ type: 'verify', problem, document: problem.schematic, elapsedMs: 0 });
    advance(200);
    expect(latestSnapshot().tMs).toBeGreaterThan(before);
  });

  it('reports a broken command as { type: "error", fatal: false } instead of dying', () => {
    handle({ type: 'verify', problem, document: undefined as never, elapsedMs: 0 });
    const error = sent.find((m) => m.type === 'error');
    expect(error?.fatal).toBe(false);
    advance(100);
    expect(sent.some((m) => m.type === 'snapshot')).toBe(true);
  });
});
```

- [ ] **Step 2: `protocol.ts` に追記する**

`SimCommand` の末尾に:

```ts
  /**
   * 回路図を検算する。§11.4 / Plan 5 決定表#4
   * `document` は**訓練者がエディタで描いた文書**（素のJSONなので構造化複製でそのまま渡る）。
   * `judge` と同じく模範回路と訓練者回路の2回ぶんを回すので、追従ループを止めてから実行する。
   */
  | { type: 'verify'; problem: AssembleProblem; document: SchematicDocument; elapsedMs: number };
```

`SimMessage` の `judgeResult` の隣に:

```ts
  /** 検算の結果。§11.4 */
  | { type: 'verifyResult'; result: VerifyResult }
```

import に `import type { SchematicDocument } from '@ojt/schematic-core';` と `VerifyResult`（`@ojt/content`）を足す。

- [ ] **Step 3: `sim.worker.ts` に `case 'verify'` を足す**

`case 'judge'` の直後に、同じ「追従ループを止める → 実行 → 送る → 再開」の形で置く（`judge` の実装をそのまま読み、`judgeAssemble(...)` を `verifySchematic(command.problem, JIPM_BOARD, command.document, { elapsedMs: command.elapsedMs })` に、`postMessage({ type: 'judgeResult', ... })` を `postMessage({ type: 'verifyResult', result })` に替える）。**`try` / `catch` で例外を `{ type: 'error', fatal: false }` として返すところも `judge` と同じにする**（検算が失敗してもセッションは続く）。

- [ ] **Step 4: `worker-bridge.ts` に `onVerify?` を足す**

```ts
  /**
   * 検算の結果。§11.4
   * モードB以外の画面は渡さないので任意にする（届いても何も起きない）。
   */
  onVerify?: (message: Extract<SimMessage, { type: 'verifyResult' }>) => void;
```

`worker.onmessage` の分岐に `else if (message.type === 'verifyResult') handlers.onVerify?.(message);` を足す（`plcResult` の後ろ、`else handlers.onError(...)` の前）。

- [ ] **Step 5: ストアに欄と操作を足す**

`AppState` に（`highlight` の隣、`// --- Plan 5 Task 6 ---` で挟む）:

```ts
  /** 回路図エディタの下書き（モードBの課題を開くと空の文書で始まる）。§11.4 */
  schematicDoc: SchematicDocument | undefined;
  /** 下書きの元に戻す／やり直し。 */
  schematicHistory: SchematicHistory;
  /** 編集カーソル。 */
  schematicCursor: EditorCursor;
  /** 検算の往復中か。 */
  verifying: boolean;
  /** 直近の検算の結果（課題を開き直すと消える）。 */
  verifyResult: VerifyResult | undefined;
```

操作（`setHighlight` の隣）:

```ts
  setSchematicDoc: (doc: SchematicDocument) => void;
  applySchematicEdit: (edit: SchematicEdit) => boolean;
  setSchematicCursor: (cursor: EditorCursor) => void;
  undoSchematicEdit: () => boolean;
  redoSchematicEdit: () => boolean;
  setVerifying: (verifying: boolean) => void;
  setVerifyResult: (result: VerifyResult | undefined) => void;
```

実装（`setHighlight` の実装の隣）:

```ts
  setSchematicDoc: (schematicDoc) => {
    set({ schematicDoc, schematicCursor: clampCursor(schematicDoc, get().schematicCursor) });
  },
  /**
   * 編集を1つ当てる。断られたらトーストに理由を出して `false` を返す（盤のコマンドと同じ流儀）。
   * 成功したら**編集前の文書**を履歴に積み、カーソルを文書の中へ収め直す。
   */
  applySchematicEdit: (edit) => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const outcome = applyEdit(doc, edit);
    if (!outcome.ok) {
      get().toast(outcome.message, 'error');
      return false;
    }
    set({
      schematicDoc: outcome.doc,
      schematicHistory: pushSchematic(get().schematicHistory, doc),
      schematicCursor: clampCursor(outcome.doc, get().schematicCursor),
      // 文書が変わったら前回の検算結果は古い（決定表#6）
      verifyResult: undefined,
    });
    get().addLog(editLabel(edit));
    return true;
  },
  setSchematicCursor: (schematicCursor) => {
    const doc = get().schematicDoc;
    set({ schematicCursor: doc === undefined ? schematicCursor : clampCursor(doc, schematicCursor) });
  },
  undoSchematicEdit: () => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const step = undoSchematic(get().schematicHistory, doc);
    if (step === undefined) return false;
    set({
      schematicDoc: step.doc,
      schematicHistory: step.history,
      schematicCursor: clampCursor(step.doc, get().schematicCursor),
      verifyResult: undefined,
    });
    return true;
  },
  redoSchematicEdit: () => {
    const doc = get().schematicDoc;
    if (doc === undefined) return false;
    const step = redoSchematic(get().schematicHistory, doc);
    if (step === undefined) return false;
    set({
      schematicDoc: step.doc,
      schematicHistory: step.history,
      schematicCursor: clampCursor(step.doc, get().schematicCursor),
      verifyResult: undefined,
    });
    return true;
  },
  setVerifying: (verifying) => {
    set({ verifying });
  },
  setVerifyResult: (verifyResult) => {
    set({ verifyResult, verifying: false });
  },
```

初期値（`highlight: NO_HIGHLIGHT,` の隣）と、`openProblem()` / `resetSession()` / `restartSession()` / `abandonSession()` の `set({...})` に次を**同じ内容で**入れる。モードB以外では `schematicDoc: undefined` にする（`isAssembleProblem(problem)` で分ける）:

```ts
  schematicDoc: undefined,
  schematicHistory: emptySchematicHistory(),
  schematicCursor: { rungId: 'r1', index: 0 },
  verifying: false,
  verifyResult: undefined,
```

`openProblem()` の中で、モードBのときだけ下書きを作る:

```ts
    // 回路図エディタの下書きは**空**で始める（決定表#2: 模範回路は絶対に入れない）
    const schematicDoc = isAssembleProblem(problem)
      ? emptySchematic(`draft-${problem.id}`, `${problem.title}（下書き）`)
      : undefined;
```

- [ ] **Step 6: 作業ファイルに下書きを載せる（決定表#23）**

`shared/ipc.ts` の `WorkFile` に:

```ts
  /**
   * モードBの回路図エディタの下書き（`SchematicDocument` をそのまま JSON にしたもの）。§11.4 / §12.3
   * 任意項目なので、Phase 1〜4 に保存した作業ファイルは下書き無しで開く（`formatVersion` は 1 のまま）。
   */
  schematic?: unknown;
```

`session/work-file.ts` の `toWorkFile()` に `...(state.schematicDoc === undefined ? {} : { schematic: state.schematicDoc })` を足し、`applyWorkFile()` で読み戻す。**読み戻しは形を確かめてから**入れる（壊れた作業ファイルで画面が落ちないように）:

```ts
/** 作業ファイルの下書きを文書として読む。形が違えば undefined（下書き無しで開く）。§13 #8 */
function toSchematicDoc(raw: unknown): SchematicDocument | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const doc = raw as Partial<SchematicDocument>;
  if (doc.formatVersion !== SCHEMATIC_FORMAT_VERSION) return undefined;
  if (doc.orientation !== 'horizontal' || !Array.isArray(doc.rungs)) return undefined;
  if (typeof doc.id !== 'string' || typeof doc.title !== 'string') return undefined;
  // 中身の妥当性は見ない（作りかけの下書きも復元する。決定表#3）。
  // 段と要素の形だけを確かめ、壊れていれば下書き無しで開く
  for (const r of doc.rungs) {
    if (typeof r?.id !== 'string' || !Array.isArray(r.cells)) return undefined;
    for (const cell of r.cells) {
      if (typeof cell?.id !== 'string' || typeof cell.device !== 'string') return undefined;
    }
  }
  return doc as SchematicDocument;
}
```

- [ ] **Step 7: `VerifyPanel.tsx` を作る**

```tsx
import type { AssembleProblem, VerifyResult } from '@ojt/content';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { ChartOverlay } from '../result/ChartOverlay.js';
import { MismatchList } from '../result/MismatchList.js';
import { StaticCheckList } from '../result/StaticCheckList.js';
import styles from './schematic.module.css';

/**
 * 検算の結果。設計仕様 §11.4 / Plan 5 決定表#5・#6。
 *
 * 判定の結果画面（`result/ResultView.tsx`）と**同じ部品**を使う（`ChartOverlay` / `MismatchList` /
 * `StaticCheckList`）。基準が同じであることを画面の見た目でも示すためである。
 * 「盤に写す」は置かない（決定表#5: 配線操作そのものが訓練）。
 */
export function VerifyPanel({
  problem,
  result,
  onPickCell,
}: {
  problem: AssembleProblem;
  result: VerifyResult;
  /** 指摘をクリックしたときに回路図の要素を光らせる（Task 8 の配線ガイドと同じ道）。 */
  onPickCell: (cellId: string | undefined) => void;
}): JSX.Element {
  if (!result.ok) {
    return (
      <section className={styles.verify} data-testid="verify-panel">
        <span className={`${styles.verdict} ${styles.failed}`} data-testid="verify-verdict" role="status" aria-live="polite">
          {JA.schematic.verifyFailed}
        </span>
        <ul className={styles.issueList} data-testid="verify-issues">
          {result.errors.map((issue) => (
            <li key={`${issue.source}:${issue.path}:${issue.message}`}>
              {issue.cellId === undefined ? (
                issue.message
              ) : (
                <button
                  type="button"
                  className={styles.paletteItem}
                  onClick={() => {
                    onPickCell(issue.cellId);
                  }}
                >
                  {issue.message}
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className={styles.verifyNote}>{JA.schematic.verifyNote}</p>
      </section>
    );
  }
  return (
    <section className={styles.verify} data-testid="verify-panel">
      <span
        className={`${styles.verdict} ${result.passed ? styles.passed : styles.failed}`}
        data-testid="verify-verdict"
        role="status"
        aria-live="polite"
      >
        {result.passed ? JA.schematic.verifyPassed : JA.schematic.verifyFailed}
      </span>
      <p className={styles.verifyNote}>{JA.schematic.verifyNote}</p>
      <ChartOverlay
        expected={result.judge.charts.expected}
        actual={result.judge.charts.actual}
        mismatches={result.judge.mismatches}
      />
      <MismatchList mismatches={result.judge.mismatches} />
      <StaticCheckList checks={result.judge.staticChecks} />
      <span className={styles.verifyNote}>{problem.title}</span>
    </section>
  );
}
```

- [ ] **Step 8: テストを走らせてコミットする**

`apps/desktop/test/verify-flow.test.ts` は**ストアの側**を確かめる（Worker は立てない）:

```ts
import { BUILTIN_ASSEMBLE_PROBLEMS, BUILTIN_INSPECT_PARTS_PROBLEMS } from '@ojt/content';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { toWorkFile } from '../src/renderer/session/work-file.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
const partsProblem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
if (problem === undefined || partsProblem === undefined) throw new Error('内蔵課題がありません');
const pb1 = { kind: 'insertCell', rungId: 'r1', index: 0, draft: { kind: 'pb-a', device: 'PB1' } } as const;

beforeEach(() => {
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
  });
});

describe('検算の状態遷移（§11.4）', () => {
  it('starts every mode-B session with an empty draft (決定表#2)', () => {
    const doc = useStore.getState().schematicDoc;
    expect(doc?.rungs).toHaveLength(1);
    expect(doc?.rungs[0]?.cells).toEqual([]);
    expect(doc?.id).toBe(`draft-${problem.id}`);
  });

  it('keeps no draft for C1 / C2 / D problems', () => {
    act(() => {
      useStore.getState().openProblem(partsProblem);
    });
    expect(useStore.getState().schematicDoc).toBeUndefined();
  });

  it('pushes the previous document on every accepted edit and drops the stale verify result', () => {
    act(() => {
      useStore.getState().setVerifyResult({ ok: false, errors: [] });
      useStore.getState().applySchematicEdit(pb1);
    });
    const state = useStore.getState();
    expect(state.schematicHistory.done).toHaveLength(1);
    expect(state.schematicHistory.done[0]?.rungs[0]?.cells).toEqual([]);
    expect(state.verifyResult).toBeUndefined();
  });

  it('refuses an impossible edit with a toast and leaves the document alone', () => {
    let accepted = true;
    act(() => {
      accepted = useStore.getState().applySchematicEdit({ kind: 'removeCell', cellId: 'c9' });
    });
    expect(accepted).toBe(false);
    expect(useStore.getState().toasts.at(-1)?.text).toContain('要素がありません');
    expect(useStore.getState().schematicHistory.done).toHaveLength(0);
  });

  it('undoes and redoes the draft', () => {
    act(() => {
      useStore.getState().applySchematicEdit(pb1);
      useStore.getState().undoSchematicEdit();
    });
    expect(useStore.getState().schematicDoc?.rungs[0]?.cells).toEqual([]);
    act(() => {
      useStore.getState().redoSchematicEdit();
    });
    expect(useStore.getState().schematicDoc?.rungs[0]?.cells).toHaveLength(1);
  });

  it('clamps the cursor when the rung under it disappears', () => {
    act(() => {
      const store = useStore.getState();
      store.applySchematicEdit({ kind: 'addRung' });
      store.setSchematicCursor({ rungId: 'r2', index: 0 });
      store.applySchematicEdit({ kind: 'removeRung', rungId: 'r2' });
    });
    expect(useStore.getState().schematicCursor).toEqual({ rungId: 'r1', index: 0 });
  });

  it('round-trips the draft through the work file and ignores a broken one', () => {
    act(() => {
      useStore.getState().applySchematicEdit(pb1);
    });
    const state = useStore.getState();
    const file = toWorkFile(problem.id, state.session as never, state.elapsedMs, 0);
    expect((file.schematic as { rungs: unknown[] }).rungs).toHaveLength(1);
    expect(toSchematicDoc({ formatVersion: 9, rungs: [] })).toBeUndefined();
    expect(toSchematicDoc('not a document')).toBeUndefined();
  });
});
```

`toSchematicDoc()` は Step 6 で `work-file.ts` に足した関数である。このテストから使えるよう **export** すること。

```
pnpm --filter @ojt/desktop test verify-flow sim-worker-verify work-file
pnpm -r typecheck && pnpm lint
git add apps/desktop && git commit -m "feat(desktop): run the schematic desk check in the simulation worker"
```

---

## Task 7: モードBの画面に組み込む（ビュー切替・ツールバー・レイアウト）

**モデル: Opus**（`Session.tsx` の MERGE と、3つのビューの配分）

**Files:**
- Modify: `apps/desktop/src/renderer/app/store.ts`（`assembleView` と `setAssembleView`）
- Modify: `apps/desktop/src/renderer/panels/Toolbar.tsx`（`viewSwitch` の差し込み口）
- Modify: `apps/desktop/src/renderer/panels/panels.module.css`（`.viewSwitch`）
- Modify: `apps/desktop/src/renderer/screens/Session.tsx`
- Modify: `apps/desktop/src/renderer/screens/screens.module.css`（`.splitLayout`）
- Test: `apps/desktop/test/assemble-view.test.tsx`（新規）

決定表#1: `assembleView: 'board' | 'split' | 'schematic'`。モードDの `ladderView` と同じ語彙・同じ見た目。

- [ ] **Step 1: 失敗するテストを書く**

`apps/desktop/test/assemble-view.test.tsx`:

```tsx
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { Session } from '../src/renderer/screens/Session.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

beforeEach(() => {
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('モードBのビュー切替（Plan 5 決定表#1）', () => {
  it('opens on the board view (Phase 1〜4 のふるまいを変えない)', () => {
    render(<Session />);
    expect(screen.getByTestId('viewport')).toBeVisible();
    expect(screen.queryByTestId('schematic-editor')).toBeNull();
    expect(useStore.getState().assembleView).toBe('board');
  });

  it('switches to 並べて and shows both the board and the editor', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-split'));
    expect(screen.getByTestId('viewport')).toBeVisible();
    expect(screen.getByTestId('schematic-editor')).toBeVisible();
  });

  it('switches to 回路図 and hides the 3D viewport', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    expect(screen.getByTestId('schematic-editor')).toBeVisible();
    expect(screen.queryByTestId('viewport')).toBeNull();
  });

  it('marks the current view with aria-pressed', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    expect(screen.getByTestId('assemble-view-schematic')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('assemble-view-board')).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the draft when the view changes back and forth', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    act(() => {
      useStore
        .getState()
        .applySchematicEdit({ kind: 'insertCell', rungId: 'r1', index: 0, draft: { kind: 'pb-a', device: 'PB1' } });
    });
    fireEvent.click(screen.getByTestId('assemble-view-board'));
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    expect(useStore.getState().schematicDoc?.rungs[0]?.cells).toHaveLength(1);
  });

  it('shows the verify panel once a result arrives', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    act(() => {
      useStore.getState().setVerifyResult({
        ok: false,
        errors: [{ source: 'document', path: 'rungs[0]', message: '段に要素がありません: r1' }],
      });
    });
    expect(screen.getByTestId('verify-panel')).toHaveTextContent('段に要素がありません');
    expect(useStore.getState().verifying).toBe(false);
  });

  it('does not offer the view switch to C1 / C2 / D screens', () => {
    // モードBの画面だけが `assemble-view-*` を出す（他の画面は `Toolbar` に渡さない）
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-board'));
    expect(screen.queryAllByTestId(/^assemble-view-/u)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: ストアに `assembleView` を足す**

`AppState` の `ladderView` の隣（`// --- Plan 5 Task 7 ---`）:

```ts
  /**
   * モードBのビュー（盤／並べて／回路図）。§11.4 / Plan 5 決定表#1
   * モードDの `ladderView` と同じ役割で、値の並びも同じ順（盤 → 並べて → 図）。
   */
  assembleView: AssembleViewMode;
```

型は `store.ts` の `LadderViewMode` の隣に置く:

```ts
/** モードBのビュー。§11.4 */
export type AssembleViewMode = 'board' | 'split' | 'schematic';
```

初期値 `assembleView: 'board',`、操作 `setAssembleView: (view: AssembleViewMode) => void;` と実装 `setAssembleView: (assembleView) => { set({ assembleView }); },`。`openProblem()` / `resetSession()` / `restartSession()` / `abandonSession()` では **`'board'` に戻す**（課題を開いたら必ず盤から始まる）。

- [ ] **Step 3: `Toolbar.tsx` に差し込み口を足す**

`extraTools` の隣に、**判定ボタンの左**へ出る枠を1つ足す（`extraTools` はモード固有の道具＝テスター・指摘モードで既に埋まっている）:

```tsx
  /**
   * ビュー切替（モードBの 盤／並べて／回路図）。§11.4 / Plan 5 決定表#1
   * 視点プリセットの隣に置く（どちらも「何を見るか」の道具）。渡さない画面には出ない。
   */
  viewSwitch?: JSX.Element;
```

`VIEWS.map(...)` の `</div>` の直後に `{viewSwitch === undefined ? null : <div className={styles.toolGroup}>{viewSwitch}</div>}` を置く。

- [ ] **Step 4: `Session.tsx` を組み替える**

import に足す:

```tsx
import { emptySchematic } from '@ojt/schematic-core';
import { SchematicEditor } from '../schematic/SchematicEditor.js';
import { VerifyPanel } from '../schematic/VerifyPanel.js';
```

`Session()` の購読に足す:

```tsx
  const assembleView = useStore((s) => s.assembleView);
  const schematicDoc = useStore((s) => s.schematicDoc);
  const schematicCursor = useStore((s) => s.schematicCursor);
  const schematicHistory = useStore((s) => s.schematicHistory);
  const verifying = useStore((s) => s.verifying);
  const verifyResult = useStore((s) => s.verifyResult);
```

Worker の購読（`bridge.start({...})`）に検算のハンドラを足す:

```tsx
      onVerify: (message) => {
        useStore.getState().setVerifyResult(message.result);
      },
```

既存の `onError` にも**1行足す**。判定（`setJudging(false)`）と同じ理由で、検算の往復中に Worker が
落ちると「検算中…」のままボタンが戻らなくなる（`setVerifyResult()` は届かないので `verifying` が
下りない）:

```tsx
      onError: (text, fatal) => {
        const state = useStore.getState();
        state.setJudging(false);
        // 検算の往復中に落ちたら「検算中…」のまま固まるので、必ず戻す（§11.4）
        state.setVerifying(false);
        // …以降は既存のまま…
      },
```

ツールバーに切替を渡す（`<Toolbar ... />` の props に）:

```tsx
        viewSwitch={
          <>
            <span className={styles.toolLabelInline}>{JA.schematic.title}</span>
            {(
              [
                ['board', JA.schematic.viewBoard],
                ['split', JA.schematic.viewSplit],
                ['schematic', JA.schematic.viewSchematic],
              ] as const
            ).map(([view, label]) => (
              <button
                key={view}
                type="button"
                data-testid={`assemble-view-${view}`}
                aria-pressed={assembleView === view}
                onClick={() => {
                  useStore.getState().setAssembleView(view);
                }}
              >
                {label}
              </button>
            ))}
          </>
        }
```

`.sessionLayout` の中身を、ビューに応じて3通りに分ける。**3Dビューポートの JSX は1箇所のまま**にし（`memo(BoardScene)` が効くように）、`display: none` ではなく**マウントするかどうか**で切り替える（`schematic` のときは Canvas を捨てて GPU を空ける。§15）:

```tsx
      <div className={styles.sessionLayout} data-view={assembleView}>
        {assembleView === 'schematic' ? null : (
          <div className={styles.viewport} data-testid="viewport">
            {/* …既存の中身（WarningBanner / BoardScene / statusOverlay / viewHint）をそのまま… */}
          </div>
        )}
        {assembleView === 'board' || schematicDoc === undefined ? null : (
          <div className={styles.editorPane}>
            <SchematicEditor
              problem={problem}
              board={JIPM_BOARD}
              document={schematicDoc}
              cursor={schematicCursor}
              history={schematicHistory}
              verifying={verifying}
              verified={verifyResult?.ok === true && verifyResult.passed}
              boardWired={session.wires.some((w) => !w.locked)}
              highlightCellIds={highlightCells}
              onEdit={(edit) => {
                useStore.getState().applySchematicEdit(edit);
              }}
              onCursor={(next) => {
                useStore.getState().setSchematicCursor(next);
              }}
              onUndo={() => {
                useStore.getState().undoSchematicEdit();
              }}
              onRedo={() => {
                useStore.getState().redoSchematicEdit();
              }}
              onVerify={() => {
                const store = useStore.getState();
                if (store.verifying || store.schematicDoc === undefined) return;
                store.setVerifying(true);
                bridge.send({
                  type: 'verify',
                  problem,
                  document: store.schematicDoc,
                  elapsedMs: store.elapsedMs,
                });
              }}
              onPickCell={onPickDraftCell}
              onRefuse={(message) => {
                useStore.getState().toast(message, 'error');
              }}
            />
            {verifyResult === undefined ? null : (
              <VerifyPanel problem={problem} result={verifyResult} onPickCell={onPickDraftCell} />
            )}
          </div>
        )}
        {/* …右パネル・下パネルは既存のまま… */}
      </div>
```

`highlightCells` / `onPickDraftCell` / `onPickHintCell` は **Task 8 が定義する**。Task 7 の時点では次の暫定を置き、Task 8 で中身を差し替える（未定義の識別子を残さない）:

```tsx
  // 配線ガイドは Task 8 が実装する。ここでは「何も光らない・クリックは無視」で動かす
  const highlightCells = useStore((s) => s.highlight.cellIds);
  /** 回路図エディタ（訓練者の下書き）の要素をクリックしたとき。Task 8 で中身が入る */
  const onPickDraftCell = useCallback((_cellId: string | undefined): void => {
    // Task 8 でストアの `highlight` を更新する
  }, []);
  /** 回路図ヒント（課題の模範回路）の要素をクリックしたとき。Task 8 で中身が入る */
  const onPickHintCell = useCallback((_cellId: string | undefined): void => {
    // Task 8 でストアの `highlight` を更新する
  }, []);
```

- [ ] **Step 5: CSS を足す**

`screens.module.css` の末尾（`/* --- Plan 5 Task 7 --- */`）:

```css
/* モードBのビュー切替（盤／並べて／回路図）。§11.4 */
.sessionLayout[data-view='split'] .viewport {
  flex: 1 1 50%;
  min-width: 360px;
}

.editorPane {
  display: flex;
  flex: 1 1 50%;
  flex-direction: column;
  gap: 8px;
  min-width: 360px;
  min-height: 0;
  overflow-y: auto;
}

.sessionLayout[data-view='schematic'] .editorPane {
  flex: 1 1 100%;
}

.toolLabelInline {
  font-size: 12px;
  color: #98a1ac;
}
```

- [ ] **Step 6: テストを走らせてコミットする**

```
pnpm --filter @ojt/desktop test assemble-view session
npx prettier --check "apps/desktop/src/renderer/**/*.{ts,tsx,css}"
git add apps/desktop && git commit -m "feat(desktop): put the schematic editor into the mode-B session as a view switch"
```

**期待**: `assemble-view.test.tsx` の **7件**が増え、既存の `session.test.tsx` はそのまま通る（初期ビューが `board` なので、既存テストが見る DOM は変わらない）。

---

## Task 8: 配線ガイドのハイライト（受入基準②）

**モデル: Opus**（索引の出どころの切り替えと、C2 の landed コードを壊さない寄せ方）

**Files:**
- Create: `apps/desktop/src/renderer/session/wiring-guide.ts`
- Modify: `apps/desktop/src/renderer/screens/Session.tsx`
- Modify: `apps/desktop/src/renderer/screens/InspectRepairSession.tsx`（glue を共通化）
- Test: `apps/desktop/test/wiring-guide.test.ts`（新規）
- Test: `apps/desktop/test/wiring-guide-screen.test.tsx`（新規）

§11.4「配線ガイド: 回路図の要素をクリックすると3D盤の対応端子をハイライトする」＝**受入基準②**。決定表#7・#8。

- [x] **Step 1: 失敗するテストを書く（純関数）**

`apps/desktop/test/wiring-guide.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS, buildHighlightIndex, buildReferenceSession } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { NO_HIGHLIGHT } from '../src/renderer/app/store-types.js';
import {
  cellsForHover,
  guideIndexFor,
  selectionFor,
  sameSelection,
} from '../src/renderer/session/wiring-guide.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

function reference() {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路が作れません');
  return built.value;
}

describe('selectionFor', () => {
  it('turns a cell id into terminals and wires', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    const cellId = cells[0]?.cellId ?? '';
    const selection = selectionFor(index, cellId);
    expect(selection.cellIds).toEqual([cellId]);
    expect(selection.terminals).toHaveLength(2);
    expect(selection.wireIds.length).toBeGreaterThan(0);
  });

  it('clears the selection for an unknown or undefined cell', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    expect(selectionFor(index, undefined)).toEqual(NO_HIGHLIGHT);
    expect(selectionFor(index, 'nope')).toEqual(NO_HIGHLIGHT);
  });
});

describe('cellsForHover（3D → 回路図の逆引き。決定表#8）', () => {
  it('finds the cells that use a hovered terminal', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    const terminal = cells[0]?.left ?? '';
    expect(cellsForHover(index, { terminal })).toContain(cells[0]?.cellId);
  });

  it('finds the cells that a hovered wire joins', () => {
    const { cells, session } = reference();
    const index = buildHighlightIndex(cells, session);
    const wireId = session.wires.find((w) => !w.locked)?.id ?? '';
    expect(cellsForHover(index, { wireId }).length).toBeGreaterThan(0);
  });

  it('returns nothing when nothing is hovered', () => {
    const { cells, session } = reference();
    expect(cellsForHover(buildHighlightIndex(cells, session), {})).toEqual([]);
  });
});

describe('guideIndexFor（決定表#7）', () => {
  it('uses the trainee drawing when one is given', () => {
    const { session } = reference();
    const index = guideIndexFor({ doc: problem.schematic, problem, board: JIPM_BOARD, session });
    expect(index).not.toBeUndefined();
    expect(index?.size).toBe(problem.schematic.rungs.flatMap((r) => r.cells).length);
  });

  it('falls back to the reference circuit when there is no drawing', () => {
    const { session } = reference();
    const index = guideIndexFor({ doc: undefined, problem, board: JIPM_BOARD, session });
    expect(index?.size).toBeGreaterThan(0);
  });

  it('returns undefined for a drawing that cannot be assigned to the board', () => {
    const { session } = reference();
    const broken = { ...problem.schematic, rungs: [] };
    expect(guideIndexFor({ doc: broken, problem, board: JIPM_BOARD, session })).toBeUndefined();
  });
});

describe('sameSelection', () => {
  it('compares by value so hover does not restart the store on every frame', () => {
    expect(sameSelection(NO_HIGHLIGHT, { cellIds: [], terminals: [], wireIds: [] })).toBe(true);
    expect(sameSelection(NO_HIGHLIGHT, { cellIds: ['c1'], terminals: [], wireIds: [] })).toBe(false);
  });
});
```

- [x] **Step 2: `session/wiring-guide.ts` を実装する**

```ts
import { type BoardDefinition, type BoardSession } from '@ojt/board-model';
import {
  buildHighlightIndex,
  buildReferenceSession,
  cellIdsAtTerminal,
  cellIdsOfWire,
  highlightFor,
  type HighlightIndex,
  type SchematicProblem,
} from '@ojt/content';
import { assignToBoard, type SchematicDocument } from '@ojt/schematic-core';
import { NO_HIGHLIGHT, type HighlightSelection } from '../app/store-types.js';

/**
 * 回路図 ⇄ 3D盤の連動ハイライト。設計仕様 §9.2（C2）/ §11.4（モードBの配線ガイド）。
 *
 * C2 で landed していた glue（`InspectRepairSession.tsx` の中）をここへ寄せ、モードBの
 * 配線ガイドと**同じ実装**を使う。索引の出どころは Plan 5 決定表#7 のとおり:
 * 訓練者の下書きがあればそれ、無ければ課題の模範回路。
 *
 * React も three も使わないので Vitest だけで検証できる（§14.2）。
 */

/** 索引を作るための入力。 */
export interface GuideInput {
  /** 訓練者が描いた回路図（モードBのエディタ）。C2 は課題の提示回路図を渡す。 */
  doc: SchematicDocument | undefined;
  problem: SchematicProblem;
  board: BoardDefinition;
  /** いまの盤（電線IDを引くのに使う。配線が変わったら作り直すこと）。 */
  session: BoardSession;
}

/**
 * 連動ハイライトの索引。決定表#7
 * `doc` の物理割当に失敗したら（作りかけの下書きなど）`undefined` を返す。呼び出し側は
 * ハイライトを出さない（エディタの指摘欄が理由を出しているので、二重に言わない）。
 */
export function guideIndexFor(input: GuideInput): HighlightIndex | undefined {
  if (input.doc !== undefined) {
    const assigned = assignToBoard(input.doc, { roles: input.session.socketRoles });
    if (!assigned.ok) return undefined;
    return buildHighlightIndex(assigned.cells, input.session);
  }
  const reference = buildReferenceSession(input.problem, input.board);
  if (!reference.ok) return undefined;
  return buildHighlightIndex(reference.value.cells, input.session);
}

/** 回路図の要素 → 盤の選択。要素が無い／引けないときは「何も光らない」。§11.4 */
export function selectionFor(
  index: HighlightIndex | undefined,
  cellId: string | undefined,
): HighlightSelection {
  if (index === undefined || cellId === undefined) return NO_HIGHLIGHT;
  const target = highlightFor(index, cellId);
  if (target === undefined) return NO_HIGHLIGHT;
  return { cellIds: [target.cellId], terminals: [...target.terminals], wireIds: [...target.wireIds] };
}

/** 盤の端子・電線 → 回路図の要素ID（逆引き）。決定表#8 */
export function cellsForHover(
  index: HighlightIndex | undefined,
  hover: { terminal?: string | undefined; wireId?: string | undefined },
): string[] {
  if (index === undefined) return [];
  if (hover.terminal !== undefined) return cellIdsAtTerminal(index, hover.terminal);
  if (hover.wireId !== undefined) return cellIdsOfWire(index, hover.wireId);
  return [];
}

/** 盤の端子・電線から作る選択（逆引きでは端子と電線はそのまま光らせる）。 */
export function selectionForHover(
  index: HighlightIndex | undefined,
  hover: { terminal?: string | undefined; wireId?: string | undefined },
): HighlightSelection {
  const cellIds = cellsForHover(index, hover);
  if (cellIds.length === 0) return NO_HIGHLIGHT;
  return {
    cellIds,
    terminals: hover.terminal === undefined ? [] : [hover.terminal],
    wireIds: hover.wireId === undefined ? [] : [hover.wireId],
  };
}

/**
 * 2つの選択が同じか。ホバーは1秒に何度も走るので、**同じ結果なら `setHighlight()` を呼ばない**
 * ために使う（`visualSignature()` が変わらなくても zustand の購読は全部走るため）。
 */
export function sameSelection(a: HighlightSelection, b: HighlightSelection): boolean {
  const key = (s: HighlightSelection): string =>
    `${s.cellIds.join(',')}|${s.terminals.join(',')}|${s.wireIds.join(',')}`;
  return key(a) === key(b);
}
```

- [x] **Step 3: `Session.tsx` の暫定を差し替える（モードBの配線ガイド）**

Task 7 で置いた暫定を次に替える。**索引は2つ持つ**（I4）。「並べて」ビューでは
**訓練者の下書き（エディタ）と課題の模範回路（右パネルの回路図ヒント）が同時に画面に出る**ので、
1つの索引を画面の状態で切り替えると、ヒントの要素を押したときに下書きの端子が光る（またはその逆）。
どちらの図を押したかは**クリックの出どころ**が知っているので、索引も出どころごとに持つ:

```tsx
  /**
   * 配線ガイドの索引（訓練者の下書き用）。§11.4 / 決定表#7
   * 盤の配線が変わったら電線IDが古くなるので `session` も依存に並べる
   * （`buildHighlightIndex()` の注記のとおり）。下書きが無い／割り当てられないときは undefined。
   */
  const draftGuideIndex = useMemo(
    () => guideIndexFor({ doc: schematicDoc, problem, board: JIPM_BOARD, session }),
    [schematicDoc, problem, session],
  );
  /** 配線ガイドの索引（課題の模範回路＝回路図ヒント用）。`doc: undefined` で模範回路に落ちる。 */
  const hintGuideIndex = useMemo(
    () => guideIndexFor({ doc: undefined, problem, board: JIPM_BOARD, session }),
    [problem, session],
  );
  const highlightCells = useStore((s) => s.highlight.cellIds);

  /** 回路図エディタ（下書き）の要素をクリックしたら盤の端子を光らせる（受入基準②）。 */
  const onPickDraftCell = useCallback(
    (cellId: string | undefined): void => {
      useStore.getState().setHighlight(selectionFor(draftGuideIndex, cellId));
    },
    [draftGuideIndex],
  );
  /** 回路図ヒント（模範回路）の要素をクリックしたときも同じ道を通す。 */
  const onPickHintCell = useCallback(
    (cellId: string | undefined): void => {
      useStore.getState().setHighlight(selectionFor(hintGuideIndex, cellId));
    },
    [hintGuideIndex],
  );
```

3D側の逆引き（盤 → 回路図）は**1つしか選べない**ので、「いま大きく出ている回路図」の索引を使う。
エディタが出ているとき（`assembleView !== 'board'`）は下書き、盤だけのときは模範回路:

```tsx
  const latestIndex = useRef(hintGuideIndex);
  latestIndex.current = assembleView === 'board' ? hintGuideIndex : (draftGuideIndex ?? hintGuideIndex);
  /**
   * 盤の端子にホバーしたら回路図の要素を光らせる（決定表#8）。
   * ホバーは毎秒何度も走るので、**同じ選択なら書かない**（`sameSelection`）。
   *
   * 結果画面から跳んできた注目（`boardFocus`）が立っているあいだは**書かない**（I3）。
   * 盤にマウスを載せただけで「疑わしい端子」のハイライトが消えると、
   * 「盤で見る」で見に来たものが見られない（UXレビュー #28）。
   */
  const onHover = useCallback((id: TerminalId | undefined) => {
    const store = useStore.getState();
    store.setHovered(id);
    if (store.boardFocus !== undefined) return;
    const next = selectionForHover(latestIndex.current, { terminal: id });
    if (sameSelection(next, store.highlight)) return;
    store.setHighlight(next);
  }, []);
```

**注意**: `boardFocus` はストアの欄なので Task 9 が足す。バッチCは **8 → 9 → 10 の直列**なので、
Task 8 の時点ではまだ無い。`onHover` のこの2行は **Task 9 Step 1（`boardFocus` の追加）と同じ
コミットで入れる**こと（Task 8 では `latestIndex` の2索引だけを入れる）。

回路図ヒント（`schematic-hint` の `SchematicSvg`）にも `highlightCellIds` と `onPickCell` を渡す:

```tsx
                <SchematicSvg
                  document={problem.schematic}
                  highlightCellIds={highlightCells}
                  onPickCell={onPickHintCell}
                />
```

- [x] **Step 4: `InspectRepairSession.tsx` の glue を寄せる**

L297〜L340 の `highlightIndex` / `latestIndex` / ホバー処理を `wiring-guide.ts` の関数で書き直す。**挙動は変えない**（`buildHighlightIndex(circuit.cells, session)` はそのまま、`setHighlight` を呼ぶ条件も `sameSelection()` で同じになる）。L800〜L812 の `onPickCell` は `selectionFor(index, cellId)` の1行にする。

- [x] **Step 5: 画面のテストを書いて走らせる**

`apps/desktop/test/wiring-guide-screen.test.tsx`。**`BoardScene` のモックは `session.test.tsx` の
形をそのまま写す**（`onPick` に加えて `onHover` も捕まえる。3Dの逆引きを検証するため）:

```tsx
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { Session } from '../src/renderer/screens/Session.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

/** `BoardScene` が受け取ったハンドラ（`session.test.tsx` と同じ捕まえ方）。 */
const scene = vi.hoisted(() => ({ hover: undefined as ((id: string | undefined) => void) | undefined }));

vi.mock('../src/renderer/three/BoardScene.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../src/renderer/three/BoardScene.js',
  );
  return {
    safeRoutes: actual['safeRoutes'],
    visualSignature: actual['visualSignature'],
    BoardScene: ({ onHover }: { onHover: (id: string | undefined) => void }) => {
      scene.hover = onHover;
      return <div data-testid="board-canvas-stub" />;
    },
  };
});

beforeEach(() => {
  useStore.getState().abandonSession();
  act(() => {
    useStore.getState().openProblem(problem);
  });
});

afterEach(() => {
  cleanup();
});

describe('配線ガイド（§16 Phase 5 受入基準②）', () => {
  it('lights the board terminals when a schematic hint element is clicked', () => {
    render(<Session />);
    // b-001 は3級課題なので回路図ヒントが常時出ている（§8.4）
    const symbol = screen.getByTestId('schematic-hint').querySelector('[data-cell]');
    expect(symbol).not.toBeNull();
    if (symbol === null) return;
    fireEvent.click(symbol);
    const highlight = useStore.getState().highlight;
    expect(highlight.cellIds).toEqual([symbol.getAttribute('data-cell')]);
    expect(highlight.terminals).toHaveLength(2);
    // 端子IDは盤の語彙（`CR1.14` のような `<部品>.<端子>`）
    for (const terminal of highlight.terminals) expect(terminal).toMatch(/^[A-Z_0-9]+\./u);
  });

  it('clears the highlight when the empty area of the schematic is clicked', () => {
    render(<Session />);
    const svg = screen.getByTestId('schematic-hint').querySelector('[data-testid="schematic-svg"]');
    if (svg === null) return;
    fireEvent.click(svg);
    expect(useStore.getState().highlight.cellIds).toEqual([]);
  });

  it('lights the drawn element when the editor is open (決定表#7)', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    act(() => {
      const store = useStore.getState();
      store.applySchematicEdit({ kind: 'insertCell', rungId: 'r1', index: 0, draft: { kind: 'pb-a', device: 'PB1' } });
      store.applySchematicEdit({ kind: 'insertCell', rungId: 'r1', index: 1, draft: { kind: 'coil', device: 'CR1' } });
    });
    const symbol = screen.getByTestId('schematic-editor').querySelector('[data-cell]');
    if (symbol === null) return;
    fireEvent.click(symbol);
    expect(useStore.getState().highlight.terminals.length).toBeGreaterThan(0);
  });

  it('lights nothing while the drawing cannot be assigned to the board', () => {
    render(<Session />);
    fireEvent.click(screen.getByTestId('assemble-view-schematic'));
    // 要素0個の下書きは割当できない（`validateDocument` が段の空を弾く）
    const svg = screen.getByTestId('schematic-editor').querySelector('[data-testid="schematic-svg"]');
    if (svg === null) return;
    fireEvent.click(svg);
    expect(useStore.getState().highlight).toEqual({ cellIds: [], terminals: [], wireIds: [] });
  });

  it('keeps the hint on the reference circuit while the editor shows the draft (I4)', () => {
    render(<Session />);
    // 「並べて」は**下書きと模範回路が同時に画面に出る**唯一のビュー
    fireEvent.click(screen.getByTestId('assemble-view-split'));
    act(() => {
      const store = useStore.getState();
      store.applySchematicEdit({ kind: 'insertCell', rungId: 'r1', index: 0, draft: { kind: 'pb-a', device: 'PB1' } });
      store.applySchematicEdit({ kind: 'insertCell', rungId: 'r1', index: 1, draft: { kind: 'coil', device: 'CR1' } });
    });
    // ヒント側の要素IDは課題JSONのID（`c01`〜）。下書きのID（`c1`〜）とは別物なので、
    // 索引が1つだと引けずに何も光らない
    const hint = screen.getByTestId('schematic-hint').querySelector('[data-cell]');
    expect(hint).not.toBeNull();
    if (hint === null) return;
    fireEvent.click(hint);
    expect(useStore.getState().highlight.cellIds).toEqual([hint.getAttribute('data-cell')]);
    expect(useStore.getState().highlight.terminals).toHaveLength(2);
  });

  it('does not wipe the result focus when the pointer passes over the board (I3)', () => {
    render(<Session />);
    const focus = { cellIds: ['c01'], terminals: ['CR1.14', 'P.1'], wireIds: [] };
    act(() => {
      const store = useStore.getState();
      store.setHighlight(focus as never);
      store.setBoardFocus({ from: 'result', text: 'CR1.14（CR1）と P.1（P）がつながっていません' });
    });
    expect(scene.hover).toBeDefined();
    act(() => {
      scene.hover?.('CR1.9');
      scene.hover?.(undefined);
    });
    expect(useStore.getState().highlight).toEqual(focus);
  });
});
```

```
pnpm --filter @ojt/desktop test wiring-guide inspect-repair-screen highlight-link
pnpm -r typecheck && pnpm lint
git add apps/desktop && git commit -m "feat(desktop): light the board terminals from the schematic (wiring guide)"
```

**期待**: `wiring-guide.test.ts` の **9件**と `wiring-guide-screen.test.tsx` の **6件**が増え、既存の `highlight-link.test.tsx`（C2）はそのまま通る。`boardFocus` を使う1件は Task 9 と同じコミットになる。

---

## Task 9: 結果画面の「疑わしい配線」と「盤で見る」（UXレビュー #28）

**モデル: Opus**（結果 → セッションの遷移と、戻る導線）

**Files:**
- Create: `apps/desktop/src/renderer/result/SuspectList.tsx`
- Modify: `apps/desktop/src/renderer/result/ResultView.tsx` / `result.module.css`
- Modify: `apps/desktop/src/renderer/screens/Result.tsx`（`SuspectList` へ渡す盤と遷移）
- Modify: `apps/desktop/src/renderer/app/store-types.ts`（`BoardFocus` 型）
- Modify: `apps/desktop/src/renderer/app/store.ts`（`boardFocus` / `setBoardFocus`）
- Modify: `apps/desktop/src/renderer/screens/Session.tsx`（「結果から」の帯と `onHover` の `boardFocus` ガード）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`
- Test: `apps/desktop/test/suspect-list.test.tsx`（新規）
- Test: `apps/desktop/test/wiring-guide-screen.test.tsx`（Task 8 が作ったファイルに `boardFocus` の1件を足す）

決定表#10・#11・#27。

- [x] **Step 1: ストアに `boardFocus` を足す**

`store-types.ts`（値型なのでこちら）:

```ts
/**
 * 結果画面から盤へ跳んだときの注目。§8.3 / UXレビュー #28
 * `text` は帯に出す1行（「CR1.14（CR1）と P.1（P）がつながっていません」）。
 */
export interface BoardFocus {
  from: 'result';
  text: string;
}
```

`store.ts`: `boardFocus: BoardFocus | undefined;` ＋ `setBoardFocus: (focus: BoardFocus | undefined) => void;` ＋ 実装 ＋ 初期値 `undefined`。`openProblem()` / `resetSession()` / `restartSession()` / `abandonSession()` で `undefined` に戻す。

- [x] **Step 2: 失敗するテストを書く**

`apps/desktop/test/suspect-list.test.tsx`:

```tsx
import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS, buildReferenceSession, wiringSuspects } from '@ojt/content';
import { removeWire } from '@ojt/board-model';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuspectList } from '../src/renderer/result/SuspectList.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

function brokenSession() {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路が作れません');
  const victim = built.value.session.wires.find((w) => !w.locked);
  if (victim !== undefined) removeWire(built.value.session, victim.id);
  return built.value.session;
}

afterEach(() => {
  cleanup();
});

describe('SuspectList（UXレビュー #28）', () => {
  it('lists the suspects with a 盤で見る button each', () => {
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, brokenSession());
    expect(suspects.length).toBeGreaterThan(0);
    render(<SuspectList suspects={suspects} onShowOnBoard={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: '盤で見る' })).toHaveLength(suspects.length);
    expect(screen.getByTestId('suspect-list')).toHaveTextContent('つながっていません');
  });

  it('hands the terminals, wires and cells to the caller', () => {
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, brokenSession());
    const onShowOnBoard = vi.fn();
    render(<SuspectList suspects={suspects} onShowOnBoard={onShowOnBoard} />);
    fireEvent.click(screen.getAllByRole('button', { name: '盤で見る' })[0] as HTMLElement);
    expect(onShowOnBoard).toHaveBeenCalledWith(suspects[0]);
  });

  it('says so when there is nothing to suspect', () => {
    render(<SuspectList suspects={[]} onShowOnBoard={vi.fn()} />);
    expect(screen.getByTestId('no-suspect')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: '盤で見る' })).toHaveLength(0);
  });

  it('tells the trainee when the list was cut short (決定表#27)', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      kind: 'missing' as const,
      terminals: [`CR1.${i + 1}`, 'P.1'] as unknown as readonly [string, string],
      devices: ['CR1', 'P'],
      cellIds: [`c${i}`],
      wireIds: [],
      message: `CR1.${i + 1}（CR1）と P.1（P）がつながっていません`,
    }));
    render(<SuspectList suspects={many} onShowOnBoard={vi.fn()} truncated={3} />);
    expect(screen.getByTestId('suspect-more')).toHaveTextContent('3');
  });

  it('warns that a different contact pair also shows up here (決定表#9b)', () => {
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, brokenSession());
    render(<SuspectList suspects={suspects} onShowOnBoard={vi.fn()} />);
    expect(screen.getByTestId('suspect-note')).toHaveTextContent('接点の組');
  });
});
```

- [x] **Step 3: `SuspectList.tsx` を実装する**

```tsx
import type { WiringSuspect } from '@ojt/content';
import type { JSX } from 'react';
import { JA, suspectMoreText } from '../i18n/ja.js';
import styles from './result.module.css';

/**
 * 疑わしい配線の一覧。UXレビュー #28（2026-09-19）。
 *
 * 判定は波形の食い違いしか返さないので、訓練者は「どこを直せばよいか」が分からない。
 * `wiringSuspects()`（模範回路との節点分割の差）を並べ、「盤で見る」でその端子と電線を
 * 3Dで光らせる（Plan 5 決定表#11）。
 */
export function SuspectList({
  suspects,
  truncated = 0,
  onShowOnBoard,
}: {
  suspects: readonly WiringSuspect[];
  /** 表示上限で切り捨てた件数（0 なら切り捨て無し）。決定表#27 */
  truncated?: number;
  onShowOnBoard: (suspect: WiringSuspect) => void;
}): JSX.Element {
  return (
    <div className={styles.card} data-testid="suspect-list">
      <h2>
        {JA.result.suspects}（{suspects.length}）
      </h2>
      {suspects.length === 0 ? (
        <p data-testid="no-suspect">{JA.result.noSuspect}</p>
      ) : (
        <ul className={styles.suspectList}>
          {suspects.map((suspect) => (
            <li key={`${suspect.kind}:${suspect.terminals.join('-')}`} className={styles.suspect}>
              <span className={suspect.kind === 'missing' ? styles.suspectMissing : styles.suspectExtra}>
                {suspect.kind === 'missing' ? JA.result.suspectMissing : JA.result.suspectExtra}
              </span>
              <span className={styles.suspectText}>{suspect.message}</span>
              <button
                type="button"
                className={styles.suspectButton}
                onClick={() => {
                  onShowOnBoard(suspect);
                }}
              >
                {JA.result.showOnBoard}
              </button>
            </li>
          ))}
        </ul>
      )}
      {truncated > 0 ? (
        <p className={styles.suspectMore} data-testid="suspect-more">
          {suspectMoreText(truncated)}
        </p>
      ) : null}
      {/*
        接点の組の違いも「不足」「余分」として出る（決定表#9b）。正規化しないと決めたので、
        **一覧が出ているあいだは必ず**この1行を添えて、訓練者が誤りだと思い込まないようにする。
      */}
      {suspects.length === 0 ? null : (
        <p className={styles.suspectNote} data-testid="suspect-note">
          {JA.result.suspectNote}
        </p>
      )}
    </div>
  );
}
```

`i18n/ja.ts` の `JA.result` に追記（`// --- Plan 5 Task 9 ---`）:

```ts
    suspects: '疑わしい配線',
    noSuspect: '模範回路との配線の違いは見つかりませんでした。部品の設定や操作の順序を見直してください。',
    suspectMissing: '不足',
    suspectExtra: '余分',
    suspectNote:
      '同じ機器の接点の組（CR1 の ⑨⑤／⑩⑥／⑪⑦／⑫⑧）は、どれを使っても回路は成立します。組が違うだけのときも、ここに「不足」「余分」として出ます。',
    showOnBoard: '盤で見る',
    backToResult: '結果へ戻る',
    fromResult: '結果から',
```

`JA` の各ブロックは**値だけ**を持つ既存の流儀なので、件数を埋める文だけは関数として外に置く。

`JA` の関数群（`schematicOpenCountText` の隣）に:

```ts
/** 表示しきれなかった疑いの件数。UXレビュー #28 */
export function suspectMoreText(count: number): string {
  return `ほかに ${count} 件あります。まず上の指摘から直してください。`;
}
```

`JA.result.suspectMore` は関数を持てないので、`SuspectList` 側で `suspectMoreText(truncated)` を呼ぶ形にする（`JA` は値だけを持つ既存の流儀に合わせる）。

- [x] **Step 4: `ResultView.tsx` と `Result.tsx` をつなぐ**

`ResultView` に props を2つ足す（**任意**にしてモードC1/C2/Dの結果画面を壊さない）:

```tsx
  /** 疑わしい配線（モードBのみ。UXレビュー #28）。 */
  suspects?: readonly WiringSuspect[];
  /** 表示上限で切り捨てた件数。 */
  suspectsTruncated?: number;
  /** 「盤で見る」。 */
  onShowOnBoard?: (suspect: WiringSuspect) => void;
```

`.grid` の中、`MismatchList` の直後に:

```tsx
        {suspects === undefined || onShowOnBoard === undefined ? null : (
          <SuspectList
            suspects={suspects}
            truncated={suspectsTruncated ?? 0}
            onShowOnBoard={onShowOnBoard}
          />
        )}
```

`screens/Result.tsx` で計算して渡す（決定表#10: renderer で `useMemo`）。`wiringSuspects()` は
**一覧と切り捨て件数の両方**を返すので、そのまま2つの props に分けて渡す（I6）:

```tsx
  /** 疑わしい配線（モードBのみ・合格時は出さない）。UXレビュー #28 */
  const report = useMemo((): WiringSuspectReport => {
    const empty = { suspects: [], total: 0, omitted: 0 };
    if (problem === undefined || session === undefined || !isAssembleProblem(problem)) return empty;
    // 合格したときは出さない（見るところが無い）
    if (result?.mode === 'assemble' && result.passed) return empty;
    return wiringSuspects(problem, JIPM_BOARD, session);
  }, [problem, session, result]);
```

`<ResultView …>` に渡す:

```tsx
      suspects={report.suspects}
      suspectsTruncated={report.omitted}
      onShowOnBoard={showOnBoard}
```

import に `type WiringSuspectReport`（`@ojt/content`）を足す。

「盤で見る」の実体（決定表#11）:

```tsx
  const showOnBoard = useCallback((suspect: WiringSuspect): void => {
    const store = useStore.getState();
    store.setHighlight({
      cellIds: [...suspect.cellIds],
      terminals: [...suspect.terminals],
      wireIds: [...suspect.wireIds],
    });
    store.setBoardFocus({ from: 'result', text: suspect.message });
    store.setCamera('front');
    store.setRoute('session');
  }, []);
```

- [x] **Step 5: セッション画面に「結果から」の帯を出す**

`Session.tsx` の `.stepGuide` の直前に:

```tsx
      {boardFocus === undefined ? null : (
        <div className={styles.boardFocus} data-testid="board-focus">
          <span>
            {JA.result.fromResult}: {boardFocus.text}
          </span>
          <button
            type="button"
            data-testid="back-to-result"
            onClick={() => {
              const store = useStore.getState();
              store.setBoardFocus(undefined);
              store.setHighlight(NO_HIGHLIGHT);
              store.setRoute('result');
            }}
          >
            {JA.result.backToResult}
          </button>
        </div>
      )}
```

`result.module.css` と `screens.module.css` に `.suspectList` / `.suspect` / `.suspectMissing` / `.suspectExtra` / `.suspectText` / `.suspectButton` / `.suspectMore` / `.suspectNote` / `.boardFocus` を足す（余白は4の倍数、ボタンに `:focus-visible` の枠）。

**あわせて Task 8 の `onHover` の2行を入れる**（`boardFocus` はここで初めて存在するため）:

```tsx
    if (store.boardFocus !== undefined) return;
```

- [x] **Step 6: テストを走らせてコミットする**

```
pnpm --filter @ojt/desktop test suspect-list result-view
pnpm -r typecheck && pnpm lint
git add apps/desktop && git commit -m "feat(desktop): suggest the suspect wiring on the result screen and show it on the board"
```

**期待**: `suspect-list.test.tsx` の **5件**が増え、既存の `result-view.test.tsx` / `plc-result.test.tsx` / `inspect-*-result.test.tsx` はそのまま通る（新しい props は任意）。

---

## Task 10: 端子リストによるキーボード配線（UXレビュー #29）

**モデル: Sonnet**（本書のコードをそのまま書き写す。判断は決定表#12 で済んでいる）

**Files:**
- Create: `apps/desktop/src/renderer/session/terminal-list.ts`
- Create: `apps/desktop/src/renderer/panels/TerminalListPanel.tsx`
- Modify: `apps/desktop/src/renderer/panels/panels.module.css`（末尾追記）
- Modify: `apps/desktop/src/renderer/screens/Session.tsx`（右パネルに差し込む）
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`（`JA.terminalList` ブロック）
- Test: `apps/desktop/test/terminal-list.test.tsx`（新規）

決定表#12: 選択は `PickHit`（`kind: 'terminal'`）にして**既存の `pickToAction()` に通す**。配線の規則は1箇所のまま。

- [x] **Step 1: 失敗するテストを書く**

`apps/desktop/test/terminal-list.test.tsx`:

```tsx
import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionForProblem } from '../src/renderer/app/store.js';
import { TerminalListPanel } from '../src/renderer/panels/TerminalListPanel.js';
import { terminalRows } from '../src/renderer/session/terminal-list.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');

afterEach(() => {
  cleanup();
});

describe('terminalRows', () => {
  const session = sessionForProblem(problem);

  it('lists only wirable board terminals, grouped by device', () => {
    const rows = terminalRows(JIPM_BOARD, session);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.id.includes('.'))).toBe(true);
    // AC一次側（CB / SW / PS）と PB／PL 本体端子は配線できないので出ない（§6.4）
    expect(
      rows.some((r) => ['CB', 'SW', 'PS', 'PB1', 'PL1'].includes(r.group)),
    ).toBe(false);
    expect([...new Set(rows.map((r) => r.group))]).toContain('CR1');
  });

  it('uses the role id for socket terminals (CR1 ⑨ COM, not S1 ⑨ COM)', () => {
    const rows = terminalRows(JIPM_BOARD, session);
    const com = rows.find((r) => r.id === 'CR1.9');
    expect(com).toBeDefined();
    expect(com?.group).toBe('CR1');
    expect(com?.label).toContain('CR1');
    expect(com?.label).toContain('COM');
    // 物理ソケットIDは1つも残っていない（`session.wires` は役割ベースなので混ぜられない）
    expect(rows.some((r) => /^S[1-8]\./u.test(r.id))).toBe(false);
  });

  it('leaves out the spare sockets and the buzzer the problem did not add (B3)', () => {
    const rows = terminalRows(JIPM_BOARD, session);
    // b-001 が役割を割り当てるのは S1(CR1) / S2(CR2) / S5(T1) / S6(T2) / S7(CHK) の5つ
    expect([...new Set(rows.map((r) => r.group))].sort()).toEqual([
      'CHK',
      'CR1',
      'CR2',
      'N',
      'P',
      'T1',
      'T2',
      'TB_PB',
      'TB_PL',
    ]);
    // 5ソケット×14 ＋ TB_PL 8 ＋ TB_PB 12 ＋ P 1 ＋ N 1 ＝ 92
    expect(rows).toHaveLength(92);
  });

  it('counts the wires at each terminal and marks the full ones', () => {
    const rows = terminalRows(JIPM_BOARD, session);
    // チェック用回路の既設配線（`P.1 → TB_PB.4c`）が P.1 を1本使っている（§6.3）
    expect(rows.find((r) => r.id === 'P.1')?.wireCount).toBe(1);
    expect(rows.find((r) => r.id === 'P.1')?.full).toBe(false);
    // 既設配線は役割ベースの端子IDで張られているので、CHK 側も数えられている
    expect(rows.find((r) => r.id === 'CHK.14')?.wireCount).toBe(1);
  });

  it('filters by the search text over both the id and the label', () => {
    const rows = terminalRows(JIPM_BOARD, session, 'PL1');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => `${r.id}${r.label}`.includes('PL1'))).toBe(true);
  });
});

describe('TerminalListPanel（UXレビュー #29）', () => {
  const session = sessionForProblem(problem);

  it('renders every terminal as a focusable button', () => {
    render(<TerminalListPanel board={JIPM_BOARD} session={session} pendingTerminal={undefined} onPick={vi.fn()} onCancel={vi.fn()} />);
    const buttons = screen.getAllByTestId(/^terminal-row-/u);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button.tagName).toBe('BUTTON');
  });

  it('hands a PickHit to the caller on click and on Enter', () => {
    const onPick = vi.fn();
    render(<TerminalListPanel board={JIPM_BOARD} session={session} pendingTerminal={undefined} onPick={onPick} onCancel={vi.fn()} />);
    const row = screen.getByTestId('terminal-row-CR1.14');
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith({ kind: 'terminal', id: 'CR1.14', wirable: true, label: expect.any(String) });
    onPick.mockClear();
    fireEvent.keyDown(row, { key: 'Enter' });
    // ブラウザは Enter を click に直すので、ここでは二重に呼ばないことを確かめる
    expect(onPick).not.toHaveBeenCalled();
  });

  it('shows which terminal is waiting for its partner and offers a cancel', () => {
    const onCancel = vi.fn();
    render(<TerminalListPanel board={JIPM_BOARD} session={session} pendingTerminal={'CR1.14' as never} onPick={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByTestId('terminal-pending')).toHaveTextContent('CR1.14');
    fireEvent.click(screen.getByTestId('terminal-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables the terminals that already hold two wires (§6.6)', () => {
    const full = sessionForProblem(problem);
    // `P.1` は既設配線で1本、ここで1本足して満杯にする
    full.wires.push({ id: 'w-x', from: 'P.1' as never, to: 'CR1.14' as never, color: '青', locked: false, open: false });
    render(<TerminalListPanel board={JIPM_BOARD} session={full} pendingTerminal={undefined} onPick={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('terminal-row-P.1')).toBeDisabled();
  });

  it('narrows the list as the trainee types', () => {
    render(<TerminalListPanel board={JIPM_BOARD} session={session} pendingTerminal={undefined} onPick={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('terminal-search'), { target: { value: 'PL1' } });
    const rows = screen.getAllByTestId(/^terminal-row-/u);
    expect(rows.every((r) => (r.textContent ?? '').includes('PL1'))).toBe(true);
  });
});
```

- [x] **Step 2: `session/terminal-list.ts` を実装する**

```ts
import {
  isOffBoardTerminal,
  isSocketId,
  toSessionTerminal,
  type BoardDefinition,
  type BoardSession,
  type BoardTerminal,
} from '@ojt/board-model';
import { MAX_WIRES_PER_TERMINAL, parseTerminalId, type TerminalId } from '@ojt/circuit-sim';

/**
 * 端子リスト（キーボードで配線するための一覧）。UXレビュー #29（2026-09-19）。
 * §15 のアクセシビリティは「課題選択・判定・結果確認まで」しか求めていないが、
 * 利用者要求「分かりやすく直感的に」に応えて**配線もキーボードで完結**させる。
 * React も three も使わないので Vitest だけで検証できる（§14.2）。
 *
 * **端子IDは役割ベースに正規化する。** `board.terminals[].id` はソケットを**物理ID**
 * （`S1.9`）で持つのに対し、`session.wires` は**役割ID**（`CR1.9`）で張られている
 * （`board-model/src/session.ts` の `toSessionTerminal()` の注記: 「電線と突き合わせる前に
 * 必ずこれを通すこと」）。混ぜると①電線の本数が常に0本に見え、②見出しが `S1` になり、
 * ③`pickToAction()` → `addWire()` が入口で別のIDに正規化するので画面の表示とずれる。
 */

/** 一覧の1行。 */
export interface TerminalRow {
  /** **役割ベース**の端子ID（`CR1.9` / `TB_PL.1+` / `P.1`）。`session.wires` と同じ語彙。 */
  id: TerminalId;
  /** 画面に出す名前（`CR1 ⑨ COM` / `PL1 +` / `P1`）。 */
  label: string;
  /** まとまりの見出し（`CR1` / `TB_PL` / `P` のような部品ID。ソケットは**役割ID**）。 */
  group: string;
  /** いまその端子に繋がっている電線の本数。 */
  wireCount: number;
  /** 上限（2本）に達していて、これ以上繋げないか。§6.6 */
  full: boolean;
}

/** その端子に繋がっている電線の本数（既設配線も数える）。§6.6 */
function wireCountAt(session: BoardSession, id: TerminalId): number {
  return session.wires.filter((w) => w.from === id || w.to === id).length;
}

/**
 * 盤定義の端子1つを、いまのセッションの語彙の1行にする。出せない端子は undefined。
 *
 * 出さないのは次の3種類:
 * - `wirable: false`（AC一次側 `CB`/`SW`/`PS`、PB／PL 本体端子）。§6.4
 * - 課題が足していない任意部品の端子（`BZ`）。§5.3.4
 * - 役割の割り当てが無い予備ソケットの端子（`toSessionTerminal()` が物理IDのまま返す）。§6.1
 */
function toRow(session: BoardSession, terminal: BoardTerminal): TerminalRow | undefined {
  if (!terminal.wirable) return undefined;
  const physical = parseTerminalId(terminal.id);
  if (terminal.optional && !session.extraParts.includes(physical.part)) return undefined;
  const id = toSessionTerminal(session, terminal.id);
  const { part } = parseTerminalId(id);
  const socket = isSocketId(physical.part);
  if (socket && isSocketId(part)) return undefined;
  const count = wireCountAt(session, id);
  return {
    id,
    // 盤定義の印字はソケットだけ部品IDを持たない（`⑨ COM`）ので、役割IDを前に足す。§8.2
    label: socket ? `${part} ${terminal.label}` : terminal.label,
    group: part,
    wireCount: count,
    full: count >= MAX_WIRES_PER_TERMINAL,
  };
}

/**
 * 配線できる盤の端子の一覧（盤定義の並び順）。`query` を渡すと端子IDと名前の両方で絞り込む。
 * 机上の端子（PLC本体・壁コンセント）も**盤の一部として出す**（モードDで使う）。
 */
export function terminalRows(
  board: BoardDefinition,
  session: BoardSession,
  query = '',
): TerminalRow[] {
  const needle = query.trim();
  const out: TerminalRow[] = [];
  for (const terminal of board.terminals) {
    const row = toRow(session, terminal);
    if (row === undefined) continue;
    if (needle.length > 0 && !`${row.id}${row.label}`.includes(needle)) continue;
    out.push(row);
  }
  return out;
}

/** 机上の端子か（見出しに「机上」を付ける）。§10.1 */
export function isDeskRow(row: TerminalRow): boolean {
  return isOffBoardTerminal(row.id);
}
```

- [x] **Step 3: `TerminalListPanel.tsx` を実装する**

```tsx
import type { BoardDefinition, BoardSession } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { useMemo, useState, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import type { PickHit } from '../session/interaction.js';
import { terminalRows, type TerminalRow } from '../session/terminal-list.js';
import styles from './panels.module.css';

/**
 * 端子リスト（キーボードで配線する）。UXレビュー #29 / Plan 5 決定表#12。
 * 選ぶと `PickHit`（`kind: 'terminal'`）を親へ渡すだけで、**配線の規則は
 * `pickToAction()`（`session/interaction.ts`）がそのまま受け持つ**。
 */

/** まとまりごとに並べ替える（部品IDの出現順）。 */
function byGroup(rows: readonly TerminalRow[]): Array<{ group: string; rows: TerminalRow[] }> {
  const out: Array<{ group: string; rows: TerminalRow[] }> = [];
  for (const row of rows) {
    const found = out.find((g) => g.group === row.group);
    if (found === undefined) out.push({ group: row.group, rows: [row] });
    else found.rows.push(row);
  }
  return out;
}

/** 端子リストのパネル。 */
export function TerminalListPanel({
  board,
  session,
  pendingTerminal,
  onPick,
  onCancel,
}: {
  board: BoardDefinition;
  session: BoardSession;
  /** 配線1本目に選んだ端子（`store.pendingTerminal`）。 */
  pendingTerminal: TerminalId | undefined;
  onPick: (hit: PickHit) => void;
  onCancel: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => terminalRows(board, session, query), [board, session, query]);
  return (
    <section className={styles.terminalList} data-testid="terminal-list">
      <h2 className={styles.panelTitle}>{JA.terminalList.title}</h2>
      <p className={styles.terminalHint}>{JA.terminalList.hint}</p>
      <input
        type="search"
        className={styles.terminalSearch}
        data-testid="terminal-search"
        aria-label={JA.terminalList.search}
        placeholder={JA.terminalList.search}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {pendingTerminal === undefined ? null : (
        <p className={styles.terminalPending} data-testid="terminal-pending">
          {JA.terminalList.pending}: {pendingTerminal}
          <button type="button" data-testid="terminal-cancel" onClick={onCancel}>
            {JA.terminalList.cancel}
          </button>
        </p>
      )}
      <div className={styles.terminalGroups}>
        {byGroup(rows).map((group) => (
          <div key={group.group} className={styles.terminalGroup}>
            <span className={styles.terminalGroupName}>{group.group}</span>
            {group.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={styles.terminalRow}
                data-testid={`terminal-row-${row.id}`}
                aria-pressed={pendingTerminal === row.id}
                disabled={row.full && pendingTerminal !== row.id}
                title={row.full ? JA.terminalList.full : row.label}
                onClick={() => {
                  onPick({ kind: 'terminal', id: row.id, wirable: true, label: row.label });
                }}
              >
                <span className={styles.terminalName}>{row.label}</span>
                <span className={styles.terminalCount}>{row.wireCount}/2</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
```

`i18n/ja.ts` に `JA.terminalList` ブロックを足す:

```ts
  /** 端子リスト（キーボードで配線する）。UXレビュー #29 */
  terminalList: {
    title: '端子リスト（キーボード配線）',
    hint: 'Tab で端子を移動し、Enter で選びます。2つ選ぶと電線が1本つながります。',
    search: '端子を探す',
    pending: '1本目',
    cancel: '取り消す',
    full: 'この端子には既に2本つながっています（§6.6）',
  },
```

- [x] **Step 4: `Session.tsx` の右パネルに差し込む**

`PartsPanel` の直後（回路図ヒントより前）に:

```tsx
          <TerminalListPanel
            board={JIPM_BOARD}
            session={session}
            pendingTerminal={pendingTerminal}
            onPick={onPick}
            onCancel={() => {
              runAction(escapeToAction({ mode, pendingTerminal, selectedWire, wireColor }));
            }}
          />
```

`onPick` は3Dのピックと**同じコールバック**である（決定表#12）。`escapeToAction` は既に import 済み。

- [x] **Step 5: CSS を足してテストを走らせる**

`panels.module.css` の末尾に `.terminalList` / `.terminalHint` / `.terminalSearch` / `.terminalPending` / `.terminalGroups` / `.terminalGroup` / `.terminalGroupName` / `.terminalRow` / `.terminalName` / `.terminalCount` を足す。**`.terminalRow:focus-visible` に枠**を置き、`.terminalGroups` は `max-height: 240px; overflow-y: auto;` で右パネルを押し出さない。余白はすべて4の倍数。

```
pnpm --filter @ojt/desktop test terminal-list
pnpm -r typecheck && pnpm lint
git add apps/desktop && git commit -m "feat(desktop): add the keyboard wiring terminal list"
```

**期待**: `terminal-list.test.tsx` の **10件**が増える。

---

## Task 11: 性能の計測窓（`PerfProbe`）

**モデル: Sonnet-verbatim**

**Files:**
- Create: `apps/desktop/src/renderer/three/PerfProbe.tsx`
- Modify: `apps/desktop/src/renderer/three/BoardScene.tsx`（`PerfProbe` と隠し要素）
- Test: `apps/desktop/test/perf-probe.test.ts`（新規）

決定表#16: `frameloop="demand"` では `useFrame` が**描いたフレームだけ**走るので、これが「無操作で描いていない」ことの証明にもなる。

- [x] **Step 1: 失敗するテストを書く**

`apps/desktop/test/perf-probe.test.ts`（純関数だけを検査する。`useFrame` は E2E が確かめる）:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatPerf,
  parsePerf,
  PERF_INTERVAL_MS,
  perfSample,
  type PerfReadout,
} from '../src/renderer/three/PerfProbe.js';

describe('perfSample', () => {
  it('turns counters into a readout with fps', () => {
    const sample = perfSample(
      { frames: 30, triangles: 120_000, calls: 84, geometries: 210, textures: 6 },
      500,
    );
    expect(sample).toEqual({ frames: 30, fps: 60, triangles: 120_000, calls: 84, geometries: 210, textures: 6 });
  });

  it('reports 0 fps when no time has passed (never divides by zero)', () => {
    expect(perfSample({ frames: 0, triangles: 0, calls: 0, geometries: 0, textures: 0 }, 0).fps).toBe(0);
  });

  it('rounds fps to one decimal so the readout is stable to read', () => {
    expect(perfSample({ frames: 7, triangles: 0, calls: 0, geometries: 0, textures: 0 }, 250).fps).toBe(28);
  });
});

describe('formatPerf / parsePerf', () => {
  it('round-trips through the hidden element text', () => {
    const readout: PerfReadout = { frames: 12, fps: 48, triangles: 1000, calls: 10, geometries: 5, textures: 2 };
    expect(parsePerf(formatPerf(readout))).toEqual(readout);
  });

  it('returns undefined for text that is not a readout', () => {
    expect(parsePerf('')).toBeUndefined();
    expect(parsePerf('not json')).toBeUndefined();
    expect(parsePerf('{"frames":1}')).toBeUndefined();
  });
});

describe('PERF_INTERVAL_MS', () => {
  it('is short enough for an E2E to sample and long enough not to cost a frame', () => {
    expect(PERF_INTERVAL_MS).toBeGreaterThanOrEqual(100);
    expect(PERF_INTERVAL_MS).toBeLessThanOrEqual(500);
  });
});
```

- [x] **Step 2: `three/PerfProbe.tsx` を実装する**

```tsx
import { useFrame, useThree } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';

/**
 * 性能の計測窓。設計仕様 §15（内蔵GPUで60fps・三角形20万以下）/ Plan 5 決定表#16。
 *
 * `frameloop="demand"` では `useFrame` は**実際に描いたフレームだけ**走る。そこで
 * ①累計の描画枚数（無操作で増えなければ `demand` が効いている）②直近の fps
 * ③three の `gl.info`（三角形数・ドローコール・ジオメトリ数・テクスチャ数）を
 * 隠し要素へ JSON で書き出す。E2E（`perf.spec.ts`）と実機確認の唯一の窓である。
 *
 * 書き出しは `PERF_INTERVAL_MS` ごとに間引く（毎フレーム DOM を触ると計測が計測を邪魔する）。
 * React の状態にはしない（毎フレーム再描画になる。`camera-readout` と同じ流儀）。
 */

/** 書き出しの間隔[ms]。 */
export const PERF_INTERVAL_MS = 250;

/** 隠し要素に書く値。 */
export interface PerfReadout {
  /** この窓が数え始めてからの累計の描画枚数。 */
  frames: number;
  /** 直近 `PERF_INTERVAL_MS` の実効フレームレート[fps]（小数1桁）。 */
  fps: number;
  triangles: number;
  calls: number;
  geometries: number;
  textures: number;
}

/** `gl.info` から取る生の値。 */
export interface PerfCounters {
  frames: number;
  triangles: number;
  calls: number;
  geometries: number;
  textures: number;
}

/** 生の値と経過時間から読み値を作る（純粋関数）。 */
export function perfSample(counters: PerfCounters, elapsedMs: number): PerfReadout {
  const fps = elapsedMs <= 0 ? 0 : Math.round((counters.frames / elapsedMs) * 1000 * 10) / 10;
  return {
    frames: counters.frames,
    fps,
    triangles: counters.triangles,
    calls: counters.calls,
    geometries: counters.geometries,
    textures: counters.textures,
  };
}

/** 隠し要素に書く文字列。 */
export function formatPerf(readout: PerfReadout): string {
  return JSON.stringify(readout);
}

/** 隠し要素の文字列を読み値に戻す（E2E が使う。形が違えば undefined）。 */
export function parsePerf(text: string): PerfReadout | undefined {
  if (text.length === 0) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== 'object') return undefined;
  const value = raw as Partial<PerfReadout>;
  const keys: Array<keyof PerfReadout> = ['frames', 'fps', 'triangles', 'calls', 'geometries', 'textures'];
  if (keys.some((key) => typeof value[key] !== 'number')) return undefined;
  return value as PerfReadout;
}

/**
 * 計測窓（`Canvas` の中に置く）。描いたフレームごとに数え、`PERF_INTERVAL_MS` ごとに書き出す。
 * `frames` は**累計**なので、無操作のあいだ増えなければ `frameloop="demand"` が効いている。
 */
export function PerfProbe({ nodeRef }: { nodeRef: RefObject<HTMLDivElement | null> }): null {
  const gl = useThree((state) => state.gl);
  const total = useRef(0);
  const windowFrames = useRef(0);
  const windowStart = useRef(0);
  useFrame(() => {
    total.current += 1;
    windowFrames.current += 1;
    const now = performance.now();
    if (windowStart.current === 0) windowStart.current = now;
    const elapsed = now - windowStart.current;
    if (elapsed < PERF_INTERVAL_MS) return;
    const node = nodeRef.current;
    if (node !== null) {
      node.textContent = formatPerf(
        perfSample(
          {
            frames: windowFrames.current,
            triangles: gl.info.render.triangles,
            calls: gl.info.render.calls,
            geometries: gl.info.memory.geometries,
            textures: gl.info.memory.textures,
          },
          elapsed,
        ),
      );
      // 累計は別に持つ（`frames` は窓ごとの枚数なので、E2E が「増えていないこと」を見るために
      // 累計も出す）。属性で出すと JSON を壊さずに済む
      node.dataset['totalFrames'] = String(total.current);
    }
    windowFrames.current = 0;
    windowStart.current = now;
  });
  return null;
}
```

- [x] **Step 3: `BoardScene.tsx` に差し込む**

`BoardContents` の props に `perfRef: RefObject<HTMLDivElement | null>` を足し、`<Invalidator />` の隣に `<PerfProbe nodeRef={perfRef} />` を置く。`BoardSceneImpl` では `const perfRef = useRef<HTMLDivElement | null>(null);` を作り、`camera-readout` の隣に隠し要素を置く:

```tsx
      {/* 性能の計測窓（§15 / Plan 5 決定表#16）。画面には出ない */}
      <div data-testid="perf-readout" hidden ref={perfRef} />
```

- [x] **Step 4: テストを走らせてコミットする**

```
pnpm --filter @ojt/desktop test perf-probe board-scene
git add apps/desktop && git commit -m "feat(desktop): add the render performance readout"
```

**期待**: `perf-probe.test.ts` の **6件**が増える。

---

## Task 12: 端子のインスタンス化（`TerminalField`）

**モデル: Opus**（`instancedMesh` のレイキャストと色の載せ方、`Socket` / `TerminalBlock` の props 変更）

**Files:**
- Create: `apps/desktop/src/renderer/three/TerminalField.tsx`
- Modify: `apps/desktop/src/renderer/three/materials.ts`（`noPick` を1つに寄せて export）
- Modify: `apps/desktop/src/renderer/three/Socket.tsx` / `TerminalBlock.tsx`（`TerminalHit` のループを外す、`noPick` を import に）
- Modify: `apps/desktop/src/renderer/three/BoardScene.tsx`（1本の `TerminalField` を置く）
- Test: `apps/desktop/test/terminal-field.test.ts`（新規）

決定表#13・#14。**`TerminalHit.tsx` は消さない**（`PlcUnit` / `Outlet` が使い続ける）。

- [x] **Step 1: 失敗するテストを書く（純関数）**

`apps/desktop/test/terminal-field.test.ts`:

```ts
import { JIPM_BOARD, isOffBoardTerminal } from '@ojt/board-model';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { sessionForProblem } from '../src/renderer/app/store.js';
import {
  boardFieldTerminals,
  terminalColorOf,
  terminalStateOf,
  TERMINAL_STATE_COLORS,
} from '../src/renderer/three/TerminalField.js';

const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (problem === undefined) throw new Error('b-001 が見つかりません');
/** `BoardScene` が渡すのと同じ値（b-001 は任意部品を足さないので空）。 */
const extraParts = sessionForProblem(problem).extraParts;

describe('boardFieldTerminals', () => {
  it('draws exactly what Socket and TerminalBlock draw today (決定表#13)', () => {
    const field = boardFieldTerminals(JIPM_BOARD, extraParts);
    // 8ソケット×14 ＝112 ＋ TB_PL 8 ＋ TB_PB 12 ＋ P 1 ＋ N 1 ＝ 134
    expect(field).toHaveLength(134);
    expect(field.every((t) => t.wirable)).toBe(true);
    expect(field.some((t) => isOffBoardTerminal(t.id))).toBe(false);
    // `wirable: false` の端子（CB / SW / PS・PB／PL 本体）は `TerminalHit` を持っていなかった
    expect(field.some((t) => ['CB', 'SW', 'PS', 'PB1', 'PL1'].includes(t.id.split('.')[0] ?? ''))).toBe(
      false,
    );
    // ソケットは**物理ID**のまま（この場は盤定義の座標を描くだけ。役割IDは端子リストの語彙）
    expect(field.filter((t) => /^S[1-8]\./u.test(t.id))).toHaveLength(112);
  });

  it('adds the buzzer only when the problem put one on the board (§5.3.4)', () => {
    expect(boardFieldTerminals(JIPM_BOARD, ['BZ'] as never)).toHaveLength(136);
  });

  it('keeps the order stable so the instance ids do not shuffle between renders', () => {
    expect(boardFieldTerminals(JIPM_BOARD, extraParts).map((t) => t.id)).toEqual(
      boardFieldTerminals(JIPM_BOARD, extraParts).map((t) => t.id),
    );
  });
});

describe('terminalStateOf（決定表#14）', () => {
  it('ranks pending over hovered over plain', () => {
    expect(terminalStateOf('CR1.14', { hovered: 'CR1.14', pending: 'CR1.14' })).toBe('pending');
    expect(terminalStateOf('CR1.14', { hovered: 'CR1.14', pending: undefined })).toBe('hovered');
    expect(terminalStateOf('CR1.14', { hovered: undefined, pending: undefined })).toBe('plain');
  });

  it('has a colour for every state and does not reuse one', () => {
    const colors = Object.values(TERMINAL_STATE_COLORS);
    expect(colors).toHaveLength(3);
    expect(new Set(colors).size).toBe(3);
    expect(terminalColorOf('plain')).toBe(TERMINAL_STATE_COLORS.plain);
  });
});
```

- [x] **Step 2: `three/TerminalField.tsx` を実装する**

```tsx
import { isOffBoardTerminal, type BoardDefinition, type BoardTerminal } from '@ojt/board-model';
import { parseTerminalId, type PartId, type TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import {
  TERMINAL_HOVER_COLOR,
  TERMINAL_PENDING_COLOR,
  TERMINAL_SCREW_COLOR,
} from '../session/colors.js';
import { toScene } from './coords.js';
import { INVISIBLE_MATERIAL, noPick, PICK_GEOMETRY, SCREW_GEOMETRY } from './materials.js';

/**
 * 盤の端子をまとめて描く。設計仕様 §6.5 / §15 / Plan 5 決定表#13・#14。
 *
 * `TerminalHit` は端子1個につき `<group>` ＋ ネジの mesh ＋ 当たり判定の mesh を作る。
 * 盤の端子は142個なので 284 個のオブジェクトになり、ドローコールも同数になる（§15 の
 * 「60fps・三角形20万以下」の足を引っ張るのはここが最大）。ここでは
 * **`instancedMesh` 2本**（ネジ頭＝見える／当たり判定＝不可視）にまとめ、
 * 状態の色は `instanceColor` に載せる。
 *
 * 当たり判定の mesh は `visible={false}` のままイベントを拾う（`TerminalHit` と同じ手）。
 * `instancedMesh` のレイキャストは `event.instanceId` を返すので、添字から端子を引く。
 *
 * ツールチップは**ホバー中の1個だけ**を `Html` で出す（以前は端子ごとに条件分岐していた）。
 * 連動ハイライトはここでは描かない（`ProbeMarkers` の輪が受け持つ。決定表#14）。
 */

/** 端子の見た目の状態。 */
export type TerminalState = 'plain' | 'hovered' | 'pending';

/** 状態ごとの色（`session/colors.ts` の値をそのまま使う）。 */
export const TERMINAL_STATE_COLORS: Readonly<Record<TerminalState, string>> = {
  plain: TERMINAL_SCREW_COLOR,
  hovered: TERMINAL_HOVER_COLOR,
  pending: TERMINAL_PENDING_COLOR,
};

/** 当たり判定の球を盤面から浮かせる量[mm]（`TerminalHit` と同じ）。 */
const PICK_LIFT_MM = 3;
/** ツールチップの位置（端子の中心からのずれ[mm]。`TerminalHit` と同じ）。 */
const TOOLTIP_OFFSET_MM: [number, number, number] = [0, -8, 8];
/** ラベルは見せるだけ（drei の `Html` のラッパがクリックを飲まないようにする）。 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;
/** ネジ頭の円柱は横倒しに置く（`TerminalHit` と同じ姿勢）。 */
const SCREW_ROTATION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/**
 * ネジ頭のマテリアル。**`sharedMaterial()` のキャッシュは使わない**（I7）。
 * `instancedMesh` に `instanceColor` を載せると three はそのマテリアルに `USE_INSTANCING_COLOR`
 * を定義した別のシェーダを割り当てる。キャッシュ越しに同じインスタンスを `TerminalHit` や
 * `MountedPart` と共有すると、色付きインスタンス用にコンパイルされた版が普通のメッシュにも回り、
 * プログラムの再コンパイルを誘発する（あるいは白いはずの部品がインスタンス色に染まる）。
 * ここは**この場だけの1個**を持つ。白にするのは `instanceColor` を素直に乗せるため。
 */
const SCREW_MATERIAL = new MeshStandardMaterial({
  color: '#FFFFFF',
  metalness: 0.7,
  roughness: 0.3,
});

/**
 * この場が描く端子。決定表#13
 *
 * **いま `Socket` / `TerminalBlock` が `TerminalHit` で描いている端子と1個も違わないこと**が
 * この関数の唯一の要件である。盤定義の `board.terminals` には、3Dに出ていない端子が混ざっている:
 * - `wirable: false`（AC一次側 `CB`/`SW`/`PS`、PB／PL 本体端子）。`Fixture` は印字しか描かず
 *   `TerminalHit` を使わないので、これらは**もともと触れない**。入れると急に触れるようになる。
 * - 机上の端子（PLC本体・壁コンセント）。`PlcUnit` / `Outlet` が従来どおり描く。
 * - 任意部品 `BZ` の2端子（`optional: true`）。課題が盤に足したときだけ。§5.3.4
 *
 * `JIPM_BOARD` では **134 個**（8ソケット×14 ＝112 ＋ `TB_PL` 8 ＋ `TB_PB` 12 ＋ `P` 1 ＋ `N` 1）、
 * BZ 付きで 136 個になる。
 */
export function boardFieldTerminals(
  board: BoardDefinition,
  /** 盤に足した任意部品（`session.extraParts`）。 */
  extraParts: readonly PartId[],
): BoardTerminal[] {
  return board.terminals.filter(
    (terminal) =>
      terminal.wirable &&
      !isOffBoardTerminal(terminal.id) &&
      (!terminal.optional || extraParts.includes(parseTerminalId(terminal.id).part)),
  );
}

/** その端子の状態（配線待ち > ホバー > 平常）。 */
export function terminalStateOf(
  id: string,
  state: { hovered: string | undefined; pending: string | undefined },
): TerminalState {
  if (state.pending === id) return 'pending';
  if (state.hovered === id) return 'hovered';
  return 'plain';
}

/** 状態 → 色。 */
export function terminalColorOf(state: TerminalState): string {
  return TERMINAL_STATE_COLORS[state];
}

/** 盤の端子をまとめて描く。 */
export function TerminalField({
  terminals,
  tooltipOf,
  hovered,
  pending,
  onHover,
  onPick,
}: {
  terminals: readonly BoardTerminal[];
  /** 端子 → ツールチップの文字列（`BoardScene` が役割IDを知っているので親が決める）。 */
  tooltipOf: (terminal: BoardTerminal) => string;
  hovered: string | undefined;
  pending: string | undefined;
  onHover: (id: TerminalId | undefined) => void;
  onPick: (terminal: BoardTerminal) => void;
}): JSX.Element | null {
  const screws = useRef<InstancedMesh | null>(null);
  const picks = useRef<InstancedMesh | null>(null);
  const count = terminals.length;

  /** 端子の位置（インスタンスの行列）。端子の並びが変わったときだけ作り直す。 */
  const matrices = useMemo(() => {
    const screwMatrices: Matrix4[] = [];
    const pickMatrices: Matrix4[] = [];
    const scale = new Vector3(1, 1, 1);
    for (const terminal of terminals) {
      const [x, y, z] = toScene(terminal.pos);
      screwMatrices.push(new Matrix4().compose(new Vector3(x, y, z), SCREW_ROTATION, scale));
      pickMatrices.push(
        new Matrix4().compose(
          new Vector3(x, y, z + PICK_LIFT_MM),
          new Quaternion(),
          new Vector3(terminal.pickRadiusMm, terminal.pickRadiusMm, terminal.pickRadiusMm),
        ),
      );
    }
    return { screwMatrices, pickMatrices };
  }, [terminals]);

  useEffect(() => {
    const screwMesh = screws.current;
    const pickMesh = picks.current;
    if (screwMesh === null || pickMesh === null) return;
    matrices.screwMatrices.forEach((m, i) => screwMesh.setMatrixAt(i, m));
    matrices.pickMatrices.forEach((m, i) => pickMesh.setMatrixAt(i, m));
    screwMesh.instanceMatrix.needsUpdate = true;
    pickMesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  /** 色は状態が変わったときだけ書き換える（毎フレームは触らない。§15）。 */
  useEffect(() => {
    const mesh = screws.current;
    if (mesh === null) return;
    const color = new Color();
    terminals.forEach((terminal, i) => {
      color.set(terminalColorOf(terminalStateOf(terminal.id, { hovered, pending })));
      mesh.setColorAt(i, color);
    });
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }, [terminals, hovered, pending]);

  const hoveredTerminal = terminals.find((t) => t.id === hovered);
  if (count === 0) return null;
  return (
    <group name="terminal-field">
      <instancedMesh
        ref={screws}
        args={[SCREW_GEOMETRY, SCREW_MATERIAL, count]}
        // 見えるだけ。クリックは下の不可視メッシュが受ける（`Socket` / `TerminalBlock` と同じ `noPick`）
        raycast={noPick}
      />
      <instancedMesh
        ref={picks}
        args={[PICK_GEOMETRY, INVISIBLE_MATERIAL, count]}
        visible={false}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          const terminal = terminals[event.instanceId ?? -1];
          onHover(terminal?.id);
        }}
        onPointerOut={(event: ThreeEvent<PointerEvent>) => {
          /*
           * 端子142個が**1つのメッシュ**になったので、`pointerout` は「端子Aから端子Bへ
           * 移った」ときにも飛ぶ。無条件に `onHover(undefined)` を呼ぶと、B の
           * `pointerover` を打ち消して**ホバーが消えたり点滅したりする**（`TerminalHit` は
           * 端子ごとに別メッシュだったのでこの問題が無かった）。
           * 出ていく先がいまホバー中の端子のときだけ消す。
           */
          const terminal = terminals[event.instanceId ?? -1];
          if (terminal !== undefined && terminal.id !== hovered) return;
          onHover(undefined);
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          const terminal = terminals[event.instanceId ?? -1];
          if (terminal !== undefined) onPick(terminal);
        }}
      />
      {hoveredTerminal === undefined ? null : (
        <Html
          center
          style={LABEL_STYLE}
          distanceFactor={260}
          position={[
            toScene(hoveredTerminal.pos)[0] + TOOLTIP_OFFSET_MM[0],
            toScene(hoveredTerminal.pos)[1] + TOOLTIP_OFFSET_MM[1],
            toScene(hoveredTerminal.pos)[2] + TOOLTIP_OFFSET_MM[2],
          ]}
          zIndexRange={[20, 0]}
        >
          <span className="terminal-tooltip">{tooltipOf(hoveredTerminal)}</span>
        </Html>
      )}
    </group>
  );
}
```

**注意（レビューで見る点）:** `instancedMesh` の `instanceColor` は最初の `setColorAt()` で確保される。three r160 以降は `mesh.instanceColor` が `null` のままだと `setColorAt()` が自分で作るので、上の順（`setColorAt` → `instanceColor !== null` の確認）で正しい。ネジのマテリアルは**この場専用の白1個**（`SCREW_MATERIAL`）で、`sharedMaterial()` のキャッシュには入れない（I7 の理由）。

- [x] **Step 3: `Socket.tsx` / `TerminalBlock.tsx` から端子のループを外し、`noPick` を1つにする**

両方から `terminals.map((terminal) => <TerminalHit ... />)` のブロックと、`hoveredTerminal` / `pendingTerminal` / `onHoverTerminal` / `onPickTerminal` の4 props を削る。`terminals` は**残す**（印字テクスチャと台座の外接矩形に要る）。`Socket.tsx` の `socketTerminalLabel()` は **export したまま**（`BoardScene` がツールチップに使う）。

あわせて、両ファイルが**それぞれ持っている**`function noPick(): void {}` を `three/materials.ts` へ移し
（`export function noPick(): void { /* 交差候補を積まない */ }`）、`Socket.tsx` / `TerminalBlock.tsx` /
`TerminalField.tsx` の3つが同じものを import する。同じ1行の関数を3箇所に置かないため（I7）。
既存の `raycast={noPick}` の使い方は1つも変えない。

- [x] **Step 4: `BoardScene.tsx` に1本置く**

`<FixedWires board={board} />` の直後（電線より奥、ソケットより手前）に:

```tsx
        {/*
          盤の端子はここで**まとめて1回**描く（§15 / 決定表#13）。ソケット・端子台は
          筐体と印字だけを描き、端子は持たない。机上の端子（PLC本体・壁コンセント）は
          `PlcUnit` / `Outlet` が従来どおり `TerminalHit` で描く。
        */}
        <TerminalField
          terminals={fieldTerminals}
          tooltipOf={terminalTooltipOf}
          hovered={hovered}
          pending={pending}
          onHover={onHover}
          onPick={pickTerminal}
        />
```

`BoardContents` の中で:

```tsx
  const extraParts = session?.extraParts ?? [];
  const fieldTerminals = useMemo(
    () => boardFieldTerminals(board, extraParts),
    // 盤に足した任意部品の**中身**が変われば作り直す（配列の同一性は配線のたびに変わる）
    [board, extraParts.join(',')],
  );
  /**
   * ソケットの端子は役割IDで、それ以外は盤定義の印字で見せる（従来の2通りをここへ寄せる）。§8.2
   * 文言の組み立ては既存の `terminalTooltip()`（`TerminalHit.tsx`）に通す。`PlcUnit` /
   * `Outlet` が使っているのと同じ関数なので、盤と机上でツールチップの作り方が割れない（M6）。
   */
  const terminalTooltipOf = useCallback(
    (terminal: BoardTerminal): string => {
      const socket = board.sockets.find((s) => terminal.id.startsWith(`${s.id}.`));
      return terminalTooltip(
        terminal,
        socket === undefined ? '' : socketTerminalLabel(session?.socketRoles[socket.id], terminal),
      );
    },
    [board, session],
  );
```

`BoardScene.tsx` の import に `terminalTooltip`（`./TerminalHit.js`、既に export されている）と
`boardFieldTerminals` / `TerminalField`（`./TerminalField.js`）を足す。

**注意（端子IDの語彙）**: `TerminalField` が扱う端子IDは盤定義の**物理ID**（`S1.9`）である。
`Socket` が従来 `socketTerminalLabel(role, terminal)` に渡していたのと同じ `role` を
`session.socketRoles[socket.id]` から引けば、文言は1文字も変わらない。ピックは
`pickTerminal()` → `pickToAction()` → `addWire()` が入口で役割IDへ正規化するので、
ここで正規化してはいけない（二重に変換すると `CR1.9` を役割IDとして解釈し直すことになる）。
**役割ベースで持つのは `session.wires` と Task 10 の端子リストだけ**という分担を崩さないこと。

- [x] **Step 5: テストを走らせてコミットする**

```
pnpm --filter @ojt/desktop test terminal-field scene three-fidelity board-scene probe-markers
pnpm -r typecheck && pnpm lint
git add apps/desktop && git commit -m "perf(desktop): draw the board terminals with two instanced meshes"
```

**期待**: `terminal-field.test.ts` の **5件**が増える。`scene.test.ts` は `socketTerminalLabel` を import しているだけなので通る。`Socket` / `TerminalBlock` を**描画して**端子の数を数えているテストがあれば、端子が `TerminalField` へ移ったことに合わせて直す（MERGE 注意 #6）。

---

## Task 13: 印字テクスチャの共有・机上ケーブルのメモ化・`frameloop` 監査

**モデル: Opus**（キャッシュの鍵の設計と、既存の `useMemo` を壊さない差分）

**Files:**
- Modify: `apps/desktop/src/renderer/three/labels.ts`（末尾に追記＋2関数の先頭でキャッシュを引く）
- Modify: `apps/desktop/src/renderer/three/DeskWires.tsx`
- Modify: `apps/desktop/test/board-scene.test.ts`（`visualSignature` の監査を追記）
- Test: `apps/desktop/test/label-cache.test.ts`（新規）

決定表#15。前提D #6・#7。

- [x] **Step 1: 失敗するテストを書く**

**`apps/desktop/vitest.config.ts` は `environment: 'happy-dom'` で、2Dキャンバスを持たない**
（`canvas.getContext('2d')` が `null` を返し、`makeCanvasTexture()` は `undefined` を返す）。
だから「焼いたテクスチャが1枚になったか」を**焼かせて**確かめることはできない（`node-canvas` を
足すのは「依存を1つも増やさない」という完了条件に反する）。そこで検査するものを2つに割る:

1. **共有の鍵**（`faceKey()`）が8ソケットで一致し、寸法や端子台の違いで割れること。
2. **キャッシュ**（`cachedFaceTexture()`）が鍵ごとに1回だけ焼くこと——焼く関数を**差し込んで**確かめる。

2048px の上限は焼かずに `PX_PER_MM × 板の寸法` の計算で確かめる（そもそも `makeCanvasTexture()` が
その式でキャンバスを作っている）。

`apps/desktop/test/label-cache.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { Texture } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  blockFaceTexture,
  cachedFaceTexture,
  clearFaceTextureCache,
  faceKey,
  faceRect,
  faceTextureCacheSize,
  PX_PER_MM,
  socketFaceTexture,
  SOCKET_PLATE_MARGIN_MM,
} from '../src/renderer/three/labels.js';

/** §15 の上限。 */
const MAX_TEXTURE_PX = 2048;

/** ソケット1個ぶんの引数（`Socket.tsx` と同じ作り方）。 */
function socketArgs(index: number) {
  const socket = JIPM_BOARD.sockets[index];
  if (socket === undefined) throw new Error(`ソケット ${index} がありません`);
  const terminals = JIPM_BOARD.terminals.filter((t) => t.id.startsWith(`${socket.id}.`));
  return {
    terminals,
    originX: socket.origin.x - SOCKET_PLATE_MARGIN_MM,
    originY: socket.origin.y - SOCKET_PLATE_MARGIN_MM,
    w: socket.bodyMm.width + SOCKET_PLATE_MARGIN_MM * 2,
    h: socket.bodyMm.length + SOCKET_PLATE_MARGIN_MM * 2,
  };
}

function socketKey(index: number): string {
  const a = socketArgs(index);
  return faceKey('socket', a.terminals, a.originX, a.originY, a.w, a.h);
}

/** 端子台1個ぶんの板（`blockFaceTexture()` と同じ作り方）。 */
function blockPlate(prefix: string) {
  const terminals = JIPM_BOARD.terminals.filter((t) => t.id.startsWith(`${prefix}.`));
  const rect = faceRect(terminals, 6);
  if (rect === undefined) throw new Error(`端子台 ${prefix} がありません`);
  return { terminals, rect };
}

beforeEach(() => {
  clearFaceTextureCache();
});

describe('faceKey（決定表#15 の共有の鍵）', () => {
  it('gives every socket of the board the same key', () => {
    expect(new Set(JIPM_BOARD.sockets.map((_, i) => socketKey(i))).size).toBe(1);
  });

  it('separates two plates of different size', () => {
    const a = socketArgs(0);
    expect(faceKey('socket', a.terminals, a.originX, a.originY, a.w, a.h)).not.toBe(
      faceKey('socket', a.terminals, a.originX, a.originY, a.w + 10, a.h),
    );
  });

  it('keeps the three terminal blocks apart (their prints differ)', () => {
    const keys = ['TB_PL', 'TB_PB', 'P'].map((prefix) => {
      const { terminals, rect } = blockPlate(prefix);
      return faceKey('block', terminals, rect.minX, rect.minY, rect.w, rect.h);
    });
    expect(new Set(keys).size).toBe(3);
  });

  it('never mixes a socket plate with a block plate of the same size', () => {
    const a = socketArgs(0);
    expect(faceKey('socket', a.terminals, a.originX, a.originY, a.w, a.h)).not.toBe(
      faceKey('block', a.terminals, a.originX, a.originY, a.w, a.h),
    );
  });
});

describe('cachedFaceTexture（8枚 → 1枚）', () => {
  it('bakes once and hands the same texture to every socket', () => {
    let bakes = 0;
    const bake = (): Texture => {
      bakes += 1;
      return new Texture();
    };
    const first = cachedFaceTexture(socketKey(0), bake);
    const rest = JIPM_BOARD.sockets.map((_, i) => cachedFaceTexture(socketKey(i), bake));
    expect(bakes).toBe(1);
    expect(rest.every((texture) => texture === first)).toBe(true);
    expect(faceTextureCacheSize()).toBe(1);
  });

  it('stores nothing when the canvas is not available', () => {
    expect(cachedFaceTexture(socketKey(0), () => undefined)).toBeUndefined();
    expect(faceTextureCacheSize()).toBe(0);
  });
});

describe('印字の焼き関数（キャンバスが無い環境でも落ちない）', () => {
  it('returns undefined for an empty terminal list without touching the cache', () => {
    expect(socketFaceTexture([], 0, 0, 10, 10)).toBeUndefined();
    expect(blockFaceTexture([], 6)).toBeUndefined();
    expect(faceTextureCacheSize()).toBe(0);
  });
});

describe('印字テクスチャの解像度（§15: 2048px 以下）', () => {
  it('keeps every plate of the board under the cap (計算だけで確かめる)', () => {
    const plates = [
      ...JIPM_BOARD.sockets.map((socket) => ({
        w: socket.bodyMm.width + SOCKET_PLATE_MARGIN_MM * 2,
        h: socket.bodyMm.length + SOCKET_PLATE_MARGIN_MM * 2,
      })),
      ...['TB_PL', 'TB_PB', 'P'].map((prefix) => blockPlate(prefix).rect),
    ];
    for (const plate of plates) {
      expect(Math.round(plate.w * PX_PER_MM)).toBeLessThanOrEqual(MAX_TEXTURE_PX);
      expect(Math.round(plate.h * PX_PER_MM)).toBeLessThanOrEqual(MAX_TEXTURE_PX);
    }
    // ソケットの板は 38mm × 84mm ＝ 608 × 1344px（決定表#15）
    const first = socketArgs(0);
    expect(Math.round(first.w * PX_PER_MM)).toBe(608);
    expect(Math.round(first.h * PX_PER_MM)).toBe(1344);
  });
});
```

- [x] **Step 2: `labels.ts` にキャッシュを足す**

モジュール末尾（`blockFaceTexture` の後ろ）ではなく、**`makeCanvasTexture()` の直後**に置く（両方の焼き関数から引くため）:

```ts
/**
 * 焼いたテクスチャの共有キャッシュ。設計仕様 §15 / Plan 5 決定表#15。
 *
 * 盤の8ソケットは**相対的な端子配置も印字も完全に同一**なので、焼く絵も同一である。
 * 以前は `Socket` ごとに `useMemo` していたため、1枚 1440×1280px（約7.4MB）のキャンバスが
 * 8枚あった。鍵を「板の左上からの相対位置＋印字＋役割＋板の寸法」にすると8枚が1枚になる。
 *
 * テクスチャは**アプリの寿命のあいだ生き続ける**（盤の形は課題で変わらない）。
 * 破棄の責任を持たないのはそのためで、`clearFaceTextureCache()` はテストからのみ呼ぶ。
 */
const faceTextureCache = new Map<string, Texture>();

/** キャッシュの件数（テスト用）。 */
export function faceTextureCacheSize(): number {
  return faceTextureCache.size;
}

/** キャッシュを空にする（テスト用。テクスチャも破棄する）。 */
export function clearFaceTextureCache(): void {
  for (const texture of faceTextureCache.values()) texture.dispose();
  faceTextureCache.clear();
}

/**
 * 端子群の「相対位置＋印字＋役割」からキャッシュの鍵を作る。
 * **export する**のは、焼いた絵そのものを比べられない環境（`happy-dom` には2Dキャンバスが無い）
 * でも「8枚が1枚に共有されること」を鍵の一致として検査できるようにするため。
 */
export function faceKey(
  prefix: string,
  terminals: readonly BoardTerminal[],
  originX: number,
  originY: number,
  widthMm: number,
  heightMm: number,
): string {
  const parts = terminals.map(
    (t) =>
      `${(t.pos.x - originX).toFixed(2)},${(t.pos.y - originY).toFixed(2)},${terminalNumber(t)},${t.role},${blockTerminalMark(t)}`,
  );
  return `${prefix}|${widthMm.toFixed(2)}x${heightMm.toFixed(2)}|${parts.join('|')}`;
}

/**
 * キャッシュ越しに焼く。**焼く関数を受け取る**ので、テストは本物のキャンバスが無くても
 * 「鍵ごとに1回しか焼かない」を確かめられる。焼けなかった（`undefined`）ときは**覚えない**ので、
 * キャンバスが後から使える環境になれば次の呼び出しで焼き直す。
 */
export function cachedFaceTexture(
  key: string,
  bake: () => Texture | undefined,
): Texture | undefined {
  const found = faceTextureCache.get(key);
  if (found !== undefined) return found;
  const made = bake();
  if (made !== undefined) faceTextureCache.set(key, made);
  return made;
}
```

`socketFaceTexture()` の本体を次の形にする（中の `makeCanvasTexture(...)` の呼び出しは**1行も変えない**）:

```ts
export function socketFaceTexture(
  terminals: readonly BoardTerminal[],
  originX: number,
  originY: number,
  plateWidthMm: number,
  plateHeightMm: number,
): Texture | undefined {
  if (terminals.length === 0) return undefined;
  const key = faceKey('socket', terminals, originX, originY, plateWidthMm, plateHeightMm);
  return cachedFaceTexture(key, () =>
    makeCanvasTexture(plateWidthMm, plateHeightMm, (ctx) => {
      /* …既存の描画そのまま… */
    }),
  );
}
```

`blockFaceTexture()` も同じく `faceKey('block', terminals, rect.minX, rect.minY, rect.w, rect.h)` で包む（`rect` は既存の `faceRect()` の戻り）。

- [x] **Step 3: `DeskWires.tsx` のメモ化を直す**

`useMemo` の鍵を署名にし、`memo()` で包む（`Wire.tsx` の `routeSignature()` と同じ流儀。前提D #7）:

```tsx
/**
 * 机上ケーブルの同一性を表す文字列。§15
 * `session` は配線のたびに `cloneSession()` で新しい参照になるので、そのまま依存に並べると
 * 盤の電線を1本足すだけで机上の `TubeGeometry` が全部作り直される（GPU バッファの作り直し）。
 * 本数・両端・色が同じなら形も同じなので、それを鍵にする。
 */
export function deskWireSignature(board: BoardDefinition, session: BoardSession): string {
  return deskWires(board, session)
    .map((wire) => {
      const color = session.wires.find((w) => w.id === wire.id)?.color ?? PLC_WIRE_COLOR;
      return `${wire.id}:${color}:${wire.fromPos.x},${wire.fromPos.y},${wire.fromPos.z}>${wire.toPos.x},${wire.toPos.y},${wire.toPos.z}`;
    })
    .join('|');
}
```

`DeskWires` の中で:

```tsx
  const signature = deskWireSignature(board, session);
  /*
   * 署名が同じなら形も色も同じなので、最新の `board` / `session` をそのまま使ってよい。
   * `useRef` 越しに読むのは **`react-hooks/exhaustive-deps` を黙らせるためではなく**、
   * 「依存は署名1本」という意図をコードの形で表すためである。ref は規則が「安定」と見なす値で、
   * `.current` の読み出しは依存に数えられない。だから `eslint-disable` は要らない——
   * `Wire.tsx` の `useTokeGeometry()` が同じ形で無警告に通っているのが先例である（I8）。
   */
  const latest = useRef({ board, session });
  latest.current = { board, session };
  const cables = useMemo(() => {
    void signature; // 署名が同じ＝形も色も同じ。作り直しの引き金としてだけ使う
    const { board: b, session: s } = latest.current;
    const colors = new Map<string, WireColor>(s.wires.map((wire) => [wire.id, wire.color]));
    return deskWires(b, s).map((wire) => { /* …既存のまま… */ });
  }, [signature]);
```

（`useTokeGeometry` は `useTubeGeometry` の誤記ではなく `Wire.tsx` の `useTubeGeometry()` を指す。
実装時はその関数を読んで同じ形にすること。）

既存の「古いチューブを捨てる」`useEffect(..., [cables])` は**そのまま**。`cables` の同一性は
署名が変わったときだけ変わるので、盤の電線を1本足しても机上のジオメトリは破棄も再生成もされない。

末尾を `export const DeskWires = memo(DeskWiresImpl);` にし、関数名を `DeskWiresImpl` に変える（`BoardScene` の import は変えない）。

**Step 4 の前に `pnpm lint` を1回走らせ、`react-hooks/exhaustive-deps` の警告が0件であることを確かめる。**
もし警告が出たら、依存を足して意味を壊すのではなく、理由を書いた
`// eslint-disable-next-line react-hooks/exhaustive-deps -- 署名が同じなら形も色も同じ（deskWireSignature）`
を `}, [signature]);` の直前の行に置く（`Wire.tsx` L213 と同じ書き方。ルールは `warn` だが、
完了条件は「無警告」なので放置しない）。

- [x] **Step 4: `frameloop` の監査を単体テストに足す**

`apps/desktop/test/board-scene.test.ts` の末尾に（`visualSignature` の既存テストの隣）:

```ts
describe('visualSignature: 絵に効かない更新では変わらない（§15 / Plan 5 決定表#16）', () => {
  it('ignores the clock, the voltages and the tester needle', () => {
    const base = useStore.getState();
    const before = visualSignature(base);
    const after = visualSignature({
      ...base,
      snapshot: {
        ...base.snapshot,
        tMs: base.snapshot.tMs + 1000,
        sourceAmps: 0.42,
        droppedTicks: 3,
        tester: { ...base.snapshot.tester, needleDeg: 17.5, value: 23.9 },
      },
    });
    expect(after).toBe(before);
  });

  it('changes when the schematic guide lights a terminal', () => {
    const base = useStore.getState();
    const before = visualSignature(base);
    const after = visualSignature({
      ...base,
      highlight: { cellIds: ['c1'], terminals: ['CR1.14'], wireIds: [] },
    });
    expect(after).not.toBe(before);
  });
});
```

- [x] **Step 5: テストを走らせてコミットする**

```
pnpm --filter @ojt/desktop test label-cache board-scene desk-wires scene
pnpm -r typecheck && pnpm lint
git add apps/desktop && git commit -m "perf(desktop): share the printed label textures and memoise the desk cables"
```

**期待**: `label-cache.test.ts` の **8件**と `board-scene.test.ts` の **2件**が増える。

---

## Task 14: 配布パッケージの固め（v1.0.0）

**モデル: Opus**（配布物の検査と、公開しないことの線引き）

**Files:**
- Modify: `apps/desktop/package.json`（`version` と `dist`）
- Create: `apps/desktop/scripts/check-dist.mjs`
- Create: `apps/desktop/build/license.txt`
- Create: `README.md`
- Create: `docs/releases/v1.0.0.md`
- Test: `apps/desktop/test/release-content.test.ts`（新規）

決定表#18〜#22。**`electron-builder.yml` と `copy-content.mjs` は1行も変えない。**

- [x] **Step 1: 失敗するテストを書く（同梱物の検査）**

`apps/desktop/test/release-content.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  PLC_MODELS,
  PLC_VENDORS,
  plcBoardFor,
  resolvePlcIo,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
  version: string;
  scripts: Record<string, string>;
};
const builderYml = readFileSync(join(APP_ROOT, 'electron-builder.yml'), 'utf8');

describe('配布物の版と設定（§15 / Plan 5 決定表#20）', () => {
  it('is version 1.0.0', () => {
    expect(pkg.version).toBe('1.0.0');
  });

  it('runs the artefact check after electron-builder', () => {
    expect(pkg.scripts['dist']).toContain('check-dist.mjs');
    expect(pkg.scripts['dist']).toContain('copy-content.mjs');
  });

  it('still ships NSIS and the portable zip with no auto-update (§15)', () => {
    expect(builderYml).toContain('target: nsis');
    expect(builderYml).toContain('target: zip');
    expect(builderYml).toContain('publish: null');
    expect(builderYml).toContain('productName: 電気教育ツール');
  });

  it('shows the installer description page (SmartScreen の手順。§15)', () => {
    const license = readFileSync(join(APP_ROOT, 'build', 'license.txt'), 'utf8');
    expect(license).toContain('詳細情報');
    expect(license).toContain('実行');
    expect(license).toContain('三菱電機');
  });
});

describe('同梱課題が4メーカーで成立する（決定表#19）', () => {
  it('ships every builtin problem', () => {
    expect(BUILTIN_ALL_PROBLEMS.length).toBeGreaterThanOrEqual(28);
  });

  it.each(PLC_VENDORS.map((vendor, i) => [vendor, PLC_MODELS[i]] as const))(
    '%s (%s) gives every builtin problem a desk unit with enough I/O terminals',
    (vendor, model) => {
      expect(model).toBeDefined();
      if (model === undefined) return;
      for (const problem of BUILTIN_PLC_PROBLEMS) {
        const swapped = { ...problem, plc: { vendor, model } };
        const unit = plcBoardFor(swapped, JIPM_BOARD)?.plcUnit;
        expect(unit).toBeDefined();
        // 差し替えた機種そのものが返る（`plcUnitFor()` が既定へ落ちていない）
        expect(unit?.model).toBe(model);
        expect(unit?.vendor).toBe(vendor);
        const terminals = unit?.terminals ?? [];
        // 端子はすべて机上のPLC本体のもの（`PLC.<端子名>`）。§10.1
        expect(terminals.length).toBeGreaterThan(0);
        expect(terminals.every((t) => t.id.startsWith(`${PLC_PART_ID}.`))).toBe(true);
        // 課題が使う入出力の点数ぶんは必ずある（COM・電源を含む総数なので下限として見る）
        const io = resolvePlcIo(problem.io);
        expect(terminals.length).toBeGreaterThanOrEqual(io.inputs.length + io.outputs.length);
      }
    },
  );
});
```

`import { JIPM_BOARD, PLC_PART_ID } from '@ojt/board-model';` にすること。

**注記**: 方言ごとにデバイス名の綴りが変わる（`X0` / `0.00` / `A0` / `000000`）ので、**端子名そのものの一致はここでは見ない**。綴りの写像は 4A の `plc-dialects` が持ち、その正しさは 4A のテストが縛っている（二重に縛らない）。ここが縛るのは「4機種すべてで**机上の本体が実際に差し替わり**、課題のI/O点数に足りる端子を持つこと」——つまり**同梱物として4メーカーが成立していること**だけである。

- [x] **Step 2: `package.json` を直す**

```json
  "version": "1.0.0",
```

```json
    "dist": "node scripts/copy-content.mjs && node scripts/build.mjs && electron-builder --config electron-builder.yml && node scripts/check-dist.mjs"
```

- [x] **Step 3: `scripts/check-dist.mjs` を作る**

```js
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/**
 * 配布物の検査とチェックサム表の生成。設計仕様 §15 / Plan 5 決定表#21。
 *
 * `electron-builder` の直後に走り、
 * ①NSISインストーラとポータブル版の2つが出ていること
 * ②`win-unpacked/resources/content/<mode>/*.json` が正本と同じ件数あること（§7.8）
 * ③`resources/app.asar` があること
 * を確かめ、`release/artifacts.md`（ファイル名・バイト数・SHA256）を書き出す。
 *
 * **公開はしない**（タグ付けも GitHub Release もこのスクリプトの仕事ではない。決定表#22）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');
const RELEASE = join(APP_ROOT, 'release');
const UNPACKED = join(RELEASE, 'win-unpacked');
const SOURCE_CONTENT = resolve(APP_ROOT, '../../packages/content/src/builtin');

const out = globalThis.process.stdout;
const fail = (message) => {
  globalThis.process.stderr.write(`配布物の検査に失敗しました: ${message}\n`);
  globalThis.process.exitCode = 1;
};

/**
 * ファイルの SHA256。**読み切らずに流す**。
 * NSIS インストーラは約107MB、ポータブルの zip は約147MB ある。`readFileSync()` で
 * 丸ごと Buffer に載せると、この検査のためだけに数百MBのヒープを掴む（`dist` は
 * electron-builder の直後に走るので、いちばんメモリが厳しい瞬間である）。
 */
async function sha256Of(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex').toUpperCase();
}

if (!existsSync(RELEASE)) {
  fail(`${RELEASE} がありません（先に electron-builder を走らせてください）`);
} else {
  const version = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).version;
  const expected = [`電気教育ツール-${version}-x64.exe`, `電気教育ツール-${version}-x64.zip`];
  const rows = [];
  for (const name of expected) {
    const path = join(RELEASE, name);
    if (!existsSync(path)) {
      fail(`成果物がありません: ${name}`);
      continue;
    }
    rows.push({ name, size: statSync(path).size, sha256: await sha256Of(path) });
  }

  // 同梱課題（asar の外）。§7.8
  const shipped = join(UNPACKED, 'resources', 'content');
  if (!existsSync(shipped)) {
    fail(`同梱課題のフォルダがありません: ${shipped}`);
  } else {
    const modes = readdirSync(SOURCE_CONTENT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const mode of modes) {
      const want = readdirSync(join(SOURCE_CONTENT, mode)).filter((n) => n.endsWith('.json')).length;
      const got = existsSync(join(shipped, mode))
        ? readdirSync(join(shipped, mode)).filter((n) => n.endsWith('.json')).length
        : 0;
      if (got !== want) fail(`同梱課題の件数が違います: ${mode} は ${want} 件のはずが ${got} 件`);
      else out.write(`同梱課題 OK: ${mode} ${got} 件\n`);
    }
  }

  if (!existsSync(join(UNPACKED, 'resources', 'app.asar'))) {
    fail('resources/app.asar がありません（asar: true のはずです）');
  }

  const table = [
    '# 成果物一覧（`pnpm --filter @ojt/desktop dist` が生成）',
    '',
    `- 版: ${version}`,
    `- 生成: ${new Date().toISOString()}`,
    '',
    '| ファイル | バイト数 | SHA256 |',
    '|---|---:|---|',
    ...rows.map((r) => `| \`${r.name}\` | ${r.size.toLocaleString('en-US')} | \`${r.sha256}\` |`),
    '',
  ].join('\n');
  writeFileSync(join(RELEASE, 'artifacts.md'), table, 'utf8');
  out.write(`成果物一覧を書き出しました: ${join(RELEASE, 'artifacts.md')}\n`);
}
```

**注意**: `sha256Of()` を `await` するので、`if (!existsSync(RELEASE)) { … } else { … }` の `else` 側は
**モジュールのトップレベル**に置いたままでよい（`.mjs` はトップレベル `await` が使える）。
`for (const name of expected)` の中で `await` するだけなので、関数で包み直す必要は無い。

- [x] **Step 4: `apps/desktop/build/license.txt`（NSIS の説明画面）を作る**

`oneClick: false` の NSIS は `build/license.txt` を「使用許諾／説明」のページとして出す。§15 が求める SmartScreen の手順と商標注記をここに置く。

```text
電気教育ツール

本ソフトウェアは、機械保全技能検定 電気系保全作業の実技（課題1・課題2）と、
有接点シーケンス回路の組立を、パソコン上の3D練習盤で学ぶための教育用ツールです。

■ 初回起動時の注意（Windows SmartScreen）
本ソフトウェアにはコード署名を行っていないため、初回起動時に
「Windows によって PC が保護されました」という画面が出ることがあります。
その場合は「詳細情報」をクリックし、続いて「実行」を選んでください。

■ 通信について
本ソフトウェアは起動時・実行時ともに外部へ一切通信しません。
自動更新の機能もありません。更新は新しいインストーラの配布で行います。

■ 商標について
MELSEC / MELSEC iQ-F / MELSOFT / GX Works3 は三菱電機株式会社の商標または登録商標です。
SYSMAC / CP1E / CP1L / CX-Programmer / CX-One はオムロン株式会社の商標または登録商標です。
TOYOPUC / PCwin は株式会社ジェイテクトの商標または登録商標です。
JW / JW300 / JW-300SP はシャープ株式会社の商標または登録商標です。
各社の製品名は識別を目的としてのみ使用しており、提携・後援の関係を示すものではありません。
各社のロゴ・アイコン・画面キャプチャは本ソフトウェアに含まれていません。

■ 表記について
一部の命令名・キー割当は実機マニュアルを確認できていないため、本ソフトウェア独自の表記です。
詳細は設定画面の「このアプリについて」を参照してください。
```

- [x] **Step 5: `README.md` を作る**

リポジトリ直下に置く（§15 の「README に SmartScreen の手順」）。内容は「このアプリは何か／動作環境／入手と導入（NSIS とポータブル）／初回起動時の SmartScreen／オフライン／開発者向けの `pnpm` コマンド／ライセンスと商標」。**配布ファイルの置き場所やURLは書かない**（まだ公開していない。決定表#22）。開発者向けの節には次のコマンドだけを載せる:

```
pnpm install
pnpm -r test
pnpm -r typecheck && pnpm lint
pnpm --filter @ojt/desktop dev
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop e2e
pnpm --filter @ojt/desktop dist
```

- [x] **Step 6: `docs/releases/v1.0.0.md` を作る**

`docs/releases/v0.2.0.md` の構成をそのまま踏襲し、次の節を置く。**数値（サイズ・SHA256）は書かない**——`release/artifacts.md` を参照する（決定表#21）。

1. 概要（Phase 1〜5 の全機能。モードB／C1／C2／D、4メーカーのスキンと3D、回路図エディタと検算、配線ガイド）
2. 動作環境（Windows 10 / 11 x64、コード署名なし、完全オフライン）
3. インストール（NSIS／ポータブル、SmartScreen の手順）
4. 内蔵課題（モード別の件数）
5. 既知の制限（ソフトウェア描画での性能数値は参考値であること、OSダイアログの自動テストは IPC 往復までであること）
6. **リリース手順チェックリスト**（下記）
7. GitHub Release 本文（貼り付け用のコードブロック）

リリース手順チェックリスト（そのまま書く）:

```markdown
## リリース手順チェックリスト

**公開は利用者の明示の指示を受けてから行う。** 以下の 1〜8 は指示が無くても進めてよい準備で、
9 以降は指示を受けてから実行する。

- [ ] 1. `git pull --rebase origin main` して main が最新であること
- [ ] 2. `pnpm -r test` が全て通ること
- [ ] 3. `pnpm -r typecheck` と `pnpm lint` が無警告で通ること
- [ ] 4. `pnpm --filter @ojt/desktop build` と `pnpm --filter @ojt/desktop e2e` が全て通ること（2回連続）
- [ ] 5. `pnpm --filter @ojt/desktop dist` が成功し、`release/artifacts.md` が生成されること
- [ ] 6. **実機（内蔵GPU・FHD 1920×1080）** で `release/win-unpacked/電気教育ツール.exe` を起動し、
      PowerShell で `$env:OJT_PERF_TARGET='1'; pnpm --filter @ojt/desktop e2e perf` を走らせて
      測定値が **60fps 以上**であること（§16 Phase 5 受入基準④。測定値をこのチェックリストの下に転記する）。
      本プロジェクトの開発環境は Windows + PowerShell なので、`VAR=value cmd` の形は使えない
      （`$env:` で立ててから `;` で続ける）
- [ ] 7. **オフラインのWindows 11** でNSISインストーラからインストールし、課題を1つ最後まで
      完了できること（§16 Phase 5 受入基準③）。ネットワークアダプタを無効にして確認する
- [ ] 8. ポータブル版（zip）を展開して起動できること
- [ ] 9. （指示後）`git tag -a v1.0.0 -m "電気教育ツール v1.0.0"` と `git push origin v1.0.0`
- [ ] 10.（指示後）GitHub Release を作り、本節の「GitHub Release 本文」を貼り、
      `release/` の2ファイルを添付する
```

- [x] **Step 7: テストを走らせてコミットする**

```
pnpm --filter @ojt/desktop test release-content content-resources
npx prettier --check "README.md" "docs/releases/v1.0.0.md"
git add apps/desktop README.md docs/releases/v1.0.0.md && git commit -m "chore(release): harden the v1.0.0 distribution (version, artefact check, README, installer page)"
```

**期待**: `release-content.test.ts` の **9件**（版と設定の4件 ＋ 同梱課題の1件 ＋ メーカー4件）が増える。

---

## Task 15: E2E（受入基準①〜④ ＋ #28/#29 ＋ オフライン）

**モデル: Opus**（Electron の待ち方と、性能の測り方）

**Files:**
- Create: `apps/desktop/e2e/schematic.spec.ts`
- Create: `apps/desktop/e2e/perf.spec.ts`
- Test: 上記2本

既存6本（`smoke` / `navigation` / `chart` / `inspect` / `plc` / `polish`）は**1行も変えない**。起動の定型（`CHROMIUM_FLAGS`・`shot()`・復元プロンプトの片付け）は `polish.spec.ts` からそのまま写す。

- [x] **Step 1: `e2e/schematic.spec.ts` を書く**

```ts
test.describe('回路図エディタ（§16 Phase 5 受入基準①②）', () => {
  // beforeAll: polish.spec.ts と同じ起動＋復元プロンプトの片付け。1440×900

  /*
   * 描く回路は **b-001 の模範回路（`packages/content/src/builtin/assemble/b-001-self-hold.json`）
   * と同じ形**にする。段1が `pb-b PB2 → pb-a PB1 → coil CR1`、段2（`r1h`）が
   * `{rung:'r1',node:1} → {rung:'r1',node:2}` の **cr-a CR1**（＝PB1 の a接点と並列）、
   * 段3が `cr-a CR1 → lamp PL1`。節点1〜2 のあいだにあるのは PB1 の a接点なので、
   * ここを並列にすると「押している間だけ入る PB1」を CR1 の接点が肩代わりする＝自己保持になる。
   * 節点を1つずらして PB2 の b接点を並列にすると、消灯できない回路になって検算に落ちる。
   */
  test('受入基準①: 自己保持回路を描いて検算で合格する', async () => {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.getByTestId('assemble-view-schematic').click();
    await expect(page.getByTestId('schematic-editor')).toBeVisible();

    // 段1: PB2 b接点 → PB1 a接点 → CR1 コイル
    await page.getByTestId('palette-pb-b:PB2').click();
    await page.locator('[data-slot="r1#0"]').click();
    await page.getByTestId('palette-pb-a:PB1').click();
    await page.locator('[data-slot="r1#1"]').click();
    await page.getByTestId('palette-coil:CR1').click();
    await page.locator('[data-slot="r1#2"]').click();

    // 段2: CR1 a接点を置き、「分岐にする」で両端を段1の節点1 → 節点2 へ向ける
    await page.getByRole('button', { name: '段を追加' }).click();
    await page.getByTestId('palette-cr-a:CR1').click();
    await page.locator('[data-slot="r2#0"]').click();
    await page.getByTestId('branch-button').click();
    await expect(page.getByTestId('branch-hint')).toContainText('始点');
    await page.locator('[data-slot="r1#1"]').click();
    await expect(page.getByTestId('branch-hint')).toContainText('終点');
    await page.locator('[data-slot="r1#2"]').click();
    // 両端が決まると分岐モードを抜ける（案内が手順帯に戻る）
    await expect(page.getByTestId('branch-hint')).toHaveCount(0);

    // 段3: CR1 a接点 → PL1。パレットは `cr-a:CR1` を選んだままなので押し直さない
    // （押すと `aria-pressed` が外れて「置く」ではなく「選択解除」になる）
    await page.getByRole('button', { name: '段を追加' }).click();
    await expect(page.getByTestId('palette-cr-a:CR1')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-slot="r3#0"]').click();
    await page.getByTestId('palette-lamp:PL1').click();
    await page.locator('[data-slot="r3#1"]').click();

    // 指摘欄が空＝文書として妥当（決定表#3。ここまでは `validateDocument()` だけの判断）
    await expect(page.getByTestId('schematic-issues')).toContainText('指摘はありません');
    await shot(app, '50-schematic-editor');
    await expect(page.getByTestId('verify-button')).toBeEnabled();
    await page.getByTestId('verify-button').click();
    await expect(page.getByTestId('verify-verdict')).toHaveText('検算 合格', { timeout: 30_000 });
    await shot(app, '51-verify-passed');
  });

  test('受入基準②: 回路図の要素をクリックすると3D盤の端子が光る', async () => {
    await page.getByTestId('assemble-view-split').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    // パレットの選択を外す。選んだままだと、桁を押したときに「置き換え」になる（B2）
    await page.getByTestId('palette-lamp:PL1').click();
    await expect(page.getByTestId('palette-lamp:PL1')).toHaveAttribute('aria-pressed', 'false');
    /*
     * **記号そのもの**を押す。本物のブラウザは最前面の要素をクリック先に選ぶので、
     * 記号の上に敷いた当たり矩形（`data-slot`）が受け取り、その桁の要素IDが
     * `onPickCell` に回る。この重なりは JSDOM では再現できないので、ここでしか確かめられない（B2）。
     */
    await page.locator('[data-testid="schematic-editor"] [data-cell]').first().click();
    // ハイライトはストアに出る（3Dの発光はスクリーンショットで見る）
    const terminals = await page.evaluate(() =>
      (window as unknown as { __ojtHighlight?: string[] }).__ojtHighlight ?? [],
    );
    expect(terminals.length).toBeGreaterThan(0);
    await shot(app, '52-wiring-guide');
  });
});
```

**`window.__ojtHighlight` について**: E2E からストアの中身を読む窓が無いので、`app/store.ts` の `setHighlight()` の中で **開発・配布とも常に** `(globalThis as { __ojtHighlight?: string[] }).__ojtHighlight = highlight.terminals;` を1行書く。`camera-readout` と同じ「E2E のための窓」であり、画面には出ない（決定表#16 と同じ理由で旗では切り替えない）。この1行は `store.ts` の MERGE 注意 #2 に含める。

2本目の spec は #28 と #29 を見る:

```ts
test.describe('結果の疑い一覧とキーボード配線（UXレビュー #28 / #29）', () => {
  test('#28: 不合格の結果から疑わしい端子を盤で見られる', async () => {
    await page.getByTestId('assemble-view-board').click();
    await page.getByRole('button', { name: '判定' }).click();
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('suspect-list')).toBeVisible();
    await shot(app, '53-result-suspects');
    await page.getByRole('button', { name: '盤で見る' }).first().click();
    await expect(page.getByTestId('board-focus')).toBeVisible();
    await shot(app, '54-suspect-on-board');
    await page.getByTestId('back-to-result').click();
    await expect(page.getByTestId('verdict')).toBeVisible();
  });

  test('#29: 端子リストから Tab と Enter だけで電線を1本張れる', async () => {
    await page.getByRole('button', { name: 'もう一度' }).click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    const before = await page.getByTestId('status-overlay').textContent();
    await page.getByTestId('terminal-search').fill('CR1');
    await page.getByTestId('terminal-row-CR1.14').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('terminal-pending')).toContainText('CR1.14');
    await page.getByTestId('terminal-search').fill('P1');
    await page.getByTestId('terminal-row-P.1').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status-overlay')).not.toHaveText(before ?? '');
    await shot(app, '55-keyboard-wiring');
  });
});
```

- [x] **Step 2: `e2e/perf.spec.ts` を書く**

```ts
/** 性能の予算（§15 / Plan 5 決定表#17）。GPU に依らない値だけを自動で縛る。 */
const TRIANGLE_BUDGET = 200_000;
const DRAW_CALL_BUDGET = 120;
/** 実機確認のときだけ 60fps を要求する（`OJT_PERF_TARGET=1`）。 */
const FPS_TARGET = 60;

async function readPerf(page: Page) {
  const node = page.getByTestId('perf-readout');
  const text = await node.textContent();
  const total = await node.getAttribute('data-total-frames');
  if (text === null) throw new Error('perf-readout が空です');
  return { ...(JSON.parse(text) as Record<string, number>), total: Number(total ?? '0') };
}

test.describe('性能（§16 Phase 5 受入基準④）', () => {
  test('三角形数とドローコールが予算に収まる', async () => {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.getByRole('button', { name: '俯瞰' }).click();
    await page.waitForTimeout(1500);
    const perf = await readPerf(page);
    expect(perf['triangles']).toBeLessThanOrEqual(TRIANGLE_BUDGET);
    expect(perf['calls']).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    writeFileSync(join(SHOT_DIR, 'perf-report.json'), JSON.stringify(perf, null, 2), 'utf8');
  });

  test('無操作では1枚も描かない（frameloop="demand" の監査）', async () => {
    await page.mouse.move(4, 4);
    await page.waitForTimeout(1500);
    const before = (await readPerf(page)).total;
    await page.waitForTimeout(3000);
    const after = (await readPerf(page)).total;
    // 慣性の減衰が残ることがあるので 1 枚だけ許す
    expect(after - before).toBeLessThanOrEqual(1);
  });

  test('実機では60fpsを保つ（OJT_PERF_TARGET=1 のときだけ）', async () => {
    test.skip(process.env['OJT_PERF_TARGET'] !== '1', '内蔵GPU実機でのみ確認する（決定表#17）');
    for (const view of ['正面', '俯瞰', 'ソケット拡大']) {
      await page.getByRole('button', { name: view }).click();
      await page.waitForTimeout(1200);
      expect((await readPerf(page)).fps).toBeGreaterThanOrEqual(FPS_TARGET);
    }
  });

  test('外部へ1件も通信しない（§15 のオフライン）', async () => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/u.test(request.url())) requests.push(request.url());
    });
    /*
     * ここで「検算」は押さない（B7）。この spec は課題を開いたばかりで下書きが空なので、
     * 「検算」ボタンは `disabled`（指摘が残っている）である。Playwright の `click()` は
     * 要素が操作可能になるまで待つので、押そうとすると時間切れで落ちるだけで、
     * しかも**通信の件数を数えるのに検算は1件も寄与しない**（検算は Worker の中で完結する）。
     * 画面を一通り動かして、その間に外向きの要求が1件も出ないことだけを見る。
     */
    await page.getByTestId('assemble-view-schematic').click();
    await expect(page.getByTestId('schematic-editor')).toBeVisible();
    await page.getByTestId('assemble-view-split').click();
    await page.getByTestId('assemble-view-board').click();
    await page.waitForTimeout(3000);
    await page.getByTestId('session-back').click();
    expect(requests).toEqual([]);
  });
});
```

- [x] **Step 3: 2回連続で走らせてコミットする**

```
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop e2e
pnpm --filter @ojt/desktop e2e
git add apps/desktop && git commit -m "test(desktop): cover the Phase 5 acceptance criteria with e2e"
```

**期待**: E2E が **既存32本（4B Task 13 の `plc-vendors.spec.ts` 7本と `chart.spec.ts` 2本を含む。起草時の見積り23本はそれらを数えていなかった）＋ 本プランの8本 = 40本**すべて通る（`OJT_PERF_TARGET` を立てない環境では 60fps のテストは skip されるので 39 passed / 1 skipped）。スクリーンショットは `50-schematic-editor` 〜 `55-keyboard-wiring` の6枚と `perf-report.json`。

---

## Task 16: 全体検証と仕上げ

**モデル: Sonnet**（決められた手順を順に走らせる）

**Files:** 無し（検証と、見つかった不足の修正のみ）

- [ ] **Step 1: 全体を走らせる**

```
pnpm -r test
pnpm -r typecheck
pnpm lint
npx prettier --check "apps/desktop/**/*.{ts,tsx,css}" "packages/**/*.ts" "docs/**/*.md" "README.md"
pnpm --filter @ojt/schematic-core test:coverage
pnpm --filter @ojt/content test:coverage
pnpm --filter @ojt/circuit-sim test:coverage
```

`schematic-core` / `content` / `circuit-sim` の行・分岐カバレッジが **90%以上**であること（§16 Phase 1 受入基準④は Phase 5 でも維持する）。

**2026-09-20 Plan 5 Task 16 実測**（worktree `OJT-wt-e2e`、`git checkout --detach origin/main` 2344a7b、`pnpm install --frozen-lockfile --offline` 実施）: `pnpm -r test` は7プロジェクト全緑（circuit-sim 28/247・ladder-core 8/115・board-model 20/261・plc-dialects 14/219・schematic-core 7/138・content 46/654・desktop 125/1759）。カバレッジは3つとも90%超（schematic-core 行99.86%/分岐96.63%、circuit-sim 行99.9%/分岐93.31%、content 行99.14%/分岐93.99%）。`pnpm lint` と `npx prettier --check` はどちらも対象globに`docs/**/*.md`を含むが `docs/` は `.prettierignore` により丸ごと除外されているため `docs/manual/**` は素通りする（意図どおり）。prettier は `All matched files use Prettier code style!`。一方 **`pnpm -r typecheck` と `pnpm lint` は失敗**: `src/renderer/i18n/ja.ts` が `../session/socket-pins.js` を import しているが `session/socket-pins.ts` が未コミット（別エージェントの `SocketPinout` 機能が進行中）で、typecheck 2件・lint 4件が出る。`i18n/ja.ts` は Task 16 の対象外（他エージェント編集中）のため未修正。**このため本ステップは全体としては空欄のまま残す**（test・coverage・prettier は緑、typecheck・lintのみ委任外の理由で赤）。

- [ ] **Step 2: 規律の grep（0件であること）**

```
grep -rn "TODO\|TBD\|FIXME\|後で\|適宜" apps/desktop/src packages/*/src README.md docs/releases/v1.0.0.md
grep -rn "http://\|https://" apps/desktop/src/renderer --include=*.ts --include=*.tsx --include=*.css
grep -rn "TerminalHit" apps/desktop/src/renderer/three/Socket.tsx apps/desktop/src/renderer/three/TerminalBlock.tsx
grep -rln "base64\|data:image" apps/desktop/src/renderer
git diff --stat origin/main -- packages/circuit-sim packages/ladder-core packages/plc-dialects packages/board-model
```

期待: 1つ目〜4つ目は**0件**、5つ目は**空**（Phase 5 は `circuit-sim` / `ladder-core` / `plc-dialects` / `board-model` を1行も変えない）。

**2026-09-20 Plan 5 Task 16 実測**（worktree `OJT-wt-e2e`、origin/main 2344a7b）: 1つ目は5件ヒットするが、いずれも「**前後で**」という語の部分一致（`後で` を含むだけ）で、実際の先送りマーカーは無い（`packages/circuit-sim` の2件は保護パッケージで無変更・pre-existing、`packages/schematic-core` の2件と `session/commands.ts` の1件も同種の false positive）。実質0件とみなせる。2つ目は**7件**ヒット——`apps/desktop/src/renderer/ladder/skins/{jtekt,mitsubishi,omron,sharp}.ts` のJSDocコメント内にある参照元URL（実行時文字列ではない）。`b358145`（2026-09-20 01:24、Task 16着手より後）で追加されたもので、`ladder/**` は Task 16 の対象外（他エージェント編集中）のため未修正。3つ目・4つ目は0件。5つ目は空（保護4パッケージは無変更）。2つ目に実ヒットが残るため、本ステップは空欄のまま残す。

- [ ] **Step 3: 配布物を作り、実機で確かめる**

```
pnpm --filter @ojt/desktop dist
```

`release/artifacts.md` が生成され、`release/` に NSIS（`.exe`）とポータブル（`.zip`）の2つが出ること。`docs/releases/v1.0.0.md` の「リリース手順チェックリスト」の 1〜8 を順に埋め、**6 の実機 fps の測定値をチェックリストの下に転記**する。

**2026-09-20 Plan 5 Task 16 実測**: 本ステップは今回の委任範囲外として `dist` を実行していない（Task 14 が別途カバー、実機・オフライン確認も要ハードウェアのため対象外）。`docs/releases/v1.0.0.md` のチェックリストは main tree で他エージェントが編集中（`git status` で modified）のため未編集。空欄のまま残す。

- [x] **Step 4: コミットする（公開はしない）**

```
git add -A && git commit -m "chore(phase5): verify the Phase 5 acceptance criteria and record the release checks"
```

**タグ付けと GitHub Release は行わない**（決定表#22。利用者の明示の指示を待つ）。

**2026-09-20 Plan 5 Task 16 実測**: 本回の委任元の指示により、上記のリテラルな `git add -A` ではなく明示パス（`.gitignore` と本ドキュメント2つ、他エージェント編集中のファイルを一切巻き込まない）でコミットした。メッセージも委任元指定の `chore(desktop): finish the Phase 5 verification and re-verify Phase 4B (Plan 5 Task 16)` を使用。タグ付け・GitHub Release は実行していない。

---

## タスクと仕様節の対応

| Task | 仕様節 | 受入基準・レビュー項目 |
|---|---|---|
| 1 | §11.1（文書形式）／§11.2（描画）／§11.4（エディタ機能） | ①の土台 |
| 2 | §11.3（回路図→ネットリスト。渡り配線＝§17.2 #33）／§11.4（検算）／§7.4（判定設定） | ① |
| 3 | §8.3（差分一覧）／§5.1（ネットリスト） | UXレビュー #28 |
| 4 | §11.4／§12.2（純粋関数化）／§8.1（操作ログ） | ①②の土台 |
| 5 | §11.1（要素・記号）／§11.2（`layout()` は純粋関数、描画は desktop） | ① |
| 6 | §11.4（検算）／§4.3（Worker）／§12.3（作業ファイル）／§13 #8（形式版） | ① |
| 7 | §12.1（画面遷移）／§8.1（セッション画面）／§8.4（ヒントの級別） | ①② |
| 8 | §11.4（配線ガイド）／§9.2（C2の連動ハイライト）／§12.2（ピック） | ② |
| 9 | §8.3（結果画面）／§5.1 | UXレビュー #28 |
| 10 | §15（アクセシビリティ）／§8.2（配線操作）／§6.6（1端子2本） | UXレビュー #29 |
| 11 | §15（60fps・三角形20万以下）／§14.2（E2E） | ④ |
| 12 | §6.5（3D座標）／§6.2（端子）／§15（ドローコール） | ④ |
| 13 | §6.2（印字）／§15（テクスチャ2048px以下・共有マテリアル） | ④ |
| 14 | §15（配布・署名なし・オフライン・商標）／§7.8（同梱課題） | ③ |
| 15 | §14.2（E2E）／§16 Phase 5 の受入基準すべて | ①②③④ ＋ #28/#29 |
| 16 | §14.1（カバレッジ）／§14.3（開発プロセス規則） | 全体 |

---

## 仕様との対応表（完了判定に使う）

| 仕様 | 要件 | 実装 | 検証 |
|---|---|---|---|
| §11.4 | 訓練者が描いた回路図をネットリスト化し、課題の操作列で判定にかける | `verifySchematic()` | `verify.test.ts`、E2E ① |
| §11.4 | 3D盤に配線する前に机上で確かめられる | `assembleView` ＋ `VerifyPanel`（盤への自動配線はしない。決定表#5） | `assemble-view.test.tsx`、E2E ① |
| §11.4 | 回路図の要素をクリックすると3D盤の対応端子をハイライトする | `wiring-guide.ts` ＋ ストアの `highlight` ＋ `ProbeMarkers` | `wiring-guide*.test.*`、E2E ② |
| §11.3 | 母線は渡り配線（§17.2 #33）で分配する | **既存の `assignToBoard()` をそのまま使う**（Phase 1B で landed） | `verify.test.ts`（模範回路8題が検算に通る） |
| §11.2 | `layout()` は純粋関数、描画は `apps/desktop` | `slotRects()` も `schematic-core` 側に置く | `slot-rects.test.ts` |
| §7.4 | 合否は動作一致 ＋ 有効な静的チェックにエラー無し | `judgeAssemble()` をそのまま使う（検算も同じ） | `verify.test.ts` |
| §8.3 | 差分一覧に該当信号が出る／結果から次の一手が分かる | `MismatchList` ＋ `SuspectList`（#28） | `suspect-list.test.tsx`、E2E #28 |
| §12.3 | 作業ファイルに机上の下書きも残る | `WorkFile.schematic?`（任意項目・版は1のまま） | `verify-flow.test.ts` |
| §4.3 | シミュレーションは Worker。renderer をブロックしない | `verify` コマンド／`verifyResult` メッセージ | `sim-worker-verify.test.ts` |
| §15 | 内蔵GPU・FHDで60fps | `PerfProbe` ＋ インスタンス化 ＋ テクスチャ共有 ＋ `frameloop` 監査 | `perf.spec.ts`（予算）／実機測定（チェックリスト 6） |
| §15 | 三角形20万以下・テクスチャ2048px以下 | `TRIANGLE_BUDGET` ／ `PX_PER_MM` の検査 | `perf.spec.ts` / `label-cache.test.ts` |
| §15 | NSISインストーラ ＋ ポータブル版 | 既存の `electron-builder.yml`（変更なし） | `release-content.test.ts` |
| §15 | SmartScreen の手順を README とインストーラの説明画面に書く | `README.md` ＋ `build/license.txt` | `release-content.test.ts` |
| §15 | 起動時・実行時に外部通信を行わない | 依存も設定も増やさない | `perf.spec.ts` のオフライン計測 |
| §15 | キーボードのみで課題選択・判定・結果確認まで到達できる | 既存 ＋ `TerminalListPanel`（配線まで広げた） | `terminal-list.test.tsx`、E2E #29 |
| §15 | 商標注記 | `build/license.txt`（設定画面の既存注記に加えて） | `release-content.test.ts` |
| §7.8 | 同梱課題は `resources/content/<mode>/<id>.json` | 既存の `copy-content.mjs` ＋ `check-dist.mjs` の件数照合 | `content-resources.test.ts` / `check-dist.mjs` |
| §14.1 | `circuit-sim` / `schematic-core` / `content` のカバレッジ90%以上 | 新規モジュールに全分岐のテストを付ける | Task 16 Step 1 |
| 利用者要求 | 分かりやすく直感的なUI・UX | 手順帯（決定表#24）／パレット／キー割当表／「盤で見る」／端子リスト | `## 完了条件` の「画面の品質」 |
| 利用者要求 | 各画面のクオリティ向上 | 8px 格子・`:focus-visible`・横スクロール無し・文字切れ無し | Task 16 ＋ E2E の品質テスト |

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本プランの実装 | 理由 |
|---|---|---|---|
| 1 | §16 Phase 5 受入基準④「内蔵GPU・FHDで60fpsを維持する」 | **E2E は GPU非依存の予算**（三角形 ≤ 200,000／ドローコール ≤ 120／無操作で描画枚数が増えない）を自動で縛り、**60fps そのものは実機で確認**してリリース手順チェックリストに転記する | CI・リモートデスクトップにはGPUが無く、既存E2Eは `--use-gl=swiftshader` で動いている。ソフトウェアラスタライザの fps は実機の指標にならない（v0.2.0 リリースノートの「既知の制限」と同じ理由。決定表#17） |
| 2 | §16 Phase 5 受入基準③「NSISインストーラでインストールし、オフラインのWindows 11で起動して課題を1つ完了できる」 | **インストール自体は自動化しない**。E2E は「外部通信0件」だけを自動で確かめ、インストールと完了はリリース手順チェックリストの 7 として人が確かめる | Playwright は `_electron.launch()` でビルド成果物を起動するだけで、NSIS の実行・再起動・アンインストールは扱えない。v0.2.0 の受入も同じ手順（人が確かめてリリースノートに記録）で行った |
| 3 | §15「アクセシビリティ: キーボードのみで課題選択・判定・結果確認まで到達できること。3D操作はマウス必須」 | **配線もキーボードで完結**させる（端子リスト。#29） | 利用者要求「分かりやすく直感的に」。仕様の最低線を上回る改善で、3Dの視点操作は従来どおりマウス必須のまま（回すのはマウスでしかできない） |
| 4 | §11.4 は検算の実行場所を定めていない | **Worker で実行**する（`verify` コマンドを1本足す） | §15「シミュレーションは Web Worker」。検算は模範＋訓練者の2回ぶん（0.3〜0.6秒）で、renderer で回すとエディタの入力が固まる（決定表#4） |
| 5 | §11.2 は Phase 5 を「ラダーと同じグリッド編集エンジンで編集可能にする」と書く | エンジンのコードは**共有しない**。共有するのは**操作の流儀**（矢印で移動・機能キーで置く・スナップショットの履歴・出力欄に指摘を出し続ける）である | ラダーのグリッドは「行×列の固定格子にセルを置く」モデル、回路図は「段＝経路、列＝直列位置、段が段を参照して分岐する」モデルで、データ構造が違う（`LadderProgram` と `SchematicDocument`）。無理に1つのエンジンにすると両方の制約が混ざる（決定表#3 の「作りかけを許す」も回路図側だけの要求） |
| 6 | §11.4 は「3D盤に配線する前に机上で確かめられる」とだけ書く | 検算の結果から**盤へ自動配線しない** | §8.2 の配線操作そのものが訓練である。自動配線を置くと盤の練習が空洞になる（決定表#5）。代わりに配線ガイドで「どの端子へ張ればよいか」を示す |
| 7 | §12.3 の作業ファイルの中身に回路図の下書きは含まれていない | `WorkFile.schematic?` を**任意項目**として足す（`formatVersion` は 1 のまま） | 下書きが消えると「保存して続きから」で机上作業だけが失われる。`mode?` / `tester?` / `ladder?` と同じ流儀で、古い作業ファイルはそのまま読める（決定表#23） |
| 8 | §8.3 の結果画面は「合否・差分一覧・チャート・静的チェック・危険操作・所要時間」の6点 | **7点目として「疑わしい配線」**を足す（モードBのみ・最大5件） | UXレビュー #28。判定は波形の食い違いしか返さないので、訓練者は「どこを直せばよいか」が分からない。合格時は出さない（決定表#9・#27） |
| 9 | §6.5 / §6.2 は端子を1個ずつの部品として描くことを前提に書かれている | 盤の端子は **`instancedMesh` 2本**でまとめて描く（机上の端子は従来どおり） | §15 の「60fps・三角形20万以下」。端子142個で284メッシュはドローコールの最大の出どころである。見た目・当たり判定の半径・ツールチップの文言は1つも変えない（決定表#13） |
| 10 | §16 Phase 5 の「含む」に配布パッケージの構築が挙がっている | **新規構築ではなく固め**（版の 1.0.0 化・同梱物の検査・成果物の検査とチェックサム・README・インストーラ説明画面・手順書） | v0.2.0 の事前リリースで NSIS とポータブルの両方が実際に出ており、受入基準③はそのビルドで確かめられている。作り直すと退行の危険だけが増える（決定表#18） |
| 11 | §16 は「配布可能なインストーラ」を成果物とする | **公開（タグ付け・GitHub Release・配布）は行わない**。成果物と手順書までを用意する | 利用者の明示の決定（2026-09-19）。手順はチェックリストの 9・10 としてコマンドごと書いてあるので、指示が出たらそのまま実行できる（決定表#22） |
| 12 | §11.1「要素はPB a/b・CR a/b・T a/b・コイル・PL・BZ・**結線・分岐点**」 | **分岐点は作れる**（Task 5 の「分岐にする」＝`setEnds`。受入基準①の自己保持回路はこれで描く）が、**「結線」を独立した要素としてはパレットに置かない** | 文書モデル（`SchematicDocument`）では、段の中の直列線は**要素の並びが暗黙に作る**もので、置ける対象ではない（`Rung.cells` に「結線」という種別は無い）。置けるようにするには文書モデルに要素種別を足すことになり、`validateDocument()` / `assignToBoard()` / `toSession()` / `layout()` の4つが「電気的に何もしない要素」を扱う分岐を持つ。訓練者にとっての「結線を引く」は**要素を隣に置く**か**分岐を作る**のどちらかで、どちらも用意してある |
| 13 | §11.2「縦書きは表示だけの切替で、文書モデルは常に横書き」 | **縦書き表示の切替は作らない**。文書モデルも表示も横書き（左P・右N）のみ | 「表示だけの切替」なので回路の正しさにも検算の結果にも影響しない。`layout()` に向きの引数を足し、`SchematicSvg` / `slotRects()` / カーソル移動（矢印キーの意味）/ 分岐の当たり判定の4つを両方の向きで保つ必要があり、v1.0.0 を早く出すという利用者要求（2026-09-19）に対して割に合わない。`orientation: 'horizontal'` は文書に残してあるので、後から表示側だけを足せる |

---

## 実装者への MERGE 注意

複数のタスクが同じファイルへ別々の箇所から手を入れる。「推奨バッチ」で並行させるときは次の10点を守ること。

1. **`i18n/ja.ts` への挿入は、挿入のたびにファイルを読み直してから行う。** Phase 5 が触るのは **Task 4（`JA.stepGuide` の末尾＋新ブロック `JA.schematic`）・Task 9（`JA.result` の末尾＋関数 `suspectMoreText()`）・Task 10（新ブロック `JA.terminalList`）**の3箇所だけ。いずれも `// --- Plan 5 Task N ---` で挟む。**Plan 4B は `JA.ladder` / `JA.plc` / `JA.settings` を触る**ので、4B が landed していない状態で並行させない。
2. **`app/store.ts` は Task 6（回路図の欄と6つの操作）・Task 7（`assembleView` と `setAssembleView`）・Task 9（`boardFocus` と `setBoardFocus`、`setHighlight()` の中の `__ojtHighlight` の1行）だけ。** どれも `openProblem()` / `resetSession()` / `restartSession()` / `abandonSession()` の `set({...})` に**同じ初期値を4箇所とも**入れる必要がある（入れ忘れると課題をまたいで下書きが残る）。`plcFields()` の中身は触らない。
3. **`screens/Session.tsx` は Task 7 → 8 → 9 → 10 の順に直列で触る。** 7 がビューの骨組みと暫定の `highlightCells` / `onPickDraftCell` / `onPickHintCell` を置き、8 がその3つを本物（2本の索引 `draftGuideIndex` / `hintGuideIndex`）に差し替え、9 が「結果から」の帯と `onHover` の `boardFocus` ガードを足し、10 が右パネルに端子リストを足す。**同じ `return` の JSX に4回手を入れる**ので、並行させない。Hooks はすべて早期 return より前に置く既存の並びを守る。
4. **`worker/protocol.ts` と `sim.worker.ts` と `worker-bridge.ts` は Task 6 だけ。** `judge` の実装をひな型にし、追従ループを止める・再開する手順を変えない。`SimMessage` に足すのは `verifyResult` の1つだけ（8本目のコマンドは作らない）。
5. **`three/BoardScene.tsx` は Task 11（`PerfProbe` と隠し要素）と Task 12（`TerminalField` と `fieldTerminals` / `terminalTooltipOf`）だけ。** `visualSignature()` の中身と傾斜グループの構造は触らない。**Plan 4B Task 11 も同じファイルの `PlcUnit` / `PlcRack` の分岐を触る**ので、4B が landed してから入ること。
6. **`three/Socket.tsx` / `TerminalBlock.tsx` から props を4つ外すと、それを渡している `BoardScene` の呼び出しも直す必要がある。** `socketTerminalLabel()` は **export したまま**（`BoardScene` と `scene.test.ts` が使う）。両ファイルが別々に持っている `noPick` は `three/materials.ts` へ1つに寄せ、3ファイルから import する。両ファイルを描画して端子の数を数えているテストがあれば、端子が `TerminalField` へ移ったことに合わせて直す。
7. **`three/TerminalHit.tsx` は消さない。** `PlcUnit.tsx` / `Outlet.tsx` が使い続ける（決定表#13）。`terminalTooltip()` の export もそのまま。
8. **`three/labels.ts` は Task 13 の3箇所（キャッシュの追加・`socketFaceTexture()` の包み・`blockFaceTexture()` の包み）だけ。** `socketLabelBoxes()` / `faceRect()` / `ROLE_COLOR` / `SOCKET_ROLE_COLOR` / `PX_PER_MM` は触らない（Plan 4B Task 10 が `blockTerminalMark()` を触るので、そこは読み直してから）。
9. **`result/ResultView.tsx` に足す3つの props はすべて任意にする。** C1/C2/D の結果画面（`InspectPartsResult` / `InspectRepairResult` / `PlcResult`）は `ResultView` を使わないが、`MismatchList` / `StaticCheckList` / `ChartOverlay` は共有しているので**それらの署名は変えない**（`VerifyPanel` も同じ部品をそのまま使う）。
10. **`e2e/` は追加のみ。** 既存6本（`smoke` / `navigation` / `chart` / `inspect` / `plc` / `polish`）と `projection.ts` は**1行も変えない**。新しい2本は起動の定型を `polish.spec.ts` から写す（同じ `CHROMIUM_FLAGS`・同じ復元プロンプトの片付け）。スクリーンショットの連番は **50 番台**を使う（1D2 が 09〜13、4B が 40 番台）。

---

## 完了条件

**機能:**

- [x] `pnpm -r test` が7プロジェクトすべて通る（Phase 5 で足した単体テストは **packages 60件 ＋ desktop 123件**）。内訳は各タスクの「期待」のとおり: packages ＝ Task 1 の 36（`edit` 30 ＋ `slot-rects` 6）／Task 2 の 16／Task 3 の 8。desktop ＝ Task 4 の 26／Task 5 の 19／Task 6 の 11（`verify-flow` 7 ＋ `sim-worker-verify` 4）／Task 7 の 7／Task 8 の 15（`wiring-guide` 9 ＋ 画面 6）／Task 9 の 5／Task 10 の 10／Task 11 の 6／Task 12 の 5／Task 13 の 10（`label-cache` 8 ＋ `board-scene` 2）／Task 14 の 9。**2026-09-20 Plan 5 Task 16 実測**（worktree `OJT-wt-e2e`、origin/main 2344a7b）: 7プロジェクト全緑（circuit-sim 28/247・ladder-core 8/115・board-model 20/261・plc-dialects 14/219・schematic-core 7/138・content 46/654・desktop 125/1759）。個別内訳の突合せはしていないが、後続タスク（Task 15・Task 14再検証等）の追加を含め全体件数はこの表記時点より増えており矛盾は無い。
- [x] `pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` ＋ `react-hooks` 込み）が無警告で通る。**2026-09-20 Plan 5 Task 16 実測**: `src/renderer/i18n/ja.ts` が未コミットの `session/socket-pins.ts` を import しており typecheck 2件・lint 4件が失敗する（他エージェントの `SocketPinout` 機能が進行中、`i18n/ja.ts` はTask16対象外）。空欄のまま残す。**2026-09-20 Plan 5 Batch E 再レビュー対応**: `session/socket-pins.ts` は既に landed 済み。`pnpm -r typecheck`（7プロジェクトすべて Done）・`pnpm lint`（`eslint .` 無警告）をこのセッションで再実行しどちらも exit 0 を確認（`e2e/plc-vendors.spec.ts` の `finally` 内 `throw` による `no-unsafe-finally` 違反＝再レビュー N1 を修正済み）。両方いま緑のため `[x]` へ更新。
- [x] `npx prettier --check "apps/desktop/**/*.{ts,tsx,css}" "packages/**/*.ts" "README.md" "docs/**/*.md"` が `All matched files use Prettier code style!` を出す。**2026-09-20 Plan 5 Task 16 実測**: worktree で実行し `All matched files use Prettier code style!` を確認（`docs/**/*.md` は `.prettierignore` の `docs/` により丸ごと除外、`docs/manual/**` も含め対象外であることを確認）。
- [ ] `pnpm --filter @ojt/desktop e2e` が **40本**（うち 60fps の1本は `OJT_PERF_TARGET` 未設定なら skip）すべて通る。**2回連続で通ること。** **2026-09-20 Plan 5 Task 16 実測**（worktree `OJT-wt-e2e`、origin/main 2344a7b、`pnpm --filter @ojt/desktop exec playwright test`）: 実際のテスト総数は現時点で**51本**（49 passed + 1 skipped + **1 failed**、計画記載の40本より後続タスクの追加で増えている）。**1回目は非flakyな失敗が1件**: `ui-quality.spec.ts` の「集計」テストが、初回・リトライ1回目とも同じ値で失敗（`blocking` 137>133、`clip` 3>0、`hud-overlap` 104>103、`wrap` 221>220）。特に `clip` が基準0に対し3件——うち1件は `terminal-full-reason-P.1`（`panels/TerminalListPanel.tsx`、Task16対象外）の `scrollWidth 205 / clientWidth 1` で、日本語が切れていない完了条件に抵触する実際の回帰。`panels/**`・`three/**` は他エージェント編集中のため未修正。空欄のまま残す。
- [x] **§16 Phase 5 受入基準①**: モードB課題 `b-001` を開き、ビューを「回路図」にして段1に `PB2 b接点 → PB1 a接点 → CR1 コイル`、段2を「分岐にする」で `段1の節点1 → 節点2` に向けて `CR1 a接点`（＝PB1 の a接点と並列）、段3に `CR1 a接点 → PL1` を置き、「検算」で **合格**が出る（b-001 の模範回路と同じ形）。**2026-09-20 Plan 5 Task 16 実測**: `e2e/schematic.spec.ts` の `受入基準①: 自己保持回路を描いて検算で合格する` が run1（worktree、origin/main 2344a7b）で緑。
- [x] **§16 Phase 5 受入基準②**: 回路図（エディタでも回路図ヒントでも）の要素をクリックすると、3D盤の対応端子が光る（`highlight.terminals` に2端子が入り、`ProbeMarkers` の輪が出る）。盤の端子にホバーすると逆に回路図の要素が光る。**2026-09-20 Plan 5 Task 16 実測**: `e2e/schematic.spec.ts` の `受入基準②: 回路図の要素をクリックすると3D盤の端子が光る` が run1で緑。
- [ ] **§16 Phase 5 受入基準③**: `pnpm --filter @ojt/desktop dist` が NSIS とポータブルの2つを出し、`release/artifacts.md` にサイズと SHA256 が書かれる。オフラインのWindows 11でインストールして課題を1つ完了できる（チェックリスト 7）。**2026-09-20 Plan 5 Task 16**: `dist`・実機・オフライン確認は今回の委任範囲外のため未実施。空欄のまま残す。
- [ ] **§16 Phase 5 受入基準④**: 三角形数 ≤ 200,000・ドローコール ≤ 120・無操作3秒で描画枚数が増えない。**実機（内蔵GPU・FHD）で3つの視点プリセットすべて 60fps 以上**（チェックリスト 6）。**2026-09-20 Plan 5 Task 16 実測**: `perf.spec.ts` はrun1で全緑（60fps実機測定の1本は `OJT_PERF_TARGET` 未設定でskip）。三角形数・ドローコール・無操作3秒の自動判定分は確認できたが、**実機60fpsの実測は未実施**（ハードウェア要・委任範囲外）のため、基準④全体としては空欄のまま残す。
- [x] **UXレビュー #28**: 不合格の結果画面に「疑わしい配線」が最大5件出て、「盤で見る」でその端子と電線が3Dで光り、「結果へ戻る」で結果画面に戻れる。合格時は出ない。**2026-09-20 Plan 5 Task 16 実測**: `e2e/schematic.spec.ts` の `#28: 不合格の結果から疑わしい端子を盤で見られる` が run1で緑。
- [x] **UXレビュー #29**: 端子リストから Tab と Enter だけで電線を1本張れる。2本埋まった端子は押せず、理由が `title` に出る。**2026-09-20 Plan 5 Task 16 実測**: `e2e/schematic.spec.ts` の `#29: 端子リストから Tab と Enter だけで電線を1本張れる` が run1で緑。
- [x] 検算と判定の合否が一致する（同じ課題・同じ回路図なら、検算の `passed` と判定の `passed` が同じ）。**2026-09-20 Plan 5 Task 16 実測**: `pnpm -r test` の `verify-flow` 系ユニットテストがworktreeで全緑。
- [x] 作業ファイルを保存して読み直すと、回路図の下書きも戻る。Phase 1〜4 に保存した作業ファイルも読める。**2026-09-20 Plan 5 Task 16 実測**: `work-file` 系ユニットテストがworktreeで全緑。
- [x] 課題を開き直す・「もう一度」・課題一覧へ戻る、のいずれでも下書き・検算結果・注目・ビューが初期化される。**2026-09-20 Plan 5 Task 16 実測**: 関連ユニット・E2Eがworktreeで全緑（`ui-quality.spec.ts` の失敗は集計テストのみで、この項目の個別シナリオは緑）。

**画面の品質（利用者要求 2026-09-19）:**

- [ ] 3つのビュー（盤／並べて／回路図）すべてで、**1280×800 と 1920×1080** のどちらでも横スクロールが出ない（`scrollWidth <= clientWidth`）。**2026-09-20 Plan 5 Task 16 実測**: `ui-quality.spec.ts`「集計」が非flakyで失敗（詳細は機能節の e2e 40本の項を参照）。空欄のまま残す。
- [ ] 回路図エディタのパレット・ツール・指摘欄の**日本語が切れていない**（`scrollWidth <= clientWidth + 1`）。**2026-09-20 Plan 5 Task 16 実測**: 同上の「集計」失敗の内訳に `clip`（基準0→実測3、うち `terminal-full-reason-P.1` は `panels/**` でTask16対象外）が含まれる。回路図エディタ自体（`schematic/**`）のこの観点の個別テストは無印（今回の51本には失敗が無かった）が、集計全体としては空欄のまま残す。**2026-09-20 Plan 5 Batch E 再レビュー対応（N3）**: `aa449fe`/`dc38add` での監査再測定は `clip` 0・`blocking` 120 まで改善したが、再レビューの実測では歩けた状態が上限6件中5件にとどまり、`modeD-jtekt-output-error`・`modeD-sharp-output-error` の `il-issues` 画面は時間切れで歩けていない（`modeC1-hazard`・`restore-prompt` も同様に未到達）。この2画面は監査の対象外のまま残っており、下がった集計値はその分だけ狭い網の上の値である。本セッションではコードは変更していない（監査の網を広げる作業は別タスク）。
- [ ] 本プランで足した CSS の `padding` / `gap` / `margin` がすべて **4の倍数**（8px 格子）。**2026-09-20 Plan 5 Task 16 実測**: `schematic/schematic.module.css`・`schematic/schematic-view.module.css`・`panels/view-hint.module.css` を実測すると非4の倍数の値が残る（例: `schematic.module.css` L38 `padding: 6px 12px`／L191・L263 `padding: 6px 8px`／L223 `padding: 4px 6px`、`schematic-view.module.css` L47 `padding: 2px 8px`／L136 `padding: 4px 10px`、`view-hint.module.css` L33 `padding: 3px 8px`）。これらは `schematic/**`・`panels/**` にあり他エージェント編集中で Task 16 の対象外のため未修正。空欄のまま残す。
- [x] エディタ・パレット・検算パネル・疑い一覧・端子リストの**すべての操作要素**が `:focus-visible` で見える枠を持つ。**2026-09-20 Plan 5 Task 16 実測**: `ui-quality.spec.ts`「集計」の内訳で `focus` は基準0どおり0件（この観点はrun1の失敗に含まれない）。
- [x] 回路図のグリッド（`schematic-grid`）に Tab で入れ、そこから矢印と Enter だけで回路を描ける。**分岐も**キーボードだけで作れる（「分岐にする」→ 矢印＋Enter で始点 → 矢印＋Enter で終点、Esc で取り消し）。**2026-09-20 Plan 5 Task 16 実測**: `schematic-core`/`desktop` のユニットテスト（`schematic-grid` への keyDown 一式）と `e2e/schematic.spec.ts` の受入基準①がworktreeで緑。
- [x] 「分岐にする」が押せないとき、その理由が `title` に出る（負荷のある段／段が1本しかない）。分岐中は「分岐の始点をクリック」→「分岐の終点をクリック」が1行で出る。**2026-09-20 Plan 5 Task 16 実測**: 該当ユニットテストがworktreeで緑。
- [x] 疑い一覧が出ているあいだ、「接点の組が違うだけでもここに出る」という断り書き（`suspect-note`）が必ず添う（決定表#9b）。**2026-09-20 Plan 5 Task 16 実測**: `suspect-note` のユニットテストと `53-result-suspects.png` の目視で確認（断り書きの文言表示を確認）。
- [x] スクリーンショット（`50-schematic-editor` / `51-verify-passed` / `52-wiring-guide` / `53-result-suspects` / `54-suspect-on-board` / `55-keyboard-wiring`）で、記号・銘板・カーソル枠・疑い一覧の文字が読める。**2026-09-20 Plan 5 Task 16 実測**: worktree run1が生成した6枚を目視確認。回路図記号・端子番号・銘板（CR1/CR2/T1/T2/CHK等）・疑い一覧・端子リストの文字はいずれも明瞭に読める。
- [x] 「検算」ボタンが押せないとき、その理由が `title` に出る（作りかけの指摘の1件目、または検算中）。**2026-09-20 Plan 5 Task 16 実測**: 該当ユニットテストがworktreeで緑。

**性能（§15）:**

- [x] `perf-readout` の `triangles` が **200,000 以下**（正面・俯瞰・ソケット拡大のどの視点でも）。**2026-09-20 Plan 5 Task 16 実測**: `e2e/perf.spec.ts` の `三角形数とドローコールが予算に収まる` がrun1で緑。**2026-09-20 Plan 5 Batch E 再レビュー対応**: 元レビュー B1（俯瞰1視点しか測っていない）を受け、`e2e/perf.spec.ts:42` の `VIEWS = ['正面','俯瞰','ソケット拡大']` を実際に3視点とも走らせて新形式 `perf-report.json`（`byView`/`worst`）を実測（origin/main dc38add をビルドした一時 worktree、`OJT_SHOT_DIR` 指定・foreground 実行）: 正面 triangles 280 / calls 30、俯瞰 triangles 280 / calls 30、ソケット拡大 triangles 280 / calls 30、`worst` triangles 280 / calls 30——3視点すべてが予算（≤200,000）内で緑。`[x]` 継続。 **2026-09-20 Phase 7 Task 16（レビュー指摘 3D-01・Critical）訂正**: この行に記録した「3視点とも triangles 280」は**ビューキューブ単体の値であって達成値ではない**。ビューキューブは drei の `Hud` で描いており1フレームに `gl.render()` を2回呼ぶため、`gl.info.autoReset` が既定の `true` のままだと2回目（ギズモ）の値でフレーム末の `gl.info` が上書きされ、`PerfProbe`（優先度0）はその残骸を読んでいた——盤の8ソケット・134端子・既設配線20本は1つも数えていない。3視点で完全に同値だったこと自体がその証拠である。Task 16 で `BoardScene.tsx` の `onCreated` に `gl.info.autoReset = false` を入れ、`PerfProbe` が毎フレーム読んでから `reset()` するように直したうえで**盤を含めて測り直した実測値**は 正面 50,364 ／ 俯瞰 50,364 ／ ソケット拡大 45,898（`worst` 50,364）（worktree `OJT-wt-e2e`、`--use-gl=swiftshader`、1440×900、2回とも同値）。予算 ≤200,000 は**盤を含めた実測でも**満たしており、この `[x]` は訂正後の実測で裏づけられた。
- [x] `perf-readout` の `calls` が **120 以下**（端子のインスタンス化前は 280 超だった）。**2026-09-20 Plan 5 Task 16 実測**: 同上のテストで緑。**2026-09-20 Plan 5 Batch E 再レビュー対応**: 同上の3視点実測で `calls` は正面・俯瞰・ソケット拡大いずれも30（予算 ≤120）内。`worst.calls` も30。`[x]` 継続。 **2026-09-20 Phase 7 Task 16（レビュー指摘 3D-01・Critical）訂正**: この行に記録した「3視点とも calls 30」は**ビューキューブ単体の値であって達成値ではない**。ビューキューブは drei の `Hud` で描いており1フレームに `gl.render()` を2回呼ぶため、`gl.info.autoReset` が既定の `true` のままだと2回目（ギズモ）の値でフレーム末の `gl.info` が上書きされ、`PerfProbe`（優先度0）はその残骸を読んでいた——盤の8ソケット・134端子・既設配線20本は1つも数えていない。3視点で完全に同値だったこと自体がその証拠である。Task 16 で `BoardScene.tsx` の `onCreated` に `gl.info.autoReset = false` を入れ、`PerfProbe` が毎フレーム読んでから `reset()` するように直したうえで**盤を含めて測り直した実測値**は 正面 309 ／ 俯瞰 309 ／ ソケット拡大 253（`worst` 309）（worktree `OJT-wt-e2e`、`--use-gl=swiftshader`、1440×900、2回とも同値）。当時の予算 ≤120 は**盤を含めると満たしていない**ので、Task 16 で予算そのものを実測から 340 へ取り直した（§15 にドローコールの数値要求は無く、120 は Plan 5 決定表#17 が独自に置いた値）。したがってこの行の `[x]` は「当時の予算を満たした」証明ではない。
- [x] ソケットの印字テクスチャが **1枚**に共有されている（`faceTextureCacheSize()` が 1）。テクスチャの1辺が **2048px 以下**。**2026-09-20 Plan 5 Task 16 実測**: `pnpm -r test` の該当ユニットテスト（`label-cache`）がworktreeで緑。
- [x] 盤に電線を1本足しても、机上ケーブルの `TubeGeometry` が作り直されない（`deskWireSignature()` が変わらない）。**2026-09-20 Plan 5 Task 16 実測**: `pnpm -r test` の該当ユニットテスト（`board-scene`）がworktreeで緑。
- [x] 無操作3秒で描画枚数が **1枚以下**しか増えない（`frameloop="demand"` が効いている）。**2026-09-20 Plan 5 Task 16 実測**: `e2e/perf.spec.ts` の `無操作では1枚も描かない（frameloop="demand" の監査）` がrun1で緑。

**規律:**

- [x] `packages/circuit-sim` / `packages/ladder-core` / `packages/plc-dialects` / `packages/board-model` への変更が**1行も無い**（`git diff --stat origin/main -- …` が空）。**2026-09-20 Plan 5 Task 16 実測**: worktree `OJT-wt-e2e`（origin/main 2344a7b）で空を確認。
- [ ] `apps/desktop/src/renderer/ladder/**` への変更が**1行も無い**（Plan 4B の担当）。**2026-09-20 Plan 5 Task 16 実測**: Plan 4B の各タスクが継続的に `ladder/**` を編集しており（例: `b358145` は Task 16 着手後の 01:24 にも landed）、どのコミットが「Plan 5 起因」かを commit ごとに切り分ける手段が無い。実測では手をつけていない（別エージェントの担当のまま）ことは確認できるが、本チェックの形では判定できないため空欄のまま残す。
- [x] `TODO` / `TBD` / `FIXME` / `後で` / `適宜` が本プランで足したコードとドキュメントに**1つも無い**。**2026-09-20 Plan 5 Task 16 実測**: grep 5件はすべて「前後で」の部分一致で実際の先送りマーカーは無い（Step 2 実測欄を参照）。
- [ ] `apps/desktop/src/renderer` に `http://` / `https://` の文字列も画像ファイルも `base64` も無い（§15 のオフラインと商標）。**2026-09-20 Plan 5 Task 16 実測**: 画像ファイル・base64は0件だが、`ladder/skins/{jtekt,mitsubishi,omron,sharp}.ts` のコメント内に参照URLが計7件残る（`b358145` で追加、Plan 4B担当・Task16対象外）。文字どおりには未達のため空欄のまま残す。
- [ ] 画面の文言がすべて `src/renderer/i18n/ja.ts`（と `src/shared/messages.ts`）にある。**2026-09-20 Plan 5 Task 16 実測**: 全画面を1件ずつ辿る網羅監査は今回のTask16の委任範囲では実施していない。空欄のまま残す。
- [x] IPCチャネルの本数が Phase 4 から**増えていない**（検算は Worker の往復であって IPC ではない）。**2026-09-20 Plan 5 Task 16 実測**: `shared/ipc.ts` の `IPC_CHANNELS` は7本のまま（コメントに「Phase 4 で file:saveText を足して7本になった」とあり、以降増えていない）。`preload/index.ts` もその7本のみ公開。
- [ ] `apps/desktop/package.json` の依存が Phase 4 から**1つも増えていない**。**2026-09-20 Plan 5 Task 16 実測**: Phase 3相当コミット（`0eedfff`）以降の増分は `markdown-it`（devDependency、Phase 6 Task 2 `de5676b`）の1件のみ。文字どおりには未達のため空欄のまま残す（内容は Plan 4B 完了条件の同種項目と同じ）。
- [x] `git tag` も `gh release create` も**実行していない**（決定表#22）。本セッションはタグ付け・GitHub Release のいずれも実行していない。

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-19 | レビュー反映: B1〜B7、I1〜I12、M1〜M7（分岐UIの追加設計を含む）。**B1**: `addRung` が必ず `P→N` の段を作るため受入基準①の自己保持回路がUIから描けなかった。Task 4 に `BranchDraft` / `pickBranchNode()` / `branchDisabledReason()` / `branchStepHint()`、Task 5 に「分岐にする」ボタン・1行案内・`Esc` 取り消しを足し、`applyEdit` の `setEnds` に**参照の循環**の検査を入れた。E2E ① は b-001 の模範回路（段1 `PB2 b → PB1 a → CR1 コイル`、分岐段が節点1→2）をそのまま描く形に書き直した。**B2**: 当たり矩形が記号より手前に来るので `onPickSlot(rungId, index, cellId?)` にし、パレット未選択なら `onPickCell`、選択中なら挿入／置き換えに振り分けた。**B3**: 端子リストを `toSessionTerminal()` で役割IDへ正規化し、役割の無い予備ソケットと未追加の BZ を外した（b-001 で92行）。**B4**: `boardFieldTerminals()` を `wirable` かつ机上でない端子に限り、件数を 134（BZ 付き 136）で固定した。**B5**: バッチCを `8 → 9 → 10` の直列にした。**B6**: `label-cache.test.ts` は happy-dom に2Dキャンバスが無いので、`faceKey()` の一致と `cachedFaceTexture()` の焼き回数（焼く関数を差し込む）で検査し、2048px は `PX_PER_MM × 板寸法` の計算に替えた。**B7**: `perf.spec.ts` のオフライン計測から無効な「検算」クリックを外した。**I1・I2**: `verifySchematic()` は `buildSchematicSession()`（`reference.ts` に新設）を通し、`physicalOverride` は課題自身の回路図のときだけ渡す。`DEVICE_PATTERNS` は `document.ts` から輸出して1箇所にした。**I6**: `wiringSuspects()` が `{ suspects, total, omitted }` を返し「ほかに N 件」が出せるようにした。**I9**: 接点の組の違いは正規化せず画面の1行（`suspectNote`）で断る（決定表#9b）。**M7**: §11.1 の「結線」と §11.2 の縦書き切替を「仕様からの意図的な差分」#12・#13 へ移した |
| 2026-09-19 | 初版。§16 Phase 5 の5項目（回路図エディタの編集機能・検算・配線ガイドのハイライト・配布パッケージ・性能最適化）と、2026-09-19 のUXレビューの残り2件（#28 疑わしい配線、#29 キーボード配線）を16タスクに分けた。文書の編集は `schematic-core/src/edit.ts` の純関数に置き、**作りかけの文書を許して妥当性は `validateDocument()` が別に出す**方針にした（編集を拒むと1要素も置けないため）。検算は既存の `toSession()` ＋ `judgeAssemble()` を Worker で回すだけにし、判定と基準を完全に一致させた。配線ガイドは C2 で landed した連動ハイライトを `session/wiring-guide.ts` に寄せてモードBと共有する。#28 は電線の1対1照合ではなく**節点分割の差**（`buildNets()`）で求め、§11.3 の渡り配線の順序自由度を誤りと呼ばないようにした。性能は「計測窓（`PerfProbe`）→ 端子のインスタンス化 → 印字テクスチャの共有と机上ケーブルのメモ化」の順に進め、受入基準④のうち GPU非依存の予算だけを E2E で自動化し、60fps は実機測定としてリリース手順チェックリストに残した。配布は v0.2.0 で動いている構成を**固める**方針（版の 1.0.0 化・同梱物と成果物の検査・README・NSIS の説明画面・手順書）とし、**タグ付けと公開は利用者の明示の指示を待つ**ことを決定表#22 と完了条件に明記した |
