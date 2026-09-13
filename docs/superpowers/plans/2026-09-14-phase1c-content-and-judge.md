# Plan 1C: 課題データ・判定パイプライン・内蔵課題（packages/content）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@ojt/content` を作り、モードB（回路組立）の課題JSONスキーマ・読込・模範回路の構築・操作列の再生・タイムチャート生成・静的チェック・合否判定と、内蔵課題8題を、UI無しで完結するライブラリとして実装する。

**Architecture:** 課題JSON（zod）→ `@ojt/schematic-core` の `toSession()` で模範の盤セッション → `@ojt/board-model` の `toNetlist()` でネットリスト → `@ojt/circuit-sim` の `Simulation` に課題の操作列を与えて模範側と訓練者側を並走 → `compareLogs()` で波形を許容差付きで突き合わせ、静的チェックと合わせて合否を出す（設計仕様 決定事項#8）。固定の正解波形は持たず、判定のたびに模範回路をシミュレートする。1ファイル1責務で、スキーマ（`src/schema/*`）・パイプライン（`src/*.ts`）・内蔵課題（`src/builtin/*`）を分ける。

**Tech Stack:** TypeScript（`strict` ＋ `noUncheckedIndexedAccess`）、zod 4.6.0（`z.toJSONSchema()` を標準で持つため `zod-to-json-schema` は入れない）、Vitest 5（カバレッジ v8）、pnpm workspace。依存は `@ojt/circuit-sim` / `@ojt/board-model` / `@ojt/schematic-core` / `zod` のみ（React・Electron・Three.js は Plan 1D）。

**前提（このプランを始める前に満たしていること）:**

- Plan 1A（`@ojt/circuit-sim`）が完了し、`packages/circuit-sim/src/` に `ids.ts` / `elements.ts` / `parts.ts` / `netlist.ts` / `solver.ts` / `events.ts` / `log.ts` / `actuators.ts` / `simulation.ts` / `faults.ts` / `meter.ts` / `compare.ts` / `index.ts` が揃っている。本プランが使うのは `Simulation` / `SignalLog` / `EventBus` / `compareLogs` / `createWire` / `terminalId` / `toTerminalId` / `TICK_MS` / `PICKUP_VOLTS` / `MAX_WIRES_PER_TERMINAL` / `DEFAULT_TOLERANCE` と各種型だけである。
- Plan 1B（`@ojt/board-model` / `@ojt/schematic-core`）が完了している。本プランが使うのは `JIPM_BOARD` / `SOCKET_IDS` / `toNetlist` / `plug` / `removeWire` / `wireCountAtTerminal` / `socketPartId` / `BoardSession` / `BoardDefinition` / `SocketRoles` と、`toSession` / `validateDocument` / `SCHEMATIC_FORMAT_VERSION` だけである。盤は**ソケットを8個**持ち、`SocketRoles` は役割を書かなかったソケットが予備になる `Partial` である（Plan 1B 改訂版 Task 5）。
- ルートに `eslint.config.js`（`import-x/no-cycle` 込み）・`.prettierrc.json`・`tsconfig.base.json`・`vitest.workspace.ts` がある。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `packages/content/package.json` | `@ojt/content` の定義。依存は `@ojt/board-model` / `@ojt/circuit-sim` / `@ojt/schematic-core` / `zod` |
| `packages/content/tsconfig.json` | `resolveJsonModule: true`（内蔵課題のJSONを import するため） |
| `packages/content/vitest.config.ts` | カバレッジ閾値 90%（仕様 §14.2） |
| `src/schema/common.ts` | 共通ヘッダの zod（`formatVersion` / `id` / `title` / `grade` / `mode` / `description` / `timeLimit` / `board` / `inventory`）。§7.1 |
| `src/schema/schematic.ts` | 模範回路（`SchematicDocument`）の zod。`validateDocument()` を refinement として呼ぶ。§7.2 / §11.1 |
| `src/schema/operations.ts` | 操作列 `[{t, target, action}]` と `durationMs` の zod、および畳み込みヘルパ。§7.3 |
| `src/schema/judge.ts` | 判定設定（`compareSignals` / `tolerance` / `staticChecks`）の zod と既定値。§7.4 |
| `src/schema/assemble.ts` | モードB課題の本体スキーマ（ヘッダ＋回路図＋操作列＋判定設定＋ヒント）。§7.1〜§7.4 |
| `src/schema/index.ts` | `ProblemSchema`（`mode` の判別共用体）、`parseProblem()`、JSON Schema 生成。§7.8 / §13 #1 |
| `src/loader.ts` | フォルダ読込 `loadProblemsFromDir()` と `mergeProblemSets()`（利用者フォルダ優先）。§7.8 / §13 #9 |
| `src/reference.ts` | 模範回路の構築 `buildReferenceSession()`。物理割当エラーを課題エラーに変換。§7.2 / §13 #2 |
| `src/runner.ts` | 操作列の再生 `runOperations()`。`t=0` で正しい手順で通電し `durationMs` まで進める。§7.3 |
| `src/timechart.ts` | ログ → タイムチャートモデル `buildTimeChart()` とタイマ目盛 `timerMarkers()`。§7.7 |
| `src/static-checks.ts` | 6種の静的チェックと `runStaticChecks()`。§7.4 |
| `src/judge.ts` | `judgeAssemble()` / `judgeReference()`。波形比較＋静的チェック＋タイムチャート。§7.4 / §8.3 |
| `src/builtin/index.ts` | 内蔵課題の登録（JSONを `parseProblem()` に通した配列を公開）。§7.8 |
| `src/builtin/assemble/*.json` | 内蔵のモードB課題8題。§7.9 |
| `src/index.ts` | `@ojt/content` の公開API |
| `test/schema-common.test.ts` 〜 `test/builtin.test.ts` | 1ソースファイルにつき1テストファイル |
| `test/helpers/problems.ts` | テスト用の課題JSONの骨組み（正常な自己保持回路と禁則ワンショット） |

---

## Task 1: content パッケージの雛形

**Files:**
- Create: `packages/content/package.json`
- Create: `packages/content/tsconfig.json`
- Create: `packages/content/vitest.config.ts`
- Create: `packages/content/test/scaffold.test.ts`

- [ ] **Step 1: パッケージ定義を作る**

`packages/content/package.json`:

```json
{
  "name": "@ojt/content",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@ojt/board-model": "workspace:*",
    "@ojt/circuit-sim": "workspace:*",
    "@ojt/schematic-core": "workspace:*",
    "zod": "4.6.0"
  }
}
```

zod のバージョンを 4.6.0 に固定する理由:

- zod 4 系は `z.toJSONSchema()` を**標準で持つ**ため、`zod-to-json-schema` のような追加依存を入れずに `resources/schema/task.schema.json` を生成できる（仕様 §4.5「zod から JSON Schema を生成して同梱」）。
- 4.6.0 は 4.6 系の最初のパッチで、pnpm の新規公開パッケージ抑止（`minimumReleaseAge`）に掛からない。実機で `pnpm install` が追加設定なしに通ることを確認済み。

- [ ] **Step 2: TypeScript 設定を作る**

`packages/content/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "resolveJsonModule": true },
  "include": ["src/**/*.ts", "src/**/*.json", "test/**/*.ts", "vitest.config.ts"]
}
```

`resolveJsonModule` は `src/builtin/index.ts` が課題JSONを `import` するために要る。

- [ ] **Step 3: Vitest 設定を作る**

`packages/content/vitest.config.ts`:

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

- [ ] **Step 4: 依存をインストールする**

```powershell
pnpm install
```

Expected: `packages/content` を含む全ワークスペースが解決され、`+ zod 4.6.0` が表示される。

- [ ] **Step 5: 雛形が動くことを確かめるテストを書く**

`packages/content/test/scaffold.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { TICK_MS } from '@ojt/circuit-sim';
import { SCHEMATIC_FORMAT_VERSION } from '@ojt/schematic-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('scaffold', () => {
  it('can reach every dependency of @ojt/content', () => {
    expect(JIPM_BOARD.id).toBe('board-jipm-std');
    expect(TICK_MS).toBe(10);
    expect(SCHEMATIC_FORMAT_VERSION).toBe(1);
    expect(z.string().safeParse('ok').success).toBe(true);
  });
});
```

- [ ] **Step 6: テストが通ることを確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/scaffold.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  1 passed (1)`

- [ ] **Step 7: コミット**

```powershell
git add packages/content/package.json packages/content/tsconfig.json packages/content/vitest.config.ts packages/content/test/scaffold.test.ts pnpm-lock.yaml
git commit -m @'
chore(content): scaffold @ojt/content package with zod and vitest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 2: src/schema/common.ts — 共通ヘッダ

**Files:**
- Create: `packages/content/src/schema/common.ts`
- Test: `packages/content/test/schema-common.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/schema-common.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CONTENT_FORMAT_VERSION,
  GradeSchema,
  ProblemHeaderSchema,
  ProblemIdSchema,
  SocketRolesSchema,
  TerminalIdSchema,
  TimeLimitSchema,
  UNSUPPORTED_MODES,
} from '../src/schema/common.js';

const HEADER = {
  formatVersion: 1,
  id: 'b-001',
  title: '自己保持回路',
  grade: 3,
  mode: 'assemble',
  description: '課題文',
  timeLimit: { standardMin: 30, cutoffMin: 50 },
  board: {
    boardId: 'board-jipm-std',
    socketRoles: { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' },
  },
  inventory: [{ kind: 'relay-my4n', count: 2 }],
};

describe('ProblemIdSchema', () => {
  it('accepts lowercase alphanumerics and hyphens', () => {
    expect(ProblemIdSchema.safeParse('b-001').success).toBe(true);
    expect(ProblemIdSchema.safeParse('b001').success).toBe(true);
  });

  it('rejects other spellings', () => {
    expect(ProblemIdSchema.safeParse('B_001').success).toBe(false);
    expect(ProblemIdSchema.safeParse('b--001').success).toBe(false);
    expect(ProblemIdSchema.safeParse('').success).toBe(false);
  });
});

describe('TimeLimitSchema', () => {
  it('accepts a cutoff that is not shorter than the standard time', () => {
    expect(TimeLimitSchema.safeParse({ standardMin: 50, cutoffMin: 60 }).success).toBe(true);
    expect(TimeLimitSchema.safeParse({ standardMin: 30, cutoffMin: 30 }).success).toBe(true);
  });

  it('rejects a cutoff shorter than the standard time', () => {
    const parsed = TimeLimitSchema.safeParse({ standardMin: 50, cutoffMin: 30 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['cutoffMin']);
  });
});

describe('SocketRolesSchema', () => {
  it('accepts the default layout that fills all seven roles (§6.1)', () => {
    expect(
      SocketRolesSchema.safeParse({
        S1: 'CR1',
        S2: 'CR2',
        S3: 'CR3',
        S4: 'CR4',
        S5: 'T1',
        S6: 'T2',
        S7: 'CHK',
      }).success,
    ).toBe(true);
  });

  it('accepts the two exam layouts, leaving the rest as spare sockets (§6.1)', () => {
    expect(
      SocketRolesSchema.safeParse({ S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S7: 'CHK' })
        .success,
    ).toBe(true);
    expect(
      SocketRolesSchema.safeParse({ S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' }).success,
    ).toBe(true);
  });

  it('rejects duplicated roles', () => {
    expect(
      SocketRolesSchema.safeParse({ S1: 'CR1', S2: 'CR1', S5: 'T1', S6: 'T2', S7: 'CHK' }).success,
    ).toBe(false);
  });

  it('rejects a layout without the check socket', () => {
    expect(
      SocketRolesSchema.safeParse({ S1: 'CR1', S2: 'CR2', S3: 'CR3', S5: 'T1', S6: 'T2' }).success,
    ).toBe(false);
  });

  it('rejects a socket id the board does not have', () => {
    expect(SocketRolesSchema.safeParse({ S1: 'CR1', S7: 'CHK', S9: 'CR2' }).success).toBe(false);
  });
});

describe('ProblemHeaderSchema', () => {
  it('accepts a complete header', () => {
    expect(ProblemHeaderSchema.safeParse(HEADER).success).toBe(true);
  });

  it('rejects an unknown format version (§13 #8)', () => {
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, formatVersion: 99 }).success).toBe(false);
    expect(CONTENT_FORMAT_VERSION).toBe(1);
  });

  it('rejects an unknown mode', () => {
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, mode: 'debug' }).success).toBe(false);
    expect(UNSUPPORTED_MODES).toEqual(['inspect-parts', 'inspect-repair', 'plc']);
  });

  it('rejects an inventory count above the socket count (8)', () => {
    expect(
      ProblemHeaderSchema.safeParse({ ...HEADER, inventory: [{ kind: 'relay-my4n', count: 8 }] })
        .success,
    ).toBe(true);
    expect(
      ProblemHeaderSchema.safeParse({ ...HEADER, inventory: [{ kind: 'relay-my4n', count: 9 }] })
        .success,
    ).toBe(false);
  });
});

describe('GradeSchema / TerminalIdSchema', () => {
  it('accepts only grades 1..3', () => {
    expect(GradeSchema.safeParse(2).success).toBe(true);
    expect(GradeSchema.safeParse(4).success).toBe(false);
  });

  it('accepts `<part>.<name>` terminal ids (§6.4)', () => {
    expect(TerminalIdSchema.safeParse('CR1.14').success).toBe(true);
    expect(TerminalIdSchema.safeParse('TB_PL.1+').success).toBe(true);
    expect(TerminalIdSchema.safeParse('CR1').success).toBe(false);
    expect(TerminalIdSchema.safeParse('CR1:coil.1').success).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-common.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/schema/common.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/schema/common.ts`:

```ts
import { z } from 'zod';

/**
 * 課題データの共通ヘッダ。設計仕様 §7.1。
 * 定義の唯一の源は zod（§4.5）。TypeScript 型はすべて `z.infer` で導出する。
 */

/** 課題ファイルの形式バージョン。未知のバージョンは読込エラーにする。§13 #8 */
export const CONTENT_FORMAT_VERSION = 1;

/** 課題ID（`b-001` のような英数字とハイフン）。§7.1 */
export const ProblemIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, '課題IDは英小文字・数字・ハイフンで書きます');

/** 想定級。ヒント表示の制御に使う。§7.1 / §8.4 */
export const GradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** 想定級。 */
export type Grade = z.infer<typeof GradeSchema>;

/** 課題モード。Phase 1 が実装するのは `assemble` だけ（§16）。§7.1 */
export const ProblemModeSchema = z.enum(['assemble', 'inspect-parts', 'inspect-repair', 'plc']);

/** 課題モード。 */
export type ProblemMode = z.infer<typeof ProblemModeSchema>;

/** Phase 1 では未対応のモード。読込時に `unsupported-mode` として一覧に出す。§13 #1 */
export const UNSUPPORTED_MODES: readonly ProblemMode[] = ['inspect-parts', 'inspect-repair', 'plc'];

/** 標準時間／打切り時間（分）。§7.1 */
export const TimeLimitSchema = z
  .object({
    standardMin: z.int().min(1).max(600),
    cutoffMin: z.int().min(1).max(600),
  })
  .refine((v) => v.cutoffMin >= v.standardMin, {
    message: '打切り時間は標準時間以上にします',
    path: ['cutoffMin'],
  });

/** 標準時間／打切り時間。 */
export type TimeLimit = z.infer<typeof TimeLimitSchema>;

/** ソケットの役割。board-model の `SocketRole` と同じ集合。§6.1 */
export const SocketRoleSchema = z.enum(['CR1', 'CR2', 'CR3', 'CR4', 'T1', 'T2', 'CHK']);

/**
 * 8ソケットの役割割当。board-model の `SocketRoles`（`Readonly<Partial<Record<SocketId, SocketRole>>>`）
 * に一致させる。**役割を書かなかったソケットは役割なしの予備**であり、端子だけが存在して配線できる（§6.1）。
 * 盤に無いソケットIDはその場で弾く（`z.strictObject`）。
 */
export const SocketRolesSchema = z
  .strictObject({
    S1: SocketRoleSchema.optional(),
    S2: SocketRoleSchema.optional(),
    S3: SocketRoleSchema.optional(),
    S4: SocketRoleSchema.optional(),
    S5: SocketRoleSchema.optional(),
    S6: SocketRoleSchema.optional(),
    S7: SocketRoleSchema.optional(),
    S8: SocketRoleSchema.optional(),
  })
  .refine(
    (v) => {
      const assigned = Object.values(v).filter((role) => role !== undefined);
      return new Set(assigned).size === assigned.length;
    },
    { message: 'ソケットの役割が重複しています' },
  )
  .refine((v) => Object.values(v).includes('CHK'), {
    message: 'チェック用ソケット（CHK）が割り当てられていません',
  });

/** 8ソケットの役割割当。 */
export type SocketRolesData = z.infer<typeof SocketRolesSchema>;

/** 盤に追加できる任意部品。標準盤に BZ は無い。§5.3.4 */
export const ExtraPartSchema = z.enum(['BZ']);

/** 課題が使う盤の指定。§7.1 */
export const BoardRefSchema = z.object({
  boardId: z.string().min(1),
  socketRoles: SocketRolesSchema,
  extraParts: z.array(ExtraPartSchema).optional(),
});

/** 課題が使う盤の指定。 */
export type BoardRef = z.infer<typeof BoardRefSchema>;

/** 装着できる部品種別。board-model の `MountableKind` と同じ集合。§6.6 */
export const MountableKindSchema = z.enum(['relay-my4n', 'timer-h3y4']);

/** 在庫1件。上限は盤のソケット数（8）。§7.1 / §6.1 */
export const InventoryItemSchema = z.object({
  kind: MountableKindSchema,
  count: z.int().min(0).max(8),
});

/** 在庫1件。 */
export type InventoryItemData = z.infer<typeof InventoryItemSchema>;

/** すべてのモードに共通するヘッダ項目。§7.1 */
export const ProblemHeaderShape = {
  formatVersion: z.literal(CONTENT_FORMAT_VERSION),
  id: ProblemIdSchema,
  title: z.string().min(1),
  grade: GradeSchema,
  description: z.string(),
  timeLimit: TimeLimitSchema,
  board: BoardRefSchema,
  inventory: z.array(InventoryItemSchema),
};

/** 共通ヘッダだけを取り出したスキーマ（モードの判別前に使う）。 */
export const ProblemHeaderSchema = z.object({
  ...ProblemHeaderShape,
  mode: ProblemModeSchema,
});

/** 共通ヘッダ。 */
export type ProblemHeader = z.infer<typeof ProblemHeaderSchema>;

/** 端子ID（`<部品ID>.<端子名>`）の文字列形式。§6.4 */
export const TerminalIdSchema = z
  .string()
  .regex(/^[^.:]+\.[^:]+$/u, '端子IDは `<部品ID>.<端子名>` の形式です');
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-common.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  15 passed (15)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/schema/common.ts packages/content/test/schema-common.test.ts
git commit -m @'
feat(content): add common problem header schema

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 3: src/schema/schematic.ts — 模範回路のスキーマ

**Files:**
- Create: `packages/content/src/schema/schematic.ts`
- Test: `packages/content/test/schema-schematic.test.ts`

`SchematicDocument` の構造検査は `@ojt/schematic-core` の `validateDocument()` が既に持っている（Plan 1B Task 12）。ここでは**同じ判定を二重に書かず**、zod の `superRefine` からそれを呼んで、返ってきた `{ path, message }` を zod の issue に変換する。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/schema-schematic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SchematicDocumentSchema, toZodPath } from '../src/schema/schematic.js';

const DOC = {
  formatVersion: 1,
  id: 'sch-x',
  title: 'a接点',
  orientation: 'horizontal',
  rungs: [
    {
      id: 'r1',
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [
        { kind: 'pb-a', id: 'c01', device: 'PB1' },
        { kind: 'lamp', id: 'c02', device: 'PL1' },
      ],
    },
  ],
};

describe('SchematicDocumentSchema', () => {
  it('accepts a valid document', () => {
    expect(SchematicDocumentSchema.safeParse(DOC).success).toBe(true);
  });

  it('rejects a wrong orientation (§11.1)', () => {
    expect(SchematicDocumentSchema.safeParse({ ...DOC, orientation: 'vertical' }).success).toBe(
      false,
    );
  });

  it('rejects a device name that does not fit the cell kind', () => {
    const parsed = SchematicDocumentSchema.safeParse({
      ...DOC,
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 'cr-a', id: 'c01', device: 'PB1' },
            { kind: 'lamp', id: 'c02', device: 'PL1' },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['rungs', 0, 'cells', 0]);
  });

  it('surfaces validateDocument errors with their path (§11.1)', () => {
    const parsed = SchematicDocumentSchema.safeParse({
      ...DOC,
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [{ kind: 'pb-a', id: 'c01', device: 'PB1' }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['rungs', 0]);
    expect(parsed.error.issues[0]?.message).toContain('負荷');
  });

  it('requires presetMs on a timer coil and forbids it elsewhere (§5.3.2)', () => {
    const withoutPreset = SchematicDocumentSchema.safeParse({
      ...DOC,
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [{ kind: 'coil', id: 'c01', device: 'T1' }],
        },
      ],
    });
    expect(withoutPreset.success).toBe(false);
    const strayPreset = SchematicDocumentSchema.safeParse({
      ...DOC,
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [{ kind: 'coil', id: 'c01', device: 'CR1', presetMs: 1000 }],
        },
      ],
    });
    expect(strayPreset.success).toBe(false);
  });
});

describe('toZodPath', () => {
  it('converts validateDocument paths to zod paths', () => {
    expect(toZodPath('rungs[0].cells[2]')).toEqual(['rungs', 0, 'cells', 2]);
    expect(toZodPath('formatVersion')).toEqual(['formatVersion']);
    expect(toZodPath('[0]')).toEqual(['[0]']);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-schematic.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/schema/schematic.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/schema/schematic.ts`:

