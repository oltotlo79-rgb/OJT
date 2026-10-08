import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { PMREMGenerator, type Texture } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * 室内の環境マップ（v2.0.0 Task 5・設計 §3.5「描画の土台」）。
 *
 * three の `RoomEnvironment`（天井灯と壁の面光源だけの小さな部屋）を `PMREMGenerator` で
 * 畳み込み、`scene.environment` に入れる。画像ファイルは要らない（オフラインで動く配布版の
 * 前提を崩さない）。これで `MeshStandardMaterial` の金属（ネジ・レール・圧着端子）に
 * 部屋の明かりが映り込み、樹脂（ソケット・端子台）にも弱いハイライトが乗る。材質そのものは
 * `materials.ts` の材質表（`MATERIAL_PRESETS`）で決める。
 *
 * - 作るのは Canvas のマウントごとに1回。WebGL が失われて `BoardScene` が Canvas を作り直す
 *   （`key={generation}`）ときは、この部品もマウントし直されるので作り直しになる。
 * - `frameloop="demand"` なので、入れ終わったら `invalidate()` で1フレーム描き直す。
 * - 失敗したら（WebGL が使えない環境・テスト）直射光だけで描く。例外は外へ出さない。
 */

/**
 * 環境マップの強さ（`scene.environmentIntensity`）。
 * 直射光（`BoardScene.tsx` の `directionalLight`）と足して盤面が白く飛ばない値。
 */
export const ENVIRONMENT_INTENSITY = 0.55;

/** `RoomEnvironment` を畳み込むときのぼかし（three の推奨値）。 */
const ENVIRONMENT_SIGMA = 0.04;

export function SceneEnvironment(): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let texture: Texture | undefined;
    const pmrem = new PMREMGenerator(gl);
    try {
      const room = new RoomEnvironment();
      texture = pmrem.fromScene(room, ENVIRONMENT_SIGMA).texture;
      scene.environment = texture;
      scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    } catch {
      // WebGL が無い・畳み込みに失敗した: 直射光だけで描く（見た目が少し平坦になるだけ）
      texture = undefined;
    } finally {
      pmrem.dispose();
    }
    invalidate();
    return () => {
      if (scene.environment === texture) scene.environment = null;
      texture?.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}
