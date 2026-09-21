import { useEffect, useMemo, type JSX } from 'react';
import { getDialect } from '@ojt/plc-dialects';
import { useStore } from '../app/store.js';
import { LadderGrid } from '../ladder/LadderGrid.js';
import { skinCssVars, skinThemeOf } from '../ladder/skins/index.js';
import { ReplayBar } from '../panels/ReplayBar.js';
import { skinGridCols } from '../session/plc-skin.js';
import { stopReplay } from '../session/replay.js';
import { WorkerBridge } from '../session/worker-bridge.js';
import { BoardScene } from '../three/BoardScene.js';
import styles from '../panels/replay-bar.module.css';

const noop = (): void => {};
const NO_ERRORS = new Set<string>();

/** 編集画面のキー処理・電源操作をマウントしない、見直し専用の画面。 */
export function ReplayScreen(): JSX.Element | null {
  const replay = useStore((s) => s.replay);
  const profile = getDialect(useStore((s) => s.dialectId));
  const cursor = useStore((s) => s.ladderCursor);
  const comments = useStore((s) => s.ladderComments);
  const cols = useStore((s) => s.ladderGridCols);
  const color = useStore((s) => s.monitorColor);
  const worker = useMemo(() => new WorkerBridge(), []);
  const source = replay?.source;
  useEffect(() => {
    if (source === undefined) return;
    worker.start({
      onSnapshot: noop,
      onJudge: noop,
      onReplay: ({ index, snapshot }) => {
        const current = useStore.getState().replay;
        if (current?.source !== source) return;
        useStore.setState({
          replay: { ...current, index, busy: false },
          snapshot,
          plcMonitor: snapshot.plc,
        });
      },
      onError: (message) => {
        worker.stop();
        stopReplay();
        useStore.getState().toast(message, 'error');
      },
    });
    worker.send({ type: 'replay', action: 'start', source });
    return () => {
      worker.stop();
    };
  }, [source, worker]);
  if (replay === undefined) return null;
  const step = replay.steps[replay.index];
  if (step === undefined) return null;
  const theme = skinThemeOf(profile);
  return (
    <main className={styles.screen}>
      <ReplayBar
        step={step}
        busy={replay.busy}
        onStep={(index) => {
          useStore.setState({ replay: { ...replay, busy: true } });
          worker.send({ type: 'replay', action: 'step', index });
        }}
        onStop={() => {
          worker.send({ type: 'replay', action: 'stop' });
          worker.stop();
          stopReplay();
        }}
      />
      {replay.source.mode === 'plc' ? (
        <div className={styles.ladder} style={skinCssVars(profile, theme, color)}>
          <LadderGrid
            program={replay.source.ladder}
            profile={profile}
            theme={theme}
            cursor={cursor}
            mode="monitor"
            comments={comments}
            gridCols={skinGridCols(profile, cols)}
            errorCells={NO_ERRORS}
            onPickCell={noop}
          />
        </div>
      ) : (
        <div className={styles.viewport} data-testid="replay-viewport">
          <BoardScene onPick={noop} onHover={noop} onPress={noop} onRelease={noop} />
        </div>
      )}
    </main>
  );
}