```ts
import { SCHEMATIC_FORMAT_VERSION, validateDocument } from '@ojt/schematic-core';
import { z } from 'zod';

/**
 * 模範回路（展開接続図）のスキーマ。設計仕様 §7.2 / §11.1。
 * 形は `@ojt/schematic-core` の `SchematicDocument` に一致させ、構造の妥当性は
 * 同パッケージの `validateDocument()` をそのまま refinement として呼んで判定する。
 */

/** 要素の種別。`CellKind` と同じ集合。§11.1 */
export const CellKindSchema = z.enum([
  'pb-a',
  'pb-b',
  'cr-a',
  'cr-b',
  't-a',
  't-b',
  'coil',
  'lamp',
  'buzzer',
]);

/** 段の中の1要素。§11.1 */
export const SchematicCellSchema = z.object({
  kind: CellKindSchema,
  id: z.string().min(1),
  device: z.string().min(1),
  presetMs: z.int().min(100).max(60_000).optional(),
});

/** 段の端点（母線か他の段の節点）。§11.1 */
export const RungEndSchema = z.union([
  z.object({ bus: z.enum(['P', 'N']) }),
  z.object({ rung: z.string().min(1), node: z.int().min(0) }),
]);

/** 1段（ラング）。§11.1 */
export const RungSchema = z.object({
  id: z.string().min(1),
  from: RungEndSchema,
  to: RungEndSchema,
  cells: z.array(SchematicCellSchema).min(1),
});

/** `validateDocument()` のパス文字列（`rungs[0].cells[2]`）を zod のパス配列に直す。 */
export function toZodPath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const token of path.split('.')) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/u.exec(token);
    if (match === null) {
      out.push(token);
      continue;
    }
    out.push(match[1] ?? token);
    for (const index of (match[2] ?? '').matchAll(/\[(\d+)\]/gu)) {
      out.push(Number(index[1]));
    }
  }
  return out;
}

/** 展開接続図の文書。§11.1 */
export const SchematicDocumentSchema = z
  .object({
    formatVersion: z.literal(SCHEMATIC_FORMAT_VERSION),
    id: z.string().min(1),
    title: z.string().min(1),
    orientation: z.literal('horizontal'),
    rungs: z.array(RungSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    for (const error of validateDocument(doc)) {
      ctx.addIssue({ code: 'custom', path: toZodPath(error.path), message: error.message });
    }
  });

/** 展開接続図の文書（zod 出力型）。 */
export type SchematicDocumentData = z.infer<typeof SchematicDocumentSchema>;
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-schematic.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  6 passed (6)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/schema/schematic.ts packages/content/test/schema-schematic.test.ts
git commit -m @'
feat(content): add schematic document schema backed by validateDocument

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 4: src/schema/operations.ts — 操作列

**Files:**
- Create: `packages/content/src/schema/operations.ts`
- Test: `packages/content/test/schema-operations.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/schema-operations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DurationMsSchema,
  lastOperationMs,
  OperationListSchema,
  OperationSchema,
  pressedAt,
} from '../src/schema/operations.js';

