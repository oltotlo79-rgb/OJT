import type { BoardTerminal, Footprint } from '@ojt/board-model';
import type { JSX } from 'react';
import type { Texture } from 'three';
import { DIN_RAIL_COLOR } from '../session/colors.js';
import { JA_3D } from '../i18n/ja.js';
import { makeCanvasTexture, PX_PER_MM } from './labels.js';
import { SCREW_GEOMETRY, sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';

/**
 * AC一次側の機器（ブレーカ・電源スイッチ）の3D。設計仕様 §6.1 / §6.5 / §12.2。
 *
 * 実物写真（`docs/reference/K96-CS3-board-photo.png` の右上）に合わせて作る:
 * 明るいグレーの本体、端に寄った**濃いグレーのハンドル**、その脇の**緑の銘板**、
 * 本体を横切る**青のライン**、前後のネジ端子カバーと黒いベース、DINレールの座。
 * 写真は 654×552px しかなく銘板の文字は判読できないので、定格の文字は §6.1 の
 * 「ブレーカ 1個・1A・AC一次側」から起こす（`JA_3D.breakerRating`）。
 *
 * 外形は盤定義の `footprint`、ネジ端子カバーの位置は `board.terminals` の `pos` から取るので、
 * 盤定義（`board-jipm.ts`）の寸法・端子位置は一切変えずに見た目だけを作り込む。
 * AC一次側は配線も測定もしない（`wirable: false`）ため、**この中のメッシュは1つも
 * レイキャストを受けない**（`raycast={noPick}`）。クリックは下の盤面へ抜ける。
 */

/** レイキャストを受けない（クリックを下の盤面へ通す）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** DINレール座の高さ[mm]（実物はレールに嵌っている）。 */
const SEAT_HEIGHT_MM = 3;
/** レールに噛む黒いベースの天面[mm]。 */
const BASE_TOP_MM = 6.5;
/** ベースの色。 */
const BASE_COLOR = '#31353B';
/** ネジ端子カバーの色（本体より濃いグレー）。 */
const SHROUD_COLOR = '#2A2D33';
/**
 * ネジ端子カバーの奥行[mm]（端子1個ぶん）。
 * 端子（盤モデルでは前後に16mm離れている）のあいだに可動部と ON/OFF の印字が収まるよう、
 * カバーは端子1個を覆うぶんだけに絞る。
 */
const SHROUD_DEPTH_MM = 5;
/** ネジ端子カバーの天面を本体の天面より下げる量[mm]（ハンドル帯を高く見せる）。 */
const SHROUD_DROP_MM = 1.2;
/** ON / OFF の印字を可動部の縁から離す量[mm]。 */
const MARK_CLEARANCE_MM = 1.5;
/** ON / OFF の印字の文字高さ[mm]。 */
const MARK_MM = 1.6;
/** 機器の外形から内側へ詰める量[mm]（ベース・本体の見切り）。 */
const BODY_INSET_MM = 2;
/** ハンドル／ロッカーの色（写真の濃いグレー）。 */
const HANDLE_COLOR = '#2B2F36';
/** ハンドル窓（凹み）の色。 */
const WELL_COLOR = '#17191D';
/** 本体を横切る青のライン（写真）。 */
const STRIPE_COLOR = '#2F6FD0';
/** 極間の見切り（2極であることが分かる筋）。 */
const POLE_SEAM_MM = 1.2;
/**
 * 印字の板を本体の天面から浮かせる量[mm]。
 * `Fixtures.tsx` の端子印字の板（`LABEL_LIFT_MM` = 1.4）より下、かつ天面の化粧より上。
 */
const FACE_LIFT_MM = 0.5;

/** ブレーカのハンドルの倒れ角[rad]（ON は盤の奥＝実物の「上」へ倒れる）。 */
export const BREAKER_HANDLE_TILT_RAD = (20 * Math.PI) / 180;
/** ブレーカのハンドルの寸法[mm]（幅×奥行×高さ）。 */
export const BREAKER_HANDLE_MM = { width: 13, depth: 4.5, height: 6 } as const;
/** 電源スイッチのロッカーの倒れ角[rad]。 */
export const SWITCH_ROCKER_TILT_RAD = (14 * Math.PI) / 180;
/** 電源スイッチのロッカーの寸法[mm]（幅×奥行×厚み）。 */
export const SWITCH_ROCKER_MM = { width: 13, depth: 6, height: 3.5 } as const;

/** 可動部の姿勢（シーン座標の位置＋X軸まわりの回転）。 */
export interface HingePose {
  position: [number, number, number];
  rotationX: number;
}

/**
 * 支点 `pivot`（盤モデル mm）で X 軸まわりに `rotationX` だけ倒した可動部の中心。
 *
 * シーン座標では盤モデルの y（手前が大きい）が反転するので、`rotationX < 0` で
 * 可動部の頭は**盤の奥**（＝実物のブレーカの「上」＝ON側）へ向く。
 */
function hingePose(
  pivot: { x: number; y: number; z: number },
  halfLengthMm: number,
  rotationX: number,
): HingePose {
  const [x, y, z] = toScene(pivot);
  return {
    position: [x, y - halfLengthMm * Math.sin(rotationX), z + halfLengthMm * Math.cos(rotationX)],
    rotationX,
  };
}

/** 機器の中心（盤モデル mm）。 */
function centerOf(footprint: Footprint): { x: number; y: number } {
  return { x: footprint.x + footprint.w / 2, y: footprint.y + footprint.h / 2 };
}

/**
 * ハンドル／ロッカーの支点の奥行[mm]（機器の中心）。
 * ネジ端子は前後の端（`SHROUD_DEPTH_MM`）に寄っているので、可動部は必ずその間に収まる。
 */
function hingeY(footprint: Footprint): number {
  return centerOf(footprint).y;
}

/** ブレーカのハンドルの中心と傾き。ON / OFF で**位置も角度も**変わる。 */
export function breakerHandlePose(footprint: Footprint, on: boolean, heightMm: number): HingePose {
  const rotationX = on ? -BREAKER_HANDLE_TILT_RAD : BREAKER_HANDLE_TILT_RAD;
  return hingePose(
    { x: footprint.x + handleCenterX(footprint), y: hingeY(footprint), z: heightMm - 1.5 },
    BREAKER_HANDLE_MM.height / 2,
    rotationX,
  );
}

/** 電源スイッチのロッカーの中心と傾き。 */
export function switchRockerPose(footprint: Footprint, on: boolean, heightMm: number): HingePose {
  const rotationX = on ? -SWITCH_ROCKER_TILT_RAD : SWITCH_ROCKER_TILT_RAD;
  return hingePose(
    { x: centerOf(footprint).x, y: hingeY(footprint), z: heightMm - 1 },
    SWITCH_ROCKER_MM.height / 2,
    rotationX,
  );
}

/**
 * ブレーカのハンドルの中心の**機器内 x**[mm]。
 * 写真のとおりハンドルは片側へ寄っていて、空いた側に緑の銘板が載る。
 * 機器が細いときは中央に戻す（銘板はそのぶん描かれない）。
 */
function handleCenterX(footprint: Footprint): number {
  return Math.min(BODY_INSET_MM / 2 + BREAKER_HANDLE_MM.width / 2 + 1, footprint.w / 2);
}

/** ON / OFF の印字の奥行位置（機器の中心からの距離[mm]）。可動部の縁の外へ出す。 */
function markOffsetMm(movableDepthMm: number): number {
  return movableDepthMm / 2 + MARK_CLEARANCE_MM;
}

/** 銘板（緑のプレート）の機器内の矩形[mm]。ハンドルの隣の空きに置く。 */
function ratingPlateRect(footprint: Footprint): { x: number; y: number; w: number; h: number } {
  const x = handleCenterX(footprint) + BREAKER_HANDLE_MM.width / 2 + 1.5;
  return {
    x,
    y: footprint.h / 2 - 4.5,
    w: Math.max(0, footprint.w - BODY_INSET_MM / 2 - 1 - x),
    h: 9,
  };
}

/** 天面の印字テクスチャは文字が固定なので機器ごとに1枚だけ作って使い回す。§15 */
const faceTextureCache = new Map<string, Texture | undefined>();

function cachedFaceTexture(key: string, make: () => Texture | undefined): Texture | undefined {
  if (faceTextureCache.has(key)) return faceTextureCache.get(key);
  const texture = make();
  faceTextureCache.set(key, texture);
  return texture;
}

/** ブレーカの天面の印字（ON / OFF ＋ 緑の銘板）。 */
function breakerFaceTexture(footprint: Footprint): Texture | undefined {
  return cachedFaceTexture(`breaker:${footprint.w}x${footprint.h}`, () =>
    makeCanvasTexture(footprint.w, footprint.h, (ctx) => {
      const handleX = handleCenterX(footprint) * PX_PER_MM;
      const mark = markOffsetMm(BREAKER_HANDLE_MM.depth);
      // ON は奥（キャンバスの上）、OFF は手前。ハンドルはこの2つの印字のあいだで倒れる
      ctx.fillStyle = '#1B1E23';
      ctx.font = `700 ${MARK_MM * PX_PER_MM}px sans-serif`;
      ctx.fillText(JA_3D.on, handleX, (footprint.h / 2 - mark) * PX_PER_MM);
      ctx.fillText(JA_3D.off, handleX, (footprint.h / 2 + mark) * PX_PER_MM);
      // 銘板（写真の緑のプレート）。定格は §6.1 の「1A・AC一次側」から
      const plate = ratingPlateRect(footprint);
      if (plate.w < 4) return;
      ctx.fillStyle = '#17693F';
      ctx.fillRect(
        plate.x * PX_PER_MM,
        plate.y * PX_PER_MM,
        plate.w * PX_PER_MM,
        plate.h * PX_PER_MM,
      );
      ctx.fillStyle = '#F3F6F2';
      ctx.font = `700 ${2.6 * PX_PER_MM}px sans-serif`;
      const lines = JA_3D.breakerRating.split(' ');
      const centerX = (plate.x + plate.w / 2) * PX_PER_MM;
      lines.forEach((line, index) => {
        const y = (plate.y + plate.h / 2 + (index - (lines.length - 1) / 2) * 3.2) * PX_PER_MM;
        ctx.fillText(line, centerX, y);
      });
    }),
  );
}

/** 電源スイッチの天面の印字（ON / OFF）。 */
function switchFaceTexture(footprint: Footprint): Texture | undefined {
  return cachedFaceTexture(`switch:${footprint.w}x${footprint.h}`, () =>
    makeCanvasTexture(footprint.w, footprint.h, (ctx) => {
      const mark = markOffsetMm(SWITCH_ROCKER_MM.depth);
      ctx.fillStyle = '#1B1E23';
      ctx.font = `700 ${MARK_MM * PX_PER_MM}px sans-serif`;
      ctx.fillText(JA_3D.on, (footprint.w / 2) * PX_PER_MM, (footprint.h / 2 - mark) * PX_PER_MM);
      ctx.fillText(JA_3D.off, (footprint.w / 2) * PX_PER_MM, (footprint.h / 2 + mark) * PX_PER_MM);
    }),
  );
}

/** 天面の印字の板（透明。文字と銘板だけが見える）。 */
function FacePlate({
  footprint,
  texture,
  heightMm,
}: {
  footprint: Footprint;
  texture: Texture | undefined;
  heightMm: number;
}): JSX.Element | null {
  if (texture === undefined) return null;
  const { x, y } = centerOf(footprint);
  return (
    <mesh raycast={noPick} position={toScene({ x, y, z: heightMm + FACE_LIFT_MM })}>
      <planeGeometry args={[footprint.w, footprint.h]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** ネジ端子カバー1枚（端子1個ぶん）＋ネジ頭。実物の端子は必ずカバーの下にある。 */
function ScrewShroud({
  footprint,
  terminal,
  screwOffsetsMm,
  heightMm,
}: {
  footprint: Footprint;
  terminal: BoardTerminal;
  screwOffsetsMm: readonly number[];
  heightMm: number;
}): JSX.Element {
  const topZ = heightMm - SHROUD_DROP_MM;
  const { x } = centerOf(footprint);
  return (
    <group name={`shroud-${terminal.id}`}>
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(SHROUD_COLOR, { roughness: 0.55, metalness: 0.2 })}
        raycast={noPick}
        position={toScene({ x, y: terminal.pos.y, z: (BASE_TOP_MM + topZ) / 2 })}
        scale={[footprint.w - BODY_INSET_MM, SHROUD_DEPTH_MM, topZ - BASE_TOP_MM]}
      />
      {screwOffsetsMm.map((offset) => (
        <mesh
          key={offset}
          geometry={SCREW_GEOMETRY}
          material={sharedMaterial('#9AA0A6', { metalness: 0.7, roughness: 0.3 })}
          raycast={noPick}
          rotation={[Math.PI / 2, 0, 0]}
          position={toScene({ x: x + offset, y: terminal.pos.y, z: topZ + 0.4 })}
        />
      ))}
    </group>
  );
}

/** レールの座＋黒いベース（両機器で共通の足回り）。 */
function SeatAndBase({ footprint }: { footprint: Footprint }): JSX.Element {
  const { x, y } = centerOf(footprint);
  return (
    <>
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(DIN_RAIL_COLOR, { metalness: 0.75, roughness: 0.35 })}
        raycast={noPick}
        position={toScene({ x, y, z: SEAT_HEIGHT_MM / 2 })}
        scale={[footprint.w, footprint.h, SEAT_HEIGHT_MM]}
      />
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(BASE_COLOR, { roughness: 0.6, metalness: 0.2 })}
        raycast={noPick}
        position={toScene({ x, y, z: (SEAT_HEIGHT_MM + BASE_TOP_MM) / 2 })}
        scale={[
          footprint.w - BODY_INSET_MM / 2,
          footprint.h - BODY_INSET_MM / 2,
          BASE_TOP_MM - SEAT_HEIGHT_MM,
        ]}
      />
    </>
  );
}

/**
 * ブレーカ（2極MCB）。§6.1
 * 2つの極の本体＋極間の見切り＋ハンドル窓＋連動ハンドル＋銘板＋前後のネジ端子カバー。
 * ハンドルは `on`（`SimSnapshot.breakerOn`）で倒れる向きが変わる。
 */
export function Breaker({
  footprint,
  terminals,
  color,
  heightMm,
  on,
}: {
  footprint: Footprint;
  terminals: readonly BoardTerminal[];
  color: string;
  heightMm: number;
  on: boolean;
}): JSX.Element {
  const { x, y } = centerOf(footprint);
  const poleWidth = (footprint.w - BODY_INSET_MM - POLE_SEAM_MM) / 2;
  const poleOffset = (poleWidth + POLE_SEAM_MM) / 2;
  const bodyDepth = footprint.h - BODY_INSET_MM;
  const bodyZ = (BASE_TOP_MM + heightMm) / 2;
  const handle = breakerHandlePose(footprint, on, heightMm);
  const wellX = footprint.x + handleCenterX(footprint);
  return (
    <group name="breaker-body">
      <SeatAndBase footprint={footprint} />
      {/* 2極ぶんの本体。あいだに見切りを残して「2P」であることを見せる */}
      {[-poleOffset, poleOffset].map((offset) => (
        <mesh
          key={offset}
          geometry={UNIT_BOX}
          material={sharedMaterial(color, { roughness: 0.55, metalness: 0.1 })}
          raycast={noPick}
          position={toScene({ x: x + offset, y, z: bodyZ })}
          scale={[poleWidth, bodyDepth, heightMm - BASE_TOP_MM]}
        />
      ))}
      {/* 写真の青いライン（本体を横切る化粧）。ハンドル窓と手前のカバーのあいだに入れる */}
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(STRIPE_COLOR, { roughness: 0.4, metalness: 0.1 })}
        raycast={noPick}
        position={toScene({
          x,
          y: y + markOffsetMm(BREAKER_HANDLE_MM.depth) + MARK_MM,
          z: heightMm,
        })}
        scale={[footprint.w - BODY_INSET_MM, 0.9, 0.6]}
      />
      {/* ハンドル窓（凹み）と連動ハンドル */}
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(WELL_COLOR, { roughness: 0.8 })}
        raycast={noPick}
        position={toScene({ x: wellX, y, z: heightMm - 1 })}
        scale={[BREAKER_HANDLE_MM.width + 2, BREAKER_HANDLE_MM.depth + 2, 1.6]}
      />
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(HANDLE_COLOR, { roughness: 0.45, metalness: 0.15 })}
        raycast={noPick}
        position={handle.position}
        rotation={[handle.rotationX, 0, 0]}
        scale={[BREAKER_HANDLE_MM.width, BREAKER_HANDLE_MM.depth, BREAKER_HANDLE_MM.height]}
      />
      {terminals.map((terminal) => (
        <ScrewShroud
          key={terminal.id}
          footprint={footprint}
          terminal={terminal}
          screwOffsetsMm={[-poleOffset, poleOffset]}
          heightMm={heightMm}
        />
      ))}
      <FacePlate
        footprint={footprint}
        texture={breakerFaceTexture(footprint)}
        heightMm={heightMm}
      />
    </group>
  );
}

