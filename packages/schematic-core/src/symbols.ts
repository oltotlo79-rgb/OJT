import {
  isLoadCell,
  type CellKind,
  type SchematicCell,
  type SchematicDocument,
} from './document.js';

/**
 * 展開接続図の図記号（JIS C 0617）。設計仕様 §11.1 / 調査資料 §3.4。
 *
 * `layout.ts` は「どこに置くか」だけを決め、ここは「1つの記号をどう描くか」だけを持つ。
 * 座標は論理単位で、記号1つは必ず **中心 `(cx, cy)` から左右 `symbolWidth / 2`** に収まる。
 * `layout()` が電線を `cx ± symbolWidth / 2` まで引いているので、この約束を守ると
 * 電線と記号がぴったり突き合わさる（守らないと両側に隙間が空く）。
 *
 * 接点は「固定接点の縦棒2本 ＋ 可動接点（ブレード）」の刃形で描く。
 * - a接点: ブレードの先が右の縦棒に**届かない**（開いている）
 * - b接点: 右の縦棒がブレードの先まで**伸びて触れる**（閉じている）
 * この1点だけで開閉を見分けられるよう、隙間は記号幅の 0.2 倍以上取る。
 */

/** 図形の役割（描画側が線幅・色を決めるための分類）。 */
export type ShapeRole = 'bus' | 'wire' | 'symbol' | 'label' | 'junction' | 'terminal' | 'rung';

/**
 * 図形の出どころ（描画側が図形から文書の要素へ戻るための手がかり）。§11.2
 * 母線の線とラベルはどの段にも要素にも属さないので、どちらも持たない。
 */
export interface ShapeSource {
  /** その図形を出した段のID。 */
  rungId?: string;
  /** その図形を出した要素のID（記号とそのラベルだけが持つ）。 */
  cellId?: string;
}

/** 図形プリミティブ。 */
export type Shape = ShapeSource &
  (
    | { kind: 'line'; role: ShapeRole; x1: number; y1: number; x2: number; y2: number }
    | { kind: 'circle'; role: ShapeRole; cx: number; cy: number; r: number; fill?: string }
    | {
        kind: 'rect';
        role: ShapeRole;
        x: number;
        y: number;
        w: number;
        h: number;
        fill?: string;
      }
    | {
        kind: 'arc';
        role: ShapeRole;
        cx: number;
        cy: number;
        r: number;
        startDeg: number;
        endDeg: number;
      }
    | {
        kind: 'text';
        role: ShapeRole;
        x: number;
        y: number;
        text: string;
        anchor: 'start' | 'middle' | 'end';
      }
  );

/** 表示灯の色 → 塗り色。§5.3.4 */
export const LAMP_FILL: Readonly<Record<string, string>> = {
  PL1: '#FFFFFF',
  PL2: '#F2C230',
  PL3: '#3FA34D',
  PL4: '#D64545',
};

/** 押ボタンの操作子を描く種別。 */
const PUSH_BUTTON_KINDS: readonly CellKind[] = ['pb-a', 'pb-b'];
/** 限時記号（パラシュート）を描く種別。調査資料 §3.4 */
const TIMED_KINDS: readonly CellKind[] = ['t-a', 't-b'];
/** b接点（閉じている接点）の種別。 */
const BREAK_KINDS: readonly CellKind[] = ['pb-b', 'cr-b', 't-b'];

/**
 * 記号の寸法比（記号幅 `s` に対する倍率）。印刷された練習シートの見た目に合わせてある。
 * 数値をここに集めておくと、記号どうしの釣り合いを1か所で直せる。
 */
