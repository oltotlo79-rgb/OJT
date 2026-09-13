import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  addWire,
  CatalogError,
  CHECK_SOCKET_ID,
  createSession,
  DEFAULT_INVENTORY,
  DEFAULT_SOCKET_ROLES,
  DEFAULT_TIMER_PRESET_MS,
  DEFAULT_TIMER_RANGE,
  isMountableKind,
  isSocketRole,
  JIPM_BOARD,
  MOUNTABLE_KINDS,
  plug,
  remainingInventory,
  RoleError,
  setPreset,
  snapPresetToStep,
  SOCKET_ROLES,
  socketOf,
  socketPartId,
  TASK1_SOCKET_ROLES,
  TASK2_SOCKET_ROLES,
  TIMER_RANGE_10S,
  TIMER_RANGE_60S,
  TIMER_RANGES,
  toPhysicalTerminal,
  trySocketOf,
  validateSocketRoles,
  type SocketRoles,
} from '../src/index.js';

const board = JIPM_BOARD;

function t(id: string): TerminalId {
  return id as TerminalId;
}

describe('roles: 役割一覧とチェック用ソケットの固定（§6.1 / §6.3）', () => {
  it('役割の一覧が単一の情報源になっている', () => {
    expect(SOCKET_ROLES).toEqual(['CR1', 'CR2', 'CR3', 'CR4', 'T1', 'T2', 'CHK']);
    for (const role of SOCKET_ROLES) expect(isSocketRole(role)).toBe(true);
    expect(isSocketRole('CHK2')).toBe(false);
  });

  it('CHK は S7 に固定（既設のチェック回路が S7 に結線されているため）', () => {
    const misplaced: SocketRoles = { S1: 'CR1', S3: 'CHK' };
    expect(validateSocketRoles(misplaced)).toContain(
      `チェック用役割 CHK は ${CHECK_SOCKET_ID} に固定です`,
    );
    expect(validateSocketRoles(DEFAULT_SOCKET_ROLES)).toEqual([]);
    expect(validateSocketRoles(TASK1_SOCKET_ROLES)).toEqual([]);
    expect(validateSocketRoles(TASK2_SOCKET_ROLES)).toEqual([]);
  });

  it('割り当てのない役割は undefined を返す／例外を投げる の両方を選べる', () => {
    expect(trySocketOf(TASK2_SOCKET_ROLES, 'T1')).toBe('S5');
    expect(trySocketOf(TASK1_SOCKET_ROLES, 'T1')).toBeUndefined();
    expect(() => socketOf(TASK1_SOCKET_ROLES, 'T1')).toThrow(RoleError);
  });

  it('未割当の役割の端子IDはそのまま返す（呼び出し側が未知端子として扱える）', () => {
    expect(toPhysicalTerminal(TASK1_SOCKET_ROLES, t('T1.9'))).toBe('T1.9');
    expect(toPhysicalTerminal(TASK2_SOCKET_ROLES, t('T1.9'))).toBe('S5.9');
  });

  it('ピン番号が数字でない端子IDは RoleError（`CR1.09` を 9 と読み替えない）', () => {
    expect(() => toPhysicalTerminal(DEFAULT_SOCKET_ROLES, t('CR1.09'))).toThrow(RoleError);
    expect(() => toPhysicalTerminal(DEFAULT_SOCKET_ROLES, t('CR1.09'))).toThrow(/CR1\.09/);
    expect(() => toPhysicalTerminal(DEFAULT_SOCKET_ROLES, t('CR1.coil'))).toThrow(RoleError);
  });

  it('ソケットの部品IDは PartId として返る', () => {
    expect(socketPartId(DEFAULT_SOCKET_ROLES, 'S1')).toBe('CR1');
    expect(socketPartId(DEFAULT_SOCKET_ROLES, 'S8')).toBe('S8');
  });
});

