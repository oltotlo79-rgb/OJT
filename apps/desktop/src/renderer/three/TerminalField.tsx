import { isOffBoardTerminal, type BoardDefinition, type BoardTerminal } from '@ojt/board-model';
import { parseTerminalId, type TerminalId } from '@ojt/circuit-sim';
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import {
  TERMINAL_HOVER_COLOR,
  TERMINAL_PENDING_COLOR,
  TERMINAL_SCREW_COLOR,
} from '../session/colors.js';
import { toScene } from './coords.js';
import {
  applyInstanceMatrices,
  INVISIBLE_MATERIAL,
  noPick,
  PICK_GEOMETRY,
  SCREW_GEOMETRY,
  sharedMaterial,
} from './materials.js';
import {
  HOVER_RING_GEOMETRY,
  terminalScrewAppearance,
  terminalTooltip,
  TERMINAL_HOVER_EMISSIVE_INTENSITY,
} from './TerminalHit.js';

/**
 * 盤の端子をまとめて描く。設計仕様 §6.5 / §15 / Plan 5 決定表#13・#14。
 *
 * `TerminalHit` は端子1個につき `<group>` ＋ ネジの mesh ＋ 当たり判定の mesh を作る。
 * 盤の端子は134個なので 268 個のメッシュになり、ドローコールも同数になる（§15 の
 * 「60fps・三角形20万以下」の足を引っ張るのはここが最大）。ここでは
 * **`instancedMesh` 2本**（ネジ頭＝見える／当たり判定＝不可視）にまとめ、
 * 状態の色は `instanceColor` に載せる。
 *
 * 当たり判定の mesh は `visible={false}` のままイベントを拾う（`TerminalHit` と同じ手）。
 * `instancedMesh` のレイキャストは `event.instanceId` を返すので、添字から端子を引く。
 * 当たり判定球の位置（端子の真上 `PICK_LIFT_MM`）と大きさ（`pickRadiusMm`）は
 * `TerminalHit` と1mmも変えない。ここを変えると 2026-09-19 の `P.1` の不具合
 * （`terminal-pick.test.ts`）と同じことが起きる。
 *
 * ホバー中の1個だけは**上から実体のメッシュを重ねる**（発光するネジ＋光る輪）。
 * `instanceColor` は色しか持てず、`emissive` は載らないので、2026-09-19 に足した
 * 「遠目でも分かるホバー」（`terminalScrewAppearance()` と `HOVER_RING_GEOMETRY`）は
 * インスタンスでは再現できない。ホバーは**常に1個**なので、重ねる枚数は2枚で済む。
 * ツールチップも同じところで1個だけ出す（以前は端子ごとに条件分岐していた）。
 * 連動ハイライトはここでは描かない（`ProbeMarkers` の輪が受け持つ。決定表#14）。
 */

/**
 * 机上の端子（PLC本体・ラック・壁コンセント）のツールチップ。3D-12
 * 盤定義の印字をそのまま見せる。**モジュール直下の関数**にしてあるのは、`TerminalField` の
 * `tooltipOf` props を毎レンダー作り直さないため（新しい関数を渡すと R3F が差分を検出して
 * `invalidate()` を呼び、絵が変わらないフレームでも描き直しになる。§15）。
 */
export function deskTerminalTooltip(terminal: BoardTerminal): string {
  return terminalTooltip(terminal, terminal.label);
}

/** 端子の見た目の状態。 */
export type TerminalState = 'plain' | 'hovered' | 'pending';

/** 状態ごとの色（`session/colors.ts` の値をそのまま使う）。 */
export const TERMINAL_STATE_COLORS: Readonly<Record<TerminalState, string>> = {
  plain: TERMINAL_SCREW_COLOR,
  hovered: TERMINAL_HOVER_COLOR,
  pending: TERMINAL_PENDING_COLOR,
};

/** 当たり判定の球を盤面から浮かせる量[mm]（`TerminalHit` と同じ）。 */
export const PICK_LIFT_MM = 3;
/** 輪をネジ（z=0）より手前、当たり判定球（`PICK_LIFT_MM`）より奥に置く[mm]（`TerminalHit` と同じ）。 */
const HOVER_RING_LIFT_MM = PICK_LIFT_MM - 0.6;
/**
 * ホバー中に重ねるネジの倍率。インスタンスのネジと**ぴったり同じ大きさ**で重ねると
 * 面が完全に一致してZファイティング（ちらつき）になるので、一回りだけ大きくして包む。
 */
