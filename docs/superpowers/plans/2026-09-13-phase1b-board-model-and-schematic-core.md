# Plan 1B: 盤モデル board-model + 回路図モデル schematic-core 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1A で作った `@ojt/circuit-sim` の上に、設計仕様書 §6（盤の部品構成・ソケット4段配置・ピン割付・チェック用ソケットの固定配線・端子ID命名・3D座標・電線モデル）を実物の写真（`docs/reference/K96-CS3-board-photo.png`）どおりの配置で満たす `@ojt/board-model` と、§11（展開接続図の文書形式・回路図→ネットリスト割当・読取専用レンダラ用レイアウト）を満たす `@ojt/schematic-core` を実装し、「回路図 → 物理割当 → 盤セッション → ネットリスト → `Simulation`」の一本道が実際に動く状態にする。

**Architecture:** `board-model` は盤の**物理**（ソケットID `S1`〜`S8`・端子座標・部品の占有矩形・配線帯・傾斜コンソールの形状）だけを持ち、課題が与える役割割当（`S1 → CR1` など）を通して circuit-sim の**論理**（端子ID `CR1.13`）へ写す。訓練者の作業状態は `BoardSession`（装着状態＋電線）という1つのプレーンオブジェクトに集約し、`toNetlist()` がそれを circuit-sim の部品ファクトリで `Netlist` に変換する。`schematic-core` は展開接続図を「段（ラング）＝始点・終点・直列要素の列」で表し、段どうしの参照がそのまま縦線（分岐）になる。`assignToBoard()` が §11.3 の規則で回路図要素を物理端子へ割り当て、`toSession()` が `board-model` の `addWire()` を通して盤に落とす。3D描画とSVG描画は一切行わず、幾何データ（mm）と図形プリミティブ（論理座標）までを返す。

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
| `src/geometry.ts` | 純粋な幾何ユーティリティ。`Vec3`（mm）／`Polyline`／`Rect`／`distance()`／`nearestPointOnPolyline()`／`segmentIntersectsRect()` |
| `src/board-jipm.ts` | 標準盤（実物写真 K96-CS3 準拠）の定義データ。盤面寸法と傾斜コンソール形状・ソケット8個のネジ端子座標（上下2ティア）と差込穴・PB4・PL4（貫通穴つき）・端子台12P/8P・P/N供給端子・ブレーカ・スイッチ・電源・**部品の占有矩形**・**配線帯**・既設固定配線・既設0Ωリンク |
| `src/roles.ts` | ソケットの役割割当。`SocketRoles` と `terminalIdFor(role, pin)`、物理端子IDと役割端子IDの相互変換 |
| `src/catalog.ts` | 訓練者が装着できる部品のカタログ（`relay-my4n` / `timer-h3y4` とタイマレンジ）と課題の `inventory` 表現 |
| `src/session.ts` | `BoardSession` と操作関数（`plug` / `unplug` / `setPreset` / `addWire` / `removeWire`）。失敗は Result 型で返す |
| `src/to-netlist.ts` | `toNetlist(session, board)`。盤セッションを circuit-sim の `Netlist` に変換する |
| `src/routing.ts` | `routeWire(board, wire, existingRoutes)`。配線帯を使った**直角配線**、レーン割当（区間彩色）、フィレット、**部品の占有矩形を跨がない保証**（純関数・決定論） |
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

/** 盤面上の軸並行矩形[mm]（部品の占有領域など）。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 矩形の右端・下端。 */
export function rectRight(r: Rect): number {
  return r.x + r.w;
}

/** 矩形の下端。 */
export function rectBottom(r: Rect): number {
  return r.y + r.h;
}

/** 点が矩形の内側（境界を含む）にあるか。 */
export function rectContains(r: Rect, p: Vec3, epsilon = 1e-9): boolean {
  return (
    p.x >= r.x - epsilon &&
    p.x <= rectRight(r) + epsilon &&
    p.y >= r.y - epsilon &&
    p.y <= rectBottom(r) + epsilon
  );
}

/** 2つの矩形が重なるか（辺で接するだけは重なりとみなさない）。 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y;
}

/**
 * 線分（XY平面に射影したもの）が矩形の**内部**を通るか。
 * 境界に接するだけ（辺の上をなぞる・角に触れる）は通過とみなさない。
 * 配線が部品の上を横切っていないことの検査に使う。
 */
