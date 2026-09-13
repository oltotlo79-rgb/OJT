# Plan 1B: 盤モデル board-model + 回路図モデル schematic-core 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1A で作った `@ojt/circuit-sim` の上に、設計仕様書 §6（JIPM標準盤の部品構成・ソケット4段配置・ピン割付・チェック用ソケットの固定配線・端子ID命名・3D座標・電線モデル）を満たす `@ojt/board-model` と、§11（展開接続図の文書形式・回路図→ネットリスト割当・読取専用レンダラ用レイアウト）を満たす `@ojt/schematic-core` を実装し、「回路図 → 物理割当 → 盤セッション → ネットリスト → `Simulation`」の一本道が実際に動く状態にする。

**Architecture:** `board-model` は盤の**物理**（ソケットID `S1`〜`S5`・端子座標・ダクト）だけを持ち、課題が与える役割割当（`S1 → CR1` など）を通して circuit-sim の**論理**（端子ID `CR1.13`）へ写す。訓練者の作業状態は `BoardSession`（装着状態＋電線）という1つのプレーンオブジェクトに集約し、`toNetlist()` がそれを circuit-sim の部品ファクトリで `Netlist` に変換する。`schematic-core` は展開接続図を「段（ラング）＝始点・終点・直列要素の列」で表し、段どうしの参照がそのまま縦線（分岐）になる。`assignToBoard()` が §11.3 の規則で回路図要素を物理端子へ割り当て、`toSession()` が `board-model` の `addWire()` を通して盤に落とす。3D描画とSVG描画は一切行わず、幾何データ（mm）と図形プリミティブ（論理座標）までを返す。

**Tech Stack:** Plan 1A と同一（Node.js 22以上 / pnpm workspace / TypeScript 6 `strict` ＋ `noUncheckedIndexedAccess` / Vitest 5 / ESLint 10 flat config ＋ typescript-eslint / Prettier 3）。本計画で `eslint-plugin-import-x` ＋ `eslint-import-resolver-typescript` ＋ `@typescript-eslint/parser` を追加し、仕様 §4.2 の `import/no-cycle` をエラー設定にする。外部ランタイム依存はゼロ。

---

## ファイル構成

### ルート（Task 1 で変更する）

| ファイル | 単一責務 |
|---|---|
| `package.json` | `eslint-plugin-import-x` / `eslint-import-resolver-typescript` / `@typescript-eslint/parser` を devDependencies に追加する |
| `eslint.config.js` | `import-x/no-cycle` をエラーに設定する。依存グラフを辿るための `import-x/parsers` は import-x の typescript プリセットから取り込み、解決器だけ workspace 対応のものに差し替える |

### `packages/board-model`（Task 2〜10）

| ファイル | 単一責務 |
|---|---|
| `package.json` | パッケージ名 `@ojt/board-model`、ESM、`exports`、`@ojt/circuit-sim` への workspace 依存 |
| `tsconfig.json` | `tsconfig.base.json` を継承し、このパッケージの対象ファイルを指定する |
| `vitest.config.ts` | テストの対象glob、カバレッジ設定（v8・しきい値90%） |
| `src/geometry.ts` | 純粋な幾何ユーティリティ。`Vec3`（mm）／`Polyline`／`distance()`／`nearestPointOnPolyline()`／`normalXY()` |
| `src/board-jipm.ts` | JIPM標準盤の定義データ。外形寸法・ソケット5個の端子座標（4段配置）・PB4・PL4・端子台12P/8P・P/N供給端子・ブレーカ・スイッチ・電源・ダクト・既設固定配線・既設0Ωリンク |
| `src/roles.ts` | ソケットの役割割当。`SocketRoles` と `terminalIdFor(role, pin)`、物理端子IDと役割端子IDの相互変換 |
| `src/catalog.ts` | 訓練者が装着できる部品のカタログ（`relay-my4n` / `timer-h3y4` とタイマレンジ）と課題の `inventory` 表現 |
| `src/session.ts` | `BoardSession` と操作関数（`plug` / `unplug` / `setPreset` / `addWire` / `removeWire`）。失敗は Result 型で返す |
| `src/to-netlist.ts` | `toNetlist(session, board)`。盤セッションを circuit-sim の `Netlist` に変換する |
| `src/routing.ts` | `routeWire(board, wire, existingRoutes)`。ダクト経由の自動経路と並列オフセット（純関数・決定論） |
| `src/index.ts` | 公開API。他パッケージはこのファイル経由でのみ参照する |
| `test/geometry.test.ts` 〜 `test/routing.test.ts` | 各モジュールの単体テスト（モジュール名に対応） |
| `test/to-netlist.test.ts` | 盤セッションで組んだ回路を実際に `Simulation` で動かす結合テスト |

### `packages/schematic-core`（Task 11〜16）

| ファイル | 単一責務 |
|---|---|
| `package.json` | パッケージ名 `@ojt/schematic-core`、ESM、`exports`、`@ojt/board-model` と `@ojt/circuit-sim` への workspace 依存 |
| `tsconfig.json` | `tsconfig.base.json` を継承し、このパッケージの対象ファイルを指定する |
| `vitest.config.ts` | テストの対象glob、カバレッジ設定（v8・しきい値90%） |
| `src/document.ts` | 展開接続図の文書モデル（`SchematicDocument` / `Rung` / `SchematicCell`）と `validateDocument()` |
| `src/assign.ts` | 回路図 → 物理割当（§11.3）。接点の組割当・母線の供給端子割当・`physicalOverride` |
| `src/to-session.ts` | 割当結果から `BoardSession` を作る |
| `src/layout.ts` | 読取専用レンダラ用の純粋レイアウト。文書 → 図形プリミティブ（線分・円・円弧・テキスト） |
| `src/index.ts` | 公開API |
| `test/helpers/docs.ts` | テスト専用の回路図（自己保持・インターロック・オンディレー・フリッカ） |
| `test/document.test.ts` 〜 `test/layout.test.ts` | 各モジュールの単体テストと、`toSession` → `toNetlist` → `Simulation` の通しテスト |

### この計画に含めないもの

課題JSONスキーマ・判定パイプライン・内蔵課題（`packages/content`、Plan 1C）、React／Three.js／Electron（`apps/desktop`、Plan 1D）、テスターUI・故障注入UI・PLC（Phase 2 以降）。

---

## Task 1: ルート設定に import/no-cycle を追加する

**Files:**
- Modify: `package.json`, `eslint.config.js`

仕様 §4.2 は「循環依存は禁止。ESLint の `import/no-cycle` をエラー設定にする」と定めている。Plan 1A ではパッケージが1つしか無く検出対象が存在しなかったため送りにしてあった。本計画で2つ目・3つ目のパッケージが生まれるのでここで入れる。

**重要（実機で確認済みの落とし穴）**: `import-x/no-cycle` は依存グラフを辿るときに、**今 lint している以外のファイル**を解析するためのパーサを `settings['import-x/parsers']` から引く。これが無いと `.ts` ファイルの依存を1段も辿れず、**循環があっても黙って通る**。`importX.flatConfigs.typescript` にその設定が入っているので、これを取り込んでから解決器だけ差し替える。

- [ ] `package.json` の `devDependencies` に3つ追加する（アルファベット順に挿入する）。

```json
    "@typescript-eslint/parser": "^8.70.0",
    "eslint-import-resolver-typescript": "^4.4.4",
    "eslint-plugin-import-x": "^4.16.1",
```

追加後の `devDependencies` は次のとおり。

```json
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^26.5.1",
    "@typescript-eslint/parser": "^8.70.0",
    "@vitest/coverage-v8": "^5.0.0",
    "eslint": "^10.10.0",
    "eslint-import-resolver-typescript": "^4.4.4",
    "eslint-plugin-import-x": "^4.16.1",
    "prettier": "^3.9.6",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.70.0",
    "vitest": "^5.0.0"
  }
```

- [ ] `eslint.config.js` を次の内容にする。

```js
import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
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
    files: ['**/*.ts'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['packages/*/tsconfig.json'],
        }),
      ],
    },
    rules: { 'import-x/no-cycle': ['error', { maxDepth: Infinity }] },
  },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
);
```

- [ ] `pnpm-workspace.yaml` にネイティブ依存のビルド許可を追記する（`eslint-import-resolver-typescript` が使う `unrs-resolver` がネイティブバイナリを持つため。許可しないと `ERR_PNPM_IGNORED_BUILDS` で `pnpm install` が失敗する）。

```yaml
packages:
  - 'packages/*'
  - 'apps/*'

allowBuilds:
  unrs-resolver: true
```

- [ ] 依存を入れる。

```powershell
pnpm install
```

期待出力の末尾:

```
+ @typescript-eslint/parser 8.70.0
+ eslint-import-resolver-typescript 4.4.5
+ eslint-plugin-import-x 4.17.1
```

- [ ] 循環依存を**わざと作って**ルールが実際に発火することを確かめる。

```powershell
Set-Content packages\circuit-sim\src\cyclea.ts "import { B } from './cycleb.js';`nexport const A: number = B + 1;`n"
Set-Content packages\circuit-sim\src\cycleb.ts "import { A } from './cyclea.js';`nexport const B: number = A + 1;`n"
pnpm exec eslint packages/circuit-sim/src/cyclea.ts
```

期待出力:

```
  1:1  error  Dependency cycle detected  import-x/no-cycle

✖ 1 problem (1 error, 0 warnings)
```

- [ ] 確認用ファイルを消し、lint が通ることを確かめる。

```powershell
Remove-Item packages\circuit-sim\src\cyclea.ts, packages\circuit-sim\src\cycleb.ts
pnpm exec eslint .
```

期待出力: 何も表示されず終了（終了コード0）。

- [ ] コミットする。

```powershell
git add package.json pnpm-workspace.yaml pnpm-lock.yaml eslint.config.js
git commit -m @'
chore: enforce import/no-cycle across packages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 2: board-model パッケージの雛形

**Files:**
- Create: `packages/board-model/package.json`, `packages/board-model/tsconfig.json`, `packages/board-model/vitest.config.ts`, `packages/board-model/src/index.ts`
- Test: `packages/board-model/test/scaffold.test.ts`

このタスクは「ダミーテスト1本が通ること」をもってスキャフォールド完了とする。

- [ ] 失敗するテストを書く。`packages/board-model/test/scaffold.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('scaffold', () => {
  it('パッケージ名を公開している', () => {
    expect(PACKAGE_NAME).toBe('@ojt/board-model');
  });
});
```

- [ ] `packages/board-model/package.json` を作る。

```json
{
  "name": "@ojt/board-model",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@ojt/circuit-sim": "workspace:*"
  }
}
```

- [ ] `packages/board-model/tsconfig.json` を作る。

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

- [ ] `packages/board-model/vitest.config.ts` を作る。

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm install
pnpm --filter @ojt/board-model test
```

期待出力（`src/index.ts` がまだ無いため解決に失敗する）:

```
Error: Failed to load url ../src/index.js
```

- [ ] `packages/board-model/src/index.ts` を作る（Task 10 で公開APIの再輸出に置き換える）。

```ts
/** パッケージ名。スキャフォールドの疎通確認用。 */
export const PACKAGE_NAME = '@ojt/board-model';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/board-model test
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] コミットする。

```powershell
git add packages/board-model pnpm-lock.yaml
git commit -m @'
chore(board-model): scaffold package with vitest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 3: src/geometry.ts — 幾何ユーティリティ

**Files:**
- Create: `packages/board-model/src/geometry.ts`
- Test: `packages/board-model/test/geometry.test.ts`
- Modify: `packages/board-model/src/index.ts`

座標系は仕様 §6.5 / §12.2 に従う（盤の左上手前が原点、mm単位）。`normalXY()` が方向ベクトルを辞書順で正規化してから回すのは、電線の並列オフセット（§6.6）の向きを「どちらの端子から辿ったか」に依存させないためである（決定論の要件、§5.2）。

- [ ] 失敗するテストを書く。`packages/board-model/test/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  distance,
  nearestPointOnPolyline,
  nearestPointOnSegment,
  normalXY,
  polylineLength,
  roundVec,
  vec3,
  vecEquals,
} from '../src/index.js';

describe('geometry: 幾何ユーティリティ', () => {
  it('距離・折れ線長・丸め', () => {
    expect(distance(vec3(0, 0), vec3(3, 4))).toBe(5);
    expect(polylineLength([vec3(0, 0), vec3(3, 4), vec3(3, 10)])).toBe(11);
    expect(polylineLength([vec3(1, 1)])).toBe(0);
    expect(roundVec(vec3(1.23456, 2.00004, -0.5))).toEqual({ x: 1.235, y: 2, z: -0.5 });
    expect(vecEquals(vec3(1, 1), vec3(1, 1.0000001))).toBe(true);
  });

  it('線分・折れ線上の最寄り点', () => {
    const seg = nearestPointOnSegment(vec3(5, 5), vec3(0, 0), vec3(10, 0));
    expect(seg.point).toEqual({ x: 5, y: 0, z: 0 });
    expect(seg.t).toBe(0.5);
    expect(seg.distance).toBe(5);
    expect(nearestPointOnSegment(vec3(-5, 0), vec3(0, 0), vec3(10, 0)).t).toBe(0);
    expect(nearestPointOnSegment(vec3(1, 1), vec3(2, 2), vec3(2, 2)).point).toEqual({
      x: 2,
      y: 2,
      z: 0,
    });
    const line = nearestPointOnPolyline(vec3(5, 5), [vec3(0, 0), vec3(10, 0), vec3(10, 10)]);
    expect(line.index).toBe(0);
    expect(line.point).toEqual({ x: 5, y: 0, z: 0 });
    expect(nearestPointOnPolyline(vec3(1, 1), []).distance).toBe(0);
    expect(nearestPointOnPolyline(vec3(1, 1), [vec3(4, 5)]).distance).toBe(5);
  });

  it('法線は進行方向によらず同じ側を向く（並列オフセットの決定論）', () => {
    expect(normalXY(vec3(0, 0), vec3(10, 0))).toEqual({ x: 0, y: 1, z: 0 });
    expect(normalXY(vec3(10, 0), vec3(0, 0))).toEqual({ x: 0, y: 1, z: 0 });
    expect(normalXY(vec3(0, 0), vec3(0, 10))).toEqual({ x: -1, y: 0, z: 0 });
    expect(normalXY(vec3(3, 3), vec3(3, 3))).toEqual({ x: 0, y: 0, z: 0 });
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/board-model test -- geometry.test.ts
```

期待出力の冒頭: `does not provide an export named 'vec3'`。

- [ ] `packages/board-model/src/geometry.ts` を書く。

```ts
/**
 * 盤の幾何ユーティリティ。すべて純関数で、単位は mm。
 * 座標系（設計仕様 §6.5 / §12.2）: 盤の左上手前が原点。
 * x = 右方向、y = 下方向（盤面に沿う）、z = 盤面からの高さ（表側が正、裏側が負）。
 */

/** 3D座標[mm]。 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 折れ線（経路）。 */
export type Polyline = readonly Vec3[];

/** 座標を作る。z を省略すると盤面（0）。 */
export function vec3(x: number, y: number, z = 0): Vec3 {
  return { x, y, z };
}

/** 加算。 */
export function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** 減算（a − b）。 */
export function subVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** スカラー倍。 */
export function scaleVec(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/** ベクトルの長さ[mm]。 */
export function vecLength(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** 2点間の距離[mm]。 */
export function distance(a: Vec3, b: Vec3): number {
  return vecLength(subVec(a, b));
}

/** 指定桁で丸める。経路の同一性判定・スナップショット比較に使う。 */
export function roundVec(v: Vec3, decimals = 3): Vec3 {
  const scale = 10 ** decimals;
  return {
    x: Math.round(v.x * scale) / scale,
    y: Math.round(v.y * scale) / scale,
    z: Math.round(v.z * scale) / scale,
  };
}

/** 2点が（誤差内で）同じか。 */
export function vecEquals(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.z - b.z) < epsilon
  );
}

/** 折れ線の全長[mm]。 */
export function polylineLength(line: Polyline): number {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    const prev = line[i - 1];
    const cur = line[i];
    if (prev === undefined || cur === undefined) continue;
    total += distance(prev, cur);
  }
  return total;
}

/** 最寄り点の探索結果。 */
export interface NearestPoint {
  /** 最寄り点の座標。 */
  point: Vec3;
  /** 折れ線の何番目の区間か（0起点）。線分に対しては常に0。 */
  index: number;
  /** その区間内の位置（0=始点、1=終点）。 */
  t: number;
  /** 元の点からの距離[mm]。 */
  distance: number;
}

/** 線分 a–b 上で p に最も近い点。 */
export function nearestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): NearestPoint {
  const ab = subVec(b, a);
  const lengthSq = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  if (lengthSq === 0) return { point: a, index: 0, t: 0, distance: distance(p, a) };
  const ap = subVec(p, a);
  const raw = (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / lengthSq;
  const t = Math.min(Math.max(raw, 0), 1);
  const point = addVec(a, scaleVec(ab, t));
  return { point, index: 0, t, distance: distance(p, point) };
}

/**
 * 折れ線上で p に最も近い点。折れ線が空のときは p 自身を返す（距離0）。
 * 同距離の候補が複数あるときは先に現れた区間を選ぶ（決定論）。
 */
export function nearestPointOnPolyline(p: Vec3, line: Polyline): NearestPoint {
  let best: NearestPoint = { point: p, index: 0, t: 0, distance: 0 };
  let found = false;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    if (a === undefined || b === undefined) continue;
    const hit = nearestPointOnSegment(p, a, b);
    if (!found || hit.distance < best.distance) {
      best = { point: hit.point, index: i - 1, t: hit.t, distance: hit.distance };
      found = true;
    }
  }
  if (!found && line.length === 1) {
    const only = line[0];
    if (only !== undefined) return { point: only, index: 0, t: 0, distance: distance(p, only) };
  }
  return best;
}

/**
 * 線分 a–b のXY平面内の単位法線。
 * 進行方向によらず同じ側を返すため、方向ベクトルを辞書順で正規化してから回す。
 * ダクト内の並列オフセット（§6.6）の向きを決定論にするための規約。
 */
export function normalXY(a: Vec3, b: Vec3): Vec3 {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return vec3(0, 0, 0);
  return vec3(unsignZero(-dy / len), unsignZero(dx / len), 0);
}

/** `-0` を `0` に正規化する（比較とスナップショットの安定のため）。 */
function unsignZero(value: number): number {
  return value === 0 ? 0 : value;
}
```

- [ ] `packages/board-model/src/index.ts` を次の内容に置き換える（`PACKAGE_NAME` は役目を終えたので消し、`test/scaffold.test.ts` も削除する）。

```ts
export {
  addVec,
  distance,
  nearestPointOnPolyline,
  nearestPointOnSegment,
  normalXY,
  polylineLength,
  roundVec,
  scaleVec,
  subVec,
  vec3,
  vecEquals,
  vecLength,
  type NearestPoint,
  type Polyline,
  type Vec3,
} from './geometry.js';
```

```powershell
Remove-Item packages\board-model\test\scaffold.test.ts
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/board-model test -- geometry.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): add mm-based geometry utilities

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 4: src/board-jipm.ts — JIPM標準盤の定義データ

**Files:**
- Create: `packages/board-model/src/board-jipm.ts`
- Test: `packages/board-model/test/board.test.ts`
- Modify: `packages/board-model/src/index.ts`

仕様 §6.1〜§6.5、調査資料 §2.1〜§2.2 / §3.1 / §3.5 に対応する。本アプリの既定として確定する数値と根拠:

| 項目 | 本アプリの既定 | 根拠 |
|---|---|---|
| 盤面 W × H | **330 × 300 mm** | 公式PDFは外形を示さない。同等品の市販検定盤が2社とも 330×300（アドウィン AKE-1405 = 330×300×190、メカトロ教材社 MK-EP1 = 330×300×110。調査資料 §2.5）で一致するためこれを採る |
| 盤の奥行 | **110 mm** | 上記2社のうち薄い方（MK-EP1）。3Dの厚みにのみ影響する |
| ソケット端子の列ピッチ／段ピッチ | **9 mm** / **12 mm** | M3（No.2）ネジ端子（調査資料 §2.1）が半径4mmの当たり判定（§6.5）で重ならない最小値。4段4列で 27 × 36 mm に収まり、ソケット5個＋間隔が盤幅330mmに収まる |
| 端子台のピッチ | **9 mm** | 同上。12P で 99mm、8P で 63mm |
| P/N供給端子の本数 | **P.1〜P.6 / N.1〜N.6 の各6本** | 仕様 §6.1 の表がそのまま6本と定めている |
| ダクト | 横3本（y=74 / 150 / 210）＋縦2本（x=14 / 316）、幅12mm・高さ25mm | §6.5 は「盤面上のポリライン列」とのみ定める。3段の機器列の**間**に横ダクトを置き、左右の縦ダクトで連結して1つのグラフにするのが最小の構成。幅12mmは 2mmピッチ（§6.6）で6本を並べられる値 |
| 端子の当たり判定半径 | **4 mm** | §6.5 で確定 |
| PB／PL本体端子の z | **−25 mm**（盤の裏） | §6.4「本体端子はテスター測定と3D表示のためだけに存在する」を座標で表現する。裏側にあるので配線操作の当たり判定に出てこない |

- [ ] 失敗するテストを書く。`packages/board-model/test/board.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  BoardError,
  boardTerminalPos,
  circledNumber,
  findBoardTerminal,
  JIPM_BOARD,
  loadBoard,
  pinRole,
  resolveEndpoint,
  SOCKET_COL_PITCH_MM,
  SOCKET_IDS,
  SOCKET_ROW_PITCH_MM,
  socketPinTerminal,
  SUPPLY_TERMINAL_COUNT,
  TERMINAL_PICK_RADIUS_MM,
} from '../src/index.js';

const board = JIPM_BOARD;

function idsOf(prefix: string): string[] {
  return board.terminals.map((t) => t.id).filter((id) => id.startsWith(`${prefix}.`));
}

