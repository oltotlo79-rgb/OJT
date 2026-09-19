import type { BoardTerminal, PlcUnitDefinition } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import { blockFaceTexture } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { TerminalHit, terminalTooltip } from './TerminalHit.js';
import { toScene } from './coords.js';

/**
 * 机上のPLC本体（FX5U）。設計仕様 §10.1 / §17。
 *
 * 外形・端子・LEDの並びはすべて `PlcUnitDefinition`（`@ojt/board-model`）から引く。
 * **各社のロゴ・銘板画像・画面キャプチャは描かない**（§17 / PLC調査資料 §6）。銘板は
 * `displayName` の文字だけで、機種が増えても3Dのコードは変わらない。
 */

/** ラベルは見せるだけ（drei の `Html` はラッパに `pointer-events: auto` を付ける）。 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** 筐体の色（灰）。 */
const BODY_COLOR = '#D8DBE0';
/** LEDの直径[mm]。 */
const LED_D_MM = 3;
/** LEDの並びの左端[mm]（筐体の左から）。 */
const LED_LEFT_MM = 10;
/**
 * LEDの縦位置[mm]（筐体の上から）。
 * 実機と同じく**入力側の端子列と出力側の端子列のあいだ**の帯に並べる。
 * 端子列は `PLC_ORIGIN_MM + (6, 6)` と `+ (6, 72)` から始まる千鳥2列なので、
 * 盤モデルの y で 33〜90 が空き帯になる（その中央あたり）。
 */
const LED_TOP_MM = 45;

/**
 * 筐体の厚み[mm]。
 * 机上の実寸の奥行（83mm）まで出すと端子が谷底になってクリックしづらく、正面視でも
 * 端子列が見えなくなるので、薄い台として描く（意図的な差分 #1）。
 */
const BODY_Z_MM = 6;

/**
 * 印字の板の余白[mm]。
 * `blockFaceTexture()` は端子の**4.5mm 下**に名前を描くので、下端の列が切れないよう
 * 6mm 以上いる（`TerminalBlock.tsx` の `PAD_MM` と同じ値）。
 */
const PLC_LABEL_PAD_MM = 6;
/** 印字の板の最小寸法[mm]（`labels.ts` の `MIN_FACE_MM` と同じ値。あちらは非公開）。 */
const MIN_FACE_MM = 16;
/** 印字の板を筐体から浮かせる高さ[mm]（Zファイティング避け）。 */
const LABEL_LIFT_MM = 0.5;

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
  if (terminals.length === 0) return undefined;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: Math.max(MIN_FACE_MM, maxX - minX + padMm * 2),
    h: Math.max(MIN_FACE_MM, maxY - minY + padMm * 2),
  };
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
  const { width, height } = unit.sizeMm;
  /*
   * 端子は盤モデルの z = 0（＝盤面の延長の平面）にあるので、筐体はその**下**へ沈める。
   * 台の上に端子を乗せる向きで置くと、ネジ端子も印字も筐体の中に埋まってクリックできない。
   */
  const center = toScene({
    x: unit.pos.x + width / 2,
    y: unit.pos.y + height / 2,
    z: -BODY_Z_MM / 2,
  });
  return (
    <group name="plc-unit">
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(BODY_COLOR, { roughness: 0.65, metalness: 0.1 })}
        raycast={noPick}
        position={center}
        scale={[width, height, BODY_Z_MM]}
      />
      {unit.leds.map((led, index) => (
        <mesh
          key={led}
          raycast={noPick}
          position={toScene({
            x: unit.pos.x + LED_LEFT_MM + index * (LED_D_MM * 2),
            y: unit.pos.y + LED_TOP_MM,
            z: LABEL_LIFT_MM + 0.4,
          })}
        >
          <circleGeometry args={[LED_D_MM / 2, 12]} />
          <meshBasicMaterial color="#5A6070" />
        </mesh>
      ))}
      {/*
        端子の印字は**テクスチャ1枚**に焼く（`TerminalBlock.tsx` と同じ方針。レビュー指摘 I7）。
        端子42点ぶんの `<Html>` を並べると、DOM のオーバーレイが42個できて `frameloop="demand"`
        でも毎フレーム位置が再計算され、`plc` 視点に切り替えた瞬間にコマ落ちする（§15）。
      */}
      {faceTexture === undefined || face === undefined ? null : (
        <mesh raycast={noPick} position={toScene({ x: face.cx, y: face.cy, z: LABEL_LIFT_MM })}>
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
      {/* 銘板は1枚だけなので `<Html>` のままでよい（文字だけ。ベンダーの画像は持たない。§17） */}
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
