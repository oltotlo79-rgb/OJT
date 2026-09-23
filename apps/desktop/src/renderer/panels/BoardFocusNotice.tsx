import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { NO_HIGHLIGHT } from '../app/store-types.js';

export function BoardFocusNotice(): JSX.Element | null {
  const focus = useStore((state) => state.boardFocus);
  if (focus === undefined) return null;
  return (
    <div
      role="status"
      style={{
        padding: '8px 16px',
        background: '#173a50',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <span style={{ flex: 1 }}>{focus.text}</span>
      <button
        type="button"
        onClick={() => {
          const state = useStore.getState();
          state.setBoardFocus(undefined);
          state.setHighlight(NO_HIGHLIGHT);
          if (focus.from === 'result') state.setRoute('result');
        }}
      >
        {focus.from === 'result' ? '結果へ戻る' : '強調表示を解除'}
      </button>
    </div>
  );
}
