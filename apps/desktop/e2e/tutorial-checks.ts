import { expect, type Locator, type Page } from '@playwright/test';

/**
 * PLCの動画はメーカーごとに1本ずつある（2026-09-26）。再生画面のメーカー切替で開く動画。
 * 既定メーカー（三菱）の `plc.webm` は下の本体の検査で見るので、ここには残りの3本を並べる。
 */
/** 動画1本の長さの上限（秒）。 */
const TUTORIAL_MAX_SEC = 305;

const OTHER_PLC_VIDEOS = [
  ['jtekt', 'plc-jtekt'],
  ['omron', 'plc-omron'],
  ['sharp', 'plc-sharp'],
] as const;

/** メーカーを切り替えた動画が読み込め、長さ・大きさ・字幕がそろっていること。 */
async function verifySwitchedVideo(dialog: Locator, vendor: string, file: string): Promise<void> {
  await dialog.getByTestId(`tutorial-vendor-${vendor}`).click();
  await expect(dialog.getByTestId(`tutorial-vendor-${vendor}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const video = dialog.locator('video');
  await expect
    .poll(() =>
      video.evaluate(
        (element: HTMLVideoElement, name) => element.currentSrc.endsWith(`/${name}.webm`),
        file,
      ),
    )
    .toBe(true);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  const metadata = await video.evaluate((element: HTMLVideoElement) => ({
    duration: element.duration,
    width: element.videoWidth,
    height: element.videoHeight,
  }));
  expect(metadata.duration).toBeGreaterThan(60);
  expect(metadata.duration).toBeLessThan(TUTORIAL_MAX_SEC);
  expect(metadata.width).toBe(1600);
  expect(metadata.height).toBe(900);
  await video.evaluate((element: HTMLVideoElement) => {
    const subtitles = element.textTracks[0];
    if (!subtitles) throw new Error('日本語の字幕がありません');
    subtitles.mode = 'showing';
  });
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.textTracks[0]?.cues?.length ?? 0),
    )
    .toBeGreaterThan(5);
  expect(await video.evaluate((element: HTMLVideoElement) => element.error)).toBeNull();
}

/** 開発版と単一EXEの両方で、同梱動画を実際のfile://配信から再生する。 */
export async function verifyTutorials(page: Page): Promise<void> {
  for (const mode of ['assemble', 'inspect-parts', 'inspect-repair', 'plc']) {
    const opener = page.getByTestId(`tutorial-${mode}`);
    await opener.click();
    const dialog = page.getByTestId('tutorial-player');
    await expect(dialog).toBeVisible();
    const video = dialog.locator('video');
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(1);
    const metadata = await video.evaluate((element: HTMLVideoElement) => ({
      duration: element.duration,
      width: element.videoWidth,
      height: element.videoHeight,
      source: element.currentSrc,
      controls: element.controls,
    }));
    expect(metadata.duration).toBeGreaterThan(60);
    expect(metadata.duration).toBeLessThan(TUTORIAL_MAX_SEC);
    expect(metadata.width).toBe(1600);
    expect(metadata.height).toBe(900);
    expect(metadata.controls).toBe(true);
    expect(metadata.source).toMatch(/^file:.*\.webm$/u);
    await video.evaluate((element: HTMLVideoElement) => element.play());
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0.4);
    await video.evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.currentTime = element.duration * 0.65;
      const subtitles = element.textTracks[0];
      if (!subtitles) throw new Error('日本語の字幕がありません');
      subtitles.mode = 'showing';
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking))
      .toBe(false);
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(
      metadata.duration * 0.65,
      0,
    );
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.textTracks[0]?.cues?.length ?? 0),
      )
      .toBeGreaterThan(5);
    await dialog.getByRole('combobox', { name: '動画の再生速度' }).selectOption('1.25');
    expect(await video.evaluate((element: HTMLVideoElement) => element.playbackRate)).toBe(1.25);
    expect(await video.evaluate((element: HTMLVideoElement) => element.error)).toBeNull();
    if (mode === 'plc') {
      for (const [vendor, file] of OTHER_PLC_VIDEOS)
        await verifySwitchedVideo(dialog, vendor, file);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
}
