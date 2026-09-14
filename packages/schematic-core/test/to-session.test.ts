import { describe, expect, it } from 'vitest';
import { JIPM_BOARD, toNetlist, type BoardSession } from '@ojt/board-model';
import { Simulation, type TerminalId } from '@ojt/circuit-sim';
import {
  BUS_N,
  BUS_P,
  buzzer,
  createDocument,
  pbA,
  rung,
  toSession,
  type SchematicDocument,
  type ToSessionOptions,
} from '../src/index.js';
import { flickerDoc, interlockDoc, onDelayDoc, selfHoldDoc } from './helpers/docs.js';

const board = JIPM_BOARD;

function build(doc: SchematicDocument, options?: ToSessionOptions): BoardSession {
  const result = toSession(doc, board, options);
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join(' / '));
  return result.session;
}

function powered(session: BoardSession): Simulation {
  const sim = new Simulation(toNetlist(session, board));
  sim.setBreaker(true);
  sim.setSwitch(true);
  return sim;
}

describe('to-session: 回路図 → 盤セッション → ネットリスト → シミュレーション', () => {
  it('割当どおりに装着と配線が入る（§11.3）', () => {
    const session = build(selfHoldDoc());
    expect(session.mounted.S1).toEqual({ kind: 'relay-my4n' });
    // 既設の配線（青）3本 ＋ 生成した9本
    expect(session.wires).toHaveLength(12);
    expect(session.wires.filter((w) => !w.locked)).toHaveLength(9);
    expect(session.allowedColors).toEqual(['青']);
  });

  it('盤の電線IDは割当の電線IDと同じ（Phase 1D の突き合わせ鍵。§11.3）', () => {
    const result = toSession(selfHoldDoc(), board);
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' / '));
    const trainee = result.session.wires.filter((w) => !w.locked);
    expect(trainee.map((w) => w.id)).toEqual(result.assignment.wires.map((w) => w.id));
    for (const spec of result.assignment.wires) {
      const wire = result.session.wires.find((w) => w.id === spec.id);
      expect(wire).toMatchObject({ from: spec.from, to: spec.to, color: spec.color });
    }
  });

  it('自己保持回路が動く（§14.1 #5）', () => {
    const sim = powered(build(selfHoldDoc()));
    sim.run(100);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
    sim.press('PB1');
    sim.run(200);
    sim.release('PB1');
    sim.run(500);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    sim.press('PB2');
    sim.run(600);
    sim.release('PB2');
    sim.run(800);
    expect(sim.state().lamps['PL1']?.level).toBe('off');
  });

  it('インターロック回路が動く（先行優先。§14.1 #6）', () => {
    const sim = powered(build(interlockDoc()));
    sim.run(100);
    sim.press('PB1');
    sim.run(200);
    sim.release('PB1');
    sim.run(400);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    expect(sim.state().lamps['PL2']?.level).toBe('off');
    sim.press('PB2');
    sim.run(600);
    sim.release('PB2');
    sim.run(800);
    expect(sim.state().lamps['PL1']?.level).toBe('lit');
    expect(sim.state().lamps['PL2']?.level).toBe('off');
  });

  it('オンディレー回路が3秒で点灯する（§14.1 #8）', () => {
    const sim = powered(build(onDelayDoc()));
    sim.press('PB1');
    sim.run(4000);
    const on = sim.log.transitions('PL1').find((e) => e.value === true)?.tMs;
    expect(on).toBeDefined();
    expect(Math.abs((on ?? 0) - 3000)).toBeLessThanOrEqual(20);
  });

  it('フリッカ回路が周期的に点滅し、チャタリングしない（§14.1 #11 / §5.5）', () => {
    const session = build(flickerDoc());
    expect(session.mounted.S5).toEqual({
      kind: 'timer-h3y4',
      presetMs: 500,
      rangeMaxMs: 10_000,
    });
    const sim = powered(session);
    sim.press('PB1');
    sim.run(4000);
    const edges = sim.log.transitions('PL1').filter((e) => e.tMs > 0);
    expect(edges.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < edges.length; i += 1) {
      const gap = (edges[i]?.tMs ?? 0) - (edges[i - 1]?.tMs ?? 0);
      expect(gap).toBeGreaterThan(400);
      expect(gap).toBeLessThan(700);
    }
    expect(sim.events.chatters()).toHaveLength(0);
  });

  it('ブザーを使う回路図は BZ を自動で盤に載せる（§5.3.4）', () => {
    const doc = createDocument('b-bz', 'ブザー', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), buzzer('c2')]),
    ]);
    const session = build(doc);
    expect(session.extraParts).toEqual(['BZ']);
    const sim = powered(session);
    sim.press('PB1');
    sim.run(200);
    expect(sim.state().lamps['BZ']?.level).toBe('lit');
  });

  it('割当に失敗した回路図はエラーを返す', () => {
    const doc = createDocument('x', '負荷なし', [rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1')])]);
    const result = toSession(doc, board);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors).toHaveLength(1);
  });

  it('在庫が足りなければ装着エラーになる（§7.1）', () => {
    const result = toSession(selfHoldDoc(), board, {
      inventory: [{ kind: 'relay-my4n', count: 0 }],
    });
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]?.path).toBe('CR1');
  });

  it('配線できない端子を physicalOverride で指すと配線エラーになる（§6.4）', () => {
    const result = toSession(selfHoldDoc(), board, {
      physicalOverride: { c1: ['PB2.c' as TerminalId, 'PB2.b' as TerminalId] },
    });
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]?.message).toContain('この端子には配線できません');
  });
});
