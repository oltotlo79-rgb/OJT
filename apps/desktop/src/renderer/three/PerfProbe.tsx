import { useFrame, useThree } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';

/**
 * 性能の計測窓。設計仕様 §15（内蔵GPUで60fps・三角形20万以下）/ Plan 5 決定表#16。
 *
 * `frameloop="demand"` では `useFrame` は**実際に描いたフレームだけ**走る。そこで
 * ①累計の描画枚数（無操作で増えなければ `demand` が効いている）②直近の fps
 * ③three の `gl.info`（三角形数・ドローコール・ジオメトリ数・テクスチャ数）を
 * 隠し要素へ JSON で書き出す。E2E（`perf.spec.ts`）と実機確認の唯一の窓である。
 *
 * 書き出しは `PERF_INTERVAL_MS` ごとに間引く（毎フレーム DOM を触ると計測が計測を邪魔する）。
 * React の状態にはしない（毎フレーム再描画になる。`camera-readout` と同じ流儀）。
 *
 * 三角形数・ドローコールを**盤ごと**測れるようにしている仕掛けは
 * `configurePerfCounters()` / `takeRenderCounters()` にある（3D-01）。
 */

/** 書き出しの間隔[ms]。 */
export const PERF_INTERVAL_MS = 250;

/**
 * `gl.info` のうちこの計測窓が触る部分だけを表した形（three の `WebGLInfo` はこれに当てはまる）。
 * テストから偽物を渡せるように、クラスではなく構造で受ける。
 */
export interface PerfInfo {
  /** `WebGLRenderer.render()` の冒頭で `reset()` を自動で呼ぶか。 */
  autoReset: boolean;
  render: { triangles: number; calls: number };
  reset: () => void;
}

/** 1フレームに描いた量（`gl.info.render` から取る）。 */
export interface RenderCounters {
  triangles: number;
  calls: number;
}

/**
 * `gl.info` の自動リセットを止める（`Canvas` の `onCreated` から1回だけ呼ぶ）。
 *
 * **3D-01（2026-09-20 レビュー・Critical）**: ビューキューブは drei の `Hud` で描いており、
 * `Hud` は優先度1の `useFrame` の中で `gl.render()` を**2回**呼ぶ（盤 → ギズモ）。three の
 * `WebGLRenderer.render()` は `autoReset === true` のとき毎回冒頭で `info.reset()` するので、
 * フレームの終わりに `gl.info.render` に残るのは**ギズモ単体の値**（三角形280・ドローコール30）
 * だけになる。`PerfProbe` は優先度0＝ギズモより先に走るため、読んでいたのはその残骸であり、
 * §15 の性能予算は盤を一度も測っていなかった（3視点とも 280/30 で同値だったのがその証拠）。
 * 自動リセットを止めると2回の `render()` が合算され、**盤＋ギズモの合計**になる。
 * 止めたぶんは `takeRenderCounters()` が毎フレーム自分で戻す。
 */
export function configurePerfCounters(gl: { info: PerfInfo }): void {
  gl.info.autoReset = false;
}

/**
 * 前フレームぶんの描画量を読み、読み終えたら 0 に戻す（3D-01）。
 *
 * `configurePerfCounters()` で自動リセットを止めているので、**誰かが必ず戻さないと累積する**。
 * `PerfProbe` の `useFrame` の先頭がその唯一の場所である。`info.reset()` は
 * `render.{calls,triangles,points,lines}` だけを 0 にし、`render.frame` と `memory` は
 * 触らないので、累計カウンタもテクスチャ数も壊れない。
 */
export function takeRenderCounters(info: PerfInfo): RenderCounters {
  const taken = { triangles: info.render.triangles, calls: info.render.calls };
  info.reset();
  return taken;
}

