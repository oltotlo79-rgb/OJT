import {
  BLOCK_PITCH_MM,
  N_RAIL_ID,
  OUTLET_ID,
  P_RAIL_ID,
  PLC_PART_ID,
  PLC_TERMINAL_PITCH_MM,
  POWER_SUPPLY_ID,
  roleLabel,
  SOCKET_BODY_WIDTH_MM,
  SOCKET_COL_PITCH_MM,
  type BoardTerminal,
  type TerminalRole,
} from '@ojt/board-model';
import { parseTerminalId } from '@ojt/circuit-sim';
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { busSideMark, JA_PIN } from '../i18n/ja.js';
import { SOCKET_BODY_COLOR } from '../session/colors.js';
import {
  busSideOfRole,
  groupOfRole,
  PIN_GROUP_COLOR,
  type PinGroup,
} from '../session/socket-pins.js';

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
 * 段見出しの文字高さ[mm]。利用者要望 2026-09-20
 * 「リレーソケットの各番号はどこが何かわからないから分かるようにしてね」。
 *
 * ネジの脇の役割文字（`ROLE_MM` ＝ 2.2mm）は「小さすぎて誰も気付かない」と言われた大きさだが、
 * 段ピッチ 8mm の中にこれ以上の余地は無い（`ROLE_MM` の doc comment 参照）。そこで
 * **段の外側の余白**に、日本語の段見出し（`b接点` / `a接点` / `COM` / `コイル`）を別に印字する。
 *
 * 値はいちばん狭い奥端（板の余白 4mm ＋ 段1の番号までの 1.7mm ＝ 5.7mm）に
 * 「見出し 3.25 ＋ 余白 0.4 ＋ 色帯 1.0 ＋ 余白 0.6」が収まる最大で、番号（4.6mm）の約7割。
 * 「ソケット拡大」の視点では画面上 10px 相当になる（番号は 14px 相当）。
 */
export const HEADER_MM = 3.25;

/** 役割の色帯の厚み[mm]。 */
export const BAND_MM = 1;
/** 色帯と段の印字（番号・役割文字）のあいだの余白[mm]。 */
export const BAND_GAP_MM = 0.6;
/** 色帯と段見出しのあいだの余白[mm]。 */
export const HEADER_GAP_MM = 0.4;
/**
 * 色帯を**本体の端で止める**ための、外側の列の端子から本体の端までの距離[mm]。
 * `socketPinOffset()` の列の置き方（`(本体幅 − 3列ぶんのピッチ) / 2`）と同じ式で求めるので、
 * 盤定義が列を動かせば帯の端も追随する。帯が本体からはみ出すと、隣のソケットとの 2mm の隙間や
 * 明るい台座の上に色が乗ってしまう。
 */
export const BAND_EDGE_MM = (SOCKET_BODY_WIDTH_MM - 3 * SOCKET_COL_PITCH_MM) / 2;

/**
 * 半角1文字の送り幅[em]の表（`700 …px` ＋ `LABEL_FONT`）。
 *
 * 以前はどの半角文字も一律 `0.62em` という「やや大きめの概算」にしていたが、これは
 * **太字の大文字に対しては小さすぎる**。実測（下記）では `C`=0.688 / `O`=0.801 / `M`=0.908 で、
 * `COM` は 2.40em ある。一律 0.62 では 1.86em と見積もるので **22% 少なく**数えてしまい、
 * 「重なっていない」と単体テストが言うのに画面では文字が詰まって読めない、という
 * 見落としが起きる（利用者指摘 2026-09-20「3Dのリレーソケット部のCOMの文字重なって見えない」）。
 *
 * 値は Chromium（Windows の `sans-serif` ＝ Meiryo。`700 1000px` で `measureText()`）の実測で、
 * このアプリが焼く文字（番号・役割・段見出し・端子名）の実寸と一致する。
 * 表に無い半角文字は実測の最大（`%` ＝ 1.141em）を使う（少なく数えない側へ倒す）。
 * 全角（`接` `点` `コ` `イ` `ル` `①`〜`⑭` など U+2000 以上）は 1em。
 */
const CHAR_WIDTH_ROWS: ReadonlyArray<readonly [number, string]> = [
  [0.305, 'il'],
  [0.347, ',.'],
  [0.374, 'j'],
  [0.391, '!f'],
  [0.404, ':;'],
  [0.426, 't'],
  [0.47, '-r'],
  [0.492, '()[]'],
  [0.5, '|'],
  [0.509, 'IJ'],
  [0.537, '"'],
  [0.55, 'cs'],
  [0.567, 'z'],
  [0.582, '?'],
  [0.594, '/'],
  [0.609, 'Lvy'],
  [0.62, 'Fe'],
  [0.625, 'k'],
  [0.63, 'a'],
  [0.641, 'x'],
  [0.649, 'o'],
  [0.653, 'E{}'],
  [0.661, 'T'],
  [0.666, 'bdgpq'],
  [0.674, 'SZ'],
  [0.677, '0123456789$*_`'],
  [0.68, 'hnu'],
  [0.687, 'P'],
  [0.688, 'C'],
  [0.702, 'Y'],
  [0.729, 'VX'],
  [0.731, 'B'],
  [0.74, 'A'],
  [0.743, 'K'],
  [0.75, 'R'],
  [0.775, 'G'],
  [0.783, 'U'],
  [0.79, 'D'],
  [0.801, 'OQ'],
  [0.806, 'H'],
  [0.81, 'N'],
  [0.828, '&'],
  [0.833, '#+<=>^~'],
  [0.895, 'w'],
  [0.908, 'M'],
  [1.003, '@'],
  [1.026, 'm'],
  [1.051, 'W'],
  [1.141, '%'],
];

