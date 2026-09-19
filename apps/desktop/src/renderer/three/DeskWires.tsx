import {
  deskRoutes,
  isOffBoardTerminal,
  type BoardDefinition,
  type BoardSession,
  type BoardTerminal,
  type DeskRoute,
} from '@ojt/board-model';
import { useMemo, type JSX } from 'react';
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

/** 机上へ渡るケーブルをまとめて描く。 */
export function DeskWires({
  board,
  session,
}: {
  board: BoardDefinition;
  session: BoardSession;
}): JSX.Element | null {
  const routes = useMemo(() => deskRoutes(board, session), [board, session]);
  if (routes.length === 0) return null;
  return (
    <group name="desk-wires">
      {routes.map((route) => (
        <DeskCable key={route.wireId} route={route} />
      ))}
    </group>
  );
}