const HOVER_SCREW_SCALE = 1.08;
/** ツールチップの位置（端子の中心からのずれ[mm]。`TerminalHit` と同じ）。 */
const TOOLTIP_OFFSET_MM: [number, number, number] = [0, -8, 8];
/** ラベルは見せるだけ（drei の `Html` のラッパがクリックを飲まないようにする）。 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;
/** ネジ頭の円柱は横倒しに置く（`TerminalHit` の `rotation={[Math.PI / 2, 0, 0]}` と同じ姿勢）。 */
const SCREW_ROTATION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/**
 * ネジ頭のマテリアル。**`sharedMaterial()` のキャッシュは使わない**。
 * `instancedMesh` に `instanceColor` を載せると three はそのマテリアルに `USE_INSTANCING_COLOR`
 * を定義した別のシェーダを割り当てる。キャッシュ越しに同じインスタンスを `TerminalHit` や
 * `MountedPart` と共有すると、色付きインスタンス用にコンパイルされた版が普通のメッシュにも回り、
 * プログラムの再コンパイルを誘発する（あるいは白いはずの部品がインスタンス色に染まる）。
 * ここは**この場だけの1個**を持つ。白にするのは `instanceColor` を素直に乗せるため。
 */
const SCREW_MATERIAL = new MeshStandardMaterial({
  color: '#FFFFFF',
  metalness: 0.7,
  roughness: 0.3,
});

/**
 * この場が描く端子。決定表#13
 *
 * **いま `Socket` / `TerminalBlock` が `TerminalHit` で描いている端子と1個も違わないこと**が
 * この関数の唯一の要件である。盤定義の `board.terminals` には、3Dに出ていない端子が混ざっている:
 * - `wirable: false`（AC一次側 `CB`/`SW`/`PS`、PB／PL 本体端子）。`Fixture` は印字しか描かず
 *   `TerminalHit` を使わないので、これらは**もともと触れない**。入れると急に触れるようになる。
 * - 机上の端子（PLC本体・壁コンセント）。`PlcUnit` / `PlcRack` / `Outlet` が従来どおり描く。
 * - 任意部品 `BZ` の2端子（`optional: true`）。課題が盤に足したときだけ。§5.3.4
 *
 * `JIPM_BOARD` では **134 個**（8ソケット×14 ＝112 ＋ `TB_PL` 8 ＋ `TB_PB` 12 ＋ `P` 1 ＋ `N` 1）、
 * BZ 付きで 136 個になる。
 */
export function boardFieldTerminals(
  board: BoardDefinition,
  /** 盤に足した任意部品（`session.extraParts`）。 */
  extraParts: readonly string[],
): BoardTerminal[] {
  return board.terminals.filter(
    (terminal) =>
      terminal.wirable &&
      !isOffBoardTerminal(terminal.id) &&
      (!terminal.optional || extraParts.includes(parseTerminalId(terminal.id).part)),
  );
}

/** その端子の状態（配線待ち > ホバー > 平常）。 */
export function terminalStateOf(
  id: string,
  state: { hovered: string | undefined; pending: string | undefined },
): TerminalState {
  if (state.pending === id) return 'pending';
  if (state.hovered === id) return 'hovered';
  return 'plain';
}

/** 状態 → 色。 */
export function terminalColorOf(state: TerminalState): string {
  return TERMINAL_STATE_COLORS[state];
}

/**
 * インスタンスの行列（ネジ頭と当たり判定球）。純関数にして、
 * 「当たり判定が `TerminalHit` と同じ位置・大きさにある」ことを単体テストで縛れるようにする。
 */
export function terminalFieldMatrices(terminals: readonly BoardTerminal[]): {
  screwMatrices: Matrix4[];
  pickMatrices: Matrix4[];
} {
  const screwMatrices: Matrix4[] = [];
  const pickMatrices: Matrix4[] = [];
  const scale = new Vector3(1, 1, 1);
  for (const terminal of terminals) {
    const [x, y, z] = toScene(terminal.pos);
    screwMatrices.push(new Matrix4().compose(new Vector3(x, y, z), SCREW_ROTATION, scale));
    pickMatrices.push(
      new Matrix4().compose(
        new Vector3(x, y, z + PICK_LIFT_MM),
        new Quaternion(),
        new Vector3(terminal.pickRadiusMm, terminal.pickRadiusMm, terminal.pickRadiusMm),
      ),
    );
  }
  return { screwMatrices, pickMatrices };
}

