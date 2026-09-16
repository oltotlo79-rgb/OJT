# Plan 2A: テスターモデル・故障課題・C1/C2判定（packages のみ）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2（テスター／故障注入／モードC1 部品点検／モードC2 回路点検・修復）の**ライブラリ側**を、React・Electron・Three.js に一切依存しない純TypeScriptとして完成させる。すなわち `@ojt/circuit-sim` にテスター（デジタル／アナログ）の状態機械と `range-exceeded` の発行を足し、`@ojt/content` に故障定義スキーマ・故障適用・C1/C2課題スキーマ・C1/C2判定・回路図連動ハイライトの索引・禁則回路の構造パターン照合・内蔵課題12題（C1 4セット＋C2 8題）を足す。画面（3D盤・テスターUI・マークシートパネル・結果画面・Worker プロトコル）はすべて **Plan 2B** の担当である。

**Architecture:** 3層に切る。①**計器**（`@ojt/circuit-sim/src/tester.ts`）＝つまみ・プローブ・レンジ・針という計器そのものの意味論。`measureVoltage()` / `measureResistance()` / `continuity()`（Plan 1A）を呼び、アナログの振り切れを `sim.events` に `range-exceeded` として流す。②**故障**（`@ojt/content/src/faults.ts`）＝課題の `faults` を「盤セッションに載せる電線の故障（3Dが見たまま描ける）」と「ネットリスト変換のたびに注入し直す部品の故障」に振り分ける。③**課題とモード**（`@ojt/content/src/inspect-parts.ts` / `inspect-repair.ts` / `judge-inspect.ts`）＝チェック用ソケットの点検手順、C2の初期盤・修復・改造の判定。判定は Plan 1C と同じ「模範回路をその場でシミュレートして波形を突き合わせる」方式（決定事項#8）を再利用し、C2は模範＝課題自身の回路図、訓練者＝故障注入済み（かつ修復後）のセッションとして `compareLogs()` にかける。

**テスターモデルをどのパッケージに置くかの決定（依頼の DECIDE に対する回答）:** **`@ojt/circuit-sim` に置く**（`src/tester.ts`）。新パッケージ `@ojt/tester-model` は作らない。理由は3つある。①**エンジンの意味論だから**。§9.3 が定めるアナログ針の式（`Rin / (Rin + R)`、`Rin` は ×1 で 12Ω・×10 で 120Ω・×1k で 12kΩ）、0Ω調整未実施の +5% 誤差、時定数100msの慣性は、`LAMP_LIT_VOLTS` や `PICKUP_VOLTS` と同じ「計器という部品の物理」であり、UIの都合ではない。②**`range-exceeded` を発行する必要があるから**。§5.6 #2 のこのハザードは現状どのモジュールも発行しておらず、発行できるのは `Simulation.events`（`EventBus`）に触れられる場所だけである。別パッケージにすると `@ojt/circuit-sim` に依存したうえで `Simulation` の実体を渡してもらう形になり、パッケージを分けた意味がない（`ohm-on-live` が `meter.ts` から発行されているのと同じ位置に置くのが一貫する）。③**`@ojt/content` をUIの語彙から守るため**。`@ojt/content` は課題データと判定の責務であり、つまみの位置・針の角度を持たせると「課題」と「計器の操作状態」が同じパッケージに混ざる。`tester.ts` は React も DOM も使わず、数値と整形済み文字列（`display` / `targetDeg`）だけを返す純関数＋リデューサなので、UI非依存という条件は満たしたままである。副作用は `range-exceeded` の `emit` 1箇所のみで、それは関数のドキュメントに明記する。新パッケージを作らないことで `tsconfig` / `vitest.config` / カバレッジ閾値／`§4.2` の依存グラフの辺が増えず、`import-x/no-cycle` の検査対象も変わらない。

**Tech Stack:** TypeScript（`strict` ＋ `noUncheckedIndexedAccess` ＋ `exactOptionalPropertyTypes`）、zod 4.6.0（`z.strictObject` / `z.literal([...])`、ja locale は `schema/index.ts` で設定済み）、Vitest 5（カバレッジ v8・閾値90%）、pnpm workspace。依存の追加は**無し**（`@ojt/content` は `@ojt/board-model` / `@ojt/circuit-sim` / `@ojt/schematic-core` / `zod` のまま、`@ojt/circuit-sim` は依存ゼロのまま）。

---

## 前提（このプランを始める前に満たしていること）

| # | 前提 | 確認方法 |
|---|---|---|
| 1 | Plan 1A〜1C が完了し、`main` に入っている。`packages/circuit-sim` / `packages/board-model` / `packages/schematic-core` / `packages/content` の4パッケージが揃い、`pnpm -r test` が通る | `pnpm -r test` |
| 2 | Plan 1D2（`apps/desktop` の仕上げ）が `main` にマージ済みである。**Task 17 が `apps/desktop/src/main/content-loader.ts` の2行だけ型追随の変更を入れる**ため、着手前に `git pull --rebase` して 1D2 を取り込んでおくこと（それ以外の `apps/desktop` のファイルには触れない） | `git log --oneline -3` |
| 3 | `@ojt/circuit-sim` が `injectFault` / `clearFaults` / `measureVoltage` / `measureAcVolts` / `measureResistance` / `continuity` / `equivalentResistance` / `HAZARD_KINDS`（`ohm-on-live` と `range-exceeded` を含む）/ `COIL_OHMS`(650) / `DEFAULT_LAYER_SHORT_RATIO`(0.65) / `MIN_LAYER_SHORT_RATIO`(0.4) / `MAX_LAYER_SHORT_RATIO`(0.85) / `DEFAULT_CONTACT_RESISTIVE_OHMS`(500) / `OVER_RANGE_OHMS`(10MΩ) / `CONTINUITY_OHMS`(50) / `LIVE_OHM_VOLTS`(1) / `TICK_MS`(10) を公開している | `packages/circuit-sim/src/index.ts` |
| 4 | `@ojt/board-model` が `JIPM_BOARD` / `CHECK_SOCKET_ID`(`'S7'`) / `SOCKET_IDS` / `SOCKET_ROLES` / `socketOf` / `trySocketOf` / `socketPartId` / `createSession` / `plug` / `unplug` / `addWire` / `removeWire` / `wireCountAtTerminal` / `toNetlist` / `P_RAIL_ID`(`'P'`) / `N_RAIL_ID`(`'N'`) を公開している。チェック用回路の既設配線は `P.1→TB_PB.4c` / `TB_PB.4a→CHK.14` / `CHK.13→N.1` の3本（`locked`・青）である | `packages/board-model/src/board-jipm.ts` |
| 5 | `@ojt/schematic-core` が `toSession()` と `CellAssignment`（`cellId` / `device` / `group` / `left` / `right`）と `WireSpec`（電線IDは `sw-001` 形式で割当順に採番）を公開している | `packages/schematic-core/src/assign.ts` |
| 6 | `@ojt/content` が `parseProblem` / `ProblemSchema` / `UNSUPPORTED_MODES` / `ProblemHeaderShape` / `JudgeSettingsSchema` / `OperationListSchema` / `DurationMsSchema` / `SchematicDocumentSchema` / `buildReferenceSession` / `runOperations` / `runStaticChecks` / `buildTimeChart` / `judgeAssemble` / `BUILTIN_ASSEMBLE_PROBLEMS`（8題）を公開している | `packages/content/src/index.ts` |
| 7 | ソケット部品（`createRelay4c` / `createTimer4c`）の要素の並びは `[coil, b1, a1, b2, a2, b3, a3, b4, a4]` で固定である（`elementIndex` 0=コイル、組 k のb接点=2k−1、a接点=2k） | `packages/circuit-sim/src/parts.ts` の `socketContacts()` |

**この計画で確定させた実測値（実装前に `@ojt/circuit-sim` ＋ `@ojt/board-model` で実行して確認済み。各タスクの期待値はこの表から導く）:**

チェック用ソケット（`S7`＝`CHK`）にリレーを挿し、ブレーカ→電源スイッチで通電した状態での測定値。

| `truth` | 赤PB押下で吸引 | `CHK.13`–`CHK.14` のΩ | a接点(`CHK.9`–`CHK.5`) OFF時 | 同 ON時 | b接点(`CHK.9`–`CHK.1`) OFF時 | 同 ON時 |
|---|---|---|---|---|---|---|
| `normal` | する | `650.0`（実値 649.9995775…） | `OL` | `導通` | `導通` | `OL` |
| `coil-open` | **しない** | **`OL`**（生値 ≒ 1.0e9 Ω > 10MΩ） | `OL` | `OL` | `導通` | `導通` |
| `coil-layer-short`（ratio 0.65） | **する（正常どおり）** | **`422.5`**（実値 422.4998215…） | `OL` | `導通` | `導通` | `OL` |
| `a-open` | する | `650.0` | `OL` | **`OL`** | `導通` | `OL` |
| `a-weld` | する | `650.0` | **`導通`** | `導通` | **`OL`** | `OL` |
| `b-open` | する | `650.0` | `OL` | `導通` | **`OL`** | `OL` |
| `b-weld` | する | `650.0` | `OL` | **`OL`** | `導通` | **`導通`** |

- 導通ありの実測抵抗は `0.001Ω`（`CLOSED_CONTACT_OHMS`）、導通なしは `Infinity`（`OL`）。
- 赤PB（PB4）を**離している**間は `CHK.13`–`CHK.14` のプローブ間電圧が `0.00 V` なので、盤に通電したままΩレンジを当てても危険操作にならない（§9.1 測定1）。
- 赤PBを**押したまま**Ωレンジを当てるとプローブ間電圧が `23.996…V`（表示 `24.00 V`）になり、`measureResistance()` は `live: true` / `display: 'OL'` を返して `ohm-on-live` を1件発行する（§5.6 #1）。
- レアショートの判定しきい値は正常値の85%＝`650 × 0.85 = 552.5Ω`（§9.1 補足・§17.2 #7）。既定の 422.5Ω はこれを下回る。
- コイル抵抗の公称値は `COIL_OHMS = 650`、レアショート既定 `ratio = 0.65` なので `650 × 0.65 = 422.5`。タイマ（`createTimer4c`）のコイルも同じ 650Ω なので上表の `normal` と同じ読値になる。
- 上表の a接点／b接点のON/OFF状態はリレーなら励磁と同時に成り立つが、タイマは違う。タイマの接点は `checkSettleMs('timer-h3y4')`（プリセット時間＋マージン）だけ待ってから初めて上表どおりの状態になる（M-13）。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `packages/circuit-sim/src/tester.ts` | テスターの状態（種別・つまみ・レンジ・プローブ・0Ω調整・針）と読値。`range-exceeded` の発行。§9.3 / §5.6 #2 |
| `packages/circuit-sim/src/index.ts` | 上記の再エクスポート（変更） |
| `packages/content/src/schema/faults.ts` | 故障定義（明示リスト／ランダム）の zod と、ソケット要素番号のヘルパ。§7.5 / §5.4 |
| `packages/content/src/schema/inspect-parts.ts` | モードC1課題の本体スキーマ（`parts` と `truth`）。§7.5 / §9.1 |
| `packages/content/src/schema/inspect-repair.ts` | モードC2課題の本体スキーマ（回路図＋`faults`）。§7.5 / §9.2 |
| `packages/content/src/schema/index.ts` | 判別共用体に2モードを追加、`UNSUPPORTED_MODES` を `['plc']` に縮小、JSON Schema 再生成（変更） |
| `packages/content/src/rng.ts` | 決定論的な擬似乱数（mulberry32）。§5.2 の決定論 |
| `packages/content/src/faults.ts` | 故障の適用（セッション側／ネットリスト側）と「故障の在処」の算出。§5.4 / §9.2 |
| `packages/content/src/random-faults.ts` | ランダム故障の生成と妥当性検証（模範と動作が違う／即保護動作しない）。§7.5 |
| `packages/content/src/inspect-parts.ts` | C1のドメイン（チェック用ソケットの組み立て、`truth`→故障、判定表、期待読値）。§9.1 |
| `packages/content/src/inspect-repair.ts` | C2のドメイン（初期盤の構築、部品交換、改造と白線の判定）。§9.2 |
| `packages/content/src/judge-inspect.ts` | `judgeInspectParts()` / `judgeInspectRepair()` と結果型 `JudgeInspectResult`。§9.1 / §9.2 |
| `packages/content/src/highlight.ts` | 回路図要素 ⇄ 盤の端子・電線の索引（C2連動ハイライト）。§9.2 / §11.4 |
| `packages/content/src/forbidden.ts` | 禁則回路の構造パターン照合（タイマ自己遮断／タイマ2個フリッカ）。§7.4 |
| `packages/content/src/static-checks.ts` | `checkWireColorRule` の既設配線除外と `checkForbiddenCircuit` の構造照合の取り込み（変更） |
| `packages/content/src/reference.ts` | `SchematicProblem`（モードB／C2 共通の模範回路を持つ課題）と `ReferenceCircuit.cells` を追加（変更） |
| `packages/content/src/judge.ts` | `countHazards()` を公開して C1/C2 判定と共有する（変更） |
| `packages/content/src/problem-set.ts` / `src/loader.ts` | `ProblemSet.problems` を `SupportedProblem[]` に広げる（変更） |
| `apps/desktop/src/main/content-loader.ts` | 課題一覧と `byId` をモードBに絞る2行だけの型追随（変更。UIは Plan 2B） |
| `packages/content/src/builtin/inspect-parts/*.json` | 内蔵C1課題4セット。§7.9 |
| `packages/content/src/builtin/inspect-repair/*.json` | 内蔵C2課題8題。§7.9 |
| `packages/content/src/builtin/index.ts` | C1/C2の登録（変更） |
| `packages/content/src/index.ts` | 公開APIの確定（変更） |
| `packages/content/test/helpers/inspect.ts` | C1/C2のテスト用課題JSONの骨組み |

---

## 実装バッチ（推奨）

レビュー指摘の反映後、依存関係にもとづいて次のとおりバッチ化して実装できる。バッチ内のタスクは互いへの依存が無いか浅いので並行でき、バッチ間は原則この順で進める（`@ojt/circuit-sim` のバッチAだけは他のどのバッチにも依存しないため、B〜Gと並行してよい）。

| バッチ | タスク | 対象 | 備考 |
|---|---|---|---|
| A | 1, 2 | `@ojt/circuit-sim` | テスターの状態機械（デジタル→アナログ）。他バッチから独立 |
| B | 3, 5, 6, 8 | `@ojt/content`（スキーマ） | 故障・C1・C2のスキーマ定義と判別共用体の拡張。C以降より先に必要 |
| C | 4, 7 | `@ojt/content`（故障の適用） | Bのスキーマに依存。故障の適用とランダム故障生成 |
| D | 9, 10, 11, 13 | `@ojt/content`（ドメイン） | B・Cに依存。C1/C2のドメインロジック・構造照合・連動ハイライト索引 |
| E | 12 | `@ojt/content`（判定） | Dに依存。C1/C2の判定 |
| F | 14, 15, 16 | `@ojt/content`（内蔵課題） | D・Eに依存。内蔵C1/C2課題データと弁別テスト |
| G | 17 | 全体 | A〜Fすべてに依存。公開APIの確定と全体検証 |

---

## Task 1: `@ojt/circuit-sim` テスターの状態機械とデジタル読値

**Files:**
- Create: `packages/circuit-sim/src/tester.ts`
- Modify: `packages/circuit-sim/src/index.ts`
- Test: `packages/circuit-sim/test/tester.test.ts`

§9.3 のテスターUIが必要とする「UIに依存しない部分」を実装する。つまみ（`off`/`DCV`/`ACV`/`OHM`/`CONT`）、プローブの配置（黒→赤の順に端子IDを置く）、デジタルのオートレンジ表示、そして `Simulation` から読値を取る関数である。アナログ（レンジ・針・0Ω調整・`range-exceeded`）は Task 2 で足す。

| 決めること | 本タスクの実装 |
|---|---|
| つまみ | `TesterMode = 'off' \| 'DCV' \| 'ACV' \| 'OHM' \| 'CONT'`（§9.3 のデジタル欄と同じ5位置） |
| プローブ | `black` / `red` に `TerminalId \| undefined`。どちらか欠けていれば測定しない |
| デジタル表示 | DCV/ACV は `measureVoltage()` / `measureAcVolts()` の `display`（`0.01V` 解像度）、Ωは `measureResistance()` の `display`（`0.1Ω` 解像度、`OL`）、導通は `continuity()` の `display`（`導通` / `−−−` / `OL`） |
| 測れないときの表示 | つまみ `off` は `OFF`、プローブ未配置と活線（`ohm-on-live`）は `----`（§5.5 の測定不能表示） |
| 状態の変更 | `applyTesterAction(state, action)` が**新しい状態を返す**（引数は書き換えない）。Plan 2B は Worker と React の両方でこのリデューサを使う |

- [ ] **Step 1: 失敗するテストを書く**

`packages/circuit-sim/test/tester.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyTesterAction,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTesterState,
  readTester,
  TESTER_NO_PROBE_DISPLAY,
  TESTER_OFF_DISPLAY,
} from '../src/index.js';
import type { Simulation, TesterState } from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

/** リレー1個・ランプ1個の点検台。PB1でコイルを励磁する。 */
function coilBench(): Simulation {
  return bench(
    [createPowerSupply('PS'), createPushButton('PB1'), createRelay4c('CR1'), createLamp('PL1', '白')],
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

/** 黒→赤の順にプローブを置いた状態を作る。 */
function probed(state: TesterState, black: string, red: string): TesterState {
  const withBlack = applyTesterAction(state, { type: 'place-probe', probe: 'black', terminal: t(black) });
  return applyTesterAction(withBlack, { type: 'place-probe', probe: 'red', terminal: t(red) });
}

describe('createTesterState', () => {
  it('starts as a digital tester with the knob off and no probes', () => {
    const state = createTesterState();
    expect(state.kind).toBe('digital');
    expect(state.mode).toBe('off');
    expect(state.black).toBeUndefined();
    expect(state.red).toBeUndefined();
    expect(state.zeroAdjusted).toBe(false);
    expect(state.needleDeg).toBe(0);
  });

  it('can start as an analog tester (decision #10)', () => {
    expect(createTesterState('analog').kind).toBe('analog');
  });
});

describe('applyTesterAction', () => {
  it('returns a new object and leaves the previous state untouched', () => {
    const state = createTesterState();
    const next = applyTesterAction(state, { type: 'set-mode', mode: 'DCV' });
    expect(next).not.toBe(state);
    expect(state.mode).toBe('off');
    expect(next.mode).toBe('DCV');
  });

  it('places the black probe and then the red probe', () => {
    const state = probed(createTesterState(), 'PS.-', 'PS.+');
    expect(state.black).toBe('PS.-');
    expect(state.red).toBe('PS.+');
  });

  it('lifts a probe when the terminal is undefined', () => {
    const placed = probed(createTesterState(), 'PS.-', 'PS.+');
    const lifted = applyTesterAction(placed, { type: 'place-probe', probe: 'red', terminal: undefined });
    expect(lifted.red).toBeUndefined();
    expect(lifted.black).toBe('PS.-');
  });

  it('switches between digital and analog', () => {
    const state = applyTesterAction(createTesterState(), { type: 'set-kind', kind: 'analog' });
    expect(state.kind).toBe('analog');
    expect(applyTesterAction(state, { type: 'set-kind', kind: 'digital' }).kind).toBe('digital');
  });
});

describe('readTester (digital)', () => {
  it('shows OFF while the knob is off', () => {
    const sim = coilBench();
    const state = probed(createTesterState(), 'PS.-', 'PS.+');
    const reading = readTester(sim, state);
    expect(reading.display).toBe(TESTER_OFF_DISPLAY);
    expect(Number.isNaN(reading.value)).toBe(true);
  });

  it('shows ---- until both probes are placed', () => {
    const sim = coilBench();
    const state = applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'DCV' });
    expect(readTester(sim, state).display).toBe(TESTER_NO_PROBE_DISPLAY);
  });

  it('reads DC volts as red minus black with 0.01 V resolution (§9.3)', () => {
    const sim = coilBench();
    powerOn(sim);
    sim.press('PB1');
    sim.run(200);
    const state = probed(applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'DCV' }), 'PS.-', 'PS.+');
    const reading = readTester(sim, state);
    // 電源内部抵抗0.1Ωぶんだけ24Vより下がる（コイル650Ω∥ランプ2400Ωの負荷で 23.995V）。
    expect(reading.value).toBeCloseTo(24, 1);
    expect(reading.display).toBe('24.00 V');
    // 黒と赤を入れ替えると符号が反転する（§5.5）。
    const reversed = probed(state, 'PS.+', 'PS.-');
    expect(readTester(sim, reversed).value).toBeCloseTo(-24, 1);
  });

  it('always reads 0.00 V on ACV (§5.5)', () => {
    const sim = coilBench();
    powerOn(sim);
    sim.run(100);
    const state = probed(applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'ACV' }), 'PS.-', 'PS.+');
    expect(readTester(sim, state).display).toBe('0.00 V');
  });

  it('reads the coil resistance with 0.1 ohm resolution while the circuit is dead', () => {
    const sim = coilBench();
    const state = probed(applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'OHM' }), 'CR1.13', 'CR1.14');
    const reading = readTester(sim, state);
    expect(reading.value).toBeCloseTo(650, 1);
    expect(reading.display).toBe('650.0');
    expect(reading.live).toBe(false);
  });

  it('refuses to measure ohms on a live circuit and raises ohm-on-live (§5.6 #1)', () => {
    const sim = coilBench();
    powerOn(sim);
    sim.press('PB1');
    sim.run(200);
    const state = probed(applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'OHM' }), 'CR1.13', 'CR1.14');
    const reading = readTester(sim, state);
    expect(reading.live).toBe(true);
    expect(reading.display).toBe(TESTER_NO_PROBE_DISPLAY);
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
  });

  it('buzzes on continuity below 50 ohms and stays silent above it (§5.5)', () => {
    const sim = coilBench();
    const state = applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'CONT' });
    const closed = readTester(sim, probed(state, 'PS.+', 'CR1.9'));
    expect(closed.conductive).toBe(true);
    expect(closed.display).toBe('導通');
    const open = readTester(sim, probed(state, 'CR1.1', 'CR1.5'));
    expect(open.conductive).toBe(false);
    expect(open.display).toBe('OL');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/tester.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/tester.js`（`src/index.ts` から `tester.js` を再エクスポートしていないため `applyTesterAction` などが `undefined` で、`Test Files  1 failed (1)` になる）。

- [ ] **Step 3: `src/tester.ts` を書く**

`packages/circuit-sim/src/tester.ts`:

```ts
import { TICK_MS } from './elements.js';
import type { TerminalId } from './ids.js';
import {
  continuity,
  measureAcVolts,
  measureResistance,
  measureVoltage,
  type ContinuityReading,
  type OhmReading,
} from './meter.js';
import type { Simulation } from './simulation.js';

/**
 * テスター（回路計）の状態機械。設計仕様 §9.3 / §5.5 / §5.6 #2。
 *
 * `meter.ts` が「2端子に何Vかかっているか・何Ωか」という**測定そのもの**を担うのに対し、
 * ここは「つまみがどこにあるか・プローブをどこに置いたか・アナログの針が今どこを指しているか」
 * という**計器の状態**を担う。UI（React・DOM・3D）には一切依存せず、数値と整形済みの
 * 文字列（`display`）・針の角度（`targetDeg`）だけを返す。描画は `apps/desktop`（Plan 2B）の責務。
 *
 * 副作用は2つある。`readTester()` は `meter.ts` の測定関数（`measureResistance()` 等）を
 * 呼ぶため、活線でΩ／導通を当てると `ohm-on-live` を発行する（§5.6 #1。`meter.ts` 側の副作用で、
 * `readTester()` を内部で呼ぶ `stepTester()` からも起こり得る）。加えて `stepTester()` 自身は、
 * アナログの振り切れで `range-exceeded` を `sim.events` に発行する（§5.6 #2）。UIは
 * `snapshot.hazardDelta` から両方を同じ形で受け取れる。
 */

/** テスターの種別。切替可能（決定事項#10）。§9.3 */
export type TesterKind = 'digital' | 'analog';

/** つまみの位置。§9.3 */
export type TesterMode = 'off' | 'DCV' | 'ACV' | 'OHM' | 'CONT';

/** アナログのDCVレンジ[V]。§9.3 */
export const ANALOG_DCV_RANGES: readonly number[] = [2.5, 10, 50, 250];
/** アナログのACVレンジ[V]。§9.3 */
export const ANALOG_ACV_RANGES: readonly number[] = [10, 50, 250];
/** アナログのΩレンジ（倍率）。§9.3 */
export const ANALOG_OHM_RANGES = [1, 10, 1000] as const;

/** アナログのΩレンジ（倍率）。 */
export type AnalogOhmRange = (typeof ANALOG_OHM_RANGES)[number];

/** Ωレンジごとの内部抵抗[Ω]（中央目盛方式の針の式に使う）。§9.3 */
export const ANALOG_OHM_INTERNAL_OHMS: Readonly<Record<AnalogOhmRange, number>> = {
  1: 12,
  10: 120,
  1000: 12_000,
};

/** 針のフルスケール角[度]。実機の可動範囲は資料に無いため本アプリの前提（§17 の扱い）。 */
export const NEEDLE_FULL_SCALE_DEG = 90;
/** 針の追従の時定数[ms]。実機の慣性を模す。§9.3 */
export const NEEDLE_TIME_CONSTANT_MS = 100;
/** 目標角との差がこれ未満なら目標角へスナップする[度]。指数移動平均は理論上収束しきらないため、
 *  スナップが無いと描画側の差分検知（前回と値が同じなら再描画しない）が働かず、針が止まって
 *  見えても毎tick再描画され続ける（コーディネータ指示#3）。 */
export const NEEDLE_SNAP_DEG = 0.05;
/** 0Ω調整をせずにΩを測ったときに読値へ乗る誤差の割合（+5%）。§9.3 */
export const ZERO_ADJUST_ERROR_RATIO = 0.05;

/** つまみが `off` のときの表示。 */
export const TESTER_OFF_DISPLAY = 'OFF';
/** 測定できないときの表示（プローブ未配置・活線でのΩ／導通）。§5.5 */
export const TESTER_NO_PROBE_DISPLAY = '----';

/** アナログの電圧レンジの初期値[V]。 */
export const DEFAULT_ANALOG_VOLT_RANGE = 50;
/** アナログのΩレンジの初期値（×10）。 */
export const DEFAULT_ANALOG_OHM_RANGE: AnalogOhmRange = 10;

/** テスターの状態。UIはこの1オブジェクトだけを持てばよい。§9.3 */
export interface TesterState {
  kind: TesterKind;
  mode: TesterMode;
  /** アナログの電圧レンジ[V]（DCV/ACV 共用のつまみ）。 */
  voltRange: number;
  /** アナログのΩレンジ（倍率）。 */
  ohmRange: AnalogOhmRange;
  /** 黒プローブを置いた端子（未配置は undefined）。 */
  black: TerminalId | undefined;
  /** 赤プローブを置いた端子（未配置は undefined）。 */
  red: TerminalId | undefined;
  /** 0Ω調整済みか。レンジを変えるたびに false に戻る。§9.3 */
  zeroAdjusted: boolean;
  /** アナログ針の現在角度[度]（指数移動平均で追従する）。 */
  needleDeg: number;
  /** `range-exceeded` を発行済みか。レンジ内に戻る／つまみ・レンジ・プローブが変わるまで再発行しない。§5.6 */
  rangeExceededReported: boolean;
}

/** テスターへの操作。§9.3 */
export type TesterAction =
  | { type: 'set-kind'; kind: TesterKind }
  | { type: 'set-mode'; mode: TesterMode }
  | { type: 'set-volt-range'; range: number }
  | { type: 'set-ohm-range'; range: AnalogOhmRange }
  | { type: 'place-probe'; probe: 'black' | 'red'; terminal: TerminalId | undefined }
  | { type: 'zero-adjust' };

/** 1回の読取結果。 */
export interface TesterReading {
  kind: TesterKind;
  mode: TesterMode;
  /** 読値の生値（DCV/ACVは[V]、Ω／導通は[Ω]）。測定できないときは NaN。 */
  value: number;
  /** 表示文字列。`OFF` / `----` / `OL` / `導通` / `−−−` / 数値。 */
  display: string;
  /** 針の目標角度[度]（デジタルは常に0）。 */
  targetDeg: number;
  /** アナログでレンジ上限を超えた（振り切れ）。§5.6 #2 */
  overRange: boolean;
  /** 通電中にΩ／導通を当てた。§5.6 #1 */
  live: boolean;
  /** 導通レンジでブザーが鳴る（50Ω以下）。§5.5 */
  conductive: boolean;
}

/** 初期状態。既定はデジタル・つまみOFF・プローブ未配置。 */
export function createTesterState(kind: TesterKind = 'digital'): TesterState {
  return {
    kind,
    mode: 'off',
    voltRange: DEFAULT_ANALOG_VOLT_RANGE,
    ohmRange: DEFAULT_ANALOG_OHM_RANGE,
    black: undefined,
    red: undefined,
    zeroAdjusted: false,
    needleDeg: 0,
    rangeExceededReported: false,
  };
}

/** そのつまみ位置で選べる電圧レンジ。Ω／導通／OFFのときは DCV と同じ一覧を返す（つまみは1つのため）。 */
export function voltRangesFor(mode: TesterMode): readonly number[] {
  return mode === 'ACV' ? ANALOG_ACV_RANGES : ANALOG_DCV_RANGES;
}

/** 一覧の中で `range` に最も近い値（同着は小さい方）。つまみを回したときにレンジを追従させる。 */
function nearestRange(ranges: readonly number[], range: number): number {
  let best = ranges[0] ?? DEFAULT_ANALOG_VOLT_RANGE;
  for (const candidate of ranges) {
    if (Math.abs(candidate - range) < Math.abs(best - range)) best = candidate;
  }
  return best;
}

/**
 * 操作を適用して**新しい状態**を返す（引数は書き換えない）。§9.3
 * つまみ・レンジ・種別が変わったら 0Ω調整と `range-exceeded` の発行済み記録を両方とも捨てる
 * （レンジを変えるたびに0Ω調整をやり直す実機の作法をそのまま写す）。プローブの置き直しは
 * `range-exceeded` の発行済み記録だけ戻す（レンジ自体は変わらないので0Ω調整は保持する）。
 */
export function applyTesterAction(state: TesterState, action: TesterAction): TesterState {
  const resetRange = { zeroAdjusted: false, rangeExceededReported: false };
  switch (action.type) {
    case 'set-kind':
      return { ...state, ...resetRange, kind: action.kind };
    case 'set-mode':
      return {
        ...state,
        ...resetRange,
        mode: action.mode,
        voltRange: nearestRange(voltRangesFor(action.mode), state.voltRange),
      };
    case 'set-volt-range':
      return { ...state, ...resetRange, voltRange: nearestRange(voltRangesFor(state.mode), action.range) };
    case 'set-ohm-range':
      return { ...state, ...resetRange, ohmRange: action.range };
    case 'place-probe':
      // プローブの置き直しは0Ω調整をやり直させない(レンジ・モード・種別の変更と違い、
      // 調整の前提となるレンジ自体は変わらないため)。振り切れの再発行可否だけ戻す。
      return action.probe === 'black'
        ? { ...state, rangeExceededReported: false, black: action.terminal }
        : { ...state, rangeExceededReported: false, red: action.terminal };
    case 'zero-adjust':
      return { ...state, zeroAdjusted: true };
  }
}

/** 測定できないときの読値。 */
function blankReading(state: TesterState, display: string, live = false): TesterReading {
  return {
    kind: state.kind,
    mode: state.mode,
    value: Number.NaN,
    display,
    targetDeg: 0,
    overRange: false,
    live,
    conductive: false,
  };
}

/** 電圧の読値を組み立てる。アナログはレンジで振り切れを判定する（Task 2 で角度を足す）。 */
function voltReading(state: TesterState, volts: number, display: string): TesterReading {
  return {
    kind: state.kind,
    mode: state.mode,
    value: volts,
    display,
    targetDeg: 0,
    overRange: false,
    live: false,
    conductive: false,
  };
}

/**
 * いまの状態で1回測る。§9.3
 * プローブが両方置かれていなければ測定しない（`----`）。Ω／導通は `meter.ts` の制約
 * （プローブ間1V以上なら測定拒否＋`ohm-on-live`）をそのまま受ける（§5.5 / §5.6 #1）。
 */
export function readTester(sim: Simulation, state: TesterState): TesterReading {
  if (state.mode === 'off') return blankReading(state, TESTER_OFF_DISPLAY);
  const { black, red } = state;
  if (black === undefined || red === undefined) {
    return blankReading(state, TESTER_NO_PROBE_DISPLAY);
  }
  if (state.mode === 'DCV') {
    const reading = measureVoltage(sim, black, red);
    return voltReading(state, reading.volts, reading.display);
  }
  if (state.mode === 'ACV') {
    const reading = measureAcVolts();
    return voltReading(state, reading.volts, reading.display);
  }
  if (state.mode === 'OHM') {
    const reading = measureResistance(sim, black, red);
    if (reading.live) return blankReading(state, TESTER_NO_PROBE_DISPLAY, true);
    return {
      kind: state.kind,
      mode: state.mode,
      value: reading.ohms,
      display: reading.display,
      targetDeg: 0,
      overRange: false,
      live: false,
      conductive: false,
    };
  }
  const reading = continuity(sim, black, red);
  if (reading.live) return blankReading(state, TESTER_NO_PROBE_DISPLAY, true);
  return {
    kind: state.kind,
    mode: state.mode,
    value: reading.ohms,
    display: reading.display,
    targetDeg: 0,
    overRange: false,
    live: false,
    conductive: reading.conductive,
  };
}

/** 針の追従に使う1tickの既定の長さ[ms]。 */
export const TESTER_TICK_MS = TICK_MS;
```

- [ ] **Step 4: `src/index.ts` に再エクスポートを足す**

`packages/circuit-sim/src/index.ts` の末尾（`export { allowedShiftMs, … } from './compare.js';` の直後）に追記する:

```ts
export {
  ANALOG_ACV_RANGES,
  ANALOG_DCV_RANGES,
  ANALOG_OHM_INTERNAL_OHMS,
  ANALOG_OHM_RANGES,
  applyTesterAction,
  createTesterState,
  DEFAULT_ANALOG_OHM_RANGE,
  DEFAULT_ANALOG_VOLT_RANGE,
  NEEDLE_FULL_SCALE_DEG,
  NEEDLE_TIME_CONSTANT_MS,
  readTester,
  TESTER_NO_PROBE_DISPLAY,
  TESTER_OFF_DISPLAY,
  TESTER_TICK_MS,
  voltRangesFor,
  ZERO_ADJUST_ERROR_RATIO,
  type AnalogOhmRange,
  type TesterAction,
  type TesterKind,
  type TesterMode,
  type TesterReading,
  type TesterState,
} from './tester.js';
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/tester.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  13 passed (13)`。

- [ ] **Step 6: コミットする**

```powershell
git add packages/circuit-sim/src/tester.ts packages/circuit-sim/src/index.ts packages/circuit-sim/test/tester.test.ts
git commit -m @'
feat(circuit-sim): add tester state machine with digital readings

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 2: アナログテスターの針と `range-exceeded`

**Files:**
- Modify: `packages/circuit-sim/src/tester.ts`
- Modify: `packages/circuit-sim/src/index.ts`
- Test: `packages/circuit-sim/test/tester-analog.test.ts`

§9.3 のアナログ欄を実装する。ここで初めて §5.6 #2 の `range-exceeded` が**発行される**（`HAZARD_KINDS` には Plan 1A から入っていたが、発行者がいなかった）。

| 項目 | 式・規則 | 根拠 |
|---|---|---|
| DCV/ACV の針 | 振れ角 ＝ 測定値 ÷ レンジ × フルスケール角。負（逆接続）は左端＝0度に張り付く | §9.3 |
| Ωの針 | 振れ角 ＝ フルスケール角 × Rin ÷ (Rin + R)。`Rin` は ×1=12Ω / ×10=120Ω / ×1k=12kΩ。右端が0Ω、左端が∞ | §9.3 |
| フルスケール角 | `NEEDLE_FULL_SCALE_DEG = 90`（本アプリの前提。実機の可動範囲は資料に無い） | §17 の扱い |
| レンジ不足 | 測定値の絶対値がレンジを超えたら `range-exceeded` を1件発行し、針はレンジ上限位置に固定する。レンジ内に戻る／つまみ・レンジ・プローブが変わるまで再発行しない | §9.3 / §5.6 #2 |
| 0Ω調整 | 未実施のままΩ／導通を測ると読値に **+5%** が乗る。レンジを変えると未実施に戻る | §9.3 |
| 針の追従 | 時定数100msの指数移動平均。α ＝ 1 − exp(−dt ÷ 100)、dt ＝ 10ms で α ≒ 0.0951626 | §9.3 |

**意図的な限定:** `range-exceeded` はDCV/ACVでのみ発行する。Ωレンジは中央目盛方式で右端が0Ω・左端が∞であり「上限を超える」という状態が存在しない（測れない値は左端に寄るだけで針は振り切れない）ためである。ACVは常に0.00Vなので実際に発行されるのはDCVだけになる。

- [ ] **Step 1: 失敗するテストを書く**

`packages/circuit-sim/test/tester-analog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyTesterAction,
  createPowerSupply,
  createRelay4c,
  createTesterState,
  NEEDLE_FULL_SCALE_DEG,
  ohmNeedleDeg,
  readTester,
  stepTester,
  voltNeedleDeg,
  voltRangesFor,
  withZeroAdjustError,
} from '../src/index.js';
import type { Simulation, TesterState } from '../src/index.js';
import { bench, powerOn, t, w } from './helpers/circuits.js';

/** コイル650Ωだけをぶら下げた測定台。 */
function relayBench(): Simulation {
  return bench(
    [createPowerSupply('PS'), createRelay4c('CR1')],
    [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
  );
}

function analog(mode: 'DCV' | 'ACV' | 'OHM' | 'CONT', black: string, red: string): TesterState {
  let state = applyTesterAction(createTesterState('analog'), { type: 'set-mode', mode });
  state = applyTesterAction(state, { type: 'place-probe', probe: 'black', terminal: t(black) });
  return applyTesterAction(state, { type: 'place-probe', probe: 'red', terminal: t(red) });
}

describe('voltNeedleDeg', () => {
  it('is linear against the range', () => {
    expect(voltNeedleDeg(0, 50)).toBe(0);
    expect(voltNeedleDeg(25, 50)).toBeCloseTo(45, 6);
    expect(voltNeedleDeg(50, 50)).toBeCloseTo(NEEDLE_FULL_SCALE_DEG, 6);
  });

  it('pins the needle at the left stop for a reversed reading and at full scale above the range', () => {
    expect(voltNeedleDeg(-10, 50)).toBe(0);
    expect(voltNeedleDeg(120, 50)).toBeCloseTo(NEEDLE_FULL_SCALE_DEG, 6);
  });
});

describe('ohmNeedleDeg', () => {
  it('uses the centre scale law Rin over Rin plus R', () => {
    // ×10 は Rin = 120Ω なので、120Ω を測るとちょうど中央（45度）を指す。
    expect(ohmNeedleDeg(120, 10)).toBeCloseTo(45, 6);
    expect(ohmNeedleDeg(0, 10)).toBeCloseTo(NEEDLE_FULL_SCALE_DEG, 6);
    expect(ohmNeedleDeg(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });

  it('moves the whole scale when the range multiplier changes', () => {
    expect(ohmNeedleDeg(650, 1)).toBeCloseTo(90 * (12 / 662), 6);
    expect(ohmNeedleDeg(650, 1000)).toBeCloseTo(90 * (12000 / 12650), 6);
  });
});

describe('withZeroAdjustError', () => {
  it('adds 5 percent until the zero ohm adjustment is done', () => {
    expect(withZeroAdjustError(650, false)).toBeCloseTo(682.5, 6);
    expect(withZeroAdjustError(650, true)).toBe(650);
    expect(withZeroAdjustError(Number.POSITIVE_INFINITY, false)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('voltRangesFor', () => {
  it('offers 2.5/10/50/250 on DCV and 10/50/250 on ACV', () => {
    expect(voltRangesFor('DCV')).toEqual([2.5, 10, 50, 250]);
    expect(voltRangesFor('ACV')).toEqual([10, 50, 250]);
  });

  it('snaps the knob to the nearest range of the new mode', () => {
    let state = applyTesterAction(createTesterState('analog'), { type: 'set-mode', mode: 'DCV' });
    state = applyTesterAction(state, { type: 'set-volt-range', range: 2.5 });
    expect(state.voltRange).toBe(2.5);
    state = applyTesterAction(state, { type: 'set-mode', mode: 'ACV' });
    expect(state.voltRange).toBe(10);
  });
});

describe('readTester (analog)', () => {
  it('points the needle at 43.19 deg for 24 V on the 50 V range', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    const state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 50,
    });
    const reading = readTester(sim, state);
    expect(reading.value).toBeCloseTo(23.996, 2);
    expect(reading.targetDeg).toBeCloseTo(43.19, 1);
    expect(reading.overRange).toBe(false);
  });

  it('flags over range on the 10 V range and shows OL', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    const state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 10,
    });
    const reading = readTester(sim, state);
    expect(reading.overRange).toBe(true);
    expect(reading.display).toBe('OL');
    expect(reading.targetDeg).toBeCloseTo(NEEDLE_FULL_SCALE_DEG, 6);
  });

  it('adds the zero ohm adjustment error to the coil reading until adjusted', () => {
    const sim = relayBench();
    const state = applyTesterAction(analog('OHM', 'CR1.13', 'CR1.14'), {
      type: 'set-ohm-range',
      range: 10,
    });
    const raw = readTester(sim, state);
    expect(raw.display).toBe('682.5');
    expect(raw.targetDeg).toBeCloseTo(13.458, 2);
    const adjusted = readTester(sim, applyTesterAction(state, { type: 'zero-adjust' }));
    expect(adjusted.display).toBe('650.0');
    expect(adjusted.targetDeg).toBeCloseTo(14.026, 2);
  });

  it('rests the needle at the infinity end when the path is open', () => {
    const sim = relayBench();
    const state = applyTesterAction(analog('OHM', 'CR1.1', 'CR1.5'), {
      type: 'set-ohm-range',
      range: 10,
    });
    const reading = readTester(sim, state);
    expect(reading.display).toBe('OL');
    expect(reading.targetDeg).toBe(0);
    expect(reading.overRange).toBe(false);
  });
});

describe('stepTester', () => {
  it('moves the needle with a 100 ms exponential lag', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    let state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 10,
    });
    const first = stepTester(sim, state);
    expect(first.state.needleDeg).toBeCloseTo(8.565, 2);
    state = first.state;
    for (let i = 0; i < 9; i += 1) state = stepTester(sim, state).state;
    // 目標90度へ 1 - exp(-1) = 0.63212 ぶん進む。
    expect(state.needleDeg).toBeCloseTo(56.891, 2);
  });

  it('snaps the needle onto the target within 0.05 degrees so it stops changing (コーディネータ指示#3)', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    let state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 10,
    });
    // 76 tick前後で目標90度との差が0.05度を切る（90 × 0.904837^76 ≒ 0.049）。余裕を見て200tick進める。
    for (let i = 0; i < 200; i += 1) state = stepTester(sim, state).state;
    expect(state.needleDeg).toBe(90);
    // スナップ後はこれ以上動かない（同じ値が続く＝描画側は再レンダーしなくてよい）。
    const settled = stepTester(sim, state).state;
    expect(settled.needleDeg).toBe(90);
  });

  it('keeps the digital needle at zero', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    let state = applyTesterAction(createTesterState('digital'), { type: 'set-mode', mode: 'DCV' });
    state = applyTesterAction(state, { type: 'place-probe', probe: 'black', terminal: t('PS.-') });
    state = applyTesterAction(state, { type: 'place-probe', probe: 'red', terminal: t('PS.+') });
    const stepped = stepTester(sim, state);
    expect(stepped.state.needleDeg).toBe(0);
    expect(stepped.reading.overRange).toBe(false);
    expect(sim.events.countOf('range-exceeded')).toBe(0);
  });

  it('raises range-exceeded once per excursion and re-arms after the reading returns in range', () => {
    const sim = relayBench();
    powerOn(sim);
    sim.run(100);
    let state = applyTesterAction(analog('DCV', 'PS.-', 'PS.+'), {
      type: 'set-volt-range',
      range: 10,
    });
    state = stepTester(sim, state).state;
    state = stepTester(sim, state).state;
    expect(sim.events.countOf('range-exceeded')).toBe(1);
    state = applyTesterAction(state, { type: 'set-volt-range', range: 250 });
    state = stepTester(sim, state).state;
    expect(sim.events.countOf('range-exceeded')).toBe(1);
    state = applyTesterAction(state, { type: 'set-volt-range', range: 10 });
    stepTester(sim, state);
    expect(sim.events.countOf('range-exceeded')).toBe(2);
    expect(sim.events.hazards('range-exceeded')[0]?.detail).toContain('DCV');
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/tester-analog.test.ts
```

Expected: 失敗。`TypeError: voltNeedleDeg is not a function`（`ohmNeedleDeg` / `withZeroAdjustError` / `stepTester` も未実装）で `Test Files  1 failed (1)`。

- [ ] **Step 3: `src/tester.ts` に針の計算を足す**

`packages/circuit-sim/src/tester.ts` の `blankReading()` の**直前**に次の3つの純関数を挿入する:

```ts
/**
 * アナログ電圧計の針の角度[度]。目盛に対して線形。§9.3
 * 逆極性（負の測定値）は左端＝0度に張り付き、レンジ上限を超えたらフルスケールで止まる。
 */
export function voltNeedleDeg(volts: number, range: number): number {
  const ratio = volts / range;
  if (!(ratio > 0)) return 0;
  return Math.min(ratio, 1) * NEEDLE_FULL_SCALE_DEG;
}

/**
 * アナログΩ計の針の角度[度]。中央目盛方式（非線形）。§9.3
 * 振れ角 ＝ フルスケール角 × Rin ÷ (Rin + R)。右端（フルスケール）が0Ω、左端（0度）が∞。
 */
export function ohmNeedleDeg(ohms: number, range: AnalogOhmRange): number {
  if (!Number.isFinite(ohms) || ohms < 0) return 0;
  const rin = ANALOG_OHM_INTERNAL_OHMS[range];
  return NEEDLE_FULL_SCALE_DEG * (rin / (rin + ohms));
}

/** 0Ω調整が未実施なら読値に +5% の誤差を乗せる。§9.3 */
export function withZeroAdjustError(ohms: number, zeroAdjusted: boolean): number {
  if (!Number.isFinite(ohms)) return ohms;
  return zeroAdjusted ? ohms : ohms * (1 + ZERO_ADJUST_ERROR_RATIO);
}
```

- [ ] **Step 4: `voltReading()` をアナログ対応に差し替える**

`packages/circuit-sim/src/tester.ts` の `voltReading()` を丸ごと次に置き換える:

```ts
/**
 * 電圧の読値を組み立てる。アナログはレンジで振り切れを判定し、針の目標角度を入れる。§9.3
 * 振り切れの判定は絶対値で見る（逆極性で大きく振れた場合も可動コイルには同じ負担がかかるため）。
 */
function voltReading(state: TesterState, volts: number, display: string): TesterReading {
  if (state.kind === 'digital') {
    return {
      kind: state.kind,
      mode: state.mode,
      value: volts,
      display,
      targetDeg: 0,
      overRange: false,
      live: false,
      conductive: false,
    };
  }
  const overRange = Math.abs(volts) > state.voltRange;
  return {
    kind: state.kind,
    mode: state.mode,
    value: volts,
    display: overRange ? 'OL' : display,
    targetDeg: voltNeedleDeg(volts, state.voltRange),
    overRange,
    live: false,
    conductive: false,
  };
}
```

- [ ] **Step 5: `readTester()` のΩ／導通分岐をアナログ対応に差し替える**

`packages/circuit-sim/src/tester.ts` の `readTester()` の**直前**に、Ω／導通の再計算を避けるキャッシュを足す（コーディネータ指示#1）。`measureResistance()` / `continuity()` は呼ぶたびにフルの回路解析をやり直す（`measureVoltage()` で1回、内部の `equivalentResistance()` でさらに1回）ため、`stepTester()` を毎tick呼ぶ構成では無視できないコストになる。`Simulation` は変更を数える版数を公開していないので、`tick（`sim.tMs`）・プローブ配置・レンジ種別`が前回と同じなら結果も同じである、という構造的な事実でキャッシュする:

```ts
/**
 * readTester() のΩ／導通の再計算を避けるキャッシュ。`Simulation` インスタンスをキーにした
 * `WeakMap` なので、セッションをまたいで古い結果が残ることはない。tick・プローブ配置・
 * レンジ種別のどれかが変わったら破棄する（この3つが同じなら回路の状態も同じなので、
 * 再度フルの回路解析をする必要が無い）。
 */
interface OhmCacheEntry {
  tMs: number;
  black: TerminalId;
  red: TerminalId;
  kind: 'OHM' | 'CONT';
  reading: OhmReading | ContinuityReading;
}
const ohmCache = new WeakMap<Simulation, OhmCacheEntry>();

function cachedMeasure<T extends OhmReading | ContinuityReading>(
  sim: Simulation,
  black: TerminalId,
  red: TerminalId,
  kind: 'OHM' | 'CONT',
  measure: () => T,
): T {
  const cached = ohmCache.get(sim);
  if (
    cached !== undefined &&
    cached.kind === kind &&
    cached.tMs === sim.tMs &&
    cached.black === black &&
    cached.red === red
  ) {
    return cached.reading as T;
  }
  const reading = measure();
  ohmCache.set(sim, { tMs: sim.tMs, black, red, kind, reading });
  return reading;
}
```

続けて、`readTester()` のうち `if (state.mode === 'OHM') {` から関数の閉じ括弧までを丸ごと次に置き換える（`measureResistance()` / `continuity()` の直接呼び出しを `cachedMeasure()` 経由に変える）:

```ts
  if (state.mode === 'OHM') {
    const reading = cachedMeasure(sim, black, red, 'OHM', () => measureResistance(sim, black, red));
    if (reading.live) return blankReading(state, TESTER_NO_PROBE_DISPLAY, true);
    if (state.kind === 'digital') {
      return {
        kind: state.kind,
        mode: state.mode,
        value: reading.ohms,
        display: reading.display,
        targetDeg: 0,
        overRange: false,
        live: false,
        conductive: false,
      };
    }
    const shown = withZeroAdjustError(reading.ohms, state.zeroAdjusted);
    return {
      kind: state.kind,
      mode: state.mode,
      value: shown,
      display: Number.isFinite(shown) ? shown.toFixed(1) : 'OL',
      targetDeg: ohmNeedleDeg(shown, state.ohmRange),
      overRange: false,
      live: false,
      conductive: false,
    };
  }
  const reading = cachedMeasure(sim, black, red, 'CONT', () => continuity(sim, black, red));
  if (reading.live) return blankReading(state, TESTER_NO_PROBE_DISPLAY, true);
  const shown = withZeroAdjustError(reading.ohms, state.zeroAdjusted);
  return {
    kind: state.kind,
    mode: state.mode,
    value: state.kind === 'analog' ? shown : reading.ohms,
    display: reading.display,
    targetDeg: state.kind === 'analog' ? ohmNeedleDeg(shown, state.ohmRange) : 0,
    overRange: false,
    live: false,
    conductive: reading.conductive,
  };
}
```

**キャッシュの副作用への注意:** `measureResistance()` / `continuity()` は活線を検出すると `ohm-on-live` を発行する副作用を持つ（§5.6 #1）が、同じプローブ配置のまま活線が続く間は2回目以降を呼んでも `isNewLiveExposure()` が再発行を防ぐので、キャッシュでヒットして呼び出し自体を省いても観測できる挙動は変わらない。

- [ ] **Step 5a: キャッシュのテストを足す (コーディネータ指示#1)**

`packages/circuit-sim/test/tester.test.ts` の `describe('readTester (digital)', …)` の末尾に足す:

```ts
  it('does not re-solve on a second readTester call at the same tick with the same probes (perf)', () => {
    const sim = coilBench();
    const state = probed(applyTesterAction(createTesterState(), { type: 'set-mode', mode: 'OHM' }), 'CR1.13', 'CR1.14');
    const spy = vi.spyOn(meter, 'measureResistance');
    readTester(sim, state);
    readTester(sim, state);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
```

同ファイルの import に、名前空間版の `meter.js` と `vi` を足す:

```ts
import { vi } from 'vitest';
import * as meter from '../src/meter.js';
```

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/tester.test.ts
```

Expected: 追加した1件を含めて通る。

- [ ] **Step 6: `stepTester()` を足す**

`packages/circuit-sim/src/tester.ts` の末尾（`export const TESTER_TICK_MS = TICK_MS;` の後ろ）に足す:

```ts
/**
 * 1tickぶん進めて読値と新しい状態を返す。§9.3 / §5.6 #2
 *
 * アナログ針は時定数100msの指数移動平均で目標角度へ寄せる（α ＝ 1 − exp(−dt ÷ 100)。
 * 10ms tick では約0.0952）。目標角との差が `NEEDLE_SNAP_DEG`（0.05度）未満になったら
 * 目標角へスナップする。指数移動平均は理論上いつまでも収束しきらないため、スナップが無いと
 * 針が止まって見えても `needleDeg` が毎tick極小に変化し続け、描画側の差分検知（前回と同じ値
 * なら再描画しない）が効かずに再レンダーが止まらない（コーディネータ指示#3）。デジタルは
 * 針を持たないので常に0度のままにする。
 *
 * **この関数の副作用**: アナログでレンジ上限を超えた読値になったとき、`sim.events` に
 * `range-exceeded` を1件発行する（内部で呼ぶ `readTester()` も、活線でΩ／導通を当てると
 * `meter.ts` 経由で `ohm-on-live` を発行し得る。§5.6 #1）。同じ振り切れが続いている間は再発行せず、
 * 読値がレンジ内に戻ったときに再発行できる状態へ戻す（つまみ・レンジ・プローブを動かしたときは
 * `applyTesterAction()` が記録を消す）。重複抑制の考え方は `ohm-on-live`（§5.6 #1）と同じ。
 */
export function stepTester(
  sim: Simulation,
  state: TesterState,
  dtMs: number = TESTER_TICK_MS,
): { state: TesterState; reading: TesterReading } {
  const reading = readTester(sim, state);
  const alpha = 1 - Math.exp(-dtMs / NEEDLE_TIME_CONSTANT_MS);
  const eased =
    state.kind === 'analog' ? state.needleDeg + alpha * (reading.targetDeg - state.needleDeg) : 0;
  const needleDeg =
    state.kind === 'analog' && Math.abs(reading.targetDeg - eased) < NEEDLE_SNAP_DEG
      ? reading.targetDeg
      : eased;
  let rangeExceededReported = state.rangeExceededReported;
  if (reading.overRange) {
    if (!rangeExceededReported) {
      sim.events.emit({
        type: 'hazard',
        kind: 'range-exceeded',
        tMs: sim.tMs,
        detail: `${state.mode} ${state.voltRange}V レンジ`,
      });
      rangeExceededReported = true;
    }
  } else {
    rangeExceededReported = false;
  }
  return { state: { ...state, needleDeg, rangeExceededReported }, reading };
}
```

- [ ] **Step 7: `src/index.ts` の再エクスポートに4件足す**

Task 1 で追記したブロックの中に、次の4行をアルファベット順の位置（`ohmNeedleDeg` は `NEEDLE_TIME_CONSTANT_MS` の後、`stepTester` は `readTester` の後、`voltNeedleDeg` は `voltRangesFor` の前、`withZeroAdjustError` は `voltRangesFor` の後）に挿入する:

```ts
  ohmNeedleDeg,
  stepTester,
  voltNeedleDeg,
  withZeroAdjustError,
```

- [ ] **Step 8: GREEN を確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run test/tester.test.ts test/tester-analog.test.ts
```

Expected: `Test Files  2 passed (2)` / `Tests  29 passed (29)`（`tester.test.ts` 14件・`tester-analog.test.ts` 15件）。

- [ ] **Step 9: パッケージ全体とカバレッジを確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run --coverage
```

Expected: すべて通り、`tester.ts` を含めて `All files` の lines / statements / functions / branches が 90% 以上。

- [ ] **Step 10: コミットする**

```powershell
git add packages/circuit-sim/src/tester.ts packages/circuit-sim/src/index.ts packages/circuit-sim/test/tester-analog.test.ts
git commit -m @'
feat(circuit-sim): add analog needle model and range-exceeded hazard

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 3: `src/schema/faults.ts` — 故障定義のスキーマ

**Files:**
- Create: `packages/content/src/schema/faults.ts`
- Test: `packages/content/test/schema-faults.test.ts`

§7.5 の `faults`（明示リスト／ランダム）と §5.4 の故障種別を zod にする。

| 決めたこと | 内容 |
|---|---|
| 種別の源 | `FAULT_KINDS` は circuit-sim の `FaultKind`（§5.4 の9種）と `satisfies` で結び、種別が増えたらコンパイルエラーになるようにする |
| パラメータ | §5.4 の `param`（kind によって数値／端子IDと意味が変わる）は**JSONでは使わず**、`ohms`（`contact-resistive`）／`ratio`（`coil-layer-short`）／`to`（`wire-misrouted`）の名前付きフィールドに分ける。zodで検証できる形にするため（差分表 #2） |
| 対象の整合 | `wire-*` は `{wireId}`、それ以外は `{partId, elementIndex}` でなければスキーマエラー |
| 要素番号 | `elementIndex` は §5.4 のとおり数値だが、ソケット部品の並び（`[coil, b1, a1, …]`）を人が数えずに済むよう `SOCKET_COIL_ELEMENT_INDEX` / `socketContactElementIndex(group, contact)` / `LOAD_ELEMENT_INDEX` を公開する |
| ランダム | `{ random: { count, types, seed?, fallback } }`。`fallback` は §7.5 の「超過時は明示リストのフォールバックを使う」を成立させるため**必須**にした（差分表 #3） |

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/schema-faults.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FAULT_KINDS,
  FaultSpecSchema,
  FaultsSchema,
  isPartFaultKind,
  isWireFaultKind,
  LOAD_ELEMENT_INDEX,
  PART_FAULT_KINDS,
  RandomFaultsSchema,
  SOCKET_COIL_ELEMENT_INDEX,
  socketContactElementIndex,
  WIRE_FAULT_KINDS,
} from '../src/schema/faults.js';

describe('FAULT_KINDS', () => {
  it('lists the nine kinds of §5.4 and splits them into wire and part faults', () => {
    expect(FAULT_KINDS).toEqual([
      'wire-open',
      'wire-missing',
      'wire-misrouted',
      'contact-open',
      'contact-welded',
      'contact-resistive',
      'coil-open',
      'coil-layer-short',
      'lamp-open',
    ]);
    expect([...WIRE_FAULT_KINDS, ...PART_FAULT_KINDS].sort()).toEqual([...FAULT_KINDS].sort());
    expect(isWireFaultKind('wire-open')).toBe(true);
    expect(isWireFaultKind('coil-open')).toBe(false);
    expect(isPartFaultKind('coil-open')).toBe(true);
    expect(isPartFaultKind('wire-missing')).toBe(false);
  });
});

describe('socketContactElementIndex', () => {
  it('maps the socket element order [coil, b1, a1, b2, a2, ...]', () => {
    expect(SOCKET_COIL_ELEMENT_INDEX).toBe(0);
    expect(LOAD_ELEMENT_INDEX).toBe(0);
    expect(socketContactElementIndex(1, 'b')).toBe(1);
    expect(socketContactElementIndex(1, 'a')).toBe(2);
    expect(socketContactElementIndex(4, 'b')).toBe(7);
    expect(socketContactElementIndex(4, 'a')).toBe(8);
  });

  it('rejects a group outside 1..4', () => {
    expect(() => socketContactElementIndex(0, 'a')).toThrow(RangeError);
    expect(() => socketContactElementIndex(5, 'a')).toThrow(RangeError);
  });
});

describe('FaultSpecSchema', () => {
  it('accepts a plain wire break', () => {
    const parsed = FaultSpecSchema.safeParse({ target: { wireId: 'sw-005' }, kind: 'wire-open' });
    expect(parsed.success).toBe(true);
  });

  it('accepts a part fault addressed by element index', () => {
    const parsed = FaultSpecSchema.safeParse({
      target: { partId: 'CR1', elementIndex: 2 },
      kind: 'contact-welded',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a wire kind aimed at a part', () => {
    const parsed = FaultSpecSchema.safeParse({
      target: { partId: 'CR1', elementIndex: 0 },
      kind: 'wire-open',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain('電線');
  });

  it('rejects a part kind aimed at a wire', () => {
    const parsed = FaultSpecSchema.safeParse({ target: { wireId: 'sw-001' }, kind: 'coil-open' });
    expect(parsed.success).toBe(false);
  });

  it('requires the new terminal for a misrouted wire and forbids it elsewhere', () => {
    expect(
      FaultSpecSchema.safeParse({ target: { wireId: 'sw-002' }, kind: 'wire-misrouted' }).success,
    ).toBe(false);
    expect(
      FaultSpecSchema.safeParse({
        target: { wireId: 'sw-002' },
        kind: 'wire-misrouted',
        to: 'CR1.12',
      }).success,
    ).toBe(true);
    expect(
      FaultSpecSchema.safeParse({ target: { wireId: 'sw-002' }, kind: 'wire-open', to: 'CR1.12' })
        .success,
    ).toBe(false);
  });

  it('allows ohms only on contact-resistive and ratio only on coil-layer-short', () => {
    expect(
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 2 },
        kind: 'contact-resistive',
        ohms: 3000,
      }).success,
    ).toBe(true);
    expect(
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 2 },
        kind: 'contact-open',
        ohms: 3000,
      }).success,
    ).toBe(false);
    expect(
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 0 },
        kind: 'coil-layer-short',
        ratio: 0.65,
      }).success,
    ).toBe(true);
    expect(
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 0 },
        kind: 'coil-open',
        ratio: 0.65,
      }).success,
    ).toBe(false);
  });

  it('keeps the layer short ratio inside 0.4..0.85 (§5.1.3)', () => {
    const at = (ratio: number): boolean =>
      FaultSpecSchema.safeParse({
        target: { partId: 'CR1', elementIndex: 0 },
        kind: 'coil-layer-short',
        ratio,
      }).success;
    expect(at(0.4)).toBe(true);
    expect(at(0.85)).toBe(true);
    expect(at(0.39)).toBe(false);
    expect(at(0.86)).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      FaultSpecSchema.safeParse({ target: { wireId: 'sw-001' }, kind: 'wire-open', note: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('RandomFaultsSchema', () => {
  it('accepts a count, a type list, an optional seed and a mandatory fallback', () => {
    const parsed = RandomFaultsSchema.safeParse({
      count: 2,
      types: ['wire-open', 'wire-missing'],
      seed: 12345,
      fallback: [
        { target: { wireId: 'sw-001' }, kind: 'wire-open' },
        { target: { wireId: 'sw-002' }, kind: 'wire-missing' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a random block without a fallback list (§7.5)', () => {
    expect(
      RandomFaultsSchema.safeParse({ count: 2, types: ['wire-open'] }).success,
    ).toBe(false);
  });

  it('rejects a fallback whose length differs from count', () => {
    expect(
      RandomFaultsSchema.safeParse({
        count: 2,
        types: ['wire-open'],
        fallback: [{ target: { wireId: 'sw-001' }, kind: 'wire-open' }],
      }).success,
    ).toBe(false);
  });
});

describe('FaultsSchema', () => {
  it('accepts an explicit list', () => {
    const parsed = FaultsSchema.safeParse([
      { target: { wireId: 'sw-005' }, kind: 'wire-open' },
      { target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-welded' },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('accepts the random form', () => {
    const parsed = FaultsSchema.safeParse({
      random: {
        count: 1,
        types: ['wire-open'],
        fallback: [{ target: { wireId: 'sw-001' }, kind: 'wire-open' }],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty explicit list', () => {
    expect(FaultsSchema.safeParse([]).success).toBe(false);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-faults.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/schema/faults.js` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `src/schema/faults.ts` を書く**

`packages/content/src/schema/faults.ts`:

```ts
import { MAX_LAYER_SHORT_RATIO, MIN_LAYER_SHORT_RATIO, type FaultKind } from '@ojt/circuit-sim';
import { z } from 'zod';
import { TerminalIdSchema } from './common.js';

/**
 * 故障定義のスキーマ。設計仕様 §7.5 / §5.4。
 * 種別の集合は circuit-sim の `FaultKind` を唯一の源とし、`satisfies` で結んでおく
 * （エンジン側に種別が増えたらこのファイルがコンパイルエラーになる）。
 */

/** 故障の種別（§5.4 の9種）。 */
export const FAULT_KINDS = [
  'wire-open',
  'wire-missing',
  'wire-misrouted',
  'contact-open',
  'contact-welded',
  'contact-resistive',
  'coil-open',
  'coil-layer-short',
  'lamp-open',
] as const satisfies readonly FaultKind[];

/** 故障の種別。 */
export const FaultKindSchema = z.enum(FAULT_KINDS);

/** 電線を対象にする種別（断線・未配線・誤配線）。§5.4 */
export const WIRE_FAULT_KINDS = [
  'wire-open',
  'wire-missing',
  'wire-misrouted',
] as const satisfies readonly FaultKind[];

/** 部品の要素を対象にする種別。§5.4 */
export const PART_FAULT_KINDS = [
  'contact-open',
  'contact-welded',
  'contact-resistive',
  'coil-open',
  'coil-layer-short',
  'lamp-open',
] as const satisfies readonly FaultKind[];

/** その種別が電線を対象にするか。 */
export function isWireFaultKind(kind: FaultKind): boolean {
  return (WIRE_FAULT_KINDS as readonly FaultKind[]).includes(kind);
}

/** その種別が部品の要素を対象にするか。 */
export function isPartFaultKind(kind: FaultKind): boolean {
  return (PART_FAULT_KINDS as readonly FaultKind[]).includes(kind);
}

/**
 * ソケット部品（リレー／タイマ）のコイル要素の番号。§5.4 の `elementIndex`
 * （`createRelay4c()` / `createTimer4c()` は要素を `[coil, b1, a1, b2, a2, b3, a3, b4, a4]` の順に作る）
 */
export const SOCKET_COIL_ELEMENT_INDEX = 0;

/** ランプ／ブザーの負荷要素の番号（要素は1つだけ）。 */
export const LOAD_ELEMENT_INDEX = 0;

/**
 * ソケット部品の接点要素の番号。組は1〜4、`contact` は a（メーク）／b（ブレーク）。
 * 並びが `[coil, b1, a1, b2, a2, …]` なので b が `2k−1`、a が `2k` になる。§6.2
 */
export function socketContactElementIndex(group: number, contact: 'a' | 'b'): number {
  if (!Number.isInteger(group) || group < 1 || group > 4) {
    throw new RangeError(`接点の組は1〜4です: ${group}`);
  }
  return contact === 'a' ? group * 2 : group * 2 - 1;
}

/** 電線を指す故障の対象。§5.4 */
export const WireFaultTargetSchema = z.strictObject({
  wireId: z.string().min(1).describe('故障を入れる電線のID（課題の模範回路が生成する `sw-NNN`）。'),
});

/** 部品の要素を指す故障の対象。§5.4 */
export const PartFaultTargetSchema = z.strictObject({
  partId: z.string().min(1).describe('故障を入れる部品のID（`CR1` / `T1` / `PL1` など）。'),
  elementIndex: z
    .int()
    .min(0)
    .max(63)
    .describe('部品の要素番号。ソケットは 0=コイル、組kのb接点=2k−1、a接点=2k。'),
});

/** 故障の対象。§5.4 */
export const FaultTargetSchema = z.union([WireFaultTargetSchema, PartFaultTargetSchema]);

/** 故障の対象。 */
export type FaultTargetData = z.infer<typeof FaultTargetSchema>;

/**
 * 故障1件。§7.5
 * §5.4 の `param`（kind で意味が変わる `number | TerminalId`）は JSON では扱いにくいので、
 * `ohms` / `ratio` / `to` の名前付きフィールドに分け、kind との対応を refinement で縛る。
 */
export const FaultSpecSchema = z
  .strictObject({
    target: FaultTargetSchema.describe('故障を入れる場所（電線か、部品の要素）。'),
    kind: FaultKindSchema.describe('故障の種別。'),
    ohms: z
      .number()
      .positive()
      .max(1_000_000)
      .optional()
      .describe('`contact-resistive` の直列抵抗[Ω]。省略すると 500Ω。'),
    ratio: z
      .number()
      .min(MIN_LAYER_SHORT_RATIO)
      .max(MAX_LAYER_SHORT_RATIO)
      .optional()
      .describe('`coil-layer-short` のコイル抵抗の低下率。省略すると 0.65。'),
    to: TerminalIdSchema.optional().describe('`wire-misrouted` で片端を付け替える先の端子ID。'),
  })
  .superRefine((spec, ctx) => {
    const wireTarget = 'wireId' in spec.target;
    if (isWireFaultKind(spec.kind) && !wireTarget) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: `${spec.kind} は電線の故障なので target は { wireId } にします`,
      });
    }
    if (isPartFaultKind(spec.kind) && wireTarget) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: `${spec.kind} は部品の故障なので target は { partId, elementIndex } にします`,
      });
    }
    if (spec.ohms !== undefined && spec.kind !== 'contact-resistive') {
      ctx.addIssue({
        code: 'custom',
        path: ['ohms'],
        message: 'ohms は contact-resistive にだけ指定できます',
      });
    }
    if (spec.ratio !== undefined && spec.kind !== 'coil-layer-short') {
      ctx.addIssue({
        code: 'custom',
        path: ['ratio'],
        message: 'ratio は coil-layer-short にだけ指定できます',
      });
    }
    if (spec.kind === 'wire-misrouted' && spec.to === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'wire-misrouted には付け替え先の端子ID（to）が必要です',
      });
    }
    if (spec.kind !== 'wire-misrouted' && spec.to !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to は wire-misrouted にだけ指定できます',
      });
    }
  });

/** 故障1件。 */
export type FaultSpecData = z.infer<typeof FaultSpecSchema>;

/**
 * ランダム故障の指定。§7.5
 * `seed` を省略すると課題開始ごとに新しい乱数を使う。`fallback` は「100回引き直しても条件を
 * 満たす組合せが作れなかったときに使う明示リスト」で、§7.5 が要求するフォールバックを
 * データとして必ず持たせるため**必須**にしてある（長さは `count` と同じ）。
 */
export const RandomFaultsSchema = z
  .strictObject({
    count: z.int().min(1).max(8).describe('注入する故障の数。'),
    types: z.array(FaultKindSchema).min(1).describe('選んでよい故障の種別。'),
    seed: z.int().min(0).optional().describe('省略すると課題開始ごとに新しい乱数を使います。'),
    fallback: z
      .array(FaultSpecSchema)
      .min(1)
      .describe('引き直しの上限に達したときに使う明示リスト（要素数は count と同じ）。'),
  })
  .superRefine((random, ctx) => {
    if (random.fallback.length !== random.count) {
      ctx.addIssue({
        code: 'custom',
        path: ['fallback'],
        message: `フォールバックの件数（${random.fallback.length}）は count（${random.count}）と同じにします`,
      });
    }
  });

/** ランダム故障の指定。 */
export type RandomFaultsData = z.infer<typeof RandomFaultsSchema>;

/** 課題の `faults`（明示リストまたはランダム）。§7.5 */
export const FaultsSchema = z.union([
  z.array(FaultSpecSchema).min(1),
  z.strictObject({ random: RandomFaultsSchema }),
]);

/** 課題の `faults`。 */
export type FaultsData = z.infer<typeof FaultsSchema>;

/** `faults` がランダム指定か。 */
export function isRandomFaults(faults: FaultsData): faults is { random: RandomFaultsData } {
  return !Array.isArray(faults);
}
```

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-faults.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  17 passed (17)`。

- [ ] **Step 5: コミットする**

```powershell
git add packages/content/src/schema/faults.ts packages/content/test/schema-faults.test.ts
git commit -m @'
feat(content): add fault definition schema for inspect problems

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 4: `src/faults.ts` — 故障の適用と「故障の在処」

**Files:**
- Create: `packages/content/src/faults.ts`
- Test: `packages/content/test/faults.test.ts`

**設計の要**: 3Dの盤は「配線されているとおり」を描き、シミュレーションだけが故障を見る。そのために故障を2つに振り分ける。

| 種別 | どこに載せるか | 3Dでの見え方 |
|---|---|---|
| `wire-open`（断線） | **盤セッションの電線**に `open = true` を立てる。`toNetlist()` は `{...w}` でフィールドをそのまま写すので、ネットリスト側では導通しない | 電線は見える（圧着端子が残っている。§5.4） |
| `wire-missing`（未配線） | **盤セッションから電線を取り除く** | 電線が無い |
| `wire-misrouted`（誤配線） | **盤セッションの電線の片端（`to`）を付け替える** | 電線が誤った端子へ伸びている |
| 接点・コイル・ランプの故障 | セッションには載せられない（`MountedPart` は故障を持たない）。**ネットリストへ変換するたびに `injectFault()` で注入し直す** | 見た目は正常な部品。テスターでしか分からない |

部品交換（§9.2）は `withoutPartFaults()` でその部品の故障を捨てることで表す。以後の `toNetlist()` では注入されないので、良品に差し替えたのと同じになる。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/faults.test.ts`:

```ts
import { JIPM_BOARD, toNetlist } from '@ojt/board-model';
import { findPart, loadOhms } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { applyFaults, faultParam, injectPartFaults, matchesSite, withoutPartFaults } from '../src/faults.js';
import { buildReferenceSession } from '../src/reference.js';
import type { FaultSpecData } from '../src/schema/faults.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

/** 自己保持回路の模範セッション（`sw-001`〜`sw-009` と既設の青線3本を持つ）。 */
function session() {
  const built = buildReferenceSession(parseOrThrow(selfHoldProblemJson()), JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value.session;
}

describe('applyFaults (wire faults)', () => {
  it('keeps a broken wire on the board but opens it electrically (§5.4)', () => {
    const board = session();
    const applied = applyFaults(board, [{ target: { wireId: 'sw-005' }, kind: 'wire-open' }]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const wire = board.wires.find((w) => w.id === 'sw-005');
    expect(wire?.open).toBe(true);
    expect(applied.value.wireFaults).toHaveLength(1);
    expect(applied.value.partFaults).toHaveLength(0);
  });

  it('removes an unwired connection from the board entirely', () => {
    const board = session();
    const before = board.wires.length;
    const applied = applyFaults(board, [{ target: { wireId: 'sw-009' }, kind: 'wire-missing' }]);
    expect(applied.ok).toBe(true);
    expect(board.wires).toHaveLength(before - 1);
    expect(board.wires.some((w) => w.id === 'sw-009')).toBe(false);
  });

  it('moves one end of a misrouted wire', () => {
    const board = session();
    const applied = applyFaults(board, [
      { target: { wireId: 'sw-002' }, kind: 'wire-misrouted', to: 'CR1.12' },
    ]);
    expect(applied.ok).toBe(true);
    const wire = board.wires.find((w) => w.id === 'sw-002');
    expect(wire?.from).toBe('TB_PB.2c');
    expect(wire?.to).toBe('CR1.12');
  });

  it('records the original endpoints as the fault site even for a missing wire (§9.2)', () => {
    const board = session();
    const applied = applyFaults(board, [{ target: { wireId: 'sw-009' }, kind: 'wire-missing' }]);
    if (!applied.ok) return;
    const site = applied.value.sites[0];
    expect(site?.kind).toBe('wire-missing');
    expect(site?.report).toBe('wire-missing');
    expect(site?.terminals).toEqual(['CR1.6', 'TB_PL.1+']);
  });

  it('reports an unknown wire as a problem issue (§13 #2)', () => {
    const applied = applyFaults(session(), [{ target: { wireId: 'sw-999' }, kind: 'wire-open' }]);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.errors[0]?.path).toBe('faults[0].target.wireId');
    expect(applied.errors[0]?.message).toContain('sw-999');
  });

  it('refuses to fault the pre-installed check circuit wiring (§6.3)', () => {
    const applied = applyFaults(session(), [{ target: { wireId: 'fw-chk-2' }, kind: 'wire-open' }]);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.errors[0]?.message).toContain('既設配線');
  });

  it('refuses a misrouting that would put three wires on one terminal (§6.6)', () => {
    const applied = applyFaults(session(), [
      { target: { wireId: 'sw-002' }, kind: 'wire-misrouted', to: 'CR1.13' },
    ]);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.errors[0]?.message).toContain('2本');
  });
});

describe('applyFaults (part faults)', () => {
  it('leaves the board untouched and collects the fault for the netlist', () => {
    const board = session();
    const before = board.wires.map((w) => `${w.id}:${w.from}-${w.to}:${String(w.open)}`);
    const applied = applyFaults(board, [
      { target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-welded' },
    ]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(board.wires.map((w) => `${w.id}:${w.from}-${w.to}:${String(w.open)}`)).toEqual(before);
    expect(applied.value.partFaults).toHaveLength(1);
    expect(applied.value.sites[0]?.report).toBe('part-defect');
    expect(applied.value.sites[0]?.partId).toBe('CR1');
  });
});

describe('faultParam', () => {
  it('fills in the engine defaults for ohms and ratio (§5.4)', () => {
    expect(faultParam({ target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-resistive' })).toBe(500);
    expect(faultParam({ target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-resistive', ohms: 3000 })).toBe(3000);
    expect(faultParam({ target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-layer-short' })).toBe(0.65);
    expect(faultParam({ target: { wireId: 'sw-002' }, kind: 'wire-misrouted', to: 'CR1.12' })).toBe('CR1.12');
    expect(faultParam({ target: { wireId: 'sw-002' }, kind: 'wire-open' })).toBeUndefined();
  });
});

describe('injectPartFaults', () => {
  it('drops the coil resistance of a layer short to 422.5 ohms (§5.1.3)', () => {
    const board = session();
    const netlist = toNetlist(board, JIPM_BOARD);
    const faults: FaultSpecData[] = [
      { target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-layer-short', ratio: 0.65 },
    ];
    expect(injectPartFaults(netlist, faults)).toEqual([]);
    const coil = findPart(netlist, 'CR1')?.elements[0];
    expect(coil?.kind).toBe('load');
    expect(coil !== undefined && coil.kind === 'load' ? loadOhms(coil) : 0).toBeCloseTo(422.5, 3);
  });

  it('turns an engine FaultError into a problem issue', () => {
    const netlist = toNetlist(session(), JIPM_BOARD);
    const issues = injectPartFaults(netlist, [
      { target: { partId: 'CR9', elementIndex: 0 }, kind: 'coil-open' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('faults[0].target');
    expect(issues[0]?.message).toContain('CR9');
  });
});

describe('withoutPartFaults', () => {
  it('drops the faults of the replaced part only (§9.2 部品交換)', () => {
    const board = session();
    const applied = applyFaults(board, [
      { target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-open' },
      { target: { partId: 'CR2', elementIndex: 0 }, kind: 'coil-open' },
    ]);
    if (!applied.ok) return;
    const replaced = withoutPartFaults(applied.value, 'CR1');
    expect(replaced.partFaults).toHaveLength(1);
    expect(replaced.partFaults[0]?.target).toEqual({ partId: 'CR2', elementIndex: 0 });
    // 交換しても「その部品が不良だった」事実は残す（指摘の対象からは消さない。§9.2 判定①）
    expect(replaced.sites).toHaveLength(2);
    expect(replaced.sites.map((s) => s.partId)).toEqual(['CR1', 'CR2']);
  });
});

describe('matchesSite', () => {
  it('matches a broken wire only when the wire and the kind both agree (§9.2)', () => {
    const board = session();
    const applied = applyFaults(board, [{ target: { wireId: 'sw-005' }, kind: 'wire-open' }]);
    if (!applied.ok) return;
    const site = applied.value.sites[0];
    if (site === undefined) return;
    expect(matchesSite(site, { target: { wireId: 'sw-005' }, kind: 'wire-open' })).toBe(true);
    expect(matchesSite(site, { target: { wireId: 'sw-005' }, kind: 'wire-missing' })).toBe(false);
    expect(matchesSite(site, { target: { wireId: 'sw-004' }, kind: 'wire-open' })).toBe(false);
  });

  it('matches a missing wire by either of its terminals', () => {
    const board = session();
    const applied = applyFaults(board, [{ target: { wireId: 'sw-009' }, kind: 'wire-missing' }]);
    if (!applied.ok) return;
    const site = applied.value.sites[0];
    if (site === undefined) return;
    expect(matchesSite(site, { target: { terminalId: 'CR1.6' }, kind: 'wire-missing' })).toBe(true);
    expect(matchesSite(site, { target: { terminalId: 'TB_PL.1+' }, kind: 'wire-missing' })).toBe(true);
    expect(matchesSite(site, { target: { terminalId: 'CR1.5' }, kind: 'wire-missing' })).toBe(false);
  });

  it('matches a part fault by the part and the 部品不良 kind', () => {
    const board = session();
    const applied = applyFaults(board, [
      { target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-welded' },
    ]);
    if (!applied.ok) return;
    const site = applied.value.sites[0];
    if (site === undefined) return;
    expect(matchesSite(site, { target: { partId: 'CR1' }, kind: 'part-defect' })).toBe(true);
    expect(matchesSite(site, { target: { partId: 'CR2' }, kind: 'part-defect' })).toBe(false);
    expect(matchesSite(site, { target: { partId: 'CR1' }, kind: 'wire-open' })).toBe(false);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/faults.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/faults.js` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `src/faults.ts` を書く**

`packages/content/src/faults.ts`:

```ts
import { wireCountAtTerminal, type BoardSession } from '@ojt/board-model';
import {
  DEFAULT_CONTACT_RESISTIVE_OHMS,
  DEFAULT_LAYER_SHORT_RATIO,
  FaultError,
  injectFault,
  MAX_WIRES_PER_TERMINAL,
  toTerminalId,
  type FaultKind,
  type FaultTarget,
  type Netlist,
  type TerminalId,
} from '@ojt/circuit-sim';
import { isWireFaultKind, type FaultSpecData } from './schema/faults.js';
import type { ProblemIssue } from './schema/index.js';

/**
 * 故障の適用。設計仕様 §5.4 / §9.2。
 *
 * 3D盤は「配線されているとおり」を描き、シミュレーションだけが故障を見る。そのため故障を
 * **盤セッションに載るもの**（電線の断線・未配線・誤配線）と、**ネットリストへ変換するたびに
 * 注入し直すもの**（接点・コイル・ランプ）に振り分ける。前者は `toNetlist()` が
 * `{ ...wire }` でフィールドをそのまま写すので、`open` を立てるだけで電気的に切れる。
 * 後者は `MountedPart` に故障を持たせる場所が無いため、変換のたびに `injectFault()` を通す。
 */

/** 訓練者が3D盤の上で選べる指摘の種別（断線／未配線／誤配線／部品不良）。§9.2 / 決定事項#11 */
export type FaultReportKind = 'wire-open' | 'wire-missing' | 'wire-misrouted' | 'part-defect';

/** 故障1件の「盤の上での在処」。訓練者の指摘との突き合わせに使う。§9.2 */
export interface FaultSite {
  /** 注入した故障の種別（§5.4）。 */
  kind: FaultKind;
  /** 訓練者が選ぶべき指摘の種別（§9.2 の4択）。 */
  report: FaultReportKind;
  /** 電線の故障のときの電線ID（`wire-missing` は取り除かれた電線のID）。 */
  wireId: string | undefined;
  /** 部品の故障のときの部品ID。 */
  partId: string | undefined;
  /** 指摘として受け付ける端子（電線の故障のときの両端）。 */
  terminals: readonly TerminalId[];
}

/** 振り分けた故障。 */
export interface AppliedFaults {
  /** 盤セッションに適用済みの電線の故障。 */
  wireFaults: readonly FaultSpecData[];
  /** ネットリストへ変換するたびに注入する部品の故障。 */
  partFaults: readonly FaultSpecData[];
  /** 故障の在処。`sites` の並び順は課題の `faults` と同じ（`wireFaults` / `partFaults` は種別ごとの部分列）。 */
  sites: readonly FaultSite[];
}

/** 適用結果（課題データの誤りは `ProblemIssue` で返す。§13 #2）。 */
export type ApplyFaultsResult =
  { ok: true; value: AppliedFaults } | { ok: false; errors: ProblemIssue[] };

/** 訓練者の指摘1件。3D盤の上で電線・端子・部品をクリックして種別を選ぶ。§9.2 */
export interface FaultReport {
  target: { wireId: string } | { partId: string } | { terminalId: string };
  kind: FaultReportKind;
}

/** 注入した種別から、訓練者が選ぶべき指摘の種別を決める。部品の故障はすべて「部品不良」。§9.2 */
export function reportKindOf(kind: FaultKind): FaultReportKind {
  if (kind === 'wire-open' || kind === 'wire-missing' || kind === 'wire-misrouted') return kind;
  return 'part-defect';
}

/** `injectFault()` に渡す `param` を作る。§5.4 */
export function faultParam(spec: FaultSpecData): number | TerminalId | undefined {
  if (spec.kind === 'contact-resistive') return spec.ohms ?? DEFAULT_CONTACT_RESISTIVE_OHMS;
  if (spec.kind === 'coil-layer-short') return spec.ratio ?? DEFAULT_LAYER_SHORT_RATIO;
  if (spec.kind === 'wire-misrouted') {
    return spec.to === undefined ? undefined : toTerminalId(spec.to);
  }
  return undefined;
}

/** `FaultSpecData.target` を circuit-sim の `FaultTarget` に直す。 */
function toEngineTarget(target: FaultSpecData['target']): FaultTarget {
  return 'wireId' in target
    ? { wireId: target.wireId }
    : { partId: target.partId, elementIndex: target.elementIndex };
}

/**
 * 課題の故障を盤セッションへ適用し、部品の故障は注入用に取り分ける。§5.4 / §9.2
 * セッションの電線配列は**その場で書き換える**（呼び出し側は初期盤を作った直後に呼ぶこと）。
 * 課題データの誤り（存在しない電線ID・既設配線の指定・1端子2本の超過）は `ok: false` で返す。
 * 検証は `faults` を先頭から適用しながら行い、事前の一括検証はしない。そのため `ok: false` が
 * 返ったときも、それより前の故障はすでにセッションへ反映済みである。呼び出し側は `ok: false` を
 * 「このセッションはもう使わない」の合図として扱うこと（作り直した初期盤に対してやり直す）。
 */
export function applyFaults(
  session: BoardSession,
  faults: readonly FaultSpecData[],
): ApplyFaultsResult {
  const errors: ProblemIssue[] = [];
  const wireFaults: FaultSpecData[] = [];
  const partFaults: FaultSpecData[] = [];
  const sites: FaultSite[] = [];

  faults.forEach((spec, index) => {
    const report = reportKindOf(spec.kind);
    if (!isWireFaultKind(spec.kind)) {
      const target = spec.target;
      /* c8 ignore next -- スキーマが wireId ターゲットに部品系 kind を許さないため到達しない */
      if ('wireId' in target) return; // スキーマが弾くので到達しないが型のための番人
      partFaults.push(spec);
      sites.push({ kind: spec.kind, report, wireId: undefined, partId: target.partId, terminals: [] });
      return;
    }
    const target = spec.target;
    /* c8 ignore next -- 同上、スキーマが弾くため到達しない */
    if (!('wireId' in target)) return; // 同上
    const position = session.wires.findIndex((w) => w.id === target.wireId);
    const wire = position < 0 ? undefined : session.wires[position];
    if (wire === undefined) {
      errors.push({
        path: `faults[${index}].target.wireId`,
        message: `故障を入れる電線が盤にありません: ${target.wireId}`,
      });
      return;
    }
    if (wire.locked) {
      errors.push({
        path: `faults[${index}].target.wireId`,
        message: `チェック用回路の既設配線には故障を入れられません: ${target.wireId}`,
      });
      return;
    }
    const terminals: readonly TerminalId[] = [wire.from, wire.to];
    if (spec.kind === 'wire-open') {
      wire.open = true;
    } else if (spec.kind === 'wire-missing') {
      session.wires.splice(position, 1);
    } else {
      const to = spec.to === undefined ? undefined : toTerminalId(spec.to);
      /* c8 ignore next -- スキーマが to を必須にしているため到達しない */
      if (to === undefined) return; // スキーマが必須にしている
      if (wireCountAtTerminal(session, to) + 1 > MAX_WIRES_PER_TERMINAL) {
        errors.push({
          path: `faults[${index}].to`,
          message: `誤配線の付け替え先 ${to} は1端子${MAX_WIRES_PER_TERMINAL}本の上限を超えます`,
        });
        return;
      }
      wire.to = to;
    }
    wireFaults.push(spec);
    sites.push({ kind: spec.kind, report, wireId: wire.id, partId: undefined, terminals });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { wireFaults, partFaults, sites } };
}

/**
 * 部品の故障をネットリストへ注入する。§5.4
 * エンジンの `FaultError`（存在しない部品・要素、種別と要素の不一致）は課題データの誤りなので
 * `ProblemIssue` に変換して返す（例外にしない。§13 #2）。
 */
export function injectPartFaults(
  netlist: Netlist,
  partFaults: readonly FaultSpecData[],
): ProblemIssue[] {
  const issues: ProblemIssue[] = [];
  partFaults.forEach((spec, index) => {
    try {
      injectFault(netlist, toEngineTarget(spec.target), spec.kind, faultParam(spec));
    } catch (error) {
      if (!(error instanceof FaultError)) throw error;
      issues.push({ path: `faults[${index}].target`, message: error.message });
    }
  });
  return issues;
}

/**
 * その部品の故障を取り消した `AppliedFaults` を返す（部品交換。§9.2）。
 * 良品に差し替えたのと同じで、以後 `injectPartFaults()` はその部品に触れない。
 *
 * **`sites` は減らさない。** 部品を交換しても「その部品が不良だった」という事実は消えず、
 * 訓練者はその部品を指摘しなければ合格しない（§9.2 判定①「全故障を過不足なく指摘」）。
 * 交換で変わるのは電気的な挙動（＝ネットリストへの注入）だけである。
 */
export function withoutPartFaults(applied: AppliedFaults, partId: string): AppliedFaults {
  const keep = (spec: FaultSpecData): boolean =>
    'wireId' in spec.target || spec.target.partId !== partId;
  return {
    wireFaults: applied.wireFaults,
    partFaults: applied.partFaults.filter(keep),
    sites: applied.sites,
  };
}

/**
 * その指摘がその故障を言い当てているか。§9.2
 * - 断線・誤配線: 盤の上に電線が残っているので**電線**をクリックして種別を選ぶ
 * - 未配線: 電線が無いので**端子**をクリックする（取り除かれた電線の両端のどちらでもよい）
 * - 部品不良: **部品**をクリックして「部品不良」を選ぶ（どの要素かは問わない）
 */
export function matchesSite(site: FaultSite, report: FaultReport): boolean {
  if (report.kind !== site.report) return false;
  if ('wireId' in report.target) {
    return site.kind !== 'wire-missing' && site.wireId === report.target.wireId;
  }
  if ('partId' in report.target) {
    return site.partId !== undefined && site.partId === report.target.partId;
  }
  const terminalId: string = report.target.terminalId;
  return site.kind === 'wire-missing' && site.terminals.some((t) => t === terminalId);
}
```

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/faults.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  15 passed (15)`。

- [ ] **Step 5: コミットする**

```powershell
git add packages/content/src/faults.ts packages/content/test/faults.test.ts
git commit -m @'
feat(content): apply problem faults to board session and netlist

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 5: `src/schema/inspect-parts.ts` — モードC1課題のスキーマ

**Files:**
- Create: `packages/content/src/schema/inspect-parts.ts`
- Create: `packages/content/test/helpers/inspect.ts`
- Test: `packages/content/test/schema-inspect-parts.test.ts`

§7.5 の「モードC1（部品点検）は別形式」を実装する。

| フィールド | 内容 | 根拠 |
|---|---|---|
| `parts[]` | `{ id, kind, truth, ratio?, group? }`。トレイに並ぶ部品（2〜8個） | §7.5 / §9.1 |
| `truth` | `normal` ＋ 不良6種（`coil-open` / `coil-layer-short` / `a-open` / `a-weld` / `b-open` / `b-weld`） | §7.5 / 調査資料 §6.2 |
| `ratio` | `coil-layer-short` のときだけ。0.4〜0.85 | §5.1.3 |
| `group` | 接点系の `truth` のときだけ。1〜4。省略すると `seed` と部品IDから決める | §7.5「組の選択」 |
| `seed` | 接点組の選択に使う。既定0 | §7.5 |
| 禁止 | タイマに `coil-layer-short` は指定できない | §17.2 #6 |

`inventory` は空配列でよい（C1でトレイに出る部品は `inventory` ではなく `parts` が決める）。`board.socketRoles` はチェック用ソケットだけを割り当てた `{ "S7": "CHK" }` で足りる（`validateSocketRoles()` は `CHK` が `S7` にあることだけを要求する）。

- [ ] **Step 1: テスト用の課題JSONの骨組みを作る**

`packages/content/test/helpers/inspect.ts`:

```ts
import {
  InspectPartsProblemSchema,
  type InspectPartsProblem,
} from '../../src/schema/inspect-parts.js';

/**
 * C1/C2のテスト用課題JSONの骨組み。呼ぶたびに新しいオブジェクトを返す
 * （共有の定数にすると、1つのテストの書き換えが他のテストの土台まで壊す）。
 */

/** チェック用ソケットだけを割り当てた盤指定。§9.1 */
export function checkOnlyRoles(): Record<string, string> {
  return { S7: 'CHK' };
}

/** モードC1の最小課題（正常1・コイル断線1・レアショート1・a接点溶着1）。 */
export function inspectPartsProblemJson(): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'x-c1',
    mode: 'inspect-parts',
    title: 'テスト用 部品点検',
    grade: 2,
    description: 'テスト用',
    timeLimit: { standardMin: 30, cutoffMin: 50 },
    board: { boardId: 'board-jipm-std', socketRoles: checkOnlyRoles() },
    inventory: [],
    parts: [
      { id: 'p1', kind: 'relay-my4n', truth: 'normal' },
      { id: 'p2', kind: 'relay-my4n', truth: 'coil-open' },
      { id: 'p3', kind: 'relay-my4n', truth: 'coil-layer-short', ratio: 0.65 },
      { id: 'p4', kind: 'timer-h3y4', truth: 'a-weld', group: 1 },
    ],
    seed: 20260914,
  };
}

/** 課題JSONを検証済みのC1課題にする（失敗したら即エラーにする）。 */
export function parseInspectPartsOrThrow(json: unknown): InspectPartsProblem {
  const parsed = InspectPartsProblemSchema.safeParse(json);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
  return parsed.data;
}
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/content/test/schema-inspect-parts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CONTACT_TRUTHS,
  InspectPartSchema,
  InspectPartsProblemSchema,
  isContactTruth,
  PART_TRUTHS,
} from '../src/schema/inspect-parts.js';
import { inspectPartsProblemJson } from './helpers/inspect.js';

describe('PART_TRUTHS', () => {
  it('lists normal plus the six defects of the answer sheet', () => {
    expect(PART_TRUTHS).toEqual([
      'normal',
      'coil-open',
      'coil-layer-short',
      'a-open',
      'a-weld',
      'b-open',
      'b-weld',
    ]);
    expect(CONTACT_TRUTHS).toEqual(['a-open', 'a-weld', 'b-open', 'b-weld']);
    expect(isContactTruth('a-weld')).toBe(true);
    expect(isContactTruth('coil-open')).toBe(false);
  });
});

describe('InspectPartSchema', () => {
  it('accepts a healthy relay', () => {
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'normal' }).success,
    ).toBe(true);
  });

  it('allows ratio only on a layer short', () => {
    expect(
      InspectPartSchema.safeParse({
        id: 'p1',
        kind: 'relay-my4n',
        truth: 'coil-layer-short',
        ratio: 0.5,
      }).success,
    ).toBe(true);
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'coil-open', ratio: 0.5 })
        .success,
    ).toBe(false);
  });

  it('refuses a layer short on a timer', () => {
    const parsed = InspectPartSchema.safeParse({
      id: 'p1',
      kind: 'timer-h3y4',
      truth: 'coil-layer-short',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain('タイマ');
  });

  it('allows group only on a contact defect and keeps it inside 1..4', () => {
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'a-open', group: 3 })
        .success,
    ).toBe(true);
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'normal', group: 3 })
        .success,
    ).toBe(false);
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'a-open', group: 5 })
        .success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      InspectPartSchema.safeParse({ id: 'p1', kind: 'relay-my4n', truth: 'normal', note: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('InspectPartsProblemSchema', () => {
  it('accepts the sample set', () => {
    const parsed = InspectPartsProblemSchema.safeParse(inspectPartsProblemJson());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.mode).toBe('inspect-parts');
    expect(parsed.data.parts).toHaveLength(4);
    expect(parsed.data.seed).toBe(20260914);
  });

  it('defaults the seed to 0', () => {
    const json = inspectPartsProblemJson();
    delete json['seed'];
    const parsed = InspectPartsProblemSchema.safeParse(json);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.seed).toBe(0);
  });

  it('rejects duplicate part ids', () => {
    const json = inspectPartsProblemJson();
    json['parts'] = [
      { id: 'p1', kind: 'relay-my4n', truth: 'normal' },
      { id: 'p1', kind: 'relay-my4n', truth: 'coil-open' },
    ];
    const parsed = InspectPartsProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.message.includes('p1'))).toBe(true);
  });

  it('needs at least two parts', () => {
    const json = inspectPartsProblemJson();
    json['parts'] = [{ id: 'p1', kind: 'relay-my4n', truth: 'normal' }];
    expect(InspectPartsProblemSchema.safeParse(json).success).toBe(false);
  });

  it('requires the check socket in the board roles', () => {
    const json = inspectPartsProblemJson();
    json['board'] = { boardId: 'board-jipm-std', socketRoles: { S1: 'CR1' } };
    const parsed = InspectPartsProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.message.includes('CHK'))).toBe(true);
  });
});
```

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-inspect-parts.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/schema/inspect-parts.js` で `Test Files  1 failed (1)`。

- [ ] **Step 4: `src/schema/inspect-parts.ts` を書く**

`packages/content/src/schema/inspect-parts.ts`:

```ts
import { MAX_LAYER_SHORT_RATIO, MIN_LAYER_SHORT_RATIO } from '@ojt/circuit-sim';
import { z } from 'zod';
import { MountableKindSchema, ProblemHeaderShape } from './common.js';

/**
 * モードC1（部品点検）の課題。設計仕様 §7.5 の「モードC1は別形式」/ §9.1。
 * トレイに並ぶ部品それぞれに「本当の状態」（`truth`）を持たせ、訓練者はチェック用ソケットに
 * 挿して点検し、マークシート風パネルで原因を答える。
 */

/** 部品の本当の状態。正常＋不良6種（調査資料 §6.2 の解答様式と同じ集合）。§7.5 */
export const PART_TRUTHS = [
  'normal',
  'coil-open',
  'coil-layer-short',
  'a-open',
  'a-weld',
  'b-open',
  'b-weld',
] as const;

/** 部品の本当の状態。 */
export const PartTruthSchema = z.enum(PART_TRUTHS);

/** 部品の本当の状態。 */
export type PartTruth = z.infer<typeof PartTruthSchema>;

/** 接点に入れる不良（どの接点組に入れるかを `group` で選べる）。§7.5 */
export const CONTACT_TRUTHS = [
  'a-open',
  'a-weld',
  'b-open',
  'b-weld',
] as const satisfies readonly PartTruth[];

/** その `truth` が接点の不良か。 */
export function isContactTruth(truth: PartTruth): boolean {
  return (CONTACT_TRUTHS as readonly PartTruth[]).includes(truth);
}

/** トレイに並ぶ部品1個。§7.5 */
export const InspectPartSchema = z
  .strictObject({
    id: z.string().min(1).describe('部品の識別子（課題の中で一意）。マークシートの行になります。'),
    kind: MountableKindSchema.describe('部品種別（リレーかタイマ）。'),
    truth: PartTruthSchema.describe('その部品の本当の状態。訓練者の解答と突き合わせます。'),
    ratio: z
      .number()
      .min(MIN_LAYER_SHORT_RATIO)
      .max(MAX_LAYER_SHORT_RATIO)
      .optional()
      .describe('レアショートのコイル抵抗の低下率（省略すると 0.65）。'),
    group: z
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe('接点の不良を入れる組（1〜4）。省略すると課題の seed と部品IDから決めます。'),
  })
  .superRefine((part, ctx) => {
    if (part.ratio !== undefined && part.truth !== 'coil-layer-short') {
      ctx.addIssue({
        code: 'custom',
        path: ['ratio'],
        message: 'ratio は truth が coil-layer-short のときだけ指定できます',
      });
    }
    if (part.truth === 'coil-layer-short' && part.kind === 'timer-h3y4') {
      ctx.addIssue({
        code: 'custom',
        path: ['truth'],
        message: 'タイマにレアショートは出題できません（リレーにだけ出題します）',
      });
    }
    if (part.group !== undefined && !isContactTruth(part.truth)) {
      ctx.addIssue({
        code: 'custom',
        path: ['group'],
        message: 'group は接点の不良（a-open / a-weld / b-open / b-weld）のときだけ指定できます',
      });
    }
  });

/** トレイに並ぶ部品1個。 */
export type InspectPartData = z.infer<typeof InspectPartSchema>;

/**
 * モードC1課題。§7.5 / §9.1
 * `inventory` は空配列でよい（トレイの中身は `parts` が決める）。盤は
 * チェック用ソケット（`S7` = `CHK`）さえ割り当ててあれば足りる。
 */
export const InspectPartsProblemSchema = z
  .strictObject({
    ...ProblemHeaderShape,
    mode: z.literal('inspect-parts').describe('課題モード。部品点検は `inspect-parts`。'),
    parts: z
      .array(InspectPartSchema)
      .min(2)
      .max(8)
      .describe('トレイに並ぶ部品（2〜8個）。正常と不良を混ぜます。'),
    seed: z
      .int()
      .min(0)
      .default(0)
      .describe('接点の不良をどの組に入れるかを決める種。同じ種からは必ず同じ組になります。'),
  })
  .superRefine((problem, ctx) => {
    const seen = new Set<string>();
    problem.parts.forEach((part, index) => {
      if (seen.has(part.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', index, 'id'],
          message: `部品IDが重複しています: ${part.id}`,
        });
      }
      seen.add(part.id);
    });
  });

/** モードC1課題。 */
export type InspectPartsProblem = z.infer<typeof InspectPartsProblemSchema>;
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-inspect-parts.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  11 passed (11)`。

- [ ] **Step 6: コミットする**

```powershell
git add packages/content/src/schema/inspect-parts.ts packages/content/test/helpers/inspect.ts packages/content/test/schema-inspect-parts.test.ts
git commit -m @'
feat(content): add mode C1 inspect-parts problem schema

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 6: `src/schema/inspect-repair.ts` — モードC2課題のスキーマ

**Files:**
- Create: `packages/content/src/schema/inspect-repair.ts`
- Modify: `packages/content/test/helpers/inspect.ts`
- Test: `packages/content/test/schema-inspect-repair.test.ts`

モードC2は「モードB課題 ＋ `faults`」である。回路図（`schematic`）は**模範回路**でもあり、2級形式では訓練者に**提示する回路図**にもなる（§9.2）。

| フィールド | 内容 | 根拠 |
|---|---|---|
| `schematic` / `physicalOverride` | 基準になる回路（＝正解）。ここから初期配線を生成し、`faults` を注入する | §7.2 / §9.2 |
| `faults` | 明示リストまたはランダム（Task 3 の `FaultsSchema`） | §7.5 |
| `operations` / `durationMs` / `judge` | モードBと同じ（修復後の動作比較に使う） | §7.3 / §7.4 |
| `hints.schematicVisible` | **2級形式は true（回路図＋タイムチャート）、1級形式は false（タイムチャートのみ）** | §9.2 / 調査資料 §1.1 |
| `grade` | 1 または 2 のみ（対象級。C2に3級形式は無い） | §1.2 |

- [ ] **Step 1: テスト用の課題JSONの骨組みを足す**

`packages/content/test/helpers/inspect.ts` の先頭の import を次に差し替える:

```ts
import {
  InspectPartsProblemSchema,
  type InspectPartsProblem,
} from '../../src/schema/inspect-parts.js';
import {
  InspectRepairProblemSchema,
  type InspectRepairProblem,
} from '../../src/schema/inspect-repair.js';
import { selfHoldProblemJson } from './problems.js';
```

同ファイルの末尾に次を追記する:

```ts
/**
 * モードC2の最小課題。自己保持回路（`test/helpers/problems.ts` と同じ回路図）に
 * 「起動接点→コイルの断線」と「ランプ供給線の未配線」の2箇所を入れてある。
 * 電線IDは回路図から生成される `sw-001`〜`sw-009`（`sw-005` = `TB_PB.1a`–`CR1.14`、
 * `sw-009` = `CR1.6`–`TB_PL.1+`）。
 */
export function inspectRepairProblemJson(): Record<string, unknown> {
  return {
    ...selfHoldProblemJson(),
    id: 'x-c2',
    mode: 'inspect-repair',
    title: 'テスト用 回路点検・修復',
    grade: 2,
    hints: { schematicVisible: true },
    faults: [
      { target: { wireId: 'sw-005' }, kind: 'wire-open' },
      { target: { wireId: 'sw-009' }, kind: 'wire-missing' },
    ],
  };
}

/** 課題JSONを検証済みのC2課題にする（失敗したら即エラーにする）。 */
export function parseInspectRepairOrThrow(json: unknown): InspectRepairProblem {
  const parsed = InspectRepairProblemSchema.safeParse(json);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
  return parsed.data;
}
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/content/test/schema-inspect-repair.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InspectRepairProblemSchema } from '../src/schema/inspect-repair.js';
import { inspectRepairProblemJson } from './helpers/inspect.js';

describe('InspectRepairProblemSchema', () => {
  it('accepts the sample problem', () => {
    const parsed = InspectRepairProblemSchema.safeParse(inspectRepairProblemJson());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.mode).toBe('inspect-repair');
    expect(Array.isArray(parsed.data.faults)).toBe(true);
  });

  it('accepts the random fault form', () => {
    const json = inspectRepairProblemJson();
    json['faults'] = {
      random: {
        count: 2,
        types: ['wire-open', 'wire-missing'],
        seed: 1,
        fallback: [
          { target: { wireId: 'sw-005' }, kind: 'wire-open' },
          { target: { wireId: 'sw-009' }, kind: 'wire-missing' },
        ],
      },
    };
    expect(InspectRepairProblemSchema.safeParse(json).success).toBe(true);
  });

  it('rejects a problem without faults', () => {
    const json = inspectRepairProblemJson();
    delete json['faults'];
    expect(InspectRepairProblemSchema.safeParse(json).success).toBe(false);
  });

  it('shows the schematic for grade 2 and hides it for grade 1 (§9.2)', () => {
    const grade2 = { ...inspectRepairProblemJson(), grade: 2, hints: { schematicVisible: true } };
    expect(InspectRepairProblemSchema.safeParse(grade2).success).toBe(true);
    const grade1 = { ...inspectRepairProblemJson(), grade: 1, hints: { schematicVisible: false } };
    expect(InspectRepairProblemSchema.safeParse(grade1).success).toBe(true);
    const wrong = { ...inspectRepairProblemJson(), grade: 1, hints: { schematicVisible: true } };
    const parsed = InspectRepairProblemSchema.safeParse(wrong);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain('2級');
  });

  it('rejects grade 3 (C2 is for grade 1 and 2 only)', () => {
    const json = { ...inspectRepairProblemJson(), grade: 3, hints: { schematicVisible: true } };
    const parsed = InspectRepairProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.message.includes('1級・2級'))).toBe(true);
  });

  it('requires the judged window to outlast the last operation by a tick (§7.3)', () => {
    const json = inspectRepairProblemJson();
    json['operations'] = [{ t: 5000, target: 'PB1', action: 'press' }];
    json['durationMs'] = 5000;
    const parsed = InspectRepairProblemSchema.safeParse(json);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['durationMs']);
  });

  it('rejects unknown keys', () => {
    const json = { ...inspectRepairProblemJson(), note: 'x' };
    expect(InspectRepairProblemSchema.safeParse(json).success).toBe(false);
  });
});
```

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-inspect-repair.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/schema/inspect-repair.js` で `Test Files  1 failed (1)`。

- [ ] **Step 4: `src/schema/inspect-repair.ts` を書く**

`packages/content/src/schema/inspect-repair.ts`:

```ts
import { TICK_MS } from '@ojt/circuit-sim';
import { z } from 'zod';
import { HintsSchema } from './assemble.js';
import { ProblemHeaderShape, TerminalIdSchema } from './common.js';
import { FaultsSchema } from './faults.js';
import { JudgeSettingsSchema } from './judge.js';
import { DurationMsSchema, lastOperationMs, OperationListSchema } from './operations.js';
import { SchematicDocumentSchema } from './schematic.js';

/**
 * モードC2（回路点検・修復）の課題。設計仕様 §7.5 / §9.2。
 * 形はモードBと同じ（回路図＋操作列＋判定設定）で、`faults` が加わる。回路図は
 * **模範回路**であり、2級形式では訓練者に提示する回路図でもある（1級形式はタイムチャートのみ）。
 */
export const InspectRepairProblemSchema = z
  .strictObject({
    ...ProblemHeaderShape,
    mode: z.literal('inspect-repair').describe('課題モード。回路点検・修復は `inspect-repair`。'),
    schematic: SchematicDocumentSchema.describe(
      '基準になる回路（正解）。ここから初期配線を作り、faults を注入します。',
    ),
    physicalOverride: z
      .record(z.string().min(1), z.tuple([TerminalIdSchema, TerminalIdSchema]))
      .optional()
      .describe('回路図の要素IDごとに、割り当てる物理端子2つを指定して既定の割当を上書きします。'),
    faults: FaultsSchema.describe('注入する故障（明示リストまたはランダム指定）。'),
    operations: OperationListSchema.describe(
      '判定で再生する押ボタン操作列（`t` は判定開始からのミリ秒で非減少）。',
    ),
    durationMs: DurationMsSchema.describe(
      '判定区間の長さ[ms]。タイムチャートの横軸長でもあります。',
    ),
    judge: JudgeSettingsSchema.describe('比較する信号・許容差・静的チェックの設定。'),
    hints: HintsSchema.describe('回路図を提示するか（2級形式は true、1級形式は false）。'),
  })
  .superRefine((problem, ctx) => {
    const last = lastOperationMs(problem.operations);
    if (problem.durationMs < last + TICK_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: `判定区間長（${problem.durationMs}ms）は最後の操作（${last}ms）より少なくとも1tick（${TICK_MS}ms）長くする必要があります`,
      });
    }
    if (problem.grade === 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['grade'],
        message: '回路点検・修復は1級・2級の課題です（3級形式はありません）',
      });
    } else if (problem.hints.schematicVisible !== (problem.grade === 2)) {
      ctx.addIssue({
        code: 'custom',
        path: ['hints', 'schematicVisible'],
        message: '回路図の提示は 2級形式のみ true（1級形式はタイムチャートのみ）です（§9.2）',
      });
    }
  });

/** モードC2課題。 */
export type InspectRepairProblem = z.infer<typeof InspectRepairProblemSchema>;
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-inspect-repair.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  7 passed (7)`。

- [ ] **Step 6: コミットする**

```powershell
git add packages/content/src/schema/inspect-repair.ts packages/content/test/helpers/inspect.ts packages/content/test/schema-inspect-repair.test.ts
git commit -m @'
feat(content): add mode C2 inspect-repair problem schema

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 7: `src/rng.ts` と `src/random-faults.ts` — 決定論的なランダム故障

**Files:**
- Create: `packages/content/src/rng.ts`
- Create: `packages/content/src/random-faults.ts`
- Test: `packages/content/test/rng.test.ts`
- Test: `packages/content/test/random-faults.test.ts`

§7.5 のランダム故障を実装する。§5.2 の決定論を守るため乱数は seed から作る（`Math.random()` は使わない）。生成した組合せは §7.5 の2条件を満たすまで引き直す。

| 条件 | 検証方法 |
|---|---|
| 模範回路と動作が異なること | 故障を入れた盤で課題の操作列を再生し、`compareLogs()` の不一致が1件以上あること |
| 電源保護が即座に動作しないこと | 再生中に `short-circuit-power-on` の危険操作が出ていないこと |
| 上限 | 100回（`MAX_RANDOM_FAULT_ATTEMPTS`）引き直して満たせなければ `random.fallback` の明示リストを使う |

**候補の限定:** ランダムに選べる種別は「訓練者がこの盤で直せるもの」に限る（`RANDOM_FAULT_KINDS`）。電線の3種と、装着したリレー／タイマの接点・コイルの故障である。ランプの断線（`lamp-open`）は盤に固定された機器で交換できず、修復後の動作一致（§9.2 判定②）に到達できないため候補から外す（明示リストでは §5.4 どおり指定できる）。

- [ ] **Step 1: 失敗するテストを書く（乱数）**

`packages/content/test/rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, pickIndex, pickOne } from '../src/rng.js';

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = [a(), a(), a(), a()];
    const second = [b(), b(), b(), b()];
    expect(second).toEqual(first);
  });

  it('gives a different sequence for a different seed', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('stays inside [0, 1)', () => {
    const random = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('pickIndex', () => {
  it('returns an index inside the array', () => {
    const random = mulberry32(99);
    for (let i = 0; i < 200; i += 1) {
      const index = pickIndex(random, 4);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
    }
  });

  it('never runs past the end even when the draw returns almost 1', () => {
    expect(pickIndex(() => 0.999999999, 3)).toBe(2);
    expect(pickIndex(() => 0, 3)).toBe(0);
    expect(pickIndex(() => 0.5, 0)).toBe(0);
  });
});

describe('pickOne', () => {
  it('picks an element and returns undefined for an empty list', () => {
    const random = mulberry32(3);
    expect(['a', 'b', 'c']).toContain(pickOne(random, ['a', 'b', 'c']));
    expect(pickOne(random, [])).toBeUndefined();
  });
});

describe('hashSeed', () => {
  it('maps the same text to the same seed', () => {
    expect(hashSeed('CHK:p1')).toBe(hashSeed('CHK:p1'));
    expect(hashSeed('CHK:p1')).not.toBe(hashSeed('CHK:p2'));
  });

  it('returns a non negative 32 bit integer', () => {
    const seed = hashSeed('any text');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/rng.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/rng.js` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `src/rng.ts` を書く**

`packages/content/src/rng.ts`:

```ts
/**
 * 決定論的な擬似乱数。設計仕様 §5.2 / §7.5。
 * 「故障のランダム選択は課題開始前に seed から決め、以降のシミュレーションは決定論的」という
 * 方針を満たすため、`Math.random()` は使わず seed から列を作る（同じ seed からは必ず同じ列）。
 * 採用したのは mulberry32（32bit状態・高速・分布が十分）である。
 */

/** seed から [0,1) の擬似乱数列を作る（mulberry32）。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 0以上 `length` 未満の整数を1つ引く。`length` が0以下なら0を返す。 */
export function pickIndex(random: () => number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.floor(random() * length));
}

/** 配列から1つ引く（空配列は undefined）。 */
export function pickOne<T>(random: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[pickIndex(random, items.length)];
}

/**
 * 文字列から seed を作る（FNV-1a 32bit）。同じ文字列からは必ず同じ値になる。
 * C1で「どの接点組に故障を入れるか」を課題の seed と部品IDから決めるのに使う（§7.5 組の選択）。
 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
```

- [ ] **Step 4: 失敗するテストを書く（ランダム故障）**

`packages/content/test/random-faults.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  MAX_RANDOM_FAULT_ATTEMPTS,
  RANDOM_FAULT_KINDS,
  resolveFaults,
} from '../src/random-faults.js';
import { inspectRepairProblemJson, parseInspectRepairOrThrow } from './helpers/inspect.js';

const FALLBACK = [{ target: { wireId: 'sw-004' }, kind: 'wire-open' }];

function problemWithRandom(random: Record<string, unknown>) {
  return parseInspectRepairOrThrow({ ...inspectRepairProblemJson(), faults: { random } });
}

describe('RANDOM_FAULT_KINDS', () => {
  it('offers the repairable kinds only (no lamp-open)', () => {
    expect(RANDOM_FAULT_KINDS).toContain('wire-open');
    expect(RANDOM_FAULT_KINDS).toContain('contact-welded');
    expect(RANDOM_FAULT_KINDS).toContain('coil-open');
    expect(RANDOM_FAULT_KINDS).not.toContain('lamp-open');
  });

  it('caps the retries at 100', () => {
    expect(MAX_RANDOM_FAULT_ATTEMPTS).toBe(100);
  });
});

describe('resolveFaults', () => {
  it('returns an explicit list unchanged', () => {
    const problem = parseInspectRepairOrThrow(inspectRepairProblemJson());
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toEqual(problem.faults);
  });

  it('draws the requested number of faults from the given types', () => {
    const problem = problemWithRandom({
      count: 2,
      types: ['wire-open', 'wire-missing'],
      seed: 12345,
      fallback: [...FALLBACK, { target: { wireId: 'sw-005' }, kind: 'wire-missing' }],
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toHaveLength(2);
    for (const fault of resolved.value) {
      expect(['wire-open', 'wire-missing']).toContain(fault.kind);
      expect('wireId' in fault.target).toBe(true);
    }
  });

  it('gives the same faults for the same seed and different ones for another seed', () => {
    const make = (seed: number) =>
      resolveFaults(
        problemWithRandom({
          count: 2,
          types: ['wire-open'],
          seed,
          fallback: [...FALLBACK, { target: { wireId: 'sw-005' }, kind: 'wire-open' }],
        }),
        JIPM_BOARD,
      );
    const a = make(4242);
    const b = make(4242);
    const c = make(777);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(b.value).toEqual(a.value);
    expect(JSON.stringify(c.value)).not.toBe(JSON.stringify(a.value));
  });

  it('never picks the same wire twice and never touches the locked check wiring', () => {
    const problem = problemWithRandom({
      count: 3,
      types: ['wire-open'],
      seed: 31337,
      fallback: [
        { target: { wireId: 'sw-004' }, kind: 'wire-open' },
        { target: { wireId: 'sw-005' }, kind: 'wire-open' },
        { target: { wireId: 'sw-006' }, kind: 'wire-open' },
      ],
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const ids = resolved.value.map((f) => ('wireId' in f.target ? f.target.wireId : ''));
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id.startsWith('fw-chk')).toBe(false);
  });

  it('falls back to the explicit list when the retries run out', () => {
    const problem = problemWithRandom({
      count: 1,
      types: ['wire-open'],
      seed: 5,
      fallback: FALLBACK,
    });
    const resolved = resolveFaults(problem, JIPM_BOARD, { maxAttempts: 0 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toEqual(FALLBACK);
  });

  it('rejects a type that cannot be repaired on this board', () => {
    const problem = problemWithRandom({
      count: 1,
      types: ['lamp-open'],
      seed: 5,
      fallback: FALLBACK,
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.errors[0]?.path).toBe('faults.random.types');
    expect(resolved.errors[0]?.message).toContain('lamp-open');
  });

  it('mixes wire and part faults when both are allowed', () => {
    const problem = problemWithRandom({
      count: 2,
      types: ['wire-open', 'coil-open'],
      seed: 2026,
      fallback: [...FALLBACK, { target: { wireId: 'sw-005' }, kind: 'wire-open' }],
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toHaveLength(2);
    for (const fault of resolved.value) {
      expect(['wire-open', 'coil-open']).toContain(fault.kind);
    }
  });
});
```

- [ ] **Step 5: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/random-faults.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/random-faults.js` で `Test Files  1 failed (1)`。

- [ ] **Step 6: `src/reference.ts` の引数型を「模範回路を持つ課題」に広げる**

モードC2の課題もモードBと同じ形（`schematic` ＋ `physicalOverride` ＋ `board` ＋ `inventory`）で模範回路を持つので、`buildReferenceSession()` をそのまま使い回す。`packages/content/src/reference.ts` に次を足す（`import type { AssembleProblem } from './schema/assemble.js';` の直後）:

```ts
import type { InspectRepairProblem } from './schema/inspect-repair.js';
```

さらに `ReferenceCircuit` の定義の直前に型を追加する:

```ts
/**
 * 模範回路を持つ課題（モードB／モードC2）。どちらも回路図から模範回路を組み立てる。§7.2 / §9.2
 * モードC2の「基準になる回路」は模範回路そのものであり、故障はそこへ後から注入する。
 */
export type SchematicProblem = AssembleProblem | InspectRepairProblem;
```

そのうえで、同ファイルの5つの関数の引数型 `AssembleProblem` を `SchematicProblem` に置き換える（本文は無変更）:

```ts
function toRoles(problem: SchematicProblem): SocketRoles {
function toExtraParts(problem: SchematicProblem): PartId[] {
function cellPath(problem: SchematicProblem, cellId: string): string | undefined {
export function toProblemPath(problem: SchematicProblem, path: string): string {
export function buildReferenceSession(
  problem: SchematicProblem,
  board: BoardDefinition,
): ReferenceResult {
```

- [ ] **Step 7: `src/random-faults.ts` を書く**

`packages/content/src/random-faults.ts`:

```ts
import { SOCKET_IDS, toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import { compareLogs, type FaultKind, type SignalLog } from '@ojt/circuit-sim';
import { applyFaults, injectPartFaults } from './faults.js';
import { buildReferenceSession } from './reference.js';
import { mulberry32, pickOne } from './rng.js';
import { runOperations } from './runner.js';
import {
  isRandomFaults,
  isWireFaultKind,
  SOCKET_COIL_ELEMENT_INDEX,
  socketContactElementIndex,
  type FaultSpecData,
  type RandomFaultsData,
} from './schema/faults.js';
import type { ProblemIssue } from './schema/index.js';
import { resolveCompareSignals } from './schema/judge.js';
import type { InspectRepairProblem } from './schema/inspect-repair.js';

/**
 * ランダム故障の生成。設計仕様 §7.5。
 * seed から決定論的に組合せを作り、「模範回路と動作が異なる」「電源保護が即座に動作しない」の
 * 2条件を満たすまで引き直す（最大100回、超過したら課題の `fallback` を使う）。
 */

/** 引き直しの上限。§7.5 */
export const MAX_RANDOM_FAULT_ATTEMPTS = 100;

/**
 * ランダムに選んでよい故障の種別。§7.5 / §9.2
 * 訓練者がこの盤で直せるものに限る（電線は白線で引き直す、リレー／タイマは良品に交換する）。
 * `lamp-open` は盤に固定された機器の故障で交換できず、修復後の動作一致（§9.2 判定②）に
 * 到達できないため候補から外す（明示リストでは §5.4 どおり指定できる）。
 */
export const RANDOM_FAULT_KINDS = [
  'wire-open',
  'wire-missing',
  'wire-misrouted',
  'contact-open',
  'contact-welded',
  'contact-resistive',
  'coil-open',
  'coil-layer-short',
] as const satisfies readonly FaultKind[];

/** 生成オプション。 */
export interface ResolveFaultsOptions {
  /** `random.seed` を上書きする。 */
  seed?: number;
  /** 引き直しの上限（既定 `MAX_RANDOM_FAULT_ATTEMPTS`）。0にすると即フォールバックする。 */
  maxAttempts?: number;
}

/** 生成結果。 */
export type ResolveFaultsResult =
  { ok: true; value: FaultSpecData[] } | { ok: false; errors: ProblemIssue[] };

/** 役割が割り当てられ、部品が装着されているソケットの部品ID（チェック用は除く）。§9.2 */
function faultablePartIds(session: BoardSession): string[] {
  const out: string[] = [];
  for (const socket of SOCKET_IDS) {
    if (session.mounted[socket] === undefined) continue;
    const role = session.socketRoles[socket];
    if (role === undefined || role === 'CHK') continue;
    out.push(role);
  }
  return out;
}

/** 故障を入れてよい電線（既設の固定配線を除く）。§6.3 */
function faultableWireIds(session: BoardSession): string[] {
  return session.wires.filter((w) => !w.locked).map((w) => w.id);
}

/** 誤配線の付け替え先にできる端子（装着部品の、まだ何も繋がっていないピン）。 */
function spareTerminals(session: BoardSession): string[] {
  const used = new Set<string>();
  for (const wire of session.wires) {
    used.add(wire.from);
    used.add(wire.to);
  }
  const out: string[] = [];
  for (const partId of faultablePartIds(session)) {
    for (let pin = 1; pin <= 14; pin += 1) {
      const terminal = `${partId}.${String(pin)}`;
      if (!used.has(terminal)) out.push(terminal);
    }
  }
  return out;
}

/** 1件ぶんの故障を引く。引けなければ undefined（その試行は捨てる）。 */
function drawFault(
  random: () => number,
  kind: FaultKind,
  wireIds: readonly string[],
  partIds: readonly string[],
  spares: readonly string[],
): FaultSpecData | undefined {
  if (isWireFaultKind(kind)) {
    const wireId = pickOne(random, wireIds);
    if (wireId === undefined) return undefined;
    if (kind !== 'wire-misrouted') return { target: { wireId }, kind };
    const to = pickOne(random, spares);
    if (to === undefined) return undefined;
    return { target: { wireId }, kind, to };
  }
  const partId = pickOne(random, partIds);
  if (partId === undefined) return undefined;
  if (kind === 'coil-open' || kind === 'coil-layer-short') {
    return { target: { partId, elementIndex: SOCKET_COIL_ELEMENT_INDEX }, kind };
  }
  const group = Math.min(4, 1 + Math.floor(random() * 4));
  const contact = random() < 0.5 ? 'a' : 'b';
  return {
    target: { partId, elementIndex: socketContactElementIndex(group, contact) },
    kind,
  };
}

/** その組合せが §7.5 の2条件を満たすか（動作が模範と違う／即保護動作しない）。 */
function isUsable(
  problem: InspectRepairProblem,
  board: BoardDefinition,
  candidate: readonly FaultSpecData[],
  expectedLog: SignalLog,
  signals: readonly string[],
): boolean {
  const built = buildReferenceSession(problem, board);
  if (!built.ok) return false;
  const applied = applyFaults(built.value.session, candidate);
  if (!applied.ok) return false;
  const netlist = toNetlist(built.value.session, board);
  if (injectPartFaults(netlist, applied.value.partFaults).length > 0) return false;
  const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
  if (run.events.hazards('short-circuit-power-on').length > 0) return false;
  return compareLogs(expectedLog, run.log, signals, problem.judge.tolerance).length > 0;
}

/**
 * 課題の `faults` を、実際に注入する明示リストに解決する。§7.5
 * 明示リストならそのまま返す。ランダム指定なら seed から引き、2条件を満たす組合せが出るまで
 * 最大 `maxAttempts` 回引き直し、尽きたら `random.fallback` を返す。
 * `random.seed` も `options.seed` も無いときは `Date.now()` を種にする（§7.5 の
 * 「省略すると課題開始ごとに新しい乱数を使い同じ課題を繰り返し練習できる」）。
 * テストからは必ず seed を渡すこと。
 */
export function resolveFaults(
  problem: InspectRepairProblem,
  board: BoardDefinition,
  options: ResolveFaultsOptions = {},
): ResolveFaultsResult {
  const faults = problem.faults;
  if (!isRandomFaults(faults)) return { ok: true, value: [...faults] };
  const spec: RandomFaultsData = faults.random;
  const unknown = spec.types.filter(
    (kind) => !(RANDOM_FAULT_KINDS as readonly FaultKind[]).includes(kind),
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      errors: [
        {
          path: 'faults.random.types',
          message: `この盤で修復できない故障はランダムに選べません: ${unknown.join('・')}`,
        },
      ],
    };
  }
  const built = buildReferenceSession(problem, board);
  if (!built.ok) return { ok: false, errors: built.errors };
  const expected = runOperations(built.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  const signals = resolveCompareSignals(problem.judge, problem.board.extraParts ?? []);
  const wireIds = faultableWireIds(built.value.session);
  const partIds = faultablePartIds(built.value.session);
  const spares = spareTerminals(built.value.session);
  const maxAttempts = options.maxAttempts ?? MAX_RANDOM_FAULT_ATTEMPTS;
  const random = mulberry32(options.seed ?? spec.seed ?? Date.now());

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate: FaultSpecData[] = [];
    const takenWires = new Set<string>();
    const takenParts = new Set<string>();
    let complete = true;
    for (let i = 0; i < spec.count; i += 1) {
      const kind = pickOne(random, spec.types);
      if (kind === undefined) {
        complete = false;
        break;
      }
      const drawn = drawFault(
        random,
        kind,
        wireIds.filter((id) => !takenWires.has(id)),
        partIds.filter((id) => !takenParts.has(id)),
        spares,
      );
      if (drawn === undefined) {
        complete = false;
        break;
      }
      if ('wireId' in drawn.target) takenWires.add(drawn.target.wireId);
      else takenParts.add(drawn.target.partId);
      candidate.push(drawn);
    }
    if (!complete) continue;
    if (isUsable(problem, board, candidate, expected.log, signals)) {
      return { ok: true, value: candidate };
    }
  }
  return { ok: true, value: [...spec.fallback] };
}
```

- [ ] **Step 8: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/rng.test.ts test/random-faults.test.ts
```

Expected: `Test Files  2 passed (2)` / `Tests  16 passed (16)`。

- [ ] **Step 9: コミットする**

```powershell
git add packages/content/src/rng.ts packages/content/src/random-faults.ts packages/content/src/reference.ts packages/content/test/rng.test.ts packages/content/test/random-faults.test.ts
git commit -m @'
feat(content): add deterministic random fault generation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 8: `src/schema/index.ts` — 判別共用体の拡張と JSON Schema の再生成

**Files:**
- Modify: `packages/content/src/schema/common.ts`
- Modify: `packages/content/src/schema/index.ts`
- Modify: `packages/content/src/problem-set.ts`
- Modify: `packages/content/src/loader.ts`
- Modify: `packages/content/src/builtin/index.ts`（`parseBuiltinProblems()` / `ofMode()` を追加し `BUILTIN_ASSEMBLE_PROBLEMS` の検証をそれ経由にする。B-3）
- Modify: `packages/content/schema/task.schema.json`（生成物）
- Modify: `packages/content/test/schema-common.test.ts`
- Modify: `packages/content/test/index.test.ts`
- Test: `packages/content/test/schema-index.test.ts`（既存を修正＋追記）

C1/C2を「開始できるモード」に格上げする。`UNSUPPORTED_MODES` は `['plc']` だけになり、`ProblemSchema` は4分岐（`assemble` / `inspect-parts` / `inspect-repair` / 未対応）になる。

**互換への影響:** `parseProblem()` の成功時の型が `AssembleProblem` から `SupportedProblem`（3モードの共用体）に広がるため、`ProblemSet.problems` も広がる。`apps/desktop` はこの型を `Map<string, AssembleProblem>` に入れているので**1箇所だけ**型が合わなくなる。その追随は Task 17 でまとめて行う（本タスクの完了時点では `pnpm --filter @ojt/content test` と `typecheck` が通ればよい）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/schema-index.test.ts` の `describe('parseProblem', …)` の中の**2件を差し替え**、末尾に**3件を追加**する。

差し替え1 — `it('reports an unsupported mode instead of a schema error (§16)', …)` を次に置き換える:

```ts
  it('reports an unsupported mode instead of a schema error (§16)', () => {
    const result = parseProblem({
      ...selfHoldProblemJson(),
      id: 'd-001',
      mode: 'plc',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-mode');
    expect(result.mode).toBe('plc');
    expect(result.id).toBe('d-001');
    expect(result.issues).toEqual([]);
  });
```

差し替え2 — `it('leaves the id out when an unsupported mode problem has none', …)` を次に置き換える:

```ts
  it('leaves the id out when an unsupported mode problem has none', () => {
    const result = parseProblem({ mode: 'plc' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-mode');
    expect(result.id).toBeUndefined();
  });
```

追加 — 同じ `describe('parseProblem', …)` の末尾に3件を足す:

```ts
  it('parses a mode C1 problem (§7.5)', () => {
    const result = parseProblem(inspectPartsProblemJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problem.mode).toBe('inspect-parts');
    expect(isInspectPartsProblem(result.problem)).toBe(true);
    expect(isAssembleProblem(result.problem)).toBe(false);
  });

  it('parses a mode C2 problem (§7.5)', () => {
    const result = parseProblem(inspectRepairProblemJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problem.mode).toBe('inspect-repair');
    expect(isInspectRepairProblem(result.problem)).toBe(true);
  });

  it('reports a C1 schema violation against the C1 schema, not the assemble one', () => {
    const json = inspectPartsProblemJson();
    json['parts'] = [
      { id: 'p1', kind: 'timer-h3y4', truth: 'coil-layer-short' },
      { id: 'p2', kind: 'relay-my4n', truth: 'normal' },
    ];
    const result = parseProblem(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
    expect(result.mode).toBe('inspect-parts');
    expect(result.issues.some((i) => i.path === 'parts[0].truth')).toBe(true);
  });
```

そのために同ファイルの import を次に差し替える:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  parseProblem,
  problemJsonSchema,
} from '../src/schema/index.js';
import { inspectPartsProblemJson, inspectRepairProblemJson } from './helpers/inspect.js';
import { selfHoldProblemJson } from './helpers/problems.js';
```

さらに `describe('problemJsonSchema', …)` の1件目を次に置き換える（4分岐になることを見張る）:

```ts
  it('generates a draft 2020-12 schema for the whole union (§4.5)', () => {
    const schema = problemJsonSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema).toHaveProperty('oneOf');
    expect((schema.oneOf as unknown[]).length).toBe(4);
    const text = JSON.stringify(schema);
    expect(text).toContain('inspect-repair');
    expect(text).toContain('inspect-parts');
    expect(text).toContain('socketRoles');
  });
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-index.test.ts
```

Expected: 失敗。`isAssembleProblem` などが未定義で `TypeError`、`unsupported-mode` の期待も外れて `Test Files  1 failed (1)`。

- [ ] **Step 3: `UNSUPPORTED_MODES` を縮める**

`packages/content/src/schema/common.ts` の `UNSUPPORTED_MODES` の定義（コメント含む）を次に置き換える:

```ts
/**
 * まだ本体スキーマを定義していないモード。読込時に `unsupported-mode` として一覧に出す。§13 #1
 * Phase 2 で `inspect-parts` / `inspect-repair` を実装したので、残るのは `plc`（Phase 3）だけである。
 */
export const UNSUPPORTED_MODES = ['plc'] as const satisfies readonly ProblemMode[];
```

- [ ] **Step 4: `src/schema/index.ts` を書き換える**

`packages/content/src/schema/index.ts` の先頭の import と、`UnsupportedProblemSchema` から `parseProblem()` までを次に置き換える（`toProblemIssues()` / `formatPath()` / `peekMode()` / `peekId()` / `problemJsonSchema()` は無変更）:

```ts
import { z } from 'zod';
import { AssembleProblemSchema, type AssembleProblem } from './assemble.js';
import {
  ProblemHeaderShape,
  ProblemModeSchema,
  UNSUPPORTED_MODES,
  type ProblemMode,
} from './common.js';
import { InspectPartsProblemSchema, type InspectPartsProblem } from './inspect-parts.js';
import { InspectRepairProblemSchema, type InspectRepairProblem } from './inspect-repair.js';
```

```ts
/** まだ本体を定義していないモードのヘッダ。本体フィールドはそのまま保持する。 */
export const UnsupportedProblemSchema = z.looseObject({
  ...ProblemHeaderShape,
  mode: z.enum(UNSUPPORTED_MODES).describe('課題モード。まだ開始できないモード（PLCは Phase 3）。'),
});

/** 未対応モードの課題（ヘッダのみ）。 */
export type UnsupportedProblem = z.infer<typeof UnsupportedProblemSchema>;

/** 課題（モードで判別する）。§7.1 */
export const ProblemSchema = z.discriminatedUnion('mode', [
  AssembleProblemSchema,
  InspectPartsProblemSchema,
  InspectRepairProblemSchema,
  UnsupportedProblemSchema,
]);

/** 課題。 */
export type Problem = z.infer<typeof ProblemSchema>;

/** いま開始できる課題（モードB／モードC1／モードC2）。§16 */
export type SupportedProblem = AssembleProblem | InspectPartsProblem | InspectRepairProblem;

/** モードB課題か。 */
export function isAssembleProblem(problem: SupportedProblem): problem is AssembleProblem {
  return problem.mode === 'assemble';
}

/** モードC1課題か。 */
export function isInspectPartsProblem(problem: SupportedProblem): problem is InspectPartsProblem {
  return problem.mode === 'inspect-parts';
}

/** モードC2課題か。 */
export function isInspectRepairProblem(problem: SupportedProblem): problem is InspectRepairProblem {
  return problem.mode === 'inspect-repair';
}

/** スキーマ違反1件（zodのパスとメッセージ）。§13 #1 */
export interface ProblemIssue {
  path: string;
  message: string;
}

/** 読込に失敗した理由。§13 #1 / §13 #2 */
export type ProblemFailureReason = 'invalid-json' | 'schema' | 'unsupported-mode' | 'reference';

/** `parseProblem()` の結果。 */
export type ParseProblemResult =
  | { ok: true; problem: SupportedProblem }
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
```

続けて `parseProblem()` を次に置き換える（`peekMode` / `peekId` / `toProblemIssues` はそのまま使う）:

```ts
/** そのモードがまだ開始できないか。 */
function isUnsupportedMode(mode: ProblemMode): boolean {
  return (UNSUPPORTED_MODES as readonly ProblemMode[]).includes(mode);
}

/**
 * 課題JSON（パース済みの値）を検証する。§7.8 / §13 #1
 * Phase 2 で開始できるのは `assemble` / `inspect-parts` / `inspect-repair` の3モードで、
 * `plc` はヘッダだけを読んで `unsupported-mode` として課題一覧に出す（§16）。
 * `mode` を読めなかった場合はモードB課題として検証し、スキーマ違反として理由を返す。
 */
export function parseProblem(json: unknown): ParseProblemResult {
  const mode = peekMode(json);
  const id = peekId(json);
  if (mode !== undefined && isUnsupportedMode(mode)) {
    const header = UnsupportedProblemSchema.safeParse(json);
    return {
      ok: false,
      reason: 'unsupported-mode',
      message: `このモードはまだ開始できません: ${mode}`,
      issues: header.success ? [] : toProblemIssues(header.error),
      ...(header.success ? { id: header.data.id } : id === undefined ? {} : { id }),
      mode,
    };
  }
  const parsed =
    mode === 'inspect-parts'
      ? InspectPartsProblemSchema.safeParse(json)
      : mode === 'inspect-repair'
        ? InspectRepairProblemSchema.safeParse(json)
        : AssembleProblemSchema.safeParse(json);
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
```

- [ ] **Step 5: 読込結果の型を広げる**

`packages/content/src/problem-set.ts` の先頭の import 1行と `ProblemSet` を次に置き換える:

```ts
import type { ProblemFailureReason, ProblemIssue, SupportedProblem } from './schema/index.js';
```

```ts
/** 読込結果。§7.8 */
export interface ProblemSet {
  /** 開始できるモードの課題（モードB／C1／C2）。 */
  problems: SupportedProblem[];
  errors: ProblemLoadError[];
}
```

`packages/content/src/loader.ts` の import 1行と、`AssembleProblem` を使っている3箇所を置き換える:

```ts
import type { SupportedProblem } from './schema/index.js';
```

```ts
function loadOne(file: string, problems: SupportedProblem[], errors: ProblemLoadError[]): void {
```

```ts
  const problems: SupportedProblem[] = [];
```

```ts
  const problems: SupportedProblem[] = [];
```

（`loadProblemsFromDir()` の1つと `mergeProblemSets()` の1つ。`import type { AssembleProblem } from './schema/assemble.js';` の行は削除する。）

**`src/builtin/index.ts` も追随させる（B-3）:** `parseProblem()` の戻り値が `SupportedProblem` に広がったので、内蔵課題の検証もそれ経由にしないと `packages/content/src/builtin/index.ts` が型で落ちる（このタスクの完了条件「`typecheck` が通る」を満たすために必須。Step 9 の確認はこの変更を前提にしている）。`BuiltinProblemError` クラスと `BUILTIN_ASSEMBLE_JSON` の定義・`BUILTIN_PROBLEMS` / `findBuiltinProblem`（まだ `AssembleProblem` のまま。`SupportedProblem` への追随は Task 14 で行う）はここでは触らない。

`packages/content/src/builtin/index.ts` の import に `parseProblem` と `SupportedProblem` を足す:

```ts
import { isAssembleProblem, parseProblem, type SupportedProblem } from '../schema/index.js';
```

内蔵のモードB課題を検証している箇所（`BUILTIN_ASSEMBLE_JSON` の定義の下、`BUILTIN_ASSEMBLE_PROBLEMS` の定義まで）を次に置き換える:

```ts
/** 内蔵課題のJSONを検証する。1件でも落ちたら `BuiltinProblemError` を投げる。§7.8 */
export function parseBuiltinProblems(sources: readonly unknown[]): SupportedProblem[] {
  return sources.map((source, index) => {
    const parsed = parseProblem(source);
    if (parsed.ok) return parsed.problem;
    throw new BuiltinProblemError(
      `内蔵課題[${index}]（${parsed.id ?? '不明'}）が読めません: ${parsed.message}`,
      parsed.issues,
    );
  });
}

/** 期待したモードの課題だけを取り出す（違うモードが混ざっていたら例外）。 */
function ofMode<T extends SupportedProblem>(
  problems: readonly SupportedProblem[],
  guard: (problem: SupportedProblem) => problem is T,
  label: string,
): T[] {
  return problems.map((problem, index) => {
    if (guard(problem)) return problem;
    throw new BuiltinProblemError(`内蔵課題[${index}]（${problem.id}）は${label}ではありません`, []);
  });
}

/** 内蔵のモードB課題（8題）。§7.9 */
export const BUILTIN_ASSEMBLE_PROBLEMS: readonly AssembleProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_ASSEMBLE_JSON),
  isAssembleProblem,
  'モードB課題',
);
```

（`BUILTIN_PROBLEMS` は引き続きこの `BUILTIN_ASSEMBLE_PROBLEMS` を指すので無変更。以前の検証ロジックがこれと違う形だった場合は、ここで示した形に揃える。）

- [ ] **Step 6: 既存テストの `UNSUPPORTED_MODES` の期待値を直し、型の絞り込みを2箇所足す**

`packages/content/test/schema-common.test.ts` の128行目付近:

```ts
    expect(UNSUPPORTED_MODES).toEqual(['plc']);
```

`packages/content/test/index.test.ts` の152行目付近:

```ts
    expect(UNSUPPORTED_MODES).toEqual(['plc']);
```

**型の絞り込みを2箇所足す（B-5）:** `parseProblem()` の戻り値が `SupportedProblem` に広がるため、`packages/content/test/index.test.ts` の中で `AssembleProblem` として扱っている2箇所が型で絞り込めなくなる。

`buildFixtureReference()`（119行目付近）の `!parsed.ok` の判定の直後に1行足す:

```ts
  const parsed = parseProblem(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
  if (parsed.problem.mode !== 'assemble') throw new Error('モードB課題ではありません');
  const built = buildReferenceSession(parsed.problem, JIPM_BOARD);
```

`describe('schema/index.js exports', …)` の中（266行目付近）、`const problem: AssembleProblem = ok.problem;` の直前に1行足す:

```ts
    const ok = parseProblem(selfHoldProblemJson());
    if (!ok.ok) throw new Error(JSON.stringify(ok.issues, null, 2));
    if (ok.problem.mode !== 'assemble') throw new Error('モードB課題ではありません');
    const problem: AssembleProblem = ok.problem;
```

- [ ] **Step 7: JSON Schema を再生成する**

```powershell
pnpm --filter @ojt/content schema:write
```

Expected: `wrote …\packages\content\schema\task.schema.json` と表示され、`git status` に `packages/content/schema/task.schema.json` の変更が出る（`oneOf` が3件から4件に増える）。

- [ ] **Step 8: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/schema-index.test.ts test/schema-common.test.ts test/loader.test.ts
```

Expected: `Test Files  3 passed (3)`（`schema-index` 20件・`schema-common` はそのまま・`loader` はそのまま）。

- [ ] **Step 9: パッケージ全体を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run
pnpm --filter @ojt/content typecheck
```

Expected: すべて通る（`src/builtin/index.ts` は Step 5 で `parseBuiltinProblems()` / `ofMode()` 経由に直し済みなので、ここでも型が合う。`apps/desktop` の型追随だけは Task 17 で行う）。

- [ ] **Step 10: コミットする**

```powershell
git add packages/content/src/schema/common.ts packages/content/src/schema/index.ts packages/content/src/problem-set.ts packages/content/src/loader.ts packages/content/src/builtin/index.ts packages/content/schema/task.schema.json packages/content/test/schema-index.test.ts packages/content/test/schema-common.test.ts packages/content/test/index.test.ts
git commit -m @'
feat(content): accept inspect-parts and inspect-repair problems

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 9: `src/inspect-parts.ts` — C1のドメイン（チェック用ソケットと判定表）

**Files:**
- Create: `packages/content/src/inspect-parts.ts`
- Test: `packages/content/test/inspect-parts.test.ts`

§9.1 の切り分け手順をライブラリとして成立させる。**このタスクが §16 Phase 2 の受入基準①②の中身**である。

| 公開するもの | 役割 |
|---|---|
| `buildCheckCircuit(problem, board, partId)` | トレイの部品1個をチェック用ソケット（`S7` = `CHK`）に挿し、`truth` に対応する故障を注入したネットリストを返す |
| `CHECK_COIL_MINUS` / `CHECK_COIL_PLUS` / `checkContactTerminals(group)` | 測定に使う端子（`CHK.13` / `CHK.14` / `CHK.9`・`CHK.5`・`CHK.1` …）。§9.1 測定1・測定2 |
| `expectedCheckReading(part)` | その `truth` のときテスターが何を示すか（判定表の実体）。テストとヘルプ表示の唯一の源 |
| `PART_TRUTH_LABELS` / `DIAGNOSIS_TABLE` | マークシートの選択肢と §9.1 のヘルプ表 |
| `LAYER_SHORT_JUDGE_RATIO` / `layerShortThresholdOhms()` | レアショートの判定しきい値（正常値の85% ＝ 552.5Ω）。§9.1 補足 |
| `faultGroupOf()` / `truthFault()` | 接点の不良をどの組に入れるか（seed から決定論的に）と、`truth` → §5.4 の故障 |

**期待読値（前提の表の再掲。`expectedCheckReading()` が返す値そのもの）:**

| `truth` | `picksUp` | `coilOhms` | `aClosedOff` | `aClosedOn` | `bClosedOff` | `bClosedOn` |
|---|---|---|---|---|---|---|
| `normal` | true | 650 | false | true | true | false |
| `coil-open` | **false** | **null（OL）** | false | **false** | true | **true** |
| `coil-layer-short` | true | **650 × ratio ＝ 422.5** | false | true | true | false |
| `a-open` | true | 650 | false | **false** | true | false |
| `a-weld` | true | 650 | **true** | true | **false** | false |
| `b-open` | true | 650 | false | true | **false** | false |
| `b-weld` | true | 650 | false | **false** | true | **true** |

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/inspect-parts.test.ts`:

```ts
import { JIPM_BOARD, type MountableKind } from '@ojt/board-model';
import { continuity, measureResistance, Simulation } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  buildCheckCircuit,
  CHECK_COIL_MINUS,
  CHECK_COIL_PLUS,
  CHECK_PART_ID,
  CHECK_TIMER_PRESET_MS,
  checkContactTerminals,
  checkSettleMs,
  DIAGNOSIS_TABLE,
  expectedCheckReading,
  faultGroupOf,
  LAYER_SHORT_JUDGE_RATIO,
  layerShortThresholdOhms,
  PART_TRUTH_LABELS,
  truthFault,
} from '../src/inspect-parts.js';
import type { InspectPartsProblem, PartTruth } from '../src/schema/inspect-parts.js';
import { inspectPartsProblemJson, parseInspectPartsOrThrow } from './helpers/inspect.js';

/** `truth` を1つだけ差し替えた課題（2個目は常に正常品）。 */
function truthProblem(
  truth: PartTruth,
  kind: MountableKind = 'relay-my4n',
  extra: Record<string, unknown> = {},
): InspectPartsProblem {
  return parseInspectPartsOrThrow({
    ...inspectPartsProblemJson(),
    parts: [
      { id: 'p1', kind, truth, ...extra },
      { id: 'p2', kind: 'relay-my4n', truth: 'normal' },
    ],
  });
}

/** チェック用ソケットに挿して §9.1 の手順どおりに測る。 */
function measureCheck(problem: InspectPartsProblem, partId: string) {
  const built = buildCheckCircuit(problem, JIPM_BOARD, partId);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const part = problem.parts.find((p) => p.id === partId);
  if (part === undefined) throw new Error(`no part ${partId}`);
  const pins = checkContactTerminals(built.value.group);
  const sim = new Simulation(built.value.netlist);
  sim.setBreaker(true);
  sim.setSwitch(true);
  sim.run(100);
  const coil = measureResistance(sim, CHECK_COIL_MINUS, CHECK_COIL_PLUS);
  const aClosedOff = continuity(sim, pins.com, pins.no).conductive;
  const bClosedOff = continuity(sim, pins.com, pins.nc).conductive;
  sim.press('PB4');
  sim.run(sim.tMs + checkSettleMs(part.kind));
  const state = sim.state();
  const picksUp =
    part.kind === 'timer-h3y4'
      ? (state.timers[CHECK_PART_ID]?.timedOut ?? false)
      : (state.relays[CHECK_PART_ID]?.contactsOn ?? false);
  return {
    sim,
    picksUp,
    coilDisplay: coil.display,
    coilOhms: coil.overRange ? null : coil.ohms,
    aClosedOff,
    bClosedOff,
    aClosedOn: continuity(sim, pins.com, pins.no).conductive,
    bClosedOn: continuity(sim, pins.com, pins.nc).conductive,
  };
}

describe('PART_TRUTH_LABELS / DIAGNOSIS_TABLE', () => {
  it('labels the seven answer-sheet options in Japanese (§9.1)', () => {
    expect(PART_TRUTH_LABELS.normal).toBe('正常');
    expect(PART_TRUTH_LABELS['coil-open']).toBe('コイル断線');
    expect(PART_TRUTH_LABELS['coil-layer-short']).toBe('レアショート');
    expect(PART_TRUTH_LABELS['a-open']).toBe('a接点 導通不良');
    expect(PART_TRUTH_LABELS['a-weld']).toBe('a接点 溶着');
    expect(PART_TRUTH_LABELS['b-open']).toBe('b接点 導通不良');
    expect(PART_TRUTH_LABELS['b-weld']).toBe('b接点 溶着');
  });

  it('covers every cause of the help table exactly once (§9.1)', () => {
    expect(DIAGNOSIS_TABLE).toHaveLength(7);
    expect(new Set(DIAGNOSIS_TABLE.map((r) => r.cause)).size).toBe(7);
    const layerShort = DIAGNOSIS_TABLE.find((r) => r.cause === 'coil-layer-short');
    expect(layerShort?.situation).toContain('85%');
  });
});

describe('layerShortThresholdOhms', () => {
  it('is 85 percent of the nominal 650 ohms (§9.1 補足)', () => {
    expect(LAYER_SHORT_JUDGE_RATIO).toBe(0.85);
    expect(layerShortThresholdOhms()).toBeCloseTo(552.5, 6);
  });
});

describe('checkContactTerminals', () => {
  it('follows the socket pin map of §6.2', () => {
    expect(checkContactTerminals(1)).toEqual({ com: 'CHK.9', no: 'CHK.5', nc: 'CHK.1' });
    expect(checkContactTerminals(4)).toEqual({ com: 'CHK.12', no: 'CHK.8', nc: 'CHK.4' });
    expect(() => checkContactTerminals(5)).toThrow(RangeError);
  });

  it('names the coil terminals of the check socket (§9.1 測定1)', () => {
    expect(CHECK_COIL_MINUS).toBe('CHK.13');
    expect(CHECK_COIL_PLUS).toBe('CHK.14');
  });
});

describe('faultGroupOf', () => {
  it('uses the explicit group when the problem gives one', () => {
    const problem = truthProblem('a-open', 'relay-my4n', { group: 3 });
    const part = problem.parts[0];
    if (part === undefined) return;
    expect(faultGroupOf(problem, part)).toBe(3);
  });

  it('derives a stable group from the seed and the part id (§7.5 組の選択)', () => {
    const problem = truthProblem('a-open');
    const part = problem.parts[0];
    if (part === undefined) return;
    const group = faultGroupOf(problem, part);
    expect(group).toBeGreaterThanOrEqual(1);
    expect(group).toBeLessThanOrEqual(4);
    expect(faultGroupOf(problem, part)).toBe(group);
  });
});

describe('truthFault', () => {
  it('maps the truths onto the §5.4 fault kinds', () => {
    const relay = truthProblem('coil-open');
    const coilPart = relay.parts[0];
    if (coilPart === undefined) return;
    expect(truthFault(relay, coilPart)).toEqual({
      target: { partId: 'CHK', elementIndex: 0 },
      kind: 'coil-open',
    });

    const layer = truthProblem('coil-layer-short', 'relay-my4n', { ratio: 0.5 });
    const layerPart = layer.parts[0];
    if (layerPart === undefined) return;
    expect(truthFault(layer, layerPart)).toEqual({
      target: { partId: 'CHK', elementIndex: 0 },
      kind: 'coil-layer-short',
      ratio: 0.5,
    });

    const weld = truthProblem('a-weld', 'relay-my4n', { group: 2 });
    const weldPart = weld.parts[0];
    if (weldPart === undefined) return;
    expect(truthFault(weld, weldPart)).toEqual({
      target: { partId: 'CHK', elementIndex: 4 },
      kind: 'contact-welded',
    });
  });

  it('returns nothing for a healthy part', () => {
    const problem = truthProblem('normal');
    const part = problem.parts[0];
    if (part === undefined) return;
    expect(truthFault(problem, part)).toBeUndefined();
  });
});

describe('buildCheckCircuit', () => {
  it('reports an unknown part id', () => {
    const built = buildCheckCircuit(truthProblem('normal'), JIPM_BOARD, 'nope');
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('parts');
  });

  it('reports a board mismatch', () => {
    const problem = parseInspectPartsOrThrow({
      ...inspectPartsProblemJson(),
      board: { boardId: 'board-other', socketRoles: { S7: 'CHK' } },
    });
    const built = buildCheckCircuit(problem, JIPM_BOARD, 'p1');
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('board.boardId');
  });

  it('sets a short timer preset so the check is quick', () => {
    expect(CHECK_TIMER_PRESET_MS).toBe(1000);
    expect(checkSettleMs('relay-my4n')).toBe(100);
    expect(checkSettleMs('timer-h3y4')).toBe(1100);
  });
});

describe('§9.1 判定表どおりの読値', () => {
  const TRUTHS: PartTruth[] = [
    'normal',
    'coil-open',
    'coil-layer-short',
    'a-open',
    'a-weld',
    'b-open',
    'b-weld',
  ];

  for (const truth of TRUTHS) {
    it(`matches expectedCheckReading for ${truth}`, () => {
      const extra = truth.startsWith('a-') || truth.startsWith('b-') ? { group: 1 } : {};
      const problem = truthProblem(truth, 'relay-my4n', extra);
      const part = problem.parts[0];
      if (part === undefined) return;
      const expected = expectedCheckReading(part);
      const actual = measureCheck(problem, 'p1');
      expect(actual.picksUp).toBe(expected.picksUp);
      expect(actual.aClosedOff).toBe(expected.aClosedOff);
      expect(actual.aClosedOn).toBe(expected.aClosedOn);
      expect(actual.bClosedOff).toBe(expected.bClosedOff);
      expect(actual.bClosedOn).toBe(expected.bClosedOn);
      if (expected.coilOhms === null) expect(actual.coilOhms).toBeNull();
      else expect(actual.coilOhms ?? 0).toBeCloseTo(expected.coilOhms, 1);
    });
  }

  it('受入基準②: コイル断線は吸引せずコイル抵抗が OL になる', () => {
    const actual = measureCheck(truthProblem('coil-open'), 'p1');
    expect(actual.picksUp).toBe(false);
    expect(actual.coilDisplay).toBe('OL');
  });

  it('受入基準②: レアショートは正常に吸引するのにコイル抵抗が約420Ωになる', () => {
    const actual = measureCheck(truthProblem('coil-layer-short', 'relay-my4n', { ratio: 0.65 }), 'p1');
    expect(actual.picksUp).toBe(true);
    expect(actual.coilDisplay).toBe('422.5');
    expect(actual.coilOhms ?? 0).toBeLessThanOrEqual(layerShortThresholdOhms());
  });

  it('正常品のコイル抵抗はしきい値を超える', () => {
    const actual = measureCheck(truthProblem('normal'), 'p1');
    expect(actual.coilDisplay).toBe('650.0');
    expect(actual.coilOhms ?? 0).toBeGreaterThan(layerShortThresholdOhms());
  });

  it('タイマも同じ手順で点検できる（タイムアップで接点が反転する）', () => {
    const actual = measureCheck(truthProblem('normal', 'timer-h3y4'), 'p1');
    expect(actual.picksUp).toBe(true);
    expect(actual.coilDisplay).toBe('650.0');
    expect(actual.aClosedOff).toBe(false);
    expect(actual.aClosedOn).toBe(true);
  });

  it('赤PBを離していればコイル抵抗を測っても危険操作にならない（§9.1 測定1）', () => {
    const actual = measureCheck(truthProblem('normal'), 'p1');
    expect(actual.sim.events.countOf('ohm-on-live')).toBe(0);
  });

  it('赤PBを押したままΩレンジを当てると ohm-on-live になる（§5.6 #1）', () => {
    const built = buildCheckCircuit(truthProblem('normal'), JIPM_BOARD, 'p1');
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const sim = new Simulation(built.value.netlist);
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.press('PB4');
    sim.run(100);
    const reading = measureResistance(sim, CHECK_COIL_MINUS, CHECK_COIL_PLUS);
    expect(reading.live).toBe(true);
    expect(reading.display).toBe('OL');
    expect(sim.events.countOf('ohm-on-live')).toBe(1);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/inspect-parts.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/inspect-parts.js` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `src/inspect-parts.ts` を書く**

`packages/content/src/inspect-parts.ts`:

```ts
import {
  CHECK_SOCKET_ID,
  createSession,
  DEFAULT_TIMER_RANGE,
  plug,
  socketPartId,
  toNetlist,
  type BoardDefinition,
  type BoardSession,
  type MountableKind,
} from '@ojt/board-model';
import {
  COIL_OHMS,
  DEFAULT_LAYER_SHORT_RATIO,
  SOCKET_CONTACT_PINS,
  terminalId,
  type Netlist,
  type TerminalId,
} from '@ojt/circuit-sim';
import { injectPartFaults } from './faults.js';
import { hashSeed, mulberry32, pickIndex } from './rng.js';
import { toSocketRoles } from './schema/common.js';
import {
  SOCKET_COIL_ELEMENT_INDEX,
  socketContactElementIndex,
  type FaultSpecData,
} from './schema/faults.js';
import type { InspectPartData, InspectPartsProblem, PartTruth } from './schema/inspect-parts.js';
import type { ProblemIssue } from './schema/index.js';

/**
 * モードC1（部品点検）のドメイン。設計仕様 §9.1。
 * トレイの部品をチェック用ソケットに挿し、`truth` に対応する故障を注入したネットリストを作る。
 * チェック用ソケットは回り込みが起きない構成（赤PBのa接点でコイルだけを励磁する固定配線）なので、
 * 「リレーを抜いて測る」教育がそのまま成立する（§6.3 / §9.1 C2との違い）。
 */

/** チェック用ソケットの部品ID。§6.4 */
export const CHECK_PART_ID = 'CHK';

/** チェック用ソケットのコイル（−）端子。§9.1 測定1 */
export const CHECK_COIL_MINUS: TerminalId = terminalId(CHECK_PART_ID, '13');
/** チェック用ソケットのコイル（＋）端子。§9.1 測定1 */
export const CHECK_COIL_PLUS: TerminalId = terminalId(CHECK_PART_ID, '14');

/**
 * チェック用ソケットに挿したタイマの設定時間[ms]。
 * 点検はタイムアップを見るだけなので短くしてある（実機の設定つまみとは無関係）。
 */
export const CHECK_TIMER_PRESET_MS = 1000;

/** 励磁（タイマはタイムアップ）を待つ時間[ms]。§9.1 切り分け手順① */
export function checkSettleMs(kind: MountableKind): number {
  return kind === 'timer-h3y4' ? CHECK_TIMER_PRESET_MS + 100 : 100;
}

/** レアショートと判定するコイル抵抗の割合（正常値の85%以下）。§9.1 補足 / §17.2 #7 */
export const LAYER_SHORT_JUDGE_RATIO = 0.85;

/** レアショートの判定しきい値[Ω]。既定のコイル（650Ω）なら 552.5Ω。§9.1 補足 */
export function layerShortThresholdOhms(nominalOhms: number = COIL_OHMS): number {
  return nominalOhms * LAYER_SHORT_JUDGE_RATIO;
}

/** マークシートの選択肢の表示名。§9.1 回答 */
export const PART_TRUTH_LABELS: Readonly<Record<PartTruth, string>> = {
  normal: '正常',
  'coil-open': 'コイル断線',
  'coil-layer-short': 'レアショート',
  'a-open': 'a接点 導通不良',
  'a-weld': 'a接点 溶着',
  'b-open': 'b接点 導通不良',
  'b-weld': 'b接点 溶着',
};

/** 判定表の1行（ヘルプの折りたたみパネルに出す）。§9.1 */
export interface DiagnosisRow {
  /** チェック状況。 */
  situation: string;
  /** その状況から導かれる原因。 */
  cause: PartTruth;
}

/** §9.1 の判定表（調査資料 §6.3）。ヘルプ表示とテストの唯一の源。 */
export const DIAGNOSIS_TABLE: readonly DiagnosisRow[] = [
  { situation: '赤PBを押してもコイルが吸引しない ＋ コイル抵抗が OL（測定不能）', cause: 'coil-open' },
  { situation: 'ON時に a接点 導通なし', cause: 'a-open' },
  { situation: 'OFF時に a接点 導通あり', cause: 'a-weld' },
  { situation: 'ON時に b接点 導通あり', cause: 'b-weld' },
  { situation: 'OFF時に b接点 導通なし', cause: 'b-open' },
  { situation: '動作も接点も正常 ＋ コイル抵抗が約650Ω（正常の85%超）', cause: 'normal' },
  {
    situation: '動作も接点も正常 ＋ コイル抵抗が正常の85%以下（本アプリの既定は約420Ω）',
    cause: 'coil-layer-short',
  },
];

/** 接点1組ぶんの端子（COM・a接点・b接点）。§6.2 */
export function checkContactTerminals(group: number): {
  com: TerminalId;
  no: TerminalId;
  nc: TerminalId;
} {
  const pins = SOCKET_CONTACT_PINS[group - 1];
  if (pins === undefined) throw new RangeError(`接点の組は1〜4です: ${group}`);
  return {
    com: terminalId(CHECK_PART_ID, String(pins.com)),
    no: terminalId(CHECK_PART_ID, String(pins.no)),
    nc: terminalId(CHECK_PART_ID, String(pins.nc)),
  };
}

/** その `truth` のときテスターが示すはずの値。§9.1 判定表 */
export interface ExpectedCheckReading {
  /** 赤PBを押したとき接点が動作位置へ移るか（タイマはタイムアップするか）。 */
  picksUp: boolean;
  /** コイル抵抗[Ω]。`null` は `OL`（測定不能＝断線）。 */
  coilOhms: number | null;
  /** 励磁OFF時に a接点が導通するか。 */
  aClosedOff: boolean;
  /** 励磁ON時に a接点が導通するか。 */
  aClosedOn: boolean;
  /** 励磁OFF時に b接点が導通するか。 */
  bClosedOff: boolean;
  /** 励磁ON時に b接点が導通するか。 */
  bClosedOn: boolean;
}

/** 正常品の読値。 */
const NORMAL_READING: ExpectedCheckReading = {
  picksUp: true,
  coilOhms: COIL_OHMS,
  aClosedOff: false,
  aClosedOn: true,
  bClosedOff: true,
  bClosedOn: false,
};

/**
 * その部品を §9.1 の手順で点検したときの読値。判定表そのものであり、テストとヘルプの唯一の源。
 * 溶着は組のもう一方の接点を機械的に開くので（§7.5 / `injectFault`）、a溶着ならb接点は
 * ON/OFFとも導通しない（「b接点の導通不良」に見えるが答えは「a接点の溶着」。調査資料 §6.1）。
 */
export function expectedCheckReading(part: InspectPartData): ExpectedCheckReading {
  switch (part.truth) {
    case 'normal':
      return { ...NORMAL_READING };
    case 'coil-open':
      return {
        picksUp: false,
        coilOhms: null,
        aClosedOff: false,
        aClosedOn: false,
        bClosedOff: true,
        bClosedOn: true,
      };
    case 'coil-layer-short':
      return { ...NORMAL_READING, coilOhms: COIL_OHMS * (part.ratio ?? DEFAULT_LAYER_SHORT_RATIO) };
    case 'a-open':
      return { ...NORMAL_READING, aClosedOn: false };
    case 'a-weld':
      return { ...NORMAL_READING, aClosedOff: true, bClosedOff: false, bClosedOn: false };
    case 'b-open':
      return { ...NORMAL_READING, bClosedOff: false, bClosedOn: false };
    case 'b-weld':
      return { ...NORMAL_READING, aClosedOff: false, aClosedOn: false, bClosedOn: true };
  }
}

/**
 * 接点の不良をどの組に入れるか。§7.5「組の選択」
 * 課題が `group` を書いていればそれを使い、書いていなければ課題の `seed` と部品IDから
 * 決定論的に決める（同じ課題・同じ部品からは必ず同じ組になる）。
 * 訓練者の解答は「どの組か」を問わないので、UIはこの値を表示しない。
 */
export function faultGroupOf(problem: InspectPartsProblem, part: InspectPartData): number {
  if (part.group !== undefined) return part.group;
  const random = mulberry32(hashSeed(`${String(problem.seed)}:${part.id}`));
  return pickIndex(random, 4) + 1;
}

/** `truth` を §5.4 の故障に直す（正常品は undefined）。§7.5 */
export function truthFault(
  problem: InspectPartsProblem,
  part: InspectPartData,
): FaultSpecData | undefined {
  const coil = { partId: CHECK_PART_ID, elementIndex: SOCKET_COIL_ELEMENT_INDEX };
  switch (part.truth) {
    case 'normal':
      return undefined;
    case 'coil-open':
      return { target: coil, kind: 'coil-open' };
    case 'coil-layer-short':
      return {
        target: coil,
        kind: 'coil-layer-short',
        ...(part.ratio === undefined ? {} : { ratio: part.ratio }),
      };
    case 'a-open':
    case 'a-weld':
    case 'b-open':
    case 'b-weld': {
      const contact = part.truth.startsWith('a-') ? 'a' : 'b';
      const kind = part.truth.endsWith('-weld') ? 'contact-welded' : 'contact-open';
      return {
        target: {
          partId: CHECK_PART_ID,
          elementIndex: socketContactElementIndex(faultGroupOf(problem, part), contact),
        },
        kind,
      };
    }
  }
}

/** 点検用の回路（盤セッション＋故障注入済みネットリスト＋故障を入れた接点組）。 */
export interface CheckCircuit {
  session: BoardSession;
  netlist: Netlist;
  /** 接点の不良を入れた組（1〜4）。接点以外の `truth` でも値は決まる。 */
  group: number;
}

/** 構築結果（課題データの誤りは `ProblemIssue` で返す。§13 #2）。 */
export type CheckCircuitResult =
  { ok: true; value: CheckCircuit } | { ok: false; errors: ProblemIssue[] };

/**
 * トレイの部品1個をチェック用ソケットに挿した回路を作る。§9.1
 * 盤にはこの部品しか載らない（訓練者の配線は無く、既設のチェック用回路だけが繋がっている）。
 * 赤PB（PB4）を押すとコイルが励磁され、離すとコイル端子は母線から切り離される。
 */
export function buildCheckCircuit(
  problem: InspectPartsProblem,
  board: BoardDefinition,
  partId: string,
): CheckCircuitResult {
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
  const part = problem.parts.find((p) => p.id === partId);
  if (part === undefined) {
    return { ok: false, errors: [{ path: 'parts', message: `部品が見つかりません: ${partId}` }] };
  }
  const roles = toSocketRoles(problem.board.socketRoles);
  const session = createSession(board, { roles, inventory: [{ kind: part.kind, count: 1 }] });
  const mounted = plug(
    session,
    CHECK_SOCKET_ID,
    part.kind,
    part.kind === 'timer-h3y4'
      ? { presetMs: CHECK_TIMER_PRESET_MS, rangeMaxMs: DEFAULT_TIMER_RANGE.maxMs }
      : {},
  );
  if (!mounted.ok) {
    return { ok: false, errors: [{ path: 'parts', message: mounted.message }] };
  }
  /* c8 ignore next -- 盤定義がチェック用ソケットを固定しているため到達しない(防御的チェック) */
  if (socketPartId(roles, CHECK_SOCKET_ID) !== CHECK_PART_ID) {
    return {
      ok: false,
      errors: [
        { path: 'board.socketRoles', message: `チェック用ソケットが ${CHECK_SOCKET_ID} にありません` },
      ],
    };
  }
  const netlist = toNetlist(session, board);
  const fault = truthFault(problem, part);
  const issues = fault === undefined ? [] : injectPartFaults(netlist, [fault]);
  if (issues.length > 0) return { ok: false, errors: issues };
  return { ok: true, value: { session, netlist, group: faultGroupOf(problem, part) } };
}
```

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/inspect-parts.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  25 passed (25)`。

- [ ] **Step 5: コミットする**

```powershell
git add packages/content/src/inspect-parts.ts packages/content/test/inspect-parts.test.ts
git commit -m @'
feat(content): add mode C1 check socket circuit and diagnosis table

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 10: `src/inspect-repair.ts` — C2のドメイン（初期盤・修復・改造）

**Files:**
- Modify: `packages/content/src/reference.ts`
- Create: `packages/content/src/inspect-repair.ts`
- Test: `packages/content/test/inspect-repair.test.ts`

§9.2 の「青線で配線済みの盤に故障が注入された状態で開始する」を作り、修復の判定材料（改造・追加した電線）を出す。

| 決めたこと | 内容 | 根拠 |
|---|---|---|
| 初期配線 | 模範回路を**青**で生成してから `faults` を適用する。生成後に `session.allowedColors` を **白のみ**に差し替えるので、訓練者が新しく引ける線は白だけになる | §9.2 / §8.1 |
| 改造 | 「故障箇所でない青線を削除した本数」。初期状態にあった電線のうち、提出時に消えていて、かつ故障箇所（`wire-open` / `wire-misrouted` の電線）でないもの | §9.2 |
| 白線ルール | 初期状態に無い電線（＝訓練者が引いた電線）が白でなければ違反。既存の `checkWireColorRule` に「初期からあった電線ID」を渡して検査する（Task 11） | §9.2 / §8.1 |
| 部品交換 | `replacePart(circuit, partId)` がその部品の故障を捨てた新しい回路を返す。以後のネットリストには注入されない＝良品に差し替えたのと同じ | §9.2 |

- [ ] **Step 1: `reference.ts` に回路図要素の割当を持たせる**

`packages/content/src/reference.ts` の import に次を足す:

```ts
import { toSession, type CellAssignment } from '@ojt/schematic-core';
```

（既存の `import { toSession } from '@ojt/schematic-core';` を上の1行に置き換える。）

`ReferenceCircuit` を次に置き換える:

```ts
/** 模範回路（盤セッション＋ネットリスト＋回路図要素の物理割当）。 */
export interface ReferenceCircuit {
  session: BoardSession;
  netlist: Netlist;
  roles: SocketRoles;
  /** 回路図の要素 → 物理端子の対応。C2の連動ハイライト（§9.2）と指摘の説明に使う。 */
  cells: readonly CellAssignment[];
}
```

`buildReferenceSession()` の戻り値を次に置き換える:

```ts
  return {
    ok: true,
    value: {
      session: built.session,
      netlist: toNetlist(built.session, board),
      roles: built.assignment.roles,
      cells: built.assignment.cells,
    },
  };
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/content/test/inspect-repair.test.ts`:

```ts
import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import { findPart, loadOhms, toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  addedWireIds,
  buildInspectRepairCircuit,
  INITIAL_WIRE_COLOR,
  modificationWireIds,
  repairNetlist,
  replacePart,
  REPAIR_WIRE_COLOR,
} from '../src/inspect-repair.js';
import { runOperations } from '../src/runner.js';
import { inspectRepairProblemJson, parseInspectRepairOrThrow } from './helpers/inspect.js';

/** 既定の課題（`sw-005` 断線 ＋ `sw-009` 未配線）で初期盤を作る。 */
function circuit() {
  const problem = parseInspectRepairOrThrow(inspectRepairProblemJson());
  const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, circuit: built.value };
}

describe('buildInspectRepairCircuit', () => {
  it('starts from the blue reference wiring and only allows white for repairs (§8.1 / §9.2)', () => {
    const { circuit: c } = circuit();
    expect(INITIAL_WIRE_COLOR).toBe('青');
    expect(REPAIR_WIRE_COLOR).toBe('白');
    expect(c.session.allowedColors).toEqual(['白']);
    for (const wire of c.session.wires) expect(wire.color).toBe('青');
  });

  it('applies the faults to the board the trainee sees', () => {
    const { circuit: c } = circuit();
    expect(c.session.wires.find((w) => w.id === 'sw-005')?.open).toBe(true);
    expect(c.session.wires.some((w) => w.id === 'sw-009')).toBe(false);
    expect(c.applied.sites).toHaveLength(2);
    expect(c.initialWireIds).not.toContain('sw-009');
    expect(c.initialWireIds).toContain('sw-005');
  });

  it('exposes the schematic cell assignment for the linked highlight (§9.2)', () => {
    const { circuit: c } = circuit();
    const coil = c.cells.find((cell) => cell.cellId === 'c03');
    expect(coil?.device).toBe('CR1');
    expect(coil?.left).toBe('CR1.14');
    expect(coil?.right).toBe('CR1.13');
  });

  it('reports a bad fault target as a problem issue (§13 #2)', () => {
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      faults: [{ target: { wireId: 'sw-999' }, kind: 'wire-open' }],
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.message).toContain('sw-999');
  });
});

describe('repairNetlist', () => {
  it('re-injects the part faults every time the netlist is rebuilt', () => {
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      faults: [{ target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-layer-short', ratio: 0.65 }],
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const { netlist, errors } = repairNetlist(built.value, JIPM_BOARD);
    expect(errors).toEqual([]);
    const coil = findPart(netlist, 'CR1')?.elements[0];
    expect(coil !== undefined && coil.kind === 'load' ? loadOhms(coil) : 0).toBeCloseTo(422.5, 3);
  });

  it('leaves the part healthy after a replacement (§9.2 部品交換)', () => {
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      faults: [{ target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-open' }],
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const replaced = replacePart(built.value, 'CR1');
    expect(replaced.applied.partFaults).toHaveLength(0);
    // 指摘の対象としては残る（交換しても不良だった事実は消えない。§9.2 判定①）
    expect(replaced.applied.sites).toHaveLength(1);
    const { netlist } = repairNetlist(replaced, JIPM_BOARD);
    const coil = findPart(netlist, 'CR1')?.elements[0];
    expect(coil !== undefined && coil.kind === 'load' ? loadOhms(coil) : 0).toBeCloseTo(650, 3);
  });

  it('runs the faulted board and gets a different waveform from the reference', () => {
    const { problem, circuit: c } = circuit();
    const { netlist } = repairNetlist(c, JIPM_BOARD);
    const run = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
    expect(run.log.transitions('PL1').some((e) => e.value === true)).toBe(false);
  });
});

describe('modificationWireIds / addedWireIds', () => {
  it('counts nothing when the trainee has not touched the board', () => {
    const { circuit: c } = circuit();
    expect(modificationWireIds(c, c.session)).toEqual([]);
    expect(addedWireIds(c, c.session)).toEqual([]);
  });

  it('does not count removing a faulty wire as a modification (§9.2)', () => {
    const { circuit: c } = circuit();
    const removed = removeWire(c.session, 'sw-005');
    expect(removed.ok).toBe(true);
    expect(modificationWireIds(c, c.session)).toEqual([]);
  });

  it('counts removing a healthy blue wire as a modification (§9.2 改造)', () => {
    const { circuit: c } = circuit();
    const removed = removeWire(c.session, 'sw-004');
    expect(removed.ok).toBe(true);
    expect(modificationWireIds(c, c.session)).toEqual(['sw-004']);
  });

  it('lists the wires the trainee added', () => {
    const { circuit: c } = circuit();
    const added = addWire(
      c.session,
      JIPM_BOARD,
      toTerminalId('CR1.6'),
      toTerminalId('TB_PL.1+'),
      REPAIR_WIRE_COLOR,
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(addedWireIds(c, c.session)).toEqual([added.value.id]);
  });

  it('refuses a blue repair wire because the palette is white only (§8.1)', () => {
    const { circuit: c } = circuit();
    const added = addWire(
      c.session,
      JIPM_BOARD,
      toTerminalId('CR1.6'),
      toTerminalId('TB_PL.1+'),
      INITIAL_WIRE_COLOR,
    );
    expect(added.ok).toBe(false);
    if (added.ok) return;
    expect(added.code).toBe('color-not-allowed');
  });
});
```

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/inspect-repair.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/inspect-repair.js` で `Test Files  1 failed (1)`。

- [ ] **Step 4: `src/inspect-repair.ts` を書く**

`packages/content/src/inspect-repair.ts`:

```ts
import { toNetlist, type BoardDefinition, type BoardSession } from '@ojt/board-model';
import type { Netlist, WireColor } from '@ojt/circuit-sim';
import type { CellAssignment } from '@ojt/schematic-core';
import { applyFaults, injectPartFaults, withoutPartFaults, type AppliedFaults } from './faults.js';
import { resolveFaults, type ResolveFaultsOptions } from './random-faults.js';
import { buildReferenceSession } from './reference.js';
import type { InspectRepairProblem } from './schema/inspect-repair.js';
import type { ProblemIssue } from './schema/index.js';

/**
 * モードC2（回路点検・修復）のドメイン。設計仕様 §9.2。
 * 模範回路を**青**で組んでから故障を注入し、パレットを**白のみ**に差し替えて訓練者へ渡す。
 * 判定に必要な「初期状態にあった電線ID」と「故障の在処」をここで確定させる。
 */

/** 初期配線の色（＝模範回路の色）。§8.1 / §11.3 */
export const INITIAL_WIRE_COLOR: WireColor = '青';
/** 修復に使える唯一の色。§8.1 / §9.2 */
export const REPAIR_WIRE_COLOR: WireColor = '白';

/** 故障を注入した初期盤。 */
export interface RepairCircuit {
  /** 訓練者に渡す盤（故障適用済み・パレットは白のみ）。 */
  session: BoardSession;
  /** 振り分けた故障（部品の故障はネットリスト変換のたびに注入し直す）。 */
  applied: AppliedFaults;
  /** 故障適用直後の電線ID（改造と白線ルールの基準）。 */
  initialWireIds: readonly string[];
  /** 回路図の要素 → 物理端子の対応（連動ハイライト用）。§9.2 */
  cells: readonly CellAssignment[];
}

/** 構築結果。 */
export type RepairCircuitResult =
  { ok: true; value: RepairCircuit } | { ok: false; errors: ProblemIssue[] };

/**
 * C2の初期盤を作る。§9.2
 * 1. 模範回路を青で組む（＝正しく配線された盤）
 * 2. `faults` を解決する（明示リストならそのまま、ランダムなら seed から引く。§7.5）
 * 3. 故障を適用する（電線はセッションへ、部品はリストへ）
 * 4. パレットを白のみに差し替える（修復は白線だけ。§8.1）
 */
export function buildInspectRepairCircuit(
  problem: InspectRepairProblem,
  board: BoardDefinition,
  options: ResolveFaultsOptions & { resolvedFaults?: readonly FaultSpecData[] } = {},
): RepairCircuitResult {
  const built = buildReferenceSession(problem, board);
  if (!built.ok) return built;
  // 作業ファイルからの再開用（I-4）。解決済みの故障配列を渡されたら `resolveFaults()` を
  // 呼び直さない。seed を指定しない課題は `resolveFaults()` が内部で `Date.now()` を使うため、
  // 再解決すると初回と別の故障になってしまう（2Bはresolve結果を作業ファイルへ保存し、
  // 再開時はここへそのまま渡すこと）。
  const faults: ResolveFaultsResult =
    options.resolvedFaults === undefined
      ? resolveFaults(problem, board, options)
      : { ok: true, value: options.resolvedFaults };
  if (!faults.ok) return faults;
  const session = built.value.session;
  const applied = applyFaults(session, faults.value);
  if (!applied.ok) return applied;
  session.allowedColors = [REPAIR_WIRE_COLOR];
  return {
    ok: true,
    value: {
      session,
      applied: applied.value,
      initialWireIds: session.wires.map((w) => w.id),
      cells: built.value.cells,
    },
  };
}

/**
 * いまの盤からネットリストを作り、残っている部品の故障を注入する。§5.4
 * 部品を交換した（`replacePart()` を通した）あとは、その部品の故障はもう注入されない。
 */
export function repairNetlist(
  circuit: RepairCircuit,
  board: BoardDefinition,
): { netlist: Netlist; errors: ProblemIssue[] } {
  const netlist = toNetlist(circuit.session, board);
  return { netlist, errors: injectPartFaults(netlist, circuit.applied.partFaults) };
}

/** 部品を良品に交換した回路を返す（元の回路は変えない）。§9.2 部品交換 */
export function replacePart(circuit: RepairCircuit, partId: string): RepairCircuit {
  return { ...circuit, applied: withoutPartFaults(circuit.applied, partId) };
}

/** 故障箇所として認められている電線のID（`wire-open` / `wire-misrouted`）。 */
function faultedWireIds(circuit: RepairCircuit): Set<string> {
  const out = new Set<string>();
  for (const site of circuit.applied.sites) {
    if (site.wireId !== undefined) out.add(site.wireId);
  }
  return out;
}

/**
 * 訓練者が新しく引いた電線のID（初期状態に無かった電線）。§9.2
 * 並びは提出されたセッションの電線順（決定論）。
 */
export function addedWireIds(circuit: RepairCircuit, session: BoardSession): string[] {
  const initial = new Set(circuit.initialWireIds);
  return session.wires.filter((w) => !initial.has(w.id)).map((w) => w.id);
}

/**
 * 改造として計上する電線のID。§9.2
 * 「故障箇所でない青線を削除した」もの、すなわち初期状態にあって提出時に消えていて、
 * 故障箇所（断線・誤配線が入っていた電線）でないものを数える。
 * 故障箇所の電線を外して白線で引き直すのは正規の修復なので数えない。
 */
export function modificationWireIds(circuit: RepairCircuit, session: BoardSession): string[] {
  const present = new Set<string>(session.wires.map((w) => w.id));
  const faulted = faultedWireIds(circuit);
  return circuit.initialWireIds.filter((id) => !present.has(id) && !faulted.has(id));
}
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/inspect-repair.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  12 passed (12)`。

- [ ] **Step 6: コミットする**

```powershell
git add packages/content/src/reference.ts packages/content/src/inspect-repair.ts packages/content/test/inspect-repair.test.ts
git commit -m @'
feat(content): build the faulted board and repair bookkeeping for mode C2

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 11: `src/forbidden.ts` と静的チェックの拡張

**Files:**
- Create: `packages/content/src/forbidden.ts`
- Modify: `packages/content/src/static-checks.ts`
- Modify: `packages/content/test/static-checks.test.ts`
- Test: `packages/content/test/forbidden.test.ts`

§7.4 の `forbiddenCircuit` は「Phase 1 はチャタリング検出のみ。**構造パターン照合は Phase 2 で追加する（C2と同じ解析基盤を用いる）**」と定めている。ここで足す。あわせて、C2の線色検査のために `StaticCheckInput` へ「初期からあった電線ID」を渡せるようにする。

**構造パターン照合の考え方（導電グラフの到達可能性で判定する）:**

1. 対象コイル自身を除いた導電グラフを作る。閉接点・負荷・0Ωリンク・断線していない電線を辺とする。
2. 判定したいタイマ集合 `E` の接点だけを「タイムアップ位置」（a接点=閉、b接点=開）に置き、**それ以外の接点はすべて閉**として扱う（最良ケース。コイルが切れるなら原因は `E` のタイマにしかない）。
3. `P.1` から到達できる節点にコイルの＋端子があり、かつ `N.1` から到達できる節点にコイルの−端子があれば「生きている」。どちらか欠ければ `E` に切られている。
4. **自己遮断**: `E = {T}` で切られ、かつ `E = {}`（誰もタイムアップしていない）では生きている → タイマ `T` が自分の限時接点で自コイルを切っている。
5. **2個フリッカ**: タイマ `A`・`B` がどちらも `E = {}` で生きていて、`A` は `E = {B}` で切られ、`B` は `E = {A}` で切られる → 相互に切り合う（リレーを介さないフリッカ）。

`E = {}` で生きていることを条件に入れるのが要点である。これが無いと、断線や未配線でコイルが切れているだけの盤（モードC2の初期状態）を「タイマが自分のコイルを切っている」と誤検出してしまう。

**検証済み（実装前に実回路で確認した結果）:** 内蔵モードB課題8題（`b-001`〜`b-008`）と、それらに Task 15/16 の故障を入れた8通りは**すべて検出0**。禁則ワンショット（タイマ自身のb接点で自コイルを切る）は `timer-self-cut`、タイマ2個フリッカは `timer-pair-flicker`、正常な「T1のb接点でT2を止める順次停止」は検出0になる。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/forbidden.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { createNetlist, createTimer4c, type Part } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '../src/builtin/index.js';
import { findForbiddenPatterns } from '../src/forbidden.js';
import { buildReferenceSession } from '../src/reference.js';
import { parseProblem } from '../src/schema/index.js';
import { selfHoldProblemJson } from './helpers/problems.js';

/** 回路図だけを差し替えた課題のネットリスト。 */
function netlistOf(rungs: unknown[], id: string) {
  const json = {
    ...selfHoldProblemJson(),
    id,
    operations: [],
    durationMs: 3000,
    schematic: {
      formatVersion: 1,
      id: `sch-${id}`,
      title: 'テスト',
      orientation: 'horizontal',
      rungs,
    },
  };
  const parsed = parseProblem(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  if (parsed.problem.mode !== 'assemble') throw new Error('not an assemble problem');
  const built = buildReferenceSession(parsed.problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return built.value.netlist;
}

describe('findForbiddenPatterns', () => {
  it('finds nothing in the eight built-in mode B problems (§7.9)', () => {
    for (const problem of BUILTIN_ASSEMBLE_PROBLEMS) {
      const built = buildReferenceSession(problem, JIPM_BOARD);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(findForbiddenPatterns(built.value.netlist), problem.id).toEqual([]);
    }
  });

  it('detects a timer that cuts its own coil (調査資料 §5.5)', () => {
    const netlist = netlistOf(
      [
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
      'x-f1',
    );
    const found = findForbiddenPatterns(netlist);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('timer-self-cut');
    expect(found[0]?.timerIds).toEqual(['T1']);
    expect(found[0]?.message).toContain('リレーを介して');
  });

  it('still detects the self-cut even if a different, unrelated wire is also broken (M-15)', () => {
    const netlist = netlistOf(
      [
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
      'x-f1b',
    );
    // r2（T1のa接点→表示灯PL1）はコイル自身の導通経路とは別の枝。ここを切ってもコイル側の
    // P/N到達性には関係が無いので、自己遮断の検出（コイル自身の経路だけを見る）には影響しない
    // はずである。「無関係な断線が1本あるだけで自己遮断を見逃す」退行が起きていないか見張る。
    const wire = netlist.wires.find((w) => w.to === 'TB_PL.1+' || w.from === 'TB_PL.1+');
    expect(wire).toBeDefined();
    if (wire === undefined) return;
    wire.open = true;
    const found = findForbiddenPatterns(netlist);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('timer-self-cut');
    expect(found[0]?.timerIds).toEqual(['T1']);
  });

  it('detects a flicker made of two timers only (調査資料 §5.5)', () => {
    const netlist = netlistOf(
      [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-b', id: 'c01', device: 'T2' },
            { kind: 'coil', id: 'c02', device: 'T1', presetMs: 500 },
          ],
        },
        {
          id: 'r2',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-b', id: 'c03', device: 'T1' },
            { kind: 'coil', id: 'c04', device: 'T2', presetMs: 500 },
          ],
        },
        {
          id: 'r3',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-a', id: 'c05', device: 'T1' },
            { kind: 'lamp', id: 'c06', device: 'PL1' },
          ],
        },
      ],
      'x-f2',
    );
    const found = findForbiddenPatterns(netlist);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('timer-pair-flicker');
    expect(found[0]?.timerIds).toEqual(['T1', 'T2']);
  });

  it('does not flag a timer that legitimately stops another timer', () => {
    const netlist = netlistOf(
      [
        {
          id: 'r1',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 'pb-a', id: 'c01', device: 'PB1' },
            { kind: 'coil', id: 'c02', device: 'T1', presetMs: 500 },
          ],
        },
        {
          id: 'r2',
          from: { bus: 'P' },
          to: { bus: 'N' },
          cells: [
            { kind: 't-b', id: 'c03', device: 'T1' },
            { kind: 'coil', id: 'c04', device: 'T2', presetMs: 500 },
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
      'x-f3',
    );
    expect(findForbiddenPatterns(netlist)).toEqual([]);
  });

  it('does not blame the timer when a broken wire cuts its coil', () => {
    const problem = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-003');
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    const built = buildReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) return;
    // `sw-011`（CR1.6 – T1.14）はタイマの電源線。ここを切ってもタイマのせいではない。
    const wire = built.value.netlist.wires.find((w) => w.id === 'sw-011');
    expect(wire).toBeDefined();
    if (wire === undefined) return;
    wire.open = true;
    expect(findForbiddenPatterns(built.value.netlist)).toEqual([]);
  });

  it('returns nothing when the netlist has no P/N supply terminals', () => {
    expect(findForbiddenPatterns(createNetlist([createTimer4c('T1', 500)], [], []))).toEqual([]);
  });

  it('treats a timer without a coil element as already cut (defensive)', () => {
    const timer = createTimer4c('T1', 500);
    const stripped: Part = { ...timer, elements: timer.elements.filter((e) => e.kind !== 'load') };
    expect(findForbiddenPatterns(createNetlist([stripped], [], []))).toEqual([]);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/forbidden.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/forbidden.js` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `src/forbidden.ts` を書く**

`packages/content/src/forbidden.ts`:

```ts
import { N_RAIL_ID, P_RAIL_ID } from '@ojt/board-model';
import { buildNets, terminalId, type Netlist, type Part, type TerminalId } from '@ojt/circuit-sim';

/**
 * 禁則回路の構造パターン照合。設計仕様 §7.4 / §5.3.2 / 調査資料 §5.5。
 *
 * Phase 1 はチャタリング検出だけで判定していた（復帰時間モデルにより禁則回路は必ず
 * tick 周期で反転するため検出漏れは無い）。Phase 2 では「なぜ駄目なのか」を言えるように、
 * ネットリストの導電グラフから2つのパターンを構造的に見つける。
 *
 * 判定の骨組みは「対象コイル自身を経路から外した導電グラフで、指定したタイマだけを
 * タイムアップ位置に置き、それ以外の接点はすべて閉として、コイルの両端が P / N から
 * 到達できるか」を見るだけである。**誰もタイムアップしていない状態で既に切れているコイルは
 * 対象外**にするので、断線・未配線でコイルが死んでいるだけの盤（モードC2の初期状態）を
 * タイマのせいにしない。
 */

/** 見つかったパターンの種別。 */
export type ForbiddenPatternKind = 'timer-self-cut' | 'timer-pair-flicker';

/** 見つかった禁則回路1件。 */
export interface ForbiddenPattern {
  kind: ForbiddenPatternKind;
  /** 関係するタイマの部品ID（自己遮断は1個、2個フリッカは2個。昇順）。 */
  timerIds: readonly string[];
  /** 結果画面に出す説明。 */
  message: string;
}

/** P母線の供給端子。§6.4 */
const P_TERMINAL: TerminalId = terminalId(P_RAIL_ID, '1');
/** N母線の供給端子。§6.4 */
const N_TERMINAL: TerminalId = terminalId(N_RAIL_ID, '1');

/** そのタイマのコイル要素（負荷要素はコイル1つだけ）。 */
function coilOf(timer: Part): { id: string; from: TerminalId; to: TerminalId } | undefined {
  for (const el of timer.elements) {
    if (el.kind === 'load') return { id: el.id, from: el.from, to: el.to };
  }
  return undefined;
}

/**
 * そのコイルが P / N から到達できないか（＝切られているか）を調べる。
 * `energized` に入れたタイマの接点だけをタイムアップ位置（a=閉 / b=開）にし、
 * それ以外の接点はすべて閉とみなす（最良ケース）。
 */
function isCoilCut(netlist: Netlist, timer: Part, energized: ReadonlySet<string>): boolean {
  const coil = coilOf(timer);
  if (coil === undefined) return true;
  const nets = buildNets(netlist);
  if (!nets.hasTerminal(P_TERMINAL) || !nets.hasTerminal(N_TERMINAL)) return false;
  const adjacency = new Map<number, number[]>();
  const push = (from: number, to: number): void => {
    const list = adjacency.get(from);
    if (list === undefined) adjacency.set(from, [to]);
    else list.push(to);
  };
  const connect = (a: TerminalId, b: TerminalId): void => {
    const na = nets.nodeOf(a);
    const nb = nets.nodeOf(b);
    push(na, nb);
    push(nb, na);
  };
  for (const part of netlist.parts) {
    for (const el of part.elements) {
      if (el.id === coil.id) continue;
      if (el.kind === 'contact') {
        const timedOut = el.driver === 'timer' && energized.has(el.driverId);
        if (timedOut ? el.contact === 'a' : true) connect(el.from, el.to);
      } else if (el.kind === 'load' || el.kind === 'link') {
        connect(el.from, el.to);
      }
    }
  }
  const walk = (start: TerminalId): Set<number> => {
    const first = nets.nodeOf(start);
    const seen = new Set<number>([first]);
    const stack = [first];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) break;
      for (const next of adjacency.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return seen;
  };
  const fromP = walk(P_TERMINAL);
  const fromN = walk(N_TERMINAL);
  return !(fromP.has(nets.nodeOf(coil.from)) && fromN.has(nets.nodeOf(coil.to)));
}

/**
 * 禁則回路を構造から見つける。§7.4
 * 戻り値は自己遮断（部品ID順）→ 2個フリッカ（組の昇順）の順。空配列なら問題なし。
 */
export function findForbiddenPatterns(netlist: Netlist): ForbiddenPattern[] {
  const timers = netlist.parts.filter((p) => p.meta.kind === 'timer-h3y4');
  if (timers.length === 0) return [];
  const alive = new Map<string, boolean>();
  const cutBy = new Map<string, Set<string>>();
  for (const timer of timers) {
    alive.set(timer.id, !isCoilCut(netlist, timer, new Set()));
    const cut = new Set<string>();
    for (const other of timers) {
      if (isCoilCut(netlist, timer, new Set([other.id]))) cut.add(other.id);
    }
    cutBy.set(timer.id, cut);
  }
  const out: ForbiddenPattern[] = [];
  for (const timer of timers) {
    if (alive.get(timer.id) !== true) continue;
    if (cutBy.get(timer.id)?.has(timer.id) !== true) continue;
    out.push({
      kind: 'timer-self-cut',
      timerIds: [timer.id],
      message: `${timer.id} はタイマ自身の限時接点で自分のコイルを切っています（リレーを介してください）`,
    });
  }
  for (let i = 0; i < timers.length; i += 1) {
    for (let j = i + 1; j < timers.length; j += 1) {
      const a = timers[i];
      const b = timers[j];
      if (a === undefined || b === undefined) continue;
      if (alive.get(a.id) !== true || alive.get(b.id) !== true) continue;
      if (cutBy.get(a.id)?.has(b.id) !== true) continue;
      if (cutBy.get(b.id)?.has(a.id) !== true) continue;
      out.push({
        kind: 'timer-pair-flicker',
        timerIds: [a.id, b.id],
        message: `${a.id}・${b.id} はタイマ2個だけでフリッカ回路を構成しています（リレーを介してください）`,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: GREEN を確認する（構造照合）**

```powershell
pnpm --filter @ojt/content exec vitest run test/forbidden.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  8 passed (8)`。

- [ ] **Step 5: 静的チェックのテストを直す／足す**

`packages/content/test/static-checks.test.ts` の import に次を足す（`../src/static-checks.js` の import の直後）:

```ts
import { REPAIR_WIRE_COLOR } from '../src/inspect-repair.js';
```

`describe('checkForbiddenCircuit', …)` の中の `it('reports one line per user-visible signal instead of one per contact element', …)` を次に置き換える（構造照合の行が1行増える）:

```ts
  it('reports one line per user-visible signal plus the structural finding', () => {
    const input = inputFor(forbiddenOneShotProblemJson());
    expect(input.chatters.length).toBeGreaterThan(10);
    const details = checkForbiddenCircuit(input).details;
    const signals = details.map((d) => d.slice(0, d.indexOf(':')));
    expect(signals).toEqual(['T1', 'PL1', 'T1.coil', '構造']);
    expect(new Set(signals).size).toBe(signals.length);
    expect(details[0]).toContain('回反転しました');
    expect(details[3]).toContain('自分のコイルを切っています');
  });
```

同じ `describe` の末尾に1件足す:

```ts
  it('reports the structural pattern even without chattering (§7.4 Phase 2)', () => {
    const input = inputFor(forbiddenOneShotProblemJson());
    const result = checkForbiddenCircuit({ ...input, chatters: [] });
    expect(result.ok).toBe(false);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toContain('構造');
  });
```

`describe('checkWireColorRule', …)` の末尾に1件足す:

```ts
  it('exempts the wires that were already on the board (§9.2 の修復)', () => {
    const input = inputFor(selfHoldProblemJson());
    const blue = input.session.wires.find((w) => !w.locked);
    if (blue === undefined) throw new Error('no editable wire');
    const repaired: StaticCheckInput = {
      ...input,
      allowedColors: [REPAIR_WIRE_COLOR],
      preexistingWireIds: new Set(input.session.wires.map((w) => w.id)),
    };
    expect(checkWireColorRule(repaired).ok).toBe(true);
    const withNewBlue: StaticCheckInput = {
      ...repaired,
      preexistingWireIds: new Set(
        input.session.wires.filter((w) => w.id !== blue.id).map((w) => w.id),
      ),
    };
    const result = checkWireColorRule(withNewBlue);
    expect(result.ok).toBe(false);
    expect(result.details[0]).toContain(blue.id);
  });
```

- [ ] **Step 6: `src/static-checks.ts` を直す**

`packages/content/src/static-checks.ts` の import に次を足す:

```ts
import { findForbiddenPatterns } from './forbidden.js';
```

`StaticCheckInput` に1つ足す:

```ts
/** チェックの入力（訓練者側の盤・ネットリスト・再生結果）。 */
export interface StaticCheckInput {
  session: BoardSession;
  netlist: Netlist;
  log: SignalLog;
  hazards: readonly HazardEvent[];
  chatters: readonly ChatterEvent[];
  /** 新規配線に使ってよい線色。モードB・Dは青のみ、モードC2は白のみ。§8.1 */
  allowedColors: readonly WireColor[];
  /**
   * 課題の開始時点で既に盤にあった電線のID。線色の検査から外す。§9.2
   * モードC2は「初期配線は青のまま・修復だけ白」なので、残っている青線を違反にしない。
   * モードBでは渡さない（訓練者が引いた電線しか無いため）。
   */
  preexistingWireIds?: ReadonlySet<string>;
}
```

`checkWireColorRule()` の本体を次に置き換える:

```ts
export function checkWireColorRule(input: StaticCheckInput): StaticCheckResult {
  const details: string[] = [];
  for (const wire of input.session.wires) {
    if (wire.locked) continue;
    if (input.preexistingWireIds?.has(wire.id) === true) continue;
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
```

`checkForbiddenCircuit()` の本体を次に置き換える（チャタリングの行はそのまま先頭に残し、構造照合の行を後ろに足す）:

```ts
/**
 * 禁則回路。§7.4 / §5.3.2 / 調査資料 §5.5
 * 判定は2本立てである。
 * ①判定区間でチャタリングを検出したか（Phase 1 から。復帰時間モデルにより禁則回路は
 *   必ず tick 周期で反転するので取りこぼさない）
 * ②ネットリストの構造がタイマ自己遮断／タイマ2個フリッカのパターンに一致するか（Phase 2 で追加）
 *
 * 1つの震えは（接点要素ごと・1秒窓ごとに）何十件ものイベントになるため、そのまま並べると
 * 結果画面が同じ内容で埋まる。信号ごとに最初の1件だけを出す（§8.3）。
 * 構造照合の行は「構造:」で始め、チャタリングの行（信号名で始まる）と混ざらないようにする。
 */
export function checkForbiddenCircuit(input: StaticCheckInput): StaticCheckResult {
  const seen = new Set<string>();
  const details: string[] = [];
  for (const e of input.chatters) {
    const signal = visibleChatterSignal(e.signal);
    if (seen.has(signal)) continue;
    seen.add(signal);
    details.push(`${signal}: ${e.tMs}ms 付近で1秒間に${e.count}回反転しました`);
  }
  for (const pattern of findForbiddenPatterns(input.netlist)) {
    details.push(`構造: ${pattern.message}`);
  }
  return result(
    'forbiddenCircuit',
    details,
    '禁則回路は検出されませんでした',
    'タイマの接点で自分のコイルを切る回路は実機では動作が不安定になります（リレーを介してください）',
  );
}
```

- [ ] **Step 7: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/static-checks.test.ts test/forbidden.test.ts test/judge.test.ts test/builtin.test.ts
```

Expected: `Test Files  4 passed (4)`。内蔵課題8題は構造照合でも検出0なので `test/builtin.test.ts` の自己整合テストは通ったままになる。

- [ ] **Step 8: コミットする**

```powershell
git add packages/content/src/forbidden.ts packages/content/src/static-checks.ts packages/content/test/forbidden.test.ts packages/content/test/static-checks.test.ts
git commit -m @'
feat(content): add structural detection of forbidden timer circuits

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---
## Task 12: `src/judge-inspect.ts` — C1/C2の判定

**Files:**
- Modify: `packages/content/src/judge.ts`（`countHazards()` を公開する）
- Create: `packages/content/src/judge-inspect.ts`
- Test: `packages/content/test/judge-inspect.test.ts`

§9.1 と §9.2 の判定を実装する。危険操作の集計は Plan 1C の `countHazards()`（`HAZARD_KINDS` を唯一の源にする）をそのまま使い回すので、`ohm-on-live` と `range-exceeded` も自動的に結果へ載る（§5.6）。

| 判定 | 合格条件 | 根拠 |
|---|---|---|
| C1 | 全部品の解答が `truth` と一致（部分正解は `n/m 正解` として表示する） | §9.1 判定 |
| C2 | ①全故障を過不足なく指摘 ②修復後の動作が模範と一致 ③白線ルール違反0（`wireColorRule`）④改造0 | §9.2 合格条件 |
| 共通 | 危険操作回数と所要時間は**記録するだけで合否に影響しない** | §7.4 / §17.2 #3 |

- [ ] **Step 1: `judge.ts` の `countHazards()` を公開する**

`packages/content/src/judge.ts` の `countHazards` の定義行を次に置き換える（本文は無変更）:

```ts
/**
 * 危険操作の種別ごとの回数を数える。種別の集合は circuit-sim の `HAZARD_KINDS` を唯一の源とするので、
 * エンジン側に種別が増えても結果画面の集計は自動で追随する（§5.6）。
 * モードC1/C2の判定（`judge-inspect.ts`）からも同じ関数を使う。
 */
export function countHazards(hazards: readonly HazardEvent[]): HazardCounts {
```

`packages/content/src/judge.ts` の `JudgeResult` の定義を次に置き換える（`mode` を足し、`JudgeInspectPartsResult` / `JudgeInspectRepairResult` と同じ形で判別できるようにする。I-3）:

```ts
/** 判定結果。§7.4 / §8.3 */
export interface JudgeResult {
  /** モードBの判定であることの印（`JudgeInspectPartsResult` / `JudgeInspectRepairResult` と `mode` で判別する）。 */
  mode: 'assemble';
  /** 動作一致かつ有効な静的チェックにエラーが無い。§7.4 */
  passed: boolean;
```

`judgeAssemble()` の戻り値の先頭に `mode: 'assemble'` を足す:

```ts
  return {
    ok: true,
    value: {
      mode: 'assemble',
      passed: mismatches.length === 0 && staticChecks.every((c) => c.ok),
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/content/test/judge-inspect.test.ts`:

```ts
import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import { toTerminalId, type HazardEvent } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { buildInspectRepairCircuit, replacePart, REPAIR_WIRE_COLOR } from '../src/inspect-repair.js';
import {
  judgeInspectParts,
  judgeInspectRepair,
  scoreReports,
  type InspectPartAnswer,
} from '../src/judge-inspect.js';
import type { FaultReport } from '../src/faults.js';
import {
  inspectPartsProblemJson,
  inspectRepairProblemJson,
  parseInspectPartsOrThrow,
  parseInspectRepairOrThrow,
} from './helpers/inspect.js';

const OHM_ON_LIVE: HazardEvent = {
  type: 'hazard',
  kind: 'ohm-on-live',
  tMs: 1200,
  detail: 'CHK.13-CHK.14',
};

/** 既定の課題（`sw-005` 断線 ＋ `sw-009` 未配線）で初期盤を作る。 */
function repairCircuit() {
  const problem = parseInspectRepairOrThrow(inspectRepairProblemJson());
  const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, circuit: built.value };
}

/** 正しい指摘2件。 */
const CORRECT_REPORTS: FaultReport[] = [
  { target: { wireId: 'sw-005' }, kind: 'wire-open' },
  { target: { terminalId: 'CR1.6' }, kind: 'wire-missing' },
];

describe('judgeInspectParts', () => {
  it('passes when every answer matches the truth (§9.1)', () => {
    const problem = parseInspectPartsOrThrow(inspectPartsProblemJson());
    const answers: InspectPartAnswer[] = problem.parts.map((p) => ({
      partId: p.id,
      answer: p.truth,
    }));
    const result = judgeInspectParts(problem, answers);
    expect(result.mode).toBe('inspect-parts');
    expect(result.passed).toBe(true);
    expect(result.correctCount).toBe(4);
    expect(result.total).toBe(4);
  });

  it('受入基準②: コイル断線とレアショートを選び分けられれば正解になる', () => {
    const problem = parseInspectPartsOrThrow(inspectPartsProblemJson());
    const result = judgeInspectParts(problem, [
      { partId: 'p1', answer: 'normal' },
      { partId: 'p2', answer: 'coil-open' },
      { partId: 'p3', answer: 'coil-layer-short' },
      { partId: 'p4', answer: 'a-weld' },
    ]);
    expect(result.passed).toBe(true);
    expect(result.scores.find((s) => s.partId === 'p2')?.correct).toBe(true);
    expect(result.scores.find((s) => s.partId === 'p3')?.correct).toBe(true);
  });

  it('reports a partial score and marks the wrong rows (§9.1)', () => {
    const problem = parseInspectPartsOrThrow(inspectPartsProblemJson());
    const result = judgeInspectParts(problem, [
      { partId: 'p1', answer: 'normal' },
      { partId: 'p2', answer: 'coil-open' },
      { partId: 'p3', answer: 'normal' },
    ]);
    expect(result.passed).toBe(false);
    expect(result.correctCount).toBe(2);
    expect(result.total).toBe(4);
    expect(result.scores.find((s) => s.partId === 'p3')?.correct).toBe(false);
    expect(result.scores.find((s) => s.partId === 'p4')?.answer).toBeUndefined();
  });

  it('records hazards and elapsed time without changing the verdict (§17.2 #3)', () => {
    const problem = parseInspectPartsOrThrow(inspectPartsProblemJson());
    const answers: InspectPartAnswer[] = problem.parts.map((p) => ({
      partId: p.id,
      answer: p.truth,
    }));
    const result = judgeInspectParts(problem, answers, {
      elapsedMs: 900_000,
      sessionHazards: [OHM_ON_LIVE],
    });
    expect(result.passed).toBe(true);
    expect(result.hazardCount).toBe(1);
    expect(result.hazardsByKind['ohm-on-live']).toBe(1);
    expect(result.hazardsByKind['range-exceeded']).toBe(0);
    expect(result.elapsedMs).toBe(900_000);
  });
});

describe('scoreReports', () => {
  it('splits the reports into matched, missed and extra (§9.2)', () => {
    const { circuit } = repairCircuit();
    const scored = scoreReports(circuit.applied.sites, [
      ...CORRECT_REPORTS,
      { target: { wireId: 'sw-004' }, kind: 'wire-open' },
    ]);
    expect(scored.matched).toHaveLength(2);
    expect(scored.missed).toHaveLength(0);
    expect(scored.extra).toHaveLength(1);
  });

  it('counts an unreported fault as missed', () => {
    const { circuit } = repairCircuit();
    const first = CORRECT_REPORTS[0];
    if (first === undefined) return;
    const scored = scoreReports(circuit.applied.sites, [first]);
    expect(scored.matched).toHaveLength(1);
    expect(scored.missed).toHaveLength(1);
    expect(scored.missed[0]?.kind).toBe('wire-missing');
  });

  it('never lets one report cover two faults', () => {
    const { circuit } = repairCircuit();
    const first = CORRECT_REPORTS[0];
    if (first === undefined) return;
    const scored = scoreReports(circuit.applied.sites, [first, first]);
    expect(scored.matched).toHaveLength(1);
    expect(scored.extra).toHaveLength(1);
  });
});

describe('judgeInspectRepair', () => {
  /** 白線で正しく修復する（断線した青線を外して張り直し、未配線を足す）。 */
  function repair(session: ReturnType<typeof repairCircuit>['circuit']['session']): void {
    const removed = removeWire(session, 'sw-005');
    if (!removed.ok) throw new Error(removed.message);
    const a = addWire(
      session,
      JIPM_BOARD,
      toTerminalId('TB_PB.1a'),
      toTerminalId('CR1.14'),
      REPAIR_WIRE_COLOR,
    );
    if (!a.ok) throw new Error(a.message);
    const b = addWire(
      session,
      JIPM_BOARD,
      toTerminalId('CR1.6'),
      toTerminalId('TB_PL.1+'),
      REPAIR_WIRE_COLOR,
    );
    if (!b.ok) throw new Error(b.message);
  }

  it('受入基準③: 故障2箇所を指摘し白線で修復すると合格する (§9.2)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.mode).toBe('inspect-repair');
    expect(judged.value.passed).toBe(true);
    expect(judged.value.mismatches).toEqual([]);
    expect(judged.value.reports.missed).toEqual([]);
    expect(judged.value.reports.extra).toEqual([]);
    expect(judged.value.modifications).toEqual([]);
    expect(judged.value.addedWires).toHaveLength(2);
    expect(judged.value.staticChecks.every((c) => c.ok)).toBe(true);
    expect(judged.value.charts.expected.signals.length).toBeGreaterThan(0);
  });

  it('fails when the board still behaves differently from the reference', () => {
    const { problem, circuit } = repairCircuit();
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.mismatches.length).toBeGreaterThan(0);
  });

  it('fails when a fault is missed even though the behaviour is right', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const first = CORRECT_REPORTS[0];
    if (first === undefined) return;
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, [first]);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(false);
    expect(judged.value.reports.missed).toHaveLength(1);
  });

  it('counts deleting a healthy blue wire as a modification and fails (§9.2 改造)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const removed = removeWire(circuit.session, 'sw-004');
    expect(removed.ok).toBe(true);
    const added = addWire(
      circuit.session,
      JIPM_BOARD,
      toTerminalId('TB_PB.2b'),
      toTerminalId('TB_PB.1c'),
      REPAIR_WIRE_COLOR,
    );
    expect(added.ok).toBe(true);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.modifications).toEqual(['sw-004']);
    expect(judged.value.passed).toBe(false);
  });

  it('fails the wire colour rule when a repair wire is not white (§8.1)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const wire = circuit.session.wires.find((w) => w.id === addedIdOf(circuit.session));
    if (wire === undefined) return;
    wire.color = '青';
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'wireColorRule')?.ok).toBe(false);
    expect(judged.value.passed).toBe(false);
  });

  it('白線ルールは judge.staticChecks.wireColorRule を無効にしても外れない (I-2)', () => {
    const json = inspectRepairProblemJson();
    const judge = json.judge as { tolerance: unknown; staticChecks: Record<string, boolean> };
    const problem = parseInspectRepairOrThrow({
      ...json,
      judge: { ...judge, staticChecks: { ...judge.staticChecks, wireColorRule: false } },
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const circuit = built.value;
    repair(circuit.session);
    const wire = circuit.session.wires.find((w) => w.id === addedIdOf(circuit.session));
    if (wire === undefined) return;
    wire.color = '青';
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'wireColorRule')).toBeUndefined();
    expect(judged.value.passed).toBe(false);
  });

  it('keeps the surviving blue initial wiring out of the colour rule (§9.2)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.staticChecks.find((c) => c.id === 'wireColorRule')?.ok).toBe(true);
  });

  it('passes after replacing a faulty relay (§9.2 部品交換)', () => {
    const problem = parseInspectRepairOrThrow({
      ...inspectRepairProblemJson(),
      faults: [{ target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-open' }],
    });
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const replaced = replacePart(built.value, 'CR1');
    const judged = judgeInspectRepair(problem, JIPM_BOARD, replaced, [
      { target: { partId: 'CR1' }, kind: 'part-defect' },
    ]);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.mismatches).toEqual([]);
    expect(judged.value.reports.missed).toEqual([]);
    expect(judged.value.passed).toBe(true);
  });

  it('records hazards without changing the verdict (§17.2 #3)', () => {
    const { problem, circuit } = repairCircuit();
    repair(circuit.session);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, CORRECT_REPORTS, {
      elapsedMs: 1_500_000,
      sessionHazards: [OHM_ON_LIVE],
    });
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.passed).toBe(true);
    expect(judged.value.hazardsByKind['ohm-on-live']).toBe(1);
    expect(judged.value.elapsedMs).toBe(1_500_000);
  });
});

/** `repair()` が最後に足した電線のID（採番は `w-NNN`）。 */
function addedIdOf(session: { wires: { id: string }[] }): string {
  const added = session.wires.filter((w) => w.id.startsWith('w-'));
  return added[added.length - 1]?.id ?? '';
}
```

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/judge-inspect.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/judge-inspect.js` で `Test Files  1 failed (1)`。

- [ ] **Step 4: `src/judge-inspect.ts` を書く**

`packages/content/src/judge-inspect.ts`:

```ts
import type { BoardDefinition } from '@ojt/board-model';
import { compareLogs, type ChatterEvent, type Mismatch } from '@ojt/circuit-sim';
import { matchesSite, type FaultReport, type FaultSite } from './faults.js';
import {
  modificationWireIds,
  addedWireIds,
  repairNetlist,
  REPAIR_WIRE_COLOR,
  type RepairCircuit,
} from './inspect-repair.js';
import { countHazards, type HazardCounts, type JudgeOptions } from './judge.js';
import { buildReferenceSession } from './reference.js';
import { runOperations } from './runner.js';
import { resolveCompareSignals } from './schema/judge.js';
import type { InspectPartsProblem, PartTruth } from './schema/inspect-parts.js';
import type { InspectRepairProblem } from './schema/inspect-repair.js';
import type { ProblemIssue } from './schema/index.js';
import { runStaticChecks, type StaticCheckResult } from './static-checks.js';
import { buildTimeChart, defaultChartSignals, timerMarkers, type TimeChart } from './timechart.js';

/**
 * モードC1／C2の判定。設計仕様 §9.1 / §9.2。
 * C1はマークシートの解答だけを採点する（測定そのものは採点しない。§9.1 判定）。
 * C2は「指摘の正誤 → 修復後の動作比較 → 白線ルールと改造 → 危険操作 → 所要時間」を1回で出す。
 * 危険操作回数と所要時間は記録するだけで合否に影響しない（§7.4 / §17.2 #3）。
 */

/** マークシートの解答1件。§9.1 */
export interface InspectPartAnswer {
  partId: string;
  answer: PartTruth;
}

/** マークシートの採点1行。 */
export interface InspectPartScore {
  partId: string;
  /** その部品の本当の状態。 */
  truth: PartTruth;
  /** 訓練者の解答（未回答は undefined）。 */
  answer: PartTruth | undefined;
  correct: boolean;
}

/** モードC1の判定結果。§9.1 */
export interface JudgeInspectPartsResult {
  mode: 'inspect-parts';
  /** 全部品の解答一致で合格。 */
  passed: boolean;
  correctCount: number;
  total: number;
  scores: InspectPartScore[];
  hazardCount: number;
  hazardsByKind: HazardCounts;
  elapsedMs?: number;
}

/** 指摘の採点。§9.2 判定① */
export interface InspectReportScore {
  /** 言い当てた故障と、それを指した指摘。 */
  matched: { site: FaultSite; report: FaultReport }[];
  /** 見逃した故障。 */
  missed: FaultSite[];
  /** 過剰な指摘。 */
  extra: FaultReport[];
}

/** モードC2の判定結果。§9.2 */
export interface JudgeInspectRepairResult {
  mode: 'inspect-repair';
  /** 指摘が過不足なく、修復後の動作が一致し、白線ルール違反も改造も無い。§9.2 合格条件 */
  passed: boolean;
  reports: InspectReportScore;
  /** 許容差を超えた遷移の一覧（修復後の動作比較）。§9.2 判定② */
  mismatches: Mismatch[];
  staticChecks: StaticCheckResult[];
  /** 故障箇所でない青線を削除した電線のID（改造）。§9.2 判定③ */
  modifications: string[];
  /** 訓練者が引いた電線のID。 */
  addedWires: string[];
  hazardCount: number;
  hazardsByKind: HazardCounts;
  chatter: ChatterEvent[];
  elapsedMs?: number;
  charts: { expected: TimeChart; actual: TimeChart };
  compareSignals: string[];
}

/** 結果画面が受け取る点検系の判定結果（`mode` で判別する）。 */
export type JudgeInspectResult = JudgeInspectPartsResult | JudgeInspectRepairResult;

/** C2判定の実行結果（模範回路が作れない・故障の指定が不正なら課題エラー）。§13 #2 */
export type JudgeInspectRepairOutcome =
  { ok: true; value: JudgeInspectRepairResult } | { ok: false; errors: ProblemIssue[] };

/**
 * マークシートを採点する。§9.1
 * 未回答は不正解として数え、`n/m 正解` の表示は `correctCount` / `total` から作る。
 */
export function judgeInspectParts(
  problem: InspectPartsProblem,
  answers: readonly InspectPartAnswer[],
  options: JudgeOptions = {},
): JudgeInspectPartsResult {
  const byId = new Map(answers.map((a) => [a.partId, a.answer] as const));
  const scores: InspectPartScore[] = problem.parts.map((part) => {
    const answer = byId.get(part.id);
    return { partId: part.id, truth: part.truth, answer, correct: answer === part.truth };
  });
  const correctCount = scores.filter((s) => s.correct).length;
  const hazards = options.sessionHazards ?? [];
  return {
    mode: 'inspect-parts',
    passed: correctCount === scores.length,
    correctCount,
    total: scores.length,
    scores,
    hazardCount: hazards.length,
    hazardsByKind: countHazards(hazards),
    ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
  };
}

/**
 * 指摘と故障を突き合わせる。§9.2 判定①
 * 1つの指摘は1つの故障にしか使わない（同じ指摘を2回出しても2件は当たらない）。
 * 故障の並び順に、まだ使っていない指摘の先頭から当てていく（決定論）。
 */
export function scoreReports(
  sites: readonly FaultSite[],
  reports: readonly FaultReport[],
): InspectReportScore {
  const matched: { site: FaultSite; report: FaultReport }[] = [];
  const missed: FaultSite[] = [];
  const used = new Set<number>();
  for (const site of sites) {
    const index = reports.findIndex((report, i) => !used.has(i) && matchesSite(site, report));
    const report = index < 0 ? undefined : reports[index];
    if (report === undefined) {
      missed.push(site);
      continue;
    }
    used.add(index);
    matched.push({ site, report });
  }
  const extra = reports.filter((_, i) => !used.has(i));
  return { matched, missed, extra };
}

/**
 * モードC2を判定する。§9.2
 * 1. 模範回路（＝課題の回路図）を操作列で再生する
 * 2. 訓練者の盤（修復後）からネットリストを作り、残っている部品の故障を注入して同じ操作列を再生する
 * 3. 指摘の正誤・波形の一致・静的チェック・改造・危険操作・所要時間をまとめる
 *
 * 線色の検査は「初期状態にあった電線」を除外して行う（残っている青線は訓練者の責任ではなく、
 * 新しく引いた電線だけが白でなければならない。§8.1 / §9.2）。
 */
export function judgeInspectRepair(
  problem: InspectRepairProblem,
  board: BoardDefinition,
  circuit: RepairCircuit,
  reports: readonly FaultReport[],
  options: JudgeOptions = {},
): JudgeInspectRepairOutcome {
  const reference = buildReferenceSession(problem, board);
  if (!reference.ok) return reference;
  const expectedRun = runOperations(reference.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  const compareSignals = resolveCompareSignals(problem.judge, problem.board.extraParts ?? []);

  const built = repairNetlist(circuit, board);
  if (built.errors.length > 0) return { ok: false, errors: built.errors };
  const actualRun = runOperations(built.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });

  const mismatches = compareLogs(
    expectedRun.log,
    actualRun.log,
    compareSignals,
    problem.judge.tolerance,
  );
  const scored = scoreReports(circuit.applied.sites, reports);
  const modifications = modificationWireIds(circuit, circuit.session);
  /**
   * 新しく引いた電線が白か（§8.1 / §9.2 合格条件③）。`problem.judge.staticChecks.wireColorRule`
   * を無効にした課題JSONでも white-wire ルールだけは外れないよう、ここで直接検査する（I-2）。
   */
  const colourViolations = circuit.session.wires.filter(
    (w) => !w.locked && !circuit.initialWireIds.includes(w.id) && w.color !== REPAIR_WIRE_COLOR,
  );
  const hazards = [...(options.sessionHazards ?? []), ...actualRun.events.hazards()];
  const chatter = actualRun.events.chatters();
  const staticChecks = runStaticChecks(
    {
      session: circuit.session,
      netlist: built.netlist,
      log: actualRun.log,
      hazards,
      chatters: chatter,
      allowedColors: [REPAIR_WIRE_COLOR],
      preexistingWireIds: new Set(circuit.initialWireIds),
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
      mode: 'inspect-repair',
      passed:
        scored.missed.length === 0 &&
        scored.extra.length === 0 &&
        mismatches.length === 0 &&
        modifications.length === 0 &&
        colourViolations.length === 0 &&
        staticChecks.every((c) => c.ok),
      reports: scored,
      mismatches,
      staticChecks,
      modifications,
      addedWires: addedWireIds(circuit, circuit.session),
      hazardCount: hazards.length,
      hazardsByKind: countHazards(hazards),
      chatter: [...chatter],
      ...(options.elapsedMs === undefined ? {} : { elapsedMs: options.elapsedMs }),
      charts,
      compareSignals,
    },
  };
}
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/judge-inspect.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  16 passed (16)`。

- [ ] **Step 6: コミットする**

```powershell
git add packages/content/src/judge.ts packages/content/src/judge-inspect.ts packages/content/test/judge-inspect.test.ts
git commit -m @'
feat(content): judge mode C1 answer sheets and mode C2 repairs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 13: `src/highlight.ts` — C2の回路図連動ハイライト

**Files:**
- Create: `packages/content/src/highlight.ts`
- Test: `packages/content/test/highlight.test.ts`

§9.2 の「2級形式で回路図が表示されている場合、回路図の要素をクリックすると3D盤の対応端子がハイライトされる」を、**索引を作る純関数**として用意する（描画は Plan 2B）。逆引き（3D盤の端子・電線から回路図の要素へ）も同じ索引で引けるようにしておく。

`@ojt/schematic-core` の `Shape` は `cellId` / `rungId` を持つ（Plan 1B）ので、2B は「SVGの図形 → `cellId` → この索引 → 盤の端子・電線」という一本道でハイライトできる。

- [ ] **Step 1: 失敗するテストを書く**

`packages/content/test/highlight.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { buildHighlightIndex, cellIdsAtTerminal, cellIdsOfWire, highlightFor } from '../src/highlight.js';
import { buildReferenceSession } from '../src/reference.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

function index() {
  const built = buildReferenceSession(parseOrThrow(selfHoldProblemJson()), JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return buildHighlightIndex(built.value.cells, built.value.session);
}

describe('buildHighlightIndex', () => {
  it('maps a schematic cell onto its board terminals (§9.2)', () => {
    const target = highlightFor(index(), 'c03');
    expect(target?.device).toBe('CR1');
    expect(target?.terminals).toEqual(['CR1.14', 'CR1.13']);
  });

  it('lists the wires attached to those terminals', () => {
    const target = highlightFor(index(), 'c03');
    expect(target?.wireIds).toEqual(['sw-005', 'sw-006', 'sw-007', 'sw-008']);
  });

  it('maps a push button contact onto the terminal block, not the body (§6.4)', () => {
    const target = highlightFor(index(), 'c02');
    expect(target?.device).toBe('PB1');
    expect(target?.terminals).toEqual(['TB_PB.1c', 'TB_PB.1a']);
  });

  it('returns undefined for an unknown cell id', () => {
    expect(highlightFor(index(), 'nope')).toBeUndefined();
  });
});

describe('cellIdsAtTerminal / cellIdsOfWire', () => {
  it('finds the schematic cells that use a board terminal (3D → 回路図)', () => {
    expect(cellIdsAtTerminal(index(), 'CR1.14')).toEqual(['c03']);
    expect(cellIdsAtTerminal(index(), 'CR1.9')).toEqual(['c04']);
    expect(cellIdsAtTerminal(index(), 'PS.+')).toEqual([]);
  });

  it('finds the schematic cells a wire belongs to', () => {
    expect(cellIdsOfWire(index(), 'sw-006')).toEqual(['c03', 'c04']);
    expect(cellIdsOfWire(index(), 'nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/highlight.test.ts
```

Expected: 失敗。`Error: Failed to load url ../src/highlight.js` で `Test Files  1 failed (1)`。

- [ ] **Step 3: `src/highlight.ts` を書く**

`packages/content/src/highlight.ts`:

```ts
import type { BoardSession } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import type { CellAssignment } from '@ojt/schematic-core';

/**
 * 回路図と盤の対応表。設計仕様 §9.2（C2の連動ハイライト）/ §11.4。
 * 描画はしない。`apps/desktop`（Plan 2B）が「SVGの図形 → `Shape.cellId` → この索引 →
 * 3D盤の端子・電線」という一本道でハイライトできるだけの情報を返す純関数である。
 */

/** 回路図の1要素に対応する盤の場所。 */
export interface HighlightTarget {
  cellId: string;
  /** 回路図上の機器名（`CR1` / `PB1` / `PL1` など）。 */
  device: string;
  /** その要素が使う物理端子（`[P側, N側]` の順）。 */
  terminals: readonly TerminalId[];
  /** その端子のどちらかに繋がっている電線のID（盤の電線順）。 */
  wireIds: readonly string[];
}

/** 回路図要素ID → 盤の場所。 */
export type HighlightIndex = ReadonlyMap<string, HighlightTarget>;

/**
 * 回路図要素の物理割当（`buildReferenceSession()` が返す `cells`）と、いまの盤から索引を作る。
 * 電線は**渡された盤セッション**から引くので、故障で取り除かれた電線（未配線）は出てこない。
 */
export function buildHighlightIndex(
  cells: readonly CellAssignment[],
  session: BoardSession,
): HighlightIndex {
  const out = new Map<string, HighlightTarget>();
  for (const cell of cells) {
    const terminals: readonly TerminalId[] = [cell.left, cell.right];
    const wireIds = session.wires
      .filter((w) => terminals.some((t) => t === w.from || t === w.to))
      .map((w) => w.id);
    out.set(cell.cellId, { cellId: cell.cellId, device: cell.device, terminals, wireIds });
  }
  return out;
}

/** 回路図の要素から盤の場所を引く。 */
export function highlightFor(index: HighlightIndex, cellId: string): HighlightTarget | undefined {
  return index.get(cellId);
}

/** 盤の端子から、その端子を使っている回路図の要素IDを引く（逆引き）。 */
export function cellIdsAtTerminal(index: HighlightIndex, terminal: string): string[] {
  const out: string[] = [];
  for (const target of index.values()) {
    if (target.terminals.some((t) => t === terminal)) out.push(target.cellId);
  }
  return out;
}

/** 盤の電線から、その電線が繋いでいる回路図の要素IDを引く（逆引き）。 */
export function cellIdsOfWire(index: HighlightIndex, wireId: string): string[] {
  const out: string[] = [];
  for (const target of index.values()) {
    if (target.wireIds.includes(wireId)) out.push(target.cellId);
  }
  return out;
}
```

- [ ] **Step 4: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/highlight.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  6 passed (6)`。

- [ ] **Step 5: コミットする**

```powershell
git add packages/content/src/highlight.ts packages/content/test/highlight.test.ts
git commit -m @'
feat(content): index schematic cells to board terminals for C2 highlight

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---


## Task 14: 内蔵C1課題4セットと内蔵課題の登録

**Files:**
- Create: `packages/content/src/builtin/inspect-parts/c1-001-relay-basic.json`
- Create: `packages/content/src/builtin/inspect-parts/c1-002-layer-short.json`
- Create: `packages/content/src/builtin/inspect-parts/c1-003-timer.json`
- Create: `packages/content/src/builtin/inspect-parts/c1-004-mixed.json`
- Modify: `packages/content/src/builtin/index.ts`
- Modify: `packages/content/test/builtin-discrimination.test.ts`（B-4。`findBuiltinProblem()` の戻り値の広がりに追随）
- Test: `packages/content/test/builtin-inspect-parts.test.ts`

§7.9 の「C1（部品点検）1セット = リレー・タイマ複数個。正常と不良の組合せを変える。4セット」を作る。

| ID | 題名 | 級 | 中身 |
|---|---|---|---|
| `c1-001` | リレーの点検①（コイルと接点） | 2 | 正常2・コイル断線1・a接点導通不良1 |
| `c1-002` | リレーの点検②（レアショートを見逃さない） | 2 | 正常1・レアショート1・a接点溶着1・b接点導通不良1 |
| `c1-003` | タイマの点検 | 2 | タイマ正常2・タイマコイル断線1・タイマb接点溶着1 |
| `c1-004` | リレー・タイマの混合点検 | 1 | 6個（レアショート・a接点溶着・b接点溶着・コイル断線・正常2） |

**`BUILTIN_PROBLEMS` は据え置く:** 既存の `BUILTIN_PROBLEMS`（モードB 8題）は型も中身も変えない。C1/C2 を開始できる画面は Plan 2B で入るので、課題一覧への登録もそのときに `BUILTIN_ALL_PROBLEMS` へ差し替える。ここでは**追加だけ**行い、`apps/desktop` の既存テスト（`BUILTIN_PROBLEMS.length` を見ている）を壊さない。

- [ ] **Step 1: C1課題4セットのJSONを作る**

`packages/content/src/builtin/inspect-parts/c1-001-relay-basic.json`:

```json
{
  "formatVersion": 1,
  "id": "c1-001",
  "mode": "inspect-parts",
  "title": "リレーの点検①（コイルと接点）",
  "grade": 2,
  "description": "トレイのリレー4個を1個ずつチェック用ソケットに挿し、赤押ボタン（PB4）で励磁して良否を判定しなさい。手順は ①励磁して吸引するか ②励磁ON/OFFでのa接点・b接点の導通 ③コイル抵抗の測定（正常は約650Ω）の3つである。判定できたらマークシートに原因を1つだけ選ぶこと。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": { "boardId": "board-jipm-std", "socketRoles": { "S7": "CHK" } },
  "inventory": [],
  "parts": [
    { "id": "p1", "kind": "relay-my4n", "truth": "normal" },
    { "id": "p2", "kind": "relay-my4n", "truth": "coil-open" },
    { "id": "p3", "kind": "relay-my4n", "truth": "a-open", "group": 2 },
    { "id": "p4", "kind": "relay-my4n", "truth": "normal" }
  ],
  "seed": 20260101
}
```

`packages/content/src/builtin/inspect-parts/c1-002-layer-short.json`:

```json
{
  "formatVersion": 1,
  "id": "c1-002",
  "mode": "inspect-parts",
  "title": "リレーの点検②（レアショートを見逃さない）",
  "grade": 2,
  "description": "トレイのリレー4個を点検しなさい。レアショートのコイルは通常どおり励磁・復帰し、接点も正常に開閉するため、動作を見るだけでは正常品と区別できない。正常に見えた部品も必ずコイル抵抗を測り、正常値650Ωの85%（約552Ω）以下ならレアショートと判定すること。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": { "boardId": "board-jipm-std", "socketRoles": { "S7": "CHK" } },
  "inventory": [],
  "parts": [
    { "id": "p1", "kind": "relay-my4n", "truth": "normal" },
    { "id": "p2", "kind": "relay-my4n", "truth": "coil-layer-short", "ratio": 0.65 },
    { "id": "p3", "kind": "relay-my4n", "truth": "a-weld", "group": 1 },
    { "id": "p4", "kind": "relay-my4n", "truth": "b-open", "group": 3 }
  ],
  "seed": 20260102
}
```

`packages/content/src/builtin/inspect-parts/c1-003-timer.json`:

```json
{
  "formatVersion": 1,
  "id": "c1-003",
  "mode": "inspect-parts",
  "title": "タイマの点検",
  "grade": 2,
  "description": "トレイのタイマ4個を点検しなさい。タイマは赤押ボタン（PB4）を押し続けて設定時間が経過すると限時接点が反転する。反転したところで a接点・b接点の導通を測り、最後にコイル（電源）抵抗を測ること。b接点が溶着していると、そのa接点は機械的に開いたままになる。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": { "boardId": "board-jipm-std", "socketRoles": { "S7": "CHK" } },
  "inventory": [],
  "parts": [
    { "id": "p1", "kind": "timer-h3y4", "truth": "normal" },
    { "id": "p2", "kind": "timer-h3y4", "truth": "coil-open" },
    { "id": "p3", "kind": "timer-h3y4", "truth": "b-weld", "group": 2 },
    { "id": "p4", "kind": "timer-h3y4", "truth": "normal" }
  ],
  "seed": 20260103
}
```

`packages/content/src/builtin/inspect-parts/c1-004-mixed.json`:

```json
{
  "formatVersion": 1,
  "id": "c1-004",
  "mode": "inspect-parts",
  "title": "リレー・タイマの混合点検",
  "grade": 1,
  "description": "トレイのリレー4個とタイマ2個を点検しなさい。良否の判定は部品ごとに独立している。接点の不良は4組のうちどれか1組にだけ入っているので、4組すべてを順に測ること。解答は組を問わず「a接点 溶着」のように原因だけを答える。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": { "boardId": "board-jipm-std", "socketRoles": { "S7": "CHK" } },
  "inventory": [],
  "parts": [
    { "id": "p1", "kind": "relay-my4n", "truth": "coil-layer-short", "ratio": 0.5 },
    { "id": "p2", "kind": "timer-h3y4", "truth": "a-weld", "group": 4 },
    { "id": "p3", "kind": "relay-my4n", "truth": "b-weld", "group": 2 },
    { "id": "p4", "kind": "relay-my4n", "truth": "normal" },
    { "id": "p5", "kind": "timer-h3y4", "truth": "normal" },
    { "id": "p6", "kind": "relay-my4n", "truth": "coil-open" }
  ],
  "seed": 20260104
}
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/content/test/builtin-inspect-parts.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { continuity, measureResistance, Simulation } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_INSPECT_PARTS_PROBLEMS } from '../src/builtin/index.js';
import {
  buildCheckCircuit,
  CHECK_COIL_MINUS,
  CHECK_COIL_PLUS,
  CHECK_PART_ID,
  checkContactTerminals,
  checkSettleMs,
  expectedCheckReading,
} from '../src/inspect-parts.js';
import { judgeInspectParts } from '../src/judge-inspect.js';
import type {
  InspectPartData,
  InspectPartsProblem,
  PartTruth,
} from '../src/schema/inspect-parts.js';

/** §9.1 の手順どおりに1個を点検する。 */
function measure(problem: InspectPartsProblem, part: InspectPartData) {
  const built = buildCheckCircuit(problem, JIPM_BOARD, part.id);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const pins = checkContactTerminals(built.value.group);
  const sim = new Simulation(built.value.netlist);
  sim.setBreaker(true);
  sim.setSwitch(true);
  sim.run(100);
  const coil = measureResistance(sim, CHECK_COIL_MINUS, CHECK_COIL_PLUS);
  const aClosedOff = continuity(sim, pins.com, pins.no).conductive;
  const bClosedOff = continuity(sim, pins.com, pins.nc).conductive;
  sim.press('PB4');
  sim.run(sim.tMs + checkSettleMs(part.kind));
  const state = sim.state();
  return {
    picksUp:
      part.kind === 'timer-h3y4'
        ? (state.timers[CHECK_PART_ID]?.timedOut ?? false)
        : (state.relays[CHECK_PART_ID]?.contactsOn ?? false),
    coilOhms: coil.overRange ? null : coil.ohms,
    aClosedOff,
    bClosedOff,
    aClosedOn: continuity(sim, pins.com, pins.no).conductive,
    bClosedOn: continuity(sim, pins.com, pins.nc).conductive,
    hazards: sim.events.countOf('ohm-on-live'),
  };
}

describe('内蔵C1課題（§7.9 4セット）', () => {
  it('registers four sets with stable ids', () => {
    expect(BUILTIN_INSPECT_PARTS_PROBLEMS).toHaveLength(4);
    expect(BUILTIN_INSPECT_PARTS_PROBLEMS.map((p) => p.id)).toEqual([
      'c1-001',
      'c1-002',
      'c1-003',
      'c1-004',
    ]);
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      expect(problem.mode).toBe('inspect-parts');
      expect(problem.board.boardId).toBe('board-jipm-std');
    }
  });

  it('mixes healthy and defective parts in every set (§7.9)', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      const truths = problem.parts.map((p) => p.truth);
      expect(truths.includes('normal'), problem.id).toBe(true);
      expect(truths.some((t) => t !== 'normal'), problem.id).toBe(true);
    }
  });

  it('never puts a layer short on a timer (§17.2 #6)', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      for (const part of problem.parts) {
        expect(part.kind === 'timer-h3y4' && part.truth === 'coil-layer-short').toBe(false);
      }
    }
  });

  it('covers all seven answer options across the four sets', () => {
    const seen = new Set(
      BUILTIN_INSPECT_PARTS_PROBLEMS.flatMap((p) => p.parts.map((part) => part.truth)),
    );
    expect(seen.size).toBe(7);
  });

  it('自己整合: 全セットの全部品が判定表どおりの読値になる (§7.8 / §9.1)', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      for (const part of problem.parts) {
        const expected = expectedCheckReading(part);
        const actual = measure(problem, part);
        const where = `${problem.id}/${part.id}(${part.truth})`;
        expect(actual.picksUp, where).toBe(expected.picksUp);
        expect(actual.aClosedOff, where).toBe(expected.aClosedOff);
        expect(actual.aClosedOn, where).toBe(expected.aClosedOn);
        expect(actual.bClosedOff, where).toBe(expected.bClosedOff);
        expect(actual.bClosedOn, where).toBe(expected.bClosedOn);
        expect(actual.hazards, where).toBe(0);
        if (expected.coilOhms === null) expect(actual.coilOhms, where).toBeNull();
        else expect(actual.coilOhms ?? 0, where).toBeCloseTo(expected.coilOhms, 1);
      }
    }
  });

  it('自己整合: 正解どおりに答えると全セット合格する (§9.1)', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      const result = judgeInspectParts(
        problem,
        problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
      );
      expect(result.passed, problem.id).toBe(true);
      expect(result.correctCount, problem.id).toBe(problem.parts.length);
    }
  });

  it('弁別: 1件だけ答えを変えると不合格になる', () => {
    for (const problem of BUILTIN_INSPECT_PARTS_PROBLEMS) {
      const first = problem.parts[0];
      if (first === undefined) continue;
      const wrong: PartTruth = first.truth === 'normal' ? 'coil-open' : 'normal';
      const answers = problem.parts.map((p, i) => ({ partId: p.id, answer: i === 0 ? wrong : p.truth }));
      const result = judgeInspectParts(problem, answers);
      expect(result.passed, problem.id).toBe(false);
      expect(result.correctCount, problem.id).toBe(problem.parts.length - 1);
    }
  });
});
```

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin-inspect-parts.test.ts
```

Expected: 失敗。`BUILTIN_INSPECT_PARTS_PROBLEMS` が `../src/builtin/index.js` に無く `TypeError` で `Test Files  1 failed (1)`。

- [ ] **Step 4: `src/builtin/index.ts` を書き換える**

`parseBuiltinProblems()` / `ofMode()` と `BUILTIN_ASSEMBLE_PROBLEMS` の定義は Task 8 Step 5 で追加済みである（B-3）。下は完成形の全文（コピー用）で、Task 8 からの差分は C1 関連の import・`BUILTIN_INSPECT_PARTS_JSON`・`BUILTIN_INSPECT_PARTS_PROBLEMS`・`BUILTIN_ALL_PROBLEMS`・`findBuiltinProblem`（`SupportedProblem` を返すようになる）だけである。`packages/content/src/builtin/index.ts` を丸ごと次に置き換える:

```ts
import type { AssembleProblem } from '../schema/assemble.js';
import {
  isAssembleProblem,
  isInspectPartsProblem,
  parseProblem,
  type ProblemIssue,
  type SupportedProblem,
} from '../schema/index.js';
import type { InspectPartsProblem } from '../schema/inspect-parts.js';
import selfHold from './assemble/b-001-self-hold.json' with { type: 'json' };
import interlock from './assemble/b-002-interlock.json' with { type: 'json' };
import onDelay from './assemble/b-003-on-delay.json' with { type: 'json' };
import sequential from './assemble/b-004-sequential.json' with { type: 'json' };
import oneShot from './assemble/b-005-one-shot.json' with { type: 'json' };
import flicker from './assemble/b-006-flicker.json' with { type: 'json' };
import firstPress from './assemble/b-007-first-press.json' with { type: 'json' };
import stopPriority from './assemble/b-008-stop-priority.json' with { type: 'json' };
import relayBasic from './inspect-parts/c1-001-relay-basic.json' with { type: 'json' };
import layerShort from './inspect-parts/c1-002-layer-short.json' with { type: 'json' };
import timerCheck from './inspect-parts/c1-003-timer.json' with { type: 'json' };
import mixedCheck from './inspect-parts/c1-004-mixed.json' with { type: 'json' };

/**
 * 内蔵課題。設計仕様 §7.8 / §7.9（モードB 8題・モードC1 4セット・モードC2 8題）。
 * JSONを直接読み、`parseProblem()` を通した結果だけを公開する。
 * 1件でも検証に落ちたら読み込み時に例外を投げるので、壊れた内蔵課題はビルド／テストで必ず落ちる。
 *
 * JSONのimportには **import attributes**（`with { type: 'json' }`）を必ず付ける。
 * Vite / Vitest は属性が無くても読めてしまうが、素の Node ESM（Electronのメインプロセス）は
 * `ERR_IMPORT_ATTRIBUTE_MISSING` で落ちる。`test/builtin-node-esm.test.ts` が見張っている。
 */

/** 内蔵のモードB課題のJSON。 */
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

/** 内蔵のモードC1課題のJSON。 */
const BUILTIN_INSPECT_PARTS_JSON: readonly unknown[] = [
  relayBasic,
  layerShort,
  timerCheck,
  mixedCheck,
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
export function parseBuiltinProblems(sources: readonly unknown[]): SupportedProblem[] {
  return sources.map((source, index) => {
    const parsed = parseProblem(source);
    if (parsed.ok) return parsed.problem;
    throw new BuiltinProblemError(
      `内蔵課題[${index}]（${parsed.id ?? '不明'}）が読めません: ${parsed.message}`,
      parsed.issues,
    );
  });
}

/** 期待したモードの課題だけを取り出す（違うモードが混ざっていたら例外）。 */
function ofMode<T extends SupportedProblem>(
  problems: readonly SupportedProblem[],
  guard: (problem: SupportedProblem) => problem is T,
  label: string,
): T[] {
  return problems.map((problem, index) => {
    if (guard(problem)) return problem;
    throw new BuiltinProblemError(
      `内蔵課題[${index}]（${problem.id}）は${label}ではありません`,
      [],
    );
  });
}

/** 内蔵のモードB課題（8題）。§7.9 */
export const BUILTIN_ASSEMBLE_PROBLEMS: readonly AssembleProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_ASSEMBLE_JSON),
  isAssembleProblem,
  'モードB課題',
);

/** 内蔵のモードC1課題（4セット）。§7.9 */
export const BUILTIN_INSPECT_PARTS_PROBLEMS: readonly InspectPartsProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_INSPECT_PARTS_JSON),
  isInspectPartsProblem,
  'モードC1課題',
);

/**
 * 課題一覧に載せる内蔵課題。
 * **Plan 2A ではモードBのままにしてある**（C1/C2を開始できる画面が入るのは Plan 2B のため）。
 * Plan 2B が `BUILTIN_ALL_PROBLEMS` に差し替えると同時に、モード別の課題一覧を入れる。
 */
export const BUILTIN_PROBLEMS: readonly AssembleProblem[] = BUILTIN_ASSEMBLE_PROBLEMS;

/** 内蔵課題すべて（モードB＋C1＋C2）。§7.9 */
export const BUILTIN_ALL_PROBLEMS: readonly SupportedProblem[] = [
  ...BUILTIN_ASSEMBLE_PROBLEMS,
  ...BUILTIN_INSPECT_PARTS_PROBLEMS,
];

/** 内蔵課題をIDで引く（全モードから探す）。 */
export function findBuiltinProblem(id: string): SupportedProblem | undefined {
  return BUILTIN_ALL_PROBLEMS.find((p) => p.id === id);
}
```

**既存の `builtin-discrimination.test.ts` を追随させる（B-4）:** `findBuiltinProblem()` の戻り値が `SupportedProblem | undefined` に広がるため、既存の `packages/content/test/builtin-discrimination.test.ts` の21〜25行目（`builtin()` ヘルパ）が型で絞り込めなくなる。`isAssembleProblem` の import を足し、ガードを広げる:

```ts
import { isAssembleProblem } from '../src/schema/index.js';
```

```ts
function builtin(id: string): AssembleProblem {
  const problem = findBuiltinProblem(id);
  if (problem === undefined || !isAssembleProblem(problem)) {
    throw new Error(`内蔵課題 ${id} がありません`);
  }
  return problem;
}
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin-inspect-parts.test.ts test/builtin.test.ts test/builtin-node-esm.test.ts test/builtin-discrimination.test.ts
```

Expected: `Test Files  4 passed (4)`。`builtin-inspect-parts` は `Tests  7 passed (7)`。

- [ ] **Step 6: コミットする**

```powershell
git add packages/content/src/builtin/inspect-parts packages/content/src/builtin/index.ts packages/content/test/builtin-inspect-parts.test.ts packages/content/test/builtin-discrimination.test.ts
git commit -m @'
feat(content): add four built-in mode C1 inspection sets

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 15: 内蔵C2課題 前半4題（2級形式・回路図あり）

**Files:**
- Create: `packages/content/src/builtin/inspect-repair/c2-001-self-hold.json`
- Create: `packages/content/src/builtin/inspect-repair/c2-002-self-hold-contact.json`
- Create: `packages/content/src/builtin/inspect-repair/c2-003-on-delay.json`
- Create: `packages/content/src/builtin/inspect-repair/c2-004-one-shot.json`
- Modify: `packages/content/src/builtin/index.ts`
- Test: `packages/content/test/builtin-inspect-repair.test.ts`

§7.9 の「C2（回路点検・修復）1級形式4題＋2級形式4題」の**2級形式4題**を作る。基準になる回路はモードB課題の回路図をそのまま使い（依頼の方針どおり）、故障を2箇所ずつ入れる（§17.2 #4「内蔵課題は2箇所を基本とする」）。

| ID | 基準回路 | 級 | 故障① | 故障② |
|---|---|---|---|---|
| `c2-001` | 自己保持回路（`b-001`） | 2 | `sw-005`（`TB_PB.1a`–`CR1.14`）断線 | `sw-009`（`CR1.6`–`TB_PL.1+`）未配線 |
| `c2-002` | 自己保持回路（`b-001`） | 2 | `sw-002`（`TB_PB.2c`–`CR1.10`）を `CR1.12` へ誤配線 | `CR1` 2組目a接点の接触不良 3000Ω |
| `c2-003` | オンディレー点灯（`b-003`） | 2 | `sw-011`（`CR1.6`–`T1.14`）断線 | `T1` 1組目a接点の溶着 |
| `c2-004` | ワンショット（`b-005`） | 2 | `sw-012`（`CR1.7`–`TB_PL.1+`）を `TB_PL.2+` へ誤配線 | `T1` コイル断線 |

**電線IDの根拠:** `sw-NNN` は回路図から `assignToBoard()` が割当順に採番する（Plan 1B）。同じ回路図からは必ず同じIDが出るため課題JSONに書ける。上の対応（`sw-005` = `TB_PB.1a`–`CR1.14` など）は実際に `toSession()` を走らせて確認済みである。

**要素番号の根拠:** ソケット部品の要素は `[coil, b1, a1, b2, a2, b3, a3, b4, a4]` の順なので、コイル＝0、2組目のa接点＝`2 × 2 = 4`、1組目のa接点＝`2 × 1 = 2`（Task 3 の `socketContactElementIndex()`）。

**検証済み（実装前に実回路で確認した結果）:** 4題とも、故障を**片方だけ**入れても模範回路と波形が食い違い（`compareLogs()` の不一致が1件以上）、両方入れても食い違い、Task 16 の修復手順を踏むと**不一致0**になる。

- [ ] **Step 1: 2級形式4題のJSONを作る**

`packages/content/src/builtin/inspect-repair/c2-001-self-hold.json`:

```json
{
  "formatVersion": 1,
  "id": "c2-001",
  "mode": "inspect-repair",
  "title": "自己保持回路の点検・修復①",
  "grade": 2,
  "description": "黒押ボタン（PB1）で白ランプ（PL1）が点灯し自己保持、黄押ボタン（PB2）で消灯する回路である。現在は正しく動作しない。回路図とタイムチャートを手がかりに故障箇所を2つ指摘し、白線で修復しなさい。故障箇所でない青線を外してはならない。",
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
    "id": "sch-c2-001",
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
  "faults": [
    { "target": { "wireId": "sw-005" }, "kind": "wire-open" },
    { "target": { "wireId": "sw-009" }, "kind": "wire-missing" }
  ],
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

`packages/content/src/builtin/inspect-repair/c2-002-self-hold-contact.json`:

```json
{
  "formatVersion": 1,
  "id": "c2-002",
  "mode": "inspect-repair",
  "title": "自己保持回路の点検・修復②（誤配線と接触不良）",
  "grade": 2,
  "description": "自己保持回路が正しく動作しない。故障は電線の誤配線と部品の不良である。部品の不良は電圧・導通・抵抗の測定でしか見つからない。故障箇所を2つ指摘し、電線は白線で引き直し、不良部品はチェック用ソケットで良品を選んで交換しなさい。",
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
    "id": "sch-c2-002",
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
  "faults": [
    { "target": { "wireId": "sw-002" }, "kind": "wire-misrouted", "to": "CR1.12" },
    { "target": { "partId": "CR1", "elementIndex": 4 }, "kind": "contact-resistive", "ohms": 3000 }
  ],
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

`packages/content/src/builtin/inspect-repair/c2-003-on-delay.json`:

```json
{
  "formatVersion": 1,
  "id": "c2-003",
  "mode": "inspect-repair",
  "title": "オンディレー点灯回路の点検・修復",
  "grade": 2,
  "description": "黒押ボタン（PB1）で運転を開始し、3秒後に白ランプ（PL1）が点灯する回路である。現在はランプが最初から点灯したままになる。故障箇所を2つ指摘し、電線は白線で修復、不良部品は交換しなさい。タイマ T1 は3秒に設定する。",
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
    "id": "sch-c2-003",
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
  "faults": [
    { "target": { "wireId": "sw-011" }, "kind": "wire-open" },
    { "target": { "partId": "T1", "elementIndex": 2 }, "kind": "contact-welded" }
  ],
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

`packages/content/src/builtin/inspect-repair/c2-004-one-shot.json`:

```json
{
  "formatVersion": 1,
  "id": "c2-004",
  "mode": "inspect-repair",
  "title": "ワンショット回路の点検・修復",
  "grade": 2,
  "description": "黒押ボタン（PB1）を押すと白ランプ（PL1）が1.5秒だけ点灯して自動的に消灯する回路である。現在は別のランプが点きっぱなしになる。故障箇所を2つ指摘し、電線は白線で修復、不良部品は交換しなさい。タイマ T1 は1.5秒に設定する。",
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
    "id": "sch-c2-004",
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
  "faults": [
    { "target": { "wireId": "sw-012" }, "kind": "wire-misrouted", "to": "TB_PL.2+" },
    { "target": { "partId": "T1", "elementIndex": 0 }, "kind": "coil-open" }
  ],
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 3000, "target": "PB1", "action": "press" },
    { "t": 3300, "target": "PB1", "action": "release" }
  ],
  "durationMs": 6000,
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

- [ ] **Step 2: 失敗するテストを書く**

`packages/content/test/builtin-inspect-repair.test.ts`:

```ts
import { JIPM_BOARD } from '@ojt/board-model';
import { compareLogs } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '../src/builtin/index.js';
import { applyFaults } from '../src/faults.js';
import { buildInspectRepairCircuit, repairNetlist } from '../src/inspect-repair.js';
import { resolveFaults } from '../src/random-faults.js';
import { buildReferenceSession } from '../src/reference.js';
import { runOperations } from '../src/runner.js';
import { resolveCompareSignals } from '../src/schema/judge.js';
import type { InspectRepairProblem } from '../src/schema/inspect-repair.js';
import { startsAndEndsLow, buildTimeChart, defaultChartSignals } from '../src/timechart.js';

/** 模範回路（故障なし）の信号ログと比較信号。 */
function referenceRun(problem: InspectRepairProblem) {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const run = runOperations(built.value.netlist, problem.operations, {
    durationMs: problem.durationMs,
  });
  return { run, signals: resolveCompareSignals(problem.judge, problem.board.extraParts ?? []) };
}

/** 指定した故障だけを入れた盤の不一致件数。 */
function mismatchCount(problem: InspectRepairProblem, faultIndexes: readonly number[]): number {
  const all = resolveFaults(problem, JIPM_BOARD);
  if (!all.ok) throw new Error(JSON.stringify(all.errors));
  const chosen = faultIndexes.map((i) => all.value[i]).filter((f) => f !== undefined);
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const applied = applyFaults(built.value.session, chosen);
  if (!applied.ok) throw new Error(JSON.stringify(applied.errors));
  const circuit = {
    session: built.value.session,
    applied: applied.value,
    initialWireIds: built.value.session.wires.map((w) => w.id),
    cells: built.value.cells,
  };
  const { netlist, errors } = repairNetlist(circuit, JIPM_BOARD);
  expect(errors).toEqual([]);
  const actual = runOperations(netlist, problem.operations, { durationMs: problem.durationMs });
  const reference = referenceRun(problem);
  return compareLogs(reference.run.log, actual.log, reference.signals, problem.judge.tolerance)
    .length;
}

describe('内蔵C2課題', () => {
  it('registers the problems with stable ids and the right hint setting (§9.2)', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      expect(problem.mode, problem.id).toBe('inspect-repair');
      expect(problem.board.boardId, problem.id).toBe('board-jipm-std');
      expect(problem.hints.schematicVisible, problem.id).toBe(problem.grade === 2);
      expect(problem.grade === 1 || problem.grade === 2, problem.id).toBe(true);
    }
  });

  it('gives every problem exactly two faults (§17.2 #4)', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      expect(Array.isArray(problem.faults), problem.id).toBe(true);
      if (!Array.isArray(problem.faults)) continue;
      expect(problem.faults, problem.id).toHaveLength(2);
    }
  });

  it('builds the faulted board without a problem-data error (§13 #2)', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
      expect(built.ok, problem.id).toBe(true);
      if (!built.ok) continue;
      expect(built.value.applied.sites, problem.id).toHaveLength(2);
      expect(built.value.session.allowedColors, problem.id).toEqual(['白']);
    }
  });

  it('keeps the reference chart starting and ending low (§7.3)', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      const { run, signals } = referenceRun(problem);
      const chart = buildTimeChart(run.log, defaultChartSignals(signals), problem.durationMs);
      expect(startsAndEndsLow(chart), problem.id).toBe(true);
    }
  });

  // 弁別テストは課題ごとに個別の it() へ分割する(B-6)。coverage 計測込みで1テストに
  // まとめると136秒かかり、既定のテストタイムアウトを超えて落ちるため(Task 15 で
  // testTimeout/hookTimeout を180_000へ上げる対応と合わせて、個別化して報告も見やすくする)。
  for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
    it(`${problem.id}: どちらか片方の故障だけでも模範と動作が食い違う (§7.5)`, () => {
      expect(mismatchCount(problem, [0]), 'fault0').toBeGreaterThan(0);
      expect(mismatchCount(problem, [1]), 'fault1').toBeGreaterThan(0);
      expect(mismatchCount(problem, [0, 1]), 'both').toBeGreaterThan(0);
    });
  }

  it('故障を入れなければ模範と完全に一致する（基準回路の自己整合）', () => {
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      expect(mismatchCount(problem, []), problem.id).toBe(0);
    }
  });
});
```

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin-inspect-repair.test.ts
```

Expected: 失敗。`BUILTIN_INSPECT_REPAIR_PROBLEMS` が `../src/builtin/index.js` に無く `TypeError` で `Test Files  1 failed (1)`。

- [ ] **Step 4: `src/builtin/index.ts` にC2の4題を登録する**

`packages/content/src/builtin/index.ts` の import に足す（`mixedCheck` の下）:

```ts
import c2SelfHold from './inspect-repair/c2-001-self-hold.json' with { type: 'json' };
import c2SelfHoldContact from './inspect-repair/c2-002-self-hold-contact.json' with { type: 'json' };
import c2OnDelay from './inspect-repair/c2-003-on-delay.json' with { type: 'json' };
import c2OneShot from './inspect-repair/c2-004-one-shot.json' with { type: 'json' };
```

`isInspectPartsProblem` の import に `isInspectRepairProblem` を足し、`InspectRepairProblem` の型 import を足す:

```ts
import {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  parseProblem,
  type ProblemIssue,
  type SupportedProblem,
} from '../schema/index.js';
import type { InspectPartsProblem } from '../schema/inspect-parts.js';
import type { InspectRepairProblem } from '../schema/inspect-repair.js';
```

`BUILTIN_INSPECT_PARTS_JSON` の下に足す:

```ts
/** 内蔵のモードC2課題のJSON。 */
const BUILTIN_INSPECT_REPAIR_JSON: readonly unknown[] = [
  c2SelfHold,
  c2SelfHoldContact,
  c2OnDelay,
  c2OneShot,
];
```

`BUILTIN_INSPECT_PARTS_PROBLEMS` の下に足し、`BUILTIN_ALL_PROBLEMS` を書き換える:

```ts
/** 内蔵のモードC2課題（8題）。§7.9 */
export const BUILTIN_INSPECT_REPAIR_PROBLEMS: readonly InspectRepairProblem[] = ofMode(
  parseBuiltinProblems(BUILTIN_INSPECT_REPAIR_JSON),
  isInspectRepairProblem,
  'モードC2課題',
);
```

```ts
/** 内蔵課題すべて（モードB＋C1＋C2）。§7.9 */
export const BUILTIN_ALL_PROBLEMS: readonly SupportedProblem[] = [
  ...BUILTIN_ASSEMBLE_PROBLEMS,
  ...BUILTIN_INSPECT_PARTS_PROBLEMS,
  ...BUILTIN_INSPECT_REPAIR_PROBLEMS,
];
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin-inspect-repair.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  9 passed (9)`（この時点でC2は4題。「弁別」は登録済みの4題ぶん個別の `it()` に分かれ、Task 16 で8題登録すると自動的に8件になる）。

- [ ] **Step 5a: `vitest --coverage` のタイムアウトを上げる (B-6)**

`mismatchCount()` は模範・訓練者2回ぶん回路をシミュレートするため、coverage計測（instrumentation）を
付けると弁別テスト全体で136秒かかり、既定の `testTimeout` / `hookTimeout`（5000ms）を超えて
タイムアウトで落ちる。Task 16で8題そろう前のいま、`packages/content/vitest.config.ts` の既存の
`test` 設定に `testTimeout` と `hookTimeout` を足しておく:

```ts
  test: {
    // ...既存の設定はそのまま
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
```

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin-inspect-repair.test.ts --coverage
```

Expected: `Test Files  1 passed (1)` / `Tests  9 passed (9)`。coverageを付けてもタイムアウトしない。

- [ ] **Step 6: コミットする**

```powershell
git add packages/content/src/builtin/inspect-repair packages/content/src/builtin/index.ts packages/content/test/builtin-inspect-repair.test.ts packages/content/vitest.config.ts
git commit -m @'
feat(content): add four grade-2 built-in mode C2 problems

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 16: 内蔵C2課題 後半4題（1級形式）と修復の弁別テスト

**Files:**
- Create: `packages/content/src/builtin/inspect-repair/c2-005-interlock.json`
- Create: `packages/content/src/builtin/inspect-repair/c2-006-sequential.json`
- Create: `packages/content/src/builtin/inspect-repair/c2-007-flicker.json`
- Create: `packages/content/src/builtin/inspect-repair/c2-008-stop-priority.json`
- Modify: `packages/content/src/builtin/index.ts`
- Test: `packages/content/test/builtin-c2-discrimination.test.ts`

残る**1級形式4題**（回路図を提示せずタイムチャートのみ。§9.2 / 調査資料 §1.1）を作り、8題すべてについて「指摘して修復すれば合格する／修復しなければ不合格になる」ことを見張る弁別テストを足す。

| ID | 基準回路 | 級 | 故障① | 故障② |
|---|---|---|---|---|
| `c2-005` | インターロック（`b-002`） | 1 | `sw-010`（`CR2.1`–`CR1.14`）断線 | `CR2` 3組目a接点の接触不良 3000Ω |
| `c2-006` | 順次点灯（`b-004`） | 1 | `sw-017`（`T1.6`–`T2.14`）未配線 | `sw-016`（`T1.5`–`TB_PL.1+`）を `TB_PL.3+` へ誤配線 |
| `c2-007` | フリッカ（`b-006`） | 1 | `sw-020`（`T1.5`–`CR2.14`）断線 | `CR2` 4組目a接点の不導通 |
| `c2-008` | 停止優先（`b-008`） | 1 | `sw-016`（`TB_PB.3a`–`CR2.14`）未配線 | `CR1` コイル断線 |

**修復手順（弁別テストが踏む手順。実回路で不一致0になることを確認済み）:**

| ID | 修復 |
|---|---|
| `c2-001` | `sw-005` を外す → 白線 `TB_PB.1a`–`CR1.14` → 白線 `CR1.6`–`TB_PL.1+` |
| `c2-002` | `sw-002` を外す → 白線 `TB_PB.2c`–`CR1.10` → `CR1` を交換 |
| `c2-003` | `sw-011` を外す → 白線 `CR1.6`–`T1.14` → `T1` を交換 |
| `c2-004` | `sw-012` を外す → 白線 `CR1.7`–`TB_PL.1+` → `T1` を交換 |
| `c2-005` | `sw-010` を外す → 白線 `CR2.1`–`CR1.14` → `CR2` を交換 |
| `c2-006` | 白線 `T1.6`–`T2.14` → `sw-016` を外す → 白線 `T1.5`–`TB_PL.1+` |
| `c2-007` | `sw-020` を外す → 白線 `T1.5`–`CR2.14` → `CR2` を交換 |
| `c2-008` | 白線 `TB_PB.3a`–`CR2.14` → `CR1` を交換 |

- [ ] **Step 1: 1級形式4題のJSONを作る**

`packages/content/src/builtin/inspect-repair/c2-005-interlock.json`:

```json
{
  "formatVersion": 1,
  "id": "c2-005",
  "mode": "inspect-repair",
  "title": "インターロック回路の点検・修復",
  "grade": 1,
  "description": "黒押ボタン（PB1）で白ランプ（PL1）、黄押ボタン（PB2）で黄ランプ（PL2）を自己保持で点灯させ、先に点灯した側を優先する回路である。緑押ボタン（PB3）で両方を消灯する。現在はタイムチャートどおりに動作しない。回路図は与えられない。故障箇所を2つ指摘し、白線で修復または部品を交換しなさい。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S3": "CR3", "S4": "CR4", "S7": "CHK" }
  },
  "inventory": [{ "kind": "relay-my4n", "count": 4 }],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-c2-005",
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
        "from": { "rung": "r1", "node": 1 },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-a", "id": "c07", "device": "PB2" },
          { "kind": "cr-b", "id": "c08", "device": "CR1" },
          { "kind": "coil", "id": "c09", "device": "CR2" }
        ]
      },
      {
        "id": "r2h",
        "from": { "rung": "r2", "node": 0 },
        "to": { "rung": "r2", "node": 1 },
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
  "faults": [
    { "target": { "wireId": "sw-010" }, "kind": "wire-open" },
    { "target": { "partId": "CR2", "elementIndex": 6 }, "kind": "contact-resistive", "ohms": 3000 }
  ],
  "operations": [
    { "t": 500, "target": "PB1", "action": "press" },
    { "t": 800, "target": "PB1", "action": "release" },
    { "t": 1500, "target": "PB2", "action": "press" },
    { "t": 1800, "target": "PB2", "action": "release" },
    { "t": 3000, "target": "PB3", "action": "press" },
    { "t": 3300, "target": "PB3", "action": "release" },
    { "t": 4500, "target": "PB2", "action": "press" },
    { "t": 4800, "target": "PB2", "action": "release" },
    { "t": 5500, "target": "PB1", "action": "press" },
    { "t": 5800, "target": "PB1", "action": "release" },
    { "t": 6500, "target": "PB3", "action": "press" },
    { "t": 6800, "target": "PB3", "action": "release" }
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

`packages/content/src/builtin/inspect-repair/c2-006-sequential.json`:

```json
{
  "formatVersion": 1,
  "id": "c2-006",
  "mode": "inspect-repair",
  "title": "順次点灯回路の点検・修復",
  "grade": 1,
  "description": "黒押ボタン（PB1）で運転を開始し、2秒後に白ランプ（PL1）、さらに2秒後に黄ランプ（PL2）が点灯する回路である。黄押ボタン（PB2）で両方を消灯する。現在はタイムチャートどおりに動作しない。回路図は与えられない。故障箇所を2つ指摘し、白線で修復しなさい。タイマは T1・T2 とも2秒に設定する。",
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
    "id": "sch-c2-006",
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
  "faults": [
    { "target": { "wireId": "sw-017" }, "kind": "wire-missing" },
    { "target": { "wireId": "sw-016" }, "kind": "wire-misrouted", "to": "TB_PL.3+" }
  ],
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

`packages/content/src/builtin/inspect-repair/c2-007-flicker.json`:

```json
{
  "formatVersion": 1,
  "id": "c2-007",
  "mode": "inspect-repair",
  "title": "フリッカ回路の点検・修復",
  "grade": 1,
  "description": "黒押ボタン（PB1）で運転を開始し、白ランプ（PL1）が0.8秒間隔で点滅する回路である。黄押ボタン（PB2）で停止する。現在はランプが点灯しない。回路図は与えられない。故障箇所を2つ指摘し、白線で修復または部品を交換しなさい。タイマは T1・T2 とも0.8秒に設定する。",
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
    "id": "sch-c2-007",
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
  "faults": [
    { "target": { "wireId": "sw-020" }, "kind": "wire-open" },
    { "target": { "partId": "CR2", "elementIndex": 8 }, "kind": "contact-open" }
  ],
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

`packages/content/src/builtin/inspect-repair/c2-008-stop-priority.json`:

```json
{
  "formatVersion": 1,
  "id": "c2-008",
  "mode": "inspect-repair",
  "title": "停止優先の起動・停止と警報表示の点検・修復",
  "grade": 1,
  "description": "黒押ボタン（PB1）で運転（白ランプ PL1）、緑押ボタン（PB3）で警報（赤ランプ PL4）を自己保持し、黄押ボタン（PB2）で両方を停止する回路である。運転中かつ警報中は黄ランプ（PL2）も点灯する。現在はタイムチャートどおりに動作しない。回路図は与えられない。故障箇所を2つ指摘し、白線で修復または部品を交換しなさい。",
  "timeLimit": { "standardMin": 30, "cutoffMin": 50 },
  "board": {
    "boardId": "board-jipm-std",
    "socketRoles": { "S1": "CR1", "S2": "CR2", "S3": "CR3", "S4": "CR4", "S7": "CHK" }
  },
  "inventory": [{ "kind": "relay-my4n", "count": 4 }],
  "schematic": {
    "formatVersion": 1,
    "id": "sch-c2-008",
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
        "from": { "rung": "r1", "node": 1 },
        "to": { "bus": "N" },
        "cells": [
          { "kind": "pb-a", "id": "c06", "device": "PB3" },
          { "kind": "coil", "id": "c07", "device": "CR2" }
        ]
      },
      {
        "id": "r2h",
        "from": { "rung": "r2", "node": 0 },
        "to": { "rung": "r2", "node": 1 },
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
  "faults": [
    { "target": { "wireId": "sw-016" }, "kind": "wire-missing" },
    { "target": { "partId": "CR1", "elementIndex": 0 }, "kind": "coil-open" }
  ],
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

- [ ] **Step 2: 失敗する弁別テストを書く**

`packages/content/test/builtin-c2-discrimination.test.ts`:

```ts
import { addWire, JIPM_BOARD, removeWire } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_INSPECT_REPAIR_PROBLEMS } from '../src/builtin/index.js';
import type { FaultReport } from '../src/faults.js';
import {
  buildInspectRepairCircuit,
  replacePart,
  REPAIR_WIRE_COLOR,
  type RepairCircuit,
} from '../src/inspect-repair.js';
import { judgeInspectRepair } from '../src/judge-inspect.js';

/**
 * 内蔵C2課題8題の弁別テスト。設計仕様 §7.8 の自己整合テストにあたる。
 * 「正しく指摘して正しく修復すれば合格し、修復しなければ不合格になる」ことを全題で見張る。
 */

/** 修復の1手。 */
type Repair =
  | { op: 'remove'; wireId: string }
  | { op: 'add'; from: string; to: string }
  | { op: 'replace'; partId: string };

/** 課題IDごとの正しい修復手順。 */
const REPAIRS: Readonly<Record<string, readonly Repair[]>> = {
  'c2-001': [
    { op: 'remove', wireId: 'sw-005' },
    { op: 'add', from: 'TB_PB.1a', to: 'CR1.14' },
    { op: 'add', from: 'CR1.6', to: 'TB_PL.1+' },
  ],
  'c2-002': [
    { op: 'remove', wireId: 'sw-002' },
    { op: 'add', from: 'TB_PB.2c', to: 'CR1.10' },
    { op: 'replace', partId: 'CR1' },
  ],
  'c2-003': [
    { op: 'remove', wireId: 'sw-011' },
    { op: 'add', from: 'CR1.6', to: 'T1.14' },
    { op: 'replace', partId: 'T1' },
  ],
  'c2-004': [
    { op: 'remove', wireId: 'sw-012' },
    { op: 'add', from: 'CR1.7', to: 'TB_PL.1+' },
    { op: 'replace', partId: 'T1' },
  ],
  'c2-005': [
    { op: 'remove', wireId: 'sw-010' },
    { op: 'add', from: 'CR2.1', to: 'CR1.14' },
    { op: 'replace', partId: 'CR2' },
  ],
  'c2-006': [
    { op: 'add', from: 'T1.6', to: 'T2.14' },
    { op: 'remove', wireId: 'sw-016' },
    { op: 'add', from: 'T1.5', to: 'TB_PL.1+' },
  ],
  'c2-007': [
    { op: 'remove', wireId: 'sw-020' },
    { op: 'add', from: 'T1.5', to: 'CR2.14' },
    { op: 'replace', partId: 'CR2' },
  ],
  'c2-008': [
    { op: 'add', from: 'TB_PB.3a', to: 'CR2.14' },
    { op: 'replace', partId: 'CR1' },
  ],
};

/** 故障の在処から「正しい指摘」を組み立てる（訓練者が3D盤でクリックする内容と同じ）。§9.2 */
function correctReports(circuit: RepairCircuit): FaultReport[] {
  return circuit.applied.sites.map((site) => {
    if (site.report === 'part-defect') {
      return { target: { partId: site.partId ?? '' }, kind: site.report };
    }
    if (site.report === 'wire-missing') {
      return { target: { terminalId: site.terminals[0] ?? '' }, kind: site.report };
    }
    return { target: { wireId: site.wireId ?? '' }, kind: site.report };
  });
}

/** 修復手順を適用する。 */
function applyRepairs(circuit: RepairCircuit, repairs: readonly Repair[]): RepairCircuit {
  let current = circuit;
  for (const repair of repairs) {
    if (repair.op === 'remove') {
      const removed = removeWire(current.session, repair.wireId);
      if (!removed.ok) throw new Error(`${repair.wireId}: ${removed.message}`);
    } else if (repair.op === 'add') {
      const added = addWire(
        current.session,
        JIPM_BOARD,
        toTerminalId(repair.from),
        toTerminalId(repair.to),
        REPAIR_WIRE_COLOR,
      );
      if (!added.ok) throw new Error(`${repair.from}-${repair.to}: ${added.message}`);
    } else {
      current = replacePart(current, repair.partId);
    }
  }
  return current;
}

function circuitOf(id: string) {
  const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === id);
  if (problem === undefined) throw new Error(`no problem ${id}`);
  const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { problem, circuit: built.value };
}

describe('内蔵C2課題8題（§7.9）', () => {
  it('registers eight problems: four grade 2 and four grade 1', () => {
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS).toHaveLength(8);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS.map((p) => p.id)).toEqual([
      'c2-001',
      'c2-002',
      'c2-003',
      'c2-004',
      'c2-005',
      'c2-006',
      'c2-007',
      'c2-008',
    ]);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS.filter((p) => p.grade === 2)).toHaveLength(4);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS.filter((p) => p.grade === 1)).toHaveLength(4);
  });

  it('covers wire and part faults across the eight problems (§5.4)', () => {
    const kinds = new Set<string>();
    for (const problem of BUILTIN_INSPECT_REPAIR_PROBLEMS) {
      if (!Array.isArray(problem.faults)) continue;
      for (const fault of problem.faults) kinds.add(fault.kind);
    }
    expect(kinds.has('wire-open')).toBe(true);
    expect(kinds.has('wire-missing')).toBe(true);
    expect(kinds.has('wire-misrouted')).toBe(true);
    expect(kinds.has('contact-welded')).toBe(true);
    expect(kinds.has('contact-open')).toBe(true);
    expect(kinds.has('contact-resistive')).toBe(true);
    expect(kinds.has('coil-open')).toBe(true);
  });

  for (const id of Object.keys(REPAIRS)) {
    it(`${id}: 指摘して修復すると合格する（§16 受入基準③）`, () => {
      const { problem, circuit } = circuitOf(id);
      const reports = correctReports(circuit);
      const repaired = applyRepairs(circuit, REPAIRS[id] ?? []);
      const judged = judgeInspectRepair(problem, JIPM_BOARD, repaired, reports);
      expect(judged.ok, id).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.mismatches, id).toEqual([]);
      expect(judged.value.reports.missed, id).toEqual([]);
      expect(judged.value.reports.extra, id).toEqual([]);
      expect(judged.value.modifications, id).toEqual([]);
      expect(judged.value.staticChecks.every((c) => c.ok), id).toBe(true);
      expect(judged.value.passed, id).toBe(true);
    });

    it(`${id}: 修復しなければ不合格になる`, () => {
      const { problem, circuit } = circuitOf(id);
      const judged = judgeInspectRepair(problem, JIPM_BOARD, circuit, correctReports(circuit));
      expect(judged.ok, id).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.reports.missed, id).toEqual([]);
      expect(judged.value.mismatches.length, id).toBeGreaterThan(0);
      expect(judged.value.passed, id).toBe(false);
    });

    it(`${id}: 指摘を1件落とすと不合格になる`, () => {
      const { problem, circuit } = circuitOf(id);
      const reports = correctReports(circuit).slice(1);
      const repaired = applyRepairs(circuit, REPAIRS[id] ?? []);
      const judged = judgeInspectRepair(problem, JIPM_BOARD, repaired, reports);
      expect(judged.ok, id).toBe(true);
      if (!judged.ok) return;
      expect(judged.value.reports.missed.length, id).toBe(1);
      expect(judged.value.passed, id).toBe(false);
    });
  }
});
```

- [ ] **Step 3: RED を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin-c2-discrimination.test.ts
```

Expected: 失敗。`BUILTIN_INSPECT_REPAIR_PROBLEMS` はまだ4題なので `expect(...).toHaveLength(8)` と `no problem c2-005` で `Test Files  1 failed (1)`。

- [ ] **Step 4: `src/builtin/index.ts` に残り4題を登録する**

`packages/content/src/builtin/index.ts` の import に足す:

```ts
import c2Interlock from './inspect-repair/c2-005-interlock.json' with { type: 'json' };
import c2Sequential from './inspect-repair/c2-006-sequential.json' with { type: 'json' };
import c2Flicker from './inspect-repair/c2-007-flicker.json' with { type: 'json' };
import c2StopPriority from './inspect-repair/c2-008-stop-priority.json' with { type: 'json' };
```

`BUILTIN_INSPECT_REPAIR_JSON` を次に置き換える:

```ts
/** 内蔵のモードC2課題のJSON。 */
const BUILTIN_INSPECT_REPAIR_JSON: readonly unknown[] = [
  c2SelfHold,
  c2SelfHoldContact,
  c2OnDelay,
  c2OneShot,
  c2Interlock,
  c2Sequential,
  c2Flicker,
  c2StopPriority,
];
```

- [ ] **Step 5: GREEN を確認する**

```powershell
pnpm --filter @ojt/content exec vitest run test/builtin-c2-discrimination.test.ts test/builtin-inspect-repair.test.ts
```

Expected: `Test Files  2 passed (2)` / `Tests  39 passed (39)`（`builtin-c2-discrimination.test.ts`: 固定2 + 8題 × 3 = 26、`builtin-inspect-repair.test.ts`: 登録まわり4 + 弁別(8題個別)8 + 自己整合1 = 13）。

- [ ] **Step 6: コミットする**

```powershell
git add packages/content/src/builtin/inspect-repair packages/content/src/builtin/index.ts packages/content/test/builtin-c2-discrimination.test.ts
git commit -m @'
feat(content): add four grade-1 mode C2 problems and repair discrimination tests

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 17: 公開APIの確定と全体検証

**Files:**
- Modify: `packages/content/src/index.ts`
- Modify: `packages/content/test/index.test.ts`
- Modify: `apps/desktop/src/main/content-loader.ts`

`@ojt/content` のバレルに Phase 2A で足したものを載せ、`apps/desktop` の型を1箇所だけ追随させて、モノレポ全体を緑にする。

**`apps/desktop` に触れる理由（1ファイル・2行）:** Task 8 で `parseProblem()` の成功時の型が `SupportedProblem` に広がり、`ProblemSet.problems` も広がった。`apps/desktop/src/main/content-loader.ts` はこれを `Map<string, AssembleProblem>` に入れているので型が合わなくなる。モードB以外を開始できる画面は Plan 2B で入るため、ここでは**一覧と `byId` をモードBに絞る**のが最小かつ正しい追随になる（利用者フォルダに置かれたC1/C2課題は、開ける画面ができるまで一覧に出さない）。`shared/ipc.ts` も renderer も変更不要である。

- [x] **Step 1: `src/index.ts` に Phase 2A の公開APIを足す**

`packages/content/src/index.ts` の `export { … } from './schema/assemble.js';` の**直後**に次を挿入する:

```ts
export {
  FAULT_KINDS,
  FaultKindSchema,
  FaultSpecSchema,
  FaultsSchema,
  FaultTargetSchema,
  isPartFaultKind,
  isRandomFaults,
  isWireFaultKind,
  LOAD_ELEMENT_INDEX,
  PART_FAULT_KINDS,
  PartFaultTargetSchema,
  RandomFaultsSchema,
  SOCKET_COIL_ELEMENT_INDEX,
  socketContactElementIndex,
  WIRE_FAULT_KINDS,
  WireFaultTargetSchema,
  type FaultSpecData,
  type FaultsData,
  type FaultTargetData,
  type RandomFaultsData,
} from './schema/faults.js';

export {
  CONTACT_TRUTHS,
  InspectPartSchema,
  InspectPartsProblemSchema,
  isContactTruth,
  PART_TRUTHS,
  PartTruthSchema,
  type InspectPartData,
  type InspectPartsProblem,
  type PartTruth,
} from './schema/inspect-parts.js';

export {
  InspectRepairProblemSchema,
  type InspectRepairProblem,
} from './schema/inspect-repair.js';
```

`export { parseProblem, … } from './schema/index.js';` のブロックを次に置き換える:

```ts
export {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  parseProblem,
  problemJsonSchema,
  ProblemSchema,
  toProblemIssues,
  UnsupportedProblemSchema,
  type ParseProblemResult,
  type Problem,
  type ProblemFailureReason,
  type ProblemIssue,
  type SupportedProblem,
  type UnsupportedProblem,
} from './schema/index.js';
```

`export { ASSEMBLE_WIRE_COLOR, … } from './reference.js';` のブロックに `type SchematicProblem` を足す:

```ts
export {
  ASSEMBLE_WIRE_COLOR,
  buildReferenceSession,
  toPhysicalOverride,
  toProblemPath,
  type ReferenceCircuit,
  type ReferenceResult,
  type SchematicProblem,
} from './reference.js';
```

`export { checkCoilPolarity, … } from './static-checks.js';` の**直前**に次を挿入する:

```ts
export { hashSeed, mulberry32, pickIndex, pickOne } from './rng.js';

export {
  applyFaults,
  faultParam,
  injectPartFaults,
  matchesSite,
  reportKindOf,
  withoutPartFaults,
  type AppliedFaults,
  type ApplyFaultsResult,
  type FaultReport,
  type FaultReportKind,
  type FaultSite,
} from './faults.js';

export {
  MAX_RANDOM_FAULT_ATTEMPTS,
  RANDOM_FAULT_KINDS,
  resolveFaults,
  type ResolveFaultsOptions,
  type ResolveFaultsResult,
} from './random-faults.js';

export {
  findForbiddenPatterns,
  type ForbiddenPattern,
  type ForbiddenPatternKind,
} from './forbidden.js';

export {
  buildCheckCircuit,
  CHECK_COIL_MINUS,
  CHECK_COIL_PLUS,
  CHECK_PART_ID,
  CHECK_TIMER_PRESET_MS,
  checkContactTerminals,
  checkSettleMs,
  DIAGNOSIS_TABLE,
  expectedCheckReading,
  faultGroupOf,
  LAYER_SHORT_JUDGE_RATIO,
  layerShortThresholdOhms,
  PART_TRUTH_LABELS,
  truthFault,
  type CheckCircuit,
  type CheckCircuitResult,
  type DiagnosisRow,
  type ExpectedCheckReading,
} from './inspect-parts.js';

export {
  addedWireIds,
  buildInspectRepairCircuit,
  INITIAL_WIRE_COLOR,
  modificationWireIds,
  repairNetlist,
  replacePart,
  REPAIR_WIRE_COLOR,
  type RepairCircuit,
  type RepairCircuitResult,
} from './inspect-repair.js';

export {
  buildHighlightIndex,
  cellIdsAtTerminal,
  cellIdsOfWire,
  highlightFor,
  type HighlightIndex,
  type HighlightTarget,
} from './highlight.js';
```

`export { judgeAssemble, … } from './judge.js';` のブロックを次に置き換え、その直後に判定の追加分を足す:

```ts
export {
  countHazards,
  judgeAssemble,
  judgeReference,
  type HazardCounts,
  type JudgeAssembleResult,
  type JudgeOptions,
  type JudgeResult,
} from './judge.js';

export {
  judgeInspectParts,
  judgeInspectRepair,
  scoreReports,
  type InspectPartAnswer,
  type InspectPartScore,
  type InspectReportScore,
  type JudgeInspectPartsResult,
  type JudgeInspectRepairOutcome,
  type JudgeInspectRepairResult,
  type JudgeInspectResult,
} from './judge-inspect.js';
```

最後に `export { BUILTIN_ASSEMBLE_PROBLEMS, … } from './builtin/index.js';` を次に置き換える:

```ts
export {
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PROBLEMS,
  BuiltinProblemError,
  findBuiltinProblem,
  parseBuiltinProblems,
} from './builtin/index.js';
```

- [x] **Step 2: `test/index.test.ts` にバレル経由の煙テストを足す**

`packages/content/test/index.test.ts` の import 一覧に次の名前を足す（既存のグループコメントに合わせて並べる）:

```ts
  // schema/faults.js
  FAULT_KINDS,
  FaultSpecSchema,
  socketContactElementIndex,
  // schema/inspect-parts.js
  InspectPartsProblemSchema,
  PART_TRUTHS,
  // schema/inspect-repair.js
  InspectRepairProblemSchema,
  // schema/index.js
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  // rng.js / faults.js / random-faults.js / forbidden.js
  applyFaults,
  findForbiddenPatterns,
  mulberry32,
  RANDOM_FAULT_KINDS,
  resolveFaults,
  // inspect-parts.js / inspect-repair.js / highlight.js
  buildCheckCircuit,
  buildHighlightIndex,
  buildInspectRepairCircuit,
  DIAGNOSIS_TABLE,
  expectedCheckReading,
  layerShortThresholdOhms,
  PART_TRUTH_LABELS,
  REPAIR_WIRE_COLOR,
  // judge-inspect.js
  judgeInspectParts,
  judgeInspectRepair,
  scoreReports,
  // builtin/index.js
  BUILTIN_ALL_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
```

同ファイルの `expect(UNSUPPORTED_MODES).toEqual(['plc']);` を含む `describe` の後ろに、次の `describe` を足す:

```ts
describe('Phase 2A の公開API（バレル経由）', () => {
  it('exposes the fault schema and the socket element helper', () => {
    expect(FAULT_KINDS).toHaveLength(9);
    expect(socketContactElementIndex(2, 'a')).toBe(4);
    expect(
      FaultSpecSchema.safeParse({ target: { wireId: 'sw-001' }, kind: 'wire-open' }).success,
    ).toBe(true);
  });

  it('exposes the C1 and C2 schemas and their type guards', () => {
    expect(PART_TRUTHS).toHaveLength(7);
    const c1 = InspectPartsProblemSchema.safeParse(inspectPartsProblemJson());
    expect(c1.success).toBe(true);
    const c2 = InspectRepairProblemSchema.safeParse(inspectRepairProblemJson());
    expect(c2.success).toBe(true);
    if (!c1.success || !c2.success) return;
    expect(isInspectPartsProblem(c1.data)).toBe(true);
    expect(isInspectRepairProblem(c2.data)).toBe(true);
    expect(isAssembleProblem(c1.data)).toBe(false);
  });

  it('exposes the built-in C1 and C2 problems (§7.9)', () => {
    expect(BUILTIN_INSPECT_PARTS_PROBLEMS).toHaveLength(4);
    expect(BUILTIN_INSPECT_REPAIR_PROBLEMS).toHaveLength(8);
    expect(BUILTIN_ALL_PROBLEMS).toHaveLength(20);
  });

  it('exposes the C1 domain: check circuit, diagnosis table and thresholds (§9.1)', () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    const part = problem.parts[0];
    if (part === undefined) return;
    expect(buildCheckCircuit(problem, JIPM_BOARD, part.id).ok).toBe(true);
    expect(expectedCheckReading(part).coilOhms).toBeCloseTo(650, 3);
    expect(layerShortThresholdOhms()).toBeCloseTo(552.5, 3);
    expect(DIAGNOSIS_TABLE).toHaveLength(7);
    expect(PART_TRUTH_LABELS['coil-layer-short']).toBe('レアショート');
  });

  it('exposes the C2 domain: faulted board, highlight index and judging (§9.2)', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    expect(REPAIR_WIRE_COLOR).toBe('白');
    const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const index = buildHighlightIndex(built.value.cells, built.value.session);
    expect(index.size).toBeGreaterThan(0);
    const scored = scoreReports(built.value.applied.sites, []);
    expect(scored.missed).toHaveLength(2);
    const judged = judgeInspectRepair(problem, JIPM_BOARD, built.value, []);
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    expect(judged.value.mode).toBe('inspect-repair');
    expect(judged.value.passed).toBe(false);
    expect(judged.value.hazardsByKind['range-exceeded']).toBe(0);
  });

  it('exposes the C1 judge and the deterministic helpers', () => {
    const problem = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
    if (problem === undefined) return;
    const result = judgeInspectParts(
      problem,
      problem.parts.map((p) => ({ partId: p.id, answer: p.truth })),
    );
    expect(result.passed).toBe(true);
    const random = mulberry32(1);
    expect(random()).toBe(mulberry32(1)());
  });

  it('exposes the fault application, random faults and forbidden circuit helpers', () => {
    const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS[0];
    if (problem === undefined) return;
    expect(RANDOM_FAULT_KINDS).not.toContain('lamp-open');
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(findForbiddenPatterns(built.value.netlist)).toEqual([]);
    expect(applyFaults(built.value.session, []).ok).toBe(true);
  });
});
```

同ファイルの import に、テスト用の課題JSONも足す:

```ts
import { inspectPartsProblemJson, inspectRepairProblemJson } from './helpers/inspect.js';
```

（`buildReferenceSession` と `JIPM_BOARD` は既に import 済み。無ければ足す。）

- [x] **Step 3: `apps/desktop` の型を追随させる**

`apps/desktop/src/main/content-loader.ts` の4行目を次に置き換える:

```ts
import {
  BUILTIN_PROBLEMS,
  isAssembleProblem,
  type AssembleProblem,
  type ProblemLoadError,
} from '@ojt/content';
```

同ファイルの `readContent()` の中、`const merged = mergeProblemSets(builtin, user);` から `byId` の生成までを次に置き換える:

```ts
  const merged = mergeProblemSets(builtin, user);
  // Plan 2A で `ProblemSet.problems` がモードB／C1／C2の共用体に広がった。C1/C2を開始できる
  // 画面が入るのは Plan 2B なので、ここではモードBだけを一覧に載せる（利用者フォルダに
  // C1/C2 の課題を置いても、開ける画面ができるまでは一覧に出さない）。
  const startable = merged.problems.filter(isAssembleProblem);
  // 弾いた課題（読込自体は成功しているC1/C2）を無言で消さず、理由付きでエラー一覧に出す(M-10)。
  // 本物のファイルパスはここでは持てないので、`file` は課題IDで代える。
  const notStartable: ProblemLoadError[] = merged.problems
    .filter((p) => !isAssembleProblem(p))
    .map((p) => ({
      file: p.id,
      reason: 'unsupported-mode',
      message: `このアプリのこのバージョンではまだ開けないモードです（${p.mode}）: ${p.id}`,
      issues: [],
      id: p.id,
    }));
  const userIds = new Set(user.problems.map((p) => p.id));
  const byId = new Map(startable.map((p) => [p.id, p] as const));
  return {
    payload: {
      problems: startable.map((p) =>
        toSummary(p, userIds.has(p.id) || !builtinIds.has(p.id) ? 'user' : 'builtin'),
      ),
      errors: [...merged.errors, ...notStartable].map(toErrorRow),
      userDir,
      userDirExists: exists,
    },
    byId,
  };
```

- [x] **Step 4: パッケージ単位で確認する**

```powershell
pnpm --filter @ojt/content exec vitest run
```

Expected: 全テストファイルが通る（Phase 2A で新しく足したのは `schema-faults` / `faults` / `schema-inspect-parts` / `schema-inspect-repair` / `rng` / `random-faults` / `inspect-parts` / `inspect-repair` / `forbidden` / `judge-inspect` / `highlight` / `builtin-inspect-parts` / `builtin-inspect-repair` / `builtin-c2-discrimination` の14ファイル・221件（2A後半レビュー反映後。@ojt/content 全体では32ファイル・442件））。

- [x] **Step 5: カバレッジを確認する**

```powershell
pnpm --filter @ojt/circuit-sim exec vitest run --coverage
pnpm --filter @ojt/content exec vitest run --coverage
```

Expected: どちらも `All files` の lines / statements / functions / branches が 90% 以上（§14.2）。

- [x] **Step 6: 型・リントを確認する**

```powershell
pnpm -r typecheck
pnpm lint
```

Expected: `typecheck` は無出力で成功、`lint` は警告0（`import-x/no-cycle` 込み）。

- [x] **Step 6a: 整形を自動適用してから確認する (I-5)**

このプランのコード例は手で書いているため、10箇所ほどで行幅100を超えている。`--check` だけでは落ちるので、先に `--write` で機械的に揃えてから確認する:

```powershell
npx prettier --write "packages/circuit-sim/**/*.ts" "packages/content/**/*.{ts,json}"
npx prettier --check "packages/circuit-sim/**/*.ts" "packages/content/**/*.{ts,json}"
pnpm -r test
```

Expected: `--write` が整形の崩れたファイルを書き換え、`--check` は `All matched files use Prettier code style!` を出す。`pnpm -r test` は5プロジェクト（`circuit-sim` / `board-model` / `schematic-core` / `content` / `desktop`）すべて通る。

- [x] **Step 7: JSON Schema が最新か確認する**

```powershell
pnpm --filter @ojt/content schema:write
git diff --stat packages/content/schema/task.schema.json
```

Expected: 差分なし（Task 8 で再生成済み。差分が出たらコミットに含める）。

- [x] **Step 8: コミットする**

```powershell
git add packages/content/src/index.ts packages/content/test/index.test.ts apps/desktop/src/main/content-loader.ts
git commit -m @'
feat(content): publish the phase 2A api and keep desktop on mode B listings

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## タスクと仕様節の対応

| タスク | 主に実装する仕様節 |
|---|---|
| Task 1 | §9.3（テスターの種別・つまみ・プローブ・デジタル表示）、§5.5（測定API の利用） |
| Task 2 | §9.3（アナログのレンジ・針・0Ω調整・慣性）、§5.6 #2（`range-exceeded`） |
| Task 3 | §7.5（`faults` の形式）、§5.4（故障種別と対象） |
| Task 4 | §5.4（故障の適用モデル）、§9.2（指摘の対象＝故障の在処） |
| Task 5 | §7.5 モードC1の別形式、§9.1（解答の選択肢）、§17.2 #5・#6 |
| Task 6 | §7.5（C2は回路図＋`faults`）、§9.2（提示情報と級の対応） |
| Task 7 | §7.5（ランダム故障と制約・フォールバック）、§5.2（決定論） |
| Task 8 | §7.1・§7.8（課題の判別と読込）、§13 #1、§4.5（JSON Schema）、§16（開始できるモード） |
| Task 9 | §9.1（切り分け手順・測定端子・判定表・しきい値）、§16 受入基準①② |
| Task 10 | §9.2（初期盤・白線・改造・部品交換）、§8.1（線色パレット） |
| Task 11 | §7.4（`forbiddenCircuit` の構造パターン照合、`wireColorRule` の適用範囲）、§5.3.2、調査資料 §5.5 |
| Task 12 | §9.1 判定、§9.2 判定①〜⑤、§7.4（合否の考え方）、§17.2 #3 |
| Task 13 | §9.2 連動ハイライト、§11.4 |
| Task 14 | §7.9（C1 4セット）、§7.8（自己整合テスト） |
| Task 15 | §7.9（C2 2級形式4題）、§17.2 #4 |
| Task 16 | §7.9（C2 1級形式4題）、§16 受入基準③ |
| Task 17 | §4.1（公開API）、§14.2（カバレッジ）、§14.3（CI） |

---

## 仕様との対応表（完了判定に使う）

| 仕様 | 要件 | 実装 | 検証 |
|---|---|---|---|
| §5.4 | 故障注入API（9種・対象・パラメータ） | `src/schema/faults.ts`（`FAULT_KINDS` / `FaultSpecSchema`）＋ `src/faults.ts`（`applyFaults` / `injectPartFaults`） | `test/schema-faults.test.ts` / `test/faults.test.ts` |
| §5.4 | `wire-open` は3D上に線が見えるが導通しない | セッションの電線に `open = true`（`toNetlist()` が写す） | `test/faults.test.ts` |
| §5.4 | `wire-missing` は電線そのものが存在しない | セッションから電線を取り除く | 同上 |
| §5.4 | `wire-misrouted` は片端が誤った端子 | セッションの電線の `to` を付け替え（1端子2本の上限も検査） | 同上 |
| §5.5 | テスター測定API（DCV / ACV / Ω / 導通、`OL`、回り込み） | `@ojt/circuit-sim` の `meter.ts`（Plan 1A）を `tester.ts` が使う | `test/tester.test.ts` |
| §5.6 #1 | `ohm-on-live`（プローブ間1V以上でΩ／導通） | `meter.ts`（Plan 1A）。C1では赤PBを押したまま測ると発火する | `test/tester.test.ts` / `test/inspect-parts.test.ts` |
| §5.6 #2 | `range-exceeded`（アナログの振り切れ） | `tester.ts` の `stepTester()` が `sim.events` に発行 | `test/tester-analog.test.ts` |
| §5.6 | 危険操作は回数記録のみで合否に影響しない | `countHazards()` を C1/C2 判定でも使う。`passed` の式に含めない | `test/judge-inspect.test.ts` |
| §7.4 | `forbiddenCircuit` の構造パターン照合（Phase 2 で追加） | `src/forbidden.ts` の `findForbiddenPatterns()` を `checkForbiddenCircuit()` が呼ぶ | `test/forbidden.test.ts` / `test/static-checks.test.ts` |
| §7.5 | 故障課題の定義（明示リスト／ランダム／制約／フォールバック） | `FaultsSchema` / `RandomFaultsSchema` / `resolveFaults()` | `test/schema-faults.test.ts` / `test/random-faults.test.ts` |
| §7.5 | モードC1の別形式（`parts` / `truth` / `ratio` / 組の選択） | `src/schema/inspect-parts.ts` ＋ `faultGroupOf()` / `truthFault()` | `test/schema-inspect-parts.test.ts` / `test/inspect-parts.test.ts` |
| §7.8 | zod検証・読込エラーは理由付き・内蔵課題の自己整合 | `parseProblem()` の4分岐、`BUILTIN_*_PROBLEMS`、C1/C2の自己整合テスト | `test/schema-index.test.ts` / `test/builtin-inspect-parts.test.ts` / `test/builtin-inspect-repair.test.ts` |
| §7.9 | C1 4セット／C2 8題 | `src/builtin/inspect-parts/*.json`（4）/ `src/builtin/inspect-repair/*.json`（8） | `test/builtin-inspect-parts.test.ts` / `test/builtin-c2-discrimination.test.ts` |
| §8.1 | 新規配線の線色はC2では白のみ | `REPAIR_WIRE_COLOR` ＋ `session.allowedColors = ['白']` ＋ `checkWireColorRule` | `test/inspect-repair.test.ts` / `test/judge-inspect.test.ts` |
| §9.1 | C1の切り分け手順（励磁 → 接点導通 → コイル抵抗） | `buildCheckCircuit()` ＋ `checkContactTerminals()` ＋ `CHECK_COIL_*` | `test/inspect-parts.test.ts` |
| §9.1 | 測定1: 赤PBを離していれば通電したまま安全に測れる | チェック用回路の固定配線（Plan 1B）をそのまま使う | `test/inspect-parts.test.ts` |
| §9.1 | 判定表（7行）とレアショートのしきい値85% | `DIAGNOSIS_TABLE` / `LAYER_SHORT_JUDGE_RATIO` / `layerShortThresholdOhms()` | `test/inspect-parts.test.ts` |
| §9.1 | マークシート（部品 × 7択の排他選択）と「n/m 正解」 | `PART_TRUTH_LABELS` / `judgeInspectParts()` の `correctCount` / `total` | `test/judge-inspect.test.ts` |
| §9.2 | 青線で配線済みの盤に故障が注入された状態で開始 | `buildInspectRepairCircuit()` | `test/inspect-repair.test.ts` |
| §9.2 | 指摘（電線・端子・部品をクリック → 種別）と過不足の集計 | `FaultReport` / `matchesSite()` / `scoreReports()` | `test/faults.test.ts` / `test/judge-inspect.test.ts` |
| §9.2 | 改造（故障箇所でない青線の削除）の計上 | `modificationWireIds()` | `test/inspect-repair.test.ts` / `test/judge-inspect.test.ts` |
| §9.2 | 部品交換（C1で良品と判定した部品に差し替える） | `replacePart()` / `withoutPartFaults()` | `test/inspect-repair.test.ts` |
| §9.2 | 合格条件（指摘の過不足0・動作一致・白線ルール・改造0） | `judgeInspectRepair()` の `passed` | `test/builtin-c2-discrimination.test.ts` |
| §9.2 | 回路図の連動ハイライト | `src/highlight.ts`（索引のみ。描画は 2B） | `test/highlight.test.ts` |
| §9.3 | デジタル／アナログの切替、レンジ、表示解像度 | `tester.ts` の `TesterKind` / `TesterMode` / `ANALOG_*_RANGES` | `test/tester.test.ts` / `test/tester-analog.test.ts` |
| §9.3 | アナログ針（線形／中央目盛）・0Ω調整・慣性 | `voltNeedleDeg()` / `ohmNeedleDeg()` / `withZeroAdjustError()` / `stepTester()` | `test/tester-analog.test.ts` |
| §9.3 | プローブは黒 → 赤 の順に置く | `applyTesterAction({type:'place-probe'})` | `test/tester.test.ts` |
| §12.3 | 作業ファイル・クラッシュ復帰 | Plan 1D2 で実装済み（本プランの範囲外） | — |
| §13 #2 | 課題データの誤りは理由付きで返し、アプリを落とさない | `ApplyFaultsResult` / `CheckCircuitResult` / `RepairCircuitResult` / `JudgeInspectRepairOutcome` | `test/faults.test.ts` / `test/inspect-parts.test.ts` / `test/inspect-repair.test.ts` |
| §14.1 #17〜#21 | 故障・測定のゴールデンケース | Plan 1A で実装済み。本プランは C1 の判定表としてもう一度固定する | `test/inspect-parts.test.ts` |
| §14.2 | `circuit-sim` / `content` のカバレッジ90% | `vitest.config.ts` の閾値 | Task 17 Step 5 |
| §16 Phase 2 ① | C1でチェック用ソケットに不良リレーを挿し赤PBで励磁すると判定表どおりの読値になる | `buildCheckCircuit()` ＋ `expectedCheckReading()` | `test/inspect-parts.test.ts` / `test/builtin-inspect-parts.test.ts` |
| §16 Phase 2 ② | コイル断線＝吸引せず `OL`、レアショート＝正常に吸引して約420Ω、解答が正解になる | 同上 ＋ `judgeInspectParts()` | `test/inspect-parts.test.ts` / `test/judge-inspect.test.ts` |
| §16 Phase 2 ③ | C2で故障2箇所を指摘し白線で修復すると合格する | `judgeInspectRepair()` | `test/builtin-c2-discrimination.test.ts`（8題×3件） |
| §16 Phase 2 ④ | 電源ONのままΩレンジを当てると警告が出て結果に回数が記録される | `meter.ts` の `ohm-on-live` ＋ `hazardsByKind` | `test/inspect-parts.test.ts` / `test/judge-inspect.test.ts` |
| §17.2 #3 | 定量減点は実装しない（危険操作・所要時間は参考表示） | `passed` の式に含めない | `test/judge-inspect.test.ts` |
| §17.2 #4 | 内蔵の故障課題は2箇所を基本とする | C2 8題すべて `faults` が2件 | `test/builtin-inspect-repair.test.ts` |
| §17.2 #5 | マークシートは「部品 × ｛正常＋不良原因6種｝の排他選択」 | `PART_TRUTHS`（7値）＋ `InspectPartAnswer` | `test/schema-inspect-parts.test.ts` |
| §17.2 #6 | タイマにレアショートは出題しない | `InspectPartSchema` の refinement | `test/schema-inspect-parts.test.ts` |
| §17.2 #7 | レアショートは動作正常・抵抗のみ低下、しきい値85% | `expectedCheckReading()` / `layerShortThresholdOhms()` | `test/inspect-parts.test.ts` |

---

## 仕様からの意図的な差分（レビュー時に確認する）

| # | 仕様の記述 | 本プランの実装 | 理由 |
|---|---|---|---|
| 1 | §9.3 のテスターはUIの節に書かれている | 状態機械と読値整形を `@ojt/circuit-sim/src/tester.ts`（エンジン側）に置き、描画だけを 2B に残した | 針の式・0Ω調整の誤差・慣性は計器の物理であってUIの都合ではない。`range-exceeded` を発行するには `Simulation.events` が要る。新パッケージを作っても結局 `circuit-sim` に依存し `Simulation` を受け取るだけで、分ける利得が無い（冒頭の Architecture 参照） |
| 2 | §5.4 の `injectFault` は `param?: number \| TerminalId`（kind で意味が変わる） | 課題JSONでは `ohms` / `ratio` / `to` の名前付きフィールドに分け、`faultParam()` がエンジンの `param` に詰め替える | 「kind によって型が変わる1個のフィールド」は zod で意味のある検証ができず、課題作者にも読めない。エンジン側のAPIは変えていない |
| 3 | §7.5 ランダム故障は「超過時は明示リストのフォールバックを使う」 | `random.fallback`（`count` と同じ件数の明示リスト）を**必須**にした | フォールバックの中身が無ければ仕様の要求を満たせない。課題データとして持たせる以外に置き場所が無い |
| 4 | §5.4 は `lamp-open` を故障種別として持つ | ランダム生成の候補（`RANDOM_FAULT_KINDS`）からは外した（明示リストでは指定できる） | ランプは盤に固定された機器で交換できず、修復後の動作一致（§9.2 判定②）に到達できない課題になってしまう。内蔵C2課題でも使わない |
| 5 | §5.4 は `coil-layer-short` を故障種別として持つ | 内蔵C2課題では使わない（スキーマとランダム候補には残す） | レアショートは動作が正常なので、C2の判定②（修復後の動作一致）では修復しなくても合格してしまい、教育上の筋が通らない。レアショートはC1の主題である（§9.1 / §17.2 #7） |
| 6 | §9.2「3D上で電線・端子・部品をクリック → 故障種別を選ぶ」 | 指摘の対象を `{wireId}` / `{terminalId}` / `{partId}` の3種にし、**未配線だけは端子で指す**ことにした | 未配線は盤に電線が無いのでクリックできる対象が端子しかない。断線・誤配線は電線が見えているので電線で指す |
| 7 | §9.2「部品交換を許可する」 | `replacePart()` は電気的な故障だけを取り消し、**指摘の対象（`sites`）は残す** | 交換しても「その部品が不良だった」事実は消えず、指摘しなければ §9.2 の合格条件①を満たさない。交換で逃げられると点検の練習にならない |
| 8 | §7.4 の静的チェック `wireColorRule` は「訓練者が引いた電線が規定の色か」 | `StaticCheckInput.preexistingWireIds` を足し、課題開始時点で盤にあった電線を検査対象から外した | C2は初期配線が青のまま残り、修復だけが白になる（§9.2）。除外しないと残っている正常な青線をすべて違反として数えてしまう |
| 9 | §7.4「`forbiddenCircuit` は構造パターン照合も行う」 | 「誰もタイムアップしていない状態でコイルが生きている」ことを条件に加えた | これが無いと、断線・未配線でコイルが死んでいるだけのC2初期盤を「タイマが自分のコイルを切っている」と誤検出する。実回路8題＋故障8通りで検出0を確認済み |
| 10 | §9.3「レンジ不足は針を振り切れ位置に固定し `range-exceeded`」 | `range-exceeded` はDCV/ACVでのみ発行する | Ωレンジは中央目盛方式（右端が0Ω・左端が∞）で「上限を超える」状態が存在しない。ACVは常に0.00Vなので実際に出るのはDCVだけ |
| 11 | §9.3 の「フルスケール角」に具体値の記載が無い | `NEEDLE_FULL_SCALE_DEG = 90` を本アプリの前提とした | 実機の可動範囲は資料に無い。実測値が判明したらこの定数だけ差し替えれば針の式は変わらない（§17.1 と同じ扱い） |
| 12 | §16 Phase 2 は「モードB・C1・C2 が動くアプリ」 | 本プラン（2A）はライブラリまで。画面・Worker・作業ファイルは Plan 2B | 依頼による分割。2A の公開APIは下の「2B への引き渡し」に固定する |
| 13 | §7.8 の課題一覧は全モードを載せる | `BUILTIN_PROBLEMS` はモードB 8題のまま据え置き、`BUILTIN_ALL_PROBLEMS`（20題）を別に公開。`apps/desktop` の一覧もモードBに絞る | C1/C2を開始できる画面が入るのは 2B。先に一覧へ出すと「選べるのに開けない課題」が並ぶ。2B が `BUILTIN_ALL_PROBLEMS` へ差し替える |
| 14 | §7.1 の `inventory` は「訓練者が使える部品と本数」 | モードC1では空配列にした（トレイの中身は `parts` が決める） | C1は盤に配線せず、チェック用ソケットに1個ずつ挿すだけなので在庫という概念が無い。`buildCheckCircuit()` が挿す部品ぶんの在庫をその場で作る |
| 15 | §9.1 の「解答は組を問わない」 | 接点の不良を入れる組は課題が `group` で明示するか、`seed` と部品IDから決定論的に決める | 組をランダムに散らしつつ、同じ課題を開き直しても同じ組になるようにする（§5.2 の決定論）。UIは組を表示しない |

---

## 2B への引き渡し（Plan 2B が使う公開API）

Plan 2B（`apps/desktop` のUI）は下記だけを使う。これ以外の内部関数に依存してはならない。

**`@ojt/circuit-sim`（テスター）:**

| API | 用途 |
|---|---|
| `createTesterState(kind?)` / `applyTesterAction(state, action)` | テスターパネルの状態（つまみ・レンジ・プローブ・0Ω調整）を更新する。Worker と renderer の両方で同じリデューサを使う |
| `readTester(sim, state)` / `stepTester(sim, state, dtMs?)` | 読値を取る。`stepTester()` は針の追従を進め、振り切れで `range-exceeded` を `sim.events` に発行する（Worker 側で毎tick呼ぶ） |
| `TesterState` / `TesterAction` / `TesterReading` / `TesterKind` / `TesterMode` / `AnalogOhmRange` | Worker プロトコルの型付け |
| `ANALOG_DCV_RANGES` / `ANALOG_ACV_RANGES` / `ANALOG_OHM_RANGES` / `voltRangesFor(mode)` | レンジ切替UIの選択肢 |
| `NEEDLE_FULL_SCALE_DEG` / `ohmNeedleDeg()` / `voltNeedleDeg()` / `withZeroAdjustError()` | 針の目盛の描画（角度は `TesterReading.targetDeg` と `TesterState.needleDeg` から取る） |
| `TESTER_OFF_DISPLAY` / `TESTER_NO_PROBE_DISPLAY` | 表示器の文字列 |
| （ハンドオフ注記 M-8） | 活線でΩ／導通を測った (`reading.live === true`) ときの表示は `readTester()` が `TESTER_NO_PROBE_DISPLAY`（`'----'`）に上書きする。`meter.ts` の生の `display`（`'OL'`）ではなく、必ず `TesterReading.display` の方をそのまま出すこと |
| （ハンドオフ注記 M-16） | デジタルΩは `rawOhms.toFixed(1)` をそのまま `display` にする（桁区切りなし）ので、`2.4MΩ` は `'2400000.0'` と表示される。桁区切りや単位変換をするなら2B側の表示層で行う |

**`@ojt/content`（モードC1）:**

| API | 用途 |
|---|---|
| `BUILTIN_INSPECT_PARTS_PROBLEMS` / `BUILTIN_ALL_PROBLEMS` / `findBuiltinProblem(id)` | 課題一覧（2B でモード別に分ける） |
| `isInspectPartsProblem(problem)` | モード判別 |
| `buildCheckCircuit(problem, board, partId)` → `{ session, netlist, group }` | トレイの部品をチェック用ソケットに挿した回路を作る（Worker に `load` で渡す） |
| `CHECK_PART_ID` / `CHECK_COIL_MINUS` / `CHECK_COIL_PLUS` / `checkContactTerminals(group)` | テスターのプローブを置く端子（3Dのハイライトにも使う） |
| `CHECK_TIMER_PRESET_MS` / `checkSettleMs(kind)` | タイマを挿したときに待つ時間の目安 |
| `PART_TRUTH_LABELS` / `PART_TRUTHS` | マークシートパネルの7択 |
| `DIAGNOSIS_TABLE` / `LAYER_SHORT_JUDGE_RATIO` / `layerShortThresholdOhms()` | ヘルプの折りたたみパネル（§9.1） |
| `judgeInspectParts(problem, answers, options)` → `JudgeInspectPartsResult` | 判定。`options` は `{ elapsedMs?, sessionHazards? }` |
| `InspectPartAnswer` / `InspectPartScore` / `JudgeInspectPartsResult` | 結果画面の型 |
| `expectedCheckReading(part)` | （任意）デバッグUI・ヘルプの実例表示 |

**`@ojt/content`（モードC2）:**

| API | 用途 |
|---|---|
| `BUILTIN_INSPECT_REPAIR_PROBLEMS` / `isInspectRepairProblem(problem)` | 課題一覧とモード判別 |
| `buildInspectRepairCircuit(problem, board, options?)` → `RepairCircuit` | 故障注入済みの初期盤。`session` をそのまま3Dに出す（`allowedColors` は白のみ） |
| `repairNetlist(circuit, board)` → `{ netlist, errors }` | 盤を触るたびにネットリストを作り直す（部品の故障は毎回注入される） |
| `replacePart(circuit, partId)` → `RepairCircuit` | 部品交換（訓練者がソケットから抜いて挿し直したとき）。**（ハンドオフ注記 M-12）** 返る `RepairCircuit` は新しいオブジェクトだが `session` は元の回路と同じ可変オブジェクトを共有する。古い `circuit` 参照を残さず、以後は常に戻り値の方を使うこと |
| `addedWireIds(circuit, session)` / `modificationWireIds(circuit, session)` | 右パネルの「追加した白線」「改造（外した青線）」の一覧 |
| `FaultReport` / `FaultReportKind` / `matchesSite()` / `scoreReports()` | 指摘一覧の登録と、途中経過の表示 |
| `judgeInspectRepair(problem, board, circuit, reports, options)` → `JudgeInspectRepairOutcome` | 判定。`ok: false` は課題データの誤り（§13 #2） |
| `JudgeInspectRepairResult` / `InspectReportScore` / `JudgeInspectResult` | 結果画面の型（`mode` で C1/C2 を判別できる） |
| `buildHighlightIndex(cells, session)` / `highlightFor()` / `cellIdsAtTerminal()` / `cellIdsOfWire()` | 回路図 ⇄ 3D盤の連動ハイライト。回路図側は `@ojt/schematic-core` の `Shape.cellId` / `rungId` を鍵にする。**（ハンドオフ注記 M-11）** 索引は静的なスナップショットなので、配線を変える（追加・削除・改造）たびに `buildHighlightIndex()` を呼び直すこと。**故障の適用（`applyFaults()` ＝ `buildInspectRepairCircuit()` の内部）も配線の変更である**（`session.wires` が配列ごと新しいオブジェクトに差し替わり、断線・未配線・誤配線が反映される）ので、索引は必ず初期盤が出来上がったあとの `circuit.session` から作ること。回路図の電線区間（rung間の縦線など）には盤側の電線IDへの順方向の対応が無いため、ハイライトは逆方向（端子・部品→回路図セル）でしか引けない |
| `REPAIR_WIRE_COLOR` / `INITIAL_WIRE_COLOR` | 線色パレットの表示 |
| （ハンドオフ注記 I-4）作業ファイルに何を残すか | 開始時に渡した／生成した **`seed`** と、`resolveFaults()` の解決結果（`resolvedFaults`）の両方を残すこと（**`seed` を指定しない課題は内部で `Date.now()` を使うため、`seed` だけ保存して再解決すると初回と別の故障になる。`resolvedFaults` を直接保存するのが確実**）／`initialWireIds`／`session.wires`（配線の現状）／交換済みの部品ID／`reports`（指摘の登録内容）。resume時は `buildInspectRepairCircuit(problem, board, { resolvedFaults })` に保存しておいた `faults` 配列を直接渡して `resolveFaults()` の再実行を避ける（Task 10 で `options.resolvedFaults` を追加） |

**`@ojt/content`（共通）:**

| API | 用途 |
|---|---|
| `SupportedProblem` / `isAssembleProblem()` | IPC・ストアの型付けとモード分岐 |
| `BUILTIN_ALL_PROBLEMS` | `BUILTIN_PROBLEMS`（モードBのみ）から差し替える |
| `countHazards(hazards)` / `HazardCounts` | 結果画面の危険操作回数（`ohm-on-live` / `range-exceeded` を含む全種別） |
| `findForbiddenPatterns(netlist)` | （任意）セッション中の警告表示 |
| `resolveFaults(problem, board, options)` → `ResolveFaultsResult`（`options: { seed?: number; maxAttempts?: number; maxMillis?: number }`） | ランダム故障課題を開始するときに `seed` を渡して確定させる。`maxAttempts` は引き直しの上限（既定 `MAX_RANDOM_FAULT_ATTEMPTS`。0にすると即フォールバック）、`maxMillis` は引き直しに使ってよい時間の上限（既定 `MAX_RANDOM_FAULT_MILLIS` = 5000ms。0にすると即フォールバック）。**1回の試行は課題の `durationMs` ぶんの再生を含むので重い**（実測: `durationMs: 8000` の課題で1試行あたり約363ms・100回で約36秒、`durationMs: 2000` の内蔵C2 `c2-001` で1試行あたり約44ms・100回で約4.4秒。うち模範回路の再構築は0.18msで、残りはシミュレーション）。UIスレッドで呼ばず、既定の `maxMillis` を当てにして課題開始が止まって見えないようにすること。成功結果の **`fellBack`** は「引き直しに失敗して `random.fallback` を使った」ことを表す（明示リスト課題と引き直し成功は `false`）。`fallback` 自体が盤に適用できない／§7.5 の2条件を満たさないときは `ok: false`（`faults.random.fallback`）になる |

**Plan 2B が自分で作るもの（2A では作らない）:** Worker プロトコルの新コマンド（`measure` / `injectFault` / `tester` など）、テスターパネル・マークシートパネル・指摘パネルのReactコンポーネント、3D上の部品／電線／端子のクリック → 指摘への変換（`resolvePick` の拡張）、C1/C2の結果画面、モード別の課題一覧、警告バナー。

---

## 完了条件

- [ ] `pnpm --filter @ojt/circuit-sim exec vitest run` が全て通る（`test/tester.test.ts` 14件・`test/tester-analog.test.ts` 15件を含む）。
- [ ] `pnpm --filter @ojt/content exec vitest run` が全て通る（Phase 2A で追加した14テストファイル・221件（@ojt/content 全体では32ファイル・442件）を含む）。
- [ ] `pnpm --filter @ojt/circuit-sim exec vitest run --coverage` と `pnpm --filter @ojt/content exec vitest run --coverage` が閾値90%（lines / statements / functions / branches）を満たす。
- [ ] `pnpm -r typecheck` と `pnpm lint`（`import-x/no-cycle` 込み）が無警告で通る。
- [ ] `npx prettier --check "packages/circuit-sim/**/*.ts" "packages/content/**/*.{ts,json}"` が `All matched files use Prettier code style!` を出す。
- [ ] `pnpm -r test` で5プロジェクト（`circuit-sim` / `board-model` / `schematic-core` / `content` / `desktop`）がすべて通る。
- [ ] `pnpm --filter @ojt/content schema:write` を流しても `schema/task.schema.json` に差分が出ない（`oneOf` が4分岐になっている）。
- [ ] 内蔵C1課題4セットの全部品が、チェック用ソケットで §9.1 の判定表どおりの読値になる（コイル断線＝吸引せず `OL`、レアショート＝正常に吸引して `422.5`、正常＝`650.0`）。
- [ ] 内蔵C2課題8題が、①故障を片方だけ入れても模範と波形が食い違い ②正しく指摘して修復すると合格し ③修復しないと不合格になり ④指摘を1件落とすと不合格になる。
- [ ] `packages/circuit-sim` と `packages/content` は `react` / `electron` / `three` に依存していない（`package.json` の `dependencies` が Phase 1 から増えていない）。
- [ ] 禁則回路の構造照合が、内蔵モードB課題8題・内蔵C2課題8題（故障入り）のいずれでも検出0であり、タイマ自己遮断とタイマ2個フリッカでだけ発火する。

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-14 | 初版。Plan 2（Phase 2）をライブラリ（2A）と `apps/desktop`（2B）に分割し、本書は 2A を扱う。テスターモデルの置き場所を `@ojt/circuit-sim/src/tester.ts` に決定（新パッケージ `@ojt/tester-model` は作らない）。C1の期待読値7通り・レアショート 422.5Ω・正常 650.0Ω・しきい値 552.5Ω、内蔵C2課題8題の故障と修復手順、禁則回路の構造照合の判定条件は、いずれも実装前に `@ojt/circuit-sim` ＋ `@ojt/board-model` を実際に走らせて確認した値である |
| 2026-09-14 | レビュー反映: B-1〜B-6、I-1〜I-5、M-1〜M-16（内容は本書の該当箇所を参照）。加えて Plan 2B 側レビュー由来の3件を反映: ① `readTester()` のΩ／導通測定に `Simulation` 単位のキャッシュを追加し、tick・プローブ・レンジ種別が同じ間はフルの回路解析をやり直さないようにした（Task 2）。② `ResolveFaultsOptions.maxAttempts` と `buildInspectRepairCircuit` の `resolvedFaults` オプションを2Bへの引き渡し表に明記し、作業ファイルには `seed` だけでなく解決済みの故障配列そのものを保存するよう指示した（Task 7・Task 10・2Bへの引き渡し）。③ アナログ針を目標角との差が0.05度未満で目標角へスナップするようにし、指数移動平均が理論上収束しきらず描画が再レンダーし続ける問題を解消した（Task 2） |
| 2026-09-14 | Phase 1 受入確認の指摘を反映: モードBの判定（`judge.ts`）が `sessionHazards` と判定の再生で出た危険操作を足していたため、短絡したまま提出された盤では同じ1回の短絡が `short-circuit-power-on` として2件に数えられていた。結果画面に出す回数（`hazardCount` / `hazardsByKind`）はセッションの記録だけを数えるようにし（§5.6「セッションのカウンタを加算する」/ §8.3）、静的チェック（`powerSequence`）には従来どおり再生ぶんも渡して合否の根拠は変えない。同じ規則を Task 12 の `judgeInspectParts()` / `judgeInspectRepair()` にも適用し、回帰テストを `test/judge.test.ts` と `test/judge-inspect.test.ts` に1件ずつ追加した |
| 2026-09-17 | C+D1 レビュー反映（`forbidden.ts` の負荷要素、誤配線先の検証、フォールバック検証、引き直し時間の上限）: ① 禁則回路の構造照合が負荷要素をリンクとしてだけ辿るようにし、モードB `b-005` の回帰テストと全464通りの盤の掃引を足した（715f915）。② `applyFaults()` の誤配線の付け替え先を `@ojt/board-model` の `checkWirableTerminal()` / `toSessionTerminal()` で `addWire()` と同じ規則で検証し、自己ループを拒否するようにした（8635cab）。③ `resolveFaults()` は模範セッションを1度だけ作って電線だけ複製して試行に使い、`random.fallback` は返す直前に検証して使えなければ `faults.random.fallback` の課題エラーにし、成功結果に `fellBack` を、オプションに `maxMillis`（既定5000ms）を足した（0257032）。④ 同じ電線への二重の故障指定を拒否し（M3）、空き端子の走査を `SOCKET_PIN_COUNT` に置き換え（M4）、`count` が装着部品数を超えると部品系を引ききれないことを注記した（M6・0b4c14a） |
| 2026-09-17 | Task 17 完了: バレル公開 b12caed、スモーク/持ち越しテスト 4689d7c、全体検証合格（pnpm -r test 102 ファイル/1331 テスト、typecheck、lint、prettier、content coverage 98.5/96.35/100/99.75、schema:write 差分なし、desktop build）。circuit-sim coverage は今回未計測（2bb24d3 時点 98.9%） |
| 2026-09-17 | 2A 後半レビュー反映（range-exceeded の reset 再アーム、溶着の優先規則、重複回答の扱い、RepairCircuitOptions 公開、弁別テスト拡充）: ① `range-exceeded` の重複発行記録を `meter-state.ts` へ移し、`Simulation.reset()` が `clearRangeExceeded()` で消すようにした（`prior.tMs > sim.tMs` の巻き戻りヒューリスティックは削除。リセット後に同じ時刻まで走らせても危険操作の警告が再武装する）。② `DiagnosisRow` に `note` を足して §9.1 なお書き（a接点溶着によるb接点の導通不良は「a接点の溶着」と答える）とレアショートの補足をヘルプ表に載せ、優先規則を適用して読値から原因を1つに決める `diagnoseCheckReading()` を追加・公開した（内蔵C1課題の全部品で `truth` と一致することをテスト）。③ `judgeInspectParts()` は同じ部品に複数の回答があれば最後の回答を採用する、と明記してテストで固定した。④ `RepairCircuitOptions` をバレルから公開。⑤ C2 の (課題, 故障箇所) 16通りで「その1箇所だけ未修復なら不合格」を確かめる表テストと、`wire-missing` を反対側端子で指摘した場合・シード無し乱数故障の同一盤ケースを追加。完了条件のテスト件数を実測値（14ファイル・221件／@ojt/content 全体 32ファイル・442件）に更新した |
