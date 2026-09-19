import {
  createSession,
  JIPM_BOARD,
  routeSession,
  TASK2_SOCKET_ROLES,
  type BoardSession,
} from '@ojt/board-model';
import { toTerminalId, wireId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import { safeRoutes, visualSignature } from '../src/renderer/three/BoardScene.js';
import { EMPTY_SNAPSHOT, useStore, type AppState } from '../src/renderer/app/store.js';
import type { SimSnapshot } from '../src/worker/protocol.js';

/**
 * 3Dシーンの純粋な部分のテスト（§6.6 / §15）。
 * `safeRoutes()` は「1本でも経路が解けなくても盤は描き続ける」ことの要。
 * `visualSignature()` は「絵が変わったときだけ描く」判断そのもの。
 */

function freshSession(): BoardSession {
  return createSession(JIPM_BOARD, { roles: TASK2_SOCKET_ROLES, allowedColors: ['青'] });
}

describe('safeRoutes（§6.6）', () => {
  it('セッションが無ければ空を返す', () => {
    expect(safeRoutes(JIPM_BOARD, undefined)).toEqual({ routes: [], errors: [] });
  });

  it('全部解ければ routeSession と同じ本数を返し、エラーは無い', () => {
    const session = freshSession();
    const { routes, errors } = safeRoutes(JIPM_BOARD, session);
    expect(errors).toEqual([]);
    expect(routes).toHaveLength(routeSession(JIPM_BOARD, session).length);
  });

  it('経路の作れない電線が1本混ざっても、他の電線は描けて理由だけが返る', () => {
    const session = freshSession();
    const before = safeRoutes(JIPM_BOARD, session).routes.length;
    /*
     * 経路の作れない電線を1本足す。盤に無い端子を指していれば経路器が
     * `RoutingError('invalid-terminal')` で断る（保存した作業を新しい盤定義で開いたときに起きうる）。
     */
    session.wires.push({
      id: wireId('w-broken'),
      from: toTerminalId('S1.9'),
      to: toTerminalId('NOPE.1'),
      color: '青',
      locked: false,
      open: false,
    });
    const { routes, errors } = safeRoutes(JIPM_BOARD, session);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.wireId).toBe('w-broken');
    expect(errors[0]?.reason).toBeTruthy();
    // 解けた電線はそのまま描ける（盤が真っ黒にならない）
    expect(routes).toHaveLength(before);
    expect(routes.some((r) => r.wireId === 'w-broken')).toBe(false);
  });

  /**
   * 1D2-a のレビュー指摘: 以前は `RoutingError` 以外を投げ直していたため、壊れた作業ファイル
   * （電線の位置に文字列が入っている等）を読むと `toPhysicalTerminal()` の `TypeError` が
   * 描画のたびに出て、例外バナーの「セッションをリセット」を押しても同じ例外で落ち続けた。
   */
  it.each([
    ['電線が文字列', ['not-a-wire']],
    ['電線が null', [null]],
    ['端子が undefined', [{ id: 'w-x', color: '青', locked: false, open: false }]],
    ['端子が数値', [{ id: 'w-x', from: 1, to: 2, color: '青', locked: false, open: false }]],
  ])('壊れた電線（%s）が混ざっても投げない', (_label, wires) => {
    const session = freshSession();
    const before = safeRoutes(JIPM_BOARD, session).routes.length;
    const broken = { ...session, wires: [...session.wires, ...wires] } as unknown as BoardSession;

    const result = safeRoutes(JIPM_BOARD, broken);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.wireId).toBeTruthy();
    expect(result.errors[0]?.reason).toBe('invalid-terminal');
    expect(result.routes).toHaveLength(before);
  });

  it('wires が配列ですらなくても投げない', () => {
    const broken = { ...freshSession(), wires: 'nope' } as unknown as BoardSession;
    expect(safeRoutes(JIPM_BOARD, broken)).toEqual({ routes: [], errors: [] });
  });
});

describe('visualSignature（§15 再描画の判断）', () => {
  function stateWith(patch: Partial<AppState>): AppState {
    return { ...useStore.getState(), ...patch };
  }

  it('時刻と電流だけが動いても署名は変わらない（毎秒30枚のスナップショットで描き直さない）', () => {
    const base = stateWith({ snapshot: EMPTY_SNAPSHOT });
    const moved = stateWith({
      snapshot: { ...EMPTY_SNAPSHOT, tMs: 12_345, sourceAmps: 0.421 },
    });
    expect(visualSignature(moved)).toBe(visualSignature(base));
  });

  it('ランプ・リレー・タイマ・押ボタン・通電・遮断は署名を変える', () => {
    const base = visualSignature(stateWith({ snapshot: EMPTY_SNAPSHOT }));
    const changes: Array<Partial<SimSnapshot>> = [
      { lamps: { PL1: { level: 'lit', volts: 24 } } },
      { relays: { CR1: { coilOn: true, contactsOn: true, coilVolts: 24 } } },
      { timers: { T1: { powered: true, timedOut: false, elapsedMs: 0, presetMs: 3000 } } },
      { buttons: { PB1: true } },
      { powered: true },
      { tripped: true },
    ];
    for (const patch of changes) {
      const next = visualSignature(stateWith({ snapshot: { ...EMPTY_SNAPSHOT, ...patch } }));
      expect(next, JSON.stringify(patch)).not.toBe(base);
    }
  });

  it('ホバー・配線待ち・電線の選択・モード・視点は署名を変える', () => {
    const base = visualSignature(stateWith({}));
    const changes: Array<Partial<AppState>> = [
      { hoveredTerminal: toTerminalId('S1.9') },
      { pendingTerminal: toTerminalId('S1.9') },
      { selectedWire: 'w-001' },
      { mode: 'delete' },
      { camera: 'socket' },
      // 同じプリセットを押し直しても視点は動くので、番号も署名に入っている
      { cameraNonce: useStore.getState().cameraNonce + 1 },
    ];
    for (const patch of changes) {
      expect(visualSignature(stateWith(patch)), JSON.stringify(patch)).not.toBe(base);
    }
  });

  it('電線の本数と装着が変わると署名も変わる', () => {
    const session = freshSession();
    const base = visualSignature(stateWith({ session }));
    const plugged: BoardSession = {
      ...session,
      mounted: { ...session.mounted, S1: { kind: 'relay-my4n' } },
    };
    expect(visualSignature(stateWith({ session: plugged }))).not.toBe(base);
  });
});

describe('visualSignature: 絵に効かない更新では変わらない（§15 / Plan 5 決定表#16）', () => {
  it('ignores the clock, the voltages and the tester needle', () => {
    const base = useStore.getState();
    const before = visualSignature(base);
    const after = visualSignature({
      ...base,
      snapshot: {
        ...base.snapshot,
        tMs: base.snapshot.tMs + 1000,
        sourceAmps: 0.42,
        droppedTicks: 3,
        tester: { ...base.snapshot.tester, needleDeg: 17.5, value: 23.9 },
      },
    });
    expect(after).toBe(before);
  });

  it('changes when the schematic guide lights a terminal', () => {
    const base = useStore.getState();
    const before = visualSignature(base);
    const after = visualSignature({
      ...base,
      highlight: { cellIds: ['c1'], terminals: ['CR1.14'], wireIds: [] },
    });
    expect(after).not.toBe(before);
  });
});
