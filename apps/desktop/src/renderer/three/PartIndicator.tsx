import { TIMER_MIN_PRESET_MS } from '@ojt/circuit-sim';
import type { JSX } from 'react';
import {
  AdditiveBlending,
  CanvasTexture,
  CylinderGeometry,
  LinearFilter,
  SRGBColorSpace,
  type MeshStandardMaterial,
  type Texture,
} from 'three';
import { JA_3D } from '../i18n/ja.js';
import { makeCanvasTexture, PX_PER_MM } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';

/**
 * 装着部品（リレー／タイマ）の動作表示。設計仕様 §5.3.1 / §5.3.2 / §8.2。
 *
 * 利用者の要望（2026-09-19）「リレーやタイマは実際のように通電していたらランプがつくなど
 * 視覚的に分かるように」に応える部分。実物に寄せて次のように描き分ける:
 *
 * - リレー（MY4N 相当）: 天面の**動作表示窓**（8×12mm）。励磁中は橙〜赤に発光し、
 *   窓のまわりに柔らかいハロー（加算合成の板）と弱い点光源を足して、正面視・俯瞰視の
 *   どちらからでも「動いている」ことが分かるようにする。無励磁では暗いままにする。
 * - タイマ（H3Y-4 相当）: **2つのLED**。`POWER` は電源が入っているあいだ緑、
 *   `UP`（限時接点が動作した＝タイムアップ）は橙。実物と同じく設定ダイヤルも載せる。
 *
 * ここに置くメッシュはすべて飾りなので `raycast={noPick}`。装着部品の操作は
 * ソケット台座のクリック（`Socket.tsx`）のまま変えない。
 */

/** レイキャストを受けない（クリックを下のソケット台座へ通す）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 装着部品の本体の箱（`MountedPart` が盤定義から作る）。 */
export interface MountedBodyBox {
  /** 本体の中心（シーン座標）。 */
  center: [number, number, number];
  /** 本体の幅[mm]（シーンの X 方向）。 */
  width: number;
  /** 本体の奥行[mm]（シーンの Y 方向）。 */
  height: number;
  /** 本体の天面の高さ[mm]（盤面から）。 */
  topZ: number;
}

/** リレーの動作表示窓の大きさ[mm]（MY4N の窓に相当）。 */
export const RELAY_WINDOW_MM = { width: 8, height: 12 } as const;
/** タイマのLED 1個の大きさ[mm]。 */
export const TIMER_LED_MM = { width: 4, height: 5 } as const;
/** タイマのLEDの間隔[mm]。 */
const TIMER_LED_PITCH_MM = 11;
/** 表示器を本体の手前端から入れる量[mm]（正面視でも俯瞰視でも見える位置）。 */
const FRONT_INSET_MM = 9;
/** 表示器の座（黒い縁）が本体の天面から出る高さ[mm]。 */
const BEZEL_HEIGHT_MM = 1.2;
/** 発光面が座から出る量[mm]。 */
const LENS_LIFT_MM = 0.5;
/** ハローの板の大きさ（発光面に対する倍率）。 */
const HALO_SCALE = 2.6;
/** 点光源の強さ（`Lamp.tsx` の暗点灯より控えめ。部品の天面だけを照らす）。 */
const GLOW_LIGHT_INTENSITY = 320;
/** 点光源の届く距離[mm]。 */
const GLOW_LIGHT_DISTANCE_MM = 60;

/** 表示器の色（点灯／消灯）。 */
const RELAY_ON_COLOR = '#FF6A1E';
const RELAY_OFF_COLOR = '#4A1B10';
const POWER_ON_COLOR = '#37D05A';
const POWER_OFF_COLOR = '#12301C';
const OUT_ON_COLOR = '#FFB020';
const OUT_OFF_COLOR = '#3A2A0C';
const BEZEL_COLOR = '#15181C';
/** ダイヤルの色（つまみと指針）。 */
const DIAL_COLOR = '#D9D4C8';
const DIAL_POINTER_COLOR = '#1B1E23';

