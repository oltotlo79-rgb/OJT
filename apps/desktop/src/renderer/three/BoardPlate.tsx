import type { BoardDefinition } from '@ojt/board-model';
import type { JSX } from 'react';
import { BOARD_PLATE_COLOR, CONSOLE_SIDE_COLOR } from '../session/colors.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';

/**
 * 盤の筐体（傾斜コンソール）。設計仕様 §6.5。
 * 実物は手前が低く奥が高い楔形の卓上コンソールで、盤面はその上面である。
 * 盤グループ全体を傾ける役は `BoardScene` が持ち、ここは盤面の板と、その下の筐体を描く。
 * 寸法はすべて `BoardDefinition`（`sizeMm` と `console`）から取り、ハードコードしない。
 */

/** レイキャストを受けない（空クリックが必ず「配線の取り消し」になるようにする）。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 盤面の板の厚み[mm]。 */
const PLATE_THICKNESS_MM = 5;

/** 盤面と筐体。 */
export function BoardPlate({ board }: { board: BoardDefinition }): JSX.Element {
  const width = board.sizeMm.width;
  const height = board.sizeMm.height;
  const { frontHeightMm, rearHeightMm } = board.console;
  // 盤面の下に「奥ほど深い」箱を積んで楔形を作る。傾斜は盤グループの回転が担うので、
  // ここでは平均の高さを持つ箱を1つ置き、さらに奥側に立ち上がりを足す。
  const bodyHeight = (frontHeightMm + rearHeightMm) / 2;
  const riserHeight = rearHeightMm - frontHeightMm;
  const plate = sharedMaterial(BOARD_PLATE_COLOR, { metalness: 0.05, roughness: 0.65 });
  const side = sharedMaterial(CONSOLE_SIDE_COLOR, { metalness: 0.05, roughness: 0.8 });
  return (
    <group name="board-console">
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={plate}
        position={[0, 0, -PLATE_THICKNESS_MM / 2]}
        scale={[width, height, PLATE_THICKNESS_MM]}
        receiveShadow
      />
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={side}
        position={[0, 0, -PLATE_THICKNESS_MM - bodyHeight / 2]}
        scale={[width - 2, height - 2, bodyHeight]}
      />
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={side}
        position={[
          0,
          height / 2 - riserHeight / 4,
          -PLATE_THICKNESS_MM - bodyHeight - riserHeight / 4,
        ]}
        scale={[width - 2, riserHeight / 2, riserHeight / 2]}
      />
    </group>
  );
}
