import type { BoardTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { RingGeometry } from 'three';
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

/**
 * ツールチップの位置（端子の中心からのずれ[mm]）。
 * 盤の**手前**（−Y）へ降ろし、かつ手前へ浮かせる。奥へ出すとソケットのネジ端子ティアや
 * 隣の段の印字に被って、いま指している端子の番号が読めなくなる（レビュー指摘）。
 */
const TOOLTIP_OFFSET_MM: [number, number, number] = [0, -8, 8];

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
/** 輪をネジ（z=0）より手前、当たり判定球（`PICK_LIFT_MM`）より奥に置く[mm]。 */
const HOVER_RING_LIFT_MM = PICK_LIFT_MM - 0.6;

/** レイキャストを受けない（飾りの輪がクリックを奪わないように）。 */
function noPick(): void {
  // 交差候補を積まない
}

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
  const screw = terminalScrewAppearance(hovered, pending);
  return (
    <group position={pos}>
      <mesh
        geometry={SCREW_GEOMETRY}
        material={sharedMaterial(screw.color, {
          metalness: 0.7,
          roughness: 0.3,
          ...(screw.emissive === undefined
            ? {}
            : { emissive: screw.emissive, emissiveIntensity: screw.emissiveIntensity }),
        })}
        rotation={[Math.PI / 2, 0, 0]}
      />
      {hovered ? (
        <mesh
          geometry={HOVER_RING_GEOMETRY}
          material={sharedMaterial(TERMINAL_HOVER_COLOR, {
            metalness: 0,
            roughness: 0.4,
            emissive: TERMINAL_HOVER_COLOR,
            emissiveIntensity: TERMINAL_HOVER_EMISSIVE_INTENSITY,
            transparent: true,
            opacity: 0.85,
          })}
          raycast={noPick}
          position={[0, 0, HOVER_RING_LIFT_MM]}
        />
      ) : null}
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
          position={TOOLTIP_OFFSET_MM}
          zIndexRange={[20, 0]}
        >
          <span className="terminal-tooltip">{tooltip}</span>
        </Html>
      ) : null}
    </group>
  );
}
