import { BUILTIN_ALL_PROBLEMS } from '@ojt/content';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildManual } from '../scripts/manual-build.mjs';

const manual = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/manual');
const source = readFileSync(resolve(manual, '14-tutorial-features.md'), 'utf8');
const rows = source
  .split('## 課題の索引')[1]!
  .split('\n')
  .filter((line) => /^\| (?:b|c1|c2|d)-\d{3} \|/u.test(line))
  .map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
const modes = { assemble: 'B', 'inspect-parts': 'C1', 'inspect-repair': 'C2', plc: 'D' } as const;

describe('全課題を1回ずつ探せる索引', () => {
  it('印刷とヘルプで索引を識別し、IDを途中で折り返さない列にする', () => {
    const built = buildManual([{ name: '14-tutorial-features.md', text: source }]);
    expect(built.printHtml).toContain('<table data-manual-table="problem-index">');
    expect(built.sections.find((section) => section.id.endsWith('/課題の索引'))?.html).toContain(
      '<table data-manual-table="problem-index">',
    );
    const printed = new DOMParser().parseFromString(built.printHtml, 'text/html');
    const index = printed.querySelector('table[data-manual-table="problem-index"]')!;
    expect(index.querySelectorAll('tbody tr')).toHaveLength(BUILTIN_ALL_PROBLEMS.length);
    for (const row of index.querySelectorAll('tr')) expect(row.children).toHaveLength(4);
    expect(built.printHtml).toMatch(/\.problem-id \{[^}]*white-space: nowrap;/u);
    expect(built.printHtml).toContain('tr { page-break-inside: avoid; }');
  });
  it('同梱課題のIDを過不足・重複なく掲載する', () => {
    expect(rows.map((row) => row[0]).sort()).toEqual(BUILTIN_ALL_PROBLEMS.map((p) => p.id).sort());
  });
  it('モード・級・難しさ・題名が課題の実データに一致し、学ぶことと注意点を持つ', () => {
    for (const problem of BUILTIN_ALL_PROBLEMS) {
      const row = rows.find((cells) => cells[0] === problem.id)!;
      expect(row, problem.id).toHaveLength(7);
      expect(row.slice(1, 5), problem.id).toEqual([
        modes[problem.mode],
        String(problem.grade),
        String(problem.difficulty),
        problem.title,
      ]);
      expect(row[5]?.length, problem.id).toBeGreaterThan(0);
      expect(row[6]?.length, problem.id).toBeGreaterThan(0);
    }
  });
});

describe('通し練習を最後まで読める構成', () => {
  it('4モードの全41手順に図が付き、番号が連続する', () => {
    const modesSource = readFileSync(resolve(manual, '13-tutorial-modes.md'), 'utf8');
    const blocks = modesSource
      .split(/^## /mu)
      .filter((block) =>
        /^(?:回路を組み立てる|部品を点検する|回路を点検して直す|PLCでプログラムを作る)/u.test(
          block,
        ),
      );
    expect(blocks).toHaveLength(4);
    for (const [index, block] of blocks.entries()) {
      const steps = [
        ...block.matchAll(/^(\d+)\. \*\*[^\n]+\n([\s\S]*?)(?=^\d+\. \*\*|$(?![\s\S]))/gmu),
      ];
      // PLCは v1.7.0 で「仕様のタイムチャートを見る」の手順を足して13手順
      const expected = [9, 9, 10, 13][index]!;
      expect(steps).toHaveLength(expected);
      expect(steps.map((step) => Number(step[1]))).toEqual(
        Array.from({ length: expected }, (_, i) => i + 1),
      );
      for (const step of steps) expect(step[2]).toMatch(/!\[.+\]\(images\/[\w-]+\.png\)/u);
    }
  });
  it('15機能を同じ4段の構成で説明する', () => {
    const blocks = source
      .split(/^## /mu)
      .slice(1)
      .filter(
        (block) =>
          !block.startsWith('課題の索引') && !block.startsWith('予測して、測って、確かめる'),
      );
    const learning = source.split('## 予測して、測って、確かめる')[1]?.split('## 3Dの見方')[0];
    expect(learning).toContain('測定例：リレーが動かない');
    expect(learning).toContain('動作例：自己保持の読み方');
    expect(learning).toContain('練習の振り返り');
    expect(blocks).toHaveLength(15);
    for (const block of blocks) {
      expect([...block.matchAll(/^### (.+)$/gmu)].map((m) => m[1])).toEqual([
        '何ができるか',
        'どこにあるか',
        '操作の順',
        'よくある間違い',
      ]);
      expect(block).toMatch(/!\[.+\]\(images\/[\w-]+\.png\)/u);
      expect(block).toMatch(/^1\. /mu);
    }
  });
});
