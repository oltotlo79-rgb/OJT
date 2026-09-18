import { toTerminalId, wireId } from '@ojt/circuit-sim';
import {
  BUILTIN_ASSEMBLE_PROBLEMS,
  BUILTIN_INSPECT_PARTS_PROBLEMS,
  BUILTIN_INSPECT_REPAIR_PROBLEMS,
  type InspectRepairProblem,
} from '@ojt/content';
import { beforeEach, describe, expect, it } from 'vitest';
import { isInspectJudge, useStore } from '../src/renderer/app/store.js';
import { NO_HIGHLIGHT } from '../src/renderer/app/store-types.js';
import { JA } from '../src/renderer/i18n/ja.js';

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

  it('C2の盤は circuit.session と別オブジェクト（M8。盤の操作で circuit.session を書き換えない）', () => {
    expect(C2_GRADE2).toBeDefined();
    if (C2_GRADE2 === undefined) return;
    useStore.getState().openProblem(C2_GRADE2);
    const state = useStore.getState();
    expect(state.session).not.toBe(state.circuit?.session);
    expect(state.session).toEqual(state.circuit?.session);
  });

  it(
    'C2の回路図ヒントは既定で閉じる。2級は開閉でき、1級はそもそも出さない' +
      '（§9.2 / §8.4 2026-09-18の決定）',
    () => {
      expect(C2_GRADE2).toBeDefined();
      expect(C2_GRADE1).toBeDefined();
      if (C2_GRADE2 === undefined || C2_GRADE1 === undefined) return;
      useStore.getState().openProblem(C2_GRADE2);
      // 2級も初期は閉じている（Session.tsx の `showSchematic` が `policy.toggleable` を見て
      // 開閉を決める。ストアの `schematicVisible` はどちらの級でも false から始まる）
      expect(useStore.getState().schematicVisible).toBe(false);
      expect(useStore.getState().schematicOpenCount).toBe(0);
      useStore.getState().openProblem(C2_GRADE1);
      expect(useStore.getState().schematicVisible).toBe(false);
    },
  );
});

