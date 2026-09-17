import { toTerminalId } from '@ojt/circuit-sim';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
} from '@ojt/content';
import { beforeEach, describe, expect, it } from 'vitest';
import { isInspectJudge, useStore } from '../src/renderer/app/store.js';
import { NO_HIGHLIGHT } from '../src/renderer/app/store-types.js';

/**
 * 3モードを開けるストア（Plan 2B Task 4）。設計仕様 §12.1 / §9.1 / §9.2。
 */

const B = BUILTIN_ASSEMBLE_PROBLEMS[0];
const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];
const C2_GRADE2 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 2);
const C2_GRADE1 = BUILTIN_INSPECT_REPAIR_PROBLEMS.find((p) => p.grade === 1);

beforeEach(() => {
  useStore.getState().abandonSession();
  useStore.setState({ route: 'home', problems: undefined });
});

describe('openProblem（§12.1）', () => {
  it('モードBは従来どおり盤を作ってセッション画面へ進む', () => {
    expect(B).toBeDefined();
    if (B === undefined) return;
    useStore.getState().openProblem(B);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.problem?.mode).toBe('assemble');
    expect(state.session?.allowedColors).toEqual(['青']);
    expect(state.circuit).toBeUndefined();
  });

  it('モードC1は空のチェック用盤で開き、線色パレットが空になる（配線しない。§9.1）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    useStore.getState().openProblem(C1);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.problem?.mode).toBe('inspect-parts');
    expect(state.session?.allowedColors).toEqual([]);
    expect(state.session?.mounted).toEqual({});
    expect(state.checkPartId).toBeUndefined();
    expect(state.answers).toEqual([]);
  });

  it('モードC2は故障を注入した初期盤で開き、線色パレットが白のみになる（§8.1 / §9.2）', () => {
    expect(C2_GRADE2).toBeDefined();
    if (C2_GRADE2 === undefined) return;
    useStore.getState().openProblem(C2_GRADE2);
    const state = useStore.getState();
    expect(state.route).toBe('session');
    expect(state.circuit).toBeDefined();
    expect(state.session?.allowedColors).toEqual(['白']);
    expect(state.wireColor).toBe('白');
    // 故障が2箇所入っている（§17.2 #4）
    expect(state.circuit?.applied.sites).toHaveLength(2);
    expect(state.reports).toEqual([]);
  });

  it('C2の回路図ヒントは課題の hints が決める（2級は出す・1級は出さない。§9.2）', () => {
    expect(C2_GRADE2).toBeDefined();
    expect(C2_GRADE1).toBeDefined();
    if (C2_GRADE2 === undefined || C2_GRADE1 === undefined) return;
    useStore.getState().openProblem(C2_GRADE2);
    expect(useStore.getState().schematicVisible).toBe(true);
    useStore.getState().openProblem(C2_GRADE1);
    expect(useStore.getState().schematicVisible).toBe(false);
  });
});

describe('テスターの状態（§9.3）', () => {
  it('初期は デジタル・つまみOFF・次は黒', () => {
    const state = useStore.getState();
    expect(state.tester.kind).toBe('digital');
    expect(state.tester.mode).toBe('off');
    expect(state.nextProbe).toBe('black');
  });

  it('プローブを置くと次に置く側が入れ替わり、外すとその側が次になる', () => {
    const store = useStore.getState();
    store.applyTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') });
    expect(useStore.getState().nextProbe).toBe('red');
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'red', terminal: toTerminalId('CHK.14') });
    expect(useStore.getState().nextProbe).toBe('black');
    // 外す（`terminal: undefined`）と、次に置くのは外した側になる。§9.3
    useStore.getState().applyTester({ type: 'place-probe', probe: 'red', terminal: undefined });
    expect(useStore.getState().nextProbe).toBe('red');
  });

  it('プローブの側を明示的に選べる', () => {
    useStore.getState().setNextProbe('red');
    expect(useStore.getState().nextProbe).toBe('red');
  });

  it('clearProbes はプローブだけ外し、つまみは残す（§9.1 部品の挿し替え）', () => {
    const store = useStore.getState();
    store.applyTester({ type: 'set-mode', mode: 'OHM' });
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') });
    useStore.getState().clearProbes();
    const after = useStore.getState();
    expect(after.tester.black).toBeUndefined();
    expect(after.tester.red).toBeUndefined();
    expect(after.tester.zeroAdjusted).toBe(false);
    expect(after.nextProbe).toBe('black');
    expect(after.tester.mode).toBe('OHM');
  });

  it('課題を開き直すとテスターは初期状態に戻る', () => {
    expect(B).toBeDefined();
    if (B === undefined) return;
    useStore.getState().applyTester({ type: 'set-mode', mode: 'OHM' });
    useStore.getState().openProblem(B);
    expect(useStore.getState().tester.mode).toBe('off');
  });
});

describe('マークシートと指摘', () => {
  it('同じ部品の解答は上書きされる（排他選択。§17.2 #5）', () => {
    const store = useStore.getState();
    store.setAnswer('p1', 'normal');
    store.setAnswer('p2', 'coil-open');
    store.setAnswer('p1', 'coil-layer-short');
    expect(useStore.getState().answers).toEqual([
      { partId: 'p1', answer: 'coil-layer-short' },
      { partId: 'p2', answer: 'coil-open' },
    ]);
  });

  it('指摘は追加と取り消しができる（§9.2）', () => {
    const store = useStore.getState();
    store.addReport({ target: { wireId: 'sw-001' }, kind: 'wire-open' });
    store.addReport({ target: { terminalId: 'CR1.13' }, kind: 'wire-missing' });
    expect(useStore.getState().reports).toHaveLength(2);
    useStore.getState().removeReport(0);
    expect(useStore.getState().reports).toEqual([
      { target: { terminalId: 'CR1.13' }, kind: 'wire-missing' },
    ]);
  });
});

describe('警告バナーとハイライト', () => {
  it('危険操作が届くとバナーに最後の1件が載る（§5.6 / §13）', () => {
    useStore.getState().applySnapshot({
      ...useStore.getState().snapshot,
      hazardDelta: [
        { type: 'hazard', kind: 'ohm-on-live', tMs: 100, detail: 'CHK.13' },
        { type: 'hazard', kind: 'range-exceeded', tMs: 120, detail: 'DCV 2.5V レンジ' },
      ],
    });
    const state = useStore.getState();
    expect(state.hazardBanner?.kind).toBe('range-exceeded');
    expect(state.hazards).toHaveLength(2);
    useStore.getState().dismissHazard();
    expect(useStore.getState().hazardBanner).toBeUndefined();
  });

  it('ハイライトは設定と解除ができる（§9.2）', () => {
    useStore
      .getState()
      .setHighlight({ cellIds: ['c1'], terminals: ['CR1.13'], wireIds: ['sw-001'] });
    expect(useStore.getState().highlight.cellIds).toEqual(['c1']);
    useStore.getState().setHighlight(NO_HIGHLIGHT);
    expect(useStore.getState().highlight).toEqual(NO_HIGHLIGHT);
  });
});

describe('isInspectJudge', () => {
  it('mode を持つ結果だけが点検系', () => {
    expect(
      isInspectJudge({
        mode: 'inspect-parts',
        passed: true,
        correctCount: 2,
        total: 2,
        scores: [],
        hazardCount: 0,
        hazardsByKind: {
          'ohm-on-live': 0,
          'range-exceeded': 0,
          'short-circuit-power-on': 0,
          'power-sequence-violation': 0,
          'over-wires-per-terminal': 0,
          overcurrent: 0,
        },
      }),
    ).toBe(true);
  });
});
