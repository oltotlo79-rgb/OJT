import {
  terminalBlockShape,
  TERMINAL_BLOCK_PAD_MM,
  type BoardTerminal,
  type TerminalBlockShape,
} from '@ojt/board-model';
import { Html } from '@react-three/drei';
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
import { TERMINAL_BLOCK_CAP_COLOR, TERMINAL_BLOCK_COLOR } from '../session/colors.js';
import {
  bakeSharedTexture,
  blockFaceTexture,
  labelFont,
  makeCanvasTexture,
  PX_PER_MM,
} from './labels.js';
import {
  applyInstanceMatrices,
  noPick,
  presetMaterial,
  SCREW_GEOMETRY,
  sharedMaterial,
  UNIT_BOX,
} from './materials.js';
import { toScene } from './coords.js';

/**
 * 端子台（ランプ用8P・押ボタン用12P・P/N供給端子）。設計仕様 §6.1 / §6.5。
 * 端子の座標は盤定義から取り、台座は端子の外接矩形から自動で作るのでハードコードしない。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/*
 * 仕切り板と両端の固定ねじ（v2.0.0 Task 7・設計 §3.5「形の作り込み」）。
 * 実物の端子台は端子ごとに樹脂の仕切りがあり、台座の両端を小ねじでレールに固定する。
 * 仕切りは端子台1個につき `instancedMesh` 1本（+1 ドローコール）、固定ねじは2個。
 * どちらも飾り（`raycast={noPick}`）で、端子の座標・配線の経路・当たり判定は変えない。
 */
/** 仕切り板の厚み[mm]。 */
export const DIVIDER_THICKNESS_MM = 0.6;
/** 仕切り板が台座の天面から出る高さ[mm]（印字の板 `printZ` より下に収める）。 */
export const DIVIDER_RISE_MM = 2;
/** 固定ねじの中心を台座の端から入れる量[mm]と、ネジ頭の縮尺（端の端子の座金と重ならない）。 */
export const END_SCREW_INSET_MM = 1.7;
export const END_SCREW_SCALE = 0.75;
/** 仕切り板の色（台座より少し明るい黒い樹脂）。 */
const DIVIDER_COLOR = '#3B4047';
/** 固定ねじの色（ニッケルめっき）。 */
const END_SCREW_COLOR = '#C9CED6';

/** 端子の並ぶ向き（横一列なら x、縦一列の P/N なら y）。 */
export function terminalBlockAxis(terminals: readonly BoardTerminal[]): 'x' | 'y' {
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  return spanX >= spanY ? 'x' : 'y';
}

/**
 * 隣り合う端子のあいだの仕切り板の中心（盤モデル mm）。純関数（個数と位置を単体テストで縛る）。
 * 同じ位置に重なる端子（距離 1mm 未満）のあいだには置かない。
 */
export function terminalBlockDividers(
  terminals: readonly BoardTerminal[],
  shape: Pick<TerminalBlockShape, 'cx' | 'cy'>,
): { x: number; y: number; along: 'x' | 'y' }[] {
  const along = terminalBlockAxis(terminals);
  const sorted = [...terminals].sort((a, b) =>
    along === 'x' ? a.pos.x - b.pos.x : a.pos.y - b.pos.y,
  );
  const out: { x: number; y: number; along: 'x' | 'y' }[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const gap = along === 'x' ? b.pos.x - a.pos.x : b.pos.y - a.pos.y;
    if (gap < 1) continue;
    out.push(
      along === 'x'
        ? { x: (a.pos.x + b.pos.x) / 2, y: shape.cy, along }
        : { x: shape.cx, y: (a.pos.y + b.pos.y) / 2, along },
    );
  }
  return out;
}

/** 両端の固定ねじの中心（盤モデル mm）。端子の並ぶ向きの両端。 */
export function terminalBlockEndScrews(
  terminals: readonly BoardTerminal[],
  shape: Pick<TerminalBlockShape, 'x' | 'y' | 'w' | 'h' | 'cx' | 'cy'>,
): { x: number; y: number }[] {
  return terminalBlockAxis(terminals) === 'x'
    ? [
        { x: shape.x + END_SCREW_INSET_MM, y: shape.cy },
        { x: shape.x + shape.w - END_SCREW_INSET_MM, y: shape.cy },
      ]
    : [
        { x: shape.cx, y: shape.y + END_SCREW_INSET_MM },
        { x: shape.cx, y: shape.y + shape.h - END_SCREW_INSET_MM },
      ];
}

/** 仕切り板（`instancedMesh` 1本）。 */
function Dividers({
  terminals,
  shape,
}: {
  terminals: readonly BoardTerminal[];
  shape: TerminalBlockShape;
}): JSX.Element | null {
  const mesh = useRef<InstancedMesh | null>(null);
  const matrices = useMemo(() => {
    const height = shape.bodyTop + DIVIDER_RISE_MM;
    return terminalBlockDividers(terminals, shape).map((divider) =>
      new Matrix4().compose(
        new Vector3(...toScene({ x: divider.x, y: divider.y, z: height / 2 })),
        new Quaternion(),
        divider.along === 'x'
          ? new Vector3(DIVIDER_THICKNESS_MM, shape.h - 1, height)
          : new Vector3(shape.w - 1, DIVIDER_THICKNESS_MM, height),
      ),
    );
  }, [terminals, shape]);
  useEffect(() => {
    applyInstanceMatrices(mesh.current, matrices);
  }, [matrices]);
  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      name="block-dividers"
      args={[UNIT_BOX, presetMaterial('blackResin', DIVIDER_COLOR), matrices.length]}
      raycast={noPick}
    />
  );
}

