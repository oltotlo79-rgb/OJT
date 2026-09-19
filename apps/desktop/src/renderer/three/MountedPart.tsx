import type {
  MountedPart as MountedPartData,
  SocketDefinition,
  SocketId,
  SocketRole,
} from '@ojt/board-model';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, MeshStandardMaterial } from 'three';
import { RELAY_BODY_COLOR, SOCKET_SELECTED_COLOR, TIMER_BODY_COLOR } from '../session/colors.js';
import { JA_3D } from '../i18n/ja.js';
import { UNIT_BOX } from './materials.js';
import { PartIndicator, type MountedBodyBox } from './PartIndicator.js';
import { toScene } from './coords.js';

/**
 * ソケットに装着したリレー／タイマの本体。設計仕様 §8.2。
 * 箱形状＋ラベル。タイマは設定秒を本体に表示し、動作表示灯（MY4N相当）を頭に付ける。
 *
 * 実機ではネジ端子はソケットのフランジ上にあり部品に隠れないが、本アプリの盤モデル（§6.2）は
 * 端子を4段4列のグリッドに置くため、本体を不透明に描くと端子が隠れて配線できなくなる。
 * そこで本体はネジ端子ティアを避けた大きさにしたうえで**やや透ける程度（0.85）**に描く。
 *
 * **本体の箱だけがクリックを受ける**（利用者要望 2026-09-19「リレーやタイマはソケットから外して
 * 入れ替えたりできるようにすること」）。見えている部品を押せばそのソケットが選べる、が一番素直で
 * あり、UXレビューの「取り外しに気付けない」もここが起点だった。箱はネジ端子ティアを避けた
 * 大きさなので、端子のクリック（配線そのもの）は奪わない。稜線・動作表示・札といった飾りは
 * これまでどおり `raycast` を空実装にして下へ通す。
 *
 * ラベルは**本体の上面**に置く。以前は手前（`center - height/2 - 5`）に置いていたため、
 * 手前ティアの `⑫` / `④` の印字に重なって番号が読めなかった（レビュー指摘）。
 *
 * 動作表示は `PartIndicator`（リレー＝MY4N相当の動作表示窓、タイマ＝H3Y-4相当の
 * POWER / UP の2灯＋設定ダイヤル）に分けてある。利用者要望 2026-09-19。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** 「動作中」の札（CSSを増やさずに `part-label` を琥珀色に着色する）。 */
const RUNNING_STYLE = {
  background: 'rgba(255, 138, 30, 0.92)',
  color: '#1B1207',
  marginLeft: '3px',
} as const;

/** 本体の高さ[mm]（ソケット面からの突き出し）。 */
const BODY_HEIGHT_MM = 34;
/** 本体の余白[mm]（ソケット台座より一回り小さい）。 */
const BODY_INSET_MM = 2;
/** ネジ端子ティアを避けるため、奥行方向に余計に詰める量[mm]。 */
const SOCKET_TIER_MARGIN_MM = 18;
/** ソケット本体の上面の高さ[mm]（`Socket.tsx` の `BODY_HEIGHT_MM` と合わせる）。 */
const SOCKET_TOP_Z_MM = 9;
/**
 * 本体の不透明度。
 * 0.5 ＋ `depthWrite: false` では盤の暗い色に溶けて「装着したかどうか」が見分けられなかった
 * （レビュー指摘: 装着したリレーがほとんど見えない）。本体は端子のティアを避けて置いてあるので、
 * 0.85 まで上げて深度も書き、代わりに稜線を描いて箱として認識できるようにする。
 */
const BODY_OPACITY = 0.85;
/** 稜線の色（暗い本体の輪郭を盤の上で見せる）。 */
const EDGE_COLOR = '#C9D2DC';
/** 選択中の稜線の色（部品パネルのカードが指しているソケット）。利用者要望 2026-09-19 */
const SELECTED_EDGE_COLOR = SOCKET_SELECTED_COLOR;
/** ラベルを本体の上面からさらに浮かせる量[mm]（⑫/④ の印字に被せないため）。 */
const LABEL_LIFT_MM = 4;

/** レイキャストを受けない（クリックを下の端子へ通す）。 */
function noPick(): void {
  // 交差候補を1つも積まないので、この mesh はポインタイベントを拾わない
}

/** 装着部品の表示ラベル（`CR1` / `T1 3.0s`）。 */
export function mountedLabel(role: SocketRole, part: MountedPartData): string {
  return part.kind === 'relay-my4n' ? role : `${role} ${(part.presetMs / 1000).toFixed(1)}s`;
}

/**
 * 装着部品の本体の箱（中心・幅・奥行・天面）。盤定義のソケット本体から作る純粋関数。
 * 動作表示（`PartIndicator`）の位置もこの箱から決まるので、テストから同じ値を引ける。
 */
