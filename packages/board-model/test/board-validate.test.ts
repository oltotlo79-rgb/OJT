import { describe, expect, it } from 'vitest';
import type { TerminalId } from '@ojt/circuit-sim';
import {
  BLOCK_PITCH_MM,
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  BODY_TERMINAL_PICK_RADIUS_MM,
  boardTerminalPos,
  CHANNEL_LANE_COUNT,
  CHANNEL_LANE_PITCH_MM,
  channelBandRect,
  CHECK_SOCKET_ID,
  findBoardTerminal,
  HARNESS_APPROACH_MM,
  JIPM_BOARD,
  segmentIntersectsRect,
  SOCKET_COL_PITCH_MM,
  SOCKET_IDS,
  SOCKET_PIN_COUNT,
  TERMINAL_PICK_RADIUS_MM,
  validateBoard,
  vec3,
  type BoardDefinition,
  type BoardTerminal,
  type Rect,
} from '../src/index.js';

const board = JIPM_BOARD;

function t(id: string): TerminalId {
  return id as TerminalId;
}

/** 盤定義の一部を差し替えた（壊した）コピー。validateBoard の検出を試すために使う。 */
function patched(patch: Partial<BoardDefinition>): BoardDefinition {
  return { ...board, ...patch };
}

/** 端子1つを差し替えた端子配列。 */
function withTerminal(id: string, patch: Partial<BoardTerminal>): readonly BoardTerminal[] {
  return board.terminals.map((term) => (term.id === id ? { ...term, ...patch } : term));
}

/** 等間隔に並んだ座標列のピッチ（間隔が揃っていなければ失敗させる）。 */
function pitchOf(xs: readonly number[]): number {
  const gaps = new Set<number>();
  for (let i = 1; i < xs.length; i += 1) {
    const prev = xs[i - 1];
    const cur = xs[i];
    if (prev === undefined || cur === undefined) continue;
    gaps.add(cur - prev);
  }
  expect(gaps.size).toBe(1);
  const [only] = [...gaps];
  return only ?? 0;
}

/** 矩形を marginMm だけ外へ広げる。 */
function expand(r: Rect, marginMm: number): Rect {
  return {
    x: r.x - marginMm,
    y: r.y - marginMm,
    w: r.w + 2 * marginMm,
    h: r.h + 2 * marginMm,
  };
}

