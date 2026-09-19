import { SOCKET_PIN_GRID } from '@ojt/board-model';
import type { JSX } from 'react';
import {
  JA_PIN,
  busSideMark,
  coilPolarityText,
  contactSetsText,
  pinGroupLabel,
} from '../i18n/ja.js';
import {
  COIL_N_PIN,
  COIL_P_PIN,
  CONTACT_SETS,
  PIN_GROUPS,
  PIN_GROUP_COLOR,
  coilBusSide,
  pinGroup,
  type PinGroup,
} from '../session/socket-pins.js';
import styles from './pinout.module.css';

/**
 * ソケットのピン配列の凡例（部品カードの中の小さな図）。設計仕様 §8.2。
 * 利用者要望 2026-09-20「リレーソケットの各番号はどこが何かわからないから分かるようにしてね」。
 *
 * 番号の並びは**実物と同じ**（`SOCKET_PIN_GRID`。段1に空き・③②①、段4に④⑭⑬・空き）で、
 * ここでも並べ替えない。番号だけでは何のネジか分からないので、
 * - ネジの丸の縁と、段の下の帯を**役割の色**（`PIN_GROUP_COLOR`。3Dソケットの面の印字と同じ色）
 * - 左に段見出し（`b接点 1-4` など。3Dの面・ツールチップと同じ言葉）
 * - 図の下に「接点の組」の一行
 * を添える。色は見分けの補助で、意味は必ず日本語の見出しが持つ（`session/socket-pins.ts` の方針）。
 *
 * 段4の左端は ④（b接点）で、⑭⑬（コイル）と役割が違う。帯はここで色が切り替わり、
 * 左の見出しが `b接点 1-4` と範囲を出しているので、④ が段1の①②③と同じ仲間だと分かる。
 */

/**
 * 図の座標系（`viewBox`）。幅・高さの比がそのままカード内での見え方になる。
 * 高さは段4の帯の下に**コイルの極性の印**（`P(+)` / `N(−)`）の一行ぶんを足した分ある
 * （利用者指摘 2026-09-20「どちらがPかNか分からない」）。
 */
export const PINOUT_VIEW = { w: 184, h: 126 } as const;

/** 列の中心X（実物の4列）。 */
const COL_X0 = 92;
const COL_PITCH = 26;
/** 段の中心Y（実物の4段）。 */
const ROW_Y0 = 16;
const ROW_PITCH = 26;
/** ネジの丸の半径。 */
const PIN_R = 9;
/** 段見出しの色見本（左端）。 */
const SWATCH = { x: 0, w: 8, h: 8, rx: 2 } as const;
/** 段見出しの文字の左端X。 */
const NAME_X = 12;
/** 役割の帯（段の中心からの下げ量・高さ・ネジ1個ぶんの左右の張り出し）。 */
const BAND = { dy: 12, h: 3, half: 12, rx: 1.5 } as const;
/** コイルの極性の印を置く段の中心からの下げ量（帯のさらに下）。 */
const POLARITY_DY = 24;

/** 列の中心X。 */
export function pinoutColumnX(col: number): number {
  return COL_X0 + col * COL_PITCH;
}

/** 段の中心Y。 */
export function pinoutRowY(row: number): number {
  return ROW_Y0 + row * ROW_PITCH;
}

