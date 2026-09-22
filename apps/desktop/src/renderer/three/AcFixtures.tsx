import type { BoardTerminal, Footprint } from '@ojt/board-model';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useRef, type JSX } from 'react';
import type { Group, Texture } from 'three';
import { sharedHousing } from './ComponentDetails.js';
import { DIN_RAIL_COLOR } from '../session/colors.js';
import { JA_3D } from '../i18n/ja.js';
import { bakeSharedTexture, labelFont, makeCanvasTexture, PX_PER_MM } from './labels.js';
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
 * AC一次側は配線も測定もしない（`wirable: false`）ため、**飾りのメッシュは1つも
 * レイキャストを受けない**（`raycast={noPick}`）。クリックは下の盤面へ抜ける。
 *
 * **2026-09-20（Phase 7 Task 27・利用者要望9「3D図をクリックして電源をON/OFFしたり」）**:
 * 唯一の例外として**操作部**（ブレーカのハンドルとその窓／電源スイッチのロッカーとその窓）だけが
 * `raycast={noPick}` を外してクリックを受ける。押すと `onToggle(次の状態)` が飛び、呼び出し側が
 * `bridge.send({type:'breaker'|'switch', on})` を送る。手順違反（スイッチを先に入れる）は
 * **止めない**。実機では起こせる操作であり、エンジンが `power-sequence-violation` として
 * 危険操作に数える（§5.6 #5）。レバーの傾きは `LEVER_TWEEN_MS` で補間する。
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
const SHROUD_DROP_MM = 6;
/** ON / OFF の印字を可動部の縁から離す量[mm]。 */
const MARK_CLEARANCE_MM = 1.5;
/** ON / OFF の印字の文字高さ[mm]。 */
const MARK_MM = 2.4;
/** 銘板（緑のプレート）の定格表示の文字高さ[mm]。 */
const RATING_MM = 2.6;
/** 機器の外形から内側へ詰める量[mm]（ベース・本体の見切り）。 */
const BODY_INSET_MM = 2;
/** ハンドル／ロッカーの色（写真の濃いグレー）。 */
const HANDLE_COLOR = '#2B2F36';
/** ハンドル窓（凹み）の色（OFF・既定）。 */
const WELL_COLOR = '#17191D';
/**
 * ハンドル窓の色（ON）。実物のMCBのように状態で窓の色そのものを変える。
 * ハンドルの傾き（`BREAKER_HANDLE_TILT_RAD` / `SWITCH_ROCKER_TILT_RAD`）だけでは通常ズームでは
 * 見分けづらく、印字（ON/OFF）も両方常時見えたままなので、ON/OFF の判別材料が姿勢しか無かった
 * （今日のスクリーンショット確認 10/11・レビュー指摘・項目4）。
 */
const WELL_COLOR_ON = '#2E8B4F';

/** ハンドル窓の色。ONは緑、OFFは既定の暗い凹み色。 */
export function wellColorFor(on: boolean): string {
  return on ? WELL_COLOR_ON : WELL_COLOR;
}

/** 本体を横切る青のライン（写真）。 */
const STRIPE_COLOR = '#2F6FD0';
/** 極間の見切り（2極であることが分かる筋）。 */
const POLE_SEAM_MM = 1.2;
/**
 * 印字の板を本体の天面から浮かせる量[mm]。
 * `Fixtures.tsx` の端子印字の板（`LABEL_LIFT_MM` = 1.4）より下、かつ天面の化粧より上。
 */
const FACE_LIFT_MM = 0.5;

/**
 * ブレーカのハンドルの倒れ角[rad]（ON は盤の奥＝実物の「上」へ倒れる）。
 * 以前は20°しかなく、支点からの半長（高さ6mmの半分＝3mm）に掛けても1mm程度しか動かないため、
 * 通常ズームではON/OFFの姿勢の違いにほとんど気づけなかった（今日のスクリーンショット確認 10/11・
 * レビュー指摘・項目4）。はっきり見分けられる 25° を超える角度まで広げる。
 */
