import { addWire, createSession, JIPM_BOARD, plug, removeWire } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '../src/builtin/index.js';
import { buildReferenceSession } from '../src/reference.js';
import { MAX_WIRING_SUSPECTS, wiringSuspects } from '../src/wiring-diff.js';

const found = BUILTIN_ASSEMBLE_PROBLEMS.find((p) => p.id === 'b-001');
if (found === undefined) throw new Error('b-001 が見つかりません');
// 巻き上げられる関数宣言（`referenceSession()`）の中でも型が絞られているように、別の const に移す。
const problem = found;

/** 模範回路そのままの盤。 */
function referenceSession() {
  const built = buildReferenceSession(problem, JIPM_BOARD);
  if (!built.ok) throw new Error(built.errors.map((e) => e.message).join(' / '));
  return built.value;
}

/** 何も疑うところが無いときの戻り。 */
const CLEAN = { suspects: [], total: 0, omitted: 0 };

describe('wiringSuspects（UXレビュー #28）', () => {
  it('finds nothing when the board matches the reference circuit', () => {
    expect(wiringSuspects(problem, JIPM_BOARD, referenceSession().session)).toEqual(CLEAN);
  });

  it('reports the pair that a removed wire used to join', () => {
    const { session } = referenceSession();
    const victim = session.wires.find((w) => !w.locked);
    expect(victim).toBeDefined();
    if (victim === undefined) return;
    const removed = removeWire(session, victim.id);
    expect(removed.ok).toBe(true);
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, session);
    expect(suspects.length).toBeGreaterThan(0);
    const first = suspects[0];
    expect(first?.kind).toBe('missing');
    expect(first?.terminals).toHaveLength(2);
    expect(first?.message).toContain('つながっていません');
    // ハイライトに使える情報が揃っている
    expect(first?.cellIds.length).toBeGreaterThan(0);
  });

  it('reports an extra connection that the reference circuit does not have', () => {
    const { session } = referenceSession();
    // PB2 の b接点の出口（TB_PB.2b＝自己保持の合流点）と PL1 の ＋ 端子（TB_PL.1+）を勝手に繋ぐ。
    // 比べる端子は回路図の要素が使う端子に限る（決定表#9）ので、どちらも模範回路が使う端子を選ぶ。
    const added = addWire(
      session,
      JIPM_BOARD,
      toTerminalId('TB_PB.2b'),
      toTerminalId('TB_PL.1+'),
      '青',
      { id: 'extra-1' },
    );
    expect(added.ok).toBe(true);
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, session);
    const extra = suspects.find((s) => s.kind === 'extra');
    expect(extra).toBeDefined();
    expect(extra?.message).toContain('余計につながっています');
    expect(extra?.wireIds).toContain('extra-1');
  });

  it('is blind to the order of the bus chain (§11.3 の渡り配線)', () => {
    // 母線の鎖を組み替えても電気的に同じなら疑いは出ない
    const { session, roles } = referenceSession();
    const busP = toTerminalId('P.1');
    const chain = session.wires.filter((w) => !w.locked && (w.from === busP || w.to === busP));
    expect(chain.length).toBeGreaterThan(0);
    // 同じ節点のまま別の端子へ付け替えるのは盤の規則が許さないので、ここでは
    // 「鎖の向きを逆にした電線」を張り直して同じ節点になることを確かめる
    const target = chain[0];
    expect(target).toBeDefined();
    if (target === undefined) return;
    expect(removeWire(session, target.id).ok).toBe(true);
    expect(
      addWire(session, JIPM_BOARD, target.to, target.from, target.color, { id: target.id }).ok,
    ).toBe(true);
    expect(roles).toBeDefined();
    expect(wiringSuspects(problem, JIPM_BOARD, session)).toEqual(CLEAN);
  });

  it('caps the list at MAX_WIRING_SUSPECTS on an unwired board', () => {
    const bare = createSession(JIPM_BOARD, { roles: referenceSession().roles });
    expect(plug(bare, 'S1', 'relay-my4n').ok).toBe(true);
    const report = wiringSuspects(problem, JIPM_BOARD, bare);
    expect(report.suspects.length).toBe(MAX_WIRING_SUSPECTS);
    expect(report.suspects.every((s) => s.kind === 'missing')).toBe(true);
    // 「ほかに N 件」を出すための数（決定表#27）
    expect(report.total).toBeGreaterThan(MAX_WIRING_SUSPECTS);
    expect(report.omitted).toBe(report.total - report.suspects.length);
  });

  it('survives a board whose relay socket is still empty', () => {
    // 部品を挿していない盤では CR1 の端子がネットリストに無い。落ちずに「つながっていません」を挙げる
    const bare = createSession(JIPM_BOARD, { roles: referenceSession().roles });
    const report = wiringSuspects(problem, JIPM_BOARD, bare);
    expect(report.suspects.length).toBe(MAX_WIRING_SUSPECTS);
    expect(report.suspects.every((s) => s.kind === 'missing')).toBe(true);
  });

  it('omits nothing when the list fits', () => {
    const { session } = referenceSession();
    const victim = session.wires.find((w) => !w.locked);
    if (victim === undefined) return;
    removeWire(session, victim.id);
    const report = wiringSuspects(problem, JIPM_BOARD, session);
    expect(report.total).toBe(report.suspects.length);
    expect(report.omitted).toBe(0);
  });

  it('names the devices so the message reads like the schematic', () => {
    const { session } = referenceSession();
    const victim = session.wires.find((w) => !w.locked);
    if (victim === undefined) return;
    removeWire(session, victim.id);
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, session);
    for (const suspect of suspects) {
      expect(suspect.devices.length).toBeGreaterThan(0);
      for (const device of suspect.devices) {
        expect(device).toMatch(/^(CR[1-4]|T[12]|PB[1-4]|PL[1-4]|BZ|P|N)$/u);
      }
    }
  });

  it('returns nothing when the problem reference circuit cannot be built', () => {
    const broken = { ...problem, board: { ...problem.board, boardId: 'nope' } };
    expect(wiringSuspects(broken, JIPM_BOARD, referenceSession().session)).toEqual(CLEAN);
  });
});
