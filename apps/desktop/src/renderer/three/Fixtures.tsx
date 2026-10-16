import type { BoardTerminal, Footprint } from '@ojt/board-model';
import type { JSX } from 'react';
import { BREAKER_COLOR, SUPPLY_BLOCK_COLOR } from '../session/colors.js';
import { Breaker, PowerSwitch, type PowerFixtureHandlers } from './AcFixtures.js';
import { BoardLabel, type LabelAnchor } from './BoardLabel.js';
import type { LabelRoomMm } from './label-declutter.js';
import { SupplyUnit } from './SupplyUnit.js';
import { toScene } from './coords.js';

/**
 * 盤に固定された機器（DC24V電源・ブレーカ・電源スイッチ）。設計仕様 §6.1 / §6.5 / §12.2。
 * 実物写真では上段左に DC24V の端子台、上段右にブレーカが載る。
 * P/N出力端子は配線・測定に使い、ブレーカとスイッチの操作部は入切できる。
 *
 * 外形は `board.footprints`（`kind: 'supply' | 'breaker' | 'switch'`）から取る。以前は
 * 端子の外接矩形＋固定余白から箱を作っていたが、それだと配線の経路生成が避ける「占有領域」
 * （footprint）と3Dの見た目の箱がずれてしまう。footprint を引ければそれが唯一の情報源になり、
 * 見た目＝配線が避ける領域を保証できる。§12.2「ブレーカ・電源スイッチ・DC24V端子台にも名称」
 * のとおり、端子1個ずつにも常時印字を焼く（`labels.ts` と同じキャンバステクスチャの方式）。
 */

/** 機器の高さ[mm]（E2E も操作部の高さを引くために使う）。 */
export const FIXTURE_HEIGHT_MM = 22;

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

/** 名札の高さ。端子本体と出線を隠さない位置に置く。 */
const LABEL_LIFT_MM = 1.4;
const SUPPLY_LABEL_Z_MM = 11;

/** 名札の上端を機器の手前の縁から離す量[mm]。 */
const LABEL_GAP_MM = 2;

/**
 * ソケットの奥端（`board-jipm.ts` の `SOCKET_Y_MM`）。上段の固定機器の名札は、機器の手前の縁から
 * ここまでの帯に収まる大きさのときだけ出す（v2.1.0 監査 U3）。
 */
const SOCKET_TOP_Y_MM = 60;

/** 名札の基準点と置き場。 */
export interface FixtureLabelPlacement {
  /** 基準点（盤モデル mm）。 */
  x: number;
  y: number;
  z: number;
  /** 基準点を名札のどこに合わせるか（`BoardLabel.tsx`）。 */
  anchor: LabelAnchor;
  /** 周りの機器にかからずに置ける広さ[mm]。 */
  room: LabelRoomMm;
}

/**
 * 盤の上段の空いた帯の左端[mm]。DC24V電源（`x12 w26`）の右端の少し右。ブレーカと電源スイッチの
 * 名札は、ここからブレーカの左端までに収まるときだけ出す。
 */
const TOP_BAND_LEFT_MM = 40;

/** 上段の帯に2段で並べる名札の、段と段のあいだ[mm]。 */
const TOP_BAND_ROW_GAP_MM = 2;

/**
 * 固定機器の名札の置き方。v2.1.0（監査 U3）。`Fixture` と `viewport-layout.test.tsx` が同じ式を使う。
 *
 * 名札は機器の外側の縁に端を合わせ、**盤の内側の空いた所へ**伸ばす。以前は名札の中心を
 * 機器の少し手前に置いていたので、名札が大きく映る狭いペインでは機器そのものに半分かかった。
 *
 * ブレーカ（`x276 w26`）と電源スイッチ（`x302 w20`）は盤の右上の角に隙間なく並んでいる
 * （2026-09-20 の監査指摘 B3）。右は盤の外（3Dの画面の右端に切られる）、上は3Dの画面の上端
 * （盤の上にほとんど余白が無い）、下はソケットの名札の場所なので、2枚とも**ブレーカの左隣の
 * 上段の空いた帯**（DC24V電源とブレーカのあいだ）に、右端をそろえて2段で並べる:
 *
 * - 上の段: ブレーカ（右上の角を合わせ、下へ伸ばす）
 * - 下の段: 電源スイッチ（右下の角を合わせ、上へ伸ばす）
 *
 * 2段の置き場は帯を半分ずつ分け合うので、どれだけ大きく映っても2枚は重ならない。上から見たとき
 * 段の差が潰れないよう、ブレーカ（上の段）の名札は機器の天面の高さ、電源スイッチ（下の段）の
 * 名札は盤面の近くに置く（上から見ると、高い物ほど画面の下に映る）。
 * DC24V電源の名札は電源の下の縁の中央から下へ伸ばす。
 *
 * 置き場（`room`）: 名札がそれより大きく映るペインでは出さない（`label-declutter.ts`）。
 *
 * @param footprints 盤の占有領域（電源スイッチの名札をブレーカの左隣にそろえるために使う）
 */