/** 設定ダイヤルの半径[mm]。 */
export const TIMER_DIAL_RADIUS_MM = 7;
/** 設定ダイヤルの振れ角[rad]（実物と同じく約270°）。 */
export const TIMER_DIAL_SWEEP_RAD = (270 * Math.PI) / 180;

const DIAL_GEOMETRY = new CylinderGeometry(TIMER_DIAL_RADIUS_MM, TIMER_DIAL_RADIUS_MM, 2, 24);

/** タイマのLEDの種別。 */
export type TimerLed = 'power' | 'out';

/** リレーの動作表示窓のマテリアル（励磁中だけ発光する）。 */
export function relayIndicatorMaterial(energized: boolean): MeshStandardMaterial {
  return energized
    ? sharedMaterial(RELAY_ON_COLOR, { emissive: RELAY_ON_COLOR, emissiveIntensity: 2.6 })
    : sharedMaterial(RELAY_OFF_COLOR, { roughness: 0.6 });
}

/** タイマのLED 1個のマテリアル。 */
export function timerLedMaterial(led: TimerLed, lit: boolean): MeshStandardMaterial {
  const onColor = led === 'power' ? POWER_ON_COLOR : OUT_ON_COLOR;
  const offColor = led === 'power' ? POWER_OFF_COLOR : OUT_OFF_COLOR;
  return lit
    ? sharedMaterial(onColor, { emissive: onColor, emissiveIntensity: 2.4 })
    : sharedMaterial(offColor, { roughness: 0.6 });
}

/**
 * タイマの2つのLEDの点灯状態。§5.3.2
 * `POWER` はコイルに電源が来ているあいだ（`TimerRuntime.powered`）、
 * `UP` は限時接点が動作したあと（`TimerRuntime.timedOut`）点く。
 */
export function timerLedStates(
  powered: boolean,
  timedOut: boolean,
): readonly { led: TimerLed; label: string; lit: boolean }[] {
  return [
    { led: 'power', label: JA_3D.timerPower, lit: powered },
    { led: 'out', label: JA_3D.timerOut, lit: timedOut },
  ];
}

/** 設定ダイヤルの指針の角度[rad]（0 = 盤の奥向き。時計まわりが増加）。 */
export function timerDialAngleRad(presetMs: number, rangeMaxMs: number): number {
  const max = Math.max(rangeMaxMs, TIMER_MIN_PRESET_MS);
  const span = max - TIMER_MIN_PRESET_MS;
  const ratio = span <= 0 ? 0 : Math.min(1, Math.max(0, (presetMs - TIMER_MIN_PRESET_MS) / span));
  return (ratio - 0.5) * TIMER_DIAL_SWEEP_RAD;
}

/** リレーの動作表示窓の中心（シーン座標）。正面視・俯瞰視のどちらからも見える手前寄り。 */
export function indicatorCenter(box: MountedBodyBox): [number, number, number] {
  return [
    box.center[0],
    box.center[1] - box.height / 2 + FRONT_INSET_MM,
    box.topZ + BEZEL_HEIGHT_MM + LENS_LIFT_MM,
  ];
}

/** タイマのLED 2個の中心（シーン座標）。 */
export function timerLedCenters(box: MountedBodyBox): [number, number, number][] {
  const [x, y, z] = indicatorCenter(box);
  return [
    [x - TIMER_LED_PITCH_MM / 2, y, z],
    [x + TIMER_LED_PITCH_MM / 2, y, z],
  ];
}

/** 設定ダイヤルの中心（シーン座標。表示器の奥側）。 */
export function timerDialCenter(box: MountedBodyBox): [number, number, number] {
  return [box.center[0], box.center[1] + box.height / 2 - TIMER_DIAL_RADIUS_MM - 3, box.topZ + 1];
}

