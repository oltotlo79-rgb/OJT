interface StartupImage {
  isEmpty(): boolean;
  toBitmap(): Uint8Array;
}

interface StartupWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  webContents: { capturePage(): Promise<StartupImage> };
}

/** 背景色だけのフレームや透明なフレームで起動画面を消さない。 */
export function hasStartupContent(image: StartupImage): boolean {
  if (image.isEmpty()) return false;
  const bytes = image.toBitmap();
  if (bytes.length < 64) return false;
  let first: readonly number[] | undefined;
  const stride = Math.max(4, Math.floor(bytes.length / 4096 / 4) * 4);
  for (let pixel = 0; pixel + 3 < bytes.length; pixel += stride) {
    if ((bytes[pixel + 3] ?? 0) < 250) continue;
    const color = [bytes[pixel] ?? 0, bytes[pixel + 1] ?? 0, bytes[pixel + 2] ?? 0];
    if (first === undefined) first = color;
    else if (color.some((channel, i) => Math.abs(channel - (first?.[i] ?? channel)) > 8))
      return true;
  }
  return false;
}

/** rendererの準備通知とは別に、コンポジタが本体の内容を描いたことを確認する。 */
export async function confirmStartupFrame(window: StartupWindow): Promise<boolean> {
  if (window.isDestroyed() || !window.isVisible() || window.isMinimized()) return false;
  try {
    const image = await window.webContents.capturePage();
    return (
      !window.isDestroyed() &&
      window.isVisible() &&
      !window.isMinimized() &&
      hasStartupContent(image)
    );
  } catch {
    return false;
  }
}
