import { describe, expect, it } from 'vitest';
import { DEFAULT_STATIC_CHECKS, STATIC_CHECK_IDS } from '../src/schema/judge.js';
import {
  DEFAULT_PLC_IO,
  PLC_DEFAULT_STATIC_CHECKS,
  PLC_MODELS,
  PLC_VENDORS,
  PlcInputMapSchema,
  PlcProblemSchema,
  PlcRefSchema,
  resolvePlcIo,
  SUPPORTED_PLC_MODELS,
} from '../src/schema/plc.js';
import { ladderWith, noJson, outJson, plcProblemJson, rungJson } from './helpers/plc.js';

describe('PlcProblemSchema（§7.6）', () => {
  it('parses a mode D problem', () => {
    const parsed = PlcProblemSchema.parse(plcProblemJson());
    expect(parsed.mode).toBe('plc');
    expect(parsed.plc).toEqual({ vendor: 'mitsubishi', model: 'FX5U' });
    expect(parsed.wiringRequired).toBe(true);
    expect(parsed.referenceLadder.networks[0]?.cols).toBe(16);
    expect(parsed.io.wiring).toBe('sink');
  });

  it('turns on the three PLC static checks by default (§7.4 の D 列)', () => {
    const parsed = PlcProblemSchema.parse(plcProblemJson());
    expect(parsed.judge.staticChecks.twoStage).toBe(true);
    expect(parsed.judge.staticChecks.plcPowerIndependent).toBe(true);
    expect(parsed.judge.staticChecks.ioAssignment).toBe(true);
    expect(parsed.judge.staticChecks.coilPolarity).toBe(true);
    expect(PLC_DEFAULT_STATIC_CHECKS.twoStage).toBe(true);
    // モードB・C の既定では新しい3件は無効のまま（§7.4）
    expect(DEFAULT_STATIC_CHECKS.twoStage).toBe(false);
    expect(DEFAULT_STATIC_CHECKS.plcPowerIndependent).toBe(false);
    expect(DEFAULT_STATIC_CHECKS.ioAssignment).toBe(false);
    expect(STATIC_CHECK_IDS).toHaveLength(9);
  });

  it('starts every vendor of 決定事項#14 in Phase 4 (§16)', () => {
    expect(PLC_VENDORS).toEqual(['mitsubishi', 'jtekt', 'omron', 'sharp']);
    expect(PLC_MODELS).toEqual(['FX5U', 'PC10G-1SP', 'CP1E', 'JW-300']);
    expect(SUPPORTED_PLC_MODELS).toEqual(['FX5U', 'PC10G-1SP', 'CP1E', 'JW-300']);
    for (const [vendor, model] of [
      ['mitsubishi', 'FX5U'],
      ['jtekt', 'PC10G-1SP'],
      ['omron', 'CP1E'],
      ['sharp', 'JW-300'],
    ] as const) {
      expect(PlcRefSchema.safeParse({ vendor, model }).success).toBe(true);
    }
    // メーカーと機種の組み合わせ違いは引き続き拒否する（§7.6）
    expect(PlcRefSchema.safeParse({ vendor: 'omron', model: 'FX5U' }).success).toBe(false);
  });

  it('rejects an I/O point the model does not have (前提#23 / 決定表#13)', () => {
    const cp1e = { vendor: 'omron', model: 'CP1E' } as const;
    const ok = PlcProblemSchema.safeParse(
      plcProblemJson({
        plc: cp1e,
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 11, cr: 'CR1', pl: 'PL1' }],
        },
        referenceLadder: ladderWith(11, 0),
      }),
    );
    expect(ok.success).toBe(true);
    const ng = PlcProblemSchema.safeParse(
      plcProblemJson({
        plc: cp1e,
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          outputs: [{ y: 12, cr: 'CR1', pl: 'PL1' }],
        },
        referenceLadder: ladderWith(12, 0),
      }),
    );
    expect(ng.success).toBe(false);
    if (ng.success) return;
    expect(JSON.stringify(ng.error.issues)).toContain('CP1E');
  });

  it('rejects a vendor and model that do not belong together', () => {
    const mismatched = plcProblemJson({ plc: { vendor: 'omron', model: 'FX5U' } });
    expect(PlcProblemSchema.safeParse(mismatched).success).toBe(false);
  });

  it('rejects grade 3 and a false wiringRequired (決定事項#16)', () => {
    expect(PlcProblemSchema.safeParse(plcProblemJson({ grade: 3 })).success).toBe(false);
    expect(PlcProblemSchema.safeParse(plcProblemJson({ wiringRequired: false })).success).toBe(
      false,
    );
  });

  it('rejects a judging window that ends before the last operation (§7.3)', () => {
    const tooShort = plcProblemJson({ durationMs: 300 });
    const parsed = PlcProblemSchema.safeParse(tooShort);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(JSON.stringify(parsed.error.issues)).toContain('判定区間長');
  });

  it('rejects a reference ladder that does not convert (§13 #2 を読込で拾う)', () => {
    // END のネットワークを外すと `compile()` が `missing-end` を返す
    const noEnd = {
      networks: [{ id: 'n1', cells: [rungJson(noJson('input', 0), outJson(0))] }],
    };
    const broken = plcProblemJson({ referenceLadder: noEnd });
    const parsed = PlcProblemSchema.safeParse(broken);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(JSON.stringify(parsed.error.issues)).toContain('END');
  });

  it('rejects duplicated assignments in the I/O map', () => {
    const duplicated = plcProblemJson({
      io: {
        mode: 'fixed',
        inputs: [
          { x: 0, pb: 'PB1' },
          { x: 1, pb: 'PB1' },
        ],
        outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
      },
    });
    expect(PlcProblemSchema.safeParse(duplicated).success).toBe(false);

    const sameRelay = plcProblemJson({
      io: {
        mode: 'fixed',
        inputs: [{ x: 0, pb: 'PB1' }],
        outputs: [
          { y: 0, cr: 'CR1', pl: 'PL1' },
          { y: 1, cr: 'CR1', pl: 'PL2' },
        ],
      },
    });
    expect(PlcProblemSchema.safeParse(sameRelay).success).toBe(false);
  });

  it('refuses PB4 because the check circuit already occupies TB_PB.4c (§6.3)', () => {
    const withPb4 = plcProblemJson({
      io: {
        mode: 'fixed',
        inputs: [
          { x: 0, pb: 'PB1' },
          { x: 3, pb: 'PB4' },
        ],
        outputs: [{ y: 0, cr: 'CR1', pl: 'PL1' }],
      },
    });
    expect(PlcProblemSchema.safeParse(withPb4).success).toBe(false);
    // 入力は3点までしか無い（PB1〜PB3）
    expect(PlcInputMapSchema.shape.pb.options).toEqual(['PB1', 'PB2', 'PB3']);
  });
});

