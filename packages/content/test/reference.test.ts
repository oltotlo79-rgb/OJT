import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { toTerminalId } from '@ojt/circuit-sim';
import { buildReferenceSession, toPhysicalOverride, toProblemPath } from '../src/reference.js';
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

  it('adds the optional parts the problem asks for (§5.3.4)', () => {
    const json = selfHoldProblemJson();
    const board = json.board as Record<string, unknown>;
    const problem = parseOrThrow({ ...json, board: { ...board, extraParts: ['BZ'] } });
    const built = buildReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.netlist.parts.some((p) => p.id === 'BZ')).toBe(true);
  });
});

describe('buildReferenceSession — エラーのパス (§13 #2)', () => {
  it('points at the cell of the schematic that could not be assigned', () => {
    // CR1 の接点が5個ある回路図。5個目の要素 `c05` は rungs[1].cells[4]
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
    const built = buildReferenceSession(parseOrThrow(json), JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('schematic.rungs[1].cells[4]');
  });

  it('points at the socket roles when a role the schematic needs is missing', () => {
    const json = selfHoldProblemJson();
    const board = json.board as Record<string, unknown>;
    const built = buildReferenceSession(
      parseOrThrow({ ...json, board: { ...board, socketRoles: { S7: 'CHK' } } }),
      JIPM_BOARD,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('board.socketRoles');
  });

  it('points at the inventory when a part cannot be plugged', () => {
    const built = buildReferenceSession(
      parseOrThrow({ ...selfHoldProblemJson(), inventory: [] }),
      JIPM_BOARD,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('inventory');
  });

  it('keeps a physicalOverride path as it is', () => {
    const built = buildReferenceSession(
      parseOrThrow({
        ...selfHoldProblemJson(),
        physicalOverride: { c99: ['CR1.13', 'CR1.14'] },
      }),
      JIPM_BOARD,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('physicalOverride.c99');
  });

  it('falls back to the schematic itself for anything else (§13 #1)', () => {
    // `sw-003` は盤の電線IDであって課題JSONのキーではないので、`schematic.sw-003` と書くと
    // 存在しない場所を指してしまう。読み手が開ける一番近い場所（回路図）を指す。
    const problem = parseOrThrow(selfHoldProblemJson());
    expect(toProblemPath(problem, 'sw-003')).toBe('schematic');
    expect(toProblemPath(problem, 'c03')).toBe('schematic.rungs[0].cells[2]');
  });
});
