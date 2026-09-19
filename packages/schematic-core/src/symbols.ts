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
 * 座標は論理単位で、**記号1つの左右の取り付け点は必ず `cx ± symbolWidth / 2`**
 * （b接点のブレードだけは交差を見せるため右へ `bladeOvershoot` だけ出るが、
 * そこは電線よりずっと上なので電線とはぶつからない）。
 * `layout()` が電線を `cx ± symbolWidth / 2` まで引いているので、この約束を守ると
 * 電線と記号がぴったり突き合わさる（守らないと両側に隙間が空く）。
 * 記号幅 `s` を以下では **1モジュール（M）** と呼ぶ。寸法はすべて M の倍率で書く。
 *
 * 接点は「固定接点の縦棒2本 ＋ 可動接点（ブレード）」の刃形で描く。ブレードの勾配は
 * a接点もb接点も同じ（`bladeSlope`）にして、**長さだけ**を変える:
 * - a接点: 右の固定接点の手前 `bladeGap` M で止まる（開いている）
 * - b接点: 右の固定接点を `bladeOvershoot` M だけ**横切り**、固定接点は交差点の
 *   さらに `breakOverrun` M 上まで伸びる（閉じている）
 * 勾配が同じなので記号の傾きが図中でそろい、開閉は「横切るか・届かないか」の1点で読める。
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
  /** 固定接点（縦棒）の半分の高さ。縦棒全体で 0.68 M。 */
  contactBarHalf: 0.34,
  /** ブレードの勾配（立ち上がり ÷ 横走り）。0.6 ＝ 電線から約31°。a接点もb接点も同じ。 */
  bladeSlope: 0.6,
  /** a接点でブレードの先を右の縦棒より内側に止める量。＝開いている隙間（0.30 M）。 */
  bladeGap: 0.3,
  /** b接点でブレードを右の縦棒より外へ出す量（＝縦棒と交差して閉じている）。 */
  bladeOvershoot: 0.1,
  /** b接点で右の縦棒を交差点より上に出す量（交差がはっきり見える）。 */
  breakOverrun: 0.22,
  /** 押ボタンの操作子（キャップ）の高さ。 */
  actuatorTop: 0.82,
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

/**
 * ブレード（可動接点）の先端。勾配は共通で、長さだけが違う。
 * a接点は右の縦棒の手前で止まり（開）、b接点は縦棒を横切って外へ出る（閉）。
 */
function bladeTip(kind: CellKind, cx: number, cy: number, s: number): { x: number; y: number } {
  const m = SYMBOL_METRICS;
  const open = !BREAK_KINDS.includes(kind);
  const run = s * (open ? 1 - m.bladeGap : 1 + m.bladeOvershoot);
  return { x: cx - s * 0.5 + run, y: cy - run * m.bladeSlope };
}

/** 度 → SVGの角度で見たブレードの向き（y下向きの座標系なので上り勾配は負の角）。 */
function bladeDeg(): number {
  return (Math.atan2(-SYMBOL_METRICS.bladeSlope, 1) * 180) / Math.PI;
}

/**
 * 1つの接点記号の図形（JIS C 0617 の刃形）。§11.1
 *
 * 返す図形は必ず「左の縦棒 → 右の縦棒 → ブレード」で始まる。描画側や試験は
 * この並びに頼ってよい（押ボタンの操作子・限時記号はその後ろに続く）。
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
  const tip = bladeTip(kind, cx, cy, s);
  const closed = BREAK_KINDS.includes(kind);
  // b接点はブレードが右の固定接点を横切る。固定接点はその交差点のさらに上まで伸ばす
  const crossY = cy - s * m.bladeSlope;
  const rightTop = closed ? crossY - s * m.breakOverrun : top;

  const shapes: Shape[] = [
    line('symbol', xL, top, xL, bottom),
    line('symbol', xR, rightTop, xR, bottom),
    line('symbol', xL, cy, tip.x, tip.y),
  ];

  if (PUSH_BUTTON_KINDS.includes(kind)) {
    // 操作子は記号の中心（ブレードの上）から立てる。軸は破線＝機械的連結（IEC 60617）
    const capY = cy - s * m.actuatorTop;
    const stemY = cy - s * 0.5 * m.bladeSlope; // x = cx でブレードに乗る高さ
    shapes.push({ ...line('symbol', cx, stemY, cx, capY), dashed: true });
    shapes.push(line('symbol', cx - s * m.actuatorHalf, capY, cx + s * m.actuatorHalf, capY));
  }
  if (TIMED_KINDS.includes(kind)) {
    // 限時記号（パラシュート）は**ブレードの上に載せる**。弦がブレートと平行になるよう傾ける。
    // 開口はブレードの側＝閉じる向きを向き、限時動作（オンディレー）を表す
    const deg = bladeDeg();
    shapes.push({
      kind: 'arc',
      role: 'symbol',
      cx: (xL + tip.x) / 2,
      cy: (cy + tip.y) / 2,
      r: s * m.delayRadius,
      startDeg: deg + 180,
      endDeg: deg + 360,
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
