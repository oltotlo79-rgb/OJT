import {
  OUTLET_ID,
  PLC_PART_ID,
  roleLabel,
  type BoardTerminal,
  type TerminalRole,
} from '@ojt/board-model';
import { parseTerminalId } from '@ojt/circuit-sim';
import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';

/**
 * 端子の印字ラベル。設計仕様 §6.2 / §8.2 / §15。
 *
 * 実物のソケットと端子台にはネジの脇に番号が印刷されており、受検者はそれを見て配線する。
 * §6.2 の非連番配置（段4に ④ が混ざる）を間違えないためにも、番号は**常時**見えている必要がある。
 *
 * 描き方の選択（本アプリの決定）:
 * `@react-three/drei` の `<Text>`（SDF）は1文字列につき1メッシュを作るため、
 * ソケット8個 × 14端子 × 2行（番号＋役割）＋端子台 26端子 ＝ 250個以上のメッシュになり、
 * §15 の性能目標（内蔵GPUで60fps）に対して無視できないドローコール増になる。
 * そこで**機器1個につきキャンバステクスチャ1枚**にまとめて焼き、
 * 機器の面に1枚の板として貼る。ドローコールは機器の数（8＋4＝12枚）で済み、
 * 解像度も `PX_PER_MM` を上げるだけで「ソケット拡大」視点の判読性を確保できる。
 */

/** テクスチャの解像度[px/mm]。正面視で 10px 相当、ソケット拡大では十分に判読できる。 */
export const PX_PER_MM = 16;

/**
 * 端子番号の文字高さ[mm]。
 * 正面視（盤の高さ245mmがビューポート高の約9割）で画面上 10px 相当になるよう 4.6mm とした。
 */
export const NUMBER_MM = 4.6;

/**
 * 役割文字の高さ[mm]。
 *
 * ソケットのネジ端子の**段ピッチは 8mm**（`SOCKET_TIER_ROW_PITCH_MM`）しかない。
 * 以前は「列 9mm × 段 12mm」という誤ったコメントのもとで 3mm にしていたため、
 * 番号（4.6mm）＋役割（3mm）＋行間で 9.1mm となり、`⑨ COM` の COM が
 * 次の段の `⑬` に重なっていた（レビュー指摘）。
 * 8mm に「番号 4.6 ＋ 行間 0.4 ＋ 役割 2.2 ＋ 段間 0.8」で収まる値にする。
 */
export const ROLE_MM = 2.2;

/** 番号と役割のあいだの余白[mm]。 */
export const ROW_GAP_MM = 0.4;
/** 隣の段の印字とのあいだに必ず空ける余白[mm]。 */
export const TIER_CLEARANCE_MM = 0.8;

/**
 * 端子の中心から番号の中心までの奥行方向のずれ[mm]（負＝盤の奥側）。
 * ネジ頭（半径1.8mm）の上にできるだけ文字を載せないよう、8mm の段ピッチの中で
 * 許される範囲いっぱいまで奥へ寄せてある。
 */
export const NUMBER_CENTER_MM = -2;
/** 端子の中心から役割文字の中心までの奥行方向のずれ[mm]（正＝盤の手前側）。 */
export const ROLE_CENTER_MM = NUMBER_CENTER_MM + NUMBER_MM / 2 + ROW_GAP_MM + ROLE_MM / 2;

/**
 * 印字の板をソケット本体より外へ広げる量[mm]（四方）。
 * 外側の列の `COM` は端子の中心から左右に 2mm ほどはみ出すが、端子の中心は本体の端から
 * 3mm しかない。板を本体ぴったりにすると端が切れるので、板だけ一回り大きくする。
 */
export const SOCKET_PLATE_MARGIN_MM = 4;

/**
 * 半角1文字の幅比（sans-serif 700 のおおよその値）。
 * 実測ではなく「はみ出さないこと」を検査するための概算なので、やや大きめに取る。
 */
const HALF_WIDTH_RATIO = 0.62;

/** 印字1つぶんの外接矩形（板の左上を原点とする mm）。 */
export interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 文字列の描画幅[mm]の概算（全角は1文字ぶん、半角は `HALF_WIDTH_RATIO` ぶん）。 */
export function labelWidthMm(text: string, fontMm: number): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    units += code >= 0x2000 ? 1 : HALF_WIDTH_RATIO;
  }
  return units * fontMm;
}

/** `fillText`（中央揃え・中央ベースライン）の外接矩形。 */
function textBox(centerX: number, centerY: number, text: string, fontMm: number): LabelBox {
  const half = labelWidthMm(text, fontMm) / 2;
  return {
    x0: centerX - half,
    x1: centerX + half,
    y0: centerY - fontMm / 2,
    y1: centerY + fontMm / 2,
  };
}

