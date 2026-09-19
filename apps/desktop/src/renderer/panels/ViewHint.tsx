import { useState, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import styles from './view-hint.module.css';

/**
 * 視点操作の早見表（Blender 風の割り当て）。§12.2
 *
 * UXレビュー #14: 常時表示だと盤の手前（下辺）を覆い、3Dの押ボタンを隠していた
 * （`Session.tsx` / `InspectPartsSession.tsx` / `InspectRepairSession.tsx` / `PlcSession.tsx`
 * の4画面が同じものを使う）。既定は「?」ボタンだけにして、押したときだけ早見表を出す。
 *
 * 2026-09-20 の監査指摘 B4: 以前は盤の**左下**に固定していたが、並べて表示（1280px）のように
 * 3Dペインが低いと、左上のビューキューブ＋⌂/⟳ボタンの下地がそこまで届いて重なっていた。
 * ビューキューブは常に**左上**の隅から `GIZMO_MAX_FOOTPRINT_PX`（`ViewGizmo.tsx`）を超えて
 * 広がらない（それより狭い・低いキャンバスでは自分から縮む・消える）。「?」を対角の
 * **右下**へ固定すれば、ペインの縦横がどれだけ潰れても幾何学的に重なりようがない
 * （`view-gizmo.test.tsx` の `GIZMO_MAX_FOOTPRINT_PX` 検算で担保）。状態オーバーレイは
 * 右**上**（`screens.module.css` の `.statusOverlay`）なので、右下はここまで空いていた。
 */
export function ViewHint(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        data-testid="view-hint-toggle"
        aria-expanded={open}
        aria-label={JA.viewHintToggle}
        onClick={() => {
          setOpen((next) => !next);
        }}
      >
        ?
      </button>
      {open ? (
        <div className={styles.hint} data-testid="view-hint">
          {JA.session.viewHint}
        </div>
      ) : null}
    </div>
  );
}
