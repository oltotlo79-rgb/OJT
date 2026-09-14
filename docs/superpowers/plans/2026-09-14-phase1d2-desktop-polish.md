# Plan 1D2: デスクトップアプリ仕上げ（apps/desktop）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1D1 で動くようになった `apps/desktop` に、設計仕様 §7.8（利用者課題フォルダ）／§8.4（回路図ヒント）／§12.1（設定画面）／§12.3（作業ファイルと一時保存・復帰）／§13 #1・#4・#9（エラー処理）／§15（WebAudio の効果音・配布パッケージ）を足し、Phase 1 の受入基準を満たす配布可能な状態にする。

**Architecture:** 1D1 で決めた層分けをそのまま保つ。Node の `fs` に触る処理（利用者課題フォルダの合流・作業ファイル・一時保存・設定）はすべて main に置き、renderer からは §4.3 の6チャネルだけで呼ぶ。効果音は「スナップショットの差分 → 鳴らす音」を純粋関数 `soundsForSnapshot()` に切り出して単体テストし、`AudioContext` を触るのは `SoundPlayer` だけにする。回路図は `@ojt/schematic-core` の `layout()`（純粋関数）が返す図形プリミティブを SVG に落とすだけで、座標計算はこの層に持たない（§11.2）。

**Tech Stack:** Plan 1D1 と同一。これに electron-builder 26 を足す（NSIS インストーラ ＋ ポータブル zip、`asar`、`extraResources` に課題JSON）。

---

## 前提

Plan 1D1 が完了していること。この計画は 1D1 が作った次のファイルを**置き換える**。

| ファイル | 1D1 の状態 | 1D2 で足すこと |
|---|---|---|
| `src/main/content-loader.ts` | 内蔵課題のみ | 利用者フォルダの合流（`loadProblemsFromDir` ＋ `mergeProblemSets`）と読込エラー |
| `src/renderer/screens/ProblemList.tsx` | 一覧だけ | 出所タグ・読込エラーの理由表示・フォルダ無しの警告 |
| `src/renderer/app/routes.tsx` | `settings` はホームに落とす | `Settings` 画面へつなぐ |
| `src/renderer/screens/Home.tsx` | モード選択のみ | 設定画面への導線 |
| `src/renderer/app/App.tsx` | 例外バナーとトースト | 起動時の設定読込と一時保存からの復帰プロンプト |
| `src/renderer/panels/Toolbar.tsx` | 線色・モード・履歴・視点・判定 | 作業の保存／読込・回路図ヒントの開閉 |
| `src/renderer/screens/Session.tsx` | 配線・装着・通電・判定 | 30秒ごとの一時保存・効果音・回路図ヒント・保存／読込 |

---

## ファイル構成（この計画で新しく作るもの）

| ファイル | 単一責務 |
|---|---|
| `src/renderer/audio/sounds.ts` | WebAudio の合成音（リレー動作音・警告音・ブザー）と「差分 → 鳴らす音」の純粋関数 |
| `src/renderer/schematic/SchematicSvg.tsx` | `layout()` の図形プリミティブを SVG にする読取専用レンダラ |
| `src/renderer/session/work-file.ts` | 作業ファイルの組み立てと復元（手動読込と起動時復帰で共用） |
| `src/renderer/screens/Settings.tsx` | 設定画面（利用者課題フォルダ・音・復元確認・商標注記） |
| `electron-builder.yml` | 配布パッケージ（NSIS ＋ ポータブル zip） |
| `resources/content/assemble/*.json` | `extraResources` として同梱する課題JSON |
| `test/polish.test.ts` | 作業ファイル・効果音・回路図・注記の単体テスト |
| `e2e/polish.spec.ts` | 設定画面・回路図ヒント・視点と端子番号の E2E |

---

## Task 1: 利用者課題フォルダの合流と読込エラー表示

**Files:**
- Modify: `apps/desktop/src/main/content-loader.ts`, `apps/desktop/src/renderer/screens/ProblemList.tsx`
- Modify: `apps/desktop/test/content-loader.test.ts`

仕様 §7.8「同一IDが両方にある場合は利用者側を優先」、§13 #1「読込エラーは課題一覧に理由付きで表示し、他の課題の読込は継続する」、§13 #9「利用者課題フォルダが存在しなければ警告を出して内蔵課題のみで動作する」。


- [ ] **Step 1: `apps/desktop/test/content-loader.test.ts` を書く**

先にテストを書く。1D1 の内蔵課題だけのテストを置き換える。

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { afterEach, describe, expect, it } from 'vitest';
import { builtinSet, loadContent } from '../src/main/content-loader.js';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ojt-content-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('builtinSet', () => {
  it('内蔵課題8題を返す（§7.9）', () => {
    expect(builtinSet().problems).toHaveLength(BUILTIN_PROBLEMS.length);
    expect(builtinSet().errors).toHaveLength(0);
  });
});

describe('loadContent', () => {
  it('利用者フォルダが無ければ内蔵課題だけで動く（§13 #9）', () => {
    const payload = loadContent(join(tmpdir(), 'ojt-does-not-exist')).payload;
    expect(payload.userDirExists).toBe(false);
    expect(payload.problems).toHaveLength(BUILTIN_PROBLEMS.length);
    expect(payload.problems.every((p) => p.source === 'builtin')).toBe(true);
  });

  it('利用者フォルダの課題を合流し、同一IDは利用者側を優先する（§7.8）', () => {
    const dir = tempDir();
    const builtin = BUILTIN_PROBLEMS[0];
    expect(builtin).toBeDefined();
    if (builtin === undefined) return;
    writeFileSync(
      join(dir, 'override.json'),
      JSON.stringify({ ...builtin, title: '利用者版の自己保持回路' }),
      'utf8',
    );
    const { payload, byId } = loadContent(dir);
    expect(payload.userDirExists).toBe(true);
    const row = payload.problems.find((p) => p.id === builtin.id);
    expect(row?.title).toBe('利用者版の自己保持回路');
    expect(row?.source).toBe('user');
    expect(byId.get(builtin.id)?.title).toBe('利用者版の自己保持回路');
  });

  it('壊れた課題は理由付きで一覧に出し、他の課題は読み込む（§13 #1）', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'broken.json'), '{ this is not json', 'utf8');
    const payload = loadContent(dir).payload;
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]?.reason).toBe('invalid-json');
    expect(payload.problems).toHaveLength(BUILTIN_PROBLEMS.length);
  });

  it('スキーマ違反はzodのパス付きで理由を出す（§13 #1）', () => {
    const dir = tempDir();
    const builtin = BUILTIN_PROBLEMS[0];
    if (builtin === undefined) return;
    writeFileSync(
      join(dir, 'bad-grade.json'),
      JSON.stringify({ ...builtin, id: 'u-001', grade: 9 }),
      'utf8',
    );
    const payload = loadContent(dir).payload;
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]?.details.join(' ')).toContain('grade');
  });
});
```

- [ ] **Step 2: テストが落ちることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop test -- content-loader
```

期待出力:

```text
AssertionError: expected false to be true // Object.is equality
（`userDirExists` が常に false のため）
```

- [ ] **Step 3: `apps/desktop/src/main/content-loader.ts` を書く**

```ts
import { existsSync } from 'node:fs';
import {
  BUILTIN_PROBLEMS,
  loadProblemsFromDir,
  mergeProblemSets,
  type AssembleProblem,
  type ProblemSet,
} from '@ojt/content';
import { toErrorRow, toSummary, type ProblemListPayload } from '../shared/ipc.js';

/**
 * 課題の供給。設計仕様 §7.8 / §13 #1 / §13 #9。
 * Node の `fs` を使う `loadProblemsFromDir()` は main プロセスでしか動かないため、ここに置く。
 * 内蔵課題と利用者フォルダを `mergeProblemSets()` で合流し、同一IDは利用者側を優先する。
 */

/** 合流済みの課題（IDで引けるようにした一覧）。 */
export interface LoadedContent {
  payload: ProblemListPayload;
  byId: Map<string, AssembleProblem>;
}

/** 内蔵課題を `ProblemSet` の形にする（読込エラーは無い）。 */
export function builtinSet(): ProblemSet {
  return { problems: [...BUILTIN_PROBLEMS], errors: [] };
}

/**
 * 内蔵課題と利用者フォルダを合流する。§7.8
 * フォルダが無いときは読込を試みず、`userDirExists: false` だけを返す（§13 #9）。
 */
export function loadContent(userDir: string): LoadedContent {
  const builtin = builtinSet();
  const builtinIds = new Set(builtin.problems.map((p) => p.id));
  const exists = userDir.length > 0 && existsSync(userDir);
  const user: ProblemSet = exists ? loadProblemsFromDir(userDir) : { problems: [], errors: [] };
  const merged = mergeProblemSets(builtin, user);
  const userIds = new Set(user.problems.map((p) => p.id));
  const byId = new Map(merged.problems.map((p) => [p.id, p] as const));
  return {
    payload: {
      problems: merged.problems.map((p) =>
        toSummary(p, userIds.has(p.id) || !builtinIds.has(p.id) ? 'user' : 'builtin'),
      ),
      errors: merged.errors.map(toErrorRow),
      userDir,
      userDirExists: exists,
    },
    byId,
  };
}
```

