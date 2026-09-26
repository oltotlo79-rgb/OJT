/**
 * v1.7.0 の追加教材（2026-09-26 利用者指示「各問題も増やせる余地があればもう少し増やして」／
 * 同日の決定「各モード+10題」）。組立・部品点検・点検修復・PLC に10題ずつ足す。
 *
 * 既存の題材（論理条件の組合せ・継続確認・先行/後着優先など）と重ならないよう、実務でよく使う
 * 「寸動と連続運転」「運転時間での自動停止」「警報の確認とブザー停止」「長押し起動」「一時停止」
 * 「再起動禁止」などを1題ずつ回路図で書き、同じ動作の PLC 版と故障診断版を作る。
 *
 * 実行（packages/content で）:
 *   node --experimental-transform-types --import ./scripts/ts-source-resolve.js scripts/build-v17-curriculum.mjs
 *
 * 生成した各題は、模範回路の自己判定（組立・PLC）と、故障が波形に現れること（点検修復）を
 * この場で確かめ、満たさなければ書き出さずに止まる。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { JIPM_BOARD } from '@ojt/board-model';
import { parseProblem } from '../src/schema/index.ts';
import { buildReferenceSession } from '../src/reference.ts';
import { judgeReference } from '../src/judge.ts';
import { buildInspectRepairCircuit } from '../src/inspect-repair.ts';
import { judgeInspectRepair } from '../src/judge-inspect.ts';
import { judgePlcReference } from '../src/judge-plc.ts';

const base = fileURLToPath(new globalThis.URL('../src/builtin/', import.meta.url));
const modes = { assemble: [], 'inspect-parts': [], 'inspect-repair': [], plc: [] };
const idOf = (prefix, n) => `${prefix}-${String(n).padStart(3, '0')}`;
const clone = (value) => globalThis.structuredClone(value);

function put(problem) {
  const parsed = parseProblem(problem);
  if (!parsed.ok)
    throw new Error(`${problem.id}: ${JSON.stringify(parsed.issues ?? parsed, null, 2)}`);
  const file = `${problem.id}-v17.json`;
  writeFileSync(join(base, problem.mode, file), JSON.stringify(problem, null, 2) + '\n');
  modes[problem.mode].push({ id: problem.id, file });
  return parsed.problem;
}

/** 押して離す操作（`[開始ms, 押ボタン, 押している長さms]`）を操作列にする。 */
function operationsOf(presses) {
  const ops = [];
  for (const [t, target, hold = 300] of presses) {
    ops.push({ t, target, action: 'press' });
    ops.push({ t: t + hold, target, action: 'release' });
  }
  return ops.sort((a, b) => a.t - b.t || (a.action === 'release' ? -1 : 1));
}

const P = { bus: 'P' };
const N = { bus: 'N' };
const at = (rung, node) => ({ rung, node });

/** 回路図（`[rungId, from, to, [[kind, device, extra?], ...]]` の列）を課題の形にする。 */
function schematicOf(id, title, rungs) {
  let serial = 0;
  return {
    formatVersion: 1,
    id: `sch-${id}`,
    title,
    orientation: 'horizontal',
    rungs: rungs.map(([rid, from, to, cells]) => ({
      id: rid,
      from,
      to,
      cells: cells.map(([kind, device, extra = {}]) => ({
        kind,
        id: `c${String(++serial).padStart(2, '0')}`,
        device,
        ...extra,
      })),
    })),
  };
}

const staticChecks = {
  wireColorRule: true,
  terminalLimit: true,
  unusedParts: true,
  forbiddenCircuit: true,
  coilPolarity: true,
  powerSequence: true,
};

/*
 * 組立の10題。`relays` は使うリレーの数（CR1〜）、`timers` はタイマの数（T1・T2）。
 * `plc` は同じ動作の模範ラダー（出力 Y の数と、ネットワーク）。
 */
const dev = (kind, index) => ({ kind, index });
const no = (kind, index) => ({ kind: 'contact', type: 'NO', device: dev(kind, index) });
const nc = (kind, index) => ({ kind: 'contact', type: 'NC', device: dev(kind, index) });
const out = (kind, index) => ({ kind: 'coil', type: 'OUT', device: dev(kind, index) });
const ton = (index, presetMs) => ({
  kind: 'timer',
  type: 'TON',
  device: dev('timer', index),
  presetMs,
});
const V = { kind: 'vline' };
const H = { kind: 'hline' };
const X = (i) => no('input', i);
const XB = (i) => nc('input', i);
const M = (i) => no('internal', i);
const MB = (i) => nc('internal', i);
const T = (i) => no('timer', i);
const TB = (i) => nc('timer', i);
const Y = (i) => no('output', i);
/** 自己保持（起動 start・停止 stops[]・保持 hold）の2行。 */
const latch = (start, stops, coil, hold) => [[start, V, ...stops, coil], [hold]];