describe('OperationSchema', () => {
  it('accepts a tick-aligned operation', () => {
    expect(OperationSchema.safeParse({ t: 500, target: 'PB1', action: 'press' }).success).toBe(
      true,
    );
  });

  it('rejects a time that is not a multiple of the tick (§7.3)', () => {
    expect(OperationSchema.safeParse({ t: 505, target: 'PB1', action: 'press' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown target or action', () => {
    expect(OperationSchema.safeParse({ t: 0, target: 'PB5', action: 'press' }).success).toBe(false);
    expect(OperationSchema.safeParse({ t: 0, target: 'PB1', action: 'hold' }).success).toBe(false);
  });
});

describe('OperationListSchema', () => {
  it('accepts a non decreasing list', () => {
    expect(
      OperationListSchema.safeParse([
        { t: 0, target: 'PB1', action: 'press' },
        { t: 0, target: 'PB2', action: 'press' },
        { t: 500, target: 'PB1', action: 'release' },
      ]).success,
    ).toBe(true);
  });

  it('rejects a decreasing list and points at the offending entry', () => {
    const parsed = OperationListSchema.safeParse([
      { t: 1000, target: 'PB1', action: 'press' },
      { t: 500, target: 'PB1', action: 'release' },
    ]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual([1, 't']);
  });
});

describe('DurationMsSchema', () => {
  it('accepts a tick-aligned positive duration', () => {
    expect(DurationMsSchema.safeParse(5000).success).toBe(true);
  });

  it('rejects zero and a misaligned duration', () => {
    expect(DurationMsSchema.safeParse(0).success).toBe(false);
    expect(DurationMsSchema.safeParse(5005).success).toBe(false);
  });
});

describe('pressedAt / lastOperationMs', () => {
  const ops = [
    { t: 100, target: 'PB1', action: 'press' },
    { t: 300, target: 'PB1', action: 'release' },
  ] as const;

  it('folds an operation list', () => {
    expect(pressedAt(ops, 'PB1', 90)).toBe(false);
    expect(pressedAt(ops, 'PB1', 200)).toBe(true);
    expect(pressedAt(ops, 'PB1', 300)).toBe(false);
    expect(pressedAt(ops, 'PB2', 200)).toBe(false);
  });

  it('reports the last operation time', () => {
    expect(lastOperationMs(ops)).toBe(300);
    expect(lastOperationMs([])).toBe(0);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-operations.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/schema/operations.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/schema/operations.ts`:

```ts
import { TICK_MS } from '@ojt/circuit-sim';
import { z } from 'zod';

/**
 * 操作列。設計仕様 §7.3。
 * `t` は判定開始からのミリ秒で、tick（10ms）の倍数・非減少であることを要求する。
 * 電源投入（ブレーカ→スイッチ）は操作列に書かない。`t=0` で通電済みとする。
 */

/** 操作対象の押ボタン。§5.3.3 */
export const OperationTargetSchema = z.enum(['PB1', 'PB2', 'PB3', 'PB4']);

/** 操作対象。 */
export type OperationTarget = z.infer<typeof OperationTargetSchema>;

/** 操作の種類。§7.3 */
export const OperationActionSchema = z.enum(['press', 'release']);

/** 操作の種類。 */
export type OperationAction = z.infer<typeof OperationActionSchema>;

/** 操作1件。§7.3 */
export const OperationSchema = z.object({
  t: z
    .int()
    .min(0)
    .refine((v) => v % TICK_MS === 0, { message: `操作時刻は ${TICK_MS}ms の倍数にします` }),
  target: OperationTargetSchema,
  action: OperationActionSchema,
});

/** 操作1件。 */
export type Operation = z.infer<typeof OperationSchema>;

/** 操作列（`t` は非減少）。§7.3 */
export const OperationListSchema = z.array(OperationSchema).superRefine((ops, ctx) => {
  for (let i = 1; i < ops.length; i += 1) {
    const previous = ops[i - 1];
    const current = ops[i];
    if (previous === undefined || current === undefined) continue;
    if (current.t < previous.t) {
      ctx.addIssue({
        code: 'custom',
        path: [i, 't'],
        message: `操作列の時刻は非減少にします（${previous.t}ms の次が ${current.t}ms）`,
      });
    }
  }
});

/** 判定区間の長さ[ms]。タイムチャートの横軸長でもある。§7.3 */
export const DurationMsSchema = z
  .int()
  .min(TICK_MS)
  .max(600_000)
  .refine((v) => v % TICK_MS === 0, { message: `判定区間長は ${TICK_MS}ms の倍数にします` });

/** その押ボタンが `tMs` 時点で押されているか（操作列を畳んで求める）。 */
export function pressedAt(
  operations: readonly Operation[],
  target: OperationTarget,
  tMs: number,
): boolean {
  let pressed = false;
  for (const op of operations) {
    if (op.t > tMs) break;
    if (op.target === target) pressed = op.action === 'press';
  }
  return pressed;
}

/** 操作列の最後の時刻[ms]。空なら 0。 */
export function lastOperationMs(operations: readonly Operation[]): number {
  const last = operations[operations.length - 1];
  return last === undefined ? 0 : last.t;
}
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-operations.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  9 passed (9)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/schema/operations.ts packages/content/test/schema-operations.test.ts
git commit -m @'
feat(content): add operation list schema with tick alignment checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 5: src/schema/judge.ts — 判定設定

**Files:**
- Create: `packages/content/src/schema/judge.ts`
- Test: `packages/content/test/schema-judge.test.ts`

`compareSignals` の既定は「盤に実在する出力部品すべて」（仕様 §7.4）で、これは課題の `board.extraParts` に依存する。そこでスキーマ上は省略可能にし、既定の解決は `resolveCompareSignals()` が担う。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/schema-judge.test.ts`:

```ts
import { DEFAULT_TOLERANCE } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  BOARD_OUTPUT_SIGNALS,
  DEFAULT_STATIC_CHECKS,
  defaultCompareSignals,
  JudgeSettingsSchema,
  resolveCompareSignals,
  STATIC_CHECK_IDS,
} from '../src/schema/judge.js';

describe('JudgeSettingsSchema', () => {
  it('fills the spec defaults when the object is empty (§7.4)', () => {
    const parsed = JudgeSettingsSchema.parse({});
    expect(parsed.tolerance).toEqual({ edgeMs: DEFAULT_TOLERANCE.edgeMs, ratio: 0.1 });
    expect(parsed.staticChecks).toEqual(DEFAULT_STATIC_CHECKS);
    expect(parsed.compareSignals).toBeUndefined();
  });

  it('keeps the values the problem gives', () => {
    const parsed = JudgeSettingsSchema.parse({
      compareSignals: ['PL1'],
      tolerance: { edgeMs: 100, ratio: 0.2 },
      staticChecks: { forbiddenCircuit: false },
    });
    expect(parsed.compareSignals).toEqual(['PL1']);
    expect(parsed.tolerance).toEqual({ edgeMs: 100, ratio: 0.2 });
    expect(parsed.staticChecks.forbiddenCircuit).toBe(false);
    expect(parsed.staticChecks.wireColorRule).toBe(true);
  });

  it('rejects an empty compare list and an out of range ratio', () => {
    expect(JudgeSettingsSchema.safeParse({ compareSignals: [] }).success).toBe(false);
    expect(JudgeSettingsSchema.safeParse({ tolerance: { ratio: 2 } }).success).toBe(false);
  });
});

describe('compare signal defaults', () => {
  it('uses every output part that exists on the board (§7.4)', () => {
    expect(BOARD_OUTPUT_SIGNALS).toEqual(['PL1', 'PL2', 'PL3', 'PL4']);
    expect(defaultCompareSignals()).toEqual(['PL1', 'PL2', 'PL3', 'PL4']);
    expect(defaultCompareSignals(['BZ'])).toEqual(['PL1', 'PL2', 'PL3', 'PL4', 'BZ']);
  });

  it('lets the problem override the list', () => {
    expect(resolveCompareSignals(JudgeSettingsSchema.parse({}))).toEqual([
      'PL1',
      'PL2',
      'PL3',
      'PL4',
    ]);
    expect(resolveCompareSignals(JudgeSettingsSchema.parse({ compareSignals: ['PL1'] }))).toEqual([
      'PL1',
    ]);
  });
});

describe('STATIC_CHECK_IDS', () => {
  it('lists the Phase 1 checks in display order (§7.4)', () => {
    expect(STATIC_CHECK_IDS).toEqual([
      'wireColorRule',
      'terminalLimit',
      'unusedParts',
      'forbiddenCircuit',
      'coilPolarity',
      'powerSequence',
    ]);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-judge.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/schema/judge.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/schema/judge.ts`:

```ts
import { DEFAULT_TOLERANCE } from '@ojt/circuit-sim';
import { z } from 'zod';

/**
 * 判定設定。設計仕様 §7.4。
 * `compareSignals` を省略したときの既定は「盤に実在する出力部品すべて」であり、
 * 標準盤では `PL1`〜`PL4`、課題が `BZ` を追加した場合は `BZ` を含める。
 */

/** 標準盤に常設された出力部品。§6.1 */
export const BOARD_OUTPUT_SIGNALS: readonly string[] = ['PL1', 'PL2', 'PL3', 'PL4'];

/** 盤に実在する出力部品すべて（＝ `compareSignals` の既定）。§7.4 */
export function defaultCompareSignals(extraParts: readonly string[] = []): string[] {
  return extraParts.includes('BZ') ? [...BOARD_OUTPUT_SIGNALS, 'BZ'] : [...BOARD_OUTPUT_SIGNALS];
}

/** 許容差。§7.4 */
export const ToleranceSchema = z.object({
  edgeMs: z.int().min(0).max(10_000).default(DEFAULT_TOLERANCE.edgeMs),
  ratio: z.number().min(0).max(1).default(DEFAULT_TOLERANCE.ratio),
});

/** 許容差。 */
export type ToleranceData = z.infer<typeof ToleranceSchema>;

/** Phase 1 で実装する静的チェックのID。§7.4 */
export const STATIC_CHECK_IDS = [
  'wireColorRule',
  'terminalLimit',
  'unusedParts',
  'forbiddenCircuit',
  'coilPolarity',
  'powerSequence',
] as const;

/** 静的チェックのID。 */
export type StaticCheckId = (typeof STATIC_CHECK_IDS)[number];

/** 静的チェックの有効/無効。モードB（`assemble`）では全項目が既定で有効。§7.4 */
export const StaticChecksSchema = z.object({
  wireColorRule: z.boolean().default(true),
  terminalLimit: z.boolean().default(true),
  unusedParts: z.boolean().default(true),
  forbiddenCircuit: z.boolean().default(true),
  coilPolarity: z.boolean().default(true),
  powerSequence: z.boolean().default(true),
});

/** 静的チェックの有効/無効。 */
export type StaticChecksData = z.infer<typeof StaticChecksSchema>;

/** 全項目を有効にした既定値。§7.4 */
export const DEFAULT_STATIC_CHECKS: StaticChecksData = {
  wireColorRule: true,
  terminalLimit: true,
  unusedParts: true,
  forbiddenCircuit: true,
  coilPolarity: true,
  powerSequence: true,
};

/** 判定設定。§7.4 */
export const JudgeSettingsSchema = z.object({
  compareSignals: z.array(z.string().min(1)).min(1).optional(),
  tolerance: ToleranceSchema.default({
    edgeMs: DEFAULT_TOLERANCE.edgeMs,
    ratio: DEFAULT_TOLERANCE.ratio,
  }),
  staticChecks: StaticChecksSchema.default(DEFAULT_STATIC_CHECKS),
});

/** 判定設定。 */
export type JudgeSettings = z.infer<typeof JudgeSettingsSchema>;

/** 実際に比較する信号名を決める（`compareSignals` 省略時は盤の出力部品すべて）。§7.4 */
export function resolveCompareSignals(
  judge: JudgeSettings,
  extraParts: readonly string[] = [],
): string[] {
  return judge.compareSignals ?? defaultCompareSignals(extraParts);
}
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-judge.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  6 passed (6)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/schema/judge.ts packages/content/test/schema-judge.test.ts
git commit -m @'
feat(content): add judge settings schema with spec defaults

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 6: src/schema/assemble.ts — モードB課題の本体

**Files:**
- Create: `packages/content/src/schema/assemble.ts`
- Create: `packages/content/test/helpers/problems.ts`
- Test: `packages/content/test/schema-assemble.test.ts`

**範囲決定（プレースホルダではない）:** Phase 1 が本体まで定義するのは `assemble` だけである。`inspect-parts` / `inspect-repair` の本体（`faults` / `parts`。仕様 §7.5）は **Phase 2** で、`plc` の本体（`plc` / `io` / `referenceLadder`。仕様 §7.6）は **Phase 3** で定義する。それまで未対応モードの課題は「読めるが開始できない」ものとして課題一覧に `unsupported-mode` の理由付きで並べる（Task 7）。`z.never()` のような「読めない」定義は置かない。

- [ ] **Step 1: テスト用の課題の骨組みを作る**

`packages/content/test/helpers/problems.ts`（`forbiddenOneShotProblemJson()` は Task 12・Task 13 で使う）:

```ts
import { AssembleProblemSchema, type AssembleProblem } from '../../src/schema/assemble.js';

/** 課題JSONの骨組み（テストごとに必要な部分だけ差し替える）。 */
export const TASK2_ROLES = { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' } as const;

/** 自己保持回路の最小課題（テストの土台）。 */
export function selfHoldProblemJson(): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'x-001',
    mode: 'assemble',
    title: 'テスト用 自己保持回路',
    grade: 3,
    description: 'テスト用',
    timeLimit: { standardMin: 30, cutoffMin: 50 },
    board: { boardId: 'board-jipm-std', socketRoles: TASK2_ROLES },
    inventory: [
      { kind: 'relay-my4n', count: 2 },
      { kind: 'timer-h3y4', count: 2 },
    ],
    schematic: {
      formatVersion: 1,
      id: 'sch-x-001',
      title: 'テスト用 自己保持回路',
      orientation: 'horizontal',
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 'pb-b', id: 'c01', device: 'PB2' },
            { kind: 'pb-a', id: 'c02', device: 'PB1' },
            { kind: 'coil', id: 'c03', device: 'CR1' },
          ],
        },
        {
          id: 'r1h',
          from: { rung: 'r1', node: 1 },
          to: { rung: 'r1', node: 2 },
          cells: [{ kind: 'cr-a', id: 'c04', device: 'CR1' }],
        },
        {
          id: 'r2',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 'cr-a', id: 'c05', device: 'CR1' },
            { kind: 'lamp', id: 'c06', device: 'PL1' },
          ],
        },
      ],
    },
    operations: [
      { t: 500, target: 'PB1', action: 'press' },
      { t: 800, target: 'PB1', action: 'release' },
      { t: 3000, target: 'PB2', action: 'press' },
      { t: 3300, target: 'PB2', action: 'release' },
    ],
    durationMs: 5000,
    judge: {
      tolerance: { edgeMs: 200, ratio: 0.1 },
      staticChecks: {
        wireColorRule: true,
        terminalLimit: true,
        unusedParts: true,
        forbiddenCircuit: true,
        coilPolarity: true,
        powerSequence: true,
      },
    },
    hints: { schematicVisible: true },
  };
}

/** 禁則回路（タイマ自身の限時b接点で自コイルを切るワンショット）の課題。調査資料 §5.5 */
export function forbiddenOneShotProblemJson(): Record<string, unknown> {
  return {
    ...selfHoldProblemJson(),
    id: 'x-002',
    title: 'テスト用 禁則ワンショット',
    schematic: {
      formatVersion: 1,
      id: 'sch-x-002',
      title: 'テスト用 禁則ワンショット',
      orientation: 'horizontal',
      rungs: [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-b', id: 'c01', device: 'T1' },
            { kind: 'coil', id: 'c02', device: 'T1', presetMs: 500 },
          ],
        },
        {
          id: 'r2',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-a', id: 'c03', device: 'T1' },
            { kind: 'lamp', id: 'c04', device: 'PL1' },
          ],
        },
      ],
    },
    operations: [],
    durationMs: 3000,
  };
}

/** 課題JSONを検証済みの課題にする（テスト側で失敗したら即エラーにする）。 */
export function parseOrThrow(json: unknown): AssembleProblem {
  const parsed = AssembleProblemSchema.safeParse(json);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
  return parsed.data;
}
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/content/test/schema-assemble.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AssembleProblemSchema } from '../src/schema/assemble.js';
import { selfHoldProblemJson } from './helpers/problems.js';

describe('AssembleProblemSchema', () => {
  it('accepts a well formed problem and fills the judge defaults', () => {
    const parsed = AssembleProblemSchema.safeParse({ ...selfHoldProblemJson(), judge: {} });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.mode).toBe('assemble');
    expect(parsed.data.judge.tolerance).toEqual({ edgeMs: 200, ratio: 0.1 });
    expect(parsed.data.judge.staticChecks.coilPolarity).toBe(true);
  });

  it('rejects a duration shorter than the last operation (§7.3)', () => {
    const parsed = AssembleProblemSchema.safeParse({ ...selfHoldProblemJson(), durationMs: 1000 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['durationMs']);
  });

  it('rejects a visible schematic hint on a grade 1 problem (§8.4)', () => {
    const parsed = AssembleProblemSchema.safeParse({
      ...selfHoldProblemJson(),
      grade: 1,
      hints: { schematicVisible: true },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['hints', 'schematicVisible']);
  });

  it('accepts a physicalOverride of exactly two terminals (§7.2)', () => {
    expect(
      AssembleProblemSchema.safeParse({
        ...selfHoldProblemJson(),
        physicalOverride: { c03: ['CR1.13', 'CR1.14'] },
      }).success,
    ).toBe(true);
    expect(
      AssembleProblemSchema.safeParse({
        ...selfHoldProblemJson(),
        physicalOverride: { c03: ['CR1.13'] },
      }).success,
    ).toBe(false);
  });

  it('surfaces schematic structure errors under the schematic path', () => {
    const json = selfHoldProblemJson();
    const schematic = json.schematic as { rungs: unknown[] };
    schematic.rungs[2] = {
      id: 'r2',
      from: { bus: 'P' },
      to: { bus: 'N' },
      cells: [{ kind: 'cr-a', id: 'c05', device: 'CR1' }],
    };
    const parsed = AssembleProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['schematic', 'rungs', 2]);
  });
});
```

- [ ] **Step 3: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-assemble.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/schema/assemble.js' imported from ...`

- [ ] **Step 4: 実装する**

`packages/content/src/schema/assemble.ts`:

```ts
import { z } from 'zod';
import { ProblemHeaderShape, TerminalIdSchema } from './common.js';
import { JudgeSettingsSchema } from './judge.js';
import { DurationMsSchema, lastOperationMs, OperationListSchema } from './operations.js';
import { SchematicDocumentSchema } from './schematic.js';

/**
 * モードB（回路組立）の課題本体。設計仕様 §7.1〜§7.4 / §8。
 * Phase 1 が実装するのはこのモードだけである（§16）。他モードの本体スキーマは
 * `inspect-parts` / `inspect-repair` を Phase 2、`plc` を Phase 3 で定義する（範囲決定）。
 */

/** ヒント表示。回路図の初期表示状態。§8.4 */
export const HintsSchema = z.object({
  schematicVisible: z.boolean(),
});

/** ヒント表示。 */
export type Hints = z.infer<typeof HintsSchema>;

/** モードB課題。§7.1〜§7.4 */
export const AssembleProblemSchema = z
  .object({
    ...ProblemHeaderShape,
    mode: z.literal('assemble'),
    schematic: SchematicDocumentSchema,
    physicalOverride: z.record(z.string().min(1), z.array(TerminalIdSchema).length(2)).optional(),
    operations: OperationListSchema,
    durationMs: DurationMsSchema,
    judge: JudgeSettingsSchema,
    hints: HintsSchema,
  })
  .superRefine((problem, ctx) => {
    const last = lastOperationMs(problem.operations);
    if (problem.durationMs < last) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: `判定区間長（${problem.durationMs}ms）が最後の操作（${last}ms）より短いです`,
      });
    }
    if (problem.grade === 1 && problem.hints.schematicVisible) {
      ctx.addIssue({
        code: 'custom',
        path: ['hints', 'schematicVisible'],
        message: '1級の課題では回路図を表示しません（§8.4）',
      });
    }
  });

/** モードB課題。 */
export type AssembleProblem = z.infer<typeof AssembleProblemSchema>;
```

- [ ] **Step 5: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-assemble.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`

- [ ] **Step 6: コミット**

```powershell
git add packages/content/src/schema/assemble.ts packages/content/test/helpers/problems.ts packages/content/test/schema-assemble.test.ts
git commit -m @'
feat(content): add assemble problem schema

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 7: src/schema/index.ts — 課題の判別と JSON Schema 生成

**Files:**
- Create: `packages/content/src/schema/index.ts`
- Test: `packages/content/test/schema-index.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/schema-index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProblem, problemJsonSchema } from '../src/schema/index.js';
import { selfHoldProblemJson } from './helpers/problems.js';

describe('parseProblem', () => {
  it('returns the parsed problem for an assemble problem', () => {
    const result = parseProblem(selfHoldProblemJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problem.id).toBe('x-001');
  });

  it('reports a schema violation with a zod path (§13 #1)', () => {
    const result = parseProblem({ ...selfHoldProblemJson(), id: 'B_001' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
    expect(result.issues.some((i) => i.path === 'id')).toBe(true);
    expect(result.id).toBe('B_001');
    expect(result.mode).toBe('assemble');
  });

  it('reports an unsupported mode instead of a schema error (§16)', () => {
    const result = parseProblem({
      ...selfHoldProblemJson(),
      id: 'c-001',
      mode: 'inspect-parts',
      parts: [{ id: 'p1', kind: 'relay-my4n', truth: 'normal' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-mode');
    expect(result.mode).toBe('inspect-parts');
    expect(result.id).toBe('c-001');
    expect(result.issues).toEqual([]);
  });

  it('still reports header issues of an unsupported mode', () => {
    const result = parseProblem({ id: 'c 002', mode: 'plc' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-mode');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.id).toBe('c 002');
  });

  it('leaves the id out when an unsupported mode problem has none', () => {
    const result = parseProblem({ mode: 'inspect-repair' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-mode');
    expect(result.id).toBeUndefined();
  });

  it('reports a non object as a schema error at the root', () => {
    const result = parseProblem(42);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
    expect(result.issues[0]?.path).toBe('(root)');
    expect(result.id).toBeUndefined();
    expect(result.mode).toBeUndefined();
  });
});

describe('problemJsonSchema', () => {
  it('generates a draft 2020-12 schema for the whole union (§4.5)', () => {
    const schema = problemJsonSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema).toHaveProperty('oneOf');
    const text = JSON.stringify(schema);
    expect(text).toContain('inspect-repair');
    expect(text).toContain('socketRoles');
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-index.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/schema/index.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/schema/index.ts`:

```ts
import { z } from 'zod';
import { AssembleProblemSchema, type AssembleProblem } from './assemble.js';
import { ProblemHeaderShape, ProblemModeSchema, type ProblemMode } from './common.js';

/**
 * 課題スキーマの入口。設計仕様 §7 / §13 #1。
 * Phase 1 が本体まで定義するのは `assemble` だけで、他の3モードは**ヘッダだけを読み**、
 * `unsupported-mode` として課題一覧に理由付きで出す（プレースホルダのスキーマは置かない）。
 */

/** Phase 1 では本体を定義しないモードのヘッダ。本体フィールドはそのまま保持する。 */
export const UnsupportedProblemSchema = z.looseObject({
  ...ProblemHeaderShape,
  mode: z.enum(['inspect-parts', 'inspect-repair', 'plc']),
});

/** 未対応モードの課題（ヘッダのみ）。 */
export type UnsupportedProblem = z.infer<typeof UnsupportedProblemSchema>;

/** 課題（モードで判別する）。§7.1 */
export const ProblemSchema = z.discriminatedUnion('mode', [
  AssembleProblemSchema,
  UnsupportedProblemSchema,
]);

/** 課題。 */
export type Problem = z.infer<typeof ProblemSchema>;

/** スキーマ違反1件（zodのパスとメッセージ）。§13 #1 */
export interface ProblemIssue {
  path: string;
  message: string;
}

/** 読込に失敗した理由。§13 #1 / §13 #2 */
export type ProblemFailureReason = 'invalid-json' | 'schema' | 'unsupported-mode' | 'reference';

/** `parseProblem()` の結果。 */
export type ParseProblemResult =
  | { ok: true; problem: AssembleProblem }
  | {
      ok: false;
      reason: ProblemFailureReason;
      message: string;
      issues: ProblemIssue[];
      /** 読めた範囲のID（ヘッダが壊れている場合は undefined）。 */
      id?: string;
      /** 読めた範囲のモード。 */
      mode?: ProblemMode;
    };

function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else if (out === '') out = String(key);
    else out += `.${String(key)}`;
  }
  return out === '' ? '(root)' : out;
}

/** zod のエラーを表示用の一覧に直す。§13 #1 */
export function toProblemIssues(error: z.ZodError): ProblemIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/** 値から `mode` だけを取り出す（判別に失敗したら undefined）。 */
function peekMode(value: unknown): ProblemMode | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const parsed = ProblemModeSchema.safeParse((value as Record<string, unknown>).mode);
  return parsed.success ? parsed.data : undefined;
}

/** 値から `id` だけを取り出す。 */
function peekId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = (value as Record<string, unknown>).id;
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * 課題JSON（パース済みの値）を検証する。§7.8 / §13 #1
 * Phase 1 が開始できるのは `assemble` だけなので、他モードは `unsupported-mode` で返す。
 */
export function parseProblem(json: unknown): ParseProblemResult {
  const mode = peekMode(json);
  const id = peekId(json);
  if (mode !== undefined && mode !== 'assemble') {
    const header = UnsupportedProblemSchema.safeParse(json);
    return {
      ok: false,
      reason: 'unsupported-mode',
      message: `このモードは Phase 1 では開始できません: ${mode}`,
      issues: header.success ? [] : toProblemIssues(header.error),
      ...(header.success ? { id: header.data.id } : id === undefined ? {} : { id }),
      mode,
    };
  }
  const parsed = AssembleProblemSchema.safeParse(json);
  if (parsed.success) return { ok: true, problem: parsed.data };
  return {
    ok: false,
    reason: 'schema',
    message: '課題の形式が正しくありません',
    issues: toProblemIssues(parsed.error),
    ...(id === undefined ? {} : { id }),
    ...(mode === undefined ? {} : { mode }),
  };
}

/**
 * 課題スキーマの JSON Schema を生成する。§4.5（`resources/schema/task.schema.json` に同梱する）。
 *
 * zod 4 は `z.toJSONSchema()` を標準で持つため `zod-to-json-schema` のような追加依存を入れない
 * （実機の zod は 4.6.0）。`z.refine()` / `z.superRefine()` の検査は JSON Schema で表せないので
 * 落ちるが、構造（キー・型・列挙・数値範囲）はそのまま出力される。
 */
export function problemJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ProblemSchema, { io: 'input', target: 'draft-2020-12' });
}
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-index.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  7 passed (7)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/schema/index.ts packages/content/test/schema-index.test.ts
git commit -m @'
feat(content): add problem discriminated union, parseProblem and JSON Schema output

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 8: src/loader.ts — 課題フォルダの読込

**Files:**
- Create: `packages/content/src/loader.ts`
- Test: `packages/content/test/loader.test.ts`

仕様 §7.8 のフォルダ構成は `resources/content/<mode>/<id>.json` なので、フォルダ直下と1階層下の `.json` を名前順に集める。§13 #1 のとおり1ファイルの失敗で他を止めず、§13 #9 のとおりフォルダが無くても落ちない。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/loader.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProblemsFromDir, mergeProblemSets } from '../src/loader.js';
import { selfHoldProblemJson } from './helpers/problems.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ojt-content-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, value: unknown): void {
  const full = join(dir, relative);
  writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

describe('loadProblemsFromDir', () => {
  it('reads problems from the folder and from one level of subfolders', () => {
    mkdirSync(join(dir, 'assemble'));
    write('assemble/a.json', { ...selfHoldProblemJson(), id: 'b-101' });
    write('b.json', { ...selfHoldProblemJson(), id: 'b-102' });
    write('notes.txt', 'ignored');
    const set = loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-101', 'b-102']);
    expect(set.errors).toEqual([]);
  });

  it('keeps loading after a broken file and reports the reason', () => {
    write('broken.json', '{ "oops"');
    write('good.json', { ...selfHoldProblemJson(), id: 'b-103' });
    write('bad-schema.json', { ...selfHoldProblemJson(), id: 'B_104' });
    write('other-mode.json', { ...selfHoldProblemJson(), id: 'd-001', mode: 'plc' });
    const set = loadProblemsFromDir(dir);
    expect(set.problems.map((p) => p.id)).toEqual(['b-103']);
    expect(set.errors.map((e) => e.reason).sort()).toEqual([
      'invalid-json',
      'schema',
      'unsupported-mode',
    ]);
    const schemaError = set.errors.find((e) => e.reason === 'schema');
    expect(schemaError?.issues.length).toBeGreaterThan(0);
  });

  it('reports a duplicated id inside one folder', () => {
    write('a.json', { ...selfHoldProblemJson(), id: 'b-105' });
    write('b.json', { ...selfHoldProblemJson(), id: 'b-105' });
    const set = loadProblemsFromDir(dir);
    expect(set.problems).toHaveLength(1);
    expect(set.errors[0]?.reason).toBe('duplicate-id');
    expect(set.errors[0]?.id).toBe('b-105');
  });

  it('returns a read error for a missing folder instead of throwing', () => {
    const set = loadProblemsFromDir(join(dir, 'nope'));
    expect(set.problems).toEqual([]);
    expect(set.errors[0]?.reason).toBe('read-error');
  });
});

describe('mergeProblemSets', () => {
  it('lets the user folder win on the same id and keeps new ones', () => {
    const builtin = {
      problems: [
        { ...selfHoldProblemJson(), id: 'b-001' },
        { ...selfHoldProblemJson(), id: 'b-002' },
      ],
      errors: [],
    };
    const user = {
      problems: [
        { ...selfHoldProblemJson(), id: 'b-002', title: '差し替え' },
        { ...selfHoldProblemJson(), id: 'u-001' },
      ],
      errors: [],
    };
    mkdirSync(join(dir, 'builtin'));
    write('builtin/b1.json', builtin.problems[0]);
    write('builtin/b2.json', builtin.problems[1]);
    mkdirSync(join(dir, 'user'));
    write('user/b2.json', user.problems[0]);
    write('user/u1.json', user.problems[1]);

    const merged = mergeProblemSets(
      loadProblemsFromDir(join(dir, 'builtin')),
      loadProblemsFromDir(join(dir, 'user')),
    );
    expect(merged.problems.map((p) => p.id)).toEqual(['b-001', 'b-002', 'u-001']);
    expect(merged.problems[1]?.title).toBe('差し替え');
    expect(merged.errors).toEqual([]);
  });

  it('concatenates the errors of both sets', () => {
    write('broken.json', 'nope');
    const set = loadProblemsFromDir(dir);
    const merged = mergeProblemSets(set, set);
    expect(merged.errors).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/loader.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/loader.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/loader.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AssembleProblem } from './schema/assemble.js';
import { parseProblem, type ProblemFailureReason, type ProblemIssue } from './schema/index.js';

/**
 * 課題フォルダの読込。設計仕様 §7.8 / §13 #1 / §13 #9。
 * 1ファイルの失敗で他の課題の読込を止めない。失敗は理由付きで `errors` に積み、
 * 課題一覧がそのまま表示できる形にする。
 */

/** 読込に失敗した1件。§13 #1 */
export interface ProblemLoadError {
  /** 失敗したファイルのパス（フォルダごと読めない場合はフォルダのパス）。 */
  file: string;
  reason: ProblemFailureReason | 'read-error' | 'duplicate-id';
  message: string;
  issues: ProblemIssue[];
  /** 読めた範囲のID。 */
  id?: string;
}

/** 読込結果。§7.8 */
export interface ProblemSet {
  problems: AssembleProblem[];
  errors: ProblemLoadError[];
}

/** 拡張子が `.json` のファイルか。 */
function isJsonFile(name: string): boolean {
  return name.toLowerCase().endsWith('.json');
}

/**
 * フォルダ直下と1階層下（`<mode>/<id>.json`。§7.8）の `.json` を名前順に集める。
 * 名前順に固定するので読込順は決定論的になる。
 */
function collectJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      for (const child of readdirSync(full).sort()) {
        if (isJsonFile(child)) out.push(join(full, child));
      }
    } else if (isJsonFile(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 1ファイルを読んで検証する。 */
function loadOne(file: string, problems: AssembleProblem[], errors: ProblemLoadError[]): void {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (cause) {
    errors.push({
      file,
      reason: 'read-error',
      message: `ファイルを読めませんでした: ${String(cause)}`,
      issues: [],
    });
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    errors.push({
      file,
      reason: 'invalid-json',
      message: `JSONとして読めませんでした: ${String(cause)}`,
      issues: [],
    });
    return;
  }
  const parsed = parseProblem(json);
  if (!parsed.ok) {
    errors.push({
      file,
      reason: parsed.reason,
      message: parsed.message,
      issues: parsed.issues,
      ...(parsed.id === undefined ? {} : { id: parsed.id }),
    });
    return;
  }
  if (problems.some((p) => p.id === parsed.problem.id)) {
    errors.push({
      file,
      reason: 'duplicate-id',
      message: `課題IDが重複しています: ${parsed.problem.id}`,
      issues: [],
      id: parsed.problem.id,
    });
    return;
  }
  problems.push(parsed.problem);
}

/**
 * フォルダから課題を読み込む。§7.8
 * フォルダが無い場合は空の結果と `read-error` を1件返す（内蔵課題だけで動作を続ける。§13 #9）。
 */
export function loadProblemsFromDir(dir: string): ProblemSet {
  const problems: AssembleProblem[] = [];
  const errors: ProblemLoadError[] = [];
  let files: string[];
  try {
    files = collectJsonFiles(dir);
  } catch (cause) {
    return {
      problems,
      errors: [
        {
          file: dir,
          reason: 'read-error',
          message: `課題フォルダを読めませんでした: ${String(cause)}`,
          issues: [],
        },
      ],
    };
  }
  for (const file of files) loadOne(file, problems, errors);
  return { problems, errors };
}

/**
 * 内蔵課題と利用者課題を統合する。同一IDは**利用者側を優先**する。§7.8
 * 並びは「内蔵の並び（利用者側で置き換わったものは置換）＋ 利用者側の新規課題」。
 */
export function mergeProblemSets(builtin: ProblemSet, user: ProblemSet): ProblemSet {
  const userById = new Map(user.problems.map((p) => [p.id, p] as const));
  const taken = new Set<string>();
  const problems: AssembleProblem[] = [];
  for (const problem of builtin.problems) {
    const override = userById.get(problem.id);
    problems.push(override ?? problem);
    taken.add(problem.id);
  }
  for (const problem of user.problems) {
    if (taken.has(problem.id)) continue;
    problems.push(problem);
  }
  return { problems, errors: [...builtin.errors, ...user.errors] };
}
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/loader.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  6 passed (6)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/loader.ts packages/content/test/loader.test.ts
git commit -m @'
feat(content): add problem folder loader with user-folder precedence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 9: src/reference.ts — 模範回路の構築

**Files:**
- Create: `packages/content/src/reference.ts`
- Test: `packages/content/test/reference.test.ts`

`@ojt/schematic-core` の `toSession(doc, board, options)` は、内部で `assignToBoard()` を呼んで回路図を物理端子へ割り当て、`@ojt/board-model` の `plug()` / `addWire()` を通して盤セッションを作る。1端子2本の上限・線色パレット・接点組の不足はすべてそこで検出されるので、ここではその失敗を課題エラー（§13 #2「模範回路エラー」）に変換するだけでよい。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/reference.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { toTerminalId } from '@ojt/circuit-sim';
import { buildReferenceSession, toPhysicalOverride } from '../src/reference.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

describe('buildReferenceSession', () => {
  it('builds a session, plugs the parts and wires the board', () => {
    const problem = parseOrThrow(selfHoldProblemJson());
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.session.mounted.S1).toEqual({ kind: 'relay-my4n' });
    expect(built.value.roles.S1).toBe('CR1');
    // 既設の固定配線3本（チェック用回路。青・locked。§6.3）＋ 回路図から起こした配線
    expect(built.value.session.wires.filter((w) => w.locked)).toHaveLength(3);
    expect(built.value.session.wires.filter((w) => !w.locked).length).toBeGreaterThan(0);
    expect(built.value.netlist.parts.some((p) => p.id === 'CR1')).toBe(true);
  });

  it('rejects a board whose id does not match the problem', () => {
    const problem = parseOrThrow({
      ...selfHoldProblemJson(),
      board: {
        boardId: 'board-other',
        socketRoles: { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' },
      },
    });
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('board.boardId');
  });

  it('propagates an assignment error as a problem error', () => {
    // CR1 の接点が5個ある回路図（§11.3 の「5個目でエラー」）
    const json = selfHoldProblemJson();
    (json.schematic as { rungs: unknown[] }).rungs = [
      {
        id: 'r1',
        from: { bus: 'P' },
        to: { bus: 'N' },
        cells: [{ kind: 'coil', id: 'c00', device: 'CR1' }],
      },
      {
        id: 'r2',
        from: { bus: 'P' },
        to: { bus: 'N' },
        cells: [
          { kind: 'cr-a', id: 'c01', device: 'CR1' },
          { kind: 'cr-a', id: 'c02', device: 'CR1' },
          { kind: 'cr-a', id: 'c03', device: 'CR1' },
          { kind: 'cr-a', id: 'c04', device: 'CR1' },
          { kind: 'cr-a', id: 'c05', device: 'CR1' },
          { kind: 'lamp', id: 'c06', device: 'PL1' },
        ],
      },
    ];
    const problem = parseOrThrow(json);
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.message).toContain('5個目');
  });

  it('honours physicalOverride', () => {
    const problem = parseOrThrow({
      ...selfHoldProblemJson(),
      physicalOverride: { c03: ['CR1.13', 'CR1.14'] },
    });
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // コイルの左（P側）が 13 に入れ替わっている
    const coilMinus = toTerminalId('CR1.13');
    const coilWire = built.value.session.wires.find(
      (w) => w.to === coilMinus || w.from === coilMinus,
    );
    expect(coilWire).toBeDefined();
  });

  it('converts a physicalOverride record into terminal ids', () => {
    expect(toPhysicalOverride(undefined)).toBeUndefined();
    expect(toPhysicalOverride({ c1: ['CR1.9', 'CR1.5'] })).toEqual({ c1: ['CR1.9', 'CR1.5'] });
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/reference.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/reference.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/reference.ts`:

```ts
import {
  toNetlist,
  type BoardDefinition,
  type BoardSession,
  type SocketRoles,
} from '@ojt/board-model';
import { partId, toTerminalId, type Netlist, type PartId, type TerminalId } from '@ojt/circuit-sim';
import { toSession } from '@ojt/schematic-core';
import type { AssembleProblem } from './schema/assemble.js';
import type { ProblemIssue } from './schema/index.js';

/**
 * 模範回路の構築。設計仕様 §7.2 / §11.3 / §13 #2。
 * 課題の回路図（＋ `physicalOverride`）を schematic-core で盤セッションに落とし、
 * board-model でネットリストにする。物理割当に失敗したら課題エラーとして返す。
 */

/** 模範回路（盤セッション＋ネットリスト）。 */
export interface ReferenceCircuit {
  session: BoardSession;
  netlist: Netlist;
  roles: SocketRoles;
}

/** 模範回路の構築結果。 */
export type ReferenceResult =
  { ok: true; value: ReferenceCircuit } | { ok: false; errors: ProblemIssue[] };

/** モードBの新規配線に使う線色（青のみ）。§8.1 */
export const ASSEMBLE_WIRE_COLOR = '青';

/** 課題の `physicalOverride` を schematic-core が要求する形に直す。§7.2 */
export function toPhysicalOverride(
  raw: Readonly<Record<string, readonly string[]>> | undefined,
): Record<string, TerminalId[]> | undefined {
  if (raw === undefined) return undefined;
  const out: Record<string, TerminalId[]> = {};
  for (const [cellId, terminals] of Object.entries(raw)) {
    out[cellId] = terminals.map((t) => toTerminalId(t));
  }
  return out;
}

/** 課題の盤指定を board-model の型に直す。 */
function toRoles(problem: AssembleProblem): SocketRoles {
  return problem.board.socketRoles;
}

/** 課題の任意追加部品を部品IDの配列に直す。§5.3.4 */
function toExtraParts(problem: AssembleProblem): PartId[] {
  return (problem.board.extraParts ?? []).map((name) => partId(name));
}

/**
 * 課題の模範回路を盤セッション＋ネットリストとして組み立てる。§7.2
 * 盤IDが課題と一致しない場合と、割当に失敗した場合はエラーを返す（課題一覧で「模範回路エラー」。§13 #2）。
 */
export function buildReferenceSession(
  problem: AssembleProblem,
  board: BoardDefinition,
): ReferenceResult {
  if (problem.board.boardId !== board.id) {
    return {
      ok: false,
      errors: [
        {
          path: 'board.boardId',
          message: `課題が要求する盤（${problem.board.boardId}）と渡された盤（${board.id}）が違います`,
        },
      ],
    };
  }
  const override = toPhysicalOverride(problem.physicalOverride);
  const built = toSession(problem.schematic, board, {
    roles: toRoles(problem),
    color: ASSEMBLE_WIRE_COLOR,
    extraParts: toExtraParts(problem),
    inventory: problem.inventory,
    ...(override === undefined ? {} : { physicalOverride: override }),
  });
  if (!built.ok) {
    return { ok: false, errors: built.errors.map((e) => ({ path: e.path, message: e.message })) };
  }
  return {
    ok: true,
    value: {
      session: built.session,
      netlist: toNetlist(built.session, board),
      roles: built.assignment.roles,
    },
  };
}
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/reference.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/reference.ts packages/content/test/reference.test.ts
git commit -m @'
feat(content): build the reference circuit from a problem schematic

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 10: src/runner.ts — 操作列の再生

**Files:**
- Create: `packages/content/src/runner.ts`
- Test: `packages/content/test/runner.test.ts`

仕様 §7.3 のとおり、操作列に電源操作は書かない。`t=0` の時点で「ブレーカ → 電源スイッチ」の正しい手順（§5.3.5）で通電済みにしてから再生する。各 tick の先頭でその時刻の操作を適用してから `step()` するので、`t` の操作の効果は信号ログの `t` の記録に現れる。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/runner.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { Simulation, terminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { buildReferenceSession } from '../src/reference.js';
import { powerUp, runOperations } from '../src/runner.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

function referenceNetlist() {
  const problem = parseOrThrow(selfHoldProblemJson());
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, netlist: built.value.netlist };
}

describe('runOperations', () => {
  it('powers up in the right order and records no hazard', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
    expect(run.events.hazards()).toEqual([]);
    expect(run.simulation.state().powered).toBe(true);
    expect(run.lastTickMs).toBe(problem.durationMs - 10);
  });

  it('applies each operation at the tick it is scheduled for', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
    expect(run.log.valueAt('PB1', 490)).toBe(false);
    expect(run.log.valueAt('PB1', 500)).toBe(true);
    expect(run.log.valueAt('PB1', 790)).toBe(true);
    expect(run.log.valueAt('PB1', 800)).toBe(false);
  });

  it('keeps the self hold after the button is released', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
    expect(run.log.valueAt('PL1', 1000)).toBe(true);
    expect(run.log.valueAt('PL1', 4000)).toBe(false);
  });

  it('is deterministic', () => {
    const first = referenceNetlist();
    const second = referenceNetlist();
    const a = runOperations(first.netlist, first.problem.operations, {
      durationMs: first.problem.durationMs,
    });
    const b = runOperations(second.netlist, second.problem.operations, {
      durationMs: second.problem.durationMs,
    });
    expect(a.log.entries()).toEqual(b.log.entries());
  });

  it('records the watched terminal voltages', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, {
      durationMs: 1000,
      watch: [terminalId('CR1', '14')],
    });
    expect(run.log.signals()).toContain('V:CR1.14');
  });

  it('accepts a custom tick length', () => {
    const { problem, netlist } = referenceNetlist();
    const run = runOperations(netlist, problem.operations, { durationMs: 1000, tickMs: 20 });
    expect(run.lastTickMs).toBe(980);
  });
});

describe('powerUp', () => {
  it('does not raise a power sequence hazard', () => {
    const { netlist } = referenceNetlist();
    const simulation = new Simulation(netlist);
    powerUp(simulation);
    expect(simulation.events.countOf('power-sequence-violation')).toBe(0);
  });

  it('the reverse order does raise one (§5.3.5)', () => {
    const { netlist } = referenceNetlist();
    const simulation = new Simulation(netlist);
    simulation.setSwitch(true);
    simulation.setBreaker(true);
    expect(simulation.events.countOf('power-sequence-violation')).toBe(2);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/runner.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/runner.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/runner.ts`:

```ts
import {
  Simulation,
  TICK_MS,
  type EventBus,
  type Netlist,
  type SignalLog,
  type TerminalId,
} from '@ojt/circuit-sim';
import type { Operation } from './schema/operations.js';

/**
 * 操作列の再生。設計仕様 §7.3 / §8.3。
 * `t=0` の時点で正しい手順（ブレーカ → 電源スイッチ）により通電済みとし、以降は
 * 操作列を tick に合わせて適用しながら `durationMs` まで進める。乱数を使わないので決定論（§5.2）。
 */

/** 再生オプション。 */
export interface RunOptions {
  /** 判定区間の長さ[ms]。§7.3 */
  durationMs: number;
  /** 1tickの長さ[ms]。既定は `TICK_MS`（10ms）。§5.2 */
  tickMs?: number;
  /** 電位をログに残す端子（信号名は `V:<端子ID>`）。§5.7 */
  watch?: readonly TerminalId[];
}

/** 再生結果。 */
export interface RunResult {
  simulation: Simulation;
  log: SignalLog;
  events: EventBus;
  /** 最後の tick の時刻[ms]（= `durationMs - tickMs`）。 */
  lastTickMs: number;
}

/**
 * 正しい手順で通電する（ブレーカ → 電源スイッチ）。§5.3.5
 * 逆順にすると `power-sequence-violation` が出るため、判定の再生では必ずこの順で呼ぶ。
 */
export function powerUp(simulation: Simulation): void {
  simulation.setBreaker(true);
  simulation.setSwitch(true);
}

/**
 * 操作列を再生する。§7.3
 * 各 tick の先頭で「その時刻の操作」を操作列の並び順に適用してから1tick進めるので、
 * `t` 時点の操作の効果は信号ログの `t` の記録に現れる。
 */
export function runOperations(
  netlist: Netlist,
  operations: readonly Operation[],
  options: RunOptions,
): RunResult {
  const tickMs = options.tickMs ?? TICK_MS;
  const simulation = new Simulation(netlist, {
    tickMs,
    ...(options.watch === undefined ? {} : { watch: options.watch }),
  });
  powerUp(simulation);

  const byTick = new Map<number, Operation[]>();
  for (const op of operations) {
    const bucket = byTick.get(op.t);
    if (bucket === undefined) byTick.set(op.t, [op]);
    else bucket.push(op);
  }

  let tMs = 0;
  for (; tMs < options.durationMs; tMs += tickMs) {
    for (const op of byTick.get(tMs) ?? []) {
      if (op.action === 'press') simulation.press(op.target);
      else simulation.release(op.target);
    }
    simulation.step(tickMs);
  }

  return {
    simulation,
    log: simulation.log,
    events: simulation.events,
    lastTickMs: Math.max(0, tMs - tickMs),
  };
}
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/runner.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  8 passed (8)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/runner.ts packages/content/test/runner.test.ts
git commit -m @'
feat(content): replay a problem operation list deterministically

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 11: src/timechart.ts — タイムチャートモデル

**Files:**
- Create: `packages/content/src/timechart.ts`
- Test: `packages/content/test/timechart.test.ts`

仕様 §7.7 のとおり、波形は課題JSONに書かず模範回路のシミュレーション結果から作る。上段が入力（PB）、下段が出力（PL／BZ）。タイマ設定秒のラベルは模範回路に装着されたタイマから付与する。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/timechart.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { SignalLog } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { buildReferenceSession } from '../src/reference.js';
import { runOperations } from '../src/runner.js';
import {
  buildTimeChart,
  defaultChartSignals,
  startsAndEndsLow,
  timerMarkers,
} from '../src/timechart.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

function logWith(entries: readonly [number, boolean][]): SignalLog {
  const log = new SignalLog();
  for (const [tMs, value] of entries) log.record(tMs, new Map([['PL1', value]]));
  return log;
}

describe('buildTimeChart', () => {
  it('turns run-length entries into contiguous segments', () => {
    const chart = buildTimeChart(
      logWith([
        [0, false],
        [500, true],
        [1500, false],
      ]),
      [{ name: 'PL1', label: '白ランプ', kind: 'output' }],
      2000,
    );
    expect(chart.signals[0]?.segments).toEqual([
      { fromMs: 0, toMs: 500, value: false },
      { fromMs: 500, toMs: 1500, value: true },
      { fromMs: 1500, toMs: 2000, value: false },
    ]);
  });

  it('produces one false segment for a signal that never appears', () => {
    const chart = buildTimeChart(new SignalLog(), defaultChartSignals(['PL1']), 1000);
    for (const signal of chart.signals) {
      expect(signal.segments).toEqual([{ fromMs: 0, toMs: 1000, value: false }]);
    }
    expect(startsAndEndsLow(chart)).toBe(true);
  });

  it('handles a signal that is already high at t=0', () => {
    const chart = buildTimeChart(
      logWith([
        [0, true],
        [300, false],
      ]),
      [{ name: 'PL1', label: '白ランプ', kind: 'output' }],
      1000,
    );
    expect(chart.signals[0]?.segments[0]).toEqual({ fromMs: 0, toMs: 300, value: true });
    expect(startsAndEndsLow(chart)).toBe(false);
  });

  it('drops entries beyond the duration', () => {
    const chart = buildTimeChart(
      logWith([
        [0, false],
        [500, true],
        [3000, false],
      ]),
      [{ name: 'PL1', label: '白ランプ', kind: 'output' }],
      1000,
    );
    expect(chart.signals[0]?.segments).toEqual([
      { fromMs: 0, toMs: 500, value: false },
      { fromMs: 500, toMs: 1000, value: true },
    ]);
  });

  it('puts the push buttons above the outputs', () => {
    const specs = defaultChartSignals(['PL1', 'BZ']);
    expect(specs.map((s) => s.name)).toEqual(['PB1', 'PB2', 'PB3', 'PB4', 'PL1', 'BZ']);
    expect(specs.filter((s) => s.kind === 'input')).toHaveLength(4);
    expect(specs[0]?.label).toBe('黒押ボタン（PB1）');
    expect(specs[5]?.label).toBe('ブザー（BZ）');
    expect(defaultChartSignals(['X9'])[4]?.label).toBe('X9');
  });

  it('keeps the markers it is given', () => {
    const chart = buildTimeChart(new SignalLog(), [], 1000, [{ tMs: 300, label: 'T1=0.3秒' }]);
    expect(chart.markers).toEqual([{ tMs: 300, label: 'T1=0.3秒' }]);
  });
});

describe('timerMarkers', () => {
  it('labels each timer with its preset', () => {
    const problem = parseOrThrow({
      ...selfHoldProblemJson(),
      schematic: {
        formatVersion: 1,
        id: 'sch-x-003',
        title: 'タイマ2個',
        orientation: 'horizontal',
        rungs: [
          {
            id: 'r1',
            from: { bus: 'P' },
            to: { bus: 'N' },
            cells: [
              { kind: 'pb-a', id: 'c01', device: 'PB1' },
              { kind: 'coil', id: 'c02', device: 'T1', presetMs: 3000 },
            ],
          },
          {
            id: 'r2',
            from: { bus: 'P' },
            to: { bus: 'N' },
            cells: [
              { kind: 't-a', id: 'c03', device: 'T1' },
              { kind: 'coil', id: 'c04', device: 'T2', presetMs: 1500 },
            ],
          },
          {
            id: 'r3',
            from: { bus: 'P' },
            to: { bus: 'N' },
            cells: [
              { kind: 't-a', id: 'c05', device: 'T2' },
              { kind: 'lamp', id: 'c06', device: 'PL1' },
            ],
          },
        ],
      },
    });
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(timerMarkers(built.value.netlist)).toEqual([
      { tMs: 3000, label: 'T1=3秒' },
      { tMs: 1500, label: 'T2=1.5秒' },
    ]);
  });

  it('returns nothing when the circuit has no timer', () => {
    const problem = parseOrThrow(selfHoldProblemJson());
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(timerMarkers(built.value.netlist)).toEqual([]);
    const run = runOperations(built.value.netlist, problem.operations, {
      durationMs: problem.durationMs,
    });
    const chart = buildTimeChart(run.log, defaultChartSignals(['PL1']), problem.durationMs);
    expect(startsAndEndsLow(chart)).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/timechart.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/timechart.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/timechart.ts`:

```ts
import type { Netlist, SignalLog } from '@ojt/circuit-sim';

/**
 * 信号ログ → タイムチャートモデル。設計仕様 §7.7 / §8.3。
 * 上段に入力（PB）、下段に出力（PL／BZ）を並べる（調査資料 §5.2 の提示形式）。
 * 波形は課題JSONに書かず、模範回路のシミュレーション結果から毎回生成する（決定事項#8）。
 */

/** 信号の区分。§7.7 */
export type TimeChartSignalKind = 'input' | 'output';

/** 1信号のひと区間。 */
export interface TimeChartSegment {
  fromMs: number;
  toMs: number;
  value: boolean;
}

/** チャートに並べる1信号。 */
export interface TimeChartSignal {
  name: string;
  label: string;
  kind: TimeChartSignalKind;
  segments: TimeChartSegment[];
}

/** 目盛に立てる印（タイマ設定秒など）。§7.7 */
export interface TimeChartMarker {
  tMs: number;
  label: string;
}

/** タイムチャート。 */
export interface TimeChart {
  durationMs: number;
  signals: TimeChartSignal[];
  markers: TimeChartMarker[];
}

/** チャートに並べる信号の指定。 */
export interface TimeChartSignalSpec {
  name: string;
  label: string;
  kind: TimeChartSignalKind;
}

/** 押ボタンの表示名（盤の色に合わせる）。§5.3.3 */
export const PB_LABELS: Readonly<Record<string, string>> = {
  PB1: '黒押ボタン（PB1）',
  PB2: '黄押ボタン（PB2）',
  PB3: '緑押ボタン（PB3）',
  PB4: '赤押ボタン（PB4）',
};

/** 出力部品の表示名（盤の色に合わせる）。§5.3.4 */
export const OUTPUT_LABELS: Readonly<Record<string, string>> = {
  PL1: '白ランプ（PL1）',
  PL2: '黄ランプ（PL2）',
  PL3: '緑ランプ（PL3）',
  PL4: '赤ランプ（PL4）',
  BZ: 'ブザー（BZ）',
};

/** 押ボタン4点を上段、比較対象の出力を下段に並べた既定の信号指定。§7.7 */
export function defaultChartSignals(compareSignals: readonly string[]): TimeChartSignalSpec[] {
  const inputs: TimeChartSignalSpec[] = Object.keys(PB_LABELS).map((name) => ({
    name,
    label: PB_LABELS[name] ?? name,
    kind: 'input',
  }));
  const outputs: TimeChartSignalSpec[] = compareSignals.map((name) => ({
    name,
    label: OUTPUT_LABELS[name] ?? name,
    kind: 'output',
  }));
  return [...inputs, ...outputs];
}

/** 秒数を「3秒」「0.8秒」の形に整える。 */
function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? `${seconds}秒` : `${seconds.toFixed(1)}秒`;
}

/**
 * 模範回路に装着されたタイマの設定時間から目盛の印を作る。§7.7
 * 例: `T1` が3秒なら `{ tMs: 3000, label: 'T1=3秒' }`。並びは部品の並び順（決定論）。
 */
export function timerMarkers(netlist: Netlist): TimeChartMarker[] {
  const out: TimeChartMarker[] = [];
  for (const part of netlist.parts) {
    if (part.meta.kind !== 'timer-h3y4') continue;
    out.push({ tMs: part.meta.presetMs, label: `${part.id}=${formatSeconds(part.meta.presetMs)}` });
  }
  return out;
}

/** 1信号ぶんの区間列を作る（記録が無ければ全区間 false）。 */
function segmentsOf(log: SignalLog, name: string, durationMs: number): TimeChartSegment[] {
  const points: { tMs: number; value: boolean }[] = [];
  for (const entry of log.transitions(name)) {
    if (typeof entry.value !== 'boolean') continue;
    if (entry.tMs > durationMs) break;
    points.push({ tMs: entry.tMs, value: entry.value });
  }
  const segments: TimeChartSegment[] = [];
  let value = false;
  let from = 0;
  for (const point of points) {
    if (point.tMs > from && point.value !== value) {
      segments.push({ fromMs: from, toMs: point.tMs, value });
      from = point.tMs;
    }
    value = point.value;
  }
  segments.push({ fromMs: from, toMs: durationMs, value });
  return segments;
}

/**
 * 信号ログをタイムチャートモデルに変換する。§7.7
 * 区間は `[fromMs, toMs)` で隙間なく `durationMs` まで埋まる。boolean 以外の信号（電圧など）は無視する。
 */
export function buildTimeChart(
  log: SignalLog,
  signals: readonly TimeChartSignalSpec[],
  durationMs: number,
  markers: readonly TimeChartMarker[] = [],
): TimeChart {
  return {
    durationMs,
    signals: signals.map((spec) => ({
      name: spec.name,
      label: spec.label,
      kind: spec.kind,
      segments: segmentsOf(log, spec.name, durationMs),
    })),
    markers: [...markers],
  };
}

/** チャートの始まりと終わりがどちらも論理0か（内蔵課題の自己整合テスト用）。§7.3 */
export function startsAndEndsLow(chart: TimeChart): boolean {
  return chart.signals.every((signal) => {
    const first = signal.segments[0];
    const last = signal.segments[signal.segments.length - 1];
    return first !== undefined && last !== undefined && !first.value && !last.value;
  });
}
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/timechart.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  8 passed (8)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/timechart.ts packages/content/test/timechart.test.ts
git commit -m @'
feat(content): turn signal logs into a time chart model

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 12: src/static-checks.ts — 静的チェック

**Files:**
- Create: `packages/content/src/static-checks.ts`
- Test: `packages/content/test/static-checks.test.ts`

仕様 §7.4 の6項目を実装する。

| ID | 判定の実体 |
|---|---|
| `wireColorRule` | 訓練者が引いた電線がパレットの色（モードBは青のみ。§8.1）か。盤に最初から施工されている固定配線（`locked`）は実物でも青で、訓練者の責任範囲でもないので検査対象から外す（§6.3） |
| `terminalLimit` | セッション上の電線で1端子3本以上になっている端子（§6.6。UIは3本目を拒否するので、ここで出るのは課題JSON・作業ファイル由来のもの） |
| `unusedParts` | 装着したのにどのピンにも電線が来ていない部品（`CHK` は除く）。役割なしの予備ソケットは `socketPartId()` が返す物理ソケットIDが部品IDになる（§6.4） |
| `forbiddenCircuit` | 判定区間で `ChatterEvent` が出たか（§5.3.2 の復帰時間モデルにより、禁則回路は tick 周期で反転する） |
| `coilPolarity` | 訓練者のログの `<部品ID>.coilV` が励磁しきい値ぶん負に振れていたら 13/14 の逆接続（§5.3.1） |
| `powerSequence` | `power-sequence-violation` の危険操作イベント数（§5.3.5） |

`coilPolarity` は「模範ではなく訓練者のネットリストで、通電時のコイル電圧が負」であることを見るため、再生後の `SignalLog` を入力に取る。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/static-checks.test.ts`:

```ts
import { JIPM_BOARD, plug, toNetlist, type BoardSession } from '@ojt/board-model';
import { createWire, SignalLog, terminalId, type HazardEvent } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { buildReferenceSession, ASSEMBLE_WIRE_COLOR } from '../src/reference.js';
import { runOperations } from '../src/runner.js';
import { DEFAULT_STATIC_CHECKS } from '../src/schema/judge.js';
import {
  checkCoilPolarity,
  checkForbiddenCircuit,
  checkPowerSequence,
  checkTerminalLimit,
  checkUnusedParts,
  checkWireColorRule,
  runStaticChecks,
  type StaticCheckInput,
} from '../src/static-checks.js';
import {
  forbiddenOneShotProblemJson,
  parseOrThrow,
  selfHoldProblemJson,
} from './helpers/problems.js';

function inputFor(json: Record<string, unknown>): StaticCheckInput & { session: BoardSession } {
  const problem = parseOrThrow(json);
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const run = runOperations(built.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  return {
    session: built.value.session,
    netlist: built.value.netlist,
    log: run.log,
    hazards: run.events.hazards(),
    chatters: run.events.chatters(),
    allowedColors: [ASSEMBLE_WIRE_COLOR],
  };
}

describe('runStaticChecks', () => {
  it('passes every check on a correct circuit', () => {
    const results = runStaticChecks(inputFor(selfHoldProblemJson()), DEFAULT_STATIC_CHECKS);
    expect(results.map((r) => r.id)).toEqual([
      'wireColorRule',
      'terminalLimit',
      'unusedParts',
      'forbiddenCircuit',
      'coilPolarity',
      'powerSequence',
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('runs only the enabled checks', () => {
    const results = runStaticChecks(inputFor(selfHoldProblemJson()), {
      ...DEFAULT_STATIC_CHECKS,
      unusedParts: false,
      powerSequence: false,
    });
    expect(results.map((r) => r.id)).toEqual([
      'wireColorRule',
      'terminalLimit',
      'forbiddenCircuit',
      'coilPolarity',
    ]);
  });
});

describe('checkWireColorRule', () => {
  it('fails on a wire that is not in the palette', () => {
    const input = inputFor(selfHoldProblemJson());
    const wire = input.session.wires.find((w) => !w.locked);
    if (wire === undefined) throw new Error('no editable wire');
    wire.color = '白';
    const result = checkWireColorRule(input);
    expect(result.ok).toBe(false);
    expect(result.details[0]).toContain(wire.id);
  });

  it('ignores the pre-installed fixed wiring whatever colour it has (§6.3)', () => {
    const input = inputFor(selfHoldProblemJson());
    const locked = input.session.wires.find((w) => w.locked);
    if (locked === undefined) throw new Error('no locked wire');
    expect(locked.color).toBe('青');
    locked.color = '黄';
    expect(checkWireColorRule(input).ok).toBe(true);
  });
});

describe('checkTerminalLimit', () => {
  it('fails when a terminal carries three wires', () => {
    const input = inputFor(selfHoldProblemJson());
    input.session.wires.push(
      createWire('w-extra', terminalId('CR1', '14'), terminalId('P', '5'), ASSEMBLE_WIRE_COLOR),
    );
    input.session.wires.push(
      createWire('w-extra2', terminalId('CR1', '14'), terminalId('P', '4'), ASSEMBLE_WIRE_COLOR),
    );
    const result = checkTerminalLimit(input);
    expect(result.ok).toBe(false);
    expect(result.details.some((d) => d.startsWith('CR1.14'))).toBe(true);
  });
});

describe('checkUnusedParts', () => {
  it('fails when a mounted part has no wire at all', () => {
    const input = inputFor(selfHoldProblemJson());
    const plugged = plug(input.session, 'S2', 'relay-my4n');
    expect(plugged.ok).toBe(true);
    const result = checkUnusedParts({
      ...input,
      netlist: toNetlist(input.session, JIPM_BOARD),
    });
    expect(result.ok).toBe(false);
    expect(result.details[0]).toContain('S2');
  });

  it('ignores a part in the check socket', () => {
    const input = inputFor(selfHoldProblemJson());
    plug(input.session, 'S7', 'relay-my4n');
    expect(checkUnusedParts(input).ok).toBe(true);
  });
});

describe('checkForbiddenCircuit', () => {
  it('fails when the timer breaks its own coil (chattering)', () => {
    const input = inputFor(forbiddenOneShotProblemJson());
    expect(input.chatters.length).toBeGreaterThan(0);
    const result = checkForbiddenCircuit(input);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('リレーを介して');
  });
});

describe('checkCoilPolarity', () => {
  it('fails when the coil is wired 13 = + / 14 = −', () => {
    const input = inputFor({
      ...selfHoldProblemJson(),
      physicalOverride: { c03: ['CR1.13', 'CR1.14'] },
    });
    const result = checkCoilPolarity(input);
    expect(result.ok).toBe(false);
    expect(result.details[0]).toContain('CR1');
  });

  it('passes when nothing has been energised at all', () => {
    const input = inputFor(selfHoldProblemJson());
    expect(checkCoilPolarity({ ...input, log: new SignalLog() }).ok).toBe(true);
  });
});

describe('checkPowerSequence', () => {
  it('counts the violations recorded during the session', () => {
    const input = inputFor(selfHoldProblemJson());
    const hazard: HazardEvent = {
      type: 'hazard',
      kind: 'power-sequence-violation',
      tMs: 0,
      detail: 'breaker:off',
    };
    const result = checkPowerSequence({ ...input, hazards: [hazard] });
    expect(result.ok).toBe(false);
    expect(result.details).toEqual(['0ms: breaker:off']);
  });

  it('passes when the judging run powered up correctly', () => {
    expect(checkPowerSequence(inputFor(selfHoldProblemJson())).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/static-checks.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/static-checks.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/static-checks.ts`:

```ts
import { socketPartId, SOCKET_IDS, wireCountAtTerminal, type BoardSession } from '@ojt/board-model';
import {
  MAX_WIRES_PER_TERMINAL,
  PICKUP_VOLTS,
  type ChatterEvent,
  type HazardEvent,
  type Netlist,
  type SignalLog,
  type TerminalId,
  type WireColor,
} from '@ojt/circuit-sim';
import { STATIC_CHECK_IDS, type StaticCheckId, type StaticChecksData } from './schema/judge.js';

/**
 * 静的チェック。設計仕様 §7.4。
 * 通電せずに（＝再生後のログとイベントだけで）判定できる検査をまとめる。
 * 各チェックは `{ id, ok, message, details }` を返し、UIは項目ごとに OK / エラーを並べる（§8.3）。
 */

/** チェック1件の結果。§7.4 */
export interface StaticCheckResult {
  id: StaticCheckId;
  ok: boolean;
  message: string;
  details: string[];
}

/** チェックの入力（訓練者側の盤・ネットリスト・再生結果）。 */
export interface StaticCheckInput {
  session: BoardSession;
  netlist: Netlist;
  log: SignalLog;
  hazards: readonly HazardEvent[];
  chatters: readonly ChatterEvent[];
  /** 新規配線に使ってよい線色。モードBは青のみ。§8.1 */
  allowedColors: readonly WireColor[];
}

function result(id: StaticCheckId, details: string[], okMessage: string, ngMessage: string) {
  return details.length === 0
    ? { id, ok: true, message: okMessage, details }
    : { id, ok: false, message: ngMessage, details };
}

/**
 * 線色ルール。訓練者が引いた電線がパレットの色（モードBは青のみ）かを見る。§7.4 / §4.2 / §8.1
 * 盤に最初から施工されている固定配線（`locked`）は訓練者の責任範囲ではなく、実物でも
 * チェック用回路を含めて**青**で配線されているため、色の検査対象から外す（§6.3）。
 */
export function checkWireColorRule(input: StaticCheckInput): StaticCheckResult {
  const details: string[] = [];
  for (const wire of input.session.wires) {
    if (wire.locked) continue;
    if (!input.allowedColors.includes(wire.color)) {
      details.push(
        `${wire.id}: この課題で使えるのは ${input.allowedColors.join('・')} です（${wire.color}）`,
      );
    }
  }
  return result(
    'wireColorRule',
    details,
    '線色は規定どおりです',
    '規定外の線色で配線された箇所があります',
  );
}

/** 1端子2本まで。§7.4 / §6.6 */
export function checkTerminalLimit(input: StaticCheckInput): StaticCheckResult {
  const seen = new Set<TerminalId>();
  const details: string[] = [];
  for (const wire of input.session.wires) {
    for (const terminal of [wire.from, wire.to]) {
      if (seen.has(terminal)) continue;
      seen.add(terminal);
      const count = wireCountAtTerminal(input.session, terminal);
      if (count > MAX_WIRES_PER_TERMINAL) {
        details.push(`${terminal}: ${count}本（上限は${MAX_WIRES_PER_TERMINAL}本）`);
      }
    }
  }
  return result(
    'terminalLimit',
    details,
    '1端子あたりの本数は規定内です',
    '1端子に3本以上つながっている箇所があります',
  );
}

/**
 * 未使用部品。装着したのにどのピンにも電線が1本も来ていない部品を検出する。§7.4
 * （回路への「組み込まれ方」の良否ではなく、盤上で完全に浮いている部品を指摘する。）
 * チェック用ソケットは固定配線で常に励磁できる状態にあるため対象外にする（§6.3）。
 * 役割なしの予備ソケットは物理ソケットIDがそのまま部品IDになる（`socketPartId`。§6.4）。
 */
export function checkUnusedParts(input: StaticCheckInput): StaticCheckResult {
  const wired = new Set<string>();
  for (const wire of input.session.wires) {
    for (const terminal of [wire.from, wire.to]) {
      wired.add(terminal.slice(0, terminal.indexOf('.')));
    }
  }
  const details: string[] = [];
  for (const socket of SOCKET_IDS) {
    const mounted = input.session.mounted[socket];
    if (mounted === undefined) continue;
    if (input.session.socketRoles[socket] === 'CHK') continue;
    const part = socketPartId(input.session.socketRoles, socket);
    if (!wired.has(part)) details.push(`${socket}（${part}）: 装着していますが未接続です`);
  }
  return result(
    'unusedParts',
    details,
    '未接続のまま装着された部品はありません',
    '装着したのに回路に組み込まれていない部品があります',
  );
}

/**
 * 禁則回路。判定区間でチャタリングを検出したら不合格にする。§7.4 / §5.3.2 / 調査資料 §5.5
 * タイマ自身の限時接点で自コイルを切る構成・タイマ2個だけのフリッカは、通電断が
 * 100ms未満しか続かず経過時間が保持されるため tick 周期で反転し、ここで捕まる。
 */
export function checkForbiddenCircuit(input: StaticCheckInput): StaticCheckResult {
  const details = input.chatters.map(
    (e) => `${e.signal}: ${e.tMs}ms 付近で1秒間に${e.count}回反転しました`,
  );
  return result(
    'forbiddenCircuit',
    details,
    '禁則回路は検出されませんでした',
    'タイマの接点で自分のコイルを切る回路は実機では動作が不安定になります（リレーを介してください）',
  );
}

/**
 * コイル極性。14 = (+)、13 = (−)。§7.4 / §5.3.1
 * 通電中のコイル電圧（`<部品ID>.coilV` として記録される）が励磁しきい値ぶん**負**に振れていれば、
 * 13 に + を、14 に − を繋いでいる（逆極性）と判定する。
 */
export function checkCoilPolarity(input: StaticCheckInput): StaticCheckResult {
  const details: string[] = [];
  for (const part of input.netlist.parts) {
    if (part.meta.kind !== 'relay-my4n' && part.meta.kind !== 'timer-h3y4') continue;
    let worst = 0;
    for (const entry of input.log.transitions(`${part.id}.coilV`)) {
      if (typeof entry.value === 'number' && entry.value < worst) worst = entry.value;
    }
    if (worst <= -PICKUP_VOLTS) {
      details.push(
        `${part.id}: コイル電圧が ${worst.toFixed(1)}V です（14 に +、13 に − を接続します）`,
      );
    }
  }
  return result(
    'coilPolarity',
    details,
    'コイルの極性は正しく接続されています',
    'コイルの極性が逆の部品があります',
  );
}

/** 電源投入・遮断の手順違反。§7.4 / §5.3.5 */
export function checkPowerSequence(input: StaticCheckInput): StaticCheckResult {
  const violations = input.hazards.filter((e) => e.kind === 'power-sequence-violation');
  const details = violations.map((e) => `${e.tMs}ms: ${e.detail}`);
  return result(
    'powerSequence',
    details,
    '電源の入切手順は守られています',
    '電源の入切手順に違反があります（ON: ブレーカ→スイッチ／OFF: スイッチ→ブレーカ）',
  );
}

/** IDごとのチェック関数。 */
const CHECKS: Readonly<Record<StaticCheckId, (input: StaticCheckInput) => StaticCheckResult>> = {
  wireColorRule: checkWireColorRule,
  terminalLimit: checkTerminalLimit,
  unusedParts: checkUnusedParts,
  forbiddenCircuit: checkForbiddenCircuit,
  coilPolarity: checkCoilPolarity,
  powerSequence: checkPowerSequence,
};

/** 有効にした静的チェックだけを `STATIC_CHECK_IDS` の順に実行する。§7.4 */
export function runStaticChecks(
  input: StaticCheckInput,
  enabled: StaticChecksData,
): StaticCheckResult[] {
  const out: StaticCheckResult[] = [];
  for (const id of STATIC_CHECK_IDS) {
    if (!enabled[id]) continue;
    out.push(CHECKS[id](input));
  }
  return out;
}
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/static-checks.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  12 passed (12)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/static-checks.ts packages/content/test/static-checks.test.ts
git commit -m @'
feat(content): add the six Phase 1 static checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 13: src/judge.ts — モードBの判定

**Files:**
- Create: `packages/content/src/judge.ts`
- Test: `packages/content/test/judge.test.ts`

仕様 §8.3 の手順をそのまま実装する。模範と訓練者の両方を同じ操作列で再生 → `compareLogs()` で許容差付きに突き合わせ → 静的チェック → 結果を組み立てる。合格は「動作一致（不一致0）かつ有効な静的チェックにエラーが無い」（§7.4）。危険操作回数と所要時間は記録するが合否に影響しない（§17.2 #3）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/judge.test.ts`:

```ts
import { JIPM_BOARD, plug, removeWire, type BoardSession } from '@ojt/board-model';
import { createWire, terminalId, toTerminalId, type HazardEvent } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { judgeAssemble, judgeReference } from '../src/judge.js';
import { buildReferenceSession, ASSEMBLE_WIRE_COLOR } from '../src/reference.js';
import {
  forbiddenOneShotProblemJson,
  parseOrThrow,
  selfHoldProblemJson,
} from './helpers/problems.js';

function sessionFor(json: Record<string, unknown> = selfHoldProblemJson()): BoardSession {
  const problem = parseOrThrow(json);
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value.session;
}

const PROBLEM = parseOrThrow(selfHoldProblemJson());

describe('judgeAssemble', () => {
  it('passes when the trainee wired the reference circuit', () => {
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, sessionFor());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(true);
    expect(result.value.mismatches).toEqual([]);
    expect(result.value.staticChecks.every((c) => c.ok)).toBe(true);
    expect(result.value.compareSignals).toEqual(['PL1', 'PL2', 'PL3', 'PL4']);
    expect(result.value.charts.expected.signals).toHaveLength(8);
    expect(result.value.charts.actual.durationMs).toBe(PROBLEM.durationMs);
    expect(result.value.hazardCount).toBe(0);
    expect(result.value.elapsedMs).toBeUndefined();
  });

  it('records the elapsed time and the session hazards without changing the verdict', () => {
    const hazard: HazardEvent = {
      type: 'hazard',
      kind: 'over-wires-per-terminal',
      tMs: 0,
      detail: 'CR1.14',
    };
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, sessionFor(), {
      elapsedMs: 12_000,
      sessionHazards: [hazard],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(true);
    expect(result.value.elapsedMs).toBe(12_000);
    expect(result.value.hazardCount).toBe(1);
    expect(result.value.hazardsByKind['over-wires-per-terminal']).toBe(1);
    expect(result.value.hazardsByKind['ohm-on-live']).toBe(0);
  });

  it('fails with a waveform difference when one wire is missing', () => {
    const session = sessionFor();
    const lampPlus = toTerminalId('TB_PL.1+');
    const lampWire = session.wires.find((w) => w.from === lampPlus || w.to === lampPlus);
    if (lampWire === undefined) throw new Error('lamp wire not found');
    expect(removeWire(session, lampWire.id).ok).toBe(true);
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.mismatches.length).toBeGreaterThan(0);
    expect(result.value.mismatches[0]?.signal).toBe('PL1');
    expect(result.value.mismatches[0]?.expected).toBe(true);
    expect(result.value.mismatches[0]?.reason).toBe('missing');
  });

  it('fails the wire colour check when a wire has the wrong colour', () => {
    const session = sessionFor();
    const wire = session.wires.find((w) => !w.locked);
    if (wire === undefined) throw new Error('no editable wire');
    wire.color = '白';
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.mismatches).toEqual([]);
    const check = result.value.staticChecks.find((c) => c.id === 'wireColorRule');
    expect(check?.ok).toBe(false);
  });

  it('fails the terminal limit check when a third wire is present', () => {
    const session = sessionFor();
    session.wires.push(
      createWire('w-901', terminalId('CR1', '14'), terminalId('P', '5'), ASSEMBLE_WIRE_COLOR),
    );
    session.wires.push(
      createWire('w-902', terminalId('CR1', '14'), terminalId('P', '4'), ASSEMBLE_WIRE_COLOR),
    );
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    const check = result.value.staticChecks.find((c) => c.id === 'terminalLimit');
    expect(check?.ok).toBe(false);
    expect(check?.details.some((d) => d.startsWith('CR1.14'))).toBe(true);
  });

  it('fails the unused parts check when a spare relay is left unwired', () => {
    const session = sessionFor();
    expect(plug(session, 'S2', 'relay-my4n').ok).toBe(true);
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.staticChecks.find((c) => c.id === 'unusedParts')?.ok).toBe(false);
  });

  it('fails the forbidden circuit check on a self-breaking one shot', () => {
    const forbidden = parseOrThrow(forbiddenOneShotProblemJson());
    const result = judgeReference(forbidden, JIPM_BOARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.mismatches).toEqual([]);
    expect(result.value.chatter.length).toBeGreaterThan(0);
    expect(result.value.staticChecks.find((c) => c.id === 'forbiddenCircuit')?.ok).toBe(false);
  });

  it('fails the coil polarity check when 13 and 14 are swapped', () => {
    const session = sessionFor({
      ...selfHoldProblemJson(),
      physicalOverride: { c03: ['CR1.13', 'CR1.14'] },
    });
    const result = judgeAssemble(PROBLEM, JIPM_BOARD, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.staticChecks.find((c) => c.id === 'coilPolarity')?.ok).toBe(false);
  });

  it('reports a reference circuit error instead of a verdict', () => {
    const broken = parseOrThrow({
      ...selfHoldProblemJson(),
      board: {
        boardId: 'board-other',
        socketRoles: { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' },
      },
    });
    const result = judgeAssemble(broken, JIPM_BOARD, sessionFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toBe('board.boardId');
  });

  it('surfaces the reference error from judgeReference too', () => {
    const broken = parseOrThrow({
      ...selfHoldProblemJson(),
      board: {
        boardId: 'board-other',
        socketRoles: { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' },
      },
    });
    expect(judgeReference(broken, JIPM_BOARD).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/judge.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/judge.js' imported from ...`

- [ ] **Step 3: 実装する**

`packages/content/src/judge.ts`:

```ts
import { toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import {
  compareLogs,
  HAZARD_KINDS,
  type ChatterEvent,
  type HazardEvent,
  type HazardKind,
  type Mismatch,
} from '@ojt/circuit-sim';
import { buildReferenceSession, ASSEMBLE_WIRE_COLOR } from './reference.js';
import { runOperations } from './runner.js';
import { resolveCompareSignals } from './schema/judge.js';
import type { AssembleProblem } from './schema/assemble.js';
import type { ProblemIssue } from './schema/index.js';
import { runStaticChecks, type StaticCheckResult } from './static-checks.js';
import { buildTimeChart, defaultChartSignals, timerMarkers, type TimeChart } from './timechart.js';

/**
 * モードBの判定。設計仕様 §7.4 / §8.3。
 * 模範回路と訓練者回路を同じ操作列で同じエンジンにかけ、出力波形を許容差付きで比較したうえで
 * 静的チェックを走らせる。固定の正解波形は持たない（決定事項#8）。
 */

/** 危険操作の種別ごとの回数。§8.3 */
export type HazardCounts = Readonly<Record<HazardKind, number>>;

/**
 * 危険操作の種別ごとの回数を数える。種別の集合は circuit-sim の `HAZARD_KINDS` を唯一の源とするので、
 * エンジン側に種別が増えても結果画面の集計は自動で追随する（§5.6）。
 */
function countHazards(hazards: readonly HazardEvent[]): HazardCounts {
  const out = {} as Record<HazardKind, number>;
  for (const kind of HAZARD_KINDS) {
    out[kind] = hazards.filter((e) => e.kind === kind).length;
  }
  return out;
}

/** 判定オプション。 */
export interface JudgeOptions {
  /** 訓練者の所要時間[ms]（結果画面の参考表示。合否には影響しない。§17.2 #3）。 */
  elapsedMs?: number;
  /** セッション中（判定の再生以外）に記録した危険操作。§5.6 */
  sessionHazards?: readonly HazardEvent[];
}

/** 判定結果。§7.4 / §8.3 */
export interface JudgeResult {
  /** 動作一致かつ有効な静的チェックにエラーが無い。§7.4 */
  passed: boolean;
  /** 許容差を超えた遷移の一覧。§8.3 */
  mismatches: Mismatch[];
  staticChecks: StaticCheckResult[];
  /** 危険操作の総数。 */
  hazardCount: number;
  /** 危険操作の種別ごとの回数。§8.3 */
  hazardsByKind: HazardCounts;
  /** 検出したチャタリング。§8.3 の禁則回路の警告に使う。 */
  chatter: ChatterEvent[];
  /** 訓練者の所要時間[ms]（渡されたときだけ入る）。 */
  elapsedMs?: number;
  /** 模範波形と訓練者波形。§8.3 の重ね表示に使う。 */
  charts: { expected: TimeChart; actual: TimeChart };
  /** 実際に比較した信号名。§7.4 */
  compareSignals: string[];
}

/** 判定の実行結果（模範回路が作れなければ課題エラー）。§13 #2 */
export type JudgeAssembleResult =
  { ok: true; value: JudgeResult } | { ok: false; errors: ProblemIssue[] };

/**
 * モードBの判定を実行する。§8.3
 * 1. 模範回路を組み立てて操作列を再生する
 * 2. 訓練者の盤セッションをネットリストにして同じ操作列を再生する
 * 3. 出力波形を比較し、静的チェックを走らせ、両方の波形をタイムチャートにする
 */
export function judgeAssemble(
  problem: AssembleProblem,
  board: BoardDefinition,
  traineeSession: BoardSession,
  options: JudgeOptions = {},
): JudgeAssembleResult {
  const reference = buildReferenceSession(problem, board);
  if (!reference.ok) return reference;

  const expectedRun = runOperations(reference.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  const traineeNetlist = toNetlist(traineeSession, board);
  const actualRun = runOperations(traineeNetlist, problem.operations, {
    durationMs: problem.durationMs,
  });

  const compareSignals = resolveCompareSignals(problem.judge, problem.board.extraParts ?? []);
  const mismatches = compareLogs(
    expectedRun.log,
    actualRun.log,
    compareSignals,
    problem.judge.tolerance,
  );

  const hazards = [...(options.sessionHazards ?? []), ...actualRun.events.hazards()];
  const chatter = actualRun.events.chatters();
  const staticChecks = runStaticChecks(
    {
      session: traineeSession,
      netlist: traineeNetlist,
      log: actualRun.log,
      hazards,
      chatters: chatter,
      allowedColors: [ASSEMBLE_WIRE_COLOR],
    },
    problem.judge.staticChecks,
  );

  const chartSignals = defaultChartSignals(compareSignals);
  const markers = timerMarkers(reference.value.netlist);
  const charts = {
    expected: buildTimeChart(expectedRun.log, chartSignals, problem.durationMs, markers),
    actual: buildTimeChart(actualRun.log, chartSignals, problem.durationMs, markers),
  };

  return {
    ok: true,
    value: {
      passed: mismatches.length === 0 && staticChecks.every((c) => c.ok),
      mismatches,
      staticChecks,
      hazardCount: hazards.length,
      hazardsByKind: countHazards(hazards),
      chatter: [...chatter],
      ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
      charts,
      compareSignals,
    },
  };
}

/**
 * 課題の模範回路を、その課題自身の操作列で判定にかける（自己整合テスト）。§7.8 / §14.1 #30
 * 内蔵課題はこれが全件合格することをCIで保証する。
 */
export function judgeReference(
  problem: AssembleProblem,
  board: BoardDefinition,
): JudgeAssembleResult {
  const reference = buildReferenceSession(problem, board);
  if (!reference.ok) return reference;
  return judgeAssemble(problem, board, reference.value.session);
}
```

- [ ] **Step 4: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/judge.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  10 passed (10)`

- [ ] **Step 5: コミット**

```powershell
git add packages/content/src/judge.ts packages/content/test/judge.test.ts
git commit -m @'
feat(content): judge assemble problems against the reference circuit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 14: 内蔵課題 ①〜③（基本回路）と内蔵課題の登録

**Files:**
- Create: `packages/content/src/builtin/assemble/b-001-self-hold.json`
- Create: `packages/content/src/builtin/assemble/b-002-interlock.json`
- Create: `packages/content/src/builtin/assemble/b-003-on-delay.json`
- Create: `packages/content/src/builtin/index.ts`
- Test: `packages/content/test/builtin.test.ts`

内蔵課題の設計（全8題の一覧は Task 16 の末尾にまとめる）:

| # | ID | タイトル | 級 | ソケット役割 | 使用部品 | 要点 |
|---|---|---|---|---|---|---|
| ① | `b-001` | 自己保持回路 | 3 | 課題2形式 | CR1 | PB1(黒)起動・PB2(黄)停止・PL1(白) |
| ② | `b-002` | インターロック回路（先行優先） | 3 | 課題1形式 | CR1, CR2 | PB1/PB2 で PL1/PL2 を相互ロック、PB3(緑)で解除 |
| ③ | `b-003` | オンディレー点灯回路 | 3 | 課題2形式 | CR1, T1(3秒) | 起動3秒後に PL1 点灯 |

盤はソケットを8個持ち、課題が割り当てなかったソケットは役割なしの予備になる（Plan 1B 改訂版 Task 5）。
内蔵課題が使う2つの割当は `@ojt/board-model` の定数と同じ写像にする。

| 形式 | `board.socketRoles` | 予備 |
|---|---|---|
| 課題1形式（`TASK1_SOCKET_ROLES` 相当） | `{"S1":"CR1","S2":"CR2","S3":"CR3","S4":"CR4","S7":"CHK"}` | S5・S6・S8 |
| 課題2形式（`TASK2_SOCKET_ROLES` 相当） | `{"S1":"CR1","S2":"CR2","S5":"T1","S6":"T2","S7":"CHK"}` | S3・S4・S8 |

`hints.schematicVisible` は仕様 §8.4 に合わせ、3級=常時表示（`true`）、2級・1級=`false` にする。

- [ ] **Step 1: 課題① 自己保持回路を書く**

`packages/content/src/builtin/assemble/b-001-self-hold.json`:

```json
{
  "formatVersion": 1,
  "id": "b-001",
  "mode": "assemble",
  "title": "自己保持回路",
  "grade": 3,
  "description": "黒押ボタン（PB1）で白ランプ（PL1）を点灯させ、離しても点灯を保持しなさい。黄押ボタン（PB2）で消灯すること。タイムチャートの始まりと終わりは論理0とする。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S5": "T1", "S6": "T2", "S7": "CHK" }
  },
  "inventory": [
    { "kind": "relay-my4n", "count": 2 },
    { "kind": "timer-h3y4", "count": 2 }
  ],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-b-001",
    "title": "自己保持回路",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c01", "device": "PB2" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "coil", "id": "c03", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c04", "device": "CR1" }]
      },
      {
        "id": "r2",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c05", "device": "CR1" },
          { "kind": "lamp", "id": "c06", "device": "PL1" }
        ]
      }
    ]
  },
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 3000, "target": "PB2", "action": "press" },
    { "t": 3300, "target": "PB2", "action": "release" }
  ],
  "durationMs": 5000,
  "judge": {
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": true }
}
```

- [ ] **Step 2: 課題② インターロック回路を書く**

`packages/content/src/builtin/assemble/b-002-interlock.json`:

```json
{
  "formatVersion": 1,
  "id": "b-002",
  "mode": "assemble",
  "title": "インターロック回路（先行優先）",
  "grade": 3,
  "description": "黒押ボタン（PB1）で白ランプ（PL1）、黄押ボタン（PB2）で黄ランプ（PL2）を自己保持で点灯させなさい。先に点灯した側が優先し、他方は点灯しないこと。緑押ボタン（PB3）で両方を消灯すること。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S3": "CR3", "S4": "CR4", "S7": "CHK" }
  },
  "inventory": [{ "kind": "relay-my4n", "count": 4 }],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-b-002",
    "title": "インターロック回路（先行優先）",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c01", "device": "PB3" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "cr-b", "id": "c03", "device": "CR2" },
          { "kind": "coil", "id": "c04", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c05", "device": "CR1" }]
      },
      {
        "id": "r2",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c06", "device": "PB3" },
          { "kind": "pb-a", "id": "c07", "device": "PB2" },
          { "kind": "cr-b", "id": "c08", "device": "CR1" },
          { "kind": "coil", "id": "c09", "device": "CR2" }
        ]
      },
      {
        "id": "r2h",
        "from": { "rung": "r2", "node": 1 },
        "to": { "rung": "r2", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c10", "device": "CR2" }]
      },
      {
        "id": "r3",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c11", "device": "CR1" },
          { "kind": "lamp", "id": "c12", "device": "PL1" }
        ]
      },
      {
        "id": "r4",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c13", "device": "CR2" },
          { "kind": "lamp", "id": "c14", "device": "PL2" }
        ]
      }
    ]
  },
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 1500, "target": "PB2", "action": "press" },
    { "t": 1800, "target": "PB2", "action": "release" },
    { "t": 3000, "target": "PB3", "action": "press" },
    { "t": 3300, "target": "PB3", "action": "release" },
    { "t": 4500, "target": "PB2", "action": "press" },
    { "t": 4800, "target": "PB2", "action": "release" },
    { "t": 6000, "target": "PB3", "action": "press" },
    { "t": 6300, "target": "PB3", "action": "release" }
  ],
  "durationMs": 8000,
  "judge": {
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": true }
}
```

- [ ] **Step 3: 課題③ オンディレー点灯回路を書く**

`packages/content/src/builtin/assemble/b-003-on-delay.json`:

```json
{
  "formatVersion": 1,
  "id": "b-003",
  "mode": "assemble",
  "title": "オンディレー点灯回路",
  "grade": 3,
  "description": "黒押ボタン（PB1）で運転を開始し、3秒後に白ランプ（PL1）を点灯させなさい。黄押ボタン（PB2）で運転を停止し消灯すること。タイマ T1 は3秒に設定する。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S5": "T1", "S6": "T2", "S7": "CHK" }
  },
  "inventory": [
    { "kind": "relay-my4n", "count": 2 },
    { "kind": "timer-h3y4", "count": 2 }
  ],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-b-003",
    "title": "オンディレー点灯回路",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c01", "device": "PB2" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "coil", "id": "c03", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c04", "device": "CR1" }]
      },
      {
        "id": "r2",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c05", "device": "CR1" },
          { "kind": "coil", "id": "c06", "device": "T1", "presetMs": 3000 }
        ]
      },
      {
        "id": "r3",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "t-a", "id": "c07", "device": "T1" },
          { "kind": "lamp", "id": "c08", "device": "PL1" }
        ]
      }
    ]
  },
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 6000, "target": "PB2", "action": "press" },
    { "t": 6300, "target": "PB2", "action": "release" }
  ],
  "durationMs": 8000,
  "judge": {
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": true }
}
```

- [ ] **Step 4: 自己整合テストを書く**

`packages/content/test/builtin.test.ts`（Task 16 で2つの `it` を足す）:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  BuiltinProblemError,
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_PROBLEMS,
  findBuiltinProblem,
  parseBuiltinProblems,
} from '../src/builtin/index.js';
import { judgeReference } from '../src/judge.js';
import { startsAndEndsLow } from '../src/timechart.js';

/**
 * 内蔵課題の自己整合テスト。設計仕様 §7.8 / §14.1 #30。
 * 「模範回路を自分の操作列で判定にかけると合格する」ことを全件検証する。
 */

describe('builtin problems', () => {
  it('parses every builtin problem and finds them by id', () => {
    expect(BUILTIN_PROBLEMS).toBe(BUILTIN_ASSEMBLE_PROBLEMS);
    expect(BUILTIN_PROBLEMS.every((p) => p.mode === 'assemble')).toBe(true);
    expect(new Set(BUILTIN_PROBLEMS.map((p) => p.id)).size).toBe(BUILTIN_PROBLEMS.length);
    expect(findBuiltinProblem('b-001')?.title).toBe('自己保持回路');
    expect(findBuiltinProblem('nope')).toBeUndefined();
  });

  it('refuses to start when a builtin problem is broken', () => {
    expect(() => parseBuiltinProblems([{ mode: 'assemble' }])).toThrow(BuiltinProblemError);
    try {
      parseBuiltinProblems([{ mode: 'assemble', id: 'b-999' }]);
    } catch (error) {
      expect(error).toBeInstanceOf(BuiltinProblemError);
      expect((error as BuiltinProblemError).message).toContain('b-999');
      expect((error as BuiltinProblemError).issues.length).toBeGreaterThan(0);
    }
  });

  describe.each(BUILTIN_PROBLEMS.map((p) => [p.id, p] as const))('%s', (_id, problem) => {
    const result = judgeReference(problem, JIPM_BOARD);

    it('builds its reference circuit', () => {
      if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
      expect(result.ok).toBe(true);
    });

    it('passes its own judging run', () => {
      if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
      if (!result.value.passed) {
        throw new Error(
          JSON.stringify(
            {
              mismatches: result.value.mismatches,
              failed: result.value.staticChecks.filter((c) => !c.ok),
            },
            null,
            2,
          ),
        );
      }
      expect(result.value.passed).toBe(true);
      expect(result.value.chatter).toEqual([]);
      expect(result.value.hazardCount).toBe(0);
    });

    it('draws a non-empty time chart that starts and ends low (§7.3)', () => {
      if (!result.ok) return;
      const chart = result.value.charts.expected;
      expect(chart.durationMs).toBe(problem.durationMs);
      expect(chart.signals.length).toBeGreaterThan(0);
      const active = chart.signals.filter((s) => s.segments.some((g) => g.value));
      expect(active.length).toBeGreaterThan(1);
      expect(active.some((s) => s.kind === 'output')).toBe(true);
      expect(startsAndEndsLow(chart)).toBe(true);
    });

    it('labels every timer it uses (§7.7)', () => {
      if (!result.ok) return;
      const timers = new Set<string>();
      for (const rung of problem.schematic.rungs) {
        for (const cell of rung.cells) {
          if (cell.kind === 'coil' && cell.device.startsWith('T')) timers.add(cell.device);
        }
      }
      expect(result.value.charts.expected.markers).toHaveLength(timers.size);
    });
  });
});
```

- [ ] **Step 5: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin.test.ts
```

Expected: FAIL。`Failed Suites 1` ＋ `Error: Cannot find module '../src/builtin/index.js' imported from ...`

- [ ] **Step 6: 内蔵課題を登録する**

`packages/content/src/builtin/index.ts`:

```ts
import type { AssembleProblem } from '../schema/assemble.js';
import { parseProblem, type ProblemIssue } from '../schema/index.js';
import selfHold from './assemble/b-001-self-hold.json';
import interlock from './assemble/b-002-interlock.json';
import onDelay from './assemble/b-003-on-delay.json';

/**
 * 内蔵課題。設計仕様 §7.8 / §7.9（モードB = 8題）。
 * JSONを直接読み、`parseProblem()` を通した結果だけを公開する。
 * 1件でも検証に落ちたら読み込み時に例外を投げるので、壊れた内蔵課題はビルド／テストで必ず落ちる。
 */

/** 内蔵課題のJSON（`resources/content/assemble/<id>.json` と同じ内容）。 */
const BUILTIN_ASSEMBLE_JSON: readonly unknown[] = [selfHold, interlock, onDelay];

/** 内蔵課題の検証に失敗したときに投げる。 */
export class BuiltinProblemError extends Error {
  constructor(
    message: string,
    readonly issues: ProblemIssue[],
  ) {
    super(message);
    this.name = 'BuiltinProblemError';
  }
}

/** 内蔵課題のJSONを検証する。1件でも落ちたら `BuiltinProblemError` を投げる。§7.8 */
export function parseBuiltinProblems(sources: readonly unknown[]): AssembleProblem[] {
  return sources.map((source, index) => {
    const parsed = parseProblem(source);
    if (parsed.ok) return parsed.problem;
    throw new BuiltinProblemError(
      `内蔵課題[${index}]（${parsed.id ?? '不明'}）が読めません: ${parsed.message}`,
      parsed.issues,
    );
  });
}

/** 内蔵のモードB課題（8題）。§7.9 */
export const BUILTIN_ASSEMBLE_PROBLEMS: readonly AssembleProblem[] =
  parseBuiltinProblems(BUILTIN_ASSEMBLE_JSON);

/** 内蔵課題すべて（Phase 1 はモードBのみ）。§16 */
export const BUILTIN_PROBLEMS: readonly AssembleProblem[] = BUILTIN_ASSEMBLE_PROBLEMS;

/** 内蔵課題をIDで引く。 */
export function findBuiltinProblem(id: string): AssembleProblem | undefined {
  return BUILTIN_PROBLEMS.find((p) => p.id === id);
}
```

- [ ] **Step 7: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  14 passed (14)`（共通2件＋3題×4件）

- [ ] **Step 8: コミット**

```powershell
git add packages/content/src/builtin/assemble/b-001-self-hold.json packages/content/src/builtin/assemble/b-002-interlock.json packages/content/src/builtin/assemble/b-003-on-delay.json packages/content/src/builtin/index.ts packages/content/test/builtin.test.ts
git commit -m @'
feat(content): add builtin assemble problems 1-3 and the builtin registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 15: 内蔵課題 ④〜⑥（タイマ回路）

**Files:**
- Create: `packages/content/src/builtin/assemble/b-004-sequential.json`
- Create: `packages/content/src/builtin/assemble/b-005-one-shot.json`
- Create: `packages/content/src/builtin/assemble/b-006-flicker.json`
- Modify: `packages/content/src/builtin/index.ts`

| # | ID | タイトル | 級 | 使用部品 | 要点 |
|---|---|---|---|---|---|
| ④ | `b-004` | 順次点灯回路（T1→T2） | 2 | CR1, T1(2秒), T2(2秒) | 2秒後に PL1、さらに2秒後に PL2 |
| ⑤ | `b-005` | 一定時間動作回路（ワンショット） | 2 | CR1, T1(1.5秒) | CR1 自己保持を T1 の限時b接点で切る。タイマの休止はリレーが確保する |
| ⑥ | `b-006` | フリッカ回路（リレー併用） | 2 | CR1, CR2, T1(0.8秒), T2(0.8秒) | CR2 を介して各タイマに0.8秒の休止（≥100ms）を与える |

⑤と⑥は仕様 §5.3.2 の復帰時間モデル（通電断が100ms未満なら経過時間を保持）の下で**正しく動く**構成にしてある。⑤はタイマの限時接点で自分のコイルを直接切らず CR1 を介し、⑥はタイマ2個だけで組まず CR2 を介する（調査資料 §5.5 の「厳禁」を避ける形）。この2題の模範回路は Task 14 で書いた自己整合テストがそのまま検証する（`chatter` が空であることを含む）。

- [ ] **Step 1: 課題④ 順次点灯回路を書く**

`packages/content/src/builtin/assemble/b-004-sequential.json`:

```json
{
  "formatVersion": 1,
  "id": "b-004",
  "mode": "assemble",
  "title": "順次点灯回路（T1→T2）",
  "grade": 2,
  "description": "黒押ボタン（PB1）で運転を開始し、2秒後に白ランプ（PL1）、さらに2秒後に黄ランプ（PL2）を点灯させなさい。黄押ボタン（PB2）で両方を消灯すること。タイマは T1・T2 とも2秒に設定する。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S5": "T1", "S6": "T2", "S7": "CHK" }
  },
  "inventory": [
    { "kind": "relay-my4n", "count": 2 },
    { "kind": "timer-h3y4", "count": 2 }
  ],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-b-004",
    "title": "順次点灯回路（T1→T2）",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c01", "device": "PB2" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "coil", "id": "c03", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c04", "device": "CR1" }]
      },
      {
        "id": "r2",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c05", "device": "CR1" },
          { "kind": "coil", "id": "c06", "device": "T1", "presetMs": 2000 }
        ]
      },
      {
        "id": "r3",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "t-a", "id": "c07", "device": "T1" },
          { "kind": "lamp", "id": "c08", "device": "PL1" }
        ]
      },
      {
        "id": "r4",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "t-a", "id": "c09", "device": "T1" },
          { "kind": "coil", "id": "c10", "device": "T2", "presetMs": 2000 }
        ]
      },
      {
        "id": "r5",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "t-a", "id": "c11", "device": "T2" },
          { "kind": "lamp", "id": "c12", "device": "PL2" }
        ]
      }
    ]
  },
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 8000, "target": "PB2", "action": "press" },
    { "t": 8300, "target": "PB2", "action": "release" }
  ],
  "durationMs": 10000,
  "judge": {
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": false }
}
```

- [ ] **Step 2: 課題⑤ 一定時間動作回路を書く**

`packages/content/src/builtin/assemble/b-005-one-shot.json`:

```json
{
  "formatVersion": 1,
  "id": "b-005",
  "mode": "assemble",
  "title": "一定時間動作回路（ワンショット）",
  "grade": 2,
  "description": "黒押ボタン（PB1）を押すと白ランプ（PL1）が1.5秒だけ点灯し、自動的に消灯する回路を組みなさい。タイマの限時接点で自分のコイルを直接切ってはならない（リレー CR1 を介して復帰時間を確保すること）。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S5": "T1", "S6": "T2", "S7": "CHK" }
  },
  "inventory": [
    { "kind": "relay-my4n", "count": 2 },
    { "kind": "timer-h3y4", "count": 2 }
  ],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-b-005",
    "title": "一定時間動作回路（ワンショット）",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "t-b", "id": "c01", "device": "T1" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "coil", "id": "c03", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c04", "device": "CR1" }]
      },
      {
        "id": "r2",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c05", "device": "CR1" },
          { "kind": "coil", "id": "c06", "device": "T1", "presetMs": 1500 }
        ]
      },
      {
        "id": "r3",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c07", "device": "CR1" },
          { "kind": "lamp", "id": "c08", "device": "PL1" }
        ]
      }
    ]
  },
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" }
  ],
  "durationMs": 5000,
  "judge": {
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": false }
}
```

- [ ] **Step 3: 課題⑥ フリッカ回路を書く**

`packages/content/src/builtin/assemble/b-006-flicker.json`:

```json
{
  "formatVersion": 1,
  "id": "b-006",
  "mode": "assemble",
  "title": "フリッカ回路（リレー併用）",
  "grade": 2,
  "description": "黒押ボタン（PB1）で運転を開始し、白ランプ（PL1）を0.8秒間隔で点滅させなさい。黄押ボタン（PB2）で停止し消灯すること。タイマ2個だけで組むと実機では動作が不安定になるため、リレー CR2 を介して各タイマに0.1秒以上の休止を確保すること。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S5": "T1", "S6": "T2", "S7": "CHK" }
  },
  "inventory": [
    { "kind": "relay-my4n", "count": 2 },
    { "kind": "timer-h3y4", "count": 2 }
  ],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-b-006",
    "title": "フリッカ回路（リレー併用）",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c01", "device": "PB2" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "coil", "id": "c03", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c04", "device": "CR1" }]
      },
      {
        "id": "ra",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c05", "device": "CR1" },
          { "kind": "cr-b", "id": "c06", "device": "CR2" },
          { "kind": "coil", "id": "c07", "device": "T1", "presetMs": 800 }
        ]
      },
      {
        "id": "rb",
        "from": { "rung": "ra", "node": 1 },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c08", "device": "CR2" },
          { "kind": "coil", "id": "c09", "device": "T2", "presetMs": 800 }
        ]
      },
      {
        "id": "rc",
        "from": { "rung": "ra", "node": 1 },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "t-b", "id": "c10", "device": "T2" },
          { "kind": "t-a", "id": "c11", "device": "T1" },
          { "kind": "coil", "id": "c12", "device": "CR2" }
        ]
      },
      {
        "id": "rch",
        "from": { "rung": "rc", "node": 1 },
        "to": { "rung": "rc", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c13", "device": "CR2" }]
      },
      {
        "id": "rd",
        "from": { "rung": "ra", "node": 1 },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c14", "device": "CR2" },
          { "kind": "lamp", "id": "c15", "device": "PL1" }
        ]
      }
    ]
  },
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 6000, "target": "PB2", "action": "press" },
    { "t": 6300, "target": "PB2", "action": "release" }
  ],
  "durationMs": 8000,
  "judge": {
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": false }
}
```

- [ ] **Step 4: 内蔵課題の登録に3題を足す**

`packages/content/src/builtin/index.ts`（全文を次で置き換える）:

```ts
import type { AssembleProblem } from '../schema/assemble.js';
import { parseProblem, type ProblemIssue } from '../schema/index.js';
import selfHold from './assemble/b-001-self-hold.json';
import interlock from './assemble/b-002-interlock.json';
import onDelay from './assemble/b-003-on-delay.json';
import sequential from './assemble/b-004-sequential.json';
import oneShot from './assemble/b-005-one-shot.json';
import flicker from './assemble/b-006-flicker.json';

/**
 * 内蔵課題。設計仕様 §7.8 / §7.9（モードB = 8題）。
 * JSONを直接読み、`parseProblem()` を通した結果だけを公開する。
 * 1件でも検証に落ちたら読み込み時に例外を投げるので、壊れた内蔵課題はビルド／テストで必ず落ちる。
 */

/** 内蔵課題のJSON（`resources/content/assemble/<id>.json` と同じ内容）。 */
const BUILTIN_ASSEMBLE_JSON: readonly unknown[] = [
  selfHold,
  interlock,
  onDelay,
  sequential,
  oneShot,
  flicker,
];

/** 内蔵課題の検証に失敗したときに投げる。 */
export class BuiltinProblemError extends Error {
  constructor(
    message: string,
    readonly issues: ProblemIssue[],
  ) {
    super(message);
    this.name = 'BuiltinProblemError';
  }
}

/** 内蔵課題のJSONを検証する。1件でも落ちたら `BuiltinProblemError` を投げる。§7.8 */
export function parseBuiltinProblems(sources: readonly unknown[]): AssembleProblem[] {
  return sources.map((source, index) => {
    const parsed = parseProblem(source);
    if (parsed.ok) return parsed.problem;
    throw new BuiltinProblemError(
      `内蔵課題[${index}]（${parsed.id ?? '不明'}）が読めません: ${parsed.message}`,
      parsed.issues,
    );
  });
}

/** 内蔵のモードB課題（8題）。§7.9 */
export const BUILTIN_ASSEMBLE_PROBLEMS: readonly AssembleProblem[] =
  parseBuiltinProblems(BUILTIN_ASSEMBLE_JSON);

/** 内蔵課題すべて（Phase 1 はモードBのみ）。§16 */
export const BUILTIN_PROBLEMS: readonly AssembleProblem[] = BUILTIN_ASSEMBLE_PROBLEMS;

/** 内蔵課題をIDで引く。 */
export function findBuiltinProblem(id: string): AssembleProblem | undefined {
  return BUILTIN_PROBLEMS.find((p) => p.id === id);
}
```

- [ ] **Step 5: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  26 passed (26)`（共通2件＋6題×4件）

- [ ] **Step 6: コミット**

```powershell
git add packages/content/src/builtin/assemble/b-004-sequential.json packages/content/src/builtin/assemble/b-005-one-shot.json packages/content/src/builtin/assemble/b-006-flicker.json packages/content/src/builtin/index.ts
git commit -m @'
feat(content): add builtin timer problems 4-6

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 16: 内蔵課題 ⑦⑧（優先回路）と8題の確定

**Files:**
- Create: `packages/content/src/builtin/assemble/b-007-first-press.json`
- Create: `packages/content/src/builtin/assemble/b-008-stop-priority.json`
- Modify: `packages/content/src/builtin/index.ts`
- Modify: `packages/content/test/builtin.test.ts`

| # | ID | タイトル | 級 | 使用部品 | 要点 |
|---|---|---|---|---|---|
| ⑦ | `b-007` | 早押し優先回路（3点） | 1 | CR1, CR2, CR3 | PB1/PB2/PB3 の最初の1つだけが PL1/PL2/PL3 を自己保持、PB4(赤)で全消灯 |
| ⑧ | `b-008` | 停止優先の起動・停止と警報表示 | 1 | CR1, CR2 | PB1 起動／PB3 警報／PB2 停止（同時押しは停止優先）。**盤にブザーが無いので警報出力は赤ランプ PL4 で代替**し、運転中かつ警報中は PL2 も点灯する |

⑦は `PB4`（赤）の b接点を使う。`TB_PB.4c` にはチェック用回路の固定配線（青・`locked`）が既に1本あるため（§6.3）、追加できるのは1本だけであり、この回路はその1本だけを使う。

- [ ] **Step 1: 課題⑦ 早押し優先回路を書く**

`packages/content/src/builtin/assemble/b-007-first-press.json`:

```json
{
  "formatVersion": 1,
  "id": "b-007",
  "mode": "assemble",
  "title": "早押し優先回路（3点）",
  "grade": 1,
  "description": "黒（PB1）・黄（PB2）・緑（PB3）の押ボタンのうち、最初に押された1つだけに対応するランプ（白 PL1／黄 PL2／緑 PL3）を自己保持で点灯させなさい。他の2つを押しても点灯しないこと。赤押ボタン（PB4）で全消灯すること。",
  "timeLimit": { "standardMin": 50, "cutoffMin": 60 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S3": "CR3", "S4": "CR4", "S7": "CHK" }
  },
  "inventory": [{ "kind": "relay-my4n", "count": 4 }],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-b-007",
    "title": "早押し優先回路（3点）",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c01", "device": "PB4" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "cr-b", "id": "c03", "device": "CR2" },
          { "kind": "cr-b", "id": "c04", "device": "CR3" },
          { "kind": "coil", "id": "c05", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c06", "device": "CR1" }]
      },
      {
        "id": "r2",
        "from": { "rung": "r1", "node": 1 },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-a", "id": "c07", "device": "PB2" },
          { "kind": "cr-b", "id": "c08", "device": "CR1" },
          { "kind": "cr-b", "id": "c09", "device": "CR3" },
          { "kind": "coil", "id": "c10", "device": "CR2" }
        ]
      },
      {
        "id": "r2h",
        "from": { "rung": "r2", "node": 0 },
        "to": { "rung": "r2", "node": 1 },
        "cells": [{ "kind": "cr-a", "id": "c11", "device": "CR2" }]
      },
      {
        "id": "r3",
        "from": { "rung": "r1", "node": 1 },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-a", "id": "c12", "device": "PB3" },
          { "kind": "cr-b", "id": "c13", "device": "CR1" },
          { "kind": "cr-b", "id": "c14", "device": "CR2" },
          { "kind": "coil", "id": "c15", "device": "CR3" }
        ]
      },
      {
        "id": "r3h",
        "from": { "rung": "r3", "node": 0 },
        "to": { "rung": "r3", "node": 1 },
        "cells": [{ "kind": "cr-a", "id": "c16", "device": "CR3" }]
      },
      {
        "id": "r4",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c17", "device": "CR1" },
          { "kind": "lamp", "id": "c18", "device": "PL1" }
        ]
      },
      {
        "id": "r5",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c19", "device": "CR2" },
          { "kind": "lamp", "id": "c20", "device": "PL2" }
        ]
      },
      {
        "id": "r6",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c21", "device": "CR3" },
          { "kind": "lamp", "id": "c22", "device": "PL3" }
        ]
      }
    ]
  },
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 1500, "target": "PB2", "action": "press" },
    { "t": 1800, "target": "PB2", "action": "release" },
    { "t": 2500, "target": "PB3", "action": "press" },
    { "t": 2800, "target": "PB3", "action": "release" },
    { "t": 4000, "target": "PB4", "action": "press" },
    { "t": 4300, "target": "PB4", "action": "release" },
    { "t": 5000, "target": "PB3", "action": "press" },
    { "t": 5300, "target": "PB3", "action": "release" },
    { "t": 7000, "target": "PB4", "action": "press" },
    { "t": 7300, "target": "PB4", "action": "release" }
  ],
  "durationMs": 9000,
  "judge": {
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": false }
}
```

- [ ] **Step 2: 課題⑧ 停止優先の起動・停止と警報表示を書く**

`packages/content/src/builtin/assemble/b-008-stop-priority.json`:

```json
{
  "formatVersion": 1,
  "id": "b-008",
  "mode": "assemble",
  "title": "停止優先の起動・停止と警報表示",
  "grade": 1,
  "description": "黒押ボタン（PB1）で運転（白ランプ PL1）、緑押ボタン（PB3）で警報（赤ランプ PL4）を自己保持させ、黄押ボタン（PB2）で両方を停止させなさい。起動と停止を同時に押したときは停止を優先すること。運転中かつ警報中は黄ランプ（PL2）も点灯させること。この盤にはブザーが無いため、警報出力は赤ランプ（PL4）で代替する。",
  "timeLimit": { "standardMin": 50, "cutoffMin": 60 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S3": "CR3", "S4": "CR4", "S7": "CHK" }
  },
  "inventory": [{ "kind": "relay-my4n", "count": 4 }],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-b-008",
    "title": "停止優先の起動・停止と警報表示",
    "orientation": "horizontal",
    "rungs": [
      {
        "id": "r1",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c01", "device": "PB2" },
          { "kind": "pb-a", "id": "c02", "device": "PB1" },
          { "kind": "coil", "id": "c03", "device": "CR1" }
        ]
      },
      {
        "id": "r1h",
        "from": { "rung": "r1", "node": 1 },
        "to": { "rung": "r1", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c04", "device": "CR1" }]
      },
      {
        "id": "r2",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-b", "id": "c05", "device": "PB2" },
          { "kind": "pb-a", "id": "c06", "device": "PB3" },
          { "kind": "coil", "id": "c07", "device": "CR2" }
        ]
      },
      {
        "id": "r2h",
        "from": { "rung": "r2", "node": 1 },
        "to": { "rung": "r2", "node": 2 },
        "cells": [{ "kind": "cr-a", "id": "c08", "device": "CR2" }]
      },
      {
        "id": "r3",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c09", "device": "CR1" },
          { "kind": "lamp", "id": "c10", "device": "PL1" }
        ]
      },
      {
        "id": "r4",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c11", "device": "CR2" },
          { "kind": "lamp", "id": "c12", "device": "PL4" }
        ]
      },
      {
        "id": "r5",
        "from": { "bus": "P" },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "cr-a", "id": "c13", "device": "CR1" },
          { "kind": "cr-a", "id": "c14", "device": "CR2" },
          { "kind": "lamp", "id": "c15", "device": "PL2" }
        ]
      }
    ]
  },
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 1500, "target": "PB3", "action": "press" },
    { "t": 1800, "target": "PB3", "action": "release" },
    { "t": 3000, "target": "PB2", "action": "press" },
    { "t": 3300, "target": "PB2", "action": "release" },
    { "t": 4000, "target": "PB2", "action": "press" },
    { "t": 4100, "target": "PB1", "action": "press" },
    { "t": 4400, "target": "PB1", "action": "release" },
    { "t": 4600, "target": "PB2", "action": "release" }
  ],
  "durationMs": 6000,
  "judge": {
    "compareSignals": ["PL1", "PL2", "PL3", "PL4"],
    "tolerance": { "edgeMs": 200, "ratio": 0.1 },
    "staticChecks": {
      "wireColorRule": true,
      "terminalLimit": true,
      "unusedParts": true,
      "forbiddenCircuit": true,
      "coilPolarity": true,
      "powerSequence": true
    }
  },
  "hints": { "schematicVisible": false }
}
```

- [ ] **Step 3: 8題ぶんの検査をテストに足す**

`packages/content/test/builtin.test.ts` の `it('refuses to start when a builtin problem is broken', ...)` の直後、`describe.each(...)` の直前に次の2件を挿入する:

```ts
  it('ships 8 assemble problems (§7.9)', () => {
    expect(BUILTIN_PROBLEMS).toHaveLength(8);
    expect(BUILTIN_PROBLEMS.map((p) => p.id)).toEqual([
      'b-001',
      'b-002',
      'b-003',
      'b-004',
      'b-005',
      'b-006',
      'b-007',
      'b-008',
    ]);
  });

  it('covers every hint level (§8.4)', () => {
    const grades = new Set(BUILTIN_PROBLEMS.map((p) => p.grade));
    expect([...grades].sort()).toEqual([1, 2, 3]);
    for (const problem of BUILTIN_PROBLEMS) {
      expect(problem.hints.schematicVisible).toBe(problem.grade === 3);
    }
  });

```

- [ ] **Step 4: 失敗を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin.test.ts
```

Expected: FAIL。`Tests  2 failed | 26 passed (28)`。
`ships 8 assemble problems (§7.9)` が `expected [ ... ] to have a length of 8 but got 6`、
`covers every hint level (§8.4)` が `expected [ 2, 3 ] to deeply equal [ 1, 2, 3 ]` で落ちる。

- [ ] **Step 5: 内蔵課題の登録を8題にする**

`packages/content/src/builtin/index.ts`（全文を次で置き換える）:

```ts
import type { AssembleProblem } from '../schema/assemble.js';
import { parseProblem, type ProblemIssue } from '../schema/index.js';
import selfHold from './assemble/b-001-self-hold.json';
import interlock from './assemble/b-002-interlock.json';
import onDelay from './assemble/b-003-on-delay.json';
import sequential from './assemble/b-004-sequential.json';
import oneShot from './assemble/b-005-one-shot.json';
import flicker from './assemble/b-006-flicker.json';
import firstPress from './assemble/b-007-first-press.json';
import stopPriority from './assemble/b-008-stop-priority.json';

/**
 * 内蔵課題。設計仕様 §7.8 / §7.9（モードB = 8題）。
 * JSONを直接読み、`parseProblem()` を通した結果だけを公開する。
 * 1件でも検証に落ちたら読み込み時に例外を投げるので、壊れた内蔵課題はビルド／テストで必ず落ちる。
 */

/** 内蔵課題のJSON（`resources/content/assemble/<id>.json` と同じ内容）。 */
const BUILTIN_ASSEMBLE_JSON: readonly unknown[] = [
  selfHold,
  interlock,
  onDelay,
  sequential,
  oneShot,
  flicker,
  firstPress,
  stopPriority,
];

/** 内蔵課題の検証に失敗したときに投げる。 */
export class BuiltinProblemError extends Error {
  constructor(
    message: string,
    readonly issues: ProblemIssue[],
  ) {
    super(message);
    this.name = 'BuiltinProblemError';
  }
}

/** 内蔵課題のJSONを検証する。1件でも落ちたら `BuiltinProblemError` を投げる。§7.8 */
export function parseBuiltinProblems(sources: readonly unknown[]): AssembleProblem[] {
  return sources.map((source, index) => {
    const parsed = parseProblem(source);
    if (parsed.ok) return parsed.problem;
    throw new BuiltinProblemError(
      `内蔵課題[${index}]（${parsed.id ?? '不明'}）が読めません: ${parsed.message}`,
      parsed.issues,
    );
  });
}

/** 内蔵のモードB課題（8題）。§7.9 */
export const BUILTIN_ASSEMBLE_PROBLEMS: readonly AssembleProblem[] =
  parseBuiltinProblems(BUILTIN_ASSEMBLE_JSON);

/** 内蔵課題すべて（Phase 1 はモードBのみ）。§16 */
export const BUILTIN_PROBLEMS: readonly AssembleProblem[] = BUILTIN_ASSEMBLE_PROBLEMS;

/** 内蔵課題をIDで引く。 */
export function findBuiltinProblem(id: string): AssembleProblem | undefined {
  return BUILTIN_PROBLEMS.find((p) => p.id === id);
}
```

- [ ] **Step 6: 成功を確かめる**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  36 passed (36)`（共通4件＋8題×4件）

- [ ] **Step 7: コミット**

```powershell
git add packages/content/src/builtin/assemble/b-007-first-press.json packages/content/src/builtin/assemble/b-008-stop-priority.json packages/content/src/builtin/index.ts packages/content/test/builtin.test.ts
git commit -m @'
feat(content): add builtin priority problems 7-8 and lock the set to eight

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 17: src/index.ts — 公開APIの確定と全体検証

**Files:**
- Create: `packages/content/src/index.ts`
- Delete: `packages/content/test/scaffold.test.ts`

- [ ] **Step 1: 公開APIを書く**

`packages/content/src/index.ts`:

```ts
export {
  BoardRefSchema,
  CONTENT_FORMAT_VERSION,
  ExtraPartSchema,
  GradeSchema,
  InventoryItemSchema,
  MountableKindSchema,
  ProblemHeaderSchema,
  ProblemHeaderShape,
  ProblemIdSchema,
  ProblemModeSchema,
  SocketRoleSchema,
  SocketRolesSchema,
  TerminalIdSchema,
  TimeLimitSchema,
  UNSUPPORTED_MODES,
  type BoardRef,
  type Grade,
  type InventoryItemData,
  type ProblemHeader,
  type ProblemMode,
  type SocketRolesData,
  type TimeLimit,
} from './schema/common.js';
export {
  CellKindSchema,
  RungEndSchema,
  RungSchema,
  SchematicCellSchema,
  SchematicDocumentSchema,
  toZodPath,
  type SchematicDocumentData,
} from './schema/schematic.js';
export {
  DurationMsSchema,
  lastOperationMs,
  OperationActionSchema,
  OperationListSchema,
  OperationSchema,
  OperationTargetSchema,
  pressedAt,
  type Operation,
  type OperationAction,
  type OperationTarget,
} from './schema/operations.js';
export {
  BOARD_OUTPUT_SIGNALS,
  DEFAULT_STATIC_CHECKS,
  defaultCompareSignals,
  JudgeSettingsSchema,
  resolveCompareSignals,
  STATIC_CHECK_IDS,
  StaticChecksSchema,
  ToleranceSchema,
  type JudgeSettings,
  type StaticCheckId,
  type StaticChecksData,
  type ToleranceData,
} from './schema/judge.js';
export {
  AssembleProblemSchema,
  HintsSchema,
  type AssembleProblem,
  type Hints,
} from './schema/assemble.js';
export {
  parseProblem,
  problemJsonSchema,
  ProblemSchema,
  toProblemIssues,
  UnsupportedProblemSchema,
  type ParseProblemResult,
  type Problem,
  type ProblemFailureReason,
  type ProblemIssue,
  type UnsupportedProblem,
} from './schema/index.js';
export {
  loadProblemsFromDir,
  mergeProblemSets,
  type ProblemLoadError,
  type ProblemSet,
} from './loader.js';
export {
  ASSEMBLE_WIRE_COLOR,
  buildReferenceSession,
  toPhysicalOverride,
  type ReferenceCircuit,
  type ReferenceResult,
} from './reference.js';
export { powerUp, runOperations, type RunOptions, type RunResult } from './runner.js';
export {
  buildTimeChart,
  defaultChartSignals,
  OUTPUT_LABELS,
  PB_LABELS,
  startsAndEndsLow,
  timerMarkers,
  type TimeChart,
  type TimeChartMarker,
  type TimeChartSegment,
  type TimeChartSignal,
  type TimeChartSignalKind,
  type TimeChartSignalSpec,
} from './timechart.js';
export {
  checkCoilPolarity,
  checkForbiddenCircuit,
  checkPowerSequence,
  checkTerminalLimit,
  checkUnusedParts,
  checkWireColorRule,
  runStaticChecks,
  type StaticCheckInput,
  type StaticCheckResult,
} from './static-checks.js';
export {
  judgeAssemble,
  judgeReference,
  type HazardCounts,
  type JudgeAssembleResult,
  type JudgeOptions,
  type JudgeResult,
} from './judge.js';
export {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_PROBLEMS,
  BuiltinProblemError,
  findBuiltinProblem,
  parseBuiltinProblems,
} from './builtin/index.js';
```

- [ ] **Step 2: 雛形の疎通テストを消す**

Task 1 の `test/scaffold.test.ts` は依存が解決できることの確認用だった。`src/index.ts` が全モジュールを束ねた今は不要なので削除する。

```powershell
Remove-Item packages/content/test/scaffold.test.ts
```

- [ ] **Step 3: パッケージ全体のテストを通す**

```powershell
pnpm --filter @ojt/content exec vitest run
```

Expected: `Test Files  13 passed (13)` / `Tests  133 passed (133)`

- [ ] **Step 4: カバレッジを確かめる（仕様 §14.2 の90%）**

```powershell
pnpm --filter @ojt/content exec vitest run --coverage
```

Expected: 閾値（lines / statements / functions / branches とも90%）を下回らずに終了する。実測は Statements 97%台・Branches 93%台・Functions 98%台・Lines 98%台。

- [ ] **Step 5: 型と静的解析を通す**

```powershell
pnpm -r typecheck
pnpm lint
```

Expected: `packages/content typecheck: Done` が出て、`eslint .` が無出力で終わる（`import-x/no-cycle` を含む）。

- [ ] **Step 6: 整形を確かめる**

```powershell
npx prettier --check "packages/content/**/*.{ts,json}"
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 7: ワークスペース全体を通す**

```powershell
pnpm -r test
```

Expected: `circuit-sim` / `board-model` / `schematic-core` / `content` の4パッケージがすべて `Done`。

- [ ] **Step 8: コミット**

```powershell
git add packages/content/src/index.ts packages/content/test/scaffold.test.ts
git commit -m @'
feat(content): expose the @ojt/content public API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## 仕様 §7 / §8 との対応表（完了判定に使う）

| 仕様 | 要件 | 実装 | 検証 |
|---|---|---|---|
| §7.1 | 共通ヘッダ（id / title / grade / mode / description / timeLimit / board / inventory） | `src/schema/common.ts` の `ProblemHeaderShape` | `test/schema-common.test.ts` |
| §7.1 | `timeLimit` の既定（課題1形式 50/60、課題2形式 30/50） | 内蔵課題8題が両方の値を使う（③まで 30/50、⑦⑧ 50/60） | `test/builtin.test.ts` |
| §7.1 | `board.socketRoles`（課題1形式／課題2形式）と `extraParts` | `SocketRolesSchema` / `ExtraPartSchema` | `test/schema-common.test.ts` |
| §7.2 | 模範回路＝回路図（`schematic`）＋ `physicalOverride` | `src/schema/schematic.ts`、`src/reference.ts` の `toPhysicalOverride()` | `test/schema-assemble.test.ts` / `test/reference.test.ts` |
| §7.2 | 固定の正解波形を持たず都度シミュレートする | `src/judge.ts` が毎回 `runOperations()` で模範を回す | `test/judge.test.ts` |
| §7.3 | 操作列 `{t, target, action}`、`t` は10msの倍数、`durationMs` | `src/schema/operations.ts` | `test/schema-operations.test.ts` |
| §7.3 | `t=0` で正しい手順により通電済み（操作列に電源操作を書かない） | `src/runner.ts` の `powerUp()` | `test/runner.test.ts` |
| §7.3 | 始点・終点が論理0 | `startsAndEndsLow()` | `test/builtin.test.ts`（8題全件） |
| §7.4 | `compare` の既定＝盤に実在する出力部品すべて | `defaultCompareSignals()` / `resolveCompareSignals()` | `test/schema-judge.test.ts` |
| §7.4 | `tolerance.edgeMs` / `ratio`（遷移ごとに大きい方） | `ToleranceSchema` → `compareLogs()`（Plan 1A） | `test/schema-judge.test.ts` / `test/judge.test.ts` |
| §7.4 | 静的チェック `wireColor` / `terminalLimit` / `coilPolarity` / `unusedParts` / `forbiddenCircuit` | `src/static-checks.ts` の6関数 | `test/static-checks.test.ts` |
| §7.4 | 合格＝動作一致かつ有効な静的チェックにエラー無し | `src/judge.ts` の `passed` | `test/judge.test.ts` |
| §7.4 | 危険操作回数・所要時間は記録するが合否に影響しない | `hazardCount` / `hazardsByKind` / `elapsedMs` | `test/judge.test.ts` |
| §7.7 | タイムチャート自動生成、上段=入力・下段=出力 | `defaultChartSignals()` / `buildTimeChart()` | `test/timechart.test.ts` |
| §7.7 | タイマ秒数のラベルを模範回路から自動付与 | `timerMarkers()` | `test/timechart.test.ts` / `test/builtin.test.ts` |
| §7.8 | フォルダ構成 `<mode>/<id>.json`、利用者側優先 | `loadProblemsFromDir()` / `mergeProblemSets()` | `test/loader.test.ts` |
| §7.8 | zod 検証、読込エラーは理由付きで一覧表示・他は継続 | `parseProblem()` / `ProblemLoadError` | `test/loader.test.ts` / `test/schema-index.test.ts` |
| §7.8 | 内蔵課題の自己整合テストをCIで全件 | `judgeReference()` ＋ `test/builtin.test.ts` | 8題×4件 |
| §7.9 | モードB（回路組立）8題 | `src/builtin/assemble/*.json` | `test/builtin.test.ts` |
| §8.1 | 新規配線に使える線色はモードBでは青のみ | `ASSEMBLE_WIRE_COLOR` ＋ `checkWireColorRule()` | `test/static-checks.test.ts` |
| §8.3 | 判定の流れ（並走 → 静的チェック → 結果） | `judgeAssemble()` | `test/judge.test.ts` |
| §8.3 | 結果画面の情報（合否・差分一覧・チャート重ね表示・静的チェック・危険操作・所要時間） | `JudgeResult` の各フィールド | `test/judge.test.ts` |
| §8.3 | 禁則回路の明示警告 | `checkForbiddenCircuit()` のメッセージ | `test/static-checks.test.ts` |
| §8.4 | `grade` によるヒント表示（3=常時 / 2=既定閉 / 1=非表示） | `HintsSchema` ＋ grade 1 の refinement | `test/schema-assemble.test.ts` / `test/builtin.test.ts` |
| §5.6 / §5.7 | 危険操作の集計、信号ログからの判定 | `countHazards()` / `checkPowerSequence()` | `test/judge.test.ts` / `test/static-checks.test.ts` |
| §12.3 | 作業ファイルの `formatVersion` | `CONTENT_FORMAT_VERSION`（課題側の形式バージョン） | `test/schema-common.test.ts` |
| §13 #1 | スキーマ違反は zod のパスとメッセージ付きで一覧表示 | `toProblemIssues()` | `test/schema-index.test.ts` |
| §13 #2 | 模範回路が変換不能なら開始できないようにする | `buildReferenceSession()` の失敗 → `JudgeAssembleResult.ok === false` | `test/reference.test.ts` / `test/judge.test.ts` |
| §13 #9 | 利用者課題フォルダが無くても内蔵課題だけで動く | `loadProblemsFromDir()` の `read-error` | `test/loader.test.ts` |
| §14.1 #30 | 課題の自己整合 | `judgeReference()` | `test/builtin.test.ts` |
| §14.2 | `content` の行・分岐カバレッジ 90%以上 | `vitest.config.ts` の `thresholds` | Task 17 Step 4 |
| §16 | Phase 1 受入基準③「わざと1本外して判定すると不合格になり差分一覧に該当信号が出る」 | `judgeAssemble()` | `test/judge.test.ts` |

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本プランの実装 | 理由 |
|---|---|---|---|
| 1 | §7.4 の静的チェック名は `wireColor` / `twoStage` / `plcPowerIndependent` / `ioAssignment` を含む | Phase 1 は `wireColorRule` / `terminalLimit` / `unusedParts` / `forbiddenCircuit` / `coilPolarity` / `powerSequence` の6種。`wireColor` は `wireColorRule` に改名し、`twoStage` / `plcPowerIndependent` / `ioAssignment` はモードD専用なので **Phase 3 で追加**する | Phase 1 はモードBのみ（§16）。PLC専用のチェックを未実装のまま名前だけ置くとプレースホルダになる。`powerSequence` は §7.4 の表には無いが §5.6 #4 の危険操作を結果に出すために独立項目とした |
| 2 | §7.4「`forbiddenCircuit` はチャタリング検出と**構造パターン照合の両方**で判定」 | Phase 1 はチャタリング検出のみ | 構造パターン照合（タイマ自己遮断・タイマ2個フリッカのネットリスト上の照合）はモードC2の故障探索と同じ解析基盤を要するため Phase 2 に回す。仕様 §5.3.2 の復帰時間モデルにより、禁則回路は必ず tick 周期のチャタリングとして現れるので、Phase 1 の検出漏れは無い（`test/static-checks.test.ts` の禁則ワンショットで実証） |
| 3 | §7.4 `unusedParts`「装着したが回路に組み込まれていない部品」 | 「装着したのにどのピンにも電線が1本も来ていない部品」と定義した | 「組み込まれている」の程度（コイルだけ繋がっている等）を機械的に線引きすると誤検出が増える。盤上で完全に浮いている部品だけを確実に指摘する |
| 4 | §7.1 `timeLimit` の既定は課題1形式 `{50,60}` / 課題2形式 `{30,50}` の2種 | 内蔵課題は 3級・2級相当の6題を `{30,50}`、1級相当の2題を `{50,60}` にした | 有接点の回路組立課題に対する公式の標準時間は非公開。仕様が示す2つの値のどちらかを課題の規模で選ぶ形にし、新しい値は作らない |
| 5 | §7.1 `board.socketRoles` は `["CR1","CR2","T1","T2","CHK"]` のような**5要素の配列**で例示 | `{"S1":"CR1", …, "S7":"CHK"}` のオブジェクトにし、**S1〜S8 すべて省略可**（書かなかったソケットは役割なしの予備）とした | 実物の盤はソケットを8個持ち、`@ojt/board-model` の `SocketRoles`（Plan 1B 改訂版）は `Readonly<Partial<Record<SocketId, SocketRole>>>` である。そのまま渡せる形に合わせた。盤に無いソケットIDは `z.strictObject` がその場で弾く |
| 6 | §7.2 `physicalOverride` は `{[elementId]: TerminalId[]}` | 要素数をちょうど2に固定した（`[左(P側), 右(N側)]`） | `@ojt/schematic-core` の `assignToBoard()` が各要素に左右2端子を割り当てる仕様（Plan 1B Task 13）。可変長を許すと実行時に「端子2つを指定します」と落ちるだけなので、スキーマで先に止める |
| 7 | §7.4 の判定設定のキーは `compare` | `compareSignals` にした | `compare` は動詞に読めて、`tolerance` / `staticChecks` と並べたときに何の集合か分からない。中身は仕様どおり「比較対象の出力信号名の配列」 |
| 8 | §6.3「チェック用回路の線色は黄」 | 固定配線（`locked`）は線色チェックの対象外にした | Plan 1B 改訂版で、実物の盤の既設配線はチェック用回路を含めてすべて**青**であることが写真から確定した。既設配線は訓練者の責任範囲ではないので、色ではなく `locked` で「触れない線」を識別する。訓練者が引ける色は `ASSEMBLE_WIRE_COLOR = '青'`（モードB）のまま |
| 9 | §7.5 `faults` / §7.6 `plc` の課題形式 | Phase 1 では本体スキーマを定義しない。`mode` が `inspect-parts` / `inspect-repair` / `plc` の課題は `z.looseObject` でヘッダだけ読み、`parseProblem()` が `unsupported-mode` を返して課題一覧に理由付きで並べる | 範囲決定。`z.never()` のような「読めない」定義を置くと、Phase 2/3 で書いた課題ファイルが「壊れたファイル」と表示されてしまう。ヘッダだけ読めば一覧に出せるので、拡張点を塞がずに済む |

---

## 完了条件

- [ ] `pnpm --filter @ojt/content exec vitest run` が `Test Files 13 passed` / `Tests 133 passed` で終わる。
- [ ] `pnpm --filter @ojt/content exec vitest run --coverage` が閾値90%（lines / statements / functions / branches）を満たして終わる。
- [ ] `pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` 込み）が無警告で通る。
- [ ] `npx prettier --check "packages/content/**/*.{ts,json}"` が `All matched files use Prettier code style!` を出す。
- [ ] `pnpm -r test` で `circuit-sim` / `board-model` / `schematic-core` / `content` の4パッケージがすべて通る。
- [ ] 内蔵課題8題（`b-001`〜`b-008`）が全件、自分の操作列で判定にかけて合格し、チャタリング0・危険操作0で、タイムチャートが空でなく始点・終点とも論理0である。
- [ ] 模範回路から1本外す／線色を変える／1端子に3本差す／禁則ワンショットを組む、のいずれでも判定が不合格になり、差分一覧または該当する静的チェックに理由が出る。
- [ ] `packages/content` は `React` / `Electron` / `three` に依存していない（`package.json` の `dependencies` が `@ojt/board-model` / `@ojt/circuit-sim` / `@ojt/schematic-core` / `zod` の4つだけ）。

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-14 | 初版 |
| 2026-09-14 | Plan 1B 改訂（8ソケット等）に追随。`SocketRolesSchema` を S1〜S8 の `Partial`（`z.strictObject`）に変え、内蔵課題8題の `board.socketRoles` を課題1形式 `{S1..S4, S7:CHK}` ／課題2形式 `{S1,S2,S5:T1,S6:T2,S7:CHK}` に更新。固定配線が青・`locked` になったため `checkWireColorRule()` は `locked` を検査対象外にし、`checkUnusedParts()` は予備ソケットに対応して `socketPartId()` を使うようにした。`judge.ts` の危険操作集計は circuit-sim の `HAZARD_KINDS` を唯一の源にした。在庫の上限をソケット数に合わせて8にした。`ducts` / `routeWire` / `WireRoute` は content から参照していないため影響なし |
