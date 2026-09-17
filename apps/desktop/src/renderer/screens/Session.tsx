import { JIPM_BOARD, socketPartId } from '@ojt/board-model';
import { isAssembleProblem } from '@ojt/content';
import type { BoardSession, MountableKind, SocketId } from '@ojt/board-model';
import type { TerminalId } from '@ojt/circuit-sim';
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import { ojtApi } from '../app/ojt-api.js';
import { schematicPolicy, useStore } from '../app/store.js';
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
import { ElapsedTimer } from '../panels/ElapsedTimer.js';
import { LogPanel } from '../panels/LogPanel.js';
import { PartsPanel } from '../panels/PartsPanel.js';
import { PowerControls } from '../panels/PowerControls.js';
import { ProblemPanel } from '../panels/ProblemPanel.js';
import { liveChart, TimeChartPanel, TimeChartSvg } from '../panels/TimeChartPanel.js';
import { Toolbar } from '../panels/Toolbar.js';
import { SchematicSvg } from '../schematic/SchematicSvg.js';
import {
  cloneSession,
  redo as redoHistory,
  runAddWire,
  runPlug,
  runRemoveWire,
  runSetPreset,
  runUnplug,
  undo as undoHistory,
  type CommandHistory,
  type CommandResult,
  type SessionCommand,
} from '../session/commands.js';
import {
  deleteKeyToAction,
  escapeToAction,
  pickToAction,
  shouldIgnoreShortcut,
  type PickAction,
  type PickHit,
} from '../session/interaction.js';
import { buildSpecChart } from '../session/spec-chart.js';
import { useViewportShortcuts } from '../session/viewport-keys.js';
import { applyWorkFile, toWorkFile } from '../session/work-file.js';
import { bridge } from '../session/worker-bridge.js';
import { BoardScene, safeRoutes } from '../three/BoardScene.js';
import styles from './screens.module.css';

/**
 * セッション画面（モードB）。設計仕様 §8.1 / §8.2 / §8.3 / §12.2。
 * ピック結果は `pickToAction()`（純粋関数）で操作に直し、盤操作は `commands.ts` の
 * コマンドを通して実行し、成功した変更だけを Worker に送る。
 */

/** 経過時間の更新間隔[ms]。 */
const ELAPSED_INTERVAL_MS = 200;

/** ライブチャートの最小横軸長[ms]（開始直後に潰れないようにする）。 */
const LIVE_MIN_DURATION_MS = 5000;

/** 例外から画面に出す1行を作る。 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * ライブ記録のチャート。§8.2
 * 毎秒約30回変わる `snapshot.tMs` をここで受けることで、`Session`（＝3Dビューポートを含む）を
 * 巻き添えで再描画しない（§15）。
 */
function LivePanel(): JSX.Element {
  const chartSpecs = useStore((s) => s.chartSpecs);
  const liveTransitions = useStore((s) => s.liveTransitions);
  const tMs = useStore((s) => s.snapshot.tMs);
  const live = useMemo(
    () => liveChart(chartSpecs, liveTransitions, Math.max(tMs, LIVE_MIN_DURATION_MS)),
    [chartSpecs, liveTransitions, tMs],
  );
  return (
    <section className={styles.panelLive}>
      <h2 className={styles.liveTitle}>{JA.session.liveChart}</h2>
      <TimeChartSvg chart={live} title={JA.session.liveChart} />
    </section>
  );
}

/**
 * スナップショットの差分から効果音を鳴らす（§15: WebAudio の合成音のみ）。
 * `LivePanel` と同じ理由で `snapshot` の購読を専用の小さなコンポーネントへ分離する
 * （`Session` 本体で購読すると毎秒約30回、3Dビューポートを含む部分木ごと再描画されてしまう）。
 * 何も描かないので、盤を組み直す（＝再マウントする）たびに「直前の音」の記憶も一緒に消える。
 */
function SoundEffects(): null {
  const snapshot = useStore((s) => s.snapshot);
  const previous = useRef<typeof snapshot | undefined>(undefined);
  useEffect(() => {
    for (const kind of soundsForSnapshot(previous.current, snapshot)) sounds.play(kind);
    previous.current = snapshot;
  }, [snapshot]);
  return null;
}

