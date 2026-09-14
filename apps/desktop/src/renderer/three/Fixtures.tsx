import type { BoardTerminal } from '@ojt/board-model';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import { BREAKER_COLOR, SUPPLY_BLOCK_COLOR } from '../session/colors.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';

/**
 * 盤に固定された機器（DC24V電源・ブレーカ・電源スイッチ）。設計仕様 §6.1 / §6.5。
 * 実物写真では上段左に DC24V の端子台、上段右にブレーカが載る。
 * いずれも訓練者は配線できない（`wirable: false`）ので、当たり判定は持たせず見た目だけ描く。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** 機器の高さ[mm]。 */
const FIXTURE_HEIGHT_MM = 22;
/** 端子の外接矩形からの余白[mm]。 */
const FIXTURE_PAD_MM = 9;

/** レイキャストを受けない。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 固定機器1台（端子の外接矩形から箱を作る）。 */
export function Fixture({
  name,
  label,
  color,
  terminals,
}: {
  name: string;
  label: string;
  color: string;
  terminals: readonly BoardTerminal[];
}): JSX.Element | null {
  if (terminals.length === 0) return null;
  const xs = terminals.map((t) => t.pos.x);
  const ys = terminals.map((t) => t.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const center = toScene({
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: FIXTURE_HEIGHT_MM / 2,
  });
  return (
    <group name={`fixture-${name}`}>
      <mesh
        geometry={UNIT_BOX}
        material={sharedMaterial(color, { roughness: 0.6, metalness: 0.15 })}
        raycast={noPick}
        position={center}
        scale={[
          maxX - minX + FIXTURE_PAD_MM * 2,
          maxY - minY + FIXTURE_PAD_MM * 2,
          FIXTURE_HEIGHT_MM,
        ]}
      />
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={320}
        position={[center[0], center[1], FIXTURE_HEIGHT_MM + 1]}
        zIndexRange={[10, 0]}
      >
        <span className="block-label">{label}</span>
      </Html>
    </group>
  );
}

/** 盤の固定機器（電源・ブレーカ・電源スイッチ）の定義。§6.4 の部品ID順。 */
export const FIXTURES: ReadonlyArray<{ id: string; label: string; color: string }> = [
  { id: 'PS', label: 'DC24V電源', color: SUPPLY_BLOCK_COLOR },
  { id: 'CB', label: 'ブレーカ', color: BREAKER_COLOR },
  { id: 'SW', label: '電源スイッチ', color: BREAKER_COLOR },
];