const TOPICS = [
  {
    /*
     * 寸動（インチング）は押ボタンのb接点で自己保持を切る回路だと、離した瞬間にb接点が閉じて
     * リレーが落ち切る前に保持が掛かり直す（リレーの復帰時間の競合）。確実に作れない回路を
     * 課題にしないため、非常停止の保持と復帰を題材にする。
     */
    key: 'emergency',
    title: '非常停止の保持と復帰',
    grade: 2,
    difficulty: 3,
    tags: ['self-hold', 'interlock'],
    relays: 2,
    timers: 0,
    description:
      '黒押ボタン（PB1）で運転を始め、白ランプ（PL1）を自己保持で点灯させなさい。緑押ボタン（PB3）を非常停止とみなし、押されたら運転を止めて赤ランプ（PL4）を点灯し続けること（非常停止の状態を保持する）。非常停止の間はPB1を押しても運転できない。黄押ボタン（PB2）で運転の停止と非常停止の復帰を行う。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['cr-b', 'CR2'],
          ['pb-a', 'PB1'],
          ['coil', 'CR1'],
        ],
      ],
      ['r1h', at('r1', 2), at('r1', 3), [['cr-a', 'CR1']]],
      [
        'r2',
        at('r1', 1),
        N,
        [
          ['pb-a', 'PB3'],
          ['coil', 'CR2'],
        ],
      ],
      ['r2h', at('r1', 1), at('r2', 1), [['cr-a', 'CR2']]],
      [
        'r3',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['lamp', 'PL1'],
        ],
      ],
      [
        'r4',
        P,
        N,
        [
          ['cr-a', 'CR2'],
          ['lamp', 'PL4'],
        ],
      ],
    ],
    presses: [
      [500, 'PB1'],
      [1500, 'PB3'],
      [2500, 'PB1'],
      [3500, 'PB2'],
      [4500, 'PB1'],
      [5500, 'PB2'],
    ],
    durationMs: 6500,
    lamps: ['PL1', 'PL4'],
    ladder: {
      outputs: 2,
      networks: [
        latch(X(0), [XB(1), MB(1)], out('internal', 0), M(0)),
        latch(X(2), [XB(1)], out('internal', 1), M(1)),
        [[M(0), out('output', 0)]],
        [[M(1), out('output', 1)]],
      ],
      comments: {
        X0: '運転（黒）',
        X1: '停止・復帰（黄）',
        X2: '非常停止（緑）',
        M0: '運転',
        M1: '非常停止中',
        Y0: '運転表示 PL1',
        Y1: '非常停止表示 PL2',
      },
      plcDescription:
        '黒押ボタン（PB1）で運転を始め、白ランプ（PL1）を自己保持で点灯させなさい。緑押ボタン（PB3）を非常停止とみなし、押されたら運転を止めて黄ランプ（PL2）を点灯し続けること（非常停止の状態を保持する）。非常停止の間はPB1を押しても運転できない。黄押ボタン（PB2）で運転の停止と非常停止の復帰を行う。',
      lamps: ['PL1', 'PL2'],
    },
    learning: '非常停止の保持と起動の禁止',
    caution: '非常停止中は起動できず、復帰で解除されることを確認',
  },
  {
    key: 'auto-stop',
    title: '運転時間タイマによる自動停止と終了表示',
    grade: 2,
    difficulty: 3,
    tags: ['self-hold', 'timer'],
    relays: 2,
    timers: 1,
    description:
      '黒押ボタン（PB1）で運転を始め、白ランプ（PL1）を点灯させなさい。運転はタイマT1（2秒）で自動的に止め、止まったら黄ランプ（PL2）で「運転終了」を表示し続けること。黄押ボタン（PB2）は運転中なら停止、終了表示中なら表示の消去に使う。途中でPB2を押して止めたときは終了表示を出さない。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['t-b', 'T1'],
          ['pb-a', 'PB1'],
          ['coil', 'CR1'],
        ],
      ],
      ['r1h', at('r1', 2), at('r1', 3), [['cr-a', 'CR1']]],
      [
        'r2',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['coil', 'T1', { presetMs: 2000 }],
        ],
      ],
      [
        'r3',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['lamp', 'PL1'],
        ],
      ],
      [
        'r4',
        at('r1', 1),
        N,
        [
          ['t-a', 'T1'],
          ['coil', 'CR2'],
        ],
      ],
      ['r4h', at('r1', 1), at('r4', 1), [['cr-a', 'CR2']]],
      [
        'r5',
        P,
        N,
        [
          ['cr-a', 'CR2'],
          ['lamp', 'PL2'],
        ],
      ],
    ],
    presses: [
      [500, 'PB1'],
      [3500, 'PB2'],
      [4500, 'PB1'],
      [5500, 'PB2'],
    ],
    durationMs: 7000,
    lamps: ['PL1', 'PL2'],
    ladder: {
      outputs: 2,
      networks: [
        latch(X(0), [XB(1), TB(0)], out('internal', 0), M(0)),
        [[M(0), ton(0, 2000)]],
        [[M(0), out('output', 0)]],
        latch(T(0), [XB(1)], out('internal', 1), M(1)),
        [[M(1), out('output', 1)]],
      ],
      comments: {
        X0: '起動（黒）',
        X1: '停止・表示消去（黄）',
        T0: '運転時間2秒',
        M1: '運転終了',
        Y0: '運転表示 PL1',
        Y1: '終了表示 PL2',
      },
    },
    learning: '限時での自動停止と終了表示の保持',
    caution: '手動停止では終了表示が出ないことを確認',
  },
  {
    key: 'delayed-start',
    title: '起動待ち表示つきの遅延起動',
    grade: 2,
    difficulty: 2,
    tags: ['self-hold', 'timer'],
    relays: 1,
    timers: 1,
    description:
      '黒押ボタン（PB1）を押すと起動準備に入り、黄ランプ（PL2）で「起動待ち」を表示しなさい。1.5秒後（タイマT1）にPL2を消して白ランプ（PL1）を点灯させる。黄押ボタン（PB2）でいつでも停止でき、起動待ちの途中で止めたときはPL1を点灯させないこと。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['pb-a', 'PB1'],
          ['coil', 'CR1'],
        ],
      ],
      ['r1h', at('r1', 1), at('r1', 2), [['cr-a', 'CR1']]],
      [
        'r2',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['coil', 'T1', { presetMs: 1500 }],
        ],
      ],
      [
        'r3',
        P,
        N,
        [
          ['t-a', 'T1'],
          ['lamp', 'PL1'],
        ],
      ],
      [
        'r4',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['t-b', 'T1'],
          ['lamp', 'PL2'],
        ],
      ],
    ],
    presses: [
      [500, 'PB1'],
      [3000, 'PB2'],
      [4000, 'PB1'],
      [4800, 'PB2'],
    ],
    durationMs: 6500,
    lamps: ['PL1', 'PL2'],
    ladder: {
      outputs: 2,
      networks: [
        latch(X(0), [XB(1)], out('internal', 0), M(0)),
        [[M(0), ton(0, 1500)]],
        [[T(0), out('output', 0)]],
        [[M(0), TB(0), out('output', 1)]],
      ],
      comments: {
        X0: '起動（黒）',
        X1: '停止（黄）',
        T0: '起動待ち1.5秒',
        Y0: '運転表示 PL1',
        Y1: '起動待ち PL2',
      },
    },
    learning: '起動待ちの表示と遅延起動',
    caution: '待ち時間の途中で止めたときの動作を確認',
  },
  {
    key: 'alarm-ack',
    title: '警報の確認（ブザー停止）と復帰',
    grade: 1,
    difficulty: 4,
    tags: ['self-hold', 'alarm'],
    relays: 2,
    timers: 0,
    extraParts: ['BZ'],
    description:
      '緑押ボタン（PB3）を「異常信号」とみなす。PB3が押されたら赤ランプ（PL4）を点灯させ、同時にブザー（BZ）を鳴らしなさい（どちらも自己保持）。黒押ボタン（PB1）は「確認」で、押すとブザーだけを止め、PL4は点灯を続けること。黄押ボタン（PB2）で復帰し、PL4を消す。復帰後に再び異常が起きたら、ブザーはもう一度鳴らすこと。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['pb-a', 'PB3'],
          ['coil', 'CR1'],
        ],
      ],
      ['r1h', at('r1', 1), at('r1', 2), [['cr-a', 'CR1']]],
      [
        'r2',
        at('r1', 1),
        N,
        [
          ['cr-a', 'CR1'],
          ['pb-a', 'PB1'],
          ['coil', 'CR2'],
        ],
      ],
      ['r2h', at('r2', 1), at('r2', 2), [['cr-a', 'CR2']]],
      [
        'r3',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['cr-b', 'CR2'],
          ['buzzer', 'BZ'],
        ],
      ],
      [
        'r4',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['lamp', 'PL4'],
        ],
      ],
    ],
    presses: [
      [500, 'PB3'],
      // PLC版の点滅（1秒クロック）が消灯している間に確認する（点灯の途中で切ると一瞬の点灯が残る）
      [1700, 'PB1'],
      [3500, 'PB2'],
      [4500, 'PB3'],
      [5500, 'PB2'],
    ],
    durationMs: 6500,
    lamps: ['PL4', 'BZ'],
    ladder: {
      outputs: 2,
      networks: [
        latch(X(2), [XB(1)], out('internal', 0), M(0)),
        [[X(0), V, M(0), out('internal', 1)], [M(1)]],
        [[M(0), out('output', 0)]],
        [[M(0), MB(1), no('special', 2), out('output', 1)]],
      ],
      comments: {
        X0: '確認（黒）',
        X1: '復帰（黄）',
        X2: '異常信号（緑）',
        M0: '異常発生',
        M1: '確認済み',
        Y0: '異常表示 PL1',
        Y1: '警報点滅 PL2',
      },
      plcDescription:
        '緑押ボタン（PB3）を「異常信号」とみなし、PB3が押されたら白ランプ（PL1）で異常を表示し続け、黄ランプ（PL2）を1秒周期で点滅させて警報しなさい。黒押ボタン（PB1）の「確認」で点滅だけを止め、PL1は点灯を続けること。黄押ボタン（PB2）で復帰してPL1を消す。復帰後に再び異常が起きたら、点滅をもう一度始めること。点滅には1秒クロックの特殊接点を使う。',
    },
    learning: '警報の確認と復帰（ブザー停止）',
    caution: '確認後もランプは残り、復帰後に再警報することを確認',
  },
  {
    key: 'sequence-start',
    title: '条件付きの順序起動',
    grade: 3,
    difficulty: 2,
    tags: ['self-hold', 'sequence'],
    relays: 2,
    timers: 0,
    description:
      '黒押ボタン（PB1）で1号機（白ランプ PL1）を自己保持で運転しなさい。2号機（黄ランプ PL2）は緑押ボタン（PB3）で起動するが、1号機が運転しているときだけ起動できること。1号機が止まっているときにPB3を押しても2号機は動かない。黄押ボタン（PB2）で両方を停止する。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['pb-a', 'PB1'],
          ['coil', 'CR1'],
        ],
      ],
      ['r1h', at('r1', 1), at('r1', 2), [['cr-a', 'CR1']]],
      [
        'r2',
        at('r1', 1),
        N,
        [
          ['cr-a', 'CR1'],
          ['pb-a', 'PB3'],
          ['coil', 'CR2'],
        ],
      ],
      ['r2h', at('r2', 1), at('r2', 2), [['cr-a', 'CR2']]],
      [
        'r3',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['lamp', 'PL1'],
        ],
      ],
      [
        'r4',
        P,
        N,
        [
          ['cr-a', 'CR2'],
          ['lamp', 'PL2'],
        ],
      ],
    ],
    presses: [
      [500, 'PB3'],
      [1500, 'PB1'],
      [2500, 'PB3'],
      [3500, 'PB2'],
      [4500, 'PB3'],
    ],
    durationMs: 5500,
    lamps: ['PL1', 'PL2'],
    ladder: {
      outputs: 2,
      networks: [
        latch(X(0), [XB(1)], out('output', 0), Y(0)),
        [[X(2), V, Y(0), XB(1), out('output', 1)], [Y(1)]],
      ],
      comments: {
        X0: '1号機起動（黒）',
        X1: '停止（黄）',
        X2: '2号機起動（緑）',
        Y0: '1号機 PL1',
        Y1: '2号機 PL2',
      },
    },
    learning: '起動条件つきの順序起動',
    caution: '1号機停止中に2号機を起動できないことを確認',
  },
  {
    key: 'long-press',
    title: '長押しで始動する安全起動',
    grade: 2,
    difficulty: 3,
    tags: ['self-hold', 'timer'],
    relays: 1,
    timers: 1,
    description:
      '誤操作を防ぐため、黒押ボタン（PB1）を1秒以上押し続けたときだけ運転を始め、白ランプ（PL1）を自己保持で点灯させなさい（タイマT1で押している時間を測る）。1秒に満たない短い押し方では始動しないこと。黄押ボタン（PB2）で停止する。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-a', 'PB1'],
          ['coil', 'T1', { presetMs: 1000 }],
        ],
      ],
      [
        'r2',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['t-a', 'T1'],
          ['coil', 'CR1'],
        ],
      ],
      ['r2h', at('r2', 1), at('r2', 2), [['cr-a', 'CR1']]],
      [
        'r3',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['lamp', 'PL1'],
        ],
      ],
    ],
    presses: [
      [500, 'PB1', 400],
      [2000, 'PB1', 1300],
      [4500, 'PB2'],
    ],
    durationMs: 6000,
    lamps: ['PL1'],
    ladder: {
      outputs: 2,
      networks: [
        [[X(0), ton(0, 1000)]],
        latch(T(0), [XB(1)], out('internal', 0), M(0)),
        [[M(0), out('output', 0)]],
        [[X(0), MB(0), out('output', 1)]],
      ],
      comments: {
        X0: '起動（黒・長押し）',
        X1: '停止（黄）',
        T0: '長押し1秒',
        Y0: '運転表示 PL1',
        Y1: '長押し中 PL2',
      },
      plcDescription:
        '誤操作を防ぐため、黒押ボタン（PB1）を1秒以上押し続けたときだけ運転を始め、白ランプ（PL1）を自己保持で点灯させなさい（タイマで押している時間を測る）。1秒に満たない短い押し方では始動しないこと。押している間（運転していないとき）は黄ランプ（PL2）を点灯させて長押し中であることを示す。黄押ボタン（PB2）で停止する。',
      lamps: ['PL1', 'PL2'],
    },
    learning: '押している時間での始動判定',
    caution: '短く押しただけでは始動しないことを確認',
  },
  {
    key: 'pause',
    title: '運転中の一時停止',
    grade: 3,
    difficulty: 2,
    tags: ['self-hold'],
    relays: 1,
    timers: 0,
    description:
      '黒押ボタン（PB1）で運転を始め、白ランプ（PL1）を点灯させなさい（運転状態は自己保持）。緑押ボタン（PB3）を押している間は一時停止としてPL1を消し、黄ランプ（PL2）を点灯させる。PB3を離したら運転を再開すること。黄押ボタン（PB2）で運転を終了する。運転していないときにPB3を押してもPL2は点灯しない。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['pb-a', 'PB1'],
          ['coil', 'CR1'],
        ],
      ],
      ['r1h', at('r1', 1), at('r1', 2), [['cr-a', 'CR1']]],
      [
        'r2',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['pb-b', 'PB3'],
          ['lamp', 'PL1'],
        ],
      ],
      [
        'r3',
        at('r2', 1),
        N,
        [
          ['pb-a', 'PB3'],
          ['lamp', 'PL2'],
        ],
      ],
    ],
    presses: [
      [500, 'PB1'],
      [1500, 'PB3', 1000],
      [3500, 'PB2'],
      [4500, 'PB3', 500],
    ],
    durationMs: 6000,
    lamps: ['PL1', 'PL2'],
    ladder: {
      outputs: 2,
      networks: [
        latch(X(0), [XB(1)], out('internal', 0), M(0)),
        [[M(0), XB(2), out('output', 0)]],
        [[M(0), X(2), out('output', 1)]],
      ],
      comments: {
        X0: '運転（黒）',
        X1: '終了（黄）',
        X2: '一時停止（緑）',
        M0: '運転状態',
        Y0: '運転表示 PL1',
        Y1: '一時停止 PL2',
      },
    },
    learning: '運転状態を保ったままの一時停止',
    caution: '一時停止を離すと運転が再開することを確認',
  },
  {
    key: 'two-hand-start',
    title: '両手同時押しで始動する自己保持',
    grade: 2,
    difficulty: 2,
    tags: ['self-hold', 'and-or'],
    relays: 1,
    timers: 0,
    description:
      '黒押ボタン（PB1）と緑押ボタン（PB3）を両方押したときだけ運転を始め、白ランプ（PL1）を自己保持で点灯させなさい。片方だけを押しても始動しないこと。黄押ボタン（PB2）で停止する。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['pb-a', 'PB1'],
          ['pb-a', 'PB3'],
          ['coil', 'CR1'],
        ],
      ],
      ['r1h', at('r1', 1), at('r1', 3), [['cr-a', 'CR1']]],
      [
        'r2',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['lamp', 'PL1'],
        ],
      ],
    ],
    presses: [
      [500, 'PB1'],
      [1500, 'PB3'],
      [2500, 'PB1', 500],
      [2600, 'PB3', 300],
      [4000, 'PB2'],
    ],
    durationMs: 5500,
    lamps: ['PL1'],
    ladder: {
      outputs: 2,
      networks: [
        [
          [X(0), X(2), V, XB(1), out('internal', 0)],
          [M(0), H],
        ],
        [[M(0), out('output', 0)]],
        [
          [X(0), XB(2), V, MB(0), out('output', 1)],
          [X(2), XB(0)],
        ],
      ],
      comments: {
        X0: '起動（黒）',
        X1: '停止（黄）',
        X2: '起動（緑）',
        M0: '運転',
        Y0: '運転表示 PL1',
        Y1: '片手押し警告 PL2',
      },
      plcDescription:
        '黒押ボタン（PB1）と緑押ボタン（PB3）を両方押したときだけ運転を始め、白ランプ（PL1）を自己保持で点灯させなさい。片方だけを押しても始動しないこと。止まっているときに片方だけを押している間は、黄ランプ（PL2）で「片手押し」を警告する。黄押ボタン（PB2）で停止する。',
      lamps: ['PL1', 'PL2'],
    },
    learning: '両手同時操作での始動',
    caution: '片手だけでは始動しないことを確認',
  },
  {
    key: 'restart-lockout',
    title: '停止後の再起動禁止（3秒）',
    grade: 1,
    difficulty: 4,
    tags: ['self-hold', 'timer', 'interlock'],
    relays: 3,
    timers: 1,
    description:
      '黒押ボタン（PB1）で運転を始め、白ランプ（PL1）を自己保持で点灯させなさい。黄押ボタン（PB2）で停止したら、そこから3秒間（タイマT1）は再起動を受け付けず、その間は黄ランプ（PL2）で「再起動待ち」を表示すること。3秒たったらPL2を消し、PB1で再び起動できるようにする。タイマの接点で自分のコイルを直接切らず、リレー（CR3）を介して待ち状態を解くこと。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['cr-b', 'CR2'],
          ['pb-a', 'PB1'],
          ['coil', 'CR1'],
        ],
      ],
      ['r1h', at('r1', 1), at('r1', 3), [['cr-a', 'CR1']]],
      [
        'r2',
        P,
        N,
        [
          ['pb-a', 'PB2'],
          ['coil', 'CR2'],
        ],
      ],
      [
        'r2h',
        P,
        at('r2', 1),
        [
          ['cr-a', 'CR2'],
          ['cr-b', 'CR3'],
        ],
      ],
      [
        'r3',
        P,
        N,
        [
          ['cr-a', 'CR2'],
          ['coil', 'T1', { presetMs: 3000 }],
        ],
      ],
      [
        'r3c',
        P,
        N,
        [
          ['t-a', 'T1'],
          ['coil', 'CR3'],
        ],
      ],
      [
        'r4',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['lamp', 'PL1'],
        ],
      ],
      [
        'r5',
        P,
        N,
        [
          ['cr-a', 'CR2'],
          ['lamp', 'PL2'],
        ],
      ],
    ],
    presses: [
      [500, 'PB1'],
      [1500, 'PB2'],
      [2500, 'PB1'],
      [5000, 'PB1'],
      [6000, 'PB2'],
    ],
    durationMs: 9500,
    lamps: ['PL1', 'PL2'],
    ladder: {
      outputs: 2,
      networks: [
        [
          [X(0), MB(1), V, XB(1), out('internal', 0)],
          [M(0), H],
        ],
        latch(X(1), [TB(0)], out('internal', 1), M(1)),
        [[M(1), ton(0, 3000)]],
        [[M(0), out('output', 0)]],
        [[M(1), out('output', 1)]],
      ],
      comments: {
        X0: '起動（黒）',
        X1: '停止（黄）',
        T0: '再起動禁止3秒',
        M1: '再起動待ち',
        Y0: '運転表示 PL1',
        Y1: '再起動待ち PL2',
      },
    },
    learning: '停止後の再起動禁止時間',
    caution: '待ち時間中は起動しないことを確認',
  },
  {
    key: 'run-window',
    title: '起動遅延と運転時間を組み合わせた運転',
    grade: 1,
    difficulty: 5,
    tags: ['self-hold', 'multi-timer', 'sequence'],
    relays: 1,
    timers: 2,
    description:
      '黒押ボタン（PB1）で運転を受け付け、1秒間（タイマT1）は黄ランプ（PL2）で準備中を表示しなさい。準備が終わったら白ランプ（PL1）を点灯し、2秒間（タイマT2）運転したら自動的に全体を停止すること。黄押ボタン（PB2）ではいつでも停止できる。自動停止のあとは、もう一度PB1を押せば同じ動作を最初から繰り返す。',
    rungs: [
      [
        'r1',
        P,
        N,
        [
          ['pb-b', 'PB2'],
          ['t-b', 'T2'],
          ['pb-a', 'PB1'],
          ['coil', 'CR1'],
        ],
      ],
      ['r1h', at('r1', 2), at('r1', 3), [['cr-a', 'CR1']]],
      [
        'r2',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['coil', 'T1', { presetMs: 1000 }],
        ],
      ],
      [
        'r3',
        P,
        N,
        [
          ['t-a', 'T1'],
          ['coil', 'T2', { presetMs: 2000 }],
        ],
      ],
      ['r4', at('r3', 1), N, [['lamp', 'PL1']]],
      [
        'r5',
        P,
        N,
        [
          ['cr-a', 'CR1'],
          ['t-b', 'T1'],
          ['lamp', 'PL2'],
        ],
      ],
    ],
    presses: [
      [500, 'PB1'],
      [4500, 'PB1'],
      [6000, 'PB2'],
    ],
    durationMs: 7000,
    lamps: ['PL1', 'PL2'],
    ladder: {
      outputs: 2,
      networks: [
        latch(X(0), [XB(1), TB(1)], out('internal', 0), M(0)),
        [[M(0), ton(0, 1000)]],
        [[T(0), ton(1, 2000)]],
        [[T(0), out('output', 0)]],
        [[M(0), TB(0), out('output', 1)]],
      ],
      comments: {
        X0: '起動（黒）',
        X1: '停止（黄）',
        T0: '準備1秒',
        T1: '運転2秒',
        Y0: '運転表示 PL1',
        Y1: '準備中 PL2',
      },
    },
    learning: '二つのタイマによる準備と運転時間',
    caution: '自動停止後に再起動できることを確認',
  },
];

