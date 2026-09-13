# Plan 1A: モノレポ雛形 + 回路エンジン circuit-sim 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pnpm モノレポの雛形を作り、その上に設計仕様書 §5 の全機能（節点解析・部品動作モデル・故障注入・テスター測定・危険操作検知・信号ログ・判定比較）を満たす純TypeScript 製の回路エンジン `@ojt/circuit-sim` を、§14.1 の Phase 1 対象ゴールデンケースが全て通る状態で実装する。

**Architecture:** `packages/circuit-sim` は UI に一切依存しない純TypeScriptパッケージで、`Netlist`（部品・電線・0Ωリンク）を union-find で節点に畳み、各tickで抵抗回路の節点解析を解き、その解からリレー／タイマの状態機械を進めて接点を更新する。副作用は `Simulation` インスタンスの内部状態（`SignalLog` と `EventBus`）だけに閉じ、乱数を使わないため同じネットリストと同じ操作列からは必ず同じログが出る。測定API（`meter.ts`）と判定API（`compare.ts`）はこのログと解を読むだけの純関数群として外側に置く。

**Tech Stack:** Node.js 22以上 / pnpm workspace / TypeScript 6（`strict` ＋ `noUncheckedIndexedAccess`、`moduleResolution: bundler`、`verbatimModuleSyntax`）/ Vitest 5（+ @vitest/coverage-v8）/ ESLint 10 flat config ＋ typescript-eslint / Prettier 3。外部ランタイム依存はゼロ。

---

## ファイル構成

### ルート（Task 2・3 で作る）

| ファイル | 単一責務 |
|---|---|
| `package.json` | ワークスペースのルート。`private`、`packageManager` によるpnpm固定、`engines.node`、`test`/`typecheck`/`lint`/`format` スクリプトの定義 |
| `pnpm-workspace.yaml` | ワークスペースに含めるディレクトリ（`packages/*`, `apps/*`）の宣言 |
| `tsconfig.base.json` | 全パッケージ共通のコンパイラオプション（strict系・ES2022・bundler解決） |
| `tsconfig.json` | ルート直下の設定ファイル群を型検査の対象に入れるためだけのプロジェクト |
| `vitest.workspace.ts` | Vitest のプロジェクト一覧（globのみを持つ） |
| `vitest.config.ts` | ルートから全プロジェクトのテストを走らせるための設定。`vitest.workspace.ts` を読む |
| `eslint.config.js` | ESLint flat config（typescript-eslint の型情報つきルール） |
| `.prettierrc.json` | Prettier の整形規則 |
| `.prettierignore` | Prettier の対象外（lockfile・生成物） |
| `.editorconfig` | エディタ共通のインデント・改行・文字コード |
| `.nvmrc` | 想定するNodeメジャーバージョン |
| `.gitignore` | 生成物の除外（既存ファイルに追記） |

### `packages/circuit-sim`（Task 4 以降）

| ファイル | 単一責務 |
|---|---|
| `package.json` | パッケージ名 `@ojt/circuit-sim`、ESM、`exports`、`test`/`typecheck` スクリプト |
| `tsconfig.json` | `tsconfig.base.json` を継承し、このパッケージの対象ファイルを指定する |
| `vitest.config.ts` | テストの対象glob、カバレッジ設定（v8・しきい値90%） |
| `src/ids.ts` | 識別子の型と生成・分解。`PartId` / `WireId` / `TerminalId`（ブランド型）、`terminalId()`、`parseTerminalId()` |
| `src/elements.ts` | 電気的実体の型と定数。`SourceElement` / `ContactElement` / `LoadElement` / `LinkElement` と、それぞれの現在抵抗を返す純関数 |
| `src/parts.ts` | 部品ファクトリ。リレー・タイマ・押ボタン・ランプ・ブザー・電源・端子台リンクを「端子集合＋要素集合」として組み立てる |
| `src/netlist.ts` | `Netlist`（parts / wires / links）と、その編集・計数、union-find による `buildNets()` |
| `src/solver.ts` | 抵抗回路の節点解析。コンダクタンス行列の組み立てとガウス消去 |
| `src/events.ts` | `HazardEvent` / `ChatterEvent` の型と `EventBus`（購読・発行・計数） |
| `src/log.ts` | `SignalLog`。tickごとの監視信号をランレングスで記録し、遷移列を返す |
| `src/actuators.ts` | 手動操作の適用と電源ON/OFF手順の検査（純関数） |
| `src/simulation.ts` | `Simulation` クラス。1tickの処理順の定義、リレー／タイマ状態機械、保護動作、チャタリング検出 |
| `src/faults.ts` | `injectFault()` / `clearFaults()`。9種の故障をネットリストに適用する |
| `src/meter.ts` | テスター測定。DCV・Ω・導通の3関数と等価抵抗の計算 |
| `src/compare.ts` | `compareLogs()`。模範ログと訓練者ログを許容差つきで突き合わせる |
| `src/index.ts` | 公開API。他パッケージはこのファイル経由でのみ参照する |
| `test/helpers/circuits.ts` | テスト専用の糖衣（端子ID・電線の短縮生成、通電手順、信号取り出し） |
| `test/ids.test.ts` 〜 `test/compare.test.ts` | 各モジュールの単体テスト（モジュール名に対応） |
| `test/golden-basic.test.ts` | ゴールデンケース①: a接点・b接点・AND・OR・自己保持2形・インターロック・新入力優先・極性違反 |
| `test/golden-timer.test.ts` | ゴールデンケース②: オンディレー・オフディレー・ワンショット・フリッカ・タイマ復帰時間 |
| `test/golden-forbidden.test.ts` | ゴールデンケース③: 禁則回路2種のチャタリング検出 |
| `test/golden-fault-meter.test.ts` | ゴールデンケース④: 故障注入・測定・短絡保護・手順違反・決定論・端子本数 |
| `test/golden-judge.test.ts` | ゴールデンケース⑤: 判定の許容差 |

### この計画に含めないもの

`board-model` / `content` / `schematic-core` / `apps/desktop` は Plan 1B 以降で作る。`import/no-cycle`（仕様 §4.2）はパッケージが2つ以上になる Plan 1B で `eslint-plugin-import-x` とともに追加する（単一パッケージでは検出対象が存在しないため）。

---

## Task 1: 環境確認とツール導入

**Files:**
- Create: なし（確認のみ）

計画執筆時点の実機（Windows 11 / PowerShell）での確認結果は以下。実行者は同じコマンドで自分の環境を確認し、足りないものだけ導入する。

| コマンド | 執筆時の実測 | 必要条件 |
|---|---|---|
| `node -v` | `v25.9.0` | 22以上 |
| `pnpm -v` | `11.2.2` | 9以上 |
| `git --version` | `git version 2.53.0.windows.2` | 任意 |
| `corepack --version` | **未インストール**（`CommandNotFoundException`） | 不要（pnpmが直接入っているため） |
| `npm -v` | `11.12.1` | pnpm導入のフォールバックに使う |

- [x] バージョンを確認する。

```powershell
node -v; pnpm -v; git --version; npm -v
```

期待出力（バージョン番号は環境により異なってよい）:

```
v25.9.0
11.2.2
git version 2.53.0.windows.2
11.12.1
```

- [x] `node -v` が出ない、または 22未満だった場合のみ: **人手作業として** <https://nodejs.org> から Node 22 LTS の Windows x64 インストーラ（`.msi`）を入手して実行し、PowerShell を開き直してから `node -v` が `v22.` 以上を表示することを確認する。以降のタスクはこの確認が通るまで進めない。

- [x] `pnpm -v` が出なかった場合のみ、次の順で試す。

```powershell
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v
```

`corepack : The term 'corepack' is not recognized ...` と出る（＝corepackが無い）場合は次を使う。

```powershell
npm i -g pnpm
pnpm -v
```

期待出力: `9.x.x` 以上のバージョン番号が1行。

- [x] リポジトリのルートで作業していることを確認する。

```powershell
git rev-parse --show-toplevel
```

期待出力: `C:/Users/.../OJT`（このリポジトリのルート）。

このタスクではコミットしない。

---

## Task 2: ルートのモノレポ雛形

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `.editorconfig`, `.nvmrc`
- Modify: `.gitignore`

- [x] `pnpm-workspace.yaml` を作る。

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [x] `package.json` を作る。`packageManager` は **Task 1 で確認した `pnpm -v` の値をそのまま** 書く（執筆時の実機は 11.2.2。corepack が無い環境では、ここに実機と違う系列を書くとpnpmが自分自身の別バージョンをダウンロードしようとして詰まるため、実測値に合わせる）。

```json
{
  "name": "ojt-electrical-trainer",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.2.2",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^26.5.1",
    "@vitest/coverage-v8": "^5.0.0",
    "eslint": "^10.10.0",
    "prettier": "^3.9.6",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.70.0",
    "vitest": "^5.0.0"
  }
}
```

> TypeScript は `~6.0.3` に固定する。最新の 7.0 系では typescript-eslint 8 系が `typescript-eslint does not support TS 7.0.` で起動しないことを確認済み。

- [x] `tsconfig.base.json` を作る。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "declaration": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [x] `tsconfig.json` を作る（ルート直下の設定ファイルを型検査・lintの対象に入れるためだけのプロジェクト）。

```json
{
  "extends": "./tsconfig.base.json",
  "include": ["vitest.config.ts", "vitest.workspace.ts", "eslint.config.js"]
}
```

- [x] `.nvmrc` を作る（内容は1行）。

```
22
```

- [x] `.editorconfig` を作る。

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [x] `.gitignore` に次の5行が含まれていなければ追記する。

```
node_modules/
dist/
coverage/
*.tsbuildinfo
.DS_Store
```

- [x] 依存をインストールする。

```powershell
pnpm install
```

期待出力の末尾（バージョンは上記のとおり）:

```
devDependencies:
+ @eslint/js 10.0.1
+ @types/node 26.5.1
+ @vitest/coverage-v8 5.0.0
+ eslint 10.10.0
+ prettier 3.9.6
+ typescript 6.0.3
+ typescript-eslint 8.70.0
+ vitest 5.0.0
```

- [x] TypeScript が意図したバージョンで入ったことを確認する。

```powershell
pnpm exec tsc -v
```

期待出力: `Version 6.0.3`（`7.0.x` が出たら `package.json` の `typescript` を `~6.0.3` に直して `pnpm install` をやり直す）。

- [x] コミットする。

```powershell
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json .editorconfig .nvmrc .gitignore
git commit -m @'
chore: scaffold pnpm workspace root

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 3: Lint と Format の設定

**Files:**
- Create: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`

- [x] `.prettierrc.json` を作る。

```json
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

- [x] `.prettierignore` を作る。

```
pnpm-lock.yaml
node_modules
coverage
dist
```

- [x] `eslint.config.js` を作る。

```js
import js from '@eslint/js';
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
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
);
```

- [x] lint が通ることを確認する（この時点では対象ファイルがルートの設定ファイルだけ）。

```powershell
pnpm exec eslint .
```

期待出力: 何も表示されず終了（終了コード0）。`was not found by the project service` と出る場合は `tsconfig.json` の `include` に該当ファイルが入っていない。

- [x] 整形が揃っていることを確認する。

```powershell
pnpm exec prettier --check .
```

期待出力: `All matched files use Prettier code style!`（崩れていたら `pnpm exec prettier --write .` を実行してからもう一度確認する）

- [x] コミットする。

```powershell
git add eslint.config.js .prettierrc.json .prettierignore
git commit -m @'
chore: add eslint flat config and prettier settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 4: circuit-sim パッケージの雛形

**Files:**
- Create: `vitest.workspace.ts`, `vitest.config.ts`, `packages/circuit-sim/package.json`, `packages/circuit-sim/tsconfig.json`, `packages/circuit-sim/vitest.config.ts`, `packages/circuit-sim/src/index.ts`
- Test: `packages/circuit-sim/test/scaffold.test.ts`

このタスクは「ダミーテスト1本が通ること」をもってスキャフォールド完了とする。

- [x] 失敗するテストを書く。`packages/circuit-sim/test/scaffold.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('scaffold', () => {
  it('パッケージ名を公開している', () => {
    expect(PACKAGE_NAME).toBe('@ojt/circuit-sim');
  });
});
```

- [x] `packages/circuit-sim/package.json` を作る。

```json
{
  "name": "@ojt/circuit-sim",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [x] `packages/circuit-sim/tsconfig.json` を作る。

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

- [x] `packages/circuit-sim/vitest.config.ts` を作る。

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

- [x] ルートの `vitest.workspace.ts` を作る。

```ts
export default ['packages/*', 'apps/*'];
```

- [x] ルートの `vitest.config.ts` を作る（Vitest 5 は `vitest.workspace.ts` を自動では読まないため、`projects` として明示的に読み込む）。

```ts
import { defineConfig } from 'vitest/config';
import projects from './vitest.workspace.js';

export default defineConfig({ test: { projects } });
```

- [x] テストが失敗することを確認する。

```powershell
pnpm install
pnpm --filter @ojt/circuit-sim test
```

期待出力（`src/index.ts` がまだ無いため解決に失敗する）:

```
Error: Failed to load url ../src/index.js
```

- [x] `packages/circuit-sim/src/index.ts` を作る（Task 17 で公開APIの再輸出に置き換える）。

```ts
/** パッケージ名。スキャフォールドの疎通確認用。 */
export const PACKAGE_NAME = '@ojt/circuit-sim';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [x] ルートからも全プロジェクトのテストが走ることを確認する。

```powershell
pnpm test
pnpm exec vitest run
```

期待出力: どちらも `Test Files  1 passed (1)` / `Tests  1 passed (1)`。

- [x] 型検査と lint を確認する。

```powershell
pnpm typecheck
pnpm exec eslint .
```

期待出力: `tsc` は何も出さず終了、`eslint` も何も出さず終了。

- [x] コミットする。

```powershell
git add vitest.workspace.ts vitest.config.ts packages/circuit-sim pnpm-lock.yaml
git commit -m @'
chore(circuit-sim): scaffold package with vitest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 5: src/ids.ts — 識別子

**Files:**
- Create: `packages/circuit-sim/src/ids.ts`
- Test: `packages/circuit-sim/test/ids.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

- [x] 失敗するテストを書く。`packages/circuit-sim/test/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  IdError,
  parseTerminalId,
  partId,
  terminalId,
  terminalOwner,
  wireId,
} from '../src/index.js';

describe('ids', () => {
  it('部品IDと端子名から端子IDを組み立てる（§6.4）', () => {
    expect(terminalId('CR1', '13')).toBe('CR1.13');
    expect(terminalId('PL1', '+')).toBe('PL1.+');
    expect(terminalId('TB_PB', '4c')).toBe('TB_PB.4c');
  });

  it('端子名側には "." を含んでよい', () => {
    expect(terminalId('PLC', '0.00')).toBe('PLC.0.00');
    expect(parseTerminalId('PLC.0.00')).toEqual({ part: 'PLC', name: '0.00' });
  });

  it('端子IDを分解する', () => {
    expect(parseTerminalId('CR1.13')).toEqual({ part: 'CR1', name: '13' });
    expect(terminalOwner(terminalId('CR1', '9'))).toBe('CR1');
  });

  it('不正な識別子は IdError を投げる', () => {
    expect(() => partId('')).toThrow(IdError);
    expect(() => partId('CR.1')).toThrow(IdError);
    expect(() => wireId('')).toThrow(IdError);
    expect(() => terminalId('CR1', '')).toThrow(IdError);
    expect(() => parseTerminalId('CR1')).toThrow(IdError);
    expect(() => parseTerminalId('.13')).toThrow(IdError);
    expect(() => parseTerminalId('CR1.')).toThrow(IdError);
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- ids.test.ts
```

期待出力の冒頭: `Error: No test suite found` ではなく、`does not provide an export named 'terminalId'` 相当の解決エラー（`src/index.ts` がまだ `PACKAGE_NAME` しか公開していないため）。

- [x] `packages/circuit-sim/src/ids.ts` を書く。

```ts
/**
 * 端子・部品・電線の識別子。実行時は素の文字列だが、型の上では取り違えを防ぐためブランドを付ける。
 */

/** 部品インスタンスID（例: `CR1`, `PB1`, `PS`）。`.` を含まない。 */
export type PartId = string & { readonly __brand: 'PartId' };

/** 電線ID（例: `w-001`）。 */
export type WireId = string & { readonly __brand: 'WireId' };

/** 端子ID。`<部品ID>.<端子名>` 形式（設計仕様 §6.4）。端子名側には `.` を含んでよい（例: `PLC.0.00`）。 */
export type TerminalId = `${PartId}.${string}` & { readonly __brand: 'TerminalId' };

/** 識別子が不正なときに投げる。 */
export class IdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdError';
  }
}

/** 文字列を PartId にする。空文字と `.` を含む文字列は拒否する。 */
export function partId(raw: string): PartId {
  if (raw.length === 0) throw new IdError('部品IDが空です');
  if (raw.includes('.')) throw new IdError(`部品IDに "." は使えません: ${raw}`);
  return raw as PartId;
}

/** 文字列を WireId にする。 */
export function wireId(raw: string): WireId {
  if (raw.length === 0) throw new IdError('電線IDが空です');
  return raw as WireId;
}

/** 部品IDと端子名から端子IDを組み立てる（設計仕様 §6.4）。 */
export function terminalId(part: PartId | string, name: string): TerminalId {
  const p = partId(part);
  if (name.length === 0) throw new IdError(`端子名が空です: ${p}`);
  return `${p}.${name}` as TerminalId;
}

/** 端子IDを部品IDと端子名に分解する。最初の `.` で分割する。 */
export function parseTerminalId(id: TerminalId | string): { part: PartId; name: string } {
  const dot = id.indexOf('.');
  if (dot <= 0 || dot === id.length - 1) throw new IdError(`端子IDの形式が不正です: ${id}`);
  return { part: id.slice(0, dot) as PartId, name: id.slice(dot + 1) };
}

/** 端子IDが属する部品IDを返す。 */
export function terminalOwner(id: TerminalId): PartId {
  return parseTerminalId(id).part;
}
```

- [x] `packages/circuit-sim/src/index.ts` を次の内容に置き換える（`PACKAGE_NAME` は役目を終えたので消し、`test/scaffold.test.ts` も削除する）。

```ts
export {
  IdError,
  parseTerminalId,
  partId,
  terminalId,
  terminalOwner,
  wireId,
  type PartId,
  type TerminalId,
  type WireId,
} from './ids.js';
```

```powershell
Remove-Item packages\circuit-sim\test\scaffold.test.ts
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- ids.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add branded terminal and part identifiers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 6: src/elements.ts — 要素の型と定数

**Files:**
- Create: `packages/circuit-sim/src/elements.ts`
- Test: `packages/circuit-sim/test/elements.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

このタスクのテストは Task 7 の `createRelay4c()` を使うため、**Task 7 を先に読み、`parts.ts` を作ってからテストを書く**のではなく、テストを先に書いて `createRelay4c` が無いことで失敗させ、Task 7 完了時に通る形にする。そのためこのタスクでは実装のみを追加し、テストの成功確認は Task 7 の末尾で行う。

- [x] 失敗するテストを書く。`packages/circuit-sim/test/elements.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CLOSED_CONTACT_OHMS,
  COIL_OHMS,
  contactOhms,
  createRelay4c,
  isContactClosed,
  loadOhms,
} from '../src/index.js';
import type { ContactElement, LoadElement } from '../src/index.js';

function pick(elementId: string): ContactElement {
  const el = createRelay4c('CR1').elements.find((e) => e.id === elementId);
  if (el === undefined || el.kind !== 'contact') throw new Error(elementId);
  return el;
}

function coil(): LoadElement {
  const el = createRelay4c('CR1').elements.find((e) => e.id === 'CR1:coil');
  if (el === undefined || el.kind !== 'load') throw new Error('CR1:coil');
  return el;
}

describe('elements', () => {
  it('a接点は励磁で閉じ、b接点は励磁で開く（§5.1.2）', () => {
    const a = pick('CR1:a1');
    const b = pick('CR1:b1');
    expect(isContactClosed(a)).toBe(false);
    expect(isContactClosed(b)).toBe(true);
    a.energized = true;
    b.energized = true;
    expect(isContactClosed(a)).toBe(true);
    expect(isContactClosed(b)).toBe(false);
  });

  it('不導通・溶着は駆動状態より優先される（§5.4）', () => {
    const open = pick('CR1:a1');
    open.energized = true;
    open.fault = { kind: 'open' };
    expect(isContactClosed(open)).toBe(false);
    expect(contactOhms(open)).toBeUndefined();

    const welded = pick('CR1:a1');
    welded.fault = { kind: 'welded' };
    expect(isContactClosed(welded)).toBe(true);
    expect(contactOhms(welded)).toBe(CLOSED_CONTACT_OHMS);
  });

  it('接触不良は直列抵抗になる（§5.4）', () => {
    const el = pick('CR1:a1');
    el.energized = true;
    expect(contactOhms(el)).toBe(CLOSED_CONTACT_OHMS);
    el.fault = { kind: 'resistive', ohms: 500 };
    expect(contactOhms(el)).toBe(500);
  });

  it('コイル抵抗は 650Ω、レアショートで公称値×ratio になる（§5.1.3）', () => {
    const normal = coil();
    expect(loadOhms(normal)).toBe(COIL_OHMS);
    const layer = coil();
    layer.fault = { kind: 'layerShort', ratio: 0.65 };
    expect(loadOhms(layer)).toBeCloseTo(422.5, 6);
    const broken = coil();
    broken.fault = { kind: 'open' };
    expect(loadOhms(broken)).toBeUndefined();
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- elements.test.ts
```

期待出力の冒頭: `does not provide an export named 'createRelay4c'`。

- [x] `packages/circuit-sim/src/elements.ts` を書く。

