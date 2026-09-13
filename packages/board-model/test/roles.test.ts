import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  DEFAULT_SOCKET_ROLES,
  hasRole,
  isSocketId,
  isSocketRole,
  roleOf,
  RoleError,
  socketOf,
  socketPartId,
  TASK1_SOCKET_ROLES,
  TASK2_SOCKET_ROLES,
  terminalIdFor,
  toNetlistTerminal,
  toPhysicalTerminal,
  validateSocketRoles,
  type SocketRoles,
} from '../src/index.js';

function t(id: string): TerminalId {
  return id as TerminalId;
}

describe('roles: 役割割当と端子ID', () => {
  it('役割名がそのまま部品IDになる（§6.4）', () => {
    expect(terminalIdFor('CR1', 13)).toBe('CR1.13');
    expect(terminalIdFor('T2', 9)).toBe('T2.9');
    expect(terminalIdFor('CHK', 14)).toBe('CHK.14');
    expect(() => terminalIdFor('CR1', 0)).toThrow(RoleError);
    expect(() => terminalIdFor('CR1', 15)).toThrow(RoleError);
  });

  it('既定の割当は7役割すべてを載せ、S8 を予備にする（ソケットは8個）', () => {
    expect(DEFAULT_SOCKET_ROLES).toEqual({
      S1: 'CR1',
      S2: 'CR2',
      S3: 'CR3',
      S4: 'CR4',
      S5: 'T1',
      S6: 'T2',
      S7: 'CHK',
    });
    expect(validateSocketRoles(DEFAULT_SOCKET_ROLES)).toEqual([]);
    expect(roleOf(DEFAULT_SOCKET_ROLES, 'S8')).toBeUndefined();
    expect(socketPartId(DEFAULT_SOCKET_ROLES, 'S1')).toBe('CR1');
    expect(socketPartId(DEFAULT_SOCKET_ROLES, 'S8')).toBe('S8');
  });

  it('課題1形式・課題2形式の割当は妥当（§6.1）。残りは予備', () => {
    expect(TASK1_SOCKET_ROLES).toEqual({
      S1: 'CR1',
      S2: 'CR2',
      S3: 'CR3',
      S4: 'CR4',
      S7: 'CHK',
    });
    expect(TASK2_SOCKET_ROLES).toEqual({
      S1: 'CR1',
      S2: 'CR2',
      S5: 'T1',
      S6: 'T2',
      S7: 'CHK',
    });
    expect(validateSocketRoles(TASK1_SOCKET_ROLES)).toEqual([]);
    expect(validateSocketRoles(TASK2_SOCKET_ROLES)).toEqual([]);
    expect(roleOf(TASK1_SOCKET_ROLES, 'S5')).toBeUndefined();
  });

  it('重複・CHK欠落・不正な役割名を検出する', () => {
    const duplicated: SocketRoles = { S1: 'CR1', S2: 'CR1', S5: 'T1', S6: 'T2', S7: 'CHK' };
    expect(validateSocketRoles(duplicated)).toContain('役割が重複しています: CR1');
    const noCheck: SocketRoles = { S1: 'CR1', S2: 'CR2', S3: 'CR3', S4: 'CR4', S5: 'T1' };
    expect(validateSocketRoles(noCheck)).toContain(
      'チェック用ソケット（CHK）が割り当てられていません',
    );
    const broken = {
      S1: 'XX',
      S2: 'CR2',
      S7: 'CHK',
    } as unknown as SocketRoles;
    expect(validateSocketRoles(broken)[0]).toBe('S1 の役割が不正です: XX');
    const strange = { S1: 'CR1', S7: 'CHK', S9: 'CR2' } as unknown as SocketRoles;
    expect(validateSocketRoles(strange)).toContain('盤に無いソケットIDです: S9');
  });

  it('物理端子IDと役割端子IDを相互変換する', () => {
    expect(toPhysicalTerminal(TASK2_SOCKET_ROLES, t('T1.9'))).toBe('S5.9');
    expect(toNetlistTerminal(TASK2_SOCKET_ROLES, t('S5.9'))).toBe('T1.9');
    expect(toPhysicalTerminal(TASK1_SOCKET_ROLES, t('TB_PB.1a'))).toBe('TB_PB.1a');
    expect(toNetlistTerminal(TASK1_SOCKET_ROLES, t('P.1'))).toBe('P.1');
    expect(toPhysicalTerminal(TASK1_SOCKET_ROLES, t('CHK.14'))).toBe('S7.14');
    // 予備ソケットの端子は変換されずそのまま残る
    expect(toNetlistTerminal(DEFAULT_SOCKET_ROLES, t('S8.13'))).toBe('S8.13');
  });

  it('割当の照会', () => {
    expect(socketOf(TASK2_SOCKET_ROLES, 'T2')).toBe('S6');
    expect(roleOf(TASK1_SOCKET_ROLES, 'S7')).toBe('CHK');
    expect(hasRole(TASK1_SOCKET_ROLES, 'T1')).toBe(false);
    expect(() => socketOf(TASK1_SOCKET_ROLES, 'T1')).toThrow(RoleError);
    expect(isSocketRole('CR4')).toBe(true);
    expect(isSocketRole('CR9')).toBe(false);
    expect(isSocketId('S8')).toBe(true);
    expect(isSocketId('S9')).toBe(false);
  });
});