/** 役割の帯1本（同じ段で役割が続くあいだが1本）。 */
export interface PinoutBand {
  group: PinGroup;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 段の中の帯を求める。同じ段でも役割が変わるところで切る（段4の ④ と ⑭⑬）。
 * 純関数にして、単体テストが「帯が重ならない」「④ だけ色が違う」を数値で確かめられるようにする。
 */
export function pinoutBands(row: readonly (number | undefined)[], rowIndex: number): PinoutBand[] {
  const out: PinoutBand[] = [];
  let runGroup: PinGroup | undefined;
  let runStart = 0;
  let runEnd = 0;
  const flush = (): void => {
    if (runGroup === undefined) return;
    const x = pinoutColumnX(runStart) - BAND.half;
    out.push({
      group: runGroup,
      x,
      y: pinoutRowY(rowIndex) + BAND.dy,
      w: pinoutColumnX(runEnd) + BAND.half - x,
      h: BAND.h,
    });
    runGroup = undefined;
  };
  row.forEach((pin, col) => {
    if (pin === undefined) {
      flush();
      return;
    }
    const group = pinGroup(pin);
    if (group !== runGroup) {
      flush();
      runGroup = group;
      runStart = col;
    }
    runEnd = col;
  });
  flush();
  return out;
}

/**
 * ピン1個の図の上での中心（実物の並びから引く）。盤に無い番号は undefined。
 * コイルの極性の印を「そのネジの真下」に置くために使う（位置の決め打ちを増やさない）。
 */
export function pinoutPinPos(pin: number): { x: number; y: number } | undefined {
  for (let row = 0; row < SOCKET_PIN_GRID.length; row += 1) {
    const col = (SOCKET_PIN_GRID[row] ?? []).indexOf(pin);
    if (col >= 0) return { x: pinoutColumnX(col), y: pinoutRowY(row) };
  }
  return undefined;
}

/** その大分類に属するピン番号（実物の並びから拾うので、番号は盤定義が決める）。 */
export function pinsOfGroup(group: PinGroup): number[] {
  return SOCKET_PIN_GRID.flat()
    .filter((pin): pin is number => pin !== undefined && pinGroup(pin) === group)
    .sort((a, b) => a - b);
}

/** ソケットのピン配列の凡例。 */
export function SocketPinout(): JSX.Element {
  return (
    <div className={styles.pinout}>
      <p className={styles.heading}>{JA_PIN.legendTitle}</p>
      <figure className={styles.figure}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${String(PINOUT_VIEW.w)} ${String(PINOUT_VIEW.h)}`}
          role="img"
          aria-label={JA_PIN.legendAria}
        >
          {/* 段見出し（色見本＋言葉＋ピン番号の範囲）。3Dの面の印字と同じ言葉を使う */}
          {PIN_GROUPS.map((group, index) => {
            const y = pinoutRowY(index);
            return (
              <g key={`name-${group}`}>
                <rect
                  x={SWATCH.x}
                  y={y - SWATCH.h / 2}
                  width={SWATCH.w}
                  height={SWATCH.h}
                  rx={SWATCH.rx}
                  fill={PIN_GROUP_COLOR[group]}
                />
                <text className={styles.groupName} x={NAME_X} y={y + 3.5}>
                  {pinGroupLabel(group, pinsOfGroup(group))}
                </text>
              </g>
            );
          })}

          {/* 役割の帯（段ごと。役割が変わるところで色が切り替わる） */}
          {SOCKET_PIN_GRID.map((row, rowIndex) =>
            pinoutBands(row, rowIndex).map((band) => (
              <rect
                key={`band-${String(rowIndex)}-${band.group}`}
                data-group={band.group}
                x={band.x}
                y={band.y}
                width={band.w}
                height={band.h}
                rx={BAND.rx}
                fill={PIN_GROUP_COLOR[band.group]}
              />
            )),
          )}

          {/* ネジ（実物と同じ並び。空きスロットは縁だけ描いて「ここにネジは無い」を示す） */}
          {SOCKET_PIN_GRID.map((row, rowIndex) =>
            row.map((pin, col) => {
              const cx = pinoutColumnX(col);
              const cy = pinoutRowY(rowIndex);
              if (pin === undefined) {
                return (
                  <circle
                    key={`hole-${String(rowIndex)}-${String(col)}`}
                    className={styles.hole}
                    cx={cx}
                    cy={cy}
                    r={PIN_R - 3}
                  />
                );
              }
              return (
                <g key={`pin-${String(pin)}`} data-pin={pin}>
                  <circle
                    className={styles.pin}
                    cx={cx}
                    cy={cy}
                    r={PIN_R}
                    stroke={PIN_GROUP_COLOR[pinGroup(pin)]}
                  />
                  <text className={styles.pinNumber} x={cx} y={cy + 4} textAnchor="middle">
                    {pin}
                  </text>
                </g>
              );
            }),
          )}
          {/*
            コイルの極性（利用者指摘 2026-09-20「どちらがPかNか分からない」）。
            ⑭⑬ のネジの真下に、3Dソケットの面の印字・ツールチップと同じ言葉で出す。
            `data-pin` の組には入れない（番号だけを読む既存の引き方を壊さないため）。
          */}
          {[COIL_P_PIN, COIL_N_PIN].map((pin) => {
            const pos = pinoutPinPos(pin);
            if (pos === undefined) return null;
            return (
              <text
                key={`polarity-${String(pin)}`}
                className={styles.polarity}
                data-polarity={pin}
                x={pos.x}
                y={pos.y + POLARITY_DY}
                textAnchor="middle"
              >
                {busSideMark(coilBusSide(pin))}
              </text>
            );
          })}
        </svg>
      </figure>
      <p className={styles.pairs}>{contactSetsText(CONTACT_SETS)}</p>
      <p className={styles.pairs}>{coilPolarityText(COIL_P_PIN, COIL_N_PIN)}</p>
    </div>
  );
}
