import { describe, expect, it } from 'vitest';
import { findPart, Simulation, type PartId, type TerminalId } from '@ojt/circuit-sim';
import {
  addWire,
  BUZZER_ID,
  createSession,
  JIPM_BOARD,
  plug,
  TASK2_SOCKET_ROLES,
  toNetlist,
  type BoardSession,
} from '../src/index.js';

const board = JIPM_BOARD;
const BUZZER_PART_ID = BUZZER_ID as PartId;

function t(id: string): TerminalId {
  return id as TerminalId;
}

function wire(session: BoardSession, from: string, to: string): void {
  const result = addWire(session, board, t(from), t(to));
  if (!result.ok) throw new Error(`${from}-${to}: ${result.message}`);
}

/** 自己保持回路（起動=PB1黒 / 停止=PB2黄 / 保持=CR1 / 表示=PL1白）を session の配線で組む。 */
function selfHoldSession(withRelay: boolean): BoardSession {
  const session = createSession(board);
  if (withRelay) {
    const plugged = plug(session, 'S1', 'relay-my4n');
    if (!plugged.ok) throw new Error(plugged.message);
  }
  wire(session, 'P.1', 'TB_PB.2c');
  wire(session, 'TB_PB.2b', 'TB_PB.1c');
  wire(session, 'TB_PB.1a', 'CR1.14');
  wire(session, 'CR1.13', 'N.1');
  wire(session, 'TB_PB.1c', 'CR1.9');
  wire(session, 'CR1.5', 'CR1.14');
  wire(session, 'TB_PB.2c', 'CR1.10');
  wire(session, 'CR1.6', 'TB_PL.1+');
  wire(session, 'TB_PL.1-', 'CR1.13');
  return session;
}

describe('to-netlist: 盤セッション → ネットリスト', () => {
  it('部品・リンク・電線の構成（§6.4）', () => {
    const session = createSession(board, { roles: TASK2_SOCKET_ROLES });
    const netlist = toNetlist(session, board);
    expect(netlist.parts.map((p) => p.id)).toEqual([
      'PS',
      'P',
      'N',
      'TB_PB',
      'TB_PL',
      'PB1',
      'PB2',
      'PB3',
      'PB4',
      'PL1',
      'PL2',
      'PL3',
      'PL4',
      'CR1',
      'CR2',
      'S3',
      'S4',
      'T1',
      'T2',
      'CHK',
      'S8',
    ]);
    expect(netlist.links).toHaveLength(22);
    expect(netlist.links.every((l) => l.locked)).toBe(true);
    expect(netlist.wires).toHaveLength(3);
    expect(netlist.wires.every((w) => w.locked)).toBe(true);
    expect(findPart(netlist, 'P')?.terminals).toHaveLength(1);
    expect(findPart(netlist, 'TB_PB')?.terminals).toHaveLength(12);
    expect(findPart(netlist, 'TB_PL')?.terminals).toHaveLength(8);
  });

  it('空きソケットは端子だけを持ち、装着すると部品になる（§6.6）', () => {
    const session = createSession(board, { roles: TASK2_SOCKET_ROLES });
    const empty = toNetlist(session, board);
    expect(findPart(empty, 'CR1')?.kind).toBe('terminal-block');
    expect(findPart(empty, 'CR1')?.elements).toHaveLength(0);
    expect(findPart(empty, 'CR1')?.terminals).toHaveLength(14);

    const plugged = plug(session, 'S1', 'relay-my4n');
    expect(plugged.ok).toBe(true);
    const timer = plug(session, 'S5', 'timer-h3y4', { presetMs: 2500 });
    expect(timer.ok).toBe(true);
    const built = toNetlist(session, board);
    expect(findPart(built, 'CR1')?.kind).toBe('relay-my4n');
    expect(findPart(built, 'CR1')?.elements).toHaveLength(9);
    const t1 = findPart(built, 'T1');
    expect(t1?.kind).toBe('timer-h3y4');
    expect(t1?.meta.kind === 'timer-h3y4' ? t1.meta.presetMs : 0).toBe(2500);
  });

  it('BZ は extraParts のときだけ載る（§5.3.4）', () => {
    const plain = createSession(board);
    expect(findPart(toNetlist(plain, board), 'BZ')).toBeUndefined();
    const withBz = createSession(board, { extraParts: [BUZZER_PART_ID] });
    expect(findPart(toNetlist(withBz, board), 'BZ')?.kind).toBe('buzzer');
  });

  it('session で組んだ自己保持回路が Simulation で動く（§14.1 #5）', () => {
    const session = selfHoldSession(true);
    const sim = new Simulation(toNetlist(session, board));
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('off');

    sim.press('PB1');
    sim.run(200);
    sim.release('PB1');
    sim.run(500);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(true);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');

    sim.press('PB2');
    sim.run(600);
    sim.release('PB2');
    sim.run(800);
    expect(sim.state().relays['CR1']?.contactsOn).toBe(false);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('ソケットが空なら同じ配線でも動かない（部品未装着）', () => {
    const session = selfHoldSession(false);
    const sim = new Simulation(toNetlist(session, board));
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.press('PB1');
    sim.run(500);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    expect(sim.state().relays['CR1']).toBeUndefined();
  });

  it('チェック用ソケットの黄色配線は赤PBで励磁する回路になっている（§6.3 / §9.1）', () => {
    const session = createSession(board);
    const plugged = plug(session, 'S7', 'relay-my4n');
    expect(plugged.ok).toBe(true);
    const sim = new Simulation(toNetlist(session, board));
    sim.setBreaker(true);
    sim.setSwitch(true);
    sim.run(100);
    expect(sim.state().relays['CHK']?.contactsOn).toBe(false);
    sim.press('PB4');
    sim.run(200);
    expect(sim.state().relays['CHK']?.contactsOn).toBe(true);
    sim.release('PB4');
    sim.run(300);
    expect(sim.state().relays['CHK']?.contactsOn).toBe(false);
  });
});
