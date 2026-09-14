# Plan 1D1: デスクトップアプリ中核（apps/desktop）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1A の `@ojt/circuit-sim`、Plan 1B の `@ojt/board-model` / `@ojt/schematic-core`、Plan 1C の `@ojt/content` の上に Electron + React + Three.js のアプリ `apps/desktop` を作り、「ホーム → 課題一覧 → 課題を開く → 3D盤で部品装着と配線 → 通電 → PB操作 → 判定 → 結果画面」が実際に動く最小の全体を成立させる（設計仕様 §4.3 / §8 / §12 / §16 Phase 1）。

**Architecture:** Electron を main / preload / renderer の3層に分け（electron-vite）、Node の `fs` を使う課題読込だけを main に置き、`contextBridge` で型付きの `window.ojt` だけを renderer に渡す。回路シミュレーションは Web Worker に隔離し、renderer とは `src/worker/protocol.ts` の1ファイルで定義した型付きメッセージだけをやり取りする。`BoardSession`（訓練者の作業状態）は renderer が所有し、`@ojt/board-model` の `Result` 型を返す操作関数で変更してから、確定した差分だけを Worker に送る。3Dは `@react-three/fiber` で `JIPM_BOARD` の寸法・端子座標・占有矩形・配線帯から生成し、盤の形・ソケット数・端子番号を一切ハードコードしない。「ピック結果 → 操作」の判断は `interaction.ts` の純粋関数に切り出して Vitest で全分岐を検証する（§12.2）。

**Tech Stack:** Electron 44 ＋ electron-vite 5 ／ React 19 ／ TypeScript 6（`strict` ＋ `noUncheckedIndexedAccess`）／ three 0.186 ＋ @react-three/fiber 9 ＋ @react-three/drei 10 ／ zustand 5 ／ 素の CSS Modules ／ Vitest 5（happy-dom ＋ React Testing Library）／ Playwright 1.63（Electron ランナー）。外部CDNからの取得はゼロ（§15 オフライン）。

---

## 前提（この計画が依存する他計画のAPI）

| 依存 | 使うもの |
|---|---|
| Plan 1A `@ojt/circuit-sim` | `Simulation`（`press` / `release` / `setBreaker` / `setSwitch` / `setTimerPreset` / `addWire` / `removeWire` / **`mountPart` / `unmountPart` / `reset`**（Task 8g）/ `step` / `state()` / `log` / `events`）、`createRelay4c` / `createTimer4c`、`TICK_MS`、`HAZARD_KINDS`、`HazardKind` / `MismatchReason`、`LogEntry`、`HazardEvent`、`ChatterEvent`、`LampLevel`、`Part`、`Wire`、`WireColor`、`TerminalId`、`toTerminalId` |
| Plan 1B `@ojt/board-model` | `JIPM_BOARD`（`sizeMm` / `console` / `sockets` / `lamps` / `pushButtons` / `terminals` / `footprints` / `wiringChannels` / `fixedWires` / `fixedLinks`）、`BoardTerminal`（`pos` / `label` / `role` / `pickRadiusMm` / `wirable` / `optional` / `exit`）、`SocketDefinition`（`cluster` / `origin` / `bodyMm`）、`SocketRoles`（`Partial`）と `socketPartId()`、**`P.1` / `N.1` の各1点だけの供給端子**（`SUPPLY_TERMINAL_COUNT = 1`）、`createSession(board, SessionOptions)` / `plug` / `unplug` / `setPreset` / `addWire(session, board, from, to, color, { id })` / `removeWire`（Result型）、`toNetlist` / `netlistIssues`、`routeWire` / `routeSession` / `routeFixedLinks` → **`WireRoute`（`wireId` / `kind: 'direct' \| 'channel' \| 'harness'` / `points` / `corners` / `channelIds` / `lanes: ChannelLane[]` / `lane` / `laneOverflow` / `throughPanelAt?` / `lengthMm`）**、`RoutingError`（`wireId` / `reason: 'invalid-terminal' \| 'unreachable' \| 'footprint-crossing'`）、`WIRE_Z_LADDER_MM` / `runZ()` / `WIRE_DIAMETER_MM` / `CHANNEL_LANE_COUNT` / `CHANNEL_LANE_PITCH_MM`、`crossesFootprint` / `crossingFootprint` / `isManhattan`、`roleLabel` / `socketPinHoleOffsets` / `socketRowExit`、`toNetlistTerminal` / `toPhysicalTerminal`、`remainingInventory` / `catalogEntry` / `findTimerRange`、`validateBoard` |
| | **経路器の約束（Plan 1B 実装済み）**: ①走行高さは `WIRE_Z_LADDER_MM = [2.4, 4.2, 6.0, 7.8]` の段だけを取る（x方向の走りは段0・2、y方向は段1・3。`runZ(axis, layer)` が唯一の情報源）。`WIRE_RUN_Z_MM` は `@deprecated` の別名（＝2.4）なので**経路の不変条件として使わない**（純y方向の渡り線には 2.4 の折れ点が無い）。②高さの変わる角には `z` だけ動く点が必ず入るので、`points` をそのまま `TubeGeometry` に通せば直角経路のまま描ける。**描画側が z を計算してはいけない**。③`lanes[i].span` は帯の占有記録（レーンずらし前の節点座標）であって描画用の座標ではない。**描くのは必ず `points`**。④`routeSession()` は全か無かで、最初に失敗した電線で `RoutingError` を投げる（UI は捕まえること） |
| Plan 1C `@ojt/content` | `BUILTIN_PROBLEMS`、`AssembleProblem`、`buildReferenceSession`、`runOperations`、`buildTimeChart` / `defaultChartSignals` / `timerMarkers` / `TimeChart`、`resolveCompareSignals`、`judgeAssemble` → `JudgeAssembleResult`、`loadProblemsFromDir` / `mergeProblemSets`（**main プロセスでのみ呼ぶ**） |

**この計画に含めないもの**（Plan 1D2 が担当）: 設定画面、作業ファイルの保存／読込、一時保存と起動時の復帰、WebAudio の効果音、回路図ヒントの表示、利用者課題フォルダの合流と読込エラー表示、electron-builder による配布、仕上げのE2E。

---

## ファイル構成

### ルート（Task 1 で変更する）

| ファイル | 単一責務 |
|---|---|
| `pnpm-workspace.yaml` | `apps/*` をワークスペースに含め、`allowBuilds` で electron / esbuild のビルドスクリプトを許可する |
| `eslint.config.js` | `out/`（electron-vite の成果物）と `test-results/`（Playwright の出力）を無視し、`.mjs` を型情報ルールの対象外にする |
| `packages/*/package.json` | `"sideEffects": false` を足し、renderer バンドルから `node:fs` を使う `loadProblemsFromDir` を落とせるようにする |

### `apps/desktop`

| ファイル | 単一責務 |
|---|---|
| `package.json` | パッケージ名 `@ojt/desktop`、ESM、`main`、スクリプト、依存 |
| `tsconfig.json` | `tsconfig.base.json` を継承し、DOM ＋ WebWorker ＋ JSX を足す |
| `electron.vite.config.ts` | main / preload / renderer の3ビルド設定と外部化の指定 |
| `vitest.config.ts` | 単体テストの対象glob、happy-dom 環境 |
| `playwright.config.ts` | Electron E2E のタイムアウトと出力先 |
| `scripts/build.mjs` / `scripts/dev.mjs` | electron-vite を JS API から呼ぶ（CLI の `require(esm)` 循環を踏まないため） |
| `src/shared/ipc.ts` | main ⇄ renderer の IPC 契約（チャネル名・payload 型・`window.ojt` の型） |
| `src/main/index.ts` | ウィンドウ生成とアプリのライフサイクル |
| `src/main/ipc.ts` | IPC ハンドラの登録（§4.3 の6チャネルのみ） |
| `src/main/content-loader.ts` | 課題の供給（1D1 は内蔵課題のみ） |
| `src/main/settings.ts` | 設定の永続化（`userData/settings.json`） |
| `src/main/work-files.ts` | 作業ファイルの保存／読込／一時保存（1D1 では IPC だけ通す） |
| `src/preload/index.ts` | `contextBridge` で `window.ojt` を公開する |
| `src/renderer/index.html` | renderer のエントリHTMLとCSP |
| `src/renderer/main.tsx` | React のマウント |
| `src/renderer/env.d.ts` | `window.ojt` の型宣言 |
| `src/renderer/app/store-types.ts` | ストアの値型のうち React にも three にも依存しないもの |
| `src/renderer/app/store.ts` | zustand ストア（画面状態・セッション・スナップショット） |
| `src/renderer/app/routes.tsx` | ルート → 画面の対応 |
| `src/renderer/app/App.tsx` | 外枠（例外バナー・トースト） |
| `src/renderer/app/global.css` / `app.module.css` | 全体のCSS変数と外枠のレイアウト |
| `src/renderer/i18n/ja.ts` | 日本語文言（§15 の集約） |
| `src/renderer/session/colors.ts` | 3D表示の色（線色・ランプ・押ボタン・筐体） |
| `src/renderer/session/interaction.ts` | ピック結果 → 操作の純粋関数（§12.2） |
| `src/renderer/session/commands.ts` | 盤操作のコマンド履歴（元に戻す／やり直し） |
| `src/renderer/session/spec-chart.ts` | 課題の仕様タイムチャートを模範回路から生成する |
| `src/renderer/session/worker-bridge.ts` | Simulation Worker との橋渡し |
| `src/worker/protocol.ts` | renderer ⇄ Worker のプロトコル型（1箇所で定義） |
| `src/worker/runtime.ts` | 追従ループの純粋部分（`planTicks` / `formatElapsed`） |
| `src/worker/sim.worker.ts` | Worker 本体（`Simulation` を 10ms tick で回す） |
| `src/renderer/three/coords.ts` | 盤モデル座標 → シーン座標 |
| `src/renderer/three/camera.ts` | 盤の傾きと視点プリセットの純粋計算 |
| `src/renderer/three/materials.ts` | 共有ジオメトリ・マテリアル |
| `src/renderer/three/labels.ts` | 端子の印字テクスチャ（機器1個＝テクスチャ1枚） |
| `src/renderer/three/BoardPlate.tsx` | 傾斜コンソールの筐体 |
| `src/renderer/three/DinRail.tsx` | DINレール |
| `src/renderer/three/Socket.tsx` | 14ピンソケット |
| `src/renderer/three/TerminalHit.tsx` | 端子1個（ネジ＋当たり判定＋ツールチップ） |
| `src/renderer/three/TerminalBlock.tsx` | 端子台 |
| `src/renderer/three/Fixtures.tsx` | 固定機器（DC24V電源・ブレーカ・電源スイッチ） |
| `src/renderer/three/FixedWires.tsx` | 既設配線（端子台 → 機器の根元の穴） |
| `src/renderer/three/Lamp.tsx` | 表示灯 |
| `src/renderer/three/PushButton.tsx` | 押ボタン |
| `src/renderer/three/MountedPart.tsx` | 装着したリレー／タイマ |
| `src/renderer/three/Wire.tsx` | 電線（`WireRoute` → チューブ） |
| `src/renderer/three/CameraPresets.tsx` | 視点プリセットの適用 |
| `src/renderer/three/ViewGizmo.tsx` | 左上のビューキューブ |
| `src/renderer/three/BoardScene.tsx` | 3Dシーンの組み立て |
| `src/renderer/panels/*.tsx` | 右パネル・下部パネル・ツールバー |
| `src/renderer/result/*.tsx` | 結果画面の各部品 |
| `src/renderer/screens/{Home,ProblemList,Session,Result}.tsx` | 各画面 |
| `test/*.test.ts(x)` | 純粋関数・ストア・UIの単体テスト |
| `e2e/projection.ts` / `e2e/smoke.spec.ts` | Electron E2E（射影計算とスモーク） |

---

## Task 1: ワークスペースに apps/desktop を足す

**Files:**
- Modify: `pnpm-workspace.yaml`, `eslint.config.js`, `packages/circuit-sim/package.json`, `packages/board-model/package.json`, `packages/schematic-core/package.json`, `packages/content/package.json`
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/vitest.config.ts`, `apps/desktop/scripts/build.mjs`, `apps/desktop/scripts/dev.mjs`


- [ ] **Step 1: `pnpm-workspace.yaml` を書く**

pnpm 10 以降はインストール時のビルドスクリプトを既定で全て止めるため、Electron 本体のダウンロードと esbuild のバイナリ配置を明示的に許可する。

```
packages:
  - 'packages/*'
  - 'apps/*'

# ビルドスクリプトの実行を許可する依存（pnpm 10 以降は既定で全て無効のため明示する）。
# electron はバイナリのダウンロード、esbuild はプラットフォーム別バイナリのリンク、
# electron-winstaller は electron-builder が使う NSIS ツール群の取得に必要。
allowBuilds:
  electron: true
  electron-winstaller: true
  esbuild: true
```

- [ ] **Step 2: `eslint.config.js` を書く**

`out/` は electron-vite の成果物、`test-results/` は Playwright の出力なので lint の対象から外す。`scripts/*.mjs` は型情報を使うルールの対象外にする。

```js
import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `out/` は electron-vite のビルド成果物、`test-results/` は Playwright の出力
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  // 循環依存の検出（設計仕様 §4.2）。import-x は依存グラフを辿るときに
  // `import-x/parsers` を見るため、その設定を持つ typescript プリセットを取り込み、
  // 解決器だけ workspace 対応のものに差し替える。
  importX.flatConfigs.typescript,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['packages/*/tsconfig.json', 'apps/*/tsconfig.json'],
        }),
      ],
    },
    rules: {
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      'import-x/no-unresolved': 'error',
    },
  },
  // 素のJS（設定ファイル・ビルドスクリプト）は型情報を使うルールの対象外にする
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
);
```

- [ ] **Step 3: `packages/*/package.json` の `"type": "module"` の直後に `"sideEffects": false` を足す（4パッケージとも）**

`@ojt/content` の公開APIは `loadProblemsFromDir()`（`node:fs` を使う）も含むため、renderer 側のバンドルに引きずり込まれる。`sideEffects: false` があると Rollup が未使用の再輸出を落とせるので、Worker バンドルが 53KB 小さくなり、`node:fs` のコードが実際に出力から消える（Task 14 の検証手順で確認する）。

```json
  "type": "module",
  "sideEffects": false,
```

- [ ] **Step 4: `apps/desktop/package.json` を書く**

`dev` / `build` は electron-vite の CLI ではなく `scripts/*.mjs` 経由で呼ぶ（Step 7 に理由）。

```json
{
  "name": "@ojt/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "build": "node scripts/build.mjs",
    "start": "electron out/main/index.js",
    "test": "vitest run",
    "e2e": "playwright test",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "dist": "node scripts/build.mjs && electron-builder --config electron-builder.yml"
  },
  "dependencies": {
    "@ojt/board-model": "workspace:*",
    "@ojt/circuit-sim": "workspace:*",
    "@ojt/content": "workspace:*",
    "@ojt/schematic-core": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@react-three/drei": "10.7.8",
    "@react-three/fiber": "9.7.0",
    "@testing-library/react": "16.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@types/three": "0.186.0",
    "@vitejs/plugin-react": "6.1.1",
    "electron": "44.3.0",
    "electron-builder": "26.15.3",
    "electron-vite": "5.0.0",
    "happy-dom": "20.14.5",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "three": "0.186.0",
    "vite": "8.3.0",
    "zustand": "5.0.15"
  }
}
```

- [ ] **Step 5: `apps/desktop/tsconfig.json` を書く**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "types": ["node", "vite/client"],
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.tsx",
    "test/**/*.ts",
    "test/**/*.tsx",
    "e2e/**/*.ts",
    "electron.vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts"
  ]
}
```

- [ ] **Step 6: `apps/desktop/electron.vite.config.ts` を書く**

```ts
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * electron-vite の3ビルド（main / preload / renderer）。設計仕様 §4.3。
 *
 * ワークスペースの `@ojt/*` は生の TypeScript を `exports` に載せているため、main でも
 * 外部化せずバンドルする（`exclude` に列挙）。
 *
 * `external` を明示するのが要点。`electron` は devDependencies にあるので
 * `externalizeDepsPlugin()` の対象にならず、放っておくと **npm パッケージの `electron`**
 * （Electron 実行ファイルのパスを返すだけの CLI ヘルパ）がバンドルされてしまい、
 * main プロセスが `app` を持たないオブジェクトを掴んでウィンドウを1枚も作らなくなる。
 */
const OJT_PACKAGES = ['@ojt/circuit-sim', '@ojt/board-model', '@ojt/schematic-core', '@ojt/content'];

/** main / preload で必ず外部化するもの（Electron 本体と Node 組み込みモジュール）。 */
const NODE_EXTERNALS = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: OJT_PACKAGES })],
    build: {
      rollupOptions: {
        external: NODE_EXTERNALS,
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: NODE_EXTERNALS,
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: { '@shared': resolve(import.meta.dirname, 'src/shared') },
    },
    worker: { format: 'es' },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
      },
    },
  },
});
```

- [ ] **Step 7: `apps/desktop/scripts/build.mjs` を書く**

```js
import { build } from 'electron-vite';

/**
 * electron-vite のビルドを JavaScript API から呼ぶ。
 *
 * `electron-vite build` の CLI は CJS のシムから自前の ESM を `require()` するため、
 * Node 25 系の循環検出に引っかかって `ERR_REQUIRE_CYCLE_MODULE` で落ちることがある。
 * API 経由なら最初から ESM のまま読み込まれるのでこの問題を踏まない。
 */
await build({ configFile: 'electron.vite.config.ts' });
```

- [ ] **Step 8: `apps/desktop/scripts/dev.mjs` を書く**

```js
import { createServer } from 'electron-vite';

/**
 * 開発サーバ（renderer の HMR ＋ main/preload の再ビルド ＋ Electron 起動）。
 * CLI を使わない理由は `scripts/build.mjs` と同じ。
 */
await createServer({ configFile: 'electron.vite.config.ts' }, { rendererOnly: false });
```

- [ ] **Step 9: `apps/desktop/vitest.config.ts` を書く**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'desktop',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
```

- [ ] **Step 10: 依存をインストールする**

実行:

```powershell
pnpm install
```

期待出力:

```text
Scope: all 6 workspace projects
... 
Done in ...

```

Electron のバイナリがダウンロードされたことを確かめる（`path.txt` が出来ていればよい）。

実行:

```powershell
Test-Path node_modules/.pnpm/electron@44.3.0/node_modules/electron/path.txt
```

期待出力:

```text
True
```

`False` のときは pnpm が以前の「ビルドを飛ばした」記録を持っている。次を1度だけ実行する。

```powershell
node node_modules/.pnpm/electron@44.3.0/node_modules/electron/install.js
```

- [ ] **Step 11: 型チェックが通ることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop typecheck
```

期待出力:

```text
（何も出力されない＝成功）
```

- [ ] **Step 12: コミットする**

追加・変更したファイル: `pnpm-workspace.yaml` `eslint.config.js` `packages` `apps/desktop`

```powershell
git add pnpm-workspace.yaml eslint.config.js packages apps/desktop
git commit -m @'
chore(desktop): scaffold electron-vite app package

electron-vite の main/preload/renderer 3ビルドと Vitest/Playwright の設定を置く。
electron-vite の CLI は Node 25 で ERR_REQUIRE_CYCLE_MODULE を踏むため JS API から呼ぶ。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 2: IPC 契約と main / preload

**Files:**
- Create: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/main/content-loader.ts`, `apps/desktop/src/main/settings.ts`, `apps/desktop/src/main/work-files.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/env.d.ts`
- Test: `apps/desktop/test/content-loader.test.ts`

仕様 §4.3 は IPC を6チャネルに限る。型はすべて `src/shared/ipc.ts` に置き、main と preload と renderer がそこだけを見る。


- [ ] **Step 1: `apps/desktop/src/shared/ipc.ts` を書く**

```ts
import type { AssembleProblem, ProblemLoadError } from '@ojt/content';

/**
 * main ⇄ renderer の IPC 契約。設計仕様 §4.3。
 * チャネルは `content:list` / `content:read` / `workfile:save` / `workfile:load` /
 * `settings:get` / `settings:set` の **6本のみ**。preload はこの6本だけを `window.ojt` に出す。
 */

/** IPCチャネル名（この6本以外を足さない。§4.3）。 */
export const IPC_CHANNELS = {
  contentList: 'content:list',
  contentRead: 'content:read',
  workfileSave: 'workfile:save',
  workfileLoad: 'workfile:load',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
} as const;

/** 課題一覧の1行（一覧画面がそのまま描ける形）。§12.1 */
export interface ProblemSummary {
  id: string;
  title: string;
  grade: 1 | 2 | 3;
  /** 課題文の先頭（一覧の説明）。 */
  description: string;
  standardMin: number;
  cutoffMin: number;
  /** 利用者フォルダ由来か。§7.8 */
  source: 'builtin' | 'user';
}

/** 読込に失敗した課題の1行。§13 #1 */
export interface ProblemErrorRow {
  file: string;
  reason: string;
  message: string;
  details: string[];
}

/** `content:list` の戻り。 */
export interface ProblemListPayload {
  problems: ProblemSummary[];
  errors: ProblemErrorRow[];
  /** 利用者課題フォルダの絶対パス（設定画面の表示用）。§7.8 */
  userDir: string;
  /** 利用者課題フォルダが存在したか。§13 #9 */
  userDirExists: boolean;
}

/** 作業ファイルの形式バージョン。未知のバージョンは読み込まない。§13 #8 */
export const WORK_FILE_FORMAT_VERSION = 1;

/** 作業ファイルの中身。§12.3 */
export interface WorkFile {
  formatVersion: number;
  problemId: string;
  /** `BoardSession` をそのまま JSON にしたもの。 */
  session: unknown;
  elapsedMs: number;
  hazardCount: number;
  savedAt: string;
}

/** 保存要求。`kind: 'autosave'` は既定の一時保存先へ黙って書く（§12.3）。 */
export interface WorkFileSaveRequest {
  kind: 'manual' | 'autosave';
  file: WorkFile;
}

/** 保存結果。§13 #7 */
export type WorkFileSaveResult =
  | { ok: true; path: string }
  | { ok: false; canceled: boolean; message: string };

/**
 * 読込要求。
 * `discard: true` は読まずに一時保存を削除する（§12.3「復元しない選択をした場合は
 * 一時保存を削除する」）。§4.3 の6チャネルを増やさないため、削除もこのチャネルで表す。
 */
export interface WorkFileLoadRequest {
  kind: 'manual' | 'autosave';
  discard?: boolean;
}

/** 読込結果。§13 #8 */
export type WorkFileLoadResult =
  | { ok: true; file: WorkFile; path: string }
  | { ok: false; canceled: boolean; message: string };

/** アプリ設定。§12.1 */
export interface AppSettings {
  /** 利用者課題フォルダ。空文字なら既定（`%APPDATA%/OJT電気保全トレーナー/content`）。§7.8 */
  userContentDir: string;
  /** 効果音のON/OFF。§15 */
  soundEnabled: boolean;
  /** 効果音の音量（0〜1）。§15 */
  soundVolume: number;
  /** 起動時に一時保存から復帰するか確認する。§12.3 */
  restorePrompt: boolean;
}

/** 設定の既定値。 */
export const DEFAULT_SETTINGS: AppSettings = {
  userContentDir: '',
  soundEnabled: true,
  soundVolume: 0.5,
  restorePrompt: true,
};

/** preload が `window.ojt` に公開する型付きAPI。§4.3 */
export interface OjtApi {
  listProblems: () => Promise<ProblemListPayload>;
  readProblem: (id: string) => Promise<AssembleProblem | null>;
  saveWorkFile: (request: WorkFileSaveRequest) => Promise<WorkFileSaveResult>;
  loadWorkFile: (request: WorkFileLoadRequest) => Promise<WorkFileLoadResult>;
  getSettings: () => Promise<AppSettings>;
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}

/** `ProblemLoadError` を一覧行に直す。§13 #1 */
export function toErrorRow(error: ProblemLoadError): ProblemErrorRow {
  return {
    file: error.file,
    reason: error.reason,
    message: error.message,
    details: error.issues.map((i) => `${i.path}: ${i.message}`),
  };
}

/** 課題を一覧行に直す。 */
export function toSummary(
  problem: AssembleProblem,
  source: 'builtin' | 'user',
): ProblemSummary {
  return {
    id: problem.id,
    title: problem.title,
    grade: problem.grade,
    description: problem.description,
    standardMin: problem.timeLimit.standardMin,
    cutoffMin: problem.timeLimit.cutoffMin,
    source,
  };
}
```

- [ ] **Step 2: `apps/desktop/src/main/content-loader.ts` を書く**

Plan 1D1 では内蔵課題だけを返す。利用者フォルダの合流（`loadProblemsFromDir` ＋ `mergeProblemSets`）は Plan 1D2 でここを置き換えて足す。

```ts
import { BUILTIN_PROBLEMS, type AssembleProblem } from '@ojt/content';
import { toSummary, type ProblemListPayload } from '../shared/ipc.js';

/**
 * 課題の供給。設計仕様 §7.8。
 * Plan 1D1 では内蔵課題だけを返す（利用者フォルダの合流は Plan 1D2 で足す）。
 * Node の `fs` を使う `loadProblemsFromDir()` は main プロセスでしか動かないため、この層に置く。
 */

/** 課題一覧の中身（IDで引けるようにした一覧つき）。 */
export interface LoadedContent {
  payload: ProblemListPayload;
  byId: Map<string, AssembleProblem>;
}

/** 内蔵課題だけを課題一覧の形にする。§7.9 */
export function loadContent(userDir: string): LoadedContent {
  const problems = [...BUILTIN_PROBLEMS];
  return {
    payload: {
      problems: problems.map((p) => toSummary(p, 'builtin')),
      errors: [],
      userDir,
      userDirExists: false,
    },
    byId: new Map(problems.map((p) => [p.id, p] as const)),
  };
}
```

- [ ] **Step 3: `apps/desktop/src/main/settings.ts` を書く**

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/ipc.js';

/**
 * 設定の永続化。設計仕様 §12.1 / §4.3。
 * `app.getPath('userData')/settings.json` に1ファイルで持つ。読めなければ既定値で動く。
 */

/** 設定ファイルのパス。 */
export function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** 利用者課題フォルダの既定パス。§7.8 */
export function defaultUserContentDir(): string {
  return join(app.getPath('appData'), 'OJT電気保全トレーナー', 'content');
}

function coerce(raw: unknown): AppSettings {
  const base = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return base;
  const source = raw as Record<string, unknown>;
  if (typeof source['userContentDir'] === 'string') base.userContentDir = source['userContentDir'];
  if (typeof source['soundEnabled'] === 'boolean') base.soundEnabled = source['soundEnabled'];
  if (typeof source['soundVolume'] === 'number') {
    base.soundVolume = Math.min(1, Math.max(0, source['soundVolume']));
  }
  if (typeof source['restorePrompt'] === 'boolean') base.restorePrompt = source['restorePrompt'];
  return base;
}

/** 設定を読む。未設定の利用者フォルダは既定パスに解決して返す。 */
export function readSettings(): AppSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch {
    raw = undefined;
  }
  const settings = coerce(raw);
  if (settings.userContentDir.length === 0) settings.userContentDir = defaultUserContentDir();
  return settings;
}

/** 設定を部分更新して保存し、更新後の全体を返す。 */
export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch };
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
```

- [ ] **Step 4: `apps/desktop/src/main/work-files.ts` を書く**

作業ファイルのUI（保存／読込ボタン、一時保存、復帰）は Plan 1D2 で足すが、IPC の口はここで揃えておく（チャネルを後から増やさないため）。

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import {
  WORK_FILE_FORMAT_VERSION,
  type WorkFile,
  type WorkFileLoadRequest,
  type WorkFileLoadResult,
  type WorkFileSaveRequest,
  type WorkFileSaveResult,
} from '../shared/ipc.js';

/**
 * 作業ファイルの保存／読込と一時保存。設計仕様 §12.3 / §13 #7 / §13 #8。
 * 拡張子は `.ojtw`。一時保存は `app.getPath('userData')/autosave.json` に固定で書く。
 */

/** 一時保存のパス。§12.3 */
export function autosavePath(): string {
  return join(app.getPath('userData'), 'autosave.json');
}

/** 作業ファイルの検証。未知の `formatVersion` は読み込まない。§13 #8 */
export function parseWorkFile(raw: unknown): { ok: true; file: WorkFile } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: '作業ファイルの形式が不正です' };
  }
  const source = raw as Record<string, unknown>;
  const version = source['formatVersion'];
  if (typeof version !== 'number') {
    return { ok: false, message: '作業ファイルに形式バージョンがありません' };
  }
  if (version > WORK_FILE_FORMAT_VERSION) {
    return { ok: false, message: 'このファイルは新しいバージョンで作成されています' };
  }
  if (typeof source['problemId'] !== 'string' || source['session'] === undefined) {
    return { ok: false, message: '作業ファイルに課題IDまたは盤の状態がありません' };
  }
  return {
    ok: true,
    file: {
      formatVersion: version,
      problemId: source['problemId'],
      session: source['session'],
      elapsedMs: typeof source['elapsedMs'] === 'number' ? source['elapsedMs'] : 0,
      hazardCount: typeof source['hazardCount'] === 'number' ? source['hazardCount'] : 0,
      savedAt: typeof source['savedAt'] === 'string' ? source['savedAt'] : '',
    },
  };
}

/** 一時保存を消す（「復元しない」を選んだとき）。§12.3 */
export function clearAutosave(): void {
  try {
    rmSync(autosavePath(), { force: true });
  } catch {
    // 消せなくても起動を妨げない
  }
}

/** 作業ファイルを保存する。`manual` はダイアログで保存先を選ばせる。§12.3 / §13 #7 */
export async function saveWorkFile(
  window: BrowserWindow | undefined,
  request: WorkFileSaveRequest,
): Promise<WorkFileSaveResult> {
  let target = autosavePath();
  if (request.kind === 'manual') {
    const picked = await dialog.showSaveDialog(
      window ?? ({} as BrowserWindow),
      {
        title: '作業ファイルを保存',
        defaultPath: join(app.getPath('documents'), `${request.file.problemId}.ojtw`),
        filters: [{ name: 'OJT作業ファイル', extensions: ['ojtw'] }],
      },
    );
    if (picked.canceled || picked.filePath === undefined) {
      return { ok: false, canceled: true, message: '保存を取り消しました' };
    }
    target = picked.filePath;
  }
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(request.file, null, 2)}\n`, 'utf8');
    return { ok: true, path: target };
  } catch (cause) {
    return { ok: false, canceled: false, message: `保存に失敗しました: ${String(cause)}` };
  }
}

/** 作業ファイルを読み込む。`manual` はダイアログで選ばせる。§12.3 / §13 #8 */
export async function loadWorkFile(
  window: BrowserWindow | undefined,
  request: WorkFileLoadRequest,
): Promise<WorkFileLoadResult> {
  if (request.discard === true) {
    clearAutosave();
    return { ok: false, canceled: true, message: '一時保存を削除しました' };
  }
  let target = autosavePath();
  if (request.kind === 'manual') {
    const picked = await dialog.showOpenDialog(
      window ?? ({} as BrowserWindow),
      {
        title: '作業ファイルを読み込む',
        properties: ['openFile'],
        filters: [{ name: 'OJT作業ファイル', extensions: ['ojtw'] }],
      },
    );
    const first = picked.filePaths[0];
    if (picked.canceled || first === undefined) {
      return { ok: false, canceled: true, message: '読込を取り消しました' };
    }
    target = first;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(target, 'utf8'));
  } catch (cause) {
    return { ok: false, canceled: false, message: `ファイルを読めませんでした: ${String(cause)}` };
  }
  const parsed = parseWorkFile(raw);
  if (!parsed.ok) return { ok: false, canceled: false, message: parsed.message };
  return { ok: true, file: parsed.file, path: target };
}
```

- [ ] **Step 5: `apps/desktop/src/main/ipc.ts` を書く**

```ts
import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS, type AppSettings, type WorkFileLoadRequest, type WorkFileSaveRequest } from '../shared/ipc.js';
import { loadContent } from './content-loader.js';
import { readSettings, writeSettings } from './settings.js';
import { loadWorkFile, saveWorkFile } from './work-files.js';

/**
 * IPC ハンドラ。設計仕様 §4.3 の6チャネルだけを登録する。
 * renderer からの入力は信用せず、この層で型を確かめてから使う。
 */

/** §4.3 の6チャネルを登録する。 */
export function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.contentList, () => loadContent(readSettings().userContentDir).payload);

  ipcMain.handle(IPC_CHANNELS.contentRead, (_event, id: unknown) => {
    if (typeof id !== 'string') return null;
    return loadContent(readSettings().userContentDir).byId.get(id) ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.workfileSave, async (event, request: WorkFileSaveRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return saveWorkFile(window, request);
  });

  ipcMain.handle(IPC_CHANNELS.workfileLoad, async (event, request: WorkFileLoadRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return loadWorkFile(window, request);
  });

  ipcMain.handle(IPC_CHANNELS.settingsGet, () => readSettings());

  ipcMain.handle(IPC_CHANNELS.settingsSet, (_event, patch: Partial<AppSettings>) =>
    writeSettings(patch ?? {}),
  );
}
```

- [ ] **Step 6: `apps/desktop/src/main/index.ts` を書く**

```ts
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc.js';

/**
 * Electron main。設計仕様 §4.3 / §12。
 * `nodeIntegration` は無効、`contextIsolation` は有効。renderer には preload の6チャネルだけを渡す。
 * 完全オフライン（§1.2）のため、外部URLの読込は一切しない。
 */

/** 起動時のウィンドウ寸法（FHDで盤と右パネルが同時に見える大きさ）。§15 */
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 900;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'OJT電気保全トレーナー',
    backgroundColor: '#1b1e24',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.setMenuBarVisibility(false);
  window.on('ready-to-show', () => {
    window.show();
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl !== undefined && devUrl.length > 0) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
  return window;
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 7: `apps/desktop/src/preload/index.ts` を書く**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AppSettings,
  type OjtApi,
  type ProblemListPayload,
  type WorkFileLoadRequest,
  type WorkFileLoadResult,
  type WorkFileSaveRequest,
  type WorkFileSaveResult,
} from '../shared/ipc.js';

/**
 * preload。設計仕様 §4.3。
 * `contextBridge` で §4.3 の6チャネルだけを `window.ojt` として公開する。
 * `ipcRenderer` そのものは決して露出しない。
 */

const api: OjtApi = {
  listProblems: () => ipcRenderer.invoke(IPC_CHANNELS.contentList) as Promise<ProblemListPayload>,
  readProblem: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.contentRead, id),
  saveWorkFile: (request: WorkFileSaveRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.workfileSave, request) as Promise<WorkFileSaveResult>,
  loadWorkFile: (request: WorkFileLoadRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.workfileLoad, request) as Promise<WorkFileLoadResult>,
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet) as Promise<AppSettings>,
  setSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.settingsSet, patch) as Promise<AppSettings>,
};

contextBridge.exposeInMainWorld('ojt', api);
```

- [ ] **Step 8: `apps/desktop/src/renderer/env.d.ts` を書く**

```ts
import type { OjtApi } from '../shared/ipc.js';

/** preload が `contextBridge` で公開する API。設計仕様 §4.3。 */
declare global {
  interface Window {
    ojt: OjtApi;
  }
}

export {};
```

- [ ] **Step 9: `apps/desktop/test/content-loader.test.ts` を書く**

```ts
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/main/content-loader.js';

describe('loadContent（Plan 1D1: 内蔵課題のみ）', () => {
  it('内蔵課題8題を一覧の形で返す（§7.9）', () => {
    const { payload, byId } = loadContent('C:/not/used/yet');
    expect(payload.problems).toHaveLength(BUILTIN_PROBLEMS.length);
    expect(payload.problems.every((p) => p.source === 'builtin')).toBe(true);
    expect(payload.errors).toHaveLength(0);
    expect(payload.userDirExists).toBe(false);
    expect(byId.get('b-001')?.title).toBe('自己保持回路');
  });

  it('級・標準時間・打切り時間を一覧行に載せる（§7.1）', () => {
    const row = loadContent('').payload.problems.find((p) => p.id === 'b-001');
    expect(row?.grade).toBe(3);
    expect(row?.standardMin).toBe(30);
    expect(row?.cutoffMin).toBe(50);
  });
});
```

- [ ] **Step 10: テストを実行する**

実行:

```powershell
pnpm --filter @ojt/desktop test -- content-loader
```

期待出力:

```text
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

- [ ] **Step 11: コミットする**

追加・変更したファイル: `apps/desktop/src/shared` `apps/desktop/src/main` `apps/desktop/src/preload` `apps/desktop/src/renderer/env.d.ts` `apps/desktop/test/content-loader.test.ts`

```powershell
git add apps/desktop/src/shared apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/renderer/env.d.ts apps/desktop/test/content-loader.test.ts
git commit -m @'
feat(desktop): add ipc contract, main process and preload bridge

