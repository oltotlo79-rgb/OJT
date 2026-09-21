import { NEEDLE_FULL_SCALE_DEG, ohmNeedleDeg, type AnalogOhmRange } from '@ojt/circuit-sim';
import { useRef, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { useElementWidth } from '../app/use-element-size.js';
import { useUiScale } from '../app/ui-preferences.js';
import { JA } from '../i18n/ja.js';
import styles from './tester.module.css';

/**
 * アナログ計器の目盛板と針。設計仕様 §9.3。
 *
 * 針の角度（`needleDeg`）は Worker が時定数100msで積分した値をそのまま使う（Plan 2A の
 * `stepTester()`）。ここは**写像と描画だけ**を行い、計器の物理には手を入れない。
 *
 * 目盛は針とまったく同じ式（`ohmNeedleDeg()` / 線形比例）から角度を出すので、
 * レンジを変えても針と目盛がずれない。
 */

/** 目盛板の大きさ（論理単位。`viewBox` の座標）。 */
const WIDTH = 200;
const HEIGHT = 108;
/** 針の回転中心。 */
const PIVOT_X = WIDTH / 2;
const PIVOT_Y = 98;
/** 針の長さと、目盛の内側・外側の半径。 */
const NEEDLE_R = 78;
const TICK_OUTER_R = 82;
const TICK_INNER_R = 72;
const LABEL_R = 62;

/** 目盛1本。 */
export interface ScaleTick {
  /** 針の角度[度]（0＝左端、`NEEDLE_FULL_SCALE_DEG`＝右端）。 */
  deg: number;
  /** 目盛の数字。 */
  label: string;
}

/**
 * 針の角度[度]を目盛板の座標へ写す。
 * 可動範囲 `0`〜`NEEDLE_FULL_SCALE_DEG` を、真上を中心に左右45度ずつの扇に割り当てる
 * （左端＝0、真上＝半分、右端＝フルスケール）。SVG は y が下向きなので符号を反転する。
 */
export function needleTip(
  deg: number,
  cx: number,
  cy: number,
  r: number,
): { x: number; y: number } {
  const clamped = Math.min(Math.max(deg, 0), NEEDLE_FULL_SCALE_DEG);
  // 数学の慣習（+x から反時計回り）で 135度（左上）→ 45度（右上）へ向かう
  const theta = ((135 - clamped) * Math.PI) / 180;
  return { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) };
}

/** 数字を目盛に載る短さへ丸める（有効数字2桁。整数はそのまま）。 */
function scaleNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(2)));
}

/** 電圧目盛（線形。0 からレンジ値まで等間隔に5本）。§9.3 */
export function voltScaleTicks(range: number): ScaleTick[] {
  const steps = 4;
  const out: ScaleTick[] = [];
  for (let i = 0; i <= steps; i += 1) {
    out.push({
      deg: (NEEDLE_FULL_SCALE_DEG * i) / steps,
      label: scaleNumber((range * i) / steps),
    });
  }
  return out;
}

/** Ω目盛の刻み（倍率×1のときの値）。実機の目盛板と同じ「右が詰まる」並びにする。§9.3 */
const OHM_SCALE_BASE: readonly number[] = [0, 2, 5, 10, 20, 50, 100, 200, 1000];

/**
 * Ω目盛（中央目盛方式。右端が0Ω・左端が∞）。§9.3
 * 角度は針と同じ `ohmNeedleDeg()` から引くので、内部抵抗（×1で12Ω・×10で120Ω・×1kで12kΩ）が
 * そのまま目盛の詰まり方に出る。
 */
export function ohmScaleTicks(range: AnalogOhmRange): ScaleTick[] {
  const out: ScaleTick[] = OHM_SCALE_BASE.map((base) => ({
    deg: ohmNeedleDeg(base * range, range),
    label: scaleNumber(base * range),
  }));
  // 左端（0度）は無限大。`ohmNeedleDeg(Infinity, …)` は 0 を返さない（有限性を要求する）ので直に置く
  out.push({ deg: 0, label: '∞' });
  return out;
}