const CHAR_WIDTH_EM: ReadonlyMap<string, number> = new Map(
  CHAR_WIDTH_ROWS.flatMap(([em, chars]) => [...chars].map((char) => [char, em] as const)),
);

/** 表に無い半角文字の幅[em]（実測の最大。少なく数えない側へ倒す）。 */
const UNKNOWN_HALF_WIDTH_EM = 1.141;
/** 全角1文字の幅[em]。 */
const FULL_WIDTH_EM = 1;

/** 印字1つぶんの外接矩形（板の左上を原点とする mm）。 */
export interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 文字列の描画幅[mm]（全角は1文字ぶん、半角は `CHAR_WIDTH_EM` の実測値）。 */
export function labelWidthMm(text: string, fontMm: number): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    units += code >= 0x2000 ? FULL_WIDTH_EM : (CHAR_WIDTH_EM.get(char) ?? UNKNOWN_HALF_WIDTH_EM);
  }
  return units * fontMm;
}

/**
 * 印字に使う書体スタック。3D-14
 *
 * `CHAR_WIDTH_EM` は **Meiryo の実測**（Windows の Chromium で `sans-serif` が解決する先）
 * なのに、焼くときの指定は `sans-serif` のままだった。`sans-serif` が何に解決するかは
 * OS と利用者の設定で変わるうえ、画面本体の書体は `app/global.css` で `Yu Gothic UI` を
 * 先頭に置いている。つまり「印字が重ならない」という不変条件が、テストからは見えない
 * **解決先まかせ**になっていた（単体テストは同じ幅表から起こした期待値としか比べないので
 * 食い違いを検出できない）。幅表を測った書体を**名指しで先頭に置く**ことで、
 * 焼いた絵と `labelWidthMm()` の見積りが同じ前提に乗る。
 */
export const LABEL_FONT = 'Meiryo, "Yu Gothic UI", sans-serif';

/** `ctx.font` に渡す文字列（太字・`fontMm` の高さ・`LABEL_FONT`）。焼く5箇所が共有する。 */
export function labelFont(fontMm: number): string {
  return `700 ${fontMm * PX_PER_MM}px ${LABEL_FONT}`;
}

/**
 * 見積り（`labelWidthMm()`）と実測（`measureText()`）のずれの許容幅[割合]。
 * 書体が入れ替わっても 2% 以内なら重なり判定の余白（`BLOCK_MARK_GAP_MM` = 1mm 等）に収まる。
 */
export const LABEL_WIDTH_TOLERANCE = 0.02;

/**
 * 開発時だけ、幅表の見積りを本物の `measureText()` と突き合わせる。3D-14
 *
 * 実環境（Chromium）でしか本当の字幅は分からないので、単体テストではなく**焼くその場**で
 * 確かめる。ずれたら「幅表を測り直す必要がある」ことが開発中に必ず目に入る。
 * 製品ビルドでは何もしない（`import.meta.env.DEV` が false）。
 */
