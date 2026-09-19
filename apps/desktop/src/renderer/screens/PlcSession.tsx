import {
  socketPartId,
  toNetlistTerminal,
  type MountableKind,
  type SocketId,
} from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { isPlcProblem } from '@ojt/content';
import type { LadderProgram } from '@ojt/ladder-core';
import { getDialect, type DialectProfile } from '@ojt/plc-dialects';
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { sounds, soundsForSnapshot } from '../audio/sounds.js';
import {
  failedLog,
  historyLog,
  JA,
  openedProblemLog,
  powerLog,
  referenceErrorText,
  routeFailedLog,
  workFileSavedText,
} from '../i18n/ja.js';
import { LadderWorkspace } from '../ladder/LadderWorkspace.js';
import { ElapsedTimer } from '../panels/ElapsedTimer.js';
import { LogPanel } from '../panels/LogPanel.js';
import { PartsPanel } from '../panels/PartsPanel.js';
import { PowerControls } from '../panels/PowerControls.js';
import { ProblemPanel } from '../panels/ProblemPanel.js';
import { Toolbar } from '../panels/Toolbar.js';
import { WarningBanner } from '../panels/WarningBanner.js';
import {
  cloneSession,
  redo as redoHistory,
  runAddWire,
  runPlug,
  runRemoveWire,
  runSetPreset,
  runUnplug,
  undo as undoHistory,
  type CommandResult,
} from '../session/commands.js';
import {
  deleteKeyToAction,
  escapeToAction,
  pickToAction,
  shouldIgnoreShortcut,
  type PickAction,
  type PickHit,
} from '../session/interaction.js';
import type { LadderEditorMode } from '../session/ladder.js';
import { boardForProblem, canJudgePlc } from '../session/plc-session.js';
import { useViewportShortcuts } from '../session/viewport-keys.js';
import { applyWorkFile, toWorkFile } from '../session/work-file.js';
import { bridge } from '../session/worker-bridge.js';
import { BoardScene, safeRoutes } from '../three/BoardScene.js';
import styles from './screens.module.css';

/**
 * モードD（PLC）のセッション画面。設計仕様 §10.1 / §10.6 / §12.1。決定表#10
 *
 * 左にGX Works3風のラダーワークスペース、右に3D盤（PLC本体と壁コンセントを含む）を置く。
 * キーの宛先はフォーカスで決まる（決定表#3）: エディタにフォーカスがある間は視点のショートカットも
 * 盤の `Delete` / `Esc` も動かさない。
 */

/** 経過時間の更新間隔[ms]。 */
const ELAPSED_INTERVAL_MS = 200;

/** 手順の進み方（`done` 済み / `current` いまここ / `todo` これから / `anytime` いつでも）。 */
type StepState = 'done' | 'current' | 'todo' | 'anytime';

/**
 * ラダーに中身があるか（空セルと END だけなら「まだ作っていない」）。
 * 手順の表示にだけ使う。中身の**正しさ**は見ない（決定表#7）。
 */
function hasLadderContent(program: LadderProgram | undefined): boolean {
  if (program === undefined) return false;
  return program.networks.some((net) =>
    net.cells.some((row) => row.some((cell) => cell.kind !== 'empty' && cell.kind !== 'end')),
  );
}

/**
 * ラダーの作り方の1行。キーの文字列は**方言プロファイルから引く**（決定表#12）。
 * 画面にキーを直接書かないので、Phase 4 でメーカーを替えると案内も一緒に変わる。
 */
function ladderHintText(profile: DialectProfile): string {
  const keys = (['contact-no', 'coil', 'convert'] as const)
    .map((action) => profile.shortcuts.find((entry) => entry.action === action))
    .filter((entry) => entry !== undefined)
    .map((entry) => `${entry.keys}＝${entry.label}`);
  return keys.length === 0 ? JA.plc.ladderHint : `${JA.plc.ladderHint}: ${keys.join(' ／ ')}`;
}