/** ハローのテクスチャ（中心が白く外へ向かって透明になる円）。1枚だけ作って使い回す。§15 */
let haloTexture: Texture | undefined | null = null;

function sharedHaloTexture(): Texture | undefined {
  if (haloTexture !== null) return haloTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    haloTexture = undefined;
    return undefined;
  }
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  haloTexture = texture;
  return texture;
}

/** 発光のにじみ（加算合成の板）＋弱い点光源。消灯中は何も描かない。 */
function Glow({
  center,
  color,
  sizeMm,
}: {
  center: [number, number, number];
  color: string;
  sizeMm: number;
}): JSX.Element {
  const texture = sharedHaloTexture();
  return (
    <group name="indicator-glow">
      {texture === undefined ? null : (
        <mesh raycast={noPick} position={[center[0], center[1], center[2] + 0.6]}>
          <planeGeometry args={[sizeMm * HALO_SCALE, sizeMm * HALO_SCALE]} />
          <meshBasicMaterial
            map={texture}
            color={color}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      )}
      <pointLight
        color={color}
        intensity={GLOW_LIGHT_INTENSITY}
        distance={GLOW_LIGHT_DISTANCE_MM}
        position={[center[0], center[1], center[2] + 10]}
      />
    </group>
  );
}

/** 表示器の黒い座（発光面のまわりの縁）。 */
function Bezel({
  center,
  widthMm,
  heightMm,
  topZ,
}: {
  center: [number, number, number];
  widthMm: number;
  heightMm: number;
  topZ: number;
}): JSX.Element {
  return (
    <mesh
      geometry={UNIT_BOX}
      material={sharedMaterial(BEZEL_COLOR, { roughness: 0.7 })}
      raycast={noPick}
      position={[center[0], center[1], topZ + BEZEL_HEIGHT_MM / 2]}
      scale={[widthMm + 2, heightMm + 2, BEZEL_HEIGHT_MM]}
    />
  );
}

/** タイマの天面の印字（`POWER` / `UP`）。文字は固定なので本体の寸法ごとに1枚だけ作って使い回す。 */
const timerFaceTextures = new Map<string, Texture | undefined>();

function sharedTimerFaceTexture(widthMm: number, heightMm: number): Texture | undefined {
  const key = `${widthMm}x${heightMm}`;
  const cached = timerFaceTextures.get(key);
  if (cached !== undefined || timerFaceTextures.has(key)) return cached;
  const texture = makeCanvasTexture(widthMm, heightMm, (ctx) => {
    ctx.fillStyle = '#E8E4DA';
    ctx.font = `700 ${1.8 * PX_PER_MM}px sans-serif`;
    // LED の**手前**に呼び名を印字する（キャンバスの下＝盤の手前）
    const y = (heightMm - FRONT_INSET_MM + 4.6) * PX_PER_MM;
    ctx.fillText(JA_3D.timerPower, (widthMm / 2 - TIMER_LED_PITCH_MM / 2) * PX_PER_MM, y);
    ctx.fillText(JA_3D.timerOut, (widthMm / 2 + TIMER_LED_PITCH_MM / 2) * PX_PER_MM, y);
  });
  timerFaceTextures.set(key, texture);
  return texture;
}

/** リレーの動作表示（窓＋ハロー）。 */
function RelayIndicator({
  box,
  energized,
}: {
  box: MountedBodyBox;
  energized: boolean;
}): JSX.Element {
  const center = indicatorCenter(box);
  return (
    <group name="relay-indicator">
      <Bezel
        center={center}
        widthMm={RELAY_WINDOW_MM.width}
        heightMm={RELAY_WINDOW_MM.height}
        topZ={box.topZ}
      />
      <mesh
        geometry={UNIT_BOX}
        material={relayIndicatorMaterial(energized)}
        raycast={noPick}
        position={center}
        scale={[RELAY_WINDOW_MM.width, RELAY_WINDOW_MM.height, 1]}
      />
      {energized ? (
        <Glow center={center} color={RELAY_ON_COLOR} sizeMm={RELAY_WINDOW_MM.height} />
      ) : null}
    </group>
  );
}