/**
 * ソケットの端子1個ぶんの印字の位置（板の左上を原点とする mm）。
 * 描画（`socketFaceTexture`）と、段どうしが当たらないことを確かめる単体テストの両方がこれを使う。
 */
export function socketLabelBoxes(
  terminal: BoardTerminal,
  originX: number,
  originY: number,
): { number: LabelBox; role: LabelBox } {
  const x = terminal.pos.x - originX;
  const y = terminal.pos.y - originY;
  return {
    number: textBox(x, y + NUMBER_CENTER_MM, terminalNumber(terminal), NUMBER_MM),
    role: textBox(x, y + ROLE_CENTER_MM, roleLabel(terminal.role), ROLE_MM),
  };
}

/** 端子台の印字テクスチャの最小の幅・奥行[mm]（`TerminalBlock` の `MIN_BODY_MM` と合わせる）。 */
const MIN_FACE_MM = 16;

/**
 * 端子群の外接矩形から印字の板の位置・大きさを求める（盤モデル mm）。
 *
 * `blockFaceTexture()`（端子台）と `PlcUnit.tsx` の `plcFaceRect()`（机上のPLC本体）が
 * どちらも同じ外接矩形の計算＋ `MIN_FACE_MM` の下限をコピーして持っていた
 * （レビュー MERGE #15）。ここへ1つにまとめ、両方から呼ぶ。
 */
export interface FaceRect {
  /** 端子群の外接矩形の左上・右下（盤モデル mm）。 */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** 板の中心（盤モデル mm）。3Dでメッシュを置くときはこれを使う。 */
  cx: number;
  cy: number;
  /** 板の幅・奥行[mm]（`MIN_FACE_MM` の下限つき）。 */
  w: number;
  h: number;
}

export function faceRect(terminals: readonly BoardTerminal[], padMm: number): FaceRect | undefined {
  if (terminals.length === 0) return undefined;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(MIN_FACE_MM, maxX - minX + padMm * 2);
  const h = Math.max(MIN_FACE_MM, maxY - minY + padMm * 2);
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w, h };
}

/**
 * 端子台の印字（`PL1+` / `P1`）の文字高さ[mm]。
 * 端子台のネジ端子は 9mm ピッチで1行しか印字しないので、ソケットの役割文字（2.2mm）より
 * 大きくてよい。ソケット側を詰めた影響がここに及ばないよう、別の定数にしてある。
 */
const BLOCK_MARK_MM = 3;

/** 役割ごとの印字色（極性は色でも区別する）。端子台の**明るい**台座（`#F1EFE9`）に載せる用。 */
const ROLE_COLOR: Readonly<Record<TerminalRole, string>> = {
  'coil+': '#D14343',
  'coil-': '#2E6BD6',
  com: '#1B1E23',
  no: '#1B1E23',
  nc: '#1B1E23',
  '+': '#D14343',
  '-': '#2E6BD6',
  c: '#1B1E23',
  a: '#1B1E23',
  b: '#1B1E23',
  ac: '#1B1E23',
  x: '#1B1E23',
  y: '#1B1E23',
  ss: '#1B1E23',
  'plc-com': '#1B1E23',
  'ac-l': '#D14343',
  'ac-n': '#2E6BD6',
};

/**
 * ソケットの役割印字の色。ソケット本体は黒（`SOCKET_BODY_COLOR` = `#23262B`）なので、
 * 端子台と同じ濃色（`#1B1E23`）では**黒地に黒**でまったく読めなかった（レビュー指摘の
 * 「`COM` が見えない」の主因）。番号と同じ明るい字にし、極性だけ明るい赤／青で区別する。
 */
export const SOCKET_ROLE_COLOR: Readonly<Record<TerminalRole, string>> = {
  'coil+': '#FF8A8A',
  'coil-': '#8FB8FF',
  com: '#E4E7EC',
  no: '#E4E7EC',
  nc: '#E4E7EC',
  '+': '#FF8A8A',
  '-': '#8FB8FF',
  c: '#E4E7EC',
  a: '#E4E7EC',
  b: '#E4E7EC',
  ac: '#E4E7EC',
  x: '#E4E7EC',
  y: '#E4E7EC',
  ss: '#E4E7EC',
  'plc-com': '#E4E7EC',
  'ac-l': '#FF8A8A',
  'ac-n': '#8FB8FF',
};

