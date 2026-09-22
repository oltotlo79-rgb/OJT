import { createSession as createCheckSession } from '@ojt/board-model';
import { JIPM_BOARD, wireCountAtTerminal } from '@ojt/board-model';
import { MAX_WIRES_PER_TERMINAL } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  buildPlcReferenceSession,
  plcBoardFor,
  plcWiringPlan,
  plcWiringPlanIssues,
  PLC_WIRE_COLOR,
} from '../src/plc-reference.js';
import {
  PlcProblemSchema,
  resolvePlcIo,
  type PlcInputMapData,
  type ResolvedPlcIo,
} from '../src/schema/plc.js';
import { plcProblemJson } from './helpers/plc.js';

/** 2級形式（入力3・出力3）の課題。 */
function grade2Json(): Record<string, unknown> {
  return plcProblemJson({
    io: {
      mode: 'fixed',
      inputs: [
        { x: 0, pb: 'PB1' },
        { x: 1, pb: 'PB2' },
        { x: 2, pb: 'PB3' },
      ],
      outputs: [
        { y: 0, cr: 'CR1', pl: 'PL1' },
        { y: 1, cr: 'CR2', pl: 'PL2' },
        { y: 2, cr: 'CR3', pl: 'PL3' },
      ],
    },
    judge: { compareSignals: ['PL1', 'PL2', 'PL3'] },
  });
}

describe('plcWiringPlan（§10.2 / §11.3）', () => {
  const problem = PlcProblemSchema.parse(grade2Json());
  const board = plcBoardFor(problem, JIPM_BOARD);
  const io = resolvePlcIo(problem.io);

  it('wires the push buttons to X, the Y outputs to the relay coils and the contacts to the lamps', () => {
    const plan = plcWiringPlan(io, board?.plcUnit);
    const pairs = plan.map((w) => `${w.from}→${w.to}`);
    expect(pairs).toContain('TB_PB.1a→PLC.X0');
    expect(pairs).toContain('TB_PB.3a→PLC.X2');
    expect(pairs).toContain('PLC.Y0→CR1.14');
    expect(pairs).toContain('PLC.Y2→CR3.14');
    expect(pairs).toContain('CR1.5→TB_PL.1+');
    expect(pairs).toContain('OUTLET.L→PLC.L');
    expect(pairs).toContain('OUTLET.N→PLC.N');
  });

  it('daisy-chains the P and N rails so no terminal takes a third wire (§6.3 / §11.3)', () => {
    const plan = plcWiringPlan(io, board?.plcUnit);
    const pairs = plan.map((w) => `${w.from}→${w.to}`);
    expect(pairs).toContain('P.1→PLC.SS');
    expect(pairs).toContain('PLC.SS→PLC.COM0');
    expect(pairs).toContain('PLC.COM0→CR1.9');
    expect(pairs).toContain('CR1.9→CR2.9');
    expect(pairs).toContain('N.1→TB_PB.1c');
    expect(pairs).toContain('TB_PB.3c→CR1.13');
    expect(pairs).toContain('CR3.13→TB_PL.1-');
    expect(pairs).toContain('TB_PL.2-→TB_PL.3-');
    expect(plan).toHaveLength(25);
  });

  it('moves S/S to the N rail and the button commons to the P rail for source wiring (§10.2)', () => {
    const sourceIo = { ...io, wiring: 'source' as const };
    const pairs = plcWiringPlan(sourceIo, board?.plcUnit).map((w) => `${w.from}→${w.to}`);
    expect(pairs).toContain('N.1→PLC.SS');
    // ソースでは押ボタンのコモンが P側の鎖の先頭に来る（シンクの `P.1→PLC.SS` と対称）
    expect(pairs).toContain('P.1→TB_PB.1c');
    expect(pairs).not.toContain('P.1→PLC.SS');
    // 本数は結線の向きを変えても同じ
    expect(plcWiringPlan(sourceIo, board?.plcUnit)).toHaveLength(25);
  });

  it('refuses a push button whose common already carries a locked wire (§6.3)', () => {
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    if (!built.ok) throw new Error('模範回路を組めませんでした');
    // `PlcInputMapSchema` は PB4 を受け付けないので、見張りの動作確認は文字列経由で直に渡す
    const pb4 = 'PB4' as string as PlcInputMapData['pb'];
    const withPb4: ResolvedPlcIo = { ...io, inputs: [{ x: 3, pb: pb4 }] };
    built.value.session.wires.push(
      ...createCheckSession(JIPM_BOARD, { includeCheckWires: true }).wires,
    );
    const issues = plcWiringPlanIssues(withPb4, built.value.session);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('io.inputs[0].pb');
    expect(issues[0]?.message).toContain('TB_PB.4c');
    // 既定の PB1〜PB3 では何も出ない
    expect(plcWiringPlanIssues(io, built.value.session)).toEqual([]);
  });
});