export function segmentIntersectsRect(a: Vec3, b: Vec3, r: Rect, epsilon = 1e-9): boolean {
  const x0 = r.x + epsilon;
  const x1 = rectRight(r) - epsilon;
  const y0 = r.y + epsilon;
  const y1 = rectBottom(r) - epsilon;
  if (x1 <= x0 || y1 <= y0) return false;
  // Liang–Barsky のクリッピングで、線分と矩形内部の共通部分が長さを持つかを見る
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < epsilon) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, a.x - x0)) return false;
  if (!clip(dx, x1 - a.x)) return false;
  if (!clip(-dy, a.y - y0)) return false;
  if (!clip(dy, y1 - a.y)) return false;
  return t1 - t0 > epsilon;
}
```

- [ ] `packages/board-model/src/index.ts` を次の内容に置き換える（`PACKAGE_NAME` は役目を終えたので消し、`test/scaffold.test.ts` も削除する）。

```ts
export {
  addVec,
  distance,
  rectBottom,
  rectContains,
  rectRight,
  rectsOverlap,
  segmentIntersectsRect,
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
  type Rect,
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

## Task 4: src/board-jipm.ts — 標準盤の定義データ（写真 K96-CS3 準拠）

**Files:**
- Create: `packages/board-model/src/board-jipm.ts`
- Test: `packages/board-model/test/board.test.ts`
- Modify: `packages/board-model/src/index.ts`

仕様 §6.1〜§6.5、調査資料 §2.1〜§2.2 / §3.1 / §3.5 に対応し、**配置は実物の写真**
（`docs/reference/K96-CS3-board-photo.png`、OMRON「電気系保全作業練習器 形 K96-CS3」）に合わせる。

写真から読み取った構成:

| 位置 | 実物 | 本計画での表現 |
|---|---|---|
| 形状 | 傾斜コンソール（手前が低く奥が高い。奥に立ち上がりの脚がある） | 盤面は平面なので座標は 2.5D のまま。傾斜と立ち上がりは `BoardDefinition.console` に持たせる |
| 上段・左 | DC24V 供給端子（透明カバー付きの小さな端子台。銘板に `DC24V`）。**P×1・N×1 の2点** | `P.1` / `N.1` の2端子だけ |
| 上段・右 | 2極MCB | `CB.1` / `CB.2`（＋ 仕様 §5.3.5 が要求する電源スイッチ `SW.1` / `SW.2`） |
| 上段中 | DINレールに 14ピンソケットが**左4個・右4個の計8個** | 物理ソケット `S1`〜`S4`（左クラスタ）／`S5`〜`S8`（右クラスタ） |
| ソケット | 差込穴は本体中央。ネジ端子は本体の**奥端と手前端に段付きで2列ずつ**（黄色の取り外しレバーは手前端） | §6.2 の4段配置を「上ティア＝段1・段2（本体の奥端）／下ティア＝段3・段4（手前端）」に対応させ、中央を差込穴領域にする |
| 中段・左 | ランプ用端子台（8P、DINレール上、白いマーカー帯） | `TB_PL.1+`〜`TB_PL.4-` |
| 中段・右 | 押ボタン用端子台（12P、DINレール上） | `TB_PB.1c`〜`TB_PB.4b` |
| 下段・左 | 表示灯 `PL1`(白) `PL2`(黄) `PL3`(緑) `PL4`(赤)。各1つの**貫通穴**から青線2本が端子台へ | `PL1`〜`PL4`（`panelHole` つき）＋ 盤裏の本体端子 ＋ `fixedLinks` 8本（色 `青`） |
| 下段・右 | 押ボタン `PBS1`(黒) `PBS2`(黄) `PBS3`(緑) `PBS4`(赤)。各1つの貫通穴から青線3本 | `PB1`〜`PB4`（銘板表記は `panelLabel`、`panelHole` つき）＋ `fixedLinks` 12本（色 `青`） |
| 配線 | **ダクトが無い**。電線は盤面の上を直角に整列して走り、部品の上は通らない | `footprints`（占有矩形）と `wiringChannels`（配線帯）を持たせ、Task 9 の直角配線で経路を作る |

寸法は写真を平面射影として計測して決めた（方法: 盤面の4隅から矩形のメトリック復元を行い、焦点距離と
盤面の縦横比を求めたうえで、ソケットの取付ピッチ（PYF14A の外形幅 27.5mm）を物差しに使う）。

| 項目 | 本アプリの既定 | 根拠 |
|---|---|---|
| 盤面の幅 | **330 mm** | 写真のソケットピッチから逆算すると 314〜360mm（左クラスタ/右クラスタ）。その範囲に入り、かつ市販の同等品2機種（アドウィン AKE-1405、メカトロ教材社 MK-EP1。調査資料 §2.5）がどちらも 330mm であることから 330 を採る |
| 盤面の奥行 | **245 mm** | 写真の4隅からメトリック復元した縦横比 1.357（奥行/幅 = 0.737）× 330mm ≒ 243mm を丸めた値。**写真からの推定** |
| 筐体の厚み | **50 mm** | 写真の側面（手前の立ち上がり）の見かけの高さからの推定。**写真からの推定** |
| 傾斜角 | **13°**（手前端 50mm・奥端 105.1mm） | 写真の側面プロファイルからの推定。`frontHeightMm + 245 × sin(13°) = rearHeightMm` が整合することをテストで固定する。**写真からの推定** |
| ソケット本体 | 幅 **30 mm** × 奥行 **76 mm**、取付ピッチ **32 mm** | 奥行は「奥端のネジ端子ティア＋差込穴領域＋手前端のティア」が収まる長さ（写真の見た目にも合う）。幅は下の列ピッチから決まる 27mm に取付の遊びを足した値で、PYF14A の外形幅 27.5mm とも整合する。ピッチは幅＋隣との隙間2mm。**写真からの推定** |
| ネジ端子の列ピッチ | **9 mm**（4列 = 27mm） | §6.5 の当たり判定半径4mmで隣と重ならない最小値。本体幅30mmの中央に収まる |
| ネジ端子のティア内段ピッチ | **8 mm** | 同じ理由（半径4mm×2）。写真の見た目（約7mm）に最も近い、重ならない値 |
| ティアの本体端からの距離 | **6 mm**（段1は奥端から6mm、段4は手前端から6mm） | ネジ端子が本体の端に寄っている写真の見た目に合わせた。**写真からの推定** |
| 差込穴（14ピン） | 2列 × 7段、列ピッチ **12 mm**、段ピッチ **5 mm**、本体端から **22 mm** の中央領域 | MY4／H3Y-4 の14ピンの並び。実寸は非公開なので**本アプリ既定** |
| 端子台のピッチ | **9 mm** | 同上。12Pで99mm、8Pで63mm |
| 左クラスタ／右クラスタのX | **28 / 180 mm** | 写真の実測（レバー位置）から本体左端に換算し、左右の余白と配線帯が入る位置に丸めた |
| PL／PB の取付ピッチ | **24 / 21 mm** | 写真の実測（PL3→PL4 = 24mm、PBS2→PBS3→PBS4 = 約21mm） |
| 貫通穴の位置 | 機器中心から奥へ **11 mm** | 写真では青線が機器の**奥側の根元**の1点に集まる。**写真からの推定** |
| P/N供給端子の本数 | **P.1 / N.1 の各1本** | 実機の DC24V 供給端子台が2点（P・N）しかないことが確定した。仕様 §6.1 の表は6本ずつとしているが実機を優先する。1端子2本の規則（§6.6）により、チェック用の既設配線が各1本を使うので、訓練者が母線から直接取れるのは各1本。残りは**渡り配線**で分配する（Task 13） |
| 端子の当たり判定半径 | **4 mm** | §6.5 で確定 |
| PB／PL本体端子の z | **−12 mm**（盤面のすぐ裏） | 端子は機器の根元にあり、貫通穴を抜けた青線がすぐ届く位置。§6.4「本体端子は測定と3D表示のためだけ」を座標で表す |

各端子は 3D がそのまま印字できる銘板（`label`）を持つ。ソケットは「⑬ −」「⑭ +」「⑨ COM」「⑤ a」
「① b」のように丸数字＋役割、端子台は `PL1+` / `PB1 c`、供給端子は `P1` / `N6`、本体端子は
`PBS1 c` のように写真の銘板どおりにする。

- [ ] 失敗するテストを書く。`packages/board-model/test/board.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BOARD_DEPTH_MM,
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
  SOCKET_IDS,
  SOCKET_BODY_LENGTH_MM,
  SOCKET_BODY_WIDTH_MM,
  SOCKET_PITCH_MM,
  socketBodyRect,
  socketPinHoleOffsets,
  socketPinOffset,
  socketPinTerminal,
  SOCKET_SLOT_INSET_MM,
  rectsOverlap,
  SUPPLY_TERMINAL_COUNT,
  TERMINAL_PICK_RADIUS_MM,
} from '../src/index.js';

const board = JIPM_BOARD;

function idsOf(prefix: string): string[] {
  return board.terminals.map((t) => t.id).filter((id) => id.startsWith(`${prefix}.`));
}

describe('board-jipm: 盤定義の不変条件（写真 K96-CS3 に準拠）', () => {
  it('ソケット8（左4・右4）・PB4・PL4（§6.1 / 写真）', () => {
    expect(board.sockets.map((s) => s.id)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
    ]);
    expect(board.sockets.filter((s) => s.cluster === 'left').map((s) => s.id)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
    ]);
    expect(board.sockets.filter((s) => s.cluster === 'right').map((s) => s.id)).toEqual([
      'S5',
      'S6',
      'S7',
      'S8',
    ]);
    expect(board.pushButtons.map((p) => `${p.id}/${p.panelLabel}:${p.color}`)).toEqual([
      'PB1/PBS1:黒',
      'PB2/PBS2:黄',
      'PB3/PBS3:緑',
      'PB4/PBS4:赤',
    ]);
    expect(board.lamps.map((l) => `${l.id}/${l.panelLabel}:${l.color}`)).toEqual([
      'PL1/PL1:白',
      'PL2/PL2:黄',
      'PL3/PL3:緑',
      'PL4/PL4:赤',
    ]);
  });

  it('端子台は12P／8P、P/N供給端子は1本ずつ（写真の DC24V 端子台は2点）', () => {
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

  it('ソケットは8個とも14ピンで、ネジ端子が上下2ティアに分かれる（§6.2 / 写真）', () => {
    for (const socket of SOCKET_IDS) {
      expect(idsOf(socket)).toHaveLength(14);
    }
    expect(board.sockets[0]?.origin).toEqual({ x: 28, y: 60, z: 10 });
    expect(board.sockets[4]?.origin).toEqual({ x: 180, y: 60, z: 10 });
    expect(board.sockets[0]?.bodyMm).toEqual({
      width: SOCKET_BODY_WIDTH_MM,
      length: SOCKET_BODY_LENGTH_MM,
    });
    const at = (pin: number): { x: number; y: number } => {
      const pos = boardTerminalPos(board, socketPinTerminal('S1', pin));
      return { x: pos.x, y: pos.y };
    };
    // 4段配置（§6.2）: 段1=[空]③②①、段2=⑧⑦⑥⑤、段3=⑫⑪⑩⑨、段4=④⑭⑬[空]
    // 段1・段2は本体の奥端に、段3・段4は手前端に寄り、中央は差込穴の領域になる
    const col = (i: number): number => 28 + socketPinOffset(0, i).dx;
    expect(at(3)).toEqual({ x: col(1), y: 60 + 6 });
    expect(at(1)).toEqual({ x: col(3), y: 60 + 6 });
    expect(at(8)).toEqual({ x: col(0), y: 60 + 14 });
    expect(at(5)).toEqual({ x: col(3), y: 60 + 14 });
    expect(at(12)).toEqual({ x: col(0), y: 60 + 62 });
    expect(at(9)).toEqual({ x: col(3), y: 60 + 62 });
    expect(at(4)).toEqual({ x: col(0), y: 60 + 70 });
    expect(at(14)).toEqual({ x: col(1), y: 60 + 70 });
    expect(at(13)).toEqual({ x: col(2), y: 60 + 70 });
    // 中央の差込穴領域には端子が無い（本体の 22mm〜54mm）
    for (const term of board.terminals.filter((x) => x.id.startsWith('S1.'))) {
      const dy = term.pos.y - 60;
      expect(dy < 22 || dy > SOCKET_BODY_LENGTH_MM - 22).toBe(true);
    }
  });

  it('ネジ端子は当たり判定（半径4mm）が重ならない間隔で並ぶ（§6.5）', () => {
    const socketTerminals = board.terminals.filter((x) => x.id.startsWith('S1.'));
    for (let i = 0; i < socketTerminals.length; i += 1) {
      for (let j = i + 1; j < socketTerminals.length; j += 1) {
        const a = socketTerminals[i];
        const b = socketTerminals[j];
        if (a === undefined || b === undefined) continue;
        expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThanOrEqual(
          2 * TERMINAL_PICK_RADIUS_MM,
        );
      }
    }
  });

  it('端子は番号＋役割の銘板を持つ（3Dがそのまま印字できる）', () => {
    expect(findBoardTerminal(board, 'S1.13')?.label).toBe('⑬ −');
    expect(findBoardTerminal(board, 'S1.14')?.label).toBe('⑭ +');
    expect(findBoardTerminal(board, 'S1.9')?.label).toBe('⑨ COM');
    expect(findBoardTerminal(board, 'S1.5')?.label).toBe('⑤ a');
    expect(findBoardTerminal(board, 'S1.1')?.label).toBe('① b');
    expect(findBoardTerminal(board, 'TB_PL.1+')?.label).toBe('PL1+');
    expect(findBoardTerminal(board, 'TB_PL.1-')?.label).toBe('PL1−');
    expect(findBoardTerminal(board, 'TB_PB.1c')?.label).toBe('PB1 c');
    expect(findBoardTerminal(board, 'P.1')?.label).toBe('P1');
    expect(findBoardTerminal(board, 'N.1')?.label).toBe('N1');
    expect(findBoardTerminal(board, 'PB1.c')?.label).toBe('PBS1 c');
  });

  it('部品の占有領域がそろっており、互いに重ならない（§6.6）', () => {
    const ids = board.footprints.map((f) => f.id);
    expect(ids).toContain('supply');
    expect(ids).toContain('CB');
    expect(ids).toContain('TB_PL');
    expect(ids).toContain('TB_PB');
    for (const socket of SOCKET_IDS) expect(ids).toContain(socket);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 0; i < board.footprints.length; i += 1) {
      for (let j = i + 1; j < board.footprints.length; j += 1) {
        const a = board.footprints[i];
        const b = board.footprints[j];
        if (a === undefined || b === undefined) continue;
        expect(rectsOverlap(a, b)).toBe(false);
      }
    }
  });

  it('配線帯は列と列の間・左右余白・クラスタ間に引かれている（§6.6）', () => {
    expect(board.wiringChannels.map((c) => c.id)).toEqual([
      'ch-top',
      'ch-mid',
      'ch-low',
      'ch-left',
      'ch-gap',
      'ch-right',
    ]);
    const at = (id: string): number => board.wiringChannels.find((c) => c.id === id)?.at ?? -1;
    // 奥から: P/N列 → ch-top → ソケット列 → ch-mid → 端子台列 → ch-low → PL/PB列
    expect(at('ch-top')).toBeGreaterThan(boardTerminalPos(board, 'N.1').y);
    expect(at('ch-top')).toBeLessThan(boardTerminalPos(board, 'S1.1').y);
    expect(at('ch-mid')).toBeGreaterThan(boardTerminalPos(board, 'S1.13').y);
    expect(at('ch-mid')).toBeLessThan(boardTerminalPos(board, 'TB_PL.1+').y);
    expect(at('ch-low')).toBeGreaterThan(boardTerminalPos(board, 'TB_PB.1c').y);
    expect(at('ch-low')).toBeLessThan(boardTerminalPos(board, 'PL1.+').y);
    // ch-gap は左右のソケットクラスタの間
    expect(at('ch-gap')).toBeGreaterThan(28 + 3 * SOCKET_PITCH_MM + SOCKET_BODY_WIDTH_MM);
    expect(at('ch-gap')).toBeLessThan(180);
  });

  it('クラスタ内のソケットは取付ピッチどおりに等間隔で並ぶ（写真）', () => {
    const originX = (id: (typeof SOCKET_IDS)[number]): number =>
      board.sockets.find((s) => s.id === id)?.origin.x ?? -1;
    expect(originX('S2') - originX('S1')).toBe(SOCKET_PITCH_MM);
    expect(originX('S4') - originX('S3')).toBe(SOCKET_PITCH_MM);
    expect(originX('S6') - originX('S5')).toBe(SOCKET_PITCH_MM);
    expect(originX('S8') - originX('S7')).toBe(SOCKET_PITCH_MM);
    // 左クラスタと右クラスタは離れており、同じDINレール列（同じy）に載る
    expect(originX('S5') - originX('S4')).toBeGreaterThan(SOCKET_PITCH_MM);
    expect(new Set(board.sockets.map((s) => s.origin.y)).size).toBe(1);
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

  it('全端子の座標が盤面の中にある（§6.5）', () => {
    for (const t of board.terminals) {
      expect(t.pos.x).toBeGreaterThanOrEqual(0);
      expect(t.pos.x).toBeLessThanOrEqual(BOARD_WIDTH_MM);
      expect(t.pos.y).toBeGreaterThanOrEqual(0);
      expect(t.pos.y).toBeLessThanOrEqual(BOARD_HEIGHT_MM);
    }
    expect(board.sizeMm).toEqual({ width: 330, height: 245, depth: 50 });
    for (const fp of board.footprints) {
      expect(fp.x).toBeGreaterThanOrEqual(0);
      expect(fp.x + fp.w).toBeLessThanOrEqual(BOARD_WIDTH_MM);
      expect(fp.y).toBeGreaterThanOrEqual(0);
      expect(fp.y + fp.h).toBeLessThanOrEqual(BOARD_HEIGHT_MM);
    }
  });

  it('傾斜コンソールの形状メタが奥行と整合する（写真からの推定）', () => {
    const c = board.console;
    expect(c.slopeDeg).toBe(13);
    expect(c.frontHeightMm).toBe(BOARD_DEPTH_MM);
    const rise = BOARD_HEIGHT_MM * Math.sin((c.slopeDeg * Math.PI) / 180);
    expect(c.rearHeightMm).toBeCloseTo(c.frontHeightMm + rise, 1);
    expect(c.rearHeightMm).toBeGreaterThan(c.frontHeightMm);
  });

  it('写真どおりの段構成（奥から: 電源/ブレーカ → ソケット → 端子台 → PL/PB）', () => {
    const y = (id: string): number => boardTerminalPos(board, id).y;
    expect(y('P.1')).toBeLessThan(y('S1.1'));
    expect(y('CB.1')).toBeLessThan(y('S5.1'));
    expect(y('S1.13')).toBeLessThan(y('TB_PL.1+'));
    expect(y('S5.13')).toBeLessThan(y('TB_PB.1c'));
    expect(y('TB_PL.1+')).toBeLessThan(y('PL1.+'));
    expect(y('TB_PB.1c')).toBeLessThan(y('PB1.c'));
    // 左上にDC24V供給端子、右上にブレーカ
    expect(boardTerminalPos(board, 'P.1').x).toBeLessThan(BOARD_WIDTH_MM / 2);
    expect(boardTerminalPos(board, 'CB.1').x).toBeGreaterThan(BOARD_WIDTH_MM / 2);
    // 下段は左にPL、右にPB
    expect(boardTerminalPos(board, 'PL4.+').x).toBeLessThan(boardTerminalPos(board, 'PB1.c').x);
  });

  it('PB／PL本体端子は配線できず、端子台とP/Nは配線できる（§6.4）', () => {
    expect(findBoardTerminal(board, 'PB1.c')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'PL1.+')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'CB.1')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'PS.+')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'TB_PB.1c')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'P.1')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'S7.14')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'S8.14')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'BZ.+')?.optional).toBe(true);
    expect(findBoardTerminal(board, 'XX.1')).toBeUndefined();
    expect(() => boardTerminalPos(board, 'XX.1')).toThrow(BoardError);
  });

  it('本体端子は盤の裏（z が負）にある（§6.4）', () => {
    expect(boardTerminalPos(board, 'PL1.+').z).toBeLessThan(0);
    expect(boardTerminalPos(board, 'PB1.c').z).toBeLessThan(0);
    expect(boardTerminalPos(board, 'TB_PL.1+').z).toBeGreaterThan(0);
  });

  it('チェック用ソケットの既設固定配線は3本・青で §6.3 の端子どおり（CHK は S7）', () => {
    expect(board.fixedWires).toHaveLength(3);
    expect(board.fixedWires.every((w) => w.color === '青')).toBe(true);
    const pairs = board.fixedWires.map(
      (w) => `${resolveEndpoint(w.from)}->${resolveEndpoint(w.to)}`,
    );
    expect(pairs).toEqual(['P.1->TB_PB.4c', 'TB_PB.4a->S7.14', 'S7.13->N.1']);
  });

  it('既設リンクは P/N 2本＋PB 12本＋PL 8本＝22本（§6.4 / 写真）', () => {
    expect(board.fixedLinks).toHaveLength(22);
    const ids = board.fixedLinks.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(board.fixedLinks.filter((l) => l.id.startsWith('lk-pb-'))).toHaveLength(12);
    expect(board.fixedLinks.filter((l) => l.id.startsWith('lk-pl-'))).toHaveLength(8);
    expect(board.fixedLinks.every((l) => l.color === '青')).toBe(true);
    expect(board.fixedLinks[0]).toEqual({
      id: 'lk-ps-p',
      from: 'PS.+',
      to: 'P.1',
      color: '青',
    });
  });

  it('差込穴は14個（2列×7段）で本体中央にある（§6.2）', () => {
    const holes = socketPinHoleOffsets();
    expect(holes).toHaveLength(14);
    expect(new Set(holes.map((h) => h.dx)).size).toBe(2);
    expect(new Set(holes.map((h) => h.dy)).size).toBe(7);
    for (const h of holes) {
      expect(h.dy).toBeGreaterThanOrEqual(SOCKET_SLOT_INSET_MM);
      expect(h.dy).toBeLessThanOrEqual(SOCKET_BODY_LENGTH_MM - SOCKET_SLOT_INSET_MM);
    }
  });

  it('ソケット本体の外形を引ける', () => {
    expect(socketBodyRect(board, 'S1')).toEqual({ x0: 28, y0: 60, x1: 58, y1: 136 });
    expect(socketBodyRect(board, 'S9' as 'S1')).toBeUndefined();
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
import { vec3, type Rect, type Vec3 } from './geometry.js';

/**
 * 標準盤 `board-jipm-std` の定義データ。設計仕様 §6.1〜§6.6、調査資料 §2.1〜§2.2 / §3.1 / §3.5。
 *
 * 実物の写真（`docs/reference/K96-CS3-board-photo.png`、OMRON「電気系保全作業練習器 形 K96-CS3」）に
 * 合わせて配置を決めている。写真から読めない寸法はすべて**本アプリ既定（写真からの推定）**であり、
 * 根拠は計画書 Task 4 の表に記す。
 *
 * 形状は**傾斜コンソール**（手前が低く奥が高い）。盤面そのものは平面なので座標は従来どおり
 * 「盤面上の (x, y) ＋ 盤面からの高さ z」の 2.5D で持ち、傾斜と立ち上がりは `console` に
 * メタデータとして持たせて3D側が使う。
 */

/** 盤面（傾斜した操作面）の幅[mm]。 */
export const BOARD_WIDTH_MM = 330;
/** 盤面の奥行[mm]（傾斜面に沿った長さ。奥=0、手前=この値）。 */
export const BOARD_HEIGHT_MM = 245;
/** 筐体の厚み[mm]。 */
export const BOARD_DEPTH_MM = 50;
/** 端子の当たり判定半径[mm]。§6.5 */
export const TERMINAL_PICK_RADIUS_MM = 4;
/**
 * P/N供給端子の本数。実物（写真）の DC24V 供給端子台は **P×1・N×1 の2点**しかないので1本ずつ。
 * 仕様 §6.1 の表は6本ずつとしているが、実機に合わせる（§11.3 の母線割当は渡り配線で対応する）。
 */
export const SUPPLY_TERMINAL_COUNT = 1;

/** ソケット本体の幅[mm]（PYF14A相当＋取付の遊び）。 */
export const SOCKET_BODY_WIDTH_MM = 30;
/** ソケット本体の奥行[mm]（奥のネジ端子ティアから手前のティアまでを含む全長）。 */
export const SOCKET_BODY_LENGTH_MM = 76;
/** 14ピンソケットの取付ピッチ[mm]（本体幅＋隣との隙間2mm）。 */
export const SOCKET_PITCH_MM = 32;
/** ソケットのネジ端子の列ピッチ[mm]（4列）。 */
export const SOCKET_COL_PITCH_MM = 9;
/** ソケット本体の端から最初のネジ端子列までの奥行方向の距離[mm]。 */
export const SOCKET_TIER_INSET_MM = 6;
/** 同じティア内のネジ端子の段ピッチ[mm]（当たり判定半径4mmが重ならない最小値）。 */
export const SOCKET_TIER_ROW_PITCH_MM = 8;
/** 本体中央の差込穴領域の、本体端からの奥行方向の距離[mm]。 */
export const SOCKET_SLOT_INSET_MM = 22;
/** 差込穴（14ピン）の列ピッチ[mm]（2列）。本アプリ既定。 */
export const SOCKET_PIN_HOLE_COL_PITCH_MM = 12;
/** 差込穴（14ピン）の段ピッチ[mm]（7段）。本アプリ既定。 */
export const SOCKET_PIN_HOLE_ROW_PITCH_MM = 5;
/** 端子台のネジ端子ピッチ[mm]。 */
export const BLOCK_PITCH_MM = 9;
/** ソケットのネジ端子の盤面からの高さ[mm]。 */
export const SOCKET_TERMINAL_Z_MM = 10;
/** 端子台のネジ端子の盤面からの高さ[mm]。 */
export const BLOCK_TERMINAL_Z_MM = 8;
/** PB／PL本体端子の盤面からの高さ[mm]（盤の裏側にあるため負）。§6.4 */
export const BODY_TERMINAL_Z_MM = -12;
/** 機器の根元（盤面の貫通穴）から機器中心までの距離[mm]（穴は機器の奥側にある）。 */
export const PANEL_HOLE_OFFSET_MM = 11;
/** 貫通穴に入る既設配線どうしの間隔[mm]。 */
export const HARNESS_PITCH_MM = 2;
/** 貫通穴の手前で既設配線が横に寄る位置（穴からの距離[mm]）。 */
export const HARNESS_APPROACH_MM = 7;
/** 電線が盤面上を走る高さ[mm]（配線帯の中の高さ）。 */
export const WIRE_RUN_Z_MM = 3.5;

/** 傾斜コンソールの形状メタデータ（3D側が筐体を描くために使う）。 */
export interface ConsoleShape {
  /** 盤面の傾斜角[度]（手前下がり）。 */
  slopeDeg: number;
  /** 手前端の机上高さ[mm]（＝筐体の厚み）。 */
  frontHeightMm: number;
  /** 奥端の机上高さ[mm]。`frontHeightMm + 奥行 × sin(slopeDeg)` と一致する。 */
  rearHeightMm: number;
}

/** 物理ソケットID（盤上の位置で決まる。役割の割当は roles.ts）。左クラスタ S1〜S4／右クラスタ S5〜S8。 */
export type SocketId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8';

/** 物理ソケットIDの並び（左クラスタ4個 → 右クラスタ4個）。 */
export const SOCKET_IDS: readonly SocketId[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];

/** 押ボタンの色。§5.3.3 */
export type PushButtonColor = '黒' | '黄' | '緑' | '赤';

/** 端子の役割。§6.6 の `role` のうち Phase 1 の盤で使うもの。 */
export type TerminalRole =
  'coil+' | 'coil-' | 'com' | 'no' | 'nc' | '+' | '-' | 'c' | 'a' | 'b' | 'ac';

/** 盤上の1端子。 */
export interface BoardTerminal {
  /** 物理端子ID。ソケットは `S1.13` のように**物理**ソケットIDで持つ（役割IDへの変換は roles.ts）。 */
  id: TerminalId;
  /** ツールチップ用の表示名（例: `S1 ⑨ com`）。§8.2 */
  label: string;
  role: TerminalRole;
  pos: Vec3;
  pickRadiusMm: number;
  /** 訓練者が配線してよい端子か。PB／PL本体端子・ブレーカ・スイッチ・電源内部端子は false。§6.4 */
  wirable: boolean;
  /** 既定の盤には無く、課題の `extraParts` で追加したときだけ使える端子（BZ）。§5.3.4 */
  optional: boolean;
  /**
   * 端子から電線を引き出す向き（盤面の奥行方向）。
   * ソケットのネジ端子は本体の上端／下端に寄っているので向きが決まっている（上ティア=`rear`、
   * 下ティア=`front`）。端子台・P/N・本体端子は空いている側へ出せるので `either`。
   */
  exit: 'rear' | 'front' | 'either';
}

/** 14ピンソケットの定義。 */
export interface SocketDefinition {
  id: SocketId;
  kind: 'socket-14pin';
  /** 左右どちらのクラスタか（写真の2つのDINレール群に対応）。 */
  cluster: 'left' | 'right';
  /** 本体の左奥の角（盤面上）。ネジ端子と差込穴はここからの相対位置で決まる。 */
  origin: Vec3;
  /** 本体の外形[mm]（3Dのモデルと、配線が本体上を横切らないことの検査に使う）。 */
  bodyMm: { width: number; length: number };
}

/** 押ボタン本体の定義。 */
export interface PushButtonDefinition {
  id: PartId;
  color: PushButtonColor;
  /** 盤面の銘板表記（写真では `PBS1`〜`PBS4`）。部品IDは §6.4 の `PB1`〜`PB4` を使う。 */
  panelLabel: string;
  pos: Vec3;
  /** 既設配線が盤面を抜ける貫通穴（機器の奥側の根元）。写真ではここに青線が集まる。 */
  panelHole: Vec3;
}

/** 表示灯本体の定義。 */
export interface LampDefinition {
  id: PartId;
  color: LampColor;
  panelLabel: string;
  pos: Vec3;
  /** 既設配線が盤面を抜ける貫通穴（機器の奥側の根元）。 */
  panelHole: Vec3;
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

/**
 * 既設の0Ωリンク（PB／PL本体と端子台の間、P/N供給端子どうし）。§6.4
 * 写真では PB／PL の本体から端子台へ**青線**のハーネスが走っている。電気的には0Ωの内部結線として
 * 扱う（故障注入の対象外・端子の本数制限にも数えない。§6.3 / §6.4）が、3Dで描けるように色を持つ。
 */
export interface FixedLink {
  id: string;
  from: TerminalId;
  to: TerminalId;
  color: WireColor;
}

/**
 * 配線帯（見えないガイド）。電線はここを直角に走る。§6.6
 * `axis: 'x'` なら y = `at` の水平帯で、x が `from`〜`to` の範囲を走る。
 * `axis: 'y'` なら x = `at` の垂直帯で、y が `from`〜`to` の範囲を走る。
 */
export interface WiringChannel {
  id: string;
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  zMm: number;
}

/** 盤上の部品が占める領域（盤面への投影）。配線はこの内側を通ってはならない。§6.6 */
export interface Footprint extends Rect {
  id: string;
  kind: 'socket' | 'block' | 'lamp' | 'button' | 'breaker' | 'switch' | 'supply';
}

/** 盤の定義データ。 */
export interface BoardDefinition {
  id: string;
  displayName: string;
  sizeMm: { width: number; height: number; depth: number };
  /** 傾斜コンソールの形状。 */
  console: ConsoleShape;
  sockets: readonly SocketDefinition[];
  pushButtons: readonly PushButtonDefinition[];
  lamps: readonly LampDefinition[];
  supplyTerminalCount: number;
  terminals: readonly BoardTerminal[];
  /** 部品の占有領域。配線はこの内側を通ってはならない。§6.6 */
  footprints: readonly Footprint[];
  /** 配線の自動経路が走る帯。占有領域と重ならない位置にだけ引く。§6.6 */
  wiringChannels: readonly WiringChannel[];
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

/** 端子の役割の印字（ソケットのネジ端子の銘板表記）。 */
export function roleLabel(role: TerminalRole): string {
  switch (role) {
    case 'coil+':
      return '+';
    case 'coil-':
      return '−';
    case 'com':
      return 'COM';
    case 'no':
      return 'a';
    case 'nc':
      return 'b';
    default:
      return role;
  }
}

function terminal(
  id: TerminalId,
  label: string,
  role: TerminalRole,
  pos: Vec3,
  wirable: boolean,
  exit: BoardTerminal['exit'] = 'either',
  optional = false,
): BoardTerminal {
  return { id, label, role, pos, pickRadiusMm: TERMINAL_PICK_RADIUS_MM, wirable, exit, optional };
}

/** ソケット本体の外形（盤面上の矩形）。配線が本体を横切らないことの検査に使う。 */
export function socketBodyRect(
  board: BoardDefinition,
  socketId: SocketId,
): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const socket = board.sockets.find((s) => s.id === socketId);
  if (socket === undefined) return undefined;
  return {
    x0: socket.origin.x,
    y0: socket.origin.y,
    x1: socket.origin.x + socket.bodyMm.width,
    y1: socket.origin.y + socket.bodyMm.length,
  };
}

/**
 * ソケットのネジ端子の位置。本体の左奥の角からの相対座標[mm]。
 * 段1・段2は本体の**奥端**に、段3・段4は**手前端**に寄っており、中央は差込穴の領域になる。
 */
export function socketPinOffset(rowIndex: number, colIndex: number): { dx: number; dy: number } {
  const dx = (SOCKET_BODY_WIDTH_MM - 3 * SOCKET_COL_PITCH_MM) / 2 + colIndex * SOCKET_COL_PITCH_MM;
  const dy =
    rowIndex <= 1
      ? SOCKET_TIER_INSET_MM + rowIndex * SOCKET_TIER_ROW_PITCH_MM
      : SOCKET_BODY_LENGTH_MM - SOCKET_TIER_INSET_MM - (3 - rowIndex) * SOCKET_TIER_ROW_PITCH_MM;
  return { dx, dy };
}

/** そのネジ端子の段が本体のどちら端にあるか（電線の引き出し向き）。 */
export function socketRowExit(rowIndex: number): 'rear' | 'front' {
  return rowIndex <= 1 ? 'rear' : 'front';
}

/** 差込穴（14ピン、2列×7段）の中心座標。本体の左奥の角からの相対座標[mm]。 */
export function socketPinHoleOffsets(): Array<{ dx: number; dy: number }> {
  const out: Array<{ dx: number; dy: number }> = [];
  const slotLength = SOCKET_BODY_LENGTH_MM - 2 * SOCKET_SLOT_INSET_MM;
  const y0 = SOCKET_SLOT_INSET_MM + (slotLength - 6 * SOCKET_PIN_HOLE_ROW_PITCH_MM) / 2;
  const x0 = (SOCKET_BODY_WIDTH_MM - SOCKET_PIN_HOLE_COL_PITCH_MM) / 2;
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      out.push({
        dx: x0 + col * SOCKET_PIN_HOLE_COL_PITCH_MM,
        dy: y0 + row * SOCKET_PIN_HOLE_ROW_PITCH_MM,
      });
    }
  }
  return out;
}

/** ソケット本体の奥端のY座標[mm]。 */
const SOCKET_Y_MM = 60;
/** 左クラスタ（S1〜S4）の左端X座標[mm]。 */
const LEFT_CLUSTER_X_MM = 28;
/** 右クラスタ（S5〜S8）の左端X座標[mm]。 */
const RIGHT_CLUSTER_X_MM = 180;

/** ソケット8個の本体左奥の角。写真の左右2クラスタ×4個に対応。 */
const SOCKET_ORIGINS: ReadonlyArray<{ id: SocketId; cluster: 'left' | 'right'; origin: Vec3 }> =
  SOCKET_IDS.map((id, index) => {
    const left = index < 4;
    const baseX = left ? LEFT_CLUSTER_X_MM : RIGHT_CLUSTER_X_MM;
    const slot = left ? index : index - 4;
    return {
      id,
      cluster: left ? ('left' as const) : ('right' as const),
      origin: vec3(baseX + slot * SOCKET_PITCH_MM, SOCKET_Y_MM, SOCKET_TERMINAL_Z_MM),
    };
  });

/** ランプ用端子台（8P）の左端端子のX座標[mm]。 */
const TB_PL_X_MM = 40;
/** ランプ用端子台の段のY座標[mm]。 */
const TB_PL_Y_MM = 168;
/** 押ボタン用端子台（12P）の左端端子のX座標[mm]。 */
const TB_PB_X_MM = 186;
/** 押ボタン用端子台の段のY座標[mm]（写真では PL 用より少し手前にある）。 */
const TB_PB_Y_MM = 184;
/** PL／PB本体の段のY座標[mm]。 */
const BODY_Y_MM = 225;
/** PL本体の取付ピッチ[mm]。 */
const LAMP_PITCH_MM = 24;
/** PB本体の取付ピッチ[mm]。 */
const PB_PITCH_MM = 21;
/** P/N供給端子の左端X座標[mm]。 */
const SUPPLY_X_MM = 20;
/** P（+24V）端子のY座標[mm]。 */
const P_Y_MM = 14;
/** N（0V）端子のY座標[mm]。 */
const N_Y_MM = 30;

/** PL本体4個（白・黄・緑・赤）。写真の銘板は `PL1`〜`PL4`。 */
const LAMP_DEFS: readonly LampDefinition[] = (['白', '黄', '緑', '赤'] as const).map(
  (color, index) => {
    const x = 49 + index * LAMP_PITCH_MM;
    return {
      id: partId(`PL${index + 1}`),
      color,
      panelLabel: `PL${index + 1}`,
      pos: vec3(x, BODY_Y_MM, 0),
      panelHole: vec3(x, BODY_Y_MM - PANEL_HOLE_OFFSET_MM, 0),
    };
  },
);

/** PB本体4個（黒・黄・緑・赤）。写真の銘板は `PBS1`〜`PBS4`、部品IDは §6.4 の `PB1`〜`PB4`。 */
const PUSH_BUTTON_DEFS: readonly PushButtonDefinition[] = (['黒', '黄', '緑', '赤'] as const).map(
  (color, index) => {
    const x = 212 + index * PB_PITCH_MM;
    return {
      id: partId(`PB${index + 1}`),
      color,
      panelLabel: `PBS${index + 1}`,
      pos: vec3(x, BODY_Y_MM, 0),
      panelHole: vec3(x, BODY_Y_MM - PANEL_HOLE_OFFSET_MM, 0),
    };
  },
);

function buildTerminals(): BoardTerminal[] {
  const out: BoardTerminal[] = [];

  // DC24V電源の内部端子（測定のみ。訓練者は配線しない）
  out.push(terminal(terminalId('PS', '+'), 'PS +24V', '+', vec3(12, P_Y_MM, 6), false));
  out.push(terminal(terminalId('PS', '-'), 'PS 0V', '-', vec3(12, N_Y_MM, 6), false));

  // P/N供給端子（DC24V供給端子台。内部で同電位。§6.1）
  for (let i = 1; i <= SUPPLY_TERMINAL_COUNT; i += 1) {
    const x = SUPPLY_X_MM + (i - 1) * BLOCK_PITCH_MM;
    out.push(
      terminal(
        terminalId('P', String(i)),
        `P${i}`,
        '+',
        vec3(x, P_Y_MM, BLOCK_TERMINAL_Z_MM),
        true,
        'front',
      ),
    );
  }
  for (let i = 1; i <= SUPPLY_TERMINAL_COUNT; i += 1) {
    const x = SUPPLY_X_MM + (i - 1) * BLOCK_PITCH_MM;
    out.push(
      terminal(
        terminalId('N', String(i)),
        `N${i}`,
        '-',
        vec3(x, N_Y_MM, BLOCK_TERMINAL_Z_MM),
        true,
        'front',
      ),
    );
  }

  // ブレーカ（写真右上の2極MCB）・電源スイッチ。AC一次側なので配線も測定もしない。§5.3.5
  out.push(terminal(terminalId('CB', '1'), 'CB 1', 'ac', vec3(286, P_Y_MM, 6), false));
  out.push(terminal(terminalId('CB', '2'), 'CB 2', 'ac', vec3(286, N_Y_MM, 6), false));
  out.push(terminal(terminalId('SW', '1'), 'SW 1', 'ac', vec3(310, P_Y_MM, 6), false));
  out.push(terminal(terminalId('SW', '2'), 'SW 2', 'ac', vec3(310, N_Y_MM, 6), false));

  // 14ピンソケット×8。ネジ端子は本体の奥端（段1・段2）と手前端（段3・段4）に2列ずつ。§6.2
  for (const socket of SOCKET_ORIGINS) {
    SOCKET_PIN_GRID.forEach((row, rowIndex) => {
      row.forEach((pin, colIndex) => {
        if (pin === undefined) return;
        const { dx, dy } = socketPinOffset(rowIndex, colIndex);
        const role = pinRole(pin);
        out.push(
          terminal(
            socketPinTerminal(socket.id, pin),
            `${circledNumber(pin)} ${roleLabel(role)}`,
            role,
            vec3(socket.origin.x + dx, socket.origin.y + dy, socket.origin.z),
            true,
            socketRowExit(rowIndex),
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
          `PL${n}${sign === '-' ? '−' : '+'}`,
          sign,
          vec3(x, TB_PL_Y_MM, BLOCK_TERMINAL_Z_MM),
          true,
          'rear',
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
          `PB${n} ${sign}`,
          sign,
          vec3(x, TB_PB_Y_MM, BLOCK_TERMINAL_Z_MM),
          true,
          'rear',
        ),
      );
    }
  }

  // PL本体（端子は機器の根元・盤面のすぐ裏。測定と3D表示のためだけに存在する。§6.4）
  LAMP_DEFS.forEach((lamp) => {
    (['+', '-'] as const).forEach((sign, index) => {
      out.push(
        terminal(
          terminalId(lamp.id, sign),
          `${lamp.panelLabel} ${sign === '-' ? '−' : '+'}`,
          sign,
          vec3(lamp.panelHole.x + (index - 0.5) * HARNESS_PITCH_MM, lamp.pos.y, BODY_TERMINAL_Z_MM),
          false,
          'rear',
        ),
      );
    });
  });

  // PB本体（端子は機器の根元・盤面のすぐ裏。§6.4）
  PUSH_BUTTON_DEFS.forEach((pb) => {
    (['c', 'a', 'b'] as const).forEach((sign, index) => {
      out.push(
        terminal(
          terminalId(pb.id, sign),
          `${pb.panelLabel} ${sign}`,
          sign,
          vec3(pb.panelHole.x + (index - 1) * HARNESS_PITCH_MM, pb.pos.y, BODY_TERMINAL_Z_MM),
          false,
          'rear',
        ),
      );
    });
  });

  // BZ（任意部品。課題の extraParts で追加したときだけ使える。§5.3.4）
  out.push(
    terminal(
      terminalId('BZ', '+'),
      'BZ +',
      '+',
      vec3(120, TB_PL_Y_MM, BLOCK_TERMINAL_Z_MM),
      true,
      'either',
      true,
    ),
  );
  out.push(
    terminal(
      terminalId('BZ', '-'),
      'BZ −',
      '-',
      vec3(130, TB_PL_Y_MM, BLOCK_TERMINAL_Z_MM),
      true,
      'either',
      true,
    ),
  );

  return out;
}

/**
 * 配線帯（§6.6）。写真の盤にはダクトが無く電線は盤面を直接走るので、
 * 機器の列と列の**あいだ**に見えないガイドを引き、電線はここを直角に走る。
 * 水平帯は「P/N列とソケット列の間」「ソケット列と端子台列の間」「端子台列とPL/PB列の間」、
 * 垂直帯は「左右の余白」と「左右ソケットクラスタの間」。
 */
const WIRING_CHANNELS: readonly WiringChannel[] = [
  { id: 'ch-top', axis: 'x', at: 42, from: 10, to: 322, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-mid', axis: 'x', at: 142, from: 10, to: 322, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-low', axis: 'x', at: 198, from: 10, to: 322, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-left', axis: 'y', at: 10, from: 42, to: 198, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-gap', axis: 'y', at: 159, from: 42, to: 198, zMm: WIRE_RUN_Z_MM },
  { id: 'ch-right', axis: 'y', at: 322, from: 42, to: 198, zMm: WIRE_RUN_Z_MM },
];

/**
 * レーンを伸ばす向き（`+1` は x/y の増える側）。占有領域のない側へ伸ばす。§6.6
 * 帯ごとに固定なので、レーン割当は決定論になる。
 */
export const CHANNEL_LANE_DIRECTION: Readonly<Record<string, 1 | -1>> = {
  'ch-top': 1,
  'ch-mid': 1,
  'ch-low': 1,
  'ch-left': 1,
  'ch-gap': 1,
  'ch-right': -1,
};

/** 部品の占有領域。配線帯はこれらと重ならない位置に置いてある。§6.6 */
function buildFootprints(): Footprint[] {
  const out: Footprint[] = [];
  out.push({ id: 'supply', kind: 'supply', x: 12, y: 6, w: 26, h: 30 });
  out.push({ id: 'CB', kind: 'breaker', x: 276, y: 6, w: 26, h: 30 });
  out.push({ id: 'SW', kind: 'switch', x: 302, y: 6, w: 20, h: 30 });
  for (const socket of SOCKET_ORIGINS) {
    out.push({
      id: socket.id,
      kind: 'socket',
      x: socket.origin.x,
      y: socket.origin.y,
      w: SOCKET_BODY_WIDTH_MM,
      h: SOCKET_BODY_LENGTH_MM,
    });
  }
  out.push({
    id: 'TB_PL',
    kind: 'block',
    x: TB_PL_X_MM - 5,
    y: TB_PL_Y_MM - 10,
    w: 7 * BLOCK_PITCH_MM + 10,
    h: 20,
  });
  out.push({
    id: 'TB_PB',
    kind: 'block',
    x: TB_PB_X_MM - 5,
    y: TB_PB_Y_MM - 8,
    w: 11 * BLOCK_PITCH_MM + 10,
    h: 16,
  });
  out.push({ id: 'BZ', kind: 'block', x: 114, y: TB_PL_Y_MM - 10, w: 22, h: 20 });
  for (const lamp of LAMP_DEFS) {
    out.push({ id: lamp.id, kind: 'lamp', x: lamp.pos.x - 10, y: lamp.pos.y - 10, w: 20, h: 20 });
  }
  for (const pb of PUSH_BUTTON_DEFS) {
    out.push({ id: pb.id, kind: 'button', x: pb.pos.x - 9, y: pb.pos.y - 9, w: 18, h: 18 });
  }
  return out;
}

/**
 * チェック用ソケットの既設固定配線（§6.3）。
 * `P.1 → TB_PB.4c` / `TB_PB.4a → CHK.14` / `CHK.13 → N.1` の3本。
 * PB4本体ではなく押ボタン用端子台側に接続する（盤上で配線できる端子は端子台側のため）。
 * チェック用ソケットは既定の役割割当（roles.ts）で `S7` に割り当てられる。
 */
const CHECK_SOCKET: SocketId = 'S7';

const FIXED_WIRES: readonly FixedWire[] = [
  {
    id: 'fw-chk-1',
    from: { kind: 'terminal', id: terminalId('P', '1') },
    to: { kind: 'terminal', id: terminalId('TB_PB', '4c') },
    color: '青',
  },
  {
    id: 'fw-chk-2',
    from: { kind: 'terminal', id: terminalId('TB_PB', '4a') },
    to: { kind: 'socket', socket: CHECK_SOCKET, pin: 14 },
    color: '青',
  },
  {
    id: 'fw-chk-3',
    from: { kind: 'socket', socket: CHECK_SOCKET, pin: 13 },
    to: { kind: 'terminal', id: terminalId('N', '1') },
    color: '青',
  },
];

function buildFixedLinks(): FixedLink[] {
  const out: FixedLink[] = [];
  // DC24V電源 → P/N供給端子（供給端子は実機どおり P.1 / N.1 の1点ずつ）
  out.push({ id: 'lk-ps-p', from: terminalId('PS', '+'), to: terminalId('P', '1'), color: '青' });
  for (let i = 1; i < SUPPLY_TERMINAL_COUNT; i += 1) {
    out.push({
      id: `lk-p-${i}`,
      from: terminalId('P', String(i)),
      to: terminalId('P', String(i + 1)),
      color: '青',
    });
  }
  out.push({ id: 'lk-ps-n', from: terminalId('PS', '-'), to: terminalId('N', '1'), color: '青' });
  for (let i = 1; i < SUPPLY_TERMINAL_COUNT; i += 1) {
    out.push({
      id: `lk-n-${i}`,
      from: terminalId('N', String(i)),
      to: terminalId('N', String(i + 1)),
      color: '青',
    });
  }
  // PB本体 ↔ 押ボタン用端子台（12本の青線ハーネス）。§6.4
  PUSH_BUTTON_DEFS.forEach((pb, index) => {
    for (const sign of ['c', 'a', 'b'] as const) {
      out.push({
        id: `lk-pb-${index + 1}${sign}`,
        from: terminalId(pb.id, sign),
        to: terminalId('TB_PB', `${index + 1}${sign}`),
        color: '青',
      });
    }
  });
  // PL本体 ↔ ランプ用端子台（8本の青線ハーネス）。§6.4
  LAMP_DEFS.forEach((lamp, index) => {
    for (const sign of ['+', '-'] as const) {
      out.push({
        id: `lk-pl-${index + 1}${sign}`,
        from: terminalId(lamp.id, sign),
        to: terminalId('TB_PL', `${index + 1}${sign}`),
        color: '青',
      });
    }
  });
  return out;
}

/** 盤面の傾斜（本アプリ既定・写真からの推定）。 */
const CONSOLE_SHAPE: ConsoleShape = {
  slopeDeg: 13,
  frontHeightMm: BOARD_DEPTH_MM,
  rearHeightMm:
    Math.round((BOARD_DEPTH_MM + BOARD_HEIGHT_MM * Math.sin((13 * Math.PI) / 180)) * 10) / 10,
};

/** 標準盤（OMRON K96-CS3 相当）。 */
export const JIPM_BOARD: BoardDefinition = {
  id: 'board-jipm-std',
  displayName: '電気系保全作業練習器（K96-CS3 相当）',
  sizeMm: { width: BOARD_WIDTH_MM, height: BOARD_HEIGHT_MM, depth: BOARD_DEPTH_MM },
  console: CONSOLE_SHAPE,
  sockets: SOCKET_ORIGINS.map((s) => ({
    id: s.id,
    kind: 'socket-14pin',
    cluster: s.cluster,
    origin: s.origin,
    bodyMm: { width: SOCKET_BODY_WIDTH_MM, length: SOCKET_BODY_LENGTH_MM },
  })),
  pushButtons: PUSH_BUTTON_DEFS,
  lamps: LAMP_DEFS,
  supplyTerminalCount: SUPPLY_TERMINAL_COUNT,
  terminals: buildTerminals(),
  footprints: buildFootprints(),
  wiringChannels: WIRING_CHANNELS,
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
  CHANNEL_LANE_DIRECTION,
  circledNumber,
  findBoardTerminal,
  HARNESS_APPROACH_MM,
  HARNESS_PITCH_MM,
  JIPM_BOARD,
  loadBoard,
  PANEL_HOLE_OFFSET_MM,
  pinRole,
  resolveEndpoint,
  roleLabel,
  SOCKET_BODY_LENGTH_MM,
  SOCKET_BODY_WIDTH_MM,
  SOCKET_COL_PITCH_MM,
  SOCKET_IDS,
  SOCKET_PIN_GRID,
  SOCKET_PIN_HOLE_COL_PITCH_MM,
  SOCKET_PIN_HOLE_ROW_PITCH_MM,
  SOCKET_PITCH_MM,
  SOCKET_SLOT_INSET_MM,
  SOCKET_TERMINAL_Z_MM,
  SOCKET_TIER_INSET_MM,
  SOCKET_TIER_ROW_PITCH_MM,
  socketBodyRect,
  socketPinHoleOffsets,
  socketPinOffset,
  socketPinTerminal,
  socketRowExit,
  SUPPLY_TERMINAL_COUNT,
  TERMINAL_PICK_RADIUS_MM,
  WIRE_RUN_Z_MM,
  type BoardDefinition,
  type BoardEndpoint,
  type BoardTerminal,
  type ConsoleShape,
  type FixedLink,
  type FixedWire,
  type Footprint,
  type LampDefinition,
  type PushButtonColor,
  type PushButtonDefinition,
  type SocketDefinition,
  type SocketId,
  type TerminalRole,
  type WiringChannel,
} from './board-jipm.js';
```

- [ ] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/board-model test -- board.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): add board definition matching the K96-CS3 photo

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