- [ ] **Step 4: テストが通ることを確かめる**

実行:

```powershell
pnpm --filter @ojt/desktop test -- content-loader
```

期待出力:

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 5: `apps/desktop/src/renderer/screens/ProblemList.tsx` を書く**

```tsx
import { useEffect, type JSX } from 'react';
import { gradeLabel, JA } from '../i18n/ja.js';
import { useStore } from '../app/store.js';
import styles from './screens.module.css';

/**
 * 課題一覧。設計仕様 §12.1 / §13 #1 / §13 #9。
 * main の `content:list` が返した一覧をそのまま並べ、読込エラーは理由付きで別枠に出す。
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
              <th>出所</th>
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
                  <span className={styles.tag}>
                    {problem.source === 'builtin' ? JA.problemList.builtin : JA.problemList.user}
                  </span>
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

      {problems !== undefined && !problems.userDirExists ? (
        <p className={styles.subtitle} data-testid="user-dir-missing">
          {JA.problemList.userDirMissing}（{problems.userDir}）
        </p>
      ) : null}

      {problems !== undefined && problems.errors.length > 0 ? (
        <div className={styles.errorBox} data-testid="problem-errors">
          <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>{JA.problemList.errorsTitle}</h2>
          <ul>
            {problems.errors.map((error) => (
              <li key={error.file}>
                <strong>{error.file}</strong>: {error.message}
                {error.details.length === 0 ? null : (
                  <ul>
                    {error.details.map((detail, index) => (
                      <li key={index}>{detail}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: コミットする**

追加・変更したファイル: `apps/desktop/src/main/content-loader.ts` `apps/desktop/src/renderer/screens/ProblemList.tsx` `apps/desktop/test/content-loader.test.ts`

```powershell
git add apps/desktop/src/main/content-loader.ts apps/desktop/src/renderer/screens/ProblemList.tsx apps/desktop/test/content-loader.test.ts
git commit -m @'
feat(desktop): merge user content folder and show load errors

同一IDは利用者側を優先し、壊れた課題は理由付きで一覧に出して他の課題は読み込む。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 2: 効果音（WebAudio 合成）

**Files:**
- Create: `apps/desktop/src/renderer/audio/sounds.ts`

仕様 §15「WebAudio の合成音のみ（リレー動作音、テスターの導通ブザー、警告音）。音声ファイルを同梱しない」。

**設計**: 「いつ何の音を鳴らすか」は `soundsForSnapshot(previous, next)` という純粋関数に切り出し、`AudioContext` を触るのは `SoundPlayer` だけにする。こうすると鳴らす条件（リレーの接点が動いた／危険操作が出た／ブザーが点いた）を Vitest で検証できる。


- [ ] **Step 1: `apps/desktop/src/renderer/audio/sounds.ts` を書く**

```ts
/**
 * 効果音。設計仕様 §15「WebAudio の合成音のみ（リレー動作音、テスターの導通ブザー、警告音）。
 * 音声ファイルを同梱しない」。
 *
 * 3種とも `OscillatorNode` をその場で作って鳴らし、鳴り終わったら捨てる（プールしない）。
 * 1回の発音は 35〜400ms と短く、同時発音も数個なので GC の負担にならない。
 */

/** 鳴らせる音の種別。§15 */
export type SoundKind =
  /** リレー／タイマの動作音（カチッ）。§8.2 */
  | 'relay'
  /** 危険操作・エラーの警告音（ピピッ）。§5.6 */
  | 'warning'
  /** ブザー（BZ 通電中／テスターの導通）。§5.3.4 / §5.5 */
  | 'buzzer';

/** 音の合成パラメータ（値はこのテーブル1箇所で調整する）。 */
export interface SoundSpec {
  /** 基本周波数[Hz]。 */
  hz: number;
  /** 長さ[ms]。 */
  durationMs: number;
  /** 波形。 */
  wave: OscillatorType;
  /** 全体音量に掛ける係数。 */
  gain: number;
  /** 2音目の周波数[Hz]（警告音の下降音）。0なら鳴らさない。 */
  secondHz: number;
}

/** 種別ごとの合成パラメータ。 */
export const SOUND_SPECS: Readonly<Record<SoundKind, SoundSpec>> = {
  // リレーの吸引音は短い打撃音。矩形波の極短音で代用する。
  relay: { hz: 1800, durationMs: 35, wave: 'square', gain: 0.35, secondHz: 0 },
  // 警告音は 880Hz → 660Hz の2音。
  warning: { hz: 880, durationMs: 140, wave: 'triangle', gain: 0.8, secondHz: 660 },
  // ブザーは 440Hz の矩形波を長めに。
  buzzer: { hz: 440, durationMs: 400, wave: 'square', gain: 0.6, secondHz: 0 },
};

/** 実際に掛ける音量（設定の音量 × 種別の係数。0〜1に収める）。 */
export function effectiveGain(spec: SoundSpec, volume: number): number {
  return Math.min(1, Math.max(0, volume)) * spec.gain;
}

/** 効果音プレイヤ。`AudioContext` は初回の再生時に1つだけ作る。 */
export class SoundPlayer {
  private context: AudioContext | undefined;
  private enabled = true;
  private volume = 0.5;

  /** 設定画面の値を反映する。§12.1 */
  configure(options: { enabled: boolean; volume: number }): void {
    this.enabled = options.enabled;
    this.volume = options.volume;
  }

  /** 鳴らす。無効化中・AudioContext が作れない環境では何もしない。 */
  play(kind: SoundKind): void {
    if (!this.enabled) return;
    const spec = SOUND_SPECS[kind];
    const gain = effectiveGain(spec, this.volume);
    if (gain <= 0) return;
    const context = this.ensureContext();
    if (context === undefined) return;
    const now = context.currentTime;
    const seconds = spec.durationMs / 1000;

    const amp = context.createGain();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    amp.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = spec.wave;
    oscillator.frequency.setValueAtTime(spec.hz, now);
    if (spec.secondHz > 0) {
      oscillator.frequency.setValueAtTime(spec.secondHz, now + seconds / 2);
    }
    oscillator.connect(amp);
    oscillator.start(now);
    oscillator.stop(now + seconds);
    oscillator.onended = () => {
      oscillator.disconnect();
      amp.disconnect();
    };
  }

  /** 使い終わったら閉じる。 */
  close(): void {
    void this.context?.close();
    this.context = undefined;
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context !== undefined) return this.context;
    try {
      this.context = new AudioContext();
    } catch {
      // 音が出せない環境でも練習は続けられる
      this.context = undefined;
    }
    return this.context;
  }
}

/** アプリで1つだけ使うプレイヤ。 */
export const sounds = new SoundPlayer();

/** `soundsForSnapshot()` が見るスナップショットの部分型。 */
export interface SoundSnapshot {
  relays: Readonly<Record<string, { contactsOn: boolean }>>;
  timers: Readonly<Record<string, { timedOut: boolean }>>;
  lamps: Readonly<Record<string, { level: string }>>;
  hazardDelta: readonly unknown[];
}

/**
 * スナップショットの差分から鳴らす音を決める純粋関数。§8.2「動作音（WebAudio合成）」。
 * - リレー／タイマの接点が動いた tick → `relay`
 * - 危険操作が発行された → `warning`
 * - ブザー（BZ）が点灯した → `buzzer`
 */
export function soundsForSnapshot(
  previous: SoundSnapshot | undefined,
  next: SoundSnapshot,
): SoundKind[] {
  const out: SoundKind[] = [];
  if (previous !== undefined) {
    const relayMoved = Object.entries(next.relays).some(
      ([id, relay]) => previous.relays[id]?.contactsOn !== relay.contactsOn,
    );
    const timerMoved = Object.entries(next.timers).some(
      ([id, timer]) => previous.timers[id]?.timedOut !== timer.timedOut,
    );
    if (relayMoved || timerMoved) out.push('relay');
    if (previous.lamps['BZ']?.level !== 'lit' && next.lamps['BZ']?.level === 'lit') {
      out.push('buzzer');
    }
  }
  if (next.hazardDelta.length > 0) out.push('warning');
  return out;
}
```

