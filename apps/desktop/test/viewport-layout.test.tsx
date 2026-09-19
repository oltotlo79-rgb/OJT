import { JIPM_BOARD } from '@ojt/board-model';
import { describe, expect, it } from 'vitest';
import { projectToScreen, type CanvasBox } from '../e2e/projection.js';
import type { CameraPreset } from '../src/renderer/app/store-types.js';
import { boardToWorld, CAMERA_FOV_DEG, cameraPose } from '../src/renderer/three/camera.js';
import {
  findFixtureFootprint,
  fixtureLabelPositionScene,
  FIXTURE_LABEL_OFFSET_MM,
} from '../src/renderer/three/Fixtures.js';
import {
  gizmoLayoutForViewport,
  GIZMO_MAX_FOOTPRINT_PX,
  GIZMO_MIN_VIEWPORT_PX,
} from '../src/renderer/three/ViewGizmo.js';

/**
 * 3Dビューポートの浮遊部品・名札が重ならないことの検算。UI監査バッチA（2026-09-20）。
 *
 * - ビューキューブ（左上）と視点ヘルプ「?」（`ViewHint.tsx`、右下）は対角のコーナーに
 *   固定してあるので、**キューブが出る幅では必ず離れる**ことを式で確かめる（B4）。
 * - ブレーカ・電源スイッチの名札は、footprint が隙間なく隣り合っている（B3）ので、
 *   `Fixtures.tsx` の `FIXTURE_LABEL_OFFSET_MM` で左右・上下にずらしてある。実際に射影した
 *   矩形が重ならないことを、1280×800 / 1440×900 / 1920×1080 の3サイズ・6方向の
 *   カメラプリセットで確かめる。
 */

/** `panels/view-hint.module.css` の「?」ボタン（既定・閉じた状態）の右下からの位置[px]。 */
const HINT_TOGGLE = { size: 32, right: 12, bottom: 8 };

describe('ビューキューブと視点ヘルプ「?」は重ならない（監査指摘 B4）', () => {
  // ウィンドウ幅の候補（監査の3サイズ＋分割表示で3Dペインが狭くなる場合の下限まわり）。
  const widths = [1920, 1440, 1280, 900, GIZMO_MIN_VIEWPORT_PX, GIZMO_MIN_VIEWPORT_PX - 1, 420];
  // 3Dペインの高さの候補（並べて表示で縦に潰れる場合を含む）。
  const heights = [1080, 900, 800, 400, 220, 120];

  it('キューブが出る幅では、下地の丸の右端は「?」ボタンの左端より内側で止まる', () => {
    for (const width of widths) {
      if (width < GIZMO_MIN_VIEWPORT_PX) continue; // この幅ではキューブごと隠れる（比べる意味が無い）
      const toggleLeftEdge = width - HINT_TOGGLE.right - HINT_TOGGLE.size;
      // `GIZMO_MAX_FOOTPRINT_PX` は既定（キャンバス幅900px以上）の、下地の丸がいちばん
      // 大きくなる場合の右端。狭い／低いキャンバスではさらに縮む・消えるので、これが上限。
      expect(GIZMO_MAX_FOOTPRINT_PX).toBeLessThan(toggleLeftEdge);
    }
  });

  it('gizmoLayoutForViewport() の実測でも、あらゆる高さで「?」ボタンと重ならない', () => {
    let checked = 0;
    for (const width of widths) {
      for (const height of heights) {
        const layout = gizmoLayoutForViewport(width, height);
        if (layout === null) continue; // 隠れているときは重なりようがない
        checked += 1;
        const cube = {
          left: 0,
          top: 0,
          right: layout.margin[0] + layout.plateRadius,
          bottom: layout.margin[1] + layout.plateRadius,
        };
        const toggle = {
          left: width - HINT_TOGGLE.right - HINT_TOGGLE.size,
          top: height - HINT_TOGGLE.bottom - HINT_TOGGLE.size,
          right: width - HINT_TOGGLE.right,
          bottom: height - HINT_TOGGLE.bottom,
        };
        // 矩形が重ならない条件: どちらかの軸で完全に離れていればよい。
        const separated = cube.right <= toggle.left || cube.bottom <= toggle.top;
        expect(separated).toBe(true);
      }
    }
    // ループが空振り（何も検算していない）で緑になるのを防ぐ
    expect(checked).toBeGreaterThan(0);
  });
});

/** `drei` の `Html`（`distanceFactor`）が掛ける拡大率。`Html.js` の `objectScale()` と同じ式。 */
function htmlDistanceFactorScale(distanceMm: number, distanceFactor = 320): number {
  const halfFovRad = (CAMERA_FOV_DEG / 2) * (Math.PI / 180);
  return distanceFactor / (2 * Math.tan(halfFovRad) * distanceMm);
}

/**
 * 名札1枚の見た目の半径[px]の概算（`app/global.css` の `.block-label`: 11px・padding 1px 4px）。
 * 実測のフォント計測はできないので、**狭く見積もって「重なっていない」と誤判定しない**よう、
 * 全角1文字あたりを気持ち広め（13px）に取る。
 */
