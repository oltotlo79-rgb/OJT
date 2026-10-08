import {
  socketPinHoleOffsets,
  socketStepSections,
  SOCKET_STEP_HEIGHTS_MM,
  SOCKET_TERMINAL_Z_MM,
  SOCKET_TIER_DEPTH_MM,
  SOCKET_WIRE_LEAD_Z_MM,
  type BoardTerminal,
  type MountableKind,
  type SocketDefinition,
  type SocketId,
  type SocketRole,
} from '@ojt/board-model';
import { parseTerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useEffect, useMemo, useRef, type JSX } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import {
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  Matrix4,
  Quaternion,
  Vector3,
  type InstancedMesh,
} from 'three';
import { partKindLabel, socketPinTooltip } from '../i18n/ja.js';
import {
  SOCKET_BODY_COLOR,
  SOCKET_DROP_COLOR,
  SOCKET_LEVER_COLOR,
  SOCKET_SELECTED_COLOR,
} from '../session/colors.js';
import { coilBusSide, pinGroup, pinPartners } from '../session/socket-pins.js';
import {
  socketFaceRows,
  socketFaceTexture,
  socketLabelBoxes,
  SOCKET_PLATE_MARGIN_MM,
  type LabelBox,
} from './labels.js';
import {
  applyInstanceMatrices,
  noPick,
  PIN_HOLE_GEOMETRY,
  presetMaterial,
  sharedMaterial,
  UNIT_BOX,
} from './materials.js';
import { toScene } from './coords.js';

/**
 * 14ピンソケット（PYF14A 相当）。設計仕様 §6.2 / §6.5。
 *
 * 実物は**差込穴が本体中央**（2列×7段）にあり、**ネジ端子は本体の奥端と手前端に段付きで2列ずつ**並ぶ
 * （奥ティア `[空]③②①` / `⑧⑦⑥⑤`、手前ティア `⑫⑪⑩⑨` / `④⑭⑬[空]`）。
 * 本体の外形は盤定義の `bodyMm`、端子の座標と印字は `board.terminals` の `pos` / `label` から取る。
 * 数も配置もこの層ではハードコードしないので、Plan 1B が配置を変えれば3Dも追随する。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** ネジ端子ティアの奥行[mm]（2段ぶん＋余白）。 */
const TIER_DEPTH_MM = SOCKET_TIER_DEPTH_MM;
export { socketStepSections, SOCKET_STEP_HEIGHTS_MM } from '@ojt/board-model';
/** 中央の差込領域の高さ[mm]。装着部品の底面もこの高さに合わせる。 */
export const SOCKET_BODY_TOP_Z_MM = SOCKET_STEP_HEIGHTS_MM[2];
/** 印字の板をネジの頭より上に浮かせる量[mm]（ネジに隠れないようにする）。 */
const LABEL_LIFT_MM = 2;
/** 保持レバーの幅[mm]。 */
const LEVER_WIDTH_MM = 4;
/** 保持レバーの長さ（本体幅に対する比）。 */
const LEVER_SPAN_RATIO = 0.6;
/** 保持レバーの厚み[mm]。 */
const LEVER_HEIGHT_MM = 2.5;
/** 保持レバーの中心の高さ[mm]。 */
const LEVER_CENTER_Z_MM = SOCKET_BODY_TOP_Z_MM + 1;
/** 保持レバーの天面の高さ[mm]。 */
export const LEVER_TOP_Z_MM = LEVER_CENTER_Z_MM + LEVER_HEIGHT_MM / 2;
/** 差込穴の半径[mm]。 */
const PIN_HOLE_RADIUS_MM = 1;

/** 印字の板と、その下にある立体とのあいだに必ず空ける隙間[mm]。 */
const PRINT_CLEARANCE_MM = 0.5;