設計仕様 §4.3 の6チャネルだけを contextBridge で公開する。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 3: Worker プロトコルと追従ループ

**Files:**
- Create: `apps/desktop/src/worker/protocol.ts`, `apps/desktop/src/worker/runtime.ts`
- Test: `apps/desktop/test/runtime.test.ts`

TDD。まず追従ループの判断（`planTicks`）のテストを書き、落ちることを見てから実装する。


- [ ] **Step 1: `apps/desktop/src/worker/protocol.ts` を書く**

```ts
import type { BoardSession, SocketId, SocketRole } from '@ojt/board-model';
import type { ChatterEvent, HazardEvent, LampLevel, LogEntry, Wire } from '@ojt/circuit-sim';
import type { AssembleProblem, JudgeAssembleResult } from '@ojt/content';

/**
 * renderer ⇄ Simulation Worker のプロトコル。設計仕様 §4.3。
 * 型はこのファイル1箇所で定義し、renderer 側（worker-bridge.ts）と worker 側（sim.worker.ts）が共有する。
 *
 * 役割分担（本アプリの決定）:
 * - `BoardSession` の**所有者は renderer**。board-model の `addWire()` 等が返す `Result` を
 *   その場でトースト表示する必要があり、往復させると1フレーム遅れるため。
 * - worker は**ネットリストと `Simulation` の所有者**。renderer が確定させた変更（電線オブジェクト、
 *   更新後のセッション）を受け取って適用するだけなので、二重バリデーションも ID のずれも起きない。
 * - 装着・取り外し・タイマ設定は `Simulation` の差分API（`mountPart` / `unmountPart` /
 *   `setTimerPreset`）で当てる。作り直すと `tMs`・信号ログ・イベントが切れてしまうため。
 */

/** スナップショットの送出間隔[ms]（約30fpsに間引く）。§4.3 */
export const SNAPSHOT_INTERVAL_MS = 33;

/** 追従ループが1回で取り返す tick 数の上限（= 200ms 相当）。 */
export const MAX_CATCHUP_TICKS = 20;

/** renderer → worker のコマンド。 */
export type SimCommand =
  /** 課題を開く。ネットリストを作り直し、電源OFF・t=0 から回し始める。 */
  | { type: 'load'; problemId: string; session: BoardSession }
  /** 電線を1本張る（`Simulation` に差分適用するのでリレー／タイマの状態は保たれる）。 */
  | { type: 'addWire'; wire: Wire }
  /** 電線を1本外す。 */
  | { type: 'removeWire'; wireId: string }
  /** 部品を装着した（`Simulation.mountPart()` で差分適用する）。 */
  | { type: 'plug'; socketId: SocketId; session: BoardSession }
  /** 部品を外した（`Simulation.unmountPart()` で差分適用する）。`partId` は役割ID（`CR1` 等）。 */
  | { type: 'unplug'; partId: string; session: BoardSession }
  /** タイマの設定時間を変えた（`Simulation.setTimerPreset()` で差分適用する）。 */
  | { type: 'setPreset'; role: SocketRole; presetMs: number; session: BoardSession }
  /** 時刻・ログ・イベント・保護状態を初期化する（課題のやり直し）。 */
  | { type: 'reset' }
  /** 押ボタンを押す。 */
  | { type: 'press'; pbId: string }
  /** 押ボタンを離す。 */
  | { type: 'release'; pbId: string }
  /** ブレーカを入切する。 */
  | { type: 'breaker'; on: boolean }
  /** 電源スイッチを入切する。 */
  | { type: 'switch'; on: boolean }
  /**
   * 過電流保護からの復帰手順を実行する（スイッチOFF → ブレーカOFF → ブレーカON → スイッチON）。
   * §5.1.1 の正規の復帰手順そのものを1ボタンで代行するだけで、手順を飛ばす近道ではない。
   */
  | { type: 'resetTrip' }
  /** 判定する。模範回路と訓練者回路を worker 内で並走させる。§8.3 */
  | { type: 'judge'; problem: AssembleProblem; session: BoardSession; elapsedMs: number };

/** ランプ1個の表示状態。 */
export interface LampSnapshot {
  level: LampLevel;
  volts: number;
}

/** リレー1個の表示状態。 */
export interface RelaySnapshot {
  coilOn: boolean;
  contactsOn: boolean;
  coilVolts: number;
}

/** タイマ1個の表示状態。 */
export interface TimerSnapshot {
  powered: boolean;
  elapsedMs: number;
  presetMs: number;
  timedOut: boolean;
}

/** 約30fpsで送る状態スナップショット。ログ・イベントは前回送出からの差分のみ。§4.3 */
export interface SimSnapshot {
  tMs: number;
  breakerOn: boolean;
  switchOn: boolean;
  powered: boolean;
  tripped: boolean;
  sourceAmps: number;
  buttons: Record<string, boolean>;
  lamps: Record<string, LampSnapshot>;
  relays: Record<string, RelaySnapshot>;
  timers: Record<string, TimerSnapshot>;
  /** 前回送出以降に増えたログ行。§5.7 */
  logDelta: LogEntry[];
  /** 前回送出以降に発行された危険操作。§5.6 */
  hazardDelta: HazardEvent[];
  /** 前回送出以降に検出したチャタリング。§5.3.2 */
  chatterDelta: ChatterEvent[];
  /** 追従上限を超えて捨てた tick 数の累計（ウィンドウ非表示時の詰まり）。 */
  droppedTicks: number;
}

/** worker → renderer のメッセージ。 */
export type SimMessage =
  | { type: 'snapshot'; snapshot: SimSnapshot }
  | { type: 'judgeResult'; result: JudgeAssembleResult }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: `apps/desktop/test/runtime.test.ts` を書く**

```ts
import { TICK_MS } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { formatElapsed, planTicks } from '../src/worker/runtime.js';
import { MAX_CATCHUP_TICKS } from '../src/worker/protocol.js';

describe('planTicks', () => {
  it('1tick未満の遅れでは進めない', () => {
    expect(planTicks(1005, 1000, TICK_MS)).toEqual({
      ticks: 0,
      nextBaselineMs: 1000,
      dropped: 0,
    });
  });

  it('遅れたぶんだけ進めて基準を進める', () => {
    expect(planTicks(1055, 1000, TICK_MS)).toEqual({
      ticks: 5,
      nextBaselineMs: 1050,
      dropped: 0,
    });
  });

  it('追従上限までは取り返す', () => {
    const plan = planTicks(1000 + MAX_CATCHUP_TICKS * TICK_MS, 1000, TICK_MS);
    expect(plan.ticks).toBe(MAX_CATCHUP_TICKS);
    expect(plan.dropped).toBe(0);
  });

  it('ウィンドウ非表示で詰まったぶんは捨てて基準を現在に引き直す', () => {
    const now = 1000 + 5000;
    const plan = planTicks(now, 1000, TICK_MS);
    expect(plan.ticks).toBe(MAX_CATCHUP_TICKS);
    expect(plan.dropped).toBe(500 - MAX_CATCHUP_TICKS);
    expect(plan.nextBaselineMs).toBe(now);
  });

  it('tickMs が0以下なら RangeError', () => {
    expect(() => planTicks(1000, 0, 0)).toThrow(RangeError);
  });
});

describe('formatElapsed', () => {
  it('分:秒.1桁 で整える', () => {
    expect(formatElapsed(0)).toBe('00:00.0');
    expect(formatElapsed(65_400)).toBe('01:05.4');
    expect(formatElapsed(3_723_000)).toBe('62:03.0');
  });

  it('負の値は0として扱う', () => {
    expect(formatElapsed(-5)).toBe('00:00.0');
  });
});
```

- [ ] **Step 3: テストが落ちることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop test -- runtime
```

期待出力:

```text
Error: Failed to resolve import "../src/worker/runtime.js"
```

- [ ] **Step 4: `apps/desktop/src/worker/runtime.ts` を書く**

```ts
import { MAX_CATCHUP_TICKS } from './protocol.js';

/**
 * `Simulation` を実時間に追従させるループの純粋部分。設計仕様 §4.3 / §5.2。
 *
 * `setInterval(fn, 10)` は Chromium のタイマ丸め（最小4ms／非表示時は1秒）で
 * 実時間から静かにずれていくため使わない。代わりに `performance.now()` を基準に
 * 「いま何 tick ぶん遅れているか」を毎回計算して、その数だけ進める追従方式にする。
 *
 * ウィンドウ非表示でタイマが詰まった場合は、`MAX_CATCHUP_TICKS`（200ms相当）より
 * 古い遅れは**捨てて基準時刻を現在に引き直す**。まとめて何千 tick も早送りすると、
 * 押しっぱなしのPBが一瞬で数十秒ぶん進むなど訓練者の体感と食い違うため（§8.2）。
 */

/** 追従ループの1周期ぶんの判断結果。 */
export interface TickPlan {
  /** 今回進める tick 数。 */
  ticks: number;
  /** 次回の基準にする「最後に進めた tick の名目時刻」。 */
  nextBaselineMs: number;
  /** 追従上限を超えて捨てた tick 数。 */
  dropped: number;
}

/**
 * いま進めるべき tick 数を決める。
 * @param nowMs `performance.now()` の値
 * @param baselineMs 前回の `nextBaselineMs`（ループ開始時は開始時刻）
 * @param tickMs 1tickの長さ[ms]
 * @param maxCatchUp 1周期で進める tick 数の上限
 */
export function planTicks(
  nowMs: number,
  baselineMs: number,
  tickMs: number,
  maxCatchUp: number = MAX_CATCHUP_TICKS,
): TickPlan {
  if (tickMs <= 0) throw new RangeError(`tickMs は正の数にします: ${tickMs}`);
  const behind = nowMs - baselineMs;
  if (behind < tickMs) return { ticks: 0, nextBaselineMs: baselineMs, dropped: 0 };
  const due = Math.floor(behind / tickMs);
  if (due <= maxCatchUp) {
    return { ticks: due, nextBaselineMs: baselineMs + due * tickMs, dropped: 0 };
  }
  // 詰まったぶんは捨てて基準を現在へ引き直す
  return { ticks: maxCatchUp, nextBaselineMs: nowMs, dropped: due - maxCatchUp };
}

/** 経過[ms]を `12:34.5` の形に整える（経過時間表示）。§8.1 */
export function formatElapsed(ms: number): string {
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60_000);
  const seconds = (clamped % 60_000) / 1000;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}
```

- [ ] **Step 5: テストが通ることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop test -- runtime
```

期待出力:

```text
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

- [ ] **Step 6: コミットする**

追加・変更したファイル: `apps/desktop/src/worker` `apps/desktop/test/runtime.test.ts`

```powershell
git add apps/desktop/src/worker apps/desktop/test/runtime.test.ts
git commit -m @'
feat(desktop): define simulation worker protocol and catch-up loop

setInterval ではなく performance.now() 基準の追従ループにし、
ウィンドウ非表示で詰まった tick は 200ms ぶんを上限に捨てる。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 4: Simulation Worker 本体

**Files:**
- Create: `apps/desktop/src/worker/sim.worker.ts`

Worker は `@ojt/board-model` の `toNetlist()` と `@ojt/circuit-sim` の `Simulation` を持ち、renderer が確定させた変更だけを適用する。判定（`judgeAssemble`）もここで走らせる（renderer のフレームを止めないため。§15）。


- [ ] **Step 1: `apps/desktop/src/worker/sim.worker.ts` を書く**

```ts
import {
  JIPM_BOARD,
  socketPartId,
  toNetlist,
  type BoardSession,
  type SocketId,
} from '@ojt/board-model';
import {
  createRelay4c,
  createTimer4c,
  Simulation,
  TICK_MS,
  type ChatterEvent,
  type HazardEvent,
  type LogEntry,
  type Part,
} from '@ojt/circuit-sim';
import { judgeAssemble } from '@ojt/content';
import { planTicks } from './runtime.js';
import {
  SNAPSHOT_INTERVAL_MS,
  type LampSnapshot,
  type RelaySnapshot,
  type SimCommand,
  type SimMessage,
  type SimSnapshot,
  type TimerSnapshot,
} from './protocol.js';

/**
 * Simulation Worker。設計仕様 §4.3 / §5.2。
 * `circuit-sim` の `Simulation` を 10ms tick で回し、約30fpsでスナップショットを返す。
 * renderer のフレーム処理をブロックしない（§15 並行性）。
 *
 * 装着・取り外し・タイマ設定は `Simulation` の差分API（`mountPart` / `unmountPart` /
 * `setTimerPreset`）で当てる。`new Simulation()` で作り直すと `tMs`・信号ログ・イベントが
 * 消えてしまい、ライブのタイムチャートと危険操作の記録が途切れるため（§5.7 / §8.3）。
 */

let simulation: Simulation | undefined;
let session: BoardSession | undefined;
let baselineMs = 0;
let lastSnapshotMs = 0;
let logCursor = 0;
let hazardCursor = 0;
let chatterCursor = 0;
let droppedTicks = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function post(message: SimMessage): void {
  self.postMessage(message);
}

/** 課題を開く。ネットリストを作り直し、電源OFF・t=0 から回し始める。 */
function load(next: BoardSession): void {
  session = next;
  simulation = new Simulation(toNetlist(next, JIPM_BOARD), { tickMs: TICK_MS });
  logCursor = 0;
  hazardCursor = 0;
  chatterCursor = 0;
}

/** 装着した部品を circuit-sim の部品インスタンスにする。§6.6 */
function partFor(next: BoardSession, socketId: SocketId): Part | undefined {
  const mounted = next.mounted[socketId];
  if (mounted === undefined) return undefined;
  const id = socketPartId(next.socketRoles, socketId);
  return mounted.kind === 'relay-my4n'
    ? createRelay4c(id)
    : createTimer4c(id, mounted.presetMs, mounted.rangeMaxMs);
}

function lampsOf(sim: Simulation): Record<string, LampSnapshot> {
  const out: Record<string, LampSnapshot> = {};
  for (const [id, runtime] of Object.entries(sim.state().lamps)) {
    out[id] = { level: runtime.level, volts: runtime.volts };
  }
  return out;
}

function relaysOf(sim: Simulation): Record<string, RelaySnapshot> {
  const out: Record<string, RelaySnapshot> = {};
  for (const [id, runtime] of Object.entries(sim.state().relays)) {
    out[id] = {
      coilOn: runtime.coilOn,
      contactsOn: runtime.contactsOn,
      coilVolts: runtime.coilVolts,
    };
  }
  return out;
}

function timersOf(sim: Simulation): Record<string, TimerSnapshot> {
  const out: Record<string, TimerSnapshot> = {};
  for (const [id, runtime] of Object.entries(sim.state().timers)) {
    out[id] = {
      powered: runtime.powered,
      elapsedMs: runtime.elapsedMs,
      presetMs: runtime.presetMs,
      timedOut: runtime.timedOut,
    };
  }
  return out;
}

function buildSnapshot(sim: Simulation): SimSnapshot {
  const state = sim.state();
  const entries = sim.log.entries();
  const logDelta: LogEntry[] = entries.slice(logCursor).map((e) => ({ ...e }));
  logCursor = entries.length;
  const hazards = sim.events.hazards();
  const hazardDelta: HazardEvent[] = hazards.slice(hazardCursor).map((e) => ({ ...e }));
  hazardCursor = hazards.length;
  const chatters = sim.events.chatters();
  const chatterDelta: ChatterEvent[] = chatters.slice(chatterCursor).map((e) => ({ ...e }));
  chatterCursor = chatters.length;
  return {
    tMs: state.tMs,
    breakerOn: state.breakerOn,
    switchOn: state.switchOn,
    powered: state.powered,
    tripped: state.tripped,
    sourceAmps: state.sourceAmps,
    buttons: { ...state.buttons },
    lamps: lampsOf(sim),
    relays: relaysOf(sim),
    timers: timersOf(sim),
    logDelta,
    hazardDelta,
    chatterDelta,
    droppedTicks,
  };
}

/** 追従ループの1周期。`performance.now()` 基準で遅れぶんだけ進める（§5.2）。 */
function loop(): void {
  timer = undefined;
  const sim = simulation;
  if (sim === undefined) return;
  const now = performance.now();
  const plan = planTicks(now, baselineMs, TICK_MS);
  baselineMs = plan.nextBaselineMs;
  droppedTicks += plan.dropped;
  for (let i = 0; i < plan.ticks; i += 1) sim.step(TICK_MS);
  if (now - lastSnapshotMs >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotMs = now;
    post({ type: 'snapshot', snapshot: buildSnapshot(sim) });
  }
  timer = setTimeout(loop, 4);
}

function start(): void {
  baselineMs = performance.now();
  lastSnapshotMs = 0;
  droppedTicks = 0;
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(loop, 4);
}

function handle(command: SimCommand): void {
  if (command.type === 'load') {
    load(command.session);
    start();
    return;
  }
  const sim = simulation;
  if (sim === undefined) throw new Error('課題が読み込まれていません');
  switch (command.type) {
    case 'addWire':
      sim.addWire(command.wire);
      if (session !== undefined) session.wires.push(command.wire);
      break;
    case 'removeWire':
      sim.removeWire(command.wireId);
      if (session !== undefined) {
        session.wires = session.wires.filter((w) => w.id !== command.wireId);
      }
      break;
    case 'plug': {
      // 差分で当てるので tMs・ログ・イベントは切れない
      const part = partFor(command.session, command.socketId);
      if (part !== undefined) sim.mountPart(part);
      session = command.session;
      break;
    }
    case 'unplug':
      sim.unmountPart(command.partId);
      session = command.session;
      break;
    case 'setPreset':
      sim.setTimerPreset(command.role, command.presetMs);
      session = command.session;
      break;
    case 'press':
      sim.press(command.pbId);
      break;
    case 'release':
      sim.release(command.pbId);
      break;
    case 'breaker':
      sim.setBreaker(command.on);
      break;
    case 'switch':
      sim.setSwitch(command.on);
      break;
    case 'reset':
      // 時刻・ログ・イベント・保護状態を初期化する（課題のやり直し）
      sim.reset();
      logCursor = 0;
      hazardCursor = 0;
      chatterCursor = 0;
      start();
      break;
    case 'resetTrip':
      // §5.1.1 の復帰手順そのもの: スイッチOFF → ブレーカOFF → ブレーカON → スイッチON
      sim.setSwitch(false);
      sim.setBreaker(false);
      sim.setBreaker(true);
      sim.setSwitch(true);
      break;
    case 'judge': {
      const result = judgeAssemble(command.problem, JIPM_BOARD, command.session, {
        elapsedMs: command.elapsedMs,
        sessionHazards: sim.events.hazards(),
      });
      post({ type: 'judgeResult', result });
      break;
    }
  }
}

self.onmessage = (event: MessageEvent<SimCommand>): void => {
  try {
    handle(event.data);
  } catch (cause) {
    post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) });
  }
};
```

- [ ] **Step 2: 型チェックが通ることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop typecheck
```

期待出力:

```text
（何も出力されない＝成功）
```

- [ ] **Step 3: コミットする**

追加・変更したファイル: `apps/desktop/src/worker/sim.worker.ts`

```powershell
git add apps/desktop/src/worker/sim.worker.ts
git commit -m @'
feat(desktop): run circuit simulation in a web worker

10ms tick で Simulation を回し、約30fpsでスナップショットを送る。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 5: ストアと Worker ブリッジ

**Files:**
- Create: `apps/desktop/src/renderer/app/store-types.ts`, `apps/desktop/src/renderer/app/store.ts`, `apps/desktop/src/renderer/session/worker-bridge.ts`
- Test: `apps/desktop/test/store.test.ts`

**状態管理に zustand を選ぶ理由**: Worker のスナップショットは約30fpsで届き、3Dシーン・タイムチャート・操作ログの3箇所が別々の一部分だけを見る。`useReducer` ＋ Context だと1スナップショットごとに配下が丸ごと再描画されるが、zustand はセレクタ単位で購読でき「ランプの色だけ」を見ている3Dシーンが操作ログの増加で再描画されない。さらに Worker ブリッジは React の外にいるため、Provider を介さず `useStore.getState()` で読み書きできる点も噛み合う。依存は 3KB 程度で §15 の性能目標に対する影響が小さい。


- [ ] **Step 1: `apps/desktop/src/renderer/app/store-types.ts` を書く**

```ts
/**
 * ストアの値型のうち、React にも three にも依存しないもの。設計仕様 §12.1 / §12.2。
 * `store.ts`（zustand）と、three を読み込めない場所（E2E の射影計算など）で共有する。
 */

/** 画面。§12.1 */
export type Route = 'home' | 'list' | 'session' | 'result' | 'settings';

/** 視点プリセット。§12.2 */
export type CameraPreset = 'front' | 'top' | 'socket';

/** 画面に出す短いお知らせ（配線失敗の理由など）。§8.2 */
export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

/** 操作ログの1行。§8.1 */
export interface LogLine {
  id: number;
  text: string;
}
```

- [ ] **Step 2: `apps/desktop/src/renderer/app/store.ts` を書く**

```ts
import { createSession, JIPM_BOARD, type BoardSession, type SocketId } from '@ojt/board-model';
import {
  partId,
  type ChatterEvent,
  type HazardEvent,
  type TerminalId,
  type WireColor,
} from '@ojt/circuit-sim';
import {
  defaultChartSignals,
  resolveCompareSignals,
  type AssembleProblem,
  type JudgeResult,
  type TimeChartSignalSpec,
} from '@ojt/content';
import { create } from 'zustand';
import type { ProblemListPayload } from '../../shared/ipc.js';
import type { SimSnapshot } from '../../worker/protocol.js';
import {
  emptyHistory,
  type CommandHistory,
  type SessionCommand,
} from '../session/commands.js';
import type { ToolMode } from '../session/interaction.js';
import type { CameraPreset, LogLine, Route, Toast } from './store-types.js';

/**
 * 画面状態。設計仕様 §12.1。
 *
 * 状態管理に **zustand** を選ぶ理由:
 * worker のスナップショットは約30fpsで届き、3Dシーン・タイムチャート・ログの
 * 3箇所が別々の一部分だけを見る。`useReducer` ＋ Context だと1スナップショットごとに
 * 配下が丸ごと再描画されるが、zustand はセレクタ単位で購読でき「ランプの色だけ」を
 * 見ている 3Dシーンがログの増加で再描画されない。さらに worker ブリッジは React の外に
 * いるため、Provider を介さず `useStore.getState()` で読み書きできる点も噛み合う。
 * 依存は 3KB 程度で、§15 の性能目標（内蔵GPUで60fps）に対する影響が小さい。
 */

export type { CameraPreset, LogLine, Route, Toast } from './store-types.js';

/** 空のスナップショット（課題を開く前の表示用）。 */
export const EMPTY_SNAPSHOT: SimSnapshot = {
  tMs: 0,
  breakerOn: false,
  switchOn: false,
  powered: false,
  tripped: false,
  sourceAmps: 0,
  buttons: {},
  lamps: {},
  relays: {},
  timers: {},
  logDelta: [],
  hazardDelta: [],
  chatterDelta: [],
  droppedTicks: 0,
};

/** ストアの形。 */
export interface AppState {
  route: Route;
  problems: ProblemListPayload | undefined;
  problem: AssembleProblem | undefined;
  session: BoardSession | undefined;
  history: CommandHistory;

  mode: ToolMode;
  wireColor: WireColor;
  pendingTerminal: TerminalId | undefined;
  hoveredTerminal: TerminalId | undefined;
  selectedWire: string | undefined;
  selectedSocket: SocketId | undefined;
  camera: CameraPreset;
  schematicVisible: boolean;

  snapshot: SimSnapshot;
  hazards: HazardEvent[];
  chatters: ChatterEvent[];
  /** ライブのタイムチャートに並べる信号。§7.7 */
  chartSpecs: TimeChartSignalSpec[];
  /** ライブのタイムチャート用の遷移点（信号名 → 変化点の列）。§8.2 */
  liveTransitions: Record<string, Array<{ tMs: number; value: boolean }>>;
  logLines: LogLine[];
  toasts: Toast[];
  startedAtMs: number;
  elapsedMs: number;
  judge: JudgeResult | undefined;
  fatalError: string | undefined;
  /** WebGL コンテキストが失われ再初期化中か。§13 #4 */
  webglLost: boolean;

  setRoute: (route: Route) => void;
  setProblems: (payload: ProblemListPayload) => void;
  openProblem: (problem: AssembleProblem) => void;
  setSession: (session: BoardSession) => void;
  pushHistory: (command: SessionCommand) => void;
  setHistory: (history: CommandHistory) => void;
  setMode: (mode: ToolMode) => void;
  setWireColor: (color: WireColor) => void;
  setPending: (terminal: TerminalId | undefined) => void;
  setHovered: (terminal: TerminalId | undefined) => void;
  setSelectedWire: (wireId: string | undefined) => void;
  setSelectedSocket: (socketId: SocketId | undefined) => void;
  setCamera: (preset: CameraPreset) => void;
  toggleSchematic: () => void;
  applySnapshot: (snapshot: SimSnapshot) => void;
  clearLive: () => void;
  addLog: (text: string) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  setJudge: (result: JudgeResult | undefined) => void;
  setFatalError: (message: string | undefined) => void;
  setWebglLost: (lost: boolean) => void;
  tickElapsed: () => void;
  resetSession: () => void;
}

let sequence = 0;
function nextId(): number {
  sequence += 1;
  return sequence;
}

/** 課題から盤セッションを作る。§7.1 / §8.1（モードBの新規配線は青のみ） */
export function sessionForProblem(problem: AssembleProblem): BoardSession {
  return createSession(JIPM_BOARD, {
    roles: problem.board.socketRoles,
    allowedColors: ['青'],
    extraParts: (problem.board.extraParts ?? []).map((name) => partId(name)),
    inventory: problem.inventory,
  });
}

/** アプリ全体のストア。 */
export const useStore = create<AppState>((set, get) => ({
  route: 'home',
  problems: undefined,
  problem: undefined,
  session: undefined,
  history: emptyHistory(),

  mode: 'wire',
  wireColor: '青',
  pendingTerminal: undefined,
  hoveredTerminal: undefined,
  selectedWire: undefined,
  selectedSocket: undefined,
  camera: 'front',
  schematicVisible: false,

  snapshot: EMPTY_SNAPSHOT,
  hazards: [],
  chatters: [],
  chartSpecs: [],
  liveTransitions: {},
  logLines: [],
  toasts: [],
  startedAtMs: 0,
  elapsedMs: 0,
  judge: undefined,
  fatalError: undefined,
  webglLost: false,

  setRoute: (route) => {
    set({ route });
  },
  setProblems: (problems) => {
    set({ problems });
  },
  openProblem: (problem) => {
    set({
      problem,
      session: sessionForProblem(problem),
      history: emptyHistory(),
      route: 'session',
      mode: 'wire',
      wireColor: '青',
      pendingTerminal: undefined,
      hoveredTerminal: undefined,
      selectedWire: undefined,
      selectedSocket: undefined,
      snapshot: EMPTY_SNAPSHOT,
      hazards: [],
      chatters: [],
      chartSpecs: defaultChartSignals(
        resolveCompareSignals(problem.judge, problem.board.extraParts ?? []),
      ),
      liveTransitions: {},
      logLines: [],
      judge: undefined,
      fatalError: undefined,
      schematicVisible: problem.hints.schematicVisible,
      startedAtMs: Date.now(),
      elapsedMs: 0,
    });
  },
  setSession: (session) => {
    set({ session });
  },
  pushHistory: (command) => {
    const history = get().history;
    const done = [...history.done, command];
    set({ history: { done: done.slice(Math.max(0, done.length - 50)), undone: [] } });
  },
  setHistory: (history) => {
    set({ history });
  },
  setMode: (mode) => {
    set({ mode, pendingTerminal: undefined });
  },
  setWireColor: (wireColor) => {
    set({ wireColor });
  },
  setPending: (pendingTerminal) => {
    set({ pendingTerminal });
  },
  setHovered: (hoveredTerminal) => {
    set({ hoveredTerminal });
  },
  setSelectedWire: (selectedWire) => {
    set({ selectedWire: selectedWire === undefined || selectedWire.length === 0 ? undefined : selectedWire });
  },
  setSelectedSocket: (selectedSocket) => {
    set({ selectedSocket });
  },
  setCamera: (camera) => {
    set({ camera });
  },
  toggleSchematic: () => {
    set({ schematicVisible: !get().schematicVisible });
  },
  applySnapshot: (snapshot) => {
    const state = get();
    const names = new Set(state.chartSpecs.map((spec) => spec.name));
    let liveTransitions = state.liveTransitions;
    for (const entry of snapshot.logDelta) {
      if (!names.has(entry.signal) || typeof entry.value !== 'boolean') continue;
      if (liveTransitions === state.liveTransitions) liveTransitions = { ...liveTransitions };
      const points = liveTransitions[entry.signal] ?? [];
      liveTransitions[entry.signal] = [...points, { tMs: entry.tMs, value: entry.value }];
    }
    set({
      snapshot,
      liveTransitions,
      hazards:
        snapshot.hazardDelta.length === 0 ? state.hazards : [...state.hazards, ...snapshot.hazardDelta],
      chatters:
        snapshot.chatterDelta.length === 0 ? state.chatters : [...state.chatters, ...snapshot.chatterDelta],
    });
  },
  clearLive: () => {
    set({ snapshot: EMPTY_SNAPSHOT, liveTransitions: {}, hazards: [], chatters: [] });
  },
  addLog: (text) => {
    const lines = [...get().logLines, { id: nextId(), text }];
    set({ logLines: lines.slice(Math.max(0, lines.length - 200)) });
  },
  toast: (text, tone = 'info') => {
    set({ toasts: [...get().toasts, { id: nextId(), text, tone }] });
  },
  dismissToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  setJudge: (judge) => {
    set({ judge });
  },
  setFatalError: (fatalError) => {
    set({ fatalError });
  },
  setWebglLost: (webglLost) => {
    set({ webglLost });
  },
  tickElapsed: () => {
    const { startedAtMs } = get();
    if (startedAtMs === 0) return;
    set({ elapsedMs: Date.now() - startedAtMs });
  },
  resetSession: () => {
    const problem = get().problem;
    if (problem === undefined) return;
    get().openProblem(problem);
  },
}));
```

- [ ] **Step 3: `apps/desktop/src/renderer/session/worker-bridge.ts` を書く**

```ts
import type { SimCommand, SimMessage, SimSnapshot } from '../../worker/protocol.js';

/**
 * Simulation Worker との橋渡し。設計仕様 §4.3。
 * React の外に置き、スナップショットをストアへ流し込む。3Dの再描画は
 * `invalidate()` を呼ぶ購読者（BoardScene）が担う（§12.2 の性能方針）。
 */

/** ブリッジの購読先。 */
export interface BridgeHandlers {
  onSnapshot: (snapshot: SimSnapshot) => void;
  onJudge: (message: Extract<SimMessage, { type: 'judgeResult' }>) => void;
  onError: (message: string) => void;
}

/** Worker を1本持ち、コマンド送信とメッセージ配送を行う。 */
export class WorkerBridge {
  private worker: Worker | undefined;
  private handlers: BridgeHandlers | undefined;

  /** Worker を起動して購読を始める。既に動いていれば作り直す（§13 #6 の復帰にも使う）。 */
  start(handlers: BridgeHandlers): void {
    this.stop();
    this.handlers = handlers;
    const worker = new Worker(new URL('../../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
      name: 'ojt-simulation',
    });
    worker.onmessage = (event: MessageEvent<SimMessage>) => {
      const message = event.data;
      if (message.type === 'snapshot') handlers.onSnapshot(message.snapshot);
      else if (message.type === 'judgeResult') handlers.onJudge(message);
      else handlers.onError(message.message);
    };
    worker.onerror = (event: ErrorEvent) => {
      handlers.onError(event.message);
    };
    this.worker = worker;
  }

  /** コマンドを送る。Worker が無ければ何もしない。 */
  send(command: SimCommand): void {
    this.worker?.postMessage(command);
  }

  /** 動いているか。 */
  get running(): boolean {
    return this.worker !== undefined;
  }

  /** Worker を止める。 */
  stop(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.handlers = undefined;
  }
}

/** アプリで1本だけ使うブリッジ。 */
export const bridge = new WorkerBridge();
```

- [ ] **Step 4: `apps/desktop/test/store.test.ts` を書く**

```ts
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT, sessionForProblem, useStore } from '../src/renderer/app/store.js';

const PROBLEM = BUILTIN_PROBLEMS.find((p) => p.id === 'b-003');

beforeEach(() => {
  useStore.setState({
    route: 'home',
    problem: undefined,
    session: undefined,
    chartSpecs: [],
    liveTransitions: {},
    hazards: [],
    chatters: [],
    logLines: [],
    toasts: [],
    snapshot: EMPTY_SNAPSHOT,
  });
});

describe('sessionForProblem', () => {
  it('課題のソケット役割と在庫でセッションを作り、線色は青だけになる（§8.1）', () => {
    expect(PROBLEM).toBeDefined();
    if (PROBLEM === undefined) return;
    const session = sessionForProblem(PROBLEM);
    expect(session.allowedColors).toEqual(['青']);
    expect(session.socketRoles).toEqual(PROBLEM.board.socketRoles);
    expect(session.wires.every((w) => w.locked)).toBe(true);
  });
});

describe('openProblem', () => {
  it('セッション画面に移り、チャート信号を課題から決める（§7.7）', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.chartSpecs.map((s) => s.name)).toEqual([
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
      'PL2',
      'PL3',
      'PL4',
    ]);
    expect(state.elapsedMs).toBe(0);
  });
});

describe('applySnapshot', () => {
  it('ログ差分からライブチャートの遷移点を積む（§8.2）', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    useStore.getState().applySnapshot({
      ...EMPTY_SNAPSHOT,
      tMs: 100,
      logDelta: [
        { tMs: 100, signal: 'PL1', value: true },
        { tMs: 100, signal: 'CR1.coilV', value: 24 },
        { tMs: 100, signal: 'NOT_IN_CHART', value: true },
      ],
    });
    const live = useStore.getState().liveTransitions;
    expect(live['PL1']).toEqual([{ tMs: 100, value: true }]);
    expect(live['CR1.coilV']).toBeUndefined();
    expect(live['NOT_IN_CHART']).toBeUndefined();
  });

  it('危険操作の差分を積み上げる（§5.6）', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    useStore.getState().applySnapshot({
      ...EMPTY_SNAPSHOT,
      hazardDelta: [
        { type: 'hazard', kind: 'power-sequence-violation', tMs: 0, detail: 'switch:on' },
      ],
    });
    expect(useStore.getState().hazards).toHaveLength(1);
  });
});

describe('clearLive', () => {
  it('元に戻す／やり直しでライブ記録を捨てる', () => {
    if (PROBLEM === undefined) return;
    useStore.getState().openProblem(PROBLEM);
    useStore.getState().applySnapshot({
      ...EMPTY_SNAPSHOT,
      logDelta: [{ tMs: 10, signal: 'PL1', value: true }],
    });
    useStore.getState().clearLive();
    expect(useStore.getState().liveTransitions).toEqual({});
    expect(useStore.getState().snapshot.tMs).toBe(0);
  });
});

