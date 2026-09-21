import {
  BUZZER_ID,
  JIPM_BOARD,
  OUTLET_ID,
  PL_BLOCK_ID,
  PLC_PART_ID,
  routeSession,
  routeWire,
  RoutingError,
  toPhysicalTerminal,
  type BoardDefinition,
  type BoardSession,
  type BoardTerminal,
  type MountableKind,
  type SocketId,
  type WireRoute,
} from '@ojt/board-model';
import { parseTerminalId, type LampLevel, type TerminalId } from '@ojt/circuit-sim';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { MOUSE } from 'three';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { reasonOf } from '../app/errors.js';
import { useStore, type AppState } from '../app/store.js';
import {
  buzzerDeviceName,
  JA,
  lampDeviceName,
  polarityTerminalTooltip,
  routeFailedLog,
} from '../i18n/ja.js';
import {
  hoverHintFor,
  legalTargets,
  type InteractionState,
  type PickHit,
  type PowerFixture,
} from '../session/interaction.js';
import { terminalLoads } from '../session/terminal-list.js';
import { busSideOfRole } from '../session/socket-pins.js';
import { BoardPlate } from './BoardPlate.js';
import {
  boardToWorld,
  BOARD_TILT_RAD,
  CAMERA_FOV_DEG,
  MAX_CAMERA_DISTANCE_MM,
  MAX_POLAR_ANGLE,
  MIN_CAMERA_DISTANCE_MM,
  MIN_POLAR_ANGLE_RAD,
} from './camera.js';
import { CameraPresets } from './CameraPresets.js';
import {
  cameraReadoutText,
  createPickDragGuard,
  middleButtonAssignmentFor,
  mouseButtonAssignment,
  type MiddleDragAction,
  type OrbitControlsLike,
} from './navigation.js';
import { DeskWires, offBoardTerminals } from './DeskWires.js';
import { DinRail } from './DinRail.js';
import { FixedWires } from './FixedWires.js';
import { Outlet } from './Outlet.js';
import { configurePerfCounters, PerfProbe } from './PerfProbe.js';
import { PlcRack } from './PlcRack.js';
import { PlcUnit } from './PlcUnit.js';
import { Fixture, FIXTURE_LABEL_OFFSET_MM, FIXTURES } from './Fixtures.js';
import { LabelDeclutter } from './label-declutter.js';
import { Lamp } from './Lamp.js';
import { MountedPart } from './MountedPart.js';
import { ProbeMarkers } from './ProbeMarkers.js';
import { PushButton } from './PushButton.js';
import { blockPolarityMark, blockTerminalMark } from './labels.js';
import { Socket, socketTerminalLabel } from './Socket.js';
import { TerminalBlock } from './TerminalBlock.js';
import { boardFieldTerminals, TerminalField } from './TerminalField.js';
import { terminalTooltip } from './TerminalHit.js';
import { ViewGizmo } from './ViewGizmo.js';
import { Wire } from './Wire.js';
import { WireDragLayer } from './WirePreview.js';
import { toScene } from './coords.js';
import { observeWebGlContext } from './webgl-context.js';
import { tourRotationChanged, useTourStore } from '../tour/tour-store.js';

/**
 * 3D盤のシーン。設計仕様 §6.5 / §8.1 / §12.2 / §15。
 *
 * 性能方針（§15: 内蔵GPUで60fps）:
 * - `frameloop="demand"` にして、状態が変わったときだけ描く。OrbitControls の操作中は
 *   drei 側が `invalidate()` を呼ぶので、何もしていない間は 0fps になる。
 * - 盤の静的ジオメトリ（板・ダクト・ソケット台座・端子）はマテリアルとジオメトリを共有し、
 *   電線の `TubeGeometry` は経路オブジェクト単位でメモ化する。
 */

/**
 * 視点操作の効き（Blender の操作感に寄せる。§12.2 / 2026-09-14・2026-09-19 の利用者要望）。
 *
 * `dampingFactor` は「`update()` 1回で目標の何割を詰めるか」。以前の 0.1 だと、
 * ドラッグ1回ぶんの回転のうちその場で入るのは**1割**だけで、残りは次のフレーム以降に
 * 9割・8割…と指数で詰まっていく（＝ポインタに対して常に約9フレーム＝150ms 遅れて付いてくる）。
 * `frameloop="demand"` では `pointermove` 1回につき1フレームしか描かないので、この遅れが
 * そのまま「回しづらい」になっていた（2026-09-19「3Dの視点の角度を変えるの少し動かしづらい」）。
 * 0.35 にすると 3フレーム（60fps で約50ms）でほぼ追い付くので、慣性の感じは残したまま
 * 指に付いてくる。回転量そのものも three 既定の 1.0 に戻して、少ないドラッグでよく回るようにする。
 */
const ORBIT_FEEL = { rotateSpeed: 1, zoomSpeed: 0.9, dampingFactor: 0.35 } as const;

/**
 * クリックとドラッグを分ける移動量[px]。Phase 7 設計 §7.3.1。
 *
 * これ未満のまま放せば**クリック**（端子＝配線の1本目、ソケット＝カードを開く）。
 * 超えたら**ドラッグ**で、始点が端子なら配線、盤に載っている部品なら運搬、
 * それ以外（盤の地の部分）ならいままでどおり視点の回転になる。
 * 4px は `GIZMO_DRAG_THRESHOLD_PX` と同じ値で、ビューキューブと手の感じをそろえるため。
 */
export const INTERACT_DRAG_THRESHOLD_PX = 4;

/** ポインタが指しているものごとのカーソル。Phase 7 設計 §7.3.4 */
export const CURSOR_FOR = {
  /** 端子（配線の始点／終点）。 */
  terminal: 'crosshair',
  /** 押せるもの（ブレーカ・電源スイッチ・空きソケット・押ボタン）。 */
  press: 'pointer',
  /** つまめるもの（盤に載っている部品）。 */
  grab: 'grab',
  /** 運んでいる最中。 */
  carry: 'grabbing',
  /** 盤の地の部分（引けば視点が回る）。 */
  ground: 'move',
} as const;

/** ポインタが指しているもの。 */
export type PointerSubject = keyof typeof CURSOR_FOR;

/**
 * いま指しているものからカーソルを決める（純関数。単体テストで縛る）。
 * 運搬中は指しているものに関わらず `grabbing`（手の中身が一番強い情報）。
 */
export function cursorFor(subject: PointerSubject, carrying: boolean): string {
  return carrying ? CURSOR_FOR.carry : CURSOR_FOR[subject];
}

/** ドラッグの種類。`view` だけが視点を回す。 */
export type DragKind = 'wire' | 'carry' | 'view';

/**
 * 押し始めた対象からドラッグの意味を決める（純関数。設計 §7.3.1）。
 * 端子の上から引いたら配線、盤に載っている部品の上から引いたら運搬、
 * それ以外（盤の地の部分）はいままでどおり視点の回転になる。
 */