盤は物理ソケット `S1`〜`S8` を持ち、課題がそれぞれに役割（`CR1`〜`CR4` / `T1` / `T2` / `CHK`）を
割り当てる（§6.1）。**役割名がそのまま circuit-sim の部品IDになる**ので、端子IDは `CR1.13` のように
なる（§6.4）。この写像を担うのがこのファイルで、盤の幾何（`S1.13`）と回路の論理（`CR1.13`）の
橋渡しをする。

**役割が7つ・ソケットが8個であること**への対応:

| 論点 | 決定 | 理由 |
|---|---|---|
| 「役割なし」の表し方 | `SocketRoles` を `Partial` にして、予備ソケットはキーごと**欠落**させる | 役割名はそのまま部品IDとして端子IDに埋め込まれる（§6.4）。`'NONE'` のような番兵値を入れると `NONE.13` という意味のない端子IDが生まれ、割当・変換・検証のすべてで特別扱いが要る |
| 既定の割当 | `DEFAULT_SOCKET_ROLES` = S1〜S4 に `CR1`〜`CR4`、S5 に `T1`、S6 に `T2`、S7 に `CHK`、S8 は予備 | ソケットが8個あるので §6.1 の7役割をすべて同時に載せられる。MY4N と H3Y-4 はピン互換（調査資料 §3.3）なので、どのソケットにどちらを挿しても電気的には成立する |
| §6.1 の課題1形式・課題2形式 | `TASK1_SOCKET_ROLES` / `TASK2_SOCKET_ROLES` として残す。割り当てないソケットは予備になる | 検定の盤（ソケット5個）と同じ制約で練習したい課題のために残す |
| 予備ソケット | 端子は存在し配線もできる。部品を挿すと**物理ソケットIDが部品ID**になる（`S8.14` など） | 「余りは役割なしの予備として定義し、端子だけ存在し配線可」という要件をそのまま満たす |