/**
 * 保持レバーに重なる段見出しの高さ。COM等をレバーで隠さない。
 * 番号・役割文字はこの高さを使わず、各ネジの高さへ追随する。
 * 全印字を1枚の平面へ載せると階段状の端子から番号が浮いて見えるため、
 * `socketPrintGeometry()` が文字ごとの高さを持つ1メッシュへ分ける。
 */
export const SOCKET_PRINT_Z_MM = Math.max(
  SOCKET_STEP_HEIGHTS_MM[1] + LABEL_LIFT_MM,
  LEVER_TOP_Z_MM + PRINT_CLEARANCE_MM,
);

/** 外向きの出線と、各ネジ脇の印字との高さの間隔。 */
export const SOCKET_WIRE_CLEARANCE_MM = SOCKET_WIRE_LEAD_Z_MM - (SOCKET_TERMINAL_Z_MM + 1.2);

/**
 * 保持レバー2本が印字の板の上に落とす影（板の左上を原点とする mm）。
 *
 * レバーは本体のいちばん高い立体で、段見出しの一部（COM と a接点）はこの真上に出る。
 * 「隠れないのは板がレバーより上にあるからだ」という約束を `test/socket-face-print.test.ts` が
 * 数値で確かめられるよう、描画と同じ式を純関数にして出す（`socketFaceRows()` と同じ考え方）。
 */
export function socketLeverFootprints(bodyMm: { width: number; length: number }): Array<{
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}> {
  const centerX = SOCKET_PLATE_MARGIN_MM + bodyMm.width / 2;
  const half = (bodyMm.width * LEVER_SPAN_RATIO) / 2;
  return [TIER_DEPTH_MM + LEVER_WIDTH_MM, bodyMm.length - TIER_DEPTH_MM - LEVER_WIDTH_MM].map(
    (y) => ({
      x0: centerX - half,
      x1: centerX + half,
      y0: SOCKET_PLATE_MARGIN_MM + y - LEVER_WIDTH_MM / 2,
      y1: SOCKET_PLATE_MARGIN_MM + y + LEVER_WIDTH_MM / 2,
    }),
  );
}

export interface SocketPrintPatch {
  box: LabelBox;
  z: number;
  terminalId?: string;
}

/** 番号は各ネジの段、段見出しはその直下の立体より上へ配置する。 */
export function socketPrintPatches(
  socket: SocketDefinition,
  terminals: readonly BoardTerminal[],
): SocketPrintPatch[] {
  const margin = SOCKET_PLATE_MARGIN_MM;
  const originX = socket.origin.x - margin;
  const originY = socket.origin.y - margin;
  const patches: SocketPrintPatch[] = [];
  const overlaps = (a: LabelBox, b: LabelBox): boolean =>
    a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  for (const terminal of terminals) {
    const boxes = socketLabelBoxes(terminal, originX, originY);
    for (const box of [boxes.number, boxes.role]) {
      patches.push({ box, z: terminal.pos.z + 1.2, terminalId: terminal.id });
    }
  }
  const { headers, bands } = socketFaceRows(terminals, originX, originY);
  for (const box of [...headers.map((header) => header.plate), ...bands]) {
    const nearest = [...terminals].sort(
      (a, b) =>
        Math.abs(a.pos.y - originY - (box.y0 + box.y1) / 2) -
        Math.abs(b.pos.y - originY - (box.y0 + box.y1) / 2),
    )[0];
    let z = (nearest?.pos.z ?? SOCKET_TERMINAL_Z_MM) + 1.2;
    for (const section of socketStepSections(socket.bodyMm.length)) {
      if (
        overlaps(box, {
          x0: margin,
          x1: margin + socket.bodyMm.width,
          y0: margin + section.offsetY - section.depth / 2,
          y1: margin + section.offsetY + section.depth / 2,
        })
      )
        z = Math.max(z, section.height + PRINT_CLEARANCE_MM);
    }
    if (socketLeverFootprints(socket.bodyMm).some((lever) => overlaps(box, lever))) {
      z = Math.max(z, SOCKET_PRINT_Z_MM);
    }
    patches.push({ box, z });
  }
  return patches;
}

