import type { JSX } from 'react';
import { JA } from '../i18n/ja.js';
import type { PaletteItem } from '../session/schematic-edit.js';
import styles from './schematic.module.css';

/**
 * 回路図エディタのパレット。設計仕様 §11.4 / Plan 5 決定表#26。
 * 置ける要素は課題と盤から決まる（`paletteFor()`）ので、ここは**並べるだけ**にする。
 */

/** まとまりの順に並べ替えた項目（見出しごと）。 */
function byGroup(items: readonly PaletteItem[]): Array<{ group: string; items: PaletteItem[] }> {
  const out: Array<{ group: string; items: PaletteItem[] }> = [];
  for (const item of items) {
    const found = out.find((g) => g.group === item.group);
    if (found === undefined) out.push({ group: item.group, items: [item] });
    else found.items.push(item);
  }
  return out;
}

/** パレット。 */
export function SchematicPalette({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly PaletteItem[];
  selectedId: string | undefined;
  onSelect: (item: PaletteItem) => void;
}): JSX.Element {
  return (
    <section className={styles.palette} data-testid="schematic-palette">
      <h3 className={styles.paletteTitle}>{JA.schematic.palette}</h3>
      {byGroup(items).map((group) => (
        <div key={group.group} className={styles.paletteGroup}>
          <span className={styles.paletteGroupName}>{group.group}</span>
          <div className={styles.paletteItems}>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.paletteItem}
                aria-pressed={selectedId === item.id}
                data-testid={`palette-${item.id}`}
                onClick={() => {
                  onSelect(item);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