- [ ] **Step 2: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/audio/sounds.ts`

```powershell
git add apps/desktop/src/renderer/audio/sounds.ts
git commit -m @'
feat(desktop): synthesize relay, warning and buzzer sounds with webaudio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 3: 作業ファイルと起動時の復帰

**Files:**
- Create: `apps/desktop/src/renderer/session/work-file.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/main/work-files.ts`, `apps/desktop/src/renderer/app/store.ts`

仕様 §12.3「作業ファイルは JSON で `formatVersion` 付き。一時保存は 30 秒ごと。起動時に一時保存が残っていれば復元を確認し、復元しない選択をしたら一時保存を削除する」、§13 #8「未知のバージョンは読み込まない」。

**チャネルを増やさない工夫**: 仕様 §4.3 は IPC を6チャネルに限る。一時保存の削除は `workfile:load` に `discard: true` を載せて表す（読まずに消す）。7本目のチャネルを作らないための設計で、`WorkFileLoadRequest` のコメントに理由を書く。


- [ ] **Step 1: `src/shared/ipc.ts` の `WorkFileLoadRequest` に `discard` を足す**

```ts
/**
 * 読込要求。
 * `discard: true` は読まずに一時保存を削除する（§12.3「復元しない選択をした場合は
 * 一時保存を削除する」）。§4.3 の6チャネルを増やさないため、削除もこのチャネルで表す。
 */
export interface WorkFileLoadRequest {
  kind: 'manual' | 'autosave';
  discard?: boolean;
}
```

- [ ] **Step 2: `src/main/work-files.ts` の `loadWorkFile()` の先頭に削除の分岐を足す**

```ts
  if (request.discard === true) {
    clearAutosave();
    return { ok: false, canceled: true, message: '一時保存を削除しました' };
  }
```

- [ ] **Step 3: `apps/desktop/src/renderer/session/work-file.ts` を書く**

```ts
import type { BoardSession } from '@ojt/board-model';
import { WORK_FILE_FORMAT_VERSION, type WorkFile } from '../../shared/ipc.js';
import { useStore } from '../app/store.js';
import { cloneSession } from './commands.js';
import { bridge } from './worker-bridge.js';

/**
 * 作業ファイルの復元。設計仕様 §12.3 / §13 #8。
 * 手動読込（セッション画面）と起動時の一時保存からの復帰（ホーム）で共用する。
 */

/** 現在の状態を作業ファイルの形にする。§12.3 */
export function toWorkFile(
  problemId: string,
  session: BoardSession,
  elapsedMs: number,
  hazardCount: number,
): WorkFile {
  return {
    formatVersion: WORK_FILE_FORMAT_VERSION,
    problemId,
    session,
    elapsedMs,
    hazardCount,
    savedAt: new Date().toISOString(),
  };
}

/**
 * 作業ファイルの `session` を `BoardSession` として読む（形が違えば undefined）。§13 #8
 *
 * 名前が同じでも `@ojt/schematic-core` の `toSession(doc, board, options)`
 * （回路図 → 盤セッション。`{ ok, session, assignment } | { ok: false, errors }` を返す）とは別物。
 * このモジュールは保存した JSON を読み戻すだけで、割当も配線もしない。
 */
export function toSession(raw: unknown): BoardSession | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const source = raw as Partial<BoardSession>;
  if (!Array.isArray(source.wires) || typeof source.socketRoles !== 'object') return undefined;
  return source as BoardSession;
}

/**
 * 作業ファイルを画面に反映する。§12.3
 * 課題を読み直してからセッションを差し替え、Worker にも同じ盤を読ませる。
 */
export async function applyWorkFile(file: WorkFile): Promise<boolean> {
  const store = useStore.getState();
  const problem = await window.ojt.readProblem(file.problemId);
  if (problem === null) {
    store.toast(`作業ファイルの課題が見つかりません: ${file.problemId}`, 'error');
    return false;
  }
  const session = toSession(file.session);
  if (session === undefined) {
    store.toast('作業ファイルの盤の状態が読めません', 'error');
    return false;
  }
  store.openProblem(problem);
  store.setSession(cloneSession(session));
  bridge.send({ type: 'load', problemId: problem.id, session: cloneSession(session) });
  store.addLog(`作業ファイルを読み込みました（${file.savedAt}）`);
  return true;
}
```

- [ ] **Step 4: `src/renderer/app/store.ts` に WebGL 復旧用の状態を足す**

`AppState` に次を足し、初期値 `false`、`setWebglLost` を実装する（§13 #4。3Dシーン側は Plan 1D1 の `BoardScene` が既に呼んでいる）。

```ts
  /** WebGL コンテキストが失われ再初期化中か。§13 #4 */
  webglLost: boolean;
  setWebglLost: (lost: boolean) => void;
```

- [ ] **Step 5: コミットする**

追加・変更したファイル: `apps/desktop/src/shared/ipc.ts` `apps/desktop/src/main/work-files.ts` `apps/desktop/src/renderer/session/work-file.ts` `apps/desktop/src/renderer/app/store.ts`

```powershell
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/main/work-files.ts apps/desktop/src/renderer/session/work-file.ts apps/desktop/src/renderer/app/store.ts
git commit -m @'
feat(desktop): save, load and restore work files

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 4: 回路図ヒント（読取専用 SVG）

**Files:**
- Create: `apps/desktop/src/renderer/schematic/SchematicSvg.tsx`

仕様 §11.2「Phase 1 は読取専用レンダラ（SVG）。`layout()` は文書モデルから SVG 要素の座標配列を返す純粋関数とし、描画そのものは `apps/desktop` が行う」、§8.4「3級は常時表示、2級は開閉可、1級は非表示」。

実装済みの `@ojt/schematic-core` に合わせる点（Plan 1B Task 11〜16）:

- `Shape` は4種の直和（`line` / `circle` / `arc` / `text`）で、共通の項目は `kind` と `role`（`'bus' | 'wire' | 'symbol' | 'label' | 'junction'`）。`fill` を持つのは **`circle` だけ**（表示灯の色。`LAMP_FILL[device]`）、`startDeg` / `endDeg` を持つのは `arc` だけ、`text` / `anchor`（`'start' | 'middle' | 'end'`）を持つのは `text` だけ。座標は mm/px 非依存の論理単位で、`viewBox` にそのまま流し込む。
- `layout(doc, options?)` は `{ width, height, shapes }`（`SchematicLayout`）を返す。`DEFAULT_LAYOUT_OPTIONS` は `colWidth: 24` / `rowHeight: 24` / `marginX: 12` / `marginY: 16` / `symbolWidth: 12`（`rowHeight` は Plan 1B Task 13d で 16 → 24 になり、記号と次の段の銘板が重ならなくなった）。ただし**タイマコイルの銘板は `T1 (3.0秒)` のように長い**（`layout.ts` の `cellLabel()`。`presetMs` を持つコイルだけ）ので、`colWidth: 24` のままだと横方向で隣の銘板と重なる。ここでは `colWidth` を広げて渡す。
- `Shape` は Plan 1B Task 13d で `rungId?` / `cellId?`（どの段・どの要素から出た図形か。母線の線とラベルはどちらも持たない）を持つようになった。型は `Shape` に畳み込まれていて `ShapeSource` 単体は再エクスポートされていないので、必要なら `shape.cellId` をそのまま読む。Phase 1 の読取専用レンダラは配列の添字で `key` を振れば足りるのでそのままにし、Phase 2 で「盤の端子にホバーすると回路図の該当要素が光る」を作るときにこの2つを使う。


- [ ] **Step 1: `apps/desktop/src/renderer/schematic/SchematicSvg.tsx` を書く**

```tsx
import {
  layout,
  LAMP_FILL,
  type LayoutOptions,
  type SchematicDocument,
  type Shape,
  type ShapeRole,
} from '@ojt/schematic-core';
import { useMemo, type JSX } from 'react';

