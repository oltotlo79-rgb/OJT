import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/*.d.mts`（手書きの宣言）と対応する `scripts/*.mjs`（実装）の `export` 名が
 * 集合として一致することを固定する（Phase 7 Task 29 Step 7 / 指摘 QA-14 の副産物）。
 *
 * この2つは同じ関数・定数を指しているはずだが、TS の型検査は宣言ファイル側だけを見るため
 * （`*.mjs` は同名の `*.d.mts` に隠れ、`checkJs` の対象からも自動的に外れる）、`.mjs` へ
 * 実装だけを足して宣言を更新し忘れても誰も気づけない。ここで両者の export 名を突き合わせる。
 */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = join(APP_ROOT, 'scripts');

/** 宣言ファイルでは declare を省略できる。どちらの書式からも値の export 名を拾う。 */
function valueExportNamesInDeclaration(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(
    /^export (?:declare )?(?:const|function)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    const name = m[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

/** `export const NAME` / `export function NAME(` から export 名を拾う（実装側）。 */
function exportNamesInImplementation(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/^export (?:const|function)\s+([A-Za-z_$][\w$]*)/gm)) {
    const name = m[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

const declarationFiles = readdirSync(SCRIPTS_DIR).filter((name) => name.endsWith('.d.mts'));

describe('scripts/*.d.mts と scripts/*.mjs の export 名（QA-14 の副産物）', () => {
  it('declare の有無にかかわらず公開関数と定数を拾い、型と非公開宣言を除く', () => {
    const source = [
      'export function plain(): void;',
      'export declare function explicit(): void;',
      'export const count: number;',
      'export declare const limit: number;',
      'export interface Shape {}',
      'export type Name = string;',
      'declare function internal(): void;',
    ].join('\n');
    expect([...valueExportNamesInDeclaration(source)].sort()).toEqual([
      'count',
      'explicit',
      'limit',
      'plain',
    ]);
  });

  it('宣言ファイルが scripts/ に少なくとも1本はある', () => {
    expect(declarationFiles.length).toBeGreaterThan(0);
  });

  it.each(declarationFiles)('%s の export 名が実装の .mjs と一致する', (declarationFile) => {
    const implementationFile = declarationFile.replace(/\.d\.mts$/, '.mjs');
    const declarationSource = readFileSync(join(SCRIPTS_DIR, declarationFile), 'utf8');
    const implementationSource = readFileSync(join(SCRIPTS_DIR, implementationFile), 'utf8');

    const declared = valueExportNamesInDeclaration(declarationSource);
    const implemented = exportNamesInImplementation(implementationSource);

    expect([...declared].sort()).toEqual([...implemented].sort());
  });
});