describe('board-jipm: 盤定義の不変条件', () => {
  it('ソケット5・PB4・PL4（§6.1 / 調査資料 §2.1）', () => {
    expect(board.sockets.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    expect(board.pushButtons.map((p) => `${p.id}:${p.color}`)).toEqual([
      'PB1:黒',
      'PB2:黄',
      'PB3:緑',
      'PB4:赤',
    ]);
    expect(board.lamps.map((l) => `${l.id}:${l.color}`)).toEqual([
      'PL1:白',
      'PL2:黄',
      'PL3:緑',
      'PL4:赤',
    ]);
  });

  it('端子台は12P／8P、P/N供給端子は6本ずつ（§6.1）', () => {
    expect(idsOf('TB_PB')).toHaveLength(12);
    expect(idsOf('TB_PL')).toHaveLength(8);
    expect(idsOf('P')).toHaveLength(SUPPLY_TERMINAL_COUNT);
    expect(idsOf('N')).toHaveLength(SUPPLY_TERMINAL_COUNT);
    expect(idsOf('TB_PB').slice(0, 3)).toEqual(['TB_PB.1c', 'TB_PB.1a', 'TB_PB.1b']);
    expect(idsOf('TB_PL').slice(0, 2)).toEqual(['TB_PL.1+', 'TB_PL.1-']);
  });

  it('全端子IDが一意で、当たり判定半径は4mm（§6.5）', () => {
    const ids = board.terminals.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(board.terminals.every((t) => t.pickRadiusMm === TERMINAL_PICK_RADIUS_MM)).toBe(true);
  });

  it('ソケットは14ピンで、4段配置どおりの座標を持つ（§6.2）', () => {
    for (const socket of SOCKET_IDS) {
      expect(idsOf(socket)).toHaveLength(14);
    }
    const origin = board.sockets[0]?.origin;
    expect(origin).toEqual({ x: 24, y: 92, z: 10 });
    const at = (pin: number): { x: number; y: number } => {
      const pos = boardTerminalPos(board, socketPinTerminal('S1', pin));
      return { x: pos.x, y: pos.y };
    };
    // 段1: [空] ③ ② ①
    expect(at(3)).toEqual({ x: 24 + SOCKET_COL_PITCH_MM, y: 92 });
    expect(at(1)).toEqual({ x: 24 + 3 * SOCKET_COL_PITCH_MM, y: 92 });
    // 段2: ⑧ ⑦ ⑥ ⑤
    expect(at(8)).toEqual({ x: 24, y: 92 + SOCKET_ROW_PITCH_MM });
    expect(at(5)).toEqual({ x: 24 + 3 * SOCKET_COL_PITCH_MM, y: 92 + SOCKET_ROW_PITCH_MM });
    // 段3: ⑫ ⑪ ⑩ ⑨
    expect(at(12)).toEqual({ x: 24, y: 92 + 2 * SOCKET_ROW_PITCH_MM });
    expect(at(9)).toEqual({ x: 24 + 3 * SOCKET_COL_PITCH_MM, y: 92 + 2 * SOCKET_ROW_PITCH_MM });
    // 段4: ④ ⑭ ⑬ [空]（④が混ざる非連番配置をそのまま再現する）
    expect(at(4)).toEqual({ x: 24, y: 92 + 3 * SOCKET_ROW_PITCH_MM });
    expect(at(14)).toEqual({ x: 24 + SOCKET_COL_PITCH_MM, y: 92 + 3 * SOCKET_ROW_PITCH_MM });
    expect(at(13)).toEqual({ x: 24 + 2 * SOCKET_COL_PITCH_MM, y: 92 + 3 * SOCKET_ROW_PITCH_MM });
  });

  it('ピン割付が仕様どおり（§6.2）', () => {
    expect([9, 10, 11, 12].map(pinRole)).toEqual(['com', 'com', 'com', 'com']);
    expect([1, 2, 3, 4].map(pinRole)).toEqual(['nc', 'nc', 'nc', 'nc']);
    expect([5, 6, 7, 8].map(pinRole)).toEqual(['no', 'no', 'no', 'no']);
    expect(pinRole(13)).toBe('coil-');
    expect(pinRole(14)).toBe('coil+');
    expect(circledNumber(9)).toBe('⑨');
    expect(() => circledNumber(15)).toThrow(BoardError);
    expect(() => socketPinTerminal('S1', 0)).toThrow(BoardError);
  });

  it('全端子の座標が盤外形の中にある（§6.5）', () => {
    for (const t of board.terminals) {
      expect(t.pos.x).toBeGreaterThanOrEqual(0);
      expect(t.pos.x).toBeLessThanOrEqual(BOARD_WIDTH_MM);
      expect(t.pos.y).toBeGreaterThanOrEqual(0);
      expect(t.pos.y).toBeLessThanOrEqual(BOARD_HEIGHT_MM);
    }
    expect(board.sizeMm).toEqual({ width: 330, height: 300, depth: 110 });
  });

  it('PB／PL本体端子は配線できず、端子台とP/Nは配線できる（§6.4）', () => {
    expect(findBoardTerminal(board, 'PB1.c')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'PL1.+')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'CB.1')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'PS.+')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'TB_PB.1c')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'P.1')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'S5.14')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'BZ.+')?.optional).toBe(true);
    expect(findBoardTerminal(board, 'XX.1')).toBeUndefined();
    expect(() => boardTerminalPos(board, 'XX.1')).toThrow(BoardError);
  });

  it('チェック用ソケットの黄色固定配線は3本で §6.3 の端子どおり', () => {
    expect(board.fixedWires).toHaveLength(3);
    expect(board.fixedWires.every((w) => w.color === '黄')).toBe(true);
    const pairs = board.fixedWires.map(
      (w) => `${resolveEndpoint(w.from)}->${resolveEndpoint(w.to)}`,
    );
    expect(pairs).toEqual(['P.6->TB_PB.4c', 'TB_PB.4a->S5.14', 'S5.13->N.6']);
  });

  it('既設リンクは P/N 12本＋PB 12本＋PL 8本＝32本（§6.4）', () => {
    expect(board.fixedLinks).toHaveLength(32);
    const ids = board.fixedLinks.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(board.fixedLinks.filter((l) => l.id.startsWith('lk-pb-'))).toHaveLength(12);
    expect(board.fixedLinks.filter((l) => l.id.startsWith('lk-pl-'))).toHaveLength(8);
    expect(board.fixedLinks[0]).toEqual({ id: 'lk-ps-p', from: 'PS.+', to: 'P.1' });
  });

  it('ダクトは連結した5区間（§6.5）', () => {
    expect(board.ducts.map((d) => d.id)).toEqual([
      'duct-top',
      'duct-mid',
      'duct-bottom',
      'duct-left',
      'duct-right',
    ]);
    expect(board.ducts.every((d) => d.widthMm === 12 && d.heightMm === 25)).toBe(true);
  });

  it('盤IDで引ける', () => {
    expect(loadBoard('board-jipm-std')).toBe(board);
    expect(() => loadBoard('board-x')).toThrow(BoardError);
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/board-model test -- board.test.ts
```

期待出力の冒頭: `does not provide an export named 'JIPM_BOARD'`。

- [ ] `packages/board-model/src/board-jipm.ts` を書く。

```ts
import {
  partId,
  terminalId,
  type LampColor,
  type PartId,
  type TerminalId,
  type WireColor,
} from '@ojt/circuit-sim';
import { vec3, type Vec3 } from './geometry.js';

/**
 * JIPM標準盤 `board-jipm-std` の定義データ。設計仕様 §6.1〜§6.6、調査資料 §2.1〜§2.2 / §3.1 / §3.5。
 *
 * 寸法の根拠: 公式PDFは外形寸法を示さないため、同等品として市販されている検定用実習盤
 * （アドウィン AKE-1405 = 330×300×190mm、メカトロ教材社 MK-EP1 = 330×300×110mm。調査資料 §2.5）の
 * 一致する盤面寸法 **330 × 300 mm** を本アプリの既定とし、奥行は薄い方の 110mm を採る。
 * 盤面内の配置は調査資料 §2.2 の配置図の縦横比（上段=電源/ブレーカ、中段=ソケット5個、
 * その下=端子台2個、最下段=ランプ4個と押ボタン4個）をそのまま保つ。
 */

/** 盤面の幅[mm]。 */
export const BOARD_WIDTH_MM = 330;
/** 盤面の高さ[mm]。 */
export const BOARD_HEIGHT_MM = 300;
/** 盤の奥行[mm]。 */
export const BOARD_DEPTH_MM = 110;
/** 端子の当たり判定半径[mm]。§6.5 */
export const TERMINAL_PICK_RADIUS_MM = 4;
/** P/N供給端子の本数（`P.1`〜`P.6` / `N.1`〜`N.6`）。§6.1 */
export const SUPPLY_TERMINAL_COUNT = 6;

/** ソケットのネジ端子の列ピッチ[mm]。 */
export const SOCKET_COL_PITCH_MM = 9;
/** ソケットのネジ端子の段ピッチ[mm]。 */
export const SOCKET_ROW_PITCH_MM = 12;
/** 端子台のネジ端子ピッチ[mm]（M3端子台の一般的な値）。 */
export const BLOCK_PITCH_MM = 9;
/** ソケットのネジ端子の盤面からの高さ[mm]。 */
export const SOCKET_TERMINAL_Z_MM = 10;
/** 端子台のネジ端子の盤面からの高さ[mm]。 */
export const BLOCK_TERMINAL_Z_MM = 8;
/** PB／PL本体端子の盤面からの高さ[mm]（盤の裏側にあるため負）。§6.4 */
export const BODY_TERMINAL_Z_MM = -25;

/** ダクトの幅[mm]。 */
export const DUCT_WIDTH_MM = 12;
/** ダクトの高さ[mm]。 */
export const DUCT_HEIGHT_MM = 25;

/** 物理ソケットID（盤上の位置で決まる。役割の割当は roles.ts）。§6.1 */
export type SocketId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

/** 物理ソケットIDの並び（左から右、最後がチェック用）。 */
export const SOCKET_IDS: readonly SocketId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];

/** 押ボタンの色。§5.3.3 */
export type PushButtonColor = '黒' | '黄' | '緑' | '赤';

/** 端子の役割。§6.6 の `role` のうち Phase 1 の盤で使うもの。 */
export type TerminalRole =
  'coil+' | 'coil-' | 'com' | 'no' | 'nc' | '+' | '-' | 'c' | 'a' | 'b' | 'ac';

/** 盤上の1端子。 */
export interface BoardTerminal {
  /** 物理端子ID。ソケットは `S1.13` のように**物理**ソケットIDで持つ（役割IDへの変換は roles.ts）。 */
  id: TerminalId;
  /** ツールチップ用の表示名（例: `S1 ⑨ COM`）。§8.2 */
  label: string;
  role: TerminalRole;
  pos: Vec3;
  pickRadiusMm: number;
  /** 訓練者が配線してよい端子か。PB／PL本体端子・ブレーカ・スイッチ・電源内部端子は false。§6.4 */
  wirable: boolean;
  /** 既定の盤には無く、課題の `extraParts` で追加したときだけ使える端子（BZ）。§5.3.4 */
  optional: boolean;
}

/** 14ピンソケットの定義。 */
export interface SocketDefinition {
  id: SocketId;
  kind: 'socket-14pin';
  /** 段1・左端（①②③の段の左端の空きスロット）の中心座標。 */
  origin: Vec3;
}

/** 押ボタン本体の定義。 */
export interface PushButtonDefinition {
  id: PartId;
  color: PushButtonColor;
  pos: Vec3;
}

/** 表示灯本体の定義。 */
export interface LampDefinition {
  id: PartId;
  color: LampColor;
  pos: Vec3;
}

/** 配線ダクトの1区間。自動経路生成（routing.ts）が参照する。§6.5 */
export interface DuctSegment {
  id: string;
  a: Vec3;
  b: Vec3;
  widthMm: number;
  heightMm: number;
}

/** 盤定義内で端子を指す参照。ソケットは役割割当で端子IDが変わるためピン番号で指す。 */
export type BoardEndpoint =
  { kind: 'terminal'; id: TerminalId } | { kind: 'socket'; socket: SocketId; pin: number };

/** 既設の固定電線（チェック用ソケットの黄色配線）。`locked` で訓練者は変更できない。§6.3 */
export interface FixedWire {
  id: string;
  from: BoardEndpoint;
  to: BoardEndpoint;
  color: WireColor;
}

/** 既設の0Ωリンク（PB／PL本体と端子台の間、P/N供給端子どうし）。§6.4 */
export interface FixedLink {
  id: string;
  from: TerminalId;
  to: TerminalId;
}

/** 盤の定義データ。 */
export interface BoardDefinition {
  id: string;
  displayName: string;
  sizeMm: { width: number; height: number; depth: number };
  sockets: readonly SocketDefinition[];
  pushButtons: readonly PushButtonDefinition[];
  lamps: readonly LampDefinition[];
  supplyTerminalCount: number;
  terminals: readonly BoardTerminal[];
  ducts: readonly DuctSegment[];
  fixedWires: readonly FixedWire[];
  fixedLinks: readonly FixedLink[];
}

/** 盤定義の参照に失敗したときに投げる。 */
export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardError';
  }
}

/**
 * ソケットのネジ端子の物理配置（調査資料 §3.1 / 仕様 §6.2）。
 * ```
 * 段1:  [空]  ③  ②  ①
 * 段2:   ⑧   ⑦  ⑥  ⑤
 * 段3:   ⑫   ⑪  ⑩  ⑨
 * 段4:   ④   ⑭  ⑬  [空]
 * ```
 * 段（row）は上（奥）から下（手前）、列（col）は左から右。`undefined` は空きスロット。
 */
export const SOCKET_PIN_GRID: ReadonlyArray<ReadonlyArray<number | undefined>> = [
  [undefined, 3, 2, 1],
  [8, 7, 6, 5],
  [12, 11, 10, 9],
  [4, 14, 13, undefined],
];

/** ピン番号 → 端子の役割。§6.2 */
export function pinRole(pin: number): TerminalRole {
  if (pin === 13) return 'coil-';
  if (pin === 14) return 'coil+';
  if (pin >= 9 && pin <= 12) return 'com';
  if (pin >= 5 && pin <= 8) return 'no';
  return 'nc';
}

/** 丸数字ラベル（①〜⑭）。 */
export function circledNumber(pin: number): string {
  const table = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭'];
  const label = table[pin - 1];
  if (label === undefined) throw new BoardError(`ピン番号が範囲外です: ${pin}`);
  return label;
}

/** 物理ソケットのピン端子ID（例: `S1.13`）。 */
export function socketPinTerminal(socket: SocketId, pin: number): TerminalId {
  if (!Number.isInteger(pin) || pin < 1 || pin > 14) {
    throw new BoardError(`ピン番号が範囲外です: ${pin}`);
  }
  return terminalId(socket, String(pin));
}

function terminal(
  id: TerminalId,
  label: string,
  role: TerminalRole,
  pos: Vec3,
  wirable: boolean,
  optional = false,
): BoardTerminal {
  return { id, label, role, pos, pickRadiusMm: TERMINAL_PICK_RADIUS_MM, wirable, optional };
}

/** ソケット5個の原点（段1・左端スロットの中心）。左から4個＋チェック用1個。§2.2 */
const SOCKET_ORIGINS: ReadonlyArray<{ id: SocketId; origin: Vec3 }> = [
  { id: 'S1', origin: vec3(24, 92, SOCKET_TERMINAL_Z_MM) },
  { id: 'S2', origin: vec3(74, 92, SOCKET_TERMINAL_Z_MM) },
  { id: 'S3', origin: vec3(124, 92, SOCKET_TERMINAL_Z_MM) },
  { id: 'S4', origin: vec3(174, 92, SOCKET_TERMINAL_Z_MM) },
  { id: 'S5', origin: vec3(254, 92, SOCKET_TERMINAL_Z_MM) },
];

/** ランプ用端子台（8P）の左端端子のX座標[mm]。 */
const TB_PL_X_MM = 24;
/** 押ボタン用端子台（12P）の左端端子のX座標[mm]。 */
const TB_PB_X_MM = 150;
/** 端子台の段のY座標[mm]。 */
const TB_Y_MM = 176;
/** PL／PB本体の段のY座標[mm]。 */
const BODY_Y_MM = 244;
/** P/N供給端子の左端X座標[mm]。 */
const SUPPLY_X_MM = 120;
/** P（+24V）端子のY座標[mm]。 */
const P_Y_MM = 30;
/** N（0V）端子のY座標[mm]。 */
const N_Y_MM = 52;

/** PL本体4個（白・黄・緑・赤）。§2.2 */
const LAMP_DEFS: readonly LampDefinition[] = [
  { id: partId('PL1'), color: '白', pos: vec3(30, BODY_Y_MM, 0) },
  { id: partId('PL2'), color: '黄', pos: vec3(68, BODY_Y_MM, 0) },
  { id: partId('PL3'), color: '緑', pos: vec3(106, BODY_Y_MM, 0) },
  { id: partId('PL4'), color: '赤', pos: vec3(144, BODY_Y_MM, 0) },
];

/** PB本体4個（黒・黄・緑・赤）。§2.2 */
const PUSH_BUTTON_DEFS: readonly PushButtonDefinition[] = [
  { id: partId('PB1'), color: '黒', pos: vec3(186, BODY_Y_MM, 0) },
  { id: partId('PB2'), color: '黄', pos: vec3(224, BODY_Y_MM, 0) },
  { id: partId('PB3'), color: '緑', pos: vec3(262, BODY_Y_MM, 0) },
  { id: partId('PB4'), color: '赤', pos: vec3(300, BODY_Y_MM, 0) },
];

function buildTerminals(): BoardTerminal[] {
  const out: BoardTerminal[] = [];

  // DC24V電源の内部端子（測定のみ。訓練者は配線しない）
  out.push(terminal(terminalId('PS', '+'), 'PS +24V', '+', vec3(106, P_Y_MM, 6), false));
  out.push(terminal(terminalId('PS', '-'), 'PS 0V', '-', vec3(106, N_Y_MM, 6), false));

  // P/N供給端子（内部で同電位。§6.1）
  for (let i = 1; i <= SUPPLY_TERMINAL_COUNT; i += 1) {
    const x = SUPPLY_X_MM + (i - 1) * BLOCK_PITCH_MM;
    out.push(
      terminal(
        terminalId('P', String(i)),
        `P.${i} (+24V)`,
        '+',
        vec3(x, P_Y_MM, BLOCK_TERMINAL_Z_MM),
        true,
      ),
    );
  }
  for (let i = 1; i <= SUPPLY_TERMINAL_COUNT; i += 1) {
    const x = SUPPLY_X_MM + (i - 1) * BLOCK_PITCH_MM;
    out.push(
      terminal(
        terminalId('N', String(i)),
        `N.${i} (0V)`,
        '-',
        vec3(x, N_Y_MM, BLOCK_TERMINAL_Z_MM),
        true,
      ),
    );
  }

  // ブレーカ・電源スイッチ（AC一次側。開閉器としてのみ扱い、配線も測定対象にもしない。§5.3.5）
  out.push(terminal(terminalId('CB', '1'), 'CB 1次', 'ac', vec3(216, P_Y_MM, 6), false));
  out.push(terminal(terminalId('CB', '2'), 'CB 2次', 'ac', vec3(216, N_Y_MM, 6), false));
  out.push(terminal(terminalId('SW', '1'), 'SW 1', 'ac', vec3(262, P_Y_MM, 6), false));
  out.push(terminal(terminalId('SW', '2'), 'SW 2', 'ac', vec3(262, N_Y_MM, 6), false));

  // 14ピンソケット×5（4段配置。§6.2）
  for (const socket of SOCKET_ORIGINS) {
    SOCKET_PIN_GRID.forEach((row, rowIndex) => {
      row.forEach((pin, colIndex) => {
        if (pin === undefined) return;
        const pos = vec3(
          socket.origin.x + colIndex * SOCKET_COL_PITCH_MM,
          socket.origin.y + rowIndex * SOCKET_ROW_PITCH_MM,
          socket.origin.z,
        );
        const role = pinRole(pin);
        out.push(
          terminal(
            socketPinTerminal(socket.id, pin),
            `${socket.id} ${circledNumber(pin)} ${role}`,
            role,
            pos,
            true,
          ),
        );
      });
    });
  }

  // ランプ用端子台（8P: +/− × 4）
  for (let n = 1; n <= 4; n += 1) {
    for (const [offset, sign] of [
      [0, '+'],
      [1, '-'],
    ] as const) {
      const index = (n - 1) * 2 + offset;
      const x = TB_PL_X_MM + index * BLOCK_PITCH_MM;
      out.push(
        terminal(
          terminalId('TB_PL', `${n}${sign}`),
          `TB_PL ${n}${sign}`,
          sign,
          vec3(x, TB_Y_MM, BLOCK_TERMINAL_Z_MM),
          true,
        ),
      );
    }
  }

  // 押ボタン用端子台（12P: c/a/b × 4）
  for (let n = 1; n <= 4; n += 1) {
    for (const [offset, sign] of [
      [0, 'c'],
      [1, 'a'],
      [2, 'b'],
    ] as const) {
      const index = (n - 1) * 3 + offset;
      const x = TB_PB_X_MM + index * BLOCK_PITCH_MM;
      out.push(
        terminal(
          terminalId('TB_PB', `${n}${sign}`),
          `TB_PB ${n}${sign}`,
          sign,
          vec3(x, TB_Y_MM, BLOCK_TERMINAL_Z_MM),
          true,
        ),
      );
    }
  }

  // PL本体（端子は盤の裏。測定と3D表示のためだけに存在する。§6.4）
  LAMP_DEFS.forEach((lamp) => {
    out.push(
      terminal(
        terminalId(lamp.id, '+'),
        `${lamp.id}(${lamp.color}) +`,
        '+',
        vec3(lamp.pos.x - 6, lamp.pos.y, BODY_TERMINAL_Z_MM),
        false,
      ),
    );
    out.push(
      terminal(
        terminalId(lamp.id, '-'),
        `${lamp.id}(${lamp.color}) -`,
        '-',
        vec3(lamp.pos.x + 6, lamp.pos.y, BODY_TERMINAL_Z_MM),
        false,
      ),
    );
  });

  // PB本体（端子は盤の裏。§6.4）
  PUSH_BUTTON_DEFS.forEach((pb) => {
    out.push(
      terminal(
        terminalId(pb.id, 'c'),
        `${pb.id}(${pb.color}) c`,
        'c',
        vec3(pb.pos.x - 8, pb.pos.y, BODY_TERMINAL_Z_MM),
        false,
      ),
    );
    out.push(
      terminal(
        terminalId(pb.id, 'a'),
        `${pb.id}(${pb.color}) a`,
        'a',
        vec3(pb.pos.x + 8, pb.pos.y - 6, BODY_TERMINAL_Z_MM),
        false,
      ),
    );
    out.push(
      terminal(
        terminalId(pb.id, 'b'),
        `${pb.id}(${pb.color}) b`,
        'b',
        vec3(pb.pos.x + 8, pb.pos.y + 6, BODY_TERMINAL_Z_MM),
        false,
      ),
    );
  });

  // BZ（任意部品。課題の extraParts で追加したときだけ使える。§5.3.4）
  out.push(
    terminal(
      terminalId('BZ', '+'),
      'BZ +',
      '+',
      vec3(284, TB_Y_MM, BLOCK_TERMINAL_Z_MM),
      true,
      true,
    ),
  );
  out.push(
    terminal(
      terminalId('BZ', '-'),
      'BZ -',
      '-',
      vec3(296, TB_Y_MM, BLOCK_TERMINAL_Z_MM),
      true,
      true,
    ),
  );

  return out;
}

/** 配線ダクト。3本の横ダクトを左右の縦ダクトでつないだ連結グラフ。§6.5 */
const DUCTS: readonly DuctSegment[] = [
  {
    id: 'duct-top',
    a: vec3(14, 74),
    b: vec3(316, 74),
    widthMm: DUCT_WIDTH_MM,
    heightMm: DUCT_HEIGHT_MM,
  },
  {
    id: 'duct-mid',
    a: vec3(14, 150),
    b: vec3(316, 150),
    widthMm: DUCT_WIDTH_MM,
    heightMm: DUCT_HEIGHT_MM,
  },
  {
    id: 'duct-bottom',
    a: vec3(14, 210),
    b: vec3(316, 210),
    widthMm: DUCT_WIDTH_MM,
    heightMm: DUCT_HEIGHT_MM,
  },
  {
    id: 'duct-left',
    a: vec3(14, 74),
    b: vec3(14, 210),
    widthMm: DUCT_WIDTH_MM,
    heightMm: DUCT_HEIGHT_MM,
  },
  {
    id: 'duct-right',
    a: vec3(316, 74),
    b: vec3(316, 210),
    widthMm: DUCT_WIDTH_MM,
    heightMm: DUCT_HEIGHT_MM,
  },
];

/**
 * チェック用ソケットの黄色固定配線（§6.3）。
 * `P.6 → TB_PB.4c` / `TB_PB.4a → CHK.14` / `CHK.13 → N.6` の3本。
 * PB4本体ではなく押ボタン用端子台側に接続する（盤上で配線できる端子は端子台側のため）。
 */
const FIXED_WIRES: readonly FixedWire[] = [
  {
    id: 'fw-chk-1',
    from: { kind: 'terminal', id: terminalId('P', '6') },
    to: { kind: 'terminal', id: terminalId('TB_PB', '4c') },
    color: '黄',
  },
  {
    id: 'fw-chk-2',
    from: { kind: 'terminal', id: terminalId('TB_PB', '4a') },
    to: { kind: 'socket', socket: 'S5', pin: 14 },
    color: '黄',
  },
  {
    id: 'fw-chk-3',
    from: { kind: 'socket', socket: 'S5', pin: 13 },
    to: { kind: 'terminal', id: terminalId('N', '6') },
    color: '黄',
  },
];

function buildFixedLinks(): FixedLink[] {
  const out: FixedLink[] = [];
  // DC24V電源 → P/N供給端子（P.1〜P.6 / N.1〜N.6 は内部で同電位。§6.1）
  out.push({ id: 'lk-ps-p', from: terminalId('PS', '+'), to: terminalId('P', '1') });
  for (let i = 1; i < SUPPLY_TERMINAL_COUNT; i += 1) {
    out.push({
      id: `lk-p-${i}`,
      from: terminalId('P', String(i)),
      to: terminalId('P', String(i + 1)),
    });
  }
  out.push({ id: 'lk-ps-n', from: terminalId('PS', '-'), to: terminalId('N', '1') });
  for (let i = 1; i < SUPPLY_TERMINAL_COUNT; i += 1) {
    out.push({
      id: `lk-n-${i}`,
      from: terminalId('N', String(i)),
      to: terminalId('N', String(i + 1)),
    });
  }
  // PB本体 ↔ 押ボタン用端子台（12本）。§6.4
  PUSH_BUTTON_DEFS.forEach((pb, index) => {
    for (const sign of ['c', 'a', 'b'] as const) {
      out.push({
        id: `lk-pb-${index + 1}${sign}`,
        from: terminalId(pb.id, sign),
        to: terminalId('TB_PB', `${index + 1}${sign}`),
      });
    }
  });
  // PL本体 ↔ ランプ用端子台（8本）。§6.4
  LAMP_DEFS.forEach((lamp, index) => {
    for (const sign of ['+', '-'] as const) {
      out.push({
        id: `lk-pl-${index + 1}${sign}`,
        from: terminalId(lamp.id, sign),
        to: terminalId('TB_PL', `${index + 1}${sign}`),
      });
    }
  });
  return out;
}

/** JIPM標準盤。 */
export const JIPM_BOARD: BoardDefinition = {
  id: 'board-jipm-std',
  displayName: 'JIPM標準 試験用盤',
  sizeMm: { width: BOARD_WIDTH_MM, height: BOARD_HEIGHT_MM, depth: BOARD_DEPTH_MM },
  sockets: SOCKET_ORIGINS.map((s) => ({ id: s.id, kind: 'socket-14pin', origin: s.origin })),
  pushButtons: PUSH_BUTTON_DEFS,
  lamps: LAMP_DEFS,
  supplyTerminalCount: SUPPLY_TERMINAL_COUNT,
  terminals: buildTerminals(),
  ducts: DUCTS,
  fixedWires: FIXED_WIRES,
  fixedLinks: buildFixedLinks(),
};

/** 盤IDから盤定義を引く。未知のIDは BoardError。 */
export function loadBoard(boardId: string): BoardDefinition {
  if (boardId !== JIPM_BOARD.id) throw new BoardError(`未知の盤IDです: ${boardId}`);
  return JIPM_BOARD;
}

/** 物理端子IDで端子を探す。 */
export function findBoardTerminal(
  board: BoardDefinition,
  id: TerminalId | string,
): BoardTerminal | undefined {
  return board.terminals.find((t) => t.id === id);
}

/** 物理端子IDの座標。未知の端子は BoardError。 */
export function boardTerminalPos(board: BoardDefinition, id: TerminalId | string): Vec3 {
  const found = findBoardTerminal(board, id);
  if (found === undefined) throw new BoardError(`盤に無い端子です: ${id}`);
  return found.pos;
}

/** 盤定義内の端子参照を物理端子IDに解決する。 */
export function resolveEndpoint(endpoint: BoardEndpoint): TerminalId {
  return endpoint.kind === 'terminal'
    ? endpoint.id
    : socketPinTerminal(endpoint.socket, endpoint.pin);
}
```

- [ ] `packages/board-model/src/index.ts` の末尾に次を追記する。

```ts
export {
  BLOCK_PITCH_MM,
  BLOCK_TERMINAL_Z_MM,
  BOARD_DEPTH_MM,
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  BoardError,
  BODY_TERMINAL_Z_MM,
  boardTerminalPos,
  circledNumber,
  DUCT_HEIGHT_MM,
  DUCT_WIDTH_MM,
  findBoardTerminal,
  JIPM_BOARD,
  loadBoard,
  pinRole,
  resolveEndpoint,
  SOCKET_COL_PITCH_MM,
  SOCKET_IDS,
  SOCKET_PIN_GRID,
  SOCKET_ROW_PITCH_MM,
  SOCKET_TERMINAL_Z_MM,
  socketPinTerminal,
  SUPPLY_TERMINAL_COUNT,
  TERMINAL_PICK_RADIUS_MM,
  type BoardDefinition,
  type BoardEndpoint,
  type BoardTerminal,
  type DuctSegment,
  type FixedLink,
  type FixedWire,
  type LampDefinition,
  type PushButtonColor,
  type PushButtonDefinition,
  type SocketDefinition,
  type SocketId,
  type TerminalRole,
} from './board-jipm.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/board-model test -- board.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): add jipm standard board definition

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 5: src/roles.ts — ソケットの役割割当

**Files:**
- Create: `packages/board-model/src/roles.ts`
- Test: `packages/board-model/test/roles.test.ts`
- Modify: `packages/board-model/src/index.ts`

盤は物理ソケット `S1`〜`S5` を持ち、課題がそれぞれに役割（`CR1`〜`CR4` / `T1` / `T2` / `CHK`）を割り当てる（§6.1）。**役割名がそのまま circuit-sim の部品IDになる**ので、端子IDは `CR1.13` のようになる（§6.4）。この写像を担うのがこのファイルで、盤の幾何（`S1.13`）と回路の論理（`CR1.13`）の橋渡しをする。