- [ ] 失敗するテストを書く。`packages/board-model/test/roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  DEFAULT_SOCKET_ROLES,
  hasRole,
  isSocketId,
  isSocketRole,
  roleOf,
  RoleError,
  socketOf,
  socketPartId,
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

  it('既定の割当は7役割すべてを載せ、S8 を予備にする（ソケットは8個）', () => {
    expect(DEFAULT_SOCKET_ROLES).toEqual({
      S1: 'CR1',
      S2: 'CR2',
      S3: 'CR3',
      S4: 'CR4',
      S5: 'T1',
      S6: 'T2',
      S7: 'CHK',
    });
    expect(validateSocketRoles(DEFAULT_SOCKET_ROLES)).toEqual([]);
    expect(roleOf(DEFAULT_SOCKET_ROLES, 'S8')).toBeUndefined();
    expect(socketPartId(DEFAULT_SOCKET_ROLES, 'S1')).toBe('CR1');
    expect(socketPartId(DEFAULT_SOCKET_ROLES, 'S8')).toBe('S8');
  });

  it('課題1形式・課題2形式の割当は妥当（§6.1）。残りは予備', () => {
    expect(TASK1_SOCKET_ROLES).toEqual({
      S1: 'CR1',
      S2: 'CR2',
      S3: 'CR3',
      S4: 'CR4',
      S7: 'CHK',
    });
    expect(TASK2_SOCKET_ROLES).toEqual({
      S1: 'CR1',
      S2: 'CR2',
      S5: 'T1',
      S6: 'T2',
      S7: 'CHK',
    });
    expect(validateSocketRoles(TASK1_SOCKET_ROLES)).toEqual([]);
    expect(validateSocketRoles(TASK2_SOCKET_ROLES)).toEqual([]);
    expect(roleOf(TASK1_SOCKET_ROLES, 'S5')).toBeUndefined();
  });

  it('重複・CHK欠落・不正な役割名を検出する', () => {
    const duplicated: SocketRoles = { S1: 'CR1', S2: 'CR1', S5: 'T1', S6: 'T2', S7: 'CHK' };
    expect(validateSocketRoles(duplicated)).toContain('役割が重複しています: CR1');
    const noCheck: SocketRoles = { S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S5: 'T1' };
    expect(validateSocketRoles(noCheck)).toContain(
      'チェック用ソケット（CHK）が割り当てられていません',
    );
    const broken = {
      S1: 'XX',
      S2: 'CR2',
      S7: 'CHK',
    } as unknown as SocketRoles;
    expect(validateSocketRoles(broken)[0]).toBe('S1 の役割が不正です: XX');
    const strange = { S1: 'CR1', S7: 'CHK', S9: 'CR2' } as unknown as SocketRoles;
    expect(validateSocketRoles(strange)).toContain('盤に無いソケットIDです: S9');
  });

  it('物理端子IDと役割端子IDを相互変換する', () => {
    expect(toPhysicalTerminal(TASK2_SOCKET_ROLES, t('T1.9'))).toBe('S5.9');
    expect(toNetlistTerminal(TASK2_SOCKET_ROLES, t('S5.9'))).toBe('T1.9');
    expect(toPhysicalTerminal(TASK1_SOCKET_ROLES, t('TB_PB.1a'))).toBe('TB_PB.1a');
    expect(toNetlistTerminal(TASK1_SOCKET_ROLES, t('P.1'))).toBe('P.1');
    expect(toPhysicalTerminal(TASK1_SOCKET_ROLES, t('CHK.14'))).toBe('S7.14');
    // 予備ソケットの端子は変換されずそのまま残る
    expect(toNetlistTerminal(DEFAULT_SOCKET_ROLES, t('S8.13'))).toBe('S8.13');
  });

  it('割当の照会', () => {
    expect(socketOf(TASK2_SOCKET_ROLES, 'T2')).toBe('S6');
    expect(roleOf(TASK1_SOCKET_ROLES, 'S7')).toBe('CHK');
    expect(hasRole(TASK1_SOCKET_ROLES, 'T1')).toBe(false);
    expect(() => socketOf(TASK1_SOCKET_ROLES, 'T1')).toThrow(RoleError);
    expect(isSocketRole('CR4')).toBe(true);
    expect(isSocketRole('CR9')).toBe(false);
    expect(isSocketId('S8')).toBe(true);
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
 *
 * 実物（写真）はソケットを8個持つが、仕様 §6.1 の役割は7つ（`CR1`〜`CR4` / `T1` / `T2` / `CHK`）しか
 * 無い。余ったソケットは**役割なしの予備**とし、`SocketRoles` から単に欠落させる。
 * 予備ソケットは端子だけが存在して配線でき、部品を挿せば物理ソケットID（`S8`）が部品IDになる。
 * 「役割なし」を `'NONE'` のような番兵値で表さないのは、役割名がそのまま部品IDとして端子IDに
 * 埋め込まれる規約（§6.4）のもとでは、番兵値が `NONE.13` という意味のない端子IDを生んでしまうため。
 */

/** ソケットに割り当てられる役割。 */
export type SocketRole = 'CR1' | 'CR2' | 'CR3' | 'CR4' | 'T1' | 'T2' | 'CHK';

/** 物理ソケットID → 役割。欠落しているソケットは役割なしの予備。 */
export type SocketRoles = Readonly<Partial<Record<SocketId, SocketRole>>>;

/** チェック用ソケットの役割名。§6.3 */
export const CHECK_SOCKET_ROLE: SocketRole = 'CHK';

/**
 * 既定の役割割当。ソケットが8個あるので §6.1 の7役割をすべて同時に載せられる。
 * 左クラスタ（S1〜S4）にCR、右クラスタの S5・S6 にタイマ、S7 をチェック用、S8 を予備とする。
 */
export const DEFAULT_SOCKET_ROLES: SocketRoles = {
  S1: 'CR1',
  S2: 'CR2',
  S3: 'CR3',
  S4: 'CR4',
  S5: 'T1',
  S6: 'T2',
  S7: 'CHK',
};

/** 課題1形式（CR4個＋チェック用）。§6.1。残りのソケットは予備。 */
export const TASK1_SOCKET_ROLES: SocketRoles = {
  S1: 'CR1',
  S2: 'CR2',
  S3: 'CR3',
  S4: 'CR4',
  S7: 'CHK',
};

/** 課題2形式（CR2個＋T2個＋チェック用）。§6.1。残りのソケットは予備。 */
export const TASK2_SOCKET_ROLES: SocketRoles = {
  S1: 'CR1',
  S2: 'CR2',
  S5: 'T1',
  S6: 'T2',
  S7: 'CHK',
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
    if (role === undefined) continue; // 役割なしの予備ソケット
    if (!isSocketRole(role)) {
      errors.push(`${socket} の役割が不正です: ${String(role)}`);
      continue;
    }
    if (seen.has(role)) errors.push(`役割が重複しています: ${role}`);
    seen.add(role);
  }
  for (const key of Object.keys(roles)) {
    if (!isSocketId(key)) errors.push(`盤に無いソケットIDです: ${key}`);
  }
  if (!seen.has(CHECK_SOCKET_ROLE)) {
    errors.push('チェック用ソケット（CHK）が割り当てられていません');
  }
  return errors;
}

/** その役割が割り当てられた物理ソケットID。無ければ RoleError。 */
export function socketOf(roles: SocketRoles, role: SocketRole): SocketId {
  const hit = SOCKET_IDS.find((socket) => roles[socket] === role);
  if (hit === undefined) throw new RoleError(`割り当てられていない役割です: ${role}`);
  return hit;
}

/** その物理ソケットの役割。予備ソケットは undefined。 */
export function roleOf(roles: SocketRoles, socket: SocketId): SocketRole | undefined {
  return roles[socket];
}

/** その役割が割り当てられているか。 */
export function hasRole(roles: SocketRoles, role: SocketRole): boolean {
  return SOCKET_IDS.some((socket) => roles[socket] === role);
}

/**
 * ソケットに装着された部品のネットリスト上の部品ID。
 * 役割が割り当てられていれば役割名、予備ソケットなら物理ソケットIDをそのまま使う。§6.4
 */
export function socketPartId(roles: SocketRoles, socket: SocketId): string {
  return roles[socket] ?? socket;
}

/**
 * 物理端子ID（`S1.13`）を circuit-sim の端子ID（`CR1.13`）に変換する。
 * 予備ソケットとソケット以外の端子（`TB_PB.1a` / `P.1` など）はそのまま返す。
 */
export function toNetlistTerminal(roles: SocketRoles, physical: TerminalId): TerminalId {
  const parsed = parseTerminalId(physical);
  const part: string = parsed.part;
  if (!isSocketId(part)) return physical;
  const role = roles[part];
  if (role === undefined) return physical;
  return terminalId(role, parsed.name);
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
  DEFAULT_SOCKET_ROLES,
  hasRole,
  isSocketId,
  isSocketRole,
  roleOf,
  RoleError,
  socketOf,
  socketPartId,
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
feat(board-model): add socket role assignment for the 8-socket board

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

仕様 §6.6 の部品カタログのうち、**訓練者がソケットに装着できる部品だけ**を扱う。盤に固定されている
PB／PL／電源は装着対象ではないので、それらの定義は Task 4 の盤定義側にある。タイマのレンジは
§5.3.2 / §17.2 #12 の2種（0〜10s 既定・0〜60s）。

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

訓練者の作業状態（§8.2）を1つのプレーンオブジェクト `BoardSession` に集約する。設計上の要点は4つ。

1. **既設の固定配線（§6.3）を最初から `session.wires` に入れる**。こうすると「1端子2本まで」（§6.6）の計算がこの配列だけで完結し、`TB_PB.4c` / `TB_PB.4a` / `P.1` / `N.1` に残り1本しか張れないことが自動的に効く。
2. **PB／PL本体と端子台の間の青線ハーネス（写真）は `session.wires` に入れない**。§6.4 がこれを「0Ω相当のリンク」と定めており、電線として数えると端子台の全端子が最初から1本埋まってしまい §6.3 の「`TB_PB.4c` だけが残り1本」という前提が崩れる。3D用の色と経路は盤定義の `fixedLinks[].color` と `routeFixedLinks()` が受け持つ。
3. **失敗は例外ではなく Result で返す**。UIがそのまま理由を表示でき、`terminal-overload` を §5.6 #5 の危険操作として計上できる。
4. **PB／PL本体端子には配線させない**（§6.4）。盤定義の `wirable: false` を見て拒否する。

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
  it('生成時にチェック用ソケットの既設固定配線3本（青・locked）を持つ（§6.3）', () => {
    const s = session();
    expect(s.wires).toHaveLength(3);
    expect(s.wires.every((w) => w.locked && w.color === '青')).toBe(true);
    expect(s.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'P.1-TB_PB.4c',
      'TB_PB.4a-CHK.14',
      'CHK.13-N.1',
    ]);
    expect(s.allowedColors).toEqual(['青']);
    expect(s.boardId).toBe('board-jipm-std');
  });

  it('役割割当が不正ならセッションを作れない', () => {
    const broken: SocketRoles = { S1: 'CR1', S2: 'CR1', S7: 'CHK' };
    expect(() => createSession(board, { roles: broken })).toThrow(SessionError);
  });

  it('電線を張る／外す（§8.2）', () => {
    const s = session();
    const wire = added(addWire(s, board, t('P.1'), t('TB_PB.1c')));
    expect(wire.id).toBe('w-001');
    expect(wire.color).toBe('青');
    expect(wire.locked).toBe(false);
    // P.1 はチェック用の既設配線で1本使われているので、訓練者の1本と合わせて2本
    expect(wiresAt(s, t('P.1'))).toHaveLength(2);
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

  it('1端子2本まで。既設配線が1本ある端子には1本しか足せない（§6.3 / §6.6）', () => {
    const s = session();
    expect(wireCountAtTerminal(s, t('TB_PB.4c'))).toBe(1);
    expect(addWire(s, board, t('TB_PB.4c'), t('TB_PB.3c')).ok).toBe(true);
    const third = addWire(s, board, t('TB_PB.4c'), t('TB_PB.2c'));
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('unreachable');
    expect(third.code).toBe('terminal-overload');

    const free = session();
    expect(addWire(free, board, t('TB_PL.1+'), t('TB_PL.2+')).ok).toBe(true);
    expect(addWire(free, board, t('TB_PL.1+'), t('TB_PL.3+')).ok).toBe(true);
    const over = addWire(free, board, t('TB_PL.1+'), t('TB_PL.4+'));
    expect(over.ok).toBe(false);
    if (over.ok) throw new Error('unreachable');
    expect(over.code).toBe('terminal-overload');
  });

  it('パレット外の色・同一端子・配線不可端子・未知端子を拒否する（§6.4 / §8.1）', () => {
    const s = session();
    const color = addWire(s, board, t('P.1'), t('TB_PB.1c'), '白');
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
    const white = added(addWire(s, board, t('TB_PB.2b'), t('TB_PB.1c')));
    expect(white.color).toBe('白');
    const blue = addWire(s, board, t('TB_PB.2c'), t('TB_PB.1b'), '青');
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

    expect(plug(s, 'S5', 'timer-h3y4', { presetMs: 3000 }).ok).toBe(true);
    expect(plug(s, 'S6', 'timer-h3y4', { presetMs: 500, rangeMaxMs: 60_000 }).ok).toBe(true);
    const noStock = plug(s, 'S8', 'timer-h3y4');
    if (noStock.ok) throw new Error('unreachable');
    expect(noStock.code).toBe('inventory-exhausted');

    expect(s.mounted.S6).toEqual({ kind: 'timer-h3y4', presetMs: 500, rangeMaxMs: 60_000 });
    const removed = unplug(s, 'S1');
    expect(removed.ok).toBe(true);
    const again = unplug(s, 'S1');
    if (again.ok) throw new Error('unreachable');
    expect(again.code).toBe('socket-empty');
  });

  it('役割なしの予備ソケット（S8）にも部品を装着でき、端子に配線できる', () => {
    const s = session();
    expect(plug(s, 'S8', 'relay-my4n').ok).toBe(true);
    expect(s.mounted.S8).toEqual({ kind: 'relay-my4n' });
    expect(addWire(s, board, t('S8.14'), t('P.1')).ok).toBe(true);
  });

  it('タイマ設定はレンジの分解能に丸める（§5.3.2 / §8.2）', () => {
    const s = createSession(board, { roles: TASK2_SOCKET_ROLES });
    expect(plug(s, 'S5', 'timer-h3y4').ok).toBe(true);
    expect(s.mounted.S5).toEqual({ kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 });
    const updated = setPreset(s, 'S5', 5040);
    if (!updated.ok) throw new Error(updated.message);
    expect(updated.value).toEqual({ kind: 'timer-h3y4', presetMs: 5000, rangeMaxMs: 10_000 });
    const clamped = setPreset(s, 'S5', 99_999);
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
  DEFAULT_SOCKET_ROLES,
  toNetlistTerminal,
  toPhysicalTerminal,
  validateSocketRoles,
  type SocketRoles,
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
  const roles = options.roles ?? DEFAULT_SOCKET_ROLES;
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
      Tests  10 passed (10)
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

仕様 §4.4 のデータフロー「盤の初期状態 → ネットリスト」を実装する。ここが `board-model` が
`circuit-sim` に依存する理由（§4.2）である。

設計の要点:

- 役割付きソケットに装着された部品は `createRelay4c(role)` / `createTimer4c(role, presetMs, rangeMaxMs)` で作る。役割名がそのまま部品IDなので端子IDは自動的に `CR1.13` になる。
- **役割なしの予備ソケット**は物理ソケットID（`S8`）を部品IDにする。端子は `S8.1`〜`S8.14` として存在し、配線も測定もできる。
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
  wire(session, 'TB_PB.2c', 'CR1.10');
  wire(session, 'CR1.6', 'TB_PL.1+');
  wire(session, 'TB_PL.1-', 'CR1.13');
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
      'S3',
      'S4',
      'T1',
      'T2',
      'CHK',
      'S8',
    ]);
    expect(netlist.links).toHaveLength(22);
    expect(netlist.links.every((l) => l.locked)).toBe(true);
    expect(netlist.wires).toHaveLength(3);
    expect(netlist.wires.every((w) => w.locked)).toBe(true);
    expect(findPart(netlist, 'P')?.terminals).toHaveLength(1);
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
    const timer = plug(session, 'S5', 'timer-h3y4', { presetMs: 2500 });
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
    const plugged = plug(session, 'S7', 'relay-my4n');
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
import { socketPartId, type SocketRoles } from './roles.js';
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

/**
 * 空きソケットを「14端子だけを持つ部品」として作る。
 * `partIdOfSocket` は役割名（`CR1`）か、役割なしの予備ソケットなら物理ソケットID（`S8`）。
 */
export function createEmptySocketPart(partIdOfSocket: string): Part {
  const terminals: TerminalId[] = [];
  for (let pin = 1; pin <= 14; pin += 1) terminals.push(terminalId(partIdOfSocket, String(pin)));
  return createTerminalOnlyPart(partIdOfSocket, terminals);
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
 * 部品の並び（決定論）: 電源 → P/N供給端子 → 端子台2つ → PB4個 → PL4個 → BZ（任意）→ ソケットS1〜S8。
 * ソケットの部品IDは、役割が割り当てられていれば役割名（`CR1`）、予備ソケットなら物理ID（`S8`）。
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
  const roles: SocketRoles = session.socketRoles;
  for (const socket of SOCKET_IDS) {
    const id = socketPartId(roles, socket);
    const mounted = session.mounted[socket];
    if (mounted === undefined) {
      parts.push(createEmptySocketPart(id));
    } else if (mounted.kind === 'relay-my4n') {
      parts.push(createRelay4c(id));
    } else {
      parts.push(createTimer4c(id, mounted.presetMs, mounted.rangeMaxMs));
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

## Task 9: src/routing.ts — 盤面を直角に走る自動経路

**Files:**
- Create: `packages/board-model/src/routing.ts`
- Test: `packages/board-model/test/routing.test.ts`
- Modify: `packages/board-model/src/index.ts`

仕様 §6.6 は「経路は自動。端子 → 最寄りダクト入口 → ダクト内 → 目的端子の最寄り出口 → 端子。
ダクト内で重なる線は幅方向に 2mmピッチ で並列オフセットして描く（電線の描画直径は 1.6mm）」と定める。
**実物の写真には配線ダクトが無く**、電線は盤面の上を**直角に整列して**走っている。そこで「ダクト」を
盤定義の**配線帯**（`wiringChannels`。見えないガイド）に置き換える。§6.6 の「自動」「2mmピッチ」
「線径1.6mm」はそのまま守る。

**最優先の制約: 電線はリレー／タイマなど部品の上を通ってはならない。**

| 仕組み | 内容 |
|---|---|
| 占有矩形（`footprints`） | ソケット（装着した部品の本体を含む外形）・端子台・ランプ・押ボタン・ブレーカ・スイッチ・供給端子の盤面への投影。Task 4 の盤定義が持つ |
| 配線帯（`wiringChannels`） | 占有矩形と**重ならない位置にだけ**引く。水平3本（P/N列とソケット列の間、ソケット列と端子台列の間、端子台列とPL/PB列の間）＋ 垂直3本（左余白、左右クラスタの間、右余白） |
| 引き出し | 端子から盤面に垂直（奥または手前）に出て最寄りの水平帯に入る。ソケットのネジ端子は本体の奥端／手前端に寄っているので向きが決まる（`BoardTerminal.exit`）。端子台・P/N・本体端子は空いている側へ |
| 帯の中 | 帯どうしの交点を節点にしたグラフをダイクストラ法で辿る。**帯はどれも占有矩形を通らないので、選ばれた経路は必ず部品を跨がない**。直交する帯で届かないときは余白やクラスタ間の帯を回る迂回路になる |
| レーン | 帯ごとに「占有する区間」を持ち、**区間が重なる電線とだけ**レーンを分ける（区間彩色）。ずらす向きは帯ごとに固定（`CHANNEL_LANE_DIRECTION`）で、部品の無い側へ伸ばす |
| 角 | 半径6mmのフィレット（2次ベジェを3分割）で丸める。丸める前の直角の折れ点は `WireRoute.corners` に残す |
| 検証 | 経路を返す前に占有矩形との交差を実際に検査し、跨いでいたら `RoutingError` を投げる（UIが警告を出せる） |
| 同じ列の渡り線 | 端子台の同じ列、またはソケットの**同じティア**の端子どうしは、配線帯まで往復せず列から5mm（＋レーン2mm）張り出すだけの短い直角経路で渡る（`DIRECT_JOG_MM`）。ティアをまたぐ渡りは差込穴の上を通らないよう配線帯を使う |
| 既設ハーネス | 端子台 → PB／PL本体の青線は配線帯を使わず、端子台から手前へまっすぐ降りて機器の**貫通穴**（`panelHole`）に2mmピッチで平行に入り、盤の裏の本体端子へつながる（`routeFixedLinks()`）。機器の中心（レンズ・ボタンの頭）の上は通らない |

`routeWire()` の `from` / `to` は**物理**端子ID（`S1.13` / `TB_PB.1a`）である。役割ベースの端子ID
（`CR1.13`）を持つセッションからは `routeSession()` を使う（内部で `toPhysicalTerminal()` を通す）。

- [ ] 失敗するテストを書く。`packages/board-model/test/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  addWire,
  boardTerminalPos,
  channelsClearOfFootprints,
  createSession,
  crossesFootprint,
  crossingFootprint,
  entryChannelFor,
  filletCorners,
  findBoardTerminal,
  isManhattan,
  JIPM_BOARD,
  MAX_WIRE_LANES,
  pickLane,
  plug,
  routeFixedLinks,
  routeSession,
  routeWire,
  RoutingError,
  segmentIntersectsRect,
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