describe('toast / log', () => {
  it('トーストを積んで消せる', () => {
    useStore.getState().toast('1端子に接続できるのは2本までです', 'error');
    const toast = useStore.getState().toasts[0];
    expect(toast?.tone).toBe('error');
    useStore.getState().dismissToast(toast?.id ?? 0);
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('操作ログは200行で頭を捨てる', () => {
    for (let i = 0; i < 210; i += 1) useStore.getState().addLog(`行 ${i}`);
    const lines = useStore.getState().logLines;
    expect(lines).toHaveLength(200);
    expect(lines[0]?.text).toBe('行 10');
  });
});
```

- [ ] **Step 5: テストを実行する**

実行:

```powershell
pnpm --filter @ojt/desktop test -- store
```

期待出力:

```text
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

- [ ] **Step 6: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/app` `apps/desktop/src/renderer/session/worker-bridge.ts` `apps/desktop/test/store.test.ts`

```powershell
git add apps/desktop/src/renderer/app apps/desktop/src/renderer/session/worker-bridge.ts apps/desktop/test/store.test.ts
git commit -m @'
feat(desktop): add zustand store and worker bridge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 6: 文言・色・外枠と画面遷移

**Files:**
- Create: `apps/desktop/src/renderer/i18n/ja.ts`, `apps/desktop/src/renderer/session/colors.ts`, `apps/desktop/src/renderer/app/global.css`, `apps/desktop/src/renderer/app/app.module.css`, `apps/desktop/src/renderer/app/routes.tsx`, `apps/desktop/src/renderer/app/App.tsx`, `apps/desktop/src/renderer/main.tsx`, `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/screens/screens.module.css`, `apps/desktop/src/renderer/screens/Home.tsx`, `apps/desktop/src/renderer/screens/ProblemList.tsx`


- [ ] **Step 1: `apps/desktop/src/renderer/i18n/ja.ts` を書く**

仕様 §15「全文言を1箇所に集約しハードコードしない」。Plan 1D2 で足す文言もここに並べておく。

```ts
import type { RoutingErrorReason } from '@ojt/board-model';
import type { HazardKind, MismatchReason } from '@ojt/circuit-sim';

/**
 * 日本語文言。設計仕様 §15「全文言を1箇所に集約しハードコードしない」。
 * 画面側は必ずこのモジュール経由で文字列を取る。文言の変更はこのファイルだけで完結する。
 *
 * エンジンの種別（`HazardKind` / `MismatchReason` / `RoutingErrorReason`）で索引する表は
 * `satisfies` で網羅を検査する。
 * エンジンに種別が増えたときに、画面で `undefined` が出るのではなく `tsc` が落ちる。
 */

/** アプリ名称（仮称。§17.2 #18）。 */
export const APP_NAME = 'OJT電気保全トレーナー';

/** 画面文言。 */
export const JA = {
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
    plc: 'PLC',
    comingSoon: '準備中',
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
  },
  session: {
    back: '課題一覧へ戻る',
    judge: '判定',
    undo: '元に戻す',
    redo: 'やり直し',
    deleteMode: '削除モード',
    wireColor: '線色',
    viewFront: '正面',
    viewTop: '俯瞰',
    viewSocket: 'ソケット拡大',
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
    problem: '課題',
    chart: 'タイムチャート（仕様）',
    pickSocket: 'ソケットを選んでください',
    cancelWire: '配線を取り消しました',
    /** 経路器が経路を作れなかった（`RoutingError`）。盤とセッションはそのまま保つ。§6.6 */
    routeFailed: '配線の経路を作れませんでした',
    /** 同じ帯の同じスロットに載せざるを得なかった電線がある（`laneOverflow`）。§6.6 */
    laneOverflow: '他の電線と同じ配線位置に重なっています（見た目だけの重なりで、回路は正しく組めています）',
    schematicHint: '回路図ヒント',
    save: '作業を保存',
    load: '作業を読込',
    restoreTitle: '前回の作業を復元しますか？',
    restoreYes: '復元する',
    restoreNo: '復元しない',
    showSchematic: '回路図を表示',
    hideSchematic: '回路図を隠す',
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
    hazardNone: '危険操作はありませんでした。',
    elapsed: '所要時間',
    standardMark: '標準時間',
    cutoffMark: '打切り時間',
    chartOverlay: 'チャート重ね表示（薄色＝模範／濃色＝訓練者）',
    retry: 'もう一度',
    toList: '課題一覧へ',
    forbidden:
      'タイマの接点で自分のコイルを切る回路は実機では動作が不安定になります（リレーを介してください）。',
  },
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
  },
  mismatchReason: {
    timing: '時刻ずれ',
    value: '値違い',
    missing: '遷移が無い',
    extra: '余分な遷移',
    'unknown-signal': '比較対象の信号が模範回路に無い',
  } satisfies Record<MismatchReason, string>,
  /** 経路器の失敗理由（`RoutingError.reason`）。§6.6 */
  routeReason: {
    'invalid-terminal': '盤に無い端子です',
    unreachable: '配線帯までたどり着けません',
    'footprint-crossing': '部品の上を避けて通せません',
  } satisfies Record<RoutingErrorReason, string>,
  error: {
    banner: '予期しないエラーが発生しました',
    reset: 'セッションをリセット',
    webglLost: '描画を復旧しています…',
    workerError: 'シミュレーションでエラーが発生しました',
  },
} as const;

/** 級の表示（`3級` など）。 */
export function gradeLabel(grade: number): string {
  return `${grade}${JA.problemList.grade}`;
}

/** 真偽値の信号表示（`ON` / `OFF`）。 */
export function signalLabel(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  if (typeof value === 'number') return value.toFixed(2);
  return '—';
}
```

- [ ] **Step 2: `apps/desktop/src/renderer/session/colors.ts` を書く**

```ts
import type { WireColor } from '@ojt/circuit-sim';

/**
 * 3D表示の色。設計仕様 §6.6（電線の物理色）／§5.3.3・§5.3.4（PB・PLの色）。
 * 回路図（`@ojt/schematic-core` の `LAMP_FILL`）と同じ値を使い、2Dと3Dで色がずれないようにする。
 */

/** 電線の物理色（青／白／黄）。§6.6 */
export const WIRE_COLORS: Readonly<Record<WireColor, string>> = {
  青: '#1F4FD8',
  白: '#F2F2F0',
  黄: '#E8C22A',
};

/** Y型圧着端子の金属色。§6.6 */
export const LUG_COLOR = '#B9A46A';

/** 表示灯の色（`schematic-core` の `LAMP_FILL` と同値）。§5.3.4 */
export const LAMP_COLORS: Readonly<Record<string, string>> = {
  PL1: '#FFFFFF',
  PL2: '#F2C230',
  PL3: '#3FA34D',
  PL4: '#D64545',
};

/** 押ボタンの色。§5.3.3 */
export const PUSH_BUTTON_COLORS: Readonly<Record<string, string>> = {
  PB1: '#1A1A1A',
  PB2: '#F2C230',
  PB3: '#3FA34D',
  PB4: '#D64545',
};

/**
 * 盤・部品の基本色（実物写真に合わせる）。
 * 筐体は白〜ベージュ、ソケットは黒本体＋黄色レバー、端子台は白、DINレールは銀。
 */
export const BOARD_PLATE_COLOR = '#E6E4DE';
export const CONSOLE_SIDE_COLOR = '#D6D3CB';
export const DIN_RAIL_COLOR = '#B8BCC2';
export const SOCKET_BODY_COLOR = '#23262B';
export const SOCKET_LEVER_COLOR = '#E8B21E';
export const TERMINAL_SCREW_COLOR = '#9AA0A6';
export const TERMINAL_BLOCK_COLOR = '#F1EFE9';
export const TERMINAL_BLOCK_CAP_COLOR = '#2B2E33';
export const RELAY_BODY_COLOR = '#3A3F45';
export const TIMER_BODY_COLOR = '#4A4038';
/** 上部左のDC24V端子台と、上部右のブレーカの色。 */
export const SUPPLY_BLOCK_COLOR = '#2B2E33';
export const BREAKER_COLOR = '#DCDCD6';

/** 端子のハイライト色（ホバー／配線1本目の選択中）。§8.2 */
export const TERMINAL_HOVER_COLOR = '#39D0FF';
export const TERMINAL_PENDING_COLOR = '#FF9F1C';
/** 選択中の電線の色。§8.2 */
export const WIRE_SELECTED_COLOR = '#FF4D6D';
/**
 * 配線帯のスロットが埋まり、他の電線と同じ位置に載った電線の色（琥珀）。§6.6
 * `WireRoute.laneOverflow` は「見た目が重なっている」ことの**唯一の手がかり**なので、
 * 3Dで色を変えて知らせる（電気的には正しく配線できているので、失敗としては扱わない）。
 */
export const WIRE_LANE_OVERFLOW_COLOR = '#E8A33D';
/** 既設配線（`locked`）の端に付ける固定リングの色。訓練者が触れない配線の目印。§6.3 */
export const LOCKED_RING_COLOR = '#8A9099';
/** 盤面の穴（既設配線が裏へ潜る所）の色。§6.5 */
export const PANEL_HOLE_COLOR = '#14171B';

/** ランプの発光強度（点灯／暗点灯／消灯）。§5.3.4 */
export const LAMP_EMISSIVE: Readonly<Record<string, number>> = {
  lit: 1.6,
  dim: 0.35,
  off: 0,
};
```

- [ ] **Step 3: `apps/desktop/src/renderer/app/global.css` を書く**

```css
/* アプリ全体の素のCSS。設計仕様 §12。CSSフレームワークは使わない。 */

:root {
  --bg: #141820;
  --panel: #1e232d;
  --panel-2: #262c38;
  --line: #39404e;
  --text: #e7ebf2;
  --muted: #9aa4b5;
  --accent: #39d0ff;
  --ok: #3fa34d;
  --ng: #d64545;
  --warn: #e8c22a;
  font-family: 'Yu Gothic UI', 'Meiryo', system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  overflow: hidden;
  user-select: none;
}

button {
  font: inherit;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 5px 10px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: var(--accent);
}

button:disabled {
  opacity: 0.45;
  cursor: default;
}

button[aria-pressed='true'] {
  background: var(--accent);
  color: #10151c;
  border-color: var(--accent);
}

/* drei の <Html> が描くラベル（CSS Modules の外なのでグローバルに置く） */
.terminal-tooltip {
  background: rgba(16, 21, 28, 0.92);
  border: 1px solid var(--accent);
  border-radius: 3px;
  color: var(--text);
  font-size: 11px;
  padding: 2px 6px;
  white-space: nowrap;
  pointer-events: none;
}

.socket-label small {
  font-weight: 400;
  margin-left: 3px;
  opacity: 0.75;
}

.socket-label,
.block-label,
.part-label {
  color: #10151c;
  background: rgba(231, 235, 242, 0.85);
  border-radius: 2px;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  white-space: nowrap;
  pointer-events: none;
}

.block-label {
  background: rgba(231, 235, 242, 0.6);
  font-weight: 400;
}

.part-label {
  background: rgba(231, 235, 242, 0.92);
}

.part-label.timer {
  background: rgba(232, 194, 42, 0.95);
}
```

- [ ] **Step 4: `apps/desktop/src/renderer/app/app.module.css` を書く**

```css
/* アプリの外枠。設計仕様 §8.1 の画面構成（中央3D／右パネル／下部／上部ツールバー）。 */

.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.banner {
  background: var(--ng);
  color: #fff;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
}

.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 50;
}

.toast {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-left: 4px solid var(--accent);
  border-radius: 4px;
  padding: 8px 12px;
  max-width: 420px;
}

.toastError {
  border-left-color: var(--ng);
}
```

- [ ] **Step 5: `apps/desktop/src/renderer/screens/screens.module.css` を書く**

```css
/* ホーム・課題一覧・セッション画面のレイアウト。設計仕様 §8.1 / §12.1。 */

.center {
  height: 100%;
  overflow-y: auto;
  padding: 32px 40px;
}

.title {
  font-size: 26px;
  margin: 0 0 4px;
}

.subtitle {
  color: var(--muted);
  margin: 0 0 24px;
}

.modeGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  max-width: 900px;
}

.modeCard {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: pointer;
  padding: 18px 20px;
  text-align: left;
}

.modeCard:disabled {
  cursor: default;
}

.modeName {
  display: block;
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 6px;
}

.modeDesc {
  color: var(--muted);
  display: block;
  font-size: 12px;
}

.problemTable {
  border-collapse: collapse;
  width: 100%;
  max-width: 900px;
}

.problemTable th,
.problemTable td {
  border-bottom: 1px solid var(--line);
  padding: 8px 10px;
  text-align: left;
}

.tag {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 3px;
  font-size: 11px;
  padding: 1px 6px;
}

.errorBox {
  background: rgba(214, 69, 69, 0.12);
  border-left: 4px solid var(--ng);
  margin-top: 20px;
  max-width: 900px;
  padding: 10px 14px;
}

.sessionLayout {
  display: grid;
  grid-template-columns: 1fr 380px;
  grid-template-rows: 1fr auto;
  flex: 1;
  min-height: 0;
}

.viewport {
  grid-column: 1;
  grid-row: 1;
  min-height: 0;
  position: relative;
}

.rightPanel {
  grid-column: 2;
  grid-row: 1 / span 2;
  border-left: 1px solid var(--line);
  overflow-y: auto;
  padding: 8px;
}

.bottomPanel {
  grid-column: 1;
  grid-row: 2;
  border-top: 1px solid var(--line);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 8px;
}

.statusOverlay {
  position: absolute;
  left: 12px;
  top: 12px;
  background: rgba(20, 24, 32, 0.75);
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 12px;
  padding: 4px 8px;
  pointer-events: none;
}

.schematicBox {
  background: #f7f7f4;
  border-radius: 4px;
  margin-top: 6px;
  padding: 6px;
}

.panelLive {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 8px 10px;
  margin-bottom: 8px;
}

.liveTitle {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  margin: 0 0 6px;
}

.settingRow {
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding: 10px 0;
}

.settingRow label {
  width: 300px;
}

.settingRow input[type='text'] {
  flex: 1;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--text);
  padding: 5px 8px;
}

.about {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  margin-top: 20px;
  padding: 10px 14px;
}
```

- [ ] **Step 6: `apps/desktop/src/renderer/app/routes.tsx` を書く**

```tsx
import type { JSX } from 'react';
import { Home } from '../screens/Home.js';
import { ProblemList } from '../screens/ProblemList.js';
import { Result } from '../screens/Result.js';
import { Session } from '../screens/Session.js';
import type { Route } from './store.js';

/**
 * 画面の切り替え。設計仕様 §12.1。
 * ルータライブラリは使わない（画面が5つしかなく、履歴も戻るボタンも要らないため）。
 */

/** ルート → 画面。 */
export function renderRoute(route: Route): JSX.Element {
  switch (route) {
    case 'home':
      return <Home />;
    case 'list':
      return <ProblemList />;
    case 'session':
      return <Session />;
    case 'result':
      return <Result />;
    case 'settings':
      // 設定画面は Plan 1D2 で作る。それまではホームを出す。§12.1
      return <Home />;
  }
}
```

- [ ] **Step 7: `apps/desktop/src/renderer/app/App.tsx` を書く**

```tsx
import { useEffect, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { renderRoute } from './routes.js';
import { useStore } from './store.js';
import styles from './app.module.css';

/**
 * アプリの外枠。設計仕様 §12.1 / §13 #5。
 * 未捕捉例外は上部の例外バナーで知らせ、「セッションをリセット」で復帰できるようにする。
 */

/** トーストを自動で消すまでの時間[ms]。 */
const TOAST_TTL_MS = 4000;

/** アプリ本体。 */
export function App(): JSX.Element {
  const route = useStore((s) => s.route);
  const toasts = useStore((s) => s.toasts);
  const fatalError = useStore((s) => s.fatalError);

  // 未捕捉例外を拾って例外バナーに出す（§13 #5）
  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      useStore.getState().setFatalError(event.message);
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      useStore.getState().setFatalError(String(event.reason));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // トーストを時間で消す
  useEffect(() => {
    const first = toasts[0];
    if (first === undefined) return;
    const id = setTimeout(() => {
      useStore.getState().dismissToast(first.id);
    }, TOAST_TTL_MS);
    return () => {
      clearTimeout(id);
    };
  }, [toasts]);

  return (
    <div className={styles.shell}>
      {fatalError === undefined ? null : (
        <div className={styles.banner} role="alert" data-testid="error-banner">
          <span>
            {JA.error.banner}: {fatalError}
          </span>
          <button
            type="button"
            onClick={() => {
              const store = useStore.getState();
              store.setFatalError(undefined);
              store.resetSession();
            }}
          >
            {JA.error.reset}
          </button>
        </div>
      )}
      {renderRoute(route)}
      <div className={styles.toasts}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${toast.tone === 'error' ? styles.toastError : ''}`}
            data-testid="toast"
            role="status"
          >
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: `apps/desktop/src/renderer/main.tsx` を書く**

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './app/global.css';

/**
 * renderer のエントリ。設計仕様 §4.3。
 * `StrictMode` は使わない。開発時の二重実行で `Session` の `useEffect` が Worker を
 * 2回起動してしまい、シミュレーションが二重に走るため（本番ビルドでは起きないが、
 * 開発と本番で挙動が変わるほうが危険と判断した）。
 */

const container = document.getElementById('root');
if (container === null) throw new Error('#root が見つかりません');

createRoot(container).render(<App />);
```

- [ ] **Step 9: `apps/desktop/src/renderer/index.html` を書く**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:"
    />
    <title>OJT電気保全トレーナー</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: `apps/desktop/src/renderer/screens/Home.tsx` を書く**

```tsx
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { useStore } from '../app/store.js';
import styles from './screens.module.css';

/**
 * ホーム（モード選択）。設計仕様 §12.1。
 * Phase 1 で開けるのはモードB（回路組立）だけで、残り3モードは押せない状態で並べる（§16）。
 */

/** モードの並び。§12.1 */
const MODES: ReadonlyArray<{ key: string; name: string; desc: string; enabled: boolean }> = [
  { key: 'assemble', name: JA.home.assemble, desc: JA.home.assembleDesc, enabled: true },
  { key: 'inspect-parts', name: JA.home.inspectParts, desc: JA.home.comingSoon, enabled: false },
  { key: 'inspect-repair', name: JA.home.inspectRepair, desc: JA.home.comingSoon, enabled: false },
  { key: 'plc', name: JA.home.plc, desc: JA.home.comingSoon, enabled: false },
];

/** ホーム画面。 */
export function Home(): JSX.Element {
  const setRoute = useStore((s) => s.setRoute);
  return (
    <div className={styles.center}>
      <h1 className={styles.title}>{JA.app.name}</h1>
      <p className={styles.subtitle}>{JA.app.subtitle}</p>
      <h2 className={styles.title} style={{ fontSize: 18 }}>
        {JA.home.title}
      </h2>
      <div className={styles.modeGrid}>
        {MODES.map((mode) => (
          <button
            key={mode.key}
            type="button"
            className={styles.modeCard}
            disabled={!mode.enabled}
            data-testid={`mode-${mode.key}`}
            onClick={() => {
              setRoute('list');
            }}
          >
            <span className={styles.modeName}>{mode.name}</span>
            <span className={styles.modeDesc}>{mode.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 11: `apps/desktop/src/renderer/screens/ProblemList.tsx` を書く**

```tsx
import { useEffect, type JSX } from 'react';
import { gradeLabel, JA } from '../i18n/ja.js';
import { useStore } from '../app/store.js';
import styles from './screens.module.css';

/**
 * 課題一覧。設計仕様 §12.1。
 * main の `content:list` が返した一覧をそのまま並べる。
 * 読込エラーの表示と利用者フォルダの合流は Plan 1D2 で足す（§13 #1 / §13 #9）。
 */

/** 課題一覧画面。 */
export function ProblemList(): JSX.Element {
  const problems = useStore((s) => s.problems);
  const setProblems = useStore((s) => s.setProblems);
  const setRoute = useStore((s) => s.setRoute);
  const openProblem = useStore((s) => s.openProblem);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    void window.ojt.listProblems().then(setProblems);
  }, [setProblems]);

  const open = (id: string): void => {
    void window.ojt.readProblem(id).then((problem) => {
      if (problem === null) {
        toast(`課題を読み込めませんでした: ${id}`, 'error');
        return;
      }
      openProblem(problem);
    });
  };

  return (
    <div className={styles.center}>
      <button
        type="button"
        onClick={() => {
          setRoute('home');
        }}
      >
        {JA.problemList.back}
      </button>
      <h1 className={styles.title} style={{ marginTop: 12 }}>
        {JA.problemList.title}
      </h1>
      {problems === undefined ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : problems.problems.length === 0 ? (
        <p className={styles.subtitle}>{JA.problemList.empty}</p>
      ) : (
        <table className={styles.problemTable} data-testid="problem-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>課題名</th>
              <th>級</th>
              <th>
                {JA.problemList.standard}/{JA.problemList.cutoff}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {problems.problems.map((problem) => (
              <tr key={problem.id}>
                <td>{problem.id}</td>
                <td>{problem.title}</td>
                <td>{gradeLabel(problem.grade)}</td>
                <td>
                  {problem.standardMin}/{problem.cutoffMin}
                  {JA.problemList.minutes}
                </td>
                <td>
                  <button
                    type="button"
                    data-testid={`open-${problem.id}`}
                    onClick={() => {
                      open(problem.id);
                    }}
                  >
                    {JA.problemList.open}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

    </div>
  );
}
```

- [ ] **Step 12: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/i18n` `apps/desktop/src/renderer/session/colors.ts` `apps/desktop/src/renderer/app` `apps/desktop/src/renderer/main.tsx` `apps/desktop/src/renderer/index.html` `apps/desktop/src/renderer/screens`

```powershell
git add apps/desktop/src/renderer/i18n apps/desktop/src/renderer/session/colors.ts apps/desktop/src/renderer/app apps/desktop/src/renderer/main.tsx apps/desktop/src/renderer/index.html apps/desktop/src/renderer/screens
git commit -m @'
feat(desktop): add app shell, home and problem list screens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 7: ピック結果 → 操作の純粋関数

**Files:**
- Create: `apps/desktop/src/renderer/session/interaction.ts`
- Test: `apps/desktop/test/interaction.test.ts`

仕様 §12.2「『ピック結果 → 実行する操作』の対応は純粋関数に分離し、3Dなしで単体テストできるようにする」。TDD で書く。


- [ ] **Step 1: `apps/desktop/test/interaction.test.ts` を書く**

```ts
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  deleteKeyToAction,
  escapeToAction,
  LOCKED_WIRE_MESSAGE,
  NOT_WIRABLE_MESSAGE,
  pickToAction,
  type InteractionState,
} from '../src/renderer/session/interaction.js';

const CR1_13 = toTerminalId('CR1.13');
const CR1_14 = toTerminalId('CR1.14');
const PL_BODY = toTerminalId('PL1.+');

function state(patch: Partial<InteractionState> = {}): InteractionState {
  return {
    mode: 'wire',
    pendingTerminal: undefined,
    selectedWire: undefined,
    wireColor: '青',
    ...patch,
  };
}

describe('pickToAction（配線モード）', () => {
  it('端子を1つ目に選ぶと beginWire', () => {
    expect(
      pickToAction(state(), { kind: 'terminal', id: CR1_13, wirable: true, label: 'CR1 ⑬' }),
    ).toEqual({ type: 'beginWire', from: CR1_13 });
  });

  it('端子を2つ目に選ぶと completeWire（線色を持つ）', () => {
    expect(
      pickToAction(state({ pendingTerminal: CR1_13 }), {
        kind: 'terminal',
        id: CR1_14,
        wirable: true,
        label: 'CR1 ⑭',
      }),
    ).toEqual({ type: 'completeWire', from: CR1_13, to: CR1_14, color: '青' });
  });

  it('同じ端子をもう一度押すと取り消し', () => {
    expect(
      pickToAction(state({ pendingTerminal: CR1_13 }), {
        kind: 'terminal',
        id: CR1_13,
        wirable: true,
        label: 'CR1 ⑬',
      }),
    ).toEqual({ type: 'cancelWire' });
  });

  it('配線できない端子（PB/PL本体）は拒否する', () => {
    expect(
      pickToAction(state(), { kind: 'terminal', id: PL_BODY, wirable: false, label: 'PL1 +' }),
    ).toEqual({ type: 'reject', message: NOT_WIRABLE_MESSAGE });
  });

  it('空間クリックで配線を取り消す', () => {
    expect(pickToAction(state({ pendingTerminal: CR1_13 }), { kind: 'empty' })).toEqual({
      type: 'cancelWire',
    });
  });

  it('電線をクリックすると選択する', () => {
    expect(pickToAction(state(), { kind: 'wire', id: 'w-001', locked: false })).toEqual({
      type: 'selectWire',
      wireId: 'w-001',
    });
  });

  it('空きソケットは装着用に選択する', () => {
    expect(pickToAction(state(), { kind: 'socket', id: 'S1', occupied: false })).toEqual({
      type: 'selectSocket',
      socketId: 'S1',
    });
  });

  it('装着済みソケットは取り外し用に選択する', () => {
    expect(pickToAction(state(), { kind: 'socket', id: 'S2', occupied: true })).toEqual({
      type: 'selectMounted',
      socketId: 'S2',
    });
  });

  it('押ボタンは press になる', () => {
    expect(pickToAction(state(), { kind: 'pushbutton', id: 'PB1' })).toEqual({
      type: 'pressButton',
      pbId: 'PB1',
    });
  });

  it('選択中の電線があるとき空間クリックで選択を外す', () => {
    expect(pickToAction(state({ selectedWire: 'w-001' }), { kind: 'empty' })).toEqual({
      type: 'selectWire',
      wireId: '',
    });
  });

  it('何も選んでいないときの空間クリックは何もしない', () => {
    expect(pickToAction(state(), { kind: 'empty' })).toEqual({ type: 'none' });
  });
});

describe('pickToAction（削除モード）', () => {
  it('電線を削除する', () => {
    expect(
      pickToAction(state({ mode: 'delete' }), { kind: 'wire', id: 'w-003', locked: false }),
    ).toEqual({ type: 'removeWire', wireId: 'w-003' });
  });

  it('固定配線は削除できない', () => {
    expect(
      pickToAction(state({ mode: 'delete' }), { kind: 'wire', id: 'fw-chk-1', locked: true }),
    ).toEqual({ type: 'reject', message: LOCKED_WIRE_MESSAGE });
  });

  it('削除モードでも押ボタンは押せる', () => {
    expect(pickToAction(state({ mode: 'delete' }), { kind: 'pushbutton', id: 'PB3' })).toEqual({
      type: 'pressButton',
      pbId: 'PB3',
    });
  });

  it('削除モードで端子を触っても何も起きない', () => {
    expect(
      pickToAction(state({ mode: 'delete' }), {
        kind: 'terminal',
        id: CR1_13,
        wirable: true,
        label: 'CR1 ⑬',
      }),
    ).toEqual({ type: 'none' });
  });
});

describe('キーボード', () => {
  it('Esc は配線中だけ取り消す', () => {
    expect(escapeToAction(state({ pendingTerminal: CR1_13 }))).toEqual({ type: 'cancelWire' });
    expect(escapeToAction(state())).toEqual({ type: 'none' });
  });

  it('Delete は選択中の電線を削除する', () => {
    expect(deleteKeyToAction(state({ selectedWire: 'w-002' }), [])).toEqual({
      type: 'removeWire',
      wireId: 'w-002',
    });
  });

  it('Delete は固定配線を拒否する', () => {
    expect(deleteKeyToAction(state({ selectedWire: 'fw-chk-2' }), ['fw-chk-2'])).toEqual({
      type: 'reject',
      message: LOCKED_WIRE_MESSAGE,
    });
  });

  it('Delete は未選択なら何もしない', () => {
    expect(deleteKeyToAction(state(), [])).toEqual({ type: 'none' });
  });
});
```

- [ ] **Step 2: テストが落ちることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop test -- interaction
```

期待出力:

```text
Error: Failed to resolve import "../src/renderer/session/interaction.js"
```

- [ ] **Step 3: `apps/desktop/src/renderer/session/interaction.ts` を書く**

```ts
import type { SocketId } from '@ojt/board-model';
import type { TerminalId, WireColor } from '@ojt/circuit-sim';

/**
 * 「ピック結果 → 実行する操作」の純粋関数。設計仕様 §12.2。
 * 3D も React も使わないので Vitest だけで全分岐を検証できる（§14.2）。
 */

/** レイキャストで拾えるもの。§12.2 */
export type PickHit =
  | { kind: 'terminal'; id: TerminalId; wirable: boolean; label: string }
  | { kind: 'wire'; id: string; locked: boolean }
  | { kind: 'socket'; id: SocketId; occupied: boolean }
  | { kind: 'pushbutton'; id: string }
  | { kind: 'empty' };

/** ツールバーのモード。§8.1 */
export type ToolMode = 'wire' | 'delete';

/** ピック判断に要る UI 状態だけを抜き出したもの。 */
export interface InteractionState {
  mode: ToolMode;
  /** 配線1本目に選んだ端子（未選択は undefined）。§8.2 */
  pendingTerminal: TerminalId | undefined;
  /** 選択中の電線ID。§8.2 */
  selectedWire: string | undefined;
  /** 選択中の線色。§8.1 */
  wireColor: WireColor;
}

/** ピックの結果として実行する操作。 */
export type PickAction =
  | { type: 'none' }
  /** 配線の1本目を選んだ。 */
  | { type: 'beginWire'; from: TerminalId }
  /** 2本目を選んだので電線を張る。 */
  | { type: 'completeWire'; from: TerminalId; to: TerminalId; color: WireColor }
  /** 配線操作を取り消す。§8.2 */
  | { type: 'cancelWire' }
  /** 電線を選択する。 */
  | { type: 'selectWire'; wireId: string }
  /** 電線を削除する。 */
  | { type: 'removeWire'; wireId: string }
  /** 固定配線には触れない。§6.3 */
  | { type: 'reject'; message: string }
  /** ソケットを選ぶ（部品パネルで装着する部品を選ばせる）。§8.2 */
  | { type: 'selectSocket'; socketId: SocketId }
  /** 装着済み部品を選ぶ（取り外しUIを出す）。§8.2 */
  | { type: 'selectMounted'; socketId: SocketId }
  /** 押ボタンを押す。§8.2 */
  | { type: 'pressButton'; pbId: string };

/** 固定配線を触ったときの文言。§6.3 */
export const LOCKED_WIRE_MESSAGE = 'チェック用回路の黄色配線は変更できません';
/** 配線できない端子を触ったときの文言。§6.4 */
export const NOT_WIRABLE_MESSAGE = 'この端子には配線できません（本体側は既設配線済みです）';

/**
 * ピック結果を操作に変換する。§12.2
 * - 削除モード: 電線を拾ったら削除、`locked` なら拒否、それ以外は何もしない
 * - 配線モード: 端子 → 端子 で配線、同じ端子を2度押したら取り消し、空間クリックで取り消し
 */
export function pickToAction(state: InteractionState, hit: PickHit): PickAction {
  if (state.mode === 'delete') {
    if (hit.kind === 'wire') {
      return hit.locked
        ? { type: 'reject', message: LOCKED_WIRE_MESSAGE }
        : { type: 'removeWire', wireId: hit.id };
    }
    if (hit.kind === 'pushbutton') return { type: 'pressButton', pbId: hit.id };
    return { type: 'none' };
  }

  switch (hit.kind) {
    case 'terminal': {
      if (!hit.wirable) return { type: 'reject', message: NOT_WIRABLE_MESSAGE };
      const pending = state.pendingTerminal;
      if (pending === undefined) return { type: 'beginWire', from: hit.id };
      if (pending === hit.id) return { type: 'cancelWire' };
      return { type: 'completeWire', from: pending, to: hit.id, color: state.wireColor };
    }
    case 'wire':
      return state.pendingTerminal === undefined
        ? { type: 'selectWire', wireId: hit.id }
        : { type: 'cancelWire' };
    case 'socket':
      if (state.pendingTerminal !== undefined) return { type: 'cancelWire' };
      return hit.occupied
        ? { type: 'selectMounted', socketId: hit.id }
        : { type: 'selectSocket', socketId: hit.id };
    case 'pushbutton':
      return state.pendingTerminal === undefined
        ? { type: 'pressButton', pbId: hit.id }
        : { type: 'cancelWire' };
    case 'empty':
      if (state.pendingTerminal !== undefined) return { type: 'cancelWire' };
      return state.selectedWire === undefined ? { type: 'none' } : { type: 'selectWire', wireId: '' };
  }
}

/** Esc キーの扱い（配線中なら取り消し、それ以外は何もしない）。§8.2 */
export function escapeToAction(state: InteractionState): PickAction {
  return state.pendingTerminal === undefined ? { type: 'none' } : { type: 'cancelWire' };
}

/** Delete キーの扱い（電線を選んでいれば削除）。§8.2 */
export function deleteKeyToAction(
  state: InteractionState,
  lockedWireIds: readonly string[],
): PickAction {
  const id = state.selectedWire;
  if (id === undefined || id.length === 0) return { type: 'none' };
  if (lockedWireIds.includes(id)) return { type: 'reject', message: LOCKED_WIRE_MESSAGE };
  return { type: 'removeWire', wireId: id };
}
```

- [ ] **Step 4: テストが通ることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop test -- interaction
```

期待出力:

```text
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

- [ ] **Step 5: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/session/interaction.ts` `apps/desktop/test/interaction.test.ts`

```powershell
git add apps/desktop/src/renderer/session/interaction.ts apps/desktop/test/interaction.test.ts
git commit -m @'
feat(desktop): add pure pick-to-action mapping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 8: コマンド履歴（元に戻す／やり直し）

**Files:**
- Create: `apps/desktop/src/renderer/session/commands.ts`
- Test: `appsts/desktop/test/commands.test.ts`

**逆操作ではなくスナップショットを持つ理由**: タイマの設定値はレンジの分解能に丸められるため、逆操作を組み立てると元の値に戻らない場合がある。セッションは電線数十本ぶんの素のJSONなので、50手ぶん持っても数十KBにしかならない（§8.2 の上限50手）。


- [ ] **Step 1: `apps/desktop/test/commands.test.ts` を書く**

```ts
import { createSession, JIPM_BOARD, TASK2_SOCKET_ROLES } from '@ojt/board-model';
import { toTerminalId, wireId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  cloneSession,
  emptyHistory,
  HISTORY_LIMIT,
  pushCommand,
  redo,
  runAddWire,
  runPlug,
  runRemoveWire,
  runSetPreset,
  runUnplug,
  undo,
} from '../src/renderer/session/commands.js';

function session() {
  return createSession(JIPM_BOARD, { roles: TASK2_SOCKET_ROLES, allowedColors: ['青'] });
}

describe('runAddWire', () => {
  it('端子を結んで電線を1本足す', () => {
    const s = session();
    const before = s.wires.length;
    const result = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    expect(result.ok).toBe(true);
    expect(s.wires.length).toBe(before + 1);
  });

  it('許可されていない線色は拒否する（モードBは青のみ。§8.1）', () => {
    const result = runAddWire(session(), toTerminalId('P.1'), toTerminalId('CR1.14'), '白');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('color-not-allowed');
  });

  it('1端子3本目は拒否する（§6.6 / §5.6 #5）', () => {
    const s = session();
    runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    runAddWire(s, toTerminalId('P.1'), toTerminalId('CR2.14'), '青');
    const third = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR3.14'), '青');
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe('terminal-overload');
  });

  it('PB本体端子には配線できない（§6.4）', () => {
    const result = runAddWire(session(), toTerminalId('PB1.a'), toTerminalId('CR1.14'), '青');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('terminal-not-wirable');
  });
});

describe('runRemoveWire', () => {
  it('張った電線を外せる', () => {
    const s = session();
    const added = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const removed = runRemoveWire(s, added.value.id);
    expect(removed.ok).toBe(true);
  });

  it('チェック用回路の黄色配線は外せない（§6.3）', () => {
    const s = session();
    const locked = s.wires.find((w) => w.locked);
    expect(locked).toBeDefined();
    const result = runRemoveWire(s, locked?.id ?? '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('locked-wire');
  });
});

describe('runPlug / runUnplug / runSetPreset', () => {
  it('ソケットに装着して外せる', () => {
    const s = session();
    expect(runPlug(s, 'S1', 'relay-my4n').ok).toBe(true);
    expect(s.mounted['S1']?.kind).toBe('relay-my4n');
    expect(runUnplug(s, 'S1').ok).toBe(true);
    expect(s.mounted['S1']).toBeUndefined();
  });

  it('埋まっているソケットには装着できない', () => {
    const s = session();
    runPlug(s, 'S1', 'relay-my4n');
    const again = runPlug(s, 'S1', 'relay-my4n');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('socket-occupied');
  });

  it('タイマの設定値はレンジの分解能に丸める（0〜10sレンジは0.1s刻み。§5.3.2）', () => {
    const s = session();
    runPlug(s, 'S3', 'timer-h3y4');
    expect(runSetPreset(s, 'S3', 3040).ok).toBe(true);
    const mounted = s.mounted['S3'];
    expect(mounted?.kind === 'timer-h3y4' ? mounted.presetMs : 0).toBe(3000);
  });

  it('リレーにタイマ設定はできない', () => {
    const s = session();
    runPlug(s, 'S1', 'relay-my4n');
    const result = runSetPreset(s, 'S1', 3000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not-a-timer');
  });
});

describe('コマンド履歴', () => {
  it('元に戻すと配線前の状態へ戻る', () => {
    const s = session();
    const before = s.wires.length;
    const result = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const history = pushCommand(emptyHistory(), result.command);
    const undone = undo(history);
    expect(undone?.session.wires.length).toBe(before);
    const redone = redo(undone?.history ?? emptyHistory());
    expect(redone?.session.wires.length).toBe(before + 1);
  });

  it('新しい手を積むとやり直し列は消える', () => {
    const s = session();
    const first = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    const second = runAddWire(s, toTerminalId('N.1'), toTerminalId('CR1.13'), '青');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    let history = pushCommand(emptyHistory(), first.command);
    const undone = undo(history);
    expect(undone).toBeDefined();
    history = pushCommand(undone?.history ?? emptyHistory(), second.command);
    expect(history.undone).toHaveLength(0);
  });

  it('上限50手を超えた古い手は捨てる（§8.2）', () => {
    const s = session();
    const result = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let history = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) history = pushCommand(history, result.command);
    expect(history.done).toHaveLength(HISTORY_LIMIT);
  });

  it('空の履歴は戻せない・やり直せない', () => {
    expect(undo(emptyHistory())).toBeUndefined();
    expect(redo(emptyHistory())).toBeUndefined();
  });
});

describe('cloneSession', () => {
  it('電線配列と装着状態を共有しない（履歴のスナップショットが壊れないこと）', () => {
    const s = session();
    const copy = cloneSession(s);
    const first = s.wires[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    copy.wires.push({ ...first, id: wireId('w-copy') });
    expect(copy.wires.length).toBe(s.wires.length + 1);
    copy.mounted['S1'] = { kind: 'relay-my4n' };
    expect(s.mounted['S1']).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストが落ちることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop test -- commands
```

期待出力:

```text
Error: Failed to resolve import "../src/renderer/session/commands.js"
```

- [ ] **Step 3: `apps/desktop/src/renderer/session/commands.ts` を書く**

```ts
import {
  addWire,
  JIPM_BOARD,
  plug,
  removeWire,
  setPreset,
  toNetlistTerminal,
  unplug,
  type BoardSession,
  type MountableKind,
  type Result,
  type SocketId,
} from '@ojt/board-model';
import type { TerminalId, Wire, WireColor } from '@ojt/circuit-sim';

/**
 * 盤操作のコマンド履歴（元に戻す／やり直し、上限50手）。設計仕様 §8.2。
 *
 * 逆操作を自前で組み立てると「タイマのレンジ丸め」等で元に戻せない場合があるため、
 * **操作の前後でセッション全体のスナップショットを持つ**方式にする。
 * セッションは電線数十本ぶんの素の JSON なので 50 手ぶん持っても数十KBにしかならない。
 */

/** 元に戻せる手数の上限。§8.2 */
export const HISTORY_LIMIT = 50;

/** コマンド1件。 */
export interface SessionCommand {
  /** 操作の種別（ログ表示用）。 */
  kind: 'addWire' | 'removeWire' | 'plug' | 'unplug' | 'setPreset';
  /** 操作の説明（操作ログに出す文）。§8.1 */
  label: string;
  before: BoardSession;
  after: BoardSession;
}

/** 元に戻す／やり直しの履歴。 */
export interface CommandHistory {
  done: SessionCommand[];
  undone: SessionCommand[];
}

/** 空の履歴。 */
export function emptyHistory(): CommandHistory {
  return { done: [], undone: [] };
}

/** セッションを深くコピーする（履歴に入れるスナップショット）。 */
export function cloneSession(session: BoardSession): BoardSession {
  return {
    ...session,
    mounted: { ...session.mounted },
    wires: session.wires.map((w) => ({ ...w })),
    allowedColors: [...session.allowedColors],
    extraParts: [...session.extraParts],
    inventory: session.inventory.map((i) => ({ ...i })),
  };
}

/** 履歴に1手積む（上限を超えた古い手は捨てる。やり直し列は消える）。§8.2 */
export function pushCommand(history: CommandHistory, command: SessionCommand): CommandHistory {
  const done = [...history.done, command];
  return { done: done.slice(Math.max(0, done.length - HISTORY_LIMIT)), undone: [] };
}

/** 1手戻す。戻せなければ undefined。 */
export function undo(
  history: CommandHistory,
): { history: CommandHistory; session: BoardSession; command: SessionCommand } | undefined {
  const command = history.done[history.done.length - 1];
  if (command === undefined) return undefined;
  return {
    history: { done: history.done.slice(0, -1), undone: [...history.undone, command] },
    session: cloneSession(command.before),
    command,
  };
}

/** 1手やり直す。やり直せなければ undefined。 */
export function redo(
  history: CommandHistory,
): { history: CommandHistory; session: BoardSession; command: SessionCommand } | undefined {
  const command = history.undone[history.undone.length - 1];
  if (command === undefined) return undefined;
  return {
    history: { done: [...history.done, command], undone: history.undone.slice(0, -1) },
    session: cloneSession(command.after),
    command,
  };
}

/** 操作の実行結果（成功なら新しいセッションと履歴1手）。 */
export type CommandResult<T> =
  | { ok: true; value: T; command: SessionCommand }
  | { ok: false; code: string; message: string };

function wrap<T>(
  before: BoardSession,
  session: BoardSession,
  result: Result<T>,
  kind: SessionCommand['kind'],
  label: string,
): CommandResult<T> {
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return {
    ok: true,
    value: result.value,
    command: { kind, label, before, after: cloneSession(session) },
  };
}

/**
 * 電線を張る。§8.2（失敗理由はそのままトーストに出す）
 *
 * 3D盤から渡ってくる端子IDは**物理ID**（`S1.10`。盤定義 `BoardTerminal.id`）だが、
 * `BoardSession.wires` と `toNetlist()` は**役割ID**（`CR1.10`。§6.4）で持つ。
 * その変換をここ1箇所で行う（`toNetlistTerminal()` は端子台や P/N はそのまま返す）。
 */
export function runAddWire(
  session: BoardSession,
  from: TerminalId,
  to: TerminalId,
  color: WireColor,
): CommandResult<Wire> {
  const before = cloneSession(session);
  const netFrom = toNetlistTerminal(session.socketRoles, from);
  const netTo = toNetlistTerminal(session.socketRoles, to);
  const result = addWire(session, JIPM_BOARD, netFrom, netTo, color);
  return wrap(before, session, result, 'addWire', `配線 ${netFrom} — ${netTo}（${color}）`);
}

/** 電線を外す。§8.2 */
export function runRemoveWire(session: BoardSession, wireId: string): CommandResult<Wire> {
  const before = cloneSession(session);
  const result = removeWire(session, wireId);
  return wrap(before, session, result, 'removeWire', `電線を削除 ${wireId}`);
}

/** 部品を装着する。§8.2 */
export function runPlug(
  session: BoardSession,
  socketId: SocketId,
  kind: MountableKind,
): CommandResult<unknown> {
  const before = cloneSession(session);
  const result = plug(session, socketId, kind);
  return wrap(before, session, result, 'plug', `${socketId} に ${kind} を装着`);
}

/** 部品を外す。§8.2 */
export function runUnplug(session: BoardSession, socketId: SocketId): CommandResult<unknown> {
  const before = cloneSession(session);
  const result = unplug(session, socketId);
  return wrap(before, session, result, 'unplug', `${socketId} の部品を取り外し`);
}

/** タイマの設定時間を変える。§8.2 */
export function runSetPreset(
  session: BoardSession,
  socketId: SocketId,
  presetMs: number,
): CommandResult<unknown> {
  const before = cloneSession(session);
  const result = setPreset(session, socketId, presetMs);
  return wrap(
    before,
    session,
    result,
    'setPreset',
    `${socketId} のタイマを ${(presetMs / 1000).toFixed(1)} 秒に設定`,
  );
}
```

- [ ] **Step 4: テストが通ることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop test -- commands
```

期待出力:

```text
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

- [ ] **Step 5: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/session/commands.ts` `apps/desktop/test/commands.test.ts`

```powershell
git add apps/desktop/src/renderer/session/commands.ts apps/desktop/test/commands.test.ts
git commit -m @'
feat(desktop): add board command history with undo and redo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 9: 3D の土台（座標・カメラ・共有資源・印字）

**Files:**
- Create: `apps/desktop/src/renderer/three/coords.ts`, `apps/desktop/src/renderer/three/camera.ts`, `apps/desktop/src/renderer/three/materials.ts`, `apps/desktop/src/renderer/three/labels.ts`
- Test: `apps/desktop/test/scene.test.ts`

**端子の印字をキャンバステクスチャにする理由**: `@react-three/drei` の `<Text>`（SDF）は1文字列につき1メッシュを作るため、ソケット8個 × 14端子 × 2行 ＋ 端子台 26端子で 250個以上のメッシュになる。機器1個につきテクスチャ1枚に焼けばドローコールは12枚で済み、解像度は `PX_PER_MM` を上げるだけで「ソケット拡大」視点の判読性を確保できる（§15 の性能目標）。


- [ ] **Step 1: `apps/desktop/src/renderer/three/coords.ts` を書く**

```ts
import { BOARD_HEIGHT_MM, BOARD_WIDTH_MM, type Vec3 } from '@ojt/board-model';

/**
 * 盤モデルの座標 → Three.js のシーン座標。設計仕様 §6.5。
 *
 * 盤モデルは「盤の左上手前を原点、x は右、y は下、z は盤面からの高さ」の mm 座標系（§6.5）。
 * シーンでは実物と同じく盤を立てて正面から見るので、XY 平面に置き、盤の中心を原点にする。
 * 単位は mm のまま扱う（カメラの near/far をそれに合わせる）ので、寸法定数を変換なしで使える。
 */

/** 盤モデル座標をシーン座標に直す純粋関数。 */
export function toScene(v: Vec3): [number, number, number] {
  return [v.x - BOARD_WIDTH_MM / 2, -(v.y - BOARD_HEIGHT_MM / 2), v.z];
}

/** x/y/z を個別に渡す版。 */
export function scenePos(x: number, y: number, z: number): [number, number, number] {
  return toScene({ x, y, z });
}
```

- [ ] **Step 2: `apps/desktop/src/renderer/three/camera.ts` を書く**

```ts
import { BOARD_HEIGHT_MM, BOARD_WIDTH_MM, JIPM_BOARD } from '@ojt/board-model';
import type { CameraPreset } from '../app/store-types.js';

/**
 * 盤の傾きと視点プリセットの純粋な計算。設計仕様 §6.5 / §12.2。
 * React も three も使わないので、単体テストからも E2E の射影計算からも読める。
 */

/** カメラの垂直視野角[度]。`BoardScene` の `Canvas` に渡す値。 */
export const CAMERA_FOV_DEG = 38;

/** ソケット段の中心の盤モデル y[mm]。盤定義のソケット原点と本体寸法から求める（ハードコードしない）。 */
export const SOCKET_ROW_CENTER_MM = ((): number => {
  const sockets = JIPM_BOARD.sockets;
  const first = sockets[0];
  if (first === undefined) return BOARD_HEIGHT_MM / 2;
  const top = Math.min(...sockets.map((socket) => socket.origin.y));
  return top + first.bodyMm.length / 2;
})();

/**
 * 盤グループの X 軸回転量[rad]。
 * 盤面ローカル（+Z が盤面の法線、+Y が盤の手前方向）を机の上に寝かせ、
 * 筐体の傾斜角ぶんだけ手前を下げる。`-90°` で完全に水平、`slopeDeg` ぶん戻して傾斜コンソールにする。
 */
export const BOARD_TILT_RAD = -(Math.PI / 2 - (JIPM_BOARD.console.slopeDeg * Math.PI) / 180);

/** 盤ローカル座標（`toScene()` の結果）→ ワールド座標。盤グループと同じ回転を掛ける。 */
export function boardToWorld(
  [x, y, z]: readonly [number, number, number],
  tiltRad: number = BOARD_TILT_RAD,
): [number, number, number] {
  const cos = Math.cos(tiltRad);
  const sin = Math.sin(tiltRad);
  return [x, y * cos - z * sin, y * sin + z * cos];
}

/** カメラ位置・注視点・上方向（すべてワールド座標）。 */
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

/** 盤面の「上」方向（盤ローカルの +Y を回した向き）。面直視のときのカメラ上方向。 */
export function boardUp(): [number, number, number] {
  return boardToWorld([0, 1, 0]);
}

/**
 * プリセット → 視点。§12.2
 * - `front`（正面）: 盤面の法線方向から見る。面直なので端子が重ならずいちばん操作しやすい
 * - `top`（俯瞰）: 実物写真と同じ左手前・上からの斜め俯瞰。盤の立体感を見せる
 * - `socket`（ソケット拡大）: 面直のままソケット段へ寄る
 */
export function cameraPose(preset: CameraPreset): CameraPose {
  const w = BOARD_WIDTH_MM;
  const h = BOARD_HEIGHT_MM;
  // 視野角38°・横基準。盤の幅330mmが収まるには距離 ≥ 165/(tan(19°)×aspect) 必要で、
  // 16:10 のビューポート（aspect 1.6）なら 305mm。1割の余白を足した w × 1.05 を面直視の距離にする。
  const faceDistance = Math.max(w * 1.05, h * 1.55);
  const socketY = h / 2 - SOCKET_ROW_CENTER_MM;
  switch (preset) {
    case 'front':
      return {
        position: boardToWorld([0, 0, faceDistance]),
        target: boardToWorld([0, 0, 0]),
        up: boardUp(),
      };
    case 'top':
      return {
        position: [-w * 0.62, h * 1.1, h * 1.05],
        target: [0, 0, -h * 0.02],
        up: [0, 1, 0],
      };
    case 'socket':
      return {
        position: boardToWorld([0, socketY, faceDistance * 0.5]),
        target: boardToWorld([0, socketY, 0]),
        up: boardUp(),
      };
  }
}
```

- [ ] **Step 3: `apps/desktop/src/renderer/three/materials.ts` を書く**

```ts
import { useMemo } from 'react';
import {
  BoxGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  type Material,
} from 'three';

/**
 * 共有ジオメトリ／マテリアル。設計仕様 §15「電線はチューブジオメトリを共有マテリアルで描く」。
 * 端子は 5 ソケット × 14 ピン ＋ 端子台 20 個 ＋ P/N 12 個で 100 個を超えるため、
 * 形と色が同じものは必ず 1 個を使い回してドローコールとメモリを抑える。
 */

/** ネジ端子の見た目（半径 1.8mm・高さ 1.6mm の円柱）。 */
export const SCREW_GEOMETRY = new CylinderGeometry(1.8, 1.8, 1.6, 12);

/** 端子の当たり判定球（実際の半径は `pickRadiusMm` でスケールする）。§6.5 */
export const PICK_GEOMETRY = new SphereGeometry(1, 10, 8);

/** 1×1×1 の箱（スケールして使い回す）。 */
export const UNIT_BOX = new BoxGeometry(1, 1, 1);

/** Y型圧着端子の輪（外径 5mm・線径 0.9mm）。§6.6 */
export const LUG_GEOMETRY = new CylinderGeometry(2.5, 2.5, 0.9, 10, 1, true);

/** 当たり判定メッシュ用の透明マテリアル（見えないが raycast は拾う）。 */
export const INVISIBLE_MATERIAL: Material = new MeshStandardMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

const materialCache = new Map<string, MeshStandardMaterial>();

/** 色ごとに1個だけ作る標準マテリアル。 */
export function sharedMaterial(
  color: string,
  options: { metalness?: number; roughness?: number; emissive?: string; emissiveIntensity?: number } = {},
): MeshStandardMaterial {
  const key = `${color}|${options.metalness ?? 0.1}|${options.roughness ?? 0.7}|${options.emissive ?? ''}|${options.emissiveIntensity ?? 0}`;
  const cached = materialCache.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.1,
    roughness: options.roughness ?? 0.7,
    ...(options.emissive === undefined ? {} : { emissive: options.emissive }),
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  materialCache.set(key, material);
  return material;
}

/** 発光強度だけが変わるマテリアル（ランプ用。色ごとにインスタンスを分ける）。§5.3.4 */
export function useLampMaterial(color: string, intensity: number): MeshStandardMaterial {
  const material = useMemo(
    () =>
      new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.35 }),
    [color],
  );
  material.emissiveIntensity = intensity;
  return material;
}
```

- [ ] **Step 4: `apps/desktop/src/renderer/three/labels.ts` を書く**

```ts
import { roleLabel, type BoardTerminal, type TerminalRole } from '@ojt/board-model';
import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';

/**
 * 端子の印字ラベル。設計仕様 §6.2 / §8.2 / §15。
 *
 * 実物のソケットと端子台にはネジの脇に番号が印刷されており、受検者はそれを見て配線する。
 * §6.2 の非連番配置（段4に ④ が混ざる）を間違えないためにも、番号は**常時**見えている必要がある。
 *
 * 描き方の選択（本アプリの決定）:
 * `@react-three/drei` の `<Text>`（SDF）は1文字列につき1メッシュを作るため、
 * ソケット8個 × 14端子 × 2行（番号＋役割）＋端子台 26端子 ＝ 250個以上のメッシュになり、
 * §15 の性能目標（内蔵GPUで60fps）に対して無視できないドローコール増になる。
 * そこで**機器1個につきキャンバステクスチャ1枚**にまとめて焼き、
 * 機器の面に1枚の板として貼る。ドローコールは機器の数（8＋4＝12枚）で済み、
 * 解像度も `PX_PER_MM` を上げるだけで「ソケット拡大」視点の判読性を確保できる。
 */

/** テクスチャの解像度[px/mm]。正面視で 10px 相当、ソケット拡大では十分に判読できる。 */
export const PX_PER_MM = 16;

/**
 * 端子番号の文字高さ[mm]。
 * 正面視（盤の高さ300mmがビューポート高の約8割）で画面上 10px 相当になるよう 4.6mm とした。
 * ピン間隔は 9mm（列）× 12mm（段）なので、番号＋役割の2行（合計 9.1mm）でも隣と当たらない。
 */
const NUMBER_MM = 4.6;
/** 役割文字の高さ[mm]。 */
const ROLE_MM = 3;

/** 端子台の印字テクスチャの最小の幅・奥行[mm]（`TerminalBlock` の `MIN_BODY_MM` と合わせる）。 */
const MIN_FACE_MM = 16;

/** 役割ごとの印字色（極性は色でも区別する）。 */
const ROLE_COLOR: Readonly<Record<TerminalRole, string>> = {
  'coil+': '#D14343',
  'coil-': '#2E6BD6',
  com: '#1B1E23',
  no: '#1B1E23',
  nc: '#1B1E23',
  '+': '#D14343',
  '-': '#2E6BD6',
  c: '#1B1E23',
  a: '#1B1E23',
  b: '#1B1E23',
  ac: '#1B1E23',
};

/** キャンバスを作って描き、テクスチャにする。キャンバスが使えない環境では undefined。 */
export function makeCanvasTexture(
  widthMm: number,
  heightMm: number,
  draw: (ctx: CanvasRenderingContext2D, widthPx: number, heightPx: number) => void,
): Texture | undefined {
  const widthPx = Math.max(1, Math.round(widthMm * PX_PER_MM));
  const heightPx = Math.max(1, Math.round(heightMm * PX_PER_MM));
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return undefined;
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  draw(ctx, widthPx, heightPx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * ソケット1個ぶんの印字（`⑬ −` のような盤定義の `label` をそのまま焼く）。
 * 盤の mm 座標 `(originX, originY)` を板の左上に対応させるので、
 * 端子が段付きに並んでいても印字は端子の真上に来る。
 */
export function socketFaceTexture(
  terminals: readonly BoardTerminal[],
  originX: number,
  originY: number,
  plateWidthMm: number,
  plateHeightMm: number,
): Texture | undefined {
  if (terminals.length === 0) return undefined;
  return makeCanvasTexture(plateWidthMm, plateHeightMm, (ctx) => {
    for (const terminal of terminals) {
      const x = (terminal.pos.x - originX) * PX_PER_MM;
      const y = (terminal.pos.y - originY) * PX_PER_MM;
      // 盤定義のラベルは `S1 ⑨ com` の形。丸数字だけを取り出し、役割は `roleLabel()` で記号にする
      const number = terminal.label.split(' ').at(-2) ?? terminal.label;
      ctx.fillStyle = '#F2F2EE';
      ctx.font = `700 ${NUMBER_MM * PX_PER_MM}px sans-serif`;
      ctx.fillText(number, x, y - NUMBER_MM * PX_PER_MM * 0.55);
      ctx.fillStyle = ROLE_COLOR[terminal.role];
      ctx.font = `700 ${ROLE_MM * PX_PER_MM}px sans-serif`;
      ctx.fillText(roleLabel(terminal.role), x, y + NUMBER_MM * PX_PER_MM * 0.6);
    }
  });
}

/** 端子台の印字に使う短い名前（`PL1+` / `PB1c` / `P1` / `N1`）。§6.4 */
export function blockTerminalMark(terminal: BoardTerminal): string {
  const [part, name] = terminal.id.split('.');
  if (part === undefined || name === undefined) return terminal.id;
  if (part === 'TB_PL') return `PL${name}`;
  if (part === 'TB_PB') return `PB${name}`;
  return `${part}${name}`;
}

/** 盤定義のラベルから丸数字だけを取り出す（`S1 ⑨ com` → `⑨`）。 */
export function terminalNumber(terminal: BoardTerminal): string {
  return terminal.label.split(' ').at(-2) ?? terminal.label;
}

/** 端子台1個ぶんの印字。端子の外接矩形＋余白を板とし、各端子の真下に名前を描く。 */
export function blockFaceTexture(
  terminals: readonly BoardTerminal[],
  padMm: number,
): Texture | undefined {
  if (terminals.length === 0) return undefined;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // 端子が1〜2点しかない端子台でもテクスチャが潰れないよう最小サイズを持たせる
  const widthMm = Math.max(MIN_FACE_MM, maxX - minX + padMm * 2);
  const heightMm = Math.max(MIN_FACE_MM, maxY - minY + padMm * 2);
  const offsetX = (widthMm - (maxX - minX)) / 2;
  const offsetY = (heightMm - (maxY - minY)) / 2;
  return makeCanvasTexture(widthMm, heightMm, (ctx) => {
    ctx.font = `700 ${ROLE_MM * PX_PER_MM}px sans-serif`;
    for (const terminal of terminals) {
      const x = (terminal.pos.x - minX + offsetX) * PX_PER_MM;
      const y = (terminal.pos.y - minY + offsetY) * PX_PER_MM;
      ctx.fillStyle = ROLE_COLOR[terminal.role];
      ctx.fillText(blockTerminalMark(terminal), x, y + ROLE_MM * PX_PER_MM * 1.5);
    }
  });
}
```

- [ ] **Step 5: `apps/desktop/test/scene.test.ts` を書く**

`socketTerminalLabel` は Task 10 で作る `Socket.tsx` にあるので、この時点では import 解決に失敗する。Task 10 の後に通す。

```ts
import {
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  JIPM_BOARD,
  roleLabel,
  SOCKET_PIN_GRID,
  socketPinHoleOffsets,
  socketPinTerminal,
  socketRowExit,
  vec3,
} from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { scenePos, toScene } from '../src/renderer/three/coords.js';
import {
  BOARD_TILT_RAD,
  boardToWorld,
  boardUp,
  cameraPose,
  SOCKET_ROW_CENTER_MM,
} from '../src/renderer/three/camera.js';
import { socketTerminalLabel } from '../src/renderer/three/Socket.js';
import { mountedLabel } from '../src/renderer/three/MountedPart.js';
import { secondsToMs } from '../src/renderer/panels/TimerDial.js';

describe('toScene', () => {
  it('盤の中心が原点になる', () => {
    const [x, y, z] = toScene(vec3(BOARD_WIDTH_MM / 2, BOARD_HEIGHT_MM / 2, 0));
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(0, 10);
  });

  it('盤モデルの y（下向き）はシーンの −Y になる', () => {
    const [, y] = toScene(vec3(0, BOARD_HEIGHT_MM, 0));
    expect(y).toBe(-BOARD_HEIGHT_MM / 2);
  });

  it('scenePos は toScene と同じ結果になる', () => {
    expect(scenePos(10, 20, 5)).toEqual(toScene(vec3(10, 20, 5)));
  });
});

describe('盤の傾き（§6.5 傾斜コンソール）', () => {
  it('盤面の法線はほぼ真上を向き、少しだけ手前に倒れる', () => {
    const normal = boardToWorld([0, 0, 1]);
    expect(normal[1]).toBeGreaterThan(0.9);
    expect(normal[2]).toBeGreaterThan(0);
    expect(normal[2]).toBeLessThan(0.3);
  });

  it('盤の奥（盤ローカル +Y）は画面の奥へ倒れる', () => {
    const up = boardUp();
    expect(up[2]).toBeLessThan(-0.9);
  });

  it('傾斜角は盤定義の筐体形状（console.slopeDeg）から決まる', () => {
    expect(BOARD_TILT_RAD).toBeLessThan(0);
    expect(BOARD_TILT_RAD).toBeGreaterThan(-Math.PI / 2);
  });
});

describe('cameraPose', () => {
  it('正面視は盤面の法線方向から、盤の高さが視野38°に収まる距離で見る（§12.2）', () => {
    const pose = cameraPose('front');
    const distance = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    const halfHeightAtDistance = distance * Math.tan((38 / 2) * (Math.PI / 180));
    expect(halfHeightAtDistance).toBeGreaterThan(BOARD_HEIGHT_MM / 2);
    // 視線は盤面の法線と平行（面直）
    expect(pose.position[1]).toBeGreaterThan(pose.target[1]);
  });

  it('俯瞰は実物写真と同じ左手前・上からの斜め視点になる', () => {
    const pose = cameraPose('top');
    expect(pose.position[0]).toBeLessThan(0);
    expect(pose.position[1]).toBeGreaterThan(0);
    expect(pose.position[2]).toBeGreaterThan(0);
    expect(pose.up).toEqual([0, 1, 0]);
  });

  it('ソケット拡大は面直のままソケット段に寄る', () => {
    const front = cameraPose('front');
    const socket = cameraPose('socket');
    const frontDistance = Math.hypot(
      front.position[0] - front.target[0],
      front.position[1] - front.target[1],
      front.position[2] - front.target[2],
    );
    const socketDistance = Math.hypot(
      socket.position[0] - socket.target[0],
      socket.position[1] - socket.target[1],
      socket.position[2] - socket.target[2],
    );
    expect(socketDistance).toBeLessThan(frontDistance);
    expect(socket.target).toEqual(boardToWorld([0, BOARD_HEIGHT_MM / 2 - SOCKET_ROW_CENTER_MM, 0]));
  });
});

describe('端子ラベル', () => {
  it('役割の印字は極性・接点種別の記号になる（§6.2）', () => {
    expect(roleLabel('coil+')).toBe('+');
    expect(roleLabel('coil-')).toBe('−');
    expect(roleLabel('com')).toBe('COM');
    expect(roleLabel('no')).toBe('a');
    expect(roleLabel('nc')).toBe('b');
  });

  it('ツールチップは役割IDを足して `CR1 ⑨ COM` にする（§8.2）', () => {
    const terminal = JIPM_BOARD.terminals.find((t) => t.id === socketPinTerminal('S1', 9));
    expect(terminal).toBeDefined();
    if (terminal === undefined) return;
    expect(socketTerminalLabel('CR1', terminal)).toBe('CR1 ⑨ COM');
  });

  it('役割が割り当てられていない予備ソケットでも表示できる', () => {
    const terminal = JIPM_BOARD.terminals.find((t) => t.id === socketPinTerminal('S8', 13));
    expect(terminal).toBeDefined();
    if (terminal === undefined) return;
    expect(socketTerminalLabel(undefined, terminal)).toBe('予備 ⑬ −');
  });

  it('ネジ端子は奥端・手前端の段付きティアに分かれる（§6.2）', () => {
    expect(socketRowExit(0)).toBe('rear');
    expect(socketRowExit(1)).toBe('rear');
    expect(socketRowExit(2)).toBe('front');
    expect(socketRowExit(3)).toBe('front');
  });

  it('差込穴は2列×7段で中央に並ぶ（§6.2）', () => {
    expect(socketPinHoleOffsets()).toHaveLength(14);
  });
});

describe('装着部品のラベル', () => {
  it('リレーは役割ID、タイマは設定秒を添える', () => {
    expect(mountedLabel('CR1', { kind: 'relay-my4n' })).toBe('CR1');
    expect(mountedLabel('T1', { kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 })).toBe(
      'T1 3.0s',
    );
  });
});

describe('盤の定義から描くこと', () => {
  it('ソケット・PL・PB・既設配線はすべて盤定義から取れる（数をハードコードしない根拠）', () => {
    expect(JIPM_BOARD.sockets.length).toBeGreaterThan(0);
    expect(JIPM_BOARD.lamps).toHaveLength(4);
    expect(JIPM_BOARD.pushButtons).toHaveLength(4);
    expect(JIPM_BOARD.fixedLinks.length).toBeGreaterThan(0);
    expect(JIPM_BOARD.console.rearHeightMm).toBeGreaterThan(JIPM_BOARD.console.frontHeightMm);
    expect(JIPM_BOARD.sockets.filter((s) => s.cluster === 'left')).toHaveLength(4);
    expect(JIPM_BOARD.sockets.filter((s) => s.cluster === 'right')).toHaveLength(4);
  });

  it('ソケットのピン配置は4段・各段4列で ④ が段4に混ざる（§6.2）', () => {
    expect(SOCKET_PIN_GRID).toHaveLength(4);
    expect(SOCKET_PIN_GRID[3]?.[0]).toBe(4);
  });
});

describe('secondsToMs', () => {
  it('10ms単位に丸める', () => {
    expect(secondsToMs(3.04)).toBe(3040);
    expect(secondsToMs(0.1)).toBe(100);
  });
});
```

- [ ] **Step 6: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/three/coords.ts` `apps/desktop/src/renderer/three/camera.ts` `apps/desktop/src/renderer/three/materials.ts` `apps/desktop/src/renderer/three/labels.ts` `apps/desktop/test/scene.test.ts`

```powershell
git add apps/desktop/src/renderer/three/coords.ts apps/desktop/src/renderer/three/camera.ts apps/desktop/src/renderer/three/materials.ts apps/desktop/src/renderer/three/labels.ts apps/desktop/test/scene.test.ts
git commit -m @'
feat(desktop): add 3d coordinate, camera and label primitives

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 10: 3D の盤（筐体・レール・ソケット・端子台・機器）

**Files:**
- Create: `apps/desktop/src/renderer/three/BoardPlate.tsx`, `DinRail.tsx`, `TerminalHit.tsx`, `Socket.tsx`, `TerminalBlock.tsx`, `Fixtures.tsx`, `Lamp.tsx`, `PushButton.tsx`, `MountedPart.tsx`

すべて `JIPM_BOARD` の寸法・座標・`bodyMm`・`footprints` から生成し、ソケット数も端子番号も配置もこの層ではハードコードしない。実物写真（`docs/reference/K96-CS3-board-photo.png`）の見た目に合わせる。


- [ ] **Step 1: `apps/desktop/src/renderer/three/BoardPlate.tsx` を書く**

```tsx
import type { BoardDefinition } from '@ojt/board-model';
import type { JSX } from 'react';
import { BOARD_PLATE_COLOR, CONSOLE_SIDE_COLOR } from '../session/colors.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';

/**
 * 盤の筐体（傾斜コンソール）。設計仕様 §6.5。
 * 実物は手前が低く奥が高い楔形の卓上コンソールで、盤面はその上面である。
 * 盤グループ全体を傾ける役は `BoardScene` が持ち、ここは盤面の板と、その下の筐体を描く。
 * 寸法はすべて `BoardDefinition`（`sizeMm` と `console`）から取り、ハードコードしない。
 */

/** レイキャストを受けない（空クリックが必ず「配線の取り消し」になるようにする）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 盤面の板の厚み[mm]。 */
const PLATE_THICKNESS_MM = 5;

/** 盤面と筐体。 */
export function BoardPlate({ board }: { board: BoardDefinition }): JSX.Element {
  const width = board.sizeMm.width;
  const height = board.sizeMm.height;
  const { frontHeightMm, rearHeightMm } = board.console;
  // 盤面の下に「奥ほど深い」箱を積んで楔形を作る。傾斜は盤グループの回転が担うので、
  // ここでは平均の高さを持つ箱を1つ置き、さらに奥側に立ち上がりを足す。
  const bodyHeight = (frontHeightMm + rearHeightMm) / 2;
  const riserHeight = rearHeightMm - frontHeightMm;
  const plate = sharedMaterial(BOARD_PLATE_COLOR, { metalness: 0.05, roughness: 0.65 });
  const side = sharedMaterial(CONSOLE_SIDE_COLOR, { metalness: 0.05, roughness: 0.8 });
  return (
    <group name="board-console">
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={plate}
        position={[0, 0, -PLATE_THICKNESS_MM / 2]}
        scale={[width, height, PLATE_THICKNESS_MM]}
        receiveShadow
      />
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={side}
        position={[0, 0, -PLATE_THICKNESS_MM - bodyHeight / 2]}
        scale={[width - 2, height - 2, bodyHeight]}
      />
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={side}
        position={[0, height / 2 - riserHeight / 4, -PLATE_THICKNESS_MM - bodyHeight - riserHeight / 4]}
        scale={[width - 2, riserHeight / 2, riserHeight / 2]}
      />
    </group>
  );
}
```

- [ ] **Step 2: `apps/desktop/src/renderer/three/DinRail.tsx` を書く**

```tsx
import type { BoardTerminal } from '@ojt/board-model';
import type { JSX } from 'react';
import { DIN_RAIL_COLOR } from '../session/colors.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';

/**
 * DINレール。設計仕様 §6.5（実物写真のとおり、ソケットと端子台はレール上に並ぶ）。
 * レールの位置と長さは「その上に載る機器の端子の外接矩形」から求めるので、
 * 盤定義に寸法を足さなくても機器の並びに追随する。
 */

/** レイキャストを受けない（空クリックが必ず「配線の取り消し」になるようにする）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** レールの幅（奥行方向）[mm]。TH35 相当。 */
const RAIL_WIDTH_MM = 35;
/** レールの厚み[mm]。 */
const RAIL_THICKNESS_MM = 2.5;
/** 左右の伸ばし代[mm]。 */
const RAIL_MARGIN_MM = 10;

/** 機器の端子群の下に1本のレールを敷く。端子が無ければ描かない。 */
export function DinRail({ terminals }: { terminals: readonly BoardTerminal[] }): JSX.Element | null {
  if (terminals.length === 0) return null;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const center = toScene({ x: (minX + maxX) / 2, y: centerY, z: RAIL_THICKNESS_MM / 2 });
  return (
    <mesh
      geometry={UNIT_BOX}
        raycast={noPick}
      material={sharedMaterial(DIN_RAIL_COLOR, { metalness: 0.75, roughness: 0.35 })}
      position={center}
      scale={[maxX - minX + RAIL_MARGIN_MM * 2, RAIL_WIDTH_MM, RAIL_THICKNESS_MM]}
    />
  );
}
```

- [ ] **Step 3: `apps/desktop/src/renderer/three/TerminalHit.tsx` を書く**

```tsx
import type { BoardTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import {
  TERMINAL_HOVER_COLOR,
  TERMINAL_PENDING_COLOR,
  TERMINAL_SCREW_COLOR,
} from '../session/colors.js';
import { PICK_GEOMETRY, SCREW_GEOMETRY, sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 端子1個（ネジ端子の見た目＋レイキャスト用の当たり判定球）。設計仕様 §6.5 / §8.2。
 * 当たり判定の半径は盤定義の `pickRadiusMm`（4mm）をそのまま使う。
 * ホバー中は `CR1 ⑨ COM` 形式のツールチップを `Html` で出す（§8.2）。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/**
 * 当たり判定の球を盤面から浮かせる量[mm]。
 * 端子台やソケットの筐体より必ず手前に来るようにして、端子のクリックが筐体に奪われないようにする。
 */
const PICK_LIFT_MM = 3;

/** ツールチップのラベル文字列を作る（役割名は盤定義の `label` をそのまま使う）。§8.2 */
export function terminalTooltip(terminal: BoardTerminal, roleLabel: string): string {
  return roleLabel.length > 0 ? roleLabel : terminal.label;
}

/** 端子1個。 */
export function TerminalHit({
  terminal,
  tooltip,
  hovered,
  pending,
  onHover,
  onPick,
}: {
  terminal: BoardTerminal;
  tooltip: string;
  hovered: boolean;
  pending: boolean;
  onHover: (id: TerminalId | undefined) => void;
  onPick: (terminal: BoardTerminal) => void;
}): JSX.Element {
  const pos = toScene(terminal.pos);
  const screwColor = pending
    ? TERMINAL_PENDING_COLOR
    : hovered
      ? TERMINAL_HOVER_COLOR
      : TERMINAL_SCREW_COLOR;
  return (
    <group position={pos}>
      <mesh
        geometry={SCREW_GEOMETRY}
        material={sharedMaterial(screwColor, { metalness: 0.7, roughness: 0.3 })}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh
        geometry={PICK_GEOMETRY}
        scale={terminal.pickRadiusMm}
        position={[0, 0, PICK_LIFT_MM]}
        visible={false}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHover(terminal.id);
        }}
        onPointerOut={() => {
          onHover(undefined);
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onPick(terminal);
        }}
      />
      {hovered ? (
        <Html center style={LABEL_STYLE} distanceFactor={260} position={[0, 6, 6]} zIndexRange={[20, 0]}>
          <span className="terminal-tooltip">{tooltip}</span>
        </Html>
      ) : null}
    </group>
  );
}
```

- [ ] **Step 4: `apps/desktop/src/renderer/three/Socket.tsx` を書く**

```tsx
import {
  roleLabel,
  socketPinHoleOffsets,
  type BoardTerminal,
  type SocketDefinition,
  type SocketId,
  type SocketRole,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { SOCKET_BODY_COLOR, SOCKET_LEVER_COLOR } from '../session/colors.js';
import { socketFaceTexture } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';
import { TerminalHit } from './TerminalHit.js';

/**
 * 14ピンソケット（PYF14A 相当）。設計仕様 §6.2 / §6.5。
 *
 * 実物は**差込穴が本体中央**（2列×7段）にあり、**ネジ端子は本体の奥端と手前端に段付きで2列ずつ**並ぶ
 * （奥ティア `[空]③②①` / `⑧⑦⑥⑤`、手前ティア `⑫⑪⑩⑨` / `④⑭⑬[空]`）。
 * 本体の外形は盤定義の `bodyMm`、端子の座標と印字は `board.terminals` の `pos` / `label` から取る。
 * 数も配置もこの層ではハードコードしないので、Plan 1B が配置を変えれば3Dも追随する。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** ネジ端子ティアの奥行[mm]（2段ぶん＋余白）。 */
const TIER_DEPTH_MM = 20;
/** ティアの高さ[mm]。 */
const TIER_HEIGHT_MM = 11;
/** 本体（差込領域）の高さ[mm]。 */
const BODY_HEIGHT_MM = 9;
/** 印字の板をネジの頭より上に浮かせる量[mm]（ネジに隠れないようにする）。 */
const LABEL_LIFT_MM = 2;
/** 保持レバーの幅[mm]。 */
const LEVER_WIDTH_MM = 4;
/** 差込穴の半径[mm]。 */
const PIN_HOLE_RADIUS_MM = 1;

/** レイキャストを受けない（クリックを下の本体・端子へ通す）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** ツールチップの文字列（`CR1 ⑨ COM`）。盤定義の印字に役割IDを足す。§8.2 */
export function socketTerminalLabel(role: SocketRole | undefined, terminal: BoardTerminal): string {
  // 盤定義のラベルは `S1 ⑨ COM`。物理ソケットIDを役割IDに置き換えて出す
  const parts = terminal.label.split(' ');
  const number = parts.at(-2) ?? terminal.label;
  return `${role ?? '予備'} ${number} ${roleLabel(terminal.role)}`;
}

/** ソケット1個（本体＋段付き端子ティア＋差込穴＋保持レバー＋印字）。 */
export function Socket({
  socket,
  role,
  occupied,
  terminals,
  hoveredTerminal,
  pendingTerminal,
  onHoverTerminal,
  onPickTerminal,
  onPickSocket,
}: {
  socket: SocketDefinition;
  role: SocketRole | undefined;
  occupied: boolean;
  terminals: readonly BoardTerminal[];
  hoveredTerminal: string | undefined;
  pendingTerminal: string | undefined;
  onHoverTerminal: (id: TerminalId | undefined) => void;
  onPickTerminal: (terminal: BoardTerminal) => void;
  onPickSocket: (socketId: SocketId, occupied: boolean) => void;
}): JSX.Element {
  const { width, length } = socket.bodyMm;
  const originX = socket.origin.x;
  const originY = socket.origin.y;
  const centerX = originX + width / 2;
  const centerY = originY + length / 2;

  const faceTexture = useMemo(
    () => socketFaceTexture(terminals, originX, originY, width, length),
    [terminals, originX, originY, width, length],
  );
  const holes = useMemo(() => socketPinHoleOffsets(), []);

  const bodyCenter = toScene({ x: centerX, y: centerY, z: BODY_HEIGHT_MM / 2 });

  return (
    <group name={`socket-${socket.id}`}>
      {/* 本体（中央の差込領域）。クリックで装着／取り外しUIを出す */}
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(SOCKET_BODY_COLOR, { roughness: 0.55, metalness: 0.1 })}
        position={bodyCenter}
        scale={[width, length, BODY_HEIGHT_MM]}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onPickSocket(socket.id, occupied);
        }}
      />
      {/* 差込穴（2列×7段。中央の差込領域に並ぶ） */}
      {holes.map((hole, index) => (
        <mesh
          key={`hole-${index}`}
          raycast={noPick}
          position={toScene({ x: originX + hole.dx, y: originY + hole.dy, z: BODY_HEIGHT_MM + 0.2 })}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[PIN_HOLE_RADIUS_MM, PIN_HOLE_RADIUS_MM, 0.5, 8]} />
          <meshStandardMaterial color="#0B0D10" roughness={0.9} />
        </mesh>
      ))}
      {/* 段付きの端子ティア（奥端・手前端） */}
      {[0, 1].map((index) => {
        const y = index === 0 ? originY + TIER_DEPTH_MM / 2 : originY + length - TIER_DEPTH_MM / 2;
        return (
          <mesh
            key={`tier-${index}`}
            geometry={UNIT_BOX}
            material={sharedMaterial(SOCKET_BODY_COLOR, { roughness: 0.5, metalness: 0.12 })}
            raycast={noPick}
            position={toScene({ x: centerX, y, z: TIER_HEIGHT_MM / 2 })}
            scale={[width, TIER_DEPTH_MM, TIER_HEIGHT_MM]}
          />
        );
      })}
      {/* 保持レバー（実物は黄色。中央の差込領域の両端） */}
      {[0, 1].map((index) => {
        const y =
          index === 0
            ? originY + TIER_DEPTH_MM + LEVER_WIDTH_MM
            : originY + length - TIER_DEPTH_MM - LEVER_WIDTH_MM;
        return (
          <mesh
            key={`lever-${index}`}
            geometry={UNIT_BOX}
            material={sharedMaterial(SOCKET_LEVER_COLOR, { roughness: 0.45 })}
            raycast={noPick}
            position={toScene({ x: centerX, y, z: BODY_HEIGHT_MM + 1 })}
            scale={[width * 0.6, LEVER_WIDTH_MM, 2.5]}
          />
        );
      })}
      {/* ネジ端子の番号と役割の印字（常時表示）。§6.2 */}
      {faceTexture === undefined ? null : (
        <mesh
          raycast={noPick}
          position={[bodyCenter[0], bodyCenter[1], TIER_HEIGHT_MM + LABEL_LIFT_MM]}
        >
          <planeGeometry args={[width, length]} />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={280}
        position={[bodyCenter[0], bodyCenter[1] + length / 2 + 5, TIER_HEIGHT_MM]}
        zIndexRange={[10, 0]}
      >
        <span className="socket-label">
          {role ?? '予備'}
          <small>{socket.id}</small>
        </span>
      </Html>
      {terminals.map((terminal) => (
        <TerminalHit
          key={terminal.id}
          terminal={terminal}
          tooltip={socketTerminalLabel(role, terminal)}
          hovered={hoveredTerminal === terminal.id}
          pending={pendingTerminal === terminal.id}
          onHover={onHoverTerminal}
          onPick={onPickTerminal}
        />
      ))}
    </group>
  );
}
```

- [ ] **Step 5: `apps/desktop/src/renderer/three/TerminalBlock.tsx` を書く**

```tsx
import type { BoardTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import { TERMINAL_BLOCK_CAP_COLOR, TERMINAL_BLOCK_COLOR } from '../session/colors.js';
import { blockFaceTexture } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';
import { TerminalHit } from './TerminalHit.js';

/**
 * 端子台（ランプ用8P・押ボタン用12P・P/N供給端子）。設計仕様 §6.1 / §6.5。
 * 端子の座標は盤定義から取り、台座は端子の外接矩形から自動で作るのでハードコードしない。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** 台座の余白[mm]。 */
const PAD_MM = 6;

/** 台座の最小の幅・奥行[mm]。端子が1〜2点しかない DC24V 端子台でも潰れないようにする。§6.1 */
const MIN_BODY_MM = 16;

/** 端子台の奥側カバーの奥行[mm]。 */
const CAP_DEPTH_MM = 9;

/** 印字の板をネジの頭より上に浮かせる量[mm]。 */
const LABEL_LIFT_MM = 1.4;

/** レイキャストを受けない（印字の板がクリックを奪わないようにする）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 端子台1個（台座＋端子＋ラベル）。 */
export function TerminalBlock({
  name,
  label,
  terminals,
  hoveredTerminal,
  pendingTerminal,
  onHoverTerminal,
  onPickTerminal,
}: {
  name: string;
  label: string;
  terminals: readonly BoardTerminal[];
  hoveredTerminal: string | undefined;
  pendingTerminal: string | undefined;
  onHoverTerminal: (id: TerminalId | undefined) => void;
  onPickTerminal: (terminal: BoardTerminal) => void;
}): JSX.Element | null {
  // 印字は端子台1個につきテクスチャ1枚にまとめる（labels.ts の方針）
  const faceTexture = useMemo(() => blockFaceTexture(terminals, PAD_MM), [terminals]);
  if (terminals.length === 0) return null;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const zs = terminals.map((t) => t.pos.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const height = Math.max(...zs);
  const center = toScene({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: height / 2 });
  const bodyWidth = Math.max(MIN_BODY_MM, maxX - minX + PAD_MM * 2);
  const bodyDepth = Math.max(MIN_BODY_MM, maxY - minY + PAD_MM * 2);
  return (
    <group name={`block-${name}`}>
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={sharedMaterial(TERMINAL_BLOCK_COLOR, { roughness: 0.7 })}
        position={center}
        scale={[bodyWidth, bodyDepth, height]}
      />
      {/* 端子の名前の印字（常時表示）。§6.4 */}
      {faceTexture === undefined ? null : (
        <mesh raycast={noPick} position={[center[0], center[1], height + LABEL_LIFT_MM]}>
          <planeGeometry args={[bodyWidth, bodyDepth]} />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
      {/* 端子台の奥側の黒いカバー（実物の見た目） */}
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={sharedMaterial(TERMINAL_BLOCK_CAP_COLOR, { roughness: 0.6 })}
        position={[center[0], center[1] + bodyDepth / 2 + CAP_DEPTH_MM / 2, height / 2]}
        scale={[bodyWidth, CAP_DEPTH_MM, height + 2]}
      />
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={320}
        position={[center[0], center[1] + bodyDepth / 2 + 4, height]}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{label}</span>
      </Html>
      {terminals.map((terminal) => (
        <TerminalHit
          key={terminal.id}
          terminal={terminal}
          tooltip={terminal.label}
          hovered={hoveredTerminal === terminal.id}
          pending={pendingTerminal === terminal.id}
          onHover={onHoverTerminal}
          onPick={onPickTerminal}
        />
      ))}
    </group>
  );
}
```

- [ ] **Step 6: `apps/desktop/src/renderer/three/Fixtures.tsx` を書く**

```tsx
import type { BoardTerminal } from '@ojt/board-model';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import { BREAKER_COLOR, SUPPLY_BLOCK_COLOR } from '../session/colors.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';

/**
 * 盤に固定された機器（DC24V電源・ブレーカ・電源スイッチ）。設計仕様 §6.1 / §6.5。
 * 実物写真では上段左に DC24V の端子台、上段右にブレーカが載る。
 * いずれも訓練者は配線できない（`wirable: false`）ので、当たり判定は持たせず見た目だけ描く。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** 機器の高さ[mm]。 */
const FIXTURE_HEIGHT_MM = 22;
/** 端子の外接矩形からの余白[mm]。 */
const FIXTURE_PAD_MM = 9;

/** レイキャストを受けない。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 固定機器1台（端子の外接矩形から箱を作る）。 */
export function Fixture({
  name,
  label,
  color,
  terminals,
}: {
  name: string;
  label: string;
  color: string;
  terminals: readonly BoardTerminal[];
}): JSX.Element | null {
  if (terminals.length === 0) return null;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const center = toScene({
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: FIXTURE_HEIGHT_MM / 2,
  });
  return (
    <group name={`fixture-${name}`}>
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(color, { roughness: 0.6, metalness: 0.15 })}
        raycast={noPick}
        position={center}
        scale={[maxX - minX + FIXTURE_PAD_MM * 2, maxY - minY + FIXTURE_PAD_MM * 2, FIXTURE_HEIGHT_MM]}
      />
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={320}
        position={[center[0], center[1], FIXTURE_HEIGHT_MM + 1]}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{label}</span>
      </Html>
    </group>
  );
}

/** 盤の固定機器（電源・ブレーカ・電源スイッチ）の定義。§6.4 の部品ID順。 */
export const FIXTURES: ReadonlyArray<{ id: string; label: string; color: string }> = [
  { id: 'PS', label: 'DC24V電源', color: SUPPLY_BLOCK_COLOR },
  { id: 'CB', label: 'ブレーカ', color: BREAKER_COLOR },
  { id: 'SW', label: '電源スイッチ', color: BREAKER_COLOR },
];
```

- [ ] **Step 7: `apps/desktop/src/renderer/three/Lamp.tsx` を書く**

```tsx
import type { LampDefinition } from '@ojt/board-model';
import type { LampLevel } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { CylinderGeometry, SphereGeometry } from 'three';
import { LAMP_COLORS, LAMP_EMISSIVE } from '../session/colors.js';
import { sharedMaterial, useLampMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 表示灯。設計仕様 §5.3.4 / §8.2。
 * 点灯は emissive を強く、暗点灯は弱く光らせる（接触不良による分圧を目で見せる。§9.2）。
 */

/** 表示灯の台座（盤面に埋め込まれたリング）。 */
const BEZEL = new CylinderGeometry(11, 11, 4, 24);
/** 表示灯のレンズ（半球）。 */
const LENS = new SphereGeometry(8.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);

/** 表示灯1個。 */
export function Lamp({
  definition,
  level,
}: {
  definition: LampDefinition;
  level: LampLevel;
}): JSX.Element {
  const pos = toScene({ ...definition.pos, z: 0 });
  const color = LAMP_COLORS[definition.id] ?? '#CCCCCC';
  const material = useLampMaterial(color, LAMP_EMISSIVE[level] ?? 0);
  return (
    <group position={pos} name={`pl-${definition.id}`}>
      <mesh
        geometry={BEZEL}
        material={sharedMaterial('#4C5157', { metalness: 0.6, roughness: 0.35 })}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 1]}
      />
      <mesh geometry={LENS} material={material} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 3]} />
      {level === 'off' ? null : (
        <pointLight
          color={color}
          intensity={level === 'lit' ? 900 : 200}
          distance={70}
          position={[0, 0, 14]}
        />
      )}
    </group>
  );
}
```

- [ ] **Step 8: `apps/desktop/src/renderer/three/PushButton.tsx` を書く**

```tsx
import type { PushButtonDefinition } from '@ojt/board-model';
import type { JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { CylinderGeometry } from 'three';
import { PUSH_BUTTON_COLORS } from '../session/colors.js';
import { sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 押ボタン（自動復帰型）。設計仕様 §5.3.3 / §8.2。
 * `mousedown` で `press`、`mouseup`（と領域外れ）で `release` を送る＝押しっぱなしで保持できる。
 */

/** 押ボタンの台座（φ22相当）。 */
const BEZEL = new CylinderGeometry(11, 11, 3, 24);
/** 押ボタンの頭。 */
const CAP = new CylinderGeometry(9, 9, 5, 24);

/** 押下時に沈む量[mm]。 */
const TRAVEL_MM = 2;

/** 押ボタン1個。 */
export function PushButton({
  definition,
  pressed,
  onPress,
  onRelease,
}: {
  definition: PushButtonDefinition;
  pressed: boolean;
  onPress: (pbId: string) => void;
  onRelease: (pbId: string) => void;
}): JSX.Element {
  const pos = toScene({ ...definition.pos, z: 0 });
  const color = PUSH_BUTTON_COLORS[definition.id] ?? '#888888';
  return (
    <group position={pos} name={`pb-${definition.id}`}>
      <mesh
        geometry={BEZEL}
        material={sharedMaterial('#4C5157', { metalness: 0.6, roughness: 0.35 })}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 1.5]}
      />
      <mesh
        geometry={CAP}
        material={sharedMaterial(color, { roughness: 0.4 })}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, pressed ? 4.5 - TRAVEL_MM : 4.5]}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onPress(definition.id);
        }}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onRelease(definition.id);
        }}
        onPointerOut={() => {
          if (pressed) onRelease(definition.id);
        }}
      />
    </group>
  );
}
```

- [ ] **Step 9: `apps/desktop/src/renderer/three/MountedPart.tsx` を書く**

```tsx
import type {
  MountedPart as MountedPartData,
  SocketDefinition,
  SocketRole,
} from '@ojt/board-model';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import { MeshStandardMaterial } from 'three';
import { RELAY_BODY_COLOR, TIMER_BODY_COLOR } from '../session/colors.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';

/**
 * ソケットに装着したリレー／タイマの本体。設計仕様 §8.2。
 * 箱形状＋ラベル。タイマは設定秒を本体に表示し、動作表示灯（MY4N相当）を頭に付ける。
 *
 * 実機ではネジ端子はソケットのフランジ上にあり部品に隠れないが、本アプリの盤モデル（§6.2）は
 * 端子を4段4列のグリッドに置くため、本体を不透明に描くと端子が隠れて配線できなくなる。
 * そこで本体は**半透明**で描き、**レイキャストの対象から外す**（`raycast` を空実装にする）。
 * 装着部品の選択・取り外しはソケット台座のクリックで行う（台座は本体より一回り大きい）。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** 本体の高さ[mm]（ソケット面からの突き出し）。 */
const BODY_HEIGHT_MM = 34;
/** 本体の余白[mm]（ソケット台座より一回り小さい）。 */
const BODY_INSET_MM = 2;
/** ネジ端子ティアを避けるため、奥行方向に余計に詰める量[mm]。 */
const SOCKET_TIER_MARGIN_MM = 18;
/** ソケット本体の上面の高さ[mm]（`Socket.tsx` の `BODY_HEIGHT_MM` と合わせる）。 */
const SOCKET_TOP_Z_MM = 9;
/** 本体の不透明度（下のネジ端子が見える程度）。 */
const BODY_OPACITY = 0.5;

/** レイキャストを受けない（クリックを下の端子へ通す）。 */
function noPick(): void {
  // 交差候補を1つも積まないので、この mesh はポインタイベントを拾わない
}

/** 装着部品の表示ラベル（`CR1` / `T1 3.0s`）。 */
export function mountedLabel(role: SocketRole, part: MountedPartData): string {
  return part.kind === 'relay-my4n' ? role : `${role} ${(part.presetMs / 1000).toFixed(1)}s`;
}

/** 装着部品1個。 */
export function MountedPart({
  socket,
  role,
  part,
  energized,
}: {
  socket: SocketDefinition;
  role: SocketRole;
  part: MountedPartData;
  energized: boolean;
}): JSX.Element {
  // 部品の外形はソケット本体（`bodyMm`）から作る。ソケットの差込領域に載る大きさ。
  const width = socket.bodyMm.width - BODY_INSET_MM * 2;
  const height = socket.bodyMm.length - BODY_INSET_MM * 2 - SOCKET_TIER_MARGIN_MM * 2;
  const center = toScene({
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: SOCKET_TOP_Z_MM + BODY_HEIGHT_MM / 2,
  });
  const bodyColor = part.kind === 'relay-my4n' ? RELAY_BODY_COLOR : TIMER_BODY_COLOR;
  const bodyMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: bodyColor,
        transparent: true,
        opacity: BODY_OPACITY,
        roughness: 0.5,
        metalness: 0.2,
        depthWrite: false,
      }),
    [bodyColor],
  );
  return (
    <group name={`mounted-${socket.id}`}>
      <mesh
        geometry={UNIT_BOX}
        material={bodyMaterial}
        raycast={noPick}
        position={center}
        scale={[width, height, BODY_HEIGHT_MM]}
      />
      {/* 動作表示灯（励磁中は赤く光る。MY4N の動作表示相当。§8.2） */}
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={
          energized
            ? sharedMaterial('#FF3B30', { emissive: '#FF3B30', emissiveIntensity: 2.2 })
            : sharedMaterial('#5B2020', { roughness: 0.6 })
        }
        position={[
          center[0] + width / 2 - 5,
          center[1] + height / 2 - 5,
          SOCKET_TOP_Z_MM + BODY_HEIGHT_MM + 0.4,
        ]}
        scale={[6, 4, 1.2]}
      />
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={300}
        position={[center[0], center[1] - height / 2 - 5, SOCKET_TOP_Z_MM + BODY_HEIGHT_MM]}
        zIndexRange={[12, 0]}
      >
        <span className={part.kind === 'relay-my4n' ? 'part-label' : 'part-label timer'}>
          {mountedLabel(role, part)}
        </span>
      </Html>
    </group>
  );
}
```

- [ ] **Step 10: Task 9 のテストが通ることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop test -- scene
```

期待出力:

```text
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

- [ ] **Step 11: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/three`

```powershell
git add apps/desktop/src/renderer/three
git commit -m @'
feat(desktop): draw the jipm board in 3d from the board definition

傾斜コンソール・左右4個ずつのソケット・段付き端子ティア・端子の印字を実物写真に合わせる。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 11: 電線・既設配線と経路の検証

**Files:**
- Create: `apps/desktop/src/renderer/three/Wire.tsx`, `apps/desktop/src/renderer/three/FixedWires.tsx`
- Test: `apps/desktop/test/routing.test.ts`

仕様 §6.6 は「電線は端子間を直角に走り、部品の占有矩形を跨がない」ことを求める。経路の生成は Plan 1B の `routeWire()` が担うので、この層は**返ってきた折れ線をそのまま描く**（勝手に曲線で丸め直さない）。「配線がリレーやタイマの上を通らない」ことは見た目の問題ではないので、純粋関数のテストで担保する。

経路器の実装（Plan 1B）で決まっている約束のうち、この層が守らなければならないのは3つ。

1. **高さは経路器が決める**。走行高さは `WIRE_Z_LADDER_MM = [2.4, 4.2, 6.0, 7.8]` の段だけを取り（x方向の走りは段0・2、y方向は段1・3、レイヤは `runZ(axis, layer)`）、高さの変わる角には `z` だけ動く点が挿入されている。描画側で z を足したり丸めたりすると直角経路が壊れるので**一切計算しない**。`WIRE_RUN_Z_MM` は `@deprecated` の別名（＝2.4）なので、「全部の走りが同じ高さ」という前提のコードは書かない。
2. **描くのは `points` だけ**。`WireRoute.lanes[i].span` は帯の占有記録（レーンずらしを掛ける前の節点座標）で、描画用の座標ではない。`channelSpans` という項目は**無い**。
3. **`laneOverflow` を必ず見せる**。帯のスロット（レーン8 × レイヤ2 ＝ 16）が埋まると経路器は投げずに他の電線と同じスロットへ載せ、`laneOverflow: true` を立てる。これが「2本が重なって1本に見えている」ことを知る唯一の手がかりなので、3Dで琥珀色に変えて知らせる。


- [ ] **Step 1: `apps/desktop/src/renderer/three/Wire.tsx` を書く**

```tsx
import { WIRE_DIAMETER_MM, type WireRoute } from '@ojt/board-model';
import type { WireColor } from '@ojt/circuit-sim';
import { useMemo, type JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import {
  LOCKED_RING_COLOR,
  LUG_COLOR,
  WIRE_COLORS,
  WIRE_LANE_OVERFLOW_COLOR,
  WIRE_SELECTED_COLOR,
} from '../session/colors.js';
import { LUG_GEOMETRY, sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 電線。設計仕様 §6.6 / §8.2。
 * `routeWire()` が返す**直角経路の折れ線**（角はフィレット済み）を `TubeGeometry`（半径0.8mm）で
 * 描き、両端に Y型圧着端子の簡易形状（輪）を付ける。色は青／白／黄の物理色。
 *
 * 高さは経路器が `WIRE_Z_LADDER_MM` の段（x方向は 2.4 / 6.0、y方向は 4.2 / 7.8）で決めてあり、
 * 高さの変わる角には `z` だけ動く点が入っている。**ここで z を足したり丸めたりしない**
 * （直角経路が壊れ、直交する電線どうしが食い込む）。`lanes[i].span` は帯の占有記録なので
 * 描画には使わない。
 *
 * ピックは**削除モードのときだけ**受ける。配線モードでは端子より手前を通る電線が
 * 端子のクリックを奪ってしまい、配線できない端子が出るため（§8.2 の操作性を優先）。
 */

/** チューブの半径[mm]（描画直径 1.6mm の半分。§6.6）。 */
export const WIRE_RADIUS_MM = WIRE_DIAMETER_MM / 2;
/** チューブの分割数（1セグメントあたり）。 */
const SEGMENTS_PER_POINT = 4;
/** 断面の分割数。 */
const RADIAL_SEGMENTS = 6;

/** レイキャストを受けない（配線モードで端子のクリックを奪わないため）。 */
function noPick(): void {
  // 交差候補を積まない
}

/**
 * 電線の胴体の色（純粋関数。テストで固定する）。§6.3 / §6.6 / §8.2
 * 優先順位は 選択中 → 既設配線（データ上の色が何であれ実物どおり青）→ レーン重なり → 物理色。
 * `laneOverflow` は「他の電線と同じ配線位置に載った」ことの唯一の手がかりなので、
 * 琥珀色にして訓練者が2本を1本と見誤らないようにする。
 */
export function wireBodyColor(
  route: WireRoute,
  color: WireColor,
  locked: boolean,
  selected: boolean,
): string {
  if (selected) return WIRE_SELECTED_COLOR;
  if (locked) return WIRE_COLORS['青'];
  if (route.laneOverflow) return WIRE_LANE_OVERFLOW_COLOR;
  return WIRE_COLORS[color];
}

/**
 * 経路から `TubeGeometry` を作る（純粋関数。メモ化して使う）。
 * `routeWire()` が角をフィレット済みの折れ線で返すので、ここでは曲線で丸め直さず
 * **点をそのまま通す**（`curveType: 'catmullrom'` の `tension: 0` ＝ 直線補間）。
 * 勝手に丸めると直角配線の「整列して見える」利点が失われるため。
 */
export function buildTubeGeometry(route: WireRoute): TubeGeometry {
  const points = route.points.map((p) => {
    const [x, y, z] = toScene(p);
    return new Vector3(x, y, z);
  });
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0);
  const segments = Math.max(8, points.length * SEGMENTS_PER_POINT);
  return new TubeGeometry(curve, segments, WIRE_RADIUS_MM, RADIAL_SEGMENTS, false);
}

/** 電線1本。 */
export function Wire({
  route,
  color,
  locked,
  selected,
  pickable,
  onPick,
}: {
  route: WireRoute;
  color: WireColor;
  locked: boolean;
  selected: boolean;
  /** 削除モードのときだけ true。§8.2 */
  pickable: boolean;
  onPick: (wireId: string) => void;
}): JSX.Element | null {
  const geometry = useMemo(() => buildTubeGeometry(route), [route]);
  const ends = useMemo(() => {
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    return first === undefined || last === undefined ? [] : [toScene(first), toScene(last)];
  }, [route]);
  if (route.points.length < 2) return null;
  const material = sharedMaterial(wireBodyColor(route, color, locked, selected), {
    roughness: locked ? 0.35 : 0.55,
    metalness: 0.05,
  });
  return (
    <group
      name={`wire-${route.wireId}`}
      userData={{ kind: route.kind, laneOverflow: route.laneOverflow }}
    >
      <mesh
        geometry={geometry}
        material={material}
        {...(pickable ? {} : { raycast: noPick })}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onPick(route.wireId);
        }}
      />
      {ends.map((pos, index) => (
        <mesh
          key={`${route.wireId}-lug-${index}`}
          geometry={LUG_GEOMETRY}
          material={sharedMaterial(locked ? LOCKED_RING_COLOR : LUG_COLOR, {
            metalness: 0.8,
            roughness: 0.3,
          })}
          raycast={noPick}
          position={pos}
          rotation={[Math.PI / 2, 0, 0]}
          scale={locked ? 1.25 : 1}
        />
      ))}
    </group>
  );
}
```

- [ ] **Step 2: `apps/desktop/src/renderer/three/FixedWires.tsx` を書く**

```tsx
import { routeFixedLinks, type BoardDefinition } from '@ojt/board-model';
import { useMemo, type JSX } from 'react';
import { PANEL_HOLE_COLOR, WIRE_COLORS } from '../session/colors.js';
import { toScene } from './coords.js';
import { sharedMaterial } from './materials.js';
import { buildTubeGeometry } from './Wire.js';

/**
 * 既設配線（端子台 → 各表示灯・押ボタン）。設計仕様 §6.4 / §6.5。
 *
 * 実物の写真では、端子台の各端子から**機器の真上をまっすぐ平行に降りた青い線**が、
 * 機器の奥側の根元にある盤面の貫通穴へ入り、そこから裏側の本体端子へつながっている。
 * 経路は `routeFixedLinks()`（Plan 1B）が返すものをそのまま描き、`throughPanelAt` に
 * 小さな黒い穴を描いて「ここで盤の裏へ抜ける」ことを示す。機器の表面や中心には結ばない。
 * 訓練者は触れないので当たり判定も持たせない。
 */

/** 既設配線の色（実物どおり青。§4.2） */
const FIXED_LINK_COLOR = WIRE_COLORS['青'];
/** 盤面の貫通穴の半径[mm]。 */
const PANEL_HOLE_RADIUS_MM = 2.4;

/** レイキャストを受けない（クリックを下の端子へ通す）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 既設配線と、その行き先の盤面の貫通穴をまとめて描く。 */
export function FixedWires({ board }: { board: BoardDefinition }): JSX.Element {
  const routes = useMemo(() => routeFixedLinks(board), [board]);
  const geometries = useMemo(
    () => routes.map((route) => ({ id: route.wireId, geometry: buildTubeGeometry(route) })),
    [routes],
  );
  const holes = useMemo(
    () =>
      routes
        .map((route) => route.throughPanelAt)
        .filter((hole): hole is NonNullable<typeof hole> => hole !== undefined),
    [routes],
  );
  const material = sharedMaterial(FIXED_LINK_COLOR, { roughness: 0.5, metalness: 0.05 });

  return (
    <group name="fixed-wires">
      {geometries.map((entry) => (
        <mesh key={entry.id} geometry={entry.geometry} material={material} raycast={noPick} />
      ))}
      {holes.map((hole, index) => (
        <mesh
          key={`hole-${index}`}
          raycast={noPick}
          position={toScene({ x: hole.x, y: hole.y, z: 0.3 })}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[PANEL_HOLE_RADIUS_MM, PANEL_HOLE_RADIUS_MM, 0.6, 12]} />
          <meshStandardMaterial color={PANEL_HOLE_COLOR} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
```

- [ ] **Step 3: `apps/desktop/test/routing.test.ts` を書く**

```ts
import {
  channelsClearOfFootprints,
  createSession,
  crossesFootprint,
  crossingFootprint,
  isManhattan,
  JIPM_BOARD,
  routeFixedLinks,
  routeSession,
  routeWire,
  RoutingError,
  TASK2_SOCKET_ROLES,
  toPhysicalTerminal,
  validateBoard,
  WIRE_Z_LADDER_MM,
  type WireRoute,
} from '@ojt/board-model';
import { createWire, toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { runAddWire } from '../src/renderer/session/commands.js';
import { wireBodyColor } from '../src/renderer/three/Wire.js';
import { WIRE_COLORS, WIRE_LANE_OVERFLOW_COLOR } from '../src/renderer/session/colors.js';

/**
 * 配線経路の検証（§6.6）。
 * 「電線がリレー／タイマの上を通らないこと」は3Dの見た目の問題ではなく、
 * 実機ではあり得ない配線を訓練者に見せないための要件なので、純粋関数のテストで担保する。
 */

function session() {
  return createSession(JIPM_BOARD, { roles: TASK2_SOCKET_ROLES, allowedColors: ['青'] });
}

/**
 * 折れ点に出てよい高さ[mm]。走行高さは `WIRE_Z_LADDER_MM` の段だけ、
 * それ以外は端子の高さ（ソケット10・端子台8・本体−12・供給6）と盤面0（既設ハーネスの貫通）。
 * 「どこかに 2.4mm の折れ点がある」ではなく**この集合に収まっている**ことを見る
 * （純y方向の渡り線のように 2.4 を1度も通らない経路があるため）。
 */
const ALLOWED_CORNER_Z = new Set<number>([
  ...WIRE_Z_LADDER_MM,
  ...JIPM_BOARD.terminals.map((t) => t.pos.z),
  0,
]);

/** はしごの段から外れた折れ点（足し算のずれもここで落ちる）。 */
function strayCorners(route: WireRoute): string[] {
  return route.corners
    .filter((p) => !ALLOWED_CORNER_Z.has(p.z))
    .map((p) => `${route.wireId} z=${p.z}`);
}

describe('部品の占有矩形（§6.6）', () => {
  it('盤定義がソケット・端子台・機器の占有矩形を持つ', () => {
    expect(JIPM_BOARD.footprints.length).toBeGreaterThanOrEqual(JIPM_BOARD.sockets.length);
    expect(JIPM_BOARD.footprints.some((f) => f.kind === 'socket')).toBe(true);
  });

  it('配線帯は占有矩形と重ならない位置にある', () => {
    expect(JIPM_BOARD.wiringChannels.length).toBeGreaterThan(0);
    // 帯はレーン8本ぶんの幅を持つ（`channelBandRect`）。その帯が部品に被っていたら経路器が破綻する
    expect(channelsClearOfFootprints(JIPM_BOARD)).toEqual([]);
    expect(validateBoard(JIPM_BOARD)).toEqual([]);
  });
});

describe('routeWire（直角配線・部品回避）', () => {
  it('端子から立ち上げて配線帯の高さを走り、折れ点は直角になる', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-1', from: toTerminalId('P.1'), to: toTerminalId('S1.10') },
      [],
    );
    expect(route.kind).toBe('channel');
    // 走行高さは経路器が決める（x方向は 2.4 / 6.0、y方向は 4.2 / 7.8）。描画側は計算しない
    expect(strayCorners(route)).toEqual([]);
    expect(route.corners.some((p) => (WIRE_Z_LADDER_MM as readonly number[]).includes(p.z))).toBe(
      true,
    );
    expect(isManhattan(route.corners)).toBe(true);
    expect(crossesFootprint(JIPM_BOARD, route)).toBe(false);
  });

  it('純粋にy方向だけ渡る経路は x方向の段（2.4mm）を1度も通らない', () => {
    // 「どこかに 2.4mm がある」という決め打ちの検査が成り立たないことの担保（§6.6）
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-0', from: toTerminalId('P.1'), to: toTerminalId('N.1') },
      [],
    );
    expect(route.kind).toBe('direct');
    expect(route.corners.every((p) => p.z !== WIRE_Z_LADDER_MM[0])).toBe(true);
    expect(strayCorners(route)).toEqual([]);
  });

  it('ソケットをまたぐ配線でも部品の上を通らない', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-2', from: toTerminalId('S1.9'), to: toTerminalId('S4.13') },
      [],
    );
    expect(crossesFootprint(JIPM_BOARD, route)).toBe(false);
  });

  it('左クラスタから右クラスタへ渡る配線も部品の上を通らない', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-3', from: toTerminalId('S1.14') , to: toTerminalId('S8.13') },
      [],
    );
    expect(crossesFootprint(JIPM_BOARD, route)).toBe(false);
  });

  it('端子台からソケットへ渡る配線も部品の上を通らない', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-4', from: toTerminalId('TB_PB.1a'), to: toTerminalId('S2.5') },
      [],
    );
    expect(crossesFootprint(JIPM_BOARD, route)).toBe(false);
  });

  it('束になる電線はレーンがずれて並走する', () => {
    const first = routeWire(
      JIPM_BOARD,
      { id: 'w-5', from: toTerminalId('TB_PB.1c'), to: toTerminalId('S1.14') },
      [],
    );
    const second = routeWire(
      JIPM_BOARD,
      { id: 'w-6', from: toTerminalId('TB_PB.1c'), to: toTerminalId('S2.14') },
      [first],
    );
    expect(second.lane).toBeGreaterThan(first.lane);
    expect(isManhattan(second.corners)).toBe(true);
  });

  it('角はフィレットで丸められ、点が増える', () => {
    const route = routeWire(
      JIPM_BOARD,
      { id: 'w-7', from: toTerminalId('P.1'), to: toTerminalId('TB_PL.1+') },
      [],
    );
    expect(route.points.length).toBeGreaterThan(6);
  });
});