- [ ] 失敗するテストを書く。`packages/board-model/test/roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  hasRole,
  isSocketId,
  isSocketRole,
  roleOf,
  RoleError,
  socketOf,
  TASK1_SOCKET_ROLES,
  TASK2_SOCKET_ROLES,
  terminalIdFor,
  toNetlistTerminal,
  toPhysicalTerminal,
  validateSocketRoles,
  type SocketRoles,
} from '../src/index.js';

function t(id: string): TerminalId {
  return id as TerminalId;
}

describe('roles: 役割割当と端子ID', () => {
  it('役割名がそのまま部品IDになる（§6.4）', () => {
    expect(terminalIdFor('CR1', 13)).toBe('CR1.13');
    expect(terminalIdFor('T2', 9)).toBe('T2.9');
    expect(terminalIdFor('CHK', 14)).toBe('CHK.14');
    expect(() => terminalIdFor('CR1', 0)).toThrow(RoleError);
    expect(() => terminalIdFor('CR1', 15)).toThrow(RoleError);
  });

  it('課題1形式・課題2形式の割当は妥当（§6.1）', () => {
    expect(TASK1_SOCKET_ROLES).toEqual({
      S1: 'CR1',
      S2: 'CR2',
      S3: 'CR3',
      S4: 'CR4',
      S5: 'CHK',
    });
    expect(TASK2_SOCKET_ROLES).toEqual({
      S1: 'CR1',
      S2: 'CR2',
      S3: 'T1',
      S4: 'T2',
      S5: 'CHK',
    });
    expect(validateSocketRoles(TASK1_SOCKET_ROLES)).toEqual([]);
    expect(validateSocketRoles(TASK2_SOCKET_ROLES)).toEqual([]);
  });

  it('重複・CHK欠落・不正な役割名を検出する', () => {
    const duplicated: SocketRoles = { S1: 'CR1', S2: 'CR1', S3: 'T1', S4: 'T2', S5: 'CHK' };
    expect(validateSocketRoles(duplicated)).toContain('役割が重複しています: CR1');
    const noCheck: SocketRoles = { S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S5: 'T1' };
    expect(validateSocketRoles(noCheck)).toContain(
      'チェック用ソケット（CHK）が割り当てられていません',
    );
    const broken = {
      S1: 'XX',
      S2: 'CR2',
      S3: 'CR3',
      S4: 'CR4',
      S5: 'CHK',
    } as unknown as SocketRoles;
    expect(validateSocketRoles(broken)[0]).toBe('S1 の役割が不正です: XX');
  });

  it('物理端子IDと役割端子IDを相互変換する', () => {
    expect(toPhysicalTerminal(TASK2_SOCKET_ROLES, t('T1.9'))).toBe('S3.9');
    expect(toNetlistTerminal(TASK2_SOCKET_ROLES, t('S3.9'))).toBe('T1.9');
    expect(toPhysicalTerminal(TASK1_SOCKET_ROLES, t('TB_PB.1a'))).toBe('TB_PB.1a');
    expect(toNetlistTerminal(TASK1_SOCKET_ROLES, t('P.1'))).toBe('P.1');
    expect(toPhysicalTerminal(TASK1_SOCKET_ROLES, t('CHK.14'))).toBe('S5.14');
  });

  it('割当の照会', () => {
    expect(socketOf(TASK2_SOCKET_ROLES, 'T2')).toBe('S4');
    expect(roleOf(TASK1_SOCKET_ROLES, 'S5')).toBe('CHK');
    expect(hasRole(TASK1_SOCKET_ROLES, 'T1')).toBe(false);
    expect(() => socketOf(TASK1_SOCKET_ROLES, 'T1')).toThrow(RoleError);
    expect(isSocketRole('CR4')).toBe(true);
    expect(isSocketRole('CR9')).toBe(false);
    expect(isSocketId('S5')).toBe(true);
    expect(isSocketId('S9')).toBe(false);
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/board-model test -- roles.test.ts
```

期待出力の冒頭: `does not provide an export named 'terminalIdFor'`。

- [ ] `packages/board-model/src/roles.ts` を書く。

```ts
import { parseTerminalId, terminalId, type TerminalId } from '@ojt/circuit-sim';
import { SOCKET_IDS, socketPinTerminal, type SocketId } from './board-jipm.js';

/**
 * ソケットの役割割当。設計仕様 §6.1。
 * 役割名がそのまま circuit-sim 側の部品IDになり、端子IDは `<役割>.<ピン>`（例: `CR1.13`）となる（§6.4）。
 */

/** ソケットに割り当てられる役割。 */
export type SocketRole = 'CR1' | 'CR2' | 'CR3' | 'CR4' | 'T1' | 'T2' | 'CHK';

/** 物理ソケットID → 役割。 */
export type SocketRoles = Readonly<Record<SocketId, SocketRole>>;

/** チェック用ソケットの役割名。§6.3 */
export const CHECK_SOCKET_ROLE: SocketRole = 'CHK';

/** 課題1形式（CR4個＋チェック用）。§6.1 */
export const TASK1_SOCKET_ROLES: SocketRoles = {
  S1: 'CR1',
  S2: 'CR2',
  S3: 'CR3',
  S4: 'CR4',
  S5: 'CHK',
};

/** 課題2形式（CR2個＋T2個＋チェック用）。§6.1 */
export const TASK2_SOCKET_ROLES: SocketRoles = {
  S1: 'CR1',
  S2: 'CR2',
  S3: 'T1',
  S4: 'T2',
  S5: 'CHK',
};

/** 役割割当の参照に失敗したときに投げる。 */
export class RoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleError';
  }
}

const ALL_ROLES: readonly SocketRole[] = ['CR1', 'CR2', 'CR3', 'CR4', 'T1', 'T2', 'CHK'];

/** 文字列が役割名か。 */
export function isSocketRole(value: string): value is SocketRole {
  return (ALL_ROLES as readonly string[]).includes(value);
}

/** 文字列が物理ソケットIDか。 */
export function isSocketId(value: string): value is SocketId {
  return (SOCKET_IDS as readonly string[]).includes(value);
}

/**
 * 役割とピン番号から circuit-sim の端子IDを作る（§6.4）。
 * 例: `terminalIdFor('CR1', 13)` → `CR1.13`。
 */
export function terminalIdFor(role: SocketRole, pin: number): TerminalId {
  if (!Number.isInteger(pin) || pin < 1 || pin > 14) {
    throw new RoleError(`ピン番号が範囲外です: ${pin}`);
  }
  return terminalId(role, String(pin));
}

/** 役割割当の不正を列挙する。空配列なら妥当。 */
export function validateSocketRoles(roles: SocketRoles): string[] {
  const errors: string[] = [];
  const seen = new Set<SocketRole>();
  for (const socket of SOCKET_IDS) {
    const role = roles[socket];
    if (!isSocketRole(role)) {
      errors.push(`${socket} の役割が不正です: ${String(role)}`);
      continue;
    }
    if (seen.has(role)) errors.push(`役割が重複しています: ${role}`);
    seen.add(role);
  }
  if (!seen.has(CHECK_SOCKET_ROLE))
    errors.push('チェック用ソケット（CHK）が割り当てられていません');
  return errors;
}

/** その役割が割り当てられた物理ソケットID。無ければ RoleError。 */
export function socketOf(roles: SocketRoles, role: SocketRole): SocketId {
  const hit = SOCKET_IDS.find((socket) => roles[socket] === role);
  if (hit === undefined) throw new RoleError(`割り当てられていない役割です: ${role}`);
  return hit;
}

/** その物理ソケットの役割。 */
export function roleOf(roles: SocketRoles, socket: SocketId): SocketRole {
  return roles[socket];
}

/** その役割が割り当てられているか。 */
export function hasRole(roles: SocketRoles, role: SocketRole): boolean {
  return SOCKET_IDS.some((socket) => roles[socket] === role);
}

/**
 * 物理端子ID（`S1.13`）を circuit-sim の端子ID（`CR1.13`）に変換する。
 * ソケット以外の端子（`TB_PB.1a` / `P.1` など）はそのまま返す。
 */
export function toNetlistTerminal(roles: SocketRoles, physical: TerminalId): TerminalId {
  const parsed = parseTerminalId(physical);
  const part: string = parsed.part;
  if (!isSocketId(part)) return physical;
  return terminalId(roles[part], parsed.name);
}

/**
 * circuit-sim の端子ID（`CR1.13`）を物理端子ID（`S1.13`）に変換する。
 * ソケット以外の端子はそのまま返す。割り当てられていない役割は RoleError。
 */
export function toPhysicalTerminal(roles: SocketRoles, id: TerminalId): TerminalId {
  const parsed = parseTerminalId(id);
  const part: string = parsed.part;
  if (!isSocketRole(part)) return id;
  return socketPinTerminal(socketOf(roles, part), Number(parsed.name));
}
```

- [ ] `packages/board-model/src/index.ts` の末尾に次を追記する。

```ts
export {
  CHECK_SOCKET_ROLE,
  hasRole,
  isSocketId,
  isSocketRole,
  roleOf,
  RoleError,
  socketOf,
  TASK1_SOCKET_ROLES,
  TASK2_SOCKET_ROLES,
  terminalIdFor,
  toNetlistTerminal,
  toPhysicalTerminal,
  validateSocketRoles,
  type SocketRole,
  type SocketRoles,
} from './roles.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/board-model test -- roles.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): add socket role assignment and terminal id mapping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 6: src/catalog.ts — 部品カタログと在庫

**Files:**
- Create: `packages/board-model/src/catalog.ts`
- Test: `packages/board-model/test/catalog.test.ts`
- Modify: `packages/board-model/src/index.ts`

仕様 §6.6 の部品カタログのうち、**訓練者がソケットに装着できる部品だけ**を扱う。盤に固定されている PB／PL／電源は装着対象ではないので、それらの定義は Task 4 の盤定義側にある。タイマのレンジは §5.3.2 / §17.2 #12 の2種（0〜10s 既定・0〜60s）。

- [ ] 失敗するテストを書く。`packages/board-model/test/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  catalogEntry,
  CatalogError,
  DEFAULT_TIMER_RANGE,
  findTimerRange,
  inventoryCount,
  isMountableKind,
  PART_CATALOG,
  remainingInventory,
  snapPresetToStep,
  TIMER_RANGES,
  type MountableKind,
} from '../src/index.js';

