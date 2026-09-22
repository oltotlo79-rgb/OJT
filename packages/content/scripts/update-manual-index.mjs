import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// 既存の解説行は保持し、追加教材の索引を同時に更新する。全ID・題名は単体検査で照合する。
const source = fileURLToPath(new globalThis.URL('../src/builtin/', import.meta.url));
const manual = fileURLToPath(
  new globalThis.URL('../../../docs/manual/14-tutorial-features.md', import.meta.url),
);
const text = readFileSync(manual, 'utf8');
const pattern = /^\| (?:b|c1|c2|d)-\d{3} \|.*$/gmu;
const oldRows = [...text.matchAll(pattern)];
if (!oldRows.length) throw new Error('説明書の課題索引が見つかりません');
const existing = new Map(oldRows.map((match) => [match[0].split('|')[1].trim(), match[0]]));
const rows = [];
for (const [mode, label] of Object.entries({
  assemble: 'B',
  'inspect-parts': 'C1',
  'inspect-repair': 'C2',
  plc: 'D',
})) {
  for (const name of readdirSync(join(source, mode))
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const p = JSON.parse(readFileSync(join(source, mode, name), 'utf8'));
    let learning;
    let caution;
    if (mode === 'inspect-parts') {
      learning = '抵抗・励磁・接点状態の比較';
      caution = '正常品と比較し、全接点群を確認する';
    } else if (mode === 'inspect-repair') {
      learning = '電圧測定による故障の切り分け';
      caution = '修復後に全ての入力条件を再確認する';
    } else if (p.tags.includes('timer')) {
      learning = p.title.includes('開始時だけ')
        ? '条件成立時の一定時間出力'
        : '条件成立が続いた後の出力';
      caution = '短押し後の再計時を確認';
    } else {
      learning = mode === 'plc' ? '論理条件のラダー化' : '論理条件の接点回路化';
      caution = '同時押し・解除を含む8通りを確認する';
    }
    rows.push(
      (!name.endsWith('-practice.json') ? existing.get(p.id) : undefined) ??
        `| ${p.id} | ${label} | ${p.grade} | ${p.difficulty} | ${p.title} | ${learning} | ${caution} |`,
    );
  }
}
const first = oldRows[0];
const last = oldRows.at(-1);
writeFileSync(
  manual,
  text.slice(0, first.index) + rows.join('\n') + text.slice(last.index + last[0].length),
  'utf8',
);
globalThis.console.log(`説明書の課題索引: ${rows.length}題`);