describe('配線操作の結果の経路（§6.6 / §8.2）', () => {
  it('模範回路ぶんの配線をすべて張っても、どの経路も部品の上を通らない', () => {
    const board = session();
    // P/N は各1点しかないので母線は渡り配線で分配する（§6.1）
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['P.1', 'TB_PB.2c'],
      ['TB_PB.2c', 'CR1.10'],
      ['TB_PB.2b', 'TB_PB.1c'],
      ['TB_PB.1c', 'CR1.9'],
      ['TB_PB.1a', 'CR1.14'],
      ['CR1.14', 'CR1.5'],
      ['N.1', 'CR1.13'],
      ['CR1.13', 'TB_PL.1-'],
      ['CR1.6', 'TB_PL.1+'],
    ];
    for (const [from, to] of pairs) {
      const result = runAddWire(board, toTerminalId(from), toTerminalId(to), '青');
      expect(result.ok, `${from} — ${to}`).toBe(true);
    }
    const routes = routeSession(JIPM_BOARD, board);
    expect(routes.length).toBe(board.wires.length);
    for (const route of routes) {
      expect(crossingFootprint(JIPM_BOARD, route)?.id, route.wireId).toBeUndefined();
      expect(isManhattan(route.corners), route.wireId).toBe(true);
      expect(strayCorners(route)).toEqual([]);
      // 模範回路ぶんではスロットが余るので重なりは起きない（§6.6）
      expect(route.laneOverflow, route.wireId).toBe(false);
    }
  });

  it('既設配線（端子台 → 機器の根元の穴）の経路も部品の上を通らない', () => {
    const routes = routeFixedLinks(JIPM_BOARD);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(crossesFootprint(JIPM_BOARD, route), route.wireId).toBe(false);
      // 盤面を貫通する位置（機器の根元の穴）を持つ
      expect(route.throughPanelAt, route.wireId).toBeDefined();
    }
  });

  it('役割IDの端子でも物理IDに直してから経路を求める', () => {
    const board = session();
    const physical = toPhysicalTerminal(board.socketRoles, toTerminalId('CR1.13'));
    expect(physical).toBe('S1.13');
  });
});

