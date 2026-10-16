import {
  BOARD_WIDTH_MM,
  OUTLET_ORIGIN_MM,
  PLC_TERMINAL_PITCH_MM,
  type BoardTerminal,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import { BoardLabel } from './BoardLabel.js';
import type { LabelRoomMm } from './label-declutter.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import {
  OUTLET_PLATE_H_MM as PLATE_H_MM,
  OUTLET_PLATE_W_MM as PLATE_W_MM,
  OUTLET_PLATE_Z_MM as PLATE_Z_MM,
} from './outlet-geometry.js';
import { deskTerminalTooltip, TerminalField } from './TerminalField.js';
import { toScene } from './coords.js';

/** 壁コンセントの名札を板の下端から離す量[mm]。 */
const LABEL_GAP_MM = 3;

/** 名札の基準点（板の下端の中央。名札は下へ伸びる。v2.1.0 監査 U3）。 */
const LABEL_X_MM = OUTLET_ORIGIN_MM.x + PLC_TERMINAL_PITCH_MM / 2;
const LABEL_Y_MM = OUTLET_ORIGIN_MM.y + PLATE_H_MM / 2 + LABEL_GAP_MM;

/**
 * 名札の置き場[mm]。板の下は机の上で何も無いが、左へ広がると盤の右端にかかるので、
 * 幅は「盤の右端から基準点までの2倍」まで。
 */
const LABEL_ROOM: LabelRoomMm = { w: 2 * (LABEL_X_MM - BOARD_WIDTH_MM - 1), h: 100 };

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
      {/* PLCの電源を取る先なので、端子台の名札より優先して残す（`label-declutter.ts`） */}
      <BoardLabel
        position={toScene({ x: LABEL_X_MM, y: LABEL_Y_MM, z: 0 })}
        anchor="top"
        distanceFactor={360}
        rank={2}
        room={LABEL_ROOM}
      >
        {JA.plc.outlet}
      </BoardLabel>
    </group>
  );
}
