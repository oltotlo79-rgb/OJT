/**
 * 「回路実験」「PLC実験」の例題を作る（2026-10-08）。設計: docs/superpowers/specs/2026-10-08-lab-modes-design.md §4.3
 *
 * 内蔵課題（自己保持・インターロック・オンディレー・ワンショット）の模範回路（PLCは模範配線＋模範ラダー）を
 * 元の操作で動かし、ランプの動きを正解として `src/lab-templates.ts` に書き出す。
 *
 * 実行（packages/content で）:
 *   node --experimental-transform-types --import ./scripts/ts-source-resolve.js scripts/build-lab-templates.mjs
 *   （生成後にリポジトリのルートで `pnpm exec prettier --write packages/content/src/lab-templates.ts`）
 *
 * 生成物が最新であることは `test/lab-templates.test.ts` が確かめる。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JIPM_BOARD } from '@ojt/board-model';
import { findBuiltinProblem } from '../src/builtin/index.ts';
import { buildLabTemplates } from '../src/lab-template-build.ts';

const templates = buildLabTemplates(findBuiltinProblem, JIPM_BOARD);
const out = fileURLToPath(new globalThis.URL('../src/lab-templates.ts', import.meta.url));
writeFileSync(
  out,
  [
    '// このファイルは scripts/build-lab-templates.mjs が生成する。手で書き換えないこと。',
    "import type { LabTemplate } from './lab-chart.js';",
    '',
    '/** 実験の例題（内蔵課題の模範を元の操作で動かした結果）。設計 §4.3 */',
    `export const LAB_TEMPLATES: readonly LabTemplate[] = ${JSON.stringify(templates, null, 2)};`,
    '',
  ].join('\n'),
);
for (const template of templates) {
  const lamps = template.expected
    .map((row) => `${row.signal} ${row.on.map(([from, to]) => `${from}-${to}`).join(',')}`)
    .join(' / ');
  globalThis.console.log(
    `${template.mode} ${template.id} (${template.source}) ${template.durationMs}ms: ${lamps}`,
  );
}
