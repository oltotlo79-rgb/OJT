import { terminalId } from '@ojt/circuit-sim';
import { JIPM_BOARD } from '@ojt/board-model';
import {
  BUILTIN_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  BUILTIN_PLC_PROBLEMS,
  buildReferenceSession,
  buildInspectRepairCircuit,
  buildPlcReferenceSession,
  judgeAssemble,
  judgeInspectParts,
  judgeInspectRepair,
  judgePlc,
} from '@ojt/content';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resultReportHtml, type ReportInput } from '../src/renderer/result/report-html.js';
import { useStore } from '../src/renderer/app/store.js';

const problem = BUILTIN_PROBLEMS[0]!;
const reference = buildReferenceSession(problem, JIPM_BOARD);
if (!reference.ok) throw new Error('reference');
const judged = judgeAssemble(problem, JIPM_BOARD, reference.value.session);
if (!judged.ok) throw new Error('judge');
const input: ReportInput = {
  problem,
  result: { ...judged.value, elapsedMs: 65_000 },
  sessionOpenedAtMs: new Date('2026-09-22T10:00:00+09:00').getTime(),
  hintStage: 2,
  schematicOpenCount: 1,
  restoredHazardCount: 3,
};
afterEach(() => {
  vi.restoreAllMocks();
  useStore.getState().abandonSession();
});

describe('1枚の結果HTML', () => {
  it('表示用情報だけで閉じ、外部参照・画像・スクリプトを持たない', () => {
    const html = resultReportHtml(input);
    expect(html).toContain(problem.title);
    expect(html).toContain('合格');
    expect(html).toContain('3 回');
    expect(html).toContain('2 回');
    expect(html).not.toMatch(/https?:|\bsrc\s*=|<img|<script|<link|<iframe/i);
    expect(html).toContain('開始（今回）');
    expect(html).toContain('@page { size: A4;');
    expect(html).not.toContain('差分一覧');
  });
  it('自由文をエスケープし、パス・利用者名・配線IDを出さない', () => {
    const dirty = { ...input, userName: 'PRIVATE_USER', filePath: 'C:\\secret\\report' };
    dirty.problem = {
      ...problem,
      title:
        '<script>alert("x")</script> C:\\Users\\PRIVATE_USER\\x.json w-003 sw-005 /home/alice/file',
    };
    const html = resultReportHtml(dirty);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script>|PRIVATE_USER|alice|w-003|sw-005|C:\\|\/home\//);
  });
  it('差分は表示名で最大5件、配線は最大3件。全件数を残す', () => {
    const mismatch = {
      tMs: 200,
      signal: 'PL1',
      expected: true,
      actual: false,
      reason: 'value' as const,
    };
    const html = resultReportHtml({
      ...input,
      result: {
        ...judged.value,
        passed: false,
        mismatches: Array.from({ length: 90 }, () => mismatch),
      },
      suspects: Array.from({ length: 10 }, (_unused, i) => ({
        message: `接続の確認${i} w-003`,
        kind: 'missing' as const,
        devices: [],
        terminals: [terminalId('CR1', '9'), terminalId('PB1', '2c')],
        wireIds: [],
        cellIds: [],
      })),
      suspectTotal: 12,
    });
    expect(html).toContain('差分一覧');
    expect(html).toContain('白ランプ（PL1）');
    expect(html).toContain('接続の確認2');
    expect(html).not.toContain('接続の確認3');
    expect(html).not.toContain('w-003');
    expect(html).toContain('>90<');
    expect(html).toContain('>12<');
  });
  it('C1・C2・PLCにもモードごとの採点情報が入る', () => {
    const c1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0]!;
    const r1 = judgeInspectParts(c1, []);
    expect(resultReportHtml({ ...input, problem: c1, result: r1 })).toContain('マークシート採点');
    const c2 = BUILTIN_INSPECT_REPAIR_PROBLEMS[0]!;
    const builtC2 = buildInspectRepairCircuit(c2, JIPM_BOARD);
    if (!builtC2.ok) throw new Error('circuit');
    const r2 = judgeInspectRepair(c2, JIPM_BOARD, builtC2.value, []);
    if (!r2.ok) throw new Error('judge');
    expect(resultReportHtml({ ...input, problem: c2, result: r2.value })).toContain('見逃し');
    const plc = BUILTIN_PLC_PROBLEMS[0]!;
    const builtPlc = buildPlcReferenceSession(plc, JIPM_BOARD);
    if (!builtPlc.ok) throw new Error('plc');
    const r3 = judgePlc(plc, JIPM_BOARD, builtPlc.value.session, plc.referenceLadder);
    if (!r3.ok) throw new Error('judge');
    expect(resultReportHtml({ ...input, problem: plc, result: r3.value })).toContain('PLC');
  });
  it('今回の開始日時は時間を復元しても変わらず、別の課題で更新される', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    useStore.getState().openProblem(problem);
    expect(useStore.getState().sessionOpenedAtMs).toBe(1_000_000);
    now.mockReturnValue(2_000_000);
    useStore.getState().restoreProgress(90_000, 2);
    expect(useStore.getState().sessionOpenedAtMs).toBe(1_000_000);
    useStore.getState().openProblem(problem);
    expect(useStore.getState().sessionOpenedAtMs).toBe(2_000_000);
  });
});