/** キャンバスを作って描き、テクスチャにする。キャンバスが使えない環境では undefined。 */
export function makeCanvasTexture(
  widthMm: number,
  heightMm: number,
  draw: (ctx: CanvasRenderingContext2D, widthPx: number, heightPx: number) => void,
): Texture | undefined {
  const widthPx = Math.max(1, Math.round(widthMm * PX_PER_MM));
  const heightPx = Math.max(1, Math.round(heightMm * PX_PER_MM));
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return undefined;
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  draw(ctx, widthPx, heightPx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * ソケット1個ぶんの印字（`⑬ −` のような盤定義の `label` をそのまま焼く）。
 * 盤の mm 座標 `(originX, originY)` を板の左上に対応させるので、
 * 端子が段付きに並んでいても印字は端子の真上に来る。
 */
export function socketFaceTexture(
  terminals: readonly BoardTerminal[],
  originX: number,
  originY: number,
  plateWidthMm: number,
  plateHeightMm: number,
): Texture | undefined {
  if (terminals.length === 0) return undefined;
  return makeCanvasTexture(plateWidthMm, plateHeightMm, (ctx) => {
    for (const terminal of terminals) {
      // 位置は `socketLabelBoxes()` が持つ（テストが検査するのと同じ値で描く）
      const boxes = socketLabelBoxes(terminal, originX, originY);
      const x = (terminal.pos.x - originX) * PX_PER_MM;
      ctx.fillStyle = '#F2F2EE';
      ctx.font = `700 ${NUMBER_MM * PX_PER_MM}px sans-serif`;
      ctx.fillText(
        terminalNumber(terminal),
        x,
        ((boxes.number.y0 + boxes.number.y1) / 2) * PX_PER_MM,
      );
      ctx.fillStyle = SOCKET_ROLE_COLOR[terminal.role];
      ctx.font = `700 ${ROLE_MM * PX_PER_MM}px sans-serif`;
      ctx.fillText(roleLabel(terminal.role), x, ((boxes.role.y0 + boxes.role.y1) / 2) * PX_PER_MM);
    }
  });
}

/** 端子台の印字に使う短い名前（`PL1+` / `PB1c` / `P1` / `N1`）。§6.4 */
export function blockTerminalMark(terminal: BoardTerminal): string {
  /*
   * 端子名側は `.` を含んでよい（`PLC.0.00` / `PLC.COM.A`。§6.4 / 4A 前提#8）。
   * `split('.')` の2番目だけを取ると CP1E が `0`、JW300 が `COM` になり、機種を替えた
   * 瞬間に印字が壊れる（4A H-8）。**最初の `.` で割る `parseTerminalId()`** を使う。
   */
  const { part, name } = parseTerminalId(terminal.id);
  if (part === 'TB_PL') return `PL${name}`;
  if (part === 'TB_PB') return `PB${name}`;
  // 机上のPLC本体と壁コンセントは端子名そのものが印字（`X0` / `0.00` / `COM.A` / `L`）。§10.1
  if (part === PLC_PART_ID || part === OUTLET_ID) return name;
  return `${part}${name}`;
}

/** 盤定義のラベルから丸数字だけを取り出す（`S1 ⑨ com` → `⑨`）。 */
export function terminalNumber(terminal: BoardTerminal): string {
  return terminal.label.split(' ').at(-2) ?? terminal.label;
}

/** 端子台1個ぶんの印字。端子の外接矩形＋余白を板とし、各端子の真下に名前を描く。 */
export function blockFaceTexture(
  terminals: readonly BoardTerminal[],
  padMm: number,
): Texture | undefined {
  // 端子が1〜2点しかない端子台でもテクスチャが潰れないよう、外接矩形と最小サイズは
  // `faceRect()` が持つ（`PlcUnit.tsx` の `plcFaceRect()` と共通。レビュー MERGE #15）
  const rect = faceRect(terminals, padMm);
  if (rect === undefined) return undefined;
  const offsetX = (rect.w - (rect.maxX - rect.minX)) / 2;
  const offsetY = (rect.h - (rect.maxY - rect.minY)) / 2;
  return makeCanvasTexture(rect.w, rect.h, (ctx) => {
    ctx.font = `700 ${BLOCK_MARK_MM * PX_PER_MM}px sans-serif`;
    for (const terminal of terminals) {
      const x = (terminal.pos.x - rect.minX + offsetX) * PX_PER_MM;
      const y = (terminal.pos.y - rect.minY + offsetY) * PX_PER_MM;
      ctx.fillStyle = ROLE_COLOR[terminal.role];
      ctx.fillText(blockTerminalMark(terminal), x, y + BLOCK_MARK_MM * PX_PER_MM * 1.5);
    }
  });
}
