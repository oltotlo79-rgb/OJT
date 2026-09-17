import { describe, expect, it } from 'vitest';
import {
  createLamp,
  createPlcUnit,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  injectFault,
  type Simulation,
} from '../src/index.js';
import { bench, powerOn, w } from './helpers/circuits.js';
import { tinySpec } from './helpers/plc.js';

/**
 * 盤（DC24V・PB1・CR1・PL1）＋ PLC のシンク結線。§10.2
 * - 入力: `PS.+ → PLC.SS`、`PLC.X0 → PB1.a`、`PB1.c → PS.-`
 * - 出力: `PS.+ → PLC.COM0`、`PLC.Y0 → CR1.14`、`CR1.13 → PS.-`
 * - 2段結線: `PS.+ → CR1.9`、`CR1.5 → PL1.+`、`PL1.- → PS.-`
 */
function plcBench(): Simulation {
  return bench(
    [
      createPowerSupply('PS'),
      createPushButton('PB1'),
      createRelay4c('CR1'),
      createLamp('PL1', '白'),
      createPlcUnit('PLC', tinySpec()),
    ],
    [
      w('w1', 'PS.+', 'PLC.SS'),
      w('w2', 'PLC.X0', 'PB1.a'),
      w('w3', 'PB1.c', 'PS.-'),
      w('w4', 'PS.+', 'PLC.COM0'),
      w('w5', 'PLC.Y0', 'CR1.14'),
      w('w6', 'CR1.13', 'PS.-'),
      w('w7', 'PS.+', 'CR1.9'),
      w('w8', 'CR1.5', 'PL1.+'),
      w('w9', 'PL1.-', 'PS.-'),
    ],
  );
}

describe('PLC入力の読み取り', () => {
  it('reads OFF while the push button is released', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.step();
    expect(sim.plcInputs('PLC')).toEqual([false, false]);
  });

  it('reads ON when the button closes the input loop (§4.4 / §5.1.3)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.step();
    expect(sim.plcInputs('PLC')).toEqual([true, false]);
    const amps = sim.state().plcs['PLC']?.inputAmps[0] ?? 0;
    // 24V ÷ (4500Ω + 電源0.1Ω + 接点1mΩ) ≒ 5.33mA（ON感度 3.5mA の 1.5 倍）
    expect(amps).toBeCloseTo(0.00533, 5);
  });

  it('keeps the previous state inside the hysteresis band (§5.1.3)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.step();
    expect(sim.plcInputs('PLC')[0]).toBe(true);
    // 接触不良で 6kΩ 直列 → 24V ÷ 10.5kΩ ≒ 2.29mA（1.5mA 超・3.5mA 未満）
    injectFault(sim.netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 6000);
    sim.step();
    expect(sim.state().plcs['PLC']?.inputAmps[0]).toBeCloseTo(0.00229, 5);
    expect(sim.plcInputs('PLC')[0]).toBe(true);
    // 離せば 0mA になり OFF に落ちる
    sim.release('PB1');
    sim.step();
    expect(sim.plcInputs('PLC')[0]).toBe(false);
  });

  it('reads the same ON state with source wiring (§10.2 はどちらでもよい)', () => {
    const sim = bench(
      [createPowerSupply('PS'), createPushButton('PB1'), createPlcUnit('PLC', tinySpec())],
      [w('w1', 'PS.-', 'PLC.SS'), w('w2', 'PLC.X0', 'PB1.a'), w('w3', 'PB1.c', 'PS.+')],
    );
    powerOn(sim);
    sim.press('PB1');
    sim.step();
    expect(sim.plcInputs('PLC')[0]).toBe(true);
    expect(sim.state().plcs['PLC']?.inputAmps[0]).toBeCloseTo(0.00533, 5);
  });
});

describe('PLC出力の駆動', () => {
  it('closes the Y contact and lights the lamp through the board relay (§10.2 の2段結線)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.step();
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.setPlcOutputs('PLC', [true, false]);
    sim.step(); // コイルが励磁される
    expect(sim.state().relays['CR1']?.coilOn).toBe(true);
    sim.step(); // 接点が入る（動作時間1tick）
    // step() は updateLoads → updateRelays → applyContacts の順なので、
    // 接点が入った回の負荷更新は既に終わっている。ランプに反映されるのは次の step
    sim.step();
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.setPlcOutputs('PLC', [false, false]);
    sim.step();
    sim.step();
    sim.step(); // 復帰も同じ理由で3step必要
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('treats a short value array as all-off for the missing points', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.setPlcOutputs('PLC', [true]);
    sim.step();
    expect(sim.state().plcs['PLC']?.outputs).toEqual([true, false]);
  });

  it('records PLC signals in the log (§5.7)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.setPlcOutputs('PLC', [true, false]);
    sim.step();
    expect(sim.log.transitions('PLC.X0').at(-1)?.value).toBe(true);
    expect(sim.log.transitions('PLC.Y0').at(-1)?.value).toBe(true);
    expect(Number(sim.log.transitions('PLC.X0.mA').at(-1)?.value)).toBeCloseTo(5.33, 1);
  });

  it('clears the inputs and outputs on reset', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.press('PB1');
    sim.setPlcOutputs('PLC', [true, true]);
    sim.step();
    sim.reset();
    expect(sim.plcInputs('PLC')).toEqual([false, false]);
    expect(sim.state().plcs['PLC']?.outputs).toEqual([false, false]);
  });

  it('drops the outputs when the PLC is mounted again (mountPart は接点も解放する)', () => {
    const sim = plcBench();
    powerOn(sim);
    sim.setPlcOutputs('PLC', [true, true]);
    sim.step();
    expect(sim.state().plcs['PLC']?.outputs).toEqual([true, true]);
    sim.mountPart(createPlcUnit('PLC', tinySpec()));
    expect(sim.state().plcs['PLC']?.outputs).toEqual([false, false]);
    expect(sim.plcInputs('PLC')).toEqual([false, false]);
  });

  it('refuses to read or write a part that is not a PLC', () => {
    const sim = plcBench();
    expect(() => sim.plcInputs('CR1')).toThrow(/PLC/u);
    expect(() => sim.setPlcOutputs('CR1', [true])).toThrow(/PLC/u);
  });
});