export const BREAKER_HANDLE_TILT_RAD = (32 * Math.PI) / 180;
/** ブレーカのハンドルの寸法[mm]（幅×奥行×高さ）。 */
export const BREAKER_HANDLE_MM = { width: 11, depth: 4.5, height: 9 } as const;
/** 電源スイッチのロッカーの倒れ角[rad]。ブレーカと同じ理由で 25° を超える角度まで広げる（項目4）。 */
export const SWITCH_ROCKER_TILT_RAD = (30 * Math.PI) / 180;
/** 電源スイッチのロッカーの寸法[mm]（幅×奥行×厚み）。 */
export const SWITCH_ROCKER_MM = { width: 12, depth: 12, height: 4 } as const;

/**
 * レバーが倒れきるまでの時間[ms]（Phase 7 設計 §7.3.2「レバーが倒れる（150ms）」）。
 * 瞬間的に角度が変わると「自分が押したから動いた」ことが読み取れないので、
 * 目で追える速さで倒す。倒れきる角度（`BREAKER_HANDLE_TILT_RAD` の2倍）をこの時間で割る。
 */
export const LEVER_TWEEN_MS = 150;

/**
 * 1フレームぶん角度を目標へ寄せる（純関数。補間の速さを単体テストで縛る）。
 *
 * `travelRad` は倒れきる角度の全幅で、この幅を `LEVER_TWEEN_MS` で渡りきる速さにする
 * （ブレーカとスイッチで角度が違っても、倒れきるまでの時間は同じになる）。
 */
export function stepRotation(from: number, to: number, dtMs: number, travelRad: number): number {
  const delta = to - from;
  if (delta === 0) return to;
  const step = (travelRad / LEVER_TWEEN_MS) * Math.max(0, dtMs);
  return Math.abs(delta) <= step ? to : from + Math.sign(delta) * step;
}

/**
 * `frameloop="demand"` では前のフレームからの間隔がいくらでも開くので、1フレームで
 * 使う時間はここで頭打ちにする（無操作で1秒空いた直後に押すと一瞬で倒れてしまう）。
 */
const MAX_FRAME_MS = 33;

/** 可動部の姿勢（シーン座標の位置＋X軸まわりの回転）。 */
export interface HingePose {
  position: [number, number, number];
  rotationX: number;
}

/**
 * 電源の操作部の当たり判定と入切（Phase 7 設計 §7.3.2）。
 * `onToggle` を渡さない（モードDの机上盤など）ときは従来どおり飾りのままになる。
 */