export function dragKindOf(pressed: { terminal: unknown; part: unknown }): DragKind {
  if (pressed.terminal !== undefined) return 'wire';
  if (pressed.part !== undefined) return 'carry';
  return 'view';
}

/** ドラッグの操作 → three の `MOUSE`。 */
const MOUSE_FOR_ACTION: Readonly<Record<MiddleDragAction, MOUSE>> = {
  rotate: MOUSE.ROTATE,
  pan: MOUSE.PAN,
  dolly: MOUSE.DOLLY,
};

/**
 * 端子台として描くまとまり。§6.4
 * P/N 供給端子は `P.1` / `N.1` の各1点しかない（§6.1）ので、
 * 実物写真の DC24V 端子と同じく**2端子の小さな端子台1個**としてまとめて描く。
 */
const BLOCK_PARTS: ReadonlyArray<{
  key: string;
  ids: readonly string[];
  label: string;
  /** 名札の位置（端子の外接矩形の中心からの盤モデル mm。省略すると台座の奥側）。 */
  labelOffsetMm?: { x: number; y: number };
}> = [
  { key: 'TB_PL', ids: ['TB_PL'], label: 'ランプ用端子台' },
  { key: 'TB_PB', ids: ['TB_PB'], label: '押ボタン用端子台' },
  // 奥は盤の上端で、DC24V電源の名札と左上の状態オーバーレイが居る。右下へ逃がす（§8.1）
  { key: 'PN', ids: ['P', 'N'], label: 'DC24V端子台', labelOffsetMm: { x: 46, y: 6 } },
];

/** DINレールを敷く機器のまとまり（ソケット群と端子台群）。実物写真のとおり。§6.5 */
const RAIL_GROUPS: readonly string[][] = [['TB_PL'], ['TB_PB'], ['P', 'N']];

/**
 * 極性を持つ端子のツールチップ（`TB_PL PL1+: 白ランプ PL1 の P(+)側`）。極性が無い端子は undefined。
 *
 * 利用者指摘 2026-09-20「リレーソケットの13、14番の端子にコイルとしか書いてないがこれでは
 * どちらがPかNか分からない。ランプも同様」。ランプ用端子台は `PL1+` / `PL1−` としか印字が無く、
 * `+` が P（＋24V）側だと**どこにも書かれていなかった**。
 *
 * 出す端子は3Dの面の印字（`blockPolarityMark()`）と**同じ集合**にする（印字がある端子には
 * ツールチップの言葉もある、という対応を崩さない）。機器の呼び名は盤定義の色と銘板から作るので、
 * 盤がランプの色を変えればツールチップも追随する。
 */
export function polarityTerminalLabel(
  board: BoardDefinition,
  terminal: BoardTerminal,
): string | undefined {
  const side = busSideOfRole(terminal.role);
  if (side === undefined || blockPolarityMark(terminal) === undefined) return undefined;
  const { part, name } = parseTerminalId(terminal.id);
  // ランプ用端子台は `TB_PL.1+` の `1` が PL1、ランプ本体は部品IDがそのまま PL1
  const panelLabel = part === PL_BLOCK_ID ? `PL${name.slice(0, -1)}` : part;
  const lamp = board.lamps.find((l) => l.panelLabel === panelLabel);
  const deviceName =
    lamp !== undefined
      ? lampDeviceName(lamp.color, lamp.panelLabel)
      : part === BUZZER_ID
        ? buzzerDeviceName(BUZZER_ID)
        : undefined;
  return polarityTerminalTooltip({ part, mark: blockTerminalMark(terminal), deviceName, side });
}

/**
 * セッションの全電線の経路（純粋関数。テストで固定する）。§6.6
 *
 * `routeSession()` は**全か無か**で、1本でも解けなければ `RoutingError` を投げる。
 * React のレンダー中に投げるとシーンごと落ちて盤が消えてしまうので、ここで受け止めて
 * ①解けた電線だけを描き、②解けなかった電線のIDと理由を返す（セッションの状態は変えない）。
 * 出荷する盤（`JIPM_BOARD`）では起こらないはずだが、起こったときに黒い画面ではなく
 * 「どの電線がなぜ描けないか」を出せるようにしておく。
 *
 * 受け止めるのは `RoutingError` だけではない（1D2-a のレビュー指摘）。壊れた作業ファイルから
 * `wires: ['not-a-wire']` のような値が入ると `toPhysicalTerminal()` が `TypeError` を投げ、
 * 描画のたびに同じ例外が出て例外バナーからも戻れなくなる。**どんな例外でも**1本ぶんの
 * 失敗として畳み、`invalid-terminal`（＝盤に無い端子）として理由を返す。
 */
export function safeRoutes(
  board: BoardDefinition,
  session: BoardSession | undefined,
): { routes: WireRoute[]; errors: RoutingError[] } {
  if (session === undefined) return { routes: [], errors: [] };
  if (!Array.isArray(session.wires)) return { routes: [], errors: [] };
  try {
    return { routes: routeSession(board, session), errors: [] };
  } catch {
    // 1本ずつやり直して、解けた電線だけでも描く（理由は下の loop が集める）
  }
  const routes: WireRoute[] = [];
  const errors: RoutingError[] = [];
  for (const [index, wire] of session.wires.entries()) {
    const wireId = typeof wire?.id === 'string' ? wire.id : `w-?${index}`;
    try {
      routes.push(
        routeWire(
          board,
          {
            id: wire.id,
            from: toPhysicalTerminal(session.socketRoles, wire.from),
            to: toPhysicalTerminal(session.socketRoles, wire.to),
          },
          routes,
        ),
      );
    } catch (error) {
      errors.push(
        error instanceof RoutingError
          ? error
          : new RoutingError(reasonOf(error), wireId, 'invalid-terminal'),
      );
    }
  }
  return { routes, errors };
}

/**
 * 見た目が変わったときだけ再描画を要求する。§15
 *
 * Worker のスナップショットは約30fpsで届くが、その大半は「電圧の小数点以下が動いただけ」で
 * 3Dの絵は1ピクセルも変わらない。毎回 `invalidate()` すると `frameloop="demand"` が
 * 実質 30fps の常時描画になり、ソフトウェアラスタライザの環境ではメインスレッドを占有して
 * クリックすら受け付けなくなる。そこで**描き分けに効く値だけ**から署名を作って比べる。
 */
