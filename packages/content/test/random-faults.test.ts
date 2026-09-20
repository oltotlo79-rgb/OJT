import { JIPM_BOARD } from '@ojt/board-model';
import { compareLogs } from '@ojt/circuit-sim';
import { describe, expect, it, vi } from 'vitest';
import { buildInspectRepairCircuit, repairNetlist } from '../src/inspect-repair.js';
import {
  MAX_RANDOM_FAULT_ATTEMPTS,
  MAX_RANDOM_FAULT_MILLIS,
  RANDOM_FAULT_KINDS,
  resolveFaults,
} from '../src/random-faults.js';
import { buildReferenceSession } from '../src/reference.js';
import { runOperations } from '../src/runner.js';
import { inspectRepairProblemJson, parseInspectRepairOrThrow } from './helpers/inspect.js';

const FALLBACK = [{ target: { wireId: 'sw-004' }, kind: 'wire-open' }];

function problemWithRandom(random: Record<string, unknown>) {
  return parseInspectRepairOrThrow({ ...inspectRepairProblemJson(), faults: { random } });
}

describe('RANDOM_FAULT_KINDS', () => {
  it('offers the repairable kinds only (no lamp-open)', () => {
    expect(RANDOM_FAULT_KINDS).toContain('wire-open');
    expect(RANDOM_FAULT_KINDS).toContain('contact-welded');
    expect(RANDOM_FAULT_KINDS).toContain('coil-open');
    expect(RANDOM_FAULT_KINDS).not.toContain('lamp-open');
  });

  it('caps the retries at 100', () => {
    expect(MAX_RANDOM_FAULT_ATTEMPTS).toBe(100);
  });
});