export const SYMBOL_METRICS = {
  /** 固定接点（縦棒）の半分の高さ。 */
  contactBarHalf: 0.3,
  /** ブレードの先端の高さ（中心からの上向き）。 */
  bladeRise: 0.62,
  /** a接点でブレードの先を右の縦棒より内側に止める量。＝開いている隙間。 */
  bladeGap: 0.2,
  /** b接点で右の縦棒をブレードの先より上に出す量（触れていることを見せる）。 */
  breakOverrun: 0.06,
  /** 押ボタンの操作子（キャップ）の高さ。 */
  actuatorTop: 0.86,
  /** 押ボタンの操作子の半幅。 */
  actuatorHalf: 0.28,
  /** 限時記号（半円）の半径。 */
  delayRadius: 0.3,
  /** コイルの長方形の半分の高さ。 */
  coilHalfHeight: 0.36,
  /** ランプ・ブザーの半径（電線と突き合わせるので記号幅の半分）。 */
  loadRadius: 0.5,
  /** 分岐点（黒丸）の半径。 */
  junctionRadius: 0.14,
  /** 銘板（`CR1` など）を記号の中心から上へどれだけ離すか。 */
  labelRise: 1.2,
  /** 端子番号を記号の中心から下へどれだけ離すか。 */
  terminalDrop: 0.58,
} as const;