/** 組立の課題の骨格。 */
function assembleOf(topic, id) {
  const roles = {};
  for (let n = 1; n <= topic.relays; n++) roles[`S${n}`] = `CR${n}`;
  if (topic.timers >= 1) roles.S5 = 'T1';
  if (topic.timers >= 2) roles.S6 = 'T2';
  roles.S7 = 'CHK';
  const inventory = [{ kind: 'relay-my4n', count: topic.relays }];
  if (topic.timers > 0) inventory.push({ kind: 'timer-h3y4', count: topic.timers });
  return {
    formatVersion: 1,
    id,
    mode: 'assemble',
    title: topic.title,
    grade: topic.grade,
    difficulty: topic.difficulty,
    tags: topic.tags,
    description: topic.description,
    timeLimit: { standardMin: topic.grade === 3 ? 30 : topic.grade === 2 ? 40 : 50, cutoffMin: 60 },
    board: {
      boardId: 'board-jipm-std',
      socketRoles: roles,
      ...(topic.extraParts === undefined ? {} : { extraParts: topic.extraParts }),
    },
    inventory,
    schematic: schematicOf(id, topic.title, topic.rungs),
    operations: operationsOf(topic.presses),
    durationMs: topic.durationMs,
    judge: { tolerance: { edgeMs: 200, ratio: 0.1 }, staticChecks },
    hints: { schematicVisible: topic.grade === 3 },
  };
}