describe('catalog: 種別・レンジ・丸めのガード（§5.3.2 / §6.6）', () => {
  it('装着できる種別の一覧が単一の情報源になっている', () => {
    expect(MOUNTABLE_KINDS).toEqual(['relay-my4n', 'timer-h3y4']);
    for (const kind of MOUNTABLE_KINDS) expect(isMountableKind(kind)).toBe(true);
    expect(isMountableKind('timer-h3y')).toBe(false);
  });

  it('既定レンジはレンジ一覧の 0〜10s と同一オブジェクト', () => {
    expect(DEFAULT_TIMER_RANGE).toBe(TIMER_RANGE_10S);
    expect(TIMER_RANGES).toEqual([TIMER_RANGE_10S, TIMER_RANGE_60S]);
    expect(TIMER_RANGES[0]).toBe(TIMER_RANGE_10S);
    expect(TIMER_RANGES[1]).toBe(TIMER_RANGE_60S);
  });

  it('丸めは四捨五入・下限は分解能・上限はレンジ', () => {
    expect(snapPresetToStep(3050, TIMER_RANGE_10S)).toBe(3100);
    expect(snapPresetToStep(3049, TIMER_RANGE_10S)).toBe(3000);
    // 0〜60s レンジは 0.5秒刻みなので下限も 500ms になる
    expect(snapPresetToStep(120, TIMER_RANGE_60S)).toBe(500);
    expect(snapPresetToStep(10, TIMER_RANGE_10S)).toBe(100);
    expect(snapPresetToStep(999_999, TIMER_RANGE_60S)).toBe(60_000);
    expect(() => snapPresetToStep(Number.NaN, TIMER_RANGE_10S)).toThrow(CatalogError);
    expect(() => snapPresetToStep(Number.POSITIVE_INFINITY, TIMER_RANGE_10S)).toThrow(CatalogError);
  });

  it('残り在庫は負にならず、在庫に無い種別は結果にも現れない', () => {
    const inventory = [{ kind: 'relay-my4n' as const, count: 1 }];
    expect(remainingInventory(inventory, ['relay-my4n', 'relay-my4n', 'timer-h3y4'])).toEqual([
      { kind: 'relay-my4n', count: 0 },
    ]);
    expect(remainingInventory([], ['relay-my4n'])).toEqual([]);
  });

  it('既定の在庫と既定のタイマ設定値（調査資料 §2.1）', () => {
    expect(DEFAULT_INVENTORY).toEqual([
      { kind: 'relay-my4n', count: 4 },
      { kind: 'timer-h3y4', count: 2 },
    ]);
    expect(DEFAULT_TIMER_PRESET_MS).toBe(3000);
  });
});

describe('session: 不正な設定値・未割当役割の端子は例外にしない（§8.2）', () => {
  it('非有限な設定値は invalid-preset で失敗する', () => {
    const s = createSession(board);
    const bad = plug(s, 'S5', 'timer-h3y4', { presetMs: Number.NaN });
    if (bad.ok) throw new Error('unreachable');
    expect(bad.code).toBe('invalid-preset');
    expect(s.mounted.S5).toBeUndefined();

    expect(plug(s, 'S5', 'timer-h3y4').ok).toBe(true);
    const badSet = setPreset(s, 'S5', Number.POSITIVE_INFINITY);
    if (badSet.ok) throw new Error('unreachable');
    expect(badSet.code).toBe('invalid-preset');
    expect(s.mounted.S5).toEqual({ kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 });
  });

  it('未割当の役割・形式の壊れた端子IDへの配線は unknown-terminal で失敗する', () => {
    const s = createSession(board, { roles: TASK1_SOCKET_ROLES });
    const unassigned = addWire(s, board, t('T1.9'), t('P.1'));
    if (unassigned.ok) throw new Error('unreachable');
    expect(unassigned.code).toBe('unknown-terminal');

    const malformed = addWire(s, board, t('CR1.09'), t('P.1'));
    if (malformed.ok) throw new Error('unreachable');
    expect(malformed.code).toBe('unknown-terminal');

    const outOfRange = addWire(s, board, t('CR1.99'), t('P.1'));
    if (outOfRange.ok) throw new Error('unreachable');
    expect(outOfRange.code).toBe('unknown-terminal');
  });
});