/** 盤の端子をまとめて描く。 */
export function TerminalField({
  terminals,
  tooltipOf,
  hovered,
  pending,
  onHover,
  onPick,
}: {
  terminals: readonly BoardTerminal[];
  /** 端子 → ツールチップの文字列（`BoardScene` が役割IDを知っているので親が決める）。 */
  tooltipOf: (terminal: BoardTerminal) => string;
  hovered: string | undefined;
  pending: string | undefined;
  onHover: (id: TerminalId | undefined) => void;
  onPick: (terminal: BoardTerminal) => void;
}): JSX.Element | null {
  const screws = useRef<InstancedMesh | null>(null);
  const picks = useRef<InstancedMesh | null>(null);
  const count = terminals.length;
  /** `frameloop="demand"` の下で色の書き換えを確実に1枚描かせる（M3）。 */
  const invalidate = useThree((s) => s.invalidate);

  /** 端子の位置（インスタンスの行列）。端子の並びが変わったときだけ作り直す。 */
  const matrices = useMemo(() => terminalFieldMatrices(terminals), [terminals]);

  useEffect(() => {
    /*
     * 行列を流し込み、外接球を作り直す（`applyInstanceMatrices()`）。外接球は
     * **レイキャストの足切りと視錐台カリングの両方**に使われる（three の
     * `InstancedMesh.raycast()` は外接球に当たらなければ即座に戻る）ので、行列を
     * 入れ替えたら必ず作り直す。作り直さないと、端子が増えた（BZ）あとの端子が拾えなくなる。
     */
    applyInstanceMatrices(screws.current, matrices.screwMatrices);
    applyInstanceMatrices(picks.current, matrices.pickMatrices);
  }, [matrices]);

  /*
   * 色は状態が変わったときだけ書き換える（毎フレームは触らない。§15）。
   * `frameloop="demand"` なので、色を書き換えただけでは three は次のフレームを描かない
   * （M3: Plan 5 C/D レビュー）。今日までは `visualSignature()` が `hoveredTerminal` /
   * `pendingTerminal` を含んでいて、React の passive effect（この effect）が
   * `invalidate` を要求するより先に走ることに**たまたま**頼っていた。前提を1つ減らすため、
   * ここで直接 `invalidate()` を呼ぶ。
   */
  useEffect(() => {
    const mesh = screws.current;
    // `<Canvas>` の外（DOM へ描く単体テスト）では ref に DOM 要素が来る（`materials.ts` 参照）
    if (!(mesh instanceof InstancedMesh)) return;
    const color = new Color();
    terminals.forEach((terminal, i) => {
      color.set(terminalColorOf(terminalStateOf(terminal.id, { hovered, pending })));
      mesh.setColorAt(i, color);
    });
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [terminals, hovered, pending, invalidate]);

  const hoveredTerminal = terminals.find((t) => t.id === hovered);
  if (count === 0) return null;
  const hoveredScrew =
    hoveredTerminal === undefined
      ? undefined
      : terminalScrewAppearance(true, pending === hoveredTerminal.id);
  return (
    <group name="terminal-field">
      <instancedMesh
        ref={screws}
        args={[SCREW_GEOMETRY, SCREW_MATERIAL, count]}
        // 見えるだけ。クリックは下の不可視メッシュが受ける（`Socket` / `TerminalBlock` と同じ `noPick`）
        raycast={noPick}
      />
      <instancedMesh
        ref={picks}
        args={[PICK_GEOMETRY, INVISIBLE_MATERIAL, count]}
        visible={false}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          const terminal = terminals[event.instanceId ?? -1];
          onHover(terminal?.id);
        }}
        onPointerOut={(event: ThreeEvent<PointerEvent>) => {
          /*
           * 端子134個が**1つのメッシュ**になったので、`pointerout` は「端子Aから端子Bへ
           * 移った」ときにも飛ぶ。無条件に `onHover(undefined)` を呼ぶと、B の
           * `pointerover` を打ち消して**ホバーが消えたり点滅したりする**（`TerminalHit` は
           * 端子ごとに別メッシュだったのでこの問題が無かった）。
           * 出ていく先がいまホバー中の端子のときだけ消す。
           */
          const terminal = terminals[event.instanceId ?? -1];
          if (terminal !== undefined && terminal.id !== hovered) return;
          onHover(undefined);
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          const terminal = terminals[event.instanceId ?? -1];
          if (terminal !== undefined) onPick(terminal);
        }}
      />
      {hoveredTerminal === undefined || hoveredScrew === undefined ? null : (
        <group position={toScene(hoveredTerminal.pos)}>
          {/* 発光するネジ（`instanceColor` では `emissive` を載せられないので実体を重ねる） */}
          <mesh
            geometry={SCREW_GEOMETRY}
            material={sharedMaterial(hoveredScrew.color, {
              metalness: 0.7,
              roughness: 0.3,
              ...(hoveredScrew.emissive === undefined
                ? {}
                : {
                    emissive: hoveredScrew.emissive,
                    emissiveIntensity: hoveredScrew.emissiveIntensity,
                  }),
            })}
            raycast={noPick}
            rotation={[Math.PI / 2, 0, 0]}
            scale={HOVER_SCREW_SCALE}
          />
          {/* ネジを一回り超える光る輪（遠目でも「いま指している端子」が分かる） */}
          <mesh
            geometry={HOVER_RING_GEOMETRY}
            material={sharedMaterial(TERMINAL_HOVER_COLOR, {
              metalness: 0,
              roughness: 0.4,
              emissive: TERMINAL_HOVER_COLOR,
              emissiveIntensity: TERMINAL_HOVER_EMISSIVE_INTENSITY,
              transparent: true,
              opacity: 0.85,
            })}
            raycast={noPick}
            position={[0, 0, HOVER_RING_LIFT_MM]}
          />
          <Html
            center
            style={LABEL_STYLE}
            distanceFactor={260}
            position={TOOLTIP_OFFSET_MM}
            zIndexRange={[20, 0]}
          >
            <span className="terminal-tooltip">{tooltipOf(hoveredTerminal)}</span>
          </Html>
        </group>
      )}
    </group>
  );
}