export function mountedBodyBox(socket: SocketDefinition): MountedBodyBox {
  const width = socket.bodyMm.width - BODY_INSET_MM * 2;
  const height = socket.bodyMm.length - BODY_INSET_MM * 2 - SOCKET_TIER_MARGIN_MM * 2;
  const center = toScene({
    x: socket.origin.x + socket.bodyMm.width / 2,
    y: socket.origin.y + socket.bodyMm.length / 2,
    z: SOCKET_TOP_Z_MM + BODY_HEIGHT_MM / 2,
  });
  return { center, width, height, topZ: SOCKET_TOP_Z_MM + BODY_HEIGHT_MM };
}

/**
 * 本体の上に浮かべる札の中身（`Html` の中に入れる部分）。
 * `Html` は `Canvas` の中でしか使えないので、**中身だけ**を別の部品に分けてある
 * （こうしておくと単体テストから札の文字とツールチップを読める）。
 */
export function MountedLabelContent({
  role,
  part,
  energized,
}: {
  role: SocketRole;
  part: MountedPartData;
  energized: boolean;
}): JSX.Element {
  return (
    <>
      <span
        className={part.kind === 'relay-my4n' ? 'part-label' : 'part-label timer'}
        title={energized ? JA_3D.running : undefined}
      >
        {mountedLabel(role, part)}
      </span>
      {/* 励磁中だけ出す札。ランプの点灯と同じ情報を文字でも読めるようにする（§8.2） */}
      {energized ? (
        <span className="part-label" style={RUNNING_STYLE}>
          {JA_3D.running}
        </span>
      ) : null}
    </>
  );
}

/** 装着部品1個。 */
export function MountedPart({
  socket,
  role,
  part,
  energized,
  timedOut,
  selected,
  onPickSocket,
}: {
  socket: SocketDefinition;
  role: SocketRole;
  part: MountedPartData;
  /** リレーのコイル励磁／タイマの通電（`SimSnapshot` の `relays[].coilOn` / `timers[].powered`）。 */
  energized: boolean;
  /** タイマの限時接点が動作したか（`SimSnapshot` の `timers[].timedOut`）。リレーでは常に false。 */
  timedOut: boolean;
  /** 部品パネルのカードがこのソケットを指しているか（稜線を光らせる）。§8.2 */
  selected: boolean;
  /** 本体を押したときの通知（ソケット台座を押したときと同じ扱いにする）。§8.2 */
  onPickSocket: (socketId: SocketId, occupied: boolean) => void;
}): JSX.Element {
  // 部品の外形はソケット本体（`bodyMm`）から作る。ソケットの差込領域に載る大きさ
  const box = mountedBodyBox(socket);
  const { center, width, height } = box;
  const bodyColor = part.kind === 'relay-my4n' ? RELAY_BODY_COLOR : TIMER_BODY_COLOR;
  const bodyMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: bodyColor,
        transparent: true,
        opacity: BODY_OPACITY,
        roughness: 0.5,
        metalness: 0.2,
      }),
    [bodyColor],
  );
  // 稜線は本体の大きさに合わせて作る（ソケットごとに寸法は同じなので実質1個で済む）
  const edges = useMemo(
    () => new EdgesGeometry(new BoxGeometry(width, height, BODY_HEIGHT_MM)),
    [width, height],
  );
  return (
    <group name={`mounted-${socket.id}`}>
      {/* 本体の箱。ここだけがクリックを受け、押すとそのソケットが選ばれる（利用者要望 2026-09-19） */}
      <mesh
        geometry={UNIT_BOX}
        material={bodyMaterial}
        position={center}
        scale={[width, height, BODY_HEIGHT_MM]}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onPickSocket(socket.id, true);
        }}
      />
      {/* 箱の輪郭。半透明のままでも「そこに部品が載っている」ことが分かるようにする */}
      <lineSegments geometry={edges} position={center} raycast={noPick}>
        <lineBasicMaterial color={selected ? SELECTED_EDGE_COLOR : EDGE_COLOR} />
      </lineSegments>
      {/* 動作表示（リレー＝動作表示窓、タイマ＝POWER/UP の2灯＋ダイヤル）。§5.3.1 / §5.3.2 */}
      <PartIndicator
        kind={part.kind}
        box={box}
        energized={energized}
        timedOut={timedOut}
        presetMs={part.kind === 'timer-h3y4' ? part.presetMs : 0}
        rangeMaxMs={part.kind === 'timer-h3y4' ? part.rangeMaxMs : 0}
      />
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={300}
        position={[center[0], center[1], SOCKET_TOP_Z_MM + BODY_HEIGHT_MM + LABEL_LIFT_MM]}
        zIndexRange={[12, 0]}
      >
        <MountedLabelContent role={role} part={part} energized={energized} />
      </Html>
    </group>
  );
}
