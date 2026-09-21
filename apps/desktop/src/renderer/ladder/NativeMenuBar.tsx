import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { JA } from '../i18n/ja.js';
import { pushModalLayer } from '../session/interaction.js';
import styles from './native-menu.module.css';

export interface NativeMenuItem {
  id: string;
  label: string;
  key?: string | undefined;
  disabled?: boolean | undefined;
  checked?: boolean | undefined;
  run: () => void;
}
export interface NativeMenu {
  id: string;
  label: string;
  items: readonly NativeMenuItem[];
}

/** 純正ソフトのメニュー順に、実装済みのコマンドを配置する。 */
export function NativeMenuBar({ menus }: { menus: readonly NativeMenu[] }): JSX.Element {
  const bar = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | undefined>();
  const [tabStop, setTabStop] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId();
  const menu = active === undefined ? undefined : menus[active];
  const triggers = (): HTMLButtonElement[] =>
    Array.from(bar.current?.querySelectorAll('button') ?? []);
  const close = (restore = false): void => {
    if (restore && active !== undefined) triggers()[active]?.focus();
    setActive(undefined);
  };
  const open = (index: number): void => {
    const trigger = triggers()[index];
    if (!trigger || menus[index]?.items.length === 0) return;
    const box = trigger.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(box.left, window.innerWidth - 288)),
      top: box.bottom,
    });
    setActive(index);
  };
  const move = (index: number, direction: number, expand: boolean): void => {
    for (let offset = 1; offset <= menus.length; offset++) {
      const next = (index + menus.length + offset * direction) % menus.length;
      if (menus[next]?.items.length) {
        triggers()[next]?.focus();
        if (expand) open(next);
        return;
      }
    }
  };
  useEffect(() => {
    if (active === undefined) return undefined;
    const pop = pushModalLayer();
    popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (!bar.current?.contains(event.target) && !popup.current?.contains(event.target))
        setActive(undefined);
    };
    const resize = (): void => setActive(undefined);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize);
    return () => {
      pop.release();
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', resize);
    };
  }, [active]);
  return (
    <>
      <div ref={bar} className={styles.bar} role="menubar" aria-label={JA.ladder.nativeMenuLabel}>
        {menus.map((entry, index) => (
          <button
            type="button"
            key={entry.id}
            role="menuitem"
            aria-label={JA.ladder.nativeMenuName(entry.label)}
            aria-haspopup="menu"
            aria-expanded={active === index}
            aria-controls={active === index ? id : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            onFocus={() => setTabStop(index)}
            onPointerEnter={() => {
              if (active !== undefined) open(index);
            }}
            data-testid={`native-menu-${entry.id}`}
            disabled={entry.items.length === 0}
            title={entry.items.length === 0 ? JA.ladder.nativeUnavailable : undefined}
            onClick={() => (active === index ? close() : open(index))}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open(index);
              } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                move(index, event.key === 'ArrowRight' ? 1 : -1, active !== undefined);
              }
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {menu === undefined
        ? null
        : createPortal(
            <div
              ref={popup}
              id={id}
              role="menu"
              aria-label={menu.label}
              className={styles.popup}
              style={position}
              data-testid="native-menu-popup"
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  close(true);
                } else if (event.key === 'Tab') close(true);
                else if (
                  (event.key === 'ArrowRight' || event.key === 'ArrowLeft') &&
                  active !== undefined
                ) {
                  event.preventDefault();
                  move(active, event.key === 'ArrowRight' ? 1 : -1, true);
                } else if (
                  event.key === 'ArrowDown' ||
                  event.key === 'ArrowUp' ||
                  event.key === 'Home' ||
                  event.key === 'End'
                ) {
                  event.preventDefault();
                  const buttons = Array.from(
                    popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
                      [],
                  );
                  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : (at + buttons.length + (event.key === 'ArrowDown' ? 1 : -1)) %
                          buttons.length;
                  buttons[next]?.focus();
                }
              }}
            >
              {menu.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={item.checked}
                  data-testid={`native-item-${item.id}`}
                  disabled={item.disabled}
                  tabIndex={-1}
                  title={item.disabled ? JA.ladder.nativeUnavailable : undefined}
                  onClick={() => {
                    close(true);
                    item.run();
                  }}
                >
                  <span className={styles.check} aria-hidden="true">
                    {item.checked ? '✓' : ''}
                  </span>
                  <span>{item.label}</span>
                  <kbd>{item.key}</kbd>
                </button>
              ))}
            </div>,
            document.body,
          )}
    </>
  );
}
