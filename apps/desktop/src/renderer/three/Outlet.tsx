import { OUTLET_ORIGIN_MM, PLC_TERMINAL_PITCH_MM, type BoardTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { TerminalHit, terminalTooltip } from './TerminalHit.js';
import { toScene } from './coords.js';

/** 壁コンセント（AC100V）。設計仕様 §10.1。 */
const PLATE_W_MM = 34;
const PLATE_H_MM = 24;
const PLATE_Z_MM = 4;

/** ラベルは見せるだけ（drei の `Html` はラッパに `pointer-events: auto` を付ける）。 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

function noPick(): void {
  // 交差候補を積まない
}

/** 壁コンセント。 */
export function Outlet({
  terminals,
  hoveredTerminal,
  pendingTerminal,
  onHoverTerminal,
  onPickTerminal,
}: {
  terminals: readonly BoardTerminal[];
  hoveredTerminal: TerminalId | undefined;
  pendingTerminal: TerminalId | undefined;
  onHoverTerminal: (id: TerminalId | undefined) => void;
  onPickTerminal: (terminal: BoardTerminal) => void;
}): JSX.Element {
  /*
   * PLC本体と同じく、端子（z = 0）の**下**へプレートを沈める。
   * 上に積むと `L` / `N` のネジ端子がプレートの中に埋まってクリックできない。
   */
  const center = toScene({
    x: OUTLET_ORIGIN_MM.x + PLC_TERMINAL_PITCH_MM / 2,
    y: OUTLET_ORIGIN_MM.y,
    z: -PLATE_Z_MM / 2,
  });
  return (
    <group name="outlet">
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial('#F0F1F3', { roughness: 0.8, metalness: 0 })}
        raycast={noPick}
        position={center}
        scale={[PLATE_W_MM, PLATE_H_MM, PLATE_Z_MM]}
      />
      {terminals.map((terminal) => (
        <TerminalHit
          key={terminal.id}
          terminal={terminal}
          tooltip={terminalTooltip(terminal, terminal.label)}
          hovered={hoveredTerminal === terminal.id}
          pending={pendingTerminal === terminal.id}
          onHover={onHoverTerminal}
          onPick={onPickTerminal}
        />
      ))}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={360}
        position={toScene({
          x: OUTLET_ORIGIN_MM.x + PLC_TERMINAL_PITCH_MM / 2,
          y: OUTLET_ORIGIN_MM.y + PLATE_H_MM / 2 + 6,
          z: 0,
        })}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{JA.plc.outlet}</span>
      </Html>
    </group>
  );
}
