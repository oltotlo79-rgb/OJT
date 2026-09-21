// helpers/worker-bridge.js を他の import より前に置く（vi.mock のファクトリから参照するため）。
import { workerBridgeMockModule, type WorkerBridgeMockState } from './helpers/worker-bridge.js';
import { JIPM_BOARD, type BoardSession } from '@ojt/board-model';
import { wireId as toWireId } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildReferenceSession,
  judgeInspectRepair,
  type FaultReport,
  type InspectRepairProblem,
} from '@ojt/content';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

/**
 * C2の作業ファイルを**本物の判定**（`judgeInspectRepair()`）まで往復させるテスト
 * （Plan 2B レビューで残された「テストを lift する」宿題。probe 3 / c2-roundtrip.probe.ts）。
 *
 * `work-file-inspect.test.ts` は保存・復元されたストアの中身までは見るが、`judgeInspectRepair()`
 * を実際に呼んで「復元後も同じ判定になる」ことまでは確かめていない。ここでは
 * `toWorkFile()` → `JSON.stringify/parse`（本物の保存・読込と同じ往復）→ main の
 * `parseWorkFile()` → `applyWorkFile()` → `judgeInspectRepair()` を素通りさせる。
 */

vi.setConfig({ testTimeout: 120_000 });

const bridgeMock = vi.hoisted((): WorkerBridgeMockState => ({ sent: [], handlers: undefined }));
const apiState = vi.hoisted((): { readProblem: Mock } => ({ readProblem: vi.fn() }));

vi.mock('../src/renderer/session/worker-bridge.js', () => workerBridgeMockModule(bridgeMock));

vi.mock('../src/renderer/app/ojt-api.js', () => ({
  ojtApi: () => ({ readProblem: apiState.readProblem }),
}));

const { applyWorkFile, toWorkFile } = await import('../src/renderer/session/work-file.js');
const { circuitForJudge } = await import('../src/renderer/session/inspect-repair.js');
const { useStore } = await import('../src/renderer/app/store.js');
const { parseWorkFile } = await import('../src/main/work-files.js');

function problemOf(id: string): InspectRepairProblem {
  const found = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === id);
  if (found === undefined) throw new Error(`${id} なし`);
  return found;
}

/** 故障0件の課題を作れないので、実測どおり2箇所の C2 を使う。 */
const C2 = problemOf('c2-001');

/** 保存 → JSON → main の検証 → renderer へ、という本物の往復を通す。 */
function roundTrip(): Record<string, unknown> {
  const state = useStore.getState();
  if (state.problem === undefined || state.session === undefined) throw new Error('no session');
  const file = toWorkFile(state.problem.id, state.session, state.elapsedMs, state.hazards.length);
  const parsed = parseWorkFile(JSON.parse(JSON.stringify(file)) as unknown);
  if (!parsed.ok) throw new Error(`main が断った: ${parsed.message}`);
  return parsed.file as unknown as Record<string, unknown>;
}

/** 故障を白線で直し、指摘も入れる（E2E がUIで行うのと同じ結果をストア上で作る）。 */
function repairAndReport(problem: InspectRepairProblem): FaultReport[] {
  const circuit = useStore.getState().circuit;
  const session = useStore.getState().session;
  if (circuit === undefined || session === undefined) throw new Error('no circuit');
  const reference = buildReferenceSession(problem, JIPM_BOARD);
  if (!reference.ok) throw new Error('reference');
  const correct = reference.value.session;
  const reports: FaultReport[] = [];
  let wires = [...session.wires];
  let index = 0;
  for (const site of circuit.applied.sites) {
    if (site.kind === 'wire-missing') {
      const terminal = site.terminals[0];
      if (terminal !== undefined) {
        reports.push({ target: { terminalId: terminal }, kind: 'wire-missing' });
      }
    } else if (site.wireId !== undefined) {
      reports.push({
        target: { wireId: site.wireId },
        kind: site.kind === 'wire-misrouted' ? 'wire-misrouted' : 'wire-open',
      });
      wires = wires.filter((w) => w.id !== site.wireId);
    } else if (site.partId !== undefined) {
      reports.push({ target: { partId: site.partId }, kind: 'part-defect' });
    }
    const original = correct.wires.find((w) => w.id === site.wireId);
    if (original !== undefined) {
      index += 1;
      wires.push({
        ...original,
        id: toWireId(`w-white-${String(index)}`),
        color: '白',
        locked: false,
      });
    }
  }
  const next: BoardSession = { ...session, wires };
  useStore.getState().setSession(next);
  for (const report of reports) useStore.getState().addReport(report);
  return reports;
}

function judgeNow(problem: InspectRepairProblem): { passed: boolean; detail: unknown } {
  const state = useStore.getState();
  if (state.circuit === undefined || state.session === undefined) throw new Error('no circuit');
  const outcome = judgeInspectRepair(
    problem,
    JIPM_BOARD,
    circuitForJudge(state.circuit, state.session),
    state.reports,
  );
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));
  return { passed: outcome.value.passed, detail: outcome.value };
}

beforeEach(() => {
  bridgeMock.sent = [];
  apiState.readProblem.mockReset();
  useStore.getState().abandonSession();
  useStore.setState({ toasts: [], logLines: [] });
});

describe('C2 の作業ファイルを本物の判定まで往復させる（probe 3 の lift）', () => {
  it('修復して合格する盤を保存→復元しても、同じ故障・同じ判定になる（modifications 空）', async () => {
    useStore.getState().openProblem(C2);
    repairAndReport(C2);
    const beforeJudge = judgeNow(C2);
    expect(beforeJudge.passed).toBe(true);

    const file = roundTrip();

    useStore.getState().abandonSession();
    apiState.readProblem.mockResolvedValue(C2);
    expect(await applyWorkFile(file as never)).toBe(true);

    const outcome = judgeNow(C2).detail as { modifications: unknown[]; passed: boolean };
    expect(outcome.passed).toBe(true);
    expect(outcome.modifications).toHaveLength(0);
  });
});
