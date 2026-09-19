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
 * 座標は論理単位で、**記号1つの左右の取り付け点は必ず `cx ± symbolWidth / 2`**。
 * `layout()` が電線を `cx ± symbolWidth / 2` まで引いているので、この約束を守ると
 * 電線と記号がぴったり突き合わさる（守らないと両側に隙間が空く）。
 * 記号幅 `s` を以下では **1モジュール（M）** と呼ぶ。寸法はすべて M の倍率で書く。
 *
 * 接点は JIS C 0617 / IEC 60617 の形で描く。横向きの段では**固定接点の縦棒は引かない**
 * （縦棒を電線の上下に出すと梯子図の記号に見え、b接点の斜め線の位置がおかしく見える。
 * 2026-09-20 の指摘）。描くのは「可動接点（ブレード）＋ 右側の引出線」だけ:
 * - a接点: 電線の左端（支点）から 30° で `bladeLength` M 立ち上がり、先は右の引出線の
 *   始まりより `bladeGap` M 手前で止まる（開いている）
 * - b接点: **同じブレード**。右の引出線は電線から上へだけ伸びる短い縦棒（`stubHeight` M）で
 *   始まり、ブレードがその縦棒を横切って `stubOvershoot` M 行き過ぎる（閉じている）
 * どちらも電線の**下には何も出ない**。傾きも刃の長さも同じなので、開閉の違いは
 * 「縦棒を横切るか・何も無いところで止まるか」の1点だけで読める。
 */

/** 図形の役割（描画側が線幅・色を決めるための分類）。 */
export type ShapeRole =
  'bus' | 'wire' | 'symbol' | 'label' | 'preset' | 'junction' | 'terminal' | 'rung';

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
    | {
        kind: 'line';
        role: ShapeRole;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        /** 破線で描く（IEC 60617 の機械的連結＝押ボタンの操作子の軸）。 */
        dashed?: boolean;
      }
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
 * 記号の寸法比（記号幅＝1モジュール `M` に対する倍率）。印刷された展開接続図の釣り合いに合わせてある。
 * 数値をここに集めておくと、記号どうしの釣り合いを1か所で直せる。
 */
