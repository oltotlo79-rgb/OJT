import {
  ANALOG_OHM_RANGES,
  TESTER_NO_PROBE_DISPLAY,
  TESTER_OFF_DISPLAY,
  voltRangesFor,
  type TesterAction,
  type TesterKind,
  type TesterMode,
} from '@ojt/circuit-sim';
import type { JSX } from 'react';
import { useStore, type ProbeSide } from '../app/store.js';
import { JA, ohmRangeLabel, probeLabel, voltRangeLabel } from '../i18n/ja.js';
import { bridge } from '../session/worker-bridge.js';
import { AnalogMeter } from './AnalogMeter.js';
import styles from './tester.module.css';

/**
 * テスターパネル。設計仕様 §9.3。
 *
 * 操作は**ストアと Worker の両方**へ流す。ストアの `tester` は画面（つまみの位置・プローブの
 * 端子）を描くため、Worker の `tester` は毎tick測って読値を返すために要る。どちらも
 * Plan 2A の `applyTesterAction()` を通るので、2つの複製がずれることはない。
 *
 * 読値は `snapshot.tester` に約30fpsで届く。パネル全体でそれを購読すると、つまみもレンジも
 * 毎秒30回描き直されるので、**表示器だけ**を専用の小さなコンポーネント（`TesterReadout`）に
 * 切り出す（`LivePanel` / `SoundEffects` と同じ方針。§15）。
 */

/** つまみの位置と表示名。§9.3 */
const MODES: ReadonlyArray<{ mode: TesterMode; label: string }> = [
  { mode: 'off', label: JA.tester.modeOff },
  { mode: 'DCV', label: JA.tester.modeDcv },
  { mode: 'ACV', label: JA.tester.modeAcv },
  { mode: 'OHM', label: JA.tester.modeOhm },
  { mode: 'CONT', label: JA.tester.modeCont },
];

/** 種別の切替。§9.3 */
const KINDS: ReadonlyArray<{ kind: TesterKind; label: string }> = [
  { kind: 'digital', label: JA.tester.kindDigital },
  { kind: 'analog', label: JA.tester.kindAnalog },
];

/** ストアと Worker の両方へテスター操作を流す。 */
export function dispatchTester(action: TesterAction): void {
  useStore.getState().applyTester(action);
  bridge.send({ type: 'tester', action });
}

/**
 * 読値の単位。生値の `display`（Worker契約・E2Eが素の数値と比較する）は変えず、
 * 別要素に添えて出す。`OL` / `----` / `OFF` は測れていないので単位を出さない（レビュー指摘）。
 */
function testerUnit(mode: TesterMode, display: string): string {
  const blank =
    display === 'OL' || display === TESTER_NO_PROBE_DISPLAY || display === TESTER_OFF_DISPLAY;
  if (mode === 'OHM') return blank ? '' : 'Ω';
  if (mode === 'DCV' || mode === 'ACV') return 'V';
  return '';
}

/**
 * 表示器（読値）。`snapshot.tester` だけを購読する。§15
 * アナログの針は `AnalogMeter`（Task 6）が描く。ここは文字だけを出す。
 */
export function TesterReadout(): JSX.Element {
  const reading = useStore((s) => s.snapshot.tester);
  const unit = testerUnit(reading.mode, reading.display);
  return (
    <>
      <div className={styles.readout} data-testid="tester-readout" role="status" aria-live="off">
        {reading.display}
      </div>
      {unit === '' ? null : (
        <span className={styles.unit} data-testid="tester-unit">
          {unit}
        </span>
      )}
      {reading.live ? (
        <p className={styles.note} data-testid="tester-live-note">
          {JA.tester.liveNote}
        </p>
      ) : null}
      {reading.overRange ? (
        <p className={styles.note} data-testid="tester-over-note">
          {JA.tester.overRangeNote}
        </p>
      ) : null}
      {reading.conductive ? (
        <p className={styles.hint} data-testid="tester-buzz">
          {JA.tester.buzzing}
        </p>
      ) : null}
    </>
  );
}

