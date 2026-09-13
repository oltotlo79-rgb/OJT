import { describe, expect, it } from 'vitest';
import {
  addWire,
  buildNets,
  canAddWire,
  clampPreset,
  cloneNetlist,
  createLamp,
  createNetlist,
  createPowerSupply,
  createPushButton,
  createRelay4c,
  createTerminalBlockLink,
  createTimer4c,
  createWire,
  IdError,
  partId,
  resetNetlist,
  terminalId,
  toTerminalId,
  validateNetlist,
} from '../src/index.js';
import type { Netlist } from '../src/index.js';
import { net, t, w } from './helpers/circuits.js';

/** リレー・押ボタン・ランプ・電源を電線で結んだ小さなネットリスト。 */
function sampleNetlist(): Netlist {
  return net(
    [
      createRelay4c('CR1'),
      createPushButton('PB1'),
      createLamp('PL1', '白'),
      createPowerSupply('PS'),
    ],
    [
      w('w1', 'PS.+', 'PB1.c'),
      w('w2', 'PB1.a', 'CR1.9'),
      w('w3', 'CR1.5', 'PL1.+'),
      w('w4', 'PL1.-', 'PS.-'),
    ],
  );
}

describe('guards', () => {
  it('toTerminalId は raw文字列を検証して TerminalId にする（§6.4）', () => {
    expect(toTerminalId('CR1.13')).toBe(terminalId('CR1', '13'));
    expect(() => toTerminalId('CR1')).toThrow(IdError);
  });

  it('partId は ":" を含む文字列を拒否する', () => {
    expect(() => partId('CR:1')).toThrow(IdError);
    expect(partId('CR1')).toBe('CR1');
  });

  it('clampPreset は非有限の入力を RangeError にする', () => {
    expect(() => clampPreset(NaN, 10_000)).toThrow(RangeError);
    expect(() => clampPreset(3000, Infinity)).toThrow(RangeError);
  });

  it('clampPreset はレンジ上限が下限未満でも 100ms を下限にする', () => {
    expect(clampPreset(3000, 50)).toBe(100);
  });

  it('clampPreset の既存の丸め結果は変わらない（§5.3.2）', () => {
    expect(clampPreset(3000, 10_000)).toBe(3000);
    expect(clampPreset(0, 10_000)).toBe(100);
    expect(clampPreset(20_000, 10_000)).toBe(10_000);
  });

  it('createTimer4c は非有限の preset を RangeError にする', () => {
    expect(() => createTimer4c('T1', NaN)).toThrow(RangeError);
  });

  it('createNetlist は配列をコピーする（呼び出し元の配列変更に影響されない）', () => {
    const parts = [createRelay4c('CR1')];
    const n = createNetlist(parts);
    parts.push(createLamp('PL1', '白'));
    expect(n.parts.length).toBe(1);
  });

  it('cloneNetlist は深く複製し、複製後の変更は元に影響しない', () => {
    const original = sampleNetlist();
    const clone = cloneNetlist(original);

    const originalNets = buildNets(original);
    const cloneNets = buildNets(clone);
    for (const terminal of originalNets.terminals) {
      expect(cloneNets.nodeOf(terminal)).toBe(originalNets.nodeOf(terminal));
    }

    const clonedContact = clone.parts[0]?.elements.find((e) => e.kind === 'contact');
    if (clonedContact === undefined || clonedContact.kind !== 'contact') {
      throw new Error('CR1 contact not found in clone');
    }
    clonedContact.energized = true;

    const clonedWire = clone.wires[0];
    if (clonedWire === undefined) throw new Error('w1 not found in clone');
    clonedWire.open = true;

    const originalContact = original.parts[0]?.elements.find((e) => e.kind === 'contact');
    if (originalContact === undefined || originalContact.kind !== 'contact') {
      throw new Error('CR1 contact not found in original');
    }
    const originalWire = original.wires[0];
    if (originalWire === undefined) throw new Error('w1 not found in original');

    expect(originalContact.energized).toBe(false);
    expect(originalWire.open).toBe(false);
  });

  it('resetNetlist はランタイム状態のみ戻し、fault は残す', () => {
    const netlist = sampleNetlist();

    const contact = netlist.parts[0]?.elements.find((e) => e.kind === 'contact');
    if (contact === undefined || contact.kind !== 'contact') {
      throw new Error('CR1 contact not found');
    }
    contact.energized = true;

    const source = netlist.parts[3]?.elements[0];
    if (source === undefined || source.kind !== 'source') throw new Error('PS source not found');
    source.enabled = true;

    const load = netlist.parts[2]?.elements[0];
    if (load === undefined || load.kind !== 'load') throw new Error('PL1 load not found');
    load.fault = { kind: 'open' };

    resetNetlist(netlist);

    expect(contact.energized).toBe(false);
    expect(source.enabled).toBe(false);
    expect(load.fault).toEqual({ kind: 'open' });
  });

  it('validateNetlist は正常なネットリストに対し空配列を返す', () => {
    expect(validateNetlist(sampleNetlist())).toEqual([]);
  });

  it('未知の端子を参照する電線は unknown-terminal を報告する', () => {
    const netlist = net(
      [createRelay4c('CR1')],
      [createWire('w9', terminalId('CR1', '15'), terminalId('CR1', '9'))],
    );
    const issues = validateNetlist(netlist);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'unknown-terminal', terminal: 'CR1.15' });
  });

  it('未知の端子を参照するリンクも unknown-terminal として報告する（ownerKind: "link" で区別する）', () => {
    const netlist = net([createRelay4c('CR1')], []);
    netlist.links.push(
      createTerminalBlockLink('lk1', terminalId('CR1', '9'), terminalId('CR1', '99')),
    );
    const issues = validateNetlist(netlist);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'unknown-terminal',
      ownerKind: 'link',
      ownerId: 'lk1',
      terminal: 'CR1.99',
    });
  });

  it('電線IDの重複を duplicate-wire-id として報告する', () => {
    const netlist = net(
      [createPowerSupply('PS'), createLamp('PL1', '白')],
      [w('w1', 'PS.+', 'PL1.+'), w('w1', 'PS.-', 'PL1.-')],
    );
    const issues = validateNetlist(netlist);
    expect(
      issues.some(
        (i) => i.kind === 'duplicate-wire-id' && i.ownerKind === 'wire' && i.ownerId === 'w1',
      ),
    ).toBe(true);
  });

  it('from === to の電線を self-loop-wire として報告する', () => {
    const netlist = net(
      [createRelay4c('CR1')],
      [createWire('w1', terminalId('CR1', '1'), terminalId('CR1', '1'))],
    );
    const issues = validateNetlist(netlist);
    expect(
      issues.some(
        (i) => i.kind === 'self-loop-wire' && i.ownerKind === 'wire' && i.ownerId === 'w1',
      ),
    ).toBe(true);
  });

  it('canAddWire は本数上限（2本）未満かどうかを返す（§6.6）', () => {
    const netlist = net([createPowerSupply('PS'), createLamp('PL1', '白')], []);
    const terminal = t('PS.+');
    expect(canAddWire(netlist, terminal)).toBe(true);
    addWire(netlist, createWire('w1', terminal, t('PL1.+')));
    expect(canAddWire(netlist, terminal)).toBe(true);
    addWire(netlist, createWire('w2', terminal, t('PL1.-')));
    expect(canAddWire(netlist, terminal)).toBe(false);
  });

  it('同じ回路を独立に2回作っても節点番号が一致する（決定論）', () => {
    const netsA = buildNets(sampleNetlist());
    const netsB = buildNets(sampleNetlist());
    expect(netsB.nodeCount).toBe(netsA.nodeCount);
    for (const terminal of netsA.terminals) {
      expect(netsB.nodeOf(terminal)).toBe(netsA.nodeOf(terminal));
    }
  });
});
