import {
  roleLabel,
  socketPinHoleOffsets,
  type BoardTerminal,
  type SocketDefinition,
  type SocketId,
  type SocketRole,
} from '@ojt/board-model';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { SOCKET_BODY_COLOR, SOCKET_LEVER_COLOR, SOCKET_SELECTED_COLOR } from '../session/colors.js';
import { socketFaceTexture, SOCKET_PLATE_MARGIN_MM } from './labels.js';
import { noPick, sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';

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
/**
 * ティアの高さ[mm]。
 * ネジ端子は盤面から `SOCKET_TERMINAL_Z_MM`（10mm）にあり、ネジ頭の円柱は 9.2〜10.8mm を占める。
 * 以前の 11mm はネジ頭をまるごと飲み込んでしまい、ホバー色（水色）も配線待ち色（橙）も
 * 画面に出てこなかった（レビュー指摘）。ネジ頭が 1.8mm 突き出す 9mm にする。
 */
export const TIER_HEIGHT_MM = 9;
/** 本体（差込領域）の高さ[mm]。 */
const BODY_HEIGHT_MM = 9;
/** 印字の板をネジの頭より上に浮かせる量[mm]（ネジに隠れないようにする）。 */
const LABEL_LIFT_MM = 2;
/** 保持レバーの幅[mm]。 */
const LEVER_WIDTH_MM = 4;
/** 差込穴の半径[mm]。 */
const PIN_HOLE_RADIUS_MM = 1;

/**
 * ソケット本体（差込領域）のマテリアル。選択中は縁が光って見えるよう発光を足す。
 * 「いまどのソケットを触っているか」が3Dの側でも分かるようにするため（利用者要望 2026-09-19）。
 * `sharedMaterial()` は設定ごとに1個しか作らないので、選択の有無で2個に収まる（§15）。
 */
export function socketBodyMaterial(selected: boolean): ReturnType<typeof sharedMaterial> {
  return selected
    ? sharedMaterial(SOCKET_BODY_COLOR, {
        roughness: 0.55,
        metalness: 0.1,
        emissive: SOCKET_SELECTED_COLOR,
        emissiveIntensity: 0.6,
      })
    : sharedMaterial(SOCKET_BODY_COLOR, { roughness: 0.55, metalness: 0.1 });
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
  selected,
  terminals,
  onPickSocket,
}: {
  socket: SocketDefinition;
  role: SocketRole | undefined;
  occupied: boolean;
  /** 部品パネルのカードがこのソケットを指しているか（本体を光らせる）。§8.2 */
  selected: boolean;
  /**
   * このソケットの端子（印字テクスチャの焼き付けに使う）。
   * **端子そのものは描かない**（`TerminalField` が盤の端子をまとめて1回で描く。決定表#13）。
   */
  terminals: readonly BoardTerminal[];
  onPickSocket: (socketId: SocketId, occupied: boolean) => void;
}): JSX.Element {
  const { width, length } = socket.bodyMm;
  const originX = socket.origin.x;
  const originY = socket.origin.y;
  const centerX = originX + width / 2;
  const centerY = originY + length / 2;

  // 印字の板は本体より四方に `SOCKET_PLATE_MARGIN_MM` だけ大きい（外側の列の `COM` が切れないため）
  const plateWidth = width + SOCKET_PLATE_MARGIN_MM * 2;
  const plateLength = length + SOCKET_PLATE_MARGIN_MM * 2;
  const faceTexture = useMemo(
    () =>
      socketFaceTexture(
        terminals,
        originX - SOCKET_PLATE_MARGIN_MM,
        originY - SOCKET_PLATE_MARGIN_MM,
        plateWidth,
        plateLength,
      ),
    [terminals, originX, originY, plateWidth, plateLength],
  );
  const holes = useMemo(() => socketPinHoleOffsets(), []);

  const bodyCenter = toScene({ x: centerX, y: centerY, z: BODY_HEIGHT_MM / 2 });

  return (
    <group name={`socket-${socket.id}`}>
      {/* 本体（中央の差込領域）。クリックで装着／取り外しUIを出す */}
      <mesh
        geometry={UNIT_BOX}
        material={socketBodyMaterial(selected)}
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
          <planeGeometry args={[plateWidth, plateLength]} />
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
    </group>
  );
}
