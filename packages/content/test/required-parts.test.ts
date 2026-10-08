import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  createAssembleLabProblem,
  requiredPartRoles,
} from '../src/index.js';

/**
 * 課題が要求する装着部品の役割（v2.0.0 総点検 Task 2）。
 * 手順帯の「部品装着 済」はこの集合が全部載ったときに付く（在庫の残りでは決めない）。
 */
describe('requiredPartRoles', () => {
  const byId = (id: string) => {
    const found = [
      ...BUILTIN_ASSEMBLE_PROBLEMS,
      ...BUILTIN_PLC_PROBLEMS,
      ...BUILTIN_INSPECT_PARTS_PROBLEMS,
      ...BUILTIN_INSPECT_REPAIR_PROBLEMS,
    ].find((problem) => problem.id === id);
    if (found === undefined) throw new Error(`課題がありません: ${id}`);
    return found;
  };

  it('b-001（自己保持）は CR1 だけ。在庫のタイマは要らない', () => {
    expect(requiredPartRoles(byId('b-001'))).toEqual(['CR1']);
  });

  it('b-004（順次点灯 T1→T2）はリレーと2つのタイマ', () => {
    const roles = requiredPartRoles(byId('b-004'));
    expect(roles).toContain('T1');
    expect(roles).toContain('T2');
    expect(roles[0]).toMatch(/^CR/u);
  });

  it('PLCの課題は I/O 割付の中継リレー', () => {
    expect(requiredPartRoles(byId('d-001'))).toEqual(['CR1', 'CR2', 'CR3']);
  });

  it('部品点検・点検修復・実験は空', () => {
    expect(requiredPartRoles(byId('c1-001'))).toEqual([]);
    expect(requiredPartRoles(byId('c2-001'))).toEqual([]);
    expect(requiredPartRoles(createAssembleLabProblem())).toEqual([]);
  });

  it('全内蔵の回路組立課題で、要求する役割は盤に割り当てられていて在庫の種類に収まる', () => {
    for (const problem of BUILTIN_ASSEMBLE_PROBLEMS) {
      const roles = requiredPartRoles(problem);
      const assigned = new Set(Object.values(problem.board.socketRoles));
      for (const role of roles) expect(assigned.has(role), `${problem.id} ${role}`).toBe(true);
      const relays = roles.filter((role) => role.startsWith('CR')).length;
      const timers = roles.filter((role) => role.startsWith('T')).length;
      const stock = (kind: string): number =>
        problem.inventory.find((item) => item.kind === kind)?.count ?? 0;
      expect(relays, `${problem.id} リレー`).toBeLessThanOrEqual(stock('relay-my4n'));
      expect(timers, `${problem.id} タイマ`).toBeLessThanOrEqual(stock('timer-h3y4'));
    }
  });
});
