import type { BoardTerminal, PlcAppearance, PlcUnitDefinition, Vec3 } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import { useStore } from '../app/store.js';
import {
  faceRectToBoard,
  litLedKeys,
  FACE_LABEL_LIFT_MM,
  FACE_LED_LIFT_MM,
  FACE_LIFT_MM,
  LED_OFF_COLOR,
  PLC_BODY_Z_MM,
  type PlcLedState,
} from './appearance.js';
// `plcFaceRect()` は landed のまま `labels.ts` の `faceRect()` を包む（4A H-7 の「残す2つ」）
import { blockFaceTexture, faceRect } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { TerminalHit, terminalTooltip } from './TerminalHit.js';
import { toScene } from './coords.js';

/**
 * 机上のPLC本体。設計仕様 §10.1 / §17。決定表#15
 *
 * 外形・色・端子カバー・LED・銘板・前面の造作はすべて `PlcAppearance`（`@ojt/board-model`）から
 * 引く。**このファイルに色も寸法も書かない**ので、実機と違うと分かったときの修正箇所は
 * `packages/board-model/src/plc-unit.ts` の `*_APPEARANCE` 1ファイルだけである（4A 決定表#15）。
 * **各社のロゴ・銘板画像・画面キャプチャは描かない**（§17 / PLC調査資料 §6）。銘板は
 * `appearance.nameplate`（型式の文字列だけ）を出す。
 */

/** ラベルは見せるだけ（drei の `Html` はラッパに `pointer-events: auto` を付ける）。 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/**
 * 印字の板の余白[mm]。
 * `blockFaceTexture()` は端子の**4.5mm 下**に名前を描くので、下端の列が切れないよう
 * 6mm 以上いる（`TerminalBlock.tsx` の `PAD_MM` と同じ値）。
 */
const PLC_LABEL_PAD_MM = 6;

/** レイキャストを受けない（筐体が端子のクリックを奪わないように）。 */
function noPick(): void {
  // 交差候補を積まない
}

/**
 * 印字の板の位置と大きさ（盤モデル mm）。
 * `blockFaceTexture()` が焼くテクスチャの外形と**必ず一致させる**。筐体（150×90）に
 * 貼ると端子の並び（約95×75）とずれて名前が端子の上に乗らないので、板は端子の
 * 外接矩形から作る（`TerminalBlock.tsx` が台座の寸法でそうしているのと同じ理屈）。
 */
export function plcFaceRect(
  terminals: readonly BoardTerminal[],
  padMm: number = PLC_LABEL_PAD_MM,
): { cx: number; cy: number; w: number; h: number } | undefined {
  // 外接矩形と最小サイズの計算は `labels.ts` の `faceRect()` に一本化した
  // （以前は `blockFaceTexture()` と同じ式をここへ複製していた。レビュー MERGE #15）
  return faceRect(terminals, padMm);
}

/** いまのLEDの状態をストアから作る（決定表#20）。 */
export function useLedState(): PlcLedState {
  const running = useStore((s) => s.plcRunning);
  const convertFailed = useStore((s) => !s.converted && s.convertIssues.errors.length > 0);
  const inputs = useStore((s) => s.plcMonitor?.inputs);
  const outputs = useStore((s) => s.plcMonitor?.outputs);
  return useMemo(
    () => ({ running, convertFailed, inputs, outputs }),
    [running, convertFailed, inputs, outputs],
  );
}

/**
 * 外観1枚ぶん（本体、またはラックのモジュール1枚）の面を描く。
 * 筐体 → 端子カバー → 造作 → LED → 銘板の順に、盤面から少しずつ手前へ重ねる。
 */
