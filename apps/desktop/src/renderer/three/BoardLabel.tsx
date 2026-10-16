import { Html } from '@react-three/drei';
import type { CSSProperties, JSX, ReactNode } from 'react';
import type { LabelRoomMm } from './label-declutter.js';

/**
 * 盤・机上の機器の名札（drei の `<Html>`）。v2.1.0（監査 U3）
 *
 * 以前は名札の**中心**を基準点に合わせていた（`<Html center>`）。名札は `distanceFactor` で
 * 縮むものの、盤の上で占める大きさはペインが低いほど大きくなる（`labelWorldSizeMm()`）ので、
 * 狭いペインでは名札の半分が機器の側へはみ出し、PLC の出力端子・表示灯を覆っていた。
 * 基準点を**機器の外側の縁**に置き、名札の端をそこへ揃える（`anchor`）。名札がどれだけ
 * 大きくなっても、名札は機器から離れる向きにしか伸びない。
 *
 * 周りの機器にかかるほど大きくなったら出さない（`room`。`label-declutter.ts` が隠す）。
 * 名札は見せるだけ（drei の `Html` はラッパに `pointer-events: auto` を付けるので消す）。
 */

/**
 * 基準点を名札のどこに合わせるか。
 * - `top`: 上端の中央（機器の**下**に出す名札。下へ伸びる）
 * - `bottom`: 下端の中央（機器の**上**に出す名札。上へ伸びる）
 * - `top-left` / `top-right`: 上端の左／右の角（機器の下や横に出し、横へ伸ばす名札）
 * - `bottom-right`: 下端の右の角（機器の上に出し、左上へ伸ばす名札）
 */
export type LabelAnchor = 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-right';

/**
 * 基準点ごとの `Html` のスタイル。drei は `style` を自分の `transform` の**後に**重ねるので、
 * ここで書いた `transform` が名札の置き方になる。`Html` は `style` の同一性で作り直すので、
 * 基準点ごとに1つずつ作って使い回す。
 */
const ANCHOR_STYLE: Readonly<Record<LabelAnchor, CSSProperties>> = {
  top: { pointerEvents: 'none', transform: 'translate3d(-50%,0,0)' },
  bottom: { pointerEvents: 'none', transform: 'translate3d(-50%,-100%,0)' },
  'top-left': { pointerEvents: 'none', transform: 'none' },
  'top-right': { pointerEvents: 'none', transform: 'translate3d(-100%,0,0)' },
  'bottom-right': { pointerEvents: 'none', transform: 'translate3d(-100%,-100%,0)' },
};

/** 名札の重なりの順（`Html` の `zIndexRange`）。ホバーの札（`TerminalField`）より奥。 */
const LABEL_Z_RANGE: [number, number] = [10, 0];

/** 基準点の合わせ方の `transform`（テスト用）。 */
export function labelAnchorTransform(anchor: LabelAnchor): string {
  return String(ANCHOR_STYLE[anchor].transform);
}

/** `data-label-room` に書く文字列（`label-declutter.ts` の `parseLabelRoom()` が読む）。 */
export function labelRoomAttr(room: LabelRoomMm): string {
  return `${String(room.w)} ${String(room.h)}`;
}

/** 名札1枚。 */
export function BoardLabel({
  position,
  anchor,
  distanceFactor,
  rank,
  room,
  className = 'block-label',
  children,
}: {
  /** 基準点（シーン座標 mm）。 */
  position: [number, number, number];
  anchor: LabelAnchor;
  distanceFactor: number;
  /** 重なったときに残す順（`label-declutter.ts`。小さいほど残る）。 */
  rank: number;
  /** 周りの機器にかからずに置ける広さ[mm]。省略すると広さを問わない。 */
  room?: LabelRoomMm;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Html
      style={ANCHOR_STYLE[anchor]}
      distanceFactor={distanceFactor}
      position={position}
      zIndexRange={LABEL_Z_RANGE}
    >
      <span
        className={className}
        data-label-rank={rank}
        data-anchor={anchor}
        data-label-df={distanceFactor}
        {...(room === undefined ? {} : { 'data-label-room': labelRoomAttr(room) })}
      >
        {children}
      </span>
    </Html>
  );
}
