import type { JudgePlcResult, StaticCheckId } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import {
  checkAdvice,
  explainPowerCheck,
  failureReasons,
} from '../src/renderer/session/plc-explain.js';

/**
 * 結果画面の説明文（Plan 3B Task 13）。設計仕様 §10.8 / 3A ハンドオフ注記 H-5。
 * 文言そのものではなく「端子IDの形」で落ち方を見分けることを確かめる。
 */

describe('explainPowerCheck（3A H-5 / 決定表#15c）', () => {
  it('合格なら何も足さない', () => {
    expect(
      explainPowerCheck({ id: 'plcPowerIndependent', ok: true, message: 'OK', details: [] }),
    ).toEqual([]);
  });

  it('盤から取っていることを文言ではなく端子IDで見分ける', () => {
    const lines = explainPowerCheck({
      id: 'plcPowerIndependent',
      ok: false,
      message: '',
      details: ['PLC.L が P.1 と同じ節点にあります'],
    });
    expect(lines[0]).toContain('壁コンセント');
    expect(lines[0]).toContain('盤');
    expect(lines.at(-1)).toContain('未配線でも動作します');
  });

  it('未配線の場合を見分ける', () => {
    const lines = explainPowerCheck({
      id: 'plcPowerIndependent',
      ok: false,
      message: '',
      details: ['PLC.L がどこにも繋がっていません'],
    });
    expect(lines[0]).toContain('2本配線');
    expect(lines[0]).not.toContain('盤から');
    expect(lines.at(-1)).toContain('未配線でも動作します');
  });

  it('両方起きていれば両方言う', () => {
    const lines = explainPowerCheck({
      id: 'plcPowerIndependent',
      ok: false,
      message: '',
      details: ['PLC.L が SW.2 と同じ節点にあります', 'PLC.N がどこにも繋がっていません'],
    });
    expect(lines).toHaveLength(3);
  });

  it('他のチェックには何も言わない', () => {
    expect(explainPowerCheck({ id: 'twoStage', ok: false, message: '', details: ['x'] })).toEqual(
      [],
    );
  });
});

/** 判定結果の骨組み（合格・差分なし）。 */
function plcResult(overrides: Partial<JudgePlcResult> = {}): JudgePlcResult {
  return {
    mode: 'plc',
    passed: true,
    mismatches: [],
    staticChecks: [],
    hazardCount: 0,
    hazardsByKind: {
      'ohm-on-live': 0,
      'range-exceeded': 0,
      'short-circuit-power-on': 0,
      'power-sequence-violation': 0,
      'over-wires-per-terminal': 0,
      overcurrent: 0,
    },
    chatter: [],
    charts: {
      expected: { durationMs: 6000, signals: [], markers: [] },
      actual: { durationMs: 6000, signals: [], markers: [] },
    },
    compareSignals: ['PL1'],
    ladderErrors: [],
    ladderWarnings: [],
    ...overrides,
  };
}

describe('checkAdvice（2026-09-19 の利用者決定「何をすればよいかまで書く」）', () => {
  it('二段構成とI/O割付には直し方を返す', () => {
    expect(checkAdvice('twoStage')).toContain('リレー');
    expect(checkAdvice('ioAssignment')).toContain('割付');
  });

  /** Batch 4+5 レビュー M11: 9件すべてに用意する（`static-check-types.ts` の全ID）。 */
  it('判定に出うる静的チェック9件すべてに直し方がある', () => {
    const ids: readonly StaticCheckId[] = [
      'wireColorRule',
      'terminalLimit',
      'unusedParts',
      'forbiddenCircuit',
      'coilPolarity',
      'powerSequence',
      'twoStage',
      'plcPowerIndependent',
      'ioAssignment',
    ];
    for (const id of ids) {
      expect(checkAdvice(id).length).toBeGreaterThan(0);
    }
  });

  it('見覚えの無いIDには汎用の言い方へ落とす', () => {
    expect(checkAdvice('unknown-check' as StaticCheckId)).toBe('配線の指摘を確認してください。');
  });
});

describe('failureReasons（不合格の理由を先に出す）', () => {
  it('合格なら理由は無い', () => {
    expect(failureReasons(plcResult())).toEqual([]);
  });

  it('変換エラーを最初に言う', () => {
    const lines = failureReasons(
      plcResult({
        passed: false,
        ladderErrors: [{ code: 'missing-end', networkId: '', message: 'END がありません' }],
        staticChecks: [{ id: 'twoStage', ok: false, message: '', details: ['直結しています'] }],
      }),
    );
    expect(lines[0]).toContain('変換');
    expect(lines[1]).toContain('二段構成');
  });

  it('落ちた静的チェックは見出し・指摘・直し方の3点で言う', () => {
    const lines = failureReasons(
      plcResult({
        passed: false,
        staticChecks: [
          { id: 'twoStage', ok: true, message: 'OK', details: [] },
          {
            id: 'twoStage',
            ok: false,
            message: '',
            details: ['PLC.Y0 がリレー CR1 のコイル（CR1.14）に繋がっていません'],
          },
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('二段構成');
    expect(lines[0]).toContain('CR1.14');
    expect(lines[0]).toContain('→');
  });

  /*
   * Batch 4+5 レビュー M11: `explainPowerCheck()` の詳しい説明（`plc-power-help` カード）とは
   * 別の短い助言を添える。長い言い換え（`2本配線してください`）を1行に重ねない。
   */
  it('PLC電源の独立には専用の短い直し方を添える（H-5の説明カードとは重ねない）', () => {
    const lines = failureReasons(
      plcResult({
        passed: false,
        staticChecks: [
          {
            id: 'plcPowerIndependent',
            ok: false,
            message: '',
            details: ['PLC.L が壁コンセントに配線されていません'],
          },
        ],
      }),
    );
    expect(lines[0]).toContain('壁コンセント');
    expect(lines[0]).not.toContain('2本配線');
  });

  it('差分は信号名と時刻を添えて並べ、多いときは件数でまとめる', () => {
    const lines = failureReasons(
      plcResult({
        passed: false,
        mismatches: [
          { signal: 'PL1', tMs: 1200, expected: true, actual: false, reason: 'value' },
          { signal: 'PL2', tMs: 2400, expected: false, actual: true, reason: 'timing' },
          { signal: 'PL3', tMs: 3600, expected: true, actual: false, reason: 'missing' },
          { signal: 'PL4', tMs: 4800, expected: true, actual: false, reason: 'extra' },
        ],
      }),
    );
    expect(lines[0]).toContain('PL1');
    expect(lines[0]).toContain('1.20');
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toContain('1');
  });
});
