import {
  deskRoutes,
  deskWires,
  isOffBoardTerminal,
  type BoardDefinition,
  type BoardSession,
  type BoardTerminal,
  type DeskRoute,
} from '@ojt/board-model';
import { PLC_WIRE_COLOR } from '@ojt/content';
import { memo, useMemo, useRef, type JSX } from 'react';
import { BackSide } from 'three';
import { WIRE_COLORS, WIRE_OUTLINE_COLOR } from '../session/colors.js';
import { sharedMaterial } from './materials.js';
import { shouldOutlineWireBody, useTubeGeometry, WIRE_RADIUS_MM } from './Wire.js';

/**
 * 机上へ渡るケーブル。設計仕様 §6.6 / §10.1 / §11.3。決定表#9
 *
 * 盤の配線帯（§6.6）は机上まで伸びていないので、これらの電線は `routeSession()` の対象外で
 * ある。代わりに `deskRoutes()`（`@ojt/board-model` の `desk-routing.ts`）が机上のダクトに
 * 沿った**直角の経路**を返すので、ここは盤の電線（`Wire.tsx`）と**同じ描き方**で管にするだけ
 * でよい（半径・色・角の丸め・白線の縁取り・ジオメトリの解放まで `Wire.tsx` のヘルパを使う）。
 *
 * ピックは受けない。机上のケーブルは盤の電線と違って削除モードの対象ではなく、手前を通る管が
 * PLCの端子のクリックを奪うと配線できなくなるためである（§8.2 の操作性を優先）。
 */

/** レイキャストを受けない。 */
function noPick(): void {
  // 交差候補を積まない
}

/** 机上に属する端子（PLC本体と壁コンセント）。 */
export function offBoardTerminals(board: BoardDefinition): BoardTerminal[] {
  return board.terminals.filter((terminal) => isOffBoardTerminal(terminal.id));
}

/**
 * 白いケーブルに付ける、内側から見た暗い輪郭（`Wire.tsx` の `WireOutline` と同じ手）。
 * 別コンポーネントにしてあるのは、白以外では形を**作らない**ためで、外れたときの後始末が
 * そのまま `dispose()` になる。
 */
function DeskCableOutline({ route }: { route: DeskRoute }): JSX.Element {
  const geometry = useTubeGeometry(route, WIRE_RADIUS_MM * 1.5);
  return (
    <mesh
      geometry={geometry}
      raycast={noPick}
      renderOrder={-1}
      material={sharedMaterial(WIRE_OUTLINE_COLOR, {
        roughness: 0.9,
        metalness: 0,
        side: BackSide,
      })}
    />
  );
}

/** 机上のケーブル1本。 */
function DeskCable({ route }: { route: DeskRoute }): JSX.Element {
  // 形のメモ化（折れ点が同じなら作り直さない）と、作り直したときの解放は `Wire.tsx` と共通
  const geometry = useTubeGeometry(route);
  const bodyColor = WIRE_COLORS[route.color];
  return (
    <group name={`desk-wire-${route.wireId}`} userData={{ lane: route.lane }}>
      {shouldOutlineWireBody(bodyColor) ? <DeskCableOutline route={route} /> : null}
      <mesh
        geometry={geometry}
        raycast={noPick}
        material={sharedMaterial(bodyColor, { roughness: 0.55, metalness: 0.05 })}
      />
    </group>
  );
}

/**
 * 机上ケーブルの同一性を表す文字列。§15
 * `session` は配線のたびに `cloneSession()` で新しい参照になるので、そのまま依存に並べると
 * 盤の電線を1本足すだけで机上の `TubeGeometry` が全部作り直される（GPU バッファの作り直し）。
 * 本数・両端・色が同じなら形も同じなので、それを鍵にする。`deskRoutes()`（ダクトの障害物回避で
 * 折れ点を求める）ではなく**軽い** `deskWires()`（端子の生座標だけ）から作る。回避経路は
 * 「机上に渡るどの電線が・どの端子間か・何色か」だけの純関数なので、この鍵が一致していれば
 * `deskRoutes()` をもう一度呼んでも同じ折れ線になる。
 */
export function deskWireSignature(board: BoardDefinition, session: BoardSession): string {
  return deskWires(board, session)
    .map((wire) => {
      const color = session.wires.find((w) => w.id === wire.id)?.color ?? PLC_WIRE_COLOR;
      return `${wire.id}:${color}:${wire.fromPos.x},${wire.fromPos.y},${wire.fromPos.z}>${wire.toPos.x},${wire.toPos.y},${wire.toPos.z}`;
    })
    .join('|');
}

/** 机上へ渡るケーブルをまとめて描く。 */
function DeskWiresImpl({
  board,
  session,
}: {
  board: BoardDefinition;
  session: BoardSession;
}): JSX.Element | null {
  const signature = deskWireSignature(board, session);
  /*
   * 署名が同じなら形も色も同じなので、最新の `board` / `session` をそのまま使ってよい。
   * `useRef` 越しに読むのは **`react-hooks/exhaustive-deps` を黙らせるためではなく**、
   * 「依存は署名1本」という意図をコードの形で表すためである。ref は規則が「安定」と見なす値で、
   * `.current` の読み出しは依存に数えられない。だから `eslint-disable` は要らない——
   * `Wire.tsx` の `useTubeGeometry()` が同じ形で無警告に通っているのが先例である（I8）。
   */
  const latest = useRef({ board, session });
  latest.current = { board, session };
  const routes = useMemo(() => {
    void signature; // 署名が同じ＝形も色も同じ。作り直しの引き金としてだけ使う
    const { board: b, session: s } = latest.current;
    return deskRoutes(b, s);
  }, [signature]);
  if (routes.length === 0) return null;
  return (
    <group name="desk-wires">
      {routes.map((route) => (
        <DeskCable key={route.wireId} route={route} />
      ))}
    </group>
  );
}

export const DeskWires = memo(DeskWiresImpl);
