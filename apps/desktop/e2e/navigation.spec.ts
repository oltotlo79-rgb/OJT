import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, shot } from './app.js';
import { closeOverflow, openOverflow } from './projection.js';
import { gizmoLayoutForViewport } from '../src/renderer/three/ViewGizmo.js';
import { GIZMO_DRAG_RAD_PER_PX } from '../src/renderer/three/navigation.js';
import { cameraPose, type CameraPose } from '../src/renderer/three/camera.js';

/**
 * Blender 風の3Dナビゲーションの E2E（設計仕様 §12.2 / §14.2）。
 * 2026-09-14 の利用者要望「3D図の回転や拡大は blender の操作感を目指し、
 * キューブをドラッグすることで画面を回せるように」を、本物の Electron 上で確かめる。
 *
 * カメラの状態は隠し要素 `camera-readout`（`BoardScene` が `OrbitControls` の `change` で
 * 直接書く）から読む。絵の差分ではなく**方位角・極角・距離・注視点**で見るので、
 * ソフトウェアラスタライザ（SwiftShader）の描画差に左右されない。
 */

/** カメラの状態（`cameraReadoutText()` が書く JSON）。 */
interface Camera {
  position: [number, number, number];
  up: [number, number, number];
  az: number;
  polar: number;
  dist: number;
  tx: number;
  ty: number;
  tz: number;
}

/** いまのカメラの向き・距離・注視点。 */
async function camera(page: Page): Promise<Camera> {
  const text = await page.getByTestId('camera-readout').textContent();
  if (text === null || text.length === 0) throw new Error('camera-readout が空です');
  return JSON.parse(text) as Camera;
}

/** 3Dキャンバスの矩形。 */
async function canvasBox(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await page.locator('[data-testid="viewport"] canvas').boundingBox();
  if (box === null) throw new Error('キャンバスが見つかりません');
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/**
 * いまのキャンバス幅でのHUDの置き方。2026-09-20 の利用者指摘「重なってるし」対応で
 * `ViewGizmo` の大きさ・余白はキャンバス幅で決まる（`gizmoLayoutForViewport()`）ので、
 * ここでも同じ関数を使って求める（決め打ちの定数だと実際のキャンバス幅とずれる）。
 * `assemble` モードの3Dペインは十分広いので `null`（600px未満で隠す）にはならないはずだが、
 * 万一なった場合は分かりやすいエラーで落とす。
 */
async function gizmoLayout(
  page: Page,
): Promise<{ size: number; margin: readonly [number, number] }> {
  const box = await canvasBox(page);
  const layout = gizmoLayoutForViewport(box.w);
  if (layout === null) {
    throw new Error(
      `ビューキューブが隠れる幅です（${String(box.w)}px < 600px）。E2E はキューブが見える幅を前提にしています`,
    );
  }
  return layout;
}

/** ビューキューブの中心（ページ座標）。左上から HUD の `margin` の位置に居る。 */
async function gizmoCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await canvasBox(page);
  const layout = await gizmoLayout(page);
  return { x: box.x + layout.margin[0], y: box.y + layout.margin[1] };
}

/**
 * ビューキューブの**面の中心**が来るページ座標（キューブ中心からのずれ）。
 *
 * drei の `GizmoHelper` はキューブを**主カメラの回転の逆**で置き、HUD は画面と同じ寸法の
 * 正射影（`margin` がそのまま px で効く空間）なので、面の法線をカメラの基底（右・上）へ
 * 写した成分に `size / 2`（キューブの1辺。`gizmoLayoutForViewport()` が決める）を掛ければ、
 * そのまま画面上のずれ［px］になる。
 *
 * 決め打ちのピクセル数で面を突くと、キューブの見た目（面取りの量・大きさ）が変わるたびに
 * 隣の辺や角を押してしまう。面の中心を計算で出しておけば見た目の変更に追随する。
 */
