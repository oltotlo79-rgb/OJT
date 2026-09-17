import { compile, IR_COLS } from '@ojt/ladder-core';
import { describe, expect, it } from 'vitest';
import {
  CellSchema,
  DeviceSchema,
  LadderProgramSchema,
  MAX_DEVICE_COMMENT_LENGTH,
  MAX_DEVICE_COMMENTS,
} from '../src/schema/ladder.js';

/** 自己保持のJSON（課題ファイルに書く形）。 */
const SELF_HOLD = {
  networks: [
    {
      id: 'n1',
      comment: '自己保持',
      cells: [
        [
          { kind: 'contact', type: 'NO', device: { kind: 'input', index: 0 } },
          { kind: 'vline' },
          { kind: 'contact', type: 'NC', device: { kind: 'input', index: 1 } },
          { kind: 'coil', type: 'OUT', device: { kind: 'output', index: 0 } },
        ],
        [{ kind: 'contact', type: 'NO', device: { kind: 'output', index: 0 } }],
      ],
    },
    { id: 'end', cells: [[{ kind: 'end' }]] },
  ],
};

describe('LadderProgramSchema', () => {
  it('parses a program into the ladder-core shape (§10.3)', () => {
    const parsed = LadderProgramSchema.parse(SELF_HOLD);
    expect(parsed.networks).toHaveLength(2);
    const first = parsed.networks[0];
    expect(first?.rows).toBe(2);
    expect(first?.cols).toBe(IR_COLS);
    expect(first?.comment).toBe('自己保持');
    expect(first?.cells[1]).toHaveLength(IR_COLS);
    expect(first?.cells[1]?.[1]).toEqual({ kind: 'empty' });
  });

  it('sends a trailing output cell to the coil column and fills the gap with hlines', () => {
    const parsed = LadderProgramSchema.parse(SELF_HOLD);
    const row = parsed.networks[0]?.cells[0] ?? [];
    expect(row[3]).toEqual({ kind: 'hline' });
    expect(row[14]).toEqual({ kind: 'hline' });
    expect(row[15]).toEqual({
      kind: 'coil',
      type: 'OUT',
      device: { kind: 'output', index: 0 },
    });
    // 出力セルで終わらない行は空セルで詰める
    expect(parsed.networks[0]?.cells[1]?.[1]).toEqual({ kind: 'empty' });
  });

  it('produces a program that compiles (§10.3 の構造検査はここではしない)', () => {
    const result = compile(LadderProgramSchema.parse(SELF_HOLD));
    expect(result.ok).toBe(true);
  });

  it('leaves the comment out when the JSON omits it (exactOptionalPropertyTypes)', () => {
    const parsed = LadderProgramSchema.parse(SELF_HOLD);
    expect(Object.hasOwn(parsed.networks[1] ?? {}, 'comment')).toBe(false);
  });

  it('rejects a row longer than the IR width and an empty network list', () => {
    const wide = {
      networks: [
        { id: 'n1', cells: [Array.from({ length: IR_COLS + 1 }, () => ({ kind: 'hline' }))] },
      ],
    };
    expect(LadderProgramSchema.safeParse(wide).success).toBe(false);
    expect(LadderProgramSchema.safeParse({ networks: [] }).success).toBe(false);
    expect(LadderProgramSchema.safeParse({ networks: [{ id: 'n1', cells: [] }] }).success).toBe(
      false,
    );
  });

  it('rejects duplicated network ids', () => {
    const duplicated = {
      networks: [
        { id: 'n1', cells: [[{ kind: 'end' }]] },
        { id: 'n1', cells: [[{ kind: 'end' }]] },
      ],
    };
    expect(LadderProgramSchema.safeParse(duplicated).success).toBe(false);
  });

  it('keeps the device comments and leaves the key out when the JSON omits them (§10.7)', () => {
    const withComments = {
      ...SELF_HOLD,
      comments: { X0: '運転押ボタン', X1: '停止押ボタン', Y0: '運転表示灯' },
    };
    const parsed = LadderProgramSchema.parse(withComments);
    expect(parsed.comments?.X0).toBe('運転押ボタン');
    // コメントは実行に影響しない（そのまま compile できる）
    expect(compile(parsed).ok).toBe(true);
    expect(Object.hasOwn(LadderProgramSchema.parse(SELF_HOLD), 'comments')).toBe(false);
  });

  it('rejects a comment that is too long, too many of them or a bad device name', () => {
    const tooLong = { ...SELF_HOLD, comments: { X0: 'あ'.repeat(MAX_DEVICE_COMMENT_LENGTH + 1) } };
    expect(LadderProgramSchema.safeParse(tooLong).success).toBe(false);
    const badName = { ...SELF_HOLD, comments: { 'X 0': '運転' } };
    expect(LadderProgramSchema.safeParse(badName).success).toBe(false);
    const tooMany = {
      ...SELF_HOLD,
      comments: Object.fromEntries(
        Array.from({ length: MAX_DEVICE_COMMENTS + 1 }, (_unused, i) => [`M${i}`, `補助${i}`]),
      ),
    };
    expect(LadderProgramSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe('DeviceSchema / CellSchema', () => {
  it('accepts the six device kinds and rejects a negative index', () => {
    expect(DeviceSchema.parse({ kind: 'timer', index: 0 })).toEqual({ kind: 'timer', index: 0 });
    expect(DeviceSchema.safeParse({ kind: 'timer', index: -1 }).success).toBe(false);
    expect(DeviceSchema.safeParse({ kind: 'relay', index: 0 }).success).toBe(false);
  });

  it('allows only SP0〜SP2 for special devices (§10.3)', () => {
    expect(DeviceSchema.safeParse({ kind: 'special', index: 2 }).success).toBe(true);
    expect(DeviceSchema.safeParse({ kind: 'special', index: 3 }).success).toBe(false);
  });

  it('requires the timer preset to be a multiple of the scan period (§10.4)', () => {
    const cell = {
      kind: 'timer',
      type: 'TON',
      device: { kind: 'timer', index: 0 },
      presetMs: 3000,
    };
    expect(CellSchema.safeParse(cell).success).toBe(true);
    expect(CellSchema.safeParse({ ...cell, presetMs: 15 }).success).toBe(false);
    expect(CellSchema.safeParse({ ...cell, presetMs: 0 }).success).toBe(false);
  });

  it('requires a reset device on a counter and a preset of at least 1', () => {
    const cell = {
      kind: 'counter',
      type: 'CTU',
      device: { kind: 'counter', index: 0 },
      preset: 3,
      resetDevice: { kind: 'input', index: 1 },
    };
    expect(CellSchema.safeParse(cell).success).toBe(true);
    expect(CellSchema.safeParse({ ...cell, preset: 0 }).success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure only to drop `resetDevice`
    const { resetDevice: _drop, ...withoutReset } = cell;
    expect(CellSchema.safeParse(withoutReset).success).toBe(false);
  });

  it('rejects unknown keys so typos surface as read errors (§13 #1)', () => {
    expect(
      CellSchema.safeParse({ kind: 'hline', device: { kind: 'input', index: 0 } }).success,
    ).toBe(false);
  });
});
