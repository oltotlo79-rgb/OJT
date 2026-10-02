import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/renderer/app/store.js';
import { SessionActivity } from '../src/renderer/panels/SessionActivity.js';

afterEach(() => {
  cleanup();
  useStore.setState({ elapsedMs: 0, sessionHazardCount: 0 });
});

describe('ログと経過時間の折りたたみ', () => {
  it('初期は閉じ、閉じている間も時間と復元済みの警告数が更新される', () => {
    render(
      <SessionActivity
        limit={{ standardMin: 30, cutoffMin: 50 }}
        lines={[]}
        hazards={[]}
        chatters={[]}
        restoredHazardCount={2}
      />,
    );
    expect(screen.getByTestId<HTMLDetailsElement>('session-activity').open).toBe(false);
    expect(screen.getByTestId('activity-warning-count')).toHaveTextContent('警告 2');
    act(() => useStore.setState({ elapsedMs: 65_000, sessionHazardCount: 3 }));
    expect(screen.getByTestId('elapsed')).toHaveTextContent('01:05');
    expect(screen.getByTestId('activity-warning-count')).toHaveTextContent('警告 5');
    expect(screen.getAllByTestId('elapsed')).toHaveLength(1);
  });
});