/** タイマの動作表示（POWER / UP の2灯＋設定ダイヤル）。 */
function TimerIndicator({
  box,
  powered,
  timedOut,
  presetMs,
  rangeMaxMs,
}: {
  box: MountedBodyBox;
  powered: boolean;
  timedOut: boolean;
  presetMs: number;
  rangeMaxMs: number;
}): JSX.Element {
  const centers = timerLedCenters(box);
  const states = timerLedStates(powered, timedOut);
  const dial = timerDialCenter(box);
  const angle = timerDialAngleRad(presetMs, rangeMaxMs);
  const faceTexture = sharedTimerFaceTexture(box.width, box.height);
  return (
    <group name="timer-indicator">
      {faceTexture === undefined ? null : (
        <mesh raycast={noPick} position={[box.center[0], box.center[1], box.topZ + 0.3]}>
          <planeGeometry args={[box.width, box.height]} />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
      {states.map((state, index) => {
        const center = centers[index];
        if (center === undefined) return null;
        return (
          <group key={state.led} name={`timer-led-${state.led}`}>
            <Bezel
              center={center}
              widthMm={TIMER_LED_MM.width}
              heightMm={TIMER_LED_MM.height}
              topZ={box.topZ}
            />
            <mesh
              geometry={UNIT_BOX}
              material={timerLedMaterial(state.led, state.lit)}
              raycast={noPick}
              position={center}
              scale={[TIMER_LED_MM.width, TIMER_LED_MM.height, 1]}
            />
            {state.lit ? (
              <Glow
                center={center}
                color={state.led === 'power' ? POWER_ON_COLOR : OUT_ON_COLOR}
                sizeMm={TIMER_LED_MM.height}
              />
            ) : null}
          </group>
        );
      })}
      {/* 設定ダイヤル（実物の H3Y-4 と同じく天面のつまみ）。指針が設定秒を指す */}
      <mesh
        geometry={DIAL_GEOMETRY}
        material={sharedMaterial(DIAL_COLOR, { roughness: 0.5, metalness: 0.1 })}
        raycast={noPick}
        rotation={[Math.PI / 2, 0, 0]}
        position={dial}
      />
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(DIAL_POINTER_COLOR, { roughness: 0.6 })}
        raycast={noPick}
        rotation={[0, 0, -angle]}
        position={[
          dial[0] + Math.sin(angle) * TIMER_DIAL_RADIUS_MM * 0.5,
          dial[1] + Math.cos(angle) * TIMER_DIAL_RADIUS_MM * 0.5,
          dial[2] + 1.2,
        ]}
        scale={[1.2, TIMER_DIAL_RADIUS_MM * 0.8, 0.6]}
      />
    </group>
  );
}

/**
 * 装着部品の動作表示。リレーは窓、タイマは2灯＋ダイヤル。
 * `energized` はリレーのコイル励磁／タイマの通電、`timedOut` はタイマのタイムアップ。
 */
export function PartIndicator({
  kind,
  box,
  energized,
  timedOut,
  presetMs,
  rangeMaxMs,
}: {
  kind: 'relay-my4n' | 'timer-h3y4';
  box: MountedBodyBox;
  energized: boolean;
  timedOut: boolean;
  presetMs: number;
  rangeMaxMs: number;
}): JSX.Element {
  return kind === 'relay-my4n' ? (
    <RelayIndicator box={box} energized={energized} />
  ) : (
    <TimerIndicator
      box={box}
      powered={energized}
      timedOut={timedOut}
      presetMs={presetMs}
      rangeMaxMs={rangeMaxMs}
    />
  );
}