/**
 * 回路図（展開接続図）の読取専用レンダラ。設計仕様 §11.2。
 * 座標計算は `@ojt/schematic-core` の `layout()`（純粋関数）が行い、ここは SVG 化だけを担う。
 * ヒントの出し方は級で決まる（§8.4: 1級は非表示、2級は開閉可、3級は常時表示）。
 *
 * 図形は `Shape`（`line` / `circle` / `arc` / `text`）の直和で、`role` から線幅と色を引く。
 * `key` は配列の添字でよい（`layout()` は決定論なので同じ文書からは同じ並びが出る）。
 * `shape.rungId` / `shape.cellId`（Plan 1B Task 13d）は、Phase 2 で
 * 「盤の端子にホバーすると回路図の該当要素が光る」を作るときに使う。
 */

/** 役割ごとの線幅と色。 */
const STROKE: Readonly<Record<ShapeRole, { color: string; width: number }>> = {
  bus: { color: '#111418', width: 2.2 },
  wire: { color: '#111418', width: 1.2 },
  symbol: { color: '#111418', width: 1.4 },
  label: { color: '#111418', width: 0 },
  junction: { color: '#111418', width: 0 },
};

/** 銘板の文字の大きさ（論理単位）。 */
const LABEL_FONT_SIZE = 6;

/**
 * 寸法設定。`DEFAULT_LAYOUT_OPTIONS` の `colWidth: 24` だと、タイマコイルの銘板
 * （`layout()` が `T1 (3.0秒)` の形で作る）が隣の要素の銘板と重なる。
 * 文字は最大10字ぶん（全角混じりで約 6 × 5.5 ≒ 33）を見込んで1列を 40 にする。
 * 段の高さは `@ojt/schematic-core` の既定（24）に任せる。
 */
const LAYOUT: LayoutOptions = { colWidth: 40 };

/** 極座標の角度[度]を SVG の座標に直す（弧の端点計算）。 */
function arcPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** 図形プリミティブ1つを SVG 要素にする。 */
function renderShape(shape: Shape, index: number): JSX.Element | null {
  const style = STROKE[shape.role];
  switch (shape.kind) {
    case 'line':
      return (
        <line
          key={index}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={style.color}
          strokeWidth={style.width}
          strokeLinecap="round"
        />
      );
    case 'circle':
      return (
        <circle
          key={index}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          fill={shape.fill ?? (shape.role === 'junction' ? style.color : 'none')}
          stroke={style.color}
          strokeWidth={shape.role === 'junction' ? 0 : style.width}
        />
      );
    case 'arc': {
      const [x1, y1] = arcPoint(shape.cx, shape.cy, shape.r, shape.startDeg);
      const [x2, y2] = arcPoint(shape.cx, shape.cy, shape.r, shape.endDeg);
      const large = Math.abs(shape.endDeg - shape.startDeg) > 180 ? 1 : 0;
      return (
        <path
          key={index}
          d={`M ${x1} ${y1} A ${shape.r} ${shape.r} 0 ${large} 1 ${x2} ${y2}`}
          fill="none"
          stroke={style.color}
          strokeWidth={style.width}
        />
      );
    }
    case 'text':
      return (
        <text
          key={index}
          x={shape.x}
          y={shape.y}
          fill={style.color}
          fontSize={LABEL_FONT_SIZE}
          textAnchor={shape.anchor}
          dominantBaseline="middle"
        >
          {shape.text}
        </text>
      );
  }
}

/** 回路図の SVG。 */
export function SchematicSvg({ document: doc }: { document: SchematicDocument }): JSX.Element {
  const result = useMemo(() => layout(doc, LAYOUT), [doc]);
  return (
    <svg
      viewBox={`0 0 ${result.width} ${result.height}`}
      role="img"
      aria-label={doc.title}
      data-testid="schematic-svg"
      style={{ width: '100%', background: '#F7F7F4', borderRadius: 4 }}
    >
      {result.shapes.map((shape, index) => renderShape(shape, index))}
    </svg>
  );
}

/** 表示灯の塗り色（`schematic-core` と同じ値を使っていることの確認用）。§5.3.4 */
export const SCHEMATIC_LAMP_FILL = LAMP_FILL;
```

- [ ] **Step 2: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/schematic/SchematicSvg.tsx`

```powershell
git add apps/desktop/src/renderer/schematic/SchematicSvg.tsx
git commit -m @'
feat(desktop): render the reference schematic as svg

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 5: 設定画面

**Files:**
- Create: `apps/desktop/src/renderer/screens/Settings.tsx`
- Modify: `apps/desktop/src/renderer/screens/screens.module.css`, `apps/desktop/src/renderer/app/routes.tsx`, `apps/desktop/src/renderer/screens/Home.tsx`

仕様 §12.1 の設定画面のうち Phase 1 で扱うのは「利用者課題フォルダ」「音のON/OFFと音量」「起動時の復元確認」と、§15 の商標注記・§17.1 の前提注記を載せた「このアプリについて」。


- [ ] **Step 1: `src/renderer/screens/screens.module.css` の末尾に設定画面のスタイルを足す**

```css

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

- [ ] **Step 2: `apps/desktop/src/renderer/screens/Settings.tsx` を書く**

```tsx
import { useEffect, useState, type JSX } from 'react';
import type { AppSettings } from '../../shared/ipc.js';
import { useStore } from '../app/store.js';
import { sounds } from '../audio/sounds.js';
import { JA } from '../i18n/ja.js';
import styles from './screens.module.css';

/**
 * 設定画面。設計仕様 §12.1 / §15。
 * Phase 1 で扱うのは「利用者課題フォルダ」「音のON/OFFと音量」「起動時の復元確認」と、
 * 商標注記・前提注記を載せた「このアプリについて」だけ（ラダー関係は Phase 3 以降）。
 */

/** 商標注記。§15 */
export const TRADEMARK_NOTICE =
  'MELSEC / MELSEC iQ-F / MELSOFT / GX Works3 は三菱電機株式会社、SYSMAC / CP1E / CP1L / ' +
  'CX-Programmer / CX-One はオムロン株式会社、TOYOPUC / PCwin は株式会社ジェイテクト、' +
  'JW / JW300 / JW-300SP はシャープ株式会社の商標または登録商標です。' +
  '各社の製品名は識別を目的としてのみ使用しており、提携・後援関係を示すものではありません。';

/** 未確認事項の注記。§17.1 */
export const ASSUMPTION_NOTICE =
  '一部の命令名・キー割当は実機マニュアル未確認のため本アプリの表記です。';

/** 設定画面。 */
export function Settings(): JSX.Element {
  const setRoute = useStore((s) => s.setRoute);
  const toast = useStore((s) => s.toast);
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);

  useEffect(() => {
    void window.ojt.getSettings().then(setSettings);
  }, []);

  const patch = (next: Partial<AppSettings>): void => {
    void window.ojt.setSettings(next).then((saved) => {
      setSettings(saved);
      sounds.configure({ enabled: saved.soundEnabled, volume: saved.soundVolume });
      toast('設定を保存しました');
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
        {JA.home.settings}
      </h1>
      {settings === undefined ? (
        <p className={styles.subtitle}>読み込み中…</p>
      ) : (
        <div style={{ maxWidth: 760 }}>
          <section className={styles.settingRow}>
            <label htmlFor="user-dir">利用者課題フォルダ</label>
            <input
              id="user-dir"
              type="text"
              value={settings.userContentDir}
              data-testid="setting-user-dir"
              onChange={(event) => {
                setSettings({ ...settings, userContentDir: event.target.value });
              }}
              onBlur={(event) => {
                patch({ userContentDir: event.target.value });
              }}
            />
          </section>

          <section className={styles.settingRow}>
            <label htmlFor="sound-enabled">効果音</label>
            <input
              id="sound-enabled"
              type="checkbox"
              checked={settings.soundEnabled}
              data-testid="setting-sound-enabled"
              onChange={(event) => {
                patch({ soundEnabled: event.target.checked });
              }}
            />
          </section>

          <section className={styles.settingRow}>
            <label htmlFor="sound-volume">音量</label>
            <input
              id="sound-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.soundVolume}
              data-testid="setting-sound-volume"
              onChange={(event) => {
                patch({ soundVolume: Number(event.target.value) });
              }}
            />
            <span>{Math.round(settings.soundVolume * 100)}%</span>
          </section>

          <section className={styles.settingRow}>
            <label htmlFor="restore-prompt">起動時に前回の作業の復元を確認する</label>
            <input
              id="restore-prompt"
              type="checkbox"
              checked={settings.restorePrompt}
              data-testid="setting-restore-prompt"
              onChange={(event) => {
                patch({ restorePrompt: event.target.checked });
              }}
            />
          </section>

          <section className={styles.about} data-testid="about">
            <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>このアプリについて</h2>
            <p>{TRADEMARK_NOTICE}</p>
            <p>{ASSUMPTION_NOTICE}</p>
          </section>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `apps/desktop/src/renderer/app/routes.tsx` を書く**

```tsx
import type { JSX } from 'react';
import { Home } from '../screens/Home.js';
import { ProblemList } from '../screens/ProblemList.js';
import { Result } from '../screens/Result.js';
import { Session } from '../screens/Session.js';
import { Settings } from '../screens/Settings.js';
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
      return <Settings />;
  }
}
```

- [ ] **Step 4: `apps/desktop/src/renderer/screens/Home.tsx` を書く**

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
      <p style={{ marginTop: 24 }}>
        <button
          type="button"
          data-testid="open-settings"
          onClick={() => {
            setRoute('settings');
          }}
        >
          {JA.home.settings}
        </button>
      </p>
    </div>
  );
}
```

