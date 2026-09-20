import { OUTLET_ORIGIN_MM, PLC_TERMINAL_PITCH_MM, type BoardTerminal } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { deskTerminalTooltip, TerminalField } from './TerminalField.js';
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
      {/*
        机上の端子も **`TerminalField` 1本**に畳む（3D-12）。`TerminalHit` は端子1個につき
        `<group>` ＋ ネジ ＋ 当たり判定の3メッシュを作るので、FX5U の42点だけで約126個の
        オブジェクト・約40ドローコールになっていた（決定表#13 の前提「十数個」が機種追加で
        崩れている）。盤の端子と同じ `instancedMesh` 2本（ネジ＝見える／当たり判定＝不可視）に
        まとめる。位置も当たり判定の大きさもこれまでと1mmも変えない。
      */}
      <TerminalField
        terminals={terminals}
        tooltipOf={deskTerminalTooltip}
        hovered={hoveredTerminal}
        pending={pendingTerminal}
        onHover={onHoverTerminal}
        onPick={onPickTerminal}
      />
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
        {/* PLCの電源を取る先なので、端子台の名札より優先して残す（`label-declutter.ts`） */}
        <span className="block-label" data-label-rank={2}>
          {JA.plc.outlet}
        </span>
      </Html>
    </group>
  );
}
