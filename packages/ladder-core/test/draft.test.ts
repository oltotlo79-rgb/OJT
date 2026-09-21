import { describe, expect, it } from 'vitest';
import {
  compile,
  DRAFT_SYMBOLS,
  endNetwork,
  isDraftOutput,
  network,
  program,
} from '../src/index.js';

describe('SHARPのアドレス未入力記号', () => {
  it.each(DRAFT_SYMBOLS)('%s は保存可能な図の要素だが実行回路には変換しない', (symbol) => {
    const source = program(network('pending', [[{ kind: 'draft', symbol }]]), endNetwork());
    const result = compile(source);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('未入力記号が実行回路になった');
    const error = result.errors.find((issue) => issue.code === 'incomplete-symbol');
    expect(error).toMatchObject({ networkId: 'pending', row: 0, col: 0 });
    expect(error?.message).toContain('アドレスが未入力');
    expect(source.networks[0]?.cells[0]?.[0]).toEqual({ kind: 'draft', symbol });
    expect(isDraftOutput(symbol)).toBe(!['NO', 'NC', 'P', 'F'].includes(symbol));
  });
});