describe('経路器の失敗と重なりの扱い（§6.6）', () => {
  it('盤に無い端子は RoutingError（電線IDと理由が付く）', () => {
    let caught: RoutingError | undefined;
    try {
      routeWire(
        JIPM_BOARD,
        { id: 'w-bad', from: toTerminalId('ZZ.1'), to: toTerminalId('P.1') },
        [],
      );
    } catch (error) {
      caught = error instanceof RoutingError ? error : undefined;
    }
    expect(caught?.wireId).toBe('w-bad');
    expect(caught?.reason).toBe('invalid-terminal');
  });

  it('routeSession は全か無かで、1本でも失敗すれば投げる', () => {
    const board = session();
    board.wires.push(createWire('w-bad', toTerminalId('ZZ.1'), toTerminalId('P.1'), '青', false));
    expect(() => routeSession(JIPM_BOARD, board)).toThrow(RoutingError);
  });

  it('レーンが重なった電線は琥珀色で描く（重なりを知る唯一の手がかり）', () => {
    const normal = routeWire(
      JIPM_BOARD,
      { id: 'w-9', from: toTerminalId('TB_PB.1c'), to: toTerminalId('S1.14') },
      [],
    );
    expect(normal.laneOverflow).toBe(false);
    expect(wireBodyColor(normal, '青', false, false)).toBe(WIRE_COLORS['青']);
    const crowded: WireRoute = { ...normal, laneOverflow: true };
    expect(wireBodyColor(crowded, '青', false, false)).toBe(WIRE_LANE_OVERFLOW_COLOR);
    // 既設配線と選択中は重なりより優先する
    expect(wireBodyColor(crowded, '黄', true, false)).toBe(WIRE_COLORS['青']);
  });
});
```

- [ ] **Step 4: テストを実行する**

実行:

```powershell
pnpm --filter @ojt/desktop test -- routing
```

期待出力:

```text
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

