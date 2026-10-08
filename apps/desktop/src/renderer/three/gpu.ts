/**
 * 描画装置の種類に応じた描画の重さ（v2.0.0 Task 17）。
 *
 * CI と E2E（Playwright）はソフトウェア描画（Chromium の SwiftShader）で動く。そこでは影の描画
 * （光源から見た深度を 2048×2048 に描く）が1フレームの大半を占め、ビューキューブを 360 度回す
 * E2E が 180 秒を超えることがあった（2026-10-08 の CI、実行 37814794459）。GPU があるときの
 * 見た目は変えず、ソフトウェア描画のときだけ影の解像度を 1024 に落とす（盤 1,000mm を 1024 で
 * 割って 1 画素 ≒ 1mm。座金の影も読める）。
 *
 * 判定は起動時に一度だけ、使い捨ての WebGL コンテキストから `WEBGL_debug_renderer_info` の
 * UNMASKED_RENDERER を読む（Chromium は `RENDERER` だと "WebKit WebGL" しか返さない）。
 * Electron 以外（Vitest の jsdom など）では調べず、GPU ありとして扱う。
 */

/** 描画装置の名前がソフトウェア描画のものか。 */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  if (renderer === null || renderer === undefined) return false;
  return /SwiftShader|llvmpipe|softpipe|Software Rasterizer|Microsoft Basic Render/iu.test(
    renderer,
  );
}

/** 使い捨てのコンテキストで描画装置の名前を読む（読めなければ null）。 */
function probeRenderer(): string | null {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return null;
  if (!/Electron/u.test(navigator.userAgent)) return null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name: unknown =
      info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

/** 起動時に一度だけ判定した「ソフトウェア描画かどうか」。 */
export const SOFTWARE_RENDERER = isSoftwareRenderer(probeRenderer());

/** 影（光源から見た深度）の解像度。GPU あり 2048、ソフトウェア描画 1024。 */
export const SHADOW_MAP_SIZE = SOFTWARE_RENDERER ? 1024 : 2048;