/** 自己保持回路ぶんの配線（役割端子ではなく物理端子で書く）。 */
const SELF_HOLD_WIRING: ReadonlyArray<[string, string]> = [
  ['P.1', 'TB_PB.2c'],
  ['TB_PB.2c', 'S1.10'],
  ['TB_PB.2b', 'TB_PB.1c'],
  ['TB_PB.1a', 'S1.14'],
  ['S1.14', 'S1.5'],
  ['N.1', 'S1.13'],
  ['S1.13', 'TB_PL.1-'],
  ['TB_PB.1c', 'S1.9'],
  ['S1.6', 'TB_PL.1+'],
];

/** フリッカ回路ぶんの配線（左右のクラスタをまたぐ）。 */
const FLICKER_WIRING: ReadonlyArray<[string, string]> = [
  ['P.1', 'TB_PB.1c'],
  ['TB_PB.1a', 'S1.9'],
  ['S1.9', 'S2.9'],
  ['S1.1', 'S5.14'],
  ['N.1', 'S5.13'],
  ['S5.13', 'S1.13'],
  ['S1.13', 'S6.13'],
  ['S6.13', 'S2.13'],
  ['S2.13', 'TB_PL.1-'],
  ['S2.1', 'S5.9'],
  ['S5.5', 'S1.14'],
  ['S1.10', 'S6.14'],
  ['S6.9', 'S2.14'],
  ['S1.12', 'TB_PL.1+'],
];

function routeAll(pairs: ReadonlyArray<[string, string]>): WireRoute[] {
  const routes: WireRoute[] = [];
  pairs.forEach(([from, to], index) => {
    routes.push(route(`w-${index}`, from, to, routes));
  });
  return routes;
}