/** 1枚の共有テクスチャを、段ごとの高さを持つ1メッシュに貼る。 */
export function socketPrintGeometry(
  socket: SocketDefinition,
  terminals: readonly BoardTerminal[],
): BufferGeometry {
  const width = socket.bodyMm.width + SOCKET_PLATE_MARGIN_MM * 2;
  const length = socket.bodyMm.length + SOCKET_PLATE_MARGIN_MM * 2;
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const { box, z } of socketPrintPatches(socket, terminals)) {
    // アンチエイリアスの縁も取り込む。隣の文字との最小余白0.8mmより小さくする。
    const x0 = Math.max(0, box.x0 - 0.1),
      x1 = Math.min(width, box.x1 + 0.1);
    const y0 = Math.max(0, box.y0 - 0.1),
      y1 = Math.min(length, box.y1 + 0.1);
    const offset = vertices.length / 3;
    for (const [x, y] of [
      [x0, y1],
      [x1, y1],
      [x1, y0],
      [x0, y0],
    ]) {
      vertices.push(x! - width / 2, length / 2 - y!, z);
      uvs.push(x! / width, 1 - y! / length);
    }
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** ソケット本体の光り方。Phase 7 設計 §7.3.4「ホバー＝細い縁取り、選択＝太い縁取り」。 */
export type SocketGlow = 'plain' | 'hovered' | 'selected' | 'droppable';

/**
 * 光り方ごとの発光の強さ（0 は光らない）。
 *
 * v2.0.0 Task 4（F3）: 選択・ホバーは**発光させない**。本体を光らせると、透明なリレーのケース
 * （`ComponentDetails.tsx` の `RELAY_SHELL`・opacity 0.2）越しに台座が水色に染まり、部品そのものが
 * 光っているように見えた（2026-10-08 の総点検 F3）。選択とホバーは台座の輪郭
 * （`socketOutlineOf()`）で示し、運搬中の「ここに落とせる」だけ弱い発光を残す
 * （落とせるソケットは空なので、ケース越しに染まることがない）。
 */
export const SOCKET_GLOW_INTENSITY: Readonly<Record<SocketGlow, number>> = {
  plain: 0,
  hovered: 0,
  selected: 0,
  droppable: 0.35,
};

/** ホバー中の輪郭の色（装着部品の稜線のホバー色と同じ白）。 */
export const SOCKET_HOVER_OUTLINE_COLOR = '#FFFFFF';

/** 台座の輪郭線。`passes` は太く見せるためにずらして重ねる本数（WebGL は線幅を変えられない）。 */
export interface SocketOutline {
  color: string;
  passes: number;
}

/**
 * 光り方ごとの輪郭（純関数。色と本数を単体テストで縛る）。
 * 選択＝水色の太線（3本）、ホバー＝白の細線、落とせる＝緑の細線（弱い発光と併用）、通常＝無し。
 * Phase 7 設計 §7.3.4「ホバー＝細い縁取り、選択＝太い縁取り」の本来の形。
 */
export function socketOutlineOf(glow: SocketGlow): SocketOutline | undefined {
  switch (glow) {
    case 'selected':
      return { color: SOCKET_SELECTED_COLOR, passes: 3 };
    case 'hovered':
      return { color: SOCKET_HOVER_OUTLINE_COLOR, passes: 1 };
    case 'droppable':
      return { color: SOCKET_DROP_COLOR, passes: 1 };
    case 'plain':
      return undefined;
  }
}

/**
 * 輪郭の形（単位箱の稜線。`scale` で各段の外形に伸ばす）。全ソケット・全段で1個を使い回す。
 *
 * 輪郭は**段付きの外形そのもの**（`socketStepSections()` の5区間それぞれの箱）に引く。
 * 最下段だけの箱では、正面の視点で手前の1辺しか見えず、ホバーの白線がほとんど読めなかった
 * （2026-10-08 の撮影確認）。5区間の稜線なら、正面・俯瞰・拡大のどこからでも
 * 「このソケット」が縁取りで分かる（装着部品の稜線 `MountedPart.tsx` と同じ見せ方）。
 */
const OUTLINE_EDGES = new EdgesGeometry(UNIT_BOX);
/** 輪郭を段の面から外へ逃がす量[mm]（面と同じ位置だと深度で負けてちらつく）。 */
const OUTLINE_GROW_MM = 0.3;
/** 2本目以降の輪郭のずらし量[mm]（約1px ずつ外に重ねて太く見せる）。 */
const OUTLINE_PASS_STEP_MM = 0.5;
/** 輪郭の箱を盤面から浮かせる量[mm]（底の辺が盤面と同じ深度にならないように）。 */
const OUTLINE_LIFT_MM = 0.15;

const outlineMaterials = new Map<string, LineBasicMaterial>();

/** 輪郭の線のマテリアル（色ごとに1個。トーンマッピングを受けず、水色・白がくすまない）。 */
export function socketOutlineMaterial(color: string): LineBasicMaterial {
  const cached = outlineMaterials.get(color);
  if (cached !== undefined) return cached;
  const material = new LineBasicMaterial({ color, toneMapped: false });
  outlineMaterials.set(color, material);
  return material;
}

/**
 * いまの状態の光り方（純関数。優先順を単体テストで縛る）。
 * 運搬中は「ここに落とせる」がいちばん強い合図なので、選択やホバーより優先する。
 */
export function socketGlowOf(state: {
  selected: boolean;
  hovered: boolean;
  droppable: boolean;
}): SocketGlow {
  if (state.droppable) return 'droppable';
  if (state.selected) return 'selected';
  return state.hovered ? 'hovered' : 'plain';
}

/**
 * ソケット本体（差込領域）のマテリアル。落とせるときだけ弱い発光を足す。
 * 「いまどのソケットを触っているか」は輪郭（`socketOutlineOf()`）で示す（利用者要望 2026-09-19 /
 * Phase 7 設計 §7.3.4 / v2.0.0 Task 4）。`sharedMaterial()` は設定ごとに1個しか作らないので、
 * 通常と落とせるの2個に収まる（§15）。
 */
export function socketBodyMaterial(glow: SocketGlow): ReturnType<typeof sharedMaterial> {
  const intensity = SOCKET_GLOW_INTENSITY[glow];
  // 材質表（v2.0.0 Task 5）: ソケットは黒い樹脂（PBT）
  return intensity === 0
    ? presetMaterial('blackResin', SOCKET_BODY_COLOR)
    : presetMaterial('blackResin', SOCKET_BODY_COLOR, {
        emissive: SOCKET_DROP_COLOR,
        emissiveIntensity: intensity,
      });
}

/**
 * ツールチップの文字列（`S1 端子5: CR1 リレー MY4N の a接点（COM 9 と組）`）。§8.2
 *
 * 利用者要望 2026-09-20「リレーソケットの各番号はどこが何かわからないから分かるようにしてね」。
 * 以前は盤定義の印字に役割IDを足すだけの `CR1 ⑨ COM` で、`COM` の意味も、
 * その端子が**どのピンと組になるか**も分からなかった。いま出すのは5つ:
 * ソケットID／端子番号／挿さっている部品／役割（日本語）／組になる相手のピン。
 * 文言の組み立ては `i18n/ja.ts` の `socketPinTooltip()` が持つ（§15: 文言は1箇所）。
 *
 * コイル（⑬・⑭）には**どちらの母線の側か**（`P(+)側` / `N(−)側`）も足す。利用者指摘 2026-09-20
 * 「リレーソケットの13、14番の端子にコイルとしか書いてないがこれではどちらがPかNか分からない」。
 * 向きは `session/socket-pins.ts` の `coilBusSide()` が1つだけ持つ（3Dの面の印字・部品カードと同じ）。
 */
export function socketTerminalLabel(
  socketId: SocketId,
  role: SocketRole | undefined,
  /** いまそのソケットに挿さっている部品（空きソケットは undefined）。 */
  mountedKind: MountableKind | undefined,
  terminal: BoardTerminal,
): string {
  const pin = Number(parseTerminalId(terminal.id).name);
  // ソケット以外の端子（番号でないもの）が来たら盤定義の印字をそのまま返す
  if (!Number.isInteger(pin)) return terminal.label;
  const group = pinGroup(pin);
  return socketPinTooltip({
    socketId,
    pin,
    role,
    partName: mountedKind === undefined ? undefined : partKindLabel(mountedKind),
    group,
    partners: pinPartners(pin).map((partner) => ({ pin: partner, group: pinGroup(partner) })),
    ...(group === 'coil' ? { busSide: coilBusSide(pin) } : {}),
  });
}

/** 差込穴の色（実物の黒い樹脂）。`sharedMaterial()` 越しに1個だけ作る。3D-02 */
const PIN_HOLE_COLOR = '#0B0D10';

/** 差込穴の姿勢（横倒しの円柱。`rotation={[Math.PI / 2, 0, 0]}` と同じ）。 */
const PIN_HOLE_ROTATION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/**
 * 差込穴（2列×7段）をまとめて描く。3D-02
 *
 * 以前は穴1個につき `<mesh>` ＋ JSX の子の `<cylinderGeometry>` ＋ `<meshStandardMaterial>` で、
 * 8ソケット分で **112個のジオメトリ・112個のマテリアル・112ドローコール**になっていた。
 * 形も色も 112 個すべて同じなので、共有ジオメトリ（`PIN_HOLE_GEOMETRY`）＋共有マテリアルの
 * `instancedMesh` 1本に畳む（ソケット1個につき1ドローコール）。穴は `raycast={noPick}` の
 * 純粋な飾りなので、当たり判定の作り直し（`computeBoundingSphere()`）も要らない。
 */
function PinHoles({
  originX,
  originY,
  holes,
}: {
  originX: number;
  originY: number;
  holes: readonly { dx: number; dy: number }[];
}): JSX.Element | null {
  const mesh = useRef<InstancedMesh | null>(null);
  const matrices = useMemo(
    () =>
      holes.map((hole) => {
        const [x, y, z] = toScene({
          x: originX + hole.dx,
          y: originY + hole.dy,
          z: SOCKET_BODY_TOP_Z_MM + 0.2,
        });
        // 半径1・高さ0.5の円柱を実寸へ伸ばす（高さは倒す前の局所Y軸なので1倍のまま）
        return new Matrix4().compose(
          new Vector3(x, y, z),
          PIN_HOLE_ROTATION,
          new Vector3(PIN_HOLE_RADIUS_MM, 1, PIN_HOLE_RADIUS_MM),
        );
      }),
    [holes, originX, originY],
  );
  useEffect(() => {
    applyInstanceMatrices(mesh.current, matrices);
  }, [matrices]);
  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      name="socket-pin-holes"
      args={[
        PIN_HOLE_GEOMETRY,
        sharedMaterial(PIN_HOLE_COLOR, { roughness: 0.9 }),
        matrices.length,
      ]}
      raycast={noPick}
    />
  );
}

