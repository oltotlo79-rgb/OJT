import {
  deskRouteIssues,
  deskRoutes,
  JIPM_BOARD,
  plcUnitFor,
  withBoardProfile,
} from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PLC_PROBLEMS,
  buildPlcReferenceSession,
  MODEL_OF_VENDOR,
  PLC_VENDORS,
  type PlcProblem,
} from '../src/index.js';

/**
 * 内蔵PLC課題の模範配線を4メーカーの本体で張り、机上の電線が本体・カバーを貫かず、
 * 他の端子のネジに重ならないことを確かめる（2026-09-26 利用者報告「配線がシーケンサの部分を
 * 貫通する」「Pからの配線がNの端子と重なって表示する」）。
 */

/** 課題を別メーカーの本体へ載せ替える（画面の「メーカーを切り替える」と同じ置き換え）。 */
function onVendor(problem: PlcProblem, vendor: (typeof PLC_VENDORS)[number]): PlcProblem {
  return { ...problem, plc: { vendor, model: MODEL_OF_VENDOR[vendor] } };
}

describe('内蔵PLC課題 × 4メーカーの机上配線', () => {
  it.each(PLC_VENDORS.map((vendor) => [vendor] as const))(
    'routes every reference wiring cleanly on %s',
    (vendor) => {
      const problems: string[] = [];
      let routed = 0;
      for (const original of BUILTIN_PLC_PROBLEMS) {
        const problem = onVendor(original, vendor);
        const board = withBoardProfile(JIPM_BOARD, problem.board.profile);
        const reference = buildPlcReferenceSession(problem, board);
        // 割付がその機種に収まらない課題（CP1E の出力12点など）は画面でも切り替えられない
        if (!reference.ok) continue;
        const unit = plcUnitFor(problem.plc.model);
        if (unit === undefined) continue;
        const issues = deskRouteIssues(
          deskRoutes(reference.value.board, reference.value.session),
          reference.value.board,
          unit,
        );
        routed += 1;
        if (issues.length > 0) problems.push(`${problem.id}: ${issues.join(' / ')}`);
      }
      expect(routed).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    },
  );
});