describe('routing: 直角配線（§6.6 / 写真にダクトは無い）', () => {
  it('配線帯は部品の占有領域と重ならない（レーンの広がりを含む）', () => {
    expect(channelsClearOfFootprints(board)).toEqual([]);
  });

  it('端子 → 配線帯 → 端子 の直角経路を返す', () => {
    const r = route('w-1', 'TB_PB.1c', 'S1.9');
    expect(r.corners[0]).toEqual(boardTerminalPos(board, 'TB_PB.1c'));
    expect(r.corners[r.corners.length - 1]).toEqual(boardTerminalPos(board, 'S1.9'));
    expect(isManhattan(r.corners)).toBe(true);
    expect(r.channelIds.length).toBeGreaterThan(0);
    expect(r.lane).toBe(0);
    expect(r.lengthMm).toBeGreaterThan(0);
    expect(crossesFootprint(board, r)).toBe(false);
  });

  it('ソケットのネジ端子は本体の上端／下端の向きに引き出される', () => {
    const upper = findBoardTerminal(board, 'S1.1');
    const lower = findBoardTerminal(board, 'S1.13');
    if (upper === undefined || lower === undefined) throw new Error('terminal');
    expect(upper.exit).toBe('rear');
    expect(lower.exit).toBe('front');
    expect(entryChannelFor(board, upper)?.id).toBe('ch-top');
    expect(entryChannelFor(board, lower)?.id).toBe('ch-mid');
  });

  it('同じ列の隣り合う端子は配線帯を使わず短い渡り線で結ぶ（調査資料 §4.5）', () => {
    const jumper = route('w-1', 'TB_PB.2b', 'TB_PB.1c');
    expect(jumper.channelIds).toEqual([]);
    expect(isManhattan(jumper.corners)).toBe(true);
    expect(crossingFootprint(board, jumper)).toBeUndefined();
    // 端子台の列から少し張り出すだけで、配線帯（ch-mid / ch-low）までは行かない
    const ys = jumper.corners.map((c) => c.y);
    expect(Math.min(...ys)).toBeGreaterThan(142);
    expect(Math.max(...ys)).toBeLessThan(198);
    // 同じ列の渡り線が増えると張り出し量が2mmずつ変わる
    const second = route('w-2', 'TB_PB.3b', 'TB_PB.4c', [jumper]);
    expect(second.channelIds).toEqual([]);
    expect(second.lane).toBe(1);
    const jogOf = (r: WireRoute): number => Math.min(...r.corners.map((c) => c.y));
    expect(jogOf(jumper) - jogOf(second)).toBeCloseTo(WIRE_LANE_PITCH_MM, 6);
    // ソケットの同じティア（⑬と⑭）も渡り線になる
    const coil = route('w-3', 'S1.13', 'S1.14');
    expect(coil.channelIds).toEqual([]);
    // ティアをまたぐ場合は差込穴の上を通らないよう配線帯を使う
    const across = route('w-4', 'S1.1', 'S1.13');
    expect(across.channelIds.length).toBeGreaterThan(0);
    // 別の部品どうしは配線帯を使う
    expect(route('w-5', 'TB_PB.1c', 'S1.9').channelIds.length).toBeGreaterThan(0);
  });

  it('同じ入力からは必ず同じ経路（決定論）', () => {
    expect(route('w-1', 'TB_PL.1+', 'S8.14')).toEqual(route('w-1', 'TB_PL.1+', 'S8.14'));
  });

  it('同じ帯を通る電線は2mmピッチで別レーンに割り当てられる', () => {
    const first = route('w-1', 'P.1', 'S1.1');
    const second = route('w-2', 'N.1', 'S2.1', [first]);
    const third = route('w-3', 'PS.+', 'S3.1', [first, second]);
    expect([first.lane, second.lane, third.lane]).toEqual([0, 1, 2]);
    const runY = (r: WireRoute): number => {
      const p = r.corners.find((c) => Math.abs(c.y - 42) < 12 && c.z < 5);
      return p?.y ?? -1;
    };
    expect(runY(second) - runY(first)).toBeCloseTo(WIRE_LANE_PITCH_MM, 6);
    expect(runY(third) - runY(second)).toBeCloseTo(WIRE_LANE_PITCH_MM, 6);
  });

  it('レーンは MAX_WIRE_LANES で頭打ちになる', () => {
    const existing: WireRoute[] = [];
    let last = route('w-0', 'P.1', 'S1.1');
    existing.push(last);
    for (let i = 1; i < 10; i += 1) {
      last = route(`w-${i}`, 'P.1', 'S1.1', existing);
      existing.push(last);
    }
    expect(last.lane).toBe(MAX_WIRE_LANES - 1);
  });

  it('自己保持回路の全配線が部品の上を通らず、直角でレーンも重ならない', () => {
    const routes = routeAll(SELF_HOLD_WIRING);
    expect(routes).toHaveLength(SELF_HOLD_WIRING.length);
    for (const r of routes) {
      expect(isManhattan(r.corners)).toBe(true);
      expect(crossingFootprint(board, r)).toBeUndefined();
    }
    // 同じ帯の同じ区間を走る経路どうしはレーンが違う（区間が離れていれば同じレーンでよい）
    for (let i = 0; i < routes.length; i += 1) {
      for (let j = i + 1; j < routes.length; j += 1) {
        const a = routes[i];
        const b = routes[j];
        if (a === undefined || b === undefined) continue;
        const overlaps = a.channelSpans.some((sa) =>
          b.channelSpans.some(
            (sb) => sa.channelId === sb.channelId && sa.lo < sb.hi && sb.lo < sa.hi,
          ),
        );
        if (!overlaps) continue;
        expect(a.lane).not.toBe(b.lane);
      }
    }
  });

  it('フリッカ回路（左右クラスタをまたぐ）の全配線も部品の上を通らない', () => {
    const routes = routeAll(FLICKER_WIRING);
    expect(routes).toHaveLength(FLICKER_WIRING.length);
    for (const r of routes) {
      expect(isManhattan(r.corners)).toBe(true);
      expect(crossingFootprint(board, r)).toBeUndefined();
    }
  });

  it('既設の青線ハーネスは機器の真上から降り、貫通穴で盤面を抜ける（§6.4 / 写真）', () => {
    const routes = routeFixedLinks(board);
    // PB 12本 ＋ PL 8本。P/N供給端子どうしのリンクは筐体内なので描かない
    expect(routes).toHaveLength(20);
    for (const r of routes) {
      expect(isManhattan(r.corners)).toBe(true);
      expect(crossingFootprint(board, r)).toBeUndefined();
      expect(r.throughPanelAt).toBeDefined();
      expect(r.channelIds).toEqual([]);
    }
    // PL1 の2本は PL1 の貫通穴に2mmピッチで入り、機器の中心は通らない
    const pl1 = routes.filter((r) => r.wireId.startsWith('lk-pl-1'));
    expect(pl1).toHaveLength(2);
    const lamp = board.lamps[0];
    if (lamp === undefined) throw new Error('PL1');
    for (const r of pl1) {
      expect(r.throughPanelAt?.y).toBe(lamp.panelHole.y);
      expect(Math.abs((r.throughPanelAt?.x ?? 0) - lamp.panelHole.x)).toBeLessThanOrEqual(
        WIRE_LANE_PITCH_MM,
      );
      // 機器の中心（レンズの真上）を通らない
      for (let i = 1; i < r.corners.length; i += 1) {
        const a = r.corners[i - 1];
        const b = r.corners[i];
        if (a === undefined || b === undefined) continue;
        if (a.z <= 0 || b.z <= 0) continue; // 盤面より下（機器の内側）は対象外
        expect(
          segmentIntersectsRect(a, b, { x: lamp.pos.x - 6, y: lamp.pos.y - 6, w: 12, h: 12 }),
        ).toBe(false);
      }
    }
    const holes = new Set(
      routes.filter((r) => r.wireId.startsWith('lk-pb-1')).map((r) => r.throughPanelAt?.x),
    );
    expect(holes.size).toBe(3);
  });

  it('セッションの全電線を並び順に経路化する', () => {
    const session = createSession(board);
    expect(plug(session, 'S7', 'relay-my4n').ok).toBe(true);
    expect(addWire(session, board, t('P.1'), t('TB_PB.1c')).ok).toBe(true);
    const routes = routeSession(board, session);
    expect(routes).toHaveLength(session.wires.length);
    expect(routes.map((r) => r.wireId)).toEqual(['fw-chk-1', 'fw-chk-2', 'fw-chk-3', 'w-001']);
    // 役割端子（CHK.14）が物理端子（S7.14）に解決されている
    const chk = routes[1];
    if (chk === undefined) throw new Error('route');
    expect(chk.corners[chk.corners.length - 1]).toEqual(boardTerminalPos(board, 'S7.14'));
    for (const r of routes) expect(crossingFootprint(board, r)).toBeUndefined();
    expect(routeSession(board, session)).toEqual(routes);
  });

  it('盤に無い端子は RoutingError', () => {
    expect(() => route('w-1', 'ZZ.1', 'P.1')).toThrow(RoutingError);
  });

  it('フィレットは角を丸め、両端の点は動かさない', () => {
    const corners = [vec3(0, 0, 0), vec3(0, 40, 0), vec3(40, 40, 0)];
    const filleted = filletCorners(corners, 6);
    expect(filleted[0]).toEqual(corners[0]);
    expect(filleted[filleted.length - 1]).toEqual(corners[2]);
    expect(filleted.length).toBeGreaterThan(corners.length);
    expect(isManhattan(filleted)).toBe(false);
    expect(filletCorners([vec3(0, 0, 0), vec3(10, 0, 0)], 6)).toHaveLength(2);
  });

  it('レーンは帯ごとの占有区間が重なるときだけ分ける', () => {
    expect(pickLane([{ channelId: 'ch-mid', lo: 0, hi: 10 }], [])).toBe(0);
    const busy: WireRoute[] = [0, 1, 2, 3, 4, 5, 6, 7].map((lane) => ({
      wireId: `x${lane}`,
      points: [],
      corners: [],
      channelIds: ['ch-mid'],
      channelSpans: [{ channelId: 'ch-mid', lo: 0, hi: 100 }],
      lane,
      lengthMm: 0,
    }));
    expect(pickLane([{ channelId: 'ch-mid', lo: 0, hi: 100 }], busy)).toBe(MAX_WIRE_LANES - 1);
    // 区間が離れていればレーン0を再利用できる
    expect(pickLane([{ channelId: 'ch-mid', lo: 200, hi: 300 }], busy)).toBe(0);
    // 別の帯なら干渉しない
    expect(pickLane([{ channelId: 'ch-top', lo: 0, hi: 100 }], busy)).toBe(0);
  });

  it('引き出し向きは端子ごとに強制できる（既設ハーネス用）', () => {
    const tb = findBoardTerminal(board, 'TB_PL.1+');
    if (tb === undefined) throw new Error('TB_PL.1+');
    expect(entryChannelFor(board, tb)?.id).toBe('ch-mid');
    expect(entryChannelFor(board, tb, 'front')?.id).toBe('ch-low');
    expect(entryChannelFor(board, tb, 'rear')?.id).toBe('ch-mid');
    const bodyTerminal = findBoardTerminal(board, 'PL1.+');
    if (bodyTerminal === undefined) throw new Error('PL1.+');
    expect(entryChannelFor(board, bodyTerminal)?.id).toBe('ch-low');
  });

  it('配線帯が無い盤では経路を作れない', () => {
    const noChannels = { ...board, wiringChannels: [] };
    expect(() => routeWire(noChannels, { id: 'w', from: t('P.1'), to: t('N.1') }, [])).toThrow(
      RoutingError,
    );
    const split = {
      ...board,
      wiringChannels: board.wiringChannels.filter((c) => c.id === 'ch-top' || c.id === 'ch-low'),
    };
    expect(() => routeWire(split, { id: 'w', from: t('P.1'), to: t('PL1.+') }, [])).toThrow(
      RoutingError,
    );
  });

  it('部品の上を通ってしまう配線帯では経路生成が失敗する（迂回できないとき）', () => {
    const bad = {
      ...board,
      wiringChannels: [{ id: 'ch-bad', axis: 'x' as const, at: 100, from: 10, to: 322, zMm: 3.5 }],
    };
    expect(() => routeWire(bad, { id: 'w', from: t('P.1'), to: t('TB_PL.1+') }, [])).toThrow(
      RoutingError,
    );
  });

  it('部品の上を通る経路は検出できる', () => {
    const bogus: WireRoute = {
      wireId: 'bogus',
      points: [vec3(0, 100, 3.5), vec3(330, 100, 3.5)],
      corners: [vec3(0, 100, 3.5), vec3(330, 100, 3.5)],
      channelIds: [],
      channelSpans: [],
      lane: 0,
      lengthMm: 330,
    };
    expect(crossesFootprint(board, bogus)).toBe(true);
    expect(crossingFootprint(board, bogus)?.kind).toBe('socket');
  });

  it('配線帯が部品と重なる盤は検出できる（盤定義の回帰防止）', () => {
    const bad = {
      ...board,
      wiringChannels: [{ id: 'ch-bad', axis: 'x' as const, at: 100, from: 10, to: 320, zMm: 3.5 }],
    };
    expect(channelsClearOfFootprints(bad).length).toBeGreaterThan(0);
  });

  it('フィレット半径0では折れ点をそのまま返す', () => {
    const corners = [vec3(0, 0, 0), vec3(0, 40, 0), vec3(40, 40, 0)];
    expect(filletCorners(corners, 0)).toEqual(corners);
  });

  it('線分と矩形の交差判定（境界に接するだけは交差としない）', () => {
    const rect = { x: 10, y: 10, w: 20, h: 20 };
    expect(segmentIntersectsRect(vec3(0, 20), vec3(40, 20), rect)).toBe(true);
    expect(segmentIntersectsRect(vec3(0, 10), vec3(40, 10), rect)).toBe(false);
    expect(segmentIntersectsRect(vec3(0, 0), vec3(40, 0), rect)).toBe(false);
    expect(segmentIntersectsRect(vec3(20, 0), vec3(20, 40), rect)).toBe(true);
    expect(segmentIntersectsRect(vec3(0, 0), vec3(5, 5), rect)).toBe(false);
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
import {
  CHANNEL_LANE_DIRECTION,
  findBoardTerminal,
  HARNESS_APPROACH_MM,
  HARNESS_PITCH_MM,
  WIRE_RUN_Z_MM,
  type BoardDefinition,
  type BoardTerminal,
  type Footprint,
  type WiringChannel,
} from './board-jipm.js';
import {
  distance,
  polylineLength,
  rectContains,
  roundVec,
  segmentIntersectsRect,
  vec3,
  vecEquals,
  type Vec3,
} from './geometry.js';
import { toPhysicalTerminal } from './roles.js';
import type { BoardSession } from './session.js';

/**
 * 電線の自動経路生成。設計仕様 §6.6。
 *
 * 実物（写真）には配線ダクトが無いが、電線は盤面の上を**直角**に整列して走っている。
 * そこで盤定義に「配線帯」（見えないガイド。機器の列と列のあいだ）を置き、
 * 端子 → 盤面に垂直に引き出す → 最寄りの配線帯 → 帯の中を直角に走る → 目的端子の列で曲がる → 端子
 * という経路を作る。並走する電線は帯の幅方向に2mmピッチでレーンを割り当て、曲がり角は
 * 半径6mmのフィレットで丸める。純関数・決定論（乱数も時刻も使わない）。
 */

/** 電線の描画直径[mm]。§6.6 */
export const WIRE_DIAMETER_MM = 1.6;
/** 並走する電線の並列オフセット幅[mm]。§6.6 */
export const WIRE_LANE_PITCH_MM = 2;
/** 並列オフセットの最大段数。 */
export const MAX_WIRE_LANES = 8;
/** 曲がり角のフィレット半径[mm]。 */
export const WIRE_FILLET_RADIUS_MM = 6;
/** フィレット1か所あたりの分割数（点数は控えめに）。 */
export const WIRE_FILLET_SEGMENTS = 3;
/** 同じ列の隣り合う端子を直結する渡り線が、列から張り出す距離[mm]。 */
export const DIRECT_JOG_MM = 5;

/** 経路を求める対象の電線（端子IDは**物理**端子ID）。 */
export interface RoutableWire {
  id: string;
  from: TerminalId;
  to: TerminalId;
}

/** 求めた経路。 */
export interface WireRoute {
  wireId: string;
  /** 描画用の折れ線[mm]（曲がり角はフィレットで丸めてある）。 */
  points: Vec3[];
  /** 丸める前の直角経路の折れ点[mm]。隣り合う点は x・y・z のどれか1軸だけが変わる。 */
  corners: Vec3[];
  /** 通った配線帯のID（通過順）。 */
  channelIds: string[];
  /** 帯ごとの占有区間（帯に沿った座標の範囲）。同じ区間を使う電線は別レーンになる。 */
  channelSpans: Array<{ channelId: string; lo: number; hi: number }>;
  /** 帯の中での並走レーン（0起点）。 */
  lane: number;
  /** 盤面を貫通する位置（既設ハーネスのみ）。ここから先は盤の裏側。 */
  throughPanelAt?: Vec3;
  /** 経路長[mm]。 */
  lengthMm: number;
}

/** 帯ごとの占有区間が重なる既存経路を避けて、最小の空きレーンを選ぶ。 */
export function pickLane(
  spans: ReadonlyArray<{ channelId: string; lo: number; hi: number }>,
  existingRoutes: readonly WireRoute[],
): number {
  const taken = new Set<number>();
  for (const other of existingRoutes) {
    const conflicts = other.channelSpans.some((b) =>
      spans.some((a) => a.channelId === b.channelId && a.lo < b.hi + 1e-6 && b.lo < a.hi + 1e-6),
    );
    if (conflicts) taken.add(other.lane);
  }
  for (let lane = 0; lane < MAX_WIRE_LANES; lane += 1) {
    if (!taken.has(lane)) return lane;
  }
  return MAX_WIRE_LANES - 1;
}

/** 経路の探索に失敗したときに投げる。 */
export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}

function key(x: number, y: number): string {
  const r = roundVec(vec3(x, y, 0), 3);
  return `${r.x},${r.y}`;
}

interface GraphNode {
  x: number;
  y: number;
  /** この節点が載っている配線帯のID。 */
  channels: string[];
}

interface GraphEdge {
  to: string;
  channelId: string;
  weight: number;
}

/** 帯の上の位置（`axis: 'x'` なら x、`axis: 'y'` なら y）。 */
function alongOf(channel: WiringChannel, x: number, y: number): number {
  return channel.axis === 'x' ? x : y;
}

/** 帯の上の位置から座標に戻す。 */
function pointOn(channel: WiringChannel, along: number): { x: number; y: number } {
  return channel.axis === 'x' ? { x: along, y: channel.at } : { x: channel.at, y: along };
}

function contains(channel: WiringChannel, along: number): boolean {
  return along >= Math.min(channel.from, channel.to) && along <= Math.max(channel.from, channel.to);
}

/**
 * 端子から引き出す先の配線帯を選ぶ。
 * ソケットのネジ端子は本体の上端／下端に寄っているので向きが決まっている（`exit`）。
 * 端子台・P/N・本体端子は `either` で、近いほうの帯に出る。
 */
export function entryChannelFor(
  board: BoardDefinition,
  terminal: BoardTerminal,
  exitOverride?: 'rear' | 'front',
): WiringChannel | undefined {
  const exit = exitOverride ?? terminal.exit;
  const candidates = board.wiringChannels.filter(
    (c) => c.axis === 'x' && contains(c, terminal.pos.x),
  );
  const rear = candidates.filter((c) => c.at <= terminal.pos.y);
  const front = candidates.filter((c) => c.at >= terminal.pos.y);
  const nearest = (list: WiringChannel[]): WiringChannel | undefined =>
    list.length === 0
      ? undefined
      : list.reduce((best, c) =>
          Math.abs(c.at - terminal.pos.y) < Math.abs(best.at - terminal.pos.y) ? c : best,
        );
  if (exit === 'rear') return nearest(rear) ?? nearest(front);
  if (exit === 'front') return nearest(front) ?? nearest(rear);
  const a = nearest(rear);
  const b = nearest(front);
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.abs(a.at - terminal.pos.y) <= Math.abs(b.at - terminal.pos.y) ? a : b;
}

/** 配線帯どうしの交点と、電線の出入口を節点にしたグラフを組む。 */
function buildChannelGraph(
  channels: readonly WiringChannel[],
  entries: ReadonlyArray<{ channel: WiringChannel; along: number }>,
): { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge[]> } {
  const onChannel = new Map<string, number[]>();
  const add = (channel: WiringChannel, along: number): void => {
    const list = onChannel.get(channel.id) ?? [];
    if (!list.some((v) => Math.abs(v - along) < 1e-6)) list.push(along);
    onChannel.set(channel.id, list);
  };
  for (const a of channels) {
    for (const b of channels) {
      if (a.axis === b.axis) continue;
      if (!contains(a, alongOf(a, b.at, b.at))) continue;
      if (!contains(b, alongOf(b, a.at, a.at))) continue;
      add(a, b.at);
      add(b, a.at);
    }
  }
  for (const entry of entries) add(entry.channel, entry.along);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const link = (ka: string, kb: string, channelId: string, weight: number): void => {
    const list = edges.get(ka) ?? [];
    list.push({ to: kb, channelId, weight });
    edges.set(ka, list);
  };
  for (const channel of channels) {
    const alongs = (onChannel.get(channel.id) ?? []).slice().sort((p, q) => p - q);
    for (const along of alongs) {
      const p = pointOn(channel, along);
      const k = key(p.x, p.y);
      const node = nodes.get(k) ?? { x: p.x, y: p.y, channels: [] };
      if (!node.channels.includes(channel.id)) node.channels.push(channel.id);
      nodes.set(k, node);
    }
    for (let i = 1; i < alongs.length; i += 1) {
      const a = alongs[i - 1];
      const b = alongs[i];
      if (a === undefined || b === undefined) continue;
      const pa = pointOn(channel, a);
      const pb = pointOn(channel, b);
      link(key(pa.x, pa.y), key(pb.x, pb.y), channel.id, Math.abs(b - a));
      link(key(pb.x, pb.y), key(pa.x, pa.y), channel.id, Math.abs(b - a));
    }
  }
  return { nodes, edges };
}

/** ダイクストラ法で最短経路（節点キーの列と通った帯）を求める。 */
function shortestPath(
  edges: Map<string, GraphEdge[]>,
  startKey: string,
  goalKey: string,
): { keys: string[]; channelIds: string[] } | undefined {
  if (startKey === goalKey) return { keys: [startKey], channelIds: [] };
  const dist = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, { key: string; channelId: string }>();
  const visited = new Set<string>();
  for (;;) {
    let current: string | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const [k, d] of dist) {
      if (visited.has(k) || d >= best) continue;
      current = k;
      best = d;
    }
    if (current === undefined || current === goalKey) break;
    visited.add(current);
    for (const edge of edges.get(current) ?? []) {
      const next = best + edge.weight;
      if (next >= (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      dist.set(edge.to, next);
      prev.set(edge.to, { key: current, channelId: edge.channelId });
    }
  }
  if (!dist.has(goalKey)) return undefined;
  const keys = [goalKey];
  const channelIds: string[] = [];
  let cursor = goalKey;
  while (cursor !== startKey) {
    const step = prev.get(cursor);
    if (step === undefined) return undefined;
    keys.push(step.key);
    channelIds.push(step.channelId);
    cursor = step.key;
  }
  keys.reverse();
  channelIds.reverse();
  return { keys, channelIds };
}

function dedupeStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v.length === 0 || out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

function dedupePoints(points: readonly Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && vecEquals(last, p, 1e-6)) continue;
    out.push(p);
  }
  return out;
}

/**
 * 帯の走行座標をレーンぶんずらす。水平帯は y、垂直帯は x をずらす。
 * ずらす向きは帯ごとに固定（`CHANNEL_LANE_DIRECTION`）で、部品の無い側へ伸ばす。
 */
function laneShift(channel: WiringChannel, lane: number): { dx: number; dy: number } {
  const shift = lane * WIRE_LANE_PITCH_MM * (CHANNEL_LANE_DIRECTION[channel.id] ?? 1);
  return channel.axis === 'x' ? { dx: 0, dy: shift } : { dx: shift, dy: 0 };
}

/** 直角の折れ点列を、角を半径 `radius` で丸めた折れ線にする。 */
export function filletCorners(corners: readonly Vec3[], radius: number): Vec3[] {
  if (corners.length < 3 || radius <= 0) return [...corners];
  const out: Vec3[] = [];
  const first = corners[0];
  if (first !== undefined) out.push(first);
  for (let i = 1; i < corners.length - 1; i += 1) {
    const prev = corners[i - 1];
    const cur = corners[i];
    const next = corners[i + 1];
    if (prev === undefined || cur === undefined || next === undefined) continue;
    const inLen = distance(prev, cur);
    const outLen = distance(cur, next);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 1e-6) {
      out.push(cur);
      continue;
    }
    const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
      vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    const a = lerp(cur, prev, r / inLen);
    const b = lerp(cur, next, r / outLen);
    for (let k = 0; k <= WIRE_FILLET_SEGMENTS; k += 1) {
      const t = k / WIRE_FILLET_SEGMENTS;
      const u = 1 - t;
      out.push(
        vec3(
          u * u * a.x + 2 * u * t * cur.x + t * t * b.x,
          u * u * a.y + 2 * u * t * cur.y + t * t * b.y,
          u * u * a.z + 2 * u * t * cur.z + t * t * b.z,
        ),
      );
    }
  }
  const last = corners[corners.length - 1];
  if (last !== undefined) out.push(last);
  return dedupePoints(out);
}

/** 端子IDの持ち主（`TB_PB.1c` → `TB_PB`）。 */
function ownerOf(id: TerminalId): string {
  const dot = id.indexOf('.');
  return dot < 0 ? id : id.slice(0, dot);
}

/**
 * 同じ列（端子台の1列、またはソケットの同じティア）の端子どうしを直結する短い渡り線。§4.5
 * 配線帯まで往復すると大回りになるので、列からわずかに張り出して直角に渡る。
 * 部品の占有矩形を跨ぐ場合は使わない（呼び出し側が配線帯の経路にフォールバックする）。
 */
function directRunRoute(
  board: BoardDefinition,
  wire: RoutableWire,
  a: BoardTerminal,
  b: BoardTerminal,
  existingRoutes: readonly WireRoute[],
): WireRoute | undefined {
  if (ownerOf(a.id) !== ownerOf(b.id)) return undefined;
  if (Math.abs(a.pos.y - b.pos.y) > 1e-6) return undefined;
  if (Math.abs(a.pos.x - b.pos.x) < 1e-6) return undefined;
  if (a.exit !== b.exit) return undefined;
  const dir = a.exit === 'front' ? 1 : -1;
  const siblings = existingRoutes.filter(
    (r) => r.channelIds.length === 0 && r.corners.length > 0 && sameRow(r, a),
  );
  const lane = Math.min(siblings.length, MAX_WIRE_LANES - 1);
  const jogY = a.pos.y + dir * (DIRECT_JOG_MM + lane * WIRE_LANE_PITCH_MM);
  const corners = dedupePoints([
    a.pos,
    vec3(a.pos.x, a.pos.y, WIRE_RUN_Z_MM),
    vec3(a.pos.x, jogY, WIRE_RUN_Z_MM),
    vec3(b.pos.x, jogY, WIRE_RUN_Z_MM),
    vec3(b.pos.x, b.pos.y, WIRE_RUN_Z_MM),
    b.pos,
  ]);
  const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
  const route: WireRoute = {
    wireId: wire.id,
    points,
    corners,
    channelIds: [],
    channelSpans: [],
    lane,
    lengthMm: polylineLength(points),
  };
  return crossingFootprint(board, route) === undefined ? route : undefined;
}

/** その経路が端子 `a` と同じ列の渡り線か（レーンを分けるための判定）。 */
function sameRow(route: WireRoute, a: BoardTerminal): boolean {
  const first = route.corners[0];
  return first !== undefined && Math.abs(first.y - a.pos.y) < 1e-6;
}

function terminalOf(board: BoardDefinition, id: TerminalId): BoardTerminal {
  const found = findBoardTerminal(board, id);
  if (found === undefined) throw new RoutingError(`盤に無い端子です: ${id}`);
  return found;
}

/**
 * 1本の電線の経路を求める。§6.6
 * 端子 → 垂直に引き出す → 配線帯 → 直角に走る → 目的端子の列 → 端子。
 * 既存経路のうち同じ帯を通るものの本数だけ、2mmピッチで帯の幅方向にずらす。
 * `wire.from` / `wire.to` は**物理**端子ID（`S1.13` / `TB_PB.1a` など）。
 */
export function routeWire(
  board: BoardDefinition,
  wire: RoutableWire,
  existingRoutes: readonly WireRoute[],
  options: RouteOptions = {},
): WireRoute {
  const a = terminalOf(board, wire.from);
  const b = terminalOf(board, wire.to);
  if (options.exitOverride === undefined) {
    const direct = directRunRoute(board, wire, a, b, existingRoutes);
    if (direct !== undefined) return direct;
  }
  const chA = entryChannelFor(board, a, options.exitOverride?.[wire.from]);
  const chB = entryChannelFor(board, b, options.exitOverride?.[wire.to]);
  if (chA === undefined || chB === undefined) {
    throw new RoutingError(`端子から出られる配線帯がありません: ${wire.from} / ${wire.to}`);
  }

  const entryA = { channel: chA, along: alongOf(chA, a.pos.x, a.pos.y) };
  const entryB = { channel: chB, along: alongOf(chB, b.pos.x, b.pos.y) };
  const graph = buildChannelGraph(board.wiringChannels, [entryA, entryB]);
  const pa = pointOn(chA, entryA.along);
  const pb = pointOn(chB, entryB.along);
  const path = shortestPath(graph.edges, key(pa.x, pa.y), key(pb.x, pb.y));
  if (path === undefined) {
    throw new RoutingError(`配線帯がつながっていません: ${wire.from} → ${wire.to}`);
  }

  const channelIds = dedupeStrings(
    path.channelIds.length === 0 ? [chA.id] : [chA.id, ...path.channelIds, chB.id],
  );
  // 帯ごとの占有区間を求め、区間が重なる電線とだけレーンを分ける
  const channelById = new Map(board.wiringChannels.map((c) => [c.id, c]));
  const spanMap = new Map<string, { channelId: string; lo: number; hi: number }>();
  path.keys.forEach((k, index) => {
    const channelId = path.channelIds[index];
    if (channelId === undefined) return;
    const channel = channelById.get(channelId);
    const nodeA = graph.nodes.get(k);
    const nodeB = graph.nodes.get(path.keys[index + 1] ?? '');
    if (channel === undefined || nodeA === undefined || nodeB === undefined) return;
    const a = alongOf(channel, nodeA.x, nodeA.y);
    const b = alongOf(channel, nodeB.x, nodeB.y);
    const prev = spanMap.get(channelId);
    const lo = Math.min(a, b, prev?.lo ?? Number.POSITIVE_INFINITY);
    const hi = Math.max(a, b, prev?.hi ?? Number.NEGATIVE_INFINITY);
    spanMap.set(channelId, { channelId, lo, hi });
  });
  if (spanMap.size === 0) {
    const along = alongOf(chA, pa.x, pa.y);
    spanMap.set(chA.id, { channelId: chA.id, lo: along, hi: along });
  }
  const channelSpans = [...spanMap.values()];
  const lane = pickLane(channelSpans, existingRoutes);

  const runPoints: Vec3[] = [];
  path.keys.forEach((k, index) => {
    const node = graph.nodes.get(k);
    if (node === undefined) return;
    // 帯の乗り換え点では、入ってきた帯と出ていく帯の**両方**のレーンずらしを足す。
    // こうしないと角で x と y が同時に動いてしまい、直角経路でなくなる。
    const incoming = index > 0 ? path.channelIds[index - 1] : undefined;
    const outgoing = path.channelIds[index];
    let dx = 0;
    let dy = 0;
    let zMm = WIRE_RUN_Z_MM;
    // 同じ帯を通り抜けるだけの節点では二重に足さない（帯ごとに1回だけ）
    const applied = new Set<string>();
    for (const id of [incoming, outgoing]) {
      if (id === undefined || applied.has(id)) continue;
      applied.add(id);
      const channel = channelById.get(id);
      if (channel === undefined) continue;
      const shift = laneShift(channel, lane);
      dx += shift.dx;
      dy += shift.dy;
      zMm = channel.zMm;
    }
    if (incoming === undefined && outgoing === undefined) {
      const shift = laneShift(chA, lane);
      dx = shift.dx;
      dy = shift.dy;
      zMm = chA.zMm;
    }
    runPoints.push(vec3(node.x + dx, node.y + dy, zMm));
  });

  const firstRun = runPoints[0];
  const lastRun = runPoints[runPoints.length - 1];
  if (firstRun === undefined || lastRun === undefined) {
    throw new RoutingError(`経路が空です: ${wire.id}`);
  }

  // 端子 → 盤面の走行高さへ立ち下げ → 帯へ垂直に入る（各区間は1軸だけ動く）
  const corners = dedupePoints([
    a.pos,
    vec3(a.pos.x, a.pos.y, WIRE_RUN_Z_MM),
    vec3(firstRun.x, a.pos.y, WIRE_RUN_Z_MM),
    firstRun,
    ...runPoints.slice(1, -1),
    lastRun,
    vec3(lastRun.x, b.pos.y, WIRE_RUN_Z_MM),
    vec3(b.pos.x, b.pos.y, WIRE_RUN_Z_MM),
    b.pos,
  ]);
  const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
  const route: WireRoute = {
    wireId: wire.id,
    points,
    corners,
    channelIds,
    channelSpans,
    lane,
    lengthMm: polylineLength(points),
  };
  const hit = crossingFootprint(board, route);
  if (hit !== undefined) {
    throw new RoutingError(
      `経路が部品の上を通ります（${hit.kind} ${hit.id}）: ${wire.from} → ${wire.to}`,
    );
  }
  return route;
}

/** 経路生成のオプション。 */
export interface RouteOptions {
  /** 端子ごとに引き出し向きを強制する（既設ハーネスを写真どおり手前へ出すのに使う）。 */
  exitOverride?: Readonly<Record<string, 'rear' | 'front'>>;
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

/**
 * 既設の青線ハーネス（端子台 → PB／PL本体）の経路。§6.4 / 写真
 * 配線帯は使わず、端子台の端子から**手前へまっすぐ降り**、機器の根元にある盤面の貫通穴に
 * 2mmピッチで平行に入って、盤の裏側の本体端子へつながる。機器の中心（押ボタンの頭・
 * ランプのレンズ）の上は通らない。
 */
export function routeFixedLinks(board: BoardDefinition): WireRoute[] {
  const holeOf = new Map<string, Vec3>();
  for (const lamp of board.lamps) holeOf.set(lamp.id, lamp.panelHole);
  for (const pb of board.pushButtons) holeOf.set(pb.id, pb.panelHole);

  const routes: WireRoute[] = [];
  const seen = new Map<string, number>();
  for (const link of board.fixedLinks) {
    const owner = [...holeOf.keys()].find(
      (id) => link.from.startsWith(`${id}.`) || link.to.startsWith(`${id}.`),
    );
    if (owner === undefined) continue; // P/N供給端子どうしのリンクは筐体内なので描かない
    const hole = holeOf.get(owner);
    const blockId = link.from.startsWith(`${owner}.`) ? link.to : link.from;
    const bodyId = link.from.startsWith(`${owner}.`) ? link.from : link.to;
    const block = findBoardTerminal(board, blockId);
    const body = findBoardTerminal(board, bodyId);
    if (hole === undefined || block === undefined || body === undefined) continue;

    const index = seen.get(owner) ?? 0;
    seen.set(owner, index + 1);
    const total = link.from.startsWith('PB') || link.to.startsWith('PB') ? 3 : 2;
    const offset = (index - (total - 1) / 2) * HARNESS_PITCH_MM;
    const approachY = hole.y - HARNESS_APPROACH_MM;
    const corners = dedupePoints([
      block.pos,
      vec3(block.pos.x, block.pos.y, WIRE_RUN_Z_MM),
      vec3(block.pos.x, approachY, WIRE_RUN_Z_MM),
      vec3(hole.x + offset, approachY, WIRE_RUN_Z_MM),
      vec3(hole.x + offset, hole.y, WIRE_RUN_Z_MM),
      vec3(hole.x + offset, hole.y, 0),
      vec3(hole.x + offset, hole.y, body.pos.z),
      vec3(hole.x + offset, body.pos.y, body.pos.z),
      body.pos,
    ]);
    const points = filletCorners(corners, WIRE_FILLET_RADIUS_MM);
    routes.push({
      wireId: link.id,
      points,
      corners,
      channelIds: [],
      channelSpans: [],
      lane: index,
      throughPanelAt: vec3(hole.x + offset, hole.y, 0),
      lengthMm: polylineLength(points),
    });
  }
  return routes;
}

/** 折れ点列が直角経路か（隣り合う点で動く軸がちょうど1つか）。 */
export function isManhattan(corners: readonly Vec3[], epsilon = 1e-6): boolean {
  for (let i = 1; i < corners.length; i += 1) {
    const p = corners[i - 1];
    const q = corners[i];
    if (p === undefined || q === undefined) return false;
    const moved = [Math.abs(q.x - p.x), Math.abs(q.y - p.y), Math.abs(q.z - p.z)].filter(
      (d) => d > epsilon,
    );
    if (moved.length !== 1) return false;
  }
  return true;
}

/**
 * 経路が部品の占有領域の内側を通っていないか。§6.6
 * 両端の端子が載っている部品（引き出し区間が必ず通る）は除いて調べる。
 * 通っていればその占有領域を返す。
 */
export function crossingFootprint(board: BoardDefinition, route: WireRoute): Footprint | undefined {
  const own = new Set<string>();
  const ends = [route.corners[0], route.corners[route.corners.length - 1]];
  for (const end of ends) {
    if (end === undefined) continue;
    for (const fp of board.footprints) {
      if (rectContains(fp, end)) own.add(fp.id);
    }
  }
  for (const fp of board.footprints) {
    if (own.has(fp.id)) continue;
    for (let i = 1; i < route.points.length; i += 1) {
      const p = route.points[i - 1];
      const q = route.points[i];
      if (p === undefined || q === undefined) continue;
      if (segmentIntersectsRect(p, q, fp)) return fp;
    }
  }
  return undefined;
}

/** 経路が部品の上を横切っているか。 */
export function crossesFootprint(board: BoardDefinition, route: WireRoute): boolean {
  return crossingFootprint(board, route) !== undefined;
}

/** 配線帯が部品の占有領域と重なっていないか（盤定義の不変条件）。§6.6 */
export function channelsClearOfFootprints(board: BoardDefinition): string[] {
  const bad: string[] = [];
  for (const channel of board.wiringChannels) {
    const lanes = MAX_WIRE_LANES - 1;
    const dir = CHANNEL_LANE_DIRECTION[channel.id] ?? 1;
    const spread = lanes * WIRE_LANE_PITCH_MM * dir;
    const a =
      channel.axis === 'x' ? vec3(channel.from, channel.at, 0) : vec3(channel.at, channel.from, 0);
    const b =
      channel.axis === 'x'
        ? vec3(channel.to, channel.at + spread, 0)
        : vec3(channel.at + spread, channel.to, 0);
    const rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
    for (const fp of board.footprints) {
      const overlap =
        rect.x < fp.x + fp.w &&
        rect.x + rect.w > fp.x &&
        rect.y < fp.y + fp.h &&
        rect.y + rect.h > fp.y;
      if (overlap) bad.push(`${channel.id} × ${fp.id}`);
    }
  }
  return bad;
}
```

- [ ] `packages/board-model/src/index.ts` の末尾に次を追記する。

```ts
export {
  channelsClearOfFootprints,
  crossesFootprint,
  crossingFootprint,
  entryChannelFor,
  filletCorners,
  isManhattan,
  MAX_WIRE_LANES,
  pickLane,
  routeFixedLinks,
  routeSession,
  routeWire,
  RoutingError,
  WIRE_DIAMETER_MM,
  WIRE_FILLET_RADIUS_MM,
  WIRE_FILLET_SEGMENTS,
  WIRE_LANE_PITCH_MM,
  type RoutableWire,
  type RouteOptions,
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
      Tests  17 passed (17)
```

- [ ] コミットする。

```powershell
git add packages/board-model
git commit -m @'
feat(board-model): route wires orthogonally without crossing components

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
  rectBottom,
  rectContains,
  rectRight,
  rectsOverlap,
  segmentIntersectsRect,
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
  type Rect,
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
  CHANNEL_LANE_DIRECTION,
  circledNumber,
  findBoardTerminal,
  HARNESS_APPROACH_MM,
  HARNESS_PITCH_MM,
  JIPM_BOARD,
  loadBoard,
  pinRole,
  resolveEndpoint,
  PANEL_HOLE_OFFSET_MM,
  roleLabel,
  SOCKET_BODY_LENGTH_MM,
  SOCKET_BODY_WIDTH_MM,
  SOCKET_COL_PITCH_MM,
  SOCKET_IDS,
  SOCKET_PIN_GRID,
  SOCKET_PIN_HOLE_COL_PITCH_MM,
  SOCKET_PIN_HOLE_ROW_PITCH_MM,
  SOCKET_PITCH_MM,
  SOCKET_SLOT_INSET_MM,
  SOCKET_TERMINAL_Z_MM,
  SOCKET_TIER_INSET_MM,
  SOCKET_TIER_ROW_PITCH_MM,
  socketBodyRect,
  socketPinHoleOffsets,
  socketPinOffset,
  socketPinTerminal,
  socketRowExit,
  SUPPLY_TERMINAL_COUNT,
  TERMINAL_PICK_RADIUS_MM,
  WIRE_RUN_Z_MM,
  type BoardDefinition,
  type BoardEndpoint,
  type BoardTerminal,
  type ConsoleShape,
  type FixedLink,
  type FixedWire,
  type Footprint,
  type LampDefinition,
  type PushButtonColor,
  type PushButtonDefinition,
  type SocketDefinition,
  type SocketId,
  type TerminalRole,
  type WiringChannel,
} from './board-jipm.js';

export {
  CHECK_SOCKET_ROLE,
  DEFAULT_SOCKET_ROLES,
  hasRole,
  isSocketId,
  isSocketRole,
  roleOf,
  RoleError,
  socketOf,
  socketPartId,
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
  channelsClearOfFootprints,
  crossesFootprint,
  crossingFootprint,
  entryChannelFor,
  filletCorners,
  isManhattan,
  MAX_WIRE_LANES,
  pickLane,
  routeFixedLinks,
  routeSession,
  routeWire,
  RoutingError,
  WIRE_DIAMETER_MM,
  WIRE_FILLET_RADIUS_MM,
  WIRE_FILLET_SEGMENTS,
  WIRE_LANE_PITCH_MM,
  type RoutableWire,
  type RouteOptions,
  type WireRoute,
} from './routing.js';
```

- [ ] board-model の全テスト・カバレッジ・型検査・lint を確認する。

```powershell
pnpm --filter @ojt/board-model exec vitest run --coverage
pnpm --filter @ojt/board-model typecheck
pnpm exec eslint .
```

期待出力: `Tests  69 passed (69)`、カバレッジは全項目90%以上（実測: Statements 95.92% / Branches 90.18% / Functions 100% / Lines 97.87%）、`tsc` と `eslint` は何も出さず終了。

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
| P/N | 供給端子は実機どおり `P.1` / `N.1` の1点ずつ。母線の節点は「`P.1` → 最初の入口端子 → 次の入口端子 → …」という**1本の鎖**（渡り配線）で結ぶ。`P.1` / `N.1` はチェック用の既設配線が既に1本使っているので、鎖の先頭に1本だけ出す（合計2本）。鎖の中間の端子は前から1本・次へ1本のちょうど2本、末端は1本になる |
| 母線以外の節点 | 同じく出現順に**鎖状に**結ぶ（渡り配線。調査資料 §4.5）。鎖の順序は `physicalOverride` で端子を差し替えれば変えられる |
| 上書き | `physicalOverride[要素ID] = [左, 右]` があれば既定規則より優先する（§7.2） |
| エラー | 接点組の不足（5個目の接点）と端子本数超過（同じ端子が複数の節点に現れて3本目になる等）を理由付きで返す |

役割割当は `options.roles` で明示できる。省略した場合は `board-model` の `DEFAULT_SOCKET_ROLES`
（S1〜S4=`CR1`〜`CR4`、S5=`T1`、S6=`T2`、S7=`CHK`、S8=予備）をそのまま使う。盤のソケットが8個あり
§6.1 の役割は7つしかないので、**どんな回路図でも必ず載る**（旧版にあった「ソケットに載る機器が
5個以上ならエラー」は、ソケット4個だった旧配置の制約なので無くなった）。明示的に
`TASK1_SOCKET_ROLES` / `TASK2_SOCKET_ROLES` を渡して検定の盤と同じ制約で練習させることはできる。

- [ ] 失敗するテストを書く。`packages/schematic-core/test/assign.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SOCKET_ROLES, TASK2_SOCKET_ROLES } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  assignToBoard,
  at,
  BUS_N,
  BUS_P,
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
    expect(result.roles.S7).toBe('CHK');
    expect(result.roles.S8).toBeUndefined();
    expect(result.parts).toEqual([{ socket: 'S1', role: 'CR1', kind: 'relay-my4n' }]);
    expect(result.cells.map((c) => `${c.cellId}:${c.left}-${c.right}`)).toEqual([
      'c1:TB_PB.2c-TB_PB.2b',
      'c2:TB_PB.1c-TB_PB.1a',
      'c3:CR1.14-CR1.13',
      'c4:CR1.9-CR1.5',
      'c5:CR1.10-CR1.6',
      'c6:TB_PL.1+-TB_PL.1-',
    ]);
    // 母線は P.1 / N.1 から鎖状に渡る（供給端子は実機どおり1点ずつ）
    expect(result.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'P.1-TB_PB.2c',
      'TB_PB.2c-CR1.10',
      'TB_PB.2b-TB_PB.1c',
      'TB_PB.1c-CR1.9',
      'TB_PB.1a-CR1.14',
      'CR1.14-CR1.5',
      'N.1-CR1.13',
      'CR1.13-TB_PL.1-',
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

  it('役割割当は既定（8ソケットに7役割）で、明示指定もできる（§6.1）', () => {
    expect(requiredRoles(flickerDoc())).toEqual(['CR1', 'CR2', 'T1', 'T2']);
    expect(deriveSocketRoles()).toEqual(DEFAULT_SOCKET_ROLES);
    const explicit = assigned(assignToBoard(onDelayDoc(), { roles: TASK2_SOCKET_ROLES }));
    expect(explicit.parts).toEqual([
      { socket: 'S5', role: 'T1', kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 },
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

  it('CR4個とタイマを同時に使う回路図も既定の割当に載る（ソケットは8個）', () => {
    const doc = createDocument('x', '5機器', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c3', 'CR1'), coil('c4', 'CR2')]),
      rung('r3', BUS_P, BUS_N, [crA('c5', 'CR2'), coil('c6', 'CR3')]),
      rung('r4', BUS_P, BUS_N, [crA('c7', 'CR3'), coil('c8', 'CR4')]),
      rung('r5', BUS_P, BUS_N, [crA('c9', 'CR4'), coil('c10', 'T1', 1000)]),
    ]);
    const result = assigned(assignToBoard(doc));
    expect(result.parts.map((p) => `${p.socket}:${p.role}`)).toEqual([
      'S1:CR1',
      'S2:CR2',
      'S3:CR3',
      'S4:CR4',
      'S5:T1',
    ]);
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
      { socket: 'S5', role: 'T1', kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 },
    ]);
  });

  it('母線は P.1 / N.1 から鎖状に渡り、どの端子も2本以内に収まる（§11.3 / 調査資料 §4.5）', () => {
    const result = assigned(assignToBoard(flickerDoc()));
    const count = new Map<string, number>();
    for (const w of result.wires) {
      for (const id of [w.from, w.to]) count.set(id, (count.get(id) ?? 0) + 1);
    }
    // チェック用の既設配線が P.1 / N.1 / TB_PB.4c / TB_PB.4a / CHK.13 / CHK.14 を各1本使う
    for (const [id, n] of count) {
      const preUsed = ['P.1', 'N.1'].includes(id) ? 1 : 0;
      expect(n + preUsed).toBeLessThanOrEqual(2);
    }
    expect(count.get('P.1')).toBe(1);
    expect(count.get('N.1')).toBe(1);
    // N側は鎖なので、母線に集まる5端子が1本の鎖で結ばれる
    const nChain = result.wires.filter((w) => w.from === t('N.1') || w.to === t('N.1'));
    expect(nChain).toHaveLength(1);
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
  DEFAULT_SOCKET_ROLES,
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
 * 各 `CRn`／`Tn` の接点を出現順に組1〜組4へ1つずつ割り当てる。
 * 母線は実機どおり供給端子が `P.1` / `N.1` の1点ずつしかないので、**渡り配線**（鎖状）で分配する。
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

/**
 * 回路図から役割割当を決める。
 * 実物の盤はソケットを8個持ち、§6.1 の7役割（`CR1`〜`CR4` / `T1` / `T2` / `CHK`）を
 * すべて同時に載せられるので、既定の割当（`DEFAULT_SOCKET_ROLES`）をそのまま使えばよい。
 * 課題側で `options.roles` を渡せば §6.1 の課題1形式・課題2形式に絞ることもできる。
 */
export function deriveSocketRoles(): SocketRoles {
  return DEFAULT_SOCKET_ROLES;
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

  const roles = options.roles ?? deriveSocketRoles();
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
  const wires: WireSpec[] = [];
  let seq = 1;
  const emit = (from: TerminalId, to: TerminalId): void => {
    wires.push({ id: `sw-${String(seq).padStart(3, '0')}`, from, to, color });
    seq += 1;
    bump(from);
    bump(to);
  };
  // 母線も含めてすべての節点を**渡り配線**（鎖状）で結ぶ。§11.3 / 調査資料 §4.5
  // 供給端子は実機どおり P.1 / N.1 の1点ずつなので、母線の節点は
  // 「P.1 → 最初の入口端子 → 次の入口端子 → …」という1本の鎖になる。
  for (const [key, terminals] of cellByNode) {
    const chain =
      key === BUS_P_KEY
        ? [terminalId('P', '1'), ...terminals]
        : key === BUS_N_KEY
          ? [terminalId('N', '1'), ...terminals]
          : terminals;
    for (let i = 1; i < chain.length; i += 1) {
      const a = chain[i - 1];
      const b = chain[i];
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
    if (role === undefined || !needed.includes(role)) continue;
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

割当結果を board-model の `plug()` / `addWire()` に通して盤セッションを作る。**配線を自前で押し込まず
必ず `addWire()` を通す**ことで、1端子2本の上限・線色パレット・配線不可端子の規則が盤モデル側の
実装1か所で効く。違反は割当側のエラー（`AssignError`）として返す。

このタスクのテストが Plan 1B の結合点で、`回路図 → 割当 → セッション → ネットリスト → Simulation` を
実際に走らせて、自己保持・インターロック・オンディレー・フリッカの4回路が期待どおり動くことを
確かめる（§14.1 #5・#6・#8・#11 の回路図版）。

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
    expect(session.mounted.S5).toEqual({
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

期待出力: `@ojt/circuit-sim` は Plan 1A のテスト、`@ojt/board-model` が `Tests  69 passed (69)`、`@ojt/schematic-core` が `Tests  40 passed (40)`。`tsc` と `eslint` は無出力、prettier は `All matched files use Prettier code style!`。

- [ ] カバレッジがしきい値（行・分岐とも90%以上、§14.2）を満たすことを確認する。

```powershell
pnpm --filter @ojt/board-model exec vitest run --coverage
pnpm --filter @ojt/schematic-core exec vitest run --coverage
```

期待出力（実測値）:

```
board-model     Statements 95.92% / Branches 90.18% / Functions 100% / Lines 97.87%
schematic-core  Statements 97.64% / Branches 93.53% / Functions 100% / Lines 98.37%
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
| §6.1 | 盤の構成（ソケット・PL4・PB4・端子台8P/12P・P/N供給端子・ブレーカ・スイッチ・電源・M3端子） | Task 4 | `board`「ソケット8（左4・右4）・PB4・PL4」「端子台は12P／8P、P/N供給端子は1本ずつ」「写真どおりの段構成」 |
| §6.1 | ソケットの役割割当（既定／課題1形式／課題2形式） | Task 5 | `roles`「既定の割当は7役割すべてを載せ、S8 を予備にする」「課題1形式・課題2形式の割当は妥当」 |
| §6.2 | ソケット端子の4段配置とピン割付（COM 9-12 / NC 1-4 / NO 5-8 / コイル 13-14） | Task 4 | `board`「ネジ端子が上下2ティアに分かれる」「ピン割付が仕様どおり」「差込穴は14個」 |
| §6.3 | チェック用ソケットの固定配線3本・`locked`・同端子は残り1本 | Task 4・7 | `board`「既設固定配線は3本・青で §6.3 の端子どおり」／`session`「固定配線は削除できない」「既設配線が1本ある端子には1本しか足せない」／`to-netlist`「赤PBで励磁する回路になっている」 |
| §6.4 | 端子ID命名（`CR1.13` / `TB_PB.1a` / `TB_PL.1+` / `P.1` / `PS.+` / `BZ.+`） | Task 4・5・8 | `roles`「役割名がそのまま部品IDになる」／`to-netlist`「部品・リンク・電線の構成」 |
| §6.4 | PB/PL本体↔端子台の既設リンク（12本・8本、`locked`、故障注入対象外）。写真では青線ハーネス | Task 4・8・9 | `board`「既設リンクは…32本の青線ハーネス」／`to-netlist`「`links.every(locked)`」／`routing`「既設の青線ハーネスは機器の真上から降り、貫通穴で盤面を抜ける」 |
| §6.4 | 本体端子には配線できない（測定と3D表示のためだけに存在する） | Task 4・7 | `board`「PB／PL本体端子は配線できず」「本体端子は盤の裏（z が負）にある」／`session`「配線不可端子を拒否する」 |
| §6.5 | 3D座標（mm・盤左上手前が原点・当たり判定半径4mm） | Task 3・4 | `geometry` 全件／`board`「全端子の座標が盤面の中にある」「ネジ端子は当たり判定が重ならない間隔で並ぶ」 |
| §6.5 | 盤の形状（写真の傾斜コンソール） | Task 4 | `board`「傾斜コンソールの形状メタが奥行と整合する」 |
| §6.6 | 部品カタログ（`relay-my4n` / `timer-h3y4` とレンジ） | Task 6 | `catalog`「装着できるのはリレーとタイマの2種」「タイマのレンジは 0〜10s と 0〜60s」 |
| §6.6 | 電線モデル（id / from / to / color / locked） | Task 7 | `session`「電線を張る／外す」 |
| §6.6 | 1端子2本まで。3本目は拒否する | Task 7 | `session`「1端子2本まで」 |
| §6.6 | 経路は自動。重なる線は2mmピッチで並列オフセット。線径1.6mm | Task 9 | `routing`「端子 → 配線帯 → 端子 の直角経路を返す」「同じ帯を通る電線は2mmピッチで別レーンに」「決定論」 |
| §6.6 | **配線は部品（リレー／タイマ等）の上を通らない** | Task 4・9 | `routing`「配線帯は部品の占有領域と重ならない」「自己保持回路の全配線が部品の上を通らず、直角でレーンも重ならない」「フリッカ回路…も部品の上を通らない」「部品の上を通ってしまう配線帯では経路生成が失敗する」／`board`「部品の占有領域が…互いに重ならない」 |
| §6.6 | 電線の見た目（両端のY型圧着端子） | 範囲外 | 経路（`WireRoute.points`）と線径（`WIRE_DIAMETER_MM`）までを本計画が返し、チューブジオメトリと圧着端子の形状は `apps/desktop`（Plan 1D、§15 の3D規模）が描く |
| §7.1 | 課題の `inventory`（使える部品と本数） | Task 6・7 | `catalog`「在庫の計算」／`session`「装着・取り外し・在庫」 |
| §7.2 | `physicalOverride`（回路図要素 → 物理端子の手動指定） | Task 13 | `assign`「physicalOverride が既定規則より優先される」 |
| §8.1 | 線色パレット（モードB=青 / C2=白） | Task 7 | `session`「パレット外の色を拒否する」「白線モードでは青を拒否する」 |
| §8.2 | 配線・部品装着・タイマ設定の操作 | Task 7 | `session` 全件 |
| §11.1 | 文書形式（横書き既定・左P右N・グリッド・要素種別・結線・分岐点・`formatVersion`） | Task 12 | `document` 全件 |
| §11.2 | 読取専用レンダラ用の `layout()`（純関数・図形データまで） | Task 15 | `layout` 全件 |
| §11.3 | 回路図→ネットリスト割当（接点の組・コイル・PB・PL・母線・上書き・エラー） | Task 13 | `assign` 全件、特に「母線は P.1 / N.1 から鎖状に渡り、どの端子も2本以内に収まる」 |
| §11.3 | 割当結果から盤へ（線色は引数、既定は青） | Task 14 | `to-session`「割当どおりに装着と配線が入る」 |
| §12.2 | 3D座標系の前提（盤の左上手前が原点・mm・2.5D） | Task 3・4 | `geometry` 全件／`board`「全端子の座標が盤面の中にある」 |
| §12.2 | ピックの純粋関数化（`resolvePick(hit, uiState)`） | 範囲外 | 本計画は当たり判定に要る素材（端子ID・座標・半径4mm・`wirable`）を `BoardTerminal` として提供する。`resolvePick()` 自体はUI状態（選択中の線色・削除モード）を要するため `apps/desktop`（Plan 1D）で実装する |
| §14.1 #5 | 自己保持回路 | Task 8・14 | `to-netlist`「自己保持回路が Simulation で動く」／`to-session`「自己保持回路が動く」 |
| §14.1 #6 | インターロック（先行優先） | Task 14 | `to-session`「インターロック回路が動く」 |
| §14.1 #8 | オンディレータイマ回路 | Task 14 | `to-session`「オンディレー回路が3秒で点灯する」 |
| §14.1 #11 | フリッカ（リレー併用）・チャタリングしない | Task 14 | `to-session`「フリッカ回路が周期的に点滅し、チャタリングしない」 |
| §14.1 #29 | 回路図→ネットリスト変換（5組目でエラー、4組目までは正しい端子） | Task 13 | `assign`「接点は出現順に組1〜組4へ」「5個目の接点はエラー」 |
| §4.2 | 循環依存の禁止（`import/no-cycle` をエラー） | Task 1 | `pnpm exec eslint .`（Task 1 で発火を実地確認） |
| §14.2 | `board-model` / `schematic-core` の行・分岐カバレッジ90%以上 | Task 10・16 | `vitest run --coverage` のしきい値 |

（§14.1 #1〜#4・#7・#9・#10・#12〜#24 は `circuit-sim` 側で Plan 1A が担当済み。#25〜#28 は Phase 3、#30 は `content`（Plan 1C）の担当で、いずれも本計画の範囲外。）

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本計画での実装 | 理由 |
|---|---|---|---|
| 1 | §4.2「`board-model` はデータ定義のみ。`circuit-sim` に依存しない」 | `board-model` が `circuit-sim` の型と部品ファクトリに依存する | 盤セッション（装着部品＋電線）→ネットリスト変換（§4.4 のデータフロー）をどこかが担う必要があり、盤の構造を最もよく知っているのは `board-model` である。`content`（Plan 1C）に置くと課題スキーマが盤の内部構造を知ることになり、`circuit-sim` に置くとエンジンが特定の盤に依存する。**仕様書 §4.2 はこの計画に合わせて修正済み**（`board --> sim` を依存図に追加し、規則の行を差し替えた）。逆方向（`circuit-sim` → `board-model`）は引き続き禁止で、`import-x/no-cycle` と pnpm の厳格な node_modules の両方で守られる |
| 2 | §6.1「14ピンソケット 5個（うち4個が CR/T 用、1個がチェック用）」 | 物理ソケットを**8個**（左クラスタ `S1`〜`S4`、右クラスタ `S5`〜`S8`）定義する | 実物の写真（K96-CS3）がソケットを左右4個ずつ持つ。役割の数（§6.1 の7つ）は変えず、余った1個を役割なしの予備とした。検定の盤と同じ5個相当で練習させたい課題は `TASK1_SOCKET_ROLES` / `TASK2_SOCKET_ROLES` を渡せばよい（残りは予備になる） |
| 3 | §6.1 の課題形式ごとの役割割当（課題1形式＝CR4＋CHK、課題2形式＝CR2＋T2＋CHK） | 既定を `DEFAULT_SOCKET_ROLES`（7役割すべてを同時に載せる）にし、§6.1 の2形式は選択肢として残す | ソケットが8個あるので両形式を同時に満たせる。§6.1 の「形式ごとに割り当てる」制約は、ソケットが5個しか無い検定盤の制約だった |
| 4 | §6.5「具体座標は Phase 1 の実装で調査資料 §2.2 の配置図に基づき確定する（範囲決定）」 | 実物の写真（`docs/reference/K96-CS3-board-photo.png`）を平面射影として計測し、盤面 330×245mm・筐体厚 50mm・傾斜13°・ソケット本体 30×76mm／取付ピッチ32mm などを確定した | 仕様が Phase 1 に委ねた範囲決定を、調査資料の配置図よりも情報量の多い実物写真で行った。数値の根拠は Task 4 冒頭の表のとおり。**写真から読めない値（奥行・厚み・傾斜角・各段のY座標）はすべて「本アプリ既定（写真からの推定）」である** |
| 5 | §6.5「ダクトは盤面上のポリライン列として定義する。各セグメントは幅と高さを持ち、配線の自動経路が参照する」 | **ダクトを定義しない**。代わりに `BoardDefinition.footprints`（部品の占有矩形）と `BoardDefinition.wiringChannels`（見えない配線帯）を持つ | 実物の写真に配線ダクトが無く、電線は盤面の上を直接走っている。存在しない部品の定義を残すと3D側が描けないものを描こうとする。一方「どこを通ってよいか」の情報は経路生成に必須なので、ダクトの役割は配線帯が引き継ぐ |
| 6 | §6.6「経路は自動。端子 → 最寄りダクト入口 → ダクト内 → 目的端子の最寄り出口 → 端子」 | 端子 → 盤面に垂直に引き出す → 配線帯 → 直角に走る → 目的端子の列で曲がる → 端子。角は半径6mmのフィレットで丸める | 差分#5 の帰結。「ダクト」を「配線帯」に読み替えただけで、経路の骨格は §6.6 のとおり。「自動生成」「2mmピッチの並列オフセット」「線径1.6mm」も守っている |
| 6a | （仕様に明記なし） | **電線は部品の占有矩形の内側を通らない**ことを必須制約にし、経路を返す前に実際に検査して違反なら `RoutingError` を投げる | 「配線がリレーやタイマの上を通るのはあり得ない」（依頼者）。配線帯を占有矩形と重ならない位置にだけ引いてあるので、帯の中を走る経路は構造的に部品を跨がない（帯と矩形が重なっていないことも `channelsClearOfFootprints()` でテストしている）。直交する帯で届かない場合は余白やクラスタ間の帯を回る迂回路が選ばれ、それでも届かなければ失敗する |
| 6b | §6.6「ダクト内で重なる線は幅方向に2mmピッチで並列オフセット」 | 帯ごとに**占有する区間**を持ち、区間が重なる電線とだけレーンを分ける（区間彩色） | 帯を共有するだけで無条件にレーンを増やすと、盤の端から端まで走る電線が数本あるだけでレーンを使い切ってしまう。実際に重なる区間だけ分ければ、同じ2mmピッチのまま必要なレーン数が大きく減る |
| 7 | §6.6 の `terminals[].role` 一覧（`coil+` / `coil-` / `com` / `no` / `nc` / `+` / `-` / `c` / `a` / `b` / `x` / `y` / `ss` / `plc-com` / `ac-l` / `ac-n`） | Phase 1 の盤で使う11種だけを `TerminalRole` に定義し、AC一次側は `ac` の1種にまとめた | `x` / `y` / `ss` / `plc-com` / `ac-l` / `ac-n` はPLC本体の端子役割で、PLC本体を盤モデルに足す Phase 3 で追加する。ブレーカ・電源スイッチは開閉器としてのみモデル化し電気的に解かない（§5.3.5）ので、一次・二次の区別を型に持たせる意味がない |
| 8 | §6.4 の端子表（`CB.1` / `CB.2` / `SW.1` / `SW.2` / `OUTLET.*`） | `CB` / `SW` は盤定義に端子を持つが**ネットリストには載せない**。`OUTLET` は定義しない | AC一次側は電気的に解かない（§5.1.1「交流は扱わない」）。3D表示とホバー表示のために座標だけ要る。`OUTLET`（壁コンセント）はPLC電源の独立性チェック（§10.2）専用なので Phase 3 で足す。なお写真には独立した電源スイッチが見当たらず2極MCBが兼ねているように見えるが、§5.3.5 の「ブレーカ→スイッチ」の順序は教育項目（§5.6 #4）なので `SW` は残した |
| 9 | §6.4「PB本体・PL本体と端子台の間は `locked: true` の0Ω相当リンク」 | リンクのまま（電線にしない）とし、写真どおりの**青色**を `FixedLink.color` に持たせ、経路は `routeFixedLinks()` が別に作る | 写真ではここが青線のハーネスだが、これを `Wire` として `session.wires` に入れると端子台の全端子が最初から1本埋まり、§6.3 の「固定配線がある `TB_PB.4c` / `TB_PB.4a` だけが残り1本」という前提と §11.3 の母線割当が崩れる |
| 9a | （仕様に明記なし） | PB／PL の本体端子を機器の**根元**（盤面のすぐ裏、z = −12mm）に置き、各機器に盤面の**貫通穴** `panelHole` を持たせた。既設ハーネスは端子台から手前へまっすぐ降り、貫通穴に2mmピッチで平行に入る | 写真では青線が機器の奥側の根元の1点に集まって盤面を抜けている。本体端子を機器の中心に置くと、配線が押ボタンの頭やランプのレンズの上を通る絵になってしまう |
| 9b | 調査資料 §4.2「チェック用回路の既設配線は**黄**」 | 既設固定配線をすべて**青**にする（`locked: true` で区別） | 依頼者の実機（K96-CS3）の既設配線が青であるため。線色の意味論（新規=青／修復=白）は §8.1 のまま変えず、既設かどうかは `locked` で判別する。JIPM の検定盤に合わせたい課題は `fixedWires[].color` を黄に差し替えれば足りる |
| 10 | §11.1「要素: …結線（横線・縦線）、分岐点」 | 横線は「段の中で隣り合う要素は繋がっている」という暗黙の規則にし、縦線と分岐点は「段の端点が他の段の節点を指す」形で表した | 横線・縦線を独立の要素として持つと、要素の並びと結線の整合をとる検証が別途必要になる。端点参照にすると「段は必ず1本の経路である」ことが型で保証され、検証・割当・レイアウトが同じ構造をそのまま辿れる。表示上は完全に同じ図になる |
| 11 | §11.1 は段の中の負荷の位置を定めていない | 「右母線(N)に至る段は負荷1つで終わる／分岐段に負荷は置けない」を `validateDocument()` のエラーにした | 展開接続図の作法（右母線の直前が負荷）であり、これを外すと「コイルの後ろに接点がある」図が書けてしまい教材として誤りになる。電気的には直列順序に意味がないので、割当・シミュレーション結果は変わらない |
| 12 | §6.1「P/N供給端子 P.1〜P.6 / N.1〜N.6」／§11.3「母線 → `P.1`〜`P.6` / `N.1`〜`N.6` のうち、1端子2本の制約を満たすように若番から割り当てる」 | 供給端子を実機どおり **`P.1` / `N.1` の1点ずつ**にし、母線は `P.1` / `N.1` を先頭とする**渡り配線の鎖**で分配する | 依頼者の実機（K96-CS3）の DC24V 供給端子台が2点しかない。6本ある前提の「若番から割り当てる」規則は成立しないので、実配線の作法（調査資料 §4.5 の渡り配線）に置き換えた。チェック用の既設配線が `P.1` / `N.1` を各1本使うので、鎖の先頭に出せるのは各1本。鎖の順序は `physicalOverride` で端子を差し替えれば変えられる |
| 12a | （仕様に明記なし） | 同じ列（端子台の1列／ソケットの同じティア）の端子どうしは、配線帯を使わず列から5mm張り出す短い直角経路で渡る | 渡り配線が増えたことで、隣り合う端子を結ぶ線が配線帯まで往復して大回りする絵になってしまうため。ティアをまたぐ渡りは差込穴（装着した部品の本体）の上を通らないよう配線帯を使う |
| 13 | §5.3.4「PL は端子電圧19.2V以上で点灯表示」 | Plan 1A が採用した 14.4V/7.2V（点灯／暗点灯）をそのまま使う | Plan 1A の差分表#3 と同じ理由（接触抵抗による暗点灯を表現するため）。**仕様書 §5.3.4 と §17.2 はこの値に修正済み**（#23 として前提を追記した） |
| 14 | §6.4 の `PB1`〜`PB4` | 部品IDは §6.4 のまま `PB1`〜`PB4`。写真の銘板表記 `PBS1`〜`PBS4` は `PushButtonDefinition.panelLabel` に持つ | 部品IDは端子ID（`PB1.c`）と信号ログ（§5.7）とゴールデンケースの全体で使われる規約なので変えない。3Dの銘板とツールチップだけ写真どおりに出せればよい |
| 15 | §6.2 の4段配置（`[空]③②①` / `⑧⑦⑥⑤` / `⑫⑪⑩⑨` / `④⑭⑬[空]`） | 4段の並びはそのまま。ただし**段1・段2を本体の奥端、段3・段4を手前端**に寄せ、中央を差込穴の領域にした。ティア内の段ピッチは8mm | 実物のソケットは差込穴が本体中央にあり、ネジ端子は上下に段付きで2列ずつ寄っている。§6.2 の図は端子番号の並びを示すもので、等間隔の4段を要求してはいない。ティア内ピッチを写真の見た目（約7mm）ではなく8mmにしたのは、§6.5 の当たり判定半径4mmが重ならない最小値だから |

---

## 完了条件

1. `pnpm test` が全て通る（`@ojt/circuit-sim` は Plan 1A のテスト、`@ojt/board-model` **70件**、`@ojt/schematic-core` **40件**）。
2. `pnpm --filter @ojt/board-model exec vitest run --coverage` と `pnpm --filter @ojt/schematic-core exec vitest run --coverage` が、行・分岐とも90%のしきい値を満たす。
3. `pnpm typecheck`・`pnpm exec eslint .`・`pnpm exec prettier --check .` がすべてエラーなしで終わる。
4. `import-x/no-cycle` がエラー設定で有効になっており、わざと作った循環を検出することを実地で確認済みである（Task 1）。
5. `packages/board-model` と `packages/schematic-core` が外部ランタイム依存を持たない（`dependencies` は workspace 内のパッケージのみ）。
6. 回路図（`SchematicDocument`）から `toSession()` → `toNetlist()` → `Simulation` の順に通して、自己保持・インターロック・オンディレー・フリッカの4回路が期待どおり動く。
7. 盤定義が実物の写真（`docs/reference/K96-CS3-board-photo.png`）と食い違わない（ソケット8個・左右4個ずつ、ネジ端子は上下2ティア、上段左にDC24V供給端子・上段右にブレーカ、中段に端子台8P/12P、下段に PL4/PB4、ダクトなし）。
8. `routeSession()` で解いた配線が、**どの部品の占有矩形の内側も通らない**（自己保持・フリッカ相当の配線と既設の青線ハーネスで検証済み）。経路は直角セグメントのみで構成され、同じ帯の同じ区間を走る電線はレーンが重ならない。
9. `assignToBoard()` が生成する配線で、**どの端子も2本以内**に収まる（既設配線ぶんを含む）。`P.1` / `N.1` は既設1本＋鎖の先頭1本のちょうど2本。

---

## 改訂履歴

- **2026-09-14**: 依頼者から提供された実物写真（`docs/reference/K96-CS3-board-photo.png`、OMRON 形 K96-CS3）に合わせて盤配置と経路生成を改訂した。
  - 盤の形状を傾斜コンソールとし、`BoardDefinition.console`（`slopeDeg` / `frontHeightMm` / `rearHeightMm`）を追加（Task 4）。
  - 盤面を 330 × 300mm から **330 × 245mm** に、筐体厚を 110mm から **50mm** に変更（写真のメトリック復元による）。上段左=DC24V供給端子、上段右=ブレーカ、上段中=ソケット、中段=端子台8P/12P、下段=PL4/PB4 の座標をすべて写真の実測から引き直した（Task 4）。
  - 物理ソケットを 5個から **8個**（`S1`〜`S8`、左右4個ずつ）に増やし、`SocketRoles` を `Partial` にして役割なしの予備ソケットを表せるようにした。既定割当 `DEFAULT_SOCKET_ROLES` を追加（Task 4・5）。
  - PB／PL 本体と端子台の間の既設リンクに写真どおりの色（青）を持たせた（Task 4）。
  - **ダクトを廃止**し（写真に無い）、`routing.ts` を「盤面から持ち上げた弧」に置き換えた。`DuctSegment` / `ducts` / `nearestDuctPoint` を削除（Task 4・9）。
  - 上記に伴い Task 1・6・11・12・15 は内容変更なし、Task 3・7・8・10・13・14・16 は 8ソケット化などに合わせて更新した。
  - **経路方式を「緩い弧」から「直角配線」に差し替え**（依頼者の指摘）。盤定義に部品の占有矩形 `footprints` と配線帯 `wiringChannels` を追加し、`routeWire()` は端子 → 垂直に引き出し → 配線帯 → 直角走行 → 端子 という経路を作る。**電線が部品の上を通らないことを必須制約**にし、違反すれば `RoutingError` で失敗する。レーンは帯ごとの区間彩色、角は半径6mmのフィレット（Task 3・4・9）。
  - ソケットのネジ端子を実形状に合わせ、**奥端と手前端の2ティア**（段1・2／段3・4）に分け、中央を差込穴領域にした。本体寸法・差込穴・端子の銘板（`label`）を盤定義に追加（Task 4）。
  - PB／PL の本体端子を機器の**根元**に移し、盤面の**貫通穴** `panelHole` を追加。既設の青線ハーネスは `routeFixedLinks()` が「端子台から手前へ降りて貫通穴へ」の形で引く（Task 4・9）。
  - 既設固定配線の色を**黄から青**に変更（依頼者の実機に合わせる。`locked: true` で既設かどうかを判別する）。
  - **P/N 供給端子を各1本（`P.1` / `N.1`）に確定**し、母線の割当を**渡り配線（鎖状）**に変更した。チェック用の既設配線が `P.1` / `N.1` を各1本使うので、鎖の先頭に出せるのは各1本になる。これに伴い「供給端子が足りません」エラーは無くなり、超過は端子本数エラーとして現れる（Task 4・7・8・13・14）。
  - 同じ列（端子台の1列／ソケットの同じティア）の渡り線が配線帯を大回りしないよう、**列から5mm張り出す短い直角経路**を経路器に追加した（Task 9）。