- [ ] **Step 5: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/screens/Settings.tsx` `apps/desktop/src/renderer/screens/screens.module.css` `apps/desktop/src/renderer/app/routes.tsx` `apps/desktop/src/renderer/screens/Home.tsx`

```powershell
git add apps/desktop/src/renderer/screens/Settings.tsx apps/desktop/src/renderer/screens/screens.module.css apps/desktop/src/renderer/app/routes.tsx apps/desktop/src/renderer/screens/Home.tsx
git commit -m @'
feat(desktop): add settings screen with trademark notice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 6: セッション画面とツールバーの仕上げ

**Files:**
- Modify: `apps/desktop/src/renderer/i18n/ja.ts`, `apps/desktop/src/renderer/panels/Toolbar.tsx`, `apps/desktop/src/renderer/screens/Session.tsx`, `apps/desktop/src/renderer/app/App.tsx`

作業の保存／読込・回路図ヒントの開閉をツールバーに足し、セッション画面に 30 秒ごとの一時保存（§12.3）と効果音（§15）と回路図ヒント（§8.4）をつなぐ。アプリ外枠には起動時の復帰プロンプトを足す。


- [ ] **Step 1: `src/renderer/i18n/ja.ts` の `session` に文言を足す**

（Plan 1D1 で既に書いてあるならそのままでよい。無ければ `cancelWire` の下に足す。）

```ts
    /** 経路器が経路を作れなかった（`RoutingError`）。§6.6 */
    routeFailed: '配線の経路を作れませんでした',
    /** 同じ帯の同じスロットに載せざるを得なかった電線がある（`laneOverflow`）。§6.6 */
    laneOverflow: '他の電線と同じ配線位置に重なっています（見た目だけの重なりで、回路は正しく組めています）',
    save: '作業を保存',
    load: '作業を読込',
    restoreTitle: '前回の作業を復元しますか？',
    restoreYes: '復元する',
    restoreNo: '復元しない',
```

`JA` の直下に置く `routeReason`（`RoutingErrorReason` を網羅する表）も Plan 1D1 で書いてあるはず。無ければ `mismatchReason` の下に足す。

```ts
  /** 経路器の失敗理由（`RoutingError.reason`）。§6.6 */
  routeReason: {
    'invalid-terminal': '盤に無い端子です',
    unreachable: '配線帯までたどり着けません',
    'footprint-crossing': '部品の上を避けて通せません',
  } satisfies Record<RoutingErrorReason, string>,
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
  onSave,
  onLoad,
  onToggleSchematic,
  schematicVisible,
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
  onSave: () => void;
  onLoad: () => void;
  /** 回路図ヒントの開閉。1級課題では `undefined`（ボタン自体を出さない）。§8.4 */
  onToggleSchematic: (() => void) | undefined;
  schematicVisible: boolean;
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
      <div className={styles.toolGroup}>
        <button type="button" onClick={onSave}>
          {JA.session.save}
        </button>
        <button type="button" onClick={onLoad}>
          {JA.session.load}
        </button>
        {onToggleSchematic === undefined ? null : (
          <button type="button" aria-pressed={schematicVisible} onClick={onToggleSchematic}>
            {schematicVisible ? JA.session.hideSchematic : JA.session.showSchematic}
          </button>
        )}
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

- [ ] **Step 3: `apps/desktop/src/renderer/screens/Session.tsx` を書く**

```tsx
import { JIPM_BOARD, socketPartId } from '@ojt/board-model';
import type { BoardSession, MountableKind, SocketId } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { sounds, soundsForSnapshot } from '../audio/sounds.js';
import { SchematicSvg } from '../schematic/SchematicSvg.js';
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
import { applyWorkFile, toWorkFile } from '../session/work-file.js';
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

