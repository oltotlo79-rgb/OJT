import { roleLabel, type BoardTerminal, type TerminalRole } from '@ojt/board-model';
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
 * 正面視（盤の高さ300mmがビューポート高の約8割）で画面上 10px 相当になるよう 4.6mm とした。
 * ピン間隔は 9mm（列）× 12mm（段）なので、番号＋役割の2行（合計 9.1mm）でも隣と当たらない。
 */
const NUMBER_MM = 4.6;
/** 役割文字の高さ[mm]。 */
const ROLE_MM = 3;

/** 端子台の印字テクスチャの最小の幅・奥行[mm]（`TerminalBlock` の `MIN_BODY_MM` と合わせる）。 */
const MIN_FACE_MM = 16;

/** 役割ごとの印字色（極性は色でも区別する）。 */
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
      const x = (terminal.pos.x - originX) * PX_PER_MM;
      const y = (terminal.pos.y - originY) * PX_PER_MM;
      // 盤定義のラベルは `S1 ⑨ com` の形。丸数字だけを取り出し、役割は `roleLabel()` で記号にする
      const number = terminal.label.split(' ').at(-2) ?? terminal.label;
      ctx.fillStyle = '#F2F2EE';
      ctx.font = `700 ${NUMBER_MM * PX_PER_MM}px sans-serif`;
      ctx.fillText(number, x, y - NUMBER_MM * PX_PER_MM * 0.55);
      ctx.fillStyle = ROLE_COLOR[terminal.role];
      ctx.font = `700 ${ROLE_MM * PX_PER_MM}px sans-serif`;
      ctx.fillText(roleLabel(terminal.role), x, y + NUMBER_MM * PX_PER_MM * 0.6);
    }
  });
}

/** 端子台の印字に使う短い名前（`PL1+` / `PB1c` / `P1` / `N1`）。§6.4 */
export function blockTerminalMark(terminal: BoardTerminal): string {
  const [part, name] = terminal.id.split('.');
  if (part === undefined || name === undefined) return terminal.id;
  if (part === 'TB_PL') return `PL${name}`;
  if (part === 'TB_PB') return `PB${name}`;
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
  if (terminals.length === 0) return undefined;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // 端子が1〜2点しかない端子台でもテクスチャが潰れないよう最小サイズを持たせる
  const widthMm = Math.max(MIN_FACE_MM, maxX - minX + padMm * 2);
  const heightMm = Math.max(MIN_FACE_MM, maxY - minY + padMm * 2);
  const offsetX = (widthMm - (maxX - minX)) / 2;
  const offsetY = (heightMm - (maxY - minY)) / 2;
  return makeCanvasTexture(widthMm, heightMm, (ctx) => {
    ctx.font = `700 ${ROLE_MM * PX_PER_MM}px sans-serif`;
    for (const terminal of terminals) {
      const x = (terminal.pos.x - minX + offsetX) * PX_PER_MM;
      const y = (terminal.pos.y - minY + offsetY) * PX_PER_MM;
      ctx.fillStyle = ROLE_COLOR[terminal.role];
      ctx.fillText(blockTerminalMark(terminal), x, y + ROLE_MM * PX_PER_MM * 1.5);
    }
  });
}
