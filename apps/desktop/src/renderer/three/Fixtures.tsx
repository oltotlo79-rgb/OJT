import type { BoardTerminal, Footprint } from '@ojt/board-model';
import { Html } from '@react-three/drei';
import { useMemo, type JSX } from 'react';
import type { Texture } from 'three';
import { BREAKER_COLOR, SUPPLY_BLOCK_COLOR } from '../session/colors.js';
import { Breaker, PowerSwitch } from './AcFixtures.js';
import { makeCanvasTexture, PX_PER_MM } from './labels.js';
import { sharedMaterial, UNIT_BOX } from './materials.js';
import { toScene } from './coords.js';

/**
 * 盤に固定された機器（DC24V電源・ブレーカ・電源スイッチ）。設計仕様 §6.1 / §6.5 / §12.2。
 * 実物写真では上段左に DC24V の端子台、上段右にブレーカが載る。
 * いずれも訓練者は配線できない（`wirable: false`）ので、当たり判定は持たせず見た目だけ描く。
 *
 * 外形は `board.footprints`（`kind: 'supply' | 'breaker' | 'switch'`）から取る。以前は
 * 端子の外接矩形＋固定余白から箱を作っていたが、それだと配線の経路生成が避ける「占有領域」
 * （footprint）と3Dの見た目の箱がずれてしまう。footprint を引ければそれが唯一の情報源になり、
 * 見た目＝配線が避ける領域を保証できる。§12.2「ブレーカ・電源スイッチ・DC24V端子台にも名称」
 * のとおり、端子1個ずつにも常時印字を焼く（`labels.ts` と同じキャンバステクスチャの方式）。
 */

/**
 * ラベルは見せるだけ。drei の `Html` はラッパの div に `pointer-events: auto` を付けるので、
 * ここで無効化しないと盤の上のラベルがツールバーのクリックまで飲み込んでしまう。
 */
const LABEL_STYLE = { pointerEvents: 'none' } as const;

/** 機器の高さ[mm]。 */
const FIXTURE_HEIGHT_MM = 22;

/**
 * DC24V電源（`supply`）の高さ[mm]。
 *
 * この機器の占有領域（`x12 y6 w26 h30`）は P/N 供給端子台（`P.1` / `N.1`、盤面から8mm）と
 * 重なっている。22mm の箱にすると端子台ごと飲み込んでしまい、`P1` / `N1` の印字もネジも
 * 見えなくなって「どこに +24V を取りに行くのか」が分からなかった（レビュー指摘）。
 * 端子台（高さ8mm）より低い5mmの台に留め、端子台はその上に載る形にする。
 * 占有領域（配線の経路が避ける矩形）は盤定義のままで変えない。
 */
const SUPPLY_HEIGHT_MM = 5;

/** 端子印字の文字高さ[mm]。機器の名称のみで数値・記号が短いので、端子台の役割文字より少し大きくする。 */
const MARK_MM = 4;

/** 印字の板をネジの頭より上に浮かせる量[mm]。 */
const LABEL_LIFT_MM = 1.4;

/**
 * 印字の板を機器の外形より外へ広げる量[mm]（四方）。
 * `PS +24V` の端子は占有領域の左端（x=12）にあり、板を外形ぴったりにすると `+24V` が半分切れる。
 */
const PLATE_MARGIN_MM = 8;

/** DC24V電源の印字の板の高さ[mm]（P/N 端子台の印字より上に出す）。 */
const SUPPLY_LABEL_Z_MM = 11;

/** 名札を機器の手前側へ降ろす量[mm]（外形の手前端からの距離）。 */
const LABEL_OFFSET_MM = 6;

/**
 * `board.footprints` のブレーカ（`x276 y6 w26 h30`）と電源スイッチ（`x302 y6 w20 h30`）は
 * 隙間なく隣り合っている（中心間わずか23mm）。既定どおり機器の真下中央へ名札を置くと、
 * `ブレーカ` と `電源スイッチ` の2枚がほぼ同じ高さで重なる（2026-09-20 の監査指摘 B3・
 * `hud-overlap` 103件）。左右（`x`）・手前奥（`y`）・高さ（`z`）の3方向すべてへ振って離す。
 *
 * 正面／背面視は主に `x`（盤の左右）で、側面視（左右から見る）は盤の左右が奥行きに潰れる
 * ので主に `z`（機器からの高さ）で、`y`（手前奥）はどちらの視点でも少しずつ効く。3方向とも
 * ずらしておくことで、`view-gizmo` の6方向プリセットのどれで見ても2枚が重ならない
 * （`viewport-layout.test.tsx` で6方向×3サイズを検算）。
 */
