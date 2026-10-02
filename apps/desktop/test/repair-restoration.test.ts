import { JIPM_BOARD } from '@ojt/board-model';
import { toTerminalId, type Wire } from '@ojt/circuit-sim';
import {
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  buildInspectRepairCircuit,
  modificationWireIds,
  type FaultReport,
} from '@ojt/content';
import { describe, expect, it } from 'vitest';
import {
  cloneSession,
  emptyHistory,
  pushCommand,
  redo,
  runAddWire,
  runRemoveWire,
  runRestoreWire,
  undo,
} from '../src/renderer/session/commands.js';
import { editReport } from '../src/renderer/session/inspect-repair.js';

function fixture() {
  const problem = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.id === 'c2-001');
  if (problem === undefined) throw new Error('課題がありません');
  const built = buildInspectRepairCircuit(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  return { circuit: built.value, session: cloneSession(built.value.session) };
}

describe('外した青線を個別に元に戻す', () => {
  it('故障入りの線を同じID・端子・色・故障状態で戻す。修復にはならない', () => {
    const { circuit, session } = fixture();
    const original = circuit.initialWires.find((wire) => wire.open);
    expect(original).toBeDefined();
    if (!original) return;
    runRemoveWire(session, original.id);
    const restored = runRestoreWire(session, circuit, original.id);
    expect(restored.ok).toBe(true);
    expect(session.wires.find((wire) => wire.id === original.id)).toEqual(original);
    expect(session.wires.find((wire) => wire.id === original.id)).not.toBe(original);
    expect(circuit.initialWires.find((wire) => wire.id === original.id)).toEqual(original);
  });

  it('ほかの白線を残し、正常な青線を外した改造の集計だけを取り消す', () => {
    const { circuit, session } = fixture();
    const faultyIds = new Set(circuit.applied.sites.map((site) => site.wireId));
    const original = circuit.initialWires.find((wire) => !wire.locked && !faultyIds.has(wire.id));
    if (!original) throw new Error('正常な青線がありません');
    runRemoveWire(session, original.id);
    expect(modificationWireIds(circuit, session)).toContain(original.id);
    const added = runAddWire(session, toTerminalId('CR1.6'), toTerminalId('TB_PL.1+'), '白');
    expect(added.ok).toBe(true);
    const seq = session.wireSeq;
    const restored = runRestoreWire(session, circuit, original.id);
    expect(restored.ok).toBe(true);
    expect(modificationWireIds(circuit, session)).not.toContain(original.id);
    if (added.ok) expect(session.wires).toContainEqual(added.value);
    expect(session.wireSeq).toBe(seq);
  });

  it('端子の3本目になる復元は拒否し、盤を変えない', () => {
    const { circuit, session } = fixture();
    const original = circuit.initialWires.find((wire) => !wire.locked);
    if (!original) throw new Error('青線がありません');
    runRemoveWire(session, original.id);
    session.wires = session.wires.filter(
      (wire) => wire.from !== original.from && wire.to !== original.from,
    );
    const dummy = (id: string): Wire => ({
      ...original,
      id: id as Wire['id'],
      color: '白',
      to: toTerminalId('CR3.1'),
    });
    session.wires.push(dummy('repair-1'), dummy('repair-2'));
    const before = cloneSession(session);
    const result = runRestoreWire(session, circuit, original.id);
    expect(result).toMatchObject({ ok: false, code: 'terminal-overload', wire: original });
    expect(session).toEqual(before);
  });

  it('二重復元・存在しなかった線・固定線を拒否する', () => {
    const { circuit, session } = fixture();
    const original = circuit.initialWires.find((wire) => !wire.locked);
    if (!original) throw new Error('配線がありません');
    const fixed = { ...original, id: 'fixed' as Wire['id'], locked: true };
    circuit.initialWires = [...circuit.initialWires, fixed];
    const before = cloneSession(session);
    expect(runRestoreWire(session, circuit, original.id)).toMatchObject({
      ok: false,
      code: 'already-restored',
    });
    expect(runRestoreWire(session, circuit, fixed.id).ok).toBe(false);
    expect(runRestoreWire(session, circuit, 'never-present').ok).toBe(false);
    expect(session).toEqual(before);
  });

  it('復元自体も元に戻す・やり直しができる', () => {
    const { circuit, session } = fixture();
    const original = circuit.initialWires.find((wire) => !wire.locked);
    if (!original) throw new Error('青線がありません');
    runRemoveWire(session, original.id);
    const removed = cloneSession(session);
    const result = runRestoreWire(session, circuit, original.id);
    if (!result.ok) throw new Error(result.message);
    const history = pushCommand(emptyHistory(), result.command);
    const undone = undo(history);
    expect(undone?.session).toEqual(removed);
    if (!undone) throw new Error('履歴がありません');
    expect(redo(undone.history)?.session).toEqual(session);
  });
});

describe('登録済み指摘の変更', () => {
  const reports: FaultReport[] = [
    { target: { wireId: 'sw-001' }, kind: 'wire-open' },
    { target: { partId: 'CR1' }, kind: 'part-defect', detail: 'coil-open' },
  ];

  it('断線から誤配線へ変更しても指摘を増やさない', () => {
    expect(editReport(reports, 0, 'wire-misrouted')).toEqual({
      type: 'replace',
      index: 0,
      report: { target: { wireId: 'sw-001' }, kind: 'wire-misrouted' },
    });
    expect(reports[0]?.kind).toBe('wire-open');
  });

  it('部品不良の詳細だけを変え、場所を保持する', () => {
    expect(editReport(reports, 1, 'part-defect', 'contact-welded')).toEqual({
      type: 'replace',
      index: 1,
      report: { target: { partId: 'CR1' }, kind: 'part-defect', detail: 'contact-welded' },
    });
  });

  it('他の登録と重複する変更を拒否し、元の指摘を残す', () => {
    const duplicate: FaultReport = { target: { wireId: 'sw-001' }, kind: 'wire-misrouted' };
    expect(editReport([...reports, duplicate], 0, 'wire-misrouted')).toEqual({ type: 'duplicate' });
    expect(reports[0]?.kind).toBe('wire-open');
  });

  it('取り消された指摘や対象に合わない種別は変更しない', () => {
    expect(editReport(reports, 8, 'wire-open')).toEqual({ type: 'missing' });
    expect(editReport(reports, 0, 'part-defect')).toEqual({ type: 'missing' });
  });
});
