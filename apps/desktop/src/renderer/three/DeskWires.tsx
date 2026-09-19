import {
  deskWires,
  isOffBoardTerminal,
  type BoardDefinition,
  type BoardSession,
  type BoardTerminal,
  type Vec3,
} from '@ojt/board-model';
import type { WireColor } from '@ojt/circuit-sim';
import { PLC_WIRE_COLOR } from '@ojt/content';
import { useEffect, useMemo, type JSX } from 'react';
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import { WIRE_COLORS } from '../session/colors.js';
import { sharedMaterial } from './materials.js';
import { toScene } from './coords.js';

/**
 * 机上へ渡るケーブル。設計仕様 §10.1 / 3A 決定表#9。
 *
 * 盤の配線帯（§6.6）は机上まで伸びていないので、これらの電線は `routeSession()` の対象外で
 * ある（`deskWires()` が別に返す）。ここでは**たるんだ直線ケーブル**として描く。
 */

/** ケーブルの半径[mm]。 */
const CABLE_R_MM = 1.6;
/** ケーブルの垂れ下がり量[mm]（手前へ）。 */
const SAG_MM = 12;

/** 机上に属する端子（PLC本体と壁コンセント）。 */
export function offBoardTerminals(board: BoardDefinition): BoardTerminal[] {
  return board.terminals.filter((terminal) => isOffBoardTerminal(terminal.id));
}

/** ケーブルの制御点（始点・たるみ・終点）をシーン座標で返す。 */
export function deskCablePoints(from: Vec3, to: Vec3): Array<[number, number, number]> {
  const a = toScene(from);
  const b = toScene(to);
  const middle = toScene({
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 + SAG_MM,
    z: (from.z + to.z) / 2 + 2,
  });
  return [a, middle, b];
}

/** 机上へ渡るケーブルをまとめて描く。 */
export function DeskWires({
  board,
  session,
}: {
  board: BoardDefinition;
  session: BoardSession;
}): JSX.Element | null {
  const cables = useMemo(() => {
    const colors = new Map<string, WireColor>(session.wires.map((wire) => [wire.id, wire.color]));
    return deskWires(board, session).map((wire) => {
      const points = deskCablePoints(wire.fromPos, wire.toPos);
      return {
        id: wire.id,
        color: WIRE_COLORS[colors.get(wire.id) ?? PLC_WIRE_COLOR],
        // 曲線とチューブ形状も**ここで作る**。JSX の `args` に `new CatmullRomCurve3(...)` と
        // 書くと毎レンダーで新しい曲線とジオメトリが生まれ、three 側が古い方を破棄しない
        // （§15 の「同一性を保つ」に反する。レビュー指摘 I8）
        geometry: new TubeGeometry(
          new CatmullRomCurve3(points.map((p) => new Vector3(p[0], p[1], p[2]))),
          16,
          CABLE_R_MM,
          8,
          false,
        ),
      };
    });
  }, [board, session]);
  /*
   * 作り直した古いチューブは GPU 側に残るので、束が入れ替わったら必ず捨てる。
   * 配線のたびに `session` が変わるため、捨てないと訓練1回ぶんで数十本ぶんのジオメトリが溜まる。
   */
  useEffect(
    () => () => {
      for (const cable of cables) cable.geometry.dispose();
    },
    [cables],
  );
  if (cables.length === 0) return null;
  return (
    <group name="desk-wires">
      {cables.map((cable) => (
        <mesh
          key={cable.id}
          geometry={cable.geometry}
          material={sharedMaterial(cable.color, { roughness: 0.5, metalness: 0.1 })}
        />
      ))}
    </group>
  );
}
