// このファイルは scripts/build-lab-templates.mjs が生成する。手で書き換えないこと。
import type { LabTemplate } from './lab-chart.js';

/** 実験の例題（内蔵課題の模範を元の操作で動かした結果）。設計 §4.3 */
export const LAB_TEMPLATES: readonly LabTemplate[] = [
  {
    id: 'self-hold',
    mode: 'assemble-lab',
    title: '自己保持（運転・停止）',
    description: 'PB1を押すとPL1が点灯し、離しても点灯が続きます。PB2を押すと消えます。',
    source: 'b-001',
    operations: [
      {
        t: 500,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 800,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 3000,
        target: 'PB2',
        action: 'press',
      },
      {
        t: 3300,
        target: 'PB2',
        action: 'release',
      },
    ],
    durationMs: 5000,
    expected: [
      {
        signal: 'PL1',
        on: [[520, 3020]],
      },
    ],
  },
  {
    id: 'interlock',
    mode: 'assemble-lab',
    title: 'インターロック（先行優先）',
    description:
      'PB1でPL1、PB2でPL2が点灯したままになります。先に点灯した側が優先し、もう一方は点灯しません。PB3で両方消えます。',
    source: 'b-002',
    operations: [
      {
        t: 500,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 800,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 1500,
        target: 'PB2',
        action: 'press',
      },
      {
        t: 1800,
        target: 'PB2',
        action: 'release',
      },
      {
        t: 3000,
        target: 'PB3',
        action: 'press',
      },
      {
        t: 3300,
        target: 'PB3',
        action: 'release',
      },
      {
        t: 4500,
        target: 'PB2',
        action: 'press',
      },
      {
        t: 4800,
        target: 'PB2',
        action: 'release',
      },
      {
        t: 5500,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 5800,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 6500,
        target: 'PB3',
        action: 'press',
      },
      {
        t: 6800,
        target: 'PB3',
        action: 'release',
      },
    ],
    durationMs: 8000,
    expected: [
      {
        signal: 'PL1',
        on: [[520, 3020]],
      },
      {
        signal: 'PL2',
        on: [[4520, 6520]],
      },
    ],
  },
  {
    id: 'on-delay',
    mode: 'assemble-lab',
    title: 'オンディレー（遅れて点灯）',
    description:
      'PB1を押してから3秒後にPL1が点灯します。PB2で消えます（タイマ T1 を3秒に設定します）。',
    source: 'b-003',
    operations: [
      {
        t: 500,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 800,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 6000,
        target: 'PB2',
        action: 'press',
      },
      {
        t: 6300,
        target: 'PB2',
        action: 'release',
      },
    ],
    durationMs: 8000,
    expected: [
      {
        signal: 'PL1',
        on: [[3520, 6030]],
      },
    ],
  },
  {
    id: 'one-shot',
    mode: 'assemble-lab',
    title: 'ワンショット（一定時間点灯）',
    description:
      'PB1を押すとPL1が1.5秒だけ点灯して自動的に消えます。消えた後にもう一度押すと、同じように点灯します。',
    source: 'b-005',
    operations: [
      {
        t: 500,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 800,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 3000,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 3300,
        target: 'PB1',
        action: 'release',
      },
    ],
    durationMs: 6000,
    expected: [
      {
        signal: 'PL1',
        on: [
          [520, 2040],
          [3020, 4540],
        ],
      },
    ],
  },
  {
    id: 'self-hold',
    mode: 'plc-lab',
    title: '自己保持（運転・停止）',
    description:
      'PB1で運転を始め（PL1が点灯したまま）、PB2で止めます。PB2を押している間、運転していなければPL2が点灯し、PB3を押している間だけPL3が点灯します。',
    source: 'd-001',
    operations: [
      {
        t: 500,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 800,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 2000,
        target: 'PB3',
        action: 'press',
      },
      {
        t: 2300,
        target: 'PB3',
        action: 'release',
      },
      {
        t: 4000,
        target: 'PB2',
        action: 'press',
      },
      {
        t: 4300,
        target: 'PB2',
        action: 'release',
      },
    ],
    durationMs: 6000,
    expected: [
      {
        signal: 'PL1',
        on: [[530, 4030]],
      },
      {
        signal: 'PL2',
        on: [[4030, 4330]],
      },
      {
        signal: 'PL3',
        on: [[2030, 2330]],
      },
    ],
  },
  {
    id: 'interlock',
    mode: 'plc-lab',
    title: 'インターロック（先行優先）',
    description:
      'PB1で正転（PL1）、PB2で逆転（PL2）し、PB3で止めます。動いている間はもう一方を入れられません。PB3を押している間、どちらも動いていなければPL3が点灯します。',
    source: 'd-002',
    operations: [
      {
        t: 500,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 800,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 2000,
        target: 'PB2',
        action: 'press',
      },
      {
        t: 2300,
        target: 'PB2',
        action: 'release',
      },
      {
        t: 4000,
        target: 'PB3',
        action: 'press',
      },
      {
        t: 4300,
        target: 'PB3',
        action: 'release',
      },
      {
        t: 5500,
        target: 'PB2',
        action: 'press',
      },
      {
        t: 5800,
        target: 'PB2',
        action: 'release',
      },
      {
        t: 7000,
        target: 'PB3',
        action: 'press',
      },
      {
        t: 7300,
        target: 'PB3',
        action: 'release',
      },
    ],
    durationMs: 8000,
    expected: [
      {
        signal: 'PL1',
        on: [[530, 4030]],
      },
      {
        signal: 'PL2',
        on: [[5530, 7030]],
      },
      {
        signal: 'PL3',
        on: [
          [4030, 4330],
          [7030, 7330],
        ],
      },
    ],
  },
  {
    id: 'on-delay',
    mode: 'plc-lab',
    title: 'オンディレー（遅れて点灯）',
    description:
      'PB1で起動し、3秒後にPL1が点灯します。計時中はPL2が点灯し、PB2で止めます。PB3を押している間だけPL3が点灯します。',
    source: 'd-003',
    operations: [
      {
        t: 500,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 800,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 6000,
        target: 'PB2',
        action: 'press',
      },
      {
        t: 6300,
        target: 'PB2',
        action: 'release',
      },
      {
        t: 7000,
        target: 'PB3',
        action: 'press',
      },
      {
        t: 7300,
        target: 'PB3',
        action: 'release',
      },
    ],
    durationMs: 8000,
    expected: [
      {
        signal: 'PL1',
        on: [[3520, 6030]],
      },
      {
        signal: 'PL2',
        on: [[530, 3520]],
      },
      {
        signal: 'PL3',
        on: [[7030, 7330]],
      },
    ],
  },
  {
    id: 'one-shot',
    mode: 'plc-lab',
    title: 'ワンショット（一定時間点灯）',
    description:
      'PB1を押した瞬間から1秒間だけPL1が点灯します。長押ししても1秒で消え、PB2を押している間は起動しません。PB3を押している間はPL2が点灯し、PL3は1秒ごとに点滅します。',
    source: 'd-004',
    operations: [
      {
        t: 500,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 600,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 3000,
        target: 'PB1',
        action: 'press',
      },
      {
        t: 5000,
        target: 'PB1',
        action: 'release',
      },
      {
        t: 5500,
        target: 'PB3',
        action: 'press',
      },
      {
        t: 6500,
        target: 'PB3',
        action: 'release',
      },
    ],
    durationMs: 7000,
    expected: [
      {
        signal: 'PL1',
        on: [
          [530, 1520],
          [3030, 4020],
        ],
      },
      {
        signal: 'PL2',
        on: [[5530, 6530]],
      },
      {
        signal: 'PL3',
        on: [[6020, 6520]],
      },
    ],
  },
];
