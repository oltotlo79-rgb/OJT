import { BOARD_WIDTH_MM } from '@ojt/board-model';
import type { BoardDefinition } from '@ojt/board-model';
import type { JSX } from 'react';
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

/*
 * 主光源の影を盤面で受ける。ネジ・穴は共有ジオメトリのまま描き、影を落とす物体を部品に絞る。
 */

/** 盤面の板の厚み[mm]。 */
const PLATE_THICKNESS_MM = 5;

const consoleDetails = new Map<
  string,
  { body: BufferGeometry; rim: BufferGeometry; feet: BufferGeometry }
>();
function detailsFor(
  width: number,
  height: number,
  front: number,
  rear: number,
): { body: BufferGeometry; rim: BufferGeometry; feet: BufferGeometry } {
  const key = `${width}/${height}/${front}/${rear}`;
  const cached = consoleDetails.get(key);
  if (cached) return cached;
  const w = width / 2 - 1;
  const h = height / 2 - 1;
  const z = -PLATE_THICKNESS_MM;
  const body = new BufferGeometry();
  body.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        -w,
        -h,
        z,
        w,
        -h,
        z,
        w,
        h,
        z,
        -w,
        h,
        z,
        -w,
        -h,
        z - front,
        w,
        -h,
        z - front,
        w,
        h,
        z - rear,
        -w,
        h,
        z - rear,
      ],
      3,
    ),
  );
  body.setIndex([
    0, 1, 2, 0, 2, 3, 4, 7, 6, 4, 6, 5, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5,
    6, 1, 6, 2,
  ]);
  const flatBody = body.toNonIndexed();
  body.dispose();
  flatBody.computeVertexNormals();
  const rimParts = [
    new BoxGeometry(width, 3, 3).translate(0, -h, 0),
    new BoxGeometry(width, 3, 3).translate(0, h, 0),
    new BoxGeometry(3, height, 3).translate(-w, 0, 0),
    new BoxGeometry(3, height, 3).translate(w, 0, 0),
  ];
  const footParts = [-1, 1].flatMap((x) =>
    [-1, 1].map((y) => {
      const localY = y * height * 0.4;
      const bottom = z - front - (rear - front) * ((localY + h) / (2 * h));
      return new CylinderGeometry(8, 10, 5, 16)
        .rotateX(Math.PI / 2)
        .translate(x * width * 0.4, localY, bottom - 2);
    }),
  );
  const rim = mergeGeometries(rimParts, false);
  const feet = mergeGeometries(footParts, false);
  for (const geometry of [...rimParts, ...footParts]) geometry.dispose();
  if (!rim || !feet) throw new Error('盤の外装を作成できませんでした');
  const details = { body: flatBody, rim, feet };
  consoleDetails.set(key, details);
  return details;
}

/** 盤面と筐体。 */
export function BoardPlate({ board }: { board: BoardDefinition }): JSX.Element {
  const width = board.sizeMm.width;
  const height = board.sizeMm.height;
  const { frontHeightMm, rearHeightMm } = board.console;
  const details = detailsFor(width, height, frontHeightMm, rearHeightMm);
  const plate = sharedMaterial(BOARD_PLATE_COLOR, { metalness: 0.14, roughness: 0.58 });
  const side = sharedMaterial(CONSOLE_SIDE_COLOR, { metalness: 0.18, roughness: 0.55 });
  return (
    <group name="board-console" position={[(width - BOARD_WIDTH_MM) / 2, 0, 0]}>
      <mesh
        receiveShadow
        geometry={UNIT_BOX}
        raycast={noPick}
        material={plate}
        position={[0, 0, -PLATE_THICKNESS_MM / 2]}
        scale={[width, height, PLATE_THICKNESS_MM]}
      />
      <mesh geometry={details.body} raycast={noPick} material={side} />
      <mesh
        geometry={details.rim}
        material={sharedMaterial('#86929b', { metalness: 0.65, roughness: 0.3 })}
        raycast={noPick}
      />
      <mesh
        geometry={details.feet}
        material={sharedMaterial('#252c32', { roughness: 0.95 })}
        raycast={noPick}
      />
    </group>
  );
}
