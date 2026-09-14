import { JIPM_BOARD } from '@ojt/board-model';
import { TICK_MS } from '@ojt/circuit-sim';
import { SCHEMATIC_FORMAT_VERSION } from '@ojt/schematic-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('scaffold', () => {
  it('can reach every dependency of @ojt/content', () => {
    expect(JIPM_BOARD.id).toBe('board-jipm-std');
    expect(TICK_MS).toBe(10);
    expect(SCHEMATIC_FORMAT_VERSION).toBe(1);
    expect(z.string().safeParse('ok').success).toBe(true);
  });
});