/** セッション画面。 */
export function Session(): JSX.Element {
  /*
   * この画面はモードB専用（C1/C2 は `InspectPartsSession` / `InspectRepairSession`）。
   * ストアの `problem` は3モードの共用体なので、ここで絞り込んでから使う。
   * 振り分けは `SessionRoute` が行うので、絞り込みに漏れたら「課題が選ばれていません」になる。
   */
  const problem = useStore((s) =>
    s.problem !== undefined && isAssembleProblem(s.problem) ? s.problem : undefined,
  );
  const session = useStore((s) => s.session);
  const history = useStore((s) => s.history);
  const mode = useStore((s) => s.mode);
  const wireColor = useStore((s) => s.wireColor);
  const pendingTerminal = useStore((s) => s.pendingTerminal);
  const selectedWire = useStore((s) => s.selectedWire);
  const selectedSocket = useStore((s) => s.selectedSocket);
  const camera = useStore((s) => s.camera);
  /*
   * スナップショットは毎秒約30枚届くが、この画面が見るのは電源まわりの真偽値だけ。
   * `snapshot` をまるごと購読すると、この画面（＝3Dビューポートを含む部分木）が毎秒30回
   * 再描画されてしまうので、**必要な値だけ**を個別に購読する。§15
   */
  const powered = useStore((s) => s.snapshot.powered);
  const tripped = useStore((s) => s.snapshot.tripped);
  const breakerOn = useStore((s) => s.snapshot.breakerOn);
  const switchOn = useStore((s) => s.snapshot.switchOn);
  const hazards = useStore((s) => s.hazards);
  const chatters = useStore((s) => s.chatters);
  const logLines = useStore((s) => s.logLines);
  const judging = useStore((s) => s.judging);
  const webglLost = useStore((s) => s.webglLost);
  const schematicVisible = useStore((s) => s.schematicVisible);
  const restoredHazardCount = useStore((s) => s.restoredHazardCount);
  const problemId = problem?.id;
  const sessionEpoch = useStore((s) => s.sessionEpoch);

  /*
   * 課題を開いたら Worker を起動して `load` を送る（§4.3）。
   * 依存に `sessionEpoch` を入れるのは、**同じ課題**をやり直したとき（結果画面の「もう一度」、
   * 例外バナーの「セッションをリセット」）に `problemId` が変わらず、この効果が張り直されないため。
   * 張り直されないと盤だけが作り直され、Worker は古いネットリストを回し続けて食い違う（§13 #5 / #6）。
   */
  useEffect(() => {
    const store = useStore.getState();
    const current = store.problem;
    const currentSession = store.session;
    if (current === undefined || currentSession === undefined) return;
    bridge.start({
      onSnapshot: (next) => {
        useStore.getState().applySnapshot(next);
      },
      onJudge: (message) => {
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
        // 判定の往復中に落ちたら「判定中…」のまま固まるので、必ず戻す（§8.2）
        state.setJudging(false);
        const line = `${JA.error.workerError}: ${text}`;
        // 追従ループが止まったら（§13 #6）トーストでは気づけない。バナーを出して立て直させる
        if (fatal) state.setFatalError(line);
        else state.toast(line, 'error');
        state.addLog(line);
      },
    });
    bridge.send({ type: 'load', problemId: current.id, session: cloneSession(currentSession) });
    store.addLog(openedProblemLog(current.title));
    return () => {
      bridge.stop();
    };
  }, [problemId, sessionEpoch]);

  // 経過時間を定期更新する（§8.1）
  useEffect(() => {
    const id = setInterval(() => {
      useStore.getState().tickElapsed();
    }, ELAPSED_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  /** コマンド結果を反映する。失敗はトーストとログに残すだけで盤は変わらない。§8.2 */
  const apply = useCallback(<T,>(result: CommandResult<T>, after: () => void): void => {
    const store = useStore.getState();
    if (!result.ok) {
      store.toast(result.message, 'error');
      store.addLog(failedLog(result.message));
      /*
       * 1端子3本目は盤としては断るが、実機では**やってしまえる**操作なので
       * 危険操作として数えたい（§5.6 #5 / §17 #25）。`Simulation.addWire()` は
       * 上限を超えた電線を**ネットリストに入れずに** `over-wires-per-terminal` を発行して
       * false を返すので、断られた電線をそのまま Worker へ送れば回路は汚さずに計上できる。
       */
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
        case 'none':
          break;
        case 'beginWire':
          store.setPending(action.from);
          break;
        case 'cancelWire':
          store.setPending(undefined);
          store.addLog(JA.session.cancelWire);
          break;
        case 'completeWire':
          store.setPending(undefined);
          apply(runAddWire(current, action.from, action.to, action.color), () => {
            const next = useStore.getState();
            const wire = next.session?.wires.at(-1);
            if (wire === undefined) return;
            bridge.send({ type: 'addWire', wire });
            // 経路器は「部品を避けて通せない」電線を `RoutingError` で断る（§6.6）。
            // `safeRoutes()` がそれを受け止めるので、ここでは結果を見て理由を知らせるだけでよい。
            // 電気的な接続は既に成立しているので、盤の状態は戻さない（描けないのは見た目だけ）。
            const board = next.session;
            if (board === undefined) return;
            const { routes, errors } = safeRoutes(JIPM_BOARD, board);
            const failed = errors.find((e) => e.wireId === wire.id);
            if (failed !== undefined) {
              next.toast(`${JA.session.routeFailed}（${JA.routeReason[failed.reason]}）`, 'error');
              next.addLog(routeFailedLog(wire.id, JA.routeReason[failed.reason]));
              return;
            }
            // 帯の空きスロットが尽きて他の電線と同じ位置に載った（3Dでは琥珀色で描かれる）
            if (routes.find((r) => r.wireId === wire.id)?.laneOverflow === true) {
              next.toast(JA.session.laneOverflow, 'info');
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
      }
    },
    [apply],
  );

  /** 3Dへ渡すコールバックは安定させる。毎回作り直すとシーン全体が再構築される。§15 */
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
      runAction(
        pickToAction(
          {
            mode: store.mode,
            pendingTerminal: store.pendingTerminal,
            selectedWire: store.selectedWire,
            wireColor: store.wireColor,
          },
          hit,
        ),
      );
    },
    [runAction],
  );

  /*
   * 視点のショートカット（上段 1/2/3、テンキー 1/3/7、Ctrl で反対側、Home で全体。§12.2）は
   * 画面に依存しないので `useViewportShortcuts` に切り出してある（モードC1/C2 からも同じものを使う）。
   */
  useViewportShortcuts({ enabled: session !== undefined });

  // キーボード操作（Esc で配線取消、Delete で電線削除。§8.2）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 入力欄で打鍵中・IME変換中は盤のショートカットを動かさない（§8.2）
      if (shouldIgnoreShortcut(event)) return;
      const store = useStore.getState();
      const current = store.session;
      if (current === undefined) return;
      const state = {
        mode: store.mode,
        pendingTerminal: store.pendingTerminal,
        selectedWire: store.selectedWire,
        wireColor: store.wireColor,
      };
      if (event.key === 'Escape') runAction(escapeToAction(state));
      else if (event.key === 'Delete') {
        runAction(
          deleteKeyToAction(
            state,
            current.wires.filter((w) => w.locked).map((w) => w.id),
          ),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [runAction]);

  const spec = useMemo(
    () => (problem === undefined ? undefined : buildSpecChart(problem)),
    [problem],
  );

  if (problem === undefined || session === undefined) {
    return <div className={styles.center}>{JA.session.noProblem}</div>;
  }

  /*
   * 回路図ヒントの出し方は級で決まる（§8.4）。3級は常時表示で開閉ボタンを出さない、
   * 2級は開閉できて初期は閉じる、1級は出さない。開閉できない級ではストアの値を見ずに
   * 規則そのものを見るので、何かの拍子に `schematicVisible` が倒れても3級の表示は消えない。
   */
  const policy = schematicPolicy(problem.grade);
  const showSchematic = policy.toggleable ? schematicVisible : policy.shown;

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
      // 宛先はネットリスト上の部品ID。役割が無いソケットでも `S3` として必ず届く（§6.4）
      bridge.send({
        type: 'setPreset',
        partId: socketPartId(next.socketRoles, socketId),
        presetMs: mounted.presetMs,
        session: cloneSession(next),
      });
    });
  };

  /**
   * 元に戻す／やり直し。盤を作り直すので **無通電に戻る**。
   * 実機でも配線をやり直す前に電源を落とすため（§5.3.5 の手順）、この挙動を既定とする。
   */
  const restore = (
    step: { history: CommandHistory; session: BoardSession; command: SessionCommand } | undefined,
    verb: string,
  ): void => {
    if (step === undefined) return;
    const store = useStore.getState();
    store.setHistory(step.history);
    store.setSession(step.session);
    store.setPending(undefined);
    store.setSelectedWire(undefined);
    store.clearLive();
    store.addLog(historyLog(verb, step.command.label));
    bridge.send({ type: 'load', problemId: problem.id, session: cloneSession(step.session) });
  };

  return (
    <>
      <SoundEffects />
      <Toolbar
        mode={mode}
        wireColor={wireColor}
        allowedColors={session.allowedColors}
        camera={camera}
        canUndo={history.done.length > 0}
        canRedo={history.undone.length > 0}
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
        judging={judging}
        onJudge={() => {
          // 往復中は押させない（結果が返るか Worker が落ちるまで `judging` が立つ）。§8.2
          if (useStore.getState().judging) return;
          useStore.getState().setJudging(true);
          bridge.send({
            type: 'judge',
            problem,
            session: cloneSession(session),
            elapsedMs: useStore.getState().elapsedMs,
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
        schematicVisible={showSchematic}
        onToggleSchematic={
          policy.toggleable
            ? () => {
                useStore.getState().toggleSchematic();
              }
            : undefined
        }
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

      <div className={styles.sessionLayout}>
        <div className={styles.viewport} data-testid="viewport">
          <BoardScene onPick={onPick} onHover={onHover} onPress={onPress} onRelease={onRelease} />
          <div className={styles.statusOverlay} data-testid="status-overlay">
            {powered ? JA.session.powered : JA.session.unpowered} / {JA.session.wires}{' '}
            {session.wires.length} {JA.session.wiresUnit} /{' '}
            {pendingTerminal === undefined
              ? JA.session.noTerminal
              : `${JA.session.firstTerminal}: ${pendingTerminal}`}
            {selectedWire === undefined ? '' : ` / ${JA.session.selection}: ${selectedWire}`}
            {tripped ? ` / ${JA.session.tripped}` : ''}
            {webglLost ? ` / ${JA.error.webglLost}` : ''}
          </div>
          {/* 視点操作の早見表（Blender 風の割り当て）。§12.2 */}
          <div className={styles.viewHint} data-testid="view-hint">
            {JA.session.viewHint}
          </div>
        </div>

        <div className={styles.rightPanel}>
          <ProblemPanel problem={problem} />
          {spec !== undefined && spec.ok ? <TimeChartPanel chart={spec.chart} /> : null}
          {spec !== undefined && !spec.ok ? (
            <p data-testid="reference-error">{referenceErrorText(spec.errors)}</p>
          ) : null}
          <LivePanel />
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
          {/*
            回路図ヒントは**部品パネルより後**に置く（1D2-a のレビュー指摘）。
            3級は常時表示なので、先に置くと縦長の回路図に押し出されて「部品」が画面外へ行き、
            右パネルを一番下までスクロールしないと部品を装着できなかった。§8.4 / §8.1
          */}
          {showSchematic ? (
            <section className={styles.panelLive} data-testid="schematic-hint">
              <h2 className={styles.liveTitle}>{JA.session.schematicHint}</h2>
              <div className={styles.schematicBox}>
                <SchematicSvg document={problem.schematic} />
              </div>
            </section>
          ) : null}
        </div>

        <div className={styles.bottomPanel}>
          <LogPanel
            lines={logLines}
            hazards={hazards}
            chatters={chatters}
            restoredHazardCount={restoredHazardCount}
          />
          <ElapsedTimer limit={problem.timeLimit} />
        </div>
      </div>
    </>
  );
}
