import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_ALL_PROBLEMS } from '../src/builtin/index.js';
import { loadProblemsFromDir, mergeProblemSets } from '../src/loader.js';
import { isPlcProblem } from '../src/schema/index.js';
import { plcProblemJson } from './helpers/plc.js';

/** モードD課題がローダーとマージでも他モード同様に扱われることの確認（レビュー #2）。 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ojt-content-plc-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, value: unknown): void {
  writeFileSync(join(dir, relative), JSON.stringify(value), 'utf8');
}

describe('loadProblemsFromDir / mergeProblemSets with a mode D problem', () => {
  it('loads and merges a valid PLC problem alongside the built-ins', () => {
    write('d-user.json', plcProblemJson({ id: 'd-user' }));
    const user = loadProblemsFromDir(dir);
    expect(user.errors).toEqual([]);
    expect(user.problems).toHaveLength(1);
    expect(isPlcProblem(user.problems[0]!)).toBe(true);

    const merged = mergeProblemSets({ problems: [...BUILTIN_ALL_PROBLEMS], errors: [] }, user);
    expect(merged.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length + 1);
    expect(merged.problems.filter(isPlcProblem)).toHaveLength(
      BUILTIN_ALL_PROBLEMS.filter(isPlcProblem).length + 1,
    );
    expect(merged.errors).toEqual([]);
  });

  it('a broken PLC problem reports reason "schema", never "unsupported-mode"', () => {
    /* eslint-disable @typescript-eslint/no-unused-vars -- 本体フィールドを落とすためだけの分割代入 */
    const {
      plc: _plc,
      io: _io,
      referenceLadder: _ladder,
      ...headerOnly
    } = plcProblemJson({
      id: 'd-bad',
    });
    /* eslint-enable @typescript-eslint/no-unused-vars */
    write('d-bad.json', headerOnly);
    const user = loadProblemsFromDir(dir);
    expect(user.problems).toEqual([]);
    expect(user.errors).toHaveLength(1);
    expect(user.errors[0]?.reason).toBe('schema');
    expect(user.errors[0]?.message).toBe('課題の形式が正しくありません');
    expect(user.errors[0]?.id).toBe('d-bad');
  });

  it('a user PLC problem can override a built-in id (the last write wins)', () => {
    const first = BUILTIN_ALL_PROBLEMS[0]!;
    write('ov.json', plcProblemJson({ id: first.id }));
    const user = loadProblemsFromDir(dir);
    expect(user.errors).toEqual([]);
    const merged = mergeProblemSets({ problems: [...BUILTIN_ALL_PROBLEMS], errors: [] }, user);
    expect(merged.problems).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    expect(merged.problems.find((p) => p.id === first.id)?.mode).toBe('plc');
  });
});