- [ ] **Step 5: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/three/Wire.tsx` `apps/desktop/src/renderer/three/FixedWires.tsx` `apps/desktop/test/routing.test.ts`

```powershell
git add apps/desktop/src/renderer/three/Wire.tsx apps/desktop/src/renderer/three/FixedWires.tsx apps/desktop/test/routing.test.ts
git commit -m @'
feat(desktop): draw orthogonal wires and fixed harness

経路器が返す直角経路をそのまま描き、部品の上を跨がないことをテストで担保する。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 12: 3Dシーンの組み立てと視点

**Files:**
- Create: `apps/desktop/src/renderer/three/CameraPresets.tsx`, `apps/desktop/src/renderer/three/ViewGizmo.tsx`, `apps/desktop/src/renderer/three/BoardScene.tsx`

**性能方針（§15: 内蔵GPUで60fps）**: `frameloop="demand"` にして状態が変わったときだけ描く。盤の静的ジオメトリはマテリアルとジオメトリを共有し、電線の `TubeGeometry` は `WireRoute` 単位でメモ化する。`OrbitControls` のダンピングとビューキューブのアニメーション中もフレームが要るので、`ViewGizmo` が 30fps で `invalidate()` を回す。


- [ ] **Step 1: `apps/desktop/src/renderer/three/CameraPresets.tsx` を書く**

```tsx
import { useThree } from '@react-three/fiber';
import { useEffect, type JSX } from 'react';
import type { CameraPreset } from '../app/store-types.js';
import { cameraPose } from './camera.js';

/**
 * 視点プリセットの適用。設計仕様 §12.2。
 * 位置・注視点・上方向の計算は `camera.ts`（純粋関数）に置き、ここは three への反映だけを行う。
 * 盤は傾斜コンソールなので、面直視（正面・ソケット拡大）ではカメラの上方向も盤面に合わせて
 * 変える（既定の `(0,1,0)` のままだと視線とほぼ平行になり画が回ってしまう）。
 */

/** `OrbitControls` のうちこの層が使う部分。 */
export interface ControlsLike {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

/** プリセットが変わったらカメラと OrbitControls の注視点を動かす。 */
export function CameraPresets({
  preset,
  controls,
}: {
  preset: CameraPreset;
  controls: ControlsLike | null;
}): JSX.Element | null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const pose = cameraPose(preset);
    camera.up.set(...pose.up);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    if (controls !== null) {
      controls.target.set(...pose.target);
      controls.update();
    }
    camera.updateProjectionMatrix();
    invalidate();
  }, [preset, camera, controls, invalidate]);
  return null;
}
```

- [ ] **Step 2: `apps/desktop/src/renderer/three/ViewGizmo.tsx` を書く**

```tsx
import { GizmoHelper, GizmoViewcube } from '@react-three/drei';
import type { JSX } from 'react';

/**
 * 視点ギズモ（Blender のビューキューブ相当）。設計仕様 §12.2。
 *
 * 3Dの回転はマウスドラッグだけだと「いまどちらを向いているか」が分からなくなるため、
 * 画面左上に小さなキューブを常設し、面をクリックするとその方向へカメラをスナップさせる。
 * 面ラベルは日本語（前／後／左／右／上／下）にする。
 *
 * `frameloop="demand"` と組み合わせる。ギズモのスナップや OrbitControls の操作で
 * カメラが動く間のフレームは、`OrbitControls` の `onChange` と drei 側の `invalidate()` が要求する。
 * ここで一定間隔の `invalidate()` を回してはいけない（常時再描画になり `frameloop="demand"` の
 * 意味が無くなるうえ、ソフトウェアラスタライザの環境では描画がメインスレッドを占有してしまう）。
 */

/** キューブの面ラベル（日本語）。§15 の文言方針にあわせる。 */
export const GIZMO_FACES = {
  right: '右',
  left: '左',
  top: '上',
  bottom: '下',
  front: '前',
  back: '後',
} as const;

/** ギズモの1辺の大きさ[px]。 */
const GIZMO_SIZE = 92;
/** ビューポートの角からの余白[px]。盤の左上と重ならない値。 */
const GIZMO_MARGIN: [number, number] = [76, 76];

/** 左上のビューキューブ。 */
export function ViewGizmo(): JSX.Element {
  return (
    <GizmoHelper alignment="top-left" margin={GIZMO_MARGIN} renderPriority={1}>
      <GizmoViewcube
        faces={[
          GIZMO_FACES.right,
          GIZMO_FACES.left,
          GIZMO_FACES.top,
          GIZMO_FACES.bottom,
          GIZMO_FACES.front,
          GIZMO_FACES.back,
        ]}
        color="#E6E4DE"
        textColor="#1B1E23"
        strokeColor="#39D0FF"
        hoverColor="#39D0FF"
        opacity={0.95}
        {...({ scale: [GIZMO_SIZE, GIZMO_SIZE, GIZMO_SIZE] } as Record<string, unknown>)}
      />
    </GizmoHelper>
  );
}
```

- [ ] **Step 3: `apps/desktop/src/renderer/three/BoardScene.tsx` を書く**

```tsx
import {
  JIPM_BOARD,
  routeSession,
  routeWire,
  RoutingError,
  toPhysicalTerminal,
  type BoardDefinition,
  type BoardSession,
  type BoardTerminal,
  type SocketId,
  type WireRoute,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { MOUSE } from 'three';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useStore, type AppState } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import type { PickHit } from '../session/interaction.js';
import { BoardPlate } from './BoardPlate.js';
import { BOARD_TILT_RAD, CAMERA_FOV_DEG } from './camera.js';
import { CameraPresets, type ControlsLike } from './CameraPresets.js';
import { DinRail } from './DinRail.js';
import { FixedWires } from './FixedWires.js';
import { Fixture, FIXTURES } from './Fixtures.js';
import { Lamp } from './Lamp.js';
import { MountedPart } from './MountedPart.js';
import { PushButton } from './PushButton.js';
import { Socket } from './Socket.js';
import { TerminalBlock } from './TerminalBlock.js';
import { ViewGizmo } from './ViewGizmo.js';
import { Wire } from './Wire.js';

/**
 * 3D盤のシーン。設計仕様 §6.5 / §8.1 / §12.2 / §15。
 *
 * 性能方針（§15: 内蔵GPUで60fps）:
 * - `frameloop="demand"` にして、状態が変わったときだけ描く。OrbitControls の操作中は
 *   drei 側が `invalidate()` を呼ぶので、何もしていない間は 0fps になる。
 * - 盤の静的ジオメトリ（板・ダクト・ソケット台座・端子）はマテリアルとジオメトリを共有し、
 *   電線の `TubeGeometry` は経路オブジェクト単位でメモ化する。
 */


/** カメラが盤へ寄れる最短距離[mm]（端子の印字が読める程度まで）。§12.2 */
const MIN_CAMERA_DISTANCE_MM = 90;
/** カメラが離れられる最長距離[mm]。 */
const MAX_CAMERA_DISTANCE_MM = 1200;
/** 仰角の上限（盤の裏側へ回り込ませない）。§12.2 */
const MAX_POLAR_ANGLE = Math.PI * 0.48;

/**
 * 端子台として描くまとまり。§6.4
 * P/N 供給端子は `P.1` / `N.1` の各1点しかない（§6.1）ので、
 * 実物写真の DC24V 端子と同じく**2端子の小さな端子台1個**としてまとめて描く。
 */
const BLOCK_PARTS: ReadonlyArray<{ key: string; ids: readonly string[]; label: string }> = [
  { key: 'TB_PL', ids: ['TB_PL'], label: 'ランプ用端子台' },
  { key: 'TB_PB', ids: ['TB_PB'], label: '押ボタン用端子台' },
  { key: 'PN', ids: ['P', 'N'], label: 'DC24V端子台' },
];

/** DINレールを敷く機器のまとまり（ソケット群と端子台群）。実物写真のとおり。§6.5 */
const RAIL_GROUPS: readonly string[][] = [['TB_PL'], ['TB_PB'], ['P', 'N']];

/**
 * セッションの全電線の経路（純粋関数。テストで固定する）。§6.6
 *
 * `routeSession()` は**全か無か**で、1本でも解けなければ `RoutingError` を投げる。
 * React のレンダー中に投げるとシーンごと落ちて盤が消えてしまうので、ここで受け止めて
 * ①解けた電線だけを描き、②解けなかった電線のIDと理由を返す（セッションの状態は変えない）。
 * 出荷する盤（`JIPM_BOARD`）では起こらないはずだが、起こったときに黒い画面ではなく
 * 「どの電線がなぜ描けないか」を出せるようにしておく。
 */
export function safeRoutes(
  board: BoardDefinition,
  session: BoardSession | undefined,
): { routes: WireRoute[]; errors: RoutingError[] } {
  if (session === undefined) return { routes: [], errors: [] };
  try {
    return { routes: routeSession(board, session), errors: [] };
  } catch (error) {
    if (!(error instanceof RoutingError)) throw error;
  }
  const routes: WireRoute[] = [];
  const errors: RoutingError[] = [];
  for (const wire of session.wires) {
    try {
      routes.push(
        routeWire(
          board,
          {
            id: wire.id,
            from: toPhysicalTerminal(session.socketRoles, wire.from),
            to: toPhysicalTerminal(session.socketRoles, wire.to),
          },
          routes,
        ),
      );
    } catch (error) {
      if (!(error instanceof RoutingError)) throw error;
      errors.push(error);
    }
  }
  return { routes, errors };
}

/**
 * 見た目が変わったときだけ再描画を要求する。§15
 *
 * Worker のスナップショットは約30fpsで届くが、その大半は「電圧の小数点以下が動いただけ」で
 * 3Dの絵は1ピクセルも変わらない。毎回 `invalidate()` すると `frameloop="demand"` が
 * 実質 30fps の常時描画になり、ソフトウェアラスタライザの環境ではメインスレッドを占有して
 * クリックすら受け付けなくなる。そこで**描き分けに効く値だけ**から署名を作って比べる。
 */
function visualSignature(state: AppState): string {
  const { snapshot, session } = state;
  const lamps = Object.entries(snapshot.lamps)
    .map(([id, lamp]) => `${id}:${lamp.level}`)
    .join(',');
  const relays = Object.entries(snapshot.relays)
    .map(([id, relay]) => `${id}:${relay.coilOn ? 1 : 0}`)
    .join(',');
  const timers = Object.entries(snapshot.timers)
    .map(([id, t]) => `${id}:${t.powered ? 1 : 0}${t.timedOut ? 1 : 0}`)
    .join(',');
  const buttons = Object.entries(snapshot.buttons)
    .map(([id, pressed]) => `${id}:${pressed ? 1 : 0}`)
    .join(',');
  return [
    lamps,
    relays,
    timers,
    buttons,
    snapshot.powered ? 1 : 0,
    snapshot.tripped ? 1 : 0,
    session?.wires.length ?? 0,
    Object.keys(session?.mounted ?? {}).join('/'),
    state.hoveredTerminal ?? '',
    state.pendingTerminal ?? '',
    state.selectedWire ?? '',
    state.mode,
    state.camera,
  ].join('|');
}

/** 見た目が変わったときだけ再描画を要求する。 */
function Invalidator(): null {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let previous = visualSignature(useStore.getState());
    invalidate();
    return useStore.subscribe((state) => {
      const next = visualSignature(state);
      if (next === previous) return;
      previous = next;
      invalidate();
    });
  }, [invalidate]);
  return null;
}

/** 盤のシーン本体（Canvas の中身）。 */
function BoardContents({
  onPick,
  onHover,
  onPress,
  onRelease,
}: {
  onPick: (hit: PickHit) => void;
  onHover: (id: TerminalId | undefined) => void;
  onPress: (pbId: string) => void;
  onRelease: (pbId: string) => void;
}): JSX.Element {
  const session = useStore((s) => s.session);
  const snapshot = useStore((s) => s.snapshot);
  const hovered = useStore((s) => s.hoveredTerminal);
  const pending = useStore((s) => s.pendingTerminal);
  const selectedWire = useStore((s) => s.selectedWire);
  const mode = useStore((s) => s.mode);
  const camera = useStore((s) => s.camera);
  const [controls, setControls] = useState<ControlsLike | null>(null);
  const invalidate = useThree((state) => state.invalidate);

  const board = JIPM_BOARD;
  const { routes, errors: routeErrors } = useMemo(() => safeRoutes(board, session), [board, session]);
  // 経路が解けなかった電線は描けないので、理由をトーストとログに出す（盤は描き続ける）。§6.6
  useEffect(() => {
    if (routeErrors.length === 0) return;
    const store = useStore.getState();
    for (const error of routeErrors) {
      store.toast(
        `${JA.session.routeFailed}（${error.wireId}: ${JA.routeReason[error.reason]}）`,
        'error',
      );
      store.addLog(`${JA.session.routeFailed}: ${error.wireId} — ${JA.routeReason[error.reason]}`);
    }
  }, [routeErrors]);
  const blocks = useMemo(() => {
    const out = new Map<string, typeof board.terminals>();
    for (const group of BLOCK_PARTS) {
      out.set(
        group.key,
        board.terminals.filter((t) => group.ids.some((id) => t.id.startsWith(`${id}.`))),
      );
    }
    return out;
  }, [board]);

  /**
   * ソケットごとの端子配列は**必ずメモ化する**。ここで毎回 `filter()` すると配列の同一性が変わり、
   * `Socket` の印字テクスチャ（`useMemo`）がスナップショットのたびに焼き直されて
   * メインスレッドを食い尽くす（クリックが受け付けられなくなる）。§15
   */
  /** 固定機器の端子（同一性を保つためメモ化する）。 */
  const fixtureTerminals = useMemo(
    () =>
      FIXTURES.map((fixture) => ({
        ...fixture,
        terminals: board.terminals.filter((t) => t.id.startsWith(`${fixture.id}.`)),
      })),
    [board],
  );

  /** DINレールを敷く端子のまとまり（これもメモ化して同一性を保つ）。 */
  const railTerminals = useMemo(
    () => [
      ...RAIL_GROUPS.map((ids) => ({
        key: ids.join('-'),
        terminals: board.terminals.filter((t) => ids.some((id) => t.id.startsWith(`${id}.`))),
      })),
      ...board.sockets.map((socket) => ({
        key: `rail-${socket.id}`,
        terminals: board.terminals.filter((t) => t.id.startsWith(`${socket.id}.`)),
      })),
    ],
    [board],
  );

  const socketTerminals = useMemo(() => {
    const out = new Map<string, typeof board.terminals>();
    for (const socket of board.sockets) {
      out.set(
        socket.id,
        board.terminals.filter((t) => t.id.startsWith(`${socket.id}.`)),
      );
    }
    return out;
  }, [board]);

  const pickTerminal = (terminal: BoardTerminal): void => {
    onPick({
      kind: 'terminal',
      id: terminal.id,
      wirable: terminal.wirable,
      label: terminal.label,
    });
  };

  return (
    <>
      <Invalidator />
      <color attach="background" args={['#141820']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[220, 520, 420]} intensity={1.6} />
      <directionalLight position={[-320, 180, 360]} intensity={0.6} />
      {/* 盤は傾斜コンソール。盤ローカル（+Z が盤面の法線）を机の上に寝かせて手前に起こす。§6.5 */}
      <group rotation={[BOARD_TILT_RAD, 0, 0]}>
      <BoardPlate board={board} />
      {railTerminals.map((rail) => (
        <DinRail key={rail.key} terminals={rail.terminals} />
      ))}
      {fixtureTerminals.map((fixture) => (
        <Fixture
          key={fixture.id}
          name={fixture.id}
          label={fixture.label}
          color={fixture.color}
          terminals={fixture.terminals}
        />
      ))}
      <FixedWires board={board} />

      {board.sockets.map((socket) => {
        const role = session?.socketRoles[socket.id];
        const mounted = session?.mounted[socket.id];
        const terminals = socketTerminals.get(socket.id) ?? [];
        return (
          <group key={socket.id}>
            <Socket
              socket={socket}
              role={role}
              occupied={mounted !== undefined}
              terminals={terminals}
              hoveredTerminal={hovered}
              pendingTerminal={pending}
              onHoverTerminal={onHover}
              onPickTerminal={pickTerminal}
              onPickSocket={(socketId: SocketId, occupied: boolean) => {
                onPick({ kind: 'socket', id: socketId, occupied });
              }}
            />
            {mounted === undefined || role === undefined ? null : (
              <MountedPart
                socket={socket}
                role={role}
                part={mounted}
                energized={
                  snapshot.relays[role]?.coilOn === true || snapshot.timers[role]?.powered === true
                }
              />
            )}
          </group>
        );
      })}

      {BLOCK_PARTS.map((block) => (
        <TerminalBlock
          key={block.key}
          name={block.key}
          label={block.label}
          terminals={blocks.get(block.key) ?? []}
          hoveredTerminal={hovered}
          pendingTerminal={pending}
          onHoverTerminal={onHover}
          onPickTerminal={pickTerminal}
        />
      ))}

      {board.lamps.map((lamp) => (
        <Lamp key={lamp.id} definition={lamp} level={snapshot.lamps[lamp.id]?.level ?? 'off'} />
      ))}

      {board.pushButtons.map((pb) => (
        <PushButton
          key={pb.id}
          definition={pb}
          pressed={snapshot.buttons[pb.id] === true}
          onPress={onPress}
          onRelease={onRelease}
        />
      ))}

      {routes.map((route) => {
        const wire = session?.wires.find((w) => w.id === route.wireId);
        if (wire === undefined) return null;
        return (
          <Wire
            key={route.wireId}
            route={route}
            color={wire.color}
            locked={wire.locked}
            selected={selectedWire === route.wireId}
            pickable={mode === 'delete'}
            onPick={(wireId: string) => {
              onPick({ kind: 'wire', id: wireId, locked: wire.locked });
            }}
          />
        );
      })}
      </group>

      {/*
        操作は左ドラッグ回転・右ドラッグ平行移動・ホイールズーム（§12.2）。
        `maxPolarAngle` で盤の裏側へ回り込まないようにし、注視点は盤の中心に固定する。
        `frameloop="demand"` なので、カメラが動いたフレームだけ `onChange` で描画を要求する
        （慣性を入れると常時再描画になり、§15 の性能方針と噛み合わないため damping は使わない）。
      */}
      <OrbitControls
        makeDefault
        enableDamping={false}
        minDistance={MIN_CAMERA_DISTANCE_MM}
        maxDistance={MAX_CAMERA_DISTANCE_MM}
        maxPolarAngle={MAX_POLAR_ANGLE}
        mouseButtons={{
          LEFT: MOUSE.ROTATE,
          MIDDLE: MOUSE.DOLLY,
          RIGHT: MOUSE.PAN,
        }}
        onChange={() => {
          invalidate();
        }}
        ref={(instance) => {
          setControls(instance);
        }}
      />
      <CameraPresets preset={camera} controls={controls} />
      <ViewGizmo />
    </>
  );
}

/**
 * 3Dビューポート。§13 #4
 * `webglcontextlost` を捕まえたら `key` を変えて `Canvas` を丸ごと作り直す。
 * 盤の状態は Worker とストアが持っているので、シーンを捨てても失われない。
 */
export function BoardScene({
  onPick,
  onHover,
  onPress,
  onRelease,
}: {
  onPick: (hit: PickHit) => void;
  onHover: (id: TerminalId | undefined) => void;
  onPress: (pbId: string) => void;
  onRelease: (pbId: string) => void;
}): JSX.Element {
  const [generation, setGeneration] = useState(0);
  const setWebglLost = useStore((s) => s.setWebglLost);
  return (
    <Canvas
      key={generation}
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ fov: CAMERA_FOV_DEG, near: 1, far: 4000, position: [0, 0, 380] }}
      data-testid="board-canvas"
      onPointerMissed={() => {
        onPick({ kind: 'empty' });
      }}
      onCreated={({ gl }) => {
        const canvas = gl.domElement;
        canvas.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault();
            setWebglLost(true);
            setGeneration((value) => value + 1);
          },
          { once: true },
        );
        canvas.addEventListener(
          'webglcontextrestored',
          () => {
            setWebglLost(false);
          },
          { once: true },
        );
        setWebglLost(false);
      }}
    >
      <BoardContents onPick={onPick} onHover={onHover} onPress={onPress} onRelease={onRelease} />
    </Canvas>
  );
}
```

- [ ] **Step 4: 型チェックが通ることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop typecheck
```

期待出力:

```text
（何も出力されない＝成功）
```

- [ ] **Step 5: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/three/CameraPresets.tsx` `apps/desktop/src/renderer/three/ViewGizmo.tsx` `apps/desktop/src/renderer/three/BoardScene.tsx`

```powershell
git add apps/desktop/src/renderer/three/CameraPresets.tsx apps/desktop/src/renderer/three/ViewGizmo.tsx apps/desktop/src/renderer/three/BoardScene.tsx
git commit -m @'
feat(desktop): assemble the 3d scene with view presets and a view cube

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 13: 右パネル・下部パネル・ツールバー

**Files:**
- Create: `apps/desktop/src/renderer/panels/panels.module.css`, `Toolbar.tsx`, `PowerControls.tsx`, `ProblemPanel.tsx`, `TimeChartPanel.tsx`, `PartsPanel.tsx`, `TimerDial.tsx`, `LogPanel.tsx`, `ElapsedTimer.tsx`
- Test: `apps/desktop/test/charts.test.ts`


- [ ] **Step 1: `apps/desktop/src/renderer/panels/panels.module.css` を書く**

```css
/* 右パネル・下部パネル・ツールバー。設計仕様 §8.1。 */

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  padding: 6px 10px;
}

.toolGroup {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  border-right: 1px solid var(--line);
}

.toolGroup:last-child {
  border-right: none;
}

.toolLabel {
  color: var(--muted);
  font-size: 12px;
  margin-right: 2px;
}

.spacer {
  flex: 1;
}

.judgeButton {
  background: var(--accent);
  color: #10151c;
  border-color: var(--accent);
  font-weight: 700;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 8px 10px;
  margin-bottom: 8px;
}

.panelTitle {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  margin: 0 0 6px;
}

.problemTitle {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 4px;
}

.problemText {
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
}

.partRow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.partName {
  flex: 1;
  font-size: 13px;
}

.mountedRow {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--line);
  padding-top: 6px;
  margin-top: 6px;
}

.dial {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dial input[type='range'] {
  flex: 1;
}

.dial input[type='number'] {
  width: 72px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--text);
  padding: 3px 5px;
}

.power {
  display: flex;
  gap: 8px;
  align-items: center;
}

.led {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: #33383f;
}

.ledOn {
  background: var(--ok);
  box-shadow: 0 0 8px var(--ok);
}

.ledTrip {
  background: var(--ng);
  box-shadow: 0 0 8px var(--ng);
}

.logList {
  font-size: 12px;
  line-height: 1.5;
  max-height: 120px;
  overflow-y: auto;
  margin: 0;
  padding-left: 16px;
}

.warnList {
  color: var(--warn);
  font-size: 12px;
  margin: 4px 0 0;
  padding-left: 16px;
}

.elapsed {
  display: flex;
  align-items: center;
  gap: 10px;
}

.elapsedValue {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.elapsedBar {
  position: relative;
  flex: 1;
  height: 10px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 5px;
  overflow: hidden;
}

.elapsedFill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  opacity: 0.6;
}

.elapsedMark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
}

.markStandard {
  background: var(--ok);
}

.markCutoff {
  background: var(--ng);
}

.chart {
  width: 100%;
  height: auto;
}

.chartRowLabel {
  fill: var(--muted);
  font-size: 9px;
}

.chartLine {
  stroke: var(--accent);
  stroke-width: 1.6;
  fill: none;
}

.chartAxis {
  stroke: var(--line);
  stroke-width: 1;
}

.chartMarker {
  stroke: var(--warn);
  stroke-dasharray: 3 3;
  stroke-width: 1;
}
```

- [ ] **Step 2: `apps/desktop/src/renderer/panels/Toolbar.tsx` を書く**

```tsx
import type { WireColor } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import type { CameraPreset } from '../app/store.js';
import type { ToolMode } from '../session/interaction.js';
import styles from './panels.module.css';

/**
 * 上部ツールバー。設計仕様 §8.1。
 * 線色／削除モード／元に戻す・やり直し／視点プリセット／判定を並べる。
 * 電源（ブレーカ・スイッチ）は `PowerControls` が描く。
 */

/** 視点プリセットのボタン定義。§12.2 */
const VIEWS: ReadonlyArray<{ preset: CameraPreset; label: string; key: string }> = [
  { preset: 'front', label: JA.session.viewFront, key: '1' },
  { preset: 'top', label: JA.session.viewTop, key: '2' },
  { preset: 'socket', label: JA.session.viewSocket, key: '3' },
];