/**
 * 電源スイッチ（写真のロッカー型）。§6.1
 * 枠（ベゼル）＋シーソーのロッカー＋前後のネジ端子カバー。
 * ロッカーは `on`（`SimSnapshot.switchOn`）で倒れる向きが変わる。
 */
export function PowerSwitch({
  footprint,
  terminals,
  color,
  heightMm,
  on,
}: {
  footprint: Footprint;
  terminals: readonly BoardTerminal[];
  color: string;
  heightMm: number;
  on: boolean;
}): JSX.Element {
  const { x, y } = centerOf(footprint);
  const rocker = switchRockerPose(footprint, on, heightMm);
  return (
    <group name="switch-body">
      <SeatAndBase footprint={footprint} />
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(color, { roughness: 0.55, metalness: 0.1 })}
        raycast={noPick}
        position={toScene({ x, y, z: (BASE_TOP_MM + heightMm) / 2 })}
        scale={[footprint.w - BODY_INSET_MM, footprint.h - BODY_INSET_MM, heightMm - BASE_TOP_MM]}
      />
      {/* ロッカーを受ける黒い枠（実物の操作窓） */}
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(WELL_COLOR, { roughness: 0.8 })}
        raycast={noPick}
        position={toScene({ x, y, z: heightMm - 1 })}
        scale={[SWITCH_ROCKER_MM.width + 2.5, SWITCH_ROCKER_MM.depth + 2, 1.6]}
      />
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(HANDLE_COLOR, { roughness: 0.4, metalness: 0.15 })}
        raycast={noPick}
        position={rocker.position}
        rotation={[rocker.rotationX, 0, 0]}
        scale={[SWITCH_ROCKER_MM.width, SWITCH_ROCKER_MM.depth, SWITCH_ROCKER_MM.height]}
      />
      {terminals.map((terminal) => (
        <ScrewShroud
          key={terminal.id}
          footprint={footprint}
          terminal={terminal}
          screwOffsetsMm={[-4, 4]}
          heightMm={heightMm}
        />
      ))}
      <FacePlate footprint={footprint} texture={switchFaceTexture(footprint)} heightMm={heightMm} />
    </group>
  );
}