export function assertLabelWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontMm: number,
): void {
  if (!import.meta.env.DEV || text === '') return;
  // 偽のキャンバス（単体テスト）も2Dの無い環境（`happy-dom`）も測れない。測れないなら黙る
  if (typeof ctx.measureText !== 'function') return;
  const measuredPx = ctx.measureText(text).width;
  if (!Number.isFinite(measuredPx) || measuredPx === 0) return;
  const estimatedPx = labelWidthMm(text, fontMm) * PX_PER_MM;
  const drift = Math.abs(measuredPx - estimatedPx) / Math.max(1, estimatedPx);
  if (drift <= LABEL_WIDTH_TOLERANCE) return;
  // 開発時だけの気づき（製品ビルドには入らない）
  console.warn(
    `[labels] 字幅の見積りが実測と ${(drift * 100).toFixed(1)}% ずれています: ` +
      `"${text}" 見積り ${estimatedPx.toFixed(1)}px / 実測 ${measuredPx.toFixed(1)}px ` +
      `(${ctx.font})。CHAR_WIDTH_ROWS を測り直してください。`,
  );
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
 * ネジの脇に印字する役割の文字。
 *
 * ふだんは盤定義の銘板表記（`roleLabel()`。`a` / `b`）だが、2つだけ置き換える。
 *
 * 1. **コイルの⑭⑬は `+` / `−` を `P(+)` / `N(−)` に**。利用者指摘 2026-09-20
 *    「リレーソケットの13、14番の端子にコイルとしか書いてないがこれではどちらがPかNか分からない」。
 *    段見出しは「コイル」のまま（何のネジかを離れた所から示す）で、**どちらが P でどちらが N か**は
 *    ネジの手元のこの文字が示す、という役割分担にする。⑭⑬は段4の内側の2列なので、
 *    4文字（`P(+)` ＝ 5.5mm）でも列ピッチ 8mm に収まり本体の端にも届かない。
 * 2. **COM（⑨〜⑫）は `COM` ではなく1文字の `C`**（`COM_PIN_MARK`）。利用者指摘 2026-09-20
 *    「3Dのリレーソケット部のCOMの文字重なって見えないけど」。
 *    `COM` は 2.2mm（`ROLE_MM`）でも 5.3mm 幅あり、⑨〜⑫の4本が列ピッチ 8mm で並ぶ段では
 *    文字のあいだが 2.7mm しか空かず、`COM COM COM COM` が1本の帯に見える。さらに外側の
 *    ⑨と⑫では本体の端まで 0.36mm しか残らず、明るい台座へ文字がにじみ出てしまう
 *    （`PRINT_EDGE_MARGIN_MM`）。
 *    **`C` にしてよい理由**は、この段が COM であることは段見出し「COM」と青い色帯が既に言っており、
 *    ネジの手元の文字は「いま締めているこの1本が何か」を確かめるためのものだから。
 *    b接点の段は `b`、a接点の段は `a` と1文字なので、COM を `C` にすると
 *    実物の配線図と同じ **b / a / C** の3文字組になり、3段の見た目もそろう。
 *
 * 置き換えを `board-model` の `roleLabel()` 側でやらないのは、あちらが**実物の銘板の表記**
 * （MY4N のソケットには `COM` / `+` / `−` と刻印がある）であり、机上のPLCの端子台の印字や
 * ツールチップ・部品カードもそれを使うため。ここは「訓練者に分かるように盤へ足した案内」なので
 * 描画側（renderer）が持つ。段見出し・ツールチップ・部品カードの3か所は今までどおり `COM` と書く。
 *
 * 隣のネジの印字とも本体の端とも当たらないことは `test/socket-face-print.test.ts` が mm で確かめる。
 */
export function socketRoleMark(terminal: BoardTerminal): string {
  if (terminal.role === 'com') return COM_PIN_MARK;
  if (terminal.role !== 'coil+' && terminal.role !== 'coil-') return roleLabel(terminal.role);
  return busSideMark(busSideOfRole(terminal.role));
}

/**
 * COM のネジの脇に印字する1文字（段見出しの `COM` に対する短縮形）。
 * 言葉としての `COM` は `i18n/ja.ts` の `JA_PIN.group.com` が持ち、こちらは**印字の都合の短縮形**
 * なので描画側に置く（`socketRoleMark()` の doc comment 参照）。
 */
export const COM_PIN_MARK = 'C';

/**
 * ネジの脇の印字（番号・役割文字）が本体の端から必ず残す余白[mm]。
 *
 * 外側の列のネジは本体の端から `BAND_EDGE_MM`（3mm）しか離れていないので、その中に収まる
 * いちばん大きな印字は番号（`NUMBER_MM` ＝ 4.6mm 幅の丸数字）で、端に残るのは 0.7mm である。
 * **ネジ脇の印字はこの 0.7mm を割ってはならない**: 本体の外は明るい台座（`BOARD_PLATE_COLOR`）で、
 * 役割の色（橙・緑・青・赤）はそこではコントラスト比 2 を切って読めなくなる。
 * 段見出しは別で、板の余白へ出てよい（自前の黒い下地 `HEADER_PAD_MM` を敷いてあるため）。
 */
export const PRINT_EDGE_MARGIN_MM = BAND_EDGE_MM - NUMBER_MM / 2;

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
    role: textBox(x, y + ROLE_CENTER_MM, socketRoleMark(terminal), ROLE_MM),
  };
}

/**
 * 段見出しの文字の周りに敷く下地の余白[mm]。
 *
 * 奥ティアの1段目と手前ティアの4段目の見出しは、板の余白（`SOCKET_PLATE_MARGIN_MM`）に
 * 出るので**本体の黒から外れ、明るい台座（`BOARD_PLATE_COLOR`）の上に載る**。
 * 明るい地の上では役割の色（橙・緑・青・赤）はコントラスト比が 1.3 程度しか無く読めないので、
 * 文字の下に本体と同じ黒の下地を敷いて、4つの見出しをどこでも同じ見え方にする。
 */
export const HEADER_PAD_MM = 0.4;

/** 段見出し1つ（板の左上を原点とする mm）。 */
export interface SocketHeader {
  group: PinGroup;
  /** 印字する言葉（`b接点` など。`i18n/ja.ts` が持つ）。 */
  text: string;
  /** 文字の外接矩形（重なりの検査に使う）。 */
  box: LabelBox;
  /** 文字の下地（`box` を `HEADER_PAD_MM` だけ広げたもの）。 */
  plate: LabelBox;
  /** 文字の中心（`fillText` に渡す位置）。 */
  cx: number;
  cy: number;
}

