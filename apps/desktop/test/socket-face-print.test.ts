import { BLOCK_PITCH_MM, JIPM_BOARD, PL_BLOCK_ID, type BoardTerminal } from '@ojt/board-model';
import { toTerminalId } from '@ojt/circuit-sim';
import { describe, expect, it } from 'vitest';
import {
  BAND_MM,
  drawSocketFace,
  HEADER_MM,
  NUMBER_MM,
  PX_PER_MM,
  ROLE_MM,
  socketFaceRows,
  socketLabelBoxes,
  socketRoleMark,
  SOCKET_PLATE_MARGIN_MM,
  terminalNumber,
  blockLabelBox,
  blockPolarityBox,
  blockPolarityMark,
  blockTerminalMark,
  BLOCK_POLARITY_MM,
  type LabelBox,
} from '../src/renderer/three/labels.js';
import { JA_PIN } from '../src/renderer/i18n/ja.js';
import {
  COIL_N_PIN,
  COIL_P_PIN,
  PIN_GROUPS,
  PIN_GROUP_COLOR,
  pinGroup,
} from '../src/renderer/session/socket-pins.js';
import { SOCKET_BODY_COLOR } from '../src/renderer/session/colors.js';

/**
 * 3Dソケットの面の印字（段見出し＋役割の色帯）。設計仕様 §6.2 / §8.2。
 * 利用者要望 2026-09-20「リレーソケットの各番号はどこが何かわからないから分かるようにしてね」。
 *
 * 面の印字は焼いた絵なので `happy-dom` では見られない。代わりに
 * - 位置は純関数 `socketFaceRows()` が返す mm の箱で縛る（番号にも隣の段にも触れない／板からはみ出さない）
 * - 描く内容は `drawSocketFace()` に**偽のキャンバス**を渡して、呼び出しの列として確かめる
 * という二段構えにする（`label-cache.test.ts` と同じ考え方）。
 */

/** 板1枚ぶんの引数（`Socket.tsx` と同じ作り方）。 */
function plateOf(socketIndex: number): {
  terminals: BoardTerminal[];
  originX: number;
  originY: number;
  w: number;
  h: number;
} {
  const socket = JIPM_BOARD.sockets[socketIndex];
  if (socket === undefined) throw new Error(`ソケット ${String(socketIndex)} がありません`);
  return {
    terminals: JIPM_BOARD.terminals.filter((t) => t.id.startsWith(`${socket.id}.`)),
    originX: socket.origin.x - SOCKET_PLATE_MARGIN_MM,
    originY: socket.origin.y - SOCKET_PLATE_MARGIN_MM,
    w: socket.bodyMm.width + SOCKET_PLATE_MARGIN_MM * 2,
    h: socket.bodyMm.length + SOCKET_PLATE_MARGIN_MM * 2,
  };
}

/** 端子の番号（`S1.9` → 9）。 */
function pinOf(terminal: BoardTerminal): number {
  return Number(terminal.id.split('.')[1]);
}

/** 2つの矩形が重なるか。 */
function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** 番号と役割の印字の箱（板1枚ぶん）。 */
function printBoxes(index: number): Array<{ box: LabelBox; label: string }> {
  const plate = plateOf(index);
  return plate.terminals.flatMap((terminal) => {
    const boxes = socketLabelBoxes(terminal, plate.originX, plate.originY);
    return [
      { box: boxes.number, label: `${terminal.id} 番号` },
      { box: boxes.role, label: `${terminal.id} 役割` },
    ];
  });
}

/** 16進色 → 相対輝度（`plateLuminance()` と同じ概算）。 */
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const r = Number.parseInt(v.slice(0, 2), 16) / 255;
  const g = Number.parseInt(v.slice(2, 4), 16) / 255;
  const b = Number.parseInt(v.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** コントラスト比。 */
function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 16進色 → 色相[度]。 */
function hue(hex: string): number {
  const v = hex.replace('#', '');
  const r = Number.parseInt(v.slice(0, 2), 16) / 255;
  const g = Number.parseInt(v.slice(2, 4), 16) / 255;
  const b = Number.parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const raw = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (raw * 60 + 360) % 360;
}

/** 色相の差（0〜180度）。 */
function hueGap(a: string, b: string): number {
  const diff = Math.abs(hue(a) - hue(b)) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** `drawSocketFace()` に渡す偽のキャンバス（描いた内容を記録するだけ）。 */
function fakeContext(): {
  ctx: CanvasRenderingContext2D;
  texts: Array<{ text: string; x: number; y: number; fill: string; font: string }>;
  rects: Array<{ x: number; y: number; w: number; h: number; fill: string }>;
} {
  const texts: Array<{ text: string; x: number; y: number; fill: string; font: string }> = [];
  const rects: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
  const state = { fillStyle: '', font: '' };
  const ctx = {
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get font() {
      return state.font;
    },
    set font(value: string) {
      state.font = value;
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, fill: state.fillStyle, font: state.font });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, fill: state.fillStyle });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts, rects };
}