export function PlcFace({
  origin,
  appearance,
  depthMm,
  ledState,
}: {
  /** 左奥の角（`unit.pos` / `module.pos`）。 */
  origin: Vec3;
  appearance: PlcAppearance;
  /** 筐体の厚み[mm]。 */
  depthMm: number;
  ledState: PlcLedState;
}): JSX.Element {
  const lit = useMemo(() => litLedKeys(appearance, ledState), [appearance, ledState]);
  const { width, height } = appearance.faceMm;
  return (
    <group name="plc-face">
      {/* 筐体。端子（z = 0）の**下**へ沈める（台の上に乗せると端子が埋まる） */}
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(appearance.bodyColor, { roughness: 0.65, metalness: 0.1 })}
        raycast={noPick}
        position={toScene({ x: origin.x + width / 2, y: origin.y + height / 2, z: -depthMm / 2 })}
        scale={[width, height, depthMm]}
      />
      {/* ヒンジ式の端子カバー（開いた状態で描く。決定表#16） */}
      {appearance.covers.map((cover) => {
        const box = faceRectToBoard(origin, cover.rect, -FACE_LIFT_MM);
        return (
          <mesh
            key={cover.id}
            geometry={UNIT_BOX}
            material={sharedMaterial(cover.color, { roughness: 0.8, metalness: 0 })}
            raycast={noPick}
            name={`plc-cover-${cover.id}`}
            position={toScene({ x: box.cx, y: box.cy, z: box.z })}
            scale={[box.w, box.h, 1]}
          />
        );
      })}
      {/* 前面の造作（RUN/STOPスイッチ・コネクタ・スロット・固定ラッチ） */}
      {appearance.features.map((feature) => {
        const box = faceRectToBoard(origin, feature.rect, FACE_LIFT_MM);
        return (
          <mesh
            key={feature.id}
            geometry={UNIT_BOX}
            material={sharedMaterial(feature.color, { roughness: 0.7, metalness: 0.2 })}
            raycast={noPick}
            name={`plc-feature-${feature.id}`}
            position={toScene({ x: box.cx, y: box.cy, z: box.z })}
            scale={[box.w, box.h, 1]}
          />
        );
      })}
      {/* LED。点灯色は `appearance` が持ち、消灯は共通の暗色にする（決定表#20） */}
      {appearance.leds.map((led) => {
        const box = faceRectToBoard(origin, led.rect, FACE_LED_LIFT_MM);
        const on = lit.has(`${led.group}:${led.name}`);
        return (
          <mesh
            key={`${led.group}:${led.name}`}
            geometry={UNIT_BOX}
            material={sharedMaterial(on ? led.color : LED_OFF_COLOR, {
              roughness: 0.3,
              metalness: 0,
            })}
            raycast={noPick}
            name={`led-${led.group}-${led.name}`}
            position={toScene({ x: box.cx, y: box.cy, z: box.z })}
            scale={[box.w, box.h, 0.8]}
          />
        );
      })}
      {/* 銘板は型式の文字だけ（ロゴ・ブランド名は描かない。§17 / 4A 前提#14） */}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={420}
        position={toScene({
          x: origin.x + appearance.nameplateRect.x + appearance.nameplateRect.w / 2,
          y: origin.y + appearance.nameplateRect.y + appearance.nameplateRect.h / 2,
          z: FACE_LED_LIFT_MM,
        })}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{appearance.nameplate}</span>
      </Html>
    </group>
  );
}

/** PLC本体。 */
export function PlcUnit({
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
  /** 端子の印字を1枚のテクスチャに焼く。§6.4 / I7 */
  const faceTexture = useMemo(() => blockFaceTexture(terminals, PLC_LABEL_PAD_MM), [terminals]);
  const face = useMemo(() => plcFaceRect(terminals), [terminals]);
  const ledState = useLedState();
  return (
    <group name="plc-unit">
      <PlcFace
        origin={unit.pos}
        appearance={unit.appearance}
        depthMm={PLC_BODY_Z_MM}
        ledState={ledState}
      />
      {/*
        端子の印字は**テクスチャ1枚**に焼く（`TerminalBlock.tsx` と同じ方針。レビュー指摘 I7）。
        端子42点ぶんの `<Html>` を並べると、DOM のオーバーレイが42個できて `frameloop="demand"`
        でも毎フレーム位置が再計算され、`plc` 視点に切り替えた瞬間にコマ落ちする（§15）。
        板は**カバーより手前**に置く（決定表#16）。
      */}
      {faceTexture === undefined || face === undefined ? null : (
        <mesh
          raycast={noPick}
          position={toScene({ x: face.cx, y: face.cy, z: FACE_LABEL_LIFT_MM })}
        >
          <planeGeometry args={[face.w, face.h]} />
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
      {/* 機種名は本体の上に1枚（`displayName`。銘板とは別物。ベンダーの画像は持たない。§17） */}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={420}
        position={toScene({
          x: unit.pos.x + unit.sizeMm.width / 2,
          y: unit.pos.y + unit.sizeMm.height + 8,
          z: 0,
        })}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{unit.displayName}</span>
      </Html>
    </group>
  );
}
