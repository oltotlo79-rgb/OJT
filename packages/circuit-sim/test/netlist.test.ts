import { describe, expect, it } from 'vitest';
import {
  addWire,
  buildNets,
  createLamp,
  createNetlist,
  createPowerSupply,
  createTerminalBlockLink,
  createWire,
  exceedsWireLimit,
  findElement,
  findPart,
  findWire,
  NetlistError,
  removeWire,
  terminalId,
  validateNetlist,
  wireCountAt,
} from '../src/index.js';
import { net, t, w } from './helpers/circuits.js';

describe('netlist', () => {
  it('電線とリンクが端子を同一節点に併合する（§5.1）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+')],
    );
    netlist.links.push(createTerminalBlockLink('lk1', t('PL1.-'), t('PS.-')));
    const nets = buildNets(netlist);
    expect(nets.nodeOf(t('PS.+'))).toBe(nets.nodeOf(t('PL1.+')));
    expect(nets.nodeOf(t('PS.-'))).toBe(nets.nodeOf(t('PL1.-')));
    expect(nets.nodeOf(t('PS.+'))).not.toBe(nets.nodeOf(t('PS.-')));
    expect(nets.nodeCount).toBe(2);
    expect(nets.terminalsOf(nets.nodeOf(t('PS.+')))).toContain('PL1.+');
  });

  it('wire-open の電線は併合しない（§5.4）', () => {
    const netlist = net(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+')],
    );
    const wire = findWire(netlist, 'w1');
    expect(wire).toBeDefined();
    if (wire === undefined) throw new Error('w1');
    wire.open = true;
    const nets = buildNets(netlist);
    expect(nets.nodeOf(t('PS.+'))).not.toBe(nets.nodeOf(t('PL1.+')));
  });

  it('未知の端子を引くと NetlistError', () => {
    const nets = buildNets(createNetlist([createPowerSupply('PS')], [], []));
    expect(nets.hasTerminal(terminalId('XX', '1'))).toBe(false);
    expect(() => nets.nodeOf(terminalId('XX', '1'))).toThrow(NetlistError);
    expect(nets.terminalsOf(99)).toEqual([]);
  });

  it('電線の追加・削除と本数の計数（§6.6）', () => {
    const netlist = net([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    addWire(netlist, createWire('w1', t('PS.+'), t('PL1.+')));
    addWire(netlist, createWire('w2', t('PS.+'), t('PL1.-')));
    expect(wireCountAt(netlist, t('PS.+'))).toBe(2);
    expect(exceedsWireLimit(netlist, t('PS.+'))).toBe(false);
    addWire(netlist, createWire('w3', t('PS.+'), t('PS.-')));
    expect(wireCountAt(netlist, t('PS.+'))).toBe(3);
    expect(exceedsWireLimit(netlist, t('PS.+'))).toBe(true);
    expect(() => addWire(netlist, createWire('w3', t('PS.-'), t('PL1.+')))).toThrow(NetlistError);
    expect(removeWire(netlist, 'w3')).toBe(true);
    expect(removeWire(netlist, 'w3')).toBe(false);
    expect(wireCountAt(netlist, t('PS.+'))).toBe(2);
  });

  it('locked の電線は外せない（§6.3）', () => {
    const netlist = net([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    addWire(netlist, createWire('y1', t('PS.+'), t('PL1.+'), '黄', true));
    expect(() => removeWire(netlist, 'y1')).toThrow(NetlistError);
  });

  it('部品・要素を引ける', () => {
    const netlist = net([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    expect(findPart(netlist, 'PL1')?.kind).toBe('lamp');
    expect(findPart(netlist, 'XX')).toBeUndefined();
    expect(findElement(netlist, 'PL1:load')?.kind).toBe('load');
    expect(findElement(netlist, 'nope')).toBeUndefined();
  });

  it('部品IDの重複を duplicate-part-id として報告する（CS-05）', () => {
    // `findPart` は先勝ち、Map経由の読み手は後勝ちになりうるため、この不整合を validateNetlist が拾う。
    const netlist = net([createPowerSupply('PS'), createPowerSupply('PS')], []);
    const issues = validateNetlist(netlist);
    expect(
      issues.some(
        (i) => i.kind === 'duplicate-part-id' && i.ownerKind === 'part' && i.ownerId === 'PS',
      ),
    ).toBe(true);
  });

  it('要素IDの重複を duplicate-element-id として報告する（部品IDが違っても検出する。CS-05）', () => {
    const netlist = net([createPowerSupply('PS1'), createPowerSupply('PS2')], []);
    const second = netlist.parts[1]?.elements[0];
    if (second === undefined) throw new Error('PS2:source not found');
    second.id = 'PS1:source'; // 別部品の要素IDと衝突させる
    const issues = validateNetlist(netlist);
    expect(
      issues.some(
        (i) =>
          i.kind === 'duplicate-element-id' &&
          i.ownerKind === 'element' &&
          i.ownerId === 'PS1:source',
      ),
    ).toBe(true);
  });
});