export function visualSignature(state: AppState): string {
  const { snapshot, session } = state;
  const lamps = Object.entries(snapshot.lamps)
    .map(([id, lamp]) => `${id}:${lamp.level}`)
    .join(',');
  const relays = Object.entries(snapshot.relays)
    .map(([id, relay]) => `${id}:${relay.coilOn ? 1 : 0}`)
    .join(',');
  const timers = Object.entries(snapshot.timers)
    .map(([id, t]) => `${id}:${t.powered ? 1 : 0}${t.timedOut ? 1 : 0}`)
    .join(',');
  const buttons = Object.entries(snapshot.buttons)
    .map(([id, pressed]) => `${id}:${pressed ? 1 : 0}`)
    .join(',');
  return [
    lamps,
    relays,
    timers,
    buttons,
    snapshot.powered ? 1 : 0,
    snapshot.tripped ? 1 : 0,
    /*
     * ブレーカ・電源スイッチのハンドルは3Dで倒れる向きが変わる（利用者要望 2026-09-19）ので、
     * この2つも署名に入れる。`powered` だけでは「スイッチを切ったままブレーカを入れた」
     * 操作で絵が更新されない（`frameloop="demand"` は署名が変わらなければ描き直さない）。
     */
    snapshot.breakerOn ? 1 : 0,
    snapshot.switchOn ? 1 : 0,
    session?.wires.length ?? 0,
    Object.keys(session?.mounted ?? {}).join('/'),
    state.hoveredTerminal ?? '',
    state.pendingTerminal ?? '',
    state.selectedWire ?? '',
    // 選択中のソケットは3Dでも光らせる（利用者要望 2026-09-19）ので署名に入れる
    state.selectedSocket ?? '',
    // プローブの位置とハイライトは絵に効くので署名に入れる（§9.3 / §9.2）
    `${state.tester.black ?? ''}>${state.tester.red ?? ''}`,
    state.highlight.terminals.join(','),
    state.highlight.wireIds.join(','),
    state.mode,
    state.camera,
    // 同じプリセットを押し直しても視点は動く（`cameraNonce`）ので、署名にも入れる
    state.cameraNonce,
  ].join('|');
}

/** 見た目が変わったときだけ再描画を要求する。 */
function Invalidator(): null {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let previous = visualSignature(useStore.getState());
    invalidate();
    return useStore.subscribe((state) => {
      const next = visualSignature(state);
      if (next === previous) return;
      previous = next;
      invalidate();
    });
  }, [invalidate]);
  return null;
}

/**
 * ランプ・リレー・タイマ・押ボタンの「絵に効く値だけ」をスナップショットから抜き出す。§15
 *
 * `snapshot` をまるごと購読すると、電圧の小数点以下が動いただけの毎秒30枚のスナップショットで
 * この部分木が再描画され、その都度 R3F が props を突き合わせて `invalidate()` するため
 * `frameloop="demand"` が実質30fpsの常時描画になる（レビュー計測: アイドル中も約30fps）。
 * `useShallow` で「値の集合が変わったときだけ」再描画されるようにする。
 */
function useLampLevels(): Record<string, LampLevel> {
  return useStore(
    useShallow((s: AppState) => {
      const out: Record<string, LampLevel> = {};
      for (const [id, lamp] of Object.entries(s.snapshot.lamps)) out[id] = lamp.level;
      return out;
    }),
  );
}

/** 装着部品が励磁されているか（リレーのコイル／タイマの通電）。 */
function useEnergized(): Record<string, boolean> {
  return useStore(
    useShallow((s: AppState) => {
      const out: Record<string, boolean> = {};
      for (const [id, relay] of Object.entries(s.snapshot.relays)) out[id] = relay.coilOn;
      for (const [id, timer] of Object.entries(s.snapshot.timers)) {
        out[id] = (out[id] ?? false) || timer.powered;
      }
      return out;
    }),
  );
}

/** タイマの限時接点が動作したか（タイムアップ）。リレーは持たないので false のまま。§5.3.2 */
function useTimedOut(): Record<string, boolean> {
  return useStore(
    useShallow((s: AppState) => {
      const out: Record<string, boolean> = {};
      for (const [id, timer] of Object.entries(s.snapshot.timers)) out[id] = timer.timedOut;
      return out;
    }),
  );
}

/** 押ボタンが押されているか。 */
function useButtons(): Record<string, boolean> {
  return useStore(useShallow((s: AppState) => ({ ...s.snapshot.buttons })));
}

