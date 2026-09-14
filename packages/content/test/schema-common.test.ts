import { describe, expect, it } from 'vitest';
import { toProblemIssues } from '../src/schema/index.js';
import {
  CONTENT_FORMAT_VERSION,
  GradeSchema,
  ProblemHeaderSchema,
  ProblemIdSchema,
  SocketRolesSchema,
  TerminalIdSchema,
  TimeLimitSchema,
  toSocketRoles,
  UNSUPPORTED_MODES,
} from '../src/schema/common.js';

const HEADER = {
  formatVersion: 1,
  id: 'b-001',
  title: '自己保持回路',
  grade: 3,
  mode: 'assemble',
  description: '課題文',
  timeLimit: { standardMin: 30, cutoffMin: 50 },
  board: {
    boardId: 'board-jipm-std',
    socketRoles: { S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' },
  },
  inventory: [{ kind: 'relay-my4n', count: 2 }],
};

describe('ProblemIdSchema', () => {
  it('accepts lowercase alphanumerics and hyphens', () => {
    expect(ProblemIdSchema.safeParse('b-001').success).toBe(true);
    expect(ProblemIdSchema.safeParse('b001').success).toBe(true);
  });

  it('rejects other spellings', () => {
    expect(ProblemIdSchema.safeParse('B_001').success).toBe(false);
    expect(ProblemIdSchema.safeParse('b--001').success).toBe(false);
    expect(ProblemIdSchema.safeParse('').success).toBe(false);
  });
});

describe('TimeLimitSchema', () => {
  it('accepts a cutoff that is not shorter than the standard time', () => {
    expect(TimeLimitSchema.safeParse({ standardMin: 50, cutoffMin: 60 }).success).toBe(true);
    expect(TimeLimitSchema.safeParse({ standardMin: 30, cutoffMin: 30 }).success).toBe(true);
  });

  it('rejects a cutoff shorter than the standard time', () => {
    const parsed = TimeLimitSchema.safeParse({ standardMin: 50, cutoffMin: 30 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['cutoffMin']);
  });
});

describe('SocketRolesSchema', () => {
  it('accepts the default layout that fills all seven roles (§6.1)', () => {
    expect(
      SocketRolesSchema.safeParse({
        S1: 'CR1',
        S2: 'CR2',
        S3: 'CR3',
        S4: 'CR4',
        S5: 'T1',
        S6: 'T2',
        S7: 'CHK',
      }).success,
    ).toBe(true);
  });

  it('accepts the two exam layouts, leaving the rest as spare sockets (§6.1)', () => {
    expect(
      SocketRolesSchema.safeParse({ S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S7: 'CHK' })
        .success,
    ).toBe(true);
    expect(
      SocketRolesSchema.safeParse({ S1: 'CR1', S2: 'CR2', S5: 'T1', S6: 'T2', S7: 'CHK' }).success,
    ).toBe(true);
  });

  it('rejects duplicated roles', () => {
    expect(
      SocketRolesSchema.safeParse({ S1: 'CR1', S2: 'CR1', S5: 'T1', S6: 'T2', S7: 'CHK' }).success,
    ).toBe(false);
  });

  it('rejects a layout without the check socket', () => {
    expect(
      SocketRolesSchema.safeParse({ S1: 'CR1', S2: 'CR2', S3: 'CR3', S5: 'T1', S6: 'T2' }).success,
    ).toBe(false);
  });

  it('rejects the check role on a socket other than S7 (§6.3)', () => {
    const parsed = SocketRolesSchema.safeParse({ S1: 'CR1', S2: 'CR2', S8: 'CHK' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toContain('S7');
  });

  it('rejects a socket id the board does not have', () => {
    expect(SocketRolesSchema.safeParse({ S1: 'CR1', S7: 'CHK', S9: 'CR2' }).success).toBe(false);
  });
});

describe('toSocketRoles', () => {
  it('drops the sockets that have no role (board-model の Partial に合わせる)', () => {
    expect(toSocketRoles({ S1: 'CR1', S3: undefined, S7: 'CHK' })).toEqual({
      S1: 'CR1',
      S7: 'CHK',
    });
    expect(Object.keys(toSocketRoles({ S1: 'CR1', S7: 'CHK' }))).toEqual(['S1', 'S7']);
  });
});

describe('ProblemHeaderSchema', () => {
  it('accepts a complete header', () => {
    expect(ProblemHeaderSchema.safeParse(HEADER).success).toBe(true);
  });

  it('rejects an unknown format version (§13 #8)', () => {
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, formatVersion: 99 }).success).toBe(false);
    expect(CONTENT_FORMAT_VERSION).toBe(1);
  });

  it('rejects an unknown mode', () => {
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, mode: 'debug' }).success).toBe(false);
    expect(UNSUPPORTED_MODES).toEqual(['plc']);
  });

  it('accepts an inventory count up to the socket count (8) and rejects more', () => {
    expect(
      ProblemHeaderSchema.safeParse({ ...HEADER, inventory: [{ kind: 'relay-my4n', count: 8 }] })
        .success,
    ).toBe(true);
    expect(
      ProblemHeaderSchema.safeParse({ ...HEADER, inventory: [{ kind: 'relay-my4n', count: 9 }] })
        .success,
    ).toBe(false);
  });

  it('rejects unknown keys instead of dropping them (§13 #1)', () => {
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, note: 'x' }).success).toBe(false);
    expect(
      ProblemHeaderSchema.safeParse({
        ...HEADER,
        timeLimit: { standardMin: 30, cutoffMin: 50, graceMin: 5 },
      }).success,
    ).toBe(false);
    expect(
      ProblemHeaderSchema.safeParse({
        ...HEADER,
        inventory: [{ kind: 'relay-my4n', count: 2, spare: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ProblemHeaderSchema.safeParse({ ...HEADER, board: { ...HEADER.board, extraPart: 'BZ' } })
        .success,
    ).toBe(false);
  });
});

describe('GradeSchema / TerminalIdSchema', () => {
  it('accepts only grades 1..3', () => {
    expect(GradeSchema.safeParse(2).success).toBe(true);
    expect(GradeSchema.safeParse(4).success).toBe(false);
  });

  it('reports a wrong grade as a single issue, not one line per candidate (§13 #1)', () => {
    const parsed = GradeSchema.safeParse(4);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toHaveLength(1);
    expect(parsed.error.issues[0]?.code).not.toBe('invalid_union');
    expect(toProblemIssues(parsed.error)).toHaveLength(1);
  });

  it('accepts `<part>.<name>` terminal ids (§6.4)', () => {
    expect(TerminalIdSchema.safeParse('CR1.14').success).toBe(true);
    expect(TerminalIdSchema.safeParse('TB_PL.1+').success).toBe(true);
    expect(TerminalIdSchema.safeParse('CR1').success).toBe(false);
    expect(TerminalIdSchema.safeParse('CR1:coil.1').success).toBe(false);
  });
});