```ts
import type { PartId, TerminalId } from './ids.js';

/** tick長（ms）。設計仕様 §5.2。 */
export const TICK_MS = 10;
/** DC24V電源の公称出力電圧[V]。§5.1.1 */
export const SOURCE_VOLTS = 24;
/** DC24V電源の内部抵抗[Ω]。§5.1.1 */
export const SOURCE_INTERNAL_OHMS = 0.1;
/** 過電流保護のしきい値[A]。§5.1.1 */
export const PROTECTION_AMPS = 1;
/** 閉じた接点の抵抗[Ω]（=1000S）。§5.2 */
export const CLOSED_CONTACT_OHMS = 0.001;
/** CRコイル／Tの電源の抵抗[Ω]。§5.1.3 */
export const COIL_OHMS = 650;
/** PL（DC24V表示灯）の抵抗[Ω]。§5.1.3 */
export const LAMP_OHMS = 2400;
/** BZの抵抗[Ω]。§5.1.3 */
export const BUZZER_OHMS = 1000;
/** PLC入力の既定抵抗[Ω]。§5.1.3 */
export const PLC_INPUT_OHMS = 4700;
/** コイル励磁しきい値[V]（定格の80%）。§5.3.1 */
export const PICKUP_VOLTS = 19.2;
/** コイル復帰しきい値[V]（定格の10%）。§5.3.1 */
export const DROPOUT_VOLTS = 2.4;
/** ランプ点灯しきい値[V]（定格の60%）。 */
export const LAMP_LIT_VOLTS = 14.4;
/** ランプ暗点灯しきい値[V]（定格の30%）。 */
export const LAMP_DIM_VOLTS = 7.2;
/** レアショートの既定 ratio。§5.1.3 */
export const DEFAULT_LAYER_SHORT_RATIO = 0.65;
/** レアショートの ratio 下限。§5.1.3 */
export const MIN_LAYER_SHORT_RATIO = 0.4;
/** レアショートの ratio 上限。§5.1.3 */
export const MAX_LAYER_SHORT_RATIO = 0.85;
/** 接触不良の既定直列抵抗[Ω]。§5.4 */
export const DEFAULT_CONTACT_RESISTIVE_OHMS = 500;

/** 接点種別。a=メーク、b=ブレーク。§5.1.2 */
export type ContactKind = 'a' | 'b';

/** 接点の駆動源。§5.1.2 */
export type ContactDriver = 'manual' | 'relay' | 'timer' | 'external';

/** 接点の故障。§5.1.2 / §5.4 */
export type ContactFault =
  { kind: 'open' } | { kind: 'welded' } | { kind: 'resistive'; ohms: number };

/** 負荷種別。§5.1.3 */
export type LoadKind = 'coil' | 'lamp' | 'buzzer' | 'plcInput';

/** 負荷の故障。§5.1.3 */
export type LoadFault = { kind: 'open' } | { kind: 'layerShort'; ratio: number };

/** 直流電源要素。`from` が P(+24V) 側、`to` が N(0V) 側。§5.1.1 */
export interface SourceElement {
  kind: 'source';
  id: string;
  from: TerminalId;
  to: TerminalId;
  volts: number;
  internalOhms: number;
  protectionAmps: number;
  /** ブレーカ・電源スイッチ・保護動作を反映した通電可否。Simulation が毎tick更新する。 */
  enabled: boolean;
}

/** 接点要素。§5.1.2 */
export interface ContactElement {
  kind: 'contact';
  id: string;
  from: TerminalId;
  to: TerminalId;
  contact: ContactKind;
  driver: ContactDriver;
  /** この接点を駆動する部品のID（PB／CR／T）。 */
  driverId: PartId;
  /** c接点の組番号（0起点、0〜3）。§6.2 */
  group: number;
  /** 駆動源が動作位置にあるか（PB押下中／CR励磁中／Tタイムアップ済み）。 */
  energized: boolean;
  closedOhms: number;
  fault?: ContactFault;
}

/** 負荷要素。`from` が +側、`to` が −側。§5.1.3 */
export interface LoadElement {
  kind: 'load';
  id: string;
  from: TerminalId;
  to: TerminalId;
  load: LoadKind;
  nominalOhms: number;
  /** 極性を持つ（コイル）。true なら電圧の符号を見る。§5.3.1 の極性違反 */
  polarized: boolean;
  fault?: LoadFault;
}

/** 0Ω固定リンク要素（部品本体と端子台の間の既設配線）。§6.4 */
export interface LinkElement {
  kind: 'link';
  id: string;
  from: TerminalId;
  to: TerminalId;
  locked: boolean;
}

/** 部品の内部要素。§5.1 */
export type Element = SourceElement | ContactElement | LoadElement | LinkElement;

/** 接点が現在閉じているか。故障を優先して評価する。§5.1.2 */
export function isContactClosed(el: ContactElement): boolean {
  if (el.fault?.kind === 'open') return false;
  if (el.fault?.kind === 'welded') return true;
  return el.contact === 'a' ? el.energized : !el.energized;
}

/** 閉じている接点の抵抗[Ω]。開いているときは undefined。 */
export function contactOhms(el: ContactElement): number | undefined {
  if (!isContactClosed(el)) return undefined;
  if (el.fault?.kind === 'resistive') return el.fault.ohms;
  return el.closedOhms;
}

/** 負荷の抵抗[Ω]。断線しているときは undefined。§5.1.3 */
export function loadOhms(el: LoadElement): number | undefined {
  if (el.fault?.kind === 'open') return undefined;
  if (el.fault?.kind === 'layerShort') return el.nominalOhms * el.fault.ratio;
  return el.nominalOhms;
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  BUZZER_OHMS,
  CLOSED_CONTACT_OHMS,
  COIL_OHMS,
  contactOhms,
  DEFAULT_CONTACT_RESISTIVE_OHMS,
  DEFAULT_LAYER_SHORT_RATIO,
  DROPOUT_VOLTS,
  isContactClosed,
  LAMP_DIM_VOLTS,
  LAMP_LIT_VOLTS,
  LAMP_OHMS,
  loadOhms,
  MAX_LAYER_SHORT_RATIO,
  MIN_LAYER_SHORT_RATIO,
  PICKUP_VOLTS,
  PLC_INPUT_OHMS,
  PROTECTION_AMPS,
  SOURCE_INTERNAL_OHMS,
  SOURCE_VOLTS,
  TICK_MS,
  type ContactDriver,
  type ContactElement,
  type ContactFault,
  type ContactKind,
  type Element,
  type LinkElement,
  type LoadElement,
  type LoadFault,
  type LoadKind,
  type SourceElement,
} from './elements.js';
```

- [x] 型検査が通ることを確認する（テストは Task 7 完了後に通る）。

```powershell
pnpm --filter @ojt/circuit-sim typecheck
```

期待出力: `test/elements.test.ts` の `createRelay4c` が解決できないエラーのみ（`src/` 側のエラーは0件）。

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add element types and electrical constants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 7: src/parts.ts — 部品ファクトリ

**Files:**
- Create: `packages/circuit-sim/src/parts.ts`
- Test: `packages/circuit-sim/test/parts.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

- [x] 失敗するテストを書く。`packages/circuit-sim/test/parts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BUZZER_OHMS,
  clampPreset,
  createBuzzer,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTerminalBlockLink,
  createTimer4c,
  LAMP_OHMS,
  SOURCE_INTERNAL_OHMS,
  SOURCE_VOLTS,
  terminalId,
  TIMER_RANGE_10S_MS,
} from '../src/index.js';

