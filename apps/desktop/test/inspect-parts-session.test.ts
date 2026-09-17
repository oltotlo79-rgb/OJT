import { BUILTIN_INSPECT_PARTS_PROBLEMS, CHECK_COIL_MINUS, CHECK_COIL_PLUS } from '@ojt/content';
import { describe, expect, it } from 'vitest';
import {
  answeredCount,
  checkLoadFor,
  markSheetRows,
  probeTargets,
} from '../src/renderer/session/inspect-parts.js';

/**
 * モードC1の純関数（Plan 2B Task 8）。設計仕様 §9.1。
 */

const C1 = BUILTIN_INSPECT_PARTS_PROBLEMS[0];

describe('checkLoadFor（§9.1）', () => {
  it('トレイの部品をチェック用ソケットに挿した盤と故障を返す', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const part = C1.parts[0];
    expect(part).toBeDefined();
    if (part === undefined) return;
    const loaded = checkLoadFor(C1, part.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // チェック用ソケット（S7）に1個だけ挿さっている
    expect(Object.keys(loaded.session.mounted)).toEqual(['S7']);
    expect(loaded.session.mounted['S7']?.kind).toBe(part.kind);
    // 既設配線3本はそのまま（§6.3）
    expect(loaded.session.wires.filter((w) => w.locked)).toHaveLength(3);
    // 正常品なら故障は空、不良品なら1件
    expect(loaded.partFaults).toHaveLength(part.truth === 'normal' ? 0 : 1);
  });

  it('リレーは 100ms、タイマは 1100ms の安定待ちを返す（§9.1 手順①）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const relay = C1.parts.find((p) => p.kind === 'relay-my4n');
    expect(relay).toBeDefined();
    if (relay === undefined) return;
    const loaded = checkLoadFor(C1, relay.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.settleMs).toBe(100);
  });

  it('知らない部品IDは理由付きで断る（§13 #2）', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const loaded = checkLoadFor(C1, 'no-such-part');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.errors[0]?.message).toContain('no-such-part');
  });
});

describe('markSheetRows / answeredCount（§9.1 回答）', () => {
  it('部品ごとに1行を作り、解答済みの行に答えが入る', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    const first = C1.parts[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const rows = markSheetRows(C1, [{ partId: first.id, answer: 'coil-open' }]);
    expect(rows).toHaveLength(C1.parts.length);
    expect(rows[0]?.answer).toBe('coil-open');
    expect(rows[1]?.answer).toBeUndefined();
    // 本当の状態は行に入れない（答えが漏れる）
    expect(Object.keys(rows[0] ?? {})).toEqual(['partId', 'kind', 'answer']);
  });

  it('解答済みの件数を数える', () => {
    expect(C1).toBeDefined();
    if (C1 === undefined) return;
    expect(answeredCount(C1, [])).toBe(0);
    const ids = C1.parts.map((p) => p.id);
    expect(
      answeredCount(
        C1,
        ids.map((id) => ({ partId: id, answer: 'normal' as const })),
      ),
    ).toBe(C1.parts.length);
    // 課題に無い部品IDの解答は数えない
    expect(answeredCount(C1, [{ partId: 'ghost', answer: 'normal' }])).toBe(0);
  });
});

describe('probeTargets（§9.1 測定1・測定2）', () => {
  it('コイルと4組ぶんの a/b 接点を返す（不良の組は出さない。Plan 2A 差分 #14）', () => {
    const targets = probeTargets();
    expect(targets).toHaveLength(9);
    expect(targets[0]?.id).toBe('coil');
    expect(targets[0]?.black).toBe(CHECK_COIL_MINUS);
    expect(targets[0]?.red).toBe(CHECK_COIL_PLUS);
    expect(targets.filter((t) => t.id.startsWith('a'))).toHaveLength(4);
    expect(targets.filter((t) => t.id.startsWith('b'))).toHaveLength(4);
  });

  it('1組のa接点は CHK.9 – CHK.5（§6.2 / §9.1 測定2）', () => {
    const a1 = probeTargets().find((t) => t.id === 'a1');
    expect(a1?.black).toBe('CHK.9');
    expect(a1?.red).toBe('CHK.5');
  });

  it('1組のb接点は CHK.9 – CHK.1', () => {
    const b1 = probeTargets().find((t) => t.id === 'b1');
    expect(b1?.black).toBe('CHK.9');
    expect(b1?.red).toBe('CHK.1');
  });
});
