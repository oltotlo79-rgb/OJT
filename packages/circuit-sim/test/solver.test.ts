import { describe, expect, it } from 'vitest';
import {
  buildNets,
  createLamp,
  createNetlist,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  solve,
  terminalId,
  voltageAt,
} from '../src/index.js';
import type { Netlist } from '../src/index.js';
import { net, t, w } from './helpers/circuits.js';

function energize(netlist: Netlist, on: boolean): void {
  for (const part of netlist.parts) {
    for (const el of part.elements) if (el.kind === 'source') el.enabled = on;
  }
}

describe('solver', () => {
  it('コイル1個の回路を解く（§5.1.3 の 36.9mA）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    energize(netlist, true);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);
    expect(voltageAt(result, nets, t('PS.+'))).toBeCloseTo(23.996, 2);
    expect(voltageAt(result, nets, t('PS.-'))).toBeCloseTo(0, 6);
    expect(result.elementVolts.get('CR1:coil') ?? 0).toBeCloseTo(23.996, 2);
    expect(result.sourceAmps).toBeCloseTo(0.0369, 3);
  });

  it('非通電の電源は行列に寄与しない', () => {
    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);
    expect(result.sourceAmps).toBe(0);
    expect(voltageAt(result, nets, t('PS.+'))).toBeCloseTo(0, 9);
  });

  it('P–N直結では内部抵抗0.1Ωで240Aが流れる（§5.1.1）', () => {
    const netlist = net([createPowerSupply('PS')], [w('short', 'PS.+', 'PS.-')]);
    energize(netlist, true);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);
    expect(result.sourceAmps).toBeCloseTo(240, 6);
  });

  it('開いた接点は導通しない（§5.2）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createPushButton('PB1'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'PL1.+'), w('w3', 'PL1.-', 'PS.-')],
    );
    energize(netlist, true);
    const nets = buildNets(netlist);
    expect(solve(netlist, nets).elementAmps.get('PL1:load') ?? 1).toBeCloseTo(0, 6);
    const pb = netlist.parts[1]?.elements[0];
    if (pb?.kind !== 'contact') throw new Error('PB1:a');
    pb.energized = true;
    const closed = solve(netlist, buildNets(netlist));
    expect(closed.elementAmps.get('PL1:load') ?? 0).toBeCloseTo(0.01, 3);
  });

  it('電源が無いネットリストでも解ける', () => {
    const netlist = net([createLamp('PL1', '白')], [w('w1', 'PL1.+', 'PL1.-')]);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets);
    expect(result.sourceAmps).toBe(0);
    expect(result.referenceNode).toBe(0);
    expect(solve(createNetlist(), buildNets(createNetlist())).nodeVoltages).toEqual([]);
  });

  it('基準端子を指定でき、ネットリストに無い端子の電位は0', () => {
    const netlist = net(
      [createPowerSupply('PS'), createRelay4c('CR1')],
      [w('w1', 'PS.+', 'CR1.14'), w('w2', 'CR1.13', 'PS.-')],
    );
    energize(netlist, true);
    const nets = buildNets(netlist);
    const result = solve(netlist, nets, { reference: t('PS.+') });
    expect(voltageAt(result, nets, t('PS.+'))).toBeCloseTo(0, 9);
    expect(voltageAt(result, nets, t('PS.-'))).toBeCloseTo(-23.996, 2);
    expect(voltageAt(result, nets, terminalId('XX', '1'))).toBe(0);
  });
});