describe('catalog: 部品カタログと在庫', () => {
  it('装着できるのはリレーとタイマの2種（§6.6）', () => {
    expect(Object.keys(PART_CATALOG)).toEqual(['relay-my4n', 'timer-h3y4']);
    expect(catalogEntry('relay-my4n').ranges).toEqual([]);
    expect(catalogEntry('timer-h3y4').ranges).toHaveLength(2);
    expect(catalogEntry('timer-h3y4').mountableOn).toBe('socket-14pin');
    expect(isMountableKind('relay-my4n')).toBe(true);
    expect(isMountableKind('plc')).toBe(false);
    expect(() => catalogEntry('plc' as MountableKind)).toThrow(CatalogError);
  });

  it('タイマのレンジは 0〜10s（0.1s刻み）と 0〜60s（0.5s刻み）（§5.3.2）', () => {
    expect(TIMER_RANGES.map((r) => `${r.id}:${r.maxMs}:${r.stepMs}`)).toEqual([
      '0-10s:10000:100',
      '0-60s:60000:500',
    ]);
    expect(DEFAULT_TIMER_RANGE.id).toBe('0-10s');
    expect(findTimerRange(60_000)?.stepMs).toBe(500);
    expect(findTimerRange(123)).toBeUndefined();
  });

  it('設定値は分解能に丸め、下限100ms・上限レンジに収める（§5.3.2）', () => {
    expect(snapPresetToStep(3040, DEFAULT_TIMER_RANGE)).toBe(3000);
    expect(snapPresetToStep(3060, DEFAULT_TIMER_RANGE)).toBe(3100);
    expect(snapPresetToStep(10, DEFAULT_TIMER_RANGE)).toBe(100);
    expect(snapPresetToStep(99_999, DEFAULT_TIMER_RANGE)).toBe(10_000);
  });

  it('在庫の計算', () => {
    const inventory = [
      { kind: 'relay-my4n' as const, count: 4 },
      { kind: 'timer-h3y4' as const, count: 2 },
    ];
    expect(inventoryCount(inventory, 'relay-my4n')).toBe(4);
    expect(inventoryCount([], 'relay-my4n')).toBe(0);
    expect(remainingInventory(inventory, ['relay-my4n', 'relay-my4n', 'timer-h3y4'])).toEqual([
      { kind: 'relay-my4n', count: 2 },
      { kind: 'timer-h3y4', count: 1 },
    ]);
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/board-model test -- catalog.test.ts
```

期待出力の冒頭: `does not provide an export named 'PART_CATALOG'`。

- [ ] `packages/board-model/src/catalog.ts` を書く。

```ts
import { TIMER_RANGE_10S_MS, TIMER_RANGE_60S_MS, TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';

/**
 * 訓練者がソケットに装着できる部品のカタログ。設計仕様 §6.6 / §5.3.1 / §5.3.2。
 * 盤に固定されている部品（PB／PL／電源）はカタログに含めない（装着対象ではないため）。
 */

/** ソケットに装着できる部品種別。§3 決定事項#3 */
export type MountableKind = 'relay-my4n' | 'timer-h3y4';

/** タイマの時間レンジ。§5.3.2 / §17.2 #12 */
export interface TimerRange {
  id: '0-10s' | '0-60s';
  /** レンジ上限[ms]。 */
  maxMs: number;
  /** 分解能[ms]。 */
  stepMs: number;
  label: string;
}

/** 選択できるタイマレンジ（既定は 0〜10s）。§5.3.2 */
export const TIMER_RANGES: readonly TimerRange[] = [
  { id: '0-10s', maxMs: TIMER_RANGE_10S_MS, stepMs: 100, label: '0〜10秒（0.1秒刻み）' },
  { id: '0-60s', maxMs: TIMER_RANGE_60S_MS, stepMs: 500, label: '0〜60秒（0.5秒刻み）' },
];

/** 既定のタイマレンジ。§5.3.2 */
export const DEFAULT_TIMER_RANGE: TimerRange = {
  id: '0-10s',
  maxMs: TIMER_RANGE_10S_MS,
  stepMs: 100,
  label: '0〜10秒（0.1秒刻み）',
};

/** タイマ設定の既定値[ms]。 */
export const DEFAULT_TIMER_PRESET_MS = 3000;

/** カタログ1件。 */
export interface CatalogEntry {
  kind: MountableKind;
  displayName: string;
  /** 装着可能なソケット種別。§6.6 */
  mountableOn: 'socket-14pin';
  pinCount: 14;
  /** 設定UIのレンジ一覧（リレーは空）。§6.6 */
  ranges: readonly TimerRange[];
}

/** 部品カタログ。 */
export const PART_CATALOG: Readonly<Record<MountableKind, CatalogEntry>> = {
  'relay-my4n': {
    kind: 'relay-my4n',
    displayName: 'ミニチュアリレー 4c（MY4N相当・DC24V）',
    mountableOn: 'socket-14pin',
    pinCount: 14,
    ranges: [],
  },
  'timer-h3y4': {
    kind: 'timer-h3y4',
    displayName: 'ミニチュアタイマ 4c（H3Y-4相当・DC24V・オンディレー）',
    mountableOn: 'socket-14pin',
    pinCount: 14,
    ranges: TIMER_RANGES,
  },
};

/** カタログ参照の失敗。 */
export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

/** 文字列が装着可能な部品種別か。 */
export function isMountableKind(value: string): value is MountableKind {
  return value === 'relay-my4n' || value === 'timer-h3y4';
}

/** カタログを引く。未知の種別は CatalogError。 */
export function catalogEntry(kind: MountableKind): CatalogEntry {
  const entry = PART_CATALOG[kind];
  if (entry === undefined) throw new CatalogError(`カタログに無い部品です: ${kind}`);
  return entry;
}

/** レンジ上限[ms]からレンジ定義を引く。 */
export function findTimerRange(maxMs: number): TimerRange | undefined {
  return TIMER_RANGES.find((r) => r.maxMs === maxMs);
}

/** 設定値をレンジの分解能に丸める（下限は 100ms）。§5.3.2 */
export function snapPresetToStep(presetMs: number, range: TimerRange): number {
  const snapped = Math.round(presetMs / range.stepMs) * range.stepMs;
  return Math.min(Math.max(snapped, TIMER_MIN_PRESET_MS), range.maxMs);
}

/** 課題が与える在庫の1件。§7.1 `inventory` */
export interface InventoryItem {
  kind: MountableKind;
  count: number;
}

/** 既定の在庫（リレー4個・タイマ2個。調査資料 §2.1 の課題1用リレー4個＋課題2用タイマ）。 */
export const DEFAULT_INVENTORY: readonly InventoryItem[] = [
  { kind: 'relay-my4n', count: 4 },
  { kind: 'timer-h3y4', count: 2 },
];

/** 在庫の本数。 */
export function inventoryCount(inventory: readonly InventoryItem[], kind: MountableKind): number {
  return inventory.find((i) => i.kind === kind)?.count ?? 0;
}

/** 在庫から装着済みぶんを引いた残り。 */
export function remainingInventory(
  inventory: readonly InventoryItem[],
  mountedKinds: readonly MountableKind[],
): InventoryItem[] {
  return inventory.map((item) => ({
    kind: item.kind,
    count: item.count - mountedKinds.filter((k) => k === item.kind).length,
  }));
}
```

- [ ] `packages/board-model/src/index.ts` の末尾に次を追記する。

```ts
export {
  catalogEntry,
  CatalogError,
  DEFAULT_INVENTORY,
  DEFAULT_TIMER_PRESET_MS,
  DEFAULT_TIMER_RANGE,
  findTimerRange,
  inventoryCount,
  isMountableKind,
  PART_CATALOG,
  remainingInventory,
  snapPresetToStep,
  TIMER_RANGES,
  type CatalogEntry,
  type InventoryItem,
  type MountableKind,
  type TimerRange,
} from './catalog.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/board-model test -- catalog.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): add mountable part catalog and inventory

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 7: src/session.ts — 盤セッションと配線操作

**Files:**
- Create: `packages/board-model/src/session.ts`
- Test: `packages/board-model/test/session.test.ts`
- Modify: `packages/board-model/src/index.ts`

訓練者の作業状態（§8.2）を1つのプレーンオブジェクト `BoardSession` に集約する。設計上の要点は3つ。

1. **既設の黄色固定配線（§6.3）を最初から `session.wires` に入れる**。こうすると「1端子2本まで」（§6.6）の計算がこの配列だけで完結し、`TB_PB.4c` / `TB_PB.4a` / `P.6` / `N.6` に残り1本しか張れないことが自動的に効く。
2. **失敗は例外ではなく Result で返す**。UIがそのまま理由を表示でき、`terminal-overload` を §5.6 #5 の危険操作として計上できる。
3. **PB／PL本体端子には配線させない**（§6.4）。盤定義の `wirable: false` を見て拒否する。

- [ ] 失敗するテストを書く。`packages/board-model/test/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PartId, TerminalId, Wire } from '@ojt/circuit-sim';
import {
  addWire,
  createSession,
  JIPM_BOARD,
  mountedKinds,
  plug,
  removeWire,
  SessionError,
  setPreset,
  TASK2_SOCKET_ROLES,
  unplug,
  wireCountAtTerminal,
  wiresAt,
  type BoardSession,
  type SocketId,
  type SocketRoles,
} from '../src/index.js';

const BZ_ID = 'BZ' as PartId;

const board = JIPM_BOARD;

function t(id: string): TerminalId {
  return id as TerminalId;
}

function session(): BoardSession {
  return createSession(board);
}

function added(result: ReturnType<typeof addWire>): Wire {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe('session: 装着と配線', () => {
  it('生成時にチェック用の黄色固定配線3本を持つ（§6.3）', () => {
    const s = session();
    expect(s.wires).toHaveLength(3);
    expect(s.wires.every((w) => w.locked && w.color === '黄')).toBe(true);
    expect(s.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'P.6-TB_PB.4c',
      'TB_PB.4a-CHK.14',
      'CHK.13-N.6',
    ]);
    expect(s.allowedColors).toEqual(['青']);
    expect(s.boardId).toBe('board-jipm-std');
  });

  it('役割割当が不正ならセッションを作れない', () => {
    const broken: SocketRoles = { S1: 'CR1', S2: 'CR1', S3: 'CR3', S4: 'CR4', S5: 'CHK' };
    expect(() => createSession(board, { roles: broken })).toThrow(SessionError);
  });

  it('電線を張る／外す（§8.2）', () => {
    const s = session();
    const wire = added(addWire(s, board, t('P.1'), t('TB_PB.1c')));
    expect(wire.id).toBe('w-001');
    expect(wire.color).toBe('青');
    expect(wire.locked).toBe(false);
    expect(wiresAt(s, t('P.1'))).toHaveLength(1);
    const removed = removeWire(s, 'w-001');
    expect(removed.ok).toBe(true);
    expect(s.wires).toHaveLength(3);
    const missing = removeWire(s, 'w-001');
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('unreachable');
    expect(missing.code).toBe('unknown-wire');
  });

  it('固定配線は削除できない（§6.3）', () => {
    const s = session();
    const result = removeWire(s, 'fw-chk-1');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('locked-wire');
    expect(result.message).toBe('チェック用回路の黄色配線は変更できません');
  });

  it('1端子2本まで。黄色配線が1本ある端子には1本しか足せない（§6.3 / §6.6）', () => {
    const s = session();
    expect(wireCountAtTerminal(s, t('TB_PB.4c'))).toBe(1);
    expect(addWire(s, board, t('TB_PB.4c'), t('P.1')).ok).toBe(true);
    const third = addWire(s, board, t('TB_PB.4c'), t('P.2'));
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('unreachable');
    expect(third.code).toBe('terminal-overload');

    const free = session();
    expect(addWire(free, board, t('TB_PL.1+'), t('P.1')).ok).toBe(true);
    expect(addWire(free, board, t('TB_PL.1+'), t('P.2')).ok).toBe(true);
    const over = addWire(free, board, t('TB_PL.1+'), t('P.3'));
    expect(over.ok).toBe(false);
    if (over.ok) throw new Error('unreachable');
    expect(over.code).toBe('terminal-overload');
  });

  it('パレット外の色・同一端子・配線不可端子・未知端子を拒否する（§6.4 / §8.1）', () => {
    const s = session();
    const color = addWire(s, board, t('P.1'), t('TB_PB.1c'), '黄');
    expect(color.ok).toBe(false);
    if (color.ok) throw new Error('unreachable');
    expect(color.code).toBe('color-not-allowed');

    const same = addWire(s, board, t('P.1'), t('P.1'));
    if (same.ok) throw new Error('unreachable');
    expect(same.code).toBe('same-terminal');

    const body = addWire(s, board, t('PB1.c'), t('P.1'));
    if (body.ok) throw new Error('unreachable');
    expect(body.code).toBe('terminal-not-wirable');

    const unknown = addWire(s, board, t('P.1'), t('ZZ.1'));
    if (unknown.ok) throw new Error('unreachable');
    expect(unknown.code).toBe('unknown-terminal');

    const buzzer = addWire(s, board, t('BZ.+'), t('P.1'));
    if (buzzer.ok) throw new Error('unreachable');
    expect(buzzer.code).toBe('terminal-unavailable');

    const withBz = createSession(board, { extraParts: [BZ_ID] });
    expect(addWire(withBz, board, t('BZ.+'), t('P.1')).ok).toBe(true);
  });

  it('白線モード（C2）では青を拒否する（§8.1）', () => {
    const s = createSession(board, { allowedColors: ['白'] });
    const white = added(addWire(s, board, t('P.1'), t('TB_PB.1c')));
    expect(white.color).toBe('白');
    const blue = addWire(s, board, t('P.2'), t('TB_PB.1b'), '青');
    if (blue.ok) throw new Error('unreachable');
    expect(blue.code).toBe('color-not-allowed');
  });

  it('装着・取り外し・在庫（§8.2 / §7.1）', () => {
    const s = createSession(board, { roles: TASK2_SOCKET_ROLES });
    expect(plug(s, 'S1', 'relay-my4n').ok).toBe(true);
    expect(mountedKinds(s)).toEqual(['relay-my4n']);
    const twice = plug(s, 'S1', 'relay-my4n');
    if (twice.ok) throw new Error('unreachable');
    expect(twice.code).toBe('socket-occupied');

    const unknown = plug(s, 'S9' as SocketId, 'relay-my4n');
    if (unknown.ok) throw new Error('unreachable');
    expect(unknown.code).toBe('unknown-socket');

    expect(plug(s, 'S3', 'timer-h3y4', { presetMs: 3000 }).ok).toBe(true);
    expect(plug(s, 'S4', 'timer-h3y4', { presetMs: 500, rangeMaxMs: 60_000 }).ok).toBe(true);
    const noStock = plug(s, 'S5', 'timer-h3y4');
    if (noStock.ok) throw new Error('unreachable');
    expect(noStock.code).toBe('inventory-exhausted');

    expect(s.mounted.S4).toEqual({ kind: 'timer-h3y4', presetMs: 500, rangeMaxMs: 60_000 });
    const removed = unplug(s, 'S1');
    expect(removed.ok).toBe(true);
    const again = unplug(s, 'S1');
    if (again.ok) throw new Error('unreachable');
    expect(again.code).toBe('socket-empty');
  });

  it('タイマ設定はレンジの分解能に丸める（§5.3.2 / §8.2）', () => {
    const s = createSession(board, { roles: TASK2_SOCKET_ROLES });
    expect(plug(s, 'S3', 'timer-h3y4').ok).toBe(true);
    expect(s.mounted.S3).toEqual({ kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 });
    const updated = setPreset(s, 'S3', 5040);
    if (!updated.ok) throw new Error(updated.message);
    expect(updated.value).toEqual({ kind: 'timer-h3y4', presetMs: 5000, rangeMaxMs: 10_000 });
    const clamped = setPreset(s, 'S3', 99_999);
    if (!clamped.ok) throw new Error(clamped.message);
    expect(clamped.value.kind === 'timer-h3y4' ? clamped.value.presetMs : 0).toBe(10_000);

    expect(plug(s, 'S1', 'relay-my4n').ok).toBe(true);
    const notTimer = setPreset(s, 'S1', 1000);
    if (notTimer.ok) throw new Error('unreachable');
    expect(notTimer.code).toBe('not-a-timer');
    const empty = setPreset(s, 'S2', 1000);
    if (empty.ok) throw new Error('unreachable');
    expect(empty.code).toBe('socket-empty');
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/board-model test -- session.test.ts
```

期待出力の冒頭: `does not provide an export named 'createSession'`。

- [ ] `packages/board-model/src/session.ts` を書く。

```ts
import {
  clampPreset,
  createWire,
  MAX_WIRES_PER_TERMINAL,
  parseTerminalId,
  type PartId,
  type TerminalId,
  type Wire,
  type WireColor,
} from '@ojt/circuit-sim';
import {
  findBoardTerminal,
  resolveEndpoint,
  SOCKET_IDS,
  type BoardDefinition,
  type SocketId,
} from './board-jipm.js';
import {
  catalogEntry,
  DEFAULT_INVENTORY,
  DEFAULT_TIMER_PRESET_MS,
  DEFAULT_TIMER_RANGE,
  findTimerRange,
  remainingInventory,
  snapPresetToStep,
  type InventoryItem,
  type MountableKind,
} from './catalog.js';
import {
  toNetlistTerminal,
  toPhysicalTerminal,
  validateSocketRoles,
  type SocketRoles,
  TASK1_SOCKET_ROLES,
} from './roles.js';

/**
 * 盤セッション（訓練者の作業状態）。設計仕様 §6.6 / §8.2。
 * 操作関数は失敗を例外ではなく Result で返す（UIがそのまま理由を表示するため）。
 */

/** 操作が失敗した理由。 */
export type SessionErrorCode =
  | 'unknown-socket'
  | 'socket-occupied'
  | 'socket-empty'
  | 'inventory-exhausted'
  | 'not-a-timer'
  | 'unknown-terminal'
  | 'terminal-not-wirable'
  | 'terminal-unavailable'
  | 'terminal-overload'
  | 'color-not-allowed'
  | 'same-terminal'
  | 'locked-wire'
  | 'unknown-wire';

/** 操作結果。 */
export type Result<T> =
  { ok: true; value: T } | { ok: false; code: SessionErrorCode; message: string };

/** 成功を作る。 */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** 失敗を作る。 */
export function fail<T>(code: SessionErrorCode, message: string): Result<T> {
  return { ok: false, code, message };
}

/** ソケットに装着された部品。 */
export type MountedPart =
  { kind: 'relay-my4n' } | { kind: 'timer-h3y4'; presetMs: number; rangeMaxMs: number };

/** 盤セッション。 */
export interface BoardSession {
  boardId: string;
  socketRoles: SocketRoles;
  /** 物理ソケットID → 装着状態。未装着のソケットはキーを持たない。 */
  mounted: Partial<Record<SocketId, MountedPart>>;
  /** 電線（既設の黄色固定配線を含む。端子IDは circuit-sim の役割ベース）。 */
  wires: Wire[];
  /** 選べる線色。モードB・D=青、C2=白（§8.1）。 */
  allowedColors: readonly WireColor[];
  /** 盤に追加した任意部品（`BZ`）。§5.3.4 */
  extraParts: readonly PartId[];
  /** 使える部品の在庫。§7.1 */
  inventory: readonly InventoryItem[];
  /** 次に発行する電線IDの連番。 */
  wireSeq: number;
}

/** セッション生成オプション。 */
export interface SessionOptions {
  roles?: SocketRoles;
  allowedColors?: readonly WireColor[];
  extraParts?: readonly PartId[];
  inventory?: readonly InventoryItem[];
}

/** 新規配線に使える既定の線色（モードB・D）。§8.1 */
export const DEFAULT_ALLOWED_COLORS: readonly WireColor[] = ['青'];

/** 役割割当が不正なときに投げる（セッションを作る前の前提違反）。 */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/**
 * 盤セッションを作る。既設の黄色固定配線（§6.3）を `locked` な電線として最初から持たせるので、
 * 端子の本数上限（§6.6）の計算がこの配列だけで完結する。
 */
export function createSession(board: BoardDefinition, options: SessionOptions = {}): BoardSession {
  const roles = options.roles ?? TASK1_SOCKET_ROLES;
  const roleErrors = validateSocketRoles(roles);
  if (roleErrors.length > 0) throw new SessionError(roleErrors.join(' / '));
  const wires: Wire[] = board.fixedWires.map((fw) =>
    createWire(
      fw.id,
      toNetlistTerminal(roles, resolveEndpoint(fw.from)),
      toNetlistTerminal(roles, resolveEndpoint(fw.to)),
      fw.color,
      true,
    ),
  );
  return {
    boardId: board.id,
    socketRoles: roles,
    mounted: {},
    wires,
    allowedColors: options.allowedColors ?? DEFAULT_ALLOWED_COLORS,
    extraParts: options.extraParts ?? [],
    inventory: options.inventory ?? DEFAULT_INVENTORY,
    wireSeq: 1,
  };
}

/** 装着済み部品の種別一覧（物理ソケット順）。 */
export function mountedKinds(session: BoardSession): MountableKind[] {
  const out: MountableKind[] = [];
  for (const socket of SOCKET_IDS) {
    const mounted = session.mounted[socket];
    if (mounted !== undefined) out.push(mounted.kind);
  }
  return out;
}

/** 部品を装着する。§8.2 */
export function plug(
  session: BoardSession,
  socketId: SocketId,
  kind: MountableKind,
  options: { presetMs?: number; rangeMaxMs?: number } = {},
): Result<MountedPart> {
  if (!SOCKET_IDS.includes(socketId)) {
    return fail('unknown-socket', `盤に無いソケットです: ${socketId}`);
  }
  if (session.mounted[socketId] !== undefined) {
    return fail('socket-occupied', `${socketId} には既に部品が装着されています`);
  }
  const entry = catalogEntry(kind);
  const remaining = remainingInventory(session.inventory, mountedKinds(session));
  const left = remaining.find((r) => r.kind === kind)?.count ?? 0;
  if (left <= 0) {
    return fail('inventory-exhausted', `${entry.displayName} の在庫がありません`);
  }
  if (kind === 'relay-my4n') {
    const part: MountedPart = { kind };
    session.mounted[socketId] = part;
    return ok(part);
  }
  const rangeMaxMs = options.rangeMaxMs ?? DEFAULT_TIMER_RANGE.maxMs;
  const range = findTimerRange(rangeMaxMs) ?? DEFAULT_TIMER_RANGE;
  const part: MountedPart = {
    kind,
    presetMs: snapPresetToStep(options.presetMs ?? DEFAULT_TIMER_PRESET_MS, range),
    rangeMaxMs: range.maxMs,
  };
  session.mounted[socketId] = part;
  return ok(part);
}

/** 部品を取り外す。§8.2 */
export function unplug(session: BoardSession, socketId: SocketId): Result<MountedPart> {
  const mounted = session.mounted[socketId];
  if (mounted === undefined) {
    return fail('socket-empty', `${socketId} に部品が装着されていません`);
  }
  delete session.mounted[socketId];
  return ok(mounted);
}

/** タイマの設定時間を変える。レンジの分解能に丸める。§8.2 */
export function setPreset(
  session: BoardSession,
  socketId: SocketId,
  presetMs: number,
): Result<MountedPart> {
  const mounted = session.mounted[socketId];
  if (mounted === undefined) {
    return fail('socket-empty', `${socketId} に部品が装着されていません`);
  }
  if (mounted.kind !== 'timer-h3y4') {
    return fail('not-a-timer', `${socketId} の部品はタイマではありません`);
  }
  const range = findTimerRange(mounted.rangeMaxMs) ?? DEFAULT_TIMER_RANGE;
  const next: MountedPart = {
    kind: 'timer-h3y4',
    presetMs: clampPreset(snapPresetToStep(presetMs, range), range.maxMs),
    rangeMaxMs: mounted.rangeMaxMs,
  };
  session.mounted[socketId] = next;
  return ok(next);
}

/** その端子に接続されている電線（既設の固定配線を含む）。§6.6 */
export function wiresAt(session: BoardSession, terminal: TerminalId): Wire[] {
  return session.wires.filter((w) => w.from === terminal || w.to === terminal);
}

/** その端子の電線本数。§6.6 */
export function wireCountAtTerminal(session: BoardSession, terminal: TerminalId): number {
  let n = 0;
  for (const w of session.wires) {
    if (w.from === terminal) n += 1;
    if (w.to === terminal) n += 1;
  }
  return n;
}

function checkTerminal(
  session: BoardSession,
  board: BoardDefinition,
  id: TerminalId,
): Result<TerminalId> {
  const physical = toPhysicalTerminal(session.socketRoles, id);
  const found = findBoardTerminal(board, physical);
  if (found === undefined) return fail('unknown-terminal', `盤に無い端子です: ${id}`);
  if (!found.wirable) {
    return fail('terminal-not-wirable', `この端子には配線できません（既設配線済み）: ${id}`);
  }
  if (found.optional) {
    const owner = parseTerminalId(physical).part;
    if (!session.extraParts.includes(owner)) {
      return fail('terminal-unavailable', `盤に載っていない部品の端子です: ${id}`);
    }
  }
  if (wireCountAtTerminal(session, id) >= MAX_WIRES_PER_TERMINAL) {
    return fail(
      'terminal-overload',
      `1つの端子に接続できるのは${MAX_WIRES_PER_TERMINAL}本までです: ${id}`,
    );
  }
  return ok(id);
}

/**
 * 電線を張る。設計仕様 §6.6 / §8.2。
 * - パレットに無い色は拒否する（モードBは青のみ、C2は白のみ。§8.1）
 * - 1端子2本を超える接続は拒否する（`terminal-overload`。UIはこれを §5.6 #5 の危険操作として計上する）
 * - PB／PL本体端子など配線不可の端子は拒否する（§6.4）
 */
export function addWire(
  session: BoardSession,
  board: BoardDefinition,
  from: TerminalId,
  to: TerminalId,
  color: WireColor = session.allowedColors[0] ?? '青',
): Result<Wire> {
  if (!session.allowedColors.includes(color)) {
    return fail('color-not-allowed', `この課題で使える線色ではありません: ${color}`);
  }
  if (from === to) return fail('same-terminal', '同じ端子どうしは接続できません');
  const checkedFrom = checkTerminal(session, board, from);
  if (!checkedFrom.ok) return checkedFrom;
  const checkedTo = checkTerminal(session, board, to);
  if (!checkedTo.ok) return checkedTo;
  const wire = createWire(`w-${String(session.wireSeq).padStart(3, '0')}`, from, to, color, false);
  session.wireSeq += 1;
  session.wires.push(wire);
  return ok(wire);
}

/** 電線を外す。固定配線（`locked`）は外せない。§6.3 */
export function removeWire(session: BoardSession, wireId: string): Result<Wire> {
  const index = session.wires.findIndex((w) => w.id === wireId);
  if (index < 0) return fail('unknown-wire', `電線が見つかりません: ${wireId}`);
  const wire = session.wires[index];
  if (wire === undefined) return fail('unknown-wire', `電線が見つかりません: ${wireId}`);
  if (wire.locked) {
    return fail('locked-wire', 'チェック用回路の黄色配線は変更できません');
  }
  session.wires.splice(index, 1);
  return ok(wire);
}
```

- [ ] `packages/board-model/src/index.ts` の末尾に次を追記する。

```ts
export {
  addWire,
  createSession,
  DEFAULT_ALLOWED_COLORS,
  fail,
  mountedKinds,
  ok,
  plug,
  removeWire,
  SessionError,
  setPreset,
  unplug,
  wireCountAtTerminal,
  wiresAt,
  type BoardSession,
  type MountedPart,
  type Result,
  type SessionErrorCode,
  type SessionOptions,
} from './session.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/board-model test -- session.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): add board session with wiring and mounting rules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 8: src/to-netlist.ts — 盤セッション → ネットリスト

**Files:**
- Create: `packages/board-model/src/to-netlist.ts`
- Test: `packages/board-model/test/to-netlist.test.ts`
- Modify: `packages/board-model/src/index.ts`

仕様 §4.4 のデータフロー「盤の初期状態 → ネットリスト」を実装する。ここが `board-model` が `circuit-sim` に依存する理由（§4.2）である。

設計の要点:

- 役割付きソケットに装着された部品は `createRelay4c(role)` / `createTimer4c(role, presetMs, rangeMaxMs)` で作る。役割名がそのまま部品IDなので端子IDは自動的に `CR1.13` になる。
- **空のソケットは「14端子だけを持ち要素を持たない部品」**として作る。端子は存在するので電線は張れるが、接点もコイルも無いので回路は開放になる（実機で部品を挿し忘れた状態と同じ）。
- 端子台（`TB_PB` / `TB_PL`）と供給端子（`P` / `N`）も同じ「端子だけの部品」で表す。これらの端子を circuit-sim の `Part.terminals` に載せておくと、未接続の端子でもテスター測定（`measureVoltage`）の対象にできる。
- ブレーカ（`CB`）と電源スイッチ（`SW`）は**ネットリストに載せない**。AC一次側であり電気的には解かないため（§5.3.5）。開閉は `Simulation.setBreaker()` / `setSwitch()` が担う。

- [ ] 失敗するテストを書く。`packages/board-model/test/to-netlist.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findPart, Simulation, type PartId, type TerminalId } from '@ojt/circuit-sim';
import {
  addWire,
  BUZZER_ID,
  createSession,
  JIPM_BOARD,
  plug,
  TASK2_SOCKET_ROLES,
  toNetlist,
  type BoardSession,
} from '../src/index.js';

const board = JIPM_BOARD;
const BUZZER_PART_ID = BUZZER_ID as PartId;

function t(id: string): TerminalId {
  return id as TerminalId;
}

function wire(session: BoardSession, from: string, to: string): void {
  const result = addWire(session, board, t(from), t(to));
  if (!result.ok) throw new Error(`${from}-${to}: ${result.message}`);
}

/** 自己保持回路（起動=PB1黒 / 停止=PB2黄 / 保持=CR1 / 表示=PL1白）を session の配線で組む。 */
function selfHoldSession(withRelay: boolean): BoardSession {
  const session = createSession(board);
  if (withRelay) {
    const plugged = plug(session, 'S1', 'relay-my4n');
    if (!plugged.ok) throw new Error(plugged.message);
  }
  wire(session, 'P.1', 'TB_PB.2c');
  wire(session, 'TB_PB.2b', 'TB_PB.1c');
  wire(session, 'TB_PB.1a', 'CR1.14');
  wire(session, 'CR1.13', 'N.1');
  wire(session, 'TB_PB.1c', 'CR1.9');
  wire(session, 'CR1.5', 'CR1.14');
  wire(session, 'P.2', 'CR1.10');
  wire(session, 'CR1.6', 'TB_PL.1+');
  wire(session, 'TB_PL.1-', 'N.2');
  return session;
}

describe('to-netlist: 盤セッション → ネットリスト', () => {
  it('部品・リンク・電線の構成（§6.4）', () => {
    const session = createSession(board, { roles: TASK2_SOCKET_ROLES });
    const netlist = toNetlist(session, board);
    expect(netlist.parts.map((p) => p.id)).toEqual([
      'PS',
      'P',
      'N',
      'TB_PB',
      'TB_PL',
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
      'PL2',
      'PL3',
      'PL4',
      'CR1',
      'CR2',
      'T1',
      'T2',
      'CHK',
    ]);
    expect(netlist.links).toHaveLength(32);
    expect(netlist.links.every((l) => l.locked)).toBe(true);
    expect(netlist.wires).toHaveLength(3);
    expect(netlist.wires.every((w) => w.locked)).toBe(true);
    expect(findPart(netlist, 'P')?.terminals).toHaveLength(6);
    expect(findPart(netlist, 'TB_PB')?.terminals).toHaveLength(12);
    expect(findPart(netlist, 'TB_PL')?.terminals).toHaveLength(8);
  });

  it('空きソケットは端子だけを持ち、装着すると部品になる（§6.6）', () => {
    const session = createSession(board, { roles: TASK2_SOCKET_ROLES });
    const empty = toNetlist(session, board);
    expect(findPart(empty, 'CR1')?.kind).toBe('terminal-block');
    expect(findPart(empty, 'CR1')?.elements).toHaveLength(0);
    expect(findPart(empty, 'CR1')?.terminals).toHaveLength(14);

    const plugged = plug(session, 'S1', 'relay-my4n');
    expect(plugged.ok).toBe(true);
    const timer = plug(session, 'S3', 'timer-h3y4', { presetMs: 2500 });
    expect(timer.ok).toBe(true);
    const built = toNetlist(session, board);
    expect(findPart(built, 'CR1')?.kind).toBe('relay-my4n');
    expect(findPart(built, 'CR1')?.elements).toHaveLength(9);
    const t1 = findPart(built, 'T1');
    expect(t1?.kind).toBe('timer-h3y4');
    expect(t1?.meta.kind === 'timer-h3y4' ? t1.meta.presetMs : 0).toBe(2500);
  });

  it('BZ は extraParts のときだけ載る（§5.3.4）', () => {
    const plain = createSession(board);
    expect(findPart(toNetlist(plain, board), 'BZ')).toBeUndefined();
    const withBz = createSession(board, { extraParts: [BUZZER_PART_ID] });
    expect(findPart(toNetlist(withBz, board), 'BZ')?.kind).toBe('buzzer');
  });

  it('session で組んだ自己保持回路が Simulation で動く（§14.1 #5）', () => {
    const session = selfHoldSession(true);
    const sim = new Simulation(toNetlist(session, board));
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('off');

    sim.press('PB1');
    sim.run(200);
    sim.release('PB1');
    sim.run(500);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');

    sim.press('PB2');
    sim.run(600);
    sim.release('PB2');
    sim.run(800);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('ソケットが空なら同じ配線でも動かない（部品未装着）', () => {
    const session = selfHoldSession(false);
    const sim = new Simulation(toNetlist(session, board));
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.press('PB1');
    sim.run(500);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    expect(sim.state().relays['CR1']).toBeUndefined();
  });

  it('チェック用ソケットの黄色配線は赤PBで励磁する回路になっている（§6.3 / §9.1）', () => {
    const session = createSession(board);
    const plugged = plug(session, 'S5', 'relay-my4n');
    expect(plugged.ok).toBe(true);
    const sim = new Simulation(toNetlist(session, board));
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.run(100);
    expect(sim.state().relays['CHK']?.contactsOn).toBe(false);
    sim.press('PB4');
    sim.run(200);
    expect(sim.state().relays['CHK']?.contactsOn).toBe(true);
    sim.release('PB4');
    sim.run(300);
    expect(sim.state().relays['CHK']?.contactsOn).toBe(false);
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/board-model test -- to-netlist.test.ts
```

期待出力の冒頭: `does not provide an export named 'toNetlist'`。

- [ ] `packages/board-model/src/to-netlist.ts` を書く。

```ts
import {
  createBuzzer,
  createLamp,
  createNetlist,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTerminalBlockLink,
  createTimer4c,
  createWire,
  partId,
  terminalId,
  type LinkElement,
  type Netlist,
  type Part,
  type TerminalId,
  type Wire,
} from '@ojt/circuit-sim';
import { SOCKET_IDS, type BoardDefinition } from './board-jipm.js';
import { terminalIdFor, type SocketRole } from './roles.js';
import type { BoardSession } from './session.js';

/**
 * 盤セッション → circuit-sim のネットリスト。設計仕様 §6.4 / §4.4。
 * 端子IDはすべて §6.4 の命名（`CR1.13` / `TB_PB.1a` / `TB_PL.1+` / `P.1` / `N.1` / `PS.+`）。
 */

/** DC24V電源の部品ID。§6.4 */
export const POWER_SUPPLY_ID = 'PS';
/** P供給端子の部品ID。§6.4 */
export const P_RAIL_ID = 'P';
/** N供給端子の部品ID。§6.4 */
export const N_RAIL_ID = 'N';
/** 押ボタン用端子台の部品ID。§6.4 */
export const PB_BLOCK_ID = 'TB_PB';
/** ランプ用端子台の部品ID。§6.4 */
export const PL_BLOCK_ID = 'TB_PL';
/** ブザー（任意部品）の部品ID。§6.4 */
export const BUZZER_ID = 'BZ';

/**
 * 端子だけを持つ部品（要素なし）。端子台と、部品が装着されていないソケットに使う。
 * 電気的実体を持たないので、節点は電線で併合されるだけになる（＝空きソケットは開放）。
 */
export function createTerminalOnlyPart(id: string, terminals: readonly TerminalId[]): Part {
  return {
    id: partId(id),
    kind: 'terminal-block',
    terminals: [...terminals],
    elements: [],
    meta: { kind: 'terminal-block' },
  };
}

/** 空きソケットを「14端子だけを持つ部品」として作る。 */
export function createEmptySocketPart(role: SocketRole): Part {
  const terminals: TerminalId[] = [];
  for (let pin = 1; pin <= 14; pin += 1) terminals.push(terminalIdFor(role, pin));
  return createTerminalOnlyPart(role, terminals);
}

function railPart(id: string, count: number): Part {
  const terminals: TerminalId[] = [];
  for (let i = 1; i <= count; i += 1) terminals.push(terminalId(id, String(i)));
  return createTerminalOnlyPart(id, terminals);
}

function pushButtonBlockPart(): Part {
  const terminals: TerminalId[] = [];
  for (let n = 1; n <= 4; n += 1) {
    for (const sign of ['c', 'a', 'b'] as const) {
      terminals.push(terminalId(PB_BLOCK_ID, `${n}${sign}`));
    }
  }
  return createTerminalOnlyPart(PB_BLOCK_ID, terminals);
}

function lampBlockPart(): Part {
  const terminals: TerminalId[] = [];
  for (let n = 1; n <= 4; n += 1) {
    for (const sign of ['+', '-'] as const) {
      terminals.push(terminalId(PL_BLOCK_ID, `${n}${sign}`));
    }
  }
  return createTerminalOnlyPart(PL_BLOCK_ID, terminals);
}

/**
 * 盤セッションからネットリストを組み立てる。
 *
 * 部品の並び（決定論）: 電源 → P/N供給端子 → 端子台2つ → PB4個 → PL4個 → BZ（任意）→ ソケットS1〜S5。
 * リンクの並び: P/N供給端子どうし → PB本体↔端子台（12本）→ PL本体↔端子台（8本）。
 * 電線: セッションの並び順のまま（先頭に既設の黄色固定配線3本）。
 *
 * ブレーカ（`CB`）と電源スイッチ（`SW`）はAC一次側にあり電気的には解かないため、
 * ネットリストには載せない。開閉は `Simulation.setBreaker()` / `setSwitch()` が担う（§5.3.5）。
 */
export function toNetlist(session: BoardSession, board: BoardDefinition): Netlist {
  const parts: Part[] = [];
  parts.push(createPowerSupply(POWER_SUPPLY_ID));
  parts.push(railPart(P_RAIL_ID, board.supplyTerminalCount));
  parts.push(railPart(N_RAIL_ID, board.supplyTerminalCount));
  parts.push(pushButtonBlockPart());
  parts.push(lampBlockPart());
  for (const pb of board.pushButtons) parts.push(createPushButton(pb.id));
  for (const lamp of board.lamps) parts.push(createLamp(lamp.id, lamp.color));
  if (session.extraParts.includes(partId(BUZZER_ID))) parts.push(createBuzzer(BUZZER_ID));
  for (const socket of SOCKET_IDS) {
    const role = session.socketRoles[socket];
    const mounted = session.mounted[socket];
    if (mounted === undefined) {
      parts.push(createEmptySocketPart(role));
    } else if (mounted.kind === 'relay-my4n') {
      parts.push(createRelay4c(role));
    } else {
      parts.push(createTimer4c(role, mounted.presetMs, mounted.rangeMaxMs));
    }
  }

  const links: LinkElement[] = board.fixedLinks.map((l) =>
    createTerminalBlockLink(l.id, l.from, l.to, true),
  );

  const wires: Wire[] = session.wires.map((w) => createWire(w.id, w.from, w.to, w.color, w.locked));

  return createNetlist(parts, wires, links);
}
```

- [ ] `packages/board-model/src/index.ts` の末尾に次を追記する。

```ts
export {
  BUZZER_ID,
  createEmptySocketPart,
  createTerminalOnlyPart,
  N_RAIL_ID,
  P_RAIL_ID,
  PB_BLOCK_ID,
  PL_BLOCK_ID,
  POWER_SUPPLY_ID,
  toNetlist,
} from './to-netlist.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/board-model test -- to-netlist.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): convert board session to circuit-sim netlist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 9: src/routing.ts — ダクト経由の自動経路

**Files:**
- Create: `packages/board-model/src/routing.ts`
- Test: `packages/board-model/test/routing.test.ts`
- Modify: `packages/board-model/src/index.ts`

仕様 §6.6「経路は自動。端子 → 最寄りダクト入口 → ダクト内 → 目的端子の最寄り出口 → 端子。ダクト内で重なる線は幅方向に 2mmピッチ で並列オフセットして描く（電線の描画直径は 1.6mm）」を実装する。

アルゴリズム:

1. 両端子の座標を引き、それぞれ**ダクト全区間のうち最も近い点**（入口・出口）を求める。
2. ダクト区間を入口・出口で分割して無向グラフを作り、ダイクストラ法で入口→出口の最短経路を求める。到達できない（ダクトが分断されている）場合は入口と出口を直結する。
3. `existingRoutes` のうち**1区間でも共有する経路の本数**を段数（`lane`）とし、経路上の各点を隣接区間の法線の平均方向へ `lane × 2mm` ずらす。段数はダクト幅で頭打ちにする（幅12mm ÷ 2mm = 6本）。
4. 端子そのものの点はずらさない。

`routeWire()` の `from` / `to` は**物理**端子ID（`S1.13` / `TB_PB.1a`）である。役割ベースの端子ID（`CR1.13`）を持つセッションからは `routeSession()` を使う（内部で `toPhysicalTerminal()` を通す）。

- [ ] 失敗するテストを書く。`packages/board-model/test/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  addWire,
  BoardError,
  boardTerminalPos,
  createSession,
  JIPM_BOARD,
  nearestDuctPoint,
  routeSession,
  routeWire,
  vec3,
  WIRE_LANE_PITCH_MM,
  type WireRoute,
} from '../src/index.js';

const board = JIPM_BOARD;

function t(id: string): TerminalId {
  return id as TerminalId;
}

function route(id: string, from: string, to: string, existing: WireRoute[] = []): WireRoute {
  return routeWire(board, { id, from: t(from), to: t(to) }, existing);
}

describe('routing: ダクト経由の自動経路（§6.6）', () => {
  it('端子 → ダクト → 端子 の折れ線を返す', () => {
    const r = route('w-1', 'TB_PB.1c', 'S1.9');
    expect(r.points[0]).toEqual(boardTerminalPos(board, 'TB_PB.1c'));
    expect(r.points[r.points.length - 1]).toEqual(boardTerminalPos(board, 'S1.9'));
    expect(r.points.length).toBeGreaterThanOrEqual(4);
    expect(r.segmentIds.length).toBeGreaterThan(0);
    expect(r.lengthMm).toBeGreaterThan(0);
    expect(r.wireId).toBe('w-1');
  });

  it('同じ入力からは必ず同じ経路（決定論）', () => {
    const a = route('w-1', 'TB_PL.1+', 'S4.14');
    const b = route('w-1', 'TB_PL.1+', 'S4.14');
    expect(b).toEqual(a);
  });

  it('同じダクト区間を通る電線は2mmピッチで並列オフセットする', () => {
    const first = route('w-1', 'TB_PB.1c', 'TB_PB.4b');
    expect(first.lane).toBe(0);
    const second = route('w-2', 'TB_PB.2c', 'TB_PB.3b', [first]);
    expect(second.lane).toBe(1);
    const third = route('w-3', 'TB_PB.2a', 'TB_PB.3c', [first, second]);
    expect(third.lane).toBe(2);

    const firstDuct = first.points[1];
    const secondDuct = second.points[1];
    if (firstDuct === undefined || secondDuct === undefined) throw new Error('duct point');
    expect(Math.abs(secondDuct.y - firstDuct.y)).toBeCloseTo(WIRE_LANE_PITCH_MM, 6);
  });

  it('ダクトを共有しない電線はオフセットされない', () => {
    const first = route('w-1', 'TB_PB.1c', 'TB_PB.4b');
    const far = route('w-2', 'P.1', 'P.4', [first]);
    expect(far.lane).toBe(0);
  });

  it('並列オフセットはダクト幅で頭打ちになる（幅12mm ÷ 2mm = 6本）', () => {
    const existing: WireRoute[] = [];
    let last = route('w-0', 'TB_PB.1c', 'TB_PB.4b');
    existing.push(last);
    for (let i = 1; i < 10; i += 1) {
      last = route(`w-${i}`, 'TB_PB.1c', 'TB_PB.4b', existing);
      existing.push(last);
    }
    expect(last.lane).toBe(5);
  });

  it('ダクト上の最寄り点', () => {
    const hit = nearestDuctPoint(board.ducts, vec3(100, 80));
    expect(hit.segmentId).toBe('duct-top');
    expect(hit.point).toEqual({ x: 100, y: 74, z: 0 });
    expect(nearestDuctPoint([], vec3(1, 2)).segmentId).toBe('');
  });

  it('盤に無い端子は BoardError', () => {
    expect(() => route('w-1', 'ZZ.1', 'P.1')).toThrow(BoardError);
  });

  it('ダクトが分断されていて到達できないときは入口と出口を直結する', () => {
    const split = {
      ...board,
      ducts: [
        { id: 'd1', a: vec3(14, 74), b: vec3(160, 74), widthMm: 12, heightMm: 25 },
        { id: 'd2', a: vec3(200, 210), b: vec3(316, 210), widthMm: 12, heightMm: 25 },
      ],
    };
    const r = routeWire(split, { id: 'w-1', from: t('P.1'), to: t('TB_PB.4b') }, []);
    expect(r.segmentIds).toEqual(['d1', 'd2']);
    expect(r.points).toHaveLength(4);
    expect(r.points[1]).toEqual({ x: 120, y: 74, z: 0 });
    expect(r.points[2]).toEqual({ x: 249, y: 210, z: 0 });
  });

  it('セッションの全電線を並び順に経路化する', () => {
    const session = createSession(board);
    const added = addWire(session, board, t('P.1'), t('TB_PB.1c'));
    expect(added.ok).toBe(true);
    const routes = routeSession(board, session);
    expect(routes).toHaveLength(session.wires.length);
    expect(routes.map((r) => r.wireId)).toEqual(['fw-chk-1', 'fw-chk-2', 'fw-chk-3', 'w-001']);
    // 役割端子（CHK.14）が物理端子（S5.14）に解決されている
    const chk = routes[1];
    if (chk === undefined) throw new Error('route');
    expect(chk.points[chk.points.length - 1]).toEqual(boardTerminalPos(board, 'S5.14'));
    expect(routeSession(board, session)).toEqual(routes);
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/board-model test -- routing.test.ts
```

期待出力の冒頭: `does not provide an export named 'routeWire'`。

- [ ] `packages/board-model/src/routing.ts` を書く。

```ts
import type { TerminalId } from '@ojt/circuit-sim';
import { boardTerminalPos, type BoardDefinition, type DuctSegment } from './board-jipm.js';
import {
  addVec,
  distance,
  nearestPointOnSegment,
  normalXY,
  polylineLength,
  roundVec,
  scaleVec,
  vec3,
  vecEquals,
  type Vec3,
} from './geometry.js';
import { toPhysicalTerminal } from './roles.js';
import type { BoardSession } from './session.js';

/**
 * 電線の自動経路生成。設計仕様 §6.6「端子 → 最寄りダクト入口 → ダクト内 → 最寄り出口 → 端子」。
 * 純関数・決定論（乱数も時刻も使わない）。
 */

/** 電線の描画直径[mm]。§6.6 */
export const WIRE_DIAMETER_MM = 1.6;
/** ダクト内で重なる電線の並列オフセット幅[mm]。§6.6 */
export const WIRE_LANE_PITCH_MM = 2;

/** 経路を求める対象の電線（端子IDは**物理**端子ID）。 */
export interface RoutableWire {
  id: string;
  from: TerminalId;
  to: TerminalId;
}

/** 求めた経路。 */
export interface WireRoute {
  wireId: string;
  /** 端子 → ダクト → 端子 の折れ線[mm]。 */
  points: Vec3[];
  /** 通過したダクト区間のID（通過順）。 */
  segmentIds: string[];
  /** ダクト内での並列オフセットの段数（0起点）。 */
  lane: number;
  /** 経路長[mm]。 */
  lengthMm: number;
}

function nodeKey(v: Vec3): string {
  const r = roundVec(v, 3);
  return `${r.x},${r.y}`;
}

interface GraphEdge {
  to: string;
  segmentId: string;
  weight: number;
}

interface DuctGraph {
  points: Map<string, Vec3>;
  edges: Map<string, GraphEdge[]>;
}

function addEdge(graph: DuctGraph, a: Vec3, b: Vec3, segmentId: string): void {
  const ka = nodeKey(a);
  const kb = nodeKey(b);
  if (ka === kb) return;
  graph.points.set(ka, a);
  graph.points.set(kb, b);
  const weight = distance(a, b);
  const listA = graph.edges.get(ka) ?? [];
  listA.push({ to: kb, segmentId, weight });
  graph.edges.set(ka, listA);
  const listB = graph.edges.get(kb) ?? [];
  listB.push({ to: ka, segmentId, weight });
  graph.edges.set(kb, listB);
}

/** ダクト区間を、区間上に載る追加点で分割してグラフにする。 */
function buildDuctGraph(ducts: readonly DuctSegment[], extras: readonly Vec3[]): DuctGraph {
  const graph: DuctGraph = { points: new Map(), edges: new Map() };
  for (const duct of ducts) {
    const cuts: Array<{ t: number; p: Vec3 }> = [
      { t: 0, p: duct.a },
      { t: 1, p: duct.b },
    ];
    for (const extra of extras) {
      const hit = nearestPointOnSegment(extra, duct.a, duct.b);
      if (hit.distance > 1e-6) continue;
      cuts.push({ t: hit.t, p: hit.point });
    }
    cuts.sort((x, y) => x.t - y.t);
    const unique: Vec3[] = [];
    for (const cut of cuts) {
      const last = unique[unique.length - 1];
      if (last !== undefined && vecEquals(last, cut.p, 1e-6)) continue;
      unique.push(cut.p);
    }
    for (let i = 1; i < unique.length; i += 1) {
      const a = unique[i - 1];
      const b = unique[i];
      if (a === undefined || b === undefined) continue;
      addEdge(graph, a, b, duct.id);
    }
  }
  return graph;
}

/** ダクト上で指定点に最も近い点（同距離なら定義順で先の区間）。 */
export function nearestDuctPoint(
  ducts: readonly DuctSegment[],
  p: Vec3,
): { point: Vec3; segmentId: string; distance: number } {
  let best: { point: Vec3; segmentId: string; distance: number } | undefined;
  for (const duct of ducts) {
    const hit = nearestPointOnSegment(p, duct.a, duct.b);
    if (best === undefined || hit.distance < best.distance) {
      best = { point: hit.point, segmentId: duct.id, distance: hit.distance };
    }
  }
  if (best === undefined) return { point: p, segmentId: '', distance: 0 };
  return best;
}

/** ダイクストラ法で最短経路（節点キーの列）を求める。到達できなければ undefined。 */
function shortestPath(
  graph: DuctGraph,
  startKey: string,
  goalKey: string,
): { keys: string[]; segmentIds: string[] } | undefined {
  const dist = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, { key: string; segmentId: string }>();
  const visited = new Set<string>();
  for (;;) {
    let current: string | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const [key, d] of dist) {
      if (visited.has(key) || d >= best) continue;
      current = key;
      best = d;
    }
    if (current === undefined) break;
    if (current === goalKey) break;
    visited.add(current);
    for (const edge of graph.edges.get(current) ?? []) {
      const next = best + edge.weight;
      if (next >= (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      dist.set(edge.to, next);
      prev.set(edge.to, { key: current, segmentId: edge.segmentId });
    }
  }
  if (!dist.has(goalKey)) return undefined;
  const keys: string[] = [goalKey];
  const segmentIds: string[] = [];
  let cursor = goalKey;
  while (cursor !== startKey) {
    const step = prev.get(cursor);
    if (step === undefined) return undefined;
    keys.push(step.key);
    segmentIds.push(step.segmentId);
    cursor = step.key;
  }
  keys.reverse();
  segmentIds.reverse();
  return { keys, segmentIds };
}

/** 折れ線の各点を、隣接区間の法線の平均方向へ `offset` [mm] ずらす。 */
function offsetPath(path: readonly Vec3[], offset: number, fallbackNormal: Vec3): Vec3[] {
  if (offset === 0) return [...path];
  return path.map((point, index) => {
    const before = index > 0 ? path[index - 1] : undefined;
    const after = index + 1 < path.length ? path[index + 1] : undefined;
    let nx = 0;
    let ny = 0;
    if (before !== undefined) {
      const n = normalXY(before, point);
      nx += n.x;
      ny += n.y;
    }
    if (after !== undefined) {
      const n = normalXY(point, after);
      nx += n.x;
      ny += n.y;
    }
    if (nx === 0 && ny === 0) {
      nx = fallbackNormal.x;
      ny = fallbackNormal.y;
    }
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len === 0) return point;
    return addVec(point, scaleVec(vec3(nx / len, ny / len, 0), offset));
  });
}

function dedupe(points: readonly Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && vecEquals(last, p, 1e-6)) continue;
    out.push(p);
  }
  return out;
}

/**
 * 1本の電線の経路を求める。§6.6
 * 同じダクト区間を通る既存経路の本数だけ、2mmピッチで幅方向に並列オフセットする。
 * `wire.from` / `wire.to` は**物理**端子ID（`S1.13` / `TB_PB.1a` など）。
 * 役割ベースの端子IDから変換するには `toPhysicalTerminal()` を使う（`routeSession()` はそれを行う）。
 */
export function routeWire(
  board: BoardDefinition,
  wire: RoutableWire,
  existingRoutes: readonly WireRoute[],
): WireRoute {
  const fromPos = boardTerminalPos(board, wire.from);
  const toPos = boardTerminalPos(board, wire.to);
  const entry = nearestDuctPoint(board.ducts, fromPos);
  const exit = nearestDuctPoint(board.ducts, toPos);
  const graph = buildDuctGraph(board.ducts, [entry.point, exit.point]);
  const found = shortestPath(graph, nodeKey(entry.point), nodeKey(exit.point));

  const rawPath: Vec3[] =
    found === undefined
      ? [entry.point, exit.point]
      : found.keys.map((key) => graph.points.get(key) ?? entry.point);
  const segmentIds = dedupeStrings(
    found === undefined ? [entry.segmentId, exit.segmentId] : found.segmentIds,
  );

  const shared = existingRoutes.filter((r) => r.segmentIds.some((s) => segmentIds.includes(s)));
  const widths = board.ducts.filter((d) => segmentIds.includes(d.id)).map((d) => d.widthMm);
  const minWidth = widths.length === 0 ? WIRE_LANE_PITCH_MM : Math.min(...widths);
  const maxLanes = Math.max(1, Math.floor(minWidth / WIRE_LANE_PITCH_MM));
  const lane = Math.min(shared.length, maxLanes - 1);

  const fallback = normalXY(entry.point, exit.point);
  const routed = offsetPath(rawPath, lane * WIRE_LANE_PITCH_MM, fallback);
  const points = dedupe([fromPos, ...routed, toPos]);
  return { wireId: wire.id, points, segmentIds, lane, lengthMm: polylineLength(points) };
}

function dedupeStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v.length === 0 || out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

/** セッションの全電線の経路を、配列の並び順に求める。§6.6 */
export function routeSession(board: BoardDefinition, session: BoardSession): WireRoute[] {
  const routes: WireRoute[] = [];
  for (const wire of session.wires) {
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
  }
  return routes;
}
```

- [ ] `packages/board-model/src/index.ts` の末尾に次を追記する。

```ts
export {
  nearestDuctPoint,
  routeSession,
  routeWire,
  WIRE_DIAMETER_MM,
  WIRE_LANE_PITCH_MM,
  type RoutableWire,
  type WireRoute,
} from './routing.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/board-model test -- routing.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): add deterministic duct routing with parallel offsets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 10: src/index.ts — board-model の公開APIを確定する

**Files:**
- Modify: `packages/board-model/src/index.ts`

Task 3〜9 で追記してきた再輸出を、次の最終形と一致しているか突き合わせる（並び順もこのとおりにする）。

- [ ] `packages/board-model/src/index.ts` を次の内容にする。

```ts
export {
  addVec,
  distance,
  nearestPointOnPolyline,
  nearestPointOnSegment,
  normalXY,
  polylineLength,
  roundVec,
  scaleVec,
  subVec,
  vec3,
  vecEquals,
  vecLength,
  type NearestPoint,
  type Polyline,
  type Vec3,
} from './geometry.js';

export {
  BLOCK_PITCH_MM,
  BLOCK_TERMINAL_Z_MM,
  BOARD_DEPTH_MM,
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  BoardError,
  BODY_TERMINAL_Z_MM,
  boardTerminalPos,
  circledNumber,
  DUCT_HEIGHT_MM,
  DUCT_WIDTH_MM,
  findBoardTerminal,
  JIPM_BOARD,
  loadBoard,
  pinRole,
  resolveEndpoint,
  SOCKET_COL_PITCH_MM,
  SOCKET_IDS,
  SOCKET_PIN_GRID,
  SOCKET_ROW_PITCH_MM,
  SOCKET_TERMINAL_Z_MM,
  socketPinTerminal,
  SUPPLY_TERMINAL_COUNT,
  TERMINAL_PICK_RADIUS_MM,
  type BoardDefinition,
  type BoardEndpoint,
  type BoardTerminal,
  type DuctSegment,
  type FixedLink,
  type FixedWire,
  type LampDefinition,
  type PushButtonColor,
  type PushButtonDefinition,
  type SocketDefinition,
  type SocketId,
  type TerminalRole,
} from './board-jipm.js';

export {
  CHECK_SOCKET_ROLE,
  hasRole,
  isSocketId,
  isSocketRole,
  roleOf,
  RoleError,
  socketOf,
  TASK1_SOCKET_ROLES,
  TASK2_SOCKET_ROLES,
  terminalIdFor,
  toNetlistTerminal,
  toPhysicalTerminal,
  validateSocketRoles,
  type SocketRole,
  type SocketRoles,
} from './roles.js';

export {
  catalogEntry,
  CatalogError,
  DEFAULT_INVENTORY,
  DEFAULT_TIMER_PRESET_MS,
  DEFAULT_TIMER_RANGE,
  findTimerRange,
  inventoryCount,
  isMountableKind,
  PART_CATALOG,
  remainingInventory,
  snapPresetToStep,
  TIMER_RANGES,
  type CatalogEntry,
  type InventoryItem,
  type MountableKind,
  type TimerRange,
} from './catalog.js';

export {
  addWire,
  createSession,
  DEFAULT_ALLOWED_COLORS,
  fail,
  mountedKinds,
  ok,
  plug,
  removeWire,
  SessionError,
  setPreset,
  unplug,
  wireCountAtTerminal,
  wiresAt,
  type BoardSession,
  type MountedPart,
  type Result,
  type SessionErrorCode,
  type SessionOptions,
} from './session.js';

export {
  BUZZER_ID,
  createEmptySocketPart,
  createTerminalOnlyPart,
  N_RAIL_ID,
  P_RAIL_ID,
  PB_BLOCK_ID,
  PL_BLOCK_ID,
  POWER_SUPPLY_ID,
  toNetlist,
} from './to-netlist.js';

export {
  nearestDuctPoint,
  routeSession,
  routeWire,
  WIRE_DIAMETER_MM,
  WIRE_LANE_PITCH_MM,
  type RoutableWire,
  type WireRoute,
} from './routing.js';
```

- [ ] board-model の全テスト・カバレッジ・型検査・lint を確認する。

```powershell
pnpm --filter @ojt/board-model exec vitest run --coverage
pnpm --filter @ojt/board-model typecheck
pnpm exec eslint .
```

期待出力: `Tests  47 passed (47)`、カバレッジは全項目90%以上（実測: Statements 97.75% / Branches 91.91% / Functions 100% / Lines 99.56%）、`tsc` と `eslint` は何も出さず終了。

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): finalize public api surface

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 11: schematic-core パッケージの雛形

**Files:**
- Create: `packages/schematic-core/package.json`, `packages/schematic-core/tsconfig.json`, `packages/schematic-core/vitest.config.ts`, `packages/schematic-core/src/index.ts`
- Test: `packages/schematic-core/test/scaffold.test.ts`

- [ ] 失敗するテストを書く。`packages/schematic-core/test/scaffold.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('scaffold', () => {
  it('パッケージ名を公開している', () => {
    expect(PACKAGE_NAME).toBe('@ojt/schematic-core');
  });
});
```

- [ ] `packages/schematic-core/package.json` を作る。

```json
{
  "name": "@ojt/schematic-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@ojt/board-model": "workspace:*",
    "@ojt/circuit-sim": "workspace:*"
  }
}
```

- [ ] `packages/schematic-core/tsconfig.json` を作る。

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

- [ ] `packages/schematic-core/vitest.config.ts` を作る。

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm install
pnpm --filter @ojt/schematic-core test
```

期待出力: `Error: Failed to load url ../src/index.js`。

- [ ] `packages/schematic-core/src/index.ts` を作る（Task 16 で公開APIの再輸出に置き換える）。

```ts
/** パッケージ名。スキャフォールドの疎通確認用。 */
export const PACKAGE_NAME = '@ojt/schematic-core';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/schematic-core test
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] コミットする。

```powershell
git add packages/schematic-core pnpm-lock.yaml
git commit -m @'
chore(schematic-core): scaffold package with vitest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 12: src/document.ts — 展開接続図の文書モデル

**Files:**
- Create: `packages/schematic-core/src/document.ts`
- Test: `packages/schematic-core/test/document.test.ts`
- Modify: `packages/schematic-core/src/index.ts`

仕様 §11.1 の文書形式を実装する。向きは**横書き固定**（左が `P(+24V)`、右が `N(0V)`）で、縦書きは表示だけの切替なので文書モデルには持たせない。

構造の選び方: §11.1 は「行＝段（ラング）、列＝段内の直列位置」と定め、要素として「結線（横線・縦線）」「分岐点」を挙げている。本計画では**横線を暗黙**（段の中で隣り合う要素どうしは繋がっている）とし、**縦線と分岐点を「段の端点が他の段の節点を指す」形**で表す。段は `from`（始点）・`to`（終点）・`cells`（直列要素）の3つだけを持ち、節点 k は「k個目の要素の左側」を指す（節点0が `from`、節点 `cells.length` が `to`）。こうすると自己保持の分岐は「段r2 が 段r1 の節点1から節点2へ渡る」という1行で書け、検証も割当もレイアウトも同じ構造をそのまま辿れる。

`validateDocument()` が見る構造エラー（zodは使わない。§11.1 の範囲ではこれで十分なため）:

| 検査 | 内容 |
|---|---|
| `formatVersion` | 未知のバージョンを読み込まない（§13 #8） |
| `orientation` | 常に `horizontal` |
| 段・要素のID | 文書内で一意 |
| 機器名 | `pb-*`=`PB1`〜`PB4` / `cr-*`=`CR1`〜`CR4` / `t-*`=`T1`・`T2` / `coil`=`CRn`・`Tn` / `lamp`=`PL1`〜`PL4` / `buzzer`=`BZ` |
| タイマコイル | `presetMs` が必須。それ以外の要素は `presetMs` を持てない |
| 端点 | 参照先の段が存在し、節点番号が範囲内で、自分自身を参照しない |
| 負荷の位置 | 右母線(N)に至る段は負荷1つで終わる。分岐段（右母線に至らない段）に負荷は置けない |

- [ ] 失敗するテストを書く。`packages/schematic-core/test/document.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  at,
  BUS_N,
  BUS_P,
  buzzer,
  coil,
  crA,
  crB,
  createDocument,
  documentDevices,
  isContactCell,
  isLoadCell,
  lamp,
  pbA,
  pbB,
  rung,
  rungNodeCount,
  SCHEMATIC_FORMAT_VERSION,
  tA,
  tB,
  validateDocument,
} from '../src/index.js';
import { flickerDoc, selfHoldDoc } from './helpers/docs.js';

describe('document: 展開接続図の文書モデル（§11.1）', () => {
  it('横書き・formatVersion を持つ', () => {
    const doc = selfHoldDoc();
    expect(doc.formatVersion).toBe(SCHEMATIC_FORMAT_VERSION);
    expect(doc.orientation).toBe('horizontal');
    expect(validateDocument(doc)).toEqual([]);
    expect(validateDocument(flickerDoc())).toEqual([]);
  });

  it('要素の分類と節点数', () => {
    expect(isLoadCell(coil('x', 'CR1'))).toBe(true);
    expect(isLoadCell(lamp('x', 'PL1'))).toBe(true);
    expect(isLoadCell(buzzer('x'))).toBe(true);
    expect(isContactCell(crA('x', 'CR1'))).toBe(true);
    expect(isContactCell(tB('x', 'T1'))).toBe(true);
    expect(rungNodeCount(rung('r', BUS_P, BUS_N, [crA('a', 'CR1'), coil('b', 'CR2')]))).toBe(3);
    expect(documentDevices(selfHoldDoc())).toEqual(['PB2', 'PB1', 'CR1', 'PL1']);
  });

  it('未知のバージョン・向きを弾く（§13 #8）', () => {
    const doc = { ...selfHoldDoc(), formatVersion: 99 };
    expect(validateDocument(doc)[0]?.path).toBe('formatVersion');
    const vertical = { ...selfHoldDoc(), orientation: 'vertical' as unknown as 'horizontal' };
    expect(validateDocument(vertical)[0]?.message).toBe(
      '文書モデルは常に横書き（左P・右N）で保持します',
    );
    expect(validateDocument(createDocument('x', '空', []))[0]?.path).toBe('rungs');
  });

  it('機器名の妥当性を見る', () => {
    const bad = createDocument('x', '不正', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'CR1'), coil('c2', 'PL1')]),
    ]);
    const errors = validateDocument(bad).map((e) => e.message);
    expect(errors).toContain('pb-a に使えない機器名です: CR1');
    expect(errors).toContain('coil に使えない機器名です: PL1');
  });

  it('タイマコイルには presetMs が要る／他の要素には置けない（§5.3.2）', () => {
    const noPreset = createDocument('x', 'タイマ', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), { kind: 'coil', id: 'c2', device: 'T1' }]),
    ]);
    expect(validateDocument(noPreset).map((e) => e.message)).toContain(
      'タイマコイルには presetMs が必要です: T1',
    );
    const strayPreset = createDocument('x', 'ランプ', [
      rung('r1', BUS_P, BUS_N, [{ kind: 'lamp', id: 'c1', device: 'PL1', presetMs: 100 }]),
    ]);
    expect(validateDocument(strayPreset).map((e) => e.message)).toContain(
      'presetMs を持てるのはタイマコイルだけです: c1',
    );
  });

  it('ID重複・空の段・自己参照・範囲外の節点を弾く', () => {
    const dup = createDocument('x', '重複', [
      rung('r1', BUS_P, BUS_N, [coil('c1', 'CR1')]),
      rung('r1', BUS_P, BUS_N, [coil('c1', 'CR2')]),
    ]);
    const messages = validateDocument(dup).map((e) => e.message);
    expect(messages).toContain('段IDが重複しています: r1');
    expect(messages).toContain('要素IDが重複しています: c1');

    const empty = createDocument('x', '空段', [rung('r1', BUS_P, BUS_N, [])]);
    expect(validateDocument(empty).map((e) => e.message)).toContain('段に要素がありません: r1');

    const selfRef = createDocument('x', '自己参照', [
      rung('r1', at('r1', 0), BUS_N, [coil('c1', 'CR1')]),
    ]);
    expect(validateDocument(selfRef).map((e) => e.message)).toContain(
      '段が自分自身を参照しています: r1',
    );

    const unknown = createDocument('x', '未知参照', [
      rung('r1', at('rX', 0), BUS_N, [coil('c1', 'CR1')]),
    ]);
    expect(validateDocument(unknown).map((e) => e.message)).toContain('参照先の段がありません: rX');

    const outOfRange = createDocument('x', '範囲外', [
      rung('r1', BUS_P, BUS_N, [coil('c1', 'CR1')]),
      rung('r2', at('r1', 5), at('r1', 1), [crA('c2', 'CR1')]),
    ]);
    expect(validateDocument(outOfRange).map((e) => e.message)).toContain(
      '参照先の節点番号が範囲外です: r1#5（0〜1）',
    );
  });

  it('右母線に至る段は負荷で終わり、分岐段には負荷を置けない（§11.1）', () => {
    const noLoad = createDocument('x', '負荷なし', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), crB('c2', 'CR1')]),
    ]);
    expect(validateDocument(noLoad).map((e) => e.message)).toContain(
      '右母線(N)に至る段は負荷（コイル／ランプ／ブザー）で終わる必要があります: r1',
    );

    const branchLoad = createDocument('x', '分岐に負荷', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 0), at('r1', 1), [lamp('c3', 'PL1')]),
    ]);
    expect(validateDocument(branchLoad).map((e) => e.message)).toContain(
      '分岐段（右母線に至らない段）に負荷は置けません: r2',
    );

    const twoLoads = createDocument('x', '負荷2つ', [
      rung('r1', BUS_P, BUS_N, [coil('c1', 'CR1'), lamp('c2', 'PL1')]),
    ]);
    expect(validateDocument(twoLoads).map((e) => e.message)).toContain(
      '1つの段に負荷は1つだけです: r1',
    );
  });

  it('未知の要素種別を弾く', () => {
    const doc = createDocument('x', '未知種別', [
      rung('r1', BUS_P, BUS_N, [
        { kind: 'relay' as unknown as 'coil', id: 'c1', device: 'CR1' },
        coil('c2', 'CR1'),
      ]),
    ]);
    expect(validateDocument(doc).map((e) => e.message)).toContain('未知の要素種別です: relay');
  });

  it('要素の生成ヘルパ', () => {
    expect(pbB('c', 'PB3')).toEqual({ kind: 'pb-b', id: 'c', device: 'PB3' });
    expect(tA('c', 'T2')).toEqual({ kind: 't-a', id: 'c', device: 'T2' });
    expect(coil('c', 'T1', 500)).toEqual({ kind: 'coil', id: 'c', device: 'T1', presetMs: 500 });
    expect(buzzer('c')).toEqual({ kind: 'buzzer', id: 'c', device: 'BZ' });
  });
});
```

このテストは Task 13 以降で使う回路図ヘルパを参照する。先に作る。

- [ ] `packages/schematic-core/test/helpers/docs.ts` を作る。

```ts
import {
  at,
  BUS_N,
  BUS_P,
  coil,
  crA,
  crB,
  createDocument,
  lamp,
  pbA,
  pbB,
  rung,
  tA,
  type SchematicDocument,
} from '../../src/index.js';

/** 自己保持回路（起動=PB1黒 / 停止=PB2黄 / 保持=CR1 / 表示=PL1白）。調査資料 §5.5 */
export function selfHoldDoc(): SchematicDocument {
  return createDocument('b-self-hold', '自己保持回路', [
    rung('r1', BUS_P, BUS_N, [pbB('c1', 'PB2'), pbA('c2', 'PB1'), coil('c3', 'CR1')]),
    rung('r2', at('r1', 1), at('r1', 2), [crA('c4', 'CR1')]),
    rung('r3', BUS_P, BUS_N, [crA('c5', 'CR1'), lamp('c6', 'PL1')]),
  ]);
}

/** インターロック（先行優先）。PB1でCR1、PB2でCR2。互いのb接点で相手を締め出す。§14.1 #6 */
export function interlockDoc(): SchematicDocument {
  return createDocument('b-interlock', 'インターロック回路', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), crB('c2', 'CR2'), coil('c3', 'CR1')]),
    rung('r2', at('r1', 0), at('r1', 1), [crA('c4', 'CR1')]),
    rung('r3', BUS_P, BUS_N, [pbA('c5', 'PB2'), crB('c6', 'CR1'), coil('c7', 'CR2')]),
    rung('r4', at('r3', 0), at('r3', 1), [crA('c8', 'CR2')]),
    rung('r5', BUS_P, BUS_N, [crA('c9', 'CR1'), lamp('c10', 'PL1')]),
    rung('r6', BUS_P, BUS_N, [crA('c11', 'CR2'), lamp('c12', 'PL2')]),
  ]);
}

/** オンディレー（PB1を押している間だけ計時し、3秒でPL1が点灯）。§14.1 #8 */
export function onDelayDoc(): SchematicDocument {
  return createDocument('b-on-delay', 'オンディレー回路', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', 3000)]),
    rung('r2', BUS_P, BUS_N, [tA('c3', 'T1'), lamp('c4', 'PL1')]),
  ]);
}

/**
 * フリッカ（CR2個＋T2個）。§14.1 #11
 * 各タイマの通電断が相手タイマの設定時間ぶん続くため、禁則回路（§5.5）にならない。
 */
export function flickerDoc(): SchematicDocument {
  return createDocument('b-flicker', 'フリッカ回路（リレー併用）', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), crB('c2', 'CR1'), coil('c3', 'T1', 500)]),
    rung('r2', at('r1', 1), BUS_N, [crB('c4', 'CR2'), tA('c5', 'T1'), coil('c6', 'CR1')]),
    rung('r3', at('r2', 1), at('r2', 2), [crA('c7', 'CR1')]),
    rung('r4', at('r1', 1), BUS_N, [crA('c8', 'CR1'), coil('c9', 'T2', 500)]),
    rung('r5', at('r1', 1), BUS_N, [tA('c10', 'T2'), coil('c11', 'CR2')]),
    rung('r6', at('r1', 1), BUS_N, [crA('c12', 'CR1'), lamp('c13', 'PL1')]),
  ]);
}
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/schematic-core test -- document.test.ts
```

期待出力の冒頭: `does not provide an export named 'createDocument'`。

- [ ] `packages/schematic-core/src/document.ts` を書く。

```ts
/**
 * 展開接続図の文書モデル。設計仕様 §11.1。
 * 向きは**横書き**固定（左母線が `P(+24V)`、右母線が `N(0V)`）。縦書きは表示だけの切替で、
 * 文書モデルは常に横書きで保持する。
 *
 * 構造はグリッド。**行＝段（ラング）**、**列＝段内の直列位置**。
 * 段は「始点 → 直列に並んだ要素 → 終点」の1本の経路で、始点・終点は母線か他の段の節点を指す。
 * 段どうしを結ぶこの参照が、縦線（分岐）と分岐点そのものになる。
 */

/** 文書形式のバージョン。§13 #8 */
export const SCHEMATIC_FORMAT_VERSION = 1;

/** 接点要素の種別。§11.1 */
export type ContactCellKind = 'pb-a' | 'pb-b' | 'cr-a' | 'cr-b' | 't-a' | 't-b';

/** 負荷要素の種別。§11.1 */
export type LoadCellKind = 'coil' | 'lamp' | 'buzzer';

/** 要素の種別。 */
export type CellKind = ContactCellKind | LoadCellKind;

/** 段の中の1要素。 */
export interface SchematicCell {
  kind: CellKind;
  /** 文書内で一意な要素ID（`physicalOverride` のキーにもなる。§7.2）。 */
  id: string;
  /** 機器名（`PB1`〜`PB4` / `CR1`〜`CR4` / `T1`・`T2` / `PL1`〜`PL4` / `BZ`）。§6.4 */
  device: string;
  /** タイマコイルの設定時間[ms]（`kind: 'coil'` かつ `device` が `Tn` のときだけ持つ）。§5.3.2 */
  presetMs?: number;
}

/** 段の端点。母線か、他の段の節点。 */
export type RungEnd = { bus: 'P' } | { bus: 'N' } | { rung: string; node: number };

/** 1段（ラング）。`cells` の並びがそのまま直列位置（列）になる。 */
export interface Rung {
  id: string;
  from: RungEnd;
  to: RungEnd;
  cells: SchematicCell[];
}

/** 展開接続図の文書。 */
export interface SchematicDocument {
  formatVersion: number;
  id: string;
  title: string;
  /** 既定かつ唯一の保持形式は横書き（左P・右N）。§11.1 */
  orientation: 'horizontal';
  rungs: Rung[];
}

/** 構造エラー1件。 */
export interface DocumentError {
  /** エラー箇所（`rungs[0].cells[2]` など）。 */
  path: string;
  message: string;
}

const DEVICE_PATTERNS: Readonly<Record<CellKind, RegExp>> = {
  'pb-a': /^PB[1-4]$/,
  'pb-b': /^PB[1-4]$/,
  'cr-a': /^CR[1-4]$/,
  'cr-b': /^CR[1-4]$/,
  't-a': /^T[12]$/,
  't-b': /^T[12]$/,
  coil: /^(CR[1-4]|T[12])$/,
  lamp: /^PL[1-4]$/,
  buzzer: /^BZ$/,
};

/** 負荷（コイル・ランプ・ブザー）の要素か。 */
export function isLoadCell(cell: SchematicCell): boolean {
  return cell.kind === 'coil' || cell.kind === 'lamp' || cell.kind === 'buzzer';
}

/** 接点の要素か。 */
export function isContactCell(cell: SchematicCell): boolean {
  return !isLoadCell(cell);
}

/** 段の節点数（要素数＋1）。節点0が `from`、節点 `cells.length` が `to`。 */
export function rungNodeCount(rung: Rung): number {
  return rung.cells.length + 1;
}

/** 押ボタンのa接点。 */
export function pbA(id: string, device: string): SchematicCell {
  return { kind: 'pb-a', id, device };
}
/** 押ボタンのb接点。 */
export function pbB(id: string, device: string): SchematicCell {
  return { kind: 'pb-b', id, device };
}
/** リレーのa接点。 */
export function crA(id: string, device: string): SchematicCell {
  return { kind: 'cr-a', id, device };
}
/** リレーのb接点。 */
export function crB(id: string, device: string): SchematicCell {
  return { kind: 'cr-b', id, device };
}
/** タイマの限時動作瞬時復帰a接点。§3.4 */
export function tA(id: string, device: string): SchematicCell {
  return { kind: 't-a', id, device };
}
/** タイマの限時動作瞬時復帰b接点。§3.4 */
export function tB(id: string, device: string): SchematicCell {
  return { kind: 't-b', id, device };
}
/** コイル（リレー／タイマ）。タイマは `presetMs` を持つ。 */
export function coil(id: string, device: string, presetMs?: number): SchematicCell {
  return presetMs === undefined
    ? { kind: 'coil', id, device }
    : { kind: 'coil', id, device, presetMs };
}
/** 表示灯。 */
export function lamp(id: string, device: string): SchematicCell {
  return { kind: 'lamp', id, device };
}
/** ブザー。 */
export function buzzer(id: string): SchematicCell {
  return { kind: 'buzzer', id, device: 'BZ' };
}

/** 文書を作る（`formatVersion` と `orientation` を埋める）。 */
export function createDocument(id: string, title: string, rungs: Rung[]): SchematicDocument {
  return { formatVersion: SCHEMATIC_FORMAT_VERSION, id, title, orientation: 'horizontal', rungs };
}

/** 段を作る。 */
export function rung(id: string, from: RungEnd, to: RungEnd, cells: SchematicCell[]): Rung {
  return { id, from, to, cells };
}

/** 左母線（P）。§11.1 */
export const BUS_P: RungEnd = { bus: 'P' };
/** 右母線（N）。§11.1 */
export const BUS_N: RungEnd = { bus: 'N' };

/** 他の段の節点を指す端点（分岐点）。 */
export function at(rungId: string, node: number): RungEnd {
  return { rung: rungId, node };
}

function checkEnd(
  doc: SchematicDocument,
  owner: Rung,
  end: RungEnd,
  path: string,
  errors: DocumentError[],
): void {
  if ('bus' in end) return;
  if (end.rung === owner.id) {
    errors.push({ path, message: `段が自分自身を参照しています: ${owner.id}` });
    return;
  }
  const target = doc.rungs.find((r) => r.id === end.rung);
  if (target === undefined) {
    errors.push({ path, message: `参照先の段がありません: ${end.rung}` });
    return;
  }
  if (!Number.isInteger(end.node) || end.node < 0 || end.node >= rungNodeCount(target)) {
    errors.push({
      path,
      message: `参照先の節点番号が範囲外です: ${end.rung}#${end.node}（0〜${rungNodeCount(target) - 1}）`,
    });
  }
}

/**
 * 文書の構造エラーを列挙する（zodは使わない。§11.1 の範囲で十分なため）。
 * 空配列なら妥当。
 */
export function validateDocument(doc: SchematicDocument): DocumentError[] {
  const errors: DocumentError[] = [];
  if (doc.formatVersion !== SCHEMATIC_FORMAT_VERSION) {
    errors.push({
      path: 'formatVersion',
      message: `未知の文書バージョンです: ${doc.formatVersion}（対応は ${SCHEMATIC_FORMAT_VERSION}）`,
    });
  }
  if (doc.orientation !== 'horizontal') {
    errors.push({ path: 'orientation', message: '文書モデルは常に横書き（左P・右N）で保持します' });
  }
  if (doc.rungs.length === 0) {
    errors.push({ path: 'rungs', message: '段が1つもありません' });
  }

  const rungIds = new Set<string>();
  const cellIds = new Set<string>();
  doc.rungs.forEach((r, ri) => {
    const rungPath = `rungs[${ri}]`;
    if (rungIds.has(r.id))
      errors.push({ path: rungPath, message: `段IDが重複しています: ${r.id}` });
    rungIds.add(r.id);
    if (r.cells.length === 0)
      errors.push({ path: rungPath, message: `段に要素がありません: ${r.id}` });
    checkEnd(doc, r, r.from, `${rungPath}.from`, errors);
    checkEnd(doc, r, r.to, `${rungPath}.to`, errors);

    let loadCount = 0;
    r.cells.forEach((cell, ci) => {
      const cellPath = `${rungPath}.cells[${ci}]`;
      if (cellIds.has(cell.id)) {
        errors.push({ path: cellPath, message: `要素IDが重複しています: ${cell.id}` });
      }
      cellIds.add(cell.id);
      const pattern = DEVICE_PATTERNS[cell.kind];
      if (pattern === undefined) {
        errors.push({ path: cellPath, message: `未知の要素種別です: ${String(cell.kind)}` });
      } else if (!pattern.test(cell.device)) {
        errors.push({
          path: cellPath,
          message: `${cell.kind} に使えない機器名です: ${cell.device}`,
        });
      }
      if (cell.kind === 'coil' && cell.device.startsWith('T')) {
        if (cell.presetMs === undefined || cell.presetMs <= 0) {
          errors.push({
            path: cellPath,
            message: `タイマコイルには presetMs が必要です: ${cell.device}`,
          });
        }
      } else if (cell.presetMs !== undefined) {
        errors.push({
          path: cellPath,
          message: `presetMs を持てるのはタイマコイルだけです: ${cell.id}`,
        });
      }
      if (isLoadCell(cell)) loadCount += 1;
    });

    if (loadCount > 1) {
      errors.push({ path: rungPath, message: `1つの段に負荷は1つだけです: ${r.id}` });
    }
    const endsAtN = 'bus' in r.to && r.to.bus === 'N';
    const last = r.cells[r.cells.length - 1];
    if (endsAtN && (last === undefined || !isLoadCell(last))) {
      errors.push({
        path: rungPath,
        message: `右母線(N)に至る段は負荷（コイル／ランプ／ブザー）で終わる必要があります: ${r.id}`,
      });
    }
    if (!endsAtN && loadCount > 0) {
      errors.push({
        path: rungPath,
        message: `分岐段（右母線に至らない段）に負荷は置けません: ${r.id}`,
      });
    }
  });

  return errors;
}

/** 文書に現れる機器名を初出順に返す。 */
export function documentDevices(doc: SchematicDocument): string[] {
  const out: string[] = [];
  for (const r of doc.rungs) {
    for (const cell of r.cells) {
      if (!out.includes(cell.device)) out.push(cell.device);
    }
  }
  return out;
}
```

- [ ] `packages/schematic-core/src/index.ts` を次の内容に置き換える（`PACKAGE_NAME` は役目を終えたので消し、`test/scaffold.test.ts` も削除する）。

```ts
export {
  at,
  BUS_N,
  BUS_P,
  buzzer,
  coil,
  crA,
  crB,
  createDocument,
  documentDevices,
  isContactCell,
  isLoadCell,
  lamp,
  pbA,
  pbB,
  rung,
  rungNodeCount,
  SCHEMATIC_FORMAT_VERSION,
  tA,
  tB,
  validateDocument,
  type CellKind,
  type ContactCellKind,
  type DocumentError,
  type LoadCellKind,
  type Rung,
  type RungEnd,
  type SchematicCell,
  type SchematicDocument,
} from './document.js';
```

```powershell
Remove-Item packages\schematic-core\test\scaffold.test.ts
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/schematic-core test -- document.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] コミットする。

```powershell
git add packages/schematic-core
git commit -m @'
feat(schematic-core): add ladder-style schematic document model

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 13: src/assign.ts — 回路図 → 物理割当

**Files:**
- Create: `packages/schematic-core/src/assign.ts`
- Test: `packages/schematic-core/test/assign.test.ts`
- Modify: `packages/schematic-core/src/index.ts`

仕様 §11.3 の変換規則をそのまま実装する。

| 規則 | 実装 |
|---|---|
| CR接点／T接点 | 文書の出現順（段の順 → 段内の順）に組1〜組4を1つずつ割り当てる。k組目は a接点なら `(CRn.{8+k}, CRn.{4+k})`、b接点なら `(CRn.{8+k}, CRn.{0+k})`。同じ組を2つの接点に割り当てない。5個目が現れたら変換エラー |
| コイル | `CRn.14`（P側）と `CRn.13`（N側） |
| PB | a接点 → `TB_PB.nc` と `TB_PB.na`、b接点 → `TB_PB.nc` と `TB_PB.nb` |
| PL | `TB_PL.n+` と `TB_PL.n-` |
| BZ | `BZ.+` と `BZ.-` |
| P/N | 母線に集まった端子ごとに `P.1`〜`P.6` / `N.1`〜`N.6` から**若番で空きのあるもの**を取る。チェック用の黄色配線が既に1本使っている `P.6` / `N.6` は残り1本として数える（§6.3） |
| 母線以外の節点 | その節点に集まった端子を出現順に**鎖状に**結ぶ（渡り配線。調査資料 §4.5）。中間の端子はちょうど2本になる |
| 上書き | `physicalOverride[要素ID] = [左, 右]` があれば既定規則より優先する（§7.2） |
| エラー | 接点組の不足、端子本数超過、供給端子の枯渇を理由付きで返す |

役割割当は `options.roles` で明示できる。省略した場合は回路図に現れる `CRn`／`Tn` を正準順（CR1→CR4→T1→T2）に `S1`〜`S4` へ、`S5` は常に `CHK` に割り当てる。5個以上現れたらエラー（盤のソケットは4個）。

- [ ] 失敗するテストを書く。`packages/schematic-core/test/assign.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TASK2_SOCKET_ROLES } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  assignToBoard,
  at,
  BUS_N,
  BUS_P,
  buzzer,
  coil,
  crA,
  createDocument,
  deriveSocketRoles,
  lamp,
  pbA,
  requiredRoles,
  rung,
  tA,
  type AssignResult,
} from '../src/index.js';
import { flickerDoc, onDelayDoc, selfHoldDoc } from './helpers/docs.js';

function t(id: string): TerminalId {
  return id as TerminalId;
}

function assigned(result: AssignResult): Extract<AssignResult, { ok: true }> {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' / '));
  return result;
}