describe('resolveFaults', () => {
  it('returns an explicit list unchanged', () => {
    const problem = parseInspectRepairOrThrow(inspectRepairProblemJson());
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toEqual(problem.faults);
  });

  it('draws the requested number of faults from the given types', () => {
    const problem = problemWithRandom({
      count: 2,
      types: ['wire-open', 'wire-missing'],
      seed: 12345,
      fallback: [...FALLBACK, { target: { wireId: 'sw-005' }, kind: 'wire-missing' }],
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toHaveLength(2);
    for (const fault of resolved.value) {
      expect(['wire-open', 'wire-missing']).toContain(fault.kind);
      expect('wireId' in fault.target).toBe(true);
    }
  });

  it('gives the same faults for the same seed and different ones for another seed', () => {
    const make = (seed: number) =>
      resolveFaults(
        problemWithRandom({
          count: 2,
          types: ['wire-open'],
          seed,
          fallback: [...FALLBACK, { target: { wireId: 'sw-005' }, kind: 'wire-open' }],
        }),
        JIPM_BOARD,
      );
    const a = make(4242);
    const b = make(4242);
    const c = make(777);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(b.value).toEqual(a.value);
    expect(JSON.stringify(c.value)).not.toBe(JSON.stringify(a.value));
  });

  it('never picks the same wire twice and never touches the locked check wiring', () => {
    const problem = problemWithRandom({
      count: 3,
      types: ['wire-open'],
      seed: 31337,
      fallback: [
        { target: { wireId: 'sw-004' }, kind: 'wire-open' },
        { target: { wireId: 'sw-005' }, kind: 'wire-open' },
        { target: { wireId: 'sw-006' }, kind: 'wire-open' },
      ],
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const ids = resolved.value.map((f) => ('wireId' in f.target ? f.target.wireId : ''));
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id.startsWith('fw-chk')).toBe(false);
  });

  it('falls back to the explicit list when the retries run out', () => {
    const problem = problemWithRandom({
      count: 1,
      types: ['wire-open'],
      seed: 5,
      fallback: FALLBACK,
    });
    const resolved = resolveFaults(problem, JIPM_BOARD, { maxAttempts: 0 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toEqual(FALLBACK);
  });

  it('rejects a type that cannot be repaired on this board', () => {
    const problem = problemWithRandom({
      count: 1,
      types: ['lamp-open'],
      seed: 5,
      fallback: FALLBACK,
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.errors[0]?.path).toBe('faults.random.types');
    expect(resolved.errors[0]?.message).toContain('lamp-open');
  });

  it('mixes wire and part faults when both are allowed', () => {
    const problem = problemWithRandom({
      count: 2,
      types: ['wire-open', 'coil-open'],
      seed: 2026,
      fallback: [...FALLBACK, { target: { wireId: 'sw-005' }, kind: 'wire-open' }],
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toHaveLength(2);
    for (const fault of resolved.value) {
      expect(['wire-open', 'coil-open']).toContain(fault.kind);
    }
  });

  it('can draw a misrouted wire when it is among the allowed types', () => {
    // fallback も wire-misrouted にしておくことで、100回引き直しても条件を満たさず
    // フォールバックに落ちた場合でも種別の主張は変わらない（非決定を気にしないテストにする）。
    const fallback = [{ target: { wireId: 'sw-002' }, kind: 'wire-misrouted', to: 'CR1.12' }];
    const problem = problemWithRandom({
      count: 1,
      types: ['wire-misrouted'],
      seed: 2024,
      fallback,
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toHaveLength(1);
    expect(resolved.value[0]?.kind).toBe('wire-misrouted');
  });

  it('can draw a non-coil contact fault when it is among the allowed types', () => {
    // fallback も contact-welded にしておき、上と同じ理由で非決定を気にしないテストにする。
    const fallback = [{ target: { partId: 'CR1', elementIndex: 2 }, kind: 'contact-welded' }];
    const problem = problemWithRandom({
      count: 1,
      types: ['contact-welded'],
      seed: 99,
      fallback,
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toHaveLength(1);
    expect(resolved.value[0]?.kind).toBe('contact-welded');
  });

  it('lets options.seed override the problem faults.random.seed', () => {
    const withSeed5 = problemWithRandom({
      count: 1,
      types: ['wire-open'],
      seed: 5,
      fallback: FALLBACK,
    });
    const withSeed6 = problemWithRandom({
      count: 1,
      types: ['wire-open'],
      seed: 6,
      fallback: FALLBACK,
    });
    const a = resolveFaults(withSeed5, JIPM_BOARD, { seed: 777 });
    const b = resolveFaults(withSeed6, JIPM_BOARD, { seed: 777 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // problem 側の seed（5 と 6）が違っても、options.seed が同じなら同じ結果になる。
    expect(b.value).toEqual(a.value);
  });

  it('resolves without throwing when faults.random.seed is entirely omitted (uses Date.now())', () => {
    const problem = problemWithRandom({ count: 1, types: ['wire-open'], fallback: FALLBACK });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toHaveLength(1);
  });

  it('rejects a candidate that would trip short-circuit-power-on and tries again (§7.5)', () => {
    // seed 9 の最初の wire-misrouted の組合せ（sw-008 → CR1.2）は P-N 短絡を起こすことを
    // ブルートフォースで確認済み。resolveFaults はこれを isUsable() で弾いて引き直し、
    // それでも最終的には（別の組合せで）解決できる。
    const problem = problemWithRandom({
      count: 1,
      types: ['wire-misrouted'],
      seed: 9,
      fallback: [{ target: { wireId: 'sw-002' }, kind: 'wire-misrouted', to: 'CR1.12' }],
    });
    const resolved = resolveFaults(problem, JIPM_BOARD);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toHaveLength(1);
    expect(resolved.value[0]?.kind).toBe('wire-misrouted');
  });

  it('propagates a reference-session build failure (board mismatch)', () => {
    const problem = problemWithRandom({
      count: 1,
      types: ['wire-open'],
      seed: 1,
      fallback: FALLBACK,
    });
    const mismatched = { ...problem, board: { ...problem.board, boardId: 'not-a-real-board' } };
    const resolved = resolveFaults(mismatched, JIPM_BOARD);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.errors[0]?.path).toBe('board.boardId');
  });

  it('exhausts an attempt and retries when there are fewer faultable parts than requested', () => {
    // このC2課題ではチェック用を除く部品はCR1だけなので、同じ種別で2件要求すると
    // 「別の部品を引けない」ため毎回そのアテンプトを捨てる（§7.5 の引き直し）。
    // fallback は同じ部品に2つの部品故障を入れられない（CT-03）ので、部品故障1つ＋電線故障1つにする。
    const fallback = [
      { target: { partId: 'CR1', elementIndex: 0 }, kind: 'coil-open' },
      { target: { wireId: 'sw-004' }, kind: 'wire-open' },
    ];
    const problem = problemWithRandom({ count: 2, types: ['coil-open'], seed: 8, fallback });
    const resolved = resolveFaults(problem, JIPM_BOARD, { maxAttempts: 3 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toEqual(fallback);
  });
});

describe('resolveFaults fallback validation (レビュー I4)', () => {
  it('rejects a fallback that cannot be applied to the board', () => {
    const problem = problemWithRandom({
      count: 1,
      types: ['wire-open'],
      seed: 5,
      fallback: [{ target: { wireId: 'sw-999' }, kind: 'wire-open' }],
    });
    const resolved = resolveFaults(problem, JIPM_BOARD, { maxAttempts: 0 });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.errors[0]?.path).toBe('faults.random.fallback');
  });

  it('reports fellBack when it has to use a usable fallback', () => {
    const problem = problemWithRandom({
      count: 1,
      types: ['wire-open'],
      seed: 5,
      fallback: FALLBACK,
    });
    const resolved = resolveFaults(problem, JIPM_BOARD, { maxAttempts: 0 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toEqual(FALLBACK);
    expect(resolved.fellBack).toBe(true);
  });

  it('reports fellBack false for a drawn set and for an explicit list', () => {
    const drawn = resolveFaults(
      problemWithRandom({ count: 1, types: ['wire-open'], seed: 12345, fallback: FALLBACK }),
      JIPM_BOARD,
    );
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    expect(drawn.fellBack).toBe(false);
    const explicit = resolveFaults(
      parseInspectRepairOrThrow(inspectRepairProblemJson()),
      JIPM_BOARD,
    );
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.fellBack).toBe(false);
  });

  it('falls back when the time budget is exhausted (maxMillis)', () => {
    expect(MAX_RANDOM_FAULT_MILLIS).toBe(5000);
    const problem = problemWithRandom({
      count: 1,
      types: ['wire-open'],
      seed: 12345,
      fallback: FALLBACK,
    });
    const resolved = resolveFaults(problem, JIPM_BOARD, { maxMillis: 0 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toEqual(FALLBACK);
    expect(resolved.fellBack).toBe(true);
  });

  it('does not apply the default wall-clock budget when a seed is explicit, so a slow machine gets the same result as a fast one (CT-04)', () => {
    // 既定の壁時計予算（`options.maxMillis` を省略したときの `MAX_RANDOM_FAULT_MILLIS`）は
    // `Date.now()` 依存なので、機械が遅いと同じ seed でも先に時間切れへ落ちてしまっていた。
    // `Date.now()` を「1回目の呼び出し以降は既定予算をとうに超えた時刻」に固定し、
    // 「遅い機械」を模しても、seed明示なら既定の壁時計予算そのものを適用しないので
    // 通常どおり候補が引けて `fellBack: false` になることを確かめる。
    const problem = problemWithRandom({
      count: 2,
      types: ['wire-open'],
      seed: 12345,
      fallback: [...FALLBACK, { target: { wireId: 'sw-005' }, kind: 'wire-open' }],
    });
    const now = vi.spyOn(Date, 'now');
    let calls = 0;
    // 1回目の呼び出し（デッドライン計算がもしあれば、そこ）は0msを返し、以後は既定予算を
    // とうに超えた時刻を返す（＝「遅い機械」を模す）。seed明示ならデッドライン計算自体を
    // 行わないため、このモックは1回も呼ばれないはず。
    now.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? 0 : MAX_RANDOM_FAULT_MILLIS * 10;
    });
    try {
      const resolved = resolveFaults(problem, JIPM_BOARD);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.fellBack).toBe(false);
    } finally {
      now.mockRestore();
    }
  });
});

describe('resolveFaults seed sweep (§7.5 の2条件)', () => {
  it('draws an applicable, non shorting and detectable set for 20 seeds', () => {
    const base = parseInspectRepairOrThrow(inspectRepairProblemJson());
    const reference = buildReferenceSession(base, JIPM_BOARD);
    if (!reference.ok) throw new Error(JSON.stringify(reference.errors));
    const expected = runOperations(reference.value.netlist, base.operations, {
      durationMs: base.durationMs,
    });
    for (let seed = 1; seed <= 20; seed += 1) {
      const problem = problemWithRandom({
        count: 1,
        types: ['wire-open', 'wire-missing', 'coil-open', 'contact-welded'],
        seed,
        fallback: FALLBACK,
      });
      const resolved = resolveFaults(problem, JIPM_BOARD);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      const built = buildInspectRepairCircuit(problem, JIPM_BOARD, {
        resolvedFaults: resolved.value,
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const { netlist, errors } = repairNetlist(built.value, JIPM_BOARD);
      expect(errors).toEqual([]);
      const run = runOperations(netlist, base.operations, { durationMs: base.durationMs });
      expect(run.events.hazards('short-circuit-power-on')).toHaveLength(0);
      const diff = compareLogs(expected.log, run.log, ['PL1'], base.judge.tolerance);
      expect(diff.length).toBeGreaterThan(0);
    }
  });
});
