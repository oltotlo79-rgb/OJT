import {
  roleLabel,
  socketPinHoleOffsets,
  type BoardTerminal,
  type SocketDefinition,
  type SocketId,
  type SocketRole,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { SOCKET_BODY_COLOR, SOCKET_LEVER_COLOR } from '../session/colors.js';
import { socketFaceTexture } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';
import { TerminalHit } from './TerminalHit.js';

/**
 * 14ピンソケット（PYF14A 相当）。設計仕様 §6.2 / §6.5。
 *
 * 実物は**差込穴が本体中央**（2列×7段）にあり、**ネジ端子は本体の奥端と手前端に段付きで2列ずつ**並ぶ
 * （奥ティア `[空]③②①` / `⑧⑦⑥⑤`、手前ティア `⑫⑪⑩⑨` / `④⑭⑬[空]`）。
 * 本体の外形は盤定義の `bodyMm`、端子の座標と印字は `board.terminals` の `pos` / `label` から取る。
 * 数も配置もこの層ではハードコードしないので、Plan 1B が配置を変えれば3Dも追随する。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** ネジ端子ティアの奥行[mm]（2段ぶん＋余白）。 */
const TIER_DEPTH_MM = 20;
/** ティアの高さ[mm]。 */
const TIER_HEIGHT_MM = 11;
/** 本体（差込領域）の高さ[mm]。 */
const BODY_HEIGHT_MM = 9;
/** 印字の板をネジの頭より上に浮かせる量[mm]（ネジに隠れないようにする）。 */
const LABEL_LIFT_MM = 2;
/** 保持レバーの幅[mm]。 */
const LEVER_WIDTH_MM = 4;
/** 差込穴の半径[mm]。 */
const PIN_HOLE_RADIUS_MM = 1;

/** レイキャストを受けない（クリックを下の本体・端子へ通す）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** ツールチップの文字列（`CR1 ⑨ COM`）。盤定義の印字に役割IDを足す。§8.2 */
export function socketTerminalLabel(role: SocketRole | undefined, terminal: BoardTerminal): string {
  // 盤定義のラベルは `S1 ⑨ COM`。物理ソケットIDを役割IDに置き換えて出す
  const parts = terminal.label.split(' ');
  const number = parts.at(-2) ?? terminal.label;
  return `${role ?? '予備'} ${number} ${roleLabel(terminal.role)}`;
}

/** ソケット1個（本体＋段付き端子ティア＋差込穴＋保持レバー＋印字）。 */
export function Socket({
  socket,
  role,
  occupied,
  terminals,
  hoveredTerminal,
  pendingTerminal,
  onHoverTerminal,
  onPickTerminal,
  onPickSocket,
}: {
  socket: SocketDefinition;
  role: SocketRole | undefined;
  occupied: boolean;
  terminals: readonly BoardTerminal[];
  hoveredTerminal: string | undefined;
  pendingTerminal: string | undefined;
  onHoverTerminal: (id: TerminalId | undefined) => void;
  onPickTerminal: (terminal: BoardTerminal) => void;
  onPickSocket: (socketId: SocketId, occupied: boolean) => void;
}): JSX.Element {
  const { width, length } = socket.bodyMm;
  const originX = socket.origin.x;
  const originY = socket.origin.y;
  const centerX = originX + width / 2;
  const centerY = originY + length / 2;

  const faceTexture = useMemo(
    () => socketFaceTexture(terminals, originX, originY, width, length),
    [terminals, originX, originY, width, length],
  );
  const holes = useMemo(() => socketPinHoleOffsets(), []);

  const bodyCenter = toScene({ x: centerX, y: centerY, z: BODY_HEIGHT_MM / 2 });

  return (
    <group name={`socket-${socket.id}`}>
      {/* 本体（中央の差込領域）。クリックで装着／取り外しUIを出す */}
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(SOCKET_BODY_COLOR, { roughness: 0.55, metalness: 0.1 })}
        position={bodyCenter}
        scale={[width, length, BODY_HEIGHT_MM]}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onPickSocket(socket.id, occupied);
        }}
      />
      {/* 差込穴（2列×7段。中央の差込領域に並ぶ） */}
      {holes.map((hole, index) => (
        <mesh
          key={`hole-${index}`}
          raycast={noPick}
          position={toScene({
            x: originX + hole.dx,
            y: originY + hole.dy,
            z: BODY_HEIGHT_MM + 0.2,
          })}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[PIN_HOLE_RADIUS_MM, PIN_HOLE_RADIUS_MM, 0.5, 8]} />
          <meshStandardMaterial color="#0B0D10" roughness={0.9} />
        </mesh>
      ))}
      {/* 段付きの端子ティア（奥端・手前端） */}
      {[0, 1].map((index) => {
        const y = index === 0 ? originY + TIER_DEPTH_MM / 2 : originY + length - TIER_DEPTH_MM / 2;
        return (
          <mesh
            key={`tier-${index}`}
            geometry={UNIT_BOX}
            material={sharedMaterial(SOCKET_BODY_COLOR, { roughness: 0.5, metalness: 0.12 })}
            raycast={noPick}
            position={toScene({ x: centerX, y, z: TIER_HEIGHT_MM / 2 })}
            scale={[width, TIER_DEPTH_MM, TIER_HEIGHT_MM]}
          />
        );
      })}
      {/* 保持レバー（実物は黄色。中央の差込領域の両端） */}
      {[0, 1].map((index) => {
        const y =
          index === 0
            ? originY + TIER_DEPTH_MM + LEVER_WIDTH_MM
            : originY + length - TIER_DEPTH_MM - LEVER_WIDTH_MM;
        return (
          <mesh
            key={`lever-${index}`}
            geometry={UNIT_BOX}
            material={sharedMaterial(SOCKET_LEVER_COLOR, { roughness: 0.45 })}
            raycast={noPick}
            position={toScene({ x: centerX, y, z: BODY_HEIGHT_MM + 1 })}
            scale={[width * 0.6, LEVER_WIDTH_MM, 2.5]}
          />
        );
      })}
      {/* ネジ端子の番号と役割の印字（常時表示）。§6.2 */}
      {faceTexture === undefined ? null : (
        <mesh
          raycast={noPick}
          position={[bodyCenter[0], bodyCenter[1], TIER_HEIGHT_MM + LABEL_LIFT_MM]}
        >
          <planeGeometry args={[width, length]} />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={280}
        position={[bodyCenter[0], bodyCenter[1] + length / 2 + 5, TIER_HEIGHT_MM]}
        zIndexRange={[10, 0]}
      >
        <span className="socket-label">
          {role ?? '予備'}
          <small>{socket.id}</small>
        </span>
      </Html>
      {terminals.map((terminal) => (
        <TerminalHit
          key={terminal.id}
          terminal={terminal}
          tooltip={socketTerminalLabel(role, terminal)}
          hovered={hoveredTerminal === terminal.id}
          pending={pendingTerminal === terminal.id}
          onHover={onHoverTerminal}
          onPick={onPickTerminal}
        />
      ))}
    </group>
  );
}
