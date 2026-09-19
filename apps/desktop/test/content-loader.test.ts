import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_ALL_PROBLEMS, parseProblem } from '@ojt/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 課題の供給テスト。設計仕様 §7.8（利用者側優先・同梱課題は resources から）/ §13 #1（読込エラー） /
 * §13 #9（フォルダ無し）。Plan 1D1 の内蔵課題だけのテストを置き換える（Plan 1D2 Task 1）。
 *
 * `app.isPackaged` と `process.resourcesPath` を差し替えて、配布版の分岐（resources/content から
 * 同梱課題を読む）と開発時の分岐（焼き込みの `BUILTIN_ALL_PROBLEMS`）の両方を固定する。
 */

const electron = vi.hoisted(() => ({ packaged: false }));

vi.mock('electron', () => ({
  app: {
    get isPackaged(): boolean {
      return electron.packaged;
    },
  },
}));

const {
  builtinSet,
  clearContentCache,
  CONTENT_CACHE_TTL_MS,
  loadContent,
  probeUserDir,
  withTimeout,
} = await import('../src/main/content-loader.js');

const created: string[] = [];

function tempDir(prefix = 'ojt-content-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** `process.resourcesPath` を差し替える（Node では未定義なので生やす）。 */
function setResourcesPath(dir: string): void {
  (process as unknown as Record<string, unknown>)['resourcesPath'] = dir;
}

const originalResourcesPath: unknown = (process as unknown as Record<string, unknown>)[
  'resourcesPath'
];

beforeEach(() => {
  electron.packaged = false;
  clearContentCache();
});

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  (process as unknown as Record<string, unknown>)['resourcesPath'] = originalResourcesPath;
  clearContentCache();
});

