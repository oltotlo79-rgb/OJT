import type { WireColor } from '@ojt/circuit-sim';

/**
 * 3D表示の色。設計仕様 §6.6（電線の物理色）／§5.3.3・§5.3.4（PB・PLの色）。
 * 回路図（`@ojt/schematic-core` の `LAMP_FILL`）と同じ値を使い、2Dと3Dで色がずれないようにする。
 */

/** 電線の物理色（青／白／黄）。§6.6 */
export const WIRE_COLORS: Readonly<Record<WireColor, string>> = {
  青: '#1F4FD8',
  白: '#F2F2F0',
  黄: '#E8C22A',
};

/** Y型圧着端子の金属色。§6.6 */
export const LUG_COLOR = '#B9A46A';

/** 表示灯の色（`schematic-core` の `LAMP_FILL` と同値）。§5.3.4 */
export const LAMP_COLORS: Readonly<Record<string, string>> = {
  PL1: '#FFFFFF',
  PL2: '#F2C230',
  PL3: '#3FA34D',
  PL4: '#D64545',
};

/** 押ボタンの色。§5.3.3 */
export const PUSH_BUTTON_COLORS: Readonly<Record<string, string>> = {
  PB1: '#1A1A1A',
  PB2: '#F2C230',
  PB3: '#3FA34D',
  PB4: '#D64545',
};

/**
 * 盤・部品の基本色（実物写真に合わせる）。
 * 筐体は白〜ベージュ、ソケットは黒本体＋黄色レバー、端子台は白、DINレールは銀。
 */
export const BOARD_PLATE_COLOR = '#E6E4DE';
export const CONSOLE_SIDE_COLOR = '#D6D3CB';
export const DIN_RAIL_COLOR = '#B8BCC2';
export const SOCKET_BODY_COLOR = '#23262B';
export const SOCKET_LEVER_COLOR = '#E8B21E';
export const TERMINAL_SCREW_COLOR = '#9AA0A6';
export const TERMINAL_BLOCK_COLOR = '#F1EFE9';
export const TERMINAL_BLOCK_CAP_COLOR = '#2B2E33';
export const RELAY_BODY_COLOR = '#3A3F45';
export const TIMER_BODY_COLOR = '#4A4038';
/** 上部左のDC24V端子台と、上部右のブレーカの色。 */
export const SUPPLY_BLOCK_COLOR = '#2B2E33';
export const BREAKER_COLOR = '#DCDCD6';

/** 端子のハイライト色（ホバー／配線1本目の選択中）。§8.2 */
export const TERMINAL_HOVER_COLOR = '#39D0FF';
export const TERMINAL_PENDING_COLOR = '#FF9F1C';
/** 選択中の電線の色。§8.2 */
export const WIRE_SELECTED_COLOR = '#FF4D6D';
/**
 * 配線帯のスロットが埋まり、他の電線と同じ位置に載った電線の色（琥珀）。§6.6
 * `WireRoute.laneOverflow` は「見た目が重なっている」ことの**唯一の手がかり**なので、
 * 3Dで色を変えて知らせる（電気的には正しく配線できているので、失敗としては扱わない）。
 */
export const WIRE_LANE_OVERFLOW_COLOR = '#E8A33D';
/** 既設配線（`locked`）の端に付ける固定リングの色。訓練者が触れない配線の目印。§6.3 */
export const LOCKED_RING_COLOR = '#8A9099';
/** 盤面の穴（既設配線が裏へ潜る所）の色。§6.5 */
export const PANEL_HOLE_COLOR = '#14171B';

/** テスターのプローブの色（黒／赤）。§9.3 */
export const PROBE_COLORS: Readonly<Record<'black' | 'red', string>> = {
  black: '#15181C',
  red: '#D6262B',
};

/** 回路図と連動して光らせる端子の色（§9.2 の連動ハイライト）。 */
export const HIGHLIGHT_COLOR = '#FFE066';

/** ランプの発光強度（点灯／暗点灯／消灯）。§5.3.4 */
export const LAMP_EMISSIVE: Readonly<Record<string, number>> = {
  lit: 1.6,
  dim: 0.35,
  off: 0,
};