/** 書込み／読出し／モニタの表示名（GX Works3 の言い方に揃える）。§10.6 */
function ladderModeLabel(mode: LadderEditorMode): string {
  if (mode === 'write') return JA.plc.modeWrite;
  if (mode === 'read') return JA.plc.modeRead;
  return JA.plc.modeMonitor;
}

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** スナップショットの差分から効果音を鳴らす（他の画面と同じ理由で切り出す）。§15 */
function SoundEffects(): null {
  const snapshot = useStore((s) => s.snapshot);
  const previous = useRef<typeof snapshot | undefined>(undefined);
  useEffect(() => {
    for (const kind of soundsForSnapshot(previous.current, snapshot)) sounds.play(kind);
    previous.current = snapshot;
  }, [snapshot]);
  return null;
}

/** モードDのセッション画面。 */
export function PlcSession(): JSX.Element {
  const problem = useStore((s) =>
    s.problem !== undefined && isPlcProblem(s.problem) ? s.problem : undefined,
  );
  const session = useStore((s) => s.session);
  const history = useStore((s) => s.history);
  const mode = useStore((s) => s.mode);
  const wireColor = useStore((s) => s.wireColor);
  const camera = useStore((s) => s.camera);
  const view = useStore((s) => s.ladderView);
  const ladderFocused = useStore((s) => s.ladderFocused);
  const ladderMode = useStore((s) => s.ladderMode);
  const converted = useStore((s) => s.converted);
  const ladder = useStore((s) => s.ladder);
  const plcRunning = useStore((s) => s.plcRunning);
  const selectedSocket = useStore((s) => s.selectedSocket);
  const powered = useStore((s) => s.snapshot.powered);
  const tripped = useStore((s) => s.snapshot.tripped);
  const breakerOn = useStore((s) => s.snapshot.breakerOn);
  const switchOn = useStore((s) => s.snapshot.switchOn);
  const hazards = useStore((s) => s.hazards);
  const chatters = useStore((s) => s.chatters);
  const logLines = useStore((s) => s.logLines);
  const judging = useStore((s) => s.judging);
  const restoredHazardCount = useStore((s) => s.restoredHazardCount);
  const dialectId = useStore((s) => s.dialectId);
  const problemId = problem?.id;
  const sessionEpoch = useStore((s) => s.sessionEpoch);

  const profile = useMemo(() => getDialect(dialectId), [dialectId]);
  /*
   * 表示列数はスキンの既定（三菱は11）。**Task 16** が設定画面の値（8〜15）で上書きする。
   * このタスクでは設定に依存させない（バッチ4がバッチ5より先に動くため）。§10.6
   */
  const gridCols = profile.gridCols;
  const board = useMemo(() => boardForProblem(problem), [problem]);

  // 視点のショートカットはラダーにフォーカスが無いときだけ効かせる（決定表#3）
  useViewportShortcuts({ enabled: session !== undefined && !ladderFocused });

  /** Worker への `plc` コマンド。 */
  const onPlc = useCallback((action: PlcCommandAction): void => {
    bridge.send({ type: 'plc', action });
  }, []);

  /** Worker を起こし、PLC本体つきの盤を読ませる。§10.1 */
  useEffect(() => {
    const store = useStore.getState();
    const current = store.problem;
    const currentSession = store.session;
    if (current === undefined || !isPlcProblem(current) || currentSession === undefined) {
      return undefined;
    }
    bridge.start({
      onSnapshot: (next) => {
        const state = useStore.getState();
        state.applySnapshot(next);
        // モニタ中でないときは毎フレーム `undefined` を入れ直さない（§15）
        if (next.plc !== undefined || state.plcMonitor !== undefined) state.setPlcMonitor(next.plc);
      },
      onJudge: () => {
        // モードDでは届かない（モードBの判定結果）
      },
      onPlc: (message) => {
        const state = useStore.getState();
        state.setJudging(false);
        if (message.result.ok) {
          state.setJudge(message.result.value);
          state.setRoute('result');
        } else {
          state.toast(referenceErrorText(message.result.errors.map((e) => e.message)), 'error');
        }
      },
      onError: (text, fatal) => {
        const state = useStore.getState();
        state.setJudging(false);
        const line = `${JA.error.workerError}: ${text}`;
        if (fatal) state.setFatalError(line);
        else state.toast(line, 'error');
        state.addLog(line);
      },
    });
    bridge.send({
      type: 'load',
      problemId: current.id,
      session: cloneSession(currentSession),
      plcModel: current.plc.model,
    });
    store.addLog(openedProblemLog(current.title));
    return () => {
      bridge.stop();
    };
  }, [problemId, sessionEpoch]);

  // 経過時間（§8.1）
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().tickElapsed();
    }, ELAPSED_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  /** 盤操作の結果を反映する（`InspectRepairSession` と同じ流儀）。§8.2 */
  const apply = useCallback(<T,>(result: CommandResult<T>, after: () => void): void => {
    const store = useStore.getState();
    if (!result.ok) {
      store.toast(result.message, 'error');
      store.addLog(failedLog(result.message));
      if (result.code === 'terminal-overload' && result.wire !== undefined) {
        bridge.send({ type: 'addWire', wire: result.wire });
      }
      return;
    }
    const current = store.session;
    if (current !== undefined) store.setSession(cloneSession(current));
    store.pushHistory(result.command);
    store.addLog(result.command.label);
    after();
  }, []);

  const runAction = useCallback(
    (action: PickAction): void => {
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      switch (action.type) {
        case 'beginWire':
          store.setPending(action.from);
          break;
        case 'cancelWire':
          store.setPending(undefined);
          store.addLog(JA.session.cancelWire);
          break;
        case 'completeWire':
          store.setPending(undefined);
          apply(runAddWire(current, action.from, action.to, action.color, board), () => {
            const next = useStore.getState();
            const wire = next.session?.wires.at(-1);
            const boardNow = next.session;
            if (wire === undefined || boardNow === undefined) return;
            bridge.send({ type: 'addWire', wire });
            const failed = safeRoutes(board, boardNow).errors.find((e) => e.wireId === wire.id);
            if (failed !== undefined) {
              next.toast(`${JA.session.routeFailed}（${JA.routeReason[failed.reason]}）`, 'error');
              next.addLog(routeFailedLog(wire.id, JA.routeReason[failed.reason]));
            }
          });
          break;
        case 'selectWire':
          store.setSelectedWire(action.wireId);
          break;
        case 'removeWire':
          apply(runRemoveWire(current, action.wireId), () => {
            useStore.getState().setSelectedWire(undefined);
            bridge.send({ type: 'removeWire', wireId: action.wireId });
          });
          break;
        case 'reject':
          store.toast(action.message, 'error');
          break;
        case 'selectSocket':
        case 'selectMounted':
          store.setSelectedSocket(action.socketId);
          break;
        case 'pressButton':
          bridge.send({ type: 'press', pbId: action.pbId });
          break;
        default:
          break;
      }
    },
    [apply, board],
  );

  const onHover = useCallback((id: TerminalId | undefined) => {
    useStore.getState().setHovered(id);
  }, []);
  const onPress = useCallback((pbId: string) => {
    bridge.send({ type: 'press', pbId });
  }, []);
  const onRelease = useCallback((pbId: string) => {
    bridge.send({ type: 'release', pbId });
  }, []);

  const onPick = useCallback(
    (hit: PickHit): void => {
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      const mapped: PickHit =
        hit.kind === 'terminal'
          ? { ...hit, id: toNetlistTerminal(current.socketRoles, hit.id) }
          : hit;
      runAction(
        pickToAction(
          {
            mode: store.mode,
            pendingTerminal: store.pendingTerminal,
            selectedWire: store.selectedWire,
            wireColor: store.wireColor,
          },
          mapped,
        ),
      );
    },
    [runAction],
  );

  // 盤のキーボード操作（ラダーにフォーカスがある間は動かさない。決定表#3）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (shouldIgnoreShortcut(event)) return;
      const store = useStore.getState();
      if (store.ladderFocused) return;
      const current = store.session;
      if (current === undefined) return;
      const state = {
        mode: store.mode,
        pendingTerminal: store.pendingTerminal,
        selectedWire: store.selectedWire,
        wireColor: store.wireColor,
      };
      if (event.key === 'Delete') {
        runAction(
          deleteKeyToAction(
            state,
            current.wires.filter((w) => w.locked).map((w) => w.id),
          ),
        );
        return;
      }
      if (event.key === 'Escape') runAction(escapeToAction(state));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [runAction]);

  if (problem === undefined || session === undefined) {
    return (
      <div className={styles.center}>
        <p>{JA.session.noProblem}</p>
        <button
          type="button"
          onClick={() => {
            useStore.getState().abandonSession();
          }}
        >
          {JA.result.toList}
        </button>
      </div>
    );
  }

  /**
   * 部品の装着・取り外し・タイマ設定。§8.2
   * `Session.tsx` の3つの関数と同じ（盤の操作はモードDでも変わらない）。
   */
  const onPlug = (socketId: SocketId, kind: MountableKind): void => {
    apply(runPlug(session, socketId, kind), () => {
      const next = useStore.getState().session;
      if (next !== undefined) bridge.send({ type: 'plug', socketId, session: cloneSession(next) });
    });
  };

  const onUnplug = (socketId: SocketId): void => {
    apply(runUnplug(session, socketId), () => {
      const next = useStore.getState().session;
      const partId = socketPartId(session.socketRoles, socketId);
      if (next !== undefined) bridge.send({ type: 'unplug', partId, session: cloneSession(next) });
    });
  };

  const onPreset = (socketId: SocketId, presetMs: number): void => {
    apply(runSetPreset(session, socketId, presetMs), () => {
      const next = useStore.getState().session;
      if (next === undefined) return;
      const mounted = next.mounted[socketId];
      if (mounted === undefined || mounted.kind !== 'timer-h3y4') return;
      bridge.send({
        type: 'setPreset',
        partId: socketPartId(next.socketRoles, socketId),
        presetMs: mounted.presetMs,
        session: cloneSession(next),
      });
    });
  };

  const readiness = canJudgePlc({ converted, ladder });
  const judgeTitle = readiness.ok
    ? JA.session.judge
    : readiness.reason === 'no-ladder'
      ? JA.plc.judgeNoLadder
      : JA.plc.judgeNotConverted;

  /*
   * 手順の見える化（2026-09-19 の利用者決定「分かりやすく直感的に」）。
   * 見るのは**ラダーの有無・変換済みか・RUN 中か**の3つだけで、配線の中身は一切見ない
   * （決定表#7: セッション中に合否を漏らさない）。「配線」はいつでも行える作業として
   * 完了印を出さない。
   */
  const written = hasLadderContent(ladder);
  const steps: ReadonlyArray<{ key: string; label: string; state: StepState }> = [
    { key: 'wire', label: JA.plc.stepWire, state: 'anytime' },
    { key: 'ladder', label: JA.plc.stepLadder, state: written ? 'done' : 'current' },
    {
      key: 'convert',
      label: JA.plc.stepConvert,
      state: converted ? 'done' : written ? 'current' : 'todo',
    },
    {
      key: 'run',
      label: JA.plc.stepRun,
      state: plcRunning ? 'done' : converted ? 'current' : 'todo',
    },
    {
      key: 'judge',
      label: JA.plc.stepJudge,
      state: readiness.ok && plcRunning ? 'current' : 'todo',
    },
  ];

  /** 元に戻す／やり直し（盤のみ。ラダーは `Ctrl+Z` がエディタで処理する。決定表#3） */
  const restore = (step: ReturnType<typeof undoHistory>, verb: string): void => {
    if (step === undefined) return;
    const store = useStore.getState();
    store.setHistory(step.history);
    store.setSession(step.session);
    store.setPending(undefined);
    store.setSelectedWire(undefined);
    store.clearLive();
    store.addLog(historyLog(verb, step.command.label));
    bridge.send({
      type: 'load',
      problemId: problem.id,
      session: cloneSession(step.session),
      plcModel: problem.plc.model,
    });
    // 盤を読み直すとスキャン結合も捨てられるので、変換済みのラダーを載せ直す（§10.4）
    const after = useStore.getState();
    if (after.converted && ladder !== undefined) {
      bridge.send({ type: 'plc', action: { kind: 'load', program: ladder } });
      // `load` は Worker 側で RUN もモニタも落とす（Task 3）。画面が RUN／モニタのままなら
      // 送り直さないと「ボタンは RUN なのに動かない」状態になる（レビュー指摘 B4）
      if (after.plcRunning) bridge.send({ type: 'plc', action: { kind: 'run', on: true } });
      if (after.ladderMode === 'monitor') {
        bridge.send({ type: 'plc', action: { kind: 'monitor', on: true } });
      }
    }
  };

  return (
    <>
      <SoundEffects />
      <Toolbar
        mode={mode}
        wireColor={wireColor}
        allowedColors={session.allowedColors}
        camera={camera}
        showPlcView
        canUndo={history.done.length > 0}
        canRedo={history.undone.length > 0}
        judging={judging}
        judgeDisabled={!readiness.ok}
        judgeTitle={judgeTitle}
        extraTools={
          <>
            {(
              [
                ['ladder', JA.plc.viewLadder],
                ['split', JA.plc.viewSplit],
                ['board', JA.plc.viewBoard],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={styles.plcToolButton}
                data-testid={`view-${value}`}
                aria-pressed={view === value}
                onClick={() => {
                  useStore.getState().setLadderView(value);
                }}
              >
                {label}
              </button>
            ))}
            {/*
              RUN/STOP は**盤だけを見ているときも押せる**必要がある（決定表#9b）。`MonitorPanel`
              の中にしか無いと `board` 表示のあいだ画面から消え、配線してから RUN にする動線が
              切れる（レビュー指摘 B5）。ここが正で、`MonitorPanel` 側は同じ状態を映す控えである。
            */}
            <button
              type="button"
              className={styles.plcToolButton}
              data-testid="plc-run"
              aria-pressed={plcRunning}
              title={JA.ladder.runStopTitle}
              onClick={() => {
                const next = !useStore.getState().plcRunning;
                useStore.getState().setPlcRunning(next);
                onPlc({ kind: 'run', on: next });
              }}
            >
              {plcRunning ? JA.ladder.stop : JA.ladder.run}
            </button>
          </>
        }
        onMode={(next) => {
          useStore.getState().setMode(next);
        }}
        onWireColor={(color) => {
          useStore.getState().setWireColor(color);
        }}
        onCamera={(preset) => {
          useStore.getState().setCamera(preset);
        }}
        onUndo={() => {
          restore(undoHistory(history), JA.session.undo);
        }}
        onRedo={() => {
          restore(redoHistory(history), JA.session.redo);
        }}
        onJudge={() => {
          const store = useStore.getState();
          if (store.judging) return;
          const boardSession = store.session;
          const currentLadder = store.ladder;
          if (boardSession === undefined || currentLadder === undefined) return;
          if (!canJudgePlc({ converted: store.converted, ladder: currentLadder }).ok) return;
          store.setJudging(true);
          bridge.send({
            type: 'judgePlc',
            problem,
            session: cloneSession(boardSession),
            ladder: currentLadder,
            elapsedMs: store.elapsedMs,
          });
        }}
        onBack={() => {
          useStore.getState().setRoute('list');
        }}
        onSave={() => {
          const store = useStore.getState();
          let api: ReturnType<typeof ojtApi>;
          try {
            api = ojtApi();
          } catch (error) {
            store.toast(reasonOf(error), 'error');
            return;
          }
          void api
            .saveWorkFile({
              kind: 'manual',
              file: toWorkFile(problem.id, session, store.elapsedMs, store.hazards.length),
            })
            .then((result) => {
              store.toast(
                result.ok ? workFileSavedText(result.path) : result.message,
                result.ok ? 'info' : 'error',
              );
            });
        }}
        onLoad={() => {
          let api: ReturnType<typeof ojtApi>;
          try {
            api = ojtApi();
          } catch (error) {
            useStore.getState().toast(reasonOf(error), 'error');
            return;
          }
          void api.loadWorkFile({ kind: 'manual' }).then((result) => {
            if (!result.ok) {
              if (!result.canceled) useStore.getState().toast(result.message, 'error');
              return;
            }
            void applyWorkFile(result.file);
          });
        }}
        schematicVisible={false}
        onToggleSchematic={undefined}
      >
        <PowerControls
          breakerOn={breakerOn}
          switchOn={switchOn}
          powered={powered}
          tripped={tripped}
          onBreaker={(on) => {
            bridge.send({ type: 'breaker', on });
            useStore.getState().addLog(powerLog(JA.session.breaker, on));
          }}
          onSwitch={(on) => {
            bridge.send({ type: 'switch', on });
            useStore.getState().addLog(powerLog(JA.session.switch, on));
          }}
          onResetTrip={() => {
            bridge.send({ type: 'resetTrip' });
            useStore.getState().addLog(JA.session.resetTripLog);
          }}
        />
      </Toolbar>

      {/*
        いまどの手順にいるのか・いまの状態は何か・次に何をすればよいのかを、
        ボタンの見た目に頼らず文字でも出す（2026-09-19 の利用者決定）。
        手順の判定材料はラダーの有無・変換済みか・RUN 中かの3つだけで、
        配線の中身（＝合否）には一切触れない（決定表#7）。
      */}
      <div className={styles.plcGuide} data-testid="plc-guide">
        <ol className={styles.plcSteps} aria-label={JA.plc.guide}>
          {steps.map((step) => (
            <li
              key={step.key}
              className={styles.plcStep}
              data-state={step.state}
              data-testid={`plc-step-${step.key}`}
              {...(step.state === 'current' ? { 'aria-current': 'step' as const } : {})}
            >
              <span className={styles.plcStepName}>{step.label}</span>
              {step.state === 'done' ? (
                <span className={styles.plcStepNote}>{JA.plc.stepDone}</span>
              ) : null}
              {step.state === 'current' ? (
                <span className={styles.plcStepNote}>{JA.plc.stepCurrent}</span>
              ) : null}
              {step.state === 'anytime' ? (
                <span className={styles.plcStepNote}>{JA.plc.stepAnytime}</span>
              ) : null}
            </li>
          ))}
        </ol>
        <div className={styles.plcStatus}>
          <span className={styles.plcChip} data-testid="plc-ladder-mode">
            {JA.plc.statusLadder}: {ladderModeLabel(ladderMode)}
          </span>
          <span
            className={styles.plcChip}
            data-testid="plc-run-status"
            data-on={plcRunning ? 'true' : 'false'}
          >
            {JA.plc.statusPlc}: {plcRunning ? JA.plc.statusRunning : JA.plc.statusStopped}
          </span>
        </div>
        <p className={styles.plcHint} data-testid="plc-hint">
          {readiness.ok ? null : (
            <span className={styles.plcBlocked}>
              {JA.plc.judgeBlocked}: {judgeTitle}
            </span>
          )}
          {ladderHintText(profile)}
        </p>
      </div>

      <div className={styles.plcLayout} data-testid="plc-session" data-view={view}>
        {view === 'board' ? null : (
          <LadderWorkspace problem={problem} profile={profile} gridCols={gridCols} onPlc={onPlc} />
        )}
        {view === 'ladder' ? null : (
          <div className={styles.viewport} data-testid="viewport">
            <WarningBanner />
            <BoardScene
              board={board}
              onPick={onPick}
              onHover={onHover}
              onPress={onPress}
              onRelease={onRelease}
            />
            <div className={styles.statusOverlay} data-testid="status-overlay">
              {powered ? JA.session.powered : JA.session.unpowered} / {JA.session.wires}{' '}
              {session.wires.length} {JA.session.wiresUnit}
              {tripped ? ` / ${JA.session.tripped}` : ''}
            </div>
            <div className={styles.viewHint} data-testid="view-hint">
              {JA.session.viewHint}
            </div>
          </div>
        )}
        <div className={styles.plcRight}>
          <ProblemPanel problem={problem} />
          {/*
            モードDもリレーはソケットへ装着してから `CRn.14` へ配線する（§10.2 の2段結線）。
            `onPlug` / `onUnplug` / `onPreset` は `Session.tsx` の3つをそのまま写す。
          */}
          <PartsPanel
            session={session}
            selectedSocket={selectedSocket}
            onSelectSocket={(socketId) => {
              useStore.getState().setSelectedSocket(socketId);
            }}
            onPlug={onPlug}
            onUnplug={onUnplug}
            onPreset={onPreset}
          />
          <ElapsedTimer limit={problem.timeLimit} />
          <LogPanel
            lines={logLines}
            hazards={hazards}
            chatters={chatters}
            restoredHazardCount={restoredHazardCount}
          />
        </div>
      </div>
    </>
  );
}
