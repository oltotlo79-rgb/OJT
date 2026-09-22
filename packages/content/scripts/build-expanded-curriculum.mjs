/**
 * 追加課題の教材原稿。論理条件・観察手順からレビュー可能なJSONを生成する。
 * 実行時には生成しない。既存001〜020（C1は012）を変更しない。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const base = fileURLToPath(new globalThis.URL('../src/builtin/', import.meta.url));
const entries = { assemble: [], 'inspect-parts': [], 'inspect-repair': [], plc: [] };
const clone = (value) => globalThis.structuredClone(value);
const write = (mode, problem) => {
  const file = `${problem.id}-practice.json`;
  writeFileSync(join(base, mode, file), JSON.stringify(problem, null, 2) + '\n');
  entries[mode].push({ id: problem.id, file });
};
const idOf = (prefix, n) => `${prefix}-${String(n).padStart(3, '0')}`;
// 正はa接点、負はb接点。各配列は直列、外側の配列は並列。
const topics = [
  ['禁止条件付き運転', [[1, -2]], 'PB1を押し、PB2を放している間だけ'],
  [
    '二入力の排他的動作',
    [
      [1, -2],
      [-1, 2],
    ],
    'PB1とPB2の片方だけを押している間',
  ],
  ['三条件の同時成立', [[1, 2, 3]], 'PB1・PB2・PB3を全て押している間だけ'],
  [
    '共通許可付き二地点操作',
    [
      [1, 3],
      [2, 3],
    ],
    'PB3を押し、PB1かPB2の少なくとも一方を押している間',
  ],
  ['単独操作と協調操作', [[1], [2, 3]], 'PB1を押すか、PB2とPB3を同時に押している間'],
  ['二つの禁止条件', [[1, -2, -3]], 'PB1だけを押している間'],
  [
    '共通停止付き二地点操作',
    [
      [1, -3],
      [2, -3],
    ],
    'PB3を放し、PB1かPB2を押している間',
  ],
  ['二条件成立と第三入力禁止', [[1, 2, -3]], 'PB1とPB2を押し、PB3を放している間'],
  [
    '三入力の多数決',
    [
      [1, 2],
      [2, 3],
      [1, 3],
    ],
    '三つのボタンのうち二つ以上を押している間',
  ],
  [
    '一入力だけの選択',
    [
      [1, -2, -3],
      [-1, 2, -3],
      [-1, -2, 3],
    ],
    '三つのボタンのうち一つだけを押している間',
  ],
  [
    '二入力だけの選択',
    [
      [1, 2, -3],
      [1, -2, 3],
      [-1, 2, 3],
    ],
    '三つのボタンのうち二つだけを押している間',
  ],
  [
    '全一致を除く入力監視',
    [
      [1, -2],
      [2, -3],
      [3, -1],
    ],
    '三つのボタンが全て同じ状態ではない間',
  ],
  [
    '切替入力で運転条件を選ぶ',
    [
      [1, 3],
      [-1, 2],
    ],
    'PB1を押しているときはPB3、放しているときはPB2を押している間',
  ],
  [
    '禁止と許可の組合せ',
    [
      [1, -2],
      [2, 3],
    ],
    'PB1を押してPB2を放すか、PB2とPB3を同時に押している間',
  ],
  [
    '二経路の選択運転',
    [
      [1, 2],
      [-1, 3],
    ],
    'PB1を押しているときはPB2、放しているときはPB3を押している間',
  ],
  [
    '許可付き排他操作',
    [
      [1, -2, 3],
      [-1, 2, 3],
    ],
    'PB3を押し、PB1とPB2の片方だけを押している間',
  ],
  [
    '許可付き一致検出',
    [
      [1, 2, 3],
      [-1, -2, 3],
    ],
    'PB3を押し、PB1とPB2が同じ状態の間',
  ],
  [
    '三入力の奇数検出',
    [
      [1, -2, -3],
      [-1, 2, -3],
      [-1, -2, 3],
      [1, 2, 3],
    ],
    '押しているボタンが一つまたは三つの間',
  ],
  [
    '補助入力で禁止を解除',
    [
      [1, -2],
      [1, 3],
    ],
    'PB1を押し、PB2を放すかPB3を押している間',
  ],
  ['優先入力付き一致監視', [[3], [1, 2]], 'PB3を押すか、PB1とPB2を同時に押している間'],
];
function operations(interval, timedTerms) {
  const result = [];
  let previous = 0;
  const transition = (state, t) => {
    for (let bit = 0; bit < 3; bit++) {
      if ((state & (1 << bit)) !== (previous & (1 << bit))) {
        result.push({
          t,
          target: `PB${bit + 1}`,
          action: state & (1 << bit) ? 'press' : 'release',
        });
      }
    }
    previous = state;
  };
  const offset = timedTerms ? 2000 : 0;
  if (timedTerms) {
    const enabled = [1, 2, 3, 4, 5, 6, 7].find((state) =>
      timedTerms.some((term) =>
        term.every((v) => Boolean(state & (1 << (Math.abs(v) - 1))) === v > 0),
      ),
    );
    // 600msの成立を2回与える。累積計時やリセット忘れでは仕様と食い違う。
    transition(enabled, 200);
    transition(0, 800);
    transition(enabled, 1100);
    transition(0, 1700);
  }
  const states = [1, 3, 2, 6, 7, 5, 4, 0];
  states.forEach((state, step) => transition(state, offset + 600 + step * interval));
  return { operations: result, durationMs: offset + 1200 + states.length * interval };
}
const staticChecks = {
  wireColorRule: true,
  terminalLimit: true,
  unusedParts: true,
  forbiddenCircuit: true,
  coilPolarity: true,
  powerSequence: true,
};
function header(id, mode, title, grade, tags, description) {
  return {
    formatVersion: 1,
    id,
    mode,
    title,
    grade,
    difficulty: grade === 3 ? 2 : grade === 2 ? 3 : 4,
    tags,
    description,
    timeLimit: { standardMin: grade === 3 ? 25 : 40, cutoffMin: 60 },
    board: {
      boardId: 'board-jipm-std',
      socketRoles: { S1: 'CR1', S2: 'CR2', S3: 'CR3', S7: 'CHK' },
    },
    inventory: [{ kind: 'relay-my4n', count: 3 }],
  };
}
function schematic(id, title, terms, timerMode) {
  const rungs = [];
  let serial = 0;
  const cell = (kind, device, extra = {}) => ({ kind, id: `c${++serial}`, device, ...extra });
  const add = (id, cells, from = { bus: 'P' }, to = { bus: 'N' }) =>
    rungs.push({ id, from, to, cells });
  for (let n = 1; n <= 3; n++) add(`input${n}`, [cell('pb-a', `PB${n}`), cell('coil', `CR${n}`)]);
  const contacts = (term) => term.map((v) => cell(v > 0 ? 'cr-a' : 'cr-b', `CR${Math.abs(v)}`));
  const load = timerMode ? cell('coil', 'T1', { presetMs: 1000 }) : cell('lamp', 'PL1');
  add('condition', [...contacts(terms[0]), load]);
  terms
    .slice(1)
    .forEach((term, n) =>
      add(`branch${n}`, contacts(term), { bus: 'P' }, { rung: 'condition', node: terms[0].length }),
    );
  if (timerMode) {
    // 条件の合流点を共有し、四組しかない物理接点を重複して消費しない。
    add('output', [cell(timerMode === 'delay' ? 't-a' : 't-b', 'T1'), cell('lamp', 'PL1')], {
      rung: 'condition',
      node: terms[0].length,
    });
    add('status', [cell(timerMode === 'delay' ? 't-b' : 't-a', 'T1'), cell('lamp', 'PL2')], {
      rung: 'condition',
      node: terms[0].length,
    });
  }
  return { formatVersion: 1, id: `sch-${id}`, title, orientation: 'horizontal', rungs };
}
const extraAssemble = [];
for (let i = 0; i < 40; i++) {
  const timerMode = i < 20 ? undefined : i < 30 ? 'delay' : 'pulse';
  const topic = topics[i < 20 ? i : (i - 20) % 10];
  const [name, terms, condition] = topic;
  const suffix =
    timerMode === 'delay' ? '・継続確認後に点灯' : timerMode === 'pulse' ? '・開始時だけ点灯' : '';
  const id = idOf('b', i + 21);
  const title = name + suffix;
  const requirement = timerMode
    ? `${condition}、タイマT1を励磁します。条件が1秒続いたら${timerMode === 'delay' ? 'PL1を点灯し、待機中のPL2を消灯' : '最初に点灯したPL1を消灯し、PL2を点灯'}します。途中で条件が外れたら両方を消灯し、経過時間をリセットしてください。再成立では最初から計時します。`
    : `${condition}、白ランプPL1を点灯してください。その他の状態では消灯します。`;
  const problem = header(
    id,
    'assemble',
    title,
    i < 8 ? 3 : i < 30 ? 2 : 1,
    timerMode ? ['and-or', 'timer', 'sequence'] : ['and-or', 'interlock'],
    `${requirement} PB1・PB2・PB3はCR1・CR2・CR3で受け、各リレーの接点を使って条件を構成します。全8通りの入力状態で、予測した点灯条件と実際の動作を照合してください。`,
  );
  if (timerMode) {
    problem.board.socketRoles.S5 = 'T1';
    problem.inventory.push({ kind: 'timer-h3y4', count: 1 });
  }
  Object.assign(problem, {
    schematic: schematic(id, title, terms, timerMode),
    ...operations(timerMode ? 1800 : 900, timerMode ? terms : undefined),
    judge: { tolerance: { edgeMs: 200, ratio: 0.1 }, staticChecks },
    hints: { schematicVisible: problem.grade === 3 },
  });
  extraAssemble.push(problem);
  write('assemble', problem);
}

// C1は故障種だけでなく、接点群・部品種・測定順序を段階的に学ぶ24セット。
const diagnoses = [
  ['a接点の開閉比較', ['normal', 'a-open', 'a-weld', 'normal']],
  ['b接点の開閉比較', ['b-open', 'normal', 'b-weld', 'normal']],
  ['コイル抵抗と吸引動作', ['coil-open', 'normal', 'coil-layer-short', 'normal']],
  ['同じ非導通でも原因は異なる', ['a-open', 'coil-open', 'normal', 'b-open', 'normal']],
  ['溶着と正常閉路の識別', ['a-weld', 'normal', 'b-weld', 'b-open', 'normal']],
  [
    '全接点とコイルの総合点検',
    ['coil-open', 'a-open', 'a-weld', 'b-open', 'b-weld', 'normal', 'normal'],
  ],
];
for (let i = 0; i < 24; i++) {
  const group = 1 + Math.floor(i / 6);
  const [name, truths] = diagnoses[i % 6];
  const id = idOf('c1', i + 13);
  const grade = i < 6 ? 3 : i < 16 ? 2 : 1;
  const p = header(
    id,
    'inspect-parts',
    `${name}・接点群${group}`,
    grade,
    ['fault-part', 'measure'],
    `部品を一つずつ点検し、正常か故障かを判定してください。重点は「${name}」です。接点群${group}を含む全ての接点を、無励磁時と励磁時で比較します。見た目や並び順では判断せず、コイル抵抗、吸引、a接点、b接点の順に測定結果を記録してください。タイマは設定時間が経過してから接点を判定します。`,
  );
  p.board.socketRoles = { S7: 'CHK' };
  p.inventory = [];
  p.parts = truths.map((truth, n) => ({
    id: `p${n + 1}`,
    kind: truth === 'coil-layer-short' || (n + group) % 3 !== 0 ? 'relay-my4n' : 'timer-h3y4',
    truth,
    ...(truth.startsWith('a-') || truth.startsWith('b-') ? { group } : {}),
    ...(truth === 'coil-layer-short' ? { ratio: 0.45 + group * 0.05 } : {}),
  }));
  p.seed = 2026092200 + i;
  write('inspect-parts', p);
}

// C2は異なる論理回路で故障診断。交換手順は別の固定fixtureにも出力する。
const repairFixtures = {};
for (let i = 0; i < 40; i++) {
  const source = extraAssemble[i];
  const p = clone(source);
  const id = idOf('c2', i + 21);
  const partId = i < 20 ? `CR${1 + (i % 3)}` : 'T1';
  p.id = id;
  p.mode = 'inspect-repair';
  p.grade = i < 20 ? 2 : 1;
  p.difficulty = p.grade === 2 ? 3 : 4;
  p.title = source.title + 'の故障診断';
  p.description =
    source.description +
    ' 現在は指定どおり動きません。電源から負荷へ電圧を追い、故障部品を指摘して交換してください。交換前に電源を切り、交換後は全入力条件と再始動を確認します。';
  p.schematic.id = `sch-${id}`;
  p.hints.schematicVisible = p.grade === 2;
  p.tags = [...new Set([...p.tags, 'fault-part', 'measure'])];
  const firstContact = p.schematic.rungs
    .flatMap((r) => r.cells)
    .find((c) => c.device === partId && ['cr-a', 'cr-b', 't-a', 't-b'].includes(c.kind));
  const isContactFault = i % 2 === 1;
  p.faults = [
    {
      kind: isContactFault ? (i % 4 === 1 ? 'contact-open' : 'contact-welded') : 'coil-open',
      target: {
        partId,
        elementIndex: isContactFault ? (firstContact.kind.endsWith('-a') ? 2 : 1) : 0,
      },
    },
  ];
  repairFixtures[id] = [{ op: 'replace', partId }];
  write('inspect-repair', p);
}
writeFileSync(
  fileURLToPath(new globalThis.URL('../test/helpers/expanded-repairs.json', import.meta.url)),
  JSON.stringify(repairFixtures, null, 2) + '\n',
);

const device = (kind, index) => ({ kind, index });
const contact = (kind, index, type = 'NO') => ({
  kind: 'contact',
  type,
  device: device(kind, index),
});
const coil = (kind, index) => ({ kind: 'coil', type: 'OUT', device: device(kind, index) });
function ladderFor(terms, timerMode) {
  const networks = terms.map((term, n) => ({
    id: `term${n}`,
    comment: `成立条件${n + 1}`,
    cells: [
      [
        ...term.map((v) => contact('input', Math.abs(v) - 1, v > 0 ? 'NO' : 'NC')),
        coil('internal', n),
      ],
    ],
  }));
  const rows = terms.map((_, n) => [
    contact('internal', n),
    ...(n < terms.length - 1 ? [{ kind: 'vline' }] : []),
  ]);
  rows[0].push(coil('internal', 10));
  if (terms.length === 1) rows[0] = [contact('internal', 0), coil('internal', 10)];
  networks.push({ id: 'condition', comment: '条件の並列結合', cells: rows });
  const linear = (id, cells, comment) => networks.push({ id, comment, cells: [cells] });
  if (timerMode) {
    linear(
      'timing',
      [
        contact('internal', 10),
        { kind: 'timer', type: 'TON', device: device('timer', 0), presetMs: 1000 },
      ],
      '条件が途切れたら計時をリセット',
    );
    linear(
      'output',
      [
        contact('internal', 10),
        contact('timer', 0, timerMode === 'delay' ? 'NO' : 'NC'),
        coil('output', 0),
      ],
      '課題の出力',
    );
    linear(
      'waiting',
      [
        contact('internal', 10),
        contact('timer', 0, timerMode === 'delay' ? 'NC' : 'NO'),
        coil('output', 1),
      ],
      '待機または経過表示',
    );
    linear('conditionLamp', [contact('internal', 10), coil('output', 2)], '条件成立表示');
    linear(
      'clock',
      [contact('input', 2), contact('special', 2), coil('output', 3)],
      'PB3を押す間は1秒クロックで点滅',
    );
  } else {
    linear('output', [contact('internal', 10), coil('output', 0)], '課題の出力');
    linear('inputLamp1', [contact('input', 0), coil('output', 1)], 'PB1の入力確認');
    linear('inputLamp3', [contact('input', 2), coil('output', 2)], 'PB3の入力確認');
  }
  networks.push({ id: 'end', cells: [[{ kind: 'end' }]] });
  return {
    networks,
    comments: {
      X0: '入力PB1',
      X1: '入力PB2',
      X2: '入力PB3',
      M10: '条件成立',
      Y0: '判定対象PL1',
      ...(timerMode ? { T0: '継続時間1秒', SP2: '1秒クロック' } : {}),
    },
  };
}
for (let i = 0; i < 40; i++) {
  const source = extraAssemble[i];
  const timerMode = i < 20 ? undefined : i < 30 ? 'delay' : 'pulse';
  const terms = topics[i < 20 ? i : (i - 20) % 10][1];
  const p = header(
    idOf('d', i + 21),
    'plc',
    `PLC ${source.title}`,
    i < 20 ? 2 : 1,
    source.tags,
    source.description.split(' PB1・PB2・PB3は')[0] +
      (timerMode
        ? ' PL3は条件成立中に点灯し、PL4はPB3を押している間だけ1秒クロックで点滅させます。常時ONとクロックは別の特殊接点なので、メーカー別の特殊接点一覧で確認してください。'
        : ' PL2にはPB1の入力状態、PL3にはPB3の入力状態を表示します。') +
      ' 各出力は盤のリレーを介して接続し、PLC電源は壁コンセントから取ります。',
  );
  p.board.socketRoles.S4 = 'CR4';
  p.inventory[0].count = 4;
  p.plc = { vendor: 'mitsubishi', model: 'FX5U' };
  p.io = {
    mode: 'fixed',
    wiring: 'sink',
    inputs: [0, 1, 2].map((x) => ({ x, pb: `PB${x + 1}` })),
    outputs: Array.from({ length: timerMode ? 4 : 3 }, (_, y) => ({
      y,
      cr: `CR${y + 1}`,
      pl: `PL${y + 1}`,
    })),
  };
  Object.assign(p, {
    referenceLadder: ladderFor(terms, timerMode),
    wiringRequired: true,
    ...operations(timerMode ? 1800 : 900, timerMode ? terms : undefined),
    judge: { compareSignals: p.io.outputs.map((o) => o.pl) },
  });
  write('plc', p);
}

// JSONの静的import一覧も生成し、Node ESMとブラウザの双方で同じ教材を読む。
let imports =
  '// build-expanded-curriculum.mjs から生成。教材の条件は同スクリプトを編集してください。\n';
for (const [mode, list] of Object.entries(entries))
  for (const { id, file } of list)
    imports += `import ${id.replaceAll('-', '_')} from './${mode}/${file}' with { type: 'json' };\n`;
for (const [mode, list] of Object.entries(entries))
  imports += `export const EXTRA_${mode.replaceAll('-', '_').toUpperCase()} = [${list.map((e) => e.id.replaceAll('-', '_')).join(', ')}];\n`;
writeFileSync(join(base, 'expanded.ts'), imports);

await import('./update-manual-index.mjs');
const { copyContent } = await import('../../../apps/desktop/scripts/copy-content.mjs');
copyContent(
  base,
  fileURLToPath(new globalThis.URL('../../../apps/desktop/resources/content/', import.meta.url)),
);
globalThis.console.log(
  Object.fromEntries(Object.entries(entries).map(([key, list]) => [key, list.length])),
);