function line(
  role: ShapeRole,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Extract<Shape, { kind: 'line' }> {
  return { kind: 'line', role, x1, y1, x2, y2 };
}

/** ブレード（可動接点）の線分。a接点は右の縦棒に届かない。 */
function blade(kind: CellKind, cx: number, cy: number, s: number): { x2: number; y2: number } {
  const m = SYMBOL_METRICS;
  const open = !BREAK_KINDS.includes(kind);
  return {
    x2: cx + s * (0.5 - (open ? m.bladeGap : 0)),
    y2: cy - s * m.bladeRise,
  };
}

/**
 * 1つの接点記号の図形（JIS C 0617 の刃形）。§11.1
 *
 * 返す図形は必ず「左の縦棒 → 右の縦棒 → ブレード」で始まる。描画側や試験は
 * この並びに頼ってよい（b接点の閉じ棒・押ボタンの操作子・限時記号はその後ろに続く）。
 */
export function contactShapes(
  kind: CellKind,
  cx: number,
  cy: number,
  symbolWidth: number,
): Shape[] {
  const s = symbolWidth;
  const m = SYMBOL_METRICS;
  const xL = cx - s * 0.5;
  const xR = cx + s * 0.5;
  const top = cy - s * m.contactBarHalf;
  const bottom = cy + s * m.contactBarHalf;
  const tip = blade(kind, cx, cy, s);
  const closed = BREAK_KINDS.includes(kind);
  // b接点は右の固定接点をブレードの先まで伸ばす（＝閉じている）。a接点は隙間を残す
  const rightTop = closed ? tip.y2 - s * m.breakOverrun : top;

  const shapes: Shape[] = [
    line('symbol', xL, top, xL, bottom),
    line('symbol', xR, rightTop, xR, bottom),
    line('symbol', xL, cy, tip.x2, tip.y2),
  ];

  const midX = (xL + tip.x2) / 2;
  const midY = (cy + tip.y2) / 2;

  if (PUSH_BUTTON_KINDS.includes(kind)) {
    // 操作子はブレードの真ん中から立てる（記号の中心から立てるとブレードから浮く）
    shapes.push(line('symbol', midX, midY, midX, cy - s * m.actuatorTop));
    shapes.push(
      line(
        'symbol',
        midX - s * m.actuatorHalf,
        cy - s * m.actuatorTop,
        midX + s * m.actuatorHalf,
        cy - s * m.actuatorTop,
      ),
    );
  }
  if (TIMED_KINDS.includes(kind)) {
    // 限時記号（パラシュート）もブレードの真ん中に載せる
    shapes.push({
      kind: 'arc',
      role: 'symbol',
      cx: midX,
      cy: midY,
      r: s * m.delayRadius,
      startDeg: 180,
      endDeg: 360,
    });
  }
  return shapes;
}

/**
 * 1つの負荷記号の図形。§11.1
 * コイル＝端子付きの長方形（JIS C 0617 の操作機器）、ランプ＝丸＋×、ブザー＝半円。
 */
export function loadShapes(
  cell: SchematicCell,
  cx: number,
  cy: number,
  symbolWidth: number,
): Shape[] {
  const s = symbolWidth;
  const m = SYMBOL_METRICS;
  if (cell.kind === 'coil') {
    const h = s * m.coilHalfHeight;
    return [{ kind: 'rect', role: 'symbol', x: cx - s * 0.5, y: cy - h, w: s, h: h * 2 }];
  }
  const r = s * m.loadRadius;
  if (cell.kind === 'lamp') {
    // ×は円周に接するように（0.7071 ≒ 1/√2）
    const d = r * 0.7071;
    return [
      { kind: 'circle', role: 'symbol', cx, cy, r, fill: LAMP_FILL[cell.device] ?? '#FFFFFF' },
      line('symbol', cx - d, cy - d, cx + d, cy + d),
      line('symbol', cx - d, cy + d, cx + d, cy - d),
    ];
  }
  return [
    { kind: 'arc', role: 'symbol', cx, cy, r, startDeg: 180, endDeg: 360 },
    line('symbol', cx - r, cy, cx + r, cy),
  ];
}

/** 要素1つぶんの端子番号（左＝P側、右＝N側）。 */
export interface TerminalMark {
  left: string;
  right: string;
}

/** 接点として組（1〜4）を消費する要素か（PBは端子台の固定端子なので組を持たない）。 */
function usesContactGroup(cell: SchematicCell): boolean {
  return !isLoadCell(cell) && cell.kind !== 'pb-a' && cell.kind !== 'pb-b';
}

/** `PB2` → 2 のように機器名の末尾の番号を取る。 */
function deviceIndex(device: string): string {
  return /(\d+)$/.exec(device)?.[1] ?? '';
}

/**
 * 端子番号の一覧（要素ID → 左右の端子表記）。§11.3
 *
 * 割当の規則は `assignToBoard()` と同じ「文書順に出てきた接点へ組1〜組4を1つずつ」。
 * ここは**図に刷るための文字**だけを作るので盤には触れない（`assign.ts` と同じ結果に
 * なることは `test/symbols.test.ts` が `assignToBoard()` と突き合わせて確かめている）。
 * 組を使い切った5個目以降は番号を出さない（図が嘘をつくより無いほうがよい）。
 */
export function terminalMarks(doc: SchematicDocument): Map<string, TerminalMark> {
  const out = new Map<string, TerminalMark>();
  const used = new Map<string, number>();
  for (const r of doc.rungs) {
    for (const cell of r.cells) {
      let group = 0;
      if (usesContactGroup(cell)) {
        const count = used.get(cell.device) ?? 0;
        if (count >= 4) continue; // 5個目の接点は割当エラーになる。番号は出さない
        group = count + 1;
        used.set(cell.device, group);
      }
      const n = deviceIndex(cell.device);
      switch (cell.kind) {
        case 'pb-a':
          out.set(cell.id, { left: `${n}c`, right: `${n}a` });
          break;
        case 'pb-b':
          out.set(cell.id, { left: `${n}c`, right: `${n}b` });
          break;
        case 'cr-a':
        case 't-a':
          out.set(cell.id, { left: `${8 + group}`, right: `${4 + group}` });
          break;
        case 'cr-b':
        case 't-b':
          out.set(cell.id, { left: `${8 + group}`, right: `${group}` });
          break;
        case 'coil':
          out.set(cell.id, { left: '14', right: '13' });
          break;
        case 'lamp':
          out.set(cell.id, { left: `${n}+`, right: `${n}−` });
          break;
        case 'buzzer':
          out.set(cell.id, { left: '+', right: '−' });
          break;
      }
    }
  }
  return out;
}
