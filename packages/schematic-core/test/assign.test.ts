import { describe, expect, it } from 'vitest';
import {
  addWire,
  createSession,
  DEFAULT_SOCKET_ROLES,
  JIPM_BOARD,
  pinRole,
  TASK1_SOCKET_ROLES,
  TASK2_SOCKET_ROLES,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  assignToBoard as assignBareBoard,
  type AssignOptions,
  at,
  BUS_N,
  BUS_P,
  coil,
  CONTACT_PINS,
  crA,
  crB,
  createDocument,
  deriveSocketRoles,
  lamp,
  pbA,
  pbB,
  requiredRoles,
  rung,
  tA,
  type Assignment,
  type AssignResult,
  type SchematicDocument,
} from '../src/index.js';
import { flickerDoc, onDelayDoc, selfHoldDoc } from './helpers/docs.js';

/** 旧作業ファイルなどチェック回路付き盤への割当も引き続き検証する。 */
function assignToBoard(doc: SchematicDocument, options: AssignOptions = {}): AssignResult {
  return assignBareBoard(doc, { ...options, includeCheckWires: true });
}

function t(id: string): TerminalId {
  return id as TerminalId;
}

function assigned(result: AssignResult): Assignment {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' / '));
  return result;
}

function failed(result: AssignResult): readonly { path: string; message: string }[] {
  if (result.ok) throw new Error('エラーになるはずの割当が成功しました');
  return result.errors;
}

/** 生成した電線を実物の盤セッションへ流し込む（1端子2本の上限を盤モデルに判定させる）。 */
function wireAll(assignment: Assignment): void {
  const session = createSession(JIPM_BOARD, { roles: assignment.roles });
  for (const w of assignment.wires) {
    const result = addWire(session, JIPM_BOARD, w.from, w.to, w.color, { id: w.id });
    if (!result.ok) throw new Error(`${w.id}（${w.from}-${w.to}）: ${result.message}`);
  }
}

function timerDoc(presetMs: number): SchematicDocument {
  return createDocument('x', 'タイマ', [
    rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'T1', presetMs)]),
    rung('r2', BUS_P, BUS_N, [tA('c3', 'T1'), lamp('c4', 'PL1')]),
  ]);
}

