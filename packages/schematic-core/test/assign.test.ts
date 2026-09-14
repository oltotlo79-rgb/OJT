import { describe, expect, it } from 'vitest';
import { DEFAULT_SOCKET_ROLES, TASK2_SOCKET_ROLES } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  assignToBoard,
  at,
  BUS_N,
  BUS_P,
  coil,
  crA,
  createDocument,
  deriveSocketRoles,
  lamp,
  pbA,
  requiredRoles,
  rung,
  tA,
  type AssignResult,
} from '../src/index.js';
import { flickerDoc, onDelayDoc, selfHoldDoc } from './helpers/docs.js';

function t(id: string): TerminalId {
  return id as TerminalId;
}

function assigned(result: AssignResult): Extract<AssignResult, { ok: true }> {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' / '));
  return result;
}

describe('assign: 回路図 → 物理割当（§11.3）', () => {
  it('自己保持回路の割当', () => {
    const result = assigned(assignToBoard(selfHoldDoc()));
    expect(result.roles.S1).toBe('CR1');
    expect(result.roles.S7).toBe('CHK');
    expect(result.roles.S8).toBeUndefined();
    expect(result.parts).toEqual([{ socket: 'S1', role: 'CR1', kind: 'relay-my4n' }]);
    expect(result.cells.map((c) => `${c.cellId}:${c.left}-${c.right}`)).toEqual([
      'c1:TB_PB.2c-TB_PB.2b',
      'c2:TB_PB.1c-TB_PB.1a',
      'c3:CR1.14-CR1.13',
      'c4:CR1.9-CR1.5',
      'c5:CR1.10-CR1.6',
      'c6:TB_PL.1+-TB_PL.1-',
    ]);
    // 母線は P.1 / N.1 から鎖状に渡る（供給端子は実機どおり1点ずつ）
    expect(result.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'P.1-TB_PB.2c',
      'TB_PB.2c-CR1.10',
      'TB_PB.2b-TB_PB.1c',
      'TB_PB.1c-CR1.9',
      'TB_PB.1a-CR1.14',
      'CR1.14-CR1.5',
      'N.1-CR1.13',
      'CR1.13-TB_PL.1-',
      'CR1.6-TB_PL.1+',
    ]);
    expect(result.wires.every((w) => w.color === '青')).toBe(true);
    expect(result.wires.map((w) => w.id)).toEqual([
      'sw-001',
      'sw-002',
      'sw-003',
      'sw-004',
      'sw-005',
      'sw-006',
      'sw-007',
      'sw-008',
      'sw-009',
    ]);
  });

  it('接点は出現順に組1〜組4へ1つずつ割り当てる（§11.3）', () => {
    const doc = createDocument('x', '4接点', [
      rung('r1', BUS_P, BUS_N, [pbA('c0', 'PB1'), coil('c1', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c2', 'CR1'), lamp('c3', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL2')]),
      rung('r4', BUS_P, BUS_N, [crA('c6', 'CR1'), lamp('c7', 'PL3')]),
      rung('r5', BUS_P, BUS_N, [crA('c8', 'CR1'), lamp('c9', 'PL4')]),
    ]);
    const result = assigned(assignToBoard(doc));
    const contacts = result.cells.filter((c) => c.device === 'CR1' && c.group > 0);
    expect(contacts.map((c) => `${c.group}:${c.left}-${c.right}`)).toEqual([
      '1:CR1.9-CR1.5',
      '2:CR1.10-CR1.6',
      '3:CR1.11-CR1.7',
      '4:CR1.12-CR1.8',
    ]);
  });

  it('5個目の接点はエラー（§11.3）', () => {
    const doc = createDocument('x', '5接点', [
      rung('r1', BUS_P, BUS_N, [pbA('c0', 'PB1'), coil('c1', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c2', 'CR1'), lamp('c3', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL2')]),
      rung('r4', BUS_P, BUS_N, [crA('c6', 'CR1'), lamp('c7', 'PL3')]),
      rung('r5', BUS_P, BUS_N, [crA('c8', 'CR1'), lamp('c9', 'PL4')]),
      rung('r6', BUS_P, BUS_N, [crA('c10', 'CR1'), coil('c11', 'CR2')]),
    ]);
    const result = assignToBoard(doc);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]).toEqual({
      path: 'c10',
      message: 'CR1 の接点が5個目です（1つの部品の接点は4組までです）',
    });
  });

  it('b接点は COM と NC、a接点は COM と NO（§11.3 / §6.2）', () => {
    const result = assigned(assignToBoard(flickerDoc()));
    const byId = new Map(result.cells.map((c) => [c.cellId, c]));
    expect(byId.get('c2')).toEqual({
      cellId: 'c2',
      device: 'CR1',
      group: 1,
      left: 'CR1.9',
      right: 'CR1.1',
    });
    expect(byId.get('c7')).toEqual({
      cellId: 'c7',
      device: 'CR1',
      group: 2,
      left: 'CR1.10',
      right: 'CR1.6',
    });
    expect(byId.get('c5')).toEqual({
      cellId: 'c5',
      device: 'T1',
      group: 1,
      left: 'T1.9',
      right: 'T1.5',
    });
    expect(byId.get('c3')).toEqual({
      cellId: 'c3',
      device: 'T1',
      group: 0,
      left: 'T1.14',
      right: 'T1.13',
    });
  });

  it('役割割当は既定（8ソケットに7役割）で、明示指定もできる（§6.1）', () => {
    expect(requiredRoles(flickerDoc())).toEqual(['CR1', 'CR2', 'T1', 'T2']);
    expect(deriveSocketRoles()).toEqual(DEFAULT_SOCKET_ROLES);
    const explicit = assigned(assignToBoard(onDelayDoc(), { roles: TASK2_SOCKET_ROLES }));
    expect(explicit.parts).toEqual([
      { socket: 'S5', role: 'T1', kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 },
    ]);
  });

  it('割当が足りない役割指定はエラー', () => {
    const result = assignToBoard(flickerDoc(), {
      roles: { S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S5: 'CHK' },
    });
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.map((e) => e.message)).toEqual([
      '役割が盤に割り当てられていません: T1',
      '役割が盤に割り当てられていません: T2',
    ]);
  });

  it('CR4個とタイマを同時に使う回路図も既定の割当に載る（ソケットは8個）', () => {
    const doc = createDocument('x', '5機器', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c3', 'CR1'), coil('c4', 'CR2')]),
      rung('r3', BUS_P, BUS_N, [crA('c5', 'CR2'), coil('c6', 'CR3')]),
      rung('r4', BUS_P, BUS_N, [crA('c7', 'CR3'), coil('c8', 'CR4')]),
      rung('r5', BUS_P, BUS_N, [crA('c9', 'CR4'), coil('c10', 'T1', 1000)]),
    ]);
    const result = assigned(assignToBoard(doc));
    expect(result.parts.map((p) => `${p.socket}:${p.role}`)).toEqual([
      'S1:CR1',
      'S2:CR2',
      'S3:CR3',
      'S4:CR4',
      'S5:T1',
    ]);
  });

  it('physicalOverride が既定規則より優先される（§7.2 / §11.3）', () => {
    const result = assigned(
      assignToBoard(selfHoldDoc(), {
        physicalOverride: { c5: [t('CR1.12'), t('CR1.8')] },
        color: '白',
      }),
    );
    const overridden = result.cells.find((c) => c.cellId === 'c5');
    expect(overridden?.left).toBe('CR1.12');
    expect(overridden?.right).toBe('CR1.8');
    expect(result.wires.every((w) => w.color === '白')).toBe(true);

    const broken = assignToBoard(selfHoldDoc(), { physicalOverride: { c5: [t('CR1.12')] } });
    if (broken.ok) throw new Error('unreachable');
    expect(broken.errors[0]?.message).toBe('physicalOverride は端子2つを指定します: c5');
  });

  it('構造エラーのある文書は割当しない', () => {
    const doc = createDocument('x', '負荷なし', [rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1')])]);
    const result = assignToBoard(doc);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]?.path).toBe('rungs[0]');
  });

  it('コイルの無いタイマは既定の設定時間で装着する', () => {
    const doc = createDocument('x', 'コイルなし', [
      rung('r1', BUS_P, BUS_N, [tA('c1', 'T1'), lamp('c2', 'PL1')]),
    ]);
    const result = assigned(assignToBoard(doc));
    expect(result.parts).toEqual([
      { socket: 'S5', role: 'T1', kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 },
    ]);
  });

  it('母線は P.1 / N.1 から鎖状に渡り、どの端子も2本以内に収まる（§11.3 / 調査資料 §4.5）', () => {
    const result = assigned(assignToBoard(flickerDoc()));
    const count = new Map<string, number>();
    for (const w of result.wires) {
      for (const id of [w.from, w.to]) count.set(id, (count.get(id) ?? 0) + 1);
    }
    // チェック用の既設配線が P.1 / N.1 / TB_PB.4c / TB_PB.4a / CHK.13 / CHK.14 を各1本使う
    for (const [id, n] of count) {
      const preUsed = ['P.1', 'N.1'].includes(id) ? 1 : 0;
      expect(n + preUsed).toBeLessThanOrEqual(2);
    }
    expect(count.get('P.1')).toBe(1);
    expect(count.get('N.1')).toBe(1);
    // N側は鎖なので、母線に集まる5端子が1本の鎖で結ばれる
    const nChain = result.wires.filter((w) => w.from === t('N.1') || w.to === t('N.1'));
    expect(nChain).toHaveLength(1);
  });

  it('チェック用の既設配線（青）がある端子を渡り配線に使うと上限超過になる（§6.3 / §6.6）', () => {
    // `TB_PB.4c` には既に既設配線（青）が1本つながっている。中継点として使うと3本目になる。
    const doc = createDocument('x', '端子超過', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), pbA('c2', 'PB4'), coil('c3', 'CR1')]),
      rung('r2', BUS_P, at('r1', 1), [crA('c4', 'CR1')]),
    ]);
    const result = assignToBoard(doc);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]).toEqual({
      path: 'TB_PB.4c',
      message: '1端子に3本つながります（上限は2本）: TB_PB.4c',
    });
  });
});