describe('parts', () => {
  it('リレーは14ピンで c接点4組とコイルを持つ（§5.3.1 / §6.2）', () => {
    const cr = createRelay4c('CR1');
    expect(cr.terminals).toHaveLength(14);
    expect(cr.terminals[0]).toBe('CR1.1');
    expect(cr.terminals[13]).toBe('CR1.14');
    expect(cr.elements).toHaveLength(9);
    const coil = cr.elements[0];
    expect(coil?.from).toBe('CR1.14');
    expect(coil?.to).toBe('CR1.13');
    const pairs = cr.elements
      .filter((e) => e.kind === 'contact')
      .map((e) => `${e.id}:${e.from}-${e.to}`);
    expect(pairs).toEqual([
      'CR1:b1:CR1.9-CR1.1',
      'CR1:a1:CR1.9-CR1.5',
      'CR1:b2:CR1.10-CR1.2',
      'CR1:a2:CR1.10-CR1.6',
      'CR1:b3:CR1.11-CR1.3',
      'CR1:a3:CR1.11-CR1.7',
      'CR1:b4:CR1.12-CR1.4',
      'CR1:a4:CR1.12-CR1.8',
    ]);
  });

  it('タイマはリレーとピン互換で、接点の駆動源が timer になる（§5.3.2 / §6.2）', () => {
    const t1 = createTimer4c('T1', 3000);
    expect(t1.terminals).toEqual(createRelay4c('T1').terminals);
    expect(t1.elements.every((e) => e.kind !== 'contact' || e.driver === 'timer')).toBe(true);
    expect(t1.meta.kind === 'timer-h3y4' ? t1.meta.presetMs : 0).toBe(3000);
    expect(t1.meta.kind === 'timer-h3y4' ? t1.meta.rangeMaxMs : 0).toBe(TIMER_RANGE_10S_MS);
    expect(t1.meta.kind === 'timer-h3y4' ? t1.meta.resetGapMs : 0).toBe(100);
  });

  it('タイマ設定値はレンジに丸められる（§5.3.2）', () => {
    expect(clampPreset(50, 10_000)).toBe(100);
    expect(clampPreset(3000, 10_000)).toBe(3000);
    expect(clampPreset(20_000, 10_000)).toBe(10_000);
    const clamped = createTimer4c('T2', 50);
    expect(clamped.meta.kind === 'timer-h3y4' ? clamped.meta.presetMs : 0).toBe(100);
  });

  it('押ボタンは c/a/b の3端子を持つ（§5.3.3）', () => {
    const pb = createPushButton('PB1');
    expect(pb.terminals).toEqual(['PB1.c', 'PB1.a', 'PB1.b']);
    expect(pb.elements.map((e) => e.id)).toEqual(['PB1:a', 'PB1:b']);
  });

  it('ランプとブザーの抵抗値（§5.1.3）', () => {
    const pl = createLamp('PL1', '白');
    expect(pl.terminals).toEqual(['PL1.+', 'PL1.-']);
    expect(pl.elements[0]?.kind === 'load' ? pl.elements[0].nominalOhms : 0).toBe(LAMP_OHMS);
    const bz = createBuzzer('BZ');
    expect(bz.elements[0]?.kind === 'load' ? bz.elements[0].nominalOhms : 0).toBe(BUZZER_OHMS);
  });

  it('電源は DC24V・内部抵抗0.1Ωで、初期状態は非通電（§5.1.1）', () => {
    const ps = createPowerSupply('PS');
    expect(ps.terminals).toEqual(['PS.+', 'PS.-']);
    const source = ps.elements[0];
    expect(source?.kind).toBe('source');
    if (source?.kind !== 'source') throw new Error('source');
    expect(source.volts).toBe(SOURCE_VOLTS);
    expect(source.internalOhms).toBe(SOURCE_INTERNAL_OHMS);
    expect(source.protectionAmps).toBe(1);
    expect(source.enabled).toBe(false);
  });

  it('端子台リンクは既定で locked（§6.4）', () => {
    const link = createTerminalBlockLink('lk-1', terminalId('PB1', 'c'), terminalId('TB_PB', '1c'));
    expect(link).toEqual({
      kind: 'link',
      id: 'lk-1',
      from: 'PB1.c',
      to: 'TB_PB.1c',
      locked: true,
    });
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- parts.test.ts
```

期待出力の冒頭: `does not provide an export named 'createRelay4c'`。

- [x] `packages/circuit-sim/src/parts.ts` を書く。

```ts
import {
  BUZZER_OHMS,
  CLOSED_CONTACT_OHMS,
  COIL_OHMS,
  DROPOUT_VOLTS,
  LAMP_DIM_VOLTS,
  LAMP_LIT_VOLTS,
  LAMP_OHMS,
  PICKUP_VOLTS,
  PROTECTION_AMPS,
  SOURCE_INTERNAL_OHMS,
  SOURCE_VOLTS,
  type ContactElement,
  type Element,
  type LinkElement,
  type LoadElement,
  type SourceElement,
} from './elements.js';
import { partId, terminalId, type PartId, type TerminalId } from './ids.js';

/** タイマの復帰時間[ms]。この長さ未満の通電断では経過時間を保持する。§5.3.2 */
export const TIMER_RESET_GAP_MS = 100;
/** タイマレンジ上限の既定[ms]（0〜10s）。§5.3.2 */
export const TIMER_RANGE_10S_MS = 10_000;
/** タイマレンジ上限（0〜60s）。§5.3.2 */
export const TIMER_RANGE_60S_MS = 60_000;
/** タイマ設定値の下限[ms]。§5.3.2 */
export const TIMER_MIN_PRESET_MS = 100;

/** PLの色。§5.3.4 */
export type LampColor = '白' | '黄' | '緑' | '赤';

/** 部品種別。 */
export type PartKind =
  | 'relay-my4n'
  | 'timer-h3y4'
  | 'pushbutton'
  | 'lamp'
  | 'buzzer'
  | 'power-supply'
  | 'terminal-block';

/** 部品ごとの動作モデル用メタデータ。 */
export type PartMeta =
  | {
      kind: 'relay-my4n';
      coilElementId: string;
      pickupVolts: number;
      dropoutVolts: number;
      operateTicks: number;
      releaseTicks: number;
    }
  | {
      kind: 'timer-h3y4';
      coilElementId: string;
      presetMs: number;
      rangeMaxMs: number;
      pickupVolts: number;
      dropoutVolts: number;
      resetGapMs: number;
    }
  | { kind: 'pushbutton' }
  | { kind: 'lamp'; color: LampColor; loadElementId: string; litVolts: number; dimVolts: number }
  | { kind: 'buzzer'; loadElementId: string; litVolts: number; dimVolts: number }
  | { kind: 'power-supply'; sourceElementId: string }
  | { kind: 'terminal-block' };

/** 部品インスタンス。端子集合と電気的実体（要素集合）からなる。§5.1 */
export interface Part {
  id: PartId;
  kind: PartKind;
  terminals: TerminalId[];
  elements: Element[];
  meta: PartMeta;
}

/** c接点4組のピン割付（COM, b接点, a接点）。§6.2 */
export const SOCKET_CONTACT_PINS: ReadonlyArray<{ com: number; nc: number; no: number }> = [
  { com: 9, nc: 1, no: 5 },
  { com: 10, nc: 2, no: 6 },
  { com: 11, nc: 3, no: 7 },
  { com: 12, nc: 4, no: 8 },
];
/** コイル(+)側のピン番号。§6.2 */
export const SOCKET_COIL_PLUS_PIN = 14;
/** コイル(−)側のピン番号。§6.2 */
export const SOCKET_COIL_MINUS_PIN = 13;

function socketTerminals(id: PartId): TerminalId[] {
  const out: TerminalId[] = [];
  for (let pin = 1; pin <= 14; pin += 1) out.push(terminalId(id, String(pin)));
  return out;
}

function socketContacts(id: PartId, driver: 'relay' | 'timer'): ContactElement[] {
  const out: ContactElement[] = [];
  SOCKET_CONTACT_PINS.forEach((pins, group) => {
    out.push({
      kind: 'contact',
      id: `${id}:b${group + 1}`,
      from: terminalId(id, String(pins.com)),
      to: terminalId(id, String(pins.nc)),
      contact: 'b',
      driver,
      driverId: id,
      group,
      energized: false,
      closedOhms: CLOSED_CONTACT_OHMS,
    });
    out.push({
      kind: 'contact',
      id: `${id}:a${group + 1}`,
      from: terminalId(id, String(pins.com)),
      to: terminalId(id, String(pins.no)),
      contact: 'a',
      driver,
      driverId: id,
      group,
      energized: false,
      closedOhms: CLOSED_CONTACT_OHMS,
    });
  });
  return out;
}

function coilElement(id: PartId): LoadElement {
  return {
    kind: 'load',
    id: `${id}:coil`,
    from: terminalId(id, String(SOCKET_COIL_PLUS_PIN)),
    to: terminalId(id, String(SOCKET_COIL_MINUS_PIN)),
    load: 'coil',
    nominalOhms: COIL_OHMS,
    polarized: true,
  };
}

/** MY4N相当の4cリレー（14ピン）を作る。§5.3.1 */
export function createRelay4c(id: PartId | string): Part {
  const pid = partId(id);
  const coil = coilElement(pid);
  return {
    id: pid,
    kind: 'relay-my4n',
    terminals: socketTerminals(pid),
    elements: [coil, ...socketContacts(pid, 'relay')],
    meta: {
      kind: 'relay-my4n',
      coilElementId: coil.id,
      pickupVolts: PICKUP_VOLTS,
      dropoutVolts: DROPOUT_VOLTS,
      operateTicks: 1,
      releaseTicks: 1,
    },
  };
}

/** タイマ設定値を [100ms, レンジ上限] に収める。§5.3.2 */
export function clampPreset(presetMs: number, rangeMaxMs: number): number {
  return Math.min(Math.max(presetMs, TIMER_MIN_PRESET_MS), rangeMaxMs);
}

/** H3Y-4相当のパワーオンディレータイマ（限時接点4c、瞬時接点なし）を作る。§5.3.2 */
export function createTimer4c(
  id: PartId | string,
  presetMs: number,
  rangeMaxMs: number = TIMER_RANGE_10S_MS,
): Part {
  const pid = partId(id);
  const coil = coilElement(pid);
  return {
    id: pid,
    kind: 'timer-h3y4',
    terminals: socketTerminals(pid),
    elements: [coil, ...socketContacts(pid, 'timer')],
    meta: {
      kind: 'timer-h3y4',
      coilElementId: coil.id,
      presetMs: clampPreset(presetMs, rangeMaxMs),
      rangeMaxMs,
      pickupVolts: PICKUP_VOLTS,
      dropoutVolts: DROPOUT_VOLTS,
      resetGapMs: TIMER_RESET_GAP_MS,
    },
  };
}

/** 自動復帰型の押ボタン（c/a/b端子）を作る。§5.3.3 */
export function createPushButton(id: PartId | string): Part {
  const pid = partId(id);
  const c = terminalId(pid, 'c');
  const a = terminalId(pid, 'a');
  const b = terminalId(pid, 'b');
  return {
    id: pid,
    kind: 'pushbutton',
    terminals: [c, a, b],
    elements: [
      {
        kind: 'contact',
        id: `${pid}:a`,
        from: c,
        to: a,
        contact: 'a',
        driver: 'manual',
        driverId: pid,
        group: 0,
        energized: false,
        closedOhms: CLOSED_CONTACT_OHMS,
      },
      {
        kind: 'contact',
        id: `${pid}:b`,
        from: c,
        to: b,
        contact: 'b',
        driver: 'manual',
        driverId: pid,
        group: 0,
        energized: false,
        closedOhms: CLOSED_CONTACT_OHMS,
      },
    ],
    meta: { kind: 'pushbutton' },
  };
}

/** DC24V表示灯を作る。§5.3.4 */
export function createLamp(id: PartId | string, color: LampColor): Part {
  const pid = partId(id);
  const plus = terminalId(pid, '+');
  const minus = terminalId(pid, '-');
  const load: LoadElement = {
    kind: 'load',
    id: `${pid}:load`,
    from: plus,
    to: minus,
    load: 'lamp',
    nominalOhms: LAMP_OHMS,
    polarized: false,
  };
  return {
    id: pid,
    kind: 'lamp',
    terminals: [plus, minus],
    elements: [load],
    meta: {
      kind: 'lamp',
      color,
      loadElementId: load.id,
      litVolts: LAMP_LIT_VOLTS,
      dimVolts: LAMP_DIM_VOLTS,
    },
  };
}

/** ブザー（任意部品）を作る。§5.3.4 */
export function createBuzzer(id: PartId | string): Part {
  const pid = partId(id);
  const plus = terminalId(pid, '+');
  const minus = terminalId(pid, '-');
  const load: LoadElement = {
    kind: 'load',
    id: `${pid}:load`,
    from: plus,
    to: minus,
    load: 'buzzer',
    nominalOhms: BUZZER_OHMS,
    polarized: false,
  };
  return {
    id: pid,
    kind: 'buzzer',
    terminals: [plus, minus],
    elements: [load],
    meta: {
      kind: 'buzzer',
      loadElementId: load.id,
      litVolts: LAMP_LIT_VOLTS,
      dimVolts: LAMP_DIM_VOLTS,
    },
  };
}

/**
 * DC24V電源を作る。端子は `<id>.+`（P側 +24V）と `<id>.-`（N側 0V）。§6.4
 * ブレーカと電源スイッチはAC一次側であり電気的には解かないため、
 * Simulation の `setBreaker()` / `setSwitch()` が `SourceElement.enabled` を制御する。§5.3.5
 */
export function createPowerSupply(id: PartId | string): Part {
  const pid = partId(id);
  const plus = terminalId(pid, '+');
  const minus = terminalId(pid, '-');
  const source: SourceElement = {
    kind: 'source',
    id: `${pid}:source`,
    from: plus,
    to: minus,
    volts: SOURCE_VOLTS,
    internalOhms: SOURCE_INTERNAL_OHMS,
    protectionAmps: PROTECTION_AMPS,
    enabled: false,
  };
  return {
    id: pid,
    kind: 'power-supply',
    terminals: [plus, minus],
    elements: [source],
    meta: { kind: 'power-supply', sourceElementId: source.id },
  };
}

/** 端子台と部品本体の間の0Ω固定リンクを作る。§6.4 */
export function createTerminalBlockLink(
  id: string,
  from: TerminalId,
  to: TerminalId,
  locked = true,
): LinkElement {
  return { kind: 'link', id, from, to, locked };
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  clampPreset,
  createBuzzer,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTerminalBlockLink,
  createTimer4c,
  SOCKET_COIL_MINUS_PIN,
  SOCKET_COIL_PLUS_PIN,
  SOCKET_CONTACT_PINS,
  TIMER_MIN_PRESET_MS,
  TIMER_RANGE_10S_MS,
  TIMER_RANGE_60S_MS,
  TIMER_RESET_GAP_MS,
  type LampColor,
  type Part,
  type PartKind,
  type PartMeta,
} from './parts.js';
```

- [x] Task 6 と Task 7 のテストが両方通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test
```

期待出力:

```
 Test Files  3 passed (3)
      Tests  15 passed (15)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add part factories for relay, timer, pb, lamp and power supply

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 8: src/netlist.ts — ネットリストと節点構築

**Files:**
- Create: `packages/circuit-sim/src/netlist.ts`, `packages/circuit-sim/test/helpers/circuits.ts`
- Test: `packages/circuit-sim/test/netlist.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

- [x] テスト用の糖衣を作る。`packages/circuit-sim/test/helpers/circuits.ts`（Task 13 で `Simulation` を使うヘルパを追加する）:

```ts
import { createNetlist, createWire, parseTerminalId, terminalId } from '../../src/index.js';
import type { Netlist, Part, TerminalId, Wire, WireColor } from '../../src/index.js';

/** `"CR1.13"` 形式の文字列を TerminalId にする。テストを読みやすくするための糖衣。 */
export function t(id: string): TerminalId {
  const parsed = parseTerminalId(id);
  return terminalId(parsed.part, parsed.name);
}

/** 端子ID文字列から電線を作る。 */
export function w(id: string, from: string, to: string, color: WireColor = '青'): Wire {
  return createWire(id, t(from), t(to), color);
}

/** 部品と電線からネットリストを作る。 */
export function net(parts: Part[], wires: Wire[]): Netlist {
  return createNetlist(parts, wires, []);
}
```

- [x] 失敗するテストを書く。`packages/circuit-sim/test/netlist.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addWire,
  buildNets,
  createLamp,
  createNetlist,
  createPowerSupply,
  createTerminalBlockLink,
  createWire,
  exceedsWireLimit,
  findElement,
  findPart,
  findWire,
  NetlistError,
  removeWire,
  terminalId,
  wireCountAt,
} from '../src/index.js';
import { net, t, w } from './helpers/circuits.js';

describe('netlist', () => {
  it('電線とリンクが端子を同一節点に併合する（§5.1）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+')],
    );
    netlist.links.push(createTerminalBlockLink('lk1', t('PL1.-'), t('PS.-')));
    const nets = buildNets(netlist);
    expect(nets.nodeOf(t('PS.+'))).toBe(nets.nodeOf(t('PL1.+')));
    expect(nets.nodeOf(t('PS.-'))).toBe(nets.nodeOf(t('PL1.-')));
    expect(nets.nodeOf(t('PS.+'))).not.toBe(nets.nodeOf(t('PS.-')));
    expect(nets.nodeCount).toBe(2);
    expect(nets.terminalsOf(nets.nodeOf(t('PS.+')))).toContain('PL1.+');
  });

  it('wire-open の電線は併合しない（§5.4）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+')],
    );
    const wire = findWire(netlist, 'w1');
    expect(wire).toBeDefined();
    if (wire === undefined) throw new Error('w1');
    wire.open = true;
    const nets = buildNets(netlist);
    expect(nets.nodeOf(t('PS.+'))).not.toBe(nets.nodeOf(t('PL1.+')));
  });

  it('未知の端子を引くと NetlistError', () => {
    const nets = buildNets(createNetlist([createPowerSupply('PS')], [], []));
    expect(nets.hasTerminal(terminalId('XX', '1'))).toBe(false);
    expect(() => nets.nodeOf(terminalId('XX', '1'))).toThrow(NetlistError);
    expect(nets.terminalsOf(99)).toEqual([]);
  });

  it('電線の追加・削除と本数の計数（§6.6）', () => {
    const netlist = net([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    addWire(netlist, createWire('w1', t('PS.+'), t('PL1.+')));
    addWire(netlist, createWire('w2', t('PS.+'), t('PL1.-')));
    expect(wireCountAt(netlist, t('PS.+'))).toBe(2);
    expect(exceedsWireLimit(netlist, t('PS.+'))).toBe(false);
    addWire(netlist, createWire('w3', t('PS.+'), t('PS.-')));
    expect(wireCountAt(netlist, t('PS.+'))).toBe(3);
    expect(exceedsWireLimit(netlist, t('PS.+'))).toBe(true);
    expect(() => addWire(netlist, createWire('w3', t('PS.-'), t('PL1.+')))).toThrow(NetlistError);
    expect(removeWire(netlist, 'w3')).toBe(true);
    expect(removeWire(netlist, 'w3')).toBe(false);
    expect(wireCountAt(netlist, t('PS.+'))).toBe(2);
  });

  it('locked の電線は外せない（§6.3）', () => {
    const netlist = net([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    addWire(netlist, createWire('y1', t('PS.+'), t('PL1.+'), '黄', true));
    expect(() => removeWire(netlist, 'y1')).toThrow(NetlistError);
  });

  it('部品・要素を引ける', () => {
    const netlist = net([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    expect(findPart(netlist, 'PL1')?.kind).toBe('lamp');
    expect(findPart(netlist, 'XX')).toBeUndefined();
    expect(findElement(netlist, 'PL1:load')?.kind).toBe('load');
    expect(findElement(netlist, 'nope')).toBeUndefined();
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- netlist.test.ts
```

期待出力の冒頭: `does not provide an export named 'buildNets'`。

- [x] `packages/circuit-sim/src/netlist.ts` を書く。

```ts
import type { Element, LinkElement } from './elements.js';
import { wireId, type TerminalId, type WireId } from './ids.js';
import type { Part } from './parts.js';

/** 電線の色。§6.6 */
export type WireColor = '青' | '白' | '黄';

/** 1端子に接続できる電線の本数上限。§6.6（上限の強制はUI／コンテンツ側の責務） */
export const MAX_WIRES_PER_TERMINAL = 2;

/** 電線。抵抗は理想導体として扱い、節点併合で表現する。§5.1 */
export interface Wire {
  id: WireId;
  from: TerminalId;
  to: TerminalId;
  color: WireColor;
  /** チェック用回路の黄色配線など、変更不可の電線。§6.3 */
  locked: boolean;
  /** `wire-open` 故障。true のとき導通しない。§5.4 */
  open: boolean;
}

/** 回路エンジンが解く対象のデータ構造。§5.1 */
export interface Netlist {
  parts: Part[];
  wires: Wire[];
  /** 部品本体と端子台の間の既設0Ωリンク。§6.4 */
  links: LinkElement[];
}

/** ネットリスト操作の失敗。 */
export class NetlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetlistError';
  }
}

/** 電線を作る。 */
export function createWire(
  id: string,
  from: TerminalId,
  to: TerminalId,
  color: WireColor = '青',
  locked = false,
): Wire {
  return { id: wireId(id), from, to, color, locked, open: false };
}

/** ネットリストを作る。 */
export function createNetlist(
  parts: Part[] = [],
  wires: Wire[] = [],
  links: LinkElement[] = [],
): Netlist {
  return { parts, wires, links };
}

/** 全部品の全要素を順に返す。並び順は parts の並び順・elements の並び順で決まる（決定論）。 */
export function allElements(netlist: Netlist): Element[] {
  const out: Element[] = [];
  for (const part of netlist.parts) out.push(...part.elements);
  return out;
}

/** 部品を探す。 */
export function findPart(netlist: Netlist, id: string): Part | undefined {
  return netlist.parts.find((p) => p.id === id);
}

/** 要素IDで要素を探す。 */
export function findElement(netlist: Netlist, elementId: string): Element | undefined {
  for (const part of netlist.parts) {
    const hit = part.elements.find((e) => e.id === elementId);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** 電線を探す。 */
export function findWire(netlist: Netlist, id: string): Wire | undefined {
  return netlist.wires.find((w) => w.id === id);
}

/** 電線を追加する。同じIDが既にあれば NetlistError。 */
export function addWire(netlist: Netlist, wire: Wire): void {
  if (findWire(netlist, wire.id) !== undefined) {
    throw new NetlistError(`電線IDが重複しています: ${wire.id}`);
  }
  netlist.wires.push(wire);
}

/** 電線を削除する。削除できたら true。locked の電線は NetlistError。§6.3 */
export function removeWire(netlist: Netlist, id: string): boolean {
  const index = netlist.wires.findIndex((w) => w.id === id);
  if (index < 0) return false;
  const wire = netlist.wires[index];
  if (wire !== undefined && wire.locked) {
    throw new NetlistError('チェック用回路の黄色配線は変更できません');
  }
  netlist.wires.splice(index, 1);
  return true;
}

/** その端子に接続されている電線の本数を返す（`wire-open` の電線も本数には数える）。§6.6 */
export function wireCountAt(netlist: Netlist, terminal: TerminalId): number {
  let n = 0;
  for (const w of netlist.wires) {
    if (w.from === terminal) n += 1;
    if (w.to === terminal) n += 1;
  }
  return n;
}

/** その端子が本数上限（2本）を超えているか。§6.6 */
export function exceedsWireLimit(netlist: Netlist, terminal: TerminalId): boolean {
  return wireCountAt(netlist, terminal) > MAX_WIRES_PER_TERMINAL;
}

/** 端子から節点への写像。 */
export interface Nets {
  readonly nodeCount: number;
  readonly terminals: readonly TerminalId[];
  hasTerminal(terminal: TerminalId): boolean;
  /** 端子の節点番号。未知の端子は NetlistError。 */
  nodeOf(terminal: TerminalId): number;
  /** その節点に属する端子一覧。 */
  terminalsOf(node: number): readonly TerminalId[];
}

/**
 * 電線と0Ωリンクで端子を併合し、節点を作る（union-find）。
 * `wire-open` の電線は併合しない（断線）。§5.1 / §5.4
 */
export function buildNets(netlist: Netlist): Nets {
  const index = new Map<string, number>();
  const parent: number[] = [];
  const order: TerminalId[] = [];

  const idx = (t: TerminalId): number => {
    const found = index.get(t);
    if (found !== undefined) return found;
    const next = parent.length;
    index.set(t, next);
    parent.push(next);
    order.push(t);
    return next;
  };
  const parentOf = (i: number): number => parent[i] ?? i;
  const find = (start: number): number => {
    let root = start;
    while (parentOf(root) !== root) root = parentOf(root);
    let cursor = start;
    while (parentOf(cursor) !== cursor) {
      const next = parentOf(cursor);
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (a: TerminalId, b: TerminalId): void => {
    const ra = find(idx(a));
    const rb = find(idx(b));
    if (ra !== rb) parent[rb] = ra;
  };

  for (const part of netlist.parts) {
    for (const t of part.terminals) idx(t);
    for (const el of part.elements) {
      idx(el.from);
      idx(el.to);
    }
  }
  for (const w of netlist.wires) {
    idx(w.from);
    idx(w.to);
  }
  for (const l of netlist.links) {
    idx(l.from);
    idx(l.to);
  }
  for (const w of netlist.wires) if (!w.open) union(w.from, w.to);
  for (const l of netlist.links) union(l.from, l.to);

  const dense = new Map<number, number>();
  const nodeOfTerminal = new Map<string, number>();
  const members = new Map<number, TerminalId[]>();
  order.forEach((t, i) => {
    const root = find(i);
    const known = dense.get(root);
    const node = known ?? dense.size;
    if (known === undefined) dense.set(root, node);
    nodeOfTerminal.set(t, node);
    const bucket = members.get(node);
    if (bucket === undefined) members.set(node, [t]);
    else bucket.push(t);
  });

  return {
    nodeCount: members.size,
    terminals: order,
    hasTerminal: (t) => nodeOfTerminal.has(t),
    nodeOf: (t) => {
      const n = nodeOfTerminal.get(t);
      if (n === undefined) throw new NetlistError(`ネットリストに無い端子です: ${t}`);
      return n;
    },
    terminalsOf: (node) => members.get(node) ?? [],
  };
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  addWire,
  allElements,
  buildNets,
  createNetlist,
  createWire,
  exceedsWireLimit,
  findElement,
  findPart,
  findWire,
  MAX_WIRES_PER_TERMINAL,
  NetlistError,
  removeWire,
  wireCountAt,
  type Netlist,
  type Nets,
  type Wire,
  type WireColor,
} from './netlist.js';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- netlist.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add netlist model and union-find net building

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 9: src/solver.ts — 節点解析

**Files:**
- Create: `packages/circuit-sim/src/solver.ts`
- Test: `packages/circuit-sim/test/solver.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

電源は「P側を固定電位にする」のではなく、**内部抵抗0.1Ωのノートン等価**（P–N間にコンダクタンス10S＋P節点へ240Aの電流源）として行列に加える。固定電位にすると内部抵抗（§5.1.1）を表現できず、P–N直結時の電流が有限値にならないため §5.1.1 の保護判定（>1A）が成立しないためである。基準（0V）にするのは電源のN側節点で、その行・列を消去して解く。

- [x] 失敗するテストを書く。`packages/circuit-sim/test/solver.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildNets,
  createLamp,
  createNetlist,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  solve,
  terminalId,
  voltageAt,
} from '../src/index.js';
import type { Netlist } from '../src/index.js';
import { net, t, w } from './helpers/circuits.js';

function energize(netlist: Netlist, on: boolean): void {
  for (const part of netlist.parts) {
    for (const el of part.elements) if (el.kind === 'source') el.enabled = on;
  }
}

describe('solver', () => {
  it('コイル1個の回路を解く（§5.1.3 の 36.9mA）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    energize(netlist, true);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);
    expect(voltageAt(result, nets, t('PS.+'))).toBeCloseTo(23.996, 2);
    expect(voltageAt(result, nets, t('PS.-'))).toBeCloseTo(0, 6);
    expect(result.elementVolts.get('CR1:coil') ?? 0).toBeCloseTo(23.996, 2);
    expect(result.sourceAmps).toBeCloseTo(0.0369, 3);
  });

  it('非通電の電源は行列に寄与しない', () => {
    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);
    expect(result.sourceAmps).toBe(0);
    expect(voltageAt(result, nets, t('PS.+'))).toBeCloseTo(0, 9);
  });

  it('P–N直結では内部抵抗0.1Ωで240Aが流れる（§5.1.1）', () => {
    const netlist = net([createPowerSupply('PS')], [w('short', 'PS.+', 'PS.-')]);
    energize(netlist, true);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);
    expect(result.sourceAmps).toBeCloseTo(240, 6);
  });

  it('開いた接点は導通しない（§5.2）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    energize(netlist, true);
    const nets = buildNets(netlist);
    expect(solve(netlist, nets).elementAmps.get('PL1:load') ?? 1).toBeCloseTo(0, 6);
    const pb = netlist.parts[1]?.elements[0];
    if (pb?.kind !== 'contact') throw new Error('PB1:a');
    pb.energized = true;
    const closed = solve(netlist, buildNets(netlist));
    expect(closed.elementAmps.get('PL1:load') ?? 0).toBeCloseTo(0.01, 3);
  });

  it('電源が無いネットリストでも解ける', () => {
    const netlist = net([createLamp('PL1', '白')], [w('w1', 'PL1.+', 'PL1.-')]);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);
    expect(result.sourceAmps).toBe(0);
    expect(result.referenceNode).toBe(0);
    expect(solve(createNetlist(), buildNets(createNetlist())).nodeVoltages).toEqual([]);
  });

  it('基準端子を指定でき、ネットリストに無い端子の電位は0', () => {
    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    energize(netlist, true);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets, { reference: t('PS.+') });
    expect(voltageAt(result, nets, t('PS.+'))).toBeCloseTo(0, 9);
    expect(voltageAt(result, nets, t('PS.-'))).toBeCloseTo(-23.996, 2);
    expect(voltageAt(result, nets, terminalId('XX', '1'))).toBe(0);
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- solver.test.ts
```

期待出力の冒頭: `does not provide an export named 'solve'`。

- [x] `packages/circuit-sim/src/solver.ts` を書く。

```ts
import { contactOhms, loadOhms, type SourceElement } from './elements.js';
import type { TerminalId } from './ids.js';
import { allElements, type Nets, type Netlist } from './netlist.js';

/** 全節点に入れる対地漏れコンダクタンス[S]。特異行列を避ける。§5.2 */
export const LEAK_SIEMENS = 1e-9;
/** 想定する節点数の上限。§5.2 */
export const MAX_NODES = 200;
/** ピボットがこの値未満なら特異とみなす。 */
const PIVOT_EPSILON = 1e-18;

/** 数値配列の安全な添字読み（noUncheckedIndexedAccess 対策をここ1か所に閉じ込める）。 */
function at(values: ArrayLike<number>, index: number): number {
  return values[index] ?? 0;
}

/** 1tickぶんの解。 */
export interface SolveResult {
  /** 節点電位[V]。添字は Nets.nodeOf() の返す節点番号。 */
  nodeVoltages: number[];
  /** 要素ID → 要素電圧[V]（V(from) − V(to)）。 */
  elementVolts: Map<string, number>;
  /** 要素ID → 要素電流[A]（from → to を正）。 */
  elementAmps: Map<string, number>;
  /** 通電中の全電源要素の出力電流の合計[A]。§5.1.1 の保護判定に使う。 */
  sourceAmps: number;
  /** 基準（0V）にした節点番号。 */
  referenceNode: number;
}

/** 密行列。noUncheckedIndexedAccess 下でも安全に読み書きするための薄いラッパ。 */
class Matrix {
  private readonly cells: Float64Array;

  constructor(readonly size: number) {
    this.cells = new Float64Array(size * size);
  }

  get(row: number, col: number): number {
    return this.cells[row * this.size + col] ?? 0;
  }

  set(row: number, col: number, value: number): void {
    this.cells[row * this.size + col] = value;
  }

  add(row: number, col: number, value: number): void {
    this.set(row, col, this.get(row, col) + value);
  }

  /* v8 ignore start -- 対称・優対角な行列では行交換が起きないため到達しない防御コード */
  swapRows(a: number, b: number): void {
    for (let c = 0; c < this.size; c += 1) {
      const tmp = this.get(a, c);
      this.set(a, c, this.get(b, c));
      this.set(b, c, tmp);
    }
  }
  /* v8 ignore stop */
}

/** ガウス消去（部分ピボット選択）。特異な列は解を0として続行する。 */
function gaussSolve(a: Matrix, b: Float64Array): Float64Array {
  const n = a.size;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a.get(row, col)) > Math.abs(a.get(pivot, col))) pivot = row;
    }
    /* v8 ignore start -- 全節点に漏れコンダクタンスを入れるため特異・行交換は起きない */
    if (Math.abs(a.get(pivot, col)) < PIVOT_EPSILON) continue;
    if (pivot !== col) {
      a.swapRows(pivot, col);
      const tmp = at(b, pivot);
      b[pivot] = at(b, col);
      b[col] = tmp;
    }
    /* v8 ignore stop */
    const head = a.get(col, col);
    for (let row = col + 1; row < n; row += 1) {
      const factor = a.get(row, col) / head;
      if (factor === 0) continue;
      for (let c = col; c < n; c += 1) a.add(row, c, -factor * a.get(col, c));
      b[row] = at(b, row) - factor * at(b, col);
    }
  }

  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row -= 1) {
    const head = a.get(row, row);
    /* v8 ignore next 4 -- 同上 */
    if (Math.abs(head) < PIVOT_EPSILON) {
      x[row] = 0;
      continue;
    }
    let sum = at(b, row);
    for (let col = row + 1; col < n; col += 1) sum -= a.get(row, col) * at(x, col);
    x[row] = sum / head;
  }
  return x;
}

/** 基準にする節点を選ぶ。通電中の電源のN側 → 最初の電源のN側 → 節点0。 */
function pickReference(netlist: Netlist, nets: Nets, override?: TerminalId): number {
  if (override !== undefined && nets.hasTerminal(override)) return nets.nodeOf(override);
  let firstSource: SourceElement | undefined;
  for (const el of allElements(netlist)) {
    if (el.kind !== 'source') continue;
    firstSource ??= el;
    if (el.enabled) return nets.nodeOf(el.to);
  }
  if (firstSource !== undefined) return nets.nodeOf(firstSource.to);
  return 0;
}

/** 解くときのオプション。 */
export interface SolveOptions {
  /** 0Vの基準にする端子。省略時は電源のN側。 */
  reference?: TerminalId;
}

/**
 * 節点解析（抵抗回路）。§5.2
 * 基準節点を0Vとして消去し、電源は内部抵抗0.1Ωのノートン等価として行列に加える。
 */
export function solve(netlist: Netlist, nets: Nets, options: SolveOptions = {}): SolveResult {
  const n = nets.nodeCount;
  const reference = n === 0 ? 0 : pickReference(netlist, nets, options.reference);
  const elements = allElements(netlist);

  const full = new Matrix(n);
  const inject = new Float64Array(n);
  for (let i = 0; i < n; i += 1) full.add(i, i, LEAK_SIEMENS);

  const stampConductance = (from: number, to: number, g: number): void => {
    if (from === to) return;
    full.add(from, from, g);
    full.add(to, to, g);
    full.add(from, to, -g);
    full.add(to, from, -g);
  };

  for (const el of elements) {
    if (el.kind === 'link') continue; // リンクは buildNets で節点併合済み
    const from = nets.nodeOf(el.from);
    const to = nets.nodeOf(el.to);
    if (el.kind === 'source') {
      if (!el.enabled) continue;
      const g = 1 / el.internalOhms;
      stampConductance(from, to, g);
      inject[from] = at(inject, from) + g * el.volts;
      inject[to] = at(inject, to) - g * el.volts;
    } else if (el.kind === 'contact') {
      const ohms = contactOhms(el);
      if (ohms === undefined) continue;
      stampConductance(from, to, 1 / ohms);
    } else {
      const ohms = loadOhms(el);
      if (ohms === undefined) continue;
      stampConductance(from, to, 1 / ohms);
    }
  }

  // 基準節点の行・列を消去した縮約系を解く
  const nodeOfRow: number[] = [];
  for (let i = 0; i < n; i += 1) if (i !== reference) nodeOfRow.push(i);
  const m = nodeOfRow.length;
  const a = new Matrix(m);
  const b = new Float64Array(m);
  for (let r = 0; r < m; r += 1) {
    const nodeR = at(nodeOfRow, r);
    b[r] = at(inject, nodeR);
    for (let c = 0; c < m; c += 1) {
      const nodeC = at(nodeOfRow, c);
      a.set(r, c, full.get(nodeR, nodeC));
    }
  }
  const solved = gaussSolve(a, b);

  const nodeVoltages = new Array<number>(n).fill(0);
  for (let r = 0; r < m; r += 1) {
    nodeVoltages[at(nodeOfRow, r)] = at(solved, r);
  }

  const elementVolts = new Map<string, number>();
  const elementAmps = new Map<string, number>();
  let sourceAmps = 0;
  for (const el of elements) {
    const volts = at(nodeVoltages, nets.nodeOf(el.from)) - at(nodeVoltages, nets.nodeOf(el.to));
    elementVolts.set(el.id, volts);
    let amps = 0;
    if (el.kind === 'source') {
      amps = el.enabled ? (el.volts - volts) / el.internalOhms : 0;
      sourceAmps += amps;
    } else if (el.kind === 'contact') {
      const ohms = contactOhms(el);
      amps = ohms === undefined ? 0 : volts / ohms;
    } else if (el.kind === 'load') {
      const ohms = loadOhms(el);
      amps = ohms === undefined ? 0 : volts / ohms;
    }
    elementAmps.set(el.id, amps);
  }

  return { nodeVoltages, elementVolts, elementAmps, sourceAmps, referenceNode: reference };
}

/** 指定端子の節点電位[V]。ネットリストに無い端子は 0 を返す。 */
export function voltageAt(result: SolveResult, nets: Nets, terminal: TerminalId): number {
  if (!nets.hasTerminal(terminal)) return 0;
  return at(result.nodeVoltages, nets.nodeOf(terminal));
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  LEAK_SIEMENS,
  MAX_NODES,
  solve,
  voltageAt,
  type SolveOptions,
  type SolveResult,
} from './solver.js';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- solver.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add resistive nodal analysis solver

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 10: src/events.ts — イベント

**Files:**
- Create: `packages/circuit-sim/src/events.ts`
- Test: `packages/circuit-sim/test/events.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

- [x] 失敗するテストを書く。`packages/circuit-sim/test/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CHATTER_MIN_TRANSITIONS, CHATTER_WINDOW_MS, EventBus } from '../src/index.js';
import type { SimEvent } from '../src/index.js';

describe('events', () => {
  it('しきい値は1秒窓・10回（§5.3.2）', () => {
    expect(CHATTER_WINDOW_MS).toBe(1000);
    expect(CHATTER_MIN_TRANSITIONS).toBe(10);
  });

  it('購読・解除・記録', () => {
    const bus = new EventBus();
    const seen: SimEvent[] = [];
    const off = bus.on((e) => seen.push(e));
    bus.emit({ type: 'hazard', kind: 'ohm-on-live', tMs: 10, detail: 'CR1.13-CR1.14' });
    off();
    off();
    bus.emit({ type: 'chatter', signal: 'T1', tMs: 20, count: 12 });
    expect(seen).toHaveLength(1);
    expect(bus.all()).toHaveLength(2);
  });

  it('種別ごとに数えられる（§7.4 の危険操作回数）', () => {
    const bus = new EventBus();
    bus.emit({ type: 'hazard', kind: 'ohm-on-live', tMs: 0, detail: 'a' });
    bus.emit({ type: 'hazard', kind: 'ohm-on-live', tMs: 10, detail: 'b' });
    bus.emit({ type: 'hazard', kind: 'power-sequence-violation', tMs: 20, detail: 'c' });
    bus.emit({ type: 'chatter', signal: 'T1', tMs: 30, count: 11 });
    expect(bus.countOf('ohm-on-live')).toBe(2);
    expect(bus.countOf('power-sequence-violation')).toBe(1);
    expect(bus.countOf('short-circuit-power-on')).toBe(0);
    expect(bus.hazards()).toHaveLength(3);
    expect(bus.chatters('T1')).toHaveLength(1);
    expect(bus.chatters('T2')).toHaveLength(0);
    bus.clear();
    expect(bus.all()).toHaveLength(0);
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- events.test.ts
```

期待出力の冒頭: `does not provide an export named 'EventBus'`。

- [x] `packages/circuit-sim/src/events.ts` を書く。

```ts
/** チャタリング判定の窓[ms]。§5.3.2 */
export const CHATTER_WINDOW_MS = 1000;
/** チャタリング判定の遷移回数しきい値（この回数以上でチャタリング）。§5.3.2 */
export const CHATTER_MIN_TRANSITIONS = 10;

/** 危険操作・保護動作の種別。§5.6 */
export type HazardKind =
  /** 通電中（プローブ間電圧1V以上）にΩ／導通レンジを使った。§5.6 #1 */
  | 'ohm-on-live'
  /** 指示値がレンジ上限を超えた。§5.6 #2 */
  | 'range-exceeded'
  /** 短絡状態で通電し電源保護が動作した。§5.6 #3 */
  | 'short-circuit-power-on'
  /** 電源ON/OFFの手順違反。§5.6 #4 */
  | 'power-sequence-violation'
  /** 1端子に上限（2本）を超えて接続した。§5.6 #5 */
  | 'over-wires-per-terminal';

/** 危険操作イベント。§5.6 */
export interface HazardEvent {
  type: 'hazard';
  kind: HazardKind;
  /** 発生時刻[ms]（判定開始からの経過）。 */
  tMs: number;
  /** UI表示用の補足（端子ID・電流値など）。 */
  detail: string;
}

/** チャタリング検出イベント。§5.3.2 */
export interface ChatterEvent {
  type: 'chatter';
  /** チャタリングした信号名。 */
  signal: string;
  tMs: number;
  /** 直近1秒窓での遷移回数。 */
  count: number;
}

/** エンジンが発行するイベント。 */
export type SimEvent = HazardEvent | ChatterEvent;

/** イベント購読関数。 */
export type EventListener = (event: SimEvent) => void;

/** イベントの発行と購読。発行順は決定論的（登録順に同期呼び出し）。 */
export class EventBus {
  private readonly listeners: EventListener[] = [];
  private readonly recorded: SimEvent[] = [];

  /** 購読する。戻り値を呼ぶと解除される。 */
  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** 発行する。 */
  emit(event: SimEvent): void {
    this.recorded.push(event);
    for (const listener of [...this.listeners]) listener(event);
  }

  /** これまでに発行された全イベント。 */
  all(): readonly SimEvent[] {
    return this.recorded;
  }

  /** 指定種別の危険操作イベントだけを返す。 */
  hazards(kind?: HazardKind): HazardEvent[] {
    return this.recorded.filter(
      (e): e is HazardEvent => e.type === 'hazard' && (kind === undefined || e.kind === kind),
    );
  }

  /** チャタリングイベントだけを返す。 */
  chatters(signal?: string): ChatterEvent[] {
    return this.recorded.filter(
      (e): e is ChatterEvent =>
        e.type === 'chatter' && (signal === undefined || e.signal === signal),
    );
  }

  /** 指定種別の危険操作の発生回数。結果画面の「危険操作回数」に使う。§7.4 */
  countOf(kind: HazardKind): number {
    return this.hazards(kind).length;
  }

  /** 記録を消す。 */
  clear(): void {
    this.recorded.length = 0;
  }
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  CHATTER_MIN_TRANSITIONS,
  CHATTER_WINDOW_MS,
  EventBus,
  type ChatterEvent,
  type EventListener,
  type HazardEvent,
  type HazardKind,
  type SimEvent,
} from './events.js';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- events.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add hazard and chatter event bus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 11: src/log.ts — 信号ログ

**Files:**
- Create: `packages/circuit-sim/src/log.ts`
- Test: `packages/circuit-sim/test/log.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

- [x] 失敗するテストを書く。`packages/circuit-sim/test/log.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { roundSignal, SignalLog } from '../src/index.js';
import type { SignalValue } from '../src/index.js';

function values(pairs: Array<[string, SignalValue]>): Map<string, SignalValue> {
  return new Map(pairs);
}

describe('log', () => {
  it('変化点だけを記録する（ランレングス、§5.7）', () => {
    const log = new SignalLog();
    expect(log.record(0, values([['PL1', false]]))).toEqual(['PL1']);
    expect(log.record(10, values([['PL1', false]]))).toEqual([]);
    expect(log.record(20, values([['PL1', true]]))).toEqual(['PL1']);
    expect(log.entries()).toEqual([
      { tMs: 0, signal: 'PL1', value: false },
      { tMs: 20, signal: 'PL1', value: true },
    ]);
    expect(log.signals()).toEqual(['PL1']);
  });

  it('数値信号は3桁に丸めてから比較する', () => {
    expect(roundSignal(23.9963094)).toBe(23.996);
    const log = new SignalLog();
    log.record(0, values([['CR1.coilV', 23.99630941]]));
    log.record(10, values([['CR1.coilV', 23.99630977]]));
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]?.value).toBe(23.996);
  });

  it('遷移列と時刻指定の値を取り出せる', () => {
    const log = new SignalLog();
    log.record(0, values([['PL1', false]]));
    log.record(100, values([['PL1', true]]));
    log.record(300, values([['PL1', false]]));
    expect(log.transitions('PL1').map((e) => e.tMs)).toEqual([0, 100, 300]);
    expect(log.valueAt('PL1', 50)).toBe(false);
    expect(log.valueAt('PL1', 100)).toBe(true);
    expect(log.valueAt('PL1', 299)).toBe(true);
    expect(log.valueAt('PL1', 1000)).toBe(false);
    expect(log.valueAt('PL2', 0)).toBeUndefined();
    log.clear();
    expect(log.entries()).toHaveLength(0);
    expect(log.signals()).toHaveLength(0);
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- log.test.ts
```

期待出力の冒頭: `does not provide an export named 'SignalLog'`。

- [x] `packages/circuit-sim/src/log.ts` を書く。

```ts
/** 信号値。接点・コイル・ランプは boolean、電位・電流は number。§5.7 */
export type SignalValue = boolean | number;

/** ランレングス記録の1件。§5.7 */
export interface LogEntry {
  tMs: number;
  signal: string;
  value: SignalValue;
}

/** 数値信号を記録する際の小数桁数。丸めないと浮動小数の揺れで毎tick記録されてしまう。 */
export const LOG_DECIMALS = 3;

/** 数値信号を記録用に丸める。 */
export function roundSignal(value: number): number {
  const scale = 10 ** LOG_DECIMALS;
  return Math.round(value * scale) / scale;
}

/**
 * tickごとの監視信号を変化点のみ記録する（ランレングス形式）。§5.7
 * 信号名の規約:
 * - `PB1` … 押下中（boolean）
 * - `CR1` … 接点が動作位置にある（boolean）／`CR1.coil` コイル励磁判定／`CR1.coilV` コイル電圧[V]
 * - `T1`  … 限時接点が反転している（boolean）／`T1.coil` 通電中／`T1.coilV` 電源電圧[V]
 * - `CR1:a1.closed` … 各接点要素の閉（boolean）
 * - `PL1` … 点灯（boolean）／`PL1.level` 0=消灯 1=暗点灯 2=点灯／`PL1.volts` 端子電圧[V]
 * - `V:<端子ID>` … 指定端子の電位[V]
 * - `POWER` … 通電中（boolean）／`POWER.I` 電源電流[A]
 */
export class SignalLog {
  private readonly recorded: LogEntry[] = [];
  private readonly last = new Map<string, SignalValue>();

  /**
   * 1tickぶんを記録する。前回と同じ値の信号は記録しない。
   * @returns 値が変化した（=記録した）信号名の配列。
   */
  record(tMs: number, values: ReadonlyMap<string, SignalValue>): string[] {
    const changed: string[] = [];
    for (const [signal, raw] of values) {
      const value = typeof raw === 'number' ? roundSignal(raw) : raw;
      const previous = this.last.get(signal);
      if (previous !== undefined && previous === value) continue;
      this.last.set(signal, value);
      this.recorded.push({ tMs, signal, value });
      changed.push(signal);
    }
    return changed;
  }

  /** 記録された全エントリ（時刻昇順）。 */
  entries(): readonly LogEntry[] {
    return this.recorded;
  }

  /** 記録されている信号名の一覧（初出順）。 */
  signals(): string[] {
    return [...this.last.keys()];
  }

  /** その信号の変化点の列（最初の記録＝初期値を含む）。 */
  transitions(signal: string): LogEntry[] {
    return this.recorded.filter((e) => e.signal === signal);
  }

  /** その時刻における信号の値。まだ記録が無ければ undefined。 */
  valueAt(signal: string, tMs: number): SignalValue | undefined {
    let value: SignalValue | undefined;
    for (const e of this.recorded) {
      if (e.signal !== signal) continue;
      if (e.tMs > tMs) break;
      value = e.value;
    }
    return value;
  }

  /** 記録を消す。 */
  clear(): void {
    this.recorded.length = 0;
    this.last.clear();
  }
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export { LOG_DECIMALS, roundSignal, SignalLog, type LogEntry, type SignalValue } from './log.js';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- log.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add run-length signal log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 12: src/actuators.ts — 手動操作と電源手順

**Files:**
- Create: `packages/circuit-sim/src/actuators.ts`
- Test: `packages/circuit-sim/test/actuators.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

- [x] 失敗するテストを書く。`packages/circuit-sim/test/actuators.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyPowerAction,
  createPushButton,
  isContactClosed,
  isPowerOn,
  RESET_SEQUENCE,
  setButtonPressed,
} from '../src/index.js';
import type { PowerSwitches } from '../src/index.js';

const OFF: PowerSwitches = { breakerOn: false, switchOn: false };
const BOTH: PowerSwitches = { breakerOn: true, switchOn: true };

describe('actuators', () => {
  it('ON手順はブレーカ→スイッチ（§5.3.5）', () => {
    const first = applyPowerAction(OFF, 'breaker', true);
    expect(first.violation).toBe(false);
    const second = applyPowerAction(first.switches, 'switch', true);
    expect(second.violation).toBe(false);
    expect(isPowerOn(second.switches)).toBe(true);
  });

  it('OFF手順はスイッチ→ブレーカ（§5.3.5）', () => {
    const first = applyPowerAction(BOTH, 'switch', false);
    expect(first.violation).toBe(false);
    const second = applyPowerAction(first.switches, 'breaker', false);
    expect(second.violation).toBe(false);
    expect(isPowerOn(second.switches)).toBe(false);
  });

  it('逆手順は violation になるが操作自体は受理される（決定事項#12）', () => {
    const bad = applyPowerAction(OFF, 'switch', true);
    expect(bad.violation).toBe(true);
    expect(bad.switches.switchOn).toBe(true);
    expect(applyPowerAction(BOTH, 'breaker', true).violation).toBe(true);
    expect(applyPowerAction(BOTH, 'breaker', false).violation).toBe(true);
  });

  it('押ボタンは押下でa閉・b開（§5.3.3）', () => {
    const pb = createPushButton('PB1');
    const a = pb.elements[0];
    const b = pb.elements[1];
    if (a?.kind !== 'contact' || b?.kind !== 'contact') throw new Error('contacts');
    setButtonPressed(pb, true);
    expect(isContactClosed(a)).toBe(true);
    expect(isContactClosed(b)).toBe(false);
    setButtonPressed(pb, false);
    expect(isContactClosed(a)).toBe(false);
    expect(isContactClosed(b)).toBe(true);
  });

  it('保護復帰手順は4手（§5.1.1）', () => {
    expect(RESET_SEQUENCE.map((s) => `${s.device}:${String(s.on)}`)).toEqual([
      'switch:false',
      'breaker:false',
      'breaker:true',
      'switch:true',
    ]);
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- actuators.test.ts
```

期待出力の冒頭: `does not provide an export named 'applyPowerAction'`。

- [x] `packages/circuit-sim/src/actuators.ts` を書く。

```ts
import type { Part } from './parts.js';

/** 電源の開閉器。ブレーカと電源スイッチはAC一次側にあり電気的には解かない。§5.3.5 */
export type PowerDevice = 'breaker' | 'switch';

/** ブレーカ／電源スイッチの状態。§5.3.5 */
export interface PowerSwitches {
  breakerOn: boolean;
  switchOn: boolean;
}

/** 操作の結果。 */
export interface PowerActionResult {
  switches: PowerSwitches;
  /** ON=ブレーカ→スイッチ、OFF=スイッチ→ブレーカ の手順に反したか。§5.3.5 */
  violation: boolean;
}

/**
 * 電源操作を適用する。手順違反でも操作そのものは受理する（練習は中断しない。決定事項#12）。
 * 違反となるのは次の3つ。
 * - スイッチONのときにブレーカON（ブレーカが先でなければならない）
 * - ブレーカOFFのときにスイッチON（ブレーカが先）
 * - スイッチONのままブレーカOFF（スイッチが先）
 */
export function applyPowerAction(
  switches: PowerSwitches,
  device: PowerDevice,
  on: boolean,
): PowerActionResult {
  const next: PowerSwitches = { ...switches };
  let violation = false;
  if (device === 'breaker') {
    if (on && switches.switchOn) violation = true;
    if (!on && switches.switchOn) violation = true;
    next.breakerOn = on;
  } else {
    if (on && !switches.breakerOn) violation = true;
    next.switchOn = on;
  }
  return { switches: next, violation };
}

/** 通電しているか（ブレーカとスイッチが両方ON）。 */
export function isPowerOn(switches: PowerSwitches): boolean {
  return switches.breakerOn && switches.switchOn;
}

/**
 * 押ボタンの押下状態を部品の接点に反映する。
 * a接点は押下で閉、b接点は押下で開（自動復帰型）。§5.3.3
 */
export function setButtonPressed(part: Part, pressed: boolean): void {
  for (const el of part.elements) {
    if (el.kind === 'contact' && el.driver === 'manual') el.energized = pressed;
  }
}

/** 保護動作からの復帰手順（スイッチOFF → ブレーカOFF → ブレーカON → スイッチON）。§5.1.1 */
export const RESET_SEQUENCE: ReadonlyArray<{ device: PowerDevice; on: boolean }> = [
  { device: 'switch', on: false },
  { device: 'breaker', on: false },
  { device: 'breaker', on: true },
  { device: 'switch', on: true },
];
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  applyPowerAction,
  isPowerOn,
  RESET_SEQUENCE,
  setButtonPressed,
  type PowerActionResult,
  type PowerDevice,
  type PowerSwitches,
} from './actuators.js';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- actuators.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add manual actuators and power sequence rules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 13: src/simulation.ts — tickの処理順と状態機械

**Files:**
- Create: `packages/circuit-sim/src/simulation.ts`
- Test: `packages/circuit-sim/test/simulation.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`, `packages/circuit-sim/test/helpers/circuits.ts`

1tickの処理順は「解く → 負荷の通電判定 → リレー／タイマ状態機械 → 接点更新 → 保護判定 → ログ記録」で固定する。リレーの接点は「前tickの励磁判定」を反映するので、コイル電圧がしきい値を越えてから接点が動くまでに1tick（10ms、§5.3.1）の遅れが入る。タイマは経過時間を加算してから設定時間と比較し、到達した tick で限時接点を反転する（§5.3.2）。乱数は一切使わない。

- [x] ヘルパを拡張する。`packages/circuit-sim/test/helpers/circuits.ts` を次の内容に置き換える。

```ts
import {
  createNetlist,
  createWire,
  parseTerminalId,
  Simulation,
  terminalId,
} from '../../src/index.js';
import type {
  Netlist,
  Part,
  SimulationOptions,
  TerminalId,
  Wire,
  WireColor,
} from '../../src/index.js';

/** `"CR1.13"` 形式の文字列を TerminalId にする。テストを読みやすくするための糖衣。 */
export function t(id: string): TerminalId {
  const parsed = parseTerminalId(id);
  return terminalId(parsed.part, parsed.name);
}

/** 端子ID文字列から電線を作る。 */
export function w(id: string, from: string, to: string, color: WireColor = '青'): Wire {
  return createWire(id, t(from), t(to), color);
}

/** 部品と電線からネットリストを作る。 */
export function net(parts: Part[], wires: Wire[]): Netlist {
  return createNetlist(parts, wires, []);
}

/** 部品と電線からシミュレーションを作る。 */
export function bench(parts: Part[], wires: Wire[], options?: SimulationOptions): Simulation {
  return new Simulation(net(parts, wires), options);
}

/** 正しい手順（ブレーカ → 電源スイッチ）で通電する。§5.3.5 */
export function powerOn(sim: Simulation): void {
  sim.setBreaker(true);
  sim.setSwitch(true);
}

/** 正しい手順（電源スイッチ → ブレーカ）で遮断する。§5.3.5 */
export function powerOff(sim: Simulation): void {
  sim.setSwitch(false);
  sim.setBreaker(false);
}

/** その信号が最初に true になった時刻[ms]。 */
export function firstTrue(sim: Simulation, signal: string): number | undefined {
  return sim.log.transitions(signal).find((e) => e.value === true)?.tMs;
}
```

- [x] 失敗するテストを書く。`packages/circuit-sim/test/simulation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createLamp,
  createPowerSupply,
  createPushButton,
  createTimer4c,
  SimulationError,
  TICK_MS,
} from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

function lampBench(): ReturnType<typeof bench> {
  return bench(
    [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
    [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    { watch: [t('PL1.+')] },
  );
}

describe('simulation', () => {
  it('通電していなければ全信号が0のまま（§5.3.5）', () => {
    const sim = lampBench();
    sim.press('PB1');
    sim.run(100);
    expect(sim.state().powered).toBe(false);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    expect(sim.log.valueAt('V:PL1.+', 90)).toBe(0);
  });

  it('step は既定10ms、run は指定時刻まで進める（§5.2）', () => {
    const sim = lampBench();
    expect(sim.tMs).toBe(0);
    sim.step();
    expect(sim.tMs).toBe(TICK_MS);
    sim.run(100);
    expect(sim.tMs).toBe(100);
    expect(sim.log.transitions('POWER')[0]?.tMs).toBe(0);
  });

  it('監視端子の電位がログに残る（§5.7）', () => {
    const sim = lampBench();
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    expect(sim.log.valueAt('V:PL1.+', 90)).toBeCloseTo(23.99, 1);
    expect(sim.log.valueAt('PL1.level', 90)).toBe(2);
  });

  it('タイマ設定はレンジに丸めて反映される（§5.3.2）', () => {
    const sim = bench([createPowerSupply('PS'), createTimer4c('T1', 3000)], []);
    sim.setTimerPreset('T1', 20_000);
    expect(sim.state().timers['T1']?.presetMs).toBe(10_000);
    sim.setTimerPreset('T1', 5000);
    expect(sim.state().timers['T1']?.presetMs).toBe(5000);
    expect(() => sim.setTimerPreset('XX', 1000)).toThrow(SimulationError);
  });

  it('存在しない押ボタンの操作は SimulationError', () => {
    const sim = lampBench();
    expect(() => sim.press('PB9')).toThrow(SimulationError);
    expect(() => sim.release('PB9')).toThrow(SimulationError);
  });

  it('電線の追加と削除が次のtickから反映される', () => {
    const sim = bench(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+')],
    );
    powerOn(sim);
    sim.run(50);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.addWire(w('w2', 'PL1.-', 'PS.-'));
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    expect(sim.removeWire('w2')).toBe(true);
    sim.run(150);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- simulation.test.ts
```

期待出力の冒頭: `does not provide an export named 'Simulation'`。

- [x] `packages/circuit-sim/src/simulation.ts` を書く。

```ts
import { applyPowerAction, isPowerOn, setButtonPressed, RESET_SEQUENCE } from './actuators.js';
import type { PowerDevice, PowerSwitches } from './actuators.js';
import { isContactClosed, loadOhms, TICK_MS } from './elements.js';
import type { LoadElement } from './elements.js';
import { CHATTER_MIN_TRANSITIONS, CHATTER_WINDOW_MS, EventBus } from './events.js';
import type { TerminalId, WireId } from './ids.js';
import { SignalLog } from './log.js';
import type { SignalValue } from './log.js';
import {
  addWire as addWireToNetlist,
  buildNets,
  exceedsWireLimit,
  findElement,
  findPart,
  removeWire as removeWireFromNetlist,
} from './netlist.js';
import type { Nets, Netlist, Wire } from './netlist.js';
import { clampPreset } from './parts.js';
import { solve, voltageAt } from './solver.js';
import type { SolveResult } from './solver.js';

/** ランプの点灯段階。§5.3.4 */
export type LampLevel = 'off' | 'dim' | 'lit';

/** ランプ点灯段階のログ用数値コード。 */
export const LAMP_LEVEL_CODE: Record<LampLevel, number> = { off: 0, dim: 1, lit: 2 };

/** リレーの内部状態。 */
export interface RelayRuntime {
  coilVolts: number;
  /** コイルが励磁判定されているか（しきい値＋ヒステリシス）。§5.3.1 */
  coilOn: boolean;
  /** 接点が動作位置にあるか（励磁から1tick遅れる）。§5.3.1 */
  contactsOn: boolean;
  pendingTicks: number;
}

/** タイマの内部状態。§5.3.2 */
export interface TimerRuntime {
  coilVolts: number;
  powered: boolean;
  elapsedMs: number;
  offMs: number;
  timedOut: boolean;
  presetMs: number;
}

/** ランプ／ブザーの内部状態。 */
export interface LampRuntime {
  volts: number;
  level: LampLevel;
}

/** シミュレーションの公開状態スナップショット。 */
export interface SimulationState {
  tMs: number;
  breakerOn: boolean;
  switchOn: boolean;
  /** 過電流保護が動作中か。§5.1.1 */
  tripped: boolean;
  powered: boolean;
  sourceAmps: number;
  buttons: Record<string, boolean>;
  relays: Record<string, RelayRuntime>;
  timers: Record<string, TimerRuntime>;
  lamps: Record<string, LampRuntime>;
  nodeVoltages: readonly number[];
}

/** シミュレーション生成オプション。 */
export interface SimulationOptions {
  /** 1tickの長さ[ms]。既定10（§5.2）。 */
  tickMs?: number;
  /** 電位をログに残す端子。信号名は `V:<端子ID>`。§5.7 */
  watch?: readonly TerminalId[];
}

/** シミュレーション操作の失敗。 */
export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationError';
  }
}

/**
 * 回路シミュレーション本体。§5.2
 * 1tickの処理順は「解く → 負荷の通電判定 → リレー／タイマ状態機械 → 接点更新 → 保護判定 → ログ記録」。
 * 乱数を使わないため、同じネットリストと同じ操作列からは必ず同じログが出る（決定論）。
 */
export class Simulation {
  readonly netlist: Netlist;
  readonly log = new SignalLog();
  readonly events = new EventBus();

  private readonly tickMs: number;
  private readonly watch: readonly TerminalId[];
  private readonly relays = new Map<string, RelayRuntime>();
  private readonly timers = new Map<string, TimerRuntime>();
  private readonly lamps = new Map<string, LampRuntime>();
  private readonly buttons = new Map<string, boolean>();
  private readonly chatterTimes = new Map<string, number[]>();
  private readonly chatterReported = new Map<string, number>();
  private switches: PowerSwitches = { breakerOn: false, switchOn: false };
  private tripped = false;
  private resetStep = 0;
  private elapsedMs = 0;
  private lastSolve: SolveResult | undefined;

  constructor(netlist: Netlist, options: SimulationOptions = {}) {
    this.netlist = netlist;
    this.tickMs = options.tickMs ?? TICK_MS;
    this.watch = options.watch ?? [];
    for (const part of netlist.parts) {
      const id: string = part.id;
      if (part.meta.kind === 'relay-my4n') {
        this.relays.set(id, { coilVolts: 0, coilOn: false, contactsOn: false, pendingTicks: 0 });
      } else if (part.meta.kind === 'timer-h3y4') {
        this.timers.set(id, {
          coilVolts: 0,
          powered: false,
          elapsedMs: 0,
          offMs: part.meta.resetGapMs,
          timedOut: false,
          presetMs: part.meta.presetMs,
        });
      } else if (part.meta.kind === 'lamp' || part.meta.kind === 'buzzer') {
        this.lamps.set(id, { volts: 0, level: 'off' });
      } else if (part.meta.kind === 'pushbutton') {
        this.buttons.set(id, false);
      }
    }
    this.syncSources();
  }

  /** 現在時刻[ms]（判定開始からの経過）。 */
  get tMs(): number {
    return this.elapsedMs;
  }

  /** 押ボタンを押す。§5.3.3 */
  press(pbId: string): void {
    this.setButton(pbId, true);
  }

  /** 押ボタンを離す。§5.3.3 */
  release(pbId: string): void {
    this.setButton(pbId, false);
  }

  /** ブレーカを入切する。§5.3.5 */
  setBreaker(on: boolean): void {
    this.powerAction('breaker', on);
  }

  /** 電源スイッチを入切する。§5.3.5 */
  setSwitch(on: boolean): void {
    this.powerAction('switch', on);
  }

  /** タイマの設定時間を変える。レンジ内に丸める。§5.3.2 */
  setTimerPreset(timerId: string, presetMs: number): void {
    const part = findPart(this.netlist, timerId);
    if (part === undefined || part.meta.kind !== 'timer-h3y4') {
      throw new SimulationError(`タイマが見つかりません: ${timerId}`);
    }
    const clamped = clampPreset(presetMs, part.meta.rangeMaxMs);
    part.meta.presetMs = clamped;
    const runtime = this.timers.get(timerId);
    if (runtime !== undefined) runtime.presetMs = clamped;
  }

  /** 電線を張る。上限（1端子2本）を超えたら `over-wires-per-terminal` を発行するが接続は保持する。§6.6 */
  addWire(wire: Wire): void {
    addWireToNetlist(this.netlist, wire);
    for (const terminal of [wire.from, wire.to]) {
      if (exceedsWireLimit(this.netlist, terminal)) {
        this.events.emit({
          type: 'hazard',
          kind: 'over-wires-per-terminal',
          tMs: this.tMs,
          detail: terminal,
        });
      }
    }
  }

  /** 電線を外す。 */
  removeWire(id: WireId | string): boolean {
    return removeWireFromNetlist(this.netlist, id);
  }

  /** 1tick進める。 */
  step(dtMs: number = this.tickMs): void {
    this.syncSources();
    const nets = buildNets(this.netlist);
    const solved = solve(this.netlist, nets);
    this.lastSolve = solved;
    this.updateLoads(solved);
    this.updateRelays(solved);
    this.updateTimers(solved, dtMs);
    this.applyContacts();
    this.updateProtection(solved);
    const values = this.snapshot(solved, nets);
    const changed = this.log.record(this.tMs, values);
    this.detectChatter(changed, values);
    this.elapsedMs += dtMs;
  }

  /** 指定時刻に達するまで進める。 */
  run(untilMs: number): void {
    while (this.elapsedMs < untilMs) this.step();
  }

  /** 現在の状態のスナップショット。 */
  state(): SimulationState {
    const relays: Record<string, RelayRuntime> = {};
    for (const [id, st] of this.relays) relays[id] = { ...st };
    const timers: Record<string, TimerRuntime> = {};
    for (const [id, st] of this.timers) timers[id] = { ...st };
    const lamps: Record<string, LampRuntime> = {};
    for (const [id, st] of this.lamps) lamps[id] = { ...st };
    const buttons: Record<string, boolean> = {};
    for (const [id, pressed] of this.buttons) buttons[id] = pressed;
    return {
      tMs: this.elapsedMs,
      breakerOn: this.switches.breakerOn,
      switchOn: this.switches.switchOn,
      tripped: this.tripped,
      powered: isPowerOn(this.switches) && !this.tripped,
      sourceAmps: this.lastSolve?.sourceAmps ?? 0,
      buttons,
      relays,
      timers,
      lamps,
      nodeVoltages: this.lastSolve?.nodeVoltages ?? [],
    };
  }

  private setButton(pbId: string, pressed: boolean): void {
    const part = findPart(this.netlist, pbId);
    if (part === undefined || part.meta.kind !== 'pushbutton') {
      throw new SimulationError(`押ボタンが見つかりません: ${pbId}`);
    }
    setButtonPressed(part, pressed);
    this.buttons.set(pbId, pressed);
  }

  private powerAction(device: PowerDevice, on: boolean): void {
    const current = device === 'breaker' ? this.switches.breakerOn : this.switches.switchOn;
    if (current === on) return;
    const result = applyPowerAction(this.switches, device, on);
    this.switches = result.switches;
    if (result.violation) {
      this.events.emit({
        type: 'hazard',
        kind: 'power-sequence-violation',
        tMs: this.tMs,
        detail: `${device}:${on ? 'on' : 'off'}`,
      });
    }
    this.advanceReset(device, on);
    this.syncSources();
  }

  /** 保護動作からの復帰手順を1手ずつ照合する。手順どおり4手で復帰する。§5.1.1 */
  private advanceReset(device: PowerDevice, on: boolean): void {
    if (!this.tripped) {
      this.resetStep = 0;
      return;
    }
    const expected = RESET_SEQUENCE[this.resetStep];
    if (expected !== undefined && expected.device === device && expected.on === on) {
      this.resetStep += 1;
      if (this.resetStep >= RESET_SEQUENCE.length) {
        this.tripped = false;
        this.resetStep = 0;
      }
    } else {
      this.resetStep = 0;
    }
  }

  private syncSources(): void {
    const live = isPowerOn(this.switches) && !this.tripped;
    for (const part of this.netlist.parts) {
      for (const el of part.elements) if (el.kind === 'source') el.enabled = live;
    }
  }

  private coilOf(elementId: string): LoadElement | undefined {
    const el = findElement(this.netlist, elementId);
    return el !== undefined && el.kind === 'load' ? el : undefined;
  }

  /** 負荷の通電判定。断線している負荷は電位差があっても通電しない。§5.1.3 */
  private updateLoads(solved: SolveResult): void {
    for (const part of this.netlist.parts) {
      const meta = part.meta;
      if (meta.kind !== 'lamp' && meta.kind !== 'buzzer') continue;
      const runtime = this.lamps.get(part.id);
      if (runtime === undefined) continue;
      const el = this.coilOf(meta.loadElementId);
      const conducting = el !== undefined && loadOhms(el) !== undefined;
      const volts = conducting ? Math.abs(solved.elementVolts.get(meta.loadElementId) ?? 0) : 0;
      runtime.volts = volts;
      runtime.level = !conducting
        ? 'off'
        : volts >= meta.litVolts
          ? 'lit'
          : volts >= meta.dimVolts
            ? 'dim'
            : 'off';
    }
  }

  private updateRelays(solved: SolveResult): void {
    for (const part of this.netlist.parts) {
      const meta = part.meta;
      if (meta.kind !== 'relay-my4n') continue;
      const st = this.relays.get(part.id);
      if (st === undefined) continue;
      if (st.contactsOn !== st.coilOn) {
        st.pendingTicks -= 1;
        if (st.pendingTicks <= 0) st.contactsOn = st.coilOn;
      }
      const el = this.coilOf(meta.coilElementId);
      const conducting = el !== undefined && loadOhms(el) !== undefined;
      const volts = conducting ? (solved.elementVolts.get(meta.coilElementId) ?? 0) : 0;
      st.coilVolts = volts;
      const desired = !conducting
        ? false
        : volts >= meta.pickupVolts
          ? true
          : volts <= meta.dropoutVolts
            ? false
            : st.coilOn;
      if (desired !== st.coilOn) {
        st.coilOn = desired;
        st.pendingTicks = desired ? meta.operateTicks : meta.releaseTicks;
      }
    }
  }

  private updateTimers(solved: SolveResult, dtMs: number): void {
    for (const part of this.netlist.parts) {
      const meta = part.meta;
      if (meta.kind !== 'timer-h3y4') continue;
      const st = this.timers.get(part.id);
      if (st === undefined) continue;
      const el = this.coilOf(meta.coilElementId);
      const conducting = el !== undefined && loadOhms(el) !== undefined;
      const volts = conducting ? (solved.elementVolts.get(meta.coilElementId) ?? 0) : 0;
      st.coilVolts = volts;
      const powered = !conducting
        ? false
        : volts >= meta.pickupVolts
          ? true
          : volts <= meta.dropoutVolts
            ? false
            : st.powered;
      if (powered) {
        if (!st.powered) {
          if (st.offMs >= meta.resetGapMs) st.elapsedMs = 0;
          st.offMs = 0;
        }
        st.powered = true;
        st.elapsedMs += dtMs;
        if (st.elapsedMs >= st.presetMs) st.timedOut = true;
      } else {
        st.powered = false;
        st.timedOut = false; // 限時接点は瞬時復帰する §5.3.2
        st.offMs += dtMs;
        if (st.offMs >= meta.resetGapMs) st.elapsedMs = 0;
      }
    }
  }

  private applyContacts(): void {
    for (const part of this.netlist.parts) {
      const meta = part.meta;
      if (meta.kind === 'relay-my4n') {
        const st = this.relays.get(part.id);
        if (st === undefined) continue;
        for (const el of part.elements) {
          if (el.kind === 'contact' && el.driver === 'relay') el.energized = st.contactsOn;
        }
      } else if (meta.kind === 'timer-h3y4') {
        const st = this.timers.get(part.id);
        if (st === undefined) continue;
        for (const el of part.elements) {
          if (el.kind === 'contact' && el.driver === 'timer') el.energized = st.timedOut;
        }
      }
    }
  }

  /** 過電流保護。出力電流が保護値を超えた tick で出力を落とす。§5.1.1 / §5.6 #3 */
  private updateProtection(solved: SolveResult): void {
    if (this.tripped || !isPowerOn(this.switches)) return;
    let limit = Number.POSITIVE_INFINITY;
    for (const part of this.netlist.parts) {
      for (const el of part.elements) {
        if (el.kind === 'source' && el.enabled) limit = Math.min(limit, el.protectionAmps);
      }
    }
    if (Math.abs(solved.sourceAmps) <= limit) return;
    this.tripped = true;
    this.resetStep = 0;
    this.syncSources();
    this.events.emit({
      type: 'hazard',
      kind: 'short-circuit-power-on',
      tMs: this.tMs,
      detail: `電源電流 ${solved.sourceAmps.toFixed(1)}A`,
    });
  }

  private snapshot(solved: SolveResult, nets: Nets): Map<string, SignalValue> {
    const out = new Map<string, SignalValue>();
    out.set('POWER', isPowerOn(this.switches) && !this.tripped);
    out.set('POWER.I', solved.sourceAmps);
    for (const part of this.netlist.parts) {
      const id: string = part.id;
      const meta = part.meta;
      if (meta.kind === 'pushbutton') {
        out.set(id, this.buttons.get(id) ?? false);
      } else if (meta.kind === 'relay-my4n') {
        const st = this.relays.get(id);
        if (st !== undefined) {
          out.set(id, st.contactsOn);
          out.set(`${id}.coil`, st.coilOn);
          out.set(`${id}.coilV`, st.coilVolts);
        }
      } else if (meta.kind === 'timer-h3y4') {
        const st = this.timers.get(id);
        if (st !== undefined) {
          out.set(id, st.timedOut);
          out.set(`${id}.coil`, st.powered);
          out.set(`${id}.coilV`, st.coilVolts);
        }
      } else if (meta.kind === 'lamp' || meta.kind === 'buzzer') {
        const st = this.lamps.get(id);
        if (st !== undefined) {
          out.set(id, st.level === 'lit');
          out.set(`${id}.level`, LAMP_LEVEL_CODE[st.level]);
          out.set(`${id}.volts`, st.volts);
        }
      }
      for (const el of part.elements) {
        if (el.kind === 'contact') out.set(`${el.id}.closed`, isContactClosed(el));
      }
    }
    for (const terminal of this.watch) {
      out.set(`V:${terminal}`, voltageAt(solved, nets, terminal));
    }
    return out;
  }

  /** 同一信号が1秒窓で10回以上遷移したらチャタリングとして発行する。§5.3.2 */
  private detectChatter(
    changed: readonly string[],
    values: ReadonlyMap<string, SignalValue>,
  ): void {
    for (const signal of changed) {
      if (typeof values.get(signal) !== 'boolean') continue;
      const times = this.chatterTimes.get(signal) ?? [];
      times.push(this.elapsedMs);
      while (times.length > 0 && this.elapsedMs - (times[0] ?? 0) > CHATTER_WINDOW_MS)
        times.shift();
      this.chatterTimes.set(signal, times);
      if (times.length < CHATTER_MIN_TRANSITIONS) continue;
      const reported = this.chatterReported.get(signal);
      if (reported !== undefined && this.elapsedMs - reported < CHATTER_WINDOW_MS) continue;
      this.chatterReported.set(signal, this.elapsedMs);
      this.events.emit({
        type: 'chatter',
        signal,
        tMs: this.elapsedMs,
        count: times.length,
      });
    }
  }
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  LAMP_LEVEL_CODE,
  Simulation,
  SimulationError,
  type LampLevel,
  type LampRuntime,
  type RelayRuntime,
  type SimulationOptions,
  type SimulationState,
  type TimerRuntime,
} from './simulation.js';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- simulation.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [x] 全テストと型検査・lint を確認する。

```powershell
pnpm --filter @ojt/circuit-sim test
pnpm typecheck
pnpm exec eslint .
```

期待出力: `Tests  44 passed (44)`、`tsc` と `eslint` は何も出さず終了。

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add tick loop, relay and timer state machines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 14: src/faults.ts — 故障注入

**Files:**
- Create: `packages/circuit-sim/src/faults.ts`
- Test: `packages/circuit-sim/test/faults.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

溶着（`contact-welded`）は、鉄片が吸着したまま固まる現象なので、同じc接点組のもう一方の接点を機械的に開く（§7.5「溶着は組のもう一方の接点を機械的に開く」／ゴールデンケース#19）。

- [x] 失敗するテストを書く。`packages/circuit-sim/test/faults.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  clearFaults,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  FaultError,
  findElement,
  findWire,
  injectFault,
  terminalId,
} from '../src/index.js';
import { net, w } from './helpers/circuits.js';

function fixture(): ReturnType<typeof net> {
  return net(
    [
      createPowerSupply('PS'),
      createPushButton('PB1'),
      createRelay4c('CR1'),
      createLamp('PL1', '白'),
    ],
    [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'CR1.14'), w('w3', 'CR1.13', 'PS.-')],
  );
}

describe('faults', () => {
  it('電線の断線・未配線・誤配線（§5.4）', () => {
    const open = fixture();
    injectFault(open, { wireId: 'w1' }, 'wire-open');
    expect(findWire(open, 'w1')?.open).toBe(true);

    const missing = fixture();
    injectFault(missing, { wireId: 'w1' }, 'wire-missing');
    expect(findWire(missing, 'w1')).toBeUndefined();

    const misrouted = fixture();
    injectFault(misrouted, { wireId: 'w2' }, 'wire-misrouted', terminalId('CR1', '9'));
    expect(findWire(misrouted, 'w2')?.to).toBe('CR1.9');
  });

  it('接点の不導通・溶着・接触不良（§5.4）', () => {
    const netlist = fixture();
    injectFault(netlist, { partId: 'CR1', elementIndex: 1 }, 'contact-open');
    const b1 = findElement(netlist, 'CR1:b1');
    expect(b1?.kind === 'contact' ? b1.fault : undefined).toEqual({ kind: 'open' });

    const resistive = fixture();
    injectFault(resistive, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive');
    const pb = findElement(resistive, 'PB1:a');
    expect(pb?.kind === 'contact' ? pb.fault : undefined).toEqual({ kind: 'resistive', ohms: 500 });
  });

  it('溶着は同じ組のもう一方の接点を機械的に開く（§7.5）', () => {
    const netlist = fixture();
    injectFault(netlist, { partId: 'CR1', elementIndex: 2 }, 'contact-welded');
    const a1 = findElement(netlist, 'CR1:a1');
    const b1 = findElement(netlist, 'CR1:b1');
    const b2 = findElement(netlist, 'CR1:b2');
    expect(a1?.kind === 'contact' ? a1.fault : undefined).toEqual({ kind: 'welded' });
    expect(b1?.kind === 'contact' ? b1.fault : undefined).toEqual({ kind: 'open' });
    expect(b2?.kind === 'contact' ? b2.fault : undefined).toBeUndefined();
  });

  it('コイル断線・レアショート・ランプ断線（§5.1.3 / §5.4）', () => {
    const netlist = fixture();
    injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-layer-short');
    const coil = findElement(netlist, 'CR1:coil');
    expect(coil?.kind === 'load' ? coil.fault : undefined).toEqual({
      kind: 'layerShort',
      ratio: 0.65,
    });
    injectFault(netlist, { partId: 'PL1', elementIndex: 0 }, 'lamp-open');
    const lamp = findElement(netlist, 'PL1:load');
    expect(lamp?.kind === 'load' ? lamp.fault : undefined).toEqual({ kind: 'open' });
  });

  it('対象と種別が合わないときは FaultError（§5.4）', () => {
    const netlist = fixture();
    expect(() => injectFault(netlist, { wireId: 'zz' }, 'wire-open')).toThrow(FaultError);
    expect(() => injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'wire-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { partId: 'ZZ', elementIndex: 0 }, 'coil-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { partId: 'CR1', elementIndex: 99 }, 'coil-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'contact-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { partId: 'CR1', elementIndex: 1 }, 'coil-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { wireId: 'w1' }, 'wire-misrouted')).toThrow(FaultError);
    expect(() => injectFault(netlist, { wireId: 'w1' }, 'contact-open')).toThrow(FaultError);
    expect(() =>
      injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-layer-short', 0.2),
    ).toThrow(FaultError);
    expect(() =>
      injectFault(netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 0),
    ).toThrow(FaultError);
  });

  it('故障をまとめて取り消せる', () => {
    const netlist = fixture();
    injectFault(netlist, { wireId: 'w1' }, 'wire-open');
    injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-open');
    clearFaults(netlist);
    expect(findWire(netlist, 'w1')?.open).toBe(false);
    const coil = findElement(netlist, 'CR1:coil');
    expect(coil?.kind === 'load' ? coil.fault : undefined).toBeUndefined();
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- faults.test.ts
```

期待出力の冒頭: `does not provide an export named 'injectFault'`。

- [x] `packages/circuit-sim/src/faults.ts` を書く。

```ts
import {
  DEFAULT_CONTACT_RESISTIVE_OHMS,
  DEFAULT_LAYER_SHORT_RATIO,
  MAX_LAYER_SHORT_RATIO,
  MIN_LAYER_SHORT_RATIO,
} from './elements.js';
import type { ContactElement, Element, LoadElement } from './elements.js';
import type { TerminalId } from './ids.js';
import { findPart, findWire } from './netlist.js';
import type { Netlist } from './netlist.js';

/** 故障の種別。§5.4 */
export type FaultKind =
  | 'wire-open'
  | 'wire-missing'
  | 'wire-misrouted'
  | 'contact-open'
  | 'contact-welded'
  | 'contact-resistive'
  | 'coil-open'
  | 'coil-layer-short'
  | 'lamp-open';

/** 故障の注入先。§5.4 */
export type FaultTarget = { wireId: string } | { partId: string; elementIndex: number };

/** 故障注入の失敗。 */
export class FaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultError';
  }
}

function resolveElement(netlist: Netlist, target: FaultTarget): Element {
  if (!('partId' in target)) throw new FaultError('部品の故障には partId が必要です');
  const part = findPart(netlist, target.partId);
  if (part === undefined) throw new FaultError(`部品が見つかりません: ${target.partId}`);
  const el = part.elements[target.elementIndex];
  if (el === undefined) {
    throw new FaultError(`要素が見つかりません: ${target.partId}[${target.elementIndex}]`);
  }
  return el;
}

function asContact(el: Element): ContactElement {
  if (el.kind !== 'contact') throw new FaultError(`接点ではありません: ${el.id}`);
  return el;
}

function asLoad(el: Element, ...kinds: LoadElement['load'][]): LoadElement {
  if (el.kind !== 'load' || !kinds.includes(el.load)) {
    throw new FaultError(`対象外の負荷です: ${el.id}`);
  }
  return el;
}

/**
 * 溶着した接点と同じ組のもう一方の接点を機械的に開く。§7.5 / ゴールデンケース#19
 * （鉄片が吸着したまま固まるため、a接点が溶着すると同じ組のb接点は開いたままになる）
 */
function openPairedContact(netlist: Netlist, welded: ContactElement): void {
  const part = findPart(netlist, welded.driverId);
  if (part === undefined) return;
  for (const el of part.elements) {
    if (el.kind !== 'contact') continue;
    if (el.group !== welded.group || el.contact === welded.contact) continue;
    el.fault = { kind: 'open' };
  }
}

/**
 * 故障を注入する。§5.4
 * @param param kind ごとに意味が決まる。
 *   - `contact-resistive`: 直列抵抗[Ω]（既定500）
 *   - `coil-layer-short`: ratio（0.4〜0.85、既定0.65）
 *   - `wire-misrouted`: 付け替え先の端子ID
 *   - それ以外: 省略する
 */
export function injectFault(
  netlist: Netlist,
  target: FaultTarget,
  kind: FaultKind,
  param?: number | TerminalId,
): void {
  switch (kind) {
    case 'wire-open':
    case 'wire-missing':
    case 'wire-misrouted': {
      if (!('wireId' in target)) throw new FaultError('電線の故障には wireId が必要です');
      const wire = findWire(netlist, target.wireId);
      if (wire === undefined) throw new FaultError(`電線が見つかりません: ${target.wireId}`);
      if (kind === 'wire-open') {
        wire.open = true;
      } else if (kind === 'wire-missing') {
        const index = netlist.wires.indexOf(wire);
        netlist.wires.splice(index, 1);
      } else {
        if (typeof param !== 'string') {
          throw new FaultError('wire-misrouted には付け替え先の端子IDが必要です');
        }
        wire.to = param;
      }
      return;
    }
    case 'contact-open': {
      asContact(resolveElement(netlist, target)).fault = { kind: 'open' };
      return;
    }
    case 'contact-welded': {
      const contact = asContact(resolveElement(netlist, target));
      contact.fault = { kind: 'welded' };
      openPairedContact(netlist, contact);
      return;
    }
    case 'contact-resistive': {
      const ohms = typeof param === 'number' ? param : DEFAULT_CONTACT_RESISTIVE_OHMS;
      if (!(ohms > 0)) throw new FaultError(`接触抵抗は正の値が必要です: ${String(param)}`);
      asContact(resolveElement(netlist, target)).fault = { kind: 'resistive', ohms };
      return;
    }
    case 'coil-open': {
      asLoad(resolveElement(netlist, target), 'coil').fault = { kind: 'open' };
      return;
    }
    case 'coil-layer-short': {
      const ratio = typeof param === 'number' ? param : DEFAULT_LAYER_SHORT_RATIO;
      if (ratio < MIN_LAYER_SHORT_RATIO || ratio > MAX_LAYER_SHORT_RATIO) {
        throw new FaultError(
          `レアショートの ratio は ${MIN_LAYER_SHORT_RATIO}〜${MAX_LAYER_SHORT_RATIO} です: ${ratio}`,
        );
      }
      asLoad(resolveElement(netlist, target), 'coil').fault = { kind: 'layerShort', ratio };
      return;
    }
    case 'lamp-open': {
      asLoad(resolveElement(netlist, target), 'lamp', 'buzzer').fault = { kind: 'open' };
      return;
    }
  }
}

/** 注入済みの故障をすべて取り消す（`wire-missing` と `wire-misrouted` は元に戻せない）。 */
export function clearFaults(netlist: Netlist): void {
  for (const wire of netlist.wires) wire.open = false;
  for (const part of netlist.parts) {
    for (const el of part.elements) {
      if (el.kind === 'contact' || el.kind === 'load') delete el.fault;
    }
  }
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  clearFaults,
  FaultError,
  injectFault,
  type FaultKind,
  type FaultTarget,
} from './faults.js';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- faults.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add fault injection for wires, contacts and loads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 15: src/meter.ts — テスター測定

**Files:**
- Create: `packages/circuit-sim/src/meter.ts`
- Test: `packages/circuit-sim/test/meter.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

抵抗測定は「全電源を外し、プローブ間に試験電源（1V・内部抵抗1Ω）を入れて、流れる電流から等価抵抗を逆算する」。内部抵抗を1Ωの有限値にしているのは、分圧から等価抵抗を数値的に安定して求めるため。全節点に1nSの漏れがあるので、開放は約2GΩ（>10MΩ）として `OL` になる。

- [x] 失敗するテストを書く。`packages/circuit-sim/test/meter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  continuity,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  equivalentResistance,
  measureAcVolts,
  measureResistance,
  measureVoltage,
  OVER_RANGE_OHMS,
} from '../src/index.js';
import { bench, net, powerOn, t, w } from './helpers/circuits.js';

describe('meter', () => {
  it('DCVは赤プローブ − 黒プローブ（§5.5）', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    powerOn(sim);
    sim.run(50);
    expect(measureVoltage(sim, t('PS.-'), t('PS.+')).volts).toBeCloseTo(23.996, 2);
    expect(measureVoltage(sim, t('PS.+'), t('PS.-')).volts).toBeCloseTo(-23.996, 2);
    expect(measureAcVolts().volts).toBe(0);
  });

  it('無通電のコイル抵抗は650Ω（調査資料 §6.3）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    expect(equivalentResistance(netlist, t('CR1.13'), t('CR1.14'))).toBeCloseTo(650, 2);
  });

  it('開放はOL、10MΩ超もOL（§5.5）', () => {
    const sim = bench([createPowerSupply('PS'), createRelay4c('CR1')], []);
    const reading = measureResistance(sim, t('CR1.1'), t('CR1.5'));
    expect(reading.overRange).toBe(true);
    expect(reading.display).toBe('OL');
    expect(reading.ohms).toBe(Number.POSITIVE_INFINITY);
    expect(OVER_RANGE_OHMS).toBe(10_000_000);
  });

  it('導通は50Ω以下（§5.5）', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    expect(continuity(sim, t('PS.+'), t('PB1.c')).conductive).toBe(true);
    expect(continuity(sim, t('PS.+'), t('PB1.c')).display).toBe('導通');
    const openContact = continuity(sim, t('PB1.c'), t('PB1.a'));
    expect(openContact.conductive).toBe(false);
    expect(openContact.display).toBe('OL');
    sim.press('PB1');
    expect(continuity(sim, t('PB1.c'), t('PB1.a')).conductive).toBe(true);
    const lamp = continuity(sim, t('PL1.+'), t('PL1.-'));
    expect(lamp.conductive).toBe(false);
    expect(lamp.display).toBe('−−−');
    expect(lamp.ohms).toBeCloseTo(2400, 1);
  });

  it('通電中にΩを当てると ohm-on-live でOL（§5.6 #1）', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    powerOn(sim);
    sim.run(50);
    const reading = measureResistance(sim, t('PS.-'), t('PS.+'));
    expect(reading.live).toBe(true);
    expect(reading.display).toBe('OL');
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
    expect(continuity(sim, t('PS.-'), t('PS.+')).live).toBe(true);
    expect(sim.events.countOf('ohm-on-live')).toBe(2);
  });

  it('測定してもネットリストは元に戻る', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    powerOn(sim);
    sim.run(50);
    const before = sim.netlist.parts.length;
    measureResistance(sim, t('CR1.1'), t('CR1.5'));
    expect(sim.netlist.parts.length).toBe(before);
    sim.run(100);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- meter.test.ts
```

期待出力の冒頭: `does not provide an export named 'measureVoltage'`。

- [x] `packages/circuit-sim/src/meter.ts` を書く。

```ts
import type { SourceElement } from './elements.js';
import type { TerminalId } from './ids.js';
import { buildNets } from './netlist.js';
import type { Netlist } from './netlist.js';
import type { Part } from './parts.js';
import { solve, voltageAt } from './solver.js';
import type { Simulation } from './simulation.js';

/** Ω／導通レンジを当ててよいプローブ間電圧の上限[V]。これ以上なら活線。§5.5 / §5.6 #1 */
export const LIVE_OHM_VOLTS = 1;
/** 抵抗測定に使う試験電源の電圧[V]。§5.5 */
export const PROBE_VOLTS = 1;
/** 試験電源の内部抵抗[Ω]。分圧から等価抵抗を逆算するために有限値を持たせる。 */
export const PROBE_OHMS = 1;
/** これを超えた抵抗は OL（オーバーレンジ）扱い。§5.5 */
export const OVER_RANGE_OHMS = 10_000_000;
/** 導通ブザーが鳴る抵抗の上限[Ω]。§5.5 */
export const CONTINUITY_OHMS = 50;
/** 測定用に一時追加する部品のID。 */
const PROBE_PART_ID = '__probe__';

/** 電圧レンジの読値。 */
export interface VoltReading {
  /** 赤プローブ電位 − 黒プローブ電位[V]。§5.5 */
  volts: number;
}

/** Ωレンジの読値。 */
export interface OhmReading {
  /** 等価抵抗[Ω]。測定不能・オーバーレンジのときは Infinity。 */
  ohms: number;
  /** オーバーレンジ（10MΩ超）または活線で測れなかった。 */
  overRange: boolean;
  /** 通電中に当てたため測定できなかった（`ohm-on-live` を発行済み）。§5.6 #1 */
  live: boolean;
  /** 表示文字列。オーバーレンジ・活線は `OL`。 */
  display: string;
}

/** 導通レンジの読値。 */
export interface ContinuityReading {
  ohms: number;
  /** 50Ω以下で導通。§5.5 */
  conductive: boolean;
  live: boolean;
  display: string;
}

/** DC電圧を測る。t1 が黒プローブ（基準）、t2 が赤プローブ。§5.5 */
export function measureVoltage(sim: Simulation, t1: TerminalId, t2: TerminalId): VoltReading {
  const nets = buildNets(sim.netlist);
  const result = solve(sim.netlist, nets);
  return { volts: voltageAt(result, nets, t2) - voltageAt(result, nets, t1) };
}

/** ACVレンジ。AC一次側は測定対象外なので常に 0.00V を返す（実機の操作感のためレンジだけ存在する）。§5.5 */
export function measureAcVolts(): VoltReading {
  return { volts: 0 };
}

/**
 * 2端子間の等価抵抗[Ω]を求める。全電源を外し、プローブ間に試験電源（1V・内部抵抗1Ω）を入れて
 * 流れる電流から逆算する。回り込み経路を含む値になる。§5.5 / 調査資料 §6.5(A)
 */
export function equivalentResistance(netlist: Netlist, t1: TerminalId, t2: TerminalId): number {
  const saved: Array<{ el: SourceElement; enabled: boolean }> = [];
  for (const part of netlist.parts) {
    for (const el of part.elements) {
      if (el.kind !== 'source') continue;
      saved.push({ el, enabled: el.enabled });
      el.enabled = false;
    }
  }
  const probeSource: SourceElement = {
    kind: 'source',
    id: `${PROBE_PART_ID}:source`,
    from: t1,
    to: t2,
    volts: PROBE_VOLTS,
    internalOhms: PROBE_OHMS,
    protectionAmps: Number.POSITIVE_INFINITY,
    enabled: true,
  };
  const probePart: Part = {
    id: PROBE_PART_ID as Part['id'],
    kind: 'power-supply',
    terminals: [t1, t2],
    elements: [probeSource],
    meta: { kind: 'power-supply', sourceElementId: probeSource.id },
  };
  netlist.parts.push(probePart);
  try {
    const nets = buildNets(netlist);
    const result = solve(netlist, nets, { reference: t2 });
    const volts = result.elementVolts.get(probeSource.id) ?? 0;
    const amps = result.elementAmps.get(probeSource.id) ?? 0;
    if (Math.abs(amps) < 1e-15) return Number.POSITIVE_INFINITY;
    return Math.abs(volts / amps);
  } finally {
    netlist.parts.pop();
    for (const entry of saved) entry.el.enabled = entry.enabled;
  }
}

function ohmReading(ohms: number, live: boolean): OhmReading {
  const overRange = live || !Number.isFinite(ohms) || ohms > OVER_RANGE_OHMS;
  return {
    ohms: overRange ? Number.POSITIVE_INFINITY : ohms,
    overRange,
    live,
    display: overRange ? 'OL' : ohms.toFixed(1),
  };
}

/**
 * 抵抗を測る。プローブ間電圧が1V以上なら測定せず `ohm-on-live` を発行して OL を返す。§5.5 / §5.6 #1
 */
export function measureResistance(sim: Simulation, t1: TerminalId, t2: TerminalId): OhmReading {
  const live = Math.abs(measureVoltage(sim, t1, t2).volts) >= LIVE_OHM_VOLTS;
  if (live) {
    sim.events.emit({
      type: 'hazard',
      kind: 'ohm-on-live',
      tMs: sim.tMs,
      detail: `${t1}-${t2}`,
    });
    return ohmReading(Number.POSITIVE_INFINITY, true);
  }
  return ohmReading(equivalentResistance(sim.netlist, t1, t2), false);
}

/** 導通を調べる。Ωレンジと同じ制約を受ける。§5.5 */
export function continuity(sim: Simulation, t1: TerminalId, t2: TerminalId): ContinuityReading {
  const reading = measureResistance(sim, t1, t2);
  const conductive = !reading.overRange && reading.ohms <= CONTINUITY_OHMS;
  return {
    ohms: reading.ohms,
    conductive,
    live: reading.live,
    display: reading.overRange ? 'OL' : conductive ? '導通' : '−−−',
  };
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  continuity,
  CONTINUITY_OHMS,
  equivalentResistance,
  LIVE_OHM_VOLTS,
  measureAcVolts,
  measureResistance,
  measureVoltage,
  OVER_RANGE_OHMS,
  PROBE_OHMS,
  PROBE_VOLTS,
  type ContinuityReading,
  type OhmReading,
  type VoltReading,
} from './meter.js';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- meter.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add tester measurement api with live-ohm hazard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 16: src/compare.ts — 判定の突き合わせ

**Files:**
- Create: `packages/circuit-sim/src/compare.ts`
- Test: `packages/circuit-sim/test/compare.test.ts`
- Modify: `packages/circuit-sim/src/index.ts`

許容差は「`edgeMs`（既定200ms）と『直前の区間長 × `ratio`（既定0.10）』の大きい方」（§7.4）。

- [x] 失敗するテストを書く。`packages/circuit-sim/test/compare.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { allowedShiftMs, compareLogs, DEFAULT_TOLERANCE, SignalLog } from '../src/index.js';

function logOf(points: Array<[number, boolean]>): SignalLog {
  const log = new SignalLog();
  for (const [tMs, value] of points) log.record(tMs, new Map([['PL1', value]]));
  return log;
}

describe('compare', () => {
  it('既定の許容差は 200ms と 10%（§7.4）', () => {
    expect(DEFAULT_TOLERANCE).toEqual({ edgeMs: 200, ratio: 0.1 });
    expect(allowedShiftMs(0, DEFAULT_TOLERANCE)).toBe(200);
    expect(allowedShiftMs(1000, DEFAULT_TOLERANCE)).toBe(200);
    expect(allowedShiftMs(5000, DEFAULT_TOLERANCE)).toBe(500);
  });

  it('許容差内のずれは不一致にしない', () => {
    const want = logOf([
      [0, false],
      [1000, true],
    ]);
    const got = logOf([
      [0, false],
      [1200, true],
    ]);
    expect(compareLogs(want, got, ['PL1'])).toEqual([]);
  });

  it('許容差を超えたずれは timing の不一致', () => {
    const want = logOf([
      [0, false],
      [1000, true],
    ]);
    const got = logOf([
      [0, false],
      [1210, true],
    ]);
    const diffs = compareLogs(want, got, ['PL1']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      tMs: 1000,
      signal: 'PL1',
      expected: true,
      actual: true,
      reason: 'timing',
      actualTMs: 1210,
      allowedMs: 200,
    });
  });

  it('値違い・遷移不足・余分な遷移を区別する', () => {
    const want = logOf([
      [0, false],
      [1000, true],
      [2000, false],
    ]);
    const value = compareLogs(want, logOf([[0, true]]), ['PL1']);
    expect(value[0]?.reason).toBe('value');
    const missing = compareLogs(
      want,
      logOf([
        [0, false],
        [1000, true],
      ]),
      ['PL1'],
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ tMs: 2000, reason: 'missing', actual: undefined });
    const extra = compareLogs(
      logOf([
        [0, false],
        [1000, true],
      ]),
      want,
      ['PL1'],
    );
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatchObject({ tMs: 2000, reason: 'extra', expected: undefined });
  });

  it('区間長の10%規則が長い区間で効く（§7.4）', () => {
    const want = logOf([
      [0, false],
      [1000, true],
      [6000, false],
    ]);
    const got = logOf([
      [0, false],
      [1000, true],
      [6400, false],
    ]);
    expect(compareLogs(want, got, ['PL1'])).toEqual([]);
    expect(compareLogs(want, got, ['PL1'], { edgeMs: 200, ratio: 0 })).toHaveLength(1);
  });
});
```

- [x] テストが失敗することを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- compare.test.ts
```

期待出力の冒頭: `does not provide an export named 'compareLogs'`。

- [x] `packages/circuit-sim/src/compare.ts` を書く。

```ts
import type { SignalLog, SignalValue } from './log.js';

/** 判定の許容差。§7.4 */
export interface Tolerance {
  /** 遷移時刻の許容差[ms]。 */
  edgeMs: number;
  /** 直前の区間長に対する許容比。 */
  ratio: number;
}

/** 既定の許容差。§7.4 */
export const DEFAULT_TOLERANCE: Tolerance = { edgeMs: 200, ratio: 0.1 };

/** 不一致の理由。 */
export type MismatchReason =
  /** 値は同じだが遷移時刻が許容差を超えてずれている。 */
  | 'timing'
  /** 同じ順番の遷移で値が違う。 */
  | 'value'
  /** 模範側にある遷移が訓練者側に無い。 */
  | 'missing'
  /** 訓練者側に余分な遷移がある。 */
  | 'extra';

/** 不一致1件。 */
export interface Mismatch {
  /** 模範側の遷移時刻[ms]（`extra` のときは訓練者側の時刻）。 */
  tMs: number;
  signal: string;
  expected: SignalValue | undefined;
  actual: SignalValue | undefined;
  reason: MismatchReason;
  /** 訓練者側の遷移時刻[ms]。 */
  actualTMs?: number;
  /** その遷移に適用した許容差[ms]。 */
  allowedMs?: number;
}

/** その遷移に適用する許容差[ms]。`edgeMs` と「直前の区間長 × ratio」の大きい方。§7.4 */
export function allowedShiftMs(previousIntervalMs: number, tolerance: Tolerance): number {
  return Math.max(tolerance.edgeMs, previousIntervalMs * tolerance.ratio);
}

/**
 * 模範回路のログと訓練者回路のログを突き合わせ、不一致の一覧を返す。§7.4
 * 空配列なら動作一致（合格）。
 */
export function compareLogs(
  expected: SignalLog,
  actual: SignalLog,
  signals: readonly string[],
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): Mismatch[] {
  const out: Mismatch[] = [];
  for (const signal of signals) {
    const want = expected.transitions(signal);
    const got = actual.transitions(signal);
    const count = Math.max(want.length, got.length);
    for (let i = 0; i < count; i += 1) {
      const w = want[i];
      const g = got[i];
      if (w === undefined && g !== undefined) {
        out.push({ tMs: g.tMs, signal, expected: undefined, actual: g.value, reason: 'extra' });
        continue;
      }
      if (w === undefined || g === undefined) {
        if (w !== undefined) {
          out.push({ tMs: w.tMs, signal, expected: w.value, actual: undefined, reason: 'missing' });
        }
        continue;
      }
      if (w.value !== g.value) {
        out.push({
          tMs: w.tMs,
          signal,
          expected: w.value,
          actual: g.value,
          reason: 'value',
          actualTMs: g.tMs,
        });
        continue;
      }
      const previous = want[i - 1];
      const interval = previous === undefined ? 0 : w.tMs - previous.tMs;
      const allowed = allowedShiftMs(interval, tolerance);
      if (Math.abs(w.tMs - g.tMs) > allowed) {
        out.push({
          tMs: w.tMs,
          signal,
          expected: w.value,
          actual: g.value,
          reason: 'timing',
          actualTMs: g.tMs,
          allowedMs: allowed,
        });
      }
    }
  }
  return out;
}
```

- [x] `packages/circuit-sim/src/index.ts` の末尾に次を追記する。

```ts
export {
  allowedShiftMs,
  compareLogs,
  DEFAULT_TOLERANCE,
  type Mismatch,
  type MismatchReason,
  type Tolerance,
} from './compare.js';
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- compare.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): add tolerance-aware signal log comparison

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 17: src/index.ts — 公開APIの確定

**Files:**
- Modify: `packages/circuit-sim/src/index.ts`

Task 5〜16 で追記してきた再輸出を、次の最終形と一致しているか突き合わせる（並び順もこのとおりにする）。

- [x] `packages/circuit-sim/src/index.ts` を次の内容にする。

```ts
export {
  IdError,
  parseTerminalId,
  partId,
  terminalId,
  terminalOwner,
  wireId,
  type PartId,
  type TerminalId,
  type WireId,
} from './ids.js';

export {
  BUZZER_OHMS,
  CLOSED_CONTACT_OHMS,
  COIL_OHMS,
  contactOhms,
  DEFAULT_CONTACT_RESISTIVE_OHMS,
  DEFAULT_LAYER_SHORT_RATIO,
  DROPOUT_VOLTS,
  isContactClosed,
  LAMP_DIM_VOLTS,
  LAMP_LIT_VOLTS,
  LAMP_OHMS,
  loadOhms,
  MAX_LAYER_SHORT_RATIO,
  MIN_LAYER_SHORT_RATIO,
  PICKUP_VOLTS,
  PLC_INPUT_OHMS,
  PROTECTION_AMPS,
  SOURCE_INTERNAL_OHMS,
  SOURCE_VOLTS,
  TICK_MS,
  type ContactDriver,
  type ContactElement,
  type ContactFault,
  type ContactKind,
  type Element,
  type LinkElement,
  type LoadElement,
  type LoadFault,
  type LoadKind,
  type SourceElement,
} from './elements.js';

export {
  clampPreset,
  createBuzzer,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTerminalBlockLink,
  createTimer4c,
  SOCKET_COIL_MINUS_PIN,
  SOCKET_COIL_PLUS_PIN,
  SOCKET_CONTACT_PINS,
  TIMER_MIN_PRESET_MS,
  TIMER_RANGE_10S_MS,
  TIMER_RANGE_60S_MS,
  TIMER_RESET_GAP_MS,
  type LampColor,
  type Part,
  type PartKind,
  type PartMeta,
} from './parts.js';

export {
  addWire,
  allElements,
  buildNets,
  createNetlist,
  createWire,
  exceedsWireLimit,
  findElement,
  findPart,
  findWire,
  MAX_WIRES_PER_TERMINAL,
  NetlistError,
  removeWire,
  wireCountAt,
  type Netlist,
  type Nets,
  type Wire,
  type WireColor,
} from './netlist.js';

export {
  LEAK_SIEMENS,
  MAX_NODES,
  solve,
  voltageAt,
  type SolveOptions,
  type SolveResult,
} from './solver.js';

export {
  applyPowerAction,
  isPowerOn,
  RESET_SEQUENCE,
  setButtonPressed,
  type PowerActionResult,
  type PowerDevice,
  type PowerSwitches,
} from './actuators.js';

export {
  CHATTER_MIN_TRANSITIONS,
  CHATTER_WINDOW_MS,
  EventBus,
  type ChatterEvent,
  type EventListener,
  type HazardEvent,
  type HazardKind,
  type SimEvent,
} from './events.js';

export { LOG_DECIMALS, roundSignal, SignalLog, type LogEntry, type SignalValue } from './log.js';

export {
  LAMP_LEVEL_CODE,
  Simulation,
  SimulationError,
  type LampLevel,
  type LampRuntime,
  type RelayRuntime,
  type SimulationOptions,
  type SimulationState,
  type TimerRuntime,
} from './simulation.js';

export {
  clearFaults,
  FaultError,
  injectFault,
  type FaultKind,
  type FaultTarget,
} from './faults.js';

export {
  continuity,
  CONTINUITY_OHMS,
  equivalentResistance,
  LIVE_OHM_VOLTS,
  measureAcVolts,
  measureResistance,
  measureVoltage,
  OVER_RANGE_OHMS,
  PROBE_OHMS,
  PROBE_VOLTS,
  type ContinuityReading,
  type OhmReading,
  type VoltReading,
} from './meter.js';

export {
  allowedShiftMs,
  compareLogs,
  DEFAULT_TOLERANCE,
  type Mismatch,
  type MismatchReason,
  type Tolerance,
} from './compare.js';
```

- [x] 全テスト・型検査・lint・整形を確認する。

```powershell
pnpm --filter @ojt/circuit-sim test
pnpm typecheck
pnpm exec eslint .
pnpm exec prettier --check .
```

期待出力: `Tests  61 passed (61)`、`tsc` / `eslint` は無出力、prettier は `All matched files use Prettier code style!`。

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
feat(circuit-sim): finalize public api surface

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 18: ゴールデンケース① 基本回路

**Files:**
- Test: `packages/circuit-sim/test/golden-basic.test.ts`

仕様 §14.1 の #1（a接点）／#2（b接点）／#3（AND）／#4（OR）／#5（自己保持、停止先頭形と起動先頭形の両方）／#6（インターロック）／#7（新入力優先）／#15（CRの極性違反）に対応する。実装は変更しない（既にある機能の回帰テスト）。

- [x] テストを書く。`packages/circuit-sim/test/golden-basic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createLamp, createPowerSupply, createPushButton, createRelay4c } from '../src/index.js';
import { bench, firstTrue, powerOn, w } from './helpers/circuits.js';

describe('基本回路', () => {
  it('a接点: 押下で点灯、離すと消灯', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    powerOn(sim);
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.press('PB1');
    sim.run(200);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.release('PB1');
    sim.run(300);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    expect(firstTrue(sim, 'PL1')).toBe(100);
  });

  it('b接点: 押下で消灯', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.b', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    powerOn(sim);
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB1');
    sim.run(200);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('AND: 2個同時押下でのみ点灯', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'PB2.c'),
        w('w3', 'PB2.a', 'PL1.+'),
        w('w4', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.press('PB2');
    sim.run(200);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
  });

  it('OR: どちらかの押下で点灯', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PS.+', 'PB2.c'),
        w('w3', 'PB1.a', 'PL1.+'),
        w('w4', 'PB2.a', 'PL1.+'),
        w('w5', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB2');
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
  });

  it('自己保持（停止接点先頭形）', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB2.c'),
        w('w2', 'PB2.b', 'PB1.c'),
        w('w3', 'PB1.a', 'CR1.14'),
        w('w4', 'PB2.b', 'CR1.9'),
        w('w5', 'CR1.5', 'CR1.14'),
        w('w6', 'CR1.13', 'PS.-'),
        w('w7', 'PS.+', 'CR1.10'),
        w('w8', 'CR1.6', 'PL1.+'),
        w('w9', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.run(100);
    sim.press('PB1');
    sim.run(150);
    sim.release('PB1');
    sim.run(400);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB2');
    sim.run(500);
    sim.release('PB2');
    sim.run(600);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('自己保持（起動先頭形）', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'PB2.c'),
        w('w3', 'PS.+', 'CR1.9'),
        w('w4', 'CR1.5', 'PB2.c'),
        w('w5', 'PB2.b', 'CR1.14'),
        w('w6', 'CR1.13', 'PS.-'),
        w('w7', 'PS.+', 'CR1.10'),
        w('w8', 'CR1.6', 'PL1.+'),
        w('w9', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    sim.release('PB1');
    sim.run(300);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB2');
    sim.run(400);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('インターロック（先行優先）', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createRelay4c('CR2'),
        createLamp('PL1', '白'),
        createLamp('PL2', '黄'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'CR1.14'),
        w('w3', 'PS.+', 'CR1.9'),
        w('w4', 'CR1.5', 'CR1.14'),
        w('w5', 'CR1.13', 'CR2.11'),
        w('w6', 'CR2.3', 'PS.-'),
        w('w7', 'PS.+', 'PB2.c'),
        w('w8', 'PB2.a', 'CR2.14'),
        w('w9', 'PS.+', 'CR2.9'),
        w('w10', 'CR2.5', 'CR2.14'),
        w('w11', 'CR2.13', 'CR1.11'),
        w('w12', 'CR1.3', 'PS.-'),
        w('w13', 'PS.+', 'CR1.10'),
        w('w14', 'CR1.6', 'PL1.+'),
        w('w15', 'PL1.-', 'PS.-'),
        w('w16', 'PS.+', 'CR2.10'),
        w('w17', 'CR2.6', 'PL2.+'),
        w('w18', 'PL2.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    sim.release('PB1');
    sim.run(200);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    sim.press('PB2');
    sim.run(400);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().relays['CR2']?.contactsOn).toBe(false);
    expect(sim.state().lamps['PL2']?.level).toBe('off');
  });

  it('新入力優先', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createRelay4c('CR2'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'CR1.14'),
        w('w3', 'PB1.b', 'PB2.c'),
        w('w4', 'PB2.a', 'CR2.14'),
        w('w5', 'PB2.b', 'CR1.9'),
        w('w6', 'CR1.5', 'CR1.14'),
        w('w7', 'CR1.13', 'PS.-'),
        w('w8', 'PB1.b', 'CR2.9'),
        w('w9', 'CR2.5', 'CR2.14'),
        w('w10', 'CR2.13', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(100);
    sim.release('PB1');
    sim.run(200);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    sim.press('PB2');
    sim.run(300);
    sim.release('PB2');
    sim.run(400);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
    expect(sim.state().relays['CR2']?.contactsOn).toBe(true);
    sim.press('PB1');
    sim.run(500);
    sim.release('PB1');
    sim.run(600);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().relays['CR2']?.contactsOn).toBe(false);
  });

  it('コイル極性違反では励磁しない', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'CR1.13'), w('w3', 'CR1.14', 'PS.-')],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(300);
    expect(sim.state().relays['CR1']?.coilVolts).toBeLessThan(-20);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
  });
});
```

- [x] テストが通ることを確認する（実装済みの機能の回帰テストなので、この時点で通るのが正しい）。

```powershell
pnpm --filter @ojt/circuit-sim test -- golden-basic.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

1本でも落ちた場合は実装のバグなので、`superpowers:systematic-debugging` に従って原因を特定してから `src/` を直す（テストの期待値を緩めて通してはならない）。

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
test(circuit-sim): add golden cases for basic contact circuits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 19: ゴールデンケース② タイマ回路

**Files:**
- Test: `packages/circuit-sim/test/golden-timer.test.ts`

仕様 §14.1 の #8（オンディレー、±1tick）／#9（オフディレー、リレー併用）／#10（ワンショット、リレー併用）／#11（フリッカ、リレー併用）／#14（タイマ復帰時間の保持）に対応する。フリッカ回路は CR1・CR2・T1・T2 で組み、各タイマの通電断が 100ms 以上（相手タイマの設定時間ぶん）確保されるためチャタリングしない。

- [x] テストを書く。`packages/circuit-sim/test/golden-timer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTimer4c,
} from '../src/index.js';
import type { Simulation } from '../src/index.js';
import { bench, firstTrue, powerOn, w } from './helpers/circuits.js';

describe('タイマ回路', () => {
  it('オンディレー3秒', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createTimer4c('T1', 3000),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'T1.14'),
        w('w3', 'T1.13', 'PS.-'),
        w('w4', 'PS.+', 'T1.9'),
        w('w5', 'T1.5', 'PL1.+'),
        w('w6', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(4000);
    const on = firstTrue(sim, 'PL1');
    expect(on).toBeDefined();
    expect(Math.abs((on ?? 0) - 3000)).toBeLessThanOrEqual(10);
  });

  it('オフディレー（リレー併用）: 停止から約500ms後に消灯', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createPushButton('PB2'),
        createRelay4c('CR1'),
        createTimer4c('T1', 500),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'PB2.c'),
        w('w3', 'PS.+', 'CR1.9'),
        w('w4', 'CR1.5', 'PB2.c'),
        w('w5', 'PB2.b', 'CR1.14'),
        w('w6', 'CR1.13', 'PS.-'),
        w('w7', 'PS.+', 'CR1.11'),
        w('w8', 'CR1.3', 'T1.14'),
        w('w9', 'T1.13', 'PS.-'),
        w('w10', 'PS.+', 'CR1.12'),
        w('w11', 'CR1.8', 'PL1.+'),
        w('w12', 'PS.+', 'T1.10'),
        w('w13', 'T1.2', 'PL1.+'),
        w('w14', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.run(1000);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.press('PB1');
    sim.run(1100);
    sim.release('PB1');
    sim.run(1500);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB2');
    sim.run(1600);
    sim.release('PB2');
    sim.run(3000);
    const offs = sim.log.transitions('PL1').filter((e) => e.tMs > 1500 && e.value === false);
    expect(offs.length).toBe(1);
    expect(Math.abs((offs[0]?.tMs ?? 0) - 2020)).toBeLessThanOrEqual(30);
  });

  it('ワンショット（リレー併用）: 約500msだけ動作して復帰する', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createRelay4c('CR1'),
        createTimer4c('T1', 500),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'T1.11'),
        w('w3', 'PS.+', 'CR1.9'),
        w('w4', 'CR1.5', 'T1.11'),
        w('w5', 'T1.3', 'CR1.14'),
        w('w6', 'CR1.13', 'PS.-'),
        w('w7', 'PS.+', 'CR1.10'),
        w('w8', 'CR1.6', 'T1.14'),
        w('w9', 'T1.13', 'PS.-'),
        w('w10', 'PS.+', 'CR1.12'),
        w('w11', 'CR1.8', 'PL1.+'),
        w('w12', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.run(100);
    sim.press('PB1');
    sim.run(150);
    sim.release('PB1');
    sim.run(2000);
    const edges = sim.log.transitions('PL1');
    const on = edges.find((e) => e.value === true)?.tMs ?? -1;
    const off = edges.find((e) => e.value === false && e.tMs > on)?.tMs ?? -1;
    expect(on).toBeGreaterThan(100);
    expect(off - on).toBeGreaterThan(450);
    expect(off - on).toBeLessThan(600);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    expect(sim.events.chatters().length).toBe(0);
  });

  it('フリッカ（CR2個＋T2個）: 周期的に点滅しチャタリングしない', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createRelay4c('CR1'),
        createRelay4c('CR2'),
        createTimer4c('T1', 500),
        createTimer4c('T2', 500),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'CR1.11'),
        w('w3', 'CR1.3', 'T1.14'),
        w('w4', 'T1.13', 'PS.-'),
        w('w5', 'PB1.a', 'CR2.11'),
        w('w6', 'CR2.3', 'T1.9'),
        w('w7', 'T1.5', 'CR1.14'),
        w('w8', 'CR2.3', 'CR1.9'),
        w('w9', 'CR1.5', 'CR1.14'),
        w('w10', 'CR1.13', 'PS.-'),
        w('w11', 'PB1.a', 'CR1.10'),
        w('w12', 'CR1.6', 'T2.14'),
        w('w13', 'T2.13', 'PS.-'),
        w('w14', 'PB1.a', 'T2.9'),
        w('w15', 'T2.5', 'CR2.14'),
        w('w16', 'CR2.13', 'PS.-'),
        w('w17', 'PB1.a', 'CR1.12'),
        w('w18', 'CR1.8', 'PL1.+'),
        w('w19', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(4000);
    const edges = sim.log.transitions('PL1').filter((e) => e.tMs > 0);
    expect(edges.length).toBeGreaterThanOrEqual(4);
    const gaps: number[] = [];
    for (let i = 1; i < edges.length; i += 1) {
      gaps.push((edges[i]?.tMs ?? 0) - (edges[i - 1]?.tMs ?? 0));
    }
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(400);
      expect(gap).toBeLessThan(700);
    }
    expect(sim.events.chatters().length).toBe(0);
    const t1Off = sim.log.transitions('T1.coil');
    expect(t1Off.length).toBeGreaterThan(2);
  });

  it('タイマ復帰時間: 断90msなら経過時間を保持し、110msならリセットする', () => {
    const build = (): Simulation =>
      bench(
        [createPowerSupply('PS'), createPushButton('PB1'), createTimer4c('T1', 1000)],
        [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'T1.14'), w('w3', 'T1.13', 'PS.-')],
      );

    const hold = build();
    powerOn(hold);
    hold.press('PB1');
    hold.run(500);
    hold.release('PB1');
    hold.run(590);
    hold.press('PB1');
    hold.run(2500);
    const holdAt = firstTrue(hold, 'T1') ?? -1;
    expect(Math.abs(holdAt - 1090)).toBeLessThanOrEqual(20);

    const reset = build();
    powerOn(reset);
    reset.press('PB1');
    reset.run(500);
    reset.release('PB1');
    reset.run(610);
    reset.press('PB1');
    reset.run(2500);
    const resetAt = firstTrue(reset, 'T1') ?? -1;
    expect(Math.abs(resetAt - 1600)).toBeLessThanOrEqual(20);
  });
});
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- golden-timer.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
test(circuit-sim): add golden cases for timer circuits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 20: ゴールデンケース③ 禁則回路