// --- 組立（B-091〜100） ---
const assembled = [];
TOPICS.forEach((topic, i) => {
  const problem = put(assembleOf(topic, idOf('b', 91 + i)));
  const judged = judgeReference(problem, JIPM_BOARD);
  if (!judged.ok) throw new Error(`${problem.id}: ${JSON.stringify(judged.errors)}`);
  if (!judged.value.passed) {
    throw new Error(
      `${problem.id}: 模範回路が自分の操作列で合格しません ${JSON.stringify(judged.value.mismatches)}`,
    );
  }
  assembled.push(problem);
});

// --- 点検修復（C2-091〜100）。同じ回路に故障を入れる ---
/** 故障の入れ方（部品の故障は交換、電線の故障は外して白線で張り直す）。 */
const FAULTS = [
  { kind: 'coil-open', partId: 'CR1' },
  { kind: 'wire-open', end: 'TB_PL.2+' },
  { kind: 'contact-open', partId: 'T1', contact: 't-a' },
  { kind: 'coil-open', partId: 'CR2' },
  { kind: 'wire-missing', end: 'TB_PL.2+' },
  { kind: 'contact-open', partId: 'T1', contact: 't-a' },
  { kind: 'wire-open', end: 'TB_PL.2+' },
  { kind: 'contact-welded', partId: 'CR1', contact: 'cr-a' },
  { kind: 'coil-open', partId: 'T1' },
  { kind: 'wire-open', end: 'TB_PL.1+', also: { kind: 'coil-open', partId: 'T2' } },
];
const repairs = {};
/** その部品の、回路図で最初に使った接点の要素番号（コイル0・組1のb=1・組1のa=2）。 */
function elementOfContact(problem, partId, contact) {
  const first = problem.schematic.rungs
    .flatMap((r) => r.cells)
    .find((c) => c.device === partId && ['cr-a', 'cr-b', 't-a', 't-b'].includes(c.kind));
  if (first === undefined || !first.kind.endsWith(contact.slice(-2))) {
    throw new Error(`${problem.id}: ${partId} の最初の接点が ${contact} ではありません`);
  }
  return first.kind.endsWith('-a') ? 2 : 1;
}
function partFault(problem, spec) {
  return spec.contact === undefined
    ? { kind: spec.kind, target: { partId: spec.partId, elementIndex: 0 } }
    : {
        kind: spec.kind,
        target: {
          partId: spec.partId,
          elementIndex: elementOfContact(problem, spec.partId, spec.contact),
        },
      };
}
assembled.forEach((source, i) => {
  const topic = TOPICS[i];
  const p = clone(source);
  p.id = idOf('c2', 91 + i);
  p.mode = 'inspect-repair';
  p.title = `${source.title}の故障診断`;
  p.grade = topic.grade === 1 ? 1 : 2;
  p.difficulty =
    p.grade === 1
      ? topic.difficulty >= 5
        ? 5
        : 4
      : Math.min(4, Math.max(3, topic.difficulty + 1));
  p.tags = [...new Set([...p.tags, 'fault-part', 'measure'])];
  p.hints = { schematicVisible: p.grade === 2 };
  p.schematic.id = `sch-${p.id}`;
  p.description = `${source.description} 現在は指定どおり動きません。通電して押ボタンを操作しながら電圧を測り、故障箇所を3D図の中か一覧から指摘して修復してください（部品不良は故障の内容も選べます）。修復後は全ての操作を確かめます。`;
  const spec = FAULTS[i];
  const faults = [];
  const steps = [];
  const wireFault = (fault) => {
    // 故障を入れる前の回路（＝組立の模範回路）で、どの電線を切るかを決める
    const reference = buildReferenceSession(source, JIPM_BOARD);
    if (!reference.ok) throw new Error(`${p.id}: ${JSON.stringify(reference.errors)}`);
    const wire = reference.value.session.wires.find(
      (w) => w.to === fault.end || w.from === fault.end,
    );
    if (wire === undefined) throw new Error(`${p.id}: ${fault.end} の電線がありません`);
    faults.push({ kind: fault.kind, target: { wireId: wire.id } });
    if (fault.kind === 'wire-open') steps.push({ op: 'remove', wireId: wire.id });
    steps.push({ op: 'add', from: String(wire.from), to: String(wire.to) });
  };
  for (const fault of [spec, ...(spec.also === undefined ? [] : [spec.also])]) {
    if (fault.end !== undefined) wireFault(fault);
    else {
      faults.push(partFault(p, fault));
      steps.push({ op: 'replace', partId: fault.partId });
    }
  }
  p.faults = faults;
  const problem = put(p);
  const circuit = buildInspectRepairCircuit(problem, JIPM_BOARD);
  if (!circuit.ok) throw new Error(`${p.id}: ${JSON.stringify(circuit.errors)}`);
  const unfixed = judgeInspectRepair(problem, JIPM_BOARD, circuit.value, []);
  if (!unfixed.ok || unfixed.value.mismatches.length === 0) {
    throw new Error(`${p.id}: 故障が波形に現れません`);
  }
  repairs[p.id] = steps;
});