describe('assign: 回路図 → 物理割当（§11.3）', () => {
  it('自己保持回路の割当', () => {
    const result = assigned(assignToBoard(selfHoldDoc()));
    expect(result.roles.S1).toBe('CR1');
    expect(result.roles.S7).toBe('CHK');
    expect(result.roles.S8).toBeUndefined();
    expect(result.parts).toEqual([{ socket: 'S1', role: 'CR1', kind: 'relay-my4n' }]);
    expect(result.cells.map((c) => `${c.cellId}:${c.left}-${c.right}`)).toEqual([
      'c1:TB_PB.2c-TB_PB.2b',
      'c2:TB_PB.1c-TB_PB.1a',
      'c3:CR1.14-CR1.13',
      'c4:CR1.9-CR1.5',
      'c5:CR1.10-CR1.6',
      'c6:TB_PL.1+-TB_PL.1-',
    ]);
    // 母線は P.1 / N.1 から鎖状に渡る（供給端子は実機どおり1点ずつ）
    expect(result.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'P.1-TB_PB.2c',
      'TB_PB.2c-CR1.10',
      'TB_PB.2b-TB_PB.1c',
      'TB_PB.1c-CR1.9',
      'TB_PB.1a-CR1.14',
      'CR1.14-CR1.5',
      'N.1-CR1.13',
      'CR1.13-TB_PL.1-',
      'CR1.6-TB_PL.1+',
    ]);
    expect(result.wires.every((w) => w.color === '青')).toBe(true);
    expect(result.wires.map((w) => w.id)).toEqual([
      'sw-001',
      'sw-002',
      'sw-003',
      'sw-004',
      'sw-005',
      'sw-006',
      'sw-007',
      'sw-008',
      'sw-009',
    ]);
    wireAll(result);
  });

  it('接点は出現順に組1〜組4へ1つずつ割り当てる（§11.3）', () => {
    const doc = createDocument('x', '4接点', [
      rung('r1', BUS_P, BUS_N, [pbA('c0', 'PB1'), coil('c1', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c2', 'CR1'), lamp('c3', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL2')]),
      rung('r4', BUS_P, BUS_N, [crA('c6', 'CR1'), lamp('c7', 'PL3')]),
      rung('r5', BUS_P, BUS_N, [crA('c8', 'CR1'), lamp('c9', 'PL4')]),
    ]);
    const result = assigned(assignToBoard(doc));
    const contacts = result.cells.filter((c) => c.device === 'CR1' && c.group > 0);
    expect(contacts.map((c) => `${c.group}:${c.left}-${c.right}`)).toEqual([
      '1:CR1.9-CR1.5',
      '2:CR1.10-CR1.6',
      '3:CR1.11-CR1.7',
      '4:CR1.12-CR1.8',
    ]);
  });

  it('接点のピン表は board-model の pinRole と一致する（§6.2 / §11.3）', () => {
    expect(CONTACT_PINS).toHaveLength(4);
    CONTACT_PINS.forEach((pins, index) => {
      const k = index + 1;
      expect(pins).toEqual({ com: 8 + k, no: 4 + k, nc: k });
      expect(pinRole(pins.com)).toBe('com');
      expect(pinRole(pins.no)).toBe('no');
      expect(pinRole(pins.nc)).toBe('nc');
    });
  });

  it('5個目の接点はエラー（§11.3）', () => {
    const doc = createDocument('x', '5接点', [
      rung('r1', BUS_P, BUS_N, [pbA('c0', 'PB1'), coil('c1', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c2', 'CR1'), lamp('c3', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL2')]),
      rung('r4', BUS_P, BUS_N, [crA('c6', 'CR1'), lamp('c7', 'PL3')]),
      rung('r5', BUS_P, BUS_N, [crA('c8', 'CR1'), lamp('c9', 'PL4')]),
      rung('r6', BUS_P, BUS_N, [crA('c10', 'CR1'), coil('c11', 'CR2')]),
    ]);
    expect(failed(assignToBoard(doc))[0]).toEqual({
      path: 'c10',
      message: 'CR1 の接点が5個目です（1つの部品の接点は4組までです）',
    });
  });

  it('physicalOverride は組を消費せず、COMピンから組番号を読む（§11.3 c接点）', () => {
    // 組1のCOM（CR1.9）にb接点を重ねるc接点使い。4組ぶんの接点＋上書き1つでも通る
    const doc = createDocument('x', 'c接点', [
      rung('r1', BUS_P, BUS_N, [pbA('c0', 'PB1'), coil('c1', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c2', 'CR1'), lamp('c3', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [crB('c4', 'CR1'), lamp('c5', 'PL2')]),
      rung('r4', BUS_P, BUS_N, [crA('c6', 'CR1'), lamp('c7', 'PL3')]),
      rung('r5', BUS_P, BUS_N, [crA('c8', 'CR1'), lamp('c9', 'PL4')]),
      rung('r6', BUS_P, BUS_N, [crA('c10', 'CR1'), coil('c11', 'CR2')]),
    ]);
    const result = assigned(
      assignToBoard(doc, { physicalOverride: { c4: [t('CR1.9'), t('CR1.1')] } }),
    );
    const byId = new Map(result.cells.map((c) => [c.cellId, c]));
    expect(byId.get('c4')).toEqual({
      cellId: 'c4',
      device: 'CR1',
      group: 1,
      left: 'CR1.9',
      right: 'CR1.1',
    });
    // 上書きした接点が組を食わないので、残りの接点が組1〜組4に収まる
    expect(
      result.cells.filter((c) => c.device === 'CR1' && c.cellId !== 'c4' && c.group > 0),
    ).toHaveLength(4);
    expect(byId.get('c10')?.group).toBe(4);
    wireAll(result);
  });

  it('b接点は COM と NC、a接点は COM と NO（§11.3 / §6.2）', () => {
    const result = assigned(assignToBoard(flickerDoc()));
    const byId = new Map(result.cells.map((c) => [c.cellId, c]));
    expect(byId.get('c2')).toEqual({
      cellId: 'c2',
      device: 'CR1',
      group: 1,
      left: 'CR1.9',
      right: 'CR1.1',
    });
    expect(byId.get('c7')).toEqual({
      cellId: 'c7',
      device: 'CR1',
      group: 2,
      left: 'CR1.10',
      right: 'CR1.6',
    });
    expect(byId.get('c5')).toEqual({
      cellId: 'c5',
      device: 'T1',
      group: 1,
      left: 'T1.9',
      right: 'T1.5',
    });
    expect(byId.get('c3')).toEqual({
      cellId: 'c3',
      device: 'T1',
      group: 0,
      left: 'T1.14',
      right: 'T1.13',
    });
  });

  it('役割割当は既定（8ソケットに7役割）で、明示指定もできる（§6.1）', () => {
    expect(requiredRoles(flickerDoc())).toEqual(['CR1', 'CR2', 'T1', 'T2']);
    expect(deriveSocketRoles()).toEqual(DEFAULT_SOCKET_ROLES);
    // 呼ぶたびに新しい物を返す（呼び出し側が既定の割当を書き換えられないように）
    expect(deriveSocketRoles()).not.toBe(DEFAULT_SOCKET_ROLES);
    expect(deriveSocketRoles()).not.toBe(deriveSocketRoles());
    const explicit = assigned(assignToBoard(onDelayDoc(), { roles: TASK2_SOCKET_ROLES }));
    expect(explicit.parts).toEqual([
      { socket: 'S5', role: 'T1', kind: 'timer-h3y4', presetMs: 3000, rangeMaxMs: 10_000 },
    ]);
  });

  it('割当が足りない役割指定はエラー', () => {
    expect(
      failed(assignToBoard(flickerDoc(), { roles: TASK1_SOCKET_ROLES })).map((e) => e),
    ).toEqual([
      { path: 'roles', message: '役割が盤に割り当てられていません: T1' },
      { path: 'roles', message: '役割が盤に割り当てられていません: T2' },
    ]);
  });

  it('役割割当そのものの不正も割当側で弾く（§6.1）', () => {
    // CHK は S7 固定。これを見逃すと createSession が例外を投げる
    expect(failed(assignToBoard(flickerDoc(), { roles: { S1: 'CR1', S5: 'CHK' } }))).toContainEqual(
      {
        path: 'roles',
        message: 'チェック用役割 CHK は S7 に固定です',
      },
    );
    expect(
      failed(assignToBoard(selfHoldDoc(), { roles: { S1: 'CR1', S2: 'CR1', S7: 'CHK' } })),
    ).toContainEqual({ path: 'roles', message: '役割が重複しています: CR1' });
  });

  it('CR4個とタイマを同時に使う回路図も既定の割当に載る（ソケットは8個）', () => {
    const doc = createDocument('x', '5機器', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c3', 'CR1'), coil('c4', 'CR2')]),
      rung('r3', BUS_P, BUS_N, [crA('c5', 'CR2'), coil('c6', 'CR3')]),
      rung('r4', BUS_P, BUS_N, [crA('c7', 'CR3'), coil('c8', 'CR4')]),
      rung('r5', BUS_P, BUS_N, [crA('c9', 'CR4'), coil('c10', 'T1', 1000)]),
    ]);
    const result = assigned(assignToBoard(doc));
    expect(result.parts.map((p) => `${p.socket}:${p.role}`)).toEqual([
      'S1:CR1',
      'S2:CR2',
      'S3:CR3',
      'S4:CR4',
      'S5:T1',
    ]);
  });

  it('physicalOverride が既定規則より優先される（§7.2 / §11.3）', () => {
    const result = assigned(
      assignToBoard(selfHoldDoc(), {
        physicalOverride: { c5: [t('CR1.12'), t('CR1.8')] },
        color: '白',
      }),
    );
    const overridden = result.cells.find((c) => c.cellId === 'c5');
    expect(overridden?.left).toBe('CR1.12');
    expect(overridden?.right).toBe('CR1.8');
    expect(overridden?.group).toBe(4); // COMピン⑫ → 組4
    expect(result.wires.every((w) => w.color === '白')).toBe(true);

    // COM以外の端子を左に置いた上書きは組が読めないので0
    const reversed = assigned(
      assignToBoard(selfHoldDoc(), { physicalOverride: { c5: [t('CR1.6'), t('CR1.10')] } }),
    );
    expect(reversed.cells.find((c) => c.cellId === 'c5')?.group).toBe(0);
  });

  it('physicalOverride の指定そのものを検査する（§7.2）', () => {
    const unknownCell = assignToBoard(selfHoldDoc(), {
      physicalOverride: { cX: [t('CR1.12'), t('CR1.8')] },
    });
    expect(failed(unknownCell)).toEqual([
      { path: 'physicalOverride.cX', message: 'physicalOverride の要素IDが見つかりません: cX' },
    ]);

    const tooMany = assignToBoard(selfHoldDoc(), {
      physicalOverride: {
        c5: [t('CR1.12'), t('CR1.8'), t('CR1.7')] as unknown as readonly [TerminalId, TerminalId],
      },
    });
    expect(failed(tooMany)[0]).toEqual({
      path: 'c5',
      message: 'physicalOverride は端子2つを指定します: c5',
    });

    const tooFew = assignToBoard(selfHoldDoc(), {
      physicalOverride: { c5: [t('CR1.12')] as unknown as readonly [TerminalId, TerminalId] },
    });
    expect(failed(tooFew)[0]?.message).toBe('physicalOverride は端子2つを指定します: c5');

    const unknownTerminal = assignToBoard(selfHoldDoc(), {
      physicalOverride: { c5: [t('CR9.1'), t('CR1.8')] },
    });
    expect(failed(unknownTerminal)[0]).toEqual({ path: 'c5', message: '盤に無い端子です: CR9.1' });

    // ピン番号の形式が壊れた端子IDも例外にせずエラーで返す
    const brokenId = assignToBoard(selfHoldDoc(), {
      physicalOverride: { c5: [t('CR1.09'), t('CR1.8')] },
    });
    expect(failed(brokenId)[0]).toEqual({ path: 'c5', message: '盤に無い端子です: CR1.09' });

    // PB本体端子は既設ハーネスが占めていて配線できない（§6.4）
    const notWirable = assignToBoard(selfHoldDoc(), {
      physicalOverride: { c2: [t('PB1.c'), t('PB1.a')] },
    });
    expect(failed(notWirable)[0]).toEqual({
      path: 'c2',
      message: 'この端子には配線できません: PB1.c',
    });
  });

  it('構造エラーのある文書は割当しない', () => {
    const doc = createDocument('x', '負荷なし', [rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1')])]);
    expect(failed(assignToBoard(doc))[0]?.path).toBe('rungs[0]');
  });

  it('1つの端子は1つの節点にしか置けない（§6.4）', () => {
    // PB1のa接点とb接点は TB_PB.1c（COM）を共有するので、別々の節点には置けない
    const shared = createDocument('x', 'COM共有', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 1), BUS_N, [pbB('c3', 'PB1'), lamp('c4', 'PL1')]),
    ]);
    expect(failed(assignToBoard(shared))[0]).toEqual({
      path: 'c3',
      message: '端子 TB_PB.1c が2つの節点に現れます（PB1 の a接点と b接点は COM を共有します）',
    });

    // 同じコイルを2回置くと、コイル端子が2つの節点に現れる
    const twoCoils = createDocument('x', 'コイル重複', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [pbA('c3', 'PB2'), coil('c4', 'CR1')]),
    ]);
    expect(failed(assignToBoard(twoCoils))[0]).toEqual({
      path: 'c4',
      message: '端子 CR1.14 が2つの節点に現れます（CR1 の端子は1つの節点にしか置けません）',
    });
  });

  it('タイマのレンジは設定時間から選ぶ（§5.3.2）', () => {
    const long = assigned(assignToBoard(timerDoc(20_000)));
    expect(long.parts).toEqual([
      { socket: 'S5', role: 'T1', kind: 'timer-h3y4', presetMs: 20_000, rangeMaxMs: 60_000 },
    ]);
    expect(assigned(assignToBoard(timerDoc(500))).parts[0]?.rangeMaxMs).toBe(10_000);
    // 0〜10s に収まらない値は 0〜60s レンジへ上げる（刻みに載れば通る）
    expect(assigned(assignToBoard(timerDoc(10_500))).parts[0]).toEqual({
      socket: 'S5',
      role: 'T1',
      kind: 'timer-h3y4',
      presetMs: 10_500,
      rangeMaxMs: 60_000,
    });
    expect(failed(assignToBoard(timerDoc(3333)))[0]).toEqual({
      path: 'c2',
      message: 'T1 の設定 3333ms はレンジ 0〜10s の刻み 100ms に合いません',
    });
    expect(failed(assignToBoard(timerDoc(10_700)))[0]).toEqual({
      path: 'c2',
      message: 'T1 の設定 10700ms はレンジ 0〜60s の刻み 500ms に合いません',
    });
  });

  it('母線は P.1 / N.1 から鎖状に渡り、どの端子も2本以内に収まる（§11.3 / 調査資料 §4.5）', () => {
    const result = assigned(assignToBoard(flickerDoc()));
    const count = new Map<string, number>();
    for (const w of result.wires) {
      for (const id of [w.from, w.to]) count.set(id, (count.get(id) ?? 0) + 1);
    }
    // チェック用の既設配線が P.1 / N.1 / TB_PB.4c / TB_PB.4a / CHK.13 / CHK.14 を各1本使う
    for (const [id, n] of count) {
      const preUsed = ['P.1', 'N.1'].includes(id) ? 1 : 0;
      expect(n + preUsed).toBeLessThanOrEqual(2);
    }
    expect(count.get('P.1')).toBe(1);
    expect(count.get('N.1')).toBe(1);
    // N側は鎖なので、母線に集まる5端子が1本の鎖で結ばれる
    const nChain = result.wires.filter((w) => w.from === t('N.1') || w.to === t('N.1'));
    expect(nChain).toHaveLength(1);
    wireAll(result);
  });

  it('既設配線と同じ節点に入る端子は鎖の端に置く（§6.3 / §6.6）', () => {
    // `TB_PB.4a` は既設配線（チェック用コイルとの1本）で埋まっているので、中継点には使えない。
    // 節点 r1#1 の文書順は `TB_PB.1a, CR1.14, TB_PB.4a, TB_PL.1+` で3番目に来るが、鎖の先頭へ回せば配線できる
    const doc = createDocument('x', '既設端子を含む節点', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, at('r1', 1), [pbA('c3', 'PB4')]),
      rung('r3', at('r1', 1), BUS_N, [lamp('c4', 'PL1')]),
    ]);
    const result = assigned(assignToBoard(doc));
    expect(result.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'P.1-TB_PB.1c',
      'TB_PB.4a-TB_PB.1a',
      'TB_PB.1a-CR1.14',
      'CR1.14-TB_PL.1+',
      'N.1-CR1.13',
      'CR1.13-TB_PL.1-',
    ]);
    // PB4のCOM（TB_PB.4c）はP母線の節点。既設配線で P.1 と直結なので電線は要らない
    expect(result.wires.some((w) => [w.from, w.to].includes(t('TB_PB.4c')))).toBe(false);
    wireAll(result);
  });

  it('既設配線で結ばれた端子どうしは配線しない（§6.3）', () => {
    // `P.1` と `TB_PB.4c` は既設配線で結ばれているので、同じ節点でも電線は要らない
    const doc = createDocument('x', 'PB4を使う', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB4'), coil('c2', 'CR1')]),
    ]);
    const result = assigned(assignToBoard(doc));
    expect(result.wires.map((w) => `${w.from}-${w.to}`)).toEqual(['TB_PB.4a-CR1.14', 'N.1-CR1.13']);
    const atP1 = result.wires.filter((w) => w.from === t('P.1') || w.to === t('P.1'));
    expect(atP1).toHaveLength(0);
    wireAll(result);

    // b接点も同じ（COMがP母線側なら使える。NC側の `TB_PB.4b` は既設配線と無関係）
    const bContact = createDocument('x', 'PB4のb接点', [
      rung('r1', BUS_P, BUS_N, [pbB('c1', 'PB4'), coil('c2', 'CR1')]),
    ]);
    const bResult = assigned(assignToBoard(bContact));
    expect(bResult.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'TB_PB.4b-CR1.14',
      'N.1-CR1.13',
    ]);
    wireAll(bResult);
  });

  it('既設配線で結ばれた端子の組は2つの節点に分けられない（§6.3）', () => {
    // PB4のCOM（`TB_PB.4c`）は既設配線でP母線に直結。内部節点に置くと手前の接点を素通りしてしまう
    const doc = createDocument('x', 'PB4を内部節点に置く', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 1), BUS_N, [pbA('c3', 'PB4'), lamp('c4', 'PL1')]),
      rung('r3', at('r1', 1), BUS_N, [crA('c5', 'CR1'), lamp('c6', 'PL2')]),
    ]);
    expect(failed(assignToBoard(doc))).toEqual([
      {
        path: 'c3',
        message:
          '端子 TB_PB.4c は既設配線で P.1 と接続されているため、P 母線以外の節点には置けません',
      },
    ]);

    // b接点でも同じ（COMを共有するため）
    const bContact = createDocument('x', 'PB4のb接点を内部節点に置く', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', at('r1', 1), BUS_N, [pbB('c3', 'PB4'), lamp('c4', 'PL1')]),
    ]);
    expect(failed(assignToBoard(bContact))[0]?.path).toBe('c3');
  });

  it('チェック用コイルの端子も相方と同じ節点にしか置けない（§6.3）', () => {
    // `CHK.13` は既設配線で N.1 に直結
    const toN = createDocument('x', 'CHK.13をN母線以外へ', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
    ]);
    expect(
      failed(assignToBoard(toN, { physicalOverride: { c1: [t('TB_PB.1c'), t('CHK.13')] } })),
    ).toEqual([
      {
        path: 'c1',
        message:
          '端子 CHK.13 は既設配線で N.1 と接続されているため、N 母線以外の節点には置けません',
      },
    ]);

    // 母線を含まない組（`TB_PB.4a` と `CHK.14`）は、どの節点でもよいが同じ節点でなければならない
    const split = createDocument('x', 'CHK.14を別の節点へ', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB4'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
    ]);
    expect(
      failed(assignToBoard(split, { physicalOverride: { c3: [t('CHK.14'), t('CR1.5')] } })),
    ).toEqual([
      {
        path: 'c3',
        message: '端子 CHK.14 は既設配線で TB_PB.4a と接続されているため、同じ節点にしか置けません',
      },
    ]);
  });

  it('P母線に居る既設配線の組は2本ぶんの中継に使える（§6.3 / §6.6）', () => {
    // PB4のCOM（`TB_PB.4c`）がP母線に居ると、`P.1` と合わせて組の残り容量は2本になる
    const doc = createDocument('x', 'P母線の中継', [
      rung('r1', BUS_P, BUS_N, [pbB('c1', 'PB4'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [lamp('c3', 'PL1')]),
      rung('r3', BUS_P, BUS_N, [crA('c4', 'CR1'), lamp('c5', 'PL2')]),
    ]);
    // PL1の+をチェック用コイルの節点（`TB_PB.4a`）へ相乗りさせると、その端子が鎖の先頭になる
    const result = assigned(
      assignToBoard(doc, { physicalOverride: { c3: [t('TB_PB.4a'), t('TB_PL.1-')] } }),
    );
    expect(result.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'TB_PB.4a-P.1',
      'TB_PB.4c-CR1.9',
      'TB_PB.4b-CR1.14',
      'N.1-CR1.13',
      'CR1.13-TB_PL.1-',
      'TB_PL.1--TB_PL.2-',
      'CR1.5-TB_PL.2+',
    ]);
    // 組の中は既設配線で結ばれているので電線は張らない
    expect(result.wires.some((w) => `${w.from}-${w.to}` === 'P.1-TB_PB.4c')).toBe(false);
    // P.1 に来るのは1本だけ（既設配線の1本と合わせて上限ちょうど。残り1本は TB_PB.4c が受ける）
    expect(result.wires.filter((w) => [w.from, w.to].includes(t('P.1')))).toHaveLength(1);
    expect(result.wires.filter((w) => [w.from, w.to].includes(t('TB_PB.4c')))).toHaveLength(1);
    wireAll(result);
  });

  it('既設配線で埋まった端子が1つの節点に3つ集まると配線できない（§6.6）', () => {
    const doc = createDocument('x', '既設端子3つ', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), lamp('c2', 'PL1')]),
      rung('r2', BUS_P, BUS_N, [pbA('c3', 'PB2'), lamp('c4', 'PL2')]),
    ]);

    // 2つまでなら鎖の両端に置ける（N.1 が先頭、TB_PB.4a が末尾）
    const twoTight = assigned(
      assignToBoard(doc, { physicalOverride: { c2: [t('TB_PL.1+'), t('TB_PB.4a')] } }),
    );
    expect(twoTight.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      'P.1-TB_PB.1c',
      'TB_PB.1c-TB_PB.2c',
      'TB_PB.1a-TB_PL.1+',
      'N.1-TB_PL.2-',
      'TB_PL.2--TB_PB.4a',
      'TB_PB.2a-TB_PL.2+',
    ]);
    wireAll(twoTight);

    // 3つ目（`P.1`）が加わると鎖の端が足りない（電気的には無茶な指定だが、本数の規則を試すための上書き）
    const result = assignToBoard(doc, {
      physicalOverride: {
        c2: [t('TB_PL.1+'), t('TB_PB.4a')],
        c4: [t('TB_PL.2+'), t('P.1')],
      },
    });
    expect(failed(result)[0]).toEqual({
      path: 'BUS:N',
      message:
        '節点に3本目の配線が要ります（既設配線で埋まった端子が3つあります）: N.1 / TB_PB.4a / P.1',
    });
  });

  it('1端子2本を超える配線はエラー（§6.6）', () => {
    // 供給端子 `P.1` を要素の端子に使うと、母線の鎖の1本と既設配線で3本目になる
    const doc = createDocument('x', '端子超過', [
      rung('r1', BUS_P, BUS_N, [pbA('c1', 'PB1'), coil('c2', 'CR1')]),
    ]);
    const result = assignToBoard(doc, {
      physicalOverride: { c2: [t('P.1'), t('CR1.13')] },
    });
    expect(failed(result)[0]).toEqual({
      path: 'P.1',
      message: '1つの端子に接続できるのは2本までです: P.1',
    });
  });

  it('コイルの無いタイマは既定の設定時間で装着する', () => {
    const doc = createDocument('x', 'コイルなし', [
      rung('r1', BUS_P, BUS_N, [tA('c1', 'T1'), lamp('c2', 'PL1')]),
    ]);
    const result = assigned(assignToBoard(doc));
    expect(result.parts).toEqual([
      { socket: 'S5', role: 'T1', kind: 'timer-h3y4', presetMs: 100, rangeMaxMs: 10_000 },
    ]);
  });

  it('要素IDが Object.prototype のキー名でも例外にならない（SC-01。physicalOverride 無し）', () => {
    for (const poisoned of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      const doc = createDocument('x', 'プロトタイプ汚染', [
        rung('r1', BUS_P, BUS_N, [pbA(poisoned, 'PB1'), coil('c2', 'CR1')]),
        rung('r2', BUS_P, BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
      ]);
      expect(() => assignToBoard(doc)).not.toThrow();
      const result = assigned(assignToBoard(doc));
      expect(result.cells.find((c) => c.cellId === poisoned)?.group).toBe(0);
    }
  });

  it('要素IDが Object.prototype のキー名でも physicalOverride ありで例外にならない（SC-01）', () => {
    const doc = createDocument('x', 'プロトタイプ汚染（override）', [
      rung('r1', BUS_P, BUS_N, [pbA('constructor', 'PB1'), coil('c2', 'CR1')]),
      rung('r2', BUS_P, BUS_N, [crA('c3', 'CR1'), lamp('c4', 'PL1')]),
    ]);
    expect(() =>
      assignToBoard(doc, { physicalOverride: { c2: [t('CR1.14'), t('CR1.13')] } }),
    ).not.toThrow();
  });
});
