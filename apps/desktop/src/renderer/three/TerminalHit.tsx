import type { BoardTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import {
  TERMINAL_HOVER_COLOR,
  TERMINAL_PENDING_COLOR,
  TERMINAL_SCREW_COLOR,
} from '../session/colors.js';
import { PICK_GEOMETRY, SCREW_GEOMETRY, sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 端子1個（ネジ端子の見た目＋レイキャスト用の当たり判定球）。設計仕様 §6.5 / §8.2。
 * 当たり判定の半径は盤定義の `pickRadiusMm`（4mm）をそのまま使う。
 * ホバー中は `CR1 ⑨ COM` 形式のツールチップを `Html` で出す（§8.2）。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/**
 * 当たり判定の球を盤面から浮かせる量[mm]。
 * 端子台やソケットの筐体より必ず手前に来るようにして、端子のクリックが筐体に奪われないようにする。
 */
const PICK_LIFT_MM = 3;

/** ツールチップのラベル文字列を作る（役割名は盤定義の `label` をそのまま使う）。§8.2 */
export function terminalTooltip(terminal: BoardTerminal, roleLabel: string): string {
  return roleLabel.length > 0 ? roleLabel : terminal.label;
}

/** 端子1個。 */
export function TerminalHit({
  terminal,
  tooltip,
  hovered,
  pending,
  onHover,
  onPick,
}: {
  terminal: BoardTerminal;
  tooltip: string;
  hovered: boolean;
  pending: boolean;
  onHover: (id: TerminalId | undefined) => void;
  onPick: (terminal: BoardTerminal) => void;
}): JSX.Element {
  const pos = toScene(terminal.pos);
  const screwColor = pending
    ? TERMINAL_PENDING_COLOR
    : hovered
      ? TERMINAL_HOVER_COLOR
      : TERMINAL_SCREW_COLOR;
  return (
    <group position={pos}>
      <mesh
        geometry={SCREW_GEOMETRY}
        material={sharedMaterial(screwColor, { metalness: 0.7, roughness: 0.3 })}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh
        geometry={PICK_GEOMETRY}
        scale={terminal.pickRadiusMm}
        position={[0, 0, PICK_LIFT_MM]}
        visible={false}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHover(terminal.id);
        }}
        onPointerOut={() => {
          onHover(undefined);
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onPick(terminal);
        }}
      />
      {hovered ? (
        <Html
          center
          style={LABEL_STYLE}
          distanceFactor={260}
          position={[0, 6, 6]}
          zIndexRange={[20, 0]}
        >
          <span className="terminal-tooltip">{tooltip}</span>
        </Html>
      ) : null}
    </group>
  );
}
