import { createSession as createCheckSession } from '@ojt/board-model';
import { addWire, createSession, JIPM_BOARD, plug, removeWire } from '@ojt/board-model';
import { toTerminalId, type TerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSEMBLE_PROBLEMS } from '../src/builtin/index.js';
import { buildReferenceSession } from '../src/reference.js';
import { MAX_WIRING_SUSPECTS, wiringSuspects } from '../src/wiring-diff.js';
import { parseOrThrow, selfHoldProblemJson } from './helpers/problems.js';

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

  it('never highlights a locked fixed wire, even when it touches the same terminal (I3)', () => {
    // fw-chk-1（既設固定配線。青・locked）は P.1 に繋がっている（§6.3）。母線の渡り配線の
    // 先頭（P.1 に繋がる非lockedの電線）を1本外すと、その疑いの wireIds に fw-chk-1 が
    // 紛れ込んでいた（訓練者は変更できない電線なので、光らせても直しようが無い）。
    const { session } = referenceSession();
    session.wires.push(...createCheckSession(JIPM_BOARD, { includeCheckWires: true }).wires);
    const busP = toTerminalId('P.1');
    const lockedIds = new Set<string>(session.wires.filter((w) => w.locked).map((w) => w.id));
    expect(lockedIds.has('fw-chk-1')).toBe(true);
    const chainHead = session.wires.find((w) => !w.locked && (w.from === busP || w.to === busP));
    expect(chainHead).toBeDefined();
    if (chainHead === undefined) return;
    expect(removeWire(session, chainHead.id).ok).toBe(true);
    const { suspects } = wiringSuspects(problem, JIPM_BOARD, session);
    expect(suspects.length).toBeGreaterThan(0);
    for (const suspect of suspects) {
      for (const wireId of suspect.wireIds) expect(lockedIds.has(wireId)).toBe(false);
    }
    // P.1 を含む疑いが少なくとも1件はある（このケースを実際に確かめるため）
    expect(suspects.some((s) => s.terminals.includes(busP))).toBe(true);
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

  it('gives BZ+ and BZ- each their own suspect instead of collapsing into one (M-f)', () => {
    // 課題は BZ を使う（extraParts）。訓練者の盤には BZ が無い（extraParts に足していない）ので、
    // `BZ.+` も `BZ.-` もネットリストに無い（= どちらも `nodeOf()` が undefined を返す）。
    // 2つの「無い端子」を同じ節点と誤認すると、どちらか一方の疑いが消えてしまう。
    const json = selfHoldProblemJson();
    const board = json.board as Record<string, unknown>;
    const schematic = json.schematic as { rungs: unknown[] };
    const bzProblem = parseOrThrow({
      ...json,
      board: { ...board, extraParts: ['BZ'] },
      schematic: {
        ...schematic,
        rungs: [
          ...schematic.rungs,
          {
            id: 'r-bz',
            from: { bus: 'P' },
            to: { bus: 'N' },
            cells: [{ kind: 'buzzer', id: 'c-bz', device: 'BZ' }],
          },
        ],
      },
    });
    const ref = buildReferenceSession(bzProblem, JIPM_BOARD);
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;

    // 参照と同じ配線を、BZ の2端子に触れる分だけ除いて再現する（＝「BZ が無い盤」）
    const trainee = createSession(JIPM_BOARD, { roles: ref.value.roles, extraParts: [] });
    expect(plug(trainee, 'S1', 'relay-my4n').ok).toBe(true);
    const bzPlus = toTerminalId('BZ.+');
    const bzMinus = toTerminalId('BZ.-');
    for (const w of ref.value.session.wires) {
      if (w.locked) continue; // createSession が既に同じ既設配線を張っている
      if (w.from === bzPlus || w.to === bzPlus || w.from === bzMinus || w.to === bzMinus) continue;
      expect(addWire(trainee, JIPM_BOARD, w.from, w.to, w.color, { id: w.id }).ok).toBe(true);
    }

    const report = wiringSuspects(bzProblem, JIPM_BOARD, trainee);
    const bzSuspects = report.suspects.filter((s) => s.devices.includes('BZ'));
    // BZ.+ 側と BZ.- 側、それぞれ別の疑いとして出る（1件に潰れない）
    expect(bzSuspects).toHaveLength(2);
    const terminals = bzSuspects.flatMap((s) => s.terminals);
    expect(terminals).toContain(bzPlus);
    expect(terminals).toContain(bzMinus);
    // BZ 以外はすべて参照どおりに再現できているので、BZ がらみ以外の疑いは出ない
    expect(report.total).toBe(2);
    expect(report.omitted).toBe(0);
  });

  it('ranks a genuine gap before a contact group-choice artefact (RANKING)', () => {
    // CR1 の組1（⑨⑤）と組2（⑩⑥）を丸ごと入れ替える。電気的には模範回路と同じだが、
    // 節点分割の上では「別の組」に見える＝決定表#9bの組選びの違い（配線ミスではない）。
    // そこへ本物の欠け（PL1 まわりの電線を1本外す）を1つ混ぜ、本物の欠けが先頭に来ることを確かめる。
    const { session } = referenceSession();
    const swapMap: Readonly<Record<string, string>> = {
      'CR1.9': 'CR1.10',
      'CR1.10': 'CR1.9',
      'CR1.5': 'CR1.6',
      'CR1.6': 'CR1.5',
    };
    const swap = (id: string): TerminalId => toTerminalId(swapMap[id] ?? id);
    session.wires = session.wires.map((w) =>
      w.locked ? w : { ...w, from: swap(w.from), to: swap(w.to) },
    );
    const realGapWire = session.wires.find(
      (w) => !w.locked && (w.from.startsWith('TB_PL.1') || w.to.startsWith('TB_PL.1')),
    );
    expect(realGapWire).toBeDefined();
    if (realGapWire === undefined) return;
    expect(removeWire(session, realGapWire.id).ok).toBe(true);

    const report = wiringSuspects(problem, JIPM_BOARD, session);
    expect(report.total).toBeGreaterThan(0);
    const first = report.suspects[0];
    expect(first).toBeDefined();
    // 本物の欠け（PL1がらみ）が先頭。件数・omittedの数え方は変わらない（RANKING はソートのみ）
    expect(first?.devices).toContain('PL1');
    expect(report.omitted).toBe(report.total - report.suspects.length);
  });
});
