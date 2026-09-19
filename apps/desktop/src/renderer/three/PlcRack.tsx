import type { BoardTerminal, PlcAppearance, PlcUnitDefinition, Vec3 } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useEffect, useMemo, type JSX } from 'react';
import { FACE_LABEL_LIFT_MM, PLC_BODY_Z_MM, RACK_BODY_Z_MM } from './appearance.js';
import { blockFaceTexture, faceRect, roleColorsFor } from './labels.js';
import { PlcFace, useLedState } from './PlcUnit.js';
import { TerminalHit, terminalTooltip } from './TerminalHit.js';
import { toScene } from './coords.js';

/**
 * ラック形のPLC（ベース＋モジュール）。設計仕様 §10.1 / §17 #21。決定表#17
 *
 * ベース1枚を薄い台として敷き、その手前に `unit.modules` の箱を並べる。**端子とその印字は
 * ここが1回だけ描く**（`unit.terminals` は平らな1本の配列で、端子IDにモジュール名は入らない。
 * 4A H-6）。これで Phase 3 の配線操作・経路生成・E2Eの射影がそのまま動く。
 * 色・寸法はすべて `PlcAppearance` から引く（4A 決定表#15）。
 */

/** ラベルは見せるだけ。 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** ラックの端子の印字板の余白[mm]（`PlcUnit` と同じ理由で下端の列を切らない）。 */
const RACK_LABEL_PAD_MM = 6;

/**
 * ベースの**前面**の高さ[mm]。
 * モジュール（前面 z = 0・厚み `RACK_BODY_Z_MM`）の奥に置く。
 */
const RACK_BASE_FACE_Z_MM = -RACK_BODY_Z_MM / 2;

function noPick(): void {
  // 交差候補を積まない
}

/** 3Dが描くモジュール1枚ぶんの箱。 */
export interface RackModuleBox {
  model: string;
  displayName: string;
  origin: Vec3;
  appearance: PlcAppearance;
  depthMm: number;
}

/** ラックのモジュールを左から右へ（一体形は空配列）。 */
export function rackModuleBoxes(unit: PlcUnitDefinition): RackModuleBox[] {
  if (unit.form !== 'rack') return [];
  return [...(unit.modules ?? [])]
    .sort((a, b) => a.slot - b.slot)
    .map((module) => ({
      model: module.model,
      displayName: module.displayName,
      origin: module.pos,
      appearance: module.appearance,
      depthMm: RACK_BODY_Z_MM,
    }));
}

/** ラックの端子（機種の端子をそのまま。4A H-6）。 */
export function rackTerminalsOf(unit: PlcUnitDefinition): readonly BoardTerminal[] {
  return unit.terminals;
}

/** ラック形のPLC。 */
export function PlcRack({
  unit,
  terminals,
  hoveredTerminal,
  pendingTerminal,
  onHoverTerminal,
  onPickTerminal,
}: {
  unit: PlcUnitDefinition;
  terminals: readonly BoardTerminal[];
  hoveredTerminal: TerminalId | undefined;
  pendingTerminal: TerminalId | undefined;
  onHoverTerminal: (id: TerminalId | undefined) => void;
  onPickTerminal: (terminal: BoardTerminal) => void;
}): JSX.Element {
  const modules = useMemo(() => rackModuleBoxes(unit), [unit]);
  const ledState = useLedState();
  /*
   * 印字の色は**端子台（背板）の明るさ**で選ぶ（4B レビュー B1）。ラックのモジュールの
   * 端子台は黒（`#22262B` / `#2B2B2B`）なので、盤の端子台と同じ濃い字では `X0` も `ICOM0` も
   * 読めなかった。ベースとモジュールは同じ端子台色なので、ベース側の色で1枚ぶん決める。
   */
  const faceColors = useMemo(
    () => roleColorsFor(unit.appearance.terminalBlockColor),
    [unit.appearance.terminalBlockColor],
  );
  const faceTexture = useMemo(
    () => blockFaceTexture(terminals, RACK_LABEL_PAD_MM, faceColors),
    [terminals, faceColors],
  );
  // 機種を替えるとラックごと作り直される（Plan 4B Task 6）。古いテクスチャは解放する（M10）
  useEffect(() => {
    return () => {
      faceTexture?.dispose();
    };
  }, [faceTexture]);
  const labelFace = useMemo(() => faceRect(terminals, RACK_LABEL_PAD_MM), [terminals]);
  const { width, height } = unit.sizeMm;
  return (
    <group name="plc-rack">
      {/*
        基本ベース（モジュールより奥）。筐体・スロットのレール・銘板（`PC10G-1SP` / `JW-300`）は
        `PlcFace` が `unit.appearance` から描く。以前はここで筐体と造作を手で描き直していて、
        ベースの銘板が出ていなかった（4B レビュー I3）。
      */}
      <PlcFace
        origin={unit.pos}
        appearance={unit.appearance}
        depthMm={PLC_BODY_Z_MM}
        ledState={ledState}
        faceZMm={RACK_BASE_FACE_Z_MM}
      />
      {modules.map((module) => (
        <group key={module.model} name={`rack-module-${module.model}`}>
          <PlcFace
            origin={module.origin}
            appearance={module.appearance}
            depthMm={module.depthMm}
            ledState={ledState}
          />
          {/*
            モジュールの名札は**形式名だけ**（`IN-12` / `JW-212NA`）をモジュールの上端に出す。
            長い `displayName`（`DC入力16点（THK-2750）`）は35mmピッチの列に並べると隣と重なって
            読めなかったので、マウスオーバーの `title` に回す（4B レビュー I4）。
          */}
          <Html
            center
            style={LABEL_STYLE}
            distanceFactor={520}
            position={toScene({
              x: module.origin.x + module.appearance.faceMm.width / 2,
              y: module.origin.y - 5,
              z: 0,
            })}
            zIndexRange={[10, 0]}
          >
            <span className="block-label" title={module.displayName}>
              {module.model}
            </span>
          </Html>
        </group>
      ))}
      {/* 端子の印字はラック全体で1枚（モジュールごとに割らない。決定表#17） */}
      {faceTexture === undefined || labelFace === undefined ? null : (
        <mesh
          raycast={noPick}
          position={toScene({ x: labelFace.cx, y: labelFace.cy, z: FACE_LABEL_LIFT_MM })}
        >
          <planeGeometry args={[labelFace.w, labelFace.h]} />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
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
        distanceFactor={420}
        position={toScene({ x: unit.pos.x + width / 2, y: unit.pos.y + height + 8, z: 0 })}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{unit.displayName}</span>
      </Html>
    </group>
  );
}