describe('builtinSet', () => {
  it('開発時は焼き込みの内蔵課題20題を返す（§7.9）', () => {
    expect(builtinSet().problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    expect(builtinSet().errors).toHaveLength(0);
  });

  it('配布版は resources/content から同梱課題を読む（§7.8）', () => {
    const resources = tempDir('ojt-resources-');
    const assemble = join(resources, 'content', 'assemble');
    mkdirSync(assemble, { recursive: true });
    for (const problem of BUILTIN_ALL_PROBLEMS) {
      writeFileSync(
        join(assemble, `${problem.id}.json`),
        JSON.stringify({ ...problem, title: `差し替え版 ${problem.title}` }),
        'utf8',
      );
    }
    electron.packaged = true;
    setResourcesPath(resources);

    const set = builtinSet();
    expect(set.errors).toEqual([]);
    expect(set.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    // ディスク側の内容がそのまま同梱課題になる（差し替えが効く）
    expect(set.problems.every((p) => p.title.startsWith('差し替え版'))).toBe(true);
  });

  it('配布版でフォルダが空なら焼き込みに落として理由を残す（§13 #1）', () => {
    const resources = tempDir('ojt-resources-');
    mkdirSync(join(resources, 'content'), { recursive: true });
    electron.packaged = true;
    setResourcesPath(resources);

    const set = builtinSet();
    expect(set.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    expect(set.errors).toHaveLength(1);
    expect(set.errors[0]?.message).toContain('内蔵した課題で起動します');
  });

  it('配布版で件数が焼き込みと食い違えば焼き込みへ落とし、件数を理由に出す（Phase 2 acceptance BLOCKER）', () => {
    // `dist` の複写漏れ（例: 一部モードフォルダしか複写されない）を模して、
    // 一部の課題しか置かれていない resources/content を用意する
    const resources = tempDir('ojt-resources-');
    const assemble = join(resources, 'content', 'assemble');
    mkdirSync(assemble, { recursive: true });
    const partial = BUILTIN_ALL_PROBLEMS.slice(0, 8); // モードBの8題だけ（C1/C2が欠落）
    for (const problem of partial) {
      writeFileSync(join(assemble, `${problem.id}.json`), JSON.stringify(problem), 'utf8');
    }
    electron.packaged = true;
    setResourcesPath(resources);

    const set = builtinSet();
    // 一覧が欠けたまま出ず、確実に焼き込みの28題へ落ちる
    expect(set.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    expect(set.errors).toHaveLength(1);
    expect(set.errors[0]?.message).toContain('8件');
    expect(set.errors[0]?.message).toContain('28件');
    expect(set.errors[0]?.message).toContain('内蔵した課題で起動します');
  });

  it('配布版でフォルダごと無くても起動できる（§13 #1）', () => {
    electron.packaged = true;
    setResourcesPath(join(tmpdir(), 'ojt-no-such-resources'));

    const set = builtinSet();
    expect(set.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    expect(set.errors[0]?.message).toContain('同梱課題フォルダがありません');
  });
});

describe('loadContent', () => {
  it('利用者フォルダが無ければ内蔵課題だけで動く（§13 #9）', async () => {
    const { payload } = await loadContent(join(tmpdir(), 'ojt-does-not-exist'));
    expect(payload.userDirExists).toBe(false);
    expect(payload.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    expect(payload.problems.every((p) => p.source === 'builtin')).toBe(true);
  });

  it('フォルダではなくファイルを指していても「無い」として扱う（§13 #9）', async () => {
    const dir = tempDir();
    const file = join(dir, 'not-a-dir.json');
    writeFileSync(file, '{}', 'utf8');
    const { payload } = await loadContent(file);
    expect(payload.userDirExists).toBe(false);
    expect(payload.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
  });

  it('利用者フォルダの課題を合流し、同一IDは利用者側を優先する（§7.8）', async () => {
    const dir = tempDir();
    const builtin = BUILTIN_ALL_PROBLEMS[0];
    expect(builtin).toBeDefined();
    if (builtin === undefined) return;
    writeFileSync(
      join(dir, 'override.json'),
      JSON.stringify({ ...builtin, title: '利用者版の自己保持回路' }),
      'utf8',
    );
    const { payload, byId } = await loadContent(dir);
    expect(payload.userDirExists).toBe(true);
    const row = payload.problems.find((p) => p.id === builtin.id);
    expect(row?.title).toBe('利用者版の自己保持回路');
    expect(row?.source).toBe('user');
    expect(byId.get(builtin.id)?.title).toBe('利用者版の自己保持回路');
  });

  it('壊れた課題は理由付きで一覧に出し、他の課題は読み込む（§13 #1）', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'broken.json'), '{ this is not json', 'utf8');
    const { payload } = await loadContent(dir);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]?.reason).toBe('invalid-json');
    expect(payload.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
  });

  it('スキーマ違反はzodのパス付きで理由を出す（§13 #1）', async () => {
    const dir = tempDir();
    const builtin = BUILTIN_ALL_PROBLEMS[0];
    if (builtin === undefined) return;
    writeFileSync(
      join(dir, 'bad-grade.json'),
      JSON.stringify({ ...builtin, id: 'u-001', grade: 9 }),
      'utf8',
    );
    const { payload } = await loadContent(dir);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]?.details.join(' ')).toContain('grade');
  });
});

describe('loadContent の再利用（1D2-a: content:read のたびに読み直さない）', () => {
  it('同じフォルダが変わっていなければ前回の結果をそのまま返す', async () => {
    const dir = tempDir();
    const first = await loadContent(dir);
    const second = await loadContent(dir);
    expect(second).toBe(first);
  });

  it('有効期限を過ぎたら読み直し、足された課題が見える', async () => {
    const dir = tempDir();
    const before = await loadContent(dir);
    const builtin = BUILTIN_ALL_PROBLEMS[0];
    if (builtin === undefined) return;
    writeFileSync(
      join(dir, 'added.json'),
      JSON.stringify({ ...builtin, id: 'u-900', title: '追加された課題' }),
      'utf8',
    );
    /*
     * Windows のフォルダ更新時刻は同じ秒のうちの追加で動かないことがあるので、
     * 覚えた結果は更新時刻が同じでも有効期限で必ず捨てる（`CONTENT_CACHE_TTL_MS`）。
     * 時計だけを進めて、その仕組みが効いていることを確かめる。
     */
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CONTENT_CACHE_TTL_MS + 1);
    const after = await loadContent(dir);
    vi.useRealTimers();

    expect(after).not.toBe(before);
    expect(after.byId.get('u-900')?.title).toBe('追加された課題');
  });

  it('別のフォルダなら読み直す', async () => {
    const a = tempDir();
    const b = tempDir();
    expect(await loadContent(b)).not.toBe(await loadContent(a));
  });
});