// --- PLC（D-091〜100）。同じ動作をラダーで作る。4メーカーを順に使う ---
const VENDORS = [
  ['mitsubishi', 'FX5U'],
  ['jtekt', 'PC10G-1SP'],
  ['omron', 'CP1E'],
  ['sharp', 'JW-300'],
];
TOPICS.forEach((topic, i) => {
  const [vendor, model] = VENDORS[i % VENDORS.length];
  const outputs = topic.ladder.outputs;
  const roles = {};
  for (let n = 1; n <= outputs; n++) roles[`S${n}`] = `CR${n}`;
  roles.S7 = 'CHK';
  const lamps = topic.ladder.lamps ?? topic.lamps.filter((name) => name.startsWith('PL'));
  const plcLamps = Array.from({ length: outputs }, (_, y) => `PL${y + 1}`);
  const networks = topic.ladder.networks.map((rows, n) => ({ id: `n${n + 1}`, cells: rows }));
  networks.push({ id: 'end', cells: [[{ kind: 'end' }]] });
  const p = {
    formatVersion: 1,
    id: idOf('d', 91 + i),
    mode: 'plc',
    title: `PLC ${topic.title}`,
    grade: topic.grade === 3 ? 2 : topic.grade,
    difficulty:
      topic.grade === 1
        ? Math.max(4, topic.difficulty)
        : Math.min(4, Math.max(2, topic.difficulty)),
    tags: topic.tags,
    description: `${topic.ladder.plcDescription ?? topic.description.replace('PL4', 'PL1')} 入力は X0＝黒（PB1）・X1＝黄（PB2）・X2＝緑（PB3）、出力は盤のリレー（CR1〜）を介して表示灯を点けます。PLCの電源は壁コンセントから取ってください。`,
    timeLimit: { standardMin: topic.grade === 1 ? 50 : 40, cutoffMin: 60 },
    board: { boardId: 'board-jipm-std', socketRoles: roles },
    inventory: [{ kind: 'relay-my4n', count: outputs }],
    plc: { vendor, model },
    io: {
      mode: 'fixed',
      wiring: i % 2 === 0 ? 'sink' : 'source',
      inputs: [0, 1, 2].map((x) => ({ x, pb: `PB${x + 1}` })),
      outputs: Array.from({ length: outputs }, (_, y) => ({
        y,
        cr: `CR${y + 1}`,
        pl: `PL${y + 1}`,
      })),
    },
    referenceLadder: { networks, comments: topic.ladder.comments },
    wiringRequired: true,
    operations: operationsOf(topic.presses),
    durationMs: topic.durationMs,
    judge: { compareSignals: plcLamps },
  };
  void lamps;
  const problem = put(p);
  const judged = judgePlcReference(problem, JIPM_BOARD);
  if (!judged.ok) throw new Error(`${p.id}: ${JSON.stringify(judged.errors)}`);
  if (!judged.value.passed) {
    throw new Error(
      `${p.id}: 模範ラダーが自分の操作列で合格しません ${JSON.stringify(judged.value.mismatches)}`,
    );
  }
});