describe('assign: 回路図 → 物理割当（§11.3）', () => {
  it('自己保持回路の割当', () => {
    const result = assigned(assignToBoard(selfHoldDoc()));
    expect(result.roles.S1).toBe('CR1');
    expect(result.roles.S5).toBe('CHK');
    expect(result.parts).toEqual([{ socket: 'S1', role: 'CR1', kind: 'relay-my4n' }]);
    expect(result.cells.map((c) => `${c.cellId}:${c.left}-${c.right}`)).toEqual([
      'c1:TB_PB.2c-TB_PB.2b',
      'c2:TB_PB.1c-TB_PB.1a',
      'c3:CR1.14-CR1.13',
      'c4:CR1.9-CR1.5',
      'c5:CR1.10-CR1.6',
      'c6:TB_PL.1+-TB_PL.1-',
    ]);
    expect(result.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'P.1-TB_PB.2c',
      'P.1-CR1.10',
      'TB_PB.2b-TB_PB.1c',
      'TB_PB.1c-CR1.9',
      'TB_PB.1a-CR1.14',
      'CR1.14-CR1.5',
      'N.1-CR1.13',
      'N.1-TB_PL.1-',
      'CR1.6-TB_PL.1+',
    ]);
    expect(result.wires.every((w) => w.color === '青')).toBe(true);
    expect(result.wires.map((w) => w.id)).toEqual([
      'sw-001',
      'sw-002',
      'sw-003',
      'sw-004',
      'sw-005',
      'sw-006',
      'sw-007',
      'sw-008',
      'sw-009',
    ]);
  });

  it('接点は出現順に組1〜組4へ1つずつ割り当てる（§11.3）', () => {
    const doc = createDocument('x', '4接点', [
      rung('r1', BUS_P, BUS_N, [pbA('c0', 'PB1'), coil('c1', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c2', 'CR1'), lamp('c3', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL2')]),
      rung('r4', BUS_P, BUS_N, [crA('c6', 'CR1'), lamp('c7', 'PL3')]),
      rung('r5', BUS_P, BUS_N, [crA('c8', 'CR1'), lamp('c9', 'PL4')]),
    ]);
    const result = assigned(assignToBoard(doc));
    const contacts = result.cells.filter((c) => c.device === 'CR1' && c.group > 0);
    expect(contacts.map((c) => `${c.group}:${c.left}-${c.right}`)).toEqual([
      '1:CR1.9-CR1.5',
      '2:CR1.10-CR1.6',
      '3:CR1.11-CR1.7',
      '4:CR1.12-CR1.8',
    ]);
  });

  it('5個目の接点はエラー（§11.3）', () => {
    const doc = createDocument('x', '5接点', [
      rung('r1', BUS_P, BUS_N, [pbA('c0', 'PB1'), coil('c1', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c2', 'CR1'), lamp('c3', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL2')]),
      rung('r4', BUS_P, BUS_N, [crA('c6', 'CR1'), lamp('c7', 'PL3')]),
      rung('r5', BUS_P, BUS_N, [crA('c8', 'CR1'), lamp('c9', 'PL4')]),
      rung('r6', BUS_P, BUS_N, [crA('c10', 'CR1'), coil('c11', 'CR2')]),
    ]);
    const result = assignToBoard(doc);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]).toEqual({
      path: 'c10',
      message: 'CR1 の接点が5個目です（1つの部品の接点は4組までです）',
    });
  });

  it('b接点は COM と NC、a接点は COM と NO（§11.3 / §6.2）', () => {
    const result = assigned(assignToBoard(flickerDoc()));
    const byId = new Map(result.cells.map((c) => [c.cellId, c]));
    expect(byId.get('c2')).toEqual({
      cellId: 'c2',
      device: 'CR1',
      group: 1,
      left: 'CR1.9',
      right: 'CR1.1',
    });
    expect(byId.get('c7')).toEqual({
      cellId: 'c7',
      device: 'CR1',
      group: 2,
      left: 'CR1.10',
      right: 'CR1.6',
    });
    expect(byId.get('c5')).toEqual({
      cellId: 'c5',
      device: 'T1',
      group: 1,
      left: 'T1.9',
      right: 'T1.5',
    });
    expect(byId.get('c3')).toEqual({
      cellId: 'c3',
      device: 'T1',
      group: 0,
      left: 'T1.14',
      right: 'T1.13',
    });
  });

  it('役割割当は回路図から決まり、明示指定もできる（§6.1）', () => {
    expect(requiredRoles(flickerDoc())).toEqual(['CR1', 'CR2', 'T1', 'T2']);
    expect(deriveSocketRoles(flickerDoc())).toEqual(TASK2_SOCKET_ROLES);
    expect(deriveSocketRoles(onDelayDoc())).toEqual({
      S1: 'T1',
      S2: 'CR1',
      S3: 'CR2',
      S4: 'CR3',
      S5: 'CHK',
    });
    const explicit = assigned(assignToBoard(onDelayDoc(), { roles: TASK2_SOCKET_ROLES }));
    expect(explicit.parts).toEqual([
      { socket: 'S3', role: 'T1', kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 },
    ]);
  });

  it('割当が足りない役割指定はエラー', () => {
    const result = assignToBoard(flickerDoc(), {
      roles: { S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S5: 'CHK' },
    });
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.map((e) => e.message)).toEqual([
      '役割が盤に割り当てられていません: T1',
      '役割が盤に割り当てられていません: T2',
    ]);
  });

  it('ソケットに載る機器が5個以上ならエラー', () => {
    const doc = createDocument('x', '5機器', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c3', 'CR1'), coil('c4', 'CR2')]),
      rung('r3', BUS_P, BUS_N, [crA('c5', 'CR2'), coil('c6', 'CR3')]),
      rung('r4', BUS_P, BUS_N, [crA('c7', 'CR3'), coil('c8', 'CR4')]),
      rung('r5', BUS_P, BUS_N, [crA('c9', 'CR4'), coil('c10', 'T1', 1000)]),
    ]);
    const result = assignToBoard(doc);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]?.message).toBe(
      'ソケットに載る機器が5個以上あります（盤のソケットは4個）',
    );
  });

  it('physicalOverride が既定規則より優先される（§7.2 / §11.3）', () => {
    const result = assigned(
      assignToBoard(selfHoldDoc(), {
        physicalOverride: { c5: [t('CR1.12'), t('CR1.8')] },
        color: '白',
      }),
    );
    const overridden = result.cells.find((c) => c.cellId === 'c5');
    expect(overridden?.left).toBe('CR1.12');
    expect(overridden?.right).toBe('CR1.8');
    expect(result.wires.every((w) => w.color === '白')).toBe(true);

    const broken = assignToBoard(selfHoldDoc(), { physicalOverride: { c5: [t('CR1.12')] } });
    if (broken.ok) throw new Error('unreachable');
    expect(broken.errors[0]?.message).toBe('physicalOverride は端子2つを指定します: c5');
  });

  it('構造エラーのある文書は割当しない', () => {
    const doc = createDocument('x', '負荷なし', [rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1')])]);
    const result = assignToBoard(doc);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]?.path).toBe('rungs[0]');
  });

  it('コイルの無いタイマは既定の設定時間で装着する', () => {
    const doc = createDocument('x', 'コイルなし', [
      rung('r1', BUS_P, BUS_N, [tA('c1', 'T1'), lamp('c2', 'PL1')]),
    ]);
    const result = assigned(assignToBoard(doc));
    expect(result.parts).toEqual([
      { socket: 'S1', role: 'T1', kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 },
    ]);
  });

  it('母線の供給端子（P.1〜P.6 × 2本）を超えるとエラー（§11.3）', () => {
    const doc = createDocument('x', '母線集中', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [pbA('c3', 'PB2'), coil('c4', 'CR2')]),
      rung('r3', BUS_P, BUS_N, [pbA('c5', 'PB3'), coil('c6', 'CR3')]),
      rung('r4', BUS_P, BUS_N, [pbA('c7', 'PB4'), coil('c8', 'CR4')]),
      rung('r5', BUS_P, BUS_N, [crA('c9', 'CR1'), lamp('c10', 'PL1')]),
      rung('r6', BUS_P, BUS_N, [crA('c11', 'CR2'), lamp('c12', 'PL2')]),
      rung('r7', BUS_P, BUS_N, [crA('c13', 'CR3'), lamp('c14', 'PL3')]),
      rung('r8', BUS_P, BUS_N, [crA('c15', 'CR4'), lamp('c16', 'PL4')]),
      rung('r9', BUS_P, BUS_N, [crA('c17', 'CR1'), buzzer('c18')]),
      rung('r10', BUS_P, at('r1', 1), [crA('c19', 'CR1')]),
      rung('r11', BUS_P, at('r2', 1), [crA('c20', 'CR2')]),
      rung('r12', BUS_P, at('r3', 1), [crA('c21', 'CR3')]),
      rung('r13', BUS_P, at('r4', 1), [crA('c22', 'CR4')]),
    ]);
    const result = assignToBoard(doc);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]?.message).toBe('P側の供給端子が足りません（CR3.10）');
    expect(result.errors).toHaveLength(2);
  });

  it('チェック用の黄色配線がある端子を渡り配線に使うと上限超過になる（§6.3 / §6.6）', () => {
    // `TB_PB.4c` には既に黄色配線が1本つながっている。中継点として使うと3本目になる。
    const doc = createDocument('x', '端子超過', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), pbA('c2', 'PB4'), coil('c3', 'CR1')]),
      rung('r2', BUS_P, at('r1', 1), [crA('c4', 'CR1')]),
    ]);
    const result = assignToBoard(doc);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]).toEqual({
      path: 'TB_PB.4c',
      message: '1端子に3本つながります（上限は2本）: TB_PB.4c',
    });
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/schematic-core test -- assign.test.ts
```

期待出力の冒頭: `does not provide an export named 'assignToBoard'`。

- [ ] `packages/schematic-core/src/assign.ts` を書く。

```ts
import {
  CHECK_SOCKET_ROLE,
  DEFAULT_TIMER_PRESET_MS,
  DEFAULT_TIMER_RANGE,
  JIPM_BOARD,
  resolveEndpoint,
  SOCKET_IDS,
  terminalIdFor,
  toNetlistTerminal,
  type MountableKind,
  type SocketId,
  type SocketRole,
  type SocketRoles,
} from '@ojt/board-model';
import {
  MAX_WIRES_PER_TERMINAL,
  terminalId,
  type TerminalId,
  type WireColor,
} from '@ojt/circuit-sim';
import {
  isLoadCell,
  rungNodeCount,
  validateDocument,
  type Rung,
  type RungEnd,
  type SchematicCell,
  type SchematicDocument,
} from './document.js';

