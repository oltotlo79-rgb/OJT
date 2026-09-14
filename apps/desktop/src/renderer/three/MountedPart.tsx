import type {
  MountedPart as MountedPartData,
  SocketDefinition,
  SocketRole,
} from '@ojt/board-model';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import { MeshStandardMaterial } from 'three';
import { RELAY_BODY_COLOR, TIMER_BODY_COLOR } from '../session/colors.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';

/**
 * ソケットに装着したリレー／タイマの本体。設計仕様 §8.2。
 * 箱形状＋ラベル。タイマは設定秒を本体に表示し、動作表示灯（MY4N相当）を頭に付ける。
 *
 * 実機ではネジ端子はソケットのフランジ上にあり部品に隠れないが、本アプリの盤モデル（§6.2）は
 * 端子を4段4列のグリッドに置くため、本体を不透明に描くと端子が隠れて配線できなくなる。
 * そこで本体は**半透明**で描き、**レイキャストの対象から外す**（`raycast` を空実装にする）。
 * 装着部品の選択・取り外しはソケット台座のクリックで行う（台座は本体より一回り大きい）。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** 本体の高さ[mm]（ソケット面からの突き出し）。 */
const BODY_HEIGHT_MM = 34;
/** 本体の余白[mm]（ソケット台座より一回り小さい）。 */
const BODY_INSET_MM = 2;
/** ネジ端子ティアを避けるため、奥行方向に余計に詰める量[mm]。 */
const SOCKET_TIER_MARGIN_MM = 18;
/** ソケット本体の上面の高さ[mm]（`Socket.tsx` の `BODY_HEIGHT_MM` と合わせる）。 */
const SOCKET_TOP_Z_MM = 9;
/** 本体の不透明度（下のネジ端子が見える程度）。 */
const BODY_OPACITY = 0.5;

/** レイキャストを受けない（クリックを下の端子へ通す）。 */
function noPick(): void {
  // 交差候補を1つも積まないので、この mesh はポインタイベントを拾わない
}

/** 装着部品の表示ラベル（`CR1` / `T1 3.0s`）。 */
export function mountedLabel(role: SocketRole, part: MountedPartData): string {
  return part.kind === 'relay-my4n' ? role : `${role} ${(part.presetMs / 1000).toFixed(1)}s`;
}

/** 装着部品1個。 */
export function MountedPart({
  socket,
  role,
  part,
  energized,
}: {
  socket: SocketDefinition;
  role: SocketRole;
  part: MountedPartData;
  energized: boolean;
}): JSX.Element {
  // 部品の外形はソケット本体（`bodyMm`）から作る。ソケットの差込領域に載る大きさ。
  const width = socket.bodyMm.width - BODY_INSET_MM * 2;
  const height = socket.bodyMm.length - BODY_INSET_MM * 2 - SOCKET_TIER_MARGIN_MM * 2;
  const center = toScene({
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: SOCKET_TOP_Z_MM + BODY_HEIGHT_MM / 2,
  });
  const bodyColor = part.kind === 'relay-my4n' ? RELAY_BODY_COLOR : TIMER_BODY_COLOR;
  const bodyMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: bodyColor,
        transparent: true,
        opacity: BODY_OPACITY,
        roughness: 0.5,
        metalness: 0.2,
        depthWrite: false,
      }),
    [bodyColor],
  );
  return (
    <group name={`mounted-${socket.id}`}>
      <mesh
        geometry={UNIT_BOX}
        material={bodyMaterial}
        raycast={noPick}
        position={center}
        scale={[width, height, BODY_HEIGHT_MM]}
      />
      {/* 動作表示灯（励磁中は赤く光る。MY4N の動作表示相当。§8.2） */}
      <mesh
        geometry={UNIT_BOX}
        raycast={noPick}
        material={
          energized
            ? sharedMaterial('#FF3B30', { emissive: '#FF3B30', emissiveIntensity: 2.2 })
            : sharedMaterial('#5B2020', { roughness: 0.6 })
        }
        position={[
          center[0] + width / 2 - 5,
          center[1] + height / 2 - 5,
          SOCKET_TOP_Z_MM + BODY_HEIGHT_MM + 0.4,
        ]}
        scale={[6, 4, 1.2]}
      />
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={300}
        position={[center[0], center[1] - height / 2 - 5, SOCKET_TOP_Z_MM + BODY_HEIGHT_MM]}
        zIndexRange={[12, 0]}
      >
        <span className={part.kind === 'relay-my4n' ? 'part-label' : 'part-label timer'}>
          {mountedLabel(role, part)}
        </span>
      </Html>
    </group>
  );
}
