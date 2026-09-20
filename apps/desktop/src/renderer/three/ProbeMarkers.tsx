import { boardTerminalPos, toPhysicalTerminal } from '@ojt/board-model';
import type { BoardDefinition, SocketRoles } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { HIGHLIGHT_COLOR, PROBE_COLORS } from '../session/colors.js';
import { toScene } from './coords.js';
import { sharedMaterial } from './materials.js';

/**
 * テスターのプローブと、回路図連動ハイライトの端子。設計仕様 §9.3 / §9.2。
 *
 * プローブは**測るだけ**で盤を変えないので、レイキャストを受けない（`raycast` を潰す）。
 * 受けてしまうと、置いたプローブが下の端子のクリックを奪い、付け替えができなくなる。
 *
 * ストアのプローブは**役割ID**（`CHK.13`）で持つ。3D盤は**物理端子**（`S7.13`）で描かれて
 * いるので、`toPhysicalTerminal()` で直してから座標を引く（§6.4）。壊れた作業ファイルなどで
 * 盤に無い端子が入っていても、例外を投げずに黙って落とす（§13 #8）。
 *
 * 座標は**描いている盤**（`board`）から引く。既定の盤に決め打ちすると、モードDの盤
 * （`withPlcUnit()` で机上のPLC・壁コンセントの端子が足してある）で `PLC.X0` や `OUTLET.L`
 * のハイライトが「盤に無い端子」として黙って消える（レビュー指摘 3D-07）。
 */

/** プローブが浮く高さ[mm]（端子の当たり判定球より手前に出す）。 */
const PROBE_LIFT_MM = 7;
/** プローブの円錐の半径・高さ[mm]。 */
const PROBE_RADIUS_MM = 1.8;
const PROBE_HEIGHT_MM = 9;
/** ハイライトの球の半径[mm]。 */
const HIGHLIGHT_RADIUS_MM = 3.6;

/** 描くプローブ1本。 */
export interface ProbePlacement {
  side: 'black' | 'red';
  pos: [number, number, number];
}

/** 端子（役割ID）の3D座標を引く。盤に無ければ undefined。 */
function scenePosOf(
  board: BoardDefinition,
  roles: SocketRoles,
  terminal: TerminalId,
): [number, number, number] | undefined {
  try {
    const physical = toPhysicalTerminal(roles, terminal);
    return toScene(boardTerminalPos(board, physical));
  } catch {
    // 盤に無い端子・形の壊れたIDは描かない（3Dシーンを落とさない）
    return undefined;
  }
}

/** プローブの置き場所を3D座標で返す（純粋関数。テストで固定する）。 */
export function probePositions(
  probes: { black: TerminalId | undefined; red: TerminalId | undefined },
  roles: SocketRoles,
  board: BoardDefinition,
): ProbePlacement[] {
  const out: ProbePlacement[] = [];
  for (const side of ['black', 'red'] as const) {
    const terminal = probes[side];
    if (terminal === undefined) continue;
    const pos = scenePosOf(board, roles, terminal);
    if (pos === undefined) continue;
    out.push({ side, pos });
  }
  return out;
}

/** ハイライトする端子の3D座標（純粋関数）。 */
export function highlightPositions(
  terminals: readonly string[],
  roles: SocketRoles,
  board: BoardDefinition,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const terminal of terminals) {
    const pos = scenePosOf(board, roles, terminal as TerminalId);
    if (pos !== undefined) out.push(pos);
  }
  return out;
}

/** レイキャストを受けない（下の端子のクリックを奪わない）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** プローブとハイライト端子。 */
export function ProbeMarkers({
  probes,
  highlightTerminals,
  roles,
  board,
}: {
  probes: { black: TerminalId | undefined; red: TerminalId | undefined };
  highlightTerminals: readonly string[];
  roles: SocketRoles;
  /** いま描いている盤（モードDでは机上のPLC・壁コンセントの端子を持つ派生盤）。 */
  board: BoardDefinition;
}): JSX.Element {
  const placements = probePositions(probes, roles, board);
  const highlights = highlightPositions(highlightTerminals, roles, board);
  return (
    <group name="probe-markers">
      {placements.map((placement) => (
        <mesh
          key={placement.side}
          name={`probe-${placement.side}`}
          raycast={noPick}
          position={[
            placement.pos[0],
            placement.pos[1],
            placement.pos[2] + PROBE_LIFT_MM + PROBE_HEIGHT_MM / 2,
          ]}
          rotation={[Math.PI / 2, 0, 0]}
          material={sharedMaterial(PROBE_COLORS[placement.side], {
            metalness: 0.2,
            roughness: 0.5,
          })}
        >
          <coneGeometry args={[PROBE_RADIUS_MM, PROBE_HEIGHT_MM, 10]} />
        </mesh>
      ))}
      {highlights.map((pos, index) => (
        <mesh
          key={`hl-${String(index)}`}
          name="highlight-terminal"
          raycast={noPick}
          position={[pos[0], pos[1], pos[2] + 2]}
          material={sharedMaterial(HIGHLIGHT_COLOR, {
            metalness: 0.1,
            roughness: 0.9,
            opacity: 0.55,
            transparent: true,
          })}
        >
          <sphereGeometry args={[HIGHLIGHT_RADIUS_MM, 12, 10]} />
        </mesh>
      ))}
    </group>
  );
}
