import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { toTerminalId } from '@ojt/circuit-sim';
import { buildReferenceSession, toPhysicalOverride } from '../src/reference.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

describe('buildReferenceSession', () => {
  it('builds a session, plugs the parts and wires the board', () => {
    const problem = parseOrThrow(selfHoldProblemJson());
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.session.mounted.S1).toEqual({ kind: 'relay-my4n' });
    expect(built.value.roles.S1).toBe('CR1');
    // 既設の固定配線3本（チェック用回路。青・locked。§6.3）＋ 回路図から起こした配線
    expect(built.value.session.wires.filter((w) => w.locked)).toHaveLength(3);
    expect(built.value.session.wires.filter((w) => !w.locked).length).toBeGreaterThan(0);
    expect(built.value.netlist.parts.some((p) => p.id === 'CR1')).toBe(true);
  });

  it('rejects a board whose id does not match the problem', () => {
    const problem = parseOrThrow({
      ...selfHoldProblemJson(),
      board: {
        boardId: 'board-other',
        socketRoles: { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' },
      },
    });
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('board.boardId');
  });

  it('propagates an assignment error as a problem error', () => {
    // CR1 の接点が5個ある回路図（§11.3 の「5個目でエラー」）
    const json = selfHoldProblemJson();
    (json.schematic as { rungs: unknown[] }).rungs = [
      {
        id: 'r1',
        from: { bus: 'P' },
        to: { bus: 'N' },
        cells: [{ kind: 'coil', id: 'c00', device: 'CR1' }],
      },
      {
        id: 'r2',
        from: { bus: 'P' },
        to: { bus: 'N' },
        cells: [
          { kind: 'cr-a', id: 'c01', device: 'CR1' },
          { kind: 'cr-a', id: 'c02', device: 'CR1' },
          { kind: 'cr-a', id: 'c03', device: 'CR1' },
          { kind: 'cr-a', id: 'c04', device: 'CR1' },
          { kind: 'cr-a', id: 'c05', device: 'CR1' },
          { kind: 'lamp', id: 'c06', device: 'PL1' },
        ],
      },
    ];
    const problem = parseOrThrow(json);
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.message).toContain('5個目');
  });

  it('honours physicalOverride', () => {
    const problem = parseOrThrow({
      ...selfHoldProblemJson(),
      physicalOverride: { c03: ['CR1.13', 'CR1.14'] },
    });
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // コイルの左（P側）が 13 に入れ替わっている
    const coilMinus = toTerminalId('CR1.13');
    const coilWire = built.value.session.wires.find(
      (w) => w.to === coilMinus || w.from === coilMinus,
    );
    expect(coilWire).toBeDefined();
  });

  it('converts a physicalOverride record into terminal ids', () => {
    expect(toPhysicalOverride(undefined)).toBeUndefined();
    expect(toPhysicalOverride({ c1: ['CR1.9', 'CR1.5'] })).toEqual({ c1: ['CR1.9', 'CR1.5'] });
  });
});