/** 目盛1本ぶんの線と数字。 */
function Tick({
  tick,
  fontSize,
  labelled,
}: {
  tick: ScaleTick;
  fontSize: number;
  labelled: boolean;
}): JSX.Element {
  const outer = needleTip(tick.deg, PIVOT_X, PIVOT_Y, TICK_OUTER_R);
  const inner = needleTip(tick.deg, PIVOT_X, PIVOT_Y, TICK_INNER_R);
  const label = needleTip(tick.deg, PIVOT_X, PIVOT_Y, LABEL_R);
  return (
    <g>
      <line x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} stroke="#23262B" strokeWidth={1} />
      {labelled ? (
        <text
          x={label.x}
          y={label.y}
          fill="#23262B"
          fontSize={fontSize}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {tick.label}
        </text>
      ) : null}
    </g>
  );
}

/** アナログ計器。 */
export function AnalogMeter(): JSX.Element {
  const host = useRef<SVGSVGElement | null>(null);
  const width = useElementWidth(host) ?? WIDTH;
  const scale = useUiScale();
  const fontSize = (12 * Math.max(1, scale) * WIDTH) / width;
  const mode = useStore((s) => s.tester.mode);
  const voltRange = useStore((s) => s.tester.voltRange);
  const ohmRange = useStore((s) => s.tester.ohmRange);
  const needleDeg = useStore((s) => s.snapshot.tester.needleDeg);
  const ticks =
    mode === 'OHM' || mode === 'CONT' ? ohmScaleTicks(ohmRange) : voltScaleTicks(voltRange);
  const labelled = readableMeterLabels(ticks, fontSize);
  const tip = needleTip(needleDeg, PIVOT_X, PIVOT_Y, NEEDLE_R);
  const arcStart = needleTip(0, PIVOT_X, PIVOT_Y, TICK_OUTER_R);
  const arcEnd = needleTip(NEEDLE_FULL_SCALE_DEG, PIVOT_X, PIVOT_Y, TICK_OUTER_R);
  return (
    <svg
      ref={host}
      className={styles.meter}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={JA.tester.meterLabel}
      data-testid="analog-meter"
    >
      <path
        d={`M ${arcStart.x} ${arcStart.y} A ${TICK_OUTER_R} ${TICK_OUTER_R} 0 0 1 ${arcEnd.x} ${arcEnd.y}`}
        fill="none"
        stroke="#23262B"
        strokeWidth={1.2}
      />
      {ticks.map((tick, index) => (
        <Tick
          key={`${tick.label}-${String(tick.deg)}`}
          tick={tick}
          fontSize={fontSize}
          labelled={labelled.has(index)}
        />
      ))}
      <line
        data-testid="analog-needle"
        data-deg={needleDeg.toFixed(2)}
        x1={PIVOT_X}
        y1={PIVOT_Y}
        x2={tip.x}
        y2={tip.y}
        stroke="#B4271F"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <circle cx={PIVOT_X} cy={PIVOT_Y} r={3.2} fill="#23262B" />
    </svg>
  );
}

/** 目盛線は残し、密集する端の数字だけを間引く。両端の0・∞／最大値を優先する。 */
export function readableMeterLabels(ticks: readonly ScaleTick[], fontSize: number): Set<number> {
  const shown = new Set<number>();
  const occupied: Array<{ x: number; y: number; halfWidth: number }> = [];
  const order = [...new Set([0, ticks.length - 1, ...ticks.map((_tick, index) => index)])];
  for (const index of order) {
    const tick = ticks[index];
    if (tick === undefined) continue;
    const position = needleTip(tick.deg, PIVOT_X, PIVOT_Y, LABEL_R);
    const halfWidth = (tick.label.length * fontSize * 0.62) / 2;
    if (
      occupied.some(
        (other) =>
          Math.abs(other.x - position.x) < other.halfWidth + halfWidth + 3 &&
          Math.abs(other.y - position.y) < fontSize + 2,
      )
    )
      continue;
    occupied.push({ ...position, halfWidth });
    shown.add(index);
  }
  return shown;
}
