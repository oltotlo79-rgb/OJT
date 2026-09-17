import {
  JIPM_BOARD,
  routeSession,
  routeWire,
  RoutingError,
  toPhysicalTerminal,
  type BoardDefinition,
  type BoardSession,
  type BoardTerminal,
  type SocketId,
  type WireRoute,
} from '@ojt/board-model';
import type { LampLevel, TerminalId } from '@ojt/circuit-sim';
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
import { useStore, type AppState } from '../app/store.js';
import { JA, routeFailedLog } from '../i18n/ja.js';
import type { PickHit } from '../session/interaction.js';
import { BoardPlate } from './BoardPlate.js';
import {
  BOARD_TILT_RAD,
  CAMERA_FOV_DEG,
  MAX_CAMERA_DISTANCE_MM,
  MAX_POLAR_ANGLE,
  MIN_CAMERA_DISTANCE_MM,
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
import { DinRail } from './DinRail.js';
import { FixedWires } from './FixedWires.js';
import { Fixture, FIXTURES } from './Fixtures.js';
import { Lamp } from './Lamp.js';
import { MountedPart } from './MountedPart.js';
import { ProbeMarkers } from './ProbeMarkers.js';
import { PushButton } from './PushButton.js';
import { Socket } from './Socket.js';
import { TerminalBlock } from './TerminalBlock.js';
import { ViewGizmo } from './ViewGizmo.js';
import { Wire } from './Wire.js';

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
 * 視点操作の効き（Blender の操作感に寄せる。§12.2 / 2026-09-14 の利用者要望）。
 * 回転はやや控えめ、ズームは素直、慣性は 0.1（約0.5秒で止まる）。
 */
const ORBIT_FEEL = { rotateSpeed: 0.7, zoomSpeed: 0.9, dampingFactor: 0.1 } as const;

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

/** 例外から1行の理由を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    session?.wires.length ?? 0,
    Object.keys(session?.mounted ?? {}).join('/'),
    state.hoveredTerminal ?? '',
    state.pendingTerminal ?? '',
    state.selectedWire ?? '',
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

/** 押ボタンが押されているか。 */
function useButtons(): Record<string, boolean> {
  return useStore(useShallow((s: AppState) => ({ ...s.snapshot.buttons })));
}

/** 盤のシーン本体（Canvas の中身）。 */
function BoardContents({
  onPick,
  onHover,
  onPress,
  onRelease,
  readoutRef,
}: {
  onPick: (hit: PickHit) => void;
  onHover: (id: TerminalId | undefined) => void;
  onPress: (pbId: string) => void;
  onRelease: (pbId: string) => void;
  /** E2E 用のカメラ状態の書き出し先（`Canvas` の外の隠し要素）。§14.2 */
  readoutRef: RefObject<HTMLDivElement | null>;
}): JSX.Element {
  const session = useStore((s) => s.session);
  const lampLevels = useLampLevels();
  const energized = useEnergized();
  const buttons = useButtons();
  const hovered = useStore((s) => s.hoveredTerminal);
  const pending = useStore((s) => s.pendingTerminal);
  const selectedWire = useStore((s) => s.selectedWire);
  const probeBlack = useStore((s) => s.tester.black);
  const probeRed = useStore((s) => s.tester.red);
  const highlightTerminals = useStore((s) => s.highlight.terminals);
  const highlightWires = useStore((s) => s.highlight.wireIds);
  const mode = useStore((s) => s.mode);
  const camera = useStore((s) => s.camera);
  const cameraNonce = useStore((s) => s.cameraNonce);
  const [controls, setControls] = useState<OrbitControlsLike | null>(null);

  const board = JIPM_BOARD;
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
      controls.mouseButtons.RIGHT = MOUSE_FOR_ACTION[mouseButtonAssignment('pan', held)];
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

  return (
    <>
      <Invalidator />
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
          />
        ))}
        <FixedWires board={board} />

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
                terminals={terminals}
                hoveredTerminal={hovered}
                pendingTerminal={pending}
                onHoverTerminal={onHover}
                onPickTerminal={pickTerminal}
                onPickSocket={pickSocket}
              />
              {mounted === undefined || role === undefined ? null : (
                <MountedPart
                  socket={socket}
                  role={role}
                  part={mounted}
                  energized={energized[role] === true}
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
            hoveredTerminal={hovered}
            pendingTerminal={pending}
            onHoverTerminal={onHover}
            onPickTerminal={pickTerminal}
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

        {session === undefined ? null : (
          <ProbeMarkers
            probes={{ black: probeBlack, red: probeRed }}
            highlightTerminals={highlightTerminals}
            roles={session.socketRoles}
          />
        )}
      </group>

      {/*
        操作は Blender に合わせる（§12.2 / 2026-09-14 の利用者要望）。
        左ドラッグ・中ドラッグ＝軌道回転、Shift＋中／右ドラッグ＝平行移動、
        Ctrl＋中ドラッグ／ホイール＝ズーム。ボタンの割り当ては上の効果が入れる。
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
        enableDamping
        dampingFactor={ORBIT_FEEL.dampingFactor}
        rotateSpeed={ORBIT_FEEL.rotateSpeed}
        zoomSpeed={ORBIT_FEEL.zoomSpeed}
        screenSpacePanning
        minDistance={MIN_CAMERA_DISTANCE_MM}
        maxDistance={MAX_CAMERA_DISTANCE_MM}
        maxPolarAngle={MAX_POLAR_ANGLE}
        onChange={writeReadout}
        ref={(instance) => {
          setControls(instance);
        }}
      />
      <CameraPresets preset={camera} nonce={cameraNonce} controls={controls} />
      <ViewGizmo controls={controls} />
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
  onPick,
  onHover,
  onPress,
  onRelease,
}: {
  onPick: (hit: PickHit) => void;
  onHover: (id: TerminalId | undefined) => void;
  onPress: (pbId: string) => void;
  onRelease: (pbId: string) => void;
}): JSX.Element {
  const [generation, setGeneration] = useState(0);
  const setWebglLost = useStore((s) => s.setWebglLost);
  const readoutRef = useRef<HTMLDivElement | null>(null);

  /*
   * 視点を回したあとのクリックで盤を拾わないようにする（§12.2 / 2026-09-14 の利用者要望）。
   * R3F の `onClick` には移動量のしきい値が無いので、端子の上から左ドラッグで回すと
   * 放した瞬間にその端子を拾って配線が始まってしまう。押した位置からの移動量を見張り、
   * ドラッグだったらピックを捨てる（回転はできて、誤配線は起きない）。
   */
  const dragGuard = useMemo(() => createPickDragGuard(), []);
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
          const canvas = gl.domElement;
          canvas.addEventListener(
            'webglcontextlost',
            (event) => {
              event.preventDefault();
              setWebglLost(true);
              setGeneration((value) => value + 1);
            },
            { once: true },
          );
          canvas.addEventListener(
            'webglcontextrestored',
            () => {
              setWebglLost(false);
            },
            { once: true },
          );
          setWebglLost(false);
        }}
      >
        <BoardContents
          onPick={guardedPick}
          onHover={onHover}
          onPress={onPress}
          onRelease={onRelease}
          readoutRef={readoutRef}
        />
      </Canvas>
      {/* E2E からカメラの向き・距離・注視点を読むための隠し要素（画面には出ない）。§14.2 */}
      <div data-testid="camera-readout" hidden ref={readoutRef} />
    </>
  );
}

/** 3Dビューポート（親の再描画で巻き添えにならないよう `memo` する）。§15 */
export const BoardScene = memo(BoardSceneImpl);