export const SYMBOL_METRICS = {
  /** ブレード（可動接点）の電線からの角度[度]。a接点もb接点も同じ。 */
  bladeDeg: 30,
  /** ブレードの長さ。 */
  bladeLength: 0.6,
  /** a接点でブレードの先と右の引出線の始まりとのあいだに空ける横の隙間（＝開いている）。 */
  bladeGap: 0.25,
  /** b接点で右の引出線の始まりに立てる縦棒（電線から**上へだけ**）の高さ。 */
  stubHeight: 0.32,
  /**
   * b接点でブレードがその縦棒を横切って行き過ぎる量。
   * ブレードが縦棒の**高さの真ん中あたり**で交わるように決めてある（`test/symbols.test.ts`）。
   */
  stubOvershoot: 0.24,
  /** 押ボタンの操作子（キャップ）の高さ。 */
  actuatorTop: 0.72,
  /** 押ボタンの操作子の半幅（キャップ全体で 0.5 M）。 */
  actuatorHalf: 0.25,
  /** 限時記号（半円＝パラシュート）の半径。 */
  delayRadius: 0.28,
  /** コイルの長方形の半分の高さ（長方形は 1.0 M × 0.50 M）。 */
  coilHalfHeight: 0.25,
  /** タイマコイルの中に刷る限時記号（パラシュート）の半径。 */
  coilDelayRadius: 0.17,
  /** ランプ・ブザーの半径（⌀0.64 M。電線とは `loadLeads()` の引出線で突き合わせる）。 */
  loadRadius: 0.32,
  /** 分岐点（黒丸）の半径。 */
  junctionRadius: 0.13,
  /** 銘板（`CR1` など）を記号の中心から上へどれだけ離すか。 */
  labelRise: 1.18,
  /** 端子番号・設定時間を記号の中心から下へどれだけ離すか。 */
  terminalDrop: 0.62,
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

/** ブレードの支点（電線の左端）と先端。a接点もb接点も同じ1本。 */
function bladeOf(
  cx: number,
  cy: number,
  s: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const m = SYMBOL_METRICS;
  const rad = (m.bladeDeg * Math.PI) / 180;
  const length = s * m.bladeLength;
  const x1 = cx - s * 0.5;
  return {
    x1,
    y1: cy,
    x2: x1 + length * Math.cos(rad),
    y2: cy - length * Math.sin(rad),
  };
}

/**
 * 1つの接点記号の図形（JIS C 0617 / IEC 60617）。§11.1
 *
 * 返す図形は必ず「ブレード → 右の引出線」で始まり、b接点だけそのうしろに縦棒が付く。
 * 描画側や試験はこの並びに頼ってよい（押ボタンの操作子・限時記号はさらにそのあと）。
 * **固定接点の縦棒は描かない**（理由はこのファイル冒頭の注釈を見よ）。
 */
export function contactShapes(
  kind: CellKind,
  cx: number,
  cy: number,
  symbolWidth: number,
): Shape[] {
  const s = symbolWidth;
  const m = SYMBOL_METRICS;
  const xR = cx + s * 0.5;
  const blade = bladeOf(cx, cy, s);
  const closed = BREAK_KINDS.includes(kind);

  const shapes: Shape[] = [line('symbol', blade.x1, blade.y1, blade.x2, blade.y2)];
  if (closed) {
    // 右の引出線は縦棒から始まる。ブレードはその縦棒を横切って少し行き過ぎる
    const stubX = blade.x2 - s * m.stubOvershoot;
    shapes.push(line('symbol', stubX, cy, xR, cy));
    shapes.push(line('symbol', stubX, cy, stubX, cy - s * m.stubHeight));
  } else {
    // a接点はブレードの先から隙間を空けて引出線が始まる（＝開いている）
    shapes.push(line('symbol', blade.x2 + s * m.bladeGap, cy, xR, cy));
  }

  const midX = (blade.x1 + blade.x2) / 2;
  const midY = (blade.y1 + blade.y2) / 2;

  if (PUSH_BUTTON_KINDS.includes(kind)) {
    // 操作子はブレードの真ん中から立てる。軸は破線＝機械的連結（IEC 60617）
    const capY = cy - s * m.actuatorTop;
    shapes.push({ ...line('symbol', midX, midY, midX, capY), dashed: true });
    shapes.push(line('symbol', midX - s * m.actuatorHalf, capY, midX + s * m.actuatorHalf, capY));
  }
  if (TIMED_KINDS.includes(kind)) {
    // 限時記号（パラシュート）は**ブレードの上に載せる**。弦がブレードと平行になるよう傾ける。
    // 開口はブレードの側＝閉じる向きを向き、限時動作（オンディレー）を表す
    shapes.push({
      kind: 'arc',
      role: 'symbol',
      cx: midX,
      cy: midY,
      r: s * m.delayRadius,
      startDeg: 180 - m.bladeDeg,
      endDeg: 360 - m.bladeDeg,
    });
  }
  return shapes;
}

/** 記号（丸・半円）と電線の取り付け点（`cx ± s/2`）をつなぐ引出線。 */
function loadLeads(cx: number, cy: number, s: number, r: number): Shape[] {
  if (r >= s * 0.5) return [];
  return [
    line('symbol', cx - s * 0.5, cy, cx - r, cy),
    line('symbol', cx + r, cy, cx + s * 0.5, cy),
  ];
}

/** タイマのコイルか（限時記号を長方形の中に刷る）。 */
function isTimerCoil(cell: SchematicCell): boolean {
  return cell.kind === 'coil' && (cell.presetMs !== undefined || cell.device.startsWith('T'));
}

/**
 * 1つの負荷記号の図形。§11.1
 * コイル＝端子付きの長方形（JIS C 0617 の操作機器）、ランプ＝丸＋×、ブザー＝半円。
 * タイマのコイルは長方形の中に限時記号（限時接点と同じパラシュート）を刷る。
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
    const rect: Shape = {
      kind: 'rect',
      role: 'symbol',
      x: cx - s * 0.5,
      y: cy - h,
      w: s,
      h: h * 2,
    };
    if (!isTimerCoil(cell)) return [rect];
    return [
      rect,
      {
        kind: 'arc',
        role: 'symbol',
        cx,
        cy: cy + s * m.coilDelayRadius * 0.5,
        r: s * m.coilDelayRadius,
        startDeg: 180,
        endDeg: 360,
      },
    ];
  }
  const r = s * m.loadRadius;
  if (cell.kind === 'lamp') {
    // ×は円周に接するように（0.7071 ≒ 1/√2）
    const d = r * 0.7071;
    return [
      { kind: 'circle', role: 'symbol', cx, cy, r, fill: LAMP_FILL[cell.device] ?? '#FFFFFF' },
      line('symbol', cx - d, cy - d, cx + d, cy + d),
      line('symbol', cx - d, cy + d, cx + d, cy - d),
      ...loadLeads(cx, cy, s, r),
    ];
  }
  return [
    { kind: 'arc', role: 'symbol', cx, cy, r, startDeg: 180, endDeg: 360 },
    line('symbol', cx - r, cy, cx + r, cy),
    ...loadLeads(cx, cy, s, r),
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
