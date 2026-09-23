/** 1.5教材。四入力、短時間パルスと継続判定、実I/O差、断線・未配線・誤配線を追加する。 */
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { JIPM_BOARD, FREE_TRAINING_RULES, plcUnitFor } from '@ojt/board-model';
import { parseProblem } from '../src/schema/index.ts';
import { buildReferenceSession } from '../src/reference.ts';
import { buildInspectRepairCircuit } from '../src/inspect-repair.ts';
import { judgeInspectRepair } from '../src/judge-inspect.ts';

const base = fileURLToPath(new globalThis.URL('../src/builtin/', import.meta.url));
const modes = { assemble: [], 'inspect-parts': [], 'inspect-repair': [], plc: [] };
const clone = (value) => globalThis.structuredClone(value);
const read = (mode, prefix) =>
  JSON.parse(
    readFileSync(
      join(
        base,
        mode,
        readdirSync(join(base, mode)).find((file) => file.startsWith(prefix)),
      ),
      'utf8',
    ),
  );
const put = (p) => {
  const file = `${p.id}-workshop.json`;
  writeFileSync(join(base, p.mode, file), JSON.stringify(p, null, 2) + '\n');
  modes[p.mode].push({ id: p.id, file });
};
const idOf = (prefix, n) => `${prefix}-${String(n).padStart(3, '0')}`;
const topics = [
  ['四つの許可がそろう運転', [[1, 2, 3, 4]], 'PB1・PB2・PB3・PB4をすべて押している間'],
  [
    '二組の両手操作',
    [
      [1, 2],
      [3, 4],
    ],
    'PB1とPB2、またはPB3とPB4を同時に押している間',
  ],
  [
    '禁止を補助入力で解除',
    [
      [1, 2, -3],
      [1, 2, 4],
    ],
    'PB1とPB2を押し、PB3を放すかPB4を押している間',
  ],
  [
    '交互の入力組合せ',
    [
      [1, -2, 3, -4],
      [-1, 2, -3, 4],
    ],
    'PB1とPB3だけ、またはPB2とPB4だけを押している間',
  ],
  ['三つの禁止入力', [[1, -2, -3, -4]], 'PB1だけを押している間'],
  [
    '許可経路と禁止経路',
    [
      [1, 3],
      [2, -4],
    ],
    'PB1とPB3を押すか、PB2を押してPB4を放している間',
  ],
  [
    '共通許可付き二地点起動',
    [
      [1, 2, 3],
      [2, 3, 4],
    ],
    'PB2とPB3を押し、PB1かPB4を押している間',
  ],
  [
    '許可に応じて起動条件を選択',
    [
      [1, -2, 3],
      [1, -3, 4],
    ],
    'PB1を押し、PB3を押すときはPB2を放す、PB3を放すときはPB4を押す条件が成立している間',
  ],
];
function operations(interval, buttons = [1, 2, 3, 4], pulse = false) {
  const out = [];
  let previous = 0;
  const set = (state, t) => {
    buttons.forEach((n, bit) => {
      if ((state & (1 << bit)) !== (previous & (1 << bit)))
        out.push({ t, target: `PB${n}`, action: state & (1 << bit) ? 'press' : 'release' });
    });
    previous = state;
  };
  // 二進順だけでなくGray順で1入力ずつ変え、境界の取り違えを見つける。
  const states = Array.from({ length: 1 << buttons.length }, (_, n) => n ^ (n >> 1));
  let offset = 600;
  if (pulse) {
    set((1 << buttons.length) - 1, 300);
    set(0, 500);
    offset = 1200;
  }
  states.slice(1).forEach((state, n) => set(state, offset + n * interval));
  set(0, offset + (states.length - 1) * interval);
  return { operations: out, durationMs: offset + states.length * interval + 500 };
}
function diagram(id, title, terms, timerMode, presetMs, secondary) {
  let serial = 0;
  const cells = (kind, device, extra = {}) => ({ id: `e${++serial}`, kind, device, ...extra });
  const rungs = [];
  const add = (id, row, from = { bus: 'P' }, to = { bus: 'N' }) =>
    rungs.push({ id, from, to, cells: row });
  for (let n = 1; n <= 4; n++) add(`in${n}`, [cells('pb-a', `PB${n}`), cells('coil', `CR${n}`)]);
  const contacts = (term) => term.map((n) => cells(n > 0 ? 'cr-a' : 'cr-b', `CR${Math.abs(n)}`));
  add('condition', [
    ...contacts(terms[0]),
    timerMode ? cells('coil', 'T1', { presetMs }) : cells('lamp', 'PL1'),
  ]);
  terms
    .slice(1)
    .forEach((term, n) =>
      add(`or${n}`, contacts(term), { bus: 'P' }, { rung: 'condition', node: terms[0].length }),
    );
  if (timerMode) {
    add('main', [cells(timerMode === 'delay' ? 't-a' : 't-b', 'T1'), cells('lamp', 'PL1')], {
      rung: 'condition',
      node: terms[0].length,
    });
    add('status', [cells(timerMode === 'delay' ? 't-b' : 't-a', 'T1'), cells('lamp', 'PL2')], {
      rung: 'condition',
      node: terms[0].length,
    });
  } else if (secondary) add('status', [cells('cr-a', 'CR4'), cells('lamp', 'PL2')]);
  return { formatVersion: 1, id: `sch-${id}`, title, orientation: 'horizontal', rungs };
}
const assembled = [],
  specifications = {};
