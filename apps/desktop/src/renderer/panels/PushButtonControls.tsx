import type { PushButtonDefinition } from '@ojt/board-model';
import type { JSX } from 'react';
import styles from './push-button-controls.module.css';

/** キャンバスの外に置き、3Dのボタンを覆わない押下保持の操作欄。 */
export function PushButtonControls({
  buttons,
  held,
  pressed,
  active,
  disabled,
  onToggle,
  onClear,
}: {
  buttons: readonly PushButtonDefinition[];
  held: ReadonlySet<string>;
  pressed: Readonly<Record<string, boolean>>;
  active: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div
      className={styles.controls}
      role="group"
      aria-label="押しボタンを押し続ける"
      data-testid="push-button-controls"
    >
      <span className={styles.label}>押し続ける</span>
      {buttons.map((button) => (
        <button
          key={button.id}
          type="button"
          data-testid={`hold-${button.id}`}
          aria-pressed={held.has(button.id)}
          disabled={disabled}
          title={`${button.color} ${button.id}：押下を保持／解除（3DではShift＋クリック）`}
          onClick={() => onToggle(button.id)}
        >
          {button.color} {button.id}
          {held.has(button.id) ? ' 保持中' : ''}
        </button>
      ))}
      <button
        type="button"
        data-testid="release-all-buttons"
        disabled={!active || disabled}
        onClick={onClear}
      >
        すべて離す
      </button>
      <span className={styles.note}>再度押すと解除・Escですべて離す</span>
      <span role="status" data-testid="push-button-state">
        押下中:{' '}
        {buttons
          .filter((button) => pressed[button.id])
          .map((button) => button.id)
          .join('・') || 'なし'}
      </span>
    </div>
  );
}