describe('段見出しの大きさと言葉（利用者要望 2026-09-20）', () => {
  it('日本語の見出しは 2.2mm 以上の高さで、ネジの脇の役割文字より大きい', () => {
    expect(HEADER_MM).toBeGreaterThanOrEqual(2.2);
    // 「小さすぎて気付かれない」と言われた役割文字（2.2mm）より確実に大きい
    expect(HEADER_MM).toBeGreaterThan(ROLE_MM);
    // 番号（4.6mm）は見出しより大きいまま（番号がいちばん目立つ順序を崩さない）
    expect(HEADER_MM).toBeLessThan(NUMBER_MM);
  });

  it('4つの段見出しは b接点 / a接点 / COM / コイル の4語で、言い換えを作らない', () => {
    expect(PIN_GROUPS.map((group) => JA_PIN.group[group])).toEqual([
      'b接点',
      'a接点',
      'COM',
      'コイル',
    ]);
  });

  it('板の上には4つの大分類すべての見出しが出る（段4は ④ とコイルで2つ）', () => {
    const plate = plateOf(0);
    const { headers } = socketFaceRows(plate.terminals, plate.originX, plate.originY);
    expect(new Set(headers.map((h) => h.group))).toEqual(new Set(PIN_GROUPS));
    expect(headers.filter((h) => h.group === 'nc')).toHaveLength(2);
    expect(headers.map((h) => h.text)).toContain('コイル');
  });
});

describe('段見出しと色帯の位置（何にも重ならない）', () => {
  const plate = plateOf(0);
  const { headers, bands } = socketFaceRows(plate.terminals, plate.originX, plate.originY);
  const prints = printBoxes(0);

  it('見出しは番号にも役割文字にも重ならない', () => {
    for (const header of headers) {
      for (const print of prints) {
        expect(overlaps(header.box, print.box), `${header.text} と ${print.label}`).toBe(false);
      }
    }
  });

  it('見出しどうしも重ならない（段4の `b接点` と `コイル`）', () => {
    for (const a of headers) {
      for (const b of headers) {
        if (a === b) continue;
        expect(overlaps(a.box, b.box), `${a.text} と ${b.text}`).toBe(false);
      }
    }
  });

  it('色帯は番号・役割文字・見出しのどれにも重ならない', () => {
    for (const band of bands) {
      const box: LabelBox = { x0: band.x0, x1: band.x1, y0: band.y0, y1: band.y1 };
      for (const print of prints) {
        expect(overlaps(box, print.box), `帯 と ${print.label}`).toBe(false);
      }
      for (const header of headers) {
        expect(overlaps(box, header.box), `帯 と ${header.text}`).toBe(false);
      }
    }
  });

  it('見出しも色帯も板からはみ出さない', () => {
    for (const header of headers) {
      expect(header.box.x0, header.text).toBeGreaterThanOrEqual(0);
      expect(header.box.x1, header.text).toBeLessThanOrEqual(plate.w);
      expect(header.box.y0, header.text).toBeGreaterThanOrEqual(0);
      expect(header.box.y1, header.text).toBeLessThanOrEqual(plate.h);
    }
    for (const band of bands) {
      expect(band.x0).toBeGreaterThanOrEqual(0);
      expect(band.x1).toBeLessThanOrEqual(plate.w);
      expect(band.y0).toBeGreaterThanOrEqual(0);
      expect(band.y1).toBeLessThanOrEqual(plate.h);
    }
  });

  it('色帯の厚みは段ピッチを食い潰さない', () => {
    for (const band of bands) {
      expect(band.y1 - band.y0).toBeCloseTo(BAND_MM, 6);
    }
  });

  it('帯の色はそのネジの役割の色になっている（段4は ④ だけ色が違う）', () => {
    for (const terminal of plate.terminals) {
      const x = terminal.pos.x - plate.originX;
      const band = bands.find(
        (b) => b.x0 <= x && x <= b.x1 && b.group === pinGroup(pinOf(terminal)),
      );
      expect(band, `${terminal.id} の帯`).toBeDefined();
      expect(band?.color).toBe(PIN_GROUP_COLOR[pinGroup(pinOf(terminal))]);
    }
    const row4 = bands.filter((b) => b.y0 > plate.h / 2 && b.group === 'nc');
    expect(row4.length, '段4の ④ は b接点 の色で塗る').toBeGreaterThan(0);
  });
});