export const FIXTURE_LABEL_OFFSET_MM: Readonly<
  Record<string, { x: number; y: number; z: number }>
> = {
  CB: { x: -18, y: -4, z: -6 },
  SW: { x: 20, y: 16, z: 20 },
};

/** 端子の印字色（極性は色でも区別する。§12.2「極性 +/− は色でも区別」）。CB/SW の `ac` は黒。 */
const FIXTURE_MARK_COLOR: Readonly<Partial<Record<BoardTerminal['role'], string>>> = {
  '+': '#D14343',
  '-': '#2E6BD6',
  ac: '#1B1E23',
};

/** レイキャストを受けない。 */
function noPick(): void {
  // 交差候補を積まない
}

/**
 * 端子の印字文字列。盤定義の `label`（`PS +24V` のように「機器プレフィックス＋半角スペース＋名称」の形）
 * から機器プレフィックスを除いた名称だけを返す（`PS +24V` → `+24V`、`CB 1` → `1`）。
 */
export function fixtureTerminalMark(terminal: BoardTerminal): string {
  const spaceIndex = terminal.label.indexOf(' ');
  return spaceIndex === -1 ? terminal.label : terminal.label.slice(spaceIndex + 1);
}

/** `board.footprints` から `kind` で固定機器の外形を引く。一致が無ければ `undefined`。 */
export function findFixtureFootprint(
  footprints: readonly Footprint[],
  kind: Footprint['kind'],
): Footprint | undefined {
  return footprints.find((footprint) => footprint.kind === kind);
}

/**
 * 固定機器1個ぶんの端子印字テクスチャ。
 * footprint の左上から `PLATE_MARGIN_MM` だけ外へ広げた矩形を板にするので、
 * 外形の端に載っている端子（`PS +24V` など）の印字も切れない。
 */
function fixtureFaceTexture(
  terminals: readonly BoardTerminal[],
  footprint: Footprint,
): Texture | undefined {
  if (terminals.length === 0) return undefined;
  return makeCanvasTexture(
    footprint.w + PLATE_MARGIN_MM * 2,
    footprint.h + PLATE_MARGIN_MM * 2,
    (ctx) => {
      ctx.font = `700 ${MARK_MM * PX_PER_MM}px sans-serif`;
      for (const terminal of terminals) {
        const x = (terminal.pos.x - footprint.x + PLATE_MARGIN_MM) * PX_PER_MM;
        const y = (terminal.pos.y - footprint.y + PLATE_MARGIN_MM) * PX_PER_MM;
        ctx.fillStyle = FIXTURE_MARK_COLOR[terminal.role] ?? '#1B1E23';
        ctx.fillText(fixtureTerminalMark(terminal), x, y);
      }
    },
  );
}

/**
 * 固定機器の名札を置くシーン座標。`Fixture` の `Html` と `viewport-layout.test.tsx`
 * （2026-09-20 の監査指摘 B3 の検算）が同じ式を共有する（実装とテストの式がずれない）。
 */
export function fixtureLabelPositionScene(
  kind: Footprint['kind'],
  footprint: Footprint,
  labelOffsetMm?: { x: number; y: number; z: number },
): [number, number, number] {
  const heightMm = kind === 'supply' ? SUPPLY_HEIGHT_MM : FIXTURE_HEIGHT_MM;
  const labelPlateZ = kind === 'supply' ? SUPPLY_LABEL_Z_MM : heightMm + LABEL_LIFT_MM;
  const center = toScene({
    x: footprint.x + footprint.w / 2,
    y: footprint.y + footprint.h / 2,
    z: heightMm / 2,
  });
  return [
    center[0] + (labelOffsetMm?.x ?? 0),
    center[1] - footprint.h / 2 - LABEL_OFFSET_MM - (labelOffsetMm?.y ?? 0),
    labelPlateZ + (labelOffsetMm?.z ?? 0),
  ];
}

