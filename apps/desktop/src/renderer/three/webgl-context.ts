/** 実際の描画障害だけを知らせる。画面を離れたCanvasの終了イベントは無視する。 */
export function observeWebGlContext(
  canvas: HTMLCanvasElement,
  setLost: (lost: boolean) => void,
): () => void {
  const lost = (event: Event): void => {
    if (!canvas.isConnected) return;
    event.preventDefault();
    setLost(true);
  };
  const restored = (): void => {
    if (canvas.isConnected) setLost(false);
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
  };
}