/**
 * 回路図 → 物理割当（設計仕様 §11.3）。
 * 各 `CRn`／`Tn` の接点を出現順に組1〜組4へ1つずつ割り当て、母線は `P.1`〜/`N.1`〜 に若番から割り当てる。
 */

/** 生成すべき電線1本。 */
export interface WireSpec {
  id: string;
  from: TerminalId;
  to: TerminalId;
  color: WireColor;
}

/** 装着すべき部品1個。 */
export interface PartAssignment {
  socket: SocketId;
  role: SocketRole;
  kind: MountableKind;
  /** タイマのときの設定時間[ms]。 */
  presetMs?: number;
  /** タイマのときのレンジ上限[ms]。 */
  rangeMaxMs?: number;
}

/** 回路図要素 → 物理端子の対応（1要素につき左右2端子）。 */
export interface CellAssignment {
  cellId: string;
  device: string;
  /** 接点のときの組番号（1〜4）。接点以外は0。§11.3 */
  group: number;
  /** P側（左）の端子。 */
  left: TerminalId;
  /** N側（右）の端子。 */
  right: TerminalId;
}

/** 割当エラー1件。 */
export interface AssignError {
  path: string;
  message: string;
}

/** 割当オプション。 */
export interface AssignOptions {
  /** ソケットの役割割当。省略すると回路図に現れる機器から決める。 */
  roles?: SocketRoles;
  /** 生成する電線の色。既定は青（モードB・D）。§11.3 */
  color?: WireColor;
  /** 回路図要素IDごとの物理端子の上書き（`[左, 右]`）。§7.2 / §11.3 */
  physicalOverride?: Readonly<Record<string, readonly TerminalId[]>>;
}