/** 段を低くしてもネジ頭が宙に浮かないよう、端子ごとの小さな座をまとめて描く。 */
function TerminalPads({
  socket,
  terminals,
}: {
  socket: SocketDefinition;
  terminals: readonly BoardTerminal[];
}): JSX.Element | null {
  const mesh = useRef<InstancedMesh | null>(null);
  const matrices = useMemo(() => {
    const sections = socketStepSections(socket.bodyMm.length);
    return terminals.map((terminal) => {
      const localY = terminal.pos.y - socket.origin.y;
      const section = sections.find((item) => Math.abs(localY - item.offsetY) <= item.depth / 2);
      const base = section?.height ?? SOCKET_STEP_HEIGHTS_MM[1];
      const height = terminal.pos.z - 0.8 - base;
      return new Matrix4().compose(
        new Vector3(...toScene({ x: terminal.pos.x, y: terminal.pos.y, z: base + height / 2 })),
        new Quaternion(),
        new Vector3(4, 4, height),
      );
    });
  }, [socket, terminals]);
  useEffect(() => {
    applyInstanceMatrices(mesh.current, matrices);
  }, [matrices]);
  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      name="socket-terminal-pads"
      args={[UNIT_BOX, sharedMaterial('#4A5563', { roughness: 0.55 }), matrices.length]}
      raycast={noPick}
    />
  );
}

