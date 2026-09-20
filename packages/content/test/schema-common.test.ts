import { describe, expect, it } from 'vitest';
import {
  DifficultySchema,
  MAX_PROBLEM_TAGS,
  PROBLEM_TAG_LABELS,
  PROBLEM_TAGS,
  ProblemTagSchema,
} from '../src/schema/difficulty.js';
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
    expect(UNSUPPORTED_MODES).toEqual([]);
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

/**
 * 難しさ（`difficulty`）と学習テーマ（`tags`）。§16 Phase 7 §4.3。
 * どちらも既定値つきの任意項目なので、既存の課題ファイルは書き換えなくてもそのまま読める。
 */
describe('difficulty / tags（§16 Phase 7）', () => {
  it('reads a header that writes neither field and fills in the defaults (3 / [])', () => {
    const parsed = ProblemHeaderSchema.safeParse(HEADER);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.difficulty).toBe(3);
    expect(parsed.data.tags).toEqual([]);
  });

  it('keeps the format version at 1 (既存の課題を読めなくしていないことの明示。決定 D3)', () => {
    expect(CONTENT_FORMAT_VERSION).toBe(1);
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, formatVersion: 2 }).success).toBe(false);
  });

  it('keeps a difficulty that the file writes', () => {
    const parsed = ProblemHeaderSchema.safeParse({ ...HEADER, difficulty: 5, tags: ['timer'] });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.difficulty).toBe(5);
    expect(parsed.data.tags).toEqual(['timer']);
  });

  it('rejects a difficulty of 0 or 6 and a fractional one', () => {
    expect(DifficultySchema.safeParse(1).success).toBe(true);
    expect(DifficultySchema.safeParse(5).success).toBe(true);
    expect(DifficultySchema.safeParse(0).success).toBe(false);
    expect(DifficultySchema.safeParse(6).success).toBe(false);
    expect(DifficultySchema.safeParse(2.5).success).toBe(false);
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, difficulty: 0 }).success).toBe(false);
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, difficulty: 6 }).success).toBe(false);
  });

  it('rejects a tag that is not in the vocabulary', () => {
    expect(ProblemTagSchema.safeParse('self-hold').success).toBe(true);
    expect(ProblemTagSchema.safeParse('自己保持').success).toBe(false);
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, tags: ['nope'] }).success).toBe(false);
  });

  it('rejects more than six tags', () => {
    const seven = PROBLEM_TAGS.slice(0, MAX_PROBLEM_TAGS + 1);
    expect(seven).toHaveLength(7);
    expect(ProblemHeaderSchema.safeParse({ ...HEADER, tags: seven }).success).toBe(false);
    expect(
      ProblemHeaderSchema.safeParse({ ...HEADER, tags: PROBLEM_TAGS.slice(0, MAX_PROBLEM_TAGS) })
        .success,
    ).toBe(true);
  });

  it('gives every tag a Japanese label（画面と説明書が語を書き写さないため）', () => {
    expect(PROBLEM_TAGS).toHaveLength(14);
    expect(Object.keys(PROBLEM_TAG_LABELS).sort()).toEqual([...PROBLEM_TAGS].sort());
    for (const tag of PROBLEM_TAGS) expect(PROBLEM_TAG_LABELS[tag].length).toBeGreaterThan(0);
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