export interface PowerFixtureHandlers {
  /** 押された（引数は**次の**状態）。 */
  onToggle?: ((on: boolean) => void) | undefined;
  /** 操作部に入った／出た（ホバー予告とカーソルに使う）。 */
  onHover?: ((entered: boolean) => void) | undefined;
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

/** ブレーカのハンドルを**任意の角度**で置く（補間の途中も倒れきった姿も同じ式で出す）。 */
export function breakerHandlePoseAt(
  footprint: Footprint,
  rotationX: number,
  heightMm: number,
): HingePose {
  return hingePose(
    { x: footprint.x + handleCenterX(footprint), y: hingeY(footprint), z: heightMm - 1.5 },
    BREAKER_HANDLE_MM.height / 2,
    rotationX,
  );
}

/** ブレーカのハンドルの中心と傾き。ON / OFF で**位置も角度も**変わる。 */
export function breakerHandlePose(footprint: Footprint, on: boolean, heightMm: number): HingePose {
  return breakerHandlePoseAt(footprint, breakerHandleTilt(on), heightMm);
}

/** ブレーカのハンドルの倒れきった角度。 */
export function breakerHandleTilt(on: boolean): number {
  return on ? -BREAKER_HANDLE_TILT_RAD : BREAKER_HANDLE_TILT_RAD;
}

/** 電源スイッチのロッカーを任意の角度で置く。 */
export function switchRockerPoseAt(
  footprint: Footprint,
  rotationX: number,
  heightMm: number,
): HingePose {
  return hingePose(
    { x: centerOf(footprint).x, y: hingeY(footprint), z: heightMm - 1 },
    SWITCH_ROCKER_MM.height / 2,
    rotationX,
  );
}

/** 電源スイッチのロッカーの中心と傾き。 */
export function switchRockerPose(footprint: Footprint, on: boolean, heightMm: number): HingePose {
  return switchRockerPoseAt(footprint, switchRockerTilt(on), heightMm);
}

/** 電源スイッチのロッカーの倒れきった角度。 */
export function switchRockerTilt(on: boolean): number {
  return on ? -SWITCH_ROCKER_TILT_RAD : SWITCH_ROCKER_TILT_RAD;
}

/**
 * ブレーカのハンドルの中心の**機器内 x**[mm]。
 * 写真のとおりハンドルは片側へ寄っていて、空いた側に緑の銘板が載る。
 * 機器が細いときは中央に戻す（銘板はそのぶん描かれない）。
 */
function handleCenterX(footprint: Footprint): number {
  return Math.min(BODY_INSET_MM / 2 + BREAKER_HANDLE_MM.width / 2 + 1, footprint.w / 2);
}

/**
 * 操作部（ハンドル窓／ロッカー窓）の中心（盤ローカル mm）。Phase 7 Task 27。
 * E2E がここを `page.mouse` で押すので、**寸法の正本をこの1箇所にする**
 * （`e2e/direct-manipulation.spec.ts` が座標を書き写すと、機器の形を直したとたんに外れる）。
 */
export function powerWellCenterMm(
  footprint: Footprint,
  kind: 'breaker' | 'switch',
  heightMm: number,
): { x: number; y: number; z: number } {
  const center = centerOf(footprint);
  return {
    x: kind === 'breaker' ? footprint.x + handleCenterX(footprint) : center.x,
    y: hingeY(footprint),
    z: heightMm - 1,
  };
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

/*
 * 天面の印字テクスチャは文字が固定なので機器ごとに1枚だけ作って使い回す。§15 / 3D-13
 * 以前はこのファイルが**名前まで同じ**（焼いた絵の入れ物と、その取り出し関数）別の
 * キャッシュを持っていた。所有権の印（`isSharedFaceTexture()`）が無く、焼けなかった
 * `undefined` も永続的に覚え、テストの `clearFaceTextureCache()` の対象外だった。
 * `labels.ts` の実装に一本化し、鍵に `fixture:` の接頭辞を付ける。
 */

/** ブレーカの天面の印字（ON / OFF ＋ 緑の銘板）。 */
function breakerFaceTexture(footprint: Footprint): Texture | undefined {
  return bakeSharedTexture('fixture', `breaker:${footprint.w}x${footprint.h}`, () =>
    makeCanvasTexture(footprint.w, footprint.h, (ctx) => {
      const handleX = handleCenterX(footprint) * PX_PER_MM;
      const mark = markOffsetMm(BREAKER_HANDLE_MM.depth);
      // ON は奥（キャンバスの上）、OFF は手前。ハンドルはこの2つの印字のあいだで倒れる
      ctx.fillStyle = '#1B1E23';
      ctx.font = labelFont(MARK_MM);
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
      ctx.font = labelFont(RATING_MM);
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
  return bakeSharedTexture('fixture', `switch:${footprint.w}x${footprint.h}`, () =>
    makeCanvasTexture(footprint.w, footprint.h, (ctx) => {
      const mark = markOffsetMm(SWITCH_ROCKER_MM.depth);
      ctx.fillStyle = '#1B1E23';
      ctx.font = labelFont(MARK_MM);
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

/**
 * ポインタのハンドラ（操作部だけが持つ）。`onToggle` が無ければ空になり、
 * メッシュは `raycast={noPick}` の飾りに戻る（モードDの机上盤・スクリーンショット用途）。
 */
function powerHandlers(nextOn: boolean, handlers: PowerFixtureHandlers): Record<string, unknown> {
  const { onToggle, onHover } = handlers;
  if (onToggle === undefined) return { raycast: noPick };
  return {
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onToggle(nextOn);
    },
    ...(onHover === undefined
      ? {}
      : {
          onPointerOver: (event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            onHover(true);
          },
          onPointerOut: () => {
            onHover(false);
          },
        }),
  };
}

/**
 * 可動部（ブレーカのハンドル／電源スイッチのロッカー）。
 *
 * 角度は `LEVER_TWEEN_MS` かけて目標へ寄せる。React の状態にすると毎フレーム再描画に
 * なるので、`useFrame` の中で mesh を直接動かし、動いているあいだだけ `invalidate()` を
 * 要求する（`frameloop="demand"` を常時描画に変えない）。優先度は既定の0のまま
 * （Task 16: 0 より小さい優先度の `useFrame` を足さない）。
 */
export function PowerLever({
  name,
  poseAt,
  target,
  travelRad,
  scale,
  color,
  nextOn,
  handlers,
}: {
  name: string;
  /** 角度 → 可動部の姿勢。 */
  poseAt: (rotationX: number) => HingePose;
  /** 目標の角度[rad]。 */
  target: number;
  /** 倒れきる角度の全幅[rad]（補間の速さを決める）。 */
  travelRad: number;
  scale: [number, number, number];
  color: string;
  /** 押したときに渡す**次の**状態。 */
  nextOn: boolean;
  handlers: PowerFixtureHandlers;
}): JSX.Element {
  const mesh = useRef<Group | null>(null);
  const current = useRef(target);
  const invalidate = useThree((state) => state.invalidate);
  useFrame((_, delta) => {
    const node = mesh.current;
    if (node === null || current.current === target) return;
    const next = stepRotation(
      current.current,
      target,
      Math.min(delta * 1000, MAX_FRAME_MS),
      travelRad,
    );
    current.current = next;
    const pose = poseAt(next);
    node.position.set(pose.position[0], pose.position[1], pose.position[2]);
    node.rotation.x = next;
    // 倒れきるまで次のフレームを要求し続ける（倒れきったら要求が止まって描画も止まる）
    invalidate();
  });
  const pose = poseAt(current.current);
  const rocker = name === 'switch-rocker';
  const marking = rocker
    ? bakeSharedTexture('fixture', 'rocker-io-v2', () =>
        makeCanvasTexture(scale[0], scale[1], (ctx) => {
          ctx.fillStyle = '#fff';
          ctx.font = labelFont(3.5);
          ctx.fillText('I', (scale[0] / 2) * PX_PER_MM, 3 * PX_PER_MM);
          ctx.fillText('O', (scale[0] / 2) * PX_PER_MM, (scale[1] - 3) * PX_PER_MM);
        }),
      )
    : undefined;
  return (
    <group ref={mesh} name={name} position={pose.position} rotation={[current.current, 0, 0]}>
      <mesh
        geometry={sharedHousing(...scale)}
        material={sharedMaterial(rocker ? '#313a42' : color, { roughness: 0.36, metalness: 0.08 })}
        {...powerHandlers(nextOn, handlers)}
      />
      {rocker
        ? null
        : [-1.4, 0, 1.4].map((y) => (
            <mesh
              key={y}
              geometry={UNIT_BOX}
              position={[0, y, scale[2] / 2 + 0.15]}
              scale={[scale[0] - 1.2, 0.45, 0.3]}
              raycast={noPick}
              material={sharedMaterial('#5e666c', { roughness: 0.52 })}
            />
          ))}
      {marking === undefined ? null : (
        <mesh position={[0, 0, scale[2] / 2 + 0.03]} raycast={noPick}>
          <planeGeometry args={[scale[0], scale[1]]} />
          <meshBasicMaterial map={marking} transparent depthWrite={false} />
        </mesh>
      )}
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
  onToggle,
  onHover,
}: {
  footprint: Footprint;
  terminals: readonly BoardTerminal[];
  color: string;
  heightMm: number;
  on: boolean;
} & PowerFixtureHandlers): JSX.Element {
  const { x, y } = centerOf(footprint);
  const poleWidth = (footprint.w - BODY_INSET_MM - POLE_SEAM_MM) / 2;
  const poleOffset = (poleWidth + POLE_SEAM_MM) / 2;
  const bodyDepth = 16;
  const bodyZ = (BASE_TOP_MM + heightMm) / 2;
  const wellX = footprint.x + handleCenterX(footprint);
  const handlers: PowerFixtureHandlers = { onToggle, onHover };
  return (
    <group name="breaker-body">
      <SeatAndBase footprint={footprint} />
      {/* 2極ぶんの本体。あいだに見切りを残して「2P」であることを見せる */}
      {[-poleOffset, poleOffset].map((offset) => (
        <mesh
          key={offset}
          geometry={sharedHousing(poleWidth, bodyDepth, heightMm - BASE_TOP_MM)}
          material={sharedMaterial(color, { roughness: 0.58, metalness: 0.02 })}
          raycast={noPick}
          position={toScene({ x: x + offset, y, z: bodyZ })}
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
      {/*
        ハンドル窓（凹み）と連動ハンドル。窓の色は ON で緑に変わる（項目4）。
        **この2枚だけがクリックを受ける**（Phase 7 Task 27）。窓も操作部に含めるのは、
        倒れたハンドルは向こう側へ逃げるので、正面視では窓のほうが狙いやすいため。
      */}
      <mesh
        name="breaker-well"
        geometry={UNIT_BOX}
        material={sharedMaterial(wellColorFor(on), { roughness: 0.8 })}
        position={toScene({ x: wellX, y, z: heightMm - 1 })}
        scale={[BREAKER_HANDLE_MM.width + 2, BREAKER_HANDLE_MM.depth + 2, 1.6]}
        {...powerHandlers(!on, handlers)}
      />
      <PowerLever
        name="breaker-handle"
        poseAt={(rotationX) => breakerHandlePoseAt(footprint, rotationX, heightMm)}
        target={breakerHandleTilt(on)}
        travelRad={BREAKER_HANDLE_TILT_RAD * 2}
        scale={[BREAKER_HANDLE_MM.width, BREAKER_HANDLE_MM.depth, BREAKER_HANDLE_MM.height]}
        color={HANDLE_COLOR}
        nextOn={!on}
        handlers={handlers}
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
  onToggle,
  onHover,
}: {
  footprint: Footprint;
  terminals: readonly BoardTerminal[];
  color: string;
  heightMm: number;
  on: boolean;
} & PowerFixtureHandlers): JSX.Element {
  const { x, y } = centerOf(footprint);
  const handlers: PowerFixtureHandlers = { onToggle, onHover };
  return (
    <group name="switch-body">
      <SeatAndBase footprint={footprint} />
      <mesh
        geometry={sharedHousing(
          footprint.w - BODY_INSET_MM,
          footprint.h - BODY_INSET_MM,
          heightMm - BASE_TOP_MM,
        )}
        material={sharedMaterial(color, { roughness: 0.65, metalness: 0.03 })}
        raycast={noPick}
        position={toScene({ x, y, z: (BASE_TOP_MM + heightMm) / 2 })}
      />
      {/* ロッカーを受ける黒い枠（実物の操作窓）。窓の色は ON で緑に変わる（項目4）。
          窓とロッカーの2枚だけがクリックを受ける（Phase 7 Task 27） */}
      <mesh
        name="switch-well"
        geometry={UNIT_BOX}
        material={sharedMaterial(wellColorFor(on), { roughness: 0.8 })}
        position={toScene({ x, y, z: heightMm - 1 })}
        scale={[SWITCH_ROCKER_MM.width + 3, SWITCH_ROCKER_MM.depth + 3, 2]}
        {...powerHandlers(!on, handlers)}
      />
      <PowerLever
        name="switch-rocker"
        poseAt={(rotationX) => switchRockerPoseAt(footprint, rotationX, heightMm)}
        target={switchRockerTilt(on)}
        travelRad={SWITCH_ROCKER_TILT_RAD * 2}
        scale={[SWITCH_ROCKER_MM.width, SWITCH_ROCKER_MM.depth, SWITCH_ROCKER_MM.height]}
        color={HANDLE_COLOR}
        nextOn={!on}
        handlers={handlers}
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