describe('役割の色（色だけに意味を載せない）', () => {
  it('4色は黒いソケット本体の上で 3:1 以上の明暗差を持つ', () => {
    for (const group of PIN_GROUPS) {
      expect(
        contrastRatio(PIN_GROUP_COLOR[group], SOCKET_BODY_COLOR),
        group,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('4色はどの2つも色相が 35 度以上離れている', () => {
    for (const a of PIN_GROUPS) {
      for (const b of PIN_GROUPS) {
        if (a === b) continue;
        expect(PIN_GROUP_COLOR[a]).not.toBe(PIN_GROUP_COLOR[b]);
        expect(
          hueGap(PIN_GROUP_COLOR[a], PIN_GROUP_COLOR[b]),
          `${a} と ${b} の色相`,
        ).toBeGreaterThanOrEqual(35);
      }
    }
  });

  it('いちばん近い橙と赤は明るさでも離してある（色相だけに頼らない）', () => {
    expect(contrastRatio(PIN_GROUP_COLOR.nc, PIN_GROUP_COLOR.coil)).toBeGreaterThanOrEqual(1.25);
  });

  it('色を見分けられなくても、帯には必ず言葉の見出しが付く', () => {
    const plate = plateOf(0);
    const { headers, bands } = socketFaceRows(plate.terminals, plate.originX, plate.originY);
    for (const band of bands) {
      expect(
        headers.some((h) => h.group === band.group),
        `${band.group} の見出し`,
      ).toBe(true);
    }
  });
});

describe('焼く内容（`drawSocketFace`）', () => {
  const plate = plateOf(0);

  it('番号・役割文字・段見出し・色帯をすべて描く', () => {
    const { ctx, texts, rects } = fakeContext();
    drawSocketFace(ctx, plate.terminals, plate.originX, plate.originY);
    for (const terminal of plate.terminals) {
      expect(texts.some((t) => t.text === terminalNumber(terminal))).toBe(true);
    }
    for (const word of PIN_GROUPS.map((group) => JA_PIN.group[group])) {
      expect(
        texts.some((t) => t.text === word),
        `${word} の見出し`,
      ).toBe(true);
    }
    const { bands, headers } = socketFaceRows(plate.terminals, plate.originX, plate.originY);
    // 塗る四角は「役割の帯」と「見出しの下地」だけ
    expect(rects).toHaveLength(bands.length + headers.length);
  });

  it('見出しは番号より小さく、役割文字より大きい字で焼く', () => {
    const { ctx, texts } = fakeContext();
    drawSocketFace(ctx, plate.terminals, plate.originX, plate.originY);
    const header = texts.find((t) => t.text === 'コイル');
    const number = texts.find(
      (t) => t.text === terminalNumber(plate.terminals[0] as BoardTerminal),
    );
    expect(header?.font).toContain(`${String(HEADER_MM * PX_PER_MM)}px`);
    expect(number?.font).toContain(`${String(NUMBER_MM * PX_PER_MM)}px`);
  });

  it('見出しと帯は役割の色で焼く', () => {
    const { ctx, texts, rects } = fakeContext();
    drawSocketFace(ctx, plate.terminals, plate.originX, plate.originY);
    expect(texts.find((t) => t.text === 'COM')?.fill).toBe(PIN_GROUP_COLOR.com);
    expect(texts.find((t) => t.text === 'コイル')?.fill).toBe(PIN_GROUP_COLOR.coil);
    for (const group of PIN_GROUPS) {
      expect(
        rects.some((rect) => rect.fill === PIN_GROUP_COLOR[group]),
        `${group} の帯`,
      ).toBe(true);
    }
    // 見出しの下地はソケット本体と同じ黒（明るい台座にはみ出す段でも読めるようにする）
    expect(rects.some((rect) => rect.fill === SOCKET_BODY_COLOR)).toBe(true);
  });

  it('見出しの下地は文字より一回り大きく、文字は下地の中に収まる', () => {
    const { headers } = socketFaceRows(plate.terminals, plate.originX, plate.originY);
    for (const header of headers) {
      expect(header.plate.x0).toBeLessThan(header.box.x0);
      expect(header.plate.x1).toBeGreaterThan(header.box.x1);
      expect(header.plate.y0).toBeLessThan(header.box.y0);
      expect(header.plate.y1).toBeGreaterThan(header.box.y1);
      expect(header.plate.y0).toBeGreaterThanOrEqual(0);
      expect(header.plate.y1).toBeLessThanOrEqual(plate.h);
      expect(header.plate.x0).toBeGreaterThanOrEqual(0);
      expect(header.plate.x1).toBeLessThanOrEqual(plate.w);
    }
  });

  it('下地どうしも、下地と番号・役割文字も重ならない', () => {
    const { headers } = socketFaceRows(plate.terminals, plate.originX, plate.originY);
    const prints = printBoxes(0);
    for (const header of headers) {
      for (const print of prints) {
        expect(overlaps(header.plate, print.box), `${header.text} の下地 と ${print.label}`).toBe(
          false,
        );
      }
      for (const other of headers) {
        if (other === header) continue;
        expect(overlaps(header.plate, other.plate), `${header.text} と ${other.text} の下地`).toBe(
          false,
        );
      }
    }
  });

  it('描く座標は px（`PX_PER_MM` 倍）で、板の中に収まる', () => {
    const { ctx, texts, rects } = fakeContext();
    drawSocketFace(ctx, plate.terminals, plate.originX, plate.originY);
    for (const item of [...texts, ...rects]) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x).toBeLessThanOrEqual(plate.w * PX_PER_MM);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeLessThanOrEqual(plate.h * PX_PER_MM);
    }
  });
});

/*
 * 利用者指摘 2026-09-20「リレーソケットの13、14番の端子にコイルとしか書いてないがこれでは
 * どちらがPかNか分からない。ランプも同様」。
 */
describe('コイルの極性の印字（⑭ = P(+) / ⑬ = N(−)）', () => {
  const plate = plateOf(0);

  /** ソケットの端子1個を引く。 */
  function pinTerminal(pin: number): BoardTerminal {
    const terminal = plate.terminals.find((t) => pinOf(t) === pin);
    if (terminal === undefined) throw new Error(`ピン${String(pin)}がありません`);
    return terminal;
  }

  it('⑭⑬ のネジの脇は `+` `−` ではなく `P(+)` `N(−)` と印字する', () => {
    expect(socketRoleMark(pinTerminal(COIL_P_PIN))).toBe(JA_PIN.bus.P);
    expect(socketRoleMark(pinTerminal(COIL_N_PIN))).toBe(JA_PIN.bus.N);
    // 極性を持たないネジの印字は今までどおり（盤定義の銘板表記）
    expect(socketRoleMark(pinTerminal(9))).toBe('COM');
    expect(socketRoleMark(pinTerminal(5))).toBe('a');
    expect(socketRoleMark(pinTerminal(1))).toBe('b');
  });

  it('段見出しは「コイル」のままで、どちら側かはネジの脇の印字が示す', () => {
    const { headers } = socketFaceRows(plate.terminals, plate.originX, plate.originY);
    expect(headers.map((h) => h.text)).toContain(JA_PIN.group.coil);
  });

  it('`P(+)` `N(−)` は隣のネジの印字とも板の縁とも当たらない（列ピッチ 8mm）', () => {
    const prints = printBoxes(0);
    for (const a of prints) {
      for (const b of prints) {
        if (a === b) continue;
        expect(overlaps(a.box, b.box), `${a.label} と ${b.label}`).toBe(false);
      }
      expect(a.box.x0, a.label).toBeGreaterThanOrEqual(0);
      expect(a.box.x1, a.label).toBeLessThanOrEqual(plate.w);
      expect(a.box.y0, a.label).toBeGreaterThanOrEqual(0);
      expect(a.box.y1, a.label).toBeLessThanOrEqual(plate.h);
    }
  });

  it('焼く絵にも `P(+)` と `N(−)` が入る（8ソケットとも同じ）', () => {
    for (let index = 0; index < JIPM_BOARD.sockets.length; index += 1) {
      const one = plateOf(index);
      const { ctx, texts } = fakeContext();
      drawSocketFace(ctx, one.terminals, one.originX, one.originY);
      const socketId = JIPM_BOARD.sockets[index]?.id ?? '';
      expect(
        texts.some((t) => t.text === JA_PIN.bus.P),
        socketId,
      ).toBe(true);
      expect(
        texts.some((t) => t.text === JA_PIN.bus.N),
        socketId,
      ).toBe(true);
      // 裸の `+` `−` は残さない（「どちらがPか」が分からない印字を無くすのが目的）
      expect(texts.some((t) => t.text === '+')).toBe(false);
      expect(texts.some((t) => t.text === '−')).toBe(false);
    }
  });
});

describe('ランプ用端子台の極性の印字（利用者指摘「ランプも同様」）', () => {
  const lampTerminals = JIPM_BOARD.terminals.filter((t) => t.id.startsWith(`${PL_BLOCK_ID}.`));

  it('`PL1+` の下に `P(+)`、`PL1-` の下に `N(−)` を添える', () => {
    const plus = lampTerminals.find((t) => t.id === toTerminalId(`${PL_BLOCK_ID}.1+`));
    const minus = lampTerminals.find((t) => t.id === toTerminalId(`${PL_BLOCK_ID}.1-`));
    expect(blockTerminalMark(plus as BoardTerminal)).toBe('PL1+');
    expect(blockPolarityMark(plus as BoardTerminal)).toBe(JA_PIN.bus.P);
    expect(blockPolarityMark(minus as BoardTerminal)).toBe(JA_PIN.bus.N);
    expect(lampTerminals.every((t) => blockPolarityMark(t) !== undefined)).toBe(true);
  });

  it('名前と極性の印は別の行に出る（横に並べて 9mm ピッチを食い潰さない）', () => {
    for (const terminal of lampTerminals) {
      const name = blockLabelBox(terminal);
      const polarity = blockPolarityBox(terminal);
      expect(polarity, terminal.id).toBeDefined();
      if (polarity === undefined) continue;
      expect(overlaps(name, polarity), terminal.id).toBe(false);
      expect(polarity.y1).toBeLessThan(name.y0);
    }
  });

  it('隣の端子の印とも当たらない（`P(+)` と `N(−)` が続いても読める）', () => {
    const boxes = lampTerminals.flatMap((terminal) => {
      const polarity = blockPolarityBox(terminal);
      return polarity === undefined
        ? [{ box: blockLabelBox(terminal), label: `${terminal.id} 名前` }]
        : [
            { box: blockLabelBox(terminal), label: `${terminal.id} 名前` },
            { box: polarity, label: `${terminal.id} 極性` },
          ];
    });
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        expect(overlaps(a.box, b.box), `${a.label} と ${b.label}`).toBe(false);
      }
    }
    // 印の幅そのものが端子ピッチに収まっている（盤の端子台は 9mm ピッチ）
    for (const terminal of lampTerminals) {
      const polarity = blockPolarityBox(terminal);
      if (polarity === undefined) continue;
      expect(polarity.x1 - polarity.x0, terminal.id).toBeLessThan(BLOCK_PITCH_MM);
    }
    expect(BLOCK_POLARITY_MM).toBeLessThan(BLOCK_PITCH_MM);
  });

  it('母線を名乗る端子・押ボタン・机上のPLCには印を出さない', () => {
    for (const id of ['P.1', 'N.1', 'PS.+', 'PS.-', 'TB_PB.1c']) {
      const terminal = JIPM_BOARD.terminals.find((t) => t.id === id);
      expect(terminal, id).toBeDefined();
      if (terminal === undefined) continue;
      expect(blockPolarityMark(terminal), id).toBeUndefined();
      expect(blockPolarityBox(terminal), id).toBeUndefined();
    }
  });
});

describe('タイマ用ソケットとチェック用ソケット（§6.1 / §6.3）', () => {
  it('8個とも同じ14ピンなので、同じ段見出しと同じ帯を持つ', () => {
    const first = plateOf(0);
    const base = socketFaceRows(first.terminals, first.originX, first.originY);
    for (let index = 1; index < JIPM_BOARD.sockets.length; index += 1) {
      const plate = plateOf(index);
      const rows = socketFaceRows(plate.terminals, plate.originX, plate.originY);
      const socketId = JIPM_BOARD.sockets[index]?.id ?? '';
      expect(rows.headers, socketId).toEqual(base.headers);
      expect(rows.bands, socketId).toEqual(base.bands);
    }
  });
});
