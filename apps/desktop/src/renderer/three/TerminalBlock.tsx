import type { BoardTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import { TERMINAL_BLOCK_CAP_COLOR, TERMINAL_BLOCK_COLOR } from '../session/colors.js';
import { blockFaceTexture } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';
import { TerminalHit } from './TerminalHit.js';

/**
 * 端子台（ランプ用8P・押ボタン用12P・P/N供給端子）。設計仕様 §6.1 / §6.5。
 * 端子の座標は盤定義から取り、台座は端子の外接矩形から自動で作るのでハードコードしない。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** 台座の余白[mm]。 */
const PAD_MM = 6;

/** 台座の最小の幅・奥行[mm]。端子が1〜2点しかない DC24V 端子台でも潰れないようにする。§6.1 */
const MIN_BODY_MM = 16;

/** 端子台の奥側カバーの奥行[mm]。 */
const CAP_DEPTH_MM = 9;

/** 印字の板をネジの頭より上に浮かせる量[mm]。 */
const LABEL_LIFT_MM = 1.4;

/** レイキャストを受けない（印字の板がクリックを奪わないようにする）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 端子台1個（台座＋端子＋ラベル）。 */
export function TerminalBlock({
  name,
  label,
  terminals,
  hoveredTerminal,
  pendingTerminal,
  onHoverTerminal,
  onPickTerminal,
}: {
  name: string;
  label: string;
  terminals: readonly BoardTerminal[];
  hoveredTerminal: string | undefined;
  pendingTerminal: string | undefined;
  onHoverTerminal: (id: TerminalId | undefined) => void;
  onPickTerminal: (terminal: BoardTerminal) => void;
}): JSX.Element | null {
  // 印字は端子台1個につきテクスチャ1枚にまとめる（labels.ts の方針）
  const faceTexture = useMemo(() => blockFaceTexture(terminals, PAD_MM), [terminals]);
  if (terminals.length === 0) return null;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const zs = terminals.map((t) => t.pos.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const height = Math.max(...zs);
  const center = toScene({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: height / 2 });
  const bodyWidth = Math.max(MIN_BODY_MM, maxX - minX + PAD_MM * 2);
  const bodyDepth = Math.max(MIN_BODY_MM, maxY - minY + PAD_MM * 2);
  return (
    <group name={`block-${name}`}>
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={sharedMaterial(TERMINAL_BLOCK_COLOR, { roughness: 0.7 })}
        position={center}
        scale={[bodyWidth, bodyDepth, height]}
      />
      {/* 端子の名前の印字（常時表示）。§6.4 */}
      {faceTexture === undefined ? null : (
        <mesh raycast={noPick} position={[center[0], center[1], height + LABEL_LIFT_MM]}>
          <planeGeometry args={[bodyWidth, bodyDepth]} />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
      {/* 端子台の奥側の黒いカバー（実物の見た目） */}
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={sharedMaterial(TERMINAL_BLOCK_CAP_COLOR, { roughness: 0.6 })}
        position={[center[0], center[1] + bodyDepth / 2 + CAP_DEPTH_MM / 2, height / 2]}
        scale={[bodyWidth, CAP_DEPTH_MM, height + 2]}
      />
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={320}
        position={[center[0], center[1] + bodyDepth / 2 + 4, height]}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{label}</span>
      </Html>
      {terminals.map((terminal) => (
        <TerminalHit
          key={terminal.id}
          terminal={terminal}
          tooltip={terminal.label}
          hovered={hoveredTerminal === terminal.id}
          pending={pendingTerminal === terminal.id}
          onHover={onHoverTerminal}
          onPick={onPickTerminal}
        />
      ))}
    </group>
  );
}