/** 役割の色帯1本（板の左上を原点とする mm）。 */
export interface SocketBand {
  group: PinGroup;
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * ソケットの面の「役割の色帯」と「段見出し」。§6.2 / §8.2
 * 利用者要望 2026-09-20「リレーソケットの各番号はどこが何かわからないから分かるようにしてね」。
 *
 * 置き方:
 * - 段（`pos.y` が同じ端子）ごとに、**同じ役割が横に続くあいだ**を1本の帯にする。
 *   段4は `④`（b接点）と `⑭⑬`（コイル）で役割が変わるので、そこで帯の色が切り替わる。
 * - 帯と見出しは段の**外側**（番号にも役割文字にも触れない側）へ出す。ネジ端子は
 *   「奥ティア2段・手前ティア2段」なので、段の並び順で外向きを交互に取ると、
 *   奥ティアの1段目は板の奥端へ、2段目は中央の差込領域へ、という空いている側に必ず出る。
 * - 見出しは帯の中心の真上（外側）に1つ。**帯1本に見出し1つ**で、返す2つの配列は同じ並びで対応する。
 *
 * 色だけでは第1色覚・第2色覚の人が4つを見分けられないので、帯には必ず言葉の見出しが付く
 * （`session/socket-pins.ts` の `PIN_GROUP_COLOR` の doc comment 参照）。
 *
 * 純関数にして export するのは、焼いた絵を見られない環境（`happy-dom` には2Dキャンバスが無い）
 * でも「何にも重ならない」「板からはみ出さない」を mm の数値で検査できるようにするため。
 */
export function socketFaceRows(
  terminals: readonly BoardTerminal[],
  originX: number,
  originY: number,
): { headers: SocketHeader[]; bands: SocketBand[] } {
  const headers: SocketHeader[] = [];
  const bands: SocketBand[] = [];
  if (terminals.length === 0) return { headers, bands };

  // 帯を本体の端で止めるための左右の限界（外側の列の端子＋`BAND_EDGE_MM`）
  const xs = terminals.map((terminal) => terminal.pos.x - originX);
  const limitX0 = Math.min(...xs) - BAND_EDGE_MM;
  const limitX1 = Math.max(...xs) + BAND_EDGE_MM;

  // 段にまとめる（キーは板の左上からの奥行。浮動小数の誤差を避けて文字列にする）
  const rows = new Map<string, BoardTerminal[]>();
  for (const terminal of terminals) {
    const key = (terminal.pos.y - originY).toFixed(2);
    const row = rows.get(key);
    if (row === undefined) rows.set(key, [terminal]);
    else row.push(terminal);
  }

  [...rows.keys()]
    .sort((a, b) => Number(a) - Number(b))
    .forEach((key, rowIndex) => {
      const row = [...(rows.get(key) ?? [])].sort((a, b) => a.pos.x - b.pos.x);
      const outward = rowIndex % 2 === 0 ? -1 : 1;
      // その段の印字の外縁（番号と役割文字のうち、外向きにいちばん出ているもの）
      const edges = row.map((terminal) => {
        const boxes = socketLabelBoxes(terminal, originX, originY);
        return outward < 0
          ? Math.min(boxes.number.y0, boxes.role.y0)
          : Math.max(boxes.number.y1, boxes.role.y1);
      });
      const ref = outward < 0 ? Math.min(...edges) : Math.max(...edges);
      const bandNear = ref + outward * BAND_GAP_MM;
      const bandFar = bandNear + outward * BAND_MM;
      const headerY = bandFar + outward * (HEADER_GAP_MM + HEADER_MM / 2);

      let run: { group: PinGroup; x0: number; x1: number } | undefined;
      const flush = (): void => {
        if (run === undefined) return;
        const x0 = Math.max(run.x0, limitX0);
        const x1 = Math.min(run.x1, limitX1);
        bands.push({
          group: run.group,
          color: PIN_GROUP_COLOR[run.group],
          x0,
          x1,
          y0: Math.min(bandNear, bandFar),
          y1: Math.max(bandNear, bandFar),
        });
        const text = JA_PIN.group[run.group];
        const cx = (x0 + x1) / 2;
        const box = textBox(cx, headerY, text, HEADER_MM);
        headers.push({
          group: run.group,
          text,
          cx,
          cy: headerY,
          box,
          plate: {
            x0: box.x0 - HEADER_PAD_MM,
            x1: box.x1 + HEADER_PAD_MM,
            y0: box.y0 - HEADER_PAD_MM,
            y1: box.y1 + HEADER_PAD_MM,
          },
        });
        run = undefined;
      };
      for (const terminal of row) {
        const group = groupOfRole(terminal.role);
        // ソケットの役割でない端子（機種を替えたときなど）は帯も見出しも作らない
        if (group === undefined) {
          flush();
          continue;
        }
        const x = terminal.pos.x - originX;
        if (run === undefined || run.group !== group) {
          flush();
          run = { group, x0: x - SOCKET_COL_PITCH_MM / 2, x1: x + SOCKET_COL_PITCH_MM / 2 };
        } else {
          run.x1 = x + SOCKET_COL_PITCH_MM / 2;
        }
      }
      flush();
    });

  return { headers, bands };
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

/**
 * 9mm ピッチに収まらない端子名（CP1E の出力 `100.00`〜`101.03`、`COM0`、JW300 の `COM.A` など）に
 * 使う縮めた印字の高さ[mm]。
 *
 * 机上のPLC本体は端子を千鳥2列（`PLC_TERMINAL_PITCH_MM` = 9mm ピッチ）に並べるため、同じ段の
 * 隣どうしは 9mm しか離れていない。`BLOCK_MARK_MM`（3mm）のまま6文字を描くと概算の印字幅が
 * 11mm を超え、隣の名前と重なって読めなかった（今日のスクリーンショット確認 03:
 * `COM0100.01COM1100.04…` が続けて潰れていた）。9mm ピッチに収まる名前（`0.00` / `PB1c` など）は
 * 今までどおり `BLOCK_MARK_MM` のままでよい（どちらを使うかは `blockMarkFontMm()` が幅で決める）。
 */
export const BLOCK_MARK_LONG_MM = 2;

/** 隣の端子の印字とのあいだに必ず空ける隙間[mm]。 */
export const BLOCK_MARK_GAP_MM = 1;

/**
 * 端子名1個に許される最大の印字幅[mm]（端子ピッチ − 隣との隙間）。
 * 盤の端子台（`BLOCK_PITCH_MM`）も机上のPLC（`PLC_TERMINAL_PITCH_MM`）もいまは 9mm だが、
 * 片方だけ変わっても狭い側に合うよう小さい方を取る。
 */
const BLOCK_MARK_MAX_WIDTH_MM = Math.min(BLOCK_PITCH_MM, PLC_TERMINAL_PITCH_MM) - BLOCK_MARK_GAP_MM;

/**
 * 端子1個の印字に使う文字高さ[mm]。**名前の幅**で `BLOCK_MARK_MM` / `BLOCK_MARK_LONG_MM` を選ぶ。
 *
 * 以前は「5文字以上なら縮める」と**文字数**で決めていた。文字数は幅の代わりにならない:
 * `COM0` は4文字だが `C` `O` `M` が太字の大文字でいちばん広い部類なので 3mm では 9.2mm あり、
 * 9mm ピッチの隣の名前と 0.2mm 食い合っていた（CP1E の `COM0` と `100.01`）。
 * 同じ4文字でも `0.00` は 7.1mm で収まる。`labelWidthMm()` が実測の字幅を持つようになったので、
 * ここも実際の幅で決める。利用者指摘 2026-09-20「COMの文字重なって見えない」と同じ種類の取りこぼし。
 */
export function blockMarkFontMm(mark: string): number {
  return labelWidthMm(mark, BLOCK_MARK_MM) > BLOCK_MARK_MAX_WIDTH_MM
    ? BLOCK_MARK_LONG_MM
    : BLOCK_MARK_MM;
}

/**
 * 端子の中心から名前の中心までの奥行方向のずれ[mm]（正＝盤の手前側）。
 * `blockFaceTexture()` が実際に描く位置と一致させる（名前の文字高さでは動かさない）。
 */
export const BLOCK_MARK_OFFSET_MM = BLOCK_MARK_MM * 1.5;

/**
 * 極性の印（`P(+)` / `N(−)`）の文字高さ[mm]。利用者指摘 2026-09-20「ランプも同様」。
 * 名前（`PL1+`、3mm）より一段小さくして、9mmピッチの隣の端子の印と当たらない幅にする
 * （`P(+)` ≒ 5.0mm・`N(−)` ≒ 5.7mm で、隣とのあいだに 3.3mm 以上残る）。
 */
export const BLOCK_POLARITY_MM = BLOCK_MARK_LONG_MM;

/**
 * 端子の中心から極性の印の中心までの奥行方向のずれ[mm]（負＝盤の奥側）。
 * 名前は手前側（`BLOCK_MARK_OFFSET_MM`）に出ているので、印は**反対側**へ置いて行を分ける。
 * こうすると `PL1+` と `P(+)` が横に並ばず、9mmピッチでも両方が読める。
 */
export const BLOCK_POLARITY_OFFSET_MM = -BLOCK_MARK_OFFSET_MM;

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

/**
 * 印字の色表を「背板（台座）の明るさ」で選ぶ仕組み。B1
 *
 * 盤の端子台（`#F1EFE9` の明るい台座）は濃い字が読みやすく、ソケット本体やPLCの端子台（黒）は
 * 濃い字だと**黒地に黒**で消える。2つの表は同じ役割の並びなので、呼び出し側は背板の色を
 * 渡すだけでよい。
 */

/** これより暗い背板は明るい字にする（相対輝度）。 */
export const PLATE_DARK_LUMINANCE = 0.4;

/** 16進色（`#RRGGBB`）の相対輝度（0＝黒〜1＝白）。sRGBのガンマまでは見ない概算。 */
export function plateLuminance(hex: string): number {
  const value = hex.replace('#', '');
  if (value.length !== 6) return 1;
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 1;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 背板の色に合う印字の色表を返す。B1
 * 暗い背板（PLCの端子台・ソケット本体）には明るい字、明るい背板（盤の端子台）には濃い字。
 */
export function roleColorsFor(plateColor: string): Readonly<Record<TerminalRole, string>> {
  return plateLuminance(plateColor) < PLATE_DARK_LUMINANCE ? SOCKET_ROLE_COLOR : ROLE_COLOR;
}

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
  /*
   * ミップを**使う**（3D-08）。`CanvasTexture` は `generateMipmaps` が既定 true なので
   * ミップは作られているのに、`minFilter = LinearFilter` だと1枚も参照されない
   * （容量 +33% を払ったまま、縮小したときに文字がちらつく）。`view-gizmo-textures.ts` が
   * 先に同じ理由で `LinearMipmapLinearFilter` にしてある。拡大側は `magFilter` の
   * `LinearFilter` のままでよい（ミップは縮小にしか効かない）。
   */
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 焼いたテクスチャの共有キャッシュ。設計仕様 §15 / Plan 5 決定表#15。
 *
 * 盤の8ソケットは**相対的な端子配置も印字も完全に同一**なので、焼く絵も同一である。
 * 以前は `Socket` ごとに `useMemo` していたため、1枚 1440×1280px（約7.4MB）のキャンバスが
 * 8枚あった。鍵を「板の左上からの相対位置＋印字＋役割＋板の寸法」にすると8枚が1枚になる。
 *
 * テクスチャは**アプリの寿命のあいだ生き続ける**（盤の形は課題で変わらない）。
 * 破棄の責任を持たないのはそのためで、`clearFaceTextureCache()` はテストからのみ呼ぶ。
 */
const faceTextureCache = new Map<string, Texture>();

/**
 * `faceTextureCache` が今持っているテクスチャの集合（I2: Plan 5 C/D レビュー）。
 * `PlcUnit.tsx` / `PlcRack.tsx` はアンマウント時に「機種を替えたので古いテクスチャを
 * 解放する」つもりで `faceTexture?.dispose()` を呼んでいたが、Task 13 でキャッシュが
 * テクスチャを使い回すようになった後もそのままだったため、**共有している他のメッシュの
 * ぶんまで**破棄済みテクスチャにしてしまっていた（three は再アップロードするので絵は出るが、
 * 機種切替のたびに全消費先で GPU 転送をやり直す）。`isSharedFaceTexture()` で「破棄の責任が
 * こちら（キャッシュ）にあるか」を消費側が確認できるようにする。
 */
const cachedTextures = new WeakSet<Texture>();

/** `texture` が共有キャッシュの持ち物か（＝消費側は `dispose()` してはいけないか）。I2 */
export function isSharedFaceTexture(texture: Texture | undefined): boolean {
  return texture !== undefined && cachedTextures.has(texture);
}

/** キャッシュの件数（テスト用）。 */
export function faceTextureCacheSize(): number {
  return faceTextureCache.size;
}

/** キャッシュを空にする（テスト用。テクスチャも破棄する）。 */
export function clearFaceTextureCache(): void {
  for (const texture of faceTextureCache.values()) texture.dispose();
  faceTextureCache.clear();
}

/**
 * 端子群の「相対位置＋印字＋役割」からキャッシュの鍵を作る。
 * **export する**のは、焼いた絵そのものを比べられない環境（`happy-dom` には2Dキャンバスが無い）
 * でも「8枚が1枚に共有されること」を鍵の一致として検査できるようにするため。
 *
 * `colors`（省略可）は `blockFaceTexture()` が受け取る印字の色表（`ROLE_COLOR` か
 * `roleColorsFor(plateColor)` の結果）をそのまま渡す。`role` だけでは**色表そのものの違い**は
 * 分からない（例: 別メーカーのPLC端子台が同じ相対配置・同じ印字になったとき、片方が
 * `roleColorsFor()` で明色、もう片方が暗色を選んでいても role 文字列は同じになりうる）ので、
 * 省いた形にすると片方の印字が古い色のまま焼き直されずに使い回されてしまう
 * （このタスクの完了条件: 「PLC/ラックの銘板が古い印字を出さない」）。ソケットは色表が固定
 * （`SOCKET_ROLE_COLOR`）なので `colors` を渡さなくてよい。
 *
 * `blockTerminalMark(t)` は **`prefix === 'block'` のときだけ**鍵に混ぜる。
 * `blockTerminalMark()` は物理端子ID（`S1.13` など**ソケットIDを含む絶対ID**）から作るため、
 * 無条件に混ぜるとソケット8個の鍵が「板の左上からの相対位置」で揃っていても全部バラバラになり、
 * 決定表#15 の「8ソケットは鍵が一致する」が壊れる。ソケットの印字は `terminalNumber(t)` と
 * `t.role`（→ `roleLabel()`）だけで決まり、どちらも既に鍵に入っているので `blockTerminalMark(t)`
 * が無くても取り違えは起きない。
 */
export function faceKey(
  prefix: string,
  terminals: readonly BoardTerminal[],
  originX: number,
  originY: number,
  widthMm: number,
  heightMm: number,
  colors?: Readonly<Record<TerminalRole, string>>,
): string {
  const parts = terminals.map((t) => {
    const mark = prefix === 'block' ? blockTerminalMark(t) : '';
    const ink = colors === undefined ? '' : colors[t.role];
    return `${(t.pos.x - originX).toFixed(2)},${(t.pos.y - originY).toFixed(2)},${terminalNumber(t)},${t.role},${mark},${ink}`;
  });
  return `${prefix}:${widthMm.toFixed(2)}x${heightMm.toFixed(2)}|${parts.join('|')}`;
}

/**
 * キャッシュ越しに焼く。**焼く関数を受け取る**ので、テストは本物のキャンバスが無くても
 * 「鍵ごとに1回しか焼かない」を確かめられる。焼けなかった（`undefined`）ときは**覚えない**ので、
 * キャンバスが後から使える環境になれば次の呼び出しで焼き直す。
 */
export function cachedFaceTexture(
  key: string,
  bake: () => Texture | undefined,
): Texture | undefined {
  const found = faceTextureCache.get(key);
  if (found !== undefined) return found;
  const made = bake();
  if (made !== undefined) {
    faceTextureCache.set(key, made);
    cachedTextures.add(made);
  }
  return made;
}

/**
 * 焼いたテクスチャの引き出しの名前空間。3D-13
 *
 * 以前は印字テクスチャのキャッシュが**4方針**あった（このファイル ／ `AcFixtures`（名前まで
 * 衝突）／ `PartIndicator` ／ `Fixtures` はキャッシュ無し）。実装をこのファイルの1つに
 * 畳んだうえで、鍵の先頭に必ず名前空間を置いて取り違えを型で防ぐ。
 * `socket` / `block` は `faceKey()` が同じ接頭辞を付ける。
 */
export type FaceTextureNamespace = 'socket' | 'block' | 'fixture' | 'part';

/**
 * 名前空間つきの鍵で共有キャッシュに焼く（**このファイルの外から使う唯一の入口**）。3D-13
 * 焼けなかった（`undefined`）ときは覚えないので、2Dキャンバスが後から使える環境になれば
 * 次の呼び出しで焼き直す。
 */
export function bakeSharedTexture(
  namespace: FaceTextureNamespace,
  key: string,
  bake: () => Texture | undefined,
): Texture | undefined {
  return cachedFaceTexture(`${namespace}:${key}`, bake);
}

/**
 * ソケット1個ぶんの印字を1枚のキャンバスに描く。§6.2 / §8.2
 *
 * 焼く順（下から）:
 * 1. 役割の色帯（`socketFaceRows()`）
 * 2. 段見出し（`b接点` / `a接点` / `COM` / `コイル`）
 * 3. ネジ端子の番号（`⑨`）と、ネジの手元で確かめる小さな役割文字（`COM` / `+` / `−`）
 *
 * **`socketFaceTexture()` から切り出して export する**のは、2Dキャンバスの無い環境
 * （`happy-dom`）でも偽のキャンバスを渡して「何を・どの色で・どこへ描くか」を単体テストで
 * 縛れるようにするため。呼ぶ側は `textAlign = 'center'` / `textBaseline = 'middle'` を
 * 済ませておく（`makeCanvasTexture()` がやる）。
 */
export function drawSocketFace(
  ctx: CanvasRenderingContext2D,
  terminals: readonly BoardTerminal[],
  originX: number,
  originY: number,
): void {
  const { headers, bands } = socketFaceRows(terminals, originX, originY);

  for (const band of bands) {
    ctx.fillStyle = band.color;
    ctx.fillRect(
      band.x0 * PX_PER_MM,
      band.y0 * PX_PER_MM,
      (band.x1 - band.x0) * PX_PER_MM,
      (band.y1 - band.y0) * PX_PER_MM,
    );
  }

  // 見出しの下地（本体の黒）。明るい台座にはみ出す段でも同じ見え方にする
  for (const header of headers) {
    ctx.fillStyle = SOCKET_BODY_COLOR;
    ctx.fillRect(
      header.plate.x0 * PX_PER_MM,
      header.plate.y0 * PX_PER_MM,
      (header.plate.x1 - header.plate.x0) * PX_PER_MM,
      (header.plate.y1 - header.plate.y0) * PX_PER_MM,
    );
  }

  ctx.font = labelFont(HEADER_MM);
  for (const header of headers) {
    ctx.fillStyle = PIN_GROUP_COLOR[header.group];
    // 開発時だけ、幅表の見積りが実環境の字幅と合っているかを確かめる（3D-14）
    assertLabelWidth(ctx, header.text, HEADER_MM);
    ctx.fillText(header.text, header.cx * PX_PER_MM, header.cy * PX_PER_MM);
  }

  for (const terminal of terminals) {
    // 位置は `socketLabelBoxes()` が持つ（テストが検査するのと同じ値で描く）
    const boxes = socketLabelBoxes(terminal, originX, originY);
    const x = (terminal.pos.x - originX) * PX_PER_MM;
    ctx.fillStyle = '#F2F2EE';
    ctx.font = labelFont(NUMBER_MM);
    ctx.fillText(
      terminalNumber(terminal),
      x,
      ((boxes.number.y0 + boxes.number.y1) / 2) * PX_PER_MM,
    );
    /*
     * 役割文字は段見出しと**同じ色**にする（段見出し＝離れて見たときの案内、
     * 役割文字＝ネジを締める手元での確認。同じ意味には同じ色、が利用者の求める「統一」）。
     * ソケットの役割でない端子（機種を替えたときなど）だけ従来の色表に落ちる。
     */
    const group = groupOfRole(terminal.role);
    ctx.fillStyle = group === undefined ? SOCKET_ROLE_COLOR[terminal.role] : PIN_GROUP_COLOR[group];
    ctx.font = labelFont(ROLE_MM);
    assertLabelWidth(ctx, socketRoleMark(terminal), ROLE_MM);
    ctx.fillText(socketRoleMark(terminal), x, ((boxes.role.y0 + boxes.role.y1) / 2) * PX_PER_MM);
  }
}

/**
 * ソケット1個ぶんの印字テクスチャ。
 * 盤の mm 座標 `(originX, originY)` を板の左上に対応させるので、
 * 端子が段付きに並んでいても印字は端子の真上に来る。
 *
 * 8ソケットは相対配置も印字も同一なので、`faceKey()` が一致し `cachedFaceTexture()` が
 * 1枚だけ焼いて残り7枚に使い回す（決定表#15）。
 */
export function socketFaceTexture(
  terminals: readonly BoardTerminal[],
  originX: number,
  originY: number,
  plateWidthMm: number,
  plateHeightMm: number,
): Texture | undefined {
  if (terminals.length === 0) return undefined;
  const key = faceKey('socket', terminals, originX, originY, plateWidthMm, plateHeightMm);
  return cachedFaceTexture(key, () =>
    makeCanvasTexture(plateWidthMm, plateHeightMm, (ctx) => {
      drawSocketFace(ctx, terminals, originX, originY);
    }),
  );
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

/**
 * 端子台の名前に添える極性の印（`P(+)` / `N(−)`）。極性を示さない端子は undefined。
 * 利用者指摘 2026-09-20「リレーソケットの13、14番…どちらがPかNか分からない。ランプも同様」。
 *
 * 付けるのは「名前が `+` / `−` としか言っていない端子」だけにする:
 * - **付ける**: ランプ用端子台（`TB_PL.1+`→`PL1+`）・ブザー（`BZ.+`）・ランプ本体（`PL1.+`）
 * - **付けない**: DC24V供給端子（`P1` / `N1`）と電源の内部端子（`PS +24V` / `PS 0V`）。
 *   名前そのものが母線を名乗っているので、`P1` の下にもう一度 `P(+)` と書いても増えるのは
 *   密度だけである（供給端子台は 8本×2 あるので印だけで16個になる）。
 * - **付けない**: 机上のPLC本体・増設ラック（`PLC.*`）と壁コンセント（`OUTLET.*`）。
 *   PLCの端子は千鳥2列で段の隙間が 9mm しかなく、反対側の行に印を置くと隣の段の名前と当たる。
 *   コンセントの `L` / `N` は**交流**で、直流母線の `P(+)` / `N(−)` とは別物である。
 */
export function blockPolarityMark(terminal: BoardTerminal): string | undefined {
  const side = busSideOfRole(terminal.role);
  if (side === undefined) return undefined;
  const { part } = parseTerminalId(terminal.id);
  if (part === PLC_PART_ID || part === OUTLET_ID) return undefined;
  if (part === P_RAIL_ID || part === N_RAIL_ID || part === POWER_SUPPLY_ID) return undefined;
  return busSideMark(side);
}

/** 盤定義のラベルから丸数字だけを取り出す（`S1 ⑨ com` → `⑨`）。 */
export function terminalNumber(terminal: BoardTerminal): string {
  return terminal.label.split(' ').at(-2) ?? terminal.label;
}

/**
 * 端子台1個ぶんの印字。端子の外接矩形＋余白を板とし、各端子の真下に名前を描く。
 *
 * `faceKey()` に `colors` も渡す（役割文字列だけでは色表そのものの違いを拾えないため。
 * `faceKey()` の doc comment を参照）。
 */
export function blockFaceTexture(
  terminals: readonly BoardTerminal[],
  padMm: number,
  /** 印字の色表（既定は明るい台座用の濃い字。暗い台座には `roleColorsFor()` を渡す。B1）。 */
  colors: Readonly<Record<TerminalRole, string>> = ROLE_COLOR,
): Texture | undefined {
  // 端子が1〜2点しかない端子台でもテクスチャが潰れないよう、外接矩形と最小サイズは
  // `faceRect()` が持つ（`PlcUnit.tsx` の `plcFaceRect()` と共通。レビュー MERGE #15）
  const rect = faceRect(terminals, padMm);
  if (rect === undefined) return undefined;
  const offsetX = (rect.w - (rect.maxX - rect.minX)) / 2;
  const offsetY = (rect.h - (rect.maxY - rect.minY)) / 2;
  const key = faceKey('block', terminals, rect.minX, rect.minY, rect.w, rect.h, colors);
  return cachedFaceTexture(key, () =>
    makeCanvasTexture(rect.w, rect.h, (ctx) => {
      for (const terminal of terminals) {
        const mark = blockTerminalMark(terminal);
        // 名前が長いときは `blockMarkFontMm()` で縮める（項目1: 9mmピッチの隣と重ならない幅にする）
        const fontMm = blockMarkFontMm(mark);
        const x = (terminal.pos.x - rect.minX + offsetX) * PX_PER_MM;
        const y = (terminal.pos.y - rect.minY + offsetY) * PX_PER_MM;
        ctx.font = labelFont(fontMm);
        ctx.fillStyle = colors[terminal.role];
        ctx.fillText(mark, x, y + BLOCK_MARK_OFFSET_MM * PX_PER_MM);
        // どちらの母線から来る端子かの印（`P(+)` / `N(−)`）。名前とは反対側の行に置く
        const polarity = blockPolarityMark(terminal);
        if (polarity !== undefined) {
          ctx.font = labelFont(BLOCK_POLARITY_MM);
          ctx.fillText(polarity, x, y + BLOCK_POLARITY_OFFSET_MM * PX_PER_MM);
        }
      }
    }),
  );
}

/**
 * 端子台1個ぶんの印字のうち、端子1個の外接矩形（盤モデル mm・平行移動不変）。
 * `blockFaceTexture()` が実際に描く位置・文字高さと同じ式を使う。板の原点（`rect.minX/minY`）は
 * 全端子に共通のオフセットなので、**同じ機種内での重なり**を調べる分にはここへ含めなくてよい
 * （単体テストが機種ごとに数値で「隣と重ならない」ことを確かめるために公開する。項目1）。
 */
export function blockLabelBox(terminal: BoardTerminal): LabelBox {
  const mark = blockTerminalMark(terminal);
  const fontMm = blockMarkFontMm(mark);
  return textBox(terminal.pos.x, terminal.pos.y + BLOCK_MARK_OFFSET_MM, mark, fontMm);
}

/**
 * 極性の印1個の外接矩形（盤モデル mm・平行移動不変）。印を出さない端子は undefined。
 * `blockFaceTexture()` が実際に描く位置・文字高さと同じ式を使う（`blockLabelBox()` と同じ考え方）。
 */
export function blockPolarityBox(terminal: BoardTerminal): LabelBox | undefined {
  const mark = blockPolarityMark(terminal);
  if (mark === undefined) return undefined;
  return textBox(
    terminal.pos.x,
    terminal.pos.y + BLOCK_POLARITY_OFFSET_MM,
    mark,
    BLOCK_POLARITY_MM,
  );
}
