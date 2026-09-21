import type {
  MountedPart as MountedPartData,
  SocketDefinition,
  SocketId,
  SocketRole,
} from '@ojt/board-model';
import { Html } from '@react-three/drei';
import type { JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry } from 'three';
import { RELAY_BODY_COLOR, SOCKET_SELECTED_COLOR, TIMER_BODY_COLOR } from '../session/colors.js';
import { JA_3D } from '../i18n/ja.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
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
/**
 * ホバー中の稜線の色（Phase 7 設計 §7.3.4「ホバー＝白の細い縁取り、選択＝太い縁取り」）。
 * 選択（水色）とは別の白にして、「触っているだけ」と「選んである」を取り違えないようにする。
 */
const HOVERED_EDGE_COLOR = '#FFFFFF';
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
        data-label-rank={2}
        title={energized ? JA_3D.running : undefined}
      >
        {mountedLabel(role, part)}
      </span>
      {/* 励磁中だけ出す札。ランプの点灯と同じ情報を文字でも読めるようにする（§8.2） */}
      {energized ? (
        <span className="part-label" data-label-rank={2} style={RUNNING_STYLE}>
          {JA_3D.running}
        </span>
      ) : null}
    </>
  );
}

/**
 * 装着部品の稜線（`EdgesGeometry`）。寸法ごとに1個だけ作って使い回す。3D-06
 *
 * 盤定義が別寸法のソケットを持つ余地を残すので `Map` にしてあるが、`JIPM_BOARD` では
 * 8ソケットすべて `bodyMm` が同じなので実体は**1個**になる。`EdgesGeometry` は GPU
 * バッファを持つので、部品の付け外しのたびに作り直すと解放されないまま積み上がる
 * （中間の `BoxGeometry` は一度もアップロードされないので通常の GC で回収される）。
 */
const bodyEdgesCache = new Map<string, EdgesGeometry>();

/** 本体の寸法に対応する稜線（無ければ作って覚える）。 */
export function sharedBodyEdges(widthMm: number, heightMm: number): EdgesGeometry {
  const key = `${widthMm}x${heightMm}`;
  const found = bodyEdgesCache.get(key);
  if (found !== undefined) return found;
  const made = new EdgesGeometry(new BoxGeometry(widthMm, heightMm, BODY_HEIGHT_MM));
  bodyEdgesCache.set(key, made);
  return made;
}

/**
 * 稜線の色（選択中 > ホバー中 > 通常）。Phase 7 設計 §7.3.4
 * 純関数にして「ホバーでも縁が変わる」ことを単体テストで縛れるようにする。
 */
export function mountedEdgeColor(state: { selected: boolean; hovered: boolean }): string {
  if (state.selected) return SELECTED_EDGE_COLOR;
  return state.hovered ? HOVERED_EDGE_COLOR : EDGE_COLOR;
}

/** 装着部品1個。 */
export function MountedPart({
  socket,
  role,
  part,
  energized,
  timedOut,
  selected,
  hovered,
  onPickSocket,
  onHoverSocket,
  onPressPart,
  onReleaseSocket,
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
  /** ポインタが本体の上にあるか（稜線を細く光らせる）。Phase 7 設計 §7.3.4 */
  hovered: boolean;
  /** 本体を押したときの通知（ソケット台座を押したときと同じ扱いにする）。§8.2 */
  onPickSocket: (socketId: SocketId, occupied: boolean) => void;
  /** ポインタが入った／出た（ホバー予告とカーソルに使う）。 */
  onHoverSocket: (socketId: SocketId | undefined) => void;
  /**
   * 本体を押し始めた（つまむ候補にする）。Phase 7 設計 §7.3.2
   * ここではまだ運び始めない。4px 動いて初めて運搬になる（`BoardScene` のしきい値）。
   */
  onPressPart: (socketId: SocketId, kind: MountedPartData['kind']) => void;
  /** 本体の上で放した（運んできたものを元のソケットへ戻す経路）。 */
  onReleaseSocket: (socketId: SocketId, occupied: boolean) => void;
}): JSX.Element {
  // 部品の外形はソケット本体（`bodyMm`）から作る。ソケットの差込領域に載る大きさ
  const box = mountedBodyBox(socket);
  const { center, width, height } = box;
  const bodyColor = part.kind === 'relay-my4n' ? RELAY_BODY_COLOR : TIMER_BODY_COLOR;
  /*
   * 本体のマテリアルと稜線は**共有する**（3D-06）。`useMemo` で作ったものを props で
   * 渡していたため、R3F の自動解放（JSX の子として書いたものだけが対象）から漏れ、
   * 部品を付け外しするたびに `MeshStandardMaterial` と `EdgesGeometry` が積み上がっていた。
   * 色は2種（リレー／タイマ）、寸法は全ソケット共通なので、実体は各1個で足りる。
   */
  const bodyMaterial = sharedMaterial(bodyColor, {
    transparent: true,
    opacity: BODY_OPACITY,
    roughness: 0.5,
    metalness: 0.2,
  });
  const edges = sharedBodyEdges(width, height);
  return (
    <group name={`mounted-${socket.id}`}>
      {/* 本体の箱。ここだけがクリックを受け、押すとそのソケットが選ばれる（利用者要望 2026-09-19） */}
      <mesh
        name={`mounted-body-${socket.id}`}
        geometry={UNIT_BOX}
        material={bodyMaterial}
        position={center}
        scale={[width, height, BODY_HEIGHT_MM]}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onPickSocket(socket.id, true);
        }}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHoverSocket(socket.id);
        }}
        onPointerOut={() => {
          onHoverSocket(undefined);
        }}
        /* つまんでソケットの外へ放すと取り外し（Phase 7 設計 §7.3.2。ゴミ箱は作らない） */
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onPressPart(socket.id, part.kind);
        }}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onReleaseSocket(socket.id, true);
        }}
      />
      {/* 箱の輪郭。半透明のままでも「そこに部品が載っている」ことが分かるようにする */}
      <lineSegments geometry={edges} position={center} raycast={noPick}>
        <lineBasicMaterial color={mountedEdgeColor({ selected, hovered })} />
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
