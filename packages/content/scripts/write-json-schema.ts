import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { problemJsonSchema } from '../src/schema/index.js';

/**
 * 課題スキーマの JSON Schema を書き出す。設計仕様 §4.5。
 * 生成物（`schema/task.schema.json`）はリポジトリに入れて配布物へ同梱する。zod を唯一の源とし、
 * ここでは書き出すだけにする。`test/schema-index.test.ts` が中身の一致を見張るので、
 * スキーマを変えたら `pnpm --filter @ojt/content schema:write` を流し直す。
 */

/** 生成先（`packages/content/schema/task.schema.json`）。 */
export const OUTPUT_PATH = join(import.meta.dirname, '..', 'schema', 'task.schema.json');

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(problemJsonSchema(), null, 2)}\n`, 'utf8');
process.stdout.write(`wrote ${OUTPUT_PATH}\n`);
