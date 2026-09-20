import type { Mismatch } from '@ojt/circuit-sim';
import type { StaticCheckResult, WiringSuspect } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import { JA } from '../src/renderer/i18n/ja.js';
import {
  mismatchKind,
  mismatchLine,
  verdictSummary,
  type VerdictInput,
} from '../src/renderer/result/verdict-summary.js';

/**
 * 1行要約（指摘 UX-13 / PR-03。Phase 7 Task 25）。
 * 優先順位の全分岐と、疑いが0件のときの落とし方を確かめる。
 */

function mismatch(patch: Partial<Mismatch> = {}): Mismatch {
  return {
    tMs: 520,
    signal: 'PL1',
    expected: true,
    actual: false,
    reason: 'missing',
    ...patch,
  };
}

function check(ok: boolean, patch: Partial<StaticCheckResult> = {}): StaticCheckResult {
  return {
    id: 'wireColorRule',
    ok,
    message: '線色の決まりに反しています',
    details: ['CR1.9 と PB1.2 の線が黄色です'],
    ...patch,
  };
}

function suspect(patch: Partial<WiringSuspect> = {}): WiringSuspect {
  return {
    kind: 'missing',
    terminals: ['CR1.13', 'N.1'] as unknown as WiringSuspect['terminals'],
    devices: ['CR1'],
    cellIds: ['c01'],
    wireIds: [],
    message: 'CR1 ⑬ と N の間の線がありません',
    ...patch,
  };
}

function input(patch: Partial<VerdictInput> = {}): VerdictInput {
  return { passed: false, staticChecks: [], mismatches: [], ...patch };
}

describe('mismatchKind（差分の言い回しの選び方）', () => {
  it('期待が「点く」なら点かなかった言い回しになる', () => {
    expect(mismatchKind(mismatch({ expected: true }))).toBe('on');
    expect(mismatchKind(mismatch({ expected: 1 }))).toBe('on');
  });

  it('期待が「消える」なら消えなかった言い回しになる', () => {
    expect(mismatchKind(mismatch({ expected: false }))).toBe('off');
    expect(mismatchKind(mismatch({ expected: 0 }))).toBe('off');
    expect(mismatchKind(mismatch({ expected: undefined }))).toBe('off');
  });

  it('時刻ずれ・余分・未知の信号はそれぞれ別の言い回しになる', () => {
    expect(mismatchKind(mismatch({ reason: 'timing' }))).toBe('timing');
    expect(mismatchKind(mismatch({ reason: 'extra' }))).toBe('extra');
    expect(mismatchKind(mismatch({ reason: 'unknown-signal' }))).toBe('unknown');
  });

  it('値違いも期待していた向きで言い分ける', () => {
    expect(mismatchKind(mismatch({ reason: 'value', expected: true }))).toBe('on');
    expect(mismatchKind(mismatch({ reason: 'value', expected: false }))).toBe('off');
  });
});

describe('mismatchLine（信号名を表示名にする。指摘 UX-11）', () => {
  it('内部の名前ではなく盤の呼び名で書く', () => {
    const line = mismatchLine(mismatch());
    expect(line).toContain('白ランプ（PL1）');
    expect(line).toContain('点きませんでした');
  });

  it('表に無い信号名はそのまま出す', () => {
    expect(mismatchLine(mismatch({ signal: 'X0' }))).toContain('X0');
  });

  it('余分な変化・未知の信号もそれぞれの文になる', () => {
    expect(mismatchLine(mismatch({ reason: 'extra' }))).toContain('模範回路には無い変化');
    expect(mismatchLine(mismatch({ reason: 'unknown-signal' }))).toContain('模範回路に無い信号');
    expect(mismatchLine(mismatch({ reason: 'timing' }))).toContain('ずれました');
    expect(mismatchLine(mismatch({ expected: false }))).toContain('消えませんでした');
  });
});

describe('verdictSummary（優先順位）', () => {
  it('合格なら合格の1行を返す', () => {
    const summary = verdictSummary(input({ passed: true }), []);
    expect(summary.source).toBe('passed');
    expect(summary.text).toBe(JA.result.summaryPassed);
  });

  it('(1) 静的チェックのエラーが最優先（差分より先に読ませる）', () => {
    const summary = verdictSummary(
      input({
        staticChecks: [check(true, { id: 'terminalLimit' }), check(false)],
        mismatches: [mismatch()],
      }),
      [suspect()],
    );
    expect(summary.source).toBe('static-check');
    expect(summary.text).toContain(JA.staticCheck.wireColorRule);
    expect(summary.text).toContain('CR1.9 と PB1.2 の線が黄色です');
    // 症状は静的チェックに譲るが、次の一手（疑いの先頭）は必ず添える
    expect(summary.text).toContain('CR1 ⑬ と N の間の線がありません');
    expect(summary.text).not.toContain('白ランプ');
  });

  it('静的チェックに `details` が無ければ `message` を使う', () => {
    const summary = verdictSummary(input({ staticChecks: [check(false, { details: [] })] }));
    expect(summary.text).toContain('線色の決まりに反しています');
  });

  it('(2) 静的チェックが通っていれば疑わしい配線の先頭が次の一手になる', () => {
    const summary = verdictSummary(input({ mismatches: [mismatch()] }), [
      suspect(),
      suspect({ message: '2件目' }),
    ]);
    expect(summary.source).toBe('suspect');
    expect(summary.fix?.message).toBe('CR1 ⑬ と N の間の線がありません');
    // 設計 §PR-03 の例のとおり「症状 → 最初に直す1件」の順に並ぶ
    expect(summary.text).toBe(
      `白ランプ（PL1）が 0.52 s に点きませんでした。 まず「${JA.result.suspects}」の1件目（CR1 ⑬ と N の間の線がありません）を直してください。`,
    );
  });

  it('(3) 疑いが0件なら配線以外（部品の設定と操作の順序）へ誘導する', () => {
    const summary = verdictSummary(input({ mismatches: [mismatch()] }), []);
    expect(summary.source).toBe('mismatch');
    expect(summary.fix).toBeUndefined();
    expect(summary.text).toContain('白ランプ（PL1）');
    expect(summary.text).toContain(JA.result.noSuspect);
  });

  it('疑いを渡さないモード（C1/C2/D）では配線の1文を足さない', () => {
    const summary = verdictSummary(input({ mismatches: [mismatch()] }));
    expect(summary.source).toBe('mismatch');
    expect(summary.text).not.toContain(JA.result.noSuspect);
    expect(summary.text).toContain('白ランプ（PL1）');
  });

  it('出すものが何も無ければ空の1行になる（画面は出さない）', () => {
    const summary = verdictSummary(input());
    expect(summary.source).toBe('none');
    expect(summary.text).toBe('');
  });

  it('差分が無くても疑いがあれば次の一手だけを出す', () => {
    const summary = verdictSummary(input(), [suspect()]);
    expect(summary.source).toBe('suspect');
    expect(summary.text).toBe(
      `まず「${JA.result.suspects}」の1件目（CR1 ⑬ と N の間の線がありません）を直してください。`,
    );
  });
});
