import type { JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { startReplay } from '../session/replay.js';

export function ReplayEntry(): JSX.Element | null {
  const judge = useStore((s) => s.judge);
  if (judge === undefined || judge.mode === 'inspect-parts') return null;
  const unavailable = judge.mode === 'plc' && judge.ladderErrors.length > 0;
  return (
    <button
      type="button"
      data-testid="replay-open"
      aria-disabled={unavailable}
      title={unavailable ? JA.replay.cannotReplay : undefined}
      onClick={() => {
        if (!startReplay()) useStore.getState().toast(JA.replay.cannotReplay, 'info');
      }}
    >
      {JA.replay.title}
    </button>
  );
}