**Files:**
- Test: `packages/circuit-sim/test/golden-forbidden.test.ts`

仕様 §14.1 の #12（タイマ自己遮断ワンショット）／#13（タイマ2個フリッカ）。どちらも通電断が1tick（10ms）しか続かず §5.3.2 の復帰時間モデルで経過時間が保持されるため、tick周期で接点が反転して `ChatterEvent` が発火する（調査資料 §5.5 の「厳禁」の再現）。

- [x] テストを書く。`packages/circuit-sim/test/golden-forbidden.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createLamp, createPowerSupply, createPushButton, createTimer4c } from '../src/index.js';
import { bench, powerOn, w } from './helpers/circuits.js';

describe('禁則回路', () => {
  it('タイマ自己遮断ワンショットはチャタリングする', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createTimer4c('T1', 300),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'T1.11'),
        w('w3', 'T1.3', 'T1.14'),
        w('w4', 'T1.13', 'PS.-'),
        w('w5', 'PB1.a', 'T1.9'),
        w('w6', 'T1.5', 'PL1.+'),
        w('w7', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(2000);
    expect(sim.events.chatters().length).toBeGreaterThan(0);
    expect(sim.events.chatters('T1').length).toBeGreaterThan(0);
  });

  it('タイマ2個だけのフリッカはチャタリングする', () => {
    const sim = bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createTimer4c('T1', 300),
        createTimer4c('T2', 300),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'T2.11'),
        w('w3', 'T2.3', 'T1.14'),
        w('w4', 'T1.13', 'PS.-'),
        w('w5', 'PB1.a', 'T1.9'),
        w('w6', 'T1.5', 'T2.14'),
        w('w7', 'T2.13', 'PS.-'),
        w('w8', 'PB1.a', 'T1.10'),
        w('w9', 'T1.6', 'PL1.+'),
        w('w10', 'PL1.-', 'PS.-'),
      ],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.run(3000);
    expect(sim.events.chatters().length).toBeGreaterThan(0);
  });
});
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- golden-forbidden.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
test(circuit-sim): add golden cases for forbidden timer circuits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 21: ゴールデンケース④ 故障・測定・保護・決定論

**Files:**
- Test: `packages/circuit-sim/test/golden-fault-meter.test.ts`

仕様 §14.1 の #16（短絡と電源保護）／#17（コイル断線）／#18（レアショート: 動作は正常、抵抗のみ 422.5Ω／260Ω／552.5Ω）／#19（接点溶着）／#20（接触不良500Ω）／#21（抵抗測定の回り込み）／#22（1端子3本）／#24（決定論）と、§5.3.1 のヒステリシス、§5.6 #4 の電源手順違反、§5.6 #1 の通電中Ωに対応する。

- [x] テストを書く。`packages/circuit-sim/test/golden-fault-meter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  continuity,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  equivalentResistance,
  injectFault,
  measureResistance,
  measureVoltage,
} from '../src/index.js';
import type { Simulation } from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