export function fixtureLabelPlacement(
  kind: Footprint['kind'],
  footprint: Footprint,
  footprints: readonly Footprint[] = [],
): FixtureLabelPlacement {
  const bottom = footprint.y + footprint.h;
  const below = bottom + LABEL_GAP_MM;
  if (kind === 'breaker' || kind === 'switch') {
    // 2段の右端はブレーカの左の縁。ブレーカが見つからないときは自分の左の縁にそろえる
    const breaker =
      kind === 'breaker' ? footprint : (findFixtureFootprint(footprints, 'breaker') ?? footprint);
    const right = breaker.x - LABEL_GAP_MM;
    const top = breaker.y + 1;
    const rowH = (breaker.y + breaker.h - 1 - top - TOP_BAND_ROW_GAP_MM) / 2;
    const room = { w: right - TOP_BAND_LEFT_MM, h: rowH };
    return kind === 'breaker'
      ? { x: right, y: top, z: FIXTURE_HEIGHT_MM + LABEL_LIFT_MM, anchor: 'top-right', room }
      : {
          x: right,
          y: breaker.y + breaker.h - 1,
          z: FIXTURE_HEIGHT_MM + LABEL_LIFT_MM - 20,
          anchor: 'bottom-right',
          room,
        };
  }
  return {
    x: footprint.x + footprint.w / 2,
    y: below,
    z: SUPPLY_LABEL_Z_MM,
    anchor: 'top',
    room: { w: 150, h: SOCKET_TOP_Y_MM - below - 1 },
  };
}

/** 名札の基準点のシーン座標。 */
export function fixtureLabelPositionScene(
  placement: FixtureLabelPlacement,
): [number, number, number] {
  return toScene({ x: placement.x, y: placement.y, z: placement.z });
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

/** 固定機器1台（外形は `board.footprints` から、端子印字は `terminals` から）。 */
export function Fixture({
  name,
  label,
  color,
  kind,
  terminals,
  footprints,
  on,
  onToggle,
  onHover,
}: {
  name: string;
  label: string;
  color: string;
  kind: Footprint['kind'];
  terminals: readonly BoardTerminal[];
  footprints: readonly Footprint[];
  /**
   * 投入状態（ブレーカ＝`SimSnapshot.breakerOn`、電源スイッチ＝`switchOn`）。
   * ハンドル／ロッカーの倒れる向きに出る。DC24V電源では「DC が出ているか」（両方が入）で、
   * 表示LEDの点灯に使う（v2.0.0 Task 7）。
   */
  on: boolean;
} & PowerFixtureHandlers): JSX.Element | null {
  const footprint = findFixtureFootprint(footprints, kind);
  if (terminals.length === 0 || footprint === undefined) return null;
  const heightMm = kind === 'supply' ? SUPPLY_HEIGHT_MM : FIXTURE_HEIGHT_MM;
  const placement = fixtureLabelPlacement(kind, footprint, footprints);
  return (
    <group name={`fixture-${name}`}>
      {/*
        ブレーカと電源スイッチは実物（写真右上）に寄せて作り込む（利用者要望 2026-09-19）。
        DC24V出力部は、ネジ・金属座金・絶縁壁と出線口が見える端子台にする。
      */}
      {kind === 'breaker' ? (
        <Breaker
          footprint={footprint}
          terminals={terminals}
          color={color}
          heightMm={heightMm}
          on={on}
          onToggle={onToggle}
          onHover={onHover}
        />
      ) : kind === 'switch' ? (
        <PowerSwitch
          footprint={footprint}
          terminals={terminals}
          color={color}
          heightMm={heightMm}
          on={on}
          onToggle={onToggle}
          onHover={onHover}
        />
      ) : (
        <SupplyUnit footprint={footprint} lit={on} />
      )}
      {/*
        名札は機器の**手前側**に置く。以前は機器の真上に置いていたため、盤の上端に並ぶ
        DC24V電源では左上の状態オーバーレイと、隣の DC24V端子台の名札と三つ巴で重なっていた
        （レビュー指摘）。手前に降ろすと画面上でも下へずれてどちらとも離れる。
        名札の優先度（`label-declutter.ts`）: 固定機器は端子台より先に残す。
        ブレーカと電源スイッチの名札は入/切を出す状態の表示なので、「3Dの名札を表示」を切っても
        残す（`fixture-label`。DC24V電源の名札は名前だけなので消える）。
      */}
      <BoardLabel
        position={fixtureLabelPositionScene(placement)}
        anchor={placement.anchor}
        distanceFactor={320}
        rank={3}
        room={placement.room}
        className={kind === 'supply' ? 'block-label' : 'block-label fixture-label'}
      >
        {label}
        {kind === 'supply' ? null : (
          <strong className="fixture-state" data-on={on}>
            {on ? '入 ON' : '切 OFF'}
          </strong>
        )}
      </BoardLabel>
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
