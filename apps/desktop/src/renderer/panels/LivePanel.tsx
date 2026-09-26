import { useMemo, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { CollapsiblePanel } from './CollapsiblePanel.js';
import { liveChart, TimeChartSvg } from './TimeChartPanel.js';

/** ライブチャートの最小横軸長[ms]（開始直後に潰れないようにする）。 */
const LIVE_MIN_DURATION_MS = 5000;

/** ライブチャートの横軸長の量子[ms]（指摘 DS-2 ≡ UI-02）。 */
const LIVE_DURATION_QUANTUM_MS = 500;

/**
 * ライブチャートの横軸長[ms]。`snapshot.tMs`（33msごとに変わる）をそのまま使うと、変化点が
 * 1つも増えていなくても毎スナップショット＝毎秒約30回、`liveChart()` から `ChartCanvas` の
 * `polyline` 文字列作りまでが丸ごと走り直す（指摘 DS-2 ≡ UI-02）。500ms に丸めて依存を粗くし、
 * 再計算を最大でも毎秒2回に落とす。丸めは**切り上げ**なので、直近の変化点が軸からはみ出すことは
 * ない（横軸は常に現在時刻以上）。
 */
export function liveDurationMs(tMs: number): number {
  const quantised = Math.ceil(tMs / LIVE_DURATION_QUANTUM_MS) * LIVE_DURATION_QUANTUM_MS;
  return Math.max(quantised, LIVE_MIN_DURATION_MS);
}

/**
 * ライブ記録のチャート。§8.2
 * 毎秒約30回変わる `snapshot.tMs` をここで受けることで、`Session`（＝3Dビューポートを含む）を
 * 巻き添えで再描画しない（§15）。受けるのは `liveDurationMs()` で 500ms に丸めた横軸長なので、
 * この部品自身も毎秒2回までしか再描画されない（指摘 DS-2 ≡ UI-02）。
 *
 * UXレビュー #9: 何も起きていないうちは空のグラフを出さず折りたたんでおき、最初の変化点が
 * 記録されたら自動で開く。そのあとは訓練者が自分で畳み直せる（強制はしない）。
 */
export function LivePanel(): JSX.Element {
  const chartSpecs = useStore((s) => s.chartSpecs);
  const liveTransitions = useStore((s) => s.liveTransitions);
  // セレクタの中で丸める。`tMs` そのものを購読すると 33ms ごとにこの部品が再描画される
  const durationMs = useStore((s) => liveDurationMs(s.snapshot.tMs));
  const hasRecording = Object.keys(liveTransitions).length > 0;
  const live = useMemo(
    () => liveChart(chartSpecs, liveTransitions, durationMs),
    [chartSpecs, liveTransitions, durationMs],
  );
  return (
    <CollapsiblePanel
      title={JA.session.liveChart}
      testId="live-panel"
      summary={hasRecording ? JA.liveCollapse.expand : JA.liveCollapse.empty}
    >
      <TimeChartSvg chart={live} title={JA.session.liveChart} />
    </CollapsiblePanel>
  );
}