/** 固定機器1台（外形は `board.footprints` から、端子印字は `terminals` から）。 */
export function Fixture({
  name,
  label,
  color,
  kind,
  terminals,
  footprints,
  on,
  labelOffsetMm,
}: {
  name: string;
  label: string;
  color: string;
  kind: Footprint['kind'];
  terminals: readonly BoardTerminal[];
  footprints: readonly Footprint[];
  /**
   * 投入状態（ブレーカ＝`SimSnapshot.breakerOn`、電源スイッチ＝`switchOn`）。
   * ハンドル／ロッカーの倒れる向きに出る。DC24V電源では使わない。
   */
  on: boolean;
  /**
   * 名札を既定位置（機器の手前中央）からずらす量[mm]。`+x` は右、`+y` は手前へさらに降ろす、
   * `+z` は機器からさらに高く浮かせる。省略すると既定位置のまま。隣り合うブレーカ・電源
   * スイッチの名札どうしが重なるのを避けるために使う（`FIXTURE_LABEL_OFFSET_MM`）。
   */
  labelOffsetMm?: { x: number; y: number; z: number };
}): JSX.Element | null {
  const footprint = findFixtureFootprint(footprints, kind);
  const faceTexture = useMemo(
    () => (footprint === undefined ? undefined : fixtureFaceTexture(terminals, footprint)),
    [terminals, footprint],
  );
  if (terminals.length === 0 || footprint === undefined) return null;
  const heightMm = kind === 'supply' ? SUPPLY_HEIGHT_MM : FIXTURE_HEIGHT_MM;
  const labelPlateZ = kind === 'supply' ? SUPPLY_LABEL_Z_MM : heightMm + LABEL_LIFT_MM;
  const center = toScene({
    x: footprint.x + footprint.w / 2,
    y: footprint.y + footprint.h / 2,
    z: heightMm / 2,
  });
  return (
    <group name={`fixture-${name}`}>
      {/*
        ブレーカと電源スイッチは実物（写真右上）に寄せて作り込む（利用者要望 2026-09-19）。
        DC24V電源は端子台が上に載るだけの低い台なので、これまでどおり単純な箱で描く。
      */}
      {kind === 'breaker' ? (
        <Breaker
          footprint={footprint}
          terminals={terminals}
          color={color}
          heightMm={heightMm}
          on={on}
        />
      ) : kind === 'switch' ? (
        <PowerSwitch
          footprint={footprint}
          terminals={terminals}
          color={color}
          heightMm={heightMm}
          on={on}
        />
      ) : (
        <mesh
          geometry={UNIT_BOX}
          material={sharedMaterial(color, { roughness: 0.6, metalness: 0.15 })}
          raycast={noPick}
          position={center}
          scale={[footprint.w, footprint.h, heightMm]}
        />
      )}
      {/* 端子の名前の印字（常時表示）。§12.2 */}
      {faceTexture === undefined ? null : (
        <mesh raycast={noPick} position={[center[0], center[1], labelPlateZ]}>
          <planeGeometry
            args={[footprint.w + PLATE_MARGIN_MM * 2, footprint.h + PLATE_MARGIN_MM * 2]}
          />
          <meshBasicMaterial map={faceTexture} transparent depthWrite={false} />
        </mesh>
      )}
      {/*
        名札は機器の**手前側**に置く。以前は機器の真上に置いていたため、盤の上端に並ぶ
        DC24V電源では左上の状態オーバーレイと、隣の DC24V端子台の名札と三つ巴で重なっていた
        （レビュー指摘）。手前に降ろすと画面上でも下へずれてどちらとも離れる。
      */}
      <Html
        center
        style={LABEL_STYLE}
        distanceFactor={320}
        position={fixtureLabelPositionScene(kind, footprint, labelOffsetMm)}
        zIndexRange={[10, 0]}
      >
        {/* 名札の優先度（`label-declutter.ts`）。固定機器は端子台より先に残す */}
        <span className="block-label" data-label-rank={3}>
          {label}
        </span>
      </Html>
    </group>
  );
}

/** 盤の固定機器（電源・ブレーカ・電源スイッチ）の定義。§6.4 の部品ID順。 */
export const FIXTURES: ReadonlyArray<{
  id: string;
  label: string;
  color: string;
  kind: Footprint['kind'];
}> = [
  { id: 'PS', label: 'DC24V電源', color: SUPPLY_BLOCK_COLOR, kind: 'supply' },
  { id: 'CB', label: 'ブレーカ', color: BREAKER_COLOR, kind: 'breaker' },
  { id: 'SW', label: '電源スイッチ', color: BREAKER_COLOR, kind: 'switch' },
];