/** 端子台1個（台座＋端子＋ラベル）。 */
export function TerminalBlock({
  name,
  label,
  labelOffsetMm,
  terminals,
}: {
  name: string;
  label: string;
  /**
   * 名札を置く位置（端子の外接矩形の中心からの盤モデル mm。+x は右、+y は手前）。
   * 省略すると台座の奥側に置く。P/N 供給端子台だけは奥に DC24V電源の名札と
   * 左上の状態オーバーレイが居るので、右斜め下へずらして重なりを避ける（レビュー指摘）。
   */
  labelOffsetMm?: { x: number; y: number };
  /**
   * この端子台の端子（台座の外接矩形と印字テクスチャに使う）。
   * **端子そのものは描かない**（`TerminalField` が盤の端子をまとめて1回で描く。決定表#13）。
   */
  terminals: readonly BoardTerminal[];
}): JSX.Element | null {
  // 印字は端子台1個につきテクスチャ1枚にまとめる（labels.ts の方針）
  const faceTexture = useMemo(
    () => blockFaceTexture(terminals, TERMINAL_BLOCK_PAD_MM),
    [terminals],
  );
  const shape = useMemo(() => terminalBlockShape(terminals), [terminals]);
  const printedName = name.startsWith('TB_PL') || name.startsWith('TB_PB');
  const nameTexture = useMemo(() => {
    if (!printedName || shape === undefined) return undefined;
    return bakeSharedTexture('block', `name:${label}:${shape.w}`, () =>
      makeCanvasTexture(shape.w, shape.cap.h, (ctx) => {
        ctx.font = labelFont(2.8);
        ctx.fillStyle = '#F2F2EE';
        ctx.fillText(label, (shape.w / 2) * PX_PER_MM, (shape.cap.h / 2) * PX_PER_MM);
      }),
    );
  }, [label, printedName, shape]);
  if (shape === undefined) return null;
  const center = toScene({ x: shape.cx, y: shape.cy, z: shape.bodyTop / 2 });
  return (
    <group name={`block-${name}`}>
      <mesh
        name={`block-body-${name}`}
        geometry={UNIT_BOX}
        raycast={noPick}
        material={presetMaterial('blackResin', TERMINAL_BLOCK_COLOR)}
        position={center}
        scale={[shape.w, shape.h, shape.bodyTop]}
      />
      {/* 端子ごとの仕切り板と両端の固定ねじ（飾り）。v2.0.0 Task 7 */}
      <Dividers terminals={terminals} shape={shape} />
      {terminalBlockEndScrews(terminals, shape).map((screw, index) => (
        <mesh
          key={`end-screw-${String(index)}`}
          name={`block-end-screw-${name}-${String(index)}`}
          geometry={SCREW_GEOMETRY}
          material={presetMaterial('nickel', END_SCREW_COLOR)}
          raycast={noPick}
          rotation={[Math.PI / 2, 0, 0]}
          position={toScene({ x: screw.x, y: screw.y, z: shape.bodyTop + 0.7 * END_SCREW_SCALE })}
          scale={END_SCREW_SCALE}
        />
      ))}
      {/* 端子の名前の印字（常時表示）。§6.4 */}
      {faceTexture === undefined ? null : (
        <mesh raycast={noPick} position={[center[0], center[1], shape.printZ]}>
          <planeGeometry args={[shape.w, shape.h]} />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
      {/* 端子台の奥側の黒いカバー（実物の見た目） */}
      <mesh
        name={`block-cap-${name}`}
        geometry={UNIT_BOX}
        raycast={noPick}
        material={sharedMaterial(TERMINAL_BLOCK_CAP_COLOR, { roughness: 0.6 })}
        position={toScene({ x: shape.cx, y: shape.cap.y + shape.cap.h / 2, z: shape.cap.top / 2 })}
        scale={[shape.cap.w, shape.cap.h, shape.cap.top]}
      />
      {/* 3Dの銘板なら手前の配線を深度で正しく見せられる。DOMの名札で接続部を覆わない。 */}
      {nameTexture === undefined ? null : (
        <mesh
          name={`block-name-${name}`}
          raycast={noPick}
          position={toScene({
            x: shape.cx,
            y: shape.cap.y + shape.cap.h / 2,
            z: shape.cap.top + 0.05,
          })}
        >
          <planeGeometry args={[shape.w, shape.cap.h]} />
          <meshBasicMaterial map={nameTexture} transparent depthWrite={false} />
        </mesh>
      )}
      {printedName ? null : (
        <Html
          center
          style={LABEL_STYLE}
          distanceFactor={320}
          position={
            labelOffsetMm === undefined
              ? [center[0], center[1] + shape.h / 2 + 4, shape.printZ]
              : // `toScene()` は盤モデルの y を反転するので、手前（+y）はシーンの −Y になる
                [center[0] + labelOffsetMm.x, center[1] - labelOffsetMm.y, shape.printZ]
          }
          zIndexRange={[10, 0]}
        >
          <span className="block-label" data-label-rank={4}>
            {label}
          </span>
        </Html>
      )}
    </group>
  );
}