describe('回路図ヒントを開いた回数（モードB/C2共用。§8.4 2026-09-18の決定）', () => {
  it('toggleSchematic は閉→開のときだけ数え、開→閉では増えない', () => {
    expect(C2_GRADE2).toBeDefined();
    if (C2_GRADE2 === undefined) return;
    useStore.getState().openProblem(C2_GRADE2);
    expect(useStore.getState().schematicOpenCount).toBe(0);
    useStore.getState().toggleSchematic(); // 開く
    expect(useStore.getState().schematicVisible).toBe(true);
    expect(useStore.getState().schematicOpenCount).toBe(1);
    useStore.getState().toggleSchematic(); // 閉じる
    expect(useStore.getState().schematicOpenCount).toBe(1);
    useStore.getState().toggleSchematic(); // また開く
    expect(useStore.getState().schematicOpenCount).toBe(2);
  });

  it('課題を開き直す・「セッションをリセット」・一覧へ戻ると 0 に戻る', () => {
    expect(C2_GRADE2).toBeDefined();
    if (C2_GRADE2 === undefined) return;
    useStore.getState().openProblem(C2_GRADE2);
    useStore.getState().toggleSchematic();
    expect(useStore.getState().schematicOpenCount).toBe(1);
    useStore.getState().openProblem(C2_GRADE2);
    expect(useStore.getState().schematicOpenCount).toBe(0);

    useStore.getState().toggleSchematic();
    useStore.getState().restartSession();
    expect(useStore.getState().schematicOpenCount).toBe(0);

    useStore.getState().toggleSchematic();
    useStore.getState().abandonSession();
    expect(useStore.getState().schematicOpenCount).toBe(0);
  });

  it('setSchematicOpenCount は作業ファイルからの復元用にまるごと差し替える', () => {
    useStore.getState().setSchematicOpenCount(5);
    expect(useStore.getState().schematicOpenCount).toBe(5);
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

  it('clearProbes はプローブだけ外し、つまみと0Ω調整は残す（§9.1 部品の挿し替え）', () => {
    const store = useStore.getState();
    store.applyTester({ type: 'set-mode', mode: 'OHM' });
    useStore
      .getState()
      .applyTester({ type: 'place-probe', probe: 'black', terminal: toTerminalId('CHK.13') });
    useStore.getState().applyTester({ type: 'zero-adjust' });
    useStore.getState().clearProbes();
    const after = useStore.getState();
    expect(after.tester.black).toBeUndefined();
    expect(after.tester.red).toBeUndefined();
    // 0Ω調整はレンジに対する校正なので、プローブを動かしても落とさない（`applyTesterAction` と同じ）
    expect(after.tester.zeroAdjusted).toBe(true);
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

describe('resetSession（「もう一度」。§8.3 / Plan 2B Task 4）', () => {
  /** 訓練者が引いた白線1本（修復の途中を表す）。 */
  const WHITE_WIRE = {
    id: wireId('user-white-1'),
    from: toTerminalId('CR1.5'),
    to: toTerminalId('CR1.6'),
    color: '白' as const,
    locked: false,
    open: false,
  };

  it('C2は同じ故障のまま、修復前の盤に戻す（plan L2107）', () => {
    expect(C2_GRADE2).toBeDefined();
    if (C2_GRADE2 === undefined) return;
    useStore.getState().openProblem(C2_GRADE2);
    const opened = useStore.getState();
    const seedBefore = opened.faultSeed;
    const sitesBefore = structuredClone(opened.circuit?.applied.sites);
    const wiresBefore = structuredClone(opened.session?.wires);
    expect(sitesBefore).toBeDefined();
    expect(wiresBefore).toBeDefined();

    /*
     * `session`（訓練者が触る盤）へ白線を足す。`circuit.session` はもう別オブジェクト
     * （レビュー指摘 M8）なので `setSession()` を通して反映する。
     */
    const session = opened.session;
    if (session === undefined) return;
    useStore.getState().setSession({ ...session, wires: [...session.wires, { ...WHITE_WIRE }] });
    expect(useStore.getState().session?.wires.some((w) => w.id === WHITE_WIRE.id)).toBe(true);

    useStore.getState().resetSession();

    const after = useStore.getState();
    // 種も故障の在処もそのまま（別の故障を引き直さない）
    expect(after.faultSeed).toBe(seedBefore);
    expect(after.circuit?.applied.sites).toEqual(sitesBefore);
    // 盤は修復前に戻る（白線は消え、故障入りの電線が戻っている）
    expect(after.session?.wires).toEqual(wiresBefore);
    expect(after.session?.wires.some((w) => w.id === WHITE_WIRE.id)).toBe(false);
    expect(after.session?.wires.find((w) => w.id === 'sw-005')?.open).toBe(true);
    expect(after.sessionEpoch).toBe(opened.sessionEpoch + 1);
  });

  it('ランダム故障で種を持たない課題でも、同じ故障のまま再挑戦できる（2A I-4）', () => {
    expect(C2_GRADE2).toBeDefined();
    if (C2_GRADE2 === undefined) return;
    // 利用者フォルダに置かれうる形（`faults.random` ＋ seed 無し）を内蔵課題から作る
    const random: InspectRepairProblem = {
      ...C2_GRADE2,
      id: 'u-c2-random',
      faults: {
        random: {
          count: 2,
          types: ['wire-open', 'wire-missing'],
          fallback: [...(Array.isArray(C2_GRADE2.faults) ? C2_GRADE2.faults : [])],
        },
      },
    };
    useStore.getState().openProblem(random);
    const sitesBefore = structuredClone(useStore.getState().circuit?.applied.sites);
    expect(sitesBefore).toBeDefined();

    useStore.getState().resetSession();

    expect(useStore.getState().circuit?.applied.sites).toEqual(sitesBefore);
  }, 30_000);
});

describe('restartSession の最後の手段（§13 #5 / Plan 2B Task 14）', () => {
  it('モードBは素の盤を作り直して同じ課題に留まる', () => {
    expect(B).toBeDefined();
    if (B === undefined) return;
    useStore.getState().openProblem(B);
    useStore.getState().restartSession();
    useStore.getState().restartSession();
    const after = useStore.getState();
    expect(after.route).toBe('session');
    expect(after.problem?.id).toBe(B.id);
    expect(after.session).toBeDefined();
  });

  it('点検系（C1/C2）は故障入りの盤を作り直せないので課題一覧へ戻す', () => {
    expect(C2_GRADE2).toBeDefined();
    if (C2_GRADE2 === undefined) return;
    useStore.getState().openProblem(C2_GRADE2);
    useStore.getState().restartSession();
    useStore.getState().restartSession();
    const after = useStore.getState();
    expect(after.route).toBe('list');
    expect(after.problem).toBeUndefined();
    expect(after.session).toBeUndefined();
    // 故障の無い青い盤で「再開しました」と言わない（盤を作り直せないことを知らせる）
    expect(after.toasts.at(-1)?.text).toBe(JA.error.boardAbandoned);
  });
});