describe('故障・測定・保護', () => {
  function coilBench(): Simulation {
    return bench(
      [
        createPowerSupply('PS'),
        createPushButton('PB1'),
        createRelay4c('CR1'),
        createLamp('PL1', '白'),
      ],
      [
        w('w1', 'PS.+', 'PB1.c'),
        w('w2', 'PB1.a', 'CR1.14'),
        w('w3', 'CR1.13', 'PS.-'),
        w('w4', 'PS.+', 'CR1.9'),
        w('w5', 'CR1.5', 'PL1.+'),
        w('w6', 'PL1.-', 'PS.-'),
      ],
    );
  }

  it('リレーのヒステリシス: 帯域内では直前の状態を保つ', () => {
    const held = coilBench();
    powerOn(held);
    held.press('PB1');
    held.run(200);
    expect(held.state().relays['CR1']?.contactsOn).toBe(true);
    injectFault(held.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 1000);
    held.run(500);
    const volts = held.state().relays['CR1']?.coilVolts ?? 0;
    expect(volts).toBeGreaterThan(2.4);
    expect(volts).toBeLessThan(19.2);
    expect(held.state().relays['CR1']?.contactsOn).toBe(true);
    held.release('PB1');
    held.run(800);
    expect(held.state().relays['CR1']?.contactsOn).toBe(false);

    const never = coilBench();
    injectFault(never.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 1000);
    powerOn(never);
    never.press('PB1');
    never.run(500);
    expect(never.state().relays['CR1']?.contactsOn).toBe(false);
  });

  it('接触不良500Ωでコイルが19.2V未満になり不動作', () => {
    const sim = coilBench();
    injectFault(sim.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 500);
    powerOn(sim);
    sim.press('PB1');
    sim.run(500);
    expect(sim.state().relays['CR1']?.coilVolts ?? 0).toBeCloseTo(13.564, 2);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
  });

  it('接触不良3000Ωでランプが暗点灯', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    injectFault(sim.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 3000);
    powerOn(sim);
    sim.press('PB1');
    sim.run(200);
    expect(sim.state().lamps['PL1']?.volts ?? 0).toBeCloseTo(10.666, 2);
    expect(sim.state().lamps['PL1']?.level).toBe('dim');
  });

  it('短絡で保護が動作し、正しい手順でのみ復帰する', () => {
    const sim = bench(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+'), w('w2', 'PL1.-', 'PS.-'), w('short', 'PS.+', 'PS.-')],
    );
    powerOn(sim);
    sim.step();
    expect(sim.state().tripped).toBe(true);
    expect(sim.events.hazards('short-circuit-power-on').length).toBe(1);
    sim.setSwitch(false);
    sim.setSwitch(true);
    expect(sim.state().tripped).toBe(true);
    sim.setSwitch(false);
    sim.setBreaker(false);
    sim.setBreaker(true);
    sim.setSwitch(true);
    expect(sim.state().tripped).toBe(false);
    sim.step();
    expect(sim.state().tripped).toBe(true);
    sim.setSwitch(false);
    sim.setBreaker(false);
    sim.removeWire('short');
    sim.setBreaker(true);
    sim.setSwitch(true);
    expect(sim.state().tripped).toBe(false);
    sim.run(sim.tMs + 200);
    expect(sim.state().tripped).toBe(false);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
  });

  it('電源ON/OFFの手順違反でイベントが出る', () => {
    const sim = bench([createPowerSupply('PS')], []);
    sim.setSwitch(true);
    expect(sim.events.countOf('power-sequence-violation')).toBe(1);
    sim.setBreaker(true);
    expect(sim.events.countOf('power-sequence-violation')).toBe(2);
    sim.setBreaker(false);
    expect(sim.events.countOf('power-sequence-violation')).toBe(3);
    const ok = bench([createPowerSupply('PS')], []);
    ok.setBreaker(true);
    ok.setSwitch(true);
    ok.setSwitch(false);
    ok.setBreaker(false);
    expect(ok.events.countOf('power-sequence-violation')).toBe(0);
  });

  it('故障注入: wire-open / 溶着 / コイル断線 / レアショート', () => {
    const open = coilBench();
    injectFault(open.netlist, { wireId: 'w3' }, 'wire-open');
    powerOn(open);
    open.press('PB1');
    open.run(300);
    expect(open.state().relays['CR1']?.contactsOn).toBe(false);

    const welded = coilBench();
    injectFault(welded.netlist, { partId: 'CR1', elementIndex: 2 }, 'contact-welded');
    powerOn(welded);
    welded.run(300);
    expect(welded.state().lamps['PL1']?.level).toBe('lit');
    const b1 = welded.netlist.parts
      .find((p) => p.id === 'CR1')
      ?.elements.find((e) => e.id === 'CR1:b1');
    expect(b1?.kind === 'contact' ? b1.fault?.kind : undefined).toBe('open');

    const broken = coilBench();
    injectFault(broken.netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-open');
    powerOn(broken);
    broken.press('PB1');
    broken.run(300);
    expect(broken.state().relays['CR1']?.contactsOn).toBe(false);

    const layer = coilBench();
    injectFault(layer.netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-layer-short');
    powerOn(layer);
    layer.press('PB1');
    layer.run(300);
    expect(layer.state().relays['CR1']?.contactsOn).toBe(true);
    expect(layer.state().lamps['PL1']?.level).toBe('lit');
  });

  it('レアショートのコイル抵抗は ratio どおりに下がる', () => {
    for (const [ratio, ohms] of [
      [0.65, 422.5],
      [0.4, 260],
      [0.85, 552.5],
    ] as const) {
      const sim = bench(
        [createPowerSupply('PS'), createRelay4c('CR1')],
        [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
      );
      injectFault(sim.netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-layer-short', ratio);
      expect(equivalentResistance(sim.netlist, t('CR1.13'), t('CR1.14'))).toBeCloseTo(ohms, 1);
    }
  });

  it('無通電の抵抗測定は回り込みを含む', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1'), createLamp('PL1', '白')],
      [
        w('w1', 'PS.+', 'CR1.14'),
        w('w2', 'CR1.13', 'PS.-'),
        w('w3', 'PS.+', 'PL1.+'),
        w('w4', 'PL1.-', 'PS.-'),
      ],
    );
    expect(measureResistance(sim, t('CR1.13'), t('CR1.14')).ohms).toBeCloseTo(511.475, 1);
    injectFault(sim.netlist, { partId: 'PL1', elementIndex: 0 }, 'lamp-open');
    expect(measureResistance(sim, t('CR1.13'), t('CR1.14')).ohms).toBeCloseTo(650, 1);
    injectFault(sim.netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-open');
    expect(measureResistance(sim, t('CR1.13'), t('CR1.14')).overRange).toBe(true);
  });

  it('電圧測定・導通・通電中Ω', () => {
    const sim = bench(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    expect(continuity(sim, t('PS.+'), t('CR1.14')).conductive).toBe(true);
    expect(continuity(sim, t('CR1.1'), t('CR1.5')).conductive).toBe(false);
    powerOn(sim);
    sim.run(100);
    expect(measureVoltage(sim, t('PS.-'), t('PS.+')).volts).toBeCloseTo(23.996, 2);
    expect(measureVoltage(sim, t('PS.+'), t('PS.-')).volts).toBeCloseTo(-23.996, 2);
    const reading = measureResistance(sim, t('CR1.13'), t('CR1.14'));
    expect(reading.live).toBe(true);
    expect(reading.display).toBe('OL');
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
  });

  it('決定論: 同じ操作列で同じログになる', () => {
    const script = (sim: Simulation): void => {
      powerOn(sim);
      sim.press('PB1');
      sim.run(200);
      sim.release('PB1');
      sim.run(600);
    };
    const a = coilBench();
    const b = coilBench();
    script(a);
    script(b);
    expect(JSON.stringify(b.log.entries())).toBe(JSON.stringify(a.log.entries()));
  });

  it('1端子の電線本数を数え、上限超過でイベントが出る', () => {
    const sim = bench([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    sim.addWire(w('w1', 'PS.+', 'PL1.+'));
    sim.addWire(w('w2', 'PS.+', 'PL1.-'));
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(0);
    sim.addWire(w('w3', 'PS.+', 'PS.-'));
    expect(sim.events.countOf('over-wires-per-terminal')).toBe(1);
  });
});
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- golden-fault-meter.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
test(circuit-sim): add golden cases for faults, meter and protection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 22: ゴールデンケース⑤ 判定の許容差と全体検証

**Files:**
- Test: `packages/circuit-sim/test/golden-judge.test.ts`

仕様 §14.1 #23（遷移が150msずれ→合格、250msずれ→不合格、区間長依存の10%規則）。ここでは模範ログも訓練者ログも実際にシミュレーションして作り、`compareLogs` にかける。

- [x] テストを書く。`packages/circuit-sim/test/golden-judge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compareLogs, createLamp, createPowerSupply, createPushButton } from '../src/index.js';
import type { Simulation } from '../src/index.js';
import { bench, powerOn, w } from './helpers/circuits.js';

describe('判定の突き合わせ', () => {
  function logOf(times: number[]): Simulation {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    powerOn(sim);
    const [on = 0, off = 0] = times;
    sim.run(on);
    sim.press('PB1');
    sim.run(off);
    sim.release('PB1');
    sim.run(off + 1000);
    return sim;
  }

  it('150msずれは合格、250msずれは不合格', () => {
    const want = logOf([1000, 2000]);
    const near = logOf([1150, 2150]);
    const far = logOf([1250, 2250]);
    expect(compareLogs(want.log, near.log, ['PL1'])).toEqual([]);
    expect(compareLogs(want.log, far.log, ['PL1']).length).toBeGreaterThan(0);
  });

  it('許容差の境界: 200msちょうどは合格、210msは不合格', () => {
    const want = logOf([1000, 2000]);
    const edge = logOf([1200, 2200]);
    const over = logOf([1210, 2210]);
    expect(compareLogs(want.log, edge.log, ['PL1'])).toEqual([]);
    expect(compareLogs(want.log, over.log, ['PL1']).length).toBeGreaterThan(0);
  });

  it('区間長の10%規則が効く', () => {
    const want = logOf([1000, 6000]);
    const shifted = logOf([1000, 6400]);
    expect(compareLogs(want.log, shifted.log, ['PL1'])).toEqual([]);
    expect(compareLogs(want.log, shifted.log, ['PL1'], { edgeMs: 200, ratio: 0 }).length).toBe(1);
  });
});
```

- [x] テストが通ることを確認する。

```powershell
pnpm --filter @ojt/circuit-sim test -- golden-judge.test.ts
```

期待出力:

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [x] カバレッジを含む全体検証を行う（仕様 §14.2 の「行・分岐とも90%以上」）。

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run --coverage
```

期待出力（数値は下回らないこと。しきい値を割ると `ERROR: Coverage for branches (...) does not meet global threshold (90%)` で失敗する）:

```
 Test Files  17 passed (17)
      Tests  91 passed (91)

Statements   : 98.69% ( 755/765 )
Branches     : 91.97% ( 401/436 )
Functions    : 100% ( 115/115 )
Lines        : 100% ( 649/649 )
```

- [x] ルートからの一括検証を行う。

```powershell
pnpm test
pnpm typecheck
pnpm exec eslint .
pnpm exec prettier --check .
```

期待出力: `Tests  91 passed (91)`、`tsc` と `eslint` は無出力、prettier は `All matched files use Prettier code style!`。

- [x] コミットする。

```powershell
git add packages/circuit-sim
git commit -m @'
test(circuit-sim): add golden cases for judge tolerance

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## 仕様 §5 との対応表（完了判定に使う）

| 仕様 | 内容 | 実装 | テスト |
|---|---|---|---|
| §5.1 | ネットリストモデル（Terminal / Wire / Part / Element） | Task 5・6・7・8 | `ids` / `elements` / `parts` / `netlist` |
| §5.1.1 | 電源要素（DC24V・内部抵抗0.1Ω・1A保護・復帰手順） | Task 7・9・12・13 | `solver`「P–N直結」／`golden-fault-meter`「短絡で保護が動作し」 |
| §5.1.2 | 接点要素（a/b/c・閉時1mΩ・開放・故障3種） | Task 6・14 | `elements` / `faults` |
| §5.1.3 | 負荷要素（コイル650Ω・PL2.4kΩ・BZ1kΩ・PLC入力4.7kΩ・断線・レアショート） | Task 6・7・14 | `elements` / `parts` / `golden-fault-meter`「レアショートのコイル抵抗」 |
| §5.2 | 解法（10ms tick・節点解析・1nS漏れ・ガウス消去・決定論） | Task 9・13 | `solver` 全件／`golden-fault-meter`「決定論」 |
| §5.3.1 | CR（4c・ピン割付・19.2V/2.4V・1tick・極性違反） | Task 7・13 | `parts` / `golden-basic`「コイル極性違反」／`golden-fault-meter`「ヒステリシス」 |
| §5.3.2 | T（限時4c・計時・瞬時復帰・復帰時間100ms・禁則・レンジ・チャタリング） | Task 7・13 | `golden-timer` 全件／`golden-forbidden` 全件 |
| §5.3.3 | PB（c/a/b・自動復帰） | Task 7・12 | `parts` / `actuators` / `golden-basic` |
| §5.3.4 | PL／BZ（抵抗・点灯判定） | Task 7・13 | `parts` / `golden-fault-meter`「暗点灯」 |
| §5.3.5 | ブレーカ・電源スイッチ（ON/OFF手順・逆手順イベント） | Task 12・13 | `actuators` / `golden-fault-meter`「手順違反」 |
| §5.4 | 故障注入API（9種） | Task 14 | `faults` / `golden-fault-meter`「故障注入」 |
| §5.5 | テスター測定API（DCV・ACV・Ω・CONT・OL） | Task 15 | `meter` / `golden-fault-meter`「回り込み」「電圧測定・導通」 |
| §5.6 | 危険操作の判定（5種のイベント） | Task 10・13・15 | `events` / `meter` / `golden-fault-meter` |
| §5.7 | 出力（信号ログ・ランレングス） | Task 11・13 | `log` / `simulation`「監視端子の電位」 |
| §7.4 | 判定の許容差 | Task 16 | `compare` / `golden-judge` |
| §14.1 #1〜#24 | Phase 1 対象のゴールデンケース | Task 18〜22 | `golden-*` 5ファイル |

（§14.1 #25〜#28 は `ladder-core` を要するため Phase 3、#29 は `schematic-core`、#30 は `content` の担当で、いずれも本計画の範囲外。）

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本計画での実装 | 理由 |
|---|---|---|---|
| 1 | §5.1.1「P端子が +24V」（＝P側を固定電位にする解き方） | 基準は電源のN側（0V）だけを固定し、電源は内部抵抗0.1Ωのノートン等価として行列に加える | P側を固定電位にすると §5.1.1 の内部抵抗0.1Ωを表現できず、P–N直結時の電流が有限値にならないので §5.1.1 の保護判定（>1A）が成立しない。ノートン等価なら短絡電流が 24V/0.1Ω = 240A と求まり保護が動く |
| 2 | §5.2「LU分解（部分ピボット選択）。行列の構造が変化しない間は分解結果を再利用する」 | 部分ピボット選択つきガウス消去を毎tick実行し、分解結果の再利用はしない | 数値的には等価。再利用は §5.2 の「1tickあたり1ms未満」を満たすための最適化であり、Phase 1 の回路規模（節点20程度）では不要。節点200に近づいて性能目標を割ったときに Plan 1B 以降で追加する |
| 3 | §5.3.4「端子電圧19.2V以上で点灯表示」 | 点灯 14.4V（定格の60%）以上、暗点灯 7.2V（30%）以上、それ未満は消灯 | §5.3.4 は「確実に点灯する電圧」だけを定めており、接触抵抗による**暗点灯**（故障探索の教育項目）を表現できない。しきい値は部品メタデータ（`litVolts` / `dimVolts`）に持たせてあるので、実機値が判明したら `createLamp()` の既定値だけを差し替えられる |
| 4 | §5.6 #2 `analog-overrange`（`range-exceeded`） | イベント種別と計数APIだけを用意し、発行はしない | 発行元はアナログテスターのレンジ選択UIであり、§16 のとおり Phase 2 の範囲。エンジン側で先に型を確定させておく |
| 5 | §4.2「ESLint の `import/no-cycle` をエラー設定にする」 | Plan 1A では設定しない | パッケージが `circuit-sim` 1つしか無く検出対象が存在しない。2つ目のパッケージが生まれる Plan 1B で `eslint-plugin-import-x` とともに追加する |
| 6 | §4.5「TypeScript は最新安定メジャー」 | `~6.0.3` に固定 | 最新の 7.0 系では typescript-eslint 8 系が `typescript-eslint does not support TS 7.0.` で起動しない（実機で確認済み）。typescript-eslint が TS 7 に対応したら上げる |
| 7 | （仕様に記載なし。§4.5「ESLint ＋ Prettier」は整形対象の範囲を規定していない） | `.prettierignore` に `docs/` を追加 | 文書は散文なので Prettier 整形の対象外（Task 3 実行時のレビュー判断） |
| 8 | （仕様に記載なし。§4.5「技術スタック」はスクリプト名・`.gitattributes` の要否を規定していない） | ルート `typecheck` を `tsc -p tsconfig.json --noEmit && pnpm -r typecheck` に変更、`.gitattributes`（`* text=auto eol=lf`）を追加、`test:coverage` スクリプトを追加 | Task 1〜4 の品質レビュー指摘 |
| 9 | §4.5「TypeScript（`strict: true`、`noUncheckedIndexedAccess: true`）」（`exactOptionalPropertyTypes` の指定なし） | 有効化しない（Plan 1A 完了後に専用タスクで有効化を検討） | 計画コードは無効前提で検証済みのため |
| 10 | §5.2「LU分解（部分ピボット選択）。行列の構造が変化しない間は分解結果を再利用する」（差分#2参照） | LU分解結果の再利用は未実装のまま（差分#2から変更なし） | 毎tickガウス消去で 200節点 0.45ms/tick と実測され、性能予算内であることを確認したため |
| 11 | （仕様に記載なし） | ログの1tick整合: `updateLoads` は tick 開始時の解、`applyContacts`/記録は tick 終了時。接点閉とランプ点灯が同一 tick でずれて記録される（模範・訓練者とも同じエンジンなので判定には影響しない） | 変更しない |

## 追加タスク（実行中のレビュー指摘により追加）

| タスク | コミット | 内容 |
|---|---|---|
| Task 8b | 7ed09b3 | `createNetlist` が入力配列を複製、`cloneNetlist`/`resetNetlist`/`validateNetlist`/`canAddWire`、`toTerminalId`、`partId` が `:` を拒否、`clampPreset` が非有限値を拒否し下限100msを保証。テストは `test/guards.test.ts` |
| Task 8c | bba1125 | `solve()` が節点数200超で `NetlistError`、0Ω/非有限抵抗のガード（`effectiveOhms`）、`SignalLog` の信号別索引と二分探索、`EventBus.all()` が複製を返す、`applyPowerAction` の同状態再操作は違反にしない（`test/actuators.test.ts` の該当期待値を false に変更）。テストは `test/robustness.test.ts` |
| Task 8d | d6a0980 | `NetlistIssue` を `ownerKind`/`ownerId` に改名、`MAX_NODES` を 400 に、`Simulation.setTimerPreset` が `SimulationError` に統一、`contact-resistive` が非有限値を拒否、ヘルパー `t()` を `toTerminalId` に戻す。テストは `test/robustness.test.ts` |
| Task 8e | 4ba4b47 | `Simulation.addWire` が3本目を拒否して `false` を返す（危険操作1回）、`wire-misrouted` の端子存在検証（`knownTerminals`）、数値故障の非数値 `param` を拒否、`CHATTER_MIN_TRANSITIONS` を 20 に、コンストラクタで `resetNetlist`、`overcurrent` 事象の追加（電源投入直後の保護動作のみ `short-circuit-power-on`）。テストは `test/robustness.test.ts` |

Task 13 以降の実装者への注意: 上記により `test/helpers/circuits.ts` は `toTerminalId` を使う形に変わっているが、ヘルパーの名前と引数は計画どおり。計画本文のコードはそのまま適用できる。

## 完了条件

1. `pnpm test` が 91件すべて通る。
2. `pnpm --filter @ojt/circuit-sim exec vitest run --coverage` が行・分岐とも90%以上のしきい値を満たす。
3. `pnpm typecheck`・`pnpm exec eslint .`・`pnpm exec prettier --check .` がすべてエラーなしで終わる。
4. `packages/circuit-sim` が外部ランタイム依存を持たない（`packages/circuit-sim/package.json` に `dependencies` が無い）。

2026-09-14 完了: 21ファイル / 152テスト、カバレッジ Stmts 98.03 / Branches 92.56 / Funcs 100 / Lines 99.1、typecheck/lint/prettier クリーン。最終コミット 127ed71
