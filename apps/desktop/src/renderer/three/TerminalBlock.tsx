import { terminalBlockShape, TERMINAL_BLOCK_PAD_MM, type BoardTerminal } from '@ojt/board-model';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import { TERMINAL_BLOCK_CAP_COLOR, TERMINAL_BLOCK_COLOR } from '../session/colors.js';
import {
  bakeSharedTexture,
  blockFaceTexture,
  labelFont,
  makeCanvasTexture,
  PX_PER_MM,
} from './labels.js';
import { noPick, sharedMaterial, UNIT_BOX } from './materials.js';
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
        material={sharedMaterial(TERMINAL_BLOCK_COLOR, { roughness: 0.7 })}
        position={center}
        scale={[shape.w, shape.h, shape.bodyTop]}
      />
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
