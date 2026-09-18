import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNSUPPORTED_MODES } from '../src/schema/common.js';
import {
  isAssembleProblem,
  isInspectPartsProblem,
  isInspectRepairProblem,
  isPlcProblem,
  parseProblem,
  problemJsonSchema,
} from '../src/schema/index.js';
import { inspectPartsProblemJson, inspectRepairProblemJson } from './helpers/inspect.js';
import { plcProblemJson } from './helpers/plc.js';
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

  it('reports a non object as a schema error at the root', () => {
    const result = parseProblem(42);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
    expect(result.issues[0]?.path).toBe('(root)');
    expect(result.id).toBeUndefined();
    expect(result.mode).toBeUndefined();
  });

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

  it("reports exactly one issue naming the valid modes for a typo'd mode", () => {
    const result = parseProblem({ ...selfHoldProblemJson(), mode: 'inspect-part' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toBe('mode');
    expect(result.issues[0]?.message).toContain('assemble');
    expect(result.issues[0]?.message).toContain('inspect-parts');
    expect(result.issues[0]?.message).toContain('inspect-repair');
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
});

describe('モードD課題の判別（§7.6 / §16）', () => {
  it('parses a mode D problem and marks it as plc', () => {
    const parsed = parseProblem(plcProblemJson());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.problem.mode).toBe('plc');
    expect(isPlcProblem(parsed.problem)).toBe(true);
    expect(isAssembleProblem(parsed.problem)).toBe(false);
  });

  it('reports a header-only PLC problem as a schema error, not as an unsupported mode', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 本体フィールドを落とすためだけの分割代入
    const { plc: _plc, io: _io, referenceLadder: _ladder, ...headerOnly } = plcProblemJson();
    const parsed = parseProblem(headerOnly);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe('schema');
    expect(parsed.mode).toBe('plc');
    expect(parsed.issues.map((i) => i.path)).toContain('plc');
  });

  it('has no unsupported mode left (§16 Phase 3)', () => {
    expect(UNSUPPORTED_MODES).toEqual([]);
  });
});

describe('parseProblem — 未知のキー (§13 #1)', () => {
  /** 課題JSONの一部を差し替えて `parseProblem()` にかけ、違反のパス一覧を返す。 */
  function issuePaths(json: Record<string, unknown>): string[] {
    const result = parseProblem(json);
    expect(result.ok).toBe(false);
    if (result.ok) return [];
    expect(result.reason).toBe('schema');
    return result.issues.map((i) => i.path);
  }

  it('reports an unknown key at the top level and names it', () => {
    const paths = issuePaths({
      ...selfHoldProblemJson(),
      physicalOverrides: { c03: ['CR1.13', 'CR1.14'] },
      totallyUnknown: 42,
    });
    expect(paths).toContain('physicalOverrides');
    expect(paths).toContain('totallyUnknown');
  });

  it('reports an unknown key inside board', () => {
    const json = selfHoldProblemJson();
    const board = json.board as Record<string, unknown>;
    expect(issuePaths({ ...json, board: { ...board, extraPart: 'BZ' } })).toContain(
      'board.extraPart',
    );
  });

  it('reports an unknown key inside judge and hints', () => {
    const json = selfHoldProblemJson();
    expect(issuePaths({ ...json, judge: { edgeMs: 200 } })).toContain('judge.edgeMs');
    expect(issuePaths({ ...json, hints: { schematicVisible: true, wiring: true } })).toContain(
      'hints.wiring',
    );
  });

  it('reports an unknown key inside an operation', () => {
    const json = selfHoldProblemJson();
    expect(
      issuePaths({
        ...json,
        operations: [{ t: 500, target: 'PB1', action: 'press', hold: true }],
        durationMs: 1000,
      }),
    ).toContain('operations[0].hold');
  });

  it('reports an unknown key inside a rung and inside a cell', () => {
    const json = selfHoldProblemJson();
    const schematic = json.schematic as { rungs: Record<string, unknown>[] };
    const rungs = schematic.rungs.map((r) => ({ ...r }));
    rungs[0] = { ...rungs[0], label: '第1段' };
    expect(issuePaths({ ...json, schematic: { ...schematic, rungs } })).toContain(
      'schematic.rungs[0].label',
    );

    const withCell = selfHoldProblemJson();
    const doc = withCell.schematic as { rungs: { cells: Record<string, unknown>[] }[] };
    const firstRung = doc.rungs[0];
    if (firstRung === undefined) throw new Error('fixture has no rung');
    firstRung.cells = firstRung.cells.map((c, i) => (i === 0 ? { ...c, note: 'x' } : c));
    expect(issuePaths(withCell)).toContain('schematic.rungs[0].cells[0].note');
  });
});

describe('parseProblem — メッセージと入れ子の共用体', () => {
  it('reports zod messages in Japanese (§13 #1)', () => {
    const result = parseProblem({ ...selfHoldProblemJson(), formatVersion: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues.find((i) => i.path === 'formatVersion');
    expect(issue?.message).toContain('無効な入力');
  });

  it('flattens a nested union error down to the offending key (§13 #1)', () => {
    const json = selfHoldProblemJson();
    const schematic = json.schematic as { rungs: Record<string, unknown>[] };
    const rungs = schematic.rungs.map((r) => ({ ...r }));
    rungs[0] = { ...rungs[0], from: { bus: 'L' } };
    const result = parseProblem({ ...json, schematic: { ...schematic, rungs } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((i) => i.path);
    // 親(共用体そのもの)も残しつつ、各候補の違反をその位置まで展開する
    expect(paths).toContain('schematic.rungs[0].from');
    expect(paths).toContain('schematic.rungs[0].from.bus');
    expect(paths).toContain('schematic.rungs[0].from.rung');
    expect(paths).toContain('schematic.rungs[0].from.node');
    // 同じ (path, message) は1回だけ
    const keys = result.issues.map((i) => `${i.path}\u0000${i.message}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('formats a nested string path with dots', () => {
    const result = parseProblem({
      ...selfHoldProblemJson(),
      grade: 2,
      hints: { schematicVisible: true },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.path)).toContain('hints.schematicVisible');
  });
});

describe('problemJsonSchema', () => {
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

  it('documents the top level fields and forbids unknown keys', () => {
    const schema = problemJsonSchema();
    const assemble = (schema.oneOf as Record<string, unknown>[])[0];
    expect(assemble?.additionalProperties).toBe(false);
    const properties = assemble?.properties as Record<string, { description?: string }>;
    for (const field of [
      'id',
      'title',
      'grade',
      'mode',
      'description',
      'timeLimit',
      'board',
      'inventory',
      'schematic',
      'operations',
      'durationMs',
      'judge',
      'hints',
      'physicalOverride',
    ]) {
      expect(properties[field]?.description, field).toBeTypeOf('string');
    }
  });

  it('matches the committed schema/task.schema.json (§4.5)', () => {
    const file = join(import.meta.dirname, '..', 'schema', 'task.schema.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(problemJsonSchema());
  });
});