// --- 部品点検（C1-055〜064） ---
const C1_SETS = [
  ['接点組4まで確かめる点検', 3, ['normal', 'a-open', 'normal', 'b-weld'], [4, undefined, 4]],
  [
    'レアショートの程度を比べる',
    3,
    ['normal', 'coil-layer-short', 'coil-layer-short', 'normal'],
    [],
  ],
  [
    'タイマの限時接点を設定時間後に確かめる',
    3,
    ['normal', 'a-open', 'b-open', 'normal'],
    [2, 3],
    'timer',
  ],
  ['正常品の中から一つを見つける', 2, ['normal', 'normal', 'b-open', 'normal', 'normal'], [3]],
  [
    '同じ組のa接点とb接点を両方測る',
    2,
    ['a-weld', 'normal', 'b-open', 'a-open', 'normal'],
    [2, 2, 2],
  ],
  ['溶着と導通不良の組合せ', 2, ['a-weld', 'b-weld', 'normal', 'a-open', 'b-open'], [1, 2, 3, 4]],
  [
    'コイル断線とレアショートの区別',
    2,
    ['coil-open', 'normal', 'coil-layer-short', 'normal', 'coil-open'],
    [],
  ],
  [
    'リレーとタイマの総合点検（7個）',
    1,
    ['normal', 'a-open', 'coil-layer-short', 'b-weld', 'normal', 'coil-open', 'a-weld'],
    [3, 1, 2],
    'mixed',
  ],
  [
    'b接点だけの不良を探す',
    1,
    ['normal', 'b-open', 'normal', 'b-weld', 'b-open', 'normal'],
    [1, 4, 3],
  ],
  [
    '全故障種の最終確認',
    1,
    ['coil-open', 'a-open', 'a-weld', 'b-open', 'b-weld', 'coil-layer-short', 'normal', 'normal'],
    [4, 3, 2, 1],
    'mixed',
  ],
];
C1_SETS.forEach(([name, grade, truths, groups, kinds], i) => {
  let g = 0;
  const parts = truths.map((truth, n) => {
    const contact = truth.startsWith('a-') || truth.startsWith('b-');
    const group = contact ? (groups[g++] ?? 1 + ((n + i) % 4)) : undefined;
    const timer =
      truth !== 'coil-layer-short' &&
      (kinds === 'timer' ? n % 2 === 1 : kinds === 'mixed' ? n % 3 === 1 : false);
    return {
      id: `p${n + 1}`,
      kind: timer ? 'timer-h3y4' : 'relay-my4n',
      truth,
      ...(group === undefined ? {} : { group }),
      ...(truth === 'coil-layer-short' ? { ratio: [0.35, 0.6, 0.8][n % 3] } : {}),
    };
  });
  put({
    formatVersion: 1,
    id: idOf('c1', 55 + i),
    mode: 'inspect-parts',
    title: name,
    grade,
    difficulty: grade === 3 ? 2 : grade === 2 ? 3 : 4,
    tags: ['fault-part', 'measure'],
    description: `部品を一つずつチェック用ソケットに挿して点検し、正常か故障かを判定してください。重点は「${name}」です。コイル抵抗、無励磁時と励磁時のa接点・b接点の順に測り、測定記録に予測と判断を残します。${kinds === 'timer' || kinds === 'mixed' ? 'タイマは設定時間がたってから限時接点を確かめ、励磁直後の未動作を故障と取り違えないこと。' : ''}`,
    timeLimit: { standardMin: grade === 3 ? 20 : 30, cutoffMin: 50 },
    board: { boardId: 'board-jipm-std', socketRoles: { S7: 'CHK' } },
    inventory: [],
    parts,
    seed: 2026092600 + i,
  });
});