/** 上部ツールバー。 */
export function Toolbar({
  mode,
  wireColor,
  allowedColors,
  camera,
  canUndo,
  canRedo,
  onMode,
  onWireColor,
  onCamera,
  onUndo,
  onRedo,
  onJudge,
  onBack,
  children,
}: {
  mode: ToolMode;
  wireColor: WireColor;
  allowedColors: readonly WireColor[];
  camera: CameraPreset;
  canUndo: boolean;
  canRedo: boolean;
  onMode: (mode: ToolMode) => void;
  onWireColor: (color: WireColor) => void;
  onCamera: (preset: CameraPreset) => void;
  onUndo: () => void;
  onRedo: () => void;
  onJudge: () => void;
  onBack: () => void;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div className={styles.toolbar} role="toolbar">
      <button type="button" onClick={onBack}>
        {JA.session.back}
      </button>
      <div className={styles.toolGroup}>
        <span className={styles.toolLabel}>{JA.session.wireColor}</span>
        {allowedColors.map((color) => (
          <button
            key={color}
            type="button"
            aria-pressed={mode === 'wire' && wireColor === color}
            onClick={() => {
              onWireColor(color);
              onMode('wire');
            }}
          >
            {color}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={mode === 'delete'}
          onClick={() => {
            onMode(mode === 'delete' ? 'wire' : 'delete');
          }}
        >
          {JA.session.deleteMode}
        </button>
      </div>
      <div className={styles.toolGroup}>
        <button type="button" disabled={!canUndo} onClick={onUndo}>
          {JA.session.undo}
        </button>
        <button type="button" disabled={!canRedo} onClick={onRedo}>
          {JA.session.redo}
        </button>
      </div>
      <div className={styles.toolGroup}>
        {VIEWS.map((view) => (
          <button
            key={view.preset}
            type="button"
            aria-pressed={camera === view.preset}
            title={`${view.label} (${view.key})`}
            onClick={() => {
              onCamera(view.preset);
            }}
          >
            {view.label}
          </button>
        ))}
      </div>
      {children}
      <span className={styles.spacer} />
      <button type="button" className={styles.judgeButton} onClick={onJudge}>
        {JA.session.judge}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: `apps/desktop/src/renderer/panels/PowerControls.tsx` を書く**

```tsx
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './panels.module.css';

/**
 * 電源操作（ブレーカ → 電源スイッチ）。設計仕様 §5.3.5 / §8.2。
 * 逆手順でも操作は通る（練習は中断しない）。手順違反はエンジンが危険操作として記録する。
 */

/** ブレーカ・電源スイッチ・保護復帰のボタン。 */
export function PowerControls({
  breakerOn,
  switchOn,
  powered,
  tripped,
  onBreaker,
  onSwitch,
  onResetTrip,
}: {
  breakerOn: boolean;
  switchOn: boolean;
  powered: boolean;
  tripped: boolean;
  onBreaker: (on: boolean) => void;
  onSwitch: (on: boolean) => void;
  onResetTrip: () => void;
}): JSX.Element {
  return (
    <div className={`${styles.toolGroup} ${styles.power}`}>
      <span
        className={`${styles.led} ${tripped ? styles.ledTrip : powered ? styles.ledOn : ''}`}
        aria-label={powered ? '通電中' : '無通電'}
      />
      <button
        type="button"
        aria-pressed={breakerOn}
        onClick={() => {
          onBreaker(!breakerOn);
        }}
      >
        {JA.session.breaker}
      </button>
      <button
        type="button"
        aria-pressed={switchOn}
        onClick={() => {
          onSwitch(!switchOn);
        }}
      >
        {JA.session.switch}
      </button>
      {tripped ? (
        <button type="button" onClick={onResetTrip}>
          {JA.session.resetTrip}
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: `apps/desktop/src/renderer/panels/ProblemPanel.tsx` を書く**

```tsx
import type { AssembleProblem } from '@ojt/content';
import type { JSX } from 'react';
import { gradeLabel, JA } from '../i18n/ja.js';
import styles from './panels.module.css';

/**
 * 課題文パネル。設計仕様 §8.1（右パネル上段）。
 * `description` は Markdown 可だがプレーンテキスト＋改行で表示する（§7.1）。
 */

/** 課題文の表示。 */
export function ProblemPanel({ problem }: { problem: AssembleProblem }): JSX.Element {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{JA.session.problem}</h2>
      <p className={styles.problemTitle}>
        {problem.title}（{gradeLabel(problem.grade)}）
      </p>
      <p className={styles.problemText}>{problem.description}</p>
    </section>
  );
}
```

- [ ] **Step 5: `apps/desktop/src/renderer/panels/TimeChartPanel.tsx` を書く**

```tsx
import type { TimeChart, TimeChartSegment, TimeChartSignalSpec } from '@ojt/content';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './panels.module.css';

/**
 * タイムチャート（仕様＋ライブ実測）。設計仕様 §7.7 / §8.1 / §8.2。
 * 上段に入力（PB）、下段に出力（PL／BZ）を並べる。SVGで描き、結果画面の重ね表示
 * （`ChartOverlay`）も同じ `waveformPoints()` を使う。
 */

/** 1信号ぶんの描画高さ[px]。 */
export const ROW_HEIGHT = 22;
/** 波形の振幅[px]。 */
export const ROW_AMPLITUDE = 12;
/** 左のラベル幅[px]。 */
export const LABEL_WIDTH = 92;
/** 描画領域の幅[px]。 */
export const PLOT_WIDTH = 300;

/**
 * 区間列を SVG の `points` 文字列にする純粋関数。§7.7
 * `value` が真なら上（`baseY - ROW_AMPLITUDE`）、偽なら下（`baseY`）を通る矩形波。
 */
export function waveformPoints(
  segments: readonly TimeChartSegment[],
  durationMs: number,
  baseY: number,
): string {
  if (durationMs <= 0) return '';
  const x = (ms: number): number => LABEL_WIDTH + (Math.min(ms, durationMs) / durationMs) * PLOT_WIDTH;
  const y = (value: boolean): number => (value ? baseY - ROW_AMPLITUDE : baseY);
  const out: string[] = [];
  for (const segment of segments) {
    out.push(`${x(segment.fromMs).toFixed(1)},${y(segment.value).toFixed(1)}`);
    out.push(`${x(segment.toMs).toFixed(1)},${y(segment.value).toFixed(1)}`);
  }
  return out.join(' ');
}

/**
 * 変化点の列（ライブ記録）を区間列にする純粋関数。§8.2
 * 記録が無い信号は「全区間 false」になる。
 */
export function toSegments(
  points: ReadonlyArray<{ tMs: number; value: boolean }>,
  durationMs: number,
): TimeChartSegment[] {
  const segments: TimeChartSegment[] = [];
  let value = false;
  let from = 0;
  for (const point of points) {
    if (point.tMs > durationMs) break;
    if (point.tMs > from && point.value !== value) {
      segments.push({ fromMs: from, toMs: point.tMs, value });
      from = point.tMs;
    }
    value = point.value;
  }
  segments.push({ fromMs: from, toMs: durationMs, value });
  return segments;
}

/** ライブ記録から `TimeChart` を作る。§8.2 */
export function liveChart(
  specs: readonly TimeChartSignalSpec[],
  transitions: Readonly<Record<string, Array<{ tMs: number; value: boolean }>>>,
  durationMs: number,
): TimeChart {
  return {
    durationMs,
    markers: [],
    signals: specs.map((spec) => ({
      name: spec.name,
      label: spec.label,
      kind: spec.kind,
      segments: toSegments(transitions[spec.name] ?? [], durationMs),
    })),
  };
}

/** タイムチャート1枚のSVG。 */
export function TimeChartSvg({
  chart,
  title,
}: {
  chart: TimeChart;
  title: string;
}): JSX.Element {
  const height = chart.signals.length * ROW_HEIGHT + 14;
  const width = LABEL_WIDTH + PLOT_WIDTH + 8;
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMinYMin meet"
    >
      {chart.signals.map((signal, index) => {
        const baseY = (index + 1) * ROW_HEIGHT;
        return (
          <g key={signal.name}>
            <text className={styles.chartRowLabel} x={0} y={baseY} dominantBaseline="middle">
              {signal.label}
            </text>
            <line
              className={styles.chartAxis}
              x1={LABEL_WIDTH}
              y1={baseY + 2}
              x2={LABEL_WIDTH + PLOT_WIDTH}
              y2={baseY + 2}
            />
            <polyline
              className={styles.chartLine}
              points={waveformPoints(signal.segments, chart.durationMs, baseY)}
            />
          </g>
        );
      })}
      {chart.markers.map((marker) => (
        <g key={`${marker.label}-${marker.tMs}`}>
          <line
            className={styles.chartMarker}
            x1={LABEL_WIDTH + (marker.tMs / chart.durationMs) * PLOT_WIDTH}
            y1={4}
            x2={LABEL_WIDTH + (marker.tMs / chart.durationMs) * PLOT_WIDTH}
            y2={height - 10}
          />
          <text
            className={styles.chartRowLabel}
            x={LABEL_WIDTH + (marker.tMs / chart.durationMs) * PLOT_WIDTH + 2}
            y={height - 2}
          >
            {marker.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** 右パネルのタイムチャート。 */
export function TimeChartPanel({ chart }: { chart: TimeChart }): JSX.Element {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{JA.session.chart}</h2>
      <TimeChartSvg chart={chart} title={JA.session.chart} />
    </section>
  );
}
```

- [ ] **Step 6: `apps/desktop/src/renderer/panels/TimerDial.tsx` を書く**

```tsx
import { findTimerRange, DEFAULT_TIMER_RANGE } from '@ojt/board-model';
import { TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import styles from './panels.module.css';

/**
 * タイマ設定ダイヤル。設計仕様 §5.3.2 / §8.2。
 * ドラッグ（`range`）と数値入力の両方を受ける。刻みはレンジの分解能
 * （0〜10sレンジは0.1s、0〜60sレンジは0.5s）をそのまま使う。
 */

/** 秒 → ms（浮動小数の誤差を避けるため 10ms 単位に丸める）。 */
export function secondsToMs(seconds: number): number {
  return Math.round(seconds * 100) * 10;
}

/** タイマ設定ダイヤル1個。 */
export function TimerDial({
  label,
  presetMs,
  rangeMaxMs,
  onChange,
}: {
  label: string;
  presetMs: number;
  rangeMaxMs: number;
  onChange: (presetMs: number) => void;
}): JSX.Element {
  const range = findTimerRange(rangeMaxMs) ?? DEFAULT_TIMER_RANGE;
  const stepSeconds = range.stepMs / 1000;
  return (
    <div className={styles.dial}>
      <span className={styles.toolLabel}>{label}</span>
      <input
        type="range"
        aria-label={`${label} スライダ`}
        min={TIMER_MIN_PRESET_MS / 1000}
        max={range.maxMs / 1000}
        step={stepSeconds}
        value={presetMs / 1000}
        onChange={(event) => {
          onChange(secondsToMs(Number(event.target.value)));
        }}
      />
      <input
        type="number"
        aria-label={`${label} 数値`}
        min={TIMER_MIN_PRESET_MS / 1000}
        max={range.maxMs / 1000}
        step={stepSeconds}
        value={presetMs / 1000}
        onChange={(event) => {
          onChange(secondsToMs(Number(event.target.value)));
        }}
      />
      <span>秒</span>
    </div>
  );
}
```

- [ ] **Step 7: `apps/desktop/src/renderer/panels/PartsPanel.tsx` を書く**

```tsx
import {
  catalogEntry,
  mountedKinds,
  remainingInventory,
  SOCKET_IDS,
  type BoardSession,
  type MountableKind,
  type SocketId,
} from '@ojt/board-model';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { TimerDial } from './TimerDial.js';
import styles from './panels.module.css';

/**
 * 部品パネル（在庫と装着状態）。設計仕様 §8.1 / §8.2。
 * ソケットを選んでから部品を押すと装着する（ドラッグの代替。§8.2 が「クリック → 部品選択」も認める）。
 */

/** 部品パネル。 */
export function PartsPanel({
  session,
  selectedSocket,
  onSelectSocket,
  onPlug,
  onUnplug,
  onPreset,
}: {
  session: BoardSession;
  selectedSocket: SocketId | undefined;
  onSelectSocket: (socketId: SocketId | undefined) => void;
  onPlug: (socketId: SocketId, kind: MountableKind) => void;
  onUnplug: (socketId: SocketId) => void;
  onPreset: (socketId: SocketId, presetMs: number) => void;
}): JSX.Element {
  const remaining = remainingInventory(session.inventory, mountedKinds(session));
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{JA.session.parts}</h2>
      {remaining.map((item) => {
        const entry = catalogEntry(item.kind);
        return (
          <div key={item.kind} className={styles.partRow}>
            <span className={styles.partName}>{entry.displayName}</span>
            <span>
              {JA.session.remaining} {item.count}
            </span>
            <button
              type="button"
              disabled={selectedSocket === undefined || item.count <= 0}
              onClick={() => {
                if (selectedSocket !== undefined) onPlug(selectedSocket, item.kind);
              }}
            >
              {JA.session.mount}
            </button>
          </div>
        );
      })}
      <p className={styles.problemText}>
        {selectedSocket === undefined
          ? JA.session.pickSocket
          : `${selectedSocket}（${session.socketRoles[selectedSocket]}）を選択中`}
      </p>
      {SOCKET_IDS.map((socketId) => {
        const mounted = session.mounted[socketId];
        if (mounted === undefined) return null;
        const role = session.socketRoles[socketId];
        return (
          <div key={socketId} className={styles.mountedRow}>
            <span className={styles.partName}>
              {role}: {mounted.kind === 'relay-my4n' ? 'リレー' : 'タイマ'}
            </span>
            <button
              type="button"
              onClick={() => {
                onSelectSocket(socketId);
              }}
            >
              選択
            </button>
            <button
              type="button"
              onClick={() => {
                onUnplug(socketId);
              }}
            >
              {JA.session.unmount}
            </button>
          </div>
        );
      })}
      {SOCKET_IDS.map((socketId) => {
        const mounted = session.mounted[socketId];
        if (mounted === undefined || mounted.kind !== 'timer-h3y4') return null;
        return (
          <TimerDial
            key={`dial-${socketId}`}
            label={`${session.socketRoles[socketId]} ${JA.session.timerPreset}`}
            presetMs={mounted.presetMs}
            rangeMaxMs={mounted.rangeMaxMs}
            onChange={(presetMs) => {
              onPreset(socketId, presetMs);
            }}
          />
        );
      })}
    </section>
  );
}
```

- [ ] **Step 8: `apps/desktop/src/renderer/panels/LogPanel.tsx` を書く**

```tsx
import type { ChatterEvent, HazardEvent } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import type { LogLine } from '../app/store.js';
import styles from './panels.module.css';

/**
 * 操作ログと警告一覧。設計仕様 §8.1（下部）。
 * 危険操作は §5.6 の種別名を日本語で出し、チャタリングは禁則回路の警告文を添える（§8.3）。
 */

/** 操作ログ・警告の表示。 */
export function LogPanel({
  lines,
  hazards,
  chatters,
}: {
  lines: readonly LogLine[];
  hazards: readonly HazardEvent[];
  chatters: readonly ChatterEvent[];
}): JSX.Element {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>
        {JA.session.log}（{lines.length}）
      </h2>
      <ul className={styles.logList} data-testid="operation-log">
        {lines.slice(-30).map((line) => (
          <li key={line.id}>{line.text}</li>
        ))}
      </ul>
      {hazards.length === 0 && chatters.length === 0 ? null : (
        <ul className={styles.warnList} data-testid="warning-list">
          {hazards.map((hazard, index) => (
            <li key={`h-${index}`}>
              {JA.hazard[hazard.kind]}（{hazard.detail}）
            </li>
          ))}
          {chatters.length === 0 ? null : <li>{JA.result.forbidden}</li>}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 9: `apps/desktop/src/renderer/panels/ElapsedTimer.tsx` を書く**

時間制限は**目盛の印として見せるだけ**で、到達しても強制終了しない（§12 / 決定事項#12 と同じ考え方）。

```tsx
import type { TimeLimit } from '@ojt/content';
import type { JSX } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { JA } from '../i18n/ja.js';
import styles from './panels.module.css';

/**
 * 経過時間と時間制限の目印。設計仕様 §8.1 / §12。
 * 標準時間・打切り時間は**目盛の印として見せるだけ**で、到達しても強制終了はしない
 * （練習を中断しない方針。決定事項#12 と同じ考え方）。
 */

/** 目盛の全長（打切り時間の 1.2 倍まで描く）。 */
export const SCALE_FACTOR = 1.2;

/** 経過時間[ms]と時間制限から、バーの塗り率と目印位置（0〜1）を求める純粋関数。 */
export function elapsedScale(
  elapsedMs: number,
  limit: TimeLimit,
): { fill: number; standard: number; cutoff: number } {
  const fullMs = limit.cutoffMin * 60_000 * SCALE_FACTOR;
  return {
    fill: Math.min(1, Math.max(0, elapsedMs / fullMs)),
    standard: (limit.standardMin * 60_000) / fullMs,
    cutoff: (limit.cutoffMin * 60_000) / fullMs,
  };
}

/** 経過時間の表示。 */
export function ElapsedTimer({
  elapsedMs,
  limit,
}: {
  elapsedMs: number;
  limit: TimeLimit;
}): JSX.Element {
  const scale = elapsedScale(elapsedMs, limit);
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{JA.session.elapsed}</h2>
      <div className={styles.elapsed}>
        <span className={styles.elapsedValue} data-testid="elapsed">
          {formatElapsed(elapsedMs)}
        </span>
        <div className={styles.elapsedBar}>
          <div className={styles.elapsedFill} style={{ width: `${scale.fill * 100}%` }} />
          <div
            className={`${styles.elapsedMark} ${styles.markStandard}`}
            style={{ left: `${scale.standard * 100}%` }}
            title={`${JA.result.standardMark} ${limit.standardMin}${JA.problemList.minutes}`}
          />
          <div
            className={`${styles.elapsedMark} ${styles.markCutoff}`}
            style={{ left: `${scale.cutoff * 100}%` }}
            title={`${JA.result.cutoffMark} ${limit.cutoffMin}${JA.problemList.minutes}`}
          />
        </div>
        <span className={styles.toolLabel}>
          {JA.result.standardMark} {limit.standardMin} / {JA.result.cutoffMark} {limit.cutoffMin}
          {JA.problemList.minutes}
        </span>
      </div>
    </section>
  );
}
```

- [ ] **Step 10: `apps/desktop/test/charts.test.ts` を書く**

`elapsedSummary` と `formatMs` は Task 15 の結果画面にあるので、この時点では import 解決に失敗する。Task 15 の後に通す。

```ts
import { describe, expect, it } from 'vitest';
import {
  LABEL_WIDTH,
  liveChart,
  PLOT_WIDTH,
  ROW_AMPLITUDE,
  toSegments,
  waveformPoints,
} from '../src/renderer/panels/TimeChartPanel.js';
import { elapsedScale, SCALE_FACTOR } from '../src/renderer/panels/ElapsedTimer.js';
import { elapsedSummary } from '../src/renderer/result/ResultView.js';
import { formatMs } from '../src/renderer/result/MismatchList.js';

describe('waveformPoints', () => {
  it('OFF 区間は下、ON 区間は上を通る矩形波になる', () => {
    const points = waveformPoints(
      [
        { fromMs: 0, toMs: 500, value: false },
        { fromMs: 500, toMs: 1000, value: true },
      ],
      1000,
      50,
    );
    expect(points).toBe(
      `${LABEL_WIDTH}.0,50.0 ${LABEL_WIDTH + PLOT_WIDTH / 2}.0,50.0 ` +
        `${LABEL_WIDTH + PLOT_WIDTH / 2}.0,${(50 - ROW_AMPLITUDE).toFixed(1)} ` +
        `${LABEL_WIDTH + PLOT_WIDTH}.0,${(50 - ROW_AMPLITUDE).toFixed(1)}`,
    );
  });

  it('区間長が0以下なら空文字', () => {
    expect(waveformPoints([{ fromMs: 0, toMs: 1, value: true }], 0, 10)).toBe('');
  });
});

describe('toSegments', () => {
  it('記録が無ければ全区間 OFF', () => {
    expect(toSegments([], 1000)).toEqual([{ fromMs: 0, toMs: 1000, value: false }]);
  });

  it('変化点から区間を作る', () => {
    expect(
      toSegments(
        [
          { tMs: 0, value: false },
          { tMs: 300, value: true },
          { tMs: 700, value: false },
        ],
        1000,
      ),
    ).toEqual([
      { fromMs: 0, toMs: 300, value: false },
      { fromMs: 300, toMs: 700, value: true },
      { fromMs: 700, toMs: 1000, value: false },
    ]);
  });

  it('区間長を超えた変化点は無視する', () => {
    expect(toSegments([{ tMs: 5000, value: true }], 1000)).toEqual([
      { fromMs: 0, toMs: 1000, value: false },
    ]);
  });
});

describe('liveChart', () => {
  it('指定した信号だけを並べる', () => {
    const chart = liveChart(
      [
        { name: 'PB1', label: '黒押ボタン（PB1）', kind: 'input' },
        { name: 'PL1', label: '白ランプ（PL1）', kind: 'output' },
      ],
      { PL1: [{ tMs: 200, value: true }] },
      1000,
    );
    expect(chart.signals.map((s) => s.name)).toEqual(['PB1', 'PL1']);
    expect(chart.signals[1]?.segments).toHaveLength(2);
  });
});

describe('elapsedScale', () => {
  it('打切り時間の1.2倍を全長にして目印を置く', () => {
    const scale = elapsedScale(0, { standardMin: 30, cutoffMin: 50 });
    expect(scale.fill).toBe(0);
    expect(scale.cutoff).toBeCloseTo(1 / SCALE_FACTOR, 5);
    expect(scale.standard).toBeCloseTo(30 / (50 * SCALE_FACTOR), 5);
  });

  it('全長を超えても1で止まる（強制終了はしない）', () => {
    expect(elapsedScale(10 ** 9, { standardMin: 30, cutoffMin: 50 }).fill).toBe(1);
  });
});

describe('elapsedSummary', () => {
  it('標準時間以内・超過・打切り超過を言い分ける', () => {
    expect(elapsedSummary(10 * 60_000, 30, 50)).toContain('以内');
    expect(elapsedSummary(40 * 60_000, 30, 50)).toContain('標準時間');
    expect(elapsedSummary(60 * 60_000, 30, 50)).toContain('打切り時間');
  });
});

describe('formatMs', () => {
  it('秒に直して2桁で出す', () => {
    expect(formatMs(1234)).toBe('1.23 s');
  });
});
```

- [ ] **Step 11: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/panels` `apps/desktop/test/charts.test.ts`

```powershell
git add apps/desktop/src/renderer/panels apps/desktop/test/charts.test.ts
git commit -m @'
feat(desktop): add session side and bottom panels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 14: セッション画面（配線・装着・通電・判定の起点）

**Files:**
- Create: `apps/desktop/src/renderer/session/spec-chart.ts`, `apps/desktop/src/renderer/screens/Session.tsx`
- Test: `apps/desktop/test/spec-chart.test.ts`


- [ ] **Step 1: `apps/desktop/src/renderer/session/spec-chart.ts` を書く**

仕様 §7.7「波形は課題JSONに書かず模範回路をその場でシミュレートして作る」。5000msの課題でも500tickなので renderer の同期計算で足りる。

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import {
  buildReferenceSession,
  buildTimeChart,
  defaultChartSignals,
  resolveCompareSignals,
  runOperations,
  timerMarkers,
  type AssembleProblem,
  type TimeChart,
} from '@ojt/content';

/**
 * 課題の仕様タイムチャート。設計仕様 §7.7 / §8.1。
 * 波形は課題JSONに書かれていないので、**模範回路をその場でシミュレートして**作る（決定事項#8）。
 * 5000ms の課題でも 500 tick なので renderer の同期計算で足りる（§5.2 の 1tick 1ms 未満目標）。
 */

/** 仕様チャートの構築結果。模範回路が変換できなければ理由を返す（§13 #2）。 */
export type SpecChartResult =
  | { ok: true; chart: TimeChart }
  | { ok: false; errors: string[] };

/** 課題の仕様タイムチャートを作る。 */
export function buildSpecChart(problem: AssembleProblem): SpecChartResult {
  const reference = buildReferenceSession(problem, JIPM_BOARD);
  if (!reference.ok) {
    return { ok: false, errors: reference.errors.map((e) => `${e.path}: ${e.message}`) };
  }
  const run = runOperations(reference.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  const specs = defaultChartSignals(
    resolveCompareSignals(problem.judge, problem.board.extraParts ?? []),
  );
  return {
    ok: true,
    chart: buildTimeChart(run.log, specs, problem.durationMs, timerMarkers(reference.value.netlist)),
  };
}
```

- [ ] **Step 2: `apps/desktop/src/renderer/screens/Session.tsx` を書く**

```tsx
import { JIPM_BOARD, socketPartId } from '@ojt/board-model';
import type { BoardSession, MountableKind, SocketId } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { useCallback, useEffect, useMemo, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { ElapsedTimer } from '../panels/ElapsedTimer.js';
import { LogPanel } from '../panels/LogPanel.js';
import { PartsPanel } from '../panels/PartsPanel.js';
import { PowerControls } from '../panels/PowerControls.js';
import { ProblemPanel } from '../panels/ProblemPanel.js';
import { liveChart, TimeChartPanel, TimeChartSvg } from '../panels/TimeChartPanel.js';
import { Toolbar } from '../panels/Toolbar.js';
import {
  cloneSession,
  redo as redoHistory,
  runAddWire,
  runPlug,
  runRemoveWire,
  runSetPreset,
  runUnplug,
  undo as undoHistory,
  type CommandHistory,
  type CommandResult,
  type SessionCommand,
} from '../session/commands.js';
import {
  deleteKeyToAction,
  escapeToAction,
  pickToAction,
  type PickAction,
  type PickHit,
} from '../session/interaction.js';
import { buildSpecChart } from '../session/spec-chart.js';
import { bridge } from '../session/worker-bridge.js';
import { BoardScene, safeRoutes } from '../three/BoardScene.js';
import styles from './screens.module.css';

/**
 * セッション画面（モードB）。設計仕様 §8.1 / §8.2 / §8.3 / §12.2。
 * ピック結果は `pickToAction()`（純粋関数）で操作に直し、盤操作は `commands.ts` の
 * コマンドを通して実行し、成功した変更だけを Worker に送る。
 */

/** 経過時間の更新間隔[ms]。 */
const ELAPSED_INTERVAL_MS = 200;

/** ライブチャートの最小横軸長[ms]（開始直後に潰れないようにする）。 */
const LIVE_MIN_DURATION_MS = 5000;

/** セッション画面。 */
export function Session(): JSX.Element {
  const problem = useStore((s) => s.problem);
  const session = useStore((s) => s.session);
  const history = useStore((s) => s.history);
  const mode = useStore((s) => s.mode);
  const wireColor = useStore((s) => s.wireColor);
  const pendingTerminal = useStore((s) => s.pendingTerminal);
  const selectedWire = useStore((s) => s.selectedWire);
  const selectedSocket = useStore((s) => s.selectedSocket);
  const camera = useStore((s) => s.camera);
  const snapshot = useStore((s) => s.snapshot);
  const hazards = useStore((s) => s.hazards);
  const chatters = useStore((s) => s.chatters);
  const logLines = useStore((s) => s.logLines);
  const elapsedMs = useStore((s) => s.elapsedMs);
  const chartSpecs = useStore((s) => s.chartSpecs);
  const liveTransitions = useStore((s) => s.liveTransitions);
  const webglLost = useStore((s) => s.webglLost);
  const problemId = problem?.id;

  // 課題を開いたら Worker を起動して `load` を送る（§4.3）
  useEffect(() => {
    const store = useStore.getState();
    const current = store.problem;
    const currentSession = store.session;
    if (current === undefined || currentSession === undefined) return;
    bridge.start({
      onSnapshot: (next) => {
        useStore.getState().applySnapshot(next);
      },
      onJudge: (message) => {
        const state = useStore.getState();
        if (message.result.ok) {
          state.setJudge(message.result.value);
          state.setRoute('result');
        } else {
          state.toast(
            `模範回路エラー: ${message.result.errors.map((e) => e.message).join(' / ')}`,
            'error',
          );
        }
      },
      onError: (text) => {
        useStore.getState().toast(`${JA.error.workerError}: ${text}`, 'error');
      },
    });
    bridge.send({ type: 'load', problemId: current.id, session: cloneSession(currentSession) });
    store.addLog(`課題「${current.title}」を開きました`);
    return () => {
      bridge.stop();
    };
  }, [problemId]);

  // 経過時間を定期更新する（§8.1）
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().tickElapsed();
    }, ELAPSED_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);



  /** コマンド結果を反映する。失敗はトーストとログに残すだけで盤は変わらない。§8.2 */
  const apply = useCallback(<T,>(result: CommandResult<T>, after: () => void): void => {
    const store = useStore.getState();
    if (!result.ok) {
      store.toast(result.message, 'error');
      store.addLog(`失敗: ${result.message}`);
      return;
    }
    const current = store.session;
    if (current !== undefined) store.setSession(cloneSession(current));
    store.pushHistory(result.command);
    store.addLog(result.command.label);
    after();
  }, []);

  const runAction = useCallback(
    (action: PickAction): void => {
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      switch (action.type) {
        case 'none':
          break;
        case 'beginWire':
          store.setPending(action.from);
          break;
        case 'cancelWire':
          store.setPending(undefined);
          store.addLog(JA.session.cancelWire);
          break;
        case 'completeWire':
          store.setPending(undefined);
          apply(runAddWire(current, action.from, action.to, action.color), () => {
            const next = useStore.getState();
            const wire = next.session?.wires.at(-1);
            if (wire === undefined) return;
            bridge.send({ type: 'addWire', wire });
            // 経路器は「部品を避けて通せない」電線を `RoutingError` で断る（§6.6）。
            // `safeRoutes()` がそれを受け止めるので、ここでは結果を見て理由を知らせるだけでよい。
            // 電気的な接続は既に成立しているので、盤の状態は戻さない（描けないのは見た目だけ）。
            const board = next.session;
            if (board === undefined) return;
            const { routes, errors } = safeRoutes(JIPM_BOARD, board);
            const failed = errors.find((e) => e.wireId === wire.id);
            if (failed !== undefined) {
              next.toast(
                `${JA.session.routeFailed}（${JA.routeReason[failed.reason]}）`,
                'error',
              );
              next.addLog(`${JA.session.routeFailed}: ${wire.id} — ${JA.routeReason[failed.reason]}`);
              return;
            }
            // 帯の空きスロットが尽きて他の電線と同じ位置に載った（3Dでは琥珀色で描かれる）
            if (routes.find((r) => r.wireId === wire.id)?.laneOverflow === true) {
              next.toast(JA.session.laneOverflow, 'info');
            }
          });
          break;
        case 'selectWire':
          store.setSelectedWire(action.wireId);
          break;
        case 'removeWire':
          apply(runRemoveWire(current, action.wireId), () => {
            useStore.getState().setSelectedWire(undefined);
            bridge.send({ type: 'removeWire', wireId: action.wireId });
          });
          break;
        case 'reject':
          store.toast(action.message, 'error');
          break;
        case 'selectSocket':
        case 'selectMounted':
          store.setSelectedSocket(action.socketId);
          break;
        case 'pressButton':
          bridge.send({ type: 'press', pbId: action.pbId });
          break;
      }
    },
    [apply],
  );

  /** 3Dへ渡すコールバックは安定させる。毎回作り直すとシーン全体が再構築される。§15 */
  const onHover = useCallback((id: TerminalId | undefined) => {
    useStore.getState().setHovered(id);
  }, []);
  const onPress = useCallback((pbId: string) => {
    bridge.send({ type: 'press', pbId });
  }, []);
  const onRelease = useCallback((pbId: string) => {
    bridge.send({ type: 'release', pbId });
  }, []);

  const onPick = useCallback(
    (hit: PickHit): void => {
      const store = useStore.getState();
      runAction(
        pickToAction(
          {
            mode: store.mode,
            pendingTerminal: store.pendingTerminal,
            selectedWire: store.selectedWire,
            wireColor: store.wireColor,
          },
          hit,
        ),
      );
    },
    [runAction],
  );

  // キーボード操作（Esc で配線取消、Delete で電線削除、1/2/3 で視点。§8.2 / §12.2）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      const state = {
        mode: store.mode,
        pendingTerminal: store.pendingTerminal,
        selectedWire: store.selectedWire,
        wireColor: store.wireColor,
      };
      if (event.key === 'Escape') runAction(escapeToAction(state));
      else if (event.key === 'Delete') {
        runAction(
          deleteKeyToAction(
            state,
            current.wires.filter((w) => w.locked).map((w) => w.id),
          ),
        );
      } else if (event.key === '1') store.setCamera('front');
      else if (event.key === '2') store.setCamera('top');
      else if (event.key === '3') store.setCamera('socket');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [runAction]);

  const spec = useMemo(
    () => (problem === undefined ? undefined : buildSpecChart(problem)),
    [problem],
  );

  const live = useMemo(
    () =>
      liveChart(chartSpecs, liveTransitions, Math.max(snapshot.tMs, LIVE_MIN_DURATION_MS)),
    [chartSpecs, liveTransitions, snapshot.tMs],
  );

  if (problem === undefined || session === undefined) {
    return <div className={styles.center}>課題が選ばれていません。</div>;
  }

  const onPlug = (socketId: SocketId, kind: MountableKind): void => {
    apply(runPlug(session, socketId, kind), () => {
      const next = useStore.getState().session;
      if (next !== undefined) bridge.send({ type: 'plug', socketId, session: cloneSession(next) });
    });
  };

  const onUnplug = (socketId: SocketId): void => {
    apply(runUnplug(session, socketId), () => {
      const next = useStore.getState().session;
      const partId = socketPartId(session.socketRoles, socketId);
      if (next !== undefined) bridge.send({ type: 'unplug', partId, session: cloneSession(next) });
    });
  };

  const onPreset = (socketId: SocketId, presetMs: number): void => {
    apply(runSetPreset(session, socketId, presetMs), () => {
      const next = useStore.getState().session;
      if (next === undefined) return;
      const mounted = next.mounted[socketId];
      const role = next.socketRoles[socketId];
      if (mounted === undefined || mounted.kind !== 'timer-h3y4' || role === undefined) return;
      bridge.send({
        type: 'setPreset',
        role,
        presetMs: mounted.presetMs,
        session: cloneSession(next),
      });
    });
  };

  /**
   * 元に戻す／やり直し。盤を作り直すので **無通電に戻る**。
   * 実機でも配線をやり直す前に電源を落とすため（§5.3.5 の手順）、この挙動を既定とする。
   */
  const restore = (
    step: { history: CommandHistory; session: BoardSession; command: SessionCommand } | undefined,
    verb: string,
  ): void => {
    if (step === undefined) return;
    const store = useStore.getState();
    store.setHistory(step.history);
    store.setSession(step.session);
    store.setPending(undefined);
    store.setSelectedWire(undefined);
    store.clearLive();
    store.addLog(`${verb}: ${step.command.label}`);
    bridge.send({ type: 'load', problemId: problem.id, session: cloneSession(step.session) });
  };

  return (
    <>
      <Toolbar
        mode={mode}
        wireColor={wireColor}
        allowedColors={session.allowedColors}
        camera={camera}
        canUndo={history.done.length > 0}
        canRedo={history.undone.length > 0}
        onMode={(next) => {
          useStore.getState().setMode(next);
        }}
        onWireColor={(color) => {
          useStore.getState().setWireColor(color);
        }}
        onCamera={(preset) => {
          useStore.getState().setCamera(preset);
        }}
        onUndo={() => {
          restore(undoHistory(history), '元に戻す');
        }}
        onRedo={() => {
          restore(redoHistory(history), 'やり直し');
        }}
        onJudge={() => {
          bridge.send({
            type: 'judge',
            problem,
            session: cloneSession(session),
            elapsedMs: useStore.getState().elapsedMs,
          });
        }}
        onBack={() => {
          useStore.getState().setRoute('list');
        }}
      >
        <PowerControls
          breakerOn={snapshot.breakerOn}
          switchOn={snapshot.switchOn}
          powered={snapshot.powered}
          tripped={snapshot.tripped}
          onBreaker={(on) => {
            bridge.send({ type: 'breaker', on });
            useStore.getState().addLog(`ブレーカ ${on ? 'ON' : 'OFF'}`);
          }}
          onSwitch={(on) => {
            bridge.send({ type: 'switch', on });
            useStore.getState().addLog(`電源スイッチ ${on ? 'ON' : 'OFF'}`);
          }}
          onResetTrip={() => {
            bridge.send({ type: 'resetTrip' });
            useStore.getState().addLog('保護復帰の手順を実行');
          }}
        />
      </Toolbar>

      <div className={styles.sessionLayout}>
        <div className={styles.viewport} data-testid="viewport">
          <BoardScene
            onPick={onPick}
            onHover={onHover}
            onPress={onPress}
            onRelease={onRelease}
          />
          <div className={styles.statusOverlay} data-testid="status-overlay">
            {snapshot.powered ? '通電中' : '無通電'} / 電線 {session.wires.length} 本 /{' '}
            {pendingTerminal === undefined ? '端子未選択' : `1本目: ${pendingTerminal}`}
            {selectedWire === undefined ? '' : ` / 選択: ${selectedWire}`}
            {snapshot.tripped ? ` / ${JA.session.tripped}` : ''}
            {webglLost ? ` / ${JA.error.webglLost}` : ''}
          </div>
        </div>

        <div className={styles.rightPanel}>
          <ProblemPanel problem={problem} />
          {spec !== undefined && spec.ok ? <TimeChartPanel chart={spec.chart} /> : null}
          {spec !== undefined && !spec.ok ? (
            <p data-testid="reference-error">模範回路エラー: {spec.errors.join(' / ')}</p>
          ) : null}
          <section className={styles.panelLive}>
            <h2 className={styles.liveTitle}>ライブ記録</h2>
            <TimeChartSvg chart={live} title="ライブ記録" />
          </section>
          <PartsPanel
            session={session}
            selectedSocket={selectedSocket}
            onSelectSocket={(socketId) => {
              useStore.getState().setSelectedSocket(socketId);
            }}
            onPlug={onPlug}
            onUnplug={onUnplug}
            onPreset={onPreset}
          />
        </div>

        <div className={styles.bottomPanel}>
          <LogPanel lines={logLines} hazards={hazards} chatters={chatters} />
          <ElapsedTimer elapsedMs={elapsedMs} limit={problem.timeLimit} />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: `apps/desktop/test/spec-chart.test.ts` を書く**

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_PROBLEMS, buildReferenceSession, judgeAssemble } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { buildSpecChart } from '../src/renderer/session/spec-chart.js';

const SELF_HOLD = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');

describe('buildSpecChart', () => {
  it('内蔵課題「自己保持回路」の仕様チャートを作れる（§7.7）', () => {
    expect(SELF_HOLD).toBeDefined();
    if (SELF_HOLD === undefined) return;
    const result = buildSpecChart(SELF_HOLD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chart.durationMs).toBe(SELF_HOLD.durationMs);
    expect(result.chart.signals.map((s) => s.name)).toEqual([
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
      'PL2',
      'PL3',
      'PL4',
    ]);
  });

  it('PL1 は押下後に点灯し、停止で消える（自己保持）', () => {
    expect(SELF_HOLD).toBeDefined();
    if (SELF_HOLD === undefined) return;
    const result = buildSpecChart(SELF_HOLD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pl1 = result.chart.signals.find((s) => s.name === 'PL1');
    expect(pl1?.segments.some((seg) => seg.value)).toBe(true);
    expect(pl1?.segments.at(0)?.value).toBe(false);
    expect(pl1?.segments.at(-1)?.value).toBe(false);
  });

  it('模範回路が組める課題はすべてチャートになる', () => {
    // 「内蔵課題の模範回路が必ず組めること」は Plan 1C の自己整合テスト（§7.8 / §14.1 #30）の担当。
    // ここで見るのは「組めた課題は必ずチャートになる」という 1D 側の変換の全域性。
    for (const problem of BUILTIN_PROBLEMS) {
      const reference = buildReferenceSession(problem, JIPM_BOARD);
      if (!reference.ok) continue;
      expect(buildSpecChart(problem).ok, problem.id).toBe(true);
    }
  });
});

describe('判定（worker が呼ぶ経路と同じ）', () => {
  it('模範回路そのままなら合格する（§7.8 自己整合）', () => {
    expect(SELF_HOLD).toBeDefined();
    if (SELF_HOLD === undefined) return;
    const reference = buildReferenceSession(SELF_HOLD, JIPM_BOARD);
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    const judged = judgeAssemble(SELF_HOLD, JIPM_BOARD, reference.value.session, {
      elapsedMs: 61_000,
    });
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(true);
    expect(judged.value.elapsedMs).toBe(61_000);
  });

  it('電線を1本外すと不合格になり差分が出る（§16 Phase 1 受入基準③）', () => {
    expect(SELF_HOLD).toBeDefined();
    if (SELF_HOLD === undefined) return;
    const reference = buildReferenceSession(SELF_HOLD, JIPM_BOARD);
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    const broken = reference.value.session;
    const target = broken.wires.find((w) => !w.locked);
    expect(target).toBeDefined();
    broken.wires = broken.wires.filter((w) => w.id !== target?.id);
    const judged = judgeAssemble(SELF_HOLD, JIPM_BOARD, broken);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: テストを実行する**

実行:

```powershell
pnpm --filter @ojt/desktop test -- spec-chart
```

期待出力:

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 5: renderer のバンドルに `node:fs` を使うコードが入っていないことを確かめる**

`@ojt/content` の `loadProblemsFromDir()` は main 専用である。ビルド時に「`node:fs` has been externalized」という警告は出るが（resolve 時の警告で、tree-shaking はその後に効く）、出力には含まれない。

実行:

```powershell
pnpm --filter @ojt/desktop build
Select-String -Path apps/desktop/out/renderer/assets/*.js -Pattern 'loadProblemsFromDir','readdirSync'
```

期待出力:

```text
（何も出力されない＝バンドルに含まれていない）
```

- [ ] **Step 6: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/session/spec-chart.ts` `apps/desktop/src/renderer/screens/Session.tsx` `apps/desktop/test/spec-chart.test.ts`

```powershell
git add apps/desktop/src/renderer/session/spec-chart.ts apps/desktop/src/renderer/screens/Session.tsx apps/desktop/test/spec-chart.test.ts
git commit -m @'
feat(desktop): wire the session screen to the board and worker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 15: 結果画面

**Files:**
- Create: `apps/desktop/src/renderer/result/result.module.css`, `ChartOverlay.tsx`, `MismatchList.tsx`, `StaticCheckList.tsx`, `ResultView.tsx`, `apps/desktop/src/renderer/screens/Result.tsx`
- Test: `apps/desktop/test/result-view.test.tsx`


- [ ] **Step 1: `apps/desktop/src/renderer/result/result.module.css` を書く**

```css
/* 結果画面。設計仕様 §8.3。 */

.wrap {
  height: 100%;
  overflow-y: auto;
  padding: 16px 24px 32px;
}

.header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}

.verdict {
  border-radius: 6px;
  font-size: 24px;
  font-weight: 700;
  padding: 6px 24px;
}

.passed {
  background: var(--ok);
  color: #0d1a10;
}

.failed {
  background: var(--ng);
  color: #1c0c0c;
}

.grid {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(360px, 1fr);
  gap: 16px;
}

.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px 12px;
}

.card h3 {
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 8px;
}

.table {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
}

.table th,
.table td {
  border-bottom: 1px solid var(--line);
  padding: 3px 6px;
  text-align: left;
}

.checkRow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
}

.badgeOk {
  background: var(--ok);
  border-radius: 3px;
  color: #0d1a10;
  font-size: 11px;
  padding: 1px 6px;
}

.badgeNg {
  background: var(--ng);
  border-radius: 3px;
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
}

.detail {
  color: var(--muted);
  font-size: 11px;
  margin: 0 0 0 12px;
  padding-left: 12px;
}

.overlayExpected {
  stroke: rgba(231, 235, 242, 0.38);
  stroke-width: 3;
  fill: none;
}

.overlayActual {
  stroke: var(--accent);
  stroke-width: 1.6;
  fill: none;
}

.forbidden {
  background: rgba(232, 194, 42, 0.15);
  border-left: 4px solid var(--warn);
  margin-top: 8px;
  padding: 8px 10px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
```

- [ ] **Step 2: `apps/desktop/src/renderer/result/ChartOverlay.tsx` を書く**

```tsx
import type { TimeChart } from '@ojt/content';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import {
  LABEL_WIDTH,
  PLOT_WIDTH,
  ROW_HEIGHT,
  waveformPoints,
} from '../panels/TimeChartPanel.js';
import panels from '../panels/panels.module.css';
import styles from './result.module.css';

/**
 * 模範波形と訓練者波形の重ね表示。設計仕様 §8.3。
 * 模範＝薄色の太線、訓練者＝濃色の細線。`waveformPoints()` はライブチャートと共用する。
 */

/** チャート重ね表示。 */
export function ChartOverlay({
  expected,
  actual,
}: {
  expected: TimeChart;
  actual: TimeChart;
}): JSX.Element {
  const height = expected.signals.length * ROW_HEIGHT + 16;
  const width = LABEL_WIDTH + PLOT_WIDTH + 8;
  const actualByName = new Map(actual.signals.map((s) => [s.name, s] as const));
  return (
    <div className={styles.card}>
      <h3>{JA.result.chartOverlay}</h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={JA.result.chartOverlay}
        data-testid="chart-overlay"
        style={{ width: '100%' }}
      >
        {expected.signals.map((signal, index) => {
          const baseY = (index + 1) * ROW_HEIGHT;
          const mine = actualByName.get(signal.name);
          return (
            <g key={signal.name}>
              <text className={panels.chartRowLabel} x={0} y={baseY} dominantBaseline="middle">
                {signal.label}
              </text>
              <line
                className={panels.chartAxis}
                x1={LABEL_WIDTH}
                y1={baseY + 2}
                x2={LABEL_WIDTH + PLOT_WIDTH}
                y2={baseY + 2}
              />
              <polyline
                className={styles.overlayExpected}
                points={waveformPoints(signal.segments, expected.durationMs, baseY)}
              />
              {mine === undefined ? null : (
                <polyline
                  className={styles.overlayActual}
                  points={waveformPoints(mine.segments, actual.durationMs, baseY)}
                />
              )}
            </g>
          );
        })}
        {expected.markers.map((marker) => (
          <g key={`${marker.label}-${marker.tMs}`}>
            <line
              className={panels.chartMarker}
              x1={LABEL_WIDTH + (marker.tMs / expected.durationMs) * PLOT_WIDTH}
              y1={4}
              x2={LABEL_WIDTH + (marker.tMs / expected.durationMs) * PLOT_WIDTH}
              y2={height - 12}
            />
            <text
              className={panels.chartRowLabel}
              x={LABEL_WIDTH + (marker.tMs / expected.durationMs) * PLOT_WIDTH + 2}
              y={height - 3}
            >
              {marker.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: `apps/desktop/src/renderer/result/MismatchList.tsx` を書く**

```tsx
import type { Mismatch } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { JA, signalLabel } from '../i18n/ja.js';
import styles from './result.module.css';

/**
 * 差分一覧（時刻・信号・期待・実際）。設計仕様 §8.3。
 * 許容差を超えた遷移だけが `compareLogs()` から返ってくるので、そのまま並べる。
 */

/** ミリ秒を `1.23 s` の形にする。 */
export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

/** 差分一覧。 */
export function MismatchList({ mismatches }: { mismatches: readonly Mismatch[] }): JSX.Element {
  return (
    <div className={styles.card}>
      <h3>
        {JA.result.mismatches}（{mismatches.length}）
      </h3>
      {mismatches.length === 0 ? (
        <p data-testid="no-mismatch">{JA.result.noMismatch}</p>
      ) : (
        <table className={styles.table} data-testid="mismatch-table">
          <thead>
            <tr>
              <th>{JA.result.time}</th>
              <th>{JA.result.signal}</th>
              <th>{JA.result.expected}</th>
              <th>{JA.result.actual}</th>
              <th>{JA.result.reason}</th>
            </tr>
          </thead>
          <tbody>
            {mismatches.map((mismatch, index) => (
              <tr key={`${mismatch.signal}-${mismatch.tMs}-${index}`}>
                <td>{formatMs(mismatch.tMs)}</td>
                <td>{mismatch.signal}</td>
                <td>{signalLabel(mismatch.expected)}</td>
                <td>
                  {signalLabel(mismatch.actual)}
                  {mismatch.actualTMs === undefined ? '' : `（${formatMs(mismatch.actualTMs)}）`}
                </td>
                <td>{JA.mismatchReason[mismatch.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `apps/desktop/src/renderer/result/StaticCheckList.tsx` を書く**

```tsx
import type { HazardCounts, StaticCheckResult } from '@ojt/content';
import type { HazardKind } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './result.module.css';

/**
 * 静的チェック結果と危険操作の回数。設計仕様 §7.4 / §8.3。
 * 合否には静的チェックだけが効き、危険操作回数と所要時間は参考表示に留める（§17.2 #3）。
 */

/** 静的チェック一覧。 */
export function StaticCheckList({ checks }: { checks: readonly StaticCheckResult[] }): JSX.Element {
  return (
    <div className={styles.card}>
      <h3>{JA.result.staticChecks}</h3>
      <div data-testid="static-checks">
        {checks.map((check) => (
          <div key={check.id}>
            <div className={styles.checkRow}>
              <span className={check.ok ? styles.badgeOk : styles.badgeNg}>
                {check.ok ? 'OK' : 'エラー'}
              </span>
              <span>{JA.staticCheck[check.id]}</span>
              <span className={styles.detail}>{check.message}</span>
            </div>
            {check.details.length === 0 ? null : (
              <ul className={styles.detail}>
                {check.details.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 危険操作の種別ごとの回数。§5.6 / §8.3 */
export function HazardList({
  counts,
  total,
}: {
  counts: HazardCounts;
  total: number;
}): JSX.Element {
  const rows = (Object.keys(counts) as HazardKind[]).filter((kind) => counts[kind] > 0);
  return (
    <div className={styles.card}>
      <h3>
        {JA.result.hazards}（{total}）
      </h3>
      {rows.length === 0 ? (
        <p>{JA.result.hazardNone}</p>
      ) : (
        <table className={styles.table} data-testid="hazard-table">
          <tbody>
            {rows.map((kind) => (
              <tr key={kind}>
                <td>{JA.hazard[kind]}</td>
                <td>{counts[kind]} 回</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `apps/desktop/src/renderer/result/ResultView.tsx` を書く**

```tsx
import type { AssembleProblem, JudgeResult } from '@ojt/content';
import type { JSX } from 'react';
import { formatElapsed } from '../../worker/runtime.js';
import { JA } from '../i18n/ja.js';
import { ChartOverlay } from './ChartOverlay.js';
import { MismatchList } from './MismatchList.js';
import { HazardList, StaticCheckList } from './StaticCheckList.js';
import styles from './result.module.css';

/**
 * 結果画面。設計仕様 §8.3。
 * 合否／差分一覧／チャート重ね表示／静的チェック／危険操作／所要時間の6点を並べる。
 * チャタリングを検出していたら禁則回路の明示警告を出す。
 */

/** 所要時間と標準・打切り時間の対比文。§8.3 */
export function elapsedSummary(elapsedMs: number, standardMin: number, cutoffMin: number): string {
  const standardMs = standardMin * 60_000;
  const cutoffMs = cutoffMin * 60_000;
  if (elapsedMs > cutoffMs) return `${JA.result.cutoffMark}（${cutoffMin}分）を超過`;
  if (elapsedMs > standardMs) return `${JA.result.standardMark}（${standardMin}分）を超過`;
  return `${JA.result.standardMark}（${standardMin}分）以内`;
}

/** 結果画面の本体。 */
export function ResultView({
  problem,
  result,
  onRetry,
  onBackToList,
}: {
  problem: AssembleProblem;
  result: JudgeResult;
  onRetry: () => void;
  onBackToList: () => void;
}): JSX.Element {
  const elapsedMs = result.elapsedMs ?? 0;
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span
          className={`${styles.verdict} ${result.passed ? styles.passed : styles.failed}`}
          data-testid="verdict"
        >
          {result.passed ? JA.result.passed : JA.result.failed}
        </span>
        <h1 style={{ fontSize: 18, margin: 0 }}>
          {JA.result.title}: {problem.title}
        </h1>
        <span data-testid="result-elapsed">
          {JA.result.elapsed} {formatElapsed(elapsedMs)}（
          {elapsedSummary(elapsedMs, problem.timeLimit.standardMin, problem.timeLimit.cutoffMin)}）
        </span>
      </div>

      {result.chatter.length === 0 ? null : (
        <p className={styles.forbidden} data-testid="forbidden-warning">
          {JA.result.forbidden}
        </p>
      )}

      <div className={styles.grid}>
        <ChartOverlay expected={result.charts.expected} actual={result.charts.actual} />
        <MismatchList mismatches={result.mismatches} />
        <StaticCheckList checks={result.staticChecks} />
        <HazardList counts={result.hazardsByKind} total={result.hazardCount} />
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={onRetry}>
          {JA.result.retry}
        </button>
        <button type="button" onClick={onBackToList}>
          {JA.result.toList}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `apps/desktop/src/renderer/screens/Result.tsx` を書く**

```tsx
import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { ResultView } from '../result/ResultView.js';
import styles from './screens.module.css';

/**
 * 結果画面のルート。設計仕様 §8.3 / §12.1。
 * 判定結果が無いのに開かれた場合は課題一覧へ戻す導線だけを出す。
 */

/** 結果画面。 */
export function Result(): JSX.Element {
  const problem = useStore((s) => s.problem);
  const judge = useStore((s) => s.judge);
  const setRoute = useStore((s) => s.setRoute);
  const resetSession = useStore((s) => s.resetSession);

  if (problem === undefined || judge === undefined) {
    return (
      <div className={styles.center}>
        <p>判定結果がありません。</p>
        <button
          type="button"
          onClick={() => {
            setRoute('list');
          }}
        >
          課題一覧へ
        </button>
      </div>
    );
  }

  return (
    <ResultView
      problem={problem}
      result={judge}
      onRetry={() => {
        resetSession();
      }}
      onBackToList={() => {
        setRoute('list');
      }}
    />
  );
}
```

- [ ] **Step 7: `apps/desktop/test/result-view.test.tsx` を書く**

```tsx
import { JIPM_BOARD } from '@ojt/board-model';
import { BUILTIN_PROBLEMS, buildReferenceSession, judgeAssemble } from '@ojt/content';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ResultView } from '../src/renderer/result/ResultView.js';

/**
 * 結果画面の表示テスト（§14.2 の「UI: Vitest ＋ Testing Library」）。
 * 判定結果は実物の `judgeAssemble()` から作り、画面がその中身をそのまま出すことを確かめる。
 */

afterEach(cleanup);

const PROBLEM = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');

function judgeWith(mutate: (session: ReturnType<typeof reference>) => void = () => undefined) {
  const session = reference();
  mutate(session);
  if (PROBLEM === undefined) throw new Error('b-001 が見つかりません');
  const result = judgeAssemble(PROBLEM, JIPM_BOARD, session, { elapsedMs: 90_000 });
  if (!result.ok) throw new Error('模範回路を作れませんでした');
  return result.value;
}

function reference() {
  if (PROBLEM === undefined) throw new Error('b-001 が見つかりません');
  const built = buildReferenceSession(PROBLEM, JIPM_BOARD);
  if (!built.ok) throw new Error('模範回路を作れませんでした');
  return built.value.session;
}

describe('ResultView', () => {
  it('模範回路そのままなら合格を出し、差分一覧は空になる（§8.3）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('合格');
    expect(screen.getByTestId('no-mismatch')).toBeTruthy();
    expect(screen.getByTestId('chart-overlay')).toBeTruthy();
    expect(screen.getByTestId('static-checks')).toBeTruthy();
  });

  it('電線を1本外すと不合格になり差分表が出る（§16 Phase 1 受入基準③）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith((session) => {
          const target = session.wires.find((w) => !w.locked);
          session.wires = session.wires.filter((w) => w.id !== target?.id);
        })}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('verdict').textContent).toBe('不合格');
    expect(screen.getByTestId('mismatch-table')).toBeTruthy();
  });

  it('所要時間を標準時間との対比付きで出す（§8.3）', () => {
    if (PROBLEM === undefined) return;
    render(
      <ResultView
        problem={PROBLEM}
        result={judgeWith()}
        onRetry={() => undefined}
        onBackToList={() => undefined}
      />,
    );
    expect(screen.getByTestId('result-elapsed').textContent).toContain('01:30.0');
    expect(screen.getByTestId('result-elapsed').textContent).toContain('標準時間');
  });
});
```

- [ ] **Step 8: 単体テストをすべて実行する**

実行:

```powershell
pnpm --filter @ojt/desktop test
```

期待出力:

```text
 Test Files  10 passed (10)
      Tests  101 passed (101)
```

- [ ] **Step 9: lint と型チェックを通す**

実行:

```powershell
pnpm lint
pnpm --filter @ojt/desktop typecheck
```

期待出力:

```text
（どちらも何も出力されない＝成功）
```

- [ ] **Step 10: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/result` `apps/desktop/src/renderer/screens/Result.tsx` `apps/desktop/test/result-view.test.tsx`

```powershell
git add apps/desktop/src/renderer/result apps/desktop/src/renderer/screens/Result.tsx apps/desktop/test/result-view.test.tsx
git commit -m @'
feat(desktop): add judge result screen with chart overlay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 16: Playwright + Electron のスモーク

**Files:**
- Create: `apps/desktop/playwright.config.ts`, `apps/desktop/e2e/projection.ts`, `apps/desktop/e2e/smoke.spec.ts`

仕様 §14.2 の E2E ①「起動 → 課題選択 → 配線 → 通電 → 判定 → 結果」を自動化し、3D盤のスクリーンショットを残す。

**WebGL について**: CI やリモートデスクトップでは GPU が無いことがあるため Chromium に `--use-gl=swiftshader --use-angle=swiftshader --enable-unsafe-swiftshader` を渡してソフトウェアラスタライザで描かせる。GPU のある実機でも同じフラグで動く（検証環境では SwiftShader / Adreno のどちらでも成功した）。

**スクリーンショットについて**: Playwright の `page.screenshot()` は Electron のウィンドウが他ウィンドウに隠れていると `Unable to capture screenshot` で落ちることがあるため、`BrowserWindow.capturePage()` を使う。表示直後はコンポジタがまだフレームを出しておらず `UnknownVizError` になるので、`beforeAll` で 1.5 秒待つ。


- [ ] **Step 1: `apps/desktop/playwright.config.ts` を書く**

```ts
import { defineConfig } from '@playwright/test';

/**
 * Playwright（Electron ランナー）。設計仕様 §14.2。
 * `_electron.launch()` で out/ のビルド成果物を起動するため、E2E の前に
 * `pnpm --filter @ojt/desktop build` を済ませておく。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results',
});
```

- [ ] **Step 2: `apps/desktop/e2e/projection.ts` を書く**

端子の画面座標はアプリ側の `cameraPose()` と `boardToWorld()` をそのまま使って射影するので、カメラ設定や筐体の傾斜角を変えてもテストが追随する。

```ts
import { boardTerminalPos, JIPM_BOARD } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  boardToWorld,
  CAMERA_FOV_DEG,
  cameraPose,
  type CameraPose,
} from '../src/renderer/three/camera.js';
import { toScene } from '../src/renderer/three/coords.js';

/**
 * 3D盤の端子をピクセル座標へ射影する（E2E用）。設計仕様 §12.2 / §14.2。
 * アプリ側の視点プリセット（`cameraPose`）と盤の傾き（`boardToWorld`）をそのまま参照するので、
 * カメラ設定や筐体の傾斜角を変えてもテストが追随する。
 */

/** キャンバスの矩形（Playwright の `boundingBox()` の戻り）。 */
export interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Vec = readonly [number, number, number];

function sub(a: Vec, b: Vec): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec, b: Vec): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

/** ワールド座標 → ページ座標（透視投影。カメラは -Z を向く three の規約に合わせる）。 */
export function projectToScreen(
  world: Vec,
  pose: CameraPose,
  box: CanvasBox,
): { x: number; y: number } {
  const forward = normalize(sub(pose.target, pose.position));
  const right = normalize(cross(forward, pose.up));
  const up = cross(right, forward);
  const relative = sub(world, pose.position);
  const depth = dot(relative, forward);
  const halfHeight = Math.tan((CAMERA_FOV_DEG / 2) * (Math.PI / 180));
  const halfWidth = halfHeight * (box.width / box.height);
  const ndcX = dot(relative, right) / (depth * halfWidth);
  const ndcY = dot(relative, up) / (depth * halfHeight);
  return {
    x: box.x + ((ndcX + 1) / 2) * box.width,
    y: box.y + ((1 - ndcY) / 2) * box.height,
  };
}

/** 盤の**物理**端子IDの中心が来るページ座標（正面視プリセット前提）。 */
export function terminalPoint(terminal: TerminalId, box: CanvasBox): { x: number; y: number } {
  const world = boardToWorld(toScene(boardTerminalPos(JIPM_BOARD, terminal)));
  return projectToScreen(world, cameraPose('front'), box);
}

/** 盤ローカル座標（mm）を指定してページ座標を得る（ソケット台座の縁など）。 */
export function boardPoint(
  point: { x: number; y: number; z: number },
  box: CanvasBox,
): { x: number; y: number } {
  return projectToScreen(boardToWorld(toScene(point)), cameraPose('front'), box);
}

/**
 * 内蔵課題 b-001「自己保持回路」の模範配線（9本）。
 * `buildReferenceSession()` が生成する配線と同じ組み合わせを、**物理**端子IDで書き下したもの。
 *
 * P/N 供給端子は `P.1` / `N.1` の各1点しかなく、うち1本はチェック用の固定配線が使うので、
 * 訓練者が母線から直接取れるのは各1本だけ（§6.1）。母線は**渡り配線**で分配する
 * （`P.1 → TB_PB.2c → S1.10`、`N.1 → S1.13 → TB_PL.1-` の鎖）。
 */
export const SELF_HOLD_WIRES: ReadonlyArray<readonly [string, string]> = [
  ['P.1', 'TB_PB.2c'],
  ['TB_PB.2c', 'S1.10'],
  ['TB_PB.2b', 'TB_PB.1c'],
  ['TB_PB.1c', 'S1.9'],
  ['TB_PB.1a', 'S1.14'],
  ['S1.14', 'S1.5'],
  ['N.1', 'S1.13'],
  ['S1.13', 'TB_PL.1-'],
  ['S1.6', 'TB_PL.1+'],
];
```

- [ ] **Step 3: `apps/desktop/e2e/smoke.spec.ts` を書く**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { boardPoint, SELF_HOLD_WIRES, terminalPoint, type CanvasBox } from './projection.js';

/**
 * Electron スモーク（§14.2 の E2E ①）。設計仕様 §16 Phase 1 受入基準①〜③。
 * 「起動 → 課題選択 → 配線 → 通電 → 判定 → 結果」を自動操作し、3D盤のスクリーンショットを残す。
 *
 * WebGL: CI やリモートデスクトップでは GPU が無いことがあるため、Chromium に
 * `--use-gl=swiftshader --use-angle=swiftshader --enable-unsafe-swiftshader` を渡して
 * ソフトウェアラスタライザで描かせる。GPU のある実機でも同じフラグで動く。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

/**
 * スクリーンショットは `BrowserWindow.capturePage()` で撮る。
 * Playwright の `page.screenshot()` は Electron のウィンドウが他ウィンドウに隠れていると
 * `Unable to capture screenshot` で失敗することがあるが、`capturePage()` は
 * コンポジタから直接取るので隠れていても撮れる（WebGL の描画内容も入る）。
 */
async function shot(app: ElectronApplication, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error('ウィンドウがありません');
    const image = await window.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(base64, 'base64'));
}

async function canvasBox(page: Page): Promise<CanvasBox> {
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('キャンバスの矩形を取得できませんでした');
  return box;
}

/**
 * ソケット S1 の台座の左端（端子より外側の余白）。盤ローカル mm。
 * `JIPM_BOARD` のソケット原点とピッチから求めるので、配置が変わっても追随する。
 */
function socketEdgePoint(): { x: number; y: number; z: number } {
  const socket = JIPM_BOARD.sockets[0];
  if (socket === undefined) throw new Error('ソケットが定義されていません');
  // 本体の中央（差込領域）。ネジ端子のティアから離れているのでソケット本体が拾える
  return {
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: 9,
  };
}

/** 端子を1つクリックする（正面視プリセット前提の射影）。矩形は1度だけ測って使い回す。 */
async function clickTerminal(page: Page, box: CanvasBox, terminal: string): Promise<void> {
  const point = terminalPoint(toTerminalId(terminal), box);
  await page.mouse.click(point.x, point.y);
}

test.describe('モードB スモーク', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [join(APP_ROOT, 'out', 'main', 'index.js'), ...CHROMIUM_FLAGS],
      env: { ...process.env, NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // ウィンドウは `ready-to-show` まで非表示なので、スクリーンショットが撮れるよう
    // 明示的に表示して大きさを固定する（Electron のページに setViewportSize は効かない）。
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('ウィンドウがありません');
      window.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
      window.show();
      window.focus();
    });
    // 表示直後はコンポジタがまだフレームを出しておらず `capturePage()` が
    // `UnknownVizError` になることがあるので、最初の1フレームを待つ。
    await page.waitForTimeout(1500);
    // 前回の実行が残した一時保存があると復元プロンプトが出るので、先に片付ける（§12.3）
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) {
      await page.getByRole('button', { name: '復元しない' }).click();
    }
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('ホーム → 課題一覧 → 課題を開く → 配線 → 判定 → 結果画面', async () => {
    // ① ホーム（§12.1）
    await expect(page.getByTestId('mode-assemble')).toBeVisible();
    await shot(app, '01-home');

    // ② 課題一覧（§12.1）
    await page.getByTestId('mode-assemble').click();
    await expect(page.getByTestId('problem-table')).toBeVisible();
    await expect(page.getByTestId('open-b-001')).toBeVisible();
    await shot(app, '02-problem-list');

    // ③ 課題を開く → 3D盤（§8.1）
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await expect(page.getByTestId('status-overlay')).toContainText('電線 3 本');
    // WebGL の初期化とシーンの1フレーム目を待つ
    await expect
      .poll(async () => page.locator('[data-testid="viewport"] canvas').count(), { timeout: 30_000 })
      .toBe(1);
    await page.waitForTimeout(1500);
    await shot(app, '03-board-3d');

    // ④ ソケット S1 にリレーを装着する（3Dでソケット台座をクリック → 部品パネル）（§8.2）
    const box = await canvasBox(page);
    // S1 台座の左端（端子より外側の余白。盤ローカル mm で指定する）をクリックする
    const socketEdge = boardPoint(socketEdgePoint(), box);
    await page.mouse.click(socketEdge.x, socketEdge.y);
    await expect(page.getByText('S1（CR1）を選択中')).toBeVisible();
    await page.getByRole('button', { name: '装着' }).first().click();
    await expect(page.getByTestId('operation-log')).toContainText('S1 に relay-my4n を装着');
    await shot(app, '04-relay-mounted');

    // ⑤ 端子クリックで模範どおりに配線する（§8.2）
    for (const [from, to] of SELF_HOLD_WIRES) {
      await clickTerminal(page, box, from);
      await clickTerminal(page, box, to);
    }
    await expect(page.getByTestId('status-overlay')).toContainText('電線 12 本');
    await shot(app, '05-wired');

    // ⑤-1 配線帯で束になって直角に走る様子をソケット拡大で1枚撮る（§6.6）
    await page.getByRole('button', { name: 'ソケット拡大' }).click();
    await page.waitForTimeout(900);
    await shot(app, '05a-wire-bundle');
    await page.getByRole('button', { name: '正面' }).click();
    await page.waitForTimeout(600);

    // ⑤-2 実物写真と同じ斜め俯瞰で1枚撮る（§12.2 の俯瞰プリセット）
    await page.getByRole('button', { name: '俯瞰' }).click();
    await page.waitForTimeout(900);
    await shot(app, '05b-board-birdseye');
    await page.getByRole('button', { name: '正面' }).click();
    await page.waitForTimeout(600);

    // ⑥ ブレーカ → 電源スイッチ の順に通電（§5.3.5）
    await page.getByRole('button', { name: 'ブレーカ' }).click();
    await page.getByRole('button', { name: '電源スイッチ' }).click();
    await expect(page.getByTestId('status-overlay')).toContainText('通電中');
    await shot(app, '06-powered');

    // ⑦ 判定 → 結果画面（§8.3 / §16 Phase 1 受入基準②）
    await page.getByRole('button', { name: '判定' }).click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    await expect(page.getByTestId('verdict')).toHaveText('合格');
    await expect(page.getByTestId('chart-overlay')).toBeVisible();
    await expect(page.getByTestId('no-mismatch')).toBeVisible();
    await shot(app, '07-result-pass');

    // ⑧ 1本外して判定すると不合格になる（§16 Phase 1 受入基準③）
    await page.getByRole('button', { name: 'もう一度' }).click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.waitForTimeout(500);
    const retryBox = await canvasBox(page);
    const edge = boardPoint(socketEdgePoint(), retryBox);
    await page.mouse.click(edge.x, edge.y);
    await page.getByRole('button', { name: '装着' }).first().click();
    for (const [from, to] of SELF_HOLD_WIRES.slice(0, -1)) {
      await clickTerminal(page, retryBox, from);
      await clickTerminal(page, retryBox, to);
    }
    await expect(page.getByTestId('status-overlay')).toContainText('電線 11 本');
    await page.getByRole('button', { name: '判定' }).click();
    await expect(page.getByTestId('verdict')).toHaveText('不合格');
    await expect(page.getByTestId('mismatch-table')).toBeVisible();
    await shot(app, '08-result-fail');
  });
});
```

- [ ] **Step 4: ビルドして E2E を実行する**

実行:

```powershell
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop e2e
```

期待出力:

```text
Running 1 test using 1 worker

  ✓  1 e2e\smoke.spec.ts:107:3 › モードB スモーク › ホーム → 課題一覧 → 課題を開く → 配線 → 判定 → 結果画面 (1.3m)

  1 passed
```

- [ ] **Step 5: スクリーンショットを目視する**

`apps/desktop/screenshots/` に8枚出る。`03-board-3d.png` に傾斜コンソールの盤・左右4個ずつのソケット・端子の番号が写っていること、`05a-wire-bundle.png` で配線が束になって直角に走りソケットの上を横切っていないこと、`05b-board-birdseye.png` が実物写真に近い俯瞰であること、`07-result-pass.png` が「合格」とチャート重ね表示になっていることを確かめる。

実行:

```powershell
Get-ChildItem apps/desktop/screenshots | Select-Object -ExpandProperty Name
```

期待出力:

```text
01-home.png
02-problem-list.png
03-board-3d.png
04-relay-mounted.png
05-wired.png
05a-wire-bundle.png
05b-board-birdseye.png
06-powered.png
07-result-pass.png
08-result-fail.png
```

- [ ] **Step 6: スクリーンショットを git に含めない**

`apps/desktop/.gitignore` を作る。

```text
out/
release/
screenshots/
test-results/
```

- [ ] **Step 7: コミットする**

追加・変更したファイル: `apps/desktop/playwright.config.ts` `apps/desktop/e2e` `apps/desktop/.gitignore`

```powershell
git add apps/desktop/playwright.config.ts apps/desktop/e2e apps/desktop/.gitignore
git commit -m @'
test(desktop): add electron smoke e2e for the assemble mode

ホーム→課題一覧→配線→通電→判定→結果を自動操作し、3D盤のスクリーンショットを残す。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## 仕様との対応表（Plan 1D1 / 1D2 のどちらで満たすか）

| 仕様 | 内容 | 1D1 | 1D2 |
|---|---|---|---|
| §4.3 | main / preload / renderer の責務と6チャネルのIPC | Task 2 | — |
| §4.3 | Simulation Worker（コマンド／`snapshot`／`judgeResult`／`error`） | Task 3・4・5 | — |
| §6.2 | ソケットの4段配置・非連番（段4に④）・ピン割付の再現 | Task 10（`SOCKET_PIN_GRID` と `board.terminals` から生成） | — |
| §6.5 | 傾斜コンソール・DINレール・端子の当たり判定（`pickRadiusMm`） | Task 9・10 | — |
| §6.6 | 直角配線・2mmピッチの並走・Y型圧着端子・部品の上を跨がない | Task 11 | — |
| §8.1 | 画面構成（中央3D・右パネル・下部・上部ツールバー） | Task 13・14 | — |
| §8.1 | 線色パレット（モードBは青のみ） | Task 13（`session.allowedColors` から生成） | — |
| §8.2 | 端子ホバーのツールチップ `CR1 ⑨ COM` | Task 10 | — |
| §8.2 | 配線（線色→端子→端子）・取消（Esc／空間クリック）・電線の選択と削除 | Task 7・14 | — |
| §6.1 | P/N 供給端子は各1点。母線は渡り配線で分配する | Task 11・16（テストとE2Eの模範配線が鎖になっている） | — |
| §8.2 | 元に戻す／やり直し（上限50手） | Task 8・14 | — |
| §8.2 | 部品装着・取り外し・タイマ設定（ダイヤル＋数値入力） | Task 13・14 | — |
| §8.2 | 通電（ブレーカ→スイッチ）・PB操作（押しっぱなし保持） | Task 13・14 | — |
| §8.2 | フィードバック（PL発光・CR/Tの動作表示・ライブのタイムチャート） | Task 10・13・14 | — |
| §8.2 | 動作音（WebAudio合成） | — | Task 5 |
| §8.3 | 判定（Worker内で模範と訓練者を並走）・結果画面の6項目 | Task 4・15 | — |
| §8.4 | 回路図ヒント（級による出し分け） | — | Task 6 |
| §12.1 | 画面遷移（ホーム／課題一覧／セッション／結果） | Task 6・14・15 | — |
| §12.1 | 設定画面 | — | Task 2 |
| §12.2 | 3Dカメラ（軌道回転・ズーム・平行移動・プリセット3種・キー1/2/3） | Task 12・14 | — |
| §12.2 | ピック結果 → 操作の純粋関数化 | Task 7 | — |
| §12.3 | 作業ファイルの保存／読込・一時保存・起動時の復帰 | IPC の口のみ（Task 2） | Task 3・4 |
| §13 #1 | 課題JSONの読込エラーを一覧に理由付きで出す | — | Task 1 |
| §13 #4 | WebGLコンテキスト消失からの再初期化 | Task 12（`BoardScene` の `onCreated`） | — |
| §13 #5 | renderer の未捕捉例外バナーとリセット | Task 6 | — |
| §13 #8 | 作業ファイルの `formatVersion` 不整合 | Task 2（`parseWorkFile`） | Task 3 |
| §13 #9 | 利用者課題フォルダが無いときの警告 | — | Task 1 |
| §14.2 | 純粋関数の単体テスト（`pickToAction` / 経路 / チャート / カメラ） | Task 7・8・9・11・13 | — |
| §14.2 | UIテスト（Vitest ＋ Testing Library） | Task 15 | — |
| §14.2 | E2E ①（起動→課題選択→配線→通電→判定→結果） | Task 16 | Task 8 で拡充 |
| §15 | 性能（`frameloop="demand"`・共有ジオメトリ・Worker分離） | Task 12 | — |
| §15 | 日本語文言の集約 | Task 6 | — |
| §15 | 配布（electron-builder の NSIS ＋ ポータブル） | — | Task 7 |
| §16 Phase 1 受入基準① | 課題を選び装着・配線・通電してPL1が点灯する | Task 16（E2E で自動確認） | — |
| §16 Phase 1 受入基準② | 判定で合格が出てチャートが重ね表示される | Task 16 | — |
| §16 Phase 1 受入基準③ | 1本外すと不合格になり差分一覧に出る | Task 16 | — |
| §16 Phase 1 受入基準④ | `pnpm -r test` が全て通る | Task 15・16 | — |

---

## 意図的な差分（仕様の文面と実装が違う点と理由）

| # | 仕様の文面 | 実装 | 理由 |
|---|---|---|---|
| 1 | §8.2「電線クリックで選択、Delete で削除」 | 電線のレイキャストは**削除モードのときだけ**有効。配線モードでは電線がクリックを拾わない | 配線帯を走る電線が端子の手前を通るため、配線モードでも拾えるようにすると「クリックできない端子」が生まれる。選択は削除のための操作なので、削除モードに限っても操作の目的を損なわない |
| 2 | §8.2「配線・部品装着・タイマ設定の全操作を対象に、上限50手」 | 元に戻す／やり直しは**盤を作り直す**ため無通電に戻る | 実機でも配線をやり直す前に電源を落とす（§5.3.5 の手順）。Worker のネットリストを作り直す実装とも一致する |
| 3 | §4.3「コマンド: `mountPart` / `unmountPart`」 | `plug` / `unplug` という名前にし、**更新後のセッションも一緒に載せる** | 適用自体は `Simulation.mountPart()` / `unmountPart()` の差分API（`tMs`・ログ・イベントを保つ）で行う。セッションを添えるのは、Worker 側が持つ盤の状態を renderer と一致させておくため（判定のときに作り直す必要が出ない） |
| 4 | §4.3「コマンド: `setPower`」 | `breaker` / `switch` の2コマンドに分ける | 仕様 §5.3.5 は「ブレーカ → 電源スイッチ」の**順序**を危険操作の判定に使う。1コマンドにまとめると順序が表現できない |
| 5 | §4.3「通知: `event`」 | `snapshot` に `hazardDelta` / `chatterDelta` を載せる | イベントは必ず tick に紐づくので、スナップショットと別便にすると UI 側で時刻の突き合わせが要る。1本にまとめると順序が保証される |
| 6 | §6.3「チェック用回路の線色は黄」 | 3Dでは既設配線をすべて**青**で描く（データ上の色は黄のまま） | 実物写真の既設配線はすべて青。線色ルールの静的チェックは Plan 1C 側の定数で見るため、3Dの表示色を変えても判定は変わらない |
| 7 | §12.2「プリセット3種（正面／俯瞰／ソケット拡大）」 | 3種に加えて左上にビューキューブ（`ViewGizmo`）を置く | 3Dの向きが分からなくなるという実使用上の問題への対処。プリセットのボタンは仕様どおり残す |

---

## 完了条件

- [ ] `pnpm --filter @ojt/desktop typecheck` が無出力で終わる
- [ ] `pnpm lint` が無出力で終わる
- [ ] `pnpm --filter @ojt/desktop test` が **10ファイル / 101テスト** すべて通る
- [ ] `pnpm --filter @ojt/desktop build` が main / preload / renderer の3つを出力する
- [ ] `pnpm --filter @ojt/desktop e2e` のスモーク1本が通る
- [ ] `apps/desktop/screenshots/` に10枚のスクリーンショットが出て、`03-board-3d.png` に3D盤（傾斜コンソール・左右4個ずつのソケット・端子番号）が写っている
- [ ] `pnpm -r test` が全パッケージで通る
- [ ] 3D盤に電線を張ったとき、`WireRoute.laneOverflow` が立った電線が琥珀色で描かれる（重なりに気づける）
- [ ] `routeSession()` が `RoutingError` を投げても3D盤は描かれ続け、どの電線がなぜ描けないかがトーストとログに出る

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-14 | 初版 |
| 2026-09-14 | 実装された `@ojt/board-model` の経路器（Task 9 / 9b / 9c / 9d）に合わせて整合を取った。①`WireRoute` の項目を実装どおり（`kind` / `points` / `corners` / `channelIds` / `lanes: ChannelLane[]` / `lane` / `laneOverflow` / `throughPanelAt?` / `lengthMm`）に書き換えた。`channelSpans` は存在せず、占有区間は `lanes[i].span`（レーンずらし前の節点座標）なので**描画には使わない**ことを前提表に明記（Task 11）。②走行高さが「全部同じ 2.4mm」から**高さのはしご** `WIRE_Z_LADDER_MM = [2.4, 4.2, 6.0, 7.8]`（x方向は段0・2、y方向は段1・3、レイヤは `runZ(axis, layer)`）に変わったので、Task 11 のテストの `WIRE_RUN_Z_MM`（`@deprecated` の別名）を使った「どこかに 2.4mm の折れ点がある」という検査を、**折れ点の高さがはしごの段・端子の高さ・盤面0のどれかに収まっている**という規則の検査に差し替えた（`P.1 → N.1` のような純y方向の渡り線は 2.4mm を1度も通らないため。その担保のテストも足した）。③`routeWire()` が部品を避けられない電線を `RoutingError`（`wireId` / `reason`）で**断る**ようになり、`crossesFootprint()` で後から調べる経路は返らなくなったので、Task 14 の「点線で仮表示」の分岐を削除し、`safeRoutes()`（Task 12）で `RoutingError` を受け止めて理由を出す形にした。`routeSession()` が全か無かで投げることも明記。④帯のスロット（レーン8 × レイヤ2）が尽きたときに立つ `laneOverflow` を3Dで琥珀色（`WIRE_LANE_OVERFLOW_COLOR`）に出し、配線時にトーストで知らせるようにした（`wireBodyColor()` と単体テスト）。⑤文言に `routeFailed` / `laneOverflow` / `routeReason`（`RoutingErrorReason` を網羅）を足し、使われなくなった `routeBlocked` を外した。⑥Task 11 の検査を `channelsClearOfFootprints()` / `validateBoard()` で実質のあるものにした。テスト総数 97 → 101 |
| 2026-09-14 | Task 1 の eslint.config.js に import-x（no-cycle / no-unresolved）を復元 |
