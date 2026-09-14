import { createSession, JIPM_BOARD, TASK2_SOCKET_ROLES } from '@ojt/board-model';
import { toTerminalId, wireId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  cloneSession,
  emptyHistory,
  HISTORY_LIMIT,
  pushCommand,
  redo,
  runAddWire,
  runPlug,
  runRemoveWire,
  runSetPreset,
  runUnplug,
  undo,
} from '../src/renderer/session/commands.js';

function session() {
  return createSession(JIPM_BOARD, { roles: TASK2_SOCKET_ROLES, allowedColors: ['青'] });
}

describe('runAddWire', () => {
  it('端子を結んで電線を1本足す', () => {
    const s = session();
    const before = s.wires.length;
    const result = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    expect(result.ok).toBe(true);
    expect(s.wires.length).toBe(before + 1);
  });

  it('許可されていない線色は拒否する（モードBは青のみ。§8.1）', () => {
    const result = runAddWire(session(), toTerminalId('P.1'), toTerminalId('CR1.14'), '白');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('color-not-allowed');
  });

  it('1端子3本目は拒否する（§6.6 / §5.6 #5）', () => {
    const s = session();
    runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    runAddWire(s, toTerminalId('P.1'), toTerminalId('CR2.14'), '青');
    const third = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR3.14'), '青');
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe('terminal-overload');
  });

  it('PB本体端子には配線できない（§6.4）', () => {
    const result = runAddWire(session(), toTerminalId('PB1.a'), toTerminalId('CR1.14'), '青');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('terminal-not-wirable');
  });
});

describe('runRemoveWire', () => {
  it('張った電線を外せる', () => {
    const s = session();
    const added = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const removed = runRemoveWire(s, added.value.id);
    expect(removed.ok).toBe(true);
  });

  it('チェック用回路の黄色配線は外せない（§6.3）', () => {
    const s = session();
    const locked = s.wires.find((w) => w.locked);
    expect(locked).toBeDefined();
    const result = runRemoveWire(s, locked?.id ?? '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('locked-wire');
  });
});

describe('runPlug / runUnplug / runSetPreset', () => {
  it('ソケットに装着して外せる', () => {
    const s = session();
    expect(runPlug(s, 'S1', 'relay-my4n').ok).toBe(true);
    expect(s.mounted['S1']?.kind).toBe('relay-my4n');
    expect(runUnplug(s, 'S1').ok).toBe(true);
    expect(s.mounted['S1']).toBeUndefined();
  });

  it('埋まっているソケットには装着できない', () => {
    const s = session();
    runPlug(s, 'S1', 'relay-my4n');
    const again = runPlug(s, 'S1', 'relay-my4n');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('socket-occupied');
  });

  it('タイマの設定値はレンジの分解能に丸める（0〜10sレンジは0.1s刻み。§5.3.2）', () => {
    const s = session();
    runPlug(s, 'S3', 'timer-h3y4');
    expect(runSetPreset(s, 'S3', 3040).ok).toBe(true);
    const mounted = s.mounted['S3'];
    expect(mounted?.kind === 'timer-h3y4' ? mounted.presetMs : 0).toBe(3000);
  });

  it('リレーにタイマ設定はできない', () => {
    const s = session();
    runPlug(s, 'S1', 'relay-my4n');
    const result = runSetPreset(s, 'S1', 3000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not-a-timer');
  });
});

describe('コマンド履歴', () => {
  it('元に戻すと配線前の状態へ戻る', () => {
    const s = session();
    const before = s.wires.length;
    const result = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const history = pushCommand(emptyHistory(), result.command);
    const undone = undo(history);
    expect(undone?.session.wires.length).toBe(before);
    const redone = redo(undone?.history ?? emptyHistory());
    expect(redone?.session.wires.length).toBe(before + 1);
  });

  it('新しい手を積むとやり直し列は消える', () => {
    const s = session();
    const first = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    const second = runAddWire(s, toTerminalId('N.1'), toTerminalId('CR1.13'), '青');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    let history = pushCommand(emptyHistory(), first.command);
    const undone = undo(history);
    expect(undone).toBeDefined();
    history = pushCommand(undone?.history ?? emptyHistory(), second.command);
    expect(history.undone).toHaveLength(0);
  });

  it('上限50手を超えた古い手は捨てる（§8.2）', () => {
    const s = session();
    const result = runAddWire(s, toTerminalId('P.1'), toTerminalId('CR1.14'), '青');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let history = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) history = pushCommand(history, result.command);
    expect(history.done).toHaveLength(HISTORY_LIMIT);
  });

  it('空の履歴は戻せない・やり直せない', () => {
    expect(undo(emptyHistory())).toBeUndefined();
    expect(redo(emptyHistory())).toBeUndefined();
  });
});

describe('cloneSession', () => {
  it('電線配列と装着状態を共有しない（履歴のスナップショットが壊れないこと）', () => {
    const s = session();
    const copy = cloneSession(s);
    const first = s.wires[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    copy.wires.push({ ...first, id: wireId('w-copy') });
    expect(copy.wires.length).toBe(s.wires.length + 1);
    copy.mounted['S1'] = { kind: 'relay-my4n' };
    expect(s.mounted['S1']).toBeUndefined();
  });
});