/** 一時保存の間隔[ms]。§12.3 */
const AUTOSAVE_INTERVAL_MS = 30_000;

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
  const schematicVisible = useStore((s) => s.schematicVisible);
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

  // 30秒ごとに一時保存する（§12.3）
  useEffect(() => {
    const id = setInterval(() => {
      const store = useStore.getState();
      const current = store.problem;
      const currentSession = store.session;
      if (current === undefined || currentSession === undefined) return;
      void window.ojt.saveWorkFile({
        kind: 'autosave',
        file: toWorkFile(current.id, currentSession, store.elapsedMs, store.hazards.length),
      });
    }, AUTOSAVE_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  // スナップショットの差分から効果音を鳴らす（§15: WebAudio の合成音のみ）
  const previousSnapshot = useRef<typeof snapshot | undefined>(undefined);
  useEffect(() => {
    for (const kind of soundsForSnapshot(previousSnapshot.current, snapshot)) sounds.play(kind);
    previousSnapshot.current = snapshot;
  }, [snapshot]);

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
            // `safeRoutes()`（Plan 1D1 Task 12）がそれを受け止めるので、ここでは結果を見るだけ。
            const board = next.session;
            if (board === undefined) return;
            const { routes, errors } = safeRoutes(JIPM_BOARD, board);
            const failed = errors.find((e) => e.wireId === wire.id);
            if (failed !== undefined) {
              next.toast(`${JA.session.routeFailed}（${JA.routeReason[failed.reason]}）`, 'error');
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
        onSave={() => {
          const store = useStore.getState();
          void window.ojt
            .saveWorkFile({
              kind: 'manual',
              file: toWorkFile(problem.id, session, store.elapsedMs, store.hazards.length),
            })
            .then((result) => {
              store.toast(
                result.ok ? `保存しました: ${result.path}` : result.message,
                result.ok ? 'info' : 'error',
              );
            });
        }}
        onLoad={() => {
          void window.ojt.loadWorkFile({ kind: 'manual' }).then((result) => {
            const store = useStore.getState();
            if (!result.ok) {
              if (!result.canceled) store.toast(result.message, 'error');
              return;
            }
            void applyWorkFile(result.file);
          });
        }}
        schematicVisible={schematicVisible}
        onToggleSchematic={
          problem.grade === 1
            ? undefined
            : () => {
                useStore.getState().toggleSchematic();
              }
        }
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
          {schematicVisible && problem.grade !== 1 ? (
            <section className={styles.panelLive} data-testid="schematic-hint">
              <h2 className={styles.liveTitle}>{JA.session.schematicHint}</h2>
              <SchematicSvg document={problem.schematic} />
            </section>
          ) : null}
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

- [ ] **Step 4: `apps/desktop/src/renderer/app/App.tsx` を書く**

```tsx
import { useEffect, useState, type JSX } from 'react';
import type { WorkFile } from '../../shared/ipc.js';
import { sounds } from '../audio/sounds.js';
import { JA } from '../i18n/ja.js';
import { applyWorkFile } from '../session/work-file.js';
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
  const [pendingRestore, setPendingRestore] = useState<WorkFile | undefined>(undefined);

  // 設定を読み、効果音に反映したうえで一時保存の有無を確かめる（§12.3 / §15）
  useEffect(() => {
    void window.ojt.getSettings().then(async (settings) => {
      sounds.configure({ enabled: settings.soundEnabled, volume: settings.soundVolume });
      if (!settings.restorePrompt) return;
      const restored = await window.ojt.loadWorkFile({ kind: 'autosave' });
      if (restored.ok) setPendingRestore(restored.file);
    });
  }, []);

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
      {pendingRestore === undefined ? null : (
        <div className={styles.banner} role="dialog" data-testid="restore-prompt">
          <span>
            {JA.session.restoreTitle}（{pendingRestore.savedAt}）
          </span>
          <button
            type="button"
            onClick={() => {
              const file = pendingRestore;
              setPendingRestore(undefined);
              void applyWorkFile(file);
            }}
          >
            {JA.session.restoreYes}
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingRestore(undefined);
              void window.ojt.loadWorkFile({ kind: 'autosave', discard: true });
            }}
          >
            {JA.session.restoreNo}
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

- [ ] **Step 5: 型チェックと lint を通す**

実行:

```powershell
pnpm --filter @ojt/desktop typecheck
pnpm lint
```

期待出力:

```text
（どちらも何も出力されない＝成功）
```

- [ ] **Step 6: コミットする**

追加・変更したファイル: `apps/desktop/src/renderer/i18n/ja.ts` `apps/desktop/src/renderer/panels/Toolbar.tsx` `apps/desktop/src/renderer/screens/Session.tsx` `apps/desktop/src/renderer/app/App.tsx`

```powershell
git add apps/desktop/src/renderer/i18n/ja.ts apps/desktop/src/renderer/panels/Toolbar.tsx apps/desktop/src/renderer/screens/Session.tsx apps/desktop/src/renderer/app/App.tsx
git commit -m @'
feat(desktop): add autosave, sounds, schematic hint and work file buttons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 7: 仕上げ部分の単体テスト

**Files:**
- Create: `apps/desktop/test/polish.test.ts`


- [ ] **Step 1: `apps/desktop/test/polish.test.ts` を書く**

`work-files.ts` は `electron` を import するが、`parseWorkFile()` 自体は Electron の API を使わないので Vitest から直接呼べる。

```ts
import { createSession, JIPM_BOARD, TASK1_SOCKET_ROLES } from '@ojt/board-model';
import { BUILTIN_PROBLEMS } from '@ojt/content';
import { DEFAULT_LAYOUT_OPTIONS, layout } from '@ojt/schematic-core';
import { describe, expect, it } from 'vitest';
import { effectiveGain, SOUND_SPECS, soundsForSnapshot } from '../src/renderer/audio/sounds.js';
import { parseWorkFile } from '../src/main/work-files.js';
import { toSession, toWorkFile } from '../src/renderer/session/work-file.js';
import { WORK_FILE_FORMAT_VERSION } from '../src/shared/ipc.js';
import { ASSUMPTION_NOTICE, TRADEMARK_NOTICE } from '../src/renderer/screens/Settings.js';

/**
 * Plan 1D2 で足した仕上げ部分の純粋ロジック（§12.3 / §13 #8 / §15 / §11.2）。
 * `work-files.ts` は `electron` を import するが、`parseWorkFile()` 自体は
 * Electron の API を使わないので Vitest から直接呼べる。
 */

describe('parseWorkFile（§13 #8）', () => {
  const valid = {
    formatVersion: WORK_FILE_FORMAT_VERSION,
    problemId: 'b-001',
    session: { wires: [], socketRoles: TASK1_SOCKET_ROLES },
    elapsedMs: 1000,
    hazardCount: 0,
    savedAt: '2026-09-14T00:00:00.000Z',
  };

  it('正しい作業ファイルを読める', () => {
    const parsed = parseWorkFile(valid);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file.problemId).toBe('b-001');
  });

  it('新しい形式バージョンは読み込まない', () => {
    const parsed = parseWorkFile({ ...valid, formatVersion: WORK_FILE_FORMAT_VERSION + 1 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('新しいバージョン');
  });

  it('形式バージョンが無いものは読み込まない', () => {
    const parsed = parseWorkFile({ problemId: 'b-001', session: {} });
    expect(parsed.ok).toBe(false);
  });

  it('課題IDが無いものは読み込まない', () => {
    const parsed = parseWorkFile({ formatVersion: 1, session: {} });
    expect(parsed.ok).toBe(false);
  });
});

describe('toWorkFile / toSession（§12.3）', () => {
  it('セッションを作業ファイルにして読み戻せる', () => {
    const session = createSession(JIPM_BOARD, { roles: TASK1_SOCKET_ROLES });
    const file = toWorkFile('b-001', session, 12_000, 2);
    expect(file.formatVersion).toBe(WORK_FILE_FORMAT_VERSION);
    expect(file.elapsedMs).toBe(12_000);
    expect(file.hazardCount).toBe(2);
    const round = toSession(JSON.parse(JSON.stringify(file.session)));
    expect(round?.wires).toHaveLength(session.wires.length);
  });

  it('盤の状態でないものは読めない', () => {
    expect(toSession(null)).toBeUndefined();
    expect(toSession({ wires: 'x' })).toBeUndefined();
  });
});

describe('効果音（§15）', () => {
  it('音量0なら鳴らさない', () => {
    expect(effectiveGain(SOUND_SPECS.relay, 0)).toBe(0);
  });

  it('音量は0〜1に収める', () => {
    expect(effectiveGain(SOUND_SPECS.buzzer, 5)).toBe(SOUND_SPECS.buzzer.gain);
    expect(effectiveGain(SOUND_SPECS.buzzer, -1)).toBe(0);
  });

  it('リレーが動いたら動作音、危険操作があれば警告音', () => {
    const base = { relays: {}, timers: {}, lamps: {}, hazardDelta: [] };
    expect(
      soundsForSnapshot(
        { ...base, relays: { CR1: { contactsOn: false } } },
        { ...base, relays: { CR1: { contactsOn: true } } },
      ),
    ).toEqual(['relay']);
    expect(soundsForSnapshot(base, { ...base, hazardDelta: [{}] })).toEqual(['warning']);
  });

  it('タイマがタイムアップしたら動作音', () => {
    const base = { relays: {}, timers: {}, lamps: {}, hazardDelta: [] };
    expect(
      soundsForSnapshot(
        { ...base, timers: { T1: { timedOut: false } } },
        { ...base, timers: { T1: { timedOut: true } } },
      ),
    ).toEqual(['relay']);
  });

  it('ブザーが点いたらブザー音', () => {
    const base = { relays: {}, timers: {}, lamps: {}, hazardDelta: [] };
    expect(
      soundsForSnapshot({ ...base, lamps: { BZ: { level: 'off' } } }, {
        ...base,
        lamps: { BZ: { level: 'lit' } },
      }),
    ).toEqual(['buzzer']);
  });

  it('最初のスナップショットでは動作音を鳴らさない', () => {
    expect(
      soundsForSnapshot(undefined, {
        relays: { CR1: { contactsOn: true } },
        timers: {},
        lamps: {},
        hazardDelta: [],
      }),
    ).toEqual([]);
  });
});

describe('回路図レンダラ（§11.2）', () => {
  it('内蔵課題の回路図から図形が返る', () => {
    const problem = BUILTIN_PROBLEMS.find((p) => p.id === 'b-001');
    expect(problem).toBeDefined();
    if (problem === undefined) return;
    const result = layout(problem.schematic);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.shapes.length).toBeGreaterThan(0);
    expect(result.shapes.some((s) => s.kind === 'text')).toBe(true);
    // 図形は4種の直和で、`fill` を持つのは circle だけ（表示灯の色）
    for (const shape of result.shapes) {
      expect(['line', 'circle', 'arc', 'text']).toContain(shape.kind);
    }
    // 銘板が重ならないよう SchematicSvg は列幅を広げて渡す（既定の 24 では `T1 (3.0秒)` が溢れる）
    expect(layout(problem.schematic, { colWidth: 40 }).width).toBeGreaterThan(result.width);
    expect(DEFAULT_LAYOUT_OPTIONS.colWidth).toBe(24);
  });
});

describe('設定画面の注記（§15 / §17.1）', () => {
  it('商標注記に4社の名前が載っている', () => {
    for (const name of ['三菱電機', 'オムロン', 'ジェイテクト', 'シャープ']) {
      expect(TRADEMARK_NOTICE).toContain(name);
    }
    expect(TRADEMARK_NOTICE).toContain('提携・後援関係を示すものではありません');
  });

  it('未確認事項の注記がある', () => {
    expect(ASSUMPTION_NOTICE).toContain('本アプリの表記');
  });
});
```

- [ ] **Step 2: 単体テストをすべて実行する**

実行:

```powershell
pnpm --filter @ojt/desktop test
```

期待出力:

```text
 Test Files  11 passed (11)
      Tests  119 passed (119)
```

- [ ] **Step 3: コミットする**

追加・変更したファイル: `apps/desktop/test/polish.test.ts`

```powershell
git add apps/desktop/test/polish.test.ts
git commit -m @'
test(desktop): cover work files, sounds, schematic and notices

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 8: 仕上げ部分の E2E

**Files:**
- Create: `apps/desktop/e2e/polish.spec.ts`

仕様 §12.1（設定画面）／§8.4（回路図ヒント）／§6.2・§12.2（端子番号が読めること）を Electron 上で確かめ、スクリーンショットを残す。

**テストを繰り返し実行できるようにする**: 設定と一時保存は `userData` に残るので、`beforeAll` で復元プロンプトを片付け、設定は「値」ではなく「切り替わること」を確かめる。


- [ ] **Step 1: `apps/desktop/e2e/polish.spec.ts` を書く**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * 仕上げ部分の E2E（設定画面・回路図ヒント・作業ファイルの保存）。
 * 設計仕様 §12.1 / §8.4 / §12.3 / §15。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = process.env['OJT_SHOT_DIR'] ?? join(APP_ROOT, 'screenshots');

const CHROMIUM_FLAGS = [
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

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

test.describe('仕上げ', () => {
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
    // 前回の実行が残した一時保存があると復元プロンプトが出るので、先に片付ける（§12.3）
    const restore = page.getByTestId('restore-prompt');
    if ((await restore.count()) > 0) {
      await page.getByRole('button', { name: '復元しない' }).click();
    }
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('設定画面に商標注記が出て、音量を変えても落ちない（§12.1 / §15）', async () => {
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('about')).toContainText('三菱電機');
    await expect(page.getByTestId('about')).toContainText('本アプリの表記');
    await expect(page.getByTestId('setting-user-dir')).toBeVisible();
    // 前回の実行の設定が残っていても動くように、値ではなく「切り替わること」を確かめる
    const before = await page.getByTestId('setting-sound-enabled').isChecked();
    await page.getByTestId('setting-sound-enabled').click();
    await expect(page.getByTestId('toast')).toContainText('設定を保存しました');
    await expect(page.getByTestId('setting-sound-enabled')).toBeChecked({ checked: !before });
    await page.getByTestId('setting-sound-enabled').click();
    await shot(app, '09-settings');
    await page.getByRole('button', { name: 'ホームへ戻る' }).click();
  });

  test('2級相当の課題で回路図ヒントを開閉できる（§8.4）', async () => {
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.waitForTimeout(800);
    // b-001 は3級課題で `hints.schematicVisible: true` なので最初から出ている
    await expect(page.getByTestId('schematic-hint')).toBeVisible();
    await expect(page.getByTestId('schematic-svg')).toBeVisible();
    await shot(app, '10-schematic-hint');
    await page.getByRole('button', { name: '回路図を隠す' }).click();
    await expect(page.getByTestId('schematic-hint')).toHaveCount(0);
    await page.getByRole('button', { name: '回路図を表示' }).click();
    await expect(page.getByTestId('schematic-hint')).toBeVisible();
  });

  test('視点プリセットを切り替えても盤が描かれ続け、端子番号が読める（§6.2 / §12.2）', async () => {
    await page.getByRole('button', { name: '俯瞰' }).click();
    await page.waitForTimeout(900);
    await shot(app, '11-view-top-birdseye');
    await page.getByRole('button', { name: 'ソケット拡大' }).click();
    await page.waitForTimeout(900);
    // ソケット拡大では ①〜⑭ の印字がはっきり読める大きさになる
    await shot(app, '12-view-socket-labels');
    await page.getByRole('button', { name: '正面' }).click();
    await page.waitForTimeout(900);
    // 正面でも全端子の番号・役割が見えている。左上のビューキューブも写る（§12.2）
    await shot(app, '13-view-front-labels');
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
  });
});
```

- [ ] **Step 2: ビルドして E2E をすべて実行する**

実行:

```powershell
pnpm --filter @ojt/desktop build
pnpm --filter @ojt/desktop e2e
```

期待出力:

```text
Running 4 tests using 1 worker

  ✓  1 e2e\polish.spec.ts:61:3 › 仕上げ › 設定画面に商標注記が出て、音量を変えても落ちない（§12.1 / §15）
  ✓  2 e2e\polish.spec.ts:76:3 › 仕上げ › 2級相当の課題で回路図ヒントを開閉できる（§8.4）
  ✓  3 e2e\polish.spec.ts:91:3 › 仕上げ › 視点プリセットを切り替えても盤が描かれ続け、端子番号が読める（§6.2 / §12.2）
  ✓  4 e2e\smoke.spec.ts:107:3 › モードB スモーク › ホーム → 課題一覧 → 課題を開く → 配線 → 判定 → 結果画面

  4 passed
```

- [ ] **Step 3: スクリーンショットを目視する**

`12-view-socket-labels.png` でソケットの ①〜⑭ と COM/a/b/+/− が読めること、`13-view-front-labels.png` で正面視でも全端子の番号が見えていること、左上にビューキューブが写っていることを確かめる。

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
09-settings.png
10-schematic-hint.png
11-view-top-birdseye.png
12-view-socket-labels.png
13-view-front-labels.png
```

- [ ] **Step 4: コミットする**

追加・変更したファイル: `apps/desktop/e2e/polish.spec.ts`

```powershell
git add apps/desktop/e2e/polish.spec.ts
git commit -m @'
test(desktop): add e2e for settings, schematic hint and terminal labels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## Task 9: 配布パッケージ（electron-builder）

**Files:**
- Create: `apps/desktop/electron-builder.yml`, `apps/desktop/resources/content/assemble/*.json`
- Modify: `apps/desktop/package.json`, `pnpm-workspace.yaml`

仕様 §15「electron-builder。NSISインストーラ と ポータブル版（zip展開のみで動作）の2形態。コード署名なし。自動更新なし」。


- [ ] **Step 1: 課題JSONを `resources/content/` へコピーする**

`extraResources` は asar の外に置かれるので、利用者が差し替えられる（§7.8）。

```powershell
New-Item -ItemType Directory -Force apps/desktop/resources/content/assemble
Copy-Item packages/content/src/builtin/assemble/*.json apps/desktop/resources/content/assemble/
```

実行:

```powershell
(Get-ChildItem apps/desktop/resources/content/assemble).Count
```

期待出力:

```text
8
```

- [ ] **Step 2: `apps/desktop/electron-builder.yml` を書く**

```yaml
# 配布パッケージ。設計仕様 §15。
# NSISインストーラ（管理者権限不要）とポータブル版（zip展開のみ）の2形態を作る。
# コード署名はしない（SmartScreen の回避手順は README とインストーラ説明画面に日本語で書く）。
appId: jp.ojt.electrical-trainer
productName: OJT電気保全トレーナー
copyright: OJT電気保全トレーナー

directories:
  output: release
  buildResources: build

# out/ は electron-vite のビルド成果物。asar にまとめる。
files:
  - out/**/*
  - package.json

asar: true

# 課題JSONは asar の外に置き、利用者が差し替えられるようにする（§7.8）。
extraResources:
  - from: resources/content
    to: content

win:
  target:
    - target: nsis
      arch: [x64]
    - target: zip
      arch: [x64]
  artifactName: ${productName}-${version}-${arch}.${ext}

nsis:
  oneClick: false
  perMachine: false # 管理者権限を要求しない（§15）
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: OJT電気保全トレーナー

# 完全オフライン。自動更新の設定は持たない（§15）。
publish: null
```

- [ ] **Step 3: `apps/desktop/package.json` に `dist` スクリプトと electron-builder を足す**

```json
    "dist": "node scripts/build.mjs && electron-builder --config electron-builder.yml",
```

`devDependencies` に次を足す（アルファベット順）。

```json
    "electron-builder": "26.15.3",
```

- [ ] **Step 4: `pnpm-workspace.yaml` の `allowBuilds` に `electron-winstaller` を足す**

electron-builder が NSIS のツール群を取りに行くためにビルドスクリプトを要る。

```yaml
allowBuilds:
  electron: true
  electron-winstaller: true
  esbuild: true
```

実行:

```powershell
pnpm install
```

期待出力:

```text
Done in ...s using pnpm v11.2.2
```

- [ ] **Step 5: パッケージを作る**

実行:

```powershell
pnpm --filter @ojt/desktop dist
```

期待出力:

```text
  • packaging       platform=win32 arch=x64 electron=44.3.0 appOutDir=release\win-unpacked
  • building        target=zip arch=x64 file=release\OJT電気保全トレーナー-0.1.0-x64.zip
  • building        target=nsis file=release\OJT電気保全トレーナー-0.1.0-x64.exe archs=x64 oneClick=false perMachine=false
```

**既知の落とし穴（実機で確認済み）**: Windows on ARM のホストでは NSIS の `makensis.exe`（x86）の起動が `Error: read ENOTCONN` で失敗することがある。その場合でも `release/win-unpacked/` と ポータブル zip は生成されているので、**NSIS だけを x64 の Windows（またはCI）で作る**。x64 ホストでは両方とも通る。

- [ ] **Step 6: ポータブル版が起動することを確かめる**

実行:

```powershell
$exe = 'apps/desktop/release/win-unpacked/OJT電気保全トレーナー.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 10
if (-not $p.HasExited) { (Get-Process -Id $p.Id).MainWindowTitle; Stop-Process -Id $p.Id -Force } else { "EXITED $($p.ExitCode)" }
```

期待出力:

```text
OJT電気保全トレーナー
```

課題JSONが asar の外に置かれたことも確かめる。

実行:

```powershell
(Get-ChildItem apps/desktop/release/win-unpacked/resources/content/assemble).Count
```

期待出力:

```text
8
```

- [ ] **Step 7: コミットする**

追加・変更したファイル: `apps/desktop/electron-builder.yml` `apps/desktop/package.json` `apps/desktop/resources` `pnpm-workspace.yaml`

```powershell
git add apps/desktop/electron-builder.yml apps/desktop/package.json apps/desktop/resources pnpm-workspace.yaml
git commit -m @'
chore(desktop): package with electron-builder (nsis and portable zip)

コード署名なし・自動更新なし。課題JSONは extraResources として asar の外に置く。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5s66DcWF7uTvUejdMWTiC
'@
```

---

## 仕様との対応表（この計画で満たすもの）

| 仕様 | 内容 | Task |
|---|---|---|
| §7.8 | 利用者課題フォルダの合流（同一IDは利用者側を優先） | Task 1 |
| §8.2 | 動作音（WebAudio 合成） | Task 2・6 |
| §8.4 | 回路図ヒント（3級=常時／2級=開閉可／1級=非表示） | Task 4・6 |
| §11.2 | 回路図の読取専用レンダラ（`layout()` を SVG 化） | Task 4 |
| §12.1 | 設定画面（利用者課題フォルダ・音・復元確認・このアプリについて） | Task 5 |
| §12.3 | 作業ファイルの保存／読込（Electron dialog、`.ojtw`、`formatVersion`） | Task 3・6 |
| §12.3 | 30秒ごとの一時保存と起動時の復帰確認・復元しないときの削除 | Task 3・6 |
| §13 #1 | 課題JSONのスキーマ違反を一覧に理由付きで出す | Task 1 |
| §13 #4 | WebGLコンテキスト消失の再初期化（状態は Worker が持つので失われない） | Task 3 Step 4（状態）／Plan 1D1 Task 12（`BoardScene`） |
| §13 #5 | renderer の未捕捉例外バナーと「セッションをリセット」 | Plan 1D1 Task 6 |
| §13 #7 | 作業ファイルの保存失敗を理由付きで出す | Task 3・6 |
| §13 #8 | 作業ファイルのバージョン不整合は読み込まない | Task 3・7 |
| §13 #9 | 利用者課題フォルダが無いときの警告 | Task 1 |
| §14.2 | UIテスト（Vitest ＋ Testing Library）と E2E | Task 7・8 |
| §15 | 音は WebAudio 合成のみ・音声ファイルを同梱しない | Task 2 |
| §15 | 日本語文言の集約（`i18n/ja.ts`） | Task 6 |
| §15 | 商標注記と「一部の命令名・キー割当は本アプリの表記」注記 | Task 5・7 |
| §15 | electron-builder（NSIS ＋ ポータブル zip、asar、extraResources） | Task 9 |
| §15 | コード署名なし・自動更新なし | Task 9 |
| §16 Phase 1 | 配布可能な状態（ポータブル版が起動して課題を1つ完了できる） | Task 8・9 |

---

## 意図的な差分（仕様の文面と実装が違う点と理由）

| # | 仕様の文面 | 実装 | 理由 |
|---|---|---|---|
| 1 | §4.3「チャネルは6本のみ」 | 一時保存の削除は `workfile:load` に `discard: true` を載せて表す | 7本目のチャネルを作らずに §12.3 の「復元しない選択をしたら一時保存を削除する」を満たすため |
| 2 | §12.3「一時保存は `%APPDATA%/OJT電気保全トレーナー/autosave/` へ」 | `app.getPath('userData')/autosave.json` に1ファイルで書く | `userData` は Electron が `productName` から `%APPDATA%/OJT電気保全トレーナー` に解決するので置き場所は仕様どおり。復元対象はつねに1件なのでフォルダではなく1ファイルにした |
| 3 | §15「フォントも同梱する」 | 同梱せず OS のフォント（Yu Gothic UI / Meiryo）を指定する | Windows 10/11 は両方を標準搭載しており（§1.2 の対象OS）、フォントを同梱するとパッケージが数十MB増える。対象OSを広げるときに同梱へ切り替える |
| 4 | §15「NSISインストーラ と ポータブル版」 | ポータブルは `zip` ターゲット（`portable` ターゲットではない） | §15 の「zip展開のみで動作」をそのまま満たす。`portable` ターゲットは自己展開exeで一時フォルダに展開するため、オフライン運用の持ち運びには zip のほうが向く |
| 5 | §8.4「2級は開いた回数を結果に表示する」 | 開閉はできるが回数は記録しない | 回数の記録先は `JudgeResult`（Plan 1C の型）で、Phase 1 の合否・結果画面の項目（§8.3）に含まれていない。Phase 2 で C2 のヒント制御を作るときに `JudgeOptions` へ足すのが自然 |

---

## 完了条件

- [ ] `pnpm --filter @ojt/desktop typecheck` が無出力で終わる
- [ ] `pnpm lint` が無出力で終わる
- [ ] `pnpm --filter @ojt/desktop test` が **11ファイル / 119テスト** すべて通る
- [ ] `pnpm --filter @ojt/desktop e2e` の **4本**（スモーク1本＋仕上げ3本）が通る
- [ ] `apps/desktop/screenshots/` に15枚のスクリーンショットが出る
- [ ] `pnpm --filter @ojt/desktop dist` が `release/win-unpacked/` と ポータブル zip を作り、`release/win-unpacked/OJT電気保全トレーナー.exe` が起動してウィンドウタイトル「OJT電気保全トレーナー」を出す
- [ ] `release/win-unpacked/resources/content/assemble/` に課題JSONが8件ある
- [ ] `pnpm -r test` が全パッケージで通る

---

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-14 | 初版 |
| 2026-09-14 | 実装された `@ojt/schematic-core`（Task 11〜16 / 13b・13c・13d）と `@ojt/board-model` の経路器（Task 9b・9c）に合わせて整合を取った。①Task 4 の読取専用レンダラを実装どおりの `Shape`（`kind` / `role` に `line` / `circle` / `arc` / `text` の項目が付く直和。`fill` は `circle` だけ、`startDeg` / `endDeg` は `arc` だけ、`text` / `anchor` は `text` だけ）と `SchematicLayout`（`width` / `height` / `shapes`）に合わせ、`DEFAULT_LAYOUT_OPTIONS`（`colWidth: 24` / `rowHeight: 24` / `marginX: 12` / `marginY: 16` / `symbolWidth: 12`）を明記した。タイマコイルの銘板が `T1 (3.0秒)` と長く既定の列幅では隣と重なるので、`layout(doc, { colWidth: 40 })` を渡すようにした（Task 7 に検査を追加）。②Task 13d で `Shape` に付いた `rungId?` / `cellId?` は Phase 2 のホバー連動で使うものとして注記し、Phase 1 は配列の添字で `key` を振る方針を明示した。③Task 6 の `Session.tsx` から、`routeWire()` が `RoutingError` を投げるようになって死にコードになっていた `crossesFootprint()` の分岐を外し、`safeRoutes()`（Plan 1D1 Task 12）で受け止めて理由を出す形に揃えた。文言も `routeBlocked` → `routeFailed` / `laneOverflow` / `routeReason` に差し替えた。④`work-file.ts` の `toSession()` が `@ojt/schematic-core` の `toSession(doc, board, options)`（`{ ok, session, assignment } \| { ok: false, errors }`）と同名の別物であることを注記した。テスト総数 115 → 119（Plan 1D1 Task 11 の増加ぶん） |
