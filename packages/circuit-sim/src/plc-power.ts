import { terminalId, type TerminalId } from './ids.js';
import type { Nets } from './netlist.js';

export interface PlcPowerIssue {
  code: 'missing' | 'same-net' | 'board-power' | 'wrong-source';
  terminals: readonly TerminalId[];
  message: string;
}
export interface PlcPowerStatus {
  ready: boolean;
  issues: readonly PlcPowerIssue[];
}

/** The training model's AC supply contract. This is connectivity, not an AC voltage solver. */
export function checkPlcSupply(
  nets: Nets,
  power: readonly [TerminalId, TerminalId],
): PlcPowerStatus {
  const issues: PlcPowerIssue[] = [];
  const members = (id: TerminalId): readonly TerminalId[] =>
    nets.hasTerminal(id) ? nets.terminalsOf(nets.nodeOf(id)) : [];
  const [line, neutral] = power;
  if (members(line).includes(neutral))
    issues.push({
      code: 'same-net',
      terminals: power,
      message: `${line} と ${neutral} が短絡しています。LとNは別々に配線してください。`,
    });
  power.forEach((id, index) => {
    const net = members(id);
    const expected = terminalId('OUTLET', index === 0 ? 'L' : 'N');
    const board = net.filter((value) => /^(P|N|PS|CB|SW)\./u.test(value));
    if (board.length > 0)
      issues.push({
        code: 'board-power',
        terminals: [id, ...board],
        message: `${id} が盤電源（${board.join('、')}）に接続されています。${expected} に接続してください。`,
      });
    const sources = net.filter((value) => value.startsWith('OUTLET.'));
    if (sources.length === 0) {
      // 盤電源への誤配線は上で説明済み。「未接続」と重ねて案内しない。
      if (board.length === 0)
        issues.push({
          code: 'missing',
          terminals: [id, expected],
          message: `${id} と ${expected} の接続がありません。${expected} に接続してください。`,
        });
    } else if (sources.length !== 1 || sources[0] !== expected)
      issues.push({
        code: 'wrong-source',
        terminals: [id, ...sources],
        message: `${id} の電源接続先が違います。接続先は ${expected} です。`,
      });
  });
  return { ready: issues.length === 0, issues };
}