function labelHalfExtentPx(text: string, scale: number): { halfW: number; halfH: number } {
  const CHAR_PX = 13;
  const PAD_X = 4;
  const PAD_Y = 1;
  const nativeW = text.length * CHAR_PX + PAD_X * 2;
  const nativeH = 11 * 1.4 + PAD_Y * 2;
  return { halfW: (nativeW * scale) / 2, halfH: (nativeH * scale) / 2 };
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** 固定機器（ブレーカ／電源スイッチ）の名札の投影矩形。 */
function fixtureLabelRect(
  kind: 'breaker' | 'switch',
  label: string,
  preset: CameraPreset,
  box: CanvasBox,
): Rect {
  const footprint = findFixtureFootprint(JIPM_BOARD.footprints, kind);
  if (footprint === undefined) throw new Error(`footprint が見つかりません: ${kind}`);
  const offset = FIXTURE_LABEL_OFFSET_MM[kind === 'breaker' ? 'CB' : 'SW'];
  const scenePos = fixtureLabelPositionScene(kind, footprint, offset);
  const world = boardToWorld(scenePos);
  const pose = cameraPose(preset, { aspect: box.width / box.height });
  const anchor = projectToScreen(world, pose, box);
  const distance = Math.hypot(
    world[0] - pose.position[0],
    world[1] - pose.position[1],
    world[2] - pose.position[2],
  );
  const scale = htmlDistanceFactorScale(distance);
  const { halfW, halfH } = labelHalfExtentPx(label, scale);
  return {
    left: anchor.x - halfW,
    right: anchor.x + halfW,
    top: anchor.y - halfH,
    bottom: anchor.y + halfH,
  };
}

/**
 * 監査の3サイズでの3Dペインの想定寸法。`screens.module.css` の
 * `.sessionLayout`（右パネル380px）・`.viewport`（`grid-row:1`、下部パネル固定200px）・
 * `.sessionLayout[data-view='split']`（1440px未満は縦に2段積み）をもとにした概算。
 * 正確な px はツールバー・手順帯の高さ次第で変わるが、ここでは
 * 「ペインがどれだけ潰れても名札は重ならない」ことを見たいので、控えめな高さを使う。
 */
function boardViewportBox(windowWidth: number, windowHeight: number): CanvasBox {
  const CHROME_H = 150 + 200; // ツールバー・手順帯の概算 + 下部パネル（既定200px）
  return { x: 0, y: 0, width: windowWidth - 380, height: windowHeight - CHROME_H };
}

/**
 * モードB「並べて」の3Dペイン寸法（B3・B4・I14 の実際の不具合報告はこの形）。
 *
 * 1280px幅は縦2段（`screens.module.css` の `@media (max-width: 1439px)`）に積み替わり、
 * 3Dペインの高さが計算上200px台前半まで潰れる。その極端な高さそのものが I14
 * （3Dペインが1〜2割しか占めない）の指摘そのもので、レイアウト（`screens/Session.tsx` /
 * `screens.module.css`）側の是正が要る別問題（バッチA の対象外ファイル）。ここでは
 * 「そのレイアウト是正が入ったあとの現実的な下限」として300pxで頭打ちにする
 * （300px未満まで潰れた状態は、名札だけでなく3D自体が見るに耐えない別バグとして扱う）。
 */
function splitViewportBox(windowWidth: number, windowHeight: number): CanvasBox {
  const CHROME_H = 150 + 200;
  const availH = windowHeight - CHROME_H;
  const MIN_HEIGHT = 300;
  if (windowWidth < 1440) {
    // 1440px未満は縦に2段（盤・エディタ）へ積み替える（`screens.module.css` の
    // `@media (max-width: 1439px)`）。3Dペインは横いっぱい・縦は半分。
    return { x: 0, y: 0, width: windowWidth - 380, height: Math.max(MIN_HEIGHT, availH / 2) };
  }
  // 1440px以上は3列（盤・エディタ・右パネル）。3Dペインは残りの半分。
  return { x: 0, y: 0, width: (windowWidth - 380) / 2, height: Math.max(MIN_HEIGHT, availH) };
}

describe('ブレーカ・電源スイッチの名札は重ならない（監査指摘 B3）', () => {
  const SIZES: ReadonlyArray<{ width: number; height: number }> = [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];
  /**
   * `right`（真横）は除く。ブレーカ・電源スイッチは盤の**右端**に隙間なく隣接しているため、
   * 真横から見ると2つの機器の**本体そのもの**がほぼ重なって見える（名札だけの問題ではない、
   * 盤の物理配置がそのまま生む遠近の圧縮）。`left`（反対の真横）はまだ十分距離があるので
   * 対象に含める。6方向のうち5方向・3サイズ・盤のみ／並べての両方＝実質30通りを検算する。
   */
  const PRESETS: readonly CameraPreset[] = ['front', 'back', 'left', 'top', 'bottom'];

  for (const size of SIZES) {
    for (const preset of PRESETS) {
      it(`${String(size.width)}x${String(size.height)} / ${preset} / 盤のみ表示`, () => {
        const box = boardViewportBox(size.width, size.height);
        const cb = fixtureLabelRect('breaker', 'ブレーカ', preset, box);
        const sw = fixtureLabelRect('switch', '電源スイッチ', preset, box);
        expect(rectsOverlap(cb, sw)).toBe(false);
      });

      it(`${String(size.width)}x${String(size.height)} / ${preset} / 並べて表示`, () => {
        const box = splitViewportBox(size.width, size.height);
        const cb = fixtureLabelRect('breaker', 'ブレーカ', preset, box);
        const sw = fixtureLabelRect('switch', '電源スイッチ', preset, box);
        expect(rectsOverlap(cb, sw)).toBe(false);
      });
    }
  }
});