for (let i = 0; i < 26; i++) {
  const [name, terms, condition] = topics[i % topics.length];
  const timed = i >= 14,
    timerMode = timed ? (i < 20 ? 'delay' : 'pulse') : undefined,
    presetMs = [500, 1500, 2500][i % 3];
  const secondary = i >= 8 && !timed;
  const p = read('assemble', 'b-009-');
  p.id = idOf('b', i + 61);
  p.title = `${name}${timed ? `・${presetMs / 1000}秒${timerMode === 'delay' ? '継続確認' : '初期表示'}` : secondary ? '・入力状態表示付き' : ''}`;
  p.grade = timed ? 1 : secondary ? 2 : 3;
  p.difficulty = timed ? 4 : secondary ? 3 : 2;
  p.hints.schematicVisible = p.grade === 3;
  p.tags = timed ? ['and-or', 'timer', 'sequence'] : ['and-or', 'interlock'];
  p.board.socketRoles = {
    S1: 'CR1',
    S2: 'CR2',
    S3: 'CR3',
    S4: 'CR4',
    ...(timed ? { S5: 'T1' } : {}),
    S7: 'CHK',
  };
  p.inventory = [
    { kind: 'relay-my4n', count: 4 },
    ...(timed ? [{ kind: 'timer-h3y4', count: 1 }] : []),
  ];
  p.description = `${condition}を成立条件とします。${timed ? `条件成立中だけT1を計時し、${presetMs / 1000}秒経過${timerMode === 'delay' ? '後' : '前'}にPL1、${timerMode === 'delay' ? '前' : '後'}にPL2を点灯します。条件が外れたら両灯を消灯して計時をやり直します。短い入力で時間が蓄積しないことも確認してください。` : `成立中はPL1を点灯し、それ以外は消灯してください。${secondary ? 'PL2にはPB4の押下状態を表示します。' : ''}`} PB1〜PB4をそれぞれCR1〜CR4で受け、全16通りを比較してください。`;
  p.schematic = diagram(p.id, p.title, terms, timerMode, presetMs, secondary);
  Object.assign(p, operations(timed ? presetMs + 600 : 800, undefined, timed));
  p.judge.compareSignals = ['PL1', 'PL2', 'PL3', 'PL4'];
  specifications[p.id] = { terms, timerMode: timerMode ?? 'none', presetMs, secondary };
  put(p);
  assembled.push(p);
}
for (let i = 0; i < 4; i++) {
  const p = read('assemble', 'b-009-');
  p.id = idOf('b', 87 + i);
  p.title = `拡張盤の${i + 1}組の押ボタン・表示灯`;
  p.description = `自由練習用拡張盤です。${Array.from({ length: i + 1 }, (_, n) => `PB${n + 5}を押す間だけPL${n + 5}を点灯`).join('、')}してください。中継端子台TB_AUXの同じ番号のa–bは内部接続です。負荷への途中に中継端子を入れ、両側を測定して電圧が変わらないことを確認できます。`;
  p.board.profile = {
    id: 'expanded',
    terminalPairs: 4,
    extraPushButtons: i + 1,
    extraLamps: i + 1,
    rules: FREE_TRAINING_RULES,
  };
  p.schematic.id = `sch-${p.id}`;
  p.schematic.title = p.title;
  p.schematic.rungs = Array.from({ length: i + 1 }, (_, n) => ({
    id: `r${n}`,
    from: { bus: 'P' },
    to: { bus: 'N' },
    cells: [
      { id: `pb${n}`, kind: 'pb-a', device: `PB${n + 5}` },
      { id: `pl${n}`, kind: 'lamp', device: `PL${n + 5}` },
    ],
  }));
  Object.assign(
    p,
    operations(
      700,
      Array.from({ length: i + 1 }, (_, n) => n + 5),
    ),
  );
  p.judge.compareSignals = Array.from({ length: i + 1 }, (_, n) => `PL${n + 5}`);
  put(p);
}
const truths = ['normal', 'a-open', 'a-weld', 'b-open', 'b-weld', 'coil-open', 'coil-layer-short'];
for (let i = 0; i < 18; i++) {
  const p = read('inspect-parts', 'c1-001-');
  p.id = idOf('c1', 37 + i);
  p.title = `${i < 6 ? 'リレー抵抗と接点組の比較' : i < 12 ? 'リレー・タイマの混在点検' : '正常品を含む故障切分け'}・実習${(i % 6) + 1}`;
  p.grade = i < 6 ? 3 : i < 12 ? 2 : 1;
  p.difficulty = i < 6 ? 2 : i < 12 ? 3 : 4;
  p.seed = 2026092300 + i;
  p.description =
    '抵抗値だけで判断せず、コイル、無励磁時のa/b接点、励磁後のa/b接点の順に点検してください。正常な部品も含みます。各部品で異なる接点組を調べ、測定記録に予測と判断を残してください。タイマは設定時間を待ち、励磁直後の未動作を断線と誤判定しないようにします。';
  p.parts = Array.from({ length: 5 + (i % 3) }, (_, n) => {
    const truth = n === 0 ? 'normal' : truths[1 + ((n - 1 + i) % (truths.length - 1))];
    return {
      id: `p${n + 1}`,
      kind:
        i >= 6 && truth !== 'coil-layer-short' && (n + i) % 2 === 0 ? 'timer-h3y4' : 'relay-my4n',
      truth,
      ...(truth.startsWith('a-') || truth.startsWith('b-')
        ? { group: 1 + ((n + Math.floor(i / 3)) % 4) }
        : {}),
      ...(truth === 'coil-layer-short' ? { ratio: [0.4, 0.55, 0.7, 0.85][i % 4] } : {}),
    };
  });
  put(p);
}
const repairs = {};
for (let i = 0; i < 30; i++) {
  const p = clone(
    i < assembled.length
      ? assembled[i]
      : read('assemble', ['b-021-', 'b-022-', 'b-023-', 'b-024-'][i - assembled.length]),
  );
  p.id = idOf('c2', 61 + i);
  p.mode = 'inspect-repair';
  p.grade = i < 15 ? 2 : 1;
  p.difficulty = i < 15 ? 3 : 4;
  p.hints.schematicVisible = p.grade === 2;
  p.title = `${p.title}・${['断線診断', '未配線の復元', '接続先の誤り', 'コイルの診断', '二箇所の切分け'][i % 5]}`;
  p.schematic.id = `sch-${p.id}`;
  p.description +=
    ' 現在は仕様どおり動きません。電源から負荷まで順に測定し、指摘を登録してから修復してください。複数の原因がある場合は一つ直した後も全動作を確認します。';
  p.faults = [{ kind: 'wire-open', target: { wireId: 'sw-001' } }];
  let parsed = parseProblem(p);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed));
  const reference = buildReferenceSession(parsed.problem, JIPM_BOARD);
  if (!reference.ok) throw new Error(JSON.stringify(reference));
  const wire =
    reference.value.session.wires.find((w) => w.to === 'TB_PL.1+' || w.from === 'TB_PL.1+') ??
    reference.value.session.wires[0];
  const kind = ['wire-open', 'wire-missing', 'wire-misrouted', 'coil-open', 'wire-open'][i % 5];
  p.faults =
    kind === 'coil-open'
      ? [{ kind, target: { partId: 'CR1', elementIndex: 0 } }]
      : [
          {
            kind,
            target: { wireId: wire.id },
            ...(kind === 'wire-misrouted' ? { to: 'TB_PL.4+' } : {}),
          },
        ];
  if (i % 5 === 4) p.faults.push({ kind: 'coil-open', target: { partId: 'CR2', elementIndex: 0 } });
  parsed = parseProblem(p);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed));
  const circuit = buildInspectRepairCircuit(parsed.problem, JIPM_BOARD);
  if (!circuit.ok) throw new Error(`${p.id}: ${JSON.stringify(circuit)}`);
  const unfixed = judgeInspectRepair(parsed.problem, JIPM_BOARD, circuit.value, []);
  if (!unfixed.ok || unfixed.value.mismatches.length === 0)
    throw new Error(`${p.id}: 故障が波形に現れません`);
  repairs[p.id] = { faults: p.faults, originalWire: wire };
  put(p);
}
function ladder(terms, timerMode, presetMs, xs, ys) {
  const dev = (kind, index) => ({ kind, index });
  const contact = (kind, index, type = 'NO') => ({
    kind: 'contact',
    type,
    device: dev(kind, index),
  });
  const coil = (kind, index) => ({ kind: 'coil', type: 'OUT', device: dev(kind, index) });
  const networks = terms.map((term, n) => ({
    id: `term${n}`,
    cells: [
      [
        ...term.map((v) => contact('input', xs[Math.abs(v) - 1], v > 0 ? 'NO' : 'NC')),
        coil('internal', n),
      ],
    ],
  }));
  const rows = terms.map((_, n) => [
    contact('internal', n),
    ...(n < terms.length - 1 ? [{ kind: 'vline' }] : []),
  ]);
  rows[0].push(coil('internal', 10));
  networks.push({ id: 'condition', cells: rows });
  if (timerMode) {
    networks.push({
      id: 'timer',
      cells: [
        [
          contact('internal', 10),
          { kind: 'timer', type: 'TON', device: dev('timer', 0), presetMs },
        ],
      ],
    });
    networks.push({
      id: 'output',
      cells: [
        [
          contact('internal', 10),
          contact('timer', 0, timerMode === 'delay' ? 'NO' : 'NC'),
          coil('output', ys[0]),
        ],
      ],
    });
    networks.push({
      id: 'status',
      cells: [
        [
          contact('internal', 10),
          contact('timer', 0, timerMode === 'delay' ? 'NC' : 'NO'),
          coil('output', ys[1]),
        ],
      ],
    });
  } else {
    networks.push({ id: 'output', cells: [[contact('internal', 10), coil('output', ys[0])]] });
    networks.push({ id: 'status', cells: [[contact('input', xs[3]), coil('output', ys[1])]] });
  }
  networks.push({ id: 'end', cells: [[{ kind: 'end' }]] });
  return { networks };
}
const models = [
  ['mitsubishi', 'FX5U'],
  ['jtekt', 'PC10G-1SP'],
  ['omron', 'CP1E'],
  ['sharp', 'JW-300'],
];
for (let i = 0; i < 30; i++) {
  const [vendor, model] = models[i % 4],
    unit = plcUnitFor(model),
    [name, terms, condition] = topics[i % 8];
  const timed = i >= 10,
    timerMode = timed ? (i < 20 ? 'delay' : 'pulse') : undefined,
    presetMs = [500, 1500, 2500][i % 3];
  const p = read('plc', 'd-021-');
  p.id = idOf('d', 61 + i);
  p.title = `PLC ${name}・${unit.displayName}・${timed ? `${presetMs / 1000}秒${timerMode === 'delay' ? '確認' : '初期表示'}` : i < 5 ? '低番地割付' : '高番地割付'}`;
  p.grade = timed ? 1 : 2;
  p.difficulty = timed ? 4 : 3;
  p.plc = { vendor, model };
  const offset = Math.min((Math.floor(i / 4) % 3) * 4, unit.spec.inputs.length - 4);
  const xs = [0, 1, 2, 3].map((n) => n + offset),
    ys = [0, 1].map((n) => (n + (i % 3) * 3) % unit.spec.outputs.length);
  p.io = {
    mode: i % 5 === 0 ? 'free' : 'fixed',
    wiring: i % 2 === 0 ? 'sink' : 'source',
    inputs: xs.map((x, n) => ({ x, pb: `PB${n + 1}` })),
    outputs: ys.map((y, n) => ({ y, cr: `CR${n + 1}`, pl: `PL${n + 1}` })),
  };
  p.description = `${condition}を成立条件とします。${timed ? `成立中に${presetMs / 1000}秒を計時し、経過${timerMode === 'delay' ? '後' : '前'}はPL1、経過${timerMode === 'delay' ? '前' : '後'}はPL2を点灯します。条件が外れたら計時をリセットして消灯してください。` : '成立中はPL1を点灯します。PL2はPB4の押下状態を表示してください。'} I/O表の番号と入力方式を確認し、出力は中継リレーを介して表示灯を駆動します。PLC電源、入力COM、出力COMをそれぞれ確認してください。`;
  p.referenceLadder = ladder(terms, timerMode, presetMs, xs, ys);
  Object.assign(p, operations(timed ? presetMs + 600 : 800, undefined, timed));
  p.judge.compareSignals = ['PL1', 'PL2'];
  specifications[p.id] = { terms, timerMode: timerMode ?? 'none', presetMs, secondary: !timed };
  put(p);
}
let imports = '// build-review-curriculum.mjs から生成。\n';
for (const [mode, list] of Object.entries(modes))
  for (const { id, file } of list)
    imports += `import ${id.replaceAll('-', '_')} from './${mode}/${file}' with { type: 'json' };\n`;
for (const [mode, list] of Object.entries(modes))
  imports += `export const WORKSHOP_${mode.replaceAll('-', '_').toUpperCase()} = [${list.map((item) => item.id.replaceAll('-', '_')).join(', ')}];\n`;
writeFileSync(join(base, 'workshop.ts'), imports);
writeFileSync(
  fileURLToPath(new globalThis.URL('../test/helpers/workshop-specs.json', import.meta.url)),
  JSON.stringify(specifications, null, 2) + '\n',
);
writeFileSync(
  fileURLToPath(new globalThis.URL('../test/helpers/workshop-repairs.json', import.meta.url)),
  JSON.stringify(repairs, null, 2) + '\n',
);
globalThis.console.log(
  Object.fromEntries(Object.entries(modes).map(([mode, rows]) => [mode, rows.length])),
);
