import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { problemJsonSchema } from '../src/schema/index.js';
import { plcProblemJson } from './helpers/plc.js';

/**
 * `schema/task.schema.json`（§4.5）を ajv の strict モードで確認する。
 * レビュー #2: zod の `z.toJSONSchema()` が吐く形が ajv の strict モードでも矛盾なくコンパイルでき、
 * かつ実際の課題JSON（8件のモードB組込み課題・モードD課題）がそれに通ることまで確かめる
 * （zodでの検証と別経路の確認。§4.5 の「同梱する」の意味を保証する）。
 */

const schemaFile = join(import.meta.dirname, '..', 'schema', 'task.schema.json');
const schema = JSON.parse(readFileSync(schemaFile, 'utf8')) as Record<string, unknown>;

describe('task.schema.json（ajv strict / draft 2020-12）', () => {
  it('has four oneOf branches, one per mode, each closed with additionalProperties: false', () => {
    const branches = schema['oneOf'] as Array<Record<string, unknown>>;
    expect(branches).toHaveLength(4);
    const properties = branches.map(
      (b) => (b['properties'] as Record<string, unknown>)['mode'] as Record<string, unknown>,
    );
    expect(properties.map((p) => p['const'])).toEqual([
      'assemble',
      'inspect-parts',
      'inspect-repair',
      'plc',
    ]);
    for (const branch of branches) expect(branch['additionalProperties']).toBe(false);
  });

  it('is byte-identical to a freshly generated problemJsonSchema() (regenerate with schema:write otherwise)', () => {
    expect(problemJsonSchema()).toEqual(schema);
  });

  it('compiles under ajv strict mode', () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    expect(() => ajv.compile(schema)).not.toThrow();
  });

  it('the 20 mode-B built-in problems validate against the regenerated JSON Schema', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    const dir = join(import.meta.dirname, '..', 'src', 'builtin', 'assemble');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(90);
    for (const file of files) {
      const json: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const ok = validate(json);
      expect(ok, `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('a mode D problem JSON also validates against the JSON Schema', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    const ok = validate(plcProblemJson());
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });
});