describe('probeUserDir（1D2-a: 到達できないフォルダで main を止めない。§13 #9）', () => {
  it('返ってこない問い合わせは制限時間で打ち切る（到達できない共有フォルダの代わり）', async () => {
    // 到達できない `\\\\server\\share` は本物で用意できないので、決して片付かない約束で代用する
    const never = new Promise<{ exists: boolean; mtimeMs: number }>(() => {
      // 何もしない
    });
    const started = Date.now();
    const state = await withTimeout(never, 20, { exists: false, mtimeMs: -1 });
    expect(state).toEqual({ exists: false, mtimeMs: -1 });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('実在するフォルダは更新時刻付きで返る', async () => {
    const dir = tempDir();
    const state = await probeUserDir(dir);
    expect(state.exists).toBe(true);
    expect(state.mtimeMs).toBeGreaterThan(0);
  });

  it('空文字のフォルダは調べに行かない', async () => {
    expect(await probeUserDir('')).toEqual({ exists: false, mtimeMs: -1 });
  });
});

describe('loadContent の所要時間（1D2-a: 大きなフォルダでも一覧が返る）', () => {
  it('1000ファイルの利用者フォルダでも 20 秒以内に読み終える', async () => {
    const dir = tempDir();
    const builtin = BUILTIN_ALL_PROBLEMS[0];
    if (builtin === undefined) return;
    for (let i = 0; i < 1000; i += 1) {
      writeFileSync(
        join(dir, `u-${String(i).padStart(4, '0')}.json`),
        JSON.stringify({ ...builtin, id: `u-${String(i).padStart(4, '0')}` }),
        'utf8',
      );
    }
    const started = Date.now();
    const { payload } = await loadContent(dir);
    const tookMs = Date.now() - started;
    expect(payload.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length + 1000);
    // 実測は数秒。極端に遅くなったら気づけるだけの緩い上限にする
    expect(tookMs).toBeLessThan(20_000);
  }, 60_000);
});

describe('loadContent のモードB以外の扱い（Plan 2A Task 17: SupportedProblem の絞り込み）', () => {
  /**
   * モードC1（部品点検）の最小課題JSON。`packages/content/test/helpers/inspect.ts` の
   * `inspectPartsProblemJson()` と同じ骨組み（正常1・コイル断線1・レアショート1・a接点溶着1）。
   * `apps/desktop` の tsconfig は `rootDir: "."` で他パッケージの test を含められないため、
   * 相対importはせずここに複製する。
   */
  function inspectPartsProblemJson(): Record<string, unknown> {
    return {
      formatVersion: 1,
      id: 'x-c1',
      mode: 'inspect-parts',
      title: 'テスト用 部品点検',
      grade: 2,
      description: 'テスト用',
      timeLimit: { standardMin: 30, cutoffMin: 50 },
      board: { boardId: 'board-jipm-std', socketRoles: { S7: 'CHK' } },
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

  it('利用者フォルダのinspect-parts課題も一覧に出す（Plan 2B Task 1）', async () => {
    const dir = tempDir();
    const json = inspectPartsProblemJson();
    // 課題としては有効な形であることを確かめてから使う（壊れた前提のテストにしない）
    const parsed = parseProblem(json);
    expect(parsed.ok).toBe(true);
    writeFileSync(join(dir, 'c1.json'), JSON.stringify(json), 'utf8');

    const { payload, byId } = await loadContent(dir);

    // 内蔵20題に利用者フォルダのC1課題が足され、byId からも引ける
    expect(payload.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length + 1);
    expect(byId.size).toBe(BUILTIN_ALL_PROBLEMS.length + 1);
    expect(byId.get('x-c1')?.mode).toBe('inspect-parts');

    // 弾かれた課題が無いので読込エラーの行も出ない
    expect(payload.errors).toHaveLength(0);
    const row = payload.problems.find((p) => p.id === 'x-c1');
    expect(row?.mode).toBe('inspect-parts');
    expect(row?.source).toBe('user');
  });

  it('内蔵課題は28題（モードB 8 / C1 4 / C2 8 / D 8）', () => {
    expect(BUILTIN_ALL_PROBLEMS).toHaveLength(28);
  });
});

describe('ヘッダだけのPLC課題（§16 / §13 #1）', () => {
  /** PLC課題（Phase 3）のヘッダだけの最小JSON（`plc` / `io` / `referenceLadder` などの本体を持たない）。 */
  function plcProblemJson(): Record<string, unknown> {
    return {
      formatVersion: 1,
      id: 'x-plc',
      mode: 'plc',
      title: 'テスト用 PLCラダー',
      grade: 2,
      description: 'テスト用',
      timeLimit: { standardMin: 30, cutoffMin: 50 },
      board: { boardId: 'board-jipm-std', socketRoles: { S7: 'CHK' } },
      inventory: [],
    };
  }

  it('利用者フォルダのヘッダだけのPLC課題は一覧に出さず、読込エラー（reason: schema）にする', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'plc.json'), JSON.stringify(plcProblemJson()), 'utf8');

    const { payload, byId } = await loadContent(dir);

    expect(payload.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    expect(byId.get('x-plc')).toBeUndefined();
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]?.reason).toBe('schema');
    expect(payload.errors[0]?.message).toBe('課題の形式が正しくありません');
    expect(payload.errors[0]?.details.length).toBeGreaterThan(0);
  });
});