/** 割当の結果。 */
export type AssignResult =
  | {
      ok: true;
      roles: SocketRoles;
      parts: PartAssignment[];
      cells: CellAssignment[];
      wires: WireSpec[];
    }
  | { ok: false; errors: AssignError[] };

/** ソケットに載せられる役割の正準順。 */
const ASSIGNABLE_ROLES: readonly SocketRole[] = ['CR1', 'CR2', 'CR3', 'CR4', 'T1', 'T2'];

/** 母線の節点キー。 */
const BUS_P_KEY = 'BUS:P';
const BUS_N_KEY = 'BUS:N';

function isSocketDevice(device: string): device is SocketRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(device);
}

/** 回路図に現れるソケット機器を正準順に返す。 */
export function requiredRoles(doc: SchematicDocument): SocketRole[] {
  const used = new Set<string>();
  for (const r of doc.rungs) {
    for (const cell of r.cells) {
      if (isSocketDevice(cell.device)) used.add(cell.device);
    }
  }
  return ASSIGNABLE_ROLES.filter((role) => used.has(role));
}

/** 回路図に現れる機器から役割割当を決める。S5 は常にチェック用。§6.1 */
export function deriveSocketRoles(doc: SchematicDocument): SocketRoles | undefined {
  const needed = requiredRoles(doc);
  if (needed.length > 4) return undefined;
  const filler = ASSIGNABLE_ROLES.filter((role) => !needed.includes(role));
  const ordered = [...needed, ...filler].slice(0, 4);
  const roles: Partial<Record<SocketId, SocketRole>> = {};
  SOCKET_IDS.slice(0, 4).forEach((socket, index) => {
    roles[socket] = ordered[index];
  });
  roles.S5 = CHECK_SOCKET_ROLE;
  return roles as SocketRoles;
}

function terminalPair(
  cell: SchematicCell,
  group: number,
  override: Readonly<Record<string, readonly TerminalId[]>>,
): { left: TerminalId; right: TerminalId } | AssignError {
  const forced = override[cell.id];
  if (forced !== undefined) {
    const left = forced[0];
    const right = forced[1];
    if (left === undefined || right === undefined) {
      return { path: cell.id, message: `physicalOverride は端子2つを指定します: ${cell.id}` };
    }
    return { left, right };
  }
  const n = cell.device.slice(-1);
  switch (cell.kind) {
    case 'pb-a':
      return { left: terminalId('TB_PB', `${n}c`), right: terminalId('TB_PB', `${n}a`) };
    case 'pb-b':
      return { left: terminalId('TB_PB', `${n}c`), right: terminalId('TB_PB', `${n}b`) };
    case 'cr-a':
    case 't-a':
      return {
        left: terminalIdFor(cell.device as SocketRole, 8 + group),
        right: terminalIdFor(cell.device as SocketRole, 4 + group),
      };
    case 'cr-b':
    case 't-b':
      return {
        left: terminalIdFor(cell.device as SocketRole, 8 + group),
        right: terminalIdFor(cell.device as SocketRole, group),
      };
    case 'coil':
      return {
        left: terminalIdFor(cell.device as SocketRole, 14),
        right: terminalIdFor(cell.device as SocketRole, 13),
      };
    case 'lamp':
      return { left: terminalId('TB_PL', `${n}+`), right: terminalId('TB_PL', `${n}-`) };
    case 'buzzer':
      return { left: terminalId('BZ', '+'), right: terminalId('BZ', '-') };
  }
}

function resolveNodeKey(
  doc: SchematicDocument,
  rung: Rung,
  node: number,
  depth = 0,
): string | AssignError {
  if (depth > 32) {
    return { path: rung.id, message: `段の参照が循環しています: ${rung.id}` };
  }
  if (node === 0) return resolveEnd(doc, rung.from, rung, depth + 1);
  if (node === rungNodeCount(rung) - 1) return resolveEnd(doc, rung.to, rung, depth + 1);
  return `${rung.id}#${node}`;
}

function resolveEnd(
  doc: SchematicDocument,
  end: RungEnd,
  owner: Rung,
  depth: number,
): string | AssignError {
  if ('bus' in end) return end.bus === 'P' ? BUS_P_KEY : BUS_N_KEY;
  const target = doc.rungs.find((r) => r.id === end.rung);
  if (target === undefined) {
    return { path: owner.id, message: `参照先の段がありません: ${end.rung}` };
  }
  return resolveNodeKey(doc, target, end.node, depth);
}

function isAssignError(value: unknown): value is AssignError {
  return typeof value === 'object' && value !== null && 'message' in value && 'path' in value;
}

/** 既設の黄色固定配線で既に使われている端子の本数。§6.3 */
function preUsedCounts(roles: SocketRoles): Map<string, number> {
  const used = new Map<string, number>();
  for (const fw of JIPM_BOARD.fixedWires) {
    for (const endpoint of [fw.from, fw.to]) {
      const id = toNetlistTerminal(roles, resolveEndpoint(endpoint));
      used.set(id, (used.get(id) ?? 0) + 1);
    }
  }
  return used;
}

/**
 * 回路図を物理端子へ割り当て、生成すべき電線と装着すべき部品を返す。§11.3
 * 同じ組を2つの接点に割り当てず、5個目の接点が現れたらエラーにする。
 */
export function assignToBoard(doc: SchematicDocument, options: AssignOptions = {}): AssignResult {
  const structural = validateDocument(doc);
  if (structural.length > 0) return { ok: false, errors: structural };

  const roles = options.roles ?? deriveSocketRoles(doc);
  if (roles === undefined) {
    return {
      ok: false,
      errors: [
        { path: 'rungs', message: 'ソケットに載る機器が5個以上あります（盤のソケットは4個）' },
      ],
    };
  }
  const needed = requiredRoles(doc);
  const missing = needed.filter((role) => !SOCKET_IDS.some((socket) => roles[socket] === role));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: missing.map((role) => ({
        path: 'roles',
        message: `役割が盤に割り当てられていません: ${role}`,
      })),
    };
  }

  const color = options.color ?? '青';
  const override = options.physicalOverride ?? {};
  const errors: AssignError[] = [];

  // 1. 接点を出現順に組1〜組4へ割り当てる
  const groupUsed = new Map<string, number>();
  const cells: CellAssignment[] = [];
  const cellByNode = new Map<string, TerminalId[]>();
  const presetOf = new Map<string, number>();

  const attach = (key: string, id: TerminalId): void => {
    const list = cellByNode.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    cellByNode.set(key, list);
  };

  for (const r of doc.rungs) {
    r.cells.forEach((cell, index) => {
      let group = 0;
      if (!isLoadCell(cell) && cell.kind !== 'pb-a' && cell.kind !== 'pb-b') {
        const used = groupUsed.get(cell.device) ?? 0;
        if (used >= 4) {
          errors.push({
            path: cell.id,
            message: `${cell.device} の接点が5個目です（1つの部品の接点は4組までです）`,
          });
          return;
        }
        group = used + 1;
        groupUsed.set(cell.device, group);
      }
      const pair = terminalPair(cell, group, override);
      if (isAssignError(pair)) {
        errors.push(pair);
        return;
      }
      if (cell.kind === 'coil' && cell.presetMs !== undefined) {
        presetOf.set(cell.device, cell.presetMs);
      }
      cells.push({
        cellId: cell.id,
        device: cell.device,
        group,
        left: pair.left,
        right: pair.right,
      });

      const leftKey = resolveNodeKey(doc, r, index);
      const rightKey = resolveNodeKey(doc, r, index + 1);
      if (isAssignError(leftKey) || isAssignError(rightKey)) {
        if (isAssignError(leftKey)) errors.push(leftKey);
        if (isAssignError(rightKey)) errors.push(rightKey);
        return;
      }
      attach(leftKey, pair.left);
      attach(rightKey, pair.right);
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  // 2. 節点ごとに電線を作る。母線は P.1〜/N.1〜 に若番から割り当てる（1端子2本まで）。§11.3
  const used = preUsedCounts(roles);
  const bump = (id: TerminalId): void => {
    used.set(id, (used.get(id) ?? 0) + 1);
  };
  const countOf = (id: TerminalId): number => used.get(id) ?? 0;
  const wires: WireSpec[] = [];
  let seq = 1;
  const emit = (from: TerminalId, to: TerminalId): void => {
    wires.push({ id: `sw-${String(seq).padStart(3, '0')}`, from, to, color });
    seq += 1;
    bump(from);
    bump(to);
  };
  const takeSupply = (rail: 'P' | 'N'): TerminalId | undefined => {
    for (let i = 1; i <= JIPM_BOARD.supplyTerminalCount; i += 1) {
      const id = terminalId(rail, String(i));
      if (countOf(id) < MAX_WIRES_PER_TERMINAL) return id;
    }
    return undefined;
  };

  for (const [key, terminals] of cellByNode) {
    if (key === BUS_P_KEY || key === BUS_N_KEY) {
      const rail = key === BUS_P_KEY ? 'P' : 'N';
      for (const id of terminals) {
        const supply = takeSupply(rail);
        if (supply === undefined) {
          errors.push({ path: key, message: `${rail}側の供給端子が足りません（${id}）` });
          continue;
        }
        emit(supply, id);
      }
      continue;
    }
    for (let i = 1; i < terminals.length; i += 1) {
      const a = terminals[i - 1];
      const b = terminals[i];
      if (a === undefined || b === undefined) continue;
      emit(a, b);
    }
  }

  // 3. 1端子2本の上限を確認する。§6.6
  for (const [id, count] of used) {
    if (count > MAX_WIRES_PER_TERMINAL) {
      errors.push({
        path: id,
        message: `1端子に${count}本つながります（上限は${MAX_WIRES_PER_TERMINAL}本）: ${id}`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // 4. 装着すべき部品
  const parts: PartAssignment[] = [];
  for (const socket of SOCKET_IDS) {
    const role = roles[socket];
    if (!needed.includes(role)) continue;
    if (role.startsWith('T')) {
      parts.push({
        socket,
        role,
        kind: 'timer-h3y4',
        presetMs: presetOf.get(role) ?? DEFAULT_TIMER_PRESET_MS,
        rangeMaxMs: DEFAULT_TIMER_RANGE.maxMs,
      });
    } else {
      parts.push({ socket, role, kind: 'relay-my4n' });
    }
  }

  return { ok: true, roles, parts, cells, wires };
}
```

- [ ] `packages/schematic-core/src/index.ts` の末尾に次を追記する。

```ts
export {
  assignToBoard,
  deriveSocketRoles,
  requiredRoles,
  type AssignError,
  type AssignOptions,
  type AssignResult,
  type CellAssignment,
  type PartAssignment,
  type WireSpec,
} from './assign.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/schematic-core test -- assign.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

- [ ] コミットする。

```powershell
git add packages/schematic-core
git commit -m @'
feat(schematic-core): assign schematic elements to board terminals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 14: src/to-session.ts — 割当結果 → 盤セッション

**Files:**
- Create: `packages/schematic-core/src/to-session.ts`
- Test: `packages/schematic-core/test/to-session.test.ts`
- Modify: `packages/schematic-core/src/index.ts`

割当結果を board-model の `plug()` / `addWire()` に通して盤セッションを作る。**配線を自前で押し込まず必ず `addWire()` を通す**ことで、1端子2本の上限・線色パレット・配線不可端子の規則が盤モデル側の実装1か所で効く。違反は割当側のエラー（`AssignError`）として返す。

このタスクのテストが Plan 1B の結合点で、`回路図 → 割当 → セッション → ネットリスト → Simulation` を実際に走らせて、自己保持・インターロック・オンディレー・フリッカの4回路が期待どおり動くことを確かめる（§14.1 #5・#6・#8・#11 の回路図版）。

- [ ] 失敗するテストを書く。`packages/schematic-core/test/to-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { JIPM_BOARD, toNetlist, type BoardSession } from '@ojt/board-model';
import { Simulation, type TerminalId } from '@ojt/circuit-sim';
import {
  BUS_N,
  BUS_P,
  buzzer,
  createDocument,
  pbA,
  rung,
  toSession,
  type SchematicDocument,
  type ToSessionOptions,
} from '../src/index.js';
import { flickerDoc, interlockDoc, onDelayDoc, selfHoldDoc } from './helpers/docs.js';

const board = JIPM_BOARD;

function build(doc: SchematicDocument, options?: ToSessionOptions): BoardSession {
  const result = toSession(doc, board, options);
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join(' / '));
  return result.session;
}

function powered(session: BoardSession): Simulation {
  const sim = new Simulation(toNetlist(session, board));
  sim.setBreaker(true);
  sim.setSwitch(true);
  return sim;
}

describe('to-session: 回路図 → 盤セッション → ネットリスト → シミュレーション', () => {
  it('割当どおりに装着と配線が入る（§11.3）', () => {
    const session = build(selfHoldDoc());
    expect(session.mounted.S1).toEqual({ kind: 'relay-my4n' });
    // 既設の黄色配線3本 ＋ 生成した9本
    expect(session.wires).toHaveLength(12);
    expect(session.wires.filter((w) => !w.locked)).toHaveLength(9);
    expect(session.allowedColors).toEqual(['青']);
  });

  it('自己保持回路が動く（§14.1 #5）', () => {
    const sim = powered(build(selfHoldDoc()));
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.press('PB1');
    sim.run(200);
    sim.release('PB1');
    sim.run(500);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB2');
    sim.run(600);
    sim.release('PB2');
    sim.run(800);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('インターロック回路が動く（先行優先。§14.1 #6）', () => {
    const sim = powered(build(interlockDoc()));
    sim.run(100);
    sim.press('PB1');
    sim.run(200);
    sim.release('PB1');
    sim.run(400);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    expect(sim.state().lamps['PL2']?.level).toBe('off');
    sim.press('PB2');
    sim.run(600);
    sim.release('PB2');
    sim.run(800);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    expect(sim.state().lamps['PL2']?.level).toBe('off');
  });

  it('オンディレー回路が3秒で点灯する（§14.1 #8）', () => {
    const sim = powered(build(onDelayDoc()));
    sim.press('PB1');
    sim.run(4000);
    const on = sim.log.transitions('PL1').find((e) => e.value === true)?.tMs;
    expect(on).toBeDefined();
    expect(Math.abs((on ?? 0) - 3000)).toBeLessThanOrEqual(20);
  });

  it('フリッカ回路が周期的に点滅し、チャタリングしない（§14.1 #11 / §5.5）', () => {
    const session = build(flickerDoc());
    expect(session.mounted.S3).toEqual({
      kind: 'timer-h3y4',
      presetMs: 500,
      rangeMaxMs: 10_000,
    });
    const sim = powered(session);
    sim.press('PB1');
    sim.run(4000);
    const edges = sim.log.transitions('PL1').filter((e) => e.tMs > 0);
    expect(edges.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < edges.length; i += 1) {
      const gap = (edges[i]?.tMs ?? 0) - (edges[i - 1]?.tMs ?? 0);
      expect(gap).toBeGreaterThan(400);
      expect(gap).toBeLessThan(700);
    }
    expect(sim.events.chatters()).toHaveLength(0);
  });

  it('ブザーを使う回路図は BZ を自動で盤に載せる（§5.3.4）', () => {
    const doc = createDocument('b-bz', 'ブザー', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), buzzer('c2')]),
    ]);
    const session = build(doc);
    expect(session.extraParts).toEqual(['BZ']);
    const sim = powered(session);
    sim.press('PB1');
    sim.run(200);
    expect(sim.state().lamps['BZ']?.level).toBe('lit');
  });

  it('割当に失敗した回路図はエラーを返す', () => {
    const doc = createDocument('x', '負荷なし', [rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1')])]);
    const result = toSession(doc, board);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors).toHaveLength(1);
  });

  it('在庫が足りなければ装着エラーになる（§7.1）', () => {
    const result = toSession(selfHoldDoc(), board, {
      inventory: [{ kind: 'relay-my4n', count: 0 }],
    });
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]?.path).toBe('CR1');
  });

  it('配線できない端子を physicalOverride で指すと配線エラーになる（§6.4）', () => {
    const result = toSession(selfHoldDoc(), board, {
      physicalOverride: { c1: ['PB2.c' as TerminalId, 'PB2.b' as TerminalId] },
    });
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]?.message).toContain('この端子には配線できません');
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/schematic-core test -- to-session.test.ts
```

期待出力の冒頭: `does not provide an export named 'toSession'`。

- [ ] `packages/schematic-core/src/to-session.ts` を書く。

```ts
import {
  addWire,
  createSession,
  plug,
  type BoardDefinition,
  type BoardSession,
  type InventoryItem,
} from '@ojt/board-model';
import { partId, type PartId, type WireColor } from '@ojt/circuit-sim';
import {
  assignToBoard,
  type AssignError,
  type AssignOptions,
  type AssignResult,
} from './assign.js';
import { documentDevices, type SchematicDocument } from './document.js';

/**
 * 割当結果から盤セッションを作る。設計仕様 §11.3 / §7.2。
 * 実際の配線は board-model の `addWire()` を通すので、1端子2本の上限や線色パレットの検査は
 * 盤モデル側の規則がそのまま効く。違反は割当側のエラーとして返す。
 */

/** セッション生成のオプション。 */
export interface ToSessionOptions extends AssignOptions {
  /** 盤に追加する任意部品。回路図がブザーを使う場合は自動で `BZ` が追加される。§5.3.4 */
  extraParts?: readonly PartId[];
  /** 使える部品の在庫。省略すると board-model の既定（リレー4・タイマ2）。 */
  inventory?: readonly InventoryItem[];
}

/** 生成結果。 */
export type ToSessionResult =
  | { ok: true; session: BoardSession; assignment: Extract<AssignResult, { ok: true }> }
  | { ok: false; errors: AssignError[] };

/** ブザーの部品ID。§6.4 */
const BUZZER_PART_ID = partId('BZ');

/** 回路図から盤セッション（装着＋配線）を作る。§11.3 */
export function toSession(
  doc: SchematicDocument,
  board: BoardDefinition,
  options: ToSessionOptions = {},
): ToSessionResult {
  const assignment = assignToBoard(doc, options);
  if (!assignment.ok) return { ok: false, errors: assignment.errors };

  const color: WireColor = options.color ?? '青';
  const extraParts = [...(options.extraParts ?? [])];
  if (documentDevices(doc).includes('BZ') && !extraParts.includes(BUZZER_PART_ID)) {
    extraParts.push(BUZZER_PART_ID);
  }

  const session = createSession(board, {
    roles: assignment.roles,
    allowedColors: [color],
    extraParts,
    inventory: options.inventory,
  });

  const errors: AssignError[] = [];
  for (const part of assignment.parts) {
    const result = plug(session, part.socket, part.kind, {
      presetMs: part.presetMs,
      rangeMaxMs: part.rangeMaxMs,
    });
    if (!result.ok) errors.push({ path: part.role, message: result.message });
  }
  for (const spec of assignment.wires) {
    const result = addWire(session, board, spec.from, spec.to, spec.color);
    if (!result.ok) errors.push({ path: spec.id, message: result.message });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, session, assignment };
}
```

- [ ] `packages/schematic-core/src/index.ts` の末尾に次を追記する。

```ts
export { toSession, type ToSessionOptions, type ToSessionResult } from './to-session.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/schematic-core test -- to-session.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] コミットする。

```powershell
git add packages/schematic-core
git commit -m @'
feat(schematic-core): build board session from schematic assignment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 15: src/layout.ts — 読取専用レンダラ用のレイアウト

**Files:**
- Create: `packages/schematic-core/src/layout.ts`
- Test: `packages/schematic-core/test/layout.test.ts`
- Modify: `packages/schematic-core/src/index.ts`

仕様 §11.2「`layout()` は文書モデルから SVG 要素の座標配列を返す純粋関数とし、描画そのものは `apps/desktop` が行う」を実装する。返すのは図形プリミティブ（線分・円・円弧・テキスト）の列で、単位は mm/px 非依存の論理座標。Phase 1D がこれを SVG に落とす。

記号は調査資料 §3.4 の「参考 接点図記号」に合わせる。

| 要素 | 図形 |
|---|---|
| a接点（`cr-a` / `t-a` / `pb-a`） | 縦棒2本 ＋ 左下から右上へのブレード |
| b接点（`cr-b` / `t-b` / `pb-b`） | 上記 ＋ ブレード先端と右縦棒を結ぶ閉じ棒 |
| 押ボタン（`pb-*`） | 上記 ＋ 操作子（縦棒＋ボタンの横棒） |
| 限時動作瞬時復帰接点（`t-*`） | 上記 ＋ パラシュート状の限時記号（上向き半円） |
| コイル | 円。タイマコイルはラベルに設定秒を併記する |
| ランプ | 円（色で塗る）＋ × |
| ブザー | 半円 ＋ 弦 |
| 分岐点 | 小さい塗り円 |
| 母線 | 左右の縦線とラベル `P(+24V)` / `N(0V)` |

段の x 位置は「始点の x ＋ 列番号 × 列幅」で決まり、分岐段は親の段の節点 x を引き継ぐ。壊れた参照（存在しない段を指す）があっても図形は返す（レンダラを落とさない。§13 #2 の「開始させない」は課題一覧側の責務）。

- [ ] 失敗するテストを書く。`packages/schematic-core/test/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  at,
  BUS_N,
  BUS_P,
  buzzer,
  coil,
  contactShapes,
  crA,
  createDocument,
  DEFAULT_LAYOUT_OPTIONS,
  LAMP_FILL,
  lamp,
  layout,
  loadShapes,
  pbA,
  rung,
  tA,
  tB,
  type Shape,
} from '../src/index.js';
import { flickerDoc, selfHoldDoc } from './helpers/docs.js';

function roles(shapes: readonly Shape[], role: Shape['role']): Shape[] {
  return shapes.filter((s) => s.role === role);
}

describe('layout: 読取専用レンダラ用の図形データ（§11.2）', () => {
  it('母線は左がP・右がN（§11.1）', () => {
    const result = layout(selfHoldDoc());
    const bus = roles(result.shapes, 'bus');
    expect(bus).toHaveLength(2);
    const [busP, busN] = bus;
    if (busP?.kind !== 'line' || busN?.kind !== 'line') throw new Error('bus');
    expect(busP.x1).toBe(DEFAULT_LAYOUT_OPTIONS.marginX);
    expect(busN.x1).toBeGreaterThan(busP.x1);
    const labels = roles(result.shapes, 'label').filter((s) => s.kind === 'text');
    expect(labels.map((s) => (s.kind === 'text' ? s.text : ''))).toContain('P(+24V)');
    expect(labels.map((s) => (s.kind === 'text' ? s.text : ''))).toContain('N(0V)');
    expect(result.width).toBeGreaterThan(busN.x1);
    expect(result.height).toBeGreaterThan(0);
  });

  it('同じ文書からは必ず同じ図形が出る（決定論）', () => {
    expect(layout(flickerDoc())).toEqual(layout(flickerDoc()));
    expect(layout(selfHoldDoc(), { colWidth: 30 })).not.toEqual(layout(selfHoldDoc()));
  });

  it('要素ごとにラベルと記号が出る', () => {
    const result = layout(selfHoldDoc());
    const texts = roles(result.shapes, 'label')
      .filter((s) => s.kind === 'text')
      .map((s) => (s.kind === 'text' ? s.text : ''));
    expect(texts).toEqual(['P(+24V)', 'N(0V)', 'PB2', 'PB1', 'CR1', 'CR1', 'CR1', 'PL1']);
    expect(roles(result.shapes, 'junction')).toHaveLength(2);
  });

  it('タイマコイルは設定秒を併記する（§11.1）', () => {
    const doc = createDocument('x', 'タイマ', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', 2500)]),
    ]);
    const texts = layout(doc)
      .shapes.filter((s) => s.kind === 'text')
      .map((s) => (s.kind === 'text' ? s.text : ''));
    expect(texts).toContain('T1 (2.5秒)');
  });

  it('接点記号: a接点／b接点／押ボタン操作子／限時記号（調査資料 §3.4）', () => {
    const a = contactShapes('cr-a', 0, 0, 12);
    const b = contactShapes('cr-b', 0, 0, 12);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(4);
    const pb = contactShapes('pb-a', 0, 0, 12);
    expect(pb).toHaveLength(5);
    const timed = contactShapes('t-a', 0, 0, 12);
    expect(timed).toHaveLength(4);
    expect(timed[3]?.kind).toBe('arc');
    expect(contactShapes('t-b', 0, 0, 12)).toHaveLength(5);
  });

  it('負荷記号: コイル＝丸、ランプ＝丸＋×（色つき）、ブザー＝半円（§11.1）', () => {
    const cr = loadShapes(coil('c', 'CR1'), 0, 0, 12);
    expect(cr).toHaveLength(1);
    expect(cr[0]?.kind).toBe('circle');
    expect(cr[0]?.kind === 'circle' ? cr[0].r : 0).toBeCloseTo(4.8, 6);
    const pl = loadShapes(lamp('c', 'PL3'), 0, 0, 12);
    expect(pl).toHaveLength(3);
    expect(pl[0]?.kind === 'circle' ? pl[0].fill : '').toBe(LAMP_FILL.PL3);
    const bz = loadShapes(buzzer('c'), 0, 0, 12);
    expect(bz[0]?.kind).toBe('arc');
    expect(bz).toHaveLength(2);
  });

  it('分岐は縦線と分岐点で描かれる', () => {
    const result = layout(flickerDoc());
    const junctions = roles(result.shapes, 'junction');
    expect(junctions).toHaveLength(6);
    expect(junctions.every((s) => s.kind === 'circle')).toBe(true);
    const rows = new Set(
      roles(result.shapes, 'wire')
        .filter((s) => s.kind === 'line')
        .map((s) => (s.kind === 'line' ? s.y1 : 0)),
    );
    expect(rows.size).toBe(flickerDoc().rungs.length);
  });

  it('要素数の違う分岐は横線でつないでから縦線に落とす', () => {
    const doc = createDocument('x', '長い分岐', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 0), at('r1', 1), [crA('c3', 'CR1'), crA('c4', 'CR1')]),
    ]);
    const result = layout(doc);
    const o = DEFAULT_LAYOUT_OPTIONS;
    const rejoin = result.shapes.filter(
      (s) => s.kind === 'line' && s.role === 'wire' && s.y1 === s.y2 && s.x1 > s.x2,
    );
    expect(rejoin).toHaveLength(1);
    const only = rejoin[0];
    if (only?.kind !== 'line') throw new Error('line');
    expect(only.x1).toBe(o.marginX + 2 * o.colWidth);
    expect(only.x2).toBe(o.marginX + o.colWidth);
  });

  it('壊れた参照があっても図形は返す（レンダラは落ちない。§13 #2）', () => {
    const doc = createDocument('x', '壊れた参照', [
      rung('r1', at('rX', 0), at('rY', 1), [crA('c1', 'CR1')]),
    ]);
    const result = layout(doc);
    expect(result.shapes.length).toBeGreaterThan(0);
    expect(result.shapes.filter((s) => s.role === 'junction')).toHaveLength(0);
  });

  it('限時b接点も描ける', () => {
    const doc = createDocument('x', '限時b', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', 1000)]),
      rung('r2', BUS_P, BUS_N, [tB('c3', 'T1'), lamp('c4', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [tA('c5', 'T1'), lamp('c6', 'PL2')]),
    ]);
    const arcs = layout(doc).shapes.filter((s) => s.kind === 'arc');
    expect(arcs).toHaveLength(2);
  });
});
```

- [ ] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/schematic-core test -- layout.test.ts
```