describe('resolvePlcIo（§7.6 の既定割付）', () => {
  it('falls back to the default assignment when the problem omits the map', () => {
    const parsed = PlcProblemSchema.parse(plcProblemJson({ io: { mode: 'free' } }));
    const io = resolvePlcIo(parsed.io);
    expect(io.wiring).toBe('sink');
    expect(io.inputs).toEqual(DEFAULT_PLC_IO.inputs);
    expect(io.outputs).toEqual(DEFAULT_PLC_IO.outputs);
    // 入力3点（PB4はチェック用）・出力4点が既定。1級形式もこの形である
    expect(DEFAULT_PLC_IO.inputs).toHaveLength(3);
    expect(DEFAULT_PLC_IO.inputs[0]).toEqual({ x: 0, pb: 'PB1' });
    expect(DEFAULT_PLC_IO.outputs).toHaveLength(4);
    expect(DEFAULT_PLC_IO.outputs[3]).toEqual({ y: 3, cr: 'CR4', pl: 'PL4' });
  });

  it('keeps the problem assignment when it gives one', () => {
    const parsed = PlcProblemSchema.parse(plcProblemJson());
    const io = resolvePlcIo(parsed.io);
    expect(io.inputs).toHaveLength(1);
    expect(io.outputs).toEqual([{ y: 0, cr: 'CR1', pl: 'PL1' }]);
  });

  it('accepts source wiring as well (§10.2)', () => {
    const parsed = PlcProblemSchema.parse(
      plcProblemJson({ io: { mode: 'free', wiring: 'source' } }),
    );
    expect(resolvePlcIo(parsed.io).wiring).toBe('source');
  });
});