// --- 静的 import 一覧と、検査用の修復手順 ---
let imports =
  '// build-v17-curriculum.mjs から生成。教材の条件は同スクリプトを編集してください。\n';
for (const [mode, list] of Object.entries(modes))
  for (const { id, file } of list)
    imports += `import ${id.replaceAll('-', '_')} from './${mode}/${file}' with { type: 'json' };\n`;
for (const [mode, list] of Object.entries(modes))
  imports += `export const V17_${mode.replaceAll('-', '_').toUpperCase()} = [${list.map((e) => e.id.replaceAll('-', '_')).join(', ')}];\n`;
writeFileSync(join(base, 'v17.ts'), imports);
writeFileSync(
  fileURLToPath(new globalThis.URL('../test/helpers/v17-repairs.json', import.meta.url)),
  JSON.stringify(repairs, null, 2) + '\n',
);

// 説明書の課題索引を更新し、追加分の「学ぶこと・注意」をこの教材の言葉で書く
await import('./update-manual-index.mjs');
const manual = fileURLToPath(
  new globalThis.URL('../../../docs/manual/14-tutorial-features.md', import.meta.url),
);
let text = readFileSync(manual, 'utf8');
/** 生成した課題（id → 級・難しさ・題名）。索引の行は毎回この値から作り直す（古い題名を残さない）。 */
const generated = new Map();
for (const [mode, list] of Object.entries(modes)) {
  for (const { id, file } of list) {
    generated.set(id, JSON.parse(readFileSync(join(base, mode, file), 'utf8')));
  }
}
const rowOf = (id, label, learning, caution) => {
  const problem = generated.get(id);
  return `| ${id} | ${label} | ${problem.grade} | ${problem.difficulty} | ${problem.title} | ${learning} | ${caution} |`;
};
const replaceRow = (id, row) => {
  text = text.replace(new RegExp(`^\\| ${id} \\|.*$`, 'mu'), () => row);
};
TOPICS.forEach((topic, i) => {
  for (const [prefix, label, learning, caution] of [
    ['b', 'B', topic.learning, topic.caution],
    ['c2', 'C2', '電圧測定による故障の切り分け', '修復後に全ての操作を再確認'],
    ['d', 'D', `${topic.learning}（ラダー）`, topic.caution],
  ]) {
    const id = idOf(prefix, 91 + i);
    replaceRow(id, rowOf(id, label, learning, caution));
  }
});
C1_SETS.forEach(([name], i) => {
  const id = idOf('c1', 55 + i);
  replaceRow(id, rowOf(id, 'C1', name, '正常品と比べて全接点群を確認'));
});
writeFileSync(manual, text, 'utf8');

const { copyContent } = await import('../../../apps/desktop/scripts/copy-content.mjs');
copyContent(
  base,
  fileURLToPath(new globalThis.URL('../../../apps/desktop/resources/content/', import.meta.url)),
);
globalThis.console.log(
  Object.fromEntries(Object.entries(modes).map(([key, list]) => [key, list.length])),
);