/** 盤のシーン本体（Canvas の中身）。 */
function BoardContents({
  board,
  onPick,
  onDragPick,
  onHover,
  onPress,
  onRelease,
  readoutRef,
  perfRef,
}: {
  /**
   * 描く盤。モードDだけ `withPlcUnit()` 済みの派生盤が来る（§10.1 / Task 10）。
   * モードB/C1/C2 は `JIPM_BOARD` のままなので挙動は変わらない。
   */
  board: BoardDefinition;
  onPick: (hit: PickHit) => void;
  /**
   * ドラッグ操作そのものが出すピック（Phase 7 Task 27）。`onPick` はドラッグを
   * 「視点を回しただけ」として捨てる見張り（`createPickDragGuard`）を通るので、
   * **ドラッグで配線・装着するときはこちらを使う**（捨てられては操作にならない）。
   */
  onDragPick: (hit: PickHit) => void;
  onHover: (id: TerminalId | undefined) => void;
  onPress: (pbId: string) => void;
  onRelease: (pbId: string) => void;
  /** E2E 用のカメラ状態の書き出し先（`Canvas` の外の隠し要素）。§14.2 */
  readoutRef: RefObject<HTMLDivElement | null>;
  /** 性能の計測窓の書き出し先（`Canvas` の外の隠し要素）。§15 / 決定表#16 */
  perfRef: RefObject<HTMLDivElement | null>;
}): JSX.Element {
  const session = useStore((s) => s.session);
  const lampLevels = useLampLevels();
  const energized = useEnergized();
  const timedOut = useTimedOut();
  const buttons = useButtons();
  // ブレーカ・電源スイッチのハンドルの向き（3Dの見た目にだけ効く）。§6.1
  const breakerOn = useStore((s) => s.snapshot.breakerOn);
  const switchOn = useStore((s) => s.snapshot.switchOn);
  const hovered = useStore((s) => s.hoveredTerminal);
  const pending = useStore((s) => s.pendingTerminal);
  const selectedWire = useStore((s) => s.selectedWire);
  // 部品パネルのカードが指しているソケット（3Dでも光らせる）。§8.2 利用者要望 2026-09-19
  const selectedSocket = useStore((s) => s.selectedSocket);
  const probeBlack = useStore((s) => s.tester.black);
  const probeRed = useStore((s) => s.tester.red);
  const highlightTerminals = useStore((s) => s.highlight.terminals);
  const highlightWires = useStore((s) => s.highlight.wireIds);
  const mode = useStore((s) => s.mode);
  const camera = useStore((s) => s.camera);
  const cameraNonce = useStore((s) => s.cameraNonce);
  // 運んでいるもの（部品パレットのカード／盤に載っている部品）。Phase 7 設計 §7.3.3
  const dragging = useStore((s) => s.dragging);
  const replaying = useStore((s) => s.replay !== undefined);
  const [controls, setControls] = useState<OrbitControlsLike | null>(null);
  const rotationStart = useRef<readonly [number, number] | undefined>(undefined);
  /** ポインタが乗っているソケット（ホバーの縁取りと落とし先の判定）。 */
  const [hoveredSocket, setHoveredSocket] = useState<SocketId | undefined>(undefined);
  /** ポインタが乗っている電源の操作部。 */
  const [hoveredFixture, setHoveredFixture] = useState<PowerFixture | undefined>(undefined);
  /** ドラッグ配線の始点（世界座標。仮の電線を伸ばす元）。 */
  const [wireDragFrom, setWireDragFrom] = useState<BoardTerminal | undefined>(undefined);
  const gl = useThree((state) => state.gl);

  /** 端子ごとの結線数（「2本で一杯」の判断と、つなげる端子の光らせ分けに使う）。§7.3.1 */
  const loads = useMemo(
    () => (session === undefined ? [] : terminalLoads(board, session)),
    [board, session],
  );
  /** いまの判断材料をひとまとめにしたもの（`intentOf()` / `legalTargets()` に渡す）。 */
  const interaction = useMemo<InteractionState>(
    () => ({
      mode,
      pendingTerminal: pending,
      selectedWire,
      wireColor: useStore.getState().wireColor,
      replaying,
      terminals: loads,
      dragging,
    }),
    [mode, pending, selectedWire, loads, dragging, replaying],
  );
  /**
   * 配線中に**つなげられる**端子の集合（配線していなければ undefined ＝ 光らせ分けをしない）。
   * 設計 §7.3.2「確定できる端子だけを光らせ、できない端子は灰のまま」。
   */
  const legalSet = useMemo(
    () => (pending === undefined ? undefined : new Set<string>(legalTargets(interaction))),
    [pending, interaction],
  );

  const { routes, errors: routeErrors } = useMemo(
    () => safeRoutes(board, session),
    [board, session],
  );
  /*
   * 経路が解けなかった電線は描けないので、理由をトーストとログに出す（盤は描き続ける）。§6.6
   * `routeErrors` は `session` が変わるたびに新しい配列になるため、そのまま依存に並べると
   * 無関係な操作のたびに同じトーストが出続ける。**どの電線が解けなかったか**が変わったときだけ
   * 出すよう、電線IDの集合を鍵にする。
   */
  const routeErrorKey = useMemo(
    () =>
      routeErrors
        .map((error) => error.wireId)
        .sort((a, b) => a.localeCompare(b))
        .join(','),
    [routeErrors],
  );
  const latestRouteErrors = useRef(routeErrors);
  latestRouteErrors.current = routeErrors;
  useEffect(() => {
    if (routeErrorKey.length === 0) return;
    const store = useStore.getState();
    for (const error of latestRouteErrors.current) {
      store.toast(
        `${JA.session.routeFailed}（${error.wireId}: ${JA.routeReason[error.reason]}）`,
        'error',
      );
      store.addLog(routeFailedLog(error.wireId, JA.routeReason[error.reason]));
    }
  }, [routeErrorKey]);
  const blocks = useMemo(() => {
    const out = new Map<string, typeof board.terminals>();
    for (const group of BLOCK_PARTS) {
      out.set(
        group.key,
        board.terminals.filter((t) => group.ids.some((id) => t.id.startsWith(`${id}.`))),
      );
    }
    return out;
  }, [board]);

  /**
   * ソケットごとの端子配列は**必ずメモ化する**。ここで毎回 `filter()` すると配列の同一性が変わり、
   * `Socket` の印字テクスチャ（`useMemo`）がスナップショットのたびに焼き直されて
   * メインスレッドを食い尽くす（クリックが受け付けられなくなる）。§15
   */
  /** 固定機器の端子（同一性を保つためメモ化する）。 */
  const fixtureTerminals = useMemo(
    () =>
      FIXTURES.map((fixture) => ({
        ...fixture,
        terminals: board.terminals.filter((t) => t.id.startsWith(`${fixture.id}.`)),
      })),
    [board],
  );

  /** DINレールを敷く端子のまとまり（これもメモ化して同一性を保つ）。 */
  const railTerminals = useMemo(
    () => [
      ...RAIL_GROUPS.map((ids) => ({
        key: ids.join('-'),
        terminals: board.terminals.filter((t) => ids.some((id) => t.id.startsWith(`${id}.`))),
      })),
      ...board.sockets.map((socket) => ({
        key: `rail-${socket.id}`,
        terminals: board.terminals.filter((t) => t.id.startsWith(`${socket.id}.`)),
      })),
    ],
    [board],
  );

  /** 机上の端子（PLC本体・壁コンセント）。同一性を保つためメモ化する。§15 */
  const deskTerminals = useMemo(() => offBoardTerminals(board), [board]);
  const plcTerminals = useMemo(
    () => deskTerminals.filter((t) => t.id.startsWith(`${PLC_PART_ID}.`)),
    [deskTerminals],
  );
  const outletTerminals = useMemo(
    () => deskTerminals.filter((t) => t.id.startsWith(`${OUTLET_ID}.`)),
    [deskTerminals],
  );

  const socketTerminals = useMemo(() => {
    const out = new Map<string, typeof board.terminals>();
    for (const socket of board.sockets) {
      out.set(
        socket.id,
        board.terminals.filter((t) => t.id.startsWith(`${socket.id}.`)),
      );
    }
    return out;
  }, [board]);

  /**
   * 盤の端子（ネジ端子と当たり判定球）は `TerminalField` が**1回でまとめて**描く。決定表#13
   * 盤に足した任意部品の**中身**が変われば作り直す（`session` の同一性は配線のたびに変わるので、
   * 配列そのものを依存に並べると端子の並びが変わっていなくても作り直しになる）。
   */
  const extraPartsKey = (session?.extraParts ?? []).join(',');
  const fieldTerminals = useMemo(
    () => boardFieldTerminals(board, extraPartsKey.length === 0 ? [] : extraPartsKey.split(',')),
    [board, extraPartsKey],
  );
  /**
   * ソケットの端子は役割IDで、それ以外は盤定義の印字で見せる（従来の2通りをここへ寄せる）。§8.2
   * 文言の組み立ては既存の `terminalTooltip()`（`TerminalHit.tsx`）に通す。`PlcUnit` /
   * `Outlet` が使っているのと同じ関数なので、盤と机上でツールチップの作り方が割れない。
   */
  const terminalTooltipOf = useCallback(
    (terminal: BoardTerminal): string => {
      const socket = board.sockets.find((s) => terminal.id.startsWith(`${s.id}.`));
      if (socket !== undefined) {
        return terminalTooltip(
          terminal,
          socketTerminalLabel(
            socket.id,
            session?.socketRoles[socket.id],
            session?.mounted[socket.id]?.kind,
            terminal,
          ),
        );
      }
      return terminalTooltip(terminal, polarityTerminalLabel(board, terminal) ?? '');
    },
    [board, session],
  );

  /*
   * 3Dの子へ渡すハンドラは**必ず `useCallback` で安定させる**。§15
   * 毎レンダーで新しい関数を作ると R3F が props の差分を検出して `invalidate()` を呼ぶため、
   * 絵が1ピクセルも変わらないスナップショット更新でも描画が走ってしまう。
   */
  const pickTerminal = useCallback(
    (terminal: BoardTerminal): void => {
      onPick({
        kind: 'terminal',
        id: terminal.id,
        wirable: terminal.wirable,
        label: terminal.label,
      });
    },
    [onPick],
  );

  const pickSocket = useCallback(
    (socketId: SocketId, occupied: boolean): void => {
      onPick({ kind: 'socket', id: socketId, occupied });
    },
    [onPick],
  );

  const pickWire = useCallback(
    (wireId: string, locked: boolean): void => {
      onPick({ kind: 'wire', id: wireId, locked });
    },
    [onPick],
  );

  /*
   * Blender 風の中ボタン割り当て（§12.2 / 2026-09-14 の利用者要望）。
   * three の `OrbitControls` は修飾キー付きのボタン割り当てを持たないので、
   * Shift / Ctrl の上げ下げのたびに `mouseButtons.MIDDLE` を差し替える。
   * ボタン割り当てを props で渡すと再描画のたびに上書きされてしまうため、
   * 左右も含めてここで一度だけ入れる（唯一の情報源にする）。
   */
  useEffect(() => {
    if (controls === null) return undefined;
    const apply = (shift: boolean, ctrl: boolean): void => {
      // three は修飾キーで回転と平行移動を入れ替えるので、左右の割り当ても打ち消して入れ直す
      const held = shift || ctrl;
      controls.mouseButtons.LEFT = MOUSE_FOR_ACTION[mouseButtonAssignment('rotate', held)];
      /*
       * 右ボタンは中ボタンの別名にする（2026-09-19 の利用者要望）。中ボタンの無いマウスや
       * ノートPCのタッチパッドでも「押して引けば回る」を成立させるため、素＝回転 /
       * Shift＝平行移動 / Ctrl＝ズーム を中ボタンとまったく同じ表にする。
       */
      controls.mouseButtons.RIGHT = MOUSE_FOR_ACTION[middleButtonAssignmentFor({ shift, ctrl })];
      controls.mouseButtons.MIDDLE = MOUSE_FOR_ACTION[middleButtonAssignmentFor({ shift, ctrl })];
    };
    apply(false, false);
    const onKey = (event: KeyboardEvent): void => {
      apply(event.shiftKey, event.ctrlKey || event.metaKey);
    };
    // 修飾キーを押したまま別の窓へ移ると `keyup` が来ないので、戻ってきたときに素の割り当てへ戻す
    const onBlur = (): void => {
      apply(false, false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [controls]);

  /**
   * カメラの向き・距離・注視点を隠し要素へ書く（E2E の窓。§14.2）。
   * React の状態にすると毎フレーム再描画になるので、DOM へ直接書く（§15）。
   */
  const writeReadout = useCallback((): void => {
    const node = readoutRef.current;
    if (node === null || controls === null) return;
    node.textContent = cameraReadoutText({
      azimuth: controls.getAzimuthalAngle(),
      polar: controls.getPolarAngle(),
      distance: controls.getDistance(),
      target: [controls.target.x, controls.target.y, controls.target.z],
    });
  }, [controls, readoutRef]);
  useEffect(writeReadout, [writeReadout]);

  /* ---------------------------------------------------------------------- *
   * 直接操作（Phase 7 Task 27 / 設計 §7.3・利用者要望9）
   * 「クリックして電源を入れる」「端子から端子へドラッグして配線する」
   * 「部品をつまんでソケットへ置く」の入口。判断そのものは `intentOf()` が持つ。
   * ---------------------------------------------------------------------- */

  /** 押し始めの位置と対象（クリックとドラッグの振り分けに使う）。 */
  const press = useRef<{
    x: number;
    y: number;
    terminal: BoardTerminal | undefined;
    part: { socketId: SocketId; kind: MountableKind } | undefined;
    /** 4px を超えて運搬・配線ドラッグに入ったか。 */
    started: boolean;
    /** 端子やソケットの上で放して、すでに処理したか。 */
    consumed: boolean;
    /** 4px を超えて動いたか（`started` と違い、キャンバスの外から始めた運搬でも立つ）。 */
    moved: boolean;
    /** 押し始めがキャンバスの上だったか（パレットのカードから始めた運搬と区別する）。 */
    onCanvas: boolean;
  }>({
    x: 0,
    y: 0,
    terminal: undefined,
    part: undefined,
    started: false,
    consumed: false,
    moved: false,
    onCanvas: false,
  });

  const onPressTerminal = useCallback(
    (terminal: BoardTerminal): void => {
      if (useStore.getState().replay !== undefined) return;
      press.current = { ...press.current, terminal, part: undefined, started: false };
      // 端子の上から引いたら**視点は回さない**（設計 §7.3.1）。放すまで軌道操作を黙らせる
      if (controls !== null) controls.enabled = dragKindOf(press.current) === 'view';
    },
    [controls],
  );

  const onPressPart = useCallback(
    (socketId: SocketId, kind: MountableKind): void => {
      if (useStore.getState().replay !== undefined) return;
      press.current = {
        ...press.current,
        terminal: undefined,
        part: { socketId, kind },
        started: false,
      };
      if (controls !== null) controls.enabled = dragKindOf(press.current) === 'view';
    },
    [controls],
  );

  const onReleaseTerminal = useCallback(
    (terminal: BoardTerminal): void => {
      const state = press.current;
      if (!state.started || state.terminal === undefined) return;
      state.consumed = true;
      if (terminal.id === state.terminal.id) return;
      onDragPick({
        kind: 'terminal',
        id: terminal.id,
        wirable: terminal.wirable,
        label: terminal.label,
      });
    },
    [onDragPick],
  );

  const onReleaseSocket = useCallback(
    (socketId: SocketId, occupied: boolean): void => {
      if (useStore.getState().dragging === undefined) return;
      /*
       * キャンバスの上で押し始めてそのまま放した（＝ただのクリック）ときは `onClick` が
       * 受け持つので、ここでは何もしない。二重に流すと1回の操作で2回装着してしまう。
       * 運んできた部品（パレットから ＝ `!onCanvas`）と、盤の上で始めた運搬（`started`）
       * だけがここを通る。
       */
      if (press.current.onCanvas && !press.current.started) return;
      press.current.consumed = true;
      onDragPick({ kind: 'socket', id: socketId, occupied });
    },
    [onDragPick],
  );

  const onHoverSocket = useCallback((socketId: SocketId | undefined): void => {
    setHoveredSocket(socketId);
  }, []);
  const onHoverBreaker = useCallback((entered: boolean): void => {
    setHoveredFixture(entered ? 'breaker' : undefined);
  }, []);
  const onHoverSwitch = useCallback((entered: boolean): void => {
    setHoveredFixture(entered ? 'switch' : undefined);
  }, []);
  const onToggleBreaker = useCallback((): void => {
    onPick({ kind: 'fixture', fixture: 'breaker' });
  }, [onPick]);
  const onToggleSwitch = useCallback((): void => {
    onPick({ kind: 'fixture', fixture: 'switch' });
  }, [onPick]);

  /*
   * ポインタの作法（設計 §7.3.1）。`setPointerCapture` は three の `OrbitControls` が
   * 既にキャンバスへ掛けているので二重には掛けず、**窓口（`window`）**で `pointermove` /
   * `pointerup` を拾う（キャンバスの外で放しても取りこぼさない、という目的は同じ）。
   */
  useEffect(() => {
    const finish = (dropCarried: boolean): void => {
      press.current = {
        x: 0,
        y: 0,
        terminal: undefined,
        part: undefined,
        started: false,
        consumed: false,
        moved: false,
        onCanvas: false,
      };
      if (controls !== null) controls.enabled = true;
      setWireDragFrom(undefined);
      if (dropCarried) useStore.getState().setDragging(undefined);
    };
    const onDown = (event: PointerEvent): void => {
      press.current = {
        x: event.clientX,
        y: event.clientY,
        terminal: undefined,
        part: undefined,
        started: false,
        consumed: false,
        moved: false,
        onCanvas: event.target === gl.domElement,
      };
    };
    const onMove = (event: PointerEvent): void => {
      const state = press.current;
      if (event.buttons === 0) return;
      if (
        Math.hypot(event.clientX - state.x, event.clientY - state.y) >= INTERACT_DRAG_THRESHOLD_PX
      ) {
        state.moved = true;
      }
      if (state.started || !state.moved) return;
      if (state.terminal === undefined && state.part === undefined) return;
      state.started = true;
      if (dragKindOf(state) === 'wire' && state.terminal !== undefined) {
        // 1本目として選び（仮の電線が伸び始める）、つなげる端子だけが緑になる
        setWireDragFrom(state.terminal);
        onDragPick({
          kind: 'terminal',
          id: state.terminal.id,
          wirable: state.terminal.wirable,
          label: state.terminal.label,
        });
      } else if (dragKindOf(state) === 'carry' && state.part !== undefined) {
        useStore
          .getState()
          .setDragging({ source: 'socket', socketId: state.part.socketId, kind: state.part.kind });
      }
    };
    const onUp = (): void => {
      const state = press.current;
      // 端子・ソケット以外で放した: 配線は取り消し、運んでいた部品は取り外しになる
      if (state.started && !state.consumed) onDragPick({ kind: 'empty' });
      /*
       * パレットのカードを**押しただけ**（動かさずに放した）ときは手の中身を残す。
       * 「カードを押す → ソケットを押す」のクリック2回の経路（キーボード利用者のための
       * 経路。設計 §7.3.3）がここで切れてしまわないようにするため。
       */
      const keepCarried = !state.onCanvas && !state.moved && !state.consumed;
      finish(!keepCarried);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (!press.current.started && useStore.getState().dragging === undefined) return;
      // 配線そのものの取り消し（`cancelWire`）は `Session` の Escape が受け持つ
      finish(true);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [controls, onDragPick, gl]);

  /**
   * カーソルとホバー予告（設計 §7.3.4）。**予告は意図から作る**ので、
   * 「押すと何が起きるか」と実際に起きることがずれない。
   */
  const mountedAt = useCallback(
    (socketId: SocketId): boolean => session?.mounted[socketId] !== undefined,
    [session],
  );
  useEffect(() => {
    const hit: PickHit | undefined =
      hoveredFixture !== undefined
        ? { kind: 'fixture', fixture: hoveredFixture }
        : hoveredSocket !== undefined
          ? { kind: 'socket', id: hoveredSocket, occupied: mountedAt(hoveredSocket) }
          : hovered !== undefined
            ? { kind: 'terminal', id: hovered, wirable: true, label: '' }
            : undefined;
    const subject: PointerSubject =
      hoveredFixture !== undefined
        ? 'press'
        : hoveredSocket !== undefined
          ? mountedAt(hoveredSocket)
            ? 'grab'
            : 'press'
          : hovered !== undefined
            ? 'terminal'
            : 'ground';
    gl.domElement.style.cursor = cursorFor(subject, dragging !== undefined);
    const carrying =
      dragging === undefined
        ? undefined
        : dragging.source === 'palette'
          ? JA.hoverHint.carrying
          : JA.hoverHint.carryingMounted;
    useStore
      .getState()
      .setHoverHint(
        hit === undefined ? carrying : hoverHintFor(interaction, hit, { breakerOn, switchOn }),
      );
  }, [
    hoveredFixture,
    hoveredSocket,
    hovered,
    dragging,
    interaction,
    breakerOn,
    switchOn,
    mountedAt,
    gl,
  ]);

  /** 仮の電線の始点（世界座標）。端子が変わったときだけ作り直す（`WireDragLayer` の依存）。 */
  const wireDragOrigin = useMemo<[number, number, number] | undefined>(
    () => (wireDragFrom === undefined ? undefined : boardToWorld(toScene(wireDragFrom.pos))),
    [wireDragFrom],
  );

  return (
    <>
      <Invalidator />
      <PerfProbe nodeRef={perfRef} />
      <color attach="background" args={['#141820']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[220, 520, 420]} intensity={1.6} />
      <directionalLight position={[-320, 180, 360]} intensity={0.6} />
      {/* 盤は傾斜コンソール。盤ローカル（+Z が盤面の法線）を机の上に寝かせて手前に起こす。§6.5 */}
      <group rotation={[BOARD_TILT_RAD, 0, 0]}>
        <BoardPlate board={board} />
        {railTerminals.map((rail) => (
          <DinRail key={rail.key} terminals={rail.terminals} />
        ))}
        {fixtureTerminals.map((fixture) => (
          <Fixture
            key={fixture.id}
            name={fixture.id}
            label={fixture.label}
            color={fixture.color}
            kind={fixture.kind}
            terminals={fixture.terminals}
            footprints={board.footprints}
            on={fixture.kind === 'breaker' ? breakerOn : fixture.kind === 'switch' && switchOn}
            {...(FIXTURE_LABEL_OFFSET_MM[fixture.id] === undefined
              ? {}
              : { labelOffsetMm: FIXTURE_LABEL_OFFSET_MM[fixture.id] })}
            {
              /*
              電源の操作部を押せるようにするのは組立（モードB/D）だけ。点検（C1/C2）は
              テスターと指摘が3Dのクリックを使っており、入切は2Dの `PowerControls` が
              受け持つ（`session/tester.ts` の注記）。渡さなければ従来どおりの飾りに戻る。
            */ ...(mode === 'tester' || mode === 'report'
                ? {}
                : fixture.kind === 'breaker'
                  ? { onToggle: onToggleBreaker, onHover: onHoverBreaker }
                  : fixture.kind === 'switch'
                    ? { onToggle: onToggleSwitch, onHover: onHoverSwitch }
                    : {})
            }
          />
        ))}
        <FixedWires board={board} />

        {/*
          盤の端子はここで**まとめて1回**描く（§15 / 決定表#13）。ソケット・端子台は
          筐体と印字だけを描き、端子は持たない。机上の端子（PLC本体・壁コンセント）は
          `PlcUnit` / `PlcRack` / `Outlet` はそれぞれ `TerminalField` で描く。
        */}
        <TerminalField
          terminals={fieldTerminals}
          tooltipOf={terminalTooltipOf}
          hovered={hovered}
          pending={pending}
          legal={legalSet}
          onHover={onHover}
          onPick={pickTerminal}
          onPress={onPressTerminal}
          onRelease={onReleaseTerminal}
        />

        {board.sockets.map((socket) => {
          const role = session?.socketRoles[socket.id];
          const mounted = session?.mounted[socket.id];
          const terminals = socketTerminals.get(socket.id) ?? [];
          return (
            <group key={socket.id}>
              <Socket
                socket={socket}
                role={role}
                occupied={mounted !== undefined}
                selected={selectedSocket === socket.id}
                hovered={hoveredSocket === socket.id}
                /* 運んできた部品を置けるソケットは全部光らせる（どこへ置けるかが先に分かる） */
                droppable={dragging?.source === 'palette' && mounted === undefined}
                terminals={terminals}
                onPickSocket={pickSocket}
                onHoverSocket={onHoverSocket}
                onReleaseSocket={onReleaseSocket}
              />
              {mounted === undefined || role === undefined ? null : (
                <MountedPart
                  socket={socket}
                  role={role}
                  part={mounted}
                  energized={energized[role] === true}
                  timedOut={timedOut[role] === true}
                  selected={selectedSocket === socket.id}
                  hovered={hoveredSocket === socket.id}
                  onPickSocket={pickSocket}
                  onHoverSocket={onHoverSocket}
                  onPressPart={onPressPart}
                  onReleaseSocket={onReleaseSocket}
                />
              )}
            </group>
          );
        })}

        {BLOCK_PARTS.map((block) => (
          <TerminalBlock
            key={block.key}
            name={block.key}
            label={block.label}
            {...(block.labelOffsetMm === undefined ? {} : { labelOffsetMm: block.labelOffsetMm })}
            terminals={blocks.get(block.key) ?? []}
          />
        ))}

        {board.lamps.map((lamp) => (
          <Lamp key={lamp.id} definition={lamp} level={lampLevels[lamp.id] ?? 'off'} />
        ))}

        {board.pushButtons.map((pb) => (
          <PushButton
            key={pb.id}
            definition={pb}
            pressed={buttons[pb.id] === true}
            onPress={onPress}
            onRelease={onRelease}
          />
        ))}

        {routes.map((route) => {
          const wire = session?.wires.find((w) => w.id === route.wireId);
          if (wire === undefined) return null;
          return (
            <Wire
              key={route.wireId}
              route={route}
              color={wire.color}
              locked={wire.locked}
              /*
               * 連動ハイライト（§9.2）は電線の「選択中」表示を流用する。強調の描き方を
               * 2つ持つと色の優先順位を `wireBodyColor()` の外で決めることになり、
               * どちらが勝つかがファイルをまたいで散らばる。
               */
              selected={selectedWire === route.wireId || highlightWires.includes(route.wireId)}
              pickable={mode === 'delete' || mode === 'report'}
              onPick={pickWire}
            />
          );
        })}

        {/* 机上のPLC本体・壁コンセント・渡りケーブル（モードDの盤だけが持つ）。§10.1 */}
        {board.plcUnit === undefined ? null : (
          <>
            {/* 一体形は本体1枚、ラック形はベース＋モジュール（§10.1 / 決定表#17） */}
            {board.plcUnit.form === 'rack' ? (
              <PlcRack
                unit={board.plcUnit}
                terminals={plcTerminals}
                hoveredTerminal={hovered}
                pendingTerminal={pending}
                onHoverTerminal={onHover}
                onPickTerminal={pickTerminal}
              />
            ) : (
              <PlcUnit
                unit={board.plcUnit}
                terminals={plcTerminals}
                hoveredTerminal={hovered}
                pendingTerminal={pending}
                onHoverTerminal={onHover}
                onPickTerminal={pickTerminal}
              />
            )}
            <Outlet
              terminals={outletTerminals}
              hoveredTerminal={hovered}
              pendingTerminal={pending}
              onHoverTerminal={onHover}
              onPickTerminal={pickTerminal}
            />
            {session === undefined ? null : <DeskWires board={board} session={session} />}
          </>
        )}

        {session === undefined ? null : (
          <ProbeMarkers
            probes={{ black: probeBlack, red: probeRed }}
            highlightTerminals={highlightTerminals}
            roles={session.socketRoles}
            board={board}
          />
        )}
      </group>

      {/*
        配線中の仮の電線（設計 §7.3.2）。盤の傾斜（`group`）の**外**に置いて世界座標で描く。
        指先の位置は毎フレーム変わるので、`WireDragLayer` が自分の中だけで状態を持つ
        （ここで状態にすると盤の部分木ごと再描画になる。§15）。
      */}
      <WireDragLayer from={wireDragOrigin} legal={legalSet !== undefined} />

      {/*
        操作は Blender に合わせる（§12.2 / 2026-09-14・2026-09-19 の利用者要望）。
        左ドラッグ・中ドラッグ・右ドラッグ＝軌道回転、Shift＋中／右ドラッグ＝平行移動、
        Ctrl＋中／右ドラッグ・ホイール＝ズーム。`zoomToCursor` でホイールは
        ポインタの指す位置へ寄る（Blender と同じ）。ボタンの割り当ては上の効果が入れる。
        `screenSpacePanning` は Blender と同じ画面平面の平行移動。
        `maxPolarAngle` で盤の裏側へ回り込まないようにし、注視点は盤の中心に固定する。
        慣性（ダンピング）あり（§12.2「慣性（ダンピング）あり」）。`frameloop="demand"` と
        矛盾しない: drei の `OrbitControls` は内部の three-stdlib コントロールが発火する
        `change` イベントのたびに自分で `invalidate()` を呼ぶ
        （`node_modules/@react-three/drei/core/OrbitControls.js`）。減衰が進んでいる間は
        毎フレームの `update()` が `change` を発火し続けて描画が続き、速度が閾値を下回って
        `change` が止まれば `invalidate()` の呼び出しも止まって自然に描画が止まる
        （ドラッグ／ホイール操作そのものも同じ仕組みで既に毎フレーム描画されていたので、
        常時描画にはならない）。drei が自前で invalidate するため、ここでの
        `onChange={() => invalidate()}` は不要（冗長）なので付けていない。
      */}
      <OrbitControls
        makeDefault
        onStart={() => {
          rotationStart.current =
            controls === null
              ? undefined
              : [controls.getAzimuthalAngle(), controls.getPolarAngle()];
        }}
        onEnd={() => {
          if (
            controls !== null &&
            rotationStart.current !== undefined &&
            tourRotationChanged(rotationStart.current, [
              controls.getAzimuthalAngle(),
              controls.getPolarAngle(),
            ])
          )
            useTourStore.getState().advance('rotate');
          rotationStart.current = undefined;
        }}
        enableDamping
        dampingFactor={ORBIT_FEEL.dampingFactor}
        rotateSpeed={ORBIT_FEEL.rotateSpeed}
        zoomSpeed={ORBIT_FEEL.zoomSpeed}
        zoomToCursor
        screenSpacePanning
        minDistance={MIN_CAMERA_DISTANCE_MM}
        maxDistance={MAX_CAMERA_DISTANCE_MM}
        minPolarAngle={MIN_POLAR_ANGLE_RAD}
        maxPolarAngle={MAX_POLAR_ANGLE}
        onChange={writeReadout}
        ref={(instance) => {
          setControls(instance);
        }}
      />
      <CameraPresets preset={camera} nonce={cameraNonce} controls={controls} />
      <ViewGizmo controls={controls} />
      {/*
        名札の重なり取り（UI監査バッチE）。drei の `<Html>` が名札を置いた**後**に走らせたいので、
        `useFrame` の登録がいちばん最後になるよう、必ずこの位置（最後の子）に置く。
      */}
      <LabelDeclutter />
    </>
  );
}

/**
 * 3Dビューポート。§13 #4
 * `webglcontextlost` を捕まえたら `key` を変えて `Canvas` を丸ごと作り直す。
 * 盤の状態は Worker とストアが持っているので、シーンを捨てても失われない。
 *
 * `memo()` で包むのは §15 の性能目標のため。親（`Session`）は経過時間やライブチャートで
 * 毎秒何度も再描画されるが、渡ってくる4つのハンドラはすべて `useCallback` で安定しているので、
 * ここで止めれば `Canvas` の中身が巻き添えで再描画されることがなくなる。
 */
function BoardSceneImpl({
  board = JIPM_BOARD,
  onPick,
  onHover,
  onPress,
  onRelease,
}: {
  /**
   * 描く盤。省略すると `JIPM_BOARD`（モードB/C1/C2 はこれまでどおり）。
   * モードDは `boardForProblem()` が返す派生盤を渡す（§10.1 / Task 10）。
   */
  board?: BoardDefinition;
  onPick: (hit: PickHit) => void;
  onHover: (id: TerminalId | undefined) => void;
  onPress: (pbId: string) => void;
  onRelease: (pbId: string) => void;
}): JSX.Element {
  const [generation, setGeneration] = useState(0);
  const setWebglLost = useStore((s) => s.setWebglLost);
  const webglLost = useStore((s) => s.webglLost);
  const detachContext = useRef<(() => void) | undefined>(undefined);
  const tourCanvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(
    () => () => {
      detachContext.current?.();
      if (useTourStore.getState().canvas === tourCanvas.current)
        useTourStore.getState().setCanvas(null);
    },
    [],
  );
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const perfRef = useRef<HTMLDivElement | null>(null);

  /*
   * 視点を回したあとのクリックで盤を拾わないようにする（§12.2 / 2026-09-14 の利用者要望）。
   * R3F の `onClick` には移動量のしきい値が無いので、端子の上から左ドラッグで回すと
   * 放した瞬間にその端子を拾って配線が始まってしまう。押した位置からの移動量を見張り、
   * ドラッグだったらピックを捨てる（回転はできて、誤配線は起きない）。
   */
  const dragGuard = useMemo(() => createPickDragGuard(INTERACT_DRAG_THRESHOLD_PX), []);
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      dragGuard.down(event.clientX, event.clientY);
    };
    const onMove = (event: PointerEvent): void => {
      // ボタンを押していない移動（ただのホバー）は数えない
      if (event.buttons === 0) return;
      dragGuard.move(event.clientX, event.clientY);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
    };
  }, [dragGuard]);
  const guardedPick = useCallback(
    (hit: PickHit): void => {
      if (dragGuard.dragged()) return;
      onPick(hit);
    },
    [dragGuard, onPick],
  );

  return (
    <>
      {webglLost ? (
        <div className="webgl-notice" role="alert">
          <p>{JA.error.webglLost}</p>
          <button
            type="button"
            onClick={() => {
              setWebglLost(false);
              setGeneration((value) => value + 1);
            }}
          >
            {JA.error.webglRetry}
          </button>
        </div>
      ) : null}
      <Canvas
        key={generation}
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ fov: CAMERA_FOV_DEG, near: 1, far: 4000, position: [0, 0, 380] }}
        data-testid="board-canvas"
        onPointerMissed={() => {
          guardedPick({ kind: 'empty' });
        }}
        onCreated={({ gl }) => {
          tourCanvas.current = gl.domElement;
          useTourStore.getState().setCanvas(gl.domElement);
          /*
           * 3D-01: `gl.info` の自動リセットを止める。止めないと、ビューキューブ（drei の `Hud`）が
           * 1フレームに2回呼ぶ `gl.render()` の2回目で数値が上書きされ、性能の門は**ギズモ単体の
           * 値**しか測らない。止めたぶんは `PerfProbe` が毎フレーム自分で戻す。
           */
          configurePerfCounters(gl);
          detachContext.current?.();
          setWebglLost(false);
          detachContext.current = observeWebGlContext(gl.domElement, setWebglLost);
        }}
      >
        <BoardContents
          board={board}
          onPick={guardedPick}
          onDragPick={onPick}
          onHover={onHover}
          onPress={onPress}
          onRelease={onRelease}
          readoutRef={readoutRef}
          perfRef={perfRef}
        />
      </Canvas>
      {/* E2E からカメラの向き・距離・注視点を読むための隠し要素（画面には出ない）。§14.2 */}
      <div data-testid="camera-readout" hidden ref={readoutRef} />
      {/* 性能の計測窓（§15 / Plan 5 決定表#16）。画面には出ない */}
      <div data-testid="perf-readout" hidden ref={perfRef} />
    </>
  );
}

/** 3Dビューポート（親の再描画で巻き添えにならないよう `memo` する）。§15 */
export const BoardScene = memo(BoardSceneImpl);