describe('validateBoard: 盤定義の自己検査（§6.5 / §6.6）', () => {
  it('標準盤は不正を1つも持たない', () => {
    expect(validateBoard(board)).toEqual([]);
  });

  it('端子IDの重複・空の銘板・盤外の端子を検出する', () => {
    const first = board.terminals[0];
    if (first === undefined) throw new Error('unreachable');
    expect(validateBoard(patched({ terminals: [...board.terminals, first] }))).toContain(
      `端子IDが重複しています: ${first.id}`,
    );
    expect(validateBoard(patched({ terminals: withTerminal('P.1', { label: '' }) }))).toContain(
      '端子の銘板が空です: P.1',
    );
    const outside = validateBoard(
      patched({ terminals: withTerminal('P.1', { pos: vec3(-1, BOARD_HEIGHT_MM + 5, 0) }) }),
    );
    expect(outside).toContain('端子が盤の外にあります: P.1');
  });

  it('端子が自分の部品の占有領域から外れていることを検出する', () => {
    const errors = validateBoard(
      patched({ terminals: withTerminal('S1.13', { pos: vec3(200, 200, 10) }) }),
    );
    expect(errors).toContain('端子が占有領域 S1 の外にあります: S1.13');
    const noFootprint = validateBoard(
      patched({ footprints: board.footprints.filter((f) => f.id !== 'TB_PL') }),
    );
    expect(noFootprint).toContain('端子に対応する占有領域がありません: TB_PL.1+');
  });

  it('既設配線・既設リンクの端子が盤にあることを確かめる', () => {
    const badWire = validateBoard(
      patched({
        fixedWires: [
          {
            id: 'fw-x',
            from: { kind: 'terminal', id: t('ZZ.1') },
            to: { kind: 'terminal', id: t('P.1') },
            color: '青',
          },
        ],
      }),
    );
    expect(badWire).toContain('既設配線 fw-x の端子が盤にありません: ZZ.1');
    const badPin = validateBoard(
      patched({
        fixedWires: [
          {
            id: 'fw-y',
            from: { kind: 'socket', socket: 'S1', pin: 99 },
            to: { kind: 'terminal', id: t('P.1') },
            color: '青',
          },
        ],
      }),
    );
    expect(badPin[0]).toMatch(/^既設配線 fw-y の端子を解決できません/);
    const badLink = validateBoard(
      patched({ fixedLinks: [{ id: 'lk-x', from: t('P.1'), to: t('ZZ.9'), color: '青' }] }),
    );
    expect(badLink).toContain('既設リンク lk-x の端子が盤にありません: ZZ.9');
  });

  it('配線できる端子の当たり判定が重なることを検出する', () => {
    const clash: BoardTerminal = {
      id: t('BZ.x'),
      label: 'BZ x',
      role: '+',
      pos: vec3(boardTerminalPos(board, 'BZ.+').x + 1, boardTerminalPos(board, 'BZ.+').y, 8),
      pickRadiusMm: TERMINAL_PICK_RADIUS_MM,
      wirable: true,
      optional: true,
      exit: 'either',
    };
    const errors = validateBoard(patched({ terminals: [...board.terminals, clash] }));
    expect(errors.some((m) => m.startsWith('端子の当たり判定が重なっています:'))).toBe(true);
  });

  it('配線帯が部品の占有領域を横切ることを検出する', () => {
    const errors = validateBoard(
      patched({
        wiringChannels: [
          { id: 'ch-bad', axis: 'x', at: 70, from: 10, to: 322, zMm: 3.5 },
          ...board.wiringChannels,
        ],
      }),
    );
    expect(errors).toContain('配線帯 ch-bad が占有領域 S1 と重なっています');
  });
});

describe('board-jipm: 当たり判定半径と既設ハーネスの通り道', () => {
  it('盤面の裏の本体端子は専用の当たり判定半径1mmを持つ（2mm間隔のため）', () => {
    expect(BODY_TERMINAL_PICK_RADIUS_MM).toBe(1);
    expect(BODY_TERMINAL_PICK_RADIUS_MM * 2).toBeLessThanOrEqual(2);
    for (const term of board.terminals) {
      const body = /^(PL|PB)\d\./.test(term.id);
      expect(term.pickRadiusMm).toBe(body ? BODY_TERMINAL_PICK_RADIUS_MM : TERMINAL_PICK_RADIUS_MM);
    }
  });

  it('配線帯のレーンは8本×2mmで、帯の矩形が引ける（§6.6）', () => {
    expect(CHANNEL_LANE_COUNT).toBe(8);
    expect(CHANNEL_LANE_PITCH_MM).toBe(2);
    const low = board.wiringChannels.find((c) => c.id === 'ch-low');
    if (low === undefined) throw new Error('unreachable');
    expect(channelBandRect(low)).toEqual({ x: low.from, y: low.at, w: low.to - low.from, h: 16 });
    const right = board.wiringChannels.find((c) => c.id === 'ch-right');
    if (right === undefined) throw new Error('unreachable');
    // ch-right はレーンが x の減る側へ伸びる
    expect(channelBandRect(right).x).toBe(right.at - 16);
  });

  it('既設ハーネスの横走りは、どの配線帯からも2mm以上離れている（§6.4 / §6.6）', () => {
    const devices = [
      ...board.lamps.map((l) => ({ id: l.id, hole: l.panelHole })),
      ...board.pushButtons.map((p) => ({ id: p.id, hole: p.panelHole })),
    ];
    expect(devices).toHaveLength(8);
    for (const device of devices) {
      const runY = device.hole.y - HARNESS_APPROACH_MM;
      // 端子台の端子と貫通穴のあいだを横に走る区間
      const xs = board.terminals
        .filter((term) => term.id.startsWith(`TB_${device.id.startsWith('PL') ? 'PL' : 'PB'}.`))
        .map((term) => term.pos.x);
      const from = vec3(Math.min(...xs, device.hole.x), runY, 0);
      const to = vec3(Math.max(...xs, device.hole.x), runY, 0);
      for (const channel of board.wiringChannels) {
        expect(segmentIntersectsRect(from, to, expand(channelBandRect(channel), 2))).toBe(false);
      }
    }
  });
});

