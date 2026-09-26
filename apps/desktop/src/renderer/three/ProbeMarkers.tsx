import { boardTerminalPos, findBoardTerminal, toPhysicalTerminal } from '@ojt/board-model';
import type { BoardDefinition, SocketRoles } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { HIGHLIGHT_COLOR, PROBE_COLORS, PROBE_RING_COLORS } from '../session/colors.js';
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

/*
 * テスター棒の寸法[mm]（2026-09-26 利用者報告「テスターを当てている個所が3D図で分かりにくい」）。
 * 以前は端子の上に小さな円錐を浮かべるだけで、黒は盤の色に埋もれて見えなかった。実物の
 * テスター棒と同じく、金属の先端・つば・色の付いた握りを斜めに当て、端子の周りに光る輪を置き、
 * 握りの先に「赤 CR1 ⑭ +」のような名札を出す。
 */
/** 先端（金属）の長さ・半径。 */
const TIP_LENGTH_MM = 7;
const TIP_RADIUS_MM = 0.5;
/** つば（指を止める円板）の半径・厚み。 */
const GUARD_RADIUS_MM = 3.2;
const GUARD_THICKNESS_MM = 1.2;
/** 握りの長さ・半径。 */
const GRIP_LENGTH_MM = 24;
const GRIP_RADIUS_MM = 2.3;
/** 盤面の法線から傾ける角度[rad]（黒は左、赤は右へ倒すので、隣の端子に当てても重ならない）。 */
const PROBE_TILT_RAD = (28 * Math.PI) / 180;
/** 端子を囲む輪の半径・太さ（どの端子に当てているかを遠くからでも分かるようにする）。 */
const RING_RADIUS_MM = 4.2;
const RING_TUBE_MM = 0.7;
/** ハイライトの球の半径[mm]。 */
const HIGHLIGHT_RADIUS_MM = 3.6;

/** 描くプローブ1本。 */
export interface ProbePlacement {
  side: 'black' | 'red';
  /** 当てている端子の3D座標（ネジの中心）。 */
  pos: [number, number, number];
  /** 名札の文言（「赤 CR1 ⑭ +」など）。 */
  label: string;
}

/** ソケットの物理端子（`S1.14` など）。 */
const SOCKET_TERMINAL_RE = /^S\d+\./u;

/**
 * 名札に出す端子の名前（役割ID → 盤の印字）。ソケットの端子は役割名を前に付け（`CR1 ⑭ +`）、
 * PLC本体・壁コンセントも何の端子か分かるように前置きする。盤に無い端子は役割IDのまま出す。
 */