describe('plcWiringPlan（ラック形の入力コモン）', () => {
  /** 機種だけを差し替えた既定課題の模範配線。 */
  function pairsFor(vendor: string, model: string): string[] {
    const problem = PlcProblemSchema.parse({ ...plcProblemJson(), plc: { vendor, model } });
    const board = plcBoardFor(problem, JIPM_BOARD);
    return plcWiringPlan(resolvePlcIo(problem.io), board?.plcUnit).map((w) => `${w.from}→${w.to}`);
  }

  it('chains only the input commons that serve a used point (8点1コモンの機種)', () => {
    // 既定課題は X(0) だけを使うので、下位8点のコモンだけが鎖に入る。
    // 使わない群のコモンまで繋ぐと、模範配線に意味の無い1本が増える（レビュー指摘）
    const jw300 = pairsFor('sharp', 'JW-300');
    expect(jw300).toContain('P.1→PLC.COM.A');
    expect(jw300.some((pair) => pair.includes('PLC.COM.B'))).toBe(false);
    const pc10g = pairsFor('jtekt', 'PC10G-1SP');
    expect(pc10g).toContain('P.1→PLC.ICOM0');
    expect(pc10g.some((pair) => pair.includes('PLC.ICOM1'))).toBe(false);
  });

  it('keeps the single common of the one-piece models in the chain', () => {
    expect(pairsFor('mitsubishi', 'FX5U')).toContain('P.1→PLC.SS');
    expect(pairsFor('omron', 'CP1E')).toContain('P.1→PLC.COM');
  });
});

describe('buildPlcReferenceSession（§7.2 / §10.2）', () => {
  it('mounts one relay per output and wires the whole reference circuit in blue (§10.2 線色)', () => {
    const problem = PlcProblemSchema.parse(grade2Json());
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { session, netlist, unit, program } = built.value;
    expect(unit.model).toBe('FX5U');
    expect(Object.keys(session.mounted)).toEqual(['S1', 'S2', 'S3']);
    expect(session.wires.filter((w) => !w.locked)).toHaveLength(25);
    expect(session.wires.every((w) => w.color === PLC_WIRE_COLOR)).toBe(true);
    expect(netlist.parts.some((p) => p.id === 'PLC')).toBe(true);
    expect(program.networks.length).toBeGreaterThan(0);
  });

  it('never puts a third wire on a terminal, on every model (§6.6 / レビュー M8)', () => {
    const grade2 = grade2Json();
    const models = [
      { vendor: 'mitsubishi', model: 'FX5U' },
      { vendor: 'jtekt', model: 'PC10G-1SP' },
      { vendor: 'omron', model: 'CP1E' },
      { vendor: 'sharp', model: 'JW-300' },
    ] as const;
    for (const plc of models) {
      const problem = PlcProblemSchema.parse({ ...grade2, plc });
      const built = buildPlcReferenceSession(problem, JIPM_BOARD);
      if (!built.ok)
        throw new Error(
          `${plc.model}: 模範回路を組めませんでした（${JSON.stringify(built.errors)}）`,
        );
      const seen = new Set<string>();
      for (const wire of built.value.session.wires) {
        for (const terminal of [wire.from, wire.to]) {
          if (seen.has(terminal)) continue;
          seen.add(terminal);
          expect(
            wireCountAtTerminal(built.value.session, terminal),
            `${plc.model} / ${terminal}`,
          ).toBeLessThanOrEqual(MAX_WIRES_PER_TERMINAL);
        }
      }
    }
  });

  it('builds the 1級 form with four outputs as well (§7.6)', () => {
    const problem = PlcProblemSchema.parse(
      plcProblemJson({
        grade: 1,
        io: { mode: 'free' },
        judge: { compareSignals: ['PL1', 'PL2', 'PL3', 'PL4'] },
      }),
    );
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.value.session.mounted)).toEqual(['S1', 'S2', 'S3', 'S4']);
  });

  it('reports a problem error when the board does not match the problem (§13 #2)', () => {
    const problem = PlcProblemSchema.parse(
      plcProblemJson({ board: { boardId: 'other', socketRoles: { S7: 'CHK' } } }),
    );
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toBe('board.boardId');
  });

  it('reports a problem error when a mapped relay has no socket role (§13 #2)', () => {
    const problem = PlcProblemSchema.parse(
      plcProblemJson({
        board: { boardId: 'board-jipm-std', socketRoles: { S1: 'CR1', S7: 'CHK' } },
        io: {
          mode: 'fixed',
          inputs: [{ x: 0, pb: 'PB1' }],
          // y は既定の模範ラダー（X0 → Y0）に合わせて 0 のまま。CR2 だけ盤の役割割当から外す。
          outputs: [{ y: 0, cr: 'CR2', pl: 'PL2' }],
        },
        judge: { compareSignals: ['PL2'] },
      }),
    );
    const built = buildPlcReferenceSession(problem, JIPM_BOARD);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.path).toContain('io.outputs');
  });
});