describe('board-jipm: 写真どおりの端子台配置（§6.4 / 写真）', () => {
  it('2つの端子台は同じDINレールに並ぶ', () => {
    expect(boardTerminalPos(board, 'TB_PB.1c').y).toBe(boardTerminalPos(board, 'TB_PL.1+').y);
  });

  it('各PBの真上に c/a/b の3端子が並ぶ（PB取付ピッチ＝端子ピッチ×3）', () => {
    expect(pitchOf(board.pushButtons.map((p) => p.pos.x))).toBe(3 * BLOCK_PITCH_MM);
    board.pushButtons.forEach((pb, index) => {
      const n = index + 1;
      expect(boardTerminalPos(board, `TB_PB.${n}a`).x).toBe(pb.pos.x);
      expect(boardTerminalPos(board, `TB_PB.${n}c`).x).toBe(pb.pos.x - BLOCK_PITCH_MM);
      expect(boardTerminalPos(board, `TB_PB.${n}b`).x).toBe(pb.pos.x + BLOCK_PITCH_MM);
    });
  });

  it('各PLの真上に +/− の2端子が並ぶ（端子ピッチ＝PL取付ピッチの半分）', () => {
    const pitch = pitchOf(board.lamps.map((l) => l.pos.x));
    board.lamps.forEach((lamp, index) => {
      const n = index + 1;
      const plus = boardTerminalPos(board, `TB_PL.${n}+`).x;
      const minus = boardTerminalPos(board, `TB_PL.${n}-`).x;
      expect(minus - plus).toBe(pitch / 2);
      expect((plus + minus) / 2).toBe(lamp.pos.x);
    });
  });

  it('ソケットのネジ端子は列ピッチ8mmで並び、隣のソケットとも8mm空く（§6.5）', () => {
    expect(SOCKET_COL_PITCH_MM).toBe(8);
    expect(boardTerminalPos(board, 'S2.8').x - boardTerminalPos(board, 'S1.5').x).toBe(
      SOCKET_COL_PITCH_MM,
    );
  });

  it('チェック用ソケットIDを公開し、既設配線がそれを使う（§6.3）', () => {
    expect(CHECK_SOCKET_ID).toBe('S7');
    expect(SOCKET_IDS).toContain(CHECK_SOCKET_ID);
    expect(SOCKET_PIN_COUNT).toBe(14);
    expect(findBoardTerminal(board, `${CHECK_SOCKET_ID}.${SOCKET_PIN_COUNT}`)).toBeDefined();
    expect(board.fixedLinks.filter((l) => /^lk-[pn]-\d+$/.test(l.id))).toHaveLength(0);
    expect(board.fixedLinks).toHaveLength(22);
  });

  it('部品の占有領域は盤の中に収まる（写真の再配置後）', () => {
    for (const fp of board.footprints) {
      expect(fp.x).toBeGreaterThanOrEqual(0);
      expect(fp.y).toBeGreaterThanOrEqual(0);
      expect(fp.x + fp.w).toBeLessThanOrEqual(BOARD_WIDTH_MM);
      expect(fp.y + fp.h).toBeLessThanOrEqual(BOARD_HEIGHT_MM);
    }
  });
});