/** ソケット1個（本体＋段付き端子ティア＋差込穴＋保持レバー＋印字）。 */
export function Socket({
  socket,
  role,
  occupied,
  selected,
  hovered,
  droppable,
  terminals,
  onPickSocket,
  onHoverSocket,
  onReleaseSocket,
}: {
  socket: SocketDefinition;
  role: SocketRole | undefined;
  occupied: boolean;
  /** 部品パネルのカードがこのソケットを指しているか（本体を光らせる）。§8.2 */
  selected: boolean;
  /** ポインタがこのソケットの上にあるか。Phase 7 設計 §7.3.4 */
  hovered: boolean;
  /** いま運んでいる部品をここへ落とせるか（強く光らせる）。Phase 7 設計 §7.3.3 */
  droppable: boolean;
  /**
   * このソケットの端子（印字テクスチャの焼き付けに使う）。
   * **端子そのものは描かない**（`TerminalField` が盤の端子をまとめて1回で描く。決定表#13）。
   */
  terminals: readonly BoardTerminal[];
  onPickSocket: (socketId: SocketId, occupied: boolean) => void;
  /** ポインタが入った／出た（ホバー予告とカーソルに使う）。 */
  onHoverSocket: (socketId: SocketId | undefined) => void;
  /** 運んでいるものをここで放した（`pointerup`）。Phase 7 設計 §7.3.3 */
  onReleaseSocket: (socketId: SocketId, occupied: boolean) => void;
}): JSX.Element {
  const { width, length } = socket.bodyMm;
  const originX = socket.origin.x;
  const originY = socket.origin.y;
  const centerX = originX + width / 2;
  const centerY = originY + length / 2;

  // 印字の板は本体より四方に `SOCKET_PLATE_MARGIN_MM` だけ大きい（外側の列の `COM` が切れないため）
  const plateWidth = width + SOCKET_PLATE_MARGIN_MM * 2;
  const plateLength = length + SOCKET_PLATE_MARGIN_MM * 2;
  const faceTexture = useMemo(
    () =>
      socketFaceTexture(
        terminals,
        originX - SOCKET_PLATE_MARGIN_MM,
        originY - SOCKET_PLATE_MARGIN_MM,
        plateWidth,
        plateLength,
      ),
    [terminals, originX, originY, plateWidth, plateLength],
  );
  const holes = useMemo(() => socketPinHoleOffsets(), []);
  const printGeometry = useMemo(() => socketPrintGeometry(socket, terminals), [socket, terminals]);
  useEffect(() => () => printGeometry.dispose(), [printGeometry]);

  const bodyCenter = toScene({ x: centerX, y: centerY, z: SOCKET_BODY_TOP_Z_MM / 2 });
  const glow = socketGlowOf({ selected, hovered, droppable });
  const outline = socketOutlineOf(glow);
  const bodyEvents = {
    onClick: (event: ThreeEvent<MouseEvent>): void => {
      event.stopPropagation();
      onPickSocket(socket.id, occupied);
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>): void => {
      event.stopPropagation();
      onHoverSocket(socket.id);
    },
    onPointerOut: (): void => onHoverSocket(undefined),
    onPointerUp: (event: ThreeEvent<PointerEvent>): void => {
      if (event.button !== 0) return;
      event.stopPropagation();
      onReleaseSocket(socket.id, occupied);
    },
  };

  return (
    <group name={`socket-${socket.id}`}>
      {/* 5区間で階段状の外形を作る。どの段も押せるので装着操作は維持する。 */}
      {socketStepSections(length).map((section, index) => (
        <mesh
          key={`step-${index}`}
          castShadow
          name={index === 2 ? `socket-body-${socket.id}` : `socket-step-${socket.id}-${index}`}
          geometry={UNIT_BOX}
          material={socketBodyMaterial(glow)}
          position={toScene({ x: centerX, y: originY + section.offsetY, z: section.height / 2 })}
          scale={[width, section.depth, section.height]}
          {...bodyEvents}
        />
      ))}
      {/*
        段付きの外形の輪郭（5区間それぞれの稜線）。選択＝水色の太線、ホバー＝白、落とせる＝緑。
        本体を光らせないので、透明なリレーのケース越しに台座が染まらない。v2.0.0 Task 4（F3）
      */}
      {outline === undefined
        ? null
        : Array.from({ length: outline.passes }, (_, pass) => {
            const grow = OUTLINE_GROW_MM + pass * OUTLINE_PASS_STEP_MM;
            return socketStepSections(length).map((section, index) => {
              const boxHeight = section.height + grow;
              return (
                <lineSegments
                  key={`outline-${String(pass)}-${String(index)}`}
                  name={`socket-outline-${socket.id}-${String(pass)}-${String(index)}`}
                  geometry={OUTLINE_EDGES}
                  material={socketOutlineMaterial(outline.color)}
                  raycast={noPick}
                  position={toScene({
                    x: centerX,
                    y: originY + section.offsetY,
                    z: boxHeight / 2 + OUTLINE_LIFT_MM,
                  })}
                  scale={[width + grow * 2, section.depth + grow * 2, boxHeight]}
                />
              );
            });
          })}
      <TerminalPads socket={socket} terminals={terminals} />
      {/* 差込穴（2列×7段。中央の差込領域に並ぶ）。共有ジオメトリ1個の `instancedMesh`。3D-02 */}
      <PinHoles originX={originX} originY={originY} holes={holes} />
      {/* 保持レバー（実物は黄色。中央の差込領域の両端） */}
      {[0, 1].map((index) => {
        const y =
          index === 0
            ? originY + TIER_DEPTH_MM + LEVER_WIDTH_MM
            : originY + length - TIER_DEPTH_MM - LEVER_WIDTH_MM;
        return (
          <mesh
            key={`lever-${index}`}
            geometry={UNIT_BOX}
            material={sharedMaterial(SOCKET_LEVER_COLOR, { roughness: 0.45 })}
            raycast={noPick}
            position={toScene({ x: centerX, y, z: LEVER_CENTER_Z_MM })}
            scale={[width * LEVER_SPAN_RATIO, LEVER_WIDTH_MM, LEVER_HEIGHT_MM]}
          />
        );
      })}
      {/* ネジ端子の番号と役割の印字（常時表示）。§6.2 */}
      {faceTexture === undefined ? null : (
        <mesh
          name={`socket-print-${socket.id}`}
          raycast={noPick}
          position={[bodyCenter[0], bodyCenter[1], 0]}
          geometry={printGeometry}
        >
          {/* 段ごとの印字は透視投影で重なることがある。透明部を捨て、文字の深度は記録する。 */}
          <meshBasicMaterial map={faceTexture} transparent alphaTest={0.25} depthWrite />
        </mesh>
      )}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={280}
        position={[bodyCenter[0], bodyCenter[1] + length / 2 + 5, SOCKET_BODY_TOP_Z_MM]}
        zIndexRange={[10, 0]}
      >
        <span className="socket-label" data-label-rank={3}>
          {role ?? '予備'}
          <small>{socket.id}</small>
        </span>
      </Html>
    </group>
  );
}
