import type { BoardTerminal } from '@ojt/board-model';
import { RingGeometry } from 'three';
import {
  TERMINAL_HOVER_COLOR,
  TERMINAL_PENDING_COLOR,
  TERMINAL_SCREW_COLOR,
} from '../session/colors.js';

/**
 * TerminalField が使う端子の外観とラベル。設計仕様 §6.5 / §8.2。
 * 当たり判定の半径は盤定義の `pickRadiusMm`（4mm）をそのまま使う。
 * ホバー中は `CR1 ⑨ COM` 形式のツールチップを `Html` で出す（§8.2）。
 */

/**
 * ホバー中の発光強度。ネジ本体は半径1.8mmしかなく、色替えだけでは `plc` プリセット
 * （機種によっては1m以上離れる。§12.2）まで引くとほとんど気づけなかった
 * （今日のスクリーンショット確認 08）。発光を足して遠目でも分かるようにする（項目3）。
 */
export const TERMINAL_HOVER_EMISSIVE_INTENSITY = 1.1;

/**
 * ホバー時にネジの周りへ足す光る輪の内外半径[mm]。
 * ネジ（半径1.8mm）より一回り大きく、当たり判定の半径（盤定義の既定4mm）を超えない大きさにして、
 * 「いま指している端子」がひと目で分かるようにする（項目3）。
 */
export const HOVER_RING_INNER_MM = 2.4;
export const HOVER_RING_OUTER_MM = 4.2;
/** 端子は盤に何百個もあるので、輪のジオメトリも1個を使い回す（§15）。 */
export const HOVER_RING_GEOMETRY = new RingGeometry(HOVER_RING_INNER_MM, HOVER_RING_OUTER_MM, 24);
/** ツールチップのラベル文字列を作る（役割名は盤定義の `label` をそのまま使う）。§8.2 */
export function terminalTooltip(terminal: BoardTerminal, roleLabel: string): string {
  return roleLabel.length > 0 ? roleLabel : terminal.label;
}

/**
 * ホバー中のネジの見た目（色＋発光）。JSXから切り出した純関数にして、単体テストが
 * 「ホバーで光る」ことを数値で確かめられるようにする（項目3）。
 */
export function terminalScrewAppearance(
  hovered: boolean,
  pending: boolean,
): { color: string; emissive: string | undefined; emissiveIntensity: number } {
  const color = pending
    ? TERMINAL_PENDING_COLOR
    : hovered
      ? TERMINAL_HOVER_COLOR
      : TERMINAL_SCREW_COLOR;
  return {
    color,
    emissive: hovered ? TERMINAL_HOVER_COLOR : undefined,
    emissiveIntensity: hovered ? TERMINAL_HOVER_EMISSIVE_INTENSITY : 0,
  };
}