/** 隠し要素に書く値。 */
export interface PerfReadout {
  /**
   * 直近 `PERF_INTERVAL_MS`（250ms）ぶんに描いたフレーム数（**累計ではない**。M7:
   * Plan 5 C/D レビュー）。`PerfProbe` は書き出すたびにこの窓を0へ戻す。アプリを起動して
   * からの累計は隠し要素の `data-total-frames` にある（無操作3秒で増えないことを見る
   * E2E はそちらを読むこと）。
   */
  frames: number;
  /** 直近 `PERF_INTERVAL_MS` の実効フレームレート[fps]（小数1桁）。 */
  fps: number;
  /** 直近に描いた1フレームの三角形数（**盤＋ビューキューブの合計**。3D-01）。 */
  triangles: number;
  /** 直近に描いた1フレームのドローコール数（**盤＋ビューキューブの合計**。3D-01）。 */
  calls: number;
  geometries: number;
  textures: number;
}

/** `gl.info` から取る生の値。 */
export interface PerfCounters {
  frames: number;
  triangles: number;
  calls: number;
  geometries: number;
  textures: number;
}

/** 生の値と経過時間から読み値を作る（純粋関数）。 */
export function perfSample(counters: PerfCounters, elapsedMs: number): PerfReadout {
  const fps = elapsedMs <= 0 ? 0 : Math.round((counters.frames / elapsedMs) * 1000 * 10) / 10;
  return {
    frames: counters.frames,
    fps,
    triangles: counters.triangles,
    calls: counters.calls,
    geometries: counters.geometries,
    textures: counters.textures,
  };
}

/** 隠し要素に書く文字列。 */
export function formatPerf(readout: PerfReadout): string {
  return JSON.stringify(readout);
}

/** 隠し要素の文字列を読み値に戻す（E2E が使う。形が違えば undefined）。 */
export function parsePerf(text: string): PerfReadout | undefined {
  if (text.length === 0) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== 'object') return undefined;
  const value = raw as Partial<PerfReadout>;
  const keys: Array<keyof PerfReadout> = [
    'frames',
    'fps',
    'triangles',
    'calls',
    'geometries',
    'textures',
  ];
  if (keys.some((key) => typeof value[key] !== 'number')) return undefined;
  return value as PerfReadout;
}

/**
 * 計測窓（`Canvas` の中に置く）。描いたフレームごとに数え、`PERF_INTERVAL_MS` ごとに書き出す。
 * JSON の `frames` は**直近の窓ぶん**（`windowFrames`。累計ではない。M7）。無操作のあいだ
 * 増えなければ `frameloop="demand"` が効いている、を見るのは累計を持つ `data-total-frames`
 * の方（`total`）。
 */
export function PerfProbe({ nodeRef }: { nodeRef: RefObject<HTMLDivElement | null> }): null {
  const gl = useThree((state) => state.gl);
  const total = useRef(0);
  const windowFrames = useRef(0);
  const windowStart = useRef(0);
  const lastDrawn = useRef<RenderCounters>({ triangles: 0, calls: 0 });
  useFrame(() => {
    /*
     * 3D-01: **いちばん先頭**で前フレームぶんを読んで 0 に戻す。`PerfProbe` は優先度0なので、
     * ここで読めるのは「前のフレームで描いた盤＋ギズモの合計」である（`configurePerfCounters()`
     * の doc comment）。読んだ値を覚えておき、書き出しの番が来たらそれを使う。
     */
    lastDrawn.current = takeRenderCounters(gl.info);
    total.current += 1;
    windowFrames.current += 1;
    const now = performance.now();
    if (windowStart.current === 0) windowStart.current = now;
    const elapsed = now - windowStart.current;
    if (elapsed < PERF_INTERVAL_MS) return;
    const node = nodeRef.current;
    if (node !== null) {
      node.textContent = formatPerf(
        perfSample(
          {
            frames: windowFrames.current,
            triangles: lastDrawn.current.triangles,
            calls: lastDrawn.current.calls,
            geometries: gl.info.memory.geometries,
            textures: gl.info.memory.textures,
          },
          elapsed,
        ),
      );
      // 累計は別に持つ（`frames` は窓ごとの枚数なので、E2E が「増えていないこと」を見るために
      // 累計も出す）。属性で出すと JSON を壊さずに済む
      node.dataset['totalFrames'] = String(total.current);
    }
    windowFrames.current = 0;
    windowStart.current = now;
  });
  return null;
}