function gizmoFaceOffset(
  pose: CameraPose,
  normal: readonly [number, number, number],
  size: number,
): { dx: number; dy: number } {
  const sub = (a: readonly number[], b: readonly number[]): [number, number, number] => [
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  ];
  const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
  const dot = (a: readonly number[], b: readonly number[]): number =>
    (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
  const unit = (v: readonly number[]): [number, number, number] => {
    const length = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
    return length === 0
      ? [0, 0, 0]
      : [(v[0] ?? 0) / length, (v[1] ?? 0) / length, (v[2] ?? 0) / length];
  };
  const forward = unit(sub(pose.target, pose.position));
  const right = unit(cross(forward, pose.up));
  const up = cross(right, forward);
  const half = size / 2;
  // 画面の y は下向きなので、カメラの上方向の成分は符号を反転する
  return { dx: dot(normal, right) * half, dy: -dot(normal, up) * half };
}

/**
 * 視点プリセット（正面／俯瞰／ソケット拡大）を押す。
 * 2026-09-19 の UX 変更でツールバーの「…」（`toolbar-overflow-toggle`）の中に畳まれたので、
 * 開いて押して閉じるところまでをここでまとめる（UXレビュー #17）。
 */
async function selectPreset(page: Page, label: string): Promise<void> {
  await openOverflow(page);
  await page
    .getByTestId('toolbar-overflow')
    .getByRole('button', { name: label, exact: true })
    .click();
  await closeOverflow(page);
}

/** 「…」を開いて視点ボタンが押された状態であることを確かめ、閉じる。 */
async function expectPresetPressed(page: Page, label: string): Promise<void> {
  await openOverflow(page);
  await expect(
    page.getByTestId('toolbar-overflow').getByRole('button', { name: label, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await closeOverflow(page);
}

/** ビューキューブを掴んで `dx`/`dy`[px] だけ引いて放す。 */
async function dragGizmo(page: Page, dx: number, dy: number): Promise<void> {
  const center = await gizmoCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(center.x + (dx * step) / 8, center.y + (dy * step) / 8);
  }
  await page.mouse.up();
}

/**
 * 目に見える動きが止まるまでの粗い状態（角度 0.01rad ≒ 0.6°・距離 1mm 単位）。
 *
 * `OrbitControls` の慣性は**フレームごと**に 1−`dampingFactor` を掛けて減らす仕組みなので、
 * 最後の最後はミリラジアン以下の動きが何十フレームも続く（この盤は mm 単位で半径が 380 あり、
 * three 側の停止しきい値 1e-6 が相対的に厳しいため）。E2E は「見て分かる動きが止まったか」で
 * 測る（SwiftShare の描画環境では実フレームレートが約15fpsなので、フレーム数で測ると環境依存になる）。
 */
function coarse(state: Camera): string {
  return [
    state.az.toFixed(2),
    state.polar.toFixed(2),
    state.dist.toFixed(0),
    state.tx.toFixed(0),
    state.ty.toFixed(0),
    state.tz.toFixed(0),
  ].join(',');
}

/** 目に見える動きが止まるまで待ち、掛かった時間[ms]を返す。 */
async function settleMs(page: Page, limitMs = 7000): Promise<number> {
  const start = Date.now();
  let previous = coarse(await camera(page));
  for (;;) {
    await page.waitForTimeout(100);
    const next = coarse(await camera(page));
    if (next === previous) return Date.now() - start;
    previous = next;
    if (Date.now() - start > limitMs) throw new Error('カメラが止まりませんでした');
  }
}

test.describe('Blender 風の3D操作（§12.2）', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, page } = await launchApp({ window: { width: 1280, height: 800 } }));
    await page.getByTestId('mode-assemble').click();
    await page.getByTestId('open-b-001').click();
    await expect(page.getByTestId('viewport')).toBeVisible();
    await page.waitForTimeout(1200);
  });

  test.afterAll(async () => {
    await app.close();
  });

  test('ビューキューブをドラッグすると視点が回り、放すと慣性が減衰して止まる', async () => {
    await selectPreset(page, '正面');
    await page.waitForTimeout(600);
    const before = await camera(page);
    await shot(app, '20-nav-before-gizmo-drag');

    const center = await gizmoCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(center.x + step * 25, center.y);
    }
    await page.mouse.up();

    const settled = await settleMs(page);
    const after = await camera(page);
    await shot(app, '21-nav-after-gizmo-drag');

    /*
     * 200px 引いたので 200 × 0.36° ≒ 72°(1.257rad) 回る。符号は 2026-09-20 の所有者決定で
     * **右へ引くと方位角が増える**（カメラが指に付いてくる）に反転した（Task 19 Step 3/4）。
     */
    const turned = after.az - before.az;
    expect(turned).toBeGreaterThan(GIZMO_DRAG_RAD_PER_PX * 200 * 0.8);
    expect(turned).toBeLessThan(GIZMO_DRAG_RAD_PER_PX * 200 * 1.2);
    // 注視点は動かない（回転だけ）。距離も変わらない
    expect(after.tx).toBeCloseTo(before.tx, 1);
    expect(after.dist).toBeCloseTo(before.dist, 0);
    /*
     * 慣性は放したあと自然に減衰して止まる（＝そのあと描画も止まる。§15）。
     * 減衰は**フレームごと**に (1 − dampingFactor) を掛ける仕組みなので、実測の秒数は
     * 描画環境のフレームレートに反比例する。この E2E は SwiftShader（実測 約15fps）で動くので、
     * 上限は 5 秒に置く（見た目が止まるまで 実測 2〜4.5 秒＝約35〜65フレーム。
     * 60fps の実機なら 0.6〜1.1 秒）。ここで見たいのは「いつか必ず止まる」こと。
     */
    expect(settled).toBeLessThan(5000);
  });

  /** 極角の制限で停止していた不具合の再発防止。つかみ直しを含め縦横1周ずつ実測する。 */
  test('キューブは縦横360度回り、真下・真上・裏面でも止まらない', async () => {
    test.setTimeout(180_000);
    for (const preset of ['正面', '下']) {
      for (const [dx, dy] of [
        [125, 0],
        [0, 125],
      ] as const) {
        if (preset === '下') {
          await page.keyboard.press('Control+Numpad7');
          await page.waitForTimeout(400);
        } else await selectPreset(page, preset);
        await page.waitForTimeout(600);
        const start = await camera(page);
        let previous = start;
        for (let step = 0; step < 8; step += 1) {
          await dragGizmo(page, dx, dy);
          const current = await camera(page);
          const distance = Math.hypot(...current.position.map((v, i) => v - previous.position[i]!));
          expect(distance).toBeGreaterThan(start.dist * 0.65);
          expect(distance).toBeLessThan(start.dist * 0.85);
          expect(current.dist).toBeCloseTo(start.dist, 0);
          expect([current.tx, current.ty, current.tz]).toEqual([start.tx, start.ty, start.tz]);
          previous = current;
        }
        expect(Math.hypot(...previous.position.map((v, i) => v - start.position[i]!))).toBeLessThan(
          1,
        );
        expect(Math.hypot(...previous.up.map((v, i) => v - start.up[i]!))).toBeLessThan(0.01);
      }
    }
    await selectPreset(page, '正面');
    await page.waitForTimeout(600);
    await shot(app, '31-nav-full-orbit-return');
  });

  test('中ドラッグで回転、Shift＋中ドラッグで平行移動、ホイールでズーム', async () => {
    await selectPreset(page, '正面');
    await page.waitForTimeout(600);
    const box = await canvasBox(page);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;

    /*
     * ここは「効いているか」だけを見るので、慣性が完全に減衰し切るのは待たない
     * （減衰はフレーム単位で、SwiftShader では実時間が数秒掛かる。§15 の注記）。
     */
    // 中ドラッグ＝回転
    const beforeOrbit = await camera(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(cx + step * 20, cy);
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(700);
    const afterOrbit = await camera(page);
    expect(Math.abs(afterOrbit.az - beforeOrbit.az)).toBeGreaterThan(0.2);
    expect(afterOrbit.tx).toBeCloseTo(beforeOrbit.tx, 1);
    await shot(app, '22-nav-middle-drag-orbit');

    // Shift＋中ドラッグ＝平行移動（注視点が動く）
    await page.keyboard.down('Shift');
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(cx + step * 17, cy);
    await page.mouse.up({ button: 'middle' });
    await page.keyboard.up('Shift');
    await page.waitForTimeout(700);
    const afterPan = await camera(page);
    const moved = Math.hypot(
      afterPan.tx - afterOrbit.tx,
      afterPan.ty - afterOrbit.ty,
      afterPan.tz - afterOrbit.tz,
    );
    expect(moved).toBeGreaterThan(5);
    await shot(app, '23-nav-shift-middle-pan');

    // ホイール＝ズーム（注視点までの距離が縮む）
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(700);
    const afterZoom = await camera(page);
    expect(afterZoom.dist).toBeLessThan(afterPan.dist - 10);
    await shot(app, '24-nav-wheel-zoom');
  });

  test('テンキーで視点が切り替わる（1/3/7 と Ctrl、Home で全体）', async () => {
    await selectPreset(page, '正面');
    await page.waitForTimeout(600);
    const front = await camera(page);

    await page.keyboard.press('Numpad7');
    await page.waitForTimeout(700);
    await expectPresetPressed(page, '俯瞰');
    const top = await camera(page);
    expect(top.polar).toBeLessThan(front.polar);
    await shot(app, '25-nav-numpad7-top');

    await page.keyboard.press('Numpad1');
    await page.waitForTimeout(700);
    await expectPresetPressed(page, '正面');
    const backToFront = await camera(page);
    expect(backToFront.az).toBeCloseTo(front.az, 1);

    // Ctrl＋テンキー1は裏側（方位角がほぼ 180° 反対）
    await page.keyboard.press('Control+Numpad1');
    await page.waitForTimeout(700);
    const back = await camera(page);
    const turn = Math.abs(Math.abs(back.az - backToFront.az) - Math.PI);
    expect(turn).toBeLessThan(0.2);
    await shot(app, '26-nav-ctrl-numpad1-back');

    // Home は盤全体（正面）へ戻す
    await page.keyboard.press('Home');
    await page.waitForTimeout(700);
    await expectPresetPressed(page, '正面');
    const home = await camera(page);
    expect(home.az).toBeCloseTo(front.az, 1);
    expect(home.dist).toBeCloseTo(front.dist, 0);
    await shot(app, '27-nav-home-front');
  });

  test('キューブの面をクリックするとその視点へスナップする', async () => {
    await page.keyboard.press('Numpad7');
    await page.waitForTimeout(800);
    await expectPresetPressed(page, '俯瞰');
    // 俯瞰では上・前・左の3面が見える。「正面」の面（世界の +Z）の中心を突く
    const center = await gizmoCenter(page);
    const layout = await gizmoLayout(page);
    const face = gizmoFaceOffset(cameraPose('top'), [0, 0, 1], layout.size);
    await page.mouse.move(center.x + face.dx, center.y + face.dy);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(800);
    await expectPresetPressed(page, '正面');
    await shot(app, '28-nav-cube-face-click');
  });

  test('視点を回したドラッグでは端子を拾わない（配線が始まらない）', async () => {
    await selectPreset(page, '正面');
    await page.waitForTimeout(700);
    const box = await canvasBox(page);
    // 盤の真ん中あたり（端子が並ぶ帯）から左ドラッグで回す
    const x = box.x + box.w / 2;
    const y = box.y + box.h / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(x + step * 14, y + step * 4);
    await page.mouse.up();
    await page.waitForTimeout(400);
    // 1本目の端子が選ばれていない（＝ドラッグの終わりのクリックを捨てている）
    await expect(page.getByTestId('status-overlay')).toContainText('端子未選択');
  });

  /**
   * ビューキューブの「上」の面（§12.2）。
   *
   * 盤は 13° の傾斜コンソールなので、**面直の「正面」視はワールドではほぼ真上から
   * 見下ろす姿勢**になる（`cameraPose('front')` のカメラは +Y 側に立つ）。キューブは
   * ワールドの向きを示すので、正面視ではキューブの「上」の面が正対して見えており、
   * その中心を押すと俯瞰（`top`）プリセットへ移る。
   */
  test('キューブの「上」の面を押すと俯瞰プリセットへ移る', async () => {
    await selectPreset(page, '正面');
    await page.waitForTimeout(700);
    const front = await camera(page);

    const center = await gizmoCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(900);

    await expectPresetPressed(page, '俯瞰');
    const top = await camera(page);
    expect(top.polar).toBeLessThan(front.polar);
    await shot(app, '29-nav-cube-top-face');
  });
});
