import { describe, expect, it } from 'vitest';
import {
  BOARD_DEPTH_MM,
  BOARD_HEIGHT_MM,
  BOARD_WIDTH_MM,
  BoardError,
  boardTerminalPos,
  circledNumber,
  findBoardTerminal,
  JIPM_BOARD,
  loadBoard,
  pinRole,
  resolveEndpoint,
  SOCKET_IDS,
  SOCKET_BODY_LENGTH_MM,
  SOCKET_BODY_WIDTH_MM,
  SOCKET_PITCH_MM,
  socketBodyRect,
  socketPinHoleOffsets,
  socketPinOffset,
  socketPinTerminal,
  SOCKET_SLOT_INSET_MM,
  rectsOverlap,
  SUPPLY_TERMINAL_COUNT,
  TERMINAL_PICK_RADIUS_MM,
} from '../src/index.js';

const board = JIPM_BOARD;

function idsOf(prefix: string): string[] {
  return board.terminals.map((t) => t.id).filter((id) => id.startsWith(`${prefix}.`));
}

describe('board-jipm: 盤定義の不変条件（写真 K96-CS3 に準拠）', () => {
  it('ソケット8（左4・右4）・PB4・PL4（§6.1 / 写真）', () => {
    expect(board.sockets.map((s) => s.id)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
    ]);
    expect(board.sockets.filter((s) => s.cluster === 'left').map((s) => s.id)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
    ]);
    expect(board.sockets.filter((s) => s.cluster === 'right').map((s) => s.id)).toEqual([
      'S5',
      'S6',
      'S7',
      'S8',
    ]);
    expect(board.pushButtons.map((p) => `${p.id}/${p.panelLabel}:${p.color}`)).toEqual([
      'PB1/PBS1:黒',
      'PB2/PBS2:黄',
      'PB3/PBS3:緑',
      'PB4/PBS4:赤',
    ]);
    expect(board.lamps.map((l) => `${l.id}/${l.panelLabel}:${l.color}`)).toEqual([
      'PL1/PL1:白',
      'PL2/PL2:黄',
      'PL3/PL3:緑',
      'PL4/PL4:赤',
    ]);
  });

  it('端子台は12P／8P、P/N供給端子は1本ずつ（写真の DC24V 端子台は2点）', () => {
    expect(idsOf('TB_PB')).toHaveLength(12);
    expect(idsOf('TB_PL')).toHaveLength(8);
    expect(idsOf('P')).toHaveLength(SUPPLY_TERMINAL_COUNT);
    expect(idsOf('N')).toHaveLength(SUPPLY_TERMINAL_COUNT);
    expect(idsOf('TB_PB').slice(0, 3)).toEqual(['TB_PB.1c', 'TB_PB.1a', 'TB_PB.1b']);
    expect(idsOf('TB_PL').slice(0, 2)).toEqual(['TB_PL.1+', 'TB_PL.1-']);
  });

  it('全端子IDが一意で、盤上のネジ端子の当たり判定半径は4mm（§6.5）', () => {
    const ids = board.terminals.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 盤面の裏の本体端子だけは2mm間隔で並ぶので専用の半径を持つ（board-validate.test.ts）
    const onPanel = board.terminals.filter((t) => t.pos.z >= 0);
    expect(onPanel.every((t) => t.pickRadiusMm === TERMINAL_PICK_RADIUS_MM)).toBe(true);
    expect(onPanel.length).toBeLessThan(board.terminals.length);
  });

  it('ソケットは8個とも14ピンで、ネジ端子が上下2ティアに分かれる（§6.2 / 写真）', () => {
    for (const socket of SOCKET_IDS) {
      expect(idsOf(socket)).toHaveLength(14);
    }
    expect(board.sockets[0]?.origin).toEqual({ x: 28, y: 60, z: 10 });
    expect(board.sockets[4]?.origin).toEqual({ x: 180, y: 60, z: 10 });
    expect(board.sockets[0]?.bodyMm).toEqual({
      width: SOCKET_BODY_WIDTH_MM,
      length: SOCKET_BODY_LENGTH_MM,
    });
    const at = (pin: number): { x: number; y: number } => {
      const pos = boardTerminalPos(board, socketPinTerminal('S1', pin));
      return { x: pos.x, y: pos.y };
    };
    // 4段配置（§6.2）: 段1=[空]③②①、段2=⑧⑦⑥⑤、段3=⑫⑪⑩⑨、段4=④⑭⑬[空]
    // 段1・段2は本体の奥端に、段3・段4は手前端に寄り、中央は差込穴の領域になる
    const col = (i: number): number => 28 + socketPinOffset(0, i).dx;
    expect(at(3)).toEqual({ x: col(1), y: 60 + 6 });
    expect(at(1)).toEqual({ x: col(3), y: 60 + 6 });
    expect(at(8)).toEqual({ x: col(0), y: 60 + 14 });
    expect(at(5)).toEqual({ x: col(3), y: 60 + 14 });
    expect(at(12)).toEqual({ x: col(0), y: 60 + 62 });
    expect(at(9)).toEqual({ x: col(3), y: 60 + 62 });
    expect(at(4)).toEqual({ x: col(0), y: 60 + 70 });
    expect(at(14)).toEqual({ x: col(1), y: 60 + 70 });
    expect(at(13)).toEqual({ x: col(2), y: 60 + 70 });
    // 中央の差込穴領域には端子が無い（本体の 22mm〜54mm）
    for (const term of board.terminals.filter((x) => x.id.startsWith('S1.'))) {
      const dy = term.pos.y - 60;
      expect(dy < 22 || dy > SOCKET_BODY_LENGTH_MM - 22).toBe(true);
    }
  });

  it('盤上の配線できる端子は、どの2つも当たり判定が重ならない間隔で並ぶ（§6.5）', () => {
    // 同じソケット内だけでなく、隣のソケット・端子台・供給端子も含めた全組み合わせを見る
    const wirable = board.terminals.filter((x) => x.wirable);
    expect(wirable.length).toBeGreaterThan(100);
    const tooClose: string[] = [];
    for (let i = 0; i < wirable.length; i += 1) {
      for (let j = i + 1; j < wirable.length; j += 1) {
        const a = wirable[i];
        const b = wirable[j];
        if (a === undefined || b === undefined) continue;
        const gap = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
        const limit = 2 * Math.max(a.pickRadiusMm, b.pickRadiusMm);
        if (gap + 1e-9 < limit) tooClose.push(`${a.id}-${b.id}: ${gap}mm`);
      }
    }
    expect(tooClose).toEqual([]);
    expect(2 * TERMINAL_PICK_RADIUS_MM).toBe(8);
  });

  it('端子は番号＋役割の銘板を持つ（3Dがそのまま印字できる）', () => {
    expect(findBoardTerminal(board, 'S1.13')?.label).toBe('⑬ −');
    expect(findBoardTerminal(board, 'S1.14')?.label).toBe('⑭ +');
    expect(findBoardTerminal(board, 'S1.9')?.label).toBe('⑨ COM');
    expect(findBoardTerminal(board, 'S1.5')?.label).toBe('⑤ a');
    expect(findBoardTerminal(board, 'S1.1')?.label).toBe('① b');
    expect(findBoardTerminal(board, 'TB_PL.1+')?.label).toBe('PL1 +');
    expect(findBoardTerminal(board, 'TB_PL.1-')?.label).toBe('PL1 −');
    expect(findBoardTerminal(board, 'PL1.+')?.label).toBe('PL1 +');
    expect(findBoardTerminal(board, 'TB_PB.1c')?.label).toBe('PB1 c');
    expect(findBoardTerminal(board, 'P.1')?.label).toBe('P1');
    expect(findBoardTerminal(board, 'N.1')?.label).toBe('N1');
    expect(findBoardTerminal(board, 'PB1.c')?.label).toBe('PBS1 c');
  });

  it('部品の占有領域がそろっており、互いに重ならない（§6.6）', () => {
    const ids = board.footprints.map((f) => f.id);
    expect(ids).toContain('supply');
    expect(ids).toContain('CB');
    expect(ids).toContain('TB_PL');
    expect(ids).toContain('TB_PB');
    for (const socket of SOCKET_IDS) expect(ids).toContain(socket);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 0; i < board.footprints.length; i += 1) {
      for (let j = i + 1; j < board.footprints.length; j += 1) {
        const a = board.footprints[i];
        const b = board.footprints[j];
        if (a === undefined || b === undefined) continue;
        expect(rectsOverlap(a, b)).toBe(false);
      }
    }
  });

  it('配線帯は列と列の間・左右余白・クラスタ間に引かれている（§6.6）', () => {
    expect(board.wiringChannels.map((c) => c.id)).toEqual([
      'ch-top',
      'ch-mid',
      'ch-low',
      'ch-left',
      'ch-gap',
      'ch-right',
    ]);
    const at = (id: string): number => board.wiringChannels.find((c) => c.id === id)?.at ?? -1;
    // 奥から: P/N列 → ch-top → ソケット列 → ch-mid → 端子台列 → ch-low → PL/PB列
    expect(at('ch-top')).toBeGreaterThan(boardTerminalPos(board, 'N.1').y);
    expect(at('ch-top')).toBeLessThan(boardTerminalPos(board, 'S1.1').y);
    expect(at('ch-mid')).toBeGreaterThan(boardTerminalPos(board, 'S1.13').y);
    expect(at('ch-mid')).toBeLessThan(boardTerminalPos(board, 'TB_PL.1+').y);
    expect(at('ch-low')).toBeGreaterThan(boardTerminalPos(board, 'TB_PB.1c').y);
    expect(at('ch-low')).toBeLessThan(boardTerminalPos(board, 'PL1.+').y);
    // ch-gap は左右のソケットクラスタの間
    expect(at('ch-gap')).toBeGreaterThan(28 + 3 * SOCKET_PITCH_MM + SOCKET_BODY_WIDTH_MM);
    expect(at('ch-gap')).toBeLessThan(180);
  });

  it('クラスタ内のソケットは取付ピッチどおりに等間隔で並ぶ（写真）', () => {
    const originX = (id: (typeof SOCKET_IDS)[number]): number =>
      board.sockets.find((s) => s.id === id)?.origin.x ?? -1;
    expect(originX('S2') - originX('S1')).toBe(SOCKET_PITCH_MM);
    expect(originX('S4') - originX('S3')).toBe(SOCKET_PITCH_MM);
    expect(originX('S6') - originX('S5')).toBe(SOCKET_PITCH_MM);
    expect(originX('S8') - originX('S7')).toBe(SOCKET_PITCH_MM);
    // 左クラスタと右クラスタは離れており、同じDINレール列（同じy）に載る
    expect(originX('S5') - originX('S4')).toBeGreaterThan(SOCKET_PITCH_MM);
    expect(new Set(board.sockets.map((s) => s.origin.y)).size).toBe(1);
  });

  it('ピン割付が仕様どおり（§6.2）', () => {
    expect([9, 10, 11, 12].map(pinRole)).toEqual(['com', 'com', 'com', 'com']);
    expect([1, 2, 3, 4].map(pinRole)).toEqual(['nc', 'nc', 'nc', 'nc']);
    expect([5, 6, 7, 8].map(pinRole)).toEqual(['no', 'no', 'no', 'no']);
    expect(pinRole(13)).toBe('coil-');
    expect(pinRole(14)).toBe('coil+');
    expect(circledNumber(9)).toBe('⑨');
    expect(() => circledNumber(15)).toThrow(BoardError);
    expect(() => socketPinTerminal('S1', 0)).toThrow(BoardError);
  });

  it('全端子の座標が盤面の中にある（§6.5）', () => {
    for (const t of board.terminals) {
      expect(t.pos.x).toBeGreaterThanOrEqual(0);
      expect(t.pos.x).toBeLessThanOrEqual(BOARD_WIDTH_MM);
      expect(t.pos.y).toBeGreaterThanOrEqual(0);
      expect(t.pos.y).toBeLessThanOrEqual(BOARD_HEIGHT_MM);
    }
    expect(board.sizeMm).toEqual({ width: 330, height: 245, depth: 50 });
    for (const fp of board.footprints) {
      expect(fp.x).toBeGreaterThanOrEqual(0);
      expect(fp.x + fp.w).toBeLessThanOrEqual(BOARD_WIDTH_MM);
      expect(fp.y).toBeGreaterThanOrEqual(0);
      expect(fp.y + fp.h).toBeLessThanOrEqual(BOARD_HEIGHT_MM);
    }
  });

  it('傾斜コンソールの形状メタが奥行と整合する（写真からの推定）', () => {
    const c = board.console;
    expect(c.slopeDeg).toBe(13);
    expect(c.frontHeightMm).toBe(BOARD_DEPTH_MM);
    const rise = BOARD_HEIGHT_MM * Math.sin((c.slopeDeg * Math.PI) / 180);
    expect(c.rearHeightMm).toBeCloseTo(c.frontHeightMm + rise, 1);
    expect(c.rearHeightMm).toBeGreaterThan(c.frontHeightMm);
  });

  it('写真どおりの段構成（奥から: 電源/ブレーカ → ソケット → 端子台 → PL/PB）', () => {
    const y = (id: string): number => boardTerminalPos(board, id).y;
    expect(y('P.1')).toBeLessThan(y('S1.1'));
    expect(y('CB.1')).toBeLessThan(y('S5.1'));
    expect(y('S1.13')).toBeLessThan(y('TB_PL.1+'));
    expect(y('S5.13')).toBeLessThan(y('TB_PB.1c'));
    expect(y('TB_PL.1+')).toBeLessThan(y('PL1.+'));
    expect(y('TB_PB.1c')).toBeLessThan(y('PB1.c'));
    // 左上にDC24V供給端子、右上にブレーカ
    expect(boardTerminalPos(board, 'P.1').x).toBeLessThan(BOARD_WIDTH_MM / 2);
    expect(boardTerminalPos(board, 'CB.1').x).toBeGreaterThan(BOARD_WIDTH_MM / 2);
    // 下段は左にPL、右にPB
    expect(boardTerminalPos(board, 'PL4.+').x).toBeLessThan(boardTerminalPos(board, 'PB1.c').x);
  });

  it('PB／PL本体端子は配線できず、端子台とP/Nは配線できる（§6.4）', () => {
    expect(findBoardTerminal(board, 'PB1.c')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'PL1.+')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'CB.1')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'PS.+')?.wirable).toBe(false);
    expect(findBoardTerminal(board, 'TB_PB.1c')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'P.1')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'S7.14')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'S8.14')?.wirable).toBe(true);
    expect(findBoardTerminal(board, 'BZ.+')?.optional).toBe(true);
    expect(findBoardTerminal(board, 'XX.1')).toBeUndefined();
    expect(() => boardTerminalPos(board, 'XX.1')).toThrow(BoardError);
  });

  it('本体端子は盤の裏（z が負）にある（§6.4）', () => {
    expect(boardTerminalPos(board, 'PL1.+').z).toBeLessThan(0);
    expect(boardTerminalPos(board, 'PB1.c').z).toBeLessThan(0);
    expect(boardTerminalPos(board, 'TB_PL.1+').z).toBeGreaterThan(0);
  });

  it('チェック用ソケットの既設固定配線は3本・青で §6.3 の端子どおり（CHK は S7）', () => {
    expect(board.fixedWires).toHaveLength(3);
    expect(board.fixedWires.every((w) => w.color === '青')).toBe(true);
    const pairs = board.fixedWires.map(
      (w) => `${resolveEndpoint(w.from)}->${resolveEndpoint(w.to)}`,
    );
    expect(pairs).toEqual(['P.1->TB_PB.4c', 'TB_PB.4a->S7.14', 'S7.13->N.1']);
  });

  it('既設リンクは P/N 2本＋PB 12本＋PL 8本＝22本（§6.4 / 写真）', () => {
    expect(board.fixedLinks).toHaveLength(22);
    const ids = board.fixedLinks.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(board.fixedLinks.filter((l) => l.id.startsWith('lk-pb-'))).toHaveLength(12);
    expect(board.fixedLinks.filter((l) => l.id.startsWith('lk-pl-'))).toHaveLength(8);
    expect(board.fixedLinks.every((l) => l.color === '青')).toBe(true);
    expect(board.fixedLinks[0]).toEqual({
      id: 'lk-ps-p',
      from: 'PS.+',
      to: 'P.1',
      color: '青',
    });
  });

  it('差込穴は14個（2列×7段）で本体中央にある（§6.2）', () => {
    const holes = socketPinHoleOffsets();
    expect(holes).toHaveLength(14);
    expect(new Set(holes.map((h) => h.dx)).size).toBe(2);
    expect(new Set(holes.map((h) => h.dy)).size).toBe(7);
    for (const h of holes) {
      expect(h.dy).toBeGreaterThanOrEqual(SOCKET_SLOT_INSET_MM);
      expect(h.dy).toBeLessThanOrEqual(SOCKET_BODY_LENGTH_MM - SOCKET_SLOT_INSET_MM);
    }
  });

  it('ソケット本体の外形を引ける', () => {
    expect(socketBodyRect(board, 'S1')).toEqual({ x0: 28, y0: 60, x1: 58, y1: 136 });
    expect(socketBodyRect(board, 'S9' as 'S1')).toBeUndefined();
  });

  it('盤IDで引ける', () => {
    expect(loadBoard('board-jipm-std')).toBe(board);
    expect(() => loadBoard('board-x')).toThrow(BoardError);
  });
});