期待出力の冒頭: `does not provide an export named 'layout'`。

- [ ] `packages/schematic-core/src/layout.ts` を書く。

```ts
import type { CellKind, SchematicCell, SchematicDocument } from './document.js';

/**
 * 読取専用レンダラ用の純粋レイアウト。設計仕様 §11.2。
 * 文書モデルから図形プリミティブ（線分・円・円弧・テキスト）の列を返すだけで、
 * SVG化は `apps/desktop`（Phase 1D）の責務。座標は mm/px 非依存の論理単位。
 */

/** レイアウトの寸法設定（論理単位）。 */
export interface LayoutOptions {
  /** 1列（要素1つ分）の幅。 */
  colWidth?: number;
  /** 1行（段1つ分）の高さ。 */
  rowHeight?: number;
  /** 左右の余白。 */
  marginX?: number;
  /** 上下の余白。 */
  marginY?: number;
  /** 記号そのものの幅。 */
  symbolWidth?: number;
}

/** 既定の寸法設定。 */
export const DEFAULT_LAYOUT_OPTIONS: Required<LayoutOptions> = {
  colWidth: 24,
  rowHeight: 16,
  marginX: 12,
  marginY: 16,
  symbolWidth: 12,
};

/** 図形の役割（描画側が線幅・色を決めるための分類）。 */
export type ShapeRole = 'bus' | 'wire' | 'symbol' | 'label' | 'junction';

/** 図形プリミティブ。 */
export type Shape =
  | { kind: 'line'; role: ShapeRole; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; role: ShapeRole; cx: number; cy: number; r: number; fill?: string }
  | {
      kind: 'arc';
      role: ShapeRole;
      cx: number;
      cy: number;
      r: number;
      startDeg: number;
      endDeg: number;
    }
  | {
      kind: 'text';
      role: ShapeRole;
      x: number;
      y: number;
      text: string;
      anchor: 'start' | 'middle' | 'end';
    };

/** レイアウト結果。 */
export interface SchematicLayout {
  width: number;
  height: number;
  shapes: Shape[];
}

/** 表示灯の色 → 塗り色。§5.3.4 */
export const LAMP_FILL: Readonly<Record<string, string>> = {
  PL1: '#FFFFFF',
  PL2: '#F2C230',
  PL3: '#3FA34D',
  PL4: '#D64545',
};

/** 押ボタンの操作子を描く種別。 */
const PUSH_BUTTON_KINDS: readonly CellKind[] = ['pb-a', 'pb-b'];
/** 限時記号（パラシュート）を描く種別。調査資料 §3.4 */
const TIMED_KINDS: readonly CellKind[] = ['t-a', 't-b'];
/** b接点（閉じている接点）の種別。 */
const BREAK_KINDS: readonly CellKind[] = ['pb-b', 'cr-b', 't-b'];

function line(role: ShapeRole, x1: number, y1: number, x2: number, y2: number): Shape {
  return { kind: 'line', role, x1, y1, x2, y2 };
}

/** 1つの接点記号の図形。JIS風（縦棒2本＋ブレード、b接点は閉じ棒、タイマは限時記号）。§11.1 */
export function contactShapes(
  kind: CellKind,
  cx: number,
  cy: number,
  symbolWidth: number,
): Shape[] {
  const s = symbolWidth;
  const left = cx - s * 0.25;
  const right = cx + s * 0.25;
  const shapes: Shape[] = [
    line('symbol', left, cy - s * 0.3, left, cy + s * 0.3),
    line('symbol', right, cy - s * 0.3, right, cy + s * 0.3),
    line('symbol', left, cy, right, cy - s * 0.45),
  ];
  if (BREAK_KINDS.includes(kind)) {
    shapes.push(line('symbol', right, cy - s * 0.45, right, cy + s * 0.15));
  }
  if (PUSH_BUTTON_KINDS.includes(kind)) {
    shapes.push(line('symbol', cx, cy - s * 0.22, cx, cy - s * 0.8));
    shapes.push(line('symbol', cx - s * 0.25, cy - s * 0.8, cx + s * 0.25, cy - s * 0.8));
  }
  if (TIMED_KINDS.includes(kind)) {
    shapes.push({
      kind: 'arc',
      role: 'symbol',
      cx,
      cy: cy - s * 0.5,
      r: s * 0.3,
      startDeg: 180,
      endDeg: 360,
    });
  }
  return shapes;
}

/** 1つの負荷記号の図形（コイル＝丸、ランプ＝丸＋×、ブザー＝半円）。§11.1 */
export function loadShapes(
  cell: SchematicCell,
  cx: number,
  cy: number,
  symbolWidth: number,
): Shape[] {
  const s = symbolWidth;
  const r = s * 0.4;
  if (cell.kind === 'coil') {
    return [{ kind: 'circle', role: 'symbol', cx, cy, r }];
  }
  if (cell.kind === 'lamp') {
    const d = r * 0.7;
    return [
      { kind: 'circle', role: 'symbol', cx, cy, r, fill: LAMP_FILL[cell.device] ?? '#FFFFFF' },
      line('symbol', cx - d, cy - d, cx + d, cy + d),
      line('symbol', cx - d, cy + d, cx + d, cy - d),
    ];
  }
  return [
    { kind: 'arc', role: 'symbol', cx, cy, r, startDeg: 180, endDeg: 360 },
    line('symbol', cx - r, cy, cx + r, cy),
  ];
}

function cellLabel(cell: SchematicCell): string {
  if (cell.kind === 'coil' && cell.presetMs !== undefined) {
    return `${cell.device} (${(cell.presetMs / 1000).toFixed(1)}秒)`;
  }
  return cell.device;
}

function isLoad(kind: CellKind): boolean {
  return kind === 'coil' || kind === 'lamp' || kind === 'buzzer';
}

/**
 * 文書を図形プリミティブの列にする。同じ文書からは必ず同じ結果が出る（決定論）。§11.2
 */
export function layout(doc: SchematicDocument, options: LayoutOptions = {}): SchematicLayout {
  const o = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const shapes: Shape[] = [];
  const busPX = o.marginX;

  const rowY = new Map<string, number>();
  doc.rungs.forEach((r, i) => rowY.set(r.id, o.marginY + i * o.rowHeight));

  const startX = new Map<string, number>();
  for (const r of doc.rungs) {
    if ('bus' in r.from) {
      startX.set(r.id, busPX);
      continue;
    }
    const parent = startX.get(r.from.rung);
    startX.set(r.id, (parent ?? busPX) + r.from.node * o.colWidth);
  }

  let maxRight = busPX;
  for (const r of doc.rungs) {
    const end = (startX.get(r.id) ?? busPX) + r.cells.length * o.colWidth;
    if (end > maxRight) maxRight = end;
  }
  const busNX = maxRight + o.colWidth;
  const topY = o.marginY - o.rowHeight * 0.6;
  const bottomY =
    doc.rungs.length === 0
      ? topY
      : o.marginY + (doc.rungs.length - 1) * o.rowHeight + o.rowHeight * 0.6;

  shapes.push(line('bus', busPX, topY, busPX, bottomY));
  shapes.push(line('bus', busNX, topY, busNX, bottomY));
  shapes.push({
    kind: 'text',
    role: 'label',
    x: busPX,
    y: topY - o.rowHeight * 0.4,
    text: 'P(+24V)',
    anchor: 'middle',
  });
  shapes.push({
    kind: 'text',
    role: 'label',
    x: busNX,
    y: topY - o.rowHeight * 0.4,
    text: 'N(0V)',
    anchor: 'middle',
  });

  for (const r of doc.rungs) {
    const y = rowY.get(r.id) ?? o.marginY;
    const x0 = startX.get(r.id) ?? busPX;

    // 始点（母線から始まる段は x0 が左母線そのもの。分岐段は親の段から縦線を下ろす）
    if (!('bus' in r.from)) {
      const parentY = rowY.get(r.from.rung);
      if (parentY !== undefined) {
        shapes.push(line('wire', x0, parentY, x0, y));
        shapes.push({
          kind: 'circle',
          role: 'junction',
          cx: x0,
          cy: parentY,
          r: o.symbolWidth * 0.1,
        });
      }
    }

    // 要素
    r.cells.forEach((cell, index) => {
      const cellLeft = x0 + index * o.colWidth;
      const cellRight = cellLeft + o.colWidth;
      const cx = (cellLeft + cellRight) / 2;
      shapes.push(line('wire', cellLeft, y, cx - o.symbolWidth / 2, y));
      shapes.push(line('wire', cx + o.symbolWidth / 2, y, cellRight, y));
      if (isLoad(cell.kind)) {
        shapes.push(...loadShapes(cell, cx, y, o.symbolWidth));
      } else {
        shapes.push(...contactShapes(cell.kind, cx, y, o.symbolWidth));
      }
      shapes.push({
        kind: 'text',
        role: 'label',
        x: cx,
        y: y - o.symbolWidth * 0.95,
        text: cellLabel(cell),
        anchor: 'middle',
      });
    });

    // 終点（右母線、または他の段への合流）
    const endX = x0 + r.cells.length * o.colWidth;
    if ('bus' in r.to) {
      if (endX !== busNX) shapes.push(line('wire', endX, y, busNX, y));
    } else {
      const targetX = (startX.get(r.to.rung) ?? busPX) + r.to.node * o.colWidth;
      const targetY = rowY.get(r.to.rung);
      if (endX !== targetX) shapes.push(line('wire', endX, y, targetX, y));
      if (targetY !== undefined) {
        shapes.push(line('wire', targetX, y, targetX, targetY));
        shapes.push({
          kind: 'circle',
          role: 'junction',
          cx: targetX,
          cy: targetY,
          r: o.symbolWidth * 0.1,
        });
      }
    }
  }

  return { width: busNX + o.marginX, height: bottomY + o.marginY, shapes };
}
```

- [ ] `packages/schematic-core/src/index.ts` の末尾に次を追記する。

```ts
export {
  contactShapes,
  DEFAULT_LAYOUT_OPTIONS,
  LAMP_FILL,
  layout,
  loadShapes,
  type LayoutOptions,
  type SchematicLayout,
  type Shape,
  type ShapeRole,
} from './layout.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/schematic-core test -- layout.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

- [ ] コミットする。

```powershell
git add packages/schematic-core
git commit -m @'
feat(schematic-core): add pure layout for read-only schematic renderer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 16: src/index.ts — schematic-core の公開APIを確定し全体を検証する

**Files:**
- Modify: `packages/schematic-core/src/index.ts`

Task 12〜15 で追記してきた再輸出を、次の最終形と一致しているか突き合わせる（並び順もこのとおりにする）。

- [ ] `packages/schematic-core/src/index.ts` を次の内容にする。

```ts
export {
  at,
  BUS_N,
  BUS_P,
  buzzer,
  coil,
  crA,
  crB,
  createDocument,
  documentDevices,
  isContactCell,
  isLoadCell,
  lamp,
  pbA,
  pbB,
  rung,
  rungNodeCount,
  SCHEMATIC_FORMAT_VERSION,
  tA,
  tB,
  validateDocument,
  type CellKind,
  type ContactCellKind,
  type DocumentError,
  type LoadCellKind,
  type Rung,
  type RungEnd,
  type SchematicCell,
  type SchematicDocument,
} from './document.js';

export {
  assignToBoard,
  deriveSocketRoles,
  requiredRoles,
  type AssignError,
  type AssignOptions,
  type AssignResult,
  type CellAssignment,
  type PartAssignment,
  type WireSpec,
} from './assign.js';

export { toSession, type ToSessionOptions, type ToSessionResult } from './to-session.js';

export {
  contactShapes,
  DEFAULT_LAYOUT_OPTIONS,
  LAMP_FILL,
  layout,
  loadShapes,
  type LayoutOptions,
  type SchematicLayout,
  type Shape,
  type ShapeRole,
} from './layout.js';
```

- [ ] 全パッケージのテスト・型検査・lint・整形を確認する。

```powershell
pnpm test
pnpm typecheck
pnpm exec eslint .
pnpm exec prettier --check .
```

期待出力: `@ojt/circuit-sim` は Plan 1A のテスト（91件）、`@ojt/board-model` が `Tests  47 passed (47)`、`@ojt/schematic-core` が `Tests  40 passed (40)`。`tsc` と `eslint` は無出力、prettier は `All matched files use Prettier code style!`。

- [ ] カバレッジがしきい値（行・分岐とも90%以上、§14.2）を満たすことを確認する。

```powershell
pnpm --filter @ojt/board-model exec vitest run --coverage
pnpm --filter @ojt/schematic-core exec vitest run --coverage
```

期待出力（実測値）:

```
board-model     Statements 97.75% / Branches 91.91% / Functions 100% / Lines 99.56%
schematic-core  Statements 97.72% / Branches 93.58% / Functions 100% / Lines 98.42%
```

- [ ] 循環依存が無いことを確認する（仕様 §4.2）。

```powershell
pnpm exec eslint packages/board-model/src packages/schematic-core/src
```

期待出力: 何も表示されず終了（終了コード0）。

- [ ] コミットする。

```powershell
git add packages/schematic-core
git commit -m @'
feat(schematic-core): finalize public api surface

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## 仕様 §6 / §11 との対応表（完了判定に使う）

| 仕様 | 内容 | 実装 | テスト |
|---|---|---|---|
| §6.1 | 盤の構成（ソケット5・PL4・PB4・端子台8P/12P・P/N各6・ブレーカ・スイッチ・電源・ダクト・M3端子） | Task 4 | `board`「ソケット5・PB4・PL4」「端子台は12P／8P」「ダクトは連結した5区間」 |
| §6.1 | ソケットの役割割当（課題1形式 / 課題2形式） | Task 5 | `roles`「課題1形式・課題2形式の割当は妥当」 |
| §6.2 | ソケット端子の4段配置とピン割付（COM 9-12 / NC 1-4 / NO 5-8 / コイル 13-14） | Task 4 | `board`「4段配置どおりの座標」「ピン割付が仕様どおり」 |
| §6.3 | チェック用ソケットの黄色固定配線3本・`locked`・同端子は残り1本 | Task 4・7 | `board`「黄色固定配線は3本で §6.3 の端子どおり」／`session`「固定配線は削除できない」「黄色配線が1本ある端子には1本しか足せない」／`to-netlist`「赤PBで励磁する回路になっている」 |
| §6.4 | 端子ID命名（`CR1.13` / `TB_PB.1a` / `TB_PL.1+` / `P.1` / `PS.+` / `BZ.+`） | Task 4・5・8 | `roles`「役割名がそのまま部品IDになる」／`to-netlist`「部品・リンク・電線の構成」 |
| §6.4 | PB/PL本体↔端子台の既設リンク（12本・8本、`locked`、故障注入対象外） | Task 4・8 | `board`「既設リンクは32本」／`to-netlist`「`links.every(locked)`」 |
| §6.4 | 本体端子には配線できない（測定と3D表示のためだけに存在する） | Task 4・7 | `board`「PB／PL本体端子は配線できず」／`session`「配線不可端子を拒否する」 |
| §6.5 | 3D座標（mm・盤左上手前が原点・当たり判定半径4mm・ダクトのポリライン） | Task 3・4 | `board`「全端子の座標が盤外形の中にある」「当たり判定半径は4mm」 |
| §6.6 | 部品カタログ（`relay-my4n` / `timer-h3y4` とレンジ） | Task 6 | `catalog`「装着できるのはリレーとタイマの2種」「タイマのレンジは 0〜10s と 0〜60s」 |
| §6.6 | 電線モデル（id / from / to / color / locked） | Task 7 | `session`「電線を張る／外す」 |
| §6.6 | 1端子2本まで。3本目は拒否する | Task 7 | `session`「1端子2本まで」 |
| §6.6 | 経路は自動（端子→ダクト→端子）。重なる線は2mmピッチで並列オフセット。線径1.6mm | Task 9 | `routing`「端子 → ダクト → 端子 の折れ線を返す」「2mmピッチで並列オフセット」「決定論」 |
| §6.6 | 電線の見た目（両端のY型圧着端子） | 範囲外 | 経路（`WireRoute.points`）と線径（`WIRE_DIAMETER_MM`）までを本計画が返し、チューブジオメトリと圧着端子の形状は `apps/desktop`（Plan 1D、§15 の3D規模）が描く |
| §7.1 | 課題の `inventory`（使える部品と本数） | Task 6・7 | `catalog`「在庫の計算」／`session`「装着・取り外し・在庫」 |
| §7.2 | `physicalOverride`（回路図要素 → 物理端子の手動指定） | Task 13 | `assign`「physicalOverride が既定規則より優先される」 |
| §8.1 | 線色パレット（モードB=青 / C2=白。黄は選べない） | Task 7 | `session`「パレット外の色を拒否する」「白線モードでは青を拒否する」 |
| §8.2 | 配線・部品装着・タイマ設定の操作 | Task 7 | `session` 全件 |
| §11.1 | 文書形式（横書き既定・左P右N・グリッド・要素種別・結線・分岐点・`formatVersion`） | Task 12 | `document` 全件 |
| §11.2 | 読取専用レンダラ用の `layout()`（純関数・図形データまで） | Task 15 | `layout` 全件 |
| §11.3 | 回路図→ネットリスト割当（接点の組・コイル・PB・PL・母線・上書き・エラー） | Task 13 | `assign` 全件 |
| §11.3 | 割当結果から盤へ（線色は引数、既定は青） | Task 14 | `to-session`「割当どおりに装着と配線が入る」 |
| §14.1 #5 | 自己保持回路 | Task 8・14 | `to-netlist`「自己保持回路が Simulation で動く」／`to-session`「自己保持回路が動く」 |
| §14.1 #6 | インターロック（先行優先） | Task 14 | `to-session`「インターロック回路が動く」 |
| §14.1 #8 | オンディレータイマ回路 | Task 14 | `to-session`「オンディレー回路が3秒で点灯する」 |
| §14.1 #11 | フリッカ（リレー併用）・チャタリングしない | Task 14 | `to-session`「フリッカ回路が周期的に点滅し、チャタリングしない」 |
| §14.1 #29 | 回路図→ネットリスト変換（5組目でエラー、4組目までは正しい端子） | Task 13 | `assign`「接点は出現順に組1〜組4へ」「5個目の接点はエラー」 |
| §4.2 | 循環依存の禁止（`import/no-cycle` をエラー） | Task 1 | `pnpm exec eslint .`（Task 1 で発火を実地確認） |
| §12.2 | 3D座標系の前提（盤の左上手前が原点・mm・2.5D） | Task 3・4 | `geometry` 全件／`board`「全端子の座標が盤外形の中にある」 |
| §12.2 | ピックの純粋関数化（`resolvePick(hit, uiState)`） | 範囲外 | 本計画は当たり判定に要る素材（端子ID・座標・半径4mm・`wirable`）を `BoardTerminal` として提供する。`resolvePick()` 自体はUI状態（選択中の線色・削除モード）を要するため `apps/desktop`（Plan 1D）で実装する |
| §14.2 | `board-model` / `schematic-core` の行・分岐カバレッジ90%以上 | Task 10・16 | `vitest run --coverage` のしきい値 |

（§14.1 #1〜#4・#7・#9・#10・#12〜#24 は `circuit-sim` 側で Plan 1A が担当済み。#25〜#28 は Phase 3、#30 は `content`（Plan 1C）の担当で、いずれも本計画の範囲外。）

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本計画での実装 | 理由 |
|---|---|---|---|
| 1 | §4.2「`board-model` はデータ定義のみ。`circuit-sim` に依存しない」 | `board-model` が `circuit-sim` の型と部品ファクトリに依存する | 盤セッション（装着部品＋電線）→ネットリスト変換（§4.4 のデータフロー）をどこかが担う必要があり、盤の構造を最もよく知っているのは `board-model` である。`content`（Plan 1C）に置くと課題スキーマが盤の内部構造を知ることになり、`circuit-sim` に置くとエンジンが特定の盤に依存する。**仕様書 §4.2 はこの計画に合わせて修正済み**（`board --> sim` を依存図に追加し、規則の行を差し替えた）。逆方向（`circuit-sim` → `board-model`）は引き続き禁止で、`import-x/no-cycle` と pnpm の厳格な node_modules の両方で守られる |
| 2 | §6.5「具体座標は Phase 1 の実装で調査資料 §2.2 の配置図に基づき確定する（範囲決定）」 | 盤面 330×300×110mm、ソケット列ピッチ9mm・段ピッチ12mm、端子台ピッチ9mm、ダクト横3本＋縦2本 を確定した | 仕様が Phase 1 に委ねた範囲決定をここで行った。根拠は Task 4 冒頭の表のとおり（市販検定盤2社の一致する外形、M3端子と半径4mmの当たり判定が重ならない最小ピッチ、2mmピッチで6本を通せるダクト幅） |
| 3 | §6.6 の `terminals[].role` 一覧（`coil+` / `coil-` / `com` / `no` / `nc` / `+` / `-` / `c` / `a` / `b` / `x` / `y` / `ss` / `plc-com` / `ac-l` / `ac-n`） | Phase 1 の盤で使う11種だけを `TerminalRole` に定義し、AC一次側は `ac` の1種にまとめた | `x` / `y` / `ss` / `plc-com` / `ac-l` / `ac-n` はPLC本体の端子役割で、PLC本体を盤モデルに足す Phase 3 で追加する。ブレーカ・電源スイッチは開閉器としてのみモデル化し電気的に解かない（§5.3.5）ので、一次・二次の区別を型に持たせる意味がない |
| 4 | §6.4 の端子表（`CB.1` / `CB.2` / `SW.1` / `SW.2` / `OUTLET.*`） | `CB` / `SW` は盤定義に端子を持つが**ネットリストには載せない**。`OUTLET` は定義しない | AC一次側は電気的に解かない（§5.1.1「交流は扱わない」）。3D表示とホバー表示のために座標だけ要る。`OUTLET`（壁コンセント）はPLC電源の独立性チェック（§10.2）専用なので Phase 3 で足す |
| 5 | §11.1「要素: …結線（横線・縦線）、分岐点」 | 横線は「段の中で隣り合う要素は繋がっている」という暗黙の規則にし、縦線と分岐点は「段の端点が他の段の節点を指す」形で表した | 横線・縦線を独立の要素として持つと、要素の並びと結線の整合をとる検証が別途必要になる。端点参照にすると「段は必ず1本の経路である」ことが型で保証され、検証・割当・レイアウトが同じ構造をそのまま辿れる。表示上は完全に同じ図になる |
| 6 | §11.1 は段の中の負荷の位置を定めていない | 「右母線(N)に至る段は負荷1つで終わる／分岐段に負荷は置けない」を `validateDocument()` のエラーにした | 展開接続図の作法（右母線の直前が負荷）であり、これを外すと「コイルの後ろに接点がある」図が書けてしまい教材として誤りになる。電気的には直列順序に意味がないので、割当・シミュレーション結果は変わらない |
| 7 | §11.3「母線 → `P.1`〜`P.6` / `N.1`〜`N.6` のうち、1端子2本の制約を満たすように若番から割り当てる」 | 上記に加えて、チェック用の黄色配線が既に1本使っている `P.6` / `N.6` を「残り1本」として数える | §6.3 が「`P.6` と `N.6` も同様に残り1本である」と定めているため。これを数えないと生成した配線が盤に載らない |
| 8 | §6.6「経路は自動。端子 → 最寄りダクト入口 → ダクト内 → 目的端子の最寄り出口 → 端子」 | ダクトを区間グラフにしてダイクストラ法で最短経路を取る。並列オフセットは「1区間でも共有する既存経路の本数」を段数とし、経路全体を法線の平均方向へずらす | 「ダクト内」を最短経路と読む以外の解釈が無い。オフセットを区間ごとに変えると角で不連続になるため、経路単位で1段とした。どちらも決定論（§5.2）を満たす |
| 9 | §5.3.4「PL は端子電圧19.2V以上で点灯表示」 | Plan 1A が採用した 14.4V/7.2V（点灯／暗点灯）をそのまま使う | Plan 1A の差分表#3 と同じ理由（接触抵抗による暗点灯を表現するため）。**仕様書 §5.3.4 と §17.2 はこの値に修正済み**（#23 として前提を追記した） |

---

## 完了条件

1. `pnpm test` が全て通る（`@ojt/circuit-sim` 91件、`@ojt/board-model` **47件**、`@ojt/schematic-core` **40件**）。
2. `pnpm --filter @ojt/board-model exec vitest run --coverage` と `pnpm --filter @ojt/schematic-core exec vitest run --coverage` が、行・分岐とも90%のしきい値を満たす。
3. `pnpm typecheck`・`pnpm exec eslint .`・`pnpm exec prettier --check .` がすべてエラーなしで終わる。
4. `import-x/no-cycle` がエラー設定で有効になっており、わざと作った循環を検出することを実地で確認済みである（Task 1）。
5. `packages/board-model` と `packages/schematic-core` が外部ランタイム依存を持たない（`dependencies` は workspace 内のパッケージのみ）。
6. 回路図（`SchematicDocument`）から `toSession()` → `toNetlist()` → `Simulation` の順に通して、自己保持・インターロック・オンディレー・フリッカの4回路が期待どおり動く。