/** プローブ1本ぶんの行。 */
function ProbeRow({ side }: { side: ProbeSide }): JSX.Element {
  const terminal = useStore((s) => (side === 'black' ? s.tester.black : s.tester.red));
  const next = useStore((s) => s.nextProbe);
  return (
    <div className={styles.probeRow}>
      <button
        type="button"
        className={side === 'black' ? styles.probeBlack : styles.probeRed}
        data-testid={`probe-${side}`}
        aria-pressed={next === side}
        onClick={() => {
          useStore.getState().setNextProbe(side);
        }}
      >
        {probeLabel(side, terminal)}
      </button>
      {terminal === undefined ? null : (
        <button
          type="button"
          data-testid={`lift-${side}`}
          onClick={() => {
            dispatchTester({ type: 'place-probe', probe: side, terminal: undefined });
          }}
        >
          {JA.tester.lift}
        </button>
      )}
    </div>
  );
}

/** テスターパネル本体。 */
export function TesterPanel({ children }: { children?: JSX.Element }): JSX.Element {
  const kind = useStore((s) => s.tester.kind);
  const mode = useStore((s) => s.tester.mode);
  const voltRange = useStore((s) => s.tester.voltRange);
  const ohmRange = useStore((s) => s.tester.ohmRange);
  const zeroAdjusted = useStore((s) => s.tester.zeroAdjusted);
  const isOhmSide = mode === 'OHM' || mode === 'CONT';
  // 0Ω調整はアナログのΩ／導通レンジでしか意味が無い（デジタルは自動で補正する）。§9.3
  const canZero = kind === 'analog' && isOhmSide;

  return (
    <section className={styles.panel} data-testid="tester-panel">
      <h2 className={styles.title}>{JA.tester.title}</h2>
      <TesterReadout />
      {kind === 'analog' ? <AnalogMeter /> : null}
      <div className={styles.row} role="group" aria-label={JA.tester.kindGroup}>
        {KINDS.map((item) => (
          <button
            key={item.kind}
            type="button"
            aria-pressed={kind === item.kind}
            onClick={() => {
              dispatchTester({ type: 'set-kind', kind: item.kind });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className={styles.row}
        data-testid="tester-modes"
        role="group"
        aria-label={JA.tester.modeGroup}
      >
        {MODES.map((item) => (
          <button
            key={item.mode}
            type="button"
            aria-pressed={mode === item.mode}
            onClick={() => {
              dispatchTester({ type: 'set-mode', mode: item.mode });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {kind === 'digital' ? (
        <p className={styles.hint} data-testid="tester-autorange">
          {JA.tester.autoRange}
        </p>
      ) : mode === 'off' ? null : (
        <div
          className={styles.row}
          data-testid="tester-ranges"
          role="group"
          aria-labelledby="tester-range-label"
        >
          <span className={styles.label} id="tester-range-label">
            {JA.tester.range}
          </span>
          {isOhmSide
            ? ANALOG_OHM_RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={ohmRange === range}
                  onClick={() => {
                    dispatchTester({ type: 'set-ohm-range', range });
                  }}
                >
                  {ohmRangeLabel(range)}
                </button>
              ))
            : voltRangesFor(mode).map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={voltRange === range}
                  onClick={() => {
                    dispatchTester({ type: 'set-volt-range', range });
                  }}
                >
                  {voltRangeLabel(range)}
                </button>
              ))}
        </div>
      )}

      <div className={styles.row}>
        <button
          type="button"
          disabled={!canZero}
          onClick={() => {
            dispatchTester({ type: 'zero-adjust' });
          }}
        >
          {JA.tester.zeroAdjust}
        </button>
        {canZero ? (
          <span className={styles.label} data-testid="zero-state">
            {zeroAdjusted ? JA.tester.zeroDone : JA.tester.zeroTodo}
          </span>
        ) : null}
      </div>

      <ProbeRow side="black" />
      <ProbeRow side="red" />
      {/* プローブの置き場所ショートカット（モードC1）はプローブ欄の隣に出す。§9.1 */}
      {children}
      <p className={styles.hint}>{JA.tester.placeHint}</p>
    </section>
  );
}