export function probeTerminalName(
  board: BoardDefinition,
  roles: SocketRoles,
  terminal: TerminalId,
): string {
  try {
    const physical = toPhysicalTerminal(roles, terminal);
    const found = findBoardTerminal(board, physical);
    if (found === undefined) return String(terminal);
    const role = String(terminal).split('.')[0] ?? '';
    if (SOCKET_TERMINAL_RE.test(String(physical))) return `${role} ${found.label}`;
    if (String(physical).startsWith('PLC.')) return `PLC ${found.label}`;
    if (String(physical).startsWith('OUTLET.')) return `${JA.tester.outletPrefix} ${found.label}`;
    return found.label;
  } catch {
    return String(terminal);
  }
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
    const name = probeTerminalName(board, roles, terminal);
    out.push({
      side,
      pos,
      label: `${side === 'black' ? JA.tester.probeTagBlack : JA.tester.probeTagRed} ${name}`,
    });
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
        <ProbePen key={placement.side} placement={placement} />
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

/**
 * テスター棒1本（先端・つば・握り・端子の輪・名札）。端子のネジの中心から盤面の法線方向へ立て、
 * 黒は左、赤は右へ傾ける。レイキャストは受けない（下の端子のクリックを奪わない）。
 */
export function ProbePen({ placement }: { placement: ProbePlacement }): JSX.Element {
  const [x, y, z] = placement.pos;
  const tilt = placement.side === 'black' ? -PROBE_TILT_RAD : PROBE_TILT_RAD;
  const color = PROBE_COLORS[placement.side];
  const ring = PROBE_RING_COLORS[placement.side];
  const gripEnd = TIP_LENGTH_MM + GUARD_THICKNESS_MM + GRIP_LENGTH_MM;
  const glow = sharedMaterial(ring, {
    metalness: 0,
    roughness: 0.4,
    emissive: ring,
    emissiveIntensity: 0.6,
  });
  return (
    <group name={`probe-${placement.side}`} position={[x, y, z]}>
      {/* 当てている端子を囲む輪（盤面と平行。棒の傾きとは別に置く） */}
      <mesh
        name={`probe-ring-${placement.side}`}
        raycast={noPick}
        position={[0, 0, 0.6]}
        material={glow}
      >
        <torusGeometry args={[RING_RADIUS_MM, RING_TUBE_MM, 10, 32]} />
      </mesh>
      {/* 棒は y 軸まわりに傾けた group の中で +z 方向へ積む */}
      <group rotation={[0, tilt, 0]}>
        <mesh
          raycast={noPick}
          position={[0, 0, TIP_LENGTH_MM / 2]}
          rotation={[Math.PI / 2, 0, 0]}
          material={sharedMaterial('#C9CED6', { metalness: 0.85, roughness: 0.25 })}
        >
          <cylinderGeometry args={[TIP_RADIUS_MM, TIP_RADIUS_MM * 0.6, TIP_LENGTH_MM, 10]} />
        </mesh>
        <mesh
          raycast={noPick}
          position={[0, 0, TIP_LENGTH_MM + GUARD_THICKNESS_MM / 2]}
          rotation={[Math.PI / 2, 0, 0]}
          material={sharedMaterial(color, { metalness: 0.1, roughness: 0.5 })}
        >
          <cylinderGeometry args={[GUARD_RADIUS_MM, GUARD_RADIUS_MM, GUARD_THICKNESS_MM, 18]} />
        </mesh>
        <mesh
          name={`probe-grip-${placement.side}`}
          raycast={noPick}
          position={[0, 0, TIP_LENGTH_MM + GUARD_THICKNESS_MM + GRIP_LENGTH_MM / 2]}
          rotation={[Math.PI / 2, 0, 0]}
          material={sharedMaterial(color, { metalness: 0.15, roughness: 0.45 })}
        >
          <cylinderGeometry args={[GRIP_RADIUS_MM, GRIP_RADIUS_MM * 1.1, GRIP_LENGTH_MM, 14]} />
        </mesh>
        {/* 黒い握りは盤に埋もれるので、つばと握りの境に明るい帯を巻く */}
        <mesh
          raycast={noPick}
          position={[0, 0, TIP_LENGTH_MM + GUARD_THICKNESS_MM + 1.2]}
          rotation={[Math.PI / 2, 0, 0]}
          material={glow}
        >
          <cylinderGeometry args={[GRIP_RADIUS_MM * 1.05, GRIP_RADIUS_MM * 1.05, 1.6, 14]} />
        </mesh>
        {/*
          札は棒の先から外側へ寄せる（黒は左、赤は右）。隣り合う端子（コイル⑬・⑭など）に
          2本を当てたとき、中央寄せのままだと赤の札が黒の札の上に重なって読めなかった
          （2026-09-26 点検修復の動画の確認で発見）。
        */}
        <Html
          position={[0, 0, gripEnd + 4]}
          distanceFactor={260}
          zIndexRange={[30, 20]}
          style={{ pointerEvents: 'none' }}
        >
          <span
            className={`probe-label probe-label-${placement.side}`}
            data-testid={`probe-label-${placement.side}`}
          >
            {placement.label}
          </span>
        </Html>
      </group>
    </group>
  );
}
