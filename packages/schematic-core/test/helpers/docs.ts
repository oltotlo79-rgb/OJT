import {
  at,
  BUS_N,
  BUS_P,
  coil,
  crA,
  crB,
  createDocument,
  lamp,
  pbA,
  pbB,
  rung,
  tA,
  type SchematicDocument,
} from '../../src/index.js';

/** 自己保持回路（起動=PB1黒 / 停止=PB2黄 / 保持=CR1 / 表示=PL1白）。調査資料 §5.5 */
export function selfHoldDoc(): SchematicDocument {
  return createDocument('b-self-hold', '自己保持回路', [
    rung('r1', BUS_P, BUS_N, [pbB('c1', 'PB2'), pbA('c2', 'PB1'), coil('c3', 'CR1')]),
    rung('r2', at('r1', 1), at('r1', 2), [crA('c4', 'CR1')]),
    rung('r3', BUS_P, BUS_N, [crA('c5', 'CR1'), lamp('c6', 'PL1')]),
  ]);
}

/** インターロック（先行優先）。PB1でCR1、PB2でCR2。互いのb接点で相手を締め出す。§14.1 #6 */
export function interlockDoc(): SchematicDocument {
  return createDocument('b-interlock', 'インターロック回路', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), crB('c2', 'CR2'), coil('c3', 'CR1')]),
    rung('r2', at('r1', 0), at('r1', 1), [crA('c4', 'CR1')]),
    rung('r3', BUS_P, BUS_N, [pbA('c5', 'PB2'), crB('c6', 'CR1'), coil('c7', 'CR2')]),
    rung('r4', at('r3', 0), at('r3', 1), [crA('c8', 'CR2')]),
    rung('r5', BUS_P, BUS_N, [crA('c9', 'CR1'), lamp('c10', 'PL1')]),
    rung('r6', BUS_P, BUS_N, [crA('c11', 'CR2'), lamp('c12', 'PL2')]),
  ]);
}

/** オンディレー（PB1を押している間だけ計時し、3秒でPL1が点灯）。§14.1 #8 */
export function onDelayDoc(): SchematicDocument {
  return createDocument('b-on-delay', 'オンディレー回路', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', 3000)]),
    rung('r2', BUS_P, BUS_N, [tA('c3', 'T1'), lamp('c4', 'PL1')]),
  ]);
}

/**
 * フリッカ（CR2個＋T2個）。§14.1 #11
 * 各タイマの通電断が相手タイマの設定時間ぶん続くため、禁則回路（§5.5）にならない。
 */
export function flickerDoc(): SchematicDocument {
  return createDocument('b-flicker', 'フリッカ回路（リレー併用）', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), crB('c2', 'CR1'), coil('c3', 'T1', 500)]),
    rung('r2', at('r1', 1), BUS_N, [crB('c4', 'CR2'), tA('c5', 'T1'), coil('c6', 'CR1')]),
    rung('r3', at('r2', 1), at('r2', 2), [crA('c7', 'CR1')]),
    rung('r4', at('r1', 1), BUS_N, [crA('c8', 'CR1'), coil('c9', 'T2', 500)]),
    rung('r5', at('r1', 1), BUS_N, [tA('c10', 'T2'), coil('c11', 'CR2')]),
    rung('r6', at('r1', 1), BUS_N, [crA('c12', 'CR1'), lamp('c13', 'PL1')]),
  ]);
}
