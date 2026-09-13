import { describe, expect, it } from 'vitest';
import {
  clearFaults,
  createLamp,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  FaultError,
  findElement,
  findWire,
  injectFault,
  terminalId,
} from '../src/index.js';
import { net, w } from './helpers/circuits.js';

function fixture(): ReturnType<typeof net> {
  return net(
    [
      createPowerSupply('PS'),
      createPushButton('PB1'),
      createRelay4c('CR1'),
      createLamp('PL1', '白'),
    ],
    [w('w1', 'PS.+', 'PB1.c'), w('w2', 'PB1.a', 'CR1.14'), w('w3', 'CR1.13', 'PS.-')],
  );
}

describe('faults', () => {
  it('電線の断線・未配線・誤配線（§5.4）', () => {
    const open = fixture();
    injectFault(open, { wireId: 'w1' }, 'wire-open');
    expect(findWire(open, 'w1')?.open).toBe(true);

    const missing = fixture();
    injectFault(missing, { wireId: 'w1' }, 'wire-missing');
    expect(findWire(missing, 'w1')).toBeUndefined();

    const misrouted = fixture();
    injectFault(misrouted, { wireId: 'w2' }, 'wire-misrouted', terminalId('CR1', '9'));
    expect(findWire(misrouted, 'w2')?.to).toBe('CR1.9');
  });

  it('接点の不導通・溶着・接触不良（§5.4）', () => {
    const netlist = fixture();
    injectFault(netlist, { partId: 'CR1', elementIndex: 1 }, 'contact-open');
    const b1 = findElement(netlist, 'CR1:b1');
    expect(b1?.kind === 'contact' ? b1.fault : undefined).toEqual({ kind: 'open' });

    const resistive = fixture();
    injectFault(resistive, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive');
    const pb = findElement(resistive, 'PB1:a');
    expect(pb?.kind === 'contact' ? pb.fault : undefined).toEqual({ kind: 'resistive', ohms: 500 });
  });

  it('溶着は同じ組のもう一方の接点を機械的に開く（§7.5）', () => {
    const netlist = fixture();
    injectFault(netlist, { partId: 'CR1', elementIndex: 2 }, 'contact-welded');
    const a1 = findElement(netlist, 'CR1:a1');
    const b1 = findElement(netlist, 'CR1:b1');
    const b2 = findElement(netlist, 'CR1:b2');
    expect(a1?.kind === 'contact' ? a1.fault : undefined).toEqual({ kind: 'welded' });
    expect(b1?.kind === 'contact' ? b1.fault : undefined).toEqual({ kind: 'open' });
    expect(b2?.kind === 'contact' ? b2.fault : undefined).toBeUndefined();
  });

  it('コイル断線・レアショート・ランプ断線（§5.1.3 / §5.4）', () => {
    const netlist = fixture();
    injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-layer-short');
    const coil = findElement(netlist, 'CR1:coil');
    expect(coil?.kind === 'load' ? coil.fault : undefined).toEqual({
      kind: 'layerShort',
      ratio: 0.65,
    });
    injectFault(netlist, { partId: 'PL1', elementIndex: 0 }, 'lamp-open');
    const lamp = findElement(netlist, 'PL1:load');
    expect(lamp?.kind === 'load' ? lamp.fault : undefined).toEqual({ kind: 'open' });
  });

  it('対象と種別が合わないときは FaultError（§5.4）', () => {
    const netlist = fixture();
    expect(() => injectFault(netlist, { wireId: 'zz' }, 'wire-open')).toThrow(FaultError);
    expect(() => injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'wire-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { partId: 'ZZ', elementIndex: 0 }, 'coil-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { partId: 'CR1', elementIndex: 99 }, 'coil-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'contact-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { partId: 'CR1', elementIndex: 1 }, 'coil-open')).toThrow(
      FaultError,
    );
    expect(() => injectFault(netlist, { wireId: 'w1' }, 'wire-misrouted')).toThrow(FaultError);
    expect(() => injectFault(netlist, { wireId: 'w1' }, 'contact-open')).toThrow(FaultError);
    expect(() =>
      injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-layer-short', 0.2),
    ).toThrow(FaultError);
    expect(() =>
      injectFault(netlist, { partId: 'PB1', elementIndex: 0 }, 'contact-resistive', 0),
    ).toThrow(FaultError);
  });

  it('故障をまとめて取り消せる', () => {
    const netlist = fixture();
    injectFault(netlist, { wireId: 'w1' }, 'wire-open');
    injectFault(netlist, { partId: 'CR1', elementIndex: 0 }, 'coil-open');
    clearFaults(netlist);
    expect(findWire(netlist, 'w1')?.open).toBe(false);
    const coil = findElement(netlist, 'CR1:coil');
    expect(coil?.kind === 'load' ? coil.fault : undefined).toBeUndefined();
  });
});
